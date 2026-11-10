"""Tile stills into one contact sheet: sheet.py <out.jpg> <cols> <img...>"""
import sys
from PIL import Image
out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f) for f in files]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (w + 8), rows * (h + 8)), "#444")
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * (w + 8) + 4, (i // cols) * (h + 8) + 4))
sheet.save(out, quality=88)
