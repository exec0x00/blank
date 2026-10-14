"""Pack metadata: UE26MA141A Unit 1, class 008 — Problems on Taylor's and Maclaurin's series."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 1 · Partial Differentiation",
    "scope": "Class 008 · Problems on Taylor's and Maclaurin's series",
    "title": "Problems on Taylor's and Maclaurin's Series",
    "subtitle": "Complete study pack for class 008: Taylor expansions of functions of two variables about a point, Maclaurin "
                "expansions about the origin, and approximate values from a Taylor polynomial",
    "slug": "taylor_problems",
    "header": "Engg. Mathematics I · Unit 1 · Class 008",
    "compiled_from": "Compiled from the PESU class 008 slide deck and AV-summary transcript, the Unit 1 class-work sheet and past ESA papers.",
    "how_to_use": "Topic 1 expands about a point $(a,b)$, topic 2 about the origin, topic 3 uses the expansion to approximate a value. "
                  "Every problem follows the same four steps (Figure F1.1). The theory (why series, one-variable series, the "
                  "statements) is in the class 007 pack “Taylor's and Maclaurin's Expansion”; the formulas are repeated here so that "
                  "every problem can be solved from this pack alone. The past-paper and class-work problems also appear in that "
                  "pack; the answers agree.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024. A two-variable Taylor or Maclaurin expansion is asked in six of them, always a 6–7 mark Q1 part: "
                "Jul 2023 Q1.b and Dec 2023 Q1.b ($\\sin x\\sin y$ about $(\\frac\\pi4,\\frac\\pi4)$, second order and third degree), "
                "May 2024 Q1.b ($e^x\\cos y$ about $(1,\\frac\\pi4)$, the same as slide 008·3), Jan 2024 set 1 Q1.b ($\\log(1+x-y)$), "
                "set 2 Q1.b ($e^{ax}\\sin by$) and June 2024 Q1.c ($\\sin(x+2y)$). Four ask for third-degree terms. Jan 2024 sets 3 "
                "and 4 have no Taylor question. Approximate values (topic 3) were never asked in these papers; they appear in class "
                "and in CW problem 26.",
    "figure_note": "Colours follow the Okabe–Ito order: blue = the function, vermilion = first-degree polynomial, green = second "
                   "degree, purple = third degree; grey dashed lines are references. The deck has no graphs, so all figures are "
                   "added for clarity and drawn from the deck's own functions.",
    "symbols_remark": "$h=x-a$ and $k=y-b$ are shorthand added for clarity; the slides write $(x-1)$, $(y-\\frac\\pi4)$ and so on in "
                      "full. “Up to three terms” (slide 008·5) means three non-zero terms, as the lecture explains; it is not the "
                      "same as “up to third degree”.",
    "coverage_note": "Slides 008·1, 008·2 and 008·20 are title, session and closing slides. The lecture works slides 3–9 only; "
                     "slides 10–19 have no recorded explanation and are cited from the slides alone.",
    "tag_legend": [
        ("S008·12", "Deck 008, slide 12 (rendered .pptx)"),
        ("T008 00:07:38", "AV-summary transcript 008, segment start"),
        ("CW U1 P24", "Unit 1 class-work problem 24"),
        ("ESA Dec-23 1b", "Past paper: Dec 2023, question 1.b"),
    ],
    "sources": [
        {"name": "Deck 008 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/008_Taylor_s_and_Maclaurin_s_expansion_for_a_function_of_two_variables_-_continued__8431d55b4539aacd.*", "use": "20 slides; content on 3–19"},
        {"name": "Transcript 008 (all 4 formats)",
         "path": HF + "AV_Summaries/008_Problems_on_Taylor_s_and_Maclaurin_s_series__4b73a1bc5fc83388.*", "use": "16.2 min: slides 3–9"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "use": "Problems 24–28 (with answers)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf", "use": "6 in-scope Q1 parts"},
        {"name": "Video 008 (.mp4)", "path": HF + "AV_Summaries/008_*.mp4", "use": "Not opened: every garbled slide was settled from the transcript and by recomputing"},
    ],
    "gaps": [
        "Slide 008·18 gives $f_{yy}(1,1)=3$ for $xy^2+y\\cos(x-y)$; it is $1$. Slide 008·17's $f_{yy}$ has the wrong sign on "
        "$y\\cos(x-y)$: the correct $f_{yy}=2x+2\\sin(x-y)-y\\cos(x-y)$. Slide 008·19's final answer (with $f_{yy}=1$) is correct.",
        "Slide 008·12 lists $f_{xy}(0,0)=0$ for $e^x\\log(1+y)$; it is $1$ ($f_{xy}=\\frac{e^x}{1+y}$). Slide 008·13 uses the correct value.",
        "Slide 008·12 asks for “the first six terms” of $e^x\\log(1+y)$ but slide 008·13 stops after three ($y+xy-\\frac{y^2}2$). "
        "The six terms $y+xy-\\frac{y^2}2+\\frac{x^2y}2-\\frac{xy^2}2+\\frac{y^3}3$ are added for clarity (sympy).",
        "Slide 008·11 computes the third-order derivatives of $e^{x-y}$ but stops the series at second order; the third-degree "
        "term $\\frac{(x-y)^3}{6}$ is added for clarity.",
        "Slide 008·9 approximates $\\tan^{-1}(0.9\\times(-1.2))$ with first-order terms only: $-\\frac\\pi4-0.05=-0.8354$. With the "
        "second-order terms of slide 008·8 it is $-0.8229$; the exact value is $-0.8238$ (sympy). Both are given.",
        "Slides 008·6, 008·8 and 008·9 are partly garbled in the rendering; they were rebuilt from the transcript (T008 00:10:35, "
        "00:14:35, 00:15:42) and checked by recomputing.",
        "Slide 008·3 does not state the degree; the lecture says “up to second degree” (T008 00:00:21).",
        "The lecture twice reads $f_{xx}(1,\\frac\\pi4)$ and $f_{xy}(1,\\frac\\pi4)$ as “$e$ divided by two” (T008 00:03:47, "
        "00:04:16); every value on slide 008·3 is $\\pm\\frac e{\\sqrt2}$.",
        "The lecture says “$f(0.9,-1.2)$ is approximately equal to $f(1,-1)$” (T008 00:12:10). That only motivates the choice "
        "of the expansion point; the approximation is the Taylor polynomial, not $f(1,-1)=-0.785$.",
        "The lecture works slides 3–9 only (16.2 min). Slides 10–19 ($e^{x-y}$, $e^x\\log(1+y)$, $\\sin(xy)$, $xy^2+y\\cos(x-y)$) "
        "have no recorded explanation.",
        "The class 007 theory is in its own pack; the formulas are repeated here without derivation.",
        "Transcript recognition errors were corrected silently: “McLaren” / “my cleric series” → Maclaurin series, "
        "“e bar root” / “e pi root 2” → $e/\\sqrt2$, “1 comma 5 by 4” → $(1,\\frac\\pi4)$, “y minus 4” → $y-\\frac\\pi4$.",
    ],
    "asr_forbidden": ["McLaren", "my cleric", "e bar root", "e pi root", "5 by 4"],
}
MODULES = []
