import { TASK_AGENTS, isTaskAgent, type TaskAgent } from "./domain";
import { AGENT_REGISTRY } from "./agents";
import { CLAUDE_MODEL_ALIASES, CLAUDE_MODEL_LABELS } from "./claude-models";

// Client-safe, static descriptors for the AI engines Concourse can drive.
// This is the single source of truth for engine *capabilities* — the settings
// UI, the chat-creation sites, and the electron chat registry all read it, so
// adding chat support for an engine means flipping `chatCapable` (and shipping
// an adapter in electron/chat/providers/) with zero UI rework.
//
// Two kinds of engine (see docs/ARCHITECTURE.md §5):
// - "harness": a vendor CLI/agent-harness (Claude Code, Codex, Cursor,
//   OpenCode). Powers terminals via AGENT_REGISTRY; chat when an adapter
//   exists (today: Claude). Auth = its own CLI login, or an API key.
// - "direct": our own engine speaking an OpenAI-compatible API (OpenAI,
//   OpenRouter, Ollama, custom endpoint). No terminal. Chat lands with the
//   Direct engine (M3c) — until then chatCapable stays false here.

export const DIRECT_PROVIDERS = ["openai", "openrouter", "ollama", "custom"] as const;
export type DirectProvider = (typeof DIRECT_PROVIDERS)[number];

export const ENGINE_IDS = [...TASK_AGENTS, ...DIRECT_PROVIDERS] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const isEngineId = (value: unknown): value is EngineId =>
  typeof value === "string" && (ENGINE_IDS as readonly string[]).includes(value);

export type AiModel = { id: string; label: string };

export type EngineCredential = "cli-login" | "api-key" | "either" | "none";

export type AiProviderInfo = {
  id: EngineId;
  label: string;
  description: string;
  kind: "harness" | "direct";
  /** Can power the structured chat/workflow window (not just a terminal). */
  chatCapable: boolean;
  /** Can open as a terminal session (vendor CLIs only). */
  terminalCapable: boolean;
  /** How this engine authenticates. "either" = CLI login or stored API key. */
  credential: EngineCredential;
  /** Static model list ([] = discovered at runtime via the ModelCatalog, or
   *  the provider manages its own). Claude's doubles as the no-API fallback. */
  models: AiModel[];
};

const HARNESS_PROVIDERS: readonly AiProviderInfo[] = TASK_AGENTS.map((id) => ({
  id,
  label: AGENT_REGISTRY[id].label,
  description: AGENT_REGISTRY[id].description,
  kind: "harness" as const,
  chatCapable: true, // all four harnesses have chat adapters now (M6)
  terminalCapable: true,
  credential: id === "opencode" ? ("cli-login" as const) : ("either" as const),
  models:
    id === "claude-code"
      ? CLAUDE_MODEL_ALIASES.map((alias) => ({ id: alias, label: CLAUDE_MODEL_LABELS[alias] }))
      : id === "codex"
        ? // Fallback when no OpenAI API key enables live discovery. Source:
          // developers.openai.com/api/docs/models/all (checked 2026-07-04).
          [
            { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
            { id: "gpt-5.5", label: "GPT-5.5" },
            { id: "gpt-5.4", label: "GPT-5.4" },
            { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
          ]
        : [],
}));

const DIRECT_PROVIDER_INFO: readonly AiProviderInfo[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT models over the OpenAI API.",
    kind: "direct",
    chatCapable: true,
    terminalCapable: false,
    credential: "api-key",
    models: [],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "One API key for 300+ models across every major lab.",
    kind: "direct",
    chatCapable: true,
    terminalCapable: false,
    credential: "api-key",
    models: [],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    description: "Models running on this machine — private, keyless, offline.",
    kind: "direct",
    chatCapable: true,
    terminalCapable: false,
    credential: "none",
    models: [],
  },
  {
    id: "custom",
    label: "Custom endpoint",
    description: "Any OpenAI-compatible server (org gateway, vLLM, LM Studio…).",
    kind: "direct",
    chatCapable: true,
    terminalCapable: false,
    credential: "api-key",
    models: [],
  },
];

export const AI_PROVIDERS: readonly AiProviderInfo[] = [
  ...HARNESS_PROVIDERS,
  ...DIRECT_PROVIDER_INFO,
];

export function aiProviderInfo(id: EngineId): AiProviderInfo {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0]!;
}

/** The engine that will actually power a chat session: the preferred one when
 *  it's chat-capable, otherwise the first chat-capable engine (Claude). */
export function resolveChatAgent(preferred?: EngineId | null): EngineId {
  if (preferred && aiProviderInfo(preferred).chatCapable) return preferred;
  return AI_PROVIDERS.find((p) => p.chatCapable)!.id;
}

/** The vendor CLI a terminal session should open: the preferred engine when
 *  it IS a CLI, otherwise Claude Code (direct engines have no terminal). */
export function resolveTerminalAgent(preferred?: EngineId | null): TaskAgent {
  if (preferred && isTaskAgent(preferred)) return preferred;
  return "claude-code";
}
