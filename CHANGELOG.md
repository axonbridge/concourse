# Changelog

All notable changes to this project, newest first.

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
