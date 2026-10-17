"""Pack metadata: UE26MA141A Unit 2, class 014 — Applications of linear differential equations: LCR circuits."""
HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_02/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"

PACK = {
    "course": "UE26MA141A Engineering Mathematics – I",
    "unit": "Unit 2 · Higher-Order Linear Differential Equations",
    "scope": "Class 014 · Applications of LDEs: LCR circuits",
    "title": "Applications of Linear Differential Equations: LCR Circuits",
    "subtitle": "Complete study pack for class 014 (deck SESSION 10): the voltage drops $L\\frac{dI}{dt}$, $RI$, $\\frac QC$, Kirchhoff's "
                "voltage law, the charge equation $L\\frac{d^2Q}{dt^2}+R\\frac{dQ}{dt}+\\frac QC=E(t)$ with $I=\\frac{dQ}{dt}$, initial "
                "conditions, damping by $R^2$ against $\\frac{4L}{C}$, transient and steady state, and the first-order RL and RC "
                "circuits of the class-work sheet",
    "slug": "lcr_circuit",
    "header": "Engg. Mathematics I · Unit 2 · Class 014",
    "compiled_from": "Compiled from the PESU Unit 2 class 014 slide deck (17 slides), its AV-summary transcript (11.6 min), the Unit 1 & 2 "
                     "class-work sheet (problems 34–36) and eight past ESA papers.",
    "how_to_use": "Topic 1 builds the model: three voltage drops, Kirchhoff's voltage law, the charge equation (E1.3) and the current "
                  "equation obtained by differentiating it (E1.5). Topic 2 solves it: CF from the auxiliary equation (its roots decide "
                  "over-, critically or underdamped, table C2.1), PI from the forcing, then the constants from $Q(0)$ and $I(0)$ "
                  "(Figure F1.1); it works both slide examples. Topic 3 solves the two ESA questions (Jan-24 sets 3 and 4) and the "
                  "free discharge of CW P36. Topic 4 is the first-order RL and RC circuits of CW P34–P35. The CF rules are in the "
                  "class 002 pack and the PI rules for constants and $\\sin$, $\\cos$ in the class 003 and 004 packs; every worked "
                  "example here is nevertheless complete.",
    "pyq_note": "Eight past ESA papers were checked: UE22MA141A Dec 2023, Jul 2023 and May 2024, and UE23MA141A Jan 2024 sets 1–4 and "
                "June 2024 (19 distinct Unit 2 questions, 24 occurrences). LCR circuits: 2 distinct questions, 2 occurrences, both 6 marks "
                "and both in the Jan 2024 sets: set 3 Q3.b ($R=40\\,\\Omega$, $L=1$ H, $C=16\\times10^{-4}$ F, $E=100\\cos5t$) and set 4 "
                "Q3.b ($R=20\\,\\Omega$, $L=1$ H, $C=0.002$ F, $E=12\\sin10t$), each “find the charge at any time $t$” with no initial "
                "conditions (★★). CW P34–P36 add the RL and RC circuits and a free LCR discharge (★★). Never asked: the derivation of "
                "the model as a question on its own, the current equation, the damping classification and the resonance/impedance view (★).",
    "figure_note": "Slide 014·4 has the only diagram (the series circuit), redrawn in G1.1; every other figure is added for clarity. "
                   "Colours follow the Okabe–Ito order: blue = charge $Q(t)$ or the main response, vermilion = current $I(t)$ or a "
                   "comparison, green = a third case; grey dashed lines are references (steady state, envelopes, $CE$). Every plotted "
                   "curve is the sympy-verified solution of its worked example.",
    "symbols_remark": "The deck mixes $Q$, $I$ (slides 4–12) with $q$, $i$, $\\dot q$ (slides 13–16); they mean the same. $E$ is both the "
                      "source voltage $E(t)$ and, in CW P34–P35, the amplitude $E$ or $E_0$ of a sinusoid. $C$ (capacitance, farads) is "
                      "never an integration constant here: those are $c_1$, $c_2$ (or $C_1$, $C_2$ on slide 014·16, which are constants "
                      "of the current). $\\omega$ and $p$ are forcing frequencies; $\\varphi$ is a phase angle.",
    "coverage_note": "Slides 1–3 and 17 are title, class-content and closing slides; slides 4–12 are taught in the transcript (T014, "
                     "11.6 min, ending with slide 12); slides 13–16 (the $155\\sin377t$ example, typeset differently) have no lecture "
                     "and are cited by slide alone. Bucket numbers are not contiguous: the deck's title slide says SESSION 10, and the "
                     "bucket numbers 007, 008, 010, 012 and 013 do not exist (009 = session 7, 011 = sessions 8 and 9, 014 = 10, 015 = 11).",
    "tag_legend": [
        ("S014·8", "Unit 2 deck 014 (“Applications of DE – LCR circuit”), slide 8 (rendered .pptx)"),
        ("T014 00:04:29", "Unit 2 AV-summary transcript “Applications of higher-order linear differential equations – RLC Circuits” (11.6 min), segment start"),
        ("CW U2 P34", "Unit 2 class-work problem 34"),
        ("ESA Jan-24 s3 3b", "Past paper: UE23MA141A Jan 2024 set 3, question 3.b"),
    ],
    "sources": [
        {"name": "Deck 014 (.pptx rendered; .slides.md; .slides.txt)",
         "path": HF + "Slides/014_Applications_of_DE-LCR_circuit__1fb753421ad385f8.*",
         "use": "17 slides; content on 4–16 (every equation read from the rendered images)"},
        {"name": "Transcript T014 (all 4 formats)",
         "path": HF + "AV_Summaries/014_Applications_of_higher-order_linear_differential_equations_-_RLC_Circuits__2d0217a8ab77a9c8.*",
         "use": "11.6 min; slides 4–12"},
        {"name": "Unit 1 & 2 class-work sheet (UE24MA141A)", "path": HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf",
         "use": "Unit 2 problems 34, 35 and 36 (all solved; pages rendered to read the answers)"},
        {"name": "ESA papers, UE22MA141A and UE23MA141A (8 papers)", "path": HF2 + "Papers/ESA Papers/UE2[23]MA141A/*.pdf",
         "use": "Jan-24 set 3 Q3.b and set 4 Q3.b, via the shared ESA map"},
        {"name": "Video 014 (.mp4)",
         "path": HF + "AV_Summaries/014_Applications_of_higher-order_linear_differential_equations_-_RLC_Circuits__2d0217a8ab77a9c8.mp4",
         "use": "Not opened: every slide equation is readable and no video trigger applies"},
    ],
    "gaps": [
        "Every slide answer in this class is right: slides 014·8–12 ($Q=e^{-2t}(-\\cos t-2\\sin t)+1$, $I=5e^{-2t}\\sin t$) and "
        "slides 014·13–16 ($C_1=-0.0423597$, $C_2=0.526168$, $A=-0.00128331$, $B=-0.00366164$) were recomputed with sympy dsolve "
        "and checkodesol.",
        "Slide 014·16 finds $C_1$, $C_2$ “using initial conditions” but states only $i(0)=0$; the second condition is $i'(0)=0$, which "
        "follows from the equation at $t=0$: $\\ddot q(0)=1550\\sin0-1000\\dot q(0)-10000q(0)=0$ (added for clarity, W2.2).",
        "Slide 014·11 writes $e^{-2.0}$, meaning $e^{-2\\cdot0}=1$. Slide 014·5 spells Kirchhoff as “Kirchoff”. Slide 014·12's "
        "equation (3) already has $c_1=-1$ substituted.",
        "CW P34 prints its answer as $\\frac{E}{\\sqrt{R^2+L^2\\omega^2}}[\\sin(\\omega t-\\varphi)+e^{-Ri/L}\\sin\\varphi\\varphi]$; the exponent is "
        "$-\\frac{R}{L}t$ and the factor is $\\sin\\varphi$ (as in the question). “If $i=0$” means $i=0$ at $t=0$. The stated form is correct (sympy).",
        "CW P35's printed answer is garbled ($I+p^2R^2C^2$, $e^{-1/RC}$). Recomputed: $i=\\frac{CpE_0}{1+p^2R^2C^2}\\big[RCp\\cos pt-\\sin pt-pRC\\,e^{-t/(RC)}\\big]$ (sympy).",
        "CW P36 prints $q=e^{-500t}(0.002\\cos1323t+0.0008\\sin1323t)$. Exactly, $\\omega_d=500\\sqrt7=1322.88$ and the sine coefficient is "
        "$\\frac{0.002}{\\sqrt7}=0.000756$; the printed 0.0008 is that value rounded to one figure (5.8 % high), not an independent slip.",
        "The damping classification by $R^2$ against $\\frac{4L}{C}$, the current equation $LI''+RI'+\\frac IC=E'(t)$, the steady-state "
        "amplitude through the impedance, and the zero-initial-condition versions of both ESA questions are added for clarity.",
        "Both ESA questions give no initial conditions, so the expected answer is the general solution with two arbitrary constants; "
        "W3.2 and W3.4 also give the charge for $Q(0)=I(0)=0$ (added for clarity). Their CF roots ($-20\\pm15i$, $-10\\pm20i$) agree "
        "with the class 002 pack.",
        "The lecture says the capacitance is “0.15” and $E=10$ “ohms” (T014 00:04:29, 00:05:17); the slide gives $C=0.1$ farad and "
        "$E=10$ volts, and the working uses those values.",
        "Transcript recognition errors were corrected silently: “LCI circuit”, “L Cr”, “NCR side” → LCR circuit; “K chop's”, “KCO's” → "
        "Kirchhoff's; “poses” → ohms; “fat” → farads; “holes” → coulombs; “IFP”, “IFD”, “If P” → $I(t)$; “ESP”, “EFT”, “CFP” → $E(t)$; "
        "“q of p”, “Q of D” → $Q(t)$; “DIB” → $\\frac{dI}{dt}$; “voltage log” → voltage drop; “electromotte” → electromotive; "
        "“phi by d square” → $\\frac{5}{D^2+4D+5}$; “2 degrees” → 2 henry; “electric circulates” → electric circuits.",
        "Not in this class: spring–mass (SHM) applications are in the class 015 pack.",
    ],
    "asr_forbidden": ["LCI", "K chop", "KCO", "electromotte", "NCR side", "voltage log", "Q of D", "phi by d"],
}
MODULES = []
