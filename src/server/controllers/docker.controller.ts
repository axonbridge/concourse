import {
  DockerError,
  dockerComposeRestart,
  dockerComposeStatus,
  dockerComposeStop,
  dockerComposeUp,
  dockerErrorPayload,
  startDockerEngine,
} from "../services/docker";
import { handleDomainError, idParam, json, notFound } from "./_helpers";
import { HTTP_BAD_REQUEST } from "~/shared/http-status";

function queryWorktreeId(url: URL): string | null {
  const value = url.searchParams.get("worktreeId");
  return value && value.trim() ? value.trim() : null;
}

function asDockerErrorResponse(e: unknown): Response {
  if (!(e instanceof DockerError)) throw e;
  const payload = dockerErrorPayload(e);
  return new Response(
    JSON.stringify({ error: payload.message, stderr: payload.stderr }),
    { status: HTTP_BAD_REQUEST, headers: { "content-type": "application/json" } },
  );
}

export async function status(rawId: string, url: URL): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json(await dockerComposeStatus(parsed.data, queryWorktreeId(url)));
  } catch (e) {
    return handleDomainError(e) ?? asDockerErrorResponse(e);
  }
}

export async function up(rawId: string, url: URL): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json(await dockerComposeUp(parsed.data, queryWorktreeId(url)));
  } catch (e) {
    return handleDomainError(e) ?? asDockerErrorResponse(e);
  }
}

export async function stop(rawId: string, url: URL): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json(await dockerComposeStop(parsed.data, queryWorktreeId(url)));
  } catch (e) {
    return handleDomainError(e) ?? asDockerErrorResponse(e);
  }
}

export async function restart(rawId: string, url: URL): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json(await dockerComposeRestart(parsed.data, queryWorktreeId(url)));
  } catch (e) {
    return handleDomainError(e) ?? asDockerErrorResponse(e);
  }
}

export async function engineStart(rawId: string): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json(await startDockerEngine(parsed.data));
  } catch (e) {
    return handleDomainError(e) ?? asDockerErrorResponse(e);
  }
}
