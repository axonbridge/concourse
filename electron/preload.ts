import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC } from "./ipc-channels";

/** Subscribe to a main→renderer IPC channel; returns an unsubscribe fn. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Mirror of UpdateState in update-manager.ts. Kept structural here so the renderer
// bundle never imports main-process code. Drift between the two is caught by the
// reviewer-contracts subagent.
export type UpdateStateBridge =
  | { kind: "unsupported-dev" }
  | { kind: "idle"; lastCheckedAt: number | null }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | {
      kind: "downloading";
      version: string;
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | { kind: "ready-to-install"; version: string }
  | { kind: "error"; message: string };

const electronAPI = {
  settings: {
    getToken: (): Promise<string> => ipcRenderer.invoke(IPC.settingsGetToken),
    regenerateToken: (): Promise<string> =>
      ipcRenderer.invoke(IPC.settingsRegenerateToken),
  },
  mcp: {
    list: (): Promise<{ servers: Array<{ name: string; url: string; status: string }>; error?: string }> =>
      ipcRenderer.invoke(IPC.mcpList),
    login: (name: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.mcpLogin, { name }),
    logout: (name: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.mcpLogout, { name }),
  },
  mcpWorkspace: {
    /** Server statuses for a workspace's .mcp.json (in-app client, own OAuth). */
    status: (
      cwd: string,
    ): Promise<
      Array<{
        name: string;
        url: string;
        status: "connected" | "needs-auth" | "error" | "unsupported";
        toolCount?: number;
        error?: string;
      }>
    > => ipcRenderer.invoke(IPC.mcpWsStatus, cwd),
    authenticate: (name: string, url: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.mcpWsAuthenticate, name, url),
    logout: (url: string): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.mcpWsLogout, url),
    removeServer: (cwd: string, name: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.mcpWsRemoveServer, cwd, name),
  },
  mcpGlobal: {
    list: (): Promise<Array<{ name: string; url?: string; command?: string; type?: string }>> =>
      ipcRenderer.invoke(IPC.mcpGlobalList),
    add: (name: string, cfg: { url?: string; command?: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.mcpGlobalAdd, name, cfg),
    remove: (name: string): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.mcpGlobalRemove, name),
  },
  credentials: {
    /** provider id → true when an API key is stored. Key material never reaches the renderer. */
    status: (): Promise<Record<string, boolean>> => ipcRenderer.invoke(IPC.credentialsStatus),
    set: (provider: string, apiKey: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.credentialsSet, provider, apiKey),
    delete: (provider: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.credentialsDelete, provider),
  },
  models: {
    /** Live model discovery for a provider (cached; static fallback when offline/keyless). */
    list: (
      provider: string,
    ): Promise<{
      models: Array<{ id: string; label: string }>;
      source: "live" | "static";
      error?: string;
    }> => ipcRenderer.invoke(IPC.modelsList, provider),
  },
  chat: {
    start: (opts: {
      sessionId: string;
      cwd: string;
      initialText: string;
      agent?: string;
      model?: string;
      providerSessionId?: string;
      resume?: boolean;
      autoApproveWrites?: boolean;
      baseUrl?: string;
    }): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.chatStart, opts),
    send: (sessionId: string, text: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.chatSend, { sessionId, text }),
    setModel: (sessionId: string, model?: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.chatSetModel, { sessionId, model }),
    respondPermission: (sessionId: string, requestId: string, allow: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.chatRespondPermission, { sessionId, requestId, allow }),
    stop: (sessionId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.chatStop, { sessionId }),
    onEvent: (cb: (event: unknown) => void): (() => void) => subscribe(IPC.chatEvent, cb),
  },
  voice: {
    /** Whether the bundled whisper model is installed on this platform. */
    available: (): Promise<boolean> => ipcRenderer.invoke(IPC.voiceAvailable),
    /** Load the model ahead of the first command so push-to-talk feels instant. */
    prewarm: (): Promise<boolean> => ipcRenderer.invoke(IPC.voicePrewarm),
    /** Transcribe a 16 kHz mono 16-bit WAV buffer offline via whisper.cpp.
     *  `prompt` biases the decoder toward expected words (e.g. project names). */
    transcribe: (
      wav: ArrayBuffer,
      prompt?: string,
    ): Promise<
      { ok: true; text: string } | { ok: false; error: string; code?: "unavailable" }
    > => ipcRenderer.invoke(IPC.voiceTranscribe, wav, prompt),
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  browseFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogBrowseFolder),
  saveWorkflowFile: (
    defaultName: string,
    content: string,
  ): Promise<{ ok: true; path: string } | { ok: false; error?: string }> =>
    ipcRenderer.invoke(IPC.dialogSaveWorkflow, defaultName, content),
  importWorkflowFile: (): Promise<{ name: string; content: string } | null> =>
    ipcRenderer.invoke(IPC.dialogImportWorkflow),
  pickTemplateFile: (): Promise<{ name: string; content: string } | null> =>
    ipcRenderer.invoke(IPC.dialogPickTemplate),
  attachments: {
    pick: (): Promise<Array<{ path: string; name: string; dataUrl?: string }>> =>
      ipcRenderer.invoke(IPC.dialogPickAttachments),
    stage: (cwd: string, paths: string[]): Promise<Array<{ rel: string; name: string }>> =>
      ipcRenderer.invoke(IPC.attachmentsStage, cwd, paths),
  },
  saveTextFile: (
    defaultName: string,
    content: string,
    filters: { name: string; extensions: string[] }[],
  ): Promise<{ ok: true; path: string } | { ok: false; error?: string }> =>
    ipcRenderer.invoke(IPC.dialogSaveTextFile, defaultName, content, filters),
  exportPdf: (
    defaultName: string,
    html: string,
  ): Promise<{ ok: true; path: string } | { ok: false; error?: string }> =>
    ipcRenderer.invoke(IPC.dialogExportPdf, defaultName, html),
  openPath: (path: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.shellOpenPath, path),
  openFile: (path: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.shellOpenFile, path),
  openExternal: (url: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.shellOpenExternal, url),
  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke(IPC.clipboardReadText),
    writeText: (text: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.clipboardWriteText, text),
  },
  terminalImages: {
    saveDropped: (input: {
      name?: string;
      mimeType: string;
      data: ArrayBuffer;
    }): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke(IPC.terminalSaveDroppedImage, input),
    saveClipboard: (): Promise<{ path: string } | { error: string } | null> =>
      ipcRenderer.invoke(IPC.terminalSaveClipboardImage),
  },
  pickImage: (): Promise<
    { sourcePath: string; extension: string } | { error: string } | null
  > => ipcRenderer.invoke(IPC.dialogPickImage),
  saveProjectImage: (opts: {
    projectId: string;
    sourcePath: string;
    extension: string;
  }): Promise<{ filename: string } | { error: string }> =>
    ipcRenderer.invoke(IPC.fileSaveProjectImage, opts),
  getRuntimePort: (): Promise<number | null> => ipcRenderer.invoke(IPC.appGetRuntimePort),
  getUserDataDir: (): Promise<string> => ipcRenderer.invoke(IPC.appGetUserDataDir),
  getUserName: (): Promise<{ source: "git" | "os"; fullName: string; firstName: string }> =>
    ipcRenderer.invoke(IPC.appGetUserName),
  reload: (): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.appReload),
  notifications: {
    getPermission: (): Promise<"granted" | "unsupported"> =>
      ipcRenderer.invoke(IPC.notificationsGetPermission),
    showSessionFinished: (payload: {
      tag: string;
      title: string;
      body: string;
      projectId: string;
      taskId: string;
      worktreeId: string | null;
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.notificationsShowSessionFinished, payload),
    onSessionFinishedClick: (
      cb: (payload: {
        projectId: string;
        taskId: string;
        worktreeId: string | null;
      }) => void,
    ) => subscribe(IPC.notificationsSessionFinishedClick, cb),
  },
  cliCheck: (command: string, opts?: { verifyVersion?: boolean }): Promise<
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
      }
  > =>
    ipcRenderer.invoke(IPC.cliCheck, command, opts),
  pty: {
    spawn: (opts: {
      taskId: string;
      cwd: string;
      command: string;
      args?: string[];
      cols?: number;
      rows?: number;
      agent?: string;
      dangerouslySkipPermissions?: boolean;
      mcEnv?: { apiUrl?: string; token?: string };
      concourseTheme?: "dark" | "light";
      // Required when `agent` is omitted: signals an intentional user-shell
      // terminal that runs `command` through the login shell. Agent terminals
      // (claude-code/codex/cursor-cli/opencode) must leave this unset and pass `command`
      // starting with the agent's binary name, which spawns directly via argv.
      shell?: boolean;
    }) => ipcRenderer.invoke(IPC.ptySpawn, opts) as Promise<{ ptyId: string }>,
    write: (ptyId: string, data: string) => ipcRenderer.invoke(IPC.ptyWrite, { ptyId, data }),
    resize: (ptyId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.ptyResize, { ptyId, cols, rows }),
    kill: (ptyId: string) => ipcRenderer.invoke(IPC.ptyKill, { ptyId }),
    killLaunchProcesses: (opts: { cwd: string; commands: string[]; ports?: number[] }) =>
      ipcRenderer.invoke(IPC.ptyKillLaunchProcesses, opts),
    killUnderPath: (cwd: string) =>
      ipcRenderer.invoke(IPC.ptyKillUnderPath, { cwd }) as Promise<{ ptyCount: number }>,
    onData: (cb: (msg: { ptyId: string; data: string; seq: number }) => void) =>
      subscribe(IPC.ptyData, cb),
    onExit: (cb: (msg: { ptyId: string; exitCode: number; signal?: number }) => void) =>
      subscribe(IPC.ptyExit, cb),
    replay: (ptyId: string): Promise<{ data: string; nextSeq: number }> =>
      ipcRenderer.invoke(IPC.ptyReplay, { ptyId }) as Promise<{ data: string; nextSeq: number }>,
  },
  onSwipe: (cb: (direction: "left" | "right" | "up" | "down") => void) =>
    subscribe(IPC.appSwipe, cb),
  isFullScreen: (): Promise<boolean> => ipcRenderer.invoke(IPC.appIsFullScreen),
  onFullScreenChange: (cb: (isFullScreen: boolean) => void) =>
    subscribe(IPC.appFullScreenChange, cb),
  onCloseIntent: (cb: () => void) => subscribe(IPC.appCloseIntent, cb),
  updater: {
    getState: (): Promise<UpdateStateBridge> =>
      ipcRenderer.invoke(IPC.updateGetState) as Promise<UpdateStateBridge>,
    check: (): Promise<void> => ipcRenderer.invoke(IPC.updateCheck) as Promise<void>,
    download: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.updateDownload),
    installNow: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.updateInstall),
    onStateChange: (cb: (state: UpdateStateBridge) => void) =>
      subscribe(IPC.updateStateChange, cb),
  },
  files: {
    list: (projectRoot: string): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.filesList, projectRoot),
    read: (
      projectRoot: string,
      relPath: string,
    ): Promise<
      | { ok: true; kind: "text"; content: string; mtimeMs: number; lineCount: number }
      | {
          ok: true;
          kind: "image";
          dataUrl: string;
          mimeType:
            | "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp"
            | "image/bmp"
            | "image/x-icon"
            | "image/avif";
          size: number;
          mtimeMs: number;
        }
      | { ok: false; error: "invalid-path" | "not-found" | "binary" | "too-large" | string; lineCount?: number }
    > => ipcRenderer.invoke(IPC.filesRead, projectRoot, relPath),
    write: (
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null,
    ): Promise<
      | { ok: true; mtimeMs: number }
      | {
          ok: false;
          error:
            | "invalid-path"
            | "invalid-content"
            | "stale"
            | "protected-path"
            | string;
          currentMtimeMs?: number;
        }
    > => ipcRenderer.invoke(IPC.filesWrite, projectRoot, relPath, content, expectedMtimeMs),
    writeSensitive: (
      projectRoot: string,
      relPath: string,
      content: string,
      expectedMtimeMs: number | null,
    ): Promise<
      | { ok: true; mtimeMs: number }
      | {
          ok: false;
          error:
            | "invalid-path"
            | "invalid-content"
            | "stale"
            | "user-declined"
            | string;
          currentMtimeMs?: number;
        }
    > => ipcRenderer.invoke(IPC.filesWriteSensitive, projectRoot, relPath, content, expectedMtimeMs),
    watch: (
      projectRoot: string,
      relPath: string,
    ): Promise<{ ok: true; watchId: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.filesWatch, projectRoot, relPath),
    unwatch: (watchId: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.filesUnwatch, watchId),
    onChanged: (cb: (msg: { watchId: string; mtimeMs: number }) => void) =>
      subscribe(IPC.filesChanged, cb),
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
