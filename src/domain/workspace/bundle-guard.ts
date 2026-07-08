// Export guard for knowledge handoff bundles (agreed 2026-07-06): before a
// fact leaves the machine it is checked for (a) secrets — patterns lifted from
// scripts/scan-secrets.mjs, (b) machine-absolute paths (a shared file must
// never leak /Users/<name>/…), and (c) point-in-time kind — snapshots are
// stale by the time a bundle is opened, so they never ship. Pure module: takes
// (name, content), returns flags; callers decide UI treatment.

import { SECRET_RULES } from "../policy/secret-rules";

const MACHINE_PATH_RE = /(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|[A-Z]:\\Users\\[A-Za-z0-9._-]+)/;

export type ExportFlag =
  | { kind: "secret"; detail: string }
  | { kind: "machine-path"; detail: string }
  | { kind: "point-in-time"; detail: string };

/** Flags that make a file unsafe or pointless to share. Empty array = clean. */
export function flagForExport(content: string): ExportFlag[] {
  const flags: ExportFlag[] = [];
  for (const p of SECRET_RULES) {
    if (p.re.test(content)) flags.push({ kind: "secret", detail: p.description });
  }
  const pathMatch = MACHINE_PATH_RE.exec(content);
  if (pathMatch) flags.push({ kind: "machine-path", detail: pathMatch[0] });
  if (/^kind:\s*point-in-time\s*$/m.test(fmBlock(content))) {
    flags.push({ kind: "point-in-time", detail: "snapshot — stale on arrival" });
  }
  return flags;
}

/** The YAML frontmatter block of a markdown file ("" when absent). */
export function fmBlock(content: string): string {
  return content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? "";
}

/** The `timestamp:` (or `captured:`) frontmatter value as epoch ms, or null. */
export function factTimestampMs(content: string): number | null {
  const fm = fmBlock(content);
  const raw =
    fm.match(/^timestamp:\s*["']?(.+?)["']?\s*$/m)?.[1] ??
    fm.match(/^captured:\s*["']?(.+?)["']?\s*$/m)?.[1];
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/** Stamp provenance into a fact's frontmatter on import (idempotent by key). */
export function stampImported(content: string, from: string, isoDate: string): string {
  const fence = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const line = `imported: "${isoDate} from ${from.replace(/"/g, "'")}"`;
  if (!fence) return `---\n${line}\n---\n\n${content}`;
  const fm = fence[1]!.replace(/^imported:.*$/m, "").trimEnd();
  return `---\n${fm}\n${line}\n---${content.slice(fence[0].length)}`;
}
