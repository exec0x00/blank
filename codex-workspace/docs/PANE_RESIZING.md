# Resizable workspace panes

Desktop and laptop layouts expose **Resize agent and editor** and **Resize editor and explorer** separators. The agent stays on the left, the editor in the centre, and the explorer at the right. Each divider takes space from its adjacent pane. The desktop/laptop editor retains simultaneous code and explorer panes even when the combined editor region is narrower than the old 640 px phone-style cutoff. Tablet and phone navigation remain separate.

`client/pane-geometry.ts` resolves the actual stage width with 8 px divider gutters, a 300 px agent minimum, a 320 px code minimum and a 180 px explorer minimum. A pathological smaller host container scales those minima to fit. Saved sizes are desired sizes: shrinking a viewport, hiding a pane or changing layouts never writes a clamp back to storage. Returning to a larger viewport restores its saved preference. Explicitly resizing the explorer also preserves the agent's currently rendered ratio if an older desired ratio had been clamped.

The existing authenticated `/api/ui-state` journal and revision checks persist two optional fields in each `layouts[profile]` entry:

- `agentWidthRatio`: a finite number from 0.1 through 0.85, relative to the available outer-pane space after its divider.
- `explorerWidth`: an integer from 160 through 720 CSS pixels. Rendering applies the usable 180 px minimum when room allows.

Preferences are shared across workspaces within a layout profile. Desktop and laptop preferences are independent. The same `/data` state store, offline pending journal, conflict notices and retry controls used for other interface preferences apply. No buffers or credentials are added to the preference record. A pointer move only changes a local preview; a completed drag or keyboard resize commits. Escape, native pointer cancellation, loss of capture, window blur, locking, workspace changes and viewport changes cancel the in-progress preview.

Both separators expose orientation, controlled pane IDs, bounds and current width through ARIA. Left/Right move the divider 16 px; Shift uses 48 px. Home/End choose the controlled pane's minimum/maximum. Pointer capture continues a drag outside the gutter. A centred grip expands to a 44 px touch target without covering the full adjacent pane edges. Focus and hover are neutral; reduced motion disables the divider transition. Resizing changes layout dimensions without changing component keys, Monaco models, chat drafts or terminal sessions.

Validation sources:

- `tests/pane-geometry.test.ts`: eight geometry, bound and preference tests.
- `tests/pane-persistence.test.ts`: three real authenticated client/HTTP/store tests, including a new service instance with the disposable runtime directory removed, independent profile restoration, stale revisions and invalid writes.
- `tests/e2e/pane-resize.spec.ts`: eleven real browser cases for both dividers, reload persistence, keyboard bounds, pointer cancellation, native Chromium touch input, profile changes, workspace switching, Monaco undo/buffer continuity, drafts and a real PTY session.

These cases were authored under the coordinator's source-only process restriction. They have not yet been compiled or executed. The fresh-process browser manifest must be regenerated after all specs are frozen.
