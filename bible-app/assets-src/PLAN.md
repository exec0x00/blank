# Build plan: "Bible", a daily random Bible reading app

> **Status:** plan only. Nothing is built yet.
> **Companion files** (next to this plan):
> - `bible-daily-reader-UI.html`, the UI mockup. Open it in any browser to see the main screens, both widget layouts and the app icon, with real Bible text and realistic numbers.
> - `bible-app-icon.svg` and `bible-app-icon-light.svg`, the app icon artwork, plus 1024-pixel PNG copies (`bible-app-icon-1024.png`, `bible-app-icon-light-1024.png`).
>
> **Name:** the app is called **Bible**. That is the name under the icon on the home screen. The store listing may need a longer name (see Q7).
> **Portability:** the plan names no folders or machine-specific locations. Wherever it mentions a file, it means a file inside the project or the app, by its name only.

---

## 1. The app in one paragraph

Each day the app gives you one short passage of the Bible, picked at random from the parts you haven't read yet. It never repeats anything you have already read. A reading is never longer than the word limit you set in Settings (default 300 words, about 2 minutes). It is built from whole sentences, usually ends at a paragraph break, and starts at the beginning of a chapter or exactly where an earlier reading stopped. A Progress screen shows how much of the Bible you have read: an overall percentage, a map of all 66 books, per-book figures, your streak and an estimated finish date. In Settings you can export your progress to a file and import it on another device. A home-screen widget shows a verse of the day, taken from a library of well-loved verses built from public popularity data downloaded from the internet. Everything works offline.

---

## 2. Your requirements and how the plan meets them

| # | You asked for | How the app does it | Where |
|---|---|---|---|
| R1 | A random part of the Bible to read every day | One reading per calendar day, picked at random from unread text. It is saved when picked, so it stays the same all day. | §8 |
| R2 | See my progress: how much of the Bible I've completed | The percentage is counted by words, so it reflects reading effort. Also shown: the canon map, per-book and Old/New Testament bars, streak, readings done, estimated finish. | §10 |
| R3 | Never read the same part twice | Progress is stored per verse. The picker only uses unread verses. Proven by a full-Bible simulation (§8.9) and by automated property tests (§15). | §8, §15 |
| R4 | It must not be too much | The default is 300 words (about 2 minutes). Missed days don't pile up. Reading more in a day is opt-in only. | §8.7 |
| R5 | Export progress and import it on another device | In Settings: **Export progress** writes a small file you can send through the share sheet. **Import progress** shows a preview, then lets you **Combine** or **Replace**. Works between Android and iOS. | §11 |
| R6 | Change the reading length in words | A slider from 100 to 1,500 words in steps of 25, plus Short, Standard and Long presets. It shows the reading time and finish estimate as you drag. | §13 |
| R7 | A reading must never be longer than that | A hard cap in the picker. If you lower the limit and today's reading is now too long, it is rebuilt at once. Checked by automated property tests for every limit from 100 to 1,500. | §8.6, §15 |
| R8 | Understandable: don't cut sentences in the middle | Readings are made of whole sentences, prefer paragraph breaks, and never start mid-paragraph. A split passage continues the next day. Each reading has a book intro card and shows what you read just before it. The only exception is noted in §8.4. | §8 |
| R9 | A widget with a verse from a library of good verses downloaded from the internet | Verse popularity data from OpenBible.info (CC BY 4.0) is downloaded and curated into about 366 verses. Widgets come in small, medium and large on Android and iOS. | §9 |

---

## 3. Key decisions (recommended defaults)

| Decision | Recommendation | Why | Alternative |
|---|---|---|---|
| Platforms | **Android and iOS**, built with **Flutter**. Each widget's UI is written natively: **Jetpack Glance** (Kotlin) on Android, **WidgetKit/SwiftUI** on iOS. | One codebase for the app. Widgets must be native on both platforms anyway. | If you only use Android: Kotlin + Jetpack Compose + Glance. The rest of the plan still applies. |
| Bible text | **World English Bible (WEB)**, the 66-book edition from eBible.org | Modern, readable English, and public domain, so it can be shipped freely. | KJV is also public domain but archaic. The same pipeline can add it later. |
| Connectivity | **Offline-first.** The whole Bible and the verse library ship inside the app. | No account, no server, no running costs, and it works on a plane. | — |
| Unit of progress | **The verse.** Progress is a set of read verses, not a list of readings. | Changing the word limit can never cause repeats or gaps. | — |
| What "% complete" means | **Words read ÷ total words** | Reading Obadiah (619 words) shouldn't count the same as reading Psalms (41,836 words). | Chapters read (also shown, as a secondary figure) |
| Default length | **300 words** (about 2 minutes) | "Not too much". You can change it. | Ask during onboarding (included, §12) |

---

## 4. Source data (checked 18 October 2026)

### 4.1 Bible text: World English Bible

- **Where:** eBible.org, translation code `engwebp` (WEB, 66-book edition).
  - Formatted text, with paragraphs and poetry lines: `https://ebible.org/Scriptures/engwebp_usfm.zip`
  - Plain verse-per-line text, useful as a cross-check: `https://ebible.org/Scriptures/engwebp_vpl.zip`
- **License:** public domain. "World English Bible" is a trademark of eBible.org, and if you **change the words** you may not call the result WEB. The pipeline only removes markup. It never edits words.
- **Measured from this edition.** Word = a space-separated token of verse text. Verse numbers, footnotes and headings are not counted.

| Fact | Value |
|---|---|
| Books / chapters / verses | 66 / 1,189 / 31,103 |
| Total words | about **756,000** (Old Testament about 581,000, New Testament about 175,000) |
| Longest verse | Esther 8:9, **86 words** (so any limit of 100 or more fits every verse) |
| Longest chapter / shortest | Psalm 119, 2,337 words / Psalm 117, 27 words |
| Average chapter | about 636 words |
| Sentence-safe units (§8.1) | 26,953. Median 25 words; 134 are over 100 words; 10 are over 200; the longest is 320 (Luke 3:23–38, a genealogy) |
| Paragraph starts | about 8,700 (from paragraph, stanza and chapter breaks) |
| Section headings | **none** in this edition, so paragraph breaks serve as the natural boundaries |

- **USFM markup the parser must handle** (these are markup codes, not file locations):
  - `\v` verse, `\c` chapter, `\p` `\m` `\pi1` `\li1` paragraph types, `\q1` `\q2` poetry lines, `\b` stanza break, `\nb` "no break".
  - `\d` psalm titles. **Pitfall:** they appear after the `\c` line, so a naive parser glues Psalm 24's title "A Psalm by David." onto the end of Psalm 23:6. Store titles as headings, never as verse text.
  - `\w word|strong="G1234"\w*` Strong's number tags: keep the word, drop the tag.
  - `\f … \f*` footnotes and `\x … \x*` cross-references: drop them.
  - Book introduction and glossary files (front matter, `GLO`): skip them.

### 4.2 Verse library for the widget: OpenBible.info Topical Bible

- **Where:** `https://www.openbible.info/topics/`. The raw vote counts are at `https://a.openbible.info/data/topic-votes.txt` (about 470,000 lines, updated weekly). Scored data is at `https://a.openbible.info/data/topic-scores.zip`.
- **Format** (tab-separated): `Topic`, `Start Verse ID`, `End Verse ID` (blank for a single verse), `Votes`. Verse ID is `bbcccvvv`: 2-digit book (01 = Genesis … 66 = Revelation), 3-digit chapter, 3-digit verse.
- **License:** CC BY 4.0, so **attribution is required** (text in §19). OpenBible's site quotes the ESV, but we use only the **references and votes**, never its text. The verse text always comes from our bundled WEB.
- **Noise found in the raw data, which curation must handle (§9.1):**
  - Revelation 1:1 is one of the most-voted verses, probably because of the "revelation" topic. It ends with a comma.
  - Popular verses can be fragments. 1 Peter 5:7 begins "casting all your worries on him…"; 2 Timothy 3:16 ends with a comma.
  - Some carry an orphan quote mark. Joshua 1:9 ends with `”` and Matthew 11:28 starts with `“`.
  - Some are popular but are not encouraging out of context, for example 1 Timothy 5:8.
  - There are about 6,750 topics. Verified examples to draw from: hope, peace, comfort, strength, love, joy, faith, trust, encouragement, anxiety, fear, worry, grace, forgiveness, patience, perseverance, gratitude, thankfulness, courage, healing, guidance, wisdom, kindness, prayer, rest, mercy, faithfulness, contentment, new beginnings, overcoming fear, difficult times, hard times, being strong.

---

## 5. Architecture

```
 BUILD TIME (run once by the developer, on any machine with Python 3)
 ┌──────────────────────────────────────────────────────────────────┐
 │ data pipeline script                                              │
 │  download WEB (USFM) ─► parse ─► clean ─► count words ─► units   │
 │  download OpenBible votes ─► curate ─► verse library              │
 │  validate ─► write the Bible database + the verse library + a     │
 │  checksum manifest                                                │
 └──────────────────────────────────────────────────────────────────┘
                     │ bundled into the app as read-only assets
                     ▼
 APP (Flutter)
 ┌───────────────────────── UI ─────────────────────────────────────┐
 │ Onboarding · Today · Reader · Done · Progress · Book detail ·     │
 │ Settings · Import preview · Verse detail                          │
 ├───────────────────────── Domain ─────────────────────────────────┤
 │ ReadingEngine   picks and builds readings, enforces every rule    │
 │ ProgressService totals, per-book figures, streaks, estimates      │
 │ VerseOfDay      the same verse for a date in the app and widgets  │
 │ BackupService   export / validate / preview / combine / replace   │
 │ ReminderService optional daily notification                       │
 │ WidgetBridge    passes the shuffle seed and theme to the widgets  │
 ├───────────────────────── Data ───────────────────────────────────┤
 │ BibleRepository (read-only database) · UserRepository (writable   │
 │ database) · SettingsStore                                         │
 └──────────────────────────────────────────────────────────────────┘
                     │ shared storage (App Group on iOS / app data on Android)
                     ▼
 WIDGETS (native): Android Glance widget · iOS WidgetKit extension
```

**Suggested Flutter packages** (use the latest stable versions when you start):

| Need | Package |
|---|---|
| SQLite with typed queries and migrations | `drift` (+ `sqlite3_flutter_libs`) |
| State management | `flutter_riverpod` |
| Sharing data with home-screen widgets | `home_widget` |
| Share sheet for export | `share_plus` |
| Picking a file to import | `file_picker` |
| Daily reminder | `flutter_local_notifications` (+ `timezone`) |
| Dates and number formatting | `intl` |
| Fonts bundled in the app (no network) | Newsreader (scripture and headings) and Instrument Sans (interface), both under the SIL Open Font License |

---

## 6. Data pipeline (build time)

One script, Python 3 standard library only, so it runs on any machine. It is re-runnable and deterministic: same inputs, same output.

1. **Download** the WEB USFM archive and OpenBible `topic-votes.txt` into a temporary working folder. Record the date and a SHA-256 hash of each download.
2. **Parse USFM** book by book, in canonical order. Skip front matter and the glossary. For each verse record:
   - book, chapter, verse and the clean text;
   - `para_start` (a paragraph, poetry-stanza or chapter break comes before the verse);
   - `poetry_level` (0 = prose, 1 or 2 = indented poetry line);
   - `heading` (a psalm title, if any).
3. **Clean the text.** Strip Strong's tags, footnotes and cross-references. Collapse whitespace. Remove any space before punctuation. Keep the curly quotes and the small-caps "LORD" exactly as WEB prints them.
4. **Count words** per verse (space-separated tokens).
5. **Build sentence-safe units.** Walk the verses inside each chapter and close a unit when a verse ends a sentence: it ends in `.` `?` or `!`, optionally followed by closing quotes `’ ” ’` or a bracket. Each unit records its first and last verse, its word count, `para_start` (its first verse starts a paragraph) and `para_end` (the verse after it starts a paragraph or a chapter, or there is none).
6. **Book metadata:** the 66 names, abbreviations, testament, chapter counts, word totals, and a **one-line plain-English intro** for each book. These 66 lines are written by hand and reviewed. They help a reader who has been dropped into a random passage.
7. **Curate the verse library** (§9.1).
8. **Validate** and fail the build if any check fails:
   - Exactly 66 books, 1,189 chapters and 31,103 verses; total words within 1% of 756,000.
   - No verse text contains a backslash, `|strong=` or an empty string.
   - No verse is longer than 99 words. This guarantees the 100-word minimum always fits one verse.
   - Every unit except the last in a chapter ends with sentence punctuation.
   - Psalm 23:6 does not end with "A Psalm by David." (the title-gluing regression).
   - Every library verse resolves to WEB text, is a complete sentence and is at most 45 words.
9. **Write outputs:** the Bible database (SQLite), the verse library (JSON, also stored inside the database), and a manifest with the source hashes, build date and a `textVersion` such as `2026-10`.
10. **Print a summary:** the counts above, the 10 longest units and the library size. A reviewer checks it by eye.

---

## 7. Data model

**Verse ID** = `book × 1,000,000 + chapter × 1,000 + verse`. For example, John 3:16 = `43003016` and Luke 15:11 = `42015011`. The ID is stable across app updates and translations, sorts in canonical order, and is what export files store.

### 7.1 Bundled Bible database (read-only)

| Table | Columns |
|---|---|
| `book` | id (1–66), code (`GEN`…`REV`), name, short_name, testament (`OT`/`NT`), chapters, words, intro |
| `verse` | id (verse ID), book, chapter, verse, text, words, para_start, poetry_level, heading |
| `unit` | id (sequential, canonical order), first_verse, last_verse, words, para_start, para_end |
| `library_verse` | id, first_verse, last_verse, display_text, words, chars, first_sentence, topic, score |
| `meta` | key, value (textVersion, source hashes, build date) |

### 7.2 User database (writable, on the device)

| Table | Columns | Notes |
|---|---|---|
| `progress` | round, read_bits (a 31,103-bit set, about 3.9 KB), words_read, updated_at | A single row. A bitset makes "is this verse read?" instant. |
| `reading` | id, local_date, status (`active`/`done`/`replaced`), is_extra, word_limit, passages (JSON list of `{first, last, words}`), words, continuation_verse, created_at, completed_at | Full history. Today's reading is the row with status `active`. |
| `settings` | key, value | §13 |
| `backup` | created_at, payload | The automatic snapshot taken before every import, so an import can be undone |
| `app` | install_seed, first_run_at, schema_version | install_seed sets the order of the verse of the day |

---

## 8. The reading engine (the core of the app)

### 8.1 Terms

- **Unit:** the smallest run of whole verses that ends at the end of a sentence (§6 step 5). Most units are one verse; a long sentence spans several. A unit is never split unless §8.4 applies.
- **Paragraph end:** a unit after which a new paragraph, stanza or chapter begins.
- **Read verse:** a verse inside a reading you marked as read. Only completed readings change progress.
- **Start point:** an unread verse that either begins a chapter or comes right after a read verse. These are the only places a new reading may begin, so you never land in the middle of a paragraph you haven't seen the start of.

### 8.2 Building a reading

Input: the word limit `L` and the current progress. Output: one to three passages totalling at most `L` words.

1. **Choose where to start.**
   - If the last completed reading ended mid-paragraph, and **Finish a passage before starting a new one** is on (the default), start at the next verse.
   - Otherwise pick a **uniformly random start point**. Start points are kept in a set that is updated as you read. At first there are 1,189 of them, one per chapter start. Uniform choice means longer books come up more often, in proportion to their size, so coverage stays even.
2. **Fill forward.** Add whole units while the next unit is unread, is in the same book (crossing into the next chapter is allowed) and still fits under `L`.
3. **End at the strongest break that keeps at least half the limit.** Check these in order:
   - If the reading crossed into a new chapter, and stopping at the end of the earlier chapter keeps at least 50% of `L`, stop there.
   - Otherwise, if the last unit added is not a paragraph end, step back to the last paragraph end, as long as that keeps at least 50% of `L`.
   - Otherwise stop at the sentence end you reached.

   Either way the reading ends at a full stop, question mark or exclamation mark.
4. **Bundle when short.** If the reading is under 50% of `L` (for example a 40-word psalm), add another complete passage from a new random start point that fits in the remaining words. Use at most 3 passages a day, each shown with its own reference heading.
5. **Save** the reading as today's `active` reading. Nothing counts as read until you tap **Mark as read**.

**Worked example (shown in the mockup).** Limit 300. The random start lands on Luke 15:11 ("A certain man had two sons"). Units through 15:23 total 283 words, but 15:23 ends mid-paragraph. Stepping back to the paragraph end at 15:21 keeps 244 words, which is at least 150, so today's reading is **Luke 15:11–21 (244 words)**. Tomorrow continues at **Luke 15:22**. That reading fills to Luke 16:2, then steps back to the chapter end, giving **Luke 15:22–32 (233 words)**: the rest of the parable and nothing from the next story.

### 8.3 Pseudocode

```
build_reading(limit):
    passages = []
    budget   = limit
    repeat up to 3 times:
        start = pending_continuation() or random_start_point()
        if start is none: break                    # the whole Bible is read
        cap = limit if passages is empty else budget
        p = fill_forward(start, cap)               # steps 2–3 (chapter end > paragraph end > sentence end),
                                                   # or §8.4 for an oversize unit
        if p is none: break                        # nothing fits in the remaining budget
        passages.append(p); budget -= p.words
        if p ends mid-paragraph and the next verse is unread and in the same book:
            p.continuation = next verse            # applied when the reading is completed
            break
        if sum(words of passages) >= 0.5 * limit: break
    assert sum(words of passages) <= limit         # the hard cap: never violated
    assert no verse in passages is already read    # the no-repeat rule: never violated
    return passages
```

### 8.4 Very long sentences (the one exception, made rare)

A few units are longer than a small limit: genealogies, lists of names and litanies, where English keeps one long sentence going for many verses. At the default 300 words, **only 2 units in the whole Bible** are longer than the limit: Luke 3:23–38 (320 words) and Psalm 136:3–25 (305 words). At the 100-word minimum there are 134.

If a unit is longer than the limit, the cap wins, because a reading must never go over it. The unit is split **between verses**, never inside one; every verse is at most 86 words, so this always works. The split prefers a verse ending in `;` or `:`, then `,`, and keeps at least 50% of the limit. The rest becomes a forced continuation for the next day. The reader shows a note: *"This list continues tomorrow."*

> Open question Q3: if you would rather a sentence never be split, set the minimum limit to 325 words. Then nothing in the Bible ever needs splitting, but you lose the shorter options.

### 8.5 Continuations

- If a reading ends mid-paragraph (step 3 couldn't reach a paragraph end), the next reading picks up exactly there. This is the default and can be switched off in Settings.
- A forced continuation (§8.4) ignores that setting.
- The Done screen and the Today screen say what comes next: *"Tomorrow: Luke 15:22–32, which finishes this passage."*

### 8.6 Changing the length

- The new limit applies from the next reading.
- If today's reading is **not yet marked read and is now longer than the new limit**, it is rebuilt immediately from the same start point. The reading on screen always obeys the current setting.
- Progress is per verse, so no reading ever repeats, whatever limit you used before.

### 8.7 Day rules

- **One reading per local calendar day**, created the first time the app (or the reminder) needs it that day.
- **Missed days don't pile up.** An unread reading simply carries over as the same reading. You never face a backlog.
- **Choose a different passage** (in the reader's menu) replaces today's unread reading with a new random one. The old verses go back into the pool, because nothing was read. Allow up to 3 swaps a day.
- **Read another passage** appears after you finish, and is opt-in. It builds an extra reading with the same rules. It counts toward progress but not toward the streak.
- **Time zones and clock changes:** use the device's local date. Never create a second reading for a date that already has one. If the clock moves backwards, keep the current reading.

### 8.8 Finishing the Bible

When no unread verses remain, show a celebration screen with your totals (days, readings, first and last date). **Start a new round** clears the read set and keeps the history; Progress then shows "Round 2". Near the end the passages get naturally shorter, and bundling (§8.2 step 4) keeps each day reasonably full.

### 8.9 Simulation results (whole Bible, real WEB data)

A prototype of this algorithm was run over all 26,953 units until everything was read. In every run **no verse was ever read twice** and **every verse was eventually read**. "Fill" means a day's words as a share of the limit.

| Limit (words) | Days to finish | Average fill | Days under half full | Days with 2–3 passages | Continuations |
|---|---|---|---|---|---|
| 150 | about 6,170 (about 16.9 years) | 82% | 41 | 373 | 2,208 |
| **300 (default)** | **about 3,060 (about 8.4 years)** | **82%** | **3** | **366** | 412 |
| 500 | about 1,820 (about 5.0 years) | 83% | 1 | 298 | 79 |
| 1,000 | about 950 (about 2.6 years) | 79% | 4 | 227 | 8 |
| 300, changed to 700 on day 400 | about 1,540 | 82% | 2 | 306 | 89 |
| 300, changed to 120 on day 600 | about 6,820 | 81% | 84 | 376 | 2,824 |

What the simulation taught us (and is now part of the design):

- **Begin only at start points.** An earlier version could begin at any paragraph. It broke the text into small islands: fill fell to about 73% and a third of days needed 2–3 passages.
- **Allow crossing into the next chapter** of the same book, so a short remainder of one chapter doesn't make a near-empty day. Ending every reading at a chapter end dropped fill at large limits, to 56% at 1,000 words.
- **But stop at the chapter end whenever that keeps half the limit.** Otherwise a reading can finish one story and then start the next (Luke 15:22–16:2). This rule cost only about 1 point of fill.
- **The honest headline for the Progress screen:** the whole Bible at 300 words a day takes about 8 years. The finish estimate (§10) tells you this plainly and updates when you change the length.

---

## 9. Verse of the day and the widget

### 9.1 Building the curated library (build time)

1. Load `topic-votes.txt` and keep rows whose topic is on an **allowlist** of about 30–40 encouraging topics (§4.2). The pipeline prints every topic name so the list can be checked.
2. Score each passage as the sum of its positive votes across allowed topics. Keep passages of 1–3 verses.
3. **Completeness:** the passage must start with a capital letter (after an optional opening quote) and end with sentence punctuation. If it doesn't, try extending one verse backward or forward to complete the sentence. For example, 1 Peter 5:7 becomes 5:6–7. Drop it if it's still incomplete or over 45 words.
4. **Quote marks:** remove an orphan opening or closing quote mark at the very start or end of the excerpt, as is normal when quoting. Never change a word.
5. Remove overlapping passages, keeping the higher score.
6. Take the top about 450, then **review by hand** and remove verses that read wrongly out of context. Target **366 verses**, enough for a leap year without repeating, plus a reserve list.
7. For each verse store the reference, the WEB display text, word and character counts, the **first complete sentence** (for the small widget) and the topic.
8. Sample entries this produces, in WEB text: Isaiah 41:10, Lamentations 3:22–23, Psalm 46:1, Proverbs 3:5–6, Philippians 4:6–7, Joshua 1:9, Matthew 11:28, Psalm 119:105.

### 9.2 Choosing the day's verse

- Shuffle the library once, using `install_seed`, and walk through it one entry per day starting at the install date. Every verse appears once before any repeats.
- The calculation needs only the date, the seed and the library. **The app and the widgets compute it the same way and always agree**, with no network and no syncing.

### 9.3 Widget sizes

| Size | Android | iOS | Shows |
|---|---|---|---|
| Small | 2×2 | systemSmall | The whole verse if it fits. Otherwise its **first complete sentence** followed by " …". Never cut mid-sentence. Then the reference. |
| Medium | 4×2 | systemMedium | The whole verse, reference and date |
| Large | 4×4 | systemLarge | The whole verse in a larger serif, the reference, the date, and today's reading reference ("Today: Luke 15:11–21") |
| Lock screen (optional) | — | accessoryRectangular | The first sentence and the reference |

- **Text fitting:** step the font size down from the preferred size to a minimum (12 pt on small). If the text still doesn't fit, use the first-sentence fallback.
- **Theme:** follows the system light or dark setting, using the app's colours.
- **Tap:** opens the **Verse detail** screen. It shows the verse, a **Read the whole chapter** link (browsing only; it doesn't count as progress), **Share** and **Copy**.

### 9.4 Keeping widgets current

- **iOS:** the WidgetKit timeline provider makes one entry per local midnight for the next 7 days, with the `.atEnd` policy. The library and seed sit in the App Group container, so the extension computes verses on its own.
- **Android:** the Glance widget reads the same library and seed from app storage. It is refreshed by a one-off WorkManager job scheduled for just after local midnight, which then re-schedules itself. The widget update period is also set as a backup.
- After a time-zone change or reboot the widget recomputes from the date, so it can't get stuck.

### 9.5 Optional: updating the library (later milestone)

Settings → **Update verse library** downloads a newer curated library JSON from a URL you control, for example a release asset in your own repository. The app checks the format and size and falls back to the built-in library on any problem. The app **never** fetches OpenBible data directly at runtime.

---

## 10. Progress

| Figure | Definition |
|---|---|
| **% of the Bible read** | read words ÷ 756,000-ish total words, shown to one decimal place (two below 1%) |
| Old / New Testament | the same figure per testament |
| Per book | read words ÷ book words, plus "x of y chapters touched / finished" |
| Readings | count of completed readings; extra readings are included and labelled |
| Current streak / longest streak | consecutive local days with at least one completed reading |
| Estimated finish | remaining words ÷ (limit × your average fill) days. The average fill comes from your own history, defaulting to 0.82 from §8.9. Shown as "about 8 years" or "about 14 months". |
| Reading time | words ÷ 150 words per minute (a slow, attentive pace), rounded to the nearest minute, minimum 1 |

**The canon map (the Progress screen's signature visual).** All 66 books are drawn as one continuous ribbon wrapped into rows, like lines of text. Each book's width is proportional to its word count, with a hairline between books, and the Old and New Testaments get separate blocks. Every passage you have read is a **gold fleck** at its true position. Because readings are random, the map fills like gold leaf scattered across the whole Bible rather than a bar creeping left to right. Tap a book to open **Book detail**, which shows its chapters with read and unread portions, its intro and its figures.

---

## 11. Export and import (Settings → Progress and backup)

### 11.1 File format

Plain JSON, human-readable and small (a few KB, about 20 KB after years of use). The file is named `bible-progress-YYYY-MM-DD.json` (no folder; the user chooses where it goes).

```json
{
  "app": "bible",
  "format": 1,
  "exportedAt": "2026-10-18T07:42:10+05:30",
  "deviceLabel": "Pixel 8",
  "bible": { "translation": "WEB", "edition": "engwebp", "textVersion": "2026-10" },
  "progress": {
    "round": 1,
    "readRanges": ["19023001-19023006", "42015011-42015021", "45008031-45008039"],
    "wordsRead": 72412
  },
  "history": [
    { "date": "2026-10-18", "passages": ["42015011-42015021"], "words": 244, "limit": 300, "extra": false }
  ],
  "current": { "date": "2026-10-19", "passages": ["42015022-42015032"], "continuation": true },
  "settings": { "dailyWords": 300, "finishPassages": true, "reminder": "07:30",
                "theme": "system", "textScale": 1.0, "verseNumbers": true },
  "integrity": "sha256 of the progress and history sections"
}
```

- `readRanges` lists merged runs of read verse IDs in canonical order. Ranges are stable across app versions and would still apply if another translation were added later.
- `wordsRead` and `integrity` are cross-checks. On import, words are recomputed from the ranges and must match.

### 11.2 Export

Tap **Export progress** to build the file and open the system share sheet (Files, Drive, email, messaging, Nearby Share or AirDrop). Show a confirmation: "Progress exported". Settings shows "Last exported 18 Oct 2026".

### 11.3 Import

1. Tap **Import progress** and pick the file.
2. **Validate:** is it a Bible progress file, a supported format, intact and well-formed, with every verse ID valid?
3. **Preview** both sides: the file (date, device label, % read, readings, last reading) and this device (the same figures).
4. Choose **Combine both** (recommended) or **Replace this device's progress**.
5. Tap **Import progress**. An automatic snapshot of the current progress is saved first. Show "Progress imported" with **Undo**, and keep **Restore previous progress** in Settings for 30 days.

**Combine rules:** read verses = the union of both. History = the union, de-duplicated by date and passages. Streaks are recomputed. This device's settings are kept. An in-progress reading is dropped if any of its verses are now read, and today's reading is then rebuilt.

**Replace rules:** use the file's progress, history and settings. The previous state goes into the snapshot.

**Error messages** (say what happened and what to do):

| Case | Message |
|---|---|
| Wrong file | "This file isn't a Bible progress file. Choose a file you made with Export progress." |
| Newer format | "This file was made by a newer version of the app. Update the app on this device, then import again." |
| Damaged | "This file is incomplete or damaged. Export it again on the other device and import the new file." |
| Empty progress | "This file has no readings in it. Nothing was changed." |

---

## 12. Screens

The mockup shows Today, Reader, Done, Progress, Settings, Import preview and the home-screen widgets. Onboarding, Book detail and Verse detail are described here only.

| Screen | Purpose | Contents and states |
|---|---|---|
| **Onboarding** (first run) | Set expectations and the length | Three short cards: "One passage a day", "Never the same passage twice", "Choose how much". Length presets with the live minutes. Optional reminder time. |
| **Today** | Home | Date; today's reading card (reference, words, minutes, first line, **Start reading**); "Continues yesterday's passage" tag when relevant; mini progress line (% and streak); verse of the day card. Done state: "Read for today" with tomorrow's reference. |
| **Reader** | Read | Book intro card ("Luke · chapter 15 of 24 · Luke's orderly account of Jesus' life"). "Just before this: you read Luke 15:1–10 on 3 Sep" when relevant. Scripture with small verse numbers, paragraph breaks, poetry indents and psalm titles. Multi-passage days show each reference as a heading. Footer: words and limit, continuation note, **Mark as read**. Menu: **Choose a different passage**, **Read the whole chapter**, text size. |
| **Done** | Reward and what's next | "Read for today", words added, new %, the canon map with today's fleck highlighted, streak, tomorrow's reading, **Read another passage** (optional). |
| **Progress** | Show completion | The big %, words read of the total, the canon map, OT/NT bars, stats (readings, streaks, finish estimate), "Closest to finished" books, link to all 66 books. |
| **Book detail** | One book | Chapters as small bars with read portions; intro; figures. |
| **Settings** | Control | §13 |
| **Import preview** | Safe import | §11.3 |
| **Verse detail** | Opened from the widget | Verse, reference, Read the whole chapter, Share, Copy |

**Visual design (matches the mockup):**

- **Feel:** premium and quiet. Use plenty of white space and hairline dividers instead of boxes. One idea per screen.
- **Colour:** porcelain backgrounds and near-black ink. **Gold appears only for progress**: read passages, bars, the streak dot and verse numbers. Primary buttons are solid ink with light text. Dark mode uses deep charcoal, warm off-white text and the same gold.
- **Type:** Newsreader at light weights for references, big numbers and scripture (optical sizes: large for headings, text size for reading). Instrument Sans for interface labels. Small uppercase labels are used sparingly.
- **Components:** a floating, slightly translucent tab bar; a floating "Mark as read" panel in the reader; round icon buttons in the reader's top bar; iOS-style grouped settings lists; a segmented control for length presets; a thin gold slider track.
- **The canon map** is the one signature visual (§10). Everything around it stays plain.

**App icon:**

- **Design:** a gold ribbon bookmark hangs from the top edge and crosses a gold line of text, with three grey lines below on an ink background. Up close it's a bookmark marking today's place; at a glance the ribbon and the gold line form a cross. The grey lines echo the rows of the canon map.
- **Artwork:** `bible-app-icon.svg` is the default (ink) and `bible-app-icon-light.svg` is the light alternate. Both are 1024 × 1024 full-bleed squares with no transparency and no rounded corners, because iOS and Android apply their own mask. The lines and the cross fit inside Android's 66 dp safe circle, so round and squircle masks don't clip them. Only the top of the ribbon runs off the edge, on purpose.
- **iOS:** one 1024-pixel PNG in the asset catalog for the default icon. Add a dark variant (the same art) and a tinted variant (the ribbon and lines in one tone on a transparent background) for iOS 18 and later. The light version ships as an alternate icon chosen in Settings → Appearance.
- **Android:** an adaptive icon with a background layer (the ink gradient) and a foreground layer (the ribbon and lines) on a 108 dp canvas with a 72 dp safe zone. Add a monochrome layer for themed icons (Android 13 and later), and a 512-pixel PNG for the Play Store listing.
- **Check:** look at it at 29, 40, 60 and 180 points and on light, dark and photo wallpapers before release. The mockup shows these sizes.

**Interface copy rules:** sentence case; buttons say exactly what happens ("Mark as read", "Export progress", "Import progress"), and the confirmation uses the same verb ("Marked as read", "Progress exported", "Progress imported"). No guilt messages about missed days.

---

## 13. Settings

| Group | Setting | Default | Range / options | Notes |
|---|---|---|---|---|
| Reading | **Daily length** | 300 words | 100–1,500, steps of 25; presets Short 150 · Standard 300 · Long 600 | Live "about N min · finish in about X years". Helper text: "Readings end at the end of a sentence, usually at a paragraph break, and never go over this length." |
| Reading | Finish a passage before starting a new one | On | On / Off | §8.5 |
| Reading | Show verse numbers | On | On / Off | |
| Reminder | Daily reminder | Off | a time | Notification text: "Today's reading: Luke 15:11–21 · 2 min" |
| Appearance | Text size | 100% | 80–160% | It also follows the system text size |
| Appearance | Theme | System | System / Light / Dark | |
| Progress and backup | **Export progress** | — | — | §11.2 |
| Progress and backup | **Import progress** | — | — | §11.3 |
| Progress and backup | Restore previous progress | hidden until an import happens | — | 30-day snapshot |
| Verse widget | Library info | "366 verses · updated Oct 2026" | — | "How to add the widget" help, per platform |
| About | Sources and licenses | — | — | §19 |
| Danger zone | Reset progress | — | — | Two-step confirmation; makes a snapshot first |

---

## 14. Accessibility and quality

- Scales with the system text size up to 200% without clipping. The reader reflows; the widgets fall back to the first sentence.
- Screen readers: the reference is read as "Luke chapter 15, verses 11 to 21". Verse numbers are spoken as "verse 12", or hidden when they're turned off. The canon map has a text alternative: "9.6% read; closest to finished: Ruth 31%…".
- Contrast is at least 4.5:1 for body text in both themes, and gold flecks have a non-colour cue too: the Book detail lists the read ranges.
- Respect reduce motion (no animated progress fills). Large tap targets (at least 44 pt / 48 dp).
- Performance: cold start under 1.5 s on a mid-range phone, and building a reading under 50 ms. Bitset operations are O(1); the start-point set is updated as you read.
- Privacy: no accounts, no analytics by default, and no network use except an optional library update.

---

## 15. Testing

**Pipeline tests:** the counts in §4.1; parser fixtures for each USFM marker, including the psalm-title regression; every library verse is complete and at most 45 words.

**Engine property tests** (randomised, thousands of runs, using a fixed seed for each failing case):

1. Never longer than the limit, for every limit from 100 to 1,500.
2. Never includes an already-read verse.
3. Repeating until done reads every verse exactly once, with limit changes at random points.
4. Every reading begins at a start point or a continuation.
5. Every passage ends with sentence punctuation, except the oversize-split case, which only happens when a single unit is longer than the limit.
6. Lowering the limit below today's reading rebuilds it.
7. Day rules: one reading per date; carry-over; swaps return verses to the pool; extra readings don't change the streak.

**Golden tests:** with limit 300 and the start Luke 15:11, the result is Luke 15:11–21 with 244 words and a continuation at 15:22. The next reading is Luke 15:22–32 with 233 words: it stops at the chapter end instead of running on to 16:2.

**Backup tests:** export → import round trip is identical; combining two devices gives the union; every error message case; the Undo snapshot restores exactly.

**Widget tests:** the app and widget give the same verse for 400 consecutive dates, across time zones, a daylight-saving change and a leap day; snapshot tests of each size, in light and dark, at the largest text size.

**Manual checklist before release:** install on one Android and one iOS device; read 3 days with clock changes; change the length both ways mid-day; export on Android and import on iOS; add all widget sizes; set a reminder; turn on a screen reader.

---

## 16. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Project setup: Flutter app, CI running tests, fonts, colour tokens from the mockup | The app launches showing a placeholder Today screen; CI is green |
| M1 | Data pipeline and bundled database | All §6 validation checks pass; the database ships in the app; a summary is reviewed |
| M2 | Reading engine and user database | All §15 engine tests pass, including the full-Bible simulation at 150 / 300 / 1,000 words |
| M3 | Today, Reader and Done screens | Can read and mark readings for several simulated days; matches the mockup |
| M4 | Progress screen and Book detail, with the canon map | The figures agree with the database; the map renders under 16 ms per frame |
| M5 | Settings, length changes, export and import | Round-trip and combine tests pass; Android to iOS file transfer works by hand |
| M6 | Verse library and widgets (Android and iOS) | Widgets show the same verse as the app for 400 simulated days; three sizes, both themes |
| M7 | Onboarding, reminder, accessibility, polish | The §14 checklist and §15 manual checklist pass |
| M8 | Release prep | Store listings, app icon exported for every platform size and variant (§12), privacy statement ("no data collected"), attribution screen |
| Later | Optional: library update, extra translations, reading audio | — |

---

## 17. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Random passages feel out of context | Readings start only at chapter starts or after earlier reading; the book intro card; "Just before this…" line; Read the whole chapter |
| Finishing takes years at short lengths | The finish estimate is stated honestly; Read another passage; presets make longer lengths easy |
| Long single sentences can't fit small limits | Verse-boundary split with a clear note (§8.4); a 325-word minimum is available as an option (Q3) |
| Popularity data includes odd or negative verses | Topic allowlist, completeness rules, review by hand, reserve list |
| Users lose a phone and their progress | Remind them to export after every 30 readings (one small dismissable card) |
| WEB text update changes verse wording | Progress is stored by verse ID, so it's unaffected; `textVersion` is recorded for support |
| The store name "Bible" is very likely taken | Keep "Bible" as the home-screen name and use a distinct store name (Q7) |
| Widget refresh limits on Android | Compute from date + seed, so even a late refresh shows the right verse when it runs; midnight work plus a backup update period |

---

## 18. Open questions (each has a recommended default, so work can start)

| # | Question | Default if no answer |
|---|---|---|
| Q1 | Android only, or Android and iOS? | Both, with Flutter |
| Q2 | Which translation? | WEB |
| Q3 | 100-word minimum with rare verse-boundary splits of very long lists, or a 325-word minimum with no splits ever? | 100 minimum with the rule in §8.4 |
| Q4 | Should "Read another passage" exist, given "must not be too much"? | Yes, opt-in and never prompted |
| Q5 | Daily reminder on by default? | Off; offered during onboarding |
| Q6 | Optional cloud sync instead of files? | Out of scope for v1; files only |
| Q7 | Store listing name? App Store names must be unique, and "Bible" alone is almost certainly in use. | Home-screen name "Bible"; store name "Bible: One Passage a Day" |

---

## 19. Attribution text to ship (About screen and store listing)

> Scripture: World English Bible (WEB), public domain. "World English Bible" is a trademark of eBible.org.
> Verse of the day selection uses data from OpenBible.info (Topical Bible), licensed under CC BY 4.0.
> Fonts: Newsreader and Instrument Sans, SIL Open Font License.

---

## 20. Out of scope for version 1

Accounts and cloud sync · social features · notes and highlights · audio Bible · reading plans other than random · multiple translations at once · tablets and watch apps (the layouts should still scale to tablets).
