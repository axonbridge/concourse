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

// ── Legacy .claude sources ────────────────────────────────────────────────────
// A classic repo's user-authored .claude/{commands,agents,skills,templates} are
// treated as a legacy SOURCE location so every engine picks them up — not just
// Claude. Files the projector itself wrote into .claude (listed in its
// manifest) are projections of the root source, never merged back.

const PROJECTION_MANIFEST = "concourse-projection.json";

function projectionOwnedFiles(dir: string): Set<string> {
  try {
    const raw = fs.readFileSync(path.join(dir, ".claude", PROJECTION_MANIFEST), "utf8");
    const parsed = JSON.parse(raw) as { ownedFiles?: unknown };
    return new Set(Array.isArray(parsed.ownedFiles) ? (parsed.ownedFiles as string[]) : []);
  } catch {
    return new Set();
  }
}

/** User-authored .claude/<sub>/*.md files (projection artifacts excluded). */
export function legacyClaudeSources(dir: string, sub: string): string[] {
  const owned = projectionOwnedFiles(dir);
  try {
    return fs
      .readdirSync(path.join(dir, ".claude", sub))
      .filter((f) => f.endsWith(".md") && !owned.has(path.join(".claude", sub, f)))
      .sort();
  } catch {
    return [];
  }
}

function loadLegacyDir(dir: string, sub: string, fallbackType: CwfItemType): CwfItem[] {
  const items: CwfItem[] = [];
  for (const file of legacyClaudeSources(dir, sub)) {
    const filePath = path.join(dir, ".claude", sub, file);
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

/** Root CWF items merged with user-authored legacy .claude ones; root wins on
 *  slug collisions (the neutral source is canonical). */
function loadMergedDir(dir: string, sub: string, fallbackType: CwfItemType): CwfItem[] {
  const root = loadDir(dir, sub, fallbackType);
  const seen = new Set(root.map((i) => i.slug));
  const legacy = loadLegacyDir(dir, sub, fallbackType).filter((i) => !seen.has(i.slug));
  return [...root, ...legacy];
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
    commands: loadMergedDir(dir, CWF_DIRS.command, "command")
      .map(toCommand)
      .sort((a, b) => a.title.localeCompare(b.title)),
    agents: loadMergedDir(dir, CWF_DIRS.agent, "agent"),
    skills: loadMergedDir(dir, CWF_DIRS.skill, "skill"),
    templates: loadMergedDir(dir, CWF_DIRS.template, "template"),
  };
}
