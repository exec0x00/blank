# Source intake

## Local files

Preserve originals and original filenames. Inventory every file and every source unit. Keep output/work directories outside the source root so they cannot accidentally become evidence. Hash identity detects exact duplicates; inspect near-duplicate questions and differing scan editions before deduplicating conceptually.

Render PDFs and office files with `sources.py render`. Image-only or sparse pages are listed in `render-report.json`; inspect them visually. OCR is an aid, not an authority for a formula. Office rendering can corrupt embedded/OLE equations: compare with a reliable PDF export or the lecture/video. Preserve the competing readings and explain the correction. Do not silently copy a suspected source error or invent unreadable content.

`PDF_FORGE_PASSWORD` is only for a password already supplied by the user/material. Render/decrypt a working copy and inventory that PDF; retain the original provenance. The tool does not recover passwords.

## Hugging Face buckets

A bucket is not a model/dataset repository. These helpers use the bucket HTTP API:

```bash
python3 "$SKILL_DIR/scripts/hf_ls.py" "https://huggingface.co/buckets/OWNER/NAME/tree/PATH" --json
python3 "$SKILL_DIR/scripts/hf_ls.py" "OWNER/NAME:PATH" --grep 'pattern'
python3 "$SKILL_DIR/scripts/hf_get.py" "OWNER/NAME" "$PROJECT/sources" "PATH/to/a lecture.pdf" "PATH/to/a transcript.md"
```

The listing follows pagination. Downloads retain full relative paths, validate content length when supplied, use atomic `.part` files, and create a hash manifest. Duplicate basenames in different folders cannot overwrite one another. A failed request exits unsuccessfully; do not continue as if the file existed. Credentials, if required, should be handled by the host's approved connection/configuration; do not put credentials in URLs or reports.

In the audited PESU repository, the source bucket was `alvin3y10/data`, usually under `pesuc/PESU_Materials/Sem-1/<course>/Unit_0N`. That is historical context, not a default source for an unrelated user task. Session prefixes and `DOWNLOAD_MANIFEST` can identify order and multipart lectures. `FAILED_VIDEOS` reports missing material. Older community slide/CW/paper folders can differ from the current syllabus.

## Evidence priorities

- Read rendered slide images for equations and diagrams. `.slides.md` may contain a title with the actual equation missing.
- Read complete transcript intervals and their timestamps. Scan low-confidence ASR segments, but do not assume confidence alone proves correctness.
- Use corrected terminology only when the slide, a clear recording, or another reliable source supports it. Examples from this repo include Beer–Lambert, Clairaut and Franck–Condon. Never guess a person's name from noisy speech.
- Verify every worked answer and significant intermediate line independently. Both slides and answer keys can be wrong.
- For old papers, inspect continuation pages, exact question wording, marks and printed date. Deduplicate repeated papers before counting appearances.
- A current lecture's scope takes precedence over an older syllabus unless the user explicitly requests extensions. Label older examinable material honestly.
- In a contradiction, preserve both claims in the work notes, resolve through reasoning/evidence, and cite the decision in the final pack. Source wording does not justify teaching a known error as fact.

## Videos and unavailable sources

Read the whole relevant segment when the user asks for video coverage. Otherwise use video to resolve a specific logged uncertainty: an unreadable formula, transcript-only content, ambiguous speech, a missing diagram or an empty slide. Record video filename, timestamps, reason and which item changed. A frame grab only supports that frame's content.

For a local video, an optional command is:

```bash
ffmpeg -ss 00:07:45 -i "$PROJECT/sources/lecture.mp4" -frames:v 1 "$PROJECT/work/frame-00745.png"
```

Do not automatically download every large video for a text task. Do not claim “all sources reviewed” if a requested video is unavailable. Represent unavailable required material as a structured gap; a visibly marked draft may still be useful. Sources and figure rights are task-specific; preserve attribution and avoid inventing measurements when redrawing an illustration.
