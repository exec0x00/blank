# Native app-server method matrix

Reviewed against the official `codex-cli 0.159.2` executable and npm `@openai/codex@latest` on 2026-09-30. The TypeScript generator declares 170 client requests, 11 server requests, 85 server notifications and one client notification; 873 generated data/envelope types are retained. JSON schema declares 167 client requests and 83 notifications. The differences are three retired legacy requests and two private raw-response notifications.

`implemented` means the website has a concrete, bounded handler. It does **not** mean an account, provider, feature flag or native storage engine accepts every invocation. Runtime rejections are shown and uncertain mutations are not replayed. `excluded` reflects the current owner/provider/host/platform constraints. `not-exposed` is explicitly typed protocol infrastructure without a public action; it is not a universal RPC proxy.

Current classification: **129 implemented request handlers, 32 constrained exclusions, 9 protocol/legacy internals without a public action**.

| Method | Integration | Area |
|---|---|---|
| `account/bedrock/discover` | excluded | Owner model service |
| `account/bedrock/setup` | excluded | Owner model service |
| `account/gatewayOAuth/cancel` | excluded | Owner model service |
| `account/gatewayOAuth/login` | excluded | Owner model service |
| `account/gatewayOAuth/read` | excluded | Owner model service |
| `account/login/cancel` | excluded | Owner model service |
| `account/login/start` | excluded | Owner model service |
| `account/logout` | excluded | Owner model service |
| `account/rateLimitResetCredit/consume` | excluded | Owner model service |
| `account/rateLimits/read` | excluded | Owner model service |
| `account/read` | excluded | Owner model service |
| `account/sendAddCreditsNudgeEmail` | excluded | Owner model service |
| `account/usage/read` | excluded | Owner model service |
| `account/workspaceMessages/read` | excluded | Owner model service |
| `app/installed` | implemented | Plugins and apps |
| `app/list` | implemented | Plugins and apps |
| `app/read` | implemented | Plugins and apps |
| `collaborationMode/list` | implemented | Discovery and import |
| `command/exec` | implemented | Native tasks |
| `command/exec/resize` | implemented | Native tasks |
| `command/exec/terminate` | implemented | Native tasks |
| `command/exec/write` | implemented | Native tasks |
| `config/batchWrite` | implemented | Native settings |
| `config/mcpServer/reload` | implemented | MCP and verification |
| `config/read` | implemented | Native settings |
| `config/value/write` | implemented | Native settings |
| `configRequirements/read` | implemented | Native settings |
| `environment/add` | excluded | Remote execution |
| `environment/info` | excluded | Remote execution |
| `environment/status` | excluded | Remote execution |
| `experimentalFeature/enablement/set` | implemented | Discovery and import |
| `experimentalFeature/list` | implemented | Discovery and import |
| `externalAgentConfig/detect` | implemented | Discovery and import |
| `externalAgentConfig/import` | implemented | Discovery and import |
| `externalAgentConfig/import/readHistories` | implemented | Discovery and import |
| `externalAgentConfig/import/recordHistory` | implemented | Discovery and import |
| `feedback/upload` | implemented | Discovery and import |
| `fs/copy` | implemented | Files and search |
| `fs/createDirectory` | implemented | Files and search |
| `fs/getMetadata` | implemented | Files and search |
| `fs/readDirectory` | implemented | Files and search |
| `fs/readFile` | implemented | Files and search |
| `fs/remove` | implemented | Files and search |
| `fs/unwatch` | implemented | Files and search |
| `fs/watch` | implemented | Files and search |
| `fs/writeFile` | implemented | Files and search |
| `fuzzyFileSearch` | implemented | Files and search |
| `fuzzyFileSearch/sessionStart` | implemented | Files and search |
| `fuzzyFileSearch/sessionStop` | implemented | Files and search |
| `fuzzyFileSearch/sessionUpdate` | implemented | Files and search |
| `getAuthStatus` | not-exposed | Native protocol internals |
| `getConversationSummary` | not-exposed | Native protocol internals |
| `gitDiffToRemote` | not-exposed | Native protocol internals |
| `hooks/list` | implemented | Discovery and import |
| `initialize` | implemented | Conversations and runtime |
| `marketplace/add` | implemented | Plugins and apps |
| `marketplace/remove` | implemented | Plugins and apps |
| `marketplace/upgrade` | implemented | Plugins and apps |
| `mcpServer/event/stream/start` | implemented | MCP and verification |
| `mcpServer/event/stream/stop` | implemented | MCP and verification |
| `mcpServer/oauth/login` | implemented | MCP and verification |
| `mcpServer/resource/read` | implemented | MCP and verification |
| `mcpServer/tool/call` | implemented | MCP and verification |
| `mcpServerStatus/list` | implemented | MCP and verification |
| `memory/reset` | implemented | Organization |
| `memory/status` | implemented | Organization |
| `mock/experimentalMethod` | not-exposed | Native protocol internals |
| `model/list` | implemented | Conversations and runtime |
| `modelProvider/capabilities/read` | implemented | Discovery and import |
| `permissionProfile/list` | implemented | Discovery and import |
| `plugin/install` | implemented | Plugins and apps |
| `plugin/installed` | implemented | Plugins and apps |
| `plugin/list` | implemented | Plugins and apps |
| `plugin/read` | implemented | Plugins and apps |
| `plugin/reconcile` | implemented | Plugins and apps |
| `plugin/search` | implemented | Plugins and apps |
| `plugin/share/checkout` | implemented | Plugins and apps |
| `plugin/share/delete` | implemented | Plugins and apps |
| `plugin/share/list` | implemented | Plugins and apps |
| `plugin/share/save` | implemented | Plugins and apps |
| `plugin/share/updateTargets` | implemented | Plugins and apps |
| `plugin/skill/read` | implemented | Plugins and apps |
| `plugin/uninstall` | implemented | Plugins and apps |
| `process/kill` | implemented | Native tasks |
| `process/resizePty` | implemented | Native tasks |
| `process/spawn` | implemented | Native tasks |
| `process/writeStdin` | implemented | Native tasks |
| `project/create` | implemented | Organization |
| `project/delete` | implemented | Organization |
| `project/import` | implemented | Organization |
| `project/list` | implemented | Organization |
| `project/move` | implemented | Organization |
| `project/read` | implemented | Organization |
| `project/update` | implemented | Organization |
| `remoteControl/client/list` | excluded | Remote execution |
| `remoteControl/client/revoke` | excluded | Remote execution |
| `remoteControl/disable` | excluded | Remote execution |
| `remoteControl/enable` | excluded | Remote execution |
| `remoteControl/pairing/start` | excluded | Remote execution |
| `remoteControl/pairing/status` | excluded | Remote execution |
| `remoteControl/status/read` | excluded | Remote execution |
| `review/start` | implemented | Conversations and runtime |
| `rollout/compress` | implemented | Organization |
| `server/diagnostics` | implemented | Discovery and import |
| `skills/config/write` | implemented | Conversations and runtime |
| `skills/extraRoots/set` | implemented | Discovery and import |
| `skills/list` | implemented | Conversations and runtime |
| `thread/approveGuardianDeniedAction` | not-exposed | Native protocol internals |
| `thread/archive` | implemented | Conversations and runtime |
| `thread/attachment/add` | implemented | Files and search |
| `thread/attachment/list` | implemented | Files and search |
| `thread/attachment/remove` | implemented | Files and search |
| `thread/backgroundTerminals/clean` | implemented | Native tasks |
| `thread/backgroundTerminals/list` | implemented | Native tasks |
| `thread/backgroundTerminals/terminate` | implemented | Native tasks |
| `thread/compact/start` | implemented | Conversations and runtime |
| `thread/decrement_elicitation` | not-exposed | Native protocol internals |
| `thread/delete` | implemented | Conversations and runtime |
| `thread/fork` | implemented | Conversations and runtime |
| `thread/goal/clear` | implemented | Conversations and runtime |
| `thread/goal/get` | implemented | Conversations and runtime |
| `thread/goal/set` | implemented | Conversations and runtime |
| `thread/increment_elicitation` | not-exposed | Native protocol internals |
| `thread/inject_items` | not-exposed | Native protocol internals |
| `thread/items/list` | implemented | Conversations and runtime |
| `thread/list` | implemented | Conversations and runtime |
| `thread/loaded/list` | implemented | Conversations and runtime |
| `thread/memoryMode/set` | implemented | Organization |
| `thread/metadata/update` | implemented | Organization |
| `thread/name/set` | implemented | Conversations and runtime |
| `thread/queue/add` | implemented | Conversations and runtime |
| `thread/queue/delete` | implemented | Conversations and runtime |
| `thread/queue/list` | implemented | Organization |
| `thread/queue/reorder` | implemented | Conversations and runtime |
| `thread/queue/start` | implemented | Conversations and runtime |
| `thread/queue/update` | implemented | Conversations and runtime |
| `thread/read` | implemented | Organization |
| `thread/realtime/appendAudio` | excluded | Realtime |
| `thread/realtime/appendSpeech` | excluded | Realtime |
| `thread/realtime/appendText` | excluded | Realtime |
| `thread/realtime/listVoices` | excluded | Realtime |
| `thread/realtime/start` | excluded | Realtime |
| `thread/realtime/stop` | excluded | Realtime |
| `thread/resume` | implemented | Conversations and runtime |
| `thread/revert` | implemented | Conversations and runtime |
| `thread/search` | implemented | Files and search |
| `thread/searchOccurrences` | implemented | Files and search |
| `thread/section/move` | implemented | Organization |
| `thread/settings/update` | implemented | Conversations and runtime |
| `thread/shellCommand` | implemented | Native tasks |
| `thread/start` | implemented | Conversations and runtime |
| `thread/timeline/list` | not-exposed | Native protocol internals |
| `thread/turns/list` | implemented | Conversations and runtime |
| `thread/unarchive` | implemented | Conversations and runtime |
| `thread/unsubscribe` | implemented | Conversations and runtime |
| `threadSection/create` | implemented | Organization |
| `threadSection/delete` | implemented | Organization |
| `threadSection/list` | implemented | Organization |
| `threadSection/update` | implemented | Organization |
| `turn/interrupt` | implemented | Conversations and runtime |
| `turn/settings/update` | implemented | Current turn |
| `turn/start` | implemented | Conversations and runtime |
| `turn/steer` | implemented | Conversations and runtime |
| `userVerification/cancel` | implemented | MCP and verification |
| `userVerification/delete` | implemented | MCP and verification |
| `userVerification/enroll` | implemented | MCP and verification |
| `userVerification/status` | implemented | MCP and verification |
| `userVerification/verify` | implemented | MCP and verification |
| `windowsSandbox/readiness` | excluded | Platform |
| `windowsSandbox/setupStart` | excluded | Platform |

## Exclusions and internal boundaries

- `account/bedrock/discover`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/bedrock/setup`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/gatewayOAuth/cancel`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/gatewayOAuth/login`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/gatewayOAuth/read`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/login/cancel`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/login/start`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/logout`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/rateLimitResetCredit/consume`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/rateLimits/read`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/read`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/sendAddCreditsNudgeEmail`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/usage/read`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `account/workspaceMessages/read`: Account sign-in, provider switching and ChatGPT billing/account controls are excluded by the fixed owner Responses service contract.
- `environment/add`: Remote control/environment setup requires separately supplied access and an explicit remote task; the hosted workspace does not create that authority.
- `environment/info`: Remote control/environment setup requires separately supplied access and an explicit remote task; the hosted workspace does not create that authority.
- `environment/status`: Remote control/environment setup requires separately supplied access and an explicit remote task; the hosted workspace does not create that authority.
- `getAuthStatus`: Retired legacy request absent from the installed JSON request schema; provider authentication is fixed by the owner.
- `getConversationSummary`: Retired legacy request present only in generated TypeScript, absent from the installed JSON request schema. Native thread/history APIs replace it.
- `gitDiffToRemote`: Retired legacy request present only in generated TypeScript, absent from the installed JSON request schema. Existing repository tools handle Git diffs.
- `mock/experimentalMethod`: An upstream experimental protocol fixture, not a product operation.
- `remoteControl/client/list`: Remote control/environment setup requires separately supplied access and an explicit remote task; the hosted workspace does not create that authority.
- `remoteControl/client/revoke`: Remote control/environment setup requires separately supplied access and an explicit remote task; the hosted workspace does not create that authority.
- `remoteControl/disable`: Remote control/environment setup requires separately supplied access and an explicit remote task; the hosted workspace does not create that authority.
- `remoteControl/enable`: Remote control/environment setup requires separately supplied access and an explicit remote task; the hosted workspace does not create that authority.
- `remoteControl/pairing/start`: Remote control/environment setup requires separately supplied access and an explicit remote task; the hosted workspace does not create that authority.
- `remoteControl/pairing/status`: Remote control/environment setup requires separately supplied access and an explicit remote task; the hosted workspace does not create that authority.
- `remoteControl/status/read`: Remote control/environment setup requires separately supplied access and an explicit remote task; the hosted workspace does not create that authority.
- `thread/approveGuardianDeniedAction`: The native call takes a serialized internal GuardianAssessmentEvent. No browser endpoint accepts arbitrary assessment replay; native review outcomes remain visible.
- `thread/decrement_elicitation`: Out-of-band counters are internal client lifecycle primitives; native question and MCP callbacks do not need synthetic site blockers.
- `thread/increment_elicitation`: Out-of-band counters are internal client lifecycle primitives; native question and MCP callbacks do not need synthetic site blockers.
- `thread/inject_items`: Raw Responses-item history injection is not exposed. User input and attachments use authorized native turn and queue APIs.
- `thread/realtime/appendAudio`: The owner endpoint does not support the tested native realtime startup. The user explicitly requested omitting realtime audio.
- `thread/realtime/appendSpeech`: The owner endpoint does not support the tested native realtime startup. The user explicitly requested omitting realtime audio.
- `thread/realtime/appendText`: The owner endpoint does not support the tested native realtime startup. The user explicitly requested omitting realtime audio.
- `thread/realtime/listVoices`: The owner endpoint does not support the tested native realtime startup. The user explicitly requested omitting realtime audio.
- `thread/realtime/start`: The owner endpoint does not support the tested native realtime startup. The user explicitly requested omitting realtime audio.
- `thread/realtime/stop`: The owner endpoint does not support the tested native realtime startup. The user explicitly requested omitting realtime audio.
- `thread/timeline/list`: The combined ordinary/realtime timeline is typed; the existing paged history view uses native item/turn APIs with verified legacy fallback. Realtime presentation is excluded.
- `windowsSandbox/readiness`: This is a Linux host; Windows sandbox provisioning is not an applicable product action.
- `windowsSandbox/setupStart`: This is a Linux host; Windows sandbox provisioning is not an applicable product action.

The compile-time exhaustive source is `server/codex-cli/protocol/coverage.ts`; the reproducible protocol generator is `scripts/update-codex-protocol.mjs`. See [official app-server documentation](https://developers.openai.com/codex/app-server).

## Server-initiated requests

The transport handles every envelope and routes supported requests through exactly one owner. Unavailable callbacks receive a bounded native error; they are not executed as arbitrary tool calls.

| Native callback | Behavior |
|---|---|
| `item/commandExecution/requestApproval` | Bounded full command/stdin, network/filesystem scope, exact offered native amendment responses, opaque callback-scoped choices. |
| `item/fileChange/requestApproval` | Native file-change approval with exact callback identity and requested write root. |
| `item/tool/requestUserInput` | Explicit structured questions; original native choice values retained privately; secret answers never stored in public history. |
| `mcpServer/elicitation/request` | Structured form/URL/native verification dialogs; verified descendant scope; server-retained original request and proof. |
| `item/permissions/requestApproval` | Exact requested permissions only, turn/session scope, optional explicit strict command review. |
| `item/tool/call` | Typed and rejected unless a site extension deliberately registers a handler; no dynamic tool executor or raw proxy is synthesized. |
| `account/chatgptAuthTokens/refresh` | Excluded by fixed owner-provider authentication; no external ChatGPT-token lifecycle. |
| `attestation/generate` | Not advertised during initialize; no fabricated attestation. |
| `currentTime/read` | Runtime-owned whole Unix seconds reply. |
| `applyPatchApproval` | Legacy callback not used by the current v2 bridge; unavailable response. |
| `execCommandApproval` | Legacy callback not used by the current v2 bridge; unavailable response. |

## Notification disposition

All 85 generated notification types are retained. A notification being typed or transported is not a promise that it belongs in a human timeline. Private responses and unsupported account/realtime/platform events remain excluded; unneeded lifecycle metadata does not create fake history.

| Notification | Website handling |
|---|---|
| `error` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/started` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/status/changed` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/archived` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/deleted` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/unarchived` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/closed` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/reverted` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `skills/changed` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `thread/name/updated` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/attachment/updated` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/goal/updated` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/goal/cleared` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/queue/changed` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `project/changed` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `thread/project/updated` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `thread/environment/connected` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `thread/environment/disconnected` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `thread/settings/updated` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/tokenUsage/updated` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `turn/started` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `hook/started` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `turn/completed` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `hook/completed` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `turn/diff/updated` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `turn/plan/updated` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/started` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/autoApprovalReview/started` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/autoApprovalReview/completed` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `autoApprovalReview/strictReviewRequired` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/completed` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `rawResponseItem/completed` | Private/raw model content: explicitly opted out during initialization and never presented. |
| `rawResponse/completed` | Private/raw model content: explicitly opted out during initialization and never presented. |
| `item/agentMessage/delta` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/plan/delta` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `command/exec/outputDelta` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `process/outputDelta` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `process/exited` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/commandExecution/outputDelta` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/commandExecution/terminalInteraction` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/fileChange/outputDelta` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/fileChange/patchUpdated` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `serverRequest/resolved` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/mcpToolCall/progress` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `mcpServer/oauthLogin/completed` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `mcpServer/startupStatus/updated` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `mcpServer/event/stream/notification` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `account/updated` | Excluded by the current provider/host/platform/realtime contract. |
| `account/gatewayOAuth/changed` | Excluded by the current provider/host/platform/realtime contract. |
| `account/rateLimits/updated` | Excluded by the current provider/host/platform/realtime contract. |
| `app/list/updated` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `remoteControl/status/changed` | Excluded by the current provider/host/platform/realtime contract. |
| `externalAgentConfig/import/progress` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `externalAgentConfig/import/completed` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `fs/changed` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/reasoning/summaryTextDelta` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/reasoning/summaryPartAdded` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `item/reasoning/textDelta` | Private/raw model content: explicitly opted out during initialization and never presented. |
| `thread/compacted` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `model/rerouted` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `model/verification` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `modelProvider/authRecoveryStarted` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `modelProvider/authRecoveryCompleted` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `turn/moderationMetadata` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `model/safetyBuffering/updated` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `warning` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `guardianWarning` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `deprecationNotice` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `configWarning` | Typed metadata notification; no synthetic state/action or public history row is manufactured. |
| `fuzzyFileSearch/sessionUpdated` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `fuzzyFileSearch/sessionCompleted` | Bounded native lifecycle, state, activity, or feature handler; canonical identity and generation preserved. |
| `thread/realtime/started` | Excluded by the current provider/host/platform/realtime contract. |
| `thread/realtime/itemAdded` | Excluded by the current provider/host/platform/realtime contract. |
| `thread/realtime/item/started` | Excluded by the current provider/host/platform/realtime contract. |
| `thread/realtime/item/transcript/delta` | Excluded by the current provider/host/platform/realtime contract. |
| `thread/realtime/item/completed` | Excluded by the current provider/host/platform/realtime contract. |
| `thread/realtime/transcript/delta` | Excluded by the current provider/host/platform/realtime contract. |
| `thread/realtime/transcript/done` | Excluded by the current provider/host/platform/realtime contract. |
| `thread/realtime/outputAudio/delta` | Excluded by the current provider/host/platform/realtime contract. |
| `thread/realtime/sdp` | Excluded by the current provider/host/platform/realtime contract. |
| `thread/realtime/error` | Excluded by the current provider/host/platform/realtime contract. |
| `thread/realtime/closed` | Excluded by the current provider/host/platform/realtime contract. |
| `windows/worldWritableWarning` | Excluded by the current provider/host/platform/realtime contract. |
| `windowsSandbox/setupCompleted` | Excluded by the current provider/host/platform/realtime contract. |
| `account/login/completed` | Excluded by the current provider/host/platform/realtime contract. |

## Runtime evidence and limits

The September 30 history follow-up independently verified native default
paginated creation, mode/materialization-specific list support, preserved
resume/fork modes and paginated-only native revert. It adds explicit per-turn
identity/coverage handoff and stale-read/cursor fencing without rewriting
existing history. See [native history identity](NATIVE_HISTORY_IDENTITY.md).

- Official 0.159.2, isolated state, no model calls: native command/process pipe input, PTY resize, output-before-exit ordering and thread shell formatting were exercised.
- Official 0.159.2, isolated state: file reads, directory/metadata, one-shot/live fuzzy search, watch/unwatch and `fs/changed` were exercised. Watch paths actually use the retained process descriptor spelling, so the bridge maps only its own descriptor back into the checked workspace.
- Official 0.159.2: diagnostics, hooks, provider-capability metadata, permission profiles, feature/mode catalogs and external-import detection/history were read successfully. Provider-capability metadata is not a provider request test.
- Mutation boundaries such as project/plugin changes, configuration imports, OAuth, account-native verification and current-turn changes have focused protocol/security fixtures. Success is claimed only from actual native acknowledgments in the product.
- Native keyring-only OAuth mode is checked before dispatch. Official 0.159.2 source confirms it does not fall back to plaintext files. Native keyring/identity unavailability remains visible; the fixed owner service does not supply a ChatGPT sign-in flow.
- Native event subscriptions currently accept only hosted `codex_apps` events. There is no public app-server event-name catalog; ordinary MCP tools are not mislabeled as event subscriptions.
- `npm run test:native-ui` runs all six new feature families’ reproducible browser checks. CI installs Chromium dependencies before these checks. Core protocol, approval, queue, lifecycle and feature boundary tests run with `npm test`.
