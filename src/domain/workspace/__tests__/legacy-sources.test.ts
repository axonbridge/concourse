import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadWorkspace } from "../fs-loader";
import { projectClaudeWorkspace } from "../projectors/claude";
import { inlineSlashCommand } from "../inline-command";

function makeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-legacy-src-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

const CMD = (body: string) => `---\ndescription: d\n---\n\n${body}\n`;

describe("legacy .claude sources", () => {
  it("merges user-authored .claude commands into the workspace view", () => {
    const dir = makeDir({
      ".claude/commands/deploy.md": CMD("Deploy the thing."),
    });
    const ws = loadWorkspace(dir);
    expect(ws.commands.map((c) => c.slug)).toEqual(["deploy"]);
  });

  it("prefers the root CWF source on slug collisions", () => {
    const dir = makeDir({
      "commands/deploy.md": CMD("Root wins."),
      ".claude/commands/deploy.md": CMD("Legacy loses."),
    });
    const ws = loadWorkspace(dir);
    expect(ws.commands).toHaveLength(1);
    expect(ws.commands[0]!.body).toContain("Root wins.");
  });

  it("projects legacy commands to .opencode/command", () => {
    const dir = makeDir({
      ".claude/commands/deploy.md": CMD("Deploy the thing."),
    });
    expect(projectClaudeWorkspace(dir)).toBe(true);
    const projected = fs.readFileSync(path.join(dir, ".opencode/command/deploy.md"), "utf8");
    expect(projected).toContain("Deploy the thing.");
    // The repo's own identity files are never generated for classic repos.
    expect(fs.existsSync(path.join(dir, "CLAUDE.md"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
  });

  it("removes the .opencode copy when the legacy source is deleted", () => {
    const dir = makeDir({
      ".claude/commands/deploy.md": CMD("Deploy the thing."),
      "commands/keep.md": CMD("Keep me."),
    });
    projectClaudeWorkspace(dir);
    expect(fs.existsSync(path.join(dir, ".opencode/command/deploy.md"))).toBe(true);
    fs.rmSync(path.join(dir, ".claude/commands/deploy.md"));
    projectClaudeWorkspace(dir);
    expect(fs.existsSync(path.join(dir, ".opencode/command/deploy.md"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".opencode/command/keep.md"))).toBe(true);
  });

  it("does not merge the projector's own .claude copies back as sources", () => {
    const dir = makeDir({
      "workspace.md": "---\ntitle: W\n---\n\nBody",
      "commands/ask.md": CMD("Ask body."),
    });
    projectClaudeWorkspace(dir); // writes .claude/commands/ask.md + manifest
    const ws = loadWorkspace(dir);
    expect(ws.commands.filter((c) => c.slug === "ask")).toHaveLength(1);
    // Deleting the root source and re-projecting removes the copy — it must
    // not survive by being re-read as a legacy source.
    fs.rmSync(path.join(dir, "commands/ask.md"));
    projectClaudeWorkspace(dir);
    expect(loadWorkspace(dir).commands).toHaveLength(0);
  });

  it("inlines legacy commands for engines without slash support", () => {
    const dir = makeDir({
      ".claude/commands/deploy.md": CMD('Deploy "$ARGUMENTS" to prod.'),
    });
    const out = inlineSlashCommand(dir, "/deploy the api");
    expect(out).toContain('Deploy "the api" to prod.');
  });
});
