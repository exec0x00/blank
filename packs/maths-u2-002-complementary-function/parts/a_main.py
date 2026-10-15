"""Unit 2, class 002: solutions of homogeneous linear DEs with constant coefficients (complementary functions)."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "The auxiliary equation and the complementary function",
     "overview": r"A homogeneous linear DE with constant coefficients, $f(D)y=0$, is solved by trying $y=e^{mx}$. Substituting gives "
                 r"$f(m)e^{mx}=0$, and since $e^{mx}\neq0$ the exponent $m$ must satisfy the algebraic equation $f(m)=0$, the "
                 r"<i>auxiliary equation</i> (AE, also called the characteristic equation). Its general solution is called the "
                 r"<i>complementary function</i> (CF). The form of the CF depends only on the nature of the roots of the AE."},
    {"id": "T2", "title": "Second-order equations: three cases",
     "overview": r"For $y''+k_1y'+k_2y=0$ the AE $m^2+k_1m+k_2=0$ has two roots. Case I, real and distinct: "
                 r"$y=c_1e^{m_1x}+c_2e^{m_2x}$. Case II, real and equal: $y=(c_1+c_2x)e^{mx}$. Case III, complex "
                 r"$\alpha\pm i\beta$: $y=e^{\alpha x}(c_1\cos\beta x+c_2\sin\beta x)$. Every second-order CF has exactly two "
                 r"arbitrary constants."},
    {"id": "T3", "title": "Equations of order $n$: combining the cases",
     "overview": r"An $n$-th order equation has an AE of degree $n$, so $n$ roots and $n$ arbitrary constants. Each root, or pair "
                 r"of complex roots, contributes its own block to the CF. Each block is multiplied by $1,x,x^2,\dots$, one power "
                 r"for each time the root is repeated. Slides 002·11–13 list five cases (all distinct, all equal, four equal, "
                 r"two complex pairs, a repeated complex pair). Every CF you will write in Unit 2 is a combination of these cases."},
    {"id": "T4", "title": "Solving problems, with initial conditions",
     "overview": r"Every problem follows the same steps: write the AE, factorise it, classify the roots, write the CF. When initial "
                 r"(or boundary) conditions are given, differentiate the CF, substitute the conditions and solve the linear "
                 r"system for $c_1,c_2,\dots$. Class-work problems 1–9 cover every case. No ESA paper asks a homogeneous equation on "
                 r"its own, but every non-homogeneous ESA question starts with this CF."},
]

DEFS = [
    {"topic": "T1", "term": "Homogeneous linear DE with constant coefficients",
     "text": r"$(D^n+k_1D^{n-1}+k_2D^{n-2}+\dots+k_n)y=0$, written $f(D)y=0$, where $D=\frac{d}{dx}$ and $k_1,\dots,k_n$ are constants.",
     "srcs": ["S002·10", "T002 00:12:58"]},
    {"topic": "T1", "term": "Auxiliary polynomial",
     "text": r"$f(m)$: replace $D$ by $m$ in the linear differential operator $f(D)$.", "srcs": ["S002·6", "T002 00:04:00"]},
    {"topic": "T1", "term": "Auxiliary equation (characteristic equation)",
     "text": r"$f(m)=0$. For $\frac{d^2y}{dx^2}+k_1\frac{dy}{dx}+k_2y=0$ it is $m^2+k_1m+k_2=0$.",
     "srcs": ["S002·5", "S002·6", "T002 00:03:01", "T002 00:04:23"]},
    {"topic": "T1", "term": "Complementary function (CF)",
     "text": r"The general solution of the homogeneous linear DE $f(D)y=0$. It contains as many arbitrary constants as the order of the equation.",
     "srcs": ["T002 00:00:41", "T002 00:06:31"]},
    {"topic": "T3", "term": "Multiplicity of a root",
     "text": r"The number of times a root is repeated in the AE: in $(m-1)^2(m+1)^2=0$ both $1$ and $-1$ have multiplicity 2.",
     "srcs": ["S002·12", "T002 00:14:47"], "flags": [ADD]},
]

STATEMENTS = [
    {"topic": "T1", "text": r"Substituting into the above equation, we see that $y=e^{mx}$ is a solution if $(m^2+k_1m+k_2)e^{mx}=0$. "
                            r"$m^2+k_1m+k_2=0$ is the AUXILIARY EQUATION of $(D^2+k_1D+k_2)y=0$.", "srcs": ["S002·5"]},
    {"topic": "T1", "text": "The solution of the differential equation depends on the nature of roots of the auxiliary equation.",
     "srcs": ["S002·6"]},
    {"topic": "T2", "text": r"CASE I. If the roots $m_1$ and $m_2$ are real and distinct, then the general solution of the differential "
                            r"equation $\frac{d^2y}{dx^2}+k_1\frac{dy}{dx}+k_2y=0$ is $y=c_1e^{m_1x}+c_2e^{m_2x}$.", "srcs": ["S002·7"]},
    {"topic": "T2", "text": r"CASE II. If the roots $m_1$ and $m_2$ are real and equal, then the general solution of the differential "
                            r"equation $\frac{d^2y}{dx^2}+k_1\frac{dy}{dx}+k_2y=0$ is $y=(c_1+c_2x)e^{mx}$.", "srcs": ["S002·8"]},
    {"topic": "T2", "text": r"CASE III. If the roots $m_1$ and $m_2$ are complex, let the roots be $m_1=\alpha+i\beta$ and "
                            r"$m_2=\alpha-i\beta$; then the general solution of the differential equation is "
                            r"$y=e^{\alpha x}(c_1\cos\beta x+c_2\sin\beta x)$.", "srcs": ["S002·9"]},
    {"topic": "T3", "text": r"Case (i). If the roots $m_1,m_2,\dots,m_n$ are real and distinct, then the general solution is "
                            r"$y=c_1e^{m_1x}+c_2e^{m_2x}+\dots+c_ne^{m_nx}$.", "srcs": ["S002·11"]},
    {"topic": "T3", "text": r"Case (ii). If the roots $m_1,m_2,\dots,m_n$ are real and equal (say equal to $m$), then the general "
                            r"solution is $y=(c_1+c_2x+\dots+c_nx^{n-1})e^{mx}$.", "srcs": ["S002·12"]},
    {"topic": "T3", "text": r"Case (iii). If the roots $m_1,m_2,m_3,m_4$ are real and equal (say equal to $m$) and the remaining $(n-4)$ "
                            r"roots are real and distinct, then the general solution is "
                            r"$y=(c_1+c_2x+c_3x^2+c_4x^3)e^{mx}+c_5e^{m_5x}+c_6e^{m_6x}+\dots+c_ne^{m_nx}$.", "srcs": ["S002·12"]},
    {"topic": "T3", "text": r"Case (iv). If there are two pairs of imaginary roots $\alpha\pm i\beta$, $\gamma\pm i\delta$, then the general "
                            r"solution is $y=e^{\alpha x}(c_1\cos\beta x+c_2\sin\beta x)+e^{\gamma x}(c_3\cos\delta x+c_4\sin\delta x)"
                            r"+c_5e^{m_5x}+\dots+c_ne^{m_nx}$.", "srcs": ["S002·13"]},
    {"topic": "T3", "text": r"Case (v). If a pair of complex roots say $\alpha\pm i\beta$ occurring twice, then the GS is "
                            r"$y=e^{\alpha x}\big((c_1+c_2x)\cos\beta x+(c_3+c_4x)\sin\beta x\big)+c_5e^{m_5x}+\dots+c_ne^{m_nx}$.",
     "srcs": ["S002·13"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Trial solution and its derivatives", "tex": r"y=e^{mx},\qquad y'=m\,e^{mx},\qquad y''=m^2e^{mx}",
     "gives": r"Turns $f(D)y=0$ into $f(m)e^{mx}=0$.", "when": "Any linear DE with constant coefficients.",
     "note": r"$D^ke^{mx}=m^ke^{mx}$, so $f(D)e^{mx}=f(m)e^{mx}$.", "stars": 2, "srcs": ["S002·4", "T002 00:02:04"]},
    {"id": "E1.2", "topic": "T1", "title": "Auxiliary equation", "tex": r"f(D)y=0\ \Longrightarrow\ f(m)=m^n+k_1m^{n-1}+\dots+k_n=0",
     "gives": r"The $n$ roots $m_1,\dots,m_n$ that fix the CF.", "when": "Homogeneous, constant coefficients.",
     "note": r"Replace $D$ by $m$ (equivalently $y\to1$, $y'\to m$, $y''\to m^2$, $y'''\to m^3$).", "stars": 3,
     "srcs": ["S002·5", "S002·10", "T002 00:03:18", "T002 00:07:40"]},
    {"id": "E2.1", "topic": "T2", "title": "Case I: real and distinct roots", "tex": r"m_1\neq m_2\ \text{real}:\quad y=c_1e^{m_1x}+c_2e^{m_2x}",
     "gives": "The CF.", "when": r"Discriminant $k_1^2-4k_2>0$.", "note": r"Slide 002·7: $m=-3,1$ gives $y=c_1e^{-3x}+c_2e^{x}$.",
     "stars": 3, "srcs": ["S002·7", "T002 00:05:40"]},
    {"id": "E2.2", "topic": "T2", "title": "Case II: real and equal roots", "tex": r"m_1=m_2=m:\quad y=(c_1+c_2x)e^{mx}",
     "gives": "The CF.", "when": r"$k_1^2-4k_2=0$, $m=-\frac{k_1}{2}$.", "note": "“This is the formula you should remember” (T002 00:09:10).",
     "stars": 3, "srcs": ["S002·8", "T002 00:08:57", "T002 00:09:10"]},
    {"id": "E2.3", "topic": "T2", "title": "Case III: complex roots", "tex": r"m=\alpha\pm i\beta:\quad y=e^{\alpha x}(c_1\cos\beta x+c_2\sin\beta x)",
     "gives": "The CF, in real form.", "when": r"$k_1^2-4k_2<0$; $\alpha$ = real part, $\beta$ = imaginary part ($\beta>0$).",
     "note": r"$\alpha=0$ (roots $\pm i\beta$) gives $c_1\cos\beta x+c_2\sin\beta x$.", "stars": 3, "srcs": ["S002·9", "T002 00:10:56"]},
    {"id": "E2.4", "topic": "T2", "title": "Roots of the quadratic AE", "tex": r"m=\frac{-k_1\pm\sqrt{k_1^2-4k_2}}{2}",
     "gives": "Which case applies, from the sign of the discriminant.", "when": r"AE $m^2+k_1m+k_2=0$.",
     "note": r"Lecture: “$\frac{-b\pm\sqrt{b^2-4ac}}{2a}$” with $a=1,b=-4,c=13$ for slide 002·9.", "stars": 2,
     "srcs": ["T002 00:11:56"], "flags": [ADD]},
    {"id": "E3.1", "topic": "T3", "title": "Case (i): $n$ real distinct roots", "tex": r"y=c_1e^{m_1x}+c_2e^{m_2x}+\dots+c_ne^{m_nx}",
     "gives": r"The CF of an $n$-th order equation.", "when": "All roots real and different.", "note": r"$n$ constants.", "stars": 3,
     "srcs": ["S002·11", "T002 00:14:12"]},
    {"id": "E3.2", "topic": "T3", "title": "Case (ii): a root repeated $k$ times", "tex": r"y=(c_1+c_2x+c_3x^2+\dots+c_kx^{k-1})e^{mx}",
     "gives": r"The block of the CF for a $k$-fold real root $m$.", "when": r"Slide 002·12 has $k=n$ (all roots equal) and $k=4$.",
     "note": r"Stop at $x^{k-1}$: a double root gives $c_1+c_2x$, a triple root $c_1+c_2x+c_3x^2$.", "stars": 3,
     "srcs": ["S002·12", "T002 00:14:58", "T002 00:15:15"]},
    {"id": "E3.3", "topic": "T3", "title": "Case (iii): equal roots with distinct ones", "tex": r"y=(c_1+c_2x+c_3x^2+c_4x^3)e^{mx}+c_5e^{m_5x}+\dots+c_ne^{m_nx}",
     "gives": "The CF when four roots are equal and the rest distinct.", "when": r"$m_1=m_2=m_3=m_4=m$.",
     "note": "Add the blocks of each root.", "stars": 2, "srcs": ["S002·12", "T002 00:16:12", "T002 00:16:37"]},
    {"id": "E3.4", "topic": "T3", "title": "Case (iv): two pairs of complex roots",
     "tex": r"y=e^{\alpha x}(c_1\cos\beta x+c_2\sin\beta x)+e^{\gamma x}(c_3\cos\delta x+c_4\sin\delta x)+c_5e^{m_5x}+\dots",
     "gives": "The CF.", "when": r"Roots $\alpha\pm i\beta$, $\gamma\pm i\delta$, rest real and distinct.",
     "note": "Each pair has its own two constants (CW P5).", "stars": 2, "srcs": ["S002·13", "T002 00:17:08", "T002 00:17:36"]},
    {"id": "E3.5", "topic": "T3", "title": "Case (v): a complex pair occurring twice",
     "tex": r"y=e^{\alpha x}\big[(c_1+c_2x)\cos\beta x+(c_3+c_4x)\sin\beta x\big]+c_5e^{m_5x}+\dots",
     "gives": "The CF.", "when": r"$\alpha\pm i\beta$ repeated twice.", "note": "Both the cosine and the sine get a polynomial of degree 1 (CW P7).",
     "stars": 2, "srcs": ["S002·13", "T002 00:18:21", "T002 00:18:51"]},
    {"id": "E3.6", "topic": "T3", "title": "A complex pair occurring three times",
     "tex": r"y=e^{\alpha x}\big[(c_1+c_2x+c_3x^2)\cos\beta x+(c_4+c_5x+c_6x^2)\sin\beta x\big]+\dots",
     "gives": "The CF.", "when": r"$\alpha\pm i\beta$ repeated three times.", "note": "Said in the lecture; not on the slides.",
     "stars": 1, "srcs": ["T002 00:19:14", "T002 00:19:32", "T002 00:19:45"], "flags": [TONLY]},
    {"id": "E3.7", "topic": "T3", "title": "Zero root", "tex": r"m=0:\quad c\,e^{0x}=c",
     "gives": "A constant term in the CF.", "when": r"$f(m)$ has a factor $m$ (no $y$ term in the DE).",
     "note": r"Slide 002·14: $m=0,\pm2i$ gives $c_1+c_2\cos2x+c_3\sin2x$. A double zero root gives $c_1+c_2x$.", "stars": 2,
     "srcs": ["S002·14", "T002 00:21:20"]},
]

POINTS = [
    {"topic": "T1", "text": "Every non-homogeneous ESA question in Unit 2 (24 of 24 occurrences) needs the CF first; a slip in the AE loses the whole question.", "stars": 3,
     "srcs": ["ESA Dec-23 3a", "ESA Jan-24 s2 2d", "ESA Jan-24 s4 2c"]},
    {"topic": "T1", "text": r"Writing the AE: replace $D$ by $m$ in $f(D)$, or in the DE replace $y$ by $1$, $\frac{dy}{dx}$ by $m$, $\frac{d^2y}{dx^2}$ by $m^2$, $\frac{d^3y}{dx^3}$ by $m^3$, and equate to 0.",
     "stars": 3, "srcs": ["T002 00:03:36", "T002 00:07:40"]},
    {"topic": "T1", "text": r"$e^{mx}\neq0$ for every real $x$, so the bracket $f(m)$ must be 0. That is why only the roots of the AE matter.", "stars": 2,
     "srcs": ["S002·5", "T002 00:02:47"]},
    {"topic": "T1", "text": r"An equation of order $n$ has $n$ arbitrary constants in its general solution; count them as a check.", "stars": 3,
     "srcs": ["T002 00:06:31", "T002 00:15:54"]},
    {"topic": "T2", "text": r"Classify the roots before writing anything: real and distinct, real and equal, or complex. The quadratic formula settles it.", "stars": 3,
     "srcs": ["S002·6", "T002 00:04:41", "T002 00:11:56"]},
    {"topic": "T2", "text": r"In case III, $\alpha$ is the real part and $\beta$ the imaginary part of the root: $2\pm3i$ gives $e^{2x}(c_1\cos3x+c_2\sin3x)$.", "stars": 3,
     "srcs": ["S002·9", "T002 00:12:13"]},
    {"topic": "T2", "text": r"Complex roots of an AE with real coefficients occur in conjugate pairs $\alpha\pm i\beta$, so they always come two at a time.", "stars": 2,
     "srcs": ["T002 00:10:38"]},
    {"topic": "T3", "text": r"A root repeated $k$ times gives $(c_1+c_2x+\dots+c_kx^{k-1})e^{mx}$: the highest power is $x^{k-1}$, not $x^k$.", "stars": 3,
     "srcs": ["S002·12", "T002 00:15:15"]},
    {"topic": "T3", "text": "Build the CF block by block, one block per distinct root (or conjugate pair), then number the constants $c_1,c_2,\\dots$ straight through.", "stars": 3,
     "srcs": ["T002 00:16:37", "T002 00:18:09"]},
    {"topic": "T3", "text": r"A repeated complex pair multiplies both $\cos\beta x$ and $\sin\beta x$ by a polynomial: $(c_1+c_2x)\cos\beta x+(c_3+c_4x)\sin\beta x$.", "stars": 2,
     "srcs": ["S002·13", "T002 00:19:14"]},
    {"topic": "T3", "text": r"Factorise higher-degree AEs by trying $m=\pm1,\pm2,\pm\frac12,\dots$ and synthetic division; biquadratics like $m^4+13m^2+36$ factor as quadratics in $m^2$.", "stars": 2,
     "srcs": ["CW U2 P6", "CW U2 P9"], "flags": [ADD]},
    {"topic": "T4", "text": r"With initial conditions, find the general solution first, then differentiate it as often as the conditions need, then substitute.", "stars": 2,
     "srcs": ["CW U2 P3", "CW U2 P8"]},
    {"topic": "T4", "text": r"Conditions need not be at $x=0$: CW P9 gives $y(\frac\pi2)$ and $y'(\frac\pi2)$ (a boundary-value problem).", "stars": 2,
     "srcs": ["CW U2 P9"]},
    {"topic": "T4", "text": r"The independent variable need not be $x$: CW P5 is $\frac{d^4x}{dt^4}+4x=0$, so the CF is in $t$.", "stars": 1, "srcs": ["CW U2 P5"]},
]

WHY = [
    {"topic": "T2", "q": r"Why $(c_1+c_2x)e^{mx}$ and not $c_1e^{mx}+c_2e^{mx}$ for equal roots?",
     "a": r"$c_1e^{mx}+c_2e^{mx}=(c_1+c_2)e^{mx}$ has only one independent constant, but a second-order equation needs two. "
          r"$xe^{mx}$ is a second, independent solution: for $(D-m)^2y=0$, $(D-m)(xe^{mx})=e^{mx}$ and $(D-m)e^{mx}=0$.",
     "srcs": ["S002·8", "T002 00:06:31"], "flags": [ADD]},
    {"topic": "T2", "q": r"Where do $\cos\beta x$ and $\sin\beta x$ come from?",
     "a": r"$e^{(\alpha\pm i\beta)x}=e^{\alpha x}(\cos\beta x\pm i\sin\beta x)$ (Euler's formula). Suitable combinations of the two "
          r"complex solutions give the real solutions $e^{\alpha x}\cos\beta x$ and $e^{\alpha x}\sin\beta x$.",
     "srcs": ["S002·9"], "flags": [ADD]},
    {"topic": "T1", "q": "Why does the CF matter when the exam only asks non-homogeneous equations?",
     "a": r"The general solution of $f(D)y=X$ is $y=\text{CF}+\text{PI}$. The CF is the general solution of $f(D)y=0$, "
          r"so every question in classes 003–015 starts here.", "srcs": ["T002 00:00:41", "ESA Dec-23 3a"]},
]

TRAPS = [
    {"topic": "T2", "text": r"Do not write $c_1e^{mx}+c_2e^{mx}$ for a double root: it is $(c_1+c_2x)e^{mx}$.", "srcs": ["S002·8"], "flags": [ADD]},
    {"topic": "T2", "text": r"For $2\pm3i$, $\beta=3$, not 2. The lecture first says “beta is 2”, then corrects it to 3 (T002 00:12:13); slide 002·9 has $\cos3x$, $\sin3x$.",
     "srcs": ["S002·9", "T002 00:12:13"]},
    {"topic": "T2", "text": r"Do not put $i$ in the CF: $e^{2x}(c_1\cos3x+c_2\sin3x)$, never $e^{(2+3i)x}$ terms.", "srcs": ["S002·9"], "flags": [ADD]},
    {"topic": "T2", "text": r"Roots $\pm2i$ have $\alpha=0$: the CF is $c_1\cos2x+c_2\sin2x$, with no $e^{2x}$.", "srcs": ["S002·14"], "flags": [ADD]},
    {"topic": "T1", "text": r"The AE for $\frac{d^3y}{dx^3}$ needs $m^3$. The lecture says “replace it by $m$ square” at T002 00:07:49; that is a slip of the tongue.",
     "srcs": ["T002 00:07:49"], "flags": [ADD]},
    {"topic": "T1", "text": r"A missing $y$ term means a zero root: $m^3+4m=m(m^2+4)$. Do not divide by $m$ and lose the constant $c_1$.", "srcs": ["S002·14"], "flags": [ADD]},
    {"topic": "T1", "text": r"With a leading coefficient, keep it in the factorisation: $4m^2-8m+3=(2m-1)(2m-3)$ gives $m=\frac12,\frac32$ (CW P4).", "srcs": ["CW U2 P4"], "flags": [ADD]},
    {"topic": "T3", "text": r"For a triple root write up to $x^2$, not $x^3$. The slide's case (iii) has four equal roots, hence up to $x^3$.", "srcs": ["S002·12", "T002 00:15:15"]},
    {"topic": "T3", "text": r"In case (iv) the second complex pair takes new constants $c_3,c_4$. The lecture notes that an older version of the slide reused $c_1,c_2$ (T002 00:18:09); the current slide 002·13 is correct.",
     "srcs": ["S002·13", "T002 00:18:09"]},
    {"topic": "T4", "text": r"Differentiate the whole general solution (product rule on $e^{2x}\cos x$) before substituting $x=0$; $y'(0)\neq c_2$ in CW P3.", "srcs": ["CW U2 P3"], "flags": [ADD]},
]

WORKED = [
    {"id": "W2.1", "topic": "T2", "title": "Case I: $y''+2y'-3y=0$ (slide 002·7)", "srcs": ["S002·7", "T002 00:07:04", "T002 00:08:11"], "stars": 3,
     "given": r"Solve $\frac{d^2y}{dx^2}+2\frac{dy}{dx}-3y=0$.",
     "steps": [r"$(D^2+2D-3)y=0$; AE $m^2+2m-3=0$.", r"$(m+3)(m-1)=0$, so $m=-3,1$: real and distinct.", r"E2.1."],
     "answer": r"$y=c_1e^{-3x}+c_2e^{x}$", "check": "sympy dsolve and checkodesol agree."},
    {"id": "W2.2", "topic": "T2", "title": "Case II: $y''+4y'+4y=0$ (slide 002·8, CW P2)", "srcs": ["S002·8", "T002 00:09:27", "T002 00:10:03", "CW U2 P2"], "stars": 3,
     "given": r"Solve $\frac{d^2y}{dx^2}+4\frac{dy}{dx}+4y=0$.",
     "steps": [r"AE $m^2+4m+4=0$, i.e. $(m+2)^2=0$.", r"$m=-2,-2$: real and equal.", r"E2.2 with $m=-2$."],
     "answer": r"$y=(c_1+c_2x)e^{-2x}$", "check": "sympy agrees. CW P2 is the same equation, with the same answer."},
    {"id": "W2.3", "topic": "T2", "title": "Case III: $y''-4y'+13y=0$ (slide 002·9)", "srcs": ["S002·9", "T002 00:11:38", "T002 00:12:27"], "stars": 3,
     "given": r"Solve $\frac{d^2y}{dx^2}-4\frac{dy}{dx}+13y=0$.",
     "steps": [r"AE $m^2-4m+13=0$.", r"$m=\frac{4\pm\sqrt{16-52}}{2}=\frac{4\pm6i}{2}=2\pm3i$, so $\alpha=2$, $\beta=3$.", r"E2.3."],
     "answer": r"$y=e^{2x}(c_1\cos3x+c_2\sin3x)$", "check": "sympy agrees."},
    {"id": "W2.4", "topic": "T2", "title": "$y''-4y'-12y=0$ (CW P1)", "srcs": ["CW U2 P1"], "stars": 2,
     "given": r"Solve $y''-4y'-12y=0$.",
     "steps": [r"AE $m^2-4m-12=0$, i.e. $(m-6)(m+2)=0$.", r"$m=6,-2$: real and distinct."],
     "answer": r"$y=c_1e^{6x}+c_2e^{-2x}$", "check": "CW answer agrees; sympy agrees."},
    {"id": "W2.5", "topic": "T2", "title": "CF of an LCR circuit (ESA Jan-24 s3 3b, CF part)", "srcs": ["ESA Jan-24 s3 3b"], "stars": 3,
     "given": r"$R=40\,\Omega$, $L=1$ H, $C=16\times10^{-4}$ F: the charge satisfies $q''+40q'+625q=100\cos5t$. Find the CF.",
     "steps": [r"$\frac1{LC}=\frac1{16\times10^{-4}}=625$, so AE $m^2+40m+625=0$.", r"$m=\frac{-40\pm\sqrt{1600-2500}}{2}=-20\pm15i$."],
     "answer": r"$q_{\text{CF}}=e^{-20t}(c_1\cos15t+c_2\sin15t)$",
     "check": "sympy roots agree. The PI and the full answer are in the class 014 (LCR) pack; the CF is the decaying transient."},
    {"id": "W3.1", "topic": "T3", "title": "$y'''+4y'=0$ (slide 002·14)", "srcs": ["S002·14", "T002 00:20:09", "T002 00:21:14", "T002 00:21:38"], "stars": 3,
     "given": r"Solve $\frac{d^3y}{dx^3}+4\frac{dy}{dx}=0$.",
     "steps": [r"$(D^3+4D)y=0$; AE $m^3+4m=0$, i.e. $m(m^2+4)=0$.", r"$m=0$ (real) and $m=\pm2i$ ($\alpha=0$, $\beta=2$).",
               r"$y=c_1e^{0x}+e^{0x}(c_2\cos2x+c_3\sin2x)$."],
     "answer": r"$y=c_1+c_2\cos2x+c_3\sin2x$", "check": "sympy agrees; three constants for a third-order equation."},
    {"id": "W3.2", "topic": "T3", "title": "Two complex pairs: $\\frac{d^4x}{dt^4}+4x=0$ (CW P5)", "srcs": ["CW U2 P5"], "stars": 2,
     "given": r"Solve $\frac{d^4x}{dt^4}+4x=0$.",
     "steps": [r"AE $m^4+4=0$. Write $m^4+4=(m^2+2)^2-4m^2=(m^2-2m+2)(m^2+2m+2)$.",
               r"$m=1\pm i$ and $m=-1\pm i$: two pairs of complex roots, case (iv)."],
     "answer": r"$x=e^{-t}(c_1\cos t+c_2\sin t)+e^{t}(c_3\cos t+c_4\sin t)$", "check": "CW answer agrees; sympy agrees."},
    {"id": "W3.3", "topic": "T3", "title": "A quartic with four real roots (CW P6)", "srcs": ["CW U2 P6"], "stars": 2,
     "given": r"Solve $(4D^4-8D^3-7D^2+11D+6)y=0$.",
     "steps": [r"AE $4m^4-8m^3-7m^2+11m+6=0$. $m=-1$: $4+8-7-11+6=0$ ✓; $m=2$: $64-64-28+22+6=0$ ✓.",
               r"Divide out $(m+1)(m-2)=m^2-m-2$: quotient $4m^2-4m-3=(2m-3)(2m+1)$.",
               r"$m=-1,\ 2,\ \frac32,\ -\frac12$: all real and distinct."],
     "answer": r"$y=c_1e^{-x}+c_2e^{2x}+c_3e^{\frac32x}+c_4e^{-\frac12x}$", "check": "CW answer agrees; sympy roots and dsolve agree."},
    {"id": "W3.4", "topic": "T3", "title": "Repeated complex pair: $y^{iv}+50y''+625y=0$ (CW P7)", "srcs": ["CW U2 P7", "S002·13"], "stars": 2,
     "given": r"Solve $y^{iv}+50y''+625y=0$.",
     "steps": [r"AE $m^4+50m^2+625=(m^2+25)^2=0$.", r"$m=\pm5i$, each twice: case (v) with $\alpha=0$, $\beta=5$."],
     "answer": r"$y=(c_1+c_2x)\cos5x+(c_3+c_4x)\sin5x$", "check": "CW answer agrees; sympy agrees. Figure G3.2."},
    {"id": "W3.5", "topic": "T3", "title": "CF of $(D-1)^2(D+1)^2y=X$ (ESA Jan-24 s4 2c, CW P22)", "srcs": ["ESA Jan-24 s4 2c", "CW U2 P22"], "stars": 3,
     "given": r"Find the CF of $[(D-1)^2(D+1)^2]y=\sin^2\frac x2+2^{-x}+x$.",
     "steps": [r"AE $(m-1)^2(m+1)^2=0$: $m=1$ twice and $m=-1$ twice.", r"One block of E3.2 for each double root."],
     "answer": r"$y_c=(c_1+c_2x)e^{x}+(c_3+c_4x)e^{-x}$", "check": "Agrees with the CW P22 answer; the PI is in the class 005 pack."},
    {"id": "W3.6", "topic": "T3", "title": "CF of $(D^3-2D^2+D)y=X$ (ESA Jan-24 s3 2c, CW P18)", "srcs": ["ESA Jan-24 s3 2c", "CW U2 P18"], "stars": 3,
     "given": r"Find the CF of $(D^3-2D^2+D)y=x^2e^{-x}+\sin^2x$.",
     "steps": [r"AE $m^3-2m^2+m=m(m-1)^2=0$.", r"$m=0$ (simple) gives $c_1$; $m=1$ (double) gives $(c_2+c_3x)e^{x}$."],
     "answer": r"$y_c=c_1+(c_2+c_3x)e^{x}$", "check": "Agrees with the CW P18 answer; the PI is in the class 006 pack."},
    {"id": "W4.1", "topic": "T4", "title": "Complex roots with initial values (CW P3)", "srcs": ["CW U2 P3"], "stars": 2,
     "given": r"Solve $\frac{d^2y}{dx^2}-4\frac{dy}{dx}+5y=0$, $y(0)=2$, $y'(0)=-1$.",
     "steps": [r"AE $m^2-4m+5=0$, $m=2\pm i$: $y=e^{2x}(c_1\cos x+c_2\sin x)$.", r"$y(0)=c_1=2$.",
               r"$y'=e^{2x}\big[(2c_1+c_2)\cos x+(2c_2-c_1)\sin x\big]$, so $y'(0)=2c_1+c_2=-1$ and $c_2=-5$."],
     "answer": r"$y=e^{2x}(2\cos x-5\sin x)$", "check": "CW answer agrees; sympy dsolve with ics agrees; $y(0)=2$, $y'(0)=-1$ ✓."},
    {"id": "W4.2", "topic": "T4", "title": "Fractional roots with initial values (CW P4, homework)", "srcs": ["CW U2 P4"], "stars": 2,
     "given": r"Solve $4y''-8y'+3y=0$, $y(0)=1$, $y'(0)=3$.",
     "steps": [r"AE $4m^2-8m+3=(2m-1)(2m-3)=0$, $m=\frac12,\frac32$: $y=c_1e^{\frac32x}+c_2e^{\frac12x}$.",
               r"$y(0)$: $c_1+c_2=1$. $y'(0)$: $\frac32c_1+\frac12c_2=3$.", r"Subtract half the first: $c_1=\frac52$, $c_2=-\frac32$."],
     "answer": r"$y=\frac12\big(5e^{\frac{3x}{2}}-3e^{\frac x2}\big)$", "check": "CW answer agrees; sympy agrees; $y(0)=1$, $y'(0)=3$ ✓."},
    {"id": "W4.3", "topic": "T4", "title": "Third order with initial values (CW P8)", "srcs": ["CW U2 P8", "ESA Jan-24 s2 2d"], "stars": 3,
     "given": r"Solve $y'''-6y''+11y'-6y=0$, $y(0)=0$, $y'(0)=-4$, $y''(0)=-18$.",
     "steps": [r"AE $m^3-6m^2+11m-6=(m-1)(m-2)(m-3)=0$: $y=c_1e^{x}+c_2e^{2x}+c_3e^{3x}$.",
               r"$c_1+c_2+c_3=0$; $c_1+2c_2+3c_3=-4$; $c_1+4c_2+9c_3=-18$.",
               r"Subtracting: $c_2+2c_3=-4$ and $3c_2+8c_3=-18$, so $c_3=-3$, $c_2=2$, $c_1=1$."],
     "answer": r"$y=e^{x}+2e^{2x}-3e^{3x}$",
     "check": "CW answer agrees; sympy agrees; all three conditions ✓. The same operator is the CF of ESA Jan-24 s2 2d."},
    {"id": "W4.4", "topic": "T4", "title": "Boundary values at $\\pi/2$ (CW P9, homework)", "srcs": ["CW U2 P9"], "stars": 2,
     "given": r"Solve $y''''+13y''+36y=0$, $y(0)=0$, $y''(0)=0$, $y(\frac\pi2)=-1$, $y'(\frac\pi2)=-4$.",
     "steps": [r"AE $m^4+13m^2+36=(m^2+4)(m^2+9)=0$, $m=\pm2i,\pm3i$: $y=c_1\cos2x+c_2\sin2x+c_3\cos3x+c_4\sin3x$.",
               r"$y(0)=c_1+c_3=0$; $y''(0)=-4c_1-9c_3=0$, so $c_1=c_3=0$.",
               r"$y(\frac\pi2)=c_2\sin\pi+c_4\sin\frac{3\pi}2=-c_4=-1$, so $c_4=1$.",
               r"$y'=2c_2\cos2x+3c_4\cos3x$; $y'(\frac\pi2)=-2c_2+0=-4$, so $c_2=2$."],
     "answer": r"$y=2\sin2x+\sin3x$", "check": "CW answer agrees; sympy dsolve with the four conditions agrees. Figure G4.1."},
]

PYQS = [
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 4, Q2.c (CF part)", "marks": 6,
     "text": r"Solve $[(D-1)^2(D+1)^2]y=\sin^2\frac x2+2^{-x}+x$. (CF: two double roots.)", "worked": "W3.5"},
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 3, Q2.c (CF part)", "marks": 6,
     "text": r"Solve $(D^3-2D^2+D)y=x^2e^{-x}+\sin^2x$. (CF: a zero root and a double root.)", "worked": "W3.6"},
    {"topic": "T4", "paper": "ESA Jan 2024", "q": "UE23MA141A set 2, Q2.d (CF part)", "marks": 5,
     "text": r"Solve $(D^3-6D^2+11D-6)y=e^{2x}+x$. (CF: roots 1, 2, 3, as in CW P8.)", "worked": "W4.3"},
    {"topic": "T2", "paper": "ESA Jan 2024", "q": "UE23MA141A set 3, Q3.b (CF part)", "marks": 6,
     "text": r"Series circuit: $R=40\,\Omega$, $L=1$ H, $C=16\times10^{-4}$ F, $E=100\cos5t$. Find the charge at any time $t$. (CF: complex roots.)", "worked": "W2.5"},
    {"topic": "T2", "paper": "ESA Dec 2023", "q": "UE22MA141A Q3.a (CF part; also May 2024 Q3.b, June 2024 Q2.a)", "marks": 7,
     "text": r"Solve $(D-2)^2y=8(e^{2x}+\sin2x)$. (CF: $(c_1+c_2x)e^{2x}$, a double root.)", "worked": "W2.2"},
]

NOTES = [
    {"topic": "T1", "text": r"For $f(D)y=0$ with constant coefficients, put $y=e^{mx}$: $f(D)e^{mx}=f(m)e^{mx}=0$, and $e^{mx}\ne0$, so $f(m)=0$, the auxiliary "
     r"(characteristic) equation. Write it by replacing $D$ by $m$ (or $y\to1$, $y'\to m$, $y''\to m^2$). Its roots decide the form of the complementary function, "
     r"the general solution of the homogeneous equation, which has as many arbitrary constants as the order."},
    {"topic": "T2", "text": r"$y''+k_1y'+k_2y=0$, AE $m^2+k_1m+k_2=0$. Real distinct $m_1,m_2$: $c_1e^{m_1x}+c_2e^{m_2x}$ ($-3,1$: $c_1e^{-3x}+c_2e^x$). "
     r"Real equal $m$: $(c_1+c_2x)e^{mx}$ ($-2,-2$: $(c_1+c_2x)e^{-2x}$). Complex $\alpha\pm i\beta$: $e^{\alpha x}(c_1\cos\beta x+c_2\sin\beta x)$ "
     r"($2\pm3i$: $e^{2x}(c_1\cos3x+c_2\sin3x)$)."},
    {"topic": "T3", "text": r"Order $n$: $n$ roots, $n$ constants. Each simple real root: $ce^{mx}$; a $k$-fold real root: $(c_1+\dots+c_kx^{k-1})e^{mx}$; each complex "
     r"pair: $e^{\alpha x}(c\cos\beta x+c'\sin\beta x)$; a complex pair twice: $e^{\alpha x}[(c_1+c_2x)\cos\beta x+(c_3+c_4x)\sin\beta x]$; a zero root: a constant. "
     r"Add the blocks. $y'''+4y'=0$: $c_1+c_2\cos2x+c_3\sin2x$."},
    {"topic": "T4", "text": r"Initial values: write the general solution, differentiate, substitute, solve for the constants. CW: P3 $e^{2x}(2\cos x-5\sin x)$; "
     r"P4 $\frac12(5e^{3x/2}-3e^{x/2})$; P8 $e^x+2e^{2x}-3e^{3x}$; P9 $2\sin2x+\sin3x$. All nine CW answers check out."},
]

FIGS = [
    {"id": "G2.1", "topic": "T2", "title": "The three second-order cases from the same start", "stars": 3,
     "srcs": ["S002·7", "S002·8", "S002·9"], "flags": [ADD],
     "howto": r"Each curve solves a second-order equation with $y(0)=1$, $y'(0)=0$. Distinct roots $-1,-2$ ($y''+3y'+2y=0$, blue) and the double root "
              r"$-1$ ($y''+2y'+y=0$, vermilion dashed) decay without crossing zero; the double root is the fastest return that does not oscillate. "
              r"Complex roots $-1\pm2i$ ($y''+2y'+5y=0$, green) oscillate inside the decaying envelope $e^{-x}$. Each solution was found and checked with sympy."},
    {"id": "G2.2", "topic": "T2", "title": "Where the roots lie decides the shape of the solution", "stars": 2,
     "srcs": ["S002·7", "S002·8", "S002·9", "S002·14"], "flags": [ADD],
     "howto": r"The roots of the four slide examples in the complex plane: $-3,1$ (slide 002·7, circles), $-2$ twice (slide 002·8, square), $2\pm3i$ "
              r"(slide 002·9, triangles), $0,\pm2i$ (slide 002·14, diamonds). The real part $\alpha$ gives growth ($\alpha>0$) or decay ($\alpha<0$, green half-plane); the imaginary "
              r"part $\beta$ gives oscillation $\cos\beta x$, $\sin\beta x$. Roots on the real axis give no oscillation."},
    {"id": "G3.1", "topic": "T3", "title": "A triple root $m=-1$: the three solutions $x^ke^{-x}$", "stars": 2,
     "srcs": ["S002·12", "T002 00:15:15"], "flags": [ADD],
     "howto": r"For $(D+1)^3y=0$ the CF is $(c_1+c_2x+c_3x^2)e^{-x}$. The three curves $e^{-x}$, $xe^{-x}$, $x^2e^{-x}$ have different shapes (peaks at "
              r"$x=0,1,2$), so they are independent and give three constants. All three still decay because $m<0$."},
    {"id": "G3.2", "topic": "T3", "title": "A repeated complex pair: $\\cos5x$ against $x\\cos5x$", "stars": 2,
     "srcs": ["CW U2 P7", "S002·13"], "flags": [ADD],
     "howto": r"For CW P7 the roots $\pm5i$ occur twice. A simple pair would give the bounded $\cos5x$ (blue); the repeat adds $x\cos5x$ (vermilion dashed), "
              r"whose amplitude grows linearly between the grey lines $y=\pm x$, although $\alpha=0$."},
    {"id": "G4.1", "topic": "T4", "title": "The solution of CW P9 meets its four conditions", "stars": 2,
     "srcs": ["CW U2 P9"], "flags": [ADD],
     "howto": r"$y=2\sin2x+\sin3x$ (blue) passes through the origin with $y''(0)=0$ (black dot) and through $(\frac\pi2,-1)$ (vermilion dot) with slope "
              r"$-4$ (vermilion dashed tangent). Four conditions fix the four constants of a fourth-order equation."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "Finding the complementary function", "stars": 3,
     "srcs": ["T002 00:03:18", "T002 00:07:40", "T002 00:08:07", "T002 00:20:41"], "layout": "straight", "maxw": "130mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$f(D)y=0$ (or $f(D)y=X$)", "sub": "constant coefficients"},
         {"kind": "step", "n": 1, "title": "Write the AE", "fx": "replace $D$ by $m$: $f(m)=0$"},
         {"kind": "step", "n": 2, "title": "Factorise, find all $n$ roots", "fx": "trial roots, quadratic formula"},
         {"kind": "step", "n": 3, "title": "Classify each root", "fx": "real or complex; simple or repeated (Figure F3.1)"},
         {"kind": "step", "n": 4, "title": "Write one block per root", "fx": "number the constants $c_1,\\dots,c_n$"},
         {"kind": "result", "title": "CF", "fx": "sum of the blocks"}]},
     "remark": "Check: exactly $n$ constants for an $n$-th order equation. For a non-homogeneous equation this CF is half of the answer: $y=\\text{CF}+\\text{PI}$."},
    {"id": "F2.1", "topic": "T2", "title": "Which case? A second-order equation", "stars": 3,
     "srcs": ["S002·7", "S002·8", "S002·9", "T002 00:11:56"], "layout": "ladder", "maxw": "165mm",
     "spec": {"start": {"kind": "given", "title": "AE $m^2+k_1m+k_2=0$", "sub": "Compute $\\Delta=k_1^2-4k_2$"},
              "rungs": [{"q": "Is $\\Delta>0$?", "yes": {"lab": "", "title": "Case I: $c_1e^{m_1x}+c_2e^{m_2x}$", "sub": "real distinct roots"}},
                        {"q": "Is $\\Delta=0$?", "yes": {"lab": "", "title": "Case II: $(c_1+c_2x)e^{mx}$", "sub": "$m=-k_1/2$ twice"}}],
              "last": {"kind": "result", "title": "Case III: $e^{\\alpha x}(c_1\\cos\\beta x+c_2\\sin\\beta x)$", "fx": "$\\alpha=-\\tfrac{k_1}{2}$, $\\beta=\\tfrac{\\sqrt{-\\Delta}}{2}$"}},
     "remark": "The discriminant test is added for clarity; the slides classify the roots after solving the AE.", "flags": [ADD]},
    {"id": "F3.1", "topic": "T3", "title": "Which CF block does each root give?", "stars": 3,
     "srcs": ["S002·11", "S002·12", "S002·13", "S002·14", "T002 00:19:14"], "layout": "route", "maxw": "165mm",
     "spec": {"question": "What kind of root is it?",
              "rows": [{"title": "Real, simple: $m$", "sub": "case (i)", "kw": "$c\\,e^{mx}$"},
                       {"title": "Real, repeated $k$ times", "sub": "cases (ii), (iii)", "kw": "$(c_1+\\dots+c_kx^{k-1})e^{mx}$"},
                       {"title": "Zero, simple", "sub": "slide 002·14", "kw": "$c$"},
                       {"title": "Complex pair $\\alpha\\pm i\\beta$, simple", "sub": "cases III, (iv)", "kw": "$e^{\\alpha x}(c\\cos\\beta x+c'\\sin\\beta x)$"},
                       {"title": "Complex pair, twice", "sub": "case (v)", "kw": "$e^{\\alpha x}[(c_1+c_2x)\\cos\\beta x+(c_3+c_4x)\\sin\\beta x]$"},
                       {"title": "Complex pair, three times", "sub": "lecture only", "kw": "polynomials up to $x^2$", "dashed": True}]},
     "remark": "Add the blocks for all the roots. The dashed route is from the lecture (T002 00:19:14), not the slides."},
    {"id": "F4.1", "topic": "T4", "title": "Constants from initial conditions (CW P8)", "stars": 2, "srcs": ["CW U2 P8"],
     "layout": "straight", "maxw": "130mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$y'''-6y''+11y'-6y=0$", "sub": "$y(0)=0$, $y'(0)=-4$, $y''(0)=-18$"},
         {"kind": "step", "n": 1, "title": "General solution", "fx": "$y=c_1e^{x}+c_2e^{2x}+c_3e^{3x}$"},
         {"kind": "step", "n": 2, "title": "Differentiate twice", "fx": "$y'=c_1e^x+2c_2e^{2x}+3c_3e^{3x}$, …"},
         {"kind": "step", "n": 3, "title": "Substitute $x=0$", "fx": "$c_1+c_2+c_3=0$, $c_1+2c_2+3c_3=-4$, $c_1+4c_2+9c_3=-18$"},
         {"kind": "step", "n": 4, "title": "Solve the system", "fx": "$c_1=1,\\ c_2=2,\\ c_3=-3$"},
         {"kind": "result", "title": "Particular solution", "fx": "$y=e^x+2e^{2x}-3e^{3x}$"}]},
     "remark": "Use as many conditions as the order. Check by substituting back into all of them."},
]

COMPARISONS = [
    {"id": "C2.1", "topic": "T2", "title": "The three second-order cases", "srcs": ["S002·7", "S002·8", "S002·9"],
     "head": ["Roots of AE", "CF", "Slide example", "Answer", "Shape (Figure G2.1)"],
     "rows": [["real, distinct $m_1\\ne m_2$", "$c_1e^{m_1x}+c_2e^{m_2x}$", "$y''+2y'-3y=0$", "$c_1e^{-3x}+c_2e^{x}$", "sum of exponentials"],
              ["real, equal $m$", "$(c_1+c_2x)e^{mx}$", "$y''+4y'+4y=0$", "$(c_1+c_2x)e^{-2x}$", "no oscillation"],
              ["complex $\\alpha\\pm i\\beta$", "$e^{\\alpha x}(c_1\\cos\\beta x+c_2\\sin\\beta x)$", "$y''-4y'+13y=0$", "$e^{2x}(c_1\\cos3x+c_2\\sin3x)$", "oscillates; envelope $e^{\\alpha x}$"]]},
    {"id": "C3.1", "topic": "T3", "title": "The five order-$n$ cases of slides 002·11–13", "srcs": ["S002·11", "S002·12", "S002·13"],
     "head": ["Case", "Roots", "General solution"],
     "rows": [["(i)", "all real, distinct", "$c_1e^{m_1x}+\\dots+c_ne^{m_nx}$"],
              ["(ii)", "all real, equal to $m$", "$(c_1+c_2x+\\dots+c_nx^{n-1})e^{mx}$"],
              ["(iii)", "four equal to $m$, rest distinct", "$(c_1+c_2x+c_3x^2+c_4x^3)e^{mx}+c_5e^{m_5x}+\\dots$"],
              ["(iv)", "$\\alpha\\pm i\\beta$, $\\gamma\\pm i\\delta$, rest distinct", "$e^{\\alpha x}(c_1\\cos\\beta x+c_2\\sin\\beta x)+e^{\\gamma x}(c_3\\cos\\delta x+c_4\\sin\\delta x)+\\dots$"],
              ["(v)", "$\\alpha\\pm i\\beta$ twice, rest distinct", "$e^{\\alpha x}[(c_1+c_2x)\\cos\\beta x+(c_3+c_4x)\\sin\\beta x]+\\dots$"]]},
    {"id": "C4.1", "topic": "T4", "title": "Class-work problems 1–9 at a glance", "srcs": ["CW U2 P1", "CW U2 P5", "CW U2 P9"],
     "head": ["CW", "Roots", "Case", "Answer (verified)"],
     "rows": [["P1", "$6,-2$", "distinct", "$c_1e^{6x}+c_2e^{-2x}$"],
              ["P2", "$-2,-2$", "equal", "$(c_1+c_2x)e^{-2x}$"],
              ["P3", "$2\\pm i$", "complex + IVP", "$e^{2x}(2\\cos x-5\\sin x)$"],
              ["P4", "$\\frac32,\\frac12$", "distinct + IVP", "$\\frac12(5e^{3x/2}-3e^{x/2})$"],
              ["P5", "$1\\pm i,\\ -1\\pm i$", "two complex pairs", "$e^{-t}(c_1\\cos t+c_2\\sin t)+e^{t}(c_3\\cos t+c_4\\sin t)$"],
              ["P6", "$-1,2,\\frac32,-\\frac12$", "distinct", "$c_1e^{-x}+c_2e^{2x}+c_3e^{3x/2}+c_4e^{-x/2}$"],
              ["P7", "$\\pm5i$ twice", "repeated complex", "$(c_1+c_2x)\\cos5x+(c_3+c_4x)\\sin5x$"],
              ["P8", "$1,2,3$", "distinct + IVP", "$e^x+2e^{2x}-3e^{3x}$"],
              ["P9", "$\\pm2i,\\pm3i$", "complex + BVP", "$2\\sin2x+\\sin3x$"]]},
    {"id": "C4.2", "topic": "T4", "title": "The CF inside every distinct Unit 2 ESA question", "flags": [ADD],
     "srcs": ["ESA Dec-23 3a", "ESA Dec-23 3b", "ESA Dec-23 3c", "ESA Jul-23 3a", "ESA Jul-23 3b", "ESA Jul-23 3c", "ESA May-24 3c",
              "ESA Jan-24 s1 2d", "ESA Jan-24 s1 3a", "ESA Jan-24 s1 3c", "ESA Jan-24 s2 2d", "ESA Jan-24 s2 3a", "ESA Jan-24 s2 3c",
              "ESA Jan-24 s3 2c", "ESA Jan-24 s3 3b", "ESA Jan-24 s3 3d", "ESA Jan-24 s4 2c", "ESA Jan-24 s4 3b", "ESA Jun-24 3b"],
     "head": ["Paper, Q", "AE (after substitution)", "Roots", "CF"],
     "rows": [["Dec-23 3a (= May-24 3b, Jun-24 2a)", "$(m-2)^2$", "$2,2$", "$(c_1+c_2x)e^{2x}$"],
              ["Dec-23 3b", "$\\theta^2+1$, $z=\\log(1+x)$", "$\\pm i$", "$c_1\\cos z+c_2\\sin z$"],
              ["Dec-23 3c", "$m^2+3m+2$", "$-1,-2$", "$c_1e^{-x}+c_2e^{-2x}$"],
              ["Jul-23 3a (= May-24 3a)", "$4(\\theta-2)^2$, $z=\\log(2x+1)$", "$2,2$", "$(c_1+c_2z)e^{2z}$"],
              ["Jul-23 3b", "$m^2-5m+6$", "$2,3$", "$c_1e^{2x}+c_2e^{3x}$"],
              ["Jul-23 3c (= Jun-24 3a)", "$(m+3)^2$", "$-3,-3$", "$(c_1+c_2x)e^{-3x}$"],
              ["May-24 3c", "$(m-1)^2$", "$1,1$", "$(c_1+c_2x)e^{x}$"],
              ["Jan-24 s1 2d", "$m^2+4$", "$\\pm2i$", "$c_1\\cos2x+c_2\\sin2x$"],
              ["Jan-24 s1 3a", "$m^2-2m+2$", "$1\\pm i$", "$e^{x}(c_1\\cos x+c_2\\sin x)$"],
              ["Jan-24 s1 3c", "$4(\\theta-3)(\\theta+1)$, $z=\\log(2x+1)$", "$3,-1$", "$c_1e^{3z}+c_2e^{-z}$"],
              ["Jan-24 s2 2d", "$(m-1)(m-2)(m-3)$", "$1,2,3$", "$c_1e^{x}+c_2e^{2x}+c_3e^{3x}$"],
              ["Jan-24 s2 3a", "$m^2+2m+2$", "$-1\\pm i$", "$e^{-x}(c_1\\cos x+c_2\\sin x)$"],
              ["Jan-24 s2 3c", "$(\\theta-1)^2$, $z=\\log(x+2)$", "$1,1$", "$(c_1+c_2z)e^{z}$"],
              ["Jan-24 s3 2c", "$m(m-1)^2$", "$0,1,1$", "$c_1+(c_2+c_3x)e^{x}$"],
              ["Jan-24 s3 3b (LCR)", "$m^2+40m+625$", "$-20\\pm15i$", "$e^{-20t}(c_1\\cos15t+c_2\\sin15t)$"],
              ["Jan-24 s3 3d (= s4 3c)", "$(\\theta-2)(\\theta-3)$, $z=\\log x$", "$2,3$", "$c_1x^2+c_2x^3$"],
              ["Jan-24 s4 2c", "$(m-1)^2(m+1)^2$", "$1,1,-1,-1$", "$(c_1+c_2x)e^{x}+(c_3+c_4x)e^{-x}$"],
              ["Jan-24 s4 3b (LCR)", "$m^2+20m+500$", "$-10\\pm20i$", "$e^{-10t}(c_1\\cos20t+c_2\\sin20t)$"],
              ["Jun-24 3b", "$2(\\theta-1)(2\\theta+1)$, $z=\\log(2x-1)$", "$1,-\\frac12$", "$c_1e^{z}+c_2e^{-z/2}$"]]},
]

SYMBOLS = [
    {"sym": "$D$", "name": "Differential operator", "meaning": r"$\frac{d}{dx}$; $D^2=\frac{d^2}{dx^2}$", "where": "E1.2"},
    {"sym": "$f(D)$", "name": "Linear differential operator", "meaning": r"$D^n+k_1D^{n-1}+\dots+k_n$", "where": "E1.2"},
    {"sym": "$f(m)$", "name": "Auxiliary polynomial", "meaning": r"$f(D)$ with $D$ replaced by $m$", "where": "E1.2"},
    {"sym": "$m,\\ m_1,\\dots,m_n$", "name": "Roots of the AE", "meaning": "Exponents of the trial solution $e^{mx}$", "where": "E2.1–E3.5"},
    {"sym": "$k_1,\\dots,k_n$", "name": "Constant coefficients", "meaning": "Given numbers in the DE", "where": "E1.2, E2.4"},
    {"sym": "$c_1,\\dots,c_n$", "name": "Arbitrary constants", "meaning": "$n$ of them for order $n$; fixed by initial conditions", "where": "all"},
    {"sym": "$\\alpha,\\ \\beta$", "name": "Real and imaginary parts", "meaning": r"Of a complex root $\alpha\pm i\beta$ ($\beta>0$)", "where": "E2.3, E3.4, E3.5"},
    {"sym": "$\\gamma,\\ \\delta$", "name": "Second complex pair", "meaning": r"$\gamma\pm i\delta$ in case (iv)", "where": "E3.4"},
    {"sym": "$\\Delta$", "name": "Discriminant", "meaning": r"$k_1^2-4k_2$ (added for clarity)", "where": "F2.1"},
    {"sym": "$k$", "name": "Multiplicity", "meaning": r"Times a root is repeated. Not the coefficients $k_1,k_2$", "where": "E3.2"},
    {"sym": "$\\theta,\\ z$", "name": "Legendre/Cauchy substitution", "meaning": r"$z=\log(ax+b)$, $\theta=\frac{d}{dz}$ (classes 011; table C4.2 only)", "where": "C4.2"},
]

KEYWORDS = [
    {"term": "Homogeneous LDE", "meaning": r"$f(D)y=0$, right-hand side zero.", "topic": "T1"},
    {"term": "Constant coefficients", "meaning": r"$k_1,\dots,k_n$ are numbers, not functions of $x$.", "topic": "T1"},
    {"term": "Trial solution", "meaning": r"$y=e^{mx}$.", "topic": "T1"},
    {"term": "Auxiliary equation", "meaning": r"$f(m)=0$; also called the characteristic equation.", "topic": "T1"},
    {"term": "Auxiliary polynomial", "meaning": r"$f(m)$.", "topic": "T1"},
    {"term": "Complementary function", "meaning": "General solution of the homogeneous equation.", "topic": "T1"},
    {"term": "Arbitrary constants", "meaning": "As many as the order.", "topic": "T1"},
    {"term": "Real and distinct roots", "meaning": r"$c_1e^{m_1x}+c_2e^{m_2x}$.", "topic": "T2"},
    {"term": "Real and equal roots", "meaning": r"$(c_1+c_2x)e^{mx}$.", "topic": "T2"},
    {"term": "Complex (imaginary) roots", "meaning": r"$e^{\alpha x}(c_1\cos\beta x+c_2\sin\beta x)$.", "topic": "T2"},
    {"term": "Conjugate pair", "meaning": r"$\alpha\pm i\beta$; complex roots come in pairs.", "topic": "T2"},
    {"term": "Discriminant", "meaning": r"$k_1^2-4k_2$: sign picks the case.", "topic": "T2"},
    {"term": "Multiplicity", "meaning": "How often a root repeats.", "topic": "T3"},
    {"term": "k-fold root", "meaning": r"Polynomial $c_1+\dots+c_kx^{k-1}$ times $e^{mx}$.", "topic": "T3"},
    {"term": "Repeated complex pair", "meaning": r"$(c_1+c_2x)\cos\beta x+(c_3+c_4x)\sin\beta x$.", "topic": "T3"},
    {"term": "Zero root", "meaning": "Gives a constant term.", "topic": "T3"},
    {"term": "Block", "meaning": "The CF part contributed by one root or pair.", "topic": "T3"},
    {"term": "Initial conditions", "meaning": r"Values of $y,y',\dots$ at one point: fix the constants.", "topic": "T4"},
    {"term": "Boundary conditions", "meaning": r"Conditions at different points (CW P9 at $0$ and $\frac\pi2$).", "topic": "T4"},
    {"term": "Particular solution", "meaning": "The general solution with the constants fixed.", "topic": "T4"},
]

RAPID = [
    {"q": "Trial solution for $f(D)y=0$?", "a": "$y=e^{mx}$."},
    {"q": "Auxiliary equation of $(D^2+k_1D+k_2)y=0$?", "a": "$m^2+k_1m+k_2=0$."},
    {"q": "Why can we cancel $e^{mx}$?", "a": "$e^{mx}\\ne0$ for every real $x$."},
    {"q": "Another name for the AE?", "a": "Characteristic equation."},
    {"q": "CF for real distinct roots $m_1,m_2$?", "a": "$c_1e^{m_1x}+c_2e^{m_2x}$."},
    {"q": "CF for a double root $m$?", "a": "$(c_1+c_2x)e^{mx}$."},
    {"q": "CF for $\\alpha\\pm i\\beta$?", "a": "$e^{\\alpha x}(c_1\\cos\\beta x+c_2\\sin\\beta x)$."},
    {"q": "$y''+2y'-3y=0$?", "a": "$c_1e^{-3x}+c_2e^{x}$."},
    {"q": "$y''+4y'+4y=0$?", "a": "$(c_1+c_2x)e^{-2x}$."},
    {"q": "$y''-4y'+13y=0$?", "a": "$e^{2x}(c_1\\cos3x+c_2\\sin3x)$."},
    {"q": "$y'''+4y'=0$?", "a": "$c_1+c_2\\cos2x+c_3\\sin2x$."},
    {"q": "Root repeated 3 times?", "a": "$(c_1+c_2x+c_3x^2)e^{mx}$."},
    {"q": "Complex pair repeated twice?", "a": "$e^{\\alpha x}[(c_1+c_2x)\\cos\\beta x+(c_3+c_4x)\\sin\\beta x]$."},
    {"q": "Number of arbitrary constants for order $n$?", "a": "$n$."},
    {"q": "$m^4+4=0$ factorises as?", "a": "$(m^2-2m+2)(m^2+2m+2)$, roots $\\pm1\\pm i$."},
    {"q": "$y^{iv}+50y''+625y=0$?", "a": "$(c_1+c_2x)\\cos5x+(c_3+c_4x)\\sin5x$."},
    {"q": "CF of $(D^3-2D^2+D)y=X$?", "a": "$c_1+(c_2+c_3x)e^{x}$."},
    {"q": "CW P8 answer?", "a": "$e^x+2e^{2x}-3e^{3x}$."},
    {"q": "CW P9 answer?", "a": "$2\\sin2x+\\sin3x$."},
]

MNEMONICS = [
    "<i>“Distinct: add; equal: times $x$; complex: cos and sin.”</i> The three cases in one line (study aid).",
    "<i>“$k$ repeats, powers up to $k-1$.”</i> The polynomial in front of a repeated root (study aid).",
]

TOP_FACTS = [
    "$y=e^{mx}$ turns $f(D)y=0$ into the AE $f(m)=0$: replace $D$ by $m$.",
    "Distinct: $c_1e^{m_1x}+c_2e^{m_2x}$. Equal: $(c_1+c_2x)e^{mx}$. Complex $\\alpha\\pm i\\beta$: $e^{\\alpha x}(c_1\\cos\\beta x+c_2\\sin\\beta x)$.",
    "$k$-fold root: $(c_1+\\dots+c_kx^{k-1})e^{mx}$. Repeated complex pair: $(c_1+c_2x)\\cos\\beta x+(c_3+c_4x)\\sin\\beta x$, times $e^{\\alpha x}$.",
    "Zero root gives a constant; $\\pm i\\beta$ gives $\\cos\\beta x$, $\\sin\\beta x$ with no exponential.",
    "Order $n$ = number of roots = number of constants.",
    "Initial conditions: general solution → differentiate → substitute → solve for $c$'s → check.",
    "ESA: no homogeneous-only question, but all 24 Unit 2 question occurrences need a CF (table C4.2).",
]
TOP_FORMULAS = ["E1.2", "E2.1", "E2.2", "E2.3", "E3.2", "E3.5", "E3.7"]
