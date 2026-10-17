"""Class 015: applications of linear differential equations — simple harmonic oscillation."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "The spring–mass model and simple harmonic motion",
     "overview": "A mass $m$ hangs from a spring of constant $k$. At equilibrium the weight balances the spring force, $mg=ks$. "
                 "Displaced by $x$, the net force is $mg-k(s+x)=-kx$, so Newton's second law gives $\\frac{d^2x}{dt^2}+\\frac kmx=0$, "
                 "a homogeneous LDE with constant coefficients. Its auxiliary roots are $\\pm i\\omega$ with $\\omega=\\sqrt{k/m}$, so "
                 "$x=c_1\\cos\\omega t+c_2\\sin\\omega t=A\\cos(\\omega t+\\varphi)$: simple harmonic motion with amplitude $A$, period "
                 "$T=\\frac{2\\pi}\\omega$ and frequency $\\frac1T$."},
    {"id": "T2", "title": "Solving spring problems",
     "overview": "Every spring problem follows one recipe: get $m$ from the weight ($m=W/g$) and $k$ from the static stretch "
                 "($k=W/s$), write $\\ddot x+\\omega^2x=0$, fix $c_1$ from the initial position and $c_2$ from the initial velocity, "
                 "then report the amplitude, period, frequency and maximum velocity $A\\omega$. Units must agree (feet with "
                 "$g=32$ ft/s², metres with $g=9.8$ m/s²), and positive $x$ is downward. Class 015 works a 12 lb and an 8 lb weight; "
                 "the class-work sheet adds a 10 kg body in SI units."},
    {"id": "T3", "title": "The damped oscillator",
     "overview": "A resistance proportional to velocity, $2\\lambda mn\\dot x$, adds a first-derivative term: "
                 "$\\ddot x+2\\lambda n\\dot x+n^2x=0$. For $0<\\lambda<1$ the roots are $-\\lambda n\\pm in\\sqrt{1-\\lambda^2}$ and the "
                 "motion is an oscillation whose amplitude decays like $e^{-\\lambda nt}$. Slides 015·15–16 solve it from "
                 "$x(0)=0$, $\\dot x(0)=x_0$. It is the mechanical twin of the LCR circuit of class 014."},
]

DEFS = [
    {"topic": "T1", "term": "Equilibrium position", "text": "The position where the downward pull of gravity equals the upward restoring force of the spring: $mg=ks$.",
     "srcs": ["S015·5", "T015 00:02:29"]},
    {"topic": "T1", "term": "Hooke's law", "text": "The restoring force is proportional to the displacement and acts in the opposite direction: $-k(s+x)$.",
     "srcs": ["S015·6", "T015 00:03:37"]},
    {"topic": "T1", "term": "Spring (force) constant $k$", "text": "The proportionality constant in Hooke's law; force per unit stretch (lb/ft or N/m).",
     "srcs": ["S015·6", "T015 00:03:55"]},
    {"topic": "T1", "term": "Simple harmonic motion", "text": "The motion $x(t)=c_1\\cos\\omega t+c_2\\sin\\omega t$ of the mass about its equilibrium position.",
     "srcs": ["S015·8", "T015 00:06:46"]},
    {"topic": "T1", "term": "Angular frequency $\\omega$", "text": "$\\omega=\\sqrt{k/m}$, from writing the equation as $\\frac{d^2x}{dt^2}+\\omega^2x=0$.",
     "srcs": ["S015·7", "T015 00:05:33"]},
    {"topic": "T1", "term": "Amplitude $A$", "text": "“$A$ is called amplitude of the motion and gives the maximum displacement of the mass from its equilibrium position.”",
     "srcs": ["S015·9", "T015 00:07:22"]},
    {"topic": "T1", "term": "Period $T$", "text": "The time taken for one complete oscillation: $T=\\frac{2\\pi}\\omega=2\\pi\\sqrt{\\frac mk}$.",
     "srcs": ["S015·9", "T015 00:07:40"]},
    {"topic": "T1", "term": "Natural frequency $f$", "text": "The reciprocal of the period: $f=\\frac1T=\\frac\\omega{2\\pi}$ oscillations per second.",
     "srcs": ["S015·9", "T015 00:07:58"]},
    {"topic": "T2", "term": "Free motion", "text": "Motion with no external force and no damping: $\\ddot x+\\frac kmx=0$.",
     "srcs": ["S015·10", "T015 00:08:48"]},
    {"topic": "T3", "term": "Damping (resistive) force", "text": "A force opposing the motion and proportional to the velocity; on slide 015·15 its magnitude is $2\\lambda mn\\dot x$.",
     "srcs": ["S015·15"]},
]

STATEMENTS = [
    {"topic": "T1", "text": "From Hooke's Law, the restoring force is given by $-k(s+x)$ (the restoring force is proportional to displacement and "
                            "acts in the opposite direction of displacement). By Newton's Second Law, the forces acting on the system $=m.a$, "
                            "i.e, $mg+(-k(s+x))=m.a$.", "srcs": ["S015·6"]},
    {"topic": "T1", "text": "But at equilibrium, $mg=ks$. Therefore, $ma=-kx$. … $\\frac{d^2x}{dt^2}+\\frac kmx=0$. This equation can also be written as "
                            "$\\frac{d^2x}{dt^2}+\\omega^2x=0$ where $\\omega=\\sqrt{\\frac km}$ called angular frequency.", "srcs": ["S015·7"]},
    {"topic": "T1", "text": "The general solution of the differential equation is given by $x(t)=c_1\\cos\\omega t+c_2\\sin\\omega t$. $x(t)$ gives the position "
                            "of the mass at any instant. The motion of the mass is Simple Harmonic Motion.", "srcs": ["S015·8"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Equilibrium condition", "tex": r"mg=ks",
     "gives": "$k=\\frac{mg}{s}=\\frac Ws$ from a static stretch $s$.", "when": "The mass hangs at rest.",
     "units": "$W$ in lb with $s$ in ft (lb/ft); $W$ in N with $s$ in m (N/m).", "note": "$W=mg$ is the weight.",
     "stars": 2, "srcs": ["S015·5", "S015·7", "S015·11", "T015 00:02:29"]},
    {"id": "E1.2", "topic": "T1", "title": "Newton's second law for the hanging mass", "tex": r"mg-k(s+x)=m\frac{d^2x}{dt^2}\ \Longrightarrow\ m\frac{d^2x}{dt^2}=-kx",
     "gives": "The force balance; $mg$ and $ks$ cancel.", "when": "$x$ measured from equilibrium, downward positive.",
     "stars": 1, "srcs": ["S015·6", "S015·7", "T015 00:04:30", "T015 00:05:03"]},
    {"id": "E1.3", "topic": "T1", "title": "Equation of simple harmonic motion", "tex": r"\frac{d^2x}{dt^2}+\frac kmx=0,\qquad\frac{d^2x}{dt^2}+\omega^2x=0,\quad\omega=\sqrt{\frac km}",
     "gives": "The model of the undamped, unforced spring.", "when": "No damping, no external force.",
     "note": "A homogeneous LDE with constant coefficients: AE $m^2+\\omega^2=0$ (class 002, complex roots).",
     "stars": 2, "srcs": ["S015·7", "T015 00:05:15", "T015 00:05:33"]},
    {"id": "E1.4", "topic": "T1", "title": "General solution", "tex": r"x(t)=c_1\cos\omega t+c_2\sin\omega t",
     "gives": "The position at any instant.", "when": "Roots $\\pm i\\omega$.", "note": "$c_1=x(0)$, $c_2=\\frac{\\dot x(0)}\\omega$.",
     "stars": 2, "srcs": ["S015·8", "T015 00:06:28", "T015 00:06:46"]},
    {"id": "E1.5", "topic": "T1", "title": "Amplitude–phase form", "tex": r"x(t)=A\cos(\omega t+\varphi),\quad c_1=A\cos\varphi,\ c_2=-A\sin\varphi,\quad A=\sqrt{c_1^2+c_2^2},\ \tan\varphi=-\frac{c_2}{c_1}",
     "gives": "Amplitude and phase from $c_1$, $c_2$.", "when": "After the constants are known.",
     "note": "Pick the quadrant of $\\varphi$ from the signs of $\\cos\\varphi=\\frac{c_1}A$ and $\\sin\\varphi=-\\frac{c_2}A$.",
     "stars": 2, "srcs": ["S015·8", "T015 00:07:05"]},
    {"id": "E1.6", "topic": "T1", "title": "Period and natural frequency", "tex": r"T=\frac{2\pi}{\omega}=2\pi\sqrt{\frac mk},\qquad f=\frac1T=\frac{\omega}{2\pi}=\frac1{2\pi}\sqrt{\frac km}",
     "gives": "Seconds per oscillation; oscillations per second.", "when": "Undamped motion.",
     "note": "The lecturer: “you should remember all these formulae”. The last form of $f$ is added for clarity.",
     "stars": 2, "srcs": ["S015·9", "T015 00:07:40", "T015 00:07:58"]},
    {"id": "E1.7", "topic": "T1", "title": "Maximum velocity", "tex": r"\dot x=-A\omega\sin(\omega t+\varphi),\qquad v_{\max}=A\omega",
     "gives": "The greatest speed, reached at the equilibrium position.", "when": "Any SHM.", "note": "Maximum acceleration is $A\\omega^2$ (added for clarity).",
     "stars": 2, "srcs": ["S015·22", "CW U2 P37"]},
    {"id": "E2.1", "topic": "T2", "title": "Mass from weight", "tex": r"m=\frac Wg,\qquad g=32\ \text{ft/s}^2\ \text{or}\ 9.8\ \text{m/s}^2",
     "gives": "Mass in slugs (from lb) or kg.", "when": "The weight is given in pounds or kilogram-weight.",
     "note": "A 12 lb weight has $m=\\frac{12}{32}=\\frac38$ slug; a body of 10 kg has $m=10$ kg.",
     "stars": 2, "srcs": ["S015·11", "S015·18", "T015 00:10:05"]},
    {"id": "E2.2", "topic": "T2", "title": "Constants from the initial conditions", "tex": r"c_1=x(0),\qquad c_2=\frac{\dot x(0)}{\omega}",
     "gives": "The particular motion.", "when": "Downward positive: pulled down $d$ → $x(0)=+d$; raised $d$ → $x(0)=-d$; upward velocity $v$ → $\\dot x(0)=-v$; released → $\\dot x(0)=0$.",
     "stars": 2, "srcs": ["S015·13", "S015·14", "S015·20", "T015 00:14:07", "T015 00:14:24"]},
    {"id": "E3.1", "topic": "T3", "title": "Damped oscillator", "tex": r"m\ddot x+2\lambda mn\dot x+mn^2x=0\ \Longrightarrow\ \ddot x+2\lambda n\dot x+n^2x=0",
     "gives": "The model with a resistance $2\\lambda mn\\dot x$.", "when": "Restoring force $mn^2x$ (so $n=\\sqrt{k/m}$).",
     "stars": 1, "srcs": ["S015·15"]},
    {"id": "E3.2", "topic": "T3", "title": "Roots and damped frequency", "tex": r"r=-\lambda n\pm in\sqrt{1-\lambda^2},\qquad\omega_d=n\sqrt{1-\lambda^2}",
     "gives": "The underdamped CF $e^{-\\lambda nt}(A\\cos\\omega_dt+B\\sin\\omega_dt)$.", "when": "$0<\\lambda<1$.",
     "note": "Slide 015·16 calls $\\omega_d$ simply $\\omega$.",
     "stars": 1, "srcs": ["S015·16"]},
    {"id": "E3.3", "topic": "T3", "title": "Damped motion from $x(0)=0$, $\\dot x(0)=x_0$", "tex": r"x(t)=\frac{x_0}{n\sqrt{1-\lambda^2}}\,e^{-\lambda nt}\sin\!\left(n\sqrt{1-\lambda^2}\,t\right)",
     "gives": "The slide's boxed answer.", "when": "$0<\\lambda<1$.", "note": "Checked by substitution and both initial conditions (sympy).",
     "stars": 1, "srcs": ["S015·16"]},
]

POINTS = [
    {"topic": "T1", "text": "Two forces act on the mass: gravity $mg$ (down) and the restoring force $-k(s+x)$; at equilibrium $mg=ks$, so only $-kx$ is left.", "stars": 2,
     "srcs": ["S015·6", "S015·7", "T015 00:03:37", "T015 00:05:03"]},
    {"topic": "T1", "text": "$x$ is measured from the equilibrium position, not from the natural length; that is why $mg$ disappears from the equation.", "stars": 2,
     "srcs": ["S015·5", "T015 00:03:13"]},
    {"topic": "T1", "text": "The equation is homogeneous with constant coefficients; its roots $\\pm i\\omega$ are purely imaginary, so the solution is the CF alone (no PI).", "stars": 2,
     "srcs": ["T015 00:05:53", "T015 00:06:10", "T015 00:06:28"]},
    {"topic": "T1", "text": "“You should remember all these formulae”: $\\omega=\\sqrt{k/m}$, $A=\\sqrt{c_1^2+c_2^2}$, $T=2\\pi\\sqrt{m/k}$, $f=\\frac\\omega{2\\pi}$.", "stars": 2,
     "srcs": ["S015·9", "T015 00:07:58"]},
    {"topic": "T1", "text": "The period does not depend on the amplitude or on how the motion starts, only on $m$ and $k$.", "stars": 1,
     "srcs": ["S015·9"], "flags": [ADD]},
    {"topic": "T2", "text": "Use the static data first: the weight gives $m=W/g$, and the stretch it causes gives $k=W/s$. The later data (pulled down, velocity) fix $c_1$, $c_2$.", "stars": 2,
     "srcs": ["S015·11", "T015 00:09:25"]},
    {"topic": "T2", "text": "Convert inches to feet (12 in = 1 ft) before using $g=32$ ft/s²: 6 in = 0.5 ft, 4 in = $\\frac13$ ft, 5 in = $\\frac5{12}$ ft.", "stars": 2,
     "srcs": ["S015·11", "S015·13", "S015·20", "T015 00:10:47"]},
    {"topic": "T2", "text": "Downward is positive. An upward velocity of 2 ft/s is $\\dot x(0)=-2$; a mass raised 5 in has $x(0)=-\\frac5{12}$ ft.", "stars": 2,
     "srcs": ["S015·14", "S015·20", "T015 00:14:07", "T015 00:14:24"]},
    {"topic": "T2", "text": "Differentiate $x(t)$ before using a velocity condition: $\\dot x=-c_1\\omega\\sin\\omega t+c_2\\omega\\cos\\omega t$, so $\\dot x(0)=c_2\\omega$.", "stars": 2,
     "srcs": ["S015·13", "T015 00:13:31"]},
    {"topic": "T2", "text": "Released from rest means $\\dot x(0)=0$, so $c_2=0$ and $x=x(0)\\cos\\omega t$; the amplitude is then $|x(0)|$.", "stars": 2,
     "srcs": ["S015·20", "S015·21", "CW U2 P37"]},
    {"topic": "T2", "text": "The maximum velocity $A\\omega$ is reached when the mass passes through equilibrium.", "stars": 2,
     "srcs": ["S015·22", "CW U2 P37"], "flags": [ADD]},
    {"topic": "T3", "text": "A resistance proportional to velocity adds the term $2\\lambda n\\dot x$; for $0<\\lambda<1$ the mass still oscillates, but inside the envelope $\\pm Ce^{-\\lambda nt}$.", "stars": 1,
     "srcs": ["S015·15", "S015·16"]},
    {"topic": "T3", "text": "Damping lowers the frequency: $\\omega_d=n\\sqrt{1-\\lambda^2}<n$.", "stars": 1, "srcs": ["S015·16"], "flags": [ADD]},
    {"topic": "T3", "text": "With $\\lambda=1$ (critical) or $\\lambda>1$ (overdamped) the roots are real and the mass returns to equilibrium without oscillating.", "stars": 1,
     "srcs": ["S015·16"], "flags": [ADD]},
]

WHY = [
    {"topic": "T1", "q": "Why does gravity not appear in $\\ddot x+\\frac kmx=0$?",
     "a": "Because $x$ is measured from equilibrium, where $mg=ks$ already. In $mg-k(s+x)$ the two constant forces cancel and only $-kx$ is left.",
     "srcs": ["S015·7", "T015 00:05:03"]},
    {"topic": "T1", "q": "Why are the motions sinusoidal?",
     "a": "The auxiliary equation $m^2+\\omega^2=0$ has roots $\\pm i\\omega$ with zero real part, so the CF is $c_1\\cos\\omega t+c_2\\sin\\omega t$: no growth and no decay.",
     "srcs": ["T015 00:06:28", "S015·8"]},
    {"topic": "T2", "q": "Why is an upward velocity negative?",
     "a": "The deck takes downward displacement as positive; a velocity in the opposite (upward) direction therefore carries a minus sign.",
     "srcs": ["T015 00:14:07", "T015 00:14:24", "S015·20"]},
    {"topic": "T3", "q": "Why is the damped motion called a twin of the LCR circuit?",
     "a": "$m\\ddot x+c\\dot x+kx=F(t)$ and $L\\ddot Q+R\\dot Q+\\frac QC=E(t)$ are the same equation with $m\\leftrightarrow L$, $c\\leftrightarrow R$, $k\\leftrightarrow\\frac1C$ (table C1.2).",
     "srcs": ["S015·4", "T015 00:00:32"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T1", "text": "Amplitude is $\\sqrt{c_1^2+c_2^2}$ (a sum of squares), not “$c_1$ square by $c_2$ square” as said at T015 00:07:22.", "srcs": ["S015·8", "T015 00:07:22"], "flags": [ADD]},
    {"topic": "T1", "text": "At equilibrium $mg=ks$ with the static stretch $s$, not $kx$ (T015 00:02:46): $x$ is the displacement from equilibrium.", "srcs": ["S015·5", "T015 00:02:46"], "flags": [ADD]},
    {"topic": "T2", "text": "Mixing inches and feet: with $g=32$ ft/s², every length must be in feet ($s=6$ in $=0.5$ ft gives $k=24$; using 6 gives $k=2$, wrong).", "srcs": ["S015·11"], "flags": [ADD]},
    {"topic": "T2", "text": "$c_2=\\frac{\\dot x(0)}{\\omega}$, not $\\dot x(0)$: in the 12 lb example $8c_2=-2$ gives $c_2=-\\frac14$ (the lecture first says “minus 4”, T015 00:14:59).", "srcs": ["S015·14", "T015 00:14:59"], "flags": [ADD]},
    {"topic": "T2", "text": "Weight is not mass: a 12 lb weight has $m=\\frac{12}{32}$ slug. In SI, a 20 kg weight is a force of $20g=196$ N.", "srcs": ["S015·11", "CW U2 P37"], "flags": [ADD]},
    {"topic": "T2", "text": "A body raised above equilibrium starts at a negative $x$ ($-\\frac5{12}$ ft on slide 015·20); forgetting the sign flips the phase.", "srcs": ["S015·20"], "flags": [ADD]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "Deriving the equation of motion (slides 015·5–9)", "stars": 1,
     "srcs": ["S015·5", "S015·6", "S015·7", "S015·8", "S015·9", "T015 00:03:37", "T015 00:05:33", "T015 00:07:05"],
     "given": "A mass $m$ hangs from a spring of constant $k$; $s$ is the stretch at equilibrium and $x(t)$ the displacement from equilibrium (down positive).",
     "steps": ["Forces: gravity $mg$ and the restoring force $-k(s+x)$ (Hooke's law). Newton: $mg-k(s+x)=m\\ddot x$.",
               "At equilibrium $mg=ks$, so $m\\ddot x=-kx$, i.e. $\\ddot x+\\frac kmx=0=\\ddot x+\\omega^2x$ with $\\omega=\\sqrt{k/m}$.",
               "AE $r^2+\\omega^2=0$, roots $\\pm i\\omega$: $x=c_1\\cos\\omega t+c_2\\sin\\omega t$.",
               "Put $c_1=A\\cos\\varphi$, $c_2=-A\\sin\\varphi$: $x=A\\cos(\\omega t+\\varphi)$, period $\\frac{2\\pi}\\omega$."],
     "answer": "$\\dfrac{d^2x}{dt^2}+\\omega^2x=0,\\ x=A\\cos(\\omega t+\\varphi),\\ T=2\\pi\\sqrt{\\tfrac mk}$",
     "check": "sympy dsolve of $\\ddot x+\\omega^2x=0$ returns $c_1\\cos\\omega t+c_2\\sin\\omega t$."},
    {"id": "W2.1", "topic": "T2", "title": "12 lb weight, 6 in stretch, pulled 4 in down, upward 2 ft/s (slides 015·10–14)", "stars": 2,
     "srcs": ["S015·10", "S015·11", "S015·12", "S015·13", "S015·14", "T015 00:08:33", "T015 00:11:48", "T015 00:15:34"],
     "given": "A spring is stretched 6 in by a 12 lb weight. The weight is pulled down 4 in below equilibrium and given an upward velocity of 2 ft/s. No damping. Find the motion, the amplitude and the period.",
     "steps": ["$m=\\frac{12}{32}=\\frac38$ slug; $s=6$ in $=0.5$ ft, $k=\\frac{mg}s=\\frac{12}{0.5}=24$ lb/ft.",
               "$\\ddot x+\\frac{24}{3/8}x=\\ddot x+64x=0$, $\\omega=8$: $x=c_1\\cos8t+c_2\\sin8t$.",
               "$x(0)=4$ in $=\\frac13$ ft gives $c_1=\\frac13$.",
               "$\\dot x=-\\frac83\\sin8t+8c_2\\cos8t$; upward velocity: $\\dot x(0)=-2$, so $8c_2=-2$, $c_2=-\\frac14$.",
               "$A=\\sqrt{\\frac19+\\frac1{16}}=\\frac5{12}$ ft; $T=\\frac{2\\pi}8=\\frac\\pi4$ s."],
     "answer": "$x(t)=\\tfrac13\\cos8t-\\tfrac14\\sin8t$ ft; $A=\\tfrac5{12}$ ft; $T=\\tfrac\\pi4$ s",
     "check": "sympy dsolve with both initial conditions agrees; the slides agree."},
    {"id": "W2.2", "topic": "T2", "title": "Amplitude–phase form of W2.1, and when the mass first passes equilibrium", "stars": 1,
     "srcs": ["S015·8", "S015·14"], "flags": [ADD],
     "given": "Write $x=\\frac13\\cos8t-\\frac14\\sin8t$ as $A\\cos(8t+\\varphi)$ and find the first $t>0$ with $x=0$.",
     "steps": ["$A=\\frac5{12}$; $\\cos\\varphi=\\frac{c_1}A=\\frac45$, $\\sin\\varphi=-\\frac{c_2}A=\\frac35$, so $\\varphi=\\tan^{-1}\\frac34=0.6435$ rad.",
               "$x=\\frac5{12}\\cos(8t+0.6435)$; first zero when $8t+0.6435=\\frac\\pi2$."],
     "answer": "$x=\\tfrac5{12}\\cos(8t+0.6435)$; first crossing at $t=\\dfrac{\\pi/2-0.6435}{8}\\approx0.116$ s",
     "check": "nsolve of $\\frac13\\cos8t-\\frac14\\sin8t=0$ near 0.1 gives 0.11591."},
    {"id": "W2.3", "topic": "T2", "title": "8 lb weight, $k=12$ lb/ft, raised 5 in and released (slides 015·17–22)", "stars": 2,
     "srcs": ["S015·17", "S015·18", "S015·19", "S015·20", "S015·21", "S015·22"],
     "given": "An 8 lb weight hangs from a spring with $k=12$ lb/ft. It is raised 5 in above equilibrium and released. Find the equation of motion, $x(t)$, the amplitude, period, frequency and maximum velocity.",
     "steps": ["$m=\\frac8{32}=\\frac14$ slug; $\\frac14\\ddot x+12x=0$, i.e. $\\ddot x+48x=0$.",
               "$r^2+48=0$, $r=\\pm4\\sqrt3\\,i$, $\\omega=4\\sqrt3$: $x=C_1\\cos4\\sqrt3t+C_2\\sin4\\sqrt3t$.",
               "Raised 5 in: $x(0)=-\\frac5{12}$ ft gives $C_1=-\\frac5{12}$; released: $\\dot x(0)=4\\sqrt3C_2=0$, $C_2=0$.",
               "$A=\\frac5{12}$ ft, $T=\\frac{2\\pi}{4\\sqrt3}=\\frac\\pi{2\\sqrt3}$ s, $f=\\frac{2\\sqrt3}\\pi$ Hz, $v_{\\max}=A\\omega=\\frac5{12}\\cdot4\\sqrt3=\\frac5{\\sqrt3}$ ft/s."],
     "answer": "$x(t)=-\\tfrac5{12}\\cos4\\sqrt3\\,t=\\tfrac5{12}\\sin\\big(4\\sqrt3\\,t-\\tfrac\\pi2\\big)$; $A=\\tfrac5{12}$, $T=\\tfrac\\pi{2\\sqrt3}\\approx0.907$ s, $f\\approx1.10$ Hz, $v_{\\max}=\\tfrac5{\\sqrt3}\\approx2.89$ ft/s",
     "check": "sympy dsolve agrees; the two forms on slide 015·21 are equal."},
    {"id": "W2.4", "topic": "T2", "title": "10 kg body, 20 kg weight stretches 10 cm, pulled 20 cm down (CW P37)", "stars": 2,
     "srcs": ["CW U2 P37"],
     "given": "A body weighing 10 kg hangs from a spring. A pull of 20 kg weight stretches the spring 10 cm. The body is pulled 20 cm below equilibrium and released. Find $x(t)$, the maximum velocity and the period.",
     "steps": ["$k=\\frac{20g}{0.1}=200g=1960$ N/m (taking $g=9.8$ m/s²); $m=10$ kg.",
               "$\\omega^2=\\frac km=196$, $\\omega=14$ rad/s: $\\ddot x+196x=0$, $x=c_1\\cos14t+c_2\\sin14t$.",
               "$x(0)=0.2$ m gives $c_1=0.2$; released: $\\dot x(0)=14c_2=0$, $c_2=0$.",
               "$v_{\\max}=A\\omega=0.2\\times14=2.8$ m/s; $T=\\frac{2\\pi}{14}=\\frac\\pi7$ s."],
     "answer": "$x(t)=0.2\\cos14t$ m; $v_{\\max}=2.8$ m/s; $T=\\tfrac\\pi7\\approx0.449$ s",
     "check": "sympy dsolve agrees. The CW sheet prints no answer. Check: $\\omega^2=\\frac km=\\frac{20g}{0.1\\times10}=20g=196$."},
    {"id": "W3.1", "topic": "T3", "title": "Damped oscillator with $x(0)=0$, $\\dot x(0)=x_0$ (slides 015·15–16)", "stars": 1,
     "srcs": ["S015·15", "S015·16"],
     "given": "A particle of mass $m$ moves on a line under a force $mn^2x$ towards a fixed point $O$, with resistance $2\\lambda mn\\dot x$, $0<\\lambda<1$. Initially $x(0)=0$, $\\dot x(0)=x_0$. Find $x(t)$.",
     "steps": ["Newton: $m\\ddot x+2\\lambda mn\\dot x+mn^2x=0$, i.e. $\\ddot x+2\\lambda n\\dot x+n^2x=0$.",
               "$r^2+2\\lambda nr+n^2=0$: $r=-\\lambda n\\pm in\\sqrt{1-\\lambda^2}$; $x=e^{-\\lambda nt}(A\\cos\\omega t+B\\sin\\omega t)$, $\\omega=n\\sqrt{1-\\lambda^2}$.",
               "$x(0)=0$ gives $A=0$; $\\dot x(0)=B\\omega=x_0$ gives $B=\\frac{x_0}{n\\sqrt{1-\\lambda^2}}$."],
     "answer": "$x(t)=\\dfrac{x_0}{n\\sqrt{1-\\lambda^2}}\\,e^{-\\lambda nt}\\sin\\big(n\\sqrt{1-\\lambda^2}\\,t\\big)$",
     "check": "Substitution leaves 0; $x(0)=0$ and $\\dot x(0)=x_0$ (sympy). Matches slide 015·16."},
    {"id": "W3.2", "topic": "T3", "title": "The same problem with $\\lambda=1$ and $\\lambda=2$", "stars": 1,
     "srcs": ["S015·16"], "flags": [ADD],
     "given": "Solve $\\ddot x+2\\lambda n\\dot x+n^2x=0$, $x(0)=0$, $\\dot x(0)=x_0$ for $\\lambda=1$ and for $\\lambda>1$.",
     "steps": ["$\\lambda=1$: double root $-n$; $x=(c_1+c_2t)e^{-nt}$, $c_1=0$, $c_2=x_0$.",
               "$\\lambda>1$: roots $-\\lambda n\\pm n\\sqrt{\\lambda^2-1}$ (real); $x=\\frac{x_0}{2n\\sqrt{\\lambda^2-1}}\\big(e^{r_1t}-e^{r_2t}\\big)$."],
     "answer": "$\\lambda=1$: $x=x_0te^{-nt}$;\\quad $\\lambda>1$: $x=\\dfrac{x_0}{n\\sqrt{\\lambda^2-1}}\\,e^{-\\lambda nt}\\sinh\\big(n\\sqrt{\\lambda^2-1}\\,t\\big)$",
     "check": "Both satisfy the equation and the initial conditions (sympy); neither crosses $x=0$ again (Figure G3.1)."},
]

PYQS = []

NOTES = [
    {"topic": "T1", "text": "Spring–mass: $mg=ks$ at equilibrium; Hooke $-k(s+x)$; Newton $m\\ddot x=-kx$, so $\\ddot x+\\omega^2x=0$, $\\omega=\\sqrt{k/m}$. "
     "Roots $\\pm i\\omega$: $x=c_1\\cos\\omega t+c_2\\sin\\omega t=A\\cos(\\omega t+\\varphi)$, $A=\\sqrt{c_1^2+c_2^2}$, $\\tan\\varphi=-\\frac{c_2}{c_1}$. "
     "$T=\\frac{2\\pi}\\omega=2\\pi\\sqrt{m/k}$, $f=\\frac1T$, $v_{\\max}=A\\omega$."},
    {"topic": "T2", "text": "Recipe: $m=W/g$, $k=W/s$ (feet with $g=32$, metres with $g=9.8$); $c_1=x(0)$, $c_2=\\dot x(0)/\\omega$ with down positive. "
     "12 lb, 6 in, 4 in down, 2 ft/s up: $x=\\frac13\\cos8t-\\frac14\\sin8t$, $A=\\frac5{12}$ ft, $T=\\frac\\pi4$ s. "
     "8 lb, $k=12$, raised 5 in: $x=-\\frac5{12}\\cos4\\sqrt3t$, $v_{\\max}=\\frac5{\\sqrt3}$. CW P37: $x=0.2\\cos14t$, $v_{\\max}=2.8$ m/s, $T=\\frac\\pi7$."},
    {"topic": "T3", "text": "Damped: $\\ddot x+2\\lambda n\\dot x+n^2x=0$; $0<\\lambda<1$: roots $-\\lambda n\\pm in\\sqrt{1-\\lambda^2}$, decaying oscillation; "
     "from $x(0)=0$, $\\dot x(0)=x_0$: $x=\\frac{x_0}{n\\sqrt{1-\\lambda^2}}e^{-\\lambda nt}\\sin(n\\sqrt{1-\\lambda^2}t)$. $\\lambda\\ge1$: no oscillation."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "The spring in three positions (slide 015·5)", "stars": 1, "srcs": ["S015·5", "T015 00:01:51"],
     "howto": "Left: the natural length $L$. Middle: with the mass at rest the spring is stretched by $s$, where $mg=ks$; this is $x=0$. "
              "Right: in motion the mass is $x$ below equilibrium and the total stretch is $s+x$. Label $L$, $s$, $x$ and $mg=ks$."},
    {"id": "G2.1", "topic": "T2", "title": "Motion of the 12 lb weight: $x=\\frac13\\cos8t-\\frac14\\sin8t$", "stars": 2, "srcs": ["S015·14"], "flags": [ADD],
     "howto": "The mass starts $\\frac13$ ft below equilibrium (black dot) moving upward, so the curve starts downward-sloping on the plot. "
              "It swings between $\\pm\\frac5{12}$ ft (grey dashed) with period $\\frac\\pi4\\approx0.785$ s; the first crossing of 0 is at "
              "0.116 s (W2.2). Positive $x$ is below equilibrium."},
    {"id": "G2.2", "topic": "T2", "title": "Displacement and velocity of the 8 lb weight", "stars": 2, "srcs": ["S015·21", "S015·22"], "flags": [ADD],
     "howto": "Blue: $x=-\\frac5{12}\\cos4\\sqrt3t$ (ft). Vermilion dashed: $\\dot x=\\frac{5\\sqrt3}3\\sin4\\sqrt3t$ (ft/s). The velocity is largest, "
              "$\\frac5{\\sqrt3}\\approx2.89$ ft/s, exactly where $x=0$, and zero at the turning points $x=\\pm\\frac5{12}$."},
    {"id": "G3.1", "topic": "T3", "title": "Damped motion for $\\lambda=0.1$, $0.3$, $1$ and $2$ ($n=1$, $x_0=1$)", "stars": 1, "srcs": ["S015·16"], "flags": [ADD],
     "howto": "Underdamped curves ($\\lambda=0.1$ blue, $0.3$ vermilion) oscillate inside their envelopes $\\pm\\frac{e^{-\\lambda t}}{\\sqrt{1-\\lambda^2}}$ "
              "(grey dashed for $\\lambda=0.1$). Critical ($\\lambda=1$, green) and overdamped ($\\lambda=2$, purple) rise once and creep back "
              "without crossing zero."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "From forces to simple harmonic motion", "stars": 1,
     "srcs": ["S015·6", "S015·7", "S015·8", "T015 00:04:30", "T015 00:05:33"], "layout": "straight", "maxw": "140mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "Mass $m$ on a spring $k$", "sub": "$x$ from equilibrium, down positive"},
         {"kind": "step", "n": 1, "title": "Forces (Hooke)", "fx": "$mg$ and $-k(s+x)$"},
         {"kind": "step", "n": 2, "title": "Newton's second law", "fx": "$mg-k(s+x)=m\\ddot x$"},
         {"kind": "step", "n": 3, "title": "Equilibrium $mg=ks$", "fx": "$\\ddot x+\\frac kmx=0$"},
         {"kind": "step", "n": 4, "title": "AE roots $\\pm i\\omega$", "fx": "$\\omega=\\sqrt{k/m}$"},
         {"kind": "result", "title": "SHM", "fx": "$x=c_1\\cos\\omega t+c_2\\sin\\omega t$"}]},
     "remark": "Steps 4–5 are the complex-root case of class 002."},
    {"id": "F2.1", "topic": "T2", "title": "Solving a spring problem", "stars": 2,
     "srcs": ["S015·10", "S015·11", "S015·12", "S015·13", "S015·14", "T015 00:09:25", "T015 00:12:41"], "layout": "straight", "maxw": "150mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "Weight $W$, stretch $s$, start data", "sub": "convert to one unit system"},
         {"kind": "step", "n": 1, "title": "Mass and spring constant", "fx": "$m=\\frac Wg$, $k=\\frac Ws$"},
         {"kind": "step", "n": 2, "title": "Equation and $\\omega$", "fx": "$\\ddot x+\\omega^2x=0$, $\\omega=\\sqrt{k/m}$"},
         {"kind": "step", "n": 3, "title": "Constants (signs!)", "fx": "$c_1=x(0)$, $c_2=\\frac{\\dot x(0)}{\\omega}$"},
         {"kind": "result", "title": "Report", "fx": "$x(t)$; $A=\\sqrt{c_1^2+c_2^2}$, $T=\\frac{2\\pi}\\omega$, $f=\\frac1T$, $v_{\\max}=A\\omega$"}]},
     "remark": "W2.1, W2.3 and W2.4 all follow these four steps.", "trap": "Inches to feet before using $g=32$ ft/s²."},
    {"id": "F2.2", "topic": "T2", "title": "Turning the words into initial conditions (down positive)", "stars": 2,
     "srcs": ["S015·13", "S015·14", "S015·20", "T015 00:14:07", "T015 00:14:24"], "layout": "route", "maxw": "160mm",
     "spec": {"question": "What does the question say about $t=0$?",
              "rows": [{"title": "Pulled (stretched) $d$ below equilibrium", "sub": "W2.1: 4 in, W2.4: 20 cm", "kw": "$x(0)=+d$"},
                       {"title": "Raised $d$ above equilibrium", "sub": "W2.3: 5 in", "kw": "$x(0)=-d$"},
                       {"title": "Given an upward velocity $v$", "sub": "W2.1: 2 ft/s", "kw": "$\\dot x(0)=-v$"},
                       {"title": "Given a downward velocity $v$", "sub": "same convention", "kw": "$\\dot x(0)=+v$"},
                       {"title": "Released, or left free", "sub": "W2.3, W2.4", "kw": "$\\dot x(0)=0$"}]},
     "remark": "The convention is stated in the lecture and on slide 015·20."},
    {"id": "F3.1", "topic": "T3", "title": "Damped oscillator: which motion?", "stars": 1, "flags": [ADD],
     "srcs": ["S015·15", "S015·16"], "layout": "route", "maxw": "160mm",
     "spec": {"question": "How large is $\\lambda$ in $\\ddot x+2\\lambda n\\dot x+n^2x=0$?",
              "rows": [{"title": "$\\lambda=0$: no damping", "sub": "roots $\\pm in$; SHM", "kw": "undamped"},
                       {"title": "$0<\\lambda<1$: complex roots", "sub": "$e^{-\\lambda nt}(A\\cos\\omega_dt+B\\sin\\omega_dt)$; slide 015·16", "kw": "underdamped"},
                       {"title": "$\\lambda=1$: equal roots $-n$", "sub": "$(c_1+c_2t)e^{-nt}$", "kw": "critical"},
                       {"title": "$\\lambda>1$: real distinct roots", "sub": "$c_1e^{r_1t}+c_2e^{r_2t}$", "kw": "overdamped"}]},
     "remark": "Only the first two oscillate."},
]

COMPARISONS = [
    {"id": "C1.1", "topic": "T1", "title": "The quantities of simple harmonic motion", "srcs": ["S015·7", "S015·8", "S015·9", "S015·22"],
     "head": ["Quantity", "Formula", "12 lb example", "8 lb example"],
     "rows": [["Angular frequency", "$\\omega=\\sqrt{k/m}$", "8 rad/s", "$4\\sqrt3$ rad/s"],
              ["Amplitude", "$A=\\sqrt{c_1^2+c_2^2}$", "$\\frac5{12}$ ft", "$\\frac5{12}$ ft"],
              ["Period", "$T=\\frac{2\\pi}\\omega$", "$\\frac\\pi4$ s", "$\\frac\\pi{2\\sqrt3}$ s"],
              ["Frequency", "$f=\\frac1T$", "$\\frac4\\pi$ Hz", "$\\frac{2\\sqrt3}\\pi$ Hz"],
              ["Max velocity", "$A\\omega$", "$\\frac{10}3$ ft/s", "$\\frac5{\\sqrt3}$ ft/s"]]},
    {"id": "C1.2", "topic": "T1", "title": "Spring–mass system and LCR circuit", "flags": [ADD], "srcs": ["S015·4", "T015 00:00:32"],
     "head": ["Spring–mass", "LCR circuit (class 014)"],
     "rows": [["$m\\ddot x+c\\dot x+kx=F(t)$", "$L\\ddot Q+R\\dot Q+\\frac QC=E(t)$"],
              ["mass $m$", "inductance $L$"],
              ["damping coefficient $c$", "resistance $R$"],
              ["spring constant $k$", "$\\frac1C$"],
              ["displacement $x$, velocity $\\dot x$", "charge $Q$, current $I$"],
              ["$\\omega=\\sqrt{k/m}$", "$\\omega=\\frac1{\\sqrt{LC}}$"]]},
    {"id": "C2.1", "topic": "T2", "title": "Every spring problem of this class, side by side", "srcs": ["S015·10", "S015·17", "CW U2 P37"],
     "head": ["Problem", "$m$, $k$", "Equation", "$x(0)$, $\\dot x(0)$", "$x(t)$"],
     "rows": [["12 lb, 6 in (W2.1)", "$\\frac38$, 24", "$\\ddot x+64x=0$", "$\\frac13$, $-2$", "$\\frac13\\cos8t-\\frac14\\sin8t$"],
              ["8 lb, $k=12$ (W2.3)", "$\\frac14$, 12", "$\\ddot x+48x=0$", "$-\\frac5{12}$, 0", "$-\\frac5{12}\\cos4\\sqrt3t$"],
              ["CW P37 (W2.4)", "10, 1960", "$\\ddot x+196x=0$", "0.2, 0", "$0.2\\cos14t$"]]},
    {"id": "C3.1", "topic": "T3", "title": "Undamped and damped oscillators", "srcs": ["S015·7", "S015·15", "S015·16"],
     "head": ["", "Undamped", "Damped, $0<\\lambda<1$"],
     "rows": [["Equation", "$\\ddot x+n^2x=0$", "$\\ddot x+2\\lambda n\\dot x+n^2x=0$"],
              ["Roots", "$\\pm in$", "$-\\lambda n\\pm in\\sqrt{1-\\lambda^2}$"],
              ["Frequency", "$n$", "$n\\sqrt{1-\\lambda^2}$ (smaller)"],
              ["Amplitude", "constant $A$", "decays like $e^{-\\lambda nt}$"],
              ["$x(0)=0$, $\\dot x(0)=x_0$", "$\\frac{x_0}n\\sin nt$", "$\\frac{x_0}{n\\sqrt{1-\\lambda^2}}e^{-\\lambda nt}\\sin(n\\sqrt{1-\\lambda^2}t)$"]]},
]

SYMBOLS = [
    {"sym": "$m$", "name": "Mass", "meaning": "$W/g$; slug (ft–lb) or kg. Not the AE variable here (the AE uses $r$)", "unit": "slug, kg", "where": "E1.3, E2.1"},
    {"sym": "$W$", "name": "Weight", "meaning": "$mg$; pounds or kilogram-weight", "unit": "lb, N", "where": "E2.1"},
    {"sym": "$g$", "name": "Acceleration due to gravity", "meaning": "32 ft/s² or 9.8 m/s²", "unit": "ft/s², m/s²", "where": "E1.1, E2.1"},
    {"sym": "$k$", "name": "Spring constant", "meaning": "Force per unit stretch", "unit": "lb/ft, N/m", "where": "E1.1, E1.3"},
    {"sym": "$s$", "name": "Static stretch", "meaning": "Extension at equilibrium, $mg=ks$", "unit": "ft, m", "where": "E1.1"},
    {"sym": "$x(t)$", "name": "Displacement", "meaning": "From equilibrium, downward positive", "unit": "ft, m", "where": "E1.3, E1.4"},
    {"sym": "$\\dot x$, $\\ddot x$", "name": "Velocity, acceleration", "meaning": "$\\frac{dx}{dt}$, $\\frac{d^2x}{dt^2}$", "where": "E1.2, E2.2"},
    {"sym": "$\\omega$", "name": "Angular frequency", "meaning": "$\\sqrt{k/m}$; on slide 015·16 the damped frequency", "unit": "rad/s", "where": "E1.3, E3.2"},
    {"sym": "$A$", "name": "Amplitude", "meaning": "$\\sqrt{c_1^2+c_2^2}$; on slide 015·16 an integration constant", "unit": "ft, m", "where": "E1.5"},
    {"sym": "$\\varphi$", "name": "Phase", "meaning": "$\\tan\\varphi=-\\frac{c_2}{c_1}$", "unit": "rad", "where": "E1.5"},
    {"sym": "$T$, $f$", "name": "Period, frequency", "meaning": "$\\frac{2\\pi}\\omega$, $\\frac1T$", "unit": "s, Hz", "where": "E1.6"},
    {"sym": "$c_1$, $c_2$", "name": "Arbitrary constants", "meaning": "$x(0)$, $\\dot x(0)/\\omega$", "where": "E1.4, E2.2"},
    {"sym": "$n$", "name": "Undamped frequency", "meaning": "In $mn^2x$ (slide 015·15)", "unit": "rad/s", "where": "E3.1"},
    {"sym": "$\\lambda$", "name": "Damping ratio", "meaning": "$0<\\lambda<1$ on the slide", "where": "E3.1, E3.2"},
    {"sym": "$x_0$", "name": "Initial velocity", "meaning": "$\\dot x(0)$ on slide 015·15 (not a position)", "unit": "ft/s", "where": "E3.3"},
]

KEYWORDS = [
    {"term": "Simple harmonic motion", "meaning": "$x=A\\cos(\\omega t+\\varphi)$.", "topic": "T1"},
    {"term": "Equilibrium position", "meaning": "$mg=ks$; $x=0$.", "topic": "T1"},
    {"term": "Hooke's law", "meaning": "Restoring force $-k(s+x)$.", "topic": "T1"},
    {"term": "Newton's second law", "meaning": "Net force $=m\\ddot x$.", "topic": "T1"},
    {"term": "Spring constant", "meaning": "$k=W/s$.", "topic": "T1"},
    {"term": "Angular frequency", "meaning": "$\\omega=\\sqrt{k/m}$.", "topic": "T1"},
    {"term": "Amplitude", "meaning": "$\\sqrt{c_1^2+c_2^2}$; maximum displacement.", "topic": "T1"},
    {"term": "Phase", "meaning": "$\\tan\\varphi=-c_2/c_1$.", "topic": "T1"},
    {"term": "Period", "meaning": "$2\\pi\\sqrt{m/k}$.", "topic": "T1"},
    {"term": "Natural frequency", "meaning": "$\\frac1T=\\frac\\omega{2\\pi}$.", "topic": "T1"},
    {"term": "Maximum velocity", "meaning": "$A\\omega$, at equilibrium.", "topic": "T1"},
    {"term": "Slug", "meaning": "Mass unit: lb ÷ 32 ft/s².", "topic": "T2"},
    {"term": "Free motion", "meaning": "No damping, no external force.", "topic": "T2"},
    {"term": "Downward positive", "meaning": "Sign convention for $x$ and $\\dot x$.", "topic": "T2"},
    {"term": "Released", "meaning": "$\\dot x(0)=0$.", "topic": "T2"},
    {"term": "Damping force", "meaning": "$\\propto$ velocity, opposes motion.", "topic": "T3"},
    {"term": "Underdamped", "meaning": "$0<\\lambda<1$; decaying oscillation.", "topic": "T3"},
    {"term": "Damped frequency", "meaning": "$n\\sqrt{1-\\lambda^2}$.", "topic": "T3"},
    {"term": "Critical damping", "meaning": "$\\lambda=1$; no oscillation.", "topic": "T3"},
    {"term": "Overdamped", "meaning": "$\\lambda>1$; real roots.", "topic": "T3"},
]

RAPID = [
    {"q": "The two forces on a hanging mass?", "a": "Gravity $mg$ and the restoring force $-k(s+x)$."},
    {"q": "Equilibrium condition?", "a": "$mg=ks$."},
    {"q": "The equation of SHM?", "a": "$\\frac{d^2x}{dt^2}+\\frac kmx=0$, i.e. $\\ddot x+\\omega^2x=0$."},
    {"q": "Its general solution?", "a": "$c_1\\cos\\omega t+c_2\\sin\\omega t$."},
    {"q": "Amplitude from $c_1$, $c_2$?", "a": "$\\sqrt{c_1^2+c_2^2}$."},
    {"q": "Period and frequency?", "a": "$T=2\\pi\\sqrt{m/k}$, $f=\\frac1T$."},
    {"q": "Maximum velocity?", "a": "$A\\omega$."},
    {"q": "$g$ in feet?", "a": "32 ft/s²."},
    {"q": "Mass of a 12 lb weight?", "a": "$\\frac38$ slug."},
    {"q": "$k$ if 12 lb stretches 6 in?", "a": "24 lb/ft."},
    {"q": "Upward velocity 2 ft/s: $\\dot x(0)$?", "a": "$-2$ (down positive)."},
    {"q": "12 lb example: $x(t)$?", "a": "$\\frac13\\cos8t-\\frac14\\sin8t$."},
    {"q": "…its amplitude and period?", "a": "$\\frac5{12}$ ft, $\\frac\\pi4$ s."},
    {"q": "8 lb, $k=12$: $\\omega$?", "a": "$4\\sqrt3$ rad/s."},
    {"q": "CW P37: $x(t)$?", "a": "$0.2\\cos14t$ m."},
    {"q": "Damped equation of slide 015·15?", "a": "$\\ddot x+2\\lambda n\\dot x+n^2x=0$."},
    {"q": "Its roots for $0<\\lambda<1$?", "a": "$-\\lambda n\\pm in\\sqrt{1-\\lambda^2}$."},
    {"q": "When does a damped mass not oscillate?", "a": "$\\lambda\\ge1$."},
]

MNEMONICS = [
    "<i>“Weight over g, weight over stretch.”</i> $m=\\frac Wg$, $k=\\frac Ws$: the two numbers every spring problem needs first (study aid).",
]

TOP_FACTS = [
    "$mg=ks$ at equilibrium; then $\\ddot x+\\frac kmx=0$, $\\omega=\\sqrt{k/m}$.",
    "$x=c_1\\cos\\omega t+c_2\\sin\\omega t=A\\cos(\\omega t+\\varphi)$, $A=\\sqrt{c_1^2+c_2^2}$, $\\tan\\varphi=-\\frac{c_2}{c_1}$.",
    "$T=\\frac{2\\pi}\\omega=2\\pi\\sqrt{m/k}$, $f=\\frac1T$, $v_{\\max}=A\\omega$.",
    "$m=\\frac Wg$, $k=\\frac Ws$; inches → feet, $g=32$ ft/s² (or 9.8 m/s²).",
    "Down positive: pulled down $+$, raised $-$, upward velocity $-$, released $\\dot x(0)=0$.",
    "$c_1=x(0)$, $c_2=\\frac{\\dot x(0)}\\omega$.",
    "12 lb: $x=\\frac13\\cos8t-\\frac14\\sin8t$, $A=\\frac5{12}$, $T=\\frac\\pi4$. 8 lb: $x=-\\frac5{12}\\cos4\\sqrt3t$, $v_{\\max}=\\frac5{\\sqrt3}$.",
    "Damped: $\\ddot x+2\\lambda n\\dot x+n^2x=0$, $x=\\frac{x_0}{n\\sqrt{1-\\lambda^2}}e^{-\\lambda nt}\\sin(n\\sqrt{1-\\lambda^2}t)$.",
]
TOP_FORMULAS = ["E1.1", "E1.3", "E1.4", "E1.5", "E1.6", "E1.7", "E2.2", "E3.3"]
