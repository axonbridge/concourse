import { Btn } from "~/components/ui/Btn";
import { Modal } from "~/components/ui/Modal";
import { TextField } from "~/components/ui/TextField";
import { StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import type { WorktreeInfo } from "~/shared/worktrees";
import { WorktreeChangeStat } from "./WorktreeChangeStat";
import {
  WORKTREE_DELETE_FILES_MAX_HEIGHT,
  formatWorktreeChangeStatus,
  worktreeChangeLabel,
  type DeleteWorktreeMode,
} from "./helpers";

// Delete-worktree confirmation. A clean worktree gets a single Delete; a
// dirty one blocks until the user reviews, stashes, or types the worktree
// name to confirm discarding its changes.
export function DeleteWorktreeDialog({
  open,
  worktree,
  dirty,
  statusPending,
  changeCount,
  stagedCount,
  unstagedCount,
  changedFiles,
  confirmName,
  onConfirmNameChange,
  discardConfirmMatches,
  deleting,
  onClose,
  onDelete,
  onReviewChanges,
}: {
  open: boolean;
  worktree: WorktreeInfo;
  dirty: boolean;
  /** Change count still loading — Delete stays disabled until it lands. */
  statusPending: boolean;
  changeCount: number | undefined;
  stagedCount: number;
  unstagedCount: number;
  changedFiles: Array<{ area: "staged" | "unstaged"; status: string; path: string }>;
  confirmName: string;
  onConfirmNameChange: (value: string) => void;
  discardConfirmMatches: boolean;
  deleting: boolean;
  onClose: () => void;
  onDelete: (mode: DeleteWorktreeMode) => void | Promise<void>;
  onReviewChanges: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={dirty ? "Delete dirty worktree" : "Delete worktree"}
      width={760}
      maxWidth="calc(100vw - 32px)"
      footerStyle={{ flexWrap: "nowrap", overflowX: "auto" }}
      footer={
        <>
          <StaticHotkeyTooltip hotkey="Esc">
            <Btn
              variant="ghost"
              onClick={onClose}
              disabled={deleting}
            >
              Cancel
            </Btn>
          </StaticHotkeyTooltip>
          {dirty ? (
            <>
              <Btn
                variant="ghost"
                icon="git-branch"
                onClick={onReviewChanges}
                disabled={deleting}
              >
                Review changes
              </Btn>
              <Btn
                variant="primary"
                icon="archive"
                onClick={() => void onDelete("stash")}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Stash and delete"}
              </Btn>
              <Btn
                variant="danger"
                icon="trash"
                onClick={() => void onDelete("discard")}
                disabled={deleting || !discardConfirmMatches}
              >
                Discard and delete
              </Btn>
            </>
          ) : (
            <Btn
              variant="danger"
              icon="trash"
              onClick={() => void onDelete("clean")}
              disabled={deleting || statusPending}
            >
              {statusPending
                ? "Checking..."
                : deleting
                  ? "Deleting..."
                  : "Delete"}
            </Btn>
          )}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13, color: "var(--text)" }}>
            Delete worktree &ldquo;{worktree.name}&rdquo;?
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Concourse will remove this worktree folder. The branch is kept.
          </div>
        </div>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface-0)",
            padding: "9px 11px",
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: "var(--text-dim)",
            lineHeight: 1.45,
            wordBreak: "break-all",
          }}
        >
          {worktree.path}
        </div>

        {statusPending && (
          <div
            role="status"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface-0)",
              padding: "9px 11px",
              color: "var(--text-dim)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            Checking for uncommitted changes before delete is enabled.
          </div>
        )}

        {dirty && (
          <>
            <div
              style={{
                border: "1px solid color-mix(in srgb, var(--status-failed) 45%, transparent)",
                borderRadius: 8,
                background: "color-mix(in srgb, var(--status-failed) 10%, transparent)",
                padding: "10px 12px",
                color: "var(--text)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              This worktree has {worktreeChangeLabel(changeCount)}.
              Review them, stash them before deletion, or type the worktree name to discard them.
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 8,
              }}
            >
              <WorktreeChangeStat
                label="Staged"
                count={stagedCount}
              />
              <WorktreeChangeStat
                label="Unstaged"
                count={unstagedCount}
              />
            </div>
            {changedFiles.length > 0 && (
              <div
                role="region"
                aria-label="Changed files in worktree"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--surface-0)",
                  maxHeight: WORKTREE_DELETE_FILES_MAX_HEIGHT,
                  overflowX: "hidden",
                  overflowY: "auto",
                }}
              >
                {changedFiles.map((file, index) => (
                  <div
                    key={`${file.area}:${file.status}:${file.path}:${index}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "92px minmax(0, 1fr)",
                      gap: 10,
                      padding: "7px 10px",
                      borderTop: index === 0 ? 0 : "1px solid var(--border)",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      lineHeight: 1.35,
                    }}
                  >
                    <span style={{ color: "var(--text-faint)" }}>
                      {formatWorktreeChangeStatus(file.area, file.status)}
                    </span>
                    <span style={{ color: "var(--text-dim)", wordBreak: "break-all" }}>
                      {file.path}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <TextField
              label="Discard confirmation"
              value={confirmName}
              onChange={onConfirmNameChange}
              placeholder={worktree.name}
              mono
              hint={`Type ${worktree.name} to enable Discard and delete.`}
              ariaLabel={`Type ${worktree.name} to discard changes and delete the worktree`}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
