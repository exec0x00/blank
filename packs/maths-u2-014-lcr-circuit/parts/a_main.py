"""Unit 2, class 014: applications of linear differential equations to electric circuits (LCR, RL, RC)."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "Modelling the series LCR circuit",
     "overview": r"A series LCR circuit has an inductor $L$ (henries), a resistor $R$ (ohms) and a capacitor $C$ (farads) driven by an "
                 r"electromotive force $E(t)$ (volts). The voltage drops across them are $L\frac{dI}{dt}$, $RI$ and $\frac QC$, and "
                 r"Kirchhoff's voltage law says they add up to $E(t)$. With $I=\frac{dQ}{dt}$ this becomes the second-order linear "
                 r"equation with constant coefficients $L\frac{d^2Q}{dt^2}+R\frac{dQ}{dt}+\frac QC=E(t)$; differentiating it once gives "
                 r"the same kind of equation for the current. Two initial conditions, $Q(0)$ and $I(0)$, fix the solution."},
    {"id": "T2", "title": "Solving the circuit equation: CF, PI and damping",
     "overview": r"The charge is $Q=\text{CF}+\text{PI}$. The CF comes from the auxiliary equation $Lm^2+Rm+\frac1C=0$; because $L,R,C>0$ "
                 r"it always decays, so it is the transient. Its roots are real and distinct, equal, or complex according as $R^2$ "
                 r"is greater than, equal to or less than $\frac{4L}{C}$ (over-, critically or underdamped). The PI is the steady "
                 r"state that remains: a constant $CE$ for a battery, a sinusoid of the source frequency for an AC source. The slides "
                 r"work a battery example ($Q=1+e^{-2t}(-\cos t-2\sin t)$) and an AC example."},
    {"id": "T3", "title": "Past-paper circuits: AC sources and free discharge",
     "overview": r"Both ESA questions give $R$, $L$, $C$ and a sinusoidal $E(t)$ and ask for the charge at any time $t$: divide by $L$, "
                 r"find the complex CF roots, find the PI by the Type 2 rule ($D^2\to-a^2$, then rationalise), and write "
                 r"$Q=\text{CF}+\text{PI}$ with two arbitrary constants. If $Q(0)$ and $I(0)$ are given, fix the constants. CW P36 is "
                 r"the free discharge of a charged capacitor ($E=0$): only the CF, a decaying oscillation."},
    {"id": "T4", "title": "First-order circuits: RL and RC",
     "overview": r"Without a capacitor (RL circuit) Kirchhoff's law gives $L\frac{di}{dt}+Ri=E(t)$; without an inductor (RC circuit) it gives "
                 r"$Ri+\frac QC=E$, which differentiated is $R\frac{di}{dt}+\frac iC=\frac{dE}{dt}$. Both are first-order linear equations "
                 r"with constant coefficients, solved by the same CF + PI method with a single root: a transient $e^{-Rt/L}$ or "
                 r"$e^{-t/(RC)}$ plus a sinusoidal steady state."},
]

DEFS = [
    {"topic": "T1", "term": "Series LCR (RLC) circuit", "text": "An inductor of inductance $L$ (henries), a capacitor of capacitance $C$ (farads) "
     "and a resistor of resistance $R$ (ohms) connected in series with a source of electromotive force $E(t)$ (volts).",
     "srcs": ["S014·4", "T014 00:00:13"]},
    {"topic": "T1", "term": "Current $I(t)$", "text": "The current through the whole circuit, in amperes; $I=\\frac{dQ}{dt}$.",
     "srcs": ["S014·4", "S014·6", "T014 00:02:38"]},
    {"topic": "T1", "term": "Charge $Q(t)$", "text": "The charge on the capacitor, in coulombs.", "srcs": ["S014·4", "S014·6"]},
    {"topic": "T1", "term": "Voltage drop", "text": "The potential difference across one component: $L\\frac{dI}{dt}$ (inductor), $RI$ (resistor, Ohm's law), "
     "$\\frac QC$ (capacitor).", "srcs": ["S014·5", "T014 00:01:18"]},
    {"topic": "T1", "term": "Kirchhoff's voltage law", "text": "The voltage supplied by the battery equals the sum of the voltage drops across the circuit components.",
     "srcs": ["S014·5", "T014 00:01:51"]},
    {"topic": "T1", "term": "Initial conditions", "text": "The charge $Q(0)$ and the current $I(0)=Q'(0)$ at $t=0$; they fix $c_1$ and $c_2$.",
     "srcs": ["S014·7", "T014 00:03:41"]},
    {"topic": "T2", "term": "Transient", "text": "The CF part of $Q(t)$; it decays to zero because every root has a negative real part.",
     "srcs": ["S014·10", "S014·16"], "flags": [ADD]},
    {"topic": "T2", "term": "Steady state", "text": "The PI part, which remains for large $t$: $CE$ for a constant source, a sinusoid at the source frequency for an AC source.",
     "srcs": ["S014·10", "S014·15"], "flags": [ADD]},
    {"topic": "T2", "term": "Overdamped, critically damped, underdamped", "text": "$R^2>\\frac{4L}{C}$ (two real roots, no oscillation), $R^2=\\frac{4L}{C}$ "
     "(equal roots), $R^2<\\frac{4L}{C}$ (complex roots, decaying oscillation).", "srcs": ["S014·9", "S014·15"], "flags": [ADD]},
    {"topic": "T3", "term": "Free (natural) discharge", "text": "$E(t)=0$: a charged capacitor discharges through $L$ and $R$; the charge is the CF alone.",
     "srcs": ["CW U2 P36"]},
    {"topic": "T4", "term": "Time constant", "text": "$\\frac LR$ (RL) or $RC$ (RC): the time in which the transient falls to $e^{-1}\\approx37\\%$.",
     "srcs": ["CW U2 P34", "CW U2 P35"], "flags": [ADD]},
]

STATEMENTS = [
    {"topic": "T1", "text": "A simple RLC circuit consists of an inductor of inductance ‘L’ (in henries), a Capacitor of capacitance ‘C’ (in farads) "
     "and a resistor of resistance ‘R’ (in ohms) and a source of electromotive force E(t) (in volts) are connected in series. The current "
     "‘I’ through the circuit is measured in amperes and the charge ‘Q’ on the capacitor is measured in coulombs.", "srcs": ["S014·4"]},
    {"topic": "T1", "text": "From Kirchoff’s Voltage Law, The voltage supplied by the battery = The voltage drop across the circuit components "
     "(the sum of these voltage drops is equal to the electromotive force).", "srcs": ["S014·5"]},
    {"topic": "T1", "text": "$L\\frac{d^2Q}{dt^2}+R\\frac{dQ}{dt}+\\frac QC=E(t)$. This is the differential equation which describes LCR – Circuit.",
     "srcs": ["S014·6"]},
    {"topic": "T1", "text": "It is a second order linear differential equation with constant coefficients. If the charge and the current are "
     "known at zero time, we can get an expression for Q(t) and I(t).", "srcs": ["S014·7"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Voltage drops", "tex": r"E_L=L\frac{dI}{dt},\qquad E_R=RI,\qquad E_C=\frac{Q}{C}",
     "gives": "The voltage across the inductor, resistor and capacitor.", "when": "Any circuit with these elements.",
     "units": "volts; $L$ in H, $R$ in Ω, $C$ in F, $I$ in A, $Q$ in C",
     "note": "$E_R=RI$ is Ohm's law.", "stars": 2, "srcs": ["S014·5", "T014 00:01:18", "T014 00:01:34"]},
    {"id": "E1.2", "topic": "T1", "title": "Kirchhoff's voltage law", "tex": r"E(t)=V_L+V_R+V_C=L\frac{dI}{dt}+RI+\frac{Q}{C}",
     "gives": "The circuit equation in $I$ and $Q$.", "when": "Series circuit.",
     "note": "Sum of the drops = the EMF supplied.", "stars": 2, "srcs": ["S014·5", "S014·6", "T014 00:01:51", "T014 00:02:21"]},
    {"id": "E1.3", "topic": "T1", "title": "The LCR equation for the charge", "tex": r"L\frac{d^2Q}{dt^2}+R\frac{dQ}{dt}+\frac{Q}{C}=E(t),\qquad I=\frac{dQ}{dt}",
     "gives": "A second-order linear DE with constant coefficients for $Q(t)$.", "when": "Series LCR circuit; $L$, $R$, $C$ constant.",
     "note": "Divide by $L$ before finding the AE: $Q''+\\frac RLQ'+\\frac{1}{LC}Q=\\frac{E}{L}$.", "stars": 2,
     "srcs": ["S014·6", "S014·7", "S014·14", "T014 00:02:58", "ESA Jan-24 s3 3b", "ESA Jan-24 s4 3b"]},
    {"id": "E1.4", "topic": "T1", "title": "Initial conditions", "tex": r"Q(0)=Q_0,\qquad I(0)=Q'(0)=I_0",
     "gives": "The two conditions that fix $c_1$, $c_2$.", "when": "Usually $Q_0=I_0=0$ (switch closed at $t=0$).",
     "note": "Use $Q(0)$ in $Q(t)$, then differentiate $Q(t)$ and use $I(0)$.", "stars": 2,
     "srcs": ["S014·7", "S014·11", "S014·12", "T014 00:03:41", "T014 00:08:21"]},
    {"id": "E1.5", "topic": "T1", "title": "The equation for the current", "tex": r"L\frac{d^2I}{dt^2}+R\frac{dI}{dt}+\frac{I}{C}=\frac{dE}{dt},\qquad LI'(0)=E(0)-RI(0)-\frac{Q(0)}{C}",
     "gives": "$I(t)$ directly, by differentiating E1.3 once.", "when": "The current is asked and $E$ is differentiable.",
     "note": "The second condition comes from E1.2 at $t=0$. A constant $E$ gives $\\frac{dE}{dt}=0$.", "stars": 1,
     "srcs": ["S014·5", "S014·16"], "flags": [ADD]},
    {"id": "E2.1", "topic": "T2", "title": "Auxiliary equation and its roots", "tex": r"Lm^2+Rm+\frac1C=0,\qquad m=\frac{-R\pm\sqrt{R^2-4L/C}}{2L}",
     "gives": "The CF (transient) of the charge.", "when": "Every LCR problem.",
     "note": "Slide example: $2m^2+8m+10=0$, $m=-2\\pm i$.", "stars": 2,
     "srcs": ["S014·9", "S014·15", "T014 00:06:48"]},
    {"id": "E2.2", "topic": "T2", "title": "Damping regimes", "tex": r"\begin{gathered}R^2>\tfrac{4L}{C}:\ Q_{tr}=c_1e^{m_1t}+c_2e^{m_2t}\\ R^2=\tfrac{4L}{C}:\ Q_{tr}=(c_1+c_2t)e^{-Rt/(2L)}\\ R^2<\tfrac{4L}{C}:\ Q_{tr}=e^{-Rt/(2L)}(c_1\cos\omega_dt+c_2\sin\omega_dt)\end{gathered}",
     "gives": "The form of the transient.", "when": "Compare $R^2$ with $\\frac{4L}{C}$.",
     "note": "Over-, critically, underdamped. All decay: $m_1,m_2<0$ or real part $-\\frac{R}{2L}<0$.", "stars": 1,
     "srcs": ["S014·9", "S014·15"], "flags": [ADD]},
    {"id": "E2.3", "topic": "T2", "title": "Damped frequency", "tex": r"\omega_d=\sqrt{\frac{1}{LC}-\frac{R^2}{4L^2}},\qquad \omega_0=\frac{1}{\sqrt{LC}}\ (R=0)",
     "gives": "The angular frequency of the underdamped transient.", "when": "$R^2<\\frac{4L}{C}$.", "units": "rad/s",
     "note": "ESA s3: $\\sqrt{625-400}=15$; s4: $\\sqrt{500-100}=20$.", "stars": 1,
     "srcs": ["S014·9", "ESA Jan-24 s3 3b"], "flags": [ADD]},
    {"id": "E2.4", "topic": "T2", "title": "Solution = transient + steady state", "tex": r"Q(t)=\underbrace{\text{CF}}_{\text{transient}}+\underbrace{\text{PI}}_{\text{steady state}},\qquad E=\text{const}\Rightarrow \text{PI}=CE",
     "gives": "The structure of every answer.", "when": "Any $E(t)$.",
     "note": "Constant $E$: $\\frac{E/L}{D^2+\\frac RLD+\\frac1{LC}}$ with $D\\to0$ gives $CE$ (slide: $\\frac{5}{5}=1=0.1\\times10$).", "stars": 2,
     "srcs": ["S014·10", "T014 00:07:37", "T014 00:07:52"]},
    {"id": "E2.5", "topic": "T2", "title": "Steady-state amplitude (impedance)", "tex": r"E=E_0\sin\omega t:\quad I_{ss}=\frac{E_0}{Z}\sin(\omega t-\theta),\quad Z=\sqrt{R^2+\Big(L\omega-\frac{1}{C\omega}\Big)^2},\quad |Q_{ss}|=\frac{E_0}{\omega Z}",
     "gives": "A check on any PI.", "when": "Sinusoidal source.",
     "note": "ESA s3: $Z=\\sqrt{1600+120^2}=126.5$, $|Q_{ss}|=\\frac{100}{5\\cdot126.5}=0.158=\\sqrt{0.15^2+0.05^2}$.", "stars": 1,
     "srcs": ["ESA Jan-24 s3 3b", "S014·15"], "flags": [ADD]},
    {"id": "E3.1", "topic": "T3", "title": "PI of a sinusoidal source (Type 2)", "tex": r"\frac{1}{D^2+\frac RLD+\frac1{LC}}\cos\omega t=\frac{\cos\omega t}{\big(\frac1{LC}-\omega^2\big)+\frac RLD}\quad\text{then rationalise}",
     "gives": "The steady-state charge.", "when": "$E=E_0\\sin\\omega t$ or $E_0\\cos\\omega t$; replace $D^2$ by $-\\omega^2$.",
     "note": "No failure while $R>0$ (the CF decays, the forcing does not).", "stars": 2,
     "srcs": ["ESA Jan-24 s3 3b", "ESA Jan-24 s4 3b", "S014·15"]},
    {"id": "E4.1", "topic": "T4", "title": "RL circuit with a sinusoidal source", "tex": r"\begin{gathered}L\frac{di}{dt}+Ri=E\sin\omega t,\ i(0)=0:\\ i=\frac{E}{\sqrt{R^2+L^2\omega^2}}\big[\sin(\omega t-\varphi)+e^{-Rt/L}\sin\varphi\big],\ \varphi=\tan^{-1}\frac{L\omega}{R}\end{gathered}",
     "gives": "The current in an RL circuit.", "when": "No capacitor; switch closed at $t=0$.",
     "note": "Transient $e^{-Rt/L}$, time constant $\\frac LR$.", "stars": 2, "srcs": ["CW U2 P34"]},
    {"id": "E4.2", "topic": "T4", "title": "RC circuit with a cosine source", "tex": r"\begin{gathered}R\frac{di}{dt}+\frac iC=\frac{dE}{dt},\ E=E_0\cos pt,\ i(0)=0:\\ i=\frac{CpE_0}{1+p^2R^2C^2}\big[RCp\cos pt-\sin pt-pRC\,e^{-t/(RC)}\big]\end{gathered}",
     "gives": "The current in an RC circuit.", "when": "No inductor.",
     "note": "From $Ri+\\frac QC=E$ differentiated; time constant $RC$.", "stars": 2, "srcs": ["CW U2 P35"]},
]

POINTS = [
    {"topic": "T1", "text": "Three drops, one law: $L\\frac{dI}{dt}+RI+\\frac QC=E(t)$; then substitute $I=\\frac{dQ}{dt}$ to get one equation in $Q$.", "stars": 2,
     "srcs": ["S014·5", "S014·6", "T014 00:02:38"]},
    {"topic": "T1", "text": "The LCR equation is a second-order non-homogeneous linear DE with constant coefficients: solve it with CF + PI.", "stars": 2,
     "srcs": ["S014·7", "T014 00:03:21", "T014 00:06:03"]},
    {"topic": "T1", "text": "Two constants need two conditions: the charge and the current at $t=0$.", "stars": 2, "srcs": ["S014·7", "T014 00:03:41"]},
    {"topic": "T1", "text": "Substitute the numbers first and divide by $L$: $2Q''+8Q'+\\frac{Q}{0.1}=10\\Rightarrow Q''+4Q'+5Q=5$.", "stars": 2,
     "srcs": ["S014·8", "S014·9", "T014 00:05:46"]},
    {"topic": "T1", "text": "Watch $\\frac QC$: $\\frac{1}{0.1}=10$, $\\frac{1}{16\\times10^{-4}}=625$, $\\frac{1}{0.002}=500$, $\\frac{1}{10^{-3}}=1000$.", "stars": 2,
     "srcs": ["S014·9", "ESA Jan-24 s3 3b", "ESA Jan-24 s4 3b"]},
    {"topic": "T1", "text": "To get the current, differentiate the final $Q(t)$; or solve E1.5 for $I$ directly (W1.1).", "stars": 2,
     "srcs": ["S014·12", "T014 00:10:31"]},
    {"topic": "T2", "text": "$Q(0)$ gives $c_1$ at once; for $c_2$ differentiate $Q(t)$ (product rule on $e^{-2t}(\\dots)$) and use $I(0)$.", "stars": 2,
     "srcs": ["S014·11", "S014·12", "T014 00:09:00"]},
    {"topic": "T2", "text": "For a battery ($E$ constant) the PI is a constant: replace $D$ by 0, giving $Q_{ss}=CE$, and $I\\to0$.", "stars": 2,
     "srcs": ["S014·10", "T014 00:07:52"]},
    {"topic": "T2", "text": "$R^2$ against $\\frac{4L}{C}$ decides the CF: real distinct (overdamped), equal (critical), complex (underdamped). "
     "Slide 014·8: $64<80$, underdamped; slide 014·13: $10^4>400$, overdamped.", "stars": 1, "srcs": ["S014·9", "S014·15"], "flags": [ADD]},
    {"topic": "T2", "text": "The CF always decays (all roots have negative real part when $R>0$), so it is the transient; the PI is what you measure after a while.",
     "stars": 2, "srcs": ["S014·16"], "flags": [ADD]},
    {"topic": "T2", "text": "With an AC source the steady state has the source frequency, not $\\omega_d$; its amplitude is largest near $\\omega=\\frac{1}{\\sqrt{LC}}$ (resonance).",
     "stars": 1, "srcs": ["S014·15"], "flags": [ADD]},
    {"topic": "T3", "text": "ESA “find the charge at any time $t$” with no initial conditions: give $Q=\\text{CF}+\\text{PI}$ with $c_1$, $c_2$ arbitrary.", "stars": 2,
     "srcs": ["ESA Jan-24 s3 3b", "ESA Jan-24 s4 3b"]},
    {"topic": "T3", "text": "Both ESA circuits are underdamped: $m=-20\\pm15i$ and $m=-10\\pm20i$ (same as the class 002 pack).", "stars": 2,
     "srcs": ["ESA Jan-24 s3 3b", "ESA Jan-24 s4 3b"]},
    {"topic": "T3", "text": "PI of a sinusoid: $D^2\\to-\\omega^2$, a lone $D$ remains, rationalise with the conjugate (class 004).", "stars": 2,
     "srcs": ["ESA Jan-24 s3 3b", "ESA Jan-24 s4 3b"]},
    {"topic": "T3", "text": "Free discharge ($E=0$, CW P36): $Q(0)$ is the initial charge (here 0.002 C), not 0.", "stars": 2, "srcs": ["CW U2 P36"]},
    {"topic": "T4", "text": "RL: $L\\frac{di}{dt}+Ri=E(t)$ is first order in $i$; RC: differentiate $Ri+\\frac QC=E$ to get $R\\frac{di}{dt}+\\frac iC=\\frac{dE}{dt}$.", "stars": 2,
     "srcs": ["CW U2 P34", "CW U2 P35"]},
    {"topic": "T4", "text": "A single root $m=-\\frac RL$ or $-\\frac1{RC}$ gives one constant, fixed by $i(0)=0$.", "stars": 2, "srcs": ["CW U2 P34", "CW U2 P35"]},
]

WHY = [
    {"topic": "T1", "q": "Why does $I=\\frac{dQ}{dt}$ turn E1.2 into a second-order equation?",
     "a": "$L\\frac{dI}{dt}$ becomes $L\\frac{d^2Q}{dt^2}$, $RI$ becomes $R\\frac{dQ}{dt}$, and $\\frac QC$ stays: one unknown, $Q$, with derivatives up to order 2.",
     "srcs": ["S014·6", "T014 00:02:58"]},
    {"topic": "T2", "q": "Why does the transient always die out?",
     "a": "The roots of $Lm^2+Rm+\\frac1C=0$ have sum $-\\frac RL<0$ and product $\\frac1{LC}>0$: both real roots are negative, or the complex pair has real "
          "part $-\\frac{R}{2L}<0$. So every CF term carries a decaying exponential.", "srcs": ["S014·9", "S014·15"], "flags": [ADD]},
    {"topic": "T2", "q": "Why is the battery steady state $Q=CE$?",
     "a": "When nothing changes, $I=0$ and $\\frac{dI}{dt}=0$, so E1.2 leaves $\\frac QC=E$: the capacitor is fully charged and blocks the current.",
     "srcs": ["S014·10", "S014·12"], "flags": [ADD]},
    {"topic": "T3", "q": "Why can the Type 2 rule not fail in an LCR circuit with $R>0$?",
     "a": "Failure needs $\\pm i\\omega$ to be AE roots, i.e. purely imaginary roots. With $R>0$ the roots have negative real part, so $f(-\\omega^2)\\neq0$.",
     "srcs": ["ESA Jan-24 s3 3b"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T1", "text": "$\\frac{Q}{0.1}=10Q$, not $0.1Q$; and $\\frac{1}{16\\times10^{-4}}=625$, not $\\frac{1}{16}$.", "srcs": ["S014·9", "ESA Jan-24 s3 3b"]},
    {"topic": "T1", "text": "Divide the whole equation by $L$, including $E(t)$: $Q''+4Q'+5Q=5$ (not 10).", "srcs": ["S014·9", "T014 00:05:46"]},
    {"topic": "T2", "text": "$I(0)=0$ is a condition on $Q'(0)$: differentiate $Q(t)$ (including the $-2e^{-2t}$ term of the product rule) before substituting $t=0$.",
     "srcs": ["S014·11", "S014·12", "T014 00:09:19"]},
    {"topic": "T2", "text": "Slide 014·11 writes $e^{-2.0}$: it means $e^{-2\\cdot0}=1$, not $e^{-2}$.", "srcs": ["S014·11"], "flags": [ADD]},
    {"topic": "T2", "text": "Slide 014·16 uses $i(0)=0$ and $i'(0)=0$ but states only the first; $i'(0)=\\ddot q(0)=0$ comes from the equation at $t=0$.",
     "srcs": ["S014·16"], "flags": [ADD]},
    {"topic": "T3", "text": "With no initial conditions do not set $c_1=c_2=0$: the answer keeps the transient with arbitrary constants.",
     "srcs": ["ESA Jan-24 s3 3b", "ESA Jan-24 s4 3b"], "flags": [ADD]},
    {"topic": "T3", "text": "CW P36's $0.0008$ is $\\frac{0.002}{\\sqrt7}=0.000756$ rounded; $1323$ is $500\\sqrt7=1322.9$.", "srcs": ["CW U2 P36"], "flags": [ADD]},
    {"topic": "T4", "text": "CW P34's printed answer has $e^{-Ri/L}$ and $\\sin\\varphi\\varphi$: read $e^{-Rt/L}\\sin\\varphi$. CW P35's has $e^{-1/RC}$: read $e^{-t/(RC)}$.",
     "srcs": ["CW U2 P34", "CW U2 P35"], "flags": [ADD]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "The current equation for the slide example", "stars": 1, "srcs": ["S014·8", "S014·12"], "flags": [ADD],
     "given": "$R=8$ Ω, $L=2$ H, $C=0.1$ F, $E=10$ V, $Q(0)=I(0)=0$. Find $I(t)$ without finding $Q$ first.",
     "steps": ["Differentiate $2Q''+8Q'+10Q=10$: $2I''+8I'+10I=0$, i.e. $I''+4I'+5I=0$.",
               "Second condition from E1.2 at $t=0$: $2I'(0)=10-8\\cdot0-10\\cdot0$, so $I'(0)=5$.",
               "AE $m^2+4m+5=0$, $m=-2\\pm i$: $I=e^{-2t}(a\\cos t+b\\sin t)$.",
               "$I(0)=a=0$; $I'(0)=-2a+b=5$, so $b=5$."],
     "answer": "$I(t)=5e^{-2t}\\sin t$", "check": "Same as slide 014·12 (sympy)."},
    {"id": "W2.1", "topic": "T2", "title": "Battery: $R=8$, $L=2$, $C=0.1$, $E=10$ V (slides 014·8–12)", "stars": 2,
     "srcs": ["S014·8", "S014·9", "S014·10", "S014·11", "S014·12", "T014 00:04:29", "T014 00:10:49"],
     "given": "Find an expression for $I(t)$ in an RLC circuit with $R=8$ Ω, $L=2$ H, $C=0.1$ F, $E(t)=10$ V, assuming zero charge and zero current at $t=0$.",
     "steps": ["$2Q''+8Q'+\\frac{Q}{0.1}=10\\Rightarrow Q''+4Q'+5Q=5$.",
               "AE $m^2+4m+5=0$: $m=-2\\pm i$. CF $=e^{-2t}(c_1\\cos t+c_2\\sin t)$.",
               "PI $=\\frac{5e^{0t}}{D^2+4D+5}=\\frac55=1$ ($D\\to0$). $Q=e^{-2t}(c_1\\cos t+c_2\\sin t)+1$.",
               "$Q(0)=0$: $c_1+1=0$, $c_1=-1$.",
               "$Q'=e^{-2t}(-c_1\\sin t+c_2\\cos t)-2e^{-2t}(c_1\\cos t+c_2\\sin t)$; $I(0)=c_2-2c_1=0$, $c_2=-2$.",
               "$I=Q'=e^{-2t}(\\sin t-2\\cos t)-2e^{-2t}(-\\cos t-2\\sin t)=5e^{-2t}\\sin t$."],
     "answer": "$Q(t)=e^{-2t}(-\\cos t-2\\sin t)+1,\\qquad I(t)=5e^{-2t}\\sin t$",
     "check": "sympy dsolve and checkodesol agree with the slide. $R^2=64<\\frac{4L}{C}=80$: underdamped; $Q\\to CE=1$ C. Figure G2.1."},
    {"id": "W2.2", "topic": "T2", "title": "AC: $E=155\\sin377t$, $R=100$, $L=0.1$, $C=10^{-3}$ (slides 014·13–16)", "stars": 2,
     "srcs": ["S014·13", "S014·14", "S014·15", "S014·16"],
     "given": "Assuming $q=0$ and $i=0$ at $t=0$, in an RLC circuit with $E(t)=155\\sin(377t)$, $R=100$ Ω, $L=0.1$ H, $C=10^{-3}$ F, determine the current $i(t)$.",
     "steps": ["$0.1\\ddot q+100\\dot q+1000q=155\\sin377t\\Rightarrow\\ddot q+1000\\dot q+10000q=1550\\sin377t$.",
               "AE $r^2+1000r+10000=0$: $r=-500\\pm200\\sqrt6\\approx-10.1021,\\ -989.898$ (overdamped: $10^4>400$).",
               "$q_p=A\\sin377t+B\\cos377t$; with $377^2=142129$: $-132129A-377000B=1550$, $377000A-132129B=0$, so $A=-0.00128331$, $B=-0.00366164$.",
               "$i_p=\\dot q_p=377A\\cos377t-377B\\sin377t=-0.483808\\cos377t+1.38044\\sin377t$.",
               "$i=C_1e^{-10.1021t}+C_2e^{-989.898t}+i_p$. Conditions: $i(0)=0$ and $i'(0)=\\ddot q(0)=1550\\sin0-1000\\cdot0-10000\\cdot0=0$.",
               "$C_1+C_2=0.483808$, $-10.1021C_1-989.898C_2+520.426=0$: $C_1=-0.0423597$, $C_2=0.526168$."],
     "answer": "$i(t)=-0.0423597e^{-10.1021t}+0.526168e^{-989.898t}-0.483808\\cos377t+1.38044\\sin377t$",
     "check": "sympy dsolve with $q(0)=\\dot q(0)=0$ reproduces every slide value. The slide does not state $i'(0)=0$. "
              "Steady amplitude $\\sqrt{0.4838^2+1.3804^2}=1.463=\\frac{155}{Z}$, $Z=105.96$ Ω (E2.5). Figure G2.3."},
    {"id": "W3.1", "topic": "T3", "title": "ESA: $R=40$, $L=1$, $C=16\\times10^{-4}$, $E=100\\cos5t$", "stars": 2,
     "srcs": ["ESA Jan-24 s3 3b"],
     "given": "A series circuit has $R=40$ Ω, $L=1$ H, $C=16\\times10^{-4}$ F and $E=100\\cos5t$. Find the charge at any time $t$.",
     "steps": ["$\\frac1C=625$: $Q''+40Q'+625Q=100\\cos5t$.",
               "AE $m^2+40m+625=0$: $m=\\frac{-40\\pm\\sqrt{1600-2500}}{2}=-20\\pm15i$. CF $=e^{-20t}(c_1\\cos15t+c_2\\sin15t)$.",
               "PI $=\\frac{100\\cos5t}{D^2+40D+625}$; $D^2\\to-25$: $\\frac{100\\cos5t}{600+40D}=\\frac52\\cdot\\frac{\\cos5t}{15+D}$.",
               "Rationalise: $\\frac52\\cdot\\frac{(15-D)\\cos5t}{225-D^2}=\\frac52\\cdot\\frac{15\\cos5t+5\\sin5t}{250}$."],
     "answer": "$Q(t)=e^{-20t}(c_1\\cos15t+c_2\\sin15t)+0.15\\cos5t+0.05\\sin5t$",
     "check": "sympy dsolve and checkodesol agree ($\\frac{3\\cos5t+\\sin5t}{20}$). CF roots as in the class 002 pack. Amplitude $0.158=\\frac{100}{5Z}$, $Z=126.5$ Ω."},
    {"id": "W3.2", "topic": "T3", "title": "The same ESA circuit with $Q(0)=I(0)=0$", "stars": 1, "srcs": ["ESA Jan-24 s3 3b"], "flags": [ADD],
     "given": "W3.1 with the circuit uncharged and no current at $t=0$.",
     "steps": ["$Q(0)=c_1+0.15=0$: $c_1=-0.15$.",
               "$Q'(t)=e^{-20t}[(-20c_1+15c_2)\\cos15t+(-20c_2-15c_1)\\sin15t]-0.75\\sin5t+0.25\\cos5t$.",
               "$Q'(0)=-20c_1+15c_2+0.25=3+15c_2+0.25=0$: $c_2=-\\frac{13}{60}=-0.2167$.",
               "$I=Q'=\\frac{\\cos5t-3\\sin5t}{4}+\\frac{e^{-20t}}{12}(79\\sin15t-3\\cos15t)$."],
     "answer": "$Q(t)=-e^{-20t}\\big(0.15\\cos15t+\\tfrac{13}{60}\\sin15t\\big)+0.15\\cos5t+0.05\\sin5t$",
     "check": "sympy dsolve with the two conditions agrees; $I(0)=\\frac14-\\frac{3}{12}=0$. Figure G3.1."},
    {"id": "W3.3", "topic": "T3", "title": "ESA: $R=20$, $L=1$, $C=0.002$, $E=12\\sin10t$", "stars": 2, "srcs": ["ESA Jan-24 s4 3b"],
     "given": "A series circuit has $R=20$ Ω, $L=1$ H, $C=0.002$ F and $E=12\\sin10t$. Find the charge at any time $t$.",
     "steps": ["$\\frac1C=500$: $Q''+20Q'+500Q=12\\sin10t$.",
               "AE $m^2+20m+500=0$: $m=\\frac{-20\\pm\\sqrt{400-2000}}{2}=-10\\pm20i$. CF $=e^{-10t}(c_1\\cos20t+c_2\\sin20t)$.",
               "PI: $D^2\\to-100$: $\\frac{12\\sin10t}{400+20D}=\\frac35\\cdot\\frac{\\sin10t}{20+D}=\\frac35\\cdot\\frac{(20-D)\\sin10t}{400+100}$.",
               "$(20-D)\\sin10t=20\\sin10t-10\\cos10t$, so PI $=\\frac{3(20\\sin10t-10\\cos10t)}{2500}$."],
     "answer": "$Q(t)=e^{-10t}(c_1\\cos20t+c_2\\sin20t)+0.024\\sin10t-0.012\\cos10t$",
     "check": "sympy dsolve and checkodesol agree ($\\frac{6\\sin10t-3\\cos10t}{250}$). Amplitude $0.0268=\\frac{12}{10Z}$, $Z=\\sqrt{400+40^2}=44.7$ Ω."},
    {"id": "W3.4", "topic": "T3", "title": "The same ESA circuit with $Q(0)=I(0)=0$", "stars": 1, "srcs": ["ESA Jan-24 s4 3b"], "flags": [ADD],
     "given": "W3.3 with the circuit uncharged and no current at $t=0$.",
     "steps": ["$Q(0)=c_1-0.012=0$: $c_1=0.012$.",
               "$Q'(0)=-10c_1+20c_2+0.24=0$: $-0.12+20c_2+0.24=0$, $c_2=-0.006$.",
               "$I=Q'=0.24\\cos10t+0.12\\sin10t-e^{-10t}(0.24\\cos20t+0.18\\sin20t)$."],
     "answer": "$Q(t)=e^{-10t}(0.012\\cos20t-0.006\\sin20t)+0.024\\sin10t-0.012\\cos10t$",
     "check": "sympy dsolve with the two conditions agrees; $I(0)=0.24-0.24=0$."},
    {"id": "W3.5", "topic": "T3", "title": "Free discharge: $L=0.25$, $R=250$, $C=2\\times10^{-6}$ (CW P36, homework)", "stars": 2, "srcs": ["CW U2 P36"],
     "given": "$L\\frac{d^2q}{dt^2}+R\\frac{dq}{dt}+\\frac qC=0$ with $L=0.25$ H, $R=250$ Ω, $C=2\\times10^{-6}$ F, $q(0)=0.002$ C, $\\frac{dq}{dt}(0)=0$. Find $q(t)$.",
     "steps": ["Divide by 0.25: $q''+1000q'+2\\times10^6q=0$.",
               "AE: $m=\\frac{-1000\\pm\\sqrt{10^6-8\\times10^6}}{2}=-500\\pm500\\sqrt7\\,i$; $500\\sqrt7=1322.88$ (underdamped).",
               "$q=e^{-500t}(c_1\\cos1322.88t+c_2\\sin1322.88t)$; $q(0)=c_1=0.002$.",
               "$q'(0)=-500c_1+1322.88c_2=0$: $c_2=\\frac{0.002}{\\sqrt7}=0.000756$."],
     "answer": "$q(t)=e^{-500t}(0.002\\cos1322.9t+0.000756\\sin1322.9t)$",
     "check": "sympy dsolve and checkodesol agree. The CW prints $0.0008\\sin1323t$: the same, rounded to one figure. Figure G3.2."},
    {"id": "W4.1", "topic": "T4", "title": "RL circuit: show the given form (CW P34)", "stars": 2, "srcs": ["CW U2 P34"],
     "given": "$L\\frac{di}{dt}+Ri=E\\sin\\omega t$, $i=0$ at $t=0$. Show $i=\\frac{E}{\\sqrt{R^2+L^2\\omega^2}}[\\sin(\\omega t-\\varphi)+e^{-Rt/L}\\sin\\varphi]$, $\\varphi=\\tan^{-1}\\frac{L\\omega}{R}$.",
     "steps": ["AE $Lm+R=0$: $m=-\\frac RL$; CF $=ke^{-Rt/L}$.",
               "PI $=\\frac{E\\sin\\omega t}{R+LD}=\\frac{E(R-LD)\\sin\\omega t}{R^2-L^2D^2}=\\frac{E(R\\sin\\omega t-L\\omega\\cos\\omega t)}{R^2+L^2\\omega^2}$.",
               "Put $R=\\sqrt{R^2+L^2\\omega^2}\\cos\\varphi$, $L\\omega=\\sqrt{R^2+L^2\\omega^2}\\sin\\varphi$: PI $=\\frac{E\\sin(\\omega t-\\varphi)}{\\sqrt{R^2+L^2\\omega^2}}$.",
               "$i(0)=k-\\frac{E\\sin\\varphi}{\\sqrt{R^2+L^2\\omega^2}}=0$, so $k=\\frac{E\\sin\\varphi}{\\sqrt{R^2+L^2\\omega^2}}$."],
     "answer": "$i=\\dfrac{E}{\\sqrt{R^2+L^2\\omega^2}}\\big[\\sin(\\omega t-\\varphi)+e^{-Rt/L}\\sin\\varphi\\big],\\quad \\varphi=\\tan^{-1}\\dfrac{L\\omega}{R}$",
     "check": "sympy dsolve minus this form simplifies to 0. The CW answer line misprints $e^{-Ri/L}\\sin\\varphi\\varphi$. Figure G4.1."},
    {"id": "W4.2", "topic": "T4", "title": "RC circuit with $E=E_0\\cos pt$ (CW P35)", "stars": 2, "srcs": ["CW U2 P35"],
     "given": "$R\\frac{di}{dt}+\\frac iC=\\frac{dE}{dt}$, $E=E_0\\cos pt$, $i=0$ when $t=0$. Solve.",
     "steps": ["$\\frac{dE}{dt}=-E_0p\\sin pt$. AE $Rm+\\frac1C=0$: $m=-\\frac{1}{RC}$; CF $=ke^{-t/(RC)}$.",
               "PI $=\\frac{-E_0p\\sin pt}{RD+\\frac1C}=\\frac{-CE_0p\\sin pt}{1+RCD}=\\frac{-CE_0p(1-RCD)\\sin pt}{1+R^2C^2p^2}$.",
               "$(1-RCD)\\sin pt=\\sin pt-RCp\\cos pt$, so PI $=\\frac{CpE_0(RCp\\cos pt-\\sin pt)}{1+p^2R^2C^2}$.",
               "$i(0)=k+\\frac{CpE_0\\cdot RCp}{1+p^2R^2C^2}=0$: $k=-\\frac{CpE_0\\,pRC}{1+p^2R^2C^2}$."],
     "answer": "$i=\\dfrac{CpE_0}{1+p^2R^2C^2}\\big[RCp\\cos pt-\\sin pt-pRC\\,e^{-t/(RC)}\\big]$",
     "check": "sympy dsolve minus this form simplifies to 0. The CW answer text is garbled ($I+p^2R^2C^2$, $e^{-1/RC}$)."},
]

PYQS = [
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 3, Q3.b", "marks": 6,
     "text": "A series circuit has $R=40\\,\\Omega$, $L=1$ H, $C=16\\times10^{-4}$ F and $E=100\\cos5t$. Find the charge at any time $t$.", "worked": "W3.1"},
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 4, Q3.b", "marks": 6,
     "text": "A series circuit has $R=20\\,\\Omega$, $L=1$ H, $C=0.002$ F and $E=12\\sin10t$. Find the charge at any time $t$.", "worked": "W3.3"},
]

NOTES = [
    {"topic": "T1", "text": "Series LCR circuit: drops $L\\frac{dI}{dt}$, $RI$, $\\frac QC$; Kirchhoff's voltage law: their sum is $E(t)$. With $I=\\frac{dQ}{dt}$: "
     "$LQ''+RQ'+\\frac QC=E(t)$, a second-order linear DE with constant coefficients. Units: H, Ω, F, V, A, C. Conditions $Q(0)$, $I(0)=Q'(0)$. "
     "Differentiating gives $LI''+RI'+\\frac IC=E'(t)$ with $LI'(0)=E(0)-RI(0)-\\frac{Q(0)}{C}$."},
    {"topic": "T2", "text": "Divide by $L$; AE $Lm^2+Rm+\\frac1C=0$. $R^2>\\frac{4L}{C}$ overdamped, $=$ critical, $<$ underdamped "
     "($e^{-Rt/2L}(c_1\\cos\\omega_dt+c_2\\sin\\omega_dt)$). CF = transient, PI = steady state; battery: PI $=CE$. Slide example "
     "($R=8$, $L=2$, $C=0.1$, $E=10$): $Q=1-e^{-2t}(\\cos t+2\\sin t)$, $I=5e^{-2t}\\sin t$."},
    {"topic": "T3", "text": "ESA s3: $Q''+40Q'+625Q=100\\cos5t$, $Q=e^{-20t}(c_1\\cos15t+c_2\\sin15t)+0.15\\cos5t+0.05\\sin5t$. ESA s4: "
     "$Q''+20Q'+500Q=12\\sin10t$, $Q=e^{-10t}(c_1\\cos20t+c_2\\sin20t)+0.024\\sin10t-0.012\\cos10t$. PI by $D^2\\to-\\omega^2$ and rationalising. "
     "CW P36: $q=e^{-500t}(0.002\\cos500\\sqrt7t+0.000756\\sin500\\sqrt7t)$."},
    {"topic": "T4", "text": "RL: $Li'+Ri=E\\sin\\omega t$, $i(0)=0$: $i=\\frac{E}{\\sqrt{R^2+L^2\\omega^2}}[\\sin(\\omega t-\\varphi)+e^{-Rt/L}\\sin\\varphi]$, "
     "$\\tan\\varphi=\\frac{L\\omega}{R}$. RC: $Ri'+\\frac iC=E'$, $E=E_0\\cos pt$: $i=\\frac{CpE_0}{1+p^2R^2C^2}[RCp\\cos pt-\\sin pt-pRCe^{-t/RC}]$."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "The series LCR circuit (slide 014·4, redrawn)", "stars": 2, "srcs": ["S014·4", "T014 00:00:13"],
     "howto": "Source $E(t)$ and switch on the left, resistor $R$ on top, inductor $L$ on the right, capacitor $C$ at the bottom, all in one loop "
              "so the same current $I$ flows through each. The three drops $V_R=RI$, $V_L=L\\frac{dI}{dt}$, $V_C=\\frac QC$ add up to $E(t)$. Schematic, not to scale."},
    {"id": "G2.1", "topic": "T2", "title": "Slide example: $Q(t)$ and $I(t)$ for $R=8$, $L=2$, $C=0.1$, $E=10$", "stars": 2,
     "srcs": ["S014·12"], "flags": [ADD],
     "howto": "The charge (blue) rises from 0 to the steady state $CE=1$ C (grey dashed) with a small overshoot (underdamped, $e^{-2t}$). The current "
              "$5e^{-2t}\\sin t$ (vermilion) starts at 0, peaks near $t=0.46$ s and dies out: a battery drives no steady current through a capacitor."},
    {"id": "G2.2", "topic": "T2", "title": "Damping regimes: $R^2$ against $\\frac{4L}{C}$", "stars": 1, "srcs": ["S014·9", "S014·15"], "flags": [ADD],
     "howto": "Free discharge $Q''+RQ'+Q=0$ ($L=C=1$, so $\\frac{4L}{C}=4$) from $Q(0)=1$, $I(0)=0$. $R=3$ (blue, overdamped) creeps back slowly; "
              "$R=2$ (green dashed, critical) returns fastest without crossing zero; $R=0.5$ (vermilion, underdamped) oscillates inside the "
              "envelope $\\pm e^{-t/4}$ (grey)."},
    {"id": "G2.3", "topic": "T2", "title": "Slide 014·16: current for $E=155\\sin377t$, transient and steady state", "stars": 1,
     "srcs": ["S014·16"], "flags": [ADD],
     "howto": "The full current $i(t)$ (vermilion), the steady state $-0.4838\\cos377t+1.3804\\sin377t$ (grey dashed) and their difference, the transient (green dashed). The fast part "
              "($e^{-989.9t}$) is gone within a few milliseconds; the slow one ($-0.0424e^{-10.1t}$) shifts the curve slightly for a few tenths of a second."},
    {"id": "G3.1", "topic": "T3", "title": "ESA $E=100\\cos5t$ with $Q(0)=I(0)=0$: charge = transient + steady state", "stars": 2,
     "srcs": ["ESA Jan-24 s3 3b"], "flags": [ADD],
     "howto": "The charge $Q(t)$ (blue) is the sum of the transient $-e^{-20t}(0.15\\cos15t+\\frac{13}{60}\\sin15t)$ (green dashed), which is gone by "
              "$t\\approx0.25$ s, and the steady state $0.15\\cos5t+0.05\\sin5t$ (grey dashed, amplitude 0.158 C, period $\\frac{2\\pi}{5}$)."},
    {"id": "G3.2", "topic": "T3", "title": "CW P36: free discharge of the capacitor", "stars": 2, "srcs": ["CW U2 P36"], "flags": [ADD],
     "howto": "$q(t)=e^{-500t}(0.002\\cos1322.9t+0.000756\\sin1322.9t)$ (blue) oscillates with period $\\frac{2\\pi}{1322.9}=4.75$ ms inside the envelope "
              "$\\pm0.00214e^{-500t}$ (grey dashed) and is negligible after about 10 ms."},
    {"id": "G4.1", "topic": "T4", "title": "RL circuit (CW P34): current with its transient", "stars": 1, "srcs": ["CW U2 P34"], "flags": [ADD],
     "howto": "Illustrative values $E=10$ V, $R=2$ Ω, $L=1$ H, $\\omega=4$ rad/s ($\\varphi=\\tan^{-1}2$). The current (vermilion) starts at 0; the steady "
              "state $\\frac{E}{\\sqrt{R^2+L^2\\omega^2}}\\sin(\\omega t-\\varphi)$ (grey dashed) lags the source by $\\varphi$; the difference is the "
              "transient $\\frac{E\\sin\\varphi}{\\sqrt{R^2+L^2\\omega^2}}e^{-Rt/L}$ (green dashed), time constant $\\frac LR=0.5$ s."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "From circuit data to $Q(t)$ and $I(t)$", "stars": 2,
     "srcs": ["S014·8", "S014·9", "S014·10", "S014·11", "S014·12", "T014 00:04:57", "T014 00:10:31"], "layout": "straight", "maxw": "150mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$R$, $L$, $C$, $E(t)$; $Q(0)$, $I(0)$", "sub": "units: Ω, H, F, V"},
         {"kind": "step", "n": 1, "title": "LCR equation, divided by $L$", "fx": "$Q''+\\frac RLQ'+\\frac1{LC}Q=\\frac{E(t)}{L}$"},
         {"kind": "step", "n": 2, "title": "CF from the AE (transient)", "fx": "$m^2+\\frac RLm+\\frac1{LC}=0$"},
         {"kind": "step", "n": 3, "title": "PI (steady state)", "fx": "constant: $D\\to0$; sinusoid: $D^2\\to-\\omega^2$"},
         {"kind": "step", "n": 4, "title": "Use $Q(0)$, then $I(0)=Q'(0)$", "fx": "two equations for $c_1$, $c_2$"},
         {"kind": "result", "title": "$Q(t)=\\text{CF}+\\text{PI}$, $I(t)=Q'(t)$", "fx": "no conditions: keep $c_1$, $c_2$"}]},
     "remark": "Steps 2 and 3 are the class 002 and 003–004 methods.", "trap": "Divide $E(t)$ by $L$ too."},
    {"id": "F2.1", "topic": "T2", "title": "Which transient? Compare $R^2$ with $\\frac{4L}{C}$", "stars": 1, "flags": [ADD],
     "srcs": ["S014·9", "S014·15"], "layout": "route", "maxw": "160mm",
     "spec": {"question": "How does $R^2$ compare with $\\frac{4L}{C}$?",
              "rows": [{"title": "$R^2>\\frac{4L}{C}$: real distinct roots", "sub": "$c_1e^{m_1t}+c_2e^{m_2t}$; slide 014·13", "kw": "overdamped"},
                       {"title": "$R^2=\\frac{4L}{C}$: equal roots", "sub": "$(c_1+c_2t)e^{-Rt/2L}$", "kw": "critical"},
                       {"title": "$R^2<\\frac{4L}{C}$: complex roots", "sub": "$e^{-Rt/2L}(c_1\\cos\\omega_dt+c_2\\sin\\omega_dt)$; slide 014·8, both ESA", "kw": "underdamped"}]},
     "remark": "All three decay; only the underdamped one oscillates."},
    {"id": "F3.1", "topic": "T3", "title": "ESA: $Q''+40Q'+625Q=100\\cos5t$", "stars": 2, "srcs": ["ESA Jan-24 s3 3b"], "layout": "streams", "maxw": "160mm",
     "spec": {"left": [{"kind": "given", "title": "CF", "sub": "AE $m^2+40m+625=0$"},
                       {"kind": "step", "n": 1, "title": "Roots", "fx": "$m=-20\\pm15i$"},
                       {"kind": "step", "n": 2, "title": "Transient", "fx": "$e^{-20t}(c_1\\cos15t+c_2\\sin15t)$"}],
              "right": [{"kind": "given", "title": "PI", "sub": "$D^2\\to-25$"},
                        {"kind": "step", "n": 1, "title": "Lone $D$ left", "fx": "$\\frac52\\cdot\\frac{\\cos5t}{15+D}$"},
                        {"kind": "step", "n": 2, "title": "Rationalise", "fx": "$\\frac{15\\cos5t+5\\sin5t}{100}$"}],
              "then": [{"kind": "result", "title": "$Q=e^{-20t}(c_1\\cos15t+c_2\\sin15t)+0.15\\cos5t+0.05\\sin5t$", "fx": "W3.1"}]},
     "remark": "ESA s4 is the same pattern: $m=-10\\pm20i$, PI $=0.024\\sin10t-0.012\\cos10t$ (W3.3)."},
    {"id": "F3.2", "topic": "T3", "title": "Are initial conditions given?", "stars": 2, "srcs": ["ESA Jan-24 s3 3b", "ESA Jan-24 s4 3b", "S014·11"],
     "layout": "fork", "maxw": "150mm",
     "spec": {"before": [{"kind": "given", "title": "$Q=\\text{CF}+\\text{PI}$ found", "sub": "two constants $c_1$, $c_2$"}],
              "question": "Are $Q(0)$ and $I(0)$ given?",
              "no": {"kind": "step", "n": 1, "title": "Stop: general solution", "fx": "$c_1$, $c_2$ arbitrary (both ESA)"},
              "yes": {"kind": "step", "n": 1, "title": "Fix $c_1$, $c_2$", "fx": "$Q(0)$, then $Q'(0)=I(0)$"},
              "after": [{"kind": "result", "title": "Charge at any time $t$", "fx": "$I=\\frac{dQ}{dt}$ if the current is asked"}]},
     "remark": "W3.2 and W3.4 show the “yes” route for both ESA circuits."},
    {"id": "F4.1", "topic": "T4", "title": "RL circuit, $L\\frac{di}{dt}+Ri=E\\sin\\omega t$", "stars": 2, "srcs": ["CW U2 P34"], "layout": "straight", "maxw": "150mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$i(0)=0$", "sub": "first-order, one constant"},
         {"kind": "step", "n": 1, "title": "CF", "fx": "$ke^{-Rt/L}$"},
         {"kind": "step", "n": 2, "title": "PI by rationalising", "fx": "$\\frac{E(R\\sin\\omega t-L\\omega\\cos\\omega t)}{R^2+L^2\\omega^2}$"},
         {"kind": "step", "n": 3, "title": "Amplitude–phase form", "fx": "$\\frac{E\\sin(\\omega t-\\varphi)}{\\sqrt{R^2+L^2\\omega^2}}$, $\\tan\\varphi=\\frac{L\\omega}{R}$"},
         {"kind": "step", "n": 4, "title": "Use $i(0)=0$", "fx": "$k=\\frac{E\\sin\\varphi}{\\sqrt{R^2+L^2\\omega^2}}$"},
         {"kind": "result", "title": "Given form shown", "fx": "$i=\\frac{E}{\\sqrt{R^2+L^2\\omega^2}}[\\sin(\\omega t-\\varphi)+e^{-Rt/L}\\sin\\varphi]$"}]},
     "remark": "The RC circuit (W4.2) follows the same five steps with $m=-\\frac{1}{RC}$."},
]

COMPARISONS = [
    {"id": "C1.1", "topic": "T1", "title": "The three circuit elements", "srcs": ["S014·4", "S014·5"],
     "head": ["Element", "Symbol, unit", "Voltage drop", "In terms of $Q$"],
     "rows": [["Inductor", "$L$, henry (H)", "$L\\frac{dI}{dt}$", "$L\\frac{d^2Q}{dt^2}$"],
              ["Resistor", "$R$, ohm (Ω)", "$RI$", "$R\\frac{dQ}{dt}$"],
              ["Capacitor", "$C$, farad (F)", "$\\frac QC$", "$\\frac QC$"],
              ["Source", "$E(t)$, volt (V)", "supplies $E(t)$", "right-hand side"]]},
    {"id": "C2.1", "topic": "T2", "title": "Damping regimes", "srcs": ["S014·9", "S014·15", "ESA Jan-24 s3 3b"], "flags": [ADD],
     "head": ["Test", "Roots", "Transient", "Example"],
     "rows": [["$R^2>\\frac{4L}{C}$", "real, distinct, negative", "$c_1e^{m_1t}+c_2e^{m_2t}$", "slide 014·13: $10^4>400$"],
              ["$R^2=\\frac{4L}{C}$", "equal, $-\\frac{R}{2L}$", "$(c_1+c_2t)e^{-Rt/2L}$", "$R=2$, $L=C=1$ (G2.2)"],
              ["$R^2<\\frac{4L}{C}$", "$-\\frac{R}{2L}\\pm i\\omega_d$", "$e^{-Rt/2L}(c_1\\cos\\omega_dt+c_2\\sin\\omega_dt)$", "slide 014·8; ESA s3, s4; CW P36"]]},
    {"id": "C2.2", "topic": "T2", "title": "Every circuit problem of this class, side by side", "srcs": ["S014·8", "S014·13", "ESA Jan-24 s3 3b", "ESA Jan-24 s4 3b", "CW U2 P36"],
     "head": ["Problem", "Normalised equation", "Roots", "PI (steady state)"],
     "rows": [["Slide 014·8", "$Q''+4Q'+5Q=5$", "$-2\\pm i$", "$1$"],
              ["Slide 014·13", "$\\ddot q+1000\\dot q+10^4q=1550\\sin377t$", "$-10.10$, $-989.9$", "$-0.00128\\sin377t-0.00366\\cos377t$"],
              ["ESA s3 3b", "$Q''+40Q'+625Q=100\\cos5t$", "$-20\\pm15i$", "$0.15\\cos5t+0.05\\sin5t$"],
              ["ESA s4 3b", "$Q''+20Q'+500Q=12\\sin10t$", "$-10\\pm20i$", "$0.024\\sin10t-0.012\\cos10t$"],
              ["CW P36", "$q''+1000q'+2\\times10^6q=0$", "$-500\\pm500\\sqrt7i$", "0 (free)"]]},
    {"id": "C4.1", "topic": "T4", "title": "RL, RC and LCR circuits", "srcs": ["CW U2 P34", "CW U2 P35", "S014·6"],
     "head": ["Circuit", "Equation", "Order", "Transient"],
     "rows": [["RL", "$L\\frac{di}{dt}+Ri=E(t)$", "1", "$e^{-Rt/L}$"],
              ["RC", "$R\\frac{di}{dt}+\\frac iC=\\frac{dE}{dt}$", "1", "$e^{-t/(RC)}$"],
              ["LCR", "$L\\frac{d^2Q}{dt^2}+R\\frac{dQ}{dt}+\\frac QC=E(t)$", "2", "by $R^2$ vs $\\frac{4L}{C}$"]]},
]

SYMBOLS = [
    {"sym": "$L$", "name": "Inductance", "meaning": "Henries (H)", "unit": "H", "where": "E1.1, E1.3"},
    {"sym": "$R$", "name": "Resistance", "meaning": "Ohms (Ω)", "unit": "Ω", "where": "E1.1, E1.3"},
    {"sym": "$C$", "name": "Capacitance", "meaning": "Farads (F); not an integration constant", "unit": "F", "where": "E1.1, E1.3"},
    {"sym": "$E(t)$", "name": "Electromotive force", "meaning": "Source voltage; $E$, $E_0$ also amplitudes (CW P34–35)", "unit": "V", "where": "E1.2, E4.1"},
    {"sym": "$Q$, $q$", "name": "Charge", "meaning": "On the capacitor; slides 13–16 write $q$", "unit": "C (coulomb)", "where": "E1.3"},
    {"sym": "$I$, $i$", "name": "Current", "meaning": "$\\frac{dQ}{dt}$", "unit": "A", "where": "E1.2, E1.5"},
    {"sym": "$V_L$, $V_R$, $V_C$", "name": "Voltage drops", "meaning": "Also $E_L$, $E_R$, $E_C$ on slide 014·5", "unit": "V", "where": "E1.1, E1.2"},
    {"sym": "$\\dot q$, $\\ddot q$", "name": "Time derivatives", "meaning": "$\\frac{dq}{dt}$, $\\frac{d^2q}{dt^2}$ (slides 13–16)", "where": "E1.3"},
    {"sym": "$c_1$, $c_2$", "name": "Arbitrary constants", "meaning": "Of $Q$; slide 014·16's $C_1$, $C_2$ are constants of $i$", "where": "E2.2"},
    {"sym": "$\\omega_d$", "name": "Damped frequency", "meaning": "$\\sqrt{\\frac1{LC}-\\frac{R^2}{4L^2}}$", "unit": "rad/s", "where": "E2.3"},
    {"sym": "$\\omega$, $p$", "name": "Source frequency", "meaning": "In $\\sin\\omega t$, $\\cos pt$", "unit": "rad/s", "where": "E2.5, E4.1, E4.2"},
    {"sym": "$Z$", "name": "Impedance", "meaning": "$\\sqrt{R^2+(L\\omega-\\frac1{C\\omega})^2}$", "unit": "Ω", "where": "E2.5"},
    {"sym": "$\\varphi$", "name": "Phase angle", "meaning": "$\\tan^{-1}\\frac{L\\omega}{R}$ (RL circuit)", "where": "E4.1"},
]

KEYWORDS = [
    {"term": "LCR (RLC) circuit", "meaning": "$L$, $R$, $C$ and $E(t)$ in series.", "topic": "T1"},
    {"term": "Voltage drop", "meaning": "$L\\frac{dI}{dt}$, $RI$, $\\frac QC$.", "topic": "T1"},
    {"term": "Kirchhoff's voltage law", "meaning": "Sum of drops = EMF.", "topic": "T1"},
    {"term": "Ohm's law", "meaning": "$E_R=RI$.", "topic": "T1"},
    {"term": "$I=\\frac{dQ}{dt}$", "meaning": "Current is the rate of change of charge.", "topic": "T1"},
    {"term": "LCR equation", "meaning": "$LQ''+RQ'+\\frac QC=E(t)$.", "topic": "T1"},
    {"term": "Current equation", "meaning": "$LI''+RI'+\\frac IC=E'(t)$.", "topic": "T1"},
    {"term": "Initial conditions", "meaning": "$Q(0)$ and $I(0)$.", "topic": "T1"},
    {"term": "Transient", "meaning": "CF; decays.", "topic": "T2"},
    {"term": "Steady state", "meaning": "PI; remains.", "topic": "T2"},
    {"term": "$CE$", "meaning": "Final charge for a battery.", "topic": "T2"},
    {"term": "Overdamped", "meaning": "$R^2>\\frac{4L}{C}$.", "topic": "T2"},
    {"term": "Critically damped", "meaning": "$R^2=\\frac{4L}{C}$.", "topic": "T2"},
    {"term": "Underdamped", "meaning": "$R^2<\\frac{4L}{C}$, decaying oscillation.", "topic": "T2"},
    {"term": "Damped frequency", "meaning": "$\\omega_d=\\sqrt{\\frac1{LC}-\\frac{R^2}{4L^2}}$.", "topic": "T2"},
    {"term": "Impedance", "meaning": "$Z=\\sqrt{R^2+(L\\omega-\\frac1{C\\omega})^2}$.", "topic": "T2"},
    {"term": "Resonance", "meaning": "Largest response near $\\omega=\\frac1{\\sqrt{LC}}$.", "topic": "T2"},
    {"term": "Free discharge", "meaning": "$E=0$; charge = CF only.", "topic": "T3"},
    {"term": "RL circuit", "meaning": "$Li'+Ri=E$; transient $e^{-Rt/L}$.", "topic": "T4"},
    {"term": "RC circuit", "meaning": "$Ri'+\\frac iC=E'$; transient $e^{-t/RC}$.", "topic": "T4"},
    {"term": "Time constant", "meaning": "$\\frac LR$ or $RC$.", "topic": "T4"},
    {"term": "Phase lag", "meaning": "$\\varphi=\\tan^{-1}\\frac{L\\omega}{R}$.", "topic": "T4"},
]

RAPID = [
    {"q": "Voltage drop across an inductor?", "a": "$L\\frac{dI}{dt}$."},
    {"q": "Across a capacitor?", "a": "$\\frac QC$."},
    {"q": "Kirchhoff's voltage law for the series circuit?", "a": "$L\\frac{dI}{dt}+RI+\\frac QC=E(t)$."},
    {"q": "The LCR equation in $Q$?", "a": "$L\\frac{d^2Q}{dt^2}+R\\frac{dQ}{dt}+\\frac QC=E(t)$."},
    {"q": "Its order and type?", "a": "Second-order linear, constant coefficients, non-homogeneous."},
    {"q": "How many initial conditions, and which?", "a": "Two: $Q(0)$ and $I(0)=Q'(0)$."},
    {"q": "Overdamped when?", "a": "$R^2>\\frac{4L}{C}$."},
    {"q": "Underdamped transient?", "a": "$e^{-Rt/2L}(c_1\\cos\\omega_dt+c_2\\sin\\omega_dt)$."},
    {"q": "PI for a battery $E$?", "a": "$CE$ (charge); the current tends to 0."},
    {"q": "Slide example $R=8$, $L=2$, $C=0.1$, $E=10$: $I(t)$?", "a": "$5e^{-2t}\\sin t$."},
    {"q": "…and $Q(t)$?", "a": "$1-e^{-2t}(\\cos t+2\\sin t)$."},
    {"q": "ESA $R=40$, $L=1$, $C=16\\times10^{-4}$, $E=100\\cos5t$: roots?", "a": "$-20\\pm15i$."},
    {"q": "…its steady-state charge?", "a": "$0.15\\cos5t+0.05\\sin5t$."},
    {"q": "ESA $R=20$, $L=1$, $C=0.002$, $E=12\\sin10t$: roots?", "a": "$-10\\pm20i$."},
    {"q": "…its steady-state charge?", "a": "$0.024\\sin10t-0.012\\cos10t$."},
    {"q": "CW P36 damped frequency?", "a": "$500\\sqrt7\\approx1322.9$ rad/s."},
    {"q": "RL circuit transient?", "a": "$e^{-Rt/L}$."},
    {"q": "RC circuit equation in $i$?", "a": "$R\\frac{di}{dt}+\\frac iC=\\frac{dE}{dt}$."},
]

MNEMONICS = [
    "<i>“L-D-I, R-I, Q over C.”</i> The three drops in the order of the slide: $L\\frac{dI}{dt}$, $RI$, $\\frac QC$ (study aid).",
]

TOP_FACTS = [
    "$LQ''+RQ'+\\frac QC=E(t)$, $I=\\frac{dQ}{dt}$; divide by $L$ (and $E$ too) before the AE.",
    "$Q(0)$ gives $c_1$; differentiate $Q$, then $I(0)$ gives $c_2$.",
    "$R^2\\gtrless\\frac{4L}{C}$: over / critical / underdamped; the CF always decays (transient), the PI stays (steady state).",
    "Battery: PI $=CE$. Slide: $Q=1-e^{-2t}(\\cos t+2\\sin t)$, $I=5e^{-2t}\\sin t$.",
    "ESA s3: $Q=e^{-20t}(c_1\\cos15t+c_2\\sin15t)+0.15\\cos5t+0.05\\sin5t$.",
    "ESA s4: $Q=e^{-10t}(c_1\\cos20t+c_2\\sin20t)+0.024\\sin10t-0.012\\cos10t$.",
    "No initial conditions in the question: keep $c_1$, $c_2$.",
    "RL: $i=\\frac{E}{\\sqrt{R^2+L^2\\omega^2}}[\\sin(\\omega t-\\varphi)+e^{-Rt/L}\\sin\\varphi]$; RC: transient $e^{-t/RC}$.",
]
TOP_FORMULAS = ["E1.2", "E1.3", "E1.4", "E2.1", "E2.2", "E2.4", "E4.1"]
