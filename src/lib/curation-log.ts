import type { ChatItem } from "~/shared/chat";

// Render a chat item as one terse log line for the curation log view — the
// user watches WHAT the janitor does, not a conversation. Returns null for
// items that aren't log-worthy (the injected prompt, empty text).
export function summarizeChatItem(item: ChatItem): string | null {
  if (item.type === "user") return null; // the injected prompt — noise
  if (item.type === "tool") return `• ${item.summary}`;
  if (item.type === "assistant" || item.type === "notice") {
    const text = item.text.trim();
    return text ? text : null;
  }
  return null;
}
