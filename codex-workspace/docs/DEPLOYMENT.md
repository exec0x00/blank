# Hugging Face deployment

The target is the **public** Space `alvin3y12/codex-workspace`, running a Node.js server on port 7860. React assets are built with Vite and served by the same server. A minimal Python entry point supplies the platform's ZeroGPU registration and supervises Node; the application does not present a Gradio interface.

The public origin `/` always returns only `status: ok` as plain text, including requests with an existing session or workspace query parameters. Open the workspace at [https://alvin3y12-codex-workspace.hf.space/work](https://alvin3y12-codex-workspace.hf.space/work); `/work/` also works. Agent/editor window links use `/work` with their validated workspace, thread and view parameters. The password gate, `/api`, WebSockets and asset URLs retain their existing behavior.

Immediately after required ZeroGPU registration, Python binds the public `HOST`/`PORT` listener. Root `GET` and `HEAD` responses are available before maintenance checks, native storage reads, Node downloads, source copying, dependency installation or builds. During preparation, `/work` returns an honest HTTP 503 startup page that refreshes automatically; `/health`, API routes and WebSocket requests return 503. Root liveness does not claim that the workspace is ready.

The launcher passes the **same listening socket** and a private readiness pipe to the final Node child. After full application initialization, Node adopts that socket and confirms readiness; Python then stops accepting connections while retaining its descriptor. There is no port rebinding gap, request proxy, changed origin, or alternate WebSocket/SSE path. The internal `CODEX_BOOTSTRAP_LISTEN_FD` and `CODEX_BOOTSTRAP_READY_FD` values are consumed before application subprocesses start; do not configure them as Space variables. Ordinary `npm start` and test launches without inherited descriptors continue to listen directly.

The supervised Node runtime defaults `UV_THREADPOOL_SIZE` to `16` so bounded filesystem operations can overlap remote bucket waits. An explicitly configured value is preserved, and npm/build children keep their original environment.

Failed preparation or an exited Node child leaves the root status service available. `/work` reports the failure, and startup retries with a bounded 5–30 second delay; a running child is never periodically restarted. Saved-state recovery remains the application's responsibility, with no reset or replay performed by the launcher. The explicit maintenance gate shares this listener, keeps its read-only `/_maintenance` receipt, and also serves the constant root response.

## Hosting configuration

The public Space was created successfully on September 19, 2026 with SDK `gradio`, hardware `zero-a10g`, and the required secrets and variables. Release `92dab8912fb55b748da800dd8344147122d35b6c` reached `RUNNING`, and all 21 deployment checks passed, including actual password login, anonymous route protection, writable native storage, metadata initialization, and logout. Native bucket downloads also matched the application's written files. Persistence across a platform restart remains a separate acceptance check.

The explicit Space restart API returned HTTP 403 requiring PRO access. No hardware change or alternate restart operation was attempted. Normal source publication is used only for actual application, test, and documentation updates; if that operation is also denied, its permission error must be resolved through the account rather than retried through unrelated platform controls.

This follows the user's [alvin3y10/exec reference](https://huggingface.co/spaces/alvin3y10/exec): `app.py` declares a minimal `@spaces.GPU` function, initializes `spaces.zero.startup()`, and starts the custom server. The dummy function is never called by the workspace, and no GPU is used for editing, terminals, or external model requests. The Python parent stays alive, forwards shutdown signals, and supervises the Node child process.

`README.md` selects Gradio SDK 6.21.0 and Python 3.12 because that SDK is required for ZeroGPU hosting. `requirements.txt` installs only the Spaces integration; `packages.txt` supplies the terminal/compiler tools. At startup, `app.py` uses an available Node 22.12+ installation or downloads the official Node 22.23.2 Linux archive directly with a pinned SHA-256 check. It installs dependencies on temporary local disk, validates the release's prebuilt client/server assets against the exact source and package lock, then compiles the small native binding for the actual host. A missing, stale or invalid portable package falls back to the ordinary production build. The status listener remains available throughout, and the final application inherits it on port 7860. Build children receive neither the private listener descriptors nor application/account credential environment variables. The optional Dockerfile is retained for environments supporting that build format; it is not the active Space entry point. See [portable release verification](PORTABLE_RELEASE.md).

The deployment does not request paid hardware. Free ZeroGPU hosting depends on the account's eligibility and available quota. A static Space cannot provide the required Node server or host terminal.

## Storage and visibility

Attach the existing **public** bucket `alvin3y12/data` to the Space at `/data`, with read-write access. Use Hugging Face's native storage attachment in **Space Settings → Storage/Volumes**, or run the deployment script, which calls `HfApi.set_space_volumes`. No mount, Docker, proot, FUSE, rclone, or other runtime mounting command belongs in the app.

The deployment never changes bucket visibility and never encrypts workspace files. Source files, repositories, conversation history, settings, and ordinary state remain readable files in the public bucket. The login password protects access through the application; direct public bucket access is separate. GitHub access tokens are protected separately using `ENCRYPTION_KEY`, held in the Space secrets rather than in the bucket. The fixed model service uses a non-secret server-side placeholder; it needs no user model credentials. Keep the same encryption key across deployments so all saved GitHub accounts remain usable after the single workspace-password login.

Durable directories are:

| Path | Contents |
| --- | --- |
| `/data/workspaces/` | Projects, repository files, and Git history |
| `/data/codex-workspace/state/` | Workspace registrations, conversations, settings, and protected account credentials |
| `/data/home/` | Terminal home directory and user caches |

The plain JSON file `/data/codex-workspace/state/filesystem-metadata.json` records directory entries, permission bits, modification times, and symlink targets for the workspace, home and native Codex directories. Startup validates and restores saved metadata before accepting work, using bounded parallel operations with directory-order and descriptor limits. Adjacent sibling files reuse verified directory handles within one admitted batch; each file still revalidates its root and parent, and no handle cache survives the batch. This avoids repeated remote ancestor traversal while preserving canonical hard-link mode order and safe per-entry fallback. Production logs report the restored entry count and elapsed time. Metadata then refreshes in the background with a five-minute traversal budget. A failed refresh preserves the last complete manifest and reports its error through authenticated `/api/storage`, where initialization, capture timestamps and restoration issues are also available. Explicit captures used by file operations remain strict. This metadata file uses the same native bucket attachment; it is not a custom filesystem mount. The Python supervisor forwards shutdown and allows Node up to two minutes to flush metadata, subject to the hosting platform's own shutdown deadline; a scan interrupted at that deadline cannot publish a partial manifest.

Temporary process resources and installed dependencies use `/tmp`; dependencies and native binaries are prepared for each fresh instance. The source release also includes a verified, portable archive of the application's JavaScript and static assets so a cold start can skip repeating TypeScript, Vite and esbuild work. Source is retained separately in the Space repository and `/data/codex-final` in the development environment. Hugging Face's bucket synchronization can be asynchronous: before a deliberate restart, verify a newly written file is visible through the bucket API, then verify it again after restart. A local successful write alone does not prove remote persistence.

## Secrets and variables

Add these in **Space Settings → Variables and secrets**. The deploy script initializes missing secrets without printing them or rotating existing values.

| Setting | Kind | Value |
| --- | --- | --- |
| `WORKSPACE_PASSWORD` | Secret | The requested workspace login password, supplied externally |
| `SESSION_SECRET` | Secret | A stable random value of at least 32 characters |
| `ENCRYPTION_KEY` | Secret | A stable random value of at least 32 characters, protecting connected account credentials only |
| `DATA_DIR` | Variable | `/data` |
| `HF_BUCKET` | Variable | `alvin3y12/data` |
| `REQUIRE_PERSISTENT_DATA` | Variable | `1` |
| `PORT` | Variable | `7860` |
| `NODE_ENV` | Variable | `production` |

Do not add the deployment `HF_TOKEN` to the application Space. It is used only from your local environment or the deployment workflow. Preserve `ENCRYPTION_KEY` across deployments so existing connected accounts remain readable. To intentionally change the login password, update `WORKSPACE_PASSWORD` directly in Space settings; deployment preserves it.

## Official Codex CLI

Every real Node startup installs and verifies `@openai/codex@latest` in owned disposable storage, then runs its official app-server over private stdio. Settings → Agent shows progress, the actual running version, failures, and **Update Codex**. The site tools start independently; agent readiness follows successful native initialization. Installation failure remains visible and can be retried with that update control.

Native `CODEX_HOME` is `/data/codex-workspace/native-codex`, including history, preferences and SQLite databases with their WAL/SHM sidecars. Ordinary data stays unencrypted in the public bucket. Native file metadata joins the existing durable mode/symlink/empty-directory manifest. Executables, npm cache, logs and other disposable runtime files stay outside `/data`. MCP private variables use the existing encrypted credential store; native configuration stores environment references.

Native writer locks, arg0 helper trees, and `.tmp/plugins-clone-*` staging trees are omitted from metadata restoration and capture. No files are deleted by this policy. The activated `.tmp/plugins` catalog, plugin installations/data, and `.tmp/plugins-backup-*` recovery snapshots retain their metadata protection. Existing native SQLite sidecars also retain their saved modes and bytes; their absence alone is not treated as file loss when the corresponding primary database is safely present. Missing or unsafe primary databases still report a restoration issue. These rules follow the [native plugin activation and rollback lifecycle](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/core-plugins/src/startup_sync.rs) and [SQLite's WAL lifecycle](https://www.sqlite.org/wal.html#the_wal_file).

Production installs the server-owned native requirements at the official `/etc/codex/requirements.toml` path. Existing conflicting administrator policy is preserved and reported as a startup failure. This native managed layer adds host restrictions to every agent, including roles and delegated children. The server also supplies fixed launch overrides and validates stock execution-policy rules. No custom hook or alternate agent loop is involved.

The native provider base is `https://alvin3y10-api.hf.space/api`, with Responses wire mode and a non-secret placeholder. The official client appends `/responses`. No upstream `/models` request, provider sign-in/key editing, alternate provider or local model proxy is introduced. The model picker uses actual native metadata, and preferences are saved through native configuration. See [CLI_CAPABILITY_AUDIT.md](CLI_CAPABILITY_AUDIT.md).

GitHub account metadata and protected credentials remain separate durable site tools. Logout and ordinary source updates do not clear them. The current Arc release preserves all existing workspaces and conversations; the historical one-time reset is not part of this deployment. `scripts/reset-space-data.py` is a separate operator workflow requiring an explicitly reviewed deletion scope. Its maintenance marker only holds Node startup and never deletes data itself. Removing the marker starts normal persistent operation. See [WORKSPACE_SETTINGS.md](WORKSPACE_SETTINGS.md).

## Publish from the command line

Use Python 3.10+ with `huggingface_hub==1.16.1`, Node.js 22, npm, and the native terminal build prerequisites.

```sh
python3 -m pip install 'huggingface_hub==1.16.1'
npm ci
python3 scripts/deploy.py
```

Supply `HF_TOKEN` and `WORKSPACE_PASSWORD` through the process environment, or pass `--credentials-file /absolute/path/outside/source.json`. The external JSON may contain `hfToken` and `workspacePassword`, and must have mode 0600. Never put its contents in shell history, source, or public files.

Deployment validates that source files do not contain the supplied credentials, records the input/output fingerprints around a successful `npm run verify`, and packages the portable application assets. It scans the decompressed assets for deployment secrets as well as checking ordinary source files. For initial configuration it also configures the public ZeroGPU Space and native bucket volume; existing deployments should use `--source-only`. The source and package are published together. The platform then prepares its SDK environment and starts the Python/Node entry point. It never selects paid hardware. Existing password and credential-protection keys are preserved on repeat runs.

`--configure-only` performs account/Space configuration without uploading app source. For an existing, correctly configured Space, `--source-only` validates visibility, hardware, native storage, secret names, and variables without changing settings, then publishes the new source. It never calls hardware, volume, secret, or restart mutation APIs. `--skip-verify` requires a matching receipt from `python3 scripts/release_build.py verify`, or the matching portable package transferred from the successful CI verification job. Existing `dist` files alone are not accepted; edited source, lockfiles or compiled output require fresh verification. Override `--space` and `--bucket` only when intentionally deploying another instance.

After the platform reports `RUNNING`:

```sh
python3 scripts/check-space.py
```

The check verifies public Space/bucket visibility, ZeroGPU SDK and hardware, the native read-write `/data` attachment, required secret names, storage variables, health, and anonymous denial on workspace, provider, and storage routes. Add `--authenticated` with the externally supplied password to verify login, safe provider status, writable native storage, metadata initialization, and logout. No account authorization flow is started, and no secret values are printed. Then open the app, create a file, use the editor and terminal, connect GitHub accounts, verify the native CLI version and a real agent turn, and run the complete live acceptance checks. A green metadata/health check is not a substitute for these functional checks or persistence verification after restart.

## GitHub workflows and local source synchronization

`.github/workflows/verify.yml` runs TypeScript, behavioral tests, the production build, bootstrap/release checks, and Chromium browser tests on pushes and pull requests. It publishes a CI artifact containing only the portable release archive and manifest after the full job succeeds. `.github/workflows/deploy.yml` can be started from GitHub Actions; its separate publication job downloads that artifact, verifies it against the checked-out source and performs a source-only deployment. It does not transfer `node_modules` or native binaries. Configure repository secret `HF_TOKEN`; supply `WORKSPACE_PASSWORD` for source/asset scanning. Optional repository variables are `HF_SPACE_ID` and `HF_BUCKET`.

When developing in the fast temporary tree, run `sh scripts/sync-source.sh` to copy source into `/data/codex-final`. It excludes dependency installs, build outputs, local data, credentials, and private environment files; it does not delete unrelated files at the destination. No filesystem attachment is performed.

## Platform references

- [Hugging Face persistent storage and native attachments](https://huggingface.co/docs/hub/en/spaces-storage)
- [Hugging Face ZeroGPU configuration and eligibility](https://huggingface.co/docs/hub/en/spaces-zerogpu)
- [Hugging Face Hub API reference](https://huggingface.co/docs/huggingface_hub/en/package_reference/hf_api)

## Repeatable hosted file and terminal verification

`node scripts/verify-live.mjs create --credentials-file /outside/source/credentials.json` logs into the real Space, creates a clearly named verification workspace, edits ordinary files, runs a real WebSocket PTY, and commits them with Git. It records a private verification state file under the local temporary directory, never in source or the public bucket. Confirm remote bucket bytes before a restart or a legitimate source update. Then run `node scripts/verify-live.mjs verify --state /tmp/codex-workspace-live-verification.json` to check the same session, files, terminal-created file, Git commit, saved conversation, symlink, executable bit, and empty folder. The verification workspace remains available for inspection. The script does not call hardware or restart APIs.

## Current native browser scope

Native browsing, browser-session/takeover controls and realtime audio are omitted for this Space. The old browser runtime and bootstrap installation path were removed. Ordinary Chrome/Chromium/Playwright development testing remains allowed with normal browser security. Browser execution is not claimed as a supported native site feature.
