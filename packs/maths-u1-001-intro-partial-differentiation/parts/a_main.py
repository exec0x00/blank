"""Class 001: Introduction to partial differentiation."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "Functions of two or more variables",
     "overview": "Most quantities depend on more than one variable: the area of a rectangle on its length and breadth, the volume of "
                 "a cylinder on $r$ and $h$, a potential on $x,y,z,t$. A function of two variables $z=f(x,y)$ assigns to each "
                 "ordered pair $(x,y)$ in a domain $D$ a unique real number. Its graph is a surface in three dimensions, so tools are "
                 "used to plot it; this unit works with two variables, and everything extends to $n$ variables."},
    {"id": "T2", "title": "Limit of a function of two variables",
     "overview": "In one variable $x$ can approach $a$ only from the left or the right. In the plane $(x,y)$ can approach $(a,b)$ along "
                 "infinitely many paths: lines, parabolas, ellipses. The limit is $L$ only if every path gives $L$. Proving a limit "
                 "exists is hard; proving it does not exist is easy: find two paths that give different values."},
    {"id": "T3", "title": "Continuity of a function of two variables",
     "overview": "$f$ is continuous at $(a,b)$ when $f(a,b)$ is defined, the limit exists, and $\\lim_{(x,y)\\to(a,b)}f(x,y)=f(a,b)$, as in "
                 "one variable. Geometrically the surface has no hole or break there. A function can fail to be continuous even "
                 "though the limit exists ($\\frac{3x^2y}{x^2+y^2}$ at the origin), or because the limit does not exist "
                 "($\\frac{2xy}{3x^2+y^2}$)."},
    {"id": "T4", "title": "Partial derivatives: history, definition and notation",
     "overview": "A partial derivative is the derivative with respect to one variable with the others held constant. The idea is "
                 "already in Leibniz's product rule; the symbol $\\partial$ came from Legendre (1786) and was reintroduced by Jacobi "
                 "(1841). $\\frac{\\partial z}{\\partial x}=z_x=f_x$ is defined by a limit, and every rule of ordinary "
                 "differentiation (product, quotient, chain) still holds."},
    {"id": "T5", "title": "Second-order and mixed partial derivatives",
     "overview": "Differentiating again gives $z_{xx}$, $z_{yy}$ and the mixed partials $z_{xy}$, $z_{yx}$. Clairaut's theorem: if the "
                 "second derivatives are continuous, the order of differentiation does not matter, $z_{xy}=z_{yx}$. Subscripts "
                 "are read in the order of differentiation; in the $\\partial$ notation the order is read from right to left."},
]

DEFS = [
    {"topic": "T1", "term": "Function of two variables", "text": "A function of two variables denoted by $z=f(x,y)$ is a rule that assigns "
     "to each ordered pair of real numbers $(x,y)$ in a set $D$ a unique real number denoted by $f(x,y)$. The set $D$ is the domain of "
     "$f$ and its range is the set of values that $f$ takes on: $\\{f(x,y):(x,y)\\in D\\}$.", "srcs": ["S001·8", "T001a 00:05:46"]},
    {"topic": "T1", "term": "Independent and dependent variables", "text": "In $z=f(x,y)$, $x$ and $y$ are independent variables and $z$ is "
     "the dependent variable (a bivariate function); with three independent variables one writes $w=f(x,y,z)$, and in general "
     "$f(x_1,x_2,\\dots,x_n)$.", "srcs": ["T001a 00:02:18", "T001a 00:02:54"], "flags": [TONLY]},
    {"topic": "T2", "term": "Limit of a function of two variables", "text": "A function $f(x,y)$ is said to approach the limit $L$ as "
     "$(x,y)$ approaches $(a,b)$, if the limit remains the same along any path of $(x,y)$ approaching $(a,b)$: "
     "$\\lim_{(x,y)\\to(a,b)}f(x,y)=L$.", "srcs": ["S001·9", "T001a 00:11:01"]},
    {"topic": "T3", "term": "Continuity at a point", "text": "$f(x,y)$ is continuous at $(a,b)$ if $\\lim_{(x,y)\\to(a,b)}f(x,y)=f(a,b)$: "
     "$f(a,b)$ must be defined, the limit must exist, and the two must be equal.", "srcs": ["S001·11", "T001b 00:00:38", "T001a 00:18:46"]},
    {"topic": "T4", "term": "Partial derivative", "text": "A partial derivative of a function of several variables is the derivative with "
     "respect to one of those variables, with the others held constant.", "srcs": ["S001·15", "T001b 00:12:52"]},
    {"topic": "T5", "term": "Mixed (crossed) partial derivatives", "text": "$z_{xy}=\\frac{\\partial}{\\partial y}\\big(\\frac{\\partial z}{\\partial x}\\big)$ "
     "and $z_{yx}=\\frac{\\partial}{\\partial x}\\big(\\frac{\\partial z}{\\partial y}\\big)$: differentiate with respect to one variable, then the other.",
     "srcs": ["S001·16", "T001b 00:18:24"]},
]

STATEMENTS = [
    {"topic": "T3", "text": "A function is continuous at a point if the graph doesn't have any holes or breaks at that point. Graphing the "
     "function is helpful. If a function is not continuous at $(a,b)$, this does not mean the limit does not exist. We will need to "
     "consider the approaching $(a,b)$ from different paths.", "srcs": ["S001·11"]},
    {"topic": "T5", "text": "Note 1: The crossed or mixed partial derivatives are in general equal (Clairaut's theorem): "
     "$\\frac{\\partial}{\\partial x}\\big(\\frac{\\partial z}{\\partial y}\\big)=\\frac{\\partial}{\\partial y}\\big(\\frac{\\partial z}{\\partial x}\\big)$. "
     "That is, the order of differentiation is immaterial if the second order derivatives involved are continuous.", "srcs": ["S001·17", "T001b 00:19:57"]},
    {"topic": "T5", "text": "Note 2: In the subscript notation, the subscripts are written in same order in which the differentiation is "
     "carried out, while in the $\\partial$ notation the order is opposite. For example, "
     "$\\frac{\\partial^2z}{\\partial y\\partial x}=\\frac{\\partial}{\\partial y}\\big(\\frac{\\partial z}{\\partial x}\\big)=f_{xy}$.", "srcs": ["S001·17"]},
]

FORMULAS = [
    {"id": "E2.1", "topic": "T2", "title": "Limit of f(x, y)", "tex": r"\lim_{(x,y)\to(a,b)}f(x,y)=L",
     "gives": "The value $f$ approaches near $(a,b)$.", "when": "The same $L$ along every path to $(a,b)$.",
     "note": "For a polynomial (or any function continuous at the point) just substitute.", "stars": 1, "srcs": ["S001·9", "T001a 00:13:59"]},
    {"id": "E2.2", "topic": "T2", "title": "Two-path test (limit does not exist)",
     "tex": r"\lim_{\text{path }1}f\neq\lim_{\text{path }2}f\ \Longrightarrow\ \lim_{(x,y)\to(a,b)}f(x,y)\ \text{does not exist}",
     "gives": "A proof that the limit does not exist.", "when": "Substitution gives $\\frac00$.",
     "note": "Lines $y=mx$ through the origin are the usual first try: if the answer depends on $m$, the limit does not exist.",
     "stars": 1, "srcs": ["S001·10", "T001a 00:17:42"]},
    {"id": "E3.1", "topic": "T3", "title": "Continuity at (a, b)", "tex": r"\lim_{(x,y)\to(a,b)}f(x,y)=f(a,b)",
     "gives": "The test for continuity.", "when": "Three conditions: $f(a,b)$ defined, limit exists, both equal.",
     "note": "One variable: $\\lim_{x\\to c}f(x)=f(c)$.", "stars": 1, "srcs": ["S001·11", "T001b 00:00:38"]},
    {"id": "E4.1", "topic": "T4", "title": "Partial derivatives from the definition",
     "tex": r"\begin{gathered}\frac{\partial z}{\partial x}=\lim_{h\to0}\frac{f(x+h,y)-f(x,y)}{h}\\ \frac{\partial z}{\partial y}=\lim_{h\to0}\frac{f(x,y+h)-f(x,y)}{h}\end{gathered}",
     "gives": "$z_x$ (y held constant) and $z_y$ (x held constant).", "when": "When the limits exist.",
     "note": "Only one variable is moved by $h$; the other stays fixed.", "stars": 2, "srcs": ["S001·15"]},
    {"id": "E4.2", "topic": "T4", "title": "Notation for first-order partials",
     "tex": r"\frac{\partial z}{\partial x}=\frac{\partial f}{\partial x}=z_x=f_x,\qquad \frac{\partial z}{\partial y}=\frac{\partial f}{\partial y}=z_y=f_y",
     "gives": "The equivalent symbols.", "when": "$z=f(x,y)$.", "note": "The symbol is $\\partial$ (“partial”, often read “dou”), not $\\delta$ or $d$.",
     "stars": 2, "srcs": ["S001·15", "T001b 00:11:41", "T001b 00:13:05"]},
    {"id": "E5.1", "topic": "T5", "title": "Second-order partials",
     "tex": r"z_{xx}=\frac{\partial}{\partial x}\Big(\frac{\partial z}{\partial x}\Big)=\frac{\partial^2z}{\partial x^2}=f_{xx},\qquad z_{yy}=\frac{\partial}{\partial y}\Big(\frac{\partial z}{\partial y}\Big)=\frac{\partial^2z}{\partial y^2}=f_{yy}",
     "gives": "Second derivatives in one variable.", "when": "Differentiate $z_x$ again in $x$ (or $z_y$ in $y$).",
     "note": "Same rules as ordinary second derivatives.", "stars": 2, "srcs": ["S001·16", "T001b 00:17:04"]},
    {"id": "E5.2", "topic": "T5", "title": "Mixed partials",
     "tex": r"z_{xy}=\frac{\partial}{\partial y}\Big(\frac{\partial z}{\partial x}\Big)=\frac{\partial^2z}{\partial y\,\partial x}=f_{xy},\qquad z_{yx}=\frac{\partial}{\partial x}\Big(\frac{\partial z}{\partial y}\Big)=\frac{\partial^2z}{\partial x\,\partial y}=f_{yx}",
     "gives": "The two crossed derivatives.", "when": "Differentiate in one variable, then the other.",
     "note": "Subscripts: left to right. $\\partial$ notation: right to left.", "stars": 2, "srcs": ["S001·16", "S001·17", "T001b 00:18:41"]},
    {"id": "E5.3", "topic": "T5", "title": "Clairaut's theorem", "tex": r"f_{xy}=f_{yx}\qquad\Big(\tfrac{\partial^2f}{\partial y\,\partial x}=\tfrac{\partial^2f}{\partial x\,\partial y}\Big)",
     "gives": "The order of differentiation does not matter.", "when": "$f_{xy}$ and $f_{yx}$ continuous near the point.",
     "note": "Called “a very important theorem” in the lecture; it is why Taylor's series has $2hkf_{xy}$.", "stars": 3,
     "srcs": ["S001·17", "T001b 00:19:57", "T001b 00:20:10"]},
]

POINTS = [
    {"topic": "T1", "text": "Examples on the slides: area of a rectangle $A(l,b)$; volume of a cylinder $v(r,h)$; electric potential in a cathode-ray "
     "tube $V=f(x,y,z,t)$; propagation of an electromagnetic wave (magnetic field, electric field, wavelength, direction); weather "
     "(topography, pressure, humidity, temperature); spread of a pandemic (area, population, awareness, immunity, age and gender distribution).",
     "stars": 1, "srcs": ["S001·4", "S001·5", "S001·6", "S001·7", "T001a 00:03:26"]},
    {"topic": "T1", "text": "A single-variable function is enough to understand a concept, but to draw a conclusion about a real situation we "
     "almost always need several variables.", "stars": 1, "srcs": ["T001a 00:05:16"], "flags": [TONLY]},
    {"topic": "T1", "text": "$f$ maps an ordered pair to one real number: for $z=x^3y$, the pair $(2,1)$ is mapped to $8$.", "stars": 1, "srcs": ["T001a 00:07:16"]},
    {"topic": "T1", "text": "Graph of $z=f(x,y)$: a surface, which needs three axes; a function of three variables would need four dimensions, so "
     "the unit sticks to two variables. The slide shows $\\sin x\\cos y$ and $e^{1-x^2-y^2}$ (Figures G1.1–G1.2).", "stars": 1,
     "srcs": ["S001·8", "T001a 00:08:35", "T001a 00:09:07"]},
    {"topic": "T2", "text": "One variable: $x\\to a$ from the left or the right only. Two variables: $(x,y)\\to(a,b)$ along any of infinitely many "
     "paths (Figure G2.1).", "stars": 1, "srcs": ["S001·9", "T001a 00:11:32", "T001a 00:12:34"]},
    {"topic": "T2", "text": "If substitution gives a number (a polynomial, no $\\frac00$), that number is the limit, whatever the path.", "stars": 1, "srcs": ["T001a 00:13:59"]},
    {"topic": "T2", "text": "It is hard to show that a limit exists but easy to show it does not: two paths with different values are enough.", "stars": 2,
     "srcs": ["S001·10", "T001a 00:17:42"]},
    {"topic": "T2", "text": "Agreement along a few paths proves nothing: for $\\frac{2xy}{3x^2+y^2}$, the $x$-axis and the parabola $y=x^2$ both give 0, "
     "but $y=x$ gives $\\frac12$.", "stars": 2, "srcs": ["T001a 00:16:48", "T001a 00:17:24"]},
    {"topic": "T3", "text": "One variable: $f$ is continuous at $c$ if (i) $\\lim_{x\\to c}f(x)$ exists, (ii) $f(c)$ exists, (iii) they are equal. "
     "The same three conditions define continuity for $f(x,y)$.", "stars": 1, "srcs": ["T001a 00:18:46", "S001·11"]},
    {"topic": "T3", "text": "$\\frac{3x^2y}{x^2+y^2}$: the limit at the origin exists (it is 0) but $f(0,0)$ is $\\frac00$, so $f$ is not continuous there. "
     "$\\frac{2xy}{3x^2+y^2}$: the limit does not exist and $f(0,0)$ is undefined (Figures G3.1–G3.2).", "stars": 1, "srcs": ["S001·12", "S001·13", "T001b 00:04:14", "T001b 00:05:44"]},
    {"topic": "T3", "text": "To decide continuity in higher dimensions, graph the function: a hole, fold or sudden drop in the surface shows a discontinuity.", "stars": 1,
     "srcs": ["S001·11", "T001b 00:06:45", "T001a 00:18:07"]},
    {"topic": "T4", "text": "The product rule is already partial differentiation: in $\\frac{d}{dx}(x^3\\sin x)=x^3\\cos x+3x^2\\sin x$, each term "
     "treats the other factor as a constant $k$. Leibniz: $d(uv)=u\\,dv+v\\,du$.", "stars": 1, "srcs": ["S001·14", "T001b 00:07:56", "T001b 00:10:18"]},
    {"topic": "T4", "text": "History: Leibniz first used partial differentiation (product rule); Adrien-Marie Legendre created the modern symbol "
     "$\\partial$ in 1786 but later abandoned it; Carl Gustav Jacob Jacobi reintroduced it in 1841.", "stars": 1, "srcs": ["S001·14", "T001b 00:11:23"]},
    {"topic": "T4", "text": "To find $z_x$, look only at the terms containing $x$; everything else is a constant, however many other variables there are.",
     "stars": 2, "srcs": ["T001b 00:15:08", "T001b 00:15:48"]},
    {"topic": "T4", "text": "A function of $x,y,t$ has three first partials $z_x$, $z_y$, $z_t$; for $z_x$ treat $y$ and $t$ as constants.", "stars": 1, "srcs": ["T001b 00:13:20"]},
    {"topic": "T4", "text": "All rules of ordinary differentiation hold for partial derivatives: product, quotient, chain rule, implicit and composite functions.",
     "stars": 2, "srcs": ["T001b 00:13:57", "T001b 00:14:16"]},
    {"topic": "T5", "text": "Read $z_{xyxx}$ left to right: $z\\to z_x\\to z_{xy}\\to z_{xyx}\\to z_{xyxx}$ (differentiate in $x$, then $y$, then $x$, then $x$).",
     "stars": 1, "srcs": ["T001b 00:18:51", "T001b 00:19:21"]},
    {"topic": "T5", "text": "Clairaut's theorem is “a very important theorem”: whenever the second partials are continuous (true for all "
     "examination functions away from bad points), compute whichever mixed partial is easier.", "stars": 3, "srcs": ["S001·17", "T001b 00:20:10"]},
    {"topic": "T5", "text": "Verifying $f_{xy}=f_{yx}$ is a standard class-work question: $x^y$ (CW P2) and $x^2\\tan^{-1}\\frac yx-y^2\\tan^{-1}\\frac xy$ (CW P8, W5.3).",
     "stars": 2, "srcs": ["CW U1 P2", "CW U1 P8"]},
]

WHY = [
    {"topic": "T2", "q": "Why can one path never prove that a limit exists?",
     "a": "There are infinitely many paths, and a function can agree on any finite number of them and still differ on another: "
          "$\\frac{2xy}{3x^2+y^2}$ gives 0 on the $x$-axis and on $y=x^2$ but $\\frac12$ on $y=x$. To prove existence one needs an "
          "estimate for all paths at once (e.g. polar coordinates: $\\frac{3x^2y}{x^2+y^2}=3r\\cos^2\\theta\\sin\\theta\\to0$).",
     "srcs": ["T001a 00:17:42", "S001·12"], "flags": [ADD]},
    {"topic": "T3", "q": "Why is $\\frac{3x^2y}{x^2+y^2}$ not continuous at the origin even though its limit is 0?",
     "a": "Continuity needs $f(0,0)$ to be defined and equal to the limit. Here $f(0,0)$ is $\\frac00$, so the third condition cannot be "
          "checked. Defining $f(0,0)=0$ would make it continuous.", "srcs": ["S001·12", "T001b 00:04:14"], "flags": [ADD]},
    {"topic": "T4", "q": "Why does every rule of ordinary differentiation still work?",
     "a": "With the other variables frozen, $f(x,y)$ is an ordinary function of $x$ alone, and $\\frac{\\partial f}{\\partial x}$ is its ordinary "
          "derivative (E4.1 is the usual limit with $y$ fixed).", "srcs": ["T001b 00:13:57", "S001·15"]},
]

TRAPS = [
    {"topic": "T2", "text": "Same value along two or three paths does not prove that the limit exists; different values along two paths does prove it does not.",
     "srcs": ["T001a 00:16:48", "T001a 00:17:42"]},
    {"topic": "T2", "text": "Slide 001·9 uses the point $(2,1)$ (limit $-8$); the lecture uses $(2,-1)$ (limit $-6$). Read the point in the question.",
     "srcs": ["S001·9", "T001a 00:12:59"], "flags": [ADD]},
    {"topic": "T3", "text": "“Not continuous” does not mean “the limit does not exist” (slide 001·11): $\\frac{3x^2y}{x^2+y^2}$ has limit 0 at the origin.",
     "srcs": ["S001·11", "T001b 00:02:10"]},
    {"topic": "T3", "text": "Continuous is not the same as smooth: $z=|x|+|y|$ is continuous everywhere but has a corner at the origin. The lecture's "
     "“continuous if the surface is smooth” is loose.", "srcs": ["T001b 00:06:26"], "flags": [ADD]},
    {"topic": "T5", "text": "$\\frac{\\partial^2z}{\\partial y\\,\\partial x}$ means $x$ first, then $y$: it is $z_{xy}$, not $z_{yx}$.", "srcs": ["S001·17"]},
    {"topic": "T5", "text": "Clairaut needs continuous second partials: for $f=\\frac{xy(x^2-y^2)}{x^2+y^2}$, $f(0,0)=0$, one gets $f_{xy}(0,0)=-1$ but $f_{yx}(0,0)=1$.",
     "srcs": ["S001·17"], "flags": [ADD]},
    {"topic": "T4", "text": "The partial symbol is $\\partial$, not $\\delta$ (the lecture stresses this) and not $d$.", "srcs": ["T001b 00:11:41"]},
]

WORKED = [
    {"id": "W2.1", "topic": "T2", "title": "Limit of a polynomial (slide 001·9)", "srcs": ["S001·9", "T001a 00:12:59", "T001a 00:13:47"], "stars": 1,
     "given": "Evaluate $\\lim_{(x,y)\\to(2,1)}(x^2-2xy+3y^2-4x+3y-6)$; the lecture also does the point $(2,-1)$.",
     "steps": ["A polynomial is continuous everywhere, so substitute.",
               "At $(2,1)$: $4-4+3-8+3-6=-8$.",
               "At $(2,-1)$: $4+4+3-8-3-6=-6$."],
     "answer": "$-8$ at $(2,1)$; $-6$ at $(2,-1)$", "check": "sympy agrees for both points. The value is reached along every path."},
    {"id": "W2.2", "topic": "T2", "title": "Show that a limit does not exist (slide 001·10)", "srcs": ["S001·10", "T001a 00:14:20", "T001a 00:15:04", "T001a 00:17:03"], "stars": 2,
     "given": "Show that $\\lim_{(x,y)\\to(0,0)}\\dfrac{2xy}{3x^2+y^2}$ does not exist.",
     "steps": ["Substitution gives $\\frac00$: indeterminate.",
               "Along $y=0$ ($x$-axis): $\\frac{0}{3x^2}=0\\to0$.",
               "Along $y=x^2$: $\\frac{2x^3}{3x^2+x^4}=\\frac{2x}{3+x^2}\\to0$.",
               "Along $y=x$: $\\frac{2x^2}{4x^2}=\\frac12$.",
               "General line $y=mx$: $\\frac{2m}{3+m^2}$, which depends on $m$ (Figure G2.2)."],
     "answer": "Different paths give $0$ and $\\tfrac12$: the limit does not exist", "check": "sympy: $\\frac{2m}{m^2+3}$ along $y=mx$."},
    {"id": "W3.1", "topic": "T3", "title": "Limit exists, function not continuous (slide 001·12)", "srcs": ["S001·12", "T001b 00:02:41", "T001b 00:04:27"], "stars": 1,
     "given": "Discuss the continuity of $f(x,y)=\\dfrac{3x^2y}{x^2+y^2}$ at the origin.",
     "steps": ["$f(0,0)=\\frac00$ is not defined, so condition (ii) fails: $f$ is not continuous at $(0,0)$.",
               "The limit exists: in polar form $x=r\\cos\\theta$, $y=r\\sin\\theta$, $f=3r\\cos^2\\theta\\sin\\theta$, and $|f|\\le3r\\to0$ for every path (added for clarity).",
               "So $\\lim_{(x,y)\\to(0,0)}f=0$."],
     "answer": "Not continuous at $(0,0)$; the limit is $0$ (removable: set $f(0,0)=0$)", "check": "sympy: polar form $3r\\sin\\theta\\cos^2\\theta$."},
    {"id": "W3.2", "topic": "T3", "title": "Limit does not exist, function not continuous (slide 001·13)", "srcs": ["S001·13", "T001b 00:05:05", "T001b 00:05:44"], "stars": 1,
     "given": "Discuss the continuity of $f(x,y)=\\dfrac{2xy}{3x^2+y^2}$ at the origin.",
     "steps": ["The limit does not exist (W2.2).", "$f(0,0)$ is also undefined."],
     "answer": "Not continuous at $(0,0)$; no choice of $f(0,0)$ can make it continuous", "check": "Figure G3.2 shows the jump along different directions."},
    {"id": "W4.1", "topic": "T4", "title": "A partial derivative from the definition", "srcs": ["S001·15"], "stars": 1, "flags": [ADD],
     "given": "Use E4.1 to find $f_x$ for $f(x,y)=x^2y$.",
     "steps": ["$\\frac{f(x+h,y)-f(x,y)}{h}=\\frac{(x+h)^2y-x^2y}{h}=\\frac{(2xh+h^2)y}{h}=(2x+h)y$.",
               "Let $h\\to0$: $2xy$."],
     "answer": "$f_x=2xy$", "check": "Same as differentiating $x^2$ with $y$ constant; sympy agrees."},
    {"id": "W4.2", "topic": "T4", "title": "Partials of a function of several variables (lecture)", "srcs": ["T001b 00:14:40", "T001b 00:15:48", "T001b 00:16:26", "T001b 00:16:44"], "stars": 2,
     "given": "$z=x^3\\sin y+e^w+\\log p$ (a function of $x,y,w,p$). Find $z_x$, $z_p$, $z_y$ and $z_{xy}$.",
     "steps": ["$z_x$: only $x^3\\sin y$ contains $x$; $\\sin y$ is a constant: $3x^2\\sin y$.",
               "$z_p$: only $\\log p$ contains $p$: $\\frac1p$.",
               "$z_y$: only $\\sin y$ varies: $x^3\\cos y$.",
               "$z_{xy}$: differentiate $z_x=3x^2\\sin y$ with respect to $y$: $3x^2\\cos y$."],
     "answer": "$z_x=3x^2\\sin y$, $z_p=\\dfrac1p$, $z_y=x^3\\cos y$, $z_{xy}=3x^2\\cos y$", "check": "sympy agrees; $z_{yx}=\\frac{\\partial}{\\partial x}(x^3\\cos y)=3x^2\\cos y$ too (Clairaut)."},
    {"id": "W5.1", "topic": "T5", "title": "Second-order partials of a function of three variables", "srcs": ["CW U1 P4"], "stars": 2,
     "given": "If $f(x,y,z)=e^{x^2+y^2+z^2}$, find $f_{xx}$, $f_{yy}$, $f_{zz}$ at $(-1,1,-1)$.",
     "steps": ["$f_x=2xe^{x^2+y^2+z^2}$.", "$f_{xx}=(2+4x^2)e^{x^2+y^2+z^2}$ (product rule).",
               "At $(-1,1,-1)$: $x^2+y^2+z^2=3$, so $f_{xx}=6e^3$; by symmetry $f_{yy}=(2+4y^2)e^3=6e^3$, $f_{zz}=6e^3$."],
     "answer": "$f_{xx}=f_{yy}=f_{zz}=6e^3$", "check": "CW answer agrees; sympy agrees."},
    {"id": "W5.2", "topic": "T5", "title": "Find n so that v satisfies an equation", "srcs": ["CW U1 P7", "ESA Jan-24 s4 1c"], "stars": 2,
     "given": "Find $n$ so that $v=r^n(3\\cos^2\\theta-1)$ satisfies $\\dfrac{\\partial}{\\partial r}\\Big(r^2\\dfrac{\\partial v}{\\partial r}\\Big)+\\dfrac1{\\sin\\theta}\\dfrac{\\partial}{\\partial\\theta}\\Big(\\sin\\theta\\dfrac{\\partial v}{\\partial\\theta}\\Big)=0$.",
     "steps": ["$v_r=nr^{n-1}(3\\cos^2\\theta-1)$, so $\\frac{\\partial}{\\partial r}(r^2v_r)=n(n+1)r^n(3\\cos^2\\theta-1)$.",
               "$v_\\theta=-6r^n\\cos\\theta\\sin\\theta$, so $\\sin\\theta\\,v_\\theta=-6r^n\\cos\\theta\\sin^2\\theta$.",
               "$\\frac{\\partial}{\\partial\\theta}(\\cdot)=-6r^n(2\\sin\\theta\\cos^2\\theta-\\sin^3\\theta)$; divide by $\\sin\\theta$: $-6r^n(3\\cos^2\\theta-1)$.",
               "Sum: $[n(n+1)-6]\\,r^n(3\\cos^2\\theta-1)=0\\Rightarrow n^2+n-6=0$."],
     "answer": "$n=2$ or $n=-3$", "check": "CW answer ($-3$, $2$) agrees; sympy solves to $[-3,2]$. Same pattern as ESA Jan-24 s4 1c (worked in the class 002 pack)."},
    {"id": "W5.3", "topic": "T5", "title": "Verify that the mixed partials are equal", "srcs": ["CW U1 P8"], "stars": 2,
     "given": "If $u=x^2\\tan^{-1}\\dfrac yx-y^2\\tan^{-1}\\dfrac xy$, show that $\\dfrac{\\partial^2u}{\\partial x\\partial y}=\\dfrac{\\partial^2u}{\\partial y\\partial x}=\\dfrac{x^2-y^2}{x^2+y^2}$.",
     "steps": ["$u_x=2x\\tan^{-1}\\frac yx+x^2\\cdot\\frac{-y}{x^2+y^2}-y^2\\cdot\\frac{y}{x^2+y^2}=2x\\tan^{-1}\\frac yx-y$.",
               "$u_{xy}=\\frac{\\partial}{\\partial y}(u_x)=\\frac{2x^2}{x^2+y^2}-1=\\frac{x^2-y^2}{x^2+y^2}$.",
               "Similarly $u_y=x-2y\\tan^{-1}\\frac xy$, and $u_{yx}=1-\\frac{2y^2}{x^2+y^2}=\\frac{x^2-y^2}{x^2+y^2}$."],
     "answer": "$u_{xy}=u_{yx}=\\dfrac{x^2-y^2}{x^2+y^2}$", "check": "sympy: both simplify to $\\frac{x^2-y^2}{x^2+y^2}$."},
]

PYQS = []

NOTES = [
    {"topic": "T1", "text": "Quantities depending on several variables need functions of several variables (area $A(l,b)$, volume $v(r,h)$, "
     "potential $V(x,y,z,t)$, weather, pandemics). $z=f(x,y)$ assigns to each $(x,y)\\in D$ a unique real number; $D$ is the domain, "
     "the set of values the range. The graph is a surface."},
    {"topic": "T2", "text": "$\\lim_{(x,y)\\to(a,b)}f=L$ if every path to $(a,b)$ gives $L$. Polynomial: substitute. $\\frac00$: try paths ($y=0$, "
     "$y=x$, $y=mx$, $y=x^2$); two different values ⇒ no limit. $\\frac{2xy}{3x^2+y^2}$: $0$ on $y=0$, $\\frac12$ on $y=x$."},
    {"topic": "T3", "text": "Continuous at $(a,b)$: $f(a,b)$ defined, limit exists, $\\lim f=f(a,b)$; no hole or break in the surface. "
     "Not continuous ≠ no limit: $\\frac{3x^2y}{x^2+y^2}$ has limit 0 but $f(0,0)$ undefined."},
    {"topic": "T4", "text": "Partial derivative: derivative in one variable, others constant. $z_x=\\lim_{h\\to0}\\frac{f(x+h,y)-f(x,y)}h$; "
     "notation $\\frac{\\partial z}{\\partial x}=z_x=f_x$. Leibniz (product rule), Legendre 1786, Jacobi 1841. All differentiation rules hold."},
    {"topic": "T5", "text": "$z_{xx}$, $z_{yy}$, $z_{xy}=\\frac{\\partial}{\\partial y}(z_x)=\\frac{\\partial^2z}{\\partial y\\partial x}$, $z_{yx}$. "
     "Clairaut: $z_{xy}=z_{yx}$ when the second partials are continuous. Subscripts left to right, $\\partial$ right to left."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "Graph of $z=\\sin x\\cos y$", "stars": 1, "srcs": ["S001·8", "T001a 00:09:07"], "tall": True,
     "howto": "A function of two variables is a surface over the $xy$-plane: above each point $(x,y)$ the height is $f(x,y)$. "
              "$\\sin x\\cos y$ is an egg-box of hills and hollows between $-1$ and $1$; the slide's Gnuplot picture shows the same surface."},
    {"id": "G1.2", "topic": "T1", "title": "Graph of $z=e^{1-x^2-y^2}$", "stars": 1, "srcs": ["S001·8", "T001a 00:09:07"], "tall": True,
     "howto": "A single bell-shaped hill with its top $z=e$ above the origin, falling to 0 in every direction. The green level curves "
              "(drawn on the surface) are circles $x^2+y^2=$ constant."},
    {"id": "G2.1", "topic": "T2", "title": "Paths along which $(x,y)$ can approach $(a,b)$", "stars": 1, "srcs": ["S001·9", "T001a 00:11:52", "T001a 00:12:19"],
     "howto": "In one variable $x$ reaches $a$ only from the left or the right. In the plane, $(x,y)$ can reach $(a,b)$ along a line, a "
              "parabola, an arc of an ellipse, or any other path. The limit exists only if all of them give the same value."},
    {"id": "G2.2", "topic": "T2", "title": "$\\frac{2xy}{3x^2+y^2}$ along the line $y=mx$", "stars": 2, "srcs": ["S001·10", "T001a 00:17:24"], "flags": [ADD],
     "howto": "The value of $\\frac{2xy}{3x^2+y^2}$ on the line $y=mx$ is the constant $\\frac{2m}{3+m^2}$, plotted against the slope $m$. "
              "$m=0$ gives 0, $m=1$ gives $\\frac12$, and the largest value is $\\frac1{\\sqrt3}$ at $m=\\sqrt3$. Because the value changes with "
              "the path, the limit at the origin does not exist."},
    {"id": "G3.1", "topic": "T3", "title": "$z=\\frac{3x^2y}{x^2+y^2}$: the limit at the origin exists", "stars": 1, "srcs": ["S001·12", "T001b 00:02:41"], "tall": True,
     "howto": "The surface folds near the origin but every direction leads to height 0 there (vermilion point). It is missing only "
              "the single point $(0,0)$, where $f$ is undefined: a removable discontinuity."},
    {"id": "G3.2", "topic": "T3", "title": "$z=\\frac{2xy}{3x^2+y^2}$: the limit at the origin does not exist", "stars": 1, "srcs": ["S001·13", "T001b 00:06:13"], "tall": True,
     "howto": "Each ray from the origin keeps a constant height $\\frac{2m}{3+m^2}$, so the surface is a twisted fan of straight lines "
              "meeting at the $z$-axis at different heights (vermilion: the ray $y=x$ at height $\\frac12$; blue: the $x$-axis at height 0). "
              "There is no single value at the origin."},
]

FLOWS = [
    {"id": "F2.1", "topic": "T2", "title": "Finding (or disproving) a limit at a point", "stars": 2, "srcs": ["S001·9", "S001·10", "T001a 00:13:59", "T001a 00:17:42"],
     "layout": "fork", "maxw": "140mm",
     "spec": {"before": [{"kind": "given", "title": "$\\lim_{(x,y)\\to(a,b)}f(x,y)$"},
                         {"kind": "step", "n": 1, "title": "Substitute $(a,b)$", "fx": "$f(a,b)$"}],
              "question": "Is the result $\\frac00$?",
              "no": {"kind": "result", "title": "Limit $=f(a,b)$", "fx": "same along every path"},
              "yes": {"kind": "step", "n": 2, "title": "Try two or more paths", "fx": "$y=0,\\ y=x,\\ y=mx,\\ y=x^2$"},
              "after": [{"kind": "result", "title": "Values differ: no limit", "fx": "depends on $m$ ⇒ does not exist", "sub": "All equal: suspect a limit, prove it (e.g. polar form)"}]},
     "remark": "Agreement along a few paths is only evidence; disagreement is proof.", "trap": "Read the point carefully: slide $(2,1)$ gives $-8$, the lecture's $(2,-1)$ gives $-6$."},
    {"id": "F3.1", "topic": "T3", "title": "Is f continuous at (a, b)?", "stars": 1, "srcs": ["S001·11", "T001a 00:18:46", "T001b 00:03:17"],
     "layout": "ladder", "maxw": "140mm",
     "spec": {"start": {"kind": "given", "title": "$f(x,y)$ and the point $(a,b)$"},
              "rungs": [{"q": "Is $f(a,b)$ undefined?", "yes": {"kind": "result", "title": "Not continuous", "sub": "e.g. $\\frac{3x^2y}{x^2+y^2}$ at $(0,0)$"}},
                        {"q": "Does the limit fail to exist?", "yes": {"kind": "result", "title": "Not continuous", "sub": "e.g. $\\frac{2xy}{3x^2+y^2}$"}},
                        {"q": "Is $\\lim f\\ne f(a,b)$?", "yes": {"kind": "result", "title": "Not continuous", "sub": "a jump at the point"}}],
              "last": {"kind": "check", "title": "Continuous at $(a,b)$", "sub": "$\\lim_{(x,y)\\to(a,b)}f=f(a,b)$"}},
     "remark": "Only the first rung failing with the limit existing is a removable discontinuity: define $f(a,b)$ as the limit."},
    {"id": "F4.1", "topic": "T4", "title": "Computing a partial derivative", "stars": 2, "srcs": ["S001·15", "T001b 00:15:08", "T001b 00:13:57"],
     "layout": "straight", "maxw": "120mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$z=f(x,y,\\dots)$; find $z_x$"},
         {"kind": "step", "n": 1, "title": "Freeze the other variables", "fx": "$y,\\,t,\\,\\dots$ are constants"},
         {"kind": "step", "n": 2, "title": "Terms without $x$ give 0", "fx": "$\\frac{\\partial}{\\partial x}(e^w+\\log p)=0$"},
         {"kind": "step", "n": 3, "title": "Differentiate in $x$ as usual", "fx": "product, quotient, chain rules"},
         {"kind": "result", "title": "$z_x$", "fx": "e.g. $\\frac{\\partial}{\\partial x}(x^3\\sin y)=3x^2\\sin y$"}]}},
    {"id": "F5.1", "topic": "T5", "title": "Reading the order of a mixed partial", "stars": 2, "srcs": ["S001·17", "T001b 00:18:51"],
     "layout": "tree", "maxw": "150mm",
     "spec": {"root": {"kind": "given", "title": "Mixed partial of $z=f(x,y)$"},
              "branches": [{"title": "Subscript notation", "sub": "left → right", "rows": [["$z_{xy}$", "$x$ first, then $y$"], ["$z_{xyxx}$", "$x,\\ y,\\ x,\\ x$"]]},
                           {"title": "$\\partial$ notation", "sub": "right → left", "rows": [["$\\frac{\\partial^2z}{\\partial y\\partial x}$", "$x$ first, then $y$ $=z_{xy}$"], ["$\\frac{\\partial^2z}{\\partial x\\partial y}$", "$y$ first $=z_{yx}$"]]}]},
     "remark": "By Clairaut's theorem the order rarely changes the answer, but the notation is still examined."},
]

COMPARISONS = [
    {"id": "C2.1", "topic": "T2", "title": "One variable and two variables", "srcs": ["S001·9", "S001·11", "T001a 00:09:54", "T001a 00:11:52"],
     "head": ["", "$y=f(x)$", "$z=f(x,y)$"],
     "rows": [["Domain", "Real numbers", "Ordered pairs $(x,y)$"],
              ["Graph", "A curve in the plane", "A surface in space"],
              ["Approach to the point", "From the left or the right", "Along infinitely many paths"],
              ["Limit exists if", "Left and right limits agree", "Every path gives the same value"],
              ["Continuous if", "$\\lim_{x\\to c}f=f(c)$", "$\\lim_{(x,y)\\to(a,b)}f=f(a,b)$"],
              ["Derivative", "$\\frac{dy}{dx}$", "$\\frac{\\partial z}{\\partial x}$, $\\frac{\\partial z}{\\partial y}$ (others constant)"]]},
]

SYMBOLS = [
    {"sym": "$z=f(x,y)$", "name": "Function of two variables", "meaning": "$x,y$ independent, $z$ dependent", "where": "T1"},
    {"sym": "$D$", "name": "Domain", "meaning": "Set of ordered pairs where $f$ is defined", "where": "T1"},
    {"sym": "$L$", "name": "Limit", "meaning": "Common value along every path", "where": "E2.1"},
    {"sym": "$(a,b)$", "name": "Point of approach", "meaning": "Where the limit or continuity is tested", "where": "E2.1, E3.1"},
    {"sym": "$m$", "name": "Slope of a path", "meaning": "Path $y=mx$ in the two-path test", "where": "E2.2, W2.2"},
    {"sym": "$\\partial$", "name": "Partial (“dou”)", "meaning": "Partial derivative sign; not $\\delta$, not $d$", "where": "E4.1–E5.3"},
    {"sym": "$h$", "name": "Increment", "meaning": "Small change in one variable in the definition", "where": "E4.1"},
    {"sym": "$z_x,\\ f_x$", "name": "First partial in $x$", "meaning": "$\\frac{\\partial z}{\\partial x}$ with $y$ constant", "where": "E4.2"},
    {"sym": "$z_{xx},\\ z_{yy}$", "name": "Second partials", "meaning": "$\\frac{\\partial^2z}{\\partial x^2}$, $\\frac{\\partial^2z}{\\partial y^2}$", "where": "E5.1"},
    {"sym": "$z_{xy}$", "name": "Mixed partial", "meaning": "$x$ first, then $y$; $=\\frac{\\partial^2z}{\\partial y\\partial x}$", "where": "E5.2, E5.3"},
]

KEYWORDS = [
    {"term": "Multivariable function", "meaning": "A quantity depending on two or more variables.", "topic": "T1"},
    {"term": "Bivariate function", "meaning": "$z=f(x,y)$, two independent variables.", "topic": "T1"},
    {"term": "Domain", "meaning": "The set $D$ of pairs $(x,y)$.", "topic": "T1"},
    {"term": "Range", "meaning": "The set of values $f$ takes on.", "topic": "T1"},
    {"term": "Surface", "meaning": "Graph of $z=f(x,y)$.", "topic": "T1"},
    {"term": "Limit", "meaning": "Same value $L$ along every path to $(a,b)$.", "topic": "T2"},
    {"term": "Path", "meaning": "A curve (line, parabola, ellipse) along which $(x,y)\\to(a,b)$.", "topic": "T2"},
    {"term": "Two-path test", "meaning": "Two different path values ⇒ no limit.", "topic": "T2"},
    {"term": "Indeterminate form", "meaning": "$\\frac00$ on substitution; try paths.", "topic": "T2"},
    {"term": "Continuity", "meaning": "$\\lim f=f(a,b)$; no hole or break.", "topic": "T3"},
    {"term": "Removable discontinuity", "meaning": "Limit exists, $f(a,b)$ undefined or different.", "topic": "T3"},
    {"term": "Partial derivative", "meaning": "Derivative in one variable, others constant.", "topic": "T4"},
    {"term": "Legendre (1786), Jacobi (1841)", "meaning": "Created and reintroduced the symbol $\\partial$.", "topic": "T4"},
    {"term": "Leibniz", "meaning": "First used partial differentiation (product rule).", "topic": "T4"},
    {"term": "First principles", "meaning": "$z_x=\\lim_{h\\to0}\\frac{f(x+h,y)-f(x,y)}h$.", "topic": "T4"},
    {"term": "Second-order partial", "meaning": "$z_{xx}$, $z_{yy}$.", "topic": "T5"},
    {"term": "Mixed partial", "meaning": "$z_{xy}$, $z_{yx}$.", "topic": "T5"},
    {"term": "Clairaut's theorem", "meaning": "$z_{xy}=z_{yx}$ if the second partials are continuous.", "topic": "T5"},
    {"term": "Order of subscripts", "meaning": "Left to right = order of differentiation.", "topic": "T5"},
]

RAPID = [
    {"q": "Define a function of two variables.", "a": "A rule assigning to each $(x,y)\\in D$ a unique real number $f(x,y)$."},
    {"q": "Graph of $z=f(x,y)$?", "a": "A surface in three dimensions."},
    {"q": "When does $\\lim_{(x,y)\\to(a,b)}f$ exist?", "a": "When every path to $(a,b)$ gives the same value."},
    {"q": "How do you show a limit does not exist?", "a": "Find two paths giving different values."},
    {"q": "$\\lim_{(x,y)\\to(2,1)}(x^2-2xy+3y^2-4x+3y-6)$?", "a": "$-8$ (and $-6$ at $(2,-1)$)."},
    {"q": "$\\frac{2xy}{3x^2+y^2}$ along $y=mx$?", "a": "$\\frac{2m}{3+m^2}$: no limit at the origin."},
    {"q": "Three conditions for continuity?", "a": "$f(a,b)$ defined, limit exists, limit $=f(a,b)$."},
    {"q": "Is $\\frac{3x^2y}{x^2+y^2}$ continuous at $(0,0)$?", "a": "No ($f(0,0)$ undefined), though the limit is 0."},
    {"q": "Not continuous ⇒ no limit?", "a": "No."},
    {"q": "Definition of $\\frac{\\partial z}{\\partial x}$?", "a": "$\\lim_{h\\to0}\\frac{f(x+h,y)-f(x,y)}h$, $y$ constant."},
    {"q": "Who created and who reintroduced $\\partial$?", "a": "Legendre (1786); Jacobi (1841)."},
    {"q": "Earliest use of partial differentiation?", "a": "Leibniz's product rule."},
    {"q": "$\\frac{\\partial^2z}{\\partial y\\partial x}$ in subscripts?", "a": "$z_{xy}$ ($x$ first)."},
    {"q": "Clairaut's theorem?", "a": "$f_{xy}=f_{yx}$ if the second partials are continuous."},
    {"q": "$f=e^{x^2+y^2+z^2}$: $f_{xx}$ at $(-1,1,-1)$?", "a": "$6e^3$."},
    {"q": "$n$ for $v=r^n(3\\cos^2\\theta-1)$?", "a": "$n=2$ or $-3$."},
    {"q": "$u=x^2\\tan^{-1}\\frac yx-y^2\\tan^{-1}\\frac xy$: $u_{xy}$?", "a": "$\\frac{x^2-y^2}{x^2+y^2}$."},
]

MNEMONICS = [
    "<i>“Subscripts walk forward, partials walk back.”</i> $z_{xy}$: $x$ then $y$; $\\frac{\\partial^2z}{\\partial y\\,\\partial x}$: read from the right, $x$ then $y$.",
]

TOP_FACTS = [
    "$z=f(x,y)$: each $(x,y)\\in D$ gives one real number; the graph is a surface.",
    "Limit: the same value along every path; two paths with different values ⇒ no limit.",
    "$\\frac{2xy}{3x^2+y^2}$: $0$ along $y=0$, $\\frac12$ along $y=x$ ⇒ no limit at the origin.",
    "Continuity: $f(a,b)$ defined, limit exists, $\\lim f=f(a,b)$. Not continuous does not mean no limit.",
    "$z_x=\\lim_{h\\to0}\\frac{f(x+h,y)-f(x,y)}h$: differentiate in $x$, everything else constant.",
    "Notation $\\frac{\\partial z}{\\partial x}=z_x=f_x$; $\\partial$ by Legendre (1786), reintroduced by Jacobi (1841).",
    "Clairaut: $f_{xy}=f_{yx}$ when the second partials are continuous.",
    "$\\frac{\\partial^2z}{\\partial y\\partial x}=z_{xy}$: subscripts left to right, $\\partial$ right to left.",
]
TOP_FORMULAS = ["E4.1", "E4.2", "E5.2", "E5.3", "E2.2", "E3.1"]
