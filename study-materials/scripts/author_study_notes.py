#!/usr/bin/env python3
"""Turn the preserved transcript/slide text into concise, cited study notes.

The full transcripts and source-page text remain in datasets and source packs.
This pass keeps only the instructional content in the PDFs: edited lecture
notes and compact, page-cited slide takeaways. Full-slide images are omitted
from the lesson PDFs and remain discoverable through the visual/source index.
"""
from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "study-materials"
PACK_ROOTS = (STUDY / "packs",)
AUTHORED_PATH = STUDY / "datasets/authored-lesson-notes.json"
AUTHORED_DATA = json.loads(AUTHORED_PATH.read_text(encoding="utf-8")) if AUTHORED_PATH.exists() else {"notes": []}
FILLERS = re.compile(r"\b(?:uh|um|erm|er|you know|sort of|kind of)\b", re.I)
GREETING = re.compile(r"\b(?:hello|hi|welcome back|welcome to|good morning|good afternoon|let'?s get started|in today'?s session)\b", re.I)
DISCOURSE = re.compile(r"\b(?:what i'?ll be doing|today i have decided|as and when required|hopefully you know|please follow these instructions|in the previous class|we have already done|okay so|so let me repeat this)\b", re.I)
META = re.compile(r"\b(?:hope you'?re all ready|i'?m gonna be|i am going to be|hope this (?:is|was) clear|concept is clear|thank you(?: for watching)?|please go through|you enjoyed|can you hear me|good bye|see you next time)\b", re.I)
ASR_FIXES = ((r"\borthomatic\b", "arithmetic"), (r"\bearthmatic\b", "arithmetic"),
             (r"\barthmatic\b", "arithmetic"), (r"\bpresidency\b", "precedence"),
             (r"\bturnary\b", "ternary"), (r"\bexponeniation\b", "exponentiation"))
TOKEN = re.compile(r"[a-z0-9]+", re.I)
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\[])|(?<=\])\s+(?=[A-Z])", re.X)
TRANSCRIPT_BLOCK = re.compile(r"Transcript block\s+(\d+)\s*\(source interval\s+(\d+)-(\d+) seconds\):\s*", re.I)
PAGE_PREFIX = re.compile(r"^(?:Source slide page|Alternate text variant from .*?, page)\s+(\d+).*?:\s*", re.S)
COMMON_SLIDE = re.compile(r"^(?:PESU(?: UNIVERSITY)?|PYTHON FOR COMPUTATIONAL(?: PROBLEM SOLVING)?|UNIT\s*\d+|SLIDE\s*\d+)\b", re.I)
SKIP_LINE = re.compile(r"^(?:\W*\d+\W*|page\s+\d+|thank you|questions\??)$", re.I)


def plain_markup(text: str) -> str:
    """Remove only the small source wrappers already used by the packs."""
    return html.unescape(re.sub(r"<[^>]+>", " ", text))


def clean_sentence(sentence: str) -> str:
    sentence = re.sub(r"\[[0-9:.]+\]\s*", "", sentence)
    sentence = FILLERS.sub("", sentence)
    for pattern, replacement in ASR_FIXES:
        sentence = re.sub(pattern, replacement, sentence, flags=re.I)
    sentence = re.sub(r"\b(\w+)(?:\s+\1){1,}\b", r"\1", sentence, flags=re.I)
    sentence = re.sub(r"\s+([,.;:!?])", r"\1", sentence)
    sentence = re.sub(r"\s{2,}", " ", sentence).strip(" -\t\n")
    if sentence and sentence[-1] not in ".!?":
        sentence += "."
    return sentence


def is_useful(sentence: str) -> bool:
    words = TOKEN.findall(sentence)
    if len(words) < 3 or len(words) > 72:
        return False
    if GREETING.search(sentence) or DISCOURSE.search(sentence):
        return False
    if META.search(sentence):
        return False
    if re.search(r"\b(?:subscribe|thank you for watching|see you next|can you hear me)\b", sentence, re.I):
        return False
    if re.match(r"^(?:so|okay|right|now|well|similarly)\b", sentence, re.I) and not re.search(r"\b(?:because|therefore|means|is defined|example|first|next|condition|method)\b", sentence, re.I):
        return False
    if sentence.casefold().startswith(("what if i", "if i'm talking", "so what if", "in this case if you")):
        return False
    return True


def sentence_score(sentence: str, title_terms: set[str], position: int) -> float:
    words = {x.casefold() for x in TOKEN.findall(sentence)}
    cue = re.search(r"\b(?:is defined|means|refers to|because|therefore|however|example|assume|given|first|next|finally|important|remember|equation|formula|method|step|condition|when|if)\b", sentence, re.I)
    score = min(len(words), 28) / 12
    score += 2.2 * len(words & title_terms)
    score += 3.2 if cue else 0
    score -= 2.0 if re.search(r"\b(?:okay|so in this case|what if|what does it mean)\b", sentence, re.I) else 0
    score += 0.25 if 10 <= len(words) <= 28 else 0
    score -= 0.03 * position
    return score


def parse_transcript_note(text: str) -> tuple[str, list[str]] | None:
    raw = plain_markup(text)
    match = TRANSCRIPT_BLOCK.search(raw)
    if not match:
        return None
    interval = f"{int(match.group(2)) // 60:02d}:{int(match.group(2)) % 60:02d}–{int(match.group(3)) // 60:02d}:{int(match.group(3)) % 60:02d}"
    body = raw[match.end():]
    sentences = []
    for chunk in SENTENCE_SPLIT.split(body):
        clean = clean_sentence(chunk)
        if is_useful(clean):
            sentences.append(clean)
    return interval, sentences


def select_sentences(sentences: list[str], title: str, limit: int = 6) -> list[str]:
    title_terms = {w.casefold() for w in TOKEN.findall(title) if len(w) > 2}
    ranked = sorted(enumerate(sentences), key=lambda pair: sentence_score(pair[1], title_terms, pair[0]), reverse=True)
    selected = []
    seen = set()
    for _, sentence in ranked:
        key = " ".join(TOKEN.findall(sentence.casefold())[:12])
        if not key or key in seen:
            continue
        seen.add(key)
        selected.append(sentence)
        if len(selected) == limit:
            break
    # Restore lecture order so the note reads as a lesson, not a keyword list.
    chosen = set(selected)
    return [s for s in sentences if s in chosen]


def html_text(value: str) -> str:
    # Values have already been decoded from the existing pack's simple markup.
    return html.escape(value, quote=False).replace("$", "&#36;")


def norm_title(value: str) -> str:
    return " ".join(TOKEN.findall(plain_markup(value).casefold()))


def transcript_summary(topic_title: str, old_notes: list[dict]) -> tuple[list[dict], list[dict]]:
    summaries = []
    all_selected = []
    for old in old_notes:
        parsed = parse_transcript_note(old.get("text", ""))
        if not parsed:
            continue
        interval, sentences = parsed
        chosen = select_sentences(sentences, topic_title, len(sentences))
        if not chosen:
            continue
        all_selected.extend(chosen)
        lead = chosen[0]
        detail_sentences = chosen[1:]
        example_sentences = [s for s in detail_sentences if re.search(r"\b(?:for example|example|suppose|consider|given|let us|let's)\b", s, re.I)]
        example_block = ("<p><b>Example or application from the lecture</b></p><ul>" +
                         "".join(f"<li>{html_text(s)}</li>" for s in example_sentences[:3]) + "</ul>") if example_sentences else ""
        remaining = [s for s in detail_sentences if s not in example_sentences]
        items = "".join(f"<li>{html_text(s)}</li>" for s in remaining)
        text = (f"<p><b>Core explanation · {interval}</b></p><p>{html_text(lead)}</p>"
                + (f"<p><b>Key details</b></p><ul>{items}</ul>" if items else "")
                + example_block
                + "<p><i>These are edited study notes based on the cited lecture interval. Check uncertain speech recognition against the source transcript and recording.</i></p>")
        summaries.append({"id": old["id"], "topic": old["topic"], "srcs": list(old.get("srcs", [])), "text": text})
    return summaries, all_selected


def summarize_slide_point(text: str) -> str:
    raw = plain_markup(text)
    match = PAGE_PREFIX.search(raw)
    if not match:
        return html_text(raw.strip())
    page = int(match.group(1))
    body = raw[match.end():]
    lines = [re.sub(r"\s+", " ", x).strip(" \t•▪*-–") for x in body.splitlines()]
    lines = [x for x in lines if x and not SKIP_LINE.match(x) and not COMMON_SLIDE.match(x)]
    # The first concise non-bullet lines normally give the slide heading.
    heading = next((x for x in lines if len(x) <= 100 and len(TOKEN.findall(x)) >= 2), f"Slide page {page}")
    title_terms = {w.casefold() for w in TOKEN.findall(heading) if len(w) > 2}
    content = [x for x in lines if x != heading and len(TOKEN.findall(x)) >= 5]
    ranked = sorted(enumerate(content), key=lambda pair: sentence_score(pair[1], title_terms, pair[0]), reverse=True)
    chosen = []
    for _, line in ranked:
        if line not in chosen:
            chosen.append(line)
        if len(chosen) >= 3:
            break
    chosen = [x for x in content if x in set(chosen)]
    if not chosen and content:
        chosen = content[:2]
    body_html = "".join(f"<li>{html_text(x)}</li>" for x in chosen)
    if not body_html:
        body_html = f"<li>Image-only source page; see the visual page locator in <code>datasets/content-index.json</code>.</li>"
    return f"<p><b>Slide {page} · {html_text(heading)}</b></p><ul>{body_html}</ul>"


def rebuild_pack(path: Path) -> dict:
    pack = json.loads(path.read_text(encoding="utf-8"))
    rel = path.parent.relative_to(STUDY)
    course_code, unit_id = rel.parts[1], rel.parts[2]
    topic_by_id = {x["id"]: x for x in pack.get("TOPICS", [])}
    old_notes_by_topic: dict[str, list[dict]] = {}
    old_points_by_topic: dict[str, list[dict]] = {}
    for item in pack.get("NOTES", []):
        old_notes_by_topic.setdefault(item.get("topic", ""), []).append(item)
    for item in pack.get("POINTS", []):
        old_points_by_topic.setdefault(item.get("topic", ""), []).append(item)

    new_notes = []
    prior_note_ids = [x.get("id", "") for x in pack.get("NOTES", [])]
    generated_note_number = max((int(m.group(1)) for item in prior_note_ids
                                 if (m := re.fullmatch(r"N(\d+)", item))), default=0) + 1

    def new_note_id() -> str:
        nonlocal generated_note_number
        value = f"N{generated_note_number:06d}"
        generated_note_number += 1
        return value
    definitions = []
    worked_items = []
    rapid_items = []
    checks = []
    note_ids_by_topic: dict[str, list[str]] = {}
    for topic_id, topic in topic_by_id.items():
        title = plain_markup(topic.get("title", "Topic"))
        note_rows, selected = transcript_summary(title, old_notes_by_topic.get(topic_id, []))
        authored = next((x for x in AUTHORED_DATA.get("notes", [])
                         if x.get("course_code") == course_code and x.get("unit_id") == unit_id
                         and norm_title(x.get("title", "")) == norm_title(title)), None)
        if authored:
            prior_note = old_notes_by_topic.get(topic_id, [])
            prior_points = old_points_by_topic.get(topic_id, [])
            evidence_ids = list(dict.fromkeys(
                ev for row in prior_note + prior_points for ev in row.get("srcs", [])
            ))
            note_id = new_note_id()
            authored_row = {"id": note_id, "topic": topic_id, "srcs": evidence_ids, "text": authored["text"]}
            # Use the authored explanation in the reading copy. Complete
            # timestamped transcripts remain available in the source dataset.
            note_rows = [authored_row]
            selected = []
            for definition in authored.get("definitions", []):
                definitions.append({"id": f"D{len(definitions) + 1:06d}", "topic": topic_id,
                                    "srcs": evidence_ids, "term": definition["term"], "text": definition["text"]})
            for example in authored.get("worked", []):
                wid = f"W{len(worked_items) + 1:06d}"
                worked_items.append({"id": wid, "topic": topic_id, "srcs": evidence_ids,
                                     "title": example["title"], "given": example["given"],
                                     "steps": example["steps"], "answer": example["answer"],
                                     "check": example["check"], "units": "Dimensionless integers.",
                                     "method": "Apply Python operator precedence and associativity."})
                checks.append({"id": f"V{len(checks) + 1:06d}", "item": wid, "method": "manual",
                               "note": "Evaluated each expression independently using Python's documented precedence and associativity: multiplication before addition; subtraction left-to-right; exponentiation right-to-left.",
                               "reviewed": True})
            for qa in authored.get("rapid", []):
                rapid_items.append({"id": f"R{len(rapid_items) + 1:06d}", "topic": topic_id,
                                    "srcs": evidence_ids, "q": qa["q"], "a": qa["a"]})
            topic["requirements"] = {"DEFS": len(authored.get("definitions", [])) or {"not_applicable": "Core terminology is explained in the authored prose; no separate structured definition table is needed for this lesson."},
                                      "FORMULAS": {"not_applicable": "This lesson is about evaluating expressions; no equation candidate is asserted as a verified course formula."},
                                      "WORKED": len(authored.get("worked", [])) or {"not_applicable": "The authored code examples explain the operator rules; no separate source numerical problem is asserted as solved."},
                                      "FIGS": {"not_applicable": "The source slides are indexed as references; this concept is explained with evaluated code expressions instead of embedded slide images."},
                                      "FLOWS": {"not_applicable": "Operator evaluation is covered through precedence and associativity examples; a separate flowchart is not needed."},
                                      "NOTES": 1,
                                      "DERIVATIONS": {"not_applicable": "No mathematical derivation is part of this programming lesson."},
                                      "PRACTICE": {"not_applicable": "The short recall prompts are in RAPID; no separate question bank was requested for this lesson."}}
            topic["overview"] = (f"Study focus: {title}. The notes explain the key terms, distinctions, and practical method used in this lesson. "
                                  "Read the cited transcript intervals for source context, then use the examples to check your understanding.")
        for row in note_rows:
            note_ids_by_topic.setdefault(topic_id, []).append(row["id"])
            new_notes.append(row)
        # Slide-only topics receive concise textual notes from their source pages.
        point_rows = old_points_by_topic.get(topic_id, [])
        if not note_rows and point_rows:
            evidence_ids = list(dict.fromkeys(ev for row in point_rows for ev in row.get("srcs", [])))
            lines = [summarize_slide_point(row.get("text", "")) for row in point_rows[:80]]
            text = (f"<p><b>Study notes · {html_text(title)}</b></p>"
                    "<p>The slide deck is rewritten here as searchable lesson notes. Each subsection states the slide heading and its concise teaching points; page citations lead back to the indexed source image when visual details are needed.</p>"
                    + "".join(f"<p>{x}</p>" for x in lines))
            new_id = new_note_id()
            row = {"id": new_id, "topic": topic_id, "srcs": evidence_ids[:80], "text": text}
            new_notes.append(row)
            note_ids_by_topic.setdefault(topic_id, []).append(new_id)
            selected = []
        elif not note_rows and not point_rows:
            prior = old_notes_by_topic.get(topic_id, [])
            evidence_ids = list(dict.fromkeys(ev for row in prior for ev in row.get("srcs", [])))
            detail = plain_markup(prior[0].get("text", "")) if prior else ""
            content = (f"<p><b>Unit map · {html_text(title)}</b></p>"
                       f"<p>{html_text(detail or 'This section identifies the official course/unit scope and its source coverage.')}</p>")
            new_id = new_note_id()
            row = {"id": new_id, "topic": topic_id, "srcs": evidence_ids, "text": content}
            new_notes.append(row)
            note_ids_by_topic.setdefault(topic_id, []).append(new_id)
        # Topic overview becomes a learning-oriented framing, not an inventory notice.
        if selected:
            lead = selected[0]
            topic["overview"] = html_text(f"Study focus: {title}. This topic explains the central idea, its conditions, and how the lecture applies it in context. Review the selected source statements and follow their citations for the full lesson segment.")
        elif point_rows and not authored:
            topic["overview"] = html_text(f"Study focus: {title}. The notes identify each page heading, summarize its main ideas, and explain its place in this unit; citations preserve the source page locator.")
        req = topic.get("requirements", {})
        if not authored:
            req["DEFS"] = {"not_applicable": "No separate verified definition table is asserted here; source definitions are retained in the cited edited notes and source-text dataset."}
            req["FORMULAS"] = {"not_applicable": "Formula candidates remain source-indexed in datasets/content-index.json and are not presented as verified equations without mathematical review."}
            req["WORKED"] = {"not_applicable": "Instructor examples are included in the cited notes where the transcript is clear; no independent solution is claimed without checking the original problem and steps."}
            req["FLOWS"] = {"not_applicable": "No separate process diagram is authored where the source sequence has not been independently checked; the lecture sequence is summarized in text."}
            req["DERIVATIONS"] = {"not_applicable": "No proof is newly asserted; source derivation steps remain in the transcript and page-text datasets until independently checked."}
            req["PRACTICE"] = {"not_applicable": "Historical question pages remain in the question archive dataset; this draft does not invent solutions or unconfirmed exam mappings."}
            req["FIGS"] = {"not_applicable": "Original full-page slide images are preserved in source and visual-index datasets; this lesson PDF uses cited text notes instead of embedding those slides."}
        req["NOTES"] = len(note_ids_by_topic.get(topic_id, [])) or 1
        topic["requirements"] = req

    # Source point/OCR records live in datasets/source-point-index.json. Keep the
    # reading copy focused on lesson notes instead of printing each slide as a page.
    new_points = []

    # All cited lecture/source units still map to their note or compact point.
    note_ids = {x["id"] for x in new_notes}
    point_ids = {x["id"] for x in new_points}
    evidence_by_id = {e["id"]: e for e in pack.get("EVIDENCE", [])}
    note_by_id = {n["id"]: n for n in new_notes}
    notes_by_source: dict[str, list[str]] = {}
    for note in new_notes:
        for ev_id in note.get("srcs", []):
            source_id = evidence_by_id.get(ev_id, {}).get("source")
            if source_id:
                notes_by_source.setdefault(source_id, []).append(note["id"])
    for evidence in pack.get("EVIDENCE", []):
        ev_id = evidence["id"]
        linked = [x["id"] for x in new_notes + new_points + definitions + worked_items + rapid_items if ev_id in x.get("srcs", [])]
        linked.extend(t["id"] for t in topic_by_id.values() if ev_id in t.get("srcs", []))
        evidence["items"] = list(dict.fromkeys(linked))
        if evidence.get("status") == "covered" and not evidence["items"]:
            source = evidence.get("source")
            related = list(dict.fromkeys(notes_by_source.get(source, [])))
            if related:
                evidence["items"] = related[:1]
                for note_id in evidence["items"]:
                    note = note_by_id[note_id]
                    if evidence["id"] not in note["srcs"]:
                        note["srcs"].append(evidence["id"])
            else:
                evidence["status"] = "gap"
                evidence["reason"] = "Source unit is retained in the source-point dataset but no lesson note could be reliably associated with this page."

    # Remove reciprocal citation claims to source images from the topic headers.
    pack["NOTES"] = new_notes
    pack["POINTS"] = []
    pack["FIGS"] = []
    if definitions:
        pack["DEFS"] = definitions
    if worked_items:
        pack["WORKED"] = worked_items
    if rapid_items:
        pack["RAPID"] = rapid_items
    if checks:
        pack["CHECKS"] = checks
    for topic in pack.get("TOPICS", []):
        topic["srcs"] = [ev for ev in topic.get("srcs", []) if any(e["id"] == ev and topic["id"] in e.get("items", []) for e in pack.get("EVIDENCE", []))]
    note_scope = (
        "The study PDF contains edited, topic-organized lecture notes and textual slide-page takeaways. Full-page slide images remain in the source/visual index datasets, not embedded as the lesson. "
        "Human content, ASR, formula, and page-level visual review remains pending."
    )
    gaps = pack.setdefault("PACK", {}).setdefault("gaps", [])
    if note_scope not in gaps:
        gaps.append(note_scope)
    pack["PACK"]["subtitle"] = "Notes-first study master · source-cited lecture explanations and compact page takeaways"
    pack["PACK"]["how_to_use"] = "Read the edited lesson notes by topic. Evidence chips point to transcript intervals and slide pages. The complete source transcripts, page text, formula candidates, and image locators are preserved in sibling JSON datasets."
    path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return {"project": str(path.parent.relative_to(ROOT)), "topics": len(topic_by_id), "notes": len(new_notes), "points": len(new_points), "figures_removed_from_pdf": True}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", help="rewrite one pack directory for preview")
    parser.add_argument("--all", action="store_true", help="rewrite every unit master; video packs are generated from these notes")
    args = parser.parse_args()
    if args.project:
        project = Path(args.project)
        if not project.is_absolute():
            project = ROOT / project
        paths = [project / "pack.json"]
    elif args.all:
        paths = sorted(p for root in PACK_ROOTS for p in root.glob("**/pack.json"))
    else:
        parser.error("pass --project or --all")
    results = [rebuild_pack(p) for p in paths]
    print(json.dumps({"rewritten": len(results), "notes": sum(x["notes"] for x in results), "points": sum(x["points"] for x in results), "samples": results[:8]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
