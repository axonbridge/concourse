// File browser / editor access to the host filesystem behind one
// `(projectRoot, relPath)` interface.
import type {
  FileListResult,
  FileReadResult,
  FileWriteResult,
} from "~/shared/electron-contract";

const NOT_ELECTRON = { ok: false as const, error: "Not running in Electron" };

export async function listProjectFiles(projectRoot: string): Promise<FileListResult> {
  const api = window.electronAPI;
  if (!api) return NOT_ELECTRON;
  return api.files.list(projectRoot);
}

export async function readProjectFile(
  projectRoot: string,
  relPath: string,
): Promise<FileReadResult> {
  const api = window.electronAPI;
  if (!api) return NOT_ELECTRON;
  return api.files.read(projectRoot, relPath);
}

export async function writeProjectFile(
  projectRoot: string,
  relPath: string,
  content: string,
  expectedMtimeMs: number | null,
): Promise<FileWriteResult> {
  const api = window.electronAPI;
  if (!api) return NOT_ELECTRON;
  return api.files.write(projectRoot, relPath, content, expectedMtimeMs);
}

/** A protected-path write goes through the native confirm dialog. */
export async function writeProjectFileSensitive(
  projectRoot: string,
  relPath: string,
  content: string,
  expectedMtimeMs: number | null,
): Promise<FileWriteResult> {
  const api = window.electronAPI;
  if (!api) return NOT_ELECTRON;
  return api.files.writeSensitive(projectRoot, relPath, content, expectedMtimeMs);
}

export type ProjectFileWatch = {
  watchId: string;
  /** Subscribe to change events for THIS watch (filter by watchId). Returns unsubscribe. */
  onChanged: (cb: (msg: { watchId: string; mtimeMs: number }) => void) => () => void;
  unwatch: () => void;
};

export async function watchProjectFile(
  projectRoot: string,
  relPath: string,
): Promise<{ ok: true; watch: ProjectFileWatch } | { ok: false; error: string }> {
  const api = window.electronAPI;
  if (!api) return NOT_ELECTRON;
  const r = await api.files.watch(projectRoot, relPath);
  if (!r.ok) return r;
  return {
    ok: true,
    watch: {
      watchId: r.watchId,
      onChanged: (cb) => api.files.onChanged(cb),
      unwatch: () => void api.files.unwatch(r.watchId),
    },
  };
}
