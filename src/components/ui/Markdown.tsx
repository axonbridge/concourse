import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getElectron } from "~/lib/electron";

// Single-line paths ending in a file extension. Absolute (/Users/…/report.xlsx)
// always clickable; workspace-relative (summaries/weekly/2026-07-03.md) only
// when a host handler can resolve them. Kept permissive on purpose — the main
// process validates against registered project roots before opening, so a false
// positive just no-ops.
const FILE_PATH_RE = /^\/\S+\.[A-Za-z0-9]{1,10}$/;
const REL_FILE_PATH_RE = /^[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]{1,10}$/;

// Read-only markdown renderer for assistant chat messages. GFM adds tables,
// strikethrough, task lists, and autolinks bare URLs. Styling lives in the
// `.mc-md` rules in styles.css. Streaming-safe: re-renders cleanly as text grows.
// `onOpenFile` lets the host intercept file-path clicks (e.g. preview markdown
// in a side panel); return true = handled, false = fall through to the OS open.
export function Markdown({
  children,
  onOpenFile,
}: {
  children: string;
  onOpenFile?: (path: string) => boolean;
}) {
  return (
    <div className="mc-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Web links open in the system browser. FILE links (relative or
          // absolute paths — e.g. a fact file cited in a source table) route
          // through onOpenFile like code-path clicks, instead of leaking the
          // SPA's own URL to the browser via relative-href resolution.
          a: ({ href, children: c }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => {
                if (!href) return;
                e.preventDefault();
                const electron = getElectron();
                if (/^(https?|mailto):/i.test(href)) {
                  void electron?.openExternal(href);
                  return;
                }
                const p = decodeURI(href);
                if (onOpenFile?.(p)) return;
                if (p.startsWith("/") && electron) void electron.openFile(p);
              }}
            >
              {c}
            </a>
          ),
          // Turn inline absolute file paths into "open the file" links (e.g. an
          // .xlsx a workflow produced). Everything else renders as normal code.
          code: ({ className, children: c, ...rest }) => {
            const text = typeof c === "string" ? c : Array.isArray(c) ? c.join("") : "";
            const trimmed = text.trim();
            const isAbs = !className && !text.includes("\n") && FILE_PATH_RE.test(trimmed);
            const isRel =
              !className && !!onOpenFile && !text.includes("\n") && REL_FILE_PATH_RE.test(trimmed);
            const isFilePath = isAbs || isRel;
            if (isFilePath) {
              const path = trimmed;
              const open = () => {
                if (onOpenFile?.(path)) return;
                if (isAbs) void getElectron()?.openFile(path);
              };
              return (
                <code
                  className="mc-md-filepath"
                  role="button"
                  tabIndex={0}
                  title="Open file"
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open();
                    }
                  }}
                >
                  {c}
                </code>
              );
            }
            return (
              <code className={className} {...rest}>
                {c}
              </code>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
