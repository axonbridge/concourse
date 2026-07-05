import { useState } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
import { useDeleteBranch, useGitBranches, useGitStatus } from "~/queries/git";
import { DEFAULT_BRANCH } from "~/shared/domain";

// Manage (delete) branches from the review header's gear. Deletion is
// remote-first best-effort: a remote branch is deleted when possible, the
// local branch is force-deleted regardless. Deleting the checked-out branch
// switches to the default branch first; pending changes either travel along
// or are discarded — the user chooses.

export function BranchManagerDialog({
  projectId,
  worktreeId,
  open,
  onClose,
}: {
  projectId: string;
  worktreeId?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: branches } = useGitBranches(projectId, worktreeId, { enabled: open });
  const { data: status } = useGitStatus(projectId, worktreeId, { enabled: open });
  const deleteM = useDeleteBranch(projectId, worktreeId);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [discardChanges, setDiscardChanges] = useState(false);

  const current = branches?.current ?? status?.branch ?? "";
  const dirty = (status?.changedCount ?? 0) > 0;
  const locals = (branches?.branches ?? []).filter((b) => b.local);

  const runDelete = (branch: string) => {
    deleteM.mutate(
      { branch, discardChanges: branch === current && dirty ? discardChanges : undefined },
      {
        onSuccess: (r) => {
          const parts = [
            r.remoteDeleted === null
              ? "no remote branch"
              : r.remoteDeleted
                ? "remote deleted"
                : "remote delete failed — local removed anyway",
            "local deleted",
          ];
          if (r.switchedTo) parts.unshift(`switched to ${r.switchedTo}`);
          toast.success(`Deleted ${branch} (${parts.join(", ")})`);
          setConfirming(null);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Manage branches" width={520}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 420, overflow: "auto" }}>
        {locals.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "8px 2px" }}>
            {branches ? "No local branches." : "Loading branches…"}
          </div>
        )}
        {locals.map((b) => {
          const isCurrent = b.name === current;
          const isDefault = b.name === DEFAULT_BRANCH;
          const isConfirming = confirming === b.name;
          return (
            <div
              key={b.name}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${isConfirming ? "var(--status-failed)" : "var(--border)"}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="git-branch" size={12} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: "var(--mono)",
                    fontSize: 12.5,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={b.name}
                >
                  {b.name}
                </span>
                {isCurrent && <Badge label="current" color="var(--accent)" />}
                {b.remoteRef && <Badge label="remote" color="var(--text-faint)" />}
                {!isDefault && (
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    aria-label={`Delete branch ${b.name}`}
                    title={`Delete ${b.name}`}
                    disabled={deleteM.isPending}
                    onClick={() => {
                      setConfirming(isConfirming ? null : b.name);
                      setDiscardChanges(false);
                    }}
                    style={{ width: 28, height: 28, padding: 0 }}
                  />
                )}
              </div>
              {isConfirming && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 20 }}>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
                    {b.remoteRef
                      ? "Deletes the branch on the remote and locally."
                      : "Deletes the local branch."}{" "}
                    {isCurrent && `You're on this branch — it switches to ${DEFAULT_BRANCH} first.`}{" "}
                    This cannot be undone.
                  </div>
                  {isCurrent && dirty && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                        <input
                          type="radio"
                          checked={!discardChanges}
                          onChange={() => setDiscardChanges(false)}
                        />
                        Keep pending changes (they move to {DEFAULT_BRANCH})
                      </label>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                        <input
                          type="radio"
                          checked={discardChanges}
                          onChange={() => setDiscardChanges(true)}
                        />
                        Discard pending changes (cannot be undone)
                      </label>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                      Cancel
                    </Btn>
                    <Btn
                      variant="danger"
                      size="sm"
                      disabled={deleteM.isPending}
                      onClick={() => runDelete(b.name)}
                    >
                      {deleteM.isPending ? "Deleting…" : `Delete ${b.name}`}
                    </Btn>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        flexShrink: 0,
        fontFamily: "var(--mono)",
        fontSize: 10,
        padding: "1px 7px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        color,
      }}
    >
      {label}
    </span>
  );
}
