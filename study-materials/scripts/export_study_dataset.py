#!/usr/bin/env python3
"""Export the note-first Forge packs as a reusable, unit/topic JSON dataset."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "study-materials"
OUT = STUDY / "datasets/study-notes-dataset.json"
CATEGORIES = (
    "DEFS", "STATEMENTS", "FORMULAS", "SYMBOLS", "POINTS", "NOTES", "TOP_FACTS",
    "TRAPS", "WHY", "RAPID", "MNEMONICS", "WORKED", "DERIVATIONS", "FIGS",
    "FLOWS", "COMPARISONS", "PRACTICE", "KEYWORDS", "PYQS",
)


def main() -> None:
    video_index_path = STUDY / "work/video-pack-index.json"
    video_rows = json.loads(video_index_path.read_text(encoding="utf-8"))["projects"] if video_index_path.exists() else []
    videos_by_topic = {}
    for video in video_rows:
        videos_by_topic.setdefault((video["course_code"], video["unit_id"], video["topic_id"]), []).append({
            "video_id": video["video_id"], "title": video["title"], "project": video["project"],
        })

    units = []
    for path in sorted((STUDY / "packs").glob("*/*/pack.json")):
        pack = json.loads(path.read_text(encoding="utf-8"))
        meta = pack["PACK"]
        code = path.parents[1].name
        unit_id = path.parent.name
        topics = []
        for topic in pack.get("TOPICS", []):
            row = {key: topic.get(key) for key in ("id", "title", "overview", "srcs", "requirements")}
            row["videos"] = videos_by_topic.get((code, unit_id, topic["id"]), [])
            row["content"] = {
                key.lower(): [item for item in pack.get(key, []) if item.get("topic") == topic["id"]]
                for key in CATEGORIES
            }
            topics.append(row)
        units.append({
            "course_code": code,
            "course": meta.get("course", ""),
            "unit_id": unit_id,
            "unit": meta.get("unit", ""),
            "title": meta.get("title", ""),
            "subtitle": meta.get("subtitle", ""),
            "status": "DRAFT",
            "topics": topics,
            "source_catalog": meta.get("sources", []),
            "evidence": pack.get("EVIDENCE", []),
            "checks": pack.get("CHECKS", []),
            "known_gaps": meta.get("gaps", []),
        })

    dataset = {
        "schema_version": "1.0",
        "title": "PESU topic-organized study notes dataset",
        "description": "Structured content used by the note-first unit master and video PDFs/HTML. Source transcripts, complete extracted slide points, formula candidates, visual page locators and historical question records are kept in the sibling source datasets listed below. Unreviewed evidence remains marked DRAFT.",
        "coverage": {"unit_master_count": len(units), "video_topic_count": len(video_rows), "topic_count": sum(len(unit["topics"]) for unit in units)},
        "source_datasets": [
            "lecture-corpus.json",
            "source-point-index.json",
            "content-index.json (formula candidates and visual page locators; candidates require review)",
            "question-archive.json",
            "unit-catalogue.json",
            "authored-lesson-notes.json",
        ],
        "units": units,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"path": str(OUT.relative_to(ROOT)), "units": len(units), "topics": dataset["coverage"]["topic_count"], "videos": len(video_rows), "bytes": OUT.stat().st_size}, indent=2))


if __name__ == "__main__":
    main()
