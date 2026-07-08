import { describe, expect, it } from "vitest";
import {
  filesToKnowledgeBundle,
  isKnowledgeBundle,
  knowledgeBundleToFiles,
  looksLikeKnowledgeBundle,
  type KnowledgeBundle,
} from "../okf-bundle";
import { factTimestampMs, flagForExport, stampImported } from "../bundle-guard";

const FACT = `---
type: fact
title: Jira story points field
description: Story points live in customfield_10024
timestamp: 2026-07-01
---

The fact body.
`;

function sampleBundle(): KnowledgeBundle {
  return {
    version: 1,
    kind: "knowledge",
    title: "Leadership knowledge handoff",
    facts: [{ name: "jira-story-points-field", content: FACT }],
    notes: [{ name: "2026-07-01-retro", content: "---\ntype: meeting-notes\n---\n\nnotes" }],
    workflows: [
      {
        version: 1,
        command: { name: "weekly-summary", content: "---\ntype: command\n---\n\nbody" },
        agents: [{ name: "metrics-aggregator", content: "agent body" }],
        skills: [],
      },
    ],
  };
}

describe("knowledge bundle serialization", () => {
  it("round-trips facts, notes, and workflows through the folder shape", () => {
    const files = knowledgeBundleToFiles(sampleBundle());
    expect(files["knowledge/facts/jira-story-points-field.md"]).toBe(FACT);
    expect(files["workflows/weekly-summary/commands/weekly-summary.md"]).toContain("body");
    expect(files["index.md"]).toContain("type: knowledge-bundle");

    const back = filesToKnowledgeBundle(files);
    expect(isKnowledgeBundle(back)).toBe(true);
    expect(back.title).toBe("Leadership knowledge handoff");
    expect(back.facts).toHaveLength(1);
    expect(back.notes).toHaveLength(1);
    expect(back.workflows).toHaveLength(1);
    expect(back.workflows[0]!.command.name).toBe("weekly-summary");
    expect(back.workflows[0]!.agents).toHaveLength(1);
  });

  it("detects knowledge bundles vs plain workflow bundles", () => {
    expect(looksLikeKnowledgeBundle(knowledgeBundleToFiles(sampleBundle()))).toBe(true);
    expect(looksLikeKnowledgeBundle({ "commands/x.md": "cmd" })).toBe(false);
  });

  it("rejects folders with neither facts nor workflows", () => {
    expect(() => filesToKnowledgeBundle({ "readme.md": "hi" })).toThrow(/Not a knowledge bundle/);
  });
});

describe("export guard", () => {
  it("passes a clean fact", () => {
    expect(flagForExport(FACT)).toEqual([]);
  });

  it("flags secrets", () => {
    const flags = flagForExport(`token: ghp_${"a".repeat(36)}`);
    expect(flags.some((f) => f.kind === "secret")).toBe(true);
  });

  it("flags machine-absolute paths", () => {
    const flags = flagForExport("see /Users/jesusguzman/repos/x/file.ts");
    expect(flags.some((f) => f.kind === "machine-path")).toBe(true);
  });

  it("flags point-in-time facts", () => {
    const fact = `---\ntype: fact\nkind: point-in-time\ncaptured: 2026-07-06T10:32:00Z\n---\n\nburned 4.5 SP`;
    expect(flagForExport(fact).some((f) => f.kind === "point-in-time")).toBe(true);
  });
});

describe("import helpers", () => {
  it("reads fact timestamps for the keep-newer policy", () => {
    expect(factTimestampMs(FACT)).toBe(Date.parse("2026-07-01"));
    expect(factTimestampMs("no frontmatter")).toBeNull();
  });

  it("stamps provenance idempotently", () => {
    const once = stampImported(FACT, "Leadership handoff", "2026-07-06");
    expect(once).toContain('imported: "2026-07-06 from Leadership handoff"');
    const twice = stampImported(once, "Leadership handoff", "2026-07-07");
    expect(twice.match(/^imported:/gm)).toHaveLength(1);
    expect(twice).toContain("2026-07-07");
    // Body untouched.
    expect(twice).toContain("The fact body.");
  });

  it("stamps files without frontmatter by adding one", () => {
    const stamped = stampImported("just text", "b", "2026-07-06");
    expect(stamped.startsWith("---\n")).toBe(true);
    expect(stamped).toContain("just text");
  });
});
