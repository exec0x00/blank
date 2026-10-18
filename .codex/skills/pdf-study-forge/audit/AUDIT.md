# Repository audit and replacement decisions

Source: https://github.com/exec0x00/blank/tree/claude/keen-fermat-l52u0o  
Requested branch snapshot: `adc8008e25aed6b6a84175c8add5d219ef91a0ee`  
Audit method: full Git clone, all fetched refs/history, tracked-file inventory, source-code and document review, PDF extraction/rasterization/link inspection, browser checks, then executable replacement and regression tests.

## What was examined

- The requested snapshot has 809 inventoried repository files and 72 PDFs across 12 study-pack output directories, totalling 1,100 pages.
- All fetched refs contain 56 commits and 840 distinct Git blobs. There are 196 distinct PDF versions, totalling 2,670 pages. Identical PDFs at several paths count once in this historical total.
- Every one of those 196 PDFs was parsed, its page text extracted and its pages rendered into overview images. All 72 requested-snapshot standalone HTML documents were browser-audited.
- The `.claude/skills/pesu-study-pack` instructions, source/schema/design/batch references, accumulated lessons, scripts, rendering engine, templates, examples and `.claude/workflows/study-pack.js` were reviewed. Plans, README changes, prior generators and generated artifacts were compared across history. Representative historical page images and extracted text were inspected, including the initial partial chemistry document, later chemistry study guide, 92-page question bank, 27-page explanation, geometry master and later differential-equation pack.
- History and file inventories also contain unrelated SAT-solver work. It was inventoried but is not a PDF feature and was not included in this replacement.

**Limits:** this is complete automated coverage of the committed PDF inventory plus targeted visual/content/code review, not a claim that a person independently checked the mathematics on all 2,670 historical pages. Gitignored lecture inputs, remote Hugging Face bucket contents and private Claude conversations are not all present in Git. The historical notes available in the repository were reviewed; unavailable sessions were not invented. The new examples are original, fully supplied teaching fixtures, not reconstructed university course material.

The audit did not find wholly blank PDF pages or text bounding boxes outside the physical page in its scan. Existing output has substantial useful content and design work. The main failures are completeness, verification and portability, not an assertion that every old PDF is unusable.

## Findings and fixes

Paths in this table are relative to the pinned source snapshot unless a historical commit is named. “Observed” means an artifact or code path was verified; “latent” means a code defect was identified without claiming that it damaged a committed pack.

| Gap | Evidence and effect | Replacement |
|---|---|---|
| “Complete” can precede source review | Historical chemistry README at `973fc69` and `9d7cb19` records a 15-minute first pass, unread transcripts/papers, slides not visually reviewed, missing figures G1–G8 and missing coverage/conflict/derivation work. A later source appendix described source use more broadly than those admissions support. The earliest `ab76e6c` PDF correctly called itself partial. | Source-unit ledger, hashes, explicit gaps, visibly draft mode and release blocked on gaps. Rendering is never counted as reading. |
| Citation totals disguise omissions | `engine/build.py:coverage` counts citations found in emitted content. There is no complete expected source-page inventory to compare with that numerator. | Every PDF page is independently enumerated; every source unit must be covered, explicitly excluded or a gap. Content-to-evidence mapping is reciprocal. Non-PDF completeness still needs author inspection. |
| Many item types escape source QA | `scripts/qa.py` checks sources for DEFS, POINTS, FORMULAS, WORKED, FIGS and FLOWS but skips other types. Five geometry TRAPS have no sources; those omissions propagate into the unit master. | Sources required for all educational item types, including statements, reasons, traps, comparisons, recaps, keywords and summaries. |
| Optional schema permits hollow packs | `references/content-schema.md` makes lists optional; QA does not impose a source-derived teaching contract. A nonempty answer is not an independently checked answer. | Strict JSON schema; per-topic expected counts or explained inapplicability; derivations/practice are first-class; formula/worked/derivation/practice checks are mandatory. |
| Broken delivery links | Observed 144 local HTML launch links across historical PDF versions, 88 in the requested snapshot. Examples point to `/home/user/blank/.../00_MASTER_....html#W7.4`. These cannot locate companion solutions on another machine. | PDF links are rewritten to relative companion PDF destinations and checked after rendering. Viewer support for external-document links can still vary. |
| “Run” is confused with “verified” | Workflow and scripts can finish without a durable, per-page review of the exact delivered bytes. Original workflow text also varies between sampling and full-page inspection. | Fresh staging, automatic QA, rendered pages, explicit REVIEW_REQUIRED state and hash-bound per-page review. Finalization rechecks input, engine, bundled math renderer, sources, figures and artifacts. |
| Environment-specific browser and paths | `engine/build_pdf.py` depends on `/opt/pw-browsers`; earlier builders use `/home/user/blank/output`. Setup uses `set -uo pipefail` and can reach its success message after failures; dependencies are not fully version-pinned. | Browser discovery plus override; bundled assets; pinned primary Python dependencies; setup fails on errors; doctor actually renders a PDF. |
| Special workflow runtime required | `.claude/workflows/study-pack.js` depends on host-specific `Workflow`, `agent`, `pipeline`, `parallel` and `phase` globals. Its behavior is not a portable command-line engine. | One sequential seven-stage SKILL.md and ordinary CLI commands; no proprietary workflow API or agents needed. |
| Executable content increases authoring fragility | Python content modules and raw HTML invite quote errors, accidental execution and math/markup collisions. Historical corrections show repeated syntax and KaTeX repairs. | JSON data only, forbidden extra fields, controlled markup, strict TeX, chemistry extension, literal-dollar rules, escaped code and actionable errors. |
| Multiple notes silently lost (latent) | `engine/build.py:note` takes only the first note for a topic. No actual multi-note topic was found in the requested examples, so this is not reported as observed content loss. | All notes are rendered and regression-tested. |
| Merged projects are not self-contained | `scripts/merge_unit.py` can import figures from sibling Python modules, truncates TOP_FORMULAS to 24, deduplicates symbols without full context and deletes/recreates output subdirectories. | New destination required, all IDs namespaced, sources/figures copied, no summary truncation, original projects preserved. |
| Download/render failures are easy to misread | Flat basename downloads can collide; failures are not consistently reflected in exit status; old render output can survive a failed operation. | Relative paths retained, atomic download writes, hash/length checks, errors exit nonzero, isolated build staging and preserved prior successful output. |
| Scope and exam importance can drift | Original instructions include both adjacent-deck scope expansion and user-only scope. Stars can look authoritative without an enforced evidence record. | User scope wins; exclusions are visible; stars require rank evidence and remain historical labels, never predictions. |
| Visual rules are scattered | About 62 accumulated lessons exist, whereas the README describes 35. Repeated fixes cover split math, OCR errors, clipping, stale source tags and special diagram cases. Five HTML documents produced minor bold-text width candidates; those are not independently confirmed PDF clipping defects. | Retain useful lessons as reference, consolidate prevention in schema/rendering/checklists, and require inspection of all new pages. |
| Empty sections and short answers waste pages | Representative outputs use frequent forced topic/section breaks. New example review also caught empty past-paper pages and per-topic answer-key breaks. | Continuous topic layout, split long solutions safely, keep short blocks, omit empty past-paper section breaks and place question-bank answers in one answer section. |
| Automatic repository publishing exceeds document work | The original skill asks for automatic commit/push as part of completion. | Deliver local files; repository mutation or publishing requires a user request. |

## What was preserved

The replacement retains the useful master-plus-reference-document idea, stable teaching IDs, Computer Modern typography, Okabe–Ito colors, vector plots, source tags, explicit corrections, detailed worked solutions, pre-rendered KaTeX and all eight flowchart layouts: straight, fork, route, streams, ladder, tree, loop and verify. The original flowchart and graph visual templates remain as design references. The new engine is an adaptation, not an assertion that the old work had no value.

## What the new gates do and do not prove

The executable gates reject missing files, missing PDF source pages, unmapped sources, omitted required content, invalid math syntax, many calculation mistakes, overwide content, malformed links, missing glyphs and stale review records. They do not prove that a model chose honest requirements, understood the source, wrote a sound manual proof or really looked at a page merely because it filled a review field. The skill explicitly requires those intellectual tasks and records their results without presenting them as mathematical guarantees.

This package targets English-language academic study documents on A4. It is not a universal publishing system, certified PDF/UA or PDF/A generator, OCR service, or factuality oracle. New subject areas and scripts need source review and visual tests. The installed environment still needs Python, Node and a supported Chromium browser.

## Evidence files

- `repository-files.csv`: requested-snapshot paths, sizes and SHA-256 values.
- `pdf-inventory.csv`: historical PDF Git blob IDs, paths, page counts and automatic findings. `visual_index` refers to development overview sheets, which are not bundled to avoid duplicating the original corpus.
- `git-history.txt`: fetched commit history.
- `pack-data-audit.json`: original pack categories, source omissions and other structural observations.
- `html-audit-summary.txt`: original HTML width candidates; these need visual interpretation.
- `original-lessons.md`: original accumulated lessons, preserved with provenance.
- `TEST-REPORT.md`: tests of the replacement, separate from historical observations.

The full source checkout and all original output versions were used during development. The ZIP contains the replacement skill, runnable examples and audit evidence, rather than an additional copy of the entire original repository.
