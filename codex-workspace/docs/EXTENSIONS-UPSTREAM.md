# Upstream skill and plugin behavior

Audited the local official Codex checkout at `/tmp/codex-cli-upstream`, commit `78245b47af2a7aafcabe025828ceecca69db4df1`. This is source evidence for the TypeScript implementation, not a claim that every behavior below has already been implemented. No network actions or upstream executables were run during this audit.

Paths below are relative to that checkout. The implementation is distributed across `codex-rs/skills`, `codex-rs/ext/skills`, `codex-rs/core-plugins`, and `codex-rs/plugin`; there is no `core-skills` crate in this checkout.

## Skill documents and metadata

`codex-rs/skills/src/parser.rs` parses `SKILL.md`:

- The first line, after trimming, must be `---`, with a closing `---` and nonempty YAML frontmatter.
- `description` is required and must be nonempty after whitespace normalization.
- `name` is optional; missing or blank names use the containing directory's name. The normalized name is at most 64 characters. The parser does not restrict names to lowercase slugs.
- Optional `metadata.short-description` supplies a short description.
- Prose scalar repair handles some unquoted YAML values containing `: ` without hiding unrelated YAML errors.
- The main parser does not impose a 1,024-character description limit. The prompt renderer separately truncates catalog descriptions to 1,024 characters.

Example:

```markdown
---
name: review-changes
description: Review a code change for correctness and missing edge cases.
metadata:
  short-description: Review pending code changes
---

Read the relevant files and tests before proposing corrections.
Resolve referenced scripts and resources relative to this skill directory.
```

`codex-rs/ext/skills/src/loader/metadata.rs` loads optional `agents/openai.yaml`. Invalid or unreadable optional metadata produces a warning but does not discard an otherwise valid `SKILL.md`. Its main sections are `interface`, `policy`, and `dependencies`:

```yaml
interface:
  display_name: Review Changes
  short_description: Review pending code changes
  icon_small: ./assets/icon.svg
  icon_large: ./assets/logo.png
  brand_color: '#7F7F7F'
  default_prompt: Use $review-changes to review this change.
policy:
  allow_implicit_invocation: false
```

`codex-rs/skills/src/interface.rs` normalizes strings; display names are at most 64 characters, short descriptions and default prompts at most 1,024. Colors must be `#RRGGBB`. Standalone icons must stay under the skill's `assets/`; plugin skills may reference a plugin's shared `assets/` directory through a normalized relative path. This is not permission to read arbitrary parent files.

`dependencies.tools[]` can contain `type`, `value`, `description`, `transport`, `command`, `url`, and `oauth.callbackPort` (`callback_port` alias). Required strings are `type` and `value`. The metadata loader bounds type/transport to 64 characters and other tool strings to 1,024. In this app, dependency metadata must not activate MCP or connector implementations.

## Skill discovery, identity, and invocation

Authoritative files:

- `codex-rs/ext/skills/src/host_roots.rs`
- `codex-rs/ext/skills/src/loader/host.rs`
- `codex-rs/ext/skills/src/loader/discovery.rs`
- `codex-rs/ext/skills/src/loader/host_merge.rs`
- `codex-rs/ext/skills/src/loader/namespace.rs`
- `codex-rs/skills/src/selection.rs`, `mentions.rs`, and `model.rs`
- `codex-rs/config/src/skills_config.rs`
- `codex-rs/ext/skills/src/host_prompt.rs` and `render.rs`

Root construction is ordered. Config layers are traversed high to low: project config folders contribute `skills/`; user config contributes legacy `$CODEX_HOME/skills`, `~/.agents/skills`, and the bundled system cache; system config contributes administrator skills. Enabled plugin roots and explicitly added roots follow. Repository `.agents/skills` roots are then appended from the detected project root to the current working directory. Identical root paths are deduplicated with the first occurrence retained.

Important distinction: merging retains the first occurrence of each canonical **document path**, not the first occurrence of each name. Same-name skills at different paths remain present. Loaded metadata is sorted by repo, user, system, admin, then name and path; the CoreCompatible prompt renderer separately sorts system, admin, repo, user. A single simplistic global "name overrides name" rule would not match this checkout.

Ordinary discovery recursively finds exact `SKILL.md` files, skips hidden descendant directories, limits depth to 6, directories to 2,000 per root, and entries to 20,000. It warns on traversal limits. Schema-declared Agent Plugin skills use direct-child discovery (`skills/<skill>/SKILL.md`) instead. The host loader follows directory symlinks for repo/user/admin roots, ignores them for system roots, and canonicalizes identities. The TypeScript app's stronger workspace-boundary and symlink restrictions still apply.

Plugin-provided skill names are qualified as `plugin-name:skill-name`. The nearest valid nested plugin namespace wins for discovered legacy roots; an owning plugin can supply its authoritative namespace explicitly.

Invocation behavior:

- `policy.allow_implicit_invocation` defaults to `true`. `false` forbids implicit use while allowing explicit selection.
- Enablement is separate: disabled skill paths are unavailable for both selection and use. Configuration supports path or exact-name selectors; later matching rules override earlier ones.
- Structured skill selection resolves a canonical path or its logical discovery path first.
- Text supports `$skill-name` and `[$skill-name](path/to/SKILL.md)`; `skill://` is also recognized. Plain names select only when exactly one enabled skill has that name (and there is no conflicting connector slug). Ambiguity must be resolved rather than silently choosing a similarly named skill.
- `app://`, `mcp://`, and `plugin://` linked mentions are distinct from skill mentions; common environment variable names such as `$HOME` are excluded from plain mentions.
- The catalog supplies metadata. Selected main instructions are read and injected, and failures are returned as visible warnings; skill text is not a fabricated model response.
- The available-skill catalog defaults to 2% of the model context window, with a configured maximum of 10,000 tokens. Schema-declared Agent Plugin main prompts are truncated to 8,000 UTF-8 bytes with a warning. That specific limit is not applied to every legacy host prompt by `host_prompt.rs`.

## Plugin manifest formats

`codex-rs/utils/plugins/src/plugin_namespace.rs` and `codex-rs/exec-server-protocol/src/protocol.rs` define manifest discovery. Precedence is:

1. Root `plugin.json` declaring an Agent Plugins schema.
2. `.codex-plugin/plugin.json`.
3. `.claude-plugin/plugin.json`.
4. `.cursor-plugin/plugin.json`.

An unrelated root `plugin.json` is ignored in favor of a legacy manifest. An unsupported Agent Plugins schema is selected and rejected; it does not silently fall back. Symlink/nonregular root manifests, and non-directory legacy metadata parents, are rejected by the local manifest finder.

`codex-rs/core-plugins/src/manifest.rs` accepts this legacy form:

```json
{
  "name": "review-kit",
  "version": "1.2.0",
  "description": "Review tools and conventions",
  "keywords": ["review"],
  "skills": ["./skills"],
  "commands": ["./commands"],
  "hooks": "./hooks/hooks.json",
  "interface": {
    "displayName": "Review Kit",
    "shortDescription": "Review workspace changes",
    "longDescription": "Skills for repeatable code review.",
    "developerName": "Workspace owner",
    "category": "Developer Tools",
    "capabilities": ["Code review"],
    "websiteUrl": "https://example.com/review-kit",
    "defaultPrompt": ["Use $review-kit:review-changes to review this change."],
    "brandColor": "#7F7F7F",
    "composerIcon": "./assets/icon.svg",
    "logo": "./assets/logo.svg",
    "logoDark": "./assets/logo-dark.svg",
    "screenshots": ["./assets/screenshot.png"]
  }
}
```

`skills` and `commands` accept a string or string array. Paths must start `./`, contain no `..` component, and stay within the plugin root. If effective skill paths are empty, the loader discovers the default `skills/` directory when present. Missing/blank legacy manifest names fall back to the plugin directory name. A parsed manifest's optional fields are distinct from the stricter plugin ID/version validation used during install.

Other interface fields are `privacyPolicyUrl` and `termsOfServiceUrl`; uppercase `URL` aliases are supported for the three URL fields. `defaultPrompt` accepts one string or an array, normalizes whitespace, retains at most three prompts, and rejects individual prompts longer than 128 characters. Invalid optional paths/prompts are warned about and ignored.

Legacy `hooks` accepts a path, path array, inline HooksFile object, or array of such objects. Absent hooks fall back to `hooks/hooks.json`. `codex-rs/config/src/hook_config.rs` defines `{ "description"?: string, "hooks": { event: [{ "matcher"?: string, "hooks": [handler] }] } }`. Events are `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`, and `Interrupt`. Command handlers support `command`, `commandWindows`, `timeout`, `async`, `statusMessage`, and `additionalContextLimit`. Merely deserializing handler kinds is not evidence of runtime support. MCP hook handlers remain excluded here.

`codex-rs/core-plugins/src/agent_plugin_manifest.rs` defines the newer root form:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "review-kit",
  "version": "1.2.0",
  "description": "Review workspace changes",
  "author": { "name": "Workspace owner" },
  "homepage": "https://example.com/review-kit",
  "keywords": ["review"]
}
```

Only the shown `1.0.0` schema is supported in this checkout. Portable names are 1–64 bytes, lowercase ASCII letters/digits/dots/hyphens, begin/end alphanumeric, and contain neither `--` nor `..`. Metadata also recognizes `repository`, `license`, and `author.email`/`author.url`. Root unknown fields are warned about and ignored. Optional declared fields cannot be explicit `null`.

This format fixes skills to `./skills` and direct children. Codex-specific `extensions["com.openai"]` may supply interface/extra metadata; `.codex-plugin/plugin.json` is an overlay fallback only when that extension is absent. Although overlay fields can be parsed, `loader.rs` intentionally does not load apps or hooks for this new format. Do not infer execution support merely from overlay parsing.

## Marketplace, install, update, and provenance

`codex-rs/core-plugins/src/marketplace.rs` looks for marketplace manifests in this order: `.agents/plugins/marketplace.json`, `.agents/plugins/api_marketplace.json`, `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json`. Discovery checks the home directory implicitly, so `~/.agents/plugins/marketplace.json` does not require explicit registration. Additional/configured roots and their Git repository roots are also considered. Duplicate plugin IDs resolve to the first discovered source.

```json
{
  "name": "personal",
  "interface": { "displayName": "Personal plugins" },
  "plugins": [
    {
      "name": "review-kit",
      "source": { "source": "local", "path": "./plugins/review-kit" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    },
    {
      "name": "other-kit",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/example/plugin-library.git",
        "path": "plugins/other-kit",
        "ref": "main"
      }
    }
  ]
}
```

Supported source forms are a local string, `{ "source":"local", "path":... }`, `{ "source":"url", "url":..., "path"?:..., "ref"?:..., "sha"?:... }`, `git-subdir` with required `path`, and npm package/version/registry. Installation policy values are `NOT_AVAILABLE`, `AVAILABLE` (default), `INSTALLED_BY_DEFAULT`; auth values are `ON_INSTALL` (default), `ON_USE`. Product restrictions are carried in metadata. Marketplace entries can provide manifest metadata for sources without a manifest; a real manifest always wins. Unsupported source types are skipped with warnings.

Local source paths are relative to the **marketplace root**, not the directory containing `marketplace.json`. For `~/.agents/plugins/marketplace.json`, `./plugins/review-kit` resolves to `~/plugins/review-kit`. For `<repo>/.agents/plugins/marketplace.json`, it resolves to `<repo>/plugins/review-kit`. This is both implemented by `marketplace.rs::resolve_local_plugin_source_path`/`marketplace_root_dir` and documented by `skills/src/assets/samples/plugin-creator/references/plugin-json-spec.md`. Root sources `.` and `./` are allowed; other Codex local sources require a `./` prefix and normal components only. The Cursor marketplace compatibility path allows a missing `./` prefix. Plugin array order is retained, and a marketplace entry's category overrides the plugin interface category.

The bundled plugin-creator's `scripts/create_basic_plugin.py` generates the local source object shown above, defaults the marketplace name to `personal`, preserves an existing `interface.displayName`, and writes explicit installation/authentication/category fields. Its personal destination is `~/.agents/plugins/marketplace.json`; the plugin content normally lives at `~/plugins/<name>`. Do not accidentally put generated source content beneath `~/.agents/plugins/plugins/`.

`codex-rs/plugin/src/plugin_id.rs` uses stable IDs `plugin@marketplace`. Plugin-name and marketplace segments reject traversal and unsafe characters; plugin names allow constrained dots, marketplace names do not.

`codex-rs/core-plugins/src/marketplace_add/source.rs` accepts marketplace `owner/repo`, Git URLs, and explicit local directory paths. Refs may be explicit or source suffixes. Local marketplaces are registered in place; remote marketplaces are cloned into a staging area. GitHub shorthand becomes an HTTPS Git URL. `marketplace_add/metadata.rs` persists source type, source, ref, and sparse paths in user config.

`codex-rs/core-plugins/src/loader.rs` materializes plugin sources from local directories, Git repositories, or npm. Git subdirectory sources use sparse checkout. A supplied SHA takes precedence over a ref and must equal the resulting full `git rev-parse HEAD`; Git is noninteractive. Automatic background Git operations strip repository-local Git environment overrides (`git_policy.rs`). This is normal Git execution, not a sandbox/container requirement.

`codex-rs/core-plugins/src/store.rs` stores installed content under `plugins/cache/<marketplace>/<plugin>/<version>`. Missing legacy versions use `local`; missing Agent Plugin versions use `1.0.0`. Legacy versions must be safe path segments; unusual portable versions are converted into a hashed cache segment. Active-version selection prefers `local`, otherwise highest semver when both compared versions parse, otherwise lexical order. Plugin durable data has a separate `plugins/data` root.

Install validates the plugin ID/name/version, stages a copy, then verifies that the manifest path and exact bytes did not change while copying. Only regular files/directories are copied; symlinks and special files are not copied by this routine. Legacy command Markdown is converted into generated skills under `.codex-plugin/migrated-command-skills`; native plugin skills take precedence over generated same-name skills. `command_migration/plugin.rs` requires command frontmatter descriptions and caps generated documents at 4,000 bytes. New Agent Plugin manifests do not run this migration.

More precisely, migration uses manifest `commands` paths or the default `commands/`, recursively collects `.md` files, skips `README.md`, and names each result `source-command-<relative-path-slug>` (at most 64 characters). Colliding generated slugs are skipped. Templates using `$ARGUMENTS`, `$<digit>`, paired `{{`/`}}`, shell expansion markers consisting of `!` followed by a backtick (with or without a space), or whitespace-delimited `@...` tokens are skipped. The result is a `SKILL.md` containing the description, a request-trigger instruction, and the template body. This migration does not itself execute the Markdown as a shell command or implement parameter substitution.

`manager.rs::install_resolved_plugin` installs content before persisting `enabled:true`. Store uninstall removes cached plugin content; it does not delete the separate plugin data root. Plugin disablement stops loading capabilities while retaining installed content.

`marketplace_upgrade/activation.rs` persists `.codex-marketplace-install.json` with source type/source/ref/sparse paths/resolved revision, checks the previous snapshot for concurrent change, and rolls back activation if rename or post-activation work fails. `store.rs` separately records remote plugin identity in `.codex-remote-plugin-install.json` for remote installs. This is not a general signed provenance system. For the TypeScript port, recording original source, requested ref, resolved commit, install/update time, and content version provides reviewable provenance without inventing an upstream signature guarantee.

Rollback limits matter: Store stages next to the destination and uses rename/backup/restore for a failed replacement. If restoration fails, it preserves the backup path in the returned error. Successful updates remove old cached versions; this code does **not** retain a durable user-facing version history. A rollback-history button requires explicit additional snapshot retention in the TypeScript implementation.

Standalone GitHub skills are installed by `codex-rs/skills/src/assets/samples/skill-installer/scripts/install-skill-from-github.py`, not the plugin Store. That helper accepts repo/ref/path(s), defaults to direct GitHub ZIP download, falls back to Git on HTTP 401/403/404, validates traversal/symlinks, copies to `$CODEX_HOME/skills`, and refuses an existing destination. It has no standalone update or rollback-history operation. A native Node installer should retain these source/path semantics while implementing its own explicit update transaction rather than running this Python helper as the runtime.

## Scope boundaries for this app

The user's requested exclusion of MCP takes precedence over upstream parity. Upstream `mcpServers`, `.mcp.json`, root `mcp.json`, dependency-triggered MCP setup, `mcp_tool` hooks, and connector/app routing must not launch servers, register callable MCP tools, or initiate provider login. `apps` metadata should not imply a working connector integration. Source files can remain present as plugin content, with unsupported capabilities reported clearly.

The native extension implementation covers skill discovery/read/invocation, local, GitHub and static npm-source installation, enabled state, manifest/interface metadata, source provenance, transactional updates, and additional durable rollback history. The registry itself does not execute hooks. The later native hook runner and engine binding implement supported legacy command-hook events with inherited approvals, Plan/read-only exclusion, process cleanup, and review attribution; their real engine integration tests are separate from this source audit. See [HOOKS.md](HOOKS.md). Portable schema hooks and app/MCP capabilities remain unavailable. The upstream manifest does not define a generic JavaScript `main` module that should be imported and executed just because the bundle was installed.

All app extension state/content belongs under the native persistent data directory, and every skill instruction, script, and hook must remain subordinate to the user's no-proxy/no-mount/no-proot/no-Docker constraints and the application's command/path checks. Public ordinary files stay unencrypted as requested; account secrets are not extension metadata.

The npm source adaptation preserves native registry package/tag/range selection and retained content semantics. The local npm implementation can route registry `dist.tarball` metadata to a directory or Git fetcher even with script suppression flags, so this app separates metadata-only native selection from bounded direct HTTPS artifact retrieval. It does not call the generic artifact dispatcher or run package lifecycle/install commands. This is a deliberate static-materialization boundary, not a claim that the pinned npm command is safe for every registry response.
