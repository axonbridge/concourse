import { app, safeStorage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import log from "electron-log/main";
import type { EngineId } from "../../src/shared/ai-providers";

// Per-provider API keys, encrypted with the OS keychain (Electron safeStorage)
// and persisted OUTSIDE the sqlite settings (never in plaintext, never synced
// through the settings API). The renderer can only learn WHETHER a key exists —
// the key material itself never crosses the IPC boundary outward; the engine
// adapters read it main-process-side and inject it as an env var.

const FILE = () => path.join(app.getPath("userData"), "credentials.json");

/** Env var each engine's CLI/SDK accepts for API-key auth. Direct engines
 *  (openai/openrouter/custom) don't use env injection — the Direct engine reads
 *  getCredential() and sends the key as a request header — but the names still
 *  label the settings UI. */
export const CREDENTIAL_ENV: Partial<Record<EngineId, string>> = {
  "claude-code": "ANTHROPIC_API_KEY",
  codex: "OPENAI_API_KEY",
  "cursor-cli": "CURSOR_API_KEY",
  // opencode manages provider keys itself (`opencode auth`) — no single env var.
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  custom: "API_KEY",
  // ollama is local and keyless.
};

type StoreShape = Record<string, string>; // provider id → base64(encrypted key)

function readStore(): StoreShape {
  try {
    const raw = fs.readFileSync(FILE(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as StoreShape;
    }
  } catch {
    /* missing/corrupt → empty */
  }
  return {};
}

function writeStore(store: StoreShape): void {
  fs.writeFileSync(FILE(), JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function credentialStatus(): Record<string, boolean> {
  const store = readStore();
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(store)) out[key] = true;
  return out;
}

export function setCredential(provider: string, apiKey: string): { ok: boolean; error?: string } {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, error: "Empty key" };
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: "OS keychain encryption is unavailable on this machine." };
  }
  try {
    const store = readStore();
    store[provider] = safeStorage.encryptString(trimmed).toString("base64");
    writeStore(store);
    return { ok: true };
  } catch (e) {
    log.error("[credentials] set failed", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function deleteCredential(provider: string): { ok: boolean } {
  try {
    const store = readStore();
    if (provider in store) {
      delete store[provider];
      writeStore(store);
    }
    return { ok: true };
  } catch (e) {
    log.error("[credentials] delete failed", e);
    return { ok: false };
  }
}

/** Main-process only: decrypt a provider's key for engine env injection. */
export function getCredential(provider: string): string | null {
  try {
    const blob = readStore()[provider];
    if (!blob || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(blob, "base64"));
  } catch (e) {
    log.warn("[credentials] decrypt failed", e);
    return null;
  }
}
