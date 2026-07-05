import { useCallback, useSyncExternalStore } from "react";
import { readJson, writeJson } from "./local-storage-json";

// Per-project open flag for the file-browser view, persisted like the
// git-diff view so the browser survives reloads.

export type FileBrowserViewOpenByProject = Record<string, boolean>;

const STORAGE_KEY = "mc.fileBrowserViewOpenByProject";

const listeners = new Set<() => void>();

function normalize(value: unknown): FileBrowserViewOpenByProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: FileBrowserViewOpenByProject = {};
  for (const [projectId, open] of Object.entries(value)) {
    if (typeof projectId !== "string" || !projectId.trim()) continue;
    if (open === true) next[projectId] = true;
  }
  return next;
}

let snapshot: FileBrowserViewOpenByProject = normalize(readJson<unknown>(STORAGE_KEY, {}));

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function setFileBrowserViewOpen(projectId: string, open: boolean): void {
  if (open) {
    if (snapshot[projectId] === true) return;
    snapshot = { ...snapshot, [projectId]: true };
  } else if (snapshot[projectId] === true) {
    const { [projectId]: _removed, ...rest } = snapshot;
    snapshot = rest;
  } else {
    return;
  }
  writeJson(STORAGE_KEY, snapshot);
  emit();
}

export function useFileBrowserViewOpen(projectId: string) {
  const byProject = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const open = byProject[projectId] === true;

  const toggle = useCallback(() => {
    setFileBrowserViewOpen(projectId, !(getSnapshot()[projectId] === true));
  }, [projectId]);

  const close = useCallback(() => {
    setFileBrowserViewOpen(projectId, false);
  }, [projectId]);

  const setOpen = useCallback(
    (next: boolean) => {
      setFileBrowserViewOpen(projectId, next);
    },
    [projectId],
  );

  return { open, toggle, close, setOpen };
}
