# Engineering Chemistry Unit 1 study pack
Rebuild: `python3 build/figures.py && python3 build/build_html.py && python3 build/build_pdf.py` (needs matplotlib, playwright, Chromium).
Outputs: `output/00_MASTER…` and `01`–`05` as .html + .pdf. Sources: PESU Unit_01 slides (12 decks, rendered via LibreOffice, plus .slides.md), transcripts, 137-page Unit-1 PDF (downloaded), in the HF bucket `alvin3y10/data`.

## Known gaps (built under a 15-minute limit)
- Content is written from the slide text + subject knowledge, **not** a full extraction of every source. Transcripts, `.srt/.json`, `ALL_*` aggregates, Extra Topics PDF and ESA papers were **not** read; past-paper tags/weights come from the brief's ranking table, not from the papers.
- Rendered slide images were generated (not visually reviewed); formulas were typed from the brief's list, not compared slide-by-slide.
- No videos consulted. Class 003 video missing (HTTP 401); class 012 has no video.
- Maths is Unicode text, not KaTeX. Fonts are system fallbacks (not self-hosted). Flowcharts are HTML lists, not Mermaid SVG. Figures G1–G8, G11, G12, G14, G16, G18–G20, G26 not drawn.
- Worked examples are computed in `build_html.py` and asserted against the brief's §5.1 table (all pass).
- Not produced: kb.json, conflicts.md, coverage.md, derivation write-ups, Beer-Lambert/Fe–C beyond short flagged notes.
