# Terminal interaction and performance

The terminal uses the host's real PTY, with immediate, uncompressed WebSocket input/output. It does not poll for command results, emulate a shell, predict echoed characters, or send traffic through another service. The reference [Space terminal implementation](https://huggingface.co/spaces/alvin3y10/exec/blob/main/server.py) also uses a native PTY, uncompressed WebSockets, retained sessions, and bounded output. The changes here address connection overhead and browser lifecycle while preserving that direct transport.

## Interaction changes

Opening the terminal view opens or resumes a shell in one authenticated WebSocket upgrade. It no longer waits for a terminal-list request, another Open button, a create request, and a subsequent connection. The initial request includes the measured viewport dimensions, so a new shell starts at the correct size. A stable request ID makes retries and simultaneous opens idempotent.

Visited terminal tabs retain their xterm instance, scrollback, selection, and socket. Switching between them does not create another connection or replay the screen. At most eight shell tabs are allowed per workspace; previously unvisited tabs connect only when selected. Hidden xterm renderers pause painting. Leaving a workspace releases its browser instances, while the server retains running shells for reconnection. Locking disconnects all terminal sockets and disables input; unlocking reconnects the same shells behind the single workspace password.

The output path calls xterm directly and does not update React state for every character. The transport enables TCP_NODELAY and disables WebSocket compression. There is no artificial output batching timer. Resize messages are sent only when the requested dimensions change. The browser measures its pane immediately, then applies live xterm geometry in the server's ordered resize frame, after earlier PTY output. This prevents output from the previous width wrapping over other alternate-screen rows during a narrow-pane transition. Initial terminals are still measured before opening; exited terminals can resize locally.

## Small-frame, resize and exit regression checks, 2026-09-23

An actual native producer exposed a gap in byte-only backpressure: 1,200 one-character frames reached a non-consuming viewer, exceeding the browser's 1,024 queued-operation limit while remaining far below the 256 KiB character window. The browser now negotiates a separate 256-frame window with `flow=1&frames=1`. It releases credit after 16 Ki characters or at xterm's parse-batch boundary after at least 32 frames. At most 31 short frames remain unacknowledged during idle periods. A repeated native test pauses before 256 frames, then receives all output after acknowledgements; existing byte-only clients retain their protocol.

An isolated Chromium run bundled the production `TerminalPanel` and connected it to real host PTYs. A 1,800-update native producer finished in approximately 2.30 seconds with one socket and no browser errors. The final observation received 1,743 output frames with 55 acknowledgements; an earlier per-parse-batch flush produced approximately one acknowledgement per output frame. These are local observations of a producer deliberately paced at 1 ms per update, not a claim of hosted network throughput or a physical-device benchmark.

The same browser check held an actual TUI output frame across a 111-to-53-column pane change. Before ordered resizing, a first-row write wrapped over the third row and changed `RESIZE_READY` to `WWWIZE_READY`. After the fix, browser and server emulator rows matched, including the untouched third row. A temporary authorization failure reconnected to the same native session; an actual denial remained an error without repeated reconnects. Native tests also exercise partial acknowledgements alongside binary mouse input and single-owner query replies.

Another native regression used an `exec`-replaced shell that exited after 800 short output frames while its viewer withheld acknowledgements. node-pty's 200 ms forced read-socket close discarded the remaining output and final marker. Paused PTYs now check their root PID's existence every 40 ms using a signal-zero probe. Once that root has ended, a bounded exit drain may bypass viewer pressure for 150 ms or 256 KiB plus one native read. Headless parser and client queue limits remain active, and descendant activity guards are unchanged. The regression now receives all 800 characters, its final marker, and the correct exit status.

The application/PTY timing fixture measured 30 local samples after these flow changes: control RTT median 0.14 ms / p95 0.39 ms, and actual shell completion median 0.48 ms / p95 0.86 ms. Browser process plus concurrent development work observed approximately 3.1–5.0 GB of charged cgroup memory, including file cache, below the 90 GB user ceiling. This verification used owned temporary storage and did not measure the deployed native bucket.

## Recent-history restoration

The selected fixed budget is **500 recent normal-buffer rows and 64 KiB of additional UTF-8 snapshot history**. The current normal and alternate screens are preserved independently. JSON framing, mode metadata and the current screen are not part of the 64 KiB history allowance. This is a measured default, not a user preference or a claim of optimality.

Reconnect uses matching `@xterm/headless` 5.5.0 and `@xterm/addon-serialize` 0.13.0. The former raw 256 Ki-character tail could begin inside an escape sequence or omit entry into the alternate screen. The version-checked adapter also restores margins, saved cursors, tab stops, charsets, pending-wrap position, mouse encoding, cursor visibility/style and input modes. Native color events retain at most 259 palette/default-color overrides. Completed color queries are not repeated. UTF-16 surrogate pairs and unfinished VT parser prefixes stay intact; previously executed controls are not executed again. A pending sequence over 64 Ki characters or a current screen over the separate 16 MiB restoration ceiling produces a visible failure while its real shell remains running.

The browser parses at the recorded dimensions and applies state before enabling input. A parser barrier separates replay from the ordered live tail. After xterm's scroll area and fit settle, a viewer previously at the bottom follows current output. A reader who deliberately scrolled into history retains a matching visible-row anchor when that history is still available; otherwise the retained range bounds the position. Connection/write generations, disposal and new user input fence deferred restoration. Alternate-screen programs retain their normal-buffer position until they return to it. Trimming is reported outside the terminal screen.

**Local acceptance, 2026-09-20.** Node 22.23.2 and Chromium 153.0.8010.12 used isolated ordinary `/tmp` storage, real host PTYs and the production browser client. No model, remote-host or hosted-Space request was involved. A native program verified its TTY, `TERM=xterm-256color`, `COLORTERM=truecolor` and 100×28 geometry, then emitted actual colored Unicode output. All 9,000 ordinary rows and 1,800 densely colored rows were received exactly once. Three reconnects per workload produced these unchanged sizes:

| Native output | Retained history rows | History bytes | Current-screen bytes | Snapshot bytes | JSON wire bytes | Median snapshot creation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary colored Unicode logs | 500 | 46,650 | 2,586 | 49,236 | 56,861 | 5.75 ms |
| Color changes on individual cells | 81 | 64,857 | 20,118 | 84,975 | 124,912 | 50.34 ms |

The dense case demonstrates the byte ceiling taking effect before the row ceiling, while retaining the whole screen. Native reconnect-to-replay completion medians were 8.92 ms and 55.67 ms respectively. These are local transport measurements, not hosted latency claims.

The candidate comparison fed the **captured real PTY stream** to the pinned serializer and actual browser xterm renderer. Chromium's main thread was throttled 4×. Each candidate has three observations; paint observation waits two animation frames after the write callback.

| History budget | Snapshot bytes | Median browser parse | Median paint observation | Largest paint observation |
| --- | ---: | ---: | ---: | ---: |
| 250 rows / 32 KiB | 25,911 | 62.2 ms | 112.6 ms | 182.0 ms |
| **500 rows / 64 KiB** | **49,236** | **79.8 ms** | **126.6 ms** | **181.5 ms** |
| 1,000 rows / 128 KiB | 95,886 | 235.8 ms | 298.0 ms | 392.9 ms |
| Former raw 256 Ki UTF-16-character tail | 280,102 | 660.5 ms | 704.8 ms | 849.9 ms |

The selected budget doubled the recent rows of the 250-row candidate for a 14 ms increase in median paint observation, and used about 82% fewer snapshot bytes than the former raw tail. The small sample and warm-up variation limit finer conclusions. The older [headless-only observations](terminal-replay-emulator-results.json) remain historical evidence; their pending-verification notes predate this acceptance run.

The final independent production-client proof retained the same native shell through reconnect, delivered 200 live sequence rows exactly once and in order, and kept its genuinely settled bottom position without manual scrolling. The focused browser gate passed **3/3** cases, covering live following, real-wheel history reading and native TUI restoration. The actual TUI preserved its exact visible screen, Unicode, palette, cursor, application cursor/keypad, bracketed-paste and SGR mouse modes. Native stdin logs verified arrow, paste and mouse bytes. Clear preserved the active TUI. The phone view fitted the real PTY to **43×29** at a 390×844 viewport without horizontal overflow.

One TUI reload at 4× CPU throttling restored its 17,287-byte snapshot and 500 history rows: the socket was ready in 73.2 ms, replay arrived by 116.6 ms, input was enabled by 336.0 ms, and the subsequent frame observation was 368.3 ms. The whole page reload took 1.46 seconds; that includes application loading and authentication. Actual readline input measured 15.9 ms median / 16.7 ms p95 to the received data frame, and 49.1 / 49.7 ms to the next frame after xterm updated, over 30 keys. Fifteen keys at 4× throttle measured 16.2 / 17.2 ms and 49.0 / 61.2 ms respectively.

The native/candidate run's supervised cgroup peak was 5.55 GB; the final UI proof observed 3.35 GB. These totals include charged file cache/tmpfs and concurrent work, not just terminal memory. The final whole-app browser heap was approximately 30.2 MB and the measurement Node process RSS approximately 254 MB. Neither is an incremental per-terminal estimate. The supervisor stopped above 88 GB, preserving 2 GB below the user ceiling of 90,000,000,000 bytes. Every owned shell/TUI identity ended and every supervisor reported zero remaining owned children; no cleanup signals were needed.

Credential-free observations, source hashes, failed pre-fix evidence and the reproducible owned runner are in `.release-verification/terminal-acceptance/`. The independent current native terminal fixture gate passed **48/48**, including the readiness-controlled authorization cases. Browser throttling is not a physical-phone benchmark; these small local samples do not establish hosted network latency, unlimited scrollback or an optimal budget. Replacing either pinned xterm dependency requires rerunning state/continuation tests as well as these measurements.

The shared durable HOME setup is initialized once per server manager. Each new shell still reads the user's current `.bashrc`. Shell history uses a stable, workspace-specific file under the native data mount, so replacing a shell or restarting the server loads previous commands. Ordinary workspace and history files remain unencrypted as requested. The app never mounts a filesystem, starts a sandbox/container, or places deployment credentials in the shell environment.

Native bucket remounts can report a different owner than the running shell. Terminal Git commands therefore receive a protected, per-session `safe.directory` entry for the canonical, registered workspace root. The shared `gitWorkspaceEnvironment` helper supplies this exact scope after environment sanitization; it does not trust a wildcard, forward inherited Git configuration overrides, or modify the user’s global Git config. Tests run real Git with simulated different ownership, prove the selected repository works, and prove an unrelated repository remains untrusted.

## Manual work and change review

Every accepted input emits `workspace:user-terminal` with the workspace ID and terminal session ID before writing to the PTY. The application installs its activity monitor before accepting terminal connections, so a later agent group also inherits already-started human work. An unrestricted terminal can write to another workspace, so this protection applies across workspaces.

Shell exit, socket disconnect, tab removal, and killing the shell PID do not prove that all of its background work stopped. `nohup`, disowned jobs, or daemonized descendants can still write files afterward. These events alone never emit `workspace:user-terminal-end`. The terminal holds its worktree activity lease until bounded lifecycle checks confirm that its recorded processes have ended. Linux checks use PID/start time, session/ancestry relationships and an opaque inherited marker; two complete quiet checks are required before release and the end event. Uncertain ownership retains the guard. Cleanup retries back off from 350 ms to 5 seconds, and no scans or filesystem reads run on the input/output path.

While the guard remains, broad shell-derived snapshots are excluded from Undo; exact direct file-tool changes remain individually reviewable. This is a process-local lifecycle guard, not OS isolation or a distributed lock. An unrestricted process can clear its environment and change ancestry; starting a fresh Node process does not prove that work from an earlier instance ended. Shutdown drains identified ordinary descendants, and concurrent application/terminal close calls join the same cleanup promise.

The conservative guard can also delay removal after the shell and its identified children have ended. A newer process without a matching marker can be ambiguous when its ancestry reaches a shared older ancestor that could adopt orphaned work. This can include an unrelated service or test worker whose independence is known to its launcher but cannot be established by the terminal tracker. Process births or exits during a scan also prevent that scan from proving quiescence. Such uncertainty keeps the checkout busy; it never authorizes killing those unproven processes. While the application remains running, release can resume after the ambiguous activity ends and two complete quiet checks succeed. Uncertain state left by shutdown is not cleared merely to make deletion available.

New processes with ambiguous ancestry can keep removal busy even after the shell exits. A complete process scan must settle before the guard can prove cleanup. The normal `npm test` command therefore runs `terminal-worktrees.test.ts` in a separate one-worker stage after the other test workers exit; concurrent worker creation violates these particular tests' global-quiescence precondition. The assertions and uncertain-owner protection are unchanged. Concurrent agent, storage and Git behavior remain covered by their normal behavioral tests.

The terminal-review tests launch a real disowned child through an authenticated PTY, wait until its shell has exited or been deleted, and then let it write into a different workspace during two newly created agent groups. Both writes stay out of agent review. An exact direct edit can still be undone without changing the human-written file. The tests identify and clean up their own child process using PID plus process start time.

The managed-worktree integration adds real admission cancellation, setup-failure rollback, disconnect/logout retention, repeated last-close/reopen, `nohup`/`setsid` delayed writes, known-child shutdown, and uncertain-owner checks. The initial focused gate passed ten cases and exposed a concurrent-close race; the corrected shutdown/uncertainty rerun passed both selected cases with the full Node 22 typecheck. Local actual-shell round trips in that gate measured about 0.18 ms median / 0.31 ms p95. These are local measurements, not a new hosted latency claim.

## Protocol

The existing REST endpoints and `/ws/terminal/:id` JSON protocol remain supported. Existing clients can continue sending input, resize, and clear messages without acknowledgements.

The browser uses:

```text
/ws/terminal?workspaceId=<id>&requestId=<uuid>&cols=100&rows=28&flow=1&frames=1
```

Optional `sessionId=<uuid>` selects a retained shell. Optional `new=1` requests a new shell. `requestId` stays unchanged when retrying the same request. Dimensions must be integers: 2–500 columns and 1–300 rows. A ready message includes `session`, `sessions`, `cols`, `rows`, `truncated`, and, when requested, `flowControl: true`.

Every upgrade awaits authoritative signed-session/Origin checks both before workspace lookup and immediately before the WebSocket handoff. A false, rejected, timed-out, or canceled result never upgrades the connection or creates a shell. Rejected raw HTTP-upgrade sockets are destroyed after their response flushes, retain error handling through close, and have a bounded fallback cleanup; a peer that never sends FIN cannot retain a rejected socket. Input arriving immediately after a successful upgrade is held in order until the selected PTY is ready. A canceled startup is checked before spawning a shell.

After handoff, the terminal uses a verified authorization proof for at most **5 seconds**, measured with a monotonic clock from the authority read's start. An authority read has a **3-second timeout**. Each input/output frame checks that lease in memory; normal typing does not read the native data mount. At expiration, both incoming actions and outgoing terminal frames are gated until the asynchronous refresh resolves. The combined pending queue is limited to **1 MiB / 1,024 frames**. Successful refresh flushes output and preserves input/control ordering, including resize and parser acknowledgements. Denial closes with code `1008`; a read failure, timeout or overflow closes with `1013`, allowing the browser's bounded reconnect policy to obtain a fresh proof. Every failure discards pending input. The underlying PTY and bounded replay remain available for a later authenticated connection. If a shell exits during a healthy refresh, its final output and exit status flush before the normal close frame; denial or timeout still takes precedence. Slow workspace setup awaits a fresh proof before spawning or attaching rather than canceling merely because periodic verification is in progress.

A same-process `auth:logout` event invalidates proofs synchronously. Results from checks started before that event cannot restore access; the affected session is rejected by the fresh local-revocation check. A global shutdown logout closes every terminal socket immediately. Cross-instance revocation is **eventual and interval-bounded**, not instantaneous: it first depends on the native mount making the revocation marker visible, then the next check begins within the 5-second proof period and has at most 3 seconds to finish. Frames are held while that check is pending. Expiry is checked by each authority call and has the same explicitly bounded proof window. Pending upgrades, auth queues, inputs, dimensions, replay, socket buffering, and session counts are bounded.

Flow-control clients send `{ "type": "ack", "characters": 16384 }` only after xterm's write callback confirms parsing. Counts are UTF-16 characters in received output strings; they do not include local UI messages or restoration metadata. The browser batches acknowledgements after at least 16 Ki characters or 32 parsed frames. Server frames contain at most 16 Ki characters and never split a surrogate pair. The server pauses PTY reading when a sole viewer has 256 Ki unconsumed/queued characters or, when `frames=1` is negotiated, 256 outstanding output frames. It resumes below 64 Ki and 64 frames. Partial character acknowledgements consume frame credit only once the complete frame is acknowledged. Its headless parser has independent byte/frame watermarks, so detached output cannot accumulate an unbounded parser queue. A stalled secondary viewer is disconnected instead of delaying another viewer that is consuming the same shell. Disconnecting the last viewer resumes the process subject to that parser budget and retains only the bounded terminal screen/history. A 1 MiB socket-buffer limit, bounded per-client queues and stalled-client timeout provide additional bounds.

A measurement client can send `{ "type": "ping", "id": "a-unique-id" }` and receive `{ "type": "pong", "id": "a-unique-id" }`. This measures the same authenticated JSON data path as terminal messages. Native WebSocket ping/pong is measured separately because intermediary handling of control frames can differ.

## Observations, 2026-09-19

The hosted revision below predates the asynchronous session-authority adapter described above; rerun the hosted benchmark for its release before attributing those numbers to the new authorization path. These are measured observations from this development host, not a promise of the same RTT from every location. Distance to Hugging Face, network conditions, cold Space startup, user shell configuration, and host load remain visible costs.

The initial baseline used three real shells, 25 readline keystrokes per shell, and monotonic timestamps. A fresh local process measured first-open time of 17.56 ms through REST creation plus WebSocket, and 9.79–9.97 ms for subsequent shells. The direct path measured 10.97 ms initially and 4.38–5.51 ms subsequently. These exclude downloading the frontend; the former UI also required a separate list request and another user action.

| Measurement | Original path | Updated path |
| --- | ---: | ---: |
| Local new-shell open, first process | 17.56 ms | 10.97 ms |
| Local new-shell open, subsequent | 9.79–9.97 ms | 4.38–5.51 ms |
| Local real readline echo, per-shell median | 0.22–0.25 ms | 0.17–0.21 ms |
| Warm tab switching | Recreate xterm and reconnect | Retain DOM and socket; no network request |

A later run of the committed benchmark against the same running application measured direct opening at 9.27/4.58/5.28 ms, compared with 14.11/8.03/7.41 ms through the retained REST path. Data-frame RTT medians were 0.08–0.09 ms; actual readline echo medians were 0.11–0.13 ms. After the final Git ownership and theme changes, the direct benchmark measured 8.76/4.96/5.05 ms to open, with median data-frame RTT 0.10–0.11 ms and readline echo 0.12–0.14 ms. The local host ran Node v20.20.2.

The hosted baseline measured REST creation plus WebSocket readiness at 108.94–127.26 ms and median actual readline echo at 24.10–26.22 ms from this measurement host. Native WebSocket control-frame RTT was 67.35–69.60 ms, illustrating why the browser's output path and control-frame timing are reported separately.

Post-deployment measurements verified exact source/runtime revision `40d2770484149b3922b82aea3b54bb3e18b31577` in `RUNNING` state before and after measurement, after the settings rollout was confirmed stable. The controlled comparison used the same preserved coordinator QA workspace for both paths, with three new shells per path and thirty samples per shell. Only the probe's PTYs were created and closed; workspace registration and files were unchanged, and `HISTFILE` was unset in those shells. No other terminal was closed.

| Hosted measurement on the same fixture | Legacy REST + WebSocket | Direct WebSocket |
| --- | ---: | ---: |
| New-shell complete handshake, three observations | 132.04–151.51 ms | 64.97–84.41 ms |
| Median of the three opening times | 142.09 ms | 74.04 ms |
| Authenticated JSON round trip, per-shell median range | 24.77–26.25 ms | 24.91–28.15 ms |
| Real readline key echo, per-shell median range | 24.86–26.33 ms | 25.06–28.28 ms |
| Real readline key echo, per-shell p95 range | 26.15–53.62 ms | 26.96–88.64 ms |
| Largest observed key-echo sample | 82.44 ms | 103.06 ms |
| Actual shell completion, per-shell median range | 67.99–68.00 ms | 68.00–72.00 ms |
| Actual shell completion, per-shell p95 range | 72.01–72.37 ms | 72.17–76.14 ms |

The median opening time fell approximately 48% in this comparison by removing the separate creation request. Keystroke medians remain close to authenticated JSON round-trip medians. The tail samples show that this does not guarantee every key or command returns within 30 ms; these are observations from one measurement host under the then-current network and server load. Per-shell percentiles are reported as ranges rather than combined into a fictitious global percentile.

An earlier direct-path pass on a new isolated fixture measured opening at 64.18–72.43 ms, key-echo medians at 24.53–25.16 ms, and key-echo p95s at 25.31–26.74 ms. That pass is retained separately and is not used for the same-fixture percentage comparison.

A read-only Git probe on the native `/data` fixture confirmed the actual ownership mismatch: shell UID 0 and workspace UID 1000. Plain `git rev-parse --verify HEAD` succeeded with the exact per-session workspace scope, and removing that scope reproduced Git's dubious-ownership rejection. The inherited `GIT_CONFIG_COUNT` was exactly `1`, the configured directory equalled the canonical working directory, and the native mount was present. The probe made no commit, configuration change, registry change, or index write; Git status used `--no-optional-locks`.

The production-browser checks used Chromium against the real local Node application and PTY. They verified:

- One navigation action caused one WebSocket and zero terminal REST requests.
- Two visited tabs retained their original DOM and two connections; selecting a warm tab settled in 19.4–32.5 ms across runs when observed after two animation frames.
- Real shell environment and output survived tab switching and lock/unlock.
- Thirty keystrokes reached actual output at a 12.5 ms median / 13.0 ms p95. The next frame after xterm's DOM update measured 45.7 ms median / 50.2 ms p95. This deliberately includes an observation frame after rendering and is not a raw network RTT.
- A 2 Mi-character command completed with Chromium CPU throttled 4×, without disconnecting or losing its actual completion marker. The recorded browser task time was 0.87 seconds and JS heap about 17.6 MB. The test attaches a Chrome CPU profile; output handling remains in xterm rather than React updates for every chunk.
- Phone controls measured at least 44×44 px, the terminal background follows the CSS neutral palette (`#0a0a0a` after the Vercel refinement), and the document had no horizontal overflow.

## Reproduce

Run the actual PTY and connection tests:

```sh
npx vitest run tests/terminal.test.ts tests/terminal-performance.test.ts tests/terminal-review.test.ts
```

The host-process lease-release cases require a separate serial validation stage after other test workers have stopped:

```sh
npx vitest run tests/terminal-worktrees.test.ts tests/worktrees-http.test.ts --maxWorkers=1 --minWorkers=1
```

Do not run that stage concurrently with another process-spawning test job. Both files assert that a real terminal's worktree lease is released after cleanup. Vitest's isolated forks are replaced between files; a replacement worker can be born after a terminal and descend from its older shared test controller. That is exactly the ambiguous process pattern the runtime deliberately preserves. A suite-local sequential annotation or a longer assertion timeout does not provide the required global quiescence. The regular test pipeline therefore keeps the other concurrency tests in its ordinary stage and runs these host-process assertions separately, without skipping or weakening the marked-child or unproven-owner checks.

Bound the tooling threads as well as test workers on a constrained host: `GOMAXPROCS=2` limits esbuild's Go runtime during verification. A one-worker Vitest run alone does not limit that thread pool. Real `EAGAIN`/`Cannot fork` errors or esbuild `newosproc` failures are host-resource failures, not passing or skipped lifecycle checks. Stop concurrent verification and resolve the host limit before rerunning. The detached-child fixture retains its own real launch output and includes a bounded excerpt on readiness failure, distinguishing a child that never started from one whose worktree lease failed to release.

The timing test authenticates through the real application, opens a real shell, measures thirty data-frame and command-completion round trips, and uses actual control-character markers that echoed command source cannot satisfy. With the asynchronous adapter, a local regression run measured a 0.07 ms median data-frame round trip and a 0.23 ms median / 0.43 ms p95 actual shell round trip over thirty samples. These local figures do not replace the older hosted-release measurements above. It reports measured percentiles and uses generous local regression budgets rather than treating CI timings as production promises. Other tests verify upgrade races, auth/Origin rejection, delayed and denied asynchronous proofs, pending-frame ordering, local/periodic revocation, stale-proof cancellation, bounded auth buffering, parser backpressure with exact 2 Mi-character output across revalidation, slow-viewer recovery, and history after a full server restart. An instrumented authority confirms that 101 input frames reuse their two initial proofs without a storage check for every keystroke.

For browser behavior and CPU/keyboard frame artifacts, build the application and run:

```sh
npm run build
npx playwright test tests/e2e/terminal-performance.spec.ts
```

For a running or hosted instance, provide a private mode-0600 JSON file containing `base` (the application origin) and an authenticated session `cookie`. Keep this file outside source and deployment artifacts. The benchmark creates an isolated workspace, measures real shells, closes every created PTY, and unregisters the workspace. It does not change the active workspace, user accounts, app settings, or deployment. Workspace unregistration preserves its generated directory according to the app's normal deletion behavior.

```sh
node scripts/benchmark-terminal.mjs --session-file /path/outside/source/session.json
node scripts/benchmark-terminal.mjs --session-file /path/outside/source/session.json --legacy
```

Optional `--samples 30` and `--sessions 3` control sample counts. JSON output contains only timings and the public origin; it does not contain credentials. Command-completion markers are produced by the shell itself. There are no simulated responses or local echo shortcuts in this measurement.
