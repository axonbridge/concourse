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

// GitHub CLI setup for a home terminal: install via brew when available, else
// download the official release into ~/.local (adding it to PATH + zshrc),
// then run the interactive browser sign-in with SSH as the git protocol.
export const GH_CLI_SETUP_COMMAND = [
  "if ! command -v gh >/dev/null 2>&1; then",
  "  if command -v brew >/dev/null 2>&1; then brew install gh;",
  "  else",
  '    arch=$(uname -m | sed "s/x86_64/amd64/");',
  "    ver=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep -m1 '\"tag_name\"' | cut -d '\"' -f 4);",
  '    curl -fsSL "https://github.com/cli/cli/releases/download/${ver}/gh_${ver#v}_macOS_${arch}.zip" -o /tmp/gh.zip;',
  '    mkdir -p "$HOME/.local/ghcli" "$HOME/.local/bin";',
  '    unzip -oq /tmp/gh.zip -d "$HOME/.local/ghcli";',
  '    ln -sf "$HOME/.local/ghcli/gh_${ver#v}_macOS_${arch}/bin/gh" "$HOME/.local/bin/gh";',
  '    export PATH="$HOME/.local/bin:$PATH";',
  "    grep -q '.local/bin' \"$HOME/.zshrc\" 2>/dev/null || echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> \"$HOME/.zshrc\";",
  "  fi;",
  "fi; gh auth login --web --git-protocol ssh",
].join(" ");

// Tunnel tools for the project Share feature. cloudflared is the recommended
// zero-account public option: brew when present, else the official binary
// into ~/.local/bin (mirrors the gh fallback).
export const CLOUDFLARED_SETUP_COMMAND = [
  "if ! command -v cloudflared >/dev/null 2>&1; then",
  "  if command -v brew >/dev/null 2>&1; then brew install cloudflared;",
  "  else",
  '    arch=$(uname -m | sed "s/x86_64/amd64/");',
  '    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz" -o /tmp/cloudflared.tgz;',
  '    mkdir -p "$HOME/.local/bin";',
  '    tar -xzf /tmp/cloudflared.tgz -C "$HOME/.local/bin";',
  '    export PATH="$HOME/.local/bin:$PATH";',
  "    grep -q '.local/bin' \"$HOME/.zshrc\" 2>/dev/null || echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> \"$HOME/.zshrc\";",
  "  fi;",
  "fi; cloudflared --version && echo && echo \"cloudflared is ready — close this terminal and click Share again.\"",
].join(" ");

// ngrok needs an account: install, open the dashboard's authtoken page, and
// prompt for a paste so the config lands without hand-typing commands.
export const NGROK_SETUP_COMMAND = [
  "if ! command -v ngrok >/dev/null 2>&1; then",
  "  if command -v brew >/dev/null 2>&1; then brew install ngrok;",
  "  else",
  '    arch=$(uname -m | sed "s/x86_64/amd64/");',
  '    curl -fsSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-${arch}.zip" -o /tmp/ngrok.zip;',
  '    mkdir -p "$HOME/.local/bin";',
  '    unzip -oq /tmp/ngrok.zip -d "$HOME/.local/bin";',
  '    export PATH="$HOME/.local/bin:$PATH";',
  "    grep -q '.local/bin' \"$HOME/.zshrc\" 2>/dev/null || echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> \"$HOME/.zshrc\";",
  "  fi;",
  "fi;",
  "if ngrok config check >/dev/null 2>&1; then echo \"ngrok is already set up — close this terminal and click Share.\";",
  "else",
  "  open 'https://dashboard.ngrok.com/get-started/your-authtoken';",
  "  echo 'Sign in (or sign up free) in the browser page that just opened, copy your authtoken, and paste it here:';",
  "  read -r tok; ngrok config add-authtoken \"$tok\" && echo && echo \"ngrok is ready — close this terminal and click Share again.\";",
  "fi",
].join(" ");

// Tailscale is a GUI app; install the cask (or open the download page) and
// launch it so the user can sign in.
export const TAILSCALE_SETUP_COMMAND = [
  "if [ ! -d '/Applications/Tailscale.app' ] && ! command -v tailscale >/dev/null 2>&1; then",
  "  if command -v brew >/dev/null 2>&1; then brew install --cask tailscale;",
  "  else open 'https://tailscale.com/download/macos'; echo 'Install Tailscale from the page that just opened, then re-run this.'; fi;",
  "fi;",
  "open -a Tailscale 2>/dev/null && echo 'Tailscale launched — sign in from its menu-bar icon, then click Share again.'",
].join(" ");
