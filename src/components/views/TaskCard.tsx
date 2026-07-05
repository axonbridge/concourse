import { useEffect, useRef, useState } from "react";
import { CardFrame } from "~/components/ui/CardFrame";
import { ShimmerBar } from "~/components/ui/ShimmerBar";
import { Btn } from "~/components/ui/Btn";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { AgentLogo } from "~/components/ui/AgentLogo";
import { SessionAvatar } from "~/components/ui/SessionAvatar";
import { useDiagrams } from "~/lib/use-diagram-events";
import { AGENT_META, STATUS_META } from "~/lib/design-meta";
import { isSentinelTitle } from "~/lib/task-sentinels";
import type { Task } from "~/db/schema";

export function TaskCard({
  task,
  selected,
  onToggle,
  onArchive,
  onRestore,
  onDelete,
  onRename,
  onEdit,
  onTogglePinned,
  pinning = false,
}: {
  task: Task;
  selected: boolean;
  onToggle: (taskId: string) => void;
  /** Archive an active session (soft, no confirmation, kills the tty). */
  onArchive?: (taskId: string) => void;
  /** Restore an archived session back to the active list. */
  onRestore?: (taskId: string) => void;
  /** Permanently delete a session (confirmed, irreversible). */
  onDelete?: (taskId: string) => void;
  /** Rename a session title inline. */
  onRename?: (taskId: string, title: string) => Promise<void> | void;
  /** Open the edit dialog to change the session's title + description. */
  onEdit?: (task: Task) => void;
  /** Pin or unpin an active session. */
  onTogglePinned?: (taskId: string) => Promise<void> | void;
  /** True while the pin/unpin mutation for this session is saving. */
  pinning?: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const savingTitleRef = useRef(false);
  const restoreTitleFocusRef = useRef(false);
  const skipNextBlurCommitRef = useRef(false);
  const { hasDiagram, openDiagram } = useDiagrams();
  const taskHasDiagram = hasDiagram(task.id);

  const meta = AGENT_META[task.agent];
  const statusMeta = STATUS_META[task.status];
  const isRunning = task.status === "running";

  // Archived sessions are parked (their tty was killed on archive), but the
  // card is still openable: clicking it reloads/resumes the session terminal.
  // The top-right actions swap delete → restore + permanent delete.
  const archived = task.archived;

  const sentinel = isSentinelTitle(task.title);
  const updated = formatRelative(task.updatedAt);
  const toggleTask = () => onToggle(task.id);

  useEffect(() => {
    if (!editingTitle) setTitleDraft(task.title);
  }, [editingTitle, task.title]);

  useEffect(() => {
    if (!editingTitle && restoreTitleFocusRef.current) {
      restoreTitleFocusRef.current = false;
    }
  }, [editingTitle]);

  const startTitleEdit = () => {
    if (!onRename) return;
    setTitleDraft(task.title);
    setEditingTitle(true);
  };

  const cancelTitleEdit = (restoreFocus = true) => {
    skipNextBlurCommitRef.current = restoreFocus;
    restoreTitleFocusRef.current = restoreFocus;
    setTitleDraft(task.title);
    setEditingTitle(false);
  };

  const commitTitleEdit = async ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
    if (!onRename || savingTitleRef.current) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      cancelTitleEdit(restoreFocus);
      return;
    }
    if (nextTitle === task.title) {
      skipNextBlurCommitRef.current = restoreFocus;
      restoreTitleFocusRef.current = restoreFocus;
      setEditingTitle(false);
      return;
    }

    savingTitleRef.current = true;
    setSavingTitle(true);
    try {
      await onRename(task.id, nextTitle);
      skipNextBlurCommitRef.current = restoreFocus;
      restoreTitleFocusRef.current = restoreFocus;
      setEditingTitle(false);
    } catch {
      // The route-level rename handler restores cache and shows the toast.
    } finally {
      savingTitleRef.current = false;
      setSavingTitle(false);
    }
  };

  // Subtitle: a user-set description wins; otherwise the live preview line;
  // otherwise a status hint.
  const subtitle = task.description?.trim() || task.preview?.trim() || statusMeta.label;

  return (
    <CardFrame
      glow
      focused={selected || hovered}
      style={{
        width: "100%",
        cursor: "pointer",
        transition: "box-shadow 0.15s, background 0.15s",
        // Keep the card's internal z-index layers below page-level overlays.
        zIndex: 0,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ShimmerBar active={isRunning} color={meta?.color} />
      <button
        type="button"
        onClick={toggleTask}
        aria-label={`${selected ? "Close" : "Open"} terminal for ${task.title}`}
        aria-pressed={selected}
        disabled={editingTitle}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          background: "transparent",
          border: 0,
          padding: 0,
          margin: 0,
          cursor: editingTitle ? "default" : "pointer",
          borderRadius: "inherit",
        }}
      />

      {/* Agent brand watermark — faint, right side, decorative only. */}
      <div
        aria-hidden
        style={
          task.agent === "opencode"
            ? {
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                width: 96,
                height: 120,
                backgroundImage: "url('/opencode.svg')",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                backgroundSize: "contain",
                opacity: 0.09,
                pointerEvents: "none",
                zIndex: 0,
              }
            : {
                position: "absolute",
                right: -10,
                top: "50%",
                transform: "translateY(-50%)",
                color: meta?.color ?? "var(--text)",
                opacity: 0.09,
                pointerEvents: "none",
                zIndex: 0,
                lineHeight: 0,
              }
        }
      >
        {task.agent !== "opencode" ? <AgentLogo agent={task.agent} size={140} /> : null}
      </div>

      <div
        style={{
          padding: 14,
          display: "flex",
          alignItems: "stretch",
          gap: 14,
          position: "relative",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        {/* Left icon tile + status dot; click to customize (image/letters/icon/color). */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            title={onEdit ? "Edit session (title, icon, image)" : undefined}
            aria-label={`Edit ${task.title}`}
            disabled={!onEdit}
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.(task);
            }}
            style={{
              all: "unset",
              cursor: onEdit ? "pointer" : "default",
              display: "block",
              pointerEvents: "auto",
            }}
          >
            <SessionAvatar task={task} size={56} />
          </button>
          {statusMeta.dot && (
            <span
              style={{
                position: "absolute",
                top: -3,
                left: -3,
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: statusMeta.color,
                border: "2px solid var(--surface-0)",
                boxShadow: isRunning ? `0 0 8px ${statusMeta.color}` : "none",
                animation: isRunning ? "pulse-dot 1.6s ease-in-out infinite" : "none",
              }}
            />
          )}
        </div>

        {/* Right: title / subtitle / meta row */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {editingTitle ? (
            <input
              autoFocus
              aria-label={`Rename session ${task.title}`}
              value={titleDraft}
              readOnly={savingTitle}
              aria-disabled={savingTitle}
              onChange={(e) => setTitleDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => {
                if (skipNextBlurCommitRef.current) {
                  skipNextBlurCommitRef.current = false;
                  return;
                }
                void commitTitleEdit({ restoreFocus: false });
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitTitleEdit({ restoreFocus: true });
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelTitleEdit();
                }
              }}
              style={{
                pointerEvents: "auto",
                width: "calc(100% - 36px)",
                minWidth: 0,
                border: "1px solid var(--accent)",
                borderRadius: 7,
                background: "var(--surface-0)",
                color: "var(--text)",
                font: "inherit",
                fontSize: 14.5,
                fontWeight: 600,
                lineHeight: 1.3,
                padding: "2px 6px",
                outline: "none",
              }}
            />
          ) : onRename ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                width: "calc(100% - 36px)",
                minHeight: 24,
                minWidth: 0,
              }}
            >
              <div
                title="Double-click to rename"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startTitleEdit();
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: sentinel ? "var(--text-dim)" : "var(--text)",
                  fontSize: 14.5,
                  fontWeight: 600,
                  fontStyle: sentinel ? "italic" : "normal",
                  lineHeight: 1.3,
                  overflow: "hidden",
                  padding: "2px 0",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  pointerEvents: "auto",
                }}
              >
                {task.title}
              </div>
            </div>
          ) : (
            <div
              style={{
                fontSize: 14.5,
                fontWeight: 600,
                lineHeight: 1.3,
                color: sentinel ? "var(--text-dim)" : "var(--text)",
                fontStyle: sentinel ? "italic" : "normal",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                paddingRight: 36,
              }}
            >
              {task.title}
            </div>
          )}

          <div
            style={{
              fontSize: 12.5,
              color: "var(--text-dim)",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontStyle:
                task.description?.trim() || task.preview?.trim() ? "normal" : "italic",
            }}
          >
            {subtitle}
            {isRunning && task.preview?.trim() && (
              <span
                style={{
                  marginLeft: 2,
                  animation: "caret 1s infinite",
                  color: meta?.color,
                }}
              >
                ▊
              </span>
            )}
          </div>

          <div
            style={{
              marginTop: 4,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--text-faint)",
            }}
          >
            {updated}
          </div>
        </div>

        {/* Top-right session actions */}
        {(onEdit || onTogglePinned || onArchive || onRestore || onDelete) && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
              pointerEvents: "auto",
              zIndex: 3,
            }}
          >
            {onEdit && (
              <Btn
                variant="ghost"
                size="sm"
                icon="pencil"
                disabled={savingTitle}
                aria-label={`Edit ${task.title}`}
                title="Edit title & description"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task);
                }}
                style={{ width: 30, height: 30, padding: 0 }}
              />
            )}
            {!archived && onTogglePinned && (
              <Btn
                variant="ghost"
                size="sm"
                icon={task.pinned ? "pin-fill" : "pin"}
                disabled={savingTitle || pinning}
                aria-busy={pinning}
                aria-label={`${task.pinned ? "Unpin" : "Pin"} ${task.title}`}
                title={pinning ? "Saving pin state" : task.pinned ? "Unpin session" : "Pin session"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (savingTitle || pinning) return;
                  void onTogglePinned(task.id);
                }}
                style={{
                  width: 30,
                  height: 30,
                  padding: 0,
                  color: task.pinned ? "var(--accent)" : undefined,
                }}
              />
            )}
            {archived && onRestore && (
              <Btn
                variant="ghost"
                size="sm"
                icon="refresh"
                disabled={savingTitle}
                aria-label={`Restore ${task.title}`}
                title="Restore session"
                onClick={(e) => {
                  e.stopPropagation();
                  if (savingTitle) return;
                  onRestore(task.id);
                }}
                style={{ width: 30, height: 30, padding: 0 }}
              />
            )}
            {!archived && onArchive && (
              <HotkeyTooltip
                action="session.closeWindow"
                label="Archive session"
                disabled={!selected}
              >
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="archive"
                  disabled={savingTitle}
                  aria-label={`Archive ${task.title}`}
                  title={selected ? undefined : "Archive session"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (savingTitle) return;
                    // Running sessions lose the live terminal + agent on
                    // archive, so confirm first; parked ones archive silently.
                    if (isRunning) setConfirmArchiveOpen(true);
                    else onArchive(task.id);
                  }}
                  style={{ width: 30, height: 30, padding: 0 }}
                />
              </HotkeyTooltip>
            )}
            {onDelete && (
              <HotkeyTooltip
                action="session.closeWindow"
                label="Delete session"
                disabled={!selected}
              >
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  disabled={savingTitle}
                  aria-label={`Delete ${task.title}`}
                  title={selected ? undefined : "Delete session"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (savingTitle) return;
                    setConfirmOpen(true);
                  }}
                  style={{ width: 30, height: 30, padding: 0 }}
                />
              </HotkeyTooltip>
            )}
          </div>
        )}

        {(taskHasDiagram ||
          task.status === "needs-input" ||
          task.status === "interrupted") && (
          <div
            style={{
              position: "absolute",
              bottom: 10,
              right: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
              pointerEvents: "auto",
              zIndex: 3,
            }}
          >
            {taskHasDiagram && (
              <Btn
                size="sm"
                variant="ghost"
                icon="chart"
                title="View session diagram"
                aria-label="View session diagram"
                onClick={(e) => {
                  e.stopPropagation();
                  void openDiagram(task.id);
                }}
              >
                Diagram
              </Btn>
            )}
            {(task.status === "needs-input" || task.status === "interrupted") && (
              <Btn
                size="sm"
                variant="accent"
                icon="terminal"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTask();
                }}
              >
                Reply
              </Btn>
            )}
          </div>
        )}

      </div>

      {onArchive && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            open={confirmArchiveOpen}
            onClose={() => setConfirmArchiveOpen(false)}
            onConfirm={() => {
              onArchive(task.id);
              setConfirmArchiveOpen(false);
            }}
            title="Archive running session?"
            confirmLabel="Archive"
            variant="danger"
            icon="archive"
            width={420}
          >
            <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 6 }}>
              &ldquo;{task.title}&rdquo; is still running.
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              Archiving disconnects its terminal and stops the in-progress agent.
              You can restore the session later, but the current run won&rsquo;t
              resume.
            </div>
          </ConfirmDialog>
        </div>
      )}

      {onDelete && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onConfirm={() => {
              onDelete(task.id);
              setConfirmOpen(false);
            }}
            title="Delete task"
            confirmLabel="Delete"
            icon="trash"
            width={420}
          >
            <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 6 }}>
              Delete &ldquo;{task.title}&rdquo;?
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              This task and its worktree will be removed. This cannot be undone.
            </div>
          </ConfirmDialog>
        </div>
      )}

    </CardFrame>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
