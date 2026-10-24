import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchTerminalConnection, TERMINAL_HANDSHAKE_TIMEOUT_MS, TERMINAL_HEARTBEAT_INTERVAL_MS,
  TERMINAL_HEARTBEAT_TIMEOUT_MS, TERMINAL_REPLAY_TIMEOUT_MS } from '../client/terminal-connection';

describe('terminal connection liveness', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });
  function fixture() {
    let visible = true;
    const sent: string[] = [];
    const timeout = vi.fn();
    const monitor = watchTerminalConnection({ sendPing: id => { sent.push(id); return true; }, onTimeout: timeout, visible: () => visible });
    return { monitor, sent, timeout, hide() { visible = false; monitor.suspend(); }, show() { visible = true; monitor.resume(); } };
  }

  it('bounds an open socket which never finishes its application handshake', () => {
    const f = fixture();
    vi.advanceTimersByTime(TERMINAL_HANDSHAKE_TIMEOUT_MS);
    expect(f.timeout).toHaveBeenCalledExactlyOnceWith('handshake');
    expect(f.sent).toEqual([]);
  });

  it('allows real replay progress while bounding incomplete replay', () => {
    const f = fixture();
    for (let elapsed = 0; elapsed < TERMINAL_REPLAY_TIMEOUT_MS - 10_000; elapsed += 10_000) {
      vi.advanceTimersByTime(10_000); f.monitor.progress();
      expect(f.timeout).not.toHaveBeenCalled();
    }
    vi.advanceTimersByTime(10_000);
    expect(f.timeout).toHaveBeenCalledExactlyOnceWith('handshake');
  });

  it('checks round-trip liveness and ignores unmatched pongs', () => {
    const f = fixture(); f.monitor.ready();
    vi.advanceTimersByTime(TERMINAL_HEARTBEAT_INTERVAL_MS);
    expect(f.sent).toHaveLength(1);
    f.monitor.pong('another-connection'); f.monitor.progress();
    vi.advanceTimersByTime(TERMINAL_HEARTBEAT_TIMEOUT_MS);
    expect(f.timeout).toHaveBeenCalledExactlyOnceWith('heartbeat');
    f.monitor.pong(f.sent[0]);
    vi.advanceTimersByTime(60_000);
    expect(f.sent).toHaveLength(1);
  });

  it('accepts matching pongs and continues checking a healthy idle shell', () => {
    const f = fixture(); f.monitor.ready();
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(TERMINAL_HEARTBEAT_INTERVAL_MS);
      f.monitor.pong(f.sent.at(-1)!);
    }
    expect(f.sent).toHaveLength(4);
    expect(f.timeout).not.toHaveBeenCalled();
    f.monitor.dispose();
  });

  it('gives a resumed hidden browser a fresh deadline and rejects its old pong', () => {
    const f = fixture(); f.monitor.ready(); f.monitor.resume();
    const old = f.sent[0]; f.hide();
    vi.advanceTimersByTime(120_000);
    expect(f.timeout).not.toHaveBeenCalled();
    f.show(); expect(f.sent).toHaveLength(2);
    f.monitor.pong(old);
    vi.advanceTimersByTime(TERMINAL_HEARTBEAT_TIMEOUT_MS - 1);
    expect(f.timeout).not.toHaveBeenCalled();
    f.monitor.pong(f.sent[1]);
    vi.advanceTimersByTime(1);
    expect(f.timeout).not.toHaveBeenCalled();
    f.monitor.dispose();
  });

  it('probes afresh when machine suspension delays a foreground deadline', () => {
    const f = fixture(); f.monitor.ready(); f.monitor.resume();
    vi.setSystemTime(Date.now() + 120_000);
    vi.advanceTimersByTime(TERMINAL_HEARTBEAT_TIMEOUT_MS);
    expect(f.sent).toHaveLength(2);
    expect(f.timeout).not.toHaveBeenCalled();
    f.monitor.pong(f.sent[1]); f.monitor.dispose();
  });

  it('releases every timer on unmount, lock, or replacement', () => {
    const f = fixture(); f.monitor.ready(); f.monitor.resume(); f.monitor.dispose();
    f.monitor.pong(f.sent[0]); f.monitor.resume();
    vi.advanceTimersByTime(120_000);
    expect(f.sent).toHaveLength(1);
    expect(f.timeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
