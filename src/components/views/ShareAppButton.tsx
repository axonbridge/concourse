import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
import { useDockerStatus } from "~/queries/docker";
import { useShareStart, useShareStatus, useShareStop } from "~/queries/share";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  CLOUDFLARED_SETUP_COMMAND,
  NGROK_SETUP_COMMAND,
  TAILSCALE_SETUP_COMMAND,
} from "~/shared/agent-setup-commands";

// Share a locally-running app beyond this machine without deploying it:
// "Private" = Tailscale serve (devices on your tailnet), "Public" = a tunnel
// link anyone can open (ngrok → Tailscale Funnel → cloudflared, whichever is
// available). Perfect for showing POCs mid-vibe-code without publishing.

export function ShareAppButton({
  projectId,
  worktreeId,
  enabled = true,
}: {
  projectId: string;
  worktreeId?: string | null;
  enabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [port, setPort] = useState("");
  const [mode, setMode] = useState<"private" | "public">("public");
  const { data } = useShareStatus(projectId, { enabled: enabled && open });
  const { data: activePill } = useShareStatus(projectId, { enabled });
  const { data: docker } = useDockerStatus(projectId, worktreeId, { enabled: enabled && open });
  const startM = useShareStart(projectId);
  const stopM = useShareStop(projectId);
  const { createHomeSetupTerminal } = useUserTerminals();

  const runSetup = (name: string, command: string) => {
    void createHomeSetupTerminal(name, command).then(
      () => toast.success(`${name} opened in a terminal below — follow it, then come back`),
      (e) => toast.error(e instanceof Error ? e.message : `Could not open ${name}`),
    );
  };

  const tunnels = (open ? data : activePill)?.tunnels ?? [];
  const avail = data?.availability;

  // Suggest ports from the compose stack's published ports.
  const suggestedPorts = useMemo(() => {
    const out: Array<{ port: number; label: string }> = [];
    if (docker?.kind === "ready") {
      for (const s of docker.services) {
        for (const m of (s.ports ?? "").matchAll(/(\d+)→\d+/g)) {
          out.push({ port: Number(m[1]), label: s.service });
        }
      }
    }
    return out.filter((p, i) => out.findIndex((q) => q.port === p.port) === i);
  }, [docker]);

  const publicVia = !avail
    ? null
    : avail.ngrok.installed && avail.ngrok.configured
      ? "ngrok"
      : avail.tailscale.running
        ? "Tailscale Funnel"
        : avail.cloudflared.installed
          ? "cloudflared"
          : null;
  const privateReady = avail?.tailscale.running ?? false;

  const parsedPort = Number(port.trim());
  const portValid = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536;

  const onStart = () => {
    if (!portValid) return;
    startM.mutate(
      { port: parsedPort, mode },
      {
        onSuccess: (t) => {
          void navigator.clipboard?.writeText(t.url).catch(() => {});
          toast.success("Tunnel started — link copied to clipboard");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start tunnel"),
      },
    );
  };

  return (
    <>
      <Btn
        variant="ghost"
        icon="globe"
        onClick={() => setOpen(true)}
        title="Share a locally-running app via a private or public link"
      >
        {tunnels.length > 0 && (
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--status-done)",
              flexShrink: 0,
            }}
          />
        )}
        Share
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Share running app" width={560}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {tunnels.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {tunnels.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--accent-border)",
                    background: "var(--accent-faint)",
                  }}
                >
                  <Icon name="globe" size={13} style={{ color: "var(--accent)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "block",
                        fontFamily: "var(--mono)",
                        fontSize: 12.5,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.url}
                    </a>
                    <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--mono)" }}>
                      port {t.port} · {t.mode === "private" ? "tailnet only" : "public"} · {t.provider}
                    </div>
                  </div>
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="copy"
                    aria-label="Copy link"
                    title="Copy link"
                    onClick={() => {
                      void navigator.clipboard?.writeText(t.url).then(
                        () => toast.success("Link copied"),
                        () => toast.error("Could not copy"),
                      );
                    }}
                    style={{ width: 28, height: 28, padding: 0 }}
                  />
                  <Btn
                    variant="ghost"
                    size="sm"
                    disabled={stopM.isPending}
                    onClick={() =>
                      stopM.mutate(t.id, {
                        onSuccess: () => toast.success("Tunnel stopped"),
                        onError: (e) =>
                          toast.error(e instanceof Error ? e.message : "Could not stop tunnel"),
                      })
                    }
                  >
                    Stop
                  </Btn>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
              Share a port
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Port (e.g. 3001)"
                inputMode="numeric"
                style={{
                  width: 140,
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  color: "var(--text)",
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  padding: "7px 10px",
                  outline: "none",
                }}
              />
              {suggestedPorts.map((s) => (
                <button
                  key={s.port}
                  onClick={() => setPort(String(s.port))}
                  title={`Published by the ${s.label} container`}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    background: port === String(s.port) ? "var(--accent-dim)" : "transparent",
                    color: port === String(s.port) ? "var(--accent)" : "var(--text-dim)",
                    cursor: "pointer",
                    padding: "3px 10px",
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                  }}
                >
                  {s.port} · {s.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={mode === "public"}
                  onChange={() => setMode("public")}
                  disabled={!publicVia}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span style={{ color: "var(--text)" }}>Public link</span>{" "}
                  <span style={{ color: "var(--text-dim)" }}>
                    — anyone with the URL can open it
                    {publicVia ? ` (via ${publicVia})` : " (install ngrok or cloudflared)"}
                  </span>
                </span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={mode === "private"}
                  onChange={() => setMode("private")}
                  disabled={!privateReady}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span style={{ color: "var(--text)" }}>Private — Tailscale network</span>{" "}
                  <span style={{ color: "var(--text-dim)" }}>
                    — only devices on your tailnet
                    {privateReady ? "" : " (Tailscale not connected)"}
                  </span>
                </span>
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Btn
                variant="primary"
                icon="globe"
                disabled={!portValid || startM.isPending || (mode === "public" ? !publicVia : !privateReady)}
                onClick={onStart}
              >
                {startM.isPending ? "Starting…" : "Start sharing"}
              </Btn>
            </div>
            {avail && (!publicVia || !privateReady) && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-1)",
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text)" }}>
                  Set up sharing tools
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!publicVia && (
                    <>
                      <Btn
                        variant="ghost"
                        size="sm"
                        icon="download"
                        onClick={() => runSetup("cloudflared setup", CLOUDFLARED_SETUP_COMMAND)}
                        title="Free public links, no account needed, no interstitial page"
                      >
                        Install cloudflared (recommended)
                      </Btn>
                      <Btn
                        variant="ghost"
                        size="sm"
                        icon="download"
                        onClick={() => runSetup("ngrok setup", NGROK_SETUP_COMMAND)}
                        title="Public links via ngrok — needs a free account authtoken"
                      >
                        Install ngrok
                      </Btn>
                    </>
                  )}
                  {!privateReady && (
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon="download"
                      onClick={() => runSetup("Tailscale setup", TAILSCALE_SETUP_COMMAND)}
                      title={
                        avail.tailscale.installed
                          ? "Tailscale is installed but not connected — this opens it to sign in"
                          : "Install Tailscale for private tailnet sharing"
                      }
                    >
                      {avail.tailscale.installed ? "Open Tailscale to sign in" : "Install Tailscale"}
                    </Btn>
                  )}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.5 }}>
              Tunnels last while Concourse is running and can be stopped here any time. The app
              itself keeps running locally — this only exposes the port.
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
