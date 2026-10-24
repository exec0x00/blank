# Public download bucket

The dedicated bucket is [`alvin3y12/codex-downloads`](https://huggingface.co/buckets/alvin3y12/codex-downloads). It was created public on September 19, 2026 and verified through unauthenticated Hub requests. It is separate from `alvin3y12/data`. The download service must never delete objects from the data bucket or attach the download bucket as a filesystem volume.

The user clarified that this flow applies only when clicking **Download** in the application to save a workspace file to the user's device. Incoming downloads made by terminals, package managers, Git, the model runtime, or deployment scripts are outside this flow.

The user explicitly requested public, ordinary unencrypted files. Exported files in this bucket can be read directly without the workspace password. The application gates creation of an export with the existing workspace session, then supplies a public Hugging Face download link. No application encryption, additional proxy, or mount is involved. The platform's underlying storage implementation is managed by Hugging Face.

## Server configuration

| Setting | Kind | Purpose |
| --- | --- | --- |
| `HF_DOWNLOAD_BUCKET` | Space variable | `alvin3y12/codex-downloads`; must differ from the persistent data bucket |
| `HF_DOWNLOAD_TOKEN` | Space secret | Write permission for the download bucket; never sent to browsers, model prompts, terminal subprocesses, logs, or source |

Prefer a Hugging Face fine-grained token limited to the download bucket. The supplied deployment token is already fine-grained but grants broader access within the owner's namespace. The owner authorized using it for the bucket service if necessary. It must remain a Space secret and its use must be limited in code to the explicit bucket operations. Do not place it in the public `/data` tree. The official Hub OpenAPI has no documented personal-token creation endpoint; no unsupported token-creation operation was attempted. A separately restricted token can be created through the owner's [Access Tokens settings](https://huggingface.co/settings/tokens).

This document records the infrastructure and supported API contract. The runtime service, its startup hook, and these Space settings must be verified separately before claiming the application download flow is deployed. Merely creating the bucket does not enable that flow.

## Native TypeScript SDK

`@huggingface/hub@2.17.3` supports buckets through its generic repository APIs. Its `RepoDesignation` accepts `{ type: 'bucket', name: 'alvin3y12/codex-downloads' }` or the string `buckets/alvin3y12/codex-downloads`. There is no need for an additional Python runtime or S3 gateway. The SDK performs the supported Xet upload protocol directly and uses the Hub bucket batch endpoint to publish objects. [Official upload implementation](https://github.com/huggingface/huggingface.js/blob/main/packages/hub/src/lib/commit.ts), [SDK type definitions](https://github.com/huggingface/huggingface.js/blob/main/packages/hub/src/types/public.ts).

```ts
import { openAsBlob } from 'node:fs';
import { uploadFiles, listFiles, deleteFiles } from '@huggingface/hub';

const repo = { type: 'bucket' as const, name: 'alvin3y12/codex-downloads' };

await uploadFiles({
  repo,
  accessToken: serverOnlyDownloadToken,
  files: [{ path: uniqueExportPath, content: await openAsBlob(stableLocalFile) }],
  abortSignal,
});

for await (const file of listFiles({ repo, recursive: true, expand: true })) {
  // Use the service's fixed 24-hour threshold and validate the timestamp.
  // file.uploadedAt is the server upload time; source mtime is irrelevant.
}

await deleteFiles({ repo, paths: confirmedExpiredPaths, accessToken: serverOnlyDownloadToken });
```

`openAsBlob` avoids eagerly reading an entire large file into JavaScript memory. It requires a stable local snapshot: modification during the SDK's read should produce an explicit failure and retry, never a successful link to mixed bytes. Preserve the original workspace file and stage only the selected content under a unique export key. `uploadFiles` resolves to `undefined` for buckets; that is its normal successful return value. It throws if a bucket operation fails. [Upload helper](https://github.com/huggingface/huggingface.js/blob/main/packages/hub/src/lib/upload-files.ts), [file listing](https://github.com/huggingface/huggingface.js/blob/main/packages/hub/src/lib/list-files.ts), [deletion helper](https://github.com/huggingface/huggingface.js/blob/main/packages/hub/src/lib/delete-files.ts).

For progress reporting, the SDK exports `commitIter`. It yields phase and file-progress events. A consumer must treat `fileProgress` events with `state: 'error'` as failures; unlike the convenience `uploadFiles` wrapper, the iterator does not automatically turn these into a final thrown error. Combine the job cancellation signal and a bounded deadline in the custom fetch callback for every request, because not every internal Xet request receives the outer abort signal. The observed upload used `huggingface.co` for token refresh and object publication, and `cas-server-direct.xethub.hf.co` for chunk lookup and Xet data/shard upload. The SDK takes its CAS URL from the authenticated Hub response. [Upload iterator](https://github.com/huggingface/huggingface.js/blob/main/packages/hub/src/lib/commit.ts), [Xet upload code](https://github.com/huggingface/huggingface.js/blob/main/packages/hub/src/utils/uploadShards.ts).

The SDK also supports `copyFile`/`copyFiles` to a bucket without transferring file content when the source is Xet-backed. Copying from the native data bucket is suitable only after establishing that the remote source object matches the requested current local bytes. The native mount can upload asynchronously; equal names and modification times alone do not establish that an edited file is remotely current. Use a direct upload of a stable local snapshot when currentness is unproven. [Official server-side copy implementation](https://github.com/huggingface/huggingface.js/blob/main/packages/hub/src/lib/copy-files.ts).

## Direct links and filenames

The unauthenticated download URL is:

```text
https://huggingface.co/buckets/alvin3y12/codex-downloads/resolve/<encoded-object-path>?download=true
```

Encode each path segment. The Hub responds with a redirect to its own content delivery service; the final response is the file bytes with `Content-Disposition: attachment`. Return the stable public resolve link to the browser, without an authorization token or credentials in the query. It is not an application proxy URL. [Official Hub API specification](https://huggingface.co/.well-known/openapi.json).

Verification found a Hugging Face filename limitation: spaces and non-ASCII characters in the object basename were double encoded in `Content-Disposition`, while plain ASCII filenames were correct. For example, `download check-é.txt` produced a suggested filename containing percent escapes. The `download` query only accepts its boolean form; it cannot supply an alternate filename. A browser download implementation that must preserve an arbitrary original name can fetch the public bucket URL directly and save with that name, subject to browser support and file-size limits. Do not assume a cross-origin anchor's `download` attribute overrides the server's filename. Do not route the bytes back through the application merely to rename the download.

A real Chromium check from the Space origin fetched a public 70-byte fixture directly, followed the Hub's 302 redirect to `cas-bridge-direct.xethub.hf.co`, and received HTTP 200 with matching bytes. A local Blob download then preserved the exact original filename `unicode-name-café sample-你好.txt`. Browser CORS remained enabled. The verification environment resolves Hugging Face to private addresses, so only its local-network access check was disabled for that test; the production app does not change browser protections. This establishes the direct-fetch/Blob approach for small files, not the memory suitability of buffering large files. The exact fixture was deleted afterward and a fresh resolve request returned 404.

## Retention and startup order

The dedicated bucket's objects expire 24 hours after their server upload time. The Hub tree endpoint returns `uploadedAt`; Python exposes it as `BucketFile.uploaded_at`, and the TypeScript SDK exposes `uploadedAt`. Local `mtime` may be much older and must never decide expiry. The verification upload deliberately had a modification time seven days in the past and still received a fresh upload timestamp.

On process startup, complete a remote bucket listing and attempt deletion of every expired file before enabling exports. Follow every pagination link, consider files rather than directory placeholders, and check every deletion batch result. If remote cleanup fails, report the error and keep export creation unavailable until a retry succeeds. Existing workspace files and the data bucket are outside this cleanup scope. A scheduled cleanup during normal operation handles files aging past 24 hours while the Space stays running; another startup pass catches up after any stop or restart. A stopped Space cannot execute timers, so precise deletion while it is stopped is not guaranteed by an in-process scheduler.

Use a fixed configured bucket, unique immutable export paths, bounded request timeouts, and a single in-process cleanup operation. Do not allow a browser-supplied bucket ID or filesystem path to redirect deletion. A missing or invalid upload timestamp must produce a visible cleanup issue rather than treating an object as old. Do not remove metadata for a remote deletion that failed. Batch operations are nontransactional, so some paths can succeed before another fails. [Python bucket operations](https://huggingface.co/docs/huggingface_hub/guides/buckets), [official Hub OpenAPI](https://huggingface.co/.well-known/openapi.json).

For a direct REST implementation, listing is `GET /api/buckets/{namespace}/{bucket}/tree?recursive=true`, with `Link` pagination. The current API also supports `sort=uploadedAt&direction=asc` at the bucket root. Deletion is `POST /api/buckets/{namespace}/{bucket}/batch` with `Content-Type: application/x-ndjson` and one `{ "type": "deleteFile", "path": "..." }` object per line. Responses include `success`, `processed`, `succeeded`, and `failed`; inspect them and the HTTP status. All add/copy operations must precede delete operations in a mixed batch.

## Verification evidence and repeatable check

The setup check on September 19, 2026 verified public metadata, a 54-byte Python SDK upload, the difference between old `mtime` and fresh `uploadedAt`, and unauthenticated HEAD/GET with HTTP 200 after the Hub redirect. A separate Node check using `@huggingface/hub@2.17.3` uploaded a 56-byte fixture in 389 ms, performed a server-side copy, and downloaded byte-identical content anonymously. These tiny-file timings establish function, not large-file throughput or guaranteed end-user latency. Only temporary verification objects in the new bucket were used.

Run the read-only public-bucket check:

```sh
python3 scripts/check-download-bucket.py
```

For upload/copy/download/delete verification, install the same deployment SDK (`huggingface_hub==1.16.1`) and supply a token through `HF_DOWNLOAD_TOKEN` or an external mode-0600 credentials file:

```sh
python3 scripts/check-download-bucket.py --round-trip --credentials-file /absolute/private/credentials.json
```

The optional round trip creates two small, randomly named objects and removes only those exact objects in a `finally` block. It never accepts a different bucket or touches `alvin3y12/data`. The Python script is an external deployment check; application downloads use the native TypeScript SDK.
