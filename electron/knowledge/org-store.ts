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
update, never duplicate. Point-in-time numbers are never served from
knowledge. When citing an org fact in a reply, link its FULL absolute path so
the file opens when clicked.

Conversational knowledge (OKF): when the user shares meeting notes, a 1:1,
a decision, or similar knowledge-worthy content in ANY chat, save it as an
OKF concept file under the workspace's \`knowledge/notes/<yyyy-mm-dd>-<slug>.md\`
(in a plain repo, \`.concourse/knowledge/notes/\`): YAML frontmatter with a
required \`type\` (meeting-notes | one-on-one | decision | note) plus title,
description, tags, and an ISO timestamp; structured markdown body; markdown
links to related facts/notes as the graph's edges. Extract durable facts into
their own fact files and link them. Then add the note to that knowledge
folder's \`index.md\` and append a dated entry to its \`log.md\`.`;
}
