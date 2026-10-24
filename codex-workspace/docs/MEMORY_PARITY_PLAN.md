# Native memory parity plan

> Current-status note (2026-09-21): historical checkpoints and earlier scope limits below predate the current feature-completion pass. Explicit notes, optional owner scope, inert resources, delivery accounting, static npm sources and direct photo staging now have current-source implementations and focused evidence. Full release verification/publication is tracked in [COMPLETION_TRACKER.md](COMPLETION_TRACKER.md); current routes/types are in [API.md](API.md). Earlier missing/unrun statements and passing counts retain their original snapshot scope.

This review compares the TypeScript memory implementation with pinned OpenAI Codex commit `78245b47af2a7aafcabe025828ceecca69db4df1` in `/tmp/codex-cli-upstream`. As of 2026-09-20, native read tools, startup discovery, workspace consolidation and the run-scoped privacy bridge are integrated with the actual engine and authenticated status API. [MEMORIES.md](MEMORIES.md) describes the resulting behavior and deliberate scope differences. The coordinator retains shared types, API documentation and whole-release acceptance.

The current focused gate passed **248/248 tests in 12 suites** under pinned Node 22 with at most two workers; evidence is `.release-verification/memory-completion-final-local-20260920.log` and `-result.json`. It includes the earlier canonical-workspace/transient-storage follow-up, composed engine lifecycle/privacy tests, and permanent-workspace cleanup. A real four-request fixed-endpoint proof also passed through actual AgentEngine source/recall turns, native extraction/consolidation and artifact reads; its source/report are `.release-verification/memory-real-proof-20260920.ts` and `.json`. Earlier 67/67 and 120/120 module-only runs remain historical evidence, not the present acceptance scope. This worker has not performed a new whole-site build, browser release acceptance or deployment.

## Findings from the pinned source

| Behavior | Pinned upstream evidence | Current application / required work |
| --- | --- | --- |
| Opt-in boundary | `codex-rs/features/src/lib.rs`: `MemoryTool` is Stable and off by default. `config/src/types.rs`: generation/use default true within that disabled feature; dedicated tools default false. | Separate generation/use switches are already off by default. Preserve their independent meaning; exposing tools must require use, never implicitly enable generation. |
| Startup extraction | `memories/write/src/start.rs`, `phase1.rs`; `state/src/runtime/memories.rs::claim_stage1_jobs_for_startup`. Non-ephemeral root startup scans recent, idle, enabled interactive threads; excludes the current/archived/polluted/disabled thread, already current outputs and competing claims. | Implemented on accepted ordinary-root activation with bounded metadata-first discovery, durable continuation cursors and post-opt-in/source/model checks. Initialization remains local recovery only; uncertain requests and pre-opt-in history never replay. |
| Upstream bounds | `config/src/types.rs`: default 2 rollouts/startup, 10-day maximum age, 6-hour minimum idle time, 256 raw inputs/consolidation, 30 days unused retention, 25% remaining known quota. `write/src/lib.rs`: scan 5000, extraction concurrency 8, hour leases/backoff. | These are upstream defaults, not provider capacities. Keep the application's one extraction request, 8 pending jobs and 24 daily admissions until a verified accounting policy changes them. A browser startup must not multiply the budget. |
| Extraction and retry | `phase1.rs`, `phase1_output.rs`, `rollout_input.rs`: strict structured output, source projection, secret redaction, valid no-output state, claimed jobs/backoff and exact reported usage. | Implemented per completed ordinary root turn with exact quote validation and immutable publication markers. Retry remains deliberately conservative. A future retry must be a distinct charged attempt, not replay an ambiguous original receipt. |
| Global consolidation | `write/src/phase2.rs`, `workspace.rs`, `storage.rs`: one global claim, bounded usage-ranked inputs, source selection watermark, synced raw/summary artifacts, deletion diff, real internal consolidation agent, publication after success. | Real workspace-scoped structured consolidation is implemented with immutable artifacts, dependency hashes, atomic publication and shared admission limits. Global user scope and usage-based ranking are intentionally absent. |
| Consolidation isolation | `phase2.rs::agent::get_config`: ephemeral, no generation/use, no recursive collaboration/plugins/apps/MCP; parent-disabled/external permissions are preserved, managed profiles restrict local writes and network. | An isolated tool-free TypeScript helper receives selected record evidence and its own brief, never parent history. The server validates and renders proposals; no shell, sandbox/container machinery or generated skill installation is used. |
| Read tools | `ext/memories/src/backend.rs`, `tools/`, `local/`: list/read/search plus append-only ad-hoc notes; relative paths, line windows, pagination, substring search with any/same-line/window matching and optional separator normalization. | `memory_list`, `memory_read` and `memory_search` are integrated for record views and real committed Markdown artifacts, with bounded cursors and private per-run result overlays. No model-facing write tool is exposed. |
| Explicit memory changes | `ext/memories/templates/memories/read_path.md`, `tools/ad_hoc_note.rs`, `write/src/extensions/ad_hoc.rs`: direct user request required; append-only note feeds consolidation rather than editing artifacts directly. | UI review/edit/delete already exists. A model-facing remember/update/forget tool needs a separate provenance and authorization contract. Read-only tool work must not add an unreviewed write path. |
| Provenance and forgetting | `state/src/runtime/memories.rs`: source generation timestamps, selected source versions, polluted-thread invalidation; consolidation diff removes derived information. | Exact public-turn fingerprints, job record hashes, edit chains, source tombstones and scope epochs protect records. Published artifacts retain the exact dependencies and become unavailable when any dependency changes. |
| Usage and citations | `memories/read/src/citations.rs`, `usage.rs`, `core/src/memory_usage.rs`, `state/src/runtime/memories.rs`: memory citations and counted use guide selection. | Current jobs expose exact provider usage when supplied; retrieval has no usage-ranked retention. Add content-free actual-access/citation receipts before introducing usage-based consolidation. A list operation or a guessed model citation is not proof a fact was used. |
| Version/config breadth | Config supports v1/v2, dual write, external-context exclusion and extraction/consolidation model overrides. | Do not add alternate providers, model discovery or hidden model substitution. The fixed managed model/effort policy applies to helpers. Optional advanced settings need explicit product/API work; file-format equivalence is not practical behavior parity. |

The upstream memory README has stale crate-location references and describes some consolidation restrictions more broadly than the current code. The code paths above were inspected directly. The comparison itself needed no provider discovery or credentials; the separately authorized production proof used only the fixed Responses endpoint and synthetic owned data, without `/models`, a proxy or hosted user state.

## Invariants that apply to every addition

- Generation and use remain independently disabled by default. Opt-out/opt-in cycles, clear markers, source deletion/rewind and shutdown must prevent a delayed response from publishing or returning recalled data.
- Caller metadata is insufficient: verify the persisted target/source identity, workspace, root/parent fields and ordinary conversation purpose. Child workers never receive automatic memory, root history, images or reasoning. An internal consolidation worker has its own isolated brief; it is not a user child with inherited history.
- Read only bounded regular files using existing symlink/traversal checks. Keep ordinary state unencrypted under the existing native `/data` state directory. No mounts, proxies, container machinery, credentials in URLs or additional model service.
- Validate evidence and source dependencies on both publication and use. Edits preserve original source provenance; original quotes are not proof of new edited wording. Expired/invalid/ambiguous records cannot be promoted into valid artifacts by consolidation.
- Automatic memory context is request-local. Never persist it in provider history, journals, compaction checkpoints or child briefs. Native read-tool payloads need the same separation; persist a content-free activity result and revalidate any payload before subsequent transmission.
- Record actual provider counts only when supplied. Admission receipts remain content-free and survive forgetting. A reserved request, a provider-reported request and a successful memory publication are different events.
- Return honest empty, stale, unavailable, interrupted and failure states. No invented memories, fallback model text, mock consolidation or optimistic claims that forgotten content was removed from already written answers.
- One application process owns scheduling for a state directory. Existing marker/hash checks do not constitute a distributed lease/CAS on an eventually visible bucket. Do not add cross-process retry guarantees without a real supported ownership mechanism.

## Implemented read-only native tools

The service and views live in `server/agent/memories.ts` and `server/memories/native-tools.ts`; `server/agent/memory-engine.ts` and `memory-runtime.ts` own their lifecycle and private overlays. Generic engine integration remains coordinator-owned.

The tool surface uses ordinary Responses function tools named `memory_list`, `memory_read`, and `memory_search`. All context identifying the current thread/workspace/run purpose comes from the runtime, never model arguments. Both Agent and Plan may use these read-only tools when use is enabled and the persisted thread is an ordinary root conversation.

`records/<memory-id>.md` contains read-only rendered views of real saved records. Each view identifies the revision, original source thread/turn/time, whether it was edited, exact source quotes and the historical-data warning. The same namespace exposes validated complete generations at `memory_summary.md`, `MEMORY.md`, `rollout_summaries/<thread-id>.md` and optional `skills/<slug>/SKILL.md`. These are logical memory artifacts, not arbitrary state-file access or installed skills. Current-thread, other-workspace, stale and invalid records/dependent generations are omitted.

| Tool | Arguments | Result |
| --- | --- | --- |
| `memory_list` | Optional relative directory, opaque continuation cursor and result bound. | Immediate entries and a continuation cursor. Listing identifies saved records without dumping their text. |
| `memory_read` | Exact record-view path, optional 1-based line offset and line count. | Real rendered text, source/revision metadata, line boundaries and explicit truncation. |
| `memory_search` | 1–8 bounded literal substrings, any/same-line/within-line-window mode, optional path/cursor/context/case/separator normalization and result bound. | Stable path/line matches with exact snippets and matched queries. No regular expressions, network lookup or fabricated semantic similarity. |

Application bounds are intentionally smaller than upstream file tools: no more than the existing 512 records scanned; up to 50 list entries or 20 search matches per response; 12 KiB total encoded model payload; 200 read lines; 3 context lines; 20-line search window; and 256 characters per query. Use snapshot-bound cursors so changes to source eligibility, edits, settings or query parameters produce a visible stale-cursor error instead of silently skipping/repeating results. Argument validation rejects absolute paths, traversal, backslashes, hidden state files, oversized cursors and unknown fields.

The service must recheck settings, clear epochs, target identity and referenced records at the return boundary. Initial record reads should not hold the mutation queue: turning use off or clearing must be able to complete while a read is waiting. A short final admission section orders the final check against acknowledged local mutations. Native mount freshness remains subject to the already documented single-process/eventual-visibility limit.

The dedicated module exports these integration contracts:

```ts
type NativeMemoryToolContext = Omit<NativeMemoryRetrieval, 'query'> & {
  signal?: AbortSignal;
};

class NativeMemoryTools {
  constructor(service: NativeMemoryService, consolidator?: NativeMemoryConsolidator);
  isTool(name: string): boolean;
  definitions(context: NativeMemoryToolContext): Promise<FunctionTool[]>;
  execute(name: string, args: unknown, context: NativeMemoryToolContext):
    Promise<NativeMemoryToolResult>;
}

interface NativeMemoryToolResult {
  modelOutput: string;       // Ephemeral current-root model input only.
  persistedOutput: string;   // Fixed, content-free activity/history summary.
  memoryIds: string[];       // Actual referenced identities for future citations.
}
```

The engine now registers definitions before an eligible root model call and routes execution through `NativeMemoryRuntime` before generic parsing, hooks or tool activity. Search arguments can themselves contain recalled wording, so persisted calls use opaque identities and empty arguments, and saved results contain fixed content-free summaries. Original call/result overlays are revalidated only for the current turn; new runs, forks and children cannot replay those private bodies. Final provider assembly occurs synchronously after the last asynchronous validation fence. Ordinary job progress does not erase validated recall. Artifact changes invalidate native lookup snapshots separately from ordinary record recall; source/record/control changes and logout revoke both. Current engine/privacy tests cover these boundaries.

No `add_ad_hoc_note` tool is included in this step. Proposed follow-up: explicit direct-user remember/update/forget requests create immutable notes recording the actual user message/turn and revision intent. Notes must pass redaction, scope and root checks and never inherit authority from quoted memory, assistant plans or child output. Forget must immediately tombstone referenced facts/derived artifacts, rather than await a future model consolidation. Generate-off must not authorize an implicit memory write. A reviewed action/UI or a separately explicit remember command can authorize a one-time note without changing either switch; its exact API/permission behavior needs coordinator approval before implementation.

## Startup extraction contract

`NativeMemoryEngine.activate(rootContext)` invokes `NativeMemoryStartup.schedule()` after an eligible ordinary root and its exact options are persisted and its prompt hooks accepted. `initialize()` remains local-only; opening Settings, an unauthenticated request or a router singleton cannot spend tokens. A bounded process/root scan guard prevents multiple UI connections from triggering duplicate passes.

The candidate iterator should read bounded lightweight thread metadata first, then canonical source documents only for selected candidates. Initial defaults: at most 128 candidate metadata rows examined, two newly admitted ordinary completed turns per pass, ten-day age window and six-hour idle minimum. Exclude the current root, archived/child/missing/trash workspaces, active/pending runs, review/compaction/goal continuations, and turns started before the current generation epoch or clear barrier. These limits are application admission policy and can differ from upstream's 5000-row scan and per-rollout unit; do not silently discard older eligible work because a first page was full. Persist a content-free bounded cursor/checkpoint for later root activations.

Reuse the existing deterministic per-turn job ID and admission receipt. Completed/empty/failed/interrupted/cancelled jobs and an orphaned charge are terminal for automatic scan; their absence is not proof it is safe to retry. Only an eligible, never-admitted post-opt-in source can be queued. Re-read source/epoch before request and before commit. A restart can discover missed completed turns that were never admitted; it must not replay a request whose outcome is unknown.

Selection and admission must not run inside foreground engine admission. Reuse the same extraction transport, model/effort validation, queue and rolling request cap. Determine the actual completed turn's model/effort from persisted metadata; do not substitute the currently selected model when that metadata is missing. Surface bounded scan/job failure counters through existing memory events/review state. Explicit historical backfill and retries are separate future user actions with reviewable scope and cost; turning generation on alone does not imply either.

The implemented root lifecycle supplies server-owned identity, accepted per-turn model snapshots and active-run/authorization fences. Bounded metadata reads precede canonical source reads; source identity/options are checked again at admission and publication. Legacy missing options are reported rather than inferred from mutable current settings.

## Consolidation contract

Start with workspace-scoped consolidation of multiple validated records. Upstream uses one global user memory namespace; this app currently promises workspace isolation. Cross-workspace user preferences require an explicit scope setting and provenance rules, not simply loading every workspace's records. A shared scheduler can serialize all workspace consolidation jobs without exposing their data to one another.

1. Select up to 64 current active records with exact IDs, revisions, record/source hashes and scope epochs. Use deterministic ordering. Once actual-access receipts exist, rank by supported usage/recency; never manufacture usage counts from lists or injected context alone.
2. Compute a selection digest. An unchanged successfully published selection requires no model call. Deletions/edits/source invalidation are changes even when they leave the input set empty.
3. Reserve a content-free consolidation charge in the same aggregate budget before starting. The implemented policy permits at most two consolidations daily while preserving the total 24 background memory requests. Keep extraction/consolidation counters separately observable; do not clear either when facts are forgotten.
4. Run a real isolated tool-free consolidation worker through the fixed Responses transport. Give it an explicit task brief, selected evidence and a strict output schema for summary/topic/skill-note proposals. No shell, general file access, network tools, delegation, memory recall, hooks, plugins, credential access or inherited conversation are available. Include mandatory host rules and timestamped resource facts. Retain the accepted model snapshot, exact effort/verbosity options and bounded output/time budget.
5. Require each derived section or skill proposal to cite valid input identities/revisions. Validate proposed paths, total files/bytes, text redaction, dependency coverage and source freshness. Treat historical skills as reviewable suggestions; do not automatically install/execute generated scripts or grant permissions.
6. Write artifacts into an immutable generation directory. Publish one manifest listing artifact hashes, exact dependencies, scope/settings epochs, job identity and reported usage only after all validation succeeds. Reads select a complete committed manifest; partial generations remain invisible. A late result after clear or source change cannot publish.
7. On source/record edit/delete/clear, invalidate dependent manifests synchronously. A later successful generation may rebuild the remaining knowledge. If inputs become empty, remove publication immediately and record a true no-output result without spending a model request just to erase files.
8. Recover interrupted jobs without speculative replay, retain charges, prune unpublished files safely and expire unsupported/stale dependencies. The authenticated memory UI exposes record review and bounded pipeline status; native tools expose validated artifact contents. A separate consolidated-artifact preview/editor is not currently part of that UI.

This reproduces the useful consolidation behavior without adopting upstream's Rust worker, SQLite-on-mounted-storage assumption, Git baseline/object retention, OS sandbox, MCP or unrestricted agent writes. A deterministic record view alone is not completion of this phase.

## Verification and release gates

The coordinator authorized the bounded local gates and synthetic live proof recorded below. No deployment credential or hosted user state was used, and deployment remains coordinator-owned.

| Gate | Required behavior evidence |
| --- | --- |
| Read-only tool service | Actual temporary filesystem records generated via an explicit scripted transport; independent generation/use; persisted child/root/workspace/purpose gates; ordinary Plan access; real list/read/search; source quotes and line offsets; literal/case/normalized/window search; unknown/traversal/symlink/malformed inputs; UTF-8 encoded byte limits; pagination and changed-query/revision stale cursors; no provider request during reads. |
| Concurrent reads | Hold an actual storage read, acknowledge opt-out/clear/delete/source invalidation, then release it. No old content may return. Reparented/changed target and source must fail closed. Restart/expiry/tampered records stay unavailable. |
| Engine integration | A scripted ordinary root calls each native tool and receives real evidence. Payload and sensitive query text are absent from saved provider input, journals, compaction, forks and child briefs. Public activity is readable and content-free. A later opt-out or deletion prevents an ephemeral payload being reused in another provider call. |
| Startup scan | Real persisted roots across replacement processes; fresh/missing/active/archived/child/pre-opt-in/cleared sources excluded; candidate and request bounds; no startup spending from Settings/router; no duplicate claim/retry; omitted per-turn model metadata handled visibly; clear/off/on/restart races and immutable charge accounting. |
| Consolidation | Real strict model/worker transcript fixture, exact dependencies, no recursive calls or forbidden tool surface, dedupe/no-change/no-output, deletion diff, atomic manifests, invalidation mid-run, partial writes, absent/conflicting mount views, startup recovery and budget persistence. Fixture results must be labelled fixtures. |
| Live proof | Coordinator-owned bounded fixed-endpoint extraction + tool read + actual consolidation on sample data, showing returned counts and resulting immutable artifacts. No live test should expose or reset existing user data. A provider refusal/failure is reported as such. |

The implemented startup/extraction/consolidation/native-tool scope now passes the composed local gates and one real fixed-endpoint flow. Cross-workspace scope, explicit model-facing ad-hoc notes, counted memory citations/usage-ranked retention, a dedicated artifact preview/editor, and v1/v2/import/configuration differences remain explicitly outside this implementation. None is represented by a fabricated tool or an unsupported parity claim.

## Implemented lifecycle and storage

The pipeline modules are `server/memories/native-tools.ts`, `startup.ts`, `consolidation.ts` and `pipeline-types.ts`; shared admission/source fences are in `server/agent/memories.ts`. `server/agent/memory-engine.ts` owns construction, activation, logout/goal/workspace fences and shutdown; `memory-runtime.ts` owns private request overlays. The authenticated `memory-pipeline-router.ts` exposes bounded workspace status without spending a request.

Construct one startup scheduler and one consolidator alongside the shared memory service, before exposing memory mutation routes. The consolidator registers the awaited derived-file invalidation hook on that same service; creating a separate memory service for the router would bypass this ordering and is unsupported. All initialization below is local recovery only:

```ts
const memories = getNativeMemories(ctx, runtimeOptions);
const startup = new NativeMemoryStartup(ctx, memories);
const consolidator = new NativeMemoryConsolidator(ctx, memories);
const memoryTools = new NativeMemoryTools(memories, consolidator);

await memories.initialize();
await startup.initialize();
await consolidator.initialize();
```

After a newly activated ordinary root and its exact turn options have been persisted, schedule the following outside foreground engine admission. Pass actual server-owned thread/workspace identity and the effective root model/effort. Do not call this sequence from router construction, Settings, GET handlers, polling, reconnect, or service initialization:

```ts
const report = await startup.schedule(rootContext);
await memories.waitForExtractions(rootContext.signal);
const job = await consolidator.run({ ...rootContext, model, reasoningEffort });
```

`waitForExtractions` only waits for already accepted extraction work. It is abortable and does not create/retry requests. Without it the consolidator may truthfully report `busy` while extraction owns the shared lane. Initialization and status inspection are never implicit permission to resume an interrupted request. Stop the startup scheduler and consolidator during engine shutdown, then stop the shared memory service; their signals stop work without publishing late results. The engine must report optional storage/pipeline failures visibly without failing ordinary foreground work.

Startup exports `schedule(context)`, `initialize()`, `status()` and `shutdown()`. Its report identifies bounded counts and fixed issues; no transcript text is copied. The concrete scan inventory is limited to 100,000 directory entries, 128 metadata rows, two admitted turns, 4096 turn checks, 32 MiB per source and 64 MiB of scanner-owned source reads per pass. Admission's source revalidation has its own existing bounds. The report/cursor file is `memories/startup.json`; it holds up to 128 workspace cursors and 16 recent reports. Cursors continue both metadata pages and partially visited multi-turn sources. Only newly admitted turns count toward the two-turn limit; known jobs and uncertain admission markers are skipped. Persisted model/effort must match again at admission and provider request/commit. Missing legacy options are reported and never inferred from `lastRunOptions`.

The consolidator exports `run(input)`, `initialize()`, `jobs(workspaceId?)` and `shutdown()`, plus trusted artifact-reader hooks used by `NativeMemoryTools`. It is a real isolated **tool-free structured Responses worker**, not the upstream open-ended filesystem-editing agent. It proposes cited summary/topic/skill blocks, and the server verifies every source ID/revision and exact quoted record text before rendering/publishing Markdown. This verifies provenance, not arbitrary semantic entailment. Optional skill output is plain reviewable Markdown; no scripts, hooks, plugins or executable assets are installed. Cross-workspace global-user memory is not enabled: consolidation spans validated conversations in one workspace and the scheduler serializes workspace jobs.

Consolidation selects at most 64 valid records in 128 KiB. Its output limit is 8192 tokens/64 KiB and 60 seconds; artifacts are capped at 70 files, 128 KiB each and 256 KiB total. These are application limits, not provider capacity claims. Exact paths are `memory_summary.md`, `MEMORY.md`, `rollout_summaries/<thread-id>.md`, and `skills/<slug>/SKILL.md`. The source-summary files render genuine supporting records/quotes; semantic summary/topic/skill text must come from the real model response. A valid empty response produces no fake summary or skill.

Storage is ordinary plaintext beneath the existing memory directory:

- `consolidation-jobs/`: bounded job state, source identities, exact model/effort and reported provider usage; no raw response or copied parent history.
- `consolidation-artifacts/` and `consolidation-manifests/`: immutable generation files and their exact dependency/artifact hashes.
- `consolidation-heads/`: per-workspace complete-publication references. A head is unusable until its matching job completed and all artifact/source hashes validate.
- `attempts/`: content-free request-attempt markers created before charges, preventing orphaned charge receipts from becoming replayable after the rolling receipt is pruned.

Markdown paths are logical read-tool paths. Persisted artifacts are immutable JSON envelopes containing the Markdown and its job/workspace identity; this implementation does not place executable `SKILL.md` directories in the application extension installer or the user's project. This distinction must remain visible in any broader file/skill parity claim.

Extraction and consolidation share the existing 24 admitted requests per rolling day and one active model lane; consolidation also has a two-request daily sub-limit. Failed requests and uncertain attempts are not refunded by Clear. Attempt markers retain 97 days of admission knowledge; completed source turns older than ten days are ineligible for new capture, so pruning cannot make old eligible startup work look fresh. Existing legacy charge receipts are converted to attempt markers before their 48-hour pruning. Provider usage is saved on the relevant job when a response reports it, including invalid model-output failures. A timeout/transport abort without a response leaves token counts unknown. These background costs are **not** silently added to conversation or goal token totals. Clearing fact/job summaries can remove their old displayable usage; content-free admission accounting still enforces the budget.

The native tool adapter now accepts the optional consolidator and can browse committed artifact paths as well as record views. Artifact payloads keep the same 12 KiB encoded return limit and final root/use/source checks. Pagination binds the artifact generation as well as record revisions. Current-source, other-workspace, stale or invalid dependencies hide the entire affected artifact generation; native children never receive it. Read offsets are bounded to 65,536 so large committed Markdown files can still be inspected in small pages. A directory listing alone does not count as actual use of every memory underneath it.

The 2026-09-20 completion fixes a real composed regression: queued/running/failed consolidation metadata had cleared otherwise valid request-local recall, causing ordinary roots to receive no remembered facts. Metadata events now leave valid records alone, successful record publication still revokes old snapshots, and artifact publication has its own tool-cache fence. Tests cover actual extraction/consolidation progress, successful publication immediately after final service validation, and continued rejection after opt-out, delete, edit, source change, stop and logout. Memory helpers now receive the same server-owned timestamped cgroup/filesystem resource observations as ordinary agents, with a post-observation abort check.

The final local gate passed **248/248 tests across 12 suites** on 2026-09-20; its peak observed cgroup charge was 3,881,259,008 bytes. The real proof completed at **2026-09-20T18:25:06.075Z** using `gpt-5.6-luna` / `low`, exactly four HTTPS attempts to the fixed `/api` endpoint, at most 1,500 output tokens per request and 45-second request timeouts. A genuine AgentEngine source turn led to one cited preference, real `memory_summary.md` and rollout-summary artifacts, a validated native artifact read, and a correct separate-root answer. Startup/status recovery spent no request; the proof reused the accepted source activation for consolidation and did not claim a simulated six-hour idle scan as live evidence. Saved input/journals excluded the recalled overlay. Reported usage was **28,261 input + 327 output = 28,588 tokens**, including **5,661** for extraction/consolidation. The source/report and exact gate paths are recorded at the top of this document. Owned synthetic storage was removed only after the report was written and read back successfully.

Remaining whole-release work is the coordinator's integrated typecheck/build, composed browser acceptance, exact-source synchronization and deployment verification. Those gates are separate from this worker's local/live memory evidence. No complete upstream-parity or newly deployed-site claim is made here.
