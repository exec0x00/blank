"""Pack metadata: UE26MA141A Unit 1, class 005 — Homogeneous functions and Euler's theorem."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 1 · Partial Differentiation",
    "scope": "Class 005 · Homogeneous functions and Euler's theorem",
    "title": "Homogeneous Functions and Euler's Theorem",
    "subtitle": "Complete study pack for class 005: homogeneous functions and their degree, Euler's theorem, the second- and "
                "higher-order corollary, the extension for f(u), and applications",
    "slug": "homogeneous_euler",
    "header": "Engg. Mathematics I · Unit 1 · Class 005",
    "compiled_from": "Compiled from the PESU class 005 slide deck and AV-summary transcript, the Unit 1 class-work sheet and past ESA papers.",
    "how_to_use": "Topics 1–5 follow the lecture. Class 006 (“Problems on Euler's theorem”) is a separate session and is not "
                  "included; the worked problems here come from the class-work sheet and past ESA papers.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024. Euler's theorem appears in six of them: Jul 2023 Q1.a, May 2024 Q1.a, June 2024 Q1.b (the same "
                "question as May 2024), Jan 2024 set 3 Q1.c, set 4 Q1.d, and set 1 Q1.d (a degree-0 function, also solvable by the "
                "chain rule). Five are 6-mark questions, so this is one of the most examined topics in Unit 1. The definition, "
                "applications and third-order result were not asked.",
    "figure_note": "Colours follow the Okabe–Ito order. Both figures are added for clarity, since the deck has no graphs: one shows "
                   "how a homogeneous function scales along a ray, the other shows level curves of $x^2+xy+y^2$ as scaled copies.",
    "symbols_remark": "The letter $g$ has two meanings: the arbitrary function of ratios in $x^ng(y/x)$ (topic 1), and "
                      "$g(u)=nf(u)/f'(u)$ in the extension (topic 4).",
    "coverage_note": "Slides 005·1, 005·2 and 005·8 are title, session and closing slides. Slide 005·7's equations exist only in the "
                     "slide image; the text export loses them.",
    "tag_legend": [
        ("S005·6", "Deck 005, slide 6 (rendered .pptx)"),
        ("T005 00:08:57", "AV-summary transcript 005, segment start"),
        ("CW U1 P20", "Unit 1 class-work problem 20"),
        ("ESA Jan-24 s3 1c", "Past paper: Jan 2024, set 3, question 1.c"),
    ],
    "sources": [
        {"name": "Deck 005 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/005_Homogeneous_functions_and_Euler_s_theorem__b933003cc540ac04.*", "use": "8 slides; content on 3–7"},
        {"name": "Transcript 005 (all 4 formats)",
         "path": HF + "AV_Summaries/005_Homogeneous_functions_and_Euler_s_theorem__a0c2c43d28f6ec69.*", "use": "19.4 min lecture"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "use": "Problems 19–23 (with answers)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf", "use": "6 in-scope Q1 parts"},
        {"name": "Video 005 (.mp4)", "path": HF + "AV_Summaries/005_*.mp4", "use": "Not opened: slide 7 is readable in the rendered image"},
    ],
    "gaps": [
        "Slide 005·7 (the extension of Euler's theorem) has its equations only as images; the .slides.md text shows just the title. They were read from the rendered slide.",
        "Slide 005·4 writes $x^3\\big(1+(y/x)^2+(z/x)^3+3\\frac yx\\frac zx\\big)$; the second exponent should be 3.",
        "The lecture (T005 00:07:11) says that a function of degree 0 must be constant. That is false ($y/x$ has degree 0); corrected as an exam trap.",
        "The lecture (T005 00:11:06) calls homogeneous functions “smooth everywhere”; homogeneity is a scaling property, not smoothness.",
        "The lecture (T005 00:16:46) swaps the thermodynamics examples: mass is extensive (degree 1); pressure and temperature are intensive (degree 0).",
        "The lecture's third-order list of partial derivatives (T005 00:12:43) is incomplete; the result $n(n-1)(n-2)u$ is stated with the binomial coefficients added for clarity.",
        "Biographical remarks about Euler in the lecture are left out (not examinable, and partly inaccurate).",
        "Class 006 (“Problems on Euler's theorem”, two transcripts) is a separate session and is not included.",
        "Transcript recognition errors were corrected silently: “oiless theorem” → Euler's theorem, “Euless theorem” → Euler's theorem, “quintiple” → quintic, “y bytes” → y/x.",
    ],
    "asr_forbidden": ["oiless", "Euless", "quintiple", "bytes"],
}
