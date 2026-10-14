"""Contact sheets: tile page images so many slides / paper pages / PDF pages can be viewed in one Read.

usage:
  python3 -I sheet.py <out_prefix> <img_or_pdf> [...] [--cols 2] [--rows 4] [--dpi 45] [--pages 1-3] [--pw PASSWORD]
Writes <out_prefix>_0.png, _1.png … Each sheet ≤ ~2000 px wide so the Read tool shows it legibly.

Readability guide (learned): slides at 80 dpi, 2 columns × 4 rows; exam papers at 90 dpi, 2 × 2
(60 dpi is too small to read maths); layout review of a printed PDF at 45 dpi, 5 × 2.
"""
import os, subprocess, sys, tempfile
from PIL import Image


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main():
    a = sys.argv[1:]
    flags_with_vals = {"--cols", "--rows", "--dpi", "--pages", "--pw"}
    pos, i = [], 0
    while i < len(a):
        if a[i] in flags_with_vals:
            i += 2
            continue
        pos.append(a[i]); i += 1
    prefix, files = pos[0], pos[1:]
    cols, rows, dpi = int(arg("--cols", 2)), int(arg("--rows", 4)), arg("--dpi", "45")
    imgs, tmp = [], tempfile.mkdtemp()
    for f in files:
        if f.lower().endswith(".pdf"):
            cmd = ["pdftoppm", "-r", dpi, "-png"]
            if "--pw" in a:
                cmd += ["-upw", arg("--pw", "")]
            if "--pages" in a:
                lo, _, hi = arg("--pages", "1").partition("-")
                cmd += ["-f", lo, "-l", hi or lo]
            stem = os.path.join(tmp, str(len(imgs)) + "_" + os.path.basename(f)[:20])
            subprocess.run(cmd + [f, stem], check=True)
            imgs += sorted(p for p in (os.path.join(tmp, x) for x in os.listdir(tmp)) if p.startswith(stem))
        else:
            imgs.append(f)
    per = cols * rows
    for s in range(0, len(imgs), per):
        ims = [Image.open(p).convert("RGB") for p in imgs[s:s + per]]
        w, h = max(i.size[0] for i in ims), max(i.size[1] for i in ims)
        n = len(ims); r = (n + cols - 1) // cols
        c = Image.new("RGB", (w * min(cols, n), h * r), "#888888")
        for k, im in enumerate(ims):
            c.paste(im, ((k % cols) * w, (k // cols) * h))
        if c.size[0] > 2200:
            c = c.resize((2200, int(c.size[1] * 2200 / c.size[0])))
        out = f"{prefix}_{s // per}.png"
        c.save(out)
        print(out, f"({s + 1}–{s + n} of {len(imgs)})")


if __name__ == "__main__":
    main()
