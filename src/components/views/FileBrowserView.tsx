import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { HotkeyTooltip, StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import { languageForFilename } from "~/lib/file-language";
import { codeEditorExtensions } from "~/lib/code-editor-extensions";
import { useFileEditor } from "~/lib/use-file-editor";
import { listProjectFiles } from "~/lib/project-fs";
import { LoadErrorView } from "~/components/views/FileEditorDialog";

// Full project file browser: directory tree on the left (like Review Changes'
// file list), an editable CodeMirror pane on the right. Saving goes through
// the same conflict-safe write path as the file-editor dialog.

type TreeDir = {
  name: string;
  path: string;
  dirs: TreeDir[];
  files: { name: string; path: string }[];
};

function buildTree(paths: string[]): TreeDir {
  const root: TreeDir = { name: "", path: "", dirs: [], files: [] };
  const dirIndex = new Map<string, TreeDir>([["", root]]);
  const ensureDir = (path: string): TreeDir => {
    const existing = dirIndex.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const parent = ensureDir(slash >= 0 ? path.slice(0, slash) : "");
    const dir: TreeDir = {
      name: slash >= 0 ? path.slice(slash + 1) : path,
      path,
      dirs: [],
      files: [],
    };
    parent.dirs.push(dir);
    dirIndex.set(path, dir);
    return dir;
  };
  for (const p of paths) {
    const slash = p.lastIndexOf("/");
    const dir = ensureDir(slash >= 0 ? p.slice(0, slash) : "");
    dir.files.push({ name: slash >= 0 ? p.slice(slash + 1) : p, path: p });
  }
  const sortDir = (dir: TreeDir) => {
    dir.dirs.sort((a, b) => a.name.localeCompare(b.name));
    dir.files.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dir.dirs) sortDir(d);
  };
  sortDir(root);
  return root;
}

export function FileBrowserView({
  projectPath,
  enabled = true,
  onBack,
}: {
  projectPath: string;
  enabled?: boolean;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [confirmBack, setConfirmBack] = useState(false);

  const filesQuery = useQuery({
    queryKey: ["files:list", projectPath],
    queryFn: async () => {
      const r = await listProjectFiles(projectPath);
      if (!r.ok) throw new Error(r.error);
      return r.files;
    },
    enabled: enabled && !!projectPath,
    staleTime: 30_000,
  });

  const filterLower = filter.trim().toLowerCase();
  const visibleFiles = useMemo(() => {
    const files = filesQuery.data ?? [];
    if (!filterLower) return files;
    return files.filter((p) => p.toLowerCase().includes(filterLower));
  }, [filesQuery.data, filterLower]);

  const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);

  const editor = useFileEditor({
    projectRoot: projectPath,
    relPath: selected,
    open: selected !== null,
  });

  const requestSelect = useCallback(
    (path: string) => {
      if (path === selected) return;
      if (editor.dirtyRef.current) {
        setPendingSwitch(path);
        return;
      }
      setSelected(path);
    },
    [selected, editor.dirtyRef],
  );

  const requestBack = useCallback(() => {
    if (editor.dirtyRef.current) {
      setConfirmBack(true);
      return;
    }
    onBack();
  }, [onBack, editor.dirtyRef]);

  useHotkey("escape", requestBack, { preventDefault: false });
  useHotkey("file.save", (e) => {
    e.preventDefault();
    void editor.doSave(false);
  }, { enabled: selected !== null });

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const slash = selected ? selected.lastIndexOf("/") : -1;
  const fileName = selected ? (slash >= 0 ? selected.slice(slash + 1) : selected) : "";
  const dirPath = selected && slash >= 0 ? selected.slice(0, slash) : "";

  const extensions = [
    EditorView.lineWrapping,
    ...(selected ? languageForFilename(selected) : []),
    ...codeEditorExtensions(),
  ];

  return (
    <div
      data-navigation-swipe-blocker
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "4px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-2)",
        }}
      >
        <StaticHotkeyTooltip hotkey="Esc" label="Back to project">
          <Btn
            variant="ghost"
            size="sm"
            icon="chevron-left"
            onClick={requestBack}
            aria-label="Back to project"
          >
            Back
          </Btn>
        </StaticHotkeyTooltip>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          Files
        </span>
        <div
          style={{
            flex: "1 1 180px",
            minWidth: 0,
            color: "var(--text-faint)",
            fontFamily: "var(--mono)",
            fontSize: 11,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textAlign: "right",
          }}
          title={projectPath}
        >
          {projectPath}
        </div>
        <Btn
          variant="ghost"
          size="sm"
          icon="refresh"
          title="Refresh file list"
          aria-label="Refresh file list"
          disabled={filesQuery.isFetching}
          onClick={() => void filesQuery.refetch()}
          style={{ width: 30, padding: 0 }}
        >
          {""}
        </Btn>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Tree pane */}
        <div
          style={{
            width: 300,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid var(--border)",
            background: "var(--surface-1)",
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <Icon name="search" size={12} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files…"
              style={{
                flex: 1,
                minWidth: 0,
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: "var(--text)",
              }}
            />
            {filter && (
              <button
                onClick={() => setFilter("")}
                aria-label="Clear filter"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-faint)",
                  padding: 0,
                  display: "flex",
                }}
              >
                <Icon name="x" size={11} />
              </button>
            )}
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
            {filesQuery.error ? (
              <TreeStatus>Error: {(filesQuery.error as Error).message}</TreeStatus>
            ) : filesQuery.isLoading ? (
              <TreeStatus>Indexing…</TreeStatus>
            ) : visibleFiles.length === 0 ? (
              <TreeStatus>{filterLower ? "No matches." : "No files found."}</TreeStatus>
            ) : (
              <TreeLevel
                dir={tree}
                depth={0}
                expanded={expanded}
                forceExpand={filterLower.length > 0}
                selected={selected}
                onToggleDir={toggleDir}
                onSelect={requestSelect}
              />
            )}
          </div>
          <div
            style={{
              padding: "5px 10px",
              borderTop: "1px solid var(--border)",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--text-faint)",
            }}
          >
            {filesQuery.data
              ? filterLower
                ? `${visibleFiles.length} / ${filesQuery.data.length} files`
                : `${filesQuery.data.length} files`
              : "—"}
          </div>
        </div>

        {/* Editor pane */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          <div
            style={{
              padding: "4px 12px",
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-dim)",
              borderBottom: "1px solid var(--border)",
              background: "var(--surface-2)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              whiteSpace: "nowrap",
              overflow: "hidden",
              minHeight: 28,
            }}
            title={selected ?? undefined}
          >
            {selected ? (
              <>
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    flex: "0 1 auto",
                    color: "var(--text)",
                    fontWeight: 600,
                  }}
                >
                  {fileName}
                </span>
                {dirPath && (
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      flex: "1 1 auto",
                      color: "var(--text-faint)",
                    }}
                  >
                    {dirPath}
                  </span>
                )}
                {editor.dirty && (
                  <span
                    title="Unsaved changes"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--accent)",
                      flexShrink: 0,
                    }}
                  />
                )}
                <HotkeyTooltip action="file.save">
                  <Btn
                    variant="primary"
                    size="sm"
                    icon="check"
                    onClick={() => void editor.doSave(false)}
                    disabled={!editor.loaded || editor.saving || !editor.dirty}
                  >
                    {editor.saving ? "Saving…" : "Save"}
                  </Btn>
                </HotkeyTooltip>
              </>
            ) : (
              <span style={{ flex: 1 }}>Select a file to view and edit</span>
            )}
          </div>

          {editor.externalChanged && selected && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                background: "var(--surface-0)",
                borderBottom: "1px solid var(--border)",
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: "var(--text-dim)",
              }}
            >
              <span style={{ flex: 1 }}>
                File changed on disk. {editor.dirty ? "You have unsaved edits." : ""}
              </span>
              <Btn size="sm" variant="ghost" onClick={() => void editor.discardAndReload()}>
                Discard mine & reload
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => void editor.doSave(true)}>
                Overwrite
              </Btn>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: selected ? "#282c34" : "var(--surface-0)" }}>
            {!selected ? (
              <EmptyEditorHint />
            ) : editor.loading ? (
              <TreeStatus>Loading…</TreeStatus>
            ) : editor.loadError ? (
              <LoadErrorView
                kind={editor.loadError.kind}
                lineCount={editor.loadError.lineCount}
                onClose={() => setSelected(null)}
              />
            ) : editor.loaded?.kind === "image" ? (
              <div
                style={{
                  minHeight: "100%",
                  padding: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <img
                  src={editor.loaded.dataUrl}
                  alt={`Preview of ${fileName}`}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    borderRadius: 8,
                    boxShadow: "0 10px 36px rgba(0, 0, 0, 0.35)",
                  }}
                />
              </div>
            ) : (
              <CodeMirror
                ref={editor.cmRef}
                value={editor.content}
                theme={oneDark}
                extensions={extensions}
                onChange={(v) => editor.setContent(v)}
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLine: true,
                  highlightActiveLineGutter: true,
                  foldGutter: true,
                }}
                style={{ fontSize: 13, height: "100%" }}
              />
            )}
          </div>

          {editor.saveError && !editor.externalChanged && (
            <div
              style={{
                padding: "6px 12px",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--status-failed)",
                background: "var(--surface-0)",
                borderTop: "1px solid var(--border)",
              }}
            >
              {editor.saveError}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingSwitch !== null}
        onClose={() => setPendingSwitch(null)}
        onConfirm={() => {
          if (pendingSwitch) setSelected(pendingSwitch);
          setPendingSwitch(null);
        }}
        title="Discard unsaved changes?"
        confirmLabel="Discard & open"
        width={440}
      >
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
          {fileName} has unsaved edits. Opening another file will discard them.
          Save first (⌘S) to keep them.
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmBack}
        onClose={() => setConfirmBack(false)}
        onConfirm={() => {
          setConfirmBack(false);
          onBack();
        }}
        title="Discard unsaved changes?"
        confirmLabel="Discard & close"
        width={440}
      >
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
          {fileName} has unsaved edits. Leaving the file browser will discard them.
        </div>
      </ConfirmDialog>
    </div>
  );
}

function TreeLevel({
  dir,
  depth,
  expanded,
  forceExpand,
  selected,
  onToggleDir,
  onSelect,
}: {
  dir: TreeDir;
  depth: number;
  expanded: Set<string>;
  forceExpand: boolean;
  selected: string | null;
  onToggleDir: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      {dir.dirs.map((d) => {
        const isOpen = forceExpand || expanded.has(d.path);
        return (
          <div key={d.path}>
            <TreeRow
              depth={depth}
              selected={false}
              onClick={() => onToggleDir(d.path)}
              title={d.path}
            >
              <Icon
                name={isOpen ? "chevron-down" : "chevron-right"}
                size={11}
                style={{ color: "var(--text-faint)", flexShrink: 0 }}
              />
              <Icon name="folder" size={12} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
              <span style={rowLabelStyle}>{d.name}</span>
            </TreeRow>
            {isOpen && (
              <TreeLevel
                dir={d}
                depth={depth + 1}
                expanded={expanded}
                forceExpand={forceExpand}
                selected={selected}
                onToggleDir={onToggleDir}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
      {dir.files.map((f) => (
        <TreeRow
          key={f.path}
          depth={depth}
          selected={selected === f.path}
          onClick={() => onSelect(f.path)}
          title={f.path}
        >
          <span style={{ width: 11, flexShrink: 0 }} />
          <Icon name="file" size={12} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
          <span style={rowLabelStyle}>{f.name}</span>
        </TreeRow>
      ))}
    </>
  );
}

const rowLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function TreeRow({
  depth,
  selected,
  onClick,
  title,
  children,
}: {
  depth: number;
  selected: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        paddingLeft: 10 + depth * 14,
        background: selected
          ? "var(--surface-3, var(--surface-2))"
          : hover
            ? "var(--surface-2)"
            : "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: selected ? "var(--text)" : "var(--text-dim)",
      }}
    >
      {children}
    </button>
  );
}

function TreeStatus({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 14,
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: "var(--text-faint)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

function EmptyEditorHint() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        color: "var(--text-faint)",
        fontFamily: "var(--mono)",
        fontSize: 12,
      }}
    >
      <Icon name="file" size={22} />
      <span>Pick a file from the tree to view and edit it.</span>
      <span style={{ fontSize: 11 }}>⌘S saves · Alt-M jumps to the matching bracket</span>
    </div>
  );
}
