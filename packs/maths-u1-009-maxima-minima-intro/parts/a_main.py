"""Class 009: Introduction to maxima and minima for a function of two variables."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "Maxima, minima and saddle points",
     "overview": "A surface can have several peaks (local maxima) and several pits (local minima); at each the tangent plane is "
                 "horizontal. A saddle point also has a horizontal tangent plane, but the surface rises in one direction and "
                 "falls in another, like a horse saddle. The word “relative” (or local) means the comparison is only with "
                 "nearby points."},
    {"id": "T2", "title": "Definitions: relative maximum, minimum and extreme value",
     "overview": "$f$ has a relative maximum at $(a,b)$ if $f(a,b)>f(a+h,b+k)$ for all small $h,k$, and a relative minimum if "
                 "$f(a,b)<f(a+h,b+k)$. Equivalently, $\\Delta=f(a+h,b+k)-f(a,b)$ keeps one sign: negative for a maximum, "
                 "positive for a minimum. Either is an extreme value."},
    {"id": "T3", "title": "Conditions and the working rule",
     "overview": "As in one variable, first make the first derivatives zero: $f_x=0$, $f_y=0$ give the stationary (critical) points. "
                 "Then use the second derivatives $r=f_{xx}$, $s=f_{xy}$, $t=f_{yy}$ and the Hessian determinant $rt-s^2$: "
                 "$rt-s^2>0$ with $r<0$ is a maximum, with $r>0$ a minimum; $rt-s^2<0$ is a saddle point; $rt-s^2=0$ is "
                 "doubtful and needs further investigation."},
]

DEFS = [
    {"topic": "T2", "term": "Relative maximum", "text": "A function $f(x,y)$ is said to have a relative maximum at a point $(a,b)$ if there "
     "exists a neighbourhood of the point $(a,b)$, say $(a+h,b+k)$, $h$ and $k$ small, such that $f(a,b)>f(a+h,b+k)$.", "srcs": ["S009·6", "T009 00:03:46"]},
    {"topic": "T2", "term": "Relative minimum", "text": "If $f(a,b)<f(a+h,b+k)$ then $f(x,y)$ is said to have a relative minimum at $(a,b)$.",
     "srcs": ["S009·6", "T009 00:04:58"]},
    {"topic": "T2", "term": "Extreme value", "text": "$f(a,b)$ is said to be an extreme value of $f$ if it is either a maximum or a minimum.", "srcs": ["S009·6"]},
    {"topic": "T2", "term": "Neighbourhood", "text": "The points very close to $(a,b)$: $(a+h,b+k)$ with $h$, $k$ small. “Relative” means "
     "largest or smallest only in such a neighbourhood, not over the whole plane.", "srcs": ["T009 00:04:12", "T009 00:04:40"]},
    {"topic": "T3", "term": "Stationary (critical) point", "text": "A point where $f_x=0$ and $f_y=0$: the tangent plane is horizontal, and "
     "the function may have an extreme value there.", "srcs": ["S009·8", "T009 00:02:47", "T009 00:06:19"]},
    {"topic": "T1", "term": "Saddle point", "text": "A stationary point at which $f(a,b)$ is neither a maximum nor a minimum: the surface "
     "rises in some directions and falls in others. Test: $rt-s^2<0$.", "srcs": ["S009·5", "S009·7", "T009 00:11:06"]},
    {"topic": "T3", "term": "Hessian", "text": "The determinant $\\begin{vmatrix}f_{xx}&f_{xy}\\\\f_{xy}&f_{yy}\\end{vmatrix}=rt-s^2$ of second partial derivatives.",
     "srcs": ["S009·7", "T009 00:07:22"]},
]

STATEMENTS = [
    {"topic": "T2", "text": "In other words if $\\Delta=f(a+h,b+k)-f(a,b)$ is of the same sign for all small values of $h,k$ and if this sign is "
     "negative then $f(a,b)$ is maximum & if this sign is positive then $f(a,b)$ is a minimum.", "srcs": ["S009·6", "T009 00:05:23"]},
    {"topic": "T3", "text": "The necessary and sufficient condition for $f(x,y)$ to have a maximum value at $(a,b)$ is $f_x(a,b)=0$, "
     "$f_y(a,b)=0$ and $rt-s^2>0$, where $r=f_{xx}$, $s=f_{xy}$, $t=f_{yy}$. $rt-s^2$ is the determinant of the Hessian matrix "
     "$\\begin{vmatrix}f_{xx}&f_{xy}\\\\f_{xy}&f_{yy}\\end{vmatrix}$.", "srcs": ["S009·7"]},
    {"topic": "T3", "text": "Note: If $rt-s^2<0$, $f(a,b)$ is not an extreme value, i.e. $f(x,y)$ is neither a maximum nor a minimum at the "
     "point $(a,b)$ and the point is called a saddle point. If $rt-s^2=0$, then the test provides no information about the nature of the point.",
     "srcs": ["S009·7"]},
]

FORMULAS = [
    {"id": "E3.1", "topic": "T3", "title": "Stationary points (necessary condition)", "tex": r"f_x=\frac{\partial f}{\partial x}=0,\qquad f_y=\frac{\partial f}{\partial y}=0",
     "gives": "The candidates $(a,b),(c,d),\\dots$ for extreme values.", "when": "$f$ differentiable; solve the two equations simultaneously.",
     "note": "Two-variable version of $\\frac{dy}{dx}=0$.", "stars": 3, "srcs": ["S009·7", "S009·8", "T009 00:06:19"]},
    {"id": "E3.2", "topic": "T3", "title": "Second derivatives used in the test", "tex": r"r=\frac{\partial^2f}{\partial x^2},\qquad s=\frac{\partial^2f}{\partial x\,\partial y},\qquad t=\frac{\partial^2f}{\partial y^2}",
     "gives": "The three numbers at each stationary point.", "when": "Evaluate at each stationary point separately.",
     "note": "$s=f_{xy}=f_{yx}$ (Clairaut).", "stars": 3, "srcs": ["S009·7", "S009·8", "T009 00:07:04"]},
    {"id": "E3.3", "topic": "T3", "title": "Hessian determinant", "tex": r"rt-s^2=\begin{vmatrix}f_{xx}&f_{xy}\\ f_{xy}&f_{yy}\end{vmatrix}=f_{xx}f_{yy}-f_{xy}^2",
     "gives": "Whether the stationary point is an extremum.", "when": "At a stationary point.",
     "note": "Positive: extremum (decide by $r$). Negative: saddle. Zero: doubtful.", "stars": 3, "srcs": ["S009·7", "T009 00:07:37"]},
    {"id": "E3.4", "topic": "T3", "title": "The test (working rule, steps 3–6)",
     "tex": r"\begin{gathered}rt-s^2>0,\ r<0\ \Rightarrow\ \text{maximum};\qquad rt-s^2>0,\ r>0\ \Rightarrow\ \text{minimum}\\ rt-s^2<0\ \Rightarrow\ \text{saddle point};\qquad rt-s^2=0\ \Rightarrow\ \text{doubtful}\end{gathered}",
     "gives": "The nature of each stationary point.", "when": "After E3.1–E3.3.",
     "note": "$r<0$ plays the role of $\\frac{d^2y}{dx^2}<0$ in one variable. When $rt-s^2>0$, $r$ and $t$ have the same sign, so $t$ can be used instead.",
     "stars": 3, "srcs": ["S009·8", "S009·9", "T009 00:11:32"]},
    {"id": "E2.1", "topic": "T2", "title": "Sign of the increment", "tex": r"\Delta=f(a+h,b+k)-f(a,b)\quad\begin{cases}<0\ \text{for all small }h,k: & \text{maximum}\\>0\ \text{for all small }h,k: & \text{minimum}\end{cases}",
     "gives": "The definition of an extreme value.", "when": "Used to settle the doubtful case $rt-s^2=0$.", "note": "Same sign in every direction.",
     "stars": 1, "srcs": ["S009·6", "T009 00:05:23"]},
]

POINTS = [
    {"topic": "T1", "text": "One variable recap: solve $\\frac{dy}{dx}=0$ for critical points; $\\frac{d^2y}{dx^2}<0$ gives a maximum, $>0$ a minimum; "
     "$=0$ gives no conclusion. The tangent at a maximum or minimum is parallel to the $x$-axis (slope 0).", "stars": 2,
     "srcs": ["T009 00:00:50", "T009 00:01:40", "T009 00:02:57"]},
    {"topic": "T1", "text": "In two variables the tangent plane at a maximum or minimum is horizontal (parallel to the $xy$-plane); slide 009·3 shows "
     "a horizontal tangent plane at a relative maximum (Figure G1.4).", "stars": 1, "srcs": ["S009·3", "S009·4", "T009 00:01:10"]},
    {"topic": "T1", "text": "A function can have several local maxima and several local minima (slides 009·3–4: “These are all local maxima / minima”).",
     "stars": 1, "srcs": ["S009·3", "S009·4", "T009 00:00:16"]},
    {"topic": "T2", "text": "“Relative” because only points in a neighbourhood of $(a,b)$ are compared, not the whole plane.", "stars": 1, "srcs": ["T009 00:04:40"]},
    {"topic": "T3", "text": "Working rule step 1: find $\\frac{\\partial f}{\\partial x}$ and $\\frac{\\partial f}{\\partial y}$, equate each to zero, solve "
     "simultaneously; let $(a,b),(c,d),\\dots$ be the pairs of values.", "stars": 3, "srcs": ["S009·8", "T009 00:11:32"]},
    {"topic": "T3", "text": "Step 2: calculate $r=\\frac{\\partial^2f}{\\partial x^2}$, $s=\\frac{\\partial^2f}{\\partial x\\partial y}$, $t=\\frac{\\partial^2f}{\\partial y^2}$ "
     "for each pair of values.", "stars": 3, "srcs": ["S009·8"]},
    {"topic": "T3", "text": "Steps 3–6: $rt-s^2>0$ and $r<0$: maximum; $rt-s^2>0$ and $r>0$: minimum; $rt-s^2<0$: not an extreme value, "
     "$(a,b)$ is a saddle point; $rt-s^2=0$: the case is doubtful and needs further investigation.", "stars": 3, "srcs": ["S009·8", "S009·9", "T009 00:12:33"]},
    {"topic": "T3", "text": "Two important conditions to remember (lecture): both first partials zero, and $rt-s^2$ from the second partials.", "stars": 3,
     "srcs": ["T009 00:08:50"], "flags": [TONLY]},
    {"topic": "T3", "text": "Unlike one variable, the sign of $r$ alone is not enough: first check $rt-s^2>0$, then look at $r$.", "stars": 3, "srcs": ["T009 00:07:51", "T009 00:09:43"]},
    {"topic": "T3", "text": "The value of the function at a maximum or minimum point is the maximum or minimum value: always substitute the point back into $f$.",
     "stars": 2, "srcs": ["T009 00:04:51"], "flags": [ADD]},
    {"topic": "T3", "text": "Each stationary point is tested separately: a function can have maxima, minima and saddle points together (class 010: four "
     "points for $x^3+3xy^2-15x^2-15y^2+72x$).", "stars": 3, "srcs": ["ESA Dec-23 1c", "ESA Jan-24 s1 1a"]},
]

WHY = [
    {"topic": "T3", "q": "Why must $f_x$ and $f_y$ both vanish at an extremum?",
     "a": "Along the line $y=b$, $f(x,b)$ is a function of $x$ alone with an extremum at $x=a$, so its derivative $f_x(a,b)=0$. "
          "The same along $x=a$ gives $f_y(a,b)=0$. Geometrically, the tangent plane is horizontal.", "srcs": ["T009 00:06:19"], "flags": [ADD]},
    {"topic": "T3", "q": "Why does $rt-s^2<0$ mean a saddle?",
     "a": "Near a stationary point $f(a+h,b+k)-f(a,b)\\approx\\tfrac12(rh^2+2shk+tk^2)$ (Taylor, class 007). This quadratic keeps one sign "
          "for all $h,k$ exactly when $rt-s^2>0$ (sign of $r$); when $rt-s^2<0$ it is positive in some directions and negative in others.",
     "srcs": ["S009·6", "S009·7"], "flags": [ADD]},
    {"topic": "T3", "q": "Why is $r$ enough to separate maximum from minimum when $rt-s^2>0$?",
     "a": "$rt>s^2\\ge0$, so $r$ and $t$ have the same sign: the surface curves the same way along $x$ and along $y$.", "srcs": ["S009·8"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T3", "text": "$rt-s^2<0$ is a saddle point (a definite answer); only $rt-s^2=0$ is “no conclusion”. The lecture mixes the two at one point.",
     "srcs": ["S009·7", "T009 00:08:23", "T009 00:11:06"]},
    {"topic": "T1", "text": "In one variable $\\frac{d^2y}{dx^2}=0$ is not “a saddle point”; it is only inconclusive ($x^4$ has a minimum, $x^3$ an inflection).",
     "srcs": ["T009 00:03:14"], "flags": [ADD]},
    {"topic": "T3", "text": "Do not decide maximum or minimum from $r$ before checking $rt-s^2>0$: $x^2-3xy+y^2$ has $r=2>0$ at the origin but $rt-s^2=-5$: a saddle.",
     "srcs": ["S009·8"], "flags": [ADD]},
    {"topic": "T3", "text": "$f_x=f_y=0$ is necessary, $rt-s^2>0$ sufficient; slide 009·7 calls the pair “necessary and sufficient”.", "srcs": ["S009·7"], "flags": [ADD]},
    {"topic": "T3", "text": "Evaluate $r$, $s$, $t$ at each stationary point; a sign that holds at one point need not hold at another.", "srcs": ["S009·8"]},
]

WORKED = [
    {"id": "W3.1", "topic": "T3", "title": "A bowl: minimum", "srcs": ["S009·4", "S009·8"], "stars": 1, "flags": [ADD],
     "given": "$f(x,y)=x^2+y^2$.",
     "steps": ["$f_x=2x=0$, $f_y=2y=0$: stationary point $(0,0)$.", "$r=2$, $s=0$, $t=2$; $rt-s^2=4>0$ and $r>0$."],
     "answer": "Minimum at $(0,0)$; minimum value $0$", "check": "$f\\ge0$ everywhere, so the answer agrees with the definition."},
    {"id": "W3.2", "topic": "T3", "title": "A saddle", "srcs": ["S009·5", "S009·9"], "stars": 1, "flags": [ADD],
     "given": "$f(x,y)=x^2-y^2$.",
     "steps": ["$f_x=2x=0$, $f_y=-2y=0$: $(0,0)$.", "$r=2$, $s=0$, $t=-2$; $rt-s^2=-4<0$."],
     "answer": "$(0,0)$ is a saddle point", "check": "Along the $x$-axis $f=x^2\\ge0$, along the $y$-axis $f=-y^2\\le0$: $\\Delta$ changes sign."},
    {"id": "W3.3", "topic": "T3", "title": "Doubtful case resolved: a minimum", "srcs": ["S009·9", "S009·6"], "stars": 1, "flags": [ADD],
     "given": "$f(x,y)=x^4+y^4$.",
     "steps": ["$f_x=4x^3$, $f_y=4y^3$: stationary point $(0,0)$.", "$r=12x^2=0$, $s=0$, $t=12y^2=0$: $rt-s^2=0$, doubtful.",
               "Definition: $\\Delta=f(h,k)-f(0,0)=h^4+k^4>0$ for all small $(h,k)\\ne(0,0)$."],
     "answer": "Minimum at $(0,0)$ (value $0$)", "check": "The test gave no information; the sign of $\\Delta$ settles it."},
    {"id": "W3.4", "topic": "T3", "title": "Doubtful case resolved: neither", "srcs": ["S009·9", "S009·6"], "stars": 1, "flags": [ADD],
     "given": "$f(x,y)=x^4-y^4$.",
     "steps": ["Stationary point $(0,0)$; again $r=s=t=0$, so $rt-s^2=0$.", "$\\Delta=h^4-k^4$: positive for $k=0$, negative for $h=0$."],
     "answer": "Neither a maximum nor a minimum at $(0,0)$", "check": "Compare with W3.3: $rt-s^2=0$ can hide either answer."},
    {"id": "W3.5", "topic": "T3", "title": "The working rule on a quadratic", "srcs": ["CW U1 P31"], "stars": 2,
     "given": "Find the maximum and minimum values of $f(x,y)=4x^2+2y^2+4xy-10x-2y-3$.",
     "steps": ["$f_x=8x+4y-10=0$, $f_y=4y+4x-2=0$.", "Subtract: $4x-8=0$, so $x=2$, $y=-\\tfrac32$: one stationary point $(2,-\\tfrac32)$.",
               "$r=8$, $s=4$, $t=4$: $rt-s^2=32-16=16>0$, $r>0$.", "$f(2,-\\tfrac32)=16+\\tfrac92-12-20+3-3=-\\tfrac{23}{2}$."],
     "answer": "Minimum value $-\\dfrac{23}{2}$ at $\\big(2,-\\tfrac32\\big)$; no maximum", "check": "CW answer agrees; sympy agrees."},
]

PYQS = []

NOTES = [
    {"topic": "T1", "text": "Local maxima are peaks, local minima are pits; at both the tangent plane is horizontal. A saddle point also has "
     "a horizontal tangent plane but rises one way and falls another. A function can have several of each."},
    {"topic": "T2", "text": "Relative maximum at $(a,b)$: $f(a,b)>f(a+h,b+k)$ for small $h,k$; minimum: $<$. Equivalently "
     "$\\Delta=f(a+h,b+k)-f(a,b)$ has one sign: negative ⇒ maximum, positive ⇒ minimum. Either is an extreme value."},
    {"topic": "T3", "text": "Solve $f_x=0$, $f_y=0$. At each point find $r=f_{xx}$, $s=f_{xy}$, $t=f_{yy}$. $rt-s^2>0$: $r<0$ max, $r>0$ min; "
     "$rt-s^2<0$: saddle; $rt-s^2=0$: doubtful (use $\\Delta$). Substitute the point in $f$ for the value."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "Local maxima: peaks with horizontal tangent planes", "stars": 1, "srcs": ["S009·3", "T009 00:00:16"], "tall": True,
     "howto": "A surface with two peaks (illustrative: a sum of two bell shapes). Both peaks are local maxima; the taller one is also "
              "the largest value overall. The vermilion square is the horizontal tangent plane at the lower peak."},
    {"id": "G1.2", "topic": "T1", "title": "A local minimum: $z=x^2+y^2$", "stars": 1, "srcs": ["S009·4", "T009 00:02:11"], "tall": True,
     "howto": "The bowl $z=x^2+y^2$ has its lowest point at the origin. Every nearby point is higher: $\\Delta>0$. Its test values "
              "are $r=t=2$, $s=0$, $rt-s^2=4>0$, $r>0$ (W3.1)."},
    {"id": "G1.3", "topic": "T1", "title": "A saddle point: $z=x^2-y^2$", "stars": 2, "srcs": ["S009·5", "S009·7"], "tall": True,
     "howto": "Along the $x$-direction (green) the surface curves up, along the $y$-direction (vermilion) it curves down. The origin is "
              "stationary but neither a maximum nor a minimum; $rt-s^2=-4<0$ (W3.2)."},
    {"id": "G1.4", "topic": "T1", "title": "One-variable picture: maxima, minima and $\\frac{dy}{dx}=0$", "stars": 1, "srcs": ["T009 00:00:50", "T009 00:01:10"],
     "howto": "On $y=f(x)$ the tangent is horizontal (slope 0) at every local maximum and minimum (short dashed segments). The two-variable "
              "test copies this: $f_x=f_y=0$ replaces $\\frac{dy}{dx}=0$, and $rt-s^2$ with $r$ replaces $\\frac{d^2y}{dx^2}$."},
]

FLOWS = [
    {"id": "F3.1", "topic": "T3", "title": "Working rule: nature of a stationary point", "stars": 3, "srcs": ["S009·8", "S009·9", "T009 00:11:32"],
     "layout": "ladder", "maxw": "150mm",
     "spec": {"start": {"kind": "given", "title": "$f(x,y)$", "sub": "solve $f_x=0$, $f_y=0$; at each point find $r,\\ s,\\ t$"},
              "rungs": [{"q": "Is $rt-s^2<0$?", "yes": {"kind": "result", "title": "Saddle point", "sub": "not an extreme value"}},
                        {"q": "Is $rt-s^2=0$?", "yes": {"kind": "result", "title": "Doubtful", "sub": "investigate the sign of $\\Delta$"}},
                        {"q": "Is $r<0$?", "yes": {"kind": "result", "title": "Maximum", "sub": "value $f(a,b)$"}}],
              "last": {"kind": "result", "title": "Minimum", "sub": "$rt-s^2>0$, $r>0$; value $f(a,b)$"}},
     "remark": "Repeat the ladder for every stationary point.", "trap": "Never classify from $r$ alone."},
    {"id": "F3.2", "topic": "T3", "title": "From one variable to two", "stars": 2, "srcs": ["T009 00:06:00", "T009 00:10:20"],
     "layout": "streams", "maxw": "150mm",
     "spec": {"left": [{"kind": "given", "title": "One variable $y=f(x)$"},
                       {"kind": "step", "n": 1, "title": "Critical points", "fx": "$\\frac{dy}{dx}=0$"},
                       {"kind": "step", "n": 2, "title": "Second derivative", "fx": "$\\frac{d^2y}{dx^2}<0$ max, $>0$ min"}],
              "right": [{"kind": "given", "title": "Two variables $z=f(x,y)$"},
                        {"kind": "step", "n": 1, "title": "Stationary points", "fx": "$f_x=0,\\ f_y=0$"},
                        {"kind": "step", "n": 2, "title": "Hessian, then $r$", "fx": "$rt-s^2>0$: $r<0$ max, $r>0$ min"}],
              "then": [{"kind": "result", "title": "Extra case in two variables", "fx": "$rt-s^2<0$: saddle point"}]}},
]

COMPARISONS = [
    {"id": "C3.1", "topic": "T3", "title": "The four outcomes of the test", "srcs": ["S009·7", "S009·8", "S009·9"],
     "head": ["$rt-s^2$", "$r$", "Nature of $(a,b)$", "Example at the origin"],
     "rows": [["$>0$", "$<0$", "Maximum", "$-x^2-y^2$"],
              ["$>0$", "$>0$", "Minimum", "$x^2+y^2$ (W3.1)"],
              ["$<0$", "any", "Saddle point", "$x^2-y^2$ (W3.2)"],
              ["$=0$", "any", "Doubtful: further investigation", "$x^4+y^4$ (min), $x^4-y^4$ (neither)"]]},
]

SYMBOLS = [
    {"sym": "$(a,b)$", "name": "Stationary point", "meaning": "Solution of $f_x=f_y=0$", "where": "E3.1"},
    {"sym": "$h,\\ k$", "name": "Small increments", "meaning": "Neighbouring point $(a+h,b+k)$", "where": "E2.1"},
    {"sym": "$\\Delta$", "name": "Increment of $f$", "meaning": "$f(a+h,b+k)-f(a,b)$", "where": "E2.1"},
    {"sym": "$r$", "name": "$f_{xx}$", "meaning": "Second partial in $x$ at the point", "where": "E3.2–E3.4"},
    {"sym": "$s$", "name": "$f_{xy}$", "meaning": "Mixed partial at the point (not arc length)", "where": "E3.2–E3.4"},
    {"sym": "$t$", "name": "$f_{yy}$", "meaning": "Second partial in $y$ (not time)", "where": "E3.2–E3.4"},
    {"sym": "$rt-s^2$", "name": "Hessian determinant", "meaning": "$f_{xx}f_{yy}-f_{xy}^2$", "where": "E3.3"},
]

KEYWORDS = [
    {"term": "Local (relative) maximum", "meaning": "$f(a,b)>f$ at all nearby points.", "topic": "T2"},
    {"term": "Local (relative) minimum", "meaning": "$f(a,b)<f$ at all nearby points.", "topic": "T2"},
    {"term": "Extreme value", "meaning": "A maximum or a minimum value.", "topic": "T2"},
    {"term": "Neighbourhood", "meaning": "Points $(a+h,b+k)$ with $h,k$ small.", "topic": "T2"},
    {"term": "Stationary / critical point", "meaning": "$f_x=f_y=0$.", "topic": "T3"},
    {"term": "Horizontal tangent plane", "meaning": "Geometric meaning of a stationary point.", "topic": "T1"},
    {"term": "Saddle point", "meaning": "Stationary, neither max nor min; $rt-s^2<0$.", "topic": "T1"},
    {"term": "Hessian", "meaning": "$\\begin{vmatrix}r&s\\\\s&t\\end{vmatrix}=rt-s^2$.", "topic": "T3"},
    {"term": "$r$, $s$, $t$", "meaning": "$f_{xx}$, $f_{xy}$, $f_{yy}$.", "topic": "T3"},
    {"term": "Doubtful case", "meaning": "$rt-s^2=0$: test gives no information.", "topic": "T3"},
    {"term": "Working rule", "meaning": "Stationary points → $r,s,t$ → sign of $rt-s^2$, then $r$.", "topic": "T3"},
]

RAPID = [
    {"q": "Relative maximum at $(a,b)$?", "a": "$f(a,b)>f(a+h,b+k)$ for all small $h,k$."},
    {"q": "In terms of $\\Delta$?", "a": "$\\Delta=f(a+h,b+k)-f(a,b)$ one sign: negative max, positive min."},
    {"q": "Stationary points?", "a": "Solve $f_x=0$, $f_y=0$."},
    {"q": "$r$, $s$, $t$?", "a": "$f_{xx}$, $f_{xy}$, $f_{yy}$ at the point."},
    {"q": "Maximum test?", "a": "$rt-s^2>0$ and $r<0$."},
    {"q": "Minimum test?", "a": "$rt-s^2>0$ and $r>0$."},
    {"q": "$rt-s^2<0$?", "a": "Saddle point."},
    {"q": "$rt-s^2=0$?", "a": "Doubtful; needs further investigation."},
    {"q": "What is the Hessian here?", "a": "$\\begin{vmatrix}f_{xx}&f_{xy}\\\\f_{xy}&f_{yy}\\end{vmatrix}=rt-s^2$."},
    {"q": "Nature of $x^2-y^2$ at the origin?", "a": "Saddle ($rt-s^2=-4$)."},
    {"q": "$x^4+y^4$ at the origin?", "a": "Test fails; minimum by $\\Delta$."},
    {"q": "Min of $4x^2+2y^2+4xy-10x-2y-3$?", "a": "$-\\frac{23}2$ at $(2,-\\frac32)$."},
]

MNEMONICS = [
    "<i>“Determinant first, then $r$.”</i> Positive Hessian: $r$ negative = hill (max), $r$ positive = valley (min); negative Hessian = saddle; zero = doubt.",
]

TOP_FACTS = [
    "Max at $(a,b)$: $f(a,b)>f(a+h,b+k)$ nearby; min: $<$. Extreme value = max or min.",
    "Stationary points: $f_x=0$, $f_y=0$ (horizontal tangent plane).",
    "$r=f_{xx}$, $s=f_{xy}$, $t=f_{yy}$; Hessian $rt-s^2$.",
    "$rt-s^2>0$, $r<0$: max. $rt-s^2>0$, $r>0$: min.",
    "$rt-s^2<0$: saddle point (not an extreme value). $rt-s^2=0$: doubtful.",
    "Test every stationary point; substitute into $f$ for the value.",
]
TOP_FORMULAS = ["E3.1", "E3.2", "E3.3", "E3.4"]
