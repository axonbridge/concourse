// The chat-header Handoff button sends this app-provided instruction into the
// LIVE session — the one place that actually knows where the user left off —
// so nobody has to phrase the request. The resulting note is what the Share
// knowledge dialog exports (it pre-checks *-handoff notes).

export const HANDOFF_DISPLAY_TEXT = "Write a handoff note for this work";

export function buildHandoffPrompt(): string {
  return `The user needs to hand this work off to a teammate. Write a handoff note NOW:

1. Distill THIS conversation into a note covering: the goal, evidence gathered so far, what was ruled out AND why, the current hypothesis, the exact next steps in order, and links to the relevant files and facts. If this session is fresh and has no work in it, reconstruct from the newest records in knowledge/runs/ and recent facts instead.
2. Save it to knowledge/notes/<yyyy-mm-dd>-<topic>-handoff.md (in a plain repo: .concourse/knowledge/notes/) with frontmatter: type: note, title, description (one line a teammate will recognize), tags, timestamp. The write goes through the normal approval.
   CRITICAL: this note travels to ANOTHER machine — never write machine-absolute paths (/Users/<name>/…) in it. Reference workspace files by workspace-relative path and org facts by their file NAME (e.g. "org fact: jira-story-points-field"), not their location.
3. If durable facts were learned but not yet saved, save them as separate fact files in the right scope. Update the effort's initiative note in knowledge/projects/ (create it if missing) with the current status and a link to this handoff snapshot.
4. Reply with the note's path and remind the user: project menu -> Share knowledge -> Export (the handoff note is pre-checked there).

Do not ask clarifying questions unless the topic is genuinely ambiguous.`;
}
