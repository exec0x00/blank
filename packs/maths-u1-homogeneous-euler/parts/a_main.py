"""Class 005: homogeneous functions and Euler's theorem."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "Homogeneous functions",
     "overview": "A function is homogeneous of degree $n$ if it can be written as $x^n$ times a function of the ratios ($y/x$, "
                 "or $y/x$ and $z/x$). Equivalently, scaling every variable by $t$ scales the function by $t^n$. Polynomials are "
                 "homogeneous when every term has the same degree. The degree can be positive, negative, fractional or zero."},
    {"id": "T2", "title": "Euler's theorem",
     "overview": "For a homogeneous function of degree $n$, $x\\,u_x+y\\,u_y=n\\,u$ (and $x\\,u_x+y\\,u_y+z\\,u_z=n\\,u$ in three "
                 "variables). Once you know the function is homogeneous and its degree, the combination is known without "
                 "differentiating. Geometrically, the changes along $x$ and $y$, scaled by $x$ and $y$, add up to the function "
                 "scaled by its degree."},
    {"id": "T3", "title": "Second and higher order: the corollary",
     "overview": "Applying Euler's idea twice gives $x^2u_{xx}+2xy\\,u_{xy}+y^2u_{yy}=n(n-1)\\,u$, and three times gives "
                 "$n(n-1)(n-2)\\,u$. When $u$ is a sum of homogeneous parts of different degrees, apply the results to each part "
                 "separately. This is the commonest ESA question on the topic."},
    {"id": "T4", "title": "Extension: when f(u) is homogeneous",
     "overview": "Functions such as $\\tan^{-1}\\frac{x^4+y^4}{xy}$ are not homogeneous, but $\\tan u$ is. If $f(u)$ is homogeneous "
                 "of degree $n$, then $x\\,u_x+y\\,u_y=g(u)=n\\,\\dfrac{f(u)}{f'(u)}$ and $x^2u_{xx}+2xy\\,u_{xy}+y^2u_{yy}=g(u)\\,[g'(u)-1]$. "
                 "This extension is on the last content slide and is asked in two ESA papers."},
    {"id": "T5", "title": "Applications of homogeneous functions",
     "overview": "Euler's theorem relates a homogeneous function to its partial derivatives and describes how the function "
                 "scales. It is used in economics (production functions, marginal productivity, elasticity of demand) and in "
                 "thermodynamics, where extensive variables are homogeneous of degree 1 and intensive variables of degree 0. "
                 "A function of ratios only has degree 0, so its Euler combination is 0."},
]

DEFS = [
    {"topic": "T1", "term": "Homogeneous function (two variables)", "text": "A function $u=f(x,y)$ is said to be a homogeneous function "
     "of degree $n$ if it can be expressed in the form $x^n g\\big(\\tfrac yx\\big)$ or $y^n g\\big(\\tfrac xy\\big)$, $g$ being an arbitrary function.",
     "srcs": ["S005·3", "T005 00:02:45"]},
    {"topic": "T1", "term": "Homogeneous function (three variables)", "text": "$u=f(x,y,z)$ is homogeneous of degree $n$ if it can be "
     "expressed as $x^n g\\big(\\tfrac yx,\\tfrac zx\\big)$, or $y^n g\\big(\\tfrac xy,\\tfrac zy\\big)$, or $z^n g\\big(\\tfrac xz,\\tfrac yz\\big)$.",
     "srcs": ["S005·4", "T005 00:04:38"]},
    {"topic": "T1", "term": "Scaling test", "text": "$f$ is homogeneous of degree $n$ exactly when $f(tx,ty)=t^n f(x,y)$ for all $t>0$: "
     "scaling every variable by $t$ scales the function by $t^n$.", "srcs": ["S005·5"], "flags": [ADD]},
    {"topic": "T1", "term": "Degree", "text": "The power $n$ in $x^n g(y/x)$; for a polynomial whose terms all have the same total "
     "degree, that common degree.", "srcs": ["T005 00:01:31"]},
    {"topic": "T5", "term": "Extensive / intensive variable", "text": "Extensive variables (mass, volume, energy) double when the system "
     "is doubled: homogeneous of degree 1. Intensive variables (pressure, temperature, density) do not change: degree 0.",
     "srcs": ["S005·5", "T005 00:16:26"], "flags": [ADD]},
]

STATEMENTS = [
    {"topic": "T2", "text": "Statement 1: If $u=f(x,y)$ is a homogeneous function of degree $n$ then $x\\dfrac{\\partial u}{\\partial x}+y\\dfrac{\\partial u}{\\partial y}=nu$.", "srcs": ["S005·6"]},
    {"topic": "T2", "text": "Statement 2: If $u=f(x,y,z)$ is a homogeneous function of degree $n$ then $x\\dfrac{\\partial u}{\\partial x}+y\\dfrac{\\partial u}{\\partial y}+z\\dfrac{\\partial u}{\\partial z}=nu$.", "srcs": ["S005·6"]},
    {"topic": "T3", "text": "Corollary 1: If $u=f(x,y)$ is a homogeneous function of degree $n$ then $x^2\\dfrac{\\partial^2u}{\\partial x^2}+2xy\\dfrac{\\partial^2u}{\\partial x\\partial y}+y^2\\dfrac{\\partial^2u}{\\partial y^2}=n(n-1)u$.", "srcs": ["S005·6"]},
    {"topic": "T4", "text": "If $f(u)$ be a homogeneous function of degree $n$ in $x$ and $y$, then $x\\dfrac{\\partial u}{\\partial x}+y\\dfrac{\\partial u}{\\partial y}=n\\dfrac{f(u)}{f'(u)}$ "
     "and $x^2\\dfrac{\\partial^2u}{\\partial x^2}+2xy\\dfrac{\\partial^2u}{\\partial x\\partial y}+y^2\\dfrac{\\partial^2u}{\\partial y^2}=g(u)[g'(u)-1]$ where $g(u)=n\\dfrac{f(u)}{f'(u)}$.", "srcs": ["S005·7"]},
    {"topic": "T5", "text": "A constant function is homogeneous of degree 0. Linear functions are homogeneous of degree 1. The degree of the "
     "homogeneous function can be positive, negative or zero.", "srcs": ["S005·5"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Homogeneous of degree n", "tex": r"u=x^n g\!\left(\frac yx\right)=y^n h\!\left(\frac xy\right)\quad\Longleftrightarrow\quad u(tx,ty)=t^n\,u(x,y)",
     "gives": "The definition and the equivalent scaling test.", "when": "Two variables; with three, use $x^n g(y/x,z/x)$.",
     "note": "The scaling test is added for clarity; the slides use the $x^n g(y/x)$ form.", "stars": 2, "srcs": ["S005·3", "S005·4", "S005·5"]},
    {"id": "E1.2", "topic": "T1", "title": "Degree of a quotient and of a product", "tex": r"\deg\frac{P}{Q}=\deg P-\deg Q,\qquad \deg(PQ)=\deg P+\deg Q",
     "gives": "Degree of combinations of homogeneous functions.", "when": "$P$, $Q$ homogeneous.",
     "note": "$\\frac{\\sqrt x+\\sqrt y}{x+y}$: $\\tfrac12-1=-\\tfrac12$. A ratio such as $\\sin^{-1}(y/x)$ has degree 0.", "stars": 2, "srcs": ["T005 00:07:50"], "flags": [ADD]},
    {"id": "E2.1", "topic": "T2", "title": "Euler's theorem, two variables", "tex": r"x\frac{\partial u}{\partial x}+y\frac{\partial u}{\partial y}=n\,u",
     "gives": "The scaled sum of first partials.", "when": "$u$ homogeneous of degree $n$.", "note": "Compact form: $xu_x+yu_y=nu$.", "stars": 3,
     "srcs": ["S005·6", "T005 00:08:57"]},
    {"id": "E2.2", "topic": "T2", "title": "Euler's theorem, three variables", "tex": r"x\frac{\partial u}{\partial x}+y\frac{\partial u}{\partial y}+z\frac{\partial u}{\partial z}=n\,u",
     "gives": "The same result with one term per variable.", "when": "$u=f(x,y,z)$ homogeneous of degree $n$.", "note": "Extends to any number of variables.", "stars": 2,
     "srcs": ["S005·6", "T005 00:14:28"]},
    {"id": "E3.1", "topic": "T3", "title": "Corollary: second order", "tex": r"x^2\frac{\partial^2u}{\partial x^2}+2xy\frac{\partial^2u}{\partial x\,\partial y}+y^2\frac{\partial^2u}{\partial y^2}=n(n-1)\,u",
     "gives": "The scaled sum of second partials.", "when": "$u$ homogeneous of degree $n$ with continuous second partials.",
     "note": "Coefficients $1,2,1$ as in $(x+y)^2$.", "stars": 3, "srcs": ["S005·6", "T005 00:12:21"]},
    {"id": "E3.2", "topic": "T3", "title": "Third order", "tex": r"x^3u_{xxx}+3x^2y\,u_{xxy}+3xy^2u_{xyy}+y^3u_{yyy}=n(n-1)(n-2)\,u",
     "gives": "The pattern continues with binomial coefficients.", "when": "Third partials continuous.",
     "note": "The lecture states the right-hand side; the coefficients 1, 3, 3, 1 are added for clarity.", "stars": 1, "srcs": ["T005 00:12:43", "T005 00:14:12"], "flags": [TONLY, ADD]},
    {"id": "E3.3", "topic": "T3", "title": "First plus second order", "tex": r"x^2u_{xx}+2xy\,u_{xy}+y^2u_{yy}+x\,u_x+y\,u_y=n(n-1)u+nu=n^2u",
     "gives": "The combination asked in ESA Jan 2024 sets 3 and 4.", "when": "$u$ homogeneous of degree $n$; for $u=u_1+u_2$ apply to each part.",
     "note": "Degrees 3 and $-3$ both give $9$: so $9u$ for $x^3\\sin^{-1}\\frac yx+y^{-3}\\tan^{-1}\\frac xy$.", "stars": 3, "srcs": ["ESA Jan-24 s3 1c", "ESA Jan-24 s4 1d", "CW U1 P23"], "flags": [ADD]},
    {"id": "E4.1", "topic": "T4", "title": "Extension, first order", "tex": r"f(u)\ \text{homogeneous of degree } n\ \Longrightarrow\ x\frac{\partial u}{\partial x}+y\frac{\partial u}{\partial y}=n\frac{f(u)}{f'(u)}=g(u)",
     "gives": "Euler's combination for a function that is not itself homogeneous.", "when": "Some $f(u)$ is homogeneous (e.g. $\\tan u$, $\\sin u$, $e^u$).",
     "note": "$\\tan u$: $g=n\\tan u\\cos^2u=\\tfrac n2\\sin2u$.", "stars": 3, "srcs": ["S005·7"]},
    {"id": "E4.2", "topic": "T4", "title": "Extension, second order", "tex": r"x^2\frac{\partial^2u}{\partial x^2}+2xy\frac{\partial^2u}{\partial x\,\partial y}+y^2\frac{\partial^2u}{\partial y^2}=g(u)\,\big[g'(u)-1\big]",
     "gives": "The second-order combination for the extension.", "when": "$g(u)=n\\,f(u)/f'(u)$ from E4.1.", "note": "Differentiate $g$ with respect to $u$.", "stars": 3, "srcs": ["S005·7"]},
]

POINTS = [
    {"topic": "T1", "text": "For a polynomial, check that every term has the same total degree; that is the degree ($x^3+3x^2y+3xy^2+y^3$: degree 3).", "stars": 2, "srcs": ["T005 00:01:15", "T005 00:01:31"]},
    {"topic": "T1", "text": "To test any function: take out $x^n$ (or $y^n$) and check that what remains depends only on $y/x$ (and $z/x$).", "stars": 2, "srcs": ["S005·3", "T005 00:05:42"]},
    {"topic": "T1", "text": "Either form, $x^ng(y/x)$ or $y^nh(x/y)$, may be used — whichever is convenient — and both give the same degree.", "stars": 2, "srcs": ["T005 00:04:01"]},
    {"topic": "T1", "text": "Inverse trigonometric or exponential functions of a homogeneous expression are usually not homogeneous; first find an $f$ with $f(u)$ homogeneous (topic 4).", "stars": 3, "srcs": ["T005 00:01:47", "T005 00:02:04"]},
    {"topic": "T1", "text": "Homogeneous functions appeared earlier in homogeneous differential equations, solved by $y=vx$.", "stars": 1, "srcs": ["T005 00:00:22"], "flags": [TONLY]},
    {"topic": "T2", "text": "You do not need to differentiate: check that $u$ is homogeneous, find $n$, and write $xu_x+yu_y=nu$.", "stars": 3, "srcs": ["T005 00:09:17", "T005 00:17:32"]},
    {"topic": "T2", "text": "The lecturer calls Euler's theorem “the most important one” of the session.", "stars": 3, "srcs": ["T005 00:08:57"]},
    {"topic": "T2", "text": "Check: $u=x^2+y^2$ gives $x(2x)+y(2y)=2u$, degree 2.", "stars": 2, "srcs": ["T005 00:10:31"]},
    {"topic": "T2", "text": "Meaning: the change along $x$ scaled by $x$, plus the change along $y$ scaled by $y$, equals the function scaled by its degree.", "stars": 1, "srcs": ["T005 00:09:46", "T005 00:11:24"]},
    {"topic": "T3", "text": "The mixed partials $u_{xy}$ and $u_{yx}$ are equal here (continuous derivatives), which is why the middle term is $2xy\\,u_{xy}$.", "stars": 2, "srcs": ["T005 00:12:04"]},
    {"topic": "T3", "text": "For $u=u_1+u_2$ with different degrees $n_1,n_2$, apply the results to each part: $x^2u_{xx}+\\dots=n_1(n_1-1)u_1+n_2(n_2-1)u_2$.", "stars": 3, "srcs": ["ESA Jan-24 s3 1c", "CW U1 P22"], "flags": [ADD]},
    {"topic": "T3", "text": "Extend to three or more variables as an exercise; the lecture leaves it open and points to a research paper on higher-order extensions.", "stars": 1, "srcs": ["S005·6", "T005 00:14:59"]},
    {"topic": "T4", "text": "Spot the extension case: $u=\\sin^{-1}(\\dots)$, $\\tan^{-1}(\\dots)$, $\\log(\\dots)$ or $e^{(\\dots)}$ of a homogeneous expression; then $f$ is $\\sin$, $\\tan$, $\\exp$ or $\\log$ respectively.", "stars": 3, "srcs": ["S005·7", "ESA May-24 1a"], "flags": [ADD]},
    {"topic": "T4", "text": "The degree $n$ belongs to $f(u)$, not to $u$.", "stars": 3, "srcs": ["S005·7"]},
    {"topic": "T5", "text": "A constant function is homogeneous of degree 0; linear functions are homogeneous of degree 1.", "stars": 1, "srcs": ["S005·5", "T005 00:06:52"]},
    {"topic": "T5", "text": "Euler's theorem also describes the scaling of the function: $n\\,u$.", "stars": 1, "srcs": ["S005·5", "T005 00:15:57"]},
    {"topic": "T5", "text": "Applications: production functions, marginal productivities and elasticity of demand in economics; extensive (degree 1) and intensive (degree 0) variables in thermodynamics.", "stars": 1, "srcs": ["S005·5", "T005 00:16:09"]},
    {"topic": "T5", "text": "Any function of ratios only, such as $f(x/y,\\,y/z,\\,z/x)$, has degree 0, so $xu_x+yu_y+zu_z=0$ (ESA Jan 2024 set 1).", "stars": 3, "srcs": ["ESA Jan-24 s1 1d"], "flags": [ADD]},
]

WHY = [
    {"topic": "T2", "q": "Why is $xu_x+yu_y=nu$? (A short proof.)",
     "a": "Differentiate $u(tx,ty)=t^nu(x,y)$ with respect to $t$ using the chain rule: $x\\,u_x(tx,ty)+y\\,u_y(tx,ty)=nt^{n-1}u(x,y)$. Put $t=1$.",
     "srcs": ["S005·6"], "flags": [ADD]},
    {"topic": "T3", "q": "Why is the second-order right side $n(n-1)u$?",
     "a": "$u_x$ and $u_y$ are homogeneous of degree $n-1$, so Euler's theorem applied to them gives $xu_{xx}+yu_{xy}=(n-1)u_x$ and "
          "$xu_{yx}+yu_{yy}=(n-1)u_y$. Multiply by $x$ and $y$, add, and use $xu_x+yu_y=nu$.", "srcs": ["S005·6"], "flags": [ADD]},
    {"topic": "T4", "q": "Where does $n\\,f(u)/f'(u)$ come from?",
     "a": "Apply Euler to $F=f(u)$: $xF_x+yF_y=nF$. By the chain rule $F_x=f'(u)u_x$, $F_y=f'(u)u_y$, so $f'(u)(xu_x+yu_y)=nf(u)$.",
     "srcs": ["S005·7"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T1", "text": "The lecture says the converse holds: “a function of degree 0 should be a constant function”. It does not: $y/x$, "
     "$\\sin^{-1}(y/x)$ and $\\frac{x-y}{x+y}$ all have degree 0 and are not constant.", "srcs": ["T005 00:07:11"], "flags": [ADD]},
    {"topic": "T1", "text": "“Homogeneous” does not mean “smooth everywhere” (as said at T005 00:11:06); it is a scaling property. "
     "$(\\sqrt x+\\sqrt y)/(x+y)$ is homogeneous but not defined at the origin.", "srcs": ["T005 00:11:06"], "flags": [ADD]},
    {"topic": "T4", "text": "For $u=\\tan^{-1}\\frac{x^4+y^4}{xy}$ the degree is that of $\\tan u=\\frac{x^4+y^4}{xy}$, i.e. $4-2=2$, not of $u$.", "srcs": ["ESA May-24 1a"], "flags": [ADD]},
    {"topic": "T5", "text": "The lecture swaps the examples: mass is extensive (degree 1); pressure and temperature are intensive (degree 0).", "srcs": ["T005 00:16:46"], "flags": [ADD]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "Degree of a linear function", "srcs": ["S005·3"], "stars": 1,
     "given": "$u=3x+4y$.", "steps": ["$u=x\\big(3+4\\tfrac yx\\big)=x^1g\\big(\\tfrac yx\\big)$."], "answer": "Homogeneous of degree 1", "check": "$u(tx,ty)=t\\,u$."},
    {"id": "W1.2", "topic": "T1", "title": "Three variables", "srcs": ["S005·4", "T005 00:04:52"], "stars": 2,
     "given": "$u=x^3+y^3+z^3+3xyz$.",
     "steps": ["$u=x^3\\Big(1+\\big(\\tfrac yx\\big)^3+\\big(\\tfrac zx\\big)^3+3\\tfrac yx\\tfrac zx\\Big)=x^3g\\big(\\tfrac yx,\\tfrac zx\\big)$."],
     "answer": "Homogeneous of degree 3", "check": "Every term has total degree 3. (The slide prints the second term's exponent as 2; it should be 3.)"},
    {"id": "W1.3", "topic": "T1", "title": "A negative, fractional degree", "srcs": ["T005 00:07:50"], "stars": 2, "flags": [TONLY],
     "given": "$u=\\dfrac{\\sqrt x+\\sqrt y}{x+y}$.",
     "steps": ["Numerator: $\\sqrt x\\big(1+\\sqrt{y/x}\\big)$; denominator: $x(1+y/x)$.", "$u=x^{1/2-1}\\,g\\big(\\tfrac yx\\big)=x^{-1/2}g\\big(\\tfrac yx\\big)$."],
     "answer": "Homogeneous of degree $-\\tfrac12$", "check": "Euler: $xu_x+yu_y=-\\tfrac12u$ (sympy)."},
    {"id": "W2.1", "topic": "T2", "title": "Euler's theorem checked directly", "srcs": ["T005 00:10:31"], "stars": 2,
     "given": "$u=x^2+y^2$.", "steps": ["$u_x=2x$, $u_y=2y$.", "$xu_x+yu_y=2x^2+2y^2$."], "answer": "$xu_x+yu_y=2u$", "check": "Degree 2, as Euler predicts."},
    {"id": "W2.2", "topic": "T2", "title": "Degree 1 with an inverse sine", "srcs": ["CW U1 P21"], "stars": 2,
     "given": "$u=\\sqrt{y^2-x^2}\\,\\sin^{-1}(x/y)$; find $xu_x+yu_y$.",
     "steps": ["$\\sqrt{y^2-x^2}=y\\sqrt{1-(x/y)^2}$ has degree 1; $\\sin^{-1}(x/y)$ has degree 0.", "So $u=y^1h(x/y)$: degree 1."],
     "answer": "$xu_x+yu_y=u$", "check": "CW answer: $u$."},
    {"id": "W3.1", "topic": "T3", "title": "Prove 5u and 20u", "srcs": ["ESA Jul-23 1a"], "stars": 3,
     "given": "$u=x^3y^2\\sin^{-1}(y/x)$. Prove (i) $xu_x+yu_y=5u$, (ii) $x^2u_{xx}+2xy\\,u_{xy}+y^2u_{yy}=20u$.",
     "steps": ["$x^3y^2=x^5\\big(\\tfrac yx\\big)^2$ and $\\sin^{-1}(y/x)$ depends only on $y/x$, so $u=x^5g(y/x)$: degree 5.", "(i) Euler: $5u$.", "(ii) Corollary: $n(n-1)u=5\\cdot4\\,u$."],
     "answer": "(i) $5u$, (ii) $20u$", "check": "Direct differentiation in sympy gives the same."},
    {"id": "W3.2", "topic": "T3", "title": "Fractional degree, both orders", "srcs": ["CW U1 P19"], "stars": 2,
     "given": "$u=\\dfrac{y^{1/3}-x^{1/3}}{x+y}$.",
     "steps": ["Degree $\\tfrac13-1=-\\tfrac23$.", "(i) $xu_x+yu_y=-\\tfrac23u$.", "(ii) $n(n-1)=\\big(-\\tfrac23\\big)\\big(-\\tfrac53\\big)=\\tfrac{10}{9}$."],
     "answer": "(i) $-\\tfrac23u$, (ii) $\\tfrac{10}{9}u$", "check": "CW answers agree."},
    {"id": "W3.3", "topic": "T3", "title": "Sum of two degree-3 parts", "srcs": ["CW U1 P22"], "stars": 2,
     "given": "$u=x^3\\sin^{-1}(y/x)+y^3\\tan^{-1}(x/y)$; find $x^2u_{xx}+2xy\\,u_{xy}+y^2u_{yy}$.",
     "steps": ["Both parts are homogeneous of degree 3, so $u$ is.", "$n(n-1)=3\\cdot2$."], "answer": "$6u$", "check": "CW answer: $6u$."},
    {"id": "W3.4", "topic": "T3", "title": "Degrees 3 and −3 together", "srcs": ["ESA Jan-24 s4 1d", "CW U1 P23"], "stars": 3,
     "given": "$u=x^3\\sin^{-1}(y/x)+y^{-3}\\tan^{-1}(x/y)$; evaluate $x^2u_{xx}+2xy\\,u_{xy}+y^2u_{yy}+xu_x+yu_y$.",
     "steps": ["$u_1=x^3\\sin^{-1}(y/x)$: degree 3; $u_2=y^{-3}\\tan^{-1}(x/y)$: degree $-3$.", "For each part the sum is $n(n-1)+n=n^2$: $9u_1$ and $9u_2$."],
     "answer": "$9u$", "check": "CW answer: $9u$; sympy agrees."},
    {"id": "W3.5", "topic": "T3", "title": "Degrees 3 and 4, value at (1, 1)", "srcs": ["ESA Jan-24 s3 1c"], "stars": 3,
     "given": "$u=x^3\\sin^{-1}(y/x)+x^4\\tan^{-1}(y/x)$; find $x^2u_{xx}+2xy\\,u_{xy}+y^2u_{yy}+xu_x+yu_y$ at $x=1,y=1$.",
     "steps": ["$u_1=x^3\\sin^{-1}(y/x)$ (degree 3) gives $9u_1$; $u_2=x^4\\tan^{-1}(y/x)$ (degree 4) gives $16u_2$.",
               "At $(1,1)$: $u_1=\\sin^{-1}1=\\tfrac\\pi2$, $u_2=\\tan^{-1}1=\\tfrac\\pi4$.", "$9\\cdot\\tfrac\\pi2+16\\cdot\\tfrac\\pi4$."],
     "answer": "$\\dfrac{17\\pi}{2}$", "check": "sympy: the expression equals $9u_1+16u_2$ identically."},
    {"id": "W4.1", "topic": "T4", "title": "Extension with tan u", "srcs": ["ESA May-24 1a", "ESA Jun-24 1b", "CW U1 P20"], "stars": 3,
     "given": "$u=\\tan^{-1}\\dfrac{x^4+y^4}{xy}$. Prove (i) $xu_x+yu_y=\\sin2u$, (ii) $x^2u_{xx}+2xy\\,u_{xy}+y^2u_{yy}=\\sin2u\\,(1-4\\sin^2u)$.",
     "steps": ["$f(u)=\\tan u=\\dfrac{x^4+y^4}{xy}$ is homogeneous of degree $4-2=2$.",
               "(i) $g(u)=2\\dfrac{\\tan u}{\\sec^2u}=2\\sin u\\cos u=\\sin2u$.",
               "(ii) $g'(u)=2\\cos2u$, so $g(g'-1)=\\sin2u\\,(2\\cos2u-1)=\\sin2u\\,(1-4\\sin^2u)$, using $\\cos2u=1-2\\sin^2u$."],
     "answer": "(i) $\\sin2u$, (ii) $\\sin2u\\,(1-4\\sin^2u)$", "check": "sympy: residuals 0 and $\\approx10^{-16}$."},
    {"id": "W5.1", "topic": "T5", "title": "A function of ratios only", "srcs": ["ESA Jan-24 s1 1d"], "stars": 3, "flags": [ADD],
     "given": "$u=f\\big(\\tfrac xy,\\tfrac yz,\\tfrac zx\\big)$; find $xu_x+yu_y+zu_z$.",
     "steps": ["Scaling $x,y,z$ by $t$ leaves every ratio unchanged, so $u(tx,ty,tz)=u$: degree 0.", "Euler in three variables: $xu_x+yu_y+zu_z=0\\cdot u$."],
     "answer": "$xu_x+yu_y+zu_z=0$", "check": "Same answer as the chain-rule method (sympy)."},
]

PYQS = [
    {"topic": "T3", "paper": "ESA Jul 2023", "q": "UE22MA141A Q1.a", "marks": 6,
     "text": "If $u(x,y)=x^3y^2\\sin^{-1}\\big(\\frac yx\\big)$, prove that (i) $x\\frac{\\partial u}{\\partial x}+y\\frac{\\partial u}{\\partial y}=5u$, (ii) $x^2\\frac{\\partial^2u}{\\partial x^2}+2xy\\frac{\\partial^2u}{\\partial x\\partial y}+y^2\\frac{\\partial^2u}{\\partial y^2}=20u$.", "worked": "W3.1"},
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 3, Q1.c", "marks": 6,
     "text": "If $u=x^3\\sin^{-1}\\big(\\frac yx\\big)+x^4\\tan^{-1}\\big(\\frac yx\\big)$, find $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}+xu_x+yu_y$ at $x=1$, $y=1$ by using Euler's theorem and its extension.", "worked": "W3.5"},
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 4, Q1.d", "marks": 6,
     "text": "If $u=x^3\\sin^{-1}\\big(\\frac yx\\big)+y^{-3}\\tan^{-1}\\big(\\frac xy\\big)$, evaluate $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}+xu_x+yu_y$ by using Euler's theorem and its extension.", "worked": "W3.4"},
    {"topic": "T4", "paper": "ESA May 2024", "q": "UE22MA141A Q1.a", "marks": 6,
     "text": "If $u=\\tan^{-1}\\big(\\frac{x^4+y^4}{xy}\\big)$, prove that (i) $xu_x+yu_y=\\sin2u$, (ii) $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=\\sin2u(1-4\\sin^2u)$.", "worked": "W4.1"},
    {"topic": "T4", "paper": "ESA June 2024", "q": "UE23MA141A Q1.b", "marks": 6,
     "text": "Same question as May 2024 Q1.a: $u=\\tan^{-1}\\big(\\frac{x^4+y^4}{xy}\\big)$, prove (i) and (ii).", "worked": "W4.1"},
    {"topic": "T5", "paper": "ESA Jan 2024", "q": "UE23MA141A set 1, Q1.d", "marks": 5,
     "text": "If $u=f\\big(\\frac xy,\\frac yz,\\frac zx\\big)$, find $x\\frac{\\partial u}{\\partial x}+y\\frac{\\partial u}{\\partial y}+z\\frac{\\partial u}{\\partial z}$ (degree 0; also solvable by the chain rule).", "worked": "W5.1"},
]

NOTES = [
    {"topic": "T1", "text": "$u=f(x,y)$ is homogeneous of degree $n$ if $u=x^ng(y/x)$ or $y^ng(x/y)$; in three variables $x^ng(y/x,z/x)$. "
     "Equivalently $u(tx,ty)=t^nu$. A polynomial is homogeneous if all its terms have the same degree. The degree may be positive, "
     "negative, fractional or zero, e.g. $(\\sqrt x+\\sqrt y)/(x+y)$ has degree $-\\tfrac12$."},
    {"topic": "T2", "text": "Euler's theorem: if $u=f(x,y)$ is homogeneous of degree $n$ then $xu_x+yu_y=nu$; for $f(x,y,z)$, "
     "$xu_x+yu_y+zu_z=nu$. So only homogeneity and the degree are needed, not the derivatives. Proof: differentiate "
     "$u(tx,ty)=t^nu$ with respect to $t$ and put $t=1$."},
    {"topic": "T3", "text": "Corollary: $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=n(n-1)u$; adding the first-order result gives $n^2u$. For a sum "
     "of homogeneous parts of different degrees apply this to each part, e.g. degrees 3 and 4 give $9u_1+16u_2$. Third order: $n(n-1)(n-2)u$."},
    {"topic": "T4", "text": "If $f(u)$ (not $u$) is homogeneous of degree $n$: $xu_x+yu_y=g(u)=nf(u)/f'(u)$ and "
     "$x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=g(u)[g'(u)-1]$. For $u=\\tan^{-1}\\frac{x^4+y^4}{xy}$: $f=\\tan$, $n=2$, $g=\\sin2u$, "
     "second order $\\sin2u(1-4\\sin^2u)$."},
    {"topic": "T5", "text": "Constants are homogeneous of degree 0 and linear functions of degree 1. Euler's theorem gives the scaling of a "
     "function; it is used in economics (production functions, marginal productivity, elasticity) and in thermodynamics "
     "(extensive variables degree 1, intensive degree 0). A function of ratios has degree 0, so its Euler sum is 0."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "Scaling along a ray: $u(tx,ty)=t^n u(x,y)$", "stars": 2, "srcs": ["S005·3", "S005·5"], "flags": [ADD],
     "howto": "Start at a point and move out along the ray through the origin by the factor $t$. A homogeneous function of degree $n$ "
              "changes like $t^n$: degree 2 grows quadratically, degree 1 linearly, degree 0 stays constant along the ray "
              "(but can vary between rays), and degree $-\\tfrac12$ decays. Each curve is $u(t)/u(1)$."},
    {"id": "G2.1", "topic": "T2", "title": "Level curves of a homogeneous function are scaled copies", "stars": 2, "srcs": ["S005·5", "T005 00:10:18"], "flags": [ADD],
     "howto": "Level curves of $u=x^2+xy+y^2$ (degree 2) for $u=1,4,9$. Each is the first one scaled by $1,2,3=\\sqrt u$. Moving out "
              "along the dashed ray, the rate of change $x u_x+y u_y$ (the radial change scaled by distance) equals $2u$: this is "
              "Euler's theorem."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "Is it homogeneous, and of what degree?", "stars": 2, "srcs": ["S005·3", "S005·4", "T005 00:02:36", "T005 00:05:42"],
     "layout": "route", "maxw": "165mm",
     "spec": {"question": "What kind of function is $u$?",
              "rows": [{"title": "A polynomial", "sub": "All terms the same total degree?", "kw": "$n$ = common degree"},
                       {"title": "A quotient or product of homogeneous parts", "sub": "Subtract or add the degrees", "kw": "$n_P-n_Q$, $n_P+n_Q$"},
                       {"title": "Anything you can factor", "sub": "Take out $x^n$; the rest depends only on $y/x$ (and $z/x$)?", "kw": "$x^ng(y/x)$"},
                       {"title": "$\\sin^{-1}$, $\\tan^{-1}$, $e$, $\\log$ of a homogeneous expression", "sub": "Usually not homogeneous: use $f(u)$", "kw": "extension (T4)"},
                       {"title": "Sum of parts with different degrees", "sub": "Treat each part separately", "kw": "$u_1+u_2$"},
                       {"title": "Unsure", "sub": "Replace $x,y$ by $tx,ty$", "kw": "$u(tx,ty)=t^nu$", "dashed": True}]},
     "remark": "The dashed route (the scaling test) is added for clarity; it always works and confirms the degree found by factoring."},
    {"id": "F3.1", "topic": "T3", "title": "Evaluating Euler combinations for a sum of homogeneous parts.", "stars": 3, "srcs": ["ESA Jan-24 s3 1c", "ESA Jan-24 s4 1d"],
     "layout": "streams", "maxw": "150mm",
     "spec": {"left": [{"kind": "given", "title": "$u_1=x^3\\sin^{-1}(y/x)$", "sub": "degree 3"},
                       {"kind": "step", "title": "First + second order", "fx": "$n^2u_1=9u_1$"}],
              "right": [{"kind": "given", "title": "$u_2=x^4\\tan^{-1}(y/x)$", "sub": "degree 4"},
                        {"kind": "step", "title": "First + second order", "fx": "$n^2u_2=16u_2$"}],
              "then": [{"kind": "step", "n": 3, "title": "Add and substitute the point", "fx": "$9u_1+16u_2$ at $(1,1)$: $u_1=\\tfrac\\pi2,\\ u_2=\\tfrac\\pi4$"},
                       {"kind": "result", "title": "Value", "fx": "$\\dfrac{17\\pi}{2}$"}]},
     "remark": "Only first order: $n$; only second order: $n(n-1)$; both: $n^2$. Read which combination the question asks for."},
    {"id": "F4.1", "topic": "T4", "title": "Using the extension of Euler's theorem.", "stars": 3, "srcs": ["S005·7", "ESA May-24 1a"],
     "layout": "straight", "maxw": "120mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$u=\\tan^{-1}\\dfrac{x^4+y^4}{xy}$", "sub": "$u$ itself is not homogeneous"},
         {"kind": "step", "n": 1, "title": "Choose $f$ so that $f(u)$ is homogeneous", "fx": "$f(u)=\\tan u=\\dfrac{x^4+y^4}{xy}$"},
         {"kind": "step", "n": 2, "title": "Degree of $f(u)$", "fx": "$n=4-2=2$"},
         {"kind": "step", "n": 3, "title": "First order", "fx": "$g(u)=n\\dfrac{f}{f'}=2\\dfrac{\\tan u}{\\sec^2u}=\\sin2u$"},
         {"kind": "result", "title": "Second order", "fx": "$g(g'-1)=\\sin2u\\,(2\\cos2u-1)=\\sin2u\\,(1-4\\sin^2u)$"}]},
     "remark": "Common choices: $\\sin^{-1}(\\dots)\\to f=\\sin$ ($g=n\\tan u$); $\\tan^{-1}\\to f=\\tan$ ($g=\\tfrac n2\\sin2u$); $\\log(\\dots)\\to f=e^u$ ($g=n$); $e^{(\\dots)}\\to f=\\log$ ($g=nu\\log u$)."},
]

COMPARISONS = [
    {"id": "C2.1", "topic": "T2", "title": "Euler's theorem and its relatives", "flags": [ADD], "srcs": ["S005·6", "S005·7"],
     "head": ["", "Applies when", "Left side", "Right side"],
     "rows": [["Euler, first order", "$u$ homogeneous, degree $n$", "$xu_x+yu_y$", "$nu$"],
              ["Corollary, second order", "$u$ homogeneous, degree $n$", "$x^2u_{xx}+2xyu_{xy}+y^2u_{yy}$", "$n(n-1)u$"],
              ["Both added", "$u$ homogeneous, degree $n$", "first + second order", "$n^2u$"],
              ["Extension, first order", "$f(u)$ homogeneous, degree $n$", "$xu_x+yu_y$", "$g(u)=nf(u)/f'(u)$"],
              ["Extension, second order", "$f(u)$ homogeneous, degree $n$", "$x^2u_{xx}+2xyu_{xy}+y^2u_{yy}$", "$g(u)[g'(u)-1]$"],
              ["Three variables", "$u(x,y,z)$ homogeneous", "$xu_x+yu_y+zu_z$", "$nu$"]]},
]

SYMBOLS = [
    {"sym": "$u=f(x,y)$", "name": "Function", "meaning": "The function tested for homogeneity", "where": "E1.1, E2.1"},
    {"sym": "$n$", "name": "Degree", "meaning": "Power in $x^ng(y/x)$; any real number", "where": "E1.1–E4.2"},
    {"sym": "$g(\\cdot)$ (topic 1)", "name": "Arbitrary function of ratios", "meaning": "$u=x^ng(y/x)$", "where": "E1.1"},
    {"sym": "$g(u)$ (topic 4)", "name": "Extension function", "meaning": "$nf(u)/f'(u)$ (a different $g$ from topic 1)", "where": "E4.1, E4.2"},
    {"sym": "$f(u)$", "name": "Homogeneous function of $u$", "meaning": "e.g. $\\tan u$ when $u=\\tan^{-1}(\\dots)$", "where": "E4.1"},
    {"sym": "$t$", "name": "Scale factor", "meaning": "$u(tx,ty)=t^nu$", "where": "E1.1"},
    {"sym": "$u_x,u_y,u_z$", "name": "First partials", "meaning": "Homogeneous of degree $n-1$", "where": "E2.1, E2.2"},
    {"sym": "$u_{xx},u_{xy},u_{yy}$", "name": "Second partials", "meaning": "Degree $n-2$; $u_{xy}=u_{yx}$", "where": "E3.1"},
    {"sym": "$u_1,u_2$", "name": "Homogeneous parts", "meaning": "Parts of different degrees in a sum", "where": "E3.3"},
    {"sym": "$P,Q$", "name": "Homogeneous factors", "meaning": "Numerator and denominator of a quotient", "where": "E1.2"},
]

KEYWORDS = [
    {"term": "Arbitrary function", "meaning": "The $g$ in $x^ng(y/x)$: any function of the ratios.", "topic": "T1"},
    {"term": "Constant function", "meaning": "Homogeneous of degree 0.", "topic": "T5"},
    {"term": "Corollary (Euler)", "meaning": "$x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=n(n-1)u$.", "topic": "T3"},
    {"term": "Degree", "meaning": "The $n$ in $x^ng(y/x)$.", "topic": "T1"},
    {"term": "Degree 0", "meaning": "Depends on ratios only; Euler sum 0 (not necessarily constant).", "topic": "T5"},
    {"term": "Economics", "meaning": "Production functions, marginal productivity, elasticity of demand.", "topic": "T5"},
    {"term": "Euler's theorem", "meaning": "$xu_x+yu_y=nu$ for homogeneous $u$ of degree $n$.", "topic": "T2"},
    {"term": "Extension of Euler's theorem", "meaning": "$xu_x+yu_y=nf(u)/f'(u)$ when $f(u)$ is homogeneous.", "topic": "T4"},
    {"term": "Extensive variable", "meaning": "Scales with the system: degree 1 (mass, volume).", "topic": "T5"},
    {"term": "Homogeneous differential equation", "meaning": "Solved with $y=vx$; uses the same idea.", "topic": "T1"},
    {"term": "Homogeneous function", "meaning": "$u(tx,ty)=t^nu$.", "topic": "T1"},
    {"term": "Homogeneous polynomial", "meaning": "All terms of the same total degree.", "topic": "T1"},
    {"term": "Intensive variable", "meaning": "Unchanged by scaling: degree 0 (pressure, temperature).", "topic": "T5"},
    {"term": "Linear function", "meaning": "Homogeneous of degree 1 (no constant term).", "topic": "T5"},
    {"term": "Mixed partial", "meaning": "$u_{xy}=u_{yx}$, giving the $2xy$ term.", "topic": "T3"},
    {"term": "n(n−1)u", "meaning": "Right side of the second-order corollary.", "topic": "T3"},
    {"term": "Ratio", "meaning": "$y/x$, $z/x$: the variables of $g$.", "topic": "T1"},
    {"term": "Scaling", "meaning": "Multiplying all variables by $t$; multiplies $u$ by $t^n$.", "topic": "T1"},
    {"term": "Sum of homogeneous parts", "meaning": "Apply Euler to each part with its own degree.", "topic": "T3"},
    {"term": "Third-order Euler", "meaning": "$\\sum$ with coefficients 1, 3, 3, 1 $=n(n-1)(n-2)u$.", "topic": "T3"},
]

RAPID = [
    {"q": "Define a homogeneous function of degree $n$.", "a": "$u=x^ng(y/x)$ or $y^ng(x/y)$."},
    {"q": "Scaling form of the definition?", "a": "$u(tx,ty)=t^nu(x,y)$."},
    {"q": "Degree of $3x+4y$?", "a": "1."},
    {"q": "Degree of $x^3+y^3+z^3+3xyz$?", "a": "3."},
    {"q": "Degree of $(\\sqrt x+\\sqrt y)/(x+y)$?", "a": "$-\\tfrac12$."},
    {"q": "Degree of a constant?", "a": "0."},
    {"q": "Is every degree-0 function constant?", "a": "No: $y/x$ has degree 0."},
    {"q": "Euler's theorem (two variables)?", "a": "$xu_x+yu_y=nu$."},
    {"q": "Euler's theorem (three variables)?", "a": "$xu_x+yu_y+zu_z=nu$."},
    {"q": "Second-order corollary?", "a": "$x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=n(n-1)u$."},
    {"q": "First plus second order?", "a": "$n^2u$."},
    {"q": "Third order right side?", "a": "$n(n-1)(n-2)u$."},
    {"q": "$u=x^3y^2\\sin^{-1}(y/x)$: degree, Euler sums?", "a": "5; $5u$ and $20u$."},
    {"q": "Extension: $xu_x+yu_y$ when $f(u)$ is homogeneous?", "a": "$g(u)=nf(u)/f'(u)$."},
    {"q": "Extension, second order?", "a": "$g(u)[g'(u)-1]$."},
    {"q": "$u=\\tan^{-1}\\frac{x^4+y^4}{xy}$: $xu_x+yu_y$?", "a": "$\\sin2u$."},
    {"q": "Same $u$: second order?", "a": "$\\sin2u(1-4\\sin^2u)$."},
    {"q": "$x^3\\sin^{-1}\\frac yx+y^{-3}\\tan^{-1}\\frac xy$: first + second order?", "a": "$9u$."},
    {"q": "$x^3\\sin^{-1}\\frac yx+x^4\\tan^{-1}\\frac yx$ at $(1,1)$?", "a": "$17\\pi/2$."},
    {"q": "Extensive / intensive degrees?", "a": "1 / 0."},
]

MNEMONICS = [
    "<i>“Order k brings the falling product.”</i> First order $n$, second $n(n-1)$, third $n(n-1)(n-2)$; the coefficients follow the binomial row 1, 2, 1 or 1, 3, 3, 1.",
]

TOP_FACTS = [
    "Homogeneous of degree $n$: $u=x^ng(y/x)$, equivalently $u(tx,ty)=t^nu$.",
    "Degrees add for products and subtract for quotients; any degree is allowed.",
    "Euler: $xu_x+yu_y=nu$ (three variables: add $zu_z$).",
    "Corollary: $x^2u_{xx}+2xyu_{xy}+y^2u_{yy}=n(n-1)u$; with the first order added, $n^2u$.",
    "Sums of parts with different degrees: apply each degree to its own part.",
    "Extension: if $f(u)$ has degree $n$, $xu_x+yu_y=g=nf/f'$ and the second order is $g(g'-1)$.",
    "$\\tan^{-1}(\\cdot)$ gives $g=\\tfrac n2\\sin2u$; $\\sin^{-1}(\\cdot)$ gives $g=n\\tan u$.",
    "Degree 0 means a function of ratios only, so Euler's sum is 0; it does not mean constant.",
    "ESA favourites: $5u$ & $20u$; $\\sin2u$ & $\\sin2u(1-4\\sin^2u)$; $9u$; $17\\pi/2$.",
    "Applications: scaling, economics, thermodynamics (extensive degree 1, intensive degree 0).",
]
TOP_FORMULAS = ["E1.1", "E2.1", "E3.1", "E3.3", "E4.1", "E4.2"]
