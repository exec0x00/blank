"""Pack metadata: UE26MA141A Unit 1, class 009 — Introduction to maxima and minima for a function of two variables."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 1 · Partial Differentiation",
    "scope": "Class 009 · Introduction to maxima and minima for a function of two variables",
    "title": "Maxima and Minima of a Function of Two Variables",
    "subtitle": "Complete study pack for class 009: local maxima, minima and saddle points, the necessary and sufficient "
                "conditions, the test with $r$, $s$, $t$ and $rt-s^2$, and the working rule",
    "slug": "maxima_minima_intro",
    "header": "Engg. Mathematics I · Unit 1 · Class 009",
    "compiled_from": "Compiled from the PESU class 009 slide deck and AV-summary transcript, the Unit 1 class-work sheet and past ESA papers.",
    "how_to_use": "Class 009 is the theory session: what a relative maximum, minimum and saddle point are, and the test that decides "
                  "between them. The ESA problems (stationary points of a cubic, applied problems) are worked in the class 010 pack, "
                  "and constrained problems by Lagrange's method in class 011. The worked examples here are short ones that show "
                  "each branch of the test, including the doubtful case $rt-s^2=0$.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024. The definitions are never asked by themselves, but the test of this session is the whole of three "
                "7-mark Q1 parts: Dec 2023 Q1.c and Jan 2024 set 1 Q1.a (the same function $x^3+3xy^2-15x^2-15y^2+72x$) and "
                "Jan 2024 set 2 Q1.a ($x^3-12x+y^3+3y^2-9y$). They are worked in the class 010 pack; the method is starred ★★★ here.",
    "figure_note": "Colours follow the Okabe–Ito order: blue = the surface or curve, vermilion = the stationary point and its "
                   "tangent plane, green = second trace. Figures G1.1–G1.3 redraw the deck's pictures of maxima, minima and a "
                   "saddle with the illustrative functions $e^{-x^2-y^2}$-type bumps, $x^2+y^2$ and $x^2-y^2$; the slides' "
                   "screenshots (including a photograph of a horse saddle) are not copied.",
    "symbols_remark": "The deck uses $r=f_{xx}$, $s=f_{xy}$, $t=f_{yy}$; some books write $A$, $B$, $C$ or $D=f_{xx}f_{yy}-f_{xy}^2$. "
                      "The $t$ here is a second partial derivative, not time; the $s$ is not arc length.",
    "coverage_note": "Slides 009·1, 009·2 and 009·10 are title, session and closing slides. The transcript covers all content slides (3–9).",
    "tag_legend": [
        ("S009·7", "Deck 009, slide 7 (rendered .pptx)"),
        ("T009 00:07:04", "AV-summary transcript 009 (“Extremas of functions”), segment start"),
        ("CW U1 P31", "Unit 1 class-work problem 31"),
        ("ESA Dec-23 1c", "Past paper: Dec 2023, question 1.c"),
    ],
    "sources": [
        {"name": "Deck 009 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/009_Introduction_to_Maxima_and_Minima_for_a_function_of_two_variables__4eceea203b0b8f6d.*", "use": "10 slides; content on 3–9"},
        {"name": "Transcript 009 (all 4 formats)", "path": HF + "AV_Summaries/009_Extremas_of_functions__5ebc2dd46f817380.*", "use": "13.2 min lecture"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "use": "Problem 31 (with answer)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf", "use": "3 questions use this test (worked in class 010)"},
        {"name": "Video 009 (.mp4)", "path": HF + "AV_Summaries/009_*.mp4", "use": "Not opened: the slides are readable and the board work is read out"},
    ],
    "gaps": [
        "Slide 009·7 calls “$f_x=0$, $f_y=0$ and $rt-s^2>0$” the necessary and sufficient condition. Precisely, $f_x=f_y=0$ is "
        "necessary (for a differentiable $f$) and $rt-s^2>0$ is sufficient; neither alone is both. The slide's “$A>0$” is a "
        "garbled “$>0$”. Corrected for clarity.",
        "The lecture says that in one variable a point with $\\frac{d^2y}{dx^2}=0$ is “called a saddle point” (T009 00:03:14). It is "
        "only an inconclusive case (it may be a maximum, minimum or point of inflection: $x^4$, $-x^4$, $x^3$). Corrected as a trap.",
        "The lecture first says that if $rt-s^2<0$ “you cannot conclude anything” (T009 00:08:23) and later that it is a saddle point "
        "(T009 00:11:06). The slides (009·7, 009·9) are right: $rt-s^2<0$ ⇒ saddle point; only $rt-s^2=0$ gives no conclusion.",
        "The lecture's working rule at T009 00:09:26 says “if this is zero, how do I decide … maximum or minimum”; it means $rt-s^2>0$. "
        "Read with the slides, the rule is: $>0$ and $r<0$ maximum, $>0$ and $r>0$ minimum, $<0$ saddle, $=0$ doubtful.",
        "The lecture says mixed partials are “always equal” (T009 00:07:22); they are equal when they are continuous (Clairaut, class 001).",
        "The slides give no worked example; the transcript ends with “we'll solve the problem”. Problems are in class 010; the short "
        "examples W3.1–W3.4 (including the doubtful case $x^4\\pm y^4$) are added for clarity, and W3.5 is CW P31.",
        "The deck's 3-D pictures are screenshots with no stated functions; Figures G1.1–G1.3 use illustrative functions with the same shapes.",
        "Transcript recognition errors were corrected silently: “Hesian” → Hessian, “R T minus a s square” → $rt-s^2$, “sin” → sign, "
        "“t square y by dx square” → $\\frac{d^2y}{dx^2}$, “f x” (for $f_{xx}$) → $f_{xx}$, “eight” → $(a,b)$, “sway” → sway.",
    ],
    "asr_forbidden": ["Hesian", "minus a s square", "t square y"],
}
MODULES = []
