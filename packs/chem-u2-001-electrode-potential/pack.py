"""Pack metadata: UE26CY151A Unit 2, class 001 — Origin of electrode potential, cell potential."""
HF = "pesuc/PESU_Materials/Sem-1/UE26CY151A_Engineering_Chemistry/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Chemistry/"

PACK = {
    "course": "UE26CY151A Engineering Chemistry",
    "unit": "Unit 2 · Electrochemistry and Corrosion",
    "scope": "Class 001 · Origin of electrode potential, cell potential",
    "title": "Origin of Electrode Potential and Cell Potential",
    "subtitle": "Complete study pack for class 001: galvanic and electrolytic cells, electrode potential and the Helmholtz "
                "double layer, standard electrode potential, cell notation, cell potential, $\\Delta G=-nFE$ and the "
                "electrochemical series",
    "slug": "electrode_potential",
    "header": "Engg. Chemistry · Unit 2 · Class 001",
    "compiled_from": "Compiled from the PESU Unit 2 class 001 slide deck and the first 19 minutes of its AV-summary transcript, "
                     "cross-checked against the consolidated Unit 2 slides, with past ESA papers for weighting and problems.",
    "how_to_use": "Topics 1–5 follow the lecture. The Nernst equation, taught in the second half of the same video, is the "
                  "subject of the class 002 pack. Cell numericals with non-standard concentrations (Nernst) are in classes 002 "
                  "and 006; here every worked example stops at $E^\\circ_{cell}$ and $\\Delta G^\\circ$. Learn F4.1 and W4.1 first: "
                  "the same steps open every ESA cell problem.",
    "pyq_note": "Ten unique ESA papers were checked (UE22CY151B Jul 2023 a/b, Dec 2023, May 2024, Dec 2024; UE23CY151A/B Jan 2024 "
                "set 2, Jun 2024 a/b, Dec 2024; UE24CY151A Jan 2025 sets 1 and 2; three 2024 files are one paper). Directly on "
                "this class: Jan 2025 set 2 Q2.b(i), 3 marks (double layer, case I). The electrochemical series is applied in "
                "Jul 2023 Q4.d(i) (zinc versus tin coating; primary class 010). $E_{cell}=E_{cathode}-E_{anode}$ is used in every "
                "UE23/UE24 Q2 cell numerical (Jul-23a 2.c, Dec-23 2.c, Jun-24b 2.a and others; primary class 006), so the "
                "convention is rated ★★★. The galvanic/electrolytic comparison, cell notation as a stand-alone question, the "
                "standard-electrode-potential definition and $\\Delta G=-nFE$ as a separate question were never asked.",
    "figure_note": "Colours follow the Okabe–Ito order. G2.1, G2.2 and G5.1 redraw slides 001·6, 001·7 and 001·10 (no "
                   "screenshots). G1.1, G3.1, G3.2, G4.1 and G5.2 are schematics added for clarity (the deck has no cell "
                   "diagram); they are not to scale.",
    "symbols_remark": "$n$ means the charge of the ion in $\\mathrm{M^{n+}}$ and the number of electrons transferred; for a single "
                      "electrode they coincide, for a cell $n$ is the electron count of the balanced overall reaction (6 for "
                      "$\\mathrm{3Fe+2Au^{3+}}$).",
    "coverage_note": "Slides 001·1, 001·2 and 001·11 are title, contents and closing slides. The deck says “Class 14 content” "
                     "(older numbering); it is session 001 of Unit 2 in the bucket. Transcript T001 covers classes 001 and 002: "
                     "this pack uses 00:00:00–00:18:50; 00:18:50–00:25:55 (Nernst equation) belongs to pack chem-u2-002, and "
                     "is cited here only for $W_{max}=nFE$. The series values on slide 001·10 exist only in the slide image.",
    "tag_legend": [
        ("S001·10", "Deck 001, slide 10 (rendered .pptx)"),
        ("T001 00:08:22", "AV-summary transcript 001, segment start"),
        ("ESA Jan-25 s2 2b", "Past paper: Jan 2025 set 2, question 2.b"),
        ("ESA Jul-23a 4d", "Past paper: Jul 2023 (first UE22 paper), question 4.d"),
    ],
    "sources": [
        {"name": "Deck 001 (.pptx rendered at 80 dpi; .slides.md; .slides.txt)",
         "path": HF + "Slides/001_Origin_of_electrode_potential_cell_potential__c76de2692d228d06.*", "use": "11 slides; content on 3–10"},
        {"name": "Transcript 001 (.transcript.md, .transcript.txt)",
         "path": HF + "AV_Summaries/001_Origin_of_electrode_potential_cell_potential__3e2916789bf0cc7b.*",
         "use": "25.9 min lecture; 00:00–18:50 used (the rest is Nernst, class 002)"},
        {"name": "Consolidated Unit 2 slides (older syllabus)", "path": HF2 + "Slides/Chem_Slides_Unit-2__1C1NjUHA4j.pdf",
         "use": "Same slides 3–10; problem 7 (Fe/Au, 1.52 V); series uses in corrosion"},
        {"name": "ESA papers (13 files, 10 unique)", "path": HF2 + "Papers/ESA Papers/*/*.pdf",
         "use": "Jan-25 s2 2.b(i); Jul-23a 4.d(i); E°cell steps of Jul-23a 2.c, Dec-23 2.c, Jun-24b 2.a, Jan-25 s1 2.a"},
        {"name": "Video 001 (.mp4)", "path": HF + "AV_Summaries/001_*.mp4",
         "use": "Not opened: every slide was readable in the render; no video trigger applied"},
    ],
    "gaps": [
        "No class-work (CW) sheet for Chemistry exists in the bucket; worked examples are built from the slides and ESA papers and verified with sympy.",
        "Transcript 001 also covers class 002 (Nernst equation, from 00:18:50); that part is left to pack chem-u2-002.",
        "Slide 001·10 (series table, image only) prints “Silver: A+(aq)” for $\\mathrm{Ag^+}$; corrected.",
        "Slide 001·10 gives $E^\\circ(\\mathrm{Au^{3+}/Au})=+1.50$ V; the ESA Fe/Au problems (Dec-23 2.c, Jun-24b 2.a) and consolidated-slide problem 7 use 1.52 V. Both are shown (W4.4). Li ($-3.03$) and K ($-2.92$) are also slightly off the usual tabulated $-3.04$ and $-2.93$ V; slide values are kept.",
        "Slide 001·10's right-hand arrow says “Metal Oxidizing Activity Increasing” downwards; it is the oxidising power of the ion that increases downwards. Clarified as an exam trap.",
        "The slides spell the cell “Daniel cell” and use / and // in the notation; written here as Daniell and | , || (both notations are accepted).",
        "The deck has no cell diagram; the Daniell cell, electrolytic cell and potential-scale figures are added for clarity.",
        "The slide says single electrode potentials cannot be measured but does not name the reference; SHE = 0.00 V is added for clarity (it is the 0.00 V row of the series).",
        "At T001 00:15:01 the lecturer says “standard electrode potential” where the standard cell potential is meant; the slide wording is followed.",
        "Transcript recognition errors corrected silently: “detox/redux reaction” → redox reaction; “hellholes / And molds / Helmor's electric double layer” → Helmholtz electrical double layer; “ionside” → ions; “zirconium oxide dope by two or three” → zirconia doped with Y2O3; “Daniel Cell” → Daniell cell; “zipped” → dipped.",
    ],
    "asr_forbidden": ["hellholes", "Helmor", "molds", "detox", "redux", "ionside", "zipped"],
}
