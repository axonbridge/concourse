import { resolveChatAgent, type EngineId } from "../../src/shared/ai-providers";
import type { ChatProvider } from "./provider";
import { claudeChatProvider } from "./providers/claude";
import { directChatProvider } from "./providers/direct";
import { opencodeChatProvider } from "./providers/opencode";
import { codexChatProvider } from "./providers/codex";
import { cursorChatProvider } from "./providers/cursor";

// Chat-capable adapters, keyed by engine id. Engines without an entry (vendor
// CLIs; direct providers until the Direct engine lands) fall back through
// resolveChatAgent to the first chat-capable engine, so asking for them
// transparently runs Claude. Capabilities shown in the UI come from
// src/shared/ai-providers.ts; keep the two in lockstep when adding an adapter.
const PROVIDERS = new Map<EngineId, ChatProvider>([
  [claudeChatProvider.id, claudeChatProvider],
  [opencodeChatProvider.id, opencodeChatProvider],
  [codexChatProvider.id, codexChatProvider],
  [cursorChatProvider.id, cursorChatProvider],
  ["openai", directChatProvider("openai")],
  ["openrouter", directChatProvider("openrouter")],
  ["ollama", directChatProvider("ollama")],
  ["custom", directChatProvider("custom")],
]);

export function getChatProvider(agent?: EngineId | null): ChatProvider {
  const resolved = resolveChatAgent(agent);
  const provider = PROVIDERS.get(resolved);
  if (!provider) {
    // resolveChatAgent only returns chatCapable ids; missing adapter = drift
    // between ai-providers.ts and this registry.
    throw new Error(`No chat adapter registered for provider "${resolved}"`);
  }
  return provider;
}
