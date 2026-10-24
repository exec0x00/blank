# Provider-public reasoning summaries

The agent requests a public reasoning summary when its caller supplies `ModelRequest.onReasoningSummary`. The existing fixed Responses request adds `reasoning.summary: "auto"` while preserving the selected model and raw effort. Requests without a summary consumer, such as automatic titles, retain their existing payload. Non-reasoning requests do not gain a reasoning parameter.

The provider decides whether a public summary is available. A successful response with no summary produces no summary callback and no invented thought text. The implementation does not decode encrypted reasoning, expose raw reasoning text, or derive a summary from hidden content. OpenAI documents the public summary option separately from raw reasoning. [Official reasoning guide](https://developers.openai.com/api/docs/guides/reasoning).

## Transport contract

`ReasoningSummaryEvent` is `{ itemId, summaryIndex, type: 'delta' | 'complete', text }`. `delta` appends a fragment. `complete` replaces that part with the authoritative full text; clients must not append it again. A final-only summary produces a `complete` event without artificial fragments. Empty terminal text can retract a previously streamed part, but an absent or empty summary does not create a new visible block.

| Provider surface | Handling |
| --- | --- |
| `response.reasoning_summary_text.delta` | Stream the public fragment, keyed by item and summary index |
| `response.reasoning_summary_text.done` | Replace with authoritative public text |
| `response.reasoning_summary_part.added` | Associate the part and retain an optional public initial prefix |
| `response.reasoning_summary_part.done` | Read only a `summary_text` part and complete it |
| Reasoning `output_item.done` with `summary` | Complete public summary parts, including providers that send no deltas |
| Full `response.completed.output` reasoning `summary` | Preserve final-only summaries or authoritative corrections |
| Empty completion `output` with earlier completed items | Keep the already observed public parts without replaying them |
| `response.reasoning_text.delta`, reasoning `content`, `encrypted_content` | Never sent to the summary callback |

Provider item IDs are preserved when available. If a stream initially supplies only an output index, a stable response-local fallback identity is used; a later provider ID binds to that same identity to avoid duplicate UI blocks. Repeated delta sequence numbers and identical terminal summary snapshots are deduplicated. Unsequenced repeated text fragments remain valid text rather than being guessed away.

Normal response completion finalizes any remaining public summary fragments. Cancellation or a failed/disconnected response preserves partial data at the consumer boundary without inventing a terminal summary. The parser checks cancellation between frames, including multiple frames delivered in one network chunk. Summary parts and text lengths are bounded independently of the total SSE limit.

## Privacy and UI boundary

The transport reports only explicit provider-public summary surfaces. Those surfaces may still contain ordinary source text or credentials echoed from a request, so the engine must apply an independent streaming secret redactor for each `(itemId, summaryIndex)` before emitting browser events or saving visible messages. A complete event must be redacted as complete text and replace the part, rather than flushing an old stream into it. Provider-encrypted reasoning remains opaque and is replayed only in the private Responses input for model continuity.

The engine/UI contract represents public summaries as their own message segments beside real tool activity. A current segment can stream while other timeline entries remain inspectable. The `/data/codexvscod/index.html` reference supplies the expandable activity presentation; its hardcoded demo file operations, shell output, and durations are not runtime evidence and are not copied into model summaries.

## Source and verification

The distinction between `ReasoningSummaryDelta`/`ReasoningSummaryDone` and raw `ReasoningContentDelta` is explicit in upstream `codex-rs/codex-api/src/sse/responses.rs`. The TypeScript port additionally accepts final-only `summary_text` snapshots and deduplicates the overlapping completion surfaces.

Focused tests use real readable SSE streams with UTF-8/chunk splitting, multiple parts and items, final-only summaries, encrypted continuity, no-summary responses, cancellation, duplicate sequences and repeated terminal events. Native HTTPS boundary tests check the exact summary request field and unchanged fixed `/api` routing. Live provider verification is recorded separately; a unit fixture never establishes that every model will supply a public summary.

A bounded live check on 2026-09-19 used the fixed service, `gpt-5.6-cyber`, unchanged `max` effort, `summary: "auto"`, and no tools. It completed in 9.432 seconds with three public parts of 56, 59, and 48 characters. Each part produced one delta and one authoritative completion; repeated terminal surfaces did not create duplicate text. The answer's streamed and final text matched. The response also contained opaque reasoning, but the verification recorded only its presence, never its value. Local evidence is `/tmp/codex-reasoning-summary-live-proof.json`; hosted UI/redaction verification is a separate integration gate.
