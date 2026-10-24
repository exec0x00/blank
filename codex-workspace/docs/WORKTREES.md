# Managed Git worktrees

Managed worktrees are real linked Git checkouts with separate persistent workspace records and actual host working directories. The implementation studies official Codex commit `78245b47af2a7aafcabe025828ceecca69db4df1`, especially `codex-rs/worktree/src/lib.rs`, its Git helpers, and the stable, default-enabled `Worktrees` feature. The Node server runs installed Git; no Rust Codex executable or mounting/container machinery is involved.

A checkout can use an unused local branch, create a named branch from a committed ref, or detach at a committed ref. The default base is the source checkout's `HEAD`. Source modifications and staged files are neither moved nor copied into the new checkout. Creating from another managed checkout retains its provenance while anchoring the new checkout to the same primary repository.

The server allocates an unpredictable ID and `config.workspacesDir/<id>`. Production places the directory and durable state under the native `/data` volume. There is no client-supplied destination. `Workspace.worktree` records the worktree ID, originating workspace ID, primary repository workspace ID, Git administration directory, and common directory. Editors, terminals, threads and Git use the new workspace's actual `path`.

| Action | Native and persistent behavior |
| --- | --- |
| Create | Journal allocation, run `git worktree add --no-checkout`, validate links, fill the destination index, and use `checkout-index --all` without `--force`. Publish a workspace only after successful checkout. |
| List | Combine owned journals with `worktree list --porcelain -z`. Report actual branch, commit, local-file and lock state when validation succeeds. Exclude the primary and unmanaged checkouts. |
| Open | Validate the checkout again and restore its existing workspace identity. Explicitly open interrupted creation for inspection without resetting files. |
| Archive | Hide the registration while retaining checkout, branch, metadata, local files and conversation binding. |
| Remove | Require another selected workspace, idle repository activity, a clean/unlocked checkout and a saved commit reference. Run native `git worktree remove` without force, then archive registration. Keep branches and source history. |

Worktree controls belong to the top-bar workspace switcher. Existing workspace rename and account-selection operations also work. Creation copies the source GitHub account ID; later explicit workspace account choices remain independent. Git naturally shares repository-local commit identity. The existing connected-account fallback handles missing local identity. Worktree records never contain account credentials.

The routes use existing session authentication and same-origin mutation protection:

| Route | Request and response |
| --- | --- |
| `GET /api/workspaces/:id/worktrees` | `ManagedWorktree[]` for the primary repository family. |
| `POST /api/workspaces/:id/worktrees` | `{ name?, branch?, createBranch?, base? }` to `201 { workspace, worktree }`. Existing branch: no separate base. New branch: `createBranch: true`. Detached: omit branch. |
| `POST /api/workspaces/:id/worktrees/:worktreeId/open` | Empty object to `Workspace`. |
| `POST /api/workspaces/:id/worktrees/:worktreeId/archive` | Empty object to `ManagedWorktree`, state `archived`. |
| `DELETE /api/workspaces/:id/worktrees/:worktreeId` | No options to `{ removed: true, workspaceId }`. No force option. |

List and explicit Open accept a retained archived source ID, allowing recovery when every member of a known family was archived. Creation, archive and removal require a live route source. States are `ready`, `archived`, `recovery`, or `missing`. Branch, HEAD, dirty/locked status and issue are optional when native state cannot be established; unknown does not mean clean.

Every native path is checked beneath configured storage. Validation rejects symlinked roots/administration directories, parent aliases, special metadata files, external object alternates and unowned Git files. The retained primary workspace, owned journal, workspace metadata, checkout Git forward link, administration `commondir`, exact `gitdir` backlink, and Git's resolved directories must agree. Trust uses one exact canonical `safe.directory`, never a wildcard.

Reference/reflog and packed-object metadata checks are bounded. Existing object-parent directories are checked without probing all possible shards or scanning every loose-object content file. Removal's file inspection overrides repository stat, file-mode, case and untracked-cache settings that could otherwise hide local changes.

Git removes inherited repository selectors and disables global/system configuration, hooks, monitors, content filters, signing and detached auto-maintenance. Destination-only conditional filters are inspected before checkout. Network operations retain scoped askpass and reject custom remote helpers or ambiguous multi-destination pushes. Protocol allowlists, scoped HTTP resets and credentialed TLS-file checks prevent configuration from widening credential exposure. Connected-account askpass is explicitly enabled while terminal prompts stay disabled.

Removal refuses tracked/staged modifications, untracked or ignored files, Git locks, and skip-worktree/assume-unchanged flags that can hide modifications. Detached commits need a saved branch, tag or remote reference. A branch is never automatically deleted, including one created before registration failed. Useful error codes include `WORKTREE_DIRTY`, `WORKTREE_LOCKED`, `WORKTREE_INDEX_FLAGS`, `WORKTREE_UNSAVED_COMMITS`, `WORKTREE_ACTIVE`, `WORKTREE_BUSY`, `UNSAFE_WORKTREE` and `WORKTREE_BASE_NOT_FOUND`.

A clean status is only advisory. Before deletion the manager builds a disposable HEAD index in runtime scratch and compares actual contents through native Git, preserving built-in text/EOL normalization. It never replaces or refreshes the real index. Equal size/mtime and mutable index stat caches are not accepted as content proof. Scratch cleanup only unlinks the manager's index/lock files, never recursively deletes a directory. A failed or unsupported proof preserves the checkout. Submodule checkouts are refused by managed removal so nested repository filters cannot run implicitly; Archive and explicit native Git inspection remain available.

App-owned work uses `acquireWorkspaceActivity(workspacesDir, workspaceId, kind)` in `server/worktrees/activity.ts`. Hold a lease through actual native process cleanup, not merely request/socket lifetime. Removal atomically fences the primary and all registered siblings, rejecting existing activity and new admissions until deletion and registry updates end. File writes, Git mutations, agent runs, independently resumed children, approvals and review mutations participate. Terminal and extension integrations must use this same API. Archival remains nondestructive and does not require an idle checkout.

The barrier is shared by service instances in one app process. It is not a sandbox or distributed lock across hosts. Native Git independently rechecks changed/untracked files. Direct external writers do not participate in app admission; this implementation does not promise transaction isolation against unrelated processes writing to the volume. Normal workspace files and JSON remain deliberately unencrypted.

Independent `managed-worktree-<id>.json` journals prevent concurrent creations from replacing a shared registry index. Startup retains unfinished creation as recovery state and never resets or recursively deletes it. Failure rollback uses native removal only after ownership, clean-state and commit checks. Dirty/incomplete rollback stays visible. A removal interrupted after native deletion can finish its registration archive after restart. Missing files with surviving Git administration data remain a visible repair case; no automatic prune touches other worktrees.

If a stale POSIX manifest recreates directories after native removal, absence of both Git links still allows the old registration to be archived. Any residual directories or newly written files are retained as visible recovery state. Open also rechecks active registration after native validation, so concurrent archival cannot be silently reversed.

Managed archives retain workspace tombstones. Explicit restoration writes an immutable acknowledgment of the exact archive generation captured before native validation. Later archival creates a new generation, so a delayed acknowledgment cannot reopen it. Ordinary workspace tombstones stay permanent. Same-ID reopening preserves conversations, selected accounts, names and editor state.

Call `initializeWorktrees(ctx)` after workspace initialization. Call `shutdownWorktrees(ctx)` before final store flush/process exit: it rejects new manager operations, aborts native Git process groups, awaits escalation/exit and admitted operations, and preserves interrupted creation. It drains manager commands; separate agent, terminal and ordinary Git HTTP lifecycles still apply.

Limits bound creation input, metadata reads, Git output/timeouts, 200 retained checkouts per repository and 10,000 journal records. Bases never fetch implicitly. Force requests, automatic branch deletion and automatic pruning of unrelated worktrees are unsupported.

Verification uses actual repositories and native processes. `tests/worktrees.test.ts` covers branch modes, editor/Git operations, unsafe paths, source/account relationships, loss protection, concurrent registrations, journals and shutdown. `tests/worktrees-agent.test.ts` covers real engine admission, approval waiting, host command termination, independent child continuation, Stop and admission failure. `tests/worktrees-persistence.test.ts` replaces the Node process, restores simulated native-volume POSIX metadata, preserves account/thread/workspace identity, and performs a real saved-token askpass exchange without supplying a new token after restart. Existing GitHub tests cover account verification at the external boundary. No test uses a user token or mutates a hosted repository.
