# Concourse

The personal AI workspace. Every project gets a workspace of plain-markdown
commands, agents, skills, and knowledge; any AI engine — Claude Code, OpenCode,
Codex, Cursor, or any OpenAI-compatible API (OpenAI, OpenRouter, Ollama, custom
endpoints) — executes the same files. Work in a chat window with approval
cards, or keep your terminal. Everything an agent learns lands in a shared
knowledge graph so you stop re-answering the same questions.

**Core principle: files are the contract; engines are visitors.** The durable
asset is the workspace format (CWF — markdown + YAML frontmatter + links,
OKF-aligned), not any vendor's convention. `.claude/`, `AGENTS.md`, and
`.opencode/command` are *generated projections* of the same source files.

## What it does

- **Workspaces**: project folders with commands like `/ask`, `/doc` — picked
  from a UI, run in a chat, no terminal required. A workflow builder
  (`/create-workflow`) lets you create new commands conversationally.
- **Any engine, one experience**: pick a provider in Settings → AI (CLI login
  or keychain-encrypted API key), pick a model from live discovery in the chat
  input bar, and run. Reads flow; writes and external actions stop at an
  Approve/Deny card (per-tool on Claude/OpenCode; pre-set-and-labeled on
  Codex/Cursor).
- **Integrations follow you**: each workspace declares its MCP servers in
  `.mcp.json` (remote HTTP or local stdio); sign in once (built-in OAuth,
  tokens in the OS keychain) and the integration works on every engine —
  including Jira/Confluence on a GPT model.
- **Knowledge graph (OKF)**: knowledge follows the Open Knowledge Format —
  markdown concept files with typed frontmatter, linked into a graph. Every
  command run (and any chat that writes files) leaves a run record; meeting
  notes, 1:1s, and decisions shared in chat are captured as concept notes;
  agents check workspace facts → org facts → live sources (never serving
  stale point-in-time numbers) and save durable discoveries back behind
  approvals. `/curate-knowledge` is the janitor.
- **Adopt any folder — or clone one**: adding an empty folder scaffolds a
  ready workspace; adding an existing repo (local or cloned by URL from the
  Add Project dialog) offers an additive-only "Prepare for Concourse" chat
  that repairs integrations with your approval — it never moves or
  restructures files. Existing `.claude/` commands/agents/skills fan out to
  every provider automatically. Machine-local artifacts live in `.concourse/`
  (locally git-excluded).
- **Git without the terminal**: Review Changes shows staged/unstaged diffs
  with syntax colors, per-file and bulk accept/discard, Pull, a clickable
  branch switcher that enforces `<type>/<description>` naming on new branches,
  and a branch manager for remote+local deletes. Ship generates a
  Conventional-Commit message (`type(scope): subject`) from the staged diff
  and opens it for review before commit & push. Settings → Git sets up
  recommended defaults, the GitHub CLI, SSH keys, commit identity, and commit
  signing with one click each.
- **Browse Files**: a full project tree with an editable code pane —
  Catppuccin themes that follow light/dark mode, rainbow brackets, code
  folding, jump-to-matching-bracket, and conflict-safe saves with
  external-change detection.
- **Docker-first apps**: projects with a compose file get a header pill
  showing service health, with start/stop/restart for the whole stack and
  engine detection/launch (Docker Desktop, Rancher Desktop, OrbStack).
- **Share a running app**: expose a local port as a private tailnet URL
  (Tailscale serve) or a public link (cloudflared, ngrok, or Tailscale
  Funnel) without deploying — with in-app one-click installs for the tunnel
  tools. Viewers just open the URL.
- **Share workflows** as OKF bundles — plain-markdown folders that import into
  any workspace, collision-safe.
- Plus: terminals (real PTYs) for engineers, one-click install + sign-in for
  the AI CLIs (works on machines without npm or git), session
  persistence/resume with a Stop button that lets a new prompt redirect the
  conversation, a per-session "dangerously skip approvals" toggle, streaming
  replies, chat attachments (picker or drag-and-drop), session-card avatars
  (image/monogram/icon/color), Word/PDF export of outputs, voice control
  (experimental).

## Architecture in one screen

The full picture — layers, CWF projections, the OKF knowledge flow, approval
policy, and runtime topology, with diagrams — lives in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
renderer (React, TanStack Start)      — speaks ChatEvent only
  └─ chat UI, approval cards, model picker, markdown preview/export
application/server (src/server)       — projects, commands, knowledge,
                                        settings, git/docker/tunnel verbs
domain (src/domain — pure TS)         — CWF loader/projector, ActionPolicy,
                                        run recorder, OKF bundles
ports (electron/chat/provider.ts)     — ChatProvider / engines registry
adapters (electron/chat/providers/)   — claude.ts (Agent SDK) · opencode.ts
                                        (server API) · codex.ts · cursor.ts
                                        (JSONL CLIs) · direct.ts (OpenAI-
                                        compatible loop + ToolBroker)
infra (electron/)                     — in-app MCP client + OAuth (mcp/),
                                        keychain credentials (credentials/),
                                        model catalog (models/), org knowledge
                                        (knowledge/), PTYs, sqlite (Drizzle)
```

Key invariants:

- Only `electron/chat/providers/claude.ts` may import the Claude Agent SDK;
  every engine is one adapter file behind the `ChatProvider` port.
- Approval policy is decided in the domain
  (`src/domain/policy/action-policy.ts`) from capability classes, never from
  vendor tool names in UI code.
- Key material (API keys, OAuth tokens) never crosses IPC to the renderer —
  booleans only. Encrypted at rest via the OS keychain (`safeStorage`).
- Generated files carry a sentinel comment; the projector owns them and
  hash-skips when sources are unchanged.

## Dev setup

Requirements: **Node 24.x** (pinned via Volta — a Node 25 shell breaks the
better-sqlite3 ABI in tests), pnpm via corepack, macOS (Windows/Linux are
designed-for but untested), Xcode CLT for native modules.

```bash
# native module builds on macOS need the SDK's libc++ headers
export CPLUS_INCLUDE_PATH="$(xcrun --show-sdk-path)/usr/include/c++/v1"

pnpm install
pnpm dev          # vite + electron; dev data lives in .dev-userdata/
```

Notes:

- `pnpm dev` launches the app window; closing the window stops the dev server.
  Renderer/CSS edits hot-reload (Cmd+R if stale); changes under `electron/`,
  `src/server` routes, or the db schema need a relaunch.
- AI engines: Claude Code uses your existing `claude` CLI login (or an API key
  from Settings → AI); OpenCode needs `opencode` installed + `opencode auth`;
  direct engines need an API key (or a running Ollama).

## Checks

```bash
npx tsc --noEmit                            # app typecheck
npx tsc -p electron/tsconfig.json --noEmit  # electron typecheck
volta run --node 24.18.0 pnpm test          # vitest
```

Known flaky under the full parallel suite (each passes in isolation):
`worktrees.test.ts`, `agent-hooks-api.test.ts`, `opencode-hooks-api.test.ts`.

## Packaging

```bash
pnpm dist:mac     # or dist:win / dist:linux — untested platforms
```

Outputs land in `dist-electron-out/` (app + shareable DMG). Builds are
currently ad-hoc signed (no Developer ID), which has two consequences:

- **Local install**: copy with `ditto` and re-sign — a plain `cp -R` corrupts
  the ad-hoc signature and the app crashes on launch with a dyld Team ID
  mismatch:

  ```bash
  ditto dist-electron-out/mac-arm64/Concourse.app /Applications/Concourse.app
  codesign --force --deep --sign - /Applications/Concourse.app
  ```

- **Sharing the DMG**: recipients must right-click → Open on first launch to
  pass Gatekeeper.

App data lives in the user-data dir (`~/Library/Application
Support/Concourse`); dev data is separate (`.dev-userdata/`).

## License

[MIT](LICENSE)
