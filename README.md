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
- **Knowledge graph**: every run leaves a record; agents check workspace facts
  → global facts → live sources (never serving stale point-in-time numbers),
  and save durable discoveries back behind approvals. `/curate-knowledge` is
  the janitor.
- **Adopt any folder**: adding an empty folder scaffolds a ready workspace;
  adding an existing repo offers an additive-only "Prepare for Concourse" chat
  that repairs integrations with your approval — it never moves or restructures
  files. Machine-local artifacts live in `.concourse/` (locally git-excluded).
- **Share workflows** as OKF bundles — plain-markdown folders that import into
  any workspace, collision-safe.
- Plus: terminals (real PTYs) for engineers, session persistence/resume with a
  Stop button, streaming replies, chat attachments, Word/PDF export of
  outputs, voice control (experimental), sandboxes/remote VMs (beta).

## Architecture in one screen

```
renderer (React, TanStack Start)      — speaks ChatEvent only
  └─ chat UI, approval cards, model picker, markdown preview/export
application/server (src/server)       — projects, commands, knowledge, settings
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

App data lives in the user-data dir (`~/Library/Application
Support/Concourse`).

## Skill file for external CLIs

A drop-in skill for Claude Code / Codex / Cursor CLI lives in
`docs/skills/concourse-notify.md`. Paste it into the CLI's instructions or
memory so the agent knows to POST its lifecycle events back to the app.

## License

[MIT](LICENSE)
