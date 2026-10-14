"""Pack metadata: UE26MA141A Unit 1, class 002 — Geometrical interpretation of partial derivatives."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 1 · Partial Differentiation",
    "scope": "Class 002 · Geometrical interpretation of partial derivatives",
    "title": "Geometrical Interpretation of Partial Derivatives",
    "subtitle": "Complete study pack: higher-order partials, partial derivatives as slopes, gradient, concavity and mixed partials, and problems",
    "slug": "geometrical_interpretation",
    "header": "Engg. Mathematics I · Unit 1 · Class 002",
    "compiled_from": "Compiled from the PESU class 002 slide deck, the class 002 AV-summary transcript (with three targeted video "
                     "frames), the Unit 1 class-work sheet and past ESA papers.",
    "how_to_use": "Topics 1–7 follow the order of the lecture.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, May 2024 and Jul 2023, and UE23MA141A Jan sets 1–4 and "
                "June 2024. None asks for the geometrical interpretation directly. Two 6-mark Q1 parts test higher-order partials, "
                "the computational half of this session. Other Unit 1 questions (Euler, Taylor, maxima, Lagrange, chain rule) "
                "belong to later sessions and are left out.",
    "figure_note": "Colours follow the Okabe–Ito order: blue = main curve, vermilion = comparison or tangent, green = second trace, "
                   "purple = other direction. Tangents are dashed. Grey dashed lines are references. The surfaces (dome $z=4-x^2-y^2$, "
                   "saddle $z=x^2-y^2$, $z=x^2y$) are illustrative choices that reproduce the shapes on slides 5–10. The slide images "
                   "themselves are third-party screenshots and are not copied.",
    "symbols_remark": "No physical units here: every slope is a pure number (rise per unit run) unless $x$, $y$, $z$ carry units. "
                      "Then $f_x$ has units of $z$ per unit of $x$.",
    "coverage_note": "Slides 1, 2 and 11 are the title, session and closing slides and hold no content.",
    "notation_table": {
        "title": "Notation equivalents",
        "head": ["Subscript", "Leibniz", "Also written", "Read as"],
        "rows": [["$f_x$", "$\\dfrac{\\partial f}{\\partial x}$", "$z_x$, $\\dfrac{\\partial z}{\\partial x}$", "slope along $x$"],
                 ["$f_{xx}$", "$\\dfrac{\\partial^2 f}{\\partial x^2}$", "$z_{xx}$", "bending along $x$"],
                 ["$f_{xy}$", "$\\dfrac{\\partial^2 f}{\\partial y\\,\\partial x}$", "$(f_x)_y$", "$x$ first, then $y$"],
                 ["$f_{yx}$", "$\\dfrac{\\partial^2 f}{\\partial x\\,\\partial y}$", "$(f_y)_x$", "$y$ first, then $x$"],
                 ["$\\nabla f$", "$f_x\\,\\mathbf i+f_y\\,\\mathbf j$", "grad $f$", "vector of slopes"]],
        "row_heads": False,
    },
    "tag_legend": [
        ("S002·7", "Deck 002, slide 7 (rendered .pptx)"),
        ("T002 00:06:10", "AV-summary transcript 002, segment start time"),
        ("V002 00:07:45", "Frame grabbed from the class 002 video"),
        ("CW U1 P2 · ESA Dec-23 1a", "Unit 1 class-work problem 2 · past-paper question"),
    ],
    "sources": [
        {"name": "Deck 002 (.pptx, rendered to images; .slides.md; .slides.txt)",
         "path": HF + "Slides/002_Geometrical_interpretation_of_Partial_derivatives_Problems_on_partial_derivatives__714d38d7a06bef55.*",
         "use": "11 slides; content on slides 3–10"},
        {"name": "Transcript 002 (.transcript.md / .json / .srt / .txt)",
         "path": HF + "AV_Summaries/002_Geometrical_interpretation_of_Partial_derivatives__374c7bb76e445af3.*", "use": "15.7 min lecture"},
        {"name": "Video 002 (.mp4): 3 single frames at 00:07:45, 00:09:05, 00:12:40",
         "path": HF + "AV_Summaries/002_…374c7bb76e445af3.mp4", "use": "Remote seek; the full video was not downloaded"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "use": "Problems 1, 2, 5 used"},
        {"name": "ESA papers, UE22MA141A: Dec 2023, Jul 2023, May 2024", "path": HF2 + "Papers/ESA Papers/UE22MA141A/*.pdf", "use": "Q1 read for Unit 1"},
        {"name": "ESA papers, UE23MA141A: Jan sets 1–4, June 2024", "path": HF2 + "Papers/ESA Papers/UE23MA141A/*.pdf", "use": "Q1 read for Unit 1"},
    ],
    "gaps": [
        "The deck's title says “Problems on partial derivatives”, but the deck has no problem slides, and the transcript defers problems to the next class (T002 00:14:59). Problems were taken from the class-work sheet and ESA papers instead.",
        "Slide 10 shows an interactive “Second-Order Partial Derivatives” demonstration. The transcript names its source unclearly (“Ultra Am lab”), and the video frame at 00:12:40 does not show a name, so the tool is described without one.",
        "The link promised “in my next slide” (T002 00:15:16) is not in the deck; slide 11 is the closing slide.",
        "Slides 4, 5 and 8 use third-party images (a YouTube source is credited on the slide). They were redrawn as Figures G2.1, G3.1, G3.2 and G5.1 rather than copied.",
        "The UE23MA141A papers are headed “JAN 2023”, but the browser print header says Jan 2024. They are cited as Jan 2024.",
        "Transcript recognition errors were corrected silently: “geometally” → geometrically, “Z1” → $z_y$, “impartial derivatives” → in partial derivatives, “Claret theorem” → Clairaut's theorem, “jowl” → jolt (another name for jerk).",
    ],
    "asr_forbidden": ["geometally", "Ultra Am", "Claret", "jowl", "impartial"],
}
