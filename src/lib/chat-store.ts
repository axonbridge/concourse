import { useSyncExternalStore } from "react";
import { getElectron } from "./electron";
import { api } from "./api";
import type { ChatEvent, ChatItem, ChatPermission, ChatStatus } from "~/shared/chat";
import type { TaskStatus } from "~/shared/domain";
import { aiProviderInfo, resolveChatAgent, type EngineId } from "~/shared/ai-providers";

// Renderer-side store for chat sessions. It lives outside React so a chat keeps
// accumulating messages while its ChatView is closed — that's what lets a user
// leave a chat (it shows in the Sessions list) and come back to resume it within
// the app run. One global subscription to the chat IPC fans out to all sessions.
// (Durability across a full app restart is a separate, future step.)

type SessionState = {
  items: ChatItem[];
  status: ChatStatus;
  permission: ChatPermission | null;
  cwd: string;
  title: string;
  // Stored so a primed session can start the agent lazily on the user's first
  // message (we defer firing the command until they type).
  providerSessionId?: string;
  /** AI provider (TaskAgent id) powering this session; default claude-code. */
  agent?: string;
  /** OpenAI-compatible endpoint (custom direct engine only). */
  baseUrl?: string;
  /** User pressed Stop: the backend session ended; the next message resumes it. */
  interrupted?: boolean;
  /** Model override for the provider (AI settings default or intro picker). */
  model?: string;
  pendingCommand?: string;
  // Whether the backend (main-process) session has been started yet. A primed
  // chat starts lazily on the first message; command chats start via the
  // command-fire path, plain chats via the plain path. Guards double-starts.
  started?: boolean;
  // Auto-approve file writes for this session (the "create a workflow" builder).
  autoApproveWrites?: boolean;
  // Onboarding intro shown before the first message (what the command does +
  // example prompts). Cleared once the user sends.
  intro?: { description: string; examples: string[] };
  // Transient "what's happening now" label for the working indicator
  // (e.g. "using atlassian · searchJiraIssuesUsingJql"). Cleared when idle.
  activity?: string;
  // Accumulated in-progress assistant text (streaming engines). Rendered as a
  // live bubble; cleared when the finished item lands.
  streamingText?: string;
};

const sessions = new Map<string, SessionState>();
const listeners = new Map<string, Set<() => void>>();
let subscribed = false;

// The chat session the user is currently viewing (its ChatView is mounted). Used
// to suppress the "session finished" notification for a chat you're actively in —
// a multi-turn chat ends every turn in awaiting-input, which would otherwise
// notify on each question. Notifications still fire if you've left the chat or
// backgrounded the app.
let activeChatSessionId: string | null = null;

function emptyState(cwd: string, title: string): SessionState {
  return { items: [], status: "starting", permission: null, cwd, title };
}

function notify(sessionId: string) {
  // Re-key the map entry to a shallow clone: useSyncExternalStore re-renders
  // only when getSnapshot's value changes identity (Object.is), and our event
  // handlers mutate fields in place — without this, updates only became
  // visible when something else (e.g. the busy clock) happened to re-render.
  const state = sessions.get(sessionId);
  if (state) sessions.set(sessionId, { ...state });
  listeners.get(sessionId)?.forEach((cb) => cb());
}

// Turn the opening message of a plain chat into a short, scannable session title.
function deriveChatTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  const MAX = 48;
  return oneLine.length > MAX ? `${oneLine.slice(0, MAX).trimEnd()}…` : oneLine;
}

// Map a chat status onto the task-card status so the Sessions list stays live.
// "awaiting-input"/"awaiting-permission" map to "finished" so they flow through
// the same `session:finished` pipeline the terminal uses — firing the OS
// notification + in-app bell + click-to-open whenever the chat finishes a turn
// or needs your approval (i.e. wants your attention).
const TASK_STATUS_BY_CHAT: Partial<Record<ChatStatus, TaskStatus>> = {
  starting: "running",
  running: "running",
  "awaiting-permission": "finished",
  "awaiting-input": "finished",
  ended: "finished",
  error: "terminated",
};

function syncTask(sessionId: string, status: ChatStatus, items: ChatItem[]) {
  const taskStatus = TASK_STATUS_BY_CHAT[status];
  if (!taskStatus) return;
  const lastAssistant = [...items].reverse().find((i) => i.type === "assistant");
  const preview = lastAssistant && lastAssistant.type === "assistant"
    ? lastAssistant.text.replace(/\s+/g, " ").slice(0, 120)
    : undefined;
  // Best-effort — never let a status-sync failure affect the chat.
  void api.updateTaskStatus(sessionId, { status: taskStatus, ...(preview ? { preview } : {}) }).catch(() => {});
}

function ensureSubscribed() {
  if (subscribed) return;
  const electron = getElectron();
  if (!electron) return;
  subscribed = true;
  electron.chat.onEvent((raw) => {
    const event = raw as ChatEvent;
    const state = sessions.get(event.sessionId);
    if (!state) return;
    if (event.kind === "item") {
      state.items = [...state.items, event.item];
      if (event.item.type === "assistant") state.streamingText = undefined;
    } else if (event.kind === "delta") {
      state.streamingText = (state.streamingText ?? "") + event.text;
    } else if (event.kind === "status") {
      state.status = event.status;
      if (event.status !== "awaiting-permission") state.permission = null;
      // Idle states clear the live activity label.
      if (event.status !== "running" && event.status !== "starting") {
        state.activity = undefined;
        state.streamingText = undefined;
      }
      syncTask(event.sessionId, event.status, state.items);
    } else if (event.kind === "permission") {
      state.permission = event.permission;
    } else if (event.kind === "activity") {
      state.activity = event.label;
    }
    notify(event.sessionId);
  });
}

export const chatStore = {
  setActiveChatSession(id: string | null) {
    activeChatSessionId = id;
  },
  getActiveChatSessionId(): string | null {
    return activeChatSessionId;
  },
  // Prime a freshly-picked command: open the chat with an onboarding intro
  // (what it does + examples) but DON'T run anything yet. The command fires on
  // the user's first message — see send(). Idempotent.
  prime(
    sessionId: string,
    opts: {
      cwd: string;
      title: string;
      command: string;
      providerSessionId?: string;
      agent?: string;
      model?: string;
      baseUrl?: string;
      description?: string;
      examples?: string[];
      autoApproveWrites?: boolean;
    },
  ) {
    ensureSubscribed();
    if (sessions.has(sessionId)) return;
    const state = emptyState(opts.cwd, opts.title);
    state.status = "awaiting-input"; // ready for the user to type
    state.providerSessionId = opts.providerSessionId;
    state.agent = opts.agent;
    state.model = opts.model;
    state.baseUrl = opts.baseUrl;
    state.pendingCommand = opts.command;
    state.autoApproveWrites = opts.autoApproveWrites;
    state.intro = { description: opts.description ?? "", examples: opts.examples ?? [] };
    sessions.set(sessionId, state);
    notify(sessionId);
  },

  // Change the model for a session (input-bar picker). Before the backend
  // session starts it's just local state; once started, only direct engines
  // (stateless per request) can switch — harness sessions are model-pinned.
  setModel(sessionId: string, model: string | undefined) {
    const state = sessions.get(sessionId);
    if (!state) return;
    if (state.started) {
      const engine = resolveChatAgent((state.agent as EngineId | undefined) ?? null);
      if (aiProviderInfo(engine).kind !== "direct") return;
      void getElectron()?.chat.setModel(sessionId, model);
    }
    state.model = model;
    notify(sessionId);
  },

  // Start a chat (idempotent). For a session already live in this store, it's a
  // no-op so the in-memory transcript is preserved. When `resume` is set (e.g.
  // reopening after an app restart), the main process replays the saved Claude
  // session and continues it — no in-memory seed needed.
  start(
    sessionId: string,
    opts: {
      cwd: string;
      initialText: string;
      title: string;
      providerSessionId?: string;
      agent?: string;
      model?: string;
      baseUrl?: string;
      resume?: boolean;
    },
  ) {
    ensureSubscribed();
    if (sessions.has(sessionId)) return;
    const state = emptyState(opts.cwd, opts.title);
    // Fresh chat: echo the kicked-off task as the first user bubble. On resume
    // the real transcript is replayed by the main process instead.
    if (!opts.resume) state.items = [{ id: "seed", type: "user", text: opts.title }];
    state.started = true;
    state.providerSessionId = opts.providerSessionId;
    state.agent = opts.agent;
    state.model = opts.model;
    state.baseUrl = opts.baseUrl;
    sessions.set(sessionId, state);
    notify(sessionId);
    void getElectron()?.chat.start({
      sessionId,
      cwd: opts.cwd,
      initialText: opts.initialText,
      agent: opts.agent,
      model: opts.model,
      baseUrl: opts.baseUrl,
      providerSessionId: opts.providerSessionId,
      resume: opts.resume,
    });
  },

  has(sessionId: string) {
    return sessions.has(sessionId);
  },

  get(sessionId: string): SessionState | null {
    return sessions.get(sessionId) ?? null;
  },

  subscribe(sessionId: string, cb: () => void): () => void {
    let set = listeners.get(sessionId);
    if (!set) {
      set = new Set();
      listeners.set(sessionId, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  },

  send(
    sessionId: string,
    text: string,
    opts?: { displayText?: string; attachments?: Array<{ name: string; dataUrl?: string }> },
  ) {
    const state = sessions.get(sessionId);
    if (!state) return;
    if (state.interrupted) {
      // Restart the ended backend session, continuing the same provider
      // conversation. Replay repopulates the transcript, so clear our copy.
      state.interrupted = false;
      state.items = [];
      state.status = "running";
      notify(sessionId);
      void getElectron()?.chat.start({
        sessionId,
        cwd: state.cwd,
        initialText: text,
        agent: state.agent,
        model: state.model,
        baseUrl: state.baseUrl,
        providerSessionId: state.providerSessionId,
        resume: !!state.providerSessionId,
        autoApproveWrites: state.autoApproveWrites,
      });
      return;
    }
    // Show the user's message as-is.
    state.items = [
      ...state.items,
      {
        id: `u-${state.items.length}`,
        type: "user",
        text: opts?.displayText ?? text,
        ...(opts?.attachments?.length ? { attachments: opts.attachments } : {}),
      },
    ];
    state.status = "running";

    if (state.pendingCommand) {
      // First message on a primed command: NOW fire `/command <their input>`
      // and start the agent. Clear the intro + pending flag.
      const command = state.pendingCommand;
      state.pendingCommand = undefined;
      state.intro = undefined;
      state.started = true;
      notify(sessionId);
      void getElectron()?.chat.start({
        sessionId,
        cwd: state.cwd,
        initialText: `/${command} ${text}`.trim(),
        agent: state.agent,
        model: state.model,
        baseUrl: state.baseUrl,
        providerSessionId: state.providerSessionId,
        resume: false,
        autoApproveWrites: state.autoApproveWrites,
      });
      return;
    }

    // Plain chat (no command): the first message boots the backend session with
    // the raw text; later messages continue it. Guards against double-starting.
    if (!state.started) {
      state.started = true;
      state.intro = undefined;
      // Auto-title a generic "Chat" from its opening message so the sessions list
      // is scannable (command chats already have meaningful titles).
      if (state.title === "Chat") {
        const derived = deriveChatTitle(text);
        if (derived) {
          state.title = derived;
          void api.updateTask(sessionId, { title: derived }).catch(() => {});
        }
      }
      notify(sessionId);
      void getElectron()?.chat.start({
        sessionId,
        cwd: state.cwd,
        initialText: text,
        agent: state.agent,
        model: state.model,
        baseUrl: state.baseUrl,
        providerSessionId: state.providerSessionId,
        resume: false,
        autoApproveWrites: state.autoApproveWrites,
      });
      return;
    }

    notify(sessionId);
    void getElectron()?.chat.send(sessionId, text);
  },

  respondPermission(sessionId: string, requestId: string, allow: boolean) {
    const state = sessions.get(sessionId);
    if (state) {
      state.permission = null;
      notify(sessionId);
    }
    void getElectron()?.chat.respondPermission(sessionId, requestId, allow);
  },

  // Fully end a chat (used when its task is archived/deleted).
  // Stop the current work WITHOUT losing the conversation: the adapter aborts
  // and emits "ended"; the next user message restarts the backend session with
  // resume (provider-side history intact — the replay repopulates the view).
  interrupt(sessionId: string) {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.interrupted = true;
    state.activity = undefined;
    void getElectron()?.chat.stop(sessionId);
    notify(sessionId);
  },

  stop(sessionId: string) {
    void getElectron()?.chat.stop(sessionId);
    sessions.delete(sessionId);
    listeners.delete(sessionId);
  },
};

// React hook: re-renders when the given session's state changes.
export function useChatSession(sessionId: string): SessionState | null {
  return useSyncExternalStore(
    (cb) => chatStore.subscribe(sessionId, cb),
    () => chatStore.get(sessionId),
  );
}
