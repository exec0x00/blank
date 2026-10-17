"""Unit 2 class 002: Nernst equation and its derivation."""
ADD = "added for clarity"
TONLY = "transcript only"
NOTCUR = "not on current slides"

MN = r"\mathrm{M^{n+}}"

TOPICS = [
    {"id": "T1", "title": "Free energy and electrode potential",
     "overview": r"The maximum useful work a reversible electrode or cell can deliver equals the decrease in Gibbs free energy, "
                 r"$-\Delta G=W_{max}$. For an electrochemical system this work is the charge passed ($nF$) times the energy per "
                 r"unit charge (the potential $E$), so $\Delta G=-nFE$ and, under standard conditions, $\Delta G^\circ=-nFE^\circ$. "
                 r"A positive $E$ therefore means a negative $\Delta G$: a spontaneous reaction. These two relations are the "
                 r"starting point of the derivation."},
    {"id": "T2", "title": "Derivation of the Nernst equation for a single electrode",
     "overview": r"The Nernst equation is the quantitative relationship between the electrode potential and the concentration of "
                 r"the species with which the electrode is reversible. Starting from $\Delta G=\Delta G^\circ+RT\ln Q$ for the "
                 r"reduction $\mathrm{M^{n+}}+ne^-\rightleftharpoons\mathrm{M}$, substitute $\Delta G=-nFE$, $\Delta G^\circ=-nFE^\circ$ and "
                 r"$Q=[\mathrm{M}]/[\mathrm{M^{n+}}]$, divide by $-nF$, put $[\mathrm{M}]=1$, convert to $\log_{10}$ and evaluate "
                 r"at 298 K. The result is $E=E^\circ+\frac{0.0591}{n}\log[\mathrm{M^{n+}}]$. This derivation is a 5–6-mark ESA question."},
    {"id": "T3", "title": "Using the single-electrode equation: concentration and temperature",
     "overview": r"At 298 K the electrode potential changes by $0.0591/n$ V for every tenfold change in $[\mathrm{M^{n+}}]$: "
                 r"diluting the ions makes a reduction potential more negative. A plot of $E$ against $\log[\mathrm{M^{n+}}]$ is a "
                 r"straight line of slope $0.0591/n$ through $E^\circ$ at 1 M. The factor $2.303RT/F$ is proportional to $T$, so "
                 r"at another temperature it must be recomputed (0.0611 V at 308 K)."},
    {"id": "T4", "title": "Nernst equation for a cell",
     "overview": r"The same steps applied to a whole cell reaction $a\mathrm{A}+b\mathrm{B}\rightleftharpoons c\mathrm{C}+d\mathrm{D}$ change "
                 r"only $Q$, which becomes products over reactants, each raised to its stoichiometric coefficient. At 298 K, "
                 r"$E_{cell}=E^\circ_{cell}-\frac{0.0591}{n}\log Q$, where $n$ is the number of electrons in the balanced cell "
                 r"reaction. Pure solids are left out of $Q$. This form underlies every cell numerical in the UE23/UE24 papers."},
]

DEFS = [
    {"topic": "T2", "term": "Nernst equation", "text": r"A quantitative relationship between electrode potential and concentration "
     r"of species with which the electrode is reversible.", "srcs": ["S002·3", "T001 00:19:17"]},
    {"topic": "T1", "term": "Maximum work", "text": r"The maximum work that can be obtained from a system equals the decrease in "
     r"free energy: $-\Delta G=W_{max}$. For an electrochemical system, $W_{max}$ = total charge available × energy available "
     r"per unit charge.", "srcs": ["S002·3", "T001 00:19:38", "T001 00:20:11"]},
    {"topic": "T1", "term": "Faraday constant, F", "text": r"The charge carried by one mole of electrons, 96500 C mol<sup>−1</sup> on "
     r"the slides.", "srcs": ["S002·3", "T001 00:20:21"]},
    {"topic": "T2", "term": "Reaction quotient, Q", "text": r"The concentration of the products divided by the concentration of the "
     r"reactants, each raised to its stoichiometric coefficient, at any instant (not only at equilibrium).",
     "srcs": ["S002·4", "T001 00:22:05", "T001 00:24:15"]},
    {"topic": "T2", "term": "Standard electrode potential, E°", "text": r"The electrode potential when all species are at unit "
     r"concentration (1 M), gases at 1 atm, at 298 K.", "srcs": ["S002·4", "T001 00:19:00"]},
    {"topic": "T4", "term": "Standard emf, E°<sub>cell</sub>", "text": r"The emf of the cell when all concentrations are 1 M, all "
     r"partial pressures 1 atm and the temperature 298 K.", "srcs": ["S002·5", "PDF p.10"]},
]

STATEMENTS = [
    {"topic": "T1", "text": r"The maximum work that can be obtained is $-\Delta G=W_{max}$. For an electrochemical system, maximum work "
     r"done is total charge available × energy available per unit charge. Therefore $W_{max}=nFE$; $\Delta G=-nFE$. Under standard "
     r"conditions, $\Delta G^\circ=-nFE^\circ$.", "srcs": ["S002·3"]},
    {"topic": "T2", "text": r"A thermodynamic equation which relates reaction quotient and decrease in free energy is given by "
     r"$\Delta G=\Delta G^\circ+RT\ln Q$, where $Q$ is the reaction quotient. The reaction quotient for the reaction is "
     r"$Q=[\mathrm{M}]/[\mathrm{M^{n+}}]$.", "srcs": ["S002·4"]},
    {"topic": "T4", "text": r"Nernst equation may also be used to calculate emf of electrochemical cells. For the cell reaction "
     r"$a\mathrm{A}+b\mathrm{B}\rightleftharpoons c\mathrm{C}+d\mathrm{D}$, the Nernst equation is "
     r"$E=E^\circ-\frac{0.0591}{n}\log\frac{[\mathrm{C}]^c[\mathrm{D}]^d}{[\mathrm{A}]^a[\mathrm{B}]^b}$; $n$ = no. of electrons "
     r"transferred, $E^\circ_{cell}$ = std. emf of the cell.", "srcs": ["S002·5"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Maximum work and free energy", "tex": r"-\Delta G=W_{max}",
     "gives": "Maximum useful work from a reversible process.", "when": "Constant $T$ and $P$, reversible operation.",
     "units": "J (or J mol<sup>−1</sup>)", "note": "Decrease in free energy = maximum work.", "stars": 2, "srcs": ["S002·3", "T001 00:19:38"]},
    {"id": "E1.2", "topic": "T1", "title": "Maximum electrical work", "tex": r"W_{max}=\underbrace{nF}_{\text{charge}}\times\underbrace{E}_{\text{energy/charge}}=nFE",
     "gives": "Electrical work from $n$ mol of electrons at potential $E$.", "when": "Any electrode or cell.",
     "units": r"C mol<sup>−1</sup> × V = J mol<sup>−1</sup>", "note": "1 V = 1 J C<sup>−1</sup>.", "stars": 3, "srcs": ["S002·3", "T001 00:20:21", "T001 00:21:06"]},
    {"id": "E1.3", "topic": "T1", "title": "Free energy and potential", "tex": r"\Delta G=-nFE,\qquad \Delta G^\circ=-nFE^\circ",
     "gives": "Links thermodynamics to potential.", "when": "Second form: standard conditions (1 M, 1 atm, 298 K).",
     "units": "J mol<sup>−1</sup>", "note": "$E>0\\Rightarrow\\Delta G<0$: spontaneous.", "stars": 3, "srcs": ["S002·3", "T001 00:16:25", "T001 00:21:24"]},
    {"id": "E2.1", "topic": "T2", "title": "Free energy and reaction quotient", "tex": r"\Delta G=\Delta G^\circ+RT\ln Q",
     "gives": "How $\\Delta G$ changes as $Q$ changes.", "when": "Any reaction; $\\ln$ is the natural log.",
     "units": "J mol<sup>−1</sup>", "note": "No $nF$ here: $RT\\ln Q$, not $\\frac{RT}{nF}\\ln Q$.", "stars": 3, "srcs": ["S002·4", "T001 00:21:42"]},
    {"id": "E2.2", "topic": "T2", "title": "Reaction quotient for the electrode", "tex": r"\mathrm{M^{n+}}+ne^-\rightleftharpoons\mathrm{M},\qquad Q=\frac{[\mathrm{M}]}{[\mathrm{M^{n+}}]}",
     "gives": "$Q$ for the reduction.", "when": "Electrode written as a reduction.", "units": "dimensionless",
     "note": "Product over reactant.", "stars": 3, "srcs": ["S002·4", "T001 00:22:05"]},
    {"id": "E2.3", "topic": "T2", "title": "After substituting and dividing by −nF",
     "tex": r"-nFE=-nFE^\circ+RT\ln\frac{[\mathrm{M}]}{[\mathrm{M^{n+}}]}\ \Longrightarrow\ E=E^\circ-\frac{RT}{nF}\ln\frac{[\mathrm{M}]}{[\mathrm{M^{n+}}]}",
     "gives": "The general Nernst equation, before simplification.", "when": "Any $T$.", "units": "V",
     "note": "Dividing by $-nF$ flips the sign of the $RT$ term.", "stars": 3, "srcs": ["S002·4", "T001 00:22:32", "T001 00:23:01"]},
    {"id": "E2.4", "topic": "T2", "title": "Single electrode, natural log", "tex": r"E=E^\circ+\frac{RT}{nF}\ln[\mathrm{M^{n+}}]",
     "gives": "Electrode (reduction) potential at any $T$.", "when": r"$[\mathrm{M}]=1$ for the pure metal.", "units": "V",
     "note": r"$-\ln\frac{1}{x}=+\ln x$.", "stars": 3, "srcs": ["S002·5", "T001 00:23:17"]},
    {"id": "E2.5", "topic": "T2", "title": "Single electrode at 298 K", "tex": r"E=E^\circ+\frac{0.0591}{n}\log[\mathrm{M^{n+}}]",
     "gives": "The form used in numericals.", "when": "298 K; reduction potential.", "units": "V",
     "note": r"$0.0591=2.303\times\frac{8.314\times298}{96500}$.", "stars": 3, "srcs": ["S002·5", "T001 00:23:29", "T001 00:23:50"]},
    {"id": "E3.1", "topic": "T3", "title": "The Nernst factor", "tex": r"\frac{2.303\,RT}{F}=\frac{2.303\times8.314\times298}{96500}=0.0591\ \mathrm{V}",
     "gives": "The 298 K constant.", "when": "Slide constants; sympy gives 0.05913.", "units": "V",
     "note": "CODATA constants at 298.15 K give 0.05916 V; both round to 0.0591.", "stars": 2, "srcs": ["S002·5", "T001 00:23:40"]},
    {"id": "E3.2", "topic": "T3", "title": "Any temperature", "tex": r"E=E^\circ+\frac{2.303\,RT}{nF}\log[\mathrm{M^{n+}}]",
     "gives": "Electrode potential at temperature $T$.", "when": "$T\\ne298$ K: recompute the factor (0.0611 V at 308 K).", "units": "V",
     "note": "Assumes $E^\\circ$ is the 298 K value unless given.", "stars": 1, "srcs": ["S002·5", "T001 00:19:25"], "flags": [ADD]},
    {"id": "E3.3", "topic": "T3", "title": "Change per decade", "tex": r"\Delta E=\frac{0.0591}{n}\ \text{per tenfold change in }[\mathrm{M^{n+}}]",
     "gives": "Slope of $E$ vs $\\log[\\mathrm{M^{n+}}]$.", "when": "298 K.", "units": "V",
     "note": "$n=1$: 59.1 mV; $n=2$: 29.6 mV; $n=3$: 19.7 mV.", "stars": 1, "srcs": ["S002·5"], "flags": [ADD]},
    {"id": "E4.1", "topic": "T4", "title": "Nernst equation for a cell (298 K)",
     "tex": r"E_{cell}=E^\circ_{cell}-\frac{0.0591}{n}\log\frac{[\mathrm{C}]^c[\mathrm{D}]^d}{[\mathrm{A}]^a[\mathrm{B}]^b}",
     "gives": "Cell emf at non-standard concentrations.", "when": r"$a\mathrm{A}+b\mathrm{B}\rightleftharpoons c\mathrm{C}+d\mathrm{D}$; $n$ from the balanced equation.",
     "units": "V", "note": "General $T$: replace 0.0591 by $2.303RT/F$.", "stars": 3, "srcs": ["S002·5", "T001 00:24:15", "T001 00:25:06"]},
    {"id": "E4.2", "topic": "T4", "title": "Reaction quotient for a cell", "tex": r"Q=\frac{[\mathrm{C}]^c[\mathrm{D}]^d}{[\mathrm{A}]^a[\mathrm{B}]^b}",
     "gives": "Products over reactants with coefficients as powers.", "when": "Pure solids and liquids have activity 1 and are left out.",
     "units": "dimensionless", "note": r"Al–Cu cell: $Q=[\mathrm{Al^{3+}}]^2/[\mathrm{Cu^{2+}}]^3$.", "stars": 3, "srcs": ["S002·5", "T001 00:24:15"]},
    {"id": "E4.3", "topic": "T4", "title": "Cell emf from electrode potentials", "tex": r"E_{cell}=E_{right}-E_{left}=E_{cathode}-E_{anode}",
     "gives": "Cell emf from two reduction potentials.", "when": "Both from E2.5 at their own concentrations.", "units": "V",
     "note": "Gives the same answer as E4.1.", "stars": 3, "srcs": ["T001 00:16:00", "PDF p.10"]},
    {"id": "E4.4", "topic": "T4", "title": "Equilibrium constant", "tex": r"E_{cell}=0,\ Q=K\ \Longrightarrow\ \log K=\frac{nE^\circ_{cell}}{0.0591},\qquad \Delta G^\circ=-2.303\,RT\log K",
     "gives": "$K$ from $E^\\circ_{cell}$.", "when": "At equilibrium (the cell is “dead”).", "units": "$K$ dimensionless",
     "note": "Not taught in class 002; a short note only.", "stars": 1, "srcs": ["S002·5"], "flags": [ADD, NOTCUR]},
]

SYMBOLS = [
    {"sym": "$E$", "name": "Electrode potential / cell emf", "meaning": "Reduction potential in E2.5; cell emf in E4.1 (same letter on the slides)", "unit": "V", "where": "E1.2–E4.1"},
    {"sym": "$E^\\circ$", "name": "Standard electrode potential", "meaning": "At 1 M, 1 atm, 298 K", "unit": "V", "where": "E1.3, E2.3–E2.5"},
    {"sym": "$E^\\circ_{cell}$", "name": "Standard emf", "meaning": "$E^\\circ_{cathode}-E^\\circ_{anode}$", "unit": "V", "where": "E4.1, E4.4"},
    {"sym": "$\\Delta G$, $\\Delta G^\\circ$", "name": "Free-energy change", "meaning": "Actual / standard", "unit": "J mol<sup>−1</sup>", "where": "E1.1, E1.3, E2.1"},
    {"sym": "$W_{max}$", "name": "Maximum work", "meaning": "$=-\\Delta G=nFE$", "unit": "J", "where": "E1.1, E1.2"},
    {"sym": "$n$", "name": "Electrons transferred", "meaning": "Moles of electrons in the balanced reaction", "unit": "—", "where": "all"},
    {"sym": "$F$", "name": "Faraday constant", "meaning": "96500 C mol<sup>−1</sup>", "unit": "C mol<sup>−1</sup>", "where": "E1.2, E2.3"},
    {"sym": "$R$", "name": "Gas constant", "meaning": "8.314 J K<sup>−1</sup> mol<sup>−1</sup>", "unit": "J K<sup>−1</sup> mol<sup>−1</sup>", "where": "E2.1, E3.1"},
    {"sym": "$T$", "name": "Temperature", "meaning": "In kelvin", "unit": "K", "where": "E2.1, E3.2"},
    {"sym": "$Q$", "name": "Reaction quotient", "meaning": "Products/reactants at any instant", "unit": "—", "where": "E2.1, E2.2, E4.2"},
    {"sym": "$K$", "name": "Equilibrium constant", "meaning": "$Q$ at equilibrium", "unit": "—", "where": "E4.4"},
    {"sym": "$[\\mathrm{M^{n+}}]$", "name": "Ion concentration", "meaning": "Molar concentration of metal ions", "unit": "mol L<sup>−1</sup>", "where": "E2.2–E3.2"},
    {"sym": "$[\\mathrm{M}]$", "name": "Metal", "meaning": "Pure solid: taken as 1", "unit": "—", "where": "E2.2, E2.3"},
    {"sym": "$\\ln$, $\\log$", "name": "Logarithms", "meaning": "Base $e$ / base 10; $\\ln x=2.303\\log x$", "unit": "—", "where": "E2.4, E2.5"},
]

POINTS = [
    {"topic": "T1", "text": r"Total charge available = moles of electrons exchanged ($n$) × charge per mole of electrons ($F$) = $nF$; energy per unit charge = electrode potential $E$ (volt = joule per coulomb).", "stars": 3, "srcs": ["S002·3", "T001 00:20:21", "T001 00:20:50"]},
    {"topic": "T1", "text": r"$\Delta G=-nFE$: for a spontaneous reaction $\Delta G<0$, so $E_{cell}>0$; if $E_{cell}<0$ the reaction is non-spontaneous.", "stars": 3, "srcs": ["T001 00:16:39", "T001 00:16:51", "PDF p.10"]},
    {"topic": "T1", "text": r"$E_{cell}$ is the driving force for the cell reaction.", "stars": 2, "srcs": ["T001 00:16:15", "PDF p.10"]},
    {"topic": "T2", "text": r"The electrode reaction is written as a <b>reduction</b>, $\mathrm{M^{n+}}+ne^-\rightleftharpoons\mathrm{M}$, because electrode potentials are reduction potentials.", "stars": 3, "srcs": ["S002·3", "T001 00:19:38"]},
    {"topic": "T2", "text": r"The system is a metal rod dipped in a solution of its own ions.", "stars": 2, "srcs": ["T001 00:19:56"]},
    {"topic": "T2", "text": r"Electrochemical series values are standard ($E^\circ$: 1 M, 1 atm, 298 K), but real systems are seldom standard; the Nernst equation corrects $E^\circ$ for concentration, temperature and pressure.", "stars": 2, "srcs": ["T001 00:19:00", "T001 00:19:25"]},
    {"topic": "T2", "text": r"$[\mathrm{M}]=1$ because the metal is a pure substance (pure solids have unit activity).", "stars": 3, "srcs": ["S002·5", "T001 00:23:17"]},
    {"topic": "T2", "text": r"Natural log to common log: $\ln x=2.303\log x$; at 298 K, $2.303RT/F=0.0591$ V.", "stars": 3, "srcs": ["S002·5", "T001 00:23:29", "T001 00:23:50"]},
    {"topic": "T3", "text": r"Raising $[\mathrm{M^{n+}}]$ raises $E$ (the reduction becomes more favourable); diluting lowers it. Each tenfold change shifts $E$ by $0.0591/n$ V.", "stars": 2, "srcs": ["S002·5"], "flags": [ADD]},
    {"topic": "T3", "text": r"At $[\mathrm{M^{n+}}]=1$ M, $\log 1=0$ and $E=E^\circ$: the Nernst equation reduces to the standard potential.", "stars": 2, "srcs": ["S002·5"], "flags": [ADD]},
    {"topic": "T3", "text": r"The 0.0591 is valid only at 298 K. At another temperature use $2.303RT/F$ with that $T$ (0.0611 V at 308 K).", "stars": 2, "srcs": ["S002·5", "T001 00:25:37"]},
    {"topic": "T4", "text": r"For a cell only $Q$ changes; $\Delta G=-nFE_{cell}$ and $\Delta G^\circ=-nFE^\circ_{cell}$ are substituted exactly as for one electrode.", "stars": 3, "srcs": ["T001 00:24:15", "T001 00:24:52"]},
    {"topic": "T4", "text": r"$n$ is the number of electrons in the <b>balanced</b> overall reaction: 2Al + 3Cu<sup>2+</sup> exchanges 6 electrons.", "stars": 3, "srcs": ["ESA Jan-25 s1 2a"], "flags": [ADD]},
    {"topic": "T4", "text": r"Solids (Al, Cu, Zn) do not appear in $Q$; only dissolved ions (and gas pressures) do.", "stars": 3, "srcs": ["S002·5", "ESA Jan-25 s1 2a"]},
    {"topic": "T4", "text": r"The cell form gives the same emf as $E_{cathode}-E_{anode}$ with each electrode from E2.5 (check: Daniell 1.1296 V both ways).", "stars": 2, "srcs": ["T001 00:16:00"], "flags": [ADD]},
]

WHY = [
    {"topic": "T1", "q": "Why is $W_{max}=nFE$?", "a": r"Work = charge × potential difference. $n$ moles of electrons carry $nF$ coulombs, and each coulomb gains $E$ joules (1 V = 1 J C<sup>−1</sup>).", "srcs": ["S002·3", "T001 00:20:11"]},
    {"topic": "T2", "q": "Why does the sign change from $-\\frac{RT}{nF}\\ln\\frac{[\\mathrm{M}]}{[\\mathrm{M^{n+}}]}$ to $+\\frac{RT}{nF}\\ln[\\mathrm{M^{n+}}]$?", "a": r"With $[\mathrm{M}]=1$, $\ln\frac{1}{[\mathrm{M^{n+}}]}=-\ln[\mathrm{M^{n+}}]$, and the two minus signs make a plus.", "srcs": ["S002·4", "S002·5"]},
    {"topic": "T2", "q": "Why is the derivation done for the reduction reaction?", "a": r"Standard electrode potentials are tabulated as reduction potentials, so writing $\mathrm{M^{n+}}+ne^-\to\mathrm{M}$ gives $E$ on the same scale as $E^\circ$.", "srcs": ["T001 00:19:38"]},
    {"topic": "T4", "q": "Why is the cell equation written with a minus sign and $Q$ = products/reactants?", "a": r"It comes straight from $\Delta G=\Delta G^\circ+RT\ln Q$: dividing $-nFE=-nFE^\circ+RT\ln Q$ by $-nF$ gives $E=E^\circ-\frac{RT}{nF}\ln Q$. More products (larger $Q$) lower the emf.", "srcs": ["S002·5", "T001 00:24:52"]},
]

TRAPS = [
    {"topic": "T2", "text": r"While extending to the cell the lecturer says “$\Delta G=\Delta G^\circ+\frac{RT}{nF}\ln Q$” (T001 00:24:39). That is wrong: the free-energy equation has $RT\ln Q$; the $1/nF$ appears only after dividing by $-nF$.", "srcs": ["T001 00:24:39", "S002·4"], "flags": [ADD]},
    {"topic": "T2", "text": r"Sign: the single-electrode (reduction) form has $+\frac{0.0591}{n}\log[\mathrm{M^{n+}}]$; the cell form has $-\frac{0.0591}{n}\log Q$. Both are the same equation, since $Q=1/[\mathrm{M^{n+}}]$ for the electrode.", "srcs": ["S002·5"], "flags": [ADD]},
    {"topic": "T3", "text": r"Do not use 0.0591 with $\ln$: 0.0591 already contains the 2.303 and goes with $\log_{10}$; with $\ln$ use $RT/nF=0.0257/n$.", "srcs": ["S002·5"], "flags": [ADD]},
    {"topic": "T4", "text": r"ESA Jan 2025 prints “2Al + 3Cu<sup>2+</sup> → 2Al<sup>3+</sup> + Cu”. Balance it (3Cu) and take $n=6$; using $n=2$ or $n=3$ gives a wrong emf (2.0049 V for $n=3$).", "srcs": ["ESA Jan-25 s1 2a"], "flags": [ADD]},
    {"topic": "T4", "text": r"Raise each concentration to its coefficient: $[\mathrm{Al^{3+}}]^2/[\mathrm{Cu^{2+}}]^3$, not $0.35/0.6$.", "srcs": ["S002·5", "ESA Jan-25 s1 2a"], "flags": [ADD]},
]

WORKED = [
    {"id": "W2.1", "topic": "T2", "title": "Model answer: derive the Nernst equation for a single electrode", "stars": 3,
     "srcs": ["ESA Dec-24 2a", "S002·3", "S002·4", "S002·5", "T001 00:19:38"],
     "given": r"Electrode reaction $\mathrm{M^{n+}}+ne^-\rightleftharpoons\mathrm{M}$ (metal dipped in a solution of its ions). Derive $E$ in terms of $[\mathrm{M^{n+}}]$.",
     "steps": [r"Maximum work = decrease in free energy: $-\Delta G=W_{max}$.",
               r"$W_{max}$ = total charge × energy per unit charge $=nF\times E$, so $\Delta G=-nFE$; under standard conditions $\Delta G^\circ=-nFE^\circ$.",
               r"Thermodynamics: $\Delta G=\Delta G^\circ+RT\ln Q$, with $Q=[\mathrm{M}]/[\mathrm{M^{n+}}]$.",
               r"Substitute: $-nFE=-nFE^\circ+RT\ln\frac{[\mathrm{M}]}{[\mathrm{M^{n+}}]}$.",
               r"Divide by $-nF$: $E=E^\circ-\frac{RT}{nF}\ln\frac{[\mathrm{M}]}{[\mathrm{M^{n+}}]}$.",
               r"$[\mathrm{M}]=1$ (pure solid): $E=E^\circ+\frac{RT}{nF}\ln[\mathrm{M^{n+}}]$.",
               r"$\ln=2.303\log$; at 298 K with $R=8.314$, $F=96500$: $\frac{2.303RT}{F}=0.0591$ V."],
     "answer": r"$E=E^\circ+\dfrac{0.0591}{n}\log[\mathrm{M^{n+}}]$ at 298 K",
     "check": r"At $[\mathrm{M^{n+}}]=1$ M, $E=E^\circ$. Define every symbol ($E^\circ$, $n$, $R$, $T$, $F$) for full marks; sympy: $2.303\times8.314\times298/96500=0.05913$."},
    {"id": "W3.1", "topic": "T3", "title": "Zinc electrode in 0.01 M Zn<sup>2+</sup>", "stars": 2, "srcs": ["S002·5"], "flags": [ADD],
     "given": r"$\mathrm{Zn^{2+}}(0.01\ \mathrm{M})\,|\,\mathrm{Zn}$, $E^\circ=-0.76$ V, 298 K.",
     "steps": [r"$\mathrm{Zn^{2+}}+2e^-\rightleftharpoons\mathrm{Zn}$, $n=2$.", r"$E=-0.76+\frac{0.0591}{2}\log(0.01)=-0.76+0.02955\times(-2)$."],
     "answer": r"$E=-0.8191$ V", "check": "sympy: −0.81910 V; more negative than $E^\\circ$, as expected for dilute ions."},
    {"id": "W3.2", "topic": "T3", "title": "Copper electrode in 0.1 M Cu<sup>2+</sup>", "stars": 2, "srcs": ["S002·5"], "flags": [ADD],
     "given": r"$\mathrm{Cu^{2+}}(0.1\ \mathrm{M})\,|\,\mathrm{Cu}$, $E^\circ=+0.34$ V, 298 K.",
     "steps": [r"$n=2$.", r"$E=0.34+0.02955\log(0.1)=0.34-0.02955$."],
     "answer": r"$E=+0.3105$ V", "check": "sympy: 0.31045 V (one decade below 1 M: 29.6 mV lower)."},
    {"id": "W3.3", "topic": "T3", "title": "Effect of temperature: zinc at 308 K", "stars": 1, "srcs": ["S002·5", "T001 00:19:25"], "flags": [ADD],
     "given": r"$\mathrm{Zn^{2+}}(0.01\ \mathrm{M})\,|\,\mathrm{Zn}$ at 308 K; take $E^\circ=-0.76$ V.",
     "steps": [r"$\frac{2.303RT}{F}=\frac{2.303\times8.314\times308}{96500}=0.06111$ V.", r"$E=-0.76+\frac{0.06111}{2}\times(-2)=-0.76-0.06111$."],
     "answer": r"$E=-0.8211$ V (vs −0.8191 V at 298 K)", "check": "sympy: −0.82111 V. Assumes $E^\\circ$ unchanged with $T$, as such questions usually do."},
    {"id": "W4.1", "topic": "T4", "title": "ESA: Al–Cu cell, derive and calculate the emf", "stars": 3, "srcs": ["ESA Jan-25 s1 2a", "S002·5"],
     "given": r"$2\mathrm{Al}+3\mathrm{Cu^{2+}}(0.6\ \mathrm{M})\rightarrow2\mathrm{Al^{3+}}(0.35\ \mathrm{M})+3\mathrm{Cu}$ (paper prints “+ Cu”), $E^\circ_{cell}=2.0$ V, 298 K.",
     "steps": [r"Derivation: $\Delta G=\Delta G^\circ+RT\ln Q$; $-nFE_{cell}=-nFE^\circ_{cell}+RT\ln Q$; divide by $-nF$ and convert: $E_{cell}=E^\circ_{cell}-\frac{0.0591}{n}\log Q$.",
               r"Half reactions: $2\mathrm{Al}\to2\mathrm{Al^{3+}}+6e^-$, $3\mathrm{Cu^{2+}}+6e^-\to3\mathrm{Cu}$, so $n=6$.",
               r"$Q=\frac{[\mathrm{Al^{3+}}]^2}{[\mathrm{Cu^{2+}}]^3}=\frac{0.35^2}{0.6^3}=\frac{0.1225}{0.216}=0.5671$; $\log Q=-0.2463$.",
               r"$E_{cell}=2.0-\frac{0.0591}{6}(-0.2463)=2.0+0.00243$."],
     "answer": r"$E_{cell}=2.0024$ V", "check": r"sympy: 2.00243 V (2.00243 with CODATA constants too). $E^\circ_{cell}=0.34-(-1.66)=2.00$ V agrees with the given value. $\Delta G=-6\times96500\times2.0024=-1159$ kJ."},
    {"id": "W4.2", "topic": "T4", "title": "Daniell cell at non-unit concentrations", "stars": 2, "srcs": ["S002·5", "T001 00:16:00"], "flags": [ADD],
     "given": r"$\mathrm{Zn}\,|\,\mathrm{Zn^{2+}}(0.01\ \mathrm{M})\,\|\,\mathrm{Cu^{2+}}(0.1\ \mathrm{M})\,|\,\mathrm{Cu}$, $E^\circ_{cell}=1.10$ V, 298 K.",
     "steps": [r"$\mathrm{Zn}+\mathrm{Cu^{2+}}\to\mathrm{Zn^{2+}}+\mathrm{Cu}$, $n=2$; $Q=\frac{0.01}{0.1}=0.1$.",
               r"$E_{cell}=1.10-\frac{0.0591}{2}\log0.1=1.10+0.02955$.",
               r"$\Delta G=-nFE_{cell}=-2\times96500\times1.1296$ J."],
     "answer": r"$E_{cell}=1.1296$ V; $\Delta G=-218.0$ kJ mol<sup>−1</sup>", "check": r"Electrode route: $0.3105-(-0.8191)=1.1296$ V (W3.1, W3.2). $\Delta G^\circ=-212.3$ kJ. sympy agrees."},
    {"id": "W4.3", "topic": "T4", "title": "Equilibrium constant of the Daniell cell", "stars": 1, "srcs": ["S002·5"], "flags": [ADD, NOTCUR],
     "given": r"$E^\circ_{cell}=1.10$ V, $n=2$, 298 K.",
     "steps": [r"At equilibrium $E_{cell}=0$ and $Q=K$: $0=E^\circ-\frac{0.0591}{n}\log K$.", r"$\log K=\frac{2\times1.10}{0.0591}=37.23$."],
     "answer": r"$K\approx1.7\times10^{37}$", "check": "sympy: log K = 37.225. The reaction goes essentially to completion."},
]

PYQS = [
    {"topic": "T2", "paper": "ESA Dec 2024", "q": "UE23CY151A/B set 1, Q2.a", "marks": 5,
     "text": r"Derive the Nernst equation for a single electrode undergoing the following electrode reaction: $\mathrm{M^{n+}}+ne\rightarrow\mathrm{M}$.", "worked": "W2.1"},
    {"topic": "T4", "paper": "ESA Jan 2025", "q": "UE24CY151A set 1, Q2.a", "marks": 6,
     "text": r"Derive Nernst equation for the given cell and calculate the emf of the cell. $2\mathrm{Al}+3\mathrm{Cu^{2+}}(0.6\,\mathrm{M})\rightarrow2\mathrm{Al^{3+}}(0.35\,\mathrm{M})+\mathrm{Cu}$ (Given: $E^\circ_{cell}=2.0$ V).", "worked": "W4.1"},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "A single electrode: metal M in a solution of its ions", "stars": 2, "srcs": ["S002·3", "T001 00:19:56"], "flags": [ADD],
     "howto": r"The system of the derivation: a rod of metal M dipped in a solution of $\mathrm{M^{n+}}$. The electrode reaction is written as a reduction. The charge separation at the interface (the electrical double layer from class 001) gives the electrode potential $E$, which the Nernst equation links to $[\mathrm{M^{n+}}]$ and $T$. Schematic, not to scale."},
    {"id": "G3.1", "topic": "T3", "title": "$E-E^\\circ$ against $\\log[\\mathrm{M^{n+}}]$ at 298 K", "stars": 2, "srcs": ["S002·5"], "flags": [ADD],
     "howto": r"Straight lines through the origin ($E=E^\circ$ at 1 M) with slope $0.0591/n$: 59.1 mV per decade for $n=1$, 29.6 mV for $n=2$, 19.7 mV for $n=3$ (dashed). The marked point is $\mathrm{Zn^{2+}}$ at 0.01 M (two decades below 1 M, $n=2$): $-0.0591$ V, as in W3.1."},
    {"id": "G3.2", "topic": "T3", "title": "Electrode potentials of Cu and Zn against $\\log[\\mathrm{M^{n+}}]$", "stars": 2, "srcs": ["S002·5"], "flags": [ADD], "tall": True,
     "howto": r"Each panel has its own vertical range (the lines are 1.10 V apart, which is $E^\circ_{cell}$ of the Daniell cell). Both have slope $0.0296$ V per decade ($n=2$). The grey dashed line is $E^\circ$; the marked points are W3.2 (Cu, 0.1 M: +0.3105 V) and W3.1 (Zn, 0.01 M: −0.8191 V)."},
    {"id": "G3.3", "topic": "T3", "title": "The Nernst factor $2.303RT/F$ against temperature", "stars": 1, "srcs": ["S002·5", "T001 00:23:40"], "flags": [ADD],
     "howto": r"The factor is proportional to $T$ (slide constants): 0.0591 V at 298 K and 0.0611 V at 308 K. Use the value for the question's temperature; dividing by $n$ gives the slope of G3.1."},
    {"id": "G4.1", "topic": "T4", "title": "The Al–Cu cell of ESA Jan 2025", "stars": 3, "srcs": ["ESA Jan-25 s1 2a"], "flags": [ADD],
     "howto": r"Al (lower $E^\circ$, −1.66 V) is the anode and is oxidised; Cu (+0.34 V) is the cathode. Electrons flow through the wire from Al to Cu; the salt bridge completes the circuit. Cell: $\mathrm{Al}\,|\,\mathrm{Al^{3+}}(0.35\,\mathrm{M})\,\|\,\mathrm{Cu^{2+}}(0.6\,\mathrm{M})\,|\,\mathrm{Cu}$, $E_{cell}=2.0024$ V. Schematic, not to scale."},
    {"id": "G4.2", "topic": "T4", "title": "$E_{cell}-E^\\circ_{cell}$ against $\\log Q$", "stars": 2, "srcs": ["S002·5", "ESA Jan-25 s1 2a"], "flags": [ADD],
     "howto": r"Slope $-0.0591/n$: the larger $n$, the flatter the line, so the Al–Cu cell ($n=6$, dashed) barely moves from 2.0 V. $Q<1$ (left) raises the emf above $E^\circ_{cell}$; $Q>1$ lowers it. Points: W4.1 and W4.2."},
]

FLOWS = [
    {"id": "F2.1", "topic": "T2", "title": "Derivation of the Nernst equation, step by step.", "stars": 3,
     "srcs": ["S002·3", "S002·4", "S002·5", "T001 00:19:38", "T001 00:23:50", "ESA Dec-24 2a"], "layout": "straight", "maxw": "140mm",
     "spec": {"nodes": [
         {"kind": "step", "n": 1, "title": r"$\mathrm{M^{n+}}+ne^-\rightleftharpoons\mathrm{M}$: maximum work", "fx": r"$-\Delta G=W_{max}=nFE,\quad \Delta G^\circ=-nFE^\circ$"},
         {"kind": "step", "n": 2, "title": "Thermodynamic equation", "fx": r"$\Delta G=\Delta G^\circ+RT\ln Q,\quad Q=\dfrac{[\mathrm{M}]}{[\mathrm{M^{n+}}]}$"},
         {"kind": "step", "n": 3, "title": "Substitute", "fx": r"$-nFE=-nFE^\circ+RT\ln\dfrac{[\mathrm{M}]}{[\mathrm{M^{n+}}]}$"},
         {"kind": "step", "n": 4, "title": "Divide by $-nF$", "fx": r"$E=E^\circ-\dfrac{RT}{nF}\ln\dfrac{[\mathrm{M}]}{[\mathrm{M^{n+}}]}$"},
         {"kind": "step", "n": 5, "title": "Pure metal: $[\\mathrm{M}]=1$", "fx": r"$E=E^\circ+\dfrac{RT}{nF}\ln[\mathrm{M^{n+}}]$"},
         {"kind": "step", "n": 6, "title": "Common log, 298 K", "fx": r"$\ln=2.303\log,\quad \dfrac{2.303RT}{F}=0.0591\ \mathrm{V}$"},
         {"kind": "result", "title": "Nernst equation (single electrode)", "fx": r"$E=E^\circ+\tfrac{0.0591}{n}\log[\mathrm{M^{n+}}]$"}]},
    },
    {"id": "F3.1", "topic": "T3", "title": "Which form of the Nernst equation?", "stars": 2, "srcs": ["S002·4", "S002·5"], "layout": "route", "maxw": "165mm",
     "spec": {"question": "What does the question give?",
              "rows": [{"title": "One electrode, 298 K", "sub": r"metal in its ions, reduction", "kw": r"$E^\circ+\frac{0.0591}{n}\log[\mathrm{M^{n+}}]$"},
                       {"title": "A whole cell reaction, 298 K", "sub": r"balance, find $n$ and $Q$", "kw": r"$E^\circ_{cell}-\frac{0.0591}{n}\log Q$"},
                       {"title": "Temperature other than 298 K", "sub": r"recompute $2.303RT/F$", "kw": "0.0611 V at 308 K"},
                       {"title": "Natural logarithm wanted", "sub": r"keep $RT/nF$", "kw": r"$E^\circ-\frac{RT}{nF}\ln Q$"},
                       {"title": "Equilibrium (cell dead)", "sub": r"$E_{cell}=0$, $Q=K$", "kw": r"$\log K=\frac{nE^\circ}{0.0591}$", "dashed": True}]},
     "remark": "The dashed route (equilibrium constant) is added for clarity; it was not taught in class 002."},
    {"id": "F4.1", "topic": "T4", "title": "Solving a cell-emf numerical with the Nernst equation.", "stars": 3, "srcs": ["S002·5", "ESA Jan-25 s1 2a"],
     "layout": "straight", "maxw": "140mm",
     "spec": {"nodes": [
         {"kind": "given", "title": r"Cell reaction, concentrations, $E^\circ_{cell}$ (or two $E^\circ$)", "sub": "ESA Jan 2025: Al / Cu"},
         {"kind": "step", "n": 1, "title": "Balance; split into half reactions", "fx": r"$2\mathrm{Al}+3\mathrm{Cu^{2+}}\to2\mathrm{Al^{3+}}+3\mathrm{Cu}$"},
         {"kind": "step", "n": 2, "title": "Electrons transferred", "fx": r"$n=6$"},
         {"kind": "step", "n": 3, "title": "$E^\\circ_{cell}$ if not given", "fx": r"$E^\circ_{cathode}-E^\circ_{anode}=0.34-(-1.66)=2.00\ \mathrm{V}$"},
         {"kind": "step", "n": 4, "title": "Reaction quotient (no solids)", "fx": r"$Q=\dfrac{0.35^2}{0.6^3}=0.5671$"},
         {"kind": "step", "n": 5, "title": "Nernst equation", "fx": r"$E_{cell}=2.0-\dfrac{0.0591}{6}\log0.5671$"},
         {"kind": "result", "title": "emf", "fx": r"$E_{cell}=2.0024\ \mathrm{V}$"},
         {"kind": "check", "title": "Check", "sub": r"$E_{cell}>0$ so $\Delta G=-nFE<0$: spontaneous ($-1159$ kJ)"}]},
     "remark": "In a 6-mark question write the derivation (F2.1, cell form) before the calculation.",
     "trap": r"Balance first: the paper prints “+ Cu”. Wrong $n$ gives the wrong emf."},
    {"id": "F1.1", "topic": "T1", "title": "What the sign of $E$ says about $\\Delta G$.", "stars": 2, "srcs": ["T001 00:16:39", "T001 00:16:51", "PDF p.10"], "layout": "tree", "maxw": "160mm",
     "spec": {"root": {"kind": "given", "title": r"$\Delta G=-nFE_{cell}$"},
              "branches": [{"title": r"$E_{cell}>0$", "sub": "spontaneous", "rows": [[r"$\Delta G$", "negative"], ["cell", "galvanic, delivers work"]]},
                           {"title": r"$E_{cell}=0$", "sub": "equilibrium", "rows": [[r"$\Delta G$", "zero"], [r"$Q$", r"$=K$ (cell dead)"]]},
                           {"title": r"$E_{cell}<0$", "sub": "non-spontaneous", "rows": [[r"$\Delta G$", "positive"], ["cell", "needs external emf"]]}]},
     "remark": r"The middle branch ($E=0$ at equilibrium) is added for clarity; the lecture gives the two outer cases."},
]

COMPARISONS = [
    {"id": "C4.1", "topic": "T4", "title": "Nernst equation: single electrode vs cell", "srcs": ["S002·4", "S002·5"],
     "head": ["", "Single electrode", "Cell"],
     "rows": [["Reaction", r"$\mathrm{M^{n+}}+ne^-\rightleftharpoons\mathrm{M}$", r"$a\mathrm{A}+b\mathrm{B}\rightleftharpoons c\mathrm{C}+d\mathrm{D}$"],
              ["$Q$", r"$[\mathrm{M}]/[\mathrm{M^{n+}}]=1/[\mathrm{M^{n+}}]$", r"$[\mathrm{C}]^c[\mathrm{D}]^d/[\mathrm{A}]^a[\mathrm{B}]^b$"],
              ["$E$ means", "reduction (electrode) potential", r"emf $E_{cell}$"],
              ["Standard value", r"$E^\circ$", r"$E^\circ_{cell}=E^\circ_{cathode}-E^\circ_{anode}$"],
              ["Form at 298 K", r"$E^\circ+\frac{0.0591}{n}\log[\mathrm{M^{n+}}]$", r"$E^\circ_{cell}-\frac{0.0591}{n}\log Q$"],
              ["$n$", "electrons in the half reaction", "electrons in the balanced overall reaction"],
              ["ESA", "Dec 2024 Q2.a (5 marks)", "Jan 2025 Q2.a (6 marks)"]]},
    {"id": "C1.1", "topic": "T1", "title": "Signs of $\\Delta G$, $E$ and $K$", "srcs": ["T001 00:16:39", "S002·3"], "flags": [ADD],
     "head": ["Reaction", r"$\Delta G$", r"$E_{cell}$", r"$K$"],
     "rows": [["Spontaneous", "< 0", "> 0", "> 1"], ["At equilibrium", "0", "0", r"$Q=K$"], ["Non-spontaneous", "> 0", "< 0", "< 1"]]},
]

NOTES = [
    {"topic": "T1", "text": r"The maximum work obtainable equals the decrease in free energy, $-\Delta G=W_{max}$. For an electrochemical system, $W_{max}$ = total charge ($nF$, $F=96500$ C mol<sup>−1</sup>) × energy per unit charge ($E$), so $W_{max}=nFE$, $\Delta G=-nFE$ and $\Delta G^\circ=-nFE^\circ$. A positive emf means negative $\Delta G$: a spontaneous reaction."},
    {"topic": "T2", "text": r"For $\mathrm{M^{n+}}+ne^-\rightleftharpoons\mathrm{M}$: $\Delta G=\Delta G^\circ+RT\ln Q$ with $Q=[\mathrm{M}]/[\mathrm{M^{n+}}]$. Substituting gives $-nFE=-nFE^\circ+RT\ln\frac{[\mathrm{M}]}{[\mathrm{M^{n+}}]}$; dividing by $-nF$ and putting $[\mathrm{M}]=1$ gives $E=E^\circ+\frac{RT}{nF}\ln[\mathrm{M^{n+}}]$. With $\ln=2.303\log$ at 298 K: $E=E^\circ+\frac{0.0591}{n}\log[\mathrm{M^{n+}}]$."},
    {"topic": "T3", "text": r"$E$ rises by $0.0591/n$ V per tenfold rise in $[\mathrm{M^{n+}}]$ and equals $E^\circ$ at 1 M. Zn in 0.01 M $\mathrm{Zn^{2+}}$: −0.8191 V; Cu in 0.1 M $\mathrm{Cu^{2+}}$: +0.3105 V. The factor $2.303RT/F$ is proportional to $T$: 0.0591 V at 298 K, 0.0611 V at 308 K."},
    {"topic": "T4", "text": r"For $a\mathrm{A}+b\mathrm{B}\rightleftharpoons c\mathrm{C}+d\mathrm{D}$: $E_{cell}=E^\circ_{cell}-\frac{0.0591}{n}\log\frac{[\mathrm{C}]^c[\mathrm{D}]^d}{[\mathrm{A}]^a[\mathrm{B}]^b}$, $n$ from the balanced reaction, solids omitted. ESA Jan 2025: 2Al + 3Cu<sup>2+</sup>(0.6 M) → 2Al<sup>3+</sup>(0.35 M) + 3Cu, $n=6$, $Q=0.5671$, $E_{cell}=2.0024$ V."},
]

KEYWORDS = [
    {"term": "Nernst equation", "meaning": "Relation between electrode potential and concentration of the species the electrode is reversible with.", "topic": "T2"},
    {"term": "Maximum work", "meaning": "$W_{max}=-\\Delta G=nFE$.", "topic": "T1"},
    {"term": "Free energy change", "meaning": "$\\Delta G=-nFE$; negative for a spontaneous reaction.", "topic": "T1"},
    {"term": "Faraday constant", "meaning": "96500 C per mole of electrons.", "topic": "T1"},
    {"term": "Total charge available", "meaning": "$nF$.", "topic": "T1"},
    {"term": "Energy per unit charge", "meaning": "The electrode potential $E$ (J C<sup>−1</sup> = V).", "topic": "T1"},
    {"term": "Reaction quotient", "meaning": "$Q$ = products/reactants with coefficients as powers.", "topic": "T2"},
    {"term": "Standard electrode potential", "meaning": "$E^\\circ$ at 1 M, 1 atm, 298 K.", "topic": "T2"},
    {"term": "Pure substance", "meaning": "Activity 1, so $[\\mathrm{M}]=1$.", "topic": "T2"},
    {"term": "2.303", "meaning": "$\\ln10$: converts $\\ln$ to $\\log$.", "topic": "T2"},
    {"term": "0.0591 V", "meaning": "$2.303RT/F$ at 298 K.", "topic": "T3"},
    {"term": "Slope 0.0591/n", "meaning": "Change of $E$ per decade of concentration.", "topic": "T3"},
    {"term": "Temperature effect", "meaning": "Factor $2.303RT/F$ grows with $T$ (0.0611 V at 308 K).", "topic": "T3"},
    {"term": "Standard emf", "meaning": "$E^\\circ_{cell}=E^\\circ_{cathode}-E^\\circ_{anode}$.", "topic": "T4"},
    {"term": "Balanced reaction", "meaning": "Needed for $n$ and the powers in $Q$.", "topic": "T4"},
    {"term": "Equilibrium constant", "meaning": "$\\log K=nE^\\circ_{cell}/0.0591$ (added for clarity).", "topic": "T4"},
    {"term": "Driving force", "meaning": "$E_{cell}$ drives the cell reaction.", "topic": "T1"},
]

RAPID = [
    {"q": "Define the Nernst equation.", "a": "Relation between electrode potential and the concentration of the species the electrode is reversible with."},
    {"q": "Maximum work in terms of free energy?", "a": "$W_{max}=-\\Delta G$."},
    {"q": "Maximum electrical work?", "a": "$nFE$ (charge $nF$ × energy per unit charge $E$)."},
    {"q": "$\\Delta G$ and $E$?", "a": "$\\Delta G=-nFE$; $\\Delta G^\\circ=-nFE^\\circ$."},
    {"q": "Thermodynamic equation used?", "a": "$\\Delta G=\\Delta G^\\circ+RT\\ln Q$."},
    {"q": "$Q$ for $\\mathrm{M^{n+}}+ne^-\\rightleftharpoons\\mathrm{M}$?", "a": "$[\\mathrm{M}]/[\\mathrm{M^{n+}}]$."},
    {"q": "Why is $[\\mathrm{M}]=1$?", "a": "Pure solid."},
    {"q": "Divide by what?", "a": "$-nF$."},
    {"q": "Nernst equation, single electrode, 298 K?", "a": "$E=E^\\circ+\\frac{0.0591}{n}\\log[\\mathrm{M^{n+}}]$."},
    {"q": "Value of $2.303RT/F$ at 298 K?", "a": "0.0591 V (0.05913 with slide constants)."},
    {"q": "At 308 K?", "a": "0.0611 V."},
    {"q": "Nernst equation for a cell?", "a": "$E_{cell}=E^\\circ_{cell}-\\frac{0.0591}{n}\\log Q$."},
    {"q": "Zn in 0.01 M $\\mathrm{Zn^{2+}}$ ($E^\\circ=-0.76$ V)?", "a": "−0.8191 V."},
    {"q": "ESA Al–Cu cell: $n$, $Q$, emf?", "a": "6; 0.5671; 2.0024 V."},
    {"q": "Sign of $E$ for a spontaneous reaction?", "a": "Positive ($\\Delta G<0$)."},
    {"q": "Slope of $E$ vs $\\log[\\mathrm{M^{n+}}]$?", "a": "$0.0591/n$."},
]

MNEMONICS = [
    "<i>“Work, Gibbs, Quotient, Divide, One, Log.”</i> The six moves of the derivation: $W_{max}=nFE$ → $\\Delta G=-nFE$ → $+RT\\ln Q$ → ÷($-nF$) → $[\\mathrm{M}]=1$ → 2.303 log at 298 K.",
]

TOP_FACTS = [
    "$-\\Delta G=W_{max}=nFE$; $\\Delta G^\\circ=-nFE^\\circ$.",
    "$\\Delta G=\\Delta G^\\circ+RT\\ln Q$ (no $nF$ here).",
    "Electrode: $Q=[\\mathrm{M}]/[\\mathrm{M^{n+}}]$, $[\\mathrm{M}]=1$.",
    "$E=E^\\circ+\\frac{RT}{nF}\\ln[\\mathrm{M^{n+}}]=E^\\circ+\\frac{0.0591}{n}\\log[\\mathrm{M^{n+}}]$ at 298 K.",
    "$2.303\\times8.314\\times298/96500=0.0591$ V; 0.0611 V at 308 K.",
    "Cell: $E_{cell}=E^\\circ_{cell}-\\frac{0.0591}{n}\\log\\frac{[\\mathrm{C}]^c[\\mathrm{D}]^d}{[\\mathrm{A}]^a[\\mathrm{B}]^b}$.",
    "$n$ from the balanced equation; solids out of $Q$.",
    "ESA Jan 2025 Al–Cu: $n=6$, $Q=0.5671$, $E_{cell}=2.0024$ V.",
    "$E$ changes by $0.0591/n$ V per tenfold concentration change.",
    "$E>0$ ⇔ $\\Delta G<0$ ⇔ spontaneous.",
]
TOP_FORMULAS = ["E1.2", "E1.3", "E2.1", "E2.3", "E2.5", "E4.1"]
