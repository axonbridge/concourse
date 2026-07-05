import { z } from "zod";
import {
  checkoutGitBranch,
  cloneRepository,
  commit as gitCommit,
  createPullRequest as gitCreatePullRequest,
  discardFileChanges,
  generateSshKey,
  getGitDiff,
  getGitIdentity,
  getGitStatus,
  gitErrorPayload,
  isGitAvailable,
  listGitBranches,
  pull as gitPull,
  push as gitPush,
  setGitIdentity,
  sshKeyStatus,
  stageFiles,
  testSshConnection,
  unstageFiles,
} from "../services/git";
import { handleDomainError, idParam, json, jsonError, notFound, parseJsonBody } from "./_helpers";
import { HTTP_BAD_REQUEST } from "~/shared/http-status";

const stageBody = z.object({
  files: z.array(z.string()).optional().default([]),
  worktreeId: z.string().nullable().optional(),
});
const cloneBody = z.object({
  url: z.string().trim().min(1),
  parentDir: z.string().trim().min(1),
  folderName: z.string().trim().max(255).optional(),
});
const discardBody = z.object({
  file: z.string().trim().min(1),
  worktreeId: z.string().nullable().optional(),
});
const commitBody = z.object({
  autoStage: z.boolean().optional(),
  worktreeId: z.string().nullable().optional(),
  /** Verbatim commit message; when provided, the CLI generation step is
   * skipped entirely. Used by the ship-failed dialog's manual recovery. */
  message: z.string().trim().min(1).max(4_000).optional(),
});
const checkoutBody = z.object({
  branch: z.string().trim().min(1).max(255),
  create: z.boolean().optional(),
  worktreeId: z.string().nullable().optional(),
});

function queryWorktreeId(url: URL): string | null {
  const value = url.searchParams.get("worktreeId");
  return value && value !== "main" ? value : null;
}

function asGitErrorResponse(e: unknown): Response {
  const payload = gitErrorPayload(e);
  return new Response(
    JSON.stringify({
      error: payload.message,
      stderr: payload.stderr,
      kind: payload.kind,
      cli: payload.cli,
    }),
    { status: HTTP_BAD_REQUEST, headers: { "content-type": "application/json" } },
  );
}

export async function status(rawId: string, url: URL): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json(await getGitStatus(parsed.data, queryWorktreeId(url)));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function branches(rawId: string, url: URL): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json(await listGitBranches(parsed.data, queryWorktreeId(url)));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function diff(rawId: string, url: URL): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const file = url.searchParams.get("file");
  if (!file) return jsonError(HTTP_BAD_REQUEST, "file is required");
  const stagedParam = url.searchParams.get("staged");
  const staged = stagedParam === "1" || stagedParam === "true";
  try {
    return json(await getGitDiff(idParsed.data, file, staged, queryWorktreeId(url)));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function stage(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, stageBody);
  if (!parsed.ok) return parsed.response;
  try {
    await stageFiles(idParsed.data, parsed.data.files, parsed.data.worktreeId ?? null);
    return json({ ok: true });
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function unstage(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, stageBody);
  if (!parsed.ok) return parsed.response;
  try {
    await unstageFiles(idParsed.data, parsed.data.files, parsed.data.worktreeId ?? null);
    return json({ ok: true });
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

/** Whether git is on PATH (macOS: whether the Command Line Tools are installed). */
export async function available(): Promise<Response> {
  return json(await isGitAvailable());
}

// ── Settings → Git: SSH key + commit identity (app-level, not project-scoped) ─

export async function sshStatus(): Promise<Response> {
  try {
    return json(await sshKeyStatus());
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function sshGenerate(): Promise<Response> {
  try {
    return json(await generateSshKey());
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function sshTest(): Promise<Response> {
  try {
    return json(await testSshConnection());
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

const identityBody = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().min(3).max(320),
});

export async function identityGet(): Promise<Response> {
  try {
    return json(await getGitIdentity());
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function identitySet(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, identityBody);
  if (!parsed.ok) return parsed.response;
  try {
    return json(await setGitIdentity(parsed.data));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

/** Clone a repository so it can be added as a project. Not project-scoped. */
export async function clone(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, cloneBody);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await cloneRepository(parsed.data);
    return json(result);
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function discard(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, discardBody);
  if (!parsed.ok) return parsed.response;
  try {
    await discardFileChanges(idParsed.data, parsed.data.file, parsed.data.worktreeId ?? null);
    return json({ ok: true });
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function commit(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, commitBody);
  if (!parsed.ok) return parsed.response;
  try {
    return json(await gitCommit(idParsed.data, {
      autoStage: parsed.data.autoStage,
      worktreeId: parsed.data.worktreeId ?? null,
      message: parsed.data.message,
    }));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function pull(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, stageBody);
  if (!parsed.ok) return parsed.response;
  try {
    return json({ result: await gitPull(idParsed.data, parsed.data.worktreeId ?? null) });
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function push(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const body = await parseJsonBody(request, z.object({ worktreeId: z.string().nullable().optional() }));
  if (!body.ok) return body.response;
  try {
    return json(await gitPush(parsed.data, body.data.worktreeId ?? null));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function createPr(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const body = await parseJsonBody(request, z.object({ worktreeId: z.string().nullable().optional() }));
  if (!body.ok) return body.response;
  try {
    return json(await gitCreatePullRequest(parsed.data, body.data.worktreeId ?? null));
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}

export async function checkout(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const parsed = await parseJsonBody(request, checkoutBody);
  if (!parsed.ok) return parsed.response;
  try {
    return json(
      await checkoutGitBranch(idParsed.data, parsed.data.branch, parsed.data.worktreeId ?? null, {
        create: parsed.data.create,
      }),
    );
  } catch (e) {
    return handleDomainError(e) ?? asGitErrorResponse(e);
  }
}
