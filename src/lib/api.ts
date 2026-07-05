import type { Group, Project, Task, UserTerminal } from "~/db/schema";
import type { TaskStatus } from "~/shared/domain";
import type { EngineId } from "~/shared/ai-providers";
import type { CommandBundle, ProjectCommand, ProjectPathStatus, ProjectWithCounts } from "~/shared/projects";
import { DEV_SERVER_ORIGIN } from "~/shared/dev-server";
import type {
  CommitResult,
  CreatePullRequestResult,
  GitBranch,
  GitBranchesResult,
  GitCheckoutResult,
  GitDiff,
  GitStatus,
  PushResult,
} from "~/server/services/git";
export type { GitBranch, GitBranchesResult, GitCheckoutResult };
import type { Binding, BindingMap, HotkeyAction } from "~/lib/keybindings/types";
import type { AccentColorId } from "~/lib/accent-colors";
import type { UsageSummary } from "~/shared/token-usage";
import type { WorktreeInfo } from "~/shared/worktrees";
import type { CommitCli, CommitCliDetection } from "~/shared/commit-cli";
import type {
  GitDiffChangedFilesView,
  ProjectsDashboardView,
  SelectedWorktreeByProject,
} from "~/shared/ui-preferences";
import type { TerminalZoomLevel } from "~/shared/terminal-zoom";
import type { VoiceCommandAliases } from "~/shared/voice-command-aliases";
import { pruneStoredSessionFinishNotifications } from "~/lib/session-notification-store";

// The api bearer token is intentionally NOT part of this HTTP-derived shape.
// Renderer code obtains it through the Electron IPC channel `settings:getToken`
// (see queries/index.ts:apiTokenQueryOptions); the IPC handler pushes the value
// into `setApiToken` below so every fetch in this module attaches it.
export type AppSettings = {
  agentSystemBannerDisabled: boolean;
  accentColor: AccentColorId;
  minimalTheme: boolean;
  mouseGradientDisabled: boolean;
  sessionFinishToastEnabled: boolean;
  sessionFinishOsNotificationEnabled: boolean;
  /** Ding when a session-finish or diagram-ready notification arrives. */
  notificationSoundEnabled: boolean;
  launchOverlayEnabled: boolean;
  automaticUpdateDownloadsEnabled: boolean;
  automaticUpdateInstallOnQuitEnabled: boolean;
  /** Beta: git worktrees per project (off by default). */
  worktreesEnabled: boolean;
  /** Show the Project Terminals panel at the bottom of a project (on by default;
   *  business users can turn it off). */
  projectTerminalsEnabled: boolean;
  /** Experimental: push-to-talk voice control (off by default). */
  voiceControlEnabled: boolean;
  gitDiffChangedFilesView: GitDiffChangedFilesView | null;
  gitDiffChangedFilesWidth: number | null;
  /** Projects dashboard layout — cards (default) or table. */
  projectsDashboardView: ProjectsDashboardView | null;
  selectedWorktreeByProject: SelectedWorktreeByProject | null;
  /**
   * Which CLI generates Ship's commit message. `null` means "not set yet" —
   * the server auto-detects and seeds it on the first ship attempt.
   */
  commitCli: CommitCli | null;
  /** Default terminal text zoom (-2 … +2). Per-pane overrides live in localStorage. */
  terminalZoomLevel: TerminalZoomLevel;
  /** Default AI engine for new sessions — terminals open it when it's a vendor
   *  CLI (else Claude Code); chat/workflows use it when it's chat-capable. */
  aiProvider: EngineId;
  /** Default model per provider (provider id → model id). Claude's entry also
   *  drives the `--model` flag injected into claude-code terminal launches. */
  aiModelByProvider: Record<string, string>;
  /** How each provider authenticates (provider id → mode). "cli-login" (default)
   *  uses the vendor CLI's own login; "api-key" uses a key stored in the OS
   *  keychain (electron credentials store — the key itself never lives here). */
  aiCredentialByProvider: Record<string, "cli-login" | "api-key">;
  /** OpenAI-compatible endpoint for the "custom" direct engine ("" = unset). */
  aiCustomBaseUrl: string;
  /** User-defined phrases that map to built-in voice commands. */
  voiceCommandAliases: VoiceCommandAliases;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Module-level bearer cache. Populated by `apiTokenQueryOptions.queryFn` (see
// src/queries/index.ts) so every `req<T>` below can attach the token without
// awaiting an IPC round-trip per call. `resolveApiToken` falls back to a server
// bootstrap on SSR and lazy IPC in the renderer when nothing has primed the
// cache yet (test code, edge timing).
let cachedApiToken: string | null = null;
let pendingApiToken: Promise<string | null> | null = null;
let serverApiTokenResolver: (() => string | null) | null = null;

export function setApiToken(token: string | null): void {
  cachedApiToken = token;
  pendingApiToken = null;
}

export function setServerApiTokenResolver(resolver: (() => string | null) | null): void {
  serverApiTokenResolver = resolver;
}

export async function resolveApiToken(): Promise<string | null> {
  if (cachedApiToken) return cachedApiToken;
  if (import.meta.env.SSR) {
    try {
      return serverApiTokenResolver?.() ?? null;
    } catch {
      return null;
    }
  }
  if (pendingApiToken) return pendingApiToken;
  pendingApiToken = (async () => {
    try {
      const { getElectron } = await import("./electron");
      const electron = getElectron();
      if (!electron) return null;
      const token = await electron.settings.getToken();
      cachedApiToken = token;
      return token;
    } catch {
      return null;
    } finally {
      pendingApiToken = null;
    }
  })();
  return pendingApiToken;
}

function hasAuthHeader(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  if (headers instanceof Headers) return headers.has("authorization");
  if (Array.isArray(headers)) {
    return headers.some(([k]) => k.toLowerCase() === "authorization");
  }
  return Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  // Node's fetch (used during TanStack Start SSR) rejects relative URLs.
  // In the browser the page origin is implicit; on the server, prepend the
  // Vite dev origin so loader prefetches resolve correctly.
  const resolved =
    typeof window === "undefined" && url.startsWith("/")
      ? DEV_SERVER_ORIGIN + url
      : url;
  const baseHeaders: Record<string, string> = { "content-type": "application/json" };
  if (!hasAuthHeader(init?.headers)) {
    const token = await resolveApiToken();
    if (token) baseHeaders.authorization = `Bearer ${token}`;
  }
  const res = await fetch(resolved, {
    ...init,
    headers: {
      ...baseHeaders,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON — keep as text
    }
    const message =
      (body && typeof body === "object" && "error" in body && typeof (body as any).error === "string"
        ? (body as any).error
        : null) ?? `${res.status} ${res.statusText}: ${text}`;
    throw new ApiError(message, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => req<{ projects: ProjectWithCounts[] }>("/api/projects"),
  getProject: (id: string) => req<{ project: ProjectWithCounts }>(`/api/projects/${id}`),
  getProjectPathStatus: (id: string, worktreeId?: string | null) =>
    req<{ status: ProjectPathStatus }>(
      `/api/projects/${id}/path-status${worktreeId ? `?worktreeId=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  projectCommands: (id: string) =>
    req<{ commands: ProjectCommand[] }>(`/api/projects/${id}/commands`),
  ensureWorkflowBuilder: (id: string) =>
    req<{ ok: true }>(`/api/projects/${id}/workflow-builder`, { method: "POST" }),
  deleteCommand: (id: string, name: string) =>
    req<{ deleted: { commands: number; agents: number; skills: number } }>(
      `/api/projects/${id}/commands/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
  updateCommand: (
    id: string,
    name: string,
    patch: { title?: string; description?: string; icon?: string; template?: string | null },
  ) =>
    req<{ ok: boolean }>(`/api/projects/${id}/commands/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  commandBundle: (id: string, name: string) =>
    req<{ bundle: CommandBundle }>(
      `/api/projects/${id}/commands/${encodeURIComponent(name)}/bundle`,
    ),
  importCommand: (id: string, bundle: CommandBundle) =>
    req<{ imported: { command: string; agents: number; skills: number } }>(
      `/api/projects/${id}/commands/import`,
      { method: "POST", body: JSON.stringify({ bundle }) },
    ),
  classifyFolder: (path: string) =>
    req<{ kind: "missing" | "empty" | "cwf" | "legacy-claude" | "plain"; isGit: boolean }>(
      `/api/folders/classify?path=${encodeURIComponent(path)}`,
    ),
  createProject: (body: {
    name?: string;
    path: string;
    githubUrl?: string;
    icon?: string;
    iconColor?: string;
    groupId?: string | null;
    /** Journey A: set up an empty folder as a Concourse workspace. */
    scaffoldWorkspace?: boolean;
  }) =>
    req<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateProject: (id: string, body: Record<string, unknown>) =>
    req<{ project: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  updateProjectLaunchUrl: (id: string, launchUrl: string | null) =>
    req<{ project: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ launchUrl }),
    }),
  togglePin: (id: string) =>
    req<{ project: Project }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ togglePin: true }),
    }),
  reorderPinnedProjects: (order: string[]) =>
    req<{ projects: ProjectWithCounts[] }>("/api/projects/pinned-order", {
      method: "PATCH",
      body: JSON.stringify({ order }),
    }),
  deleteProject: async (id: string) => {
    await req<void>(`/api/projects/${id}`, { method: "DELETE" });
    pruneStoredSessionFinishNotifications({ type: "project", projectId: id });
  },

  listWorktrees: (projectId: string) =>
    req<{ worktrees: WorktreeInfo[] }>(`/api/projects/${projectId}/worktrees`),
  createWorktree: (projectId: string) =>
    req<{ worktree: WorktreeInfo; setupCommand: string | null }>(
      `/api/projects/${projectId}/worktrees`,
      { method: "POST" },
    ),
  deleteWorktree: async (
    projectId: string,
    worktreeId: string,
    opts: { force?: boolean; stashChanges?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.force) params.set("force", "true");
    if (opts.stashChanges) params.set("stashChanges", "true");
    const queryString = params.toString();
    const query = queryString ? `?${queryString}` : "";
    await req<void>(
      `/api/projects/${projectId}/worktrees/${encodeURIComponent(worktreeId)}${query}`,
      {
        method: "DELETE",
        body: JSON.stringify(opts),
      },
    );
    pruneStoredSessionFinishNotifications({
      type: "worktree",
      projectId,
      worktreeId,
    });
  },

  listGroups: () => req<{ groups: Group[] }>("/api/groups"),
  createGroup: (body: { name: string; color?: string }) =>
    req<{ group: Group }>("/api/groups", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateGroup: (id: string, body: { name?: string; color?: string }) =>
    req<{ group: Group }>(`/api/groups/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteGroup: (id: string) =>
    req<void>(`/api/groups/${id}`, { method: "DELETE" }),

  listTasks: (projectId: string, worktreeId?: string | null, scopeId?: string | null) =>
    req<{ tasks: Task[] }>(
      `/api/projects/${projectId}/tasks${scopedWorktreeQuery(worktreeId, scopeId)}`,
    ),
  getTask: (id: string) => req<{ task: Task }>(`/api/tasks/${id}`),
  archiveTask: (id: string) =>
    req<{ task: Task }>(`/api/tasks/${id}/archive`, { method: "POST" }),
  restoreTask: (id: string) =>
    req<{ task: Task }>(`/api/tasks/${id}/restore`, { method: "POST" }),
  updateTaskStatus: (id: string, body: { status?: TaskStatus; preview?: string; lines?: number; prompt?: string }) =>
    req<{ task: Task }>(`/api/tasks/${id}/status`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createTaskInternal: (
    projectId: string,
    body: {
      id?: string;
      title: string;
      agent: EngineId;
      branch?: string;
      claudeSessionId?: string | null;
      claudeSkipPermissions?: boolean;
      claudeBareSession?: boolean;
      mode?: "terminal" | "chat";
      worktreeId?: string | null;
      scopeId?: string | null;
    },
  ) =>
    req<{ task: Task }>(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateTask: (
    id: string,
    body: {
      title?: string;
      branch?: string;
      pinned?: boolean;
      description?: string;
      claudeSessionId?: string | null;
      claudeSkipPermissions?: boolean;
      claudeBareSession?: boolean;
    }
  ) =>
    req<{ task: Task }>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTask: async (id: string) => {
    await req<void>(`/api/tasks/${id}`, { method: "DELETE" });
    pruneStoredSessionFinishNotifications({ type: "task", taskId: id });
  },

  listUserTerminals: (projectId: string, worktreeId?: string | null, scopeId?: string | null) =>
    req<{ terminals: UserTerminal[] }>(
      `/api/projects/${projectId}/user-terminals${scopedWorktreeQuery(worktreeId, scopeId)}`,
    ),
  createUserTerminal: (
    projectId: string,
    body: {
      id?: string;
      name?: string;
      cwd?: string | null;
      startCommand?: string | null;
      worktreeId?: string | null;
      scopeId?: string | null;
    },
  ) =>
    req<{ terminal: UserTerminal }>(`/api/projects/${projectId}/user-terminals`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  renameUserTerminal: (id: string, name: string) =>
    req<{ terminal: UserTerminal }>(`/api/user-terminals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteUserTerminal: (id: string) =>
    req<void>(`/api/user-terminals/${id}`, { method: "DELETE" }),

  // Project-less "home" terminals (the dashboard terminals). Returned shaped as
  // UserTerminal (sentinel projectId) so the same terminal store/panel render them.
  listHomeTerminals: (scopeId: string) =>
    req<{ terminals: UserTerminal[] }>(
      `/api/home/user-terminals?scopeId=${encodeURIComponent(scopeId)}`,
    ),
  createHomeTerminal: (body: {
    id?: string;
    name?: string;
    cwd?: string | null;
    scopeId: string;
    startCommand?: string | null;
  }) =>
    req<{ terminal: UserTerminal }>("/api/home/user-terminals", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  renameHomeTerminal: (id: string, name: string) =>
    req<{ terminal: UserTerminal }>(`/api/home/user-terminals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteHomeTerminal: (id: string) =>
    req<void>(`/api/home/user-terminals/${id}`, { method: "DELETE" }),

  getKeybindings: () => req<{ bindings: BindingMap }>("/api/keybindings"),
  setKeybinding: (action: HotkeyAction, binding: Binding) =>
    req<{ bindings: BindingMap }>("/api/keybindings", {
      method: "PUT",
      body: JSON.stringify({ action, binding }),
    }),
  resetKeybinding: (action: HotkeyAction) =>
    req<{ bindings: BindingMap }>(`/api/keybindings?action=${encodeURIComponent(action)}`, {
      method: "DELETE",
    }),
  resetAllKeybindings: () =>
    req<{ bindings: BindingMap }>("/api/keybindings", { method: "DELETE" }),

  getSettings: () => req<AppSettings>("/api/settings"),

  updateSettings: (
    body: Partial<
      Pick<
        AppSettings,
        | "agentSystemBannerDisabled"
        | "accentColor"
        | "minimalTheme"
        | "mouseGradientDisabled"
        | "sessionFinishToastEnabled"
        | "sessionFinishOsNotificationEnabled"
        | "notificationSoundEnabled"
        | "launchOverlayEnabled"
        | "automaticUpdateDownloadsEnabled"
        | "automaticUpdateInstallOnQuitEnabled"
        | "worktreesEnabled"
        | "projectTerminalsEnabled"
        | "voiceControlEnabled"
        | "gitDiffChangedFilesView"
        | "gitDiffChangedFilesWidth"
        | "projectsDashboardView"
        | "selectedWorktreeByProject"
        | "commitCli"
        | "terminalZoomLevel"
        | "aiProvider"
        | "aiModelByProvider"
        | "aiCredentialByProvider"
        | "aiCustomBaseUrl"
        | "voiceCommandAliases"
      >
    >,
  ) =>
    req<AppSettings>("/api/settings", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  detectCommitCli: () =>
    req<{ detected: CommitCliDetection }>("/api/commit-cli/detect"),

  getGitStatus: (projectId: string, worktreeId?: string | null) =>
    req<GitStatus>(`/api/projects/${projectId}/git/status${worktreeQuery(worktreeId)}`),
  getGitBranches: (projectId: string, worktreeId?: string | null) =>
    req<GitBranchesResult>(`/api/projects/${projectId}/git/branches${worktreeQuery(worktreeId)}`),
  gitCheckout: (
    projectId: string,
    branch: string,
    opts: { create?: boolean; worktreeId?: string | null } = {},
  ) =>
    req<GitCheckoutResult>(`/api/projects/${projectId}/git/checkout`, {
      method: "POST",
      body: JSON.stringify({
        branch,
        create: opts.create,
        worktreeId: opts.worktreeId ?? null,
      }),
    }),
  getGitDiff: (projectId: string, file: string, staged: boolean, worktreeId?: string | null) =>
    req<GitDiff>(
      `/api/projects/${projectId}/git/diff?file=${encodeURIComponent(file)}&staged=${staged ? "1" : "0"}${worktreeId ? `&worktreeId=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  stageFiles: (projectId: string, files: string[], worktreeId?: string | null) =>
    req<{ ok: true }>(`/api/projects/${projectId}/git/stage`, {
      method: "POST",
      body: JSON.stringify({ files, worktreeId: worktreeId ?? null }),
    }),
  unstageFiles: (projectId: string, files: string[], worktreeId?: string | null) =>
    req<{ ok: true }>(`/api/projects/${projectId}/git/unstage`, {
      method: "POST",
      body: JSON.stringify({ files, worktreeId: worktreeId ?? null }),
    }),
  gitAvailable: () => req<{ available: boolean; version?: string }>("/api/git/available"),
  cloneRepository: (body: { url: string; parentDir: string; folderName?: string }) =>
    req<{ path: string }>("/api/git/clone", { method: "POST", body: JSON.stringify(body) }),
  gitSshStatus: () =>
    req<{ exists: boolean; publicKey?: string; keyPath: string }>("/api/git/ssh"),
  gitSshGenerate: () =>
    req<{ exists: boolean; publicKey?: string; keyPath: string }>("/api/git/ssh/generate", {
      method: "POST",
      body: "{}",
    }),
  gitSshTest: () =>
    req<{ ok: boolean; message: string }>("/api/git/ssh/test", { method: "POST", body: "{}" }),
  gitIdentity: () => req<{ name: string; email: string }>("/api/git/identity"),
  setGitIdentity: (identity: { name: string; email: string }) =>
    req<{ name: string; email: string }>("/api/git/identity", {
      method: "POST",
      body: JSON.stringify(identity),
    }),
  gitPull: (projectId: string, worktreeId?: string | null) =>
    req<{ result: { kind: "pulled" | "up-to-date"; summary: string } }>(
      `/api/projects/${projectId}/git/pull`,
      { method: "POST", body: JSON.stringify({ worktreeId: worktreeId ?? null }) },
    ),
  discardGitFile: (projectId: string, file: string, worktreeId?: string | null) =>
    req<{ ok: true }>(`/api/projects/${projectId}/git/discard`, {
      method: "POST",
      body: JSON.stringify({ file, worktreeId: worktreeId ?? null }),
    }),
  gitCommit: (
    projectId: string,
    opts: {
      autoStage?: boolean;
      worktreeId?: string | null;
      /**
       * When supplied, the server skips CLI generation entirely and commits
       * with this literal message. Used by the ship-failed dialog's manual
       * recovery path.
       */
      message?: string;
    } = {},
  ) =>
    req<CommitResult>(`/api/projects/${projectId}/git/commit`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),
  gitPush: (projectId: string, worktreeId?: string | null) =>
    req<PushResult>(`/api/projects/${projectId}/git/push`, {
      method: "POST",
      body: JSON.stringify({ worktreeId: worktreeId ?? null }),
    }),
  gitCreatePullRequest: (projectId: string, worktreeId?: string | null) =>
    req<CreatePullRequestResult>(`/api/projects/${projectId}/git/create-pr`, {
      method: "POST",
      body: JSON.stringify({ worktreeId: worktreeId ?? null }),
    }),
  getUsage: (days: number = 30) =>
    req<UsageSummary>(`/api/usage?days=${days}`),
  createEventsTicket: () =>
    req<{ ticket: string; expiresAt: number }>("/api/events/ticket", {
      method: "POST",
    }),
  listDiagrams: (projectId: string) =>
    req<{ diagrams: import("~/shared/diagram").StoredDiagram[] }>(
      `/api/diagrams?projectId=${encodeURIComponent(projectId)}`,
    ),
  getDiagrams: (taskId: string) =>
    req<{ diagrams: import("~/shared/diagram").StoredDiagram[] }>(
      `/api/diagram?taskId=${encodeURIComponent(taskId)}`,
    ),

  deleteProjectFile: (projectId: string, filePath: string, worktreeId?: string | null) =>
    req<{ ok: true }>(
      `/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}${worktreeId ? `&worktreeId=${encodeURIComponent(worktreeId)}` : ""}`,
      { method: "DELETE" },
    ),
};

function worktreeQuery(worktreeId?: string | null): string {
  if (worktreeId === undefined) return "";
  return `?worktreeId=${encodeURIComponent(worktreeId || "main")}`;
}

function scopedWorktreeQuery(worktreeId?: string | null, scopeId?: string | null): string {
  const params = new URLSearchParams();
  if (worktreeId !== undefined) params.set("worktreeId", worktreeId || "main");
  if (scopeId) params.set("scopeId", scopeId);
  const query = params.toString();
  return query ? `?${query}` : "";
}
