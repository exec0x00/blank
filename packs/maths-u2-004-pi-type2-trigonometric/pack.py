"""Pack metadata: UE26MA141A Unit 2, class 004 — Particular integral, Type 2 (X = sin(ax+b), cos(ax+b))."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 2 · Higher-Order Linear Differential Equations",
    "scope": "Class 004 · Particular integral Type 2 (sin ax, cos ax)",
    "title": "Particular Integral, Type 2: Sine and Cosine Right-Hand Side",
    "subtitle": "Complete study pack for class 004: the rule $\\frac{1}{f(D^2)}\\sin(ax+b)=\\frac{\\sin(ax+b)}{f(-a^2)}$, rationalising "
                "odd powers of $D$, the cases of failure $f(-a^2)=0$, and right-hand sides that reduce to Type 2 "
                "(products $\\sin ax\\cos bx$, $\\sin^2ax$, $\\cos^2ax$, $\\sin^3ax$) combined by superposition",
    "slug": "pi_type2",
    "header": "Engg. Mathematics I · Unit 2 · Class 004",
    "compiled_from": "Compiled from the PESU Unit 2 class 004 slide deck, its two AV-summary transcripts (the Type 2 lecture and "
                     "the newer Type 1 and Type 2 problem lecture), the Unit 1 & 2 class-work sheet (problems 13, 14, 18, 21, 22) "
                     "and eight past ESA papers.",
    "how_to_use": "Topic 1 is the Type 2 rule: replace $D^2$ (never $D$) by $-a^2$, then rationalise any odd power of $D$ "
                  "that is left (Figure F1.1). Topic 2 is the case of failure, $f(-a^2)=0$, which happens exactly when "
                  "$D^2+a^2$ is a factor of $f(D)$, that is when $\\pm ai$ are roots of the auxiliary equation (Figures F2.1, G2.1, G2.2); "
                  "it also solves the ESA question $(D-2)^2y=8(e^{2x}+\\sin2x)$, asked three times. Topic 3 reduces products and powers "
                  "of sines and cosines to Type 2 and adds the PIs of the separate terms (Figure F3.1, table C3.1). The complementary "
                  "function rules are in the class 002 pack and the Type 1 rule ($e^{ax}$, constants) in the class 003 pack; both are "
                  "used here without derivation.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024 (19 distinct Unit 2 questions, 24 occurrences; 7 distinct / 9 occurrences are PI by operator rules). "
                "Type 2 sits in 5 distinct questions (7 occurrences): $(D-2)^2y=8(e^{2x}+\\sin2x)$ in Dec-23 3a = May-24 3b = Jun-24 2a "
                "(★★★, 6–7 marks, solved in full here, W2.3), and the Type 2 term of the mixed questions Jul-23 3b ($\\sin x$), "
                "Jan-24 set 1 2d ($\\cos2x$ with a failure), set 3 2c ($\\sin^2x$, = CW P18 = slide 004·17) and set 4 2c ($\\sin^2\\frac x2$), "
                "whose other terms are solved in the class 005 and 006 packs (table C3.2). Stars: the rule, rationalising and the "
                "failure case ★★★; $\\sin^2$/$\\cos^2$ ★★★ (three questions); products $\\sin A\\cos B$ and $\\sin^3$ ★ (slides "
                "only, never asked); the second failure ($x^2$, $f''$) ★ (never asked).",
    "figure_note": "The deck has no graphs, so every figure is added for clarity. Colours follow the Okabe–Ito order: blue = the "
                   "right-hand side or the no-failure case, vermilion = the particular integral or the failure case, green = a "
                   "constant part; grey dashed lines are references (envelopes, the value $a$ at which $f(-a^2)=0$). Every plotted "
                   "PI was checked by substituting it back with sympy.",
    "symbols_remark": "On the slides $f(D^2)$ means $f(D)$ written so that $D$ appears through $D^2$ wherever possible; "
                      "$f(-a^2)$ means “replace every $D^2$ by $-a^2$”. $-a^2$ is minus ($a$ squared), not $(-a)^2$: for $a=2$ it is "
                      "$-4$. In the failure rule, $f'$ is the derivative of $f(D)$ with respect to $D$ (so $D^2+3$ gives $2D$), and "
                      "the result is still an operator to apply, not a number (slide 004·16). The letter $a$ is the frequency in "
                      "$\\sin(ax+b)$; $b$ is a phase and never enters the rule.",
    "coverage_note": "Slides 1, 2 and 18 are title and closing slides; slide 3 is the class content. The Type 2 lecture (T004, "
                     "24.7 min) covers slides 4–14; the newer problem lecture (T004b, 12.6 min) covers slides 15–17 after a "
                     "Type 1 recap (00:00–06:04, cited by the class 003 pack, where it is tagged T004a). Bucket numbers are not "
                     "contiguous (the decks say SESSION 1–11; 007, 008, 010, 012 and 013 do not exist; 009 = session 7, 011 = "
                     "sessions 8 and 9, 014 = 10, 015 = 11); this deck is SESSION 4.",
    "tag_legend": [
        ("S004·9", "Unit 2 deck 004 (“Particular integral of Type 2”), slide 9 (rendered .pptx)"),
        ("T004 00:10:32", "Unit 2 AV-summary transcript “Particular integral of standard functions – Type 2” (24.7 min), segment start"),
        ("T004b 00:08:13", "Unit 2 AV-summary transcript “Particular integral Type 1 and Type 2” (12.6 min, newer recording); its Type 1 "
                           "part is tagged T004a in the class 003 pack"),
        ("CW U2 P13", "Unit 2 class-work problem 13"),
        ("ESA Dec-23 3a", "Past paper: UE22MA141A Dec 2023, question 3.a"),
        ("ESA Jan-24 s1 2d", "Past paper: UE23MA141A Jan 2024 set 1, question 2.d"),
    ],
    "sources": [
        {"name": "Deck 004 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/004_Particular_integral_of_Type_2__03746afc7474a254.*",
         "use": "18 slides; content on 3–17 (every equation read from the rendered images: the .slides.md has none)"},
        {"name": "Transcript T004 (all 4 formats)",
         "path": HF + "AV_Summaries/004_Particular_integral_of_standard_functions_-_Type_2__d25d020162de0016.*",
         "use": "24.7 min; slides 4–14"},
        {"name": "Transcript T004b (all 4 formats)",
         "path": HF + "AV_Summaries/004_Particular_integral_Type_1_and_Type_2__54bec5745a32a447.*",
         "use": "12.6 min; 00:06:12–00:12:28 Type 2 constraints and slides 16–17 (00:00–06:04 is Type 1, used by the class 003 pack)"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf",
         "use": "Unit 2 problems 13 and 14 (solved in full); Type 2 terms of problems 18, 21 and 22"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf",
         "use": "Dec-23 3a (= May-24 3b = Jun-24 2a) in full; Type 2 parts of 4 more questions, via the shared ESA map"},
        {"name": "Videos 004 (.mp4)", "path": HF + "AV_Summaries/004_Particular_integral_of_standard_functions_-_Type_2__d25d020162de0016.mp4",
         "use": "Not opened: every slide equation is readable and no video trigger applies"},
    ],
    "gaps": [
        "Slide 004·14 (and the lecture, T004 00:21:33) gives the constant part of PI$_2$ for $(D-1)^2(D^2+1)y=e^x+\\cos^2\\frac x2$ as "
        "$\\frac14$. It is $\\frac12$: $\\frac{1}{2}\\cdot\\frac{1}{f(0)}=\\frac12\\cdot\\frac{1}{(0-1)^2(0+1)}=\\frac12$. With $\\frac14$, substituting "
        "back leaves $-\\frac14$ (sympy). Correct PI: $\\frac{x^2e^x}{4}+\\frac12+\\frac{x\\cos x}{8}$.",
        "Slide 004·17 drops the factor 2 of $\\frac{\\cos2x}{2(D^3-2D^2+D)}$ in its boxed answer (T004b 00:10:35 says “just ignore this two”). "
        "The correct PI of $(D^3-2D^2+D)y=\\sin^2x$ is $\\frac x2-\\frac{8\\cos2x}{200}+\\frac{6\\sin2x}{200}=\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$, "
        "which agrees with the CW P18 answer; the slide's $\\frac x2-\\frac{8\\cos2x}{100}+\\frac{6\\sin2x}{100}$ leaves $-\\frac{\\cos2x}{2}$ (sympy).",
        "Slide 004·15 writes the failure results as $x\\frac{\\sin(ax+b)}{f'(a)}$ and $x^2\\frac{\\sin(ax+b)}{f''(a)}$, while slides 004·5–6 and "
        "the conditions on slide 004·15 itself use $f'(-a^2)$, $f''(-a^2)$. Read all of them as: differentiate $f(D)$ with respect to $D$, "
        "then replace $D^2$ by $-a^2$ and treat the remaining odd $D$ as integration (slide 004·16 does exactly this: $\\frac{x}{2D}\\cos\\sqrt3x$).",
        "The precise standard results $\\frac{1}{D^2+a^2}\\sin ax=-\\frac{x\\cos ax}{2a}$ and $\\frac{1}{D^2+a^2}\\cos ax=\\frac{x\\sin ax}{2a}$ are added "
        "for clarity (E2.2); they follow from the slides' failure rule.",
        "Slide 004·5's second line has a missing bracket, $\\cos(ax+b$; slide 004·16 writes $\\cos\\sqrt3x$, meaning $\\cos(\\sqrt3x)$.",
        "Slide 004·7 lists $\\sin^3ax$ and $\\cos^3ax$ but gives no identity and no example; the identities $\\sin^3A=\\frac{3\\sin A-\\sin3A}{4}$, "
        "$\\cos^3A=\\frac{3\\cos A+\\cos3A}{4}$, the product-to-sum table and the examples W3.3 and W3.4 are added for clarity.",
        "T004b 00:09:26 says $\\sin^2x=\\frac{1-\\cos x}{2}$; the slide (004·17) and the working use $\\frac{1-\\cos2x}{2}$, which is correct. "
        "T004b 00:11:48 says “64 minus 36 $D^2$”; it is $64-9D^2$ (= 100 after $D^2=-4$), as on the slide.",
        "T004b 00:07:32 says “in case it becomes zero, we go by case one”; it means the same multiply-by-$x$ idea as Type 1, applied with "
        "$f'(D)$ and then $D^2\\to-a^2$.",
        "The lecture's opening example “$D+D^2+D^3$” (T004 00:01:42) is not worked; W1.4 finishes it for $X=\\sin2x$ (added for clarity).",
        "Slides 004·9 and 004·14 stop at $y=y_c+y_p$ and “GS is $y$ = CF + PI”; the general solutions are written out here.",
        "No other slide answer in this class is wrong: slides 004·8–9, 004·10–13 and 004·16 were recomputed (sympy dsolve and checkodesol). "
        "CW P13 ($\\frac{3\\cos3x+\\sin3x}{50}$) and CW P14 ($\\frac{x\\sin\\sqrt3x}{2\\sqrt3}$) answers are right.",
        "ESA: the full mixed questions Jul-23 3b, Jan-24 set 1 2d and set 4 2c are solved in the class 005 pack and Jan-24 set 3 2c in "
        "the class 006 pack; here only their Type 2 terms are worked (table C3.2).",
        "Transcript recognition errors were corrected silently: “f of df” / “f of d” → $f(D)y$, $f(D)$; “Casi X” / “cos e x” / “car square” / "
        "“ka square” → $\\cos ax$, $\\cos^2$; “dq” / “mq” / “AQ” → $D^3$, $m^3$, $a^3$; “b square plus a square” → $D^2+a^2$; “psi beta x” → "
        "$\\sin\\beta x$; “plus r minus” → $\\pm$; “60 into minus 4” → 16 × (−4); “Pi 1” → PI$_1$; “k power X” → $e^{ax}$; “row 3x” → $\\sqrt3x$; "
        "“replace t square” → replace $D^2$; “replace d by gate” → replace $D$ by 0; “minus 40” → $-4D$; “a T into cost 3x” → $8\\cos2x$.",
    ],
    "asr_forbidden": ["Casi X", "car square", "ka square", "psi beta", "row 3x", "by gate", "cost 2x", "cost 3x", "dq plus"],
}
MODULES = []
