"""Pack metadata: UE26MA141A Unit 1, class 001 — Introduction to partial differentiation."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 1 · Partial Differentiation",
    "scope": "Class 001 · Introduction to partial differentiation",
    "title": "Introduction to Partial Differentiation",
    "subtitle": "Complete study pack for class 001: functions of several variables, limits and continuity of a function of "
                "two variables, the definition and notation of partial derivatives, and second-order and mixed partial derivatives",
    "slug": "intro_partial_differentiation",
    "header": "Engg. Mathematics I · Unit 1 · Class 001",
    "compiled_from": "Compiled from the PESU class 001 slide deck, its two AV-summary transcripts, the Unit 1 class-work sheet and past ESA papers.",
    "how_to_use": "Class 001 has one deck and two recorded lectures: “Introduction to Partial Differentiation” (topics 1–2) and "
                  "“Continuity and differentiability of a function of two independent variables” (topics 3–5). Topics 1–3 are "
                  "the background (functions of two variables, limits, continuity) and are never asked by themselves in the ESA; "
                  "topics 4–5 (computing partial derivatives and mixed partials) are used in every Unit 1 question. The geometrical "
                  "interpretation and the problems on higher-order partials announced at the end of the second lecture are class "
                  "002, a separate pack.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024. No question asks for a limit, continuity or the definition of a partial derivative. Computing "
                "partial derivatives is asked directly twice: Dec 2023 Q1.a (third-order partials of $e^x\\log y+\\cos y\\log x$) and "
                "Jan 2024 set 4 Q1.c (find $n$ for $\\theta=t^ne^{-r^2/4t}$). Both are worked in the class 002 pack; this pack works "
                "the class-work problems of the same type (CW P4, P7, P8). Every other Unit 1 question (chain rule, Euler, Taylor, "
                "maxima and minima, Lagrange) uses the rules of this session.",
    "figure_note": "Colours follow the Okabe–Ito order: blue = main surface or curve, vermilion = comparison, green and purple = "
                   "further paths. Figures G1.1–G1.2 and G3.1–G3.2 redraw the deck's Gnuplot surfaces ($\\sin x\\cos y$, "
                   "$e^{1-x^2-y^2}$, $\\frac{3x^2y}{x^2+y^2}$, $\\frac{2xy}{3x^2+y^2}$) over $-2\\le x,y\\le2$ or a similar range; "
                   "the slides' screenshots are not copied. Figure G2.1 redraws the lecture's board sketch of paths approaching "
                   "$(a,b)$.",
    "symbols_remark": "The slides write $z_x$ and $f_x$ for $\\frac{\\partial z}{\\partial x}$; the lecture says the subscript form is "
                      "the one used in problems. In the subscript notation the subscripts are read left to right in the order of "
                      "differentiation; in the $\\partial$ notation the order is read right to left (slide 001·17).",
    "coverage_note": "Slides 001·1, 001·2 and 001·18 are title, session and closing slides. Slides 001·3–7 are motivation and are "
                     "summarised in topic 1. The lecture announces the geometric interpretation (T001b 00:20:38); it is class 002.",
    "tag_legend": [
        ("S001·15", "Deck 001, slide 15 (rendered .pptx)"),
        ("T001a 00:14:20", "Transcript “Introduction to Partial Differentiation”, segment start"),
        ("T001b 00:11:41", "Transcript “Continuity and differentiability of a function of two independent variables”"),
        ("CW U1 P7", "Unit 1 class-work problem 7"),
        ("ESA Dec-23 1a", "Past paper: Dec 2023, question 1.a"),
    ],
    "sources": [
        {"name": "Deck 001 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/001_Introduction_to_Partial_differentiation__8f4f825e9c46150f.*", "use": "18 slides; content on 3–17"},
        {"name": "Transcript 001a (all 4 formats)",
         "path": HF + "AV_Summaries/001_Introduction_to_Partial_Differentiation__7d6d5767ec830adb.*", "use": "19.7 min: motivation, definition, limits"},
        {"name": "Transcript 001b (all 4 formats)",
         "path": HF + "AV_Summaries/001_Continuity_and_differentiability_of_a_function_of_two_independent_variable__543f4d65e9b6ed52.*",
         "use": "21.1 min: continuity, history, definition, mixed partials"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "use": "Problems 1–8 (with answers)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf", "use": "No direct question; two partial-derivative computations (class 002)"},
        {"name": "Videos 001a, 001b (.mp4)", "path": HF + "AV_Summaries/001_*.mp4", "use": "Not opened: every slide is readable and the board work is read out in the transcripts"},
    ],
    "gaps": [
        "Slide 001·9 asks for $\\lim_{(x,y)\\to(2,1)}(x^2-2xy+3y^2-4x+3y-6)$, which is $-8$. The lecture (T001a 00:12:59) works the "
        "point $(2,-1)$ instead and gets $-6$. Both values are correct for their points (sympy); W2.1 gives both.",
        "Slide 001·12's text is about $f=\\frac{3x^2y}{x^2+y^2}$ (whose limit at the origin is 0), but the Gnuplot caption on the "
        "slide's picture reads $\\frac{3xy}{y^2+x^2}$, a different function whose limit at the origin does not exist (along "
        "$y=mx$ it is $\\frac{3m}{1+m^2}$). Figure G3.1 redraws the function in the text.",
        "Slide 001·12 says the function is not continuous at $(0,0)$ “as $f(0,0)$ is not defined”. Added for clarity: the limit is 0, "
        "so defining $f(0,0)=0$ removes the discontinuity (a removable discontinuity); with $2xy/(3x^2+y^2)$ (slide 001·13) no "
        "value of $f(0,0)$ helps.",
        "The lecture says a function is continuous “if the surface is smooth” (T001b 00:06:26). Continuity only needs no holes or "
        "jumps; a continuous surface can have a sharp edge or corner ($z=|x|+|y|$). Corrected as an exam trap.",
        "Slide 001·17 says mixed partials “are in general equal”. Precisely, Clairaut's theorem needs $f_{xy}$ and $f_{yx}$ continuous "
        "near the point; the standard counter-example $\\frac{xy(x^2-y^2)}{x^2+y^2}$ has $f_{xy}(0,0)=-1\\ne f_{yx}(0,0)=1$ (added for clarity; sympy).",
        "The lecture asks the class to prove Clairaut's theorem (T001b 00:20:10) and says the proof is short. The proof needs the mean "
        "value theorem as well as the limit definition; it is not on the slides and is not reproduced here.",
        "The lecture's history (T001b 00:10:53) says Leibniz used other letters for partial derivatives in a letter to L'Hôpital. "
        "The letters are not on the slide and could not be confirmed from the material; only the slide's facts (Leibniz, "
        "Legendre 1786, Jacobi 1841) are kept.",
        "The lecture's example function (T001a, T001b 00:15:16) adds a term in $t$ that the recognition renders unclearly; "
        "W4.2 keeps the clearly spoken terms $x^3\\sin y+e^w+\\log p$, which show the same point.",
        "The lecture opens with “Unit Two” (T001a 00:00:01); partial differentiation is Unit 1 of UE26MA141A.",
        "The deck's motivation slides (001·5–7) carry stock images (a cathode-ray tube, a weather chart, COVID-19 posters); they are "
        "described in words, not redrawn.",
        "Transcript recognition errors were corrected silently: “Clydoids” → Clairaut's, “legendary” → Legendre, “Lobithal” → "
        "L'Hôpital, “Ebo” → above, “parable” → parabola, “cathode ratio” → cathode-ray tube, “dou” / “Do” → $\\partial$, "
        "“x q” / “XQ” → $x^3$, “sine 1” → $\\sin y$, “topol o topography” → topography, “extending to” → $x$ tending to.",
    ],
    "asr_forbidden": ["Clydoid", "Lobithal", "Ebo ", "parable", "cathode ratio", "XQ", "sine 1", "topol o", "extending to"],
}
MODULES = []
