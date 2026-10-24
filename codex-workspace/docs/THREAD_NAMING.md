# Automatic thread titles

The TypeScript implementation is in `server/agent/thread-naming.ts`. The main
engine owns thread records and emits the ordinary `snapshot` SSE event when a
title changes. Naming makes a real background Responses request; a clipped first
message is only a temporary local preview and is never represented as a
model-generated title.

## Upstream behavior studied

Reference checkout: OpenAI Codex commit
`78245b47af2a7aafcabe025828ceecca69db4df1`, downloaded at
`/tmp/codex-cli-upstream` and preserved in this project's `upstream/` source.

- `codex-rs/tui/src/app/thread_title.rs` defines a 36-character generated title,
  a bounded prompt, structured `{ "title": "…" }` output, a hidden asynchronous
  generation task, and cancellation when a manual title is saved. Its preferred
  metadata model is explicitly `gpt-5.6-luna` with `low` reasoning when the
  provider/catalog supports it; otherwise upstream uses the active model.
- `codex-rs/tui/src/app/thread_routing.rs` starts generation from a substantive
  user message when the thread lacks a name.
- `codex-rs/tui/src/app/event_dispatch.rs` rejects cancelled completions, checks
  the originating thread again, and applies a result only while its name remains
  eligible. Changing the currently displayed thread does not change the target.
- `codex-rs/tui/src/app/thread_title_tests.rs` tests manual rename cancellation,
  late events, input/output bounds, Unicode, and title normalization.

This rewrite uses the verified catalog's `gpt-5.6-luna` for background naming,
with `low` reasoning. It is a documented metadata choice, never a replacement
for the main conversation's selected model. There is no alternative model or
provider fallback. The native transport requests strict JSON-schema output and
the service validates the sole `title` string property before accepting it;
unexpected fields, tool calls, malformed JSON, and incomplete responses do not
become titles. No separate hidden conversation is inserted into the user's
thread list.

## Visible behavior

1. The first meaningful prompt can provide an immediate local preview, limited
   to 80 Unicode characters. Its source is `prompt`.
2. After a short debounce, the service requests a concise task title without
   blocking message admission, streaming, editing, or terminal input. A valid
   response becomes a `generated` title, limited to 36 Unicode characters.
3. Explicitly renamed threads have source `manual` and remain unchanged until
   the user chooses automatic naming again. A manual name equal to the current
   title still advances the title revision and supersedes pending generation.
4. Ordinary follow-up messages do not repeatedly rename a thread. A substantial
   change explicitly introduced as a new task or topic can trigger a new title
   after a five-minute cooldown. There are at most four automatic generation
   invocations between explicit automatic-name requests. Duplicate prompts do
   not create additional invocations.
5. `POST /api/threads/:id/auto-name` explicitly opts a root thread back in. The
   core clears manual protection and advances the revision first; the naming
   service queues a request based on the latest substantive user message.
   Repeated explicit requests are debounced and separated by at least five
   seconds. Delegated agents retain their descriptive assigned task names.
6. Provider errors or invalid titles preserve the local/current title. They
   never create a fabricated model result or interrupt the main agent. The
   existing automatic-name action can request another attempt.

Legacy records without title-source metadata are handled conservatively: a
non-default saved title is considered manual. Migration must not guess that a
previously saved user title was merely an automatic preview.

Image-only user turns use a bounded description of the attached images' display
names and supported MIME types when no prompt text is available. Normal user
text takes precedence. This fallback also supplies a useful local preview and
works for explicit automatic naming and restart recovery. It never sends image
bytes, attachment IDs, hashes, URLs, filesystem paths, or private attachment
context to the title model; filenames are redacted and shortened before use.

## Persistence and race contract

`Thread` uses two optional metadata fields:

| Field | Meaning |
| --- | --- |
| `titleSource` | `placeholder`, `prompt`, `generated`, or `manual` |
| `titleRevision` | A counter advanced for title changes and explicit naming-mode changes; conversation streaming does not advance it |

`ThreadNamingService` receives callbacks for reading a thread and applying a
title. The apply callback must synchronously compare the expected title and
title revision, reject manual or deleted threads, mutate the title metadata,
then persist and emit a normal snapshot. Checking only the visible title is not
sufficient: a user can manually save precisely the same text.

The service stores ordinary, unencrypted JSON through `ctx.store`, under the
native `/data` state directory:

- `thread-naming-<threadId>` contains the generation identity, attempt count,
  request status/timestamps, prompt fingerprint, source message ID, expected
  title revision, and metadata model. It contains no extra copy of the prompt,
  raw provider error, credential, or conversation/tool output.
- `thread-naming-pending` indexes queued and unfinished requests by thread,
  request identity, reason, source message ID, and expected title revision.
  Startup reads this small index instead of scanning every thread file on the
  slower bucket mount.

Eligible queued intent is saved before its debounce timer starts. Completed/manual titles cause no
requests on login, thread reads, or normal process startup. Shutdown aborts
active requests and preserves both queued and unfinished work for a bounded
startup retry, including an explicit opt-in after the automatic allowance ended.
Recovery checks title revisions before resuming, including the crash window
after a title was saved but before naming metadata was acknowledged. An older
request cannot remove the pending-index entry of a newer request. Thread
deletion waits for cancelled naming work to finish its bookkeeping, then removes
its naming metadata. Late provider completions cannot recreate the thread.

## Transport and resource limits

The service reuses `OpenAIResponsesTransport` and `resolveProvider`. Requests go
directly to the exact owner-provided Responses URL
`https://alvin3y10-api.hf.space/api`, with the existing server-side placeholder
credential. There are no model-list probes, configurable URLs, authentication
forms, or additional proxies. Each naming request repeats the prohibitions on
proxies, filesystem mounting, proot, Docker, containers, and sandbox machinery.
It exposes no tools and cannot perform filesystem or terminal operations.

The serialized task input is bounded to 960 UTF-8 bytes including JSON escaping.
Only the requested task text is sent; file contents, tool output, and other
private conversation context are not collected for naming. The existing
`SecretRedactor` is applied before any truncation, with additional masking of
credential assignments and credentials embedded in URLs. Titles are normalized
to plain text with control and direction-override characters removed.

There is one background request at a time by default, a 64-job queue limit,
a 30-second request deadline, a 1,024-token output cap, and an 8-KB streamed
title-output limit. Native transport retries are themselves bounded; the four-invocation limit counts
service-level generation attempts. A full queue leaves the usable local title
in place. Shutdown also completes promptly if an injected transport ignores its
abort signal; its later result is discarded.

## Verification

Run `npx vitest run tests/thread-naming.test.ts`.

The tests use real temporary `JsonStore` files and a scripted model transport at
the provider boundary. They cover request contents, nonblocking admission,
persisted generated titles, same-text manual rename races, revision conflicts,
deletion after cancellation, a fresh store after restart, interrupted recovery,
the post-title-save crash window, explicit opt-in, per-thread attempt limits,
queued debounce recovery, global request concurrency, provider errors, timeout, output validation,
credential redaction, and Unicode/serialized-input bounds. The scripted provider
is explicitly a test fixture; production always uses the direct Responses
transport. An integration test also uses the actual `AgentEngine` to verify that
the thread list and SSE snapshot receive a generated title while the primary
agent remains active, and that a subsequent manual name survives completion.

Live native-transport verification on 2026-09-19 used the fixed endpoint,
`gpt-5.6-luna`, `low`, the strict title schema, and the 1,024-token output cap. It
returned `{"title":"Fix Git Ownership in Workspace"}` in 1,781 ms; the streamed
JSON matched the completed output. This is evidence for that one request, not a
latency guarantee. The deployment coordinator retains the evidence in
`/tmp/codex-structured-title-live-proof.json`.
