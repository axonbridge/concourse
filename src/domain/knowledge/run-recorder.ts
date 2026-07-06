import * as fs from "node:fs";
import * as path from "node:path";

// OKF knowledge write-back (plan §M5a): every workflow run leaves a durable,
// deterministic trace in the workspace's knowledge graph — an OKF run-record
// concept linking the command that ran and the files it wrote, plus an
// append-only log and a maintained index. Pure fs + strings; the engine-
// agnostic chat IPC layer feeds it ChatEvents, so every engine gets this
// for free. Files are the contract: the "graph" is markdown links.

export type RunRecordInput = {
  workspaceDir: string;
  /** Slash command that ran, or null for a plain chat turn that wrote files. */
  command: string | null;
  engine: string;
  model?: string;
  startedAt: Date;
  finishedAt: Date;
  /** Workspace-relative paths of files the run wrote (from Write-tool events). */
  outputs: string[];
  status: "completed" | "error" | "stopped";
};

const RUNS_DIR = "knowledge/runs";
const INDEX_FILE = "knowledge/index.md";
const LOG_FILE = "knowledge/log.md";

/** Where a project's run records live. CWF workspaces own their knowledge —
 *  it IS the product — so records go to `knowledge/` in the workspace. Any
 *  other folder (an engineering repo, a plain directory) gets a machine-local
 *  `.concourse/` overlay instead, kept out of the team's git via the LOCAL
 *  ignore file (`.git/info/exclude` — never the shared .gitignore). */
export function runRecordRoot(workspaceDir: string): string {
  if (fs.existsSync(path.join(workspaceDir, "workspace.md"))) return workspaceDir;
  const overlay = path.join(workspaceDir, ".concourse");
  ensureLocalGitExclude(workspaceDir, ".concourse/");
  return overlay;
}

function ensureLocalGitExclude(repoDir: string, entry: string): void {
  try {
    const gitDir = path.join(repoDir, ".git");
    if (!fs.statSync(gitDir).isDirectory()) return; // worktree/file .git → skip
    const infoDir = path.join(gitDir, "info");
    fs.mkdirSync(infoDir, { recursive: true });
    const excludeFile = path.join(infoDir, "exclude");
    const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "";
    if (current.split("\n").some((l) => l.trim() === entry)) return;
    fs.appendFileSync(excludeFile, `${current.endsWith("\n") || current === "" ? "" : "\n"}${entry}\n`, "utf8");
  } catch {
    /* not a git repo (or unreadable) — nothing to exclude */
  }
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

function dateStamp(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

function timeStamp(d: Date): string {
  return `${dateStamp(d)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function isoLocal(d: Date): string {
  return d.toISOString();
}

/** knowledge/runs/<date>-<command|chat>.md, suffixed -2, -3… on same-day reruns. */
function runRecordPath(workspaceDir: string, command: string | null, startedAt: Date): string {
  const base = `${dateStamp(startedAt)}-${(command ?? "chat").replace(/[^\w-]/g, "-")}`;
  let candidate = path.join(workspaceDir, RUNS_DIR, `${base}.md`);
  for (let i = 2; fs.existsSync(candidate); i++) {
    candidate = path.join(workspaceDir, RUNS_DIR, `${base}-${i}.md`);
  }
  return candidate;
}

function ensureIndex(workspaceDir: string): void {
  const p = path.join(workspaceDir, INDEX_FILE);
  if (fs.existsSync(p)) return;
  fs.writeFileSync(
    p,
    `---
type: index
title: Workspace knowledge
description: Entry point for this workspace's knowledge graph — curated facts and workflow run records.
---

# Knowledge

- [Run log](log.md) — every workflow run, newest last
- \`facts/\` — durable facts agents have learned (field ids, gotchas, conventions)
- \`notes/\` — conversational knowledge: meeting notes, 1:1s, decisions
- \`runs/\` — one record per workflow or file-writing chat
`,
    "utf8",
  );
}

/** Append the run to knowledge/, creating the scaffold on first use. */
export function recordRun(input: RunRecordInput): string {
  const { workspaceDir } = input;
  const root = runRecordRoot(workspaceDir);
  fs.mkdirSync(path.join(root, RUNS_DIR), { recursive: true });
  fs.mkdirSync(path.join(root, "knowledge/facts"), { recursive: true });
  ensureIndex(root);

  const recordAbs = runRecordPath(root, input.command, input.startedAt);
  const recordRel = path.relative(workspaceDir, recordAbs).split(path.sep).join("/");
  const durationS = Math.max(0, Math.round((input.finishedAt.getTime() - input.startedAt.getTime()) / 1000));
  const durationLabel = durationS >= 60 ? `${Math.floor(durationS / 60)}m ${durationS % 60}s` : `${durationS}s`;

  const outputLinks = input.outputs.map((o) => `- [${o}](/${o})`).join("\n");
  const label = input.command ? `/${input.command}` : "Chat";
  const record = `---
type: run-record
title: ${label} — ${timeStamp(input.startedAt)}
description: ${input.command ? `Workflow run of /${input.command}` : "Chat session that wrote files,"} on ${input.engine}${input.model ? ` (${input.model})` : ""}.
timestamp: ${isoLocal(input.finishedAt)}
${input.command ? `command: /commands/${input.command}.md\n` : ""}engine: ${input.engine}
${input.model ? `model: ${input.model}\n` : ""}status: ${input.status}
duration: ${durationLabel}
tags: [run${input.command ? "" : ", chat"}]
---

# ${label} — ${timeStamp(input.startedAt)}

Ran on **${input.engine}**${input.model ? ` (\`${input.model}\`)` : ""} in ${durationLabel} — ${input.status}.

${input.outputs.length ? `## Outputs\n\n${outputLinks}` : "_No files written._"}
`;
  fs.writeFileSync(recordAbs, record, "utf8");

  // Append-only run log (created with a small header on first write).
  const logAbs = path.join(root, LOG_FILE);
  if (!fs.existsSync(logAbs)) {
    fs.writeFileSync(
      logAbs,
      `---
type: log
title: Run log
description: Append-only log of workflow runs in this workspace.
---

# Run log
`,
      "utf8",
    );
  }
  const outputsNote = input.outputs.length ? ` → ${input.outputs.join(", ")}` : "";
  fs.appendFileSync(
    logAbs,
    `\n- ${timeStamp(input.startedAt)} — [${label}](/${recordRel}) on ${input.engine} (${durationLabel}, ${input.status})${outputsNote}`,
    "utf8",
  );

  return recordRel;
}

/** Loose parse of a Write-tool summary into a workspace-relative path.
 *  Claude emits "Create or overwrite file: /abs/path"; the direct engine emits
 *  "Write rel/path". Anything outside the workspace (or unparsable) is dropped. */
export function outputPathFromToolSummary(
  summary: string,
  workspaceDir: string,
): string | null {
  const m = summary.match(/(?:file:\s*|^Write\s+)(.+)$/i);
  if (!m) return null;
  const raw = m[1]!.trim().replace(/["'`]/g, "");
  if (!raw) return null;
  const abs = path.isAbsolute(raw) ? raw : path.join(workspaceDir, raw);
  const rel = path.relative(workspaceDir, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  // The knowledge dir's own files aren't "outputs" — avoid self-reference noise.
  if (rel.startsWith("knowledge/")) return null;
  return rel.split(path.sep).join("/");
}
