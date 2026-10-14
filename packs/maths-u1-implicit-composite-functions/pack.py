"""Pack metadata: UE26MA141A Unit 1, class 004 — Implicit functions, problems on implicit and composite functions."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 1 · Partial Differentiation",
    "scope": "Class 004 · Implicit functions, problems on implicit and composite functions",
    "title": "Implicit and Composite Functions",
    "subtitle": "Complete study pack for class 004: level surfaces and the differential, implicit differentiation in two and three "
                "variables, composite functions and the chain rule, and polar-coordinate problems",
    "slug": "implicit_composite_functions",
    "header": "Engg. Mathematics I · Unit 1 · Class 004",
    "compiled_from": "Compiled from the PESU class 004 slide deck and its two AV-summary transcripts, the implicit-function problems "
                     "that close class 003, the Unit 1 class-work sheet and past ESA papers.",
    "how_to_use": "Topics 1–3 follow the first class 004 lecture (implicit functions); topics 4–5 follow the problem session on "
                  "composite functions. The same material also appears, together with class 003, in the pack “Total Derivative, "
                  "Chain Rule and Implicit Functions”; this pack is the focused class 004 version.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024. In scope: one implicit-function question (Jan 2024 set 3 Q1.d, 6 marks) and five composite-function "
                "(chain rule) questions (Jan 2024 set 1 Q1.d and set 2 Q1.d, 5 marks; set 3 Q1.b, set 4 Q1.b and June 2024 Q1.a, "
                "6 marks). Polar-coordinate problems and tangent lines to implicit curves were not asked in these papers; they are "
                "computed in class and in CW problems 15–18. Total-derivative and rate problems (class 003) are left out.",
    "figure_note": "Colours follow the Okabe–Ito order: blue = main curve or first branch, vermilion = tangent or second branch, "
                   "green and purple for further series. Dashed lines are tangents; grey dashed lines are references. The level-surface "
                   "picture and the polar diagram are drawn from the equations discussed in the lecture; the slides' grapher "
                   "screenshots are not copied.",
    "symbols_remark": "The letter $f$ means two different things in this class: the implicit relation $f(x,y)=0$ (topics 1–3) and "
                      "the outer function of a composite $u=f(x,y)$ (topics 4–5). Likewise $r$ is a radius in polar problems but "
                      "$r=\\sqrt{x^2+y^2+z^2}$ in slide 004·12.",
    "coverage_note": "Slides 004·1, 004·2 and 004·18 are title, session and closing slides with no content. From class 003, slides 26–27 "
                     "(implicit-function problems) are worked in full; its slides 5–17 are cited only where class 004 reuses class 003's "
                     "definitions (total differential, chain rule, tree diagram).",
    "notation_table": {
        "title": "Which formula, which symbol?",
        "head": ["Relation given", "You want", "Formula"],
        "rows": [["$f(x,y)=c$", "$\\dfrac{dy}{dx}$", "$-\\dfrac{f_x}{f_y}$"],
                 ["$f(x,y,z)=0$", "$\\dfrac{\\partial z}{\\partial x},\\ \\dfrac{\\partial z}{\\partial y}$", "$-\\dfrac{f_x}{f_z},\\ -\\dfrac{f_y}{f_z}$"],
                 ["$f(x,y,z)=0$", "$\\dfrac{\\partial y}{\\partial x}$ ($z$ held)", "$-\\dfrac{f_x}{f_y}$"],
                 ["$u=f(x,y)$, $x,y$ of $s,t$", "$\\dfrac{\\partial u}{\\partial s}$", "$f_x\\,x_s+f_y\\,y_s$"],
                 ["$u=f(x,y)$, with $x,y$ linked by $g(x,y)=0$", "$\\dfrac{du}{dx}$", "$u_x+u_y\\,\\dfrac{dy}{dx}$ with $\\dfrac{dy}{dx}=-\\dfrac{g_x}{g_y}$"]],
        "row_heads": False,
    },
    "tag_legend": [
        ("S004·9 · S003·26", "Deck 004 / 003, slide number (rendered .pptx)"),
        ("T004a 00:13:09", "Transcript 004 part I: “Implicit functions and problems”"),
        ("T004b 00:02:31", "Transcript 004 part II: “Problems on composite and implicit functions”"),
        ("T003b 00:10:33", "Transcript 003 part II (implicit problems at its end)"),
        ("CW U1 P17 · ESA Jan-24 s3 1d", "Unit 1 class-work problem 17 · past-paper question"),
    ],
    "sources": [
        {"name": "Deck 004 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/004_Implicit_functions_Problems_on_Implicit_and_Composite_functions__8dea1ab57d4cc9f6.*", "use": "18 slides; content on 3–17"},
        {"name": "Transcript 004 part I (all 4 formats)",
         "path": HF + "AV_Summaries/004_Implicit_functions_and_problems__28ebf6864cd576d3.*", "use": "22.4 min lecture"},
        {"name": "Transcript 004 part II (all 4 formats)",
         "path": HF + "AV_Summaries/004_Problems_on_Composite_and_Implicit_functions__d1ea652fce3206d2.*", "use": "11.7 min problems"},
        {"name": "Deck 003, slides 26–27, and transcript 003 part II (end)",
         "path": HF + "Slides/003_Total_derivative_Chain_rule_problems__74d776a2caa69540.* · AV_Summaries/003_Problems_on_Total_derivatives_Chain_rule__4d669ee31cdd4a30.*",
         "use": "Slides 26–27: two implicit-function problems; slides 5–17: the definitions class 004 builds on"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "use": "Problems 6, 14–18 (with answers)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf", "use": "6 in-scope Q1 parts"},
        {"name": "Videos 004 (2 .mp4)", "path": HF + "AV_Summaries/004_*.mp4", "use": "Not opened: every gap was settled from the slides, transcripts and algebra"},
    ],
    "gaps": [
        "Slide 004·4 prints $dy/dx=-f_y/f_x$ for a level curve. It should be $-f_x/f_y$, as slide 004·5's branch diagram and slide 004·6 show.",
        "Slide 004·3's numerator is hard to read in the rendering. The correct $dy/dx$ for $x^3y+3xy^2=3$ is $-3y(x^2+y)/(x(x^2+6y))$.",
        "In the lecture (T004a 00:18:39) problem 3 of deck 004 is worked at the point (1, 0, 2), giving 0 for both derivatives. That point is not on $z^3+xy-y^2z=6$ (it gives 8). The slide's point (0, 1, 2) is on the surface and gives $\\partial y/\\partial x=1/4$, $\\partial z/\\partial x=-1/11$.",
        "The lecture says the differential is “minus $z_x$ by $z_y$” (T004a 00:07:05); that expression is the slope $dy/dx$, not the differential. The differential is $df=f_x\\,dx+f_y\\,dy$.",
        "Slides 004·4, 004·6 and 004·7 show screenshots from online 3-D graphers (calculus7.com, intmath.com). They are redrawn as Figures G1.1 and G2.2 rather than copied.",
        "The same class 004 content is also in the classes 003–004 pack; problems and answers are identical in both.",
        "Transcript recognition errors were corrected silently: “Gosteep” → cos θ, “composive” → composite, “dou dita” → ∂θ, “sec y” → $z_y$, “psi x” → sin x.",
    ],
    "asr_forbidden": ["Gosteep", "composive", "dou dita", "psi x"],
}
