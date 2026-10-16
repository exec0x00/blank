"""Pack metadata: UE26MA141A Unit 2, class 011 (VoP; the deck's SESSION 8) — Method of variation of parameters."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 2 · Higher-Order Linear Differential Equations",
    "scope": "Class 011 (VoP) · Method of variation of parameters",
    "title": "Method of Variation of Parameters",
    "subtitle": "Complete study pack for class 011, variation of parameters (the deck's SESSION 8): from the complementary function "
                "$y_c=c_1y_1+c_2y_2$ and the Wronskian $W$, the particular integral $y_p=uy_1+vy_2$ with $u=-\\int\\frac{y_2X}{W}dx$, "
                "$v=\\int\\frac{y_1X}{W}dx$; every slide and lecture example, all six class-work problems and all four distinct ESA questions "
                "(6–7 marks each) solved in full and checked with sympy",
    "slug": "variation_of_parameters",
    "header": "Engg. Mathematics I · Unit 2 · Class 011 (VoP)",
    "compiled_from": "Compiled from the PESU Unit 2 deck “Variation of Parameters method” (bucket 011, 18 slides, title slide “SESSION: 8”), its "
                     "two AV-summary transcripts (T011V, 14.9 min; T011Vb “Continued”, 24.5 min), the Unit 1 &amp; 2 class-work sheet "
                     "(problems 23–28) and eight past ESA papers.",
    "how_to_use": "Topic 1: the method (standard form, three steps, why it works; F1.1–F1.3). Topic 2: the deck's and lectures' examples, "
                  "including a lecture-only Cauchy equation. Topic 3: trigonometric right-hand sides (CW P23, P25, P26, P28; ESA Jan-24 s1 3a, "
                  "s2 3a). Topic 4: repeated roots with $e^{mx}/x^k$ (CW P24; ESA Jul-23 3c = Jun-24 3a, May-24 3c) and CW P27. CF cases: class "
                  "002 pack; Wronskian: class 001 (E4.3); operator method for $\\tan ax$: class 009 (C2.1); Cauchy CF: class 011 Legendre pack.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 and "
                "June 2024 (19 distinct Unit 2 questions, 24 occurrences). Variation of parameters is asked in 4 distinct questions, 5 "
                "occurrences, every time worth 6–7 marks and every time with the words “by the method of variation of parameters”: "
                "Jul-23 3c = Jun-24 3a ($y''+6y'+9y=\\frac{e^{-3x}}{x}$), May-24 3c ($y''-2y'+y=\\frac{e^x}{x}$), Jan-24 s1 3a "
                "($(D^2-2D+2)y=e^x\\tan x$, = CW P25) and Jan-24 s2 3a ($y''+2y'+2y=e^{-x}\\sec^3x$). It appears in 5 of the 8 papers, so "
                "the method, the Wronskian and the $u$, $v$ formulas are ★★★; the $\\frac{e^{mx}}{x}$ repeated-root pattern (2 distinct, 3 "
                "occurrences) and $e^{\\alpha x}\\times$trig ($\\tan$, $\\sec^3$) are ★★★; the slide-only right-hand sides ($xe^{-x}$, "
                "$\\frac{2}{1+e^x}$) and the CW-only ones ($\\sec ax$, $\\csc x$, $\\tan2x$) are ★★; the use on variable-coefficient "
                "equations (lecture only, never asked) is ★.",
    "figure_note": "The deck has no graphs, so every figure is added for clarity. Colours follow the Okabe–Ito order: blue = the particular "
                   "integral, vermilion (dashed) = the right-hand side $X$, green and purple = the varying parameters $u(x)$, $v(x)$; grey for "
                   "guides, asymptotes and sample general solutions. Every plotted function was checked by substituting it back with sympy.",
    "symbols_remark": "Capital $X$ is the right-hand side; small $x$ the variable. $u$ and $v$ (the deck's names; some books write $A$, $B$) are "
                      "the varying parameters, functions of $x$ that replace the constants $c_1$, $c_2$. $W$ is the Wronskian $W(y_1,y_2)$. In "
                      "the Cauchy example the variable is $z=\\log x$ and $D=\\frac{d}{dz}$. $\\log$ means $\\log_e$; the CW answers write "
                      "$\\log\\cos ax$, $\\log\\sin x$, $\\log x$ without modulus bars — strictly $\\log|\\cdot|$, and the answers hold on any "
                      "interval where the argument is positive.",
    "coverage_note": "The deck's own title slide says “SESSION: 8”; the bucket numbers it 011, and the bucket puts both this deck and the "
                     "Legendre deck (“SESSION: 9”) under 011 — hence the tags S011V and S011L (bucket numbers are not contiguous: the decks say "
                     "SESSION 1–11; 007, 008, 010, 012 and 013 do not exist; 009 = session 7, 011 = sessions 8 and 9, 014 = 10, 015 = 11). "
                     "Slides 1–3 and 18 are title, class-content and closing slides; slides 4–6 the method; 7–10 example $xe^{-x}$; 11–13 "
                     "$\\tan2x$; 14–17 $\\frac{2}{1+e^x}$. T011V covers slides 4–10; T011Vb covers 11–17 and then works a Cauchy equation "
                     "that is on no slide (W2.4, transcript only). CW P23–P28 and the four ESA questions are solved in Topics 3–4.",
    "tag_legend": [
        ("S011V·9", "Unit 2 deck 011 “Variation of Parameters method” (SESSION 8), slide 9 (rendered .pptx)"),
        ("T011V 00:03:26", "AV-summary transcript “Variation of Parameters method” (14.9 min, listed first), segment start"),
        ("T011Vb 00:16:53", "AV-summary transcript “Variation of Parameters method_Continued” (24.5 min, second), segment start"),
        ("CW U2 P25", "Unit 1 &amp; 2 class-work sheet, Unit 2 problem 25"),
        ("ESA Jul-23 3c", "Past paper: UE22MA141A July 2023, question 3.c (Jan-24 s1/s2 = UE23MA141A Jan 2024 sets 1/2)"),
    ],
    "sources": [
        {"name": "Deck 011 VoP (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/011_Variation_of_Parameters_method__56cafdd3e4db312b.*",
         "use": "18 slides; content on 4–17 (every equation read from the rendered images; .slides.md has titles only)"},
        {"name": "Transcript T011V (all 4 formats)",
         "path": HF + "AV_Summaries/011_Variation_of_Parameters_method__f1407a459331b120.*",
         "use": "14.9 min; slides 4–10 (method, example $xe^{-x}$)"},
        {"name": "Transcript T011Vb (all 4 formats)",
         "path": HF + "AV_Summaries/011_Variation_of_Parameters_method_Continued__97963caf81f64a9c.*",
         "use": "24.5 min; slides 11–17 ($\\tan2x$, $\\frac{2}{1+e^x}$) and the lecture-only Cauchy example"},
        {"name": "Unit 1 &amp; 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf",
         "use": "Problems 23–28 (“Solve by method of variation of parameters only”), page 5–6 rendered and every answer recomputed"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf",
         "use": "Jul-23 3c, Jun-24 3a, May-24 3c, Jan-24 s1 3a, Jan-24 s2 3a, via the shared ESA map"},
        {"name": "Video 011 VoP (.mp4, both parts)", "path": HF + "AV_Summaries/011_Variation_of_Parameters_method*.mp4",
         "use": "Not opened: every slide equation is readable and no video trigger applies"},
    ],
    "gaps": [
        "Slide 011V·13's boxed answer “Thus, $y_p=-\\frac14\\log(\\sec2x+\\tan2x)$” drops the factor $\\cos2x$. The line above it on the same "
        "slide gives $\\frac14[\\sin2x-\\log(\\sec2x+\\tan2x)]\\cos2x+\\sin2x\\cdot\\big(-\\frac{\\cos2x}{4}\\big)=-\\frac14\\cos2x\\log(\\sec2x+\\tan2x)$, "
        "which is CW P28's answer; substituting the boxed expression back does not give $\\tan2x$ (sympy). W2.2 and a trap.",
        "T011Vb 00:06:49 says “$v$ is equal to minus $\\cos2x$ by 2”; the slide (011V·13) and the working give $v=-\\frac{\\cos2x}{4}$. T011Vb "
        "00:15:56 reads $u$ as “minus $e$ power $x$ plus log …”; it is $-e^{-x}+\\log(1+e^{-x})$ as on slide 011V·16.",
        "Every other slide line was recomputed with sympy: 011V·8 ($W=-4e^{2x}$), 011V·9 ($u=-\\frac{e^{-4x}}{16}(x+\\frac14)$), 011V·10 "
        "($v=-\\frac{x^2}{8}$; PI $-\\frac{e^{-x}}{16}(x+\\frac14)-\\frac{x^2e^{-x}}{8}$), 011V·11 ($W=2$), 011V·12 ($u$), 011V·13 ($v$), 011V·14 "
        "($W=-2$), 011V·15–16 ($u=-e^{-x}+\\log(1+e^{-x})$) and 011V·17 ($v=-\\log(1+e^x)$; $y_p=e^x\\log(1+e^{-x})-e^{-x}\\log(1+e^x)-1$) are right. "
        "The $-\\frac{e^{-x}}{64}$ in 011V·10's PI is a multiple of $y_2=e^{-x}$ and can be absorbed into $c_2$; the Type 4 rule (class 006) gives "
        "$-\\frac{x^2e^{-x}}{8}-\\frac{xe^{-x}}{16}$, the same up to that term.",
        "Slides 011V·7–10 and 011V·11–13 ask only for the particular integral; 011V·14 asks for the general solution but ends with "
        "“Thus, $y=y_c+y_p$”. The full general solutions are written out here.",
        "CW P27 is printed “$2\\frac{d^2y}{dx^2}-\\frac{dy}{dx}-y+=25e^{-x}$” (a character is lost before “$=$”). Its printed answer "
        "$C_1e^{\\frac32x}+C_2e^{-x}-2e^{-x}-5xe^{-x}$ is the solution of $2y''-y'-3y=25e^{-x}$ (AE roots $\\frac32,-1$), not of "
        "$2y''-y'-y=25e^{-x}$ (roots $1,-\\frac12$; $y=C_1e^{x}+C_2e^{-\\frac x2}+\\frac{25}{2}e^{-x}$). Both are solved in W4.4 (sympy-checked); "
        "with $-3y$ the term $-2e^{-x}$ could be absorbed into $C_2e^{-x}$, so the printed answer keeps a removable term.",
        "CW P25's answer is printed “$-e^x\\,\\cos\\log(\\sec x+\\tan x)$”: the $x$ of $\\cos x$ is missing; it is $-e^x\\cos x\\log(\\sec x+\\tan x)$. "
        "CW P24's answer omits the term $v\\,y_2=-e^{-x}$ (absorbed into $C_1e^{-x}$). CW P23, P26, P28 answers are right as printed.",
        "ESA Jan-24 s2 3a: depending on whether $\\int\\frac{\\sin x}{\\cos^3x}dx$ is written $\\frac{\\sec^2x}{2}$ or $\\frac{\\tan^2x}{2}$, the PI comes "
        "out as $-\\frac{e^{-x}\\cos2x}{2\\cos x}$ or $\\frac12e^{-x}\\sin x\\tan x$; they differ by $-\\frac12e^{-x}\\cos x$, a CF term, so both are correct.",
        "The Cauchy equation $x^2y''-3xy'+3y=12x^4$ (T011Vb 00:16:53–00:23:47) is on no slide (transcript only). Its CF needs $z=\\log x$, from "
        "the class 011 Legendre pack; the variation-of-parameters part is done in $z$.",
        "T011V 00:02:06 says $y_1$, $y_2$ are linearly independent “if the linear combination $c_1y_1+c_2y_2$ is not equal to 0”; the precise "
        "statement is that $c_1y_1+c_2y_2\\equiv0$ only for $c_1=c_2=0$ (class 001). Corrected as a trap, flagged added for clarity.",
        "The deck states the method for constant $p$, $q$ and says it also works for variable coefficients if the CF is known; T011V 00:05:39 adds "
        "that it extends to $n$-th order equations. Only second order is taught or asked; the derivation of $u$, $v$ (E1.5) is added for clarity.",
        "Transcript recognition errors were corrected silently: “Ronskeian”, “Ronskean”, “Ronskiana”, “Rand scheme”, “RAN scale”, “Ron scale”, "
        "“Rans scan”, “Ran scale”, “Roll scan”, “ron skin”, “runs here”, “long scale”, “wrong scale”, “r scale” → Wronskian; “by 1”, “by 2”, "
        "“I1”, “byte” → $y_1$, $y_2$; “u and b”, “b is” → $u$ and $v$; “variation or parameters”, “my parameters” → variation of parameters; "
        "“LTE”, “LBE”, “differential equity” → LDE; “wtx”, “ts”, “DS”, “d is dz” → $dx$, $dz$; “psi 2x”, “sine to x”, “cos to x”, “stand 2x”, "
        "“car square 2x”, “second 2x” → $\\sin2x$, $\\cos2x$, $\\tan2x$, $\\cos^22x$, $\\sec2x$; “c po x”, “E po x”, “e bar” → $e^x$, $e$ power; "
        "“log p” → $\\log t$; “observed” → absorbed; “D by dz” in T011V 00:07:48 (self-corrected to $\\frac{d}{dx}$); “Said” → $z$; "
        "“integrality valid” → integral to evaluate.",
    ],
    "asr_forbidden": ["Ronskean", "Ronskeian", "Rand scheme", "Rans scan", "Ran scale", "Roll scan", "ron skin", "wtx", "stand 2x", "car square",
                      "psi 2x", "integrality"],
}
MODULES = []
