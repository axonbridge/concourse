import type { TaskAgent } from "./domain";

// One-click CLI setup, run inside an app home terminal: install (when missing)
// chained with the vendor's interactive sign-in. Install commands mirror
// AGENT_CLI_CONFIG.updateCommands (macOS/default variants).
export const AGENT_SETUP: Partial<
  Record<TaskAgent, { install: string; auth: string; label: string }>
> = {
  // npm-distributed CLIs: Volta intercepts bare `npm i -g` without creating a
  // runnable shim, so prefer `volta install` when Volta manages this machine.
  "claude-code": {
    label: "Claude Code",
    install:
      "(command -v volta >/dev/null 2>&1 && volta install @anthropic-ai/claude-code) || npm install -g @anthropic-ai/claude-code@latest",
    auth: "claude",
  },
  codex: {
    label: "Codex",
    install:
      "(command -v volta >/dev/null 2>&1 && volta install @openai/codex) || npm install -g @openai/codex@latest",
    auth: "codex login",
  },
  "cursor-cli": {
    label: "Cursor CLI",
    install: "curl https://cursor.com/install -fsS | bash",
    auth: "cursor-agent login",
  },
  opencode: {
    label: "OpenCode",
    install: "curl -fsSL https://opencode.ai/install | bash",
    auth: "opencode auth login",
  },
};

export function agentSetupCommand(agent: TaskAgent, installed: boolean): string | null {
  const setup = AGENT_SETUP[agent];
  if (!setup) return null;
  return installed ? setup.auth : `${setup.install} && ${setup.auth}`;
}
