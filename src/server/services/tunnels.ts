import { execFile, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { newId } from "./_ids";
import { resolveProjectWorktreeCwd } from "./worktrees";

// Share a locally-running app (dev server, docker port) outside the machine
// without deploying: "private" rides Tailscale serve (tailnet-only HTTPS),
// "public" prefers ngrok, then Tailscale Funnel, then cloudflared. Tunnels
// live as long as this server process; the registry is in-memory.

export class TunnelError extends Error {
  stderr?: string;
  constructor(message: string, stderr?: string) {
    super(message);
    this.name = "TunnelError";
    this.stderr = stderr;
  }
}

const TAILSCALE_CANDIDATES = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
];
const EXTRA_PATH_DIRS = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  path.join(os.homedir(), ".local", "bin"), // where our setup terminals install
];

function envWithPath(): NodeJS.ProcessEnv {
  const PATH = [process.env.PATH ?? "", ...EXTRA_PATH_DIRS].filter(Boolean).join(":");
  return { ...process.env, PATH };
}

function which(cmd: string): string | null {
  for (const dir of (envWithPath().PATH ?? "").split(":")) {
    const p = path.join(dir, cmd);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function tailscaleBin(): string | null {
  for (const p of TAILSCALE_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return which("tailscale");
}

function run(
  bin: string,
  args: string[],
  timeoutMs = 20_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, env: envWithPath() }, (error, stdout, stderr) => {
      resolve({ code: error ? 1 : 0, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

export type TunnelMode = "private" | "public";
export type TunnelProvider = "tailscale-serve" | "tailscale-funnel" | "ngrok" | "cloudflared";

export type TunnelInfo = {
  id: string;
  projectId: string;
  port: number;
  mode: TunnelMode;
  provider: TunnelProvider;
  url: string;
  startedAt: number;
};

type ActiveTunnel = TunnelInfo & { proc: ChildProcess | null };

const active = new Map<string, ActiveTunnel>();

export type TunnelAvailability = {
  tailscale: { installed: boolean; running: boolean };
  ngrok: { installed: boolean; configured: boolean };
  cloudflared: { installed: boolean };
};

export async function tunnelAvailability(): Promise<TunnelAvailability> {
  const ts = tailscaleBin();
  let tsRunning = false;
  if (ts) {
    const r = await run(ts, ["status", "--json"], 8_000);
    try {
      tsRunning = r.code === 0 && JSON.parse(r.stdout)?.BackendState === "Running";
    } catch {
      tsRunning = false;
    }
  }
  const ngrok = which("ngrok");
  let ngrokConfigured = false;
  if (ngrok) {
    const r = await run(ngrok, ["config", "check"], 8_000);
    ngrokConfigured = r.code === 0;
  }
  return {
    tailscale: { installed: !!ts, running: tsRunning },
    ngrok: { installed: !!ngrok, configured: ngrokConfigured },
    cloudflared: { installed: !!which("cloudflared") },
  };
}

export function listTunnels(projectId?: string): TunnelInfo[] {
  return [...active.values()]
    .filter((t) => !projectId || t.projectId === projectId)
    .map(({ proc: _proc, ...info }) => info);
}

function register(t: ActiveTunnel): TunnelInfo {
  active.set(t.id, t);
  const { proc: _proc, ...info } = t;
  return info;
}

/** Extract the first https URL from CLI output. */
function firstUrl(text: string, hostFilter?: (u: string) => boolean): string | null {
  for (const m of text.matchAll(/https:\/\/[^\s"']+/g)) {
    const u = m[0].replace(/[),.]+$/, "");
    if (!hostFilter || hostFilter(u)) return u;
  }
  return null;
}

// Tailscale serve/funnel own a single HTTPS endpoint per machine — starting a
// new one replaces whatever was previously mapped, so mirror that in the
// registry to stay truthful.
function dropTailscaleEntries() {
  for (const [id, t] of active) {
    if (t.provider.startsWith("tailscale")) active.delete(id);
  }
}

async function startTailscale(
  projectId: string,
  port: number,
  funnel: boolean,
): Promise<TunnelInfo> {
  const bin = tailscaleBin();
  if (!bin) throw new TunnelError("Tailscale is not installed");
  const verb = funnel ? "funnel" : "serve";
  const r = await run(bin, [verb, "--bg", String(port)], 30_000);
  if (r.code !== 0) {
    const detail = (r.stderr || r.stdout).trim();
    // Serve/Funnel are tailnet features that need a one-time opt-in; the CLI
    // prints the admin link — surface it in the message the dialog shows.
    const enableUrl = detail.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];
    throw new TunnelError(
      enableUrl
        ? `Tailscale ${funnel ? "Funnel" : "serve"} is not enabled on your tailnet — enable it at ${enableUrl} and try again`
        : funnel
          ? "Tailscale Funnel could not start — it may need to be enabled for your tailnet"
          : "Tailscale serve could not start",
      detail,
    );
  }
  const url = firstUrl(r.stdout + "\n" + r.stderr, (u) => u.includes(".ts.net"));
  if (!url) throw new TunnelError(`tailscale ${verb} started but printed no URL`, r.stdout.trim());
  dropTailscaleEntries();
  return register({
    id: newId("tun"),
    projectId,
    port,
    mode: funnel ? "public" : "private",
    provider: funnel ? "tailscale-funnel" : "tailscale-serve",
    url,
    startedAt: Date.now(),
    proc: null, // --bg detaches; stop goes through `tailscale serve/funnel reset`
  });
}

function startNgrok(projectId: string, port: number): Promise<TunnelInfo> {
  const bin = which("ngrok");
  if (!bin) throw new TunnelError("ngrok is not installed");
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["http", String(port), "--log", "stdout", "--log-format", "json"], {
      env: envWithPath(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let buffer = "";
    const fail = (message: string, detail?: string) => {
      if (settled) return;
      settled = true;
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      reject(new TunnelError(message, detail?.trim()));
    };
    const timer = setTimeout(() => fail("ngrok did not report a tunnel URL in time", buffer), 25_000);
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      for (const line of buffer.split("\n")) {
        try {
          const obj = JSON.parse(line);
          if (obj?.url && String(obj.msg ?? "").includes("started tunnel")) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(
              register({
                id: newId("tun"),
                projectId,
                port,
                mode: "public",
                provider: "ngrok",
                url: String(obj.url),
                startedAt: Date.now(),
                proc,
              }),
            );
            return;
          }
          // ngrok's JSON logs carry err:"<nil>" (Go's nil) on SUCCESS lines —
          // only a real error string means failure.
          const err = obj?.err && obj.err !== "<nil>" ? String(obj.err) : null;
          if (obj?.lvl === "crit" || err) {
            fail("ngrok failed to start", err ?? String(obj.msg ?? line));
            return;
          }
        } catch {
          /* partial line */
        }
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
    });
    proc.on("exit", (code) => {
      if (!settled) fail(`ngrok exited (${code}) before reporting a URL`, buffer);
      // Reap the registry entry if the tunnel dies later.
      for (const [id, t] of active) if (t.proc === proc) active.delete(id);
    });
  });
}

function startCloudflared(projectId: string, port: number): Promise<TunnelInfo> {
  const bin = which("cloudflared");
  if (!bin) throw new TunnelError("cloudflared is not installed");
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["tunnel", "--url", `http://localhost:${port}`], {
      env: envWithPath(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let buffer = "";
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          proc.kill();
        } catch {
          /* already gone */
        }
        reject(new TunnelError("cloudflared did not report a URL in time", buffer.trim()));
      }
    }, 30_000);
    const scan = (chunk: Buffer) => {
      buffer += chunk.toString();
      const url = firstUrl(buffer, (u) => u.includes("trycloudflare.com"));
      if (url && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(
          register({
            id: newId("tun"),
            projectId,
            port,
            mode: "public",
            provider: "cloudflared",
            url,
            startedAt: Date.now(),
            proc,
          }),
        );
      }
    };
    proc.stdout.on("data", scan);
    proc.stderr.on("data", scan);
    proc.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new TunnelError(`cloudflared exited (${code}) before reporting a URL`, buffer.trim()));
      }
      for (const [id, t] of active) if (t.proc === proc) active.delete(id);
    });
  });
}

export async function startTunnel(
  projectId: string,
  opts: { port: number; mode: TunnelMode; provider?: TunnelProvider },
): Promise<TunnelInfo> {
  resolveProjectWorktreeCwd(projectId); // validates the project exists
  const port = Math.trunc(opts.port);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new TunnelError("Invalid port");
  }
  const avail = await tunnelAvailability();

  if (opts.mode === "private") {
    if (!avail.tailscale.installed) {
      throw new TunnelError("Private sharing needs Tailscale (https://tailscale.com/download)");
    }
    if (!avail.tailscale.running) {
      throw new TunnelError("Tailscale is installed but not connected — open the Tailscale app and sign in");
    }
    return startTailscale(projectId, port, false);
  }

  const provider =
    opts.provider ??
    (avail.ngrok.installed && avail.ngrok.configured
      ? "ngrok"
      : avail.tailscale.running
        ? "tailscale-funnel"
        : avail.cloudflared.installed
          ? "cloudflared"
          : null);
  if (!provider) {
    throw new TunnelError(
      "No public-tunnel tool found. Install ngrok (brew install ngrok) or cloudflared (brew install cloudflared), or enable Tailscale Funnel.",
    );
  }
  if (provider === "ngrok") return startNgrok(projectId, port);
  if (provider === "cloudflared") return startCloudflared(projectId, port);
  return startTailscale(projectId, port, true);
}

export async function stopTunnel(tunnelId: string): Promise<{ ok: true }> {
  const t = active.get(tunnelId);
  if (!t) return { ok: true }; // already gone — stopping twice isn't an error
  active.delete(tunnelId);
  if (t.proc) {
    try {
      t.proc.kill();
    } catch {
      /* already exited */
    }
    return { ok: true };
  }
  // Tailscale --bg tunnels detach from us; reset clears the machine's mapping.
  const bin = tailscaleBin();
  if (bin) {
    const verb = t.provider === "tailscale-funnel" ? "funnel" : "serve";
    await run(bin, [verb, "reset"], 15_000);
  }
  return { ok: true };
}

export function tunnelErrorPayload(e: unknown): { message: string; stderr?: string } {
  if (e instanceof TunnelError) return { message: e.message, stderr: e.stderr };
  return { message: e instanceof Error ? e.message : String(e) };
}
