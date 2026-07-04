import { randomUUID } from "node:crypto";
import log from "electron-log/main";
import type { ChatEvent } from "../../../src/shared/chat";
import { projectClaudeWorkspace } from "../../../src/domain/workspace/projectors/claude";
import { runJsonlTurn, type JsonlTurn } from "./jsonl-cli";
import type { ChatProvider, ChatSessionHandle, ChatStartOptions } from "../provider";

// Cursor harness adapter (plan §M6): `cursor-agent -p --output-format
// stream-json` per turn; multi-turn via `--resume <chatId>` (chat id from the
// init event). Approvals are COARSE like Codex — headless cursor-agent applies
// its own permission config with no per-tool ask, stated up front honestly.

export const cursorChatProvider: ChatProvider = {
  id: "cursor-cli",

  start(opts: ChatStartOptions, emit: (event: ChatEvent) => void): ChatSessionHandle {
    const sid = opts.sessionId;
    let chatId: string | null = null;
    let current: JsonlTurn | null = null;
    let busy = false;
    let stopped = false;
    const backlog: string[] = [];

    const fail = (detail: string) => emit({ kind: "status", sessionId: sid, status: "error", detail });

    const handleEvent = (ev: any) => {
      if (ev?.type === "system" && ev.subtype === "init") {
        if (ev.chat_id || ev.session_id) chatId = String(ev.chat_id ?? ev.session_id);
      } else if (ev?.type === "assistant") {
        const content = ev.message?.content;
        const text = Array.isArray(content)
          ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
          : typeof content === "string"
            ? content
            : "";
        if (text.trim()) {
          emit({ kind: "item", sessionId: sid, item: { id: randomUUID(), type: "assistant", text } });
        }
      } else if (ev?.type === "tool_call") {
        const name = String(ev.tool_call?.name ?? ev.name ?? "tool");
        if (ev.subtype === "started" || !ev.subtype) {
          emit({
            kind: "item",
            sessionId: sid,
            item: { id: randomUUID(), type: "tool", name, summary: `Use ${name}` },
          });
          emit({ kind: "activity", sessionId: sid, label: `using ${name}` });
        }
      } else if (ev?.type === "result") {
        if (ev.is_error) fail(String(ev.result ?? "Cursor error"));
      }
    };

    const runTurn = (text: string) => {
      busy = true;
      emit({ kind: "status", sessionId: sid, status: "running" });
      const args = ["-p", text, "--output-format", "stream-json"];
      if (opts.model) args.push("--model", opts.model);
      if (chatId) args.push("--resume", chatId);
      current = runJsonlTurn("cursor-agent", args, opts.cwd, handleEvent, (line) =>
        log.warn("[cursor]", line.trim()),
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
      emit({
        kind: "item",
        sessionId: sid,
        item: {
          id: randomUUID(),
          type: "notice",
          text: "Cursor runs with pre-set permissions — it applies its own permission config without asking per action.",
        },
      });
      if (opts.resume) {
        emit({
          kind: "item",
          sessionId: sid,
          item: { id: randomUUID(), type: "notice", text: "Cursor sessions don't support resume across app restarts yet — starting fresh." },
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
        /* coarse approvals */
      },
      stop() {
        stopped = true;
        current?.kill();
        emit({ kind: "status", sessionId: sid, status: "ended" });
      },
    };
  },
};
