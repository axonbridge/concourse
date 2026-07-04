import { MAX_TCP_PORT } from "./tcp-port";

export type PtyHookEnv = {
  apiUrl: string;
  token: string;
};

/** Hostname the Electron host uses to reach its own loopback Concourse API. */
export const LOCAL_HOOK_API_HOST = "127.0.0.1";

/** Hostname agent hooks POST to — the app's own loopback HTTP server. */
export const AGENT_LOCAL_HOOK_API_HOST = LOCAL_HOOK_API_HOST;

// The PTY/agent hook commands POST to whatever host is baked into CONCOURSE_API_URL —
// always the host loopback.
const ALLOWED_HOOK_HOSTS = new Set<string>([LOCAL_HOOK_API_HOST, AGENT_LOCAL_HOOK_API_HOST]);

function isValidPort(port: number | null | undefined): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= MAX_TCP_PORT;
}

/** Build the Concourse API base URL an agent's hooks should POST to. */
export function buildConcourseApiUrl(
  host: string,
  port: number | null | undefined,
): string | null {
  if (!ALLOWED_HOOK_HOSTS.has(host)) return null;
  if (!isValidPort(port)) return null;
  return `http://${host}:${port}`;
}

/** Host-side loopback API URL (Electron runtime). */
export function buildLocalConcourseApiUrl(port: number | null | undefined): string | null {
  return buildConcourseApiUrl(LOCAL_HOOK_API_HOST, port);
}

/** Loopback URL for the agent's own hook HTTP endpoint. */
export function buildAgentLocalHookApiUrl(port: number | null | undefined): string | null {
  return buildConcourseApiUrl(AGENT_LOCAL_HOOK_API_HOST, port);
}

export function hookEndpointSlug(agent: string | undefined): string {
  if (agent === "codex") return "codex";
  if (agent === "cursor-cli") return "cursor";
  if (agent === "opencode") return "opencode";
  return "claude";
}

export function buildSyntheticHookUrl(
  mcEnv: PtyHookEnv,
  agent: string | undefined,
  taskId: string,
): string | null {
  let base: URL;
  try {
    base = new URL(mcEnv.apiUrl);
  } catch {
    return null;
  }

  if (base.protocol !== "http:" || !ALLOWED_HOOK_HOSTS.has(base.hostname) || !base.port) {
    return null;
  }

  const url = new URL(`/api/hooks/${hookEndpointSlug(agent)}`, base);
  url.searchParams.set("taskId", taskId);
  return url.toString();
}
