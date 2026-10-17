"""Unit 2, class 011 Legendre (deck SESSION 9): Legendre's and Cauchy's linear differential equations."""
ADD = "added for clarity"
TONLY = "transcript only"
NOTS = "not on current slides"

TOPICS = [
    {"id": "T1", "title": "Linear equations with variable coefficients: Legendre's and Cauchy's forms",
     "overview": r"So far the coefficients were constants. This session treats two forms with variable coefficients that a substitution "
                 r"turns into constant-coefficient equations. Legendre's equation has the coefficient $(ax+b)^k$ in front of the $k$-th "
                 r"derivative; Cauchy's (Cauchy–Euler) equation has $x^k$, and is Legendre's with $a=1$, $b=0$. The test: in every term the "
                 r"degree of the coefficient equals the order of the derivative."},
    {"id": "T2", "title": "The substitution $ax+b=e^z$ and the operator results",
     "overview": r"Put $z=\log(ax+b)$, so $\frac{dz}{dx}=\frac{a}{ax+b}$, and write $D=\frac{d}{dz}$. Then $(ax+b)\frac{dy}{dx}=aDy$, "
                 r"$(ax+b)^2\frac{d^2y}{dx^2}=a^2D(D-1)y$, $(ax+b)^3\frac{d^3y}{dx^3}=a^3D(D-1)(D-2)y$. The right-hand side is rewritten with "
                 r"$x=\frac{e^z-b}{a}$; the result is a constant-coefficient equation in $z$, solved by the CF and PI rules of classes 002–009, "
                 r"and the answer is converted back with $e^z=ax+b$. For Cauchy: $x=e^z$, $xDy$-results with $a=1$."},
    {"id": "T3", "title": "Legendre problems: the slide example, CW P29–P30 and five ESA questions",
     "overview": r"Every Legendre question in the papers is second order. A polynomial right-hand side in $x$ becomes a sum of $e^{kz}$ "
                 r"terms and a constant; $\sin(k\log(ax+b))$ becomes $\sin kz$. Four of the five ESA questions hit a PI failure case "
                 r"($(D-2)^2$, $(D-1)^2$, $D-1$), so the rule $\frac{1}{f(D)}e^{kz}=\frac{z}{f'(k)}e^{kz}$ is needed. CF terms come back as "
                 r"powers $(ax+b)^m$, repeated roots as $(ax+b)^m\log(ax+b)$, complex roots as $\cos(\beta\log(ax+b))$."},
    {"id": "T4", "title": "Cauchy problems: lecture examples, CW P31–P33 and ESA Jan-24 s3 3d",
     "overview": r"With $x=e^z$: $x^m\to e^{mz}$, $\log x\to z$, $\frac1x\to e^{-z}$. The lecture solves a third-order equation with complex AE "
                 r"roots and a failure case, and turns $xy''''+10y'''=0$ into Cauchy form by multiplying by $x^3$. CW P32 must first be "
                 r"multiplied by $x^2$. The ESA question $x^2y''-4xy'+6y=x^4\sin x$ gives $e^{4z}\sin(e^z)$, a non-standard right-hand side: "
                 r"use $\frac{1}{D-m}X=e^{mz}\int Xe^{-mz}dz$ (class 009) or variation of parameters in $x$; the PI is $-x^2\sin x$."},
]

DEFS = [
    {"topic": "T1", "term": "Legendre's linear differential equation", "text": r"An equation of the form "
     r"$k_0(ax+b)^n\frac{d^ny}{dx^n}+k_1(ax+b)^{n-1}\frac{d^{n-1}y}{dx^{n-1}}+k_2(ax+b)^{n-2}\frac{d^{n-2}y}{dx^{n-2}}+\dots+k_ny=X$, where the "
     r"$k_i$ are constants ($k_0\neq0$) and $X$ is a function of $x$; it is of order $n$.",
     "srcs": ["S011L·4", "S011L·5", "T011L 00:01:38", "T011L 00:02:05"]},
    {"topic": "T1", "term": "Cauchy's linear differential equation", "text": r"An equation of the form "
     r"$k_0x^n\frac{d^ny}{dx^n}+k_1x^{n-1}\frac{d^{n-1}y}{dx^{n-1}}+k_2x^{n-2}\frac{d^{n-2}y}{dx^{n-2}}+\dots+k_ny=X$, $X$ a function of $x$: "
     r"Legendre's equation with $a=1$, $b=0$ (also called the Cauchy–Euler or Euler equation).",
     "srcs": ["S011L·4", "T011L 00:02:16", "T011L 00:16:51", "T011L 00:17:52"]},
    {"topic": "T1", "term": "Variable coefficients", "text": r"The coefficients of the derivatives are functions of the independent variable $x$ "
     r"(here $(ax+b)^k$ or $x^k$), not constants.", "srcs": ["T011L 00:03:10", "S011L·4"]},
    {"topic": "T2", "term": "The substitution", "text": r"$ax+b=e^z$, i.e. $z=\log(ax+b)$ and $x=\frac{e^z-b}{a}$; for Cauchy $x=e^z$, $z=\log x$. "
     r"It changes the independent variable from $x$ to $z$.", "srcs": ["S011L·5", "T011L 00:05:20", "T011Lb 00:01:49", "T011L 00:18:30"]},
    {"topic": "T2", "term": "$D$ after the substitution", "text": r"$D=\frac{d}{dz}$, the differential operator with respect to $z$ (some books "
     r"write $\theta$); before the substitution $D$ meant $\frac{d}{dx}$.", "srcs": ["S011L·6", "T011L 00:07:44", "T011Lb 00:02:04"]},
]

STATEMENTS = [
    {"topic": "T1", "text": r"We consider two forms of differential equations with variable coefficients which can be reduced to linear "
     r"differential equations with constant coefficients by suitable substitutions.", "srcs": ["S011L·4"]},
    {"topic": "T2", "text": r"Such equations can be reduced to linear differential equations with constant coefficients by the substitution "
     r"$ax+b=e^z$ or $z=\log(ax+b)$, $\frac{dz}{dx}=\frac{a}{ax+b}$.", "srcs": ["S011L·5"]},
    {"topic": "T2", "text": r"Using these results in Legendre's Differential Equation, we get Linear Differential Equation with constant "
     r"coefficients which can be solved by the methods discussed before.", "srcs": ["S011L·6"]},
    {"topic": "T2", "text": r"Consider Second order Legendre's Linear Differential Equation $(ax+b)^2\frac{d^2y}{dx^2}+k_1(ax+b)\frac{dy}{dx}+k_2y=X$. "
     r"By the substitution $z=\log(ax+b)$, the above equation reduces to $(a^2D(D-1)+k_1aD+k_2)y=f(z)$. It is a second order linear non "
     r"homogeneous differential equation with constant coefficients which can be solved.", "srcs": ["S011L·7"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Legendre's equation of order $n$",
     "tex": r"\begin{gathered}k_0(ax+b)^n\frac{d^ny}{dx^n}+k_1(ax+b)^{n-1}\frac{d^{n-1}y}{dx^{n-1}}\\ +k_2(ax+b)^{n-2}\frac{d^{n-2}y}{dx^{n-2}}+\dots+k_ny=X\end{gathered}",
     "gives": "The form to recognise.", "when": "Power of $(ax+b)$ = order of the derivative in every term; $k_0\\neq0$.",
     "note": "Slide 011L·5 prints the third derivative as $\\frac{d^{n-1}y}{dx^{n-1}}$: it is $\\frac{d^{n-2}y}{dx^{n-2}}$.", "stars": 3,
     "srcs": ["S011L·4", "S011L·5", "T011L 00:01:38", "T011L 00:04:06"]},
    {"id": "E1.2", "topic": "T1", "title": "Cauchy's equation of order $n$ ($a=1$, $b=0$)",
     "tex": r"k_0x^n\frac{d^ny}{dx^n}+k_1x^{n-1}\frac{d^{n-1}y}{dx^{n-1}}+k_2x^{n-2}\frac{d^{n-2}y}{dx^{n-2}}+\dots+k_ny=X",
     "gives": "The special case.", "when": "Coefficient $x^k$ in front of the $k$-th derivative.",
     "note": "Slide 011L·4 also prints $\\frac{d^{n-1}y}{dx^{n-1}}$ in the third term; it is $\\frac{d^{n-2}y}{dx^{n-2}}$.", "stars": 3,
     "srcs": ["S011L·4", "T011L 00:16:51", "T011L 00:17:52", "ESA Jan-24 s3 3d"]},
    {"id": "E2.1", "topic": "T2", "title": "The substitution and $\\frac{dz}{dx}$",
     "tex": r"ax+b=e^z,\qquad z=\log(ax+b),\qquad x=\frac{e^z-b}{a},\qquad \frac{dz}{dx}=\frac{a}{ax+b}",
     "gives": "The change of variable.", "when": "Every Legendre equation.",
     "note": "Cauchy: $x=e^z$, $z=\\log x$, $\\frac{dz}{dx}=\\frac1x$.", "stars": 3,
     "srcs": ["S011L·5", "T011L 00:05:20", "T011L 00:06:11", "T011Lb 00:01:49"]},
    {"id": "E2.2", "topic": "T2", "title": "First derivative",
     "tex": r"\frac{dy}{dx}=\frac{dy}{dz}\cdot\frac{a}{ax+b}\quad\Rightarrow\quad (ax+b)\frac{dy}{dx}=aDy,\qquad D=\frac{d}{dz}",
     "gives": "The first-order term.", "when": "Chain rule.", "note": "Cauchy: $x\\frac{dy}{dx}=Dy$.", "stars": 3,
     "srcs": ["S011L·6", "T011L 00:07:16", "T011L 00:07:44", "T011L 00:18:54"]},
    {"id": "E2.3", "topic": "T2", "title": "Second derivative",
     "tex": r"(ax+b)^2\frac{d^2y}{dx^2}=a^2D(D-1)y=a^2(D^2-D)y",
     "gives": "The second-order term.", "when": "Product rule on $\\frac{a}{ax+b}\\frac{dy}{dz}$, then the chain rule.",
     "note": "Cauchy: $x^2\\frac{d^2y}{dx^2}=D(D-1)y$. Not $a^2D^2y$.", "stars": 3,
     "srcs": ["S011L·6", "T011L 00:08:53", "T011L 00:11:45", "T011L 00:19:07"]},
    {"id": "E2.4", "topic": "T2", "title": "Third derivative and the general rule",
     "tex": r"\begin{gathered}(ax+b)^3\frac{d^3y}{dx^3}=a^3D(D-1)(D-2)y\\ (ax+b)^n\frac{d^ny}{dx^n}=a^nD(D-1)(D-2)\cdots(D-n+1)y\end{gathered}",
     "gives": "Higher-order terms ($n$ linear factors).", "when": "Order 3 and 4 equations (lecture examples).",
     "note": "Slide 011L·6 shows $n=1,2,3$; the general line is added for clarity. Cauchy: $x^4y''''=D(D-1)(D-2)(D-3)y$.", "stars": 2,
     "srcs": ["S011L·6", "T011L 00:12:21", "T011L 00:12:34", "T011Lb 00:20:04"]},
    {"id": "E2.5", "topic": "T2", "title": "Second-order Legendre equation reduced",
     "tex": r"\begin{gathered}(ax+b)^2y''+k_1(ax+b)y'+k_2y=X\\ \Longrightarrow\ \big(a^2D(D-1)+k_1aD+k_2\big)y=X\Big(\tfrac{e^z-b}{a}\Big)\end{gathered}",
     "gives": "A constant-coefficient equation in $z$.", "when": "Every ESA question.",
     "note": "Divide by $a^2$ if convenient; the AE is $a^2m(m-1)+k_1am+k_2=0$.", "stars": 3,
     "srcs": ["S011L·7", "T011L 00:14:20", "T011L 00:15:57", "ESA Jul-23 3a"]},
    {"id": "E2.6", "topic": "T2", "title": "Back to $x$",
     "tex": r"e^{mz}=(ax+b)^m,\qquad z=\log(ax+b),\qquad \cos\beta z=\cos(\beta\log(ax+b))",
     "gives": "The final answer in $x$.", "when": "Last step, always.",
     "note": "Repeated root $m$: $(c_1+c_2z)e^{mz}=(ax+b)^m[c_1+c_2\\log(ax+b)]$.", "stars": 3,
     "srcs": ["S011L·9", "T011Lb 00:09:11", "T011Lb 00:12:12", "T011Lb 00:17:39"]},
    {"id": "E3.1", "topic": "T3", "title": "What the right-hand side becomes",
     "tex": r"\begin{gathered}x=\tfrac{e^z-b}{a}:\quad (ax+b)^k\to e^{kz},\quad px+q\to\tfrac pa(e^z-b)+q\\ \log(ax+b)\to z,\qquad \sin(k\log(ax+b))\to\sin kz\end{gathered}",
     "gives": "The PI type in $z$.", "when": "Before the PI.",
     "note": "A polynomial in $x$ gives a sum of $e^{kz}$ and a constant (Type 1 with $k=0$).", "stars": 3,
     "srcs": ["S011L·8", "T011Lb 00:14:09", "CW U2 P30", "ESA Jun-24 3b"]},
    {"id": "E3.2", "topic": "T3", "title": "PI rules needed in $z$ (classes 003–004)",
     "tex": r"\begin{gathered}\frac{1}{f(D)}e^{kz}=\frac{e^{kz}}{f(k)},\ f(k)\neq0;\qquad \frac{1}{f(D)}e^{kz}=\frac{z\,e^{kz}}{f'(k)},\ f(k)=0\neq f'(k)\\ \frac{1}{(D-k)^2}e^{kz}=\frac{z^2}{2}e^{kz},\qquad \frac{1}{D^2+\beta^2}\sin\beta z=-\frac{z}{2\beta}\cos\beta z\end{gathered}",
     "gives": "Every PI in Topic 3.", "when": "Failure cases in 4 of 6 ESA questions.",
     "note": "A constant $c$ is $ce^{0z}$: $\\frac{c}{f(0)}$.", "stars": 3,
     "srcs": ["T011Lb 00:10:29", "T011Lb 00:16:27", "ESA Jul-23 3a", "ESA Jan-24 s2 3c", "CW U2 P29"], "flags": [ADD]},
    {"id": "E3.3", "topic": "T3", "title": "ESA answers (Legendre)",
     "tex": r"\begin{gathered}\text{Jul-23: } y=(2x+1)^2\big[c_1+c_2\log(2x+1)+\log^2(2x+1)\big]\\ \text{Jan-24 s2: } y=(x+2)\big[c_1+c_2\log(x+2)\big]+\tfrac32(x+2)\log^2(x+2)-2\end{gathered}",
     "gives": "The two repeated-root ESA answers.", "when": "W3.5, W3.7.",
     "note": "Others: W3.3, W3.6, W3.8.", "stars": 3, "srcs": ["ESA Jul-23 3a", "ESA May-24 3a", "ESA Jan-24 s2 3c"]},
    {"id": "E4.1", "topic": "T4", "title": "Cauchy: right-hand side in $z$",
     "tex": r"x=e^z:\quad x^m\to e^{mz},\qquad \frac1x\to e^{-z},\qquad \log x\to z,\qquad x^m\log x\to z\,e^{mz}",
     "gives": "The PI type.", "when": "Every Cauchy problem.",
     "note": "$x^4\\sin x\\to e^{4z}\\sin(e^z)$ is not a standard form (E4.2).", "stars": 3,
     "srcs": ["T011Lb 00:06:06", "T011Lb 00:06:23", "CW U2 P31", "ESA Jan-24 s3 3d"]},
    {"id": "E4.2", "topic": "T4", "title": "Non-standard right-hand side: one factor at a time (class 009)",
     "tex": r"\frac{1}{D-m}X=e^{mz}\int X\,e^{-mz}\,dz",
     "gives": "The PI of $(D-m_1)(D-m_2)y=X$ in two integrations.", "when": "ESA Jan-24 s3 3d ($e^{4z}\\sin e^z$).",
     "note": "Or divide by $x^2$ and use variation of parameters in $x$ (class 011 VoP).", "stars": 2,
     "srcs": ["ESA Jan-24 s3 3d", "ESA Jan-24 s4 3c"], "flags": [ADD]},
]

POINTS = [
    {"topic": "T1", "text": "Recognise the form: in every term the degree of the coefficient equals the order of the derivative "
     "($(ax+b)^2$ with $y''$, $(ax+b)$ with $y'$, $(ax+b)^0$ with $y$).", "stars": 3,
     "srcs": ["T011L 00:04:06", "T011L 00:04:46", "T011L 00:15:00", "T011Lb 00:01:31"]},
    {"topic": "T1", "text": "Cauchy's equation is Legendre's with $a=1$, $b=0$; the same method works with $x=e^z$.", "stars": 3,
     "srcs": ["S011L·4", "T011L 00:02:16", "T011L 00:17:52", "T011Lb 00:03:24"]},
    {"topic": "T1", "text": "An equation that is not in the form can sometimes be brought to it: $xy''''+10y'''=0$ times $x^3$ is Cauchy's "
     "equation $x^4y''''+10x^3y'''=0$; $y''+\\frac1xy'=\\dots$ times $x^2$ (CW P32).", "stars": 2,
     "srcs": ["T011Lb 00:18:25", "T011Lb 00:18:37", "CW U2 P32"], "flags": [TONLY]},
    {"topic": "T1", "text": "Cauchy's equation is the syllabus “self-learning component”, but it is asked (ESA Jan-24 s3 3d = s4 3c) and has three "
     "CW problems.", "stars": 3, "srcs": ["CW U2 P31", "ESA Jan-24 s3 3d", "ESA Jan-24 s4 3c"], "flags": [NOTS]},
    {"topic": "T2", "text": "Four steps (F2.1): substitute $z=\\log(ax+b)$ → write the equation and the RHS in $z$ → CF and PI in $z$ → back to $x$.",
     "stars": 3, "srcs": ["S011L·7", "S011L·8", "T011L 00:13:26", "T011Lb 00:12:12"]},
    {"topic": "T2", "text": "Remember $(ax+b)^2y''=a^2D(D-1)y$, not $a^2D^2y$: the $-D$ comes from the product rule.", "stars": 3,
     "srcs": ["S011L·6", "T011L 00:11:45", "T011L 00:12:34"]},
    {"topic": "T2", "text": "The factor $a$ matters: $(2x+3)y'=2Dy$ and $(2x+3)^2y''=4D(D-1)y$.", "stars": 3,
     "srcs": ["S011L·8", "T011Lb 00:13:23", "T011Lb 00:13:37"]},
    {"topic": "T2", "text": "The right-hand side must also be written in $z$ (use $x=\\frac{e^z-b}{a}$); the final answer must be in $x$ again.",
     "stars": 3, "srcs": ["T011L 00:15:57", "T011L 00:21:15", "T011Lb 00:09:29", "T011Lb 00:17:39"]},
    {"topic": "T2", "text": "After the substitution $D$ means $\\frac{d}{dz}$, and a failure case gives $z\\,e^{kz}$, not $x\\,e^{kx}$.", "stars": 3,
     "srcs": ["T011L 00:07:44", "T011L 00:12:03", "T011Lb 00:11:07"]},
    {"topic": "T3", "text": "Polynomial right-hand sides give $e^{kz}$ terms plus a constant: ESA Jan-24 s1 3c ($6x+5\\to3e^z+2$), s2 3c "
     "($3x+4\\to3e^z-2$), Jun-24 3b ($8x^2-2x+3\\to2e^{2z}+3e^z+4$), CW P30 ($\\to\\frac{e^{2z}-1}{3}$).", "stars": 3,
     "srcs": ["ESA Jan-24 s1 3c", "ESA Jan-24 s2 3c", "ESA Jun-24 3b", "CW U2 P30", "S011L·8"]},
    {"topic": "T3", "text": "Check every $e^{kz}$ against the AE roots: the failure case appears in Jul-23 3a ($(D-2)^2$, twice), Jan-24 s2 3c "
     "($(D-1)^2$, twice), Jun-24 3b ($e^z$, root 1), CW P29 ($\\sin z$, roots $\\pm i$) and CW P30 ($e^{2z}$, root 2).", "stars": 3,
     "srcs": ["ESA Jul-23 3a", "ESA Jan-24 s2 3c", "ESA Jun-24 3b", "CW U2 P29", "CW U2 P30"]},
    {"topic": "T3", "text": "A repeated root $m$ gives $(ax+b)^m[c_1+c_2\\log(ax+b)]$; complex roots $\\pm i\\beta$ give "
     "$c_1\\cos(\\beta\\log(ax+b))+c_2\\sin(\\beta\\log(ax+b))$.", "stars": 3, "srcs": ["ESA Jul-23 3a", "CW U2 P29", "ESA Dec-23 3b"]},
    {"topic": "T4", "text": "$x=e^z$: $x^m\\to e^{mz}$, $\\frac1x\\to e^{-z}$, $\\log x\\to z$; so $x^2\\log x$ is $ze^{2z}$ (Type 4, class 006).",
     "stars": 3, "srcs": ["T011Lb 00:06:23", "CW U2 P31", "CW U2 P33"]},
    {"topic": "T4", "text": "Roots $-1$, $1\\pm i$ in $z$ give $\\frac{c_1}{x}+x[c_2\\cos(\\log x)+c_3\\sin(\\log x)]$.", "stars": 2,
     "srcs": ["T011Lb 00:08:47", "T011Lb 00:09:11"], "flags": [TONLY]},
    {"topic": "T4", "text": "ESA Jan-24 s3 3d: $e^{4z}\\sin(e^z)$ is not a standard form; factor $(D-2)(D-3)$ and integrate twice, or use variation "
     "of parameters in $x$; $y=c_1x^2+c_2x^3-x^2\\sin x$.", "stars": 3, "srcs": ["ESA Jan-24 s3 3d", "ESA Jan-24 s4 3c"], "flags": [ADD]},
]

WHY = [
    {"topic": "T2", "q": "Why does $ax+b=e^z$ remove the variable coefficients?",
     "a": "Since $\\frac{dz}{dx}=\\frac{a}{ax+b}$, each $x$-derivative brings a factor $\\frac{1}{ax+b}$; the coefficient $(ax+b)^k$ in front of "
          "the $k$-th derivative cancels them exactly, leaving constants times $z$-derivatives. That is why the degree must equal the order.",
     "srcs": ["T011L 00:06:28", "T011L 00:13:26"], "flags": [ADD]},
    {"topic": "T2", "q": "Where does the $D-1$ in $a^2D(D-1)$ come from?",
     "a": "$\\frac{d^2y}{dx^2}=\\frac{d}{dx}\\Big(\\frac{a}{ax+b}\\frac{dy}{dz}\\Big)=-\\frac{a^2}{(ax+b)^2}\\frac{dy}{dz}+\\frac{a^2}{(ax+b)^2}\\frac{d^2y}{dz^2}$: "
          "the first term (derivative of $\\frac{a}{ax+b}$) gives $-D$.", "srcs": ["T011L 00:09:33", "T011L 00:10:52", "T011L 00:11:45"]},
    {"topic": "T2", "q": "Why does $e^{mz}$ become a power of $ax+b$?",
     "a": "$e^{mz}=(e^z)^m=(ax+b)^m$. So Legendre and Cauchy solutions are powers (and $\\log$s), not exponentials, in $x$.",
     "srcs": ["S011L·9", "T011Lb 00:15:21"]},
    {"topic": "T3", "q": "Why is a constant on the right handled as $e^{0z}$?",
     "a": "$c=ce^{0\\cdot z}$, so Type 1 gives $\\frac{c}{f(0)}$ when $f(0)\\neq0$ (slide 011L·10: $-\\frac94\\cdot\\frac{1}{-3}$).",
     "srcs": ["S011L·10", "T011Lb 00:16:27"]},
]

TRAPS = [
    {"topic": "T1", "text": "Slides 011L·4–5 print $k_2(ax+b)^{n-2}\\frac{d^{n-1}y}{dx^{n-1}}$ (and $k_2x^{n-2}\\frac{d^{n-1}y}{dx^{n-1}}$): the "
     "derivative is $\\frac{d^{n-2}y}{dx^{n-2}}$ — degree equals order.", "srcs": ["S011L·4", "S011L·5", "T011L 00:04:06"]},
    {"topic": "T2", "text": "Forgetting the powers of $a$: $(2x+1)^2y''=4D(D-1)y$, not $D(D-1)y$.", "srcs": ["S011L·8", "ESA Jul-23 3a"]},
    {"topic": "T2", "text": "Leaving the right-hand side in $x$ (e.g. solving $(D^2-2D-3)y=6x$ in $z$) is wrong: write $x=\\frac{e^z-3}{2}$ first.",
     "srcs": ["S011L·8", "T011L 00:15:57"]},
    {"topic": "T2", "text": "Answers left in $z$ lose marks: replace $e^z$ by $ax+b$ and $z$ by $\\log(ax+b)$.", "srcs": ["T011Lb 00:09:29", "T011Lb 00:17:39"]},
    {"topic": "T3", "text": "CW P29's printed answer “$-\\log(1+x)-\\cos\\log(1+x)$” should be the product $-\\log(1+x)\\cos[\\log(1+x)]$.",
     "srcs": ["CW U2 P29"]},
    {"topic": "T3", "text": "CW P30's printed answer repeats $(2+3x)^2$; the second CF term is $(2+3x)^{-2}$.", "srcs": ["CW U2 P30"]},
    {"topic": "T3", "text": "ESA Dec-23 3b ($\\sin(2\\log(1+x))$, no failure) and CW P29 ($2\\sin\\log(1+x)$, failure) look alike but differ.",
     "srcs": ["ESA Dec-23 3b", "CW U2 P29"]},
    {"topic": "T4", "text": "CW P31 prints $-\\frac{x^3}{3}(\\log x+\\frac23)$ and CW P32 prints $-2(\\log x)^2$; the correct PIs are "
     "$-\\frac{x^2}{3}(\\log x+\\frac23)$ and $2(\\log x)^3$.", "srcs": ["CW U2 P31", "CW U2 P32"]},
    {"topic": "T4", "text": "CW P32 is not in Cauchy form as printed: multiply by $x^2$ first ($x^2y''+xy'=12\\log x$).", "srcs": ["CW U2 P32"]},
]

WORKED = [
    {"id": "W3.1", "topic": "T3", "title": "$(2x+3)^2y''-2(2x+3)y'-12y=6x$ (slides 011L·8–10)", "stars": 3,
     "srcs": ["S011L·8", "S011L·9", "S011L·10", "T011Lb 00:12:26", "T011Lb 00:17:39"],
     "given": "Solve $(2x+3)^2\\frac{d^2y}{dx^2}-2(2x+3)\\frac{dy}{dx}-12y=6x$.",
     "steps": ["Legendre with $a=2$, $b=3$: $z=\\log(2x+3)$, $2x+3=e^z$, $x=\\frac{e^z-3}{2}$; $(2x+3)y'=2Dy$, $(2x+3)^2y''=4D(D-1)y$.",
               "$(4D(D-1)-2\\cdot2D-12)y=6\\cdot\\frac{e^z-3}{2}$, i.e. $(4D^2-8D-12)y=3(e^z-3)$, so $(D^2-2D-3)y=\\frac34(e^z-3)=\\frac{3e^z}{4}-\\frac94$.",
               "CF: AE $m^2-2m-3=0$, $m=3,-1$: $y_c=c_1e^{3z}+c_2e^{-z}=c_1(2x+3)^3+\\frac{c_2}{2x+3}$.",
               "PI: $\\frac{3e^z}{4(D^2-2D-3)}-\\frac{9e^{0z}}{4(D^2-2D-3)}=\\frac{3e^z}{4(-4)}-\\frac{9}{4(-3)}=-\\frac{3e^z}{16}+\\frac34$.",
               "$y_p=\\frac34-\\frac{3(2x+3)}{16}$ $\\big(=\\frac{3}{16}-\\frac{3x}{8}\\big)$."],
     "answer": "$y=c_1(2x+3)^3+\\dfrac{c_2}{2x+3}+\\dfrac34-\\dfrac{3(2x+3)}{16}$",
     "check": "Slides 011L·8–10 agree (they stop at “$y=y_c+y_p$”); T011Lb agrees. sympy checkodesol: True. Figure G3.1, Figure F3.1."},
    {"id": "W3.2", "topic": "T3", "title": "$(1+x)^2y''+(1+x)y'+y=2\\sin[\\log(1+x)]$ (CW P29)", "stars": 2, "srcs": ["CW U2 P29"],
     "given": "Solve $(1+x)^2\\frac{d^2y}{dx^2}+(1+x)\\frac{dy}{dx}+y=2\\sin[\\log(1+x)]$.",
     "steps": ["$a=1$, $b=1$: $z=\\log(1+x)$: $(D(D-1)+D+1)y=2\\sin z$, i.e. $(D^2+1)y=2\\sin z$.",
               "AE $m^2+1=0$, $m=\\pm i$: $y_c=c_1\\cos z+c_2\\sin z$.",
               "PI: $D^2=-1$ makes the denominator 0 (failure): $\\frac{2\\sin z}{D^2+1}=2\\cdot\\Big(-\\frac z2\\cos z\\Big)=-z\\cos z$.",
               "Back to $x$: $z=\\log(1+x)$."],
     "answer": "$y=C_1\\cos[\\log(1+x)]+C_2\\sin[\\log(1+x)]-\\log(1+x)\\cos[\\log(1+x)]$",
     "check": "sympy checkodesol: True. <b>CW prints “$-\\log(1+x)-\\cos\\log(1+x)$”</b> (a sum, and “lox”): the sum leaves residual "
              "$-\\log(1+x)-2\\sin\\log(1+x)$; the product is right. Figure G2.2."},
    {"id": "W3.3", "topic": "T3", "title": "$(1+x)^2y''+(1+x)y'+y=\\sin(2\\log(1+x))$ (ESA Dec-23 3b)", "stars": 3, "srcs": ["ESA Dec-23 3b"],
     "given": "Solve $(1+x)^2\\frac{d^2y}{dx^2}+(1+x)\\frac{dy}{dx}+y=\\sin2(\\log(1+x))$ (6 marks), read as $\\sin(2\\log(1+x))$.",
     "steps": ["$z=\\log(1+x)$: $(D^2+1)y=\\sin2z$ (same left side as W3.2).",
               "$y_c=c_1\\cos z+c_2\\sin z$.",
               "PI: $D^2=-4$: $\\frac{\\sin2z}{-4+1}=-\\frac13\\sin2z$ (no failure: $\\pm2i$ are not roots).",
               "If $\\sin^2(\\log(1+x))$ were meant: $\\sin^2z=\\frac{1-\\cos2z}{2}$, PI $=\\frac12+\\frac16\\cos2z$."],
     "answer": "$y=c_1\\cos[\\log(1+x)]+c_2\\sin[\\log(1+x)]-\\dfrac13\\sin[2\\log(1+x)]$",
     "check": "sympy: residual 0 for both readings. Compare CW P29 ($2\\sin z$: failure case, W3.2)."},
    {"id": "W3.4", "topic": "T3", "title": "$(2+3x)^2y''+3(2+3x)y'-36y=3x^2+4x+1$ (CW P30)", "stars": 2, "srcs": ["CW U2 P30"],
     "given": "Solve $(2+3x)^2\\frac{d^2y}{dx^2}+3(2+3x)\\frac{dy}{dx}-36y=3x^2+4x+1$.",
     "steps": ["$a=3$, $b=2$: $z=\\log(3x+2)$, $x=\\frac{e^z-2}{3}$; $(9D(D-1)+9D-36)y=9(D^2-4)y$.",
               "RHS: $3x^2+4x+1=\\frac{(e^z-2)^2}{3}+\\frac{4(e^z-2)}{3}+1=\\frac{e^{2z}-1}{3}$. So $(D^2-4)y=\\frac{e^{2z}-1}{27}$.",
               "AE $m=\\pm2$: $y_c=c_1e^{2z}+c_2e^{-2z}=c_1(3x+2)^2+c_2(3x+2)^{-2}$.",
               "PI: $\\frac{1}{27}\\frac{e^{2z}}{D^2-4}$ fails ($m=2$ is a root): $\\frac{1}{27}\\cdot\\frac{ze^{2z}}{2D}\\big|_{D=2}=\\frac{ze^{2z}}{108}$; "
               "$-\\frac{1}{27}\\cdot\\frac{1}{-4}=\\frac{1}{108}$."],
     "answer": "$y=C_1(3x+2)^2+C_2(3x+2)^{-2}+\\dfrac{1}{108}\\big[(3x+2)^2\\log(3x+2)+1\\big]$",
     "check": "sympy checkodesol: True. <b>CW prints $C_2[(2+3x)^2]$</b> for the second CF term (a duplicate); it is $(2+3x)^{-2}$. The PI agrees."},
    {"id": "W3.5", "topic": "T3", "title": "$(2x+1)^2y''-6(2x+1)y'+16y=8(2x+1)^2$ (ESA Jul-23 3a $=$ May-24 3a)", "stars": 3,
     "srcs": ["ESA Jul-23 3a", "ESA May-24 3a"],
     "given": "Solve $(2x+1)^2\\frac{d^2y}{dx^2}-6(2x+1)\\frac{dy}{dx}+16y=8(2x+1)^2$ (7 marks).",
     "steps": ["$z=\\log(2x+1)$, $a=2$: $(4D(D-1)-12D+16)y=8e^{2z}$, i.e. $4(D^2-4D+4)y=8e^{2z}$, $(D-2)^2y=2e^{2z}$.",
               "AE $(m-2)^2=0$, $m=2,2$: $y_c=(c_1+c_2z)e^{2z}$.",
               "PI: double failure: $\\frac{2e^{2z}}{(D-2)^2}=2\\cdot\\frac{z^2}{2}e^{2z}=z^2e^{2z}$.",
               "Back: $e^{2z}=(2x+1)^2$, $z=\\log(2x+1)$."],
     "answer": "$y=(2x+1)^2\\big[c_1+c_2\\log(2x+1)+\\log^2(2x+1)\\big]$",
     "check": "sympy checkodesol: True. Figure F3.2."},
    {"id": "W3.6", "topic": "T3", "title": "$(2x+1)^2y''-2(2x+1)y'-12y=6x+5$ (ESA Jan-24 s1 3c)", "stars": 3, "srcs": ["ESA Jan-24 s1 3c"],
     "given": "Solve $(2x+1)^2y''-2(2x+1)y'-12y=6x+5$ (6 marks).",
     "steps": ["$z=\\log(2x+1)$, $x=\\frac{e^z-1}{2}$: $(4D(D-1)-4D-12)y=3(e^z-1)+5$, i.e. $4(D^2-2D-3)y=3e^z+2$.",
               "AE $m=3,-1$: $y_c=c_1(2x+1)^3+\\frac{c_2}{2x+1}$.",
               "PI: $\\frac14\\Big[\\frac{3e^z}{1-2-3}+\\frac{2}{-3}\\Big]=-\\frac{3e^z}{16}-\\frac16$."],
     "answer": "$y=c_1(2x+1)^3+\\dfrac{c_2}{2x+1}-\\dfrac{3(2x+1)}{16}-\\dfrac16$",
     "check": "sympy checkodesol: True ($y_p=-\\frac{3x}{8}-\\frac{17}{48}$). Same operator as the slide example (W3.1)."},
    {"id": "W3.7", "topic": "T3", "title": "$(x+2)^2y''-(x+2)y'+y=3x+4$ (ESA Jan-24 s2 3c)", "stars": 3, "srcs": ["ESA Jan-24 s2 3c"],
     "given": "Solve $(x+2)^2y''-(x+2)y'+y=3x+4$ (6 marks).",
     "steps": ["$a=1$, $b=2$: $z=\\log(x+2)$, $x=e^z-2$: $(D(D-1)-D+1)y=3(e^z-2)+4$, i.e. $(D-1)^2y=3e^z-2$.",
               "AE $m=1,1$: $y_c=(c_1+c_2z)e^z=(x+2)[c_1+c_2\\log(x+2)]$.",
               "PI: $\\frac{3e^z}{(D-1)^2}=\\frac{3z^2}{2}e^z$ (double failure); $\\frac{-2}{(0-1)^2}=-2$."],
     "answer": "$y=(x+2)\\big[c_1+c_2\\log(x+2)\\big]+\\dfrac32(x+2)\\log^2(x+2)-2$",
     "check": "sympy checkodesol: True."},
    {"id": "W3.8", "topic": "T3", "title": "$(2x-1)^2y''+(2x-1)y'-2y=8x^2-2x+3$ (ESA Jun-24 3b)", "stars": 3, "srcs": ["ESA Jun-24 3b"],
     "given": "Solve $(2x-1)^2\\frac{d^2y}{dx^2}+(2x-1)\\frac{dy}{dx}-2y=8x^2-2x+3$ (7 marks).",
     "steps": ["$a=2$, $b=-1$: $z=\\log(2x-1)$, $x=\\frac{e^z+1}{2}$: $(4D(D-1)+2D-2)y=(4D^2-2D-2)y$.",
               "RHS: $8x^2=2(e^z+1)^2=2e^{2z}+4e^z+2$, $-2x=-e^z-1$: total $2e^{2z}+3e^z+4$.",
               "AE $4m^2-2m-2=0$, $2(2m+1)(m-1)=0$, $m=1,-\\frac12$: $y_c=c_1(2x-1)+c_2(2x-1)^{-1/2}$.",
               "PI: $\\frac{2e^{2z}}{16-4-2}=\\frac{e^{2z}}{5}$; $\\frac{3e^z}{4D^2-2D-2}$ fails at $D=1$: $\\frac{3ze^z}{8D-2}\\big|_{D=1}=\\frac{ze^z}{2}$; "
               "$\\frac{4}{-2}=-2$."],
     "answer": "$y=c_1(2x-1)+\\dfrac{c_2}{\\sqrt{2x-1}}+\\dfrac{(2x-1)^2}{5}+\\dfrac{(2x-1)\\log(2x-1)}{2}-2$",
     "check": "sympy checkodesol: True (valid for $x>\\frac12$)."},
    {"id": "W4.1", "topic": "T4", "title": "$x^3y'''+2x^2y''+2y=10\\big(x+\\frac1x\\big)$ (lecture)", "stars": 2, "flags": [TONLY],
     "srcs": ["T011Lb 00:04:59", "T011Lb 00:06:46", "T011Lb 00:08:47", "T011Lb 00:11:56"],
     "given": "Solve $x^3\\frac{d^3y}{dx^3}+2x^2\\frac{d^2y}{dx^2}+2y=10\\big(x+\\frac1x\\big)$ (Cauchy, order 3).",
     "steps": ["$x=e^z$: $[D(D-1)(D-2)+2D(D-1)+2]y=10(e^z+e^{-z})$, i.e. $(D^3-D^2+2)y=10(e^z+e^{-z})$.",
               "AE $m^3-m^2+2=0$: $m=-1$ by inspection, then $m^2-2m+2=0$, $m=1\\pm i$. $y_c=c_1e^{-z}+e^z(c_2\\cos z+c_3\\sin z)$.",
               "PI: $\\frac{10e^z}{1-1+2}=5e^z$; $\\frac{10e^{-z}}{D^3-D^2+2}$ fails at $-1$: $\\frac{10ze^{-z}}{3D^2-2D}\\big|_{D=-1}=\\frac{10ze^{-z}}{5}=2ze^{-z}$.",
               "Back: $e^z=x$, $z=\\log x$."],
     "answer": "$y=\\dfrac{c_1}{x}+x\\big[c_2\\cos(\\log x)+c_3\\sin(\\log x)\\big]+5x+\\dfrac{2\\log x}{x}$",
     "check": "sympy checkodesol: True. T011Lb 00:11:38 is garbled (“5 into 10 by 52”); 00:11:56 states $5x+\\frac{2}{x}\\log x$."},
    {"id": "W4.2", "topic": "T4", "title": "$xy''''+10y'''=0$ (lecture; multiply by $x^3$)", "stars": 1, "flags": [TONLY],
     "srcs": ["T011Lb 00:17:56", "T011Lb 00:18:37", "T011Lb 00:21:08", "T011Lb 00:22:20"],
     "given": "Find the general solution of $x\\frac{d^4y}{dx^4}+10\\frac{d^3y}{dx^3}=0$.",
     "steps": ["Not yet Cauchy (degree ≠ order). Multiply by $x^3$: $x^4y''''+10x^3y'''=0$.",
               "$x=e^z$: $D(D-1)(D-2)(D-3)y+10D(D-1)(D-2)y=0$, i.e. $D(D-1)(D-2)(D+7)y=0$ (take the common factor).",
               "AE roots $0,1,2,-7$ (real, distinct); homogeneous, so no PI: $y=c_1+c_2e^z+c_3e^{2z}+c_4e^{-7z}$."],
     "answer": "$y=c_1+c_2x+c_3x^2+c_4x^{-7}$",
     "check": "sympy: residual 0. Direct check: $w=y'''$ satisfies $xw'+10w=0$, $w\\propto x^{-10}$, so $y\\ni x^{-7}$."},
    {"id": "W4.3", "topic": "T4", "title": "$x^2y''-xy'-3y=x^2\\log x$ (CW P31)", "stars": 2, "srcs": ["CW U2 P31"],
     "given": "Solve $x^2\\frac{d^2y}{dx^2}-x\\frac{dy}{dx}-3y=x^2\\log x$.",
     "steps": ["$x=e^z$: $(D(D-1)-D-3)y=ze^{2z}$, i.e. $(D^2-2D-3)y=ze^{2z}$. AE $m=3,-1$: $y_c=c_1x^3+c_2x^{-1}$.",
               "PI (Type 4, shift $D\\to D+2$): $e^{2z}\\frac{1}{(D+2)^2-2(D+2)-3}z=e^{2z}\\frac{1}{D^2+2D-3}z$.",
               "$\\frac{1}{-3(1-\\frac{2D+D^2}{3})}z=-\\frac13\\big(1+\\frac{2D}{3}\\big)z=-\\frac13\\big(z+\\frac23\\big)$."],
     "answer": "$y=C_1x^{-1}+C_2x^3-\\dfrac{x^2}{3}\\Big(\\log x+\\dfrac23\\Big)$",
     "check": "sympy dsolve: $C_1/x+C_2x^3-\\frac{x^2(3\\log x+2)}{9}$, the same. <b>CW prints $-\\frac{x^3}{3}(\\log x+\\frac23)$</b>, which does not "
              "satisfy the equation."},
    {"id": "W4.4", "topic": "T4", "title": "$y''+\\frac1xy'=\\frac{12\\log x}{x^2}$ (CW P32)", "stars": 2, "srcs": ["CW U2 P32"],
     "given": "Solve $\\frac{d^2y}{dx^2}+\\frac1x\\frac{dy}{dx}=12\\frac{\\log x}{x^2}$.",
     "steps": ["Multiply by $x^2$: $x^2y''+xy'=12\\log x$ (Cauchy).",
               "$x=e^z$: $(D(D-1)+D)y=12z$, i.e. $D^2y=12z$. AE $m=0,0$: $y_c=c_1+c_2z$.",
               "PI: $\\frac{1}{D^2}12z$ = integrate twice: $6z^2$, then $2z^3$."],
     "answer": "$y=C_1\\log x+C_2+2(\\log x)^3$",
     "check": "sympy dsolve: $C_1+C_2\\log x+2\\log^3x$. <b>CW prints $-2(\\log x)^2$</b>: residual $-\\frac{4(3\\log x+1)}{x^2}\\neq0$."},
    {"id": "W4.5", "topic": "T4", "title": "$x^2y''+4xy'+2y=x+\\frac1x$ (CW P33, homework)", "stars": 2, "srcs": ["CW U2 P33"],
     "given": "Solve $x^2\\frac{d^2y}{dx^2}+4x\\frac{dy}{dx}+2y=x+\\frac1x$.",
     "steps": ["$x=e^z$: $(D(D-1)+4D+2)y=(D^2+3D+2)y=e^z+e^{-z}$. AE $m=-1,-2$: $y_c=c_1x^{-1}+c_2x^{-2}$.",
               "PI: $\\frac{e^z}{1+3+2}=\\frac{e^z}{6}$; $e^{-z}$ fails ($m=-1$): $\\frac{ze^{-z}}{2D+3}\\big|_{D=-1}=ze^{-z}$."],
     "answer": "$y=C_1x^{-1}+C_2x^{-2}+\\dfrac x6+\\dfrac1x\\log x$",
     "check": "CW answer agrees; sympy checkodesol: True."},
    {"id": "W4.6", "topic": "T4", "title": "$x^2y''-4xy'+6y=x^4\\sin x$ (ESA Jan-24 s3 3d $=$ s4 3c)", "stars": 3,
     "srcs": ["ESA Jan-24 s3 3d", "ESA Jan-24 s4 3c"],
     "given": "Solve $x^2\\frac{d^2y}{dx^2}-4x\\frac{dy}{dx}+6y=x^4\\sin x$ (6 marks).",
     "steps": ["$x=e^z$: $(D(D-1)-4D+6)y=(D-2)(D-3)y=e^{4z}\\sin(e^z)$. AE $m=2,3$: $y_c=c_1x^2+c_2x^3$.",
               "PI, one factor at a time (E4.2): $\\frac{1}{D-3}e^{4z}\\sin e^z=e^{3z}\\int e^z\\sin(e^z)dz=-e^{3z}\\cos(e^z)$ ($t=e^z$).",
               "$\\frac{1}{D-2}\\big(-e^{3z}\\cos e^z\\big)=e^{2z}\\int-e^z\\cos(e^z)dz=-e^{2z}\\sin(e^z)=-x^2\\sin x$.",
               "Check by variation of parameters in $x$: standard form $X=x^2\\sin x$, $y_1=x^2$, $y_2=x^3$, $W=x^4$; "
               "$u=-\\int x\\sin x\\,dx=x\\cos x-\\sin x$, $v=\\int\\sin x\\,dx=-\\cos x$; $uy_1+vy_2=-x^2\\sin x$."],
     "answer": "$y=c_1x^2+c_2x^3-x^2\\sin x$",
     "check": "sympy dsolve: $x^2(C_1+C_2x-\\sin x)$; both routes give $-x^2\\sin x$. Figure G4.1, Figure F4.1."},
    {"id": "W4.7", "topic": "T4", "title": "$x^2y''-3xy'+3y=12x^4$ by the operator rule (cf. class 011 VoP)", "stars": 2,
     "srcs": ["T011Lb 00:04:06"], "flags": [ADD],
     "given": "The VoP lecture solves $x^2y''-3xy'+3y=12x^4$ by variation of parameters (VoP pack, W2.4). Solve it by the rules of this class.",
     "steps": ["$x=e^z$: $(D(D-1)-3D+3)y=(D^2-4D+3)y=12e^{4z}$. AE $m=3,1$: $y_c=c_1x^3+c_2x$.",
               "PI: $\\frac{12e^{4z}}{16-16+3}=4e^{4z}=4x^4$."],
     "answer": "$y=c_1x^3+c_2x+4x^4$", "check": "sympy checkodesol: True; the same as by VoP, in one line."},
]

PYQS = [
    {"topic": "T3", "paper": "ESA Dec 2023", "q": "UE22MA141A Q3.b", "marks": 6,
     "text": "Solve $(1+x)^2\\frac{d^2y}{dx^2}+(1+x)\\frac{dy}{dx}+y=\\sin2(\\log(1+x))$.", "worked": "W3.3"},
    {"topic": "T3", "paper": "ESA Jul 2023", "q": "UE22MA141A Q3.a", "marks": 7,
     "text": "Solve $(2x+1)^2\\frac{d^2y}{dx^2}-6(2x+1)\\frac{dy}{dx}+16y=8(2x+1)^2$.", "worked": "W3.5"},
    {"topic": "T3", "paper": "ESA May 2024", "q": "UE22MA141A Q3.a", "marks": 7,
     "text": "Solve $(2x+1)^2\\frac{d^2y}{dx^2}-6(2x+1)\\frac{dy}{dx}+16y=8(2x+1)^2$ (repeat of Jul-23 3a).", "worked": "W3.5"},
    {"topic": "T3", "paper": "ESA Jan 2024 set 1", "q": "UE23MA141A Q3.c", "marks": 6,
     "text": "Solve $(2x+1)^2y''-2(2x+1)y'-12y=6x+5$.", "worked": "W3.6"},
    {"topic": "T3", "paper": "ESA Jan 2024 set 2", "q": "UE23MA141A Q3.c", "marks": 6,
     "text": "Solve $(x+2)^2y''-(x+2)y'+y=3x+4$.", "worked": "W3.7"},
    {"topic": "T3", "paper": "ESA Jun 2024", "q": "UE23MA141A Q3.b", "marks": 7,
     "text": "Solve $(2x-1)^2\\frac{d^2y}{dx^2}+(2x-1)\\frac{dy}{dx}-2y=8x^2-2x+3$.", "worked": "W3.8"},
    {"topic": "T4", "paper": "ESA Jan 2024 set 3", "q": "UE23MA141A Q3.d", "marks": 6,
     "text": "Solve $x^2\\frac{d^2y}{dx^2}-4x\\frac{dy}{dx}+6y=x^4\\sin x$.", "worked": "W4.6"},
    {"topic": "T4", "paper": "ESA Jan 2024 set 4", "q": "UE23MA141A Q3.c", "marks": 6,
     "text": "Solve $x^2\\frac{d^2y}{dx^2}-4x\\frac{dy}{dx}+6y=x^4\\sin x$ (repeat of set 3 Q3.d).", "worked": "W4.6"},
]

NOTES = [
    {"topic": "T1", "text": "Legendre: $k_0(ax+b)^ny^{(n)}+k_1(ax+b)^{n-1}y^{(n-1)}+\\dots+k_ny=X$; Cauchy: the same with $x^k$ ($a=1$, $b=0$). "
     "Variable coefficients, but the degree of each coefficient equals the order of its derivative, so a substitution reduces it to "
     "constant coefficients. $xy''''+10y'''=0$ becomes Cauchy after multiplying by $x^3$."},
    {"topic": "T2", "text": "$ax+b=e^z$, $z=\\log(ax+b)$, $\\frac{dz}{dx}=\\frac{a}{ax+b}$, $D=\\frac{d}{dz}$: $(ax+b)y'=aDy$, $(ax+b)^2y''=a^2D(D-1)y$, "
     "$(ax+b)^3y'''=a^3D(D-1)(D-2)y$. Write $X$ in $z$ ($x=\\frac{e^z-b}{a}$), find CF and PI in $z$, convert back ($e^{mz}=(ax+b)^m$). "
     "Cauchy: $x=e^z$, $xy'=Dy$, $x^2y''=D(D-1)y$."},
    {"topic": "T3", "text": "Slide: $(2x+3)^2y''-2(2x+3)y'-12y=6x\\to(D^2-2D-3)y=\\frac34(e^z-3)$, $y=c_1(2x+3)^3+\\frac{c_2}{2x+3}+\\frac34-\\frac{3(2x+3)}{16}$. "
     "ESA: Jul-23 $(D-2)^2y=2e^{2z}$, $y=(2x+1)^2[c_1+c_2\\log(2x+1)+\\log^2(2x+1)]$; Jan s2 $(D-1)^2y=3e^z-2$; Jun-24 $(4D^2-2D-2)y=2e^{2z}+3e^z+4$; "
     "Dec-23 $(D^2+1)y=\\sin2z$, $y_p=-\\frac13\\sin(2\\log(1+x))$."},
    {"topic": "T4", "text": "$x=e^z$: $x^m\\to e^{mz}$, $\\log x\\to z$. CW P31 $y_p=-\\frac{x^2}{3}(\\log x+\\frac23)$; P32 (×$x^2$) $y=C_1\\log x+C_2+2\\log^3x$; "
     "P33 $y_p=\\frac x6+\\frac{\\log x}{x}$. ESA $x^2y''-4xy'+6y=x^4\\sin x$: $(D-2)(D-3)y=e^{4z}\\sin e^z$, $y=c_1x^2+c_2x^3-x^2\\sin x$."},
]

FIGS = [
    {"id": "G2.1", "topic": "T2", "title": "The new variable: $z=\\log(ax+b)$ and $z=\\log x$", "stars": 2,
     "srcs": ["S011L·5", "T011L 00:05:20", "T011L 00:18:30"], "flags": [ADD],
     "howto": "Blue: $z=\\log(2x+3)$ (slide example, $a=2$, $b=3$), defined for $x>-\\frac32$ (grey asymptote). Vermilion dashed: $z=\\log x$ "
              "(Cauchy), defined for $x>0$. Both are increasing, so each $x$ has one $z$ and back. Equal steps in $z$ are ever larger steps in $x$: "
              "$e^{mz}$ in $z$ becomes the power $(ax+b)^m$ in $x$."},
    {"id": "G2.2", "topic": "T2", "title": "Complex roots: $\\cos(\\log(1+x))$ oscillates ever more slowly", "stars": 2,
     "srcs": ["CW U2 P29", "ESA Dec-23 3b"], "flags": [ADD],
     "howto": "CW P29 and ESA Dec-23 3b have AE roots $\\pm i$, so the CF is $c_1\\cos(\\log(1+x))+c_2\\sin(\\log(1+x))$. The horizontal axis "
              "is $1+x$ on a log scale, from $10^{-3}$ to $10^{4}$: there the CF terms (green, purple dashed; drawn $\\times3$) are ordinary "
              "sinusoids in $z=\\log(1+x)$, one period per factor $e^{2\\pi}\\approx535$ in $1+x$ — in $x$ the zeros crowd towards $x=-1$ and "
              "spread out for large $x$. Blue: the CW P29 PI $-\\log(1+x)\\cos(\\log(1+x))$, whose amplitude grows like $|\\log(1+x)|$ "
              "(resonance in $z$)."},
    {"id": "G3.1", "topic": "T3", "title": "Slide example: $y_p=\\frac34-\\frac{3(2x+3)}{16}$ and general solutions", "stars": 3,
     "srcs": ["S011L·10"], "flags": [ADD],
     "howto": "For $x>-\\frac32$. Blue: the PI, a straight line $\\frac{3}{16}-\\frac{3x}{8}$ (a polynomial right-hand side $6x$ gave a polynomial PI). "
              "Grey: general solutions with $(c_1,c_2)=(0.01,0.2)$ and $(-0.01,0.5)$; the $\\frac{c_2}{2x+3}$ term blows up at the asymptote "
              "$x=-\\frac32$ and the $c_1(2x+3)^3$ term dominates for large $x$."},
    {"id": "G4.1", "topic": "T4", "title": "ESA Jan-24 s3 3d: $y_p=-x^2\\sin x$ and the CF terms $x^2$, $x^3$", "stars": 3,
     "srcs": ["ESA Jan-24 s3 3d"], "flags": [ADD],
     "howto": "For $x>0$. Blue: $y_p=-x^2\\sin x$, oscillating between the grey envelopes $\\pm x^2$. The upper envelope is the CF term $x^2$ itself; purple dashed: the CF term "
              "$\\frac{x^3}{10}$ (scaled). Grey solid: the general solution with $c_1=1$, $c_2=-0.1$."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "Which form is it?", "stars": 3,
     "srcs": ["S011L·4", "T011L 00:04:06", "T011Lb 00:18:25", "CW U2 P32"], "layout": "route", "maxw": "150mm",
     "spec": {"question": "What multiplies the $k$-th derivative?",
              "rows": [{"title": "$(ax+b)^k$ in every term", "sub": "Legendre: $z=\\log(ax+b)$", "kw": "Legendre"},
                       {"title": "$x^k$ in every term", "sub": "Cauchy: $z=\\log x$ ($a=1$, $b=0$)", "kw": "Cauchy"},
                       {"title": "$x^{k-r}$ in every term", "sub": "multiply by $x^r$ first (lecture $xy''''+10y'''$: $x^3$; CW P32: $x^2$)", "kw": "make Cauchy"},
                       {"title": "constants", "sub": "classes 002–009 directly", "kw": "constant coeff.", "dashed": True}]},
     "remark": "The test is the same for all: the power of the factor equals the order of the derivative."},
    {"id": "F2.1", "topic": "T2", "title": "Solving a Legendre (or Cauchy) equation", "stars": 3,
     "srcs": ["S011L·5", "S011L·6", "S011L·7", "T011L 00:13:26", "T011Lb 00:12:12"], "layout": "straight", "maxw": "145mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$(ax+b)^2y''+k_1(ax+b)y'+k_2y=X$", "sub": "Cauchy: $a=1$, $b=0$"},
         {"kind": "step", "n": 1, "title": "Substitute", "fx": "$ax+b=e^z,\\ \\ x=\\frac{e^z-b}{a},\\ \\ D=\\frac{d}{dz}$"},
         {"kind": "step", "n": 2, "title": "Operator results", "fx": "$(ax+b)y'=aDy,\\ \\ (ax+b)^2y''=a^2D(D-1)y$"},
         {"kind": "step", "n": 3, "title": "Right-hand side in $z$", "fx": "$X\\big(\\frac{e^z-b}{a}\\big)$"},
         {"kind": "step", "n": 4, "title": "CF and PI in $z$", "sub": "classes 002–009; watch failure cases"},
         {"kind": "result", "title": "Back to $x$", "fx": "$e^{mz}=(ax+b)^m,\\ \\ z=\\log(ax+b)$"}]},
     "remark": "In steps 2–4 the variable is $z$: a failure case gives $z\\,e^{kz}$.",
     "trap": "$a^2D(D-1)$, not $a^2D^2$ and not $D(D-1)$."},
    {"id": "F3.1", "topic": "T3", "title": "Slides 011L·8–10: $(2x+3)^2y''-2(2x+3)y'-12y=6x$", "stars": 3,
     "srcs": ["S011L·8", "S011L·9", "S011L·10"], "layout": "streams", "maxw": "165mm",
     "spec": {"left": [{"kind": "given", "title": "CF", "sub": "$(D^2-2D-3)y=\\frac34(e^z-3)$"},
                       {"kind": "step", "n": 1, "title": "AE roots", "fx": "$m=3,\\,-1$"},
                       {"kind": "step", "n": 2, "title": "Back to $x$", "fx": "$c_1(2x+3)^3+\\frac{c_2}{2x+3}$"}],
              "right": [{"kind": "given", "title": "PI", "sub": "$\\frac{3e^z}{4}-\\frac94$"},
                        {"kind": "step", "n": 3, "title": "$D=1$ and $D=0$", "fx": "$-\\frac{3e^z}{16}+\\frac34$"},
                        {"kind": "step", "n": 4, "title": "Back to $x$", "fx": "$\\frac34-\\frac{3(2x+3)}{16}$"}],
              "then": [{"kind": "result", "title": "$y=y_c+y_p$",
                        "fx": "$c_1(2x+3)^3+\\frac{c_2}{2x+3}+\\frac34-\\frac{3(2x+3)}{16}$"}]},
     "remark": "Worked in full as W3.1."},
    {"id": "F3.2", "topic": "T3", "title": "ESA Jul-23 3a $=$ May-24 3a", "stars": 3,
     "srcs": ["ESA Jul-23 3a", "ESA May-24 3a"], "layout": "straight", "maxw": "140mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$(2x+1)^2y''-6(2x+1)y'+16y=8(2x+1)^2$"},
         {"kind": "step", "n": 1, "title": "$z=\\log(2x+1)$, $a=2$", "fx": "$4D(D-1)-12D+16=4(D-2)^2$"},
         {"kind": "step", "n": 2, "title": "Reduced", "fx": "$(D-2)^2y=2e^{2z}$"},
         {"kind": "step", "n": 3, "title": "Double failure", "fx": "$y_p=\\frac{z^2}{2}\\cdot2e^{2z}=z^2e^{2z}$"},
         {"kind": "result", "title": "$y=(2x+1)^2[c_1+c_2\\log(2x+1)+\\log^2(2x+1)]$", "fx": "W3.5"}]},
     "remark": "Repeated root $2$: $(c_1+c_2z)e^{2z}$."},
    {"id": "F4.1", "topic": "T4", "title": "Is the right-hand side in $z$ a standard form?", "stars": 3,
     "srcs": ["ESA Jan-24 s3 3d", "CW U2 P31", "CW U2 P33"], "flags": [ADD], "layout": "fork", "maxw": "150mm",
     "spec": {"before": [{"kind": "given", "title": "$f(D)y=X(e^z)$", "sub": "after $x=e^z$"}],
              "question": "Is $X$ a sum of $e^{kz}$, $\\sin$, $\\cos$, $z^m$, $e^{kz}V$?",
              "no": {"kind": "step", "title": "Factor $f(D)$, use $\\frac{1}{D-m}X=e^{mz}\\int Xe^{-mz}dz$", "sub": "or VoP in $x$ (ESA Jan-24 s3: $e^{4z}\\sin e^z$)"},
              "yes": {"kind": "step", "title": "Operator rules", "sub": "classes 003–006 (CW P31: $ze^{2z}$)"},
              "after": [{"kind": "result", "title": "Back to $x$", "fx": "$e^z=x,\\ \\ z=\\log x$"}]},
     "remark": "ESA Jan-24 s3 3d: $y=c_1x^2+c_2x^3-x^2\\sin x$ (W4.6)."},
]

COMPARISONS = [
    {"id": "C2.1", "topic": "T2", "title": "Legendre and Cauchy side by side",
     "srcs": ["S011L·4", "S011L·5", "S011L·6", "T011L 00:18:30", "T011L 00:19:07"],
     "head": ["", "Legendre", "Cauchy"],
     "rows": [["Coefficient of $y^{(k)}$", "$k_{n-k}(ax+b)^k$", "$k_{n-k}x^k$"],
              ["Substitution", "$ax+b=e^z$, $z=\\log(ax+b)$", "$x=e^z$, $z=\\log x$"],
              ["$\\frac{dz}{dx}$", "$\\frac{a}{ax+b}$", "$\\frac1x$"],
              ["First order", "$(ax+b)y'=aDy$", "$xy'=Dy$"],
              ["Second order", "$(ax+b)^2y''=a^2D(D-1)y$", "$x^2y''=D(D-1)y$"],
              ["Third order", "$a^3D(D-1)(D-2)y$", "$D(D-1)(D-2)y$"],
              ["$e^{mz}$ in $x$", "$(ax+b)^m$", "$x^m$"],
              ["On the slides?", "yes (011L·5–10)", "form only (011L·4); rest transcript only"]]},
    {"id": "C3.1", "topic": "T3", "title": "Every problem in this pack, reduced to $z$",
     "srcs": ["S011L·8", "CW U2 P29", "CW U2 P30", "CW U2 P31", "CW U2 P32", "CW U2 P33", "ESA Dec-23 3b", "ESA Jul-23 3a",
              "ESA Jan-24 s1 3c", "ESA Jan-24 s2 3c", "ESA Jun-24 3b", "ESA Jan-24 s3 3d", "T011Lb 00:04:59"],
     "head": ["Problem", "Equation in $z$", "Roots", "PI in $x$"],
     "rows": [["Slide (W3.1)", "$(D^2-2D-3)y=\\frac34(e^z-3)$", "$3,-1$", "$\\frac34-\\frac{3(2x+3)}{16}$"],
              ["CW P29 (W3.2)", "$(D^2+1)y=2\\sin z$", "$\\pm i$", "$-\\log(1+x)\\cos\\log(1+x)$"],
              ["Dec-23 (W3.3)", "$(D^2+1)y=\\sin2z$", "$\\pm i$", "$-\\frac13\\sin(2\\log(1+x))$"],
              ["CW P30 (W3.4)", "$(D^2-4)y=\\frac{e^{2z}-1}{27}$", "$\\pm2$", "$\\frac{(3x+2)^2\\log(3x+2)+1}{108}$"],
              ["Jul-23 (W3.5)", "$(D-2)^2y=2e^{2z}$", "$2,2$", "$(2x+1)^2\\log^2(2x+1)$"],
              ["Jan s1 (W3.6)", "$4(D^2-2D-3)y=3e^z+2$", "$3,-1$", "$-\\frac{3(2x+1)}{16}-\\frac16$"],
              ["Jan s2 (W3.7)", "$(D-1)^2y=3e^z-2$", "$1,1$", "$\\frac32(x+2)\\log^2(x+2)-2$"],
              ["Jun-24 (W3.8)", "$(4D^2-2D-2)y=2e^{2z}+3e^z+4$", "$1,-\\frac12$", "$\\frac{(2x-1)^2}{5}+\\frac{(2x-1)\\log(2x-1)}{2}-2$"],
              ["Lecture (W4.1)", "$(D^3-D^2+2)y=10(e^z+e^{-z})$", "$-1,1\\pm i$", "$5x+\\frac{2\\log x}{x}$"],
              ["CW P31 (W4.3)", "$(D^2-2D-3)y=ze^{2z}$", "$3,-1$", "$-\\frac{x^2}{3}(\\log x+\\frac23)$"],
              ["CW P32 (W4.4)", "$D^2y=12z$", "$0,0$", "$2\\log^3x$"],
              ["CW P33 (W4.5)", "$(D^2+3D+2)y=e^z+e^{-z}$", "$-1,-2$", "$\\frac x6+\\frac{\\log x}{x}$"],
              ["Jan s3 (W4.6)", "$(D-2)(D-3)y=e^{4z}\\sin e^z$", "$2,3$", "$-x^2\\sin x$"]]},
    {"id": "C3.2", "topic": "T3", "title": "Printed answers that are wrong", "srcs": ["CW U2 P29", "CW U2 P30", "CW U2 P31", "CW U2 P32", "S011L·4", "S011L·5"],
     "head": ["Source", "Printed", "Correct"],
     "rows": [["Slides 011L·4–5", "$k_2(\\cdot)^{n-2}\\frac{d^{n-1}y}{dx^{n-1}}$", "$k_2(\\cdot)^{n-2}\\frac{d^{n-2}y}{dx^{n-2}}$"],
              ["CW P29", "$-\\log(1+x)-\\cos\\log(1+x)$", "$-\\log(1+x)\\cos\\log(1+x)$"],
              ["CW P30", "$C_2[(2+3x)^2]$", "$C_2(2+3x)^{-2}$"],
              ["CW P31", "$-\\frac{x^3}{3}(\\log x+\\frac23)$", "$-\\frac{x^2}{3}(\\log x+\\frac23)$"],
              ["CW P32", "$-2(\\log x)^2$", "$+2(\\log x)^3$"]]},
]

SYMBOLS = [
    {"sym": "$a$, $b$", "name": "Constants of the linear factor", "meaning": "$ax+b$ in Legendre's equation; Cauchy: $a=1$, $b=0$", "where": "E1.1, E2.1"},
    {"sym": "$k_0,\\dots,k_n$", "name": "Coefficients", "meaning": "Constants multiplying each term; $k_0\\neq0$", "where": "E1.1, E1.2, E2.5"},
    {"sym": "$X$", "name": "Right-hand side", "meaning": "Function of $x$ (capital); rewritten in $z$ after the substitution (slide: $f(z)$)", "where": "E1.1, E2.5"},
    {"sym": "$z$", "name": "New variable", "meaning": "$z=\\log(ax+b)$ or $z=\\log x$; independent variable after the substitution", "where": "E2.1"},
    {"sym": "$D$", "name": "Operator", "meaning": "$\\frac{d}{dz}$ after the substitution (clash: $\\frac{d}{dx}$ in classes 002–009); some books $\\theta$", "where": "E2.2–E2.4"},
    {"sym": "$n$", "name": "Order", "meaning": "Highest derivative; also the power of $(ax+b)$ on it", "where": "E1.1, E2.4"},
    {"sym": "$m$", "name": "AE root", "meaning": "Root of the auxiliary equation in $z$; $e^{mz}=(ax+b)^m$", "where": "E2.6"},
    {"sym": "$k$", "name": "Exponent of the RHS", "meaning": "$e^{kz}$ terms of the right-hand side (clash with the coefficients $k_i$)", "where": "E3.1, E3.2"},
    {"sym": "$y_c$, $y_p$", "name": "CF and PI", "meaning": "Complementary function and particular integral; $y=y_c+y_p$", "where": "W3.1"},
    {"sym": "$\\log$", "name": "Natural logarithm", "meaning": "$\\log_e$; needs $ax+b>0$ ($x>0$ for Cauchy)", "where": "E2.1, E2.6"},
]

KEYWORDS = [
    {"term": "Variable coefficients", "meaning": "Coefficients that are functions of $x$.", "topic": "T1"},
    {"term": "Legendre's linear equation", "meaning": "$(ax+b)^k$ multiplies the $k$-th derivative.", "topic": "T1"},
    {"term": "Cauchy's linear equation", "meaning": "$x^k$ multiplies the $k$-th derivative; Legendre with $a=1$, $b=0$.", "topic": "T1"},
    {"term": "Cauchy–Euler equation", "meaning": "Another name for Cauchy's equation.", "topic": "T1"},
    {"term": "Degree = order", "meaning": "The recognition test for both forms.", "topic": "T1"},
    {"term": "Self-learning component", "meaning": "Syllabus label of Cauchy's equation; still asked in ESA.", "topic": "T1"},
    {"term": "Substitution", "meaning": "$ax+b=e^z$, $z=\\log(ax+b)$.", "topic": "T2"},
    {"term": "$\\frac{dz}{dx}$", "meaning": "$\\frac{a}{ax+b}$ (Cauchy $\\frac1x$).", "topic": "T2"},
    {"term": "$D=\\frac{d}{dz}$", "meaning": "Operator after the substitution.", "topic": "T2"},
    {"term": "$aD$", "meaning": "$(ax+b)\\frac{dy}{dx}$.", "topic": "T2"},
    {"term": "$a^2D(D-1)$", "meaning": "$(ax+b)^2\\frac{d^2y}{dx^2}$.", "topic": "T2"},
    {"term": "$a^3D(D-1)(D-2)$", "meaning": "$(ax+b)^3\\frac{d^3y}{dx^3}$.", "topic": "T2"},
    {"term": "Chain rule", "meaning": "$\\frac{dy}{dx}=\\frac{dy}{dz}\\frac{dz}{dx}$.", "topic": "T2"},
    {"term": "Back-substitution", "meaning": "$e^{mz}=(ax+b)^m$, $z=\\log(ax+b)$.", "topic": "T2"},
    {"term": "RHS in $z$", "meaning": "$x=\\frac{e^z-b}{a}$; polynomials give $e^{kz}$ and constants.", "topic": "T3"},
    {"term": "Failure case", "meaning": "$f(k)=0$: PI $\\frac{z e^{kz}}{f'(k)}$ (in $z$!).", "topic": "T3"},
    {"term": "Repeated root", "meaning": "$(ax+b)^m[c_1+c_2\\log(ax+b)]$.", "topic": "T3"},
    {"term": "Complex roots", "meaning": "$\\cos(\\beta\\log(ax+b))$, $\\sin(\\beta\\log(ax+b))$.", "topic": "T3"},
    {"term": "Multiply through", "meaning": "$xy''''+10y'''$ times $x^3$; CW P32 times $x^2$.", "topic": "T4"},
    {"term": "$\\frac{1}{D-m}X$", "meaning": "$e^{mz}\\int Xe^{-mz}dz$, for $e^{4z}\\sin e^z$.", "topic": "T4"},
]

RAPID = [
    {"q": "Legendre's equation, second order?", "a": "$(ax+b)^2y''+k_1(ax+b)y'+k_2y=X$."},
    {"q": "Cauchy's equation is the case …?", "a": "$a=1$, $b=0$: $x^2y''+k_1xy'+k_2y=X$."},
    {"q": "Recognition test?", "a": "Degree of each coefficient = order of its derivative."},
    {"q": "Substitution for Legendre?", "a": "$ax+b=e^z$, $z=\\log(ax+b)$, $\\frac{dz}{dx}=\\frac{a}{ax+b}$."},
    {"q": "$(ax+b)\\frac{dy}{dx}$?", "a": "$aDy$, $D=\\frac{d}{dz}$."},
    {"q": "$(ax+b)^2\\frac{d^2y}{dx^2}$?", "a": "$a^2D(D-1)y$."},
    {"q": "$(ax+b)^3\\frac{d^3y}{dx^3}$?", "a": "$a^3D(D-1)(D-2)y$."},
    {"q": "Cauchy: $x^2y''$?", "a": "$D(D-1)y$ with $x=e^z$."},
    {"q": "$x$ in terms of $z$?", "a": "$x=\\frac{e^z-b}{a}$."},
    {"q": "$e^{3z}$ back in $x$ for $z=\\log(2x+3)$?", "a": "$(2x+3)^3$."},
    {"q": "Slide example's reduced equation?", "a": "$(D^2-2D-3)y=\\frac34(e^z-3)$."},
    {"q": "Slide example's PI?", "a": "$\\frac34-\\frac{3(2x+3)}{16}$."},
    {"q": "ESA Jul-23 3a in $z$?", "a": "$(D-2)^2y=2e^{2z}$; $y_p=z^2e^{2z}=(2x+1)^2\\log^2(2x+1)$."},
    {"q": "ESA Jan-24 s2 3c in $z$?", "a": "$(D-1)^2y=3e^z-2$; $y_p=\\frac32(x+2)\\log^2(x+2)-2$."},
    {"q": "ESA Dec-23 3b PI?", "a": "$-\\frac13\\sin(2\\log(1+x))$ (reading $\\sin(2\\log(1+x))$)."},
    {"q": "CW P29 PI?", "a": "$-\\log(1+x)\\cos[\\log(1+x)]$ (failure)."},
    {"q": "$xy''''+10y'''=0$?", "a": "Times $x^3$; $y=c_1+c_2x+c_3x^2+c_4x^{-7}$."},
    {"q": "CW P32 answer?", "a": "$y=C_1\\log x+C_2+2(\\log x)^3$ (CW prints $-2(\\log x)^2$)."},
    {"q": "ESA $x^2y''-4xy'+6y=x^4\\sin x$?", "a": "$y=c_1x^2+c_2x^3-x^2\\sin x$."},
]

MNEMONICS = [
    "<i>“One factor per derivative, counting down.”</i> $(ax+b)^ny^{(n)}\\to a^nD(D-1)\\cdots(D-n+1)$: $n$ factors, starting at $D$ and stepping down by 1 (study aid).",
]

TOP_FACTS = [
    "Legendre: $(ax+b)^k$ with the $k$-th derivative; Cauchy: $x^k$ ($a=1$, $b=0$). Asked in all 8 ESA papers (6–7 marks).",
    "$z=\\log(ax+b)$: $(ax+b)y'=aDy$, $(ax+b)^2y''=a^2D(D-1)y$, $(ax+b)^3y'''=a^3D(D-1)(D-2)y$, $D=\\frac{d}{dz}$.",
    "Rewrite the RHS with $x=\\frac{e^z-b}{a}$; solve in $z$; return with $e^{mz}=(ax+b)^m$, $z=\\log(ax+b)$.",
    "Watch failure cases in $z$: $\\frac{1}{(D-k)^2}e^{kz}=\\frac{z^2}{2}e^{kz}$ (Jul-23, Jan-24 s2), $\\frac{ze^{kz}}{f'(k)}$ (Jun-24, CW P29, P30, P33).",
    "Constant on the right: $\\frac{c}{f(0)}$.",
    "ESA Jul-23: $y=(2x+1)^2[c_1+c_2\\log(2x+1)+\\log^2(2x+1)]$. ESA Jan-24 s3: $y=c_1x^2+c_2x^3-x^2\\sin x$.",
    "CW P31, P32 printed answers are wrong: $-\\frac{x^2}{3}(\\log x+\\frac23)$, $2(\\log x)^3$.",
]
TOP_FORMULAS = ["E2.1", "E2.2", "E2.3", "E2.5", "E2.6", "E3.2"]
