"""Print a pack's HTML documents to A4 PDF with Chromium.

usage: python3 -I <skill>/engine/build_pdf.py <pack_dir> [doc-stem ...]

Uses the pre-installed Chromium (never run `playwright install`). Running header = document title
on the left, PACK["header"] on the right; footer = "page X of Y". Header/footer templates cannot use
web fonts, so they use a plain serif.
"""
import glob, json, os, sys
from playwright.sync_api import sync_playwright

EXE = (sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome")) or [None])[-1]
STYLE = ("font-family:Georgia,'Times New Roman',serif;font-size:8px;color:#5f6368;width:100%;"
         "padding:0 16mm;display:flex;justify-content:space-between")


def main(pack_dir, only):
    out = os.path.join(os.path.abspath(pack_dir), "output")
    meta = json.load(open(os.path.join(out, ".docs.json")))
    footer = f'<div style="{STYLE};justify-content:center">page&nbsp;<span class="pageNumber"></span>&nbsp;of&nbsp;<span class="totalPages"></span></div>'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=EXE) if EXE else p.chromium.launch()
        pg = b.new_page()
        for stem, title in meta["docs"]:
            if only and stem not in only:
                continue
            pg.goto(f"file://{out}/{stem}.html", wait_until="networkidle")
            pg.evaluate("document.fonts.ready.then(() => true)")
            pg.wait_for_timeout(200)
            kw = dict(path=f"{out}/{stem}.pdf", format="A4", print_background=True, display_header_footer=True,
                      header_template=f'<div style="{STYLE}"><span>{title}</span><span>{meta["header"]}</span></div>',
                      footer_template=footer, margin={"top": "18mm", "bottom": "18mm", "left": "16mm", "right": "16mm"})
            try:
                pg.pdf(outline=True, tagged=True, **kw)
            except TypeError:          # older Playwright
                pg.pdf(**kw)
            print("printed", stem + ".pdf")
        b.close()


if __name__ == "__main__":
    main(sys.argv[1], set(sys.argv[2:]))
