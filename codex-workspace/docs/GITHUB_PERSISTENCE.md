# Saved GitHub accounts

GitHub connections are independent of workspace login sessions. The workspace password unlocks all saved accounts; logging out, locking the browser, or restarting the app does not remove them. The hosting environment must retain the same `ENCRYPTION_KEY` and native `DATA_DIR` between instances. Workspace files and ordinary metadata remain unencrypted. Only credential values use the existing credential encryption format.

This change addresses a reproduced local race between independent `JsonStore` instances updating shared JSON maps. Hosted workspace registration loss prompted the audit; hosted GitHub-account loss was not observed, and no live account or token was used in the regression tests.

## Storage layout

With `DATA_DIR=/data`, all records below are in `/data/codex-workspace/state/`:

| File | Purpose |
| --- | --- |
| `github-account-version-gh_<id>-<uuid>.json` | An immutable, complete connection version containing public account metadata and its encrypted PAT together. |
| `github-account-disconnect-gh_<id>-<uuid>.json` | Permanent disconnect intent. A later connection must explicitly observe every existing marker. |
| `github-account-base-gh_<id>.json` | A complete legacy account/token pair copied during migration. Native versions and disconnect markers take priority over this base. |
| `github-accounts.json` | Read-only legacy migration input. New connections never update this shared array. |
| `protected-credentials.json` | Read-only legacy input for GitHub PAT migration. New GitHub mutations never update this shared credential map. Other credential features may still use it. |

Each connection version contains `schema`, `kind`, `account`, `version`, `encryptedToken`, `supersedes`, and `disconnects`. `encryptedToken` uses the existing `CDXW1` authenticated-encryption format and unchanged environment key. The account name, login, avatar, identifier, and creation date remain ordinary JSON. Tokens are absent from metadata responses, filenames, Git remotes, command arguments, and askpass helper files.

The public account ID remains `gh_<verified GitHub user ID>`. API paths, bodies, response shapes, workspace account references, and `withGitCredentials` remain unchanged. `listGithubAccounts(ctx)` is the canonical reader used by the account API, bootstrap, and Git commit identity. The old shared array is never a connection index for new records.

## Publication and concurrency

1. A connection request observes the existing version IDs and disconnect markers before verifying its PAT with GitHub.
2. After verification, it rejects a newly observed disconnect or incompatible account change. A new version supersedes only the versions observed by this request.
3. Public metadata and ciphertext are validated together and published as one staged JSON write to a new UUID filename. Every successful connection request publishes its own complete version, including an identical-PAT reconnect: another publisher can still roll back a candidate it has not acknowledged. Different accounts never replace the same metadata or token record.
4. The writer checks the resulting account state. If its candidate is rejected or publication fails, it removes only that candidate's unique file. Prior versions and disconnect markers are never removed by this rollback.

A usable account has one remaining credential value among the versions not superseded by another version. Only versions that observed all current disconnect markers participate in that selection or supersede other versions; an obsolete disconnect view cannot suppress a deliberately restored account. Concurrent writes of the identical verified PAT are equivalent. Different remaining PAT values produce `409 GITHUB_CONNECTION_CONFLICT`; no token is chosen by timestamp or UUID. A deliberate new verification can supersede the conflict set it observed. It cannot silently resolve an unobserved later change.

Disconnect publishes a unique permanent marker first. Old versions, delayed verifications, and delayed legacy imports cannot clear this intent. A later explicit connection observes the markers and publishes a new complete version. Repository/account selections are cleared conditionally, so cleanup does not erase an already-visible selection of another account. Local repository files remain intact.

This protocol does **not** claim a distributed filesystem lock or compare-and-swap. Different-account availability is the primary guarantee. Normal overlapping same-account publications are checked and rejected candidates rolled back. If an instance exits between publication and its check, or independent volume views reveal conflicting versions later, the reader fails closed until a deliberate reconnect resolves them. The prior ciphertext is retained; the app never silently falls back to an older token. Same-workspace metadata updates retain the workspace service's documented optimistic-update bounds.

Disconnect disables future account use through the app; it does not revoke a PAT at GitHub. Encrypted version history and permanent markers remain on disk. Do not delete journal files as a cleanup measure. This release does not compact account history. Record counts, version references, identity fields, and ciphertext sizes are bounded before use.

## Legacy migration and rollback

Migration accepts only a known legacy account with a complete, decryptable corresponding credential. It copies the existing ciphertext without rotating keys or replacing the token. Orphan token entries without account metadata are not imported. An incomplete legacy pair requires an explicit connection; it is not published as a partial connection.

Legacy bases use separate paths from native versions. A migration delayed until after a native connection or disconnect cannot overwrite that newer intent. Existing native versions or disconnect markers also prevent a later import from the old shared files. Legacy input files are retained unchanged, so this migration does not race with another feature's shared credential update.

All instances that mutate connections must use this protocol. An old runtime cannot express the new version and disconnect semantics. After native records exist, rolling back to code that reads only the legacy array is unsupported: it could omit new accounts or ignore disconnect intent. A rollback build must retain the canonical reader and journal protocol. Do not rebuild the old array automatically or infer connection intent from orphan legacy tokens.

## Verification

`tests/github.test.ts` forces overlapping publications from two independent stores and routers. It covers different-account connects, token replacements, disconnects, identical-PAT coalescing, delayed verification, failed publication rollback, conflicting saved versions, explicit conflict resolution, ciphertext-preserving migration, and a delayed legacy rename after disconnect.

`tests/github-persistence.test.ts` runs the real application, session middleware, routers, storage, and encryption in separate Node processes. Two live instances connect different synthetic accounts while GitHub verification responses are held at a barrier. Both import real temporary Git repositories. A fresh process then uses one workspace-password login to recover both accounts, browse their private repository fixtures with the original corresponding PATs, and make real Git commits using the restored account identities. No GitHub reconnect occurs after restart. Ordinary workspace files stay plaintext and account record bytes remain unchanged by logout/login.

Only the external GitHub API and remote Git destinations are replaced by explicitly synthetic local fixtures. No real hosted accounts are changed and no real token is read. These tests prove application persistence and the defined overlap behavior; they do not constitute a live GitHub account or native bucket visibility test.
