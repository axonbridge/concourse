import * as fs from "node:fs";
import * as path from "node:path";

// Add-Project compatibility, Journey A (agreed 2026-07-03): an EMPTY folder
// becomes a ready-to-use Concourse workspace deterministically — workspace.md,
// a starter command trio (/ask, /doc, create-workflow), the knowledge-first
// skill, a knowledge scaffold, and .mcp.json.
// Org knowledge needs nothing here — it's injected per-session by the engines.

export type FolderKind = "missing" | "empty" | "cwf" | "legacy-claude" | "plain";

export function classifyFolder(dir: string): { kind: FolderKind; isGit: boolean } {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((e) => e !== ".DS_Store");
  } catch {
    return { kind: "missing", isGit: false };
  }
  const isGit = entries.includes(".git");
  if (entries.length === 0) return { kind: "empty", isGit };
  if (fs.existsSync(path.join(dir, "workspace.md"))) return { kind: "cwf", isGit };
  if (entries.includes(".claude")) return { kind: "legacy-claude", isGit };
  return { kind: "plain", isGit };
}

function writeIfMissing(content: string, dest: string): void {
  if (fs.existsSync(dest)) return; // additive only — never overwrite
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, "utf8");
}

const STARTER_ASK = `---
description: Ask a question and get a sourced answer from the company's Confluence knowledge base.
examples:
  - "How does agent authentication work?"
---

# Ask

Answer the question in "$ARGUMENTS" by searching Confluence (via the atlassian
tools) and reading the most relevant pages in full. Cite every source (page
title + last-updated date). If nothing relevant exists, say so — never fabricate.

## Knowledge-first (required)

Follow the knowledge-first protocol in \`skills/knowledge-first.md\`: check
\`knowledge/facts/\` and the org facts folder before searching, serve only
non-stale facts (cite the fact file + date, offer "refresh"), fetch live on
miss, and save durable facts back after the run.
`;

const STARTER_DOC = `---
description: Draft a well-structured Confluence page from your notes or a conversation.
examples:
  - "Document our weekly report process"
---

# Doc

Turn "$ARGUMENTS" (plus anything the user pastes) into a clear, well-structured
document. Show the draft for review; publish to Confluence (via the atlassian
tools) only after the user approves.
`;

const STARTER_CREATE_WORKFLOW = `---
description: Build a reusable workflow for this workspace by answering a few questions.
custom: false
---

# Create a workflow

Interview the user about the repetitive task they want to automate (goal,
inputs, steps, output format, how often). Then create the workflow: a command
in \`commands/\`, any needed agents in \`agents/\`, skills in \`skills/\`, and an
output template in \`templates/\`. Frontmatter for the command: \`description\`,
\`examples\`, \`custom: true\`, \`owns:\` listing created agents/skills. Keep every
file plain markdown with YAML frontmatter. Study the project first (README,
existing commands and code layout) so the workflow fits how it actually works.
`;

/**
 * Make sure the workflow-builder command exists for a project before the chat
 * fires \`/create-workflow\` at the engine. Additive only — never overwrites.
 * The file is always the provider-neutral CWF source \`commands/create-workflow.md\`;
 * the projector fans it out to every engine convention (the caller projects).
 */
export function ensureWorkflowBuilderCommand(dir: string): void {
  writeIfMissing(STARTER_CREATE_WORKFLOW, path.join(dir, "commands/create-workflow.md"));
}

const STARTER_KNOWLEDGE_FIRST = `---
type: skill
title: Knowledge-first protocol
description: Check knowledge before external fetches; verify staleness; save durable facts back.
tags: [knowledge, protocol]
---

# Knowledge-first protocol

1. Check this workspace's \`knowledge/facts/\` AND the org facts folder (your
   context states its location) before querying external sources.
2. Judge freshness by kind: stable facts (field ids, conventions) are served
   with citation + date and a "refresh" escape hatch; point-in-time numbers are
   NEVER served from knowledge.
3. On miss or staleness, fetch live and UPDATE the fact file.
4. Save durable discoveries back to the right scope (org-wide → org facts;
   workspace-only → here). Writes go through the normal approval.
`;

export function scaffoldWorkspace(dir: string, name: string): void {
  fs.mkdirSync(dir, { recursive: true });

  // Additive only: a PLAIN folder (documents, no AI setup) gets the standard
  // files added AROUND its content — nothing existing is ever overwritten.
  if (!fs.existsSync(path.join(dir, "workspace.md")))
  fs.writeFileSync(
    path.join(dir, "workspace.md"),
    `---
type: workspace
title: ${name}
description: Concourse workspace for ${name}.
---

# ${name} Workspace

## What this is

The Concourse workspace for ${name}. Commands turn live company data into
useful outputs; everything here is plain markdown you can read and edit.

## Commands

| Command | Use when... |
|---------|-------------|
| \`/ask\` | You want a sourced answer from the company knowledge base |
| \`/doc\` | You want to draft and publish a document |
| \`/create-workflow\` | You want to automate a repetitive task |

## Knowledge

This workspace keeps a knowledge graph in \`knowledge/\` — plain markdown, links are edges.

- **Before probing or guessing**, check \`knowledge/facts/\` and the org facts folder — someone may have learned it already.
- **When you learn a durable fact**, save it to the right scope (org-wide facts → org folder; workspace-only → \`knowledge/facts/\`), following \`skills/knowledge-first.md\`.
- Facts are for things that stay true across runs. Run outputs do NOT belong here — the app records runs in \`knowledge/runs/\` automatically.

## Conventions

- Workflow deliverables are written to \`outputs/<command>/\` — never to the workspace root.
- Agent-authored helper scripts live in \`.scripts/\`.
- Every claim cites its source. Never invent numbers; if data is missing, say so.
- Outputs are decision-oriented — lead with what changed and what needs attention.
`,
    "utf8",
  );

  writeIfMissing(STARTER_ASK, path.join(dir, "commands/ask.md"));
  writeIfMissing(STARTER_DOC, path.join(dir, "commands/doc.md"));
  writeIfMissing(STARTER_CREATE_WORKFLOW, path.join(dir, "commands/create-workflow.md"));
  writeIfMissing(STARTER_KNOWLEDGE_FIRST, path.join(dir, "skills/knowledge-first.md"));

  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  fs.mkdirSync(path.join(dir, "templates"), { recursive: true });
  fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "knowledge/facts"), { recursive: true });
  if (!fs.existsSync(path.join(dir, "knowledge/index.md")))
  fs.writeFileSync(
    path.join(dir, "knowledge/index.md"),
    `---
type: index
title: Workspace knowledge
description: Entry point for this workspace's knowledge graph.
---

# Knowledge

- \`facts/\` — durable facts agents have learned (workspace-scoped)
- \`runs/\` — one record per workflow run (written by the app)
`,
    "utf8",
  );

  if (!fs.existsSync(path.join(dir, ".mcp.json")))
  fs.writeFileSync(
    path.join(dir, ".mcp.json"),
    JSON.stringify({ mcpServers: { atlassian: { type: "http", url: "https://mcp.atlassian.com/v1/mcp/authv2" } } }, null, 2) + "\n",
    "utf8",
  );
}
