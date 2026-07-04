import { describe, expect, it } from "vitest";
import {
  buildLocalConcourseApiUrl,
  buildSyntheticHookUrl,
} from "../pty-hook-env";

describe("PTY hook env", () => {
  it("builds Concourse API URLs only for valid local ports", () => {
    expect(buildLocalConcourseApiUrl(5173)).toBe("http://127.0.0.1:5173");
    expect(buildLocalConcourseApiUrl(null)).toBeNull();
    expect(buildLocalConcourseApiUrl(0)).toBeNull();
    expect(buildLocalConcourseApiUrl(65536)).toBeNull();
  });

  it("builds synthetic hook URLs from a loopback Concourse origin", () => {
    expect(
      buildSyntheticHookUrl(
        { apiUrl: "http://127.0.0.1:5173", token: "secret" },
        "codex",
        "task 1",
      ),
    ).toBe("http://127.0.0.1:5173/api/hooks/codex?taskId=task+1");
    expect(
      buildSyntheticHookUrl(
        { apiUrl: "http://127.0.0.1:5173", token: "secret" },
        "opencode",
        "task 2",
      ),
    ).toBe("http://127.0.0.1:5173/api/hooks/opencode?taskId=task+2");
  });

  it("rejects renderer-style attacker and internal-network hook origins", () => {
    for (const apiUrl of [
      "https://127.0.0.1:5173",
      "http://localhost:5173",
      "http://attacker.test",
      "http://169.254.169.254",
      "http://192.168.1.1",
    ]) {
      expect(
        buildSyntheticHookUrl({ apiUrl, token: "secret" }, "claude-code", "task"),
      ).toBeNull();
    }
  });
});
