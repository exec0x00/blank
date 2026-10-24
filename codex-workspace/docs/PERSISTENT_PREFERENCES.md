# Persistent preferences and reusable instructions

Ordinary startup, restart and workspace lock/unlock preserve saved preferences, skills, plugins, workflows, role definitions and instruction files. The application reads their authoritative copies from durable storage. Clearing or replacing the disposable runtime directory does not reset those files or settings.

Production uses the native `/data` attachment with `DATA_DIR=/data`. `config.homeDir` is `/data/home`, `config.workspacesDir` is `/data/workspaces`, and `config.stateDir` is `/data/codex-workspace/state`. The table uses `<project>` for an actual workspace directory below `/data/workspaces` and `<owner>` for either that directory or `/data/home`, according to the selected scope.

| Saved data | Durable location |
| --- | --- |
| Model, reasoning effort, web search, approval behavior, editor font size and default wrapping | `/data/codex-workspace/state/settings.json` |
| Device layouts, editor minimap/line numbers/wrapping, selected threads and open editor tabs | `/data/codex-workspace/state/ui-state.json` |
| Active workspace and workspace records | `/data/codex-workspace/state/active-workspace.json`, `/data/codex-workspace/state/workspace-record-<workspace-id>.json` |
| Personal skills | `/data/home/.agents/skills/<name>/SKILL.md` and `/data/home/.codex/skills/<name>/SKILL.md`, with their adjacent resources |
| Project skills | `<project>/.agents/skills/<name>/SKILL.md` and `<project>/.codex/skills/<name>/SKILL.md`, including nested project scopes |
| Built-in skill copies | `/data/home/.codex/skills/.system/<name>/SKILL.md` |
| Installed plugins and retained revisions | `<owner>/.codex/plugins/installed/<plugin-id>/<revision-id>/` |
| Native plugin persistent data | `<owner>/.codex/plugins/data/<plugin-id>/` |
| Imported marketplace snapshots and retained revisions | `<owner>/.codex/marketplaces/installed/<marketplace-id>/<revision-id>/` |
| Extension registration, disabled choices and built-in fingerprints | `/data/codex-workspace/state/extensions.json` |
| Removed extension backups | `<owner>/.codex/skill-backups/`, `<owner>/.codex/plugins/backups/`, `<owner>/.codex/marketplaces/backups/` |
| Named project workflows | `<project>/.codex/workflows/<name>.md` |
| Personal instructions | `/data/home/.codex/AGENTS.md` or `AGENTS.override.md` |
| Project instructions | `<project>/AGENTS.md` or `AGENTS.override.md`, including applicable nested directories |
| Personal role declarations/defaults and role files | `/data/home/.codex/config.toml`, `/data/home/.codex/agents/**/*.toml` |
| Project role declarations/defaults and role files | `<project>/.codex/config.toml`, `<project>/.codex/agents/**/*.toml`, including applicable nested scopes |
| Ordinary tool configuration and user data | `/data/home/.config/`, `/data/home/.local/share/`, `/data/home/.local/state/` |

Workspace files and ordinary state are unencrypted by the user's explicit choice. GitHub connection records under `state/github-account-*.json` retain encrypted tokens; protected credentials use the stable environment encryption key. Account connections and repository/account selections survive logout and restart. No temporary cache or browser cache is the authoritative copy of these saved settings or connections.

The extension service only writes a built-in skill on startup when the file is missing, or when its contents still match the saved fingerprint of the previous shipped version. A user-customized built-in is retained. Installed plugins and marketplaces are copied into their durable scope before registration completes. Their source download, extracted archive or clone can be discarded without breaking the installed version. Locally discovered extensions remain at their original durable user/project paths. Removing their source explicitly is different from clearing a runtime cache.

Disposable caches, build/dependency staging, downloaded extension import staging and process scratch belong under `config.runtimeDir`, outside `/data`. Runtime preparation creates or validates those directories without deleting durable home, project or state data. Temporary files alongside durable records or extension revisions are used for atomic replacement; only completed durable copies are authoritative. Installed extension resources and retained revisions are not general-purpose caches.

The development release reset is a separate deployment-only operation. The release coordinator may explicitly remove approved old managed application state after verifying the release; backward compatibility with that discarded development state is not required. Ordinary app startup and restart must never invoke the reset. Preserve deployed source, stable secrets, saved account connections and unrelated bucket data. Future restarts must keep the new release's saved data.

`tests/persistent-preferences.test.ts` starts the real application in two separate Node processes. It writes settings and UI choices through authenticated routes, creates and customizes personal/project skills, installs real archive plugins, imports a marketplace snapshot, and writes workflow, role and instruction files. It locks and stops the first application, removes its entire disposable runtime directory, and starts a fresh process with a new runtime directory. The second process authenticates with the workspace password and verifies the recovered settings, usable extension contents, role discovery, workflow expansion and unchanged durable bytes. External model/service requests are rejected by the fixture. GitHub credential restart behavior is independently exercised by `tests/github-persistence.test.ts`.

The process fixture in `tests/fixtures/persistent-application-process.ts` reports startup phases before loading TypeScript, then waits for real application initialization, its listening HTTP server and any saved-instruction inspection before reporting ready. Startup has a 30-second deadline with phase, last-import, bounded output and filtered process diagnostics on failure. Shutdown waits for the owned child's `close` event before removing fixture data; a separate stalled-bootstrap test checks forced cleanup without masking the original startup failure. Run these checks in the coordinator's isolated validation slot under the test supervisor.
