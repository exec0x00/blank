# Sources: where the material is and how to read it

## The Hugging Face bucket

The bucket is `alvin3y10/data`. It is a **bucket**, not a model or dataset repo, so `hf_hub_download` and `huggingface_hub` do not work. Use plain HTTP:

- **List.** `GET https://huggingface.co/api/buckets/alvin3y10/data/tree/<url-encoded path>?recursive=true&limit=1000`. Follow the `Link: <…>; rel="next"` header until it is absent. This is `scripts/hf_ls.py`.
- **Download.** `GET https://huggingface.co/buckets/alvin3y10/data/resolve/<url-encoded path>` with redirects followed. This is `scripts/hf_get.py`.
- **URL encoding.** URL-encode every path. They contain spaces, `&`, `+` and `[`: `Math 1/CW/Math_Unit1&2_CW__….pdf`.
- **Accepted inputs.** The user may give a browser URL like `https://huggingface.co/buckets/alvin3y10/data/tree/pesuc`. `hf_ls.py` accepts that form directly, or `alvin3y10/data:pesuc/...`.
- **Local folders.** If the user points at a local folder instead, use it as the source root and skip the download step. The layout below still applies.

## Layout (as of Oct 2026)

```
pesuc/
  PESU_Materials/
    DOWNLOAD_MANIFEST.csv/.json, FAILED_VIDEOS.md/.csv, SUMMARY.json, README.md
    Sem-1/
      UE26MA141A_Engineering_Mathematics_-_I/      (also: UE26CY151A Chemistry, UE26CS151A Python,
        ALL_SLIDE_TEXT.md, ALL_VIDEO_TRANSCRIPTS.md      UE26EC141A Electronics, UE26ME142A Mechanics,
        Unit_01/                                          UC26CE121A Constitution/Cyber/IP law)
          Slides/NNN_<title>__<hash>.pptx | .slides.md | .slides.txt
          AV_Summaries/NNN_<title>__<hash>.mp4 | .transcript.md | .transcript.json | .srt | .transcript.txt
        Unit_02/ …
  First_Year_8enterprise/            ← older, community material. PASSWORD.txt says: 8enterprise
    DOWNLOAD_MANIFEST.csv, SHA256SUMS.txt, SOURCES.md, WEB_REFERENCES.md, First_Year_Materials.zip
    Files/<Subject>/
      Slides/       consolidated unit PDFs (older syllabus; good for equations the .pptx loses)
      CW/           class-work sheets WITH ANSWERS (e.g. Math 1/CW/Math_Unit1&2_CW__….pdf)
      Extra/        revision notes, extra questions, extra topics
      Papers/ESA Papers/<course or year>/…pdf   past end-semester papers (+ Answers/ for some)
```

Subject folder names under `First_Year_8enterprise/Files/`:

| Folder | Subject |
|---|---|
| `Math 1`, `Math 2` | Mathematics |
| `Chemistry` | Chemistry |
| `C Language` | C programming |
| `EVS` | Environmental science |
| `MES` | Mechanical engineering science |

Others exist. List them with `hf_ls.py … --dirs`.

**Mapping sessions.** The file prefix `NNN_` is the class or session number within the unit. A session can have several AV parts (`009_…Part_I`, `…Part_II`), or several parts with no order in the filename; then `DOWNLOAD_MANIFEST.csv` gives the order. Some decks have no video, and some videos failed to download: check `FAILED_VIDEOS.md` and record every gap.

## What each format is good for

| Format | Use it for | Watch out for |
|---|---|---|
| `.pptx` rendered to PNG (`render_slides.sh`) | **Equations and diagrams.** Read the images with the Read tool, as contact sheets via `sheet.py`. | LibreOffice sometimes garbles an equation. Then go to the PDF, then a video frame. |
| `.slides.md` / `.slides.txt` | Slide text with slide numbers. Diff the two and keep anything that appears in only one. | Equations are missing or broken into OCR fragments; diagram labels are noise (`9610` means 961 °C). |
| `.transcript.md` | Reading, with `[hh:mm:ss.mmm]` stamps for citations | ASR errors (see `lessons.md`) |
| `.transcript.json` | `segments[].start` to choose the second for a frame grab; `avg_logprob < −0.5` marks doubtful passages | |
| `.srt` | Exact second a phrase is spoken | |
| `.transcript.txt` | Grep for emphasis: important, remember, note that, exam, must, never | |
| `.mp4` | **Only on a logged gap**, via `grab_frame.sh` (remote seek, no download) | ~150 MB each. Never download for "completeness". |
| Consolidated slide PDF (8enterprise) | Cross-check equations; extra derivations | Older syllabus: flag what is not on the current slides |
| CW sheets | Worked problems **with answer keys**; use them to check your own answers | `pdftotext` garbles superscripts and fractions. Skip any problem you cannot read unambiguously. |
| ESA papers | Importance ranking (ESA stars) and past-paper questions | The questions are **images**, so `pdftotext` gives only headers. Render pages at 90 dpi, view them 2×2 and read them. Headers can carry the wrong year. Papers repeat: dedupe before counting. |
| `ALL_SLIDE_TEXT.md` / `ALL_VIDEO_TRANSCRIPTS.md` | Final check that nothing in scope was missed | Large; grep the relevant section |

## Video triggers (open a video only for one of these)

1. An equation is unreadable on the rendered slide and in the PDF.
2. The transcript discusses content that is on no slide, and you need its exact form.
3. A low-confidence ASR passage covers a term, number or formula that the slides do not settle.
4. A required diagram has no reference anywhere.
5. A slide is empty in every format but the transcript shows it was being taught.

Wanting to check emphasis or "completeness" is not a trigger. Budget: about 10 frames per gap. Escalate to a full download only if about 3 targeted grabs fail.
