"""Prepare the source photos for the video.

Usage: python3 scripts/prepare_photos.py <dir-with-original-photos>

Orients, trims and resizes the seven standalone photos and cuts the five
photos that only exist inside the collage out of it. Results land in
public/photos/ (git-ignored: the photos are personal).
"""
import sys
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "public" / "photos"
OUT.mkdir(parents=True, exist_ok=True)
MAX_SIDE = 1800


def save(im: Image.Image, name: str) -> None:
    im = im.convert("RGB")
    if max(im.size) > MAX_SIDE:
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    im.save(OUT / f"{name}.jpg", quality=92, subsampling=0)
    print(f"{name}.jpg", im.size)


def load(name: str) -> Image.Image:
    return ImageOps.exif_transpose(Image.open(SRC / name))


# --- standalone photos -------------------------------------------------
save(load("28db9365-image.jpg"), "trophy")
# screenshot: trim the dark top line and the stray strip on the right
baby = load("a1d21a0c-image.jpg")
save(baby.crop((0, 6, 1040, 1440)), "baby")
# shot sideways: turn upright
save(load("0cae9d02-image.jpg").transpose(Image.ROTATE_270), "sunglasses")
save(load("5053cefb-image.jpg"), "hats")
save(load("4dd78772-image.jpg"), "hat-closeup")
save(load("4231b740-image.jpg"), "forest")
save(load("df13afcd-image.jpg"), "portrait")

# --- photos that only exist inside the collage ---------------------------
collage = load("379ef1a0-image.jpg")
save(collage, "collage")
CELLS = {
    "tricycle": (0, 560, 399, 1118),
    "nativity": (1200, 560, 1599, 1118),
    "balloon": (400, 1120, 799, 1599),
    "smile": (800, 1120, 1198, 1599),
    "net": (1200, 1120, 1599, 1599),
}
INSET = 14
for name, (x0, y0, x1, y1) in CELLS.items():
    cell = collage.crop((x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET))
    # the cells are small: upscale 2.5x and sharpen gently so they hold up
    w, h = cell.size
    cell = cell.resize((int(w * 2.5), int(h * 2.5)), Image.LANCZOS)
    cell = cell.filter(ImageFilter.UnsharpMask(radius=2.2, percent=70, threshold=2))
    save(cell, name)
