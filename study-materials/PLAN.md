# All subjects study pack — project contract

## Request
Create searchable, print-ready HTML and PDF study materials from all video lessons and their supporting course materials in `https://huggingface.co/buckets/alvin3y10/data/tree/pesuc`. Organize by subject, unit, lesson topic, and subtopic. Include the information needed to study and later reuse the content: key points, visualizations/diagrams, formulas and symbols, concise notes, questions, and structured source datasets. Produce a combined ZIP. Publish all work on GitHub branch `allsubjects` and commit useful checkpoints as the work progresses.

## Source scope
- All 215 MP4 lectures in `PESU_Materials` (five current subjects, 21.39 GiB full bucket inventory; videos total 19.26 GiB).
- Their transcript JSON, Markdown, SRT, and plain text sidecars, with text variants compared and authoritative timestamps retained.
- Every slide deck and its extracted slide text in the current course folders.
- Course metadata, syllabus/summary files, and in-scope question papers needed to classify and enrich topics.
- All six current courses and all 26 official units listed by the bucket's `units.json` catalogue. Five courses have videos; the Constitutional Law course has no MP4 files.
- The bucket contains folders for 20 of the 26 official units. The six catalogue-only units receive clearly labelled source-gap/reference packs, with matching historical question sources included where available.
- The older `First_Year_8enterprise` archive has 502 files and no videos. Include its question papers, answer keys, question banks, and relevant Chemistry and Math 1 extra materials where their subject maps to a current course; unrelated archive subjects remain inventoried and excluded. Keep ambiguous unit mappings as course-level references rather than guessing.

## Deliverables
- A complete source inventory and per-video transcript coverage manifest.
- Structured JSON dataset(s) organized by course, unit, video, transcript segment, slide, formula, diagram, and question-paper source where evidence supports it.
- One complete master HTML and searchable PDF for each of the 26 official course units. Each unit master contains all available videos, subtopics, notes, formulas, figures, question evidence, and transcript-derived detail; units without current source folders are labelled with their source gaps.
- A final ZIP of all generated HTML, PDFs, datasets, build instructions, provenance and QA reports.
- Reproducible scripts and skill installation under `.codex/skills/pdf-study-forge/`.

## Quality and provenance
- Use PDF Study Forge for authoring and PDF/HTML production. Every educational assertion must link to a source file and locator; distinguish extracted source wording from editorial normalization.
- Preserve formulas/diagrams from slide evidence; resolve any text/video/slide contradictions explicitly.
- Report unavailable sources, missing transcript variants, unreadable slide pages, and limits on video visual review honestly.
- Validate schemas, links, source hashes, output PDFs and page previews before release. Do not report a source as reviewed just because it was downloaded or rendered.

## Working assumptions
- Group outputs by course and unit rather than generating one PDF per raw MP4; each lesson remains individually indexed and searchable within its unit output and dataset. Complete and publish a unit master as soon as that unit is finished.
- Keep the original 19.26 GiB video files hosted at Hugging Face rather than copying them into GitHub. Retain their bucket paths, sizes, hashes and transcript links in the source manifests.
- Publish incremental commits on `allsubjects` so the inventory, source processing, and generated outputs remain recoverable.
