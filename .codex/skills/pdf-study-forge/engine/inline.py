"""Single-file HTML copies: CSS, fonts (KaTeX: woff2 only) and figures inlined as data URIs.

usage: python3 -I <skill>/engine/inline.py <pack_dir>     → <pack_dir>/output/standalone/*.html
The plain output/*.html need the assets/ folder next to them; these copies open anywhere.
"""
import base64, glob, os, re, sys

MIME = {".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".svg": "image/svg+xml",
        ".png": "image/png", ".jpg": "image/jpeg"}


def data_uri(path):
    with open(path, "rb") as f:
        return f"data:{MIME[os.path.splitext(path)[1].lower()]};base64,{base64.b64encode(f.read()).decode()}"


def inline_css(css_path):
    css = open(css_path).read()
    base = os.path.dirname(css_path)
    if "katex" in css_path:
        css = re.sub(r'src:url\((fonts/[^)]+\.woff2)\) format\("woff2"\)(,url\([^)]+\) format\("[^"]+"\))*',
                     lambda m: f'src:url({m.group(1)}) format("woff2")', css)
    return re.sub(r"url\(['\"]?([^)'\"]+\.(?:woff2|woff|ttf))['\"]?\)",
                  lambda m: f"url({data_uri(os.path.join(base, m.group(1)))})", css)


def main(pack_dir):
    out = os.path.join(os.path.abspath(pack_dir), "output")
    dest = os.path.join(out, "standalone")
    os.makedirs(dest, exist_ok=True)
    cache = {}
    for f in sorted(glob.glob(os.path.join(out, "*.html"))):
        s = open(f).read()

        def css(m):
            p = os.path.join(out, m.group(1))
            cache.setdefault(p, inline_css(p))
            return f"<style>{cache[p]}</style>"
        s = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, s)
        s = re.sub(r'src="(assets/[^"]+\.(?:svg|png|jpg))"', lambda m: f'src="{data_uri(os.path.join(out, m.group(1)))}"', s)
        if "assets/" in s:
            print("WARNING: unresolved asset reference left in", os.path.basename(f))
        o = os.path.join(dest, os.path.basename(f))
        open(o, "w").write(s)
        print(os.path.basename(o), f"{os.path.getsize(o) / 1e6:.1f} MB")


if __name__ == "__main__":
    main(sys.argv[1])
