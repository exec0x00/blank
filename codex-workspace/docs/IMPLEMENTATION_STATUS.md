# Arc Workspace verification

## September 23 native settings and reliability update

The current source adds native MCP configuration and protected variables, current native models including GPT-6 Sol, Fast mode on by default, agent concurrency, model-aware maximum context and 90% compaction controls, searchable official configuration, inline tool output, agent navigation and separate agent/editor windows. Terminal changes cover tiny-frame backpressure, ordered resize, transient reconnect and bounded final-output drain. See [WORKSPACE_SETTINGS.md](WORKSPACE_SETTINGS.md).

Verification used the actual official Codex 0.156.1 installer and app-server with the fixed owner service. The complete local application accepted a genuine 77-byte PNG attachment, created a native GPT-6 Sol thread through authenticated HTTP, completed a Fast turn, and retained the same native thread/turn/item IDs and attachment after the native restart action. The actual Settings page loaded those real server responses without browser or API errors. Native MCP tests discovered tools from a real stdio server, supplied protected variables including `DATABASE_URL`, and proved ordinary native shell commands excluded those values. Separate persistence checks verified encrypted credential storage.

The clean JavaScript/TypeScript suite passed 2,540 tests plus the 12 required terminal/worktree lifecycle tests. The reset/gate suite passed 23 Python tests, including content-identity checks against stale backup responses. Integrated terminal/window browser checks passed all 19 cases; settings passed 21 cases, with additional chat, output, pane, and accessibility regressions checked separately. The earlier mixed-source verification failure was caused by a concurrent export edit during the running Vite test process; fresh imports in both orders and the frozen-source run resolved it without a production workaround.

The one-time storage reset is a separately authorized operator action. Its script requires a reviewed exact inventory, verified private backups and a live maintenance receipt. Startup never deletes saved data. Source, reusable configuration, account credentials and unrelated paths are outside the reset scope.

## September 22 migration evidence

The 2026-09-22 source uses the unmodified official Codex CLI for agent execution. Node supplies authenticated app-server transport and website services. Each real startup installs and verifies `@openai/codex@latest`; Settings exposes its actual version and an explicit update operation.

Local acceptance used official CLI 0.155.1 with the owner’s fixed Responses service. A real native tool created exact verified file bytes, an explicit update completed, and a fresh application/native-process startup preserved native conversation/item IDs, preferences, files and the selected conversation. Reading saved history did not load or resume the thread. Managed production policy is additionally verified by the running CLI before readiness.

The production build and TypeScript checks pass. Unit acceptance combines the complete current suite with recorded corrections and required terminal lifecycle tests; browser acceptance combines the full current collection with bounded replacement gates. Original failures, exact replacement mappings, source hashes, source backups, and the real native request receipt are preserved under `/data/codex-final-verification/20260922-cli-migration/`. They are separate from the previous TypeScript-agent release’s results. Publication receipts record the exact deployed revision and source identity.

The native child-footer scroll defect is fixed and covered by original keyboard/end-position assertions, unit regressions, native history and mixed-height conversation paging checks. General tunnels, including runlocal, SSH forwarding and localtunnel, are permitted; cloudflared tunnels remain forbidden. Model traffic continues directly to the fixed owner endpoint.

Current contracts are [API.md](API.md), [CLI_RUNTIME_POLICY.md](CLI_RUNTIME_POLICY.md), [CLI_CAPABILITY_AUDIT.md](CLI_CAPABILITY_AUDIT.md) and [CLI_RETIREMENT.md](CLI_RETIREMENT.md). Earlier custom-agent design documents are historical. Unsupported custom memory/model-profile/probe/plugin-execution/checkpoint controls have been removed. Native browser and realtime UI are omitted. Editor, real PTYs, workspaces, GitHub, uploads/downloads and read-only legacy conversations remain available. Source publication does not reset application data, saved accounts, secrets or history.
