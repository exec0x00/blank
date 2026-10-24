# Terminal connection stability

The Arc Workspace terminal continues to use xterm.js and a real native PTY. A
browser disconnect does not kill the shell, and input from a previously connected
browser is never queued for replay after reconnection.

The September 2026 update fixes three verified issues:

- Output-stall time starts when unconsumed output creates pressure. Time spent
  idle no longer causes a healthy terminal to be disconnected on its next burst.
  Real parser acknowledgements reset the progress deadline; byte and frame
  watermarks still bound output.
- Each browser socket has a bounded handshake and replay deadline, then explicit
  application ping/pong checks. A stalled OPEN/CONNECTING socket is retired
  without waiting for its close handshake. Reconnection uses the same session
  and request identity. Hidden tabs and resumed machines get fresh probe deadlines.
- Background terminal reconnection preserves focus in an editor or composer.

The implementation follows the same principles used by established browser
terminals: [xterm.js parser-completion flow control](https://xtermjs.org/docs/guides/flowcontrol/),
[VS Code's PTY service](https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/ptyService.ts),
and [WeTTY's explicit connection heartbeat](https://github.com/butlerx/wetty/blob/main/src/shared/defaults.ts).
The audit also compared [ttyd](https://github.com/tsl0922/ttyd/blob/main/html/src/components/terminal/xterm/index.ts).
Their output buffering and pause/resume mechanisms are useful references;
their defaults for ending PTYs on socket disconnect are not used here.

Ordered resize/replay barriers, bounded history, IME input, query-response
ownership, and warm terminal tabs remain intact. The existing default durable
shell history is retained. Local performance measurements do not establish
latency of the production bucket mount, so this update does not claim a measured
speedup from changing history persistence.

Regression coverage includes real idle-to-burst and consumption-stall cases,
session/PID retention, silent-pong loss, no input replay, focus preservation,
reduced motion, phone controls, large output, and tiny TUI frames under CPU
throttling. See `tests/terminal-connection.test.ts`, `tests/terminal.test.ts`, and
the terminal browser suites.
