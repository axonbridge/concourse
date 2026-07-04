import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { DropdownMenuItem } from "~/components/ui/DropdownMenuItem";
import { Icon } from "~/components/ui/Icon";
import { Markdown } from "~/components/ui/Markdown";
import { chatStore, useChatSession } from "~/lib/chat-store";
import { getElectron } from "~/lib/electron";
import { readProjectFile } from "~/lib/project-fs";
import { aiProviderInfo, resolveChatAgent, type EngineId } from "~/shared/ai-providers";
import type { ChatItem, ChatStatus } from "~/shared/chat";

// The non-technical chat surface: a ChatGPT-style window over Claude Code. The
// terminal is never shown. Reads/research stream in as bubbles; writes pause for
// an in-chat Approve / Deny.

const STATUS_LABEL: Record<ChatStatus, string> = {
  starting: "Starting…",
  running: "Working…",
  "awaiting-input": "Ready",
  "awaiting-permission": "Needs your approval",
  ended: "Done",
  error: "Error",
};

export function ChatView({
  sessionId,
  cwd,
  command,
  title,
  projectName,
  description,
  examples,
  providerSessionId,
  agent,
  model,
  baseUrl,
  resume,
  autoApproveWrites,
  autoStartText,
  onClose,
  onNewSession,
}: {
  sessionId: string;
  cwd: string;
  command: string;
  title: string;
  projectName: string;
  description?: string;
  examples?: string[];
  providerSessionId?: string;
  /** AI provider (TaskAgent id) powering this session. */
  agent?: string;
  /** Default model for the session (overridable from the intro card). */
  model?: string;
  /** OpenAI-compatible endpoint (custom direct engine only). */
  baseUrl?: string;
  resume?: boolean;
  autoApproveWrites?: boolean;
  /** Fire this text immediately on open (no intro card) — e.g. the app-provided
   *  "Prepare for Concourse" instructions. User consent happened at the click. */
  autoStartText?: string;
  onClose: () => void;
  onNewSession: () => void;
}) {
  const [draft, setDraft] = useState("");
  // Files picked but not yet sent: previewed above the input, staged into
  // <workspace>/.concourse/attachments/ on send so every engine can Read them.
  const [pending, setPending] = useState<Array<{ path: string; name: string; dataUrl?: string }>>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reopen (resume) → reattach to the saved session. Fresh pick → prime the chat
  // with an intro and wait; the command fires on the first message (see send()).
  useEffect(() => {
    if (resume) {
      chatStore.start(sessionId, {
        cwd,
        initialText: "",
        title,
        providerSessionId,
        agent,
        model,
        baseUrl,
        resume: true,
      });
    } else if (autoStartText) {
      chatStore.start(sessionId, {
        cwd,
        initialText: autoStartText,
        title,
        providerSessionId,
        agent,
        model,
        baseUrl,
        resume: false,
      });
    } else {
      chatStore.prime(sessionId, {
        cwd,
        title,
        command,
        providerSessionId,
        agent,
        model,
        baseUrl,
        description,
        examples,
        autoApproveWrites,
      });
    }
  }, [sessionId, cwd, command, title, providerSessionId, agent, model, baseUrl, resume, description, examples, autoApproveWrites, autoStartText]);

  // While this chat is open, mark it active so per-turn "session finished"
  // notifications are suppressed for it (see use-session-finish-notifications).
  useEffect(() => {
    chatStore.setActiveChatSession(sessionId);
    return () => {
      if (chatStore.getActiveChatSessionId() === sessionId) {
        chatStore.setActiveChatSession(null);
      }
    };
  }, [sessionId]);

  const session = useChatSession(sessionId);
  const items = session?.items ?? [];
  const status = session?.status ?? "starting";
  const permission = session?.permission ?? null;
  const intro = session?.intro ?? null;
  // Models offered by this session's engine (intro-card picker; locked once
  // the backend session starts, since a session's model is fixed). Static
  // registry list first, upgraded by live ModelCatalog discovery when it lands.
  const chatEngine = resolveChatAgent((agent as EngineId | undefined) ?? null);
  const [providerModels, setProviderModels] = useState<Array<{ id: string; label: string }>>(
    () => aiProviderInfo(chatEngine).models,
  );
  useEffect(() => {
    let cancelled = false;
    const staticModels = aiProviderInfo(chatEngine).models;
    setProviderModels(staticModels);
    void getElectron()
      ?.models.list(chatEngine)
      .then((r) => {
        if (!cancelled && r.models.length) setProviderModels(r.models);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [chatEngine]);
  // Harness sessions pin their model at start; direct engines are stateless
  // per request, so their picker stays live for the whole conversation.
  const modelLocked =
    (session?.started ?? false) && aiProviderInfo(chatEngine).kind !== "direct";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, permission, status, session?.streamingText]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text && pending.length === 0) return;
    setDraft("");
    const files = pending;
    setPending([]);
    void (async () => {
      if (files.length === 0) {
        chatStore.send(sessionId, text);
        return;
      }
      const staged = (await getElectron()?.attachments.stage(cwd, files.map((f) => f.path))) ?? [];
      const list = staged.map((a) => `- ${a.rel}`).join("\n");
      const engineText = `${text || "See the attached files."}\n\nAttached files (read them if relevant):\n${list}`;
      chatStore.send(sessionId, engineText, {
        displayText: text || "(attachments)",
        attachments: files.map((f) => ({ name: f.name, dataUrl: f.dataUrl })),
      });
    })();
  }, [draft, pending, sessionId, cwd]);

  const attach = useCallback(async () => {
    const picked = (await getElectron()?.attachments.pick()) ?? [];
    if (picked.length) setPending((cur) => [...cur, ...picked]);
  }, []);

  // Workflow builder: let the user upload a template file mid-interview. We send
  // its contents as a message so the agent saves it as the workflow's output
  // template and wires the command to follow it.
  const attachTemplate = useCallback(async () => {
    const picked = await getElectron()?.pickTemplateFile();
    if (!picked) return;
    const msg =
      `I'd like the output to follow this template (from my file "${picked.name}"). ` +
      "Save it as this workflow's output template under `templates/` (named after the command), " +
      "set the command's frontmatter `template:` to that name, add the output-format block, and make the command follow it:\n\n" +
      "```\n" +
      picked.content +
      "\n```";
    chatStore.send(sessionId, msg);
  }, [sessionId]);

  const respond = useCallback(
    (allow: boolean) => {
      if (!permission) return;
      chatStore.respondPermission(sessionId, permission.requestId, allow);
    },
    [permission, sessionId],
  );

  const busy = status === "running" || status === "starting";
  const activity = session?.activity ?? null;

  // Elapsed-time ticker while busy, so long turns read as alive rather than stuck.
  const [busySeconds, setBusySeconds] = useState(0);
  useEffect(() => {
    if (!busy) {
      setBusySeconds(0);
      return;
    }
    const started = Date.now();
    setBusySeconds(0);
    const t = window.setInterval(
      () => setBusySeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(t);
  }, [busy]);
  const busyClock =
    busySeconds >= 5
      ? ` · ${Math.floor(busySeconds / 60)}:${String(busySeconds % 60).padStart(2, "0")}`
      : "";

  // Markdown side-panel preview: clicking a .md path opens it rendered in-app
  // (business users often have no editor for markdown). Reads are root-jailed:
  // workspace files use cwd, org-knowledge files use the org dir. Non-md files
  // and paths outside both roots fall through to the OS default app.
  const [preview, setPreview] = useState<{ root: string; rel: string } | null>(null);
  // Outputs tab: deliverables under outputs/<command>/ (the workspace standard).
  const [showOutputs, setShowOutputs] = useState(false);
  const [outputFiles, setOutputFiles] = useState<string[]>([]);
  useEffect(() => {
    if (!showOutputs) return;
    let cancelled = false;
    void Promise.all([
      getElectron()?.files.list(cwd),
      getElectron()?.files.list(`${cwd}/.concourse`),
    ])
      .then(([ws, overlay]) => {
        if (cancelled) return;
        const a = ws?.ok ? ws.files.filter((f) => f.startsWith("outputs/")) : [];
        const b = overlay?.ok
          ? overlay.files.filter((f) => f.startsWith("outputs/")).map((f) => `.concourse/${f}`)
          : [];
        setOutputFiles([...a, ...b]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showOutputs, cwd, items.length]);
  const [orgDir, setOrgDir] = useState<string | null>(null);
  useEffect(() => {
    void getElectron()
      ?.getUserDataDir()
      .then((d) => setOrgDir(`${d}/org-knowledge`))
      .catch(() => {});
  }, []);
  const handleOpenFile = useCallback(
    (p: string): boolean => {
      let root = cwd;
      let rel: string | null = null;
      if (p.startsWith("/")) {
        const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
        const orgPrefix = orgDir ? `${orgDir}/` : null;
        if (p.startsWith(prefix)) rel = p.slice(prefix.length);
        else if (orgPrefix && p.startsWith(orgPrefix)) {
          root = orgDir!;
          rel = p.slice(orgPrefix.length);
        }
      } else {
        rel = p;
      }
      if (!rel) return false; // absolute path outside both roots → OS open
      if (!/\.(md|markdown)$/i.test(rel)) {
        void getElectron()?.openFile(`${root}/${rel}`);
        return true;
      }
      setPreview({ root, rel });
      return true;
    },
    [cwd, orgDir],
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-0)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 18px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Breadcrumb: project (back to sessions) › current task */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, minWidth: 0 }}>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--text-dim)",
                fontSize: 13,
                fontFamily: "var(--sans)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-dim)")}
            >
              {projectName}
            </button>
            <Icon name="chevron-right" size={12} style={{ color: "var(--text-faint)" }} />
            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {title}
            </span>
          </div>
          <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background:
                  status === "error"
                    ? "var(--status-failed)"
                    : status === "awaiting-permission"
                      ? "var(--status-needs)"
                      : busy
                        ? "var(--status-running)"
                        : "var(--status-done)",
              }}
            />
            {STATUS_LABEL[status]}
          </div>
        </div>
        <Btn variant="ghost" icon="folder" onClick={() => setShowOutputs((v) => !v)}>
          Outputs
        </Btn>
        <Btn variant="ghost" icon="plus" onClick={onNewSession}>
          New session
        </Btn>
        <Btn variant="ghost" icon="x" onClick={onClose} aria-label="Close chat" />
      </div>

      {/* Body: chat column + optional markdown preview panel */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {intro && items.length === 0 && (
          <div
            style={{
              border: "1px solid var(--border)",
              background: "var(--surface-1)",
              borderRadius: "var(--radius-lg)",
              padding: "18px 20px",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{title}</div>
            <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.55, marginBottom: 14 }}>
              {intro.description || `Tell me what you'd like and I'll run the ${title} workflow for you.`}
            </div>
            {intro.examples.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "var(--text-faint)",
                    marginBottom: 8,
                  }}
                >
                  Try one of these
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                  {intro.examples.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setDraft(ex);
                        inputRef.current?.focus();
                      }}
                      style={{
                        textAlign: "left",
                        padding: "8px 12px",
                        background: "var(--surface-0)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        color: "var(--text)",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
              Type your request below and press Enter to start.
            </div>
          </div>
        )}

        {items.map((item) => (
          <ChatBubble key={item.id} item={item} onOpenFile={handleOpenFile} />
        ))}

        {session?.streamingText && (
          <ChatBubble
            item={{ id: "__streaming", type: "assistant", text: session.streamingText }}
            onOpenFile={handleOpenFile}
          />
        )}

        {busy && !permission && (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--text-dim)",
              fontStyle: "italic",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--status-running)",
                animation: "pulse-dot 1.4s ease-in-out infinite",
                flexShrink: 0,
              }}
            />
            <span>
              {activity ? `Working — ${activity}…` : "Working…"}
              <span style={{ color: "var(--text-faint)" }}>{busyClock}</span>
            </span>
            <button
              type="button"
              onClick={() => chatStore.interrupt(sessionId)}
              title="Stop this run — the conversation stays and resumes on your next message"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11.5,
                fontStyle: "normal",
                padding: "2px 10px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--surface-1)",
                color: "var(--text-dim)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <span
                aria-hidden
                style={{ width: 7, height: 7, borderRadius: 1.5, background: "currentColor" }}
              />
              Stop
            </button>
          </div>
        )}

        {permission && (
          <div
            style={{
              border: "1px solid var(--accent-border)",
              background: "var(--accent-faint)",
              borderRadius: "var(--radius)",
              padding: "14px 16px",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Approval needed</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 12 }}>{permission.summary}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" icon="check" onClick={() => respond(true)}>
                Approve
              </Btn>
              <Btn variant="ghost" onClick={() => respond(false)}>
                Deny
              </Btn>
            </div>
          </div>
        )}
      </div>

      {/* Pending attachments */}
      {pending.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "8px 12px 0",
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {pending.map((f, i) => (
            <div
              key={`${f.path}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 6,
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                maxWidth: 220,
              }}
            >
              {f.dataUrl ? (
                <img
                  src={f.dataUrl}
                  alt={f.name}
                  style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 5 }}
                />
              ) : (
                <span style={{ fontSize: 18 }} aria-hidden>
                  📄
                </span>
              )}
              <span
                style={{
                  fontSize: 11.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.name}
              </span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setPending((cur) => cur.filter((_, j) => j !== i))}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--text-faint)",
                  cursor: "pointer",
                  fontSize: 13,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ borderTop: pending.length ? "none" : "1px solid var(--border)", padding: 12, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            permission
              ? "Approve or deny above to continue…"
              : session?.interrupted
                ? "Stopped — your next message resumes the conversation…"
                : "Type a message…"
          }
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            maxHeight: 140,
            padding: "10px 12px",
            background: "var(--surface-1)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            lineHeight: 1.5,
            outline: "none",
          }}
        />
        {command === "create-workflow" && (
          <Btn
            variant="ghost"
            icon="upload"
            onClick={() => void attachTemplate()}
            aria-label="Attach a template file"
            title="Attach a template file"
          >
            Template
          </Btn>
        )}
        <Btn variant="ghost" icon="upload" onClick={() => void attach()} aria-label="Attach files" title="Attach files">
          {""}
        </Btn>
        {providerModels.length > 0 && (
          <ModelPicker
            models={providerModels}
            value={session?.model}
            disabled={modelLocked}
            onChange={(id) => chatStore.setModel(sessionId, id)}
          />
        )}
        <Btn variant="primary" icon="chevron-up" onClick={send} disabled={!draft.trim() && pending.length === 0} aria-label="Send">
          Send
        </Btn>
      </div>
      </div>

      {showOutputs && (
        <div
          style={{
            width: 300,
            flexShrink: 0,
            borderLeft: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>Outputs</span>
            <Btn variant="ghost" icon="x" onClick={() => setShowOutputs(false)} aria-label="Close outputs" />
          </div>
          <div style={{ overflowY: "auto", padding: 8, flex: 1 }}>
            {outputFiles.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-faint)", padding: 8 }}>
                No outputs yet — workflow deliverables land in outputs/&lt;command&gt;/.
              </div>
            )}
            {[...new Set(outputFiles.map((f) => f.replace(/^\.concourse\//, "").split("/")[1] ?? ""))].sort().map((group) => (
              <div key={group}>
                <div
                  style={{
                    padding: "8px 8px 3px",
                    fontSize: 10.5,
                    fontFamily: "var(--mono)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--text-faint)",
                  }}
                >
                  {group}
                </div>
                {outputFiles
                  .filter((f) => (f.replace(/^\.concourse\//, "").split("/")[1] ?? "") === group)
                  .sort()
                  .reverse()
                  .map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        if (/\.(md|markdown)$/i.test(f)) setPreview({ root: cwd, rel: f });
                        else void getElectron()?.openFile(`${cwd}/${f}`);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "none",
                        background: "transparent",
                        color: "var(--text)",
                        fontSize: 12.5,
                        cursor: "pointer",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={f}
                    >
                      {f.replace(/^\.concourse\//, "").split("/").slice(2).join("/") || f}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <MarkdownPreviewPanel
          cwd={preview.root}
          relPath={preview.rel}
          onClose={() => setPreview(null)}
        />
      )}
      </div>
    </div>
  );
}

// Side panel rendering a workspace markdown file (e.g. a generated summary) so
// non-technical users can read outputs without an editor.
function MarkdownPreviewPanel({
  cwd,
  relPath,
  onClose,
}: {
  cwd: string;
  relPath: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Exports use the already-RENDERED DOM as the source, wrapped in a clean
  // print-style shell: Word gets HTML-as-.doc (opens natively in Word/Pages/
  // Google Docs), PDF goes through Chromium's printToPDF in the main process.
  // No converter dependencies either way.
  const buildExportHtml = useCallback((): { title: string; doc: string } | null => {
    const html = contentRef.current?.innerHTML;
    if (!html) return null;
    const title = (relPath.split("/").pop() ?? "document").replace(/\.(md|markdown)$/i, "");
    const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; }
  h1 { font-size: 20pt; } h2 { font-size: 15pt; } h3 { font-size: 12.5pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #999; padding: 4pt 8pt; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  code { font-family: Consolas, monospace; font-size: 10pt; background: #f4f4f4; }
  pre { background: #f4f4f4; padding: 8pt; }
</style></head>
<body>${html}</body></html>`;
    return { title, doc };
  }, [relPath]);

  const exportToWord = useCallback(async () => {
    const built = buildExportHtml();
    if (!built) return;
    const res = await getElectron()?.saveTextFile(`${built.title}.doc`, built.doc, [
      { name: "Word Document", extensions: ["doc"] },
    ]);
    if (res?.ok) toast.success(`Exported ${built.title}.doc`);
  }, [buildExportHtml]);

  const exportToPdf = useCallback(async () => {
    const built = buildExportHtml();
    if (!built) return;
    const res = await getElectron()?.exportPdf(`${built.title}.pdf`, built.doc);
    if (res?.ok) toast.success(`Exported ${built.title}.pdf`);
    else if (res && "error" in res && res.error) toast.error(`PDF export failed: ${res.error}`);
  }, [buildExportHtml]);

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
        width: "44%",
        minWidth: 320,
        maxWidth: 720,
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
              </div>
            </>
          )}
        </div>
        <Btn
          variant="ghost"
          size="sm"
          icon="external-link"
          onClick={() => void getElectron()?.openFile(`${cwd}/${relPath}`)}
          aria-label="Open in default app"
          title="Open in default app"
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

function ChatBubble({
  item,
  onOpenFile,
}: {
  item: ChatItem;
  onOpenFile?: (path: string) => boolean;
}) {
  if (item.type === "tool") {
    return (
      <div style={{ fontSize: 12, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="terminal" size={12} />
        {item.summary}
      </div>
    );
  }
  if (item.type === "notice") {
    return <div style={{ fontSize: 12.5, color: "var(--status-needs)", fontStyle: "italic" }}>{item.text}</div>;
  }
  const isUser = item.type === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "82%",
          padding: "10px 14px",
          borderRadius: 12,
          fontSize: 13.5,
          lineHeight: 1.55,
          whiteSpace: isUser ? "pre-wrap" : "normal",
          wordBreak: "break-word",
          background: isUser ? "var(--accent)" : "var(--surface-2)",
          color: isUser ? "#fff" : "var(--text)",
          border: isUser ? "none" : "1px solid var(--border)",
        }}
      >
        {isUser ? item.text : <Markdown onOpenFile={onOpenFile}>{item.text}</Markdown>}
        {isUser && item.type === "user" && item.attachments?.length ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {item.attachments.map((a, i) =>
              a.dataUrl ? (
                <img
                  key={i}
                  src={a.dataUrl}
                  alt={a.name}
                  title={a.name}
                  style={{ maxWidth: 140, maxHeight: 100, borderRadius: 6, display: "block" }}
                />
              ) : (
                <span
                  key={i}
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.18)",
                    whiteSpace: "nowrap",
                  }}
                >
                  📄 {a.name}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Searchable, grouped model picker for the chat input bar. A native <select>
// collapses at ~10 entries; OpenCode alone lists 50+ Bedrock models. Groups by
// the "provider · name" label convention, filters as you type, opens upward.
function ModelPicker({
  models,
  value,
  disabled,
  onChange,
}: {
  models: Array<{ id: string; label: string }>;
  value?: string;
  disabled?: boolean;
  onChange: (id: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const current = models.find((m) => m.id === value);
  const buttonLabel = current
    ? current.label.includes(" · ")
      ? current.label.slice(current.label.indexOf(" · ") + 3)
      : current.label
    : "Model: default";

  const q = query.trim().toLowerCase();
  const filtered = q
    ? models.filter((m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
    : models;
  const groups = new Map<string, Array<{ id: string; label: string; short: string }>>();
  for (const m of filtered) {
    const sep = m.label.indexOf(" · ");
    const group = sep > 0 ? m.label.slice(0, sep) : "Models";
    const short = sep > 0 ? m.label.slice(sep + 3) : m.label;
    const list = groups.get(group) ?? [];
    list.push({ ...m, short });
    groups.set(group, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.short.localeCompare(b.short));

  const pick = (id: string | undefined) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={
          disabled
            ? "The model is fixed for a running session — start a new session to change it."
            : "Model for this session"
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 38,
          maxWidth: 200,
          padding: "0 10px",
          background: "var(--surface-1)",
          color: disabled ? "var(--text-faint)" : "var(--text-dim)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          fontSize: 12,
          fontFamily: "var(--sans)",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {buttonLabel}
        </span>
        <Icon name="chevron-up" size={10} />
      </button>
      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 30 }}
            onClick={() => {
              setOpen(false);
              setQuery("");
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              right: 0,
              zIndex: 31,
              width: 320,
              maxHeight: 380,
              display: "flex",
              flexDirection: "column",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
              overflow: "hidden",
            }}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
                if (e.key === "Enter") {
                  const first = [...groups.values()][0]?.[0];
                  if (first) pick(first.id);
                }
              }}
              placeholder="Search models…"
              spellCheck={false}
              style={{
                margin: 8,
                padding: "7px 10px",
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
                fontSize: 12.5,
                outline: "none",
              }}
            />
            <div style={{ overflowY: "auto", padding: "0 6px 6px" }}>
              {!q && (
                <button
                  type="button"
                  onClick={() => pick(undefined)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: "none",
                    background: !value ? "var(--accent-faint)" : "transparent",
                    color: "var(--text)",
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  Default — let the provider choose
                </button>
              )}
              {[...groups.entries()].map(([group, list]) => (
                <div key={group}>
                  <div
                    style={{
                      padding: "8px 10px 3px",
                      fontSize: 10.5,
                      fontFamily: "var(--mono)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--text-faint)",
                    }}
                  >
                    {group}
                  </div>
                  {list.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => pick(m.id)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "none",
                        background: m.id === value ? "var(--accent-faint)" : "transparent",
                        color: "var(--text)",
                        fontSize: 12.5,
                        cursor: "pointer",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.short}
                    </button>
                  ))}
                </div>
              ))}
              {filtered.length === 0 && (
                <div style={{ padding: "10px", fontSize: 12, color: "var(--text-faint)" }}>
                  No models match "{query}"
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
