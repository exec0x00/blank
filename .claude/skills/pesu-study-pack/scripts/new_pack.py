"""Scaffold a new pack directory.

usage: python3 -I new_pack.py <pack_dir> --course "UE26MA141A Engineering Mathematics – I" --unit "Unit 1 · Partial Differentiation" \
         --scope "Class 002 · Geometrical interpretation" --title "Geometrical Interpretation of Partial Derivatives" \
         --slug geometrical_interpretation --header "Engg. Mathematics I · Unit 1 · Class 002"

Creates pack.py (metadata to complete), parts/ (one content file per lane/session), figs/, work/{sources,render,frames,qa}.
"""
import argparse, os

TEMPLATE = '''"""Pack metadata. Content lives in parts/*.py (see references/content-schema.md)."""
PACK = {{
    "course": {course!r},
    "unit": {unit!r},
    "scope": {scope!r},
    "title": {title!r},
    "subtitle": "",
    "slug": {slug!r},
    "header": {header!r},
    "compiled_from": "Compiled from …",
    "how_to_use": "",
    "pyq_note": "",
    "figure_note": "",
    "symbols_remark": "",
    "coverage_note": "",
    "tag_legend": [
        ("S002·7", "Deck 002, slide 7 (rendered .pptx)"),
        ("T002 00:06:10", "AV-summary transcript 002, segment start"),
        ("V002 00:07:45", "Frame grabbed from the class 002 video"),
        ("PDF p.24", "Consolidated slide PDF, page 24"),
        ("CW U1 P2 · ESA Dec-23 1a", "Class-work problem · past-paper question"),
    ],
    "sources": [],          # {{"name", "path", "use"}}
    "gaps": [],             # strings: gaps, conflicts, ASR corrections
    "asr_forbidden": [],    # raw ASR strings that must not survive into the output
    "topic_order": None,    # optional list of topic ids
}}
MODULES = []                # optional [{{"id": "M1", "title": "…", "topics": ["T1", …]}}]
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pack_dir")
    for k in ("course", "unit", "scope", "title", "slug", "header"):
        ap.add_argument("--" + k, default="")
    a = ap.parse_args()
    for d in ("parts", "figs", "work/sources", "work/render", "work/frames", "work/qa", "output"):
        os.makedirs(os.path.join(a.pack_dir, d), exist_ok=True)
    p = os.path.join(a.pack_dir, "pack.py")
    if os.path.exists(p):
        raise SystemExit(f"{p} exists; not overwriting")
    open(p, "w").write(TEMPLATE.format(**vars(a)))
    open(os.path.join(a.pack_dir, ".gitignore"), "w").write("work/sources/\nwork/render/\nwork/frames/\nwork/qa/\n__pycache__/\n")
    print("scaffolded", a.pack_dir)


if __name__ == "__main__":
    main()
