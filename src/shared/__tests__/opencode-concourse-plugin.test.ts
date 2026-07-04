import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  OPENCODE_CONCOURSE_PLUGIN_MARKER,
  opencodeConcoursePluginPath,
  opencodeConcoursePluginSource,
  writeOpencodeConcoursePlugin,
} from "../opencode-concourse-plugin";

describe("opencode concourse plugin", () => {
  it("posts lifecycle hooks to the OpenCode hooks endpoint", () => {
    const source = opencodeConcoursePluginSource();
    expect(source).toContain(OPENCODE_CONCOURSE_PLUGIN_MARKER);
    expect(source).toContain("/api/hooks/opencode");
    expect(source).toContain("session.status");
    expect(source).toContain("session.idle");
    expect(source).toContain('postConcourseHook("Stop"');
    expect(source).toContain('postConcourseHook("UserPromptSubmit"');
    expect(source).toContain('postConcourseHook("SessionStart"');
    expect(source).toContain('"PermissionRequest"');
    expect(source).toContain("CONCOURSE_TASK_ID");
    expect(source).toContain('"shell.env"');
    expect(source).toContain('"chat.message"');
    expect(source).toContain('"tool.execute.before"');
    expect(source).toContain("question.asked");
    expect(source).toContain('"QuestionRequest"');
    expect(source).toContain("electron-local");
    expect(source).toContain("export const ConcourseStatus");
  });

  it("writes the managed plugin into .opencode/plugins", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mc-opencode-plugin-"));
    writeOpencodeConcoursePlugin(cwd);

    const file = opencodeConcoursePluginPath(cwd);
    expect(fs.existsSync(file)).toBe(true);
    const contents = fs.readFileSync(file, "utf8");
    expect(contents).toContain(OPENCODE_CONCOURSE_PLUGIN_MARKER);
    expect(contents).toContain("ConcourseStatus");
  });
});
