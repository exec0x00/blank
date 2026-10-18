#!/usr/bin/env python3
"""Render every available course slide source and export page-faithful SVGs."""
from __future__ import annotations
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess
import sys

import fitz

ROOT = pathlib.Path(__file__).resolve().parents[2]
CORPUS = ROOT / "study-materials/datasets/lecture-corpus.json"
SRC = ROOT / "study-materials/sources"
WORK = ROOT / "study-materials/work"
FORGE = ROOT / ".codex/skills/pdf-study-forge/scripts/sources.py"


def sha(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def local_path(remote: str) -> pathlib.Path:
    return SRC.joinpath(*pathlib.PurePosixPath(remote).parts[1:])


def export_one(record: dict) -> dict:
    source = local_path(record["deck_path"])
    key = hashlib.sha256(record["deck_path"].encode()).hexdigest()[:14]
    out = WORK / "rendered" / "decks" / key
    report = out / "render-report.json"
    converted = source if source.suffix.lower() == ".pdf" else out / (source.stem + ".pdf")
    if not (report.is_file() and converted.is_file()):
        out.mkdir(parents=True, exist_ok=True)
        cmd = [sys.executable, str(FORGE), "render", str(source), "--out", str(out), "--dpi", "120"]
        p = subprocess.run(cmd, text=True, capture_output=True, timeout=900)
        if p.returncode:
            return {"source": record["deck_path"], "status": "error", "detail": (p.stderr or p.stdout)[-3000:]}
    try:
        rep = json.loads(report.read_text(encoding="utf-8"))
        with fitz.open(converted) as doc:
            svgdir = WORK / "slide-svg" / key
            svgdir.mkdir(parents=True, exist_ok=True)
            pages = []
            for n, page in enumerate(doc, 1):
                svg = page.get_svg_image(text_as_path=True)
                target = svgdir / f"page-{n:04d}.svg"
                target.write_text(svg, encoding="utf-8")
                pages.append({"page": n, "svg": str(target.relative_to(ROOT)), "sha256": sha(target)})
        return {
            "source": record["deck_path"],
            "source_sha256": sha(source),
            "source_bytes": source.stat().st_size,
            "converted_pdf": str(converted.relative_to(ROOT)),
            "converted_pdf_sha256": sha(converted),
            "page_count": len(pages),
            "sparse_pages": rep.get("image_or_sparse_pages", []),
            "pages": pages,
            "status": "ok",
        }
    except Exception as e:
        return {"source": record["deck_path"], "status": "error", "detail": f"{type(e).__name__}: {e}"}


def main() -> None:
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    unique = {}
    for course in corpus["courses"]:
        for unit in course["units"]:
            for deck in unit["slide_decks"]:
                remote = deck.get("deck_path")
                if remote:
                    unique[remote] = {"deck_path": remote}
    records = sorted(unique.values(), key=lambda x: x["deck_path"])
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(export_one, x): x for x in records}
        for i, f in enumerate(concurrent.futures.as_completed(futures), 1):
            result = f.result()
            results.append(result)
            print(f"[{i}/{len(records)}] {result['status']}: {result['source']}", flush=True)
    results.sort(key=lambda x: x["source"])
    manifest = {
        "schema_version": "1.0",
        "source_count": len(records),
        "success_count": sum(x["status"] == "ok" for x in results),
        "error_count": sum(x["status"] != "ok" for x in results),
        "page_count": sum(x.get("page_count", 0) for x in results),
        "sources": results,
    }
    dest = WORK / "slide-render-manifest.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Rendered {manifest['success_count']}/{len(records)} sources; {manifest['page_count']} pages; manifest {dest}")
    if manifest["error_count"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
