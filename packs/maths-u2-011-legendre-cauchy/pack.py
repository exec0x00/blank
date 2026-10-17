"""Pack metadata: UE26MA141A Unit 2, class 011 (Legendre; the deck's SESSION 9) — Legendre's and Cauchy's linear DEs."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 2 · Higher-Order Linear Differential Equations",
    "scope": "Class 011 (Legendre) · Legendre's and Cauchy's linear differential equations",
    "title": "Legendre's and Cauchy's Linear Differential Equations",
    "subtitle": "Complete study pack for class 011, Legendre (the deck's SESSION 9): linear equations with variable coefficients "
                "$k_0(ax+b)^ny^{(n)}+\\dots+k_ny=X$ reduced to constant coefficients by $ax+b=e^z$, with $(ax+b)\\frac{dy}{dx}=aDy$, "
                "$(ax+b)^2\\frac{d^2y}{dx^2}=a^2D(D-1)y$; Cauchy's equation as the case $a=1$, $b=0$ ($x=e^z$); the slide example, the three "
                "lecture examples, all five class-work problems and all six distinct ESA questions (6–7 marks each) solved in full and checked with sympy",
    "slug": "legendre_cauchy",
    "header": "Engg. Mathematics I · Unit 2 · Class 011 (Legendre)",
    "compiled_from": "Compiled from the PESU Unit 2 deck “Legendre's differential equation” (bucket 011, 11 slides, title slide “SESSION: 9”), "
                     "its two AV-summary transcripts (T011L, 21.9 min; T011Lb “Continued”, 23 min), the Unit 1 &amp; 2 class-work sheet "
                     "(problems 29–33) and eight past ESA papers.",
    "how_to_use": "Topic 1: what a Legendre or Cauchy equation is (recognise it: degree of the coefficient = order of the derivative). "
                  "Topic 2: the substitution and the operator results (E2.1–E2.6, F2.1) — the whole method. Topic 3: Legendre problems "
                  "(slide example, CW P29–P30, five ESA questions). Topic 4: Cauchy problems (lecture examples, CW P31–P33, ESA Jan-24 s3 3d). "
                  "After the substitution every problem is a constant-coefficient equation in $z$: CF cases are in the class 002 pack, the PI "
                  "rules in classes 003 ($e^{kz}$, incl. failure), 004 ($\\sin$, $\\cos$), 005 (polynomials in $z$), 006 ($e^{kz}V$, $zV$), "
                  "009 ($\\frac{1}{D-m}X=e^{mz}\\int Xe^{-mz}dz$) and variation of parameters in the class 011 VoP pack.",
    "pyq_note": "Eight ESA papers checked: UE22MA141A Dec 2023, Jul 2023, May 2024; UE23MA141A Jan 2024 sets 1–4, June 2024 (19 distinct "
                "Unit 2 questions, 24 occurrences). Legendre/Cauchy is the most-asked Unit 2 topic: 6 distinct, 8 occurrences, in all 8 papers, "
                "6–7 marks each. Legendre: Dec-23 3b, Jul-23 3a = May-24 3a, Jan-24 s1 3c, s2 3c, Jun-24 3b; Cauchy: Jan-24 s3 3d = s4 3c. "
                "Substitution, operator results and RHS conversion ★★★; polynomial RHS (4×) and PI failure cases (4 of 6) ★★★; "
                "$\\sin(k\\log(ax+b))$ (1× + CW P29) ★★; general $n$-th order result and order-3/4 Cauchy (lecture only) ★★; "
                "multiplying $xy''''+10y'''=0$ into Cauchy form ★.",
    "figure_note": "The deck has no graphs, so every figure is added for clarity. Colours follow the Okabe–Ito order: blue = the particular "
                   "integral or the main curve, vermilion (dashed) = the right-hand side or a second curve, green and purple = CF terms; grey for "
                   "asymptotes, guides and sample general solutions. Every plotted solution was checked by substituting it back with sympy.",
    "symbols_remark": "$z$ is the new independent variable: $z=\\log(ax+b)$ (Legendre) or $z=\\log x$ (Cauchy). From the substitution on, "
                      "$D$ means $\\frac{d}{dz}$, not $\\frac{d}{dx}$ (the lecture stresses this; some books write $\\theta$). Capital $X$ is the "
                      "right-hand side; small $x$ the variable. The deck writes the coefficients $k_0,k_1,\\dots,k_n$; $a$, $b$ are the constants "
                      "of the linear factor $ax+b$. $\\log$ means $\\log_e$, and the solutions hold where $ax+b>0$ (Cauchy: $x>0$).",
    "coverage_note": "The deck's own title slide says “SESSION: 9”; the bucket numbers it 011 and files both this deck and the variation-of-"
                     "parameters deck (“SESSION: 8”) under 011 — hence the tags S011L and S011V (bucket numbers are not contiguous: the decks "
                     "say SESSION 1–11; 007, 008, 010, 012 and 013 do not exist; 009 = session 7, 011 = sessions 8 and 9, 014 = 10, 015 = 11). "
                     "Slides 1–3 and 11 are title, class-content and closing slides; slide 4 gives both forms (Legendre and Cauchy); slides 5–7 "
                     "the substitution and operator results for Legendre; 8–10 one worked example. The deck has no Cauchy substitution and no "
                     "Cauchy example: T011L (00:16:51–00:21:24) derives $x=e^z$, and T011Lb works two Cauchy examples (00:04:59, 00:17:56) "
                     "besides the slide example (00:12:26). Cauchy's equation is the syllabus “self-learning component” (CW sheet header) but is "
                     "asked in ESA Jan-24 s3/s4 and CW P31–P33, so it is covered fully here, flagged transcript only where it is not on the slides.",
    "tag_legend": [
        ("S011L·8", "Unit 2 deck 011 “Legendre's differential equation” (SESSION 9), slide 8 (rendered .pptx)"),
        ("T011L 00:05:20", "AV-summary transcript “Legendre differential equation” (21.9 min, listed first), segment start"),
        ("T011Lb 00:12:26", "AV-summary transcript “Legendre differential equations_Continued” (23 min, second), segment start"),
        ("CW U2 P30", "Unit 1 &amp; 2 class-work sheet, Unit 2 problem 30"),
        ("ESA Jul-23 3a", "Past paper: UE22MA141A July 2023, question 3.a (Jan-24 s1…s4 = UE23MA141A Jan 2024 sets 1–4)"),
    ],
    "sources": [
        {"name": "Deck 011 Legendre (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/011_Legendre_s_differential_equation__0cbc3f8639965d66.*",
         "use": "11 slides; content on 4–10 (every equation read from the rendered images; .slides.md has no equations)"},
        {"name": "Transcript T011L (all 4 formats)",
         "path": HF + "AV_Summaries/011_Legendre_differential_equation__04e8c1e6bb4bea05.*",
         "use": "21.9 min; theory: both forms, the derivation of $(ax+b)^2y''=a^2D(D-1)y$, Cauchy's substitution $x=e^z$"},
        {"name": "Transcript T011Lb (all 4 formats)",
         "path": HF + "AV_Summaries/011_Legendre_differential_equations_Continued__e286e5075a9d86f4.*",
         "use": "23 min; recap and three problems: Cauchy order 3, the slide example, $xy''''+10y'''=0$"},
        {"name": "Unit 1 &amp; 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf",
         "use": "Problems 29–33 (“Problems on Legendre's linear differential equations”), page 6 rendered at 150 dpi; every answer recomputed"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf",
         "use": "Dec-23 3b, Jul-23 3a, May-24 3a, Jan-24 s1 3c, s2 3c, s3 3d, s4 3c, Jun-24 3b, via the shared ESA map (Dec-23 re-read)"},
        {"name": "Video 011 Legendre (.mp4, both parts)", "path": HF + "AV_Summaries/011_Legendre_differential_equation*.mp4",
         "use": "Not opened: every slide equation is readable, no transcript segment has avg_logprob below −0.5, and the one garbled "
                "number (T011Lb 00:11:38) is settled by the working; no video trigger applies"},
    ],
    "gaps": [
        "Slide 011L·5 prints the third term of the $n$-th order Legendre form as $k_2(ax+b)^{n-2}\\frac{d^{n-1}y}{dx^{n-1}}$, and slide 011L·4 "
        "prints the third term of Cauchy's form as $k_2x^{n-2}\\frac{d^{n-1}y}{dx^{n-1}}$: the derivative must be $\\frac{d^{n-2}y}{dx^{n-2}}$ "
        "(degree of the coefficient = order of the derivative, as slide 011L·4's own Legendre line and T011L 00:04:06 say). Corrected in E1.1, E1.2 and a trap.",
        "Slides 011L·8–10 (the worked example $(2x+3)^2y''-2(2x+3)y'-12y=6x$) were recomputed with sympy: the reduced equation "
        "$(D^2-2D-3)y=\\frac34(e^z-3)$, the CF $c_1(2x+3)^3+\\frac{c_2}{2x+3}$ and the PI $\\frac34-\\frac{3(2x+3)}{16}$ are right. Slide 011L·10 "
        "ends with “Thus, $y=y_c+y_p$”; the general solution is written out in W3.1. Slide 011L·7 writes the reduced right-hand side as "
        "“$f(Z)$” (capital $Z$); it is the right-hand side $X$ written in terms of $z$.",
        "CW P29's answer is printed “$\\dots-\\log(1+x)-\\cos\\log(1+x)$” (and “$\\sin[\\mathrm{lox}(1+x)]$”): the PI is the product "
        "$-\\log(1+x)\\cos[\\log(1+x)]$; the printed sum does not satisfy the equation (sympy residual $-\\log(1+x)-2\\sin\\log(1+x)$). W3.2.",
        "CW P30's printed answer “$C_1[(2+3x)^2]+C_2[(2+3x)^2]+\\frac{1}{108}[(2+3x)^2\\log(3x+2)+1]$” repeats $(2+3x)^2$: the second CF term "
        "is $(2+3x)^{-2}$ (AE roots $\\pm2$). The PI is right. W3.4.",
        "CW P31's printed answer has $-\\frac{x^3}{3}(\\log x+\\frac23)$; the PI is $-\\frac{x^2}{3}(\\log x+\\frac23)$ (the right-hand side is "
        "$x^2\\log x=ze^{2z}$, and 2 is not an AE root). The printed term does not satisfy the equation (sympy). W4.3.",
        "CW P32's printed answer has $-2(\\log x)^2$; the PI is $+2(\\log x)^3$: in $z$ the equation is $D^2y=12z$, so $y_p=2z^3$ (sympy dsolve "
        "gives $C_1+C_2\\log x+2\\log^3x$). W4.4. CW P33's answer is right as printed.",
        "ESA Dec-23 3b prints the right-hand side “$\\sin2(\\log(1+x))$”. It is read here as $\\sin(2\\log(1+x))$ (PI $-\\frac13\\sin(2\\log(1+x))$). "
        "CW P29 has the different right-hand side $2\\sin[\\log(1+x)]$ (a failure case, PI $-\\log(1+x)\\cos\\log(1+x)$). If $\\sin^2(\\log(1+x))$ "
        "were meant, the PI would be $\\frac12+\\frac16\\cos(2\\log(1+x))$. All three are worked/checked in W3.2–W3.3.",
        "ESA Jan-24 s3 3d ($x^2y''-4xy'+6y=x^4\\sin x$) becomes $(D^2-5D+6)y=e^{4z}\\sin(e^z)$ in $z$, which is not a standard PI form; it is solved "
        "by the class 009 rule $\\frac{1}{D-m}X=e^{mz}\\int Xe^{-mz}dz$ twice, and checked by variation of parameters in $x$ (W4.6). Neither "
        "route is on the slides.",
        "sympy's dsolve cannot solve the Legendre forms directly in $x$ (NotImplementedError), so every Legendre answer was checked with "
        "checkodesol on the full general solution plus substitution at three points; the Cauchy answers were also checked with dsolve where it succeeds.",
        "The deck shows no Cauchy substitution and no Cauchy example: $x=e^z$, $xy'=Dy$, $x^2y''=D(D-1)y$, $x^3y'''=D(D-1)(D-2)y$ come from T011L "
        "00:18:30–00:19:24 and T011Lb 00:04:06; the order-3 and order-4 examples from T011Lb (transcript only). Cauchy's equation is the CW sheet's "
        "“Self-learning component”, yet it is asked in ESA Jan-24 s3 3d = s4 3c.",
        "T011Lb 00:21:50–00:22:20 stops at “$c_4x$ to the …”: the last term is $c_4x^{-7}$ (root $-7$). T011Lb 00:11:38 reads the PI coefficient as "
        "“5 into 10 by 52”; the working gives $\\frac{10}{5}=2$, so $y_p=5x+\\frac{2\\log x}{x}$ (as said at 00:11:56).",
        "The general $n$-th order result $(ax+b)^n\\frac{d^ny}{dx^n}=a^nD(D-1)\\cdots(D-n+1)y$ is on the slides only for $n=1,2,3$ (011L·6); the "
        "general form is added for clarity (sympy-checked on $(ax+b)^m$ for $n\\le3$).",
        "Transcript recognition errors were corrected silently: “Legendary's”, “legendary”, “legend raise”, “Letch and Grace”, “Legendary C” → "
        "Legendre's; “Cautious differential equation”, “causation d” → Cauchy's (equation); “scenear”, “Lia differential” → linear differential; "
        "“n third or derivative”, “n minus 1 third derivative” → $n$-th, $(n-1)$-th derivative; “delimitative”, “derivativity”, “therivative” → "
        "derivative; “dq”, “mq” → $D^3$, $m^3$; “psi 1z”, “c sign” → $\\sin z$; “bz by dx” → $\\frac{dz}{dx}$; “t square”, “8 t” → $D^2$, $8D$; "
        "“of by” → of $y$; “P par Z”, “epar z” → $e^z$; “e x plus three” → $2x+3$; “first return” → first term; “source 2” → is 2; “LD” → LDE.",
    ],
    "asr_forbidden": ["Letch and Grace", "legend raise", "scenear", "delimitative", "derivativity", "therivative", "epar z"],
}
MODULES = []
