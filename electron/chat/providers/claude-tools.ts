import type { ActionClass } from "../../../src/domain/policy/action-policy";
import { analyzeCommandForCredentials } from "../../../src/domain/policy/secret-rules";

// Claude Code's tool vocabulary, mapped to the domain's capability classes.
// This is the adapter-side half of the ActionPolicy split: the domain decides
// allow/ask per ActionClass (src/domain/policy/action-policy.ts); this file
// knows which Claude tool is which class. Other engines ship their own map.

const READ_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "NotebookRead",
  "TodoWrite", // planning scratchpad — side-effect-free
  "Task", // subagents; their own tool calls are still classified individually
]);

const WEB_READ_TOOLS = new Set(["WebSearch", "WebFetch"]);

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// MCP read patterns: mcp__<server>__search*/get*/list*/read*/fetch*…
const MCP_READ_RE = /^mcp__.+__(search|get|list|read|fetch|lookup|describe)/i;

export function classifyClaudeTool(toolName: string): ActionClass {
  if (READ_TOOLS.has(toolName)) return "read";
  if (WEB_READ_TOOLS.has(toolName)) return "external-read";
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (toolName.startsWith("mcp__")) {
    return MCP_READ_RE.test(toolName) ? "external-read" : "external-write";
  }
  // Bash and anything unknown: treat as execute → always gated.
  return "execute";
}

// Build a short, human summary for a tool call so approval cards and tool lines
// are legible to a non-technical user.
export function summarizePermission(
  toolName: string,
  input: unknown,
  grantedEnvNames: ReadonlySet<string> = new Set(),
): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  if (toolName === "Write") return `Create or overwrite file: ${str("file_path") || "(file)"}`;
  if (toolName === "Edit" || toolName === "NotebookEdit") return `Edit file: ${str("file_path") || "(file)"}`;
  if (toolName === "Bash") {
    const command = str("command");
    // Credential-touching commands get the risk NAMED on the card — a long
    // command hides `-H "Authorization: …"` from a non-technical approver.
    const cred = analyzeCommandForCredentials(command, grantedEnvNames);
    const prefix = cred.flagged ? `⚠ Uses a credential (${cred.reasons.join("; ")}) — ` : "";
    return `${prefix}Run command: ${command.slice(0, 100) || "(shell)"}`;
  }
  if (/createjira|createissue/i.test(toolName)) return "Create a Jira issue";
  if (/confluence/i.test(toolName) && /create|update/i.test(toolName)) return "Publish/update a Confluence page";
  if (/^mcp__/.test(toolName)) return `Use ${toolName.replace(/^mcp__/, "").replace(/__/g, " · ")}`;
  return `Use the ${toolName} tool`;
}
