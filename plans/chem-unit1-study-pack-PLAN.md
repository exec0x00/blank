# Agent brief: Engineering Chemistry, Unit 1 study pack (HTML first, then PDF)

> **Who this is for:** an autonomous coding/research agent with a Linux shell, Python 3, network access to `huggingface.co`, LibreOffice, poppler-utils (`pdftotext`, `pdftoppm`), and Chromium/Playwright.
> **What it produces:** six study documents, each as a standalone HTML file and a matching PDF, built only from the PESU Engineering Chemistry **Semester 1, Unit 1** material in the Hugging Face bucket below.
> **Read this entire brief before starting.** Section 3 lists data-quality problems that will produce wrong formulas if you ignore them.

---

## 0. The task in one paragraph

Read every Unit 1 source for **Engineering Chemistry (UE26CY151A), Semester 1**: the AV Summary video transcripts, the per-class slide decks, and the consolidated Unit 1 slide PDF. Use the past ESA papers to rank what matters. Extract every formula, every symbol used in those formulas, every important point, every graph or plot, every flowchart or process, and every keyword or short note. Organise the results into **five themed reference documents** and **one master document** that merges everything by topic. Author each one as clean, print-ready HTML, then convert each to PDF. Do not invent content. Tag every item with its source.

---

## 1. Scope

| In scope | Out of scope |
|---|---|
| Course **UE26CY151A Engineering Chemistry**, Sem-1, **Unit 1 only** | Units 2, 3 and 4 (electrochemistry, corrosion, batteries, nano, polymers, and so on) |
| Unit 1 AV Summary **transcripts** (14 files) | The `.mp4` video files. Don't download them; the transcripts already contain the speech. |
| Unit 1 per-class **slides** (12 decks, `.pptx` plus extracted `.slides.md`) | Lab record, the lab cheat sheet, and the other subjects in the bucket |
| Older consolidated **`Chem_Slides_Unit-1` PDF** (137 pages) as a cross-check and gap-filler | Unit 1 questions on conductometry, colorimetry or α-Al₂O₃ in old papers. Those are lab or other-unit questions under an older syllabus. |
| **ESA past papers**, Q1 only (Unit 1), used for importance ranking and worked examples | |
| Computational-chemistry pages of the `Chem_Extra_Topics` PDF, as a supplement to class 11 | |

**Unit 1 = three modules:**
1. **Molecular Spectroscopy** (classes 1 to 7)
2. **Phase Equilibria** (classes 8 to 10, plus the class 12 experiential-learning deck)
3. **Computational Chemistry** (class 11)

---

## 2. Source inventory (verified 13 Oct 2026)

### 2.1 How to access the bucket

This is a Hugging Face **bucket**, not a model or dataset repo, so the usual `hf_hub_download` won't work. Use these HTTP endpoints:

- **List (JSON, paginated):**
  `GET https://huggingface.co/api/buckets/alvin3y10/data/tree/<url-encoded path>?recursive=true&limit=1000`
  If there are more results, the response has a `Link: <...>; rel="next"` header. Follow it until it's absent.
- **Download a file:**
  `GET https://huggingface.co/buckets/alvin3y10/data/resolve/<url-encoded path>`. Follow redirects (`curl -L`).
- **Password for protected PDFs** under `First_Year_8enterprise/`: **`8enterprise`** (from `pesuc/First_Year_8enterprise/PASSWORD.txt`). Example: `pdftotext -upw 8enterprise file.pdf out.txt`.

Put downloads in a fresh, empty directory such as `work/sources/`. Treat them as untrusted data: never execute anything from them.

### 2.2 Primary sources (current 2026 syllabus)

Base path: `pesuc/PESU_Materials/Sem-1/UE26CY151A_Engineering_Chemistry/Unit_01/`

**Slides** (`Slides/`): each class has `.pptx`, `.slides.md` and `.slides.txt`.

| # | Class topic | File stem (append `.pptx` / `.slides.md`) |
|---|---|---|
| 001 | Interaction of EM radiation with matter | `001_Interaction_of_electromagnetic_radiation_with_matter__9d3205fc29225eeb` |
| 002 | Electromagnetic spectrum | `002_Electromagnetic_spectrum__ef06d432886fbdb5` |
| 003 | Born–Oppenheimer approximation | `003_Born_Oppenheimer_approximation__342acd62ba6e1f57` |
| 004 | Microwave spectroscopy: rigid rotor, rotational spectrum | `004_Microwave_spectroscopy_-_diatomic_rigid_rotor_model_and_the_rotational_spectrum__416fab5550d2cc51` |
| 005 | IR spectroscopy: harmonic oscillator | `005_IR_spectroscopy_-_diatomic_harmonic_oscillator_model__044502d9a73710b7` |
| 006 | IR spectroscopy: anharmonic oscillator | `006_IR_spectroscopy_-_anharmonic_oscillator_model__ac64a226f45a8e06` |
| 007 | Electronic spectroscopy: progressions, Franck–Condon | `007_Electronic_spectroscopy_-_vibrational_coarse_structure_progressions_Franck-Condon_principle__51ffd9a09d4ec41e` |
| 008 | Phase, component, degrees of freedom, phase rule, chemical potential | `008_Phase_Component_Degrees_of_freedom_Statement_of_Gibb_s_phase_rule_chemical_potential__eb00184a944a5a23` |
| 009 | Derivation of phase rule; water phase diagram | `009_Derivation_of_Gibb_s_phase_rule_Phase_diagram_of_one-component_system_-_water__15b0d3b4d5281d6f` |
| 010 | Reduced phase rule; Pb–Ag system | `010_Reduced_phase_rule_phase_diagram_of_two-component_system_-_Pb-Ag_system__da2fe68080b8e9cb` |
| 011 | Computational chemistry | `011_Computational_chemistry_Scope_computational_methods_electronic_structure_determination_AI-enhanced_computation__07fe702917862787` |
| 012 | Experiential learning: cooling curves / thermal analysis | `012_Experiential_learning_Based_on_Phase_Diagram__42cc75d52ba7f0e4` |

**Transcripts** (`AV_Summaries/`): use the `.transcript.md` files, which are timestamped. Ignore the `.mp4`, `.srt`, `.json` and `.txt` files.

| File stem (append `.transcript.md`) | Maps to slide class |
|---|---|
| `001_Interaction_of_radiation_with_matter__1eb05f6c3f230eec` | 001 |
| `002_Electromagnetic_spectrum__d84acfbd19ed2af4` | 002. **Also covers Raman, Rayleigh, Stokes and anti-Stokes, which aren't on any slide.** |
| `004_Rotational_spectroscopy__cda73f2030eb1a62` | 003 (B-O, spoken) and 004 |
| `005_Vibrational_spectroscopy_harmonic_oscillator__bd1d3b496879b403` | 005 |
| `006_Vibrational_spectroscopy_anharmonic_oscillator__4fe4d43ab2b66d24` | 006 |
| `007_Electronic_spectroscopy_Progression__6dd27636f794caa1` | 007 (part 1) |
| `007_Electronic_spectroscopy_-_Franck-Condon_principle_Part_II__70e8e6f497126f7d` | 007 (part 2) |
| `008_Phase_Component_Degrees_of_freedom_Statement_of_Gibb_s_phase_rule_chemical_potential__a7da1e88f96b163b` | 008 |
| `009_Derivation_of_Gibb_s_phase_rule_Phase_diagram_of_one-component_system_-_water_-_Part_I__f611c716baed093a` | 009 (derivation) |
| `009_Derivation_of_Gibb_s_phase_rule_Phase_diagram_of_one-component_system_-_water_-_Part_II__2a5eb65b0585fe28` | 009 (water diagram; **Clausius–Clapeyron slope reasoning is spoken here**) |
| `010_Reduced_phase_rule_phase_diagram_of_two-component_system_-_Pb-Ag_system__8e25eaa5432159a1` | 010 and 012 (cooling curves; **desilverisation of argentiferous lead is spoken here**) |
| `011_..._AI-enhanced_computation__0671dbe2a6d868d4` / `__5a0b9f520a3c63b3` / `__74b8d88c6bf2ef3c` | 011 (three short parts; work out their order from content) |

There is no separate transcript for class 003 (Born–Oppenheimer) or class 012.

### 2.3 Secondary sources

Base path: `pesuc/First_Year_8enterprise/Files/Chemistry/`

| File | Use |
|---|---|
| `Slides/Chem_Slides_Unit-1__1viNZxvoW6.pdf` (137 pp., 2025 syllabus) | Cross-check equations and diagrams. It has extra worked derivations, such as the step-by-step moment of inertia (I = μr₀²) and E_r = L²/2I. Its module list also names **Beer–Lambert law** and **Fe–C phase diagram**; see §3.4. |
| `Extra/Chem_Extra_Topics__1-HfOeZNwo.pdf` (50 pp., **password `8enterprise`**) | Computational-chemistry supplement: applications, challenges and limitations, cost considerations. |
| `Papers/ESA Papers/2024/1..11__*.pdf`, `Papers/ESA Papers/2025/Chem-EC[2025]*.pdf`, `Chem-RR[2025]*.pdf` | **Question 1 = Unit 1.** Use for importance ranking (§5) and worked examples. |

Useful aggregate files you can skip if you already have the per-class files: `.../UE26CY151A_Engineering_Chemistry/ALL_SLIDE_TEXT.md` and `ALL_VIDEO_TRANSCRIPTS.md`. These cover all units, so filter to Unit 1.

---

## 3. Known data-quality problems (read before extracting)

### 3.1 The slide text files are missing almost every equation

The `.slides.md` / `.slides.txt` files leave equations out. The decks store them as embedded OLE "Equation 3.0" objects with WMF previews. For example, slide 005 says "The oscillation frequency is given by," with nothing after it.

**Required fix:** render each `.pptx` to images and read the equations visually.
```bash
soffice --headless --convert-to pdf --outdir work/render work/sources/slides/NNN_*.pptx
pdftoppm -r 110 -png work/render/NNN_*.pdf work/render/NNN/slide
```
This was tested on deck 005. LibreOffice renders the equations legibly, for example ν_osc = (1/2π)√(k/μ) Hz and ε_v = (v+½)ν̄_osc cm⁻¹. Look at **every rendered slide image** in all 12 decks. Cross-check against `pdftotext -layout` output of the 137-page Unit-1 PDF, where equations partly survive as garbled text.

### 3.2 Diagram text is OCR noise

Labels inside images come through as fragments like `"Wavelength（K)"`, `"9610"` (meaning 961 °C) and `"3030"` (meaning 303 °C). Read the rendered slide image instead of the OCR text whenever you describe a graph.

### 3.3 Transcripts are automatic speech recognition (ASR) output, with typical errors

Correct them silently in the output. Never quote ASR errors.

| ASR text | Correct |
|---|---|
| "BL Ambert's law" | Beer–Lambert law |
| "Glossier's Claperon", "Clausius Clabron", "Closer's Clapebron" | Clausius–Clapeyron equation |
| "rally scattering" | Rayleigh scattering |
| "Homo to the lumon" | HOMO → LUMO |
| "digit rotor", "rigid rotar" | rigid rotor |
| "dB by Dt", "DP by Dt" | dP/dT |
| "Dr. Lata Pasukuleti" | Dr. Lata Pasupulety (from the slide PDF) |
| "Frank Condon" | Franck–Condon |

Transcripts are timestamped (`[hh:mm:ss.mmm]`). Keep the timestamp as the citation for anything that comes only from speech.

### 3.4 Syllabus drift between 2025 and 2026

- **Beer–Lambert law** is in the module overview of the 2025 PDF and the class 001 transcript intro, and was asked in the Dec 2024 ESA ("State the Beer-Lambert law"). The 2026 decks have **no Beer–Lambert slide**. Include it as a short, clearly labelled box: **"Listed in module overview / past papers; not on current slides"**. Use the standard form A = log(I₀/I) = εcl and define each symbol.
- **Fe–C (iron–carbon) phase diagram** is named in the 2025 module list, asked in 2024 ESAs (peritectic and eutectoid points), and the class 010 transcript says "next class we'll study the iron carbon system". The 2026 Unit 1 folder has **no Fe–C deck or transcript**. Mention it only in a "Possibly examinable, not in current material" appendix in the master document. Don't build out content that no source supports.
- **CO₂ phase diagram** was asked once (Jan 2024) but isn't in the current material. List it in the same appendix.

### 3.5 Duplicate and partial files

- Class 007 and class 009 each have two transcript parts. Class 011 has three short parts with no order in their filenames.
- Several ESA files are duplicates (papers 1, 4 and 6 are the same June 2024 set). Deduplicate before counting topic frequency.

---

## 4. Canonical topic map

Every item in every document must carry one of these topic IDs. The master document follows this order exactly.

```
M1  MOLECULAR SPECTROSCOPY
  T1  EM radiation & its interaction with matter      (class 001)
      definition of spectroscopy; spectrophotometer components; wave properties;
      dual nature; E = hν; atomic vs molecular spectra; quantisation; absorption vs emission
  T2  Electromagnetic spectrum & regions              (class 002)
      regions ↔ wavelength ranges ↔ transition type ↔ technique; NMR/ESR spin reversal;
      Raman / Rayleigh / Stokes / anti-Stokes (transcript only)
  T3  Born–Oppenheimer approximation                   (class 003; recapped in 007)
      types of molecular energy; E = Erot + Evib + Eelec; Erot << Evib << Eelec; energy-level diagram
  T3b Beer–Lambert law                                 (flagged; see §3.4)
  T4  Rotational (microwave) spectroscopy             (class 004)
      gross selection rule (permanent dipole); rigid rotor; centre of mass; I = μr₀²;
      E_J, ε_J = BJ(J+1); B; ΔJ = ±1; line positions 2B(J+1); spacing 2B; bond length from spectrum
  T5  Vibrational (IR) spectroscopy, SHO               (class 005)
      IR activity (change in dipole); CO₂ modes; Hooke's law; parabolic PE; ν_osc, ν̄_osc;
      E_v, ε_v; zero-point energy; equal spacing; Δv = ±1; single line; force constant k
  T6  Vibrational spectroscopy, anharmonic             (class 006)
      Morse function; ε_v with xₑ; converging levels; Δv = ±1, ±2, ±3…; fundamental, overtones;
      hot bands; dissociation; failure of SHO
  T7  Electronic spectroscopy                          (class 007)
      HOMO→LUMO; σ→σ*, π→π*, n→π*; coarse vs fine structure; progressions (v′,v″);
      no vibrational selection rule; probability distribution; Franck–Condon statement;
      vertical transitions; three cases (rₑ′ = rₑ″, rₑ′ > rₑ″, rₑ′ >> rₑ″ → continuum)
M2  PHASE EQUILIBRIA
  T8  Basic terms & phase rule                         (class 008)
      Gibbs energy minimisation; phase, component, degree of freedom (definitions + counting
      examples: ice/water/vapour, CaCO₃, NH₄Cl, Na₂SO₄·10H₂O); chemical potential; statement F = C − P + 2
  T9  Derivation of phase rule                         (class 009 part I)
      equilibrium conditions; variables P(C−1)+2; constraints C(P−1); F = C − P + 2
  T10 One-component system: water                     (class 009 part II)
      F = 3 − P; area/line/point; curves OA, OB, OC, OA′; triple point; critical point;
      Clausius–Clapeyron slope argument for each curve; metastable (supercooled) water
  T11 Two-component system: reduced phase rule & Pb–Ag (class 010)
      why reduce; F = C − P + 1 (condensed/reduced); Pb–Ag eutectic diagram, areas, curves,
      eutectic point values; desilverisation (Pattinson's process context, transcript)
  T12 Thermal analysis / cooling curves                (class 012 experiential)
      cooling curve of pure substance vs mixture; break; halt; building a phase diagram from cooling curves
M3  COMPUTATIONAL CHEMISTRY
  T13 Computational chemistry                          (class 011 + Extra Topics PDF)
      definition; history (Heitler–London 1927; Nobel 1998 Kohn & Pople; 2013 Karplus, Levitt, Warshel);
      scope; classical (MM, MD) vs quantum (semi-empirical, ab initio, DFT); comparison of
      speed/accuracy; advantages; challenges; ethylene electronic-structure workflow; AI-enhanced
      workflow, scope and advantages
```

---

## 5. Importance ranking from past papers

Tag every important point, formula and diagram with an exam-weight badge: **★★★ high**, **★★ medium**, **★ low/conceptual**. Here is the frequency from the deduplicated Q1s of 2023–2025 ESAs:

| Topic | How it's asked | Weight |
|---|---|---|
| T4 Rigid rotor | Derive I = μr₀² (×4); bond length from first line (×4); draw levels to J = 5 or 6 and the spectrum (×3); line position for J → J+1 | ★★★ |
| T5 SHO | ν̄ and ZPE from k (×4); k from ν̄ (×3); "why only one line" (×2); E_v at v = 3, 4; level diagram and spectrum | ★★★ |
| T7 Franck–Condon | State it, then draw the 3 cases with spectra (×5); meaning of a continuum (×2) | ★★★ |
| T9 Phase rule derivation | Derive for C components and P phases (×3) | ★★★ |
| T10 Water diagram | Draw and label with T, P values; F in areas, lines and triple point; metastable curve; Clausius–Clapeyron negative slope (×4) | ★★★ |
| T11 Reduced phase rule and Pb–Ag | Draw Pb–Ag with eutectic values (×2); why F = C − P + 1 (×4) | ★★★ |
| T6 Anharmonic | xₑ from fundamental and overtone; ω̄ₑ from fundamental and xₑ; first-overtone expression; selection rule; failure of SHO (×4) | ★★ |
| T2 Raman | Rayleigh vs Raman; Stokes vs anti-Stokes (×2) | ★★ |
| T5 CO₂ IR active / microwave inactive; HI vs H₂ / I₂ IR activity (×3) | Short reasoning | ★★ |
| T3 Born–Oppenheimer | Statement and energy-level diagram (×3) | ★★ |
| T8 Components and phases | Count C and P for CaCO₃ or MgCO₃ decomposition (×2) | ★★ |
| T13 Computational chemistry | Definition and 3 applications (×1) | ★ |
| T3b Beer–Lambert | State the law (×1, older syllabus) | ★ |

### 5.1 Reference answers for checking your worked examples

Use the constants given in each question; small differences come from rounding. These values were computed with h = 6.626×10⁻³⁴ J s, c = 2.998×10¹⁰ cm s⁻¹, 1 amu = 1.66×10⁻²⁷ kg.

| Problem (source paper) | Expected result |
|---|---|
| HCl, first rotational line 21.18 cm⁻¹ (H = 1.008, Cl = 35.45) | B = 10.59 cm⁻¹, I ≈ 2.64×10⁻⁴⁷ kg m², r₀ ≈ 1.27–1.28 Å |
| HI, first line 13.022 cm⁻¹ (H = 1.0, I = 126.9) | I ≈ 4.30×10⁻⁴⁷ kg m², r₀ ≈ 1.62 Å |
| B = 10.56 cm⁻¹ | I ≈ 2.65×10⁻⁴⁷ kg m², line spacing = 2B = 21.12 cm⁻¹ |
| HCl, J0→1 at 20.68 cm⁻¹; find J20→21 | 2B(J+1) → 21 × 20.68 = 434.28 cm⁻¹ |
| HF, k = 970 N m⁻¹ (H = 1.008, F = 18.99) | ν̄_osc ≈ 4148 cm⁻¹, ZPE ≈ 2074 cm⁻¹ ≈ 4.12×10⁻²⁰ J |
| CO, ν̄ = 2168 cm⁻¹ (SHO) | k ≈ 1.90×10³ N m⁻¹, ZPE = 1084 cm⁻¹ |
| CO, k = 1840 N m⁻¹ | ν̄ ≈ 2134 cm⁻¹, ν ≈ 6.40×10¹³ Hz |
| NO, k = 1530 N m⁻¹ (N = 14, O = 16) | ν̄ ≈ 1865 cm⁻¹, ZPE ≈ 933 cm⁻¹, ε₃ ≈ 6528, ε₄ ≈ 8393 cm⁻¹ |
| HBr, fundamental 2559.08, 1st overtone 5027.54 cm⁻¹ | xₑ ≈ 0.0171, ω̄ₑ ≈ 2649.7 cm⁻¹ |
| CO, fundamental 2143 cm⁻¹, xₑ = 0.01 | ω̄ₑ = 2143/(1 − 2xₑ) ≈ 2186.7 cm⁻¹ |
| CO, ω̄ₑ = 2050 cm⁻¹, xₑ = 0.017; first overtone | 2ω̄ₑ(1 − 3xₑ) ≈ 3890.9 cm⁻¹ |

If any of your worked solutions disagrees with this table by more than about 1% using the paper's own constants, stop and re-check the formula.

---

## 6. Extraction workflow

Do the extraction **before** writing any HTML. Keep intermediate files under `work/`.

1. **Download** everything in §2.2 and §2.3 (skip the mp4s). Save `work/sources/manifest.json` with each file's path, size and URL.
2. **Render** the 12 `.pptx` decks to PNG (see §3.1). Also extract text from the 137-page Unit-1 PDF and the Extra Topics PDF with `pdftotext -layout`. Use `-upw 8enterprise` for the Extra Topics PDF.
3. **Read** every source completely, class by class: rendered slide images, then the `.slides.md` text, then the transcript(s) for that class, then the matching pages of the 137-page PDF.
4. **Record** each atomic fact in `work/kb.json` (the knowledge base) as one object per item:
   ```json
   {
     "id": "F-T4-03",
     "kind": "formula | term | point | graph | flow | keyword | definition | example | pyq",
     "topic": "T4",
     "title": "Rotational energy in wavenumbers",
     "latex": "\\varepsilon_J = BJ(J+1)\\ \\text{cm}^{-1}",
     "symbols": ["εJ","B","J"],
     "body": "…",
     "conditions": "rigid rotor, heteronuclear diatomic",
     "exam_weight": 3,
     "sources": [
       {"type":"slide","deck":"004","slide":8},
       {"type":"transcript","file":"004_Rotational_spectroscopy","t":"00:12:31"},
       {"type":"pdf","file":"Chem_Slides_Unit-1","page":24}
     ],
     "verification": "matches rendered slide 004/8 and PDF p.24",
     "flag": null
   }
   ```
   Use `flag` for `"not-on-current-slides"`, `"transcript-only"` or `"added-for-clarity"`. The last one marks standard textbook context you added, such as the hot-band expression or the Beer–Lambert form. Keep these minimal and always label them.
5. **Reconcile.** Where sources disagree, prefer the rendered 2026 slide, then the 2025 PDF, then the transcript. Record each conflict in `work/conflicts.md`. Known example: the triple point appears as "0.0098 °C" on the slides and as "0.0099 °C" in the diagram OCR. The textbook value is 0.0098 °C at 4.58 mm Hg; note the discrepancy.
6. **Self-check** against the minimum-content checklists in §7. Every listed item must exist in `kb.json` before you start writing HTML.

---

## 7. Deliverables and per-document specifications

Output directory: `output/`. File names are fixed:

| # | HTML | PDF | Contents |
|---|---|---|---|
| 1 | `01_formulas_and_symbols.html` | `01_formulas_and_symbols.pdf` | All formulas, plus a glossary of every symbol used in them |
| 2 | `02_important_points.html` | `02_important_points.pdf` | Important points, definitions, statements, laws, reasoning ("why") questions |
| 3 | `03_graphs_and_diagrams.html` | `03_graphs_and_diagrams.pdf` | Every graph, plot, spectrum, energy-level diagram and phase diagram, redrawn |
| 4 | `04_flowcharts_and_visuals.html` | `04_flowcharts_and_visuals.pdf` | Flowcharts, process flows, concept maps, comparison tables, decision trees |
| 5 | `05_short_notes_keywords.html` | `05_short_notes_keywords.pdf` | Short notes, keywords, one-liners, mnemonics, flash-card-style recap |
| 6 | `00_MASTER_unit1_complete.html` | `00_MASTER_unit1_complete.pdf` | Everything above, merged and organised by topic (T1 to T13) |

Documents 1 to 5 are each organised by **Module → Topic (T-IDs)** in the same order. The master document is the definitive version. Build it from the same `kb.json` so the content stays consistent.

### 7.1 Doc 1: Formulas and symbol glossary

**Part A: formula sheet.** For each formula, show a card containing:
- Display-mode equation (KaTeX)
- Name or what it gives
- When or where it applies (model, conditions)
- Units of the result
- A short derivation hint or link-back if the formula is derivable and examinable (moment of inertia, phase rule)
- Exam weight badge and source tag

**Minimum formulas required** (all must appear; add any others you find):
- **T1:** E = hν; ν = c/λ; ν̄ = 1/λ; E = hcν̄; ΔE = E₂ − E₁ = hν; conversion from joules to cm⁻¹ (divide by hc)
- **T3:** E_total = E_trans + E_rot + E_vib + E_elec; B-O: E = E_rot + E_vib + E_elec; E_rot ≪ E_vib ≪ E_elec; ΔE_total = ΔE_elec + ΔE_vib + ΔE_rot (J and cm⁻¹ forms from deck 007 slide 4), with the approximate orders of magnitude shown on that slide
- **T3b (flagged):** A = log(I₀/I) = εcl
- **T4:** m₁r₁ = m₂r₂; r₀ = r₁ + r₂; r₁ = m₂r₀/(m₁+m₂); r₂ = m₁r₀/(m₁+m₂); I = m₁r₁² + m₂r₂² = μr₀²; μ = m₁m₂/(m₁+m₂); E_r = ½Iω² = L²/2I; quantised angular momentum (from the PDF); E_J = h²J(J+1)/(8π²I) J; ε_J = hJ(J+1)/(8π²Ic) = BJ(J+1) cm⁻¹; B = h/(8π²Ic); ΔJ = ±1; Δε(J→J+1) = 2B(J+1); spacing = 2B; level values 0, 2B, 6B, 12B, 20B, 30B, 42B
- **T5:** Hooke's law F = −kx and parabolic PE = ½k(r − rₑq)²; ν_osc = (1/2π)√(k/μ) Hz; ν̄_osc = (1/2πc)√(k/μ) cm⁻¹; E_v = (v+½)hν_osc J; ε_v = (v+½)ν̄_osc cm⁻¹; ZPE ε₀ = ½ν̄_osc; level spacing = ν̄_osc; Δv = ±1; single line at ν̄_osc; k = 4π²c²ν̄²μ
- **T6:** Morse: PE = Dₑq[1 − exp{a(rₑq − r)}]²; ε_v = (v+½)ω̄ₑ − (v+½)²ω̄ₑxₑ cm⁻¹; Δv = ±1, ±2, ±3…; fundamental (0→1) = ω̄ₑ(1 − 2xₑ); 1st overtone (0→2) = 2ω̄ₑ(1 − 3xₑ); 2nd overtone (0→3) = 3ω̄ₑ(1 − 4xₑ); hot band (1→2) = ω̄ₑ(1 − 4xₑ); ZPE ε₀ = ½ω̄ₑ(1 − ½xₑ). Confirm each against rendered deck 006 slides 4, 7 and 9.
- **T7:** spectral line notation (v′, v″); ε = ε_elec + ε_vib (from deck 007)
- **T8 to T11:** F = C − P + 2; total variables = P(C − 1) + 2; constraints = C(P − 1); μᵢ^α = μᵢ^β = … ; chemical potential μᵢ = (∂G/∂nᵢ)_{T,P,nⱼ} (from the transcript: "partial derivative… T, P and moles of other components constant"); one-component: F = 3 − P; Clausius–Clapeyron dP/dT = ΔH/(TΔV) for fusion, sublimation and vaporisation, with a sign analysis table; reduced (condensed) phase rule F = C − P + 1; two-component: F = 3 − P (at constant P)
- **Constants box:** h = 6.626×10⁻³⁴ J s (slides also use 6.625); c = 3×10⁸ m s⁻¹ = 3×10¹⁰ cm s⁻¹; N_A = 6.022×10²³; 1 amu = 1.66×10⁻²⁷ kg; π = 3.14 as used in papers

**Part B: symbol glossary ("terms used in the formulas").** One table, alphabetical within each module. Columns: **Symbol | Name | Meaning in this unit | SI / spectroscopic unit | Typical value or constant | Appears in (formula IDs)**. Every symbol in Part A must be in the table, including subscripts and primes: λ, ν, ν̄, c, h, E, ε, ΔE, J, B, I, μ (reduced mass), μ (chemical potential; **flag that the same letter has two meanings**), m₁, m₂, r₀, r₁, r₂, ω, L, k, x, v, ν_osc, ν̄_osc, ω̄ₑ, xₑ, Dₑq, a, rₑq, rₑ′, rₑ″, v′, v″, ε′, ε″, F, C, P (phases), P (pressure; **same-letter clash, flag it**), T, G, nᵢ, ΔH, ΔV, A, ε (molar absorptivity; **third meaning of ε, flag it**), I₀, l.

**Part C: unit conversion strip.** J ↔ cm⁻¹ ↔ Hz ↔ eV ↔ kJ mol⁻¹, with the factors used in deck 002's region table.

### 7.2 Doc 2: Important points

For each topic: a numbered list of crisp points, each one or two lines and each with an exam-weight badge. Group them under these sub-headings where relevant:
- **Definitions** (verbatim-quality wording from the slides, so they can be reproduced in an exam)
- **Statements of laws and principles:** Born–Oppenheimer, Franck–Condon (quote the exact slide wording), Gibbs phase rule (with the "not influenced by external forces" condition), reduced phase rule
- **Conditions and selection rules:** gross and specific, for each spectroscopy
- **"Why" reasoning:** HCl and CO are microwave-active but H₂, Cl₂ and CO₂ aren't; CO₂ is IR-active but microwave-inactive; HI is IR-active but H₂ and I₂ aren't; SHO gives a single line; why the SHO model fails; spectral line spacing decreases (anharmonic); the excited state has a longer rₑ; continuum means dissociation; the melting curve of water has a negative slope (ΔV < 0), and is steep because ΔV is small; the sublimation and vaporisation curves are positive and less steep because ΔV is large; the general phase rule isn't used for 2-component systems (F = 3 needs 3-D); NH₄Cl gives C = 1, but becomes C = 2 if you add excess HCl
- **Key numerical facts:** water triple point 0.0098 °C at 4.58 mm Hg; critical point 374 °C at 218 atm; Pb mp 327 °C, Ag mp 961 °C; eutectic at 303 °C, 97.4 % Pb / 2.6 % Ag; spectral region wavelength ranges
- **Common mistakes / exam traps** (e.g. "J starts at 0", "first rotational line is at 2B, not B", "ZPE ≠ 0", "use μ in kg, not amu", "convert c to cm s⁻¹ when working in cm⁻¹")
- At the end of each module: a **"Past-paper questions on this topic"** box listing the actual ESA questions (deduplicated) with year and marks

### 7.3 Doc 3: Graphs and diagrams

Redraw every graph and diagram as a **clean vector figure**. Don't paste screenshots of the slides: they carry third-party watermarks and source logos, and they print poorly. Every figure needs a numbered caption, a one-paragraph "how to read / what to label in an exam" note, and a source tag.

**Minimum figures required:**

| ID | Figure | Must show |
|---|---|---|
| G1 | EM wave | E and B fields mutually perpendicular and perpendicular to propagation; λ marked |
| G2 | Single-beam spectrophotometer block diagram | source → monochromator (entrance slit, dispersive element, exit slit) → sample → detector → recorder |
| G3 | Two-level quantisation; absorption vs emission | E₁, E₂, ΔE = hν, up and down arrows |
| G4 | Atomic line spectrum vs molecular band spectrum | Side-by-side sketch |
| G5 | EM spectrum strip | γ, X-ray, UV, Vis (400–700 nm), IR, microwave, radio, aligned to a log-λ axis; the region→technique→transition table overlaid |
| G6 | Diatomic energy-level diagram (B-O) | Two Morse curves (ground and excited); vibrational levels with rotational sub-levels; arrows for microwave, IR and UV-Vis transitions; dissociation energy |
| G7 | Rotating polar diatomic | Dipole component vs time (sinusoid) |
| G8 | Rigid rotor model | m₁, m₂, r₁, r₂, r₀, centre of mass C |
| G9 | Rotational energy levels J = 0 to 6 | Values 0, 2B, 6B … 42B with increasing gaps; ΔJ = +1 arrows |
| G10 | Rotational spectrum (stick spectrum) | Lines at 2B, 4B, 6B …, constant 2B spacing, intensity rising then falling (thermal population) |
| G11 | CO₂ vibrational modes | Symmetric stretch (IR-inactive), asymmetric stretch (active), bending (active) |
| G12 | Ball-and-spring diatomic | Equilibrium, stretched and compressed |
| G13 | SHO parabolic potential with equally spaced levels | v = 0…5; ε₀ = ½ν̄ marked |
| G14 | SHO spectrum | A single line at ν̄_osc |
| G15 | Morse potential vs harmonic overlay | Dₑq, dissociation limit, continuum |
| G16 | Anharmonic levels converging | Arrows for fundamental, 1st and 2nd overtone, and hot band |
| G17 | Anharmonic spectrum | Fundamental, overtones with decreasing spacing; hot band to the left of the fundamental |
| G18 | MO energy diagram | σ, π, n, π*, σ*; σ→σ*, π→π*, n→π* arrows |
| G19 | Progression (vibrational coarse structure) | Levels v″ = 0 → v′ = 0…6; resulting spectrum (0,0), (1,0), (2,0)… converging to the continuum |
| G20 | Probability distribution in vibrational levels | Maximum at the centre for v = 0, at the edges for higher v |
| G21 | Franck–Condon, 3 cases (a, b, c) | (a) rₑ′ = rₑ″ → (0,0) strongest; (b) rₑ′ > rₑ″ → (v′,0) strongest; (c) rₑ′ ≫ rₑ″ → continuum. **Each drawn as a potential-curve pair with a vertical arrow, plus its spectrum underneath.** |
| G22 | Water phase diagram | Areas (ice, water, vapour); curves OA (vaporisation), OB (sublimation), OC (melting, negative slope); OA′ (metastable, dashed); O triple point (0.0098 °C, 4.58 mm Hg); A critical point (374 °C, 218 atm); 1 atm line with 0 °C and 100 °C; F value annotated in each region, line and point |
| G23 | Pb–Ag eutectic phase diagram | Temperature vs composition; A (Pb, 327 °C) and B (Ag, 961 °C); curves AO and BO; eutectic O at 303 °C and 2.6 % Ag; areas liquid melt, liquid + solid Pb, liquid + solid Ag, solid Pb + solid Ag (eutectic) |
| G24 | Cooling curves | Pure substance (break, flat halt, end); binary mixture (change of slope at the start of crystallisation, eutectic halt); set of curves 1 to 6 mapped onto the derived phase diagram |
| G25 | Ethane rotational barrier | Energy vs dihedral angle; staggered minima, eclipsed maxima, ~3.0 kcal/mol |
| G26 | Ethylene π/π* MO | HOMO = π and LUMO = π* sketch |

**Sources note:** the Pb–Ag slide labels the corners inconsistently. The text says "A: 100 % Pb, B: 100 % Ag", but it also describes "curve BO = freezing point curve of Pb" and "Area AOD: solid Ag + liquid". Read the rendered image and draw one self-consistent labelling: **Pb on the left, Ag on the right**. Note the slide inconsistency in `conflicts.md`, and add a footnote telling readers to use their faculty's lettering in exams.

### 7.4 Doc 4: Flowcharts and visualisations

Use flowcharts, concept maps and comparison tables:
- **F1 Unit 1 concept map:** three modules → topics → key ideas (one page, landscape allowed)
- **F2 "Which spectroscopy?" decision tree:** energy region → transition type → technique → selection rule → information obtained
- **F3 Spectroscopic activity checker:** permanent dipole? → microwave-active; dipole changes during vibration? → IR-active; all molecules → electronic. Worked through for HCl, CO, H₂, Cl₂, CO₂, H₂O, HI.
- **F4 Rotational spectrum → bond length** procedure: read first line → B = line/2 → I = h/(8π²cB) → μ → r₀ = √(I/μ)
- **F5 IR line → force constant** procedure, and the reverse (k → ν̄ → ZPE)
- **F6 Anharmonic problem solver:** given the fundamental and an overtone → solve for xₑ and ω̄ₑ
- **F7 Franck–Condon outcome flow:** compare rₑ′ with rₑ″ → most intense line → spectrum shape
- **F8 Phase-rule derivation flow:** count variables → count constraints → subtract
- **F9 Phase-rule application flow:** count P → count C (using the "minimum constituents" test) → choose full vs reduced rule → F → classify (bivariant, univariant, invariant)
- **F10 Pb–Ag cooling path:** melt cools → Pb separates (melt richer in Ag along BO) → eutectic O → solid Pb + Ag
- **F11 Thermal analysis → phase diagram construction**
- **F12 Computational chemistry methods tree:** classical (MM, MD) vs quantum (semi-empirical, ab initio, DFT), with speed and accuracy arrows
- **F13 Ethylene electronic-structure determination steps** (5 steps from deck 011 slide 17)
- **F14 AI-enhanced workflow:** quantum simulations → dataset → ML model → predicted properties
- **Comparison tables:** atomic vs molecular spectra; absorption vs emission; Rayleigh vs Raman, Stokes vs anti-Stokes; SHO vs anharmonic (levels, selection rule, spectrum); microwave vs IR vs UV-Vis (region, transition, condition, information); 1-component vs 2-component systems; MM vs MD vs semi-empirical vs ab initio vs DFT

### 7.5 Doc 5: Short notes and keywords

- **Per topic:** a 5 to 10 line "short note" an examiner would accept for a 2- or 3-mark answer
- **Keyword index:** alphabetical, each keyword with a one-line meaning and topic ID (aim for 100+ terms: absorption spectrum, anharmonicity constant, anti-Stokes line, band spectrum, bivariant, centre of mass, chemical potential, component, condensed system, continuum, critical point, degrees of freedom, DFT, eutectic, force constant, fundamental, gross selection rule, hot band, invariant, metastable, moment of inertia, Morse function, overtone, phase, progression, reduced mass, rigid rotor, rotational constant, triple point, univariant, vertical transition, zero-point energy, …)
- **One-liners / rapid recall:** about 40 Q→A pairs
- **Mnemonics**, kept few and simple and marked as study aids (e.g. energy ordering "Rot < Vib < Elec ↔ Micro < IR < UV")
- **"Last 10 minutes before the exam" page:** the top 15 facts plus the top 10 formulas

### 7.6 Doc 6: Master document (combined, organised by topic)

Structure:
1. Cover page: title, course code, unit, "Compiled from PESU AV summaries, class slides and past ESA papers", generation date
2. "How to use this pack" (legend for badges, flags and source tags)
3. Table of contents (linked)
4. **For each topic T1 to T13**, in this fixed sub-order:
   1. Overview (3–4 sentences)
   2. Key terms and definitions
   3. Formulas (cards), with symbol mini-glossary
   4. Derivation(s), full step-by-step where examinable: moment of inertia, E_J → ε_J → spectrum, SHO levels, phase rule
   5. Graphs and diagrams (same figures as Doc 3, reused by ID)
   6. Flowchart or process (reused from Doc 4)
   7. Important points and "why" explanations
   8. Worked numerical examples (from §5.1 papers): given, formula, substitution, answer with units
   9. Past-paper questions
   10. Short-note recap box
5. Appendix A: full symbol glossary
6. Appendix B: constants and unit conversions
7. Appendix C: "Possibly examinable, not in current material" (Beer–Lambert, Fe–C, CO₂ diagram), each one paragraph, clearly flagged
8. Appendix D: source index, listing every source file used with its HF path

---

## 8. Design and formatting system (shared by all six documents)

### 8.1 Page and layout
- **A4 portrait**, margins 18 mm top and bottom, 16 mm left and right. Landscape is allowed for the concept map (F1) and the EM spectrum (G5) only, using a named `@page landscape` page.
- Single column for prose; a two-column grid for formula cards and short notes where it fits.
- Running header: document title on the left, "Engg. Chemistry · Unit 1" on the right. Running footer: page X of Y, centred. Use Playwright `headerTemplate` / `footerTemplate` with `displayHeaderFooter: true`.
- Each **module** starts on a new page (`break-before: page`). Cards, figures, tables and derivations get `break-inside: avoid`. Table headers repeat across pages (`thead { display: table-header-group }`).

### 8.2 Typography
- Body: **"Source Serif 4"** or **"Literata"**, 10.5 pt, line-height 1.45.
- Headings, labels and tables: **"Inter"**, 600–700 weight.
- Code and IDs: **"JetBrains Mono"**, 9 pt.
- **Self-host the fonts** by downloading the woff2 files into `output/assets/fonts/` and loading them with `@font-face`, so PDF rendering doesn't depend on the network.
- Heading scale: H1 22 pt (module), H2 16 pt (topic), H3 12.5 pt (sub-section).

### 8.3 Colour (print-safe, colour-blind-safe, still readable in greyscale)
Define CSS custom properties in `:root` and use them everywhere:
```
--ink:#1b1f24; --muted:#5b6470; --rule:#d9dee5; --paper:#ffffff;
--m1:#1f5fa8;  /* Spectroscopy - blue   */
--m2:#2e7d4f;  /* Phase equilibria - green */
--m3:#7a4fb3;  /* Computational - violet */
--formula-bg:#f4f7fb; --note-bg:#fff8e6; --warn-bg:#fdecec; --flag:#b26b00;
```
Each module's accent colour is used on its H1 rule, its topic chips and its card left borders. Never encode meaning by colour alone: badges also carry text or stars.

### 8.4 Components (build once as CSS classes and reuse)
- `.formula-card`: light-blue background, 3 px accent left border; equation centred; below it, a small grid showing *Gives · Applies when · Units · Source* and a weight badge in the top-right corner
- `.def`: term in bold small-caps, then the definition
- `.statement`: law or principle wording, in a bordered quote style
- `.why`: Q in bold, then the reasoning, on a yellow note background
- `.trap`: "Exam trap" box on a pale-red background
- `.worked`: three-column *Given / Solution / Answer* block; final answer boxed
- `.pyq`: past-paper question with year chip and marks chip
- `.flag`: amber chip with the text "Not on current slides", "Transcript only" or "Added for clarity"
- `.src`: tiny grey source tag such as `[S004·8]`, `[T005 12:31]`, `[PDF p.24]`, `[ESA Jun-24 Q1b]`
- `.badge`: ★★★ / ★★ / ★
- Figure: `<figure>` holding inline SVG and a `<figcaption>` "Fig. G21 — Franck–Condon principle, three cases"

### 8.5 Math
- Write all math in LaTeX and render with **KaTeX** (vendored locally, e.g. `npm i katex` and copy the `dist/` folder into `output/assets/katex/`). Use display mode for formula cards and inline mode in prose.
- Prefer **pre-rendering at build time** (KaTeX `renderToString` in a Node build script) so the HTML contains static math markup. This avoids timing problems during PDF printing.
- Use consistent notation: ν̄ as `\bar{\nu}`; ω̄ₑ as `\bar{\omega}_e`; primes for the excited state (v′, ε′) and double primes for the ground state (v″, ε″); always show units with `\text{cm}^{-1}`.

### 8.6 Figures and plots
- **Quantitative plots** (Morse vs harmonic, stick spectra, rotational levels, progression, cooling curves, phase diagrams, ethane barrier): generate them with **Python + matplotlib** and export as **SVG** (`plt.savefig(..., format="svg")`, `svg.fonttype = 'none'` so the text stays text). Use the same fonts and module colours. Inline the SVG into the HTML.
  - Phase diagrams are **schematic, not to scale**. Say so in the caption. Annotate the actual values (e.g. 0.0098 °C, 4.58 mm Hg) as labels.
- **Schematic drawings** (spectrophotometer, rigid rotor, CO₂ modes, MO diagram, Franck–Condon panels): hand-author them as inline SVG, or draw them in matplotlib. Keep them simple and clearly labelled.
- **Flowcharts** (Doc 4): write them in **Mermaid** and pre-render to SVG with `@mermaid-js/mermaid-cli` (`mmdc -i f.mmd -o f.svg`, with its puppeteer pointed at the existing Chromium via `PUPPETEER_EXECUTABLE_PATH`). Alternatively, use Graphviz `dot -Tsvg` if Mermaid isn't available. Inline the resulting SVG.
- All figures need a minimum stroke of 1 pt and text of 8 pt or larger at print size. Use colour plus line-style (solid, dashed, dotted) so figures survive greyscale printing.

### 8.7 HTML authoring rules
- Each HTML file must be **self-contained apart from `output/assets/`**: no CDN links at print time.
- Put print-specific CSS in `@media print` and `@page`.
- Use semantic structure: `<header>`, `<nav id="toc">`, `<section data-topic="T4">`, `<figure>`, `<table>`.
- Every topic section has an `id` (e.g. `#T4`) so the TOC and cross-references link correctly. In the master document, link each figure or formula ID to its first definition.
- Use one shared stylesheet, `output/assets/study.css`, for all six documents.

---

## 9. HTML → PDF conversion

Use **Playwright (Chromium)**. Chromium is pre-installed; don't run `playwright install`. If the pinned Playwright version mismatches, pass `executablePath` explicitly.

```python
# build_pdf.py (sketch)
from playwright.sync_api import sync_playwright
docs = ["00_MASTER_unit1_complete", "01_formulas_and_symbols", "02_important_points",
        "03_graphs_and_diagrams", "04_flowcharts_and_visuals", "05_short_notes_keywords"]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    for d in docs:
        pg.goto(f"file://{OUT}/{d}.html", wait_until="networkidle")
        pg.evaluate("document.fonts.ready")
        pg.pdf(path=f"{OUT}/{d}.pdf", format="A4", print_background=True,
               prefer_css_page_size=True, display_header_footer=True,
               header_template=HEADER, footer_template=FOOTER,
               margin={"top":"18mm","bottom":"18mm","left":"16mm","right":"16mm"},
               outline=True, tagged=True)   # drop outline/tagged if the version lacks them
    b.close()
```
If a page includes client-side rendering (you should avoid this), wait for a `window.__READY__ = true` flag before printing.

---

## 10. Quality assurance (all must pass before finishing)

1. **Coverage:** every item in the §7 minimum lists exists. Every one of the 12 decks and 14 transcripts is cited at least once. Print a coverage table to `work/coverage.md` (source file → number of kb items).
2. **Formula fidelity:** every formula has been compared visually with its rendered slide image (§3.1). List the slide reference next to each formula in `kb.json` as `verification`.
3. **Numerical check:** every worked example matches §5.1 within about 1%.
4. **Dimensional check:** units shown for every formula result and every worked answer.
5. **Consistency:** the same symbol means the same thing across all six docs, and clashes (μ, P, ε) are flagged in the glossary. The master document and docs 1–5 come from the same `kb.json` and don't contradict each other.
6. **No ASR artefacts:** grep the output HTML for "Ambert", "Glossier", "Clabron", "Clapebron", "rally scatter", "lumon", "rotar" and "digit rotor". All must return zero hits.
7. **Flags honest:** anything not on the 2026 slides carries a `.flag` chip.
8. **PDF checks:** all 6 PDFs open, page count is reasonable (the master doc is likely 40–70 pages), there are no blank pages, no figures split across pages, and `pdffonts` shows embedded fonts. Render pages 1, 2 and a random middle page of each PDF to PNG (`pdftoppm -r 70`) and look at them for overflow, clipped SVGs and unrendered LaTeX (raw `$` or `\frac` visible).
9. **Links:** TOC links in the HTML resolve to existing IDs.

---

## 11. Final folder layout

```
output/
  00_MASTER_unit1_complete.html / .pdf
  01_formulas_and_symbols.html / .pdf
  02_important_points.html / .pdf
  03_graphs_and_diagrams.html / .pdf
  04_flowcharts_and_visuals.html / .pdf
  05_short_notes_keywords.html / .pdf
  assets/  study.css  fonts/  katex/  figures/*.svg
work/
  sources/  render/  kb.json  conflicts.md  coverage.md
build/
  extract.py  build_html.py (or build.mjs)  figures.py  build_pdf.py
README.md   (how to rebuild; list of sources; known gaps)
```

Write build scripts in `build/`, outside the download directory. Run every Python script that reads downloaded files with `python3 -I`.

## 12. What to report back when done

- Paths to the 6 HTML and 6 PDF files, with page counts
- The coverage table and the contents of `conflicts.md`
- The list of items flagged "not on current slides" or "transcript only"
- Any source that couldn't be read, and why
