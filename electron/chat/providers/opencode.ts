import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import log from "electron-log/main";
import type { ChatEvent } from "../../../src/shared/chat";
import { decideAction } from "../../../src/domain/policy/action-policy";
import { projectClaudeWorkspace } from "../../../src/domain/workspace/projectors/claude";
import { classifyClaudeTool } from "./claude-tools";
import type { ChatProvider, ChatSessionHandle, ChatStartOptions } from "../provider";

// OpenCode harness adapter (plan §M6, first vendor harness): drives a single
// headless `opencode serve` instance over its HTTP API. One global server;
// every call carries ?directory=<workspace> so sessions are workspace-scoped.
// Chosen first among the vendor harnesses because it has FULL approval
// fidelity: permission.asked events + a reply endpoint, mapped to the same
// Approve/Deny cards as Claude. OpenCode reads AGENTS.md + .opencode/command
// (emitted by the projector for CWF workspaces), so the same files drive it.

const PORT = 42817;
const BASE = `http://127.0.0.1:${PORT}`;

let serverProc: ChildProcess | null = null;
let serverReady: Promise<boolean> | null = null;

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/global/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ensure one opencode server is running (reuses an existing one on the port). */
export function ensureOpencodeServer(): Promise<boolean> {
  if (serverReady) return serverReady;
  serverReady = (async () => {
    if (await healthy()) return true;
    try {
      serverProc = spawn("opencode", ["serve", "--port", String(PORT)], {
        stdio: "ignore",
        detached: false,
      });
      serverProc.on("exit", () => {
        serverProc = null;
        serverReady = null; // allow respawn on next use
      });
    } catch (e) {
      log.error("[opencode] spawn failed", e);
      serverReady = null;
      return false;
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await healthy()) return true;
    }
    serverReady = null;
    return false;
  })();
  return serverReady;
}

async function api<T>(
  method: string,
  path: string,
  directory: string,
  body?: unknown,
): Promise<T> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}directory=${encodeURIComponent(directory)}`;
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`opencode ${method} ${path}: ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

/** Models for the ModelCatalog: every authenticated provider's models, encoded
 *  as "providerID/modelID" so one string round-trips through the picker. */
export async function listOpencodeModels(): Promise<Array<{ id: string; label: string }>> {
  if (!(await ensureOpencodeServer())) return [];
  try {
    const data = await api<{ providers: Array<{ id: string; models: Record<string, { name?: string }> }> }>(
      "GET",
      "/config/providers",
      process.cwd(),
    );
    const out: Array<{ id: string; label: string }> = [];
    for (const p of data.providers ?? []) {
      for (const [modelId, m] of Object.entries(p.models ?? {})) {
        out.push({ id: `${p.id}/${modelId}`, label: `${p.id} · ${m?.name || modelId}` });
      }
    }
    return out.slice(0, 60);
  } catch (e) {
    log.warn("[opencode] model listing failed", e);
    return [];
  }
}

export const opencodeChatProvider: ChatProvider = {
  id: "opencode",

  start(opts: ChatStartOptions, emit: (event: ChatEvent) => void): ChatSessionHandle {
    const sid = opts.sessionId;
    const dir = opts.cwd;
    let ocSessionId: string | null = null;
    let stopped = false;
    let sseAbort = new AbortController();
    const emittedParts = new Set<string>(); // part ids already rendered
    const backlog: string[] = [];
    let ready = false;

    const fail = (detail: string) => emit({ kind: "status", sessionId: sid, status: "error", detail });

    const sendPrompt = async (text: string) => {
      if (!ocSessionId) return;
      emit({ kind: "status", sessionId: sid, status: "running" });
      const model = opts.model?.includes("/")
        ? { providerID: opts.model.slice(0, opts.model.indexOf("/")), modelID: opts.model.slice(opts.model.indexOf("/") + 1) }
        : undefined;
      await api("POST", `/session/${ocSessionId}/prompt_async`, dir, {
        parts: [{ type: "text", text }],
        ...(model ? { model } : {}),
      });
    };

    const handleEvent = async (ev: any) => {
      const props = ev?.properties ?? {};
      if (ev.type === "message.part.updated") {
        const part = props.part;
        if (!part || part.sessionID !== ocSessionId) return;
        if (part.type === "text" && !part.synthetic) {
          // Emit once, when the part finishes (parts stream deltas until time.end).
          if (part.time?.end && !emittedParts.has(part.id) && part.text?.trim()) {
            emittedParts.add(part.id);
            emit({ kind: "item", sessionId: sid, item: { id: part.id, type: "assistant", text: part.text } });
          } else if (!part.time?.end) {
            emit({ kind: "activity", sessionId: sid, label: "writing a response" });
          }
        } else if (part.type === "tool") {
          const toolName = String(part.tool ?? "tool");
          if (part.state?.status === "running" && !emittedParts.has(part.id)) {
            emittedParts.add(part.id);
            emit({
              kind: "item",
              sessionId: sid,
              item: { id: part.id, type: "tool", name: toolName, summary: `Use ${toolName}` },
            });
            emit({ kind: "activity", sessionId: sid, label: `using ${toolName}` });
          }
        }
      } else if (ev.type === "permission.asked") {
        const req = props;
        if (req.sessionID !== ocSessionId) return;
        const toolName = String(req.tool ?? req.permission ?? "action");
        // Same policy split as Claude: reads flow, writes/exec gate. OpenCode
        // only asks for things ITS ruleset gates, so most asks are write-class.
        const decision = decideAction(classifyClaudeTool(toolName), {
          autoApproveWrites: opts.autoApproveWrites,
        });
        if (decision === "allow") {
          await api("POST", `/session/${ocSessionId}/permissions/${req.id}`, dir, { response: "once" }).catch(() => {});
          return;
        }
        const patterns = Array.isArray(req.patterns) && req.patterns.length ? ` — ${req.patterns.join(", ")}` : "";
        emit({
          kind: "permission",
          sessionId: sid,
          permission: { requestId: req.id, toolName, summary: `${toolName}${patterns}` },
        });
        emit({ kind: "status", sessionId: sid, status: "awaiting-permission" });
      } else if (ev.type === "session.idle") {
        if (props.sessionID === ocSessionId) {
          emit({ kind: "status", sessionId: sid, status: "awaiting-input" });
        }
      } else if (ev.type === "session.error") {
        if (props.sessionID === ocSessionId) {
          const msg = props.error?.data?.message ?? props.error?.name ?? "OpenCode session error";
          fail(String(msg));
        }
      }
    };

    // Minimal SSE reader over fetch (each event is a "data: {json}" line).
    const streamEvents = async () => {
      const url = `${BASE}/event?directory=${encodeURIComponent(dir)}`;
      const res = await fetch(url, { signal: sseAbort.signal });
      if (!res.ok || !res.body) throw new Error(`event stream: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = chunk
            .split("\n")
            .filter((l) => l.startsWith("data: "))
            .map((l) => l.slice(6))
            .join("");
          if (!data) continue;
          try {
            await handleEvent(JSON.parse(data));
          } catch (e) {
            log.warn("[opencode] event handling failed", e);
          }
        }
      }
    };

    const run = async () => {
      emit({ kind: "status", sessionId: sid, status: "starting" });
      // CWF workspaces: refresh AGENTS.md + .opencode/command from the source
      // files (hash-skipped) so OpenCode executes the same workspace contract.
      try {
        projectClaudeWorkspace(dir);
      } catch (e) {
        log.warn("[opencode] projection failed", e);
      }
      if (!(await ensureOpencodeServer())) {
        return fail("Could not start the OpenCode server. Is `opencode` installed and logged in (`opencode auth`)?");
      }
      if (opts.resume) {
        emit({
          kind: "item",
          sessionId: sid,
          item: { id: randomUUID(), type: "notice", text: "OpenCode sessions don't support resume yet — starting fresh." },
        });
      }
      try {
        const session = await api<{ id: string }>("POST", "/session", dir, { title: `Concourse ${sid}` });
        ocSessionId = session.id;
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
      void streamEvents().catch((e) => {
        if (!stopped) log.warn("[opencode] event stream ended", e);
      });
      ready = true;
      try {
        if (opts.initialText.trim()) await sendPrompt(opts.initialText);
        else emit({ kind: "status", sessionId: sid, status: "awaiting-input" });
        for (const queued of backlog.splice(0)) await sendPrompt(queued);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    };

    void run();

    return {
      send(text: string) {
        if (!ready) {
          backlog.push(text);
          return;
        }
        void sendPrompt(text).catch((e) => fail(e instanceof Error ? e.message : String(e)));
      },
      respondPermission(requestId: string, allow: boolean) {
        if (!ocSessionId) return;
        emit({ kind: "status", sessionId: sid, status: "running" });
        void api("POST", `/session/${ocSessionId}/permissions/${requestId}`, dir, {
          response: allow ? "once" : "reject",
        }).catch((e) => log.warn("[opencode] permission reply failed", e));
      },
      stop() {
        stopped = true;
        sseAbort.abort();
        if (ocSessionId) {
          void api("POST", `/session/${ocSessionId}/abort`, dir).catch(() => {});
        }
        emit({ kind: "status", sessionId: sid, status: "ended" });
      },
    };
  },
};
