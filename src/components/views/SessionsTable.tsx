import { useMemo } from "react";
import type { Task } from "~/db/schema";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { StatusPill } from "~/components/ui/StatusDot";

// A compact table view of a project's sessions — the table counterpart to the
// card grid. Reuses the projects-table styling. Sorted by most-recent activity.
export function SessionsTable({
  tasks,
  activeId,
  onOpen,
  onEdit,
  onTogglePinned,
  pinningTaskIds,
}: {
  tasks: readonly Task[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onEdit?: (task: Task) => void;
  onTogglePinned?: (id: string) => Promise<void> | void;
  pinningTaskIds?: ReadonlySet<string>;
}) {
  const rows = useMemo(
    () => [...tasks].sort((a, b) => b.updatedAt - a.updatedAt),
    [tasks],
  );

  return (
    <CardFrame className="mc-projects-table" style={{ width: "100%" }}>
      <div className="mc-projects-table-scroll">
        <table className="mc-projects-table-grid">
          <thead>
            <tr>
              <th scope="col" className="mc-projects-table-head">Session</th>
              <th scope="col" className="mc-projects-table-head">Description</th>
              <th scope="col" className="mc-projects-table-head">Status</th>
              <th scope="col" className="mc-projects-table-head">Last update</th>
              {onTogglePinned && (
                <th scope="col" className="mc-projects-table-pin-head">Pin</th>
              )}
              {onEdit && <th scope="col" className="mc-projects-table-pin-head">Edit</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((task) => {
              const subtitle = task.description?.trim() || task.preview?.trim() || "";
              return (
                <tr
                  key={task.id}
                  className="mc-projects-table-row"
                  data-active={activeId === task.id ? "true" : undefined}
                >
                  <td className="mc-projects-table-cell mc-projects-table-name">
                    <button
                      type="button"
                      onClick={() => onOpen(task.id)}
                      aria-label={`Open session ${task.title}`}
                      className="mc-projects-table-name-btn"
                    >
                      <span className="mc-projects-table-name-text">{task.title}</span>
                    </button>
                  </td>
                  <td className="mc-projects-table-cell">
                    <span
                      className={subtitle ? undefined : "mc-projects-table-muted"}
                      style={{
                        display: "block",
                        maxWidth: 360,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: subtitle ? "var(--text-dim)" : undefined,
                      }}
                    >
                      {subtitle || "—"}
                    </span>
                  </td>
                  <td className="mc-projects-table-cell">
                    <StatusPill status={task.status} />
                  </td>
                  <td className="mc-projects-table-cell mc-projects-table-date">
                    {formatRelative(task.updatedAt)}
                  </td>
                  {onTogglePinned && (
                    <td className="mc-projects-table-cell mc-projects-table-pin">
                      <Btn
                        size="sm"
                        variant={task.pinned ? "primary" : "ghost"}
                        icon={task.pinned ? "pin-fill" : "pin"}
                        disabled={pinningTaskIds?.has(task.id) ?? false}
                        onClick={() => void onTogglePinned(task.id)}
                        aria-label={task.pinned ? `Unpin ${task.title}` : `Pin ${task.title}`}
                        aria-pressed={task.pinned}
                        title={task.pinned ? "Unpin" : "Pin"}
                        style={{ width: 30, minWidth: 30, padding: 0, paddingInline: 0 }}
                      />
                    </td>
                  )}
                  {onEdit && (
                    <td className="mc-projects-table-cell mc-projects-table-pin">
                      <Btn
                        size="sm"
                        variant="ghost"
                        icon="pencil"
                        onClick={() => onEdit(task)}
                        aria-label={`Edit ${task.title}`}
                        title="Edit title & description"
                        style={{ width: 30, minWidth: 30, padding: 0, paddingInline: 0 }}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CardFrame>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
