# Model profiles and context accounting

Verified on **2026-09-20 UTC** against fetched official OpenAI pages and Codex CLI commit **`78245b47af2a7aafcabe025828ceecca69db4df1`** in `/tmp/codex-cli-upstream`. This is research and an implementation contract proposal, not evidence that the application's fixed model endpoint accepted every option. No model requests, credentials, provider model-list requests, tests, or builds were used for this research.

The official-domain web search tool failed with HTTP 400 (`Unknown parameter: 'id'`). The pages below were then fetched directly over HTTPS with proxy discovery disabled. The companion [JSON evidence](./MODEL_PROFILE_SPECIFICATIONS.json) records facts, provenance, capture sizes and hashes; it is not an application model catalog.

## Published capacities for the retained presets

Context means the published total context capacity. Maximum output is the model's output ceiling, **not** the application's default generation budget or a reservation to subtract from every input.

| Exact request model ID | Official context tokens | Official maximum output tokens | Publicly specified effort values | Primary source |
| --- | ---: | ---: | --- | --- |
| `gpt-6-astra` | 1,050,000 | 128,000 | `low`, `medium`, `high`, `xhigh`, `max` | [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) |
| `gpt-5.6-sol` | 1,050,000 | 128,000 | `none`, `low`, `medium`, `high`, `xhigh`, `max`; API default `medium` | [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| `gpt-5.6-terra` | 1,050,000 | 128,000 | `none`, `low`, `medium`, `high`, `xhigh`, `max`; API default `medium` | [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| `gpt-5.6-luna` | 1,050,000 | 128,000 | `none`, `low`, `medium`, `high`, `xhigh`, `max`; API default `medium` | [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| `gpt-5.6-cyber` | 400,000 | 128,000 | Reasoning supported; the exact model page does not enumerate efforts | [GPT-5.6 Cyber](https://developers.openai.com/api/docs/models/gpt-5.6-cyber) |
| `gpt-daybreak-red-latest` | 400,000 | 128,000 | Reasoning supported; the exact model page does not enumerate efforts | [Daybreak Red](https://developers.openai.com/api/docs/models/gpt-daybreak-red-latest) |
| `kindle-alpha` | Unknown | Unknown | No exact official public specification found | [Queried exact model page](https://developers.openai.com/api/docs/models/kindle-alpha) returned 404; the fetched [model catalog](https://developers.openai.com/api/docs/models) contained no matching ID |

The official [cybersecurity guide](https://developers.openai.com/api/docs/guides/safety-checks/cybersecurity) explicitly maps `gpt-daybreak-red-latest` to `gpt-5.6-cyber` for appropriately provisioned API projects. Preserve both requested IDs. This does not establish how the owner's fixed service resolves aliases or what its account can access.

Retire the Lightweight and Pro preset categories and all GPT-5.5/5.4/5.3 variants as requested. Do not silently change an explicitly selected retired model into another model. A user may create a custom profile with an explicit request ID and capabilities; that is user configuration, not a new official specification. Kindle Alpha needs a user-supplied context value before a percentage of its capacity can be calculated truthfully.

## Request options and their provenance

The [Responses create schema](https://developers.openai.com/api/reference/resources/responses/methods/create) defines `reasoning.summary` as `auto`, `concise`, or `detailed`; `null`/omission supplies no request-level summary preference. `none` is a Codex configuration sentinel for omitting the field, not a summary value to send. The schema allows `text.verbosity` values `low`, `medium`, and `high`, with an API default of `medium`. Its effort enum is a union across models; it is not evidence that every model supports every value.

The [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries) demonstrates Astra with `summary: "auto"`. `auto` selects the most detailed summary supported by that model. Public summaries are opt-in; opaque encrypted reasoning is a separate replay artifact and must never be decoded, printed, or exposed as a public summary. Cached input and reasoning output counters are subsets of their respective usage totals, not additional tokens to add a second time.

The [GPT-5.6 guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6) explicitly confirms all six efforts listed above and all three verbosity values for the family. It documents `reasoning.context` as `auto`, `current_turn`, or `all_turns`, with GPT-5.6 defaulting to `all_turns`. The [Astra guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra) carries forward GPT-5.6 capabilities but explicitly excludes `none` effort, `temperature`, `top_p`, and `top_logprobs`. A generic “extra parameters” control must not blindly send sampling controls to every model.

The pinned CLI catalog provides **additional, separately labeled Codex evidence**, not public API limits:

| Exact CLI catalog profile | Summary/verbosity capability flags | CLI default summary | CLI default verbosity | CLI default effort |
| --- | --- | --- | --- | --- |
| Astra / Sol | Both enabled | `none` | `low` | `low` |
| Terra / Luna | Both enabled | `none` | `low` | `medium` |
| Daybreak Red | Both enabled | `none` | `high` | `medium` |

See `codex-rs/models-manager/models.json` beginning at lines **4**, **174**, **304**, **429**, and **671**, respectively. Both `supports_reasoning_summaries` and `supports_reasoning_summary_parameter` are present; request construction uses the latter. Cyber and Kindle Alpha do not have exact entries in this pinned catalog. Inferring Cyber behavior through the official Daybreak mapping must remain identified as inference; it does not turn an unpublished effort list into a model-page fact.

`codex-rs/core/src/client.rs:848–866` constructs reasoning using the selected effort or model default and only includes summary when `supports_reasoning_summary_parameter` is true and the choice is not `None`. At **935–958**, the ordinary request includes `reasoning.encrypted_content` for opaque replay and only sends verbosity when `support_verbosity` is true. `codex-rs/codex-api/src/common.rs:374–391` omits the entire `text` control when no verbosity or output schema was requested. The request still uses the exact chosen model ID, `store: false`, and streaming (`client.rs:966–983`).

`codex-rs/protocol/src/openai_models.rs:56–87` supports model-defined custom effort strings. Its `ultra` and `persistent` choices have special local mappings in `openai_models/reasoning_effort.rs:10–38`; they must not be advertised as ordinary public effort values. A custom profile can retain a bounded literal wire value without renaming it to a marketing label or silently substituting another effort. Summary or verbosity support that has not been established should remain unknown or user configured.

## Codex compaction behavior to reproduce

The pinned CLI distinguishes these quantities:

1. **Resolved full capacity:** `context_window`, falling back to `max_context_window`. Explicit context overrides are capped by a known model maximum. See `protocol/src/openai_models.rs:514–516` and `models-manager/src/model_info.rs:19–30`.
2. **Usable safety budget:** `floor(fullCapacity × effectiveContextPercent / 100)`, where the default percentage is **95**. This leaves space for prompts, tool overhead and output. See `protocol/src/openai_models.rs:389–390,464–467,518–522`.
3. **Automatic compaction threshold:** `floor(fullCapacity × 0.90)`. For the default total-context scope, an explicit token threshold is capped at that value. It is not 90% of the already reduced 95% budget. See `protocol/src/openai_models.rs:525–535`.
4. **Active-context occupancy:** the last completed response's reported total tokens plus estimated local additions since its last model-generated item. It is not the sum of all earlier requests. See `core/src/context_manager/history.rs:756–787`.

The stock CLI catalog deliberately has lower harness values: Astra/Sol/Terra/Luna default to **272,000** and advertise an override maximum of **872,000**; Daybreak has **372,000** for both. Those are not the current official API capacities requested by the user. For this application use the published full capacities above, while porting the accounting and compaction behavior.

| Published full capacity | Requested default compaction at 90% | Separate CLI-style safety budget at 95% |
| ---: | ---: | ---: |
| 1,050,000 | 945,000 | 997,500 |
| 400,000 | 360,000 | 380,000 |

`core/src/session/context_window.rs:58–110` evaluates **`>=`**, accounts against total active context by default, and also checks the separate safety limit. Its optional `body_after_prefix` scope and token-budget fallback buffer are different behaviors; neither is necessary to implement the user's “90% of context” setting. If the application allows thresholds above 90%, that is an explicit user-configurable extension: display the resulting effective cap instead of claiming it is unchanged stock Codex behavior.

For previous opaque reasoning, `history.rs:730–753,769–787` adds an estimate only when the server has not already accounted for it. There is no blanket subtraction of all reasoning output, nor a deduction for cached input. The server's inclusion signal is received in `session/turn.rs:2812–2813`. The pinned transport sets that signal from the presence of the `x-reasoning-included` HTTP/upgrade header (`codex-api/src/sse/responses.rs:30,53–56,83–86`; `endpoint/responses_websocket.rs:156,280–283`). Keep the raw reported usage and its provenance intact; only estimate context that the report cannot cover. The estimator at `history.rs:516–540,890–908` is explicitly approximate and counts model-visible content instead of outer protocol JSON. Where inclusion semantics are unknown, retain a labeled conservative estimate rather than presenting a derived number as exact.

Lifetime totals and last-response totals are distinct fields in `protocol/src/protocol.rs:2270–2307`. After successful compaction, `core/src/session/mod.rs:4648–4685` recomputes an estimated occupancy for the replacement history without erasing cumulative usage. The UI should similarly distinguish reported usage, additional estimated context and current occupancy; frontend history pagination must not determine the model's active context.

Compaction runs before a new turn (`session/turn.rs:1274–1302`) and after completed sampling/tool work when a continuation needs another request (`553–641`). The pinned pre-turn path still has a TODO for pending new input (`179–182`); a safe pre-request estimate including that input is an explicit improvement. Its optional post-turn compaction keeps history replacement serialized and preserves a completed answer when compaction fails (`704–735`). The user's “every time 90% is reached” also needs a final-response boundary check, not only a follow-up-tool check.

Only replace active context after a successful, valid compaction response. Preserve the original transcript and incoming request on failure. Local compaction preserves a coherent recent user context plus a real model summary, reinjects initial context in the correct position, persists the replacement checkpoint and updates occupancy (`core/src/compact.rs:60–89,350–406`). If compacting itself exceeds context, it trims oldest paired history items from its temporary attempt and retries; do not drop unmatched tool outputs or repeatedly re-execute tools (`compact.rs:317–328`; `context_manager/history.rs:543–552`). Switching to a smaller context model has a separate pre-turn downshift check (`session/turn.rs:1392–1436`).

The pinned ordinary Responses request has **no `max_output_tokens` field** (`codex-api/src/common.rs:259–285`). It therefore does not reserve the entire advertised 128,000-token output maximum. In this app, keep `maxOutputTokens` as capacity and `defaultMaxOutputTokens` as the selected request budget, initially the existing 24,000 if desired. If a particular request requires earlier compaction to fit its input plus its chosen output budget, identify that as a separate request-capacity reason. Do not silently relabel it the configured 90% threshold.

## Concrete profile contract recommendation

Persist a stable profile ID separately from editable `displayName` and exact `modelId`. Store nullable `contextWindow` and `maxOutputTokens`; use `null` for unknown values. Keep server-owned evidence (`official`, `codex-catalog`, `user`, or `unknown`, with URL/date where applicable) distinct from user overrides. Changing an alias or capacity must not silently rewrite existing thread IDs, model IDs, or usage receipts.

Use `autoCompactThresholdPercent: 90` by default, an explicit `defaultMaxOutputTokens`, capability/value lists for `reasoningEfforts`, `reasoningSummaries` and `verbosityLevels`, and nullable default choices. Omit unsupported/unselected wire parameters. Custom options must be bounded literal values and must not enable changes to the fixed endpoint, key, tools, local host policy or system prompt. Reject malformed values and surface service rejection without automatic capability claims or silent downgrade.

Retain enough per-response context state to associate reported usage with its request/history revision and model. Recompute or invalidate the estimate on compaction, rewind, prompt/tool-schema changes, context-mode changes and model changes. Evaluate the threshold before a request and after a completed response/tool continuation, serialize compaction, and bound ineffective compaction retries. Report an unknown capacity honestly until configured.

For the context bar, format the numeric magnitude with **at most three significant digits** and decimal `K`/`M` suffixes: `3K`, `3.1K`, `3.12K`, `1.41M`. Remove trailing zeros, promote a rounded `1000K` to `1M`, keep exact counts available in the context detail, and never let compact formatting alter the actual threshold calculation.
