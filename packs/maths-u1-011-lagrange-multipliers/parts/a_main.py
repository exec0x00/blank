"""Class 011: Lagrange's method of undetermined multipliers."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "Lagrange's method: the auxiliary function and the procedure",
     "overview": "To find the extreme values of $f(x,y,z)$ subject to a constraint $\\phi(x,y,z)=0$, introduce an unknown constant "
                 "$\\lambda$ (the Lagrange multiplier) and form $F=f+\\lambda\\phi$. Solve the four equations $F_x=0$, $F_y=0$, "
                 "$F_z=0$, $\\phi=0$ for $x,y,z,\\lambda$. No variable has to be eliminated first, and the method extends to more "
                 "variables and constraints; but it gives only stationary points, not their nature."},
    {"id": "T2", "title": "Geometric problems: inscribed solids, nearest and farthest points",
     "overview": "The largest rectangular solid in a sphere is a cube; in the ellipsoid $\\frac{x^2}{a^2}+\\frac{y^2}{b^2}+\\frac{z^2}{c^2}=1$ "
                 "its half-edges are $\\frac a{\\sqrt3},\\frac b{\\sqrt3},\\frac c{\\sqrt3}$ and its volume $\\frac{8abc}{3\\sqrt3}$. "
                 "For nearest and farthest points, optimise the square of the distance: the hyperbolic cylinder $x^2-z^2=1$ is "
                 "nearest the origin at $(\\pm1,0,0)$; the curve $5x^2+6xy+5y^2=8$ is between distances 1 and 2."},
    {"id": "T3", "title": "Applied problems: boxes, splitting a number, temperature",
     "overview": "The same procedure handles every applied problem once $f$ and $\\phi$ are identified: an open box of surface 432 cm² "
                 "holds most as $12\\times12\\times6$; 24 split as $4+8+12$ maximises $xy^2z^3$; the temperature $400xyz^2$ on the "
                 "unit sphere is at most 50. The trick in solving is to make $\\lambda$ the subject of each equation and equate."},
]

DEFS = [
    {"topic": "T1", "term": "Constraint", "text": "A condition $\\phi(x,y,z)=0$ that the variables must satisfy (walk only on the surface "
     "of a sphere, a fixed surface area, a fixed sum).", "srcs": ["S011·3", "T011a 00:00:36"]},
    {"topic": "T1", "term": "Lagrange multiplier", "text": "Suppose we need to minimize or maximize a function $f(x,y,z)$ subject to the "
     "constraint $\\phi(x,y,z)$; then we can introduce an additional unknown constant $\\lambda$, known as Lagrange's multiplier, "
     "to ease the process of finding the extrema.", "srcs": ["S011·3", "T011a 00:00:53"]},
    {"topic": "T1", "term": "Auxiliary function", "text": "$F(x,y,z)=f(x,y,z)+\\lambda\\phi(x,y,z)$: the given function plus $\\lambda$ times "
     "its constraint (also called Lagrange's function).", "srcs": ["S011·3", "T011a 00:01:08", "T011b 00:02:06"]},
    {"topic": "T2", "term": "Continued product", "text": "The product obtained by multiplying together in succession: for parts $x,y,z$, the "
     "product of the first, the square of the second and the cube of the third is $xy^2z^3$.", "srcs": ["S011·12", "T011b 00:05:23"]},
]

STATEMENTS = [
    {"topic": "T1", "text": "Working procedure. Step 1: Form the auxiliary equation $F(x,y,z)=f(x,y,z)+\\lambda\\phi(x,y,z)$ … (1). "
     "Step 2: Partially differentiate $F$ in (1) w.r.t. $x,y,z$ respectively. Step 3: Solve the four equations $F_x=0$, $F_y=0$, "
     "$F_z=0$ and the constraint for the Lagrange multiplier $\\lambda$ and stationary values $x,y,z$.", "srcs": ["S011·3"]},
    {"topic": "T1", "text": "Advantages: 1. The stationary points of $f(x,y,z)$ can be determined without determining $x,y,z$ explicitly. "
     "2. This method can be extended to function of several variables subject to many constraints. Disadvantages: 1. Nature of the "
     "stationary points can not be determined. 2. Equations $F_x=0$, $F_y=0$, $F_z=0$ are only necessary conditions.", "srcs": ["S011·4", "T011a 00:03:04"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Auxiliary (Lagrange) function", "tex": r"F(x,y,z)=f(x,y,z)+\lambda\,\phi(x,y,z)",
     "gives": "One function whose stationary points are the constrained stationary points.", "when": "Optimise $f$ subject to $\\phi(x,y,z)=0$.",
     "note": "Write the constraint with everything on one side: $x^2+y^2+z^2-r^2$, $xy+2yz+2zx-432$.", "stars": 3, "srcs": ["S011·3", "T011a 00:01:08"]},
    {"id": "E1.2", "topic": "T1", "title": "The four equations", "tex": r"F_x=f_x+\lambda\phi_x=0,\quad F_y=f_y+\lambda\phi_y=0,\quad F_z=f_z+\lambda\phi_z=0,\quad \phi=0",
     "gives": "$x,y,z$ and $\\lambda$ (four unknowns, four equations).", "when": "Always; with two variables drop $F_z$ (three equations).",
     "note": "Equivalently $\\nabla f=-\\lambda\\nabla\\phi$: the gradients are parallel (added for clarity).", "stars": 3, "srcs": ["S011·3", "T011a 00:02:17", "T011a 00:02:30"]},
    {"id": "E1.3", "topic": "T1", "title": "Solving trick: make $\\lambda$ the subject", "tex": r"\lambda=-\frac{f_x}{\phi_x}=-\frac{f_y}{\phi_y}=-\frac{f_z}{\phi_z}",
     "gives": "Relations between $x,y,z$ without $\\lambda$.", "when": "When $\\phi_x,\\phi_y,\\phi_z\\neq0$.",
     "note": "Or multiply the equations by $x$, $y$, $z$ and subtract (slides 011·6, 011·11).", "stars": 2, "srcs": ["S011·13", "S011·14", "T011b 00:07:24"]},
    {"id": "E2.1", "topic": "T2", "title": "Largest box in a sphere and in an ellipsoid",
     "tex": r"\begin{gathered}x^2+y^2+z^2=r^2:\ x=y=z=\tfrac{r}{\sqrt3},\ V_{\max}=\tfrac{8r^3}{3\sqrt3}\\ \tfrac{x^2}{a^2}+\tfrac{y^2}{b^2}+\tfrac{z^2}{c^2}=1:\ x=\tfrac{a}{\sqrt3},\ y=\tfrac{b}{\sqrt3},\ z=\tfrac{c}{\sqrt3},\ V_{\max}=\tfrac{8abc}{3\sqrt3}\end{gathered}",
     "gives": "Half-edges and the largest volume $V=8xyz$.", "when": "Box centred at the origin, edges $2x,2y,2z$ parallel to the axes.",
     "note": "The sphere is the ellipsoid with $a=b=c=r$: the box is a cube.", "stars": 3, "srcs": ["S011·5", "ESA May-24 1c", "ESA Jan-24 s3 1a", "ESA Jan-24 s4 1a"]},
    {"id": "E2.2", "topic": "T2", "title": "Distance problems: use the square", "tex": r"f=x^2+y^2+z^2\ \ (\text{origin}),\qquad f=(x-x_0)^2+(y-y_0)^2+(z-z_0)^2",
     "gives": "The squared distance, which has its extrema at the same points as the distance.", "when": "Nearest or farthest point on a curve or surface.",
     "note": "Take the square root at the end.", "stars": 3, "srcs": ["S011·8", "ESA Jul-23 1c", "CW U1 P36"], "flags": [ADD]},
]

POINTS = [
    {"topic": "T1", "text": "The method avoids elimination: in class 010 we had to substitute $z^2=1-x^2-y^2$ for the temperature problem; with Lagrange we differentiate $F$ directly.",
     "stars": 2, "srcs": ["T011a 00:01:18", "T011a 00:03:17"]},
    {"topic": "T1", "text": "Four unknowns $x,y,z,\\lambda$ need four equations: $F_x=0$, $F_y=0$, $F_z=0$ and the constraint $\\phi=0$.", "stars": 3, "srcs": ["T011a 00:02:30"]},
    {"topic": "T1", "text": "$\\lambda$ is “undetermined”: we may find it, but it does not appear in the answer.", "stars": 1, "srcs": ["T011a 00:02:04"]},
    {"topic": "T1", "text": "The method gives only stationary points; to verify maximum or minimum by $rt-s^2$ we would have to go back to the previous method. "
     "In problems the question itself says which (maximum volume, closest point).", "stars": 2, "srcs": ["S011·4", "T011a 00:04:05", "T011a 00:14:01"]},
    {"topic": "T1", "text": "The most important step is to identify the function $f$ and the constraint $\\phi$ correctly (Figure F1.2).", "stars": 3, "srcs": ["T011a 00:09:15", "T011b 00:01:46"]},
    {"topic": "T1", "text": "Geometrically, at a constrained extremum a level curve (surface) of $f$ just touches the constraint, so $\\nabla f$ and $\\nabla\\phi$ "
     "are parallel: $\\nabla f=-\\lambda\\nabla\\phi$ (Figure G1.1).", "stars": 1, "srcs": ["S011·7"], "flags": [ADD]},
    {"topic": "T2", "text": "For a box inscribed in a sphere or ellipsoid centred at the origin, take the corner $(x,y,z)$ in the first octant: edges $2x,2y,2z$, volume $8xyz$. "
     "Using $xyz$ instead gives the same point.", "stars": 3, "srcs": ["S011·5", "T011a 00:06:08", "T011a 00:06:53"]},
    {"topic": "T2", "text": "To find the nearest point, imagine a small sphere centred at the origin expanding like a soap bubble until it just touches the surface (Figure G2.1).",
     "stars": 1, "srcs": ["S011·7"]},
    {"topic": "T2", "text": "Reject solutions that are impossible: on $x^2-z^2=1$, $x=0$ would need $z^2=-1$.", "stars": 2, "srcs": ["S011·9", "T011a 00:12:26"]},
    {"topic": "T2", "text": "When there are two stationary values (W2.4: distances 1 and 2), the larger is the maximum and the smaller the minimum on a closed curve.",
     "stars": 3, "srcs": ["ESA Jul-23 1c"], "flags": [ADD]},
    {"topic": "T3", "text": "Open box (no top): surface $xy+2yz+2zx$; closed box: $2(xy+yz+zx)$.", "stars": 2, "srcs": ["S011·10", "T011b 00:01:09"]},
    {"topic": "T3", "text": "Dividing a number $N$ into parts $x,y,z$: constraint $x+y+z=N$; the function is the product asked for.", "stars": 1, "srcs": ["S011·12", "T011b 00:05:57"]},
    {"topic": "T3", "text": "The temperature problem of class 010 gives the same 50 by Lagrange's method with no elimination (W3.3).", "stars": 3, "srcs": ["T011a 00:14:33", "ESA Jun-24 1d"]},
]

WHY = [
    {"topic": "T1", "q": "Why does $F_x=F_y=F_z=0$ find the constrained extrema?",
     "a": "At a constrained extremum, $f$ cannot increase along any direction that stays on the surface $\\phi=0$, so $\\nabla f$ is "
          "perpendicular to the surface, i.e. parallel to $\\nabla\\phi$: $\\nabla f+\\lambda\\nabla\\phi=0$, which is exactly $F_x=F_y=F_z=0$.",
     "srcs": ["S011·3", "S011·7"], "flags": [ADD]},
    {"topic": "T2", "q": "Why minimise $x^2+y^2+z^2$ instead of the distance?",
     "a": "$\\sqrt u$ increases with $u$, so both have their extrema at the same points, and the square has no square root to differentiate.",
     "srcs": ["S011·8", "T011a 00:10:08"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T1", "text": "Do not forget the constraint as the fourth equation; three equations cannot fix four unknowns.", "srcs": ["T011a 00:02:30"]},
    {"topic": "T1", "text": "Dividing by $x$, $y$, $z$ or $\\lambda$ assumes it is not zero; check those cases separately (they usually give zero volume or an impossible point).",
     "srcs": ["S011·9", "T011b 00:03:40"], "flags": [ADD]},
    {"topic": "T2", "text": "The box in the sphere has edges $2x,2y,2z$, so $V=8xyz$: its largest volume is $\\frac{8r^3}{3\\sqrt3}$, not $\\frac{r^3}{3\\sqrt3}$.", "srcs": ["S011·5"], "flags": [ADD]},
    {"topic": "T2", "text": "Slide 011·6's third line should read $8xyz+2z^2\\lambda=0$ (printed with $y^2$).", "srcs": ["S011·6"], "flags": [ADD]},
    {"topic": "T3", "text": "Open-top box: $x=y=2z$ (height half the base edge), not a cube.", "srcs": ["S011·11", "CW U1 P34"]},
]

WORKED = [
    {"id": "W2.1", "topic": "T2", "title": "The largest rectangular solid in a sphere is a cube", "srcs": ["S011·5", "S011·6", "S011·14", "T011a 00:04:49", "T011b 00:08:50", "ESA May-24 1c", "Extra Q59"], "stars": 3,
     "given": "Show that the rectangular solid of maximum volume that can be inscribed in a given sphere $x^2+y^2+z^2=r^2$ is a cube.",
     "steps": ["Edges $2x,2y,2z$: $f=8xyz$; $\\phi=x^2+y^2+z^2-r^2$; $F=8xyz+\\lambda(x^2+y^2+z^2-r^2)$.",
               "$F_x=8yz+2x\\lambda=0$, $F_y=8xz+2y\\lambda=0$, $F_z=8xy+2z\\lambda=0$.",
               "Multiply by $x$, $y$, $z$: $8xyz+2x^2\\lambda=0$, $8xyz+2y^2\\lambda=0$, $8xyz+2z^2\\lambda=0$.",
               "So $2x^2\\lambda=2y^2\\lambda=2z^2\\lambda=-8xyz\\ne0$: $x^2=y^2=z^2$, and with $x,y,z>0$, $x=y=z$.",
               "From the constraint $3x^2=r^2$: $x=y=z=\\frac r{\\sqrt3}$."],
     "answer": "$x=y=z$: the solid is a cube of edge $\\dfrac{2r}{\\sqrt3}$, volume $\\dfrac{8r^3}{3\\sqrt3}$",
     "check": "sympy solves the system to $x=y=z=\\frac{r}{\\sqrt3}$ and $V=\\frac{8\\sqrt3r^3}9=\\frac{8r^3}{3\\sqrt3}$."},
    {"id": "W2.2", "topic": "T2", "title": "Largest parallelepiped in an ellipsoid", "srcs": ["ESA Jan-24 s3 1a", "ESA Jan-24 s4 1a", "Extra Q61"], "stars": 3,
     "given": "Use the method of Lagrange's multipliers to find the volume of the largest rectangular parallelepiped that can be inscribed in the ellipsoid $\\frac{x^2}{a^2}+\\frac{y^2}{b^2}+\\frac{z^2}{c^2}=1$.",
     "steps": ["$f=8xyz$, $F=8xyz+\\lambda\\big(\\frac{x^2}{a^2}+\\frac{y^2}{b^2}+\\frac{z^2}{c^2}-1\\big)$.",
               "$F_x=8yz+\\frac{2\\lambda x}{a^2}=0$, $F_y=8xz+\\frac{2\\lambda y}{b^2}=0$, $F_z=8xy+\\frac{2\\lambda z}{c^2}=0$.",
               "Multiply by $x$, $y$, $z$: $\\frac{2\\lambda x^2}{a^2}=\\frac{2\\lambda y^2}{b^2}=\\frac{2\\lambda z^2}{c^2}=-8xyz$, so $\\frac{x^2}{a^2}=\\frac{y^2}{b^2}=\\frac{z^2}{c^2}$.",
               "Constraint: $3\\frac{x^2}{a^2}=1$, so $x=\\frac a{\\sqrt3}$, $y=\\frac b{\\sqrt3}$, $z=\\frac c{\\sqrt3}$.",
               "$V=8\\cdot\\frac{abc}{3\\sqrt3}$."],
     "answer": "$V_{\\max}=\\dfrac{8abc}{3\\sqrt3}$ (edges $\\frac{2a}{\\sqrt3},\\frac{2b}{\\sqrt3},\\frac{2c}{\\sqrt3}$)",
     "check": "sympy: $\\frac{8\\sqrt3abc}{9}$, the same; with $a=b=c=r$ it reduces to W2.1."},
    {"id": "W2.3", "topic": "T2", "title": "Points of $x^2-z^2=1$ closest to the origin", "srcs": ["S011·7", "S011·8", "S011·9", "T011a 00:09:35"], "stars": 2,
     "given": "Find the points closest to the origin on the hyperbolic cylinder $x^2-z^2=1$.",
     "steps": ["$f=x^2+y^2+z^2$ (squared distance), $\\phi=x^2-z^2-1$; $F=x^2+y^2+z^2+\\lambda(x^2-z^2-1)$.",
               "$F_x=2x(1+\\lambda)=0$ (1), $F_y=2y=0$ (2), $F_z=2z(1-\\lambda)=0$ (3), $x^2-z^2=1$ (4).",
               "(2): $y=0$. (1): $x=0$ or $\\lambda=-1$; $x=0$ would need $z^2=-1$, so $\\lambda=-1$.",
               "(3) with $\\lambda=-1$: $4z=0$, $z=0$. (4): $x^2=1$, $x=\\pm1$."],
     "answer": "$(\\pm1,0,0)$, at distance 1 from the origin", "check": "sympy finds only these two points ($\\lambda=-1$)."},
    {"id": "W2.4", "topic": "T2", "title": "Maximum and minimum distances from the origin to $5x^2+6xy+5y^2=8$", "srcs": ["ESA Jul-23 1c"], "stars": 3,
     "given": "Find the maximum and minimum distances from the origin to the curve $5x^2+6xy+5y^2-8=0$.",
     "steps": ["$f=x^2+y^2$, $F=x^2+y^2+\\lambda(5x^2+6xy+5y^2-8)$.",
               "$F_x=2x+\\lambda(10x+6y)=0$, $F_y=2y+\\lambda(6x+10y)=0$.",
               "Eliminate $\\lambda$: $\\frac{x}{5x+3y}=\\frac{y}{3x+5y}$, so $3x^2+5xy=5xy+3y^2$, $x^2=y^2$, $y=\\pm x$.",
               "$y=x$: $16x^2=8$, $x^2=\\frac12$; $f=x^2+y^2=1$: distance 1, at $\\pm(\\frac1{\\sqrt2},\\frac1{\\sqrt2})$.",
               "$y=-x$: $4x^2=8$, $x^2=2$; $f=4$: distance 2, at $\\pm(\\sqrt2,-\\sqrt2)$."],
     "answer": "Maximum distance $2$, minimum distance $1$",
     "check": "sympy agrees. In rotated axes the curve is the ellipse $8u^2+2v^2=8$ with semi-axes 1 and 2 (Figure G2.2)."},
    {"id": "W2.5", "topic": "T2", "title": "Distances of $(3,4,12)$ from the unit sphere", "srcs": ["CW U1 P36", "Extra Q45"], "stars": 2,
     "given": "Find the maximum and minimum distances of the point $(3,4,12)$ from the unit sphere $x^2+y^2+z^2=1$.",
     "steps": ["$f=(x-3)^2+(y-4)^2+(z-12)^2$, $F=f+\\lambda(x^2+y^2+z^2-1)$.",
               "$2(x-3)+2\\lambda x=0\\Rightarrow x=\\frac3{1+\\lambda}$; likewise $y=\\frac4{1+\\lambda}$, $z=\\frac{12}{1+\\lambda}$.",
               "Constraint: $\\frac{9+16+144}{(1+\\lambda)^2}=1$, $1+\\lambda=\\pm13$: points $\\pm\\frac1{13}(3,4,12)$.",
               "Distances: $13-1=12$ and $13+1=14$."],
     "answer": "Maximum $14$, minimum $12$", "check": "CW answer agrees; sympy agrees."},
    {"id": "W3.1", "topic": "T3", "title": "Open box of surface 432 cm² with maximum capacity", "srcs": ["S011·10", "S011·11", "T011b 00:00:19"], "stars": 2,
     "given": "Find the dimensions of the rectangular box, open at the top, of maximum capacity whose surface is 432 sq cm.",
     "steps": ["$f=xyz$, $\\phi=xy+2yz+2zx-432$; $F=xyz+\\lambda(xy+2yz+2zx-432)$.",
               "$yz+\\lambda(y+2z)=0$ (1), $xz+\\lambda(x+2z)=0$ (2), $xy+\\lambda(2y+2x)=0$ (3).",
               "$x\\cdot$(1) $-\\ y\\cdot$(2): $2z\\lambda(x-y)=0\\Rightarrow x=y$. $y\\cdot$(2) $-\\ z\\cdot$(3): $x\\lambda(y-2z)=0\\Rightarrow y=2z$.",
               "Constraint with $x=y=2z$: $x^2+x^2+x^2=3x^2=432$, $x=12$."],
     "answer": "$12$ cm $\\times$ $12$ cm $\\times$ $6$ cm (capacity $864$ cm³)", "check": "sympy agrees."},
    {"id": "W3.2", "topic": "T3", "title": "Divide 24 to maximise $xy^2z^3$", "srcs": ["S011·12", "S011·13", "T011b 00:05:03", "Extra Q53"], "stars": 2,
     "given": "Divide the number 24 into three parts such that the continued product of the first, square of the second and cube of the third may be maximum.",
     "steps": ["$f=xy^2z^3$, $\\phi=x+y+z-24$; $F=xy^2z^3+\\lambda(x+y+z-24)$.",
               "$\\lambda=-y^2z^3=-2xyz^3=-3xy^2z^2$.",
               "$y^2z^3=2xyz^3\\Rightarrow y=2x$; $2xyz^3=3xy^2z^2\\Rightarrow z=\\frac32y=3x$.",
               "$x+2x+3x=24$: $x=4$."],
     "answer": "Parts $4$, $8$, $12$ (product $4\\cdot8^2\\cdot12^3=442368$)", "check": "sympy agrees."},
    {"id": "W3.3", "topic": "T3", "title": "Highest temperature $400xyz^2$ on the unit sphere", "srcs": ["ESA Jun-24 1d", "Extra Q57", "T011a 00:00:17"], "stars": 3,
     "given": "The temperature $T$ at any point $(x,y,z)$ in space is $400xyz^2$. Using Lagrange's method of multipliers, find the highest temperature on the surface of the unit sphere $x^2+y^2+z^2=1$.",
     "steps": ["$F=400xyz^2+\\lambda(x^2+y^2+z^2-1)$.",
               "$400yz^2+2\\lambda x=0$, $400xz^2+2\\lambda y=0$, $800xyz+2\\lambda z=0$.",
               "Multiply by $x$, $y$, $z$: $400xyz^2=-2\\lambda x^2=-2\\lambda y^2$ and $800xyz^2=-2\\lambda z^2$.",
               "So $x^2=y^2$ and $z^2=2x^2$. Constraint: $x^2+x^2+2x^2=1$, $x^2=\\frac14$, $z^2=\\frac12$.",
               "With $x,y$ of the same sign: $T=400\\cdot\\frac14\\cdot\\frac12=50$ (opposite signs give $-50$)."],
     "answer": "Highest temperature $50$, at $x=y=\\pm\\frac12$, $z=\\pm\\frac1{\\sqrt2}$",
     "check": "sympy: stationary values $\\{0,50,-50\\}$. Same as class 010's elimination answer."},
    {"id": "W3.4", "topic": "T3", "title": "Extreme value of $a^3x^2+b^3y^2+c^3z^2$", "srcs": ["CW U1 P33"], "stars": 2,
     "given": "Find the extreme value of $a^3x^2+b^3y^2+c^3z^2$ subject to $\\frac1x+\\frac1y+\\frac1z=1$, where $a,b,c>0$.",
     "steps": ["$F=a^3x^2+b^3y^2+c^3z^2+\\lambda\\big(\\frac1x+\\frac1y+\\frac1z-1\\big)$.",
               "$2a^3x-\\frac{\\lambda}{x^2}=0\\Rightarrow a^3x^3=\\frac\\lambda2$; likewise $b^3y^3=c^3z^3=\\frac\\lambda2$. So $ax=by=cz=t$.",
               "Constraint: $\\frac at+\\frac bt+\\frac ct=1$, $t=a+b+c$.",
               "Value: $a^3\\frac{t^2}{a^2}+b^3\\frac{t^2}{b^2}+c^3\\frac{t^2}{c^2}=t^2(a+b+c)=t^3$."],
     "answer": "$(a+b+c)^3$ at $\\big(\\frac ta,\\frac tb,\\frac tc\\big)$, $t=a+b+c$", "check": "CW answer agrees; numerically with $a,b,c=1,2,3$: value $216=6^3$."},
    {"id": "W3.5", "topic": "T3", "title": "Extreme value of $x^3+8y^3+64z^3$ when $xyz=1$", "srcs": ["CW U1 P35"], "stars": 1,
     "given": "Find the extreme value of $x^3+8y^3+64z^3$ subject to $xyz=1$.",
     "steps": ["$F=x^3+8y^3+64z^3+\\lambda(xyz-1)$: $3x^2+\\lambda yz=0$, $24y^2+\\lambda xz=0$, $192z^2+\\lambda xy=0$.",
               "Multiply by $x$, $y$, $z$: $3x^3=24y^3=192z^3=-\\lambda$, so $x=2y=4z$.",
               "$xyz=x\\cdot\\frac x2\\cdot\\frac x4=1$: $x^3=8$, $x=2$, $y=1$, $z=\\frac12$."],
     "answer": "$24$ at $\\big(2,1,\\tfrac12\\big)$ (a minimum for positive $x,y,z$)", "check": "CW answer agrees; sympy agrees."},
]

PYQS = [
    {"topic": "T2", "paper": "ESA Jul 2023", "q": "UE22MA141A Q1.c", "marks": 7,
     "text": "Find the maximum and minimum distances from the origin to the curve $5x^2+6xy+5y^2-8=0$.", "worked": "W2.4"},
    {"topic": "T2", "paper": "ESA May 2024", "q": "UE22MA141A Q1.c", "marks": 7,
     "text": "Show that the rectangular solid of maximum volume that can be inscribed in a given sphere is a cube by using Lagrange's method of multipliers.", "worked": "W2.1"},
    {"topic": "T2", "paper": "ESA Jan 2024", "q": "UE23MA141A set 3, Q1.a", "marks": 7,
     "text": "Use the method of Lagrange's multipliers to find the volume of the largest rectangular parallelepiped that can be inscribed in the ellipsoid $\\frac{x^2}{a^2}+\\frac{y^2}{b^2}+\\frac{z^2}{c^2}=1$.", "worked": "W2.2"},
    {"topic": "T2", "paper": "ESA Jan 2024", "q": "UE23MA141A set 4, Q1.a", "marks": 7,
     "text": "The same question as set 3 Q1.a (largest parallelepiped in the ellipsoid).", "worked": "W2.2"},
    {"topic": "T3", "paper": "ESA June 2024", "q": "UE23MA141A Q1.d", "marks": 7,
     "text": "The temperature $T$ at any point $(x,y,z)$ in space is $400xyz^2$. Using Lagrange's method of multipliers, find the highest temperature on the surface of the unit sphere $x^2+y^2+z^2=1$.", "worked": "W3.3"},
]

NOTES = [
    {"topic": "T1", "text": "Optimise $f$ subject to $\\phi=0$: $F=f+\\lambda\\phi$; solve $F_x=F_y=F_z=0$ with $\\phi=0$ for $x,y,z,\\lambda$. "
     "Advantages: no elimination; extends to many variables and constraints. Disadvantages: nature not decided; the equations are only necessary."},
    {"topic": "T2", "text": "Box in sphere: $f=8xyz$ ⇒ $x=y=z=\\frac r{\\sqrt3}$, cube. Ellipsoid: $V_{\\max}=\\frac{8abc}{3\\sqrt3}$. Distances: optimise "
     "the square. $x^2-z^2=1$: nearest $(\\pm1,0,0)$. $5x^2+6xy+5y^2=8$: distances 1 (min) and 2 (max). $(3,4,12)$ to unit sphere: 12 and 14."},
    {"topic": "T3", "text": "Open box, surface 432: $12\\times12\\times6$. $24=4+8+12$ for $xy^2z^3$. $400xyz^2$ on the unit sphere: 50. "
     "CW: $a^3x^2+b^3y^2+c^3z^2$ with $\\sum\\frac1x=1$: $(a+b+c)^3$; $x^3+8y^3+64z^3$ with $xyz=1$: 24."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "Why the method works: a level curve touches the constraint", "stars": 1, "srcs": ["S011·3", "S011·7"], "flags": [ADD], "tall": True,
     "howto": "Maximise $f=xy$ on the circle $x^2+y^2=2$ (blue). The level curves $xy=c$ (grey hyperbolas) cross the circle until "
              "$c=1$, where $xy=1$ (vermilion) just touches it at $(1,1)$. There $\\nabla f$ and $\\nabla\\phi$ point the same way "
              "(arrows): $\\nabla f+\\lambda\\nabla\\phi=0$ with $\\lambda=-\\frac12$."},
    {"id": "G2.1", "topic": "T2", "title": "The soap bubble: $x^2-z^2=1$ nearest the origin", "stars": 2, "srcs": ["S011·7", "S011·9"],
     "howto": "Cross-section $y=0$. The hyperbolic cylinder appears as the hyperbola $x^2-z^2=1$ (blue). Circles centred at the origin "
              "(grey, growing like a soap bubble) first touch it at $(\\pm1,0)$ with radius 1 (vermilion): the nearest points $(\\pm1,0,0)$."},
    {"id": "G2.2", "topic": "T2", "title": "$5x^2+6xy+5y^2=8$ between the circles of radius 1 and 2", "stars": 3, "srcs": ["ESA Jul-23 1c"], "flags": [ADD], "tall": True,
     "howto": "The curve is an ellipse (blue) tilted at $45^\\circ$. The circle $x^2+y^2=1$ (vermilion) touches it from inside at "
              "$\\pm(\\frac1{\\sqrt2},\\frac1{\\sqrt2})$: minimum distance 1. The circle $x^2+y^2=4$ (green) touches it from outside at "
              "$\\pm(\\sqrt2,-\\sqrt2)$: maximum distance 2."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "Lagrange's working procedure", "stars": 3, "srcs": ["S011·3", "T011a 00:01:18"],
     "layout": "straight", "maxw": "130mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "Optimise $f(x,y,z)$ subject to $\\phi(x,y,z)=0$"},
         {"kind": "step", "n": 1, "title": "Auxiliary function", "fx": "$F=f+\\lambda\\phi$"},
         {"kind": "step", "n": 2, "title": "Partial derivatives", "fx": "$F_x=0,\\ F_y=0,\\ F_z=0$"},
         {"kind": "step", "n": 3, "title": "Eliminate $\\lambda$", "fx": "$\\lambda=-\\frac{f_x}{\\phi_x}=-\\frac{f_y}{\\phi_y}=\\dots$ or multiply by $x,y,z$ and subtract"},
         {"kind": "step", "n": 4, "title": "Use the constraint", "fx": "$\\phi=0$ fixes the values"},
         {"kind": "check", "title": "Reject impossible points", "sub": "zero edges, $z^2<0$"},
         {"kind": "result", "title": "Stationary point and value", "fx": "max or min from the problem"}]},
     "remark": "Four unknowns $x,y,z,\\lambda$; four equations."},
    {"id": "F1.2", "topic": "T1", "title": "Choosing $f$ and $\\phi$", "stars": 3, "srcs": ["T011a 00:09:15", "T011b 00:01:46", "S011·10", "S011·12"],
     "layout": "route", "maxw": "160mm",
     "spec": {"question": "What is asked?",
              "rows": [{"title": "Largest box in a sphere/ellipsoid", "sub": "$f=8xyz$, $\\phi=$ surface", "kw": "W2.1, W2.2"},
                       {"title": "Nearest / farthest point", "sub": "$f=$ squared distance, $\\phi=$ curve or surface", "kw": "W2.3–W2.5"},
                       {"title": "Box of given surface, most volume", "sub": "$f=xyz$, $\\phi=xy+2yz+2zx-S$", "kw": "W3.1"},
                       {"title": "Split a number", "sub": "$f=$ product, $\\phi=x+y+z-N$", "kw": "W3.2"},
                       {"title": "Highest value on a surface", "sub": "$f=$ the quantity, $\\phi=$ surface", "kw": "W3.3"}]}},
]

COMPARISONS = [
    {"id": "C1.1", "topic": "T1", "title": "Elimination (class 010) and Lagrange's method", "srcs": ["S011·4", "T011a 00:01:36", "T011a 00:04:23"],
     "head": ["", "Elimination", "Lagrange's multipliers"],
     "rows": [["Constraint used", "Solved for one variable and substituted", "Added as $\\lambda\\phi$"],
              ["Equations", "$f_x=f_y=0$ in two variables", "$F_x=F_y=F_z=0$, $\\phi=0$"],
              ["Nature of the point", "$rt-s^2$ and $r$ decide", "Not decided; from the problem"],
              ["More variables / constraints", "Hard", "Extends directly"],
              ["Temperature $400xyz^2$", "50 (class 010)", "50 (W3.3)"]]},
]

SYMBOLS = [
    {"sym": "$f(x,y,z)$", "name": "Objective", "meaning": "Function to maximise or minimise", "where": "E1.1"},
    {"sym": "$\\phi(x,y,z)$", "name": "Constraint", "meaning": "$\\phi=0$; printed $\\varnothing$ on the slides", "where": "E1.1, E1.2"},
    {"sym": "$\\lambda$", "name": "Lagrange multiplier", "meaning": "Undetermined constant; not in the answer", "where": "E1.1–E1.3"},
    {"sym": "$F$", "name": "Auxiliary function", "meaning": "$f+\\lambda\\phi$", "where": "E1.1"},
    {"sym": "$r$", "name": "Radius", "meaning": "Of the sphere $x^2+y^2+z^2=r^2$; not $f_{xx}$", "where": "E2.1"},
    {"sym": "$a,\\ b,\\ c$", "name": "Semi-axes", "meaning": "Of the ellipsoid (in W3.4: positive constants)", "where": "E2.1, W3.4"},
    {"sym": "$2x,\\ 2y,\\ 2z$", "name": "Edges", "meaning": "Of the inscribed box; volume $8xyz$", "where": "E2.1"},
]

KEYWORDS = [
    {"term": "Constrained extremum", "meaning": "Extremum of $f$ on $\\phi=0$.", "topic": "T1"},
    {"term": "Lagrange multiplier $\\lambda$", "meaning": "Undetermined constant multiplying the constraint.", "topic": "T1"},
    {"term": "Auxiliary function", "meaning": "$F=f+\\lambda\\phi$.", "topic": "T1"},
    {"term": "Four equations", "meaning": "$F_x=F_y=F_z=0$, $\\phi=0$.", "topic": "T1"},
    {"term": "Advantage", "meaning": "No elimination; many variables and constraints.", "topic": "T1"},
    {"term": "Disadvantage", "meaning": "Nature not determined; conditions only necessary.", "topic": "T1"},
    {"term": "Parallel gradients", "meaning": "$\\nabla f=-\\lambda\\nabla\\phi$ at the optimum.", "topic": "T1"},
    {"term": "Inscribed box", "meaning": "$V=8xyz$; cube in a sphere.", "topic": "T2"},
    {"term": "Squared distance", "meaning": "Optimise $x^2+y^2+z^2$ instead of the distance.", "topic": "T2"},
    {"term": "Hyperbolic cylinder", "meaning": "$x^2-z^2=1$; nearest points $(\\pm1,0,0)$.", "topic": "T2"},
    {"term": "Continued product", "meaning": "$xy^2z^3$ for first, square of second, cube of third.", "topic": "T3"},
    {"term": "Open box", "meaning": "Surface $xy+2yz+2zx$.", "topic": "T3"},
]

RAPID = [
    {"q": "Auxiliary function?", "a": "$F=f+\\lambda\\phi$."},
    {"q": "Equations to solve?", "a": "$F_x=F_y=F_z=0$ and $\\phi=0$."},
    {"q": "Main advantage?", "a": "No need to eliminate a variable; extends to more variables and constraints."},
    {"q": "Main disadvantage?", "a": "Does not tell maximum or minimum."},
    {"q": "Largest box in a sphere?", "a": "A cube, half-edge $\\frac r{\\sqrt3}$, $V=\\frac{8r^3}{3\\sqrt3}$."},
    {"q": "Largest box in an ellipsoid?", "a": "$V=\\frac{8abc}{3\\sqrt3}$."},
    {"q": "Nearest points of $x^2-z^2=1$ to the origin?", "a": "$(\\pm1,0,0)$."},
    {"q": "Distances from the origin to $5x^2+6xy+5y^2=8$?", "a": "Max 2, min 1."},
    {"q": "Distances of $(3,4,12)$ from the unit sphere?", "a": "Max 14, min 12."},
    {"q": "Open box, surface 432 cm²?", "a": "$12\\times12\\times6$ cm."},
    {"q": "Divide 24 for max $xy^2z^3$?", "a": "4, 8, 12."},
    {"q": "Highest $400xyz^2$ on the unit sphere?", "a": "50."},
    {"q": "Extreme of $x^3+8y^3+64z^3$, $xyz=1$?", "a": "24 at $(2,1,\\frac12)$."},
]

MNEMONICS = [
    "<i>“Add, differentiate, divide out $\\lambda$, constrain.”</i> $F=f+\\lambda\\phi$; $F_x=F_y=F_z=0$; equate the expressions for $\\lambda$; finish with $\\phi=0$.",
]

TOP_FACTS = [
    "$F=f+\\lambda\\phi$; solve $F_x=F_y=F_z=0$, $\\phi=0$.",
    "Make $\\lambda$ the subject (or multiply by $x,y,z$) to get relations like $x=y=z$.",
    "Nature comes from the problem, not from the method.",
    "Box in sphere ⇒ cube; in ellipsoid ⇒ $\\frac{8abc}{3\\sqrt3}$.",
    "Distances: optimise the square. $5x^2+6xy+5y^2=8$: 1 and 2.",
    "$400xyz^2$ on the unit sphere: 50. Open box 432 cm²: $12\\times12\\times6$. 24 ⇒ 4, 8, 12.",
]
TOP_FORMULAS = ["E1.1", "E1.2", "E1.3", "E2.1", "E2.2"]
