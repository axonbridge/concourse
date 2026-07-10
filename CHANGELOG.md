# Changelog

All notable changes to this project, newest first.

## 0.7.4

- ✨ exports wear the compact professional card layout: navy titles with a centered header and teal rule, rounded pale-blue emoji section bars with a teal edge, blockquotes as rounded light cards with subtle blue borders, uppercase labels, and teal clickable links — in both Word and PDF
- ✨ task lists export as real checkboxes: `- [ ]` / `- [x]` become ☐/☑ (blue-gray pending, green done) that print consistently and survive Word's importer, which drops form controls
- ✨ PDF pages are US Letter with narrow 0.5in margins — nearly full printable width, compact and phone-readable; Word documents open with the same page setup instead of Word's defaults
- ✨ exported mermaid diagrams match the new palette: teal-bordered pale-blue nodes with navy text

## 0.7.3

- ✨ documents now follow the Meridian design system (DESIGN.md): Poppins headlines + DM Sans body, primary-blue title rule, tonal surface panels and soft ghost rules instead of hard lines, neutral-ink text — in Word, PDF, and exported diagrams
- ✨ diagrams speak Meridian too: primary-blue nodes by default, and sessions author color-by-meaning with the brand tints (blue process, amber decision, orange output, neutral input, ink-outlined external)
- 🐛 .DS_Store and other hidden OS files no longer show up in the Outputs & knowledge panels
- 🐛 session-card action icons (edit / pin / archive) no longer sit on top of long titles — the title now reserves exactly the space the buttons occupy
- 🐛 mermaid diagrams no longer flicker between diagram and raw code while a session streams — rendered diagrams stay mounted and re-appear instantly from cache
- 🐛 reopening a session after a restart no longer drops you at the top of a half-loaded transcript: a brief "Loading conversation…" veil covers the replay, then the chat reveals scrolled to the latest message; in-memory reopens and live chatting never see it
- ✨ hover any chat bubble to copy it: a copy button appears beside the message and puts its markdown on your clipboard (icon flashes green when copied)
- ✨ every file in Outputs & knowledge shows its last-updated date (time for today's files), and files sort newest-first within each group
- ✨ clicking a non-markdown file (like an .xlsx) now reveals it in Finder instead of launching whatever app claims it — you choose what opens it
- ✨ handoff bundles now carry documents: the Share knowledge dialog lists the project's outputs/ files (ones referenced by a handoff note are pre-checked), they travel inside the bundle under outputs/, and import places them without ever overwriting existing deliverables
- ✨ attachments can travel too: screenshots and other chat inputs appear as an opt-in section in Share knowledge (binary-safe, up to 5MB each), landing in the teammate's attachments folder on import
- ✨ knowledge handoffs export as a single .zip — one file to drop in Slack instead of a folder; import accepts the zip, an unzipped bundle folder, its index.md, or a legacy .json (inside the zip it's still plain readable files)
- ✨ every conversation's attachments are remembered: attaching files writes a line to attachments-log.md ("which conversation attached what"), the Outputs panel shows an Attachments group (Session scope = this conversation's files), and sessions are told to check the log when you reference an earlier screenshot — no re-attaching

## 0.7.2

- ✨ exports carry the house document style: Word and PDF got a styled document shell — indigo title rule, hairline section rules, lavender callout panels, tinted table headers, styled code chips
- ✨ exported diagrams are colorful: mermaid renders with its classic pastel theme in documents, honoring per-node colors — and sessions now author diagrams with the house palette (blue inputs, green processes, yellow decisions, purple external systems, orange outputs) unless you ask for plain
- ✨ "Open in directory" in the export menu reveals the document in Finder, and every "Exported …" toast gains a Show button that jumps to the saved file
- ✨ documents avoid typographic notation (no "§4" — sessions write "section 4"), keeping exports meeting-readable
- ✨ chat header reordered: New session · Outputs · ⋯ · close — Outputs gets its own button back, the ⋯ menu keeps Handoff and Make-workflow

## 0.7.1

- ✨ mermaid diagrams render visually: a ```mermaid block in any chat message or markdown preview now draws the actual flowchart/sequence diagram (theme-matched, scrollable if wide) instead of showing raw diagram code
- ✨ diagram-aware exports: Word and PDF exports convert each diagram to a crisp light-themed image, so a doc written with mermaid diagrams leaves the app looking the way it reads on screen
- ✨ diagrams are the default: ask any session for a diagram, flow, or breakdown and it authors mermaid inside a markdown file in outputs/ first (rendered live, export-ready), then walks you through it — unless you ask for a specific format
- ✨ exported diagrams span the full page width in Word and PDF instead of rendering postage-stamp small, rasterized at 3x so they stay crisp
- ✨ pop a document into its own window: the preview panel's ↗ button now opens the document in a full-size Concourse window (live diagrams, Word/PDF export, theme-matched) — from there, ↗ still hands off to the OS default app
- ✨ the knowledge count now tells the whole story: shared org facts AND local project facts & notes, each with its own number
- ✨ graph dots open on double-click — releasing a drag no longer accidentally pops the fact open

## 0.7.0

- ✨ paste an image straight into the chat input — a copied screenshot becomes an attachment like the upload button or drag-and-drop
- ✨ graph dots are draggable — arrange the map how you think; knowledge branches visually from ring hubs (org / each project), so you can see where every piece lives; Reset view restores the layout
- ✨ the knowledge graph now shows ALL knowledge, not just org facts: every workspace's facts, notes, and initiative notes join the picture (org = accent, workspace = green, hollow = unlinked), with cross-scope links drawn
- 🐛 non-image attachment chips (like a .json export) ballooned to the height of neighboring image thumbnails — they're proper little pills now
- 🐛 sessions were double-saving learnings into Claude's private memory drawer alongside the shared knowledge — those writes are now refused (the AI's own CLI outside the app is unaffected), so knowledge lives in exactly one place
- ✨ conversations that reach a milestone now leave files behind: an approved final draft saves to outputs/, a decision you worked out becomes a knowledge note — automatically and without asking; anything outward-facing (Jira comments, Confluence updates) still gets one quick confirmation first
- ✨ "Make this a workflow": one click turns the conversation you just had into a reusable command — the chat itself is the interview (goal, inputs, working steps, output format extracted automatically); chat actions (Handoff, Make workflow, Outputs) now live in a tidy ⋯ menu
- ✨ private projects: a per-project toggle (edit project) that makes org knowledge read-only for its sessions — they can still read and cite shared facts, but everything learned stays local (writes to the org store are refused by the engine, not just discouraged); for personal or sensitive work that shouldn't feed the shared brain by accident
- ✨ self-maintaining knowledge: a weekly background job curates the org brain automatically — splitting overloaded facts, merging duplicates, archiving expired snapshots, refreshing descriptions — with every change logged to curation-log.md; no shell access, file tools only
- ✨ curation runs as a true system job: invisible in every session list, a quiet "Knowledge curation finished" toast with a View button when done, and "Curate now" opens a live log view of what the janitor is doing — closable anytime without stopping the run
- ✨ the knowledge graph is interactive: full width, zoom buttons, drag to pan, reset view; the facts list shows just the count (built for thousands), with every fact still readable via its graph node
- ✨ Settings → Knowledge: see the whole org brain in one place — every shared fact with its description, the curation schedule with a "Curate now" button, and a knowledge graph view (facts as nodes, links as edges) that shows unconnected knowledge at a glance

## 0.6.0

- ✨ atomic knowledge: a distinct concept learned mid-investigation (like an e-signature rule discovered during ELTV work) now gets its own cross-linked fact instead of being buried in a related one — and /curate-knowledge learned to split overloaded facts, so the knowledge graph keeps refactoring itself as it grows
- ✨ PARA-aligned knowledge: multi-session efforts get one living initiative note in knowledge/projects/ (goal, status, owner, links — the one-file answer to "where does this thread live"), stale material retires to knowledge/archive/ instead of being deleted, and both show in the Outputs & knowledge views; Confluence documentation stays pure PARA and cross-links the initiative note
- 🐛 reopening a session no longer glitches: the transcript jumps straight to the latest message instead of animating through the whole history, auto-scroll only follows when you're already at the bottom, and app-started sessions (like Prepare for Concourse) replay with their title instead of the full internal prompt
- 🐛 switching projects from the header dropdown carried the open chat along under the new project's name — you could type into a session while the breadcrumb showed a different project; project switches now close project-scoped views
- 🐛 reopening a session that used the Handoff button (or attachments) showed the raw internal prompt instead of the friendly label, which read like the conversation had been rewritten — replays now show what you originally saw
- ✨ auto-approve and model choice now survive restarts: both persist per session, the shield can be toggled mid-conversation (applies from the next action), and switching a Claude session's model reconnects the same conversation on the new model
- 🔒 durable learnings live in one place: in Concourse workspaces the AI's private scratch memory is turned off, so everything it learns lands in workspace/org knowledge — visible, shareable, and curated (engineers' own repos are untouched)
- 🐛 importing a bundle that contains only a handoff note failed silently — note-only bundles now import, and a bundle that can't be read shows an error instead of doing nothing
- 🔒 credential guardrails (gitleaks-style): AI sessions now run with a scrubbed environment — API keys, tokens, and secret-shaped variables are stripped before the engine starts; a project grants specific variables by name in `.concourse/env-allowlist`
- 🔒 grants persist per project: once a variable is allowlisted, commands using it stop re-asking every session (still audit-logged); ungranted vars, literal tokens, env dumps, and credential-store reads always require approval
- 🔒 any shell command that touches credentials (auth headers, secret env vars, env dumps, reads of .env/keychain/credential stores, literal tokens) is never auto-run — it always raises an approval card that names the risk: "⚠ Uses a credential (…)"
- 🔒 credential approvals pierce the auto-approve shield: even with "dangerously skip approvals" on, a command using an ungranted credential still stops for approval — the shield skips routine actions, never silent secret use
- 🔒 audit trail: every credential-flagged command — requested, approved, or denied — is logged
- 🔒 the same detection rules now power the Share-knowledge export guard (broader token coverage: GitHub fine-grained, Anthropic, Atlassian, JWTs, npm, SendGrid, Twilio…)

## 0.5.0

- ✨ honest answers by default: when a reply mixes saved knowledge with the AI's own reasoning, it now labels which parts are verified (with citations) and which are inference — no need to ask
- ✨ What's new in Settings: this changelog, rendered in-app (last 15 versions) so people can see what changed in the build they're running
- ✨ the chat's Outputs panel is session-scoped by default — it shows what THIS session created or updated, with a Session/All toggle; org-wide shared facts now appear under "knowledge · org (shared)"
- ✨ Knowledge & outputs browser (project menu): the full history of everything the AI has produced — sectioned like the panel, newest first with dates, filename search, markdown preview with Word/PDF export
- 🐛 file links containing spaces (like the org-knowledge path under "Application Support") rendered as literal text instead of clickable links — fixed in the renderer, and sessions now write parseable links
- 🐛 on non-git folders the hidden git UI flickered back in while the status poller retried — the not-a-repo verdict now latches until a successful git status clears it

## 0.4.0

- ✨ Share knowledge: export a project's knowledge facts (+ opt-in notes) with workflows attached as one portable bundle — a teammate imports it and starts from that foundation; secrets, machine paths, and point-in-time snapshots are blocked from export; imported facts merge keep-newer (never duplicated) with provenance stamps
- ✨ "Import knowledge or workflow…" in the project menu, right under Share knowledge — one picker auto-detects which kind of bundle you chose
- 🐛 folders that aren't git repos no longer show a forever-"Checking…" branch pill and a Ship button that can only fail — git UI hides itself and comes back if the folder gains a repo
- ✨ Handoff button in the chat header: one click distills the conversation into a where-I-left-off note (goal, evidence, ruled out + why, next steps) that Share knowledge pre-checks — hand an investigation to a teammate mid-task; handoff notes use relative paths and org-fact names so they work on the teammate's machine
- ✨ the chat's Outputs panel is now "Outputs & knowledge": deliverables grouped by command, plus the facts and notes the AI saved — every file it generates is one click away (md → preview, everything else opens natively)
- ✨ Word/PDF without converters: the AI now points at the built-in export (click any markdown output → Export → Word or PDF) instead of installing python-docx/pandoc; scripted formats stay for what the preview can't do (xlsx, images, data files)
- ✨ launch commands read the project's package.json scripts as one-click add suggestions (runner auto-detected from the lockfile); the header play button gained a dropdown to run or edit launch commands
- ✨ chat links are clickable everywhere: URLs in inline code and code blocks open in the browser, file paths in code blocks open the file (md → in-app preview)
- ✨ generated deliverables and assets of any kind now go straight to outputs/ without asking

## 0.3.0

- ✨ first-run onboarding: a required setup wizard on every launch until completed — welcome → AI provider → git → integrations → theme; each step embeds the real Settings page, so everything is editable later under Settings
- ✨ Stash & pull: pulling with local changes offers stash (incl. untracked) → fast-forward pull → restore; conflicts keep the stash entry and show recovery steps — nothing is ever discarded
- ✨ Prepare for Concourse syncs the repo first: clean trees switch to the default branch and pull (approval-gated, ff-only); dirty trees are reported with an analyze-as-is or stash-and-sync choice
- ✨ knowledge freshness window: point-in-time data (metrics, statuses, counts) is now servable from facts marked `kind: point-in-time` + `captured` for 4 hours after capture, labeled "as of <time>" with a refresh offer — fresh sprint/campaign snapshots save org-wide so other departments reuse them; `/curate-knowledge` prunes expired ones
- 📝 pitch narrative at `docs/PITCH.md`

## 0.2.0

- ✨ Troubleshooting (Settings → General): "Export support bundle" zips all logs + version/OS info to the Desktop for bug reports; "Reveal log file" opens the log directory
- ✨ error capture across every surface: packaged server output, renderer crashes, and main-process exceptions all land in the local log (auto-rotated at ~1 MB, ~2 MB cap)

## 0.1.0 — the foundation release

Concourse's new starting point: version reset from the POC-era 0.x line.
Everything below is what the foundation ships with.

- ✨ Share dialog: expose a locally-running port as a private tailnet URL (Tailscale serve) or public link (cloudflared / ngrok / Tailscale Funnel) — provider picker chips with one-click tool installs and live install state, inline errors with the tailnet enable link as a button
- ✨ Docker compose control: header pill with service health, start/stop/restart for the stack, engine detection and launch (Docker/Rancher/OrbStack); stopped containers read as "stopped", not errors
- ✨ Codex sandbox: network access enabled in workspace-write (git push/pull, installs, APIs, Docker daemon all work); the chat shield toggle lifts the sandbox entirely (fresh + resumed turns)
- ✨ per-session "dangerously skip approvals" shield for AI chats — every action class flows without approval cards; locks at session start
- 🐛 Stop then a new prompt now redirects the conversation instead of resuming the interrupted work (and the new prompt shows in the transcript)
- 🐛 watchdog for background subagents whose completion notification is lost — the model gets woken to verify on-disk results instead of "working…" forever
- ✨ drag-and-drop files anywhere in a chat to attach them (same pipeline as the upload button)
- ✨ Ship opens a review dialog with an AI-generated Conventional-Commit message (`type(scope): subject`) — edit before commit & push
- ✨ branch naming enforced on creation: `<type>/<description>` with smart suggestions ("fix login bug" → `fix/login-bug`) and type chips
- ✨ Review Changes: Discard All alongside Accept All, per-file discard, Pull button, clickable branch switcher, and a branch manager (remote-first delete with keep/discard for pending changes)
- ✨ Browse Files view: project tree + editable CodeMirror pane with conflict-safe saves, code folding, and file watching
- ✨ editors and diffs follow the app theme with Catppuccin (Mocha dark / Latte light), rainbow brackets, jump-to-matching-bracket, and syntax colors for ~20 languages — including the Review Changes diff pane
- ✨ session cards: full avatar editing (image / monogram / icon / color) matching projects; pin icon states fixed
- ✨ Settings → Git: recommended defaults, GitHub CLI install + sign-in, SSH key setup, commit identity, and commit signing — each one click
- ✨ clone a repository by URL from Add Project (SSH for private repos)
- ✨ one-click install + sign-in for AI CLIs, with a Node bootstrap cascade for machines without npm
- 🐛 fix packaged macOS app startup when the bundled server lives inside app.asar
