# Paged native files

This module reads a file only through short-lived, validated native descriptors.
Metadata does not read the file body. Default pages hold at most 128 KiB; a read
adds only bounded line/UTF-8 context. A long line is split at a character boundary
and marked partial. Random byte jumps do not invent a global line number.
Sequential signed cursors carry exact line positions, including CRLF and CR
terminators. Total lines remain unknown until a contiguous traversal reaches EOF.

The only cache is a small in-memory LRU of versioned position hints. It contains
no source bodies, giant line arrays, durable indexes, or open descriptors. Losing
the cache on restart changes performance/known positions, not file contents.
Signed cursors can survive restart when the session secret and native identity
remain unchanged. A remount that changes identity requires a fresh page.

Literal search reads at most 2 MiB per request, keeps only a bounded Unicode
overlap and 100 matches, and returns a continuation. It can stop sooner for time
or result limits. `complete` means EOF was reached; it never means an arbitrary
scan budget was exhausted. No regex syntax or unbounded background scan is
accepted from clients.

## Range editing

The page token binds the workspace, requested/canonical paths, native source
identity, exact byte range and original range SHA-256. These versions are **not**
the content digests used by the old whole-file API. A page must never be sent to
that API as an entire file, or its version used as a download content digest.

Sources and resulting files up to 64 MiB support range replacement; larger files
remain readable/searchable with an explicit read-only reason. Edited pages have
a 256 KiB byte limit. Binary bytes and invalid UTF-8 anywhere in a source prevent
a save. A successful reply contains exactly the submitted range with fresh
identity/token, not an expanded/re-aligned default page.

Saves take the existing workspace mutation queue and activity lease. The server
streams and validates the entire source into a create-only recovery file, copying
all bytes outside the range unchanged. Memory stays bounded and admission reserves
headroom for source/replacement filesystem cache, with the shared 90 GB policy and
2 GB minimum reserve. It then creates a separate complete install file, hashes the
source again and revalidates paths/identity before native replacement. It never
writes a partial editor model over the original source.

On persistent hosting, the recovery object and metadata journal must have public
hash receipts before replacement. The recovery object remains intact until the
destination itself has a public hash receipt. Open writers are synced and closed
before receipt checks, because native FUSE may publish on close. Failed/uncertain
saves retain a visible `.codex-recovery-<uuid>.recovery` file and ordinary metadata
under the configured durable data directory. Recovery copies are nonexecutable;
the installed file preserves the original ordinary permission bits.

Startup only observes retained records. It never replays a rename, overwrites a
source, or removes recovery bytes. Even normal cleanup checks descriptor identity
and the complete expected digest before removing an owned copy. A copy changed by
someone else remains available. Partial preparation is distinguished from a full
edited recovery copy.

App writers are serialized. An external command is detected through identity,
range hashing and full-source revalidation. Native Node rename does not offer a
kernel compare-and-swap operation; it cannot provide transactional isolation from
an uncooperative external process writing in the final check-to-rename interval.
The same host-level limitation applies to ordinary editor saves. Recovery and
conflict handling must not be described as a universal filesystem transaction.

The router is mounted only behind the app's authenticated/same-origin middleware.
Focused filesystem and HTTP tests cover real reads/writes, large sparse files,
Unicode boundaries, search continuation, queue interaction and interrupted saves.

## Shutdown

Call `const drained = shutdownFilePages(ctx)` as soon as application shutdown
starts. This call synchronously closes admission for that exact `AppContext`,
even if its router/factory has never been used. New reads, searches and saves fail
with `FILE_PAGES_CLOSING`. A different application context remains independent.
Then await `drained` before closing auth, file metadata or durable state services.
Closing HTTP connections does not drain or abandon the tracked file operations.

The shutdown signal cancels queued callbacks without running them later, aborts
public receipt requests/backoff, and is checked before native writes/replacement.
Once an operation has started, its promise remains tracked through its journal
update and descriptor closes. Cancellation retains full and partial recovery
files; it does not start deletion or replay. A rename already issued before the
signal cannot be undone by cancellation, so its full recovery remains available
and its confirmation state is reported honestly.

The default drain deadline is 15 seconds. If a native call or an injected callback
does not settle, `FILE_PAGES_SHUTDOWN_PENDING` rejects the wait. Admission remains
closed and the operation remains tracked. Calling shutdown again waits for that
remaining work; the caller must not treat a rejected wait as a successful drain.
The deadline timer stays referenced until settlement so a promise-only stall
cannot silently make the process exit successfully.
