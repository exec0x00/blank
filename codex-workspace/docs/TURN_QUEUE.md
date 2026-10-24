# Steering and future turns

The composer uses the user's requested keys: Enter inserts a newline, Ctrl+Enter sends or steers, and Shift+Enter while a turn is active queues a separate future turn. The browser does not schedule model requests itself. The authenticated server owns acceptance, cancellation, persistence and delivery.

The implementation studies the pinned CLI source at `78245b47af2a7aafcabe025828ceecca69db4df1`:

- `codex-rs/tui/src/chatwidget/input_queue.rs:24–43` separates queued user messages and pending steers.
- `codex-rs/core/src/session/turn.rs:414–438` drains steering at a safe model boundary, preserving the first sample of a fresh turn and the first continuation after automatic compaction.
- `codex-rs/ext/queue/src/service.rs:335–341` shares the cancellation and delivery lock.
- `codex-rs/ext/queue/src/service.rs:405–448` takes the first queued message, starts one idle turn and returns after admission.
- `codex-rs/ext/queue/src/service.rs:549–563` dispatches from the completed-turn lifecycle and excludes interruption.

User-requested differences are the keyboard shortcuts, persistent queues and accepted model settings, explicit recovery holds, and strict attachment isolation. No CLI binary or sandbox is invoked.

## Delivery and cancellation

`POST /threads/:id/input` steers an active conversation with its immutable accepted model and execution settings. It rejects model-option changes. Steering waits until current sampling and tool work finish; it does not abort a response in the middle. A message arriving after the serialized final-answer boundary becomes a future turn using the finishing run's settings.

`POST /threads/:id/queue` accepts the ordinary run input fields and resolves model context, declared request options, mode, permissions and skills before acknowledging acceptance. Each entry starts one later turn. Registry edits cannot change an accepted model snapshot. Delegated turns also pass through the coordinator's lifecycle, capacity, ancestry and current authority checks; later restrictions may tighten authority.

Pending messages exist only in private `SavedThread.turnQueue`. They do not enter transcript messages, model input, turn journals, memory-capture sources, fork history or attachment-tool authorization. Public queue rows whitelist a bounded prompt preview, attachment metadata, delivery kind, state, hold reason and model ID. They never contain wire image data, workflow expansion, private model content or child policy.

`DELETE /threads/:id/queue/:submissionId` and delivery share engine admission. Cancellation is acknowledged only after persistence. If delivery has already claimed the message, cancellation returns 409 and the client refreshes. The runtime retains up to 256 ID-only claim/cancellation receipts, with no cancelled prompt or attachments. An unknown or aged-out ID returns 404.

Claiming atomically promotes one user message into delivered history and its current turn journal. Persistence must succeed before a hook or provider receives it. If that pre-dispatch write fails, the runtime attempts to restore the original entry as held, removes the unsent history item, invalidates presentation cursors and stops execution. Failure to confirm storage is never reported as successful cancellation or delivery.

## Completion and recovery

The final-answer boundary and enqueue use the same admission fence. The next turn waits for tool cleanup, file checkpoints, journal/state saves, coordinator notification, `done`, and the run's completion promise. Pending explicit work blocks autonomous goal continuation.

Unclaimed messages are held after restart, stop, failure, history changes or uncertain storage. A goal that has used its bounded budget wrap-up also holds untouched input with `budget_limited`; it does not claim an unsampled steer or spend another request. `POST /threads/:id/queue/:submissionId/resume` explicitly turns a held entry into a future turn with its saved settings. Held entries are FIFO barriers; later resumes do not skip them.

Restart recovery never automatically repeats claimed or possibly billed work. The interrupted thread remains visible. Original attachment bytes stay durable, but waiting or cancelled references grant no model-tool access. Normal file reads, user-created forks and memories see only delivered user messages.

Compaction provider calls stay outside engine admission. Only checkpoint commit/rollback is serialized. It preserves queue mutations and unrelated title/goal changes; a new steer arriving during summarization invalidates the old context snapshot without losing the waiting message.

## Bounds and evidence

Both delivery classes share limits: 32 waiting messages, 256,000 expanded prompt characters / 1,024,000 UTF-8 bytes, 32 MiB image data, 128 file references / 256 MiB file data, and 48 MiB private wire content. Each prompt remains limited to 64,000 characters. Public prompt previews use the existing 1,024-character history limit.

Source tests are in `turn-queue-state.test.ts`, `agent-turn-queue.test.ts`, `agent-turn-queue-api.test.ts`, `agent-turn-queue-recovery.test.ts`, and `agent-queued-child-admission.test.ts`, with dedicated child-runtime integration coverage. They use actual engine, storage, authorization, HTTP and lifecycle behavior; only model responses are explicitly scripted. The restart fixture restores a captured durable stopped-server boundary and starts a fresh Node process. It does not simulate torn writes or real provider billing.

These tests were authored source-only. Passing runtime results must be recorded by the coordinator before this feature is described as verified.
