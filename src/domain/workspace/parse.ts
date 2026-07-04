import type { CwfCommand, CwfFrontmatter, CwfItem, CwfItemType } from "./types";

// Pure CWF parsing — no filesystem, no vendor imports. Handles the YAML subset
// our files actually use (scalars, inline lists, one-level block lists under a
// key), preserving unknown keys per OKF's round-trip rule.

const FENCE_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

function unquote(v: string): string {
  return v.trim().replace(/^["']|["']$/g, "");
}

/** Parse a frontmatter block into a flat record. Block lists become string[];
 *  nested block maps (e.g. `owns:` with `agents:`/`skills:` children) are
 *  flattened to dotted keys (`owns.agents`). */
export function parseFrontmatter(content: string): { frontmatter: CwfFrontmatter; body: string } {
  const m = content.match(FENCE_RE);
  if (!m) return { frontmatter: {}, body: content };
  const body = content.slice(m[0].length);
  const frontmatter: CwfFrontmatter = {};
  const lines = m[1].split("\n");
  let i = 0;
  const readList = (startIndent: number): { items: string[]; next: number } => {
    const items: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      const lm = line.match(/^(\s*)-\s*(.+?)\s*$/);
      if (!lm || lm[1].length < startIndent) break;
      items.push(unquote(lm[2]));
      i++;
    }
    return { items, next: i };
  };
  while (i < lines.length) {
    const line = lines[i];
    const km = line.match(/^(\s*)([A-Za-z_][\w.-]*):\s*(.*)$/);
    if (!km) {
      i++;
      continue;
    }
    const [, indent, key, rawValue] = km;
    const value = rawValue.trim();
    i++;
    const fullKey = indent.length === 0 ? key : null; // top-level only; nested handled below
    if (value === "" || value === "|" || value === ">") {
      // Could be a block list or a nested map (one level deep).
      if (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const { items } = readList(indent.length + 1);
        if (fullKey) frontmatter[fullKey] = items;
        continue;
      }
      // Nested map: read child keys at deeper indent → dotted keys.
      while (i < lines.length) {
        const child = lines[i].match(/^(\s+)([A-Za-z_][\w.-]*):\s*(.*)$/);
        if (!child || child[1].length <= indent.length) break;
        const childKey = `${key}.${child[2]}`;
        const childVal = child[3].trim();
        i++;
        if (childVal.startsWith("[")) {
          frontmatter[childKey] = childVal
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map(unquote)
            .filter(Boolean);
        } else if (childVal === "") {
          const { items } = readList(child[1].length + 1);
          frontmatter[childKey] = items;
        } else {
          frontmatter[childKey] = unquote(childVal);
        }
      }
      continue;
    }
    if (!fullKey) continue;
    if (value.startsWith("[")) {
      frontmatter[fullKey] = value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map(unquote)
        .filter(Boolean);
    } else if (value === "true" || value === "false") {
      frontmatter[fullKey] = value === "true";
    } else {
      frontmatter[fullKey] = unquote(value);
    }
  }
  return { frontmatter, body };
}

function asString(v: CwfFrontmatter[string] | undefined): string {
  return typeof v === "string" ? v : "";
}

function asList(v: CwfFrontmatter[string] | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v) return [v];
  return [];
}

export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Build a CwfItem from file content. `id` is the workspace-relative path
 *  without extension (OKF concept id). */
export function parseItem(
  content: string,
  opts: { id: string; slug: string; filePath: string; fallbackType: CwfItemType },
): CwfItem {
  const { frontmatter, body } = parseFrontmatter(content);
  const type = (asString(frontmatter.type) || opts.fallbackType) as CwfItemType;
  return {
    id: opts.id,
    type,
    slug: opts.slug,
    title: asString(frontmatter.title) || humanizeSlug(opts.slug),
    description: asString(frontmatter.description),
    frontmatter,
    body,
    filePath: opts.filePath,
  };
}

/** Examples for the chat intro: frontmatter `examples:` list first, else quoted
 *  `e.g. "…"` phrases in the body (same behavior the picker has always had). */
export function commandExamples(item: CwfItem): string[] {
  const fromFm = asList(item.frontmatter.examples).slice(0, 3);
  if (fromFm.length > 0) return fromFm;
  const out: string[] = [];
  for (const m of item.body.matchAll(/e\.g\.,?\s*"([^"]{6,90})"/gi)) {
    const v = m[1].trim();
    if (!out.includes(v)) out.push(v);
    if (out.length >= 3) break;
  }
  return out;
}

export function toCommand(item: CwfItem): CwfCommand {
  return {
    ...item,
    type: "command",
    examples: commandExamples(item),
    custom: item.frontmatter.custom === true,
    owns: {
      agents: asList(item.frontmatter["owns.agents"]),
      skills: asList(item.frontmatter["owns.skills"]),
    },
    template: asString(item.frontmatter.template) || undefined,
    icon: asString(item.frontmatter.icon) || undefined,
  };
}
