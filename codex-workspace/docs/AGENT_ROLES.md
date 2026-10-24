# Custom agent roles

Custom roles are ordinary TOML files on the persistent data mount. They provide a task description, developer instructions, an optional managed model and exact reasoning level, and optional tool restrictions for real child agents. Files remain unencrypted, as requested for this workspace. Do not put credentials in a role file.

Create `.codex/agents/reviewer.toml` in a workspace:

```toml
name = "reviewer"
description = "Review authentication changes and report concrete, reproducible defects."
model = "gpt-5.6-cyber"
model_reasoning_effort = "max"
developer_instructions = """
Read the assigned files and their callers.
Report a defect only when the code supports it, with a file and line reference.
Preserve teammates' changes and return a concise report to the parent.
"""

[features]
shell_tool = false
plugins = false
```

The role appears in the `spawn_agent` tool's available-role guidance. The parent can select `agent_type: "reviewer"`. Its developer instructions go to the actual child model request; model and effort are resolved through the same managed model validation used by ordinary runs. Disabling `shell_tool` removes shell execution and process-control tools. Disabling `plugins` excludes plugin discovery, plugin skills, and plugin resources; ordinary project and personal skills remain available. These flags do not create an operating-system sandbox.

The default, worker, and explorer roles remain available. Explorer always uses Plan/read-only tools, including when a custom definition uses that name. Other roles inherit the parent's Agent/Plan mode and Ask/Full access policy. A role cannot widen these permissions, re-enable a disabled parent capability, change the model endpoint, or expose an API-key control.

## Persistent scopes and precedence

The server reads these locations, in order:

1. `~/.codex/config.toml` and `~/.codex/agents/**/*.toml` under the application's durable home (`/data/home` in the hosted Space).
2. The selected workspace's `.codex/config.toml` and `.codex/agents/**/*.toml`.
3. Each nested working directory's `.codex` configuration, from the workspace root toward the requested cwd.

The selected workspace is the project boundary. Discovery does not read a sibling workspace, climb into application state, or load system-wide configuration. A `.codex/agents` directory works without a `config.toml` file. Files are read again for new discovery/spawn requests, so editor or terminal changes take effect without registration or a server restart. New server instances load the same files from the data mount.

A higher layer wins for the same role name. Only missing description, config-file selection, and nickname candidates inherit from a lower layer. Selecting a new role file replaces its runtime settings; settings from two role files are not deep-merged. A malformed higher definition produces a diagnostic and leaves a valid lower definition available.

Within one layer, declarations in `config.toml` are considered first, in role-name order. Recursive standalone files follow in sorted path order. The first definition of a duplicate role name wins, and later duplicates receive diagnostics. A file already used by a valid declaration is not discovered twice.

## Existing Codex declaration format

The upstream declaration form also works in `.codex/config.toml`:

```toml
[agents.reviewer]
description = "Review a bounded set of changes."
config_file = "agents/reviewer.toml"
nickname_candidates = ["Ada", "Code Reviewer"]
```

For a declared file, `name` and `developer_instructions` may be omitted. The declaration supplies the name, and absent role instructions inherit from the parent. If the file supplies a nonblank `name`, it replaces the declaration's identifier. File description and nickname candidates override declaration metadata. Standalone discovered files require a name and nonblank developer instructions. Every configured role needs a description after layer merging.

`config_file` paths are relative to their declaring `.codex` directory. This native implementation requires a path inside that directory: absolute paths, `..` components, backslashes, symbolic links, devices, sockets and named pipes are rejected. Names use 1–64 letters, digits, underscores or hyphens and begin with a letter. Prototype-reserved identifiers are rejected.

Optional `[agents]` defaults use the upstream keys:

```toml
[agents]
default_subagent_model = "gpt-5.6-luna"
default_subagent_reasoning_effort = "high"
```

Model and effort defaults merge independently across layers. Valid explicit spawn options override these defaults. A selected role's own model and reasoning effort then override those spawn choices and are marked locked in tool guidance. Requested/default settings are validated before the role applies, and the final pair is validated again. An invalid model or unsupported effort produces an error; there is no silent model substitution or effort downgrade. Team red models, including `gpt-5.6-cyber`, use the existing managed catalog.

The pinned upstream can use a model-specific catalog default when an explicit/default model has no effort. This application's managed catalog does not advertise per-model defaults, so it retains the parent's exact effort when no effort is specified. A role changing only the model also retains that effort and fails if the pair is unsupported. For predictable cross-model behavior, put both values in the role file or supply both spawn options.

Native subagents always start with an isolated assigned task brief and the required workspace, host rules, role instructions, and permission configuration. They do not receive the parent conversation. The spawn tool does not offer context forking and rejects `fork_context = true` before creating a child. Ordinary model/effort overrides and role locks still apply, including a configured default role when no role is selected. The role resolver retains upstream fork-selection behavior only as an internal, unexposed compatibility helper. A user-created conversation fork is a separate feature and does not change subagent isolation.

## Supported role projection

This port follows the upstream typed role-override boundary. It does not treat role TOML as a replacement application configuration.

| Role-file setting | Behavior |
| --- | --- |
| `name` | Role identity; may replace a legacy declaration name. |
| `description` | Available-role guidance for the parent. |
| `nickname_candidates` | Validated, persistent role metadata; task names remain controlled by the collaboration runtime. |
| `developer_instructions` | Bounded instructions for the real child model; subordinate to explicit user instructions, inherited permissions and mandatory host rules. |
| `model` | An exact model ID from the managed catalog. |
| `model_reasoning_effort` | An exact supported raw value: `low`, `medium`, `high`, `xhigh`, or `max`. |
| `features.shell_tool = false` | Disables shell execution and process-control tools. |
| `features.plugins = false` | Excludes plugin discovery, plugin skills and plugin resources. |
| Supported feature set to `true` | Supplies no authority grant; it cannot re-enable a parent's disabled capability. |

Other role-file settings produce a bounded diagnostic and reject that definition. In particular, provider/base URL/API-key configuration, approval and sandbox settings, environment variables, cwd changes, commands and notification hooks are never applied. The current subset does not support role-specific skills tables, service tiers, reasoning summaries, verbosity, personality, or other feature flags. Agent count/depth/enabled settings in the main `agents` table are diagnosed as unsupported by role discovery and do not change application limits. Unrelated main `config.toml` sections are ignored by this loader; they are not copied into the child configuration.

These omissions are explicit compatibility limits. The pinned upstream itself permits more presentation settings and some additional disabling-only skill/feature settings; its typed role projection also does not copy provider routing, live permissions, approval policy or cwd from a role.

## Admission, continuation and failure behavior

Each admitted child stores a validated role snapshot: its identity, source labels, definition hash, instructions, effective model/effort, permissions and capabilities. Restart/continuation uses that snapshot. Later role edits affect new children; deleting or changing a role file does not silently alter an already admitted child. A continuation intersects the snapshot with current parent restrictions, so a child that became read-only or lost Full access cannot regain that authority merely because its parent later has more permission. Source metadata is descriptive and never an instruction to read an arbitrary path during resume.

Discovery bounds each file to 64 KiB, each instruction body to 32,000 characters, each description to 1,024 characters, and a catalog to 64 custom roles plus built-ins. A request reads at most 128 files and 2 MiB of configuration, visits at most 2,048 directory entries and 128 directories, and limits role-directory recursion to 16 levels and cwd nesting to 32 levels. Diagnostics and model-visible catalog text also have fixed limits. If a global limit prevents complete discovery, admission fails with `AGENT_ROLE_LIMIT`; the loader never uses a partial catalog that might omit stricter project definitions. Individual oversized/malformed files receive diagnostics. Diagnostic truncation is itself visible.

On Linux, directory traversal uses anchored file descriptors and refuses symbolic links at every user-controlled component. Reads validate file identity before and after opening and compare the bytes twice, because coarse persistent-storage timestamps alone cannot detect a same-size edit. The loader does not execute TOML contents or resolve environment-variable substitutions. Parser diagnostics deliberately omit source snippets to avoid echoing unrelated sensitive text accidentally present in a config file.

The integration helpers are in `server/agent/roles.ts`: `loadAgentRoles`, `resolveAgentRole`, `tightenAgentRole`, `isResolvedAgentRole`, `agentRoleToolDescription`, and `agentRoleInstructions`. `tests/agent-roles.test.ts` exercises actual filesystem discovery, persistence in a new service instance, the real managed option resolver, layer precedence, model/effort errors, authority intersections, and unsafe-file rejection. Shared-engine integration must enforce each capability both in the advertised tool list and at dispatch; a failed role discovery must reject admission instead of falling back to built-ins.

## Source references

The source basis is OpenAI Codex commit `78245b47af2a7aafcabe025828ceecca69db4df1`, preserved in this workspace's `upstream/` archive:

- [Role-file parsing and metadata](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/agent-roles/src/agent_role_config.rs).
- [Layer loading and metadata precedence](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/agent-roles/src/loader.rs), [recursive discovery](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/agent-roles/src/discovery.rs).
- [Typed role projection and locked-setting guidance](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/agent/role.rs).
- [Spawn precedence and role validation](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/agent/child_config.rs).

No Rust Codex executable, OS sandbox, mount operation, provider proxy, or MCP implementation is introduced by this feature.
