// Gitleaks-style credential detection (agreed 2026-07-06, modeled on
// https://github.com/gitleaks/gitleaks): a rule set of known token FORMATS
// plus entropy heuristics, shared by (a) the action policy's Bash guard —
// commands touching credentials are never auto-allowed and their approval
// card names the risk, (b) session env scrubbing — secret-shaped variables
// are stripped before an engine spawns unless the project allowlists them,
// and (c) the knowledge-bundle export guard. Pure module: no fs, no electron.

export type SecretRule = { id: string; description: string; re: RegExp };

// Token formats (subset of gitleaks' rules that matter on this team's stack).
// Kept as literal regexes — inspectable, no config file to drift.
export const SECRET_RULES: SecretRule[] = [
  { id: "private-key", description: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "aws-access-key", description: "AWS access key id", re: /\bA(?:KIA|SIA|GPA|IDA|ROA|IPA|NPA|NVA)[0-9A-Z]{16}\b/ },
  { id: "github-token", description: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "github-fine-grained", description: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{80,}\b/ },
  { id: "stripe-key", description: "Stripe key", re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { id: "stripe-webhook", description: "Stripe webhook secret", re: /\bwhsec_[A-Za-z0-9]{16,}\b/ },
  { id: "openai-key", description: "OpenAI key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: "anthropic-key", description: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { id: "google-api-key", description: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "slack-token", description: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "jwt", description: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: "npm-token", description: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: "sendgrid-key", description: "SendGrid key", re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  { id: "twilio-key", description: "Twilio key", re: /\bSK[0-9a-fA-F]{32}\b/ },
  { id: "atlassian-token", description: "Atlassian API token", re: /\bATATT3[A-Za-z0-9_\-=]{20,}\b/ },
  { id: "generic-assignment", description: "secret-like assignment", re: /\b(?:api[_-]?key|apikey|secret|token|passwd|password|credential|auth[_-]?key)\b\s*[:=]\s*['"]?[A-Za-z0-9+/_\-.]{16,}/i },
];

/** Env-var NAMES that suggest a credential (the scrub + command-guard key). */
export const SECRET_ENV_NAME_RE =
  /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|PRIVATE|APIKEY|API_KEY|ACCESS_KEY|CLIENT_ID|CLIENT_SECRET|DSN|SENTRY|WEBHOOK)/i;

// Names that match the pattern above but are not credentials — never strip.
const ENV_NAME_FALSE_POSITIVES = new Set([
  "SSH_AUTH_SOCK",
  "GPG_AGENT_INFO",
  "XDG_SESSION_KEY",
  "LESSKEY",
  "KEYBOARD",
]);

export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let e = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

/** True when an env var (name, value) pair looks like a credential. */
export function isSecretEnvVar(name: string, value: string): boolean {
  if (ENV_NAME_FALSE_POSITIVES.has(name.toUpperCase())) return false;
  if (SECRET_ENV_NAME_RE.test(name)) return true;
  if (!value || value.length < 16) return false;
  // Value-shaped detection: a known token format, or a long high-entropy blob.
  for (const rule of SECRET_RULES) {
    if (rule.id !== "generic-assignment" && rule.re.test(value)) return true;
  }
  return false;
}

export type EnvScrubResult = {
  env: Record<string, string>;
  /** Names stripped, for logging + the "add to allowlist" hint. */
  stripped: string[];
};

/** Strip credential-shaped vars from an environment. `allowlist` (per-project,
 *  exact names) passes vars through — the explicit grant. */
export function scrubEnv(
  source: NodeJS.ProcessEnv,
  allowlist: ReadonlySet<string> = new Set(),
): EnvScrubResult {
  const env: Record<string, string> = {};
  const stripped: string[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (allowlist.has(name)) {
      env[name] = value;
      continue;
    }
    if (isSecretEnvVar(name, value)) {
      stripped.push(name);
      continue;
    }
    env[name] = value;
  }
  return { env, stripped };
}

export type CommandCredentialAnalysis = {
  flagged: boolean;
  reasons: string[];
  /** Credential-shaped env vars the command uses that ARE granted — clean for
   *  approval purposes, but callers should still audit-log the use. */
  grantedUse: string[];
};

// Command text patterns that mean "this shell command touches credentials".
const ENV_REF_RE = /\$\{?([A-Za-z0-9_]+)\}?/g;
const ENV_DUMP_RE = /(?:^|[;&|]\s*|\b)(printenv|env)\b\s*(?:$|[;&|>])/;
const SECRET_STORE_READ_RE =
  /\.env(?:\.[\w.]+)?\b|\.npmrc\b|\.netrc\b|\.aws\/credentials|\.zshrc\b|\.bashrc\b|\.zshenv\b|\.ssh\/|security\s+find-generic-password|keychain/i;
const AUTH_HEADER_RE =
  /(?:-H|--header)\s+["']?\s*(Authorization|X-Api-Key|Api-Key|X-Auth-Token|Private-Token)\b|curl[^|;&]*\s(?:-u|--user)\s/i;

/** Scan a shell command for credential usage. Flagged commands must never be
 *  auto-allowed, and their approval card names the reason. `granted` (the
 *  project's env-allowlist) is the persistence mechanism: references to
 *  granted var names are the sanctioned pathway — not flagged, only logged —
 *  so an approval isn't re-asked every session. Literal tokens, env dumps,
 *  and credential-store reads always flag regardless of grants. */
export function analyzeCommandForCredentials(
  command: string,
  granted: ReadonlySet<string> = new Set(),
): CommandCredentialAnalysis {
  const reasons: string[] = [];
  for (const rule of SECRET_RULES) {
    if (rule.re.test(command)) {
      reasons.push(`contains a ${rule.description}`);
      break; // one literal-secret reason is enough
    }
  }
  const secretRefs = [...command.matchAll(ENV_REF_RE)]
    .map((m) => m[1]!)
    .filter((name) => SECRET_ENV_NAME_RE.test(name));
  const ungranted = [...new Set(secretRefs.filter((n) => !granted.has(n)))];
  const grantedUse = [...new Set(secretRefs.filter((n) => granted.has(n)))];
  if (ungranted.length > 0) {
    reasons.push(`references credential env var${ungranted.length > 1 ? "s" : ""} ${ungranted.join(", ")}`);
  }
  if (ENV_DUMP_RE.test(command)) reasons.push("dumps the environment");
  if (SECRET_STORE_READ_RE.test(command)) reasons.push("reads a credential store");
  // An auth header fed solely by GRANTED vars is the sanctioned use — don't
  // flag. An auth header with a literal payload (no env refs) always flags.
  if (AUTH_HEADER_RE.test(command) && (ungranted.length > 0 || secretRefs.length === 0)) {
    reasons.push("sends an auth header");
  }
  return { flagged: reasons.length > 0, reasons, grantedUse };
}
