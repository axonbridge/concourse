import { randomUUID } from "node:crypto";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import log from "electron-log/main";
import type { ChatEvent } from "../../../src/shared/chat";
import { decideAction } from "../../../src/domain/policy/action-policy";
import { analyzeCommandForCredentials, scrubEnv } from "../../../src/domain/policy/secret-rules";
import { projectClaudeWorkspace } from "../../../src/domain/workspace/projectors/claude";
import { getCredential } from "../../credentials/store";
import { orgKnowledgeDir, orgKnowledgePrompt } from "../../knowledge/org-store";
import { readWorkspaceMcpConfig } from "../../mcp/client";
import { readGlobalMcpConfig } from "../../mcp/global-config";
import { classifyClaudeTool, summarizePermission } from "./claude-tools";
import type { ChatProvider, ChatSessionHandle, ChatStartOptions } from "../provider";

// Claude Agent SDK adapter — the only chat-capable provider today. Wraps the
// local `claude` CLI: the user's existing login by default, or a keychain-stored
// ANTHROPIC_API_KEY from Settings→AI→Authentication when present. Reads and
// research run automatically; writes/edits/shell are gated through the in-chat
// Approve/Deny prompt via the SDK's canUseTool callback. This is the ONLY file
// that may import @anthropic-ai/claude-agent-sdk.

// The SDK is ESM-only and this file compiles to CommonJS. A plain `await
// import()` would be downleveled by tsc to require() and fail on the ESM
// package, so go through a Function so the dynamic import survives to runtime.
const importESM = new Function("s", "return import(s)") as <T = unknown>(s: string) => Promise<T>;

type SdkQuery = (args: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => AsyncIterable<any>;

// A replayed slash-command turn is stored by Claude Code as
// `<command-message>…</command-message><command-name>/ask</command-name>`.
// Render it as the friendly "/ask" instead of the raw XML; strip stray wrappers.
function cleanUserText(raw: string): string {
  if (!raw) return "";
  // Display-substituted turns (Handoff button, attachments) carry their
  // friendly label in a marker — replay shows the label, not the raw prompt.
  const display = raw.match(/<concourse-display>([\s\S]*?)<\/concourse-display>/);
  if (display) return display[1]!.trim();
  // Interrupt-steering preamble (added when the user stops a run and sends a
  // new prompt) is engine-facing only — replays show just the user's text.
  raw = raw.replace(/<concourse-interrupt-note>[\s\S]*?<\/concourse-interrupt-note>\s*/g, "");
  const name = raw.match(/<command-name>\s*\/?([^<]+?)\s*<\/command-name>/);
  if (name) {
    const args = raw.match(/<command-args>\s*([^<]*?)\s*<\/command-args>/);
    const argText = args && args[1].trim() ? ` ${args[1].trim()}` : "";
    return `/${name[1].trim().replace(/^\//, "")}${argText}`;
  }
  return raw.replace(/<\/?(command|local-command)-[a-z]+>/g, "").trim();
}

function resolveClaudeBinary(): string | undefined {
  const candidates = [
    path.join(os.homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return undefined; // let the SDK auto-detect on PATH
}

/**
 * Live Claude model discovery through the CLI's own login — no API key.
 * Spawns a throwaway SDK session just to ask `supportedModels()`, then kills
 * it. Returns whatever the user's account can actually run (new families like
 * Fable included), so nothing upstream needs a hardcoded model list. Called by
 * the ModelCatalog (cached there); returns [] on any failure so the catalog
 * falls back to the static aliases.
 */
export async function discoverClaudeModels(): Promise<Array<{ id: string; label: string }>> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 12_000);
  try {
    const mod = await importESM<{ query: SdkQuery }>("@anthropic-ai/claude-agent-sdk");
    const queue = createInputQueue(); // never fed — we only want the control channel
    const q = mod.query({
      prompt: queue,
      options: {
        cwd: os.tmpdir(),
        pathToClaudeCodeExecutable: resolveClaudeBinary(),
        abortController: abort,
        maxTurns: 1,
      },
    }) as AsyncIterable<any> & { supportedModels?: () => Promise<any[]> };
    if (typeof q.supportedModels !== "function") return [];
    const models = await q.supportedModels();
    return (models ?? [])
      .map((m) => ({ id: String(m?.value ?? ""), label: String(m?.displayName ?? m?.value ?? "") }))
      // The CLI's "default" entry duplicates the picker's built-in
      // "Model: default" option (= omit the flag) — drop it.
      .filter((m) => m.id && m.id !== "default");
  } catch (e) {
    log.warn("[chat] claude model discovery failed", e);
    return [];
  } finally {
    clearTimeout(timeout);
    try {
      abort.abort();
    } catch {
      /* ignore */
    }
  }
}

const CLAUDE_LOCAL_SENTINEL = "<!-- GENERATED by Concourse (org knowledge note) — safe to delete; recreated at session start. -->";

/** Per-session, machine-local prerequisites in the workspace. Only personal
 *  files are touched: `.claude/settings.local.json` (merge, preserving every
 *  existing key) and `CLAUDE.local.md` (sentinel-owned; a user-authored file is
 *  left alone). Git repos get local excludes so neither file shows in status. */
function ensureLocalSessionSetup(cwd: string, privateKnowledge = false): void {
  // 1. Approve the workspace's .mcp.json servers the way the CLI's own trust
  //    dialog does: projects[cwd].enabledMcpjsonServers in ~/.claude.json.
  //    (enableAllProjectMcpServers in project-local settings is NOT honored —
  //    verified empirically: the init message still reports "disabled".)
  try {
    const wanted = Object.keys(readWorkspaceMcpConfig(cwd));
    if (wanted.length) {
      const configPath = path.join(os.homedir(), ".claude.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        projects?: Record<
          string,
          {
            enabledMcpjsonServers?: string[];
            disabledMcpjsonServers?: string[];
            disabledMcpServers?: string[];
          } & Record<string, unknown>
        >;
      };
      const projects = (config.projects ??= {});
      const entry = (projects[cwd] ??= {});
      const enabled = new Set(entry.enabledMcpjsonServers ?? []);
      const missing = wanted.filter((s) => !enabled.has(s));
      // A server the workspace declares must not stay project-disabled either —
      // pivot-health-js had a stray disabledMcpServers: ["atlassian"] that
      // silently killed the tools in every session there.
      const undisable = (list?: string[]) => list?.filter((s) => !wanted.includes(s));
      const nextDisabledUser = undisable(entry.disabledMcpServers);
      const nextDisabledJson = undisable(entry.disabledMcpjsonServers);
      const changed =
        missing.length > 0 ||
        (nextDisabledUser?.length ?? 0) !== (entry.disabledMcpServers?.length ?? 0) ||
        (nextDisabledJson?.length ?? 0) !== (entry.disabledMcpjsonServers?.length ?? 0);
      if (changed) {
        entry.enabledMcpjsonServers = [...enabled, ...missing];
        if (nextDisabledUser) entry.disabledMcpServers = nextDisabledUser;
        if (nextDisabledJson) entry.disabledMcpjsonServers = nextDisabledJson;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
      }
    }
  } catch (e) {
    log.warn("[chat] could not approve project mcp servers", e);
  }

  // 2. Org-knowledge note where SUB-AGENTS can see it (they read CLAUDE.md
  //    context but not the main session's system prompt).
  const localMd = path.join(cwd, "CLAUDE.local.md");
  const isCwfWs = fs.existsSync(path.join(cwd, "workspace.md"));
  const overlayNote = isCwfWs
    ? ""
    : `\n\n## Machine-local overlay\n\nThis repo's Concourse layer lives in \`.concourse/\` (locally git-excluded): repo-scoped facts in \`.concourse/knowledge/facts/\`, conversational notes (meetings, 1:1s, decisions) in \`.concourse/knowledge/notes/\`, deliverables — documents and assets of ANY kind — in \`.concourse/outputs/<command>/\` (ad-hoc chat work: \`.concourse/outputs/<topic>/\`), written there directly without asking where or whether to save. Never write outputs to the repo root.\n`;
  const privateNote = privateKnowledge
    ? `\n\n## PRIVATE PROJECT\n\nOrg knowledge is READ-ONLY here: use and cite org facts freely, but NEVER create or update files in the org knowledge folder from this project. Save ALL durable learnings to this project's own knowledge (facts/notes/projects as usual). If a fact seems org-wide, save it locally with \`org-candidate: true\` in its frontmatter so it can be promoted from a non-private project.\n`
    : "";
  const desired = `${CLAUDE_LOCAL_SENTINEL}\n\n${orgKnowledgePrompt()}${overlayNote}${privateNote}\n`;
  let current: string | null = null;
  try {
    current = fs.readFileSync(localMd, "utf8");
  } catch {
    /* absent */
  }
  if (current === null || (current.startsWith(CLAUDE_LOCAL_SENTINEL) && current !== desired)) {
    fs.writeFileSync(localMd, desired, "utf8");
  }

  // 2b. Single source of truth for durable learnings: in CWF WORKSPACES ONLY
  //     (app-created folders — nobody runs the bare CLI there), disable the
  //     harness's own auto-memory so facts land ONLY in Concourse knowledge —
  //     the private drawer double-saved and risked stale recall contradicting
  //     corrected facts. Plain repos are left untouched: engineers' personal
  //     CLI memory there is theirs (revisit at team rollout).
  //     Merge-write settings.local.json, preserving every existing key.
  if (isCwfWs) try {
    const settingsPath = path.join(cwd, ".claude", "settings.local.json");
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    } catch {
      /* absent or invalid — start fresh */
    }
    if (settings.autoMemoryEnabled !== false) {
      settings.autoMemoryEnabled = false;
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    }
  } catch (e) {
    log.warn("[chat] could not disable harness auto-memory", e);
  }

  // 3. Keep both personal files out of the team's git status (local exclude).
  try {
    const gitDir = path.join(cwd, ".git");
    if (!fs.statSync(gitDir).isDirectory()) return;
    const excludeFile = path.join(gitDir, "info", "exclude");
    fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
    const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "";
    const lines = new Set(existing.split("\n").map((l) => l.trim()));
    const additions = ["CLAUDE.local.md", ".claude/settings.local.json"].filter((e) => !lines.has(e));
    if (additions.length) {
      fs.appendFileSync(
        excludeFile,
        `${existing.endsWith("\n") || existing === "" ? "" : "\n"}${additions.join("\n")}\n`,
        "utf8",
      );
    }
  } catch {
    /* not a git repo */
  }
}

// A pushable async-iterable queue: feeds user messages into the SDK's streaming
// input so the same session handles multiple back-and-forth turns.
function createInputQueue() {
  const buffer: unknown[] = [];
  let resolveNext: ((r: IteratorResult<unknown>) => void) | null = null;
  let closed = false;
  return {
    push(msg: unknown) {
      if (closed) return;
      if (resolveNext) {
        resolveNext({ value: msg, done: false });
        resolveNext = null;
      } else {
        buffer.push(msg);
      }
    },
    close() {
      closed = true;
      if (resolveNext) {
        resolveNext({ value: undefined, done: true });
        resolveNext = null;
      }
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (buffer.length) {
          yield buffer.shift();
          continue;
        }
        if (closed) return;
        const r = await new Promise<IteratorResult<unknown>>((res) => (resolveNext = res));
        if (r.done) return;
        yield r.value;
      }
    },
  };
}

const userMessage = (text: string) => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
  session_id: "",
});

// Friendly "what's happening" label for the working indicator, derived from the
// tool a stream event just started. Keeps long silent stretches informative.
function activityLabelForTool(name: string): string {
  const mcp = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
  if (mcp) return `using ${mcp[1]} · ${mcp[2]}`;
  switch (name) {
    case "Task":
    case "Agent":
      return "running a sub-agent";
    case "Read":
    case "Glob":
    case "Grep":
      return "reading workspace files";
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "writing files";
    case "Bash":
      return "running a command";
    case "WebSearch":
    case "WebFetch":
      return "searching the web";
    case "TodoWrite":
      return "planning the steps";
    default:
      return `using ${name}`;
  }
}

// Per-project env grants for the credential scrub: exact var names, one per
// line, in <cwd>/.concourse/env-allowlist (machine-local; .concourse is
// git-excluded). Lines starting with # are comments.
function readEnvAllowlist(cwd: string): Set<string> {
  try {
    return new Set(
      fs
        .readFileSync(path.join(cwd, ".concourse", "env-allowlist"), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")),
    );
  } catch {
    return new Set();
  }
}

// Tier-2 credential guardrail: the engine spawns with a scrubbed environment.
// Stripped names (never values) are logged so a support-bundle pull shows
// exactly what a session could NOT see.
function buildSessionEnv(cwd: string, apiKey: string | null): Record<string, string> {
  const allowlist = readEnvAllowlist(cwd);
  const { env, stripped } = scrubEnv(process.env, allowlist);
  if (stripped.length > 0) {
    log.info(
      `[credential-guard] session env scrubbed for ${cwd}: stripped ${stripped.join(", ")}` +
        (allowlist.size > 0 ? ` | allowlisted: ${[...allowlist].join(", ")}` : "") +
        " | grant via .concourse/env-allowlist",
    );
  }
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  return env;
}

export const claudeChatProvider: ChatProvider = {
  id: "claude-code",

  start(opts: ChatStartOptions, emit: (event: ChatEvent) => void): ChatSessionHandle {
    const sid = opts.sessionId;
    const queue = createInputQueue();
    const abort = new AbortController();
    const pendingPermissions = new Map<string, (allow: boolean) => void>();
    let stopped = false;
    // Live-adjustable "skip all approvals" — the toggle is no longer locked at
    // session start; ungranted credential commands still pierce it.
    let skipApprovals = opts.dangerouslySkipApprovals ?? false;

    // Background sub-agents: the harness's Agent tool can launch async and end
    // the turn with a promise to "follow up" — the harness later injects a
    // <task-notification> user message and the model resumes. Without tracking,
    // the UI shows "Ready" while an agent is still crunching and the user reads
    // it as stuck. agentCalls: every Agent/Task tool_use id → friendly label;
    // backgroundAgents: the subset confirmed launched async and not yet done.
    const agentCalls = new Map<string, string>();
    const backgroundAgents = new Map<string, string>();

    // Lost-notification watchdog. A background agent's completion normally
    // arrives as a <task-notification> user message — but that delivery can
    // fail (observed live: a subagent died mid-tool-call; its file output
    // existed but no notification ever came, leaving the chat "working in
    // the background" forever). While agents are outstanding we poll their
    // on-disk transcripts (~/.claude/projects/<slug>/<session>/subagents/):
    // a transcript that ended cleanly (assistant + end_turn) and idled past
    // a grace tick — or one stranded mid tool_use for far longer — gets a
    // synthetic wake-up so the model verifies results and finishes.
    const WATCHDOG_TICK_MS = 30_000;
    const FINISHED_IDLE_MS = 90_000;
    const STRANDED_IDLE_MS = 10 * 60_000;
    let liveProviderSessionId = opts.providerSessionId ?? null;
    const agentIdByToolUse = new Map<string, string>();
    const finishedSightings = new Set<string>();
    let watchdog: ReturnType<typeof setInterval> | null = null;

    const subagentsDir = () =>
      liveProviderSessionId
        ? path.join(
            os.homedir(),
            ".claude",
            "projects",
            path.resolve(opts.cwd).replace(/[/.]/g, "-"),
            liveProviderSessionId,
            "subagents",
          )
        : null;

    const resolveAgentId = (toolUseId: string): string | null => {
      const cached = agentIdByToolUse.get(toolUseId);
      if (cached) return cached;
      const dir = subagentsDir();
      if (!dir) return null;
      try {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith(".meta.json")) continue;
          try {
            const meta = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
            if (meta?.toolUseId) {
              agentIdByToolUse.set(
                String(meta.toolUseId),
                f.replace(/^agent-/, "").replace(/\.meta\.json$/, ""),
              );
            }
          } catch {
            /* partial write; retry next tick */
          }
        }
      } catch {
        return null;
      }
      return agentIdByToolUse.get(toolUseId) ?? null;
    };

    const subagentLooksDone = (agentId: string): boolean => {
      const dir = subagentsDir();
      if (!dir) return false;
      const file = path.join(dir, `agent-${agentId}.jsonl`);
      try {
        const idle = Date.now() - fs.statSync(file).mtimeMs;
        if (idle < FINISHED_IDLE_MS) return false;
        const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
        const last = JSON.parse(lines[lines.length - 1]);
        if (last?.type === "assistant" && last?.message?.stop_reason === "end_turn") return true;
        // No clean ending recorded — treat as dead only after a long idle so
        // a genuinely slow tool call doesn't trigger a false wake-up.
        return idle >= STRANDED_IDLE_MS;
      } catch {
        return false;
      }
    };

    const watchdogTick = () => {
      if (stopped || backgroundAgents.size === 0) return;
      const woken: Array<{ toolUseId: string; label: string }> = [];
      for (const [toolUseId, label] of backgroundAgents) {
        const agentId = resolveAgentId(toolUseId);
        if (!agentId || !subagentLooksDone(agentId)) {
          finishedSightings.delete(toolUseId);
          continue;
        }
        // Grace tick: first sighting arms it; the real notification usually
        // lands in between. Second consecutive sighting wakes the model.
        if (!finishedSightings.has(toolUseId)) {
          finishedSightings.add(toolUseId);
          continue;
        }
        backgroundAgents.delete(toolUseId);
        finishedSightings.delete(toolUseId);
        woken.push({ toolUseId, label });
      }
      if (woken.length === 0) return;
      log.warn(
        "[chat] background agent finished without a notification; waking the model",
        woken.map((w) => w.label),
      );
      // The <task-notification> markers keep this message out of transcript
      // replays and let the live loop clear the same ids idempotently.
      const body = woken
        .map((w) => `<task-notification><tool-use-id>${w.toolUseId}</tool-use-id></task-notification>`)
        .join("\n");
      queue.push(
        userMessage(
          `[SYSTEM NOTIFICATION - NOT USER INPUT]\n${body}\nBackground agent${woken.length > 1 ? "s" : ""} ${woken
            .map((w) => `"${w.label}"`)
            .join(", ")} appear${woken.length > 1 ? "" : "s"} to have finished, but the completion notification was not delivered. Verify the results on disk (the files or output the agent was asked to produce) and continue or wrap up the task.`,
        ),
      );
      emit({ kind: "activity", sessionId: sid, label: "verifying background agent results" });
      emit({ kind: "status", sessionId: sid, status: "running" });
    };

    // Turn a raw Anthropic message object (live or replayed from a saved
    // session) into chat items. Same shape in both paths.
    const emitMessageItems = (message: any) => {
      const content = message?.content;
      if (!Array.isArray(content)) return;
      for (const block of content as Array<Record<string, any>>) {
        if (block.type === "text" && block.text?.trim()) {
          emit({ kind: "item", sessionId: sid, item: { id: randomUUID(), type: "assistant", text: block.text } });
        } else if (block.type === "tool_use") {
          emit({
            kind: "item",
            sessionId: sid,
            item: { id: randomUUID(), type: "tool", name: block.name, summary: summarizePermission(block.name, block.input) },
          });
        }
      }
    };

    const run = async () => {
      emit({ kind: "status", sessionId: sid, status: "starting" });
      // CWF workspaces: regenerate the .claude/ projection so Claude's native
      // machinery executes the current provider-neutral source. Hash-skipped.
      try {
        projectClaudeWorkspace(opts.cwd);
      } catch (e) {
        log.warn("[chat] claude projection failed", e);
      }
      // Machine-local session prerequisites (both are personal files, never the
      // team's): approve the workspace's .mcp.json servers — the M1 attempt set
      // enableAllProjectMcpServers as a QUERY option, but it's a SETTINGS key,
      // and an unapproved project server SHADOWS a same-named user-scope one
      // (tools silently vanish) — and give SUB-AGENTS the org-knowledge note via
      // CLAUDE.local.md (they never see the main session's system prompt).
      try {
        ensureLocalSessionSetup(opts.cwd, opts.privateKnowledge ?? false);
      } catch (e) {
        log.warn("[chat] local session setup failed", e);
      }
      type GetSessionMessages = (id: string, o?: { dir?: string }) => Promise<any[]>;
      let query: SdkQuery;
      let getSessionMessages: GetSessionMessages | undefined;
      try {
        const mod = await importESM<{ query: SdkQuery; getSessionMessages?: GetSessionMessages }>(
          "@anthropic-ai/claude-agent-sdk",
        );
        query = mod.query;
        getSessionMessages = mod.getSessionMessages;
      } catch (e) {
        log.error("[chat] failed to load Agent SDK", e);
        emit({ kind: "status", sessionId: sid, status: "error", detail: "Could not load the Claude SDK." });
        return;
      }

      // Resuming a saved session: replay its transcript so the user sees
      // history, then continue the live conversation with full context.
      if (opts.resume && opts.providerSessionId && getSessionMessages) {
        try {
          const past = await getSessionMessages(opts.providerSessionId, { dir: opts.cwd });
          for (const msg of past) {
            if (msg?.type === "user") {
              const raw = typeof msg.message?.content === "string"
                ? msg.message.content
                : (msg.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
              // Harness-injected wake-ups aren't something the user typed.
              if (raw.includes("<task-notification>")) continue;
              const text = cleanUserText(raw);
              if (text) emit({ kind: "item", sessionId: sid, item: { id: randomUUID(), type: "user", text } });
            } else if (msg?.type === "assistant") {
              emitMessageItems(msg.message);
            }
          }
        } catch (e) {
          log.warn("[chat] could not replay session transcript", e);
        }
      }

      // Only seed an initial message for a fresh session; a resume continues
      // where it left off and waits for the user's next message — EXCEPT when
      // resume comes with text: that's "the user pressed Stop, then typed a
      // new prompt". The replay above only covers the saved transcript, so
      // surface the new message ourselves, and steer the model to it — a
      // resumed mid-turn abort otherwise tends to pick its old task back up
      // and ignore what the user just asked.
      if (opts.initialText.trim()) {
        if (opts.resume) {
          emit({
            kind: "item",
            sessionId: sid,
            item: { id: randomUUID(), type: "user", text: opts.initialText },
          });
          queue.push(
            userMessage(
              `<concourse-interrupt-note>The user pressed Stop — the previous run was cancelled mid-turn. Do NOT continue the interrupted work unless this message asks for it. Follow this new instruction:</concourse-interrupt-note>\n${opts.initialText}`,
            ),
          );
        } else {
          queue.push(userMessage(opts.initialText));
        }
      }

      // Capability-classed approvals: this adapter maps Claude tool names to
      // ActionClasses (claude-tools.ts); the DOMAIN policy decides allow/ask —
      // reads flow, writes gate (unless the workflow builder's autoApproveWrites),
      // shell + external writes always gate.
      const canUseTool = async (toolName: string, input: unknown) => {
        // Audit trail for credential-touching commands: the request AND the
        // user's decision land in the app log (support-bundle retrievable),
        // so "did someone approve that curl with the API key?" is answerable.
        const bashCommand =
          toolName === "Bash" && typeof (input as { command?: unknown })?.command === "string"
            ? ((input as { command: string }).command)
            : null;
        // The harness's private auto-memory (~/.claude/projects/*/memory/) is
        // NOT a Concourse store: writes there fragment knowledge into a drawer
        // no teammate, engine, or panel can see. Deny them from app sessions —
        // the user's own CLI sessions are unaffected (this hook is ours).
        if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)) {
          const target =
            typeof (input as { file_path?: unknown })?.file_path === "string"
              ? ((input as { file_path: string }).file_path)
              : "";
          if (target.startsWith(path.join(os.homedir(), ".claude", "projects") + path.sep)) {
            log.info(`[knowledge-guard] session=${sid} DENIED auto-memory write: ${target}`);
            return {
              behavior: "deny" as const,
              message:
                "Concourse sessions do not write to the private auto-memory directory — workspace/org knowledge is the canonical store; save it there instead.",
            };
          }
        }
        // Private project: org knowledge is READ-ONLY — hard-deny write tools
        // aimed at the org folder (prompt guidance is advisory; this is not).
        if (opts.privateKnowledge && ["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)) {
          const target =
            typeof (input as { file_path?: unknown })?.file_path === "string"
              ? ((input as { file_path: string }).file_path)
              : "";
          if (target.startsWith(orgKnowledgeDir())) {
            log.info(`[private-project] session=${sid} DENIED org-knowledge write: ${target}`);
            return {
              behavior: "deny" as const,
              message:
                "This is a private project: org knowledge is read-only here. Save the learning to this project's own knowledge instead (mark it org-candidate: true if it belongs org-wide).",
            };
          }
        }
        const cred = bashCommand ? analyzeCommandForCredentials(bashCommand, grantedEnvNames) : null;
        // Ungranted credential use PIERCES the skip-approvals shield: the
        // shield means "stop interrupting me for routine actions", not "let
        // secrets leave silently". The smooth path for power users is the
        // per-project grant (.concourse/env-allowlist), not the shield.
        const decision = cred?.flagged
          ? "ask"
          : decideAction(classifyClaudeTool(toolName), {
              autoApproveWrites: opts.autoApproveWrites,
              dangerouslySkipApprovals: skipApprovals,
            });
        if (decision === "allow") {
          return { behavior: "allow" as const, updatedInput: input };
        }
        if (cred?.flagged) {
          log.info(
            `[credential-guard] session=${sid} approval requested (${cred.reasons.join("; ")}): ${bashCommand!.slice(0, 300)}`,
          );
        }
        const requestId = randomUUID();
        emit({
          kind: "permission",
          sessionId: sid,
          permission: { requestId, toolName, summary: summarizePermission(toolName, input, grantedEnvNames) },
        });
        emit({ kind: "status", sessionId: sid, status: "awaiting-permission" });
        const allow = await new Promise<boolean>((resolve) => {
          pendingPermissions.set(requestId, resolve);
        });
        pendingPermissions.delete(requestId);
        emit({ kind: "status", sessionId: sid, status: "running" });
        if (cred?.flagged) {
          log.info(
            `[credential-guard] session=${sid} user ${allow ? "APPROVED" : "DENIED"} credential command: ${bashCommand!.slice(0, 300)}`,
          );
        }
        return allow
          ? { behavior: "allow" as const, updatedInput: input }
          : { behavior: "deny" as const, message: "Denied by the user." };
      };

      // A key stored in Settings→AI→Authentication (OS keychain) switches this
      // session from the CLI's own login to API-key billing. Read fresh per
      // session start so add/remove applies without an app relaunch.
      const apiKey = getCredential("claude-code");

      // Tier-2 credential guardrail: sessions get a SCRUBBED environment —
      // secret-shaped vars (gitleaks-style name + token-format detection) are
      // stripped before spawn unless the project grants them by name in
      // <cwd>/.concourse/env-allowlist (one var name per line, machine-local).
      const sessionEnv = buildSessionEnv(opts.cwd, apiKey);
      // Standing grants (the same allowlist the scrub honors): commands using
      // granted vars don't re-ask every session — they're logged instead.
      const grantedEnvNames = readEnvAllowlist(opts.cwd);

      // The harness AUTO-APPROVES writes to its own memory directory without
      // consulting canUseTool (the read-only-Bash lesson again) — so the
      // knowledge-guard must intercept at the hook layer to actually fire.
      const memoryWriteHook = async (input: unknown) => {
        const hookInput = input as { tool_input?: unknown };
        const target =
          typeof (hookInput.tool_input as { file_path?: unknown })?.file_path === "string"
            ? ((hookInput.tool_input as { file_path: string }).file_path)
            : "";
        if (!target.startsWith(path.join(os.homedir(), ".claude", "projects") + path.sep)) {
          return {};
        }
        log.info(`[knowledge-guard] session=${sid} DENIED auto-memory write (hook): ${target}`);
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "deny" as const,
            permissionDecisionReason:
              "Concourse sessions do not write to the private auto-memory directory — workspace/org knowledge is the canonical store; save it there instead.",
          },
        };
      };

      // Tier-1 guardrail: the harness auto-allows "read-only" Bash without
      // consulting canUseTool — but a read-shaped `curl -H "Authorization:
      // $KEY"` exfiltrates. This hook forces the permission flow for any
      // command that touches credentials, so it always reaches our card
      // (which names the risk via summarizePermission).
      const credentialBashHook = async (input: unknown) => {
        const hookInput = input as { tool_name?: string; tool_input?: unknown };
        if (hookInput.tool_name !== "Bash") return {};
        const command =
          typeof (hookInput.tool_input as { command?: unknown })?.command === "string"
            ? ((hookInput.tool_input as { command: string }).command)
            : "";
        const cred = analyzeCommandForCredentials(command, grantedEnvNames);
        if (cred.grantedUse.length > 0) {
          log.info(
            `[credential-guard] session=${sid} granted-var use (${cred.grantedUse.join(", ")}): ${command.slice(0, 300)}`,
          );
        }
        if (!cred.flagged) return {};
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "ask" as const,
            permissionDecisionReason: `Credential use: ${cred.reasons.join("; ")}`,
          },
        };
      };

      try {
        const q = query({
          prompt: queue,
          options: {
            cwd: opts.cwd,
            permissionMode: "default",
            // Keep the full Claude Code preset; append where org-wide
            // knowledge lives (userData/org-knowledge — shared by every
            // project on this machine, git-synced in a later version).
            systemPrompt: { type: "preset", preset: "claude_code", append: orgKnowledgePrompt() },
            // Load user scope so the user's claude.ai connectors (Atlassian,
            // etc., stored in ~/.claude.json) are available to the chat + its
            // subagents; project + local bring in the workspace's settings and
            // MC notify hooks. Without "user", Jira/Confluence MCP tools vanish.
            settingSources: ["user", "project", "local"],
            // GLOBAL integrations (Settings→Integrations→My integrations):
            // injected programmatically so they exist in every project without
            // touching any file. Workspace .mcp.json entries flow via settings.
            ...(Object.keys(readGlobalMcpConfig()).length
              ? { mcpServers: readGlobalMcpConfig() }
              : {}),
            // NOTE: .mcp.json approval is handled by ensureLocalSessionSetup —
            // enableAllProjectMcpServers is a SETTINGS key; as a query option
            // here it was silently ignored (caused shadowed-server tool loss).
            pathToClaudeCodeExecutable: resolveClaudeBinary(),
            canUseTool,
            hooks: {
              PreToolUse: [
                { matcher: "Bash", hooks: [credentialBashHook] },
                { matcher: "Write|Edit|MultiEdit|NotebookEdit", hooks: [memoryWriteHook] },
              ],
            },
            abortController: abort,
            // Partial messages power the live activity indicator (tool starts /
            // writing) during long turns — complete messages still arrive as
            // type "assistant", so items render exactly as before.
            includePartialMessages: true,
            // The chat IS the conversation, so block the interactive dialog
            // tools (AskUserQuestion hangs waiting on a dialog the chat never
            // answers). Also block the harness's own session/orchestration
            // tools — workspace workflows wandered into ToolSearch/SendMessage
            // side quests, burning minutes for zero user-visible output.
            disallowedTools: [
              ...(opts.disallowShell ? ["Bash"] : []),
              "AskUserQuestion",
              "ToolSearch",
              "SendMessage",
              "Workflow",
              "Monitor",
              "RemoteTrigger",
              "PushNotification",
              "CronCreate",
              "CronDelete",
              "CronList",
              "TaskCreate",
              "TaskGet",
              "TaskList",
              "TaskOutput",
              "TaskStop",
              "TaskUpdate",
              "ShareOnboardingGuide",
              "ReportFindings",
              "ScheduleWakeup",
              "DesignSync",
              "EnterPlanMode",
              "ExitPlanMode",
              "EnterWorktree",
              "ExitWorktree",
            ],
            // Per-session model override (AI settings default or the chat's
            // intro-card picker). Omit to use the CLI's own default.
            ...(opts.model ? { model: opts.model } : {}),
            // Scrubbed session env (see buildSessionEnv above). SDK `env`
            // REPLACES process.env entirely, so the scrubbed set must be
            // complete; the stored API key is re-injected after scrubbing.
            env: sessionEnv,
            // Durable sessions: resume a saved conversation, or pin a fresh one
            // to our UUID so it can be resumed later (even after app restart).
            ...(opts.resume && opts.providerSessionId
              ? { resume: opts.providerSessionId }
              : opts.providerSessionId
                ? { sessionId: opts.providerSessionId }
                : {}),
          },
        });

        // Only "running" when there's input to process. With no input (a resume
        // reattaching), the query just waits for the user, so we're idle/ready.
        emit({
          kind: "status",
          sessionId: sid,
          status: opts.initialText.trim() ? "running" : "awaiting-input",
        });

        let lastActivity = "";
        for await (const m of q) {
          if (stopped) break;
          if (m?.type === "stream_event") {
            // Live activity for the working indicator (no chat items — the
            // complete message still arrives as type "assistant").
            const ev = m.event;
            let label: string | null = null;
            if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use") {
              label = activityLabelForTool(String(ev.content_block.name ?? ""));
            } else if (ev?.type === "content_block_start" && ev.content_block?.type === "text") {
              label = "writing a response";
            }
            if (label && label !== lastActivity) {
              lastActivity = label;
              emit({ kind: "activity", sessionId: sid, label });
            }
          } else if (m?.type === "assistant" && m.message?.content) {
            emitMessageItems(m.message);
            for (const block of m.message.content as Array<Record<string, any>>) {
              if (block?.type === "tool_use" && (block.name === "Agent" || block.name === "Task")) {
                const label = String(
                  block.input?.subagent_type ?? block.input?.description ?? "a sub-agent",
                );
                agentCalls.set(String(block.id), label);
              }
            }
          } else if (m?.type === "user") {
            // Tool results + harness-injected messages. Two signals matter:
            // "Async agent launched" marks a background agent as outstanding;
            // its <task-notification> marks it done (the model resumes next).
            const content = m.message?.content;
            const blocks = Array.isArray(content) ? content : [{ type: "text", text: content }];
            for (const block of blocks as Array<Record<string, any>>) {
              if (block?.type === "tool_result" && agentCalls.has(String(block.tool_use_id))) {
                const body =
                  typeof block.content === "string"
                    ? block.content
                    : JSON.stringify(block.content ?? "");
                if (body.includes("Async agent launched")) {
                  backgroundAgents.set(
                    String(block.tool_use_id),
                    agentCalls.get(String(block.tool_use_id)) ?? "a sub-agent",
                  );
                }
              }
              const text = block?.type === "text" ? String(block.text ?? "") : "";
              if (text.includes("<task-notification>")) {
                // One message can carry several notifications (agents finishing
                // together) — clear every referenced id, not just the first.
                const ids = [...text.matchAll(/<tool-use-id>([^<]+)<\/tool-use-id>/g)].map((m) => m[1]);
                if (ids.length) for (const id of ids) backgroundAgents.delete(id);
                else backgroundAgents.clear();
              }
            }
          } else if (m?.type === "result") {
            // Turn finished; keep the session open for follow-up messages. But
            // if a background agent is still out, the conversation ISN'T idle —
            // the harness will wake it — so stay "working" with an honest label.
            if (backgroundAgents.size > 0) {
              const label = [...backgroundAgents.values()][0];
              lastActivity = `${label} is working in the background`;
              emit({ kind: "activity", sessionId: sid, label: lastActivity });
              emit({ kind: "status", sessionId: sid, status: "running" });
              if (!watchdog) watchdog = setInterval(watchdogTick, WATCHDOG_TICK_MS);
            } else {
              emit({ kind: "status", sessionId: sid, status: "awaiting-input" });
            }
          } else if (m?.type === "system" && m.subtype === "init") {
            if (m.session_id) liveProviderSessionId = String(m.session_id);
          } else if (m?.type === "system" && m.subtype === "permission_denied") {
            emit({
              kind: "item",
              sessionId: sid,
              item: { id: randomUUID(), type: "notice", text: "Action was not allowed." },
            });
          }
        }
        if (watchdog) clearInterval(watchdog);
        emit({ kind: "status", sessionId: sid, status: "ended" });
      } catch (e) {
        if (watchdog) clearInterval(watchdog);
        if (stopped) {
          // User-initiated stop aborts the SDK iterator — that's a clean end.
          emit({ kind: "status", sessionId: sid, status: "ended" });
          return;
        }
        log.error("[chat] session error", e);
        emit({
          kind: "status",
          sessionId: sid,
          status: "error",
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    };

    void run();

    return {
      send(text: string) {
        emit({ kind: "status", sessionId: sid, status: "running" });
        queue.push(userMessage(text));
      },
      respondPermission(requestId: string, allow: boolean) {
        const resolve = pendingPermissions.get(requestId);
        if (resolve) resolve(allow);
      },
      setSkipApprovals(value: boolean) {
        skipApprovals = value;
      },
      stop() {
        stopped = true;
        try {
          abort.abort();
        } catch {
          /* ignore */
        }
        queue.close();
        for (const resolve of pendingPermissions.values()) resolve(false);
      },
    };
  },
};
