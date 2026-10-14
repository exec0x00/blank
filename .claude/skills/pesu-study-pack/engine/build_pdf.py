"""Print a pack's HTML documents to A4 PDF with Chromium.

usage: python3 -I <skill>/engine/build_pdf.py <pack_dir> [doc-stem ...]

Uses the pre-installed Chromium (never run `playwright install`). Running header = document title
on the left, PACK["header"] on the right; footer = "page X of Y". Header/footer templates cannot use
web fonts, so they use a plain serif.

Before printing, the ink of every KaTeX box is checked against its nearest non-inline ancestor at the
printed page width (cards do not clip: wide maths simply runs off the page); clipped maths is written to <pack>/work/qa/overflow.json, which qa.py fails on.
"""
import glob, json, os, sys
from playwright.sync_api import sync_playwright

EXE = (sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome")) or [None])[-1]
CLIP_JS = """() => {
  const bad = [];
  for (const el of document.querySelectorAll('.katex')) {
    const html = el.querySelector('.katex-html') || el;
    const rg = document.createRange(); rg.selectNodeContents(html);
    const r = rg.getBoundingClientRect();     // the ink, not the (container-wide) display box
    if (!r.width) continue;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.classList.contains('katex') || a.classList.contains('katex-display')) continue;
      const d = getComputedStyle(a).display;
      if (d === 'inline' || d === 'contents') continue;
      const q = a.getBoundingClientRect();        // nearest box: card strip, table cell, flow node …
      if (r.right > q.right + 1 || r.left < q.left - 1) {
        const t = el.querySelector('annotation');
        const box = el.closest('[id]');
        bad.push({in: box ? box.id : '', tex: (t ? t.textContent : el.textContent).slice(0, 80),
                  over_px: Math.round(Math.max(r.right - q.right, q.left - r.left))});
      }
      break;
    }
  }
  return bad;
}"""
STYLE = ("font-family:Georgia,'Times New Roman',serif;font-size:8px;color:#5f6368;width:100%;"
         "padding:0 16mm;display:flex;justify-content:space-between")


def main(pack_dir, only):
    out = os.path.join(os.path.abspath(pack_dir), "output")
    meta = json.load(open(os.path.join(out, ".docs.json")))
    footer = f'<div style="{STYLE};justify-content:center">page&nbsp;<span class="pageNumber"></span>&nbsp;of&nbsp;<span class="totalPages"></span></div>'
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=EXE) if EXE else p.chromium.launch()
        pg = b.new_page(viewport={"width": 673, "height": 1000})   # A4 minus 16 mm margins, at 96 dpi
        pg.emulate_media(media="print")
        clipped = {}
        for stem, title in meta["docs"]:
            if only and stem not in only:
                continue
            pg.goto(f"file://{out}/{stem}.html", wait_until="networkidle")
            pg.evaluate("document.fonts.ready.then(() => true)")
            pg.wait_for_timeout(200)
            hits = pg.evaluate(CLIP_JS)
            if hits:
                clipped[stem] = hits
                for h in hits[:5]:
                    print(f"  CLIPPED maths in {stem} #{h['in']}: {h['over_px']} px over: {h['tex']}")
            kw = dict(path=f"{out}/{stem}.pdf", format="A4", print_background=True, display_header_footer=True,
                      header_template=f'<div style="{STYLE}"><span>{title}</span><span>{meta["header"]}</span></div>',
                      footer_template=footer, margin={"top": "18mm", "bottom": "18mm", "left": "16mm", "right": "16mm"})
            try:
                pg.pdf(outline=True, tagged=True, **kw)
            except TypeError:          # older Playwright
                pg.pdf(**kw)
            print("printed", stem + ".pdf")
        b.close()
    qa = os.path.join(os.path.abspath(pack_dir), "work", "qa"); os.makedirs(qa, exist_ok=True)
    if not only:
        json.dump(clipped, open(os.path.join(qa, "overflow.json"), "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1], set(sys.argv[2:]))
