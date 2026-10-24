# Requested outcome and verification ledger

Checkpoint: **2026-09-19 15:27 UTC**. The full objective remains active. Checked items describe implemented capabilities with existing evidence; they do not certify every subsequent source change. New main-source additions and pending release gates are separated below. See [COMPLETION_AUDIT.md](COMPLETION_AUDIT.md) and [WORK_STATUS.md](WORK_STATUS.md).

## Established requirements

- [x] Study the supplied UI references, including `/data/codexvscod` and Arc, without treating a prototype as a backend. Preserve the complete official Codex source at `78245b47af2a7aafcabe025828ceecca69db4df1`, its Apache license and notices. Archive SHA-256: `783b5d7c8927c99eff5e53d35acf65251121fcdc82a4d411fd41621735d0fcf7`.
- [x] React/Vite/TypeScript browser UI and native Node/TypeScript agent runtime with real Responses/tool execution. No Rust CLI wrapper, Gradio UI, shadcn dependency or fabricated production model replies.
- [x] Monaco tabs, versioned save/dirty/conflict handling, files/folders, search/replace, language workers, diff, uploads, binary handling and trash recovery, with actual browser/filesystem tests.
- [x] Interactive host PTYs with resize, input, bounded scrollback, multiple sessions, reconnect and persistent HOME/history. A host process is not promised to survive instance replacement.
- [x] Persistent workspaces, threads and canonical UI state; independent workspace/thread records and tombstones replace the old shared-registry problem. Local concurrency tests do not imply distributed linearizable bucket storage.
- [x] Real streaming tools, Stop/resume, Ask/Full access, plans, Keep/Undo and manual-edit protection. Hosted actual parent/two-worker/file/command/Undo evidence exists for `a785470`.
- [x] Real native children, messages/waits/interrupt/close/resume, shared review and inherited restrictions. Children start with isolated task briefs and required configuration, without parent history. Delegation activity/approvals remain inline, with no Agents panel.
- [x] Reusable project/user roles; skills/plugins/resources/imports/marketplaces/updates/rollback; actual bounded native command hooks. MCP is excluded.
- [x] Real automatic thread naming with manual-rename and restart protection; user completed-turn forks, conversation-only rewind with backup, archive/restore, manual semantic compaction, structured targeted code review, validated image attachments, durable explicit goals and public reasoning summaries.
- [x] Multiple saved GitHub accounts, repository browsing/import, per-repository selection, actual Git stage/commit/push/pull/branches. Tests use real Git and process replacement; authorization fixtures do not fabricate a production account.
- [x] Saved account credentials and selections survive logout and fresh Node processes with one workspace-password sign-in. Only credentials are protected; normal workspace files/state remain plaintext.
- [x] Public `alvin3y12/codex-workspace`, native public `alvin3y12/data` attachment at `/data`, and the requested minimal ZeroGPU Python entry point. No application-managed mounts. Durable projects/state/settings/Git/HOME/accounts remain under the native data root.
- [x] One environment password with server sessions protects REST/SSE/WebSocket workspace access and mutations; validation, bounds, same-origin protection and path/symlink checks are implemented. Secrets remain out of source/client responses/logs.
- [x] Direct fixed Responses URL `https://alvin3y10-api.hf.space/api` with server-side placeholder, no upstream `/models` request or connection-editing UI. Static catalog includes `gpt-5.6-cyber` and `gpt-daybreak-red-latest`; exact supported effort names are low, medium, high, xhigh and max.
- [x] Mandatory no-proxy/no-mount/no-proot/no-Docker/container/sandbox instructions and obvious command enforcement for ordinary runs and helpers.
- [x] Vercel black/neutral/white styling, no authored shadows/backdrop-filter, custom accessible dropdowns, distinct desktop/laptop/tablet/phone layouts, keyboard/reduced-motion/touch behavior and scrollbars that hide at idle without shifting geometry.
- [x] Fixed icon rail with navigation/Settings/Lock only; workspace switching and Go to file/Save in the main top bar; desktop Codex left, editor centre, explorer far right; no separate editor toolbar, global footer, terminal static title/connection footer or public-bucket chrome badge. Phone file navigation remains usable. Earlier live 318 desktop evidence confirms this layout.
- [x] Real public reasoning summaries and readable tool actions/results, with inspectable code/command content and no raw/encrypted reasoning disclosure.
- [x] App Download stages immutable snapshots in separate public `alvin3y12/codex-downloads`, returns direct public URLs, and cleans objects after 24 hours at startup/on schedule. The bucket is never mounted. Real hosted download/browser/SSE evidence exists for `a785470`; elapsed 24-hour retention was not claimed as observed.
- [x] Parallel implementation with explicit ownership; preserved upstream/source notices; repeatable verification, source synchronization, deployment and live-check scripts.

## Later main-source additions

These four previous gaps now have implementations. Their final integrated release remains pending.

| Capability | Implemented behavior and evidence | Pending acceptance |
| --- | --- | --- |
| Native hosted web search | Cached/live/disabled preference, real fixed-service hosted actions and citations, bounded safe replay. Actual provider search/replay checks, including retained failures and corrections, are in [WEB_SEARCH.md](WEB_SEARCH.md). | Exact final composed UI/API/provider and hosted-release gate. |
| Opt-in root memories | Independent default-off generation/use, real extraction with source evidence, persistent workspace recall, Settings review/edit/delete/clear, durable source invalidation and no recall inheritance by children. Actual extraction/recall proof in [MEMORIES.md](MEMORIES.md). | Final composed Settings/API/restart gate. This is not all upstream global memory consolidation. |
| Automatic semantic compaction | Actual model checkpoint under context/image/wire pressure, preserved objectives/current images/complete recent rounds, stale-context/cancellation protection and exact reported goal usage. No excerpt fallback. | Final exact-source engine/browser verification; distinguish helper service proof from a live automatic-driver claim. |
| Managed Git worktrees | Actual linked checkout creation, native Git/editor compatibility, top-bar management, journals, account/identity persistence, non-destructive archive/reopen and guarded clean removal. Real Git/process test evidence in [WORKTREES.md](WORKTREES.md). | Terminal/extension admission and focused shutdown/recovery checks passed. Final complete-App UI/API/browser checks and deployment remain pending. |

## Release gates

- [x] Complete terminal leases through owned-process cleanup and extension leases through project mutations/imports. Corrected focused gates passed; the earlier terminal failure remains recorded. Managed-worktree checks also verify actual PTY busy protection, application close and content-based removal refusal without changing the live index.
- [ ] Finish the exact final-candidate type/build/behavior/browser gate. Main source and integrations are frozen; actual full-App worktree and three citation cases plus the complete browser gate remain pending.
- [x] Verify the running urgent hotfix through actual hosted browser and PTY behavior; `/tmp/codex-hosted-urgent-verification/proof.json` passed with the expected `9b92ba1…` commit and no recorded errors.
- [ ] Publish/synchronize the verified final candidate and confirm its matching runtime SHA with relevant hosted recovery, accounts, sessions, downloads, interaction and HTTP-performance evidence.
- [ ] Close the full applicable outcome only after its remaining work and evidence are complete. Do not equate preserved source breadth with a literal rewrite of every upstream subsystem.

MCP and forbidden host machinery remain excluded. The browser replaces irrelevant TUI/platform rendering. Model/permission/plan/rename/skills/plugins/diff controls need not duplicate every CLI spelling. Scoped memory recall, search modes and managed-worktree concurrency limits are documented explicitly; no unsupported service capability is labelled impossible without evidence.

## Verification checkpoints

| Checkpoint | Result |
| --- | --- |
| Previous verified `318683f` | Coordinator: **1,679 tests / 63 files**, type checking and production build passed. Full browser **117/118**; stale removed Expand-navigation expectation corrected and targeted rerun passed. Live desktop proof: `/tmp/codex-318683f-live-ui-proof.json`. |
| Urgent hotfix `9b92ba1b07f382855f3c8f76f6f8a947213792e4` | **34/34** exact-source normal-security browser checks passed in `/tmp/codex-urgent-hotfix-browser-results/gate.json`; Source/runtime now match with stage `RUNNING`; **31 hosted deployment/download checks** passed and reviewed public assets match. `/tmp/codex-download-hotfix-deployment-proof.json` records the source-only update with unchanged core-secret metadata and no reset/workspace/session/settings/restart mutations. Actual hosted browser and PTY behavior also passed in `/tmp/codex-hosted-urgent-verification/proof.json`. |
| Earlier `a785470` runtime/downloads | Actual hosted team/tool/Undo/naming and direct download/SSE/browser proofs are retained with that SHA. These close the old “hosted team/download proof missing” entries, without certifying later changes. |
| Frozen main integrations | Terminal: initial **10/11**, corrected shutdown/uncertainty **2/2** and TypeScript passed; no second full-run total is claimed. Extensions: **80/80** and TypeScript. Managed worktrees: **47/47** on Node 22. Managed-repository review: **92/92**. Thread listing: **24/24**, missing probes **84 → 0**. Memory/worktree UI fixtures: **25/25** and **11/11**. Full final-candidate aggregate/browser/deployment result remains pending. |

The thread-list native-fixture timing was inconclusive; the post-deployment HTTP profile remains a gate, not an asserted latency gain. Top-level application close returns a stable shared promise, joining concurrent callers to the same shutdown. The corrected removal check uses a private HEAD index to verify actual contents, preserves the live index, and distinguishes changed bytes with restored timestamps from clean CRLF normalization.

Current user work in `a680` and all newer files/conversations must remain intact. The optional authorized one-time older-QA cleanup has made **no mutations** per coordinator; use [ONE_TIME_RESET.md](ONE_TIME_RESET.md) only if that reviewed scope is selected after its release gate. Preserve source, stable secrets, saved accounts and unrelated data. Normal restarts and future work stay persistent.
