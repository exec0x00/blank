"""Pack metadata: UE26MA141A Unit 2, class 003 — Particular integral, Type 1 (X = e^{ax})."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 2 · Higher-Order Linear Differential Equations",
    "scope": "Class 003 · Particular integral Type 1 ($X=e^{ax}$)",
    "title": "Particular Integral, Type 1: Exponential Right-Hand Side",
    "subtitle": "Complete study pack for class 003: the inverse differential operator, the important results for $\\frac1D$ and "
                "$\\frac1{D-a}$, the rule $\\frac{1}{f(D)}e^{ax}=\\frac{e^{ax}}{f(a)}$ and its cases of failure, and the extension "
                "to constants, $\\sinh ax$, $\\cosh ax$ and $a^x$",
    "slug": "pi_type1",
    "header": "Engg. Mathematics I · Unit 2 · Class 003",
    "compiled_from": "Compiled from the PESU Unit 2 class 003 slide deck and AV-summary transcript, the Type 1 part of the class 004 "
                     "problem transcript, the Unit 1 & 2 class-work sheet (problems 10–12) and eight past ESA papers.",
    "how_to_use": "Topic 1 defines the inverse operator $\\frac{1}{f(D)}$ and proves that $\\frac{1}{f(D)}X$ is the particular integral. "
                  "Topic 2 lists the important results ($\\frac1D$ = integration, $\\frac1{D-a}X=e^{ax}\\int e^{-ax}X\\,dx$). Topic 3 is the "
                  "Type 1 rule and its failure ladder (Figure F3.1: learn it by heart). Topic 4 extends the rule to constants, "
                  "$\\sinh$, $\\cosh$ and $a^x$ and works the Type 1 part of every ESA question (table C4.2). The complementary function "
                  "of each problem is written without comment: its rules are in the class 002 pack. The Type 2, 3 and 4 parts of the "
                  "mixed ESA questions are solved in the class 004, 005 and 006 packs.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 and "
                "June 2024 (19 distinct Unit 2 questions, 24 occurrences). No question is Type 1 alone, but a Type 1 term sits inside "
                "6 distinct questions (8 occurrences): $8e^{2x}$ with a double failure in Dec-23 3a (= May-24 3b = Jun-24 2a), $e^{4x}$ in "
                "Jul-23 3b, $2^{-x}$ in Jan-24 set 1 2d and set 4 2c, $e^{2x}$ with a single failure in set 2 2d, and the constant $\\frac12$ "
                "of $\\sin^2$ in set 3 2c (a failure at $a=0$) and set 4 2c. Stars: the rule and its first two failure cases ★★★; "
                "$a^x$, constants, $\\sinh/\\cosh$ and $\\frac{1}{D-a}$ ★★ (asked once or twice, or class-work); the third failure "
                "($x^3$) ★ (lecture only, never asked).",
    "figure_note": "The deck has no graphs, so every figure is added for clarity. Colours follow the Okabe–Ito order: blue = no failure, "
                   "vermilion (dashed) = one failure, green = two failures; grey dashed lines are references. Every plotted particular "
                   "integral was found by the Type 1 rule and checked by substituting it back with sympy.",
    "symbols_remark": "The letter $a$ has two jobs on the slides: the exponent in $e^{ax}$ and the base in $a^x$. In $a^x=e^{x\\log a}$ the "
                      "exponent is $\\log a$, so $D$ is replaced by $\\log a$, not by $a$. $X$ (capital) is the right-hand side, a function "
                      "of $x$ (small). $\\log$ is the natural logarithm. $k$ is a constant right-hand side (the slides write K).",
    "coverage_note": "Slides 1, 2, 18: title and closing; slide 3: class content. The lecture covers slides 4–12; slides 13–17 are worked "
                     "in the class 004 problem lecture (T004a). Bucket numbers are not contiguous (decks say SESSION 1–11; 007, 008, 010, 012, "
                     "013 do not exist; 009 = session 7, 011 = 8 and 9, 014 = 10, 015 = 11); this deck is SESSION 3.",
    "tag_legend": [
        ("S003·8", "Unit 2 deck 003 (“Particular integral of Type 1”), slide 8 (rendered .pptx)"),
        ("T003 00:10:15", "Unit 2 AV-summary transcript 003 (“Particular integral of standard functions – Type 1”, 21 min), segment start"),
        ("T004a 00:02:06", "Unit 2 AV-summary transcript in bucket 004 (“Particular integral Type 1 and Type 2”, 12.6 min); only its "
                           "Type 1 part (00:00:00–00:06:04) and the constant term of its $\\sin^2x$ example are cited here. The class 004 "
                           "pack cites the same file."),
        ("CW U2 P10", "Unit 2 class-work problem 10"),
        ("ESA Jan-24 s1 2d", "Past paper: UE23MA141A Jan 2024 set 1, question 2.d"),
    ],
    "sources": [
        {"name": "Deck 003 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/003_Particular_integral_of_Type_1__f4ba122af8cfae89.*",
         "use": "18 slides; content on 3–17 (every equation read from the rendered images)"},
        {"name": "Transcript 003 (all 4 formats)",
         "path": HF + "AV_Summaries/003_Particular_integral_of_standard_functions_-_Type_1__22d81006814d93bf.*",
         "use": "21 min; slides 3–12"},
        {"name": "Transcript 004a, Type 1 part (all 4 formats)",
         "path": HF + "AV_Summaries/004_Particular_integral_Type_1_and_Type_2__54bec5745a32a447.*",
         "use": "00:00:00–00:06:04: Type 1 recap and slides 14–17 worked; 00:09:26–00:10:35: constant term of $\\sin^2x$ (failure at $a=0$)"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf",
         "use": "Unit 2 problems 10–12 (page 5 rendered at 250 dpi to read the answers); Type 1 terms of problems 21 and 22"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf",
         "use": "Type 1 parts of 6 distinct questions (table C4.2), via the shared ESA map"},
        {"name": "Videos 003 and 004 (.mp4)", "path": HF + "AV_Summaries/003_Particular_integral_of_standard_functions_-_Type_1__22d81006814d93bf.mp4",
         "use": "Not opened: every slide equation is readable and the transcripts raise no question the slides cannot answer"},
    ],
    "gaps": [
        "CW P11 answer is wrong: it prints $\\frac{x^2e^x}{5}$; the correct term is $\\frac{x^2e^x}{6}$, since $f''(D)=6D$ gives $f''(1)=6$ "
        "(slide 003·17 and T004a 00:05:28 agree with 6). Substituting the CW answer back leaves $\\frac{e^x}{5}$ over (sympy).",
        "CW P10 answer is misprinted: it reads $(c_1e^{-x}+c_2e^{4x}x)-\\frac{e^x}{6}+\\frac{4xe^x}{5}$. The correct answer is "
        "$c_1e^{-x}+c_2e^{4x}-\\frac{e^x}{6}+\\frac45xe^{4x}$: the $x$ belongs to the PI, and its exponential is $e^{4x}$.",
        "CW P12 (homework) answer is right: $(c_1+c_2x+c_3x^2)e^{-x}+c_4e^{2x}+\\frac38e^{-2x}-\\frac29x^3e^{-x}-\\frac94$ (sympy dsolve and checkodesol).",
        "Slide 003·17 writes “In PI$_2$ … $f(a)=4$ then PI$_2=\\frac{e^{-x}}{4}$” but slide 003·16 defined PI$_2=\\frac{-1}{D^3-3D+2}e^{-x}$, "
        "which is $-\\frac{e^{-x}}{4}$. The final line $\\frac{x^2e^x}{6}-\\frac{e^{-x}}{4}$ is right; only the sign bookkeeping slips. "
        "Slide 003·16 also writes “$f(D)=(D^3-3D+2)y=e^x-e^{-x}$”, mixing the operator and the equation.",
        "Slide 003·12 stops at $y=y_c+y_p$ with $y_p$ unsimplified; this pack finishes it: $\\frac{a^{-x}}{(\\log a)^2+2\\log a+2}+e^x$ "
        "(the second denominator is $1-2+2=1$).",
        "Slide 003·9 gives $\\frac{K}{f(D)}=\\frac{K}{f(0)}$ without the proviso $f(0)\\neq0$; the lecture adds it and the failure "
        "$\\frac{xK}{f'(0)}$ (T003 00:14:25). Slide 003·13 says “similarly, it proceeds on when $f''(a)=0$”; the lecture gives the next "
        "rung $\\frac{x^3e^{ax}}{f'''(a)}$ (T003 00:13:19).",
        "Slide spellings “arbitarary” (003·4) and “Complimentary function” (003·6) mean arbitrary and complementary. The lecture says $\\frac{1}{D^2}X$ is “2 times integration” (T003 00:07:03): it means integrating twice, $\\iint X\\,dx\\,dx$, not $2\\int X\\,dx$.",
        "The rule for a root of multiplicity $k$ in the form $\\frac{x^ke^{ax}}{k!\\,\\varphi(a)}$ (with $f(D)=(D-a)^k\\varphi(D)$) is added for clarity; it is equivalent to the slides' ladder.",
        "No slide answer in this class is wrong: slides 003·12, 14, 15 and 16–17 were recomputed (sympy, substitution and dsolve).",
        "ESA: no question is Type 1 alone; the full mixed questions are solved in the class 004 (Dec-23 3a), 005 (Jul-23 3b, Jan-24 s1 2d, "
        "s2 2d, s4 2c) and 006 (Jan-24 s3 2c) packs. Here only their Type 1 terms are worked.",
        "Transcript recognition errors were corrected silently: “f of b”/“f of df y”/“1 by eight f of d” → $f(D)y$, $\\frac{1}{f(D)}$; "
        "“E par ax”/“e po”/“e bar” → $e^{ax}$; “human differential equation” → given differential equation; “R. constant” → arbitrary "
        "constant; “important resources” → important results; “sine hyperbolic eggs” → $\\sinh ax$; “psi beta x” → $\\sin\\beta x$; "
        "“plus r minus” → $\\pm$; “login” → $\\log a$; “d minus e”/“d minus p” → $D-a$, $D-b$; in T004a “k power X” → $e^{ax}$, "
        "“h square” → $x^2$, “replace d by gate” → replace $D$ by 0.",
    ],
    "asr_forbidden": ["E par ax", "psi beta", "hyperbolic eggs", "human differential", "important resources", "f of b", "1 by eight", "h square"],
}
MODULES = []
