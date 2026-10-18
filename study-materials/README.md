# PESU all-subject study materials

This branch contains unit masters for all **26 official units** across six subjects and individual lesson files for all **215 video topics** across the five subjects with videos. The Law course has unit reference packs but no videos in the source bucket. Source coverage and the bucket inventory are recorded in `inventory/coverage.md` and `inventory/source-inventory.json`.

## Reading copies

The current reading copies are note-first. Full slide screenshots are not embedded as the lesson. Topic explanations, edited lecture notes, structured definitions, worked examples, and source citations appear in the PDFs and linked HTML where supported by the available source data. Open `deliverables/README.md` for the folder layout; `deliverables/deliverables-index.json` indexes each PDF and HTML file.

The skill build reports mark all generated documents **DRAFT**. Human audio/transcript, formula, source-matching, and page-by-page visual review has not been completed. The source-point archive includes extracted slide text and OCR, which is preserved as source material rather than presented as authored notes.

## Reusable datasets

- `datasets/study-notes-dataset.json` is the structured unit/topic content used by the notes-first PDFs and HTML.
- `datasets/authored-lesson-notes.json` contains the authored lesson explanations added to the Python Unit 1 notes.
- `datasets/source-point-index.json` preserves 4,319 source point records from slides and question files.
- `datasets/lecture-corpus.json` contains transcript blocks and source locators.
- `datasets/content-index.json` contains formula candidates and visual-page locators. The formula candidates have not been independently verified.
- `datasets/question-archive.json` and `datasets/unit-catalogue.json` preserve the question-paper and official-unit indexes.

The files listed above keep source text and media locators available for future study tools. Formula and visual candidates require review before being used as confirmed course content.

## Rebuild and archive

The installed `pdf-study-forge` skill is at `.codex/skills/pdf-study-forge/SKILL.md`. The project scripts are in `scripts/`; generated reports and the per-unit/per-video pack indexes are in `work/`. Local source downloads and rendering caches stay out of Git.

The combined archive is `pesu-allsubjects-notes.zip`. It contains the reading copies, reusable datasets, and note pack JSON files. Source videos are not bundled; their Hugging Face paths and hashes remain in the inventory and pack metadata.
