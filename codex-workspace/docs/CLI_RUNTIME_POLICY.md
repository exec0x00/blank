# Official Codex runtime policy

The September 23 settings update supersedes the earlier MCP exclusion below. Native MCP configuration is enabled, the managed deny-all is removed, credentials use encrypted environment references, and Fast mode defaults on. Current configuration and interface behavior are documented in [WORKSPACE_SETTINGS.md](WORKSPACE_SETTINGS.md). Historical version-specific probe results in this document remain historical evidence.

The user's September 22 migration request authorizes the official Codex CLI in place of the custom TypeScript agent engine. The former no-Rust rule is superseded for this runtime. Local mining, mounting, containers, proot, VMs, program emulators, manual namespace wrappers and local model proxies remain prohibited. Ordinary Chrome/Chromium/Playwright processes, including their normal browser sandbox, remain allowed.

This document records the native launch contract and bounded persistence/policy evidence. It does not claim a deployment, a successful native inference request, or a complete instance-restart migration.

## Evidence and version boundary

The isolated executable identifies itself as **`codex-cli 0.155.1`**. Its own feature listing, schema exports, config loading, execpolicy checker and app-server protocol were inspected. Current official documentation was supplied in `/tmp/codex-cli-migration-research/{config,app-server,cli}.txt`; the cached pages identify these canonical sources: [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), [app-server](https://learn.chatgpt.com/docs/app-server), and [CLI](https://learn.chatgpt.com/docs/codex/cli).

Source-level details were checked against the preserved OpenAI archive at commit `78245b47af2a7aafcabe025828ceecca69db4df1`, recorded in [upstream/SOURCE.md](../upstream/SOURCE.md). The archive is a reference, not an assertion that it is the exact source of the installed executable. For example, its realtime feature metadata differs from the actual 0.155.1 listing; the executable reports realtime as experimental/off. Concrete binary observations take precedence where they differ.

At `2026-09-22T13:35:22Z`, cgroup charge was **827,867,136 bytes**, the visible kernel maximum was **104,000,000,000 bytes**, `/tmp` was overlay and `/data` was native FUSE. The operational ceiling remains **90,000,000,000 bytes**, with at least **2,000,000,000 bytes reserve**, counting file cache and tmpfs. These are timestamped observations, not a lasting capacity reservation.

The follow-up sample at `2026-09-22T14:55:01Z` reported **2,191,327,232 bytes** of cgroup memory and **631,930,880 bytes** of separately accounted swap. The same kernel limit and filesystem types remained in effect. The focused follow-up gates peaked below 2.5 GB of cgroup memory.

## Native launch contract

`server/codex-cli/config.ts` exports:

```ts
prepareCodexLaunch(ctx): Promise<{
  codexHomeDir: string;
  cwd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}>
```

The installer/runtime owns the verified executable path. `prepareCodexLaunch` does not download an executable, start a process, send a request, resume a thread, or rewrite the user's native `config.toml`. It creates and validates application directories, verifies the reserved host rules, samples resources and supplies arguments for the real `codex app-server --listen stdio://` process. When both `production` and `requirePersistentData` are true, it also creates or verifies the exact server policy at the supported `/etc/codex/requirements.toml` path. Stdio is an official app-server transport; a local model relay or reimplementation of the Codex protocol is unnecessary. [App-server documentation](https://learn.chatgpt.com/docs/app-server).

Production paths derive from `AppConfig`, with the following defaults:

| Purpose | Placement / policy |
| --- | --- |
| Native `CODEX_HOME` | `/data/codex-workspace/native-codex` |
| Native `sqlite_home` and `CODEX_SQLITE_HOME` | The same durable native home |
| Child `HOME` and initial cwd | Application home, normally `/data/home` |
| Text logs | `<runtimeDir>/codex-cli/logs`, outside `/data` |
| Temporary files and package/build caches | The validated application runtime paths outside `/data` |
| Host execpolicy | `<CODEX_HOME>/rules/codex-workspace-host.rules` |
| Production managed requirements | `/etc/codex/requirements.toml`, installed from server-owned policy on the instance |

Directory traversal refuses symlink aliases; existing native preferences and user rule files are retained. Launch preparation restores only the exact app-owned native-home and `rules` directories to mode 0700, and its byte-verified, single-link reserved rule file to 0600. All three repairs wait until the reserved rule bytes and identities are confirmed. This accommodates the native bucket's broad remount defaults without sweeping user data. A changed, multiply linked or unsafe reserved file fails visibly instead of being overwritten or chmodded. The launch environment is an allowlist: system executable paths, safe locale values, application home/cache paths, terminal metadata and one literal nonsecret provider placeholder. It does not inherit website passwords, session/encryption keys, Hugging Face tokens, GitHub tokens, proxy variables, loader injection variables, or the controlling agent's home/configuration.

HF's rematerialized bucket presents synthetic ownership: the hosted diagnostic found process UID/GID 0 but `/data` and the reserved native paths UID/GID 1000, all on device 14680248. Private modes and descriptor/named identities already matched. The ownership check therefore admits the current process owner **or** the data mount's observed synthetic owner, only for the exact native-home directory, its `rules` directory and its reserved rule file. The exception requires server `requirePersistentData`, a canonical no-follow data-root descriptor, an exact kernel `fuse hf-mount` mount at that root, FUSE `statfs`, matching device identity and no nested mount redirecting those reserved paths. The observed hosted record was `0:3768 / /data ... - fuse hf-mount`; this is a verified native-volume exception, not a general acceptance of UID 1000 or arbitrary other-owned directories. Source evidence is `.deployment/cli-migration-startup-fix-20260922/native-storage-diagnostic.json`.

The server retains that root/mount identity privately on the original prepared launch object. Later rule snapshots reacquire and revalidate the same root and kernel mount record; replacing the root, changing the mount, using another device, forging/cloning public launch fields, or introducing a foreign owner/symlink fails closed. User rule reads are descriptor-pinned too, and the reserved content hash must still match the server renderer. Disposable runtime and managed `/etc` ownership checks remain strict for the current process; no privilege drop, `chown`, user-tree traversal or history/config rewrite is introduced. Local tests use real owned temporary files with controlled kernel metadata to cover the hosted UID difference, mode restoration and rejection/race paths; actual hosted compatibility is checked separately by the coordinator.

`cli_auth_credentials_store = "ephemeral"` is forced. Native OAuth/sign-in controls are not exposed, and the actual provider credential is a placeholder. This avoids introducing a real CLI auth file into the public durable bucket. Existing website accounts remain in the website's protected `SecretStore`. This does not claim that arbitrary files a user deliberately creates in their own home are encrypted. [Native credential-store setting](https://learn.chatgpt.com/docs/config-file/config-reference).

Model, effort and summary selections are sent through supported native requests by the conversation service. The launch builder does not substitute a model or overwrite those preferences. It supplies **no `approval_policy` launch override**, so saved native approval choices remain editable. `codexApprovalPolicy(false)` and `codexApprovalPolicy(true)` remain convenience mappings to `on-request` and `never`; managed requirements permit both choices. Actual 0.155.1 `config/read` calls in two fresh owned processes confirmed each saved choice and unchanged preference bytes. `CODEX_CLI_PROVIDER_ID` is **`workspace_owner`**. `CODEX_CLI_SANDBOX_MODE` is **`danger-full-access`**: there is no claim of filesystem sandbox isolation. Neither approval mode waives forbidden host commands. Plan mode is native collaboration behavior, not an invented read-only filesystem sandbox.

Managed `allowed_sandbox_modes` declares **`["read-only", "danger-full-access"]`**. The actual stock 0.155.1 executable on HF rejected a declaration containing only `danger-full-access`, because native permission-profile construction requires the read-only base to be admitted. This is a managed declaration requirement, not a change to execution mode: application launch and thread requests remain pinned to `danger-full-access`, and the UI/runtime do not opt into local sandbox wrappers. `workspace-write` remains absent. Mining, mounting, bwrap/container/VM/manual-namespace bans and every other managed constraint remain in force. The hosted diagnostic is retained in `.deployment/cli-migration-20260922/native-startup-diagnostic.json`; local tests do not claim to replace the coordinator's stock-CLI verification on the dedicated HF host.

The coordinator then verified the corrected declaration on that dedicated host: stock CLI `features list` exited 0 with empty stderr, recorded in `.deployment/cli-migration-20260922/native-managed-correction-diagnostic.json`. Its temporary declaration omits the space after the comma; the final renderer includes it. This proves native policy parsing for the corrected pair, while application readiness still requires the updated source validator and actual `configRequirements/read` result after deployment.

## Fixed service and native model catalog

The server-owned launch values are supported native configuration:

```toml
model_provider = "workspace_owner"

[model_providers.workspace_owner]
name = "Fixed owner Responses service"
base_url = "https://alvin3y10-api.hf.space/api"
wire_api = "responses"
env_key = "CODEX_FIXED_PROVIDER_PLACEHOLDER"
requires_openai_auth = false
supports_websockets = false

[features]
api_key_model_discovery = false
```

The child environment supplies `CODEX_FIXED_PROVIDER_PLACEHOLDER=not-needed`. It is not a user API key. Native provider configuration distinguishes a **base URL** from a complete Responses request URL. The reference `codex-api/src/provider.rs::url_for_path` and `endpoint/responses.rs` append `/responses`; this base therefore targets `https://alvin3y10-api.hf.space/api/responses`. No CLI patch, path trick, redirect or proxy is used. [Provider configuration](https://learn.chatgpt.com/docs/config-file/config-reference).

The production managed file also sets the exact `model_provider` and complete matching `model_providers.workspace_owner` definition. In the reference native `ConfigRequirementsToml` these are actual managed fields: provider definitions replace matching local definitions before parsing, and required provider selection is applied afterward. These requirements survive native child role configuration. The public `configRequirements/read` projection omits provider definitions, MCP allowlists and execpolicy rules; it must not be treated as exposing those fields. Effective provider checks also use real native configuration/thread metadata, alongside exact managed-file verification and the native requirements parser.

The coordinator authorized at most four non-inference route checks on that same host. Exactly **two GETs** were used: `/api` and `/api/responses`. Both returned HTTP 400 with a missing-model validation error, without redirection. No model, input or authentication credential was supplied, and `/models` was never requested. This establishes routing/validation behavior, not successful Responses streaming or inference.

The actual 0.155.1 app-server was then started with an isolated application home and placeholder-only environment. Only `initialize`, `config/read` and `model/list` were sent. There was no `thread/start`, `thread/resume`, login, tool execution or inference. Native diagnostics show no usable `models_cache.json`, and the model list returned from the bundled catalog with API-key discovery disabled and no ChatGPT authentication. The reference models manager explicitly returns without remote API-key discovery when that feature is off. No custom catalog file was fabricated. The native trace contained no models-endpoint request.

The observed native catalog included literal wire names for Astra, Sol, Terra, Luna, both Daybreak choices, GPT-5.5, GPT-5.4 and Codex Auto Review. The UI must use actual native `.model` values and hide the user's retired 5.5/5.4/5.3/Lightweight/Pro choices as applicable; it must not manufacture missing entries. Keep `allowProviderModelFallback: false` when accepting an explicit model. The reference supports an authoritative **nonempty** `model_catalog_json`, but this launch does not need an invented file or an upstream discovery call. [Model configuration and catalog](https://learn.chatgpt.com/docs/config-file/config-reference).

## Durable native state on the FUSE mount

Native `sqlite_home` is not a disposable cache directory. The reference state runtime has separate databases for state/index metadata, goals, memories, durable queued submissions, logs and optionally paginated history / memory v2. Names observed in the real 0.155.1 process were:

- `state_5.sqlite`
- `goals_1.sqlite`
- `memories_1.sqlite`
- `queue_1.sqlite`
- `logs_2.sqlite`

All five were created by the actual CLI on the owned `/data` probe, reopened afterward, and returned `journal_mode=wal` and `integrity_check=ok`. The binary also contains the optional `thread_history_1.sqlite` and `memories_v2_1.sqlite` names; their creation was not forced by this probe.

The reference `state/src/sqlite.rs::open_read_write_pool` uses WAL, synchronous NORMAL, incremental auto-vacuum, a five-second busy timeout and up to five pooled connections. The public configuration provides `sqlite_home`; no supported journal-mode toggle was established. `log_dir` redirects text logs, **not** the separate `logs_2.sqlite` database. [SQLite and log placement settings](https://learn.chatgpt.com/docs/config-file/config-reference).

An additional isolated Python SQLite 3.46.1 test ran on both `/tmp` overlay and native `/data` FUSE. WAL selection, transaction commits, a reader during a held writer, rejection of a second writer with `SQLITE_BUSY`, checkpointing, integrity checks and fresh-process reads all passed. A process deliberately exited after a committed transaction without connection close/checkpoint; a fresh process recovered the committed WAL rows. A rollback-journal control also passed. These are small same-instance filesystem tests. They do not prove full Space restart durability, arbitrary concurrency/load, or cloud synchronization after abrupt instance loss.

Keep each database and its WAL/SHM sidecars together under durable storage. Do not relocate active databases to `/tmp`, copy only the main SQLite file while writers are active, or call a new empty database a recovered goal/memory store. Native metadata backfill and corruption recovery exist, and some events also appear in rollouts, but that does not establish that every goal, queue, memory lease, usage counter or pending state can be reconstructed from JSONL. Preserve native backups and make any recovery result visible.

The complete native home also contains configuration, session/archived rollout history, memories, skills/plugins and installation state. Those remain durable. Native memory is global to the selected `CODEX_HOME`; this single-home launch does not reproduce the old custom workspace/owner memory namespaces. The previous TS records must not be silently rewritten as native rollouts or presented as successfully imported native facts. See [CLI capability audit](CLI_CAPABILITY_AUDIT.md) for the supported native memory/goal API boundary.

`FileMetadataManager` now accepts `nativeCodexHomeDir?: string` as an explicit third application root. Startup restores metadata before launching the CLI; normal periodic captures include native files. Existing two-root v1 manifests remain readable and retain their workspace/home records. An explicitly configured native root upgrades the manifest to v2; a later startup may not omit that tracked root or recreate a missing native home as recovered state. Bounds, descriptor-based no-follow traversal and existing workspace deletion exclusions remain in effect. Native SQLite, WAL/SHM and rollout bytes stay ordinary durable files: metadata restoration never creates missing regular-file contents or synthesizes native history. Unknown paths retain their observed bytes/modes; missing mode-only nonempty directories remain absent.

The new fresh-process test used a real SQLite WAL transaction, then simulated mode/link/empty-folder loss in owned temporary storage. The exact production metadata class restored recorded modes and links while every retained SQLite/WAL/SHM, config and rollout hash stayed unchanged. A fresh SQLite connection recovered the committed row and returned `integrity_check=ok`. Missing regular-file trees remained absent, unlisted data stayed unchanged, and an entirely missing tracked native root failed with the previous manifest retained. This is a local process/recovery test, not a new HF instance-restart receipt.

## Disposable storage without losing user state

The existing generic runtime-storage service supplies `TMPDIR`, `TMP`, `TEMP`, `XDG_CACHE_HOME` and recognized package cache variables such as npm, pip/uv, Go build and compiler caches outside `/data`. User configuration/data homes stay durable. This is ordinary child-process configuration, not a filesystem mount or a fake CLI storage backend.

`features.shell_snapshot=false` avoids that optional reproducible cache under the native home. Text logs use native `log_dir` outside `/data`. A model cache may normally be under `CODEX_HOME`; API discovery is off here, and the measured model-list proof created no such cache. Some native `.tmp`/`tmp` directories were still created inside `CODEX_HOME`. No general supported setting was established to move every internal native cache independently; do not replace native paths with ad-hoc symlinks or classify installed skill/plugin resources as disposable merely because their path contains “cache.”

Startup installation/update is owned by the installer lane. Native `check_for_update_on_startup=false` avoids a second competing updater because the website already performs the requested official npm startup/update operation. Each new executable must be identified and its actual schemas/config/policy checks repeated before use; do not assume a future version preserves today's feature keys or protocol.

## Host instructions, command rules and exclusions

The launch uses **`developer_instructions`**, retaining Codex's own base instructions. It contains the fixed service, local bans, normal-browser allowance, narrowly authorized remote-machine exception, public/durable storage rules, secret handling and 90-GB/2-GB resource rule, followed by a timestamped real cgroup/filesystem observation. A repository `AGENTS.md`, a plugin, a child brief or a remembered instruction cannot create authority to override it. The website must reject caller-supplied provider, cwd, config, base-instruction and developer-instruction overrides.

Ordinary developer text alone is insufficient for every native child: the reference `core/src/agent/child_config.rs` copies it, but `agent/role.rs` can replace it with role-specific instructions. The production managed file therefore sets **`additional_developer_instructions`**, which native world-state code renders as a separate requirements-owned developer fragment. Native child role construction preserves the requirements layer; changing a role's ordinary instructions cannot remove this managed fragment. The reference loader's alternative `system_requirements_path` exists only in internal loader overrides/tests, not a supported CLI/environment option. This implementation uses the real standard system path and does not patch the CLI or substitute a policy loader.

`installCodexManagedRequirements()` uses bounded no-follow reads, exclusive creation, ownership/identity checks and exact expected bytes. A conflicting existing administrator file, broad writable mode, symlink, hardlink or unwritable destination fails startup; existing content is not overwritten. Its explicit path parameter exists only for server-side writer tests in owned temporary directories and never changes where native Codex loads requirements. Local nonproduction verification leaves `/etc` unchanged. After native initialization, production readiness requires the actual `configRequirements/read` response to pass `validateCodexManagedRequirementsResponse`: exact managed host text, exactly the mandatory read-only base and full-access declarations, both permitted approval choices, ephemeral credential storage and all required disabled feature pins. Missing, duplicate or extra sandbox-mode declarations fail visibly, as does any other incomplete invariant. Acceptance of the actual installed production file remains a deployment check; a unit TOML parse is not presented as that proof.

Native delegation uses `multi_agent_v2=false` in both launch and managed requirements. In the preserved source, the V1 `fork_context` boolean defaults to false; V2's omitted `fork_turns` defaults to `all`. Managed instructions require isolated briefs and `fork_context=false`, prohibit parent-history inheritance, and require children to recheck resources before heavy work. No supported global setting was found that removes an explicit V1 `fork_context=true` argument. This is a supported isolated default plus managed instruction, **not a claim of a native hard runtime prohibition**. No custom delegation scheduler, interception hook or CLI patch was added. Explicit user conversation forks remain a separate operation.

The reserved global `.rules` file uses stock native `prefix_rule(..., decision="forbidden")` rules for local container/VM/emulation/mining/mount/namespace programs, mount forms and cloudflared tunnels. General tunnels, including runlocal, SSH forwarding and localtunnel, are allowed; they do not change the fixed direct model route. Ordinary browser commands are not on that deny list. Real 0.155.1 `execpolicy check` tests evaluated forbidden commands and absolute-path resolution without executing any command. A conflicting `docker` allow rule in a second file remained forbidden in both load orders. Chromium/Playwright had no host-ban match. This is evidence about native policy evaluation, not a claim that an unmatched command is universally approved.

`readCodexLaunchRuleSnapshot` verifies the reserved file and fingerprints all global `.rules` files under bounded no-follow reads. `validateCodexLaunchPolicy` asks the **installed stock CLI** to parse those files and verify host denials, then checks that the fingerprint stayed unchanged. The gateway performs that admission before native launch and revalidates when the rule fingerprint or installed executable changes. It also does so before admitting user mutations. This matters because the reference native loader can retain only managed requirements rules after a user-rule parse error; a malformed global file must not quietly drop the application host rules. Native project config/rules remain ignored while untrusted; the website does not auto-trust projects.

Prefix rules and developer instructions are not a kernel sandbox. They do not prove the purpose of arbitrary interpreter code, prevent every renamed executable, or protect against an already privileged operator rewriting the runtime. The web gateway's rejected overrides, bounded native-rule validation, protected application paths and accurate Full-access label remain necessary. No additional local container/namespace wrapper is introduced to hide those limits.

Supported launch feature overrides disable native Browser Use (including external/full-CDP variants), Computer Use, the in-app browser/dictation, realtime, Apps, remote plugin discovery, API-key model discovery and the local network proxy. The September 23 update no longer forces MCP dependency installation off. System-proxy feature use is disabled and proxy environment variables are absent. Native plugin/skill functionality is not disabled wholesale merely because a web control is absent. Analytics, feedback and telemetry exporters are disabled for this server-owned process.

**MCP uses the official runtime.** The website edits supported native server configuration and exposes a connection check. The old present-empty managed MCP allowlist has been removed at the user's request. Private variables are encrypted in the credential store and injected only into the native process; TOML contains references. Shell secret exclusions remain enforced. Native OAuth credential storage is directed to the keyring rather than plaintext public files. MCP tools retain the same host/provider policy. [Configuration reference](https://developers.openai.com/codex/config-reference/).

Native memory availability defaults off in 0.155.1. The launch preserves user memory preferences rather than forcing them off. `memories.generate_memories` concerns newly created threads' contribution eligibility, and `memories.use_memories` concerns memory injection; neither should be relabeled as the old TS service's independent cancellation/budget contract. Enabling native memories can start native background processing when eligible root sessions start. Metadata listing must not implicitly resume native threads: pending queues or goals may continue on resume. This audit invoked neither operation. [App-server lifecycle](https://learn.chatgpt.com/docs/app-server).

## Verification packet and remaining acceptance

Evidence is under `/tmp/codex-cli-policy-20260922-4_65d1hf`:

| Artifact | Scope |
| --- | --- |
| `source-provenance.json` | Exact inspected reference-source hashes and version qualification |
| `native-cli-local-checks.json` / `native-config-load.json` | Actual 0.155.1 version, feature values and local dry policy/config evaluation |
| `provider-route-checks.json` | The two authorized non-inference same-host GETs |
| `sqlite-filesystem-probe.json` | Owned synthetic overlay/FUSE transaction and process-recovery probes |
| `native-model-list-final-proof.json` | Actual stdio initialize/config/model-list response using the final provider identifier |
| `native-model-list-summary.json` | Initial native WAL/integrity observations and bundled-catalog diagnostics |

The focused source gate `.release-verification/codex-cli-native-config-verified-20260922{.log,-result.json}` passed **8/8 tests**, including the real native CLI policy/config case. The first failed gate is preserved; its failure was a test treating the ordinary value `GIT_CONFIG_COUNT=1` as a secret substring everywhere, not a credential leak. The corrected assertion still checks that the variable and all distinctive secret markers are absent.

The follow-up gate `.release-verification/codex-cli-native-root-policy-20260922{.log,-result.json}` passed **62/62**: 43 existing metadata cases, six new native-root cases and 13 launch/policy cases. After strengthening the supported managed provider fields, the final config gate `.release-verification/codex-cli-managed-policy-final-20260922{.log,-result.json}` again passed **13/13**, including the actual CLI execpolicy/config checks. Scoped strict TypeScript checking passed in `codex-cli-native-root-policy-types-20260922`. The real saved-approval proof is `/tmp/codex-native-approval-proof-20260922-pf5i0F/report.json`, with two settled native processes and only `initialize`/`config/read` requests; its supervised result is `codex-cli-native-approval-proof-20260922`.

Before publication, the coordinator still owns complete native bridge/UI acceptance, final source/type/build gates, actual provider compatibility through the CLI, and a full-instance durable-state restart proof. A model-list result is not an inference success, and SQLite integrity in this instance is not an HF restart receipt. No user state, controlling-agent auth/config, deployment credential, model inference, `/models` request, local proxy, mount or container was used for this audit.
