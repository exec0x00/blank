# API performance

Interactive reads reuse validated state and parallelize independent work. A 513-file folder now takes 4.90 ms median server time in the matched local benchmark, down from 16.42 ms. Normal warm local workspace reads add roughly 0.2–1.2 ms of authenticated route processing. Network travel, Git processes, repository transfers, and model generation retain their actual costs; their measurements are reported separately.

`server/settings.ts` loads the four independent bootstrap inputs together. `WorkspaceService.listTree()` processes at most 16 metadata calls together and creates one numeric `Intl.Collator` for the complete sort. Root/path validation, symlink checks, entry limits, natural sorting, and file-version conflict checks remain in the request path.

`JsonStore` coalesces simultaneous reads of the same record and retains at most 256 records, 16 MiB of serialized JSON, and 1 MiB per record. Every read checks the filesystem fingerprint: device, inode, size, nanosecond modification time, and nanosecond change time. Cache entries contain serialized JSON so each consumer receives its own parsed value. Missing records and large records are not retained.

Rapid writes on the local filesystem were observed to reuse a complete timestamp, even when exposed in nanoseconds. A snapshot is therefore admitted to the cache only when it was read more than two seconds after its change time. Recent snapshots are never promoted into later cache hits. Missing, zero, or future change times bypass retention. The live native `/data` volume was also tested: same-size writes with the old modification time restored still advanced its change time, including a write with no intentional delay. The probe used and removed its own generated workspace.

Writes stay serialized per key and complete only after the temporary file has been written, closed, and renamed. Warm writes avoid creating an existing directory and deleting an already-renamed temporary path. Updates read actual current bytes and recheck both metadata and bytes immediately before replacement; a detected outside edit produces HTTP 409 with `STATE_CONFLICT`. Cache entries and older in-flight loads are invalidated around mutations. A malformed existing JSON record fails closed. There is no asynchronous application write queue that acknowledges a save before replacement, no custom mount, and no extra copy of durable data outside the configured volume.

Authenticated API responses expose `Server-Timing: app;dur=…`. The number measures time from the authenticated middleware to response headers, including request-body parsing and route work. It excludes network travel, browser work, and the remaining lifetime of an SSE stream. Existing response metrics are preserved, including explicitly supplied `writeHead` headers. Public health/session routes stay outside this metric.

## Measurements

The following runs used real HTTP, a separate temporary data directory, an actual Git repository, a 4.5 KiB initial text file, and 24 serial warm requests per route. Warm sampling starts after filesystem timestamps have settled. First-request figures describe the first observed route access after setup; they do not claim an empty hosting or storage cache. All figures below are milliseconds.

The matched 513-file before/after comparison used the same temporary request timer before Express in both source versions, so these processing figures include authentication. The committed benchmark uses the authenticated middleware described above.

| 513-file directory | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: |
| Server processing | 16.422 / 21.855 | 4.903 / 6.999 |
| Complete HTTP request | 18.142 / 23.431 | 6.601 / 9.095 |

Current local results with 65 files, using the committed benchmark and authenticated route timing:

| Operation | First HTTP request | Warm HTTP p50 / p95 | Warm route processing p50 / p95 |
| --- | ---: | ---: | ---: |
| Health | 4.214 | 1.175 / 2.136 | — |
| Session check | 2.547 | 1.015 / 1.134 | — |
| Bootstrap | 5.080 | 1.340 / 1.538 | 0.333 / 0.465 |
| Workspace list | 2.334 | 1.184 / 1.263 | 0.214 / 0.239 |
| Directory tree | 14.722 | 2.633 / 3.793 | 1.154 / 1.434 |
| File read | 4.272 | 1.806 / 5.735 | 0.493 / 1.246 |
| Version-checked save | 6.252 | 3.213 / 4.504 | 1.576 / 1.894 |
| Git status | 19.910 | 17.515 / 21.789 | 15.787 / 20.044 |

The hosted baseline on `alvin3y12-codex-workspace.hf.space`, before these API performance changes, used a separate 65-file Git workspace and 24 warm samples. This test location already had a 26.48 ms median health round trip. That transport floor is part of every complete HTTP measurement.

| Hosted baseline operation | HTTP p50 | HTTP p95 |
| --- | ---: | ---: |
| Health | 26.479 | 27.409 |
| Session check | 26.766 | 28.914 |
| Bootstrap | 28.421 | 35.500 |
| Workspace list | 27.484 | 29.409 |
| Directory tree | 30.432 | 38.420 |
| File read | 28.320 | 30.457 |
| Version-checked save | 32.249 | 45.716 |
| Git status | 52.577 | 71.233 |

A later five-sample hosted smoke run verified the committed script and its fixture cleanup on the provider/style release. It had approximately 29 ms ordinary-read medians and visible outliers up to 350 ms for a tree request. The small smoke run is retained in the evidence; it is not presented as a post-optimization performance comparison.

The first full deployed profile of revision `40d2770484149b3922b82aea3b54bb3e18b31577` was interrupted by HTTP 404 `WORKSPACE_NOT_FOUND` for its newly created fixture during concurrent workspace creation. The source/runtime SHA and `RUNNING` state were checked before and after. Successful setup and partial warm samples are preserved as a failed profile, separate from completed measurements; no fixture file deletion ran after its registration disappeared.

The corrected independent workspace registry was then measured on exact source/runtime revision `a785470ccb66be1e8c7992905be7663d1332d9b3`. The Space was `RUNNING` before sampling at `2026-09-19T12:42:09.653Z` and after sampling/cleanup at `12:42:27.039Z`. All 192 warm requests completed, along with setup, first requests, and fixture cleanup. The four pre-existing workspace IDs and active selection were unchanged; the benchmark removed its own files, registration, and PTY. No whole-registry snapshot was restored.

| Hosted corrected release, 65 files | HTTP p50 / p95 | Authenticated route processing p50 / p95 |
| --- | ---: | ---: |
| Health | 27.603 / 30.201 | — |
| Session check | 26.907 / 29.985 | — |
| Bootstrap | 30.867 / 923.567 | 1.852 / 889.650 |
| Workspace list | 30.696 / 193.446 | 1.534 / 154.257 |
| Directory tree | 29.041 / 35.160 | 1.955 / 5.209 |
| File read | 28.643 / 80.500 | 0.955 / 53.635 |
| Version-checked save | 32.666 / 54.630 | 3.193 / 18.120 |
| Git status | 47.945 / 90.377 | 20.546 / 29.762 |

The measured transport floor changed from 26.48 ms to 27.60 ms between runs. The tree median improved from 30.43 ms to 29.04 ms, and the direct per-workspace file-read path had 0.955 ms median route processing. Ordinary request medians stayed close to that network floor. The tail remains material: bootstrap reached 923.57 ms p95, workspace listing 193.45 ms, and file reads 80.50 ms. First bootstrap was 519.71 ms. These results do not support a claim that every hosted request is imperceptible, and changes in host/storage load or surrounding registry state prevent attributing every difference to one code change.

Read-only inspection of the deployed registry identified repeated archive/current/legacy probes while listing known records; `get(id)` reads the selected record directly. Native missing-file lookups can require remote requests. The following investigation measures this cost separately from HTTP transport. [Upstream native filesystem read behavior](https://github.com/huggingface/hf-mount#reads).

### Native missing-path investigation and listing correction

A subsequent read-only native probe isolated the cost of these lookups. It used a temporary owned PTY in an existing QA workspace and inspected non-credential workspace metadata only. No workspace, preference, or state-file writes were made by the probe. Its terminal was removed and the active workspace selection was preserved.

| Native `/data` operation | Samples | Median | p95 / first relevant miss |
| --- | ---: | ---: | ---: |
| Existing-file stat | 20 | 0.020 | 0.064 |
| Existing metadata-file read | 20 | 0.086 | 0.487 |
| State-directory listing | 20 | 0.098 | 0.187 |
| New missing-path stat | 10 | 45.795 | 54.052 |
| New missing-path read | 10 | 49.990 | 63.982 |
| Same missing-path stat, 1.1 seconds apart | 6 | 50.976 | 66.529 |
| Existing stat after 11 seconds | 5 | 0.042 | First revalidation: 25.227 |

Within a tight burst, repeated checks of one missing name were cheap after its first 56.567 ms miss. Waiting 1.1 seconds made that same missing path expensive again. This demonstrates the native negative-lookup cost directly; directory enumeration was approximately 0.1 ms on the same mount.

The pending source correction uses the fresh directory snapshot already obtained for a workspace **list** to avoid probing absent archive, current-record, base, and revision filenames. Present entries still go through the existing reads and validation, including malformed files, directories, and symbolic links. The snapshot contains every entry name and is discarded after the call. There is no shared positive cache or new TTL. A list that overlaps a mutation may reflect its earlier directory snapshot; the next list takes another snapshot. Direct `get`, mutations, path/symlink/version checks, and REST authentication remain authoritative and do not use this listing shortcut.

A mixed local fixture matching the observed inventory reduced list calls from 15 stats with eight misses to seven stats with zero misses. Modern direct access stayed at two stats/one miss and legacy direct access at seven stats/five misses. `readUiState` was also inspected: bootstrap calls it once and it performs one validated JSON read, without another workspace list. The separate account/workspace directory enumerations in the newer source are lower-cost work than the proven missing probes.

For stronger evidence, six exact private listing methods were extracted from the deployed hotfix and pending source and replayed read-only against the real `/data` registry. The `JsonStore` implementation was identical in both versions. Neither application initialization nor migration/mutation methods ran. Ten rounds alternated which implementation went first and waited 1.1 seconds between rounds so the native negative cache could expire. Both returned four visible workspaces throughout:

| Native listing-method replay | Before | Pending correction |
| --- | ---: | ---: |
| p50 | 430.565 | 0.714 |
| p95 | 471.629 | 1.078 |
| Missing probes per list | 8 | 0 |
| Existing-stat probes per list | 6 | 6 |

This isolated measurement covers listing work. Its raw samples and source fingerprints are retained. Authentication, account records, UI preferences, storage revalidation, and network travel contribute separate costs. In particular, this fix deliberately does not remove the remaining authoritative missing-marker checks from direct access or authentication.

### Hosted read-only profile of release `9b92ba1b07f382855f3c8f76f6f8a947213792e4`

The listing correction was verified live in the combined release. Source and runtime SHA matched the exact revision with state `RUNNING` before sampling at `2026-09-19T14:55:41.917Z` and afterward at `14:56:03.875Z`. The profile sent only GET requests: bootstrap, workspace listing, settings, and the thread list of the operator-owned QA workspace. It reused the existing private cookie, requested no user-file/conversation/session/preference changes, and launched no browser, build, or local test job. Bodies were drained without decoding or logging their contents.

There were 12 interleaved warm rounds, with 150 ms between every request, plus one first observation per endpoint. All 52 responses were HTTP 200. With 12 samples, p95 is the largest sample; it is a bounded diagnostic profile, not a long-run service-level guarantee.

| Read-only endpoint | First HTTP / app time | Warm HTTP p50 / p95 | Reported app p50 / p95 |
| --- | ---: | ---: | ---: |
| Bootstrap | 575.558 / 281.933 | 136.158 / 180.060 | 49.027 / 82.549 |
| Workspace list | 44.866 / 1.038 | 30.441 / 46.766 | 0.768 / 1.189 |
| Settings | 43.126 / 0.457 | 32.970 / 65.866 | 0.270 / 18.821 |
| Owned-QA thread list | 1340.293 / 1293.202 | 765.386 / 916.181 | 726.290 / 883.290 |

The live workspace-list route now has sub-1.2 ms p95 processing in this sample, confirming the listing improvement beyond the earlier native replay. Bootstrap still has noticeable latency, and thread listing is the largest remaining server bottleneck: its response was only 240 bytes while reported route processing exceeded 700 ms median. These results do not justify calling the full application uniformly near real time. A follow-up source investigation is targeting the thread enumeration path and repeated missing deletion-marker checks.

First observations include connection/setup and storage-cache effects; the hosting instance was already running, so they are not cold-instance measurements. The 150 ms pacing differs from the earlier burst profile and allows native cache entries to expire between visits to an endpoint. Data and middleware also changed between releases. HTTP time includes consuming the response body; the reported `app` metric may exclude authentication as well as transport, so subtracting it does not isolate pure network RTT. The sanitized proof is `/tmp/codex-api-readonly-9b92.json`, with exact release checks and individual numeric timing/status/byte-count samples; it contains no cookie or decoded response bodies.

### Thread-list source correction prepared after the `9b92` profile

Source analysis confirmed that the thread endpoint obtains the global conversation index before applying its workspace filter. The index already inventories summary/full/deletion filenames, but its final loop probed a missing deletion-marker path separately for every active candidate. The pending correction uses a **fresh end-of-pass** directory inventory for listing membership, after summary reads and any recovery work. IDs observed in either marker inventory are pinned before diagnostic reads, including unsafe markers and leaves that subsequently disappear. Incomplete scans fall back to direct per-candidate checks; hard directory/I/O failures still fail closed. Direct `isDeleted`, upsert, deletion, and pre-recovery-write checks are unchanged. A final local deletion check also runs after the derived compatibility-cache write. There is no TTL or stale positive authorization cache.

Pinned Node 22.23.2 typechecking and all 24 focused thread-index tests passed with one worker and `GOMAXPROCS=2`. New regressions cover absent-marker probe elimination, independent registrations/edits/deletions, a marker committed while a summary read is in flight, observed-marker disappearance, incomplete-scan fallback, hard final-scan errors, and deletion during compatibility publication.

A separate generated native fixture held 14 fabricated conversations and ran the exact pre-patch `9b92` implementation and pending implementation in alternating order, 1.1 seconds apart. No real conversation was read or changed by that replay. Six rounds per variant returned the same 14 rows, made no measured writes, and produced no warnings. Missing-marker probes fell from **84 to zero** across the six before/after calls. However, the fresh fixture did **not** reproduce the live namespace's large delay:

| Isolated native thread-index replay | Before | Pending correction |
| --- | ---: | ---: |
| p50 | 2.653 | 2.462 |
| p95 / maximum of six | 3.902 | 126.829 |
| Missing-marker probes across six lists | 84 | 0 |

The slower after sample is retained. This replay verifies the removed operations and preserved results, but does not prove a hosted latency improvement or explain all of the mature namespace's delay. Fresh-directory/cache behavior may differ; no additional probe of mature global conversation state was performed. The generated native fixture was removed, its own PTY was removed, and a subsequent cleanup check found zero terminals in that QA workspace. The full combined release must be measured again with the same 52-GET paced profile before claiming the thread-list tail is repaired. Sanitized proof, cleanup results, and source hashes are in `/tmp/codex-native-thread-index-replay.json`.

The existing metadata recorder was profiled with 10,000 real files in 20 folders. Capture completed in 724 ms while 483 bootstrap requests continued. Authenticated bootstrap processing was 0.349 / 0.505 ms p50 / p95 during capture and 0.370 / 0.740 ms while idle. Event-loop delay was 1.43 ms p95, 8.43 ms maximum. This local measurement did not justify weakening metadata capture or persistence checks. Native bucket and larger-repository performance must be measured in their own environments.

Full first-request/warm samples, exact successful-release checks, preservation/cleanup results, timestamp-probe results, the interrupted profile, and the smoke run are stored in [api-performance-results.json](./api-performance-results.json). These snapshots were collected on 2026-09-19; use repeated profiles to assess a different release, machine, or network path. The successful hosted profile covers the named hotfix; later account/session persistence changes need their own release measurement.

## Reproduce

Run a local profile from the source directory:

```sh
node --import tsx scripts/benchmark-api.ts
```

It starts and signs in to an isolated local application, creates its own fixture, measures session/bootstrap/list/tree/read/save/Git paths, writes a mode-0600 JSON report under `/tmp`, and removes its data directory on exit. It does not make a model request or contact GitHub. Set `CODEX_BENCH_FILES` for 1–2048 additional fixture files, `CODEX_BENCH_SAMPLES` for 5–200 samples, and `CODEX_BENCH_REPORT` for the report path:

```sh
CODEX_BENCH_FILES=512 CODEX_BENCH_REPORT=/tmp/large-folder-api.json node --import tsx scripts/benchmark-api.ts
```

For a hosted profile, the deployment coordinator supplies a regular mode-0600 JSON file containing only the HTTPS application `base` and a valid session `cookie`. The script accepts no model endpoint or provider credential. It creates a separate workspace, preserves existing registrations and active selection, and removes its own fixture through its own authenticated host terminal. Cleanup checks the exact generated path and refuses to remove a fixture containing unexpected files.

```sh
CODEX_BENCH_SESSION_FILE=/tmp/codex-api-benchmark-session.json CODEX_BENCH_REPORT=/tmp/hosted-api.json node --import tsx scripts/benchmark-api.ts
```

The bounded native filesystem probe can be repeated with a pre-existing QA workspace owned by the operator:

```sh
CODEX_BENCH_SESSION_FILE=/tmp/codex-api-benchmark-session.json CODEX_BENCH_WORKSPACE_ID='your-owned-qa-workspace-id' node scripts/profile-native-storage.mjs
```

It opens its own temporary PTY, reports timings and counts only, and removes that PTY. It never prints file or credential contents, creates a workspace, changes preferences, mounts storage, or alters mount settings. Its report defaults to `/tmp/codex-native-storage-profile.json` and can be changed with `CODEX_BENCH_REPORT`.

An unavailable or restarting Space fails the run instead of producing successful latency figures. The script does not restart or redeploy the Space. Recheck the same deployed instance before rerunning. An interrupted cleanup retains the fixture registration for inspection.

## Behavioral checks

`tests/api-performance.test.ts` verifies coalesced and bounded cache reads, independent consumer values, outside writes/replacements/deletion/recreation, timestamp aliasing without delaying the external edit, late-reader invalidation, read/write barriers, raw-byte mutation conflicts, malformed-state recovery, real authenticated bootstrap, bounded concurrent directory metadata, natural ordering, symlink boundaries, numeric timing, explicit response headers, and immediate SSE delivery. Existing storage tests verify fresh-process reopening and protected credentials.

```sh
npm run check
npx vitest run tests/api-performance.test.ts tests/storage.test.ts tests/integration.test.ts tests/settings.test.ts tests/workspaces.test.ts --maxWorkers=2
```

The 100 focused checks passed. The benchmark script also passed standalone TypeScript checking and completed both local and hosted fixture-cleanup runs. A separate read-only review found no blocking cache, serialization, or persistence regression; its explicit-header timing finding was fixed and added to the test coverage.

The subsequent listing correction passed all 40 workspace tests, including new missing-probe, independent-mutation visibility, archive-authority, nonregular-entry, malformed-record, and symlink-marker cases. The 13 API performance tests and two complete-server integration tests also passed; the workspace module passed standalone TypeScript checking. At that check, the full working-tree typecheck had an unrelated in-progress `AgentControlRuntime` interface error in `server/agent/control-router.ts`; no workspace or performance error was reported. The coordinator must run the full final gate once those concurrent changes settle.
