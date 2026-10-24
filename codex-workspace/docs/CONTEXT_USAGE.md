# Conversation context accounting

`GET /api/threads/:id/context-details` reports one selected conversation's own
completed-request usage, the subtotal for its native descendants, and their
combined processed-token counts. It does not expose app-wide counters or a last
response card/payload. The selected conversation's current context is separate
from those cumulative request counts. Each descendant keeps its own current
context, model capacity and compaction threshold; there is no combined context
window or family context percentage.

The public response contract is `ThreadContextDetails` in
`server/agent/context-usage-types.ts`. The existing per-thread `usage.total`
already counts only that thread's responses, including semantic compaction
responses. Goal ledgers separately charge native workers and therefore must not
be reused for context-detail aggregation. The small derived records replace a
thread's own snapshot; they never add a request again when a read, save or restart
is repeated.

The authenticated route accepts only `limit` (default 20, maximum 50) and an
opaque `cursor`. The server owns the selected scope. Each response contains one
bounded page of descendant rows plus totals for all validated native descendants,
up to the native collaboration limit of 512. It reads at most eight small records
concurrently and admits at most four simultaneous aggregation reads. Cursors are
signed and bind the thread, page limit, offset and exact native subtree membership;
changed membership returns `409 CONTEXT_PAGE_STALE`. Explicit conversation forks
are independent roots. Selecting a child includes only its own descendants, never
its siblings or the root's other branches.

`AgentCoordinator.lineageMetadata()` exports only compact committed native
identity metadata. It does not clone final answers, role instructions or agent
notifications. Aggregation verifies each relevant edge against canonical
per-thread summaries and deletion markers. A full conversation is stat'ed for its
identity but is never opened or parsed just to aggregate child usage. Metadata
reads are bounded, reject symlinks/hardlinks/non-files, and use a pinned state
directory descriptor to prevent an ancestor replacement redirecting the reads.
Derived writes, atomic replacement, deletion and cleanup use that same pinned
directory rather than reopening a mutable pathname.
An invalid descendant edge makes that row and descendants below it unavailable;
foreign titles and counts are not published. Invalid selected-thread ancestry
fails the request visibly.

Durable derived records use `thread-context-<thread-id>.json` in the existing
state directory. They contain only public usage/current-context fields, the
thread identity and canonical source fingerprint. They contain no messages,
model inputs, encrypted reasoning, credentials, global totals or per-response
ledger. Full conversation saves remain authoritative. A missing, corrupt,
oversized, externally stale or failed derived record produces honest
`incomplete`/`knownThreads`/`unavailable` metadata. Missing provider token fields
remain absent. Reported request counts cover observed completed responses; an
incomplete aggregate must not be described as an exact historical total.

Capture accepts an immutable bounded accounting snapshot and its exact verified
full-record source receipt. It rejects revision rollback and cannot attach a
stale cached thread's counters to a new file merely because timestamps match.
Missing receipts leave usage unknown. The engine prepares metadata synchronously
with its immutable full-record writes and uses the receipt returned from that
exact queued operation. The new store receipt path verifies the installed bytes
with a constant-memory 64 KiB SHA-256 read; it preserves the ordinary write API's
failure instrumentation and writer-close-before-rename ordering. Already verified
reads during bounded `ThreadIndex` recovery rebuild sidecars after a file identity
change, including a restart/remount, without an additional history scan. The
public thread projection and usage events strip the legacy private `usage.last`
field, and new replies do not create that legacy field. Conversation deletion removes each deleted thread's derived record; the
existing permanent thread tombstone prevents a late capture from reviving it.
The reviewed development reset must include this managed record prefix alongside
its associated thread records. Normal restarts retain it.

Conditional history cutovers additionally retain the actual displaced source in
an owned `.state-cas-<key>-<id>` recovery bundle. A complete private inode is
published with Linux `renameat2(RENAME_NOREPLACE)` through the asynchronous Node
binding. There is no copying into a publicly named empty file and no overwriting
rename fallback. This preserves both a last-moment source writer and any new
destination claimant. Unsupported atomic publication fails closed. Original-only
crash recovery is narrowly callable with exact signed pending-rewind authority,
matching source/candidate receipts, thread/workspace ownership, tombstones and
current-generation checks; ordinary store reads never replay a cutover.

`mutateGuarded(key, operation)` composes pinned lifecycle cleanup with the same
per-key store queue and invalidates cached reads before and after the operation.
Exact workspace/thread deletion must also retire owned conditional bundles and
their cleanup quarantines before canonical ownership proofs disappear. The
recovery metadata is not a new global usage ledger.

Focused checks are in `tests/agent-context-usage.test.ts` and
`tests/agent-context-usage-api.test.ts`. They cover actual filesystem metadata,
fresh store/service instances, authenticated HTTP, real native child/grandchild
engine execution with an explicit test transport, independent forks, paging,
duplicate identities, missing counts, source changes, unsafe records and deletion.
Their runtime results belong in the coordinator's validation record; source
presence alone is not proof that these checks have passed.
