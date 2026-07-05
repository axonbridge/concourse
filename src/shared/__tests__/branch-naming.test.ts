import { describe, expect, it } from "vitest";
import {
  isConventionalBranchName,
  slugifyBranchDescription,
  suggestConventionalBranchName,
} from "../branch-naming";

describe("isConventionalBranchName", () => {
  it("accepts <type>/<description>", () => {
    expect(isConventionalBranchName("feature/user-authentication")).toBe(true);
    expect(isConventionalBranchName("fix/memory-leak-in-uploads")).toBe(true);
    expect(isConventionalBranchName("hotfix/critical-security-patch")).toBe(true);
    expect(isConventionalBranchName("docs/update-readme")).toBe(true);
    expect(isConventionalBranchName("perf/faster-diffs")).toBe(true);
  });
  it("rejects missing or unknown prefixes", () => {
    expect(isConventionalBranchName("user-authentication")).toBe(false);
    expect(isConventionalBranchName("feat/user-auth")).toBe(false);
    expect(isConventionalBranchName("feature/")).toBe(false);
    expect(isConventionalBranchName("main")).toBe(false);
  });
});

describe("slugifyBranchDescription", () => {
  it("kebab-cases free text", () => {
    expect(slugifyBranchDescription("Login Bug!")).toBe("login-bug");
    expect(slugifyBranchDescription("two  words")).toBe("two-words");
    expect(slugifyBranchDescription("-edgy--case-")).toBe("edgy-case");
  });
});

describe("suggestConventionalBranchName", () => {
  it("keeps already-conventional names", () => {
    expect(suggestConventionalBranchName("fix/login-bug")).toBe("fix/login-bug");
  });
  it("promotes a leading type word", () => {
    expect(suggestConventionalBranchName("fix login bug")).toBe("fix/login-bug");
    expect(suggestConventionalBranchName("docs update readme")).toBe("docs/update-readme");
  });
  it("defaults to feature/ otherwise", () => {
    expect(suggestConventionalBranchName("user auth")).toBe("feature/user-auth");
    expect(suggestConventionalBranchName("UserAuth")).toBe("feature/userauth");
  });
  it("returns null when nothing usable remains", () => {
    expect(suggestConventionalBranchName("   ")).toBeNull();
    expect(suggestConventionalBranchName("///")).toBeNull();
  });
});
