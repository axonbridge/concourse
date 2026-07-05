import { useEffect, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { api } from "~/lib/api";
import { Field, SettingsSection } from "./SettingsParts";

// Settings → Git: everything a fresh machine needs for full git access
// (clone/commit/push on private repos) without touching a terminal —
// git availability, the commit identity, and SSH key setup for GitHub.

type SshState = { exists: boolean; publicKey?: string; keyPath: string };

export function GitSettingsPage() {
  const [gitInfo, setGitInfo] = useState<{ available: boolean; version?: string } | null>(null);
  const [ssh, setSsh] = useState<SshState | null>(null);
  const [identity, setIdentity] = useState<{ name: string; email: string } | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.gitAvailable().then(setGitInfo).catch(() => setGitInfo(null));
    void api.gitSshStatus().then(setSsh).catch(() => setSsh(null));
    void api
      .gitIdentity()
      .then((id) => {
        setIdentity(id);
        setNameDraft(id.name);
        setEmailDraft(id.email);
      })
      .catch(() => setIdentity(null));
  }, []);

  const saveIdentity = async () => {
    setError(null);
    setSavingIdentity(true);
    try {
      const next = await api.setGitIdentity({ name: nameDraft, email: emailDraft });
      setIdentity(next);
    } catch (e: any) {
      setError(e?.message || "Could not save identity");
    } finally {
      setSavingIdentity(false);
    }
  };

  const generateKey = async () => {
    setError(null);
    setGenerating(true);
    try {
      setSsh(await api.gitSshGenerate());
    } catch (e: any) {
      setError(e?.message || "Key generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const copyKey = async () => {
    if (!ssh?.publicKey) return;
    await navigator.clipboard.writeText(ssh.publicKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const testConnection = async () => {
    setError(null);
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.gitSshTest());
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const mono: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 12 };
  const identityDirty =
    identity !== null && (nameDraft.trim() !== identity.name || emailDraft.trim() !== identity.email);

  return (
    <SettingsSection
      title="Git"
      subtitle="Version control setup — commit identity and SSH access for private repositories."
      headingLevel="h1"
    >
      <Field label="Git">
        <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
          {gitInfo === null
            ? "Checking…"
            : gitInfo.available
              ? `✓ ${gitInfo.version ?? "git installed"}`
              : "Git isn't installed — it ships with Apple's Command Line Tools (run `xcode-select --install`)."}
        </div>
      </Field>

      <Field label="Commit identity">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Recorded on every commit you (or an agent) create. Required before Ship can commit.
          </div>
          <TextField label="Name" value={nameDraft} onChange={setNameDraft} placeholder="Ada Lovelace" />
          <TextField mono label="Email" value={emailDraft} onChange={setEmailDraft} placeholder="ada@example.com" />
          <div>
            <Btn
              variant="solid"
              onClick={() => void saveIdentity()}
              disabled={savingIdentity || !identityDirty || !nameDraft.trim() || !emailDraft.trim()}
            >
              {savingIdentity ? "Saving…" : identity && !identityDirty && identity.name ? "Saved" : "Save identity"}
            </Btn>
          </div>
        </div>
      </Field>

      <Field label="SSH access (GitHub)">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
          {ssh === null ? (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Checking for an SSH key…</div>
          ) : ssh.exists ? (
            <>
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
                ✓ SSH key found (<span style={mono}>{ssh.keyPath}</span>). Add the public key to
                GitHub, then test the connection — after that, private repos clone, pull, and push
                over SSH URLs (<span style={mono}>git@github.com:you/repo.git</span>).
              </div>
              <div
                style={{
                  ...mono,
                  fontSize: 11,
                  padding: "8px 10px",
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  overflowWrap: "break-word",
                  userSelect: "all",
                }}
              >
                {ssh.publicKey}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="solid" icon="copy" onClick={() => void copyKey()}>
                  {copied ? "Copied!" : "Copy public key"}
                </Btn>
                <Btn
                  variant="ghost"
                  icon="globe"
                  onClick={() => window.open("https://github.com/settings/ssh/new", "_blank")}
                >
                  Open GitHub SSH settings
                </Btn>
                <Btn variant="ghost" icon="refresh" onClick={() => void testConnection()} disabled={testing}>
                  {testing ? "Testing…" : "Test connection"}
                </Btn>
              </div>
              {testResult && (
                <div
                  style={{
                    fontSize: 12,
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: `1px solid ${testResult.ok ? "var(--status-done)" : "var(--status-failed)"}`,
                    color: testResult.ok ? "var(--status-done)" : "var(--status-failed)",
                  }}
                >
                  {testResult.message}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
                No SSH key on this machine yet. Generate one, add it to GitHub, and private
                repositories work everywhere in the app — clone, pull, commit, and push.
              </div>
              <div>
                <Btn variant="solid" icon="plus" onClick={() => void generateKey()} disabled={generating}>
                  {generating ? "Generating…" : "Generate SSH key"}
                </Btn>
              </div>
            </>
          )}
        </div>
      </Field>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            border: "1px solid var(--status-failed)",
            borderRadius: 7,
            color: "var(--status-failed)",
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}
    </SettingsSection>
  );
}
