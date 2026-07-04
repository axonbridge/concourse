import { z } from "zod";
import { SCRIPT_ARGS_MAX, TASK_AGENTS } from "~/shared/domain";
import {
  createProject,
  deleteProject,
  getProject,
  getProjectPathStatus,
  listProjects,
  listProjectCommands,
  deleteCustomCommand,
  updateCustomCommand,
  readCommandBundle,
  importCommandBundle,
  refreshBranch,
  togglePin,
  updateProject,
  reorderPinnedProjects,
  ensureWorkflowCommand,
} from "../services/projects";
import {
  handleDomainError,
  idParam,
  json,
  jsonError,
  noContent,
  notFound,
  parseJsonBody,
} from "./_helpers";
import { HTTP_BAD_REQUEST, HTTP_CREATED } from "~/shared/http-status";
import * as path from "node:path";
import { classifyFolder, scaffoldWorkspace } from "../services/workspace-scaffold";

const launchCommandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
});

const scriptArgSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "arg name must be a valid identifier"),
  description: z.string().max(200).optional(),
});

// Custom scripts are launch commands plus optional fill-in-the-blank args; the
// args field must be declared here or zod strips it from the persisted payload.
const customScriptSchema = launchCommandSchema.extend({
  args: z.array(scriptArgSchema).max(SCRIPT_ARGS_MAX).optional(),
});

const createProjectBody = z.object({
  name: z.string().optional(),
  path: z.string().optional(),
  githubUrl: z.string().optional(),
  icon: z.string().optional(),
  iconColor: z.string().optional(),
  groupId: z.string().nullable().optional(),
  /** Journey A: scaffold an empty/missing folder into a CWF workspace. */
  scaffoldWorkspace: z.boolean().optional(),
});

const updateProjectBody = z
  .object({
    name: z.string(),
    path: z.string(),
    icon: z.string(),
    iconColor: z.string(),
    imagePath: z.string().nullable(),
    groupId: z.string().nullable(),
    pinned: z.boolean(),
    branch: z.string(),
    gitEnabled: z.boolean(),
    launchUrl: z.string().nullable(),
    worktreeSetupCommand: z.string().max(500).nullable(),
    rememberAgentSettings: z.boolean(),
    savedAgent: z.enum(TASK_AGENTS).nullable(),
    savedSkipPermissions: z.boolean(),
    savedBareSession: z.boolean(),
    launchCommands: z.array(launchCommandSchema).nullable(),
    customScripts: z.array(customScriptSchema).nullable(),
    togglePin: z.literal(true).optional(),
  })
  .partial();

const reorderPinnedBody = z.object({
  order: z.array(z.string().min(1)),
});

export async function list(request: Request): Promise<Response> {
  return json({ projects: listProjects() });
}

/** Pre-creation folder inspection for the Add Project dialog (Journey A). */
export async function classify(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const p = url.searchParams.get("path")?.trim();
  if (!p) return jsonError(HTTP_BAD_REQUEST, "path is required");
  return json(classifyFolder(p));
}

export async function create(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, createProjectBody);
  if (!parsed.ok) return parsed.response;
  try {
    if (!parsed.data.path?.trim()) {
      return jsonError(HTTP_BAD_REQUEST, "path is required");
    }
    const localPath = parsed.data.path.trim();
    const { githubUrl: _ignored, scaffoldWorkspace: wantScaffold, ...localProject } = parsed.data;
    // Scaffold only when the folder is genuinely empty or missing — an existing
    // folder is never touched, whatever the flag says.
    if (wantScaffold) {
      const { kind } = classifyFolder(localPath);
      // empty/missing → fresh workspace; plain → additive scaffold around the
      // existing content (no-overwrite). NEVER for legacy-claude (workspace.md
      // would flip it to CWF and the projector would own the team's CLAUDE.md).
      if (kind === "empty" || kind === "missing" || kind === "plain") {
        scaffoldWorkspace(localPath, parsed.data.name?.trim() || path.basename(localPath));
      }
    }
    const p = createProject({ ...localProject, path: localPath });
    return json({ project: p }, { status: HTTP_CREATED });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function getOne(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const id = parsed.data;
  const p = getProject(id);
  if (!p) return notFound();
  refreshBranch(id);
  return json({ project: p });
}

export async function pathStatus(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const url = new URL(request.url);
  const worktreeId = url.searchParams.get("worktreeId");
  const status = getProjectPathStatus(parsed.data, worktreeId);
  return status ? json({ status }) : notFound();
}

export async function reorderPinned(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, reorderPinnedBody);
  if (!parsed.ok) return parsed.response;
  try {
    return json({ projects: reorderPinnedProjects(parsed.data.order) });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function update(rawId: string, request: Request): Promise<Response> {
  const idParsed = idParam.safeParse(rawId);
  if (!idParsed.success) return notFound();
  const id = idParsed.data;
  const parsed = await parseJsonBody(request, updateProjectBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (body.togglePin === true) {
    const pinned = togglePin(id);
    if (!pinned) return notFound();
    return json({ project: pinned });
  }
  const { togglePin: _ignored, ...patch } = body;
  try {
    const p = updateProject(id, patch);
    if (!p) return notFound();
    return json({ project: p });
  } catch (e) {
    const mapped = handleDomainError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function remove(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  return deleteProject(parsed.data) ? noContent() : notFound();
}

export async function listCommands(rawId: string): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  return json({ commands: listProjectCommands(parsed.data) });
}

/** Materialize /create-workflow for this project before the builder chat opens. */
export async function ensureWorkflowBuilder(rawId: string): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return ensureWorkflowCommand(parsed.data) ? json({ ok: true }) : notFound();
  } catch (e) {
    return jsonError(HTTP_BAD_REQUEST, e instanceof Error ? e.message : "ensure failed");
  }
}

export async function deleteCommand(rawId: string, name: string): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json({ deleted: deleteCustomCommand(parsed.data, name) });
  } catch (e) {
    return jsonError(HTTP_BAD_REQUEST, e instanceof Error ? e.message : "Delete failed");
  }
}

const updateCommandBody = z.object({
  title: z.string().max(80).optional(),
  description: z.string().max(300).optional(),
  icon: z.string().max(16).optional(),
  // undefined = leave; string = set/replace the output template; null = remove.
  template: z.string().max(200_000).nullable().optional(),
});

export async function updateCommand(
  rawId: string,
  name: string,
  request: Request,
): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const body = await parseJsonBody(request, updateCommandBody);
  if (!body.ok) return body.response;
  try {
    updateCustomCommand(parsed.data, name, body.data);
    return json({ ok: true });
  } catch (e) {
    return jsonError(HTTP_BAD_REQUEST, e instanceof Error ? e.message : "Update failed");
  }
}

export async function commandBundle(rawId: string, name: string): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  try {
    return json({ bundle: readCommandBundle(parsed.data, name) });
  } catch (e) {
    return jsonError(HTTP_BAD_REQUEST, e instanceof Error ? e.message : "Export failed");
  }
}

const importBundleBody = z.object({
  bundle: z.object({
    version: z.literal(1),
    command: z.object({ name: z.string(), content: z.string() }),
    agents: z.array(z.object({ name: z.string(), content: z.string() })),
    skills: z.array(z.object({ name: z.string(), content: z.string() })),
    template: z.object({ name: z.string(), content: z.string() }).optional(),
  }),
});

export async function importCommand(rawId: string, request: Request): Promise<Response> {
  const parsed = idParam.safeParse(rawId);
  if (!parsed.success) return notFound();
  const body = await parseJsonBody(request, importBundleBody);
  if (!body.ok) return body.response;
  try {
    return json({ imported: importCommandBundle(parsed.data, body.data.bundle) });
  } catch (e) {
    return jsonError(HTTP_BAD_REQUEST, e instanceof Error ? e.message : "Import failed");
  }
}
