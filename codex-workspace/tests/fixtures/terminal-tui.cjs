// Owned, harmless PTY acceptance fixture. Uses the real terminal's raw input
// and VT screen controls; every reported byte comes from stdin on the host PTY.
const fs = require('node:fs');
const log = process.argv[2];
if (!log || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error('A real PTY and owned log path are required.');
process.stdin.setRawMode(true);
process.stdin.resume();
let updates = 0;
function draw() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  process.stdout.write('\x1b[2J\x1b[H\x1b[38;2;110;190;230mNative TUI fixture\x1b[0m'
    + `\x1b[2;1HTERM=${process.env.TERM}`
    + '\x1b[3;1H\x1b[32mOSC palette\x1b[0m'
    + '\x1b[4;1HUnicode 你好 😀 café'
    + `\x1b[6;1HUpdates ${updates}`
    + `\x1b[${Math.max(7, rows - 1)};1HSize ${cols} x ${rows}`
    + `\x1b[2;${Math.max(3, rows - 2)}r\x1b[6;12H`);
}
process.stdout.write('\x1b]4;2;rgb:88/ee/aa\x1b\\\x1b[?1049h\x1b[?1h\x1b[?66h\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?25l');
draw();
fs.writeFileSync(`${log}.ready`, JSON.stringify({ pid: process.pid, term: process.env.TERM, colorterm: process.env.COLORTERM }));
process.on('SIGWINCH', draw);
process.stdin.on('data', (chunk) => {
  fs.appendFileSync(log, `${chunk.toString('hex')}\n`);
  if (chunk.equals(Buffer.from('q'))) {
    process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?1l\x1b[?66l\x1b[?25h\x1b[?1049l\r\nTUI closed cleanly\r\n');
    process.stdin.setRawMode(false);
    process.exit(0);
  }
  if (chunk.equals(Buffer.from('D'))) process.stdout.write('\x1b[6n');
  else { updates++; draw(); }
});
