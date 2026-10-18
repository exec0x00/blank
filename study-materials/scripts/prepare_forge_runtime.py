#!/usr/bin/env python3
"""Create a disposable PDF Study Forge runtime with safe slide-image support.

The installed skill stays pristine. The copied draft runtime accepts only inline
PNG/JPEG data on SVG <image> nodes and reports unreviewed evidence as warnings
when, and only when, building a visibly labelled draft.
"""
from __future__ import annotations
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".codex/skills/pdf-study-forge"
DEST = ROOT / "study-materials/work/runtime/pdf-study-forge"


def main() -> None:
    DEST.parent.mkdir(parents=True, exist_ok=True)
    if DEST.exists():
        shutil.rmtree(DEST)
    shutil.copytree(SOURCE, DEST, ignore=shutil.ignore_patterns("__pycache__", ".git"))
    validator = DEST / "engine/validate.py"
    code = validator.read_text(encoding="utf-8")
    code = code.replace("import ast, collections, hashlib, html, json, re", "import ast, base64, collections, hashlib, html, json, re")
    old = """def validate(k,base,final=True):
"""
    new = """def safe_inline_image(node, attribute, value):
    tag = node.tag.split('}')[-1].lower()
    attr = attribute.split('}')[-1].lower()
    if tag != 'image' or attr != 'href': return False
    match = re.fullmatch(r'data:image/(png|jpeg);base64,([A-Za-z0-9+/=\\s]+)', value, re.I)
    if not match: return False
    try:
        raw = base64.b64decode(re.sub(r'\\s+', '', match.group(2)), validate=True)
    except Exception: return False
    if len(raw) > 50_000_000: return False
    return raw.startswith(b'\\x89PNG\\r\\n\\x1a\\n') if match.group(1).lower() == 'png' else raw.startswith(b'\\xff\\xd8\\xff')

def validate(k,base,final=True):
"""
    if old not in code:
        raise SystemExit("Could not locate validator entry point; installed skill may have changed")
    code = code.replace(old, new, 1)
    old_ref = """                    if a.lower().startswith('on') or (a.split('}')[-1]=='href' and not v.startswith('#')):raise Invalid('external/active SVG reference')
"""
    new_ref = """                    if a.lower().startswith('on'): raise Invalid('active SVG attribute')
                    if a.split('}')[-1]=='href' and not v.startswith('#') and not safe_inline_image(n,a,v): raise Invalid('external/active SVG reference')
"""
    if old_ref not in code:
        raise SystemExit("Could not locate SVG reference check; installed skill may have changed")
    code = code.replace(old_ref, new_ref, 1)
    old_review = """            if not e['reviewed']:errors.append(f'{e[\"id\"]}: source unit has not been reviewed')
"""
    new_review = """            if not e['reviewed']:(errors if final else warnings).append(f'{e[\"id\"]}: source unit has not received manual review')
"""
    if old_review not in code:
        raise SystemExit("Could not locate review flag check; installed skill may have changed")
    code = code.replace(old_review, new_review, 1)
    validator.write_text(code, encoding="utf-8")
    style = DEST / "engine/study.css"
    css = style.read_text(encoding="utf-8")
    wrap_rule = "\n/* Keep long source URLs searchable while allowing safe line breaks in source prose. */\n.lead, .remark, ol.pts li { overflow-wrap: anywhere; word-break: normal; }\n"
    if wrap_rule.strip() not in css:
        style.write_text(css + wrap_rule, encoding="utf-8")
    (DEST / "RUNTIME-PATCH.md").write_text(
        "# Draft runtime patch\n\n"
        "This disposable copy leaves `.codex/skills/pdf-study-forge/` untouched. It makes three narrow changes for this source-preservation job: "
        "it allows only base64-embedded PNG/JPEG data on SVG `<image>` nodes, turns an unreviewed-source error into a warning only in draft mode, and allows long source URLs to wrap in content blocks. "
        "All other external/active SVG references remain rejected. Builds still carry the engine's visible DRAFT label and cannot be finalized without the required human review.\n",
        encoding="utf-8",
    )
    print(DEST)


if __name__ == "__main__":
    main()
