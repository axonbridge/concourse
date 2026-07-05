// Shared types for the chat surface (the non-technical, no-terminal view).
// THE PORT CONTRACT between the renderer (ChatView/chat-store) and the provider
// adapters in electron/chat/providers/. Adapters normalize their vendor's
// messages into these simple shapes so the UI never knows any vendor schema.

export type ChatItem =
  | { id: string; type: "assistant"; text: string }
  | { id: string; type: "user"; text: string; attachments?: Array<{ name: string; dataUrl?: string }> }
  | { id: string; type: "tool"; name: string; summary: string }
  | { id: string; type: "notice"; text: string };

export type ChatStatus =
  | "starting"
  | "running"
  | "awaiting-input" // turn finished, waiting for the user to type
  | "awaiting-permission"
  | "ended"
  | "error";

// A pending write/dangerous action the user must approve in the chat.
export type ChatPermission = {
  requestId: string;
  toolName: string;
  /** Human-readable one-liner, e.g. "Create Jira story PPI-…" or "Write file X". */
  summary: string;
};

// main → renderer events (channel IPC.chatEvent)
export type ChatEvent =
  | { kind: "item"; sessionId: string; item: ChatItem }
  | { kind: "status"; sessionId: string; status: ChatStatus; detail?: string }
  | { kind: "permission"; sessionId: string; permission: ChatPermission }
  // Transient "what's happening right now" label for the working indicator
  // (e.g. "searching Jira…"). Not a message item; latest label wins.
  | { kind: "activity"; sessionId: string; label: string }
  // Incremental text for the in-progress assistant reply (direct engines
  // stream tokens). Cleared when the completed "item" arrives.
  | { kind: "delta"; sessionId: string; text: string }
  // The vendor assigned/changed its own session id (e.g. Codex thread id,
  // known only after the first turn). The store persists it on the task so
  // reopening the chat resumes the same vendor thread.
  | { kind: "provider-session"; sessionId: string; providerSessionId: string };

// Approval POLICY lives in the domain (src/domain/policy/action-policy.ts);
// each engine adapter maps its own tool vocabulary to ActionClasses (e.g.
// electron/chat/providers/claude-tools.ts). This file stays events-only.
