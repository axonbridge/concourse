import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Btn } from "~/components/ui/Btn";
import { VOICE_SHIP_EVENT } from "~/lib/voice-events";
import { mcToastCustom, McToastCloseButton } from "~/lib/mc-toast";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon } from "~/components/ui/Icon";
import { ApiError } from "~/lib/api";
import { Modal } from "~/components/ui/Modal";
import { api } from "~/lib/api";
import { useGitCommit, useGitPush, useGitStatus } from "~/queries/git";
import { isCommitCli, type CommitCli } from "~/shared/commit-cli";
import {
  beginShipOperation,
  endShipOperation,
  getProjectShipPhase,
  isProjectShipping,
  setShipPhase,
  subscribeShipOperations,
} from "~/lib/ship-operations";
import {
  ShipFailedDialog,
  SHIP_FAILED_INITIAL,
  type ShipFailedDialogState,
} from "./ShipFailedDialog";

function useProjectShipping(projectId: string, worktreeId?: string | null) {
  return useSyncExternalStore(
    subscribeShipOperations,
    () => isProjectShipping(projectId, worktreeId),
    () => false,
  );
}

function useProjectShipPhase(projectId: string, worktreeId?: string | null) {
  return useSyncExternalStore(
    subscribeShipOperations,
    () => getProjectShipPhase(projectId, worktreeId),
    () => null,
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-flex",
        animation: "spin 0.8s linear infinite",
      }}
    >
      <Icon name="refresh" size={11} />
    </span>
  );
}

type CommitCliFailure = {
  cli: CommitCli | null;
  message: string;
  stderr?: string;
  kind: "commit-generation-failed" | "no-commit-cli";
};

/** Pull the typed commit-failure payload out of an ApiError body, if present.
 * Returns null when the error isn't an AI-generation failure so the caller
 * falls back to the existing toast/banner path. */
function readCommitCliFailure(error: unknown): CommitCliFailure | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (!body || typeof body !== "object") return null;
  const kind = (body as { kind?: unknown }).kind;
  if (kind !== "commit-generation-failed" && kind !== "no-commit-cli") return null;
  const rawCli = (body as { cli?: unknown }).cli;
  const stderrRaw = (body as { stderr?: unknown }).stderr;
  const messageRaw = (body as { error?: unknown }).error;
  return {
    cli: isCommitCli(rawCli) ? rawCli : null,
    message: typeof messageRaw === "string" ? messageRaw : error.message,
    stderr: typeof stderrRaw === "string" ? stderrRaw : undefined,
    kind,
  };
}

/** Used when a parent didn't pass `onError` — surfaces failures through the
 * same sonner channel as the success path so the user never sees a Ship
 * spinner stop with no follow-up. */
function showShipErrorToast(title: string, detail: string) {
  mcToastCustom(
    (toastId) => (
      <CardFrame
        solid
        style={{
          position: "relative",
          minWidth: 320,
          maxWidth: 460,
          padding: "14px 96px 14px 16px",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "color-mix(in srgb, var(--status-failed) 22%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--status-failed) 50%, transparent)",
            color: "var(--status-failed)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="x" size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 13 }}>
            {title}
          </div>
          <div
            title={detail}
            style={{
              color: "var(--text-faint)",
              fontSize: 12,
              marginTop: 2,
              whiteSpace: "pre-wrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {detail}
          </div>
        </div>
        <McToastCloseButton toastId={toastId} />
      </CardFrame>
    ),
    { duration: 8000 },
  );
}

function showShipToast(title: string, detail: string) {
  mcToastCustom(
    (toastId) => (
      <CardFrame
        solid
        style={{
          position: "relative",
          minWidth: 320,
          maxWidth: 460,
          padding: "14px 96px 14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "color-mix(in srgb, var(--accent) 22%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 50%, transparent)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="check" size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 13 }}>
            {title}
          </div>
          <div
            title={detail}
            style={{
              color: "var(--text-faint)",
              fontSize: 12,
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {detail}
          </div>
        </div>
        <McToastCloseButton toastId={toastId} />
      </CardFrame>
    ),
    { duration: 5000 },
  );
}

export function CommitPushButton({
  projectId,
  worktreeId,
  label = "Ship",
  title,
  autoStage = true,
  showAheadBadge = true,
  variant = "primary",
  size = "sm",
  splitTrailing = false,
  enabled = true,
  onError,
  onNotice,
}: {
  projectId: string;
  worktreeId?: string | null;
  label?: string;
  title?: string;
  autoStage?: boolean;
  showAheadBadge?: boolean;
  variant?: "primary" | "ghost" | "gray-frame";
  size?: "sm" | "md";
  /** Right segment of a pill-style split next to the Git status control (toolbar). */
  splitTrailing?: boolean;
  enabled?: boolean;
  onError?: (msg: string) => void;
  onNotice?: (msg: string) => void;
}) {
  const commitM = useGitCommit(projectId, worktreeId);
  const pushM = useGitPush(projectId, worktreeId);
  const { data: status } = useGitStatus(projectId, worktreeId, { enabled });
  const projectShipping = useProjectShipping(projectId, worktreeId);
  const shipPhase = useProjectShipPhase(projectId, worktreeId);
  const aheadCount = status?.aheadCount ?? null;
  const [shipFailed, setShipFailed] = useState<ShipFailedDialogState>(
    SHIP_FAILED_INITIAL,
  );
  // Ship review step: generate the commit message first, let the user edit it,
  // then commit+push with the (possibly edited) message.
  const [messageDraft, setMessageDraft] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  /**
   * Run commit (with optional manual message) then push, share toasts.
   * Returns true on success, false when the commit step threw — the caller
   * decides whether that translates into the dialog opening or a toast.
   */
  const runShip = useCallback(
    async (manualMessage?: string): Promise<{ ok: boolean; error?: unknown }> => {
      let committedMessage: string | null = null;
      try {
        const c = await commitM.mutateAsync(
          manualMessage ? { autoStage, message: manualMessage } : { autoStage },
        );
        if (c.kind === "committed") {
          committedMessage = c.message.split("\n")[0];
        }
        setShipPhase(projectId, worktreeId, "pushing");
        const p = await pushM.mutateAsync();
        if (c.kind === "nothing-to-commit" && p.kind === "nothing-to-push") {
          const detail = autoStage
            ? "There are no changes to commit and nothing to push."
            : "There are no accepted changes to ship.";
          showShipToast("Nothing to ship", detail);
          onNotice?.(detail);
          return { ok: true };
        }
        const parts: string[] = [];
        if (committedMessage) parts.push(`Committed: ${committedMessage}`);
        if (p.kind === "pushed") {
          parts.push(p.setUpstream ? "pushed and set upstream" : "pushed");
        } else if (!committedMessage) {
          parts.push("nothing to push");
        }
        const detail = parts.join(" — ");
        showShipToast("Ship complete", detail);
        onNotice?.(detail);
        return { ok: true };
      } catch (e: unknown) {
        const prefix = committedMessage ? `Committed: ${committedMessage}\n` : "";
        // Bubble enough info for the caller to either open the dialog
        // (commit-generation-failed) or fall back to the toast/banner path.
        return { ok: false, error: { raw: e, prefix } };
      }
    },
    [autoStage, commitM, onNotice, projectId, pushM, worktreeId],
  );

  const surfaceShipError = useCallback(
    (message: string) => {
      // Prefer the parent's banner when they wired one (git diff view does);
      // fall back to a sonner error card so the project route never goes silent
      // after a failed Ship — see audit finding #1.
      if (onError) onError(message);
      else showShipErrorToast("Ship failed", message);
    },
    [onError],
  );

  const handleShipFailure = useCallback(
    (error: unknown) => {
      const { raw, prefix } = error as { raw: unknown; prefix: string };
      const ciFailure = readCommitCliFailure(raw);
      if (ciFailure && !prefix) {
        // Commit step failed before anything landed — the dialog owns recovery.
        setShipFailed({
          open: true,
          cli: ciFailure.cli,
          message: ciFailure.message,
          stderr: ciFailure.stderr,
          kind: ciFailure.kind,
        });
        return;
      }
      const message = raw instanceof Error ? raw.message : "Commit & push failed";
      surfaceShipError(prefix + message);
    },
    [surfaceShipError],
  );

  // Phase 1: stage + generate the commit message, then open the review dialog.
  const onCommitAndPush = useCallback(async () => {
    if (!enabled) return;
    if (isProjectShipping(projectId, worktreeId) || generating) return;
    setGenerating(true);
    try {
      const preview = await api.prepareCommitMessage(projectId, { autoStage, worktreeId });
      if (preview.kind === "nothing-to-commit") {
        // Fall through to the classic path so ahead-of-remote commits still push
        // and the "nothing to ship" toast stays consistent.
        beginShipOperation(projectId, worktreeId);
        try {
          const result = await runShip();
          if (!result.ok) handleShipFailure(result.error);
        } finally {
          endShipOperation(projectId, worktreeId);
        }
        return;
      }
      setMessageDraft(preview.message);
    } catch (e) {
      surfaceShipError(e instanceof Error ? e.message : "Could not generate a commit message");
    } finally {
      setGenerating(false);
    }
  }, [enabled, projectId, worktreeId, generating, autoStage, runShip, handleShipFailure, surfaceShipError]);

  // Phase 2: the user confirmed (possibly edited) the message — commit + push.
  const onConfirmShip = useCallback(async () => {
    const message = messageDraft?.trim();
    if (!message) return;
    if (isProjectShipping(projectId, worktreeId)) return;
    setMessageDraft(null);
    beginShipOperation(projectId, worktreeId);
    try {
      const result = await runShip(message);
      if (!result.ok) handleShipFailure(result.error);
    } finally {
      endShipOperation(projectId, worktreeId);
    }
  }, [messageDraft, projectId, worktreeId, runShip, handleShipFailure]);

  const onManualCommit = useCallback(
    async (message: string) => {
      if (isProjectShipping(projectId, worktreeId)) return;
      beginShipOperation(projectId, worktreeId);
      try {
        const result = await runShip(message);
        if (result.ok) {
          setShipFailed(SHIP_FAILED_INITIAL);
          return;
        }
        const { raw, prefix } = result.error as { raw: unknown; prefix: string };
        const tail = raw instanceof Error ? raw.message : "Commit failed";
        if (prefix) {
          // Manual commit succeeded; push failed. The dialog is no longer the
          // right surface — close it and surface the push failure to the page.
          setShipFailed(SHIP_FAILED_INITIAL);
          surfaceShipError(prefix + tail);
          return;
        }
        // Re-keep the dialog open and explicitly set `open: true` so the user
        // can edit + retry without losing the textarea content. Spreading
        // `prev` alone won't flip `open` back from SHIP_FAILED_INITIAL.
        setShipFailed((prev) => ({
          ...prev,
          open: true,
          message: tail,
          kind: "other",
        }));
      } finally {
        endShipOperation(projectId, worktreeId);
      }
    },
    [projectId, worktreeId, runShip, surfaceShipError],
  );

  // Voice control: "ship it" / "commit & push" triggers the same primary action.
  // onCommitAndPush already guards on `enabled` and an in-flight ship.
  useEffect(() => {
    const onVoiceShip = () => void onCommitAndPush();
    window.addEventListener(VOICE_SHIP_EVENT, onVoiceShip);
    return () => window.removeEventListener(VOICE_SHIP_EVENT, onVoiceShip);
  }, [onCommitAndPush]);

  const busy = projectShipping || generating;
  const tooltip = enabled
    ? title ?? "commit & push"
    : "Ship unavailable until the project folder is valid";

  const labelBusy = (
    <>
      <Spinner />
      {generating ? "Generating…" : shipPhase === "pushing" ? "Pushing…" : "Committing…"}
    </>
  );
  const labelIdle = (
    <>
      {label}
      {showAheadBadge && aheadCount != null && aheadCount > 0 && (
        <span
          style={{
            marginLeft: 6,
            padding: "0 6px",
            borderRadius: 999,
            background: splitTrailing ? "rgba(0,0,0,0.35)" : "var(--surface-2)",
            color: splitTrailing ? "#ffffff" : "var(--text)",
            fontFamily: "var(--mono)",
            fontSize: 10,
            lineHeight: "16px",
            minWidth: 16,
            textAlign: "center",
          }}
        >
          {aheadCount}
        </span>
      )}
    </>
  );

  const primaryButton = splitTrailing ? (
    <Btn
      variant={variant}
      size={size}
      icon={busy ? undefined : "upload"}
      className="mc-btn-attached-left"
      onClick={() => void onCommitAndPush()}
      disabled={busy || !enabled}
      title={tooltip}
      aria-label={tooltip}
      style={{ fontFamily: "var(--mono)" }}
    >
      {busy ? labelBusy : labelIdle}
    </Btn>
  ) : (
    <Btn
      variant={variant}
      size={size}
      icon={busy ? undefined : "upload"}
      onClick={onCommitAndPush}
      disabled={busy || !enabled}
      title={tooltip}
    >
      {busy ? labelBusy : labelIdle}
    </Btn>
  );

  return (
    <>
      {primaryButton}
      <Modal
        open={messageDraft !== null}
        onClose={() => setMessageDraft(null)}
        title="Review commit message"
        width={520}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setMessageDraft(null)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              icon="upload"
              onClick={() => void onConfirmShip()}
              disabled={!messageDraft?.trim()}
            >
              Commit & push
            </Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea
            value={messageDraft ?? ""}
            onChange={(e) => setMessageDraft(e.target.value)}
            rows={5}
            autoFocus
            style={{
              width: "100%",
              resize: "vertical",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              color: "var(--text)",
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              lineHeight: 1.5,
              padding: "9px 11px",
              boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Generated from your changes — edit as needed. Cancel keeps the changes
            staged without committing.
          </div>
        </div>
      </Modal>
      <ShipFailedDialog
        state={shipFailed}
        onClose={() => setShipFailed(SHIP_FAILED_INITIAL)}
        onManualCommit={onManualCommit}
        busy={projectShipping}
        shipPhase={shipPhase}
      />
    </>
  );
}
