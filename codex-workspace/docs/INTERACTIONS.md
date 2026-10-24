# Arc interaction behavior

The interface uses one motion scale in `client/interactions.css`: 100 ms for
color and hover feedback, 160 ms for switches and control state changes, and
180 ms for dialog and notification entry. Controls respond to a press immediately
and ease back on release. The timing tokens become zero when reduced motion is
requested; the global safeguard cancels transitions already in flight when the
preference changes and removes transition delays.

- Primary and destructive actions retain readable text while pressed. Busy
  actions remain disabled and legible, with their actual pending label and icon.
- Workspace and conversation rows keep their height and text position. Pointer,
  keyboard focus, selection, and press feedback change their surface or border.
  Row actions remain discoverable without hovering.
- Settings and native tool navigation share the same feedback. Opening a pane
  never animates its width or shifts a mounted editor or terminal.
- Dialogs move 4 px on desktop and 8 px on phones when opened. Menus and tooltips
  fade without moving their anchor. Notifications enter by 4 px. No scaling,
  bounce, authored shadow, or background blur is used.
- Dismissal and action dispatch stay immediate. Closing a menu/dialog removes its
  controls and returns focus through the existing ownership rules; no retained
  exit copy can expose a secret answer, accept another click, or trap focus.
- Notifications keep their 3.5-second reading budget (10 seconds for errors),
  pausing the remaining time while hovered, focused, or the document is hidden.
  Rerenders and responsive row limits never restart the countdown. Manual
  dismissal cancels its timer immediately and returns focus to the preceding
  visible control when appropriate. Replacement, locking, and unmount retire
  obsolete timers; notification lifetime is independent of model requests.
- Notification dismiss buttons have 44 px touch targets. Disabled pagination
  controls retain keyboard focus while a request runs, without misleading press
  feedback or dispatching a second request.

Do not transition `all`, dimensions, virtualized row position, streaming text,
or real progress values. Input/caret behavior, Monaco, xterm, IME, selection,
and scroll anchoring remain owned by their existing implementations. Loading
placeholders have their own scoped slow opacity treatment.

`npm run test:interactions` runs actual production controls in an isolated
Chromium page, covering pressed contrast, stable hit areas, duplicate-action
guards, native typing, nested menu/dialog focus, reduced motion, session-lock
removal, notification countdown/cleanup and touch dismissal. Notification tests
use Playwright's browser clock with unchanged production budgets. Page Visibility
events are supplied explicitly because headless tabs do not reliably hide when
another tab opens. The suite does not contact native tools or model services.

Typing keeps native text insertion, selection, composition, undo and shortcuts.
The decorative caret uses the editor's 80 ms horizontal travel and finite smooth
blink; wraps and newlines snap to their actual baseline. Passwords, revealed
credentials and explicitly private inputs always retain the native caret without
canvas measurement. Monaco and xterm continue to own their editing cursors.

One fixed-size activity mark belongs to the current activity group or response
status. It becomes still during answer/approval waits, reconnects, hidden or
unfocused pages, outside the visible scroll area, and under reduced motion.
New public text may briefly label the status “Responding”; mounting saved text
or reconnecting does not replay it. Every supplied text chunk renders immediately,
without character timers, text fades or a second transcript. Stable Markdown
renderer identities preserve focused copy controls and code/table scroll while
new text arrives. `npm run test:typing` verifies these behaviors with actual
native inputs and ChatPanel controls against local transport fixtures.
