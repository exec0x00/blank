# Resumption completion review

Review checkpoint: **2026-09-20 02:21 UTC**. Reviewed source: `/tmp/codex-final-build`. This is a bounded source review, not a passing release gate or a report about the currently hosted application.

The reviewer read the current `AGENTS.md`, `REQUIREMENTS.md`, `COMPLETION_AUDIT.md`, `CODEX_PORT.md`, relevant implementation and test definitions, and the pinned local official Codex reference. The only file changed by this review is this document. No tests, builds, browser sessions, provider requests, deployment operations, credential reads, or hosted-state mutations were performed.

The file-tree replacement, Editor toggle, dark-only settings, direct browser bucket uploads, process/worktree failures, and automatic-compaction test failures already have implementation owners. This review does not duplicate or certify those changes. The working tree is changing while those owners work; references below identify inspected behavior, not an immutable final release.

## Actionable findings

### R1 — P1: An open agent event stream can outlive its session authorization

**Source-confirmed authentication gap.** All agent REST routes, including initial SSE admission, are correctly mounted after `auth.requireSession` in `server/index.ts:105`. However, `server/agent.ts:75–95` never rechecks the session after opening the stream. Its 15-second heartbeat only writes a comment. The stream ends after 30 minutes or a local `auth:logout` event.

`server/auth.ts:230–239,262–273` checks expiry and durable revocation only when `authenticated()` is called. Expiry itself does not emit a logout event. Consequently, a stream opened just before its cookie expires continues receiving conversation/tool events until its independent 30-minute deadline. A durable revocation written through a different `AuthService`/process is likewise not observed by this route until some unrelated request checks that cookie on the stream's process. `tests/auth-concurrency.test.ts:334–341` explicitly makes such an extra private HTTP request before expecting its local SSE to close; it does not test an otherwise idle open stream.

The WebSocket implementation already has bounded ongoing authorization in `server/terminal.ts:217–240,987–992`. The issue is specific to the agent SSE lifetime, not anonymous initial admission, GitHub account authorization, or the public-bucket policy.

**Required correction:** give SSE a server-owned ongoing authorization check and expiry deadline, with bounded timing, failure closure, and timer/listener cleanup. Continue closing immediately for local revocation. Do not rely on browser polling, a second REST request, or EventSource reconnect to enforce an already-open connection's session boundary.

**Acceptance evidence:** exercise the actual authenticated agent SSE route with a valid soon-expiring session and no further HTTP requests; prove events stop after expiry. Also prove that externally persisted revocation is observed without an unrelated request, that failed/slow authority checks cannot keep publishing indefinitely, and that an authorized reconnect still receives its saved snapshot. This review did not run these cases.

### R2 — P2: Live child questions are absent despite the inline-question UI

**Source-confirmed behavior; upstream-compatible, but a mismatch with a literal reading of the latest user requirement.** The requirement says native delegation should expose “required child approvals/questions inline.” Child approvals have a real execution path. Child structured questions currently do not:

- `server/agent/engine.ts:1358` only registers `request_user_input` for root Plan runs.
- `server/agent/engine.ts:1767–1768` rejects every delegated thread even if a provider returns that tool call.
- `server/agent/user-input.ts:36` describes the tool as root-only.
- `server/agent/instructions.ts:83,87` instructs children to send missing-information questions to the parent instead.
- `client/components/chat/InlineAgents.tsx:481–484,487–492` can display an `awaiting_input` child and its question, but this state cannot be produced by the present question handler. Existing fixture rendering is not live child-question evidence.

This is **not** an omitted upstream implementation: the pinned official `codex-rs/core/src/tools/handlers/request_user_input.rs:69–72` also rejects non-root agents, and `request_user_input_tests.rs:28` verifies that rule. Parent-mediated questions are a real supported alternative, but they must not be described as directly generated inline child questions.

**Required completion decision:** either deliberately support the user's literal child-question behavior, or accurately retain and state the parent-mediated scope. No platform/provider limitation prevents the former merely because the reference CLI restricts it. If implementing direct child questions, update tool admission, runtime validation and the child prompt together; publish `collaboration.onStatus(..., 'awaiting_input')` and the resumed status as well. The current `requestUserInput` callbacks at `engine.ts:1772–1786` only publish events to the child's thread, whereas the always-visible parent request cards depend on the collaboration record's status.

**Acceptance evidence for direct child support:** a real native child loop reaches a question through the normal tool path, the parent displays it without opening child details, an authenticated answer resumes only that child, reconnect restores the pending request, stale/skipped answers do not grant permission, and Stop/restart leave no hanging approval/question state. Fixture cards alone do not establish this.

## Source-supported behavior with no additional blocking defect established here

| Area | Inspected evidence and practical boundary |
| --- | --- |
| Real agent execution and permissions | `server/agent/engine.ts:1355–1361,1548–1590` offers and checks the admitted tool set, validates rewritten mutation arguments before Ask approval, and executes actual native handlers. `tools.ts:159–188,212–287` uses real workspace files and commands. Plan excludes mutation/shell tools; Full access removes per-action prompts but not host rules. Test-only transports are constructor seams, not a production fake-answer branch. |
| Child isolation and inherited restrictions | `engine.ts:958–971` creates an empty child history with only the assigned brief/configuration. `collaboration.ts:478–585` intersects parent/ancestor/live-root capabilities and preserves admitted role policy. `collaboration.ts:596–599` rejects `fork_context: true`; explicit user root forks are a separate control. No new escalation defect was established by this review. |
| Child approvals and ordinary activity | `engine.ts:1729–1751` persists the real approval, publishes collaboration status and resumes on a one-use decision. `InlineAgents.tsx` connects actual spawn result IDs to same-family records, obtains authenticated child snapshots/events, and posts decisions to the child's approval route. The R2 distinction applies to questions, not approvals. |
| Public reasoning and readable results | `transport.ts:151–257` accepts only public reasoning-summary events/`summary_text` parts, separately from opaque reasoning continuity. `engine.ts:1405–1427` redacts and publishes these summaries. `publicThread()` returns only the public thread, not `SavedThread.input`. Tool presentation projects inspectable file/command/results into readable sections. Actual encrypted reasoning is retained internally for provider replay and is not treated as a visible summary. |
| Password gate, mutations and PTY sockets | `index.ts:102–111` places application routers behind session checks; `auth.ts:276–306` enforces same-origin mutation headers and secure production cookies. The native PTY upgrade and live connection have asynchronous authorization and revalidation. R1 remains the SSE exception. |
| Saved GitHub accounts | `github.ts:173–221,339–380` uses immutable encrypted connection versions with durable disconnect markers and exposes public metadata only. `/user` verifies a new PAT before publishing it (`589–621`). Askpass files contain no PAT; account secrets enter only the bounded command environment and are removed in `finally` (`490–541`). `auth.ts:345–367` changes session authority only on logout. `client/api.ts:17` distinguishes workspace expiry from GitHub's separate authorization errors. |
| Account/repository selections across restart | Workspace records retain `githubAccountId`; managed checkout records retain their identities/account choices. `tests/github-persistence.test.ts:267,356` defines actual replacement-process scenarios for two accounts and real Git repositories. These test definitions support the intended design; this reviewer did not rerun them or verify a real user's hosted account connection. Stable production secrets remain a prerequisite and are required by `config.ts:42–45`. |
| Startup recovery | `engine.ts:223–274` marks live saved runs interrupted, clears stale pending decisions, repairs incomplete calls and keeps queued user input. `collaboration.ts:234–268` recovers child lifecycle metadata without replaying commands. `memories.ts:165–179` marks unfinished extraction interrupted rather than spending tokens on restart. This does not promise OS processes survive an instance replacement, distributed storage linearizability, or every possible corruption scenario. |
| Fixed service and host prohibitions | `provider.ts:7–8,32–41` fixes the complete Responses URL and literal placeholder and returns a local model catalog. `transport.ts:402–403` calls that URL directly. Root/child prompts repeat `HOST_RULES`; semantic, memory and review helpers include them. The title helper contains the prohibitions explicitly (`thread-naming.ts:177`). Ordinary host commands have an executable/wrapper guard; it is not represented as OS isolation. |

## Main-application wiring and remaining evidence boundary

These capabilities are connected in source; they are not missing panels waiting for an import:

| Capability | Main application path | What still cannot be claimed from this review |
| --- | --- | --- |
| Hosted web search | Settings exposes `disabled`, `cached`, `live` and saves `webSearchMode` (`SettingsDialog.tsx:82,111–113`). The engine applies it at each ordinary request (`engine.ts:1433–1448`). `MarkdownMessage.tsx:64–76` renders safe citations, including child transcripts (`InlineAgents.tsx:473`). | The exact final composed Settings/chat/citation browser flow and the final hosted runtime were not exercised here. Existing controlled presentation tests are not an unmocked hosted search session. |
| Memories | App mounts Settings with its workspace identity (`App.tsx:417`); Settings mounts `MemoryManager` (`SettingsDialog.tsx:95,117`). Authenticated memory routers mount in `index.ts:111`. Generation/use default off independently, and root request-local recall stays out of saved model histories/children. | Final-candidate Settings/API/restart behavior still needs its own completed gate. The implemented scope is newly completed ordinary root turns and workspace-local recall, not all upstream global memory consolidation/startup import. |
| Managed worktrees | App supplies ready/archive/switch callbacks (`App.tsx:418`); `WorkspaceSwitcher.tsx:41,74,88,97` exposes the actual manager. The server initializes/drains the service and mounts its authenticated router (`index.ts:78,111,146`). | `tests/e2e/worktrees-ui.spec.ts:532,642` defines composed `@app` cases, but existence of those tests is not evidence that the current candidate passed them. Process/worktree failures are owned elsewhere and are not waived by source wiring. |

`COMPLETION_AUDIT.md` and `REQUIREMENTS.md` are historical checkpoints dated 2026-09-19. Their “frozen main integrations” wording does not describe this actively changing source snapshot. They already distinguish earlier release `318683f`, urgent live hotfix `9b92ba1b07f382855f3c8f76f6f8a947213792e4`, and earlier actual provider/download evidence for `a785470…` from the later main feature set. Preserve that distinction. None of those recorded older passes closes current tree, upload, editor/settings, process, compaction, or R1/R2 acceptance work.

Before marking the overall outcome complete, the coordinator still needs an immutable final candidate, its appropriate complete type/build/behavior/browser gate, synchronization/deployment of that exact source, matching running runtime identity, and relevant hosted persistence/authentication/interaction evidence. This review adds no passing test count or fresh live-release claim. Optional old-QA cleanup remains governed by the reviewed one-time workflow; it is not a prerequisite for this source review and must not affect current user work, account connections, or ordinary future persistence.

The complete upstream archive is valuable study/reference material, **not proof of a complete port**. MCP and forbidden host machinery remain excluded by the user's request; TUI rendering and platform packaging are not browser-workspace requirements. The documented memory subset, service-specific search modes, and single-process worktree admission must remain explicit. No additional applicable feature is declared impossible solely because this review did not test its provider contract.

## Inspected-source identity

These SHA-256 hashes identify the source at this review checkpoint. Later owner fixes should supersede them with final-candidate evidence rather than retaining the findings as unqualified claims about changed code.

```text
596cc303b46148689ae100aa6aeffdef1bb7823bc0d5d00f00d20a7e9fb31091  server/agent.ts
384c8fe0ab3365b70b9d293e8381266e50d5da73af3e1db4b413e9426eee149b  server/auth.ts
5086f2c288a9fa3495cad26c730f413e21ba917628a5acb5561647d8d4e85c25  server/agent/engine.ts
b0f74d15955311f60b98418c1ec9f3618102611bd2a6fc2f15fc04824636e404  server/agent/instructions.ts
bd15a58f87a85abce349c13cd9b119b55b0cafbbe63a0a9ca8259ee7aa9a2cac  server/agent/user-input.ts
b088e656e3110227968a4945509c7888742d8d2c78dadb0f1a129b960266fccf  client/components/chat/InlineAgents.tsx
ee76355c580754ff8b790bae35339bf7c7e4dda9fa5d9fba63fc3df94486b988  server/index.ts
9398e9fe1745b75eb29fc1d98d13f2581f282ff9e00025c0c988d59d51cea086  client/App.tsx
f959b2264239d1457e2a5fae4920527de4ee605d1728398e41d6c12ace900798  client/components/SettingsDialog.tsx
```

## Follow-up: direct browser workspace uploads

This follow-up reviewed `server/uploads/*`, `server/uploads.ts`, `client/uploads.ts`, `client/uploads.worker.ts`, their actual EditorPanel/application wiring, and the relevant installed `@huggingface/hub` source. It remains a static review. The first read failed under shared host pressure; reads resumed only after the coordinator reported that cleanup had completed. No app/runtime, build, tests, browser, network or credential operations were performed. Only this document was changed by the reviewer.

### R3 — P2: Failed durable admission could strand a queued upload — corrected in source

The original `UploadService.complete()` mutated the job to `queued` and assigned its hashes **before** `await persist()`, while adding the job to the execution queue only after that write. A rejected write therefore left a queued job with no worker. The identical-hash retry returned that job immediately, and the client's transient-response reconciliation adopted it and polled for up to ten minutes. This was an established source failure path, not a hypothetical provider limitation.

The finding was sent to the coordinator and backend owner. The owner added a catch around admission persistence in `server/uploads/service.ts:315–321`: restore `reserved`, clear the unadmitted hashes, emit the corrected state, then return the storage failure. Queueing and publication remain after successful persistence. The reviewer reread that correction. `tests/uploads.test.ts` now contains a case titled “rolls back failed durable admission and imports the same session on retry after storage recovery,” including no publication before admission succeeds. **The correction is source-reviewed; this reviewer did not run the test.** Previously accepted hashes remain immutable, and this rollback does not retry a partially executed provider publication.

### Upload boundaries established by the inspected source

| Area | Finding |
| --- | --- |
| Real direct transfer and publication | The worker calls the real SDK `commitIter` (`client/uploads.worker.ts:164–180`). Its custom fetch permits only fixed CAS chunk lookup/xorb/shard routes with the temporary capability (`116–161`). It intercepts the single reserved `addFile` publication request, extracts its Xet hash and throws an internal sentinel; it never returns a fabricated successful Hub publication response (`103–113`). The installed SDK's `src/lib/commit.ts:855–913,1020–1023` awaits shard work, sends that batch shape and rethrows the sentinel unchanged. The server separately performs the real fixed-bucket batch publication and metadata readback (`server/uploads/bucket.ts:138–160`). Thus CAS completion is not presented as a completed workspace save. |
| Temporary token isolation | The durable upload record has no capability field; the service explicitly projects its job output, and capabilities live in a separate in-memory map. The server's HF writer token is used only on fixed Hub metadata/publication/token/deletion requests. The authenticated capability route uses `no-store, private` (`server/uploads.ts:37–39`). Server capability validation rejects writer-token equality, `hf_` tokens, invalid JWT shape, unexpected CAS origins and expanded lifetimes (`bucket.ts:20–30`). A fresh worker per file contains the SDK token cache and is terminated on success, failure or cancellation (`client/uploads.ts:131–183`); neither progress state nor worker completion messages contains the capability. |
| Size, hashes and create-only destination | Client and server bound the chosen file to 25 MiB; the server accepts only destination/size followed by the two hashes. It checks the staged path, exact size, Xet hash and provider upload time; limits the downloaded body to the declared size; compares SHA-256 of the actual bytes; and checks the remote metadata again before installation (`service.ts:335–377`, with later line shifts after R3). `install.ts:32–76,135–160` uses no-follow directory traversal, a pinned parent FD, exact byte verification and `COPYFILE_EXCL`. Existing files, late-created files, links and changed parents are refused rather than overwritten. |
| Cancel, close and restart | Cancellation terminates browser transfer and uses an independent bounded request to reconcile a possibly committed server result. An unreachable finalization is labelled `unconfirmed`, not saved/cancelled (`client/uploads.ts:305–325`). The server persists commit intent before its non-interruptible final copy, then drains an in-progress commit on cancel/close. Restart verifies exact size/hash from that intent and never replays an uncertain write (`install.ts:155–183`; service recovery/close). An incomplete or later-modified destination is retained and reported as interrupted. A platform crash during `copyFile` is not described as atomic file publication. |
| 24-hour cleanup | Published `imports/<UUID>/<filename>` copies expire from the provider's actual `uploadedAt`. Cleanup runs at startup, scheduled intervals and known expiries, discovers orphan objects, rechecks metadata before deletion, and preserves unknown-timestamp/replaced objects while reporting cleanup failure. Failed/cancelled published jobs may be removed earlier. Removing staging preserves a ready workspace file and its successful job result. The upload deleter cannot target download paths or the native data bucket. |
| Main UI and authentication | EditorPanel uses `uploadWorkspaceFiles` for file-picker and drop actions, checks dirty/conflicted/saving/missing buffers before reservation and finalization, scopes callbacks to the current workspace/controller, aborts on workspace teardown/lock, and refreshes the destination only after confirmed saves (`EditorPanel.tsx:264–279,539–574`). The router is mounted behind the ordinary session/origin middleware; application initialization awaits uploads and shutdown drains uploads before worktrees. CSP allows the fixed CAS origins and WASM hashing. The legacy authenticated raw-upload REST route still exists, but the inspected app upload path does not use it or fall back to it. |

The temporary capability is a provider-issued CAS JWT, **not** a per-file or per-byte attenuated permission. `docs/UPLOADS.md:45–47` explicitly states that cancelling/logout cannot revoke an already issued JWT and that provider-internal unreferenced CAS blocks are outside the app's published-object deletion API. The 24-hour promise applies to published bucket staging copies. This scope is material and must remain explicit; source-side 25 MiB checks must not be represented as a limit enforced inside the CAS credential itself.

No additional concrete functional/security defect was established by this bounded upload review after R3's source correction. This is not a release certification. The worker boundary suite intentionally mocks `commitIter`; it validates the boundary logic, not actual browser SDK packing/WASM/CORS or current HF behavior. The final candidate still needs its owned behavior/integration checks and actual direct-browser-to-CAS, server-publication, downloaded-byte, permanent-file, cancellation/restart and retention evidence where claimed. Earlier protocol probes or download-only proofs cannot be relabelled as verification of this composed upload implementation. R1/R2 above were not re-audited by this upload-only follow-up.

Inspected upload source hashes after the admission correction:

```text
ac6a0058555a87283b083ff21a9622930cc91f2566a5d0444ee3e248ffc16bd2  server/uploads/service.ts
0a78fd71330c7cbb5cf81591c0c907fe072acc068b93092fdaf5f64c06992196  server/uploads/install.ts
8cb037616ef5d926058d02134e842d94214402459ad3713543e67a6c21bdcf69  server/uploads/bucket.ts
e80412cf672757b49020e1cb088ee3e3fab751c2d196eb0535b221dab840120a  server/uploads.ts
a52962b9624781b4f6c4061173e7abf4bee4494dc1f883428d460103980f2227  client/uploads.ts
0fff9d0fc220e6d85901d42821118f44538f8bfb40ce699e28cb7dbbc32a44c0  client/uploads.worker.ts
592e60a0cc2338bfa022ce11b52f567d9854415ffbc142b2000618fa493660cc  client/components/EditorPanel.tsx
```
