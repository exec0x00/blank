"""Pack metadata: UE26MA141A Unit 2, class 002 — Solutions of homogeneous linear DEs (complementary functions)."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 2 · Higher-Order Linear Differential Equations",
    "scope": "Class 002 · Solutions of homogeneous DE: complementary functions",
    "title": "Solutions of Homogeneous Linear DEs: Complementary Functions",
    "subtitle": "Complete study pack for class 002: the auxiliary equation; real distinct, real repeated and complex roots; "
                "combinations for equations of order n; solving with initial and boundary conditions",
    "slug": "complementary_function",
    "header": "Engg. Mathematics I · Unit 2 · Class 002",
    "compiled_from": "Compiled from the PESU Unit 2 class 002 slide deck and AV-summary transcript, the Unit 1 & 2 class-work sheet "
                     "(problems 1–9) and eight past ESA papers.",
    "how_to_use": "Topic 1 derives the auxiliary equation, topic 2 gives the three second-order cases, topic 3 extends them to order $n$, "
                  "topic 4 works every class-work problem, including those with initial conditions. Learn Figure F3.1 (one CF block per "
                  "root) by heart: every later Unit 2 class (particular integrals, variation of parameters, Legendre and Cauchy equations, "
                  "LCR circuits, springs) starts by writing this CF. Table C4.2 shows the CF of every Unit 2 ESA question.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 and "
                "June 2024. No paper asks a homogeneous equation on its own (0 of 8), so no question is about this class alone. But every "
                "Unit 2 ESA question is non-homogeneous and needs a CF first: 24 occurrences in the 8 papers, all of them (table C4.2). "
                "The CF cases appear as follows over the distinct questions: real distinct roots 6, real repeated roots 7 (including two double "
                "pairs in Jan 2024 set 4 Q2.c and a zero root with a double root in set 3 Q2.c), complex roots 6 (of 19 distinct questions). Stars follow that count: "
                "the three basic cases ★★★; two complex pairs, a repeated complex pair and initial conditions ★★ (class-work only); "
                "a complex pair repeated three times ★ (lecture only).",
    "figure_note": "The deck has no graphs, so every figure is added for clarity. Colours follow the Okabe–Ito order: blue = first "
                   "solution, vermilion (dashed) = second, green = third, purple = fourth; grey dashed lines are references. Every plotted "
                   "solution was found and checked with sympy.",
    "symbols_remark": "The slides use $k_1,k_2,\\dots$ for the coefficients; this pack also uses $k$ alone for the multiplicity of a root "
                      "(how often it repeats). The two are different. The discriminant $\\Delta$ is added for clarity. $\\theta$ and $z$ "
                      "appear only in table C4.2, for the Legendre and Cauchy questions of class 011.",
    "coverage_note": "Slides 002·1, 002·2 and 002·15 are title, session and closing slides; slide 002·3 lists the class content. The "
                     "lecture (22 min) covers every content slide 4–14 in order. The deck has no class-work problems; they come from the "
                     "class-work sheet (problems 1–9, all solved here). Bucket session numbers are not contiguous: the decks say SESSION "
                     "1–11, but the bucket numbers them 001–006, 009, 011 (two decks), 014 and 015; 007, 008, 010, 012 and 013 do not exist. "
                     "This deck is SESSION 2 in both numberings.",
    "tag_legend": [
        ("S002·7", "Unit 2 deck 002, slide 7 (rendered .pptx)"),
        ("T002 00:09:10", "Unit 2 AV-summary transcript 002 (“Rules for finding the Complementary Function, Problems”), segment start"),
        ("CW U2 P8", "Unit 2 class-work problem 8"),
        ("ESA Jan-24 s4 2c", "Past paper: UE23MA141A Jan 2024 set 4, question 2.c"),
    ],
    "sources": [
        {"name": "Deck 002 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/002_Solutions_of_Homogeneous_DE_by_introducing_Complementary_Functions__c193c841b234d834.*",
         "use": "15 slides; content on 4–14 (every equation read from the rendered images)"},
        {"name": "Transcript 002 (all 4 formats)",
         "path": HF + "AV_Summaries/002_Rules_for_finding_the_Complementary_Function_Problems__4a39dee530243163.*",
         "use": "22 min; slides 3–14"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf",
         "use": "Unit 2 problems 1–9 (with answers; page 5 rendered to settle superscripts); CF parts of problems 18 and 22"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf",
         "use": "No homogeneous question; the CF of every Unit 2 question (table C4.2), via the shared ESA map"},
        {"name": "Video 002 (.mp4)", "path": HF + "AV_Summaries/002_Rules_for_finding_the_Complementary_Function_Problems__4a39dee530243163.mp4",
         "use": "Not opened: every slide is readable and the transcript has no low-confidence segment"},
    ],
    "gaps": [
        "No slide or class-work answer in this class is wrong: all four slide examples and all nine CW answers (P1–P9, including the "
        "homework problems P4 and P9 and the initial and boundary values of P3, P4, P8, P9) were recomputed with sympy dsolve and checkodesol.",
        "The lecture says “alpha is 2 and beta is 2” for $2\\pm3i$ before correcting to 3 (T002 00:12:13); slide 002·9 is right.",
        "The lecture says $\\frac{d^3y}{dx^3}$ is replaced by “m square” (T002 00:07:49); it is $m^3$. Recorded as an exam trap.",
        "The lecture says an earlier version of slide 002·13 used $c_1,c_2$ for the second complex pair of case (iv) (T002 00:18:09). "
        "The current slide uses $c_3,c_4$, which is correct.",
        "The complex pair repeated three times (E3.6) is in the lecture only (T002 00:19:14–00:19:45), not on the slides.",
        "Slide 002·8's heading drops the word “homogeneous”; slide 002·12's case (iii) has an extra outer bracket around the whole "
        "solution. Neither changes the maths.",
        "The lecture's “complex roots always occur in pairs” holds because the coefficients are real; added in the points.",
        "The deck has no worked problems beyond four illustrations; the problems come from the class-work sheet. The deck has no graphs.",
        "ESA: no homogeneous equation is asked on its own in the 8 papers. The shared ESA map gives 24 Unit 2 occurrences; its own "
        "table lists 19 distinct questions, although its summary line says 17.",
        "Bucket session numbers are not contiguous (decks say SESSION 1–11; bucket 009 = session 7, 011 VoP = 8, 011 Legendre = 9, "
        "014 = 10, 015 = 11; 007, 008, 010, 012, 013 do not exist).",
        "Transcript recognition errors were corrected silently: “rules”/“loads”/“load” → roots, “d2 by b dx2” → $\\frac{d^2y}{dx^2}$, "
        "“f of b” → $f(D)$, “a to the power mx” → $e^{mx}$, “dy by dx by u” → by $m$, “LB”/“LT”/“LD” → LDE, “n thirder” → $n$-th order, "
        "“Dq y by dx q”/“mq” → $\\frac{d^3y}{dx^3}$/$m^3$, “arbitrar” → arbitrary, “diffusion differential” → differential, "
        "“r minus”/“pi beta” → $\\pm$/$i\\beta$, “sine beta s” → $\\sin\\beta x$, “c phi”/“m phi”/“mc” → $c_5$/$m_5$/$m_6$, "
        "“complex load” → complex root, “plus or minus divide” → $\\pm2i$, “sine to x” → $\\sin2x$.",
    ],
    "asr_forbidden": ["thirder", "arbitrar ", "Dq y", "mq ", "m phi", "c phi", "diffusion differential", "complex load", "pi beta", "sine beta s"],
}
MODULES = []
