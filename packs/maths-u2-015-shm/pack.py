"""Pack metadata: UE26MA141A Unit 2, class 015 — Applications of linear differential equations: simple harmonic oscillation."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 2 · Higher-Order Linear Differential Equations",
    "scope": "Class 015 · Applications of LDEs: simple harmonic oscillation",
    "title": "Applications of Linear Differential Equations: Simple Harmonic Oscillation",
    "subtitle": "Complete study pack for class 015 (deck SESSION 11): the spring–mass model from Hooke's law and Newton's second law, "
                "$\\frac{d^2x}{dt^2}+\\omega^2x=0$ with $\\omega=\\sqrt{k/m}$, its solution $x=c_1\\cos\\omega t+c_2\\sin\\omega t=A\\cos(\\omega t+\\varphi)$, "
                "amplitude, period, frequency and maximum velocity, the sign and unit conventions of spring problems, and the "
                "damped oscillator $\\ddot x+2\\lambda n\\dot x+n^2x=0$",
    "slug": "shm",
    "header": "Engg. Mathematics I · Unit 2 · Class 015",
    "compiled_from": "Compiled from the PESU Unit 2 class 015 slide deck (23 slides), its AV-summary transcript (16.3 min), the Unit 1 & 2 "
                     "class-work sheet (problem 37) and eight past ESA papers.",
    "how_to_use": "Topic 1 builds the model: the forces on a hanging mass, the cancellation $mg=ks$ at equilibrium, the equation "
                  "$\\ddot x+\\frac kmx=0$ (E1.3) and the formulas for amplitude, period and frequency that the lecturer asks you to "
                  "remember. Topic 2 solves spring problems: find $m$ and $k$ from the data, write $x(t)$, fix $c_1$, $c_2$ from the "
                  "initial position and velocity with the sign convention (Figure F2.2), then report $A$, $T$, $f$, $v_{\\max}$. It works "
                  "both slide examples and CW P37. Topic 3 adds a resistive force: the damped oscillator of slides 015·15–16. The CF "
                  "rules (complex roots) are in the class 002 pack and the LCR circuit, the electrical twin of this model, is in the "
                  "class 014 pack (table C1.2).",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 and "
                "June 2024 (19 distinct Unit 2 questions, 24 occurrences). Simple harmonic oscillation (the spring–mass problem) was "
                "never asked in any of them: 0 of 8 papers. It is in the syllabus (“Application problems – … Oscillations of a "
                "spring”) and the class-work sheet has one problem (CW P37), so the method is ★★ and the formulas $\\omega=\\sqrt{k/m}$, "
                "$T=2\\pi/\\omega$, $f=1/T$ are ★★ because the lecturer stresses them (“you should remember all these formulae”, "
                "T015 00:07:58). The derivation and the damped oscillator are ★. The applications question the papers do ask is the "
                "LCR circuit (class 014, Jan 2024 sets 3 and 4).",
    "figure_note": "Slide 015·5 has the only diagram (the spring in three positions), redrawn in G1.1; every other figure is added for "
                   "clarity. Colours follow the Okabe–Ito order: blue = displacement $x(t)$, vermilion = velocity or a second case, "
                   "green = a third case; grey dashed lines are references (amplitude $\\pm A$, envelopes, the period). Every plotted "
                   "curve is the sympy-verified solution of its worked example. Positive $x$ is downward, as in the deck.",
    "symbols_remark": "The deck uses $x$, $\\frac{dx}{dt}$, $\\frac{d^2x}{dt^2}$ (slides 5–14) and $\\dot x$, $\\ddot x$ (slides 15–22); they mean "
                      "the same. $s$ is the static stretch at equilibrium, $x$ the displacement from equilibrium. $\\omega$ is the angular "
                      "frequency $\\sqrt{k/m}$ in the undamped case; on slide 015·16 the same letter is the damped frequency "
                      "$n\\sqrt{1-\\lambda^2}$, and slide 015·15 calls the undamped one $n$. $A$ is the amplitude on slides 8–9 and 22 but "
                      "an integration constant on slide 015·16. $c_1$, $c_2$ and $C_1$, $C_2$ are both arbitrary constants. $f$ is the "
                      "frequency, not a function.",
    "coverage_note": "Slides 1–3 and 23 are title, session, class-content and closing slides. The transcript (T015, 16.3 min) teaches "
                     "slides 4–14 and ends with the 12 lb example; slides 15–22 (the damped oscillator and the 8 lb example, typeset "
                     "differently) have no lecture and are cited by slide alone. Bucket numbers are not contiguous: the deck's title "
                     "slide says SESSION 11, and the bucket numbers 007, 008, 010, 012 and 013 do not exist (009 = session 7, 011 = "
                     "sessions 8 and 9, 014 = 10, 015 = 11).",
    "tag_legend": [
        ("S015·11", "Unit 2 deck 015 (“Applications of DE – SHM”), slide 11 (rendered .pptx)"),
        ("T015 00:11:48", "Unit 2 AV-summary transcript “Application problems on linear differential equations – Simple harmonic oscillation” (16.3 min), segment start"),
        ("CW U2 P37", "Unit 2 class-work problem 37"),
    ],
    "sources": [
        {"name": "Deck 015 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/015_Applications_of_DE-_SHM__07c768aa6b33cecd.*",
         "use": "23 slides; content on 4–22 (every equation read from the rendered images)"},
        {"name": "Transcript T015 (all 4 formats)",
         "path": HF + "AV_Summaries/015_Application_problems_on_Linear_differential_equations_-_Simple_harmonic_oscillation__9f24b70546186809.*",
         "use": "16.3 min; slides 4–14"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf",
         "use": "Unit 2 problem 37 (no printed answer; solved here)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf",
         "use": "Checked: no SHM question in any paper (shared ESA map)"},
        {"name": "Video 015 (.mp4)",
         "path": HF + "AV_Summaries/015_Application_problems_on_Linear_differential_equations_-_Simple_harmonic_oscillation__9f24b70546186809.mp4",
         "use": "Not opened: every slide equation is readable and no video trigger applies"},
    ],
    "gaps": [
        "Every slide answer in this class is right. Slides 015·10–14 ($m=\\frac38$, $k=24$, $\\omega=8$, $x=\\frac13\\cos8t-\\frac14\\sin8t$, "
        "$A=\\frac5{12}$ ft, $T=\\frac\\pi4$ s), slides 015·15–16 (damped, $x=\\frac{x_0}{n\\sqrt{1-\\lambda^2}}e^{-\\lambda nt}\\sin(n\\sqrt{1-\\lambda^2}\\,t)$) "
        "and slides 015·17–22 ($x=-\\frac5{12}\\cos4\\sqrt3t$, $T=\\frac\\pi{2\\sqrt3}$, $f=\\frac{2\\sqrt3}\\pi$, $v_{\\max}=\\frac5{\\sqrt3}$) were "
        "recomputed with sympy dsolve and the initial conditions.",
        "Slide 015·11 gives $g=32$ “ft/sec”; the unit of an acceleration is ft/s² (slide 015·18 has it right).",
        "Slides 015·4 and the lecture (T015 00:00:32) say a mass attached to a vertical “string”; it is a spring.",
        "Slide 015·6 spells Hooke's law “Hook's Law”, and so does the lecture.",
        "The lecture reads the amplitude as “square root of $c_1$ square by $c_2$ square” (T015 00:07:22); slide 015·8 has "
        "$A=\\sqrt{c_1^2+c_2^2}$, a sum.",
        "The lecture says “$C_2$ is equal to minus 4” (T015 00:14:59) before writing $x=\\frac13\\cos8t-\\frac14\\sin8t$; $c_2=-\\frac14$, as on slide 015·14.",
        "The lecture says “$Mg$ is equal to $Kx$ at equilibrium position” (T015 00:02:46); it is $mg=ks$ (the static stretch $s$, "
        "not the displacement $x$), as on slides 015·5 and 015·7. It also calls $ks$ “the displacement of the spring”; $s$ is the "
        "displacement and $ks$ the spring force.",
        "The lecture's natural-frequency sentence is cut off (“so 1 by 2”, T015 00:08:15); slide 015·9 gives $\\frac1T=\\frac\\omega{2\\pi}$, "
        "which with $\\omega=\\sqrt{k/m}$ is $\\frac1{2\\pi}\\sqrt{\\frac km}$ (added for clarity).",
        "Slides 015·15–22 have no lecture. The damped oscillator (slides 15–16) is solved on the slides only for $0<\\lambda<1$; the "
        "critical ($\\lambda=1$) and overdamped ($\\lambda>1$) cases in topic 3 are added for clarity.",
        "Slide 015·21 writes the particular solution as $\\frac5{12}\\sin(4\\sqrt3t-\\frac\\pi2)$; this equals $-\\frac5{12}\\cos4\\sqrt3t$ (checked).",
        "The unit sign convention (downward positive, so “pulled down” gives $x(0)>0$ and an upward velocity gives $\\dot x(0)<0$) is "
        "stated in the lecture (T015 00:14:07–00:14:42) and on slide 015·20, not on slides 10–14.",
        "CW P37 (10 kg body, 20 kg weight stretches the spring 10 cm, pulled 20 cm down and released) has no printed answer on the "
        "sheet. Solved here with $g=9.8$ m/s² and kilogram-weight forces: $k=1960$ N/m, $\\omega=14$ rad/s, $x=0.2\\cos14t$ m, "
        "$v_{\\max}=2.8$ m/s, $T=\\frac\\pi7\\approx0.449$ s. The sheet says “stretch the spring to 10 cm”, read as “by 10 cm”.",
        "No SHM question appears in the eight ESA papers checked.",
        "Transcript recognition errors were corrected silently: “XFT”/“XFP” → $x(t)$, “Hook's law” → Hooke's law, “case” → $ks$, "
        "“regulatory motion” → oscillatory motion, “seconds law” → second law, “Consider see a big question” → consider an example, "
        "“feed” → feet, “Kn” → $k$ and $m$, “Pass of the object” → mass of the object, “C even cos A T” and “sine A T” → "
        "$c_1\\cos8t$, $\\sin8t$, “plus r minus i omega” → $\\pm i\\omega$, “one by 3 cos C8” → $\\frac13\\cos8t$.",
    ],
    "asr_forbidden": ["XFT", "XFP", "regulatory motion", "C even cos", "Consider see a big", "Pass of the object", "cos C8"],
}
MODULES = []
