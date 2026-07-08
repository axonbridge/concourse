import { describe, expect, it } from "vitest";
import {
  analyzeCommandForCredentials,
  isSecretEnvVar,
  scrubEnv,
  shannonEntropy,
} from "../secret-rules";

describe("analyzeCommandForCredentials", () => {
  it("flags auth headers", () => {
    const r = analyzeCommandForCredentials(
      `curl -s -H "Authorization: Bearer $BUILDER_API_KEY" https://cdn.builder.io/api/v3/content`,
    );
    expect(r.flagged).toBe(true);
    expect(r.reasons.join()).toMatch(/env var|auth header/);
  });

  it("flags literal tokens", () => {
    expect(analyzeCommandForCredentials(`echo ghp_${"a".repeat(36)}`).flagged).toBe(true);
    expect(analyzeCommandForCredentials(`export STRIPE=sk_live_${"a".repeat(20)}`).flagged).toBe(true);
  });

  it("flags env dumps and credential-store reads", () => {
    expect(analyzeCommandForCredentials("printenv | sort").flagged).toBe(true);
    expect(analyzeCommandForCredentials("cat ~/.aws/credentials").flagged).toBe(true);
    expect(analyzeCommandForCredentials("cat .env.production").flagged).toBe(true);
  });

  it("granted env vars are the sanctioned pathway — logged, not flagged", () => {
    const granted = new Set(["BUILDER_API_KEY"]);
    const r = analyzeCommandForCredentials(
      `curl -s -H "Authorization: Bearer $BUILDER_API_KEY" https://cdn.builder.io/api/v3/content`,
      granted,
    );
    expect(r.flagged).toBe(false);
    expect(r.grantedUse).toEqual(["BUILDER_API_KEY"]);
    // A different, ungranted var still flags.
    const r2 = analyzeCommandForCredentials(`echo $STRIPE_SECRET_KEY`, granted);
    expect(r2.flagged).toBe(true);
    // Literal tokens flag even when vars are granted.
    const r3 = analyzeCommandForCredentials(`echo ghp_${"a".repeat(36)} $BUILDER_API_KEY`, granted);
    expect(r3.flagged).toBe(true);
  });

  it("does not flag ordinary commands", () => {
    for (const cmd of [
      "grep -rn 'ltvConversion' apps/dtc-agent/src",
      "ls -la /Users/x/repos/project",
      "git log --oneline -5",
      "curl -s https://example.com/health",
      "npm run build",
    ]) {
      expect(analyzeCommandForCredentials(cmd).flagged).toBe(false);
    }
  });
});

describe("env scrubbing", () => {
  it("strips secret-named vars and keeps normal ones", () => {
    const { env, stripped } = scrubEnv({
      PATH: "/usr/bin",
      HOME: "/Users/x",
      BUILDER_API_KEY: "bpk-abc123def456ghi789",
      GITHUB_TOKEN: `ghp_${"a".repeat(36)}`,
      NODE_ENV: "production",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.NODE_ENV).toBe("production");
    expect(env.BUILDER_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(stripped.sort()).toEqual(["BUILDER_API_KEY", "GITHUB_TOKEN"]);
  });

  it("strips token-shaped values even under innocent names", () => {
    expect(isSecretEnvVar("DEPLOY_HELPER", `ghp_${"x".repeat(36)}`)).toBe(true);
  });

  it("allowlist passes vars through", () => {
    const { env, stripped } = scrubEnv(
      { BUILDER_API_KEY: "bpk-abc123def456ghi789" },
      new Set(["BUILDER_API_KEY"]),
    );
    expect(env.BUILDER_API_KEY).toBe("bpk-abc123def456ghi789");
    expect(stripped).toEqual([]);
  });

  it("does not strip known false positives", () => {
    const { env } = scrubEnv({ SSH_AUTH_SOCK: "/tmp/agent.sock" });
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/agent.sock");
  });
});

describe("shannonEntropy", () => {
  it("orders low vs high entropy strings", () => {
    expect(shannonEntropy("aaaaaaaa")).toBeLessThan(1);
    expect(shannonEntropy("x9Kf2mQ8vLp3TzR7")).toBeGreaterThan(3);
  });
});
