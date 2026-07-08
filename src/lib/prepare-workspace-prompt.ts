// Journey B (agreed 2026-07-03): the "Prepare for Concourse" chat for existing
// folders. The instructions come from the APP — a legacy or plain folder has no
// commands of its own to invoke — and the session runs with normal approvals,
// so every proposed write shows an Approve/Deny card. STRICTLY ADDITIVE: we
// never move, rename, or restructure files that other engineers may depend on.

export const PREPARE_WORKSPACE_TITLE = "Prepare for Concourse";

export function buildPrepareWorkspacePrompt(): string {
  return `You are preparing this existing folder to work well with Concourse (this app). Work in two phases and be strictly ADDITIVE — never move, rename, delete, or restructure existing files; other engineers may depend on them exactly where they are. Do not edit .gitignore.

PHASE 0 — SYNC THE CODE FIRST (git repos only). Analyzing a stale or feature branch produces wrong findings, so before anything else:
1. Check if this is a git repo (git rev-parse --is-inside-work-tree). If not, skip to Phase 1.
2. Read-only status: current branch, default branch (git symbolic-ref refs/remotes/origin/HEAD, falling back to main/master), whether the working tree is dirty (git status --porcelain), and whether there are local commits not pushed upstream.
3. If the tree is CLEAN and has no unpushed commits: switch to the default branch if not already on it, then git pull --ff-only (each command will show an approval card). If pull fails because histories diverged, stop pulling and report it.
4. If the tree is DIRTY or has unpushed commits: do NOT touch it on your own — that is someone's in-progress work. Tell the user what you found (branch name, count of modified files) and OFFER the choice: (a) analyze as-is, or (b) stash → pull --ff-only → stash pop to sync while keeping their changes. Only run the stash sequence if the user explicitly picks it in chat; if the pop conflicts, stop and report — the stash entry keeps their changes safe.

PHASE 1 — ANALYZE (read-only), then report findings as a short summary:
1. Inventory what's here: .claude/ commands and agents (names + one-line purpose each), CLAUDE.md, .mcp.json, any knowledge/ folder.
2. Find broken integration references: tool names matching mcp__claude_ai_* in commands, agents, or .claude/settings.local.json are DEAD (claude.ai connectors don't work in this app) — the working equivalents drop the claude_ai_ prefix (e.g. mcp__claude_ai_Atlassian__searchConfluenceUsingCql → mcp__atlassian__searchConfluenceUsingCql). Note markdown-formatting variants like mcp**...** too.
3. Check for a .mcp.json declaring the MCP servers the commands actually use (infer servers from the tool prefixes you found).
4. Check whether CLAUDE.md tells agents about knowledge-first behavior (checking knowledge before external fetches).

Then list what you propose to change, briefly. Do NOT ask for blanket permission — each file write will be individually approved by the user.

PHASE 2 — REPAIR (each write goes through an approval card):
- Fix dead tool references in place (same files, same structure, only the tool names change).
- Add .mcp.json at the folder root if missing, declaring the servers the commands use (e.g. atlassian → {"type":"http","url":"https://mcp.atlassian.com/v1/mcp/authv2"}).
- APPEND a short "## Knowledge & outputs" section to CLAUDE.md (do not rewrite the rest): check knowledge facts before external queries — this repo's .concourse/knowledge/facts/ plus "the org facts folder announced in your session context (CLAUDE.local.md)"; save repo-scoped facts to .concourse/knowledge/facts/ and org-wide facts to the org folder; keep one living initiative note per multi-session effort in .concourse/knowledge/projects/; write ALL generated deliverables — documents and assets of any kind — straight to .concourse/outputs/<command>/ (ad-hoc chat work: .concourse/outputs/<topic>/) without asking where or whether to save, NEVER to the repo root (.concourse/ is locally git-excluded, so none of this touches the team's tree). CRITICAL: CLAUDE.md is a SHARED, tracked file — never write machine-specific absolute paths (like /Users/<name>/…) into it. Point-in-time numbers are served from knowledge ONLY when the fact is marked kind: point-in-time with a captured datetime within the last 4 hours (labeled "as of <time>", refresh offered); otherwise fetch live.

Finish with a one-paragraph summary of what changed and what the user should do next (e.g. sign into integrations in Settings → Integrations if not already connected). If the folder needs nothing, say so and stop — do not invent work.`;
}
