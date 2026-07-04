import type { TaskAgent } from "./domain";

// One-click CLI setup, run inside an app home terminal: install (when missing)
// chained with the vendor's interactive sign-in.

// npm-distributed CLIs need a working node toolchain. Cascade: Volta (installs
// a shimmed binary; bare `npm i -g` under Volta silently lands nowhere) → npm →
// brew-installed node → bootstrap Volta itself on a machine with nothing.
function npmCliInstall(pkg: string): string {
  return [
    `if command -v volta >/dev/null 2>&1; then volta install node ${pkg};`,
    `elif command -v npm >/dev/null 2>&1; then npm install -g ${pkg}@latest;`,
    `elif command -v brew >/dev/null 2>&1; then brew install node && npm install -g ${pkg}@latest;`,
    `else curl -fsSL https://get.volta.sh | bash && export PATH="$HOME/.volta/bin:$PATH" && volta install node ${pkg}; fi`,
  ].join(" ");
}
export const AGENT_SETUP: Partial<
  Record<TaskAgent, { install: string; auth: string; label: string }>
> = {
  "claude-code": {
    label: "Claude Code",
    install: npmCliInstall("@anthropic-ai/claude-code"),
    auth: "claude",
  },
  codex: {
    label: "Codex",
    install: npmCliInstall("@openai/codex"),
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
