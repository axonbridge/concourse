#!/usr/bin/env node
// Mass brand rename: rewrites every case variant of the old brand across all
// git-tracked files, then renames files/dirs whose names contain a variant.
// Usage: node scripts/rename-brand.mjs [--dry-run]
//
// pnpm-lock.yaml is skipped on purpose — regenerate it with `pnpm install`.
// Registry package names that must keep resolving (npm deps) should be
// re-pointed via an npm: alias in package.json after running this.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Ordered longest-first so hyphen/underscore variants win before bare words.
const REPLACEMENTS = [
  ["Mission-Control", "Concourse"],
  ["mission-control", "concourse"],
  ["MISSION_CONTROL", "CONCOURSE"],
  ["MissionControl", "Concourse"],
  ["missionControl", "concourse"],
  ["missioncontrol", "concourse"],
  ["Mission Control", "Concourse"],
  ["mission control", "concourse"],
];

const SKIP_FILES = new Set(["pnpm-lock.yaml", "scripts/rename-brand.mjs"]);
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".icns", ".ico", ".pdf",
  ".woff", ".woff2", ".ttf", ".otf", ".node", ".zip", ".dmg",
]);

const dryRun = process.argv.includes("--dry-run");
const root = process.cwd();

function applyAll(text) {
  let out = text;
  let hits = 0;
  for (const [from, to] of REPLACEMENTS) {
    const parts = out.split(from);
    hits += parts.length - 1;
    out = parts.join(to);
  }
  return { out, hits };
}

const files = execSync("git ls-files -z", { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((f) => !SKIP_FILES.has(f));

let totalHits = 0;
let changedFiles = 0;

for (const rel of files) {
  if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
  const abs = path.join(root, rel);
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) continue; // binary safety net
  const { out, hits } = applyAll(buf.toString("utf8"));
  if (hits === 0) continue;
  totalHits += hits;
  changedFiles += 1;
  console.log(`${dryRun ? "[dry] " : ""}${rel}: ${hits} replacement(s)`);
  if (!dryRun) fs.writeFileSync(abs, out, "utf8");
}

// Rename paths (deepest first so children move before their parents).
const toRename = files
  .map((rel) => ({ rel, next: applyAll(rel).out }))
  .filter(({ rel, next }) => rel !== next)
  .sort((a, b) => b.rel.split("/").length - a.rel.split("/").length);

for (const { rel, next } of toRename) {
  console.log(`${dryRun ? "[dry] " : ""}rename: ${rel} -> ${next}`);
  if (dryRun) continue;
  fs.mkdirSync(path.dirname(path.join(root, next)), { recursive: true });
  fs.renameSync(path.join(root, rel), path.join(root, next));
}

console.log(
  `\n${dryRun ? "[dry-run] " : ""}${totalHits} replacements in ${changedFiles} files; ${toRename.length} paths renamed.`,
);
