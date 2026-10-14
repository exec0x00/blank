"""Print the six HTML documents to PDF with Chromium (Playwright).

usage: python3 -I build/build_pdf.py [doc-stem ...]     (default: all six)
"""
import glob, os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "output")
DOCS = {
    "00_MASTER_geometrical_interpretation": "Master: Geometrical interpretation of partial derivatives",
    "01_formulas_and_symbols": "Formulas and symbols",
    "02_important_points": "Important points",
    "03_graphs_and_diagrams": "Graphs and diagrams",
    "04_flowcharts_and_visuals": "Flowcharts and visuals",
    "05_short_notes_keywords": "Short notes and keywords",
}
EXE = (glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome") or [None])[0]
STYLE = "font-family:Georgia,'Times New Roman',serif;font-size:8px;color:#5f6368;width:100%;padding:0 16mm;display:flex;justify-content:space-between"


def header(title):
    return f'<div style="{STYLE}"><span>{title}</span><span>Engg. Mathematics I · Unit 1 · Class 002</span></div>'


FOOTER = (f'<div style="{STYLE};justify-content:center">page&nbsp;<span class="pageNumber"></span>&nbsp;of&nbsp;'
          '<span class="totalPages"></span></div>')


def main(stems):
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=EXE) if EXE else p.chromium.launch()
        pg = b.new_page()
        for d in stems:
            pg.goto(f"file://{OUT}/{d}.html", wait_until="networkidle")
            pg.evaluate("document.fonts.ready.then(() => true)")
            pg.wait_for_timeout(200)
            pg.pdf(path=f"{OUT}/{d}.pdf", format="A4", print_background=True, display_header_footer=True,
                   header_template=header(DOCS[d]), footer_template=FOOTER,
                   margin={"top": "18mm", "bottom": "18mm", "left": "16mm", "right": "16mm"},
                   outline=True, tagged=True)
            print("printed", d + ".pdf")
        b.close()


if __name__ == "__main__":
    main(sys.argv[1:] or list(DOCS))
