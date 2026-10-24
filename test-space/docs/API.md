# Anthropic Messages API

Base URL: `https://alvin3y12-test.hf.space/api`. Authentication: `x-api-key: <PASSWORD>` or `Authorization: Bearer <PASSWORD>`.

- `POST /v1/messages`: text, streaming, native client tools, tool results, and linked user turns. Supports explicit connected Claude model IDs. Requests from Claude Code may include `?beta=true`.
- `POST /v1/messages/count_tokens`: conservative local text estimate. It is not an Anthropic billing count.
- `GET /v1/models`: connected Claude model IDs.
- `HEAD /api/hello`: best-effort Claude Code connection probe.

The root `/` returns only `status: ok`. Dashboard administration remains under `/auth`, `/dashboard`, `/admin`, and `/login`.

The client supplies the full Anthropic message history. The bridge recognizes a continuation by the Claude Code session header and its prior assistant response. A `tool_result` with a matching `tool_use_id` resumes the pending website completion through the account's native `/tool_result` endpoint. Requests that do not continue the previous history start a new Claude conversation. A pending tool call holds one of its account's slots until it finishes. If the client abandons it and sends a new message, the bridge closes it and replays the history.

The bridge maps text, client tools, web search with citations, thinking summaries, images, and documents. Exact token accounting and prompt caching are not represented. Forced tool choice is sent to Claude as an instruction.

## Bridge additions

Responses include `x-bridge-account` (the serving account) and `x-bridge-route`: `new`, `linked`, `handoff`, or `tool_result`. Send `x-session-id` to group requests into one conversation without relying on history matching.

Admin routes (dashboard cookie): `GET /admin/status` returns accounts with usage windows and statistics, totals, daily counts, and recent requests. `GET /admin/requests?limit=&source=&status=` returns the request log. `DELETE /admin/requests` clears it. `POST /admin/accounts/{id}/refresh` checks an account's usage now.
