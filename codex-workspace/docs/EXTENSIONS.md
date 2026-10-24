# Native skills and plugins

The extension engine is TypeScript. It discovers actual `SKILL.md` files, imports real packages, persists their state on the native data volume, and exposes read tools to the agent. It does not run the Rust CLI or an external extension host.

## Skills and invocation

Repository discovery checks `.agents/skills` and the compatibility `.codex/skills` directories from the working directory to the closest repository root, bounded by the selected workspace. Personal skills live in `/data/home/.agents/skills` or `/data/home/.codex/skills`. Builtin creator and installer instructions live in `/data/home/.codex/skills/.system`; builtins are upgraded only when their stored bytes still match the previously shipped version. Paths use the configured `DATA_DIR` rather than assuming the literal `/data` in development.

Skills use YAML frontmatter with a nonempty `description`; `name` defaults to the containing folder and has a 64-character limit. Folded descriptions and `metadata.short-description` are supported. `agents/openai.yaml` supplies display metadata, a default prompt, dependency notices, and `policy.allow_implicit_invocation`. Invalid required documents appear as discovery issues. A malformed optional sidecar produces a warning while its valid `SKILL.md` remains available with default invocation behavior. Duplicate names are retained; duplicate canonical document paths are deduplicated. A duplicate `$name` requires selection by its stable ID, plugin-qualified name, or an exact linked reference such as `[$review](/path/to/SKILL.md)`.

Every run receives a metadata index capped at 8,000 characters. This index is for meaningful model-driven selection, not automatic keyword execution. The user can explicitly select skills in the composer, use `$skill-name`, or use `$plugin-name:skill-name`. Explicit documents are loaded at turn preparation. Long documents return a continuation cursor instead of silently claiming their full content was supplied. Supporting resources are read only when requested.

The native tools are `list_skills`, `list_plugins`, `load_skill`, and `read_skill_resource`. They work in plan mode because they only read. Disabled skills are rejected. Explicit-only skills can be loaded by tools only when their IDs were explicitly selected for that run or inherited from an authorized parent. A delegated agent's generated assignment cannot grant new explicit-only authorization. Up to twelve skills can be selected in one turn, with full instructions bounded to 128 KiB and continuation cursors for the remainder. Resource text is wrapped as lower-priority task guidance. Tool output is passed through the normal credential redactor.

Project and personal skills can be created, imported, edited with SHA-256 version checks, enabled, disabled, and removed. Removing a skill moves its files to a durable backup. Plugin and builtin skill documents are read-only in the management editor; author the source package or create a personal copy. Local edits made through the terminal are still detected by discovery.

A role can restrict plugins for its individual run. `prepareRun`, `promptIndex`, and `execute` accept `pluginsEnabled: false`; this removes plugin metadata and skill bodies from the run, rejects plugin skill/resource calls, and keeps project, personal, and builtin skills usable. Known plugin directories and native symlink aliases into plugin storage are excluded before reading `SKILL.md`. Inherited explicit selection cannot override that capability. The restriction does not change the saved enable/disable settings or the management catalog.

## Packages and lifecycle

The installer accepts a local workspace directory, a GitHub repository with optional ref/subdirectory/saved account, or an existing workspace ZIP, tar, or tar.gz archive. GitHub tree and archive URLs normalize to direct GitHub checkouts. No incoming package is routed through the separate click-to-download export bucket.

Supported manifests are `.codex-plugin/plugin.json`, compatible `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json`, and the schema-declared root `plugin.json` format at `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`. An eligible root manifest takes precedence. A missing legacy name uses the original package directory name and stays stable across retained revisions. Legacy `skills` accepts `./path` or an array of paths; the default `skills/` directory is discovered when the field is absent. Schema-declared packages use direct children of `skills/`; a `skills/SKILL.md` at the collection root does not hide valid child skills. Version, author, license, homepage, display name, and description are shown with installed provenance.

Compatible legacy command Markdown is converted to instruction-only skills. Parameter substitutions, shell template markers, invalid frontmatter, oversized templates, overlong names, and every member of a generated-name collision are reported instead of being executed. Native skills take precedence over generated skills with the same name. The reserved generated cache is refreshed only in a new staging copy, preserving original sources and installed customizations. The conversion follows the audited upstream restrictions; see [EXTENSIONS-UPSTREAM.md](EXTENSIONS-UPSTREAM.md).

Package content is staged and checked before activation. Active versions are selected by a serialized, atomic JSON state update; published content is never overwritten in place. Each version records the requested source, resolved Git commit where applicable, timestamp, and package-content fingerprint. Updates retain previous versions and preserve skill IDs, disabled choices, and plugin enablement. A changed package produces `409 EXTENSION_MODIFIED`; an explicit preserve-edits retry keeps the edited version and returns its backup path. Failed preparation leaves the active revision unchanged. A failure after state publication never deletes the published revision.

The detail panel lists retained revisions and can restore one. Removal moves the complete installed package history into a durable backup. Data directories and old revisions are not silently pruned. This durable revision history is an added capability; the upstream code's temporary rollback during activation does not itself constitute a user-facing version archive.

Managed project packages are under `<workspace>/.codex/plugins/installed/<id>/<revision>`. Personal packages are under `<DATA_DIR>/home/.codex/plugins/installed/<id>/<revision>`. Backups use the adjacent `backups` directory. Registry state, selections, disabled IDs, revisions, and provenance are ordinary plaintext JSON at `<DATA_DIR>/codex-workspace/state/extensions.json`. Skill instructions, scripts, assets, and workspace files remain unencrypted by request. Saved GitHub credentials stay in the application's protected credential store; plugin metadata contains account IDs, never tokens. The single workspace password unlocks this entire UI and the already-saved accounts.

`ExtensionsService.hookSources(workspaceId, {cwd?, pluginsEnabled?})` supplies the native hook loader with enabled, validated legacy plugin identities, canonical package roots, and the manifest's unmodified `hooks` declaration. It also prepares a separate durable `<owner>/.codex/plugins/data/<pluginId>` directory, which survives version changes and removal. Personal and project data roots stay in their corresponding durable owner directories. Disabled-role discovery returns no sources and creates no data directories. The pinned portable Agent Plugins schema does not activate legacy hooks through its overlay. This adapter only returns metadata; [HOOKS.md](HOOKS.md) describes the event runner, approval rules, and engine integration boundary. No import, settings read, or adapter call executes a hook.

## Local marketplaces

Catalogs can be authored in a workspace or durable user home, or imported from a local folder, GitHub repository, or archive. Discovery recognizes `.agents/plugins/marketplace.json`, `.agents/plugins/api_marketplace.json`, `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json`, and an explicitly authored root `marketplace.json`.

Marketplace entries support local packages and direct GitHub `url`, `git-subdir`, or `github` sources. A pinned commit SHA takes precedence over a branch ref. Local paths resolve from the marketplace root: `~/.agents/plugins/marketplace.json` plus `./plugins/example` means `~/plugins/example`. Manifest and marketplace entry names must agree. Each installed plugin revision retains its originating catalog ID, entry, snapshot revision, commit, original source, and fingerprint, including after a catalog is removed. Personal plugins installed from project catalogs remember that source workspace when the user changes workspaces. Imported marketplace updates retain the previous snapshot. Updating a catalog does not silently update its already-installed plugins. Removing a catalog preserves installed plugin content; a future plugin update needs an available source.

`NOT_AVAILABLE` entries and unsupported sources are shown as issues. Direct plugin imports and marketplace entries also support npm package/version/HTTPS-registry sources. Acquisition uses isolated native npm metadata selection and bounded static HTTPS archive retrieval; package scripts, npm installation and generic directory/Git artifact dispatch are never invoked. Actual package version, verified integrity and archive hashes are retained with each revision, separately from the plugin manifest version. No remote vendor directory, billing entitlement, organization plugin service, or connector sign-in is simulated.

## Trust, bounds, and excluded capabilities

No package entrypoint, installer, hook, or script runs during discovery, installation, or startup. Skills can reference scripts; the agent must run them through the normal command tools and the current permission controls. Source metadata is not a higher-priority instruction channel. Every run states that resource instructions cannot override user and host constraints: no proxies, mounts, proot, Docker, Podman, containers, or sandbox machinery.

MCP servers are deliberately excluded. MCP declarations and dependencies produce an unavailable-capability notice; the module does not load their configurations into a tool registry, register tools, start servers, or initiate authentication. MCP hook handlers remain unsupported. External app connectors require their original host integration and are also reported unavailable. Supported legacy plugin command hooks run through the native event dispatcher using the run's permissions: Ask requires approval, while Plan and read-only roles do not run commands. Portable Agent Plugins schema hook declarations remain unavailable. Installation and discovery never execute hooks.

All mutation routes are mounted behind the same server session and same-origin checks as the rest of the workspace. Filesystem reads resolve real paths against allowed roots, reject escapes, bound regular-file reads, and revalidate opened file identity. Safe internal symlinks are supported; external links, symlink write-through, hard links in archives, devices, sockets, pipes, malformed names, and link cycles are rejected. Archive extraction is native Node code after complete path preflight, with no shell extraction. GitHub imports use the existing noninteractive credential helper, strip proxy configuration, restrict protocols, avoid credential URLs, and remove the temporary helper afterward.

Bounds are 192 KiB per skill document, 64 KiB per YAML metadata file, 2 MiB per readable text resource with 49,152-character pages, 16 MiB per package file, 64 MiB and 6,000 entries per package, 32 MiB per incoming archive, and 96 MiB per decompressed tar stream. Resource continuation offsets count UTF-16 text positions and preserve complete Unicode characters. Discovery and installed-catalog counts are also bounded, with visible limit errors.

## REST contract

All routes below are under authenticated `/api`. Browser-safe types are exported from `server/extensions/types.ts` and re-exported by the shared contract. A workspace ID is required for mutations; omitted read IDs show the personal catalog. When using nested discovery, carry the same optional `cwd` through skill/plugin/marketplace read queries and skill edit/toggle/delete, plugin toggle, and marketplace-entry install requests. Mutation bodies carry `cwd` except DELETE, which uses the query string.

| Route | Result or request |
| --- | --- |
| `GET /extensions?workspaceId=&cwd=` | `ExtensionsCatalog`: skills, plugins, issues, roots |
| `GET /skills?workspaceId=&cwd=` | `{ skills, issues }` |
| `GET /skills/:id?workspaceId=` | `SkillDocument`, including complete content/version and bounded resource index |
| `POST /skills` | `{ workspaceId, scope, name, description, instructions }` → `SkillMutationResult` |
| `POST /skills/install` | `{ workspaceId, scope, source, name? }` → `SkillMutationResult` |
| `PUT /skills/:id` | `{ workspaceId, content, version }` → updated `SkillDocument` |
| `PATCH /skills/:id` | `{ workspaceId, enabled }` → `SkillSummary` |
| `DELETE /skills/:id?workspaceId=` | `SkillMutationResult`, including durable backup path |
| `GET /skills/:id/resource?workspaceId=&path=&offset=&limit=` | `ResourceDocument`, with `nextOffset` and whole-file version |
| `GET /plugins?workspaceId=` | `{ plugins, issues }` |
| `GET /plugins/:id?workspaceId=` | `PluginSummary`, including modification status and revision history |
| `POST /plugins/install` | `{ workspaceId, scope, source }` → `PluginMutationResult` |
| `PATCH /plugins/:id` | `{ workspaceId, enabled }` → `PluginSummary` |
| `POST /plugins/:id/update` | `{ workspaceId, source?, preserveModified? }` → `PluginMutationResult` |
| `POST /plugins/:id/rollback` | `{ workspaceId, revision, preserveModified? }` → `PluginMutationResult` |
| `DELETE /plugins/:id?workspaceId=&preserveModified=` | `PluginMutationResult` |
| `GET /plugins/marketplaces?workspaceId=` | `{ marketplaces: MarketplaceSummary[] }` |
| `POST /plugins/marketplaces` | `{ workspaceId, scope, source }` → `MarketplaceSummary` |
| `POST /plugins/marketplaces/install` | `{ workspaceId, scope, entryId }` → `PluginMutationResult` |
| `POST /plugins/marketplaces/:id/update` | `{ workspaceId, preserveModified? }` → `MarketplaceSummary` plus backup path/warnings |
| `DELETE /plugins/marketplaces/:id?workspaceId=&preserveModified=` | `{ removed, backupPath, warnings }` |

`scope` is `user` or `project`. Import sources are `{kind:"local",workspaceId,path}`, `{kind:"github",repository,ref?,path?,accountId?}`, or `{kind:"archive",workspaceId,path}`. Marketplace installation uses the selected entry ID; it never accepts an arbitrary host filesystem path. `EXTENSION_MODIFIED` requires an explicit preserve-edits choice. `EXTENSION_VERSION_CONFLICT` requires reloading a document; it is not a force-overwrite permission.

## Verification

`tests/extensions.test.ts` exercises actual native discovery, explicit selection, YAML validation, per-run plugin restrictions, path guards, edits/backups, installation, versions, custom-file conflicts, rollback, command migration, marketplaces, excluded execution, and restart in a separate Node process. `tests/extensions-hooks.test.ts` checks real declaration loading, persistent plugin data, disabled-role isolation, unsupported-format/MCP boundaries, unsafe data roots, and no import/discovery execution. `tests/extensions-archive.test.ts` uses independent Python-generated archives to check real ZIP/tar/tar.gz extraction and adversarial entries. `tests/extensions-github.test.ts` executes real Git repositories/checkouts and the actual saved-account credential helper; only the remote GitHub URL is redirected to a local fixture. `tests/extensions-api.test.ts` uses real HTTP and the application session/origin middleware for the management contract.

Run `npx vitest run tests/extensions*.test.ts` and `npm run check`. Hosted UI/agent verification remains a release-level check after the coordinator mounts and deploys this module. Official format guidance was checked against [Build skills](https://developers.openai.com/codex/skills) and the downloaded upstream checkout; version-specific details are recorded in the separate source audit.
