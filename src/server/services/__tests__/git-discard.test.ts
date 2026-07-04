import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-git-discard-test-"));
process.env.CONCOURSE_USER_DATA_DIR = tmpRoot;

const { createProject } = await import("../projects");
const { discardFileChanges, getGitStatus, stageFiles } = await import("../git");
const { getDb } = await import("~/db/client");
const { appSettings, groups, projects, tasks, worktrees } = await import("~/db/schema");

let tempDirs: string[] = [];

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-discard-repo-"));
  tempDirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
  git("init", "--initial-branch=main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "committed.txt"), "original\n", "utf8");
  git("add", ".");
  git("commit", "-m", "init");
  return dir;
}

describe("discardFileChanges", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(tasks).run();
    db.delete(worktrees).run();
    db.delete(projects).run();
    db.delete(groups).run();
    db.delete(appSettings).run();
  });

  afterAll(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("restores an edited tracked file to its committed content", async () => {
    const dir = makeRepo();
    const project = createProject({ name: "p", path: dir });
    fs.writeFileSync(path.join(dir, "committed.txt"), "edited\n", "utf8");

    await discardFileChanges(project.id, "committed.txt");
    expect(fs.readFileSync(path.join(dir, "committed.txt"), "utf8")).toBe("original\n");
    const status = await getGitStatus(project.id);
    expect(status.staged).toHaveLength(0);
    expect(status.unstaged).toHaveLength(0);
  });

  it("discards staged edits too", async () => {
    const dir = makeRepo();
    const project = createProject({ name: "p", path: dir });
    fs.writeFileSync(path.join(dir, "committed.txt"), "edited\n", "utf8");
    await stageFiles(project.id, ["committed.txt"]);

    await discardFileChanges(project.id, "committed.txt");
    expect(fs.readFileSync(path.join(dir, "committed.txt"), "utf8")).toBe("original\n");
  });

  it("removes an untracked file from disk", async () => {
    const dir = makeRepo();
    const project = createProject({ name: "p", path: dir });
    fs.writeFileSync(path.join(dir, "new.txt"), "hello\n", "utf8");

    await discardFileChanges(project.id, "new.txt");
    expect(fs.existsSync(path.join(dir, "new.txt"))).toBe(false);
  });

  it("removes a newly-added staged file (not in HEAD)", async () => {
    const dir = makeRepo();
    const project = createProject({ name: "p", path: dir });
    fs.writeFileSync(path.join(dir, "new.txt"), "hello\n", "utf8");
    await stageFiles(project.id, ["new.txt"]);

    await discardFileChanges(project.id, "new.txt");
    expect(fs.existsSync(path.join(dir, "new.txt"))).toBe(false);
    const status = await getGitStatus(project.id);
    expect(status.staged).toHaveLength(0);
  });

  it("restores a deleted tracked file", async () => {
    const dir = makeRepo();
    const project = createProject({ name: "p", path: dir });
    fs.rmSync(path.join(dir, "committed.txt"));

    await discardFileChanges(project.id, "committed.txt");
    expect(fs.readFileSync(path.join(dir, "committed.txt"), "utf8")).toBe("original\n");
  });

  it("rejects paths outside the project root", async () => {
    const dir = makeRepo();
    const project = createProject({ name: "p", path: dir });
    await expect(discardFileChanges(project.id, "../outside.txt")).rejects.toThrow(
      /escapes project root/,
    );
  });
});
