# Native agent orchestration

The web IDE runs delegated agents through the same TypeScript `AgentEngine` as the root conversation. A child starts with its assigned self-contained task brief and required workspace, host, role and permission configuration. It has its own durable thread, model input, streaming response, tool loop, abort controller and owned command sessions. Children use the same host workspace, `AppContext`, JSON store, change tracker, workspace review group and process restrictions. They are real concurrent executions; the coordinator does not manufacture answers or use extra independent engine instances as a substitute for delegation.

`server/agent/collaboration.ts` handles identity, tree boundaries, admission limits, lifecycle, waiting and durable parent notifications. `server/agent/engine.ts` supplies the shared engine callbacks and exposes the authenticated API. `server/agent/group-review.ts` supplies the shared review baseline and mutation coordination. The production provider remains the fixed Responses endpoint `https://alvin3y10-api.hf.space/api` with the server-side placeholder credential. Delegation does not discover models, expose credentials or add a provider/proxy/MCP connection.

## Model tools and UI actions

| Tool | Behavior |
| --- | --- |
| `spawn_agent` | Create an isolated child with a bounded self-contained task, optional task name and builtin/configured role; start its real shared-engine run and return the child ID immediately after admission. |
| `send_input` | Reuse a child conversation. Queue steering for a busy child or start a new child turn when idle. `interrupt: true` drains its current owned execution before replacement input. Child-to-root guidance is queued with explicit agent origin and never starts an idle parent. Returns a submission acknowledgment, never an invented model answer. |
| `wait_agent` | Wait for any specified child to complete, fail or close; return actual results for terminal targets. Timeout returns `timed_out: true` and leaves live jobs untouched. The legacy `wait`/`ids` form is accepted by coordinator dispatch. |
| `list_agents` | Return the tree, roles, paths, models, exact reasoning levels, status, results and errors; never starts model work. |
| `interrupt_agent` | Interrupt the target and its running descendants, preserve history and changes, and return after owned execution has stopped. |
| `close_agent` | Explicitly close the target subtree after cancellation/cleanup, retaining the conversations and returning the previous status. |
| `resume_agent` | Reopen the same saved child identity without replaying tools or starting a model request. Explicitly closed descendants remain closed. Use `send_input` to assign the next turn. |

The API is mounted behind the existing server session authentication and mutation-origin checks:

| Method and `/api` route | Response / body |
| --- | --- |
| `GET /threads/:id/agents` | `AgentRecord[]` for this conversation tree. |
| `GET /threads/:agentId` | The ordinary saved child `Thread`; the existing thread SSE route streams its text, tool work, approvals and errors. |
| `POST /threads/:id/agents/:agentId/input` | `{ prompt, interrupt? }` or `{ message, interrupt? }`; response acknowledges the submission. |
| `POST /threads/:id/agents/:agentId/interrupt` | Interrupt and preserve the target subtree. |
| `POST /threads/:id/agents/:agentId/close` | Explicitly close the target subtree. |
| `POST /threads/:id/agents/:agentId/resume` | Reopen the saved child without starting model work. |

Root thread snapshots include `agents`. `agent_change` events contain the updated `agent` and action. The coordinator publishes the internal `collaboration:changed` event to the engine, which relays it to the root and direct parent SSE subscribers. The general conversation list hides delegated threads by default; `includeAgents=true` includes them. Their ordinary thread APIs remain available for inspection and approval. The browser’s simple Ask / Full access controls select permissions; no Codex flags are required.

The ordinary child `/threads/:id/run` and `/threads/:id/input` endpoints also enter coordinator admission. Opening a closed child in the normal composer cannot create an invisible run, bypass the concurrency limit or escape root cancellation. Child model, effort, mode and permissions remain inherited; a composer message can use the ordinary input endpoint without resubmitting root-default preferences as child overrides.

## Shared-engine contract

The coordinator requires a `CollaborationAdapter` with:

- `createChild(spec)`: save a child with durable parent/root identity and empty model history. Its first turn receives only the assigned brief and required configuration.
- `discardChild(id)`: remove an unadmitted, idle thread whose creation raced with closing/deleting its parent; never discards an admitted agent's history.
- `startChild(id, prompt, policy)`: admit a run into the same engine run map and return its run ID before completion.
- `sendInput(id, message, { interrupt, policy?, attachments?, sourceAgentId?, sourceRootThreadId? })`: persist steering or admit a child continuation using the existing conversation. The optional source fields mark trusted child-to-root guidance; they are not model arguments.
- `stopChild(id, reason)`: stop only this thread and await its owned process cleanup. The coordinator handles the subtree.
- `snapshot(id)`: consult the same engine’s authoritative thread/run state, without starting work.

Callbacks run outside the coordinator’s persistence lock. This matters because callbacks durably notify the coordinator with `onStatus` and must not deadlock on a lock held by the tool that started them. Per-agent action queues serialize input/reopen/close, while a short global admission queue reserves capacity before asynchronous thread creation. Model sampling and command execution are never serialized by that queue.

Authenticated image follow-ups use `sendInput(context, args, { attachments })` with up to eight validated immutable image references. The engine verifies their workspace, digest and combined byte limit and resolves actual model image content. This trusted adapter path supports image-only messages while retaining ordinary coordinator admission, ancestor permissions and cancellation. Model-generated `send_input` JSON remains text-only and cannot introduce attachment fields or raw image URLs.

An in-flight `send_input` remains active while the previous run saves its final answer and the next run saves its admission. During that gap the public status is `starting`, admission capacity remains reserved, and wait does not return the preceding run’s stale terminal state. This prevents a root from concluding while already-submitted follow-up work is entering the shared engine.

Queued actions observe the submitting run’s abort signal before they execute. This is necessary when a grandchild has queued a message to a parent that is being interrupted: parent cleanup must not wait forever for a grandchild waiting on that same parent’s action queue. Canceled queued callbacks perform no later mutation. Actions that have already begun still await their actual cleanup. State changes use a private draft, await the durable write, then publish the new record; readers and waiters never receive an uncommitted successful result.

`activeChildren(parentId)` includes running descendants for finalization and cancellation. `notifications(parentId)` returns stable, durable terminal result messages addressed only to the direct parent. The engine saves their IDs and content into its model inbox before calling `acknowledgeNotifications`. If a process dies between those writes, the same notification ID is redelivered and the engine deduplicates it. An idle parent is not automatically sampled merely because a child finishes.

A child's explicit message to its root also carries validated `sourceAgentId` and `sourceRootThreadId` metadata. The engine labels it as teammate guidance, records a system-visible message, and queues it for the active root or the next explicit user turn. It does not start or interrupt an idle parent, invoke a human `UserPromptSubmit` hook, or grant goal authorization. Public human input remains a separate path.

The engine requires the root to collect active delegated work before accepting the final answer. If a parent tries to finish early, it receives the actual active IDs and must wait, collect results or close unneeded work. Aborting a root run, an unrecoverable parent failure, and server shutdown cancel active descendants. A wait timeout never invokes restart, resume or stop.

## Identity, permissions and context

An agent ID is its actual thread ID (`thr_…`). Every record contains its direct parent, root, workspace, task name, canonical task path, role and depth. Workers have the parent’s coding tools. Explorers always run in plan mode; all descendants of a plan-mode run inherit plan mode. A child cannot widen Ask into Full access, change workspace, disable a host restriction, or escalate its authority by reopening an old thread. Continuations intersect their saved policy with every current recorded ancestor, including when the root or a peer sends the follow-up; controlling a grandchild directly cannot bypass a tightened intermediate parent.

The server also supplies live `rootPolicy` configuration for temporary read-only operations such as review. Every child spawn, continuation and resume intersects that root mode, approval policy and tool capabilities, including peer messages to an older Full-access worker. This contains execution configuration only. It conveys no parent conversation, and it cannot be supplied through model tool arguments. The engine independently enforces the same root limits when admitting a child.

Tightening an already-busy child to Ask or plan mode stops its old owned run and admits the continuation under the tighter policy. Both actual tool enforcement and regenerated system instructions change; updating the displayed permission alone is insufficient.

The model and reasoning level use valid explicit spawn settings, configured subagent defaults, or the effective parent turn, in that order. A selected role's locked model/effort then applies; both the requested and resolved pairs are validated against `shared/model-catalog.ts`, including both Team red entries. Exact reasoning values are `low`, `medium`, `high`, `xhigh` and `max`; there is no silent substitution. Valid model/effort overrides remain available for isolated workers. These settings never enable parent-conversation inheritance, and the configured default role applies to an ordinary spawn when no role is named.

Custom roles are discovered from persistent personal/project Codex TOML configuration. The [role documentation](AGENT_ROLES.md) describes exact locations, supported fields and source precedence. Each admitted child saves a validated, credential-redacted role snapshot containing its source/version, instructions, model/effort and capabilities. Continuing an existing child does not reload changed configuration; newly spawned children see the edited definitions. Pre-role saved workers keep their admitted basic policy rather than silently adopting a newly configured `worker` role.

`features.shell_tool = false` disables shell/process tools while preserving allowed native file tools. `features.plugins = false` excludes plugin discovery, plugin skills and resources while retaining native project/personal skills. Both advertisement and actual dispatch enforce these restrictions, and descendants cannot re-enable a disabled ancestor capability. Role instruction bodies remain server-side; tree/status events expose bounded provenance, description, capability and definition-version metadata. Nickname candidates are allocated against existing agents and pending reservations, with unique fallback names.

Subagents do not inherit any parent conversation messages, final answers, images, summaries, private reasoning, tool calls/results, commentary, mailbox history, approvals or process sessions. `fork_context` is absent from the advertised spawn schema; a supplied `true` is rejected before any child is created. Legacy `false`/`null` inputs still produce isolated workers. The engine never populates a child from the parent model input or visible transcript. Nested delegation follows the same rule: give each descendant its own complete assignment.

A child's own later input, images, tool results and conversation history remain available when that child continues or resumes. The authenticated user can explicitly attach an image to a child follow-up through the trusted input adapter. User-created **conversation Fork** is a separate explicit root-thread feature and remains supported; it is never used as an implicit subagent startup path.

Every child receives freshly generated system instructions containing the prohibitions against proxies, filesystem mounting, proot, Docker, containers and sandbox machinery. Role and authorized-skill capability configuration remain inherited within current ancestor restrictions. The shared command dispatcher enforces the prohibited command categories for children exactly as for roots.

Control operations are limited to descendants. Agents may exchange ordinary messages with peers in the same root/workspace and send questions or findings to their parent. A child cannot interrupt or close its parent or a sibling. Threads from another root cannot be controlled or inspected through a collaboration tool. The authenticated user can inspect and control any child through its owning root conversation.

## Concurrency and manual edits

Only one unrelated root team owns a workspace at a time. That root and all its descendants may run concurrently. The shared review group coordinates file-tool transactions and review snapshots; it does not hold a lock during model calls or the lifetime of shell commands. File replacement requires the content version returned by `read_file`, and patches validate the current file/context under the shared mutation lease.

This protects against stale writes by another agent or the user. Manual editor/Git changes and terminal activity participate in the existing review-exclusion events, so Undo cannot silently claim or reverse concurrent manual work. Shell commands execute on the actual shared host and can affect arbitrary files within their allowed authority; this implementation does not pretend to provide OS process isolation. Workers must use clear file ownership and versioned file tools for coordinated edits. Completed subprocesses and background sessions are cleaned up before a child becomes terminal.

Default limits are eight active delegated jobs, depth three, 128 retained children per root and 4096 retained child records. Internal constructor options are bounded to 64 active jobs and depth eight. These are server implementation limits with explicit errors, not exposed CLI flags. Completed children release active execution capacity while their history remains saved. Resuming a closed child alone consumes no model work or active slot. Wait defaults to 30 seconds, clamps positive requests to 10 seconds–one hour, and is canceled promptly by the caller’s abort signal.

## Durable state and restart recovery

Normal state is ordinary, unencrypted JSON under the configured state directory in the native `/data` bucket mount:

- `agent-index.json`: managed child IDs and their durable root/parent/workspace relationships.
- `agent-<threadId>.json`: one agent’s metadata, lifecycle and unacknowledged parent notifications.
- `thread-<threadId>.json`: the same complete thread format used by root conversations, including saved model history and inbox.

No mount command is used. Large results are bounded in the registry; the normal child thread retains its full visible history. Metadata is written per agent on meaningful lifecycle changes rather than on each streamed token. Server credentials are redacted before task text, results, errors, events or metadata are persisted or returned.

Startup validates persisted identity, ancestry and role-snapshot policy consistency before exposing a tree. Runs saved as starting/running/compacting/waiting/awaiting approval/input become interrupted. Their completed work and history remain available, and parents receive a durable interruption notice. Recovery never repeats an unconfirmed command or silently starts paid model work. The user or parent sends follow-up input after inspecting current files. Explicitly closed records remain closed. Deleting a conversation removes its child subtree metadata and the engine removes the corresponding saved threads; siblings remain intact.

Closing temporarily freezes the subtree; deletion records an in-process tombstone before cancellation starts. Spawn rechecks its reservation before committing metadata and before starting execution. A delayed child creation cannot resurrect a deleted root or a closed parent. Close rechecks descendants after owned execution drains so any admission already underway receives the same explicit closed-edge handling. A stale completion event from a replaced run cannot complete its newer run.

For root history operations, `closeAllChildren` retires descendant edges while preserving their conversations, files and review changes. It increments a lineage generation captured before role discovery, so an old in-flight discovery or child creation cannot start after retirement returns. `clearFamilyNotifications` removes pending future-turn reports only for that family. The engine holds its lifecycle admission guard across these helpers and the history change; genuinely new delegation after the operation receives the new generation.

## Upstream source correspondence

The official source is downloaded at `/tmp/codex-cli-upstream` and preserved in the project’s `upstream/` source archive. The implementation was checked against these paths:

| Official Codex source | Behavior carried into the TypeScript runtime |
| --- | --- |
| `codex-rs/core/src/tools/handlers/multi_agents/spawn.rs` | Effective parent config, role selection, depth checks, child identity and immediate spawn acknowledgment. |
| `codex-rs/core/src/tools/handlers/multi_agents/send_input.rs` | Queued steering; interrupt before replacement submission. |
| `codex-rs/core/src/tools/handlers/multi_agents/wait.rs` and `agent/status.rs` | Terminal wait-any; non-destructive timeout; an interrupted run is not a completed task. |
| `codex-rs/core/src/tools/handlers/multi_agents/close_agent.rs`, `resume_agent.rs`, `agent/control/legacy.rs` | Previous status on close; subtree shutdown; same-ID reopen without automatically running a turn. |
| `codex-rs/core/src/agent/control/spawn.rs` | Durable ancestry, explicit closed edges and reload constraints. Its optional parent-context fork is deliberately excluded by the product's isolated-subagent requirement. |
| `codex-rs/core/src/agent/child_config.rs` | Apply inherited/current permission limits after role configuration. |
| `codex-rs/agent-roles/src/agent_role_config.rs`, `loader.rs`, `discovery.rs` and `core/src/agent/role.rs` | Native role configuration, scoped discovery, typed projections and locked settings, implemented by `roles.ts`. |
| `codex-rs/core/src/agent/control/completion.rs` | Durable reports addressed only to the direct parent, without starting an idle parent turn. |
| `codex-rs/core/src/tasks/mod.rs` | Cancel the real task, finish cleanup and flush state before terminal reporting. |

The [official Codex multi-agent documentation](https://developers.openai.com/codex/multi-agent) describes parallel delegated work and result collection. Source semantics are used for lifecycle details such as closed edges and wait results. The explicit product requirement for isolated subagent briefs takes precedence over upstream's optional context-fork feature.

Hosting adaptations are explicit: this app shares the existing host rather than constructing per-agent sandboxes; defaults bound active model work; the root is required to collect its delegated work; and completed children release execution capacity instead of occupying a loaded-session slot. MCP is intentionally absent by user request.

## Verification

`tests/agent-collaboration.test.ts` exercises coordinator admission, overlapping asynchronous host jobs and writes, real OS process cancellation, wait-any/timeouts, queued and interrupting input, capacity/depth/family boundaries, role and permission inheritance, redaction, durable direct-parent notifications, same-ID reopen, explicit closed descendants, subtree deletion and malformed-state rejection. Restart recovery is exercised by a separate Node process with adapter callbacks that fail if recovery attempts execution.

`tests/agent-collaboration-integration.test.ts` drives the actual shared `AgentEngine` with an explicit scripted provider boundary. Real file tools, host commands, process trees, persistence, group review and tool permissions execute unchanged. It covers overlapping child model/tool loops, root result collection, protected manual edits, steering, Ask/plan inheritance, strict context isolation and root/subprocess cancellation. Private parent sentinels, tool output, reasoning and images are proven absent from successful child requests; a requested context fork is rejected before any child is created. Nested workers still execute their own briefs, and explicitly assigned child image follow-ups still deliver actual pixels. The scripted provider is a test fixture; production has no mock-answer path. Hosted direct-provider validation is a separate deployment check, and its evidence must be recorded before claiming end-to-end hosted completion.

The current focused suite passes **57 tests** on 2026-09-19: 37 coordinator cases and 20 shared-engine integration cases. Global TypeScript checking also passes. The suite preserves lifecycle, cancellation, race and authority checks while enforcing isolated task briefs, immutable custom roles, ancestor/root-review restrictions, retirement generations, trusted attachment admission and scoped history retirement. Real-engine cases verify explicit user conversation Fork still works, subagents remain isolated, and child guidance cannot start an idle parent or authorize a goal. Role fixtures cover locked models, tool/plugin enforcement and resumed snapshots. Reproduce with:

```sh
npx vitest run tests/agent-collaboration.test.ts tests/agent-collaboration-integration.test.ts
```
