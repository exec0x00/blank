# Claude Workspace maintenance

This Space uses the official `@anthropic-ai/claude-agent-sdk` and its Claude Code binary. The coding agent calls `https://alvin3y12-test.hf.space/api/v1/messages` through `ANTHROPIC_BASE_URL=https://alvin3y12-test.hf.space/api`; its API key comes from the `PASSWORD` Space secret. Never put that value in source, logs, or browser responses. The browser uses the separate `WORKSPACE_PASSWORD` authentication flow.

Preserve the existing `alvin3y12/data` native bucket mounted at `/data`, including all workspace files, account connections, session/encryption secrets, historical records, and file metadata. Retaining historical `/data/codex-workspace` paths and cookie names is necessary for compatibility; it does not authorize starting the old Codex runtime. New Claude Code session files live under `/data/claude-workspace/config`, with separate conversation records in the existing persistent state store.

Only modify the `alvin3y12/codex-workspace` Space for this workspace application. Deploy it as the existing Gradio/Python Space, never as a Docker Space. The public root at port 7860 returns exactly `status: ok`; the interface is at `/work`. The Python entry point registers an empty ZeroGPU function and keeps the root status listener available during Node preparation.

Use Claude Code's native tool loop and saved session ID. Follow-up messages resume the selected chat; New chat creates a fresh session. Permission modes map directly to Claude Code's modes, and tools that require permission wait for an explicit web approval. Claude Code must reach the Messages API through the loopback relay in `server/claude-relay.ts`; keep its message normalization, because the account bridge only accepts tool results in the final message and rejects binary content blocks. Use the authenticated model catalog from the test Space, and do not show OpenAI-only controls such as service tiers.

The interface is the Arc workspace shell (`client/App.tsx`). The Claude conversation lives in `client/components/ChatPanel.tsx` and `client/components/claude/`, and the backend in `server/claude-agent.ts`.

Run `npm run build` and `npx vitest run tests/claude-relay.test.ts` with Node 22, and check the workspace root, login, model catalog, Claude tool round trip, permission flow, and resumed chat before deployment. Keep unrelated Hugging Face Spaces untouched.
