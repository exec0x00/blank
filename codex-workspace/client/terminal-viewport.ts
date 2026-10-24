import type { Terminal } from '@xterm/xterm';

/** Browser-only compatibility for the pinned xterm 5.5.0 viewport. */
interface XtermViewport {
  reset(): void;
  syncScrollArea(immediate?: boolean): void;
  _charSizeService: { height: number };
  _renderDimensions: { device: { cell: { height: number } } };
  _coreBrowserService: { dpr: number };
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Keep queued native scroll events from observing reset's zero row height.
 * xterm otherwise defers synchronization for two frames; a native clamp to
 * scrollTop=0 in that gap can make the buffer's viewport position NaN.
 * Wrapping the native reset also covers in-band RIS and clear, without changing
 * replay bytes, terminal dimensions, or the caller's saved viewport intent. */
export function synchronizeTerminalViewportResets(terminal: Terminal): () => void {
  const viewport = (terminal as unknown as { _core?: { viewport?: XtermViewport } })._core?.viewport;
  if (!viewport || typeof viewport.reset !== 'function' || typeof viewport.syncScrollArea !== 'function') {
    throw new Error('The terminal emulator cannot synchronize its viewport. Reload after updating the app.');
  }
  const original = viewport.reset;
  let disposed = false;
  function reset(this: XtermViewport): void {
    original.call(this);
    // Visited hidden tabs retain their real measurements. An initially hidden
    // or unmeasured renderer keeps xterm's normal deferred measurement instead.
    if (!disposed && positive(this._charSizeService?.height)
      && positive(this._renderDimensions?.device?.cell?.height)
      && positive(this._coreBrowserService?.dpr)) this.syncScrollArea(true);
  }
  viewport.reset = reset;
  return () => {
    if (disposed) return;
    disposed = true;
    if (viewport.reset === reset) viewport.reset = original;
  };
}
