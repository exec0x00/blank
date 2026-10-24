# Conversation and file rewind UI

Rewind defaults to **Conversation history only**. The optional **Conversation and workspace files** choice is enabled only when the server returns an actual saved checkpoint. Older turns, missing checkpoints and non-Git workspaces retain an explicit history-only path. A failed checkpoint lookup is shown as a failure, not treated as a historical snapshot of current files.

The file preview retains one page of 25 paths. It describes restoration, removal, staging behavior, conflicts and the checkpoint's actual scope. It never downloads complete repository contents or large source files into the confirmation dialog. Each later page uses the same opaque plan and version; stale plans require a new review.

## Editor protection

`client/workspace-rewind-guard.ts` coordinates the mounted editors for one workspace. Preview reads live dirty paths. Commit acquires a synchronous write lease and reads those paths again, refusing pending saves, uploads, transfers and other known editor mutations. More than 100 distinct dirty paths is a visible error rather than a truncated safety check. The server compares the submitted paths against the full plan, including paths outside the visible preview page.

The lease makes ordinary, split, diff and paged Monaco editors read-only, including their native input element, and rejects delayed model writes without discarding the existing buffer. Direct create, replace, move, copy, delete, restore and upload actions also consult the guard. Release refreshes saved files through the existing conflict-aware document reader; unrelated unsaved buffers remain intact.

An unresolved lease survives a lock or editor unmount. A remounted editor for that workspace joins the hold; another workspace is independent. Releases are scoped to their owning operation and editor generation. This browser guard supplements the server's repository and persistent recovery barriers; it does not replace them.

Ordinary external saves use the separate `acquireWorkspaceExternalMutation(workspaceId, paths)` API. It rejects dirty destination, ancestor or descendant buffers and existing editor writes, then briefly holds that workspace's editor writes. It does not collect unrelated dirty tabs or inherit the rewind's 100-dirty-path ceiling. Destinations are bounded to 100 valid relative paths of at most 4096 characters each. The returned `release({ refresh: true })` ends the ordinary hold when that request settles or is cancelled; it has no rewind plan or persistent recovery meaning. `isWorkspaceRewinding` remains specific to rewind, while `isWorkspaceWriteHeld` covers either kind.

An image save caller must also require an unlocked active workspace and a positively unblocked workspace recovery controller before acquiring the lease. The server still performs its own queued recovery admission and create-only publication. A successful save receipt remains a successful save if a later widget cleanup fails; report the editor refresh problem separately instead of resubmitting the mutation.

## Completion and recovery

Only a validated, fully completed receipt updates the conversation and restores its prompt and attachments. A fingerprint captured at confirmation is compared with the current composer when the receipt arrives. A newer prompt, attachment or skill selection is preserved instead of being overwritten by the older operation.

An ambiguous response never causes an automatic resubmission. The UI reads the exact saved status and keeps the write lease while the outcome is unknown or recovery is required. A confirmed `not_started` response permits a new preview; a missing record alone does not. Exact workspace, conversation, turn, plan ID and plan version bind any later settlement to the held operation.

Workspace recovery discovery is independent of the selected conversation and works after a browser reload. Unknown or unresolved status prevents new agent execution, queued-turn resumption, goals that would run, reviews, compaction and change undo. Draft editing, cancellation of pending inputs, refresh and stopping remain available after the transient rewind request finishes.

The recovery dialog shows current file, staging and transcript evidence in bounded pages. **Keep current files / end recovery** requires an explicit review of the current state and submits that exact expiring review version. It preserves any partial rewind; it does not claim to complete or undo the original transaction. A lost acknowledgement is reconciled through a read-only status lookup. Settled replies release only their matching local lease and do not replace a newer composer draft.

**Inspect saved sources** remains available after completion or acknowledgement, including after reload. The reader distinguishes the retained original from the requested checkpoint; neither label claims what is currently on disk. It requests one 16 KiB text page at a time from the authenticated recovery-file endpoint, validates immutable source metadata across pages, and shows honest metadata-only or unavailable states for binary, missing, empty, symlink and oversized sources. The server's 16 MiB inspection limit is explicit. Reading never restores files, acknowledges recovery, or substitutes a current workspace path for a retained source.

Recovery may be inspected from another checkout in the same verified repository family. The requested workspace scopes the UI, while the optional `targetWorkspaceId` identifies the operation whose local lease may settle. Exact plan and recovery identities must also match. An acknowledgement viewed from checkout B must not release an unrelated operation in B when the actual recovery belongs to A.

## Verification status

The source includes focused validation and registry tests plus browser cases for real Monaco buffers, exact request bodies, conflicts, pagination, lost replies, lock and workspace races, old checkpoints, phone navigation and preservation of a newer draft. Tests use explicit fixture transport; backend Git and filesystem behavior has separate integration coverage.

These newly authored cases have not been executed by this UI agent. The coordinator owns the resource-controlled TypeScript, unit, real browser and backend verification gates. Do not infer a passing result from this document or from the existence of a test file.

- `tests/rewind-state.test.ts`
- `tests/workspace-rewind-guard.test.ts`
- `tests/workspace-rewind-recovery-state.test.ts`
- `tests/rewind-recovery-reader-state.test.ts`
- `tests/e2e/git-rewind.spec.ts`
- `tests/e2e/workspace-rewind-recovery.spec.ts`
- `tests/e2e/rewind-recovery-source.spec.ts`

The existing conversation-only rewind fixtures in `codex-controls.spec.ts` and `conversation-windowing.spec.ts` explicitly report unavailable old checkpoints. The queue fixture also covers execution being blocked while Cancel and Refresh remain usable.
