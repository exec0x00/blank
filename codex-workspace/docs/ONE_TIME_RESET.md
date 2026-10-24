# One-time managed workspace reset

The user authorized removing old projects and conversations with the next verified release. This operation is separate from deployment and is never a startup hook, timer, or normal-restart action. `scripts/reset-managed-state.py` is prepared for coordinator review; no live cleanup has run.

The executor operates on the native `/data` attachment using ordinary file operations. It does not call Hugging Face configuration, visibility, hardware, mount, pause, or restart APIs. It does not read environment credentials or contact the network.

The reviewed scope is a fixed list of old workspace IDs and conversation IDs. Discovery is read-only and produces a new private file outside `/data`. Replanning uses that same scope; it does not silently absorb identities created later.

The raw allowlist is limited to:

- `/data/workspaces/<reviewed-id>/` and the corresponding `/data/workspaces/.trash/<reviewed-id>/`.
- Individually owned `thread-thr_*`, `thread-summary-thr_*`, `thread-goal-thr_*`, `thread-naming-thr_*`, and `agent-thr_*` JSON files whose IDs are in the reviewed scope.
- Those threads' generated `thread-turn-…-(run|turn)_…` journals and exact JsonStore temporary-file forms.
- Rewind snapshots with a matching stored `threadId`, and review snapshots with a matching stored `workspaceId`.
- The reviewed workspaces' SHA-256-named `image-attachments-v1` directories, only when every item has the supported attachment filename/type.

The tool preserves deployment source, all of `/data/home`, account credentials, GitHub account/base/version/disconnect records, sessions, global settings, deletion/archive markers, and unknown paths. It does not rewrite shared workspace/thread/agent/goal indexes, `ui-state.json`, `extensions.json`, `filesystem-metadata.json`, or `download-jobs-v1.json`. Personal extensions and their source provenance remain intact. The separate download bucket keeps its existing expiration behavior and writer configuration.

Planning rejects top-level target symlinks and never follows symlinks inside project trees. Shared planning outputs must be new files outside the managed data directory, so an inventory command cannot replace live state. The final plan contains exact paths, byte fingerprints, counts, and a SHA-256 checksum.

## Execution at the release gate

The coordinator performs these steps only after the forthcoming source is verified and ready:

1. Freeze the old-ID scope and inspect the exact plan. Keep any new maintenance/fresh workspace outside that scope. A maintenance shell, if used, operates from `/tmp` and is distinct from the old project terminals being closed.
2. Stop targeted root conversations through `/api/threads/:id/stop`, which cancels their children/naming work, and close each targeted registered terminal through its authenticated DELETE endpoint. Verify their stopped state. Refresh the final plan if any inventoried content changed while work was stopping.
3. Issue a plan-bound `stopped` receipt, then run `backup`. Validate its success before deleting conversations. Backups contain the allowlisted bytes and links plus audit copies of shared indexes/preferences for reviewed recovery; source records stay untouched at this step. The executor checks local copies. Before source cutover, also wait for native bucket synchronization and verify the backup plan and required file bytes through the Hub; a local successful write or `fsync` alone does not prove remote synchronization.
4. Delete the targeted root conversations through the engine API and verify every inventoried conversation is deleted or absent. For each reviewed workspace, first fetch `/api/workspaces/:id/deletion`, then send its matching `expectedMode` with DELETE. The current workspace API moves ordinary workspaces to trash and permanently deletes verified GitHub-backed workspaces; it is no longer a metadata-only archival endpoint. For this separately authorized reset, purge the exact returned ordinary trash ID through `/api/workspace-trash/:id` after the verified backup, and require any permanent-deletion journal to complete. Record the returned IDs and actual acknowledgments; a status/failure is not completed cleanup. These APIs update their own indexes and caches. Old per-workspace UI fields may be cleared using the revision-checked UI API before deletion, or left as harmless unreachable references. Do not rewrite global preferences or extension/index JSON from a shell.
5. Recheck for new identities. New workspaces and conversations outside the fixed scope are preserved. A new conversation referencing an old target project causes a refresh, rather than indirectly deleting its backing project. Issue the `api-cleaned` receipt only after all required API acknowledgments and status checks.
6. Run `apply`. It validates the backup again and moves only still-present, unchanged allowlisted paths into quarantine. Paths already removed by the engine API are recorded as such. A changed file, unexpected object, new identity conflict, expired receipt, or destination collision stops further work.
7. Keep the application's supported metadata scanner running. Wait for `/api/storage` to report a successful capture after the cleanup time, with no error. Read the actual filesystem metadata and ensure no entries remain beneath retired project or trash paths. `complete` checks that evidence and preserves the home metadata and both root entries. A supported capture/drain hook may be used if available; raw deletion alone does not prove this gate.
8. Verify account connectivity, source/configuration, and the fresh workspace state, then complete the legitimate source update. No denied platform lifecycle operation is needed. Keep the existing workspace password, session/account-protection keys, download credential, bucket visibility, and native attachment unchanged.

Example commands on the instance, with reviewed private files staged in `/tmp`:

```sh
python3 scripts/reset-managed-state.py discover --data-dir /data --output /tmp/reset-scope.json
python3 scripts/reset-managed-state.py plan --data-dir /data --scope /tmp/reset-scope.json --reset-id RESET_UUID --output /tmp/reset-plan.json
python3 scripts/reset-managed-state.py backup --plan /tmp/reset-plan.json --receipt /tmp/reset-stopped.json
python3 scripts/reset-managed-state.py apply --plan /tmp/reset-plan.json --receipt /tmp/reset-api-cleaned.json
python3 scripts/reset-managed-state.py complete --plan /tmp/reset-plan.json --receipt /tmp/reset-metadata-captured.json
```

`RESET_UUID` must be replaced with the operation's lowercase UUID. Plan/discovery output is create-only; a refreshed review uses a new filename. The CLI does not fabricate API receipts. They record actual coordinator observations and expire within an hour:

```json
{
  "version": 1,
  "reset_id": "the-reviewed-reset-uuid",
  "plan_sha256": "the-exact-plan-checksum",
  "verified_release_ready": true,
  "stage": "api-cleaned",
  "expires_at": 0,
  "target_runs_stopped": true,
  "target_terminals_closed": true,
  "deleted_thread_ids": ["each-reviewed-conversation-id"],
  "archived_or_absent_workspace_ids": ["each-reviewed-workspace-id"]
}
```

Use stage `stopped` for backup/physical rollback. For completion use `metadata-captured`, add the observed `metadata_captured_at` ISO timestamp and `metadata_error: null`, and retain the API coverage lists. `expires_at` is a real future Unix timestamp, not the example zero. A receipt is an audit gate; it does not pause writers by itself. Existing authenticated operations plus post-cleanup capture meet the narrowed scope without a new global JSON rewrite or admission fence.

## Recovery and limits

The journal and readable, unencrypted backup live under `/data/codex-workspace/reset-backups/<reset-id>/`. The frozen plan contains each target's individual file hashes, modes, nanosecond timestamps, empty-directory entries, and symlink targets. These details remain recoverable even when the native bucket does not retain POSIX metadata. Each move is journaled, interrupted moves are reconciled, and Linux no-replace renames prevent overwriting a new destination. Completed reset IDs cannot run the cleanup again. Quarantine content that changed concurrently cannot proceed to completion; it remains available for inspection and physical rollback.

`rollback` with a current `stopped` receipt restores only the physical paths the executor moved, and refuses collisions or changed quarantine data. It tracks progress per path. After a native-volume remount, byte validation and explicit restoration of the saved POSIX metadata may be needed before these exact fingerprint checks pass; the executor does not silently recreate or chmod backup contents. It does **not** blindly restore shared JSON or undo engine API deletions, caches, indexes, or tombstones. Full application recovery, if required, uses the validated pre-API copies and a separately reviewed application/source rollback that preserves newer data. Backups are not purged automatically.

The current remote candidate inventory is only a review aid. It lacks local mount fingerprints and cannot be applied directly. Refresh and fingerprint the actual native mount at the release gate; record preserved new identities and any observed external account/settings changes rather than repairing them.
