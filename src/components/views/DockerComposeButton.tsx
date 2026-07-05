import { useState } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
import {
  useDockerEngineStart,
  useDockerRestart,
  useDockerStatus,
  useDockerStop,
  useDockerUp,
} from "~/queries/docker";

// Docker/Rancher dev-first workflows: projects with a compose file at the
// root (app + database containers) get a status pill in the project header
// and a dialog to start/stop the whole stack. Renders nothing for projects
// without a compose file.

export function DockerComposeButton({
  projectId,
  worktreeId,
  enabled = true,
}: {
  projectId: string;
  worktreeId?: string | null;
  enabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data: status, isError } = useDockerStatus(projectId, worktreeId, { enabled });
  const upM = useDockerUp(projectId, worktreeId);
  const stopM = useDockerStop(projectId, worktreeId);
  const restartM = useDockerRestart(projectId, worktreeId);
  const engineM = useDockerEngineStart(projectId, worktreeId);

  const anyBusy = upM.isPending || stopM.isPending || restartM.isPending;

  if (!status || isError || status.kind === "no-compose") return null;

  const ready = status.kind === "ready" ? status : null;
  const dotColor = !ready
    ? "var(--text-faint)"
    : ready.running === 0
      ? "var(--text-faint)"
      : ready.running < ready.total
        ? "var(--status-needs)"
        : "var(--status-done)";
  const label = ready ? `${ready.running}/${ready.total}` : "off";

  const runUp = () =>
    upM.mutate(undefined, {
      onSuccess: () => toast.success("Docker stack started"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "docker compose up failed"),
    });
  const runStop = () =>
    stopM.mutate(undefined, {
      onSuccess: () => toast.success("Docker stack stopped"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "docker compose stop failed"),
    });
  const runRestart = () =>
    restartM.mutate(undefined, {
      onSuccess: () => toast.success("Docker stack restarted"),
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "docker compose restart failed"),
    });

  return (
    <>
      <Btn
        variant="ghost"
        icon="box"
        onClick={() => setOpen(true)}
        title={
          ready
            ? `Docker: ${ready.running} of ${ready.total} services running`
            : status.kind === "engine-off"
              ? "Docker engine is not running"
              : "Docker CLI not found"
        }
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
          }}
        />
        {label}
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Docker services" width={520}>
        {status.kind === "no-docker" && (
          <div style={infoStyle}>
            The <code>docker</code> CLI was not found on this machine. Install{" "}
            {status.engineApp ?? "Docker Desktop or Rancher Desktop"} to run this project's
            containers.
          </div>
        )}
        {status.kind === "engine-off" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={infoStyle}>
              The Docker engine is not running
              {status.engineApp ? ` — start ${status.engineApp} to manage this stack.` : "."}
            </div>
            {status.engineApp && (
              <Btn
                variant="primary"
                icon="play"
                disabled={engineM.isPending}
                onClick={() =>
                  engineM.mutate(undefined, {
                    onSuccess: (r) =>
                      r.ok
                        ? toast.success(`${r.app} is starting — this can take a moment`)
                        : toast.error("Could not launch the Docker engine app"),
                    onError: (e) =>
                      toast.error(e instanceof Error ? e.message : "Could not start engine"),
                  })
                }
                style={{ alignSelf: "flex-start" }}
              >
                {engineM.isPending ? "Launching…" : `Start ${status.engineApp}`}
              </Btn>
            )}
          </div>
        )}
        {ready && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--text-faint)",
              }}
            >
              {ready.composeFile}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {ready.services.map((s) => (
                <div
                  key={s.service}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                >
                  <Icon name="box" size={12} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12.5,
                      color: "var(--text)",
                      flexShrink: 0,
                    }}
                  >
                    {s.service}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: "var(--text-faint)",
                    }}
                    title={s.status ?? undefined}
                  >
                    {s.ports ?? s.status ?? ""}
                  </span>
                  <StateChip state={s.state} status={s.status} />
                </div>
              ))}
            </div>
            {/* State-aware actions: a fully-running stack offers Restart, a
                stopped/partial one offers Start (compose up -d starts only
                what's missing). */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Btn
                variant="ghost"
                disabled={anyBusy || ready.running === 0}
                onClick={runStop}
              >
                {stopM.isPending ? "Stopping…" : "Stop all"}
              </Btn>
              {ready.running === ready.total && ready.total > 0 ? (
                <Btn
                  variant="primary"
                  icon="refresh"
                  disabled={anyBusy}
                  onClick={runRestart}
                  title="docker compose restart — bounce all containers"
                >
                  {restartM.isPending ? "Restarting…" : "Restart all"}
                </Btn>
              ) : (
                <Btn
                  variant="primary"
                  icon="play"
                  disabled={anyBusy}
                  onClick={runUp}
                  title="docker compose up -d (builds images on first run)"
                >
                  {upM.isPending ? "Starting…" : "Start all"}
                </Btn>
              )}
            </div>
            {upM.isPending && (
              <div style={{ ...infoStyle, fontSize: 11.5 }}>
                First start builds images — this can take a few minutes.
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function StateChip({ state, status }: { state: string; status: string | null }) {
  const healthy = status?.toLowerCase().includes("healthy") && !status?.toLowerCase().includes("unhealthy");
  // A stopped container is "exited" in Docker-speak with a nonzero code when
  // the app didn't trap SIGTERM — neither is an error after a manual Stop, so
  // show it as neutral "stopped". Amber is reserved for running-but-unhealthy
  // and transitional states (restarting, paused).
  const label = state === "exited" || state === "created" ? "stopped" : state;
  const color =
    state === "running"
      ? healthy || !status?.toLowerCase().includes("health")
        ? "var(--status-done)"
        : "var(--status-needs)"
      : state === "exited" || state === "created" || state === "not-created"
        ? "var(--text-faint)"
        : "var(--status-needs)";
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

const infoStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--text-dim)",
  lineHeight: 1.55,
};
