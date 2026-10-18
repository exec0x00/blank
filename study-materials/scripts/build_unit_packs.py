#!/usr/bin/env python3
"""Assemble source-complete, one-master PDF Study Forge projects for all units."""
from __future__ import annotations
import collections
import hashlib
import html
import json
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / "study-materials/datasets"
CORPUS = json.loads((DATA / "lecture-corpus.json").read_text(encoding="utf-8"))
CATALOGUE = json.loads((DATA / "unit-catalogue.json").read_text(encoding="utf-8"))
INDEX = json.loads((DATA / "content-index.json").read_text(encoding="utf-8"))
QUESTIONS = json.loads((DATA / "question-archive.json").read_text(encoding="utf-8"))
DOWNLOADS = json.loads((ROOT / "study-materials/work/download-manifest.json").read_text(encoding="utf-8"))
RENDERS = json.loads((ROOT / "study-materials/work/slide-render-manifest.json").read_text(encoding="utf-8"))
MAN_BY = {x["path"]: x for x in DOWNLOADS.get("files", [])}
RENDER_BY = {x["source"]: x for x in RENDERS.get("sources", [])}
CORPUS_BY = {x["id"].split("_", 1)[0]: x for x in CORPUS["courses"]}
INDEX_BY = {x["course_code"]: x for x in INDEX["course_index"]}


def sha(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def safe(text: str) -> str:
    """Encode source text as HTML entities so it displays literally and validates safely."""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)
    return html.escape(text, quote=False).replace("$", "&#36;").replace("\\", "&#92;")


def slug(text: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return value or "course"


def source_url(remote: str) -> str:
    return "https://huggingface.co/buckets/alvin3y10/data/tree/pesuc/" + remote.removeprefix("pesuc/")


class Pack:
    def __init__(self, project: pathlib.Path, course_code: str, unit_id: str, unit_title: str, course_title: str, row: dict):
        self.project = project
        self.course_code = course_code
        self.unit_id = unit_id
        self.unit_title = unit_title
        self.course_title = course_title
        self.row = row
        self.sources = []
        self.source_by_remote = {}
        self.evidence = []
        self.topics = []
        self.points = []
        self.notes = []
        self.figures = []
        self.topic_order = []
        self.next_topic = 0
        self.next_point = 0
        self.next_note = 0
        self.next_figure = 0
        self.next_evidence = 0
        self.next_source = 0
        self.gaps = []

    def new_id(self, prefix: str) -> str:
        if prefix == "T":
            self.next_topic += 1
            return f"T{self.next_topic:04d}"
        if prefix == "P":
            self.next_point += 1
            return f"P{self.next_point:06d}"
        if prefix == "N":
            self.next_note += 1
            return f"N{self.next_note:06d}"
        if prefix == "G":
            self.next_figure += 1
            return f"G{self.next_figure:06d}"
        if prefix == "EV":
            self.next_evidence += 1
            return f"EV{self.next_evidence:07d}"
        self.next_source += 1
        return f"SRC{self.next_source:05d}"

    def register_source(self, remote: str, name: str, local_src: pathlib.Path, dest_rel: str, kind: str, units: list[str], use: str, key: str | None = None) -> str:
        key = key or remote
        if key in self.source_by_remote:
            return self.source_by_remote[key]
        if not local_src.is_file():
            raise FileNotFoundError(f"Missing local source for {remote}: {local_src}")
        dest = self.project / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if local_src.resolve() != dest.resolve():
            shutil.copyfile(local_src, dest)
        ident = self.new_id("SRC")
        self.sources.append({
            "id": ident,
            "name": name,
            "path": source_url(remote) if remote.startswith("pesuc/") else remote,
            "local_path": dest_rel,
            "sha256": sha(dest),
            "kind": kind,
            "units": list(dict.fromkeys(units)),
            "use": use,
            "availability": "available",
        })
        self.source_by_remote[key] = ident
        return ident

    def add_evidence(self, source_id: str, unit: str, summary: str, items: list[str], reviewed: bool = False, status: str = "covered", reason: str | None = None) -> str:
        ident = self.new_id("EV")
        row = {"id": ident, "source": source_id, "unit": unit, "status": status, "reviewed": reviewed, "summary": summary, "items": list(dict.fromkeys(items))}
        if reason:
            row["reason"] = reason
        self.evidence.append(row)
        return ident

    def topic(self, title: str, overview: str) -> str:
        ident = self.new_id("T")
        self.topics.append({"id": ident, "title": safe(title), "overview": safe(overview), "srcs": [], "requirements": {
            "DEFS": {"not_applicable": "Source wording is preserved in the indexed lecture transcript and original slide pages; definitions are not independently re-authored in this source-preservation draft."},
            "FORMULAS": {"not_applicable": "Formula-like extracts are indexed in datasets/content-index.json and every original slide page is included. Candidates are not promoted to validated equations in this draft."},
            "WORKED": {"not_applicable": "Original worked examples remain in their complete source slide pages. No new or recomputed solution is claimed."},
            "FIGS": {"not_applicable": "No rendered source slide page is available for this topic; the corresponding text extract remains in the master."},
            "FLOWS": {"not_applicable": "Any source diagrams are retained on the original slide pages; no separate flowchart has been authored."},
            "NOTES": 1,
            "DERIVATIONS": {"not_applicable": "Any source derivation is retained on its original slide page; it has not been independently re-derived."},
            "PRACTICE": {"not_applicable": "Question material is preserved as source pages or archive extracts, without presenting unverified solutions."},
        }})
        self.topic_order.append(ident)
        return ident

    def set_requirements(self, topic_id: str, figure_count: int) -> None:
        t = next(x for x in self.topics if x["id"] == topic_id)
        t["requirements"]["FIGS"] = figure_count if figure_count else {"not_applicable": "No page-faithful source image could be rendered for this topic; all available extracted text is included."}

    def add_topic_source(self, topic_id: str, evidence_id: str) -> None:
        topic = next(x for x in self.topics if x["id"] == topic_id)
        # The precise citations remain on every point, note and figure. Keep
        # the topic header's summary citations short so the master stays readable.
        if evidence_id not in topic["srcs"] and len(topic["srcs"]) < 2:
            topic["srcs"].append(evidence_id)

    def add_note(self, topic_id: str, text: str, evidence_ids: list[str]) -> str:
        ident = self.new_id("N")
        item = {"id": ident, "topic": topic_id, "srcs": [], "text": safe(text)}
        self.notes.append(item)
        for ev_id in evidence_ids:
            evidence = self.evidence_by_id(ev_id)
            if ident not in evidence["items"]:
                evidence["items"].append(ident)
            item["srcs"].append(ev_id)
            self.add_topic_source(topic_id, ev_id)
        return ident

    def add_point(self, topic_id: str, text: str, citations: list[str]) -> str:
        ident = self.new_id("P")
        item = {"id": ident, "topic": topic_id, "srcs": list(dict.fromkeys(citations)), "text": safe(text)}
        self.points.append(item)
        for ev in citations:
            if ev in {x["id"] for x in self.evidence}:
                self.evidence_by_id(ev)["items"].append(ident)
        return ident

    def evidence_by_id(self, ident: str) -> dict:
        return next(x for x in self.evidence if x["id"] == ident)


def copy_remote(remote: str, project: pathlib.Path, dest_rel: str) -> pathlib.Path:
    entry = MAN_BY.get(remote)
    if not entry:
        raise KeyError(f"Source is absent from the verified download manifest: {remote}")
    source = ROOT / "study-materials/sources" / entry["local_path"]
    if not source.is_file():
        raise FileNotFoundError(source)
    if sha(source) != entry["sha256"]:
        raise ValueError(f"SHA-256 mismatch for source {remote}")
    dest = project / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if source.resolve() != dest.resolve():
        shutil.copyfile(source, dest)
    return dest


def interval_groups(segments: list[dict]) -> list[tuple[str, list[dict]]]:
    by_bin = collections.defaultdict(list)
    for segment in segments:
        start = float(segment.get("start", 0) or 0)
        by_bin[int(start // 300)].append(segment)
    result = []
    for bin_no, rows in sorted(by_bin.items()):
        start = bin_no * 300
        end = start + 299
        result.append((f"t{start:06d}-{end:06d}", rows))
    return result


def display_time(sec: float) -> str:
    whole = int(sec)
    h, rem = divmod(whole, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def source_filename(remote: str, fallback: str) -> str:
    stem = hashlib.sha256(remote.encode()).hexdigest()[:12]
    suffix = pathlib.PurePosixPath(remote).suffix.lower() or ".txt"
    return f"{fallback}_{stem}{suffix}"


def text_norm(value: str) -> str:
    return " ".join(re.findall(r"[\w]+", value.casefold(), flags=re.UNICODE))


def create_pack(row: dict) -> dict:
    code, unit_id = row["course_code"], row["unit_id"]
    cor = CORPUS_BY.get(code, {})
    corpus_unit = next((u for u in cor.get("units", []) if u["id"] == unit_id), None)
    course_title = row["course_title"]
    unit_title = row["official_title"]
    project = ROOT / "study-materials/packs" / code / unit_id
    if project.exists():
        shutil.rmtree(project)
    (project / "sources").mkdir(parents=True)
    (project / "figures").mkdir()
    (project / "work").mkdir()
    (project / "work/brief.md").write_text(
        f"# PDF Study Forge brief\n\n"
        f"- Requested scope: source-preserving study material for all available videos, slide decks, and candidate-matched archive pages in {course_title}, {unit_id} ({unit_title}).\n"
        f"- Explicit exclusions: no unsupported video-to-slide assignment; no unverified formula correction or newly authored answer; missing bucket unit sources are reported as a gap.\n"
        f"- Audience: PESU first-year students.\n"
        f"- Required sources: official Hugging Face PESU_Materials bucket files, transcript sidecars, extracted slide text, original slide renders, official unit catalogue, and selected archive pages.\n"
        f"- Required sections: one complete unit master, grouped by video lesson and slide page, with source references and datasets.\n"
        f"- Deliverables: master PDF and standalone HTML, canonical pack.json, and reusable source datasets.\n"
        f"- Assumptions: this is a visibly labelled draft until human page-level semantic and visual review is complete.\n",
        encoding="utf-8",
    )
    P = Pack(project, code, unit_id, unit_title, course_title, row)

    # Official catalogue evidence makes every course unit visible, including missing folders.
    catalogue_remote = "pesuc/PESU_Materials/units.json"
    cat_entry = MAN_BY.get(catalogue_remote)
    if cat_entry:
        meta_local = copy_remote(catalogue_remote, project, "sources/official-unit-catalogue.json")
        meta_src = P.register_source(catalogue_remote, "Official unit catalogue", meta_local, "sources/official-unit-catalogue.json", "text", ["catalogue"], "Official course/unit title and index.")
    else:
        meta_payload = {"course_code": code, "unit_id": unit_id, "official_title": unit_title, "unit_catalogue_id": row.get("unit_catalogue_id")}
        meta_local = project / "sources/official-unit-catalogue.json"
        meta_local.write_text(json.dumps(meta_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        meta_src = P.register_source("PESU_Materials/units.json (catalogue row in datasets/unit-catalogue.json)", "Official unit catalogue row", meta_local, "sources/official-unit-catalogue.json", "text", ["catalogue"], "Official course/unit title and index.")

    source_topic_title = f"{code} · {unit_id}: {unit_title}"
    overview_bits = [f"This unit master organizes source material for {course_title}, {unit_id}, officially titled {unit_title}."]
    if row["bucket_folder_present"]:
        overview_bits.append(f"It includes {row['video_count']} video transcripts and {row['slide_deck_count']} source slide decks, with page-level text and rendered images where available.")
    else:
        overview_bits.append("The official catalogue includes this unit, but the current course bucket has no matching unit folder or unit-specific lecture files.")
    overview_bits.append("This draft preserves source wording and page order; it does not claim a complete human subject review or full audiovisual review.")
    main_topic = P.topic(source_topic_title, " ".join(overview_bits))
    metadata_note = f"Official catalogue entry: {code}, {unit_id} ({unit_title}). Bucket folder present: {'yes' if row['bucket_folder_present'] else 'no'}. Videos: {row['video_count']}; slide decks: {row['slide_deck_count']}."
    if not row["bucket_folder_present"]:
        metadata_note += " No unit-specific current lecture sources are present in the bucket."
        P.gaps.append(f"{unit_id} is listed in the official catalogue but has no matching source folder in PESU_Materials.")
    ev_meta = P.add_evidence(meta_src, "catalogue", "Unit title and index copied from the official units.json catalogue; human content review is pending.", [main_topic], reviewed=False)
    P.add_topic_source(main_topic, ev_meta)
    P.add_note(main_topic, metadata_note, [ev_meta])

    total_figs_by_topic = collections.Counter()
    video_topics = {}
    deck_topics = {}
    deck_by_path = {d["path"]: d for d in (corpus_unit or {}).get("slide_decks", [])}
    videos = (corpus_unit or {}).get("videos", [])
    assigned_decks = {v["matched_slide"] for v in videos if v.get("matched_slide")}

    # Full timestamped transcripts and all four source variants for every video.
    for vi, video in enumerate(videos, 1):
        vid = video["id"]
        match = video.get("matched_slide")
        match_status = "high/likely" if match else "unassigned"
        if match and any(x["path"] == match for x in video.get("slide_match_candidates", [])[:1]):
            match_status = "candidate; see slide match report"
        overview = (f"This lesson is indexed from the source video titled {video['title']}. Its complete timestamped transcript is preserved below in segment order. "
                    "The original video path and content hash are recorded in datasets/lecture-corpus.json. Transcript text is source wording; it has not been silently corrected or rewritten.")
        if match:
            overview += " A candidate slide deck is grouped here according to the current matching score; the exact path and page locators are listed in the source evidence."
        else:
            overview += " No slide deck is assigned to this video; candidate slide sources remain separate in the unit master."
        topic_id = P.topic(video["title"], overview)
        video_topics[vid] = topic_id
        groups = interval_groups(video.get("transcript_segments", []))
        if not groups:
            groups = [("empty", [])]
        group_keys = [x[0] for x in groups]
        variant_sources = {}
        variant_names = {"transcript_json": "JSON", "transcript_md": "Markdown", "transcript_txt": "plain text", "srt": "SRT"}
        ext = {"transcript_json": ".transcript.json", "transcript_md": ".transcript.md", "transcript_txt": ".transcript.txt", "srt": ".srt"}
        for kind, variant in video.get("transcript_variants", {}).items():
            remote = variant["source"]["bucket_path"]
            local_rel = f"sources/transcripts/{source_filename(remote, vid)}"
            local = copy_remote(remote, project, local_rel)
            src_id = P.register_source(remote, f"{video['title']} transcript ({variant_names.get(kind, kind)})", local, local_rel, "transcript", group_keys, f"Full {variant_names.get(kind, kind)} sidecar. Normalized text similarity to canonical JSON: {variant['similarity_to_json']:.4f}; only the JSON segmentation supplies the displayed timestamps.")
            variant_sources[kind] = src_id
        group_evidence_ids = []
        for group_idx, (group_key, segments) in enumerate(groups, 1):
            lines = []
            for segment in segments:
                stamp = segment.get("timestamp") or display_time(float(segment.get("start", 0) or 0))
                flag = " [ASR low confidence; check audio]" if segment.get("avg_logprob") is not None and segment["avg_logprob"] < -0.5 else ""
                lines.append(f"[{stamp}]{flag} {segment.get('text', '')}")
            block = "\n".join(lines) if lines else "No transcript segments are present in the canonical sidecar."
            note_id = P.new_id("N")
            note = {"id": note_id, "topic": topic_id, "srcs": [], "text": safe(f"Transcript block {group_idx} (source interval {group_key[1:]} seconds):\n{block}")}
            P.notes.append(note)
            for kind, src_id in variant_sources.items():
                simval = video["transcript_variants"][kind]["similarity_to_json"]
                ev = P.add_evidence(src_id, group_key, f"Timestamp interval {group_key}; canonical segment IDs {segments[0]['id'] if segments else 'none'} to {segments[-1]['id'] if segments else 'none'}. Sidecar variants compare at similarity {simval:.4f}; verbatim transcript text is included in the linked note. This is a source-coverage check, not an audiovisual fact check.", [topic_id, note_id], reviewed=False)
                note["srcs"].append(ev)
                P.add_topic_source(topic_id, ev)
                group_evidence_ids.append(ev)
        summary = f"Full transcript: {video['word_count']} normalized words, {video['segment_count']} timestamped segments, {video['duration_seconds']} seconds duration. Low-confidence segments flagged: {video['low_confidence_segments']}."
        if video["low_confidence_segments"]:
            summary += " Review locators: " + ", ".join(video["low_confidence_locators"])
        P.add_note(topic_id, summary, group_evidence_ids[:len(variant_sources)])

    # Attach a confident video-slide match to its lesson. Keep the 16 review candidates separate.
    for deck_path, deck in deck_by_path.items():
        matching_video = next((v for v in videos if v.get("matched_slide") == deck_path), None)
        if matching_video:
            deck_topics[deck_path] = video_topics[matching_video["id"]]
        else:
            deck_topics[deck_path] = P.topic(
                f"Source slide deck: {deck['title']}",
                f"This entry preserves the complete slide deck titled {deck['title']} as searchable extracted page text and page-faithful rendered images. Its association with a particular video is not confirmed; it remains a separate topic under {course_title}, {unit_id}, to avoid an unsupported match.",
            )

    # Register every slide text file and its converted page source; each page gets its own point and figure citation.
    for di, (deck_path, deck) in enumerate(deck_by_path.items(), 1):
        topic_id = deck_topics[deck_path]
        remote_text = deck["path"]
        md_entry = MAN_BY.get(remote_text)
        text_source_id = None
        markdown_count = len(deck.get("pages", []))
        variant_pages = deck.get("text_variant_pages", [])
        variant_count = len(variant_pages)
        variant_source_id = None
        if md_entry:
            md_rel = f"sources/slide-text/{source_filename(remote_text, 'SLIDE')}.md"
            md_local = copy_remote(remote_text, project, md_rel)
            text_source_id = P.register_source(remote_text, f"Slide page text: {deck['title']}", md_local, md_rel, "slides", [f"p{i}" for i in range(1, markdown_count + 1)], "Complete extracted page text from the bucket's .slides.md sidecar.")
        variant_remote = deck.get("text_variant_path")
        variant_entry = MAN_BY.get(variant_remote) if variant_remote else None
        if variant_entry:
            variant_rel = f"sources/slide-text-variants/{source_filename(variant_remote, 'SLIDEVAR')}.txt"
            variant_local = copy_remote(variant_remote, project, variant_rel)
            variant_source_id = P.register_source(variant_remote, f"Alternate extracted slide page text: {deck['title']}", variant_local, variant_rel, "text", [f"p{i}" for i in range(1, variant_count + 1)], "The bucket's alternate .slides.txt text sidecar; content differences are kept as separate page points.")

        render_rec = RENDER_BY.get(deck.get("deck_path")) if deck.get("deck_path") else None
        rendered_pdf_source_id = None
        rendered_pages = render_rec.get("pages", []) if render_rec and render_rec.get("status") == "ok" else []
        rendered_pdf = ROOT / render_rec["converted_pdf"] if render_rec and render_rec.get("converted_pdf") else None
        page_count = render_rec.get("page_count", 0) if render_rec else 0
        if rendered_pdf and rendered_pdf.is_file() and page_count:
            deck_local_rel = f"sources/rendered-decks/{source_filename(deck.get('deck_path', deck_path), 'DECK')}.pdf"
            deck_local = project / deck_local_rel
            deck_local.parent.mkdir(parents=True, exist_ok=True)
            if rendered_pdf.resolve() != deck_local.resolve():
                shutil.copyfile(rendered_pdf, deck_local)
            original_remote = deck.get("deck_path")
            orig_hash = (MAN_BY.get(original_remote) or {}).get("sha256")
            rendered_pdf_source_id = P.register_source(original_remote, f"Page-render source for {deck['title']} (converted PDF; original hash {orig_hash or 'recorded in inventory'})", deck_local, deck_local_rel, "pdf" if pathlib.PurePosixPath(original_remote).suffix.lower() == ".pdf" else "slides", [f"p{i}" for i in range(1, page_count + 1)], "Page inventory and visual source for the rendered original deck; figure pages are derived from this local PDF. The original bucket path/hash are retained in datasets/content-index.json.")
        else:
            P.gaps.append(f"Slide deck render unavailable: {deck_path} (text extract remains included).")

        text_by_page = {x["page"]: x["text"] for x in deck.get("pages", [])}
        render_pages_by_no = {x["page"]: x for x in rendered_pages}
        variant_by_page = {x["page"]: x["text"] for x in variant_pages}
        total_pages = max(markdown_count, variant_count, page_count)
        for page_no in range(1, total_pages + 1):
            point_id = P.new_id("P")
            figure_id = None
            visual_ev = None
            text_ev = None
            if text_source_id and page_no <= markdown_count:
                text_ev = P.add_evidence(text_source_id, f"p{page_no}", f"Extracted slide page {page_no} from {remote_text}; original page is also embedded when the source render is available. Human subject review is pending.", [topic_id], reviewed=False)
                P.add_topic_source(topic_id, text_ev)
            if rendered_pdf_source_id and page_no <= page_count:
                figure_id = P.new_id("G")
                render_item = render_pages_by_no.get(page_no)
                svg_source = ROOT / render_item["svg"] if render_item else None
                if svg_source and svg_source.is_file():
                    fig_rel = f"figures/{figure_id}.svg"
                    fig_dest = project / fig_rel
                    shutil.copyfile(svg_source, fig_dest)
                    visual_ev = P.add_evidence(rendered_pdf_source_id, f"p{page_no}", f"Original slide page {page_no} rendered from {deck.get('deck_path')}; visual page included as vector figure. Human layout/content review is pending.", [topic_id, figure_id], reviewed=False)
                    P.add_topic_source(topic_id, visual_ev)
                    title = f"{deck['title']} · source slide page {page_no}"
                    alt = f"Rendered source slide page {page_no} from {deck['title']}; page-faithful vector image."
                    howto = "Use this original slide page to inspect formulas, diagrams, layout and any text extraction gaps. The original deck path and hash are recorded in its source metadata."
                    P.figures.append({"id": figure_id, "topic": topic_id, "srcs": [visual_ev], "title": safe(title), "file": fig_rel, "alt": safe(alt), "howto": safe(howto)})
                    total_figs_by_topic[topic_id] += 1
                else:
                    figure_id = None
                    P.add_evidence(rendered_pdf_source_id, f"p{page_no}", f"Rendered page {page_no} is listed but its SVG preview is missing.", [], reviewed=False, status="gap", reason="Renderer did not produce the expected page image.")
            page_text = text_by_page.get(page_no, "")
            variant_text = variant_by_page.get(page_no, "")
            same_text = bool(page_text.strip() and variant_text.strip() and text_norm(page_text) == text_norm(variant_text))
            variant_ev = None
            variant_point_id = point_id
            if variant_source_id and page_no <= variant_count:
                if page_text.strip() and variant_text.strip() and not same_text:
                    variant_point_id = P.new_id("P")
                similarity = "normalized text matches the .slides.md page" if same_text else "text differs from or is absent in the .slides.md page; alternate text is preserved separately"
                variant_ev = P.add_evidence(variant_source_id, f"p{page_no}", f"Alternate extracted slide text page {page_no}; {similarity}. Human comparison is pending.", [topic_id], reviewed=False)
                P.add_topic_source(topic_id, variant_ev)
            if not page_text.strip() and variant_text.strip():
                page_text = variant_text
            if page_text.strip():
                point_text = f"Source slide page {page_no} (extracted text):\n{page_text.strip()}"
            else:
                point_text = f"Source slide page {page_no}: no readable `.slides.md` text was extracted."
                if figure_id:
                    point_text += " The original rendered page is included as the adjacent source figure for visual inspection."
                else:
                    point_text += " No source text or rendered page image is available for this page."
            citations = [x for x in (text_ev, visual_ev, variant_ev if variant_point_id == point_id else None) if x]
            P.points.append({"id": point_id, "topic": topic_id, "srcs": citations, "text": safe(point_text)})
            for ev_id in citations:
                P.evidence_by_id(ev_id)["items"].append(point_id)
            if variant_point_id != point_id:
                variant_point_text = f"Alternate text variant from {pathlib.PurePosixPath(variant_remote).name}, page {page_no}:\n{variant_text.strip()}"
                P.points.append({"id": variant_point_id, "topic": topic_id, "srcs": [variant_ev], "text": safe(variant_point_text)})
                P.evidence_by_id(variant_ev)["items"].append(variant_point_id)
        if variant_source_id and variant_count != markdown_count:
            P.gaps.append(f"Alternate .slides.txt text sidecar has {variant_count} page headings while .slides.md has {markdown_count}; both versions are preserved and mapped by locator where available.")
        missing_text_pages = [n for n in range(1, page_count + 1) if not text_by_page.get(n, "").strip()]
        if missing_text_pages:
            P.gaps.append(f"{len(missing_text_pages)} rendered pages in {pathlib.PurePosixPath(deck_path).name} have no readable `.slides.md` text; their original page images are included.")
        if not any(n["topic"] == topic_id for n in P.notes):
            relevant = [x for x in P.evidence if x["items"] and topic_id in x["items"]]
            if relevant:
                first = relevant[0]
                P.add_note(topic_id, f"Source deck preserved: {deck['title']}. Its extracted page text is listed as searchable points and all rendered source pages are attached as figures. Match to a specific video is {'candidate-based' if not matching_video else 'score-based'}; this index does not claim a manual content review.", [first["id"]])
            else:
                P.add_note(topic_id, f"Source deck preserved: {deck['title']}. No page text or rendered page evidence was available for this deck.", [ev_meta])
        P.set_requirements(topic_id, total_figs_by_topic[topic_id])

    # Include only historical archive pages with a strong unit-level text match; all other pages remain in the archive dataset.
    matched_qs = [q for q in QUESTIONS["sources"] if q["course_code"] == code and q.get("page") is not None and any(m["unit_id"] == unit_id and m["confidence"] == "candidate" for m in q.get("unit_candidate", []))]
    if matched_qs:
        q_topic = P.topic(
            f"Historical question-source pages · unit mapping candidates",
            f"This section preserves historical paper/question-bank pages whose extracted terms matched {course_title}, {unit_id} ({unit_title}) above the dataset's candidate threshold. The association has not been manually confirmed, source text/OCR may be incomplete, and the pages are not rewritten or presented as solved questions.",
        )
        grouped = collections.defaultdict(list)
        for q in matched_qs:
            grouped[q["source"]["bucket_path"]].append(q)
        for qi, (remote, pages) in enumerate(sorted(grouped.items()), 1):
            payload = {"source": pages[0]["source"], "pages": [{"page": q["page"], "text": q.get("text", ""), "text_chars": q.get("text_chars"), "ocr_text_chars": q.get("ocr_text_chars"), "sparse": q.get("sparse"), "unit_candidate": q.get("unit_candidate")} for q in pages]}
            q_rel = f"sources/archive/{source_filename(remote, 'QUESTION')}.json"
            q_local = project / q_rel
            q_local.parent.mkdir(parents=True, exist_ok=True)
            q_local.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
            q_units = [f"q{q['page']}" for q in pages]
            q_src = P.register_source(remote, f"Extracted historical pages: {pathlib.PurePosixPath(remote).name}", q_local, q_rel, "text", q_units, "Candidate-matched page text excerpt; original PDF bytes, hash and path remain in datasets/question-archive.json.")
            for q in pages:
                point_id = P.new_id("P")
                unit_cand = q.get("unit_candidate", [{}])[0]
                prefix = f"Archive page {q['page']} from {pathlib.PurePosixPath(remote).name}; unit match candidate score {unit_cand.get('score')}; source text/OCR may be partial."
                body = q.get("text") or "No text was extracted for this page. Compare the original PDF linked in datasets/question-archive.json."
                if q.get("sparse"):
                    prefix += " OCR/sparse page: visual confirmation is required."
                P.points.append({"id": point_id, "topic": q_topic, "srcs": [], "text": safe(prefix + "\n" + body)})
                ev = P.add_evidence(q_src, f"q{q['page']}", f"Original archive PDF page {q['page']}; candidate unit association is text-based and unconfirmed.", [q_topic, point_id], reviewed=False)
                P.points[-1]["srcs"].append(ev)
                P.add_topic_source(q_topic, ev)
        first_q_ev = next(e["id"] for e in P.evidence if e["source"] in P.source_by_remote.values() and q_topic in e["items"])
        P.add_note(q_topic, f"{len(matched_qs)} historical archive pages are included as question-source references. Inspect the original paper before relying on OCR or unit placement; no answers are newly authored here.", [first_q_ev])
        P.set_requirements(q_topic, 0)
    else:
        P.gaps.append("No historical archive question page met the unit-match candidate threshold; all subject-level and ambiguous pages remain in datasets/question-archive.json.")

    # Complete topic evidence lists and source pack metadata.
    for topic in P.topics:
        topic["srcs"] = list(dict.fromkeys(topic["srcs"]))
        # Source-based notes also cite the evidence used for their source description.
        if topic["requirements"]["FIGS"] == {"not_applicable": "No rendered source slide page is available for this topic; the corresponding text extract remains in the master."} and total_figs_by_topic[topic["id"]]:
            P.set_requirements(topic["id"], total_figs_by_topic[topic["id"]])

    # Page-level links stay on the point, note, or figure they support. Keep
    # only two concise source chips on each topic overview and make those links
    # reciprocal in the evidence table.
    topic_sources = {t["id"]: set(t["srcs"]) for t in P.topics}
    for ev in P.evidence:
        ev["items"] = [item for item in ev["items"] if item not in topic_sources or ev["id"] in topic_sources[item]]
        if ev["status"] == "covered" and not ev["items"]:
            raise ValueError(f"Source unit {ev['id']} has no linked point, note, figure, or topic")

    ambiguous_videos = [v for v in videos if v.get("matched_slide") is None]
    if ambiguous_videos:
        P.gaps.append(f"{len(ambiguous_videos)} video-to-slide associations were not promoted to a match. Candidate rankings are listed in the transcript corpus and video-slide-matches.csv; the slide decks appear separately.")
    low_conf = sum(v["low_confidence_segments"] for v in videos)
    if low_conf:
        P.gaps.append(f"{low_conf} transcript segments have low ASR confidence; they are flagged with timestamps in the transcript blocks and indexed in the corpus.")
    if not row["bucket_folder_present"]:
        P.gaps.append("No current video or slide materials were available for this catalogue-only unit; archive excerpts appear only when the unit-match candidate is strong.")
    P.gaps.extend([
        "This is a visibly labelled source-preservation draft. Human page-level semantic and visual review is not complete; no unsupported subject summary or formula correction is claimed.",
        "The 19.26 GiB MP4 files remain hosted on Hugging Face; the full video path/hash and transcript coverage are indexed. The full audio/video was not watched end-to-end.",
        "Formula candidates are machine-extracted text with source locators; use the adjacent original slide page and the formula index before treating a candidate as an authoritative equation.",
    ])

    pack = {
        "schema_version": "1.0",
        "PACK": {
            "course": course_title,
            "unit": f"{unit_id} · {unit_title}",
            "scope": f"All source videos, transcript sidecars, slide decks/pages, and confidently mapped historical question-source pages available for {course_title}, {unit_id} ({unit_title}); missing bucket material is reported as a gap.",
            "title": f"{code} · {unit_id} — {unit_title} · Complete Unit Master",
            "subtitle": "Source-complete searchable master · transcript, slide text, page visuals and archive references",
            "slug": slug(f"{code}-{unit_id}-{unit_title}"),
            "header": f"{code} · {unit_id}",
            "date": "18 October 2026",
            "compiled_from": "Hugging Face PESU_Materials source tree, official units.json catalogue, transcript sidecars, slide text/PDF/PPT sources and the selected First_Year_8enterprise archive; see the provenance datasets in the release ZIP.",
            "how_to_use": "Search this single unit master by lesson, timestamp, slide text or source page. Read the transcript in timestamp order, then compare extracted slide text with its page-faithful source figure. Formula candidates and archive question mappings are explicitly flagged for review.",
            "pyq_note": "Historical question-source excerpts are shown only when a page has a strong text-based unit match. They are source references, not new solutions or exam predictions.",
            "figure_note": "Source figures are full-page renderings of the original slide deck pages. Their exact page text appears separately for search and copying; image-only pages are labelled.",
            "symbols_remark": "No formula candidate is asserted as mathematically verified solely from OCR/transcript text. See datasets/content-index.json for raw candidates and source locators.",
            "coverage_note": "This master retains the source content and provenance for the official unit. It is a DRAFT pending human page-level review; see PACK.gaps and the QA report.",
            "tag_legend": [["Source text", "Verbatim or OCR-derived text, kept separate from editorial notes."], ["Candidate", "Automated topic/source association requiring manual confirmation."], ["Low ASR confidence", "Transcript segment requires audio verification."], ["DRAFT", "Human review remains incomplete."]],
            "sources": P.sources,
            "gaps": list(dict.fromkeys(P.gaps)),
            "asr_forbidden": ["Formula-like ASR text is not an authoritative equation until compared with the slide page."],
            "topic_order": P.topic_order,
            "documents": ["master"],
        },
        "MODULES": [{"id": "M1", "title": safe(f"{unit_id} · {unit_title}"), "topics": P.topic_order}],
        "TOPICS": P.topics,
        "DEFS": [], "STATEMENTS": [], "POINTS": P.points, "WHY": [], "TRAPS": [], "FORMULAS": [], "SYMBOLS": [], "WORKED": [], "PYQS": [], "NOTES": P.notes,
        "KEYWORDS": [], "RAPID": [], "TOP_FACTS": [], "TOP_FORMULAS": [], "FIGS": P.figures, "FLOWS": [], "COMPARISONS": [], "MNEMONICS": [], "DERIVATIONS": [], "PRACTICE": [],
        "EVIDENCE": P.evidence,
        "CHECKS": [],
    }
    pack_path = project / "pack.json"
    pack_path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    summary = {
        "course_code": code, "unit_id": unit_id, "official_title": unit_title,
        "bucket_folder_present": row["bucket_folder_present"], "videos": len(videos), "slide_decks": len(deck_by_path),
        "slide_text_pages": sum(len(d.get("pages", [])) for d in deck_by_path.values()),
        "slide_figures": len(P.figures), "topics": len(P.topics), "notes": len(P.notes), "points": len(P.points),
        "formula_candidates_in_course_unit": sum(1 for f in INDEX["formula_candidates"] if f.get("course_code") == code and f.get("unit_id") == unit_id),
        "question_pages_candidate_mapped": len(matched_qs), "evidence_units": len(P.evidence),
        "sources": len(P.sources), "pack_path": str(pack_path.relative_to(ROOT)), "gap_count": len(P.gaps),
        "video_topics": [{"video_id": v["id"], "topic_id": video_topics[v["id"]], "title": v["title"]} for v in videos],
    }
    (project / "work/pack-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def main() -> None:
    rows = CATALOGUE["units"]
    summaries = []
    for i, row in enumerate(rows, 1):
        summary = create_pack(row)
        summaries.append(summary)
        print(f"[{i}/{len(rows)}] assembled {summary['course_code']} {summary['unit_id']}: {summary['topics']} topics, {summary['slide_figures']} slide figures, {summary['evidence_units']} evidence units", flush=True)
    out = ROOT / "study-materials/work/unit-pack-index.json"
    out.write_text(json.dumps({"schema_version": "1.0", "unit_count": len(summaries), "packs": summaries}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(summaries)} unit pack projects to {out}")


if __name__ == "__main__":
    main()
