#!/usr/bin/env python3
"""Collect Forge unit and per-video documents in a reviewable release folder."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "study-materials"
DEST = STUDY / "deliverables"
MAX_GITHUB_BLOB = 95_000_000  # keep headroom below GitHub's 100 MB file limit


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def asset_inventory(path: Path) -> tuple[int, int, str]:
    h = hashlib.sha256()
    count = total = 0
    if path.is_dir():
        for file in sorted(p for p in path.rglob("*") if p.is_file()):
            rel = file.relative_to(path).as_posix()
            size = file.stat().st_size
            count += 1
            total += size
            h.update(rel.encode("utf-8"))
            h.update(b"\0")
            h.update(bytes.fromhex(sha256_file(file)))
    return count, total, h.hexdigest()


def copy_assets(source: Path, target: Path) -> tuple[int, int, str]:
    if target.exists():
        shutil.rmtree(target)
    if source.is_dir():
        shutil.copytree(source, target)
    else:
        target.mkdir(parents=True, exist_ok=True)
    return asset_inventory(target)


def copy_pdf(source: Path, target: Path) -> tuple[str, bool]:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    shutil.copy2(source, target)
    return sha256_file(target), False


def load_build_records() -> dict[str, dict]:
    p = STUDY / "work" / "forge-build-report.json"
    if not p.exists():
        return {}
    try:
        report = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {record.get("project", ""): record for record in report.get("results", [])}


def deliver_one(pack_dir: Path, family: str, build_records: dict[str, dict]) -> dict:
    data = json.loads((pack_dir / "pack.json").read_text(encoding="utf-8"))
    pack = data.get("PACK", {})
    course = pack_dir.parent.name if family == "unit" else pack_dir.parent.parent.name
    unit = pack_dir.name if family == "unit" else pack_dir.parent.name
    slug = pack.get("slug") or pack_dir.name
    output = pack_dir / "output"
    html_sources = sorted(output.glob("*.html"))
    pdf_sources = sorted(output.glob("*.pdf"))
    if len(html_sources) != 1 or len(pdf_sources) != 1:
        raise RuntimeError(f"Expected one PDF and one linked HTML in {output}; found {len(pdf_sources)} PDF and {len(html_sources)} HTML")
    destination = DEST / course / unit
    if family == "unit":
        destination /= "master"
        label = pack.get("title") or unit
    else:
        destination /= "videos" / slug
        label = pack.get("title") or slug
    destination.mkdir(parents=True, exist_ok=True)
    html_target = destination / "index.html"
    pdf_target = destination / ("unit-master.pdf" if family == "unit" else "lesson.pdf")
    shutil.copy2(html_sources[0], html_target)
    asset_count, asset_bytes, asset_hash = copy_assets(output / "assets", destination / "assets")
    pdf_hash, pdf_optimized = copy_pdf(pdf_sources[0], pdf_target)
    relative = destination.relative_to(STUDY).as_posix()
    record = build_records.get(pack_dir.relative_to(ROOT).as_posix(), {})
    return {
        "family": family,
        "course_code": course,
        "course_title": pack.get("course", ""),
        "unit_id": unit,
        "document_title": label,
        "lesson_header": pack.get("header") if family == "video" else None,
        "status": record.get("status", "DRAFT"),
        "draft": True,
        "page_count": record.get("pages"),
        "html": f"{relative}/index.html",
        "html_sha256": sha256_file(html_target),
        "pdf": f"{relative}/{pdf_target.name}",
        "pdf_sha256": pdf_hash,
        "pdf_bytes": pdf_target.stat().st_size,
        "pdf_optimized_for_size": pdf_optimized,
        "pdf_requires_lfs": pdf_target.stat().st_size >= MAX_GITHUB_BLOB,
        "assets_directory": f"{relative}/assets/",
        "asset_count": asset_count,
        "asset_bytes": asset_bytes,
        "assets_sha256": asset_hash,
        "pack_source": pack_dir.relative_to(ROOT).as_posix(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean", action="store_true", help="remove and rebuild the deliverables folder")
    parser.add_argument("--family", choices=("all", "unit", "video"), default="all",
                        help="publish only completed unit masters or video lessons")
    parser.add_argument("--course", help="limit this incremental publication to one course code")
    args = parser.parse_args()
    if args.clean and DEST.exists():
        shutil.rmtree(DEST)
    DEST.mkdir(parents=True, exist_ok=True)
    build_records = load_build_records()
    records_by_source: dict[str, dict] = {}
    previous_index = DEST / "deliverables-index.json"
    if not args.clean and previous_index.exists():
        try:
            old = json.loads(previous_index.read_text(encoding="utf-8"))
            records_by_source = {r["pack_source"]: r for r in old.get("documents", []) if r.get("pack_source")}
        except (OSError, json.JSONDecodeError, KeyError, TypeError):
            records_by_source = {}
    families = (("unit", STUDY / "packs"), ("video", STUDY / "video-packs"))
    for family, base in families:
        if args.family not in ("all", family):
            continue
        pack_files = sorted(base.glob("*/*/pack.json")) if family == "unit" else sorted(base.glob("*/*/*/pack.json"))
        for pack_file in pack_files:
            course_code = pack_file.parents[1].name if family == "unit" else pack_file.parents[2].name
            if args.course and course_code != args.course:
                continue
            if not (pack_file.parent / "output").is_dir():
                if args.family == "all":
                    raise RuntimeError(f"Forge outputs are not ready yet: {pack_file.parent}")
                continue
            record = deliver_one(pack_file.parent, family, build_records)
            records_by_source[record["pack_source"]] = record
            if len(records_by_source) % 25 == 0:
                print(f"published copy {len(records_by_source)} indexed documents", flush=True)
    records = sorted(records_by_source.values(), key=lambda r: (r["course_code"], r["unit_id"], r["family"], r["document_title"].casefold()))
    index = {
        "schema_version": "1.0",
        "title": "PESU Study Forge deliverables",
        "status": "DRAFT: human review remains incomplete",
        "document_count": len(records),
        "unit_master_count": sum(r["family"] == "unit" for r in records),
        "video_lesson_count": sum(r["family"] == "video" for r in records),
        "documents": records,
    }
    (DEST / "deliverables-index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lfs_lines = [
        f"{Path(record['pdf']).relative_to('deliverables').as_posix()} filter=lfs diff=lfs merge=lfs -text"
        for record in records if record.get("pdf_requires_lfs")
    ]
    gitattributes = "\n".join(lfs_lines) + ("\n" if lfs_lines else "")
    (DEST / ".gitattributes").write_text(gitattributes, encoding="utf-8")
    (DEST / "README.md").write_text(
        "# PESU study documents\n\n"
        "This folder contains the generated unit master and per-video PDF/HTML documents, grouped by course and unit.\n\n"
        "Open each document's `index.html` in a browser. Its neighboring `assets/` directory contains the diagrams, figures, and fonts used by the page. The neighboring PDF is the print copy. Keep the HTML and assets together.\n\n"
        "All documents are marked DRAFT. Transcript/audio, source attribution, formula interpretation, and page-level visual/semantic review remains incomplete. `deliverables-index.json` records each file path, SHA-256, PDF page count, and asset inventory. The source datasets and Forge packs are in sibling folders under `study-materials/`.\n",
        encoding="utf-8",
    )
    print(f"published {len(records)} documents ({index['unit_master_count']} unit masters, {index['video_lesson_count']} videos)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"publish failed: {exc}", file=sys.stderr)
        raise
