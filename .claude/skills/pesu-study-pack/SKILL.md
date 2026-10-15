---
name: pesu-study-pack
description: Build exam study packs (six HTML + six PDF documents — master, formulas & symbols, important points, graphs & diagrams, flowcharts & visuals, short notes & keywords) from course material such as PESU slide decks, AV-summary transcripts, videos, class-work sheets and past ESA papers, in the user's house design (Flowchart Template v7 + Graph Style Guide v2, Computer Modern, Okabe–Ito). Use whenever the user points at a Hugging Face bucket (e.g. huggingface.co/buckets/alvin3y10/data), a local folder of course material, or names a subject / unit / class / topic and asks for study notes, PDFs, a study pack, revision material, "do the same as before", or "like the chemistry/maths pack" — for a single session, a section, a whole unit, several units or a whole subject.
---

# PESU study pack

You turn course material into **six print-ready documents, each as HTML and PDF**, in a fixed design. Everything is built from a data file (the *pack*) by the engine in this skill. You write the content and the figures; the engine does the layout, maths, PDF printing, single-file HTML and QA.

`SKILL_DIR` is this file's directory. Read these before starting:

- `references/lessons.md`: **every mistake made so far. Read it first.**
- `references/sources.md`: bucket API and layout, which file format to use for what, when a video is allowed.
- `references/content-schema.md`: the pack format, IDs, source tags, flowchart layouts.
- `references/design.md`: the design system. The user's original templates are in `references/templates/`.
- `examples/maths-u1-geometrical-interpretation/`: a complete, real pack to imitate (class 002 of Engineering Mathematics I).
- `references/batch.md`: the protocol for building many packs in parallel sessions (one subject-unit each), and `scripts/merge_unit.py` for the unit master.

## 0. Pin down the request

Work these out from the message; ask only if it is truly ambiguous.

- **Source.** Either a bucket URL / `owner/name:path`, or a local folder. The default bucket is `alvin3y10/data`, path `pesuc/`.
- **Subject.** The course code and name, e.g. UE26MA141A Engineering Mathematics – I.
- **Scope.** One of:
  - a topic or session (one or more `NNN_` decks/videos);
  - a section of a unit (a range of sessions);
  - a whole unit;
  - several units;
  - a whole subject.

  Honour "only X, nothing else" strictly. If a deck also covers an adjacent subtopic, include it and say so.
- **Pack granularity.**
  - One pack for a topic, section or unit.
  - For several units or a whole subject, build **one pack per unit** (each a complete set of six), unless the user asks for a single combined set. In that case, use one pack with `MODULES` = units.
- **Where to write.** `packs/<subject-short>-u<N>-<scope-slug>/` in the current repo.
- **What to return.** PDFs and HTML. Send the PDFs and `output/standalone/*.html` (single-file). The plain `output/*.html` need `assets/` next to them.

## 1. Set up

```bash
bash $SKILL_DIR/scripts/setup.sh                     # pip deps, katex, tool check
python3 -I $SKILL_DIR/scripts/new_pack.py packs/<name> --course "…" --unit "…" --scope "…" --title "…" --slug … --header "…"
```

## 2. Inventory every source in scope

```bash
python3 -I $SKILL_DIR/scripts/hf_ls.py "https://huggingface.co/buckets/alvin3y10/data/tree/pesuc/PESU_Materials/Sem-1" --dirs
python3 -I $SKILL_DIR/scripts/hf_ls.py alvin3y10/data:pesuc/PESU_Materials/Sem-1/<COURSE>/Unit_0N --grep '00[2-4]_'
python3 -I $SKILL_DIR/scripts/hf_ls.py alvin3y10/data:pesuc/First_Year_8enterprise/Files --grep '<Subject>'
```

Then check the course-level files:

- `DOWNLOAD_MANIFEST.csv`: part order and durations.
- `FAILED_VIDEOS.md`: missing videos. Record each one as a gap.
- The `First_Year_8enterprise` subject folder: consolidated slides, CW sheets with answers, ESA papers (password `8enterprise`).

Download everything except videos into `work/sources/`. Its own empty directory, untrusted, never executed.

```bash
python3 -I $SKILL_DIR/scripts/hf_ls.py alvin3y10/data:<path> --grep '<pattern>' | python3 -I $SKILL_DIR/scripts/hf_get.py alvin3y10/data packs/<name>/work/sources
```

## 3. Read everything (images, not just text)

- **Decks.** `DPI=80 bash $SKILL_DIR/scripts/render_slides.sh work/render work/sources/*.pptx`, then make contact sheets with `sheet.py` (2 columns × 4 rows) and **Read them**. Equations and diagrams exist only in the images. Diff `.slides.md` against `.slides.txt`.
- **Transcripts.** Read every `.transcript.md` fully, and cite with its timestamps.
  - Grep `.transcript.txt` for emphasis: important, remember, note that, exam, must, never.
  - Find low-confidence segments in `.transcript.json` (`avg_logprob < −0.5`).
  - Correct ASR errors (lessons §11). Never quote them.
- **Past papers.** Render with `PDF_PASSWORD=8enterprise DPI=90` and view 2×2 per sheet. Map every Q1… sub-question to its unit and topic, and dedupe identical papers. Keep only the questions in scope.
- **CW sheets and consolidated PDFs.** Use `pdftotext -upw 8enterprise -layout`. Check unclear pages by rendering them.
- **Video.** Only for the five triggers in `sources.md`: `bash $SKILL_DIR/scripts/grab_frame.sh alvin3y10/data "<mp4 path>" work/frames <sec> …`

## 4. Topic map

Split the scope into topics T1…Tn in teaching order (about one per major slide group). Group them into `MODULES` for unit-or-larger scopes. Write the topic map to `parts/` early. It is the skeleton every lane fills.

## 5. Extract into the pack

Write `parts/<lane>.py` using the schema. For each topic:

- **Overview:** 3–4 sentences.
- **Definitions:** exam-reproducible wording.
- **Statements:** verbatim slide wording of laws and principles.
- **Formulas:** every formula, with gives / applies / units / note. Take the formula from the rendered slide image. Use `code` instead of `tex` for programming subjects.
- **Symbols:** every symbol, flagging same-letter clashes (μ as reduced mass vs chemical potential).
- **Points, why and traps.**
- **Worked examples:** from CW and ESA, numbers **verified with sympy**.
- **Past-paper questions,** with links to their worked solutions.
- **Short note, keywords and rapid recall.** Totals: about 40–60 keywords and 20–40 Q→A per unit; fewer for a single session.
- **Figures:** `FIGS` + `figures.py` / `figs/<lane>.py`, one function per figure using `figstyle`. Redraw every graph or diagram in the material; never paste screenshots. Choose illustrative functions that reproduce the shapes, and say so in `figure_note`.
- **Flowcharts:** procedures, decisions, derivations, classifications, using the eight layouts.
- **Comparison tables:** wherever the material compares things.

Every item carries `srcs`. Anything not in the current material carries a flag (*added for clarity*, *transcript only*, *video only*, *not on current slides*). Fill `PACK` fully: sources, gaps (missing videos, syllabus drift, unreadable items, ASR corrections), `asr_forbidden`, `pyq_note`, `tag_legend`.

## 6. ESA weighting

Count how often each topic is asked in the deduplicated papers:

- **★★★:** asked about 3 or more times, or forms the core of a long question.
- **★★:** asked once or twice, or computed in CW problems.
- **★:** conceptual and never asked.

Instructor emphasis ("important", "remember") raises an item one level, up to ★★★. State in `pyq_note` which papers were checked and what was never asked.

## 7. Build, look, fix, repeat

```bash
bash $SKILL_DIR/scripts/make.sh packs/<name> --sheets   # figures → HTML → PDF → standalone → QA (+ contact sheets)
```

- **Read every figure** first: `python3 -I $SKILL_DIR/scripts/preview_figs.py packs/<name>` writes `work/qa/figs_*.png`. Fix label collisions and bunched 3-D views (lessons §19–21).
- **Read every QA sheet** in `work/qa/`. Look for overflow, clipped content, orphaned headings, half-empty pages and split tables.
- QA must print `QA passed`: no raw LaTeX, no broken links, no ASR artefacts, every item sourced, every figure drawn, fonts embedded.
- For design problems, fix the **engine** (`study.css`, `lib.py`, `figstyle.py`), not one pack. Then add the lesson to `references/lessons.md`.

## 8. Large scopes: parallel lanes

For more than about 4 sessions, split the work into lanes of 2–3 sessions each.

- **With a saved workflow** (the user said "use a workflow", or ultracode is on): run `Workflow({name: "study-pack", args: {source, scope, pack_dir, skill_dir}})`. It scouts, fans out one extractor plus verifier per lane, builds, reviews and fixes.
- **With the Agent tool:** give each lane agent its sessions, its topics, its output files (`parts/<lane>.py`, `figs/<lane>.py`), the ID rule (only its own topic numbers), and these reference files.
- **Otherwise:** do the lanes one after another yourself.

Only the orchestrator runs `make.sh` and edits `pack.py` or the engine.

## 9. Deliver

1. Commit and push the pack directory: `pack.py`, `parts/`, `figures.py` or `figs/`, `output/`. `work/sources`, `render`, `frames` and `qa` are git-ignored.
2. Send the six PDFs and the six `output/standalone/*.html` with SendUserFile.
3. Report:
   - page counts;
   - what was in scope and what was deliberately left out;
   - sources used and coverage;
   - items flagged as not on the slides;
   - videos consulted (frames and why) or skipped;
   - gaps and conflicts;
   - which past-paper questions matched, and what was never asked.
4. Add any new mistake or finding to `references/lessons.md`. Engine fixes go in the skill, so the next pack benefits.
