# Concourse Architecture

How the app is put together, and why. Code comments reference the numbered
sections (`§1`, `§4`, `§5`) — keep the numbering stable.

The two load-bearing ideas:

1. **Files are the contract; engines are visitors.** The durable assets are
   plain-markdown formats — CWF for workspaces (§2), OKF for knowledge (§3).
   Any AI engine executes the same files; none of them owns the data.
2. **One port per concern, one adapter per vendor.** Vendor SDKs and CLIs are
   quarantined behind small interfaces so swapping or adding an engine is one
   file, not a refactor (§1, §5).

## §1 Layers

```mermaid
flowchart TD
    R["Renderer (React + TanStack Start)<br/>chat UI · approval cards · diff view · file browser"]
    S["Application server (src/server)<br/>projects · commands · knowledge · settings<br/>git / docker / tunnel verbs"]
    D["Domain (src/domain — pure TS)<br/>CWF loader + projectors · ActionPolicy<br/>run recorder · OKF bundles"]
    P["Ports (electron/chat/provider.ts)<br/>ChatProvider registry"]
    A["Adapters (electron/chat/providers/)<br/>claude · opencode · codex · cursor · direct"]
    I["Infra (electron/)<br/>MCP client + OAuth · keychain · model catalog<br/>org knowledge · PTYs · sqlite (Drizzle)"]

    R -- "HTTP /api (bearer token)" --> S
    R -- "IPC (ChatEvent only)" --> P
    S --> D
    P --> A
    A --> I
    A --> D
```

Invariants the layering enforces:

- The renderer speaks **ChatEvent** to chats and HTTP to the server — it never
  sees vendor tool names or key material (booleans only cross IPC; secrets
  live in the OS keychain via `safeStorage`).
- Only `electron/chat/providers/claude.ts` may import the Claude Agent SDK.
  Every engine is one adapter file behind the `ChatProvider` port.
- The domain layer is pure TS (no Electron, no HTTP) so policy and formats are
  testable and portable.

## §2 CWF — the workspace format

CWF (Concourse Workspace Format) is the provider-neutral source of truth for
a project's AI setup: `workspace.md` plus `commands/`, `agents/`, `skills/`,
`templates/`, `knowledge/` — markdown with YAML frontmatter, links as
structure. Vendor conventions are **generated projections** of it.

```mermaid
flowchart LR
    subgraph SRC["CWF source (the contract)"]
        W[workspace.md]
        C[commands/*.md]
        AG[agents/*.md]
        SK[skills/*.md]
        T[templates/*.md]
    end

    PJ{{"projector<br/>(src/domain/workspace/projectors)"}}

    subgraph GEN["Generated projections (sentinel-marked, hash-skipped)"]
        CL[".claude/ (commands, agents, skills)"]
        OC[".opencode/command/"]
        MD["CLAUDE.md / AGENTS.md"]
    end

    subgraph INLINE["App-side inlining (no files needed)"]
        CX["codex / cursor JSONL CLIs"]
        DIR["direct engines (OpenAI-compatible)"]
    end

    SRC --> PJ --> GEN
    SRC -- "inline-command.ts at send time" --> INLINE
```

Generated files carry a sentinel comment; the projector owns them (manifest:
`concourse-projection.json`) and skips writes when hashes are unchanged.
Pre-existing `.claude/` content in an adopted repo is treated as a *legacy
source* and fanned out to the other providers too.

## §3 OKF — the knowledge layer

Knowledge follows **OKF (Open Knowledge Format)** — an open spec for agent-
friendly knowledge: every concept is a markdown file whose YAML frontmatter
carries a required `type` plus recommended `title`, `description`, `tags`,
`timestamp`; `index.md` gives progressive disclosure; `log.md` records dated
history; ordinary markdown links are the graph's (untyped, directed) edges.
Consumers must tolerate unknown types/fields — the format is built for
agent-generated growth.

### Three scopes, one protocol

```mermaid
flowchart TD
    subgraph WS["Workspace knowledge (per project)"]
        direction TB
        KI["knowledge/index.md"]
        KF["knowledge/facts/*.md<br/>type: fact"]
        KN["knowledge/notes/*.md<br/>type: meeting-notes · one-on-one · decision"]
        KR["knowledge/runs/*.md<br/>type: run-record"]
        KL["knowledge/log.md"]
    end

    subgraph ORG["Org knowledge (machine-wide)"]
        OI["org-knowledge/index.md"]
        OF["org-knowledge/facts/*.md"]
    end

    LIVE["Live sources<br/>(APIs, web, repos)"]

    SESSION((Every session)) -- "1. check" --> KF
    SESSION -- "2. check" --> OF
    SESSION -- "3. fetch + write back" --> LIVE
```

The **knowledge-first protocol** (scaffolded as a skill, and injected into
every session via the org-knowledge system prompt) is the same everywhere:
workspace facts → org facts → fetch live, then save durable discoveries back
to the right scope. Point-in-time numbers are never served from knowledge.

### Where knowledge lands: workspace vs. repo

One rule decides the physical location (`runRecordRoot`): **does the folder
have a `workspace.md`?**

- **CWF workspace** → knowledge *is* the product; everything goes in
  `knowledge/`, versioned with the workspace.
- **Engineering repo** → a machine-local `.concourse/` overlay holds
  `knowledge/` and `outputs/`, excluded via `.git/info/exclude` (never the
  shared `.gitignore`) so teammates never see it.

### How knowledge gets written

```mermaid
sequenceDiagram
    participant U as User
    participant Chat as Chat session (any engine)
    participant IPC as chat IPC (run tracer)
    participant K as knowledge/

    U->>Chat: /command … or plain message
    Note over IPC: every turn opens a run trace<br/>(command name, engine, model, t₀)
    Chat->>K: agent writes files (facts, notes, outputs)
    Note over Chat: meeting notes / 1:1s / decisions →<br/>knowledge/notes/&lt;date&gt;-&lt;slug&gt;.md (OKF concept)
    Chat-->>IPC: Write/Edit tool events observed
    Chat-->>IPC: turn settles (awaiting-input / error / stopped)
    alt command ran, or chat turn wrote files
        IPC->>K: runs/<date>-<cmd|chat>.md (type: run-record)
        IPC->>K: append dated line to log.md
        IPC->>K: ensure index.md
    else plain Q&A, nothing written
        IPC->>IPC: trace discarded — no record
    end
```

Two producers, deliberately different:

- **The app** writes *run records* deterministically from ChatEvents — every
  engine gets this for free, no engine cooperation needed.
- **The agent** writes *facts and notes* by following the protocol in its
  instructions — conversational content (meeting notes shared in a chat, a
  1:1, a decision) becomes a first-class OKF concept in `knowledge/notes/`,
  with durable facts extracted into `facts/` and linked as edges.

### Sharing: OKF bundles

A workflow exports as a plain-markdown folder — `index.md` manifest + the
command + its agents/skills/template, mirroring workspace layout. Any
workspace imports it collision-safe; any assistant without Concourse can
activate it by reading `index.md` and following links.

## §4 Approval policy

Approvals are decided in the domain from **capability classes**, never from
vendor tool names in UI code. Each adapter maps its native tools to an
`ActionClass`; `decideAction` returns allow/ask; the renderer's Approve/Deny
card is the "ask" surface.

```mermaid
flowchart LR
    T["vendor tool name<br/>(Write, Bash, mcp__jira__…)"] --> M["adapter mapping<br/>(classifyClaudeTool, ToolBroker)"]
    M --> CLS["ActionClass<br/>read · external-read · write · external-write · execute"]
    CLS --> POL{"decideAction<br/>(src/domain/policy)"}
    POL -- allow --> RUN[runs]
    POL -- ask --> CARD["Approve / Deny card"]
```

| class | default | `autoApproveWrites` | `dangerouslySkipApprovals` |
|---|---|---|---|
| read, external-read | allow | allow | allow |
| write | ask | **allow** | allow |
| execute, external-write | ask | ask | **allow** |

`autoApproveWrites` is the workflow builder's narrow unlock;
`dangerouslySkipApprovals` is the per-session shield toggle the user arms
before the first message (Codex chats map it to `danger-full-access`, lifting
the OS sandbox).

## §5 Engines

Two kinds of engine sit behind the same `ChatProvider` port:

| kind | adapters | how commands run | approvals |
|---|---|---|---|
| **harness** | claude (Agent SDK), opencode (server API), codex + cursor (JSONL CLIs) | native slash commands via projections, or app-side inlining | SDK callback (claude/opencode); pre-set sandbox, labeled honestly (codex/cursor) |
| **direct** | any OpenAI-compatible API (OpenAI, OpenRouter, Ollama, custom) | system-prompt inlining + a ToolBroker loop | per-action via ActionPolicy |

Harness sessions pin their model at start; direct engines are stateless per
request, so their model picker stays live mid-conversation. Model lists come
from a static registry upgraded by live discovery (`electron/models/`).

## §6 Runtime topology

```mermaid
flowchart TD
    subgraph MAC["Electron app"]
        MAIN["main process<br/>windows · IPC · PTYs · keychain · chat adapters<br/>electron-log (+ support bundle)"]
        RND["renderer window"]
        SRV["server subprocess (node)<br/>TanStack Start · sqlite<br/>stdio piped → main log"]
    end
    CLI["engine CLIs / SDKs<br/>claude · codex · opencode · cursor"]
    EXT["tunnels · docker · git remotes"]

    RND <--> MAIN
    RND -- "HTTP :port (bearer)" --> SRV
    MAIN -- spawns --> SRV
    MAIN -- spawns --> CLI
    SRV -- "execFile" --> EXT
```

Dev mode swaps the server subprocess for Vite (`pnpm dev`, port 5173, data in
`.dev-userdata/`); packaged builds write the chosen port to a `.port` file in
the user-data dir. Crashes from all three surfaces (main, renderer, server)
land in one rotating log file, exportable as a support bundle from
Settings → General.

## §7 Status & empirical findings (2026-07-06)

Everything above is **shipped and user-verified** across all five engines
(Claude, OpenCode, Codex*, Cursor*, direct OpenAI-compatible — *built,
awaiting their CLIs for live testing).

- **Workspace standard**: the normative folder spec lives in
  [WORKSPACE-STANDARD.md](./WORKSPACE-STANDARD.md) — including `outputs/<command>/`,
  `.scripts/`, and the `.concourse/` machine-local overlay for engineering repos.
- **Integrations, three layers**: global config (personal, all projects) →
  workspace `.mcp.json` (shareable contract, wins collisions) → keychain tokens
  (by server URL — one sign-in covers every project).
- **Two MCP server archetypes (tested)**: spec-compliant servers with dynamic
  client registration (e.g. Atlassian) work on every engine via the in-app
  client; connector-class servers (Google's calendarmcp/drivemcp/gmailmcp)
  refuse third-party clients and work only on the Claude engine via the CLI's
  own login. Status honestly separates "connected" from "signed in".
- **Knowledge**: two scopes (workspace + org), knowledge-first protocol on all
  read-heavy commands (stable facts served with citation + "refresh" escape;
  point-in-time numbers never served from knowledge), app-written run records,
  `/curate-knowledge` janitor. Org knowledge is machine-local v1; git-synced
  sharing is the planned v2. Seed facts: `docs/org-knowledge-seed/`.
- **Next frontier**: team rollout (pushing prepared repos + shared org
  knowledge), signing/notarization for distribution.

## §8 Knowledge retrieval — why there is no scoring algorithm (2026-07-06)

Relevance is deliberately NOT computed by us — no embeddings, no vector store,
no ranking math. Three delegation mechanisms:

1. **Workspace & org knowledge: the model is the ranker.** Every session's
   prompt carries an inline fact index — each fact's path plus its frontmatter
   `description` (capped at 100 entries, `factIndexLines` in
   `electron/knowledge/org-store.ts`). The model reads the index, decides
   relevance, and `Read`s the file. Consequence: **the one-line description IS
   the retrieval system** — a vague description makes a fact invisible, which
   is why save-back instructions demand a recognizable one-liner and
   `/curate-knowledge` maintains them. Fact-to-fact markdown links (OKF: links
   are graph edges) let the model traverse to related concepts.
2. **Confluence/Jira: Atlassian's search engine ranks.** The model writes
   CQL/JQL through the MCP tools and iterates; our contribution is prompt-side
   (which spaces/projects to search) plus learned quirks saved as facts.
3. **Repos: grep and structure.** No index — symbol search and import-following
   like an engineer.

Epistemics rule (added after live testing 2026-07-06): answers that mix saved
knowledge with reasoning must SEPARATE the two — verified-with-citations vs
inference-not-verified — by default, in every knowledge prompt layer.

**The known cliff: ~100 org facts**, where the inline index stops scaling.
Documented revisit point (see the graphify decision in the plan): add a
retrieval tool (indexed search over facts, or a graphify-style overlay) rather
than growing the prompt. At single-digit fact counts, an LLM reading a
well-described index beats cosine similarity, costs nothing to maintain, and
stays fully inspectable.

## §9 Self-maintaining knowledge (2026-07-07)

Knowledge hygiene is the APP's responsibility, not a chore users schedule in
their heads (user decision 2026-07-07: fully background, auto-applied).

**Background curation job** (`src/lib/org-curation.ts`): weekly (or via
Settings → Knowledge → "Curate now"), the app spawns a hidden chat session
that curates the ORG knowledge folder — split overloaded facts into atomic
cross-linked concepts, merge duplicates, archive expired point-in-time
snapshots (retire, never delete), flag unverifiable staleness, refresh
descriptions (the retrieval keys), update index.md. Containment instead of
approval cards: writes are auto-approved BUT the session runs with
`disallowShell` (Bash blocked at the engine's disallowedTools level — file
tools only), its prompt scopes it to the org folder, every run appends to
`org-knowledge/curation-log.md`, and the session itself is a normal task in a
host project's session list — visible and replayable, never a hidden process.
Anything that would still raise a card (an external write it has no business
making) pauses the task in Needs-your-approval and rings the bell — graceful
degradation, not silent power. Scheduling is a renderer-side check (Shell
mount): `orgCurationLastRunAt` stamped at spawn to prevent duplicate runs.
Workspace-scoped curation stays per-workspace via `/curate-knowledge`.

**Knowledge graph view** (Settings → Knowledge): the graphify concept
surfaced — facts are nodes, markdown links are edges, rendered as a
deterministic circular SVG (readable to ~40 nodes; a force layout or real
graph index is part of the ~100-fact cliff plan in §8). Hollow nodes (no
links) are curation targets. The panel also shows the fact count against the
index cliff, the curation schedule, and click-to-read for every fact — the
org brain, visible without opening a project.
