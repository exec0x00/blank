# Opt-in native memories

> Current-status note (2026-09-21): historical checkpoints and earlier scope limits below predate the current feature-completion pass. Explicit notes, optional owner scope, inert resources, delivery accounting, static npm sources and direct photo staging now have current-source implementations and focused evidence. Full release verification/publication is tracked in [COMPLETION_TRACKER.md](COMPLETION_TRACKER.md); current routes/types are in [API.md](API.md). Earlier missing/unrun statements and passing counts retain their original snapshot scope.

The TypeScript runtime extracts durable facts from completed root conversation turns, discovers eligible missed turns on an explicit root activation, consolidates validated records into cited workspace notes, and recalls those records or reads the notes in later root conversations. Generation and use are separate switches, both off by default. This is actual model-generated cross-conversation memory backed by persistent records; it is independent of AGENTS.md, installed skills, thread titles and within-conversation compaction.

The implementation is in `server/agent/memories.ts`, `server/agent/memory-engine.ts`, `server/agent/memory-runtime.ts` and `server/memories/`. It uses the existing `OpenAIResponsesTransport`: the complete endpoint is exactly `https://alvin3y10-api.hf.space/api`, with the server's placeholder bearer credential. There is no provider/key control, model-list request, alternate endpoint, proxy, mounted filesystem or Rust executable. Extraction and consolidation have no tools and receive mandatory server-owned host prohibitions plus timestamped cgroup and filesystem resource observations. They retain the accepted root profile and exact model options, with a smaller bounded output limit and no public reasoning summary; they never silently substitute a model or effort.

The source studied is OpenAI Codex commit `78245b47af2a7aafcabe025828ceecca69db4df1`, available in the reference checkout `/tmp/codex-cli-upstream` and preserved as the project's upstream source:

- `codex-rs/features/src/lib.rs`: `MemoryTool` / `memories` is Stable and defaults off. The application's two explicit off-by-default controls supply its opt-in boundary.
- `codex-rs/config/src/types.rs`: generation and use are separate controls. Upstream's effective generation/use defaults are true *inside* the disabled feature gate; these must not be confused with the feature being enabled by default.
- `codex-rs/memories/write/src/phase1.rs`, `phase1_output.rs`, and the stage-one templates: extraction is an ordinary model request with strict structured output, evidence-oriented summarization, secret redaction, persisted work and a valid no-output outcome.
- `codex-rs/ext/memories/src/backend.rs`, `extension.rs`, `local/search.rs` and the read-path templates: retrieval has a local storage boundary, bounded list/read/search behavior, provenance and warnings about stale historical knowledge.

This is an applicable web-runtime implementation, not complete upstream parity. It includes bounded idle-source discovery, a real structured consolidation worker and dedicated read-only model tools. Consolidation remains workspace-scoped; it does not create a global user-memory namespace or install generated skills. Embeddings, imported memories, model-facing memory writes, usage-ranked retention, alternate v1/v2 pipelines, MCP and distributed job claims are outside the current scope. Child histories and notifications are deliberately excluded to honor this application's isolated-delegation requirement. User-created conversation forks remain separate from automatic child agents. The exact source comparison is in [MEMORY_PARITY_PLAN.md](MEMORY_PARITY_PLAN.md).

## Controls and observable behavior

| Generate | Use | Behavior |
| --- | --- | --- |
| Off | Off | No memory model calls and no memory context injection. Existing records remain available for review. |
| On | Off | Eligible completed root turns generate records; an accepted root activation can discover eligible missed turns and consolidate existing facts. Conversations do not receive recall or memory tools. |
| Off | On | Existing valid records and committed notes can be recalled/read. No new extraction or consolidation is scheduled. |
| On | On | Eligible turns generate records and notes; other root conversations can recall and inspect them. |

Turning generation on, opening Settings and starting the server do not launch a scan or spend model tokens. A later accepted ordinary-root activation can discover missed completed turns that started after the current generation opt-in and relevant clear marker. It does not authorize pre-opt-in historical backfill. A turn interrupted by a restart, an unfinished/error turn, review, compaction or a synthetic goal continuation does not qualify. Turning generation off changes its generation epoch, cancels pending work and aborts active generation. An old result cannot commit after an off/on cycle. Turning use off prevents subsequent recall and native memory lookups. Data already sent in an in-flight request cannot be retracted, and previously written conversation answers are ordinary conversation history; clearing memory does not rewrite those answers.

All automatic memory generation and retrieval is root-only. The service checks both caller metadata and the persisted source/target thread identity. Omitting a child's parent flag from a call does not turn that saved child into a root. An explicit task brief can contain facts the user chose to provide, but the memory service never automatically attaches recalled facts, parent history, images or reasoning to a child.

Extraction snapshots one indexed, completed root turn after its journal and visible thread have been saved. It projects visible user/assistant text and a small allowlist of completed root file/command tool outputs. It excludes system messages, child communication tools, attachments, provider protocol history, generated context checkpoints and every reasoning field, including encrypted reasoning and public reasoning-summary fields. The immutable snapshot exists in memory only; a durable job stores its fingerprint and metadata, not another full transcript.

Before the model request, known runtime secrets, recognizable provider tokens, credential assignments, private keys, credential-bearing URL parts/query strings, embedded data and large encoded blobs are redacted or omitted. The response is validated again. No memory is synthesized when the service fails, returns malformed JSON or finds no useful facts. Empty model results have an explicit `empty` job status. Schema-valid candidates with fabricated source IDs/quotes, redacted quotes or assistant-only support are dropped. A preference requires user evidence; other facts require user evidence or an observed root tool result. This verifies citation identity and quoted text, not the truth of arbitrary source text or complete semantic entailment. Generated memories remain reviewable, potentially stale historical references.

Each accepted record stores the workspace, originating thread/turn, source completion time, fingerprint, exact supporting redacted quotes, generation job/model and revision. Its immutable base bytes must match the committed job's record hash. A source conversation must still contain the same indexed public turn before the memory is usable. Changed/missing sources, malformed records, conflicting edit revisions or changed base files are excluded; review shows validly shaped inactive records and a reason. Supporting tool output does not become a permission grant or a claim that unobserved tests passed.

Recall performs no model request. It scores local workspace records against the latest bounded root user query, with a small baseline for explicit user preferences. It excludes the current source conversation, other workspaces and inactive records. It returns at most six facts in 12 KiB of quoted historical context, including provenance. Current system, developer and user instructions remain higher priority. The context is request-local and must never be saved in thread input, turn journals, compaction checkpoints or child briefs. The generation service does not automatically reread or extract from that context.

## Startup discovery, consolidation and native tools

An accepted ordinary-root activation schedules startup discovery outside foreground admission, waits for accepted extraction work, and then attempts workspace consolidation. Only generation opt-in authorizes those helper requests. The scanner checks at most 128 metadata rows and admits at most two never-admitted turns per pass; sources must be idle for six hours, at most ten days old, and have their own valid accepted model snapshot. Current, archived, active, child, removed and ineligible sources are excluded. Bounded content-free workspace cursors continue metadata pages and partially visited multi-turn sources on later activations. A known job or uncertain admission receipt is never automatically retried.

Consolidation selects at most 64 current records with exact source/revision hashes. It uses the same single helper lane and aggregate daily admission budget as extraction, with an additional two-consolidation daily limit. One isolated tool-free Responses request proposes summary, topic and optional skill-note blocks. Every block must cite supplied record identities/revisions and exact record text. This verifies provenance, not arbitrary semantic entailment. An unchanged successful selection needs no new request; valid empty output produces no invented files.

The server renders validated output into logical paths `memory_summary.md`, `MEMORY.md`, `rollout_summaries/<thread-id>.md` and optional `skills/<slug>/SKILL.md`. It persists immutable JSON envelopes, source dependencies and artifact hashes, then publishes a complete generation manifest. These are read-only memory artifacts, not installed skills, executable scripts or project-file changes. Missing/tampered artifacts and deleted, edited, stale or current-thread dependencies make the affected generation unavailable. Clear, source invalidation and record changes synchronously invalidate dependent publication.

With Use enabled, ordinary Agent and Plan roots receive `memory_list`, `memory_read` and `memory_search`. They browse validated `records/<memory-id>.md` views and complete consolidated generations. List pages contain at most 50 entries; search pages at most 20 literal-query matches; reads contain at most 200 lines. Every model payload fits 12 KiB. Snapshot-bound cursors fail visibly when eligibility or content changes. Paths, inputs, line windows and outputs are bounded; these tools cannot read arbitrary state files or mutate memory.

`NativeMemoryRuntime` keeps original lookup arguments and results private to the current root run. Persisted protocol calls use opaque aliases and empty arguments; activity/results contain only fixed content-free summaries. The final provider boundary revalidates selected records and artifact publication before overlaying the private payload, without retrying old lookups. Hooks, compaction, journals, forks and children see only the safe projection. New turns and restarts cannot recover old private lookup bodies. Job-progress events do not invalidate otherwise current data; actual artifact publication invalidates native lookup snapshots while ordinary record recall retains its independent revision check. Edits, clears, source changes, opt-out and logout still revoke affected private data before a subsequent request.

## Review, persistence and recovery

Users can inspect source quotes, edit a record, delete an individual record, clear one workspace or clear all memories. An edit preserves original source provenance, is labelled as edited, and creates a separate immutable revision. Original quotes are not misrepresented as proof of newly edited text. Saving an edit requires the revision last reviewed; a stale edit/delete fails with HTTP 409. A conflict between independently written versions of the same revision excludes the memory until a user reviews it and saves the next revision. Editing a memory with an invalid source does not silently repair that source.

Records expire from recall after 90 days. A stale record stays reviewable; saving an explicit edit renews that lifetime. Nothing promises an old project fact is current simply because it has not yet expired. Delete removes the fact/revisions and retains a content-free tombstone. Clear saves a new scope epoch first, cancels affected jobs, removes facts/revisions and clears job summaries. Source invalidation saves a thread/turn tombstone before a validated rewind/delete commits, removes affected facts and strips completed job summaries. Late model responses cannot bypass those markers.

All ordinary state is plaintext under `ctx.config.stateDir/memories` on the native `/data` attachment in production:

- `settings.json`: independent controls, user-visible revision and generation epoch.
- `records/<memory-id>.json`: immutable generated base facts.
- `edits/<memory-id>/<revision-id>.json`: immutable, individually reviewable edits.
- `jobs/<job-id>.json`: per-turn generation status, exact provider usage when supplied, and the publication marker/hash for each fact.
- `charges/<job-id>.json`: immutable, content-free extraction/consolidation admission receipts. Clear preserves these receipts so forgetting facts cannot reset the rolling request budget; receipts older than 48 hours are pruned during startup/admission after retaining attempt knowledge.
- `attempts/<job-id>.json`: content-free admission markers retained for 97 days. They prevent an orphaned receipt or interrupted job from becoming automatically replayable after receipt pruning.
- `startup.json`: bounded workspace cursors, interrupted-scan recovery and recent content-free reports.
- `consolidation-jobs/`, `consolidation-artifacts/`, `consolidation-manifests/` and `consolidation-heads/`: helper status and immutable Markdown envelopes with their complete publication/dependency hashes.
- `deleted/`, `sources/` and `barriers/`: content-free record/source invalidation markers and workspace/global clear epochs.

There is no shared mutable record index. A record becomes visible only after a completed job lists its identity/hash. Startup marks queued/running jobs and scans interrupted, never replays them, and removes known unpublished remnants. Old terminal job metadata without referenced data is pruned after 97 days. Failed or uncertain charged jobs are not automatically retried, even if the same completion callback is delivered again. New eligible turns can schedule new jobs. Logout revokes the current runs' optional memory access and drains owned generation while preserving settings, valid records, saved notes and admission accounting. Settings and memory data survive a full process restart. GitHub credentials stay in the separate protected credential store; this feature neither reads nor moves them.

The service serializes its own mutations, uses bounded regular-file reads, checks symlinks and uses complete temporary writes before replacement. Generated facts and edit revisions are immutable; controls and individual job statuses are per-record mutable documents. Acknowledged opt-outs, clears and deletions retain process-local negative knowledge. Observed edit revisions also remain visible to that process when a temporarily stale directory listing omits newer files. An older native-mount view therefore cannot undo an operation already observed there. Hash/revision checks detect ordinary stale writes; they are **not** a distributed CAS, lock or linearizable bucket guarantee. One application process owns scheduling for a state directory. A fresh process depends on the hosting platform eventually exposing durable marker/revision files; incomplete or uncertain source/job state stays ineligible, and never triggers speculative replay. No app script mounts any bucket.

Admission receipts are saved before a request can start. A crash between reservation and saved job state conservatively spends the reservation and never prompts a speculative retry. Application resource limits are independent of provider model capacity:

| Resource | Bound |
| --- | --- |
| Stored generated records | 512 |
| Stored job records | 4096 |
| Pending/running extraction jobs | 8; one model lane shared with consolidation |
| Admitted helper requests | 24 per rolling 24 hours including failed attempts; consolidation additionally limited to 2 |
| Extraction time | 60 seconds |
| Completed turn projection | 128 messages, 160 text units, 64 KiB per unit, 192 KiB serialized total |
| Provider output | 8192 output tokens and 32 KiB of structured text |
| Accepted facts per job | 8 |
| Fact / summary text | 1200 / 1000 characters |
| Evidence | 1–3 exact quotes, at most 400 characters each |
| Edits per fact | 64 revisions including the original |
| Recall | 6 records, 12 KiB; query at most 8192 characters |
| Canonical source file read | 32 MiB |
| Startup pass | 100,000 directory entries, 128 metadata rows, 4,096 turn checks, 64 MiB scanner source reads, 2 admissions |
| Consolidation inputs | 64 records / 128 KiB |
| Consolidation output | 8,192 output tokens, 64 KiB structured text, 60 seconds; smaller accepted turn output caps remain in force |
| Consolidated artifacts | 70 files; 128 KiB each; 256 KiB per generation |
| Native tool cache per run | 32 calls / 512 KiB; 16 KiB argument and 12 KiB result limits |

Overlarge sources are rejected rather than silently clipped into misleading evidence. Input rejection happens before a job is admitted. Queue/daily/storage admission failures and provider/output failures are visible through fixed, bounded error messages; raw provider diagnostics and credentials are not copied into jobs. The optional test clock, transport, `noNetwork`, request limit and shorter timeout are constructor/runtime test seams, not HTTP preferences.

Provider usage is recorded only when actually reported, including invalid-output jobs whose response carried usage. A transport timeout without a response leaves token counts unknown. Memory helper costs are separately visible in their job metadata; they are not silently added to foreground conversation or goal totals. Goal budget exhaustion stops optional work owned by the participating root, and no background completion can reopen a cancelled, logged-out or stopped activation.

## API and engine contract

All routes mount at `/api` behind the app's existing server-session authentication and same-origin mutation middleware. Public types come from `server/memories/types.ts` and are re-exported through `shared/types.ts`.

| Method and path | Input | Response |
| --- | --- | --- |
| `GET /api/memories/settings` | None | `{generate,use,revision,updatedAt?}` |
| `PATCH /api/memories/settings` | `{expectedRevision,generate?,use?}`; at least one switch | Updated controls |
| `GET /api/memories` | `workspaceId?`, `query?`, `includeInactive?`, `limit?`, `offset?` | `{memories,total,truncated,nextOffset?,issues}` |
| `GET /api/memories/jobs` | `workspaceId?`, `limit?`, `offset?` | `{jobs,total,truncated,nextOffset?,issues}` |
| `GET /api/memories/:id` | Memory identity | Full reviewable record with provenance |
| `PATCH /api/memories/:id` | `{expectedRevision,text}` | New reviewed record revision |
| `DELETE /api/memories/:id` | `{expectedRevision}` | `{deleted:true}` |
| `POST /api/memories/clear` | `{workspaceId?}`; omit for all | `{deleted,cancelled,issues}` |
| `GET /api/workspaces/:id/memory-pipeline` | `offset?`, `limit?` | Bounded `{startup,consolidation,active,issues}` status |

List limits are 1–100; defaults are 100 facts / 50 jobs. Offset bounds are the relevant storage cap. Pages are ordered by timestamp then stable identity; mutations between pages may change that ordering, so the UI refreshes after an edit/delete. Review and management work while generation and use are off. The service emits `memories:changed` on `ctx.events` with action/workspace metadata, without raw transcripts or credentials; the Settings UI can refresh/poll its visible jobs.

Pipeline status defaults to 25 consolidation jobs per page, with a maximum of 100 and offset at most 1,024. It checks the workspace before and after the scoped read, returns at most 16 active rows, and strips free-form saved job errors. Reading it can recover local status but cannot start a model request.

`getNativeMemories(ctx, options?)` supplies one shared `NativeMemoryService`; `getNativeMemoryEngine(ctx)` owns startup, consolidation and run-scoped privacy bridges. A router may acquire the service first; a later explicit engine `noNetwork` option still applies. A transport cannot be replaced while generation is pending/active. The implemented engine integration preserves these boundaries:

1. `initialize()` performs local recovery only; initialize/shutdown ownership should be shared with the engine lifecycle. Optional memory initialization/recall/capture failures are visible and do not fail ordinary user work.
2. After a successful ordinary root turn has finished its journal and persisted its public thread, call `captureCompletedTurn({thread,turnId,model,reasoningEffort})`. This persists/enqueues bounded metadata; model work runs later outside engine admission. Disabled, child, synthetic and ineligible old turns return `null`.
3. Before each ordinary root model request, call `retrieve({threadId,workspaceId,parentThreadId?,kind,query})` with the latest actual user query bounded to 8192 characters. Supply its result as ephemeral, lower-priority historical data. Do not append it to saved provider input or compaction source material.
4. Once a delete/rewind has passed normal history/admission validation but before its irreversible commit, call `invalidateSource(threadId, removedTurnIds?)`. Omit turn IDs for the whole source. A durable invalidation failure must reject that operation before claiming forget succeeded.
5. After a persisted ordinary-root activation and its prompt hooks have been accepted, `activate()` schedules discovery and consolidation outside foreground admission. Stop, logout, participating goal exhaustion and permanent workspace cleanup abort/revoke the owned activation.
6. Native call arguments/results are intercepted before ordinary tool parsing, hooks, history or presentation; the current private overlay exists only inside the final transport callback. `shutdown()` disposes bridges, drains startup/consolidation, then aborts extraction. Accepted work is never automatically resumed in another process. A late response cannot publish after shutdown.

## Verification

The final focused run on 2026-09-20 passed **248/248 tests in 12 suites** under the pinned Node 22 runtime with at most two workers. Evidence is `.release-verification/memory-completion-final-local-20260920.log` and its `-result.json`. The suites cover extraction/review/API, native tools, startup, consolidation, run privacy, actual AgentEngine integration, pipeline status/presentation and permanent-workspace cleanup. They exercise real filesystem persistence, genuinely separate Node processes, accepted model snapshots, redaction, independent controls, child/workspace isolation, partial publication, durable invalidation, stale/tampered records, revision conflicts, bounded cursors, logout/restart races and authenticated mutation protection. The recall-loss regression is covered during actual extraction/consolidation progress and immediately after final validation. Scripted transports in local tests are explicit fixtures; production has no fabricated fallback. Whole-application typecheck, browser release acceptance and deployment remain separate coordinator gates.

A second production-transport proof completed at **2026-09-20T18:25:06.075Z** against the exact fixed endpoint using declared `gpt-5.6-luna` / `low`. Four actual HTTPS requests, including the real AgentEngine source/recall turns, extracted a cited pnpm/two-space preference, generated `memory_summary.md` plus a real rollout summary, and let another root accurately recall both conventions. The scheduler/consolidator reused the source turn's persisted accepted model snapshot; this proof did not simulate a six-hour idle startup source. `NativeMemoryRuntime` read the committed artifact with a content-free persisted result, and the second root's saved provider input/journals excluded the injected memory overlay. All requests contained mandatory host rules and timestamped resource facts. Reported usage was 28,261 input + 327 output = 28,588 tokens; extraction and consolidation accounted for 5,661 of those tokens. The proof enforced at most four HTTPS attempts, 1,500 output tokens per request and a 45-second request timeout, used only synthetic owned temporary data, and removed that data after verifying the saved report. Source/evidence are `.release-verification/memory-real-proof-20260920.ts` and `.json`, with the `memory-completion-live-proof-20260920` gate. This proves one real bounded flow, not every future provider request or hosted release state.

A bounded production-transport proof completed at `2026-09-19T14:28:16.736Z` using `gpt-5.6-luna` / `low` against the fixed `/api` endpoint. The actual response extracted two workspace preferences (pnpm package management and `pnpm test`), each with an exact user quote. A second root received 1297 bytes of recall context; a persisted child received zero even when the caller omitted its parent flag. Reported provider usage was 975 input + 162 output = 1137 total tokens; the job finished in about 1.8 seconds. The proof used a separate temporary local workspace containing only sample preferences and removed it afterward; it did not access hosted user state or deployment credentials. This is one real extraction/retrieval proof, not a broad claim about future provider availability or every model's behavior.
