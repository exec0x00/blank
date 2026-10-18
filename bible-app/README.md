# Bible: one passage a day

An Android app that gives you one short Bible reading each day, picked at random from the parts you
haven't read yet. It never repeats a passage, never goes over the length you set, and always ends at the
end of a sentence. Everything works offline. See `assets-src/PLAN.md` for the full design and
`assets-src/UI-mockup.html` for the mockup this app follows.

* Kotlin, Jetpack Compose (foundation only, no Material), Jetpack Glance for the widget. minSdk 26, targetSdk 35.
* Text: World English Bible (public domain), bundled. Verse library: OpenBible.info topical votes (CC BY 4.0).
* Fonts: Newsreader and Instrument Sans (SIL OFL), bundled as variable fonts.

## Build

```
./gradlew testDebugUnitTest      # engine, day rules, backup, widget-verse and screenshot tests
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease        # signed with keystore.properties if present, else the debug key
```

Needs JDK 17+ and the Android SDK (platform 35, build-tools 35). Set `sdk.dir` in `local.properties`.
For a release signing key, create `keystore.properties` (it is git-ignored):

```
storeFile=path/to/your.keystore
storePassword=...
keyAlias=...
keyPassword=...
```

## Layout

| Path | What |
|---|---|
| `tools/build_data.py` | Data pipeline: downloads the WEB text and OpenBible votes, parses USFM, validates, writes `app/src/main/assets/*`. `python3 -I tools/build_data.py --work <dir> --out app/src/main/assets` |
| `engine/ReadingEngine.kt` | The core: start points, filling with whole sentences, paragraph/chapter breaks, bundling, oversize split |
| `domain/AppController.kt` | Day rules: one reading per day, carry-over, swaps, extra readings, limit changes, snapshots |
| `domain/Backup.kt` | Export, validate, preview, combine or replace |
| `domain/VerseOfDay.kt` | Seeded shuffle shared by the app and the widget |
| `ui/` | Compose screens, the canon map, and the animation and micro-interaction components |
| `widget/`, `reminder/` | Glance widget (small, medium, large) with midnight refresh; optional daily reminder |

## Design decisions that differ from, or refine, the plan

* **Native Android instead of Flutter.** The plan names Kotlin + Compose + Glance as the Android-only route; the iOS parts (WidgetKit, iOS icons) are not built.
* **No database.** The Bible loads into memory from a text asset, and user state is one atomically written JSON file.
* **Continuations.** A reading continues the next day when its fill ran out inside a paragraph, even if it stepped back to an earlier paragraph break. This satisfies both the plan's rule and its Luke 15 golden example (11–21 then 22–32). Simulation at 300 words: about 3,060 days, 82% fill.
* **Psalm titles** are headings and are not counted as words, so the total is 755,097 words rather than about 756,000.
* Five verses that hold only a variant-reading footnote in this edition (Luke 17:36, Acts 8:37, 15:34, 24:7, Romans 16:25) are kept as empty verses so counts and ids stay standard.
* The verse library was ranked by OpenBible votes over an allowlist of encouraging topics, then reviewed against a blocklist (`LIBRARY_BLOCKLIST_REFS` in the pipeline).
