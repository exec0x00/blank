"""QA for a built pack. Exit code 1 if any hard check fails.

usage: python3 -I qa.py <pack_dir> [--sheets]

Hard checks: raw LaTeX left in text, broken links (same-doc and cross-doc), forbidden ASR strings
(PACK["asr_forbidden"]) outside the corrections list, missing figure SVGs, PDFs missing / unembedded fonts,
items with no source tag, worked examples with no answer, maths clipped by its box (work/qa/overflow.json,
written by build_pdf.py).
--sheets also renders every PDF page to contact sheets in <pack_dir>/work/qa/ for visual review —
LOOK AT EVERY SHEET: label collisions, overflow, clipped SVGs, half-empty pages, split tables.
"""
import glob, html, importlib.util, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "engine"))
from build import load_pack  # noqa: E402


def main(pack_dir, sheets):
    pack_dir = os.path.abspath(pack_dir)
    out = os.path.join(pack_dir, "output")
    K = load_pack(pack_dir)
    bad = []
    forbidden = K["PACK"].get("asr_forbidden", [])
    htmls = sorted(glob.glob(os.path.join(out, "*.html")))
    ids_by_file = {os.path.basename(f): set(re.findall(r'id="([^"]+)"', open(f).read())) for f in htmls}
    for f in htmls:
        s = open(f).read()
        name = os.path.basename(f)
        txt = re.sub(r'<span class="katex">.*?</annotation></semantics></math></span>', "", s, flags=re.S)
        txt = re.sub(r'<span class="katex-display">', "", txt)
        txt = re.sub(r'<pre class="code">.*?</pre>', "", txt, flags=re.S)
        body = html.unescape(re.sub(r"<[^>]+>", " ", txt))
        main_body = body.split("Known gaps, conflicts and corrections")[0]
        raw = re.findall(r"\\(?:frac|partial|alpha|beta|mathrm|text|left|right)\b|\$", body)
        if raw:
            bad.append(f"{name}: {len(raw)} raw LaTeX fragments, e.g. {raw[:3]}")
        hits = [w for w in forbidden if w.lower() in main_body.lower()]
        if hits:
            bad.append(f"{name}: ASR artefacts {hits}")
        for target in re.findall(r'href="([^"]*#[^"]+)"', s):
            doc, _, anchor = target.partition("#")
            doc = doc or name
            if anchor not in ids_by_file.get(doc, set()):
                bad.append(f"{name}: broken link {target}")
    for g in K["FIGS"]:
        if not os.path.exists(os.path.join(out, "assets", "figures", g["id"] + ".svg")):
            bad.append(f"figure {g['id']} not drawn")
    for key in ("DEFS", "POINTS", "FORMULAS", "WORKED", "FIGS", "FLOWS"):
        for x in K[key]:
            if not x.get("srcs"):
                bad.append(f"{key} item without source: {x.get('id') or x.get('term') or x.get('text', '')[:50]}")
    for w in K["WORKED"]:
        if not w.get("answer"):
            bad.append(f"worked {w['id']} has no answer")
    ov = os.path.join(pack_dir, "work", "qa", "overflow.json")
    if os.path.exists(ov):
        for stem, hits in json.load(open(ov)).items():
            for h in hits:
                bad.append(f"{stem}: maths clipped by {h['over_px']} px in #{h['in']}: {h['tex']} (split it, e.g. \\begin{{gathered}}…\\\\…\\end{{gathered}})")
    meta = json.load(open(os.path.join(out, ".docs.json")))
    for stem, _ in meta["docs"]:
        pdf = os.path.join(out, stem + ".pdf")
        if not os.path.exists(pdf):
            bad.append(f"missing {stem}.pdf"); continue
        pages = re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout).group(1)
        fonts = subprocess.run(["pdffonts", pdf], capture_output=True, text=True).stdout.splitlines()[2:]
        unemb = [l for l in fonts if l.split()[-5] != "yes"]
        print(f"{stem}.pdf: {pages} pages, {len(fonts)} fonts, {len(unemb)} not embedded")
        if unemb:
            bad.append(f"{stem}.pdf has unembedded fonts")
        if sheets:
            qa = os.path.join(pack_dir, "work", "qa"); os.makedirs(qa, exist_ok=True)
            subprocess.run([sys.executable, "-I", os.path.join(HERE, "sheet.py"), os.path.join(qa, stem[:2]), pdf,
                            "--cols", "5", "--rows", "2", "--dpi", "45"], check=True)
    counts = {k: len(K[k]) for k in ("TOPICS", "FORMULAS", "SYMBOLS", "POINTS", "WORKED", "FIGS", "FLOWS", "PYQS", "KEYWORDS", "RAPID")}
    print("counts:", counts)
    if bad:
        print("\nFAILED:"); [print(" -", b) for b in bad]; sys.exit(1)
    print("QA passed")


if __name__ == "__main__":
    main(sys.argv[1], "--sheets" in sys.argv)
