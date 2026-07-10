import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

// Org-wide knowledge (user decision 2026-07-03): facts true across ALL
// projects — system behaviors, Jira field ids, company conventions — live in
// ONE folder every session can read/write, so something learned in any
// workspace answers instantly everywhere. v1 home: the app's private data dir
// (machine-local); next version moves it to a git-synced location so the whole
// org shares one brain. Workspace knowledge/ stays for workspace-only facts.

export function orgKnowledgeDir(): string {
  return path.join(app.getPath("userData"), "org-knowledge");
}

export function ensureOrgKnowledge(): string {
  const dir = orgKnowledgeDir();
  const facts = path.join(dir, "facts");
  fs.mkdirSync(facts, { recursive: true });
  const index = path.join(dir, "index.md");
  if (!fs.existsSync(index)) {
    fs.writeFileSync(
      index,
      `---
type: index
title: Org knowledge
description: Facts true across the whole company — available to every Concourse project, on every engine.
---

# Org knowledge

- \`facts/\` — one markdown file per durable, org-wide fact (system behaviors,
  field ids, conventions). Learned once in any project; used everywhere.
`,
      "utf8",
    );
  }
  return dir;
}

/** One line per org fact ("- file — description") so agents with ONLY a Read
 *  tool can open the right file directly — no directory listing, no filename
 *  guessing (a sub-agent once invented "reference_auth_architecture.md"). */
function factIndexLines(dir: string): string {
  try {
    const facts = path.join(dir, "facts");
    const lines = fs
      .readdirSync(facts)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .slice(0, 100)
      .map((f) => {
        let desc = "";
        try {
          desc =
            fs.readFileSync(path.join(facts, f), "utf8").match(/^description:\s*(.+)$/m)?.[1] ??
            "";
        } catch {
          /* unreadable → name only */
        }
        return `- \`${facts}/${f}\`${desc ? ` — ${desc}` : ""}`;
      });
    return lines.length ? lines.join("\n") : "(none yet)";
  } catch {
    return "(none yet)";
  }
}

/** The system-prompt snippet that tells an engine where org knowledge lives
 *  and how to use it alongside the workspace's own knowledge/. Includes the
 *  current fact INDEX so a plain Read tool is enough to use it. */
export function orgKnowledgePrompt(): string {
  const dir = ensureOrgKnowledge();
  return `## Org knowledge

Company-wide facts live at \`${dir}\` (readable/writable like any path). The
knowledge-first order is: this workspace's \`knowledge/facts/\` → org facts →
fetch live. Current org facts (Read the file directly — do not guess other
filenames):

${factIndexLines(dir)}

When you learn a durable fact, save it to the right scope: true org-wide
(system behavior, field ids, company conventions) → \`${dir}/facts/<slug>.md\`;
only meaningful in this workspace → workspace facts. One file per topic —
update, never duplicate. And one file per CONCEPT, not per investigation:
when new knowledge is a DISTINCT concept (different subject, searched with
different words — e.g. an e-signature rule learned during an ELTV
investigation), create its OWN fact and cross-link both ways instead of
appending it to the fact you happen to have open. The test: would the
existing fact's one-line description surface this knowledge to someone
searching for it? If not, it needs its own file. Point-in-time numbers (metrics, statuses, counts) are
served from knowledge ONLY when the fact is marked \`kind: point-in-time\` with
a \`captured\` datetime within the last 4 hours — lead with "as of <time>" and
offer a live refresh; otherwise fetch live and update the fact (fresh
snapshots about shared resources like a sprint are worth saving org-scope with
those markers). When citing an org fact in a reply, link its FULL absolute
path so the file opens when clicked — and because the path contains spaces,
wrap the link destination in angle brackets: \`[title](</abs/path/fact.md>)\`.
When an answer mixes saved knowledge with your own reasoning, separate them
explicitly EVERY time — "verified from knowledge" (with citations) vs
"inference — not verified" — and offer to investigate the gap. Never present
a plausible deduction as a known fact.

Concourse workspace/org knowledge is the CANONICAL store for durable
learnings — always save them there, and ONLY there. Never write to your
private auto-memory directory (~/.claude/projects/*/memory/) — such writes
are refused in this app: they fragment knowledge into a drawer no teammate,
engine, or panel can see. Recalled memories may still appear in your context;
treat them as background, and migrate anything durable into knowledge.

Credential guardrail: your environment is scrubbed of credential-shaped
variables (API keys, tokens). If a command needs one, do NOT hunt for the
secret in files — tell the user to add the variable's NAME to
\`.concourse/env-allowlist\` (one name per line) and restart the session.

Milestones produce FILES — a long conversation that ends with everything
still trapped in the chat is a failure mode (the chat scrolls away; files
don't). When a conversation reaches a milestone, save it WITHOUT ASKING — never
"want me to record this?" in prose for knowledge/output files; the approval
card on the write is the consent. EXCEPTION — external records (Jira
comments, Confluence updates, anything teammates see): ALWAYS confirm in
prose first, one short question ("Post this to PPI-1653?") — auto-approve
sessions skip cards entirely, and a shared artifact deserves an explicit
yes. A final draft the
user approved (a reply, a doc, a plan you helped write) → \`outputs/<topic>/\`;
a decision made or a position worked out → a decision note in
\`knowledge/notes/\`; durable insights → facts. Milestones only — not every
revision.

Conversational knowledge (OKF): when the user shares meeting notes, a 1:1,
a decision, or similar knowledge-worthy content in ANY chat, save it as an
OKF concept file under the workspace's \`knowledge/notes/<yyyy-mm-dd>-<slug>.md\`
(in a plain repo, \`.concourse/knowledge/notes/\`): YAML frontmatter with a
required \`type\` (meeting-notes | one-on-one | decision | note) plus title,
description, tags, and an ISO timestamp; structured markdown body; markdown
links to related facts/notes as the graph's edges. Extract durable facts into
their own fact files and link them. Then add the note to that knowledge
folder's \`index.md\` and append a dated entry to its \`log.md\`.

Diagrams and breakdowns: when the user asks for a diagram, flow, architecture
overview, lifecycle, or any visual breakdown, author it as MERMAID inside a
markdown file under \`outputs/<topic>/\` FIRST — the app renders mermaid blocks
as live diagrams in chat and preview, and exports them as images in Word/PDF —
then walk the user through it in chat. Prefer mermaid over ASCII art, image
generation, or external tools. Only deviate when the user names a specific
format (an ASCII sketch, a PNG, a slide, a specific tool).

House diagram style (the compact professional card layout palette): color
nodes by MEANING using classDef tints — process/flow \`#dceff6\` stroke
\`#19799a\` (teal), decision/human gate \`#ffeccc\` stroke \`#b97e1e\`
(amber — attention, use sparingly), output/result \`#e2f4ec\` stroke
\`#159a63\` (completed green), input/source \`#e7f2f7\` stroke \`#65758a\`
(pale blue), external system \`#ffffff\` stroke \`#153d5c\` (navy outline).
Example: \`classDef process fill:#dceff6,stroke:#19799a\`. Group related
steps in subgraphs. Keep this palette unless the user asks for plain/minimal.

Document writing style: plain words over typographic symbols — write
"section 4" or "Part 4", never "§4"; avoid ¶, †, and similar marks. These
documents are read aloud in meetings and exported to Word/PDF for people who
should never have to decode notation.

Attachments: files the user attached in ANY conversation live in
\`.concourse/attachments/\`, and \`attachments-log.md\` there records which
conversation attached which file. When the user references an earlier
attachment ("the screenshot from the pods conversation"), check the log and
read the file — never ask them to re-attach.

Document exports: the Concourse app natively exports any markdown output to
Word or PDF (Outputs panel → click the file → Export). When the user wants a
Word/PDF version of a markdown deliverable, point them there — do NOT install
document converters (python-docx, pandoc). Script-generated formats are only
for what the preview cannot do (xlsx, images, data files).

Initiatives (PARA-aligned): a multi-session effort gets ONE living note at
\`knowledge/projects/<initiative>.md\` (plain repo:
\`.concourse/knowledge/projects/\`) — goal, current status, owner, and links to
the facts, notes, outputs, and Confluence page it has produced. Update it as
the work moves; it is the one-file answer to "where does this thread live".
Retire, don't delete: stale facts and completed initiatives move to
\`knowledge/archive/\`.

Handoffs: when the user must hand work off to someone else, write a note at
\`knowledge/notes/<yyyy-mm-dd>-<topic>-handoff.md\` (plain repo:
\`.concourse/knowledge/notes/\`) capturing the goal, evidence so far, what was
ruled out and why, the current hypothesis, exact next steps, and links to
relevant files/facts; save durable discoveries as separate facts. Handoff
notes travel to ANOTHER machine: never write machine-absolute paths in them —
workspace-relative paths only, and org facts by NAME (not location). Link the
snapshot from the initiative note in \`knowledge/projects/\` (create it if the
effort has none). Then tell the user: project menu → Share knowledge exports
it for the teammate.`;
}
