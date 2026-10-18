# Authoring contract and examples

Use the checked-in examples as executable references. `pack.schema.json` is the full machine-readable schema. Unknown keys are errors: do not invent a property that the engine will silently ignore.

## Files and commands

```text
project/
  pack.json            all teaching content, requirements, evidence and checks
  sources/             local evidence copies (hashes recorded)
  figures/             SVG assets; optional plot specifications
  work/                brief, notes, review record, source renders
  output/              generated PDFs, HTML, assets, reports and page previews
```

The engine reads JSON, never content Python. Build-time numerical assertions accept only whitelisted arithmetic and SymPy functions; no Python `eval` or `parse_expr` is used. Complex user-authored verification programs can be run separately and documented as manual records; that is not automatic proof.

Top-level fields: `schema_version: "1.0"`, `PACK`, `TOPICS`, `EVIDENCE`, `CHECKS`, and the optional content lists below. Missing optional lists mean empty lists, and topic/document requirements may then reject them.

## Metadata and source units

`PACK` needs `course`, `unit`, `scope`, `title`, `slug`, `header`, `date`, `compiled_from`, `how_to_use`, `sources`, `gaps`, `documents`. Slugs are lowercase letters/digits/underscores/hyphens. Use an explicit date from the user's context; do not infer a locale from a path.

`documents` is a selection from `master`, `formulas`, `points`, `figures`, `flows`, `recall`, `questions`. The default study set is the first six. `questions` creates a seventh PDF, with questions first and worked answers later. The master includes every content list and does not rely on opening the smaller PDFs.

A source looks like:

```json
{
  "id": "SRC1",
  "name": "Lecture 3",
  "path": "original bucket path or source URL",
  "local_path": "sources/lecture3.pdf",
  "sha256": "64 lowercase hexadecimal characters from the actual file",
  "kind": "pdf",
  "units": ["p1", "p2", "p3"],
  "use": "Definitions, formulas, figures and worked examples",
  "availability": "available"
}
```

Use `sources.py inventory` for hashes and PDF page enumeration. For PDFs the validator independently checks the complete page list; it cannot be reduced to only the cited pages. Use `excluded` decisions for title pages, duplicate pages and genuinely out-of-scope pages. PPTX sources should be converted into a PDF and accounted for slide by slide. Text/transcript intervals must cover the whole in-scope source; do not cherry-pick a few lines and call it complete.

`availability: "missing"` is permitted only as an honest draft gap. It does not need a fabricated hash. A complete release rejects missing sources.

Each `EVIDENCE` entry connects one source unit to its actual content:

```json
{
  "id": "S3p2",
  "source": "SRC1",
  "unit": "p2",
  "status": "covered",
  "summary": "Read the chain rule definition, two conditions and example 1.",
  "items": ["T1", "E1.1", "W1.1", "N1.1"],
  "reviewed": true
}
```

Those items must cite `S3p2` in `srcs`. Both directions are checked. `excluded` and `gap` decisions require `reason` and an empty `items` list. Log corrected source errors and your resolution in `PACK.gaps`; these narrative correction notes may remain in a released pack. Unresolved coverage gaps are structured `EVIDENCE.status: "gap"` and prevent release. Do not bury unresolved gaps in an innocuous prose note.

## Topics and content IDs

Use unique IDs: T1 topics, D1.1 definitions, E1.1 equations, W1.1 worked examples, G1.1 graphs, F1.1 flows, C1.1 comparisons, H1.1 derivations, Q1.1 practice. Other categories also need IDs. IDs must start with an uppercase letter and contain only letters, numbers, `_`, `-`, `.`. They need not have the suggested prefixes, but must be unique across categories. Evidence IDs must differ from content IDs.

A topic needs `id`, `title`, `overview` (at least 20 useful words), `srcs`, and `requirements`. Requirements have all eight keys:

```json
{
  "DEFS": 2,
  "FORMULAS": 3,
  "WORKED": 4,
  "FIGS": 1,
  "FLOWS": 1,
  "NOTES": 1,
  "DERIVATIONS": {"not_applicable": "The source teaches use of an established formula; no proof is requested."},
  "PRACTICE": 3
}
```

Counts mean minimum required items for that topic, derived from the source/task. A not-applicable declaration must have a real reason and must not conflict with existing items. Every topic needs a recap. If a requested document is inapplicable, use `PACK.not_applicable`, e.g. `{"figures":"This legal-definition source contains no diagrams, timelines or quantitative data."}`. This creates an explicit short applicability statement, not fabricated content.

For several units, `MODULES` is a list of `{id,title,topics}`. Modules must partition all topics exactly once. Do not duplicate a topic in several modules.

## Content list fields

Every item in these lists needs `id`, `topic`, `srcs`. All may have `flags`, `stars` (0–3) and `rank_evidence`. Sources remain required for summaries and revision content too.

| List | Additional fields |
|---|---|
| `DEFS` | `term`, `text` |
| `STATEMENTS` | `text`; quote only actual source wording; add an adjacent correction if the source is wrong |
| `POINTS`, `TRAPS`, `NOTES`, `TOP_FACTS`, `MNEMONICS` | `text` |
| `WHY`, `RAPID` | `q`, `a` |
| `FORMULAS` | `title`, exactly one of `tex`/`code`, `gives`, `when`, `units`; optional `note` |
| `SYMBOLS` | `sym`, `name`, `meaning`, `unit`, `where` (equation IDs or contexts) |
| `WORKED` | `title`, `given`, `method`, `steps` (at least two), `answer`, `units`, `check` |
| `DERIVATIONS` | `title`, `given`, `steps` (at least two), `answer`, `check` |
| `PYQS` | `paper`, `paper_id` (registered source ID), `q`, `marks`, `text`, `worked` (valid WORKED ID) |
| `KEYWORDS` | `term`, `meaning` |
| `FIGS` | `title`, `file` (local SVG), `alt` (plain descriptive text), `howto`; optional `tall` |
| `FLOWS` | `title`, `layout`, `spec`; optional `remark`, `trap`, `maxw` (80–179 mm) |
| `COMPARISONS` | `title`, `head`, `rows` (equal column counts); optional `row_heads` |
| `PRACTICE` | `title`, `kind`, `prompt`, `steps`, `answer`, `check`; optional `marks`, `group` |

`PRACTICE.kind`: `numeric`, `theory`, `true_false`, `spot_error`, `code`, `mock`. In a theory answer explain the reasoning; in spot-the-error identify the exact faulty step and repair it. Mock questions must respect requested marks/timing and cannot claim to be real past papers.

`TOP_FORMULAS` is the exception: it is a list of existing formula IDs. No items are silently truncated. Multiple notes for a topic are all rendered. Merged summaries retain all entries, so edit obvious repetition after a large merge and re-review the result.

Importance stars require `rank_evidence` pointing to real evidence records. Deduplicate papers by file hash and question content, record actual appearances and marks, and explain the sample size in `PACK.pyq_note`. A topic absent from checked papers is not thereby impossible in a future exam. Instructor emphasis and historical frequency should be described separately.

## Formatting

Content strings accept only simple presentation markup: `b`, `strong`, `i`, `em`, `br`, `p`, `ul`, `ol`, `li`, `sup`, `sub`, `code` and same-document `<a href="#ID">` links. Scripts, arbitrary attributes, embedded HTML assets and external links are not content formatting. Keep URLs in source metadata. A prose `<` should be `&lt;` if it could be parsed as markup.

Use JSON escaped backslashes. For example:

```json
{"tex": "\\begin{aligned}z_x&=2xy\\\\z_y&=x^2+\\cos y\\end{aligned}"}
```

Do not put Markdown backticks in prose strings. Use `<code>...</code>` or a `code` formula field. `code` fields are escaped automatically and preserve whitespace, quotes, ampersands and dollars. Prose literal dollars use `&#36;`. All chemistry `\ce{...}` goes inside maths; mhchem is bundled.

## Verification expressions

Each `CHECKS` record needs `id`, `item`, `method`, `note`, `reviewed`. `symbolic` and `numeric` also need `lhs` and `rhs`. Declare all variables in `symbols`. The software checks equality, not whether the typed expression faithfully represents the rendered answer; you must compare those during content review.

```json
{
  "id": "V1",
  "item": "W1.1",
  "method": "symbolic",
  "lhs": "diff(x**2*y+sin(y),x)",
  "rhs": "2*x*y",
  "symbols": {"x":{"real":true}, "y":{"real":true}},
  "note": "Differentiated the original function independently; y is held fixed.",
  "reviewed": true
}
```

Allowed operations: arithmetic `+ - * / **`, parentheses; constants `pi`, `E`, `oo`; functions `sin cos tan asin acos atan exp log sqrt Abs diff integrate simplify factor expand limit Rational`. Symbols may specify `real`, `positive`, `negative`, `nonzero`, `integer`, `nonnegative`. Attribute access, imports, arbitrary calls, subscripting and comprehensions are rejected.

A symbolic result must simplify to zero. A numeric check defaults to `abs(lhs-rhs) <= 1e-10 + 1e-8*abs(rhs)`; set a justified `atol`/`rtol` for rounded source values. Do not use a blanket 1% tolerance for all mathematics. For difficult expressions use explicit independent derivations/manual records; do not turn an inconclusive computer algebra result into a claimed proof.

For manual checks, write what was checked and how in `note`, including units/domain, source locator, reasoning or exact code output. “Verified” alone is not a useful record. Record a source conflict explicitly instead of asserting two contradictory answers are both correct.

## Figures and eight flow layouts

`plot.py spec.json figure.svg` accepts explicit `series` with equal-length `x`, `y`, `label`, optional `style` (`-`, `--`, `:`), optional `marker`, plus `xlabel`, `ylabel`, optional axis limits and annotations. An annotation has `text`, `xy`, `xytext`. See each example's figure JSON. Use at least 10 pt labels at final size; preserve aspect ratio; never communicate a distinction using colour alone. Complex circuits, free-body diagrams or 3-D plots can be authored as local SVGs; validate their geometry against sources and inspect them. The builder does not execute a figures.py module.

A flow node has `kind` (`given`, `step`, `result`, `question`, `check`, `table`) and text in `title`, `sub`, `fx`; steps may have `n`. A table node uses `head` and `rows`. Keep titles short and put equations in `fx` or `sub`.

| Layout | `spec` |
|---|---|
| `straight` | `nodes: [node,...]` |
| `fork` | optional `before`, `question`, `no: node`, `yes: node`, optional `after` |
| `route` | `question`, `rows: [{title,sub?,kw?,dashed?},...]` |
| `streams` | `left: [node,...]`, `right: [node,...]`, `then: [node,...]` |
| `ladder` | `start: node`, `rungs: [{q,yes:node},...]`, `last: node` |
| `tree` | `root: node`, `branches: [{title,sub?,rows:[[label,detail],...]},...]` (2–4 branches) |
| `loop` | optional `before`, `loop: [node,...]`, optional `after`; loop condition exits must match the arrows |
| `verify` | `given: node`, `left: [node,...]`, `right: [node,...]`, `check: node` |

The original visual templates are in `templates/`. Their typography and diagram conventions are retained. Their old workflow or old blanket page-break rules do not override this skill.

For geometric diagrams, use `"aspect": "equal"` in a `plot.py` JSON spec when both axes have the same units and angles/shapes matter. Include domain endpoints unless explicitly excluded. Distinguish a second derivative from geometric curvature: for a graph, curvature magnitude is $|y''|/(1+(y')^2)^{3/2}$. A negative second derivative describes concavity, not negative curvature magnitude.
