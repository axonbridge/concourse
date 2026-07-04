import type { IpcMain } from "electron";
import { shell } from "electron";
import { execFile, spawn } from "node:child_process";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import log from "electron-log/main";
import { safeHandle } from "./ipc-safe-handle";
import { IPC } from "./ipc-channels";

// Lets the user authenticate MCP servers (Atlassian, etc.) from the UI instead
// of the terminal. Wraps the `claude mcp` CLI: `list` for status, `login` to
// run the OAuth flow (opens the browser), `logout` to disconnect.

export type McpServer = {
  name: string;
  url: string;
  status: "connected" | "needs-auth" | "error";
};

function resolveClaudeBinary(): string {
  const candidates = [
    path.join(os.homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "claude"; // fall back to PATH
}

// Parse a `claude mcp list` line: "<name>: <url> - <status text>".
function parseListLine(line: string): McpServer | null {
  const m = line.match(/^(.*?):\s*(\S+)\s+-\s+(.+)$/);
  if (!m) return null;
  const [, name, url, statusText] = m;
  const lower = statusText.toLowerCase();
  const status: McpServer["status"] = /need|auth|unauthor/.test(lower)
    ? "needs-auth"
    : /connect|✓|ok|healthy/.test(lower)
      ? "connected"
      : "error";
  return { name: name.trim(), url: url.trim(), status };
}

export function registerMcpHandlers(ipc: IpcMain): void {
  const claude = resolveClaudeBinary();

  safeHandle(
    IPC.mcpList,
    () =>
      new Promise<{ servers: McpServer[]; error?: string }>((resolve) => {
        execFile(claude, ["mcp", "list"], { timeout: 60_000 }, (err, stdout, stderr) => {
          // `mcp list` exits non-zero when some servers are unhealthy, but still
          // prints the list — so parse stdout regardless of exit code.
          const text = `${stdout || ""}\n${stderr || ""}`;
          const servers: McpServer[] = [];
          for (const line of text.split("\n")) {
            const s = parseListLine(line.trim());
            if (s) servers.push(s);
          }
          if (servers.length === 0 && err) {
            resolve({ servers: [], error: err.message });
          } else {
            resolve({ servers });
          }
        });
      }),
    ipc,
  );

  safeHandle(
    IPC.mcpLogin,
    (_e, { name }: { name: string }) =>
      new Promise<{ ok: boolean; error?: string }>((resolve) => {
        // Opens the browser for OAuth and runs a local callback server; resolves
        // when the flow completes. Surface any printed auth URL via the browser.
        const child = spawn(claude, ["mcp", "login", name], { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        const onData = (d: Buffer) => {
          out += d.toString();
          const url = out.match(/https?:\/\/\S+/);
          if (url && /oauth|authorize|auth/i.test(url[0])) {
            shell.openExternal(url[0]).catch(() => {});
          }
        };
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.on("error", (e) => resolve({ ok: false, error: e.message }));
        child.on("exit", (code) => {
          if (code === 0) resolve({ ok: true });
          else resolve({ ok: false, error: out.trim() || `login exited with code ${code}` });
        });
      }),
    ipc,
  );

  safeHandle(
    IPC.mcpLogout,
    (_e, { name }: { name: string }) =>
      new Promise<{ ok: boolean; error?: string }>((resolve) => {
        execFile(claude, ["mcp", "logout", name], { timeout: 30_000 }, (err) => {
          if (err) {
            log.warn("[mcp] logout failed", err);
            resolve({ ok: false, error: err.message });
          } else {
            resolve({ ok: true });
          }
        });
      }),
    ipc,
  );
}
