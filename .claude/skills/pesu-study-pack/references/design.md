# Design system

The user's two templates are the source of truth. Both are copied in `references/templates/` (`.dc.html`, readable as HTML). The engine already implements them in `engine/study.css`, `engine/lib.py` and `engine/figstyle.py`. Read this file before changing any visual, and change the engine, never one pack.

## Page (all six documents)

- **Paper.** White, A4 portrait. Playwright margins are 18 mm top and bottom, 16 mm left and right.
- **Running header and footer.** The header has the document title on the left and `PACK["header"]` on the right, at 8 px. The footer reads "page X of Y". Header and footer templates cannot load web fonts, so they use Georgia/serif.
- **Type.** Computer Modern Serif everywhere, using the vendored woff files.
  - Body 11 pt with line-height 1.5.
  - H1 24 pt; the cover title 32 pt.
  - H2 17 pt with a 1 px ink rule under it: "number + title" in a flex with a 14 px gap, like the template's section headers.
  - H4 small caps in grey for sub-sections.
- **Ink.**

  | Token | Value | Used for |
  |---|---|---|
  | `--ink` | #111111 | Text and outlines |
  | Body text | #333333 | Body text |
  | Muted | #444444 / #555555 / #5f6368 | Secondary text and notes |
  | Borders | #888888 | Block borders |
  | Rules | #dddddd | Table and divider rules |
  | Given fill | #ededed | Given blocks |
  | Formula strip | #efefef | Grey strip under formulas |
  | Dark | #111111 / #333333 | Result blocks and their formula strips |

- **Pagination.** Each topic starts on a new page. Cards, figures, flowcharts and worked examples use `break-inside: avoid`. Tables repeat their header row; tables with ≤ 8 rows never split.
- **Modules.** A module banner (`MODULES`) starts a page with a large title.

## Blocks (Flowchart_Template_v7, section 1)

| Block | Look | Meaning |
|---|---|---|
| Given | #ededed fill, 1.5 px ink border, 14 px radius, small-caps "given" label | data from the question or the starting state |
| Step | white, 1 px #888 border, a 24 px numbered circle, a grey formula strip | one action or calculation |
| Question | white pill, 2 px ink border, a black diamond, italic text; exits labelled with **yes** (black) / **no** (outlined) pills | a decision |
| Result | solid #111, white text, a #333 formula strip | where the flow ends; the first thing the eye sees |
| Remark | 1.5 px dashed #555 border; *Remark.* / *Exam trap.* / *How to read it.* in bold italic | unit checks, traps, source notes; always off the main path |
| Check | 3 px double border, a black tick circle | substitute back, compare both sides |
| Table | 1 px #888 border, grey header row | comparisons inside a flow |
| Figure label | "**Figure F4.1.** Title. ESA ★★★", then flag chips (small caps, outlined pill) and grey source tags | caption under every flowchart and graph |

Arrows are 2 px #444 shafts with 6×8 px triangle heads. The main path is solid, an optional route is dashed, and a loop-back is a rounded bracket on the right.

## Layouts (Flowchart_Template_v7, section 2)

The engine supports: straight line, fork and rejoin, pick a route, two streams meet, decision ladder, family tree, repeat until, verify both sides. The template's "Used in …" notes say which kind of content each suits; see the table in `content-schema.md`.

## Content cards (same visual language)

- **Formula card.** White, #888 border, radius 14. The title is "E4.1 · name" with ESA stars on the right. The display equation sits centred on a grey strip. Below it, a grid of small-caps labels: gives · applies · units · note. Then flags and sources.
- **Definition.** The term in bold small caps, then the text.
- **Statement.** A 3 px ink left border, italic, on a #fafafa background, used for the verbatim slide wording of a law.
- **Why.** A #ededed rounded box with the question in bold.
- **Exam trap.** A dashed box.
- **Worked example.** A grey header (`W7.4 · title`, stars), then rows for given / step n / answer / check. The answer sits in a 1.5 px outlined box.
- **Past-paper question.** A black paper pill, an outlined marks pill, then the question, with a link to the worked solution in the master.
- **Recap.** A black box at the end of every topic in the master.

## Graphs (Graph_Style_Guide_v2)

- **Colour.** Okabe–Ito, always in this order:

  | Colour | Hex | Role |
  |---|---|---|
  | Blue | #0072B2 | Series 1: main curve, ground state, absorption |
  | Vermilion | #D55E00 | Series 2: comparison, excited state, emission, forces, tangent |
  | Green | #009E73 | Series 3: fundamental, "active", second trace |
  | Purple | #A0557F | Series 4: electronic transitions, other directions |
  | Orange | #E69F00 | Highlights: beams, the vertical Franck–Condon arrow |

  Tints are the series colour at about 10 % (#E4F0F8 for blue), used as fills for surfaces, regions, atoms and lobes.
- **Lines.**
  - Data curve: 2.4–2.6 px solid.
  - Model or approximation (harmonic, excited state, tangent): dashed.
  - Limit or reference (dissociation limit, 1 atm, x = x₀): grey #5f6368 dashed.
  - Guide: #d5d8dd, 1 px.
  - Axes and text: #1a1a1a.
- **Never rely on colour alone.** Every series gets a direct label in its own colour, and models are dashed.
- **Type.** Computer Modern for every label. Variables are italic and units upright. Draw on a 7-inch canvas with 12–14 pt labels. Keep at least 16 units between labels; move a label and add a thin leader line rather than overlap.
- **Layout.**
  - One figure per row, at full width (150 mm, or 118 mm for tall figures). Never shrink a figure to sit beside another.
  - Keep each figure's proportions.
  - Left and bottom axes only, ticks outward.
  - Stack multi-panel figures vertically.
- **No data inside the graphic.** Tables and remarks are not drawn inside the graphic: use a Remark block (the engine's "How to read it.") and Table blocks under the figure.
- **Caption.** "Figure G4.1. Title. ESA ★★", then flags and source tags.
- **Restyling a source figure.** Keep all the data (every curve, point, axis range, label and annotation). Only colour, line weight, spacing and type change.
- **Phase diagrams and other schematics.** Say "schematic, not to scale" in the caption and label the real values.
- **Never paste slide screenshots.** They carry third-party watermarks, logos and video credits. Redraw them.

## Output files

- `00_MASTER_<slug>`: all topics. Each topic follows a fixed order: overview, key terms, formulas, figures, flowcharts, comparisons, points/why/traps, worked examples, past-paper questions, recap. Then Appendix A (symbols) and Appendix B (sources, gaps, coverage).
- `01_formulas_and_symbols`: formula cards by topic, the symbol glossary, and an optional notation or conversion table.
- `02_important_points`: definitions, statements, points, why, traps, and all past-paper questions.
- `03_graphs_and_diagrams`: every figure with a "How to read it" remark.
- `04_flowcharts_and_visuals`: every flowchart and comparison table.
- `05_short_notes_keywords`: notes, keyword index, rapid recall, mnemonics, last-10-minutes page.
- `standalone/*.html`: single-file copies (assets inlined). Send these when the user wants HTML.
