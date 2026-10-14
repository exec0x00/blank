"""Tile every figure SVG of a pack into PNG contact sheets so they can be Read and checked.

usage: python3 -I preview_figs.py <pack_dir> [--cols 3]      → <pack_dir>/work/qa/figs_<n>.png
Look for: label collisions, labels off-canvas, bunched 3-D tangents, unreadable ticks, boxes instead of minus signs.
"""
import glob, os, re, sys
from playwright.sync_api import sync_playwright

EXE = (sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome")) or [None])[-1]


def key(p):
    return [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", os.path.basename(p))]


def main(pack, cols):
    figs = sorted(glob.glob(os.path.join(pack, "output", "assets", "figures", "*.svg")), key=key)
    qa = os.path.join(pack, "work", "qa"); os.makedirs(qa, exist_ok=True)
    per = cols * 3
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=EXE) if EXE else p.chromium.launch()
        pg = b.new_page(viewport={"width": 1500, "height": 900})
        for s in range(0, len(figs), per):
            cells = "".join(f'<div><b>{os.path.basename(f)[:-4]}</b><img src="file://{os.path.abspath(f)}" style="width:100%"></div>' for f in figs[s:s + per])
            tmp = os.path.join(qa, "_figs.html")   # file:// images only load from a file:// page, not set_content()
            open(tmp, "w").write(f'<body style="margin:0;font:14px sans-serif;display:grid;grid-template-columns:repeat({cols},1fr);gap:8px">{cells}</body>')
            pg.goto("file://" + tmp)
            pg.wait_for_timeout(300)
            out = os.path.join(qa, f"figs_{s // per}.png")
            pg.screenshot(path=out, full_page=True)
            print(out)
        b.close()


if __name__ == "__main__":
    main(os.path.abspath(sys.argv[1]), int(sys.argv[sys.argv.index("--cols") + 1]) if "--cols" in sys.argv else 3)
