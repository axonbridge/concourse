import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inlineSlashCommand } from "../inline-command";

function makeWorkspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-inline-cmd-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

const SUMMARIZE = `---
description: Summarize the week.
custom: true
owns:
  agents: [digger]
  skills: [tone]
template: summarize
---

# Summarize

Collect the week's updates and write a summary.
`;

describe("inlineSlashCommand", () => {
  it("passes plain text through unchanged", () => {
    const dir = makeWorkspace({});
    expect(inlineSlashCommand(dir, "hello there")).toBe("hello there");
  });

  it("passes unknown /commands through unchanged", () => {
    const dir = makeWorkspace({ "commands/other.md": "---\ndescription: x\n---\n\nBody" });
    expect(inlineSlashCommand(dir, "/nope do it")).toBe("/nope do it");
  });

  it("inlines the command body plus owned agents, skills, and template", () => {
    const dir = makeWorkspace({
      "commands/summarize.md": SUMMARIZE,
      "agents/digger.md": "---\ndescription: d\n---\n\nDig through updates.",
      "skills/tone.md": "---\ndescription: t\n---\n\nKeep it crisp.",
      "templates/summarize.md": "# Weekly summary\n\n- ...",
    });
    const out = inlineSlashCommand(dir, "/summarize last week please");
    expect(out).toContain("Follow this command's instructions (/summarize):");
    expect(out).toContain("Collect the week's updates");
    expect(out).toContain("(You perform this role yourself.)");
    expect(out).toContain("Dig through updates.");
    expect(out).toContain("Keep it crisp.");
    expect(out).toContain("# Weekly summary");
    expect(out).toContain("## User request\n\nlast week please");
  });

  it("substitutes $ARGUMENTS instead of appending a request section", () => {
    const dir = makeWorkspace({
      "commands/ask.md": '---\ndescription: a\n---\n\nAnswer the question in "$ARGUMENTS" fully.',
    });
    const out = inlineSlashCommand(dir, "/ask how does auth work?");
    expect(out).toContain('Answer the question in "how does auth work?" fully.');
    expect(out).not.toContain("## User request");
  });

  it("works without a workspace.md (classic repo with a commands dir)", () => {
    const dir = makeWorkspace({
      "commands/build.md": "---\ndescription: b\n---\n\nBuild the thing.",
    });
    const out = inlineSlashCommand(dir, "/build now");
    expect(out).toContain("Build the thing.");
  });
});
