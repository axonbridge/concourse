import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-tasks-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

const { createProject } = await import("../projects");
const { createTask, listTasksForProjectWorktree } = await import("../tasks");
const { getDb } = await import("~/db/client");
const { projects, tasks, userTerminals, worktrees } = await import("~/db/schema");

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-task-project-"));
  return createProject({ name: "p", path: dir });
}

describe("tasks service", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(userTerminals).run();
    db.delete(worktrees).run();
    db.delete(tasks).run();
    db.delete(projects).run();
  });

  it("coerces any scope id to local", () => {
    const p = makeProject();
    createTask({ projectId: p.id, title: "Local", agent: "claude-code", scopeId: "local" });
    createTask({ projectId: p.id, title: "Legacy", agent: "claude-code", scopeId: "sb-1" });

    expect(
      listTasksForProjectWorktree(p.id, null, "local").map((task) => task.title).sort(),
    ).toEqual(["Legacy", "Local"]);
  });
});
