import { describe, expect, it } from "vitest";
import { decideAction } from "../action-policy";

describe("decideAction", () => {
  it("allows reads, gates writes/execute/external-writes by default", () => {
    expect(decideAction("read")).toBe("allow");
    expect(decideAction("external-read")).toBe("allow");
    expect(decideAction("write")).toBe("ask");
    expect(decideAction("execute")).toBe("ask");
    expect(decideAction("external-write")).toBe("ask");
  });

  it("autoApproveWrites only unlocks local writes", () => {
    const cfg = { autoApproveWrites: true };
    expect(decideAction("write", cfg)).toBe("allow");
    expect(decideAction("execute", cfg)).toBe("ask");
    expect(decideAction("external-write", cfg)).toBe("ask");
  });

  it("dangerouslySkipApprovals allows every class", () => {
    const cfg = { dangerouslySkipApprovals: true };
    expect(decideAction("read", cfg)).toBe("allow");
    expect(decideAction("write", cfg)).toBe("allow");
    expect(decideAction("execute", cfg)).toBe("allow");
    expect(decideAction("external-write", cfg)).toBe("allow");
  });
});
