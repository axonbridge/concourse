import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import {
  readProjectFile,
  writeProjectFile,
  writeProjectFileSensitive,
  watchProjectFile,
  type ProjectFileWatch,
} from "~/lib/project-fs";
import type { FileReadError, FileReadResult } from "~/shared/electron-contract";

// The file-editing state machine shared by FileEditorDialog (modal) and
// FileBrowserView (inline pane): load a project file, watch it for external
// changes, and save with mtime conflict detection + the sensitive-path retry.

type FileReadSuccess = Extract<FileReadResult, { ok: true }>;

export type LoadedFile =
  | {
      kind: "text";
      content: string;
      mtimeMs: number;
    }
  | {
      kind: "image";
      dataUrl: string;
      mimeType: string;
      size: number;
      mtimeMs: number;
    };

export type LoadError = FileReadError | string;

export function toLoadedFile(result: FileReadSuccess): LoadedFile {
  if (result.kind === "image") {
    return {
      kind: "image",
      dataUrl: result.dataUrl,
      mimeType: result.mimeType,
      size: result.size,
      mtimeMs: result.mtimeMs,
    };
  }
  return {
    kind: "text",
    content: result.content,
    mtimeMs: result.mtimeMs,
  };
}

export function useFileEditor({
  projectRoot,
  relPath,
  open,
}: {
  projectRoot: string;
  relPath: string | null;
  open: boolean;
}) {
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [content, setContent] = useState("");
  const [loadError, setLoadError] = useState<{ kind: LoadError; lineCount?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [externalChanged, setExternalChanged] = useState(false);
  const watchIdRef = useRef<string | null>(null);
  const mtimeRef = useRef<number>(0);
  const savingRef = useRef(false);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  if (loaded) mtimeRef.current = loaded.mtimeMs;

  const dirty = loaded?.kind === "text" && content !== loaded.content;
  const contentRef = useRef(content);
  contentRef.current = content;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Load on open / relPath change.
  useEffect(() => {
    if (!open || !relPath || !window.electronAPI) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setLoaded(null);
    setContent("");
    setExternalChanged(false);
    setSaveError(null);
    void (async () => {
      const r = await readProjectFile(projectRoot, relPath);
      if (cancelled) return;
      if (r.ok) {
        const next = toLoadedFile(r);
        setLoaded(next);
        setContent(next.kind === "text" ? next.content : "");
      } else {
        setLoadError({ kind: r.error, lineCount: r.lineCount });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectRoot, relPath]);

  const handleExternalChange = useCallback(async () => {
    if (!relPath || !window.electronAPI) return;
    const r = await readProjectFile(projectRoot, relPath);
    if (!r.ok) return;
    const next = toLoadedFile(r);
    // Our own save can race the watcher: disk already matches the editor.
    if (next.kind === "text" && next.content === contentRef.current) {
      mtimeRef.current = next.mtimeMs;
      setLoaded(next);
      setExternalChanged(false);
      return;
    }
    if (dirtyRef.current) {
      setLoaded((prev) => (prev ? { ...prev, mtimeMs: next.mtimeMs } : prev));
      setExternalChanged(true);
      return;
    }
    // Silent reload — preserve scroll + selection.
    const view = cmRef.current?.view;
    const scrollTop = view?.scrollDOM.scrollTop ?? 0;
    const selection = view?.state.selection;
    setLoaded(next);
    setContent(next.kind === "text" ? next.content : "");
    setExternalChanged(false);
    requestAnimationFrame(() => {
      const v = cmRef.current?.view;
      if (!v) return;
      v.scrollDOM.scrollTop = scrollTop;
      if (selection) {
        try {
          v.dispatch({ selection });
        } catch {
          // selection may be out of range after reload; ignore.
        }
      }
    });
  }, [projectRoot, relPath]);

  // Mount file watcher once per open file. The watcher fires on every external
  // mtime advance and we read the current mtime via ref, so saves don't tear it down.
  const hasLoaded = loaded !== null;
  useEffect(() => {
    if (!open || !relPath || !hasLoaded || !window.electronAPI) return;
    let active = true;
    let unsub: (() => void) | undefined;
    let activeWatch: ProjectFileWatch | null = null;
    void (async () => {
      const r = await watchProjectFile(projectRoot, relPath);
      if (!active) {
        if (r.ok) r.watch.unwatch();
        return;
      }
      if (!r.ok) return;
      activeWatch = r.watch;
      watchIdRef.current = r.watch.watchId;
      unsub = r.watch.onChanged((msg) => {
        if (msg.watchId !== r.watch.watchId) return;
        if (savingRef.current) return;
        if (msg.mtimeMs <= mtimeRef.current) return;
        void handleExternalChange();
      });
    })();
    return () => {
      active = false;
      unsub?.();
      watchIdRef.current = null;
      activeWatch?.unwatch();
    };
  }, [open, projectRoot, relPath, hasLoaded, handleExternalChange]);

  const doSave = useCallback(
    async (forceOverwrite: boolean): Promise<boolean> => {
      if (!relPath || !window.electronAPI || !loaded) return false;
      if (loaded.kind !== "text") return false;
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      const expectedMtime = forceOverwrite ? null : loaded.mtimeMs;
      let r = await writeProjectFile(projectRoot, relPath, content, expectedMtime);
      // Sensitive paths (.claude/settings.local.json, .git/hooks/*, package.json,
      // .vscode/tasks.json, etc.) are rejected by `files:write` and must go
      // through `files:writeSensitive`, which surfaces a native OS confirm
      // dialog in the main process. The retry is silent — the user sees one
      // dialog, not an error followed by a re-click.
      if (!r.ok && r.error === "protected-path") {
        r = await writeProjectFileSensitive(projectRoot, relPath, content, expectedMtime);
      }
      if (r.ok) {
        mtimeRef.current = r.mtimeMs;
        setLoaded({ kind: "text", content, mtimeMs: r.mtimeMs });
        setExternalChanged(false);
        setSaving(false);
        savingRef.current = false;
        return true;
      }
      setSaving(false);
      savingRef.current = false;
      if (r.error === "stale") {
        setExternalChanged(true);
        setSaveError("File changed on disk. Discard your edits and reload, or overwrite anyway.");
        return false;
      }
      // User clicked Cancel in the native confirm dialog — no-op, not an error.
      if (r.error === "user-declined") {
        return false;
      }
      setSaveError(r.error);
      return false;
    },
    [projectRoot, relPath, loaded, content],
  );

  const discardAndReload = useCallback(async () => {
    if (!relPath || !window.electronAPI) return;
    const r = await readProjectFile(projectRoot, relPath);
    if (!r.ok) return;
    const next = toLoadedFile(r);
    setLoaded(next);
    setContent(next.kind === "text" ? next.content : "");
    setExternalChanged(false);
    setSaveError(null);
  }, [projectRoot, relPath]);

  return {
    loaded,
    content,
    setContent,
    loading,
    loadError,
    saving,
    saveError,
    externalChanged,
    dirty,
    dirtyRef,
    doSave,
    discardAndReload,
    cmRef,
  };
}
