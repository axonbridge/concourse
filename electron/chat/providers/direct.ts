import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import log from "electron-log/main";
import type { ChatEvent } from "../../../src/shared/chat";
import { decideAction, type ActionClass } from "../../../src/domain/policy/action-policy";
import { loadWorkspace } from "../../../src/domain/workspace/fs-loader";
import type { CwfWorkspace } from "../../../src/domain/workspace/types";
import { getCredential } from "../../credentials/store";
import { ensureOrgKnowledge, orgKnowledgePrompt } from "../../knowledge/org-store";
import { workspaceTools, callWorkspaceTool, type McpTool } from "../../mcp/client";
import { classifyClaudeTool } from "./claude-tools";
import type { DirectProvider } from "../../../src/shared/ai-providers";
import type { ChatProvider, ChatSessionHandle, ChatStartOptions } from "../provider";

// The Direct engine (plan §M3, hermes-style): OUR agent loop over any
// OpenAI-compatible /chat/completions endpoint. No vendor harness — the
// workspace files ARE the instructions (CWF bootstraps from workspace.md), and
// a small workspace-scoped ToolBroker gives the model read/write file access
// gated by the same domain ActionPolicy the Claude adapter uses. One adapter
// serves all four direct providers; only endpoint + auth differ.

type EngineWire = { baseUrl: string; headers: Record<string, string>; keyError?: string };

function wireFor(engine: DirectProvider, optsBaseUrl?: string): EngineWire {
  switch (engine) {
    case "openai": {
      const key = getCredential("openai");
      return key
        ? { baseUrl: "https://api.openai.com/v1", headers: { Authorization: `Bearer ${key}` } }
        : { baseUrl: "", headers: {}, keyError: "Add an OpenAI API key in Settings → AI → Authentication." };
    }
    case "openrouter": {
      const key = getCredential("openrouter");
      return key
        ? {
            baseUrl: "https://openrouter.ai/api/v1",
            headers: {
              Authorization: `Bearer ${key}`,
              "HTTP-Referer": "https://concourse.local",
              "X-Title": "Concourse",
            },
          }
        : { baseUrl: "", headers: {}, keyError: "Add an OpenRouter API key in Settings → AI → Authentication." };
    }
    case "ollama":
      // Ollama exposes an OpenAI-compatible surface at /v1. Keyless, local.
      return { baseUrl: "http://127.0.0.1:11434/v1", headers: {} };
    case "custom": {
      const base = (optsBaseUrl ?? "").trim().replace(/\/+$/, "");
      if (!base) {
        return { baseUrl: "", headers: {}, keyError: "Set the custom endpoint URL in Settings → AI." };
      }
      const key = getCredential("custom");
      return { baseUrl: base, headers: key ? { Authorization: `Bearer ${key}` } : {} };
    }
  }
}

// ── Workspace-scoped ToolBroker v1 ──────────────────────────────────────────
// Three tools, each declaring its ActionClass; the domain policy decides
// allow/ask exactly like the Claude adapter's canUseTool.

const IGNORED_DIRS = new Set([".git", "node_modules", ".claude", ".dev-userdata", "dist", "dist-electron"]);

function safeResolve(cwd: string, rel: string): string | null {
  const p = path.resolve(cwd, rel);
  if (p === cwd || p.startsWith(cwd + path.sep)) return p;
  // Org-wide knowledge is the one sanctioned location outside the workspace —
  // the system prompt hands the model its absolute path.
  const org = ensureOrgKnowledge();
  if (p === org || p.startsWith(org + path.sep)) return p;
  return null;
}

function listFilesRec(dir: string, root: string, out: string[], depth: number): void {
  if (depth > 6 || out.length > 400) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".mcp.json") continue;
    if (IGNORED_DIRS.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) listFilesRec(abs, root, out, depth + 1);
    else out.push(path.relative(root, abs));
  }
}

type BrokerTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  action: ActionClass;
  run: (args: Record<string, unknown>, cwd: string, ctx?: { privateKnowledge?: boolean }) => string;
};

const BROKER_TOOLS: BrokerTool[] = [
  {
    name: "list_files",
    description: "List the files in the workspace (relative paths).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    action: "read",
    run: (_args, cwd) => {
      const out: string[] = [];
      listFilesRec(cwd, cwd, out, 0);
      const org = ensureOrgKnowledge();
      const orgOut: string[] = [];
      listFilesRec(org, org, orgOut, 0);
      const orgLines = orgOut.sort().map((f) => path.join(org, f));
      return (
        [...out.sort(), ...orgLines].join("\n") || "(empty workspace)"
      );
    },
  },
  {
    name: "read_file",
    description: "Read a file from the workspace by relative path.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative file path" } },
      required: ["path"],
      additionalProperties: false,
    },
    action: "read",
    run: (args, cwd) => {
      const p = safeResolve(cwd, String(args.path ?? ""));
      if (!p) return "Error: path is outside the workspace.";
      try {
        const content = fs.readFileSync(p, "utf8");
        return content.length > 60_000 ? content.slice(0, 60_000) + "\n…(truncated)" : content;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file in the workspace (relative path). Use for outputs like summaries.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    action: "write",
    run: (args, cwd, ctx) => {
      const p = safeResolve(cwd, String(args.path ?? ""));
      if (!p) return "Error: path is outside the workspace.";
      // Private project: org knowledge is read-only — save locally instead.
      if (ctx?.privateKnowledge) {
        const org = ensureOrgKnowledge();
        if (p === org || p.startsWith(org + path.sep)) {
          return "Error: this is a private project — org knowledge is read-only. Save to this project's own knowledge (mark org-candidate: true if it belongs org-wide).";
        }
      }
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, String(args.content ?? ""), "utf8");
        return `Wrote ${String(args.path)}`;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },
];

const OPENAI_TOOLS = BROKER_TOOLS.map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

// ── System prompt: files are the contract ───────────────────────────────────

function buildSystemPrompt(cwd: string, initialText: string, mcpServers: string[], privateKnowledge = false): string {
  const parts: string[] = [
    "You are Concourse, an AI workspace assistant for a business team.",
    "The workspace is a set of markdown files (commands, agents, skills, templates) — they are your instructions. Use the file tools to read anything you need; write outputs into the workspace with write_file.",
    "Cite sources for factual claims; never invent numbers. If you can't do something (no integration available), say so plainly.",
  ];
  // Load CWF content even without a workspace.md — a classic repo may still
  // carry provider-neutral commands/agents/skills (loadWorkspace tolerates a
  // missing entry file; the dirs just come back empty when absent).
  let ws: CwfWorkspace | null = null;
  try {
    ws = loadWorkspace(cwd);
  } catch (e) {
    log.warn("[direct] workspace load failed", e);
  }
  if (ws?.workspace) {
    parts.push("## Workspace\n\n" + ws.workspace.body.trim());
  }
  if (ws && ws.commands.length) {
    parts.push(
      "## Commands\n\n" +
        ws.commands.map((c) => `- /${c.slug} — ${c.description || c.title}`).join("\n"),
    );
  }
  // Slash-command invocation: inline the command body and everything it owns —
  // the light WorkflowResolution (no sub-agent semantics on the direct engine;
  // owned agents are folded into the instructions).
  const slash = initialText.trim().match(/^\/([\w-]+)/)?.[1];
  const cmd = slash ? ws?.commands.find((c) => c.slug === slash) : undefined;
  if (ws && cmd) {
    parts.push(`## Active command: /${cmd.slug}\n\n${cmd.body.trim()}`);
    for (const slug of cmd.owns.agents) {
      const agent = ws.agents.find((a) => a.slug === slug);
      if (agent) parts.push(`## Sub-agent instructions: ${slug}\n\n(You perform this role yourself.)\n\n${agent.body.trim()}`);
    }
    for (const slug of cmd.owns.skills) {
      const skill = ws.skills.find((s) => s.slug === slug);
      if (skill) parts.push(`## Skill: ${slug}\n\n${skill.body.trim()}`);
    }
    if (cmd.template) {
      const tpl = ws.templates.find((t) => t.slug === cmd.template);
      if (tpl) parts.push(`## Output template\n\n${tpl.body.trim()}`);
    }
  }
  parts.push(orgKnowledgePrompt());
  if (privateKnowledge) {
    parts.push(
      "PRIVATE PROJECT: org knowledge is READ-ONLY here — use and cite org facts freely, but never write to the org folder (writes there are rejected). Save all durable learnings to this project's own knowledge; mark org-wide candidates with org-candidate: true.",
    );
  }
  parts.push(
    mcpServers.length
      ? `Connected integrations (via mcp__<server>__<tool> tools): ${mcpServers.join(", ")}. Use them for live data; never fabricate what a tool can fetch.`
      : "Note: no external integrations are connected on this engine — workflows needing live data (Jira, Confluence, web) should say so instead of fabricating it.",
  );
  return parts.join("\n\n");
}

// ── The engine ───────────────────────────────────────────────────────────────

type WireMessage = Record<string, unknown>;

export function directChatProvider(engine: DirectProvider): ChatProvider {
  return {
    id: engine,

    start(opts: ChatStartOptions, emit: (event: ChatEvent) => void): ChatSessionHandle {
      const sid = opts.sessionId;
      const abort = new AbortController();
      const pendingPermissions = new Map<string, (allow: boolean) => void>();
      let stopped = false;
      let busy = false;
      const backlog: string[] = [];

      const wire = wireFor(engine, opts.baseUrl);
      let model = opts.model?.trim();
      // Durable transcript for resume: the direct engine is stateless per
      // request, so the message array IS the session — persist it per
      // providerSessionId and reload on resume.
      const transcriptPath = opts.providerSessionId
        ? path.join(app.getPath("userData"), "direct-chats", `${opts.providerSessionId}.json`)
        : null;
      const saveTranscript = () => {
        if (!transcriptPath) return;
        try {
          fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
          fs.writeFileSync(transcriptPath, JSON.stringify(messages.slice(1)), "utf8");
        } catch (e) {
          log.warn("[direct] transcript save failed", e);
        }
      };
      // Workspace MCP tools (in-app client; only authed servers contribute).
      // Resolved before the first turn; empty when nothing is connected.
      let mcpTools: McpTool[] = [];
      let wireTools: Array<Record<string, unknown>> = [...OPENAI_TOOLS];
      const messages: WireMessage[] = [{ role: "system", content: "" }];
      const primeContext = async () => {
        try {
          mcpTools = await workspaceTools(opts.cwd);
        } catch (e) {
          log.warn("[direct] mcp tool listing failed", e);
        }
        wireTools = [
          ...OPENAI_TOOLS,
          ...mcpTools.map((t) => ({
            type: "function" as const,
            function: { name: t.id, description: t.description, parameters: t.inputSchema },
          })),
        ];
        messages[0] = {
          role: "system",
          content: buildSystemPrompt(
            opts.cwd,
            opts.initialText,
            [...new Set(mcpTools.map((t) => t.server))],
            opts.privateKnowledge ?? false,
          ),
        };
      };

      const fail = (detail: string) => {
        emit({ kind: "status", sessionId: sid, status: "error", detail });
      };

      const askPermission = async (toolName: string, summary: string): Promise<boolean> => {
        const requestId = randomUUID();
        emit({ kind: "permission", sessionId: sid, permission: { requestId, toolName, summary } });
        emit({ kind: "status", sessionId: sid, status: "awaiting-permission" });
        const allow = await new Promise<boolean>((resolve) => pendingPermissions.set(requestId, resolve));
        pendingPermissions.delete(requestId);
        emit({ kind: "status", sessionId: sid, status: "running" });
        return allow;
      };

      // Streaming completion: emits text deltas live and reassembles the full
      // message (content + tool_calls) from the chunk stream.
      const completeOnce = async (): Promise<any> => {
        const res = await fetch(`${wire.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...wire.headers },
          body: JSON.stringify({ model, messages, tools: wireTools, stream: true }),
          signal: abort.signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`);
        }
        if (!res.body) throw new Error("Empty response stream.");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let content = "";
        const toolCalls: any[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            let chunk: any;
            try {
              chunk = JSON.parse(data);
            } catch {
              continue;
            }
            const delta = chunk?.choices?.[0]?.delta;
            if (!delta) continue;
            if (typeof delta.content === "string" && delta.content) {
              content += delta.content;
              emit({ kind: "delta", sessionId: sid, text: delta.content });
            }
            for (const tc of delta.tool_calls ?? []) {
              const i = tc.index ?? 0;
              toolCalls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
              if (tc.id) toolCalls[i].id = tc.id;
              if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
            }
          }
        }
        const message: any = { role: "assistant", content: content || null };
        if (toolCalls.length) message.tool_calls = toolCalls.filter(Boolean);
        return { choices: [{ message }] };
      };

      // One user turn: call the model, run tool rounds until it answers in text.
      const runTurn = async (): Promise<void> => {
        for (let round = 0; round < 24; round++) {
          if (stopped) return;
          emit({ kind: "activity", sessionId: sid, label: "thinking" });
          const data = await completeOnce();
          const msg = data?.choices?.[0]?.message;
          if (!msg) throw new Error("Empty response from the model.");
          messages.push(msg);

          const toolCalls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
          if (msg.content && String(msg.content).trim()) {
            emit({
              kind: "item",
              sessionId: sid,
              item: { id: randomUUID(), type: "assistant", text: String(msg.content) },
            });
          }
          if (!toolCalls.length) return;

          for (const call of toolCalls) {
            const name = String(call?.function?.name ?? "");
            const broker = BROKER_TOOLS.find((t) => t.name === name);
            const mcp = broker ? undefined : mcpTools.find((t) => t.id === name);
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(String(call?.function?.arguments ?? "{}"));
            } catch {
              /* malformed args → tool reports error below */
            }
            const summary = broker
              ? name === "write_file"
                ? `Write ${String(args.path ?? "a file")}`
                : name === "read_file"
                  ? `Read ${String(args.path ?? "a file")}`
                  : "List workspace files"
              : mcp
                ? `Use ${mcp.server}: ${mcp.name}`
                : name;
            emit({
              kind: "item",
              sessionId: sid,
              item: { id: randomUUID(), type: "tool", name, summary },
            });
            emit({
              kind: "activity",
              sessionId: sid,
              label: broker
                ? name === "write_file"
                  ? "writing files"
                  : "reading workspace files"
                : mcp
                  ? `using ${mcp.server} · ${mcp.name}`
                  : "working",
            });

            let result: string;
            if (broker) {
              const decision = decideAction(broker.action, {
                autoApproveWrites: opts.autoApproveWrites,
                dangerouslySkipApprovals: opts.dangerouslySkipApprovals,
              });
              const allowed = decision === "allow" ? true : await askPermission(name, summary);
              result = allowed ? broker.run(args, opts.cwd, { privateKnowledge: opts.privateKnowledge }) : "The user denied this action.";
            } else if (mcp) {
              // Same read/write heuristic the Claude adapter applies to
              // mcp__server__tool names — reads flow, writes gate.
              const decision = decideAction(classifyClaudeTool(name), {
                autoApproveWrites: opts.autoApproveWrites,
              });
              const allowed = decision === "allow" ? true : await askPermission(name, summary);
              try {
                result = allowed
                  ? await callWorkspaceTool(opts.cwd, name, args)
                  : "The user denied this action.";
              } catch (e) {
                result = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
              }
            } else {
              result = `Error: unknown tool "${name}".`;
            }
            messages.push({ role: "tool", tool_call_id: String(call?.id ?? ""), content: result });
          }
        }
        throw new Error("Tool loop exceeded 24 rounds — stopping for safety.");
      };

      const process = async (text: string): Promise<void> => {
        busy = true;
        emit({ kind: "status", sessionId: sid, status: "running" });
        await contextReady; // system prompt + MCP tools resolved before turn 1
        messages.push({ role: "user", content: text });
        try {
          await runTurn();
          saveTranscript();
          emit({ kind: "status", sessionId: sid, status: "awaiting-input" });
        } catch (e) {
          if (stopped || abort.signal.aborted) {
            emit({ kind: "status", sessionId: sid, status: "ended" });
          } else {
            log.error(`[direct:${engine}] turn failed`, e);
            fail(e instanceof Error ? e.message : String(e));
          }
        } finally {
          busy = false;
          const next = backlog.shift();
          if (next !== undefined && !stopped) void process(next);
        }
      };

      // Startup validation happens after returning the handle (the port is
      // synchronous-returning): missing key/model surfaces as a chat error.
      let contextReady: Promise<void> = Promise.resolve();
      queueMicrotask(() => {
        if (wire.keyError) return fail(wire.keyError);
        if (!model) return fail("Pick a model for this session first (chat input bar).");
        emit({ kind: "status", sessionId: sid, status: "starting" });
        contextReady = primeContext();
        if (opts.resume && transcriptPath) {
          try {
            const saved = JSON.parse(fs.readFileSync(transcriptPath, "utf8")) as WireMessage[];
            messages.push(...saved);
            for (const m of saved) {
              const role = m.role as string;
              const text = typeof m.content === "string" ? m.content : "";
              if (!text.trim()) continue;
              if (role === "user") {
                emit({ kind: "item", sessionId: sid, item: { id: randomUUID(), type: "user", text } });
              } else if (role === "assistant") {
                emit({ kind: "item", sessionId: sid, item: { id: randomUUID(), type: "assistant", text } });
              }
            }
          } catch {
            /* no saved transcript — fresh start */
          }
        }
        if (opts.initialText.trim()) void process(opts.initialText);
        else {
          void contextReady.then(() => {
            if (!stopped) emit({ kind: "status", sessionId: sid, status: "awaiting-input" });
          });
        }
      });

      return {
        send(text: string) {
          if (busy) backlog.push(text);
          else void process(text);
        },
        respondPermission(requestId: string, allow: boolean) {
          pendingPermissions.get(requestId)?.(allow);
        },
        // Stateless per request — the next completion simply uses the new model.
        setModel(next: string | undefined) {
          model = next?.trim() || undefined;
        },
        stop() {
          stopped = true;
          try {
            abort.abort();
          } catch {
            /* ignore */
          }
          for (const resolve of pendingPermissions.values()) resolve(false);
          emit({ kind: "status", sessionId: sid, status: "ended" });
        },
      };
    },
  };
}
