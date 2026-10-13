"""Prints output/*.html to PDF with Chromium. Run: python3 build/build_pdf.py"""
import glob, html, os
from playwright.sync_api import sync_playwright

O = "/home/user/blank/output/"
CHROME = next(iter(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome")), None)
TITLES = {"00": "Complete Study Pack", "01": "Formulas & Symbols", "02": "Important Points",
          "03": "Graphs & Diagrams", "04": "Flowcharts & Visuals", "05": "Short Notes & Keywords"}
BAR = "font-family:Helvetica,Arial,sans-serif;font-size:7.5px;color:#5b6470;width:100%;padding:0 16mm;display:flex;justify-content:space-between;align-items:center"


def header(title):
    return (f'<div style="{BAR};padding-top:6mm"><span><b style="color:#1b1f24">{html.escape(title)}</b></span>'
            '<span>Engg. Chemistry · Unit 1</span></div>')


FOOTER = (f'<div style="{BAR};padding-bottom:5mm"><span>UE26CY151A</span>'
          '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"]) if CHROME else p.chromium.launch()
    pg = b.new_page()
    for f in sorted(glob.glob(O + "*.html")):
        num = os.path.basename(f)[:2]
        pg.goto("file://" + f, wait_until="load")
        pg.evaluate("document.fonts.ready.then(() => true)")
        pg.pdf(path=f[:-5] + ".pdf", format="A4", print_background=True, display_header_footer=True,
               header_template=header(TITLES[num]), footer_template=FOOTER,
               margin={"top": "18mm", "bottom": "18mm", "left": "16mm", "right": "16mm"})
        print(os.path.basename(f[:-5]) + ".pdf")
    b.close()
