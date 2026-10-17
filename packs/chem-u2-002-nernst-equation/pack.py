"""Pack metadata: UE26CY151A Unit 2, class 002 — Nernst equation and its derivation."""
HF = "pesuc/PESU_Materials/Sem-1/UE26CY151A_Engineering_Chemistry/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Chemistry/"

PACK = {
    "course": "UE26CY151A Engineering Chemistry",
    "unit": "Unit 2 · Electrochemistry and Corrosion",
    "scope": "Class 002 · Nernst equation and its derivation",
    "title": "Nernst Equation and its Derivation",
    "subtitle": "Complete study pack for class 002: maximum work and free energy, the step-by-step derivation of the Nernst "
                "equation for a single electrode, the 0.0591/n form at 298 K, the effect of concentration and temperature, "
                "and the Nernst equation for a cell",
    "slug": "nernst_equation",
    "header": "Engg. Chemistry · Unit 2 · Class 002",
    "compiled_from": "Compiled from the PESU class 002 slide deck (labelled “Class 15 content”), the Nernst-equation part of the "
                     "class 001 AV-summary transcript (the class 001 video covers classes 1 and 2), the consolidated Unit 2 slide PDF "
                     "and past ESA papers.",
    "how_to_use": "Topics 1–4 follow the lecture: free energy and cell potential, the derivation, using the single-electrode "
                  "equation, and the cell form. Learn flowchart F2.1 for the 5–6-mark derivation; it reproduces the slides line by "
                  "line. Then practise W4.1 (the ESA Jan 2025 cell) and W4.2. The cell numericals of class 006 all start from "
                  "formula E4.1.",
    "pyq_note": "Ten deduplicated Chemistry ESA papers (UE22CY151B Jul 2023 ×2, Dec 2023, May 2024; UE23CY151A/B Jan 2024 set 2, "
                "Jun 2024 ×2, Dec 2024, Dec 2024 UE22; UE24CY151A Jan 2025 sets 1 and 2) were checked. The Nernst derivation is "
                "asked directly twice: ESA Dec 2024 Q2.a (single electrode, 5 marks) and ESA Jan 2025 set 1 Q2.a (cell form plus "
                "emf, 6 marks). In addition, every UE23/UE24 paper has a Q2 cell numerical (calomel, redox, concentration cell) "
                "that uses the cell form of the equation; those are mapped to classes 004–006. The equilibrium constant, the "
                "temperature effect and the E vs log[M<sup>n+</sup>] plot were never asked.",
    "figure_note": "The deck has no diagrams; all six figures are added for clarity and drawn with standard textbook values "
                   "($E^\\circ$: Zn −0.76 V, Cu +0.34 V, Al −1.66 V). Okabe–Ito colours: blue for the first series, vermilion "
                   "for the second, green for the third; grey dashed lines are references ($E=E^\\circ$, $Q=1$). Cell sketches "
                   "are schematic, not to scale.",
    "symbols_remark": "$E$ means the electrode potential in the single-electrode equation (E2.4) and the cell emf in the cell "
                      "equation (E4.1); the slides use the same letter for both. $n$ is the number of electrons in the "
                      "<i>balanced</i> reaction, which is 6 (not 2 or 3) for the Al–Cu cell. $\\log$ is base 10 and $\\ln$ base $e$.",
    "coverage_note": "Deck 002 has six slides: 1 (title), 2 (class content), 3–5 (content) and 6 (thank you). LibreOffice overlaps "
                     "two text boxes on slide 3 (the W<sub>max</sub> line); the same slide in the consolidated PDF (p.12) is "
                     "clean and identical in content, so PDF pp.12–14 were used to confirm every equation. There is no separate "
                     "class 002 video: the class 001 video (T001) teaches the derivation from 00:18:50 to 00:25:55, and that "
                     "part is cited as T001.",
    "notation_table": {"title": "Constants and conversions used in this class",
                       "head": ["Quantity", "Value used on the slides", "Remark"],
                       "rows": [["$R$", "$8.314\\ \\mathrm{J\\,K^{-1}\\,mol^{-1}}$", "gas constant"],
                                ["$F$", "$96500\\ \\mathrm{C\\,mol^{-1}}$", "charge on one mole of electrons (exact 96485)"],
                                ["$T$", "$298\\ \\mathrm{K}$", "25 °C; standard temperature"],
                                ["$\\ln x$", "$2.303\\log_{10}x$", "$\\ln 10=2.3026$"],
                                ["$RT/F$ at 298 K", "$0.02567\\ \\mathrm{V}$", "sympy"],
                                ["$2.303RT/F$ at 298 K", "$0.0591\\ \\mathrm{V}$", "$0.05913$ with slide constants; $0.05916$ with CODATA at 298.15 K"],
                                ["$2.303RT/F$ at 308 K", "$0.0611\\ \\mathrm{V}$", "scales with $T$"],
                                ["$1\\ \\mathrm{V}$", "$1\\ \\mathrm{J\\,C^{-1}}$", "so $nFE$ is in J"]]},
    "tag_legend": [
        ("S002·4", "Deck 002, slide 4 (rendered .pptx)"),
        ("T001 00:21:42", "Class 001 AV-summary transcript (covers classes 1 and 2), segment start"),
        ("PDF p.13", "Consolidated Unit 2 slide PDF (older syllabus), page 13"),
        ("ESA Jan-25 s1 2a", "Past paper: Jan 2025, set 1, question 2.a"),
    ],
    "sources": [
        {"name": "Deck 002 (.pptx rendered at 80 dpi; .slides.md; .slides.txt)",
         "path": HF + "Slides/002_Nernst_equation_and_its_derivation__49dac35211b6d743.*", "use": "6 slides; content on 3–5 (equations only in the images)"},
        {"name": "Transcript 001 (.transcript.md / .txt)",
         "path": HF + "AV_Summaries/001_Origin_of_electrode_potential_cell_potential__3e2916789bf0cc7b.*",
         "use": "Nernst part 00:16:15–00:25:55 (the video covers classes 1 and 2 per DOWNLOAD_MANIFEST)"},
        {"name": "Consolidated Unit 2 slides (8enterprise)", "path": HF2 + "Slides/Chem_Slides_Unit-2__1C1NjUHA4j.pdf",
         "use": "pp.12–14: same three slides, clean layout; confirms every equation"},
        {"name": "ESA papers (10 deduplicated)", "path": HF2 + "Papers/ESA Papers/*/*.pdf",
         "use": "Dec 2024 Q2.a and Jan 2025 set 1 Q2.a (rendered at 90 dpi)"},
        {"name": "Class-work sheet", "path": "—", "use": "None exists for Chemistry in the bucket"},
    ],
    "gaps": [
        "There is no class 002 video or transcript. Per DOWNLOAD_MANIFEST the class 001 video (3e2916789bf0cc7b) is tagged for classes 1 and 2; its Nernst part (T001 00:18:50–00:25:55) is used and cited as T001.",
        "No class-work (CW) sheet exists for Chemistry in the bucket, so all worked examples come from ESA papers or are constructed (flagged) and verified with sympy.",
        "The deck is titled “Class 15 content” (older numbering); the content is the same as consolidated PDF pp.12–14.",
        "Slide 002·3 renders with two overlapping text boxes (“W<sub>max</sub> =” over “For an electrochemical system, maximum work done is”); a LibreOffice layout artefact, read from PDF p.12 instead. No content error.",
        "The deck works no numerical example. Worked examples W3.1–W3.3, W4.2 and W4.3 are constructed with textbook $E^\\circ$ values and flagged; W4.1 is ESA Jan 2025 set 1 Q2.a.",
        "ESA Jan 2025 set 1 Q2.a prints “2Al + 3Cu<sup>2+</sup>(0.6 M) → 2Al<sup>3+</sup>(0.35 M) + Cu”: the copper is unbalanced. The balanced reaction has 3Cu and $n=6$; the answer is $E_{cell}=2.0024$ V (sympy). Solids do not enter $Q$, so the slip does not change the number.",
        "The lecturer says “ΔG = ΔG° + RT over nF ln Q” at T001 00:24:39 while extending to the cell; the slide (and the single-electrode part, T001 00:21:42) has $\\Delta G=\\Delta G^\\circ+RT\\ln Q$. Corrected as an exam trap.",
        "The lecturer says “RT log Q” for the natural log (T001 00:21:42) and the slide writes RTlnQ; the pack uses ln until the 2.303 conversion.",
        "The slide value $F=96500\\ \\mathrm{C\\,mol^{-1}}$ is rounded (96485). With the slide constants $2.303RT/F=0.05913$ V; with CODATA constants at 298.15 K it is $0.05916$ V. Both round to the slide's 0.0591 V.",
        "The equilibrium constant ($\\log K=nE^\\circ/0.0591$) and the temperature form are not on the slides or in the lecture; they appear as short notes flagged “added for clarity”.",
        "Transcript recognition errors were corrected silently: “learnst” and “nonst” → Nernst, “Faradin” → Faraday, “stechometric”/“stepometric” → stoichiometric, “R P over N F” → RT/nF, “P is the temperature” → T.",
    ],
    "asr_forbidden": ["learnst", "nonst", "Faradin", "stechometric", "stepometric"],
}
