# Limits and known mappings

The maximum HTTP request is 16 MiB. Up to 128 client tool definitions are accepted. Each message can carry up to 20 attachments of up to 30 MB each. Images larger than 2000 px on an edge are resized.

Each account serves up to `ACCOUNT_CONCURRENCY` completions at once (default 3). When every account is busy, a request waits up to 5 minutes for a free slot. Requests from different conversations never wait on each other. Requests for the same conversation run in order.

Claude throttles a client that runs more than about four completions at once. It returns 429 with `retry-after: 0` for every account, and keeps extending the throttle while rejected requests arrive. The bridge therefore limits open upstream completions across all accounts to `MAX_STREAMS` (default 3). Turns waiting on a client tool result do not count toward this limit. Extra requests queue for up to 5 minutes. Starts are spaced `START_INTERVAL` seconds apart (default 1). Rejected attempts count against the same budget, so after a throttle the bridge sends nothing until a shared pause ends. The pause starts at 20 seconds and doubles up to 2 minutes while throttles continue. Queued requests then start one at a time, first come first served, with at least 10 seconds between starts, and the spacing recovers as requests succeed. A request waits up to 5 minutes before it returns a retryable 429.

A usage-limit 429 carries a reset time. That account alone cools down until then, and the request moves to another account. Accounts at their usage limit are skipped until their window resets.

Forced `tool_choice` is passed to Claude as an instruction, because the website route has no forced mode. Token counts are local estimates. Public API prompt caching is not mapped.

A streaming request that has to wait starts its response at once and sends SSE comment lines (`: queued {...}`) every few seconds, so proxies keep the connection open. Clients ignore SSE comments. When it starts, a `: bridge {"account":...,"route":...}` comment names the serving account. A request whose client disconnects while queued gives up its place.

Images inside a `tool_result` cannot go through Claude's tool-result channel. When one arrives, the bridge ends the waiting turn and replays the conversation with the image uploaded. The 20 most recent attachments are kept.
