"""Pack metadata: UE26MA141A Unit 2, class 001 — Introduction to second and higher order linear DEs with constant coefficients."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 2 · Higher-Order Linear Differential Equations",
    "scope": "Class 001 · Introduction to second and higher order DE with constant coefficients",
    "title": "Introduction to Higher-Order Linear Differential Equations",
    "subtitle": "Complete study pack for class 001: linear differential equations of order $n$, constant and variable coefficients, "
                "homogeneous and non-homogeneous equations, the operator $D$ and $f(D)$, linear independence, the complementary "
                "function and the particular integral",
    "slug": "higher_order_intro",
    "header": "Engg. Mathematics I · Unit 2 · Class 001",
    "compiled_from": "Compiled from the PESU Unit 2 class 001 slide deck and AV-summary transcript, and the Unit 2 questions of eight "
                     "past ESA papers (via the shared ESA map).",
    "how_to_use": "Topic 1 defines a linear DE and its order, topic 2 classifies linear DEs (constant or variable coefficients; "
                  "homogeneous or not), topic 3 introduces the operator $D$ and $f(D)$, topic 4 explains linear independence and why "
                  "the complementary function is $c_1y_1+\\dots+c_ny_n$, topic 5 puts it together: $y=\\text{CF}+\\text{PI}$. "
                  "This class has no methods of solution yet. How to find the CF from the roots of the auxiliary equation (all cases) "
                  "is in the class 002 pack “Solutions of Homogeneous Linear DEs: Complementary Functions”; the PI rules are in "
                  "classes 003–006. Figure F5.1 is the plan of every Unit 2 answer.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024. No question targets this class directly (definitions, classification, linear independence and the "
                "Wronskian were never asked on their own: 0 of 8 papers). But every Unit 2 ESA question (19 distinct questions, "
                "24 occurrences) is a non-homogeneous linear DE whose answer is $y=\\text{CF}+\\text{PI}$, and every constant-"
                "coefficient one is written in $D$-notation $f(D)y=X$. So the structure $y=\\text{CF}+\\text{PI}$ and the "
                "$f(D)$ notation are ★★★; recognising constant against variable coefficients (8 Legendre/Cauchy occurrences need "
                "it) and homogeneous against non-homogeneous ★★; definitions and the linear-dependence test ★ (never asked; the "
                "Wronskian is used in class 011, variation of parameters).",
    "figure_note": "Colours follow the Okabe–Ito order: blue = first solution, vermilion (dashed) = second, green = third or the "
                   "combination; grey dashed lines are references. The deck's two classification trees (slides 001·5 and 001·10) are "
                   "redrawn as flowcharts F1.1 and F2.1. The deck has no graphs; the three graphs are added for clarity and every "
                   "plotted solution was checked with sympy.",
    "symbols_remark": "The slides use three letters for coefficients: $P,Q$ for first order, $P_1,\\dots,P_n$ in slide 001·7 and "
                      "$a_1,\\dots,a_n$ from slide 001·8 on; $k_1,k_2$ for the second-order homogeneous equation (slide 001·15). "
                      "The lecture also writes a leading coefficient $P_0$ or $a_0\\ne0$; the slides divide it out. $X$ (capital) is "
                      "the right-hand side function of $x$, not the variable $x$.",
    "coverage_note": "Slides 001·1, 001·2 and 001·18 are title, session and closing slides; 001·3 lists the unit content and 001·4 "
                     "the class content. The lecture (28 min) covers every content slide 5–17 in order. The deck has no worked "
                     "problems and no class-work problem is assigned to this class, so the worked examples use the deck's own "
                     "equations plus two ESA questions read for their structure only. Bucket session numbers are not contiguous: "
                     "the decks say SESSION 1–11, but the bucket numbers them 001–006, 009, 011 (two decks), 014 and 015; 007, 008, "
                     "010, 012 and 013 do not exist. This deck is SESSION 1 in both numberings.",
    "tag_legend": [
        ("S001·12", "Unit 2 deck 001, slide 12 (rendered .pptx)"),
        ("T001 00:17:38", "Unit 2 AV-summary transcript 001 (“Introduction to higher order differential equations, "
                          "complementary function and particular integral”), segment start"),
        ("ESA Dec-23 3a", "Past paper: UE22MA141A Dec 2023, question 3.a"),
        ("ESA Jan-24 s3 3d", "Past paper: UE23MA141A Jan 2024 set 3, question 3.d"),
    ],
    "sources": [
        {"name": "Deck 001 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/001_Introduction_to_second_and_higher_order_DE_with_constant_coefficients__8ef20ff90fd33088.*",
         "use": "18 slides; content on 5–17 (every equation read from the rendered images; the text files have none)"},
        {"name": "Transcript 001 (all 4 formats)",
         "path": HF + "AV_Summaries/001_Introduction_to_higher_order_differential_equations_complementary_function_and_particular_integral__069274588a013075.*",
         "use": "28 min; slides 3–17; no low-confidence segment"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf",
         "use": "No question on this class alone; the CF + PI structure of every Unit 2 question, via the shared ESA map"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf",
         "use": "Checked: no Unit 2 problem belongs to this class (problems 1–9 are class 002)"},
        {"name": "Video 001 (.mp4)",
         "path": HF + "AV_Summaries/001_Introduction_to_higher_order_differential_equations_complementary_function_and_particular_integral__069274588a013075.mp4",
         "use": "Not opened: every slide is readable and the transcript has no low-confidence segment"},
    ],
    "gaps": [
        "Slide 001·14 says $y_1,y_2$ are linearly independent “when $c_1y_1+c_2y_2\\ne0$ for non zero constants $c_1$ and $c_2$”. "
        "Precisely: $c_1y_1+c_2y_2=0$ for all $x$ in $I$ only when $c_1=c_2=0$; equivalently, neither function is a constant "
        "multiple of the other (as the lecture says at T001 00:22:00). Recorded as an exam trap.",
        "The lecture says “$c_1y_1+c_2y_2$ is a solution only when $y_1$ and $y_2$ are linearly independent” (T001 00:23:40). "
        "That is wrong: any linear combination of solutions of a homogeneous linear DE is a solution. Independence is what makes "
        "it the complete (general) solution. Slide 001·15 is correct. Recorded as an exam trap.",
        "The lecture's “$P_0$ equal to 0” for the second-order form (T001 00:07:34) must be $P_0\\neq0$, as it says for order $n$ "
        "(T001 00:08:55); otherwise the equation is not of order 2.",
        "The lecture's second definition of a linear DE (T001 00:06:27) requires the coefficients of $y$ and its derivatives to be "
        "functions of $x$ or constants; the coefficient must not involve $y$. Stated precisely in the definitions.",
        "The lecture says $f(D)$ “obeys the laws of algebra” and its factors “can be written in any order” (T001 00:16:49). True for "
        "constant coefficients only; with variable coefficients $D(xD)\\ne(xD)D$. Added as an exam trap, flagged added for clarity.",
        "The Wronskian, the nonzero-determinant test for independence, is not in the deck or lecture; it is added for clarity "
        "(formula E4.3) because class 011 (variation of parameters) uses it.",
        "The auxiliary equation (E3.4) is only previewed here; it is not in this deck. Every CF case is in the class 002 pack.",
        "The deck has no worked problems and the CW sheet has none for this class; the worked examples use the deck's equations "
        "and two ESA questions (Dec-23 3a, Jul-23 3b), solved here only to show the CF + PI structure (sympy dsolve and checkodesol).",
        "ESA: no question on this class alone. The shared ESA map gives 19 distinct Unit 2 questions and 24 occurrences; all are "
        "non-homogeneous and answered as CF + PI.",
        "Bucket session numbers are not contiguous (decks say SESSION 1–11; bucket 009 = session 7, 011 VoP = 8, 011 Legendre = 9, "
        "014 = 10, 015 = 11; 007, 008, 010, 012, 013 do not exist).",
        "Transcript recognition errors were corrected silently: “dyed by dx” → $\\frac{dy}{dx}$, “d by ts” → $\\frac{d}{dx}$, "
        "“Albert 2” / “our del 3” / “R n” → order 2 / order 3 / order $n$, “n third derivative” → $n$-th derivative, "
        "“capital S” → $X$, “particular invariant” / “particular integration” → particular integral, “variance” → variable, "
        "“a 10 function” → a nonzero function, “minus p” → $-5$, “c1 by 1”/“C1 by 1” → $c_1y_1$, “f of d of i” → $f(D)y$, "
        "“E naught even into A N” → $a_0,a_1,\\dots,a_n$, “k2 div” → $k_2y$.",
    ],
    "asr_forbidden": ["dyed by", "d by ts", "Albert 2", "our del", "particular invariant", "a 10 function", "E naught", "k2 div"],
}
MODULES = []
