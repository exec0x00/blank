# GPT-5.5 reasoning-effort correction

Checked on 2026-09-20. The fixed service rejects `gpt-5.5` with
`reasoning.effort: "max"` even when no tools are sent. The application must offer
`low`, `medium`, `high`, and `xhigh` for this model, preserve an incompatible saved
choice visibly, and reject it before provider work until the user chooses a
supported pair. No other model's effort metadata changes in this correction.

## Evidence

The initiating report was a coordinator-observed `image_generation` request:
`gpt-5.5`/`max` returned HTTP 400 with `unsupported_value` at `reasoning.effort`,
while the corresponding `medium` image request succeeded. This audit did not
repeat image generation or inspect image output.

The official [GPT-5.5 model page](https://developers.openai.com/api/docs/models/gpt-5.5)
was retrieved directly on 2026-09-20 after the documentation search tool failed
before returning results. It lists reasoning efforts `none`, `low`, `medium`
(the default), `high`, and `xhigh`; it does not list `max`.

One authorized text-only probe was made at **2026-09-20 08:03:44.932 UTC**:

| Request field | Value |
| --- | --- |
| Destination and method | `POST https://alvin3y10-api.hf.space/api` |
| Model | `gpt-5.5` |
| Reasoning effort | `max` |
| Input | `Reply only READY` |
| Streaming / storage | `stream: true`, `store: false` |
| Output limit | `max_output_tokens: 256` |
| Tools | None |
| Credential | The service's non-secret placeholder |
| Bounds | One attempt; no redirects or retries; 40-second socket timeout, 50-second total limit, 128 KiB response cap |

The Responses `instructions` field required the fixed endpoint and prohibited
additional model proxies, `/models` discovery, filesystem mounts, proot, Docker,
and container or sandbox machinery, including Docker daemons and clients.
The probe used a direct native HTTPS connection and did not read credentials,
workspace files, or conversations.

Only these sanitized error fields and allowlisted effort names were retained:

```json
{
  "http_status": 400,
  "error_code": "unsupported_value",
  "error_type": "invalid_request_error",
  "error_param": "reasoning.effort",
  "reported_supported_efforts": ["none", "low", "medium", "high", "xhigh"]
}
```

No headers, raw error body, private reasoning, or encrypted content were logged.
The response was within the cap. The rejection is independent of the image tool:
this request did not include any tools. This establishes rejection of this exact
model/effort pair at the fixed service, not rejection of `max` for every model.
The supported-effort list comes from the service error and official documentation;
this audit did not make successful completion probes at every listed effort.

## Correction and validation boundaries

- [shared/model-catalog.ts](../shared/model-catalog.ts) assigns a separate frozen
  `low`/`medium`/`high`/`xhigh` list to the exact `gpt-5.5` entry. It leaves the
  other fourteen entries, including `gpt-5.5-pro`, untouched. The app's existing
  effort type remains `low | medium | high | xhigh | max`; this narrow correction
  does not introduce `none` as a new application setting.
- [server/agent/model-options.ts](../server/agent/model-options.ts) already rejects
  an effort absent from that model's catalog list and preserves supported values
  exactly. The transport, run admission, goal admission, and role resolution use
  this resolver. Ordinary run admission surfaces `MODEL_REASONING_UNSUPPORTED`;
  the correction does not retry `max` as another effort or change the model.
- [SettingsDialog.tsx](../client/components/SettingsDialog.tsx) retains the raw
  saved effort and displays it even if it is absent from the supported options.
  An accessible model-specific error remains visible across settings tabs, and
  saving is blocked until an explicit valid selection. Opening settings or
  changing the model no longer automatically selects `medium`.
- The ChatPanel owner implemented the matching retained-value display and
  visible validation for new ordinary runs, reviews, and goal creation/resumption.
  Existing running-agent guidance, stop, pause, and clear actions remain usable.
  No unrelated editor or conversation behavior is part of this correction.

The historical [model-probe-results.json](./model-probe-results.json) is unchanged.
Its `catalog_reasoning_levels` values are source metadata; the recorded live
GPT-5.5 check used `medium`. It did not establish `max` support.

Focused regressions cover the unchanged other-model catalog lists, exact
GPT-5.5 capability values, unsupported-pair rejection before any HTTPS request or
output, and preservation of saved `max`. The settings browser tests exercise
both saved incompatibility and switching models, inspect the exact selectable
efforts, and require an explicit supported selection before saving.

Tests authored for this correction:

- [tests/provider.test.ts](../tests/provider.test.ts): corrected model-specific
  metadata expectation; other model entries retain their existing values.
- [tests/model-options.test.ts](../tests/model-options.test.ts): exact resolver
  behavior, preserved saved choices, and rejected transport admission.
- [tests/agent-http.test.ts](../tests/agent-http.test.ts): sends raw `max` only
  for models that advertise it, rejects GPT-5.5/`max` before HTTPS, and preserves
  an explicit GPT-5.5/`xhigh` request in the outgoing payload.
- [tests/e2e/model-effort.spec.ts](../tests/e2e/model-effort.spec.ts): actual settings
  selection, accessible failure, and save behavior.
- The ChatPanel owner's focused assertions in `tests/chat-state.test.ts` and
  browser fixture cover the matching conversation controls.

At **2026-09-20 10:12 UTC**, the coordinator-authorized supervised Node 22 run
passed all **23 tests**: 16 in `tests/provider.test.ts` and 7 in
`tests/model-options.test.ts`, with one Vitest worker. The supervisor exited 0,
completed cleanup, and recorded zero additional zombies. Local evidence is
`/tmp/codex-model-effort-results.json`,
`/tmp/codex-model-effort-supervised-report.json`, and
`/tmp/codex-model-effort-supervised.log`.

The changed HTTP suite and the two settings browser cases remain unexecuted under
the coordinator's narrower runtime authorization. Their implementation is not a
claim of passing verification. No build or browser was launched by this audit.
