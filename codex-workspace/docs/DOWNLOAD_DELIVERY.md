# Workspace file downloads

Selecting **Download saved file** prepares that saved workspace file in the separate public `alvin3y12/codex-downloads` bucket. The authenticated app returns progress and a public Hugging Face resolve URL. The browser receives the file directly from Hugging Face; the Node server does not relay its download bytes. Opening a workspace, starting the agent, or downloading a dependency does not publish files through this service.

Files remain ordinary unencrypted bytes, as requested. The persistent `alvin3y12/data` bucket is never an upload or cleanup target of this feature. The download bucket is not mounted.

## Configuration and integration

- `HF_DOWNLOAD_BUCKET=alvin3y12/codex-downloads` is a server variable.
- `HF_DOWNLOAD_TOKEN` is a server secret with write access to that bucket. It is never written to the data mount, job records, generated URLs, browser responses, or error messages.
- `AppConfig.downloadBucket` and `AppConfig.downloadToken` are populated by the coordinator's `loadConfig` implementation.
- Call `await initializeDownloads(ctx)` before exposing the HTTP listener. Mount `createDownloadRouter(ctx)` at `/api` behind both existing session authentication and mutation-origin protection. Call `await shutdownDownloads(ctx)` during application shutdown.

These exports are in `server/downloads.ts`. Missing configuration exposes an unavailable download status; it never falls back to streaming the original file through the application. A production legacy download GET must not publish a new file: publication requires the authenticated, same-origin POST below.

The SDK is `@huggingface/hub@2.17.3`. It uploads the immutable snapshot with a disk-backed Node `openAsBlob` through `commitIter`, reports actual Xet progress, and uses `pathsInfo` to confirm the completed object. The publication request supplies the original MIME type through the Hub's documented `contentType` field. No Python uploader, additional proxy, container, or mount is used. See [DOWNLOAD_BUCKET.md](DOWNLOAD_BUCKET.md) for infrastructure evidence and official API links.

## API

All application endpoints require the existing workspace password session. POST and DELETE also use existing same-origin mutation protection.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/workspaces/:workspaceId/downloads` | Accepts `{ path, expectedVersion? }`; returns HTTP 202 and the queued `DownloadJob`, with a `Location` header pointing to its status. It does not wait for snapshot creation or upload. |
| `GET /api/downloads/:id` | Returns the current complete job. Expired jobs never return a URL. |
| `GET /api/downloads/:id/events` | Sends named `download` SSE events containing the complete job, including an immediate current snapshot and heartbeat comments. Reconnection is independent of lost deltas. |
| `DELETE /api/downloads/:id` | Cancels queued or active preparation and returns the complete job. A ready object is retained until its original expiry. |
| `GET /api/downloads/status` | Returns configuration/readiness, cleanup status, last successful scan, unknown timestamp count, and a safe error when unavailable. |

Types are defined in `server/downloads/types.ts` and re-exported by `shared/types.ts`. States are `queued`, `snapshotting`, `uploading`, `ready`, `failed`, `cancelled`, and `expired`. `bytesProcessed` is actual phase progress and resets when snapshotting transitions to uploading. `version` is the captured SHA-256. A ready job includes its original `uploadedAt`, `expiresAt`, `fileName`, `mimeType`, `size`, and public `url`.

The URL has this shape, with each object-path segment URL-encoded:

```text
https://huggingface.co/buckets/alvin3y12/codex-downloads/resolve/exports/<random-uuid>/<original-filename>?download=true
```

The workspace session protects creation of the export. The resulting URL deliberately works without a password or token because the owner requested a public bucket. No credentials appear in its query string.

Hugging Face's cross-origin attachment filename can contain double-encoded spaces or Unicode. The UI receives the exact original filename and should save a direct public fetch with that name, using a streamed File System Access save when available. Any Blob fallback must have an explicit small-file memory limit. A cross-origin anchor alone cannot guarantee that the browser overrides the server's suggested filename. The browser implementation and its CDN/CORS verification are owned by the download UI module.

## Capturing the selected bytes

The source first passes `WorkspaceService.resolvePath`. On the Linux Space, each canonical path component is opened through an existing `/proc/self/fd` directory descriptor with `O_NOFOLLOW`. This is an openat-style use of the host's existing process filesystem; nothing is mounted. The final source must be a regular file, and its descriptor's real path must remain inside the selected workspace. Directory and final-file symlink swaps are rejected before source bytes are read.

A fixed 256 KiB buffer copies and hashes a private temporary snapshot. The service then makes a second bounded SHA-256 pass over the bound source and compares inode, size, timestamps, and the still-bound filename. The second hash is required because the native bucket and some host filesystems can reuse timestamps for multiple same-size writes. A stale `expectedVersion`, changed source, or replaced inode fails preparation instead of exporting mixed or unintended bytes. The source file is never changed.

Completed temporary snapshots are read-only, and Node's `openAsBlob` checks their filesystem identity during reads. The application does not read a whole large file into a Buffer. The default maximum file size is 20 GiB, with one active preparation and at most 16 accepted queued/active preparations. Xet handles its own bounded chunk buffers. A job has a 30-minute deadline, and every SDK request is combined with that deadline and cancellation signal, including shard requests to which the SDK does not otherwise forward its abort signal.

Requests go directly to HTTPS Hugging Face/`hf.co` infrastructure. Pagination destinations are checked, automatic API redirects are refused, and the owner HF token may only be sent to `https://huggingface.co`. Upstream error bodies, tokens, signed URLs, and request headers are not returned in application errors.

Hash-identical downloads may reuse an existing unexpired object after checking its current remote upload time and Xet hash. Reuse preserves the original expiry; selecting Download again does not extend a published object's lifetime. The service never assumes that an asynchronously flushed native data-bucket object matches the local source based only on its name or modification time.

## Persistence, retention, and recovery

All authoritative job state is ordinary JSON in `ctx.store`, at `/data/codex-workspace/state/download-jobs-v1.json` with the deployed configuration. It includes the bucket object reference, local content hash, and remote identity, but no secret. At most 2,000 job records are retained; terminal history is discarded after seven days or to make room for new history. Active and unexpired ready jobs are not evicted to bypass the bound.

Snapshots and cleanup journals are private transient files below an application-created `/tmp/codex-download-*` directory. Completion/cancellation removes its snapshot. Startup also removes abandoned staging directories belonging to this workspace service only after confirming that their owning process is gone; it preserves live, foreign, unmanaged, and symlinked directories. A crash may leave an unadvertised remote object, but the remote scan finds and expires it independently of local job records.

Every object expires 24 hours after the Hub's authoritative `uploadedAt`, never source `mtime`. A startup pass scans every SDK pagination page before deleting any object, storing expired candidates in a bounded-memory local journal. It rechecks current upload times in batches before deletion, preserving objects refreshed during the scan. Deletion results are validated per batch; partial failures and unknown timestamps keep new publications unavailable and retry automatically. Missing or invalid timestamps are never a reason to delete a file.

Startup makes up to three cleanup attempts with bounded request deadlines before the coordinator may expose the listener. If cleanup remains unavailable, the rest of the authenticated workspace can start with download preparation explicitly disabled. An unreadable job state is preserved rather than overwritten and produces a visible unavailable status. Transient state-write failures disable downloads and retry cleanup after storage recovers.

While running, the service schedules the nearest known object expiry and a periodic catch-up scan every five minutes. Completing more jobs may shorten this deadline but cannot postpone it. Failed cleanup retries after 30 seconds. Queue execution pauses during failed cleanup, and an upload rechecks retention readiness immediately before publishing its object. A sleeping or stopped Space cannot run timers; its next startup scan catches overdue objects before new exports become available.

The dedicated bucket uses immutable random object paths. Hugging Face does not document conditional deletion, so an external writer replacing the same path between the final remote check and the delete request is outside the atomic guarantees of this API. Normal application uploads never overwrite paths. Changed remote upload times or Xet hashes invalidate an existing ready cache entry rather than relabeling different bytes as the original content.

After restart, formerly queued or active jobs become visible `DOWNLOAD_INTERRUPTED` failures. The service does not automatically export potentially changed source files. Verified ready jobs and their original expiry survive restart. User cancellation after a remote publication may leave an unadvertised object; it is removed by the same retention mechanism.

## Verification

```sh
npx vitest run tests/downloads.test.ts tests/downloads-bucket.test.ts tests/downloads-staging.test.ts
npm run check
```

The current 35 focused tests exercise real binary file bytes, original filenames and MIME metadata, content reuse, version conflicts, same-tick source mutation, parent and final symlink swaps, inode replacement, bounded reads of a 40 MiB file, cancellation, durable recovery, shutdown during a state write, authenticated HTTP/SSE, origin protection, expiry timers, periodic deadlines, startup gating, partial deletion, pagination, refreshed-object preservation, unknown timestamps, data-bucket rejection, SDK request restrictions, and abandoned snapshot cleanup.

The memory bucket and injectable HTTP boundary are deliberate offline test fixtures. They do not prove production HF credentials, CDN behavior, large-file throughput, UI save support, or deployed startup integration. Those require a live authenticated prepare/status/SSE round trip followed by an anonymous direct bucket download, and a deployment check of the configured environment and router/startup hooks.

## Hosted verification on September 19, 2026

Source/runtime `40d2770484149b3922b82aea3b54bb3e18b31577` was confirmed `RUNNING` with both download environment settings applied. The authenticated status reported a successful startup scan at `2026-09-19T12:13:22.834Z`. Verification created one uniquely named fixture workspace without changing the active workspace or global settings. The selected file was `preuve café 文 09262ff4.txt` with 588,076 UTF-8 bytes and 7,001 CRLF pairs.

| Check | Observed result |
| --- | --- |
| Authenticated preparation | HTTP 202 in 113 ms; the server job became ready 653 ms after creation |
| Anonymous direct download | HTTP 200; exact SHA-256 `8e07d5929538fafbc1021fb49dc78ed7e7b6bebd6d5fa2df4a421573ff880e1f` and all original Unicode/CRLF bytes |
| Download MIME | `text/plain; charset=utf-8` |
| Direct CDN | `https://cas-bridge-direct.xethub.hf.co`; no application relay, Cookie, or Authorization header in the download request |
| Anonymous range | HTTP 206, exact first 32 bytes, `Content-Range: bytes 0-31/588076` |
| CORS | The public response allows `https://alvin3y12-codex-workspace.hf.space` |
| Retention metadata | Uploaded `2026-09-19T12:14:24.469Z`; expiry `2026-09-20T12:14:24.469Z`, exactly 86,400,000 ms later |
| Source and user context | Saved file remained byte-identical; the active workspace remained unchanged |

These are one-file measurements, not a throughput or latency guarantee for other files. No elapsed 24-hour deletion was observed; expiry/startup behavior remains separately covered by the automated tests. The harmless public fixture is left for normal expiry at bucket object `exports/64cea67d-6379-4a28-a0a0-bc7154c9d905/preuve café 文 09262ff4.txt`. Sanitized machine-readable evidence is in the coordinator's `/tmp/codex-hosted-download-proof.json`; it contains no session cookie or credential. The data bucket and unrelated objects were not modified or cleaned.

The same live check found a hosted SSE defect in that release. A native HTTPS request advertising normal browser encodings received Brotli with no body bytes within eight seconds; gzip received only its header. A real Chromium `EventSource` also received no event within five seconds. Identity-only requests received the initial named event in 77–134 ms. The existing agent SSE route, with `Cache-Control: no-cache, no-transform`, returned its initial event in 80 ms under the same browser encoding negotiation without compression. The comparison is recorded in `/tmp/codex-hosted-sse-transport-proof.json`.

The download route now sets `Cache-Control: no-store, no-transform`, preserving privacy while preventing edge compression from buffering progress. No forced identity header or global compression change was added. The HTTP/SSE regression runs behind compression with a zero-byte threshold and advertises browser encodings; it verifies an uncompressed initial named event and the no-transform directive. The original hosted evidence intentionally records the failure in that release rather than counting its identity-only diagnostic as a browser pass. The following check verifies the deployed correction.

### Hotfix verification on the same fixture

The coordinator confirmed source/runtime `a785470ccb66be1e8c7992905be7663d1332d9b3` was stable `RUNNING`. At `2026-09-19T12:45:41Z`, verification reused the original workspace and download job; it did not create another workspace, change the selected workspace on the server, or restore any user preferences.

- Native HTTPS requests advertising `gzip, deflate, br`, gzip alone, or identity received the initial named `download` event in 59–75 ms. All returned `Cache-Control: no-store, no-transform` and no `Content-Encoding`.
- A real Chromium `EventSource` received the preserved ready job in 43 ms. This also passed in the first after-hotfix run with Chromium's normal network-security settings; its evidence is retained separately from the later UI harness adjustment.
- The real editor's **Editor options → Download saved file** action made one authenticated HTTP 202 preparation request. Its actual EventSource delivered `snapshotting` progress at 0, 262,144, and 588,076 bytes, followed by `ready`.
- The UI fetched the real public bucket URL without Cookie or Authorization, saved the exact original filename `preuve café 文 09262ff4.txt`, and produced 588,076 byte-identical bytes with the original SHA-256. The observed click-to-saved time was 887 ms for this fixture.
- New job `9dc7136c-095b-46a8-9ba6-d90467bd7ec3` reused the original immutable public object. Both its upload time and expiry remained unchanged: `2026-09-19T12:14:24.469Z` and `2026-09-20T12:14:24.469Z`.
- The source remained unchanged. The active workspace and canonical UI revision were unchanged during the successful run. The fixture's browser-only bootstrap selection and editor layout were explicitly isolated: one preference update was handled locally by the test browser, and no canonical preference or workspace-selection mutation reached the server. File reads, download preparation, SSE, and public file transfer remained real.

The initial UI attempt encountered Chromium `LocalNetworkAccessPermissionDenied` because this verification environment resolves Hugging Face into private address space. The successful public-file UI check used only the narrow test-browser flag `--disable-features=LocalNetworkAccessChecks`; ordinary CORS and CSP enforcement remained enabled. This was a local verification-environment adjustment, not an application or Space configuration change. The same-job SSE verification had already passed without that flag. The earlier timeout and its Chromium network diagnostic are preserved instead of being discarded.

The final after-proof is `/tmp/codex-hosted-download-after-proof.json`, with the original before-proof unchanged. Additional evidence is `/tmp/codex-hosted-download-after-proof-initial-ui-timeout.json`, `/tmp/codex-hosted-download-browser-network-proof.json`, and a real download-tray capture at `/tmp/codex-hosted-download-after-tray.png`. The file and its one public object remain available until their original expiry; no elapsed 24-hour cleanup claim is made.
