"""Pack metadata: UE26MA141A Unit 1, class 007 — Taylor's and Maclaurin's expansion."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 1 · Partial Differentiation",
    "scope": "Class 007 · Taylor's and Maclaurin's expansion",
    "title": "Taylor's and Maclaurin's Expansion",
    "subtitle": "Complete study pack for class 007: why series are used, Taylor's and Maclaurin's series in one variable, "
                "the standard series, and Taylor's and Maclaurin's expansion for a function of two variables",
    "slug": "taylor_maclaurin",
    "header": "Engg. Mathematics I · Unit 1 · Class 007",
    "compiled_from": "Compiled from the PESU class 007 slide deck and AV-summary transcript, the Unit 1 class-work sheet and past ESA papers.",
    "how_to_use": "Topics 1–2 are the one-variable background (a self-learning component in the syllabus); topics 3–4 are the "
                  "examinable two-variable expansions. Class 007 states the series but works no problems: the lecture defers "
                  "them to class 008 (“Problems on Taylor's and Maclaurin's series”), which is a separate session and is not "
                  "included. The worked examples here come from the class-work sheet and past ESA papers, so you can practise "
                  "every exam pattern from this pack.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024. A Taylor or Maclaurin expansion in two variables is asked in six of them, always as a 6–7 mark "
                "Q1 part. About a point $(a,b)$: Dec 2023 Q1.b ($\\sin x\\sin y$, third degree), Jul 2023 Q1.b (the same function, "
                "second order) and May 2024 Q1.b ($e^x\\cos y$ about $(1,\\pi/4)$). About the origin: Jan 2024 set 1 Q1.b "
                "($\\log(1+x-y)$), set 2 Q1.b ($e^{ax}\\sin by$) and June 2024 Q1.c ($\\sin(x+2y)$). Four of the six ask for "
                "third-degree terms, which the slides do not write out. Jan 2024 sets 3 and 4 have no Taylor question. "
                "One-variable series and the applications were never asked.",
    "figure_note": "Colours follow the Okabe–Ito order: blue = the function, vermilion = first approximation, green and purple "
                   "for higher approximations; grey dashed lines are references. Figure G1.1 redraws the slide's graphs of "
                   "$\\sin x$ and its Maclaurin polynomials; the slide's own axis scale is not stated, so the redraw uses "
                   "$-2\\pi\\le x\\le2\\pi$. Figures G3.1–G3.2 redraw the deck's surface plots of $xe^y+1$; the slides' "
                   "screenshots are not copied.",
    "symbols_remark": "$h=x-a$ and $k=y-b$ are the shorthand used in the worked examples and are added for clarity; the slides "
                      "write $(x-a)$ and $(y-b)$ in full. $f^{(n)}$ (the $n$-th derivative) is printed as $f^n$ on slide 007·4; "
                      "it is not a power.",
    "coverage_note": "Slides 007·1, 007·2 and 007·13 are title, session and closing slides with no content.",
    "tag_legend": [
        ("S007·9", "Deck 007, slide 9 (rendered .pptx)"),
        ("T007 00:18:07", "AV-summary transcript 007, segment start"),
        ("CW U1 P24", "Unit 1 class-work problem 24"),
        ("ESA Dec-23 1b", "Past paper: Dec 2023, question 1.b"),
    ],
    "sources": [
        {"name": "Deck 007 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/007_Taylor_and_Maclaurin_series_expansion_for_a_function_of_two_variables__20e30802511eb2ac.*", "use": "13 slides; content on 3–12"},
        {"name": "Transcript 007 (all 4 formats)",
         "path": HF + "AV_Summaries/007_Taylor_s_and_Maclaurin_s_expansion__ff2506f0c8105451.*", "use": "22.2 min lecture"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "use": "Problems 24–28 (with answers)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf", "use": "6 in-scope Q1 parts"},
        {"name": "Video 007 (.mp4)", "path": HF + "AV_Summaries/007_*.mp4", "use": "Not opened: every slide is readable, and the one garbled formula is read out in full in the transcript"},
    ],
    "gaps": [
        "Slide 007·9's second-order term is garbled in the rendering. It was rebuilt from the transcript (T007 00:18:45) and the "
        "Maclaurin form on slide 007·10: $\\frac1{2!}\\{(x-a)^2f_{xx}+2(x-a)(y-b)f_{xy}+(y-b)^2f_{yy}\\}$ at $(a,b)$.",
        "The slides stop at second order. Four of the six ESA questions ask for third-degree terms, so the third-order term "
        "$\\frac1{3!}\\{h^3f_{xxx}+3h^2kf_{xxy}+3hk^2f_{xyy}+k^3f_{yyy}\\}$ and the operator form are added for clarity.",
        "Slide 007·3 asks for $\\lim_{x\\to0}\\frac{\\sin x-x}{x^4}$. That limit does not exist (it behaves like $-\\frac1{6x}$); "
        "with $x^3$ in the denominator the limit is $-\\tfrac16$, worked as W1.2.",
        "Slide 007·3's integrals ($\\int e^{x^2}dx$, $\\int\\cos(x^2)dx$) are partly lost in the rendering; the lecture uses "
        "$\\int_0^1\\sin(x^2)\\,dx$ instead (T007 00:11:51), worked as W1.1.",
        "Slide 007·7 says “$E=mc^2$ is an approximation for low velocities”. More precisely, the Maclaurin expansion of the "
        "relativistic energy $\\gamma mc^2$ gives $mc^2+\\tfrac12mv^2$ for $v\\ll c$ (added for clarity).",
        "Slide 007·8's graphs of $\\sin x$ and its Maclaurin polynomials have no axis labels; they are redrawn as Figure G1.1.",
        "Slide 007·11 does not state the expansion point. Its polynomials $1+x+y$ and $1+x+xy+\\frac{y^2}2$ are the Taylor "
        "polynomials of $xe^y+1$ about $(1,0)$; the lecture's guess that “maybe they have used the Maclaurin series” "
        "(T007 00:20:32) is wrong: about the origin they would be $1+x$ and $1+x+xy$ (sympy).",
        "Slide 007·12 is titled “Applications of Euler's Theorem of a multivariate function”; its content is the applications of Taylor's series (a copy error).",
        "The lecture says $1+2+2^2+2^3+\\dots$ “gives $-1$” (T007 00:07:52). The series diverges: $\\frac1{1-x}=1+x+x^2+\\dots$ holds "
        "only for $|x|<1$. Corrected as an exam trap.",
        "The lecture's condition “$f(a)$ cannot tend to infinity” (T007 00:10:01) is incomplete: $f$ needs derivatives of "
        "every order at the point, and the series must converge to $f$. The precise condition is added for clarity.",
        "The lecture's picture of a calculator summing Maclaurin series is a simplification; real calculators use several "
        "polynomial and shift-and-add methods. It is kept as the lecture's motivation.",
        "Class-work problem 26 prints $\\tan^{-1}(0.9/1.1)\\approx0.6904$. The second-order Taylor value is $0.6854$ (exact $0.6857$).",
        "Class 008 (“Problems on Taylor's and Maclaurin's series”) is a separate session and is not included.",
        "Transcript recognition errors were corrected silently: “McLaren” / “Mechlerin” / “Makelden” / “metogen” → Maclaurin, "
        "“McLevins” → Maclaurin, “t-shirts” → Taylor series, “L'opitholes” → L'Hôpital's, “Legrange” → Lagrange, "
        "“four-year series” → Fourier series, “sinex” → sin x, “2a into” → 2(x−a)(y−b).",
    ],
    "asr_forbidden": ["McLaren", "Mechlerin", "Makelden", "metogen", "McLevins", "t-shirts", "opitholes", "Legrange", "four-year series", "sinex"],
}
MODULES = []
