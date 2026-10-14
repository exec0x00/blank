"""Class 006: problems on Euler's theorem."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "Testing homogeneity: the scaling test",
     "overview": "Before Euler's theorem can be used, you must show the function is homogeneous and find its degree. Class 006 "
                 "does this with the scaling test: replace $x$ by $\\lambda x$ and $y$ by $\\lambda y$; if the result is "
                 "$\\lambda^n u(x,y)$, then $u$ is homogeneous of degree $n$. The degree can be positive, negative or zero; "
                 "if no power of $\\lambda$ factors out, the function is not homogeneous."},
    {"id": "T2", "title": "Verifying Euler's theorem directly",
     "overview": "To verify the theorem, compute both sides separately: find the degree $n$, then differentiate, form "
                 "$xu_x+yu_y$ and simplify until it equals $nu$. Slide 006·3 does this for $Z=\\frac{x+y}{\\sqrt x+\\sqrt y}$ "
                 "with the quotient rule. It is long; in every other problem the theorem is applied, not verified."},
    {"id": "T3", "title": "When u itself is homogeneous: first and second order",
     "overview": "If $u$ is homogeneous of degree $n$, write the answers down: $xu_x+yu_y=nu$ and "
                 "$x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=n(n-1)u$; their sum is $n^2u$. For a sum of parts with different degrees, "
                 "apply the result to each part with its own degree. Most ESA questions on Euler's theorem are of this type."},
    {"id": "T4", "title": "When f(u) is homogeneous: the extension",
     "overview": "For $u=\\sin^{-1}(\\dots)$, $\\tan^{-1}(\\dots)$, $\\log(\\dots)$ or $e^{(\\dots)}$, $u$ is not homogeneous, but undoing "
                 "the outer function gives a homogeneous $f(u)$: $\\sin u$, $\\tan u$, $e^u$ or $\\log u$. If $f(u)$ has degree "
                 "$n$, then $xu_x+yu_y=g(u)=n\\,f(u)/f'(u)$ and the second-order sum is $g(u)[g'(u)-1]$. Class 006 works four "
                 "such problems; ESA May and June 2024 ask the $\\tan^{-1}$ case."},
]

DEFS = [
    {"topic": "T1", "term": "Homogeneous function (scaling form)", "text": "$u(x,y)$ is homogeneous of degree $n$ if "
     "$u(\\lambda x,\\lambda y)=\\lambda^n\\,u(x,y)$. Here $n$ can be positive, negative or even zero.",
     "srcs": ["S006·5", "T006b 00:00:52", "T006b 00:01:11"]},
    {"topic": "T1", "term": "Not homogeneous", "text": "$u$ is not homogeneous when $u(\\lambda x,\\lambda y)\\ne\\lambda^n u(x,y)$ "
     "for every $n$: no single power of $\\lambda$ can be taken out.", "srcs": ["S006·8", "T006b 00:04:59"]},
    {"topic": "T4", "term": "Extension function g(u)", "text": "$g(u)=n\\dfrac{f(u)}{f'(u)}$, where $f(u)$ is homogeneous of degree $n$ "
     "in $x$ and $y$.", "srcs": ["S006·13", "S006·15", "S006·17"]},
]

STATEMENTS = [
    {"topic": "T2", "text": "Euler's theorem: if $u=f(x,y)$ is a homogeneous function of degree $n$, then $x\\dfrac{\\partial u}{\\partial x}+y\\dfrac{\\partial u}{\\partial y}=nu$.",
     "srcs": ["S006·10", "T006a 00:00:00"]},
    {"topic": "T3", "text": "By Euler's theorem for a homogeneous function of degree $n$: $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=n(n-1)u$.",
     "srcs": ["S006·11"]},
    {"topic": "T4", "text": "For $f(u)$ a homogeneous function of degree $n$: $xu_x+yu_y=n\\left(\\dfrac{f(u)}{f'(u)}\\right)=g(u)$, and "
     "$x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=g(u)\\,[g'(u)-1]$.", "srcs": ["S006·13", "S006·15", "S006·17"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Scaling test", "tex": r"u(\lambda x,\lambda y)=\lambda^n\,u(x,y)\ \Longrightarrow\ u\ \text{homogeneous of degree } n",
     "gives": "Whether $u$ is homogeneous, and its degree.", "when": "Any function; with three variables scale $z$ too.",
     "note": "If no power $\\lambda^n$ factors out, $u$ is not homogeneous.", "stars": 2, "srcs": ["S006·5", "T006b 00:00:52"]},
    {"id": "E1.2", "topic": "T1", "title": "Degree of a quotient", "tex": r"\deg\frac{P}{Q}=\deg P-\deg Q",
     "gives": "The degree without writing out $\\lambda$.", "when": "$P$, $Q$ homogeneous.",
     "note": "$\\frac{x+2y+3z}{\\sqrt{x^8+y^8+z^8}}$: $1-4=-3$.", "stars": 2, "srcs": ["S006·4", "T006a 00:06:10"], "flags": [ADD]},
    {"id": "E2.1", "topic": "T2", "title": "Euler's theorem", "tex": r"x\frac{\partial u}{\partial x}+y\frac{\partial u}{\partial y}=n\,u",
     "gives": "The first-order Euler sum.", "when": "$u$ homogeneous of degree $n$; add $z\\,u_z$ for three variables.",
     "note": "To verify, compute the left side by differentiating and show it equals $nu$.", "stars": 3, "srcs": ["S006·3", "S006·10", "T006a 00:00:00"]},
    {"id": "E3.1", "topic": "T3", "title": "Second order", "tex": r"x^2u_{xx}+2xy\,u_{xy}+y^2u_{yy}=n(n-1)\,u",
     "gives": "The second-order Euler sum.", "when": "$u$ homogeneous of degree $n$.",
     "note": "$n=-1$ gives $2u$; $n=-\\tfrac23$ gives $\\tfrac{10}{9}u$.", "stars": 3, "srcs": ["S006·11", "T006b 00:07:23"]},
    {"id": "E3.2", "topic": "T3", "title": "First plus second order", "tex": r"x^2u_{xx}+2xy\,u_{xy}+y^2u_{yy}+x\,u_x+y\,u_y=n^2u",
     "gives": "The combination asked in ESA Jan 2024 sets 3 and 4.", "when": "$u$ homogeneous of degree $n$; for $u_1+u_2$ use $n_1^2u_1+n_2^2u_2$.",
     "note": "$n(n-1)+n=n^2$.", "stars": 3, "srcs": ["ESA Jan-24 s3 1c", "ESA Jan-24 s4 1d", "CW U1 P23"], "flags": [ADD]},
    {"id": "E4.1", "topic": "T4", "title": "Extension, first order", "tex": r"x\frac{\partial u}{\partial x}+y\frac{\partial u}{\partial y}=n\frac{f(u)}{f'(u)}=g(u)",
     "gives": "The Euler sum when $u$ is not homogeneous but $f(u)$ is.", "when": "$f(u)$ homogeneous of degree $n$; add $z\\,u_z$ for three variables.",
     "note": "$\\sin\\to n\\tan u$, $\\tan\\to\\tfrac n2\\sin2u$, $e^u\\to n$, $\\log\\to nu\\log u$.", "stars": 3,
     "srcs": ["S006·13", "S006·15", "S006·17", "T006b 00:09:08"]},
    {"id": "E4.2", "topic": "T4", "title": "Extension, second order", "tex": r"x^2u_{xx}+2xy\,u_{xy}+y^2u_{yy}=g(u)\,\big[g'(u)-1\big]",
     "gives": "The second-order sum for the extension.", "when": "$g$ from E4.1; differentiate $g$ with respect to $u$.",
     "note": "If $g$ is a constant (the $\\log$ case), the answer is $-g$.", "stars": 3, "srcs": ["S006·15", "S006·17", "T006b 00:10:59"]},
    {"id": "E4.3", "topic": "T4", "title": "Deriving the extension by the chain rule", "tex": r"F=f(u):\ xF_x+yF_y=nF,\quad F_x=f'(u)\,u_x\ \Rightarrow\ f'(u)\,(xu_x+yu_y)=n f(u)",
     "gives": "Where E4.1 comes from; T006a works slide 006·4 this way.", "when": "When you prefer not to quote E4.1.",
     "note": "On slide 006·4: $\\cos u\\,(xu_x+yu_y+zu_z)=-3\\sin u$; divide by $\\cos u$.", "stars": 2, "srcs": ["S006·4", "T006a 00:07:33", "T006a 00:08:22"]},
]

POINTS = [
    {"topic": "T1", "text": "Write $u(\\lambda x,\\lambda y)$, take the highest power of $\\lambda$ out of the numerator and the denominator, and cancel.", "stars": 2, "srcs": ["S006·5", "T006b 00:02:17"]},
    {"topic": "T1", "text": "A $\\lambda$ inside a ratio cancels: $\\sin^{-1}\\frac{\\lambda y}{\\lambda x}=\\sin^{-1}\\frac yx$, so functions of $y/x$ add degree 0.", "stars": 2, "srcs": ["S006·6", "T006b 00:03:34"]},
    {"topic": "T1", "text": "$e^{\\lambda x}$ cannot be written as $\\lambda^n e^x$, so exponentials of $x$ or $y$ alone break homogeneity (slide 006·8).", "stars": 2, "srcs": ["S006·8", "T006b 00:04:40"]},
    {"topic": "T1", "text": "Simplify first when you can: slide 006·5 is $\\frac{(x^2+y^2)^2}{(x^2+y^2)^2}=1$ and slide 006·7 is $\\frac{xy(x+y)}{(x+y)^3}=\\frac{xy}{(x+y)^2}$; both have degree 0.", "stars": 1, "srcs": ["S006·5", "S006·7"], "flags": [ADD]},
    {"topic": "T2", "text": "Verification is a check of the theorem, not a method: the lecture spends four minutes on slide 006·3; applying the theorem takes one line.", "stars": 1, "srcs": ["T006a 00:04:57", "T006a 00:08:41"]},
    {"topic": "T2", "text": "In slide 006·3, group the terms with the common denominator $(\\sqrt x+\\sqrt y)^2$ and cancel one factor of $\\sqrt x+\\sqrt y$.", "stars": 1, "srcs": ["T006a 00:02:59", "T006a 00:03:17"]},
    {"topic": "T3", "text": "First prove that $u$ is homogeneous and find $n$; then write both answers without differentiating.", "stars": 3, "srcs": ["T006b 00:06:11", "T006b 00:06:45"]},
    {"topic": "T3", "text": "Give the answer in terms of $x$ and $y$ too: $-u=-\\frac{x-y}{x^2+y^2}$ and $2u=\\frac{2(x-y)}{x^2+y^2}$.", "stars": 2, "srcs": ["S006·10", "S006·11"]},
    {"topic": "T3", "text": "For a sum of parts with different degrees, apply the corollary part by part: $n_1(n_1-1)u_1+n_2(n_2-1)u_2$.", "stars": 3, "srcs": ["ESA Jan-24 s3 1c", "CW U1 P22"], "flags": [ADD]},
    {"topic": "T4", "text": "When $u$ is $\\sin^{-1}$, $\\tan^{-1}$, $\\log$ or $e$ of something, apply the inverse function to both sides: that is $f(u)$.", "stars": 3, "srcs": ["T006b 00:08:20", "T006b 00:09:55", "T006b 00:11:40"]},
    {"topic": "T4", "text": "The degree belongs to $f(u)$, found by the scaling test on $f(u)$ ($\\lambda^4$ on slide 006·12, $\\lambda$ on 006·14, $\\lambda^{1/2}$ on 006·16).", "stars": 3, "srcs": ["S006·12", "S006·14", "S006·16"]},
    {"topic": "T4", "text": "“Whenever you have a complicated function, you can always use Euler's theorem if you feel that the function is homogeneous” — the lecture's closing advice for part I.", "stars": 2, "srcs": ["T006a 00:08:53"]},
    {"topic": "T4", "text": "Three variables work the same way: on slide 006·4, $\\sin u$ has degree $-3$, so $xu_x+yu_y+zu_z=-3\\tan u$.", "stars": 2, "srcs": ["S006·4", "T006a 00:06:54"]},
]

WHY = [
    {"topic": "T1", "q": "Why does slide 006·8 fail the test?",
     "a": "$u(\\lambda x,\\lambda y)=\\dfrac{e^{\\lambda x}-e^{\\lambda y}}{\\lambda(x-y)}$. The denominator gives $\\lambda^{-1}$, but $e^{\\lambda x}-e^{\\lambda y}$ is not a power of $\\lambda$ times $e^x-e^y$. Figure G1.1 shows the ratio is not a straight line on log-log axes.",
     "srcs": ["S006·8"], "flags": [ADD]},
    {"topic": "T4", "q": "Why does the $\\log$ case give $-1$ for the second order?",
     "a": "$f(u)=e^u$ gives $g=n\\,e^u/e^u=n$, a constant. So $g'=0$ and $g(g'-1)=-n$; slide 006·14 has $n=1$.",
     "srcs": ["S006·15"]},
    {"topic": "T4", "q": "Why can't Euler's theorem be applied to $u$ directly on slides 006·12–17?",
     "a": "$u$ is not homogeneous: for $u=\\log\\frac{x^2+y^2}{x+y}$, $u(\\lambda x,\\lambda y)=\\log\\lambda+u$, which is a shift, not a factor $\\lambda^n$.",
     "srcs": ["T006b 00:09:55"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T2", "text": "Slide 006·3 says “verify for $\\cos^{-1}(\\dots)$” but verifies for $Z=\\cos u$. For $u$ itself, $xu_x+yu_y=\\tfrac12\\frac{\\cos u}{-\\sin u}=-\\tfrac12\\cot u$, not $\\tfrac12u$.", "srcs": ["S006·3"], "flags": [ADD]},
    {"topic": "T3", "text": "$n=-1$ gives $n(n-1)=(-1)(-2)=+2$, not $-2$: the second-order answer on slide 006·11 is $+2u$.", "srcs": ["S006·11"], "flags": [ADD]},
    {"topic": "T4", "text": "For $u=e^{(\\dots)}$ the function is $f(u)=\\log u$, so $f'=1/u$ and $f/f'=u\\log u$: the answer is $4u\\log u$, not $4\\log u$.", "srcs": ["S006·13"], "flags": [ADD]},
    {"topic": "T4", "text": "In the second order use $g'(u)$, the derivative of $g$ with respect to $u$, not $f'(u)$: for $g=\\tfrac12\\tan u$, $g'=\\tfrac12\\sec^2u$.", "srcs": ["S006·17", "T006b 00:12:42"]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "Degree 0 (slide 006·5)", "srcs": ["S006·5", "T006b 00:00:24"], "stars": 1,
     "given": "$u=\\dfrac{x^4+2x^2y^2+y^4}{(x^2+y^2)^2}$.",
     "steps": ["$u(\\lambda x,\\lambda y)=\\dfrac{\\lambda^4(x^4+2x^2y^2+y^4)}{\\lambda^4(x^2+y^2)^2}=\\lambda^0u(x,y)$."],
     "answer": "Homogeneous of degree 0", "check": "The numerator is $(x^2+y^2)^2$, so $u\\equiv1$: a constant, degree 0."},
    {"id": "W1.2", "topic": "T1", "title": "Degree −1 (slide 006·6)", "srcs": ["S006·6", "T006b 00:03:02"], "stars": 2,
     "given": "$u=\\dfrac{\\sin^{-1}(y/x)}{\\sqrt{x^2+y^2}}$.",
     "steps": ["$\\sin^{-1}\\frac{\\lambda y}{\\lambda x}=\\sin^{-1}\\frac yx$: the $\\lambda$ cancels.", "$\\sqrt{(\\lambda x)^2+(\\lambda y)^2}=\\lambda\\sqrt{x^2+y^2}$.", "$u(\\lambda x,\\lambda y)=\\lambda^{-1}u(x,y)$."],
     "answer": "Homogeneous of degree $-1$", "check": "sympy: $u(\\lambda x,\\lambda y)/u=1/\\lambda$."},
    {"id": "W1.3", "topic": "T1", "title": "Degree 0 (slide 006·7)", "srcs": ["S006·7", "T006b 00:04:06"], "stars": 1,
     "given": "$u=\\dfrac{x^2y+xy^2}{(x+y)^3}$.",
     "steps": ["$u(\\lambda x,\\lambda y)=\\dfrac{\\lambda^3(x^2y+xy^2)}{\\lambda^3(x+y)^3}=\\lambda^0u$."],
     "answer": "Homogeneous of degree 0", "check": "$u=\\frac{xy}{(x+y)^2}$, a function of $y/x$ only."},
    {"id": "W1.4", "topic": "T1", "title": "Not homogeneous (slide 006·8)", "srcs": ["S006·8", "T006b 00:04:40"], "stars": 2,
     "given": "$u=\\dfrac{e^x-e^y}{x-y}$.",
     "steps": ["$u(\\lambda x,\\lambda y)=\\dfrac{e^{\\lambda x}-e^{\\lambda y}}{\\lambda(x-y)}$.", "No factor $\\lambda^n$ can be taken out of $e^{\\lambda x}-e^{\\lambda y}$."],
     "answer": "$u$ is not homogeneous", "check": "Figure G1.1: the ratio curves on log-log axes."},
    {"id": "W2.1", "topic": "T2", "title": "Verify Euler's theorem (slide 006·3)", "srcs": ["S006·3", "T006a 00:00:18", "T006a 00:04:11"], "stars": 2,
     "given": "$u=\\cos^{-1}\\dfrac{x+y}{\\sqrt x+\\sqrt y}$; verify Euler's theorem for $Z=\\cos u=\\dfrac{x+y}{\\sqrt x+\\sqrt y}$.",
     "steps": ["$Z=\\dfrac{x(1+y/x)}{\\sqrt x(1+\\sqrt{y/x})}=\\sqrt x\\,f\\big(\\tfrac yx\\big)$: degree $\\tfrac12$, so Euler predicts $xZ_x+yZ_y=\\tfrac12Z$.",
               "Quotient rule: $Z_x=\\dfrac{(\\sqrt x+\\sqrt y)-\\frac{x+y}{2\\sqrt x}}{(\\sqrt x+\\sqrt y)^2}$, so $xZ_x=\\dfrac{x\\sqrt x+2x\\sqrt y-y\\sqrt x}{2(\\sqrt x+\\sqrt y)^2}$.",
               "By symmetry $yZ_y=\\dfrac{y\\sqrt y+2y\\sqrt x-x\\sqrt y}{2(\\sqrt x+\\sqrt y)^2}$.",
               "Add: numerator $x\\sqrt x+x\\sqrt y+y\\sqrt x+y\\sqrt y=(x+y)(\\sqrt x+\\sqrt y)$, so the sum is $\\dfrac{x+y}{2(\\sqrt x+\\sqrt y)}=\\tfrac12Z$."],
     "answer": "$xZ_x+yZ_y=\\tfrac12Z$: verified", "check": "sympy: residual 0. For $u$ itself: $xu_x+yu_y=-\\tfrac12\\cot u$ (added for clarity)."},
    {"id": "W3.1", "topic": "T3", "title": "Degree −1, both orders (slides 006·9–11)", "srcs": ["S006·9", "S006·10", "S006·11", "T006b 00:05:27"], "stars": 3,
     "given": "$u=\\dfrac{x-y}{x^2+y^2}$; find (i) $xu_x+yu_y$, (ii) $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}$.",
     "steps": ["$u(\\lambda x,\\lambda y)=\\dfrac{\\lambda(x-y)}{\\lambda^2(x^2+y^2)}=\\lambda^{-1}u$: $n=-1$.", "(i) Euler: $-1\\cdot u$.", "(ii) Corollary: $(-1)(-2)u=2u$."],
     "answer": "(i) $-\\dfrac{x-y}{x^2+y^2}$, (ii) $\\dfrac{2(x-y)}{x^2+y^2}$", "check": "sympy: both residuals 0."},
    {"id": "W3.2", "topic": "T3", "title": "Fractional degree (CW)", "srcs": ["CW U1 P19"], "stars": 2,
     "given": "$u=\\dfrac{y^{1/3}-x^{1/3}}{x+y}$; find both Euler sums.",
     "steps": ["Degree $\\tfrac13-1=-\\tfrac23$.", "(i) $-\\tfrac23u$.", "(ii) $\\big(-\\tfrac23\\big)\\big(-\\tfrac53\\big)u=\\tfrac{10}{9}u$."],
     "answer": "(i) $-\\tfrac23u$, (ii) $\\tfrac{10}{9}u$", "check": "CW answers agree."},
    {"id": "W3.3", "topic": "T3", "title": "Degree 1 with an inverse sine (CW)", "srcs": ["CW U1 P21"], "stars": 2,
     "given": "$u=\\sqrt{y^2-x^2}\\,\\sin^{-1}(x/y)$; find $xu_x+yu_y$.",
     "steps": ["$\\sqrt{y^2-x^2}=y\\sqrt{1-(x/y)^2}$: degree 1; $\\sin^{-1}(x/y)$: degree 0.", "Degree $1+0=1$."],
     "answer": "$xu_x+yu_y=u$", "check": "CW answer: $u$."},
    {"id": "W3.4", "topic": "T3", "title": "Prove 5u and 20u (ESA)", "srcs": ["ESA Jul-23 1a"], "stars": 3,
     "given": "$u=x^3y^2\\sin^{-1}(y/x)$. Prove (i) $xu_x+yu_y=5u$, (ii) $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=20u$.",
     "steps": ["$u(\\lambda x,\\lambda y)=\\lambda^5x^3y^2\\sin^{-1}(y/x)$: degree 5.", "(i) $5u$.", "(ii) $5\\cdot4\\,u=20u$."],
     "answer": "(i) $5u$, (ii) $20u$", "check": "Direct differentiation in sympy agrees."},
    {"id": "W3.5", "topic": "T3", "title": "Sum of two degree-3 parts (CW)", "srcs": ["CW U1 P22"], "stars": 2,
     "given": "$u=x^3\\sin^{-1}(y/x)+y^3\\tan^{-1}(x/y)$; find $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}$.",
     "steps": ["Both parts have degree 3, so $u$ does.", "$3\\cdot2\\,u$."], "answer": "$6u$", "check": "CW answer: $6u$."},
    {"id": "W3.6", "topic": "T3", "title": "Degrees 3 and −3 together (ESA)", "srcs": ["ESA Jan-24 s4 1d", "CW U1 P23"], "stars": 3,
     "given": "$u=x^3\\sin^{-1}(y/x)+y^{-3}\\tan^{-1}(x/y)$; evaluate $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}+xu_x+yu_y$.",
     "steps": ["$u_1$: degree 3; $u_2=y^{-3}\\tan^{-1}(x/y)$: degree $-3$.", "First + second order gives $n^2$: $9u_1+9u_2$."],
     "answer": "$9u$", "check": "CW answer: $9u$; sympy agrees."},
    {"id": "W3.7", "topic": "T3", "title": "Degrees 3 and 4, value at (1, 1) (ESA)", "srcs": ["ESA Jan-24 s3 1c"], "stars": 3,
     "given": "$u=x^3\\sin^{-1}(y/x)+x^4\\tan^{-1}(y/x)$; find $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}+xu_x+yu_y$ at $(1,1)$.",
     "steps": ["$9u_1+16u_2$ with $u_1=x^3\\sin^{-1}(y/x)$, $u_2=x^4\\tan^{-1}(y/x)$.", "At $(1,1)$: $u_1=\\tfrac\\pi2$, $u_2=\\tfrac\\pi4$.", "$\\tfrac{9\\pi}2+4\\pi$."],
     "answer": "$\\dfrac{17\\pi}{2}$", "check": "sympy: the expression equals $9u_1+16u_2$ identically."},
    {"id": "W3.8", "topic": "T3", "title": "A function of ratios only (ESA)", "srcs": ["ESA Jan-24 s1 1d"], "stars": 2,
     "given": "$u=f\\big(\\tfrac xy,\\tfrac yz,\\tfrac zx\\big)$; find $xu_x+yu_y+zu_z$.",
     "steps": ["Scaling $x,y,z$ by $\\lambda$ leaves every ratio unchanged: degree 0.", "Euler in three variables: $0\\cdot u$."],
     "answer": "$xu_x+yu_y+zu_z=0$", "check": "Same as the chain-rule method (sympy)."},
    {"id": "W4.1", "topic": "T4", "title": "Three variables, sin u (slide 006·4)", "srcs": ["S006·4", "T006a 00:04:40", "T006a 00:08:22"], "stars": 3,
     "given": "$u=\\sin^{-1}\\dfrac{x+2y+3z}{\\sqrt{x^8+y^8+z^8}}$; show $xu_x+yu_y+zu_z+3\\tan u=0$.",
     "steps": ["$Z=\\sin u=\\dfrac{x(1+2y/x+3z/x)}{x^4\\sqrt{1+(y/x)^8+(z/x)^8}}=x^{-3}g\\big(\\tfrac yx,\\tfrac zx\\big)$: degree $-3$.",
               "Euler for $Z$: $xZ_x+yZ_y+zZ_z=-3Z=-3\\sin u$.",
               "$Z_x=\\cos u\\,u_x$ (and so on): $\\cos u\\,(xu_x+yu_y+zu_z)=-3\\sin u$.", "Divide by $\\cos u$."],
     "answer": "$xu_x+yu_y+zu_z=-3\\tan u$", "check": "sympy at two points: residual $<10^{-14}$. Same as E4.1 with $f=\\sin$, $n=-3$."},
    {"id": "W4.2", "topic": "T4", "title": "Exponential: f = log (slides 006·12–13)", "srcs": ["S006·12", "S006·13", "T006b 00:07:59", "T006b 00:09:27"], "stars": 3,
     "given": "$u=e^{\\frac{x^3y^3}{x^2+y^2}}$; find $xu_x+yu_y$.",
     "steps": ["$f(u)=\\log u=\\dfrac{x^3y^3}{x^2+y^2}$; $f(\\lambda x,\\lambda y)=\\dfrac{\\lambda^6x^3y^3}{\\lambda^2(x^2+y^2)}=\\lambda^4f$: $n=4$.",
               "$g=4\\dfrac{\\log u}{1/u}=4u\\log u$.",
               "Second order (added for clarity): $g'=4(\\log u+1)$, so $g(g'-1)=4u\\log u\\,(4\\log u+3)$."],
     "answer": "$xu_x+yu_y=4u\\log u$", "check": "sympy: both orders give residual 0."},
    {"id": "W4.3", "topic": "T4", "title": "Logarithm: f = e^u (slides 006·14–15)", "srcs": ["S006·14", "S006·15", "T006b 00:09:42", "T006b 00:10:59"], "stars": 3,
     "given": "$u=\\log\\dfrac{x^2+y^2}{x+y}$; find (i) $xu_x+yu_y$, (ii) $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}$.",
     "steps": ["$f(u)=e^u=\\dfrac{x^2+y^2}{x+y}$; $f(\\lambda x,\\lambda y)=\\lambda f$: $n=1$.", "(i) $g=1\\cdot\\dfrac{e^u}{e^u}=1$.", "(ii) $g'=0$: $g(g'-1)=1\\,(0-1)$."],
     "answer": "(i) $1$, (ii) $-1$", "check": "sympy: (i) 1, (ii) $-1$ exactly."},
    {"id": "W4.4", "topic": "T4", "title": "Inverse sine, degree ½ (slides 006·16–17)", "srcs": ["S006·16", "S006·17", "T006b 00:11:22", "T006b 00:12:42"], "stars": 3,
     "given": "$u=\\sin^{-1}\\dfrac{x+y}{\\sqrt x+\\sqrt y}$; find (i) $xu_x+yu_y$, (ii) $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}$.",
     "steps": ["$f(u)=\\sin u$; $f(\\lambda x,\\lambda y)=\\dfrac{\\lambda(x+y)}{\\sqrt\\lambda(\\sqrt x+\\sqrt y)}=\\lambda^{1/2}\\sin u$: $n=\\tfrac12$.",
               "(i) $g=\\tfrac12\\dfrac{\\sin u}{\\cos u}=\\tfrac12\\tan u$.",
               "(ii) $g'=\\tfrac12\\sec^2u$: $g(g'-1)=\\tfrac12\\tan u\\big(\\tfrac12\\sec^2u-1\\big)$."],
     "answer": "(i) $\\tfrac12\\tan u$, (ii) $\\tfrac12\\tan u\\big(\\tfrac12\\sec^2u-1\\big)=\\tfrac14\\tan u\\,(\\tan^2u-1)$",
     "check": "sympy at two points: residuals $<10^{-16}$. Equivalent form: $-\\dfrac{\\sin u\\cos2u}{4\\cos^3u}$."},
    {"id": "W4.5", "topic": "T4", "title": "Inverse tangent (ESA)", "srcs": ["ESA May-24 1a", "ESA Jun-24 1b", "CW U1 P20"], "stars": 3,
     "given": "$u=\\tan^{-1}\\dfrac{x^4+y^4}{xy}$. Prove (i) $xu_x+yu_y=\\sin2u$, (ii) $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=\\sin2u\\,(1-4\\sin^2u)$.",
     "steps": ["$f(u)=\\tan u=\\dfrac{x^4+y^4}{xy}$: degree $4-2=2$.", "(i) $g=2\\dfrac{\\tan u}{\\sec^2u}=2\\sin u\\cos u=\\sin2u$.",
               "(ii) $g'=2\\cos2u$: $g(g'-1)=\\sin2u\\,(2\\cos2u-1)=\\sin2u\\,(1-4\\sin^2u)$, using $\\cos2u=1-2\\sin^2u$."],
     "answer": "(i) $\\sin2u$, (ii) $\\sin2u\\,(1-4\\sin^2u)$", "check": "sympy: residuals 0 and $\\approx10^{-16}$."},
]

PYQS = [
    {"topic": "T3", "paper": "ESA Jul 2023", "q": "UE22MA141A Q1.a", "marks": 6,
     "text": "If $u(x,y)=x^3y^2\\sin^{-1}\\big(\\frac yx\\big)$, prove that (i) $xu_x+yu_y=5u$, (ii) $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=20u$.", "worked": "W3.4"},
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 3, Q1.c", "marks": 6,
     "text": "If $u=x^3\\sin^{-1}\\big(\\frac yx\\big)+x^4\\tan^{-1}\\big(\\frac yx\\big)$, find $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}+xu_x+yu_y$ at $x=1$, $y=1$ by using Euler's theorem and its extension.", "worked": "W3.7"},
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 4, Q1.d", "marks": 6,
     "text": "If $u=x^3\\sin^{-1}\\big(\\frac yx\\big)+y^{-3}\\tan^{-1}\\big(\\frac xy\\big)$, evaluate $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}+xu_x+yu_y$ by using Euler's theorem and its extension.", "worked": "W3.6"},
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 1, Q1.d", "marks": 5,
     "text": "If $u=f\\big(\\frac xy,\\frac yz,\\frac zx\\big)$, find $xu_x+yu_y+zu_z$ (degree 0; also solvable by the chain rule).", "worked": "W3.8"},
    {"topic": "T4", "paper": "ESA May 2024", "q": "UE22MA141A Q1.a", "marks": 6,
     "text": "If $u=\\tan^{-1}\\big(\\frac{x^4+y^4}{xy}\\big)$, prove that (i) $xu_x+yu_y=\\sin2u$, (ii) $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=\\sin2u(1-4\\sin^2u)$.", "worked": "W4.5"},
    {"topic": "T4", "paper": "ESA June 2024", "q": "UE23MA141A Q1.b", "marks": 6,
     "text": "Same question as May 2024 Q1.a: $u=\\tan^{-1}\\big(\\frac{x^4+y^4}{xy}\\big)$, prove (i) and (ii).", "worked": "W4.5"},
]

NOTES = [
    {"topic": "T1", "text": "Scaling test: $u(\\lambda x,\\lambda y)=\\lambda^nu(x,y)$ means degree $n$ (positive, negative or zero). "
     "Slide examples: $\\frac{x^4+2x^2y^2+y^4}{(x^2+y^2)^2}$ degree 0; $\\frac{\\sin^{-1}(y/x)}{\\sqrt{x^2+y^2}}$ degree $-1$; "
     "$\\frac{x^2y+xy^2}{(x+y)^3}$ degree 0; $\\frac{e^x-e^y}{x-y}$ not homogeneous."},
    {"topic": "T2", "text": "To verify: find $n$, differentiate, form $xu_x+yu_y$, simplify to $nu$. For $Z=\\frac{x+y}{\\sqrt x+\\sqrt y}$ "
     "($n=\\tfrac12$): $xZ_x+yZ_y=\\frac{(x+y)(\\sqrt x+\\sqrt y)}{2(\\sqrt x+\\sqrt y)^2}=\\tfrac12Z$."},
    {"topic": "T3", "text": "$u$ homogeneous of degree $n$: $xu_x+yu_y=nu$, $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=n(n-1)u$, sum $n^2u$. "
     "$\\frac{x-y}{x^2+y^2}$: $-u$, $2u$. ESA: $5u$ & $20u$; $9u$; $17\\pi/2$; ratios only give 0."},
    {"topic": "T4", "text": "If $f(u)$ has degree $n$: $g=nf/f'$, second order $g(g'-1)$. $e^{x^3y^3/(x^2+y^2)}$: $4u\\log u$. "
     "$\\log\\frac{x^2+y^2}{x+y}$: $1$, $-1$. $\\sin^{-1}\\frac{x+y}{\\sqrt x+\\sqrt y}$: $\\tfrac12\\tan u$, $\\tfrac12\\tan u(\\tfrac12\\sec^2u-1)$. "
     "$\\sin^{-1}\\frac{x+2y+3z}{\\sqrt{x^8+y^8+z^8}}$: $-3\\tan u$. ESA: $\\tan^{-1}\\frac{x^4+y^4}{xy}$ gives $\\sin2u$, $\\sin2u(1-4\\sin^2u)$."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "The scaling test on log-log axes", "stars": 2, "srcs": ["S006·3", "S006·5", "S006·6", "S006·8"], "flags": [ADD],
     "howto": "Each curve is $u(\\lambda x,\\lambda y)/u(x,y)$ for a deck function, plotted against $\\lambda$ on log-log axes. A homogeneous "
              "function gives $\\lambda^n$: a straight line of slope $n$ through $(1,1)$. Slide 006·5 is flat (degree 0), slide 006·6 "
              "falls with slope $-1$, $Z$ from slide 006·3 rises with slope $\\tfrac12$. Slide 006·8's function curves away: it is not homogeneous. "
              "Base point $(1,2)$; $(2,1)$ for slide 006·6, where $\\sin^{-1}(y/x)$ needs $y\\le x$."},
    {"id": "G4.1", "topic": "T4", "title": "The extension function $f(u)/f'(u)$ for each choice of $f$", "stars": 2, "srcs": ["S006·13", "S006·15", "S006·17", "ESA May-24 1a"], "flags": [ADD],
     "howto": "Multiply the curve by the degree $n$ to get $g(u)=xu_x+yu_y$. For $f=\\sin$ the sum grows without bound as $u\\to\\pi/2$; "
              "for $f=\\tan$ it stays between $\\pm\\tfrac n2$; for $f=e^u$ it is the constant $n$, so the second order is $-n$; for "
              "$f=\\log$ it is $nu\\log u$, negative for $u<1$ (on slide 006·12 $u=e^{(\\dots)}>1$, so it is positive)."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "The scaling test", "stars": 2, "srcs": ["S006·5", "T006b 00:01:41", "T006b 00:02:37"],
     "layout": "straight", "maxw": "120mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$u=\\dfrac{x^4+2x^2y^2+y^4}{(x^2+y^2)^2}$"},
         {"kind": "step", "n": 1, "title": "Replace $x\\to\\lambda x$, $y\\to\\lambda y$", "fx": "$u(\\lambda x,\\lambda y)=\\dfrac{(\\lambda x)^4+2(\\lambda x)^2(\\lambda y)^2+(\\lambda y)^4}{((\\lambda x)^2+(\\lambda y)^2)^2}$"},
         {"kind": "step", "n": 2, "title": "Take out powers of $\\lambda$", "fx": "$\\dfrac{\\lambda^4(\\dots)}{\\lambda^4(\\dots)}=\\lambda^0u(x,y)$"},
         {"kind": "result", "title": "Read the degree", "fx": "$n=0$; no power factors out $\\Rightarrow$ not homogeneous"}]},
     "remark": "Use the test on $u$ (topic 3) or on $f(u)$ (topic 4); the steps are the same."},
    {"id": "F3.1", "topic": "T3", "title": "Which Euler formula?", "stars": 3, "srcs": ["T006b 00:06:11", "T006b 00:09:08", "S006·13"],
     "layout": "route", "maxw": "165mm",
     "spec": {"question": "Scaling test on $u$: is $u$ homogeneous?",
              "rows": [{"title": "Yes, degree $n$", "sub": "First order; second order", "kw": "$nu$; $n(n-1)u$"},
                       {"title": "Yes, both orders asked together", "sub": "Add the two", "kw": "$n^2u$"},
                       {"title": "Sum of parts with different degrees", "sub": "Each part with its own $n$", "kw": "$n_1^2u_1+n_2^2u_2$"},
                       {"title": "No: $u=\\sin^{-1},\\tan^{-1},\\log,e^{(\\dots)}$", "sub": "Undo the outer function, test $f(u)$", "kw": "$g=nf/f'$; $g(g'-1)$"},
                       {"title": "Asked to verify", "sub": "Differentiate and simplify to $nu$", "kw": "topic 2", "dashed": True}]},
     "remark": "Exam questions say “using Euler's theorem”: always state the homogeneity and the degree first."},
    {"id": "F4.1", "topic": "T4", "title": "Using the extension (slides 006·16–17)", "stars": 3, "srcs": ["S006·16", "S006·17", "T006b 00:11:40"],
     "layout": "straight", "maxw": "125mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$u=\\sin^{-1}\\dfrac{x+y}{\\sqrt x+\\sqrt y}$", "sub": "$u$ is not homogeneous"},
         {"kind": "step", "n": 1, "title": "Undo $\\sin^{-1}$", "fx": "$f(u)=\\sin u=\\dfrac{x+y}{\\sqrt x+\\sqrt y}$"},
         {"kind": "step", "n": 2, "title": "Scaling test on $f(u)$", "fx": "$\\lambda^{1/2}\\sin u$: $n=\\tfrac12$"},
         {"kind": "step", "n": 3, "title": "First order", "fx": "$g=\\tfrac12\\dfrac{\\sin u}{\\cos u}=\\tfrac12\\tan u$"},
         {"kind": "result", "title": "Second order", "fx": "$g(g'-1)=\\tfrac12\\tan u\\big(\\tfrac12\\sec^2u-1\\big)$"}]},
     "remark": "The same four steps give $4u\\log u$ for $e^{(\\dots)}$ (slide 006·12) and $1,\\,-1$ for $\\log(\\dots)$ (slide 006·14)."},
]

COMPARISONS = [
    {"id": "C4.1", "topic": "T4", "title": "The extension for each outer function", "flags": [ADD], "srcs": ["S006·4", "S006·13", "S006·15", "S006·17", "ESA May-24 1a"],
     "head": ["$u=$", "$f(u)$", "$g(u)=xu_x+yu_y$", "$g(g'-1)$", "In class 006"],
     "rows": [["$\\sin^{-1}(P)$", "$\\sin u$", "$n\\tan u$", "$n\\tan u\\,(n\\sec^2u-1)$", "$n=-3$ (slide 4); $n=\\tfrac12$ (slide 16)"],
              ["$\\cos^{-1}(P)$", "$\\cos u$", "$-n\\cot u$", "$-n\\cot u\\,(n\\csc^2u-1)$", "$n=\\tfrac12$ (slide 3, $u$ itself)"],
              ["$\\tan^{-1}(P)$", "$\\tan u$", "$\\tfrac n2\\sin2u$", "$\\tfrac n2\\sin2u\\,(n\\cos2u-1)$", "$n=2$ (ESA May/June 2024)"],
              ["$\\log(P)$", "$e^u$", "$n$", "$-n$", "$n=1$ (slide 14)"],
              ["$e^{P}$", "$\\log u$", "$nu\\log u$", "$nu\\log u\\,(n\\log u+n-1)$", "$n=4$ (slide 12)"]]},
]

SYMBOLS = [
    {"sym": "$\\lambda$", "name": "Scale factor", "meaning": "Replaces $x,y$ by $\\lambda x,\\lambda y$ in the scaling test", "where": "E1.1"},
    {"sym": "$n$", "name": "Degree", "meaning": "Of $u$ (topic 3) or of $f(u)$ (topic 4)", "where": "E1.1–E4.2"},
    {"sym": "$f(u)$", "name": "Homogeneous function of $u$", "meaning": "$\\sin u$, $\\tan u$, $e^u$, $\\log u$", "where": "E4.1"},
    {"sym": "$f(y/x)$ (slide 3)", "name": "Arbitrary function of the ratio", "meaning": "$Z=\\sqrt x\\,f(y/x)$; not the $f(u)$ of topic 4", "where": "W2.1"},
    {"sym": "$g(u)$", "name": "Extension function", "meaning": "$nf(u)/f'(u)$; equals $xu_x+yu_y$", "where": "E4.1, E4.2"},
    {"sym": "$g'(u)$", "name": "Derivative of $g$", "meaning": "With respect to $u$", "where": "E4.2"},
    {"sym": "$Z$", "name": "Auxiliary function", "meaning": "$\\cos u$ (slide 3) or $\\sin u$ (slide 4, transcript)", "where": "W2.1, W4.1"},
    {"sym": "$z$", "name": "Third variable", "meaning": "Lowercase, on slide 4 only", "where": "W4.1"},
    {"sym": "$u_x,\\ u_{xy}$", "name": "Partial derivatives", "meaning": "$\\partial u/\\partial x$, $\\partial^2u/\\partial x\\partial y$", "where": "E2.1, E3.1"},
    {"sym": "$u_1,u_2$", "name": "Homogeneous parts", "meaning": "Parts of different degrees in a sum", "where": "E3.2"},
]

KEYWORDS = [
    {"term": "Scaling test", "meaning": "$u(\\lambda x,\\lambda y)=\\lambda^nu$.", "topic": "T1"},
    {"term": "Degree", "meaning": "The power $n$ of $\\lambda$; positive, negative, fractional or zero.", "topic": "T1"},
    {"term": "Degree 0", "meaning": "Depends on ratios only; Euler sum 0.", "topic": "T1"},
    {"term": "Not homogeneous", "meaning": "No single $\\lambda^n$ factors out (e.g. $e^x-e^y$).", "topic": "T1"},
    {"term": "Quotient degree", "meaning": "Numerator degree minus denominator degree.", "topic": "T1"},
    {"term": "Verification", "meaning": "Compute $xu_x+yu_y$ directly and show it equals $nu$.", "topic": "T2"},
    {"term": "Quotient rule", "meaning": "Used to differentiate $Z$ on slide 006·3.", "topic": "T2"},
    {"term": "Euler's theorem", "meaning": "$xu_x+yu_y=nu$.", "topic": "T3"},
    {"term": "Second-order corollary", "meaning": "$x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=n(n-1)u$.", "topic": "T3"},
    {"term": "n²u", "meaning": "First plus second order.", "topic": "T3"},
    {"term": "Sum of homogeneous parts", "meaning": "Each part with its own degree.", "topic": "T3"},
    {"term": "Extension", "meaning": "$xu_x+yu_y=nf(u)/f'(u)$ when $f(u)$ is homogeneous.", "topic": "T4"},
    {"term": "g(u)", "meaning": "$nf(u)/f'(u)$.", "topic": "T4"},
    {"term": "g(g′−1)", "meaning": "Second-order sum for the extension.", "topic": "T4"},
    {"term": "Undo the outer function", "meaning": "$\\sin^{-1}\\to\\sin$, $\\log\\to e^u$, $e\\to\\log$, $\\tan^{-1}\\to\\tan$.", "topic": "T4"},
    {"term": "Chain rule step", "meaning": "$F_x=f'(u)u_x$; then divide by $f'(u)$.", "topic": "T4"},
]

RAPID = [
    {"q": "Scaling test for degree $n$?", "a": "$u(\\lambda x,\\lambda y)=\\lambda^nu(x,y)$."},
    {"q": "Degree of $\\frac{x^4+2x^2y^2+y^4}{(x^2+y^2)^2}$?", "a": "0 (it is identically 1)."},
    {"q": "Degree of $\\frac{\\sin^{-1}(y/x)}{\\sqrt{x^2+y^2}}$?", "a": "$-1$."},
    {"q": "Degree of $\\frac{x^2y+xy^2}{(x+y)^3}$?", "a": "0."},
    {"q": "Is $\\frac{e^x-e^y}{x-y}$ homogeneous?", "a": "No."},
    {"q": "Degree of $\\frac{x+y}{\\sqrt x+\\sqrt y}$?", "a": "$\\tfrac12$."},
    {"q": "$u=\\frac{x-y}{x^2+y^2}$: $xu_x+yu_y$?", "a": "$-u$."},
    {"q": "Same $u$: second order?", "a": "$2u=\\frac{2(x-y)}{x^2+y^2}$."},
    {"q": "Extension formula?", "a": "$xu_x+yu_y=nf(u)/f'(u)=g(u)$."},
    {"q": "Extension, second order?", "a": "$g(u)[g'(u)-1]$."},
    {"q": "$u=e^{x^3y^3/(x^2+y^2)}$: $f(u)$ and $n$?", "a": "$\\log u$, $n=4$."},
    {"q": "Same $u$: $xu_x+yu_y$?", "a": "$4u\\log u$."},
    {"q": "$u=\\log\\frac{x^2+y^2}{x+y}$: both sums?", "a": "$1$ and $-1$."},
    {"q": "$u=\\sin^{-1}\\frac{x+y}{\\sqrt x+\\sqrt y}$: $xu_x+yu_y$?", "a": "$\\tfrac12\\tan u$."},
    {"q": "Same $u$: second order?", "a": "$\\tfrac12\\tan u(\\tfrac12\\sec^2u-1)$."},
    {"q": "$u=\\sin^{-1}\\frac{x+2y+3z}{\\sqrt{x^8+y^8+z^8}}$: $xu_x+yu_y+zu_z$?", "a": "$-3\\tan u$."},
    {"q": "$u=\\tan^{-1}\\frac{x^4+y^4}{xy}$: both sums?", "a": "$\\sin2u$; $\\sin2u(1-4\\sin^2u)$."},
    {"q": "$u=x^3y^2\\sin^{-1}(y/x)$: both sums?", "a": "$5u$; $20u$."},
    {"q": "$x^3\\sin^{-1}\\frac yx+x^4\\tan^{-1}\\frac yx$, first + second at $(1,1)$?", "a": "$17\\pi/2$."},
    {"q": "$f(x/y,y/z,z/x)$: Euler sum?", "a": "0."},
]

MNEMONICS = [
    "<i>“Undo, test, divide.”</i> Undo the outer function to get $f(u)$, test $f(u)$ for its degree $n$, then divide: $g=n\\,f/f'$.",
]

TOP_FACTS = [
    "Scaling test: $u(\\lambda x,\\lambda y)=\\lambda^nu$; degree may be positive, negative or zero.",
    "No single $\\lambda^n$ factors out $\\Rightarrow$ not homogeneous ($\\frac{e^x-e^y}{x-y}$).",
    "$u$ homogeneous: $nu$, $n(n-1)u$, together $n^2u$; parts of different degrees separately.",
    "$\\frac{x-y}{x^2+y^2}$: $n=-1$, answers $-u$ and $+2u$.",
    "$f(u)$ homogeneous: $g=nf/f'$; second order $g(g'-1)$.",
    "$\\sin^{-1}\\to n\\tan u$; $\\tan^{-1}\\to\\tfrac n2\\sin2u$; $\\log\\to n$ (second order $-n$); $e^{(\\cdot)}\\to nu\\log u$.",
    "Slide 006·4: $-3\\tan u$; slide 006·12: $4u\\log u$; slide 006·14: $1,-1$; slide 006·16: $\\tfrac12\\tan u$.",
    "ESA favourites: $5u$ & $20u$; $\\sin2u$ & $\\sin2u(1-4\\sin^2u)$; $9u$; $17\\pi/2$.",
]
TOP_FORMULAS = ["E1.1", "E2.1", "E3.1", "E3.2", "E4.1", "E4.2"]
