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
