---
title: Claude account Messages bridge
emoji: 🔌
colorFrom: blue
colorTo: gray
sdk: gradio
sdk_version: 6.21.0
python_version: '3.12'
app_file: app.py
pinned: false
short_description: Anthropic Messages API for connected Claude accounts
---

# Claude account Messages bridge

The Space exposes an Anthropic-style Messages endpoint backed by connected Claude website accounts. The dashboard at `/dashboard` manages email sign-in, session keys, account usage, and models. Its password and API key are the `PASSWORD` Space secret. The account keys remain in the mounted private bucket through `KEY_BUCKET_PATH`.

The root path on port 7860 returns exactly `status: ok`. The API is at `/api/v1/messages` (also `/v1/messages`). Set `ANTHROPIC_BASE_URL=https://alvin3y12-test.hf.space/api` and `ANTHROPIC_API_KEY` to the Space password for Claude Code. The service also accepts `x-api-key` or a bearer token for standard Anthropic clients. `/api/v1/messages/count_tokens` returns a local estimate. OpenAI Responses, Chat Completions, and related routes are absent.

Client tools are passed to the account's browser completion route as structured tool declarations. When Claude emits a `tool_use` block, the bridge returns that block to the client, keeps the Claude completion open, and submits the client's next `tool_result` to the same conversation's `/tool_result` side channel. Linked user turns reuse the same account and conversation. If that account is limited or disconnected, the conversation is handed off: the full history is replayed into a new conversation on another account.

Web search (`web_search_*` server tools) returns `server_tool_use`, `web_search_tool_result`, and text citations. Thinking summaries are returned as thinking blocks when `thinking` is enabled. Images are uploaded to Claude, and PDFs and text documents are converted and attached.

Each account serves up to `ACCOUNT_CONCURRENCY` completions at once (default 3), and at most `MAX_STREAMS` (default 3) run upstream at once across all accounts. Extra requests queue instead of tripping Claude's burst throttle. A short throttle pauses new starts briefly and the request retries. A usage limit cools down only that account until Claude's reset time. Claude reports 5-hour and weekly usage in every response. The bridge records it from all traffic, including Claude Code and the playground, in `KEY_BUCKET_PATH/usage.json`, together with per-account statistics and the last 500 requests. The dashboard therefore shows current usage after a refresh or restart. The mounted account bucket is never replaced during source deployment. The Claude website API is private and can change. Token counts are estimates.
