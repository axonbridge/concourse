import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  net,
  session,
  clipboard,
  nativeImage,
  type NativeImage,
} from "electron";
import log from "electron-log/main";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
import * as http from "node:http";
import * as nodeNet from "node:net";
import * as os from "node:os";
import { spawn, ChildProcess, spawnSync } from "node:child_process";
import { registerPtyHandlers, killAllPtys } from "./pty-manager";
import { registerChatHandlers } from "./chat/ipc";
import { credentialStatus, setCredential, deleteCredential } from "./credentials/store";
import { listModels, invalidateModelCache } from "./models/catalog";
import { workspaceServerStatus, authenticateServer, logoutServer } from "./mcp/client";
import { readGlobalMcpConfig, writeGlobalMcpConfig } from "./mcp/global-config";
import { bundleToFiles, filesToBundle } from "../src/domain/workspace/okf-bundle";
import { isEngineId } from "../src/shared/ai-providers";
import { registerMcpHandlers } from "./mcp-manager";
import {
  isWhisperAvailable,
  prewarmWhisper,
  shutdownWhisper,
  transcribeWav,
  WhisperUnavailableError,
} from "./whisper-server";
import { registerFileHandlers, disposeAllFileWatchers } from "./file-handlers";
import { IPC } from "./ipc-channels";
import { resolveAgentCommandOnPath } from "./agent-cli-resolution";
import { augmentProcessEnv, sanitizedProcessEnv } from "./shell-env";
import { registerUpdateManager } from "./update-manager";
import {
  disposeApiTokenStore,
  getOrCreateApiToken,
  regenerateApiToken,
} from "./api-token-store";
import { configureIpcAllowedOrigins, safeHandle } from "./ipc-safe-handle";
import { configureProjectRootsDb, disposeProjectRootsDb, loadProjectRoots } from "./project-roots";
import { resolveSafeOpenPath } from "./open-path-policy";
import { buildLocalConcourseApiUrl } from "./pty-hook-env";
import { checkAgentCliVersion } from "./agent-cli-version";
import { AGENT_CLI_CONFIG_BY_COMMAND } from "./agent-cli-version-requirements";
import { disposeAppSettingsStore } from "./app-settings-store";
import { getBinding, matchElectronInput } from "./keybindings-reader";
import { resolveProductionServerEntry } from "./production-server-entry";
import {
  MICROPHONE_WEB_PERMISSION,
  shouldAllowAudioCapture,
  shouldAllowWebPermission,
} from "./notification-permissions";
import {
  getNativeOsNotificationPermission,
  showSessionFinishOsNotification,
  type SessionFinishOsNotificationPayload,
} from "./session-finish-notification";
import {
  DEFAULT_DEV_SERVER_PORT,
  nextTcpPort,
  productionRuntimePortStart,
} from "./runtime-port";

const APP_NAME = "Concourse";

function defaultUserDataDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library/Application Support", APP_NAME);
  }
  if (process.platform === "win32") {
    return path.join(home, "AppData/Roaming", APP_NAME);
  }
  return path.join(home, ".config", APP_NAME);
}

function configureUserDataDir(): string {
  // Keep Electron-side IPC stores aligned with src/db/client.ts. In dev the
  // generated dist-electron/package.json only declares CommonJS, so Electron's
  // package-name-derived default can become "Electron" or "concourse",
  // splitting API tokens and project roots across separate SQLite files.
  const dir = (process.env.CONCOURSE_USER_DATA_DIR || defaultUserDataDir()).trim();
  fs.mkdirSync(dir, { recursive: true });
  // Display name (menu bar) is "Concourse"; APP_NAME stays "Concourse" for
  // the user-data dir so existing data isn't orphaned. setPath below pins the dir
  // explicitly regardless of the display name.
  app.setName("Concourse");
  app.setPath("userData", dir);
  process.env.CONCOURSE_USER_DATA_DIR = dir;
  return dir;
}

const concourseUserDataDir = configureUserDataDir();

// Persists to ~/Library/Logs/<AppName>/main.log on macOS, %USERPROFILE%/AppData/Roaming/<AppName>/logs/main.log on Windows,
// and ~/.config/<AppName>/logs/main.log on Linux. This is the file users grep when
// the auto-updater goes silent — `console.*` from a packaged Electron app is invisible.
// Log lines may contain the user's local OS username inside artifact paths (e.g. /Users/<name>/Library/...).
// That's already on the user's own machine, so not a privacy risk unless they share the bundle externally.
log.initialize();
log.transports.file.level = "info";
log.transports.console.level = "debug";

function ignoreBrokenPipe(stream: NodeJS.WriteStream | undefined): void {
  stream?.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") return;
    throw err;
  });
}
ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

const isDev = process.env.NODE_ENV === "development";
const devServerHost = process.env.CONCOURSE_DEV_HOST ?? "127.0.0.1";
const devServerPort = Number(process.env.CONCOURSE_DEV_PORT ?? DEFAULT_DEV_SERVER_PORT);
const devUrl = process.env.CONCOURSE_DEV_URL ?? `http://${devServerHost}:${devServerPort}`;

// HTTP readiness polling: wait up to DEV_SERVER_READY_TIMEOUT_MS for the
// server to respond, polling every HTTP_POLL_INTERVAL_MS while waiting.
const DEV_SERVER_READY_TIMEOUT_MS = 30_000;
const HTTP_POLL_INTERVAL_MS = 200;
const GIT_CONFIG_PROBE_TIMEOUT_MS = 2_000;

// Window sizing for the main BrowserWindow.
const MAIN_WINDOW_DEFAULT_WIDTH = 1440;
const MAIN_WINDOW_DEFAULT_HEIGHT = 900;
const MAIN_WINDOW_MIN_WIDTH = 1024;
const MAIN_WINDOW_MIN_HEIGHT = 640;
const TRAFFIC_LIGHT_POSITION_DARWIN = { x: 48, y: 16 } as const;

augmentProcessEnv();

let win: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let runtimePort: number | null = null;

function pickPort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryCandidate = (candidate: number | null) => {
      if (candidate === null) {
        reject(new Error(`Could not allocate port starting at ${startPort}`));
        return;
      }
      const srv = nodeNet.createServer();
      srv.unref();
      srv.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" || err.code === "EACCES") {
          tryCandidate(nextTcpPort(candidate));
          return;
        }
        reject(err);
      });
      srv.listen(candidate, devServerHost, () => {
        const addr = srv.address();
        if (addr && typeof addr === "object") {
          const port = addr.port;
          srv.close(() => resolve(port));
        } else {
          srv.close(() => tryCandidate(nextTcpPort(candidate)));
        }
      });
    };
    tryCandidate(startPort);
  });
}

function readPreviousRuntimePort(portFile: string): number | null {
  try {
    const raw = fs.readFileSync(portFile, "utf8").trim();
    const port = Number(raw);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

function waitForHttp(url: string, timeoutMs = DEV_SERVER_READY_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`));
        setTimeout(tick, HTTP_POLL_INTERVAL_MS);
      });
      req.on("error", () => {
        if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`));
        setTimeout(tick, HTTP_POLL_INTERVAL_MS);
      });
    };
    tick();
  });
}

async function openExternalHttpUrl(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!url) return { ok: false, error: "empty" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "invalid-url" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "unsupported-url-scheme" };
  }
  await shell.openExternal(parsed.toString());
  return { ok: true };
}

function configurePermissionHandlers(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === MICROPHONE_WEB_PERMISSION) {
      const mediaTypes = (details as { mediaTypes?: string[] } | undefined)?.mediaTypes;
      callback(shouldAllowAudioCapture(mediaTypes));
      return;
    }
    callback(shouldAllowWebPermission(permission));
  });
  ses.setPermissionCheckHandler((_webContents, permission, _origin, details) => {
    if (permission === MICROPHONE_WEB_PERMISSION) {
      const mediaType = (details as { mediaType?: string } | undefined)?.mediaType;
      return mediaType === "audio";
    }
    return shouldAllowWebPermission(permission);
  });
}

async function startProductionServer(): Promise<string> {
  const portFile = path.join(concourseUserDataDir, ".port");
  // Dev mode writes the fixed Vite port to the shared .port file for hook
  // wiring. A packaged app must not reuse that port or it blocks `pnpm dev`.
  const startPort = productionRuntimePortStart(readPreviousRuntimePort(portFile), {
    devServerPort,
  });
  const port = await pickPort(startPort);
  const origin = `http://${devServerHost}:${port}`;
  runtimePort = port;
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(port), "utf8");

  const { entry, checkedPaths } = resolveProductionServerEntry({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    mainDirname: __dirname,
    exists: fs.existsSync,
  });
  if (!fs.existsSync(entry)) {
    throw new Error(`Could not find production server entry. Checked: ${checkedPaths.join(", ")}`);
  }

  const runner = path.join(__dirname, "server-runner.mjs");

  serverProcess = spawn(process.execPath, [runner], {
    env: {
      ...process.env,
      SERVER_ENTRY: entry,
      PORT: String(port),
      HOST: devServerHost,
      CONCOURSE_SERVER_ORIGIN: origin,
      CONCOURSE_DEV_URL: origin,
      CONCOURSE_DEV_PORT: String(port),
      ELECTRON_RUN_AS_NODE: "1",
      CONCOURSE_USER_DATA_DIR: concourseUserDataDir,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  serverProcess.on("exit", (code) => {
    console.error(`[server] exited with code ${code}`);
    if (!(app as any).isQuiting) {
      app.quit();
    }
  });

  await waitForHttp(origin);
  return origin;
}

async function bootDevServer(): Promise<string> {
  // Vite dev server is launched by `pnpm dev:server`; just wait for it.
  await waitForHttp(devUrl);
  runtimePort = Number(new URL(devUrl).port);
  const portFile = path.join(concourseUserDataDir, ".port");
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(runtimePort), "utf8");
  return devUrl;
}

async function createWindow() {
  const url = isDev ? await bootDevServer() : await startProductionServer();
  // The renderer is only ever loaded from this URL — pin the IPC allow-list
  // to that origin so a future renderer compromise (XSS in markdown, agent
  // output rendered as HTML, an added webview) can't reach the IPC surface.
  configureIpcAllowedOrigins([url]);

  win = new BrowserWindow({
    width: MAIN_WINDOW_DEFAULT_WIDTH,
    height: MAIN_WINDOW_DEFAULT_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    backgroundColor: "#000000",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? TRAFFIC_LIGHT_POSITION_DARWIN : undefined,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win?.show());

  // Intercept the configured close-session binding before the default app menu's
  // "Close Window" accelerator closes the BrowserWindow. We forward to the
  // renderer so it can close the focused terminal instead; if nothing claims it,
  // the keystroke is just swallowed.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const mod = process.platform === "darwin" ? input.meta : input.control;
    if (mod && !input.alt && input.key.toLowerCase() === "r") {
      event.preventDefault();
      if (input.shift) win?.webContents.reloadIgnoringCache();
      else win?.webContents.reload();
      return;
    }
    const closeBinding = getBinding(app.getPath("userData"), "session.closeWindow");
    if (!matchElectronInput(input, closeBinding)) return;
    event.preventDefault();
    win?.webContents.send(IPC.appCloseIntent);
  });

  // macOS-only: 3-finger swipe (System Settings → Trackpad → More Gestures).
  win.on("swipe", (_e, direction) => {
    win?.webContents.send(IPC.appSwipe, direction);
  });

  win.on("enter-full-screen", () => win?.webContents.send(IPC.appFullScreenChange, true));
  win.on("leave-full-screen", () => win?.webContents.send(IPC.appFullScreenChange, false));
  safeHandle(IPC.appIsFullScreen, () => win?.isFullScreen() ?? false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalHttpUrl(url);
    return { action: "deny" };
  });

  // A file dropped outside any drop target would otherwise navigate the
  // window to its file:// URL, blowing away the app shell.
  win.webContents.on("will-navigate", (event, navUrl) => {
    if (navUrl !== url) event.preventDefault();
  });

  await win.loadURL(url);

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const ALLOWED_IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TERMINAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const TERMINAL_IMAGE_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const TERMINAL_IMAGE_MAX_FILES = 100;
const TERMINAL_IMAGE_MAX_DIMENSION_PX = 10_000;
const TERMINAL_IMAGE_MAX_PIXELS = 25_000_000;
const TERMINAL_IMAGE_MIME_EXT = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"],
]);
const DIRECTORY_GRANTS_FILE = "directory-grants.json";
const DIRECTORY_GRANT_TTL_MS = 15 * 60_000;

function projectImagesDir(): string {
  return path.join(concourseUserDataDir, "project-images");
}

function terminalImagesDir(): string {
  return path.join(concourseUserDataDir, "terminal-images");
}

function terminalImageExtension(mimeType: string, name: string): string | null {
  const fromMime = TERMINAL_IMAGE_MIME_EXT.get(mimeType.toLowerCase());
  if (fromMime) return fromMime;
  const ext = path.extname(name).slice(1).toLowerCase();
  return [...TERMINAL_IMAGE_MIME_EXT.values()].includes(ext) ? ext : null;
}

const TERMINAL_IMAGE_NAME_MAX_LEN = 80;

function sanitizedTerminalImageName(name: string): string {
  const parsed = path.parse(path.basename(name || "image"));
  return (
    parsed.name
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, TERMINAL_IMAGE_NAME_MAX_LEN) || "image"
  );
}

function pruneTerminalImagesDir(dir: string): void {
  try {
    const entries = fs
      .readdirSync(dir)
      .map((name) => {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        return stat.isFile() ? { file, size: stat.size, mtimeMs: stat.mtimeMs } : null;
      })
      .filter((entry): entry is { file: string; size: number; mtimeMs: number } => Boolean(entry))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    let totalBytes = 0;
    entries.forEach((entry, index) => {
      totalBytes += entry.size;
      if (index < TERMINAL_IMAGE_MAX_FILES && totalBytes <= TERMINAL_IMAGE_MAX_TOTAL_BYTES) return;
      try {
        fs.unlinkSync(entry.file);
      } catch {}
    });
  } catch (err) {
    log.warn("terminal-images.prune-failed", { error: String(err) });
  }
}

function terminalImageSizeError(image: NativeImage): string | null {
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) return "invalid image data";
  if (width > TERMINAL_IMAGE_MAX_DIMENSION_PX || height > TERMINAL_IMAGE_MAX_DIMENSION_PX) {
    return `image dimensions exceed ${TERMINAL_IMAGE_MAX_DIMENSION_PX}px`;
  }
  if (width * height > TERMINAL_IMAGE_MAX_PIXELS) {
    return `image exceeds ${TERMINAL_IMAGE_MAX_PIXELS.toLocaleString("en-US")} pixels`;
  }
  return null;
}

function saveTerminalImageBuffer(
  data: Buffer,
  ext: string,
  name = "image",
): { path: string } | { error: string } {
  if (data.byteLength === 0) return { error: "image is empty" };
  if (data.byteLength > TERMINAL_IMAGE_MAX_BYTES) {
    return { error: `image exceeds ${TERMINAL_IMAGE_MAX_BYTES / 1024 / 1024}MB` };
  }
  const dir = terminalImagesDir();
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}-${sanitizedTerminalImageName(name)}.${ext}`;
  const target = path.join(dir, filename);
  fs.writeFileSync(target, data, { mode: 0o600 });
  pruneTerminalImagesDir(dir);
  return { path: target };
}

function saveTerminalNativeImage(
  image: NativeImage,
  name: string,
): { path: string } | { error: string } {
  const sizeError = terminalImageSizeError(image);
  if (sizeError) return { error: sizeError };
  return saveTerminalImageBuffer(image.toPNG(), "png", name);
}

function registerProjectImageProtocol() {
  protocol.handle("app", async (req) => {
    try {
      const url = new URL(req.url);
      if (url.host !== "project-image") return new Response("not found", { status: 404 });
      const filename = path.basename(decodeURIComponent(url.pathname));
      if (!filename || filename.includes("\0")) return new Response("not found", { status: 404 });
      const ext = path.extname(filename).slice(1).toLowerCase();
      if (!ALLOWED_IMAGE_EXT.has(ext)) return new Response("not found", { status: 404 });
      const dirReal = path.resolve(projectImagesDir());
      const abs = path.resolve(dirReal, filename);
      if (abs !== dirReal && !abs.startsWith(dirReal + path.sep)) {
        return new Response("not found", { status: 404 });
      }
      if (!fs.existsSync(abs)) return new Response("not found", { status: 404 });
      return await net.fetch(pathToFileURL(abs).toString());
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  });
}

// Tracks paths returned from `dialog:pickImage`. `file:saveProjectImage` will only
// accept a sourcePath that's been issued by us — prevents a compromised renderer
// from copying arbitrary FS paths (e.g. /etc/passwd) into project-images/.
const ALLOWED_PICKED_PATHS = new Set<string>();

function recordPickedDirectoryGrant(dir: string): void {
  const realDir = fs.realpathSync(dir);
  const target = path.join(concourseUserDataDir, DIRECTORY_GRANTS_FILE);
  let grants: Array<{ path: string; createdAt: number }> = [];
  try {
    const now = Date.now();
    const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as {
      grants?: Array<{ path?: unknown; createdAt?: unknown }>;
    };
    if (Array.isArray(parsed.grants)) {
      grants = parsed.grants.filter(
        (g): g is { path: string; createdAt: number } =>
          typeof g.path === "string" &&
          typeof g.createdAt === "number" &&
          g.createdAt <= now &&
          now - g.createdAt <= DIRECTORY_GRANT_TTL_MS,
      );
    }
  } catch {
    grants = [];
  }
  grants = grants.filter((g) => path.resolve(g.path) !== path.resolve(realDir));
  grants.push({ path: realDir, createdAt: Date.now() });

  fs.mkdirSync(concourseUserDataDir, { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ grants }, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

safeHandle(IPC.dialogPickImage, async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: [...ALLOWED_IMAGE_EXT] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const sourcePath = result.filePaths[0]!;
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    return { error: `Unsupported file type: .${ext}` };
  }
  ALLOWED_PICKED_PATHS.add(sourcePath);
  return { sourcePath, extension: ext };
});

safeHandle(
  IPC.fileSaveProjectImage,
  async (_evt, opts: { projectId: string; sourcePath: string; extension: string }) => {
    const { projectId, sourcePath } = opts;
    const ext = opts.extension.toLowerCase();
    if (!projectId || !/^[A-Za-z0-9_-]+$/.test(projectId)) {
      return { error: "invalid projectId" };
    }
    if (!ALLOWED_PICKED_PATHS.has(sourcePath)) {
      return { error: "source not issued by image picker" };
    }
    if (!ALLOWED_IMAGE_EXT.has(ext)) return { error: `unsupported extension: ${ext}` };
    if (!fs.existsSync(sourcePath)) return { error: "source file not found" };
    const stat = fs.statSync(sourcePath);
    if (stat.size > MAX_IMAGE_BYTES) return { error: `image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024}MB` };

    const dir = projectImagesDir();
    fs.mkdirSync(dir, { recursive: true });
    // Sweep any prior file with a different extension for this project.
    for (const name of fs.readdirSync(dir)) {
      if (name.split(".")[0] === projectId) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {}
      }
    }
    const filename = `${projectId}.${ext}`;
    fs.copyFileSync(sourcePath, path.join(dir, filename));
    ALLOWED_PICKED_PATHS.delete(sourcePath);
    return { filename };
  }
);

safeHandle(IPC.dialogBrowseFolder, async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const selected = result.filePaths[0]!;
  try {
    recordPickedDirectoryGrant(selected);
  } catch (err) {
    log.warn("directory-grant.record-failed", { path: selected, error: String(err) });
  }
  return selected;
});

// Save a shared-workflow bundle to a user-chosen location.
// Export a workflow as an OKF bundle FOLDER (index.md + command/agents/skills/
// template mirroring the workspace layout). `content` stays CommandBundle JSON
// on the wire; the folder is the on-disk format (plan §M5c).
safeHandle(IPC.dialogSaveWorkflow, async (_evt, defaultName: string, content: string) => {
  if (!win) return { ok: false as const };
  const result = await dialog.showSaveDialog(win, {
    defaultPath: defaultName.replace(/\.concourse-workflow\.json$/i, "-workflow"),
    buttonLabel: "Export bundle",
    nameFieldLabel: "Bundle folder",
  });
  if (result.canceled || !result.filePath) return { ok: false as const };
  try {
    const bundle = JSON.parse(content) as import("../src/domain/workspace/okf-bundle").CommandBundle;
    const files = bundleToFiles(bundle);
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(result.filePath, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body, "utf8");
    }
    return { ok: true as const, path: result.filePath };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
});

// Save arbitrary text content to a user-chosen location with custom filters
// (e.g. exporting a rendered markdown report as a Word-compatible .doc).
safeHandle(
  IPC.dialogSaveTextFile,
  async (
    _evt,
    defaultName: string,
    content: string,
    filters: { name: string; extensions: string[] }[],
  ) => {
    if (!win) return { ok: false as const };
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: filters?.length ? filters : [{ name: "Text", extensions: ["txt"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false as const };
    try {
      fs.writeFileSync(result.filePath, content, "utf8");
      return { ok: true as const, path: result.filePath };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

// Render HTML (our own generated report markup — no scripts) in a hidden window
// and save it as a PDF via Chromium's built-in printToPDF. No converter deps.
safeHandle(IPC.dialogExportPdf, async (_evt, defaultName: string, html: string) => {
  if (!win) return { ok: false as const };
  const result = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false as const };
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { top: 0.6, bottom: 0.6, left: 0.55, right: 0.55 },
    });
    fs.writeFileSync(result.filePath, pdf);
    return { ok: true as const, path: result.filePath };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  } finally {
    printWin.destroy();
  }
});

// Pick a shared-workflow bundle to import; returns its raw JSON text.
// Import a workflow: an OKF bundle folder, its index.md, or a legacy
// .concourse-workflow.json. Always RETURNS CommandBundle JSON so the renderer
// path is format-agnostic (plan §M5d).
safeHandle(IPC.dialogImportWorkflow, async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    // macOS supports picking either a file or a folder from one dialog.
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Workflow bundle", extensions: ["md", "json"] }],
    message: "Pick a workflow bundle folder (or its index.md, or a legacy .json export).",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  let p = result.filePaths[0]!;
  try {
    const stat = fs.statSync(p);
    if (!stat.isDirectory() && /\.json$/i.test(p)) {
      // Legacy single-file export — already CommandBundle JSON.
      return { name: path.basename(p), content: fs.readFileSync(p, "utf8") };
    }
    if (!stat.isDirectory()) p = path.dirname(p); // picked index.md → its folder
    const files: Record<string, string> = {};
    const collect = (dir: string, prefix: string, depth: number) => {
      if (depth > 3) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const abs = path.join(dir, e.name);
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) collect(abs, rel, depth + 1);
        else if (e.name.endsWith(".md")) files[rel] = fs.readFileSync(abs, "utf8");
      }
    };
    collect(p, "", 0);
    const bundle = filesToBundle(files);
    return { name: path.basename(p), content: JSON.stringify(bundle) };
  } catch (e) {
    log.warn("[workflow-import] could not read bundle", e);
    return null;
  }
});

// Chat attachments: multi-file picker returning names + image previews…
safeHandle(IPC.dialogPickAttachments, async () => {
  if (!win) return [];
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    message: "Attach files to this message",
  });
  if (result.canceled) return [];
  return result.filePaths.map((p) => {
    const name = path.basename(p);
    let dataUrl: string | undefined;
    const ext = path.extname(p).toLowerCase();
    const mime: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp",
    };
    try {
      if (mime[ext] && fs.statSync(p).size <= 3_000_000) {
        dataUrl = `data:${mime[ext]};base64,${fs.readFileSync(p).toString("base64")}`;
      }
    } catch { /* preview is best-effort */ }
    return { path: p, name, dataUrl };
  });
});

// …then staged into <workspace>/.concourse/attachments/ so EVERY engine
// (Claude, direct, OpenCode) can read them from inside its workspace jail.
safeHandle(IPC.attachmentsStage, (_evt, cwd: string, paths: string[]) => {
  if (typeof cwd !== "string" || !Array.isArray(paths)) return [];
  const dir = path.join(cwd, ".concourse", "attachments");
  fs.mkdirSync(dir, { recursive: true });
  const out: Array<{ rel: string; name: string }> = [];
  for (const src of paths) {
    try {
      const name = path.basename(String(src));
      let dest = path.join(dir, name);
      for (let i = 2; fs.existsSync(dest); i++) {
        dest = path.join(dir, `${path.parse(name).name}-${i}${path.parse(name).ext}`);
      }
      fs.copyFileSync(String(src), dest);
      out.push({ rel: path.relative(cwd, dest).split(path.sep).join("/"), name });
    } catch (e) {
      log.warn("[attachments] stage failed", e);
    }
  }
  return out;
});

// Pick a template file (markdown/text) to attach to a workflow; returns its text.
safeHandle(IPC.dialogPickTemplate, async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [
      { name: "Template", extensions: ["md", "markdown", "txt", "text"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const p = result.filePaths[0]!;
  try {
    return { name: path.basename(p), content: fs.readFileSync(p, "utf8") };
  } catch {
    return null;
  }
});

safeHandle(IPC.shellOpenPath, async (_evt, p: string) => {
  const decision = resolveSafeOpenPath(p, loadProjectRoots());
  if (!decision.ok) return decision;
  shell.showItemInFolder(decision.path);
  return { ok: true };
});

// Open a file in its default app (e.g. an .xlsx a workflow produced). Same
// project-root guard as reveal-in-folder so only files inside a registered
// project can be opened.
safeHandle(IPC.shellOpenFile, async (_evt, p: string) => {
  const decision = resolveSafeOpenPath(p, loadProjectRoots(), { allowFiles: true });
  if (!decision.ok) return decision;
  const error = await shell.openPath(decision.path);
  return error ? { ok: false as const, error } : { ok: true as const };
});

safeHandle(IPC.shellOpenExternal, async (_evt, url: string) => {
  return openExternalHttpUrl(url);
});

// Terminal copy/paste is wired through the main process rather than the web
// Clipboard API: navigator.clipboard.readText() is blocked here because
// configurePermissionHandlers() denies the "clipboard-read" permission, and in
// a terminal Ctrl+C/Ctrl+V are control codes (SIGINT / quoted-insert) that
// xterm consumes — so the renderer drives copy/paste off Ctrl+Shift+C/V (and
// Cmd+C/V on macOS) and reaches the native clipboard through these handlers.
const MAX_CLIPBOARD_WRITE_CHARS = 5_000_000;
safeHandle(IPC.clipboardReadText, () => clipboard.readText());
safeHandle(IPC.clipboardWriteText, (_evt, text: string) => {
  const value = typeof text === "string" ? text.slice(0, MAX_CLIPBOARD_WRITE_CHARS) : "";
  clipboard.writeText(value);
  return { ok: true as const };
});
safeHandle(
  IPC.terminalSaveDroppedImage,
  (_evt, input: { name?: unknown; mimeType?: unknown; data?: unknown }) => {
    const name = typeof input?.name === "string" ? input.name : "dropped-image";
    const mimeType = typeof input?.mimeType === "string" ? input.mimeType.split(";")[0]!.trim() : "";
    const ext = terminalImageExtension(mimeType, name);
    if (!ext) return { error: "unsupported image type" };
    const raw = input?.data;
    const data =
      raw instanceof ArrayBuffer
        ? Buffer.from(raw)
        : ArrayBuffer.isView(raw)
          ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
          : null;
    if (!data) return { error: "invalid image data" };
    if (data.byteLength > TERMINAL_IMAGE_MAX_BYTES) {
      return { error: `image exceeds ${TERMINAL_IMAGE_MAX_BYTES / 1024 / 1024}MB` };
    }
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) return { error: "invalid image data" };
    return saveTerminalNativeImage(image, name);
  },
);
safeHandle(IPC.terminalSaveClipboardImage, () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  return saveTerminalNativeImage(image, "clipboard-image");
});

safeHandle(IPC.voiceAvailable, () => isWhisperAvailable());
safeHandle(IPC.voicePrewarm, () => {
  void prewarmWhisper();
  return true;
});
safeHandle(IPC.voiceTranscribe, async (_event, wav: ArrayBuffer, prompt?: string) => {
  try {
    const text = await transcribeWav(Buffer.from(wav), prompt);
    return { ok: true as const, text };
  } catch (err) {
    if (err instanceof WhisperUnavailableError) {
      return { ok: false as const, error: err.message, code: "unavailable" as const };
    }
    log.error("voice.transcribe-failed", err);
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
});

safeHandle(IPC.appGetRuntimePort, () => runtimePort);
safeHandle(IPC.appGetUserDataDir, () => concourseUserDataDir);

safeHandle(IPC.appGetUserName, () => {
  try {
    const result = spawnSync("git", ["config", "--global", "user.name"], {
      encoding: "utf8",
      timeout: GIT_CONFIG_PROBE_TIMEOUT_MS,
    });
    const gitName = (result.stdout || "").trim();
    if (gitName) return { source: "git" as const, fullName: gitName, firstName: gitName.split(/\s+/)[0] };
  } catch {}
  const username = os.userInfo().username;
  return { source: "os" as const, fullName: username, firstName: username };
});

safeHandle(IPC.appReload, (event) => {
  const target = BrowserWindow.fromWebContents(event.sender) ?? win;
  if (!target || target.isDestroyed()) {
    return { ok: false as const, error: "window-unavailable" };
  }
  target.reload();
  return { ok: true as const };
});

safeHandle(IPC.cliCheck, (_evt, command: string, opts?: { verifyVersion?: boolean }) => {
  if (!command) return { ok: false, reason: "empty" };
  const env = sanitizedProcessEnv();
  const resolved = resolveAgentCommandOnPath(command, env);
  if (resolved) {
    const requirement = AGENT_CLI_CONFIG_BY_COMMAND[command];
    if (requirement && opts?.verifyVersion) {
      const versionCheck = checkAgentCliVersion(resolved, env, requirement, os.platform());
      if (!versionCheck.ok) {
        const { output: _output, ...safeVersionCheck } = versionCheck;
        return { ...safeVersionCheck, path: resolved };
      }
      return { ok: true, path: resolved, version: versionCheck.version };
    }
    return { ok: true, path: resolved };
  }
  return { ok: false, reason: "not-found" };
});

registerPtyHandlers(
  ipcMain,
  () => win,
  () => {
    const apiUrl = buildLocalConcourseApiUrl(runtimePort);
    if (!apiUrl) return null;
    return {
      apiUrl,
      token: getOrCreateApiToken(concourseUserDataDir),
    };
  },
  () => {
    return runtimePort ? [runtimePort] : [];
  }
);
registerFileHandlers(ipcMain, () => win);
registerChatHandlers(ipcMain, () => win);
registerMcpHandlers(ipcMain);

// API bearer token is delivered through IPC only — it must never traverse HTTP
// because the loopback server's same-origin gate doesn't protect against a
// compromised renderer or any other process that can reach the local port.
safeHandle(IPC.settingsGetToken, () => {
  return getOrCreateApiToken(concourseUserDataDir);
});
safeHandle(IPC.settingsRegenerateToken, () => {
  return regenerateApiToken(concourseUserDataDir);
});

// Provider API keys live keychain-encrypted in userData/credentials.json.
// The renderer only ever learns booleans — key material never crosses IPC
// outward; engine adapters read it main-process-side (getCredential).
safeHandle(IPC.credentialsStatus, () => credentialStatus());
safeHandle(IPC.credentialsSet, (_evt, provider: string, apiKey: string) => {
  if (typeof provider !== "string" || typeof apiKey !== "string") {
    return { ok: false as const, error: "invalid-payload" };
  }
  const result = setCredential(provider, apiKey);
  // A new key can unlock live model discovery — drop the stale cached list.
  if (result.ok && isEngineId(provider)) invalidateModelCache(provider);
  return result;
});
safeHandle(IPC.credentialsDelete, (_evt, provider: string) => {
  if (typeof provider !== "string") return { ok: false as const };
  const result = deleteCredential(provider);
  if (isEngineId(provider)) invalidateModelCache(provider);
  return result;
});

// ModelCatalog: live per-provider model discovery with static fallback.
safeHandle(IPC.modelsList, (_evt, provider: unknown) => {
  if (!isEngineId(provider)) return { models: [], source: "static" as const, error: "unknown provider" };
  return listModels(provider);
});

// In-app MCP client: status + our-own-OAuth for a workspace's .mcp.json servers.
safeHandle(IPC.mcpWsStatus, (_evt, cwd: unknown) => {
  if (typeof cwd !== "string" || !cwd) return [];
  return workspaceServerStatus(cwd);
});
safeHandle(IPC.mcpWsAuthenticate, (_evt, name: unknown, url: unknown) => {
  if (typeof name !== "string" || typeof url !== "string") {
    return { ok: false as const, error: "invalid-payload" };
  }
  return authenticateServer(name, url);
});
safeHandle(IPC.mcpGlobalList, () => {
  const servers = readGlobalMcpConfig();
  return Object.entries(servers).map(([name, cfg]) => ({ name, ...cfg }));
});
safeHandle(IPC.mcpGlobalAdd, (_evt, name: unknown, cfg: unknown) => {
  if (typeof name !== "string" || !name.trim() || typeof cfg !== "object" || !cfg) {
    return { ok: false as const, error: "invalid-payload" };
  }
  const c = cfg as { url?: string; command?: string };
  if (!c.url && !c.command) return { ok: false as const, error: "Provide a URL or a command." };
  const servers = readGlobalMcpConfig();
  servers[name.trim()] = c.url ? { type: "http", url: c.url } : { type: "stdio", command: c.command };
  writeGlobalMcpConfig(servers);
  return { ok: true as const };
});
safeHandle(IPC.mcpGlobalRemove, (_evt, name: unknown) => {
  if (typeof name === "string") {
    const servers = readGlobalMcpConfig();
    delete servers[name];
    writeGlobalMcpConfig(servers);
  }
  return { ok: true as const };
});

// Remove a server entry from ONE workspace's .mcp.json (delete flow).
safeHandle(IPC.mcpWsRemoveServer, (_evt, cwd: unknown, name: unknown) => {
  if (typeof cwd !== "string" || typeof name !== "string") return { ok: false as const };
  try {
    const p = path.join(cwd, ".mcp.json");
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as { mcpServers?: Record<string, unknown> };
    if (parsed?.mcpServers && name in parsed.mcpServers) {
      delete parsed.mcpServers[name];
      fs.writeFileSync(p, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    }
    return { ok: true as const };
  } catch {
    return { ok: true as const }; // no file / no entry — nothing to remove
  }
});

safeHandle(IPC.mcpWsLogout, (_evt, url: unknown) => {
  if (typeof url === "string" && url) logoutServer(url);
  return { ok: true as const };
});

function parseSessionFinishOsNotificationPayload(
  payload: SessionFinishOsNotificationPayload,
): SessionFinishOsNotificationPayload | null {
  const tag = typeof payload?.tag === "string" ? payload.tag : "";
  const title = typeof payload?.title === "string" ? payload.title : "";
  const body = typeof payload?.body === "string" ? payload.body : "";
  const projectId = typeof payload?.projectId === "string" ? payload.projectId : "";
  const taskId = typeof payload?.taskId === "string" ? payload.taskId : "";
  const worktreeId =
    typeof payload?.worktreeId === "string"
      ? payload.worktreeId
      : payload?.worktreeId === null
        ? null
        : null;
  if (!tag || !title || !projectId || !taskId) return null;
  return { tag, title, body, projectId, taskId, worktreeId };
}

safeHandle(IPC.notificationsGetPermission, () => getNativeOsNotificationPermission());

safeHandle(IPC.notificationsShowSessionFinished, (_evt, payload: SessionFinishOsNotificationPayload) => {
  const parsed = parseSessionFinishOsNotificationPayload(payload);
  if (!parsed) return { ok: false as const, error: "invalid-payload" };
  return showSessionFinishOsNotification(win, parsed, () => {
    win?.webContents.send(IPC.notificationsSessionFinishedClick, {
      projectId: parsed.projectId,
      taskId: parsed.taskId,
      worktreeId: parsed.worktreeId,
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  (app as any).isQuiting = true;
  killAllPtys();
  shutdownWhisper();
  disposeAllFileWatchers();
  disposeApiTokenStore();
  disposeAppSettingsStore();
  disposeProjectRootsDb();
  if (serverProcess) serverProcess.kill();
});

app.whenReady().then(() => {
  // pty:spawn validates `cwd` against this DB before letting any binary run,
  // so it must be configured before any window can issue an IPC call.
  configureProjectRootsDb(concourseUserDataDir);
  configurePermissionHandlers();
  registerProjectImageProtocol();
  registerUpdateManager(ipcMain, () => win, concourseUserDataDir);
  return createWindow();
}).catch((err) => {
  console.error("[main] startup failed:", err);
  app.quit();
});
