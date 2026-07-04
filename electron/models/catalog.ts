import log from "electron-log/main";
import { aiProviderInfo, type EngineId } from "../../src/shared/ai-providers";
import type { AiModel } from "../../src/shared/ai-providers";
import { getCredential } from "../credentials/store";
import { discoverClaudeModels } from "../chat/providers/claude";
import { listOpencodeModels } from "../chat/providers/opencode";

// ModelCatalog (plan §M3): live model discovery per provider, normalized to
// "the latest few per family", cached, with an honest static fallback when
// discovery is impossible — notably Claude via CLI login has NO models API,
// so its curated alias list from ai-providers.ts is the answer, not an error.

export type ModelListResult = {
  models: AiModel[];
  /** live = fetched from the provider; static = curated fallback list. */
  source: "live" | "static";
  error?: string;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const cache = new Map<string, { at: number; result: ModelListResult }>();

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Strip date/version suffixes so "gpt-4.1-2025-04-14" and "gpt-4.1" collapse
 *  into one family; the shortest id in a family is its canonical alias. */
function familyOf(id: string): string {
  return id
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-(latest|preview)$/, "");
}

/** Keep the canonical (shortest) id per family, preserving input order. */
function dedupeByFamily(ids: string[], cap: number): string[] {
  const byFamily = new Map<string, string>();
  for (const id of ids) {
    const fam = familyOf(id);
    const cur = byFamily.get(fam);
    if (!cur || id.length < cur.length) byFamily.set(fam, id);
  }
  return [...byFamily.values()].slice(0, cap);
}

const OPENAI_NON_CHAT =
  /whisper|tts|dall-e|embedding|moderation|realtime|audio|transcribe|image|babbage|davinci|codex-mini|search-preview|instruct/i;

async function listOpenAi(): Promise<ModelListResult> {
  const key = getCredential("openai");
  if (!key) return { models: [], source: "static", error: "Add an OpenAI API key first." };
  const data = await getJson("https://api.openai.com/v1/models", {
    Authorization: `Bearer ${key}`,
  });
  const entries = (data?.data ?? [])
    .map((m: any) => ({ id: String(m?.id ?? ""), created: Number(m?.created ?? 0) }))
    .filter((m: { id: string }) => m.id && !OPENAI_NON_CHAT.test(m.id))
    .filter((m: { id: string }) => /^(gpt|o\d|chatgpt)/.test(m.id));
  // One entry per family: canonical (shortest) id, ranked by the family's
  // NEWEST release so the list leads with the latest models, not gpt-3.5.
  const families = new Map<string, { id: string; newest: number }>();
  for (const m of entries) {
    const fam = familyOf(m.id);
    const cur = families.get(fam);
    families.set(fam, {
      id: cur && cur.id.length <= m.id.length ? cur.id : m.id,
      newest: Math.max(cur?.newest ?? 0, m.created),
    });
  }
  const picked = [...families.values()].sort((a, b) => b.newest - a.newest).slice(0, 15);
  return { models: picked.map((m) => ({ id: m.id, label: m.id })), source: "live" };
}

async function listOpenRouter(): Promise<ModelListResult> {
  // The models index is public — no key needed to browse.
  const data = await getJson("https://openrouter.ai/api/v1/models");
  const models = (data?.data ?? [])
    .map((m: any) => ({
      id: String(m?.id ?? ""),
      label: String(m?.name ?? m?.id ?? ""),
      created: Number(m?.created ?? 0),
    }))
    .filter((m: any) => m.id);
  // Newest ~3 per lab (the id prefix before "/"), majors first by recency.
  models.sort((a: any, b: any) => b.created - a.created);
  const byLab = new Map<string, Array<{ id: string; label: string }>>();
  for (const m of models) {
    // "~anthropic/claude-…-latest" alias entries belong to their real lab.
    const lab = (m.id.split("/")[0] ?? "other").replace(/^~/, "");
    const list = byLab.get(lab) ?? [];
    if (list.length < 3) {
      list.push({ id: m.id, label: m.label });
      byLab.set(lab, list);
    }
  }
  const flat = [...byLab.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([, list]) => list)
    .slice(0, 45);
  return { models: flat, source: "live" };
}

async function listOllama(): Promise<ModelListResult> {
  try {
    const data = await getJson("http://127.0.0.1:11434/api/tags");
    const models = (data?.models ?? [])
      .map((m: any) => String(m?.name ?? ""))
      .filter(Boolean)
      .map((id: string) => ({ id, label: id }));
    return models.length
      ? { models, source: "live" }
      : { models: [], source: "live", error: "Ollama is running but has no models pulled." };
  } catch {
    return { models: [], source: "static", error: "Ollama isn't running on this machine." };
  }
}

async function listAnthropic(): Promise<ModelListResult> {
  const staticList = aiProviderInfo("claude-code").models;
  const key = getCredential("claude-code");
  // CLI login has no HTTP models API — but the CLI itself knows what the
  // account can run. Ask it via the SDK's supportedModels() (throwaway
  // session, cached upstream); new families (Fable, …) appear automatically.
  if (!key) {
    const discovered = await discoverClaudeModels();
    return discovered.length
      ? { models: discovered, source: "live" }
      : { models: staticList, source: "static" };
  }
  try {
    const data = await getJson("https://api.anthropic.com/v1/models?limit=50", {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    });
    const ids = (data?.data ?? []).map((m: any) => String(m?.id ?? "")).filter(Boolean);
    const labels = new Map(
      (data?.data ?? []).map((m: any) => [String(m?.id ?? ""), String(m?.display_name ?? m?.id)]),
    );
    const picked = dedupeByFamily(ids, 8);
    return {
      models: picked.map((id) => ({ id, label: String(labels.get(id) ?? id) })),
      source: "live",
    };
  } catch (e) {
    log.warn("[models] anthropic discovery failed; using static list", e);
    return { models: staticList, source: "static" };
  }
}

/** Live Codex model list: newest codex-tuned + flagship GPT models from the
 *  OpenAI API when a key is present (`codex -m` accepts these ids); static
 *  fallback covers ChatGPT-login users with no API key. */
async function listCodex(): Promise<ModelListResult> {
  const key = getCredential("openai");
  if (!key) {
    return {
      models: aiProviderInfo("codex").models,
      source: "static",
      error: "Using the built-in list — add an OpenAI API key for live model discovery.",
    };
  }
  const data = await getJson("https://api.openai.com/v1/models", {
    Authorization: `Bearer ${key}`,
  });
  const entries = (data?.data ?? [])
    .map((m: any) => ({ id: String(m?.id ?? ""), created: Number(m?.created ?? 0) }))
    .filter((m: { id: string }) => /^gpt-[0-9]/.test(m.id) && !/mini-audio|realtime|audio|transcribe|image|search/i.test(m.id))
    .filter((m: { id: string }) => /codex/i.test(m.id) || !/-\d{4}-\d{2}-\d{2}$/.test(m.id))
    .sort((a: { created: number }, b: { created: number }) => b.created - a.created)
    .slice(0, 8);
  if (entries.length === 0) return { models: aiProviderInfo("codex").models, source: "static" };
  return {
    models: entries.map((m: { id: string }) => ({ id: m.id, label: m.id })),
    source: "live",
  };
}

export async function listModels(provider: EngineId): Promise<ModelListResult> {
  const cached = cache.get(provider);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  let result: ModelListResult;
  try {
    switch (provider) {
      case "openai":
        result = await listOpenAi();
        break;
      case "openrouter":
        result = await listOpenRouter();
        break;
      case "ollama":
        result = await listOllama();
        break;
      case "claude-code":
        result = await listAnthropic();
        break;
      case "codex":
        result = await listCodex();
        break;
      case "opencode": {
        const models = await listOpencodeModels();
        result = models.length
          ? { models, source: "live" }
          : { models: [], source: "static", error: "OpenCode isn't running or has no authenticated providers." };
        break;
      }
      // custom needs its endpoint URL (arrives with the Direct engine config);
      // codex/cursor/opencode manage their own models.
      default:
        result = { models: aiProviderInfo(provider).models, source: "static" };
    }
  } catch (e) {
    log.warn(`[models] discovery failed for ${provider}`, e);
    result = {
      models: aiProviderInfo(provider).models,
      source: "static",
      error: e instanceof Error ? e.message : String(e),
    };
  }
  // Don't cache empty error results for long — a key added a second later
  // should take effect on the next open.
  if (result.models.length > 0) cache.set(provider, { at: Date.now(), result });
  return result;
}

/** Test hook / settings-change hook: drop cached lists (e.g. after a key add). */
export function invalidateModelCache(provider?: EngineId): void {
  if (provider) cache.delete(provider);
  else cache.clear();
}
