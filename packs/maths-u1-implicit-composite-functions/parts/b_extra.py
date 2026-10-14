"""New class-004 material: figures, flowcharts, notes and pack-wide lists."""
ADD = "added for clarity"

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "Level surfaces: spheres $x^2+y^2+z^2=c$", "stars": 1, "srcs": ["S004·4", "T004a 00:03:29", "T004a 00:03:42"],
     "tall": True,
     "howto": "Each shell is one level surface: on it $x^2+y^2+z^2$ has the same value $c$ (only the upper halves are drawn, as on "
              "the slide). Larger $c$ gives a larger sphere and $c=0$ gives the origin. Think of each shell as one isotherm or "
              "equipotential surface. Moving along a shell does not change $f$, so $df=0$ there."},
    {"id": "G5.1", "topic": "T5", "title": "Polar coordinates and the inner derivatives", "stars": 2, "srcs": ["S004·10", "S004·13", "S004·17"], "flags": [ADD],
     "howto": "A point at distance $r$ and angle $\\theta$ has $x=r\\cos\\theta$, $y=r\\sin\\theta$. Turning by $d\\theta$ moves it along the "
              "dashed circle, so $x_\\theta=-r\\sin\\theta$ and $y_\\theta=r\\cos\\theta$, while $r$ stays fixed. That is why any function "
              "of $x^2+y^2=r^2$ alone has $u_\\theta=0$."},
]

FLOWS = [
    {"id": "F4.2", "topic": "T4", "title": "Proving $u_x+u_y+u_z=0$ for $u=f(x-y,\\,y-z,\\,z-x)$.", "stars": 3, "srcs": ["ESA Jan-24 s2 1d", "T004b 00:02:31"],
     "layout": "straight", "maxw": "120mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$u=f(x-y,\\ y-z,\\ z-x)$", "sub": "Find $u_x+u_y+u_z$"},
         {"kind": "step", "n": 1, "title": "Name the arguments: the chain", "fx": "$p=x-y,\\ q=y-z,\\ w=z-x$"},
         {"kind": "step", "n": 2, "title": "Chain rule for each variable", "fx": "$u_x=f_p-f_w,\\ \\ u_y=-f_p+f_q,\\ \\ u_z=-f_q+f_w$"},
         {"kind": "check", "title": "Add the three lines", "sub": "Every $f_p$, $f_q$, $f_w$ cancels, so the sum is 0 whatever $f$ is."}]},
     "remark": "Same method for $f(x/y,y/z,z/x)$ with weights $x,y,z$ (W4.3): name the arguments, write each partial, then combine."},
    {"id": "F5.1", "topic": "T5", "title": "Solving a polar-coordinate composite problem.", "stars": 2, "srcs": ["S004·10", "S004·11", "S004·13", "S004·15", "T004b 00:07:52"],
     "layout": "ladder", "maxw": "165mm",
     "spec": {"start": {"kind": "given", "title": "$u=f(x,y)$ with $x=r\\cos\\theta,\\ y=r\\sin\\theta$", "sub": "Find $u_\\theta$ (or $u_r$)"},
              "rungs": [{"q": "Does $u$ depend only on $x^2+y^2$?", "yes": {"lab": "", "title": "$u_\\theta=0$", "sub": "$x^2+y^2=r^2$ has no $\\theta$; still show the working"}},
                        {"q": "Is $u=\\tan^{-1}(y/x)$?", "yes": {"lab": "", "title": "$u_\\theta=1$", "sub": "$u$ is $\\theta$ itself"}}],
              "last": {"kind": "step", "title": "Chain rule, then substitute and simplify",
                       "sub": "$u_\\theta=u_x(-r\\sin\\theta)+u_y(r\\cos\\theta)$; eliminate $x,y$ with $x=r\\cos\\theta$, $y=r\\sin\\theta$"}},
     "remark": "The first two rungs let you predict the answer; the exam still expects the full chain-rule working (W5.1, W5.3, W5.4)."},
]

NOTES = [
    {"topic": "T1", "text": "A relation $f(x,y)=c$ or $f(x_1,\\dots,x_n)=c$ defines an implicit function; geometrically it is a level curve or "
     "level surface (isotherm, equipotential surface), e.g. the cylinders $x^2+y^2=c$ or spheres $x^2+y^2+z^2=c$. On it $f$ does not "
     "change, so its total differential $df=f_x\\,dx+f_y\\,dy+\\dots=0$. The differential is also used in substitution in integrals and in "
     "error estimates."},
    {"topic": "T4", "text": "If $u=f(x,y)$ and $x,y$ depend on $s,t$ (or $r,\\theta$), $u$ is a composite function of $s,t$, and "
     "$u_s=f_x\\,x_s+f_y\\,y_s$, $u_t=f_x\\,x_t+f_y\\,y_t$: one term per intermediate variable. Write the chain first. If $f$ is unknown, "
     "keep $f_x,f_y$ as symbols. Eliminate $x,y$ from the final answer. Standard results: $u_x+u_y+u_z=0$ for $f(x-y,y-z,z-x)$; "
     "$xu_x+yu_y+zu_z=0$ for $f(x/y,y/z,z/x)$."},
    {"topic": "T5", "text": "With $x=r\\cos\\theta$, $y=r\\sin\\theta$: $x_\\theta=-r\\sin\\theta$, $y_\\theta=r\\cos\\theta$; with $r=\\sqrt{x^2+y^2}$, "
     "$\\theta=\\tan^{-1}(y/x)$: $r_x=x/r$, $r_y=y/r$, $\\theta_x=-y/r^2$, $\\theta_y=x/r^2$. Functions of $x^2+y^2$ alone have "
     "$u_\\theta=0$, $\\tan^{-1}(y/x)$ has $u_\\theta=1$, and $u_x^2+u_y^2=u_r^2+u_\\theta^2/r^2$."},
]

SYMBOLS = [
    {"sym": "$f(x,y)=c$", "name": "Level curve / implicit relation", "meaning": "Defines $y$ as a function of $x$", "where": "E2.1"},
    {"sym": "$f(x,y,z)=0$", "name": "Level surface", "meaning": "Defines $z$ as a function of $x,y$", "where": "E3.1"},
    {"sym": "$c,\\ c_1$", "name": "Level", "meaning": "The constant value of $f$ on one level surface", "where": "E2.1"},
    {"sym": "$f_x,f_y,f_z$", "name": "Partial derivatives of the relation", "meaning": "Numerator and denominator of the implicit formulas", "where": "E2.1, E3.1"},
    {"sym": "$df$, $dx$, $dy$", "name": "Differentials", "meaning": "$df=f_x\\,dx+f_y\\,dy$; zero on a level curve", "where": "E1.1"},
    {"sym": "$\\dfrac{dy}{dx}$", "name": "Slope of a level curve", "meaning": "$-f_x/f_y$", "where": "E2.1, E2.2"},
    {"sym": "$m$, $(x_0,y_0)$", "name": "Slope, point of contact", "meaning": "Tangent $y-y_0=m(x-x_0)$", "where": "E2.2"},
    {"sym": "$u=f(x,y)$", "name": "Composite function", "meaning": "Outer function of the chain (unknown $f$ kept as $f_x,f_y$)", "where": "E4.1"},
    {"sym": "$s,t$ / $u,v$", "name": "New variables", "meaning": "Final variables of the composite function", "where": "E4.1"},
    {"sym": "$p,q,w$", "name": "Named arguments", "meaning": "e.g. $p=x-y$, $q=y-z$, $w=z-x$", "where": "E4.2"},
    {"sym": "$r,\\theta$", "name": "Polar coordinates", "meaning": "$x=r\\cos\\theta$, $y=r\\sin\\theta$", "where": "E5.1, E5.2"},
    {"sym": "$r$ (slide 004·12)", "name": "Distance from the origin", "meaning": "$\\sqrt{x^2+y^2+z^2}$", "where": "E4.3"},
    {"sym": "$f'(r)$", "name": "Ordinary derivative", "meaning": "$u$ depends on $x,y,z$ only through $r$", "where": "E4.3"},
    {"sym": "$\\ln$, $\\log$", "name": "Natural logarithm", "meaning": "Appears from $a^x$ and from $x^x$", "where": "E2.3"},
]

KEYWORDS = [
    {"term": "Branch diagram", "meaning": "Diamond diagram: $f_x\\cdot1+f_y\\,dy/dx=0$.", "topic": "T2"},
    {"term": "Chain (of a problem)", "meaning": "What depends on what; fixes the formula.", "topic": "T4"},
    {"term": "Chain rule", "meaning": "$u_s=f_x\\,x_s+f_y\\,y_s$.", "topic": "T4"},
    {"term": "Composite function", "meaning": "A function whose variables are functions of other variables.", "topic": "T4"},
    {"term": "Constant power rule", "meaning": "$\\frac{d}{dx}a^x=a^x\\ln a$.", "topic": "T2"},
    {"term": "Cylinder", "meaning": "$x^2+y^2=c$: a level surface for each $c$.", "topic": "T1"},
    {"term": "Differential", "meaning": "$df=f_x\\,dx+f_y\\,dy$; also called the total derivative.", "topic": "T1"},
    {"term": "Direct method", "meaning": "Differentiate both sides of $f(x,y)=c$ term by term.", "topic": "T2"},
    {"term": "Elimination", "meaning": "Replacing $x,y$ by the new variables in the final answer.", "topic": "T4"},
    {"term": "Equipotential surface", "meaning": "Level surface of constant potential.", "topic": "T1"},
    {"term": "Error estimate", "meaning": "Application of the differential (end of the unit).", "topic": "T1"},
    {"term": "Explicit function", "meaning": "$y=g(x)$ given by a formula.", "topic": "T1"},
    {"term": "Formula method", "meaning": "$dy/dx=-f_x/f_y$ from partial derivatives.", "topic": "T2"},
    {"term": "Identity for any f", "meaning": "A result such as $u_x+u_y+u_z=0$ that holds whatever $f$ is.", "topic": "T4"},
    {"term": "Implicit differentiation", "meaning": "Finding $dy/dx$ or $z_x$ without solving the relation.", "topic": "T2"},
    {"term": "Implicit function", "meaning": "Function defined by a relation $f(x,y)=c$.", "topic": "T1"},
    {"term": "Integration by substitution", "meaning": "Uses the differential: $t=x^2$, $dt=2x\\,dx$.", "topic": "T1"},
    {"term": "Intermediate variable", "meaning": "Variable between $u$ and the final variables.", "topic": "T4"},
    {"term": "Isotherm", "meaning": "Level surface of constant temperature.", "topic": "T1"},
    {"term": "Level curve", "meaning": "$f(x,y)=c$ in the plane.", "topic": "T1"},
    {"term": "Level surface", "meaning": "$f(x,y,z)=c$; $f$ is constant on it.", "topic": "T1"},
    {"term": "Point on the surface", "meaning": "Must satisfy $f=0$ before you substitute it.", "topic": "T3"},
    {"term": "Polar coordinates", "meaning": "$x=r\\cos\\theta$, $y=r\\sin\\theta$.", "topic": "T5"},
    {"term": "Polar identity", "meaning": "$u_x^2+u_y^2=u_r^2+u_\\theta^2/r^2$.", "topic": "T5"},
    {"term": "Second implicit derivative", "meaning": "Differentiate $-f_x/f_z$ again, remembering $z=z(x,y)$.", "topic": "T3"},
    {"term": "Slope", "meaning": "$dy/dx=-f_x/f_y$ at a point.", "topic": "T2"},
    {"term": "Sphere", "meaning": "$x^2+y^2+z^2=c$: nested level surfaces.", "topic": "T1"},
    {"term": "Tangent line", "meaning": "$y-y_0=m(x-x_0)$.", "topic": "T2"},
    {"term": "Three-variable implicit function", "meaning": "$f(x,y,z)=0$, $z=z(x,y)$.", "topic": "T3"},
    {"term": "Variable power rule", "meaning": "$\\frac{d}{dx}x^n=nx^{n-1}$.", "topic": "T2"},
]

RAPID = [
    {"q": "What is a level surface?", "a": "A set where $f(x,y,z)=c$; $f$ is constant on it."},
    {"q": "Name two physical level surfaces.", "a": "Equipotential surfaces, isotherms."},
    {"q": "$df$ on a level curve?", "a": "$0$."},
    {"q": "$dy/dx$ for $f(x,y)=c$?", "a": "$-f_x/f_y$, if $f_y\\neq0$."},
    {"q": "Which way up is it?", "a": "Differentiated-by variable ($x$) on top: $-f_x/f_y$ (slide 004·4 is upside down)."},
    {"q": "$dy/dx$ for $x^3y+3xy^2=3$?", "a": "$-3y(x^2+y)/(x(x^2+6y))$."},
    {"q": "$dy/dx$ for $x^2+xy+y^2=7$?", "a": "$-(2x+y)/(x+2y)$."},
    {"q": "Tangent to $xe^y+ye^x=0$ at the origin?", "a": "$x+y=0$."},
    {"q": "$\\partial(\\cos x)^y/\\partial y$?", "a": "$(\\cos x)^y\\ln\\cos x$."},
    {"q": "$dy/dx$ for $e^y-e^x+xy=1$ at $(1,1)$?", "a": "$(e-1)/(e+1)$."},
    {"q": "$\\partial z/\\partial x$ from $f(x,y,z)=0$?", "a": "$-f_x/f_z$ (hold $y$)."},
    {"q": "$\\partial y/\\partial x$ from $f(x,y,z)=0$?", "a": "$-f_x/f_y$ (hold $z$)."},
    {"q": "$z^3+xy-y^2z=6$ at $(0,1,2)$: $y_x$, $z_x$?", "a": "$1/4$, $-1/11$."},
    {"q": "First check before substituting a point?", "a": "It satisfies the equation."},
    {"q": "$x^xy^yz^z=c$, $z_{xy}$ at $x=y=z$?", "a": "$-[x\\log(ex)]^{-1}$."},
    {"q": "Chain rule for $u_s$, $u=f(x,y)$?", "a": "$f_x\\,x_s+f_y\\,y_s$."},
    {"q": "$u=f(r)$, $r=\\sqrt{x^2+y^2+z^2}$: $u_x$?", "a": "$f'(r)\\,x/r$."},
    {"q": "$u=f(x-y,y-z,z-x)$: $u_x+u_y+u_z$?", "a": "$0$."},
    {"q": "$u=f(x/y,y/z,z/x)$: $xu_x+yu_y+zu_z$?", "a": "$0$."},
    {"q": "$z=\\log(u^2+v)$, $u=e^{x+y^2}$, $v=x+y^2$: $2yz_x-z_y$?", "a": "$0$."},
    {"q": "$x_\\theta$, $y_\\theta$ in polar form?", "a": "$-r\\sin\\theta$, $r\\cos\\theta$."},
    {"q": "$\\theta_x$, $\\theta_y$?", "a": "$-y/r^2$, $x/r^2$."},
    {"q": "$u=\\sin(x^2+y^2)$: $u_\\theta$?", "a": "$0$."},
    {"q": "$u=\\tan^{-1}(y/x)$: $u_\\theta$?", "a": "$1$."},
]

MNEMONICS = [
    "<i>“Implicit: minus, the one you differentiate by on top.”</i> $\\dfrac{dy}{dx}=-\\dfrac{f_x}{f_y}$, $\\dfrac{\\partial z}{\\partial x}=-\\dfrac{f_x}{f_z}$.",
    "<i>“Know the chain, then multiply down and add across.”</i> One term per intermediate variable.",
]

TOP_FACTS = [
    "A relation $f=c$ is a level curve or surface; on it $df=f_x\\,dx+f_y\\,dy+\\dots=0$.",
    "Two variables: $dy/dx=-f_x/f_y$ ($f_y\\neq0$). Slide 004·4 prints it upside down.",
    "Both routes (differentiate directly, or the formula) give the same $dy/dx$.",
    "Tangent at $(x_0,y_0)$: $y-y_0=m(x-x_0)$ with $m=dy/dx$ there.",
    "Three variables: $z_x=-f_x/f_z$ (hold $y$), $z_y=-f_y/f_z$, $y_x=-f_x/f_y$ (hold $z$).",
    "Check that the point lies on the surface: the lecture's $(1,0,2)$ does not.",
    "Composite: write the chain, then $u_s=f_xx_s+f_yy_s$; keep unknown $f_x,f_y$; eliminate $x,y$.",
    "ESA favourites: $u_x+u_y+u_z=0$; $xu_x+yu_y+zu_z=0$; $z_x^2+z_y^2$ identities; $2yz_x-z_y=0$.",
    "Polar: $x_\\theta=-r\\sin\\theta$, $y_\\theta=r\\cos\\theta$; $r_x=x/r$, $\\theta_x=-y/r^2$.",
    "Functions of $x^2+y^2$ alone give $u_\\theta=0$; $\\tan^{-1}(y/x)$ gives $u_\\theta=1$.",
]
TOP_FORMULAS = ["E1.1", "E2.1", "E3.1", "E4.1", "E5.1", "E5.2"]
