# Native command hooks

The TypeScript hook runtime follows the official Codex source pinned at
`78245b47af2a7aafcabe025828ceecca69db4df1`. Hooks are a stable, enabled-by-default
upstream feature at that commit. This module runs actual host commands; it does
not invoke a Rust executable, install scripts, an MCP server, or a container.

`server/agent/hooks.ts` provides discovery, selection, inherited approval,
command execution, output validation, asynchronous completion, and context
preservation. `server/agent/hook-engine.ts` connects those operations to the
enabled-plugin registry, visible activities, shared change review, and model
context callbacks. The main engine decides the real lifecycle boundaries. A
module existing on disk is not evidence that a deployed engine has connected
those boundaries.

## Plugin configuration

An enabled plugin can supply its manifest's `hooks` value as a relative JSON
file path, an array of paths, an inline hook document, or an array of inline
documents. Without a declaration, discovery checks `hooks/hooks.json` in the
plugin. File paths remain inside the canonical plugin directory. Repeated paths
are loaded once; distinct declarations remain distinct.

An inline declaration has its own `hooks` envelope:

```json
{
  "name": "generated-file-check",
  "hooks": {
    "description": "Check edits before they run.",
    "hooks": {
      "PreToolUse": [
        {
          "matcher": "Write|Edit",
          "hooks": [
            {
              "type": "command",
              "command": "node \"${PLUGIN_ROOT}/scripts/check-edit.mjs\"",
              "timeout": 10,
              "statusMessage": "Checking generated files"
            }
          ]
        }
      ]
    }
  }
}
```

For a separate `hooks/hooks.json`, its contents begin with `description` and
`hooks`, without the plugin manifest's outer `hooks` property.

Supported command fields are `type`, `command`, `commandWindows` (or
`command_windows`), `timeout` in seconds, `async`, `statusMessage`, and
`additionalContextLimit`. The Linux host uses `command`. Unsupported fields,
events, and handler types produce visible catalog issues. `prompt` and `agent`
handler types are also unsupported by the pinned upstream implementation. MCP
hooks are deliberately excluded by the workspace owner's instructions.

Installing, importing, updating, enabling, and discovering a plugin do not run
its commands. Hook execution occurs only at a connected runtime event.

## Execution and permissions

Commands run in the event's validated workspace directory. JSON arrives on
standard input with Codex's snake_case event fields. The runtime supplies
`hook_event_name`, `session_id`, `cwd`, `transcript_path`, and the appropriate
event-specific fields. It derives `permission_mode` from the effective parent
policy: `default` for Ask, `bypassPermissions` for Full access, and `plan` for
Plan. A hook input cannot override that policy or set a provider/API address.

The environment uses the same credential-free allowlist as normal agent tools.
Only server-validated plugin paths are added as `PLUGIN_ROOT`,
`CLAUDE_PLUGIN_ROOT`, and, when available, `PLUGIN_DATA` and
`CLAUDE_PLUGIN_DATA`. Shell expansion supports the usual `${PLUGIN_ROOT}` form.
JSON and path values never become unquoted shell syntax. This implementation
feeds stdin through a private temporary file because the shared process manager
owns command lifecycle and process-tree cleanup. That file is removed after
success, failure, timeout, or cancellation.

Ask requires approval for every command invocation, including background hooks.
The approval includes the source, fingerprint, exact redacted command, directory,
deadline, and asynchronous flag. Missing approval support or a declined request
produces a denied result without starting a process. Plan skips command hooks.
The required `allowCommands` option also skips them during read-only reviews,
read-only compaction, and roles whose effective `shellTool` capability is false.
It is derived by the host from the inherited policy, never from hook input or
output. Full access cannot override a false command capability.
Full access still enforces the platform's prohibitions on mounting, proot,
containers, sandboxes, and network proxies. Hooks cannot enlarge a child's
inherited permissions.

`PermissionRequest`'s `allow` result is advisory in this workspace. It cannot
replace the normal inherited tool approval. `PreToolUse.updatedInput` must pass
through the ordinary tool argument validation, command restrictions, and
approval **after** the hook completes. Hook approval is not tool approval.

Every invocation emits queued, approval (when needed), running, and final
lifecycle states through the host callback. Skipped and denied hooks have a final
state without a running state. Errors, cancellation, timeouts, and nonzero exits
remain distinguishable. `suppressOutput` can hide ordinary output where Codex
supports it; it does not turn a failure into success or hide lifecycle state.

## Event behavior

| Event | Matcher input | Supported effects |
| --- | --- | --- |
| `SessionStart` | `startup`, `resume`, `clear`, `compact`, or `fork` | Plain stdout or `additionalContext`; `continue:false` stops processing. |
| `UserPromptSubmit` | Ignored | Plain stdout or context; block rejects this user submission; `continue:false` stops processing. |
| `PreToolUse` | Canonical tool name and compatibility aliases | Deny/block prevents execution; valid input replacement is revalidated before use. |
| `PermissionRequest` | Canonical tool name and aliases | Deny wins; allow is advisory and preserves workspace approval. |
| `PostToolUse` | Canonical tool name and aliases | Context; block rejects the returned result; `continue:false` produces model feedback. Completed tool side effects remain. |
| `SubagentStart` | Agent type | Plain stdout or context. `continue:false` cannot stop the child. |
| `SubagentStop` | Agent type | Block requests another child iteration; `continue:false` finishes it. |
| `Stop` | Ignored | Block requests another model iteration; `continue:false` finishes it. |
| `PreCompact` | `manual` or `auto` | System message; `continue:false` prevents compaction and stops processing. |
| `PostCompact` | `manual` or `auto` | System message; `continue:false` stops further processing after successful compaction. |
| `Interrupt` | Ignored | Empty stdout or JSON with `systemMessage`; no flow control or added context. |
| `SessionEnd` | `other` | Observational cleanup; all stdout is ignored and shutdown cannot be blocked. |

Only `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `Stop`,
and `SubagentStop` interpret exit code 2 with nonempty stderr as a block/deny.
Exit 2 without a reason and other exit codes are failures. A failing hook is
reported and otherwise fails open, following Codex's hook semantics. Hooks are
not a replacement for mandatory tool policy enforcement.

Structured output must be a valid single JSON object. JSON-looking malformed
stdout is a failure, rather than an apparent successful no-op. For example:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Edit the source instead of the generated file.",
    "additionalContext": "The source file is src/schema.ts."
  }
}
```

For a pre-tool replacement, `permissionDecision:"allow"` must accompany an
`updatedInput` object. It grants no permission. The deprecated top-level
`decision:"approve"`, `permissionDecision:"ask"`, and pre-tool `continue:false`
are invalid upstream. `PermissionRequest` cannot update inputs or permissions.
No event can change the managed model service.

Foreground `Stop` and `SubagentStop` require empty stdout or structured output;
ordinary prose is a failure. Background hooks retain valid context and system
messages while ignoring control-semantic errors, such as a block with no reason.
An asynchronous nonzero exit is always a failure, including exit code 2.

Synchronous handlers receive the same original input and run concurrently in a
bounded pool. Results, context, and blocking reasons retain declaration order.
The last **completed** valid pre-tool rewrite wins, matching upstream; any
blocking pre-hook discards all replacements. Multiple aliases never cause one
declaration to run twice. `apply_patch` stays the payload tool name while `Write`
and `Edit` also match; `spawn_agent` also matches `Agent`; shell commands use
`Bash`. The workspace's additional `write_file` tool retains its canonical name
and also matches `Write`/`Edit`, covering both available mutation paths.

Omitted, empty, or `*` matchers match every event value. ASCII alphanumeric,
underscore, and pipe-only patterns use exact case-sensitive alternatives.
Other patterns use a bounded, non-backtracking expression matcher. Literals,
anchors, groups, alternation, character classes, `*`, `+`, `?`, and repetitions
up to 64 are supported. `\w` and `\d` cover ASCII identifiers and digits. Inline
flags, Unicode property classes, lookarounds, and backreferences are rejected
with an explicit diagnostic. The supported subset avoids exposing Node's main
thread to catastrophic regular-expression backtracking.

## Background work and bounds

`async:true` returns after launching an approved command. Its eventual context,
messages, and failures are available through `drainBackground()` for the next
safe model boundary. Its output cannot block, approve, stop, or rewrite the
triggering action. Attempts to do so produce an explanatory message. Unlike the
pinned CLI, this workspace displays background lifecycle events and cancels
background commands when the initiating run is interrupted. Session shutdown
also cancels all owned commands and pending approvals. `SessionEnd` is always
synchronous, with a diagnostic if configured otherwise.

The runtime uses these intentional resource bounds:

- 64 plugin sources, 32 hook documents per plugin, and 128 enabled handlers.
- 64 KiB per hook configuration, 2 MiB per loaded catalog, and 256 discovery
  diagnostics. The catalog stops with an explicit limit diagnostic.
- 1 MiB JSON stdin and 64 KiB combined stdout and
  stderr per command. Overflow stops the command and fails the hook.
- Eight active commands per runner. Synchronous work waits for a slot;
  additional background work reports that it was skipped. At most 128
  undelivered background results may accumulate.
- A 600-second normal timeout. `SessionEnd` and `Interrupt` default to one second
  and are capped at three. A host-controlled cap can only shorten deadlines.
- 512 matcher characters, 1,024 NFA states, and 512 characters per match input.

`additionalContextLimit` defaults to an approximate 2,500 tokens; zero disables
spilling. `renderNativeHookContext` preserves oversized full text unencrypted
inside `.codex/hook-outputs/<thread-hash>/` in the native persistent workspace,
then returns a UTF-8-safe head/tail preview and a recovery path usable with
`read_file`. The small recovery footer is in addition to the configured preview
budget. A preservation failure returns a warning and an explicitly truncated
preview; it never claims a missing file exists. The engine should also use this
helper for long Stop continuation reasons, with the default limit. Hook outputs
are workspace files and inherit the owner's public-bucket storage policy.

## Integration contract

The extension registry supplies `NativePluginHookSource[]` for enabled, validated
plugins. `loadNativePluginHooks` returns handlers plus issues. Discovery issues
belong in the visible extensions catalog and/or current thread. A
`NativeHookRunner` is owned by a thread/session, and the engine must close it
during shutdown and thread deletion.

```ts
const catalog = await loadNativePluginHooks(enabledPluginSources);
const hooks = new NativeHookRunner({
  environment: hostToolEnvironment,
  runtimeDir: privateRuntimeDirectory,
});
const result = await hooks.run(catalog, 'PreToolUse', {
  session_id: thread.id,
  turn_id: run.id,
  cwd: workspace.path,
  transcript_path: null,
  model: run.model,
  tool_name: hookTool.toolName,
  tool_use_id: call.id,
  tool_input: args,
}, {
  mode: run.mode,
  permissionMode: run.permissionMode,
  allowCommands: !isReadOnlyWork && effectiveRole.shellTool !== false,
  workspaceRoot: workspace.path,
  signal: run.signal,
  matcherAliases: hookTool.matcherAliases,
  redact,
  onLifecycle: publishAndPersistHookActivity,
  requestApproval: askForHookCommandApproval,
});
```

The engine consumes `blocked`, `stopped`, `feedback`, `updatedInput`, advisory
permission decisions, context, and system messages at their event-specific
boundaries. It must not dispatch `PostToolUse` for a failed tool, submit agent
messages as `UserPromptSubmit`, or call `Stop` before real background commands
and delegated work have been collected. A blocked Stop repeats the model loop
with `stop_hook_active:true` and remains subject to the workspace's turn limit.
Run `Interrupt` with a separate bounded cleanup signal after the original run
has been cancelled; passing the already-aborted signal correctly skips command
execution. Root-only `Interrupt` and `SessionEnd`, and child start/stop placement,
remain engine responsibilities.

Hook commands can edit files, so the integration must include their real changes
in the existing shared workspace review baseline. The hook runner does not
pretend to undo post-tool side effects.

## Per-run engine bridge

`createNativeHookSession(options)` creates a `NativeHookSession`. Required options
are `ctx`, `workspaceId`, `threadId`, `runId`, `workspaceRoot`, `model`, `mode`,
`permissionMode`, `allowCommands`, `signal`, `redact`, the shared
`WorkspaceGroupReview`, and three callbacks: `publishActivity(ToolActivity)`,
`appendContext(text)`, and `notify(text)`. Ask also needs
`requestApproval(NativeHookApproval, signal)` connected to the actual user
approval path. Optional `pluginsEnabled`, `parentThreadId`, `agentType`, and
workspace-relative `cwd` preserve the effective role and child identity.

The bridge calls `ExtensionsService.hookSources(workspaceId, {cwd,
pluginsEnabled})` only when Agent mode, command capability, and plugin capability
all permit execution. Plan and read-only roles therefore do not even create
plugin data directories. A host may supply already-authorized `sources` instead;
the same policy gates still apply. Discovery never executes commands.

| Bridge method | Contract |
| --- | --- |
| `dispatch(event, extra?, {signal?, allowCommands?}?)` | Dispatch any official event. Per-event signals and command overrides can only restrict the run, useful for read-only compaction. |
| `beforeTool(name, args, callId)` | Select canonical names/aliases and return block/rewrite decisions. Does not execute the proposed tool. |
| `permissionTool(name, args, callId)` | Return deny or advisory allow. Does not satisfy normal tool approval. |
| `afterTool(name, args, callId, response)` | Dispatch after actual successful tool invocation. The engine owns whether the invocation succeeded. |
| `stop(lastText, stopHookActive?)` | Use `SubagentStop` for child sessions, otherwise `Stop`. Preserve full long reasons before returning model previews. |
| `drain()` | Consume completed asynchronous results and append context at the caller's safe model boundary. |
| `interrupt()` / `end()` | Root-only cleanup with a fresh deadline signal. Stop existing hooks first; preserve inherited Ask and command restrictions. |
| `close()` | Cancel owned work, drain results, and retry unfinished review checkpoints with a short bounded wait. Call before disposing the shared review group. Idempotent. |
| `waitForBookkeeping(signal?)` | Explicitly await any deferred filesystem review without starting commands; returns false if the supplied signal cancels the wait. |

`awaitExecutionAllowed?(signal, event?)` is an optional host maintenance/goal-pause
fence. It is awaited with cancellation before baseline capture and again after
the filesystem await, before a process can start. If capture completes after
cancellation, its local review token is released before storage or execution.
Late resolution of a cancelled fence cannot launch a command.
For `Interrupt`/`SessionEnd`, the host fence must use the supplied bounded cleanup
signal rather than waiting on the original run's maintenance or aborted signal.

The runner's host-only `beforeExec`/`afterExec` callbacks bracket real processes
separately from lifecycle publication. The bridge uses them for
`review.beforeCommand()` and `review.afterCommand(token)`. Failed commands,
blocking hooks, asynchronous work, startup failures, and cancellation all close
their review interval. A failure to capture a baseline prevents execution; a
failed final checkpoint is reported and retried at close. The bridge never
disposes another agent's shared review group.

Cancellation stops waiting on a stalled snapshot without losing its ownership.
Acquisition and late cancellation release share one review transaction, and final
snapshots remain in the shared review queue. Pending work is exposed as
`review_pending` in the activity, with a later completion or failure update.
`close` allows up to 250 ms for this bookkeeping (or the smaller configured
cleanup deadline), then returns while retaining deferred work. Shared
`review.dispose()` preserves final filesystem ordering; a host can also call
`waitForBookkeeping` explicitly. No process can start when a cancelled capture
eventually completes.

Each hook has one stable activity ID across queued, approval, running, and final
updates. Activity arguments contain hook metadata and its configured command,
without copying the triggering user prompt or tool arguments. Structured
activity output is redacted before JSON serialization. Discovery issues are
also visible. Context callbacks run after synchronous dispatch or explicit
`drain`, never from an asynchronous activity publication.

Cleanup has a host-controlled deadline of at most three seconds, including Ask
approval waits; process termination and review bookkeeping follow cancellation.
Async Interrupt hooks get that bounded opportunity to execute before teardown.
Normal run cancellation cannot accidentally disable cleanup by reusing an
already-aborted signal. A hook approval callback must honor the supplied signal;
the wrapper also races cancellation when the host callback stalls. Cleanup never
grants permission automatically.

## Verification and source references

`tests/native-hooks.test.ts` runs actual shells and Node processes. It covers
stdin/environment, file side effects, Ask/Plan denial, approval cancellation,
timeout and exit-code distinction, process-tree cancellation, bounded output,
concurrent rewrites, async completion and shutdown, malformed JSON, event
decisions, regex complexity, safe discovery, and durable context preservation.
`tests/hook-engine.test.ts` additionally uses the real extension registry,
`WorkspaceGroupReview`, and `ChangeTracker`: real edits and Undo, failed-command
review, asynchronous capture/draining, read-only discovery guards, pause fences,
child/root lifecycle separation, approval deadlines, and cancellation during
baseline capture. `tests/extensions-hooks.test.ts` verifies source provenance,
durable plugin data roots, enablement, updates, rollback, and no import execution.
`tests/agent-hooks-integration.test.ts` exercises the actual agent engine with an
explicitly controlled external model boundary: separate hook/tool approvals,
rewrite validation before Ask, advisory permission allows, post-tool result
withholding without rollback, feedback retention, Stop continuation, rejected
prompt isolation, async context, cancellation and root review/Undo, Ask cleanup
completion, read-only review, and genuine-user versus delegated lifecycle events.

The source audit used the locally preserved upstream files:

- `codex-rs/config/src/hook_config.rs`: events and configuration format.
- `codex-rs/core-plugins/src/loader.rs`, `load_plugin_hooks`: plugin declarations.
- `codex-rs/hooks/src/engine/discovery.rs`: plugin environment, unsupported
  handlers, trust filtering, and deadline normalization.
- `codex-rs/hooks/src/events/common.rs` and `engine/dispatcher.rs`: matching,
  selection, concurrent execution, and ordering.
- `codex-rs/hooks/src/engine/output_parser.rs` and `events/*.rs`: output schemas
  and event effects.
- `codex-rs/hooks/src/engine/command_runner.rs`: asynchronous completion.
- `codex-rs/hooks/src/output_spill.rs`: context preservation and previewing.
- `codex-rs/core/src/hook_runtime.rs`, `tools/registry.rs`, and
  `tools/approvals.rs`: actual event boundaries and tool decisions.
- `codex-rs/core/src/tools/hook_names.rs`: canonical tool names and aliases.
- `codex-rs/features/src/lib.rs`: stable/default-on feature status.

Upstream's separate global/project TOML hook configuration, per-handler stored
trust UI, unrestricted Rust regex grammar, and CLI-specific transcript files
are not implemented by this plugin-runner module. The workspace's explicit
per-command Ask flow and inherited Full access policy govern execution here.
