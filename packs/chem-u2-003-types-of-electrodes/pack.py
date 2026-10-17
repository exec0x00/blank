"""Pack metadata: UE26CY151A Engineering Chemistry, Unit 2, class 003 — Types of electrodes."""
HF = "pesuc/PESU_Materials/Sem-1/UE26CY151A_Engineering_Chemistry/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Chemistry/"

PACK = {
    "course": "UE26CY151A Engineering Chemistry",
    "unit": "Unit 2 · Electrochemistry and Corrosion",
    "scope": "Class 003 · Types of electrodes",
    "title": "Types of Electrodes",
    "subtitle": "Complete study pack for class 003: the six types of electrodes (metal–metal ion, metal–insoluble salt–anion, "
                "gas, amalgam, oxidation–reduction with the quinhydrone electrode, and ion-selective membrane electrodes), "
                "each with its representation, electrode reaction, Nernst equation and an example",
    "slug": "types_of_electrodes",
    "header": "Engg. Chemistry · Unit 2 · Class 003",
    "compiled_from": "Compiled from the PESU class 003 slide deck (titled “Class 16 content”) and its AV-summary transcript, "
                     "the older consolidated Unit 2 slide PDF, and ten deduplicated past ESA papers.",
    "how_to_use": "Topic 1 is the map: the classification tree, the comparison of all six types and the one procedure for writing "
                  "any electrode's Nernst equation. Topics 2–7 take one type each in the deck's order. Every type has the same four "
                  "parts: representation, electrode (reduction) reaction, Nernst equation and an example. The numericals are short "
                  "and verified with sympy; standard potentials that the deck does not give are marked as given data. Reference "
                  "electrodes (calomel in detail) are class 004; the glass-electrode construction and pH numericals are in Unit 3.",
    "pyq_note": "Ten deduplicated ESA papers (Jul 2023 a/b, Dec 2023, Jan 2024 set 2, May 2024, Jun 2024 a/b, Dec 2024 UE23 and "
                "UE22, Jan 2025 sets 1 and 2) were checked. Class 003 is asked three times: Dec 2023 Q2.d (4 marks: notes on the "
                "oxidation–reduction electrode and the gas electrode), and Jun 2024a Q2.b(i) and Jan 2025 set 1 Q2.b(i) (define an "
                "ion-selective electrode and write the cell when a glass electrode is coupled with a (saturated) calomel electrode). "
                "The glass + SCE pH numerical that follows those questions was asked in 9 of the 10 papers, but in the 2026 syllabus it "
                "belongs to Unit 3 (pH sensor, class 36). The metal–metal ion, metal–insoluble salt, amalgam and quinhydrone "
                "electrodes were never asked on their own.",
    "figure_note": "Every figure is redrawn as a schematic (not to scale) with the Okabe–Ito colours: blue for solutions and "
                   "reduced species, vermilion for the oxidised form and charge, orange for gases. G6.2 (potential against pH) is "
                   "added for clarity; the glass line uses an illustrative $E^\\circ_G$, since $E^\\circ_G$ differs from electrode "
                   "to electrode.",
    "symbols_remark": "$E^\\circ$ is the standard reduction potential of the electrode named in its subscript. Square brackets "
                      "are molar concentrations (strictly activities); for a gas the partial pressure $p$ (atm) takes their place. "
                      "$Q$ and $\\mathrm{QH_2}$ are quinone and hydroquinone, not the reaction quotient.",
    "coverage_note": "Slides 003·1, 003·2 and 003·10 are title, session and closing slides. The Nernst equations of slides 003·4–8 "
                     "exist only as images; the text exports scatter them. The transcript covers every content slide (19 minutes).",
    "tag_legend": [
        ("S003·5", "Deck 003, slide 5 (rendered .pptx)"),
        ("T003 00:07:50", "AV-summary transcript 003, segment start"),
        ("PDF p.57", "Older consolidated Unit 2 slide PDF (8enterprise), page 57"),
        ("ESA Dec-23 2d", "Past paper: ESA Dec 2023, question 2.d"),
        ("ESA Jan-25 s1 2b", "Past paper: ESA Jan 2025 set 1, question 2.b"),
    ],
    "sources": [
        {"name": "Deck 003 (.pptx rendered at 80 dpi; .slides.md; .slides.txt)",
         "path": HF + "Slides/003_Types_of_electrodes__ca435e53fd3f8afb.*", "use": "10 slides; content on 3–9"},
        {"name": "Transcript 003 (.transcript.md / .txt)",
         "path": HF + "AV_Summaries/003_Types_of_electrodes__5665b6defd1e742e.*", "use": "18.6-minute lecture, read in full"},
        {"name": "Consolidated Unit 2 slides (older syllabus)", "path": HF2 + "Slides/Chem_Slides_Unit-2__1C1NjUHA4j.pdf",
         "use": "Cross-check of slides 17–24; ISE types (p.45); glass + calomel cell (p.56–58); calomel table (p.33)"},
        {"name": "ESA papers (13 files, 10 unique papers)", "path": HF2 + "Papers/ESA Papers/*/*.pdf",
         "use": "3 in-scope questions (mapped in packs/_shared/chem/esa_map.md)"},
        {"name": "Video 003 (.mp4)", "path": HF + "AV_Summaries/003_*.mp4", "use": "Not opened: every slide is readable and the transcript covers it"},
    ],
    "gaps": [
        "No class-work (CW) sheet for Engineering Chemistry exists in the bucket, so the numericals are built from the deck's "
        "equations with standard data and checked with sympy; none comes with an official answer key.",
        "The deck gives no standard potentials except $E^\\circ_{Q/QH_2}=+0.699$ V. The values used in the worked examples "
        "($E^\\circ$ of $\\mathrm{Zn^{2+}/Zn}$ −0.76 V, $\\mathrm{Ag/AgCl}$ 0.222 V, $\\mathrm{Cl_2/Cl^-}$ 1.36 V, "
        "$\\mathrm{Sn^{4+}/Sn^{2+}}$ 0.15 V, $\\mathrm{Fe^{3+}/Fe^{2+}}$ 0.77 V, lead amalgam −0.120 V) are stated as given data. "
        "0.222 V and 0.77 V are the values used in the consolidated PDF (p.67).",
        "pH numericals with the glass electrode and a calomel electrode (asked in 9 of the 10 papers) and the glass-electrode "
        "construction belong to Unit 3 (pH sensor, class 36) in the 2026 syllabus. This pack keeps only the ISE definition, the "
        "slide's equation $E_G=E^\\circ_G+0.0591\\log[\\mathrm{H^+}]$ and the cell representation that ESA asks here (W7.1).",
        "The cell representation of glass + calomel is written in the consolidated PDF (p.57) with calomel on the left: "
        "$\\mathrm{Hg|Hg_2Cl_2|Cl^-||}$ test solution $\\mathrm{|glass|0.1\\,N\\,HCl|AgCl|Ag}$, with $E_{cell}=E_G-E_{cal}$. "
        "Many textbooks put the glass electrode on the left. Both are accepted if $E_{cell}$ is written to match; W7.1 follows "
        "the PESU form.",
        "Rendered slide 003·5: LibreOffice garbles the hydrogen-electrode Nernst equation (subscripts print as “PtTH”). It was "
        "read as $E=E^\\circ-\\frac{0.0591}{2}\\log\\frac{p_{H_2}}{[H^+]^2}$, which the lecture states word for word (T003 00:07:50).",
        "Slide 003·7: the stannous–stannic reaction overlaps the line above it in the rendering; it is "
        "$\\mathrm{Sn^{4+}+2e^-\\rightleftharpoons Sn^{2+}}$ (text export and T003 00:13:31).",
        "Slide 003·8 draws quinone → hydroquinone with a one-way arrow; as an electrode it is an equilibrium (⇌), as the "
        "Nernst equation on the same slide assumes. The slide does not number the quinhydrone electrode; the lecture calls it "
        "a special case of the redox electrode (type 5).",
        "Added for clarity (flagged): the pH forms $E=-0.0591\\,\\mathrm{pH}$ (hydrogen) and $E=0.699-0.0591\\,\\mathrm{pH}$ "
        "(quinhydrone, $[Q]=[QH_2]$), the chlorine-electrode equation, the use of sodium amalgam (transcript only), the "
        "quinhydrone limit of pH 8, and the classification tree's three groups.",
        "Deck 003 calls itself “Class 16 content” and the lecture says “module four”: numbering from an older course plan; "
        "the bucket session number 003 is used here.",
        "Transcript recognition errors were corrected silently: “Nant equation” → Nernst equation, “iron selective” → "
        "ion selective, “calomyl” → calomel, “Merkle” → mercury, “metaline electrode” → metal–metal ion electrode, "
        "“quin hydron” → quinhydrone, “hydroquinole” → hydroquinone, “silver plus iron” → silver ion, “sparingly soluble sort” → salt.",
    ],
    "asr_forbidden": ["Nant", "iron selective", "calomyl", "Merkle", "metaline", "quin hydron", "hydroquinole", "soluble sort"],
}
MODULES = []
