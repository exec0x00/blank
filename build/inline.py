"""Make single-file copies of the HTML documents: CSS, fonts and figures inlined as data URIs.

usage: python3 -I build/inline.py        (writes output/standalone/*.html)
"""
import base64, glob, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "output")
DEST = os.path.join(OUT, "standalone")
MIME = {".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".svg": "image/svg+xml"}


def data_uri(path):
    with open(path, "rb") as f:
        return f"data:{MIME[os.path.splitext(path)[1]]};base64,{base64.b64encode(f.read()).decode()}"


def inline_css(css_path):
    css = open(css_path).read()
    base = os.path.dirname(css_path)
    if "katex" in css_path:
        # keep only the woff2 source of each KaTeX font to limit size
        css = re.sub(r"src:url\((fonts/[^)]+\.woff2)\) format\(\"woff2\"\)(,url\([^)]+\) format\(\"[^\"]+\"\))*",
                     lambda m: f'src:url({m.group(1)}) format("woff2")', css)
    return re.sub(r"url\(['\"]?([^)'\"]+\.(?:woff2|woff|ttf))['\"]?\)",
                  lambda m: f"url({data_uri(os.path.join(base, m.group(1)))})", css)


def main():
    os.makedirs(DEST, exist_ok=True)
    styles = {}
    for f in sorted(glob.glob(os.path.join(OUT, "*.html"))):
        s = open(f).read()
        def css_link(m):
            p = os.path.join(OUT, m.group(1))
            if p not in styles:
                styles[p] = inline_css(p)
            return f"<style>{styles[p]}</style>"
        s = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css_link, s)
        s = re.sub(r'src="(assets/figures/[^"]+\.svg)"', lambda m: f'src="{data_uri(os.path.join(OUT, m.group(1)))}"', s)
        s = s.replace('href="00_MASTER_geometrical_interpretation.html#', 'href="00_MASTER_geometrical_interpretation.html#')
        out = os.path.join(DEST, os.path.basename(f))
        open(out, "w").write(s)
        print(os.path.basename(out), f"{os.path.getsize(out) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
