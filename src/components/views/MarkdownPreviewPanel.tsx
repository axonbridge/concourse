import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { DropdownMenuItem } from "~/components/ui/DropdownMenuItem";
import { Icon } from "~/components/ui/Icon";
import { Markdown } from "~/components/ui/Markdown";
import { buildExportHtml } from "~/lib/document-export";
import { getElectron } from "~/lib/electron";
import { readProjectFile } from "~/lib/project-fs";

// Side panel rendering a workspace markdown file (e.g. a generated summary) so
// non-technical users can read outputs without an editor. Also the body of the
// standalone document window (src/routes/preview.tsx). Exports use the
// already-RENDERED DOM as the source — see ~/lib/document-export.
export function MarkdownPreviewPanel({
  cwd,
  relPath,
  onClose,
  fill = false,
  standalone = false,
}: {
  cwd: string;
  relPath: string;
  onClose: () => void;
  /** Fill the parent instead of the chat side-panel's fixed 44% width. */
  fill?: boolean;
  /** Already in its own window — ↗ opens the OS default app instead of popping out again. */
  standalone?: boolean;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const exportToWord = useCallback(async () => {
    const root = contentRef.current;
    const built = root ? await buildExportHtml(root, relPath) : null;
    if (!built) return;
    const res = await getElectron()?.saveTextFile(`${built.title}.doc`, built.doc, [
      { name: "Word Document", extensions: ["doc"] },
    ]);
    if (res?.ok) {
      toast.success(`Exported ${built.title}.doc`, {
        action: { label: "Show", onClick: () => void getElectron()?.revealPath(res.path) },
      });
    }
  }, [relPath]);

  const exportToPdf = useCallback(async () => {
    const root = contentRef.current;
    const built = root ? await buildExportHtml(root, relPath) : null;
    if (!built) return;
    const res = await getElectron()?.exportPdf(`${built.title}.pdf`, built.doc);
    if (res?.ok) {
      toast.success(`Exported ${built.title}.pdf`, {
        action: { label: "Show", onClick: () => void getElectron()?.revealPath(res.path) },
      });
    } else if (res && "error" in res && res.error) toast.error(`PDF export failed: ${res.error}`);
  }, [relPath]);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    void (async () => {
      try {
        const result = await readProjectFile(cwd, relPath);
        if (cancelled) return;
        if (result && "ok" in result && result.ok && result.kind === "text") {
          setContent(result.content);
        } else {
          setError("Could not read this file.");
        }
      } catch {
        if (!cancelled) setError("Could not read this file.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, relPath]);

  const basename = relPath.split("/").pop() ?? relPath;

  return (
    <div
      style={{
        ...(fill
          ? { flex: 1, minWidth: 0 }
          : { width: "44%", minWidth: 320, maxWidth: 720 }),
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid var(--border)",
        background: "var(--surface-0)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Icon name="file" size={13} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
        <div
          title={relPath}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {basename}
        </div>
        <div style={{ position: "relative" }}>
          <Btn
            variant="ghost"
            size="sm"
            icon="download"
            onClick={() => setExportOpen((v) => !v)}
            disabled={content === null}
            aria-label="Export"
            aria-expanded={exportOpen}
            title="Export…"
          />
          {exportOpen && (
            <>
              {/* click-away backdrop */}
              <div
                style={{ position: "fixed", inset: 0, zIndex: 20 }}
                onClick={() => setExportOpen(false)}
              />
              <div
                role="menu"
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  zIndex: 21,
                  minWidth: 190,
                  padding: 4,
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
                }}
              >
                <DropdownMenuItem
                  icon="file"
                  onClick={() => {
                    setExportOpen(false);
                    void exportToWord();
                  }}
                >
                  Word document (.doc)
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon="download"
                  onClick={() => {
                    setExportOpen(false);
                    void exportToPdf();
                  }}
                >
                  PDF (.pdf)
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon="folder"
                  onClick={() => {
                    setExportOpen(false);
                    void getElectron()?.revealPath(`${cwd}/${relPath}`);
                  }}
                >
                  Open in directory
                </DropdownMenuItem>
              </div>
            </>
          )}
        </div>
        <Btn
          variant="ghost"
          size="sm"
          icon="external-link"
          onClick={() =>
            void (standalone
              ? getElectron()?.openFile(`${cwd}/${relPath}`)
              : getElectron()?.openPreviewWindow(cwd, relPath))
          }
          aria-label={standalone ? "Open in default app" : "Open in new window"}
          title={standalone ? "Open in default app" : "Open in new window"}
        />
        <Btn variant="ghost" size="sm" icon="x" onClick={onClose} aria-label="Close preview" />
      </div>
      <div ref={contentRef} style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
        {error ? (
          <div style={{ fontSize: 13, color: "var(--status-failed)" }}>{error}</div>
        ) : content === null ? (
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Loading…</div>
        ) : (
          <Markdown>{content}</Markdown>
        )}
      </div>
    </div>
  );
}
