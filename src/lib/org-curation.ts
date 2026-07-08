import { api, type AppSettings } from "~/lib/api";
import { chatStore } from "~/lib/chat-store";
import { getElectron } from "~/lib/electron";
import type { ProjectWithCounts } from "~/shared/projects";

// Background org-knowledge curation (agreed 2026-07-07): knowledge hygiene is
// the APP's job, not a chore the user schedules in their head. A weekly
// (or on-demand) session runs hidden in the background with writes
// auto-approved — constrained to file tools only (shell blocked at the engine
// level), auditable as a normal task in its host project's session list, and
// archive-first (retire, never delete) so every change is reversible.

export const ORG_CURATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const ORG_CURATION_TITLE = "Knowledge curation";

export function buildOrgCurationPrompt(): string {
  return `You are Concourse's background knowledge janitor. Curate the ORG knowledge folder (its location — and the current fact index — are in your session context under "Org knowledge"). Work autonomously; your file edits apply directly and are audited, so be conservative.

SCOPE: the org knowledge folder ONLY (facts/, archive/, index.md). Do not touch workspace files, code, or anything else. Use file tools only (Read/Write/Edit) — you have no shell.

DUTIES, in order:
1. SPLIT overloaded facts: a fact covering MULTIPLE distinct concepts gets each concept extracted into its own atomic fact with a findable one-line description, cross-linked both ways. (Knowledge buried where its description can't surface it is invisible.)
2. MERGE true duplicates/overlaps into one file per topic, preserving all source attributions and timestamps.
3. ARCHIVE, never delete: expired point-in-time snapshots (kind: point-in-time older than 4 hours) and facts that are clearly superseded move to an archive/ subfolder next to facts/. Keep the file content intact.
4. FLAG staleness you cannot verify: for facts older than ~90 days or contradicting another fact, append a single line "> ⚠ flagged stale by curation <date> — re-verify against source" rather than rewriting content you can't check.
5. Refresh descriptions: every fact's one-line description must surface its content to someone searching — rewrite vague ones.
6. Update index.md to list current active facts.

REPORT: append a dated entry to curation-log.md in the org folder (create if missing): what was split/merged/archived/flagged, one line each, and "no changes needed" when clean. Keep the whole run tight — do not invent work; an empty-handed run that says so is a GOOD run.`;
}

/** True when a background curation run is due. */
export function orgCurationDue(settings: AppSettings, now: number): boolean {
  if (!settings.orgCurationEnabled) return false;
  const last = settings.orgCurationLastRunAt;
  // == null also catches undefined from a pre-0.7 cached settings payload.
  return last == null || now - last > ORG_CURATION_INTERVAL_MS;
}

let launching = false;
let lastCurationTaskId: string | null = null;
let pendingLogOpen = false;

/** The most recent curation task this app-run started (log view binding). */
export function getLastCurationTaskId(): string | null {
  return lastCurationTaskId;
}

/** Notification "View" → Settings/Knowledge consumes this to auto-open the log. */
export function requestCurationLogOpen(): void {
  pendingLogOpen = true;
}
export function consumeCurationLogOpen(): boolean {
  const v = pendingLogOpen;
  pendingLogOpen = false;
  return v;
}

/** Start a hidden background curation session in a host project. Stamps
 *  lastRunAt immediately (before the run) so concurrent mounts can't spawn
 *  twice; the session itself is visible in the host project's session list. */
export async function startOrgCuration(
  projects: ProjectWithCounts[],
  opts: { force?: boolean } = {},
): Promise<string | null> {
  if (launching) return null;
  launching = true;
  try {
    // Host: prefer a CWF business workspace (business projects are always
    // valid, low-traffic hosts); fall back to any project.
    const host =
      projects.find((p) => p.gitEnabled === false) ?? projects[0];
    if (!host) return null;
    const now = Date.now();
    await api.updateSettings({ orgCurationLastRunAt: now });
    const { task } = await api.createTaskInternal(host.id, {
      title: `${ORG_CURATION_TITLE} — ${new Date(now).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      agent: "claude-code",
      mode: "chat",
      claudeSessionId: crypto.randomUUID(),
      // System job: invisible in every session list; its UI is the log view.
      system: true,
    });

    chatStore.start(task.id, {
      cwd: host.path,
      initialText: `<concourse-display>${ORG_CURATION_TITLE}${opts.force ? "" : " (scheduled)"}</concourse-display>\n\n${buildOrgCurationPrompt()}`,
      title: task.title,
      providerSessionId: task.claudeSessionId ?? undefined,
      agent: "claude-code",
      autoApproveWrites: true,
      disallowShell: true,
    });
    lastCurationTaskId = task.id;
    return task.id;
  } catch (e) {
    // Background path has no UI — make failures findable in the app log.
    console.error("[org-curation] launch failed", e);
    getElectron()?.logs.rendererError({
      source: "org-curation",
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    return null;
  } finally {
    launching = false;
  }
}
