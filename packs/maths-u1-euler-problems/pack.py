"""Pack metadata: UE26MA141A Unit 1, class 006 — Problems on Euler's theorem."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 1 · Partial Differentiation",
    "scope": "Class 006 · Problems on Euler's theorem",
    "title": "Problems on Euler's Theorem",
    "subtitle": "Complete study pack for class 006: testing homogeneity with the scaling test, verifying Euler's theorem, "
                "first- and second-order problems, and the extension when f(u) is homogeneous",
    "slug": "euler_problems",
    "header": "Engg. Mathematics I · Unit 1 · Class 006",
    "compiled_from": "Compiled from the PESU class 006 slide deck, its two AV-summary transcripts, the Unit 1 class-work sheet "
                     "and past ESA papers.",
    "how_to_use": "Topic 1 tests whether a function is homogeneous; topic 2 verifies Euler's theorem by differentiating; topics 3 "
                  "and 4 are the two kinds of exam problem: $u$ itself homogeneous, or some $f(u)$ homogeneous. The theory "
                  "(definitions, proofs, applications) is in the class 005 pack “Homogeneous Functions and Euler's Theorem”; "
                  "the statements are repeated here only so that each problem can be solved from this pack alone.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 "
                "and June 2024. Euler problems appear in six of them: Jul 2023 Q1.a (degree 5: $5u$, $20u$), May 2024 Q1.a and "
                "June 2024 Q1.b (the same $\\tan^{-1}$ extension question), Jan 2024 set 3 Q1.c ($17\\pi/2$), set 4 Q1.d ($9u$) and "
                "set 1 Q1.d (degree 0). Five are 6-mark questions. Testing homogeneity alone and verifying Euler's theorem by "
                "direct differentiation (topics 1–2) were not asked on their own; they appear only as the first step of a "
                "longer question.",
    "figure_note": "Colours follow the Okabe–Ito order: blue, vermilion, green, purple for the four deck functions in G1.1; "
                   "grey dashed lines are references. The deck has no graphs, so both figures are added for clarity and "
                   "drawn from the deck's own functions.",
    "symbols_remark": "Two clashes come from the slides themselves. On slide 006·4 lowercase $z$ is the third variable while "
                      "the lecture writes the auxiliary function as uppercase $Z=\\sin u$; on slide 006·3 $Z=\\cos u$ is the "
                      "auxiliary function. And $f$ is both the homogeneous function of $u$ ($f(u)=\\sin u$, $\\log u$, $e^u$) "
                      "and, on slide 006·3, the arbitrary function in $\\sqrt x\\,f(y/x)$.",
    "coverage_note": "Slides 006·1, 006·2 and 006·18 are title, session and closing slides with no content. Every content slide "
                     "(006·3–17) is worked in full.",
    "tag_legend": [
        ("S006·12", "Deck 006, slide 12 (rendered .pptx)"),
        ("T006a 00:05:18", "Transcript 006 part I (slides 3–4, 9.1 min)"),
        ("T006b 00:08:20", "Transcript 006 part II (slides 5–17, 12.9 min)"),
        ("CW U1 P20", "Unit 1 class-work problem 20"),
        ("ESA Jan-24 s3 1c", "Past paper: Jan 2024, set 3, question 1.c"),
    ],
    "sources": [
        {"name": "Deck 006 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/006_Problems_on_Euler_s_theorem__1dc65a95c3b42beb.*", "use": "18 slides; content on 3–17"},
        {"name": "Transcript 006 part I (all 4 formats)",
         "path": HF + "AV_Summaries/006_Problems_on_Euler_s_Theorem__6c4797f9ed9a5b61.*", "use": "9.1 min: slides 3–4"},
        {"name": "Transcript 006 part II (all 4 formats)",
         "path": HF + "AV_Summaries/006_Problems_on_Euler_s_theorem__0d726228252093d7.*", "use": "12.9 min: slides 5–17"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "use": "Problems 19–23 (with answers)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf", "use": "6 in-scope Q1 parts"},
        {"name": "Videos 006 (2 .mp4)", "path": HF + "AV_Summaries/006_*.mp4", "use": "Not opened: every slide is readable and every gap was settled by algebra"},
    ],
    "gaps": [
        "Slide 006·3 is titled “Verify Euler's theorem for $\\cos^{-1}(\\dots)$” but verifies it for $Z=\\cos u=\\frac{x+y}{\\sqrt x+\\sqrt y}$, not for $u$. "
        "For $u$ itself the result is $xu_x+yu_y=-\\tfrac12\\cot u$ (added for clarity, checked with sympy).",
        "Slide 006·3's middle factor is printed as $x^{2}\\,\\frac{1(1+y/x)}{1+\\sqrt y/\\sqrt x}$; the power is $x^{1/2}$, as the next step $\\sqrt x\\,f(y/x)$ shows.",
        "Slide 006·4 prints the denominator as $\\sqrt{x^8+y^8+z}$ in its solution line; it is $\\sqrt{x^8+y^8+z^8}$, as in the question.",
        "Slide 006·5's function is identically 1: $x^4+2x^2y^2+y^4=(x^2+y^2)^2$. The degree-0 answer is right, but the example is trivial; noted as a check.",
        "Slide 006·7's function simplifies to $\\frac{xy}{(x+y)^2}$ (added for clarity), which shows the degree 0 at a glance.",
        "The lecture reads slide 006·8 as $e^x-e^{-y}$ (T006b 00:04:40); the slide has $e^x-e^y$. Either way the function is not homogeneous.",
        "The lecture gives the degree on slide 006·16 as “plus 2 … plus one by two” (T006b 00:12:00); the degree is $\\tfrac12$.",
        "The lecture calls the second-order corollary $n(n-1)u$ an “extension of Euler's theorem” (T006b 00:05:55, 00:07:23). In this pack "
        "“corollary” means $n(n-1)u$ and “extension” means the $f(u)$ form $nf(u)/f'(u)$, as on slide 005·7.",
        "The lecture says the answer to slide 006·9 (i) “becomes minus half …” (T006b 00:06:59); the slide and the algebra give $-u=-\\frac{x-y}{x^2+y^2}$ with no half.",
        "Slides 006·12–13 ask only for the first-order sum; the second-order result $4u\\log u\\,(4\\log u+3)$ is added for clarity (sympy-checked).",
        "Transcript part I ends with “Next we will solve some problems approximation” (T006a 00:08:53); that belongs to a later class and is not included.",
        "The theory of class 005 is in its own pack; the statements used here are repeated without proofs.",
        "Transcript recognition errors were corrected silently: “Sign in us” / “sine in was” → $\\sin^{-1}$, “calc is” → cancelling, "
        "“tau” / “tanue” → $\\tan u$, “second square” → $\\sec^2$, “lambda power x power 3” → $\\lambda^6x^3y^3$, “doux” → $\\partial x$, “y'all” → $\\sqrt y$.",
    ],
    "asr_forbidden": ["Sign in us", "sine in was", "calc is", "tanue", "second square", "doux", "y'all"],
}
MODULES = []
