# Native code review

`server/agent/review.ts` implements preparation and validation for a real model-backed code review. This is separate from the workspace's Keep/Undo change ledger. It does not make model requests, return simulated findings, mutate Git, execute repository programs, or change files. The native agent engine supplies the managed streaming Responses turn and enforces read-only tools throughout that turn and any delegated explorers.

The reference is the preserved official Codex source at commit `78245b47af2a7aafcabe025828ceecca69db4df1`:

- `codex-rs/prompts/templates/review/rubric.md`: actionable introduced defects, priorities, concise inline comments, applicable project-rule attribution, correctness verdict, and structured output.
- `codex-rs/prompts/src/review_request.rs`: current changes, merge-base comparisons, specific commits, and custom review instructions.
- `codex-rs/core/src/tasks/review.rs`: a distinct read-only review turn and structured final output.
- `codex-rs/protocol/src/review_format.rs`: displaying the explanation and individual findings.

The TypeScript module preserves those review concepts, with a smaller locally written rubric and explicit validation of actual captured files and line ranges. The upstream license and notices remain in the project's source archive. MCP is not involved.

## Targets

The exported `ReviewTarget` is the form/API contract:

```ts
type ReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title?: string | null }
  | { type: 'custom'; instructions: string };
```

| Target | Captured evidence |
| --- | --- |
| Current changes | Separate `HEAD → index` staged patches, `index → saved working files` unstaged patches, and non-ignored untracked files. A staged defect is retained even when a later unstaged edit reverses it. Intent-to-add files are unstaged additions, rather than invented staged empty files. Unborn branches are supported. |
| Base branch | The actual single merge base between the current commit and an existing local or remote-tracking branch, compared with tracked saved working files. This follows the upstream prompt's `git diff <merge-base>` behavior, including tracked uncommitted edits. Untracked files are outside this comparison. |
| Commit | The resolved immutable commit against its first parent. A real root commit uses an empty tree. The actual commit headers identify parents, so a shallow-history boundary is not mistaken for a root commit. Context reads use the selected commit, even if the checkout has since changed. |
| Custom instructions | The current-changes snapshot with an additional user-supplied review focus. This bounded implementation requires changes in a Git workspace; it is not a free-form audit of an entire unchanged folder. |

Branch names are bounded to 240 characters and must resolve locally to a branch. No fetch occurs. Commit identifiers must be 7–64 hexadecimal characters and resolve unambiguously to a local commit. Custom instructions contain 1–8,000 trimmed characters. Registered managed worktrees use checked ownership records, native Git links, and the exact checkout/admin/common-directory identity for review preparation and historical Git context. Unowned or external linked repositories and unmerged working indexes receive visible errors. An explicit historical commit remains reviewable while the current index has conflicts.

Renames are represented by a deletion and an addition. Gitlink changes appear as opaque metadata. Existing submodule working directories are never entered. Git's skip-worktree and assume-unchanged flags retain indexed contents in working comparisons and context reads; a sparse checkout omission is not a deletion. Binary or invalid-UTF-8 file contents have no invented text line locations. Git paths with invalid UTF-8 or unsafe components are rejected.

## Snapshot preparation

```ts
const prepared = await prepareReview(ctx, workspaceId, target, { signal });
```

The module uses argument-array Git subprocesses only for ref, index, tree, and object reads, including an explicitly cached object-only diff to respect intent-to-add semantics. It deliberately does not request a working-tree diff or status: those operations may execute a repository's configured clean/process filters. It reads saved file bytes itself and generates unified patches. Git's clean/smudge/textconv filters are not applied, so the evidence reflects actual raw workspace and stored object contents.

Git subprocesses receive an allowlisted environment, exact workspace trust, disabled hooks/fsmonitor/credential helpers, no inherited secrets or proxies, and disabled network protocols/lazy fetching. They have bounded output and lifetimes. Git stderr is never copied to model or client responses because a repository may include credentialed remotes or private paths in errors. Objects are checked against their SHA-1 or SHA-256 identifiers after being read.

The native `/data` mount remains the only storage arrangement; review code never mounts anything. Plain workspace files remain unencrypted as requested.

Working-file reads reject parent directory symlinks, avoid following leaf links, validate opened descriptors before reading, and capture file content hashes. A leaf symbolic link is reviewed as its link text, including when its target is outside the workspace; the target's bytes are never read. A second pass checks every inspected tracked/untracked file, index listing, and `HEAD`. Concurrent changes fail preparation instead of producing a partial review.

`PreparedReview` contains:

- `id`, `workspaceId`, `target`, and `label`.
- `snapshot`: `{ createdAt, fingerprint, head, base, commit }`.
- `files`: `{ path, source, change, oldMode, newMode, oldVersion, newVersion, oldLines, newLines, oldRanges, newRanges, binary, diff }[]`.
- `workspacePath`, `prompt`, `instructions`, and `outputSchema` for server-side execution.

`source` is `staged`, `unstaged`, `untracked`, `base`, or `commit`. Versions are SHA-256 hashes of captured raw content. Active buffers and revision trees live in process memory associated with the prepared object. The engine can persist the bounded portable record described below separately from public thread summaries. Do not persist the server-only prompt, absolute workspace root, or runtime objects. Process restart interrupts the executing review turn; a saved snapshot remains available for historical source inspection.

## Portable historical source

```ts
const saved = serializePreparedReview(prepared);
// Persist saved in a separate server-side review record through ctx.store.
const restored = await restorePreparedReview(ctx, workspaceId, saved, {
  expectedReviewId: requestedReviewId,
  signal,
});
```

`SerializedPreparedReview` is a version-1 plain JSON record containing the review/workspace identifiers, target, label, capture metadata, original limits, and each changed file's metadata plus exact `oldContent`/`newContent`. Ordinary source stays UTF-8 text. Binary or control-heavy data uses base64 solely to preserve its bytes within a bounded JSON envelope; this does not encrypt workspace files. The raw capture limit remains 16 MiB, with a 32 MiB maximum JSON envelope for encoding and metadata. Missing file sides remain explicitly null.

The record contains no generated absolute root, runtime instructions, model schema, transport settings, or API credentials. It is ordinary workspace state under the user-requested public native bucket, like the rest of the unencrypted source/history; authenticated application routes control the app's historical viewer. The controller owns persistence and access checks.

Restoration validates the format version, review/workspace identities, relative paths, source/target relationships, byte budgets, SHA-256 content hashes, capture metadata checksum, modes, line counts, and changed ranges. It checks the preserved patch against the preserved bytes at the exact recorded positions, including CRLF/BOM/final-newline behavior. This linear validation never applies a patch to disk or performs fuzzy searches through current code, and does not regenerate historical hunk locations using a newer diff algorithm.

The registered workspace may move while retaining its identity. Captured changed files remain readable even if the live file or `.git` directory was deleted. Restoration never substitutes current file or index contents. Unchanged surrounding code can be read only from the saved immutable commit/head/base hash when that side is known. Uncaptured working/index context returns `REVIEW_CONTENT_NOT_CAPTURED`; unavailable historical objects return `REVIEW_CONTEXT_UNAVAILABLE`. The changed-file capture itself remains usable in both cases. Transient surrounding files read during the original run are not included in the durable changed-file capture.

New findings include `codeLocation.source` to disambiguate staged and unstaged versions of one path, plus `codeLocation.version` for the exact captured side's SHA-256. Historical navigation forwards the source and can compare the returned version with the finding before displaying it. Restored snapshots reject ambiguous legacy requests with `REVIEW_SOURCE_REQUIRED`; the controller can require the same behavior for active snapshots with `requireExactSource: true`. The private JSON payload is not embedded in public thread responses.

## Engine integration

The engine integration uses the existing fixed Responses transport, model selection, raw reasoning level, streaming events, stop control, and durable thread transcript. There are no provider, endpoint, API-key, or login controls in this feature.

1. Validate and prepare the target under the selected workspace.
2. Start a dedicated review turn with `prepared.instructions`, applicable project instructions, and `prepared.prompt`.
3. Pass `prepared.outputSchema` as the transport's structured output schema. Include read-only file/search tools plus `readReviewFileTool` and `getReviewDiffTool` as appropriate.
4. Enforce the review's read-only policy in tool dispatch, not only in prompts. A review cannot run shell commands, mutate files, grant approval, or delegate a writing worker. Preserve the thread's normal mode for later user turns.
5. Parse only the completed final model text using `parseReviewOutput(text, prepared)`. Persist and display that result with the originating review identifier. A cancellation, transport failure, invalid structured output, or process restart is not a clean review.

The coordinator owns the thread route/shared type/SSE wiring. The agreed route is `POST /api/threads/:id/review` with `{ target }`; a running review uses the existing stop behavior and emits a `review` event. Shared thread metadata distinguishes `running`, `completed`, `invalid`, `error`, and `cancelled` states. These lifecycle operations are not implemented by the preparation module itself.

The two exported strict function tools dispatch to:

```ts
await readReviewFile(ctx, prepared, path, {
  source, side, offset, limit, signal,
});
getReviewDiff(prepared, { path, source });
```

`read_review_file` returns the exported `ReviewSourceContent` type:

```ts
type ReviewSourceContent = {
  path: string;
  source: 'staged' | 'unstaged' | 'untracked' | 'base' | 'commit';
  side: 'old' | 'new';
  version: string;
  offset: number;
  endLine: number;
  totalLines: number;
  content: string;
  truncated: boolean;
  nextOffset: number | null;
  partialLine: boolean;
};
```

Offsets and line numbers are 1-based; a result with no lines has `endLine < offset`. A page contains complete lines up to the requested count/80,000-byte cap, and `nextOffset` points to the first unread line. A single line larger than the cap returns a UTF-8-safe prefix with `partialLine: true`, `truncated: true`, and `nextOffset: null`; the UI must disclose that the line is incomplete and must not claim to have paged over its remaining bytes. Blank lines and final newlines keep their actual line numbering.

For a live model review, null source selects the most recent captured source; null side prefers new content or old content for a deleted file. Reads of unchanged surrounding files use the chosen commit/index or bounded current workspace context. Captured changed files stay immutable even if the live file changes afterward. Restored snapshots use only durable captured bytes or the immutable revision context described above.

The coordinator's historical route is `GET /api/threads/:id/reviews/:reviewId/file` with `path`, `side`, `source`, `offset`, and `limit` query parameters. It returns `ReviewSourceContent` behind the existing thread/workspace authentication and authorization checks. The helper's `expectedReviewId` option validates the loaded record against that route.

`get_review_diff` returns the captured snapshot metadata and actual patches, optionally narrowed by path/source. It never invokes a shell or regenerates a different patch.

## Structured findings

The managed response schema uses the upstream field names:

```json
{
  "findings": [
    {
      "title": "[P1] Keep the divisor zero check",
      "body": "Passing a zero divisor returns Infinity after the guard changes to check the numerator.",
      "confidence_score": 0.94,
      "priority": 1,
      "code_location": {
        "absolute_file_path": "src/math.ts",
        "line_range": { "start": 2, "end": 2 }
      }
    }
  ],
  "overall_correctness": "patch is incorrect",
  "overall_explanation": "The changed guard permits division by zero.",
  "overall_confidence_score": 0.93
}
```

This is a schema illustration, not a stored/model-generated result. The wire path accepts a workspace-relative path or an exact absolute path within that workspace. The parser exposes only a validated relative path in the result:

```ts
type ReviewFinding = {
  title: string;
  body: string;
  priority: 0 | 1 | 2 | 3 | null;
  confidenceScore: number;
  codeLocation: {
    path: string;
    startLine: number;
    endLine: number;
    side: 'new' | 'old';
    source?: 'staged' | 'unstaged' | 'untracked' | 'base' | 'commit';
    version?: string; // Exact captured side's SHA-256, for current-file comparison.
  };
};

type ReviewResult =
  | {
      status: 'completed';
      findings: ReviewFinding[];
      overallCorrectness: 'patch is correct' | 'patch is incorrect';
      overallExplanation: string;
      overallConfidenceScore: number;
    }
  | { status: 'invalid'; findings: []; error: string; rawText: string };
```

The parser checks required/extra fields, finite confidence ranges, priority/title consistency, actual changed file membership, real line counts, short overlapping changed ranges, and path boundaries. Deleted or emptied files can reference their old-side lines. It deduplicates exact duplicate findings and sorts by priority. A missing/null numeric priority can be recovered from the upstream `[P0]`–`[P3]` title tag. It accepts one valid JSON object inside fences/prose, matching upstream's tolerance, but rejects incomplete objects, multiple result objects, or invalid findings.

An invalid response returns no accepted correctness verdict. Its `rawText` is capped at 12,000 characters; the engine's normal secret redactor still applies before persistence/events. `formatReviewOutput` formats validated findings for plain-text transcript/history and returns the visible error for an invalid result.

Locations refer to the captured snapshot. The UI identifies old-side/source locations and opens the authenticated historical viewer, rather than treating a deleted or staged file's line numbers as current editor positions. `source` is optional only for compatibility with older stored findings; new validated results include the exact matching captured source. The model's upstream-compatible output schema is unchanged.

## Bounds and failure behavior

| Bound | Default |
| --- | --- |
| Changed file/source entries | 200 |
| Complete generated diff | 128 KiB |
| Changed file/blob | 2 MiB |
| Captured changed contents | 16 MiB |
| Portable JSON snapshot envelope | 32 MiB |
| Working bytes inspected per pass | 128 MiB |
| Tracked entries per tree | 20,000 |
| Git listing output | 4 MiB |
| One Git command | 10 seconds |
| Entire preparation | 30 seconds |
| One complex diff calculation | 1.5 seconds |
| Surrounding files read on demand | 64 |
| One tool text result | 80,000 bytes / up to 1,200 lines |
| Model review JSON | 256 KiB |
| Findings | 100 |
| Finding line range | 10 lines |

Complex diffs yield between calculation steps so terminal/API work can continue. Oversized or overly complex targets fail with a visible `413`, rather than truncating evidence and accepting an incomplete clean verdict. `REVIEW_CHANGED` is a `409` when preparation observes a concurrent change. Read failures, missing refs/history, unsupported paths, and absent changes are visible errors. Internal callers/tests may lower limits; callers cannot raise server bounds through these options.

## Validation

`tests/agent-review.test.ts` exercises real temporary Git repositories and filesystem contents. Coverage includes staged reversals, intent-to-add, sparse/assume-unchanged flags, ignored/untracked files, unborn/root/merge/shallow/SHA-256 commits, local remote-tracking refs, immutable historical context, conflicts, opaque Gitlinks, malicious Git filters, object integrity, linked Git metadata, path encodings, symbolic-link races, simultaneous edits, exact diff budget boundaries, concurrent explorer context limits, cancellation, yielding/CPU limits, and malformed outputs. Portable snapshots are also exercised across a fresh Node process, moved workspaces, deleted live files/Git metadata, binary/CRLF/EOF cases, corrupt hashes and patches, ambiguous stages, and line/byte paging boundaries. Parser inputs are explicitly constructed validation fixtures; these tests do not claim a live model ran. The engine's integration tests and a live managed-endpoint review provide that separate proof.

`tests/agent-review-integration.test.ts` runs the actual engine, AuthService, HTTP/SSE routers, Git, filesystem and durable store with only the model boundary scripted. It covers structured source reads/findings, same-origin and session checks, snapshot ownership, forbidden write/exec/patch dispatch, invalid output, preparation failures, an authenticated app restart, historical commit reads, included/excluded conversation forks, source-thread deletion, rewind preserving files and the change ledger, cancellation, and recovery after killing a separate running Node engine with `SIGKILL`. It also verifies that a read-only review child cannot restart an older Full-access sibling to write files. The coordinator and engine intersect the live root policy when admitting that sibling's work.

On 2026-09-19, the two review suites passed **96/96 tests** under Node **22.23.2** (84 module tests and 12 engine/HTTP tests).

The subsequent managed-worktree integration passed **92/92 tests** under Node **22.23.2** with one worker: eight focused regressions in `tests/agent-review-worktrees.test.ts` plus the 84 existing module tests. The focused cases verify current/base/commit reviews, restored immutable context, unchanged primary files and indexes, cross-workspace denial, and rejection of unowned links, broken ownership, redirected Git identities, and external object stores.

A separate live proof used the actual fixed endpoint with its placeholder credential and **gpt-5.6-cyber / max** on one isolated arithmetic change. In two real Responses requests, the engine executed `read_review_file` and received a validated P1 finding on the changed guard at line 2, including its exact captured source/version. The model explicitly reported that it had not run tests. Both persisted old/new views matched their captured bytes; the workspace tree, Git status, HEAD and index stayed unchanged; the change ledger remained empty. The temporary fixture was removed. This bounded run took about 12 seconds including model inference and establishes real transport/tool/schema execution, not exhaustive review accuracy. Local evidence is `/tmp/codex-native-review-live-proof-1789825245153.json`; no hosted user data was touched.
