import * as fs from "node:fs";
import * as path from "node:path";
import { getSqlite } from "~/db/client";
import {
  DEFAULT_BRANCH,
  LAUNCH_COMMANDS_MAX,
  CUSTOM_SCRIPTS_MAX,
  TASK_STATUSES,
  isActiveStatus,
  normalizeScriptArgs,
} from "~/shared/domain";
import type { CustomScript, LaunchCommand, TaskStatus } from "~/shared/domain";
import type { Project, Task } from "~/db/schema";
import type { CommandBundle, ProjectCommand, ProjectPathStatus, ProjectWithCounts } from "~/shared/projects";
import { events } from "../events";
import { ValidationError } from "../errors";
import {
  deleteProjectRow,
  findAllProjects,
  findProjectById,
  insertProject,
  updateProjectRow,
} from "../repositories/projects.repo";
import { findWorktreeById } from "../repositories/worktrees.repo";
import { findAllTasks, findTasksByProjectId } from "../repositories/tasks.repo";
import { deleteAllProjectImagesFor } from "./project-images";
import { newId } from "./_ids";
import { MAIN_WORKTREE_ID } from "~/shared/worktrees";
import { getPinnedProjects, nextPinnedOrder, validatePinnedReorder } from "~/lib/pinned-project-order";
import { isCwfWorkspace, loadWorkspace } from "~/domain/workspace/fs-loader";
import { projectClaudeWorkspace } from "~/domain/workspace/projectors/claude";

export type { ProjectWithCounts } from "~/shared/projects";

function validateWorkingDirectory(dir: string): string {
  const trimmed = dir.trim();
  if (!trimmed) throw new ValidationError("Working directory is required");
  if (!fs.existsSync(trimmed)) throw new ValidationError("Working directory does not exist");
  const stat = fs.statSync(trimmed);
  if (!stat.isDirectory()) throw new ValidationError("Working directory must be a directory");
  try {
    fs.accessSync(trimmed, fs.constants.R_OK | fs.constants.X_OK);
  } catch {
    throw new ValidationError("Working directory is not readable");
  }
  return trimmed;
}

function pathStatusFor(
  target: string,
  scope: ProjectPathStatus["scope"],
  worktreeId?: string | null,
): ProjectPathStatus {
  try {
    if (!fs.existsSync(target)) {
      return {
        ok: false,
        path: target,
        scope,
        worktreeId,
        reason: "missing",
        message:
          scope === "worktree"
            ? "Concourse cannot find this worktree folder."
            : "Concourse cannot find this project folder.",
      };
    }
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        path: target,
        scope,
        worktreeId,
        reason: "not-directory",
        message: "This path exists, but it is not a directory.",
      };
    }
    fs.accessSync(target, fs.constants.R_OK | fs.constants.X_OK);
    return { ok: true, path: target, scope, worktreeId };
  } catch {
    return {
      ok: false,
      path: target,
      scope,
      worktreeId,
      reason: "unreadable",
      message: "Concourse cannot read this working directory.",
    };
  }
}

export function getProjectPathStatus(
  id: string,
  worktreeId?: string | null,
): ProjectPathStatus | null {
  const project = findProjectById(id);
  if (!project) return null;
  // CWF workspaces: refresh the generated .claude/ projection on project open so
  // terminal sessions (which read .claude directly) see current sources.
  // Idempotent + hash-skipped, so this is cheap on the hot path.
  try {
    projectClaudeWorkspace(project.path);
  } catch {
    /* best-effort */
  }
  if (worktreeId && worktreeId !== MAIN_WORKTREE_ID) {
    const worktree = findWorktreeById(worktreeId);
    if (!worktree || worktree.projectId !== id) return null;
    return pathStatusFor(worktree.path, "worktree", worktreeId);
  }
  return pathStatusFor(project.path, "project", null);
}

export function detectGithubUrl(dir: string): string | null {
  try {
    const cfg = path.join(dir, ".git", "config");
    if (!fs.existsSync(cfg)) return null;
    const text = fs.readFileSync(cfg, "utf8");
    const m = text.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
    if (!m) return null;
    let url = m[1].trim();
    // git@github.com:owner/repo(.git)
    const ssh = url.match(/^git@github\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/);
    if (ssh) return `https://github.com/${ssh[1]}`;
    // ssh://git@github.com/owner/repo(.git) or https://github.com/owner/repo(.git)
    const https = url.match(/^(?:https?|ssh):\/\/(?:[^@]+@)?github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/);
    if (https) return `https://github.com/${https[1]}`;
    return null;
  } catch {
    return null;
  }
}

export function detectBranch(dir: string): string {
  try {
    const headFile = path.join(dir, ".git", "HEAD");
    if (!fs.existsSync(headFile)) return DEFAULT_BRANCH;
    const content = fs.readFileSync(headFile, "utf8").trim();
    if (content.startsWith("ref: refs/heads/")) return content.replace("ref: refs/heads/", "");
    return content.slice(0, 7);
  } catch {
    return DEFAULT_BRANCH;
  }
}

export function listProjects(): ProjectWithCounts[] {
  const rows = findAllProjects();
  const allTasks = findAllTasks();
  return rows.map((p) => decorate(p, allTasks.filter((t) => t.projectId === p.id)));
}

export function getProject(id: string): ProjectWithCounts | null {
  const p = findProjectById(id);
  if (!p) return null;
  return decorate(p, findTasksByProjectId(id));
}

function decorate(p: Project, ts: Task[]): ProjectWithCounts {
  const active = ts.filter((t) => !t.archived);
  const counts = TASK_STATUSES.reduce(
    (acc, s) => {
      acc[s] = 0;
      return acc;
    },
    {} as Record<TaskStatus, number>
  );
  let activeNonDone = 0;
  for (const t of active) {
    counts[t.status]++;
    if (isActiveStatus(t.status) && t.status !== "finished") activeNonDone++;
  }
  const previewSource =
    active.find((t) => t.status === "running") ?? active.find((t) => t.status === "needs-input");
  return {
    ...p,
    taskCounts: { ...counts, total: active.length, activeNonDone },
    preview: previewSource?.preview ?? null,
    githubUrl: detectGithubUrl(p.path),
  };
}

export function createProject(input: {
  name?: string;
  path: string;
  icon?: string;
  iconColor?: string;
  groupId?: string | null;
}): Project {
  const localPath = validateWorkingDirectory(input.path ?? "");

  const name = input.name?.trim() || path.basename(localPath) || "project";

  const now = Date.now();
  const id = newId("p");
  const branch = detectBranch(localPath);
  const row = {
    id,
    name,
    path: localPath,
    icon: (input.icon || name.slice(0, 2)).toUpperCase().slice(0, 2),
    iconColor: input.iconColor || "#ff5a1f",
    imagePath: null,
    groupId: input.groupId ?? null,
    pinned: false,
    pinnedOrder: null,
    branch,
    gitEnabled: true,
    launchCommands: null,
    customScripts: null,
    launchUrl: null,
    worktreeSetupCommand: null,
    rememberAgentSettings: false,
    savedAgent: null,
    savedSkipPermissions: false,
    savedBareSession: false,
    createdAt: now,
    updatedAt: now,
  };
  insertProject(row);
  events.emit("project:created", { id });
  return row;
}

export function updateProject(
  id: string,
  patch: Partial<
    Pick<
      Project,
      | "name"
      | "path"
      | "icon"
      | "iconColor"
      | "imagePath"
      | "groupId"
      | "pinned"
      | "pinnedOrder"
      | "branch"
      | "gitEnabled"
      | "launchUrl"
      | "worktreeSetupCommand"
      | "rememberAgentSettings"
      | "savedAgent"
      | "savedSkipPermissions"
      | "savedBareSession"
    >
  > & { launchCommands?: LaunchCommand[] | null; customScripts?: CustomScript[] | null }
): Project | null {
  const existing = findProjectById(id);
  if (!existing) return null;
  const { launchCommands, customScripts, ...rest } = patch;
  const nextPath =
    rest.path !== undefined ? validateWorkingDirectory(rest.path) : undefined;
  if (
    rest.worktreeSetupCommand !== undefined &&
    rest.worktreeSetupCommand !== null &&
    rest.worktreeSetupCommand.length > 500
  ) {
    throw new Error("worktreeSetupCommand cannot exceed 500 characters");
  }
  const updated = {
    ...existing,
    ...rest,
    ...(rest.pinned !== undefined
      ? {
          pinned: rest.pinned,
          pinnedOrder: rest.pinned
            ? rest.pinnedOrder ??
              existing.pinnedOrder ??
              nextPinnedOrder(findAllProjects())
            : null,
        }
      : {}),
    ...(nextPath !== undefined
      ? {
          path: nextPath,
          branch: rest.branch ?? detectBranch(nextPath),
        }
      : {}),
    ...(rest.worktreeSetupCommand !== undefined
      ? { worktreeSetupCommand: rest.worktreeSetupCommand?.trim() || null }
      : {}),
    ...(launchCommands !== undefined
      ? { launchCommands: serializeLaunchCommands(launchCommands) }
      : {}),
    ...(customScripts !== undefined
      ? { customScripts: serializeCustomScripts(customScripts) }
      : {}),
    updatedAt: Date.now(),
  };
  updateProjectRow(id, updated);
  events.emit("project:updated", { id });
  return updated;
}

function serializeCommandList(
  input: LaunchCommand[] | null,
  max: number,
  field: string
): string | null {
  if (!input) return null;
  if (!Array.isArray(input)) throw new ValidationError(`${field} must be an array`);
  if (input.length > max) {
    throw new ValidationError(`${field} cannot exceed ${max} entries`);
  }
  const cleaned = input.map((c) => {
    const id = String(c?.id ?? "").trim();
    const name = String(c?.name ?? "").trim();
    const command = String(c?.command ?? "").trim();
    if (!id) throw new ValidationError(`${field}: id is required`);
    if (!name) throw new ValidationError(`${field}: name is required`);
    if (!command) throw new ValidationError(`${field}: command is required`);
    return { id, name, command };
  });
  return cleaned.length === 0 ? null : JSON.stringify(cleaned);
}

function serializeLaunchCommands(input: LaunchCommand[] | null): string | null {
  return serializeCommandList(input, LAUNCH_COMMANDS_MAX, "launchCommands");
}

function serializeCustomScripts(input: CustomScript[] | null): string | null {
  if (!input) return null;
  if (!Array.isArray(input)) throw new ValidationError("customScripts must be an array");
  if (input.length > CUSTOM_SCRIPTS_MAX) {
    throw new ValidationError(`customScripts cannot exceed ${CUSTOM_SCRIPTS_MAX} entries`);
  }
  const cleaned = input.map((c) => {
    const id = String(c?.id ?? "").trim();
    const name = String(c?.name ?? "").trim();
    const command = String(c?.command ?? "").trim();
    if (!id) throw new ValidationError("customScripts: id is required");
    if (!name) throw new ValidationError("customScripts: name is required");
    if (!command) throw new ValidationError("customScripts: command is required");
    // serializeCommandList would strip args; preserve the normalized arg list.
    const args = normalizeScriptArgs(c?.args);
    return args ? { id, name, command, args } : { id, name, command };
  });
  return cleaned.length === 0 ? null : JSON.stringify(cleaned);
}

export function togglePin(id: string): Project | null {
  const togglePinned = getSqlite().transaction(() => {
    const existing = findProjectById(id);
    if (!existing) return null;
    const pinning = !existing.pinned;
    const now = Date.now();
    const pinnedOrder = pinning ? nextPinnedOrder(findAllProjects()) : null;
    const next = { ...existing, pinned: pinning, pinnedOrder, updatedAt: now };
    updateProjectRow(id, { pinned: pinning, pinnedOrder, updatedAt: now });
    return next;
  });
  const next = togglePinned.immediate();
  if (next) events.emit("project:updated", { id });
  return next;
}

export function reorderPinnedProjects(order: string[]): ProjectWithCounts[] {
  const updatePinnedOrder = getSqlite().transaction(() => {
    const pinned = getPinnedProjects(findAllProjects());
    try {
      validatePinnedReorder(order, pinned);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "invalid pinned order");
    }
    const now = Date.now();
    for (let index = 0; index < order.length; index++) {
      updateProjectRow(order[index]!, { pinnedOrder: index, updatedAt: now });
    }
  });
  updatePinnedOrder.immediate();
  for (const id of order) events.emit("project:updated", { id });
  return listProjects();
}

export function deleteProject(id: string): boolean {
  const changes = deleteProjectRow(id);
  if (changes > 0) deleteAllProjectImagesFor(id);
  events.emit("project:deleted", { id });
  return changes > 0;
}

function humanizeCommandName(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Pull a single-line scalar (e.g. `description:`, `title:`, `icon:`) out of a
// command file's YAML frontmatter (the block between the leading `---` fences).
function parseFmScalar(content: string, key: string): string {
  const fence = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fence) return "";
  const line = fence[1].match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!line) return "";
  return line[1].trim().replace(/^["']|["']$/g, "");
}

function parseCommandDescription(content: string): string {
  return parseFmScalar(content, "description");
}

// Example prompts for the chat intro ("here's how this works"). Prefers an
// explicit frontmatter `examples:` YAML list (author-controlled); otherwise
// falls back to clean quoted `e.g. "…"` phrases found in the body. Degrades to [].
function parseCommandExamples(content: string): string[] {
  const out: string[] = [];
  // 1) Frontmatter `examples:` list.
  const fence = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fence) {
    const fm = fence[1];
    const block = fm.match(/^examples:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
    if (block) {
      for (const line of block[1].split("\n")) {
        const item = line.match(/^[ \t]*-[ \t]*(.+?)\s*$/);
        if (item) {
          const v = item[1].trim().replace(/^["']|["']$/g, "");
          if (v && !out.includes(v)) out.push(v);
        }
      }
    }
  }
  if (out.length > 0) return out.slice(0, 3);
  // 2) Fallback: quoted `e.g. "…"` phrases in the body.
  for (const m of content.matchAll(/e\.g\.,?\s*"([^"]{6,90})"/gi)) {
    const v = m[1].trim();
    if (!out.includes(v)) out.push(v);
    if (out.length >= 3) break;
  }
  return out;
}

// User-created workflows carry `custom: true` in frontmatter — only these can be
// deleted/shared from the UI. Seeded commands have no such marker.
function parseCommandCustom(content: string): boolean {
  const fence = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fence) return false;
  return /^custom:\s*true\s*$/m.test(fence[1]);
}

// The agent/skill slugs a custom command owns (frontmatter `owns:` block), so
// delete/share can act on exactly those files and never on shared building blocks.
function parseCommandOwns(content: string): { agents: string[]; skills: string[] } {
  const out = { agents: [] as string[], skills: [] as string[] };
  const fence = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fence) return out;
  const fm = fence[1];
  for (const key of ["agents", "skills"] as const) {
    // Inline list form: `agents: [a, b]`
    const inline = fm.match(new RegExp(`^\\s*${key}:\\s*\\[([^\\]]*)\\]`, "m"));
    if (inline) {
      for (const raw of inline[1].split(",")) {
        const v = raw.trim().replace(/^["']|["']$/g, "");
        if (v) out[key].push(v);
      }
      continue;
    }
    // YAML list form under `owns:` (indented `- name`) — scoped to lines after the key.
    const block = fm.match(new RegExp(`^\\s*${key}:\\s*\\n((?:[ \\t]*-[ \\t]*.+\\n?)+)`, "m"));
    if (block) {
      for (const line of block[1].split("\n")) {
        const item = line.match(/^[ \t]*-[ \t]*(.+?)\s*$/);
        if (item) {
          const v = item[1].trim().replace(/^["']|["']$/g, "");
          if (v) out[key].push(v);
        }
      }
    }
  }
  return out;
}

/**
 * List the workflow commands a project exposes. CWF workspaces (workspace.md
 * present) read from the provider-neutral `commands/` dir — and refresh the
 * generated .claude/ projection so terminals stay in sync. Legacy projects
 * (e.g. code repos with only a .claude/) keep the old read path.
 */
export function listProjectCommands(id: string): ProjectCommand[] {
  const project = findProjectById(id);
  if (!project) return [];

  if (isCwfWorkspace(project.path)) {
    try {
      projectClaudeWorkspace(project.path);
    } catch {
      /* projection is best-effort here; chat start projects again */
    }
    return loadWorkspace(project.path).commands.map((c) => ({
      name: c.slug,
      title: c.title,
      description: c.description,
      examples: c.examples,
      custom: c.custom,
      icon: c.icon,
      template: c.template,
    }));
  }

  const dir = path.join(project.path, ".claude", "commands");
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const commands: ProjectCommand[] = [];
  for (const file of entries) {
    const name = file.replace(/\.md$/, "");
    let description = "";
    let examples: string[] = [];
    let custom = false;
    let title = humanizeCommandName(name);
    let icon: string | undefined;
    let template: string | undefined;
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf8");
      description = parseCommandDescription(content);
      examples = parseCommandExamples(content);
      custom = parseCommandCustom(content);
      // Author-controlled overrides (set via the edit dialog): title + emoji icon.
      title = parseFmScalar(content, "title") || title;
      icon = parseFmScalar(content, "icon") || undefined;
      template = parseFmScalar(content, "template") || undefined;
    } catch {
      description = "";
    }
    commands.push({ name, title, description, examples, custom, icon, template });
  }
  commands.sort((a, b) => a.title.localeCompare(b.title));
  return commands;
}

// ── Custom workflow management (create via chat; delete/share/import here) ──────

// A safe, single-segment slug (no separators / traversal). Files we touch are
// always `<contentRoot>/<sub>/<slug>.md`.
function safeSlug(name: string): string | null {
  const s = name.trim().replace(/\.md$/i, "");
  if (!s || s.includes("/") || s.includes("\\") || s.includes("..")) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(s)) return null;
  return s;
}

// Where a workspace's commands/agents/skills/templates live: CWF workspaces at
// the root (provider-neutral source; .claude/ is a generated projection),
// legacy projects inside .claude/.
function contentRoot(projectPath: string): string {
  return isCwfWorkspace(projectPath) ? projectPath : path.join(projectPath, ".claude");
}

// The path a command body should reference its output template by — relative to
// the workspace root (the engine's cwd at runtime).
function templateRefPath(projectPath: string, slug: string): string {
  return isCwfWorkspace(projectPath)
    ? `templates/${slug}.md`
    : `.claude/templates/${slug}.md`;
}

function readCustomCommandOrThrow(projectPath: string, name: string) {
  const slug = safeSlug(name);
  if (!slug) throw new Error("Invalid command name");
  const file = path.join(contentRoot(projectPath), "commands", `${slug}.md`);
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error("Command not found");
  }
  if (!parseCommandCustom(content)) {
    throw new Error("Only custom workflows can be managed here");
  }
  return {
    slug,
    file,
    content,
    owns: parseCommandOwns(content),
    template: parseFmScalar(content, "template") || null,
  };
}

/** Delete a user-created workflow: its command file plus the agent/skill files it
 *  owns (never shared building blocks). Returns how many of each were removed. */
export function deleteCustomCommand(
  projectId: string,
  name: string,
): { commands: number; agents: number; skills: number } {
  const project = findProjectById(projectId);
  if (!project) throw new Error("Project not found");
  const { file, owns, template } = readCustomCommandOrThrow(project.path, name);
  let agents = 0;
  let skills = 0;
  for (const [sub, list, kind] of [
    ["agents", owns.agents, "agents"],
    ["skills", owns.skills, "skills"],
  ] as const) {
    for (const raw of list) {
      const slug = safeSlug(raw);
      if (!slug) continue;
      const target = path.join(contentRoot(project.path), sub, `${slug}.md`);
      try {
        fs.rmSync(target, { force: true });
        if (kind === "agents") agents++;
        else skills++;
      } catch {
        /* best-effort */
      }
    }
  }
  // Remove the workflow's output template, if any.
  const templateSlug = template ? safeSlug(template) : null;
  if (templateSlug) {
    try {
      fs.rmSync(path.join(contentRoot(project.path), "templates", `${templateSlug}.md`), {
        force: true,
      });
    } catch {
      /* best-effort */
    }
  }
  fs.rmSync(file, { force: true });
  return { commands: 1, agents, skills };
}

// Set/replace a single-line scalar in a frontmatter block (value written as a
// quoted YAML string). Inserts the key just after the opening fence if absent.
function setFmScalar(fm: string, key: string, value: string): string {
  const line = `${key}: ${JSON.stringify(value)}`;
  const re = new RegExp(`^${key}:.*$`, "m");
  if (re.test(fm)) return fm.replace(re, line);
  return fm.length ? `${line}\n${fm}` : line;
}

function removeFmScalar(fm: string, key: string): string {
  return fm.replace(new RegExp(`^${key}:.*\\n?`, "m"), "");
}

// A managed block appended to a command body that points it at its output
// template. Idempotent (matched by markers) so it can be added/removed cleanly.
const TEMPLATE_BLOCK_START = "<!-- template:start -->";
const TEMPLATE_BLOCK_END = "<!-- template:end -->";
function setTemplateBlock(body: string, refPath: string | null): string {
  const stripped = body.replace(
    new RegExp(`\\n*${TEMPLATE_BLOCK_START}[\\s\\S]*?${TEMPLATE_BLOCK_END}\\n*`, "m"),
    "\n",
  );
  if (!refPath) return stripped.replace(/\s+$/, "") + "\n";
  const block = `${TEMPLATE_BLOCK_START}\n## Output format\nProduce the output **exactly** following the template at \`${refPath}\`.\n${TEMPLATE_BLOCK_END}`;
  return `${stripped.replace(/\s+$/, "")}\n\n${block}\n`;
}

/** Update a custom workflow's display fields (title / description / icon) by
 *  rewriting its command-file frontmatter. Leaves `custom`, `owns`, `examples`
 *  and the body untouched. */
export function updateCustomCommand(
  projectId: string,
  name: string,
  patch: {
    title?: string;
    description?: string;
    icon?: string;
    // undefined = leave as-is; string = set/replace the output template with this
    // content; null = remove the template.
    template?: string | null;
  },
): void {
  const project = findProjectById(projectId);
  if (!project) throw new Error("Project not found");
  const { slug, file, content } = readCustomCommandOrThrow(project.path, name);
  const fence = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fence) throw new Error("Command has no frontmatter");
  let fm = fence[1];
  if (patch.title !== undefined) fm = setFmScalar(fm, "title", patch.title);
  if (patch.description !== undefined) fm = setFmScalar(fm, "description", patch.description);
  if (patch.icon !== undefined) fm = setFmScalar(fm, "icon", patch.icon);

  let body = content.slice(fence[0].length);
  if (patch.template !== undefined) {
    const templatesDir = path.join(contentRoot(project.path), "templates");
    const templateFile = path.join(templatesDir, `${slug}.md`);
    if (patch.template === null) {
      try {
        fs.rmSync(templateFile, { force: true });
      } catch {
        /* best-effort */
      }
      fm = removeFmScalar(fm, "template");
      body = setTemplateBlock(body, null);
    } else {
      fs.mkdirSync(templatesDir, { recursive: true });
      fs.writeFileSync(templateFile, patch.template, "utf8");
      fm = setFmScalar(fm, "template", slug);
      body = setTemplateBlock(body, templateRefPath(project.path, slug));
    }
  }

  fs.writeFileSync(file, `---\n${fm}\n---${body}`, "utf8");
}

/** Serialize a custom workflow (command + owned agents/skills) into a portable
 *  bundle for sharing. */
export function readCommandBundle(projectId: string, name: string): CommandBundle {
  const project = findProjectById(projectId);
  if (!project) throw new Error("Project not found");
  const { slug, content, owns, template } = readCustomCommandOrThrow(project.path, name);
  const readList = (sub: "agents" | "skills") =>
    owns[sub]
      .map((raw) => safeSlug(raw))
      .filter((s): s is string => !!s)
      .map((s) => {
        try {
          return { name: s, content: fs.readFileSync(path.join(contentRoot(project.path), sub, `${s}.md`), "utf8") };
        } catch {
          return null;
        }
      })
      .filter((x): x is { name: string; content: string } => !!x);
  const bundle: CommandBundle = {
    version: 1,
    command: { name: slug, content },
    agents: readList("agents"),
    skills: readList("skills"),
  };
  const templateSlug = template ? safeSlug(template) : null;
  if (templateSlug) {
    try {
      bundle.template = {
        name: templateSlug,
        content: fs.readFileSync(
          path.join(contentRoot(project.path), "templates", `${templateSlug}.md`),
          "utf8",
        ),
      };
    } catch {
      /* template file missing — omit */
    }
  }
  return bundle;
}

/** Write an imported bundle into this workspace's `.claude/`. Name-collision safe:
 *  an existing slug gets a `-2`, `-3`, … suffix (command + its refs stay consistent). */
export function importCommandBundle(
  projectId: string,
  bundle: CommandBundle,
): { command: string; agents: number; skills: number } {
  const project = findProjectById(projectId);
  if (!project) throw new Error("Project not found");
  if (!bundle || bundle.version !== 1 || !bundle.command?.name || !bundle.command?.content) {
    throw new Error("Not a valid workflow bundle");
  }
  const base = contentRoot(project.path);
  const uniquePath = (sub: string, slug: string): { slug: string; file: string } => {
    let candidate = slug;
    let n = 2;
    while (fs.existsSync(path.join(base, sub, `${candidate}.md`))) {
      candidate = `${slug}-${n++}`;
    }
    return { slug: candidate, file: path.join(base, sub, `${candidate}.md`) };
  };
  const writeItem = (sub: "agents" | "skills", item: { name: string; content: string }) => {
    const slug = safeSlug(item.name);
    if (!slug) return null;
    fs.mkdirSync(path.join(base, sub), { recursive: true });
    const { slug: finalSlug, file } = uniquePath(sub, slug);
    fs.writeFileSync(file, item.content, "utf8");
    return { from: slug, to: finalSlug };
  };
  // Agents/skills first, tracking any renames so the command can be rewritten to match.
  const rename: Record<string, string> = {};
  let agents = 0;
  let skills = 0;
  for (const a of bundle.agents ?? []) {
    const r = writeItem("agents", a);
    if (r) { if (r.from !== r.to) rename[r.from] = r.to; agents++; }
  }
  for (const s of bundle.skills ?? []) {
    const r = writeItem("skills", s);
    if (r) { if (r.from !== r.to) rename[r.from] = r.to; skills++; }
  }
  const cmdSlug = safeSlug(bundle.command.name) ?? "workflow";
  fs.mkdirSync(path.join(base, "commands"), { recursive: true });
  const { slug: finalCmd, file: cmdFile } = uniquePath("commands", cmdSlug);
  let cmdContent = bundle.command.content;
  for (const [from, to] of Object.entries(rename)) {
    cmdContent = cmdContent.split(from).join(to);
  }
  // Carry the output template, re-pointing the command at the (possibly renamed) slug.
  if (bundle.template?.content) {
    fs.mkdirSync(path.join(base, "templates"), { recursive: true });
    fs.writeFileSync(path.join(base, "templates", `${finalCmd}.md`), bundle.template.content, "utf8");
    const fence = cmdContent.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fence) {
      const fm = setFmScalar(fence[1], "template", finalCmd);
      const body = setTemplateBlock(
        cmdContent.slice(fence[0].length),
        templateRefPath(project.path, finalCmd),
      );
      cmdContent = `---\n${fm}\n---${body}`;
    }
  }
  fs.writeFileSync(cmdFile, cmdContent, "utf8");
  return { command: finalCmd, agents, skills };
}

export function refreshBranch(id: string): string | null {
  const p = findProjectById(id);
  if (!p) return null;
  const branch = detectBranch(p.path);
  if (branch !== p.branch) {
    updateProjectRow(id, { branch, updatedAt: Date.now() });
    events.emit("project:updated", { id });
  }
  return branch;
}
