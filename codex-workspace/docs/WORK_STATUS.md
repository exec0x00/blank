# Work status — active native Codex implementation

## Resumed September 20

The coordinator restored the previous conversation's exact saved objective as the active goal. Later user corrections still govern implementation. This is an in-progress checkpoint, not a completion or publication claim.

**Latest checkpoint:** the user subsequently requested actual text/tool interleaving, removal of repeated assistant branding, and persistent workspace trash with cleanup of missing-directory registrations. Those changes are in active implementation and require new verification. Interim `47ed4cb…` is live with all 31 hosted checks passing, preserved session/four-workspace state, and a successful real browser-transfer/native-import/readback proof. The older pending hosted-upload wording below is superseded by `/tmp/codex-interim-20260920T073140Z-deployment-proof.json`. No real saved GitHub account existed in that live baseline; local two-account replacement-process checks remain the credential-persistence evidence.

- Main source now includes the from-scratch reui/tree-3-inspired explorer, Editor pane hide/restore, dark-only preferences, direct browser-to-Hugging-Face uploads with server import and 24-hour staging cleanup, real ordinary Plan-mode child questions inline, and expiring/revalidated session authority for thread and download SSE.
- Node 22 type checking and the production client/server build pass, including the later large-history stream repair. Upload workers use ES modules; CSP permits the exact provider CAS origins and WebAssembly compilation. The backend validates provider capabilities and normalizes the known internal direct alias to the canonical public CAS endpoint without changing JWT or expiry.
- The non-browser aggregate passed **2,086 tests across 85 files**; the separately staged native terminal/worktree lifecycle passed **12/12**. Reports are `/tmp/codex-resume-unit3-results.json` and `/tmp/codex-resume-lifecycle-results.json`. Later changed capability cases passed **4/4**; large-snapshot/auth/client-state/API cases have **69 passing affected cases across focused runs**, including actual persisted Unicode histories and mid-stream revocation. These incremental results are not mislabelled as a second aggregate run.
- The exact production upload worker passed actual public CAS transfer, real bucket publication, anonymous SHA-256 readback and exact-object deletion for a harmless **67-byte** fixture. No file body went through the app, no writer credential reached the browser, and no CORS/CSP/TLS/permission override was used. `/tmp/codex-built-upload-publiccas-proof.json` records the protocol proof and the browser's consolidated test topology. Complete app reservation/import acceptance remains separate.
- Remaining release gates: **188 full-app Playwright cases**, **9 browser-based goal-control cases**, final source synchronization/publication and hosted app import, recovery and performance checks. Earlier full CLI browser smoke attempts failed during host resource/setup handling and establish no app assertion result. A tested low-thread browser configuration opens pages and runs the real worker, but the complete UI runner still needs sufficient thread capacity.
- The inherited local environment has thousands of old PID 1 zombies (latest observed baseline **4,661**). A temporary test-only supervisor at `/tmp/codex-local-test-supervisor.py` bounds tooling threads and reaps only its own new descendants. Its earlier process-disappearance/leader handling was repaired; the passing aggregate reaped 241 adopted descendants and added zero zombies. Application verification must still distinguish test-harness failures from application defects.
- The user subsequently explicitly requested immediate publication of the latest version while work continues. Interim commit `47ed4cb3997e35a7217dfbf72cb5398a11e4b747` is confirmed **RUNNING** with matching source/runtime SHA at **2026-09-20 07:36:20 UTC**; all 344 frozen source files match. The frozen snapshot passed its own production build and credential scan. This authorized source-only update does not claim completion of the remaining UI gate; 120/188 cases currently have passing evidence. No settings/secrets/hardware changes or user-data reset were requested for this publication. See [CONTINUATION.md](CONTINUATION.md) for current evidence and remaining work.

The remainder below preserves the **September 19, 15:27 UTC historical checkpoint**. Its source-freeze statements and pending feature descriptions are historical; use the resumed checkpoint above for current work.

## Current delivery checkpoints

| Source/release | Status and evidence |
| --- | --- |
| Previous `318683f` | Verified by the coordinator. Exact source passed **1,679 unit/behavior tests across 63 files**, type checking and production build. Full browser run: **117/118**; only the stale removed “Expand navigation” expectation failed, was corrected and passed its targeted rerun. Live layout evidence: `/tmp/codex-318683f-live-ui-proof.json`. |
| Hotfix `9b92ba1b07f382855f3c8f76f6f8a947213792e4` | Source is `/tmp/codex-download-hotfix`: exact 318 plus four UI fixes. **34/34** exact-source browser checks passed with normal browser security, recorded in `/tmp/codex-urgent-hotfix-browser-results/gate.json`. Exact source/runtime now match with stage `RUNNING`; **31 hosted deployment/download checks** passed and public assets match the reviewed build. Proof: `/tmp/codex-download-hotfix-deployment-proof.json`. Actual hosted browser and PTY behavior also passed; evidence is `/tmp/codex-hosted-urgent-verification/proof.json`. |
| Main `/tmp/codex-final-build` | Adds hosted web search/citations, opt-in root memories, automatic semantic compaction and managed Git worktrees. Authenticated routers, worktree startup/drain and top-bar callbacks are wired. Terminal/extension activity integrations and focused gates are complete, and source is frozen. The coordinator is assembling the final candidate; complete candidate/browser/deployment gates remain **pending**. |

The confirmed hotfix was a source-only rollout: core-secret metadata is unchanged, and no reset, workspace/session retirement, settings, restart or hardware mutation was performed. The main additions are not part of the narrow hotfix verification. Do not copy a passing total or runtime SHA from one checkpoint to another.

## Authoritative locations and constraints

- Development source: `/tmp/codex-final-build`. Durable source: `/data/codex-final`, synchronized with `scripts/sync-source.sh` after the coordinator's source gate. A completed main-source synchronization is not yet asserted.
- Upstream reference: `/tmp/codex-cli-upstream`, commit `78245b47af2a7aafcabe025828ceecca69db4df1`; complete source archive, Apache license and notices remain in `upstream/`.
- Public HF Space: `alvin3y12/codex-workspace`. React/Vite/TypeScript UI, Node/TypeScript server/runtime, minimal ZeroGPU Python launcher. No Rust Codex executable or Gradio UI.
- Public `alvin3y12/data` is attached natively at `/data`. Normal files/state stay unencrypted; account credentials remain protected. Stable password/session/encryption material and GitHub connections must survive source updates, logout and restart.
- Model traffic goes only to `https://alvin3y10-api.hf.space/api` with server-side `placeholder`. No upstream `/models`, provider/key/URL controls or additional proxies. Exact effort values are low, medium, high, xhigh and max; the static catalog includes both Team red choices.
- Never launch mount/proot/Docker/container/sandbox machinery. Keep these prohibitions in model/helper instructions and command validation. Do not repeat the previously rejected explicit platform restart operation.
- Downloads stage immutable files in separate public `alvin3y12/codex-downloads`, use direct public links and expire after 24 hours with startup/scheduled cleanup. Never mount that bucket. Its protected writer credential is server-side and omitted from build environments.
- Vercel palette, no shadows/backdrop-filter, custom dropdowns; icon-only rail; top-bar workspace, Go to file and Save; Codex left, editor centre, explorer far right; usable phone navigation; no global/terminal status footer or separate Agents tab.

## Implemented main capabilities and evidence

Roles, completed-turn user forks, rewind/archive, manual semantic compaction, targeted reviews, command hooks, user images, goals and public reasoning summaries are already implemented; the older seven-feature “next work” list is retired. Real children receive isolated task briefs and required configuration only. Explicit user forks are separate.

The four later additions have source, test and proof details in [WEB_SEARCH.md](WEB_SEARCH.md), [MEMORIES.md](MEMORIES.md), [WORKTREES.md](WORKTREES.md) and [CODEX_PORT.md](CODEX_PORT.md). Search has successful actual fixed-service search/replay proofs and preserved earlier failures. Memory extraction/recall has a real-service proof with child exclusion. Automatic compaction now invokes the semantic model helper; protected context does not fall back to excerpts. Worktree tests use actual linked checkouts, Git, host processes and replacement Node processes. Final composed-candidate verification remains separate.

Earlier actual hosted evidence is retained with its original release:

- `/tmp/codex-hosted-runtime-evidence.json`: `a785470`, actual Cyber/max parent and two native workers, files/commands, naming and Undo.
- `/tmp/codex-hosted-download-after-proof.json`: `a785470`, direct public download/SSE/browser behavior; `no-transform` edge correction verified. Actual elapsed 24-hour retention was not observed.
- `/tmp/codex-318683f-live-ui-proof.json`: latest verified desktop layout, empty rail labels, no separate editor header/footer/Agents panel, no native selects, overflow, page errors or forbidden effects.
- Account/UI-state persistence tests replace the actual Node process. External GitHub authorization fixtures are not a claim that a real user connected an account.
- Earlier terminal figures were approximately 64–73 ms open and 24.5–25.2 ms median key echo with roughly 25 ms network RTT. They are historical measurements, not a current-main benchmark or a zero-latency claim.

## Remaining concrete work

1. Complete verification of the final candidate being assembled from frozen main source: type checking, production build, the relevant aggregate behavior suites and full browser gate. The actual full-App worktree case and three citation cases remain pending; component fixtures alone do not verify all App wiring.
2. Synchronize/publish that verified candidate and record matching source/runtime SHA with relevant hosted recovery, accounts, sessions, downloads and interactive behavior.
3. Complete the post-deployment HTTP profile. The thread-list change removed 84 missing-file probes, but native-fixture timing was inconclusive and does not prove hosted latency improvement. Keep the goal active until required work is complete.

The closed source-integration gates are:

| Gate | Focused result |
| --- | --- |
| Terminal activity/shutdown | Initial lifetime run **10/11**; corrected shutdown/uncertainty follow-up **2/2** plus full TypeScript check. Earlier ten passing cases stay passing; no second full-run total is invented. Lifetime leases add no process scans to terminal input/output handling. |
| Extension activity | **80/80** plus full TypeScript check; project mutations/imports hold the worktree fence lease. |
| Managed worktrees | **47/47** on Node 22, including private HEAD-index content checks, changed same-size/restored-mtime refusal with the live index unchanged, clean CRLF removal, actual PTY busy protection/application close and fresh-Node saved-PAT persistence. |
| Managed-repository review | **92/92**. |
| Thread listing | **24/24**; missing probes **84 → 0**; hosted timing unproven. |
| Memory/worktree UI | **25/25** and **11/11** respectively, with fixtures bound to actual components; complete App/browser gate remains pending. |

[COMPLETION_AUDIT.md](COMPLETION_AUDIT.md) contains the detailed evidence matrix and source-backed limits. Top-level application close now returns one shared promise to all callers; worktree drain still precedes agent/provider/download/terminal shutdown. The earlier failed terminal-removal test remains historical evidence of the corrected defect. Memory behavior is a bounded workspace-scoped opt-in subset, not every upstream global consolidation feature.

## User data and optional cleanup

Preserve the current `a680` user workspace and all newer files/conversations. Do not restore an old verification fixture over changed working files or force Undo of user-kept files. Validate historical fixture bytes from their saved immutable evidence when needed.

The coordinator reports no mutations from the optional one-time older-QA cleanup. The user authorized that narrow cleanup for the next major update, but it is not an ongoing wipe or a reason to delay an unrelated verified hotfix. If selected, use the reviewed fixed scope, verified release gate and recovery procedure in [ONE_TIME_RESET.md](ONE_TIME_RESET.md), preserving source, stable secrets, accounts and unrelated/newer data.
