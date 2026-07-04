import * as fs from "node:fs";
import * as path from "node:path";
import {
  CWF_DIRS,
  CWF_ENTRY_FILE,
  type CwfItem,
  type CwfItemType,
  type CwfWorkspace,
} from "./types";
import { parseItem, toCommand } from "./parse";

// Filesystem loader for CWF workspaces (node-only; the parsing core in parse.ts
// stays pure). Used by both the server (command listing/CRUD) and electron (the
// Claude projector).

export function isCwfWorkspace(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, CWF_ENTRY_FILE));
  } catch {
    return false;
  }
}

function loadDir(dir: string, sub: string, fallbackType: CwfItemType): CwfItem[] {
  const abs = path.join(dir, sub);
  let entries: string[];
  try {
    entries = fs.readdirSync(abs).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const items: CwfItem[] = [];
  for (const file of entries) {
    const filePath = path.join(abs, file);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const slug = file.replace(/\.md$/, "");
      items.push(parseItem(content, { id: `${sub}/${slug}`, slug, filePath, fallbackType }));
    } catch {
      /* unreadable file — skip, per OKF tolerance */
    }
  }
  return items;
}

export function loadWorkspace(dir: string): CwfWorkspace {
  let workspace: CwfItem | null = null;
  try {
    const entry = path.join(dir, CWF_ENTRY_FILE);
    if (fs.existsSync(entry)) {
      workspace = parseItem(fs.readFileSync(entry, "utf8"), {
        id: "workspace",
        slug: "workspace",
        filePath: entry,
        fallbackType: "workspace",
      });
    }
  } catch {
    /* not a workspace */
  }
  return {
    dir,
    workspace,
    commands: loadDir(dir, CWF_DIRS.command, "command")
      .map(toCommand)
      .sort((a, b) => a.title.localeCompare(b.title)),
    agents: loadDir(dir, CWF_DIRS.agent, "agent"),
    skills: loadDir(dir, CWF_DIRS.skill, "skill"),
    templates: loadDir(dir, CWF_DIRS.template, "template"),
  };
}
