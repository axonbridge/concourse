import { describe, expect, it } from "vitest";
import { parseFrontmatter, parseItem, toCommand, humanizeSlug } from "../parse";

const COMMAND_MD = `---
title: "Sprint Ticket Export"
icon: 🚀
description: Export the PPI active sprint's tickets to Excel.
examples:
  - "Export the current active sprint tickets to Excel"
  - "/sprint-ticket-export"
custom: true
template: sprint-ticket-export
owns:
  agents: [sprint-ticket-export-fetcher]
  skills:
    - sprint-ticket-export-conventions
unknown_key: keep me
---

# /sprint-ticket-export

Body text here. e.g. "run the export"
`;

describe("CWF parse", () => {
  it("parses scalars, lists, booleans, and nested owns", () => {
    const { frontmatter, body } = parseFrontmatter(COMMAND_MD);
    expect(frontmatter.title).toBe("Sprint Ticket Export");
    expect(frontmatter.icon).toBe("🚀");
    expect(frontmatter.custom).toBe(true);
    expect(frontmatter.examples).toEqual([
      "Export the current active sprint tickets to Excel",
      "/sprint-ticket-export",
    ]);
    expect(frontmatter["owns.agents"]).toEqual(["sprint-ticket-export-fetcher"]);
    expect(frontmatter["owns.skills"]).toEqual(["sprint-ticket-export-conventions"]);
    // OKF round-trip rule: unknown keys preserved.
    expect(frontmatter.unknown_key).toBe("keep me");
    expect(body).toContain("# /sprint-ticket-export");
  });

  it("builds a CwfCommand with examples, owns, template, icon", () => {
    const item = parseItem(COMMAND_MD, {
      id: "commands/sprint-ticket-export",
      slug: "sprint-ticket-export",
      filePath: "/x/commands/sprint-ticket-export.md",
      fallbackType: "command",
    });
    const cmd = toCommand(item);
    expect(cmd.title).toBe("Sprint Ticket Export");
    expect(cmd.custom).toBe(true);
    expect(cmd.template).toBe("sprint-ticket-export");
    expect(cmd.icon).toBe("🚀");
    expect(cmd.owns.agents).toEqual(["sprint-ticket-export-fetcher"]);
    expect(cmd.owns.skills).toEqual(["sprint-ticket-export-conventions"]);
    expect(cmd.examples[0]).toContain("Export the current");
  });

  it("falls back: no frontmatter → body-only item with humanized title", () => {
    const item = parseItem("Just a body, no fence. e.g. \"try this thing\"", {
      id: "commands/weekly-summary",
      slug: "weekly-summary",
      filePath: "/x/commands/weekly-summary.md",
      fallbackType: "command",
    });
    expect(item.title).toBe("Weekly Summary");
    expect(item.description).toBe("");
    const cmd = toCommand(item);
    expect(cmd.custom).toBe(false);
    expect(cmd.examples).toEqual(["try this thing"]);
  });

  it("humanizes slugs", () => {
    expect(humanizeSlug("okr-review")).toBe("Okr Review");
    expect(humanizeSlug("create_stories")).toBe("Create Stories");
  });
});
