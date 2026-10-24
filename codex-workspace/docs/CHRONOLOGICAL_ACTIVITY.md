# Chronological conversation activity

The main conversation and inline child transcripts render text, public reasoning summaries, and tool actions in their recorded sequence. A tool disclosure contains that action’s readable details; it never gathers later assistant text or the rest of a turn. Assistant fragments retain accessible response labels and a copy action without repeating the visible Codex name or icon.

`Thread.timeline` is a versioned public presentation record. Entries have stable IDs, monotonic sequence positions, and revisions. Text entries contain sanitized text with offsets into the canonical sanitized `message.content`; activity entries refer to the existing tool records. Public reasoning fragments contain only the provider’s bounded public summary text. No private reasoning, encrypted content, or tool protocol object is interpreted as presentation text.

The engine reserves text positions when the source callback arrives. The privacy stream reports only released sanitized text and its original source position, allowing a held secret prefix or split Unicode character to return to the correct fragment when it becomes safe to display. Raw source offsets and privacy buffers are temporary memory, never saved in the public timeline.

Live `timeline` events replace full entries by ID and revision. Compatibility events retain ordinary message/activity state and carry `timelineRevision`; v1 clients do not append their legacy text deltas. Reconnect snapshots are authoritative revision barriers, including after a rewind. Tool completion and output updates retain the action’s initial position.

An identical final answer keeps every streamed boundary. A completion-only suffix appears where completion occurred. If an authoritative final value changes earlier words, the obsolete fragments are cleared and the corrected value appears at the completion position with a brief update label. The renderer does not guess where revised words would have occurred among previous tools. Public-summary replacements follow the same rule.

Forks copy retained evidence. Rewinds remove references to discarded messages and retain the sequence high-water mark. Semantic compaction changes the model’s input context while preserving the full visible timeline and recording its public notice before continuation. New ordinary, goal, and review turns also record the actual resolved model and reasoning effort; older turns are not assigned inferred settings.

Older assistant messages without event evidence remain explicit legacy entries in saved message order. Their text and activity are preserved with one explanation that exact intra-message ordering was not recorded. Timestamps are never used to manufacture chronology.

Behavioral tests cover the writer, privacy stream, reducer and renderer in `tests/agent-timeline.test.ts` and `tests/conversation-timeline.test.tsx`. `tests/agent-timeline-integration.test.ts` uses the actual engine, filesystem tools, ordinary JSON store, restart, reconnect, guidance, fork, rewind and automatic compaction with a controlled provider boundary. `tests/e2e/chronological-activity.spec.ts` exercises the real ChatPanel against a local HTTP/SSE fixture, including keyboard controls, narrow layouts, reload, and retained unsupported reasoning selections. Browser execution status is tracked separately in release verification.
