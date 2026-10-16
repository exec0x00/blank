"""Pack metadata: UE26MA141A Unit 2, class 005 — Particular integral, Type 3 (X = x^m) and mixed right-hand sides."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 2 · Higher-Order Linear Differential Equations",
    "scope": "Class 005 · Particular integral Type 3 (X = xᵐ)",
    "title": "Particular Integral, Type 3: Polynomial Right-Hand Side",
    "subtitle": "Complete study pack for class 005: the rule $\\frac{1}{f(D)}x^m=[f(D)]^{-1}x^m$ (take the lowest-degree term out, "
                "expand $[1\\pm\\varphi(D)]^{-1}$ by the binomial theorem up to $D^m$, operate term by term), the four standard "
                "expansions, the case where $D$ is a factor of $f(D)$, and the ESA questions that mix Types 1, 2 and 3 "
                "($e^{ax}$, $a^x$, $\\sin$, $\\cos$ and a polynomial) by superposition",
    "slug": "pi_type3",
    "header": "Engg. Mathematics I · Unit 2 · Class 005",
    "compiled_from": "Compiled from the PESU Unit 2 class 005 slide deck, its AV-summary transcript (T005), the Type 3 part of the "
                     "class 006 problem lecture (T006a), the Unit 1 & 2 class-work sheet (problems 15, 16, 21, 22) and eight past ESA papers.",
    "how_to_use": "Topic 1 is the Type 3 rule as the slides state it (Figure F1.1): take the lowest-degree term out, invert, expand, "
                  "differentiate. Topic 2 is the expansion: the four series of slide 005·5 and where to stop (Figure G2.1). Topic 3 is "
                  "$f(D)$ with a factor $D$ (added for clarity). Topic 4 is the exam core: polynomials mixed with $e^{ax}$, $a^x$, "
                  "$\\sin$, $\\cos$, solved by superposition (Figures F4.1–F4.6). CF cases: class 002 pack; Type 1: class 003; "
                  "Type 2: class 004. They are not re-taught here, but every worked example is complete.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024 (19 distinct Unit 2 questions, 24 occurrences; 7 distinct / 9 occurrences are PI by operator rules). "
                "A Type 3 term sits in 4 distinct questions (4 occurrences), every one of them a mixed right-hand side: Jul-23 3b "
                "$(D^2-5D+6)y=e^{4x}+\\sin x+x^2$ (7 marks), Jan-24 set 1 2d $(D^2+4)y=x^2+\\cos2x+2^{-x}$ (5), set 2 2d "
                "$(D^3-6D^2+11D-6)y=e^{2x}+x$ (5) and set 4 2c $(D-1)^2(D+1)^2y=\\sin^2\\frac x2+2^{-x}+x$ (6, = CW P22). All four are "
                "solved in full here, with CW P15, P16 and P21. Stars: the Type 3 rule, the expansions and superposition ★★★ (4 "
                "questions); the case $f(D)$ with a factor $D$ ★ (never asked); the second-order expansion $(1\\pm z)^{-2}$ ★★ "
                "(CW P21 and P22 need it, no paper asks it on its own).",
    "figure_note": "The deck has no graphs, so every figure is added for clarity. Colours follow the Okabe–Ito order: blue = the "
                   "particular integral or the right-hand side, vermilion = a second curve (other solutions, the PI when $D$ is a "
                   "factor), green = a third (the polynomial part); grey is used for terms that vanish. Every plotted PI was checked "
                   "by substituting it back with sympy.",
    "symbols_remark": "The slides use $n$ (slide 005·4) and $m$ (slide 005·10) for the same thing, the degree of the polynomial "
                      "$X=x^n$ or $x^m$; this pack uses $m$. The letter $m$ is also the unknown of the auxiliary equation "
                      "($m^2-1=0$): the two never appear in the same line. $\\varphi(D)$ is “phi of $D$”, the rest of $f(D)$ after the "
                      "lowest-degree term is taken out; in the series of slide 005·5 the letter $x$ stands for $\\varphi(D)$, not for "
                      "the variable $x$ (this pack writes $z$ there).",
    "coverage_note": "Slides 1, 2 and 15 are title and closing slides; slide 3 is the class content. T005 (12.6 min) covers slides 4–9; "
                     "slides 10–14 (the newer “Type 3: $X=x^m$” format with two problems) are explained in the class 006 problem "
                     "lecture, whose first 9 min 55 s are Type 3 (tagged T006a here; the class 006 pack cites the same file, for "
                     "Type 4, as T006b). Bucket numbers are not contiguous (the decks say SESSION 1–11; 007, 008, 010, 012 and 013 do "
                     "not exist; 009 = session 7, 011 = sessions 8 and 9, 014 = 10, 015 = 11); this deck is SESSION 5.",
    "tag_legend": [
        ("S005·8", "Unit 2 deck 005 (“Particular integral of Type 3”), slide 8 (rendered .pptx)"),
        ("T005 00:06:48", "Unit 2 AV-summary transcript “Particular integral of standard functions – Type 3” (12.6 min), segment start"),
        ("T006a 00:06:05", "Unit 2 AV-summary transcript “Particular integral – Type 3 and Type 4” (bucket 006, 15.5 min), its Type 3 "
                           "part 00:00:00–00:09:55; the class 006 pack cites the whole file as T006b"),
        ("CW U2 P15", "Unit 2 class-work problem 15"),
        ("ESA Jul-23 3b", "Past paper: UE22MA141A Jul 2023, question 3.b"),
        ("ESA Jan-24 s2 2d", "Past paper: UE23MA141A Jan 2024 set 2, question 2.d"),
    ],
    "sources": [
        {"name": "Deck 005 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/005_Particular_integral_of_Type_3__50cbfe7011ebf0b0.*",
         "use": "15 slides; content on 3–14 (every equation read from the rendered images)"},
        {"name": "Transcript T005 (all 4 formats)",
         "path": HF + "AV_Summaries/005_Particular_integral_of_standard_functions_-_Type_3__1f8ea5ed4d7e088f.*",
         "use": "12.6 min; slides 4–9"},
        {"name": "Transcript T006a (all 4 formats)",
         "path": HF + "AV_Summaries/006_Particular_integral_-Type_3_and_Type_4__fb358573adb09195.*",
         "use": "15.5 min; 00:00:00–00:09:55 Type 3 and slides 10–14 (the rest is Type 4, used by the class 006 pack)"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf",
         "use": "Unit 2 problems 15, 16, 21 and 22 (all solved in full; all four printed answers are right)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf",
         "use": "Jul-23 3b, Jan-24 set 1 2d, set 2 2d, set 4 2c, via the shared ESA map"},
        {"name": "Video 005 (.mp4)", "path": HF + "AV_Summaries/005_Particular_integral_of_standard_functions_-_Type_3__1f8ea5ed4d7e088f.mp4",
         "use": "Not opened: every slide equation is readable and no video trigger applies"},
    ],
    "gaps": [
        "Slide 005·7 expands $-(1-D^2)^{-1}$ as $-(1-D^2+D^4-\\dots)$; it is $-(1+D^2+D^4+\\dots)$, because $(1-z)^{-1}$ has only plus "
        "signs (slide 005·5). The lecturer corrects it aloud (T005 00:07:07). The answer $2-5x$ is unaffected, since $D^2(5x-2)=0$.",
        "Slide 005·13 gives the roots of $2m^2+2m+3=0$ as $\\frac{-2\\pm\\sqrt5i}{2}$; they are $\\frac{-1\\pm\\sqrt5i}{2}$ "
        "($=\\frac{-2\\pm\\sqrt{-20}}{4}$). The CF it writes, $e^{-x/2}(\\dots\\frac{\\sqrt5}{2}x)$, uses the correct roots, and so does "
        "the lecture (T006a 00:07:45).",
        "Slides 005·13 and 005·14 write the CF as $e^{-x/2}\\big(c_1\\cos\\frac{\\sqrt5}{2}x+\\sin\\frac{\\sqrt5}{2}x\\big)$: the constant $c_2$ "
        "is missing on the sine term. A second-order equation needs two arbitrary constants.",
        "Slide 005·3 reads “$f(D)y=x$ when $x=x^n$”; it means $f(D)y=X$ with $X=x^n$ (capital $X$).",
        "T006a 00:02:23 says “the $n$th derivative of $x^m$ is zero when $n$ is $m$”; it is zero when $n>m$ (the $m$th derivative is the "
        "constant $m!$), as the lecture itself said at 00:01:29 and slide 005·4 says.",
        "The slides never show $f(D)$ without a constant term; the case of a factor $D$ (Topic 3, W3.1, W3.2) is added for clarity. It "
        "follows the slide rule literally: the lowest-degree term is then $D$ (or $D^2$), and $\\frac1D$ is integration (class 003 pack).",
        "Slides 005·8–9 ask only for the PI; slides 005·6–7 stop at “the GS is $y=y_c+y_p$”: the general solutions are written out here.",
        "All slide answers were recomputed with sympy (dsolve, checkodesol): 005·7 $2-5x$, 005·9 $\\frac14(x^2+\\frac92x+\\frac{23}{8})$, "
        "005·12 $\\frac12(x^3-\\frac{7x^2}{2}+\\frac{30x}{4}-\\frac{31}{4})$ and 005·14 $\\frac13(x^2+\\frac{2x}{3}-\\frac{25}{9})$ are right. "
        "The CW answers of P15, P16, P21 and P22 are right too.",
        "ESA Jan-24 set 4 2c is the same question as CW P22. The Type 1 and Type 2 terms of the mixed questions are taught in the class 003 "
        "and 004 packs; the class 004 pack works only their Type 2 terms and points here for the full solutions.",
        "Transcript recognition errors were corrected silently: “extra the parian” → $x^n$; “5 of d”, “5 d”, “phi d” → $\\varphi(D)$ or "
        "$5D$ by context ($D^2+5D+4$); “ascending power set / power sub b” → ascending powers of $D$; “root 3” → rule 3; “25 $D^2$ by 60” → "
        "$\\frac{25D^2}{16}$; “20 by 16” → $\\frac{25}{16}$; “particular integraph” → particular integral; “P power n”, “b power m”, “t square” → "
        "$D^n$, $D^m$, $D^2$; “axillary” → auxiliary; “x square plus x square” (T006a 00:03:21) → $x^3+x^2$.",
    ],
    "asr_forbidden": ["extra the parian", "integraph", "power set using", "power sub b", "P power n", "b power m", "plus phi d"],
}
MODULES = []
