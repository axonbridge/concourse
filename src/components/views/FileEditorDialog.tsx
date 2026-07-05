import { useCallback, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip, StaticHotkeyTooltip, EscTooltip } from "~/components/ui/Tooltip";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { useHotkey } from "~/lib/use-hotkey";
import { languageForFilename } from "~/lib/file-language";
import { codeEditorExtensions } from "~/lib/code-editor-extensions";
import { useFileEditor, type LoadError } from "~/lib/use-file-editor";
import { FILE_READ_MAX_BYTES, FILE_READ_MAX_LINES } from "~/shared/file-read-limits";

export function FileEditorDialog({
  projectRoot,
  relPath,
  onClose,
}: {
  projectRoot: string;
  relPath: string | null;
  onClose: () => void;
}) {
  const open = relPath !== null;
  const [confirmClose, setConfirmClose] = useState(false);
  const {
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
  } = useFileEditor({ projectRoot, relPath, open });

  const slash = relPath ? relPath.lastIndexOf("/") : -1;
  const fileName = relPath ? (slash >= 0 ? relPath.slice(slash + 1) : relPath) : "";
  const dirPath = relPath && slash >= 0 ? relPath.slice(0, slash) : "";

  const saveAndClose = useCallback(async () => {
    if (loaded?.kind !== "text" || !dirty) {
      onClose();
      return;
    }
    const ok = await doSave(false);
    if (ok) onClose();
  }, [loaded, dirty, doSave, onClose]);

  useHotkey("file.save", (e) => {
    if (!open) return;
    e.preventDefault();
    void doSave(false);
  }, { enabled: open });

  const requestClose = useCallback(() => {
    if (dirtyRef.current) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }, [onClose, dirtyRef]);

  if (!open) return null;

  const extensions = [
    EditorView.lineWrapping,
    ...(relPath ? languageForFilename(relPath) : []),
    ...codeEditorExtensions(),
  ];

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        width="80vw"
        height="82vh"
        maxWidth={1200}
        zIndex={100}
        contentStyle={{
          padding: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
        footer={
          <>
            <span
              style={{
                flex: 1,
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--text-faint)",
              }}
            >
              {loaded?.kind === "text"
                ? `${content.length.toLocaleString()} chars`
                : loaded?.kind === "image"
                  ? `${loaded.mimeType} · ${formatBytes(loaded.size)}`
                  : ""}
            </span>
            <StaticHotkeyTooltip hotkey="Esc">
              <Btn variant="ghost" onClick={requestClose}>
                Close
              </Btn>
            </StaticHotkeyTooltip>
            <Btn
              variant="primary"
              icon="check"
              onClick={() => void saveAndClose()}
              disabled={!loaded || saving}
            >
              {saving ? "Saving…" : "Save and close"}
            </Btn>
            <HotkeyTooltip action="file.save">
              <Btn
                variant="primary"
                icon="check"
                onClick={() => void doSave(false)}
                disabled={!loaded || saving || !dirty}
              >
                {saving ? "Saving…" : "Save"}
              </Btn>
            </HotkeyTooltip>
          </>
        }
        footerStyle={{
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
        }}
        title={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--text)",
                flexShrink: 0,
              }}
            >
              {fileName}
            </span>
            {dirPath && (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-faint)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                  flex: 1,
                }}
                title={dirPath}
              >
                {dirPath}
              </span>
            )}
            {dirty && (
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
          </div>
        }
      >
        {externalChanged && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 16px",
              background: "var(--surface-0)",
              borderBottom: "1px solid var(--border)",
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--text-dim)",
            }}
          >
            <span style={{ flex: 1 }}>
              File changed on disk. {dirty ? "You have unsaved edits." : ""}
            </span>
            <Btn size="sm" variant="ghost" onClick={discardAndReload}>
              Discard mine & reload
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => doSave(true)}>
              Overwrite
            </Btn>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#282c34" }}>
          {loading ? (
            <Status>Loading…</Status>
          ) : loadError ? (
            <LoadErrorView
              kind={loadError.kind}
              lineCount={loadError.lineCount}
              onClose={requestClose}
            />
          ) : loaded?.kind === "image" ? (
            <ImagePreview src={loaded.dataUrl} fileName={fileName} />
          ) : (
            <CodeMirror
              ref={cmRef}
              value={content}
              theme={oneDark}
              extensions={extensions}
              onChange={(v) => setContent(v)}
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

        {saveError && !externalChanged && (
          <div
            style={{
              padding: "6px 16px",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--status-failed)",
              background: "var(--surface-0)",
              borderTop: "1px solid var(--border)",
            }}
          >
            {saveError}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          onClose();
        }}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        width={420}
      >
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
          You have unsaved edits. Closing the editor will discard them.
        </div>
      </ConfirmDialog>
    </>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 24,
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

function ImagePreview({ src, fileName }: { src: string; fileName: string }) {
  return (
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
        src={src}
        alt={fileName ? `Preview of ${fileName}` : "Image preview"}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: 8,
          boxShadow: "0 10px 36px rgba(0, 0, 0, 0.35)",
        }}
      />
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

const FILE_READ_MAX_LINES_LABEL = FILE_READ_MAX_LINES.toLocaleString();
const FILE_READ_MAX_BYTES_LABEL = formatBytes(FILE_READ_MAX_BYTES);

export function LoadErrorView({
  kind,
  lineCount,
  onClose,
}: {
  kind: LoadError;
  lineCount?: number;
  onClose: () => void;
}) {
  let title = "Could not open file";
  let body = String(kind);
  if (kind === "too-large") {
    title = "File too large to open";
    body =
      lineCount && lineCount > 0
        ? `This file has ${lineCount.toLocaleString()} lines (limit is ${FILE_READ_MAX_LINES_LABEL}). If this is production code, consider splitting it up and decomposing it into smaller modules.`
        : `This file exceeds the ${FILE_READ_MAX_LINES_LABEL}-line / ${FILE_READ_MAX_BYTES_LABEL} limit. If this is production code, consider splitting it up and decomposing it into smaller modules.`;
  } else if (kind === "binary") {
    title = "Binary file";
    body = "This file appears to be binary and cannot be edited as text.";
  } else if (kind === "not-found") {
    title = "File not found";
    body = "The file no longer exists on disk.";
  } else if (kind === "invalid-path") {
    title = "Invalid file path";
    body = "This path is outside the project or cannot be opened safely.";
  }
  return (
    <div
      style={{
        padding: 32,
        fontFamily: "var(--mono)",
        fontSize: 13,
        color: "var(--text)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }}>{body}</div>
      <EscTooltip label="Close">
        <Btn variant="ghost" onClick={onClose}>
          Close
        </Btn>
      </EscTooltip>
    </div>
  );
}
