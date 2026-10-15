"""Class 010: Problems on maxima and minima for a function of two variables."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "The method, and the ESA cubic functions",
     "overview": "Every problem follows one routine: find $f_x$ and $f_y$, solve $f_x=f_y=0$ for the stationary points (factorise "
                 "one equation and split into cases), compute $r=f_{xx}$, $s=f_{xy}$, $t=f_{yy}$, and classify each point by "
                 "$rt-s^2$ and $r$. Both ESA functions are cubics with four stationary points: one maximum, one minimum and two "
                 "saddle points. Always finish by substituting each extremum into $f$ for the value."},
    {"id": "T2", "title": "Functions with many stationary points",
     "overview": "The slides test two more functions. $x^4+y^4-x^2-y^2+1$ has nine stationary points (a maximum at the origin, "
                 "four minima and four saddle points). $\\sin x+\\sin y+\\sin(x+y)$ needs trigonometric equations: subtracting the "
                 "two conditions gives $x=y$, then $\\cos2x=-\\cos x$ gives $x=\\frac\\pi3$, a maximum $\\frac{3\\sqrt3}2$."},
    {"id": "T3", "title": "Applied problems: eliminate one variable first",
     "overview": "When the quantity depends on three variables tied by a condition (a sphere, a fixed volume), use the condition "
                 "to eliminate one variable, then apply the two-variable method. The temperature $400xyz^2$ on the unit sphere "
                 "is highest, 50, at $(\\pm\\frac12,\\pm\\frac12)$ with equal signs. An open box of volume 10 m³ uses least metal "
                 "when the base is $\\sqrt[3]{20}$ square and the height half of that. Class 011 does such problems without eliminating."},
]

DEFS = [
    {"topic": "T1", "term": "Stationary (critical) points", "text": "The solutions of $f_x=0$, $f_y=0$, solved simultaneously; the points "
     "at which the function may have an extreme value.", "srcs": ["S010·7", "T010a 00:04:13", "T010b 00:01:23"]},
    {"topic": "T1", "term": "Maximum / minimum value", "text": "The value $f(a,b)$ at a point of maximum or minimum, obtained by "
     "substituting the point into $f$.", "srcs": ["S010·8", "T010b 00:04:02"]},
    {"topic": "T3", "term": "Elimination", "text": "Using the given condition (constraint) to express one variable in terms of the others, "
     "so that the quantity becomes a function of two independent variables.", "srcs": ["T010a 00:00:40", "T010a 00:08:27"]},
]

STATEMENTS = [
    {"topic": "T1", "text": "If $rt-s^2>0$ and $r<0$ at $(a,b)$, $f(a,b)$ is a maximum value; if $rt-s^2>0$ and $r>0$, a minimum value; "
     "if $rt-s^2<0$, $f(a,b)$ is not an extreme value, i.e. $(a,b)$ is a saddle point; if $rt-s^2=0$ the case is doubtful and needs "
     "further investigation (class 009, restated).", "srcs": ["S010·8", "T010b 00:05:00"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Stationary points", "tex": r"f_x=0,\qquad f_y=0\quad(\text{solve simultaneously})",
     "gives": "All candidate points.", "when": "Every problem, first step.",
     "note": "Factorise: $6xy-30y=6y(x-5)=0$ gives the cases $y=0$ or $x=5$.", "stars": 3, "srcs": ["S010·7", "T010b 00:01:23", "T010b 00:01:40"]},
    {"id": "E1.2", "topic": "T1", "title": "The test", "tex": r"\begin{gathered}r=f_{xx},\quad s=f_{xy},\quad t=f_{yy}\\ rt-s^2>0:\ r<0\ \text{max},\ r>0\ \text{min};\qquad rt-s^2<0:\ \text{saddle};\qquad rt-s^2=0:\ \text{doubtful}\end{gathered}",
     "gives": "The nature of each stationary point.", "when": "At each point separately.", "note": "Restated from class 009.",
     "stars": 3, "srcs": ["S010·8", "T010b 00:03:12", "T010b 00:04:02"]},
    {"id": "E1.3", "topic": "T1", "title": "Hessian of the ESA cubic", "tex": r"f=x^3+3xy^2-15x^2-15y^2+72x:\qquad rt-s^2=36\big[(x-5)^2-y^2\big]",
     "gives": "$rt-s^2$ at every point at once.", "when": "Dec-23 1c, Jan-24 s1 1a.",
     "note": "$r=t=6x-30$, $s=6y$. Slide 010·8 drops the 36 on $y^2$.", "stars": 3, "srcs": ["S010·8", "T010b 00:03:30"]},
    {"id": "E3.1", "topic": "T3", "title": "Eliminating with a sphere", "tex": r"x^2+y^2+z^2=a^2\ \Rightarrow\ z^2=a^2-x^2-y^2,\qquad T=kxyz^2=kxy(a^2-x^2-y^2)",
     "gives": "A function of $x,y$ only.", "when": "Quantity contains $z^2$ and the point lies on a sphere.",
     "note": "Unit sphere: $a=1$.", "stars": 2, "srcs": ["S010·3", "S010·9", "T010a 00:01:00"]},
    {"id": "E3.2", "topic": "T3", "title": "Open box of volume V", "tex": r"A=xy+2yz+2zx,\quad xyz=V\ \Rightarrow\ A=xy+\frac{2V}{x}+\frac{2V}{y}",
     "gives": "Surface area (metal used) of a box with no top, base $x\\times y$.", "when": "Least material for a given volume.",
     "note": "Minimum at $x=y=\\sqrt[3]{2V}$, $z=\\frac x2$ (CW P34). The slide's $A=2xy+2yz+zx$ is not the area of an open box.",
     "stars": 2, "srcs": ["S010·5", "CW U1 P34"], "flags": [ADD]},
]

POINTS = [
    {"topic": "T1", "text": "Procedure (lecture): find $p=f_x$, $q=f_y$; equate both to zero; find the critical points; compute $r$, $s$, $t$; "
     "evaluate $rt-s^2$ at each critical point; conclude.", "stars": 3, "srcs": ["T010b 00:05:00", "T010b 00:05:16"]},
    {"topic": "T1", "text": "Split $f_y=0$ into cases and substitute each into $f_x=0$: for the ESA cubic, $y=0$ gives $x=4,6$ and $x=5$ gives $y=\\pm1$.",
     "stars": 3, "srcs": ["S010·7", "S010·8", "T010b 00:01:40"]},
    {"topic": "T1", "text": "Count the stationary points before classifying; a cubic in $x$ and $y$ typically gives four, a quartic up to nine.",
     "stars": 2, "srcs": ["S010·8", "S010·11"], "flags": [ADD]},
    {"topic": "T1", "text": "A saddle point has no value to report; give the maximum and minimum values only.", "stars": 2, "srcs": ["S010·8"]},
    {"topic": "T1", "text": "When $rt-s^2>0$, $r$ and $t$ have the same sign, so either decides between maximum and minimum.", "stars": 1, "srcs": ["S010·8"], "flags": [ADD]},
    {"topic": "T2", "text": "Separable functions such as $x^4+y^4-x^2-y^2+1$ give $f_x$ in $x$ only and $f_y$ in $y$ only: combine every root of one with every root of the other.",
     "stars": 2, "srcs": ["S010·11", "T010b 00:08:29"]},
    {"topic": "T2", "text": "For $\\sin x+\\sin y+\\sin(x+y)$, subtract the two conditions to get $\\cos x=\\cos y$, i.e. $x=y$ in the working range; then "
     "$\\cos2x=-\\cos x=\\cos(\\pi-x)$ gives $x=\\frac\\pi3$.", "stars": 2, "srcs": ["S010·13", "T010b 00:10:23"]},
    {"topic": "T3", "text": "We cannot yet find extrema of a function of three variables, so use the constraint to eliminate one (here $z^2$ or $z$).",
     "stars": 2, "srcs": ["T010a 00:00:40", "T010a 00:08:27"]},
    {"topic": "T3", "text": "A product such as $kxyz^2$ is largest when $x$ and $y$ have the same sign and $k>0$; points with $x$, $y$ of opposite signs give the lowest temperature.",
     "stars": 2, "srcs": ["S010·10", "T010b 00:05:40"]},
    {"topic": "T3", "text": "Reject stationary points that make no physical sense (an edge $y=0$ in the box problem makes $x\\to\\infty$).", "stars": 1, "srcs": ["T010a 00:13:07", "T010a 00:13:48"]},
    {"topic": "T3", "text": "Elimination is not always easy; class 011's Lagrange multipliers avoid it (T010a 00:16:49).", "stars": 1, "srcs": ["T010a 00:16:49"]},
]

WHY = [
    {"topic": "T1", "q": "Why does $f_y=6y(x-5)=0$ give two separate cases?",
     "a": "A product is zero when either factor is zero: $y=0$ or $x=5$. Each case is substituted into $f_x=0$ to find its own points; "
          "missing a case loses stationary points.", "srcs": ["S010·7", "T010b 00:01:40"], "flags": [ADD]},
    {"topic": "T3", "q": "Why is a cube the wrong answer for an open box?",
     "a": "Without a top the base is used once and each side face twice in the area, so the box should be lower and wider: "
          "$x=y=\\sqrt[3]{20}$, $z=\\frac12\\sqrt[3]{20}$. The cube $x=y=z=\\sqrt[3]{V}$ minimises the area of a closed box $2(xy+yz+zx)$.",
     "srcs": ["S010·6", "CW U1 P34"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T1", "text": "Slide 010·8 says the maximum value is at $(6,0)$; the maximum 112 is at $(4,0)$, the minimum 108 at $(6,0)$.", "srcs": ["S010·8", "T010b 00:04:42"]},
    {"topic": "T1", "text": "$rt-s^2=36(x-5)^2-36y^2$: the 36 multiplies $y^2$ too (slide 010·8 drops it).", "srcs": ["S010·8"], "flags": [ADD]},
    {"topic": "T2", "text": "When $rt-s^2<0$ the sign of $r$ is irrelevant; at $(\\pm\\frac1{\\sqrt2},0)$, $r=4$ (not $-2$ as slide 010·12 says), and the point is still a saddle.",
     "srcs": ["S010·12", "T010b 00:09:26"], "flags": [ADD]},
    {"topic": "T2", "text": "At $(\\frac\\pi3,\\frac\\pi3)$, $s=-\\frac{\\sqrt3}2$, so $rt-s^2=3-\\frac34=\\frac94$ (slide 010·14 prints $\\frac34$).", "srcs": ["S010·14"], "flags": [ADD]},
    {"topic": "T3", "text": "$400xy(1-x^2-y^2)$ also has stationary points $(\\pm1,0)$, $(0,\\pm1)$ (saddles) that the slides omit; and slide 010·4's "
     "$rt-s^2$ values are $-160000$ and $320000$, not $-1600$ and $356000$.", "srcs": ["S010·3", "S010·4"], "flags": [ADD]},
    {"topic": "T3", "text": "Open box: area $xy+2yz+2zx$ (one base, four sides). The slide's $2xy+2yz+zx$ and its derivative slip lead to a cube, which is wrong.",
     "srcs": ["S010·5", "S010·6", "T010a 00:07:38"], "flags": [ADD]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "Extreme values of $x^3+3xy^2-15x^2-15y^2+72x$", "srcs": ["S010·7", "S010·8", "T010b 00:00:23", "ESA Dec-23 1c", "ESA Jan-24 s1 1a", "CW U1 P32"], "stars": 3,
     "given": "Find the extreme values (locate the stationary points and discuss their nature) of $f(x,y)=x^3+3xy^2-15x^2-15y^2+72x$.",
     "steps": ["$f_x=3x^2+3y^2-30x+72$, $f_y=6xy-30y=6y(x-5)$.",
               "$f_y=0$: $y=0$ or $x=5$. If $y=0$: $3x^2-30x+72=0$, $x^2-10x+24=0$, $x=4$ or $6$. If $x=5$: $75+3y^2-150+72=0$, $y^2=1$, $y=\\pm1$.",
               "Stationary points: $(4,0)$, $(6,0)$, $(5,1)$, $(5,-1)$.",
               "$r=6x-30$, $s=6y$, $t=6x-30$, so $rt-s^2=36[(x-5)^2-y^2]$.",
               "$(4,0)$: $r=-6$, $rt-s^2=36>0$: maximum, $f=64-240+288=112$.",
               "$(6,0)$: $r=6$, $rt-s^2=36>0$: minimum, $f=216-540+432=108$.",
               "$(5,\\pm1)$: $r=0$, $s=\\pm6$, $rt-s^2=-36<0$: saddle points."],
     "answer": "Maximum $112$ at $(4,0)$; minimum $108$ at $(6,0)$; $(5,1)$ and $(5,-1)$ are saddle points",
     "check": "CW P32 answer agrees; sympy finds the same four points and values. Slide 010·8's “maximum … at $(6,0)$” is a slip for $(4,0)$."},
    {"id": "W1.2", "topic": "T1", "title": "Stationary points of $x^3-12x+y^3+3y^2-9y$", "srcs": ["ESA Jan-24 s2 1a", "CW U1 P29"], "stars": 3,
     "given": "Locate the stationary points of $f(x,y)=x^3-12x+y^3+3y^2-9y$ and discuss their nature.",
     "steps": ["$f_x=3x^2-12=0\\Rightarrow x=\\pm2$; $f_y=3y^2+6y-9=3(y+3)(y-1)=0\\Rightarrow y=1,-3$.",
               "Stationary points: $(2,1)$, $(2,-3)$, $(-2,1)$, $(-2,-3)$.",
               "$r=6x$, $s=0$, $t=6y+6$; $rt-s^2=36x(y+1)$.",
               "$(2,1)$: $r=12$, $rt-s^2=144>0$: minimum, $f=8-24+1+3-9=-21$.",
               "$(-2,-3)$: $r=-12$, $rt-s^2=144>0$: maximum, $f=-8+24-27+27+27=43$.",
               "$(2,-3)$ and $(-2,1)$: $rt-s^2=-144<0$: saddle points."],
     "answer": "Maximum $43$ at $(-2,-3)$; minimum $-21$ at $(2,1)$; $(2,-3)$ and $(-2,1)$ are saddle points",
     "check": "CW P29 answer agrees; sympy agrees."},
    {"id": "W2.1", "topic": "T2", "title": "$x^4+y^4-x^2-y^2+1$: nine stationary points", "srcs": ["S010·11", "S010·12", "T010b 00:08:12"], "stars": 2,
     "given": "Test $f(x,y)=x^4+y^4-x^2-y^2+1$ for maxima, minima and saddle points.",
     "steps": ["$f_x=4x^3-2x=2x(2x^2-1)=0\\Rightarrow x=0,\\pm\\frac1{\\sqrt2}$; likewise $y=0,\\pm\\frac1{\\sqrt2}$: nine points.",
               "$r=12x^2-2$, $s=0$, $t=12y^2-2$.",
               "$(0,0)$: $r=t=-2$, $rt-s^2=4>0$, $r<0$: maximum $f=1$.",
               "$(\\pm\\frac1{\\sqrt2},\\pm\\frac1{\\sqrt2})$: $r=t=4$, $rt-s^2=16>0$: minima, $f=\\frac14+\\frac14-\\frac12-\\frac12+1=\\frac12$.",
               "$(\\pm\\frac1{\\sqrt2},0)$: $r=4$, $t=-2$; $(0,\\pm\\frac1{\\sqrt2})$: $r=-2$, $t=4$; both $rt-s^2=-8<0$: saddle points."],
     "answer": "Maximum $1$ at $(0,0)$; minimum $\\frac12$ at the four points $(\\pm\\frac1{\\sqrt2},\\pm\\frac1{\\sqrt2})$; four saddle points on the axes",
     "check": "sympy agrees (saddle values $\\frac34$)."},
    {"id": "W2.2", "topic": "T2", "title": "$\\sin x+\\sin y+\\sin(x+y)$", "srcs": ["S010·13", "S010·14", "T010b 00:09:50"], "stars": 2,
     "given": "Test $f(x,y)=\\sin x+\\sin y+\\sin(x+y)$ for maxima, minima and saddle points ($0<x,y<\\pi$).",
     "steps": ["$f_x=\\cos x+\\cos(x+y)=0$ (1), $f_y=\\cos y+\\cos(x+y)=0$ (2).",
               "(1) − (2): $\\cos x=\\cos y$, so $x=y$. Then (1): $\\cos2x=-\\cos x=\\cos(\\pi-x)$, $2x=\\pi-x$, $x=\\frac\\pi3$.",
               "$r=-\\sin x-\\sin(x+y)$, $s=-\\sin(x+y)$, $t=-\\sin y-\\sin(x+y)$.",
               "At $(\\frac\\pi3,\\frac\\pi3)$: $r=t=-\\sqrt3$, $s=-\\frac{\\sqrt3}2$, $rt-s^2=3-\\frac34=\\frac94>0$, $r<0$: maximum.",
               "$f=\\frac{\\sqrt3}2+\\frac{\\sqrt3}2+\\frac{\\sqrt3}2=\\frac{3\\sqrt3}2$."],
     "answer": "Maximum $\\dfrac{3\\sqrt3}{2}$ at $\\big(\\frac\\pi3,\\frac\\pi3\\big)$",
     "check": "sympy: $rt-s^2=\\frac94$ (slide 010·14 prints $\\frac34$); the conclusion is the same."},
    {"id": "W3.1", "topic": "T3", "title": "Highest temperature $400xyz^2$ on the unit sphere", "srcs": ["S010·3", "S010·4", "T010a 00:00:00", "T010a 00:06:33", "ESA Jun-24 1d"], "stars": 3,
     "given": "The temperature at $(x,y,z)$ is $T=400xyz^2$. Find the highest temperature on the surface of the unit sphere $x^2+y^2+z^2=1$.",
     "steps": ["Eliminate $z^2=1-x^2-y^2$: $f(x,y)=400xy(1-x^2-y^2)=400(xy-x^3y-xy^3)$.",
               "$f_x=400y(1-3x^2-y^2)=0$, $f_y=400x(1-x^2-3y^2)=0$.",
               "Both brackets zero: subtracting gives $x^2=y^2$, then $4x^2=1$: $(\\pm\\frac12,\\pm\\frac12)$. Also $(0,0)$, $(\\pm1,0)$, $(0,\\pm1)$.",
               "$r=-2400xy$, $s=400(1-3x^2-3y^2)$, $t=-2400xy$.",
               "$(\\frac12,\\frac12)$, $(-\\frac12,-\\frac12)$: $r=-600$, $s=-200$, $rt-s^2=320000>0$, $r<0$: maxima, $T=400\\cdot\\frac14\\cdot\\frac12=50$.",
               "$(0,0)$: $rt-s^2=-160000<0$; $(\\pm1,0)$, $(0,\\pm1)$: $-640000<0$: saddles. Opposite signs: minima, $T=-50$."],
     "answer": "Highest temperature $50$, at $x=y=\\pm\\frac12$, $z=\\pm\\frac1{\\sqrt2}$",
     "check": "sympy agrees. ESA June 2024 Q1.d asks this by Lagrange's method (class 011 pack) and gets the same 50."},
    {"id": "W3.2", "topic": "T3", "title": "Highest temperature $kxyz^2$ on a sphere of radius $a$", "srcs": ["S010·9", "S010·10", "T010b 00:05:25"], "stars": 2,
     "given": "$T=kxyz^2$ ($k>0$). Find the highest temperature on $x^2+y^2+z^2=a^2$.",
     "steps": ["$T=kxy(a^2-x^2-y^2)$; $T_x=ky(a^2-3x^2-y^2)$, $T_y=kx(a^2-x^2-3y^2)$.",
               "Stationary points: $(0,0)$ and $(\\pm\\frac a2,\\pm\\frac a2)$ (also $(\\pm a,0)$, $(0,\\pm a)$, saddles).",
               "$r=-6kxy$, $s=k(a^2-3x^2-3y^2)$, $t=-6kxy$.",
               "$(0,0)$: $r=0$, $rt-s^2=-k^2a^4<0$: saddle.",
               "$(\\frac a2,\\frac a2)$, $(-\\frac a2,-\\frac a2)$: $r=-\\frac{6ka^2}4<0$, $s=-\\frac{ka^2}2$, $rt-s^2=\\frac{9k^2a^4}4-\\frac{k^2a^4}4=2k^2a^4>0$: maximum."],
     "answer": "$T_{\\max}=k\\cdot\\dfrac a2\\cdot\\dfrac a2\\cdot\\dfrac{a^2}2=\\dfrac{ka^4}{8}$",
     "check": "With $k=400$, $a=1$: $50$, as in W3.1; sympy agrees."},
    {"id": "W3.3", "topic": "T3", "title": "Open box of 10 m³ with least metal", "srcs": ["S010·5", "S010·6", "T010a 00:07:06", "CW U1 P34"], "stars": 2, "flags": [ADD],
     "given": "A container with an open top is to have 10 m³ capacity and be made of thin sheet metal. Find the dimensions that use the least metal.",
     "steps": ["Base $x\\times y$, height $z$: $A=xy+2yz+2zx$, $xyz=10$, so $A=xy+\\frac{20}x+\\frac{20}y$.",
               "$A_x=y-\\frac{20}{x^2}=0$, $A_y=x-\\frac{20}{y^2}=0$; then $x^2y=xy^2=20$, so $x=y$ and $x^3=20$: $x=y=\\sqrt[3]{20}$.",
               "$z=\\frac{10}{xy}=\\frac{10}{20^{2/3}}=\\frac12\\sqrt[3]{20}$.",
               "$A_{xx}=\\frac{40}{x^3}=2$, $A_{xy}=1$, $A_{yy}=\\frac{40}{y^3}=2$: $rt-s^2=3>0$, $r>0$: minimum."],
     "answer": "$x=y=\\sqrt[3]{20}\\approx2.71$ m, height $z=\\tfrac12\\sqrt[3]{20}\\approx1.36$ m; least area $3\\cdot20^{2/3}\\approx22.10$ m²",
     "check": "Matches CW P34 ($x=y=(2V)^{1/3}$, $z=x/2$); sympy agrees. The slide's cube of side $\\sqrt[3]{10}$ needs $23.21$ m², more metal."},
]

PYQS = [
    {"topic": "T1", "paper": "ESA Dec 2023", "q": "UE22MA141A Q1.c", "marks": 7,
     "text": "Find the extreme values of the function $f(x,y)=x^3+3xy^2-15x^2-15y^2+72x$.", "worked": "W1.1"},
    {"topic": "T1", "paper": "ESA Jan 2024", "q": "UE23MA141A set 1, Q1.a", "marks": 7,
     "text": "Locate the stationary points of $f(x,y)=x^3+3xy^2-15x^2-15y^2+72x$. Discuss their nature.", "worked": "W1.1"},
    {"topic": "T1", "paper": "ESA Jan 2024", "q": "UE23MA141A set 2, Q1.a", "marks": 7,
     "text": "Locate the stationary points of $f(x,y)=x^3-12x+y^3+3y^2-9y$. Discuss their nature.", "worked": "W1.2"},
    {"topic": "T3", "paper": "ESA June 2024", "q": "UE23MA141A Q1.d", "marks": 7,
     "text": "The temperature $T$ at any point $(x,y,z)$ in space is $400xyz^2$. Using Lagrange's method of multipliers, find the highest "
             "temperature on the surface of the unit sphere $x^2+y^2+z^2=1$. (Asked by Lagrange's method; W3.1 checks the answer by elimination.)", "worked": "W3.1"},
]

NOTES = [
    {"topic": "T1", "text": "$f_x=0$, $f_y=0$ → split into cases → stationary points → $r,s,t$ → $rt-s^2$ and $r$ → values. ESA: "
     "$x^3+3xy^2-15x^2-15y^2+72x$: max 112 at $(4,0)$, min 108 at $(6,0)$, saddles $(5,\\pm1)$. $x^3-12x+y^3+3y^2-9y$: max 43 at "
     "$(-2,-3)$, min $-21$ at $(2,1)$, saddles $(2,-3)$, $(-2,1)$."},
    {"topic": "T2", "text": "$x^4+y^4-x^2-y^2+1$: max 1 at $(0,0)$, min $\\frac12$ at $(\\pm\\frac1{\\sqrt2},\\pm\\frac1{\\sqrt2})$, four saddles on the axes. "
     "$\\sin x+\\sin y+\\sin(x+y)$: $x=y=\\frac\\pi3$, max $\\frac{3\\sqrt3}2$."},
    {"topic": "T3", "text": "Eliminate with the condition, then use the two-variable test. $400xyz^2$ on the unit sphere: max 50 at "
     "$(\\pm\\frac12,\\pm\\frac12)$ (same signs); $kxyz^2$ on radius $a$: $\\frac{ka^4}8$. Open box, volume $V$: $A=xy+\\frac{2V}x+\\frac{2V}y$, "
     "$x=y=\\sqrt[3]{2V}$, $z=\\frac x2$."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "Level curves of $x^3+3xy^2-15x^2-15y^2+72x$", "stars": 3, "srcs": ["S010·8", "ESA Dec-23 1c", "ESA Jan-24 s1 1a"], "flags": [ADD], "tall": True,
     "howto": "Grey lines are level curves $f=$ constant. Around the maximum $(4,0)$ and the minimum $(6,0)$ they close into small "
              "loops; at the saddle points $(5,\\pm1)$ two level curves cross, the sign of the picture of a saddle."},
    {"id": "G1.2", "topic": "T1", "title": "Level curves of $x^3-12x+y^3+3y^2-9y$", "stars": 3, "srcs": ["ESA Jan-24 s2 1a", "CW U1 P29"], "flags": [ADD], "tall": True,
     "howto": "The four stationary points sit at the corners of a rectangle, $x=\\pm2$, $y=1,-3$. Closed loops surround the maximum "
              "$(-2,-3)$ and the minimum $(2,1)$; curves cross at the saddles $(2,-3)$ and $(-2,1)$."},
    {"id": "G2.1", "topic": "T2", "title": "Level curves of $x^4+y^4-x^2-y^2+1$", "stars": 2, "srcs": ["S010·11", "S010·12"], "flags": [ADD], "tall": True,
     "howto": "Nine stationary points on a $3\\times3$ grid: a maximum at the centre, minima at the four corners "
              "$(\\pm\\frac1{\\sqrt2},\\pm\\frac1{\\sqrt2})$ and saddles at the four edge midpoints on the axes."},
    {"id": "G3.1", "topic": "T3", "title": "Temperature $400xy(1-x^2-y^2)$ over the unit disk", "stars": 2, "srcs": ["S010·3", "S010·4"], "flags": [ADD], "tall": True,
     "howto": "Inside the unit circle (the projection of the sphere) the temperature is positive in the first and third quadrants and "
              "negative in the others. It peaks at $50$ at $(\\frac12,\\frac12)$ and $(-\\frac12,-\\frac12)$ and is lowest, $-50$, at "
              "the other two. The origin and $(\\pm1,0)$, $(0,\\pm1)$, where $T=0$, are saddles."},
    {"id": "G3.2", "topic": "T3", "title": "Metal used by an open box of 10 m³ with a square base", "stars": 1, "srcs": ["S010·6", "CW U1 P34"], "flags": [ADD],
     "howto": "Along $x=y$ the area is $A=x^2+\\frac{40}x$ (blue). Its minimum, $22.10$ m², is at $x=\\sqrt[3]{20}\\approx2.71$ m. "
              "The slide's cube, $x=\\sqrt[3]{10}\\approx2.15$ m, sits higher on the curve ($23.21$ m²)."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "Solving a maxima–minima problem", "stars": 3, "srcs": ["S010·7", "S010·8", "T010b 00:05:00"],
     "layout": "straight", "maxw": "130mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$f(x,y)$", "sub": "applied problem: eliminate one variable first (F3.1)"},
         {"kind": "step", "n": 1, "title": "First partials", "fx": "$f_x,\\ f_y$"},
         {"kind": "step", "n": 2, "title": "Solve $f_x=0$, $f_y=0$", "fx": "factorise, split into cases"},
         {"kind": "step", "n": 3, "title": "Second partials", "fx": "$r=f_{xx},\\ s=f_{xy},\\ t=f_{yy}$"},
         {"kind": "step", "n": 4, "title": "Table: each point", "fx": "$r,\\ rt-s^2$, nature"},
         {"kind": "result", "title": "Max and min values", "fx": "substitute the points into $f$"}]},
     "remark": "Write a table with one row per stationary point: point, $r$, $s$, $t$, $rt-s^2$, nature, value."},
    {"id": "F1.2", "topic": "T1", "title": "Classifying each stationary point", "stars": 3, "srcs": ["S010·8", "T010b 00:04:02"],
     "layout": "ladder", "maxw": "140mm",
     "spec": {"start": {"kind": "given", "title": "Stationary point $(a,b)$ with $r,\\ s,\\ t$"},
              "rungs": [{"q": "Is $rt-s^2<0$?", "yes": {"kind": "result", "title": "Saddle point", "sub": "e.g. $(5,\\pm1)$ in W1.1"}},
                        {"q": "Is $rt-s^2=0$?", "yes": {"kind": "result", "title": "Doubtful", "sub": "further investigation"}},
                        {"q": "Is $r<0$?", "yes": {"kind": "result", "title": "Maximum", "sub": "e.g. $(4,0)$: 112"}}],
              "last": {"kind": "result", "title": "Minimum", "sub": "e.g. $(6,0)$: 108"}}},
    {"id": "F3.1", "topic": "T3", "title": "Applied problem by elimination", "stars": 2, "srcs": ["S010·3", "S010·5", "T010a 00:00:40", "T010a 00:08:27"],
     "layout": "straight", "maxw": "130mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "Quantity $u(x,y,z)$ and a condition", "sub": "sphere $x^2+y^2+z^2=a^2$; volume $xyz=V$"},
         {"kind": "step", "n": 1, "title": "Solve the condition for one variable", "fx": "$z^2=a^2-x^2-y^2$ or $z=\\frac V{xy}$"},
         {"kind": "step", "n": 2, "title": "Substitute", "fx": "$f(x,y)=u(x,y,z(x,y))$"},
         {"kind": "step", "n": 3, "title": "Two-variable method", "fx": "F1.1 and F1.2"},
         {"kind": "check", "title": "Discard meaningless points", "sub": "zero edges, points off the surface"},
         {"kind": "result", "title": "Optimum and its value", "fx": "recover $z$ from the condition"}]},
     "remark": "Class 011 (Lagrange) solves the same problems without step 1."},
]

COMPARISONS = [
    {"id": "C1.1", "topic": "T1", "title": "Stationary points of the two ESA functions", "srcs": ["S010·8", "ESA Dec-23 1c", "ESA Jan-24 s2 1a"],
     "head": ["Function", "Point", "$r$", "$rt-s^2$", "Nature", "$f$"],
     "rows": [["$x^3+3xy^2-15x^2-15y^2+72x$", "$(4,0)$", "$-6$", "$36$", "Maximum", "$112$"],
              ["", "$(6,0)$", "$6$", "$36$", "Minimum", "$108$"],
              ["", "$(5,\\pm1)$", "$0$", "$-36$", "Saddle", "—"],
              ["$x^3-12x+y^3+3y^2-9y$", "$(-2,-3)$", "$-12$", "$144$", "Maximum", "$43$"],
              ["", "$(2,1)$", "$12$", "$144$", "Minimum", "$-21$"],
              ["", "$(2,-3)$, $(-2,1)$", "$\\pm12$", "$-144$", "Saddle", "—"]]},
]

SYMBOLS = [
    {"sym": "$p,\\ q$", "name": "First partials", "meaning": "$p=f_x$, $q=f_y$ (lecture T010b)", "where": "E1.1"},
    {"sym": "$r,\\ s,\\ t$", "name": "Second partials", "meaning": "$f_{xx}$, $f_{xy}$, $f_{yy}$ at a point", "where": "E1.2, E1.3"},
    {"sym": "$rt-s^2$", "name": "Hessian", "meaning": "Decides extremum or saddle", "where": "E1.2, E1.3"},
    {"sym": "$T$", "name": "Temperature", "meaning": "$400xyz^2$ or $kxyz^2$; not the second partial $t$", "where": "E3.1"},
    {"sym": "$k$", "name": "Constant", "meaning": "Positive constant in $T=kxyz^2$", "where": "E3.1"},
    {"sym": "$a$", "name": "Radius", "meaning": "Sphere $x^2+y^2+z^2=a^2$", "where": "E3.1"},
    {"sym": "$A$", "name": "Surface area", "meaning": "Metal used by the open box", "where": "E3.2"},
    {"sym": "$V$", "name": "Volume", "meaning": "Fixed capacity $xyz=V$ (10 m³)", "where": "E3.2"},
]

KEYWORDS = [
    {"term": "Stationary points", "meaning": "Solutions of $f_x=f_y=0$.", "topic": "T1"},
    {"term": "Case split", "meaning": "$6y(x-5)=0$: $y=0$ or $x=5$.", "topic": "T1"},
    {"term": "Extreme values", "meaning": "$f$ at the maxima and minima.", "topic": "T1"},
    {"term": "Saddle point", "meaning": "$rt-s^2<0$; no extreme value.", "topic": "T1"},
    {"term": "Separable function", "meaning": "$f_x$ in $x$ only, $f_y$ in $y$ only.", "topic": "T2"},
    {"term": "Trigonometric stationary points", "meaning": "Subtract the conditions: $\\cos x=\\cos y$.", "topic": "T2"},
    {"term": "Elimination", "meaning": "Use the constraint to remove one variable.", "topic": "T3"},
    {"term": "Highest temperature", "meaning": "$400xyz^2$ on the unit sphere: 50.", "topic": "T3"},
    {"term": "Open box", "meaning": "$A=xy+2yz+2zx$; $x=y=\\sqrt[3]{2V}$, $z=\\frac x2$.", "topic": "T3"},
]

RAPID = [
    {"q": "Stationary points of $x^3+3xy^2-15x^2-15y^2+72x$?", "a": "$(4,0)$, $(6,0)$, $(5,\\pm1)$."},
    {"q": "Its maximum and minimum?", "a": "Max 112 at $(4,0)$; min 108 at $(6,0)$."},
    {"q": "Its $rt-s^2$?", "a": "$36[(x-5)^2-y^2]$."},
    {"q": "Stationary points of $x^3-12x+y^3+3y^2-9y$?", "a": "$(\\pm2,1)$, $(\\pm2,-3)$."},
    {"q": "Its extreme values?", "a": "Max 43 at $(-2,-3)$; min $-21$ at $(2,1)$."},
    {"q": "$x^4+y^4-x^2-y^2+1$: max? min?", "a": "Max 1 at $(0,0)$; min $\\frac12$ at $(\\pm\\frac1{\\sqrt2},\\pm\\frac1{\\sqrt2})$."},
    {"q": "$\\sin x+\\sin y+\\sin(x+y)$?", "a": "Max $\\frac{3\\sqrt3}2$ at $(\\frac\\pi3,\\frac\\pi3)$."},
    {"q": "Highest temperature $400xyz^2$ on the unit sphere?", "a": "50 at $x=y=\\pm\\frac12$."},
    {"q": "$kxyz^2$ on a sphere of radius $a$?", "a": "$\\frac{ka^4}8$."},
    {"q": "Open box of volume $V$, least area?", "a": "$x=y=\\sqrt[3]{2V}$, height $\\frac x2$."},
    {"q": "Is a cube optimal for an open box?", "a": "No; only for a closed box."},
]

MNEMONICS = [
    "<i>“Case, point, table, value.”</i> Split the factored equation into cases, collect the points, tabulate $r$ and $rt-s^2$, then substitute for the values.",
]

TOP_FACTS = [
    "Routine: $f_x=f_y=0$ → points → $r,s,t$ → $rt-s^2$ and $r$ → values.",
    "ESA $x^3+3xy^2-15x^2-15y^2+72x$: max 112 at $(4,0)$, min 108 at $(6,0)$, saddles $(5,\\pm1)$.",
    "ESA $x^3-12x+y^3+3y^2-9y$: max 43 at $(-2,-3)$, min $-21$ at $(2,1)$, saddles $(2,-3)$, $(-2,1)$.",
    "$rt-s^2<0$: saddle, whatever the sign of $r$.",
    "Constraint present: eliminate one variable (or use Lagrange, class 011).",
    "$400xyz^2$ on the unit sphere: highest temperature 50.",
    "Open box: base $\\sqrt[3]{2V}$ square, height half the base edge.",
]
TOP_FORMULAS = ["E1.1", "E1.2", "E1.3", "E3.1", "E3.2"]
