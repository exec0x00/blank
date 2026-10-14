"""Class 004 part I/II and 003 part II: implicit functions in two and three variables (T6–T7)."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T6", "title": "Implicit functions of two variables",
     "overview": "A relation $f(x,y)=c$ defines $y$ as a function of $x$ without solving for it; geometrically it is a level curve. "
                 "Its total differential is zero, $f_x\\,dx+f_y\\,dy=0$, which gives $dy/dx=-f_x/f_y$ with no product or quotient "
                 "rule. The slope then gives tangent lines, and the same idea handles awkward relations such as $(\\cos x)^y=(\\sin y)^x$."},
    {"id": "T7", "title": "Implicit functions of three variables",
     "overview": "A relation $f(x,y,z)=0$ is a level surface and makes $z$ a function of $x$ and $y$. Holding $y$ fixed gives "
                 "$\\partial z/\\partial x=-f_x/f_z$. Holding $z$ fixed gives $\\partial y/\\partial x=-f_x/f_y$. Each needs the "
                 "denominator to be non-zero, and the point used must lie on the surface."},
]

DEFS = [
    {"topic": "T6", "term": "Implicit function", "text": "A function given by a relation $f(x,y)=c$ (for example $x^3y+3xy^2=3$) rather "
     "than by a formula $y=g(x)$.", "srcs": ["S004·3", "T004a 00:00:18"]},
    {"topic": "T6", "term": "Level surface (level curve)", "text": "The set where $z=f(x,y)=c$ (or $f(x_1,\\dots,x_n)=c$). Examples: "
     "equipotential surfaces, isotherms. The cylinders $x^2+y^2=c$ and the spheres $x^2+y^2+z^2=c$ are layers, one for each $c$.",
     "srcs": ["S004·4", "T004a 00:02:35", "T004a 00:03:29"]},
    {"topic": "T7", "term": "Implicit function of three variables", "text": "$f(x,y,z)=0$ with $z$ (or $y$) regarded as a function of "
     "the remaining variables; the other variables are intermediate variables.", "srcs": ["S004·6", "T004a 00:09:05"]},
]

STATEMENTS = [
    {"topic": "T6", "text": "If $z$ represents a level surface, i.e. if $z=f(x,y)=c$, then $dz=0$. The total derivative is also called "
     "the differential.", "srcs": ["S004·4"]},
    {"topic": "T6", "text": "Setting $\\dfrac{dz}{dx}=0$ leads to a simple computation formula for implicit differentiation: "
     "$f_x\\cdot1+f_y\\dfrac{dy}{dx}=0$.", "srcs": ["S004·5"]},
    {"topic": "T7", "text": "Let $f(x,y,z)=0$ be the equation of an implicit function of three variables $x,y,z$. Suppose $y$ and $z$ are "
     "functions of $x$, then $f$ is a function of one independent variable $x$ and $y$, $z$ are intermediate variables.", "srcs": ["S004·6"]},
]

FORMULAS = [
    {"id": "E6.1", "topic": "T6", "title": "Implicit differentiation, two variables", "tex": r"f(x,y)=c\ \Longrightarrow\ \frac{dy}{dx}=-\frac{f_x}{f_y},\qquad f_y\neq0",
     "gives": "Slope of the level curve at a point.", "when": "$f_y\\neq0$ at the point.",
     "note": "From $df=f_x\\,dx+f_y\\,dy=0$. Slide 004·4 prints the fraction upside down.", "stars": 2, "srcs": ["S004·5", "S004·6", "T004a 00:06:36", "T003b 00:10:33"]},
    {"id": "E6.2", "topic": "T6", "title": "Tangent line at a point", "tex": r"y-y_0=m\,(x-x_0),\qquad m=\frac{dy}{dx}\Big|_{(x_0,y_0)}",
     "gives": "Equation of the tangent to the curve at $(x_0,y_0)$.", "when": "$(x_0,y_0)$ on the curve.", "note": "Through the origin: $y=mx$.",
     "stars": 2, "srcs": ["S004·7", "T004a 00:14:25"]},
    {"id": "E6.3", "topic": "T6", "title": "Derivative of a constant power and a variable power", "tex": r"\frac{d}{dx}a^{x}=a^{x}\ln a,\qquad \frac{d}{dx}x^{n}=n\,x^{n-1}",
     "gives": "The two rules needed for $(\\cos x)^y$ and $(\\sin y)^x$.", "when": "In a partial derivative, the other variable is a constant.",
     "note": "$\\ln$ needs a positive argument: $\\cos x>0$, $\\sin y>0$.", "stars": 2, "srcs": ["S004·8", "T004a 00:16:43"]},
    {"id": "E7.1", "topic": "T7", "title": "Implicit differentiation, three variables",
     "tex": r"f(x,y,z)=0:\quad \frac{\partial z}{\partial x}=-\frac{f_x}{f_z},\quad \frac{\partial z}{\partial y}=-\frac{f_y}{f_z}\ \ (f_z\neq0);\qquad \frac{\partial y}{\partial x}=-\frac{f_x}{f_y}\ \ (f_y\neq0)",
     "gives": "Partial derivatives of the implicitly defined variable.", "when": "Hold $y$ constant for $z_x$; hold $z$ constant for $y_x$.",
     "note": "Extends to any number of variables.", "stars": 2, "srcs": ["S004·6", "S003·26", "T004a 00:10:23", "T003b 00:09:29"]},
]

POINTS = [
    {"topic": "T6", "text": "Differentiating an implicit relation directly needs the product rule on every term, and the right-hand constant gives 0.", "stars": 2, "srcs": ["S004·3", "T004a 00:00:48"]},
    {"topic": "T6", "text": "The formula $dy/dx=-f_x/f_y$ gives the same answer and is far easier when $f$ is complicated.", "stars": 2, "srcs": ["T004a 00:06:19", "T004a 00:06:36"]},
    {"topic": "T6", "text": "Restriction to remember: the formula needs $z=f(x,y)$ to be a constant (a level curve). Move everything to one side first: $f(x,y)=c$ or $f(x,y)=0$.", "stars": 3, "srcs": ["T004a 00:01:49", "T004a 00:02:04"]},
    {"topic": "T6", "text": "There are two ways to solve “find $dy/dx$”: differentiate both sides directly, or use $-f_x/f_y$. Both are accepted.", "stars": 2, "srcs": ["S003·27", "T003b 00:10:33"]},
    {"topic": "T6", "text": "The slope $dy/dx$ at a point gives the tangent line $y-y_0=m(x-x_0)$.", "stars": 2, "srcs": ["S004·7", "T004a 00:12:01"]},
    {"topic": "T6", "text": "For $(\\cos x)^y=(\\sin y)^x$ the result needs $\\cos x>0$ and $\\sin y>0$, because of the logarithms.", "stars": 1, "srcs": ["T004a 00:18:12"]},
    {"topic": "T6", "text": "Implicit and composite together: if $u=\\tan(x^2+y^2)$ and $x^2-y^2=2$, use the relation to eliminate $y$ (or find $dy/dx$) before differentiating.", "stars": 2, "srcs": ["CW U1 P16", "CW U1 P18"]},
    {"topic": "T7", "text": "For $f(x,y,z)=0$, $x$ and $y$ are independent, so $dz$ alone has no meaning; find the partials $z_x$, $z_y$.", "stars": 2, "srcs": ["T004a 00:09:38"]},
    {"topic": "T7", "text": "For $\\partial z/\\partial x$ treat $y$ as constant; for $\\partial y/\\partial x$ treat $z$ as constant.", "stars": 2, "srcs": ["S004·6", "S004·9", "T004a 00:19:00"]},
    {"topic": "T7", "text": "The formula avoids separating $z$ from a messy equation such as $x^3y^2+3xyz+\\sin(e^z)=c$.", "stars": 1, "srcs": ["T004a 00:10:55"]},
    {"topic": "T7", "text": "Check that the given point satisfies $f=0$ before substituting.", "stars": 2, "srcs": ["S004·9", "T004a 00:18:39"], "flags": [ADD]},
]

WHY = [
    {"topic": "T6", "q": "Why is $dy/dx=-f_x/f_y$?",
     "a": "Along the curve $f(x,y)=c$ the value of $f$ does not change, so $df=f_x\\,dx+f_y\\,dy=0$. Divide by $dx$: "
          "$f_x+f_y\\,\\dfrac{dy}{dx}=0$. The branch diagram (Figure G6.1) shows the same sum.", "srcs": ["S004·4", "S004·5", "T004a 00:07:39"]},
    {"topic": "T6", "q": "Why is the level-curve slope $-f_x/f_y$ and not $-f_y/f_x$ (as printed on slide 004·4)?",
     "a": "From $f_x+f_y\\,y'=0$ you get $y'=-f_x/f_y$. Test it on $x^2+y^2=5$ at $(2,1)$: $-f_x/f_y=-2x/(2y)=-2$, which matches "
          "differentiating directly; $-f_y/f_x$ would give $-1/2$.", "srcs": ["S004·4", "S004·5"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T6", "text": "Slide 004·4 prints $dy/dx=-f_y(x,y)/f_x(x,y)$. The correct formula is $dy/dx=-f_x/f_y$.", "srcs": ["S004·4"], "flags": [ADD]},
    {"topic": "T6", "text": "In $(\\cos x)^y$, with respect to $x$ it is a power ($y(\\cos x)^{y-1}(-\\sin x)$); with respect to $y$ it is an exponential ($(\\cos x)^y\\ln\\cos x$).", "srcs": ["S004·8", "T004a 00:16:02"]},
    {"topic": "T7", "text": "The lecture works problem 3 at $(1,0,2)$ and gets 0 for both derivatives, but $(1,0,2)$ is not on $z^3+xy-y^2z=6$ (it gives 8). "
     "Use the slide's point $(0,1,2)$: $\\partial y/\\partial x=1/4$, $\\partial z/\\partial x=-1/11$.", "srcs": ["S004·9", "T004a 00:20:47"], "flags": [ADD]},
    {"topic": "T7", "text": "Do not differentiate $-f_x/f_z$ as if $z$ were a constant when you need second derivatives: $z$ is still a function of $x$ and $y$ (W7.3).", "srcs": ["ESA Jan-24 s3 1d"], "flags": [ADD]},
]

WORKED = [
    {"id": "W6.1", "topic": "T6", "title": "Direct differentiation vs the formula", "srcs": ["S004·3", "T004a 00:00:48", "T004a 00:05:41"], "stars": 2,
     "given": "$x^3y+3xy^2=3$.",
     "steps": ["Direct: $x^3y'+3x^2y+3y^2+6xy\\,y'=0$.", "Formula: $f_x=3x^2y+3y^2$, $f_y=x^3+6xy$.", "$y'=-\\dfrac{3x^2y+3y^2}{x^3+6xy}$."],
     "answer": "$\\dfrac{dy}{dx}=-\\dfrac{3y(x^2+y)}{x(x^2+6y)}$", "check": "Both methods agree; the slide's printed numerator is unclear."},
    {"id": "W6.2", "topic": "T6", "title": "Two ways for $x^2+xy+y^2=7$", "srcs": ["S003·27", "T003b 00:10:23"], "stars": 2,
     "given": "$x^2+xy+y^2=7$.",
     "steps": ["Direct: $2x+(xy'+y)+2y\\,y'=0$, so $(x+2y)y'=-(2x+y)$.", "Formula: $f_x=2x+y$, $f_y=x+2y$, $y'=-f_x/f_y$."],
     "answer": "$\\dfrac{dy}{dx}=-\\dfrac{2x+y}{x+2y}$", "check": "Same by both methods."},
    {"id": "W6.3", "topic": "T6", "title": "Tangent line at the origin", "srcs": ["S004·7", "T004a 00:11:48"], "stars": 2,
     "given": "$xe^y+ye^x=0$; tangent at $(0,0)$.",
     "steps": ["$f_x=e^y+ye^x$, $f_y=xe^y+e^x$.", "$\\dfrac{dy}{dx}=-\\dfrac{e^y+ye^x}{xe^y+e^x}$; at $(0,0)$: $-\\dfrac{1+0}{0+1}=-1$.", "$y-0=-1(x-0)$."],
     "answer": "$x+y=0$", "check": "$(0,0)$ satisfies the equation."},
    {"id": "W6.4", "topic": "T6", "title": "$(\\cos x)^y=(\\sin y)^x$", "srcs": ["S004·8", "T004a 00:14:57"], "stars": 2,
     "given": "$f(x,y)=(\\cos x)^y-(\\sin y)^x=0$.",
     "steps": ["$f_x=y(\\cos x)^{y-1}(-\\sin x)-(\\sin y)^x\\ln\\sin y$.", "$f_y=(\\cos x)^y\\ln\\cos x-x(\\sin y)^{x-1}\\cos y$.",
               "$y'=-f_x/f_y$. Divide through by $(\\cos x)^y=(\\sin y)^x$, then multiply top and bottom by $\\cos x\\sin y$."],
     "answer": "$\\dfrac{dy}{dx}=\\dfrac{\\sin y\\,(y\\sin x+\\cos x\\ln\\sin y)}{\\cos x\\,(\\sin y\\ln\\cos x-x\\cos y)}$",
     "check": "Checked numerically at a point on the curve ($x=0.5$, $y\\approx0.909$): both give $-0.4980$."},
    {"id": "W6.5", "topic": "T6", "title": "Slope at (1, 1)", "srcs": ["CW U1 P17"], "stars": 2,
     "given": "$e^y-e^x+xy=1$ at $(1,1)$.",
     "steps": ["Check: $e-e+1=1$, so the point is on the curve.", "$f_x=-e^x+y$, $f_y=e^y+x$.", "$y'=-\\dfrac{-e+1}{e+1}$."],
     "answer": "$\\dfrac{dy}{dx}=\\dfrac{e-1}{e+1}$", "check": "CW answer: $(e-1)/(e+1)$."},
    {"id": "W6.6", "topic": "T6", "title": "Composite with an implicit constraint", "srcs": ["CW U1 P16"], "stars": 2,
     "given": "$u=\\tan(x^2+y^2)$ with $x^2-y^2=2$; find $du/dx$.",
     "steps": ["From the relation, $y^2=x^2-2$, so $u=\\tan(2x^2-2)$.", "$\\dfrac{du}{dx}=\\sec^2(2x^2-2)\\cdot4x$."],
     "answer": "$\\dfrac{du}{dx}=4x\\sec^2(2x^2-2)$", "check": "Via the chain rule: $u_x+u_y\\,y'$ with $y'=x/y$ gives the same. CW answer agrees."},
    {"id": "W6.7", "topic": "T6", "title": "Total derivative along an implicit curve", "srcs": ["CW U1 P18"], "stars": 2,
     "given": "$u=x\\log(xy)$ with $x^3+y^3-3xy-1=0$; find $du/dx$.",
     "steps": ["$\\dfrac{du}{dx}=u_x+u_y\\dfrac{dy}{dx}$, with $u_x=\\log(xy)+1$, $u_y=\\dfrac{x}{y}$.",
               "From the relation: $\\dfrac{dy}{dx}=-\\dfrac{3x^2-3y}{3y^2-3x}=\\dfrac{y-x^2}{y^2-x}$."],
     "answer": "$\\dfrac{du}{dx}=1+\\log(xy)+\\dfrac{x\\,(y-x^2)}{y\\,(y^2-x)}$", "check": "CW answer agrees; sympy residual 0."},
    {"id": "W7.1", "topic": "T7", "title": "$\\partial y/\\partial x$ and $\\partial z/\\partial x$ at $(0,1,2)$", "srcs": ["S004·9", "T004a 00:18:39"], "stars": 2,
     "given": "$z^3+xy-y^2z=6$ at $(0,1,2)$.",
     "steps": ["Check the point: $8+0-2=6$.", "$f=z^3+xy-y^2z-6$: $f_x=y$, $f_y=x-2yz$, $f_z=3z^2-y^2$.",
               "$\\dfrac{\\partial y}{\\partial x}=-\\dfrac{y}{x-2yz}=-\\dfrac{1}{0-4}$; $\\dfrac{\\partial z}{\\partial x}=-\\dfrac{y}{3z^2-y^2}=-\\dfrac{1}{12-1}$."],
     "answer": "$\\dfrac{\\partial y}{\\partial x}=\\dfrac14,\\quad \\dfrac{\\partial z}{\\partial x}=-\\dfrac{1}{11}$", "check": "The lecture's point $(1,0,2)$ is not on the surface (see Exam trap)."},
    {"id": "W7.2", "topic": "T7", "title": "$\\partial z/\\partial x$ and $\\partial z/\\partial y$ at the origin", "srcs": ["S003·26", "T003b 00:09:15"], "stars": 2,
     "given": "$x^3+z^2+ye^{xz}+z\\cos y=0$ at $(0,0,0)$.",
     "steps": ["$F_x=3x^2+zye^{xz}$, $F_y=e^{xz}-z\\sin y$, $F_z=2z+xye^{xz}+\\cos y$.", "At the origin: $F_x=0$, $F_y=1$, $F_z=1$."],
     "answer": "$\\dfrac{\\partial z}{\\partial x}=0,\\quad \\dfrac{\\partial z}{\\partial y}=-1$", "check": "The origin satisfies the equation."},
    {"id": "W7.3", "topic": "T7", "title": "Second derivative of an implicit function", "srcs": ["ESA Jan-24 s3 1d", "CW U1 P6"], "stars": 2, "flags": [ADD],
     "given": "$x^xy^yz^z=c$. Show that at $x=y=z$, $\\dfrac{\\partial^2z}{\\partial x\\,\\partial y}=-[x\\log(ex)]^{-1}$.",
     "steps": ["Take logs: $f=x\\log x+y\\log y+z\\log z-\\log c=0$, so $f_x=1+\\log x$, $f_y=1+\\log y$, $f_z=1+\\log z$.",
               "$z_x=-\\dfrac{1+\\log x}{1+\\log z}$, $z_y=-\\dfrac{1+\\log y}{1+\\log z}$.",
               "$z_{xy}=\\dfrac{\\partial}{\\partial y}z_x=\\dfrac{1+\\log x}{(1+\\log z)^2}\\cdot\\dfrac{1}{z}\\,z_y$ ($z$ depends on $y$).",
               "At $x=y=z$: $z_y=-1$, so $z_{xy}=-\\dfrac{1}{x(1+\\log x)}$, and $1+\\log x=\\log(ex)$."],
     "answer": "$\\dfrac{\\partial^2z}{\\partial x\\,\\partial y}=-\\dfrac{1}{x\\log(ex)}$", "check": "sympy residual 0."},
]

PYQS = [
    {"topic": "T7", "paper": "ESA Jan 2024", "q": "UE23MA141A set 3, Q1.d", "marks": 6,
     "text": "For the point on the surface $x^xy^yz^z=c$, show that at $x=y=z$, $\\frac{\\partial^2z}{\\partial x\\partial y}=-[x\\log(ex)]^{-1}$.", "worked": "W7.3"},
]

NOTES = [
    {"topic": "T6", "text": "An implicit function is given by a relation $f(x,y)=c$, a level curve. Along it $df=f_x\\,dx+f_y\\,dy=0$, so "
     "$\\dfrac{dy}{dx}=-\\dfrac{f_x}{f_y}$ ($f_y\\neq0$). Direct differentiation of both sides gives the same result. The slope at "
     "$(x_0,y_0)$ gives the tangent $y-y_0=m(x-x_0)$; e.g. $xe^y+ye^x=0$ has tangent $x+y=0$ at the origin."},
    {"topic": "T7", "text": "For $f(x,y,z)=0$, $z$ is a function of $x$ and $y$: $\\dfrac{\\partial z}{\\partial x}=-\\dfrac{f_x}{f_z}$ (hold $y$), "
     "$\\dfrac{\\partial z}{\\partial y}=-\\dfrac{f_y}{f_z}$, and $\\dfrac{\\partial y}{\\partial x}=-\\dfrac{f_x}{f_y}$ (hold $z$), provided the "
     "denominators are non-zero. Check that the point lies on the surface. For second derivatives, remember that $z$ still depends on $x,y$."},
]

FIGS = [
    {"id": "G6.1", "topic": "T6", "title": "Branch diagram for implicit differentiation", "stars": 2, "srcs": ["S004·5", "T004a 00:07:57"],
     "howto": "Differentiate $z=f(x,y)$ with respect to $x$ along both branches. The left branch is direct ($f_x\\cdot dx/dx=f_x\\cdot1$). "
              "The right branch goes through $y=h(x)$ ($f_y\\cdot dy/dx$). On a level curve the total is 0: $f_x+f_y\\,dy/dx=0$."},
    {"id": "G6.2", "topic": "T6", "title": "The curve $xe^y+ye^x=0$ and its tangent at the origin", "stars": 2, "srcs": ["S004·7", "T004a 00:13:48"],
     "howto": "The blue curve is the set where $f(x,y)=xe^y+ye^x=0$. At the origin $dy/dx=-f_x/f_y=-1$, so the dashed tangent is "
              "$y=-x$. The curve is plotted from its equation (the slide's picture is a 3-D grapher screenshot)."},
    {"id": "G6.3", "topic": "T6", "title": "Level curves and the slope $-f_x/f_y$", "stars": 2, "srcs": ["S004·4", "S003·7", "T004a 00:03:10"], "flags": [ADD],
     "howto": "Level curves of $f=x^2+y^2$ for $c=1,2,5,9$: the cross-sections of the cylinders on slide 004·4. On $c=5$ at $(2,1)$ the "
              "dashed tangent has slope $-f_x/f_y=-2x/2y=-2$, the same $dy/dx=-x/y$ used in W4.1."},
]

FLOWS = [
    {"id": "F6.1", "topic": "T6", "title": "Finding $dy/dx$ for an implicit function: two routes.", "stars": 2,
     "srcs": ["S003·27", "S004·3", "S004·5", "T003b 00:10:33", "T004a 00:06:19"], "layout": "fork", "maxw": "150mm",
     "spec": {"before": [{"kind": "step", "n": 1, "title": "Put the relation in the form $f(x,y)=c$"}],
              "question": "Is $f$ complicated (powers like $(\\cos x)^y$, many products)?",
              "no": {"kind": "step", "title": "Differentiate both sides directly", "sub": "Product rule; $y'$ terms collected; the constant gives 0"},
              "yes": {"kind": "step", "title": "Use the partial-derivative formula", "fx": "$\\dfrac{dy}{dx}=-\\dfrac{f_x}{f_y}$"},
              "after": [{"kind": "result", "n": 3, "title": "Evaluate at the point; tangent line if asked", "fx": "$y-y_0=m(x-x_0)$"}]},
     "remark": "Both routes give the same $dy/dx$ (W6.1, W6.2). The formula needs $f_y\\neq0$ at the point."},
    {"id": "F7.1", "topic": "T7", "title": "Partial derivatives from $f(x,y,z)=0$.", "stars": 2, "srcs": ["S004·6", "S004·9", "S003·26"],
     "layout": "streams", "maxw": "150mm",
     "spec": {"left": [{"kind": "given", "title": "$\\partial z/\\partial x$", "sub": "hold $y$ constant"},
                       {"kind": "step", "title": "Divide by $f_z$", "fx": "$-\\dfrac{f_x}{f_z}$"}],
              "right": [{"kind": "given", "title": "$\\partial y/\\partial x$", "sub": "hold $z$ constant"},
                        {"kind": "step", "title": "Divide by $f_y$", "fx": "$-\\dfrac{f_x}{f_y}$"}],
              "then": [{"kind": "check", "title": "Is the point on the surface?", "sub": "Substitute it into $f$: it must give 0"},
                       {"kind": "result", "title": "Substitute the point", "sub": "e.g. $(0,1,2)$ on $z^3+xy-y^2z=6$: $\\tfrac14$ and $-\\tfrac{1}{11}$"}]},
     "trap": "The lecture used $(1,0,2)$, which is not on the surface; always check the point first."},
]
