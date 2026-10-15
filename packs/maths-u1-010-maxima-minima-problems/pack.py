"""Pack metadata: UE26MA141A Unit 1, class 010 — Problems on maxima and minima for a function of two variables."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 1 · Partial Differentiation",
    "scope": "Class 010 · Problems on maxima and minima for a function of two variables",
    "title": "Problems on Maxima and Minima",
    "subtitle": "Complete study pack for class 010: locating stationary points, classifying them with $rt-s^2$, "
                "functions with many stationary points, and applied problems solved by eliminating one variable",
    "slug": "maxima_minima_problems",
    "header": "Engg. Mathematics I · Unit 1 · Class 010",
    "compiled_from": "Compiled from the PESU class 010 slide deck, its two AV-summary transcripts, the Unit 1 class-work sheet and past ESA papers.",
    "how_to_use": "Topic 1 is the method and the ESA functions (every problem follows Figure F1.1 and the ladder F1.2). Topic 2 "
                  "works the slides' functions with many stationary points; topic 3 the applied problems, where a constraint is "
                  "used to eliminate one variable first. The theory (definitions of extrema and saddle points, the necessary "
                  "conditions $f_x=f_y=0$, the $rt-s^2$ test) is taught in class 009, which has its own pack; the test is restated "
                  "here so that every problem can be solved from this pack alone. Constrained problems by Lagrange's multipliers "
                  "are class 011.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024. Free extrema of $f(x,y)$ are asked in three of them, always a 7-mark Q1 part: Dec 2023 Q1.c and "
                "Jan 2024 set 1 Q1.a ask the same function $x^3+3xy^2-15x^2-15y^2+72x$ (also slide 010·7 and CW problem 32), "
                "and Jan 2024 set 2 Q1.a asks $x^3-12x+y^3+3y^2-9y$ (CW problem 29). Both are cubic polynomials with four "
                "stationary points: one maximum, one minimum and two saddle points. The other five papers ask Lagrange's method "
                "(class 011) instead. The temperature-on-a-sphere problem of slide 010·3 is asked in June 2024 Q1.d, but by "
                "Lagrange's method; the elimination method of topic 3 gives the same answer. Trigonometric and quartic functions "
                "(topic 2) were never asked.",
    "figure_note": "The deck has no graphs, so every figure is added for clarity and drawn from the deck's and the papers' own "
                   "functions. Contour plots: thin grey lines are level curves; a filled vermilion triangle marks a maximum, a "
                   "filled blue circle a minimum and a green cross a saddle point, each labelled directly.",
    "symbols_remark": "The slides write $r=f_{xx}$, $s=f_{xy}$, $t=f_{yy}$ and test the sign of $rt-s^2$; other books call it "
                      "the discriminant $D$ or the Hessian. The lecture of T010b also names the first partials $p=f_x$ and "
                      "$q=f_y$. Do not confuse $t=f_{yy}$ with the temperature $T$ of slides 010·3 and 010·9.",
    "coverage_note": "Slides 010·1, 010·2 and 010·15 are title, session and closing slides. Lecture T010a (older, 17.3 min) works "
                     "slides 3–6 (temperature on the unit sphere, open box); lecture T010b (newer, 11.1 min) works slides 7–14. "
                     "Slide 010·2 says “Session : 9”; the bucket numbers the class 010.",
    "tag_legend": [
        ("S010·8", "Deck 010, slide 8 (rendered .pptx)"),
        ("T010a 00:07:38", "AV-summary transcript “Extremas of functions continued” (older lecture), segment start"),
        ("T010b 00:03:12", "AV-summary transcript “Problems on Maxima and Minima for a function of two variables” (newer lecture)"),
        ("CW U1 P29", "Unit 1 class-work problem 29"),
        ("ESA Dec-23 1c", "Past paper: Dec 2023, question 1.c"),
        ("ESA Jan-24 s2 1a", "Past paper: Jan 2024 set 2, question 1.a"),
    ],
    "sources": [
        {"name": "Deck 010 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/010_Problems_on_Maxima_and_Minima_for_a_function_of_two_variables__901fa082eda4bf29.*", "use": "15 slides; content on 3–14"},
        {"name": "Transcript T010a (all 4 formats)",
         "path": HF + "AV_Summaries/010_Extremas_of_functions_continued__5cf502cc80940c87.*", "use": "17.3 min: slides 3–6"},
        {"name": "Transcript T010b (all 4 formats)",
         "path": HF + "AV_Summaries/010_Problems_on_Maxima_and_Minima_for_a_function_of_two_variables__e276ddb59439e6ec.*", "use": "11.1 min: slides 7–14"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "use": "Problems 29, 31, 32 (with answers); 30 is blank; 34 confirms the open-box answer"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf", "use": "3 in-scope Q1 parts (2 distinct functions)"},
        {"name": "Videos 010 (.mp4)", "path": HF + "AV_Summaries/010_*.mp4", "use": "Not opened: every slide is readable and every disputed number was settled by recomputing"},
    ],
    "gaps": [
        "Slide 010·4 prints $rt-s^2=-1600$ at $(0,0)$ and $356000$ at $(\\pm\\frac12,\\pm\\frac12)$ for $400xy(1-x^2-y^2)$. The correct "
        "values are $-160000$ and $320000$ (sympy; also the special case $k=400$, $a=1$ of slide 010·10's $-k^2a^4$ and $2k^2a^4$). "
        "The conclusions (saddle, maximum 50) are unaffected.",
        "Slides 010·3–4 and 010·9 miss four stationary points: $(\\pm1,0)$ and $(0,\\pm1)$ (generally $(\\pm a,0)$, $(0,\\pm a)$), "
        "from $y=0$, $1-x^2=0$ and $x=0$, $1-y^2=0$. They are saddle points with $T=0$ (on the circle $z=0$). The slides also "
        "list $(\\frac12,-\\frac12)$ and $(-\\frac12,\\frac12)$ but never classify them: they are minima of $T$ ($-50$, the lowest temperature).",
        "Slides 010·5–6 and the lecture (T010a 00:10:33) differentiate $A=2xy+\\frac{20}x+\\frac{10}y$ wrongly: $A_y=2x-\\frac{10}{y^2}$, "
        "not $2x-\\frac{20}{y^2}$, and $A_{yy}=\\frac{20}{y^3}$, not $\\frac{40}{y^3}$. The printed answer, a cube of side $\\sqrt[3]{10}$, "
        "is therefore wrong (area $23.21$). The correct box has the two edges of the open face $\\sqrt[3]{20}\\approx2.714$ m and "
        "the third edge half of that, $1.357$ m (area $3\\cdot20^{2/3}\\approx22.10$ m²), which agrees with CW problem 34 "
        "($x=y=(2V)^{1/3}$, $z=x/2$). A cube is the answer for a closed box.",
        "Slide 010·5 measures the edges in “ft” though the capacity is 10 m³; metres are used here.",
        "Slide 010·8 writes $rt-s^2=36(x-5)^2-y^2$; it is $36(x-5)^2-36y^2$ (the values $\\pm36$ printed below use the correct form). "
        "It also says “the maximum value of $f$ at $(6,0)$ is 112”; the maximum is at $(4,0)$ (the lecture repeats the slip, T010b 00:04:42).",
        "Slide 010·12 gives $r=-2<0$ for all four points $(\\pm\\frac1{\\sqrt2},0)$, $(0,\\pm\\frac1{\\sqrt2})$. At $(\\pm\\frac1{\\sqrt2},0)$, "
        "$r=4$ and $t=-2$; the saddle conclusion ($rt-s^2=-8<0$) is unaffected. The lecture adds “but $r$ is also negative” "
        "(T010b 00:09:26); the sign of $r$ plays no part when $rt-s^2<0$.",
        "Slide 010·14 prints $rt-s^2=\\frac34$ at $(\\frac\\pi3,\\frac\\pi3)$ for $\\sin x+\\sin y+\\sin(x+y)$; it is $3-\\frac34=\\frac94$ "
        "($s=-\\frac{\\sqrt3}2$). The conclusion (maximum $\\frac{3\\sqrt3}2$) is unaffected. The slide states no domain; "
        "“the only critical point” holds for $0<x,y<\\pi$ (added for clarity).",
        "Slide 010·9 prints the sphere as $x^2+y^2+z^2=a'$; it is $a^2$ (slide 010·9's next line and T010b 00:05:40).",
        "The lecture T010a says “$x$ will be plus or minus 1” (00:02:42) and then corrects itself to $x=\\pm y$; and “this should be "
        "$x$ equal to 0, not $y$” (00:03:27) for slide 010·3's $f_y$ line, which indeed should read $x=0$.",
        "Class 009 (definitions, necessary conditions, the $rt-s^2$ test) is a separate pack; the test is restated here without proof. "
        "Class 011 (Lagrange's multipliers) is also separate; the elimination method of topic 3 is what class 010 uses.",
        "Transcript recognition errors were corrected silently: “seventy p” → 72, “minus pi square” → $-36y^2$, “115” → 150, "
        "“phi” / “5 comma” spoken as five, “plus R minus” → plus or minus, “stattle points” / “settle point” → saddle point(s), "
        "“6 comero is 12” → (4, 0) is 112, “RT when C square” → $rt-s^2$, “5 by 3” → $\\frac\\pi3$, “P of x y z” → $T(x,y,z)$, "
        "“minus x square y square” → $-x^2-y^2$, “Subtracting 2 from 2” → (2) from (1), “equity” → equation, “dou” → $\\partial$.",
    ],
    "asr_forbidden": ["seventy p", "stattle", "settle point", "comero", "RT when C", "plus R minus", "equity", "phi comma", "Subtracting 2 from 2"],
}
MODULES = []
