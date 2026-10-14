"""Class 003 part I/II: composite functions, total derivative, total differential, rates of change (T1–T4)."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "Composite functions and the one-variable chain rule",
     "overview": "A composite function is a function of a function, such as $y=e^{\\sin(x^2)}$. You differentiate it from the outside "
                 "in: the outer function first, then the next one, then the innermost, and multiply. Every rule in this pack is this "
                 "same idea extended to several variables."},
    {"id": "T2", "title": "The total derivative rule",
     "overview": "If $z=f(x,y)$ and both $x$ and $y$ are functions of one variable $t$, then $z$ is ultimately a function of $t$ alone. "
                 "Its ordinary derivative $dz/dt$ is the total derivative. It adds one term per path from $z$ to $t$: "
                 "$z_x\\,dx/dt+z_y\\,dy/dt$. A tree diagram shows the paths."},
    {"id": "T3", "title": "The total differential: approximation and sensitivity",
     "overview": "Without dividing by $dt$, the same rule gives the total differential $dz=f_x\\,dx+f_y\\,dy$. It approximates the "
                 "change in $z$ for small changes $dx$, $dy$, so it estimates function values near a known point. Comparing its "
                 "coefficients shows which variable the output is most sensitive to. It also explains substitution in integrals."},
    {"id": "T4", "title": "Rates of change problems",
     "overview": "Many word problems ask how fast one quantity changes when others change at known rates. Write the quantity as a "
                 "function of the changing variables, take the total derivative with respect to time, and substitute the given "
                 "values. “Remains constant” means its derivative is 0. A constraint linking the variables is differentiated "
                 "implicitly."},
]

DEFS = [
    {"topic": "T1", "term": "Composite function", "text": "A function of a function: $f(g(h(x)))$, or a function of several variables "
     "whose variables are themselves functions of other variables.", "srcs": ["S003·4", "T003a 00:00:59"]},
    {"topic": "T2", "term": "Total derivative", "text": "If $z=f(x,y)$ where $x$ and $y$ are functions of one independent variable $t$, "
     "the ordinary derivative $dz/dt$ is the total derivative of $z$ with respect to $t$.", "srcs": ["S003·5", "T003b 00:00:52"]},
    {"topic": "T2", "term": "Tree diagram", "text": "A diagram with $z$ at the root, the intermediate variables in the middle and the "
     "final variable(s) at the leaves. Each branch is labelled with a derivative; multiply along each path and add over the paths.",
     "srcs": ["S003·5", "S003·14", "T003a 00:19:22", "T003a 00:25:02"]},
    {"topic": "T3", "term": "Total differential", "text": "For $z=f(x,y)$: $dz=f_x\\,dx+f_y\\,dy$. For $z=f(x_1,\\dots,x_n)$: "
     "$dz=f_{x_1}dx_1+\\dots+f_{x_n}dx_n$. The total derivative is also called the differential.", "srcs": ["S004·3", "S004·4", "T004a 00:02:04"]},
    {"topic": "T4", "term": "Rate of change", "text": "The derivative of a quantity with respect to time $t$; positive means increasing, "
     "negative means decreasing.", "srcs": ["T003a 00:12:06"]},
]

STATEMENTS = [
    {"topic": "T2", "text": "If $z=f(x,y)$ where $x$ and $y$ are functions of one independent variable ‘t’ then we can find the derivative "
     "of z with respect t as $\\dfrac{dz}{dt}=\\dfrac{\\partial z}{\\partial x}\\dfrac{dx}{dt}+\\dfrac{\\partial z}{\\partial y}\\dfrac{dy}{dt}$.", "srcs": ["S003·5"]},
    {"topic": "T3", "text": "The total derivative is also called the differential. The differential is used in integration by substitution "
     "and in approximation. It is also useful to calculate the Errors in approximation.", "srcs": ["S004·4"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Chain rule, one variable", "tex": r"\frac{d}{dx}\,f\big(g(h(x))\big)=f'\big(g(h(x))\big)\cdot g'\big(h(x)\big)\cdot h'(x)",
     "gives": "Derivative of a composition: outer to inner, multiplied.", "when": "Each function differentiable.",
     "note": "Example: $\\dfrac{d}{dx}e^{\\sin x^2}=e^{\\sin x^2}\\cos x^2\\cdot 2x$.", "stars": 1, "srcs": ["S003·4", "T003a 00:00:33"]},
    {"id": "E2.1", "topic": "T2", "title": "Total derivative rule", "tex": r"\frac{dz}{dt}=\frac{\partial z}{\partial x}\frac{dx}{dt}+\frac{\partial z}{\partial y}\frac{dy}{dt}",
     "gives": "Rate of change of $z$ with respect to the single variable $t$.", "when": "$z=f(x,y)$, $x=x(t)$, $y=y(t)$.",
     "note": "Ordinary $d$ on $z$, $x$, $y$ with respect to $t$; partial $\\partial$ only on $z$ with respect to $x$, $y$.", "stars": 2,
     "srcs": ["S003·5", "T003a 00:05:54", "T003b 00:01:10"]},
    {"id": "E2.2", "topic": "T2", "title": "Total derivative, three variables", "tex": r"\frac{df}{dt}=f_x\frac{dx}{dt}+f_y\frac{dy}{dt}+f_z\frac{dz}{dt}",
     "gives": "One term per intermediate variable.", "when": "$f=f(x,y,z)$, each of $x,y,z$ a function of $t$.",
     "note": "Used in CW U1 P11 and in the triangle problem with $x$, $y$, $\\theta$.", "stars": 2, "srcs": ["S003·9", "CW U1 P11"], "flags": [ADD]},
    {"id": "E3.1", "topic": "T3", "title": "Total differential", "tex": r"dz=f_x(x,y)\,dx+f_y(x,y)\,dy",
     "gives": "Approximate change in $z$ for small changes $dx$, $dy$.", "when": "$z=f(x,y)$ differentiable.",
     "note": "$n$ variables: $dz=f_{x_1}dx_1+f_{x_2}dx_2+\\dots+f_{x_n}dx_n$.", "stars": 2, "srcs": ["S004·3", "S004·4", "S003·8", "T003a 00:13:56"]},
    {"id": "E3.2", "topic": "T3", "title": "Approximating a nearby value", "tex": r"f(x_0+dx,\,y_0+dy)\approx f(x_0,y_0)+f_x(x_0,y_0)\,dx+f_y(x_0,y_0)\,dy",
     "gives": "Estimated function value near a known point.", "when": "$dx$, $dy$ small.",
     "note": "Slide 003·8: $f(2.1,-3.03)\\approx 6+1.3(0.1)+(-0.6)(-0.03)=6.148$.", "stars": 2, "srcs": ["S003·8", "T003a 00:13:09"]},
    {"id": "E4.1", "topic": "T4", "title": "Constant quantity", "tex": r"A=\text{constant}\ \Longrightarrow\ \frac{dA}{dt}=0",
     "gives": "The equation that fixes the unknown rate.", "when": "“Remains constant” in the question.", "note": "", "stars": 2,
     "srcs": ["S003·9", "T003a 00:16:32"]},
]

POINTS = [
    {"topic": "T1", "text": "For one variable you differentiate a composite function from the outside in: $f$ first, then $g$, then $h$.", "stars": 1, "srcs": ["T003a 00:01:19"]},
    {"topic": "T1", "text": "For several variables the first question is always “differentiate with respect to what?”, because there is more than one variable.", "stars": 1, "srcs": ["T003a 00:01:45"]},
    {"topic": "T2", "text": "You can always substitute $x(t)$ and $y(t)$ into $z$ and differentiate directly, but this is often messy. The total derivative rule avoids substituting first.", "stars": 2, "srcs": ["T003a 00:02:39", "T003a 00:03:13"]},
    {"topic": "T2", "text": "Both methods must give the same answer; substituting first is a good check on a short example.", "stars": 2, "srcs": ["T003a 00:04:35"], "flags": [ADD]},
    {"topic": "T2", "text": "After using the rule, write the answer in terms of $t$ alone (substitute $x(t)$, $y(t)$), or evaluate at the given $t$.", "stars": 2, "srcs": ["S003·19", "T003b 00:02:03"]},
    {"topic": "T2", "text": "At a given $t$, a term vanishes if its $dx/dt$ or $dy/dt$ is 0 there (e.g. $dy/dt=\\cos t=0$ at $t=\\pi/2$).", "stars": 2, "srcs": ["T003b 00:02:34"]},
    {"topic": "T3", "text": "The total differential estimates how much $f$ changes from a known point to a nearby one.", "stars": 2, "srcs": ["S003·8"]},
    {"topic": "T3", "text": "Sensitivity: in $dV=40\\pi\\,dr+4\\pi\\,dh$ the coefficient of $dr$ is ten times that of $dh$, so the tank's volume is more sensitive to the radius than to the height.", "stars": 2, "srcs": ["S003·11", "S003·12", "T003a 00:18:30"]},
    {"topic": "T3", "text": "Sometimes you need not finish the problem: the coefficients of the differential already tell you which variable contributes most.", "stars": 1, "srcs": ["T003a 00:19:05"]},
    {"topic": "T3", "text": "Integration by substitution uses the differential: with $t=x^2$, $dt=2x\\,dx$, so $\\int e^{x^2}x\\,dx=\\tfrac12\\int e^t\\,dt$.", "stars": 1, "srcs": ["T004a 00:07:57", "T004a 00:08:29"], "flags": [TONLY]},
    {"topic": "T3", "text": "Errors and approximations, another application of the differential, come at the end of the unit.", "stars": 1, "srcs": ["T004a 00:08:47"], "flags": [TONLY]},
    {"topic": "T4", "text": "If $dz/dt>0$ the quantity is increasing at that instant; if $dz/dt<0$ it is decreasing.", "stars": 2, "srcs": ["T003a 00:12:06"]},
    {"topic": "T4", "text": "When an unknown rate such as $dy/dt$ is needed, find it from the constraint by implicit differentiation, e.g. $x^2+y^2=5\\Rightarrow dy/dt=-\\tfrac{x}{y}\\,dx/dt$.", "stars": 2, "srcs": ["S003·7", "T003a 00:09:29"]},
    {"topic": "T4", "text": "A decreasing side has a negative rate: “decreasing at 2 cm/s” means $dy/dt=-2$.", "stars": 2, "srcs": ["S003·10"]},
]

WHY = [
    {"topic": "T2", "q": "Why is it $dz/dt$ (ordinary) and not $\\partial z/\\partial t$?",
     "a": "After substituting $x(t)$ and $y(t)$, $z$ depends on the single variable $t$, so its derivative with respect to $t$ is an ordinary "
          "derivative. The partial signs belong only to $z$ with respect to $x$ and $y$, where the other variable is held fixed.",
     "srcs": ["S003·5", "T003a 00:02:23"]},
    {"topic": "T3", "q": "Why does the tank's volume depend more on the radius?",
     "a": "$V=\\pi r^2h$ has $V_r=2\\pi rh=40\\pi$ and $V_h=\\pi r^2=4\\pi$ at $r=2$, $h=10$. So $dV=4\\pi(10\\,dr+dh)$: a change in $r$ is "
          "multiplied by ten times as much as the same change in $h$.", "srcs": ["S003·11", "T003a 00:18:45"]},
    {"topic": "T4", "q": "Why does the angle have to decrease in the triangle problem?",
     "a": "$A=\\tfrac12xy\\sin\\theta$. One side grows (+3) and the other shrinks (−2), but at the given instant their combined effect "
          "$\\tfrac12\\sin\\theta(3y-2x)=\\tfrac12\\cdot\\tfrac12(90-40)>0$ would increase the area. To keep $A$ constant, $\\theta$ must decrease.",
     "srcs": ["S003·9", "S003·10"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T2", "text": "Slide 003·6 has wrong numbers. For $z=x^2y^3$, $x=t^2$, $y=2t^3$: $z_x=2xy^3=16t^{11}$ (not $2t^{11}$), "
     "$z_y=3x^2y^2=12t^{10}$ (not $9t^{10}$), and $dz/dt=16t^{11}(2t)+12t^{10}(6t^2)=104t^{12}$ (not $60t^{12}$). Check: $z=8t^{13}$.",
     "srcs": ["S003·6"], "flags": [ADD]},
    {"topic": "T3", "text": "Use signed changes: from $-3$ to $-3.03$, $dy=-0.03$ (slide 003·8 writes $0.03$ but correctly uses $-0.03$).", "srcs": ["S003·8"]},
    {"topic": "T4", "text": "Slide 003·10 prints $d\\theta/dt=0.04831$. The value is $-25/(300\\sqrt3)=-\\sqrt3/36\\approx-0.0481$ rad/s: negative, and 481, not 4831.",
     "srcs": ["S003·10", "T003a 00:16:55"], "flags": [ADD]},
    {"topic": "T4", "text": "$x^2/16-y^2/9=z$ is a hyperbolic paraboloid (a saddle), not a cup-shaped paraboloid. The calculation does not change.",
     "srcs": ["S003·7", "T003a 00:06:27"], "flags": [ADD]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "Outside-in differentiation", "srcs": ["S003·4", "T003a 00:00:33"], "stars": 1,
     "given": "$y=e^{\\sin(x^2)}$.",
     "steps": ["Outer: $\\dfrac{d}{d(\\sin x^2)}e^{\\sin x^2}=e^{\\sin x^2}$.", "Middle: $\\dfrac{d}{d(x^2)}\\sin(x^2)=\\cos(x^2)$.", "Inner: $\\dfrac{d}{dx}x^2=2x$.",
               "Multiply the three factors."],
     "answer": "$\\dfrac{dy}{dx}=2x\\,e^{\\sin x^2}\\cos x^2$", "check": "sympy gives the same."},
    {"id": "W2.1", "topic": "T2", "title": "Total derivative, both ways (slide 6, corrected)", "srcs": ["S003·6"], "stars": 2, "flags": [ADD],
     "given": "$z=x^2y^3$, $x=t^2$, $y=2t^3$.",
     "steps": ["$z_x=2xy^3=2t^2(8t^9)=16t^{11}$, $z_y=3x^2y^2=3t^4(4t^6)=12t^{10}$.", "$\\dfrac{dx}{dt}=2t$, $\\dfrac{dy}{dt}=6t^2$.",
               "$\\dfrac{dz}{dt}=16t^{11}(2t)+12t^{10}(6t^2)=32t^{12}+72t^{12}$."],
     "answer": "$\\dfrac{dz}{dt}=104\\,t^{12}$", "check": "Substituting first: $z=t^4\\cdot8t^9=8t^{13}$, so $dz/dt=104t^{12}$. The slide's $60t^{12}$ is wrong."},
    {"id": "W2.2", "topic": "T2", "title": "The lecture's version", "srcs": ["T003a 00:02:05", "T003a 00:02:57"], "stars": 1, "flags": [TONLY],
     "given": "$z=x^2y^3$, $x=t$, $y=2t^2$.",
     "steps": ["Direct: $z=t^2(2t^2)^3=8t^8$, so $dz/dt=64t^7$.", "Rule: $z_x\\,x'+z_y\\,y'=2xy^3(1)+3x^2y^2(4t)=16t^7+48t^7$."],
     "answer": "$\\dfrac{dz}{dt}=64\\,t^7$", "check": "Both routes agree."},
    {"id": "W2.3", "topic": "T2", "title": "Total derivative at a point", "srcs": ["S003·18", "S003·19", "T003b 00:00:23"], "stars": 2,
     "given": "$u=x^2y\\,e^{xy}$, $x=t^2+1$, $y=\\sin t$; find $du/dt$ at $t=\\pi/2$.",
     "steps": ["$u_x=y\\,e^{xy}(2x+x^2y)$, $u_y=x^2e^{xy}(1+xy)$; $\\dfrac{dx}{dt}=2t$, $\\dfrac{dy}{dt}=\\cos t$.",
               "At $t=\\pi/2$: $x=\\tfrac{\\pi^2}{4}+1$, $y=1$, $dx/dt=\\pi$, $dy/dt=0$, so the second term vanishes.",
               "$\\dfrac{du}{dt}=\\pi\\,e^{x}(2x+x^2)$ with $x=\\tfrac{\\pi^2}{4}+1$."],
     "answer": "$\\pi\\,e^{\\frac{\\pi^2}{4}+1}\\Big[2\\big(\\tfrac{\\pi^2}{4}+1\\big)+\\big(\\tfrac{\\pi^2}{4}+1\\big)^2\\Big]$", "check": "Direct differentiation in sympy agrees."},
    {"id": "W2.4", "topic": "T2", "title": "Total derivative in terms of t", "srcs": ["S003·20", "T003b 00:03:16"], "stars": 2,
     "given": "$u=e^{xy}+\\ln(y^2+1)$, $x=\\tan t$, $y=\\cos t$.",
     "steps": ["$u_x=y\\,e^{xy}$, $u_y=x\\,e^{xy}+\\dfrac{2y}{y^2+1}$; $\\dfrac{dx}{dt}=\\sec^2t$, $\\dfrac{dy}{dt}=-\\sin t$.",
               "$\\dfrac{du}{dt}=y\\,e^{xy}\\sec^2t-\\Big(x\\,e^{xy}+\\dfrac{2y}{y^2+1}\\Big)\\sin t$.",
               "Substitute: $xy=\\tan t\\cos t=\\sin t$ and $\\cos t\\sec^2t-\\tan t\\sin t=\\cos t$."],
     "answer": "$\\dfrac{du}{dt}=e^{\\tan t\\cos t}(\\cos t\\sec^2t-\\tan t\\sin t)-\\dfrac{2\\cos t\\sin t}{\\cos^2t+1}=e^{\\sin t}\\cos t-\\dfrac{\\sin 2t}{1+\\cos^2t}$",
     "check": "The simplified form (added for clarity) equals the derivative of $e^{\\sin t}+\\ln(\\cos^2t+1)$."},
    {"id": "W2.5", "topic": "T2", "title": "Total derivative at t = 0", "srcs": ["CW U1 P10"], "stars": 2,
     "given": "$u=x^2-y^2$, $x=e^t\\cos t$, $y=e^t\\sin t$; $du/dt$ at $t=0$.",
     "steps": ["$u_x=2x$, $u_y=-2y$; $x'=e^t(\\cos t-\\sin t)$, $y'=e^t(\\sin t+\\cos t)$.", "At $t=0$: $x=1$, $y=0$, $x'=1$, $y'=1$.",
               "$\\dfrac{du}{dt}=2(1)(1)-2(0)(1)$."],
     "answer": "$\\dfrac{du}{dt}\\Big|_{t=0}=2$", "check": "CW answer: 2."},
    {"id": "W2.6", "topic": "T2", "title": "Three intermediate variables", "srcs": ["CW U1 P11"], "stars": 2,
     "given": "$f=x^3+xz^2+y^3+xyz$, $x=e^t$, $y=\\cos t$, $z=t^3$; $df/dt$ at $t=0$.",
     "steps": ["At $t=0$: $x=1$, $y=1$, $z=0$; $x'=1$, $y'=0$, $z'=0$.", "$f_x=3x^2+z^2+yz=3$ (the $y$ and $z$ terms drop out because $y'=z'=0$).",
               "$\\dfrac{df}{dt}=f_x\\,x'+f_y\\,y'+f_z\\,z'=3(1)+0+0$."],
     "answer": "$\\dfrac{df}{dt}\\Big|_{t=0}=3$", "check": "CW answer: 3."},
    {"id": "W3.1", "topic": "T3", "title": "Approximate a function value", "srcs": ["S003·8", "T003a 00:13:09"], "stars": 2,
     "given": "$f(2,-3)=6$, $f_x(2,-3)=1.3$, $f_y(2,-3)=-0.6$; approximate $f(2.1,-3.03)$.",
     "steps": ["$dx=2.1-2=0.1$, $dy=-3.03-(-3)=-0.03$.", "$dz=1.3(0.1)+(-0.6)(-0.03)=0.13+0.018=0.148$.", "$f(2.1,-3.03)\\approx6+0.148$."],
     "answer": "$f(2.1,-3.03)\\approx6.148$", "check": "Signs: $dy<0$ and $f_y<0$, so that term adds."},
    {"id": "W3.2", "topic": "T3", "title": "Which dimension matters more?", "srcs": ["S003·11", "S003·12"], "stars": 2,
     "given": "Cylindrical tank, $h=10$ ft, diameter 4 ft ($r=2$).",
     "steps": ["$V=\\pi r^2h$, $V_r=2\\pi rh$, $V_h=\\pi r^2$.", "$dV=2\\pi rh\\,dr+\\pi r^2\\,dh=40\\pi\\,dr+4\\pi\\,dh$.",
               "$40\\pi\\approx125.7$ against $4\\pi\\approx12.57$."],
     "answer": "More sensitive to the radius (diameter) than to the height", "check": "A diameter change of $dD$ is $dr=dD/2$: still $20\\pi\\,dD$ against $4\\pi\\,dh$."},
    {"id": "W3.3", "topic": "T3", "title": "Total differentials", "srcs": ["CW U1 P9"], "stars": 2,
     "given": "(i) $u=xy$, (ii) $u=x/y$.", "steps": ["(i) $u_x=y$, $u_y=x$.", "(ii) $u_x=1/y$, $u_y=-x/y^2$."],
     "answer": "(i) $du=y\\,dx+x\\,dy$; (ii) $du=\\dfrac{y\\,dx-x\\,dy}{y^2}$", "check": "Matches the CW key; (ii) is the quotient rule."},
    {"id": "W4.1", "topic": "T4", "title": "Point moving on a saddle and a cylinder", "srcs": ["S003·7", "T003a 00:06:27", "T003a 00:11:32"], "stars": 2,
     "given": "$z=\\dfrac{x^2}{16}-\\dfrac{y^2}{9}$, $x^2+y^2=5$, $\\dfrac{dx}{dt}=0.2$ cm/s; find $dz/dt$ at $x=2$ (so $y=1$).",
     "steps": ["$\\dfrac{dz}{dt}=\\dfrac{x}{8}\\dfrac{dx}{dt}-\\dfrac{2y}{9}\\dfrac{dy}{dt}$.", "Constraint: $2x+2y\\,y'=0$, so $\\dfrac{dy}{dt}=-\\dfrac{x}{y}\\dfrac{dx}{dt}=-0.4$.",
               "$\\dfrac{dz}{dt}=\\dfrac{x}{8}(0.2)+\\dfrac{2x}{9}(0.2)$: the $y$ cancels. At $x=2$: $0.05+0.0889$."],
     "answer": "$\\dfrac{dz}{dt}=\\dfrac{5}{36}\\approx0.139$ cm/s (increasing)", "check": "Positive, so $z$ is increasing at $x=2$."},
    {"id": "W4.2", "topic": "T4", "title": "Angle of a triangle of constant area", "srcs": ["S003·9", "S003·10", "T003a 00:14:31"], "stars": 2,
     "given": "$x=20$, $y=30$, $\\theta=\\pi/6$; $\\dfrac{dx}{dt}=3$, $\\dfrac{dy}{dt}=-2$; area constant.",
     "steps": ["$A=\\tfrac12xy\\sin\\theta$ (height $=y\\sin\\theta$).", "$0=\\dfrac{dA}{dt}=\\tfrac12\\Big(y\\sin\\theta(3)+x\\sin\\theta(-2)+xy\\cos\\theta\\,\\dfrac{d\\theta}{dt}\\Big)$.",
               "$=\\tfrac12\\big(45-20+300\\sqrt3\\,\\theta'\\big)$, so $\\theta'=-\\dfrac{25}{300\\sqrt3}$."],
     "answer": "$\\dfrac{d\\theta}{dt}=-\\dfrac{\\sqrt3}{36}\\approx-0.0481$ rad/s (decreasing)", "check": "The slide's “0.04831” is a misprint (see Exam trap)."},
    {"id": "W4.3", "topic": "T4", "title": "Growing triangle", "srcs": ["S003·21", "S003·22", "T003b 00:04:57"], "stars": 2,
     "given": "$b=10$, $h=6$, $db/dt=2$, $dh/dt=1$ (cm, cm/s).",
     "steps": ["$A=\\tfrac12bh$, $\\dfrac{dA}{dt}=\\tfrac12\\Big(b\\dfrac{dh}{dt}+h\\dfrac{db}{dt}\\Big)$.", "$=\\tfrac12(10\\cdot1+6\\cdot2)=\\tfrac12(22)$."],
     "answer": "$\\dfrac{dA}{dt}=11$ cm²/s", "check": "Units: cm × cm/s = cm²/s."},
    {"id": "W4.4", "topic": "T4", "title": "Filling a cone", "srcs": ["S003·23", "S003·24", "T003b 00:06:41"], "stars": 2,
     "given": "$dV/dt=9$ cm³/s, $r=h$ always, $h=6$ cm.",
     "steps": ["$V=\\tfrac13\\pi r^2h=\\tfrac13\\pi h^3$.", "$\\dfrac{dV}{dt}=\\pi h^2\\dfrac{dh}{dt}$, so $9=36\\pi\\,\\dfrac{dh}{dt}$."],
     "answer": "$\\dfrac{dh}{dt}=\\dfrac{1}{4\\pi}\\approx0.0796$ cm/s", "check": "Use $r=h$ before differentiating."},
    {"id": "W4.5", "topic": "T4", "title": "Growing rectangle", "srcs": ["CW U1 P12"], "stars": 2,
     "given": "Sides 5 ft and 4 ft, increasing at 1.5 ft/s and 0.5 ft/s.",
     "steps": ["$A=xy$, $\\dfrac{dA}{dt}=y\\dfrac{dx}{dt}+x\\dfrac{dy}{dt}=4(1.5)+5(0.5)$."],
     "answer": "$\\dfrac{dA}{dt}=8.5$ ft²/s", "check": "CW answer: 8.5 sq. ft/s."},
    {"id": "W4.6", "topic": "T4", "title": "Changing cone", "srcs": ["CW U1 P13"], "stars": 2,
     "given": "$h=15$ cm, $dh/dt=0.2$; $r=10$ cm, $dr/dt=-0.3$.",
     "steps": ["$V=\\tfrac13\\pi r^2h$, $\\dfrac{dV}{dt}=\\tfrac13\\pi\\Big(2rh\\dfrac{dr}{dt}+r^2\\dfrac{dh}{dt}\\Big)$.", "$=\\tfrac13\\pi(2\\cdot10\\cdot15\\cdot(-0.3)+100\\cdot0.2)=\\tfrac13\\pi(-90+20)$."],
     "answer": "$\\dfrac{dV}{dt}=-\\dfrac{70\\pi}{3}$ cm³/s (decreasing)", "check": "CW answer: $-70\\pi/3$."},
]

NOTES = [
    {"topic": "T1", "text": "A composite function is a function of a function, e.g. $y=e^{\\sin x^2}$. Its derivative is found from the outside "
     "in and the factors are multiplied: $e^{\\sin x^2}\\cdot\\cos x^2\\cdot2x$. For several variables the same idea gives the total "
     "derivative and the chain rule."},
    {"topic": "T2", "text": "If $z=f(x,y)$ and $x=x(t)$, $y=y(t)$, then $z$ is a function of $t$ alone and its total derivative is "
     "$\\dfrac{dz}{dt}=\\dfrac{\\partial z}{\\partial x}\\dfrac{dx}{dt}+\\dfrac{\\partial z}{\\partial y}\\dfrac{dy}{dt}$. A tree diagram with one branch per "
     "intermediate variable gives the terms. The answer is written in terms of $t$ or evaluated at the given $t$."},
    {"topic": "T3", "text": "The total differential $dz=f_x\\,dx+f_y\\,dy$ (or $\\sum f_{x_i}dx_i$) gives the approximate change in $z$ for small "
     "changes in the variables. It approximates nearby values, $f(x_0+dx,y_0+dy)\\approx f+f_x\\,dx+f_y\\,dy$. It also measures "
     "sensitivity: the larger coefficient marks the variable that matters most. It is used in substitution and error estimates."},
    {"topic": "T4", "text": "For a rate problem, write the quantity as a function of the changing variables, take $d/dt$ of it with the total "
     "derivative rule, and substitute the given values and rates (decreasing means negative). If something stays constant its "
     "derivative is 0; a constraint between variables gives a missing rate by implicit differentiation."},
]

FIGS = [
    {"id": "G2.1", "topic": "T2", "title": "Tree diagram for the total derivative", "stars": 2, "srcs": ["S003·5", "T003a 00:19:22"],
     "howto": "Start at $z$. Each branch carries the derivative of the upper variable with respect to the lower one. Multiply along "
              "each path from $z$ down to $t$, then add the two paths: $\\dfrac{dz}{dt}=\\dfrac{\\partial z}{\\partial x}\\dfrac{dx}{dt}+\\dfrac{\\partial z}{\\partial y}\\dfrac{dy}{dt}$. "
              "In an exam, draw it first so that no path is missed."},
    {"id": "G2.2", "topic": "T2", "title": "The total derivative as the slope along a path", "stars": 1, "srcs": ["S003·5", "T003a 00:05:20"], "flags": [ADD], "tall": True,
     "howto": "As $t$ runs, the point $(x(t),y(t))$ moves along the blue path in the $xy$-plane. The vermilion curve is the surface "
              "height above it, $z(t)=f(x(t),y(t))$. $dz/dt$ is how fast that height changes as $t$ increases; it combines the "
              "slopes $z_x$ and $z_y$ weighted by how fast $x$ and $y$ move. The surface is an illustrative choice."},
    {"id": "G3.1", "topic": "T3", "title": "The differential approximates the true change", "stars": 2, "srcs": ["S003·8", "S004·4"], "flags": [ADD],
     "howto": "Cut along one direction. The true change $\\Delta z$ follows the blue curve; the differential $dz$ follows the dashed "
              "tangent line. For a small step $dx$ the two are nearly equal, which is why $f(x_0+dx)\\approx f(x_0)+dz$. The gap "
              "grows as the step grows."},
    {"id": "G4.1", "topic": "T4", "title": "A point moving on a saddle and a cylinder", "stars": 2, "srcs": ["S003·7", "T003a 00:06:27"], "tall": True,
     "howto": "The saddle $z=x^2/16-y^2/9$ (light blue) and the cylinder $x^2+y^2=5$ (grey) meet in the vermilion curve. The point "
              "$P$ moves along that curve; at $x=2$, $y=1$ its height rises at $dz/dt=5/36$ cm/s when $dx/dt=0.2$ cm/s (W4.1). "
              "The slide calls the surface a paraboloid, but it is a hyperbolic paraboloid (a saddle)."},
    {"id": "G4.2", "topic": "T4", "title": "Triangle with two sides and the included angle", "stars": 2, "srcs": ["S003·9", "T003a 00:15:25"],
     "howto": "Sides $x$ and $y$ meet at the angle $\\theta$. The dashed perpendicular is the height $y\\sin\\theta$, so the area is "
              "$A=\\tfrac12xy\\sin\\theta$. Label the three changing quantities $x$, $y$, $\\theta$ before differentiating."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "Differentiating a composite function from the outside in.", "stars": 1,
     "srcs": ["S003·4", "T003a 00:00:33"], "layout": "straight", "maxw": "115mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$y=e^{\\sin(x^2)}$", "sub": "Three nested functions: exp, sin, square"},
         {"kind": "step", "n": 1, "title": "Outer function", "fx": "$e^{\\sin x^2}$"},
         {"kind": "step", "n": 2, "title": "Middle function", "fx": "$\\cos(x^2)$"},
         {"kind": "step", "n": 3, "title": "Inner function", "fx": "$2x$"},
         {"kind": "result", "title": "Multiply the factors", "fx": "$\\dfrac{dy}{dx}=2x\\,e^{\\sin x^2}\\cos x^2$"}]},
     "remark": "The multivariable rules in this pack work the same way, except that each intermediate variable adds its own term."},
    {"id": "F2.1", "topic": "T2", "title": "Total derivative in three moves.", "stars": 2, "srcs": ["S003·5", "S003·18", "T003b 00:01:10"],
     "layout": "streams", "maxw": "145mm",
     "spec": {"left": [{"kind": "given", "title": "The function", "sub": "$z=f(x,y)$"},
                       {"kind": "step", "title": "Partial derivatives", "fx": "$z_x,\\ z_y$"}],
              "right": [{"kind": "given", "title": "The paths", "sub": "$x=x(t),\\ y=y(t)$"},
                        {"kind": "step", "title": "Ordinary derivatives", "fx": "$\\dfrac{dx}{dt},\\ \\dfrac{dy}{dt}$"}],
              "then": [{"kind": "step", "n": 3, "title": "Multiply along each path and add", "fx": "$\\dfrac{dz}{dt}=z_x\\dfrac{dx}{dt}+z_y\\dfrac{dy}{dt}$"},
                       {"kind": "result", "title": "Write in terms of $t$, or evaluate at the given $t$", "sub": "Substitute $x(t)$, $y(t)$ last"}]},
     "remark": "Check on a small example by substituting first: both routes must agree. On slide 003·6 they do not, which exposes the slide's error (W2.1)."},
    {"id": "F3.1", "topic": "T3", "title": "Estimating a value near a known point.", "stars": 2, "srcs": ["S003·8", "T003a 00:13:09"],
     "layout": "straight", "maxw": "115mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "Known: $f(x_0,y_0)$, $f_x$, $f_y$ there", "sub": "Wanted: $f$ at a nearby point"},
         {"kind": "step", "n": 1, "title": "Signed steps", "fx": "$dx=x_1-x_0,\\ dy=y_1-y_0$"},
         {"kind": "step", "n": 2, "title": "Total differential", "fx": "$dz=f_x\\,dx+f_y\\,dy$"},
         {"kind": "result", "title": "Add the change", "fx": "$f(x_1,y_1)\\approx f(x_0,y_0)+dz$"}]},
     "remark": "Slide 003·8: $dz=1.3(0.1)+(-0.6)(-0.03)=0.148$, so $f(2.1,-3.03)\\approx6.148$."},
    {"id": "F4.1", "topic": "T4", "title": "Solving a rates-of-change problem.", "stars": 2, "srcs": ["S003·7", "S003·9", "S003·21", "T003a 00:07:25"],
     "layout": "ladder", "maxw": "165mm",
     "spec": {"start": {"kind": "given", "title": "Write the quantity as a function of the changing variables", "sub": "e.g. $A=\\tfrac12xy\\sin\\theta$, $V=\\tfrac13\\pi h^3$"},
              "rungs": [{"q": "Does it stay constant?", "yes": {"lab": "", "title": "Set its derivative to 0", "sub": "$dA/dt=0$; solve for the unknown rate"}},
                        {"q": "Is a rate missing?", "yes": {"lab": "", "title": "Differentiate the constraint", "sub": "$x^2+y^2=5\\Rightarrow dy/dt=-\\tfrac{x}{y}\\,dx/dt$"}}],
              "last": {"kind": "step", "title": "Take $d/dt$ with the total derivative rule and substitute", "sub": "Decreasing rates are negative; the sign of the answer says increasing or decreasing"}},
     "remark": "Both checks can apply in one problem; work down the ladder, then substitute the numbers last."},
]
