# Native Codex settings and conversation views

The September 23 update exposes native Codex configuration through the existing authenticated Settings dialog. Codex remains the runtime: settings use its configuration protocol, MCP connections use its MCP implementation, and conversations retain native thread and item IDs.

## Settings

Settings separates everyday preferences into **Model & responses**, **Context & agents**, **Tools & permissions**, **MCP servers**, **Skills**, **Appearance**, and **Codex updates**. Desktop uses a category sidebar; phones use a category dropdown so every section remains reachable. Drafts survive category changes, and the fixed footer shows unsaved changes and the Save action.

Response detail has Default, Concise, Balanced and Detailed buttons. **Response speed** and the composer's **Service tier** selector offer the [documented Responses API values](https://developers.openai.com/api/reference/resources/responses/methods/create): `auto`, `default`, `flex`, `scale`, `priority`, `fast`, and `ultrafast`. The composer places this choice beside Model and Reasoning under the prompt. Explicit values remain selected across model changes and reloads, and are passed unchanged to native Codex. The API treats Fast and Priority as aliases and reports `priority` for either. Availability depends on the model, provider and account; selecting a tier does not promise access, and unsupported requests retain their actual error without a silent fallback. Existing custom tier values remain intact until explicitly changed.

Composer choices are saved per conversation, with a separate choice for a new draft. During a running turn, selecting a tier asks native Codex to apply it to the remaining work in that exact turn. The interface waits for native acknowledgment and reports rejection or a changed turn. The saved choice also applies to the next message; queued work uses the conversation's native tier setting.

Automatic context choices use switches. Concurrent agents, context size and compaction have quick presets, sliders and exact numeric inputs, with individual default resets. Larger valid custom values remain intact even when they fall outside a slider's quick range. Font size has a live preview, slider and Compact, Comfortable and Large presets. Native model identities and configuration values are preserved when these controls save.

**More settings** opens as a category directory, with shortcuts to Frequently used, Customized settings, and All options. Topics cover models, context, agents, tools, instructions, memory, connections, shell, native terminal, feature switches and compatibility settings. Larger topics open a section directory first: terminal shortcuts are divided into global, conversation, navigation, text editing and Vim groups; feature switches are divided by capability. Breadcrumbs and category/section pickers support moving between topics. Global search reaches every editable option, and results stay bounded to 16 controls per page inside collapsible sections.

Browsing categories, changing filters and clearing a search preserve the unsaved configuration. An unfinished structured or full JSON draft stays visible through a Review action even when its editor is elsewhere. Schema-backed booleans, enums and bounded numbers use controls; an unknown inherited boolean remains explicitly at Codex default. Technical details are hidden until requested, structured editors expand on demand, and the separate Advanced JSON editor remains available. Native terminal preferences are identified as applying to Codex in a terminal, rather than to the website editor. Native validation and a configuration version check run before a change is accepted. Host-managed options remain protected.

**MCP servers** supports local stdio commands and streamable HTTP servers, enable/disable, literal argument lists, tool filters and timeouts. **Check connections** reads the installed Codex server's actual MCP status. Private environment variables are write-only and stored in the encrypted credential store; durable native configuration contains environment references. Applying changed private variables requires an idle native Codex restart. **Restart Codex** uses the installed release; **Update Codex** installs and verifies the latest official release.

The fixed owner model endpoint, provider credentials, application storage paths and required host policy remain managed. These constraints also apply to MCP tools. Native desktop browser, computer-use and realtime interfaces are not provided by this browser workspace. OAuth credentials are not written as plaintext into the public bucket.

The reference for editable fields is the [official Codex configuration reference](https://developers.openai.com/codex/config-reference/). A configuration field's presence does not prove that a particular model, provider or installed release implements the corresponding service.

## Context capacity

Automatic context selection uses the maximum available in the installed native model catalog. Automatic compaction defaults to 90% of the selected capacity. Explicit smaller capacities and compaction thresholds can be saved. Model changes resolve the capacity for that model rather than reusing another model's automatic limit.

The public API specification and native Codex catalog can have different limits. For example, the fetched [GPT-6 Astra specification](https://developers.openai.com/api/docs/models/gpt-6-astra) describes a 1,050,000-token API window, while the inspected Codex 0.156.1 catalog caps its configurable window at 872,000 tokens. Codex clamps larger overrides. For that catalog, the automatic compaction threshold is therefore 784,800 tokens. Its separate 95% native headroom produces an effective usage window of 828,400 tokens, which was also reported by the verified GPT-6 Sol turn. The UI distinguishes published capacity from available native capacity and reported effective context. Unknown custom models are not assigned invented maxima.

## Conversations, tools and windows

Native API schemas can advertise methods that return “not supported yet.” On the inspected 0.156.1 binary, `thread/items/list` does this even though a native turn can complete normally. History presentation uses actual supported native turn pages when item pagination is unavailable. First-message materialization and native connection changes are handled without replaying user inputs or creating replacement conversations. Operations that are unavailable for a thread's history mode are not advertised as usable.

Command input and output appear inside expanded tool activity. Longer output remains paged and loads on expansion. Routine turn-start and turn-end entries are omitted from the visible timeline; useful running, error and completion state remains available. Keyboard focus uses neutral outlines, and pointer taps do not add a white highlight.

The conversation header and inline agent controls support native parent/child navigation. Agent and editor links open focused same-origin windows with explicit workspace, thread and view selections. A window's focused view does not replace another window's layout. Links validate their selected workspace and thread; drafts and unsaved editor buffers remain local to their window.

## Terminal transport

Terminal backpressure accounts for both queued characters and queued frames. Browser acknowledgements follow xterm parsing rather than receipt alone, preventing streams of tiny TUI updates from outrunning either queue. Resize is applied in the server's ordered stream, so old-width output is not rendered using a new width. A temporary authority-check failure reconnects to the same live PTY; denied or expired sessions remain denied.

## Existing storage is preserved

The 2026-10-03 Ultrafast update publishes source to the existing `alvin3y12/codex-workspace` Space. Its native read-write `/data` volume remains backed by `alvin3y12/data`; uploads and downloads continue to use `alvin3y12/codex-downloads` through the bucket API.

The workspace password, session/encryption keys, variables, hardware, accounts, workspaces, conversation logs and saved settings are preserved. An authorized transfer writer may be configured only as `HF_DOWNLOAD_TOKEN`, after the reviewed source revision is running; the writer remains excluded from builds, browsers and native agents. The owner separately approved verified repairs to the native diagnostic database and derived conversation-history index, retaining the originals as backups. No fresh resource initialization, data migration or historical reset procedure is part of this deployment.
