import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import log from "electron-log/main";
import type { ChatEvent } from "../../../src/shared/chat";
import { projectClaudeWorkspace } from "../../../src/domain/workspace/projectors/claude";
import { inlineSlashCommand } from "../../../src/domain/workspace/inline-command";
import { runJsonlTurn, type JsonlTurn } from "./jsonl-cli";
import type { ChatProvider, ChatSessionHandle, ChatStartOptions } from "../provider";

// Codex harness adapter (plan §M6): one `codex exec --json` process per turn,
// multi-turn via `codex exec resume <threadId>`. Approvals are COARSE by
// design — headless Codex runs inside its workspace sandbox with no per-tool
// ask, so we say so up front (honest labeling) instead of pretending cards
// exist. Reads AGENTS.md (projected from workspace.md for CWF workspaces).
// Codex has no slash-command mechanism, so /commands are resolved by the app
// from the CWF source and inlined into the turn (inlineSlashCommand).

// A slash-command turn was sent to Codex as the full inlined instructions —
// on replay show what the user actually typed, not the expanded body.
function displayUserText(text: string): string {
  if (!text.startsWith("Follow this command's instructions")) return text;
  const parts = text.split("## User request\n\n");
  if (parts.length > 1) return parts[parts.length - 1]!.trim();
  const slug = text.match(/\(\/([\w-]+)\)/)?.[1];
  return slug ? `/${slug}` : text.slice(0, 200);
}

/** Rebuild the visible transcript from Codex's local rollout file
 *  (~/.codex/sessions/**\/rollout-…-<threadId>.jsonl). Best-effort: a missing
 *  or unparseable file just means the chat reopens without history. */
function replayCodexTranscript(
  threadId: string,
  sid: string,
  emit: (event: ChatEvent) => void,
): void {
  try {
    const root = path.join(os.homedir(), ".codex", "sessions");
    const entries = fs.readdirSync(root, { recursive: true }) as string[];
    const rel = entries.find((e) => String(e).endsWith(`${threadId}.jsonl`));
    if (!rel) return;
    for (const line of fs.readFileSync(path.join(root, String(rel)), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let d: any;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (d?.type !== "response_item") continue;
      const payload = d.payload ?? {};
      if (payload.type !== "message") continue;
      const role = payload.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = (payload.content ?? [])
        .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
        .join("")
        .trim();
      if (!text) continue;
      // Skip injected context (permissions, environment, AGENTS.md payloads).
      if (role === "user" && /^</.test(text)) continue;
      emit({
        kind: "item",
        sessionId: sid,
        item: {
          id: randomUUID(),
          type: role === "user" ? "user" : "assistant",
          text: role === "user" ? displayUserText(text) : text,
        },
      });
    }
  } catch {
    /* best-effort */
  }
}

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
        // Report the vendor thread id so the app persists it on the task —
        // reopening this chat later resumes via `codex exec resume <id>`.
        emit({ kind: "provider-session", sessionId: sid, providerSessionId: threadId });
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
        // Newer Codex CLIs emit "agent_message"; older ones "assistant_message".
        if ((t === "assistant_message" || t === "agent_message") && item.text?.trim()) {
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

    // Codex can't "see" images by reading files — they must ride the native
    // `-i/--image` flag (developers.openai.com/codex/cli/features#image-inputs).
    // Attachments are staged under .concourse/attachments/ and referenced in
    // the message text; lift the image ones into args.
    const imageArgs = (text: string): string[] => {
      const out: string[] = [];
      const re = /\.concourse\/attachments\/[^\s"'`)\]]+\.(?:png|jpe?g|gif|webp)/gi;
      for (const match of text.match(re) ?? []) {
        const abs = path.resolve(opts.cwd, match);
        if (abs.startsWith(path.resolve(opts.cwd) + path.sep) && fs.existsSync(abs)) {
          out.push("-i", abs);
        }
      }
      return out;
    };

    const runTurn = (rawText: string) => {
      busy = true;
      emit({ kind: "status", sessionId: sid, status: "running" });
      const text = inlineSlashCommand(opts.cwd, rawText);
      // `exec resume` rejects --sandbox (the thread keeps its original policy)
      // but still takes --json/-m/-i; fresh execs set the sandbox explicitly.
      const args = threadId
        ? ["exec", "resume", threadId, "--json", "--skip-git-repo-check"]
        : ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write"];
      // workspace-write protects .git by default, which breaks branch/commit
      // steps in user workflows; writable_roots re-opens it (config-reference).
      args.push("-c", 'sandbox_workspace_write.writable_roots=[".git"]');
      if (opts.model) args.push("-m", opts.model);
      args.push(...imageArgs(text));
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
      if (opts.resume && opts.providerSessionId) {
        // Transcripts live in ~/.codex/sessions; `exec resume <id>` reopens the
        // thread with prior context. Ids we persisted come from thread.started.
        threadId = opts.providerSessionId;
        replayCodexTranscript(threadId, sid, emit);
      } else if (opts.resume) {
        emit({
          kind: "item",
          sessionId: sid,
          item: { id: randomUUID(), type: "notice", text: "No saved Codex thread for this chat — starting fresh." },
        });
      }
      if (opts.initialText.trim()) {
        // Resume-with-text = the user stopped the run and typed a new prompt;
        // the replay above only covers the saved transcript, so show it.
        if (opts.resume) {
          emit({
            kind: "item",
            sessionId: sid,
            item: { id: randomUUID(), type: "user", text: opts.initialText },
          });
        }
        runTurn(opts.initialText);
      }
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
