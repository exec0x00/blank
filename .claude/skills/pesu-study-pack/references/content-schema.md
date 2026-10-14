# Content schema

A pack is a directory:

```
<pack>/pack.py           PACK = {...} metadata, optional MODULES
<pack>/parts/*.py        content lists; any number of files, merged in filename order (one per lane/session)
<pack>/figures.py        and/or <pack>/figs/*.py: FIGURES = {"G4.1": fn(path)}
<pack>/extra.css         optional per-pack CSS appended to study.css
<pack>/work/             sources/, render/, frames/, qa/ (not shipped)
<pack>/output/           built: *.html, *.pdf, standalone/*.html, assets/
```

Every list below is optional and **flat**: items carry a `"topic"` key, so parts written by different lanes merge by concatenation. Text fields are HTML with `$…$` (inline) and `$$…$$` (display) maths, rendered by KaTeX at build time. A literal dollar sign must be written as `&#36;`.

## IDs: topic-scoped, unique, never reused across kinds

| Kind | Pattern | Example |
|---|---|---|
| Topic | `T<n>` (`T3b` allowed) | `T4` |
| Formula (equation) | `E<topic>.<k>` | `E4.2` |
| Graph or diagram | `G<topic>.<k>` | `G4.1` |
| Flowchart | `F<topic>.<k>` | `F4.1` |
| Worked example | `W<topic>.<k>` | `W7.4` |
| Comparison table | `C<topic>.<k>` | `C6.1` |

Lanes working in parallel can never collide, because each owns its topics' numbers. Do not use one letter for two kinds: the first pack used `F` for both formulas and flowcharts, and that was confusing.

## Common fields

- `srcs`: list of source tags. **Required** on everything except notes, keywords and rapid recall; QA fails without them. Tag formats:
  - `S002·7`: deck 002, slide 7 (middle dot ·)
  - `T002 00:06:10`, `T009b 00:13:26`: transcript and part, `hh:mm:ss`
  - `V002 00:07:45`: video frame
  - `PDF p.24`, `Extra p.12`: consolidated PDF page
  - `CW U1 P2`: class-work sheet, unit, problem
  - `ESA Dec-23 1a`, `ESA Jan-24 s4 1c`: past paper
- `flags`: list of strings, one of:
  - `"added for clarity"`: standard context that is not in the material; keep it minimal
  - `"transcript only"`
  - `"video only"`
  - `"not on current slides"`: older PDF or past papers only
- `stars`: 1–3 (ESA weight; see SKILL.md, step 6). Omit for none.

## PACK (in pack.py)

```python
PACK = {
  "course": "UE26MA141A Engineering Mathematics – I", "unit": "Unit 1 · Partial Differentiation",
  "scope": "Class 002 · Geometrical interpretation …",       # or "Unit 1 (classes 001–011)", "Whole subject"
  "title": "…", "subtitle": "…", "slug": "geometrical_interpretation",   # master = 00_MASTER_<slug>
  "header": "Engg. Mathematics I · Unit 1 · Class 002",      # right side of the PDF running header
  "compiled_from": "…", "how_to_use": "…", "pyq_note": "…", "figure_note": "…",
  "symbols_remark": "…", "coverage_note": "…",
  "notation_table": {"title", "head": [...], "rows": [[...]], "row_heads": False},   # optional Part C of doc 01
  "tag_legend": [("S002·7", "Deck 002, slide 7"), …],
  "sources": [{"name", "path", "use"}],                      # Appendix B
  "gaps": ["…"],                                             # gaps, conflicts, ASR corrections (Appendix B)
  "asr_forbidden": ["Ambert", "Glossier", …],                # raw ASR strings QA must not find
  "topic_order": ["T1", "T2", …],                            # optional; default = merge order
  "date": "14 October 2026",                                 # optional override
}
MODULES = [{"id": "M1", "title": "Molecular Spectroscopy", "topics": ["T1", …]}]   # optional: module banners
```

## Content lists (in parts/*.py)

```python
TOPICS     = [{"id": "T4", "title": "…", "overview": "3–4 sentences"}]
DEFS       = [{"topic", "term", "text", "srcs", "flags"}]
STATEMENTS = [{"topic", "text", "srcs"}]                     # verbatim slide wording of laws and principles
POINTS     = [{"topic", "text", "stars", "srcs", "flags"}]
WHY        = [{"topic", "q", "a", "srcs", "flags"}]
TRAPS      = [{"topic", "text", "flags", "srcs"}]
FORMULAS   = [{"id": "E4.1", "topic", "title", "tex": "LaTeX without $$", "gives", "when", "units", "note",
               "stars", "srcs", "flags"}]
SYMBOLS    = [{"sym": "$\\mu$", "name", "meaning", "unit", "where": "E4.1, E4.3"}]   # flag same-letter clashes in meaning
WORKED     = [{"id": "W4.1", "topic", "title", "given", "steps": ["…", …], "answer", "check", "stars", "srcs", "flags"}]
PYQS       = [{"topic", "paper": "ESA Dec 2023", "q": "UE22MA141A Q1.a", "marks": 6, "text", "worked": "W7.4"}]
NOTES      = [{"topic", "text"}]                             # 5–10 line short note per topic (2–3-mark answer)
KEYWORDS   = [{"term", "meaning", "topic"}]
RAPID      = [{"q", "a"}]
MNEMONICS  = ["…"]                                           # few, simple, marked as study aids
TOP_FACTS  = ["…"]                                           # last-10-minutes page
TOP_FORMULAS = ["E1.2", …]
FIGS       = [{"id": "G4.1", "topic", "title", "stars", "srcs", "flags", "howto": "how to read / what to label", "tall": bool}]
COMPARISONS= [{"id": "C6.1", "topic", "title", "head": [...], "rows": [[...]], "srcs", "flags", "row_heads": True}]
FLOWS      = [{"id": "F4.1", "topic", "title", "stars", "srcs", "flags", "layout", "spec", "remark", "trap", "maxw": "150mm"}]
```

Set `"tall": True` for portrait figures such as 3-D surfaces, potential curves and phase diagrams. They print at 118 mm instead of 150 mm, so they share a page with text.

## Flowchart layouts (`layout` and `spec`)

These are the eight layouts of Flowchart_Template_v7, as data. A **node** is a dict:

- `{"kind": "given", "title", "sub", "lab"}`: a grey block (data or starting state)
- `{"kind": "step", "n": 1, "title", "sub", "fx": "$…$"}`: a numbered step with the formula on a grey strip
- `{"kind": "question", "title": "Is …?"}`: a pill with a diamond
- `{"kind": "result", "title", "fx", "sub", "lab": "result", "n"}`: a black block where the flow ends
- `{"kind": "check", "title", "sub"}`: a double outline with a tick
- `{"kind": "table", "head": [...], "rows": [[...]]}`: a table inside a flow

| layout | spec | use for |
|---|---|---|
| `straight` | `{"nodes": [...]}` | a procedure with no choices; derivation steps |
| `fork` | `{"before": [...], "question", "no": node, "yes": node, "after": [...]}` | one question picks the formula, then both rejoin |
| `route` | `{"question", "rows": [{"title", "sub", "kw", "dashed"}]}` | one question, many answers; `kw` is the keyword tag on the right |
| `streams` | `{"left": [...], "right": [...], "then": [...]}` | two inputs computed separately, then combined (most numericals) |
| `ladder` | `{"start": node, "rungs": [{"q", "yes": node}], "last": node}` | ask in order and stop at the first yes |
| `tree` | `{"root": node, "branches": [{"title", "sub", "rows": [[a, b]]}]}` | classify or compare (2–4 branches) |
| `loop` | `{"before": [...], "loop": [... , question], "after": [...]}` | repeat until a condition holds |
| `verify` | `{"given": node, "left": [...], "right": [...], "check": node}` | "verify" / "show that": both sides, then a check |

Keep step titles short: inline maths in a long title wraps badly. Put detail in `sub`. In dark result blocks, use `\tfrac` and put several values on separate lines with `<br>`.

## Figures

`figures.py` or `figs/<lane>.py`:

```python
from figstyle import *          # BLUE VERM GREEN PURPLE ORANGE INK MUTED GUIDE TINT CURVE DASH REF save axes2d axes3d surface plane Arrow3D
import numpy as np
def tangent(path):
    fig, ax = axes2d(7, 4.4)
    ...
    save(fig, path)
FIGURES = {"G2.1": tangent}
```
