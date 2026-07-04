import { describe, expect, it } from "vitest";
import { bundleToFiles, filesToBundle, type CommandBundle } from "../okf-bundle";

const SAMPLE: CommandBundle = {
  version: 1,
  command: { name: "weekly-summary", content: "---\ndescription: Weekly\n---\n\n# /weekly-summary\n" },
  agents: [{ name: "metrics-aggregator", content: "---\nname: metrics-aggregator\n---\nbody" }],
  skills: [{ name: "kpi-definitions", content: "# KPIs" }],
  template: { name: "weekly-summary", content: "# Template" },
};

describe("OKF bundle serialization", () => {
  it("round-trips a full bundle through the folder shape", () => {
    const files = bundleToFiles(SAMPLE);
    expect(Object.keys(files).sort()).toEqual([
      "agents/metrics-aggregator.md",
      "commands/weekly-summary.md",
      "index.md",
      "skills/kpi-definitions.md",
      "templates/weekly-summary.md",
    ]);
    expect(files["index.md"]).toContain("type: bundle");
    expect(files["index.md"]).toContain("command: weekly-summary");
    expect(files["index.md"]).toContain("[agent: metrics-aggregator](agents/metrics-aggregator.md)");

    const back = filesToBundle(files);
    expect(back).toEqual(SAMPLE);
  });

  it("survives a missing index.md (structure is the truth)", () => {
    const files = bundleToFiles(SAMPLE);
    delete files["index.md"];
    const back = filesToBundle(files);
    expect(back.command.name).toBe("weekly-summary");
    expect(back.agents).toHaveLength(1);
  });

  it("rejects a folder with no command", () => {
    expect(() => filesToBundle({ "skills/x.md": "hi" })).toThrow(/no commands/);
  });
});
