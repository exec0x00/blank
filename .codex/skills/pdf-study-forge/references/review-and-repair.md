# Review and repair

A build has three separate conclusions: structural/computational checks, visual review, and subject/source fidelity. None substitutes for the other two.

## Read the report

`quality-report.json` contains input and engine hashes, source coverage, check results, PDF page counts, PDF/DOM errors and layout warnings. `dom-report.json` records IDs and links emitted by the actual browser. `output/qa/` has every page at 72 dpi and 2×3 contact sheets. For a dense page, re-render at 144 dpi with the supplied `sources.py render` command or use your PDF/image viewer to zoom; a contact sheet is a layout overview, not enough to inspect a tiny sign.

A sparse-page warning may be justified for a cover, a final page or a deliberate standalone illustration. Explain why each is acceptable or repair it. Never suppress warnings globally. Do not describe a warning as fixed if you only documented it.

## Page-by-page checklist

- Every title, paragraph, equation, proof, worked step, answer and source tag is present.
- Equations have no raw TeX, lost superscripts/subscripts, wrong minus signs, boxes, or mismatched symbols.
- No text/graph crosses page margins, overlaps another element, or hides behind a dark result panel.
- Headings stay with the following content. A short answer/recap should not land alone on a page.
- Short solutions stay intact. Long solutions split between justified steps, with the final answer and check retained.
- Table headers repeat; rows are legible. No wide table is solved by making all text microscopic.
- Figures keep proportions; axis units, legend, direct labels, branch arrows and explanatory captions are readable.
- Print greyscale remains understandable. The colour of a line is not its only label.
- Internal contents links work. Companion PDF links are relative and work when the PDF set is moved together. Some browser PDF viewers restrict opening other local files; the textual target ID and companion filename remain available.
- The PDF contains selectable text and meaningful outlines. Tagged output is enabled, but PDF/UA compliance is not certified.
- Inspect the final page and every long block's final line. Compare the topic/problem/source inventories with what was actually printed.

## Repair recipes

| Failure | Action |
|---|---|
| Schema/unknown property | Correct the JSON property; use the schema/example rather than guessing fields. |
| Unknown/missing ID | Repair the actual target and reciprocal evidence mapping; never hide the link. |
| Missing source hash or changed source | Preserve the correct source copy, recompute its hash, and review affected items. |
| Coverage decision missing | Read that page/interval and map its content, or record an honest scope exclusion/gap. |
| Failed calculation | Re-derive independently, inspect constants/domain and compare intermediate steps. Do not loosen tolerance to hide an error. |
| Unresolved KaTeX | Correct syntax; use mhchem for chemistry. A missing backslash may be an incorrectly escaped JSON string. |
| Long formula | Split into aligned/gathered lines at equals signs or mathematical operations; keep logical steps intact. |
| Text/figure exceeds width | Shorten node titles, put explanation in `sub`, split a table into meaningful tables or redesign the diagram. Do not crop or globally shrink the font. |
| Figure/flow exceeds page height | Break it into labelled panels/subprocedures with explicit continuation; update IDs and evidence. Figures are kept intact and oversized ones fail. |
| Long worked answer | Keep each step below a page; the engine lets an oversized worked block split between steps. Check both pages after rendering. |
| Excessive whitespace | Remove unnecessary hard section breaks, shorten overlarge flow nodes, or regroup the content in teaching order. Never add filler. |
| Unknown glyph | Use supported math notation or a font that supports the actual language; inspect the result. Latin/Greek/math examples are tested; other scripts need suitable fonts and layout validation. |
| Output looks old after failure | Read `last-build-failure.json`. A failed build leaves the previous successful output intact intentionally. It is not the new result. |
| Finalize reports stale hash | Rebuild, inspect changed PDFs, generate a fresh review template and complete it honestly. |

## Review record

`review-template` writes all current PDF hashes and the current warning list. Fill:

- `reviewer`: agent/human identifier, not a claim of outside expert approval.
- `content_review`: source fidelity, complete requested scope, checked calculations and a concrete note about the review.
- `pdfs`: exact filename/hash, explicit list of all pages read, `layout_ok`, and a useful observation.
- `warning_resolutions`: one resolution per exact warning. An accepted intentional layout should say why it is suitable.
- `open_findings`: empty only after every material problem is fixed.

No script can prove you really inspected an image. Do not fabricate the review. Finalization is an integrity gate around your recorded review and the exact artifacts.
