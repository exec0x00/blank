"""Knowledge base for UE26MA141A Unit 1, class 002:
Geometrical interpretation of partial derivatives (+ higher-order partials, problems).

Every item carries source tags:
  S002·n        slide n of deck 002 (rendered .pptx, checked against .slides.md/.slides.txt)
  T002 hh:mm:ss AV-summary transcript 002 (timestamp of the segment start)
  V002 hh:mm:ss single frame grabbed from the class 002 video
  CW U1 Pk      UE24MA141A Unit 1 class-work sheet, problem k (answers printed on the sheet)
  ESA …         past ESA paper and question number
Flags: "added for clarity" (standard context not on the slides), "transcript only".
Maths uses $…$ (inline) and $$…$$ (display); rendered by KaTeX at build time.
"""

COURSE = "UE26MA141A Engineering Mathematics – I"
UNIT = "Unit 1 · Partial Differentiation"
SESSION = "Class 002 · Geometrical interpretation of partial derivatives"

ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    ("T1", "Higher-order partial derivatives",
     "Differentiating a partial derivative again gives higher-order partial derivatives. A function of two "
     "variables has 2 first-order, 4 second-order and $2^n$ nth-order partial derivatives; with $m$ "
     "variables there are $m^n$ of order $n$. The two mixed second-order partials are usually equal."),
    ("T2", "The one-variable picture: derivative as slope",
     "For $y=f(x)$ the derivative measures change: how fast $y$ changes as you move along the $x$-axis. "
     "Geometrically, $f'(x_0)$ is the slope of the tangent line to the curve at $x_0$. Partial derivatives "
     "extend exactly this idea to surfaces."),
    ("T3", "A function of two variables is a surface",
     "$z=f(x,y)$ gives one height $z$ for every point $(x,y)$, so its graph is a surface in three dimensions. "
     "If $(x,y)$ is restricted to a curve in the $xy$-plane, such as a circle or a parabola, the matching "
     "points of the surface form a curve lying on the surface."),
    ("T4", "First-order partials as slopes of tangents",
     "At a point $P$ on a surface there are infinitely many tangent lines, one for each direction. "
     "$\\partial f/\\partial x$ at $(x_0,y_0)$ is the slope of the one parallel to the $x$-axis, found by "
     "fixing $y=y_0$; $\\partial f/\\partial y$ is the slope of the one parallel to the $y$-axis, found by "
     "fixing $x=x_0$."),
    ("T5", "Slope in any other direction: the gradient",
     "A tangent that is parallel to neither axis is handled by resolving the direction into $x$- and "
     "$y$-components. Treating $f_x$ and $f_y$ as vector components gives their resultant, the gradient "
     "$\\nabla f$. It is studied fully in vector calculus."),
    ("T6", "Second-order partials: concavity and mixed partials",
     "As in one variable, the second derivative describes bending. $f_{xx}>0$ means the surface is concave up "
     "in the $x$ direction, and $f_{yy}>0$ means concave up in the $y$ direction. The mixed partial $f_{xy}$ "
     "measures how the $x$-slope changes as you move in the $y$ direction."),
    ("T7", "Problems on partial derivatives",
     "The deck's title includes “Problems on partial derivatives”, but no problem slides are in it, and the "
     "transcript defers the problems to the next class. The problems here come from the Unit 1 class-work "
     "sheet and past ESA papers that test exactly this session's content: first-order partials at a point, "
     "higher-order partials, and equality of mixed partials."),
]

# ----------------------------------------------------------------------------- definitions
DEFS = {
    "T1": [
        ("First-order partial derivative", "The partial derivative $\\partial f/\\partial x$ obtained by "
         "differentiating once (here, with respect to $x$ while $y$ is held constant).", ["S002·3"], []),
        ("Second-order partial derivatives", "$\\dfrac{\\partial^2 f}{\\partial x^2},\\ \\dfrac{\\partial^2 f}{\\partial y^2},"
         "\\ \\dfrac{\\partial^2 f}{\\partial x\\partial y},\\ \\dfrac{\\partial^2 f}{\\partial y\\partial x}$, which are "
         "obtained by differentiating twice.", ["S002·3"], []),
        ("Higher-order partial derivatives", "Third, fourth and $n$th order derivatives involve 3, 4 or $n$ "
         "times differentiation respectively.", ["S002·3"], []),
        ("Mixed partial derivative", "A higher-order partial in which you differentiate with respect to more than "
         "one variable, e.g. $f_{xy}$ and $f_{yx}$.", ["S002·9", "T002 00:00:06"], []),
    ],
    "T2": [
        ("Derivative (one variable)", "For $y=f(x)$, $dy/dx$ is the change in $y$ produced by a change in "
         "position along the $x$-axis; at a point it equals the slope of the tangent to the curve.",
         ["S002·4", "T002 00:02:50"], []),
    ],
    "T3": [
        ("Bivariate function", "A function $z=f(x,y)$ of two independent variables. Its graph is a surface "
         "in three dimensions.", ["T002 00:04:16"], []),
        ("Curve on a surface", "If the points $(x,y)$ are restricted to a curve in the $xy$-plane (circle, "
         "parabola, …), the points $(x,y,f(x,y))$ form a curve that lies on the surface.", ["S002·5"], []),
    ],
    "T4": [
        ("Partial derivative, geometrically", "The slope of the tangent line to the surface $z=f(x,y)$ at "
         "$(x_0,y_0)$, along the direction of the variable you differentiate with respect to.", ["S002·6"], []),
        ("Trace (plane section)", "The curve cut from the surface by a vertical plane such as $y=y_0$ "
         "(giving $z=f(x,y_0)$) or $x=x_0$ (giving $z=f(x_0,y)$).", ["S002·7"], [ADD]),
    ],
    "T5": [
        ("Gradient", "The vector $\\nabla f=f_x\\,\\mathbf{i}+f_y\\,\\mathbf{j}$: the resultant of the two "
         "slope components along the $x$- and $y$-axes.", ["S002·8", "T002 00:09:23"], []),
        ("Directional derivative", "The slope of the surface in the direction of a unit vector $\\hat u$: "
         "$D_{\\hat u}f=\\nabla f\\cdot\\hat u$. It is studied in vector calculus.", ["T002 00:09:54"], [ADD]),
    ],
    "T6": [
        ("Concave up in the x direction", "The trace in the $x$ direction bends upward; the $x$-slope "
         "increases as $x$ increases. Indicated by $f_{xx}>0$.", ["S002·9"], []),
        ("Mixed partial $f_{xy}$", "Tells how the rate of change of $f(x,y)$ in the $x$ direction is changing "
         "as we move in the $y$ direction.", ["S002·9"], []),
    ],
    "T7": [
        ("Clairaut's theorem", "If $f_{xy}$ and $f_{yx}$ are continuous near a point, they are equal there. "
         "The class plans to verify it in the next session.", ["T002 00:14:59"], [TONLY, ADD]),
    ],
}

# ----------------------------------------------------------------------------- formulas
# (id, topic, title, tex, gives, when, notes, stars, srcs, flags)
FORMULAS = [
    ("F1", "T1", "First-order partial derivatives",
     r"f_x=\frac{\partial f}{\partial x},\qquad f_y=\frac{\partial f}{\partial y}",
     "Rate of change of $f$ in the $x$ (or $y$) direction.",
     "Differentiate once; hold the other variable constant.",
     "Two of them for a function of two variables.", 2, ["S002·3", "T002 00:00:44"], []),
    ("F2", "T1", "Second-order partial derivatives",
     r"f_{xx}=\frac{\partial^2 f}{\partial x^2},\quad f_{yy}=\frac{\partial^2 f}{\partial y^2},\quad "
     r"f_{xy}=\frac{\partial}{\partial y}\!\left(\frac{\partial f}{\partial x}\right)=\frac{\partial^2 f}{\partial y\,\partial x},\quad "
     r"f_{yx}=\frac{\partial^2 f}{\partial x\,\partial y}",
     "The four second-order partials of $f(x,y)$.",
     "Differentiate twice. In $f_{xy}$, the subscripts are read left to right: first $x$, then $y$.",
     "Notation order varies between books. The two mixed partials are equal when continuous (F4).", 2,
     ["S002·3", "T002 00:00:58"], [ADD]),
    ("F3", "T1", "How many partial derivatives of order n?",
     r"\text{2 variables: } 2^n \qquad\qquad m \text{ variables: } m^n",
     "The number of $n$th-order partial derivatives, counting each order of differentiation separately.",
     "Two variables: 2 first-order, 4 second-order, 8 third-order.",
     "With equal mixed partials, two variables give only $n+1$ distinct ones.", 1,
     ["S002·3", "T002 00:01:37", "T002 00:02:13"], []),
    ("F4", "T1", "Equality of mixed partials (Clairaut)",
     r"f_{xy}=f_{yx}\quad\Longleftrightarrow\quad \frac{\partial^2 f}{\partial y\,\partial x}=\frac{\partial^2 f}{\partial x\,\partial y}",
     "Order of differentiation does not matter.",
     "When $f_{xy}$ and $f_{yx}$ are continuous (true for every function in this unit's problems).",
     "Verified in CW U1 P2 and P8.", 2, ["T002 00:00:24", "T002 00:14:59", "CW U1 P2"], [TONLY, ADD]),
    ("F5", "T2", "Derivative as slope (one variable)",
     r"\left.\frac{dy}{dx}\right|_{x_0}=f'(x_0)=\text{slope of the tangent to } y=f(x) \text{ at } (x_0,f(x_0))",
     "Slope of the tangent line.", "$f$ differentiable at $x_0$.", "", 1, ["S002·4", "T002 00:03:13"], []),
    ("F6", "T2", "Tangent line to y = f(x)",
     r"y-f(x_0)=f'(x_0)\,(x-x_0)",
     "Equation of the tangent at $x_0$.", "$f$ differentiable at $x_0$.", "Point-slope form.", 1,
     ["S002·4"], [ADD]),
    ("F7", "T4", "∂f/∂x as an ordinary derivative",
     r"\left.\frac{\partial f}{\partial x}\right|_{(x_0,y_0)}=\left.\frac{d}{dx}\big(f(x,y_0)\big)\right|_{x=x_0}",
     "Slope of the tangent to the surface at $(x_0,y_0,f(x_0,y_0))$ that is parallel to the $x$-axis.",
     "Fix $y=y_0$ first; $f(x,y_0)$ depends only on $x$.", "The tangent lies in the plane $y=y_0$.", 2,
     ["S002·7", "V002 00:07:45", "T002 00:06:10"], []),
    ("F8", "T4", "∂f/∂y as an ordinary derivative",
     r"\left.\frac{\partial f}{\partial y}\right|_{(x_0,y_0)}=\left.\frac{d}{dy}\big(f(x_0,y)\big)\right|_{y=y_0}",
     "Slope of the tangent to the surface that is parallel to the $y$-axis.",
     "Fix $x=x_0$ first; $f(x_0,y)$ “just depends on $y$”.", "The tangent lies in the plane $x=x_0$.", 2,
     ["S002·7", "V002 00:07:45", "T002 00:07:10"], []),
    ("F9", "T4", "The two tangent lines at P",
     r"\begin{aligned}&x\text{-direction: } z-z_0=f_x(x_0,y_0)\,(x-x_0),\ \ y=y_0\\ "
     r"&y\text{-direction: } z-z_0=f_y(x_0,y_0)\,(y-y_0),\ \ x=x_0\end{aligned}",
     "Equations of the tangents whose slopes are $f_x$ and $f_y$.", "$z_0=f(x_0,y_0)$.",
     "Point-slope form inside each plane section.", 1, ["S002·7"], [ADD]),
    ("F10", "T5", "Gradient",
     r"\nabla f=f_x\,\mathbf{i}+f_y\,\mathbf{j}",
     "Vector whose components are the slopes along the $x$- and $y$-axes.",
     "Taken at the point $(x_0,y_0)$.", "Covered fully in vector calculus.", 1,
     ["S002·8", "T002 00:09:23"], []),
    ("F11", "T5", "Slope along any direction (directional derivative)",
     r"D_{\hat u}f=\nabla f\cdot\hat u=a\,f_x+b\,f_y,\qquad \hat u=(a,b),\ a^2+b^2=1",
     "Slope of the tangent in the direction $\\hat u$.",
     "$\\hat u$ must be a unit vector.",
     "$\\hat u=\\mathbf i$ gives $f_x$; $\\hat u=\\mathbf j$ gives $f_y$. The largest slope is $|\\nabla f|$.", 1,
     ["S002·8"], [ADD]),
    ("F12", "T6", "Concavity from second partials",
     r"f_{xx}>0\Rightarrow\text{concave up in } x,\qquad f_{yy}>0\Rightarrow\text{concave up in } y",
     "Shape of the surface along each axis direction.",
     "$f_{xx}<0$ (or $f_{yy}<0$) gives concave down in that direction.",
     "Same test as $d^2y/dx^2$ for one variable.", 2, ["S002·9", "T002 00:11:19"], []),
    ("F13", "T6", "Mixed partial as a change of slope",
     r"f_{xy}=\frac{\partial}{\partial y}\big(f_x\big)",
     "How the $x$-slope $f_x$ changes as you move in the $y$ direction.",
     "Likewise $f_{yx}=\\partial(f_y)/\\partial x$: the change of the $y$-slope along $x$.",
     "", 2, ["S002·9", "T002 00:11:45"], []),
    ("F14", "T6", "Names of higher derivatives (motion)",
     r"\frac{dy}{dt}=\text{velocity},\quad \frac{d^2y}{dt^2}=\text{acceleration},\quad \frac{d^3y}{dt^3}=\text{jerk}",
     "Physical meaning when the independent variable is time.", "One-variable analogy only.",
     "Names exist up to about the 6th derivative.", 1, ["T002 00:10:23", "T002 00:10:57"], [TONLY]),
]

# ----------------------------------------------------------------------------- symbols
SYMBOLS = [
    ("$f,\\ z$", "Function / dependent variable", "$z=f(x,y)$; its graph is a surface", "F1–F13"),
    ("$x,\\ y$", "Independent variables", "Coordinates in the $xy$-plane", "all"),
    ("$(x_0,y_0)$", "Base point", "Point where the derivatives are evaluated", "F7–F11"),
    ("$P,\\ z_0$", "Point on the surface", "$P=(x_0,y_0,z_0)$ with $z_0=f(x_0,y_0)$", "F9"),
    ("$\\partial$", "“Partial”, read “dou”", "Differentiate one variable, hold the others constant", "F1–F4"),
    ("$f_x,\\ f_y$", "First-order partials", "Slopes parallel to the $x$- and $y$-axes", "F1, F7–F11"),
    ("$f_{xx},\\ f_{yy}$", "Pure second-order partials", "Concavity along $x$ and along $y$", "F2, F12"),
    ("$f_{xy},\\ f_{yx}$", "Mixed second-order partials", "Change of one slope along the other direction", "F2, F4, F13"),
    ("$m,\\ n$", "Counts", "$m$ = number of variables, $n$ = order", "F3"),
    ("$f'(x_0),\\ dy/dx$", "Ordinary derivative", "Slope of a tangent to a plane curve", "F5, F6"),
    ("$\\nabla f$", "Gradient (“del $f$”)", "$f_x\\,\\mathbf i+f_y\\,\\mathbf j$", "F10, F11"),
    ("$\\mathbf i,\\ \\mathbf j$", "Unit vectors", "Along the $x$- and $y$-axes", "F10"),
    ("$\\hat u=(a,b)$", "Unit direction vector", "$a^2+b^2=1$", "F11"),
    ("$D_{\\hat u}f$", "Directional derivative", "Slope of the surface in direction $\\hat u$", "F11"),
    ("$t$", "Time (in F14)", "Independent variable in the motion analogy", "F14"),
]

# ----------------------------------------------------------------------------- statements (verbatim slide wording)
STATEMENTS = {
    "T1": [("A function of 2 variables has two first order derivatives, four second order derivatives and "
            "$2^n$ of nth order derivatives. A function of m independent variables will have $m^n$ derivatives of order n.",
            ["S002·3"])],
    "T2": [("We know that the derivative of a single valued function gives the slope of the tangent line to the "
            "curve at the given point.", ["S002·4"])],
    "T3": [("If the points (x,y) lie on a circle in the xy plane, then z = f(x,y) is a curve which looks like the "
            "graph shown. If the points (x,y) lie on a parabola in the xy plane, then z = f(x,y) is a curve which "
            "looks like the graph shown.", ["S002·5"])],
    "T4": [("Partial derivative of the function f(x,y) at the point $(x_0,y_0)$ can be visualized as the slope of "
            "the tangent line along the direction of the independent variable with respect to which we would "
            "differentiate the function.", ["S002·6"])],
    "T5": [("Slope of tangent along any arbitrary direction (Gradient of a function). What about other directions "
            "than parallel to x and y?", ["S002·8"])],
    "T6": [("If $f_{xx}>0$ then f(x,y) is concave up in the x direction. If $f_{yy}>0$ then f(x,y) is concave up in "
            "the y direction. Mixed partials tell us how a partial in one variable is changing in the direction of "
            "the other. $f_{xy}$ tells us how the rate of change of f(x,y) in the x direction is changing as we "
            "move in the y direction.", ["S002·9"])],
}

# ----------------------------------------------------------------------------- important points
# (text, stars, srcs, flags)
POINTS = {
    "T1": [
        ("A partial derivative is taken with respect to one variable while every other variable is held constant.", 2, ["T002 00:00:06"], []),
        ("Differentiating a first-order partial again gives a second-order partial; $n$ differentiations give an $n$th-order partial.", 2, ["S002·3"], []),
        ("For $f(x,y)$: 2 first-order ($f_x,f_y$), 4 second-order ($f_{xx},f_{yy},f_{xy},f_{yx}$), $2^n$ of order $n$.", 2, ["S002·3", "T002 00:00:44"], []),
        ("For $f(x_1,\\dots,x_m)$: $m^n$ derivatives of order $n$; e.g. $m^2$ second-order partials.", 1, ["S002·3", "T002 00:02:13"], []),
        ("The two mixed partials “were equal” in the class examples: $f_{xy}=f_{yx}$ for the smooth functions of this unit.", 2, ["T002 00:00:24"], [TONLY]),
    ],
    "T2": [
        ("A derivative always represents change: $dy/dx$ is the change on the curve as you change your position on the $x$-axis.", 1, ["T002 00:02:50", "T002 00:02:59"], []),
        ("At a particular point, the derivative is the slope of the tangent at that point.", 1, ["S002·4", "T002 00:03:13"], []),
    ],
    "T3": [
        ("A function of two independent variables always gives a surface in three dimensions: each $(x,y)$ has one $z$.", 1, ["T002 00:04:16"], []),
        ("Restricting $(x,y)$ to a curve in the $xy$-plane (circle, parabola) picks out a curve on the surface.", 1, ["S002·5", "T002 00:03:32"], []),
    ],
    "T4": [
        ("A surface has infinitely many tangents at a given point, one for every direction.", 2, ["T002 00:05:24", "T002 00:05:35"], []),
        ("$z_x$ at $(x_0,y_0)$ is the slope of the tangent to the surface at that point which is parallel to the $x$-axis.", 2, ["T002 00:06:10", "T002 00:06:27"], []),
        ("$z_y$ at $(x_0,y_0)$ is the slope of the tangent parallel to the $y$-axis.", 2, ["T002 00:07:10", "T002 00:07:54"], []),
        ("To find $\\partial f/\\partial x$ at $(x_0,y_0)$: put $y=y_0$, which gives a curve $f(x,y_0)$ in one variable, then differentiate it at $x=x_0$.", 2, ["S002·7"], []),
        ("The cutting plane $y=y_0$ slices the surface in the curve whose slope is $f_x$; the plane $x=x_0$ gives the curve whose slope is $f_y$.", 2, ["S002·7", "V002 00:07:45"], []),
    ],
    "T5": [
        ("$f_x$ and $f_y$ only give slopes in two directions; most tangents are parallel to neither axis.", 1, ["S002·8", "T002 00:08:22"], []),
        ("Any line in the plane can be resolved into components along the $x$- and $y$-axes; vector addition of the components gives the resultant.", 1, ["T002 00:09:06", "T002 00:09:23"], []),
        ("The resultant of $f_x\\,\\mathbf i$ and $f_y\\,\\mathbf j$ is the gradient $\\nabla f$, studied in vector calculus.", 1, ["S002·8", "T002 00:09:44"], []),
        ("The slope in a unit direction $\\hat u=(a,b)$ is $a f_x+b f_y$. It is greatest, equal to $|\\nabla f|$, in the direction of $\\nabla f$.", 1, ["S002·8"], [ADD]),
    ],
    "T6": [
        ("As in one variable (concave up or down from $d^2y/dx^2$), the second-order partials describe how the surface bends.", 2, ["T002 00:11:03", "T002 00:11:19"], []),
        ("$f_{xx}>0$ means concave up in the $x$ direction; $f_{yy}>0$ means concave up in the $y$ direction.", 2, ["S002·9", "T002 00:11:38"], []),
        ("$f_{xx}<0$ (or $f_{yy}<0$) means concave down in that direction. One surface can be up in $x$ and down in $y$, as in a saddle.", 2, ["S002·9"], [ADD]),
        ("$f_{xy}$ is the change in $f_x$ along the $y$ direction; $f_{yx}$ is the change in $f_y$ along the $x$ direction.", 2, ["S002·9", "T002 00:11:45", "T002 00:12:04"], []),
        ("The class demo, “Second-Order Partial Derivatives”, lets you set the signs of $f_{xx}$, $f_{yy}$ and $f_{xy}$ and watch the red tangent line move in 3D and contour views.", 1, ["S002·10", "V002 00:12:40", "T002 00:12:40"], []),
    ],
    "T7": [
        ("Evaluate at the point only after all the differentiations are done.", 2, ["CW U1 P1", "ESA Dec-23 1a"], [ADD]),
        ("To verify $f_{xy}=f_{yx}$, work out each side separately and compare them.", 2, ["CW U1 P2"], []),
    ],
}

WHY = {
    "T4": [
        ("Why are there infinitely many tangents at one point of a surface?",
         "From the point you can move in infinitely many directions in the $xy$-plane. Each direction traces a "
         "different curve on the surface, and each curve has its own tangent at $P$.", ["T002 00:04:36", "T002 00:05:24"], []),
        ("Why does fixing $y=y_0$ turn $\\partial f/\\partial x$ into an ordinary derivative?",
         "Once $y=y_0$, $f(x,y_0)$ depends on $x$ alone. It is a plane curve in the plane $y=y_0$, and its "
         "ordinary derivative at $x_0$ is the slope of its tangent.", ["S002·7"], []),
    ],
    "T5": [
        ("Why can't $f_x$ or $f_y$ alone give the slope along a diagonal direction?",
         "Each is the slope along one axis only. A diagonal direction has both an $x$- and a $y$-component, so "
         "both slopes contribute. Combining them gives the gradient, and its dot product with the unit "
         "direction gives the slope.", ["S002·8", "T002 00:09:06"], []),
    ],
    "T6": [
        ("Why does $f_{xx}>0$ mean concave up in $x$?",
         "$f_{xx}$ is the rate of change of the $x$-slope as $x$ increases. If it is positive, the tangent "
         "keeps tilting upward as you move along $x$, so the trace bends upward.", ["S002·9", "T002 00:11:19"], []),
        ("Why do the 4 second-order partials usually give only 3 different values?",
         "For the smooth functions used in this unit the mixed partials are equal, $f_{xy}=f_{yx}$ "
         "(Clairaut), leaving only $f_{xx}$, $f_{yy}$ and $f_{xy}$.", ["T002 00:00:24"], [ADD]),
    ],
}

TRAPS = {
    "T1": [("In $f_{xy}$ the order is $x$ first, then $y$. Some books write the same derivative as "
            "$\\partial^2 f/\\partial y\\,\\partial x$. Both mean the same, and for this unit's functions the order does not change the answer.", [ADD])],
    "T4": [("“Parallel to the $x$-axis” describes the tangent's direction seen from above (it lies in the plane "
            "$y=y_0$). It does not mean the tangent is horizontal: its slope is $f_x(x_0,y_0)$, which is "
            "usually not zero.", [ADD]),
           ("Hold the other variable constant before differentiating. Do not substitute $x=x_0$ before "
            "differentiating with respect to $x$.", [ADD])],
    "T7": [("In these problems $\\log$ is the natural logarithm: $\\frac{d}{dy}\\log y=\\frac1y$.", [ADD]),
           ("For $x^y$: with respect to $x$ it is a power, $y\\,x^{y-1}$; with respect to $y$ it is an exponential, $x^y\\log x$.", [ADD])],
}

# ----------------------------------------------------------------------------- worked examples
# (id, topic, title, source, stars, given, [steps], answer, check)
WORKED = [
    ("W1", "T4", "Slopes of the two tangents on a dome", ["S002·6", "S002·7"], 2,
     "$f(x,y)=4-x^2-y^2$ (the dome in Figures G4–G7), point $(x_0,y_0)=(1,-0.5)$.",
     ["Height: $z_0=4-1-0.25=2.75$, so $P=(1,-0.5,2.75)$.",
      "Fix $y=-0.5$: $f(x,-0.5)=3.75-x^2$, so $\\dfrac{d}{dx}(3.75-x^2)=-2x=-2$ at $x=1$.",
      "Fix $x=1$: $f(1,y)=3-y^2$, so $\\dfrac{d}{dy}(3-y^2)=-2y=1$ at $y=-0.5$.",
      "Read: moving parallel to the $x$-axis the surface falls 2 units per unit step; parallel to the $y$-axis it rises 1."],
     "$f_x(1,-0.5)=-2,\\quad f_y(1,-0.5)=1$",
     "Directly: $f_x=-2x$ and $f_y=-2y$ give the same values."),
    ("W2", "T5", "Gradient and the slope along a diagonal", ["S002·8"], 1,
     "Same dome and point as W1; direction $\\hat u=\\tfrac{1}{\\sqrt2}(1,-1)$.",
     ["$\\nabla f=f_x\\,\\mathbf i+f_y\\,\\mathbf j=-2\\,\\mathbf i+\\mathbf j$.",
      "$D_{\\hat u}f=\\tfrac{1}{\\sqrt2}(-2)+\\left(-\\tfrac{1}{\\sqrt2}\\right)(1)=-\\tfrac{3}{\\sqrt2}$.",
      "Steepest slope: $|\\nabla f|=\\sqrt{4+1}=\\sqrt5$, in the direction of $\\nabla f$."],
     "$D_{\\hat u}f=-3/\\sqrt2\\approx-2.121,\\quad |\\nabla f|=\\sqrt5\\approx2.236$",
     "$|D_{\\hat u}f|\\le|\\nabla f|$, as it must be."),
    ("W3", "T6", "Concave up in x, concave down in y", ["S002·9"], 2,
     "$f(x,y)=x^2-y^2$ at the origin (Figure G9).",
     ["$f_x=2x$, $f_{xx}=2>0$: concave up in the $x$ direction.",
      "$f_y=-2y$, $f_{yy}=-2<0$: concave down in the $y$ direction.",
      "$f_{xy}=\\partial(2x)/\\partial y=0$: the $x$-slope does not change as $y$ changes."],
     "Saddle: up along $x$, down along $y$", "Traces $z=x^2$ (at $y=0$) and $z=-y^2$ (at $x=0$) agree."),
    ("W4", "T6", "Reading a mixed partial", ["S002·9"], 2,
     "$f(x,y)=x^2y$ at $x_0=1$ (Figure G10).",
     ["$f_x=2xy$, so at $x=1$ the $x$-slope is $2y$: 1, 2, 3 for $y=0.5,1,1.5$.",
      "$f_{xy}=\\partial(2xy)/\\partial y=2x=2$ at $x=1$.",
      "Each unit step in $y$ raises the $x$-slope by 2, which matches the slopes 1 → 2 → 3 for steps of 0.5."],
     "$f_{xy}(1,y)=2$", "$f_{yx}=\\partial(x^2)/\\partial x=2x=2$ as well."),
    ("W5", "T7", "First-order partials at a point", ["CW U1 P1(i)"], 2,
     "$f(x,y)=x^4-x^2y^2+y^4$ at $(-1,1)$.",
     ["$f_x=4x^3-2xy^2=-4+2=-2$.", "$f_y=-2x^2y+4y^3=-2+4=2$.",
      "Geometrically, the tangents parallel to the $x$- and $y$-axes at $(-1,1,1)$ have slopes $-2$ and $2$."],
     "$f_x(-1,1)=-2,\\quad f_y(-1,1)=2$", "Matches the answer printed on the CW sheet."),
    ("W6", "T7", "First-order partials of a product", ["CW U1 P1(ii)"], 2,
     "$f(x,y)=x^2e^{-y/x}$ at $(4,2)$.",
     ["$f_x=2x\\,e^{-y/x}+x^2e^{-y/x}\\cdot\\dfrac{y}{x^2}=(2x+y)\\,e^{-y/x}=10\\,e^{-1/2}$.",
      "$f_y=x^2e^{-y/x}\\cdot\\left(-\\dfrac1x\\right)=-x\\,e^{-y/x}=-4\\,e^{-1/2}$."],
     "$f_x=10e^{-1/2},\\quad f_y=-4e^{-1/2}$", "Matches the CW answer key."),
    ("W7", "T7", "Verify that the mixed partials are equal", ["CW U1 P2"], 2,
     "$f(x,y)=x^y$, $x>0$.",
     ["$f_x=y\\,x^{y-1}$ (power rule); $f_y=x^y\\log x$ (exponential rule).",
      "$f_{xy}=\\dfrac{\\partial}{\\partial y}\\big(y\\,x^{y-1}\\big)=x^{y-1}+y\\,x^{y-1}\\log x=x^{y-1}(1+y\\log x)$.",
      "$f_{yx}=\\dfrac{\\partial}{\\partial x}\\big(x^y\\log x\\big)=y\\,x^{y-1}\\log x+x^y\\cdot\\dfrac1x=x^{y-1}(1+y\\log x)$."],
     "$f_{xy}=f_{yx}=x^{y-1}(1+y\\log x)$", "Both sides are identical, as Clairaut's theorem predicts."),
    ("W8", "T7", "Third-order partials at a point", ["ESA Dec-23 1a", "CW U1 P5"], 2,
     "$f(x,y)=e^x\\log y+\\cos y\\log x$ at $(1,\\pi/2)$. Find $f_{xxx}$, $f_{xyy}$, $f_{yyy}$.",
     ["$f_x=e^x\\log y+\\dfrac{\\cos y}{x}$, $f_{xx}=e^x\\log y-\\dfrac{\\cos y}{x^2}$, $f_{xxx}=e^x\\log y+\\dfrac{2\\cos y}{x^3}$.",
      "$f_{xy}=\\dfrac{e^x}{y}-\\dfrac{\\sin y}{x}$, $f_{xyy}=-\\dfrac{e^x}{y^2}-\\dfrac{\\cos y}{x}$.",
      "$f_y=\\dfrac{e^x}{y}-\\sin y\\log x$, $f_{yy}=-\\dfrac{e^x}{y^2}-\\cos y\\log x$, $f_{yyy}=\\dfrac{2e^x}{y^3}+\\sin y\\log x$.",
      "At $(1,\\pi/2)$: $\\cos y=0$, $\\sin y=1$, $\\log 1=0$."],
     "$f_{xxx}=e\\log\\dfrac{\\pi}{2},\\quad f_{xyy}=-\\dfrac{4e}{\\pi^2},\\quad f_{yyy}=\\dfrac{16e}{\\pi^3}$",
     "Matches the CW key; it also gives $f_{xxy}=1+2e/\\pi$."),
    ("W9", "T7", "Value of n from a second-order equation", ["ESA Jan-24 s4 1c"], 2,
     "$\\theta=t^n e^{-r^2/4t}$. Find $n$ so that $\\dfrac{1}{r^2}\\dfrac{\\partial}{\\partial r}\\Big(r^2\\dfrac{\\partial\\theta}{\\partial r}\\Big)=\\dfrac{\\partial\\theta}{\\partial t}$.",
     ["$\\dfrac{\\partial\\theta}{\\partial r}=-\\dfrac{r}{2}\\,t^{n-1}e^{-r^2/4t}$, so $r^2\\dfrac{\\partial\\theta}{\\partial r}=-\\dfrac{r^3}{2}\\,t^{n-1}e^{-r^2/4t}$.",
      "$\\dfrac{1}{r^2}\\dfrac{\\partial}{\\partial r}(\\cdot)=\\left(-\\dfrac32\\,t^{n-1}+\\dfrac{r^2}{4}\\,t^{n-2}\\right)e^{-r^2/4t}$.",
      "$\\dfrac{\\partial\\theta}{\\partial t}=\\left(n\\,t^{n-1}+\\dfrac{r^2}{4}\\,t^{n-2}\\right)e^{-r^2/4t}$.",
      "Compare the $t^{n-1}$ terms: $n=-\\tfrac32$."],
     "$n=-\\dfrac32$", "The $r^2t^{n-2}$ terms agree on both sides for every $n$."),
]

# ----------------------------------------------------------------------------- past papers
PYQS = [
    ("T7", "ESA Dec 2023", "UE22MA141A Q1.a", 6,
     "If $f(x,y)=e^x\\log y+\\cos y\\log x$, find $f_{xxx}$, $f_{xyy}$ and $f_{yyy}$ at $(1,\\pi/2)$.", "W8"),
    ("T7", "ESA Jan 2024", "UE23MA141A set 4, Q1.c", 6,
     "If $\\theta=t^n e^{-r^2/4t}$, what value of $n$ will make $\\frac{1}{r^2}\\frac{\\partial}{\\partial r}\\big(r^2\\frac{\\partial\\theta}{\\partial r}\\big)=\\frac{\\partial\\theta}{\\partial t}$?", "W9"),
]
PYQ_NOTE = ("Eight past ESA papers were checked: UE22MA141A Dec 2023, May 2024 and Jul 2023, and UE23MA141A Jan "
            "sets 1–4 and June 2024. None asks for the geometrical interpretation directly. Two 6-mark Q1 parts "
            "test higher-order partials, the computational half of this session. Other Unit 1 questions (Euler, "
            "Taylor, maxima, Lagrange, chain rule) belong to later sessions and are left out. ESA stars: ★★ = "
            "computed in ESA or CW problems; ★ = conceptual, explained in class but not examined so far.")

# ----------------------------------------------------------------------------- short notes
NOTES = {
    "T1": "Differentiating $f(x,y)$ once gives the first-order partials $f_x$, $f_y$; differentiating again gives "
          "four second-order partials $f_{xx}$, $f_{yy}$, $f_{xy}$, $f_{yx}$. In general $n$ differentiations give "
          "$2^n$ partials of order $n$ for two variables and $m^n$ for $m$ variables. In $f_{xy}$, differentiate "
          "first in $x$, then in $y$. When the mixed partials are continuous, $f_{xy}=f_{yx}$ (Clairaut).",
    "T2": "For $y=f(x)$, $dy/dx$ measures how $y$ changes as $x$ changes. At $x_0$ it equals the slope of the "
          "tangent line to the curve at $(x_0,f(x_0))$, and the tangent is $y-f(x_0)=f'(x_0)(x-x_0)$.",
    "T3": "A bivariate function $z=f(x,y)$ assigns one height to each point of the $xy$-plane, so its graph is a "
          "surface in 3-D. Points $(x,y)$ on a circle or parabola in the $xy$-plane give a curve lying on that surface.",
    "T4": "A surface has infinitely many tangents at a point $P(x_0,y_0,f(x_0,y_0))$. $\\partial f/\\partial x$ at "
          "$(x_0,y_0)$ is the slope of the tangent parallel to the $x$-axis. It is found by cutting the surface "
          "with the plane $y=y_0$ and differentiating the curve $f(x,y_0)$ at $x_0$. Likewise $\\partial f/\\partial y$ "
          "is the slope of the tangent parallel to the $y$-axis, from the curve $f(x_0,y)$ in the plane $x=x_0$.",
    "T5": "Tangents in other directions are handled by resolving the direction into $x$- and $y$-components. The "
          "resultant of $f_x\\,\\mathbf i$ and $f_y\\,\\mathbf j$ is the gradient $\\nabla f$. The slope along a unit "
          "vector $\\hat u$ is $\\nabla f\\cdot\\hat u$, and the largest slope is $|\\nabla f|$.",
    "T6": "Second-order partials describe bending. If $f_{xx}>0$ the surface is concave up in the $x$ direction; if "
          "$f_{yy}>0$ it is concave up in the $y$ direction (negative means concave down). The mixed partial "
          "$f_{xy}$ tells how the rate of change of $f$ in the $x$ direction changes as we move in the $y$ direction.",
    "T7": "To find partials at a point, differentiate fully, holding the other variable constant, and substitute "
          "only at the end. To verify $f_{xy}=f_{yx}$, compute each side separately and compare. Watch the rule "
          "used: $x^y$ is a power in $x$ but an exponential in $y$.",
}

KEYWORDS = [
    ("Acceleration", "Second derivative of position with respect to time ($d^2y/dt^2$).", "T6"),
    ("Bivariate function", "A function of two independent variables, $z=f(x,y)$.", "T3"),
    ("Clairaut's theorem", "Continuous mixed partials are equal: $f_{xy}=f_{yx}$.", "T1"),
    ("Concave down (in x)", "The trace along $x$ bends downward; $f_{xx}<0$.", "T6"),
    ("Concave up (in x)", "The trace along $x$ bends upward; $f_{xx}>0$.", "T6"),
    ("Contour plot", "Level curves of $z=f(x,y)$ drawn in the $xy$-plane; one view in the class demo.", "T6"),
    ("Curve on a surface", "The points $(x,y,f(x,y))$ above a curve in the $xy$-plane.", "T3"),
    ("Derivative", "Rate of change; geometrically, the slope of the tangent.", "T2"),
    ("Directional derivative", "Slope along a unit vector $\\hat u$: $\\nabla f\\cdot\\hat u$.", "T5"),
    ("First-order partial", "$f_x$ or $f_y$: obtained by differentiating once.", "T1"),
    ("Gradient", "$\\nabla f=f_x\\,\\mathbf i+f_y\\,\\mathbf j$; resultant of the axis slopes.", "T5"),
    ("Higher-order partial", "A partial obtained by differentiating 3, 4, … $n$ times.", "T1"),
    ("Independent variable", "An input ($x$ or $y$) that can be varied freely.", "T3"),
    ("Jerk", "Third derivative of position with respect to time.", "T6"),
    ("Mixed partial", "$f_{xy}$ or $f_{yx}$: differentiate with respect to different variables.", "T1"),
    ("Multivariable function", "A function of two or more independent variables.", "T1"),
    ("nth-order partial", "Obtained by $n$ differentiations; $2^n$ of them for two variables.", "T1"),
    ("Partial derivative", "Derivative with respect to one variable, the others held constant.", "T1"),
    ("Partial direction", "The variable ($x$ or $y$) along which the tangent is drawn.", "T4"),
    ("Plane section (trace)", "Curve cut from the surface by $y=y_0$ or $x=x_0$.", "T4"),
    ("Point of tangency", "$P=(x_0,y_0,f(x_0,y_0))$, where the tangents touch the surface.", "T4"),
    ("Rate of change", "How fast the output changes per unit change of an input.", "T2"),
    ("Resultant", "Vector sum of components; gives the gradient from $f_x$, $f_y$.", "T5"),
    ("Saddle", "Surface concave up in one direction and down in another, e.g. $x^2-y^2$.", "T6"),
    ("Second-order partial", "$f_{xx},f_{yy},f_{xy},f_{yx}$: obtained by differentiating twice.", "T1"),
    ("Single-valued function", "Gives exactly one output for each input.", "T2"),
    ("Slope", "Rise per unit run of a line; for a tangent, the derivative.", "T2"),
    ("Surface", "Graph of $z=f(x,y)$ in three dimensions.", "T3"),
    ("Tangent line", "Line touching a curve at a point with the curve's slope there.", "T2"),
    ("Tangent parallel to the x-axis", "Tangent in the plane $y=y_0$; slope $f_x(x_0,y_0)$.", "T4"),
    ("Tangent parallel to the y-axis", "Tangent in the plane $x=x_0$; slope $f_y(x_0,y_0)$.", "T4"),
    ("Unit vector", "Vector of length 1; fixes a direction $\\hat u=(a,b)$.", "T5"),
    ("Velocity", "First derivative of position with respect to time.", "T6"),
]

RAPID = [
    ("How many second-order partials does $f(x,y)$ have?", "Four: $f_{xx},f_{yy},f_{xy},f_{yx}$."),
    ("How many third-order partials does $f(x,y)$ have?", "$2^3=8$."),
    ("How many partials of order $n$ for $m$ variables?", "$m^n$."),
    ("What does $f'(x_0)$ mean geometrically?", "Slope of the tangent to $y=f(x)$ at $x_0$."),
    ("What is the graph of $z=f(x,y)$?", "A surface in 3-D."),
    ("What do points on a circle in the $xy$-plane give on the surface?", "A curve lying on the surface."),
    ("How many tangents does a surface have at a point?", "Infinitely many."),
    ("What is $f_x(x_0,y_0)$ geometrically?", "Slope of the tangent at $P$ parallel to the $x$-axis."),
    ("Which plane contains that tangent?", "The plane $y=y_0$."),
    ("What is $f_y(x_0,y_0)$ geometrically?", "Slope of the tangent at $P$ parallel to the $y$-axis."),
    ("How do you compute $f_x(x_0,y_0)$ as an ordinary derivative?", "$\\frac{d}{dx}f(x,y_0)$ at $x=x_0$."),
    ("Name the vector $f_x\\,\\mathbf i+f_y\\,\\mathbf j$.", "The gradient $\\nabla f$."),
    ("Slope along unit vector $(a,b)$?", "$a f_x+b f_y$."),
    ("What does $f_{xx}>0$ tell you?", "Concave up in the $x$ direction."),
    ("What does $f_{yy}<0$ tell you?", "Concave down in the $y$ direction."),
    ("What does $f_{xy}$ measure?", "Change of the $x$-slope as you move in $y$."),
    ("When is $f_{xy}=f_{yx}$?", "When both are continuous (Clairaut)."),
    ("$\\partial(x^y)/\\partial x$ and $\\partial(x^y)/\\partial y$?", "$y\\,x^{y-1}$ and $x^y\\log x$."),
    ("Physical names of $y',y'',y'''$ in time?", "Velocity, acceleration, jerk."),
    ("Is a tangent parallel to the $x$-axis horizontal?", "No; its slope is $f_x$, in the plane $y=y_0$."),
]

TOP_FACTS = [
    "A function of two variables has 2 first-order, 4 second-order and $2^n$ $n$th-order partials; $m$ variables give $m^n$.",
    "The derivative of a single-valued function is the slope of the tangent to its curve.",
    "$z=f(x,y)$ is a surface; points $(x,y)$ on a curve in the $xy$-plane give a curve on the surface.",
    "A surface has infinitely many tangents at a point.",
    "$f_x(x_0,y_0)$ = slope of the tangent parallel to the $x$-axis (in the plane $y=y_0$).",
    "$f_y(x_0,y_0)$ = slope of the tangent parallel to the $y$-axis (in the plane $x=x_0$).",
    "Other directions: resolve into components; the resultant of $f_x\\mathbf i$ and $f_y\\mathbf j$ is the gradient.",
    "$f_{xx}>0$: concave up in $x$; $f_{yy}>0$: concave up in $y$; negative means concave down.",
    "$f_{xy}$ = how the $x$-slope changes as you move in $y$.",
    "Continuous mixed partials are equal: $f_{xy}=f_{yx}$.",
]
TOP_FORMULAS = ["F2", "F3", "F7", "F8", "F10", "F12"]

# ----------------------------------------------------------------------------- figures
# id: (topic, title, stars, srcs, flags, how-to-read, tall?)
FIGS = {
    "G1": ("T2", "Derivative of y = f(x) as the slope of the tangent", "★", ["S002·4", "T002 00:03:13"], [],
           "The blue curve is $y=f(x)$, and the dashed vermilion line is its tangent at $x_0$. The small "
           "triangle shows the slope: a run of 1 gives a rise of $f'(x_0)$. In an exam, label the point, the "
           "tangent and the slope $dy/dx$ at $x_0$.", False),
    "G2": ("T3", "Points on a circle in the xy-plane give a curve on the surface", "★", ["S002·5", "T002 00:03:32"], [],
           "The blue circle lies in the $xy$-plane. Each grey line rises to $z=f(x,y)$, and the vermilion curve "
           "joins the tops: a closed curve lying on the surface $z=f(x,y)=2.2+0.8xy+0.5x$ (an illustrative choice).", False),
    "G3": ("T3", "Points on a parabola in the xy-plane give a curve on the surface", "★", ["S002·5", "T002 00:03:47"], [],
           "Same idea with a parabola $y=x^2-1.2$ in the $xy$-plane. Every point of the parabola has one height "
           "on the surface, so the vermilion curve lies on the surface above it.", False),
    "G4": ("T4", "A surface has infinitely many tangents at a point", "★★", ["S002·6", "T002 00:04:36", "T002 00:05:24"], [],
           "The dome is $z=4-x^2-y^2$ and $P=(1,-0.5,2.75)$. Each coloured line is a tangent to the surface at "
           "$P$ in a different direction. Partial differentiation picks out two of them: the ones parallel "
           "to the $x$- and $y$-axes.", True),
    "G5": ("T4", "∂z/∂x: the tangent parallel to the x-axis", "★★", ["S002·7", "V002 00:07:45", "T002 00:06:54"], [],
           "The grey plane $y=y_0$ cuts the dome in the blue trace $z=f(x,y_0)$. The dashed tangent to that "
           "trace at $P$ is parallel to the $x$-axis, and its slope is $\\partial z/\\partial x$ at $(x_0,y_0)$.", True),
    "G6": ("T4", "∂z/∂y: the tangent parallel to the y-axis", "★★", ["S002·7", "V002 00:07:45", "T002 00:07:10"], [],
           "The plane $x=x_0$ cuts the dome in the green trace $z=f(x_0,y)$, which “just depends on $y$”. The "
           "dashed tangent at $P$ is parallel to the $y$-axis, and its slope is $\\partial z/\\partial y$ at $(x_0,y_0)$.", True),
    "G7": ("T4", "The two traces seen flat, with numerical slopes", "★★", ["S002·7"], [ADD],
           "These are panels (a) and (b) from Figures G5 and G6, drawn in their own planes. At $P$, the tangent "
           "in (a) has slope $-2=f_x(1,-0.5)$ and the tangent in (b) has slope $1=f_y(1,-0.5)$. See worked example W1.", True),
    "G8": ("T5", "Resolving into components: the gradient", "★", ["S002·8", "T002 00:09:06", "V002 00:09:05"], [],
           "The slope components $f_x\\,\\mathbf i$ (blue) and $f_y\\,\\mathbf j$ (green) add by vector addition "
           "to give the resultant $\\nabla f$ (vermilion), drawn here for the dome at $(1,-0.5)$. The purple "
           "arrow is another direction $\\hat u$; the slope along it is $\\nabla f\\cdot\\hat u$ (W2).", False),
    "G9": ("T6", "Concave up in x, concave down in y: the saddle z = x² − y²", "★★", ["S002·9", "S002·10", "T002 00:11:19"], [ADD],
           "Along the $x$ direction (blue trace, $y=0$) the surface bends up, so $f_{xx}=2>0$. Along the $y$ "
           "direction (vermilion trace, $x=0$) it bends down, so $f_{yy}=-2<0$. One point can be concave up "
           "in one direction and concave down in another.", True),
    "G10": ("T6", "Mixed partial: how the x-slope changes as y changes", "★★", ["S002·9", "T002 00:11:45"], [ADD],
            "Three traces of $z=x^2y$, at $y=0.5$, $1$ and $1.5$. At $x_0=1$ their tangents have slopes "
            "$f_x=1,2,3$. The $x$-slope grows by 2 per unit of $y$, which is $f_{xy}=2$.", False),
}
