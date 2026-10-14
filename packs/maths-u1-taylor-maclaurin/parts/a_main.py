"""Class 007: Taylor's and Maclaurin's expansion."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "Why Taylor's and Maclaurin's series?",
     "overview": "A complicated function is hard to evaluate, integrate or take limits of; a polynomial is easy. Taylor's series "
                 "writes a function as a polynomial (of infinitely many terms) around a point, and a few terms are usually "
                 "enough. This is how values such as $e^{\\tan\\sqrt[3]3}$, integrals such as $\\int_0^1\\sin(x^2)\\,dx$ and limits "
                 "such as $\\lim\\frac{\\sin x-x}{x^3}$ are handled, and it has many applications in physics and engineering."},
    {"id": "T2", "title": "Taylor's and Maclaurin's series in one variable",
     "overview": "If $f$ has continuous derivatives, $f(x)=f(a)+(x-a)f'(a)+\\frac{(x-a)^2}{2!}f''(a)+\\dots$ about $x=a$; about the "
                 "origin this is Maclaurin's series. The first two terms are the tangent line. The standard series for "
                 "$(1+x)^n$, $e^x$, $\\log(1+x)$, $\\sin x$, $\\cos x$, $\\sinh x$, $\\cosh x$, $\\tan^{-1}x$, $\\sin^{-1}x$ and "
                 "$\\cos^{-1}x$ are on slide 007·5. This one-variable part is a self-learning component of the syllabus."},
    {"id": "T3", "title": "Taylor's expansion of a function of two variables",
     "overview": "About a point $(a,b)$: $f(x,y)=f(a,b)+\\frac1{1!}\\{(x-a)f_x+(y-b)f_y\\}+\\frac1{2!}\\{(x-a)^2f_{xx}+2(x-a)(y-b)f_{xy}+(y-b)^2f_{yy}\\}+\\dots$, "
                 "with every derivative evaluated at $(a,b)$. The coefficients 1, 2, 1 (and 1, 3, 3, 1 at third order) are "
                 "binomial, because the mixed partials are equal. ESA questions give the point and the degree."},
    {"id": "T4", "title": "Maclaurin's expansion of a function of two variables",
     "overview": "Put $(a,b)=(0,0)$: $f(x,y)=f(0,0)+\\frac1{1!}\\{xf_x+yf_y\\}+\\frac1{2!}\\{x^2f_{xx}+2xyf_{xy}+y^2f_{yy}\\}+\\dots$ "
                 "at the origin. $f_x$ goes with $x$, $f_y$ with $y$, $f_{xx}$ with $x^2$, $f_{xy}$ with $2xy$, $f_{yy}$ with $y^2$. "
                 "When $f$ is a function of $x+2y$ or $x-y$, the one-variable series gives the answer as a check."},
]

DEFS = [
    {"topic": "T2", "term": "Taylor's series (one variable)", "text": "If a function $f(x)$ has continuous derivatives of order $(n+1)$, then "
     "this function can be expressed as a polynomial at a point $x=a$ in the form $f(x)=f(a)+(x-a)f'(a)+\\frac{(x-a)^2}{2!}f''(a)+\\dots+\\frac{(x-a)^n}{n!}f^{(n)}(a)+\\dots$",
     "srcs": ["S007·4", "T007 00:04:19"]},
    {"topic": "T2", "term": "Maclaurin's series (one variable)", "text": "If the function is expanded about the origin we get Maclaurin's series: "
     "$f(x)=f(0)+xf'(0)+\\frac{x^2}{2!}f''(0)+\\dots+\\frac{x^n}{n!}f^{(n)}(0)+\\dots$; it is a particular case of Taylor's series.",
     "srcs": ["S007·4", "T007 00:06:17"]},
    {"topic": "T3", "term": "Taylor polynomial of degree n", "text": "The terms of Taylor's series up to total degree $n$ in $(x-a)$ and $(y-b)$; "
     "“expand up to second (third) degree terms” means stop there. Degree 1 is the tangent plane.", "srcs": ["S007·11", "T007 00:20:13"], "flags": [ADD]},
    {"topic": "T4", "term": "Maclaurin's series (two variables)", "text": "Taylor's series of $f(x,y)$ about the origin $(0,0)$.",
     "srcs": ["S007·10", "T007 00:19:01"]},
]

STATEMENTS = [
    {"topic": "T3", "text": "Taylor's series of $f(x,y)$ about $(a,b)$ is given by $f(x,y)=f(a,b)+\\frac1{1!}\\{(x-a)f_x(a,b)+(y-b)f_y(a,b)\\}"
     "+\\frac1{2!}\\{(x-a)^2f_{xx}(a,b)+2(x-a)(y-b)f_{xy}(a,b)+(y-b)^2f_{yy}(a,b)\\}+\\dots$",
     "srcs": ["S007·9", "T007 00:18:45"]},
    {"topic": "T4", "text": "Maclaurin's series for a function of two variables is given by $f(x,y)=f(0,0)+\\frac1{1!}\\{xf_x(0,0)+yf_y(0,0)\\}"
     "+\\frac1{2!}\\{x^2f_{xx}(0,0)+2xyf_{xy}(0,0)+y^2f_{yy}(0,0)\\}+\\dots$", "srcs": ["S007·10"]},
]

FORMULAS = [
    {"id": "E2.1", "topic": "T2", "title": "Taylor's series, one variable", "tex": r"f(x)=f(a)+(x-a)f'(a)+\frac{(x-a)^2}{2!}f''(a)+\dots+\frac{(x-a)^n}{n!}f^{(n)}(a)+\dots",
     "gives": "A polynomial form of $f$ near $x=a$.", "when": "$f$ has derivatives of every order at $a$ and the series converges to $f$.",
     "note": "Slide 007·4 writes $f^n(a)$ for the $n$-th derivative $f^{(n)}(a)$.", "stars": 1, "srcs": ["S007·4", "T007 00:04:56"]},
    {"id": "E2.2", "topic": "T2", "title": "Maclaurin's series, one variable", "tex": r"f(x)=f(0)+xf'(0)+\frac{x^2}{2!}f''(0)+\dots+\frac{x^n}{n!}f^{(n)}(0)+\dots",
     "gives": "Taylor's series about the origin.", "when": "$f$ and all its derivatives finite at $0$ (not, e.g., $1/x$ or $\\log x$).",
     "note": "“About a point $x=a$: Taylor; about the origin: Maclaurin.”", "stars": 1, "srcs": ["S007·4", "T007 00:11:17"]},
    {"id": "E2.3", "topic": "T2", "title": "Exponential and logarithm", "tex": r"\begin{gathered}e^x=1+\frac{x}{1!}+\frac{x^2}{2!}+\frac{x^3}{3!}+\dots\quad(x\in\mathbb R)\\ \log(1+x)=x-\frac{x^2}{2}+\frac{x^3}{3}-\frac{x^4}{4}+\dots\quad(|x|<1)\end{gathered}",
     "gives": "Two standard series.", "when": "As stated.", "note": "$e^{-x}$: replace $x$ by $-x$.", "stars": 2, "srcs": ["S007·5", "T007 00:07:19", "T007 00:08:39"]},
    {"id": "E2.4", "topic": "T2", "title": "Binomial and geometric series", "tex": r"\begin{gathered}(1+x)^n=1+nx+\frac{n(n-1)}{2!}x^2+\frac{n(n-1)(n-2)}{3!}x^3+\dots\\ \frac1{1-x}=1+x+x^2+x^3+\dots\qquad(|x|<1)\end{gathered}",
     "gives": "Series for powers.", "when": "$|x|<1$ (any $n$; for a positive integer $n$ the series stops).", "note": "The geometric series is said in the lecture, not on the slide.",
     "stars": 1, "srcs": ["S007·5", "T007 00:07:37"]},
    {"id": "E2.5", "topic": "T2", "title": "Trigonometric and hyperbolic", "tex": r"\begin{gathered}\sin x=x-\frac{x^3}{3!}+\frac{x^5}{5!}-\dots,\qquad \cos x=1-\frac{x^2}{2!}+\frac{x^4}{4!}-\dots\\ \sinh x=x+\frac{x^3}{3!}+\frac{x^5}{5!}+\dots,\qquad \cosh x=1+\frac{x^2}{2!}+\frac{x^4}{4!}+\dots\end{gathered}",
     "gives": "Odd and even standard series.", "when": "All real $x$.", "note": "Slide 007·5 prints $\\cos x=1-\\frac{x^2}2+\\dots$ ($2!=2$).",
     "stars": 2, "srcs": ["S007·5"]},
    {"id": "E2.6", "topic": "T2", "title": "Inverse trigonometric", "tex": r"\begin{gathered}\tan^{-1}x=x-\frac{x^3}{3}+\frac{x^5}{5}-\dots\\ \sin^{-1}x=x+\frac12\frac{x^3}{3}+\frac{1\cdot3}{2\cdot4}\frac{x^5}{5}+\dots,\qquad \cos^{-1}x=\frac\pi2-\sin^{-1}x\end{gathered}",
     "gives": "Series for the inverse functions.", "when": "$-1\\le x\\le1$.",
     "note": "Slide 007·5 prints $\\tan^{-1}x=x-\\frac{x^3}{3!}+\\frac{x^5}{5!}-\\dots$; the denominators are $3$ and $5$, not $3!$ and $5!$.", "stars": 1, "srcs": ["S007·5"]},
    {"id": "E3.1", "topic": "T3", "title": "Taylor's series, two variables (to second order)", "tex": r"f(x,y)=f+\frac1{1!}\{hf_x+kf_y\}+\frac1{2!}\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\}+\dots,\quad h=x-a,\ k=y-b",
     "gives": "A polynomial form of $f$ near $(a,b)$.", "when": "All derivatives evaluated at $(a,b)$, all finite there.",
     "note": "$h$, $k$ are shorthand added for clarity; the slide writes $(x-a)$, $(y-b)$.", "stars": 3, "srcs": ["S007·9", "T007 00:18:07", "T007 00:18:45"]},
    {"id": "E3.2", "topic": "T3", "title": "Third-order term", "tex": r"+\frac1{3!}\{h^3f_{xxx}+3h^2kf_{xxy}+3hk^2f_{xyy}+k^3f_{yyy}\}",
     "gives": "The terms needed for “up to third degree”.", "when": "Add to E3.1 (or E4.1 with $h=x$, $k=y$).",
     "note": "Not on the slides; asked in four of six ESA Taylor questions.", "stars": 3, "srcs": ["ESA Dec-23 1b", "ESA Jan-24 s1 1b", "ESA Jan-24 s2 1b", "ESA Jun-24 1c"], "flags": [ADD]},
    {"id": "E3.3", "topic": "T3", "title": "Operator form", "tex": r"f(a+h,b+k)=\sum_{n=0}^{\infty}\frac1{n!}\Big(h\frac{\partial}{\partial x}+k\frac{\partial}{\partial y}\Big)^{n}f(a,b)",
     "gives": "Why the coefficients are binomial: 1, 2, 1 and 1, 3, 3, 1.", "when": "Mixed partials equal ($f_{xy}=f_{yx}$).",
     "note": "Expand $(h\\partial_x+k\\partial_y)^n$ like $(h+k)^n$.", "stars": 2, "srcs": ["T007 00:18:26"], "flags": [ADD]},
    {"id": "E4.1", "topic": "T4", "title": "Maclaurin's series, two variables", "tex": r"f(x,y)=f(0,0)+\frac1{1!}\{xf_x+yf_y\}+\frac1{2!}\{x^2f_{xx}+2xyf_{xy}+y^2f_{yy}\}+\dots",
     "gives": "A polynomial form of $f$ near the origin.", "when": "Derivatives at $(0,0)$, all finite there.",
     "note": "Same as E3.1 with $a=b=0$; add E3.2 with $h=x$, $k=y$ for third degree.", "stars": 3, "srcs": ["S007·10", "T007 00:19:38"]},
]

POINTS = [
    {"topic": "T1", "text": "Once a function is a polynomial, you can differentiate, integrate, find limits and study how it changes.", "stars": 1, "srcs": ["T007 00:06:50"]},
    {"topic": "T1", "text": "Applications (one variable): polynomials for complicated functions, definite integrals with no closed form, asymptotic "
     "behaviour, growth of functions, differential equations, the Lorentz factor, $E=mc^2$ at low speed, $\\sin\\theta\\approx\\theta$ "
     "for a pendulum, power-flow analysis, generating functions.", "stars": 1, "srcs": ["S007·6", "S007·7", "T007 00:11:31", "T007 00:13:44"]},
    {"topic": "T1", "text": "Applications (two variables): optimization (a linear or quadratic model), accurate distance measurement with the sine law, "
     "variance of complicated configurations, visualizing complicated functions.", "stars": 1, "srcs": ["S007·12", "T007 00:21:22"]},
    {"topic": "T1", "text": "A few terms are often enough: four terms of the sine series already follow $\\sin x$ closely near 0, and ten terms overlap it (Figure G1.1).", "stars": 1, "srcs": ["S007·8", "T007 00:15:24", "T007 00:16:10"]},
    {"topic": "T1", "text": "Taylor's theorem is the basis of L'Hôpital's rule and the mean value theorems of Rolle, Lagrange and Cauchy; the series is a consequence of the theorem.", "stars": 1, "srcs": ["T007 00:03:33"], "flags": [TONLY]},
    {"topic": "T2", "text": "Keep only the first two terms of Taylor's series and you get $f(x)\\approx f(a)+(x-a)f'(a)$: the tangent line, i.e. the derivative as a slope (Figure G2.1).", "stars": 1, "srcs": ["T007 00:05:26", "T007 00:05:43"]},
    {"topic": "T2", "text": "To get a standard series, differentiate repeatedly and put $x=0$: every derivative of $e^x$ is $e^x$, which is 1 at the origin.", "stars": 1, "srcs": ["T007 00:09:10", "T007 00:09:44"]},
    {"topic": "T2", "text": "Substitute into a known series rather than differentiating: $\\sin(x^2)=x^2-\\frac{x^6}{3!}+\\frac{x^{10}}{5!}-\\dots$.", "stars": 2, "srcs": ["T007 00:11:51"]},
    {"topic": "T2", "text": "No Maclaurin series exists if $f$ or a derivative is infinite at 0: $1/x$, $\\log x$, $\\sqrt x$.", "stars": 1, "srcs": ["T007 00:10:18"]},
    {"topic": "T3", "text": "Lay out a table: $f$, $f_x$, $f_y$, $f_{xx}$, $f_{xy}$, $f_{yy}$ (and third order if asked), each in general and then its value at $(a,b)$. Then substitute into E3.1.", "stars": 3, "srcs": ["CW U1 P24", "ESA Jul-23 1b"], "flags": [ADD]},
    {"topic": "T3", "text": "There are four second-order partials, but $f_{xy}=f_{yx}$, so they combine into $2(x-a)(y-b)f_{xy}$.", "stars": 2, "srcs": ["T007 00:18:26"]},
    {"topic": "T3", "text": "“In powers of $(x-1)$ and $(y-\\frac\\pi4)$” means about the point $(1,\\frac\\pi4)$.", "stars": 2, "srcs": ["ESA May-24 1b", "CW U1 P27"], "flags": [ADD]},
    {"topic": "T3", "text": "Taylor's series gives approximate values: $\\tan^{-1}\\frac{0.9}{1.1}$ from the expansion of $\\tan^{-1}\\frac yx$ about $(1,1)$ with $h=0.1$, $k=-0.1$.", "stars": 2, "srcs": ["CW U1 P26"]},
    {"topic": "T3", "text": "The first-degree Taylor polynomial is the tangent plane; the second degree hugs the surface much better (slide 007·11, Figures G3.1–G3.2).", "stars": 1, "srcs": ["S007·11", "T007 00:20:51"]},
    {"topic": "T4", "text": "Memory aid from the lecture: $f_x$ goes with $x$, $f_y$ with $y$, $f_{xx}$ with $x^2$, $f_{xy}$ with $2xy$, $f_{yy}$ with $y^2$.", "stars": 2, "srcs": ["T007 00:19:38"]},
    {"topic": "T4", "text": "Shortcut and check: if $f$ depends on one combination, use the one-variable series: $\\sin(x+2y)=(x+2y)-\\frac{(x+2y)^3}{6}+\\dots$, $\\log(1+x-y)=(x-y)-\\frac{(x-y)^2}2+\\frac{(x-y)^3}3-\\dots$", "stars": 3, "srcs": ["CW U1 P25", "ESA Jun-24 1c", "ESA Jan-24 s1 1b"], "flags": [ADD]},
    {"topic": "T4", "text": "None of $f$, $f_x$, $f_y$, $f_{xx}$, $f_{xy}$, $f_{yy}$ may be infinite at $(0,0)$.", "stars": 1, "srcs": ["T007 00:19:26"]},
]

WHY = [
    {"topic": "T3", "q": "Why are the second-order coefficients 1, 2, 1?",
     "a": "Put $g(t)=f(a+th,b+tk)$ and use the one-variable Maclaurin series of $g$ at $t=0$. By the chain rule $g'(0)=hf_x+kf_y$ and "
          "$g''(0)=h^2f_{xx}+2hkf_{xy}+k^2f_{yy}$ (the two equal mixed partials give the 2). Put $t=1$.", "srcs": ["T007 00:18:26"], "flags": [ADD]},
    {"topic": "T2", "q": "When is Maclaurin's series valid?",
     "a": "$f$ must have derivatives of every order at 0 (so none is infinite there), and the series must converge to $f$. "
          "$e^x$, $\\sin x$, $\\cos x$ converge for every $x$; $\\log(1+x)$ and $(1+x)^n$ only for $|x|<1$.", "srcs": ["T007 00:10:01", "S007·5"], "flags": [ADD]},
    {"topic": "T1", "q": "Why does a calculator need series at all?",
     "a": "It can only add and multiply. A polynomial needs nothing else, so a function such as $e^{\\tan x}$ is evaluated through polynomial approximations.", "srcs": ["T007 00:01:02", "T007 00:01:35"]},
]

TRAPS = [
    {"topic": "T2", "text": "The lecture says $1+2+2^2+\\dots$ “gives $-1$”. It diverges: $\\frac1{1-x}=1+x+x^2+\\dots$ only for $|x|<1$; $\\frac1{1-2}=-1$ is outside that range.", "srcs": ["T007 00:07:52"], "flags": [ADD]},
    {"topic": "T1", "text": "Slide 007·3's limit $\\lim\\frac{\\sin x-x}{x^4}$ does not exist; with $x^3$ the answer is $-\\frac16$ (W1.2).", "srcs": ["S007·3"], "flags": [ADD]},
    {"topic": "T2", "text": "$\\tan^{-1}x=x-\\frac{x^3}3+\\frac{x^5}5-\\dots$ has plain denominators; slide 007·5 shows $3!$ and $5!$, which belong to $\\sin x$.", "srcs": ["S007·5"], "flags": [ADD]},
    {"topic": "T3", "text": "Evaluate every derivative at $(a,b)$ before substituting; never leave $f_{xx}(x,y)$ in the answer.", "srcs": ["S007·9"], "flags": [ADD]},
    {"topic": "T3", "text": "Don't forget $\\frac1{2!}$ and $\\frac1{3!}$, and the middle coefficients $2$ and $3$: the third-order bracket is $h^3f_{xxx}+3h^2kf_{xxy}+3hk^2f_{xyy}+k^3f_{yyy}$.", "srcs": ["ESA Dec-23 1b"], "flags": [ADD]},
    {"topic": "T3", "text": "Slide 007·11's polynomials ($1+x+y$, $1+x+xy+\\frac{y^2}2$) are about $(1,0)$, not the origin; about the origin they are $1+x$ and $1+x+xy$.", "srcs": ["S007·11", "T007 00:20:32"], "flags": [ADD]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "A definite integral with no closed form", "srcs": ["T007 00:11:51", "T007 00:12:20"], "stars": 1,
     "given": "Evaluate $\\int_0^1\\sin(x^2)\\,dx$.",
     "steps": ["$\\sin(x^2)=x^2-\\frac{x^6}{3!}+\\frac{x^{10}}{5!}-\\dots$ (replace $x$ by $x^2$ in the sine series).",
               "Integrate term by term: $\\frac{x^3}{3}-\\frac{x^7}{7\\cdot3!}+\\frac{x^{11}}{11\\cdot5!}-\\dots$", "At the limits: $\\frac13-\\frac1{42}+\\frac1{1320}-\\dots$"],
     "answer": "$\\approx0.3103$", "check": "sympy: $\\int_0^1\\sin(x^2)\\,dx=0.310268$; three terms give $0.310281$."},
    {"id": "W1.2", "topic": "T1", "title": "A limit by series (slide 007·3, corrected)", "srcs": ["S007·3"], "stars": 1, "flags": [ADD],
     "given": "Find $\\lim_{x\\to0}\\dfrac{\\sin x-x}{x^3}$.",
     "steps": ["$\\sin x-x=-\\frac{x^3}{3!}+\\frac{x^5}{5!}-\\dots$", "Divide by $x^3$: $-\\frac16+\\frac{x^2}{120}-\\dots\\to-\\frac16$."],
     "answer": "$-\\dfrac16$", "check": "sympy agrees. With $x^4$ (as printed on the slide) the quotient behaves like $-\\frac1{6x}$ and has no limit."},
    {"id": "W2.1", "topic": "T2", "title": "Maclaurin's series of $e^x$ from the definition", "srcs": ["T007 00:09:10", "T007 00:09:44"], "stars": 1,
     "given": "$f(x)=e^x$.",
     "steps": ["$f=f'=f''=\\dots=e^x$, so every value at 0 is 1.", "Substitute into E2.2: $1+x+\\frac{x^2}{2!}+\\frac{x^3}{3!}+\\dots$"],
     "answer": "$e^x=1+\\dfrac{x}{1!}+\\dfrac{x^2}{2!}+\\dfrac{x^3}{3!}+\\dots$", "check": "Replacing $x$ by $-x$ gives $e^{-x}=1-x+\\frac{x^2}{2!}-\\dots$"},
    {"id": "W3.1", "topic": "T3", "title": "sin x sin y about (π/4, π/4), second order", "srcs": ["ESA Jul-23 1b", "CW U1 P24"], "stars": 3,
     "given": "Expand $f(x,y)=\\sin x\\sin y$ in Taylor's series up to second-order terms about $\\big(\\frac\\pi4,\\frac\\pi4\\big)$. Let $h=x-\\frac\\pi4$, $k=y-\\frac\\pi4$.",
     "steps": ["$f=\\sin x\\sin y=\\tfrac12$; $f_x=\\cos x\\sin y=\\tfrac12$; $f_y=\\sin x\\cos y=\\tfrac12$.",
               "$f_{xx}=-\\sin x\\sin y=-\\tfrac12$; $f_{xy}=\\cos x\\cos y=\\tfrac12$; $f_{yy}=-\\sin x\\sin y=-\\tfrac12$.",
               "E3.1: $\\tfrac12+\\tfrac12(h+k)+\\tfrac1{2}\\big\\{-\\tfrac12h^2+2\\cdot\\tfrac12hk-\\tfrac12k^2\\big\\}$."],
     "answer": "$\\sin x\\sin y\\approx\\tfrac12+\\tfrac12(h+k)-\\tfrac14\\big(h^2-2hk+k^2\\big)$", "check": "CW answer agrees; sympy series agrees."},
    {"id": "W3.2", "topic": "T3", "title": "sin x sin y about (π/4, π/4), third degree", "srcs": ["ESA Dec-23 1b"], "stars": 3,
     "given": "Expand $\\sin x\\sin y$ up to third-degree terms about $\\big(\\frac\\pi4,\\frac\\pi4\\big)$.",
     "steps": ["Second order as in W3.1.", "$f_{xxx}=-\\cos x\\sin y=-\\tfrac12$, $f_{xxy}=-\\sin x\\cos y=-\\tfrac12$, $f_{xyy}=-\\tfrac12$, $f_{yyy}=-\\tfrac12$.",
               "E3.2: $\\tfrac1{6}\\cdot\\big(-\\tfrac12\\big)\\{h^3+3h^2k+3hk^2+k^3\\}=-\\tfrac1{12}(h+k)^3$."],
     "answer": "$\\tfrac12+\\tfrac12(h+k)-\\tfrac14(h-k)^2-\\tfrac1{12}(h+k)^3$", "check": "sympy series to third order agrees term by term."},
    {"id": "W3.3", "topic": "T3", "title": "$e^x\\cos y$ about $(1,\\frac\\pi4)$", "srcs": ["ESA May-24 1b"], "stars": 3,
     "given": "Expand $e^x\\cos y$ in powers of $(x-1)$ and $\\big(y-\\frac\\pi4\\big)$ up to second-degree terms. Let $h=x-1$, $k=y-\\frac\\pi4$.",
     "steps": ["At $(1,\\frac\\pi4)$: $f=f_x=f_{xx}=\\frac{e}{\\sqrt2}$ ($e^x\\cos y$); $f_y=f_{xy}=-\\frac e{\\sqrt2}$ ($-e^x\\sin y$); $f_{yy}=-\\frac e{\\sqrt2}$ ($-e^x\\cos y$).",
               "E3.1: $\\frac e{\\sqrt2}\\big[1+h-k+\\tfrac12(h^2-2hk-k^2)\\big]$."],
     "answer": "$e^x\\cos y\\approx\\dfrac e{\\sqrt2}\\Big[1+(x-1)-\\big(y-\\tfrac\\pi4\\big)+\\tfrac12\\Big\\{(x-1)^2-2(x-1)\\big(y-\\tfrac\\pi4\\big)-\\big(y-\\tfrac\\pi4\\big)^2\\Big\\}\\Big]$",
     "check": "sympy series agrees."},
    {"id": "W3.4", "topic": "T3", "title": "√(1+x+y²) in powers of (x−1) and y", "srcs": ["CW U1 P27"], "stars": 2,
     "given": "Expand $\\sqrt{1+x+y^2}$ about $(1,0)$ up to second degree. Let $h=x-1$, $k=y$.",
     "steps": ["$f=\\sqrt2$; $f_x=\\frac1{2\\sqrt{1+x+y^2}}=\\frac{\\sqrt2}4$; $f_y=\\frac{y}{\\sqrt{\\dots}}=0$.",
               "$f_{xx}=-\\frac1{4(1+x+y^2)^{3/2}}=-\\frac{\\sqrt2}{16}$; $f_{xy}=0$; $f_{yy}=\\frac{1+x}{(1+x+y^2)^{3/2}}=\\frac{\\sqrt2}2$.",
               "E3.1: $\\sqrt2+\\frac{\\sqrt2}4h+\\frac12\\big(-\\frac{\\sqrt2}{16}h^2+\\frac{\\sqrt2}2k^2\\big)$."],
     "answer": "$\\sqrt2\\Big[1+\\dfrac{x-1}4-\\dfrac{(x-1)^2}{32}+\\dfrac{y^2}4\\Big]$", "check": "CW answer agrees; sympy agrees."},
    {"id": "W3.5", "topic": "T3", "title": "xy² + y cos(x − y) about (1, 1)", "srcs": ["CW U1 P28"], "stars": 2,
     "given": "Expand up to second order about $(1,1)$. Let $h=x-1$, $k=y-1$.",
     "steps": ["$f=2$, $f_x=y^2-y\\sin(x-y)=1$, $f_y=2xy+\\cos(x-y)+y\\sin(x-y)=3$.",
               "$f_{xx}=-y\\cos(x-y)=-1$, $f_{xy}=2y-\\sin(x-y)+y\\cos(x-y)=3$, $f_{yy}=2x+2\\sin(x-y)-y\\cos(x-y)=1$.",
               "E3.1: $2+(h+3k)+\\tfrac12(-h^2+6hk+k^2)$."],
     "answer": "$2+[(x-1)+3(y-1)]+\\tfrac12[-(x-1)^2+6(x-1)(y-1)+(y-1)^2]$", "check": "CW answer agrees; sympy agrees."},
    {"id": "W3.6", "topic": "T3", "title": "Approximate tan⁻¹(0.9/1.1)", "srcs": ["CW U1 P26"], "stars": 2,
     "given": "Using $f(x,y)=\\tan^{-1}\\frac yx$ about $(1,1)$, compute $\\tan^{-1}\\frac{0.9}{1.1}$.",
     "steps": ["At $(1,1)$: $f=\\frac\\pi4$, $f_x=\\frac{-y}{x^2+y^2}=-\\frac12$, $f_y=\\frac{x}{x^2+y^2}=\\frac12$, $f_{xx}=\\frac12$, $f_{xy}=0$, $f_{yy}=-\\frac12$.",
               "$\\tan^{-1}\\frac yx\\approx\\frac\\pi4-\\frac12h+\\frac12k+\\frac14h^2-\\frac14k^2$.",
               "$h=0.1$, $k=-0.1$: $0.7854-0.05-0.05+0.0025-0.0025$."],
     "answer": "$\\tan^{-1}\\dfrac{0.9}{1.1}\\approx0.6854$", "check": "Exact: $0.6857$. The CW sheet prints $0.6904$, an arithmetic slip."},
    {"id": "W3.7", "topic": "T3", "title": "The slide's $xe^y+1$ polynomials", "srcs": ["S007·11", "T007 00:20:13"], "stars": 1, "flags": [ADD],
     "given": "Find the first- and second-degree Taylor polynomials of $f=xe^y+1$ about $(1,0)$.",
     "steps": ["$f=2$, $f_x=e^y=1$, $f_y=xe^y=1$; $f_{xx}=0$, $f_{xy}=e^y=1$, $f_{yy}=xe^y=1$.",
               "First degree: $2+(x-1)+y=1+x+y$.", "Second degree: add $\\tfrac12\\{2(x-1)y+y^2\\}$, giving $1+x+xy+\\frac{y^2}2$."],
     "answer": "$1+x+y$ and $1+x+xy+\\dfrac{y^2}{2}$", "check": "These are slide 007·11's polynomials, so the slide expands about $(1,0)$."},
    {"id": "W4.1", "topic": "T4", "title": "log(1 + x − y) about the origin", "srcs": ["ESA Jan-24 s1 1b"], "stars": 3,
     "given": "Expand $\\log(1+x-y)$ about the origin up to third-degree terms.",
     "steps": ["At $(0,0)$: $f=0$; $f_x=\\frac1{1+x-y}=1$, $f_y=-1$.", "$f_{xx}=-1$, $f_{xy}=1$, $f_{yy}=-1$.", "$f_{xxx}=2$, $f_{xxy}=-2$, $f_{xyy}=2$, $f_{yyy}=-2$.",
               "E4.1 + E3.2: $(x-y)+\\frac12(-x^2+2xy-y^2)+\\frac16(2x^3-6x^2y+6xy^2-2y^3)$."],
     "answer": "$(x-y)-\\dfrac{(x-y)^2}{2}+\\dfrac{(x-y)^3}{3}$", "check": "The same as $\\log(1+t)$ with $t=x-y$; sympy agrees."},
    {"id": "W4.2", "topic": "T4", "title": "$e^{ax}\\sin by$ about the origin", "srcs": ["ESA Jan-24 s2 1b"], "stars": 3,
     "given": "Expand $e^{ax}\\sin by$ about the origin up to third-degree terms.",
     "steps": ["At $(0,0)$: $f=0$, $f_x=ae^{ax}\\sin by=0$, $f_y=be^{ax}\\cos by=b$.", "$f_{xx}=0$, $f_{xy}=ab$, $f_{yy}=0$.",
               "$f_{xxx}=0$, $f_{xxy}=a^2b$, $f_{xyy}=0$, $f_{yyy}=-b^3$.", "E4.1 + E3.2: $by+\\frac12(2abxy)+\\frac16(3a^2bx^2y-b^3y^3)$."],
     "answer": "$by+abxy+\\dfrac{a^2b\\,x^2y}{2}-\\dfrac{b^3y^3}{6}$", "check": "Product of $1+ax+\\frac{a^2x^2}2$ and $by-\\frac{b^3y^3}6$, keeping degree $\\le3$; sympy agrees."},
    {"id": "W4.3", "topic": "T4", "title": "sin(x + 2y) about the origin", "srcs": ["ESA Jun-24 1c", "CW U1 P25"], "stars": 3,
     "given": "Expand $\\sin(x+2y)$ in Taylor's series up to third-degree terms about $(0,0)$.",
     "steps": ["$f=0$, $f_x=\\cos(x+2y)=1$, $f_y=2$.", "$f_{xx}=-\\sin(\\cdot)=0$, $f_{xy}=0$, $f_{yy}=0$.",
               "$f_{xxx}=-1$, $f_{xxy}=-2$, $f_{xyy}=-4$, $f_{yyy}=-8$.", "$x+2y+\\frac16\\{-x^3-6x^2y-12xy^2-8y^3\\}$."],
     "answer": "$(x+2y)-\\dfrac{(x+2y)^3}{6}$", "check": "CW answer agrees; the sine series with $t=x+2y$ gives the same."},
]

PYQS = [
    {"topic": "T3", "paper": "ESA Jul 2023", "q": "UE22MA141A Q1.b", "marks": 7,
     "text": "Expand $f(x,y)=\\sin x\\sin y$ in Taylor's series up to second order terms about the point $\\big(\\frac\\pi4,\\frac\\pi4\\big)$.", "worked": "W3.1"},
    {"topic": "T3", "paper": "ESA Dec 2023", "q": "UE22MA141A Q1.b", "marks": 7,
     "text": "Expand $f(x,y)=\\sin x\\sin y$ in Taylor's series up to third degree term about $\\big(\\frac\\pi4,\\frac\\pi4\\big)$.", "worked": "W3.2"},
    {"topic": "T3", "paper": "ESA May 2024", "q": "UE22MA141A Q1.b", "marks": 7,
     "text": "Expand $f(x,y)=e^x\\cos y$ in powers of $(x-1)$ and $\\big(y-\\frac\\pi4\\big)$ using Taylor's series up to second degree terms.", "worked": "W3.3"},
    {"topic": "T4", "paper": "ESA Jan 2024", "q": "UE23MA141A set 1, Q1.b", "marks": 7,
     "text": "Expand $\\log(1+x-y)$ about origin up to third degree terms.", "worked": "W4.1"},
    {"topic": "T4", "paper": "ESA Jan 2024", "q": "UE23MA141A set 2, Q1.b", "marks": 7,
     "text": "Expand $e^{ax}\\sin by$ about origin up to third degree terms.", "worked": "W4.2"},
    {"topic": "T4", "paper": "ESA June 2024", "q": "UE23MA141A Q1.c", "marks": 6,
     "text": "Expand $f(x,y)=\\sin(x+2y)$ in Taylor's series up to third degree terms about the point $(0,0)$.", "worked": "W4.3"},
]

NOTES = [
    {"topic": "T1", "text": "Series turn complicated functions into polynomials, which can be evaluated, integrated and used in limits: "
     "$\\int_0^1\\sin(x^2)dx\\approx\\frac13-\\frac1{42}+\\frac1{1320}=0.3103$; $\\lim\\frac{\\sin x-x}{x^3}=-\\frac16$. Applications: "
     "integrals, asymptotics, differential equations, Lorentz factor, $\\sin\\theta\\approx\\theta$, optimization, visualization."},
    {"topic": "T2", "text": "Taylor about $a$: $f(a)+(x-a)f'(a)+\\frac{(x-a)^2}{2!}f''(a)+\\dots$; Maclaurin about 0. Needs finite derivatives "
     "at the point. Standard: $e^x$, $\\log(1+x)$, $(1+x)^n$, $\\sin$, $\\cos$, $\\sinh$, $\\cosh$, $\\tan^{-1}$, $\\sin^{-1}$, $\\cos^{-1}$; "
     "$\\log(1+x)$ and $(1+x)^n$ only for $|x|<1$."},
    {"topic": "T3", "text": "About $(a,b)$ with $h=x-a$, $k=y-b$: $f+\\{hf_x+kf_y\\}+\\frac1{2!}\\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\\}"
     "+\\frac1{3!}\\{h^3f_{xxx}+3h^2kf_{xxy}+3hk^2f_{xyy}+k^3f_{yyy}\\}$, all at $(a,b)$. ESA: $\\sin x\\sin y$ about "
     "$(\\frac\\pi4,\\frac\\pi4)$ gives $\\frac12+\\frac12(h+k)-\\frac14(h-k)^2-\\frac1{12}(h+k)^3$."},
    {"topic": "T4", "text": "About $(0,0)$: $f+\\{xf_x+yf_y\\}+\\frac1{2!}\\{x^2f_{xx}+2xyf_{xy}+y^2f_{yy}\\}+\\dots$ ESA: "
     "$\\log(1+x-y)=(x-y)-\\frac{(x-y)^2}2+\\frac{(x-y)^3}3$; $e^{ax}\\sin by=by+abxy+\\frac{a^2b}2x^2y-\\frac{b^3}6y^3$; "
     "$\\sin(x+2y)=(x+2y)-\\frac{(x+2y)^3}6$."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "$\\sin x$ and its Maclaurin polynomials", "stars": 1, "srcs": ["S007·8", "T007 00:14:45", "T007 00:15:58"],
     "howto": "Blue is $\\sin x$; the dashed curves keep 2, 4 and 6 terms of $x-\\frac{x^3}{3!}+\\frac{x^5}{5!}-\\dots$. Each extra term "
              "extends the range where the polynomial follows the function: near 0 all of them agree; far from 0 the short "
              "polynomials shoot off. The slide shows 4, 6 and 10 terms; with 10 terms the curves overlap on this range."},
    {"id": "G2.1", "topic": "T2", "title": "The first terms of Taylor's series: tangent line and parabola", "stars": 1, "srcs": ["T007 00:05:26", "T007 00:05:43"], "flags": [ADD],
     "howto": "$f(x)=e^x$ about $a=1$. Two terms, $f(a)+(x-a)f'(a)$, give the tangent line (vermilion). Adding $\\frac{(x-a)^2}{2!}f''(a)$ "
              "gives a parabola (green) that bends with the curve and stays close over a wider range."},
    {"id": "G3.1", "topic": "T3", "title": "$xe^y+1$ and its first-degree Taylor polynomial", "stars": 1, "srcs": ["S007·11", "T007 00:20:13"], "tall": True,
     "howto": "The surface $z=xe^y+1$ (blue mesh) and the plane $z=1+x+y$ (grey) touch at $(1,0,2)$. The first-degree Taylor polynomial "
              "is the tangent plane: it matches the surface's height and slopes at the point and separates from it away from the point."},
    {"id": "G3.2", "topic": "T3", "title": "Along the line $x=1$: first- vs second-degree polynomial", "stars": 1, "srcs": ["S007·11", "T007 00:20:51"], "flags": [ADD],
     "howto": "A slice of Figure G3.1 at $x=1$: $f(1,y)=1+e^y$ (blue), the first-degree polynomial $2+y$ (vermilion) and the "
              "second-degree $1+x+xy+\\frac{y^2}2=2+y+\\frac{y^2}2$ (green). The second degree adds curvature and stays close much longer."},
]

FLOWS = [
    {"id": "F3.1", "topic": "T3", "title": "Expanding f(x, y) in Taylor's series", "stars": 3, "srcs": ["S007·9", "ESA Jul-23 1b", "ESA Dec-23 1b"],
     "layout": "straight", "maxw": "128mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$f(x,y)$, point $(a,b)$, degree $n$", "sub": "“in powers of $(x-a)$, $(y-b)$” or “about the origin”"},
         {"kind": "step", "n": 1, "title": "Write $h=x-a$, $k=y-b$", "fx": "origin: $h=x$, $k=y$"},
         {"kind": "step", "n": 2, "title": "Table of partial derivatives", "fx": "$f,\\ f_x,\\ f_y,\\ f_{xx},\\ f_{xy},\\ f_{yy}\\ (,\\ f_{xxx},\\dots)$"},
         {"kind": "step", "n": 3, "title": "Evaluate each at $(a,b)$", "fx": "numbers only"},
         {"kind": "step", "n": 4, "title": "Substitute, order by order", "fx": "$\\frac1{1!}\\{hf_x+kf_y\\}+\\frac1{2!}\\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\\}+\\frac1{3!}\\{\\dots\\}$"},
         {"kind": "result", "title": "Answer in $x-a$, $y-b$", "fx": "stop at the asked degree"}]},
     "remark": "Check: if $f$ depends only on $x+2y$, $x-y$, …, the one-variable series gives the same answer."},
    {"id": "F4.1", "topic": "T4", "title": "Which series?", "stars": 2, "srcs": ["T007 00:11:17", "S007·9", "S007·10"],
     "layout": "route", "maxw": "160mm",
     "spec": {"question": "Where is the expansion?",
              "rows": [{"title": "About $x=a$ (one variable)", "sub": "Taylor's series", "kw": "E2.1"},
                       {"title": "About $x=0$ (one variable)", "sub": "Maclaurin's series or a standard series", "kw": "E2.2–E2.6"},
                       {"title": "About $(a,b)$", "sub": "Two-variable Taylor's series", "kw": "E3.1 + E3.2"},
                       {"title": "About $(0,0)$", "sub": "Two-variable Maclaurin's series", "kw": "E4.1"},
                       {"title": "$f$ of one combination", "sub": "Substitute into a standard series", "kw": "$t=x+2y$", "dashed": True}]},
     "remark": "The dashed route is a shortcut added for clarity; it is also the quickest way to check an answer."},
]

COMPARISONS = [
    {"id": "C4.1", "topic": "T4", "title": "Taylor's and Maclaurin's series side by side", "flags": [ADD], "srcs": ["S007·4", "S007·9", "S007·10"],
     "head": ["", "One variable", "Two variables"],
     "rows": [["Taylor (about a point)", "$f(a)+(x-a)f'(a)+\\frac{(x-a)^2}{2!}f''(a)+\\dots$", "$f(a,b)+\\{hf_x+kf_y\\}+\\frac1{2!}\\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\\}+\\dots$"],
              ["Maclaurin (about the origin)", "$f(0)+xf'(0)+\\frac{x^2}{2!}f''(0)+\\dots$", "$f(0,0)+\\{xf_x+yf_y\\}+\\frac1{2!}\\{x^2f_{xx}+2xyf_{xy}+y^2f_{yy}\\}+\\dots$"],
              ["First degree", "Tangent line", "Tangent plane"],
              ["Coefficients at order $n$", "$\\frac1{n!}$", "$\\frac1{n!}\\times$ binomial (1,2,1; 1,3,3,1)"],
              ["Condition", "$f$ and derivatives finite at the point", "$f$ and all partials finite at the point"]]},
]

SYMBOLS = [
    {"sym": "$a$, $(a,b)$", "name": "Expansion point", "meaning": "Point about which the series is written", "where": "E2.1, E3.1"},
    {"sym": "$h,\\ k$", "name": "Increments", "meaning": "$h=x-a$, $k=y-b$ (shorthand added for clarity)", "where": "E3.1–E3.3"},
    {"sym": "$f^{(n)}(a)$", "name": "$n$-th derivative", "meaning": "Printed $f^n(a)$ on slide 007·4; not a power", "where": "E2.1"},
    {"sym": "$n!$", "name": "Factorial", "meaning": "$1\\cdot2\\cdots n$; divides the $n$-th order term", "where": "E2.1–E4.1"},
    {"sym": "$f_x,\\ f_y$", "name": "First partials", "meaning": "At the expansion point", "where": "E3.1, E4.1"},
    {"sym": "$f_{xx},\\ f_{xy},\\ f_{yy}$", "name": "Second partials", "meaning": "$f_{xy}=f_{yx}$, hence the 2", "where": "E3.1, E4.1"},
    {"sym": "$f_{xxx},\\dots,f_{yyy}$", "name": "Third partials", "meaning": "Coefficients 1, 3, 3, 1", "where": "E3.2"},
    {"sym": "$n$ (in $(1+x)^n$)", "name": "Exponent", "meaning": "Any real number; not the order of a derivative", "where": "E2.4"},
    {"sym": "$L(x,y)$", "name": "Taylor polynomial", "meaning": "Slide 007·11's name for the truncated series", "where": "W3.7"},
]

KEYWORDS = [
    {"term": "Taylor's series", "meaning": "Polynomial form of $f$ about a point.", "topic": "T2"},
    {"term": "Maclaurin's series", "meaning": "Taylor's series about the origin.", "topic": "T2"},
    {"term": "Standard series", "meaning": "$e^x$, $\\log(1+x)$, $\\sin x$, … (slide 007·5).", "topic": "T2"},
    {"term": "Radius of validity", "meaning": "$|x|<1$ for $\\log(1+x)$, $(1+x)^n$, $\\frac1{1-x}$.", "topic": "T2"},
    {"term": "Tangent line", "meaning": "First two terms of Taylor's series.", "topic": "T2"},
    {"term": "Taylor's theorem", "meaning": "Basis of L'Hôpital's rule and the mean value theorems.", "topic": "T1"},
    {"term": "Polynomial approximation", "meaning": "Truncating the series after a few terms.", "topic": "T1"},
    {"term": "Definite integral by series", "meaning": "Integrate the series term by term.", "topic": "T1"},
    {"term": "Pendulum approximation", "meaning": "$\\sin\\theta\\approx\\theta$ (one term).", "topic": "T1"},
    {"term": "Lorentz factor", "meaning": "Approximated by its Maclaurin series at low speed.", "topic": "T1"},
    {"term": "Taylor's series in two variables", "meaning": "E3.1 about $(a,b)$.", "topic": "T3"},
    {"term": "Third-degree terms", "meaning": "$\\frac1{3!}\\{h^3f_{xxx}+3h^2kf_{xxy}+3hk^2f_{xyy}+k^3f_{yyy}\\}$.", "topic": "T3"},
    {"term": "In powers of (x − a)", "meaning": "About the point $(a,b)$.", "topic": "T3"},
    {"term": "Tangent plane", "meaning": "First-degree Taylor polynomial in two variables.", "topic": "T3"},
    {"term": "Mixed partials", "meaning": "$f_{xy}=f_{yx}$; give the coefficient 2.", "topic": "T3"},
    {"term": "Approximate value", "meaning": "Evaluate the truncated series at a nearby point.", "topic": "T3"},
    {"term": "Maclaurin's series in two variables", "meaning": "E4.1 about $(0,0)$.", "topic": "T4"},
    {"term": "One-combination shortcut", "meaning": "$f(x+2y)$: use the one-variable series.", "topic": "T4"},
]

RAPID = [
    {"q": "Taylor's series of $f(x)$ about $x=a$?", "a": "$f(a)+(x-a)f'(a)+\\frac{(x-a)^2}{2!}f''(a)+\\dots$"},
    {"q": "Maclaurin's series is Taylor's series about?", "a": "The origin."},
    {"q": "Condition for Maclaurin's series?", "a": "$f$ and all derivatives finite at 0 (series convergent)."},
    {"q": "$e^x$?", "a": "$1+x+\\frac{x^2}{2!}+\\frac{x^3}{3!}+\\dots$"},
    {"q": "$\\log(1+x)$, and where?", "a": "$x-\\frac{x^2}2+\\frac{x^3}3-\\dots$, $|x|<1$."},
    {"q": "$\\sin x$?", "a": "$x-\\frac{x^3}{3!}+\\frac{x^5}{5!}-\\dots$"},
    {"q": "$\\cos x$?", "a": "$1-\\frac{x^2}{2!}+\\frac{x^4}{4!}-\\dots$"},
    {"q": "$\\tan^{-1}x$?", "a": "$x-\\frac{x^3}3+\\frac{x^5}5-\\dots$"},
    {"q": "Does $1+2+4+\\dots$ equal $-1$?", "a": "No, it diverges; $\\frac1{1-x}$ needs $|x|<1$."},
    {"q": "$\\int_0^1\\sin(x^2)dx$?", "a": "$\\frac13-\\frac1{42}+\\frac1{1320}-\\dots\\approx0.3103$."},
    {"q": "$\\lim\\frac{\\sin x-x}{x^3}$?", "a": "$-\\frac16$."},
    {"q": "Two-variable second-order bracket?", "a": "$\\frac1{2!}\\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\\}$."},
    {"q": "Third-order bracket?", "a": "$\\frac1{3!}\\{h^3f_{xxx}+3h^2kf_{xxy}+3hk^2f_{xyy}+k^3f_{yyy}\\}$."},
    {"q": "Why the 2 in $2hkf_{xy}$?", "a": "$f_{xy}=f_{yx}$."},
    {"q": "First-degree Taylor polynomial is the …?", "a": "Tangent plane."},
    {"q": "$\\sin x\\sin y$ about $(\\frac\\pi4,\\frac\\pi4)$, second order?", "a": "$\\frac12+\\frac12(h+k)-\\frac14(h-k)^2$."},
    {"q": "Its third-degree term?", "a": "$-\\frac1{12}(h+k)^3$."},
    {"q": "$\\log(1+x-y)$ to third degree?", "a": "$(x-y)-\\frac{(x-y)^2}2+\\frac{(x-y)^3}3$."},
    {"q": "$e^{ax}\\sin by$ to third degree?", "a": "$by+abxy+\\frac{a^2b}2x^2y-\\frac{b^3}6y^3$."},
    {"q": "$\\sin(x+2y)$ to third degree?", "a": "$(x+2y)-\\frac{(x+2y)^3}6$."},
    {"q": "$e^x\\cos y$ about $(1,\\frac\\pi4)$, second degree?", "a": "$\\frac e{\\sqrt2}[1+h-k+\\frac12(h^2-2hk-k^2)]$."},
    {"q": "$\\tan^{-1}\\frac{0.9}{1.1}$ by Taylor?", "a": "$\\approx0.6854$."},
]

MNEMONICS = [
    "<i>“Binomial brackets.”</i> Order $n$ is $\\frac1{n!}(h\\partial_x+k\\partial_y)^nf$: coefficients 1, 2, 1 at second order and 1, 3, 3, 1 at third.",
]

TOP_FACTS = [
    "Taylor about $a$: $f(a)+(x-a)f'(a)+\\frac{(x-a)^2}{2!}f''(a)+\\dots$; Maclaurin: about the origin.",
    "Needs finite derivatives at the point; $\\log(1+x)$, $(1+x)^n$, $\\frac1{1-x}$ only for $|x|<1$.",
    "Two variables: $f+\\{hf_x+kf_y\\}+\\frac1{2!}\\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\\}+\\dots$, $h=x-a$, $k=y-b$.",
    "Third order: $\\frac1{3!}\\{h^3f_{xxx}+3h^2kf_{xxy}+3hk^2f_{xyy}+k^3f_{yyy}\\}$ (asked in 4 of 6 ESA questions).",
    "Method: derivative table, evaluate at the point, substitute order by order.",
    "One combination ($x+2y$, $x-y$): use the one-variable series.",
    "ESA: $\\sin x\\sin y$ about $(\\frac\\pi4,\\frac\\pi4)$; $e^x\\cos y$ about $(1,\\frac\\pi4)$; $\\log(1+x-y)$; $e^{ax}\\sin by$; $\\sin(x+2y)$.",
    "First degree = tangent plane; more terms follow the surface further.",
]
TOP_FORMULAS = ["E2.1", "E2.2", "E3.1", "E3.2", "E4.1", "E2.5"]
