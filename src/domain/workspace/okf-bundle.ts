// OKF bundle serialization (plan §M5c/M5d): a shared workflow is a FOLDER of
// plain markdown — an index.md manifest plus the command and everything it
// owns, mirroring the workspace layout (cole-medin style: activate in any
// assistant by reading index.md and following links). This module is pure
// (bundle ⇄ path→content map); the electron dialog layer does the fs.
//
// CommandBundle is declared structurally (matches ~/shared/projects) because
// this file also compiles under the electron tsconfig, which resolves neither
// the `~` alias nor the db-typed modules projects.ts imports. The app build
// type-checks the two against each other at every call site.

type NamedContent = { name: string; content: string };
export type CommandBundle = {
  version: 1;
  command: NamedContent;
  agents: NamedContent[];
  skills: NamedContent[];
  template?: NamedContent;
};

export const BUNDLE_INDEX = "index.md";

/** Serialize a workflow bundle into a rel-path → content map (folder shape). */
export function bundleToFiles(bundle: CommandBundle): Record<string, string> {
  const files: Record<string, string> = {};
  const cmd = bundle.command.name;
  files[`commands/${cmd}.md`] = bundle.command.content;
  for (const a of bundle.agents ?? []) files[`agents/${a.name}.md`] = a.content;
  for (const s of bundle.skills ?? []) files[`skills/${s.name}.md`] = s.content;
  if (bundle.template) files[`templates/${bundle.template.name}.md`] = bundle.template.content;

  const link = (p: string, label: string) => `- [${label}](${p})`;
  const lines = [
    link(`commands/${cmd}.md`, `/${cmd} (the command)`),
    ...(bundle.agents ?? []).map((a) => link(`agents/${a.name}.md`, `agent: ${a.name}`)),
    ...(bundle.skills ?? []).map((s) => link(`skills/${s.name}.md`, `skill: ${s.name}`)),
    ...(bundle.template ? [link(`templates/${bundle.template.name}.md`, "output template")] : []),
  ];
  files[BUNDLE_INDEX] = `---
type: bundle
title: /${cmd} workflow
description: Portable Concourse workflow bundle — drop into a workspace (or import via Concourse) to install /${cmd}.
bundle-version: 1
command: ${cmd}
---

# /${cmd} workflow bundle

Import this folder from Concourse (workspace → Import workflow), or copy the
files into any Concourse workspace preserving their folders.

## Contents

${lines.join("\n")}
`;
  return files;
}

// ---------------------------------------------------------------------------
// Knowledge handoff bundle (project knowledge + attached workflows). Agreed
// rules: point-in-time facts and org-scope facts never ship; facts are
// skip-or-keep-newer on import (never collision-renamed — one file per topic);
// workflows inside reuse the CommandBundle import path (rename-safe).

export type KnowledgeBundle = {
  version: 1;
  kind: "knowledge";
  title: string;
  facts: NamedContent[];
  notes: NamedContent[];
  workflows: CommandBundle[];
  /** Deliverables from outputs/ — name is the rel path under outputs/ WITH
   *  extension (e.g. "pod-model/team-pod-structure.md"). Text files only. */
  documents?: NamedContent[];
  /** Attachments (screenshots, spreadsheets…) — binary-safe base64, filename
   *  only (attachments/ is flat). Serialized to attachments/<name> in the
   *  bundle folder by the electron dialog layer (this module stays text-only). */
  assets?: { name: string; base64: string }[];
};

export function isKnowledgeBundle(v: unknown): v is KnowledgeBundle {
  const b = v as KnowledgeBundle | null;
  return !!b && b.version === 1 && b.kind === "knowledge" && Array.isArray(b.facts);
}

/** Serialize a knowledge bundle into a rel-path → content map (folder shape).
 *  Workflows nest under workflows/<cmd>/ so several can travel together
 *  without their agents/skills colliding in one folder. */
export function knowledgeBundleToFiles(bundle: KnowledgeBundle): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of bundle.facts) files[`knowledge/facts/${f.name}.md`] = f.content;
  for (const n of bundle.notes ?? []) files[`knowledge/notes/${n.name}.md`] = n.content;
  for (const d of bundle.documents ?? []) files[`outputs/${d.name}`] = d.content;
  for (const w of bundle.workflows ?? []) {
    const sub = bundleToFiles(w);
    for (const [p, content] of Object.entries(sub)) {
      files[`workflows/${w.command.name}/${p}`] = content;
    }
  }
  const link = (p: string, label: string) => `- [${label}](${p})`;
  const lines = [
    ...bundle.facts.map((f) => link(`knowledge/facts/${f.name}.md`, `fact: ${f.name}`)),
    ...(bundle.notes ?? []).map((n) => link(`knowledge/notes/${n.name}.md`, `note: ${n.name}`)),
    ...(bundle.documents ?? []).map((d) => link(`outputs/${d.name}`, `document: ${d.name}`)),
    ...(bundle.assets ?? []).map((a) => link(`attachments/${a.name}`, `attachment: ${a.name}`)),
    ...(bundle.workflows ?? []).map((w) =>
      link(`workflows/${w.command.name}/${BUNDLE_INDEX}`, `workflow: /${w.command.name}`),
    ),
  ];
  files[BUNDLE_INDEX] = `---
type: knowledge-bundle
title: ${bundle.title}
description: Portable Concourse knowledge handoff — import via Concourse (workspace → Import workflow) to start from this knowledge foundation.
bundle-version: 1
---

# ${bundle.title}

Import this folder from Concourse. Facts merge into the workspace's
knowledge (existing facts are kept when newer — never duplicated);
workflows install alongside your own.

## Contents

${lines.join("\n")}
`;
  return files;
}

/** Rebuild a KnowledgeBundle from a folder's rel-path → content map. */
export function filesToKnowledgeBundle(files: Record<string, string>): KnowledgeBundle {
  const byDir = (dir: string) =>
    Object.entries(files)
      .filter(([p]) => p.startsWith(`${dir}/`) && p.endsWith(".md"))
      .map(([p, content]) => ({ name: p.slice(dir.length + 1, -3), content }))
      .sort((a, b) => a.name.localeCompare(b.name));

  // Workflows: group workflows/<cmd>/** and parse each group as a CommandBundle.
  const workflowRoots = new Set<string>();
  for (const p of Object.keys(files)) {
    const m = /^workflows\/([^/]+)\//.exec(p);
    if (m) workflowRoots.add(m[1]!);
  }
  const workflows: CommandBundle[] = [];
  for (const root of [...workflowRoots].sort()) {
    const sub: Record<string, string> = {};
    const prefix = `workflows/${root}/`;
    for (const [p, content] of Object.entries(files)) {
      if (p.startsWith(prefix)) sub[p.slice(prefix.length)] = content;
    }
    try {
      workflows.push(filesToBundle(sub));
    } catch {
      /* tolerate a malformed workflow folder — facts still import */
    }
  }

  // Documents keep their extension — any text file under outputs/.
  const documents = Object.entries(files)
    .filter(([p]) => p.startsWith("outputs/"))
    .map(([p, content]) => ({ name: p.slice("outputs/".length), content }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const title =
    files[BUNDLE_INDEX]?.match(/^title:\s*(.+?)\s*$/m)?.[1] ?? "Knowledge handoff";
  const bundle: KnowledgeBundle = {
    version: 1,
    kind: "knowledge",
    title,
    facts: byDir("knowledge/facts"),
    notes: byDir("knowledge/notes"),
    workflows,
    documents,
  };
  // A handoff can be a single note — facts and workflows are both optional.
  if (
    bundle.facts.length === 0 &&
    bundle.notes.length === 0 &&
    workflows.length === 0 &&
    documents.length === 0
  ) {
    throw new Error("Not a knowledge bundle (no knowledge/ or workflows/ files inside).");
  }
  return bundle;
}

/** True when a folder's files look like a knowledge bundle rather than a
 *  single-workflow bundle. */
export function looksLikeKnowledgeBundle(files: Record<string, string>): boolean {
  if (/^type:\s*knowledge-bundle\s*$/m.test(files[BUNDLE_INDEX] ?? "")) return true;
  return Object.keys(files).some(
    (p) => p.startsWith("knowledge/facts/") || p.startsWith("workflows/"),
  );
}

/** Rebuild a CommandBundle from a folder's rel-path → content map. Tolerant:
 *  index.md is advisory (its `command:` picks the entry when several commands
 *  exist); structure is derived from the folders, per OKF's resilience rule. */
export function filesToBundle(files: Record<string, string>): CommandBundle {
  const byDir = (dir: string) =>
    Object.entries(files)
      .filter(([p]) => p.startsWith(`${dir}/`) && p.endsWith(".md"))
      .map(([p, content]) => ({ name: p.slice(dir.length + 1, -3), content }))
      .sort((a, b) => a.name.localeCompare(b.name));

  const commands = byDir("commands");
  if (commands.length === 0) throw new Error("Not a workflow bundle (no commands/*.md inside).");
  const preferred = files[BUNDLE_INDEX]?.match(/^command:\s*(\S+)\s*$/m)?.[1];
  const command = commands.find((c) => c.name === preferred) ?? commands[0]!;

  const templates = byDir("templates");
  const bundle: CommandBundle = {
    version: 1,
    command: { name: command.name, content: command.content },
    agents: byDir("agents"),
    skills: byDir("skills"),
  };
  if (templates[0]) bundle.template = templates[0];
  return bundle;
}
