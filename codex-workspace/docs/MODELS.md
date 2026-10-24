# Models for the managed Responses service

The workspace sends Responses requests directly to the fixed server-side endpoint
`https://alvin3y10-api.hf.space/api`. This URL already addresses the Responses
handler; clients must not append `/responses` or `/v1/responses`. The integration
uses the service's placeholder credential. The workspace offers model and
reasoning choices, with no provider URL, API-key field, or provider-login flow.

The model list comes from exact identifiers in the existing Codex model catalog
and live requests to this endpoint. Discovery does not call `/models`, guess
hidden identifiers, configure a proxy, or copy model instructions into the app.
`shared/model-catalog.ts` contains the application registry. The evidence for this
verification is [model-probe-results.json](./model-probe-results.json).

## Verified on 2026-09-19

All 21 catalog identifiers were checked between 10:32 and 10:33 UTC. Fifteen
general text/coding entries and one dedicated review entry completed a streamed
response containing exactly `READY`. Five entries returned explicit access or
model-availability errors. One transient failure was retried once and then
completed. The artifact retains both attempts.

These fifteen entries are available for the workspace model picker:

| Model ID | Display label | Group | Model reported by the completed response |
| --- | --- | --- | --- |
| `gpt-6-astra` | GPT-6 Astra | Coding | `gpt-6-astra` |
| `gpt-5.6-sol` | GPT-5.6 Sol | Coding | `gpt-5.6-sol` |
| `gpt-5.6-terra` | GPT-5.6 Terra | Coding | `gpt-5.6-terra` |
| `gpt-5.6-luna` | GPT-5.6 Luna | Coding | `gpt-5.6-luna` |
| `gpt-5.5` | GPT-5.5 | Coding | `gpt-5.5-2026-04-23` |
| `gpt-5.4` | GPT-5.4 | Coding | `gpt-5.4-2026-03-05` |
| `gpt-5.3-codex` | GPT-5.3 Codex | Coding | `gpt-5.3-codex` |
| `gpt-5.6-cyber` | GPT-5.6 Cyber | Team Red | `gpt-5.6-cyber` |
| `gpt-daybreak-red-latest` | Daybreak Red | Team Red | `gpt-5.6-cyber` |
| `gpt-5.5-pro` | GPT-5.5 Pro | Pro | `gpt-5.5-pro-2026-04-23` |
| `gpt-5.4-pro` | GPT-5.4 Pro | Pro | `gpt-5.4-pro-2026-03-05` |
| `gpt-5.4-mini` | GPT-5.4 Mini | Lightweight | `gpt-5.4-mini-2026-03-17` |
| `gpt-5.4-nano` | GPT-5.4 Nano | Lightweight | `gpt-5.4-nano-2026-03-17` |
| `gpt-4.1-mini` | GPT-4.1 Mini | Lightweight | `gpt-4.1-mini-2025-04-14` |
| `kindle-alpha` | Kindle Alpha | Preview | `kindle-alpha` |

The groups are workspace navigation labels. They do not establish performance,
price, release status, or access through another service. In particular,
`gpt-daybreak-red-latest` resolved to `gpt-5.6-cyber` during this verification;
aliases can resolve differently later. The catalog's hidden visibility setting
does not remove the user's explicitly requested Team Red alias.

The official [GPT-5.6 Cyber model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-cyber)
names the model and documents separate Daybreak approval and provisioning for
direct OpenAI access. The successful calls recorded here establish access through
the user's configured service at the verification time. They do not establish
access for a separate OpenAI organization or project.

## Entries excluded from general selection

| Model ID | Observed result | Registry treatment |
| --- | --- | --- |
| `gpt-daybreak-blue-latest` | HTTP 403, `access_program_not_enabled` | Unavailable for this service account |
| `gpt-5.3-chat-latest` | HTTP 404, `model_not_found` | Unavailable for this service account |
| `gpt-5.2-chat-latest` | HTTP 404, `model_not_found` | Unavailable for this service account |
| `kepler-alpha` | HTTP 404, `model_not_found` | Unavailable for this service account |
| `mercury-alpha` | HTTP 404, `model_not_found` | Unavailable for this service account |
| `codex-auto-review` | HTTP 200, completed `READY`; reported `gpt-5.6-luna` | Catalog identifies dedicated approval review; excluded from general model selection |

An HTTP 404 can mean either an unknown identifier or missing account access. This
record does not distinguish those explanations. `gpt-5.3-codex` initially accepted
the request with HTTP 200 and then emitted a `response.failed` server error; its
single retry completed successfully. A failed stream is not a completed answer,
and a transient failure is not proof that the model is unsupported.

## Verification scope and reproduction

Each request contained only `Reply only READY.`, `stream: true`, `store: false`,
and `max_output_tokens: 256`. Reasoning effort was `medium` except for
`gpt-4.1-mini` and the two `chat-latest` entries, where no reasoning setting was
sent. Requests used a 90-second total timeout and at most three concurrent calls.
No workspace files, account credentials, user conversations, cyber tasks, or tools
were submitted. The saved artifact contains metadata, status, benign reply text,
token counts, and sanitized errors; it contains no request headers or secrets.

A representative direct request is:

```sh
curl --no-progress-meter --noproxy '*' --fail-with-body --max-time 90 \
  'https://alvin3y10-api.hf.space/api' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer placeholder' \
  --data '{"model":"gpt-5.6-cyber","input":"Reply only READY.","stream":true,"store":false,"max_output_tokens":256,"reasoning":{"effort":"medium"}}'
```

The completion check requires a terminal `response.completed` event and the
expected output text. HTTP 200 by itself proves only that the request was
accepted. If a future probe exhausts its small output budget, retain the
`response.incomplete` reason; do not relabel that model as unsupported.

These are streaming text smoke tests. They do not verify the agent's tool-call
round trip, all reasoning settings, context limits, pricing, quality, or future
availability. The agent runtime's tool-call verification is separate. Catalog
reasoning levels are recorded as metadata in the JSON artifact; only the effort
actually sent in each probe was exercised here. Recheck a specific known ID when
an access error or provider change warrants it, and retain the visible failure
instead of manufacturing a response.

## Scoped reasoning correction on 2026-09-20

`gpt-5.5` offers `low`, `medium`, `high`, and `xhigh` in the workspace. A single
text-only request with `reasoning.effort: "max"` to the exact fixed service
returned HTTP 400, `invalid_request_error`, code `unsupported_value`, parameter
`reasoning.effort`. The service listed `none`, `low`, `medium`, `high`, and `xhigh`
as supported values, matching the retrieved official
[GPT-5.5 model documentation](https://developers.openai.com/api/docs/models/gpt-5.5).
Because the request included no tools, this failure does not depend on image
generation. The app's existing effort vocabulary does not include `none`.

This correction removes `max` only from the exact `gpt-5.5` catalog entry. It does
not change other models or establish their complete effort capabilities. An
unsupported saved or requested effort stays explicit and requires correction;
the runtime never silently downgrades it. The original medium-effort smoke-test
artifact is preserved. See [MODEL_EFFORT_AUDIT.md](./MODEL_EFFORT_AUDIT.md) for the
bounded probe, exact sanitized evidence, implementation scope, and validation.
