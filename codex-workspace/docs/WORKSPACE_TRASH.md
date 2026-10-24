# Workspace deletion and retention

Workspace deletion uses ordinary files and JSON on the native persistent volume. It never calls GitHub’s repository-deletion API, changes an account credential, mounts storage, or launches container machinery.

`GET /api/workspaces/:id/deletion` supplies the authoritative confirmation mode. An ordinary workspace moves its real directory into `workspaces/.workspace-trash/<journal-id>/content`, leaves active navigation, and remains restorable for 30 days. A verified GitHub checkout is permanently deleted locally. Its internal deletion journal is never offered as recoverable trash, and success is returned only after its owned file contents have been removed. Permanent deletion requires `expectedMode: 'permanent'`; a stale mode confirmation fails before mutation.

GitHub classification uses successful import provenance (`Workspace.source`) or a named GitHub remote in a validated native repository. Merely selecting a GitHub account does not change deletion policy. Classification does not make network requests or disclose remote credentials. Ambiguous includes, URL rewrites, invalid configuration, and unsafe repository paths fail visibly instead of guessing an irreversible mode.

The generic deletion action refuses managed Git worktrees and primary repositories that still own linked checkouts. Their existing native Archive/Remove controls retain clean-state, activity, lock, commit-history, and shared Git ownership checks. Ordinary workspace trash does not move or recursively erase shared worktree administration data.

## Durable state and ordering

Each operation has an independent bounded `workspace-trash-record-<id>.json` journal in state storage. There is no replaceable global trash index. The entry’s ownership file and POSIX metadata snapshot are written before the journal, and the exact workspace archive generation is published before any directory move. Files already missing cannot be fabricated from a metadata record.

The phases distinguish preparation, a retained complete tree, verified missing files, a restore in progress, permanent deletion in progress, and terminal outcomes. A failed move preserves both possible locations. Startup inspects the journal and actual directories; it completes a known move or keeps an honest recovery state. An original directory recreated by an old metadata snapshot does not count as recovered file contents and is never overwritten. If a source remains but its native identity changed before the move, the journal reports recovery rather than claiming that the files disappeared.

`readWorkspaceTrashMetadataExclusions(config)` runs before the native POSIX metadata restorer. It excludes the original paths of current archived generations and the paths of committed purge intents. Old acknowledgments cannot reopen a newer deletion. The root application also records which workspace trees held ordinary file bytes; a confirmed missing tree is not replaced with a misleading directory/link skeleton at startup.

Normal state, snapshots and workspace files remain unencrypted by explicit user choice. Account credentials stay in the existing protected credential store. Trash preserves the workspace identity and its latest retained name/account choice; restoration reconnects existing conversations and editor preferences. Permanent deletion removes owned workspace/file-trash contents, not global account connections, source code, other workspaces, or shared conversation/UI stores. Small internal tombstones remain to prevent resurrection and unsafe replay.

Owned file-rewind checkpoint blobs, transaction payloads and verified rewind backup copies now have an explicit permanent-cleanup boundary. Ordinary restorable workspace trash retains them. On permanent deletion or 30-day purge, the current deletion journal records `artifactCleanup: pending`, clears its owned workspace/file-trash payloads, invokes the configured ownership-aware cleanup leaves, then records `complete` before it can become `purged`. A failure remains a visible pending deletion. The caller preserves progress already written by the cleanup step, so a final metadata-checkpoint failure does not rerun a completed source cleanup.

The third `WorkspaceService` constructor argument accepts two internal hooks in addition to `checkpointFileMetadata`:

- `assertWorkspaceDeletionAllowed(workspaceId): Promise<void>` performs pure, startup-safe signed-state checks before a fresh archive/move and before current-generation permanent purge. It must not initialize workspaces/agents or acquire activity again.
- `cleanupWorkspaceArtifacts(request): Promise<void>` runs under the already-held removal gate, after owned trash payloads are gone. The frozen request contains `workspaceId`, `deletionId`, original `mode`, `deletedAt`, and `assertCurrent()`. Both mode values reach this hook only at permanent cleanup. Each independently owned cleanup stage rechecks `assertCurrent()`.

Root installs these hooks before `workspaces.initialize()`, since that initialization can replay incomplete purges before the agent service rebuilds in-memory recovery barriers. The signed `assertWorkspaceFileRewindDeletionAllowed({config}, workspaceId)` helper checks canonical operations even if their block marker is absent. The cleanup order is `cleanupWorkspaceFileRewinds(ctx, workspaceId)` followed by `cleanupWorkspaceGitCheckpoints(config, workspaceId)`, with exact-generation checks between stages. Rewind cleanup uses the actual shared `ctx.store` when pruning its signed global preview-retention table; it preserves other workspaces’ rows. Checkpoint cleanup is the internal leaf, not the standalone service method that would reacquire the same gate.

If a pending artifact stage is encountered without its configured cleanup callback, completion is refused. If its deletion generation was superseded, the old journal clears only its own UUID container and records `superseded`; it cannot adopt a newer workspace’s checkpoint or backup namespace. Already-terminal historical purges without this opt-in stage are not retroactively swept. Only signed/verified rewind backups bound to owned operations are in scope; unrelated historical conversations and global settings/accounts/model preferences are not cleanup targets.

## Restoration and collision protection

Restore reserves the original root with exclusive `mkdir`, then creates each file, link and subdirectory without overwriting an existing entry. The retained original copy is kept until the copied tree is complete, its exact generation is acknowledged, and final native metadata is captured. This also protects a competing empty directory, which ordinary Node directory rename cannot guarantee.

An interrupted partial copy stays out of active navigation. Its original trash copy and any partial destination are retained, with a recovery explanation. A fully copied restore can finish after restart. Cleanup of a redundant source copy is retried even when the restored journal is no longer in the public trash list. An old restore generation cannot change permissions or markers in a newer restored workspace.

Directory traversal and destructive cleanup use checked native directory descriptors, no-follow file opens, bounded metadata reads, and exact ownership checks. Symlinks are copied or unlinked as links. Purge does not follow links to outside files, truncate a replaced metadata hard link, remove unexpected entry siblings, or recursively delete an arbitrary original path. Direct external writers are not participants in the app’s activity protocol; uncertain replacement/ownership states are retained for inspection rather than guessed away.

## Missing workspaces and active work

Directory absence requires repeated `ENOENT` under a verified unchanged parent, corroborated by its listing. Permission errors, `EIO`, symlinks, non-directories and unavailable parents are never classified as deletion.

A genuinely missing workspace receives a durable metadata-only record and leaves active navigation. This publication does not move any surviving filesystem content, so a terminal whose cwd was already removed cannot indefinitely prevent a missing record from appearing. Existing terminal recovery remains separately authenticated; the record never authorizes a new terminal or new file access. Frontend recovery keeps unsaved buffers available and exposes controls for existing terminal sessions.

Actual moves, restores and purge admission use the shared workspace activity fence. Live agents, terminal descendants, Git operations, uploads, extensions and file writes block destructive admission. The GitHub importer holds the same lifetime lease from workspace registration through clone completion or safe rollback. Neither closing a browser panel nor disconnecting a socket is treated as proof that native work stopped.

## Thirty-day cleanup

Whole-workspace trash has immutable `expiresAt = deletedAt + 30 days`. Startup and an hourly scheduled sweep purge expired owned contents; the restore API rejects expiry immediately even if a busy lease delays cleanup. Permission, ownership or transient failures retain their journal and a bounded explanation for retry. Shutdown stops new cleanup admission and waits for in-flight work.

Previously deleted files remain independently under `workspaces/.trash/<workspace-id>`, retaining their original per-file deletion dates when an ordinary workspace moves to trash. They reconnect to the same workspace ID on restoration. Whole-workspace permanent purge stages and removes that prior file trash only when its exact archive generation is still current. An older journal can clean its own UUID container without claiming a newer generation’s files.

Per-file expiry writes `file-trash-expiry-<entry-id>.json` before deletion, removes content before metadata, and supplies its own startup metadata exclusions. Interrupted cleanup therefore remains retryable even if the entry’s metadata file was already removed. Healthy sibling files remain listable and restorable; `GET /api/workspaces/:id/trash-status` reports a separate cleanup warning. Expired per-file restores return `410 FILE_TRASH_EXPIRED`.

`GET /api/workspaces/:id/trash/page` reads a bounded native cursor stream instead of building a complete per-file trash index. It accepts `limit` (default 25, maximum 50), an opaque `cursor`, and an optional readable `q` of at most 160 characters. Its page contains `items`, signed `previousCursor`/`nextCursor`, `hasMore`, `scanned`, `unavailable`, and `order: 'filesystem'`. It does not claim a global newest-first order or a total count. Sparse pages can contain no items while `hasMore` remains true. The counters describe only that page, including on replay; they are not cumulative history totals.

Each page examines at most 100 native names, reads no more than that many 32 KiB metadata records, and returns at most 256 KiB of metadata. Each workspace service owns at most eight cursor sessions, eight recent replay pages per session and four MiB of replay data. Idle cursors expire after two minutes. Mutation, expiry, eviction and restart are visible through `FILE_TRASH_CURSOR_STALE`, `FILE_TRASH_CURSOR_EXPIRED` or `INVALID_FILE_TRASH_CURSOR`; the client retains its current rows and offers First page. `closeFileTrashPages()` rejects new page admission, waits for admitted reads and closes all owned directory iterators and pins.

Restoration uses an exact UUID lookup independent of any page or legacy listing limit. Both the review-path capture route and the actual restore reread that entry, with no directory enumeration, bounded no-follow metadata reads and an observed-metadata conflict check. A file beyond the old 5,000-name boundary therefore remains accessible. The legacy array endpoint returns a complete bounded small list or `413 FILE_TRASH_PAGE_REQUIRED`; it no longer returns a silently truncated history.

Failed permanent GitHub deletions appear through `GET /api/workspace-deletions` as non-restorable pending/error statuses. `POST /api/workspace-deletions/:id/retry {}` retries that exact journal. It cannot start a fresh deletion of a later workspace generation. Successful permanent cleanup removes the status.

Operations bound registry history to 10,000 workspace-trash records and 10,000 per-file expiry records; a cleanup cannot create history beyond its reader’s bound. A tree walk is limited to 100,000 entries, 16 GiB of file data, 64 path components and 120 seconds. Metadata snapshots are at most 32 MiB and individual journals at most 32 KiB. Exceeding a bound retains data and reports an actionable failure.

## Verification

`tests/workspace-trash.test.ts` and `tests/workspace-trash-retention.test.ts` use actual temporary files, native Git repositories, links, permissions and fault-injected filesystem boundaries. They cover persistence, account isolation, dirty native activity, missing-root honesty, no-clobber restore, move/copy/purge crash recovery, irreversible GitHub confirmation, generation replay protection, startup/scheduled retention, and independent per-file deadlines. `tests/workspace-trash-limits.test.ts` exercises competing real filesystem operations at a controlled history limit, proving that admitted history stays readable after restart. Runtime results are recorded by the release coordinator; no hosted data or user credentials are used by these fixtures.

`tests/file-trash-pages.test.ts` adds real filesystem/HTTP coverage for complete cursor traversal past 5,000 names, bounded sparse pages, exact restoration and review capture, cursor binding/staleness/expiry, byte-budget eviction, context isolation, and native handle drain on shutdown.

`tests/workspace-artifact-cleanup.test.ts` uses real signed checkpoint owners and compressed Git source blobs to exercise ordinary retention/restore, GitHub permanent deletion, startup expiry and signed recovery blocking, durable pending/retry state, missing-hook refusal, final metadata retry, generation isolation and preservation of unrelated state.

## Existing attachment cleanup audit

This integration does not sweep historical attachment stores by filename prefix. The source audit identified these separate ownership integrations for the coordinator:

- `GeneratedImageService.deleteWorkspace(workspaceId)` already persists a permanent fence, aborts that workspace’s pending commits, and removes verified owned image files. At audit time it had no caller in workspace deletion. It must be wired only at permanent cleanup, never during restorable trash/archive.
- `ConversationFileStorage` expires only drafts without `retainedAt`; retained saved-message file bytes deliberately survive ordinary expiry. It currently has no workspace-wide cleanup API. A safe integration needs its own ownership checks, transfer/capability cancellation and durable retry behavior before this lifecycle can call it.
- `ImageAttachmentService` likewise expires unretained drafts and rejects per-item discard of retained message images. It has no workspace-wide cleanup hook at audit time.
- Managed worktree removal ends through the intentionally metadata-only `WorkspaceService.remove()`, shared with nondestructive worktree Archive. It does not dispatch the ordinary workspace-trash artifact hook. Any managed-checkout artifact cleanup requires a separate, guarded post-native-remove integration; adding deletion to `remove()` would erase sources during Archive.
