import type { EngineId } from "../../src/shared/ai-providers";
import type { ChatEvent } from "../../src/shared/chat";

// THE PORT for structured chat sessions (ports & adapters). The renderer speaks
// only ChatEvent (src/shared/chat.ts); the IPC layer (electron/chat/ipc.ts)
// dispatches to whichever ChatProvider the session's agent maps to. Vendors are
// adapters under electron/chat/providers/ — the app never imports a vendor SDK
// outside its adapter. Capabilities (which providers can chat, which models they
// offer) live client-safe in src/shared/ai-providers.ts.

export type ChatStartOptions = {
  /** Concourse task id — used as the event routing key. */
  sessionId: string;
  cwd: string;
  /** First message to send; empty string = attach and wait for input. */
  initialText: string;
  /** Provider-side conversation id for durable resume. Persisted on the task row
   *  (column `claude_session_id` for historical reasons — treat as generic). */
  providerSessionId?: string;
  /** Reattach to a saved conversation (replay transcript + continue). */
  resume?: boolean;
  /** Auto-approve file writes (the workflow builder). Scoped per adapter. */
  autoApproveWrites?: boolean;
  dangerouslySkipApprovals?: boolean;
  /** Model id from the provider's models list (src/shared/ai-providers.ts). */
  model?: string;
  /** OpenAI-compatible endpoint for the "custom" direct engine (settings). */
  baseUrl?: string;
};

export interface ChatSessionHandle {
  send(text: string): void;
  respondPermission(requestId: string, allow: boolean): void;
  /** Switch the model mid-session. Only stateless-per-request engines (direct)
   *  implement this; harness sessions have their model fixed at start. */
  setModel?(model: string | undefined): void;
  /** Tear the session down; the adapter emits a final "ended" status. */
  stop(): void;
}

export interface ChatProvider {
  readonly id: EngineId;
  /** Start (or resume) a session. Must be synchronous-returning: the handle is
   *  usable immediately; all progress flows through `emit` as ChatEvents. */
  start(opts: ChatStartOptions, emit: (event: ChatEvent) => void): ChatSessionHandle;
}
