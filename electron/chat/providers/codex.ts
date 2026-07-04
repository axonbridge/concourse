import { randomUUID } from "node:crypto";
import log from "electron-log/main";
import type { ChatEvent } from "../../../src/shared/chat";
import { projectClaudeWorkspace } from "../../../src/domain/workspace/projectors/claude";
import { runJsonlTurn, type JsonlTurn } from "./jsonl-cli";
import type { ChatProvider, ChatSessionHandle, ChatStartOptions } from "../provider";

// Codex harness adapter (plan §M6): one `codex exec --json` process per turn,
// multi-turn via `codex exec resume <threadId>`. Approvals are COARSE by
// design — headless Codex runs inside its workspace sandbox with no per-tool
// ask, so we say so up front (honest labeling) instead of pretending cards
// exist. Reads AGENTS.md (projected from workspace.md for CWF workspaces).

export const codexChatProvider: ChatProvider = {
  id: "codex",

  start(opts: ChatStartOptions, emit: (event: ChatEvent) => void): ChatSessionHandle {
    const sid = opts.sessionId;
    let threadId: string | null = null;
    let current: JsonlTurn | null = null;
    let busy = false;
    let stopped = false;
    const backlog: string[] = [];

    const fail = (detail: string) => emit({ kind: "status", sessionId: sid, status: "error", detail });

    const handleEvent = (ev: any) => {
      if (ev?.type === "thread.started" && ev.thread_id) {
        threadId = String(ev.thread_id);
      } else if (ev?.type === "item.started" || ev?.type === "item.updated") {
        const t = ev.item?.item_type ?? ev.item?.type;
        if (t === "command_execution") {
          emit({ kind: "activity", sessionId: sid, label: "running a command" });
        } else if (t === "file_change") {
          emit({ kind: "activity", sessionId: sid, label: "editing files" });
        } else if (t === "mcp_tool_call") {
          emit({ kind: "activity", sessionId: sid, label: "using an integration" });
        } else if (t === "reasoning") {
          emit({ kind: "activity", sessionId: sid, label: "thinking" });
        }
      } else if (ev?.type === "item.completed") {
        const item = ev.item ?? {};
        const t = item.item_type ?? item.type;
        if (t === "assistant_message" && item.text?.trim()) {
          emit({ kind: "item", sessionId: sid, item: { id: item.id ?? randomUUID(), type: "assistant", text: String(item.text) } });
        } else if (t === "command_execution") {
          emit({
            kind: "item",
            sessionId: sid,
            item: { id: item.id ?? randomUUID(), type: "tool", name: "Bash", summary: `Run command: ${String(item.command ?? "").slice(0, 120)}` },
          });
        } else if (t === "file_change") {
          const files = (item.changes ?? []).map((c: any) => c?.path).filter(Boolean).join(", ");
          emit({
            kind: "item",
            sessionId: sid,
            item: { id: item.id ?? randomUUID(), type: "tool", name: "Write", summary: `Edit files: ${files || "workspace files"}` },
          });
        } else if (t === "mcp_tool_call") {
          emit({
            kind: "item",
            sessionId: sid,
            item: { id: item.id ?? randomUUID(), type: "tool", name: String(item.tool ?? "mcp"), summary: `Use ${item.server ?? "integration"}: ${item.tool ?? ""}` },
          });
        }
      } else if (ev?.type === "error") {
        fail(String(ev.message ?? "Codex error"));
      }
    };

    const runTurn = (text: string) => {
      busy = true;
      emit({ kind: "status", sessionId: sid, status: "running" });
      const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write"];
      if (opts.model) args.push("-m", opts.model);
      if (threadId) args.splice(1, 0, "resume", threadId);
      args.push(text);
      current = runJsonlTurn("codex", args, opts.cwd, handleEvent, (line) =>
        log.warn("[codex]", line.trim()),
      );
      current.done
        .then(() => {
          if (!stopped) emit({ kind: "status", sessionId: sid, status: "awaiting-input" });
        })
        .catch((e) => {
          if (!stopped) fail(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          busy = false;
          current = null;
          const next = backlog.shift();
          if (next !== undefined && !stopped) runTurn(next);
        });
    };

    queueMicrotask(() => {
      emit({ kind: "status", sessionId: sid, status: "starting" });
      try {
        projectClaudeWorkspace(opts.cwd);
      } catch {
        /* non-CWF */
      }
      // Honest labeling (plan): Codex has no per-action approvals headless.
      emit({
        kind: "item",
        sessionId: sid,
        item: {
          id: randomUUID(),
          type: "notice",
          text: "Codex runs with pre-set permissions (workspace sandbox) — it can read and edit files in this workspace without asking per action. Network access stays off.",
        },
      });
      if (opts.resume) {
        emit({
          kind: "item",
          sessionId: sid,
          item: { id: randomUUID(), type: "notice", text: "Codex sessions don't support resume across app restarts yet — starting fresh." },
        });
      }
      if (opts.initialText.trim()) runTurn(opts.initialText);
      else emit({ kind: "status", sessionId: sid, status: "awaiting-input" });
    });

    return {
      send(text: string) {
        if (busy) backlog.push(text);
        else runTurn(text);
      },
      respondPermission() {
        /* coarse approvals — nothing to respond to */
      },
      stop() {
        stopped = true;
        current?.kill();
        emit({ kind: "status", sessionId: sid, status: "ended" });
      },
    };
  },
};
