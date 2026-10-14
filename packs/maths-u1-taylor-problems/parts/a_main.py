"""Class 008: problems on Taylor's and Maclaurin's series."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "Taylor expansion about a point (a, b)",
     "overview": "Write $h=x-a$, $k=y-b$, tabulate $f$ and its partial derivatives, evaluate them at $(a,b)$ and substitute into "
                 "$f+\\{hf_x+kf_y\\}+\\frac1{2!}\\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\\}+\\frac1{3!}\\{\\dots\\}$. “In powers of $(x-1)$ and "
                 "$(y-\\frac\\pi4)$” means about $(1,\\frac\\pi4)$. Class 008 works $e^x\\cos y$, $\\sin(xy)$ and $xy^2+y\\cos(x-y)$; "
                 "the ESA favourite is $\\sin x\\sin y$ about $(\\frac\\pi4,\\frac\\pi4)$."},
    {"id": "T2", "title": "Maclaurin expansion about the origin",
     "overview": "The same method with $(a,b)=(0,0)$, so $h=x$, $k=y$. Class 008 works $\\log(2x+y+1)$, $e^{x-y}$ and "
                 "$e^x\\log(1+y)$; the ESA papers ask $\\log(1+x-y)$, $e^{ax}\\sin by$ and $\\sin(x+2y)$, all up to third degree. "
                 "When $f$ depends on one combination such as $2x+y$ or $x-y$, the one-variable series gives the answer at once and "
                 "is the best check."},
    {"id": "T3", "title": "Approximate values from a Taylor polynomial",
     "overview": "To estimate $f$ at an awkward point, expand about a nearby point where everything is known, then substitute the "
                 "small $h$ and $k$. Class 008 estimates $\\tan^{-1}(xy)$ at $(0.9,-1.2)$ from $(1,-1)$; the class-work sheet "
                 "estimates $\\tan^{-1}\\frac{0.9}{1.1}$ from $(1,1)$. More terms give a better value."},
]

DEFS = [
    {"topic": "T1", "term": "Expansion “in powers of (x − a) and (y − b)”", "text": "Taylor's series of $f(x,y)$ about the point $(a,b)$.",
     "srcs": ["S008·3", "T008 00:00:37"]},
    {"topic": "T1", "term": "Up to n-th degree terms", "text": "Keep every term whose total power of $(x-a)$ and $(y-b)$ is at most $n$.",
     "srcs": ["T008 00:06:10"], "flags": [ADD]},
    {"topic": "T2", "term": "Up to three terms", "text": "Keep going until there are three non-zero terms: “make sure that you will get three non-zero terms”.",
     "srcs": ["S008·5", "T008 00:07:38"]},
    {"topic": "T3", "term": "Approximate value", "text": "The value of a truncated Taylor polynomial at a point near the expansion point.",
     "srcs": ["S008·7", "T008 00:11:47"]},
]

STATEMENTS = [
    {"topic": "T1", "text": "$f(x,y)\\approx f(a,b)+(x-a)f_x(a,b)+(y-b)f_y(a,b)+\\frac1{2!}\\big[(x-a)^2f_{xx}(a,b)+2(x-a)(y-b)f_{xy}(a,b)+(y-b)^2f_{yy}(a,b)\\big]$",
     "srcs": ["S008·14", "S008·19"]},
    {"topic": "T2", "text": "Taylor's series about $(0,0)$ is given by $f(x,y)\\approx f(0,0)+f_x(0,0)\\,x+f_y(0,0)\\,y+\\frac1{2!}\\big[f_{xx}(0,0)x^2+2f_{xy}(0,0)xy+f_{yy}(0,0)y^2\\big]"
     "+\\frac1{3!}\\big[f_{xxx}(0,0)x^3+3f_{xxy}(0,0)x^2y+3f_{xyy}(0,0)xy^2+f_{yyy}(0,0)y^3\\big]+\\dots$", "srcs": ["S008·10"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Taylor's series about (a, b), to second order", "tex": r"f(x,y)=f+\{hf_x+kf_y\}+\frac1{2!}\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\}+\dots,\quad h=x-a,\ k=y-b",
     "gives": "The polynomial to substitute into.", "when": "All derivatives evaluated at $(a,b)$.", "note": "$h$, $k$ are shorthand added for clarity.",
     "stars": 3, "srcs": ["S008·3", "S008·14", "T008 00:00:37", "T008 00:01:25"]},
    {"id": "E1.2", "topic": "T1", "title": "Third-degree term", "tex": r"+\frac1{3!}\{h^3f_{xxx}+3h^2kf_{xxy}+3hk^2f_{xyy}+k^3f_{yyy}\}",
     "gives": "The terms for “up to third degree”.", "when": "Add to E1.1 or E2.1.", "note": "Coefficients 1, 3, 3, 1; asked in four of six ESA questions.",
     "stars": 3, "srcs": ["S008·10", "ESA Dec-23 1b", "ESA Jun-24 1c"]},
    {"id": "E2.1", "topic": "T2", "title": "Maclaurin's series (about the origin)", "tex": r"f(x,y)=f(0,0)+\{xf_x+yf_y\}+\frac1{2!}\{x^2f_{xx}+2xyf_{xy}+y^2f_{yy}\}+\dots",
     "gives": "The polynomial about $(0,0)$.", "when": "Derivatives at $(0,0)$.", "note": "Slide 008·10 calls this “Taylor's series about (0,0)”; it is the same thing.",
     "stars": 3, "srcs": ["S008·10", "S008·12", "T008 00:06:58"]},
    {"id": "E2.2", "topic": "T2", "title": "One-combination check", "tex": r"f=g(t),\ t=px+qy\ \Longrightarrow\ f(x,y)=g(0)+g'(0)\,t+\frac{g''(0)}{2!}t^2+\frac{g'''(0)}{3!}t^3+\dots",
     "gives": "The same expansion in one line.", "when": "$f$ depends on $x$ and $y$ only through $px+qy$.",
     "note": "$\\log(2x+y+1)=t-\\frac{t^2}2+\\frac{t^3}3$ with $t=2x+y$; $e^{x-y}=1+t+\\frac{t^2}2+\\frac{t^3}6$ with $t=x-y$.", "stars": 2,
     "srcs": ["S008·6", "S008·11"], "flags": [ADD]},
    {"id": "E3.1", "topic": "T3", "title": "Approximation by a Taylor polynomial", "tex": r"f(a+h,b+k)\approx f(a,b)+hf_x+kf_y+\frac1{2!}\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\}",
     "gives": "A numerical estimate.", "when": "$h$, $k$ small; $(a,b)$ a point where $f$ and its derivatives are easy.",
     "note": "Choose $(a,b)$ with “nice” values: $(1,-1)$ for $(0.9,-1.2)$.", "stars": 2, "srcs": ["S008·7", "S008·9", "T008 00:12:10"]},
]

POINTS = [
    {"topic": "T1", "text": "Write the general series first, then find the derivatives, then substitute. That is the order the lecture follows.", "stars": 2, "srcs": ["T008 00:00:21", "T008 00:02:07"]},
    {"topic": "T1", "text": "For $e^x\\cos y$ at $(1,\\frac\\pi4)$ every derivative is $\\pm\\frac e{\\sqrt2}$; only the signs differ, so take $\\frac e{\\sqrt2}$ out as a common factor.", "stars": 3, "srcs": ["T008 00:04:54", "T008 00:05:19"]},
    {"topic": "T1", "text": "If the question asks for third degree, you need the third-order partials $f_{xxx},f_{xxy},f_{xyy},f_{yyy}$ too.", "stars": 3, "srcs": ["T008 00:06:10"]},
    {"topic": "T1", "text": "Derivatives that vanish at the point drop whole terms: for $\\sin(xy)$ at $(1,\\frac\\pi2)$ both first partials are 0.", "stars": 2, "srcs": ["S008·15", "S008·16"]},
    {"topic": "T1", "text": "Differentiate carefully with the product and chain rules; the slide's own $f_{yy}$ for $xy^2+y\\cos(x-y)$ has a sign slip (see the exam traps).", "stars": 2, "srcs": ["S008·17", "S008·18"], "flags": [ADD]},
    {"topic": "T2", "text": "About $(0,0)$ the constant term is often 0 ($\\log 1=0$, $\\sin0=0$), so the series starts at first degree.", "stars": 2, "srcs": ["T008 00:07:57"]},
    {"topic": "T2", "text": "“Up to three terms” means three non-zero terms; the lecture still writes all second-order terms.", "stars": 2, "srcs": ["T008 00:07:38", "T008 00:10:55"]},
    {"topic": "T2", "text": "Collect and simplify at the end: $2x+y-2x^2-2xy-\\frac{y^2}2$.", "stars": 1, "srcs": ["T008 00:11:11"]},
    {"topic": "T2", "text": "Check a two-variable answer with the one-variable series of the combination (E2.2, Figure G2.1).", "stars": 3, "srcs": ["S008·6", "S008·11"], "flags": [ADD]},
    {"topic": "T3", "text": "Pick an expansion point near the target where $f$ is easy: $(1,-1)$ for $(0.9,-1.2)$, $(1,1)$ for $(1.1,0.9)$.", "stars": 2, "srcs": ["T008 00:12:10", "CW U1 P26"]},
    {"topic": "T3", "text": "“The more terms you take, the better the approximation”: the first-order estimate of $\\tan^{-1}(-1.08)$ is off by $0.012$, the second-order one by $0.001$.", "stars": 2, "srcs": ["T008 00:14:18"]},
    {"topic": "T3", "text": "Substitute $h=x-a$ and $k=y-b$ with their signs: $x=0.9$ gives $h=-0.1$, $y=-1.2$ gives $k=-0.2$.", "stars": 2, "srcs": ["T008 00:15:13", "T008 00:15:28"]},
]

WHY = [
    {"topic": "T3", "q": "Why expand about (1, −1) to evaluate at (0.9, −1.2)?",
     "a": "At $(1,-1)$ every value is exact ($\\tan^{-1}(-1)=-\\frac\\pi4$, simple derivatives), and $h=-0.1$, $k=-0.2$ are small, so the higher terms shrink quickly.",
     "srcs": ["T008 00:12:10", "T008 00:12:48"]},
    {"topic": "T2", "q": "Why does $\\log(2x+y+1)$ give $(2x+y)-\\frac{(2x+y)^2}2+\\dots$?",
     "a": "It is $\\log(1+t)$ with $t=2x+y$, and $\\log(1+t)=t-\\frac{t^2}2+\\frac{t^3}3-\\dots$; the two-variable Maclaurin series must agree with it.",
     "srcs": ["S008·6"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T1", "text": "For $xy^2+y\\cos(x-y)$: $f_{yy}=2x+2\\sin(x-y)-y\\cos(x-y)$, so $f_{yy}(1,1)=1$, not 3 as slide 008·18 prints.", "srcs": ["S008·17", "S008·18"], "flags": [ADD]},
    {"topic": "T2", "text": "For $e^x\\log(1+y)$: $f_{xy}=\\frac{e^x}{1+y}$, so $f_{xy}(0,0)=1$, not 0 as slide 008·12 lists.", "srcs": ["S008·12"], "flags": [ADD]},
    {"topic": "T2", "text": "“First six terms” of $e^x\\log(1+y)$ needs third order: $y+xy-\\frac{y^2}2+\\frac{x^2y}2-\\frac{xy^2}2+\\frac{y^3}3$. The slide stops at three.", "srcs": ["S008·12", "S008·13"], "flags": [ADD]},
    {"topic": "T1", "text": "Every value on slide 008·3 is $\\pm\\frac e{\\sqrt2}$, not $\\pm\\frac e2$ as said at T008 00:03:47.", "srcs": ["S008·3", "T008 00:03:47"], "flags": [ADD]},
    {"topic": "T3", "text": "With $x=0.9$, $h=x-1=-0.1$ (negative). A sign slip here changes the answer by $0.1$.", "srcs": ["T008 00:15:13"], "flags": [ADD]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "$e^x\\cos y$ about $(1,\\frac\\pi4)$ (slides 008·3–4)", "srcs": ["S008·3", "S008·4", "T008 00:00:21", "T008 00:05:53", "ESA May-24 1b"], "stars": 3,
     "given": "Expand $e^x\\cos y$ in powers of $(x-1)$ and $\\big(y-\\frac\\pi4\\big)$ up to second degree. Let $h=x-1$, $k=y-\\frac\\pi4$.",
     "steps": ["$f=e^x\\cos y=\\frac e{\\sqrt2}$; $f_x=e^x\\cos y=\\frac e{\\sqrt2}$; $f_y=-e^x\\sin y=-\\frac e{\\sqrt2}$.",
               "$f_{xx}=e^x\\cos y=\\frac e{\\sqrt2}$; $f_{xy}=-e^x\\sin y=-\\frac e{\\sqrt2}$; $f_{yy}=-e^x\\cos y=-\\frac e{\\sqrt2}$.",
               "E1.1, taking $\\frac e{\\sqrt2}$ out: $\\frac e{\\sqrt2}\\big[1+h-k+\\frac1{2!}(h^2-2hk-k^2)\\big]$."],
     "answer": "$e^x\\cos y\\approx\\dfrac e{\\sqrt2}\\Big[1+(x-1)-\\big(y-\\tfrac\\pi4\\big)+\\tfrac12\\Big\\{(x-1)^2-2(x-1)\\big(y-\\tfrac\\pi4\\big)-\\big(y-\\tfrac\\pi4\\big)^2\\Big\\}\\Big]$",
     "check": "sympy series agrees. Same question as ESA May 2024 Q1.b."},
    {"id": "W1.2", "topic": "T1", "title": "$\\sin(xy)$ about $(1,\\frac\\pi2)$ (slides 008·14–16)", "srcs": ["S008·14", "S008·15", "S008·16"], "stars": 2,
     "given": "Expand $\\sin(xy)$ in powers of $(x-1)$ and $\\big(y-\\frac\\pi2\\big)$ up to second-degree terms. Let $h=x-1$, $k=y-\\frac\\pi2$.",
     "steps": ["$f=\\sin\\frac\\pi2=1$; $f_x=y\\cos(xy)=0$; $f_y=x\\cos(xy)=0$.",
               "$f_{xx}=-y^2\\sin(xy)=-\\frac{\\pi^2}4$; $f_{xy}=\\cos(xy)-xy\\sin(xy)=-\\frac\\pi2$; $f_{yy}=-x^2\\sin(xy)=-1$.",
               "E1.1: $1+\\frac12\\big[-\\frac{\\pi^2}4h^2-\\pi hk-k^2\\big]$."],
     "answer": "$\\sin(xy)\\approx1-\\dfrac{\\pi^2}{8}(x-1)^2-\\dfrac\\pi2(x-1)\\big(y-\\tfrac\\pi2\\big)-\\dfrac12\\big(y-\\tfrac\\pi2\\big)^2$", "check": "sympy series agrees; Figure G1.1."},
    {"id": "W1.3", "topic": "T1", "title": "$xy^2+y\\cos(x-y)$ about $(1,1)$ (slides 008·17–19)", "srcs": ["S008·17", "S008·18", "S008·19", "CW U1 P28"], "stars": 2,
     "given": "Find the Taylor series of $f=xy^2+y\\cos(x-y)$ up to second order about $(1,1)$. Let $h=x-1$, $k=y-1$.",
     "steps": ["$f_x=y^2-y\\sin(x-y)$, $f_y=2xy+y\\sin(x-y)+\\cos(x-y)$.",
               "$f_{xx}=-y\\cos(x-y)$, $f_{xy}=2y+y\\cos(x-y)-\\sin(x-y)$, $f_{yy}=2x+2\\sin(x-y)-y\\cos(x-y)$.",
               "At $(1,1)$: $f=2$, $f_x=1$, $f_y=3$, $f_{xx}=-1$, $f_{xy}=3$, $f_{yy}=1$ (not 3, as slide 008·18 prints).",
               "E1.1: $2+(h+3k)+\\frac12(-h^2+6hk+k^2)$."],
     "answer": "$2+(x-1)+3(y-1)+\\tfrac12\\big[-(x-1)^2+6(x-1)(y-1)+(y-1)^2\\big]$", "check": "Slide 008·19 and the CW answer agree; sympy agrees."},
    {"id": "W1.4", "topic": "T1", "title": "sin x sin y about (π/4, π/4), second order (ESA)", "srcs": ["ESA Jul-23 1b", "CW U1 P24"], "stars": 3,
     "given": "Expand $\\sin x\\sin y$ up to second-order terms about $\\big(\\frac\\pi4,\\frac\\pi4\\big)$. Let $h=x-\\frac\\pi4$, $k=y-\\frac\\pi4$.",
     "steps": ["$f=f_x=f_y=\\frac12$.", "$f_{xx}=f_{yy}=-\\sin x\\sin y=-\\frac12$; $f_{xy}=\\cos x\\cos y=\\frac12$.", "$\\frac12+\\frac12(h+k)+\\frac12\\{-\\frac12h^2+hk-\\frac12k^2\\}$."],
     "answer": "$\\tfrac12+\\tfrac12(h+k)-\\tfrac14(h-k)^2$", "check": "CW answer agrees; sympy agrees."},
    {"id": "W1.5", "topic": "T1", "title": "sin x sin y, third degree (ESA)", "srcs": ["ESA Dec-23 1b"], "stars": 3,
     "given": "The same function up to third-degree terms.",
     "steps": ["$f_{xxx}=f_{xxy}=f_{xyy}=f_{yyy}=-\\frac12$ at $(\\frac\\pi4,\\frac\\pi4)$.", "E1.2: $\\frac16\\cdot\\big(-\\frac12\\big)(h^3+3h^2k+3hk^2+k^3)=-\\frac1{12}(h+k)^3$."],
     "answer": "$\\tfrac12+\\tfrac12(h+k)-\\tfrac14(h-k)^2-\\tfrac1{12}(h+k)^3$", "check": "sympy series to third order agrees."},
    {"id": "W1.6", "topic": "T1", "title": "$\\sqrt{1+x+y^2}$ in powers of $(x-1)$ and $y$ (CW)", "srcs": ["CW U1 P27"], "stars": 2,
     "given": "Expand $\\sqrt{1+x+y^2}$ about $(1,0)$ up to second degree. Let $h=x-1$, $k=y$.",
     "steps": ["$f=\\sqrt2$, $f_x=\\frac{\\sqrt2}4$, $f_y=0$.", "$f_{xx}=-\\frac{\\sqrt2}{16}$, $f_{xy}=0$, $f_{yy}=\\frac{\\sqrt2}2$.", "$\\sqrt2+\\frac{\\sqrt2}4h+\\frac12\\big(-\\frac{\\sqrt2}{16}h^2+\\frac{\\sqrt2}2k^2\\big)$."],
     "answer": "$\\sqrt2\\Big[1+\\dfrac{x-1}4-\\dfrac{(x-1)^2}{32}+\\dfrac{y^2}4\\Big]$", "check": "CW answer agrees; sympy agrees."},
    {"id": "W2.1", "topic": "T2", "title": "$\\log(2x+y+1)$ about the origin (slides 008·5–6)", "srcs": ["S008·5", "S008·6", "T008 00:06:34", "T008 00:11:11"], "stars": 2,
     "given": "Expand $\\log(2x+y+1)$ about $(0,0)$ up to three terms.",
     "steps": ["$f=\\log1=0$; $f_x=\\frac2{2x+y+1}=2$; $f_y=\\frac1{2x+y+1}=1$.",
               "$f_{xx}=\\frac{-4}{(2x+y+1)^2}=-4$; $f_{xy}=\\frac{-2}{(\\dots)^2}=-2$; $f_{yy}=\\frac{-1}{(\\dots)^2}=-1$.",
               "E2.1: $2x+y+\\frac1{2!}\\{-4x^2-4xy-y^2\\}$."],
     "answer": "$\\log(2x+y+1)\\approx2x+y-2x^2-2xy-\\dfrac{y^2}{2}=(2x+y)-\\dfrac{(2x+y)^2}{2}$",
     "check": "E2.2 with $t=2x+y$; sympy agrees. The lecture's spoken simplification “$-xy$” (T008 00:11:11) should be $-2xy$."},
    {"id": "W2.2", "topic": "T2", "title": "$e^{x-y}$ about the origin (slides 008·10–11)", "srcs": ["S008·10", "S008·11"], "stars": 2,
     "given": "Find the Taylor expansion of $e^{x-y}$ at $(0,0)$.",
     "steps": ["At $(0,0)$ every derivative is $\\pm1$: $f_x=1$, $f_y=-1$, $f_{xx}=1$, $f_{xy}=-1$, $f_{yy}=1$.", "Third order: $f_{xxx}=1$, $f_{xxy}=-1$, $f_{xyy}=1$, $f_{yyy}=-1$.",
               "E2.1 + E1.2: $1+x-y+\\frac12(x^2-2xy+y^2)+\\frac16(x^3-3x^2y+3xy^2-y^3)$."],
     "answer": "$e^{x-y}\\approx1+(x-y)+\\dfrac{(x-y)^2}{2}+\\dfrac{(x-y)^3}{6}$", "check": "The slide stops at second order; the third-degree term is added (sympy). E2.2 with $t=x-y$."},
    {"id": "W2.3", "topic": "T2", "title": "$e^x\\log(1+y)$, first six terms (slides 008·12–13)", "srcs": ["S008·12", "S008·13"], "stars": 2,
     "given": "Find the first six terms of the expansion of $e^x\\log(1+y)$ about $(0,0)$.",
     "steps": ["$f=0$, $f_x=e^x\\log(1+y)=0$, $f_y=\\frac{e^x}{1+y}=1$.", "$f_{xx}=0$, $f_{xy}=\\frac{e^x}{1+y}=1$ (slide 008·12 prints 0), $f_{yy}=-\\frac{e^x}{(1+y)^2}=-1$.",
               "Third order: $f_{xxx}=0$, $f_{xxy}=1$, $f_{xyy}=-1$, $f_{yyy}=\\frac{2e^x}{(1+y)^3}=2$.",
               "$y+\\frac12(2xy-y^2)+\\frac16(3x^2y-3xy^2+2y^3)$."],
     "answer": "$e^x\\log(1+y)\\approx y+xy-\\dfrac{y^2}{2}+\\dfrac{x^2y}{2}-\\dfrac{xy^2}{2}+\\dfrac{y^3}{3}$",
     "check": "The slide gives the first three ($y+xy-\\frac{y^2}2$); the other three are added. Product of $1+x+\\frac{x^2}2$ and $y-\\frac{y^2}2+\\frac{y^3}3$; sympy agrees."},
    {"id": "W2.4", "topic": "T2", "title": "log(1 + x − y) to third degree (ESA)", "srcs": ["ESA Jan-24 s1 1b"], "stars": 3,
     "given": "Expand $\\log(1+x-y)$ about the origin up to third-degree terms.",
     "steps": ["$f_x=1$, $f_y=-1$; $f_{xx}=-1$, $f_{xy}=1$, $f_{yy}=-1$; $f_{xxx}=2$, $f_{xxy}=-2$, $f_{xyy}=2$, $f_{yyy}=-2$.",
               "$(x-y)+\\frac12(-x^2+2xy-y^2)+\\frac16(2x^3-6x^2y+6xy^2-2y^3)$."],
     "answer": "$(x-y)-\\dfrac{(x-y)^2}{2}+\\dfrac{(x-y)^3}{3}$", "check": "E2.2 with $t=x-y$; sympy agrees."},
    {"id": "W2.5", "topic": "T2", "title": "$e^{ax}\\sin by$ to third degree (ESA)", "srcs": ["ESA Jan-24 s2 1b"], "stars": 3,
     "given": "Expand $e^{ax}\\sin by$ about the origin up to third-degree terms.",
     "steps": ["$f=f_x=0$, $f_y=b$; $f_{xx}=0$, $f_{xy}=ab$, $f_{yy}=0$.", "$f_{xxx}=0$, $f_{xxy}=a^2b$, $f_{xyy}=0$, $f_{yyy}=-b^3$.",
               "$by+abxy+\\frac16(3a^2bx^2y-b^3y^3)$."],
     "answer": "$by+abxy+\\dfrac{a^2b\\,x^2y}{2}-\\dfrac{b^3y^3}{6}$", "check": "Product of the series of $e^{ax}$ and $\\sin by$; sympy agrees."},
    {"id": "W2.6", "topic": "T2", "title": "sin(x + 2y) to third degree (ESA)", "srcs": ["ESA Jun-24 1c", "CW U1 P25"], "stars": 3,
     "given": "Expand $\\sin(x+2y)$ up to third-degree terms about $(0,0)$.",
     "steps": ["$f_x=1$, $f_y=2$; all second partials 0.", "$f_{xxx}=-1$, $f_{xxy}=-2$, $f_{xyy}=-4$, $f_{yyy}=-8$.", "$x+2y+\\frac16(-x^3-6x^2y-12xy^2-8y^3)$."],
     "answer": "$(x+2y)-\\dfrac{(x+2y)^3}{6}$", "check": "CW answer agrees; E2.2 with $t=x+2y$."},
    {"id": "W3.1", "topic": "T3", "title": "tan⁻¹(xy) at (0.9, −1.2) (slides 008·7–9)", "srcs": ["S008·7", "S008·8", "S008·9", "T008 00:11:53", "T008 00:15:42"], "stars": 2,
     "given": "Find the Taylor series of $\\tan^{-1}(xy)$ about $(1,-1)$ and hence approximate $f(0.9,-1.2)$. Let $h=x-1$, $k=y+1$.",
     "steps": ["$f=\\tan^{-1}(-1)=-\\frac\\pi4$; $f_x=\\frac y{1+x^2y^2}=-\\frac12$; $f_y=\\frac x{1+x^2y^2}=\\frac12$.",
               "$f_{xx}=\\frac{-2xy^3}{(1+x^2y^2)^2}=\\frac12$; $f_{xy}=\\frac{1-x^2y^2}{(1+x^2y^2)^2}=0$; $f_{yy}=\\frac{-2x^3y}{(1+x^2y^2)^2}=\\frac12$.",
               "Series: $-\\frac\\pi4-\\frac12h+\\frac12k+\\frac14(h^2+k^2)$.",
               "$h=-0.1$, $k=-0.2$. First order: $-0.7854+0.05-0.1=-0.8354$. Adding $\\frac14(0.01+0.04)=0.0125$ gives $-0.8229$."],
     "answer": "$\\tan^{-1}(-1.08)\\approx-0.835$ (first order, as on the slide); $\\approx-0.823$ (second order)",
     "check": "Exact $-0.82384$ (sympy). The second-order value is ten times closer."},
    {"id": "W3.2", "topic": "T3", "title": "tan⁻¹(0.9/1.1) (CW)", "srcs": ["CW U1 P26"], "stars": 2,
     "given": "Using $\\tan^{-1}\\frac yx$ about $(1,1)$, compute $\\tan^{-1}\\frac{0.9}{1.1}$. Let $h=x-1$, $k=y-1$.",
     "steps": ["At $(1,1)$: $f=\\frac\\pi4$, $f_x=-\\frac12$, $f_y=\\frac12$, $f_{xx}=\\frac12$, $f_{xy}=0$, $f_{yy}=-\\frac12$.",
               "$\\frac\\pi4-\\frac12h+\\frac12k+\\frac14h^2-\\frac14k^2$ with $h=0.1$, $k=-0.1$."],
     "answer": "$\\approx0.6854$", "check": "Exact $0.6857$. The CW sheet prints $0.6904$, an arithmetic slip."},
]

PYQS = [
    {"topic": "T1", "paper": "ESA May 2024", "q": "UE22MA141A Q1.b", "marks": 7,
     "text": "Expand $f(x,y)=e^x\\cos y$ in powers of $(x-1)$ and $\\big(y-\\frac\\pi4\\big)$ using Taylor's series up to second degree terms.", "worked": "W1.1"},
    {"topic": "T1", "paper": "ESA Jul 2023", "q": "UE22MA141A Q1.b", "marks": 7,
     "text": "Expand $f(x,y)=\\sin x\\sin y$ in Taylor's series up to second order terms about the point $\\big(\\frac\\pi4,\\frac\\pi4\\big)$.", "worked": "W1.4"},
    {"topic": "T1", "paper": "ESA Dec 2023", "q": "UE22MA141A Q1.b", "marks": 7,
     "text": "Expand $f(x,y)=\\sin x\\sin y$ in Taylor's series up to third degree term about $\\big(\\frac\\pi4,\\frac\\pi4\\big)$.", "worked": "W1.5"},
    {"topic": "T2", "paper": "ESA Jan 2024", "q": "UE23MA141A set 1, Q1.b", "marks": 7, "text": "Expand $\\log(1+x-y)$ about origin up to third degree terms.", "worked": "W2.4"},
    {"topic": "T2", "paper": "ESA Jan 2024", "q": "UE23MA141A set 2, Q1.b", "marks": 7, "text": "Expand $e^{ax}\\sin by$ about origin up to third degree terms.", "worked": "W2.5"},
    {"topic": "T2", "paper": "ESA June 2024", "q": "UE23MA141A Q1.c", "marks": 6,
     "text": "Expand $f(x,y)=\\sin(x+2y)$ in Taylor's series up to third degree terms about the point $(0,0)$.", "worked": "W2.6"},
]

NOTES = [
    {"topic": "T1", "text": "About $(a,b)$: $h=x-a$, $k=y-b$; table of $f,f_x,f_y,f_{xx},f_{xy},f_{yy}$ at the point; $f+\\{hf_x+kf_y\\}+\\frac1{2!}\\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\\}$. "
     "$e^x\\cos y$ at $(1,\\frac\\pi4)$: $\\frac e{\\sqrt2}[1+h-k+\\frac12(h^2-2hk-k^2)]$. $\\sin(xy)$ at $(1,\\frac\\pi2)$: $1-\\frac{\\pi^2}8h^2-\\frac\\pi2hk-\\frac12k^2$. "
     "$xy^2+y\\cos(x-y)$ at $(1,1)$: $2+h+3k+\\frac12(-h^2+6hk+k^2)$."},
    {"topic": "T2", "text": "About $(0,0)$: $f+\\{xf_x+yf_y\\}+\\frac1{2!}\\{\\dots\\}+\\frac1{3!}\\{\\dots\\}$. $\\log(2x+y+1)=(2x+y)-\\frac{(2x+y)^2}2$; "
     "$e^{x-y}=1+(x-y)+\\frac{(x-y)^2}2+\\frac{(x-y)^3}6$; $e^x\\log(1+y)=y+xy-\\frac{y^2}2+\\frac{x^2y}2-\\frac{xy^2}2+\\frac{y^3}3$. "
     "Check one-combination functions with the one-variable series."},
    {"topic": "T3", "text": "Expand about a nearby easy point and substitute small $h$, $k$ with signs. $\\tan^{-1}(xy)$ at $(0.9,-1.2)$ from $(1,-1)$: "
     "$-0.835$ (first order), $-0.823$ (second); exact $-0.824$. $\\tan^{-1}\\frac{0.9}{1.1}\\approx0.6854$."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "$\\sin(xy)$ near $(1,\\pi/2)$: a slice at $y=\\pi/2$", "stars": 1, "srcs": ["S008·14", "S008·16"], "flags": [ADD],
     "howto": "Along $y=\\frac\\pi2$, $\\sin(xy)=\\sin\\frac{\\pi x}2$ (blue) has a maximum at $x=1$, so both first partials vanish and the first-degree "
              "polynomial is the flat line 1 (vermilion). The second-degree polynomial $1-\\frac{\\pi^2}8(x-1)^2$ (green) follows the curvature near $x=1$."},
    {"id": "G2.1", "topic": "T2", "title": "$\\log(2x+y+1)$ as a function of $t=2x+y$", "stars": 2, "srcs": ["S008·5", "S008·6"], "flags": [ADD],
     "howto": "The function depends only on $t=2x+y$, so its Maclaurin polynomials are $t$, $t-\\frac{t^2}2$ and $t-\\frac{t^2}2+\\frac{t^3}3$. Each "
              "extra degree follows $\\log(1+t)$ (blue) further from $t=0$; all fail as $t\\to-1$, where the logarithm blows up."},
    {"id": "G3.1", "topic": "T3", "title": "Approximating $\\tan^{-1}(xy)$ at $(0.9,-1.2)$", "stars": 2, "srcs": ["S008·7", "S008·9", "T008 00:14:18"], "flags": [ADD],
     "howto": "Values along the straight line from $(1,-1)$ (black dot, $s=0$) through $(0.9,-1.2)$ ($s=1$, grey dashed line). At $s=1$ the "
              "first-degree polynomial (vermilion) gives $-0.835$, while the function (blue) is $-0.824$; the second degree (green) is "
              "almost on the curve there."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "Solving a Taylor or Maclaurin expansion problem", "stars": 3, "srcs": ["T008 00:00:21", "T008 00:02:07", "T008 00:05:19"],
     "layout": "straight", "maxw": "128mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$f(x,y)$, point, degree", "sub": "“in powers of $(x-a)$, $(y-b)$”, “about the origin”, “up to $n$ terms”"},
         {"kind": "step", "n": 1, "title": "Write the general series", "fx": "$f+\\{hf_x+kf_y\\}+\\frac1{2!}\\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\\}+\\dots$"},
         {"kind": "step", "n": 2, "title": "Partial derivatives in general", "fx": "$f_x,\\ f_y,\\ f_{xx},\\ f_{xy},\\ f_{yy}\\ (,\\ f_{xxx},\\dots)$"},
         {"kind": "step", "n": 3, "title": "Values at the point", "fx": "look for a common factor ($\\frac e{\\sqrt2}$)"},
         {"kind": "step", "n": 4, "title": "Substitute and simplify", "fx": "collect by degree"},
         {"kind": "result", "title": "Check", "fx": "one-combination series, or a numerical spot check"}]},
     "remark": "For “up to three terms”, stop at three non-zero terms; for “third degree”, include the $\\frac1{3!}$ bracket."},
    {"id": "F3.1", "topic": "T3", "title": "Approximate value from a Taylor polynomial", "stars": 2, "srcs": ["S008·7", "S008·9", "T008 00:12:10"],
     "layout": "straight", "maxw": "120mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "Find $f(0.9,-1.2)$, $f=\\tan^{-1}(xy)$"},
         {"kind": "step", "n": 1, "title": "Nearby easy point", "fx": "$(a,b)=(1,-1)$, $f=-\\frac\\pi4$"},
         {"kind": "step", "n": 2, "title": "Expand about it", "fx": "$-\\frac\\pi4-\\frac12h+\\frac12k+\\frac14(h^2+k^2)$"},
         {"kind": "step", "n": 3, "title": "Increments with signs", "fx": "$h=-0.1$, $k=-0.2$"},
         {"kind": "result", "title": "Value", "fx": "$\\approx-0.835$ (1st order), $-0.823$ (2nd order)"}]},
     "remark": "Exact value $-0.8238$: the second-order term is worth keeping."},
]

COMPARISONS = [
    {"id": "C2.1", "topic": "T2", "title": "Quick checks with a one-variable series", "flags": [ADD], "srcs": ["S008·6", "S008·11", "ESA Jan-24 s1 1b", "ESA Jun-24 1c"],
     "head": ["Function", "Combination $t$", "One-variable series", "Problem"],
     "rows": [["$\\log(2x+y+1)$", "$2x+y$", "$t-\\frac{t^2}2+\\frac{t^3}3-\\dots$", "W2.1"],
              ["$e^{x-y}$", "$x-y$", "$1+t+\\frac{t^2}2+\\frac{t^3}6+\\dots$", "W2.2"],
              ["$\\log(1+x-y)$", "$x-y$", "$t-\\frac{t^2}2+\\frac{t^3}3-\\dots$", "W2.4"],
              ["$\\sin(x+2y)$", "$x+2y$", "$t-\\frac{t^3}6+\\dots$", "W2.6"],
              ["$e^x\\log(1+y)$, $e^{ax}\\sin by$", "product", "multiply the two series, keep degree $\\le3$", "W2.3, W2.5"]]},
]

SYMBOLS = [
    {"sym": "$(a,b)$", "name": "Expansion point", "meaning": "$(1,\\frac\\pi4)$, $(1,\\frac\\pi2)$, $(1,1)$, $(1,-1)$ or $(0,0)$ in class 008", "where": "E1.1"},
    {"sym": "$h,\\ k$", "name": "Increments", "meaning": "$h=x-a$, $k=y-b$ (shorthand added for clarity)", "where": "E1.1, E3.1"},
    {"sym": "$f_x,\\dots,f_{yy}$", "name": "Partial derivatives", "meaning": "Evaluated at the expansion point", "where": "E1.1, E2.1"},
    {"sym": "$f_{xxx},\\dots,f_{yyy}$", "name": "Third partials", "meaning": "Coefficients 1, 3, 3, 1", "where": "E1.2"},
    {"sym": "$t$", "name": "Combination", "meaning": "$2x+y$, $x-y$, $x+2y$ in the one-variable check", "where": "E2.2"},
    {"sym": "$s$", "name": "Step along a line", "meaning": "Figure G3.1's parameter only", "where": "G3.1"},
    {"sym": "$a,\\ b$ (in $e^{ax}\\sin by$)", "name": "Constants", "meaning": "Not the expansion point here (it is the origin)", "where": "W2.5"},
]

KEYWORDS = [
    {"term": "Taylor's series about (a, b)", "meaning": "E1.1.", "topic": "T1"},
    {"term": "In powers of (x − a), (y − b)", "meaning": "About the point $(a,b)$.", "topic": "T1"},
    {"term": "Up to n-th degree", "meaning": "Keep all terms of total degree $\\le n$.", "topic": "T1"},
    {"term": "Third-order partials", "meaning": "Needed for third-degree terms.", "topic": "T1"},
    {"term": "Common factor", "meaning": "$\\frac e{\\sqrt2}$ in $e^x\\cos y$ at $(1,\\frac\\pi4)$.", "topic": "T1"},
    {"term": "Vanishing derivatives", "meaning": "$\\sin(xy)$ at $(1,\\frac\\pi2)$ has $f_x=f_y=0$.", "topic": "T1"},
    {"term": "Maclaurin's series", "meaning": "About the origin.", "topic": "T2"},
    {"term": "Up to three terms", "meaning": "Three non-zero terms.", "topic": "T2"},
    {"term": "One-combination check", "meaning": "$f=g(px+qy)$: use $g$'s series.", "topic": "T2"},
    {"term": "Product of series", "meaning": "$e^x\\log(1+y)$, $e^{ax}\\sin by$.", "topic": "T2"},
    {"term": "Approximate value", "meaning": "Truncated series at a nearby point.", "topic": "T3"},
    {"term": "Expansion point choice", "meaning": "Near the target, with exact values.", "topic": "T3"},
    {"term": "Increment signs", "meaning": "$h=0.9-1=-0.1$.", "topic": "T3"},
    {"term": "Order of accuracy", "meaning": "More terms, smaller error.", "topic": "T3"},
]

RAPID = [
    {"q": "“In powers of $(x-1)$ and $(y-\\frac\\pi4)$” means?", "a": "About $(1,\\frac\\pi4)$."},
    {"q": "$e^x\\cos y$ derivatives at $(1,\\frac\\pi4)$?", "a": "All $\\pm\\frac e{\\sqrt2}$."},
    {"q": "$e^x\\cos y$ to second degree?", "a": "$\\frac e{\\sqrt2}[1+h-k+\\frac12(h^2-2hk-k^2)]$."},
    {"q": "$\\log(2x+y+1)$, three terms?", "a": "$2x+y-2x^2-2xy-\\frac{y^2}2$."},
    {"q": "“Up to three terms” means?", "a": "Three non-zero terms."},
    {"q": "$\\tan^{-1}(xy)$ about $(1,-1)$?", "a": "$-\\frac\\pi4-\\frac12h+\\frac12k+\\frac14(h^2+k^2)$."},
    {"q": "$\\tan^{-1}(0.9\\times(-1.2))$ to first order?", "a": "$-\\frac\\pi4-0.05=-0.835$."},
    {"q": "… to second order?", "a": "$-0.823$ (exact $-0.824$)."},
    {"q": "$e^{x-y}$ about the origin?", "a": "$1+(x-y)+\\frac{(x-y)^2}2+\\frac{(x-y)^3}6$."},
    {"q": "$f_{xy}(0,0)$ for $e^x\\log(1+y)$?", "a": "1 (the slide prints 0)."},
    {"q": "First six terms of $e^x\\log(1+y)$?", "a": "$y+xy-\\frac{y^2}2+\\frac{x^2y}2-\\frac{xy^2}2+\\frac{y^3}3$."},
    {"q": "$\\sin(xy)$ about $(1,\\frac\\pi2)$?", "a": "$1-\\frac{\\pi^2}8h^2-\\frac\\pi2hk-\\frac12k^2$."},
    {"q": "$f_{yy}(1,1)$ for $xy^2+y\\cos(x-y)$?", "a": "1 (the slide prints 3)."},
    {"q": "$xy^2+y\\cos(x-y)$ about $(1,1)$?", "a": "$2+h+3k+\\frac12(-h^2+6hk+k^2)$."},
    {"q": "$\\sin x\\sin y$ about $(\\frac\\pi4,\\frac\\pi4)$, third degree?", "a": "$\\frac12+\\frac12(h+k)-\\frac14(h-k)^2-\\frac1{12}(h+k)^3$."},
    {"q": "$\\log(1+x-y)$ to third degree?", "a": "$(x-y)-\\frac{(x-y)^2}2+\\frac{(x-y)^3}3$."},
    {"q": "$e^{ax}\\sin by$ to third degree?", "a": "$by+abxy+\\frac{a^2b}2x^2y-\\frac{b^3}6y^3$."},
    {"q": "$\\sin(x+2y)$ to third degree?", "a": "$(x+2y)-\\frac{(x+2y)^3}6$."},
    {"q": "$\\tan^{-1}\\frac{0.9}{1.1}$ by Taylor?", "a": "$\\approx0.6854$."},
]

MNEMONICS = [
    "<i>“Series, table, values, substitute, check.”</i> The five steps of every class 008 problem (Figure F1.1).",
]

TOP_FACTS = [
    "Method: general series → derivative table → values at the point → substitute → check.",
    "$h=x-a$, $k=y-b$; second order $\\frac1{2!}\\{h^2f_{xx}+2hkf_{xy}+k^2f_{yy}\\}$; third order $\\frac1{3!}\\{h^3f_{xxx}+3h^2kf_{xxy}+3hk^2f_{xyy}+k^3f_{yyy}\\}$.",
    "$e^x\\cos y$ at $(1,\\frac\\pi4)$: $\\frac e{\\sqrt2}[1+h-k+\\frac12(h^2-2hk-k^2)]$ (ESA May 2024).",
    "Functions of one combination ($2x+y$, $x-y$, $x+2y$): use the one-variable series.",
    "Slide errors: $f_{yy}(1,1)=1$ (not 3) for $xy^2+y\\cos(x-y)$; $f_{xy}(0,0)=1$ (not 0) for $e^x\\log(1+y)$.",
    "Approximation: expand about a nearby easy point; keep second order ($-0.823$ vs exact $-0.824$).",
    "ESA: $\\sin x\\sin y$ about $(\\frac\\pi4,\\frac\\pi4)$ (2nd and 3rd degree), $e^x\\cos y$, $\\log(1+x-y)$, $e^{ax}\\sin by$, $\\sin(x+2y)$.",
]
TOP_FORMULAS = ["E1.1", "E1.2", "E2.1", "E2.2", "E3.1"]
