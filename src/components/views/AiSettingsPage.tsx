import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Field, SettingsSection } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { getElectron } from "~/lib/electron";
import { queryKeys, useSettings } from "~/queries";
import { AI_PROVIDERS, aiProviderInfo, type AiProviderInfo, type EngineId } from "~/shared/ai-providers";
import type { TaskAgent } from "~/shared/domain";
import type { CommitCli, CommitCliDetection } from "~/shared/commit-cli";

// Which binary proves a harness engine is installed. Reuses the commit-cli
// detection endpoint — it probes exactly these four CLIs on PATH. Direct
// engines have no CLI, so no entry.
const DETECT_KEY: Record<TaskAgent, CommitCli> = {
  "claude-code": "claude",
  codex: "codex",
  "cursor-cli": "cursor-agent",
  opencode: "opencode",
};

// Env var each engine accepts for API-key auth (renderer copy of
// electron/credentials/store.ts CREDENTIAL_ENV — display only). opencode has
// no single key (`opencode auth`); ollama is local and keyless.
const KEY_ENV: Partial<Record<EngineId, string>> = {
  "claude-code": "ANTHROPIC_API_KEY",
  codex: "OPENAI_API_KEY",
  "cursor-cli": "CURSOR_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  custom: "API_KEY",
};

// AI settings — one card per engine. Selecting a card expands it in place with
// everything that engine needs (auth status, API key, endpoint URL), so setup
// happens where the choice is made instead of in separate sections below.
export function AiSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const provider = settings?.aiProvider ?? "claude-code";
  const modelByProvider = settings?.aiModelByProvider ?? {};
  const info = aiProviderInfo(provider);
  const credByProvider = settings?.aiCredentialByProvider ?? {};
  const [detection, setDetection] = useState<CommitCliDetection | null>(null);
  const [detecting, setDetecting] = useState(false);
  // provider id → true when an API key is stored in the OS keychain. The key
  // itself never reaches the renderer — only this boolean does.
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean> | null>(null);
  const [editingKey, setEditingKey] = useState<EngineId | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [baseUrlDraft, setBaseUrlDraft] = useState<string | null>(null);
  const electron = getElectron();

  const refreshKeyStatus = useCallback(async () => {
    const el = getElectron();
    if (!el) return;
    try {
      setKeyStatus(await el.credentials.status());
    } catch {
      setKeyStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshKeyStatus();
  }, [refreshKeyStatus]);

  const detect = useCallback(async () => {
    setDetecting(true);
    try {
      const { detected } = await api.detectCommitCli();
      setDetection(detected);
    } catch {
      setDetection(null);
    } finally {
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    void detect();
  }, [detect]);

  const update = async (
    patch: Partial<
      Pick<
        AppSettings,
        "aiProvider" | "aiModelByProvider" | "aiCredentialByProvider" | "aiCustomBaseUrl"
      >
    >,
  ) => {
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    if (previous) queryClient.setQueryData(queryKeys.settings, { ...previous, ...patch });
    try {
      const next = await api.updateSettings(patch);
      queryClient.setQueryData(queryKeys.settings, next);
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  const setProvider = (id: EngineId) => {
    setEditingKey(null);
    setKeyError(null);
    void update({ aiProvider: id });
  };

  const startKeyEdit = (id: EngineId) => {
    setEditingKey(id);
    setKeyDraft("");
    setKeyError(null);
  };

  const saveKey = async (id: EngineId) => {
    const el = getElectron();
    if (!el) return;
    setKeySaving(true);
    setKeyError(null);
    try {
      const result = await el.credentials.set(id, keyDraft);
      if (!result.ok) {
        setKeyError(result.error ?? "Could not save the key.");
        return;
      }
      await update({ aiCredentialByProvider: { ...credByProvider, [id]: "api-key" } });
      await refreshKeyStatus();
      setEditingKey(null);
      setKeyDraft("");
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : "Could not save the key.");
    } finally {
      setKeySaving(false);
    }
  };

  const removeKey = async (id: EngineId) => {
    const el = getElectron();
    if (!el) return;
    await el.credentials.delete(id);
    const next = { ...credByProvider };
    delete next[id];
    await update({ aiCredentialByProvider: next });
    await refreshKeyStatus();
  };

  const setModel = (modelId: string | null) => {
    const next = { ...modelByProvider };
    if (modelId) next[provider] = modelId;
    else delete next[provider];
    void update({ aiModelByProvider: next });
  };

  // The setup area rendered inside the SELECTED card: auth status + key
  // controls (+ endpoint URL for the custom engine). Everything an engine
  // needs lives on its card.
  const renderSetup = (p: AiProviderInfo) => {
    const envVar = KEY_ENV[p.id];
    const hasKey = keyStatus?.[p.id] === true;
    const usingKey = hasKey && credByProvider[p.id] === "api-key";
    const editing = editingKey === p.id;

    const authLine = !envVar
      ? p.credential === "none"
        ? "Runs on this machine — no key needed."
        : "Manages provider keys itself — run `opencode auth` in a terminal."
      : usingKey
        ? "Using your API key (encrypted with your OS keychain, never leaves this machine)."
        : p.kind === "harness"
          ? "Using CLI login. Add an API key to bill usage to an org account instead."
          : p.id === "custom"
            ? "No key set (fine for open endpoints)."
            : "Add your API key to use this engine — it's encrypted with your OS keychain.";

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {authLine}
          </div>
          {envVar && electron && !editing && (
            <div style={{ flexShrink: 0 }}>
              {hasKey ? (
                <Btn variant="ghost" onClick={() => void removeKey(p.id)}>
                  Remove key
                </Btn>
              ) : (
                <Btn variant="ghost" onClick={() => startKeyEdit(p.id)}>
                  Add API key
                </Btn>
              )}
            </div>
          )}
        </div>
        {envVar && !electron && (
          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
            API keys can only be managed from the desktop app.
          </div>
        )}
        {editing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                autoFocus
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && keyDraft.trim()) void saveKey(p.id);
                  if (e.key === "Escape") setEditingKey(null);
                }}
                placeholder={envVar}
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
              <Btn onClick={() => void saveKey(p.id)} disabled={keySaving || !keyDraft.trim()}>
                {keySaving ? "Saving…" : "Save"}
              </Btn>
              <Btn variant="ghost" onClick={() => setEditingKey(null)} disabled={keySaving}>
                Cancel
              </Btn>
            </div>
            {keyError && (
              <div style={{ fontSize: 12, color: "var(--status-error, #e5484d)" }}>{keyError}</div>
            )}
          </div>
        )}
        {p.id === "custom" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
              Endpoint base URL — any OpenAI-compatible server (e.g.{" "}
              <code>https://gateway.your-org.com/v1</code> or <code>http://localhost:1234/v1</code>
              ).
            </div>
            <input
              type="text"
              value={baseUrlDraft ?? settings?.aiCustomBaseUrl ?? ""}
              onChange={(e) => setBaseUrlDraft(e.target.value)}
              onBlur={() => {
                if (baseUrlDraft !== null && baseUrlDraft !== (settings?.aiCustomBaseUrl ?? "")) {
                  void update({ aiCustomBaseUrl: baseUrlDraft });
                }
                setBaseUrlDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="https://…/v1"
              spellCheck={false}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                padding: "8px 10px",
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
              }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <SettingsSection
      title="AI"
      subtitle="Which AI powers your sessions, and the default model it runs."
      headingLevel="h1"
    >
      <Field label="AI provider">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 620 }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55 }}>
            Pick who powers your sessions — setup for the selected provider appears on its card.
            Chat and workflows fall back to Claude Code when a provider doesn&apos;t support them.
          </div>
          {AI_PROVIDERS.map((p) => {
            const selected = p.id === provider;
            const installed =
              p.kind === "harness" && detection ? detection[DETECT_KEY[p.id as TaskAgent]] : null;
            const usingKey = keyStatus?.[p.id] === true && credByProvider[p.id] === "api-key";
            return (
              <div
                key={p.id}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onClick={() => setProvider(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setProvider(p.id);
                  }
                }}
                style={{
                  padding: "12px 14px",
                  background: selected ? "var(--accent-faint)" : "var(--surface-0)",
                  border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 8,
                  cursor: "pointer",
                  color: "var(--text)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
                  <span
                    aria-hidden
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      flexShrink: 0,
                      border: `1px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
                      background: selected ? "var(--accent)" : "transparent",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                    }}
                  >
                    {selected && <Icon name="check" size={9} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{p.label}</div>
                    <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 }}>
                      {p.description}
                      {!p.chatCapable && (
                        <span style={{ display: "block", color: "var(--text-faint)" }}>
                          {p.kind === "harness"
                            ? "Terminal sessions only — chat & workflows run on Claude Code until this provider adds chat support."
                            : "Chat on this engine arrives with the next update — until then chat & workflows run on Claude Code."}
                        </span>
                      )}
                    </div>
                  </div>
                  {usingKey && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: "1px solid var(--border)",
                        color: "var(--status-done)",
                      }}
                    >
                      ✓ API key
                    </span>
                  )}
                  {p.kind === "harness" && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: "1px solid var(--border)",
                        color:
                          installed === null
                            ? "var(--text-faint)"
                            : installed
                              ? "var(--status-done)"
                              : "var(--text-faint)",
                      }}
                    >
                      {installed === null ? "checking…" : installed ? "✓ installed" : "not found"}
                    </span>
                  )}
                </div>
                {selected && renderSetup(p)}
              </div>
            );
          })}
          <div>
            <Btn variant="ghost" icon="refresh" onClick={() => void detect()} disabled={detecting}>
              {detecting ? "Detecting…" : "Re-detect"}
            </Btn>
          </div>
        </div>
      </Field>

      {info.models.length > 0 && (
        <Field label={`Default model — ${info.label}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 620 }}>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55 }}>
              New chats, workflows, and terminal launches use this model. You can still pick a
              different model for a single chat from its input bar.
            </div>
            {[...info.models, null].map((m) => {
              const id = m?.id ?? null;
              const selected = (modelByProvider[provider] ?? null) === id;
              return (
                <button
                  key={id ?? "__default"}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setModel(id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    textAlign: "left",
                    padding: "10px 14px",
                    background: selected ? "var(--accent-faint)" : "var(--surface-0)",
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    color: "var(--text)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      flexShrink: 0,
                      border: `1px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
                      background: selected ? "var(--accent)" : "transparent",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                    }}
                  >
                    {selected && <Icon name="check" size={9} />}
                  </span>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {m ? m.label : "Provider default"}
                  </div>
                  {!m && (
                    <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                      Let {info.label} choose its own model.
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Field>
      )}
    </SettingsSection>
  );
}
