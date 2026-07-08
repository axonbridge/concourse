# Concourse Workspace Standard (CWF)

Every Concourse-owned workspace follows this tree. The empty-folder scaffold
creates it; agents are steered to it by workspace.md conventions. Foreign repos
added via "Prepare for Concourse" are NOT restructured — this standard applies
only to folders Concourse owns.

```
workspace.md          # entry point — identity, conventions (type: workspace)
.mcp.json             # MCP integrations config (no secrets; tokens live in the OS keychain)
commands/             # workflows users run (/weekly-summary …)
agents/               # specialists commands delegate to
skills/               # conventions & knowledge, incl. knowledge-first.md
templates/            # output formats commands follow
knowledge/
  index.md            # knowledge graph entry point
  log.md              # append-only run log            (APP-WRITTEN)
  facts/              # durable workspace-scoped facts (agent-curated, approval-gated)
  notes/              # conversational records: meetings, decisions, *-handoff.md snapshots
  projects/           # PARA-inspired: ONE living note per active initiative — goal,
                      # status, owner, links to its facts/notes/outputs + Confluence page
  archive/            # retired facts & completed initiatives (out of the active index,
                      # never deleted); /curate-knowledge moves things here
  runs/               # one OKF record per workflow run (APP-WRITTEN)
outputs/              # every workflow deliverable — one subfolder per command
  weekly-summary/
.scripts/             # agent-authored helper scripts (reusable tooling, not deliverables)
```

Generated projections (sentinel-marked, never hand-edited; the projector owns
them and rebuilds from the sources above): `CLAUDE.md`, `AGENTS.md`,
`.claude/`, `.opencode/`.

Machine-local, never shared: `CLAUDE.local.md`, `.claude/settings.local.json`
(both git-excluded locally).

**Non-CWF projects (engineering repos)** get the SAME standard as a
machine-local overlay in `.concourse/` (locally git-excluded — the team's tree
is never touched): `.concourse/knowledge/{facts,runs,log.md}` for repo-scoped
knowledge, `.concourse/outputs/<command>/` for deliverables,
`.concourse/attachments/` for chat attachments. Org knowledge stays app-level
either way.

Rules:
- Deliverables → `outputs/<command>/`, never the workspace root.
- Helper scripts → `.scripts/`.
- Org-wide facts do NOT live here — they go to the app's org knowledge folder.
- One file per knowledge topic; update, never duplicate.
- Multi-session efforts get an initiative note in `knowledge/projects/` — the
  one-file answer to "where does this thread live". Handoff notes are dated
  snapshots linked FROM it. Cross-link the team's Confluence PARA project page
  both ways. (Confluence documentation itself stays pure PARA — this maps to
  its Projects; workspaces ARE the Areas; facts/notes are the Resources.)
- Retire, don't delete: stale facts and finished initiatives move to
  `knowledge/archive/` and come off `index.md`.
