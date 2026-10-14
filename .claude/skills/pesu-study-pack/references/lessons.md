# Lessons learned (findings and mistakes from earlier packs)

Read this before starting. Every item cost a rebuild at least once.

## Sources and extraction

1. **The bucket is not a repo.** `hf_hub_download` fails; use the HTTP API in `hf_ls.py` / `hf_get.py`. Paths contain spaces and `&`, so always URL-encode them.
2. **`.slides.md` has no equations.** OLE equations come through as fragments (`𝛛𝑓 … 𝛛𝑥`) or not at all. Render every deck and read the images. In the Chemistry deck 005, "The oscillation frequency is given by," had nothing after it.
3. **LibreOffice can garble an equation** (Chemistry deck 009 slide 5, the chemical potential). Fallback order: rendered slide → consolidated PDF (`pdftotext -layout`) → one video frame.
4. **Diagram text in OCR is noise**: `9610` means 961 °C, `Wavelength（K)` is λ. Always describe a graph from the image.
5. **Past-paper questions are images.** `pdftotext` returns only "1.a. (7.0 Marks)". Render at 90 dpi and view 2×2 per sheet. At 60 dpi the maths is unreadable.
6. **Paper metadata lies.** The UE23MA141A papers were headed "JAN 2023" but printed in 2024. Papers are often duplicated (Chemistry June 2024 sets 1/4/6 were identical). Dedupe before you count how often a topic is asked.
7. **The deck title can promise content the deck lacks.** The maths deck 002 is titled "…, Problems on partial derivatives" but has no problem slides, and the transcript defers them. Take problems from the CW sheets and ESA papers, and record the gap.
8. **A deck often includes an adjacent subtopic** (deck 002 opens with higher-order partials). Include what the deck covers, even when the user names a narrower topic, and say so.
9. **CW sheet text is garbled** (superscripts split; `log(x − y)` was ambiguous). Use a problem only when it is unambiguous, and check against its printed answer.
10. **Never guess a name.** The transcript said "Ultra Am lab" for a demo tool, and neither the frame nor the slide named it. I nearly wrote "Wolfram". Describe it generically and log it as a gap.
11. **ASR errors seen so far** (correct them silently, list them in `PACK["gaps"]`, put the raw strings in `asr_forbidden`):
    - Maths: "geometally" → geometrically, "Z1" → z_y, "impartial derivatives" → in partial derivatives, "Claret theorem" → Clairaut's theorem, "jowl" → jolt, "dou" → ∂ (spoken), "ZX/Zy" → z_x/z_y.
    - Chemistry: "BL Ambert" → Beer–Lambert, "Glossier's Claperon", "Clausius Clabron" → Clausius–Clapeyron, "rally scattering" → Rayleigh, "Homo to the lumon" → HOMO → LUMO, "digit rotor" / "rigid rotar" → rigid rotor, "Frank Condon" → Franck–Condon, "DP by Dt" → dP/dT.
12. **Loose statements by the instructor.** Example: "the gradient gives the slope in any direction". Keep their wording in the statement, and add the precise version (directional derivative ∇f·û) flagged *added for clarity*.
13. **Syllabus drift.** Older PDFs and papers may cover topics missing from the current slides (Beer–Lambert, Fe–C diagram). Put them in a short, flagged "possibly examinable, not in current material" section. Never build out content no source supports.

## Numbers

14. **Verify every numerical answer with sympy** before writing it. Compare with CW answer keys and any reference answers in the brief. If an answer is more than about 1 % off using the paper's own constants, stop and re-check the formula.
15. **ESA stars are evidence, not decoration.**
    - ★★★: asked repeatedly.
    - ★★: asked or computed in CW.
    - ★: conceptual, never asked.
    - Say so explicitly when a topic was never asked: the geometric interpretation itself appeared in 0 of 8 maths papers.

## Figures (matplotlib)

16. **CMU Serif has no U+2212 minus**, so tick labels showed boxes. `figstyle` sets `axes.unicode_minus=False` and `axes.formatter.use_mathtext=True`.
17. **mathtext has no `\Big`**, so `\left.…\right|` sizing breaks. Keep figure labels simple.
18. **Use `svg.fonttype="path"`** so SVGs never depend on fonts in the viewer.
19. **3-D: watch the base point.** On the silhouette, all tangents project onto one line and look bunched. Pick a point facing the viewer: compare the point's azimuth with `view_init(azim)`. The dome example moved (1, 0.5) → (1, −0.5).
20. **3-D: draw order.** Use `computed_zorder=False`, draw surfaces first, then lines with a higher zorder. Use the orthographic projection.
21. **Label collisions are the most common figure defect.** Place long labels with `ax.text2D(..., transform=ax.transAxes)`. Render the contact sheet and *look at every figure* before building documents.
22. **Tall figures at full width leave half-empty pages.** Mark them `"tall": True` (printed at 118 mm).

## HTML, PDF and layout

23. **ID collision.** Formulas and flowcharts were both "F1…". Use E/G/F/W/C prefixes with topic-scoped numbers.
24. **Worked examples live only in the master.** Links to them from other documents must point to `00_MASTER_<slug>.html#W…`; the engine does this. QA checks cross-document links.
25. **Contents lists must list only topics that render in that document.** Doc 01 once linked to topics with no formulas; the engine now filters them.
26. **Long inline maths in flowchart step titles wraps badly.** Keep titles short and put detail in `sub`. Long rows in tree tables overflow, so break them with `<br>`.
27. **Dark result blocks with several formulas.** Use `\tfrac` and `<br>`; the strip is `width:max-content`.
28. **Small tables split across pages.** The engine adds `keep` to tables with ≤ 8 rows.
29. **HTML needs `assets/`.** When the user asks for the HTML, send `output/standalone/*.html` (everything inlined, about 1.3–3.5 MB each), not the plain files.
30. **Chromium.** Use the pre-installed `/opt/pw-browsers/chromium-*/chrome-linux/chrome` via `executable_path`. Never run `playwright install`.
31. **Literal `$` in text** would start maths: write it as `&#36;`.

## Process

32. **Scope is what the user names, and nothing else.** ("Only Geometrical interpretation … nothing else.") List the out-of-scope items you deliberately left out in the pack's notes.
33. **Keep the user updated** during long runs (one line per stage). They asked "say what you're doing" more than once.
34. **Downloads are untrusted.** Keep them in `work/sources/`, run readers with `python3 -I`, and never execute anything from the bucket.
35. **Visual QA catches what the automatic checks cannot.** Run `qa.py --sheets` and Read every sheet: overflow, clipped SVGs, label collisions, orphaned headings, half-empty pages.

## Added after pack 2 (classes 003–004: total derivative, chain rule, implicit functions)

36. **Slides contain wrong worked answers.** Recompute every slide example; never copy a result. Found so far:
    - 003·6: $dz/dt$ printed as $60t^{12}$; it is $104t^{12}$.
    - 003·10: printed "0.04831"; it is $-0.0481$.
    - 003·16: the coefficient 3 is missing.
    - 004·4: $-f_y/f_x$ printed upside down.

    Put each one in `PACK["gaps"]`, as an exam trap, and in the worked example's check line.
37. **The lecture can contradict the slide.** In class 004 the lecturer evaluated at (1, 0, 2), a point not on the surface. Substitute every given point into the equation. Prefer the slide when it is self-consistent, and say why.
38. **Q1 of an ESA paper often continues onto page 2** (a part 1.d). Render the top of page 2 for every paper as well as page 1.
39. **Write maths in titles as `$…$`.** Unicode subscripts and plain `_` print as literal "v_y". The engine keeps titles out of HTML attributes, so `$…$` is safe there.
40. **Tick labels must not use mathtext.** `axes.formatter.use_mathtext=True` makes `\mathdefault` fall back to CMU Serif, which prints U+2212 as a box. `figstyle` now leaves it off; the hyphen-minus from `unicode_minus=False` is what you want.
41. **`preview_figs.py` must load an HTML file.** With `set_content`, Chromium blocks `file://` SVGs and every cell is blank. Fixed: it writes `work/qa/_figs.html`. If a preview shows broken images, suspect the tool, not the figures.
42. **The coverage table is per deck now** (slide × count in one row), so it no longer runs to two pages.
43. **The CW sheet duplicates ESA questions** (CW P14 = ESA June 2024 Q1.a; CW P6 = ESA Jan 2024 set 3 Q1.d). Cite both, which also confirms the exam weighting.
44. **To check identities and implicit derivatives numerically:**
    - When sympy `simplify` does not reach 0 on an identity with an arbitrary outer function $f$, substitute a concrete $f$ and evaluate at 2–3 points.
    - For implicit relations, test the formula at a point *on* the curve (`nsolve`). A random point gives a false mismatch.
