"""Pack metadata: UE26MA141A Unit 1, class 011 — Lagrange's method of undetermined multipliers."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 1 · Partial Differentiation",
    "scope": "Class 011 · Lagrange's method of undetermined multipliers",
    "title": "Lagrange's Method of Undetermined Multipliers",
    "subtitle": "Complete study pack for class 011: extrema subject to a constraint, the auxiliary function $F=f+\\lambda\\phi$, "
                "the working procedure, its advantages and limits, and every geometric and applied problem asked in the ESA",
    "slug": "lagrange_multipliers",
    "header": "Engg. Mathematics I · Unit 1 · Class 011",
    "compiled_from": "Compiled from the PESU class 011 slide deck, its two AV-summary transcripts, the Unit 1 class-work sheet, an "
                     "extra question list and past ESA papers.",
    "how_to_use": "Topic 1 is the method: learn the procedure (Figure F1.1) and how to pick $f$ and $\\phi$ (Figure F1.2). Topic 2 "
                  "works the geometric problems (inscribed solids, nearest and farthest points), topic 3 the applied ones (boxes, "
                  "splitting a number, temperature). Lagrange's method was asked in five of the eight past papers, so topics 2–3 "
                  "carry the most marks in Unit 1 after Taylor's series. Free maxima and minima (the $rt-s^2$ test) are classes 009–010.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024. Lagrange's method is asked in five of them, always as a 7-mark Q1 part, with four distinct problems: "
                "Jul 2023 Q1.c (maximum and minimum distances from the origin to $5x^2+6xy+5y^2-8=0$), May 2024 Q1.c (the rectangular "
                "solid of maximum volume in a sphere is a cube; also slides 011·5–6), Jan 2024 sets 3 and 4 Q1.a (largest "
                "parallelepiped in an ellipsoid) and June 2024 Q1.d (highest temperature $400xyz^2$ on the unit sphere; also "
                "class 010 by elimination). Three of the four also appear in the extra question list (Q57, Q59, Q61). Dec 2023 and "
                "Jan 2024 sets 1–2 ask free extrema (class 010) instead.",
    "figure_note": "Colours follow the Okabe–Ito order: blue = the constraint curve, vermilion and green = level curves of the "
                   "function being optimised, grey = guides. Figure G1.1 is added for clarity (why the method works). Figure G2.1 "
                   "redraws the deck's “soap bubble” picture of slide 011·7 as a cross-section; Figure G2.2 draws the ESA curve "
                   "$5x^2+6xy+5y^2=8$ with its nearest and farthest points.",
    "symbols_remark": "The slides write the constraint as $\\phi(x,y,z)=0$ (also printed as $\\varnothing$) and the auxiliary function as "
                      "$F=f+\\lambda\\phi$; the lecture also calls it the Lagrangian. $\\lambda$ is the Lagrange multiplier; its value is "
                      "found but never needed in the answer. In the sphere problems $r$ is the radius of the sphere, not the second "
                      "partial $f_{xx}$ of class 009.",
    "coverage_note": "Slides 011·1, 011·2 and 011·15 are title, session and closing slides. Lecture T011a (theory, 14.8 min) works slides "
                     "3–9; lecture T011b (problems, 10.2 min) works slides 10–14. The deck title says “for two variables”, but every "
                     "problem uses three variables and one constraint.",
    "tag_legend": [
        ("S011·5", "Deck 011, slide 5 (rendered .pptx)"),
        ("T011a 00:01:08", "Transcript “Lagrange's method of undetermined coefficient” (theory lecture), segment start"),
        ("T011b 00:05:03", "Transcript “Problems on Lagrange's method of undetermined multipliers”"),
        ("CW U1 P33", "Unit 1 class-work problem 33"),
        ("Extra Q57", "Extra question list “lagrange-ques”, question 57"),
        ("ESA Jul-23 1c", "Past paper: Jul 2023, question 1.c"),
    ],
    "sources": [
        {"name": "Deck 011 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/011_Lagrange_s_method_of_un_determined_multipliers_for_two_variables__238e903a20cec7ad.*", "use": "15 slides; content on 3–14"},
        {"name": "Transcript T011a (all 4 formats)", "path": HF + "AV_Summaries/011_Lagrange_s_method_of_undetermined_coefficient__6812c905c391978e.*", "use": "14.8 min: method, cube in a sphere, hyperbolic cylinder"},
        {"name": "Transcript T011b (all 4 formats)", "path": HF + "AV_Summaries/011_Problems_on_Lagrange_s_method_of_undetermined_multipliers__94e58d0103d5b799.*", "use": "10.2 min: open box, dividing 24, cube in a sphere"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "use": "Problems 33–36 (with answers)"},
        {"name": "Extra questions “lagrange-ques” (third-party list)", "path": HF2 + "Extra/Extra Questions/lagrange-ques__1smrsCddi3.pdf", "use": "Confirms ESA problems (Q57, Q59, Q61); no solutions used"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf", "use": "5 in-scope Q1 parts (4 distinct problems)"},
        {"name": "Videos 011 (.mp4)", "path": HF + "AV_Summaries/011_*.mp4", "use": "Not opened: every slide is readable and every result was recomputed"},
    ],
    "gaps": [
        "The deck is titled “… for two variables”, but the method, the slides' problems and all four ESA problems use three "
        "variables $x,y,z$ and one constraint; the two-variable case ($F_x=F_y=0$, $\\phi=0$) is the same with $z$ dropped "
        "(Jul 2023 Q1.c, W2.4).",
        "Slide 011·6 prints the third line as $8xzy+2y^2\\lambda=0$; multiplying $8xy+2z\\lambda=0$ by $z$ gives $8xyz+2z^2\\lambda=0$. "
        "The conclusion $2x^2\\lambda=2y^2\\lambda=2z^2\\lambda$, so $x=y=z$, is right.",
        "Slide 011·9 says “from (3), we get $z=0$, $\\lambda=1$”; equation (3), $2z(1-\\lambda)=0$, gives $z=0$ or $\\lambda=1$, and "
        "$\\lambda=-1$ from (1) forces $z=0$. The lecture likewise says “$\\lambda$ plus or minus 1” (T011a 00:13:10).",
        "The theory lecture misreads the derivative at T011a 00:07:12 (“$yz$ plus $\\lambda$ into $2z$”); it is $F_x=yz+2\\lambda x$. "
        "It also says “$x$ is equal to plus or minus 1” (T011a 00:08:28) for $x=\\pm y$, and treats the volume as $8xyz$ and then $xyz$ "
        "(both give $x=y=z$).",
        "Slide 011·4 lists, as a disadvantage, that the method cannot decide the nature of a stationary point. Added for clarity: "
        "in examination problems the nature follows from the problem (a largest box, a nearest point), or by comparing the values "
        "of $f$ at the stationary points (W2.4 compares 1 and 2).",
        "CW problem 33's condition is garbled in the text layer; the rendered page reads $\\frac1x+\\frac1y+\\frac1z=1$. Its answer "
        "$(a+b+c)^3$ at $(\\frac ta,\\frac tb,\\frac tc)$, $t=a+b+c$, is right (sympy, and a numerical check with $a,b,c=1,2,3$).",
        "No ESA answer key was used; every answer here is recomputed with sympy (May 2024 and Jul 2023 answer PDFs exist in the "
        "bucket but were not needed).",
        "The theory lecture describes “a point in space” as “$x^2+y^2+z^2$ … a sphere can be taken as a point” (T011a 00:09:35). "
        "Precisely: the squared distance from the origin is $x^2+y^2+z^2$, and minimising it is the same as minimising the distance "
        "(added for clarity).",
        "Transcript recognition errors were corrected silently: “Lagrangius” / “Lagrangian's” / “Slagrange's” / “Lagrangus” / "
        "“grandiose” / “grandest” → Lagrange's (auxiliary function), “axillary” → auxiliary, “equity” / “equipment” → equations, "
        "“a Q” / “a q” → a cube, “two eight x” → $8xyz$, “Q” → cube, “constant” (for constraint) → constraint, “small problems” → solve problems.",
    ],
    "asr_forbidden": ["Lagrangius", "Slagrange", "Lagrangus", "grandiose", "grandest", "axillary", "equipment", "two eight x"],
}
MODULES = []
