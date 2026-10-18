#!/usr/bin/env python3
"""Create one-source-topic Forge projects for every video, derived from unit masters."""
from __future__ import annotations
import hashlib
import json
import pathlib
import shutil
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
INDEX = ROOT / "study-materials/work/unit-pack-index.json"
OUT = ROOT / "study-materials/video-packs"


def sha(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def slug(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (value[:90].rstrip("-") or "video")


def build_one(row: dict, video: dict, lesson_number: int) -> dict:
    unit_project = ROOT / pathlib.Path(row["pack_path"]).parent
    source_pack = json.loads((unit_project / "pack.json").read_text(encoding="utf-8"))
    topic_id = video["topic_id"]
    topic = next(x for x in source_pack["TOPICS"] if x["id"] == topic_id)
    selected = {}
    for key in ("POINTS", "NOTES", "FIGS"):
        selected[key] = [x for x in source_pack.get(key, []) if x.get("topic") == topic_id]
    item_ids = {topic_id}
    for records in selected.values():
        item_ids.update(x["id"] for x in records)
    evidence = []
    for ev in source_pack["EVIDENCE"]:
        items = [x for x in ev["items"] if x in item_ids]
        if not items:
            continue
        evidence.append({**ev, "items": items})
    evidence_ids = {x["id"] for x in evidence}
    used_source_ids = {x["source"] for x in evidence}
    source_rows = [x for x in source_pack["PACK"]["sources"] if x["id"] in used_source_ids]
    dest = OUT / row["course_code"] / row["unit_id"] / video["video_id"]
    if dest.exists():
        shutil.rmtree(dest)
    (dest / "sources").mkdir(parents=True)
    (dest / "figures").mkdir()
    (dest / "work").mkdir()
    for source in source_rows:
        rel = source["local_path"]
        src = unit_project / rel
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, target)
        if sha(target) != source["sha256"]:
            raise ValueError(f"SHA-256 mismatch in video project for {rel}")
    for figure in selected["FIGS"]:
        rel = figure["file"]
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(unit_project / rel, target)
    topic = {**topic, "srcs": [x for x in topic.get("srcs", []) if x in evidence_ids]}
    for key in selected:
        for item in selected[key]:
            item["srcs"] = [x for x in item.get("srcs", []) if x in evidence_ids]
    for figure in selected["FIGS"]:
        figure["srcs"] = [x for x in figure.get("srcs", []) if x in evidence_ids]
    unit_name = source_pack["PACK"]["unit"]
    video_title = video["title"]
    pack = source_pack
    pack["PACK"] = {**pack["PACK"]}
    pack["PACK"].update({
        "title": f"{row['course_code']} · {unit_name} · {video_title}",
        "subtitle": "Standalone video lesson · source transcript and assigned slide pages",
        "slug": slug(f"{row['course_code']}-{row['unit_id']}-{video['video_id']}-{video_title}"),
        "header": f"{row['course_code']} · {row['unit_id']} · Lesson {lesson_number:02d}",
        "scope": f"Standalone source record for video {video_title} in {row['course_code']}, {unit_name}. The timestamped transcript and any assigned slide pages come from the complete unit master.",
        "how_to_use": "Read the transcript in timestamp order. Compare any included slide pages with the original page render. Transcript confidence and video-to-slide match caveats are retained from the unit master.",
        "coverage_note": "This video study document is a DRAFT pending human transcript/audio and page-level semantic and visual review.",
        "sources": source_rows,
        "topic_order": [topic_id],
        "documents": ["master"],
        "gaps": list(dict.fromkeys(pack["PACK"].get("gaps", []))),
    })
    pack["MODULES"] = [{"id": "M1", "title": topic["title"], "topics": [topic_id]}]
    pack["TOPICS"] = [topic]
    for key in ("POINTS", "NOTES", "FIGS"):
        pack[key] = selected[key]
    pack["EVIDENCE"] = evidence
    pack["CHECKS"] = []
    (dest / "work/brief.md").write_text(
        f"# PDF Study Forge brief\n\n"
        f"- Requested scope: standalone source study file for video `{video['video_id']}`: {video_title}.\n"
        f"- Explicit exclusions: no transcript correction or claim that the video itself was watched; only its scored slide assignment is included.\n"
        f"- Audience: PESU first-year students.\n"
        f"- Required sources: the unit master's four transcript sidecars and any assigned slide page text/render.\n"
        f"- Required sections: complete timestamped lesson transcript and matching source slide pages when available.\n"
        f"- Deliverables: standalone video PDF and HTML plus reusable source pack.\n"
        f"- Assumptions: human audio/visual review remains pending; this artifact remains visibly labelled DRAFT.\n",
        encoding="utf-8",
    )
    (dest / "pack.json").write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return {"video_id": video["video_id"], "lesson_number": lesson_number, "title": video_title, "course_code": row["course_code"], "unit_id": row["unit_id"], "topic_id": topic_id, "project": str(dest.relative_to(ROOT)), "sources": len(source_rows), "notes": len(selected["NOTES"]), "points": len(selected["POINTS"]), "figures": len(selected["FIGS"])}


def main() -> None:
    rows = json.loads(INDEX.read_text(encoding="utf-8"))["packs"]
    outputs = []
    for row in rows:
        for lesson_number, video in enumerate(row.get("video_topics", []), 1):
            outputs.append(build_one(row, video, lesson_number))
            if len(outputs) % 10 == 0:
                print(f"Prepared {len(outputs)} standalone video projects", flush=True)
    report = ROOT / "study-materials/work/video-pack-index.json"
    report.write_text(json.dumps({"schema_version": "1.0", "video_count": len(outputs), "projects": outputs}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(outputs)} standalone video projects in {OUT}")


if __name__ == "__main__":
    main()
