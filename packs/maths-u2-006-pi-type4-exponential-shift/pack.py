"""Pack metadata: UE26MA141A Unit 2, class 006 — Particular integral, Type 4 (X = e^{ax}V, exponential shift) and Type 5 (X = xV)."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 2 · Higher-Order Linear Differential Equations",
    "scope": "Class 006 · Particular integral Type 4 (eᵃˣV) and Type 5 (xV)",
    "title": "Particular Integral, Types 4 and 5: Exponential Shift and xV",
    "subtitle": "Complete study pack for class 006: the exponential shift $\\frac{1}{f(D)}(e^{ax}V)=e^{ax}\\frac{1}{f(D+a)}V$ with $V$ a "
                "sine, cosine or polynomial (it hands the work back to Type 2 or Type 3), the rule $\\frac{1}{f(D)}(xV)=\\big[\\frac{x}{f(D)}-"
                "\\frac{f'(D)}{(f(D))^2}\\big]V$, and every slide, class-work and ESA problem on them, solved in full and checked with sympy",
    "slug": "pi_type4",
    "header": "Engg. Mathematics I · Unit 2 · Class 006",
    "compiled_from": "Compiled from the PESU Unit 2 class 006 slide deck (15 slides), its AV-summary transcript (T006), the Type 4 part of the "
                     "“Type 3 and Type 4” problem lecture (T006b), the Unit 1 & 2 class-work sheet (problems 17–20) and eight past ESA papers.",
    "how_to_use": "Topic 1 is the Type 4 rule itself (Figure F1.1): pull $e^{ax}$ to the left, replace $D$ by $D+a$, then finish with the rule "
                  "that fits $V$ (Figure F1.2). Its examples have a sine or cosine $V$, including the failure case that the shift resolves on "
                  "its own. Topic 2 is $V$ a polynomial ($x^me^{ax}$), which ends in the Type 3 series or in plain integration, and the ESA "
                  "question (CW P18). Topic 3 is Type 5, $X=xV$, with the slide formula and, flagged as added for clarity, the shortcut "
                  "$x\\sin ax=\\text{Im}(xe^{iax})$. CF cases: class 002 pack; Type 1 ($e^{ax}$): class 003; Type 2 ($\\sin$, $\\cos$, "
                  "$\\sin^2x$, rationalising, failure): class 004; Type 3 (polynomials): class 005. They are not re-taught here, but every "
                  "worked example is complete.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024 (19 distinct Unit 2 questions, 24 occurrences; 7 distinct / 9 occurrences are PI by operator rules). "
                "Type 4 is asked once: Jan-24 set 3 2c, $(D^3-2D^2+D)y=x^2e^{-x}+\\sin^2x$ (6 marks), which is also CW P18 (solved as W2.3). "
                "Type 5 ($xV$) is never asked on its own; it is computed only in CW P19 and P20. Stars: the Type 4 rule and $x^me^{ax}$ ★★ "
                "(one ESA question plus CW P17, P18); Type 5 ★★ (CW only); the complex-exponential shortcut ★ (added for clarity).",
    "figure_note": "The deck has no graphs, so every figure is added for clarity. Colours follow the Okabe–Ito order: blue = the particular "
                   "integral, vermilion = a second curve (the envelope $\\pm e^{ax}$ or $\\pm x$, or general solutions), green = a third (the "
                   "shifted, exponential-free part); grey for guides. Every plotted PI was checked by substituting it back with sympy.",
    "symbols_remark": "Capital $X$ is the right-hand side; small $x$ the variable. $V=V(x)$ is the factor left after $e^{ax}$ (Type 4) or $x$ "
                      "(Type 5) is split off; the slides use $V$ and $V(x)$ for the same thing. The letter $a$ is the coefficient of $x$ in "
                      "the exponent (“$a$ is the coefficient of $x$ in the exponential function”), not a coefficient of $f(D)$. $f'(D)$ is the "
                      "derivative of the polynomial $f(D)$ with respect to $D$ (e.g. $f(D)=D^2-1$, $f'(D)=2D$). $m$ is both the AE unknown and "
                      "the degree in $x^m$; the two never appear in the same line.",
    "coverage_note": "Slides 1, 2 and 15 are title and closing slides; slide 3 is the class content and slide 4 the rules for Types (iv) and "
                     "(v). T006 (17 min) covers slides 4–9 and adds one example on no slide (W2.4, $(D^2-3D+2)y=xe^{3x}+\\sin2x$). Slides 10–14 "
                     "(the newer “Type 4: $X=e^{ax}V$” format with two problems) are explained in T006b from 00:09:55 to the end; the first "
                     "9 min 55 s of that file are Type 3 and are cited as T006a in the class 005 pack, so the same file has two tags in the "
                     "unit master (T006a there, T006b here) and only its Type 4 part is cited here. No slide or lecture works a Type 5 "
                     "example: its formula is stated (slide 006·4, T006 00:01:28) and the lecturer says “in this session, we are solving "
                     "problems only on type 4”; CW P19 and P20 supply the Type 5 problems. Bucket numbers are not contiguous (the decks say "
                     "SESSION 1–11; 007, 008, 010, 012 and 013 do not exist; 009 = session 7, 011 = sessions 8 and 9, 014 = 10, 015 = 11); "
                     "this deck is SESSION 6.",
    "tag_legend": [
        ("S006·5", "Unit 2 deck 006 (“Particular integral of Type 4”), slide 5 (rendered .pptx)"),
        ("T006 00:04:12", "Unit 2 AV-summary transcript “Particular integral of standard functions – Type 4” (17 min), segment start"),
        ("T006b 00:12:47", "Unit 2 AV-summary transcript “Particular integral – Type 3 and Type 4” (bucket 006, 15.5 min); only its Type 4 "
                           "part (00:09:55–00:15:25) is cited here. The class 005 pack cites the same file's Type 3 part as T006a."),
        ("CW U2 P18", "Unit 2 class-work problem 18"),
        ("ESA Jan-24 s3 2c", "Past paper: UE23MA141A Jan 2024 set 3, question 2.c"),
    ],
    "sources": [
        {"name": "Deck 006 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/006_Particular_integral_of_Type_4__45b50704e800c4c6.*",
         "use": "15 slides; content on 3–14 (every equation read from the rendered images)"},
        {"name": "Transcript T006 (all 4 formats)",
         "path": HF + "AV_Summaries/006_Particular_integral_of_standard_functions_-_Type_4__603379d034480436.*",
         "use": "17 min; slides 4–9 and one extra example"},
        {"name": "Transcript T006b (all 4 formats)",
         "path": HF + "AV_Summaries/006_Particular_integral_-Type_3_and_Type_4__fb358573adb09195.*",
         "use": "15.5 min; 00:09:55–00:15:25 Type 4 and slides 10–14 (00:00:00–00:09:55 is Type 3, used by the class 005 pack as T006a)"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf",
         "use": "Unit 2 problems 17–20 (all solved in full; all four printed answers are right, P20 is left unsimplified)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf",
         "use": "Jan-24 set 3 2c, via the shared ESA map"},
        {"name": "Video 006 (.mp4, both parts)", "path": HF + "AV_Summaries/006_*.mp4",
         "use": "Not opened: every slide equation is readable and no video trigger applies"},
    ],
    "gaps": [
        "Slide 006·9 (and the lecture, T006 00:07:16) integrates $x\\sin x$ where it should integrate $x\\cos x$: after the shift the PI is "
        "$e^x\\frac{1}{D^2}(x\\cos x)$, and $\\int x\\cos x\\,dx=x\\sin x+\\cos x$, but the slide writes $e^x\\frac1D\\int x\\sin x\\,dx$. Its boxed "
        "answer $e^x[-(x\\sin x+\\cos x)-\\cos x]=-e^x(x\\sin x+2\\cos x)$ is $e^x\\frac{1}{D^2}(x\\sin x)$, and substituting it back does not give "
        "$xe^x\\cos x$ (sympy). The correct PI is $e^x(2\\sin x-x\\cos x)$ (W2.2, checked by dsolve and by the Type 5 formula).",
        "Slide 006·5 writes the CF as $e^x(c_1\\cos\\sqrt3x+c_1\\cos\\sqrt3x)$; it is $e^x(c_1\\cos\\sqrt3x+c_2\\sin\\sqrt3x)$, as the lecture says "
        "(T006 00:03:06).",
        "Slide 006·3 reads “$f(D)y=x$ When $X=e^{ax}V$”; it means $f(D)y=X$ (capital $X$).",
        "No slide and no lecture works a Type 5 ($xV$) example; the rule is only stated (slide 006·4, T006 00:01:28). Its derivation and the "
        "complex-exponential shortcut ($x\\sin ax=\\text{Im}\\,xe^{iax}$) are added for clarity; CW P19 and P20 are solved both ways.",
        "T006's closing sentence (00:16:51) says “this is how we find the particular integral when the given function is $x$ into $V$”; the "
        "lecture was on $e^{ax}V$ (Type 4). T006b 00:11:57 says “$e^{ax}$ is taken as $e^x$” for $x^2e^{3x}$; it is $e^{3x}$ ($a=3$), as the "
        "next sentence uses. T006b 00:09:55 calls Type 4 “a combination of case four plus case three and case two”: after the shift the rest "
        "is done by Type 2 or Type 3 (00:10:53).",
        "The example $(D^2-3D+2)y=xe^{3x}+\\sin2x$ (T006 00:09:45–00:16:39) is on no slide; it is worked here from the lecture (W2.4, flagged "
        "transcript only), with the general solution the lecture leaves as “PI$_1$ + PI$_2$”.",
        "All other slide answers were recomputed with sympy (dsolve, checkodesol): 006·6 $\\frac{e^x\\cos x}{2}$, 006·12 "
        "$\\frac{e^{3x}}{11}(x^2-\\frac{12x}{11}+\\frac{50}{121})$ and 006·14 $-e^x\\sin x$ are right; the AE roots on slides 006·5 ($1\\pm\\sqrt3i$), "
        "006·7 and 006·13 ($1,1$) and 006·11 ($\\pm\\sqrt2i$) agree with their own CFs. Slides 006·5–6 and 006·7–9 stop at “Thus, $y=y_c+y_p$”: the "
        "general solutions are written out here.",
        "CW answers recomputed: P17 $\\frac{e^{2x}(7\\cos x+4\\sin x)}{130}$, P18, P19 $-\\frac{x\\sin3x}{10}-\\frac{3\\cos3x}{50}$ and P20 are all "
        "right. P20's printed form $\\frac{x}{104}(2\\cos2x-10\\sin2x)+\\frac{1}{2704}(-146\\sin2x-80\\cos2x)$ looks odd only because it is not "
        "reduced: it equals $\\frac{x(\\cos2x-5\\sin2x)}{52}-\\frac{73\\sin2x}{1352}-\\frac{5\\cos2x}{169}$ (sympy agrees with both forms).",
        "ESA Jan-24 set 3 2c is the same question as CW P18 and as slide 004·17 (its $\\sin^2x$ part). The class 004 pack found that slide "
        "004·17's boxed PI for the $\\sin^2x$ part drops a factor 2; the correct part, used here, is $\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$, "
        "which agrees with CW P18.",
        "Transcript recognition errors were corrected silently: “e par ax”, “e bar ax”, “e par ex”, “epo x” → $e^{ax}$ or $e^x$; “into b”, "
        "“of b”, “d plus a of b” → $V$; “replacing b by d plus a” → replacing $D$ by $D+a$; “f dash d” → $f'(D)$; “c even” → $c_1$; “psi root "
        "three x” → $\\sin\\sqrt3x$; “cos 6” → $\\cos x$; “minus 2t” → $-2D$; “particular interval”, “particular integrity” → particular integral; "
        "“3 into 39” → $3\\cdot3=9$; “5d”, “5 of d” → $\\varphi(D)$; “1 by 4 t” → $\\frac{1}{40}$; “sine to x” → $\\sin2x$; “thirst” → first; "
        "“Yc plus YPC” → $y_c+y_p$; repeated “PES University” (T006 00:11:49, the video's watermark) dropped.",
    ],
    "asr_forbidden": ["e par ax", "e par x", "e bar ax", "epo x", "psi root", "sine to x", "f dash d", "c even", "YPC", "integraph"],
}
MODULES = []
