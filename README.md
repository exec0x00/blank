# Study packs

## Engineering Mathematics I · Unit 1 · Geometrical interpretation of partial derivatives

Six documents in `output/`, each as HTML and PDF:

| File | Pages | Contents |
|---|---|---|
| `00_MASTER_geometrical_interpretation` | 37 | Everything, by topic (T1–T7), with glossary and source appendix |
| `01_formulas_and_symbols` | 7 | Formula cards F1–F14, symbol glossary, notation equivalents |
| `02_important_points` | 10 | Definitions, slide statements, key points, why-boxes, exam traps, past papers |
| `03_graphs_and_diagrams` | 11 | Figures G1–G10 (Graph Style Guide v2) |
| `04_flowcharts_and_visuals` | 9 | Flowcharts F1–F7 (Flowchart Template v7) and a comparison table |
| `05_short_notes_keywords` | 6 | Short notes, keyword index, rapid recall, last-10-minutes page |

### Sources

All sources are from the Hugging Face bucket `alvin3y10/data`. Downloads are not committed.

- Deck 002 and transcript 002 of UE26MA141A Unit 1.
- Three frames from video 002.
- The Unit 1 & 2 class-work sheet.
- Eight past ESA papers.

The full list, coverage counts, known gaps and corrected transcript errors are in Appendix B of the master document. The brief is in `plans/maths-unit1-geometrical-interpretation-PLAN.md`.

### Rebuild

```
pip install matplotlib sympy playwright
(cd build && npm install)            # katex
python3 -I build/figures.py output/assets/figures
python3 -I build/build.py
python3 -I build/build_pdf.py
python3 -I build/inline.py          # single-file HTML copies in output/standalone/
```
