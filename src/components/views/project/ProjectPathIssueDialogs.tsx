import { Btn } from "~/components/ui/Btn";
import { Modal } from "~/components/ui/Modal";
import { StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import type { ProjectPathStatus } from "~/shared/projects";

// The two "project path broken" modals: folder missing (repair / remove, or
// worktree variants) and path-check failed (retry). Shown over the project
// page whenever the path check invalidates the workspace.
export function ProjectPathIssueDialogs({
  issue,
  issueIsWorktree,
  checkErrorMessage,
  actionError,
  deletingWorktree,
  removingProject,
  repairingPath,
  retryingCheck,
  onClose,
  onDeleteWorktree,
  onSwitchToMain,
  onRemoveProject,
  onRepairPath,
  onRetryCheck,
}: {
  issue: Extract<ProjectPathStatus, { ok: false }> | null;
  issueIsWorktree: boolean;
  /** Non-null when the path check itself failed (network/exec error). */
  checkErrorMessage: string | null;
  actionError: string | null;
  deletingWorktree: boolean;
  removingProject: boolean;
  repairingPath: boolean;
  retryingCheck: boolean;
  onClose: () => void;
  onDeleteWorktree: () => void | Promise<void>;
  onSwitchToMain: () => void;
  onRemoveProject: () => void | Promise<void>;
  onRepairPath: () => void | Promise<void>;
  onRetryCheck: () => void | Promise<void>;
}) {
  return (
    <>
      <Modal
        open={!!issue}
        onClose={onClose}
        title={issueIsWorktree ? "Worktree folder missing" : "Project folder missing"}
        width={540}
        footer={
          <>
            <StaticHotkeyTooltip hotkey="Esc">
              <Btn
                variant="ghost"
                onClick={onClose}
              >
                Back to projects
              </Btn>
            </StaticHotkeyTooltip>
            {issueIsWorktree ? (
              <>
                <Btn
                  variant="danger"
                  icon="trash"
                  onClick={() => void onDeleteWorktree()}
                  disabled={deletingWorktree}
                >
                  {deletingWorktree ? "Deleting..." : "Delete worktree"}
                </Btn>
                <Btn
                  variant="primary"
                  icon="folder"
                  onClick={onSwitchToMain}
                  disabled={deletingWorktree}
                >
                  Switch to main
                </Btn>
              </>
            ) : (
              <>
                <Btn
                  variant="danger"
                  icon="trash"
                  onClick={() => void onRemoveProject()}
                  disabled={repairingPath || removingProject}
                >
                  {removingProject ? "Removing..." : "Remove project"}
                </Btn>
                <Btn
                  variant="primary"
                  icon="folder"
                  onClick={() => void onRepairPath()}
                  disabled={repairingPath || removingProject}
                >
                  {repairingPath ? "Updating..." : "Choose new folder"}
                </Btn>
              </>
            )}
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)" }}>
            {issue?.message ?? "Concourse cannot find this project folder."}
            {" "}
            {issueIsWorktree
              ? "Switch back to the main project folder, or delete this missing worktree."
              : "Choose the folder in its new location, or remove the project from Concourse."}
          </div>
          {actionError && (
            <div
              style={{
                border: "1px solid color-mix(in srgb, var(--status-failed) 55%, transparent)",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--status-failed) 12%, transparent)",
                color: "var(--status-failed)",
                padding: "9px 11px",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                lineHeight: 1.45,
              }}
            >
              {actionError}
            </div>
          )}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--surface-0)",
              padding: "10px 12px",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--text-dim)",
              lineHeight: 1.45,
              wordBreak: "break-all",
            }}
          >
            {issue?.path}
          </div>
        </div>
      </Modal>

      <Modal
        open={checkErrorMessage !== null}
        onClose={onClose}
        title="Could not check project folder"
        width={500}
        footer={
          <>
            <StaticHotkeyTooltip hotkey="Esc">
              <Btn variant="ghost" onClick={onClose}>
                Back to projects
              </Btn>
            </StaticHotkeyTooltip>
            <Btn
              variant="primary"
              icon="refresh"
              onClick={() => void onRetryCheck()}
              disabled={retryingCheck}
            >
              {retryingCheck ? "Checking..." : "Retry"}
            </Btn>
          </>
        }
      >
        <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)" }}>
          {checkErrorMessage ?? "Concourse could not verify this project path."}
        </div>
      </Modal>
    </>
  );
}
