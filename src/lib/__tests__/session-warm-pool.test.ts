import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSessionPayload } from "../session-warm-pool";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session-warm-pool", () => {
  it("builds default payload from saved agent settings", () => {
    expect(
      defaultSessionPayload({
        branch: "main",
        rememberAgentSettings: true,
        savedAgent: "codex",
        savedSkipPermissions: true,
      }),
    ).toEqual({
      agent: "codex",
      branch: "main",
      skipPermissions: true,
      bareSession: false,
    });
  });

  it("falls back to claude-code when nothing is saved", () => {
    expect(
      defaultSessionPayload({
        branch: "dev",
        rememberAgentSettings: false,
      }),
    ).toEqual({
      agent: "claude-code",
      branch: "dev",
      skipPermissions: false,
      bareSession: false,
    });
  });

  it("remembers skip permissions without remembered agent settings", () => {
    expect(
      defaultSessionPayload({
        branch: "dev",
        rememberAgentSettings: false,
        savedSkipPermissions: true,
      }),
    ).toEqual({
      agent: "claude-code",
      branch: "dev",
      skipPermissions: true,
      bareSession: false,
    });
  });

  it("uses the last selected agent without remembered agent settings", () => {
    expect(
      defaultSessionPayload({
        branch: "dev",
        rememberAgentSettings: false,
        savedAgent: "cursor-cli",
        savedSkipPermissions: true,
      }),
    ).toEqual({
      agent: "cursor-cli",
      branch: "dev",
      skipPermissions: true,
      bareSession: false,
    });
  });

});
