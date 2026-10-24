# Architecture

`app.py` handles the Space password, dashboard, account management, and Anthropic-format HTTP routes. `pool.py` owns connected accounts and usage-aware selection. `anthropic_api.py` maps Messages requests and streams to Claude's private browser completion route. `upstream.py` holds the Claude session client and protobuf route used by supporting account diagnostics. `persist.py` reads and writes session keys from the Space's mounted private bucket.

The browser completion request includes a Claude conversation UUID, explicit model, parent assistant message UUID for linked turns, and native client tool declarations. Its SSE stream emits text and tool blocks. `BrowserTurn` keeps the upstream stream open when a client tool call is yielded to Claude Code. The following client `tool_result` is posted to the same conversation's `/tool_result` path, and the original SSE stream continues. Once a normal turn completes, the account is released to the pool. New chats create new Claude conversation UUIDs.

The browser route is private and changes independently of the public Anthropic Messages API. A live native tool round trip was verified against a connected account before deploying this conversion.

`usage_store.py` records each request and the usage windows Claude reports in its `message_limit` stream events. It writes them atomically to `usage.json` in the bucket. Each account takes a fixed number of concurrent completions. Each conversation has its own lock, so one slow conversation cannot block others. When a linked account is limited or disconnected, `AnthropicBridge.prepare` hands the conversation off by replaying its history on another account.
