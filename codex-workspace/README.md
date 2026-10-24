---
title: Claude Workspace
emoji: 🌘
colorFrom: gray
colorTo: gray
sdk: gradio
sdk_version: 6.21.0
python_version: '3.12'
app_file: app.py
pinned: false
short_description: A persistent workspace powered by Claude Code
---

# Claude Workspace

This Space runs the official Claude Agent SDK and its Claude Code binary inside each saved workspace, with the Arc workspace interface: a split editor and agent view, terminal dock, source control, GitHub import, command palette, and workspace switcher. Claude Code reaches the Anthropic Messages API at `https://alvin3y12-test.hf.space/api`, using the `PASSWORD` Space secret as the API key. The API key is never sent to the browser.

The Space uses the Gradio/Python `app.py` deployment path. It does not use a Docker Space. The public root on port 7860 responds with exactly `status: ok`; open `/work` for the password-protected interface.

## Claude Code features

- **Conversations** stream text, extended thinking, tool calls with diffs and command output, subagent steps, todo plans, and per-turn time, token, and cost totals.
- **History**: search, pin, rename, archive, delete, and reopen any earlier chat. Claude Code sessions started elsewhere in a workspace (for example `claude` in the terminal) can be imported and continued.
- **Model, reasoning effort** (low, medium, high, extra high, max, or automatic) and **extended thinking** can be changed per conversation, even mid-turn.
- **Permission modes**: ask permissions, accept edits, plan mode, auto mode, don't ask, and bypass permissions. Shift+Tab cycles the common modes. Permission prompts offer allow once, always allow (Claude Code's suggested rule), and deny with feedback.
- **Interactive requests**: Claude's multiple-choice questions and plan approvals appear as cards in the conversation.
- **Composer**: `/` lists Claude Code slash commands and skills, `@` mentions workspace files, and images, PDFs, or text files can be attached by paste, drop, or picker. Messages sent while Claude works are queued.
- **Fork** a conversation from any response, **edit and resend** a message, or **rewind** the conversation, optionally restoring files from Claude Code checkpoints.
- **Settings** cover default model and effort, limits, permission rules, additional directories, user memory (`CLAUDE.md`), system prompt additions, output style, settings sources, and MCP servers. **Claude tools** lists slash commands, subagents, MCP server status, and the project `CLAUDE.md`.

## Storage

The existing native `alvin3y12/data` bucket remains attached at `/data`. Workspace files, authentication secrets, and historical data keep their paths. Claude conversations are saved in the persistent state directory as `claude-conversation-*` records; earlier records are upgraded when opened. Claude Code's own session files and user settings live under `/data/claude-workspace/config`, and attachments under `/data/claude-workspace/attachments`.

## Messages API relay

Claude Code talks to a loopback relay inside the Node server, which forwards to `ANTHROPIC_BASE_URL`. The relay folds Claude Code's mid-conversation system reminders into the adjacent user turn and merges consecutive same-role messages, because the account bridge looks for tool results only in the final message. For routes other than `api.anthropic.com` it also replaces binary image and document blocks with text; attached images and PDFs are copied into `.claude/attachments/` in the workspace so Claude can open them with its Read tool.

## Local development

Use Node.js 22, Python 3, and a C compiler. Configure `WORKSPACE_PASSWORD` for the site, `PASSWORD` for the Messages API, and persistent `SESSION_SECRET` and `ENCRYPTION_KEY` values. Then run `npm ci` and `npm run build`. The interface is served at `/work` by `npm start`.
