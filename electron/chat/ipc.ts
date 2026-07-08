import type { BrowserWindow, IpcMain } from "electron";
import { safeHandle } from "../ipc-safe-handle";
import { IPC } from "../ipc-channels";
import log from "electron-log/main";
import type { ChatEvent } from "../../src/shared/chat";
import { resolveChatAgent, type EngineId } from "../../src/shared/ai-providers";
import { recordRun, outputPathFromToolSummary } from "../../src/domain/knowledge/run-recorder";
import { getChatProvider } from "./registry";
import type { ChatSessionHandle } from "./provider";

// Provider-agnostic chat IPC. Routes chat:* calls to whichever ChatProvider the
// session's agent maps to (electron/chat/registry.ts) and relays the adapter's
// ChatEvents to the renderer. Knows nothing about any vendor SDK.

export type ChatStartRequest = {
  sessionId: string;
  cwd: string;
  initialText: string;
  agent?: EngineId;
  model?: string;
  providerSessionId?: string;
  resume?: boolean;
  autoApproveWrites?: boolean;
  disallowShell?: boolean;
  privateKnowledge?: boolean;
  dangerouslySkipApprovals?: boolean;
  /** OpenAI-compatible endpoint for the "custom" direct engine. */
  baseUrl?: string;
};

// Knowledge write-back (§M5a): a session whose message fires a /command in a
// CWF workspace is a workflow RUN — when its turn completes, append an OKF
// run-record + log entry to the workspace's knowledge/. Observed here (the
// engine-agnostic seam) so every engine gets it for free.
type RunTrace = {
  workspaceDir: string;
  command: string | null;
  engine: string;
  model?: string;
  startedAt: Date;
  outputs: Set<string>;
};

export function registerChatHandlers(ipc: IpcMain, getWin: () => BrowserWindow | null): void {
  const sessions = new Map<string, ChatSessionHandle>();
  // Monotonic per-task generation: a resume after a renderer reload REPLACES the
  // stale live session (which the reloaded window can no longer render), and the
  // old session's late events are dropped instead of clobbering the new one.
  const generations = new Map<string, number>();
  const runs = new Map<string, RunTrace>(); // sessionId → in-flight workflow run

  // Per-session context so send() can start traces for later chat turns.
  const sessionMeta = new Map<string, { cwd: string; agent?: EngineId; model?: string }>();

  const beginRunTrace = (sessionId: string, cwd: string, text: string, agent?: EngineId, model?: string) => {
    const command = text.trim().match(/^\/([\w-]+)/)?.[1] ?? null;
    // Every project gets run records — CWF workspaces in knowledge/, everything
    // else in the machine-local .concourse/ overlay (see runRecordRoot).
    // Plain chats are traced too, but only settle to disk when they wrote
    // files (see settleRunTrace) — Q&A turns leave no record.
    runs.set(sessionId, {
      workspaceDir: cwd,
      command,
      engine: resolveChatAgent(agent ?? null),
      model,
      startedAt: new Date(),
      outputs: new Set(),
    });
  };

  const settleRunTrace = (sessionId: string, status: "completed" | "error" | "stopped") => {
    const run = runs.get(sessionId);
    if (!run) return;
    runs.delete(sessionId);
    if (!run.command && run.outputs.size === 0) return; // chat turn, nothing written
    try {
      recordRun({
        workspaceDir: run.workspaceDir,
        command: run.command,
        engine: run.engine,
        model: run.model,
        startedAt: run.startedAt,
        finishedAt: new Date(),
        outputs: [...run.outputs].sort(),
        status,
      });
    } catch (e) {
      log.warn("[chat] run record write failed", e);
    }
  };

  const observeForRunTrace = (sessionId: string, event: ChatEvent) => {
    const run = runs.get(sessionId);
    if (!run) return;
    if (event.kind === "item" && event.item.type === "tool") {
      const name = event.item.name ?? "";
      if (/^(Write|Edit|MultiEdit|write_file)$/.test(name)) {
        const rel = outputPathFromToolSummary(event.item.summary ?? "", run.workspaceDir);
        if (rel) run.outputs.add(rel);
      }
    } else if (event.kind === "status") {
      if (event.status === "awaiting-input") settleRunTrace(sessionId, "completed");
      else if (event.status === "ended") settleRunTrace(sessionId, "stopped");
      else if (event.status === "error") settleRunTrace(sessionId, "error");
    }
  };

  const emitToWindow = (event: ChatEvent) => {
    const win = getWin();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(IPC.chatEvent, event);
  };

  safeHandle(
    IPC.chatStart,
    (_e, req: ChatStartRequest) => {
      const existing = sessions.get(req.sessionId);
      if (existing) {
        // Duplicate fresh-start (e.g. double-fire) stays a no-op; a resume means
        // the renderer reloaded and lost its transcript — restart with replay.
        if (!req.resume) return { ok: true };
        try {
          existing.stop();
        } catch {
          /* ignore */
        }
        sessions.delete(req.sessionId);
      }
      const gen = (generations.get(req.sessionId) ?? 0) + 1;
      generations.set(req.sessionId, gen);
      sessionMeta.set(req.sessionId, { cwd: req.cwd, agent: req.agent, model: req.model });
      if (req.initialText.trim()) beginRunTrace(req.sessionId, req.cwd, req.initialText, req.agent, req.model);
      const provider = getChatProvider(req.agent);
      const handle = provider.start(
        {
          sessionId: req.sessionId,
          cwd: req.cwd,
          initialText: req.initialText,
          providerSessionId: req.providerSessionId,
          resume: req.resume,
          autoApproveWrites: req.autoApproveWrites,
          dangerouslySkipApprovals: req.dangerouslySkipApprovals,
          model: req.model,
          baseUrl: req.baseUrl,
        },
        (event) => {
          // Drop events from a replaced (stale) session.
          if (generations.get(req.sessionId) !== gen) return;
          observeForRunTrace(req.sessionId, event);
          // Terminal statuses end the adapter's run loop — drop the handle so a
          // later chatStart for the same task id can begin a fresh session.
          if (event.kind === "status" && (event.status === "ended" || event.status === "error")) {
            sessions.delete(req.sessionId);
          }
          emitToWindow(event);
        },
      );
      sessions.set(req.sessionId, handle);
      return { ok: true };
    },
    ipc,
  );

  safeHandle(
    IPC.chatSend,
    (_e, { sessionId, text }: { sessionId: string; text: string }) => {
      const s = sessions.get(sessionId);
      if (!s) return { ok: false };
      // Later turns get their own trace so a chat that writes files leaves a
      // run record even when the conversation started as plain Q&A.
      const meta = sessionMeta.get(sessionId);
      if (!runs.has(sessionId) && meta) {
        beginRunTrace(sessionId, meta.cwd, text, meta.agent, meta.model);
      }
      // The renderer store already appends the user's bubble optimistically
      // (chat-store.send) — the adapter must not echo it back.
      s.send(text);
      return { ok: true };
    },
    ipc,
  );

  safeHandle(
    IPC.chatSetModel,
    (_e, { sessionId, model }: { sessionId: string; model?: string }) => {
      const s = sessions.get(sessionId);
      // Optional capability: only stateless engines (direct) implement it.
      if (!s?.setModel) return { ok: false };
      s.setModel(model);
      return { ok: true };
    },
    ipc,
  );

  safeHandle(
    IPC.chatSetSkipApprovals,
    (_e, { sessionId, value }: { sessionId: string; value: boolean }) => {
      const s = sessions.get(sessionId);
      if (!s?.setSkipApprovals) return { ok: false };
      s.setSkipApprovals(value);
      return { ok: true };
    },
    ipc,
  );

  safeHandle(
    IPC.chatRespondPermission,
    (_e, { sessionId, requestId, allow }: { sessionId: string; requestId: string; allow: boolean }) => {
      sessions.get(sessionId)?.respondPermission(requestId, allow);
      return { ok: true };
    },
    ipc,
  );

  safeHandle(
    IPC.chatStop,
    (_e, { sessionId }: { sessionId: string }) => {
      const s = sessions.get(sessionId);
      if (s) {
        s.stop();
        sessions.delete(sessionId);
      }
      settleRunTrace(sessionId, "stopped");
      return { ok: true };
    },
    ipc,
  );
}
