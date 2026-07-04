/** Shell one-liner run on a systemd-managed remote VM to refresh the sandbox agent. */
export const SANDBOX_AGENT_UPGRADE_COMMAND = [
  "set -e",
  "sudo npm install -g @agentsystemlabs/concourse-agent@latest",
  "sudo systemctl restart concourse-agent",
  "sudo systemctl try-restart concourse-tls || true",
].join(" && ");

export const SANDBOX_AGENT_UPGRADE_PTY_PREFIX = "mc-upgrade-";

export function isSandboxAgentUpgradePty(ptyId: string): boolean {
  return ptyId.startsWith(SANDBOX_AGENT_UPGRADE_PTY_PREFIX);
}

/** Heuristic: npm global install produced output before systemctl restart drops the WS. */
export function sandboxAgentUpgradeOutputLooksSuccessful(output: string): boolean {
  return (
    /added \d+ packages?|changed \d+ packages?|up to date in/i.test(output) ||
    /@agentsystemlabs\/concourse-agent@/.test(output)
  );
}

export function sandboxAgentUpgradeOutputLooksFailed(chunk: string): boolean {
  return /npm ERR!|EACCES|command not found|Permission denied/i.test(chunk);
}
