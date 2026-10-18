# Replacement validation report

Package: PDF Study Forge 1.0.0. Results below describe the final code and examples, not the original repository's checks.

## Executed environment

Tested on Linux with Python 3.12.14, Node.js 24.19.0 and system Chromium 154.0.8037.57. A new virtual environment successfully installed the exact primary versions in `requirements.txt`: Playwright 1.62.0, PyMuPDF 1.26.6, Pillow 12.3.0, Matplotlib 3.10.8, NumPy 2.3.5, SymPy 1.14.0 and jsonschema 4.26.0. `doctor` actually generated a PDF and rendered a KaTeX expression.

The code declares Python 3.11+ / Node 18+ support; this run independently verifies only the versions above. macOS, Windows and every browser revision were not separately exercised. Python transitive dependencies and browser binaries are not vendored. The initial package installation used network access; prepared document builds use local assets and abort nonlocal browser requests.

## Regression tests: 34 passed

`python -m unittest discover -s tests -v` passed in both the development environment and a fresh extraction at a different path containing spaces.

The suite covers a valid fixture, source hashes and availability, omitted source units, reciprocal coverage, citation and topic IDs, source path escapes, required worked content, source gaps, missing figures, unknown properties, placeholder content, unsourced traps/ranks, duplicate IDs, ragged tables, unknown symbols, incorrect mathematical assertions, unsafe expression syntax, forbidden HTML, unreviewed checks, formula/code ambiguity, module overlap, all notes being retained, and a merged project that still validates after relocation. The full output is in `unit-tests.log`.

## End-to-end stress test: passed

Run from the extracted package using `tests/integration.py` and an external project directory. Its actual output comprises 28 master pages, 4 points pages and 9 flow/table pages (41 total).

- All eight flowchart layouts rendered and passed automatic QA.
- A worked solution with 48 extra stress-test steps retained its final sentinel after pagination.
- A 45-row table retained its final row. Repeated headers and page breaks were also visually inspected.
- A synthetic past-paper-style link was rewritten to a relative companion-PDF destination. The fixture is explicitly labelled synthetic, not a real examination claim.
- An overwide equation was rejected instead of being silently cropped.
- That failed build preserved the previous successful PDFs.
- Changing an SVG after building blocked finalization, even though the JSON had not changed.
- Changing the content after building blocked finalization.

Two expected warnings identify long blocks that must split. They do not indicate a failed build; the long worked solution and table were inspected across page boundaries. This destructive test intentionally leaves its input JSON invalid at the end, so its output is a test artifact, not a released teaching pack. `integration-result.json` records the results. All nine flow/table pages and representative long-solution pages were visually inspected.

## Included teaching examples: 21 PDFs, 67 pages

| Example | Master | Formulas | Points | Figures | Flows | Recall | Questions | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Calculus | 19 | 4 | 2 | 3 | 3 | 3 | 2 | 36 |
| Chemistry | 7 | 2 | 1 | 1 | 1 | 2 | 2 | 16 |
| Programming | 6 | 2 | 1 | 1 | 1 | 2 | 2 | 15 |

Every final example passed structural, mathematical, DOM, link, font and PDF checks with **zero errors and zero warnings**. All 67 pages were visually inspected through 25 contact sheets; selected equation, geometry, chemistry and code pages were enlarged. The supplied source lessons were read, the calculus derivations and domains checked, the Beer–Lambert numerical result recomputed, and the programming example executed with exact stdout `$12.00\n` verified.

Review found and repaired defects rather than merely accepting the first build: empty past-paper pages, per-topic answer-key breaks, short practice answers separated from their questions, incomplete generic glossaries, second-derivative/curvature terminology, and unequal circle-axis scales. The final circle includes both endpoints and equal geometric scales. A later integrity-gate-only rebuild produced contact sheets byte-identical to all reviewed sheets.

Each example successfully completed `review-template` → documented page/content review → `finalize`; its release and review records accompany the PDFs. Reviews are by the authoring agent, not an outside subject expert. The programming graph document is deliberately a one-page explanation of why a quantitative graph is inapplicable. Question-bank answers start separately so the questions can be attempted first. Small teaching fixtures deliberately include every output type; source-specific production packs should select only the requested/applicable outputs.

`examples/*/sample-output/` contains a compact snapshot of the PDFs, contact sheets and review/quality records. The quality record describes the full build, including regenerated HTML/assets not duplicated into this snapshot. Running `build` creates a fresh complete `output/` tree and requires a new review.

## Archive and relocation checks

- Exactly one `SKILL.md` and one top-level `pdf-study-forge/` folder.
- ZIP CRC checks pass; `MANIFEST.sha256.json` lists hashes of delivered files.
- No virtual environment, node_modules, bytecode, stale failed build, Git checkout or sibling project dependency is required in the archive.
- A fresh extracted copy passed its manifest check, doctor, all 34 regression tests and the integration test above from another working directory.
- Fonts and KaTeX/mhchem are bundled with notices. The engine integrity hash includes its bundled math-renderer directory; release also checks source and figure asset hashes.

## Limits of the evidence

No test proves that an arbitrary model will read sources honestly or produce correct explanations. A structurally valid manual check may still contain bad reasoning, and a source ledger may be dishonestly authored. Numeric equality tests must be compared against the actual printed formula. Those are reasons for the mandatory content and visual review, not grounds for claiming infallibility.

The tests do not certify PDF/UA or PDF/A, all writing systems, all possible SVGs, arbitrary very large courses, or every host's link-opening policy. Local source rendering and download helpers are supplied, but the original remote lecture bucket was not re-downloaded and password-protected/office/video/OCR workflows were not each exercised end to end in this validation. The package documents these capabilities and their prerequisites without counting them as tested successes.
