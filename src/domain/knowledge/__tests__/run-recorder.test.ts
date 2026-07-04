import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { outputPathFromToolSummary, recordRun } from "../run-recorder";

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cwf-knowledge-"));
}

function cwfWorkspace(): string {
  const dir = tmpWorkspace();
  fs.writeFileSync(path.join(dir, "workspace.md"), "---\ntype: workspace\n---\n");
  return dir;
}

describe("recordRun", () => {
  it("creates the knowledge scaffold, run record, index, and log", () => {
    const dir = cwfWorkspace();
    const rel = recordRun({
      workspaceDir: dir,
      command: "weekly-summary",
      engine: "claude-code",
      model: "opus",
      startedAt: new Date("2026-07-03T10:00:00"),
      finishedAt: new Date("2026-07-03T10:04:10"),
      outputs: ["summaries/weekly/2026-07-03.md"],
      status: "completed",
    });

    expect(rel).toBe("knowledge/runs/2026-07-03-weekly-summary.md");
    const record = fs.readFileSync(path.join(dir, rel), "utf8");
    expect(record).toContain("type: run-record");
    expect(record).toContain("command: /commands/weekly-summary.md");
    expect(record).toContain("engine: claude-code");
    expect(record).toContain("model: opus");
    expect(record).toContain("4m 10s");
    expect(record).toContain("[summaries/weekly/2026-07-03.md](/summaries/weekly/2026-07-03.md)");

    const index = fs.readFileSync(path.join(dir, "knowledge/index.md"), "utf8");
    expect(index).toContain("type: index");
    const log = fs.readFileSync(path.join(dir, "knowledge/log.md"), "utf8");
    expect(log).toContain("[/weekly-summary](/knowledge/runs/2026-07-03-weekly-summary.md)");
    expect(fs.existsSync(path.join(dir, "knowledge/facts"))).toBe(true);
  });

  it("suffixes same-day reruns and appends to the existing log", () => {
    const dir = cwfWorkspace();
    const base = {
      workspaceDir: dir,
      command: "okr-review",
      engine: "openrouter",
      startedAt: new Date("2026-07-03T09:00:00"),
      finishedAt: new Date("2026-07-03T09:00:45"),
      outputs: [],
      status: "completed" as const,
    };
    expect(recordRun(base)).toBe("knowledge/runs/2026-07-03-okr-review.md");
    expect(recordRun(base)).toBe("knowledge/runs/2026-07-03-okr-review-2.md");
    const log = fs.readFileSync(path.join(dir, "knowledge/log.md"), "utf8");
    expect(log.match(/okr-review/g)!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("run record root (non-CWF projects)", () => {
  it("writes records to the .concourse overlay and adds a local git exclude", () => {
    const dir = tmpWorkspace(); // no workspace.md → NOT a CWF workspace
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    const rel = recordRun({
      workspaceDir: dir,
      command: "ask",
      engine: "claude-code",
      startedAt: new Date("2026-07-03T10:00:00"),
      finishedAt: new Date("2026-07-03T10:00:30"),
      outputs: [],
      status: "completed",
    });
    expect(rel).toBe(".concourse/knowledge/runs/2026-07-03-ask.md");
    expect(fs.existsSync(path.join(dir, ".concourse/knowledge/log.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "knowledge"))).toBe(false); // repo untouched
    const exclude = fs.readFileSync(path.join(dir, ".git/info/exclude"), "utf8");
    expect(exclude).toContain(".concourse/");
    // Idempotent: a second run doesn't duplicate the exclude entry.
    recordRun({
      workspaceDir: dir,
      command: "ask",
      engine: "claude-code",
      startedAt: new Date("2026-07-03T11:00:00"),
      finishedAt: new Date("2026-07-03T11:00:30"),
      outputs: [],
      status: "completed",
    });
    const again = fs.readFileSync(path.join(dir, ".git/info/exclude"), "utf8");
    expect(again.match(/\.concourse\//g)!.length).toBe(1);
  });

  it("keeps CWF workspaces writing to knowledge/ directly", () => {
    const dir = tmpWorkspace();
    fs.writeFileSync(path.join(dir, "workspace.md"), "---\ntype: workspace\n---\n");
    const rel = recordRun({
      workspaceDir: dir,
      command: "ask",
      engine: "claude-code",
      startedAt: new Date("2026-07-03T10:00:00"),
      finishedAt: new Date("2026-07-03T10:00:30"),
      outputs: [],
      status: "completed",
    });
    expect(rel).toBe("knowledge/runs/2026-07-03-ask.md");
    expect(fs.existsSync(path.join(dir, ".concourse"))).toBe(false);
  });
});

describe("outputPathFromToolSummary", () => {
  const ws = "/tmp/ws";
  it("parses Claude's absolute-path summary into a workspace-relative path", () => {
    expect(
      outputPathFromToolSummary("Create or overwrite file: /tmp/ws/summaries/weekly/x.md", ws),
    ).toBe("summaries/weekly/x.md");
  });
  it("parses the direct engine's relative Write summary", () => {
    expect(outputPathFromToolSummary("Write summaries/weekly/x.md", ws)).toBe(
      "summaries/weekly/x.md",
    );
  });
  it("drops paths outside the workspace and knowledge self-writes", () => {
    expect(outputPathFromToolSummary("Create or overwrite file: /etc/passwd", ws)).toBeNull();
    expect(outputPathFromToolSummary("Write knowledge/facts/x.md", ws)).toBeNull();
  });
});
