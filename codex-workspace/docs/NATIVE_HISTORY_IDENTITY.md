# Native history identity and view handoff

Verified on 2026-09-30 against the installed official `codex-cli 0.159.2`
and the official `rust-v0.159.2` source. The executable was exercised only in
an owned temporary native home and workspace with the fixed owner provider,
model discovery and WebSocket transport disabled. Harmless native shell
commands materialized the test threads. No model inference, production
conversation, account credentials or user-history migration was involved.

| Native operation | Paginated thread | Legacy thread |
|---|---|---|
| `thread/start` with no history-mode override | Native selects `paginated` when its store supports it | A backend without paginated support can retain its native default |
| Explicit history mode at creation | Accepted | Accepted |
| `thread/items/list` before materialization | Can return `-32601` | Can return `-32601` |
| `thread/items/list` after a real native shell turn | Succeeds; stored item IDs match live IDs | Returns `-32601` |
| `thread/turns/list` after materialization | Succeeds | Succeeds through native reconstruction |
| Resume and fork after materialization | Preserve paginated mode | Preserve legacy mode |
| `thread/revert` on the owned test turn | Accepted | Rejected: requires paginated history |

New website conversations therefore omit the old forced `historyMode: "legacy"`
override and accept the native default. Existing conversations are resumed or
forked in their persisted mode; no stored thread or rollout is rewritten to
change modes. An empty thread still cannot be silently recreated after a
restart when native history has never materialized.

Method availability is not a process-wide yes/no cache. A rejection for one
legacy thread must not disable item pagination for another paginated thread.
Likewise, an empty paginated thread must be allowed to retry item pagination
after its first input has actually materialized. Known legacy metadata selects
the native turn-page fallback directly. Unknown/paginated metadata can retry
the item API, with fallback only after its explicit native rejection.

## Live IDs and reconstructed IDs

The legacy native history builder assigns `item-N` IDs to user messages,
assistant messages and public reasoning summaries. Its live event stream can
use different original IDs. Those are different representations of the same
native turn, not additional assistant responses. Some live-only activity also
does not appear in reconstructed history. Equal text is not an identity: two
distinct native items containing the same sentence remain distinct.

`Thread.nativeView` supplies a bounded presentation contract:

- `epoch` identifies the server/connection/view incarnation. Cache recreation,
  native restarts and successful history replacement cannot reuse a retired
  epoch.
- `revision` orders observations within that epoch.
- `historyMode` reports native metadata, or `unknown` when unavailable.
- `turns` lists only covered turns, with their `native` or `legacy` identity
  space, monotonic representation revision and `partial`/`complete` coverage.

A legacy full-turn representation change advances that turn's revision,
including removed items or cleared public summaries. Partial payloads do not
claim that unrelated turns or unprovided pages are absent. Buffered older
snapshots, expired read epochs and retired turn revisions cannot restore old
IDs after a handoff. Ordinary live snapshots carry no stale pagination hints.

If the server has observed a legacy turn from its start, its live representation
is retained during execution. Once completed native history is verified, only
that turn changes to its reconstructed representation. A legacy turn first
opened from stored history keeps one representation and refreshes on item/turn
completion; incompatible live IDs are not appended to its stored rows.
Attachment-resolution callbacks retain their original receipt identity and
cannot arrive late as a new representation.

History lookups keep their requested page and direction in the HTTP response.
When an identity handoff needs an SSE snapshot, the bridge uses a bounded,
genuine descending tail reconstructed from the same complete native turn
reply. It does not relabel an ascending/interior page by swapping its cursors.
Unrelated and newer native turns stay resident. Public `agentMessage.phase`
is preserved as `nativePhase`; it does not create a turn identity.

## Cursor and privacy boundaries

The legacy cursor wrapper retains the actual native cursor and item/turn anchor
and adds a public-representation fingerprint. A changed anchor, content set or
public field returns a stale-cursor error instead of combining different
reconstructed snapshots. Fingerprinting processes only bounded public identity
and projected fields, including full public text under an explicit work bound.
It never serializes raw native items or reads private reasoning, encrypted
content, hook instructions, credential metadata or media bytes.

The adapter retains only bounded projected windows and source metadata. Complete
history remains in the official CLI. Historical API fixtures use fictional
text and identifiers; the production response used to diagnose this issue is
not published in source or fixtures.

Implementation: `server/codex-cli/{history,history-identity,native-view,conversations}.ts`
and `client/components/chat/history-cache.ts`. Behavioral checks include
materialization retry, independent thread modes, public-only fingerprinting,
partial pages, repeated genuine text, same-cache revert, cache eviction,
delayed attachments, newer-turn races, cursor direction and actual ChatPanel
rendering.

Official source references:
[thread processor](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/app-server/src/request_processors/thread_processor.rs),
[legacy history builder](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/app-server-protocol/src/protocol/thread_history.rs).
The runtime probes independently establish behavior; exported schemas alone
are not treated as implementation or provider-availability proof.
