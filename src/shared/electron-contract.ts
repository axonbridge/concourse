import type { ChatEvent } from "~/shared/chat";

export const FILE_READ_ERRORS = ["invalid-path", "not-found", "binary", "too-large"] as const;
export const FILE_WRITE_ERRORS = [
  "invalid-path",
  "invalid-content",
  "stale",
  // Hit when the renderer tried the generic `files:write` for an auto-executing
  // config path (Claude/Codex hooks, .git/hooks, package.json, etc). The
  // renderer is expected to retry via `files:writeSensitive`, which surfaces a
  // native confirm in the main process.
  "protected-path",
  // Returned by `files:writeSensitive` when the user clicked Cancel in the
  // native confirm dialog. Not an error condition — just a no-op result.
  "user-declined",
] as const;

export type FileReadError = (typeof FILE_READ_ERRORS)[number];
export type FileWriteError = (typeof FILE_WRITE_ERRORS)[number];

export type FileListResult = { ok: true; files: string[] } | { ok: false; error: string };

export type ImagePreviewMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/bmp"
  | "image/x-icon"
  | "image/avif";

export type FileReadResult =
  | { ok: true; kind: "text"; content: string; mtimeMs: number; lineCount: number }
  | {
      ok: true;
      kind: "image";
      dataUrl: string;
      mimeType: ImagePreviewMime;
      size: number;
      mtimeMs: number;
    }
  | { ok: false; error: FileReadError | string; lineCount?: number };

export type FileWriteResult =
  | { ok: true; mtimeMs: number }
  | { ok: false; error: FileWriteError | string; currentMtimeMs?: number };

export type InstallDiagramSkillResult = import("~/shared/diagram-skill-install").DiagramSkillInstallResult;
export type InstallShipSkillsResult = import("~/shared/ship-skill-install").ShipSkillInstallResult;

export type LaunchProcessKillResult = {
  ptyCount: number;
  ports: Array<{
    port: number;
    pids: number[];
    killed: number[];
    errors: string[];
  }>;
};

export type PtySpawnAgent = "claude-code" | "codex" | "cursor-cli" | "opencode";

export type CliCheckResult =
  | {
      ok: true;
      path: string;
      version?: string;
      label?: string;
      requiredVersion?: string;
      packageUrl?: string;
      updateCommands?: readonly string[];
    }
  | {
      ok: false;
      reason: string;
      path?: string;
      label?: string;
      version?: string;
      requiredVersion?: string;
      packageUrl?: string;
      updateCommands?: readonly string[];
    };

export type BasePtySpawnOptions = {
  taskId: string;
  cwd: string;
  command: string;
  args?: string[];
  cols?: number;
  rows?: number;
  mcEnv?: { apiUrl?: string; token?: string };
  concourseTheme?: "dark" | "light";
};

export type AgentPtySpawnOptions = BasePtySpawnOptions & {
  agent: PtySpawnAgent;
  dangerouslySkipPermissions?: boolean;
  shell?: never;
  /** Starting prompt written to the agent's stdin once its TUI is ready (voice control). */
  initialInput?: string;
};

export type ShellPtySpawnOptions = BasePtySpawnOptions & {
  shell: true;
  agent?: never;
  dangerouslySkipPermissions?: never;
  /**
   * Project-less "home" terminal (dashboard). The main process replaces cwd with
   * its own os.homedir() and whitelists it; the renderer may pass cwd: "".
   */
  home?: boolean;
};

export type PtySpawnOptions = AgentPtySpawnOptions | ShellPtySpawnOptions;

export type TerminalImageSaveInput = {
  name?: string;
  mimeType: string;
  data: ArrayBuffer;
};

export type TerminalImageSaveResult = { path: string } | { error: string };

export type VoiceTranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string; code?: "unavailable" };

export type ElectronBridge = {
  settings: {
    getToken: () => Promise<string>;
    regenerateToken: () => Promise<string>;
  };
  mcp: {
    list: () => Promise<{ servers: Array<{ name: string; url: string; status: string }>; error?: string }>;
    login: (name: string) => Promise<{ ok: boolean; error?: string }>;
    logout: (name: string) => Promise<{ ok: boolean; error?: string }>;
  };
  mcpWorkspace: {
    /** Server statuses for a workspace's .mcp.json (in-app client, own OAuth). */
    status: (cwd: string) => Promise<
      Array<{
        name: string;
        url: string;
        status: "connected" | "needs-auth" | "error" | "unsupported";
        toolCount?: number;
        error?: string;
      }>
    >;
    authenticate: (name: string, url: string) => Promise<{ ok: boolean; error?: string }>;
    logout: (url: string) => Promise<{ ok: true }>;
    removeServer: (cwd: string, name: string) => Promise<{ ok: boolean }>;
  };
  mcpGlobal: {
    list: () => Promise<Array<{ name: string; url?: string; command?: string; type?: string }>>;
    add: (name: string, cfg: { url?: string; command?: string }) => Promise<{ ok: boolean; error?: string }>;
    remove: (name: string) => Promise<{ ok: true }>;
  };
  credentials: {
    /** provider id → true when an API key is stored. Key material never reaches the renderer. */
    status: () => Promise<Record<string, boolean>>;
    set: (provider: string, apiKey: string) => Promise<{ ok: boolean; error?: string }>;
    delete: (provider: string) => Promise<{ ok: boolean }>;
  };
  models: {
    /** Live model discovery for a provider (cached; static fallback when offline/keyless). */
    list: (provider: string) => Promise<{
      models: Array<{ id: string; label: string }>;
      source: "live" | "static";
      error?: string;
    }>;
  };
  chat: {
    start: (opts: {
      sessionId: string;
      cwd: string;
      initialText: string;
      /** Which AI provider powers the session (TaskAgent id; default claude-code). */
      agent?: string;
      /** Model id from the provider's models list (src/shared/ai-providers.ts). */
      model?: string;
      /** Provider-side conversation id for durable resume. */
      providerSessionId?: string;
      resume?: boolean;
      autoApproveWrites?: boolean;
      /** OpenAI-compatible endpoint for the "custom" direct engine. */
      baseUrl?: string;
    }) => Promise<{ ok: boolean }>;
    send: (sessionId: string, text: string) => Promise<{ ok: boolean }>;
    /** Mid-session model switch — only direct engines honor it (ok: false otherwise). */
    setModel: (sessionId: string, model?: string) => Promise<{ ok: boolean }>;
    respondPermission: (sessionId: string, requestId: string, allow: boolean) => Promise<{ ok: boolean }>;
    stop: (sessionId: string) => Promise<{ ok: boolean }>;
    onEvent: (cb: (event: ChatEvent) => void) => () => void;
  };
  voice: {
    available: () => Promise<boolean>;
    prewarm: () => Promise<boolean>;
    /** `prompt` biases the decoder toward expected words (e.g. project names). */
    transcribe: (wav: ArrayBuffer, prompt?: string) => Promise<VoiceTranscribeResult>;
  };
  getPathForFile: (file: File) => string;
  browseFolder: () => Promise<string | null>;
  saveWorkflowFile: (
    defaultName: string,
    content: string,
  ) => Promise<{ ok: true; path: string } | { ok: false; error?: string }>;
  importWorkflowFile: () => Promise<{ name: string; content: string } | null>;
  pickTemplateFile: () => Promise<{ name: string; content: string } | null>;
  attachments: {
    pick: () => Promise<Array<{ path: string; name: string; dataUrl?: string }>>;
    stage: (cwd: string, paths: string[]) => Promise<Array<{ rel: string; name: string }>>;
  };
  saveTextFile: (
    defaultName: string,
    content: string,
    filters: { name: string; extensions: string[] }[],
  ) => Promise<{ ok: true; path: string } | { ok: false; error?: string }>;
  exportPdf: (
    defaultName: string,
    html: string,
  ) => Promise<{ ok: true; path: string } | { ok: false; error?: string }>;
  openPath: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  openFile: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  openExternal: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  clipboard: {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<{ ok: true }>;
  };
  terminalImages: {
    saveDropped: (input: TerminalImageSaveInput) => Promise<TerminalImageSaveResult>;
    saveClipboard: () => Promise<TerminalImageSaveResult | null>;
  };
  pickImage: () => Promise<
    { sourcePath: string; extension: string } | { error: string } | null
  >;
  saveProjectImage: (opts: {
    projectId: string;
    sourcePath: string;
    extension: string;
  }) => Promise<{ filename: string } | { error: string }>;
  getRuntimePort: () => Promise<number | null>;
  getUserDataDir: () => Promise<string>;
  getUserName: () => Promise<{ source: "git" | "os"; fullName: string; firstName: string }>;
  reload: () => Promise<{ ok: true } | { ok: false; error: string }>;
  notifications: {
    getPermission: () => Promise<"granted" | "unsupported">;
    showSessionFinished: (payload: {
      tag: string;
      title: string;
      body: string;
      projectId: string;
      taskId: string;
      worktreeId: string | null;
    }) => Promise<{ ok: true } | { ok: false; error: string }>;
    onSessionFinishedClick: (
      cb: (payload: {
        projectId: string;
        taskId: string;
        worktreeId: string | null;
      }) => void,
    ) => () => void;
  };
  cliCheck: (command: string, opts?: { verifyVersion?: boolean }) => Promise<CliCheckResult>;
  pty: {
    spawn: (opts: PtySpawnOptions) => Promise<{ ptyId: string }>;
    write: (ptyId: string, data: string) => Promise<boolean>;
    resize: (ptyId: string, cols: number, rows: number) => Promise<boolean>;
    kill: (ptyId: string) => Promise<boolean>;
    killLaunchProcesses: (opts: {
      cwd: string;
      commands: string[];
      ports?: number[];
    }) => Promise<LaunchProcessKillResult>;
    /** Kill every PTY whose cwd is inside `cwd` (e.g. before deleting a worktree). */
    killUnderPath: (cwd: string) => Promise<{ ptyCount: number }>;
    onData: (cb: (msg: { ptyId: string; data: string; seq: number }) => void) => () => void;
    onExit: (cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void) => () => void;
    replay: (ptyId: string) => Promise<{ data: string; nextSeq: number }>;
  };
  onSwipe: (cb: (direction: "left" | "right" | "up" | "down") => void) => () => void;
  onCloseIntent: (cb: () => void) => () => void;
  files: {
    list: (projectRoot: string) => Promise<FileListResult>;
    read: (projectRoot: string, relPath: string) => Promise<FileReadResult>;
    write: (
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null
    ) => Promise<FileWriteResult>;
    writeSensitive: (
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null
    ) => Promise<FileWriteResult>;
    watch: (
      projectRoot: string,
      relPath: string
    ) => Promise<{ ok: true; watchId: string } | { ok: false; error: string }>;
    unwatch: (watchId: string) => Promise<{ ok: true }>;
    onChanged: (cb: (msg: { watchId: string; mtimeMs: number }) => void) => () => void;
  };
};
