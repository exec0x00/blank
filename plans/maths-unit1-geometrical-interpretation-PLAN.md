# Agent brief: Engineering Mathematics I, Unit 1, Geometrical interpretation of partial derivatives (HTML first, then PDF)

This is the Chemistry Unit 1 brief (`chem-unit1-study-pack-PLAN.md`) adapted to a single maths session. It records how the pack in `output/` was scoped and built.

## 0. The task in one paragraph

Use every source in the Hugging Face bucket `alvin3y10/data` for **UE26MA141A Engineering Mathematics – I, Unit 1, class 002 "Geometrical interpretation of Partial derivatives, Problems on partial derivatives"**:

- the slide deck in all three formats;
- the AV-summary transcript in all four formats;
- the Unit 1 class-work sheet;
- the past ESA papers, Q1 only.

Consult the video only to close a specific gap, using single-frame grabs. Extract every formula, symbol, important point, graph and flowchart. Organise them into five themed documents and one master document. Author each as print-ready HTML, then convert it to PDF. Do not invent content: tag every item with its source and flag anything not on the slides.

## 1. Scope

| In scope | Out of scope |
|---|---|
| Deck 002 (`.pptx` rendered to images, `.slides.md`, `.slides.txt`) | Every other Unit 1 session (total derivative, chain rule, implicit, Euler, Taylor, maxima/minima, Lagrange) |
| Transcript 002 (`.transcript.md/.json/.srt/.txt`) | Units 2–4 |
| Video 002, single frames only | |
| CW sheet `Math 1/CW/Math_Unit1&2_CW` problems on partial differentiation (P1–P8) | CW problems 9 onward |
| ESA papers UE22MA141A (Dec 23, Jul 23, May 24), UE23MA141A (Jan sets 1–4, June 24), Q1 parts on higher-order partials | Q1 parts on other sessions' topics |

Deck 002 covers higher-order partial derivatives (slide 3), so they are in scope. The deck title promises "Problems on partial derivatives", but it has no problem slides. Problems come from the CW sheet and the ESA papers.

## 2. Sources and access

- List: `GET https://huggingface.co/api/buckets/alvin3y10/data/tree/<path>?recursive=true&limit=1000`
- Download: `GET https://huggingface.co/buckets/alvin3y10/data/resolve/<path>`. PDFs under `First_Year_8enterprise/` use the password `8enterprise`.
- Primary base: `pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/`
  - `Slides/002_Geometrical_interpretation_of_Partial_derivatives_Problems_on_partial_derivatives__714d38d7a06bef55.*`
  - `AV_Summaries/002_Geometrical_interpretation_of_Partial_derivatives__374c7bb76e445af3.*` (15.7 min)
- Secondary base: `pesuc/First_Year_8enterprise/Files/Math 1/` (`CW/`, `Papers/ESA Papers/`)

## 3. Known data-quality problems

- **Slide text drops the equations.** In `.slides.md`, slide 7's equations are OCR fragments. Render the `.pptx` (`soffice --headless --convert-to pdf`, then `pdftoppm`) and read them from the images: ∂f/∂x|(x₀,y₀) = d/dx f(x,y₀)|ₓ₌ₓ₀, and the same for y.
- **Slide images are third-party screenshots** (a YouTube source and an interactive demo). Redraw them; do not copy them.
- **ASR errors in the transcript:**

  | Transcript says | Correct reading |
  |---|---|
  | geometally | geometrically |
  | Z1 | z_y |
  | impartial derivatives | in partial derivatives |
  | Claret theorem | Clairaut's theorem |
  | jowl | jolt / jerk |
  | Ultra Am lab | tool not identifiable; described generically |

- **ESA paper headers are inconsistent.** The UE23MA141A papers are headed "JAN 2023", but the print header says Jan 2024.

## 4. Topic map

| ID | Topic | Slides | Transcript |
|---|---|---|---|
| T1 | Higher-order partial derivatives; counting (2ⁿ, mⁿ) | S3 | 00:00–02:13 |
| T2 | One-variable derivative = slope of the tangent | S4 | 02:32–03:32 |
| T3 | z = f(x,y) is a surface; curves over a circle or parabola | S5 | 03:32–04:36 |
| T4 | f_x and f_y as slopes of the tangents parallel to the x- and y-axes | S6–7 | 04:36–08:07 |
| T5 | Other directions: components → gradient | S8 | 08:07–10:11 |
| T6 | f_xx, f_yy concavity; f_xy as a change of slope; demo | S9–10 | 10:11–14:48 |
| T7 | Problems: CW P1, P2, P5; ESA Dec-23 1a; ESA Jan-24 set 4 1c | — | 14:59 |

## 5. Importance

Geometric interpretation was never asked directly in the 8 papers checked, so those items get ESA ★ (conceptual). Higher-order partials were asked twice, 6 marks each, so they get ESA ★★. Every numeric answer was checked with sympy against the CW answer key:

| Problem | Answer |
|---|---|
| CW P1(i) | f_x(−1,1) = −2, f_y(−1,1) = 2 |
| CW P1(ii) | f_x(4,2) = 10e^(−1/2), f_y(4,2) = −4e^(−1/2) |
| ESA Dec-23 1a | f_xxx = e·log(π/2), f_xyy = −4e/π², f_yyy = 16e/π³ |
| ESA Jan-24 1c | n = −3/2 |

## 6. Deliverables

| File | Contents |
|---|---|
| `00_MASTER_geometrical_interpretation` | Every topic in a fixed order: overview, terms, formulas, figures, flowcharts, points, worked examples, past papers, recap; plus a glossary and a source appendix |
| `01_formulas_and_symbols` | 14 formula cards, symbol glossary, notation equivalents |
| `02_important_points` | Definitions, verbatim slide statements, key points, "why" boxes, exam traps, past papers |
| `03_graphs_and_diagrams` | Figures G1–G10, redrawn with matplotlib |
| `04_flowcharts_and_visuals` | Flowcharts F1–F7 and a comparison table |
| `05_short_notes_keywords` | Short notes, keyword index, rapid recall, last-10-minutes page |

## 7. Design

- **Figures** follow `Graph_Style_Guide_v2`:
  - Okabe–Ito colours in a fixed order (blue, vermilion, green, purple, orange);
  - Computer Modern Serif labels;
  - dashed tangents and models, grey dashed references;
  - one figure per row;
  - caption "Figure Gn. title. ESA ★" followed by source tags.
- **Flowcharts** follow `Flowchart_Template_v7`:
  - blocks: Given (grey), Step (numbered), Question (pill with a diamond), Result (black), Remark (dashed), Check (double outline with a tick), Table;
  - layouts: straight line, pick a route, two streams meet, decision ladder, verify both sides, family tree.
- **Text and print:** maths is pre-rendered with KaTeX. Fonts are vendored locally. Pages are A4 with 18/16 mm margins, a running header and "page X of Y".

## 8. Build

```
python3 -I build/figures.py output/assets/figures
python3 -I build/build.py
python3 -I build/build_pdf.py
```
