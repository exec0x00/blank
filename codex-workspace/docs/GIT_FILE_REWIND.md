# Repository file rewind

Conversation rewind can optionally restore the reviewed repository changes made
by the excluded turns. It keeps the branch, HEAD, remote history and unrelated
files/staging in place. Ordinary conversation-only rewind remains available
when a turn has no usable file checkpoint.

The pinned CLI's `codex-rs/thread-store/src/local/revert_thread.rs` (preserved in
`upstream/codex-78245b47af2a.tar.gz`) preserves an immutable
original rollout and conditionally switches its history pointer. This app uses
that history principle. Repository file recovery is the user's requested
extension: the pinned `core/src/config/mod.rs` explicitly says its legacy
`ghost_snapshot` settings no longer produce snapshots. This implementation does
not claim that the current CLI still performs Git ghost undo.

## Capture and attribution

Before each admitted root turn, the native checkpoint service captures verified
working files and the real index in its separate durable Git object store. It
never modifies the checkout's refs or index during capture. A second snapshot
records the final state after owned tools drain. When descendants outlive the
root turn, final capture waits for their registered work to end. A child-admission
generation change during final capture makes the snapshot explicitly unavailable.

Signed repository/checkout generation markers bind the registered workspace
lifetime and Git ownership. They let historical checkpoints survive a new mount
or process observation without treating old device/inode numbers as durable
identity. Current descriptors remain pinned, and preview/commit observations
must match the same live scope; an old preview is stale after restart. New
repositories are not assigned the identity of old snapshots.

Rewind reverses actual before/after deltas for the selected turns. It does not
replace the whole working tree. A file that changed between agent turns, after
the final checkpoint, or during overlapping manual activity is a conflict. Files
that the selected turns never changed remain untouched, including later user
untracked files. Only affected index entries are restored; unrelated staged
content, merge stages and intent flags survive the selective index rebuild.

Terminals are actual host processes, and their initial cwd is not filesystem
isolation. Input in any workspace terminal taints every overlapping capture;
pre-existing terminal leases and overlapping root teams are treated conservatively.
These admission checks coordinate app operations. They are not an OS sandbox
against arbitrary external processes.

The checkpoint service documents its file/count/byte quotas and exclusions in
`server/git-checkpoints/README.md`. Git-ignored files and empty directories are
not silently described as covered. Missing old checkpoints, repository/HEAD
changes, unsupported index metadata such as resolve-undo, and quota failures
are visible reasons to choose conversation-only rewind.

## Preview and confirmation

`POST /api/threads/:id/rewind/preview` accepts `beforeTurnId`, optional
`dirtyPaths`, and `offset`/`limit`. Pages default to 25 rows and permit at most 50.
Subsequent pages send the same `planId` and `version`. A signed preview binds the
complete saved source, repository identity, file versions, staging, conflicts,
and target checkpoint. It expires after five minutes. The frontend receives
relative paths and metadata, never internal object-store selectors.

`POST /api/threads/:id/rewind` with only `beforeTurnId` keeps the existing
conversation-only behavior. File rewind additionally requires
`files: { planId, version }` and an explicit current `dirtyPaths` array (maximum
100). Dirty-path intersection is checked against the entire plan, including
paths outside the visible page. The editor holds its scoped write/buffer lease
through confirmation; server hashes and admissions remain authoritative.

The server takes the shared workspace file queues in sorted workspace order,
then the repository family's exclusive activity barriers in the same order.
It revalidates family membership under those barriers. Existing terminals,
agents, Git operations and file writes cause a conflict; none are killed.
All source versions are rechecked before applying the selected plan.

## Transaction and recovery

The original transcript, full per-turn model journals and actual file/index
bytes remain in durable recovery storage. Rewind stages and verifies replacements
before moving original paths. Original entries are parked and checked, and
destinations are created without replacement. A last-moment conflicting entry
is retained for recovery. No `git reset`, `git clean`, checkout-wide deletion,
branch update, push, or remote operation implements rewind.

The transaction persists intent and applied-step records. A failed history
cutover rolls back only files still matching this operation's writes. A later
file or transcript writer is preserved. Uncertain recovery holds durable
repository-family mutation barriers, including after restart. Startup restores
those barriers and excludes affected roots/admin directories from metadata
restoration; it does not replay file changes or acknowledgement.

If an interrupted conditional transcript publication left its canonical name
missing, startup may copy only a unique verified retained original into that
absent name. This requires the exact signed rewind/rollback intent, both raw
source/candidate receipts, current workspace generation, and deletion checks.
It never publishes the desired candidate or overwrites a current transcript.
The recovery barrier and all source copies remain; ambiguity stays unresolved.

On the native `/data` bucket, file bytes, deleted-object absence, recovery records,
the signed plan, and the exact transcript have public readback barriers. Unix
mode and symlink expectations are checked against a newly captured
`filesystem-metadata` record and that exact record's public receipt. Unconfirmed
metadata is not presented as durable. Historical staged objects are published
without replacement; a filesystem that cannot safely publish a missing object
causes a visible failure before working file/index changes.

`GET /api/threads/:id/rewind/status` accepts a known `planId`/`version` or returns
the latest attempt. Exact attempts are also available at
`GET /api/threads/:id/rewind/recovery/:recoveryId`. A pending operation never
claims completion while final receipt verification is still running. A lost
response is reconciled through these records; submitting the same completed
selection does not repeat filesystem changes.

`GET /api/workspaces/:workspaceId/rewind-recovery` discovers recovery across
reloads and other conversation selections. An optional `recoveryId` addresses
an exact retained operation. A fresh recovery review observes current file,
index and transcript versions; `version`/`offset`/`limit` page that immutable
60-second review. Related checkout discovery includes the actual target checkout
identity when it differs from the requested workspace.

`POST /api/workspaces/:workspaceId/rewind-recovery/keep-current` accepts the exact
reviewed `recoveryId`/`version`. It preserves the currently observed files,
staging and conversation and ends recovery after fresh revalidation and durable
acknowledgement. It never resumes an old restore or declares that a failed rewind
succeeded. The acknowledgement remains addressable for a lost-response retry;
a later changed state requires a new deliberate review. Original backups remain.

Original transcript pages are available through
`GET /api/threads/:id/rewind/recovery/:recoveryId/history`. They use the ordinary
public projection: private model input, encrypted reasoning, pending questions,
and undelivered/cancelled queue payloads are not returned. Verified original or
requested file content is inspected through
`GET /api/workspaces/:workspaceId/rewind-recovery/:recoveryId/file` with `path`,
`side=original|restored`, and bounded byte `offset`/`limit`. Text windows default
to 16 KiB and cap at 32 KiB; binary data returns metadata and an honest notice.
Symlink targets are inspected as text and are never followed.

## Retention and deletion

At most 16 live previews and 64 unused saved previews are admitted. Expired,
unattempted full plans are removed only after verifying no operation or native
transaction references them. A bounded signed table retains positive
`not_started` receipts for 24 hours (maximum 512); older unknown selections are
not reported as successful. Pending/completed recovery dependencies are never
pruned by that expiry task.

Ordinary workspace trash retains recovery artifacts. Confirmed permanent local
deletion and 30-day trash expiry first run the signed unresolved-recovery
preflight, then remove only verified workspace-owned rewind payloads, transcripts,
journals and checkpoint objects. Shared preferences/accounts and other workspaces
remain outside that cleanup. Family markers are removed only when they still
refer to that exact completed or acknowledged operation.

## Verification

Source includes dedicated native filesystem/Git transaction, bounded recovery
reader, signed cleanup, engine and authenticated HTTP regressions. The initial
implementation handoff does not claim they have run. The coordinator owns the
resource-controlled typecheck, test and native HF acceptance results; record
their final reports before release.
