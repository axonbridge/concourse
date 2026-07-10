import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { BranchTypeahead } from "~/components/views/BranchTypeahead";
import type { WorktreeInfo } from "~/shared/worktrees";
import { worktreeScopeKey } from "~/shared/worktrees";
import { isOptimisticWorktree } from "./helpers";

export function WorktreeToggleGroup({
  worktrees,
  selectedId,
  runningKeys,
  projectId,
  onSelect,
  onDeleteSelected,
  mainBranchLabel,
  mainBranchUnavailable = false,
  mainBranchUnavailableTitle,
  branchSwitchDisabled = false,
  maxWidth = 420,
}: {
  worktrees: WorktreeInfo[];
  selectedId: string;
  runningKeys: ReadonlySet<string>;
  projectId: string;
  onSelect: (id: string) => void;
  onDeleteSelected?: (worktree: WorktreeInfo) => void;
  /** Live git branch for the main worktree — shown instead of the "main" id. */
  mainBranchLabel?: string | null;
  mainBranchUnavailable?: boolean;
  mainBranchUnavailableTitle?: string;
  branchSwitchDisabled?: boolean;
  maxWidth?: number | string;
}) {
  const items = worktrees.length > 0 ? worktrees : [];
  const selectableItems = items.filter((worktree) => !isOptimisticWorktree(worktree));
  if (items.length === 0) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Project worktrees"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        maxWidth,
        overflowX: "auto",
        overflowY: "visible",
        padding: 2,
        flexShrink: 1,
      }}
    >
      {items.map((worktree) => {
        const selected = worktree.id === selectedId;
        const optimistic = isOptimisticWorktree(worktree);
        const worktreeKey = worktreeScopeKey(projectId, worktree.isMain ? null : worktree.id);
        const running = [...runningKeys].some(
          (key) => key === worktreeKey || key.startsWith(`${worktreeKey}:`),
        );
        const canDelete = selected && !worktree.isMain && !optimistic && !!onDeleteSelected;
        const label = worktree.isMain ? "main" : worktree.name;
        return (
          worktree.isMain && selected ? (
            <div
              key={worktree.id}
              role="none"
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              {running && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: -4,
                    left: "50%",
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--accent)",
                    transform: "translateX(-50%)",
                    boxShadow: "0 0 6px var(--accent-glow)",
                    zIndex: 1,
                  }}
                />
              )}
              {mainBranchUnavailable ? (
                <Btn
                  variant="ghost"
                  icon="git-branch"
                  disabled
                  title={mainBranchUnavailableTitle ?? "Git unavailable"}
                  style={{
                    fontFamily: "var(--mono)",
                    maxWidth: "min(36ch, 42vw)",
                    color: "var(--text-dim)",
                  }}
                >
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    No Git repo
                  </span>
                </Btn>
              ) : (
                <BranchTypeahead
                  projectId={projectId}
                  worktreeId={null}
                  branch={mainBranchLabel}
                  disabled={branchSwitchDisabled}
                  worktreePath={worktree.path}
                  selected
                />
              )}
            </div>
          ) : (
          <div
            key={worktree.id}
            role="none"
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              height: 28,
              borderRadius: 999,
              border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
              background: selected ? "var(--accent-faint)" : "var(--surface-0)",
              color: selected ? "var(--accent)" : "var(--text-dim)",
              fontFamily: "var(--mono)",
              fontSize: 11,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {running && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: -4,
                  left: "50%",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  transform: "translateX(-50%)",
                  boxShadow: "0 0 6px var(--accent-glow)",
                }}
              />
            )}
            <button
              type="button"
              role="radio"
              disabled={optimistic}
              onClick={() => onSelect(worktree.id)}
              onKeyDown={(event) => {
                if (optimistic) return;
                if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
                event.preventDefault();
                const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
                const currentIndex = selectableItems.findIndex((item) => item.id === worktree.id);
                const next = selectableItems[
                  (currentIndex + direction + selectableItems.length) % selectableItems.length
                ];
                if (next) onSelect(next.id);
              }}
              aria-label={`Switch to worktree ${worktree.isMain ? label : worktree.name}`}
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              title={
                optimistic
                  ? "Creating worktree..."
                  : worktree.isMain
                    ? `${worktree.path}${mainBranchLabel ? ` · branch ${mainBranchLabel}` : ""}`
                    : worktree.path
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: "100%",
                padding: canDelete ? "0 8px 0 10px" : "0 10px",
                border: 0,
                borderRadius: canDelete ? "999px 0 0 999px" : 999,
                background: "transparent",
                color: "inherit",
                font: "inherit",
                whiteSpace: "nowrap",
                cursor: optimistic ? "default" : "pointer",
                opacity: optimistic ? 0.68 : 1,
              }}
            >
              {label}
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => onDeleteSelected?.(worktree)}
                aria-label={`Delete worktree ${worktree.name}`}
                title={`Delete worktree ${worktree.name}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  alignSelf: "stretch",
                  padding: 0,
                  border: 0,
                  borderLeft: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
                  borderRadius: "0 999px 999px 0",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  opacity: 0.78,
                }}
              >
                <Icon name="trash" size={10} />
              </button>
            )}
          </div>
          )
        );
      })}
    </div>
  );
}
