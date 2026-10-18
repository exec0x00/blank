#!/usr/bin/env python3
"""Prepare a reusable 26-unit catalogue, formula index, and question archive."""
from __future__ import annotations
import collections
import difflib
import json
import pathlib
import re
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / "study-materials/datasets"
CORPUS = json.loads((DATA / "lecture-corpus.json").read_text(encoding="utf-8"))
CATALOGUE = json.loads((ROOT / "study-materials/sources/PESU_Materials/units.json").read_text(encoding="utf-8"))
MANIFEST = json.loads((ROOT / "study-materials/work/download-manifest.json").read_text(encoding="utf-8"))
INV = json.loads((ROOT / "study-materials/inventory/source-inventory.json").read_text(encoding="utf-8"))
RENDER_PATH = ROOT / "study-materials/work/slide-render-manifest.json"
RENDER = json.loads(RENDER_PATH.read_text(encoding="utf-8")) if RENDER_PATH.exists() else {"sources": []}
RENDER_BY = {x["source"]: x for x in RENDER.get("sources", [])}
MAN_BY = {x["path"]: x for x in MANIFEST.get("files", [])}

STOP = set("a an and are as at be by for from has have in into is it its of on or the their this to was were which with within".split())
FORMULA = re.compile(r"(?:=|≈|≃|∝|±|≤|≥|\\(?:frac|sqrt|sum|int|Delta|nu|lambda|omega)|\b(?:is equal to|equals|given by|formula|relation|proportional to)\b|\b(?:cm|mm|m|kg|mol|Pa|N|J|W|Hz|V|A|F|C)\s*\^?-?\d)", re.I)


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower().replace("’", "'")
    return " ".join(re.findall(r"[a-z0-9]+", text))


def terms(text: str) -> set[str]:
    return {x for x in norm(text).split() if len(x) > 3 and x not in STOP}


def bucket_url(path: str) -> str:
    return "https://huggingface.co/buckets/alvin3y10/data/tree/pesuc/" + path.removeprefix("pesuc/")


def source_mapping(remote: str) -> dict:
    x = MAN_BY.get(remote, {})
    tree = next((y for y in CORPUS.get("courses", []) if False), None)
    return {
        "bucket_path": remote,
        "url": bucket_url(remote),
        "local_path": "study-materials/sources/" + x["local_path"] if x else None,
        "sha256": x.get("sha256"),
        "bytes": x.get("size"),
        "xetHash": x.get("xetHash"),
    }


def course_for_legacy(path: str) -> str | None:
    low = path.lower()
    if "/chemistry/" in low:
        return "UE26CY151A"
    if "/epd/" in low:
        return "UE26EC141A"
    if "/math 1/" in low:
        return "UE26MA141A"
    if "/python/" in low:
        return "UE26CS151A"
    if "/mes/" in low or "/statics/" in low:
        return "UE26ME142A"
    if "/constitution/" in low:
        return "UC26CE121A"
    return None


def relevant_pages() -> tuple[list[dict], dict[str, list[dict]]]:
    by_code: dict[str, list[dict]] = collections.defaultdict(list)
    rows = []
    for rec in CORPUS.get("legacy_related_question_sources", []):
        src = rec.get("source", {})
        code = course_for_legacy(src.get("bucket_path", ""))
        if not code:
            continue
        suffix = pathlib.PurePosixPath(src.get("bucket_path", "")).suffix.lower()
        base = {
            "course_code": code,
            "source": src,
            "kind": "question_bank" if "question bank" in src.get("bucket_path", "").lower() else "historical_paper" if "/papers/" in src.get("bucket_path", "").lower() else "supplemental_reference",
            "answer_key": bool(re.search(r"/answers?/|answer", src.get("bucket_path", ""), re.I)),
            "format": suffix.lstrip("."),
        }
        if "pages" in rec:
            for page in rec["pages"]:
                extracted = page.get("text", "")
                ocr_text = page.get("ocr_text", "")
                row = {**base, "page": page["page"], "text": extracted or ocr_text, "text_chars": page.get("text_chars", len(extracted.strip())), "ocr_text_chars": page.get("ocr_text_chars", 0), "ocr_status": page.get("ocr_status"), "sparse": page.get("sparse", False)}
                rows.append(row)
                by_code[code].append(row)
        else:
            row = {**base, "page": None, "text": None, "text_chars": None, "sparse": None}
            rows.append(row)
            by_code[code].append(row)
    return rows, by_code


def make_profiles(catalogue_units: list[dict], corpus_by_code: dict[str, dict]) -> dict[str, dict[str, set[str]]]:
    profiles: dict[str, dict[str, set[str]]] = collections.defaultdict(dict)
    for row in catalogue_units:
        code, unit_id = row["course_code"], row["unit_id"]
        parts = [row["official_title"]]
        cor = corpus_by_code.get(code)
        unit = next((u for u in cor.get("units", []) if u["id"] == unit_id), None) if cor else None
        if unit:
            parts.extend(v["title"] for v in unit["videos"])
            parts.extend(s["title"] for s in unit["slide_decks"])
        profiles[code][unit_id] = terms(" ".join(parts))
    return profiles


def page_matches(text: str, code: str, profiles: dict[str, dict[str, set[str]]]) -> list[dict]:
    words = terms(text)
    if len(words) < 4:
        return []
    scored = []
    for unit_id, wanted in profiles.get(code, {}).items():
        overlap = words & wanted
        score = len(overlap) / max(1, min(12, len(wanted)))
        if score:
            scored.append((score, unit_id, sorted(overlap)))
    scored.sort(reverse=True)
    if not scored:
        return []
    top = scored[0]
    margin = top[0] - (scored[1][0] if len(scored) > 1 else 0)
    confidence = "candidate" if top[0] >= .34 and margin >= .10 else "ambiguous" if top[0] >= .20 else "unmapped"
    return [{"unit_id": top[1], "score": round(top[0], 4), "margin": round(margin, 4), "confidence": confidence, "matched_terms": top[2]}]


def main() -> None:
    corpus_by_code = {c["id"].split("_", 1)[0]: c for c in CORPUS["courses"]}
    source_course = {c["id"].split("_", 1)[0]: c for c in INV["courses"]}
    unit_rows = []
    for row in CATALOGUE:
        code = row["course"]["code"]
        unit_id = f"Unit_{int(row['unit_index']):02d}"
        cor = corpus_by_code.get(code, {})
        existing = next((u for u in cor.get("units", []) if u["id"] == unit_id), None)
        unit_rows.append({
            "course_code": code,
            "course_title": row["course"]["title"],
            "semester": row["course"].get("semester"),
            "unit_id": unit_id,
            "unit_index": row["unit_index"],
            "official_title": row["unit_title"],
            "unit_catalogue_id": row.get("unit_id"),
            "bucket_folder_present": existing is not None,
            "video_count": len(existing["videos"]) if existing else 0,
            "slide_deck_count": len(existing["slide_decks"]) if existing else 0,
            "slide_page_count": sum(len(x["pages"]) for x in existing["slide_decks"]) if existing else 0,
            "source_file_count": len(existing["source_files"]) if existing else 0,
            "source_gap": None if existing else "No matching unit folder or unit-specific video/slide sources found in the current PESU_Materials tree.",
            "legacy_question_sources": [],
        })

    profiles = make_profiles(unit_rows, corpus_by_code)
    questions, by_course = relevant_pages()
    for q in questions:
        q["unit_candidate"] = page_matches(q.get("text") or "", q["course_code"], profiles)
    for row in unit_rows:
        row["legacy_question_sources"] = sorted({
            q["source"]["bucket_path"] for q in by_course.get(row["course_code"], [])
            if any(m["unit_id"] == row["unit_id"] and m["confidence"] == "candidate" for m in q.get("unit_candidate", []))
        })

    # Formula-like excerpts remain candidates until matched against the rendered source page.
    formula_rows = []
    visual_rows = []
    course_rows = []
    for course in CORPUS["courses"]:
        code = course["id"].split("_", 1)[0]
        c_entry = {"course_code": code, "course_title": course["title"], "units": []}
        for unit in course["units"]:
            u_entry = {"unit_id": unit["id"], "videos": [], "slide_decks": []}
            for video in unit["videos"]:
                u_entry["videos"].append({"id": video["id"], "title": video["title"], "source": video["video_source"], "transcript_word_count": video["word_count"], "duration_seconds": video["duration_seconds"], "matched_slide": video["matched_slide"], "match_candidates": video["slide_match_candidates"], "low_confidence_locators": video["low_confidence_locators"], "transcript_variants": video["transcript_variants"]})
                transcript_remote = video["video_source"]["bucket_path"].rsplit(".", 1)[0] + ".transcript.json"
                for segment in video["transcript_segments"]:
                    if FORMULA.search(segment["text"]) and len(segment["text"]) < 500:
                        formula_rows.append({"course_code": code, "unit_id": unit["id"], "topic_id": video["id"], "text": segment["text"], "source": transcript_remote, "locator": f"transcript {segment['timestamp']}", "confidence": "spoken candidate; compare with slide/video", "segment_id": segment["id"], "avg_logprob": segment.get("avg_logprob")})
            for deck in unit["slide_decks"]:
                deck_row = {"source": deck["path"], "title": deck["title"], "deck_source": source_mapping(deck.get("deck_path")) if deck.get("deck_path") else None, "deck_path": deck.get("deck_path"), "text_variant_path": deck.get("text_variant_path"), "match_status": "source slide deck; association to a particular video is separate", "pages": []}
                rendered = RENDER_BY.get(deck.get("deck_path")) if deck.get("deck_path") else None
                pages_by_num = {x["page"]: x for x in (rendered or {}).get("pages", [])}
                text_by_num = {x["page"]: x["text"] for x in deck["pages"]}
                variant_by_num = {x["page"]: x["text"] for x in deck.get("text_variant_pages", [])}
                page_count = max(len(deck["pages"]), len(variant_by_num), (rendered or {}).get("page_count", 0))
                for page_num in range(1, page_count + 1):
                    page_text = text_by_num.get(page_num, "")
                    variant_text = variant_by_num.get(page_num, "")
                    similarity = round(difflib.SequenceMatcher(None, norm(page_text), norm(variant_text), autojunk=False).ratio(), 4) if page_text.strip() and variant_text.strip() else None
                    p_row = {"page": page_num, "text_chars": len(page_text.strip()), "text_source": deck["path"] if page_num in text_by_num else None, "text_locator": f"page {page_num}", "text_status": "extracted" if page_num in text_by_num and page_text.strip() else "no text extract for this rendered page", "text_variant_source": deck.get("text_variant_path"), "text_variant": variant_text, "text_variant_chars": len(variant_text.strip()), "text_variant_similarity": similarity, "visual_source": deck.get("deck_path"), "visual_url": bucket_url(deck["deck_path"]) if deck.get("deck_path") else None, "rendered_svg": pages_by_num.get(page_num, {}).get("svg"), "rendered_svg_sha256": pages_by_num.get(page_num, {}).get("sha256"), "visual_status": "rendered" if page_num in pages_by_num else "source deck unavailable; text extract preserved"}
                    deck_row["pages"].append(p_row)
                    visual_rows.append({"course_code": code, "unit_id": unit["id"], **p_row})
                    for line in page_text.splitlines():
                        clean = " ".join(line.split()).strip(" -*•➢")
                        if clean and len(clean) < 350 and FORMULA.search(clean):
                            formula_rows.append({"course_code": code, "unit_id": unit["id"], "topic_id": None, "text": clean, "source": deck["path"], "locator": f"slide {page_num}", "confidence": "slide OCR candidate; compare with rendered page", "rendered_svg": pages_by_num.get(page_num, {}).get("svg"), "rendered_svg_sha256": pages_by_num.get(page_num, {}).get("sha256")})
                    for line in variant_text.splitlines():
                        clean = " ".join(line.split()).strip(" -*•➢")
                        if clean and len(clean) < 350 and FORMULA.search(clean):
                            formula_rows.append({"course_code": code, "unit_id": unit["id"], "topic_id": None, "text": clean, "source": deck.get("text_variant_path"), "locator": f"alternate slide text page {page_num}", "confidence": "alternate slide text candidate; compare with rendered page"})
                u_entry["slide_decks"].append(deck_row)
            c_entry["units"].append(u_entry)
        course_rows.append(c_entry)

    for q in questions:
        for line in (q.get("text") or "").splitlines():
            clean = " ".join(line.split()).strip(" -*•➢")
            if clean and len(clean) < 350 and FORMULA.search(clean):
                candidate = {"course_code": q["course_code"], "unit_id": (q.get("unit_candidate") or [{}])[0].get("unit_id"), "topic_id": None, "text": clean, "source": q["source"]["bucket_path"], "locator": f"question archive page {q['page']}", "confidence": "PDF text/OCR candidate; compare with original page", "unit_match": q.get("unit_candidate", [])}
                formula_rows.append(candidate)

    DATA.mkdir(parents=True, exist_ok=True)
    for row in unit_rows:
        row["rendered_visual_page_count"] = sum(len(d["pages"]) for c in course_rows if c["course_code"] == row["course_code"] for u in c["units"] if u["unit_id"] == row["unit_id"] for d in u["slide_decks"])
    (DATA / "unit-catalogue.json").write_text(json.dumps({"schema_version": "1.0", "source": "PESU_Materials/units.json", "official_unit_count": len(unit_rows), "folder_backed_unit_count": sum(x["bucket_folder_present"] for x in unit_rows), "catalogue_only_unit_count": sum(not x["bucket_folder_present"] for x in unit_rows), "units": unit_rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (DATA / "content-index.json").write_text(json.dumps({"schema_version": "1.0", "bucket": CORPUS["bucket"], "inventory_file": "../inventory/source-inventory.json", "corpus_file": "lecture-corpus.json", "formula_candidate_count": len(formula_rows), "visual_page_count": len(visual_rows), "formula_candidates": formula_rows, "visual_pages": visual_rows, "course_index": course_rows, "notes": ["Formula candidates are machine-extracted raw text, not verified equations.", "Rendered SVG page copies are faithful renderings of the cited source deck; their text extraction remains separate.", "A video-to-slide match candidate is not a claim that an ambiguous deck belongs to that video."]}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (DATA / "question-archive.json").write_text(json.dumps({"schema_version": "1.0", "source": "First_Year_8enterprise subject-matched archive selection", "source_count": len({q["source"]["bucket_path"] for q in questions}), "page_count": sum(q["page"] is not None for q in questions), "sources": questions, "notes": ["Page text is preserved from source extraction/OCR and should be checked against the source PDF before quoting.", "Unit matches are candidates only when marked candidate; ambiguous and unmapped pages remain course-level references."]}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"official_units": len(unit_rows), "folder_backed_units": sum(x["bucket_folder_present"] for x in unit_rows), "catalogue_only_units": sum(not x["bucket_folder_present"] for x in unit_rows), "formula_candidates": len(formula_rows), "visual_pages": len(visual_rows), "legacy_question_pages": sum(q["page"] is not None for q in questions), "legacy_sources": len({q["source"]["bucket_path"] for q in questions})}, indent=2))


if __name__ == "__main__":
    main()
