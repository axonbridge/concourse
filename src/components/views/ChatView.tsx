import { useCallback, useEffect, useRef, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { DropdownMenuItem } from "~/components/ui/DropdownMenuItem";
import { Icon } from "~/components/ui/Icon";
import { Markdown } from "~/components/ui/Markdown";
import { chatStore, useChatSession } from "~/lib/chat-store";
import { buildHandoffPrompt, HANDOFF_DISPLAY_TEXT } from "~/lib/handoff-prompt";
import { buildMakeWorkflowPrompt, MAKE_WORKFLOW_DISPLAY_TEXT } from "~/lib/make-workflow-prompt";
import { CardFrame } from "~/components/ui/CardFrame";

import { MarkdownPreviewPanel } from "~/components/views/MarkdownPreviewPanel";
import { FileDatesBadge, outputGroup } from "~/components/views/output-files";
import { getElectron } from "~/lib/electron";
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
  sessionCreatedAt,
  initialSkipApprovals,
  privateKnowledge,
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
  /** Task creation time — scopes the Outputs panel's "This session" filter. */
  sessionCreatedAt?: number;
  /** Persisted per-task "skip all approvals" state, restored on reopen. */
  initialSkipApprovals?: boolean;
  /** Private project: org knowledge read-only for this session. */
  privateKnowledge?: boolean;
  onClose: () => void;
  onNewSession: () => void;
}) {
  const [draft, setDraft] = useState("");
  // Files picked but not yet sent: previewed above the input, staged into
  // <workspace>/.concourse/attachments/ on send so every engine can Read them.
  const [pending, setPending] = useState<Array<{ path: string; name: string; dataUrl?: string }>>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Cold reopen (transcript not in memory — e.g. after an app restart) replays
  // the saved session event-by-event. Rendering that stream live starts the
  // user at the TOP and makes them chase the bottom, so we veil the chat with
  // a loader until the replay burst settles, then reveal scrolled to the end.
  // In-memory reopens and live chatting never see the veil.
  const [restoring, setRestoring] = useState(false);

  // Reopen (resume) → reattach to the saved session. Fresh pick → prime the chat
  // with an intro and wait; the command fires on the first message (see send()).
  useEffect(() => {
    if (resume) {
      if (!chatStore.has(sessionId)) setRestoring(true);
      chatStore.start(sessionId, {
        cwd,
        initialText: "",
        title,
        providerSessionId,
        agent,
        model,
        baseUrl,
        resume: true,
        privateKnowledge,
        dangerouslySkipApprovals: initialSkipApprovals,
      });
    } else if (autoStartText) {
      chatStore.start(sessionId, {
        cwd,
        // App-provided prompts replay as a wall of instructions without the
        // display marker — show the session title instead (live already does).
        initialText: `<concourse-display>${title}</concourse-display>\n\n${autoStartText}`,
        title,
        providerSessionId,
        agent,
        model,
        baseUrl,
        resume: false,
        privateKnowledge,
        dangerouslySkipApprovals: initialSkipApprovals,
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
        privateKnowledge,
        dangerouslySkipApprovals: initialSkipApprovals,
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
  // Direct engines switch live; harness engines pin the model per CONNECTION,
  // so once a provider session id exists we can reconnect with a new model
  // (chatStore.setModel interrupts; the next message resumes). Locked only in
  // the window between start and the provider session id arriving.
  const modelLocked =
    (session?.started ?? false) &&
    aiProviderInfo(chatEngine).kind !== "direct" &&
    !session?.providerSessionId;

  // While the veil is up, end it once the replay burst goes quiet (no new
  // items for a beat). An empty replay gets a longer grace, then reveals.
  useEffect(() => {
    if (!restoring) return;
    const delay = items.length > 0 ? 450 : 2500;
    const t = window.setTimeout(() => setRestoring(false), delay);
    return () => window.clearTimeout(t);
  }, [restoring, items.length]);

  const prevItemCountRef = useRef(0);
  const wasRestoringRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoring) {
      // Keep prev at 0 so the reveal registers as bulk population below.
      wasRestoringRef.current = true;
      return;
    }
    const prev = prevItemCountRef.current;
    prevItemCountRef.current = items.length;
    // Bulk population (reopen replay) jumps instantly — smooth-scrolling
    // through the whole history reads as glitchy. Incremental appends scroll
    // smoothly, and only when the user is already following near the bottom
    // (never yank someone who scrolled up to read).
    const bulk = prev === 0 || items.length - prev > 2;
    if (bulk) {
      el.scrollTo({ top: el.scrollHeight });
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items, permission, status, session?.streamingText, restoring]);

  // After the veil lifts, async content (mermaid, images) can still grow the
  // page under the first jump — settle to the true bottom one more time.
  useEffect(() => {
    if (restoring || !wasRestoringRef.current) return;
    wasRestoringRef.current = false;
    const t = window.setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight });
    }, 450);
    return () => window.clearTimeout(t);
  }, [restoring]);

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
      const staged =
        (await getElectron()?.attachments.stage(cwd, files.map((f) => f.path), title)) ?? [];
      const list = staged.map((a) => `- ${a.rel}`).join("\n");
      const engineText = `${text || "See the attached files."}\n\nAttached files (read them if relevant):\n${list}`;
      chatStore.send(sessionId, engineText, {
        displayText: text || "(attachments)",
        attachments: files.map((f) => ({ name: f.name, dataUrl: f.dataUrl })),
      });
    })();
  }, [draft, pending, sessionId, cwd, title]);

  const attach = useCallback(async () => {
    const picked = (await getElectron()?.attachments.pick()) ?? [];
    if (picked.length) setPending((cur) => [...cur, ...picked]);
  }, []);

  // Drag & drop anywhere in the chat column attaches files exactly like the
  // upload button: resolve native paths, build descriptors, queue as pending.
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const hasFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types ?? []).includes("Files");
  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFileDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const electron = getElectron();
    if (!electron) return;
    const paths = Array.from(e.dataTransfer.files)
      .map((file) => {
        try {
          return electron.getPathForFile(file);
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    if (paths.length === 0) return;
    void electron.attachments.describe(paths).then((described) => {
      if (described.length) setPending((cur) => [...cur, ...described]);
    });
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
  // Header overflow menu: Handoff · Make workflow · Outputs live here so the
  // header stays calm as chat actions accumulate.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);
  const [orgDir, setOrgDir] = useState<string | null>(null);
  useEffect(() => {
    void getElectron()
      ?.getUserDataDir()
      .then((d) => setOrgDir(`${d}/org-knowledge`))
      .catch(() => {});
  }, []);
  const [outputFiles, setOutputFiles] = useState<string[]>([]);
  const [outputMtimes, setOutputMtimes] = useState<Record<string, number>>({});
  // Default scope: only what THIS session created/touched. "All" shows the
  // project's full history (the Knowledge & outputs view is the richer home).
  const [outputsScope, setOutputsScope] = useState<"session" | "all">("session");
  const mountTimeRef = useRef(Date.now());
  const sessionStartMs = sessionCreatedAt ?? mountTimeRef.current;
  useEffect(() => {
    if (!showOutputs) return;
    let cancelled = false;
    void (async () => {
      const el = getElectron();
      const [ws, overlay, org] = await Promise.all([
        el?.files.list(cwd),
        el?.files.list(`${cwd}/.concourse`),
        orgDir ? el?.files.list(orgDir) : Promise.resolve(undefined),
      ]);
      if (cancelled) return;
      // Everything the AI generates is reachable from this panel: deliverables
      // (outputs/), the knowledge it saved here (facts + notes), and the
      // org-wide facts every project shares. Run records stay out — they're
      // an audit trail, not files users reach for.
      const wanted = (f: string) =>
        (f.startsWith("outputs/") ||
          f.startsWith("knowledge/facts/") ||
          f.startsWith("knowledge/notes/") ||
          f.startsWith("knowledge/projects/")) &&
        // No OS/hidden litter (.DS_Store and friends) in any path segment.
        !f.split("/").some((seg) => seg.startsWith("."));
      // Attachments only count from the .concourse overlay — a repo's own
      // top-level attachments/ folder is the project's business, not ours.
      const wantedOverlay = (f: string) =>
        wanted(f) ||
        (f.startsWith("attachments/") && !f.split("/").some((seg) => seg.startsWith(".")));
      const a = ws?.ok ? ws.files.filter(wanted) : [];
      const b = overlay?.ok
        ? overlay.files.filter(wantedOverlay).map((f) => `.concourse/${f}`)
        : [];
      const c = org?.ok
        ? org.files
            .filter((f) => f.startsWith("facts/") && f.endsWith(".md"))
            .map((f) => `org-knowledge/${f}`)
        : [];
      const [wsStat, orgStat] = await Promise.all([
        a.length + b.length > 0 ? el?.files.stat(cwd, [...a, ...b]) : undefined,
        orgDir && c.length > 0
          ? el?.files.stat(orgDir, c.map((f) => f.slice("org-knowledge/".length)))
          : undefined,
      ]);
      if (cancelled) return;
      const mtimes: Record<string, number> = {};
      if (wsStat?.ok) Object.assign(mtimes, wsStat.mtimes);
      if (orgStat?.ok) {
        for (const [rel, m] of Object.entries(orgStat.mtimes)) {
          mtimes[`org-knowledge/${rel}`] = m;
        }
      }
      setOutputFiles([...a, ...b, ...c]);
      setOutputMtimes(mtimes);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showOutputs, cwd, orgDir, items.length]);
  const visibleOutputs =
    outputsScope === "session"
      ? outputFiles.filter((f) => (outputMtimes[f] ?? 0) >= sessionStartMs)
      : outputFiles;
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
      // Markdown AND images render in the side panel; everything else opens
      // in the OS default app.
      if (!/\.(md|markdown|png|jpe?g|gif|webp|bmp|ico)$/i.test(rel)) {
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
        <Btn variant="ghost" icon="plus" onClick={onNewSession}>
          New session
        </Btn>
        <Btn variant="ghost" icon="folder" onClick={() => setShowOutputs((v) => !v)}>
          Outputs
        </Btn>
        <div ref={menuRef} style={{ position: "relative" }}>
          <Btn
            variant="ghost"
            icon="more"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Chat actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {""}
          </Btn>
          {menuOpen && (
            <CardFrame
              role="menu"
              solid
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                minWidth: 230,
                zIndex: 60,
                boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
              }}
            >
              <DropdownMenuItem
                icon="upload"
                onClick={() => {
                  setMenuOpen(false);
                  chatStore.send(sessionId, buildHandoffPrompt(), {
                    displayText: HANDOFF_DISPLAY_TEXT,
                  });
                }}
              >
                Handoff to a teammate
              </DropdownMenuItem>
              <DropdownMenuItem
                icon="sparkles"
                onClick={() => {
                  setMenuOpen(false);
                  chatStore.send(sessionId, buildMakeWorkflowPrompt(), {
                    displayText: MAKE_WORKFLOW_DISPLAY_TEXT,
                  });
                }}
              >
                Make this a workflow
              </DropdownMenuItem>
            </CardFrame>
          )}
        </div>
        <Btn variant="ghost" icon="x" onClick={onClose} aria-label="Close chat" />
      </div>

      {/* Body: chat column + optional markdown preview panel */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div
        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
      {dragOver && (
        <div
          style={{
            position: "absolute",
            inset: 8,
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-lg)",
            border: "2px dashed var(--accent)",
            background: "var(--accent-faint, rgba(0,0,0,0.25))",
            pointerEvents: "none",
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--accent)",
          }}
        >
          Drop files to attach
        </div>
      )}
      {/* Messages */}
      {restoring && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: "var(--surface-0)",
          }}
        >
          <Icon
            name="refresh"
            size={18}
            style={{ color: "var(--text-dim)", animation: "spin 1s linear infinite" }}
          />
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Loading conversation…</div>
        </div>
      )}
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
          onPaste={(e) => {
            // A copied image (screenshot in the clipboard) becomes a pending
            // attachment, exactly like the upload button or drag-and-drop.
            const hasImage = Array.from(e.clipboardData?.items ?? []).some((it) =>
              it.type.startsWith("image/"),
            );
            if (!hasImage) return;
            e.preventDefault();
            void (async () => {
              const el = getElectron();
              const saved = await el?.terminalImages.saveClipboard();
              if (!saved || "error" in saved) return;
              const described = (await el?.attachments.describe([saved.path])) ?? [];
              if (described.length) setPending((cur) => [...cur, ...described]);
            })();
          }}
          placeholder={
            permission
              ? "Approve or deny above to continue…"
              : session?.interrupted
                ? "Stopped — tell me what to do next…"
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
        <Btn
          variant="ghost"
          icon="shield"
          onClick={() =>
            chatStore.setDangerouslySkipApprovals(sessionId, !session?.dangerouslySkipApprovals)
          }
          aria-label="Toggle auto-approve (dangerously skip all approvals)"
          aria-pressed={session?.dangerouslySkipApprovals ?? false}
          title={
            session?.dangerouslySkipApprovals
              ? "Auto-approve is ON — writes, commands, and external actions run without asking (commands using ungranted credentials still stop). Click to require approvals again."
              : "Dangerously skip approvals: the agent runs writes, commands, and external actions without stopping to ask. Commands using ungranted credentials still require approval. Applies from the next action."
          }
          style={
            session?.dangerouslySkipApprovals
              ? { color: "var(--status-needs, #e0a04d)" }
              : undefined
          }
        >
          {session?.dangerouslySkipApprovals ? "Auto" : ""}
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
            <span style={{ fontSize: 13, fontWeight: 600 }}>Outputs &amp; knowledge</span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
              {(["session", "all"] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setOutputsScope(scope)}
                  title={
                    scope === "session"
                      ? "Files this session created or updated"
                      : "Every output & fact in the project"
                  }
                  style={{
                    border: "1px solid var(--border)",
                    background: outputsScope === scope ? "var(--surface-1)" : "transparent",
                    color: outputsScope === scope ? "var(--text)" : "var(--text-faint)",
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    padding: "3px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  {scope === "session" ? "Session" : "All"}
                </button>
              ))}
            </div>
            <Btn variant="ghost" icon="x" onClick={() => setShowOutputs(false)} aria-label="Close outputs" />
          </div>
          <div style={{ overflowY: "auto", padding: 8, flex: 1 }}>
            {visibleOutputs.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-faint)", padding: 8 }}>
                {outputsScope === "session"
                  ? "Nothing created by this session yet — switch to All for the project's files."
                  : "No files yet — deliverables land in outputs/<command>/, learned facts and handoff notes in knowledge/."}
              </div>
            )}
            {[...new Set(visibleOutputs.map(outputGroup))]
              .sort(
                (a, b) =>
                  Number(a.startsWith("knowledge")) - Number(b.startsWith("knowledge")) ||
                  a.localeCompare(b),
              )
              .map((group) => (
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
                {visibleOutputs
                  .filter((f) => outputGroup(f) === group)
                  .sort((x, y) => (outputMtimes[y] ?? 0) - (outputMtimes[x] ?? 0))
                  .map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        const isOrg = f.startsWith("org-knowledge/");
                        const root = isOrg && orgDir ? orgDir : cwd;
                        const rel = isOrg ? f.slice("org-knowledge/".length) : f;
                        if (/\.(md|markdown|png|jpe?g|gif|webp|bmp|ico)$/i.test(f)) setPreview({ root, rel });
                        // Other file types: reveal in Finder (user picks what opens it).
                        else void getElectron()?.revealPath(`${root}/${rel}`);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "none",
                        background: "transparent",
                        color: "var(--text)",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                      title={f}
                    >
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {(() => {
                          const p = f.replace(/^\.concourse\//, "");
                          if (p.startsWith("attachments/")) return p.slice("attachments/".length);
                          return p.split("/").slice(2).join("/") || f;
                        })()}
                      </span>
                      <FileDatesBadge updated={outputMtimes[f]} />
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

// Hover-revealed "copy as markdown" affordance beside a chat bubble — writes
// the bubble's raw markdown/text to the system clipboard.
function BubbleCopyBtn({ text, visible }: { text: string; visible: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <Btn
      variant="ghost"
      size="sm"
      icon={copied ? "check" : "copy"}
      aria-label="Copy message as markdown"
      title="Copy as markdown"
      onClick={() => {
        void getElectron()?.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      style={{
        width: 26,
        height: 26,
        padding: 0,
        flexShrink: 0,
        alignSelf: "flex-start",
        marginTop: 2,
        opacity: visible || copied ? 1 : 0,
        transition: "opacity 120ms",
        color: copied ? "var(--status-done)" : undefined,
      }}
    />
  );
}

function ChatBubble({
  item,
  onOpenFile,
}: {
  item: ChatItem;
  onOpenFile?: (path: string) => boolean;
}) {
  const [hovered, setHovered] = useState(false);
  if (item.type === "tool") {
    return (
      <div style={{ fontSize: 12, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="terminal" size={12} />
        {item.summary}
      </div>
    );
  }
  if (item.type === "notice") {
    return <div style={{ fontSize: 12.5, color: "var(--text-dim)", fontStyle: "italic" }}>{item.text}</div>;
  }
  const isUser = item.type === "user";
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        gap: 6,
        alignItems: "flex-start",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      {isUser && <BubbleCopyBtn text={item.text} visible={hovered} />}
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
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
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
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.18)",
                    whiteSpace: "nowrap",
                    alignSelf: "center",
                  }}
                >
                  📄 {a.name}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
      {!isUser && <BubbleCopyBtn text={item.text} visible={hovered} />}
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
