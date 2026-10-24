# User image attachments

`server/agent/attachments.ts` implements the local equivalent of upstream Codex
`UserInput::Image` and `UserInput::LocalImage`. The reference is
`upstream/codex-78245b47af2a.tar.gz`,
`codex-rs/protocol/src/user_input.rs`: an image is a Responses content part;
a selected local image is read and converted to that content at request time.
This web implementation first takes an immutable snapshot so a later workspace
edit cannot change the image in a saved user turn.

PNG, JPEG, WebP, and non-animated GIF are supported. The existing native
`inspectImageBytes` validator checks signatures, container structure, PNG CRCs,
frame count, dimensions, and byte limits. Validation does not execute an image
decoder, shell command, or uploaded code. It does not promise to decode every
pixel or transcode a malformed compressed raster; the browser/model still
reports a rendering failure if the compressed pixels cannot be decoded.

## Limits and lifetime

- Each image is at most 8 MiB, 16,384 pixels per side, and 40 million pixels.
- A user message has at most eight distinct images and 16 MiB of image bytes.
- A workspace can hold 32 unsubmitted images, totaling at most 128 MiB.
- At most four upload bodies are buffered concurrently by the router; the
  service separately limits concurrent upload/snapshot work to four.
- An unsubmitted image expires 24 hours after creation. Startup, a 15-minute
  sweep, and upload quota checks remove expired drafts. A cancelled upload is
  removed immediately when the server observes the cancellation. If the browser
  loses the response after creation, the draft expires normally.
- Once admitted to a saved user turn, its snapshot is retained. It survives
  restarts, compaction of provider history, and forks. Removing a composer chip
  cannot delete an image already used in a message. There is no automatic
  garbage collection of accepted images when a thread is deleted, because
  another saved fork can reference the same snapshot.

Assets and their bounded metadata are ordinary, **unencrypted files** below
`<stateDir>/image-attachments-v1/<sha256(workspaceId)>`. On the hosted Space this
is on the native `/data` mount and therefore in the explicitly public data
bucket. The app's preview routes require the workspace session; this does not
make files in that public bucket private.

Storage filenames are generated attachment IDs. Submitted names, workspace
paths, metadata properties, and URLs never become a filesystem destination.
Directory operations use opened descriptors on Linux, reject symlinked storage
directories, and verify the directory still has its expected identity. Reads
reject symlinks and non-regular files, use bounded buffers, verify file identity,
and check the exact SHA-256 of the returned bytes. Workspace selection reuses
the existing guarded image reader and compares two complete reads to detect
changes even on filesystems with coarse timestamps. It never modifies or deletes
the selected source file.

Cleanup processes only records with the attachment ownership marker in the
service's own directories. It only unlinks the exact generated image, upload,
and metadata filenames; it never recursively deletes a directory. Unknown,
malformed, symlinked, and unrelated records/files remain untouched. Atomic
metadata update remnants must also have the service marker and be at least
24 hours old before removal.

## REST contract

All routes are mounted below `/api`, after the app's signed session and
same-origin mutation middleware. Mutations require `X-Codex-Workspace: 1`.
There is no remote-image-URL input, unauthenticated app upload/preview endpoint,
provider file upload, or thumbnail worker.

| Method and route | Input | Response |
| --- | --- | --- |
| `POST /workspaces/:id/attachments/from-upload` | JSON `{uploadId, sha256, detail?}` after direct browser CAS staging reaches ready; exact workspace/hash and existing image bounds required. | `201 ImageAttachment`, with durable promotion retry identity |
| Legacy `POST /workspaces/:id/attachments?name=...&detail=high` | Compatibility-only raw image route. The browser picker does not use it. | `201 ImageAttachment` |
| `POST /workspaces/:id/attachments/from-workspace` | JSON `{path, expectedVersion?, detail?}`; version is the exact lowercase SHA-256 of the source bytes. | `201 ImageAttachment` |
| `GET /workspaces/:id/attachments/:attachmentId/content?sha256=...` | Required SHA-256 matching the selected snapshot. | Actual validated image bytes and detected MIME type. |
| `DELETE /workspaces/:id/attachments/:attachmentId` | No body. | `{deleted:true}` for an unsubmitted draft; `409 ATTACHMENT_IN_USE` for a retained image. |

`ImageAttachment` is metadata only:

```ts
interface AttachmentReference {
  id: string;          // att_<32 lowercase hexadecimal characters>
  sha256: string;      // exact SHA-256 of the original bytes
}

interface ImageAttachment extends AttachmentReference {
  workspaceId: string;
  name: string;        // readable basename, at most 255 characters
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  bytes: number;
  width: number;
  height: number;
  detail: 'high' | 'original';
  createdAt: string;
  previewUrl: string;  // authenticated app route, pinned to sha256
}
```

The exact preview URL is
`/api/workspaces/<encodedWorkspaceId>/attachments/<id>/content?sha256=<sha256>`.
It contains no session token, filesystem location, source path, EXIF properties,
or encoded image data. Preview responses use `no-store`, `nosniff`,
`Cross-Origin-Resource-Policy: same-origin`, and the validated raster MIME type.
The original readable Unicode filename is encoded in `Content-Disposition`.

Run/input APIs accept `attachments: AttachmentReference[]` alongside the text
prompt; a prompt may be empty only when an image is supplied. Saved visible user
turns carry `ChatMessage.attachments: ImageAttachment[]`. The engine resolves
references within the conversation's workspace and uses actual content parts:

```ts
const resolved = await getImageAttachments(ctx).resolve(
  workspaceId,
  references,
  { retain: true },
);
const input = {
  role: 'user',
  content: [
    { type: 'input_text', text: prompt },
    ...resolved.content, // {type:'input_image', image_url:'data:...', detail}
  ],
};
```

Resolve validates the entire batch before retaining any draft. Perform other
run-admission checks before calling it. If saving the accepted turn then fails,
the already retained image remains available rather than being silently removed.
Text redaction must not modify the opaque image URL. The existing model-history
accounting validates and separately bounds actual image wire bytes.

Known failure codes include `INVALID_ATTACHMENT_INPUT`,
`INVALID_ATTACHMENT_NAME`, `UNSUPPORTED_IMAGE`, `INVALID_IMAGE`,
`ANIMATED_IMAGE`, `IMAGE_TOO_LARGE`, `IMAGE_DIMENSIONS_EXCEEDED`,
`ATTACHMENT_MESSAGE_TOO_LARGE`, `ATTACHMENT_DRAFT_LIMIT`,
`ATTACHMENT_UPLOAD_BUSY`, `ATTACHMENT_EXPIRED`, `ATTACHMENT_NOT_FOUND`,
`ATTACHMENT_CHANGED`, `IMAGE_CHANGED`, `VERSION_CONFLICT`, and
`UNSAFE_ATTACHMENT_STORAGE`. Errors never return image contents or internal
storage paths.

## Browser integration examples

File selection, paste, and drop use the same direct-bucket worker and JSON promotion helper. Browser filename/MIME/size checks provide early feedback; server inspection decides whether the staged bytes are supported. Original accepted bytes are preserved, not recompressed. The shared promotion receipt survives a lost response and disposal of its unused generic draft; published staging retains its existing 24-hour expiry.

```ts
import { uploadImageAttachment } from '../client/components/chat/image-attachment-transfer';

async function uploadImage(workspaceId: string, file: File, signal?: AbortSignal) {
  const receipt = await uploadImageAttachment({ workspaceId, file, signal, detail: 'high' });
  if (!receipt.image) throw new Error('Photo preparation was not confirmed.');
  return receipt.image;
}

// <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple />
async function selected(files: FileList | null) {
  for (const file of Array.from(files ?? [])) await uploadImage(workspaceId, file);
}

// Attach only file items. Clipboard HTML and dropped URLs are never fetched.
function pasted(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile()).filter((file): file is File => !!file);
  if (files.length) {
    event.preventDefault();
    void Promise.all(files.map(file => uploadImage(workspaceId, file)));
  }
}

function dropped(event: DragEvent) {
  event.preventDefault();
  void selected(event.dataTransfer?.files ?? null);
}
```

The production composer additionally needs to enforce remaining message counts
and bytes before upload, bound its upload queue, keep draft chips until send is
accepted, show real errors and cancellation, and discard removable drafts on
explicit removal. Network upload progress must be indeterminate unless actual
transport progress is measured. Persisted previews should accept only the
expected same-origin workspace/attachment path and matching digest.

## Validation

`tests/agent-attachments.test.ts` exercises real PNG/JPEG/WebP/GIF bytes,
immutable copies, workspace source changes, digest corruption, animation and
dimension rejection, message/draft/concurrency bounds, symlink and parent-swap
attacks, abort cleanup, ownership-limited expiry, and retention in a separate
fresh Node process. Its HTTP cases instantiate the real `createApplication`
and test session/CSRF protection, binary body handling, Unicode names, actual
preview bytes, and a full app stop/start with the old signed session.

Engine admission, queued steering, visible-message serialization, thread
fork/rewind, and the browser composer are integrated by their owning modules;
their focused suites verify those contracts independently.
