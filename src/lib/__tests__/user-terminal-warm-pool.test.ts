import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareUserTerminalWarmSlot,
  userTerminalWarmSignature,
} from "../user-terminal-warm-pool";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("user-terminal-warm-pool", () => {
  it("keys warm slots by runtime scope and cwd", () => {
    expect(userTerminalWarmSignature("/Users/dev/project")).toBe("local\0/Users/dev/project");
    expect(userTerminalWarmSignature("/tmp/worktree-a")).not.toBe(
      userTerminalWarmSignature("/tmp/worktree-b"),
    );
    expect(userTerminalWarmSignature("/tmp/worktree-a", "sb-1")).not.toBe(
      userTerminalWarmSignature("/tmp/worktree-a", "local"),
    );
  });
});
