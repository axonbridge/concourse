import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveProjectWorktreeCwd } from "./worktrees";

// Docker/Rancher dev-first workflows: many apps boot their database (and
// sometimes the app itself) with a compose file at the repo root. This
// service gives the project header a status pill plus start/stop for the
// whole stack. Works with any daemon the `docker` CLI can reach — Docker
// Desktop, Rancher Desktop, OrbStack.

const COMPOSE_FILES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

// GUI-launched Electron gets a minimal PATH; the docker CLI commonly lives in
// one of these depending on which desktop app manages the daemon.
const EXTRA_PATH_DIRS = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  path.join(os.homedir(), ".rd", "bin"), // Rancher Desktop
  "/Applications/Docker.app/Contents/Resources/bin",
];

export class DockerError extends Error {
  stderr?: string;
  constructor(message: string, stderr?: string) {
    super(message);
    this.name = "DockerError";
    this.stderr = stderr;
  }
}

type RunResult = { code: number; stdout: string; stderr: string };

function runDocker(cwd: string, args: string[], timeoutMs = 15_000): Promise<RunResult> {
  const PATH = [process.env.PATH ?? "", ...EXTRA_PATH_DIRS].filter(Boolean).join(":");
  return new Promise((resolve) => {
    execFile(
      "docker",
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PATH } },
      (error, stdout, stderr) => {
        const code = error ? ((error as NodeJS.ErrnoException).code === "ENOENT" ? -1 : 1) : 0;
        resolve({ code, stdout: stdout ?? "", stderr: stderr ?? String(error ?? "") });
      },
    );
  });
}

function projectCwd(projectId: string, worktreeId?: string | null): string {
  try {
    return resolveProjectWorktreeCwd(projectId, worktreeId);
  } catch (e) {
    throw new DockerError(e instanceof Error ? e.message : String(e));
  }
}

export function findComposeFile(cwd: string): string | null {
  for (const f of COMPOSE_FILES) {
    if (fs.existsSync(path.join(cwd, f))) return f;
  }
  return null;
}

/** The desktop app that owns the Docker daemon on this machine, if any. */
function detectEngineApp(): string | null {
  for (const app of ["Rancher Desktop", "OrbStack", "Docker"]) {
    if (fs.existsSync(`/Applications/${app}.app`)) return app;
  }
  return null;
}

export type DockerServiceInfo = {
  service: string;
  containerName: string | null;
  /** compose ps state (running/exited/created/…) or "not-created". */
  state: string;
  /** Human status line from compose ps (e.g. "Up 2 hours (healthy)"). */
  status: string | null;
  ports: string | null;
};

export type DockerComposeStatus =
  | { kind: "no-compose" }
  | { kind: "no-docker"; engineApp: string | null }
  | { kind: "engine-off"; engineApp: string | null }
  | {
      kind: "ready";
      composeFile: string;
      running: number;
      total: number;
      services: DockerServiceInfo[];
    };

export async function dockerComposeStatus(
  projectId: string,
  worktreeId?: string | null,
): Promise<DockerComposeStatus> {
  const cwd = projectCwd(projectId, worktreeId);
  const composeFile = findComposeFile(cwd);
  if (!composeFile) return { kind: "no-compose" };

  const version = await runDocker(cwd, ["--version"], 5_000);
  if (version.code !== 0) return { kind: "no-docker", engineApp: detectEngineApp() };

  const info = await runDocker(cwd, ["info", "--format", "{{.ServerVersion}}"], 10_000);
  if (info.code !== 0 || !info.stdout.trim()) {
    return { kind: "engine-off", engineApp: detectEngineApp() };
  }

  const [defined, ps] = await Promise.all([
    runDocker(cwd, ["compose", "config", "--services"], 20_000),
    runDocker(cwd, ["compose", "ps", "-a", "--format", "json"], 20_000),
  ]);

  const byService = new Map<string, DockerServiceInfo>();
  for (const name of defined.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
    byService.set(name, {
      service: name,
      containerName: null,
      state: "not-created",
      status: null,
      ports: null,
    });
  }
  // `compose ps --format json` emits one JSON object per line.
  for (const line of ps.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const service = String(row.Service ?? "");
      if (!service) continue;
      byService.set(service, {
        service,
        containerName: row.Name ? String(row.Name) : null,
        state: String(row.State ?? "unknown"),
        status: row.Status ? String(row.Status) : null,
        ports: row.Publishers
          ? summarizePublishers(row.Publishers)
          : row.Ports
            ? String(row.Ports)
            : null,
      });
    } catch {
      /* non-JSON noise line */
    }
  }

  const services = [...byService.values()];
  return {
    kind: "ready",
    composeFile,
    running: services.filter((s) => s.state === "running").length,
    total: services.length,
    services,
  };
}

function summarizePublishers(publishers: unknown): string | null {
  if (!Array.isArray(publishers)) return null;
  const parts = publishers
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : null))
    .filter((p): p is Record<string, unknown> => !!p && !!p.PublishedPort)
    .map((p) => `${p.PublishedPort}→${p.TargetPort}`);
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

/** `docker compose up -d` — builds images on first run, so the budget is generous. */
export async function dockerComposeUp(
  projectId: string,
  worktreeId?: string | null,
): Promise<{ ok: true }> {
  const cwd = projectCwd(projectId, worktreeId);
  if (!findComposeFile(cwd)) throw new DockerError("No compose file in this project");
  const r = await runDocker(cwd, ["compose", "up", "-d"], 300_000);
  if (r.code !== 0) throw new DockerError("docker compose up failed", r.stderr.trim());
  return { ok: true };
}

/** `docker compose stop` — containers keep their state and restart quickly. */
export async function dockerComposeStop(
  projectId: string,
  worktreeId?: string | null,
): Promise<{ ok: true }> {
  const cwd = projectCwd(projectId, worktreeId);
  if (!findComposeFile(cwd)) throw new DockerError("No compose file in this project");
  const r = await runDocker(cwd, ["compose", "stop"], 120_000);
  if (r.code !== 0) throw new DockerError("docker compose stop failed", r.stderr.trim());
  return { ok: true };
}

/** `docker compose restart` — bounce running containers without recreating them. */
export async function dockerComposeRestart(
  projectId: string,
  worktreeId?: string | null,
): Promise<{ ok: true }> {
  const cwd = projectCwd(projectId, worktreeId);
  if (!findComposeFile(cwd)) throw new DockerError("No compose file in this project");
  const r = await runDocker(cwd, ["compose", "restart"], 120_000);
  if (r.code !== 0) throw new DockerError("docker compose restart failed", r.stderr.trim());
  return { ok: true };
}

/** Launch the desktop app that provides the Docker daemon; the UI polls status. */
export async function startDockerEngine(
  projectId: string,
): Promise<{ ok: boolean; app: string | null }> {
  projectCwd(projectId); // validates the project exists
  const app = detectEngineApp();
  if (!app) return { ok: false, app: null };
  const r = await new Promise<RunResult>((resolve) => {
    execFile("open", ["-a", app], { timeout: 10_000 }, (error, stdout, stderr) =>
      resolve({ code: error ? 1 : 0, stdout: stdout ?? "", stderr: stderr ?? "" }),
    );
  });
  return { ok: r.code === 0, app };
}

export function dockerErrorPayload(e: unknown): { message: string; stderr?: string } {
  if (e instanceof DockerError) return { message: e.message, stderr: e.stderr };
  return { message: e instanceof Error ? e.message : String(e) };
}
