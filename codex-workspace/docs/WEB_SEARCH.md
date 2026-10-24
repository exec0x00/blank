# Native hosted web search

The workspace uses the Responses `web_search` tool on the owner-supplied complete endpoint, `https://alvin3y10-api.hf.space/api`, with `Bearer placeholder`. It does not append `/responses`, discover `/models`, create another provider, use MCP, or install a local search proxy. Search executes at the fixed model service and is read-only with respect to the workspace.

The reference is upstream Codex commit `78245b4`: `codex-rs/core/src/tools/hosted_spec.rs`, `codex-rs/protocol/src/config_types.rs`, and `codex-rs/protocol/src/models.rs`. The [official Responses web-search guide](https://developers.openai.com/api/docs/guides/tools-web-search) also documents the native tool, domain filtering, cached access, action sources, and URL annotations. The supplied upstream source was read locally; the official guide was fetched directly after the documentation search tool failed. Model requests stayed on the fixed service.

## Preferences and request contract

`WebSearchMode` is `disabled | cached | live`. Normal coding requests explicitly receive `AppSettings.webSearchMode`; a missing saved value resolves to cached, the Codex default. Cached sends `external_web_access: false`, live sends `true`, and disabled omits the hosted tool. Plan mode retains read-only search. Captured Git review and goal-budget wrap-up requests disable search. Naming, semantic summarization, memory generation, and other auxiliary requests omit `webSearch` and receive no search capability. Selecting Full access does not silently override an explicit search preference. The upstream `indexed` extension is not offered as an additional unverified mode.

`ModelRequest.webSearch` accepts `{ mode, allowedDomains?, contextSize? }`. Domain filters contain at most 100 public domain names without schemes, paths, ports, or wildcards. Context size is `low | medium | high`. Normal UI controls need only choose the mode. All model requests preserve the selected model and raw supported reasoning effort.

The transport appends the native hosted tool to existing function tools and requests `web_search_call.action.sources`. Reasoning models independently retain `reasoning.encrypted_content` for stateless replay; an opted-in public-summary consumer still controls `reasoning.summary: auto`. Hosted calls are bounded to eight per response. There is no `function_call_output` for a hosted search.

## Events, history, and public output

`ModelRequest.onWebSearch` receives allowlisted `{ itemId, status, action?, error? }` snapshots. Status is `in_progress | searching | completed | failed`. Actions are `search`, `open_page`, and `find_in_page`; queries, URLs, patterns, and retrieved sources are retained when actually returned. Equivalent progress is deduplicated; final item details can enrich completed progress; delayed progress cannot reopen a finished call. Final-only responses and streams whose completion output is empty both work.

`cleanWebSearchCall` creates the bounded replay item `{ type: 'web_search_call', id?, status?, action? }`. The hosted item is replayed beside unchanged opaque reasoning and normal output messages. No provider-private fields enter its public action. Search data is untrusted historical material during semantic compaction. Retained historical items and their citations remain associated with their original turn.

The strict live follow-up below exposed a service-specific recall gap: native items and opaque state were accepted, yet the answer could not reliably name an uncited source from the prior search. The much smaller reported follow-up input suggests action source metadata was not model-visible; this is an inference, not a claim about the provider's internal implementation. The failed proof remains in this document.

`createHostedSearchContext(response.output, redact)` addresses the observed gap with a separate typed user-role context item. It contains only actual observed query/source URL/title and public citation metadata, explicitly framed as untrusted historical data rather than a new human request or instructions. Citation-only follow-up responses may add source metadata without creating a tool activity or implying another search ran. It never invents page contents or adds developer/system authority. Its stable format is `codex.web-search.metadata.v1`; the helper escapes delimiter characters, caps the note at 64 KiB, and reports omitted observations instead of cutting URLs. The engine appends the note privately after safe native output and journals it. Normal input budgeting therefore counts its real size. `isHostedSearchContext` structurally identifies these notes so semantic compaction excludes them from original/current human objectives while still retaining or summarizing their source data. Actual conversation messages, turns, and tool approvals do not acquire a synthetic human message.

`WebSearchActivityAccumulator(messageId, redact)` is the engine privacy adapter. It emits ordinary `ToolActivity` entries named `web_search`, uses local activity IDs, redacts queries/patterns/titles with the engine's known-secret redactor, and entirely drops URLs changed by redaction. `finish()` marks observed unfinished searches as interrupted, failed, or incomplete; it never invents completion. Public activity input/output contains semantic action/status/source fields, suitable for the existing activity cards.

`extractWebCitations(response.output, redact)` returns `{ url, title, startIndex?, endIndex? }[]` at the same privacy boundary. These become optional `ChatMessage.citations` and persist through normal restart recovery. Offsets reference the concatenated public message text and are omitted if redaction changed the corresponding text. Annotations arriving only in `response.output_text.annotation.added` are recovered when the relay omits the final annotation field. An explicit final annotation array, including an empty array, remains authoritative. Unknown/private annotations are discarded. Both citation extraction and historical-context creation receive the original output plus the engine redactor, before generic string redaction could turn a secret-bearing URL into a different link.

The engine also applies that URL/range policy to saved native actions and message annotations. A real fixed-service check rejected replay annotations lacking required positions with HTTP 400. `prepareWebSearchReplayInput` therefore omits only invalid/non-positional annotation objects from the outgoing request, without mutating durable input or native search/opaque reasoning items. Safe URL/title metadata remains in the stored citations and the bounded untrusted note. The corrected real request passed; both checks are preserved below.

Source and citation URLs must be public HTTP(S) URLs without credentials, control characters, ambiguous slashes, or local/private network addresses. URL validation performs no DNS resolution or server-side page fetching. Sources, queries, citations, IDs, action bytes, activity bytes, and event counts are bounded. Unsafe links are excluded rather than transformed into a different target. Raw/encrypted reasoning never appears in activity or citation callbacks.

## Real endpoint capability evidence

One initial bounded probe ran at `2026-09-19T14:12:42.045Z`. It read no provider credentials or deployment credential file. The request used the exact endpoint above and this payload:

```json
{
  "model": "gpt-5.6-cyber",
  "instructions": "Verify a harmless coding-documentation fact with the provided native web_search tool. Perform one search restricted to nodejs.org, then answer in at most two sentences with a clickable official source. Do not use any other tool. Hosting policy: never mount a filesystem, run proot, Docker, containers, sandbox machinery, or configure any proxy; use only the supplied fixed model service.",
  "input": [{ "role": "user", "content": "Search the official Node.js documentation at nodejs.org. Does AbortSignal.timeout(delay) return an AbortSignal that aborts after delay milliseconds? Include its official documentation link." }],
  "tools": [{ "type": "web_search", "external_web_access": false, "filters": { "allowed_domains": ["nodejs.org"] }, "search_context_size": "low" }],
  "tool_choice": "auto",
  "parallel_tool_calls": false,
  "max_tool_calls": 1,
  "stream": true,
  "store": false,
  "reasoning": { "effort": "max", "summary": "auto" },
  "include": ["reasoning.encrypted_content", "web_search_call.action.sources"],
  "max_output_tokens": 4096
}
```

The service returned HTTP 200 in 5,553 ms, 21,155 streamed bytes, and exactly one hosted search. Observed native progress was `response.web_search_call.in_progress`, `response.web_search_call.searching`, and `response.web_search_call.completed`, followed by its final `output_item.done`. Its completed action was a search for `site:nodejs.org/api globals AbortSignal.timeout(delay)` with 13 actual `nodejs.org` source URLs. Two separate reasoning items contained encrypted replay state; only that presence was recorded, never the encrypted contents.

Sanitized final response evidence:

```json
{
  "hostedSearchCalls": 1,
  "searchStatus": "completed",
  "query": "site:nodejs.org/api globals AbortSignal.timeout(delay)",
  "sourceCount": 13,
  "firstSources": [
    "https://nodejs.org/docs/latest/api/globals.html",
    "https://nodejs.org/download/release/latest-v25.x/docs/api/globals.html"
  ],
  "publicText": "Yes—`AbortSignal.timeout(delay)` returns a new `AbortSignal` that aborts after `delay` milliseconds. ([nodejs.org](https://nodejs.org/docs/latest/api/globals.html?utm_source=openai))",
  "citation": {
    "type": "url_citation",
    "start_index": 101,
    "end_index": 182,
    "title": "Global objects | Node.js v24.2.0 Documentation",
    "url": "https://nodejs.org/docs/latest/api/globals.html?utm_source=openai"
  },
  "usage": {
    "input_tokens": 8762,
    "input_tokens_details": { "cache_write_tokens": 4488, "cached_tokens": 0 },
    "output_tokens": 274,
    "output_tokens_details": { "reasoning_tokens": 230 },
    "total_tokens": 9036
  }
}
```

This establishes actual cached search support for the requested model and effort at that time. Live mode is represented faithfully by the documented request flag; it is not a promise of access for every model or service entitlement. Service capability failures remain visible without switching endpoints, replacing models, or synthesizing answers.

## Verification

The final focused run passed all **196 tests**: 71 helper cases, 16 hosted-transport cases, nine engine cases, and 100 existing transport/public-summary/HTTPS regressions. `npx tsc --noEmit` also passed. These cover request routing, cached/live/disabled controls, hosted progress, final-only/empty completions, stateless replay, public reasoning compatibility, citation metadata, unsafe links, known-secret redaction, bounded historical metadata, limits, cancellation, and visible failures. One aggregate launch encountered shared-host Go/esbuild thread exhaustion before loading tests; the completed rerun used bounded concurrency without changing assertions:

```sh
GOMAXPROCS=2 node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/web-search.test.ts tests/web-search-transport.test.ts tests/web-search-engine.test.ts tests/agent-transport.test.ts tests/agent-reasoning-transport.test.ts tests/agent-http.test.ts
```

The nine engine cases use real `AgentEngine`, workspace files, JSON storage, event streams, settings persistence, and a fresh engine/store restart. They verify Plan search causes no workspace edits or approval request; internal metadata does not become a human message or turn; safe citations and source context survive restart; secret-bearing URLs and stale offsets do not re-enter saved history; interrupted/failed searches remain visible; and late callbacks cannot mutate stopped threads. Only their provider boundary is controlled. Production search always reaches the fixed service, and the live proofs below exercise the real transport separately.

The activity-card integration separately passed 44 formatter checks and eight browser checks, including ten new web-search unit cases and two native-search browser cases. These cover completed-event enrichment, real query/page/find details, failures, validation parity, keyboard source navigation with a null opener, no automatic page requests, and 320-pixel layouts. Phone and desktop screenshots were inspected. The answer-citation renderer is owned and verified separately by the Chat UI integration.


## Real stateless follow-up proof

The following is sanitized output from two actual requests through the implemented transport. Opaque reasoning was retained only in process memory for the second request; the evidence contains counts and a hosted-item digest, never its private contents.

```json
{
  "timestamp": "2026-09-19T14:19:44.960Z",
  "endpoint": "https://alvin3y10-api.hf.space/api",
  "authorization": "Bearer placeholder",
  "model": "gpt-5.6-cyber",
  "reasoningEffort": "max",
  "stages": [
    {
      "label": "native-search",
      "elapsedMs": 7395,
      "searchMode": "cached",
      "inputItemTypes": [
        "user"
      ],
      "outputItemTypes": [
        "reasoning",
        "web_search_call",
        "reasoning",
        "message"
      ],
      "progress": [
        {
          "status": "in_progress"
        },
        {
          "status": "searching"
        },
        {
          "status": "completed"
        },
        {
          "status": "completed",
          "action": "search",
          "query": "site:nodejs.org/api/globals.html AbortSignal.timeout delay milliseconds",
          "sourceCount": 12
        }
      ],
      "hostedSearchCount": 1,
      "sources": [
        "https://nodejs.org/docs/latest/api/globals.html",
        "https://nodejs.org/download/release/latest-v25.x/docs/api/globals.html",
        "https://nodejs.org/download/release/v16.14.0/docs/api/globals.html",
        "https://nodejs.org/download/release/v17.8.0/docs/api/globals.html",
        "https://nodejs.org/download/release/v22.15.0/docs/api/globals.html",
        "https://nodejs.org/download/nightly/v24.0.0-nightly202503280a91e988cf/docs/api/globals.html",
        "https://nodejs.org/download/v8-canary/v20.0.0-v8-canary20230121d7063b9dab/docs/api/globals.html",
        "https://nodejs.org/download/release/v18.18.0/docs/api/globals.html",
        "https://nodejs.org/download/release/v17.7.2/docs/api/globals.html",
        "https://r2.nodejs.org/dist/v16.20.1/docs/api/globals.html",
        "https://nodejs.org/download/release/v16.18.0/docs/api/globals.html",
        "https://nodejs.org/download/nightly/v21.0.0-nightly2023050232778b8d0e/docs/api/globals.html"
      ],
      "publicText": "Yes, `AbortSignal.timeout(delay)` returns a signal that aborts after `delay` milliseconds. ([nodejs.org](https://nodejs.org/docs/latest/api/globals.html?utm_source=openai))",
      "citations": [
        {
          "url": "https://nodejs.org/docs/latest/api/globals.html?utm_source=openai",
          "title": "Global objects | Node.js v24.2.0 Documentation",
          "startIndex": 91,
          "endIndex": 172
        }
      ],
      "opaqueReasoningItems": 2,
      "usage": {
        "input_tokens": 8529,
        "input_tokens_details": {
          "cache_write_tokens": 4485,
          "cached_tokens": 0
        },
        "output_tokens": 207,
        "output_tokens_details": {
          "reasoning_tokens": 167
        },
        "total_tokens": 8736
      }
    },
    {
      "label": "stateless-followup-search-disabled",
      "elapsedMs": 46735,
      "searchMode": "disabled",
      "inputItemTypes": [
        "user",
        "reasoning",
        "web_search_call",
        "reasoning",
        "message",
        "user"
      ],
      "outputItemTypes": [
        "reasoning",
        "reasoning",
        "reasoning",
        "reasoning",
        "reasoning",
        "reasoning",
        "reasoning",
        "message"
      ],
      "progress": [],
      "hostedSearchCount": 0,
      "sources": [],
      "publicText": "- https://nodejs.org/docs/latest/api/globals.html\n- https://nodejs.org/api/globals.html\n\n```ts\nAbortSignal.timeout(250)\n```",
      "citations": [],
      "opaqueReasoningItems": 7,
      "usage": {
        "input_tokens": 393,
        "input_tokens_details": {
          "cache_write_tokens": 0,
          "cached_tokens": 0
        },
        "output_tokens": 3555,
        "output_tokens_details": {
          "reasoning_tokens": 3515
        },
        "total_tokens": 3948
      }
    }
  ],
  "passed": false,
  "replayedHostedItems": 1,
  "replayedOpaqueReasoningItems": 2,
  "hostedReplayDigest": "beba77fa36bc4e00e704b950a8128d4acfcf952f5ac89c7176854fbd2a0aaf05",
  "followupReusedSourceURLs": [
    "https://nodejs.org/docs/latest/api/globals.html"
  ],
  "followupReusedInitiallyUncitedSource": false,
  "followupCreatedNoHostedSearch": true,
  "followupHasRequestedExpression": true
}
```


## Real bounded metadata replay proof

The first strict follow-up check above failed to recover an uncited source. The following repeat keeps all native items unchanged and appends the bounded, explicitly untrusted `createHostedSearchContext` item before the next genuine user request. This records observed URLs and queries only; it does not invent fetched page content. Both calls use the same exact endpoint, model, and raw effort.

```json
{
  "timestamp": "2026-09-19T14:25:36.922Z",
  "endpoint": "https://alvin3y10-api.hf.space/api",
  "authorization": "Bearer placeholder",
  "model": "gpt-5.6-cyber",
  "reasoningEffort": "max",
  "adaptation": "Unchanged native history plus bounded untrusted observed metadata context",
  "stages": [
    {
      "label": "native-search",
      "elapsedMs": 7203,
      "searchMode": "cached",
      "inputItemTypes": [
        "user"
      ],
      "outputItemTypes": [
        "reasoning",
        "web_search_call",
        "reasoning",
        "message"
      ],
      "progress": [
        {
          "status": "in_progress"
        },
        {
          "status": "searching"
        },
        {
          "status": "completed"
        },
        {
          "status": "completed",
          "action": "search",
          "query": "site:nodejs.org/api AbortSignal.timeout(delay) aborts after delay milliseconds",
          "sourceCount": 14
        }
      ],
      "hostedSearchCount": 1,
      "sources": [
        "https://nodejs.org/docs/latest/api/globals.html",
        "https://nodejs.org/download/release/latest-v25.x/docs/api/globals.html",
        "https://nodejs.org/download/release/v16.14.0/docs/api/globals.html",
        "https://nodejs.org/download/release/v17.7.2/docs/api/globals.html",
        "https://nodejs.org/download/release/v22.15.0/docs/api/globals.html",
        "https://nodejs.org/download/release/v26.7.0/docs/api/all.html",
        "https://nodejs.org/download/release/v18.9.0/docs/api/globals.html",
        "https://nodejs.org/api/timers.html",
        "https://nodejs.org/download/nightly/v24.0.0-nightly202503280a91e988cf/docs/api/globals.html",
        "https://nodejs.org/download/nightly/v22.0.0-nightly2024031705db979c01/docs/api/globals.html",
        "https://nodejs.org/download/nightly/v21.0.0-nightly2023050232778b8d0e/docs/api/globals.html",
        "https://nodejs.org/download/rc/v18.0.0-rc.0/docs/api/globals.html",
        "https://nodejs.org/static/documents/2016-survey-report.pdf",
        "https://nodejs.org/static/documents/2018-survey-report.pdf"
      ],
      "publicText": "Yes—`AbortSignal.timeout(delay)` returns a signal that aborts after `delay` milliseconds. ([nodejs.org](https://nodejs.org/docs/latest/api/globals.html?utm_source=openai))",
      "citations": [
        {
          "url": "https://nodejs.org/docs/latest/api/globals.html?utm_source=openai",
          "title": "Global objects | Node.js v24.2.0 Documentation",
          "startIndex": 90,
          "endIndex": 171
        }
      ],
      "opaqueReasoningItems": 2,
      "usage": {
        "input_tokens": 8451,
        "input_tokens_details": {
          "cache_write_tokens": 4493,
          "cached_tokens": 0
        },
        "output_tokens": 392,
        "output_tokens_details": {
          "reasoning_tokens": 352
        },
        "total_tokens": 8843
      }
    },
    {
      "label": "stateless-followup-search-disabled-with-observed-metadata",
      "elapsedMs": 6441,
      "searchMode": "disabled",
      "inputItemTypes": [
        "user",
        "reasoning",
        "web_search_call",
        "reasoning",
        "message",
        "observed_hosted_search_context",
        "user"
      ],
      "outputItemTypes": [
        "reasoning",
        "message"
      ],
      "progress": [],
      "hostedSearchCount": 0,
      "sources": [],
      "publicText": "- https://nodejs.org/docs/latest/api/globals.html\n- https://nodejs.org/api/timers.html\n\n```ts\nAbortSignal.timeout(250)\n```",
      "citations": [],
      "opaqueReasoningItems": 1,
      "usage": {
        "input_tokens": 1050,
        "input_tokens_details": {
          "cache_write_tokens": 1047,
          "cached_tokens": 0
        },
        "output_tokens": 340,
        "output_tokens_details": {
          "reasoning_tokens": 300
        },
        "total_tokens": 1390
      }
    }
  ],
  "passed": true,
  "contextBytes": 1740,
  "contextFormatRecognized": true,
  "nativeHistoryUnchanged": true,
  "replayedHostedItems": 1,
  "replayedOpaqueReasoningItems": 2,
  "hostedReplayDigest": "1724b54f8093530d6745c49515b191c5a434312f391c89eb924c5f389b0da46c",
  "followupReusedSourceURLs": [
    "https://nodejs.org/docs/latest/api/globals.html",
    "https://nodejs.org/api/timers.html"
  ],
  "followupReusedInitiallyUncitedSource": true,
  "followupCreatedNoHostedSearch": true,
  "followupHasRequestedExpression": true
}
```


## Redacted citation replay check

A separate bounded, tool-free request checked the exact safe annotation representation used when text redaction invalidates offsets. The real fixed service received the public URL/title without stale indexes and no secret value.

```json
{
  "timestamp": "2026-09-19T14:37:15.280Z",
  "endpoint": "https://alvin3y10-api.hf.space/api",
  "authorization": "Bearer placeholder",
  "model": "gpt-5.6-cyber",
  "reasoningEffort": "max",
  "searchMode": "disabled",
  "annotation": {
    "type": "url_citation",
    "url": "https://nodejs.org/docs/latest/api/globals.html",
    "title": "Official Node.js documentation"
  },
  "passed": false,
  "httpStatus": 400,
  "error": "The model service rejected this request. Check the selected model and reasoning setting, then try again.",
  "elapsedMs": 696
}
```


## Corrected redacted citation replay check

The rejected incomplete annotation above is retained unchanged in durable metadata. The normal transport omits it from the wire and includes the bounded untrusted observed-source context instead. The following real request validates this corrected path; it performs no search or other tool call.

```json
{
  "timestamp": "2026-09-19T14:41:22.967Z",
  "endpoint": "https://alvin3y10-api.hf.space/api",
  "authorization": "Bearer placeholder",
  "model": "gpt-5.6-cyber",
  "reasoningEffort": "max",
  "searchMode": "disabled",
  "storedAnnotation": {
    "type": "url_citation",
    "url": "https://nodejs.org/docs/latest/api/globals.html",
    "title": "Official Node.js documentation"
  },
  "wireAnnotationCount": 0,
  "contextRecognized": true,
  "contextBytes": 668,
  "storedMetadataUnchanged": true,
  "passed": true,
  "publicText": "REPLAY_OK",
  "outputItemTypes": [
    "message"
  ],
  "usage": {
    "input_tokens": 247,
    "input_tokens_details": {
      "cache_write_tokens": 0,
      "cached_tokens": 0
    },
    "output_tokens": 7,
    "output_tokens_details": {
      "reasoning_tokens": 0
    },
    "total_tokens": 254
  },
  "elapsedMs": 2969
}
```
