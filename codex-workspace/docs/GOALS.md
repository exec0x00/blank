# Durable conversation goals

The native TypeScript runtime supports an explicitly requested objective that persists across turns. A goal belongs to a root conversation. Delegated agents contribute work and actual provider usage to their parent's goal; they cannot create an independent continuation loop or expand their parent's permissions.

A normal message does not create a goal. The goal form creates one only when the user submits it. The optional token budget has no default: omitting it creates an unbudgeted goal. The engine may also authorize the source-compatible `create_goal` tool for an explicit goal request, such as its `/goal` shortcut. Tool arguments cannot grant that authorization. A tool budget must match the budget the user actually requested, including when an explicitly requested budget would otherwise be omitted.

This feature ports the behavior in the preserved upstream source:

- `codex-rs/ext/goal/src/api.rs`, `tool.rs`, `spec.rs`, `runtime.rs`, `accounting.rs`, and `extension.rs`;
- `codex-rs/ext/goal/templates/goals/continuation.md` and `budget_limit.md`;
- `codex-rs/state/src/runtime/goals.rs` and the protocol objective validation.

The web service deliberately requires explicit continuation after a server restart. It does not replay a saved tool call whose effects are uncertain. Automatic work is also limited to a batch of 12 consecutive continuations by default. Reaching that guard leaves the full objective active with a visible reason; an explicit Resume starts another batch without resetting usage or narrowing the objective. These are bounded web-runtime admission rules, not claims that the upstream Rust daemon uses the same restart or batch policy.

## Public API and state

The engine exposes these authenticated root-thread routes behind the app's existing same-origin mutation protection:

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /api/threads/:id/goal` | — | `{ "goal": ThreadGoal \| null }` |
| `PUT /api/threads/:id/goal` | `objective?`, `status?`, `tokenBudget?`, `expectedRevision?` | `{ "goal": ThreadGoal }` |
| `DELETE /api/threads/:id/goal` | `expectedRevision?` | `{ "goal": null }` |

The service additionally returns an internal `cleared` Boolean from `clear`. A goal snapshot is included on a thread and in the `goal` SSE event. The storage service publishes `goal:changed` with `{ threadId, goal, action }`; the engine projects that event into its normal authenticated thread event stream.

`ThreadGoal` contains `id`, `threadId`, `objective`, `status`, `tokenBudget`, `tokensUsed`, `timeUsedSeconds`, `createdAt`, `updatedAt`, `revision`, `continuationCount`, and `continuationLimit`. Optional fields are `continuationBlockedReason` and `usageIncomplete`. The HTTP timestamps use ISO strings, consistent with the workspace API; the upstream app-server's timestamps are epoch seconds.

Statuses use the upstream app-server spelling: `active`, `paused`, `blocked`, `usageLimited`, `budgetLimited`, and `complete`. The objective is trimmed and limited to 4,000 Unicode code points. Budgets are positive safe JavaScript integers. No budget is `null`.

An external objective edit preserves the same goal identity, creation time and accumulated usage, even for a completed goal. Omitted budget preserves the current value; explicit `null` removes it. Raising or removing a budget alone does not reactivate a stopped goal. Explicitly setting `active` resumes without resetting usage. If usage already reaches the retained budget, the status remains `budgetLimited`. That status takes precedence over a simultaneous pause/block request. A completed goal may be replaced through an explicitly authorized `create_goal`; all unfinished statuses reject tool replacement. The UI can explicitly clear a saved goal before creating a separate one.

`expectedRevision: 0` requires that no goal currently exists. A positive revision must match the current goal. Conflicts return `409 GOAL_CONFLICT`. This prevents a delayed create/edit/clear from silently replacing another client's current goal. Clear is idempotent when the goal is already absent.

## Usage and completion

Each successfully reported Responses request contributes:

```
input_tokens - input_tokens_details.cached_tokens + output_tokens
```

The legacy top-level `cached_input_tokens` is also accepted. Cached input defaults to zero when that optional breakdown is omitted. Reasoning output is already included in output tokens and is not added twice. The service does not use a context estimate or `total_tokens` as a substitute for the required input/output counts. Invalid/missing usage is shown as incomplete; reported totals are then a lower bound. A budgeted goal with incomplete usage does not begin another automatic continuation.

The engine captures the root goal ID before requesting each model response and submits a stable response ID with the owning root run ID. Descendant responses also include their own source run ID. A serialized durable ledger deduplicates each response, rejects contradictory duplicate accounting, and allows a previously missing usage report to be filled once. A goal created while an older response is in flight does not retroactively acquire that response's usage. Old goal/run identities cannot charge a cleared or replaced goal.

Plan-mode responses do not charge an existing goal’s tokens or active time, and a Plan-mode provider failure does not block that independent goal. Automatic continuation is admitted only in Agent mode.

Elapsed time uses a monotonic in-process clock. Fractional seconds survive checkpoints; only active elapsed time is reported. The service does not infer downtime from a creation timestamp or charge time spent waiting for a user to resume.

Budget exhaustion is a soft wrap-up boundary: it can be crossed by the final provider response. In-flight wrap-up usage still counts, but no new automatic turn is admitted. The engine refreshes goal instructions at every model request and checks goal status at tool boundaries. A completion or explicit pause flushes elapsed accounting and stops further goal charging. Completing a budgeted goal returns the actual final usage and an instruction to report it, including any incomplete-usage qualification.

The service never equates a passing test count, an exhausted budget, a natural model final answer, or a continuation limit with completion. The `update_goal` tool instructs the model to derive every concrete requirement, inspect current authoritative evidence, and mark `complete` only when the whole objective is achieved and no work remains. A generic runtime cannot mechanically prove an arbitrary natural-language objective; this requirement remains an explicit model audit, as in the source.

## Blockers and errors

The source's repeated-blocker audit remains distinct from runtime errors. A model must verify that the same genuine external blocking condition prevented meaningful progress for at least three consecutive goal turns. The service persists the number of admitted goal turns and rejects a model's `blocked` update before three such turns. It does not pretend that arbitrary text proves the identity or reality of a blocker. The model still has to perform the source's condition/progress audit. Explicitly resuming a blocked goal starts a fresh audit.

Separate runtime guards stop three empty automatic turns with no activity, or three actual exec-handler failure turns with no successful tool. A nonzero shell exit is not by itself an exec-handler failure. Activity/success breaks the relevant sequence. A terminal provider failure stops immediately with `blocked`; actual usage-limit failure produces `usageLimited`. Automatic continuation does not retry a failed provider indefinitely.

## Engine integration contract

`ThreadGoalService` owns goal records and guarded continuation tickets. `AgentEngine` continues to own actual provider requests, tools, permissions, admission, queues, cancellation and process cleanup. There are no simulated model responses or detached goal worker processes.

1. Initialize the service during engine recovery. Add `tools()` only to root conversations and append `instructions(threadId)` freshly for every model request. Root goal context may be relayed to descendants as bounded task data; descendant tools cannot manage it.
2. Call `beginRun(threadId, { runId, source: 'user', policy })` for an admitted root turn. It remembers the current run even when no goal exists, so an explicitly authorized model `create_goal` can attach midway through a turn. Ordinary conversations do not create goal files.
3. Capture the current goal ID and exact objective before every request. `execute(update_goal)` requires both sampled `goalId` and `goalObjective`: a response generated before goal creation or before an objective edit cannot complete the new objective. After a successful `create_goal` earlier in the same response, explicitly bind subsequent tool context to its actual result. Never interpret an absent goal identity as a wildcard. Capture usage independently from that same request snapshot. After each provider response, await `recordUsage(rootThreadId, { runId: rootRunId, goalId, sourceRunId, responseId, usage })` before executing its tools. An absent `goalId` deliberately records no goal usage.
4. After owned commands/children, saved conversation state and workspace cleanup have completed, call `finishRun`. Only a natural completed Agent turn can return a continuation ticket. Queued user input, stopped/error status, Plan mode, missing budget accounting and the batch guard prevent a ticket.
5. Schedule at most one bounded engine callback for that ticket. Under the engine's normal admission lock, check shutdown, thread existence, archived state, queued input, live questions/approvals, active runs, active child work and workspace ownership first. Call `claimContinuation(ticket)`, then `beginRun` with `source: 'goal'`, the ticket's `continuationId` and exactly its captured policy. The latter requires a claimed ticket and rechecks it again so a pause/clear between claim and start wins. An idempotent run retry must retain the exact source, policy and continuation identity. A changed policy cannot use the ticket to broaden permissions.
6. User input/edit/stop must invalidate any scheduled ticket before admitting work. An explicit Pause/Stop persists `paused` before aborting the root and its children. Upstream turn abort by itself does not pause the goal; the web engine must pair these operations. An objective edit during work is delivered as visible user steering at the next safe boundary. An active idle edit must likewise admit that steering or expose a suspended continuation reason, rather than leaving an invisible orphan timer.
7. Goal clear removes future continuation/accounting. The engine decides current-turn behavior explicitly; its ordinary Clear flow does not claim to undo already executed work. Pause/Stop is the operation that aborts active work. Shutdown prevents admission, stops engine work and flushes goal state. Startup never replays a pending ticket.

Continuation preserves the exact model, raw reasoning effort, mode, permissions and selected skills from the preceding admitted run. It cannot turn Plan into Agent, change Ask into Full access, use another model, create an independent child lifecycle, or bypass the fixed endpoint and host restrictions.

## Persistence and tests

Ordinary, unencrypted JSON lives under `ctx.config.stateDir` through `ctx.store`: `thread-goal-index.json` and `thread-goal-<threadId>.json`. The public bucket is unchanged. Records contain no new credentials. Per-thread operations and `JsonStore.update` serialize snapshot/write/accounting; events publish only after a successful durable commit. State retains a bounded 64-entry transition history, one active root run, one continuation ticket, and a bounded deduplication ledger. There are at most 4,096 indexed goal records by default. Failed creation rolls back an unused reservation, recovery prunes orphaned empty reservations, and Clear releases its index slot while retaining the revision/history tombstone. Malformed state fails visibly and never silently creates or resumes a replacement goal.

`tests/agent-goals.test.ts` exercises actual JSON persistence and fresh service instances: explicit creation/budgets, status/identity preservation, concurrent revision conflicts, genuine usage formulas and duplicate handling, descendant attribution, failed writes, queued-write cancellation, elapsed time, soft budget wrap-up, blocker/error guards, root/permission boundaries, continuation races, batch limits, cancellation and restart non-replay. Engine/browser tests separately verify the real route, stream and UI integration; these service tests do not claim to execute a real provider request.


## Runtime control bridge

`server/agent/goal-engine.ts` exports `GoalEngineController`. The bridge uses the existing engine's admission lock and real run callbacks; it owns no alternative model transport or process runtime. The engine calls the durable service's begin/usage/tool/finish hooks, then passes the natural-finish ticket to `controller.finish(ticket)`. The controller schedules one timer per root, waits 150 ms by default, and admits it only after rechecking the actual root, archived state, queued input, pending controls, child/family work, workspace ownership and Agent mode. At most 64 callbacks can be pending. Older ticket generations cannot replace a newer timer, and every scheduled busy/error/overflow invalidation is bound to the exact saved goal/ticket/revision. Delayed callbacks cannot suspend a newer human turn. A failed admission is visible and requires explicit action; no provider retry loop is introduced.

`inspect`, `resolvePolicy`, `startRoot` and `steerRoot` are called inside engine admission. They must use the engine's already-locked implementations, without reacquiring the same lock. `reserveMaintenance` installs an engine-wide root fence while serialized. Pause is saved durably first; `stopRoot` then aborts/drains the family **outside** admission, while that fence remains installed. The synchronous, idempotent release runs after cleanup, including error cleanup. Conditional goal-edit failures do not abort a different or unmodified run; unconditional global Stop still aborts/drains actual work if saving the pause fails, then reports that persistence failure. This prevents deadlock when an active tool or child cleanup itself needs admission. Global Stop leaves an already completed historical goal complete.

Create and explicit Resume require idle Agent admission. A retained Plan selection remains Plan unless the user explicitly supplies an Agent run selection. Explicit model, effort and permission choices cannot be silently substituted by the defaults resolver. Automatic continuation uses the ticket's exact earlier policy, including selected skills, even if current settings changed. Review/compaction helper turns cannot receive active-goal steering. An objective edit during a normal active turn is queued as visible user steering; an idle active edit starts one explicit revised turn. A metadata no-op preserves its existing continuation ticket. Clear cancels future continuation/accounting and does not silently abort the current ordinary turn.

The high-confidence intent parser only reads original authenticated human messages. Native `/goal pause`, `/goal resume`, `/goal clear`, and status/help controls are reserved and never authorize creation; `/goal create ...` explicitly starts an objective whose first word would otherwise be reserved. Supported forms include `/goal objective`, `/goal --token-budget N objective`, and `Create a durable goal: objective` (also `to`/`for` wording and an explicit `with a token budget of N` clause). It does not scan repository files, generated continuations, teammate notifications, quoted examples or ordinary tasks for implicit goals. `goalToolAuthorization` separately recognizes direct goal-pause requests. Parsing grants no new execution permission and never changes the fixed model service. Other phrasing can use the explicit goal form; the runtime does not invent a budget from unrelated numbers.

`tests/agent-goal-engine.test.ts` uses the actual JSON goal service and timers with an engine adapter fixture. It verifies selected policy, Plan/busy/root/archive gates, pause persistence and admission reentry, cleanup failure, historical completed goals, retained usage on Resume, active/idle edits, Clear semantics, ticket cancellation/claim races, no-op updates, bounded scheduling, failed admission and shutdown. Full engine/provider-boundary integration is verified separately.


`tests/agent-goals-integration.test.ts` mounts the real engine and goal HTTP routes with controlled Responses fixtures. Its nine passing cases include an actual workspace read, real child-engine requests with once-only parent accounting, automatic continuation, exact sampled goal/objective binding, pause followed by a fresh engine, budget-blocked writes, and the 12-turn batch guard with explicit Resume preserving usage. This verifies production orchestration while keeping provider responses deterministic; it is not evidence of a hosted/live-provider rollout.
