# Accepted model requests

Application admission resolves a configured wire model ID from the durable model registry. It copies and validates the profile and selected request values into `ModelRequestSnapshot`. Every ordinary tool cycle, queued human input, admitted child, goal continuation and helper receives the applicable accepted snapshot. Editing, renaming or deleting a profile cannot change a request which has already been admitted. A new user selection resolves the current registry; a deleted selection fails visibly.

The provider destination remains the fixed owner Responses endpoint. Profiles cannot change its URL, credentials, headers, storage mode, tool permissions or local execution policy. The application does not query an upstream model discovery endpoint. Profile capability declarations for a custom model are user configuration; the service may reject them, and the app reports that rejection without trying a different model or lower effort.

`resolveModelRequest(ctx, model, options)` is the new-admission entrypoint. A positive configured `contextWindow` is required; unknown capacity returns `MODEL_CONTEXT_UNCONFIGURED` without appending a user turn or invoking a model. Incomplete profiles may still be saved and edited. `snapshotModelRequest` and `isModelRequestSnapshot` validate already accepted values without consulting mutable registry state; historical admitted snapshots remain distinguishable from new requests.

The static string overload of `resolveModelOptions` supports pure preset callers and test fixtures. It does not infer capabilities from the model's name, and application admission must not use it to bypass the durable registry.

## Selected options

| App field | Accepted values | Responses field |
| --- | --- | --- |
| `reasoningEffort` | Exact declared wire token, up to 64 characters, or `null` | `reasoning.effort` |
| `reasoningSummary` | Declared `auto`, `concise`, `detailed`, or `null` | `reasoning.summary` |
| `verbosity` | Declared `low`, `medium`, `high`, or `null` | `text.verbosity` |
| `maxOutputTokens` | Positive integer within the declared and known published capacities, or `null` | `max_output_tokens` |

An absent option inherits the accepted profile's default. Explicit `null` omits that wire parameter and remains `null` in saved snapshots. Literal reasoning effort `none` is a real model-specific value; it is not the omission sentinel and must be declared by the profile. Whitespace, URLs, undeclared effort values and malformed option fields are rejected instead of normalized into a different wire value.

Reasoning summaries are public provider summaries only. Raw, private and encrypted reasoning are never summary-level options. Callback presence does not change the selected summary level. As in the pinned Codex Responses client, requests include `reasoning.encrypted_content` for opaque stateless replay; existing redaction and public-history projections keep its contents out of browser messages and tool activity. See the exact public and pinned-source references in [MODEL_PROFILE_SPECIFICATIONS.md](MODEL_PROFILE_SPECIFICATIONS.md).

Structured output schemas and verbosity coexist in the same `text` object. Omitting verbosity must not remove a schema; selecting verbosity must not overwrite one. Stream handling, bounded schema validation, tool output validation, retry limits and exact fixed-endpoint behavior are unchanged.

The official 128,000-token output capacity is distinct from an ordinary request budget. Verified preset requests retain the app's 24,000-token default budget; Kindle retains its prior 4,096-token request budget while its unknown context still requires configuration. A user can explicitly choose a different valid budget or omit it. No full output-capacity reservation is silently introduced into context accounting. Actual Responses header presence is reported as `ModelResult.serverReasoningIncluded`; context accounting must not guess this signal from output reasoning text or subtract every reported reasoning token.

Only exact provider error codes `context_length_exceeded` and `context_window_exceeded` become a `ProviderError.code` context signal. HTTP error envelopes and failed SSE events retain this classification with a sanitized message and no automatic request replay. Free-text mentions, case variants and unrelated codes do not set it. The engine can mark the failed request for compaction at its next admission without fabricating token usage or retrying already streamed work.

## API and continuation admission

The existing authenticated run, review and goal request schemas accept `model` and the four option fields. They do not accept client-provided profiles or internal snapshots. Session checks, same-origin mutation protection, workspace admission, permissions, mode restrictions and input limits still apply. Input steered into a running conversation retains that run's accepted configuration; changing a later turn's model requires separately admitted future-turn options.

`GoalRunPolicy` stores the admitted profile and all selected options. Goal admission checks explicit choices against the engine's resolved policy. Continuation tickets compare the full saved profile and effort, summary, verbosity, output budget, mode, permission mode and skill selection; an option or profile edit cannot widen or replace an existing continuation policy.

## Native child agents and role configuration

Child policies and collaboration contexts carry the full immutable snapshot. Ordinary inheritance uses the parent's accepted snapshot. An explicit model selection, a configured default model or a role-selected model resolves from one fresh registry snapshot during new-child admission. New children require a positive context window. Existing child follow-ups and recovery retain their saved profile and continue to apply permission tightening and isolated task briefs.

Role TOML supports `model`, `model_reasoning_effort`, `model_reasoning_summary`, `model_verbosity`, `model_max_output_tokens` and `omit_model_options`. Under `[agents]`, corresponding `default_subagent_*` fields supply per-option defaults. The omission list contains up to four unique names: `reasoning_effort`, `reasoning_summary`, `verbosity`, `max_output_tokens`. Specifying a non-null value and listing the same field for omission is invalid. CLI-style `model_reasoning_summary = "none"` explicitly omits a public summary; effort `none` remains a literal capability.

Native `spawn_agent` accepts `reasoning_summary`, `verbosity`, `max_output_tokens` and `omit_model_options` alongside existing model/effort selection. Its ordinary null placeholders mean inheritance, preserving the native tool contract. The explicit omission list is how a caller requests a null wire option. Requested/default options are validated before role locks are applied; the resolved combination is validated again. The spawn result includes `model_options` with the actual selections and bounded `model_option_overrides` notices if a configured role lock replaces an explicit choice. No provider or execution permissions are granted by these options.

## Helper policy

`withModelHelperOptions` validates and copies an accepted snapshot, preserving its model, profile, effort and verbosity. A helper has its own documented output ceiling, capped by the already selected budget and actual capacity. It can explicitly omit public summaries for an invisible auxiliary task without modifying the parent request.

- Semantic compaction uses the run's accepted model options and a bounded summary contract. Helper usage is billed/accounted separately from the ordinary context checkpoint.
- Memory extraction and consolidation use the source/admitted snapshot, never current settings or a model-name fallback. Saved jobs retain that snapshot; source freshness checks compare the full saved turn snapshot. Startup skips missing or invalid turn metadata instead of guessing its historical options. Invisible memory helpers explicitly omit public summaries and retain existing structured-output and byte limits.
- Thread naming intentionally keeps the pinned Codex metadata policy: `gpt-5.6-luna`, effort `low`, at most 1,024 output tokens, a strict title schema and no public summary. A new title task resolves the current Luna profile and fails visibly if it is missing or incompatible. A genuine interrupted task reuses its accepted helper snapshot after restart. Naming is not a fallback for the user's conversation model.

No new generic sampling, private-reasoning, endpoint, API-key, arbitrary-header, service-tier or tool-concurrency controls are introduced by this change. Existing models are never assigned unsupported temperature or sampling options merely because the Responses API accepts those fields for some other model.

## Verification scope

Focused source tests cover exact payloads, null versus absent versus literal `none`, unsupported options before HTTPS, durable registry edit/deletion snapshots, positive-context admission, authenticated real-engine propagation, actual workspace file execution through a profile edit, queued steering, public-summary privacy, goal-policy conflicts and helper/delegation recovery. Their runtime status is reported by the coordinator's supervised verification gate; source presence alone is not a passing test result or live service acceptance proof.
