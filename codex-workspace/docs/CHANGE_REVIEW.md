# Recorded change review

Chat file-change activities show a summary and **Open changes**. File rows open the same editor review at the selected recorded file, including deleted files. Commands keep their normal inline output.

`App` validates the workspace identity, reveals the editor and passes a `ChangeReviewRequest` to `EditorPanel`. On phones the request selects the editor surface. A single **Change review** tab contains read-only Monaco patch text, file/section selection, search, change navigation and character-page controls. The editable file subtree remains mounted, preserving buffers, undo state and saved-file comparisons. The main Save action and editor save shortcuts are disabled while review is selected.

The review consumes only recorded data:

- Native changes use `/threads/:id/native-item-detail` with the exact thread, turn and item identities and `field=output`. The public item must be a native `fileChange`. Requests retain the existing 16,000-character limit, bounded history search, part limits, native cursor and version checks.
- Older saved changes use the existing `/threads/:id/history/detail` public presentation, preserving its epoch, item, activity and page-version checks.
- The aggregate native turn preview is an immutable snapshot of the existing bounded `native.diff` text. Its truncation remains visible. That preview has no authoritative turn identity, so the client does not invent one.

No historical before/after file is reconstructed from current workspace files. The patch editor does not request working file contents. It displays missing, empty, unsupported, truncated and changed-version results explicitly. A Continue search action advances the bounded native history search; it does not automatically scan the full conversation.

Review model URIs use `codex-change-review:` and include the editor instance, request, workspace, thread, turn/item, recorded version, file/part and page offset. Each page owns and disposes its model. Hiding the review, changing its target, switching workspaces or locking the session cancels outstanding reads. Opening a regular file selects its preserved editor tab; closing review never writes a file.

Focused regression coverage is in `tests/change-review.test.tsx`; the native-detail browser seam also verifies the chat callback. `tests/e2e/agent-change-review.spec.ts` exercises dirty buffers, Save controls, native patch paging and deleted files through the actual App/Monaco, including hidden-editor and phone layouts.
