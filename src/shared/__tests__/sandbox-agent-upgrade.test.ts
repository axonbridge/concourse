import { describe, expect, it } from "vitest";
import {
  SANDBOX_AGENT_UPGRADE_COMMAND,
  isSandboxAgentUpgradePty,
  sandboxAgentUpgradeOutputLooksFailed,
  sandboxAgentUpgradeOutputLooksSuccessful,
} from "../sandbox-agent-upgrade";

describe("sandbox agent upgrade helpers", () => {
  it("builds the npm install + systemctl restart command", () => {
    expect(SANDBOX_AGENT_UPGRADE_COMMAND).toContain("sudo npm install -g @agentsystemlabs/concourse-agent@latest");
    expect(SANDBOX_AGENT_UPGRADE_COMMAND).toContain("sudo systemctl restart concourse-agent");
    expect(SANDBOX_AGENT_UPGRADE_COMMAND).toContain("sudo systemctl try-restart concourse-tls || true");
  });

  it("recognizes upgrade pty ids", () => {
    expect(isSandboxAgentUpgradePty("mc-upgrade-abc")).toBe(true);
    expect(isSandboxAgentUpgradePty("rpty-abc")).toBe(false);
  });

  it("detects npm success and failure output", () => {
    expect(sandboxAgentUpgradeOutputLooksSuccessful("changed 1 package in 2s")).toBe(true);
    expect(sandboxAgentUpgradeOutputLooksFailed("npm ERR! code EACCES")).toBe(true);
  });
});
