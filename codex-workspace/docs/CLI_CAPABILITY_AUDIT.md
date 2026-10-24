# Official Codex CLI capability audit: 0.155.1

September 30 correction: installed `0.159.2` now selects paginated history for
new durable threads when its store supports it. Real isolated probes verified
item pagination after materialization, preserved live/stored IDs, and
mode-preserving resume/fork behavior. Empty paginated threads and legacy threads
can both reject `thread/items/list`; those rejections must not be cached
process-wide. The website no longer forces legacy mode for new threads, and
existing legacy conversations are not migrated. See
[native history identity](NATIVE_HISTORY_IDENTITY.md) for the current behavior
and the explicit live/reconstructed view handoff. The older audit below remains
specific to its original version and date.

September 23 correction: actual 0.156.1 RPC probes show that `thread/items/list` can be exported in the schema yet return `-32601` (“not supported yet”). Native turn pagination works for materialized legacy-mode threads. The current bridge detects this and uses real turn pages; empty first-turn history and per-thread unsupported operations are handled separately. The current settings and MCP scope supersedes this audit's earlier exclusions; see [WORKSPACE_SETTINGS.md](WORKSPACE_SETTINGS.md). This audit remains a record of its stated version and date.

Audited on 2026-09-22. The new instruction to use the official CLI supersedes the earlier prohibition on the Rust executable. The agent runtime, scheduling, goals, approvals, tools, memory generation and model traffic should belong to Codex. The application remains an authenticated browser client and retains its independent editor, files, terminals, Git/GitHub, uploads/downloads, workspaces and other site tools. Existing custom conversations remain readable legacy records; they must not be presented as imported native sessions.

This is a protocol and source audit, not a successful provider-connectivity or deployment test. The CLI commands executed were version/help, schema generation and `features list`. No app-server RPC, model turn, provider request, account login or credential operation was performed. Commands used an empty, owned application home and workspace under `/tmp/codex-cli-capability-audit-20260922-j9k8s33l`; no controlling CLI authentication/configuration was used. Before this work, cgroup usage was **848,965,632 bytes** at **2026-09-22T13:34:26Z**, with a 104,000,000,000-byte kernel limit. The applicable ceiling remains 90,000,000,000 bytes with 2,000,000,000 bytes reserved, including cache/tmpfs. `/tmp` is overlay-backed; `/data` is FUSE. A later sample at 13:45:26Z was 1,152,921,600 bytes.

The evidence has three distinct levels:

| Evidence | What it establishes |
| --- | --- |
| Installed `codex-cli 0.155.1`, its generated JSON/TypeScript schemas and local feature listing | Exact exported wire types, method/field experimental gates and this binary's reported feature maturity/defaults. |
| Fetched [official app-server documentation](https://learn.chatgpt.com/docs/app-server), [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) and [CLI guide](https://learn.chatgpt.com/docs/codex/cli) | Documented operation and product-readiness guidance. Copies are in `/tmp/codex-cli-migration-research/{app-server,config,cli}.txt`. The HTML copies identify these canonical official URLs. |
| Preserved official source, commit `78245b47af2a7aafcabe025828ceecca69db4df1` | Inspectable implementation and upstream test evidence, especially native queue dispatch. It is a separately pinned source snapshot, not a proven build commit for the installed executable. Its workspace Cargo version is `0.0.0`; npm metadata does not supply `gitHead`. Do not imply an exact binary/source build match. |

The archive is `upstream/codex-78245b47af2a.tar.gz`, SHA-256 `783b5d7c8927c99eff5e53d35acf65251121fcdc82a4d411fd41621735d0fcf7`. Selected source was copied only into the owned audit directory. Archive paths cited below omit its `codex/` prefix.

The installed executable generated the following, under that same isolated process environment:

```sh
codex app-server generate-json-schema --out <owned-dir>/json-stable
codex app-server generate-json-schema --experimental --out <owned-dir>/json-experimental
codex app-server generate-ts --experimental --out <owned-dir>/ts-experimental
```

All completed successfully: 312 default JSON files, 437 experimental-inclusive JSON files and 861 experimental-inclusive TypeScript files. The CLI warned that it would not create PATH helper aliases under a temporary Codex home; schema generation still succeeded. The audit directory contains the command records, output logs and file manifests.

| Schema index | SHA-256 |
| --- | --- |
| `json-stable/ClientRequest.json` | `85d6d137bab416d9ad47982adf354d707713042da5d37f934d0b2ed386e53ca4` |
| `json-experimental/ClientRequest.json` | `ef13a122e4fb0296b377d571fc26dc4bb7d85736364a65530a87d13fd84234a2` |
| `json-experimental/ServerRequest.json` | `97149b290b077be5d970e7b1ade1e936d1152520b6c0187ce8745cb3d639b2cb` |
| `json-experimental/ServerNotification.json` | `49a787f49a8ba46034fbea8664f4cbfe10211abd57e34b8281430a7dc033b42b` |

`ClientRequest.json` exports 102 methods by default and 164 with experimental APIs. `ServerRequest.json` exports 10 and 11 respectively; both notification indexes contain 82 names. Extract client method names from `oneOf[].properties.method.enum`, and compare individual parameter schemas as well. A method can be exported while particular fields require experimental opt-in. Notification membership is not proof that a disabled feature will emit it. Presence also does not prove storage/provider availability or production readiness.

The local feature listing reports `goals`, `hooks`, `multi_agent`, `plugins`, and `memories` as stable; memories defaults off, the first four default on. `multi_agent_v2` is stable but defaults off. `collaboration_modes`, `multi_agent_mode`, and `plugin_hooks` are removed feature switches: do not build controls around them. This does not remove the still-exported `collaborationMode` turn parameter.

The transport should be a supervised local **stdio** app-server with an authenticated application broker. Messages are newline-delimited JSON-RPC-shaped objects without a `jsonrpc` field. Initialize once per connection, await the response, then send `initialized`. Every new CLI connection has its own request/callback lifetime. The official documentation warns about experimental WebSocket deployment behavior; an externally reachable raw app-server socket is unnecessary here. [Official protocol and initialization](https://learn.chatgpt.com/docs/app-server)

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"codex_workspace","title":"Arc Workspace","version":"<app-version>"},"capabilities":{"experimentalApi":true,"requestAttestation":false,"optOutNotificationMethods":["item/reasoning/textDelta"]}}}
{"method":"initialized"}
```

Experimental opt-in is necessary for the native queue and native Plan-mode control. It is not permission to expose every RPC. Keep the broker allowlist, workspace association, authenticated sessions and same-origin mutation checks. Do not accept arbitrary `cwd`, configuration paths, provider selection, history injection, rollout paths or RPC methods from a browser.

The direct lifecycle/input mappings are:

| Operation | Native request and relevant result | Boundary |
| --- | --- | --- |
| Create | `thread/start {cwd, model?, modelProvider?, approvalPolicy?, approvalsReviewer?, sandbox?, config?, developerInstructions?, ...}` → thread and effective configuration | Provider/home/host instructions are server-owned. `historyMode:"paginated"` is an experimental field. |
| Browse | `thread/list {cwd?, cursor?, limit?, sortKey?, sortDirection?, archived?, searchTerm?, ...}` → `{data,nextCursor,backwardsCursor}` | `cwd` filters exact native working directories. Parent/ancestor filters are experimental. Do not substitute local fake native IDs. |
| Read without loading | `thread/read {threadId,includeTurns?}` → `{thread}` | Prefer this for browsing. It does not resume an unloaded thread. |
| Resume | `thread/resume {threadId,excludeTurns:true,...}` → thread/configuration and hydration cursors | **Can start native queued work or goal continuation.** This is a behavioral operation, not a metadata read. Never use its experimental `history` or `path` fields to import legacy custom conversations. |
| Page history | `thread/turns/list {threadId,cursor?,limit?,sortDirection?,itemsView?}` and `thread/items/list {threadId,turnId?,cursor?,limit?,sortDirection?}` | Return native opaque cursors. Turn items can be `notLoaded`, `summary`, or `full`; an empty array is not necessarily empty history. |
| Start work | `turn/start {threadId,clientUserMessageId?,input,model?,effort?,summary?,...}` → `{turn}` | Use actual selected literals. An already-active turn can be steered by this endpoint; use explicit steering when the UI requires a current-turn precondition. |
| Steer | `turn/steer {threadId,expectedTurnId,clientUserMessageId?,input,...}` → `{turnId}` | Requires the matching active turn; no new turn and no model/cwd/permission override. |
| Stop | `turn/interrupt {threadId,turnId}` | Await native terminal events. Do not manufacture successful completion from the HTTP acknowledgement. |
| Rename | `thread/name/set {threadId,name}` | Use native name updates; there is no separate exported semantic auto-name RPC. |
| Archive/delete | `thread/archive`, `thread/unarchive`, `thread/delete` with native IDs | Preserve the site's independent workspace trash/repository classification policy. |
| Fork | `thread/fork {threadId,lastTurnId?,excludeTurns:true,...}` | `lastTurnId` is inclusive. Experimental `beforeTurnId` excludes that turn; do not combine them. Experimental `deferGoalContinuation:true` carries a goal without immediately starting its initial continuation. |
| Compact | `thread/compact/start {threadId}` | CLI owns summary generation and automatic compaction. No second TypeScript compaction loop. |
| Revert conversation | `thread/revert {threadId,beforeTurnId}` | Paginated history only, excludes the selected and later turns. **No file, index, branch or Git-history restoration.** |

These fields are grounded in generated `v2/Thread*Params.ts`, `v2/Turn*Params.ts` and corresponding response types. The deprecated `thread/rollback {threadId,numTurns}` also changes only conversation history. Prefer `thread/revert` for new paginated threads. Its response is `{thread,turnsBackwardsCursor,itemsBackwardsCursor}` with `thread.turns` empty; rehydrate using native pages. The archived handler rejects non-paginated threads and replaces the native conversation runtime/history; it does not implement the old application's Git checkpoint recovery. [Official thread/turn guide](https://learn.chatgpt.com/docs/app-server)

Native `Thread.id` and `Turn.id` are UUIDv7. Keep native IDs intact. The old `thr_`/`run_` validators and app-authored turn identities do not describe them. `Thread` includes `sessionId`, `cwd`, `parentThreadId`, `forkedFromId`, `historyMode`, `name`, `preview`, `model`, `reasoningEffort`, `canAcceptDirectInput`, agent nickname/role, and creation/update timestamps in Unix seconds. Its `status` is `notLoaded`, `idle`, `systemError`, or `active` with `waitingOnApproval`/`waitingOnUserInput` flags. `Turn` carries native items, `itemsView`, `inProgress|completed|interrupted|failed`, a nullable error, timestamps and duration. The native `Thread` is not the existing application's `Thread` DTO.

The exact user-input union is `text`, `image`, `localImage`, `audio`, `localAudio`, `skill`, and `mention`. A safe ordinary prompt is `{type:"text",text:"...",text_elements:[]}`. Image fields are `url` or `path` plus optional `detail`; a selected skill is `{type:"skill",name,path}`. The app must resolve paths within the authorized workspace/catalog. Audio variants existing in the schema do not reverse the user's exclusion of unsupported audio/realtime.

There is **no general-file UserInput variant**. `thread/attachment/add {threadId,attachmentType,identityKey,payload}` stores arbitrary independent attachment metadata; list/remove use that identity. It is not a transfer service or proof that file bytes became model context. Keep the site's real file-transfer and attachment tools. Present validated local files through genuinely supported native file access or an explicit native dynamic-tool bridge; do not invent an inline Responses file item, treat `mention` as undocumented arbitrary file ingestion, or claim that metadata storage uploaded a file to the model.

The existing site DTOs need presentation adapters, not a second runtime:

| Existing surface | Native source | Required adjustment |
| --- | --- | --- |
| `Thread`/`ThreadSummary` | Native thread metadata, associated with an authorized site workspace | Preserve native ID/cwd and provider-returned state. Distinguish `notLoaded` from an active connection. Keep legacy records read-only. |
| `ChatMessage`/timeline | Native item IDs, item order, delta notifications and completed items | Keep assistant text/reasoning summaries/tool actions interleaved. UI pagination/cache is allowed; it must not become model history authority. |
| `ThreadTurn` | Native turn ID/status and item pages | No fabricated `userMessageId`, custom journal authority, `modelRequest` snapshot, or memory-capture flag in native state. |
| `ToolActivity` | `commandExecution`, `fileChange`, `dynamicToolCall`, `collabAgentToolCall`, other native item variants | Display readable native data and terminal status; do not run the old `AgentTools` dispatcher for CLI built-ins. |
| `ApprovalRequest`/question | Server-initiated native requests | Retain outer JSON-RPC ID and connection generation; native decisions are not one boolean plus an invented memory approval kind. |
| `AgentRecord` | Native parent/session IDs, role/nickname, collab items and child threads | Honor `canAcceptDirectInput`; some native subagents reject direct app-server input. Do not synthesize a separate child scheduler or context inheritance policy. |
| Queue | `thread/queue/*` | Native IDs/input/client IDs only. Old per-entry model policy, held reasons and timestamps are not exported queue fields. |
| Goal | `thread/goal/*` | Use native status/budget/counters; remove custom continuation scheduling and revision/accounting claims. |
| Context/usage | `thread/tokenUsage/updated` | Keep absent data unknown. No invented request count, local billing ledger, or history-derived token estimates. |
| Review | `review/start`, native review items and native turn diff | Preserve the returned format; do not promise the former custom structured finding/snapshot contract. |
| Agent change undo/rewind | Native diffs and conversation-only revert | No native equivalent of the custom file/index checkpoint transactions, keep/undo ledger or dirty-aware Git rewind recovery. Retain independent site Git/editor operations with their actual semantics. |

The stream provides `thread/started`, `thread/status/changed`, `turn/started`, `turn/completed`, `item/started`, `item/completed`, `item/agentMessage/delta`, command/file output deltas, `turn/diff/updated`, `turn/plan/updated`, compaction events, goal/queue changes, warnings and errors. Delta identity is normally `{threadId,turnId,itemId}`. Reasoning summaries also carry `summaryIndex`. A native `reasoning` item has both `summary` and raw `content`: expose only `summary`, and do not forward `item/reasoning/textDelta`, raw events, encrypted reasoning or protocol JSON to the conversation UI. `experimentalRawEvents` must stay false. Final `item/completed` payloads are authoritative over partial render state. [Official events/items](https://learn.chatgpt.com/docs/app-server)

`collabAgentToolCall` identifies the sender, receiving thread IDs, native action, status, optional prompt/model/effort and agent states. Its action union includes `spawnAgent`, `sendInput`, `resumeAgent`, `wait`, `closeAgent`, `sendMessage`, `followupTask`, `interruptAgent`, and `listAgents`. These are native model tool activities, not exported client RPC methods with those names. Inline child activity and child approvals can remain; nonexistent app-side spawn/control RPCs must not be fabricated.

Server-initiated requests must be answered as JSON-RPC **responses using the same outer request ID**, which can be a number or string. Do not confuse it with `itemId`, `callId`, or the optional command `approvalId`. Several callbacks can concern one item. Scope every pending callback to the owning connection, native thread/turn and authenticated workspace. Clear it on `serverRequest/resolved {threadId,requestId}`, interruption or connection loss; never replay an approval after CLI restart.

| Native server request | Important fields | Response |
| --- | --- | --- |
| `item/commandExecution/requestApproval` | `kind,threadId,turnId,itemId,startedAtMs`, optional command/cwd/reason, network context, callback `approvalId`, proposed amendments | `{decision:"accept"\|"acceptForSession"\|"decline"\|"cancel"\|<typed amendment>}`. Honor `availableDecisions` when supplied; it and `additionalPermissions` are experimental fields. |
| `item/fileChange/requestApproval` | Thread/turn/item identity, start time, optional reason/grant root | `{decision:"accept"\|"acceptForSession"\|"decline"\|"cancel"}`. The schema itself calls `grantRoot` unstable. |
| `item/permissions/requestApproval` | Requested filesystem/network permissions, cwd and identities | `{permissions:<granted subset>,scope:"turn"\|"session",strictAutoReview?}`. No boolean substitute or invented extra grant. |
| `item/tool/requestUserInput` | `questions,isBlocking,autoResolutionMs` plus identities | `{answers:{<questionId>:{answers:string[]}}}`. Questions have `isOther`, `isSecret`, and nullable options. Keep secret answers masked; do not force every question to be blocking or to offer Other. `autoResolutionMs` is deprecated in the installed schema; use `isBlocking`. |
| `item/tool/call` | `threadId,turnId,callId,namespace,tool,arguments` | `{contentItems:[{type:"inputText",text}\|{type:"inputImage",imageUrl}\|{type:"inputAudio",audioUrl}],success:boolean}`. Only for explicitly registered dynamic site tools. |
| `currentTime/read` | `threadId` | `{currentTimeAt:<whole Unix seconds>}`; experimental callback. |

Legacy `applyPatchApproval`/`execCommandApproval` variants still appear in the server-request union. Other variants include MCP elicitation, account token refresh and opt-in attestation. They are not reasons to expose MCP/login/attestation UI in this fixed-provider application. Unsupported unexpected requests must receive a controlled response/error rather than hang silently. [Official approvals and dynamic tools](https://learn.chatgpt.com/docs/app-server)

The native durable queue is experimental at the RPC boundary and owns its dispatch:

| Method | Parameters/result |
| --- | --- |
| `thread/queue/add` | `{threadId,input:UserInput[],clientUserMessageId:string}` → `{queuedSubmission:{id,input,clientUserMessageId}}` |
| `thread/queue/list` | `{threadId,cursor?,limit?}` → `{data:QueuedSubmission[],nextCursor}` |
| `thread/queue/update` | `{threadId,queuedSubmissionId,input}` → `{queuedSubmission}` |
| `thread/queue/delete` | `{threadId,queuedSubmissionId}` → `{deleted:boolean}` |
| `thread/queue/reorder` | `{threadId,queuedSubmissionIds}` → `{}` |
| `thread/queue/start` | `{threadId,queuedSubmissionId?}` → `{turn}` |

`thread/queue/changed` contains only `threadId`; re-read the native queue. Preserve draft/client identity until native acceptance, and reconcile uncertain acknowledgements by reading native items/queue. Do not invent idempotency guarantees for a repeated add: the schema's client message ID is a correlation field, not documented as an idempotency key.

Archived implementation proof is `codex-rs/ext/queue/src/service.rs`: enqueue persists and wakes loaded threads at lines 265–279; native `dispatch_if_idle` starts and removes an accepted submission at 405–465; wake skips interrupted threads at 470–483; the lifecycle contributor ignores interrupted idle events and otherwise dispatches at 549–567. `ext/queue/src/lib.rs` installs that contributor. This is native runtime behavior, not TUI-provided scheduling.

Upstream `app-server/tests/suite/v2/thread_queue.rs` verifies idle automatic dispatch at line 369, persisted cold-resume dispatch at 430, interruption preserving the queue across restart plus explicit selected-item start and subsequent drain at 560, and busy start preserving the queue at 711. A cold metadata read/list does not load or dispatch the thread; resume can. Explicit start requires a loaded idle thread. Ephemeral threads do not support queued submissions. The source tests use a 100-entry capacity; treat runtime errors and the activated CLI version as authoritative rather than perpetuating the old app's 32-entry semantics.

Native goals are stable RPCs and a stable feature:

```text
thread/goal/set   {threadId, objective?, status?, tokenBudget?} -> {goal}
thread/goal/get   {threadId} -> {goal: ThreadGoal | null}
thread/goal/clear {threadId} -> {cleared: boolean}
ThreadGoal = {threadId, objective, status, tokenBudget: number|null,
              tokensUsed, timeUsedSeconds, createdAt, updatedAt}
status = active | paused | blocked | usageLimited | budgetLimited | complete
```

`thread/goal/updated` carries `{threadId,turnId:string|null,goal}`; `thread/goal/cleared` carries the thread identity. The documented objective limit is 4,000 characters. A changed objective replaces the goal and resets usage; the same nonterminal objective or omitted objective preserves accounting while changing status/budget. The archived native handler treats omitted **or null** token budget as Keep, so null must not be presented as removing an existing cap. Let Codex validate limits and return its canonical state. Setting an active goal can inject an objective or start an idle turn. Do not retain the custom TypeScript continuation controller, budget charging, goal IDs/revisions, or restart replay. [Official goal semantics](https://learn.chatgpt.com/docs/app-server)

Native token usage is notification-only in the inspected thread API. `thread/read` returns a Thread with no usage field; `ThreadExtra` is empty. Paged Turn and ThreadItem payloads also contain no usage. The available event is:

```text
thread/tokenUsage/updated {
  threadId, turnId,
  tokenUsage: {total, last, modelContextWindow: number|null}
}
total/last = {totalTokens,inputTokens,cachedInputTokens,cacheWriteInputTokens,
              outputTokens,reasoningOutputTokens}
```

Use actual native totals when observed, and the native `last.totalTokens` only as the private baseline for the selected context display. Preserve the user's exclusion of a public Last-response panel. When the native API has not reported usage, show unknown; do not resume merely to obtain it, inspect/reconstruct rollout JSONL, derive a model-request count from turns, substitute account-wide usage, or pretend independent descendant capacities add into one context window. These schemas provide no request counter. Native goal accounting is a different, explicitly persisted metric.

Native memory is a stable feature that defaults off. The documented controls are `features.memories`, `memories.generate_memories`, and `memories.use_memories`; the latter two default true behind the feature gate. Generate=false prevents newly created threads from being retained as generation inputs; Use=false skips injection into future sessions. These are not retroactive transcript erasure or typed-note mutation controls. Use the native config API against the server-owned app configuration and honor its version/managed-override result. [Official memory configuration](https://learn.chatgpt.com/docs/config-file/config-reference)

`config/batchWrite {edits:[{keyPath,value,mergeStrategy:"replace"}],expectedVersion?,reloadUserConfig:true}` can write those settings. Do not accept browser-chosen `filePath`. Its response includes `status`, `version`, canonical `filePath` and `overriddenMetadata`; a successful file write alone does not mean a managed override permits the requested setting. Reload does not update session-static model/effort/tier/personality defaults.

Memory-specific RPCs remain experimental: `memory/status {minConsolidatedThreads?}` returns only `{v2ConsolidatedThreads,v2Ready}`; `thread/memoryMode/set {threadId,mode:"enabled"|"disabled"}` changes per-thread generation metadata; `memory/reset` takes no parameters (or null) and returns `{}`. Reset is **global to that app-owned Codex home/state DB**: the archived handler clears all memory rows and memory-root contents. It is not a workspace/record-scoped reset. A production UI should not portray these experimental RPCs as stable contracts merely because the underlying feature is stable.

There is no exported native equivalent of this application's typed note CRUD, workspace/owner note inventories, exact-digest memory proposal approvals, per-record revision/operation receipts, extraction job manager, held-file review workflow or delivery receipt metrics. Remove those native-agent claims and custom execution paths. Preserve old records under the legacy-data policy; do not auto-import them, infer new grants from saved text, or recreate them as dynamic tools. The native CLI owns any enabled memory generation/consolidation work.

Skills are directly supported: `skills/list {cwds?,forceReload?}` returns entries with `cwd,skills,errors`; metadata includes native name, path, scope, enabled state and optional owning plugin. Explicit selection uses a native `skill` input item, optionally alongside the visible `$name` user text. `skills/config/write {path?|name?,enabled}` and `skills/extraRoots/set` are exported. Persist/reload actual skill files through ordinary site file operations and native discovery; do not preserve a separate custom skill-injection pipeline. [Official skills input](https://learn.chatgpt.com/docs/app-server)

Native plugin support exists, but method existence and production readiness differ. The installed default schema contains `marketplace/add|remove|upgrade`, `plugin/list|read|installed|install|uninstall|reconcile`, sharing methods and `plugin/skill/read`. Plugin source types include local, Git, npm and remote. `plugin/install` accepts a marketplace selector plus plugin name and optional attempt ID, not the old app's arbitrary direct import request. The official app-server documentation explicitly calls list/read/install/uninstall under development and tells production clients not to use them. Keep this as a documented readiness constraint for the coordinator; do not silently revive the custom installer/rollback engine and label it native. Native bundled plugin skills can still appear in `skills/list`. [Official plugin readiness warning](https://learn.chatgpt.com/docs/app-server)

`hooks/list` and stable native lifecycle hooks can be observed; hook execution remains CLI-owned. The configuration reference supports command and MCP-tool hook handlers and says prompt/agent handlers are parsed but skipped. MCP remains excluded for this application, including plugin-bundled MCP. It must be disabled by the runtime policy, not merely hidden from the browser. [Official hook configuration](https://learn.chatgpt.com/docs/config-file/config-reference)

`review/start` directly supports `{type:"uncommittedChanges"}`, `{type:"baseBranch",branch}`, `{type:"commit",sha,title}`, and `{type:"custom",instructions}`. Inline delivery is supported. Detached delivery is deprecated; the schema recommends creating a native thread then starting inline review there. Native `enteredReviewMode`/`exitedReviewMode` items carry review strings. Native turn/file diff events are available, but the old app's captured Git fingerprints, recovery transactions and structured ReviewResult are not promised by this protocol. Retain the independent site Git tooling and report native review results in their actual returned format. [Official review flow](https://learn.chatgpt.com/docs/app-server)

Model IDs and `effort` remain literal strings in the installed protocol; summary is `auto|concise|detailed|none`. Native Plan uses experimental `collaborationMode:{mode:"plan",settings:{model,reasoning_effort,developer_instructions:null}}`; Default uses mode `default`. Its settings take precedence over the outer model/effort, so populate them consistently. The deprecated `multiAgentMode` input is ignored; do not silently replace the user's chosen effort with Ultra. `model_verbosity`, `model_context_window` and `model_auto_compact_token_limit` are documented native config knobs. There is no `maxOutputTokens`/verbosity field on `turn/start`, nor an exported model-test RPC; do not forward old fields as if supported or maintain an independent Responses runtime to fill gaps. [Official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

Keep provider selection and the fixed Responses endpoint entirely server-owned. Experimental `allowProviderModelFallback:false` is available on thread start; do not silently substitute another model. The native `model/list` RPC is not the same name as an upstream HTTP `/models` endpoint, but this audit did not invoke it or prove it performs no network refresh. Use the runtime policy's native static-catalog solution before enabling discovery; the user's `/models` prohibition remains in force. A `model/rerouted` event must be represented honestly.

Native dynamic tools are the supported extension point for **existing independent site services** when the coordinator elects to expose them to Codex. Register typed `function` or `namespace` definitions in experimental `thread/start.dynamicTools`, handle the server's `item/tool/call`, and return its documented content items/result. Keep argument limits, workspace/thread authorization and permission controls in the actual site service. Do not duplicate native shell/file tools, replace goal/queue/memory machinery, add another model loop, or use dynamic tools to simulate unsupported native agent features. Browser UI access to editor/PTY/Git/GitHub/files/transfers does not require dynamic tools at all.

For startup installation and Update to latest, there is no app-server update RPC. This is a server runtime-management action: install the official package through the approved installer, identify the activated executable version, generate/check that version's schemas, and start a fresh connection with its own callback lifetime. Preserve the native home/state and legacy records; never erase them as part of an update. Do not hot-swap an active process or claim supported controls solely from an old generated bundle. Provider compatibility, native storage on the actual host, policy enforcement, and full application behavior still require the coordinator's separate verification; none was fabricated by this read-only audit.

The subsequent native-hook review found a possible admission check, **not a fail-closed or ongoing resource ceiling**. No hook was implemented. This follow-up inspected the preserved official source above; it did not run tools through a model or claim an installed-binary behavioral test. At 2026-09-22T14:14:15Z cgroup usage was 2,046,930,944 bytes, with the same ceiling/reserve and filesystem constraints.

`PreToolUse` command stdin is JSON with `session_id`, `turn_id`, nullable `transcript_path`, `cwd`, `hook_event_name:"PreToolUse"`, `model`, `permission_mode`, `tool_name`, `tool_input`, and `tool_use_id`; ordinary thread-spawned children additionally have `agent_id` and `agent_type`. Native `exec_command` shell execution is exposed to hooks as **`tool_name:"Bash"`**, with `tool_input:{"command":<cmd>}`. Native `apply_patch` uses **`tool_name:"apply_patch"`** and a `command` value containing the patch; `Write`/`Edit` are matcher aliases, not stdin names. Sources: `hooks/src/schema.rs:278`, `core/src/tools/hook_names.rs`, `core/src/tools/handlers/unified_exec/exec_command.rs:519`, and `core/src/tools/handlers/apply_patch.rs:458`.

A synchronous hook can block by exiting zero with valid stdout such as:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Insufficient resource headroom for another tool."}}
```

Exit **2 with nonempty stderr** also blocks. Empty successful output continues normally. In this implementation, `permissionDecision:"ask"` is explicitly unsupported; bare `allow`, `continue:false`, `stopReason`, and `suppressOutput` are also unsupported for this event. `allow` is accepted only with an input rewrite, which is unnecessary for resource admission. Runner/timeout errors, malformed output, unsupported decisions, other failure exit codes, and exit 2 without a stderr reason report hook failure while leaving `should_block=false`. Async handlers cannot apply control effects. Sources: `hooks/src/engine/output_parser.rs:121,369,442` and `hooks/src/events/pre_tool_use.rs:210–322`.

Inline configuration uses matcher groups under `[[hooks.PreToolUse]]` and command handlers under `[[hooks.PreToolUse.hooks]]`, with `type="command"` and `async=false`. Discovery accumulates hooks from allowed config layers instead of treating a later project array as simple replacement. User and session-flag hook sources are **not automatically managed/trusted**: ordinary handlers require enabled state and a matching native trusted hash unless trust is explicitly bypassed. Only user/session layers supply `hooks.state`; session values win over user values, and project/plugin layers cannot write that state. A server-owned global declaration alone is therefore not evidence of active enforcement. Managed sources receive stronger handling, but this migration does not acquire an `/etc` dependency or enable blanket trust bypass for untrusted project hooks. Sources: `hooks/src/engine/discovery.rs:94–181,664–731,790–839` and `hooks/src/config_rules.rs:8–72`.

Tool hook plumbing supports ordinary delegated `ThreadSpawn` sessions and includes their identities; it must use the child's effective enabled/trusted hook configuration. Internal/synthetic agent lifecycle start/stop behavior differs, so do not claim blanket coverage of every helper or host process. A hook cannot account for later growth in an already-running command, parallel execution, model/CLI allocations, startup installation, or independent site PTYs. Even a correct preflight against cgroup `memory.current` and the 88,000,000,000-byte admission threshold cannot itself guarantee the 90,000,000,000-byte ceiling. Native execpolicy and server-owned host instructions remain the baseline; ordinary host resource admission and CLI supervision are separate responsibilities. Sources: `core/src/hook_runtime.rs:131–151,181–241,1033–1051` and the control-effect checks cited above.
