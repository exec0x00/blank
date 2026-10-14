"""Pack metadata: UE26MA141A Unit 1, classes 003–004 — Total derivative, chain rule and implicit functions."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 1 · Partial Differentiation",
    "scope": "Classes 003–004 · Total derivative, chain rule and implicit functions",
    "title": "Total Derivative, Chain Rule and Implicit Functions",
    "subtitle": "Complete study pack: composite functions, the total derivative and total differential, rates of change, "
                "the chain rule for functions of several variables, and implicit differentiation in two and three variables",
    "slug": "total_derivative_chain_rule_implicit",
    "header": "Engg. Mathematics I · Unit 1 · Classes 003–004",
    "compiled_from": "Compiled from the PESU class 003 and 004 slide decks, the four class 003–004 AV-summary transcripts, "
                     "the Unit 1 class-work sheet and past ESA papers.",
    "how_to_use": "Topics 1–7 follow the order of the lectures: class 003 covers topics 1–5, class 004 topics 5–7. "
                  "Several problems on the slides contain errors; they are corrected here and marked as exam traps.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024. In-scope Q1 parts: five chain-rule questions (Jan 2024 set 1 Q1.d and set 2 Q1.d, 5 marks each; "
                "set 3 Q1.b, set 4 Q1.b and June 2024 Q1.a, 6 marks each) and one implicit-function question (Jan 2024 set 3 Q1.d, "
                "6 marks). The total derivative and rates of change were not asked in these papers; they are computed in class-work "
                "problems 9–13. No paper repeats another. Questions on Euler's theorem, Taylor series, maxima and Lagrange belong to "
                "later sessions and are left out.",
    "figure_note": "Colours follow the Okabe–Ito order: blue = main curve or first branch, vermilion = tangent, comparison or second "
                   "branch, green = third series, purple = other directions. Dashed lines are tangents or approximations; grey dashed "
                   "lines are references. Tree diagrams are redrawn from slides 003·5, 003·14 and 004·5. The 3-D picture of the "
                   "point moving on the saddle and cylinder is drawn from the equations of slide 003·7.",
    "symbols_remark": "Watch the letters that change meaning between problems: $t$ is the parameter in the total derivative but one of "
                      "the new variables in the chain-rule problems ($s,t$); $r,s,t$ are intermediate variables in slide 003·15 but "
                      "$r$ is a radius elsewhere; $f$ is the outer function in composite problems and the implicit relation "
                      "$f(x,y)=0$ in class 004.",
    "coverage_note": "Slides 003·1–3, 003·28, 004·1–2 and 004·18 are title, topic-list and closing slides with no content.",
    "notation_table": {
        "title": "Ordinary d or partial ∂?",
        "head": ["Situation", "Write", "Why"],
        "rows": [["$z=f(x,y)$, $x=x(t)$, $y=y(t)$", "$\\dfrac{dz}{dt}$ (total)", "$z$ ends up depending on one variable $t$"],
                 ["$z=f(x,y)$, $x=x(u,v)$, $y=y(u,v)$", "$\\dfrac{\\partial z}{\\partial u},\\ \\dfrac{\\partial z}{\\partial v}$", "$z$ ends up depending on two variables"],
                 ["$f(x,y)=0$", "$\\dfrac{dy}{dx}=-\\dfrac{f_x}{f_y}$", "$y$ is a function of $x$ alone"],
                 ["$f(x,y,z)=0$", "$\\dfrac{\\partial z}{\\partial x}=-\\dfrac{f_x}{f_z}$", "$z$ is a function of $x$ and $y$"],
                 ["$z=f(x,y)$", "$dz=f_x\\,dx+f_y\\,dy$", "total differential: a small change"]],
        "row_heads": False,
    },
    "tag_legend": [
        ("S003·7 · S004·9", "Deck 003 / 004, slide number (rendered .pptx)"),
        ("T003a 00:06:27", "Transcript 003 part I: “Total derivative, chain rule and implicit functions”"),
        ("T003b 00:01:10", "Transcript 003 part II: “Problems on total derivatives, chain rule”"),
        ("T004a 00:13:09", "Transcript 004 part I: “Implicit functions and problems”"),
        ("T004b 00:02:31", "Transcript 004 part II: “Problems on composite and implicit functions”"),
        ("CW U1 P14 · ESA Jan-24 s3 1b", "Unit 1 class-work problem 14 · past-paper question"),
    ],
    "sources": [
        {"name": "Deck 003 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/003_Total_derivative_Chain_rule_problems__74d776a2caa69540.*", "use": "28 slides; content on 4–27"},
        {"name": "Deck 004 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/004_Implicit_functions_Problems_on_Implicit_and_Composite_functions__8dea1ab57d4cc9f6.*", "use": "18 slides; content on 3–17"},
        {"name": "Transcript 003 part I (all 4 formats)",
         "path": HF + "AV_Summaries/003_Total_derivative_Chain_rule_and_Implicit_functions__d194dd0f27d571b2.*", "use": "26.5 min lecture"},
        {"name": "Transcript 003 part II (all 4 formats)",
         "path": HF + "AV_Summaries/003_Problems_on_Total_derivatives_Chain_rule__4d669ee31cdd4a30.*", "use": "11.6 min problems"},
        {"name": "Transcript 004 part I (all 4 formats)",
         "path": HF + "AV_Summaries/004_Implicit_functions_and_problems__28ebf6864cd576d3.*", "use": "22.4 min lecture"},
        {"name": "Transcript 004 part II (all 4 formats)",
         "path": HF + "AV_Summaries/004_Problems_on_Composite_and_Implicit_functions__d1ea652fce3206d2.*", "use": "11.7 min problems"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "use": "Problems 9–18 (with answers)"},
        {"name": "ESA papers, UE22MA141A: Dec 2023, Jul 2023, May 2024", "path": HF2 + "Papers/ESA Papers/UE22MA141A/*.pdf", "use": "Q1 read; none in scope"},
        {"name": "ESA papers, UE23MA141A: Jan 2024 sets 1–4, June 2024", "path": HF2 + "Papers/ESA Papers/UE23MA141A/*.pdf", "use": "6 in-scope Q1 parts"},
        {"name": "Videos 003 and 004 (4 .mp4)", "path": HF + "AV_Summaries/00[34]_*.mp4", "use": "Not opened: every gap was settled from the slides, transcripts and algebra"},
    ],
    "gaps": [
        "Slide 003·6 (z = x²y³, x = t², y = 2t³) is wrong: it gives ∂z/∂x = 2t¹¹, ∂z/∂y = 9t¹⁰ and dz/dt = 60t¹². The correct values are 16t¹¹, 12t¹⁰ and dz/dt = 104t¹², confirmed by substituting first (z = 8t¹³). The lecture (T003a 00:02:05) used a different example, x = t, y = 2t², giving 64t⁷.",
        "Slide 003·10 prints dθ/dt = −25/(300√3) “= 0.04831”, and the lecture repeats 0.04831. The correct value is −√3/36 ≈ −0.0481 rad/s, which the slide's own last line states.",
        "Slide 003·8 writes “dy = 0.03”, but the calculation correctly uses dy = −0.03 (from −3 to −3.03).",
        "Slide 003·16 shows $\\partial v/\\partial y=-3\\,\\partial v/\\partial r+\\partial v/\\partial s$; the coefficient of $\\partial v/\\partial s$ should be 3 (since $s=3y-4z$). The final result $6v_x+4v_y+3v_z=0$ is right.",
        "Slide 003·7 calls x²/16 − y²/9 = z a paraboloid and the lecture says “like a cup”. With the minus sign it is a hyperbolic paraboloid (a saddle). The numbers are unaffected.",
        "Slide 004·4 prints $dy/dx=-f_y/f_x$ for a level curve. It should be $-f_x/f_y$, as slide 004·5's branch diagram and slide 004·6 show.",
        "Slide 004·3's numerator is hard to read in the rendering. The correct $dy/dx$ for $x^3y+3xy^2=3$ is $-3y(x^2+y)/(x(x^2+6y))$.",
        "In the lecture (T004a 00:18:39) problem 3 of deck 004 is worked at the point (1, 0, 2), giving 0 for both derivatives. That point is not on z³ + xy − y²z = 6 (it gives 8). The slide's point (0, 1, 2) is on the surface and gives ∂y/∂x = 1/4, ∂z/∂x = −1/11.",
        "The lecture misspeaks some intermediate values (e.g. “S X is just minus 4”, T003a 00:23:23); the slides' values $r_x=2$, $s_x=0$, $t_x=-2$, … are correct and are used here.",
        "Transcript recognition errors were corrected silently: “x pi” → xy, “cos by” → cos y, “second square” → sec², “phi dy by dx” → find dy/dx, “Gosteep” → cos θ, “x incre” → x increases.",
    ],
    "asr_forbidden": ["Gosteep", "second square", "x pi plus", "cos by", "composive", "geometally"],
}
