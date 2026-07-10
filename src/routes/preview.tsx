import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { z } from "zod";
import { MarkdownPreviewPanel } from "~/components/views/MarkdownPreviewPanel";
import { CONCOURSE_TOAST_CLASS_NAMES, CONCOURSE_TOAST_CLOSE_ICON } from "~/lib/mc-toast";
import { useTheme } from "~/lib/use-theme";

const previewSearchSchema = z.object({
  cwd: z.string(),
  rel: z.string(),
});

export const Route = createFileRoute("/preview")({
  validateSearch: previewSearchSchema,
  component: PreviewWindowPage,
});

// Standalone document window: the chat preview panel's pop-out button opens
// this route in its own BrowserWindow (see IPC.previewOpenWindow) — full-size
// reading with live mermaid diagrams and Word/PDF export, no chat around it.
// __root.tsx renders this route shell-less.
function PreviewWindowPage() {
  const { cwd, rel } = Route.useSearch();
  const { theme } = useTheme();

  useEffect(() => {
    document.title = rel.split("/").pop() ?? "Document";
  }, [rel]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        background: "var(--surface-0)",
        color: "var(--text)",
      }}
    >
      <MarkdownPreviewPanel
        cwd={cwd}
        relPath={rel}
        onClose={() => window.close()}
        fill
        standalone
      />
      <Toaster
        position="bottom-right"
        theme={theme === "light" ? "light" : "dark"}
        closeButton
        offset={16}
        icons={{ close: CONCOURSE_TOAST_CLOSE_ICON }}
        toastOptions={{
          unstyled: true,
          closeButton: true,
          classNames: CONCOURSE_TOAST_CLASS_NAMES,
        }}
      />
    </div>
  );
}
