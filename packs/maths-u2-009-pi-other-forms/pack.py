"""Pack metadata: UE26MA141A Unit 2, class 009 — Particular integral when X is any other form (partial fractions, 1/(D-m)X)."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 2 · Higher-Order Linear Differential Equations",
    "scope": "Class 009 · Particular integral when X is any other form",
    "title": "Particular Integral when X is Any Other Form",
    "subtitle": "Complete study pack for class 009 (the deck's SESSION 7): when $X$ is none of the four standard forms, factorise $f(D)$ into "
                "linear factors, split $\\frac{1}{f(D)}$ into partial fractions and apply $\\frac{1}{D-m}X=e^{mx}\\int Xe^{-mx}\\,dx$ to each "
                "term; worked for $\\tan ax$, $\\ln x$, $e^{e^x}$, $\\sin(e^x)$ and $e^{2x}\\sin(e^x)$, with the one ESA question solved in full and "
                "every line checked with sympy",
    "slug": "pi_other_forms",
    "header": "Engg. Mathematics I · Unit 2 · Class 009",
    "compiled_from": "Compiled from the PESU Unit 2 class 009 slide deck (18 slides, title slide “SESSION: 7”), its two AV-summary transcripts "
                     "(T009, 15.2 min; T009b “Continued”, 10.2 min), the Unit 1 &amp; 2 class-work sheet (as a pointer only) and eight past ESA papers.",
    "how_to_use": "Topic 1 is the method itself (Figures F1.1, F1.2): the inverse operator $\\frac{1}{D-m}$ as an integral, partial fractions, and "
                  "the shortcut of applying the linear factors one after another without partial fractions; the example $y''=\\ln x$ is the case "
                  "$m=0$ (integrate twice). Topic 2 is $(D^2+a^2)y=\\tan ax$, where the factors are complex ($D\\pm ia$). Topic 3 is the "
                  "substitution $t=e^x$ for right-hand sides built from $e^x$ ($e^{e^x}$, $\\sin(e^x)$, $e^{2x}\\sin(e^x)$), including the ESA "
                  "question (W3.1). CF cases are in the class 002 pack; the four standard forms (Types 1–5: $e^{ax}$, $\\sin/\\cos$, $x^m$, "
                  "$e^{ax}V$, $xV$) in the class 003–006 packs. They are not re-taught here, but every worked example is complete. Right-hand "
                  "sides $\\tan ax$, $\\sec ax$, $\\csc ax$ can also be done by variation of parameters (class 011 VoP pack; CW P23, P26, P28 ask "
                  "for that method) — see C2.1.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 and "
                "June 2024 (19 distinct Unit 2 questions, 24 occurrences). This session's method is asked exactly once: ESA Dec-23 3c, "
                "$y''+3y'+2y=e^{e^x}$ (7 marks), never repeated in the later papers; it is the same equation as slide 009·10 (W3.1). "
                "Stars: partial fractions with $\\frac{1}{D-m}X$ and the substitution $t=e^x$ ★★ (one ESA question); $\\tan ax$ ★★ (its answer "
                "with $a=2$ is CW P28, which the sheet asks by variation of parameters); $\\frac{1}{D^2}\\ln x$ and the complex-factor details ★. "
                "No CW problem is assigned to this session: the CW sheet's $\\tan$, $\\sec$, $\\csc$ problems (P23, P26, P28) are in the "
                "variation-of-parameters section and are solved in the class 011 VoP pack.",
    "figure_note": "The deck has no graphs, so every figure is added for clarity. Colours follow the Okabe–Ito order: blue = the particular "
                   "integral, vermilion (dashed) = the right-hand side $X$, green = an intermediate integral; grey for guides, asymptotes and "
                   "sample general solutions. Every plotted PI was checked by substituting it back with sympy.",
    "symbols_remark": "Capital $X$ is the right-hand side; small $x$ the variable. $m_1,\\dots,m_n$ are the roots of the auxiliary equation, "
                      "so $f(D)=(D-m_1)\\cdots(D-m_n)$; the transcripts also write the formula with $a$ ($\\frac{1}{D-a}f(x)=e^{ax}\\int e^{-ax}f(x)\\,dx$), "
                      "and in Topic 2 $a$ is the constant of $D^2+a^2$, so $m=\\pm ia$. $A_1,\\dots,A_n$ are partial-fraction coefficients, "
                      "not arbitrary constants ($c_1,c_2$). $t=e^x$ is a substitution variable, not time. $\\ln x$ and $\\log x$ both mean the "
                      "natural logarithm (the slides use both).",
    "coverage_note": "The deck's own title slide says “SESSION: 7”; the bucket numbers it 009 (bucket numbers are not contiguous: the decks "
                     "say SESSION 1–11; 007, 008, 010, 012 and 013 do not exist; 009 = session 7, 011 = sessions 8 (VoP) and 9 (Legendre), "
                     "014 = 10, 015 = 11). Slides 1, 2 and 18 are title and closing slides; slides 3–4 are the method; slides 5–7 $\\tan ax$; "
                     "8–9 $\\ln x$; 10–11 $e^{e^x}$; 12–13 $\\sin(e^x)$; 14–17 $e^{2x}\\sin(e^x)$. T009 covers slides 3–11 and T009b slides 12–17, "
                     "so every content slide has a lecture. No CW problem belongs to this session (the sheet has no “any other form” section).",
    "tag_legend": [
        ("S009·5", "Unit 2 deck 009 (“Particular integral when X is any other form”, SESSION 7), slide 5 (rendered .pptx)"),
        ("T009 00:03:13", "Unit 2 AV-summary transcript “Particular Integral when X is any other form” (15.2 min), segment start"),
        ("T009b 00:01:10", "Unit 2 AV-summary transcript “Particular integral when X is any other form_Continued” (10.2 min), segment start"),
        ("CW U2 P28", "Unit 2 class-work problem 28 (pointer only; solved in the class 011 VoP pack)"),
        ("ESA Dec-23 3c", "Past paper: UE22MA141A Dec 2023, question 3.c"),
    ],
    "sources": [
        {"name": "Deck 009 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/009_Particular_integral_when_X_is_any_other_form__0611074c2202edfa.*",
         "use": "18 slides; content on 3–17 (every equation read from the rendered images)"},
        {"name": "Transcript T009 (all 4 formats)",
         "path": HF + "AV_Summaries/009_Particular_Integral_when_X_is_any_other_form__653ae8f75a03fb1e.*",
         "use": "15.2 min; slides 3–11 (method, $\\tan ax$, $\\ln x$, $e^{e^x}$)"},
        {"name": "Transcript T009b (all 4 formats)",
         "path": HF + "AV_Summaries/009_Particular_integral_when_X_is_any_other_form_Continued__5c24666421028690.*",
         "use": "10.2 min; slides 12–17 ($\\sin(e^x)$, $e^{2x}\\sin(e^x)$)"},
        {"name": "Unit 1 &amp; 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf",
         "use": "Only as a pointer: P23 ($\\sec ax$), P26 ($\\csc x$), P28 ($\\tan 2x$) are variation-of-parameters problems (class 011)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf",
         "use": "Dec-23 3c, via the shared ESA map"},
        {"name": "Video 009 (.mp4, both parts)", "path": HF + "AV_Summaries/009_*.mp4",
         "use": "Not opened: every slide equation is readable and no video trigger applies"},
    ],
    "gaps": [
        "Slide 009·16, line (1), writes the first term of $e^{-2x}\\int t^3\\sin t\\,dt$ as $-e^{-x}\\cos(e^x)$; it is $e^{-2x}(-t^3\\cos t)=-e^{x}\\cos(e^x)$. "
        "Slide 009·17 copies the slip into its first bracket. The boxed answer $y_p=-\\sin(e^x)-6e^{-x}\\cos(e^x)+18e^{-2x}\\sin(e^x)+24e^{-3x}\\cos(e^x)$ "
        "is nevertheless right: with the correct $-e^x\\cos(e^x)$ the two leading terms of (1) and (2) cancel (sympy; W3.3).",
        "Every other slide line was recomputed with sympy: 009·6–7 ($\\frac{1}{D\\mp ia}\\tan ax$ and the PI $-\\frac{1}{a^2}\\cos ax\\log(\\sec ax+\\tan ax)$), "
        "009·9 ($\\frac{x^2\\ln x}{2}-\\frac{3x^2}{4}$), 009·10–11 ($A=-1$, $B=1$, PI $e^{-2x}e^{e^x}$), 009·12–13 ($-e^{-2x}\\sin(e^x)$) and 009·16's "
        "$\\int t^3\\sin t\\,dt$, $\\int t^4\\sin t\\,dt$ are right; the AE roots on 009·5 ($\\pm ia$), 009·8 ($0,0$) agree with their CFs. Slide "
        "009·8 prints “$m^2=0\\Rightarrow\\Rightarrow m=0,0$” (a doubled arrow, harmless).",
        "Slides 009·10–17 ask only for “the particular integral”; the general solutions are added here (CF from the factors). ESA Dec-23 3c asks "
        "to “solve”, so W3.1 gives $y=c_1e^{-x}+c_2e^{-2x}+e^{-2x}e^{e^x}$.",
        "Applying the linear factors one after another, without partial fractions (E1.4), is not on the slides; it is added for clarity because "
        "for $e^{e^x}$ and $\\sin(e^x)$ the order $\\frac{1}{D+2}\\big[\\frac{1}{D+1}X\\big]$ needs only one easy integral each.",
        "T009 00:15:01 closes with “these are the four standard problems”; T009 works three ($\\tan ax$, $\\ln x$, $e^{e^x}$) and T009b two more. "
        "T009 00:12:09 says “unfortunately we can solve this by a normal method”; the sense is “fortunately”: $\\frac{1}{D^2}\\ln x$ is just two "
        "integrations. T009 00:06:46 writes $\\sin^2ax=1-\\cos^2ax$, so $\\frac{\\sin^2ax}{\\cos ax}=\\sec ax-\\cos ax$; the slide keeps "
        "$\\frac{\\sin^2ax}{\\cos ax}$ in one piece. Both give the same integral.",
        "The CW sheet has no problem for this session. Its $\\sec ax$, $\\csc x$ and $\\tan 2x$ problems (P23, P26, P28) say “solve by method of "
        "variation of parameters only” and belong to the class 011 VoP pack; P28's printed answer, $-\\frac14\\cos2x\\log(\\sec2x+\\tan2x)$ plus CF, "
        "is slide 009·7's result with $a=2$.",
        "Transcript recognition errors were corrected silently: “T square plus a square”, “d square plus a square” → $D^2+a^2$; “axillary”, "
        "“axlary” → auxiliary; “1 over e minus a”, “1 over p minus 1 of f of x” → $\\frac{1}{D-a}f(x)$; “second ax” → $\\sec ax$; “than ax” → "
        "$\\tan ax$; “car square ax” → $\\cos^2ax$; “interlog x” → into $\\log x$; “t2x” → $c_2x$; “EE power x”, “sine of v power x”, "
        "“e polix” → $e^{e^x}$, $\\sin(e^x)$, $e^x$; “psi t”, “t s t dt” → $\\sin t$, $t\\sin t\\,dt$; “phi d plus six” → $5D+6$; “we become plus "
        "one” → $B$ becomes $+1$; “area is minus minus 1” → $a$ is $-1$; “absorb it” → observe; “by partnoli rule” → by parts or Bernoulli's rule; "
        "“Sol the” → Solve the.",
    ],
    "asr_forbidden": ["axillary", "axlary", "interlog", "partnoli", "polix", "car square", "EE power", "T square plus"],
}
MODULES = []
