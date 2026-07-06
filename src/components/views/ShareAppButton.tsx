import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
import { useDockerStatus } from "~/queries/docker";
import { useShareStart, useShareStatus, useShareStop } from "~/queries/share";
import { useUserTerminals } from "~/lib/user-terminal-store";
import { openExternal } from "~/lib/open-external";
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
  const [provider, setProvider] = useState<"ngrok" | "tailscale-funnel" | "cloudflared" | null>(null);
  const [startError, setStartError] = useState<{ message: string; enableUrl?: string } | null>(null);
  const [pendingSetup, setPendingSetup] = useState<{
    cloudflared?: boolean;
    ngrok?: boolean;
    tailscale?: boolean;
  }>({});
  const anySetupPending = Object.values(pendingSetup).some(Boolean);
  const { data } = useShareStatus(projectId, {
    enabled: enabled && open,
    fast: anySetupPending,
  });
  const { data: activePill } = useShareStatus(projectId, { enabled });
  const { data: docker } = useDockerStatus(projectId, worktreeId, { enabled: enabled && open });
  const startM = useShareStart(projectId);
  const stopM = useShareStop(projectId);
  const { createTerminal, createHomeSetupTerminal } = useUserTerminals();

  const runSetup = (tool: "cloudflared" | "ngrok" | "tailscale", name: string, command: string) => {
    if (pendingSetup[tool]) return;
    setPendingSetup((cur) => ({ ...cur, [tool]: true }));
    // Run in the CURRENT PROJECT's terminal drawer so it's visible from this
    // page — home-scope terminals only spawn on the dashboard, which left the
    // command never executing (and the chip pending forever).
    void createTerminal({ name, startCommand: command })
      .then((t) => t ?? createHomeSetupTerminal(name, command))
      .then(
        () => toast.success(`${name} is running in the terminal panel below`),
        (e) => {
          setPendingSetup((cur) => ({ ...cur, [tool]: false }));
          toast.error(e instanceof Error ? e.message : `Could not open ${name}`);
        },
      );
  };

  const tunnels = (open ? data : activePill)?.tunnels ?? [];
  const avail = data?.availability;

  // Flip pending chips to ready the moment detection confirms each tool (the
  // setup terminals run outside the modal, so this is the in-dialog signal).
  // "Ready" means usable, not merely installed: ngrok needs its authtoken,
  // Tailscale needs to be signed in and connected.
  const cfReady = avail?.cloudflared.installed ?? false;
  const ngrokReady = (avail?.ngrok.installed && avail?.ngrok.configured) ?? false;
  const tsReady = avail?.tailscale.running ?? false;
  useEffect(() => {
    if (pendingSetup.cloudflared && cfReady) {
      setPendingSetup((cur) => ({ ...cur, cloudflared: false }));
      setProvider("cloudflared");
      toast.success("cloudflared is ready — selected as the public provider");
    }
    if (pendingSetup.ngrok && ngrokReady) {
      setPendingSetup((cur) => ({ ...cur, ngrok: false }));
      setProvider((cur) => cur ?? "ngrok");
      toast.success("ngrok is connected and ready");
    }
    if (pendingSetup.tailscale && tsReady) {
      setPendingSetup((cur) => ({ ...cur, tailscale: false }));
      toast.success("Tailscale is connected — private sharing is ready");
    }
  }, [pendingSetup, cfReady, ngrokReady, tsReady]);

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

  // Every public provider that would work right now, in preference order.
  const publicProviders = !avail
    ? []
    : ([
        avail.cloudflared.installed ? ("cloudflared" as const) : null,
        avail.ngrok.installed && avail.ngrok.configured ? ("ngrok" as const) : null,
        avail.tailscale.running ? ("tailscale-funnel" as const) : null,
      ].filter(Boolean) as Array<"cloudflared" | "ngrok" | "tailscale-funnel">);
  const selectedProvider = provider && publicProviders.includes(provider) ? provider : publicProviders[0] ?? null;
  const publicVia = selectedProvider ? PROVIDER_LABEL[selectedProvider] : null;
  const privateReady = tsReady;

  const parsedPort = Number(port.trim());
  const portValid = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536;

  const onStart = () => {
    if (!portValid) return;
    setStartError(null);
    startM.mutate(
      { port: parsedPort, mode, provider: mode === "public" ? (selectedProvider ?? undefined) : undefined },
      {
        onSuccess: (t) => {
          void navigator.clipboard?.writeText(t.url).catch(() => {});
          toast.success("Tunnel started — link copied to clipboard");
        },
        onError: (e) => {
          const message = e instanceof Error ? e.message : "Could not start tunnel";
          // Tailnet features (serve/funnel) need a one-time admin opt-in; the
          // server surfaces the enable link — render it as an inline action.
          const enableUrl = message.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];
          setStartError({
            message: enableUrl
              ? `${mode === "private" ? "Tailscale serve" : "Tailscale Funnel"} needs a one-time opt-in for your tailnet. Enable it in the admin page, then try again.`
              : message,
            enableUrl,
          });
        },
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
                  onChange={() => {
                    setMode("public");
                    setStartError(null);
                  }}
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
              {mode === "public" && !!avail && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 22 }}>
                  {publicProviders.map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setProvider(p);
                        setStartError(null);
                      }}
                      title={PROVIDER_HINT[p]}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 999,
                        background: selectedProvider === p ? "var(--accent-dim)" : "transparent",
                        color: selectedProvider === p ? "var(--accent)" : "var(--text-dim)",
                        cursor: "pointer",
                        padding: "3px 10px",
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                      }}
                    >
                      {PROVIDER_LABEL[p]}
                    </button>
                  ))}
                  {avail && !cfReady && (
                    <SetupChip
                      pending={!!pendingSetup.cloudflared}
                      label="+ install cloudflared"
                      pendingLabel="installing cloudflared…"
                      title="Free public links with no account and no interstitial page — installs in ~30s"
                      onClick={() => runSetup("cloudflared", "cloudflared setup", CLOUDFLARED_SETUP_COMMAND)}
                    />
                  )}
                  {avail && !ngrokReady && (
                    <SetupChip
                      pending={!!pendingSetup.ngrok}
                      label={avail.ngrok.installed ? "+ connect ngrok" : "+ set up ngrok"}
                      pendingLabel="setting up ngrok…"
                      title="Public links via your ngrok account — the terminal walks through install + authtoken"
                      onClick={() => runSetup("ngrok", "ngrok setup", NGROK_SETUP_COMMAND)}
                    />
                  )}
                </div>
              )}
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={mode === "private"}
                  onChange={() => {
                    setMode("private");
                    setStartError(null);
                  }}
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
              {avail && !privateReady && (
                <div style={{ paddingLeft: 22 }}>
                  <SetupChip
                    pending={!!pendingSetup.tailscale}
                    label={avail.tailscale.installed ? "+ open Tailscale to sign in" : "+ install Tailscale"}
                    pendingLabel="waiting for Tailscale sign-in…"
                    title={
                      avail.tailscale.installed
                        ? "Tailscale is installed but not connected — sign in from its menu-bar icon"
                        : "Installs the Tailscale app for private tailnet sharing"
                    }
                    onClick={() => runSetup("tailscale", "Tailscale setup", TAILSCALE_SETUP_COMMAND)}
                  />
                </div>
              )}
            </div>

            {startError && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--status-failed)",
                  fontSize: 12,
                  color: "var(--text)",
                  lineHeight: 1.5,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{startError.message}</span>
                {startError.enableUrl && (
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="globe"
                    onClick={() => openExternal(startError.enableUrl!)}
                    style={{ flexShrink: 0 }}
                  >
                    Open enable page
                  </Btn>
                )}
              </div>
            )}
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
            {avail && !publicVia && !privateReady && (
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
                        disabled={!!pendingSetup.cloudflared}
                        onClick={() => runSetup("cloudflared", "cloudflared setup", CLOUDFLARED_SETUP_COMMAND)}
                        title="Free public links, no account needed, no interstitial page"
                      >
                        {pendingSetup.cloudflared ? "Installing cloudflared…" : "Install cloudflared (recommended)"}
                      </Btn>
                      <Btn
                        variant="ghost"
                        size="sm"
                        icon="download"
                        disabled={!!pendingSetup.ngrok}
                        onClick={() => runSetup("ngrok", "ngrok setup", NGROK_SETUP_COMMAND)}
                        title="Public links via ngrok — needs a free account authtoken"
                      >
                        {pendingSetup.ngrok ? "Setting up ngrok…" : "Install ngrok"}
                      </Btn>
                    </>
                  )}
                  {!privateReady && (
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon="download"
                      disabled={!!pendingSetup.tailscale}
                      onClick={() => runSetup("tailscale", "Tailscale setup", TAILSCALE_SETUP_COMMAND)}
                      title={
                        avail.tailscale.installed
                          ? "Tailscale is installed but not connected — this opens it to sign in"
                          : "Install Tailscale for private tailnet sharing"
                      }
                    >
                      {pendingSetup.tailscale
                        ? "Waiting for Tailscale…"
                        : avail.tailscale.installed
                          ? "Open Tailscale to sign in"
                          : "Install Tailscale"}
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

function SetupChip({
  pending,
  label,
  pendingLabel,
  title,
  onClick,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending}
      title={pending ? "Running in the terminal below — this activates when it finishes" : title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "1px dashed var(--border)",
        borderRadius: 999,
        background: "transparent",
        color: pending ? "var(--text-dim)" : "var(--text-faint)",
        cursor: pending ? "default" : "pointer",
        padding: "3px 10px",
        fontFamily: "var(--mono)",
        fontSize: 11,
      }}
    >
      {pending && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--status-running)",
            animation: "pulse-dot 1.4s ease-in-out infinite",
            flexShrink: 0,
          }}
        />
      )}
      {pending ? pendingLabel : label}
    </button>
  );
}

const PROVIDER_LABEL: Record<string, string> = {
  cloudflared: "cloudflared",
  ngrok: "ngrok",
  "tailscale-funnel": "Tailscale Funnel",
};
const PROVIDER_HINT: Record<string, string> = {
  cloudflared: "Free, no account, viewers see no warning page",
  ngrok: "Uses your ngrok account; free tier shows viewers a one-time warning page",
  "tailscale-funnel": "Public link through your tailnet node (needs Funnel enabled)",
};
