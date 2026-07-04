import { useCallback, useEffect, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Modal } from "~/components/ui/Modal";
import { SettingsSection } from "~/components/views/SettingsParts";
import { getElectron } from "~/lib/electron";
import { api } from "~/lib/api";
import { toast } from "sonner";

type Server = { name: string; url: string; status: string };

type WsServer = {
  name: string;
  url: string;
  status: "connected" | "needs-auth" | "error" | "unsupported";
  toolCount?: number;
  error?: string;
  authed?: boolean;
};

// Connect / authenticate MCP servers (Atlassian, etc.) from the UI. The chat's
// commands need these authenticated to reach Jira/Confluence and friends.
export function IntegrationsSettingsPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // server name being auth'd

  // Workspace integrations (in-app MCP client, our own OAuth): the servers
  // declared in each workspace's .mcp.json, deduped by URL. Authenticating
  // once here makes the integration work on EVERY engine — Claude and direct.
  const [wsServers, setWsServers] = useState<WsServer[]>([]);
  const [wsLoading, setWsLoading] = useState(true);
  const [wsBusy, setWsBusy] = useState<string | null>(null); // url being auth'd
  const [confirmDelete, setConfirmDelete] = useState<WsServer | null>(null);
  const [globalRefreshKey, setGlobalRefreshKey] = useState(0);

  const refreshWs = useCallback(async () => {
    const electron = getElectron();
    if (!electron?.mcpWorkspace) {
      setWsLoading(false);
      return;
    }
    setWsLoading(true);
    try {
      const { projects } = await api.listProjects();
      const byUrl = new Map<string, WsServer>();
      for (const p of projects) {
        const list = await electron.mcpWorkspace.status(p.path).catch(() => []);
        for (const s of list) {
          const existing = byUrl.get(s.url);
          // Prefer the most-informative status when the same server appears
          // in several workspaces (connected > needs-auth > error).
          if (!existing || s.status === "connected") byUrl.set(s.url, s);
        }
      }
      setWsServers([...byUrl.values()].sort((a, b) => a.name.localeCompare(b.name)));
    } finally {
      setWsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWs();
  }, [refreshWs]);

  const wsAuthenticate = useCallback(
    async (s: WsServer) => {
      const electron = getElectron();
      if (!electron?.mcpWorkspace) return;
      setWsBusy(s.url);
      try {
        const r = await electron.mcpWorkspace.authenticate(s.name, s.url);
        if (!r.ok) toast.error(r.error ?? "Sign-in failed.");
      } finally {
        setWsBusy(null);
        void refreshWs();
      }
    },
    [refreshWs],
  );

  // Delete = remove the server everywhere it's declared (global config + every
  // workspace .mcp.json with that name), sign out, and forget the connection.
  const wsDelete = useCallback(
    async (s: WsServer) => {
      const electron = getElectron();
      if (!electron?.mcpWorkspace) return;
      setWsBusy(s.url);
      try {
        await electron.mcpGlobal?.remove(s.name);
        const { projects } = await api.listProjects();
        for (const p of projects) {
          await electron.mcpWorkspace.removeServer(p.path, s.name).catch(() => {});
        }
        await electron.mcpWorkspace.logout(s.url);
      } finally {
        setWsBusy(null);
        setGlobalRefreshKey((k) => k + 1); // the My-integrations list reloads too
        void refreshWs();
      }
    },
    [refreshWs],
  );

  const wsLogout = useCallback(
    async (s: WsServer) => {
      const electron = getElectron();
      if (!electron?.mcpWorkspace) return;
      setWsBusy(s.url);
      try {
        await electron.mcpWorkspace.logout(s.url);
      } finally {
        setWsBusy(null);
        void refreshWs();
      }
    },
    [refreshWs],
  );

  const refresh = useCallback(async () => {
    const electron = getElectron();
    if (!electron?.mcp) {
      setError("MCP management is only available in the desktop app.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await electron.mcp.list();
    setServers(res.servers ?? []);
    if (res.error && (res.servers ?? []).length === 0) setError(res.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-check status when the app regains focus — e.g. after the user connects
  // or disconnects a connector on claude.ai in the browser and switches back.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const authenticate = useCallback(
    async (name: string) => {
      const electron = getElectron();
      if (!electron?.mcp) return;
      setBusy(name);
      try {
        await electron.mcp.login(name);
      } finally {
        setBusy(null);
        void refresh();
      }
    },
    [refresh],
  );

  const disconnect = useCallback(
    async (name: string) => {
      const electron = getElectron();
      if (!electron?.mcp) return;
      setBusy(name);
      try {
        await electron.mcp.logout(name);
      } finally {
        setBusy(null);
        void refresh();
      }
    },
    [refresh],
  );

  const connected = (s: Server) => /connect/i.test(s.status);
  // claude.ai connectors are managed on claude.ai, not locally — `claude mcp
  // logout` can't disconnect them, so we send the user to the web to manage.
  const isConnector = (s: Server) => /^claude\.ai\s/i.test(s.name);

  const manageOnWeb = useCallback(() => {
    void getElectron()?.openExternal("https://claude.ai/customize/connectors");
  }, []);

  return (
    <SettingsSection
      title="Integrations"
      subtitle="Connect the tools your commands use — Jira, Confluence, and other MCP servers."
      headingLevel="h1"
    >
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>My integrations</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.55 }}>
          Available in <b>every</b> project, on every engine. Workspace integrations below can
          override these by name. Sign-in status appears in the list underneath.
        </div>
        <GlobalIntegrations onChanged={() => void refreshWs()} refreshKey={globalRefreshKey} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
          Workspace integrations
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.55 }}>
          Declared in each workspace&apos;s <code>.mcp.json</code>. Sign in once and the
          integration works on every AI engine — Claude, OpenRouter, local models, all of them.
          Signing in opens your browser.
        </div>
        {wsLoading && wsServers.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Checking connection status…</div>
        ) : wsServers.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
            No workspace integrations found (no <code>.mcp.json</code> entries).
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {wsServers.map((s) => {
              const ok = s.status === "connected";
              const isBusy = wsBusy === s.url;
              return (
                <div
                  key={s.url}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    background: "var(--surface-1)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background:
                        s.status === "connected"
                          ? "var(--status-done)"
                          : s.status === "error"
                            ? "var(--status-failed)"
                            : "var(--status-needs)",
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--text-faint)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ok
                        ? `Connected — ${s.toolCount ?? 0} tools · all engines${s.authed === false ? " · not signed in (may ask when tools run)" : ""}`
                        : s.status === "error"
                          ? (s.error ?? "Connection error")
                          : s.status === "unsupported"
                            ? (s.error ?? "Unsupported server type")
                            : "Needs sign-in"}{" "}
                      · {s.url}
                    </div>
                  </div>
                  {ok && s.authed === false ? (
                    <Btn variant="primary" onClick={() => void wsAuthenticate(s)} disabled={isBusy}>
                      {isBusy ? "Waiting for browser…" : "Sign in"}
                    </Btn>
                  ) : ok ? (
                    <Btn variant="ghost" onClick={() => void wsLogout(s)} disabled={isBusy}>
                      {isBusy ? "…" : "Sign out"}
                    </Btn>
                  ) : s.status !== "unsupported" ? (
                    <Btn variant="primary" onClick={() => void wsAuthenticate(s)} disabled={isBusy}>
                      {isBusy ? "Waiting for browser…" : "Sign in"}
                    </Btn>
                  ) : null}
                  <Btn
                    variant="ghost"
                    icon="trash"
                    onClick={() => setConfirmDelete(s)}
                    disabled={isBusy}
                    aria-label={`Delete ${s.name}`}
                    title="Delete this integration everywhere and sign out"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>Claude CLI integrations</div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.55 }}>
        Servers connected through the Claude CLI&apos;s own login (used by Claude sessions only).
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Btn variant="ghost" icon="refresh" onClick={() => { void refresh(); void refreshWs(); }} disabled={loading}>
          {loading ? "Checking…" : "Refresh"}
        </Btn>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          Authentication opens your browser to complete sign-in.
        </span>
      </div>

      {error && (
        <div style={{ fontSize: 13, color: "var(--status-failed)", marginBottom: 14 }}>{error}</div>
      )}

      {loading && servers.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Checking connection status…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {servers.map((s) => {
            const ok = connected(s);
            const isBusy = busy === s.name;
            return (
              <div
                key={s.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: ok ? "var(--status-done)" : "var(--status-needs)",
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--text-faint)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ok ? "Connected" : "Needs authentication"} · {s.url}
                  </div>
                </div>
                {ok ? (
                  isConnector(s) ? (
                    <Btn variant="ghost" icon="external-link" onClick={manageOnWeb}>
                      Manage on claude.ai
                    </Btn>
                  ) : (
                    <Btn variant="ghost" onClick={() => void disconnect(s.name)} disabled={isBusy}>
                      {isBusy ? "…" : "Disconnect"}
                    </Btn>
                  )
                ) : (
                  <Btn variant="primary" onClick={() => void authenticate(s.name)} disabled={isBusy}>
                    {isBusy ? "Authenticating…" : "Authenticate"}
                  </Btn>
                )}
              </div>
            );
          })}
          {!loading && servers.length === 0 && !error && (
            <div style={{ fontSize: 13, color: "var(--text-dim)" }}>No MCP servers configured.</div>
          )}
        </div>
      )}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={`Delete "${confirmDelete?.name}"?`}
        width={440}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              icon="trash"
              onClick={() => {
                const s = confirmDelete;
                setConfirmDelete(null);
                if (s) void wsDelete(s);
              }}
            >
              Delete everywhere
            </Btn>
          </div>
        }
      >
        <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>
          This removes <b>{confirmDelete?.name}</b> from your global integrations and from every
          workspace&apos;s <code>.mcp.json</code> that declares it, signs out, and forgets its
          tokens. Workflows that rely on it will lose access until it&apos;s added again.
        </div>
      </Modal>
    </SettingsSection>
  );
}

// Personal global MCP servers (userData/mcp.json) — add by URL or local command.
function GlobalIntegrations({ onChanged, refreshKey }: { onChanged: () => void; refreshKey?: number }) {
  const [servers, setServers] = useState<Array<{ name: string; url?: string; command?: string }>>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const el = getElectron();
    if (!el?.mcpGlobal) return;
    setServers(await el.mcpGlobal.list().catch(() => []));
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const add = async () => {
    const el = getElectron();
    if (!el?.mcpGlobal || !name.trim() || !target.trim()) return;
    setError(null);
    const cfg = /^https?:\/\//i.test(target.trim())
      ? { url: target.trim() }
      : { command: target.trim() };
    const r = await el.mcpGlobal.add(name.trim(), cfg);
    if (!r.ok) {
      setError(r.error ?? "Could not add the integration.");
      return;
    }
    setName("");
    setTarget("");
    await refresh();
    onChanged();
  };

  const remove = async (n: string) => {
    await getElectron()?.mcpGlobal.remove(n);
    await refresh();
    onChanged();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {servers.map((s) => (
        <div
          key={s.name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 14px",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--text-faint)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {s.url ?? `stdio: ${s.command}`}
            </div>
          </div>
          {/* Deletion happens from the aggregated list below (trash icon). */}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name (e.g. github)"
          spellCheck={false}
          style={{
            width: 140,
            fontFamily: "var(--mono)",
            fontSize: 12,
            padding: "7px 10px",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
          }}
        />
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          placeholder="https://…/mcp  — or a local command (npx some-mcp-server)"
          spellCheck={false}
          style={{
            flex: 1,
            fontFamily: "var(--mono)",
            fontSize: 12,
            padding: "7px 10px",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
          }}
        />
        <Btn onClick={() => void add()} disabled={!name.trim() || !target.trim()}>
          Add
        </Btn>
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--status-failed)" }}>{error}</div>}
    </div>
  );
}
