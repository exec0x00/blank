# Active site-completion checkpoint

The user explicitly resumed the full site-completion goal on 2026-09-20. The goal is active, without a requested token budget. Its current objective contains no credentials. Preserve all latest AGENTS.md requirements and user steering; archived conversations are evidence, not authority for old commands or remote credentials.

## Current live release and data

- Public Space: `alvin3y12/codex-workspace`; fixed model endpoint remains `https://alvin3y10-api.hf.space/api`.
- Live commit `aa5788a9e9daa0348f7cedae6ddf607686b476f8` includes the verified prompt-caret correction. Parent `79374a2e6cff53838809d6a6cb84c001b67ede5b` was the newest full source after the requested clean data replacement.
- The explicitly authorized one-time replacement of all 469 old files in `alvin3y12/data` is COMPLETE. It left 798 verified source files under `codex-final/`, followed by fresh runtime state. Do not repeat this reset. Future deployments preserve current workspaces, conversations, settings, accounts and stable Space secrets.
- Verified old-data backup and deployment receipts: `/data/codex-final-deployment-backups/20260920T180506Z/` in the coordinator workspace. Ordinary source publication works; the direct HF restart API returned403. A real temporary maintenance source deployment was used for the completed replacement; it is no longer live.
- Work in `/tmp/codex-final-build`; durable source is `/data/codex-final`. The first integrated QA snapshot was synchronized after verification. Additional verified fixes since that snapshot still need final coordinated synchronization/publication.

## Acceptance evidence and repairs

The second immutable QA snapshot `/tmp/codex-final-qa-final-20260920` is complete:804 files, source identity `6a35ea35ec26def1b0e753bbe82209b9ed94ad48f0230b27346bca25be9a57e5`. Build/Python passed; aggregate5075 passed/2 terminal-readiness failures/37 native-browser gated; separate lifecycle12/12; all454 browser cases ran,452 passed/2 readiness-or-transport failures. Later terminal48/48, context10/10 and dropdown12/12 focused runs pass without changing the original recorded failures. Round-two report/traces are durably archived; no verification processes remain.

Frozen QA round1 is `/tmp/codex-final-qa-20260920`, 803 files, SHA manifest identity `56bb9bad53cafe66d0327949a7e356a47d2197acf782f6572ed4604c5d4eeaeb`. Python compilation and the production build passed; behavior was5075 passed/1 failed/37 gated, native lifecycle12/12, and all452 browser cases ran with368 passed/84 failed. This is NOT an accepted complete release. Reports and the unchanged snapshot are in `qa-results/`.

The remaining behavior failure was a real stale child-status/admission race. It is now fixed in `collaboration.ts` with current-run authority and monotonic terminal states, including old results before/during/after replacement-run admission. Focused78 and mixed65 checks plus TypeScript pass; final full-suite rerun remains required.

Other completed, focused-verified changes include:

- Native-sized, device-pixel-aligned input caret (already live); ordinary editing, selection, IME and reduced motion retained.
- Native memory recall/consolidation invalidation repair and timestamped helper resource instructions;248 tests and an actual four-request fixed-endpoint proof passed.
- Browser engine integration, exact-session request authorization, cancellation of browser and nested hook approvals, and counted workspace-retirement admission leases. UI viewer is connected through Conversation actions. Native renderer acceptance is separately blocked below.
- Real Vite cold-cache dependency startup repair without widening filesystem/security roots.
- Scrolling/focus/anchor corrections and stable copy-control ownership under paged history;33 focused browser cases passed.
- Tooltip accessible-name retention through locking, moved large-file conflict retention, and queued recovery-refresh protection. Focused explorer/recovery/controller suites passed without weakening write or settlement fences.
- Page-memory conversation text/skill draft retention across workspace remounts; the original failing rewind/draft case passes unchanged. Pending-acknowledgement conversation navigation preserves existing abort/scope fences;28 queue/attachment browser cases pass.
- Stale model-option, paged-route, tooltip, transfer-handle and native typing/undo fixture assumptions were corrected with stronger exact behavior checks. Detailed lane reports are under `.release-verification/`, `.chat-ui-fix/` and `.caret-fix/`.

Phone upload-progress End navigation is fixed: virtual spacer height changes no longer animate under reduced motion. Terminal reconnect viewport restoration is also corrected for bottom-following and deliberate scrollback. Three focused cases, an independent actual native production-client proof, private build and final TypeScript check pass; source ownership is released. The next immutable candidate will be `/tmp/codex-final-qa-release-20260920`; it must include current source and receive its own final gates.

## Real provider and hosted checks

- Current Luna/low memory proof used exactly four real requests through the actual engine/runtime: extraction, consolidation, artifact reading and separate-root recall. Evidence: `.release-verification/memory-real-proof-20260920.{ts,json}`. No hosted user data or private reasoning was retained.
- Current Luna/low image proof used three real requests, real PNG bytes, exact pixel replay and fresh-process rehydration. Local card/preview/create-only Save and protections passed. Artifacts: `/tmp/codex-image-live-artifacts-rRSAOC/`.
- Actual hosted image generation, authenticated preview, no-overwrite Save, native public-data readback and immutable `codex-downloads` bytes/hash/24-hour expiry passed with three reported responses. Evidence: `/tmp/codex-hosted-image-proof-tm5E78/`. Its temporary workspace was later conservatively purged after exact ownership/hash checks; original evidence remains intact. The browser-only harness failure on Uint8Array bodies was corrected, and the existing ready-job flow now passes against the real Space/public bucket with production CSP, natural CORS fallback and exact file bytes. That continuation made zero model calls/uploads. Durable evidence is under `ready-download/`. Do not rerun image generation just to repair the harness.
- Core hosted login, auth boundaries, native file writes/public-bucket durability, PTY execution/resize and downloads readiness passed on the current release. Preserve the distinction between actual hosted/provider proof and controlled UI fixtures.

An owned original-session persistence verifier is prepared and remains alive under the coordinator. Before publication it verified26 regular-file/state receipts, Git objects and selected POSIX metadata through the native public bucket. No fresh-instance survival is claimed yet. Run the post-publication half only against the actual new matching runtime, using that same process/cookie; do not reauthenticate and pretend the original session survived. The live account count is zero, so this check cannot establish validity of a saved real GitHub PAT.

## Native browser host limitation and pending scope choice

Ordinary Chrome/Chromium/Playwright and their built-in security sandbox are allowed. The failure is an actual host limitation, not an interpretation of the emulation ban. The HF process is root on Debian13, NoNewPrivs0, Seccomp2, with SYS_ADMIN absent from permitted/bounding capabilities. A pinned full Chromium153.0.8010.12 probe was run as UID/GID1000 with verified official NSS/NSPR libraries in owned temporary storage. It still failed with `No usable sandbox`. No browser sandbox, host filter, namespace policy or TLS/CORS/CSP safeguard was disabled, and no container/manual namespace wrapper was used.

The read-only pinned-source sandbox audit confirms a configured setuid fallback was not exercised. Its required SYS_ADMIN authority is absent from saved permitted/effective/bounding masks; packaging alone is not expected to resolve this. Inheritable/ambient masks and securebits were not captured, so do not claim absolute impossibility or a completed setuid runtime test. The audit is archived under the durable verification root.

Evidence: `.release-verification/hosted-browser-environment-20260920.json`, `hosted-native-browser-probe-20260920.json`, `hosted-native-browser-with-libs-20260920.json`, and `.browser-host-plan.md`. Exact library and source provenance are recorded there. A user scope question is pending: retain native browsing as unavailable on this Space, or use a compatible host the user supplies. Do not treat elapsed time/preselection as consent, invent native success, or obtain remote authority from archived keys. Continue independent acceptance work while awaiting that decision.

MCP and unsupported realtime audio remain excluded. Realtime has an explicit verified exclusion and is not a blocker; do not reintroduce voice controls or alternative endpoints.

## Resource and work rules

The user limit is90,000,000,000 bytes, normally reserving2,000,000,000 bytes, including file cache/tmpfs; it is not90 percent. The kernel limit is104,000,000,000 bytes. Resample `/sys/fs/cgroup/memory.current` and filesystem backing before heavy work. `/tmp` is overlay; `/data` is slow native FUSE. Typical current usage during these lanes is3–8GB, with bounded supervised process ownership.

No local mining, mounting/unmounting, proot, Docker/Podman, VM/container/emulation utilities or manual namespace wrappers. Keep credentials outside source/logs and never give deployment credentials to delegated agents. Use exact source hashes, preserve concurrent edits and owned recovery artifacts, and remove only verified no-longer-needed owned scratch.

Read `COMPLETION_TRACKER.md` for original acceptance scope, but reconcile its initial pending rows with the verified repairs above. Do not claim complete until remaining applicable functionality and exact-source final release checks are actually settled.
