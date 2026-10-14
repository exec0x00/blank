"""Class 003 part I/II and 004 part II: chain rule for composite functions of several variables (T5)."""
ADD = "added for clarity"

TOPICS = [
    {"id": "T5", "title": "The chain rule for composite functions",
     "overview": "If $z=f(x,y)$ and $x$, $y$ are functions of two variables $u$, $v$, then $z$ is a composite function of $u$ and $v$. "
                 "Its partial derivatives follow every path in the tree diagram: $z_u=z_xx_u+z_yy_u$ and $z_v=z_xx_v+z_yy_v$. When "
                 "$f$ is unknown, $f_x$, $f_y$ stay as symbols. Substitution tricks ($r=2x-3y$, …) and polar coordinates are the "
                 "standard exam forms."},
]

DEFS = [
    {"topic": "T5", "term": "Chain rule (several variables)", "text": "If $z=f(x,y)$ is a bivariate function and $x$, $y$ are functions "
     "of two or more independent variables $u$, $v$, then $\\dfrac{\\partial z}{\\partial u}=\\dfrac{\\partial z}{\\partial x}\\dfrac{\\partial x}{\\partial u}+\\dfrac{\\partial z}{\\partial y}\\dfrac{\\partial y}{\\partial u}$ "
     "and $\\dfrac{\\partial z}{\\partial v}=\\dfrac{\\partial z}{\\partial x}\\dfrac{\\partial x}{\\partial v}+\\dfrac{\\partial z}{\\partial y}\\dfrac{\\partial y}{\\partial v}$.",
     "srcs": ["S003·13", "T003a 00:21:07"]},
    {"topic": "T5", "term": "The chain of a problem", "text": "The list of dependencies, e.g. “$u$ depends on $x,y$; $x,y$ depend on $r,t$; "
     "so $u$ is a composite function of $r,t$”. Knowing it fixes which chain-rule formula to write.", "srcs": ["T004b 00:02:31"]},
]

STATEMENTS = [
    {"topic": "T5", "text": "We can define chain rule for a function of two or more independent variable: If $z=f(x,y)$ is a bivariate "
     "function and $x,y$ are functions of two or more independent variables say $u,v$ then we can find the partial derivative of $z$ "
     "with respect to $u$ and $v$.", "srcs": ["S003·13"]},
]

FORMULAS = [
    {"id": "E5.1", "topic": "T5", "title": "Chain rule, two intermediate variables",
     "tex": r"\frac{\partial z}{\partial u}=\frac{\partial z}{\partial x}\frac{\partial x}{\partial u}+\frac{\partial z}{\partial y}\frac{\partial y}{\partial u},\qquad "
            r"\frac{\partial z}{\partial v}=\frac{\partial z}{\partial x}\frac{\partial x}{\partial v}+\frac{\partial z}{\partial y}\frac{\partial y}{\partial v}",
     "gives": "Partial derivatives of a composite function.", "when": "$z=f(x,y)$, $x=g(u,v)$, $y=h(u,v)$.",
     "note": "All derivatives are partial, because everything depends on two variables.", "stars": 3, "srcs": ["S003·13", "S003·14", "T003a 00:21:07"]},
    {"id": "E5.2", "topic": "T5", "title": "Chain rule, three intermediate variables",
     "tex": r"\frac{\partial v}{\partial x}=\frac{\partial v}{\partial r}\frac{\partial r}{\partial x}+\frac{\partial v}{\partial s}\frac{\partial s}{\partial x}+\frac{\partial v}{\partial t}\frac{\partial t}{\partial x}",
     "gives": "One term per intermediate variable.", "when": "$v=f(r,s,t)$, each of $r,s,t$ a function of $x,y,z$.",
     "note": "A term is 0 when that intermediate variable does not contain $x$.", "stars": 3, "srcs": ["S003·15", "T003a 00:23:10"]},
    {"id": "E5.3", "topic": "T5", "title": "Function of one intermediate variable",
     "tex": r"u=f(r),\ r=\sqrt{x^2+y^2+z^2}\ \Longrightarrow\ \frac{\partial u}{\partial x}=f'(r)\,\frac{\partial r}{\partial x}=f'(r)\,\frac{x}{r}",
     "gives": "$\\partial u/\\partial x$ in terms of $f'(r)$.", "when": "$u$ depends on $x,y,z$ only through $r$.", "note": "", "stars": 2,
     "srcs": ["S004·12", "T004b 00:05:07"]},
    {"id": "E5.4", "topic": "T5", "title": "Polar coordinates: derivatives you reuse",
     "tex": r"\begin{aligned}&x=r\cos\theta,\ y=r\sin\theta:&& x_\theta=-r\sin\theta,\quad y_\theta=r\cos\theta\\ &r=\sqrt{x^2+y^2},\ \theta=\tan^{-1}\tfrac{y}{x}:&& r_x=\frac{x}{r},\ r_y=\frac{y}{r},\ \theta_x=-\frac{y}{r^2},\ \theta_y=\frac{x}{r^2}\end{aligned}",
     "gives": "The inner derivatives for polar problems.", "when": "$r=\\sqrt{x^2+y^2}$, $\\theta=\\tan^{-1}(y/x)$.",
     "note": "So $u_x=f_r\\frac{x}{r}-f_\\theta\\frac{y}{r^2}$ and $u_y=f_r\\frac{y}{r}+f_\\theta\\frac{x}{r^2}$ for $u=f(r,\\theta)$.", "stars": 2,
     "srcs": ["S004·13", "S004·15", "S004·17"]},
    {"id": "E5.5", "topic": "T5", "title": "Polar identity", "tex": r"\Big(\frac{\partial u}{\partial x}\Big)^2+\Big(\frac{\partial u}{\partial y}\Big)^2=\Big(\frac{\partial u}{\partial r}\Big)^2+\frac{1}{r^2}\Big(\frac{\partial u}{\partial\theta}\Big)^2",
     "gives": "The squared gradient in polar coordinates.", "when": "$u=u(x,y)$, $x=r\\cos\\theta$, $y=r\\sin\\theta$.", "note": "Proved in W5.16.", "stars": 2,
     "srcs": ["CW U1 P15"]},
]

POINTS = [
    {"topic": "T5", "text": "When $x$ and $y$ depend on two variables $u,v$, $z$ cannot be differentiated “totally”: only $z_u$ and $z_v$ exist.", "stars": 2, "srcs": ["T003a 00:20:40"]},
    {"topic": "T5", "text": "Write the tree diagram every time a function has more than one independent variable, so that no partial derivative is missed.", "stars": 3, "srcs": ["T003a 00:25:02"]},
    {"topic": "T5", "text": "It is essential to know the chain given in the problem: what depends on what. The formula follows from it.", "stars": 3, "srcs": ["T004b 00:02:31"]},
    {"topic": "T5", "text": "If $f$ is not given ($u=f(x,y)$), keep $f_x$, $f_y$ (or $f_r$, $f_\\theta$) as symbols in the answer.", "stars": 3, "srcs": ["S003·17", "S003·25", "T003a 00:26:28"]},
    {"topic": "T5", "text": "For $f(2x-3y,\\,3y-4z,\\,4z-2x)$, name the arguments $r,s,t$ and compute $r_x,s_x,t_x,\\dots$; most are constants or 0.", "stars": 3, "srcs": ["S003·15", "T003a 00:22:33"]},
    {"topic": "T5", "text": "When $u$ is a composite function of $r,\\theta$ (or $s,t$), eliminate $x$ and $y$ from the final answer: you must know why you substitute.", "stars": 3, "srcs": ["T004b 00:07:52", "T004b 00:10:28"]},
    {"topic": "T5", "text": "Functions of $x^2+y^2$ alone (e.g. $\\sin(x^2+y^2)$, $e^{x^2+y^2}$) have $\\partial u/\\partial\\theta=0$ in polar coordinates, since $x^2+y^2=r^2$ does not involve $\\theta$.", "stars": 2, "srcs": ["S004·10", "S004·13", "S004·14"], "flags": [ADD]},
    {"topic": "T5", "text": "$\\tan^{-1}(y/x)$ is exactly $\\theta$ in polar coordinates, so $\\partial u/\\partial\\theta=1$.", "stars": 2, "srcs": ["S004·15"], "flags": [ADD]},
    {"topic": "T5", "text": "The chain rule extends to any number of variables: $z$ of $x,y$, each of $x,y$ of three variables, and so on.", "stars": 1, "srcs": ["T003a 00:21:40"]},
]

WHY = [
    {"topic": "T5", "q": "Why does $u=f(x-y,\\,y-z,\\,z-x)$ give $u_x+u_y+u_z=0$?",
     "a": "Each argument is a difference whose derivatives sum to zero: for $r=x-y$, $r_x+r_y+r_z=1-1+0=0$. Adding the three chain-rule "
          "expressions gives $f_r(0)+f_s(0)+f_t(0)$. In words: moving $x$, $y$, $z$ by the same amount changes none of the arguments.",
     "srcs": ["ESA Jan-24 s2 1d"], "flags": [ADD]},
    {"topic": "T5", "q": "Why do the chain-rule answers keep $f_r$ and $f_\\theta$?",
     "a": "The outer function $f$ is unknown, so its partial derivatives cannot be computed; only the inner derivatives ($r_s=t$, $\\theta_s=s/\\sqrt{s^2+t^2}$, …) can.",
     "srcs": ["S003·17", "T003a 00:26:28"]},
]

TRAPS = [
    {"topic": "T5", "text": "Slide 003·16 shows $\\dfrac{\\partial v}{\\partial y}=-3\\dfrac{\\partial v}{\\partial r}+\\dfrac{\\partial v}{\\partial s}$; it should be "
     "$-3\\dfrac{\\partial v}{\\partial r}+3\\dfrac{\\partial v}{\\partial s}$ because $s=3y-4z$ gives $s_y=3$. With the 3 the proof works.", "srcs": ["S003·16"], "flags": [ADD]},
    {"topic": "T5", "text": "Do not stop with $x$ and $y$ still in an answer that should be in $r,\\theta$ or $s,t$.", "srcs": ["T004b 00:07:52"]},
    {"topic": "T5", "text": "Write $\\dfrac{\\partial z}{\\partial u}$, not $\\dfrac{dz}{du}$: $z$ depends on both $u$ and $v$.", "srcs": ["S003·13"], "flags": [ADD]},
]

WORKED = [
    {"id": "W5.1", "topic": "T5", "title": "Prove $6v_x+4v_y+3v_z=0$", "srcs": ["S003·15", "S003·16", "T003a 00:22:14"], "stars": 3,
     "given": "$v=f(2x-3y,\\ 3y-4z,\\ 4z-2x)$.",
     "steps": ["Let $r=2x-3y$, $s=3y-4z$, $t=4z-2x$: $r_x=2,\\ s_x=0,\\ t_x=-2$; $r_y=-3,\\ s_y=3,\\ t_y=0$; $r_z=0,\\ s_z=-4,\\ t_z=4$.",
               "$v_x=2v_r-2v_t$, $v_y=-3v_r+3v_s$, $v_z=-4v_s+4v_t$.", "$6v_x+4v_y+3v_z=(12-12)v_r+(12-12)v_s+(-12+12)v_t$."],
     "answer": "$6v_x+4v_y+3v_z=0$", "check": "The weights 6, 4, 3 are chosen so that each of $v_r,v_s,v_t$ cancels."},
    {"id": "W5.2", "topic": "T5", "title": "Unknown outer function", "srcs": ["S003·17", "T003a 00:25:02"], "stars": 3,
     "given": "$z=f(r,\\theta)$, $r=ts-t^2$, $\\theta=\\sqrt{s^2+t^2}$.",
     "steps": ["$r_s=t$, $\\theta_s=\\dfrac{s}{\\sqrt{s^2+t^2}}$; $r_t=s-2t$, $\\theta_t=\\dfrac{t}{\\sqrt{s^2+t^2}}$.",
               "$z_s=f_r\\,r_s+f_\\theta\\,\\theta_s$ and $z_t=f_r\\,r_t+f_\\theta\\,\\theta_t$."],
     "answer": "$\\dfrac{\\partial z}{\\partial s}=t\\,f_r+\\dfrac{s}{\\sqrt{s^2+t^2}}f_\\theta,\\quad \\dfrac{\\partial z}{\\partial t}=(s-2t)f_r+\\dfrac{t}{\\sqrt{s^2+t^2}}f_\\theta$",
     "check": "sympy's chain rule on a symbolic $f$ gives the same."},
    {"id": "W5.3", "topic": "T5", "title": "$u=f(x,y)$, $x=e^{st}$, $y=s^2+t^2$", "srcs": ["S003·25", "T003b 00:08:18"], "stars": 3,
     "given": "$u=f(x,y)$, $x=e^{st}$, $y=s^2+t^2$.",
     "steps": ["$x_s=te^{st}$, $x_t=se^{st}$, $y_s=2s$, $y_t=2t$.", "$u_s=f_xx_s+f_yy_s$, $u_t=f_xx_t+f_yy_t$."],
     "answer": "$\\dfrac{\\partial u}{\\partial s}=te^{st}f_x+2s\\,f_y,\\quad \\dfrac{\\partial u}{\\partial t}=se^{st}f_x+2t\\,f_y$", "check": ""},
    {"id": "W5.4", "topic": "T5", "title": "$\\sin(x^2+y^2)$ in polar form", "srcs": ["S004·10", "T004b 00:00:10"], "stars": 2,
     "given": "$u=\\sin(x^2+y^2)$, $x=r\\cos t$, $y=r\\sin t$; find $u_t$.",
     "steps": ["$u_x=2x\\cos(x^2+y^2)$, $u_y=2y\\cos(x^2+y^2)$; $x_t=-r\\sin t$, $y_t=r\\cos t$.",
               "$u_t=2\\cos(r^2)\\,[\\,r\\cos t(-r\\sin t)+r\\sin t(r\\cos t)\\,]$."],
     "answer": "$\\dfrac{\\partial u}{\\partial t}=0$", "check": "$u=\\sin r^2$ does not involve $t$ at all."},
    {"id": "W5.5", "topic": "T5", "title": "Three intermediate variables", "srcs": ["S004·11", "T004b 00:03:09"], "stars": 2,
     "given": "$u=x^2y+yz^3$, $x=r\\cos\\theta$, $y=r\\sin\\theta$, $z=\\theta$; find $u_\\theta$.",
     "steps": ["$u_x=2xy$, $u_y=x^2+z^3$, $u_z=3yz^2$; $x_\\theta=-r\\sin\\theta$, $y_\\theta=r\\cos\\theta$, $z_\\theta=1$.",
               "$u_\\theta=2xy(-r\\sin\\theta)+(x^2+z^3)(r\\cos\\theta)+3yz^2$.",
               "Substitute: $-2r^3\\cos\\theta\\sin^2\\theta+r^3\\cos^3\\theta=r^3\\cos\\theta(3\\cos^2\\theta-2)$."],
     "answer": "$\\dfrac{\\partial u}{\\partial\\theta}=r^3\\cos\\theta\\,(3\\cos^2\\theta-2)+r\\,(3\\theta^2\\sin\\theta+\\theta^3\\cos\\theta)$", "check": "sympy agrees."},
    {"id": "W5.6", "topic": "T5", "title": "$u=f(r)$ with $r$ the distance", "srcs": ["S004·12", "T004b 00:05:07"], "stars": 2,
     "given": "$u=f(r)$, $r=\\sqrt{x^2+y^2+z^2}$.",
     "steps": ["$u_x=\\dfrac{du}{dr}\\,r_x=f'(r)\\,r_x$.", "$r_x=\\dfrac{x}{\\sqrt{x^2+y^2+z^2}}=\\dfrac{x}{r}$."],
     "answer": "$\\dfrac{\\partial u}{\\partial x}=f'(r)\\,\\dfrac{x}{r}$", "check": "By symmetry $u_y=f'(r)\\,y/r$, $u_z=f'(r)\\,z/r$."},
    {"id": "W5.7", "topic": "T5", "title": "$e^{x^2+y^2}$ in polar form", "srcs": ["S004·13", "S004·14", "T004b 00:06:38"], "stars": 2,
     "given": "$u=e^{x^2+y^2}$, $x=r\\cos\\theta$, $y=r\\sin\\theta$.",
     "steps": ["$u_\\theta=2xe^{x^2+y^2}(-r\\sin\\theta)+2ye^{x^2+y^2}(r\\cos\\theta)$.", "$=2re^{r^2}(-r\\cos\\theta\\sin\\theta+r\\sin\\theta\\cos\\theta)$."],
     "answer": "$\\dfrac{\\partial u}{\\partial\\theta}=0$", "check": "$u=e^{r^2}$ has no $\\theta$."},
    {"id": "W5.8", "topic": "T5", "title": "Show $\\partial u/\\partial\\theta=1$", "srcs": ["S004·15", "T004b 00:08:40"], "stars": 2,
     "given": "$u=\\tan^{-1}(y/x)$, $x=r\\cos\\theta$, $y=r\\sin\\theta$.",
     "steps": ["$u_x=\\dfrac{-y}{x^2+y^2}$, $u_y=\\dfrac{x}{x^2+y^2}$; $x_\\theta=-r\\sin\\theta$, $y_\\theta=r\\cos\\theta$.",
               "$u_\\theta=\\dfrac{r^2\\sin^2\\theta+r^2\\cos^2\\theta}{r^2}$."],
     "answer": "$\\dfrac{\\partial u}{\\partial\\theta}=1$", "check": "$u=\\tan^{-1}(\\tan\\theta)=\\theta$."},
    {"id": "W5.9", "topic": "T5", "title": "$u=\\sin(xy)+y^3$, $x=e^s$, $y=s+t$", "srcs": ["S004·16", "T004b 00:09:32"], "stars": 2,
     "given": "$u=\\sin(xy)+y^3$, $x=e^s$, $y=s+t$.",
     "steps": ["$u_x=y\\cos(xy)$, $u_y=x\\cos(xy)+3y^2$; $x_s=e^s$, $y_s=1$, $x_t=0$, $y_t=1$.",
               "$u_s=y\\cos(xy)e^s+(x\\cos(xy)+3y^2)$, $u_t=x\\cos(xy)+3y^2$, then substitute $x=e^s$, $y=s+t$."],
     "answer": "$u_s=(s+t)e^s\\cos\\!\\big(e^s(s+t)\\big)+e^s\\cos\\!\\big(e^s(s+t)\\big)+3(s+t)^2,\\quad u_t=e^s\\cos\\!\\big(e^s(s+t)\\big)+3(s+t)^2$",
     "check": "sympy agrees."},
    {"id": "W5.10", "topic": "T5", "title": "$u=f(r,\\theta)$ from Cartesian coordinates", "srcs": ["S004·17", "T004b 00:10:47"], "stars": 2,
     "given": "$u=f(r,\\theta)$, $r=\\sqrt{x^2+y^2}$, $\\theta=\\tan^{-1}(y/x)$.",
     "steps": ["$r_x=\\dfrac{x}{r}$, $r_y=\\dfrac{y}{r}$, $\\theta_x=-\\dfrac{y}{r^2}$, $\\theta_y=\\dfrac{x}{r^2}$.", "$u_x=f_rr_x+f_\\theta\\theta_x$, $u_y=f_rr_y+f_\\theta\\theta_y$."],
     "answer": "$\\dfrac{\\partial u}{\\partial x}=f_r\\dfrac{x}{r}-f_\\theta\\dfrac{y}{r^2},\\quad \\dfrac{\\partial u}{\\partial y}=f_r\\dfrac{y}{r}+f_\\theta\\dfrac{x}{r^2}$", "check": ""},
    {"id": "W5.11", "topic": "T5", "title": "$xu_x+yu_y+zu_z$ for $f(x/y,\\,y/z,\\,z/x)$", "srcs": ["ESA Jan-24 s1 1d"], "stars": 3, "flags": [ADD],
     "given": "$u=f\\big(\\tfrac xy,\\tfrac yz,\\tfrac zx\\big)$; find $xu_x+yu_y+zu_z$.",
     "steps": ["Let $p=\\tfrac xy$, $q=\\tfrac yz$, $w=\\tfrac zx$.", "$xu_x=x\\big(\\tfrac1y f_p-\\tfrac{z}{x^2}f_w\\big)=p\\,f_p-w\\,f_w$.",
               "$yu_y=y\\big(-\\tfrac{x}{y^2}f_p+\\tfrac1z f_q\\big)=-p\\,f_p+q\\,f_q$.", "$zu_z=z\\big(-\\tfrac{y}{z^2}f_q+\\tfrac1x f_w\\big)=-q\\,f_q+w\\,f_w$.", "Add the three lines."],
     "answer": "$x\\dfrac{\\partial u}{\\partial x}+y\\dfrac{\\partial u}{\\partial y}+z\\dfrac{\\partial u}{\\partial z}=0$",
     "check": "$u$ is homogeneous of degree 0 (scaling $x,y,z$ leaves every ratio unchanged), so Euler's theorem gives 0 too."},
    {"id": "W5.12", "topic": "T5", "title": "$u_x+u_y+u_z$ for $f(x-y,\\,y-z,\\,z-x)$", "srcs": ["ESA Jan-24 s2 1d"], "stars": 3, "flags": [ADD],
     "given": "$u=f(x-y,\\ y-z,\\ z-x)$; find $u_x+u_y+u_z$.",
     "steps": ["Let $p=x-y$, $q=y-z$, $w=z-x$.", "$u_x=f_p-f_w$, $u_y=-f_p+f_q$, $u_z=-f_q+f_w$.", "Add."],
     "answer": "$\\dfrac{\\partial u}{\\partial x}+\\dfrac{\\partial u}{\\partial y}+\\dfrac{\\partial u}{\\partial z}=0$", "check": "Same pattern as W5.1 with equal weights."},
    {"id": "W5.13", "topic": "T5", "title": "$z=f(u,v)$, $u=x^2-y^2$, $v=2xy$", "srcs": ["ESA Jan-24 s3 1b"], "stars": 3, "flags": [ADD],
     "given": "Show $z_x^2+z_y^2=4(u^2+v^2)^{1/2}\\,(z_u^2+z_v^2)$.",
     "steps": ["$z_x=z_u(2x)+z_v(2y)$, $z_y=z_u(-2y)+z_v(2x)$.",
               "$z_x^2+z_y^2=4(x^2+y^2)(z_u^2+z_v^2)$: the cross terms $8xy\\,z_uz_v$ cancel.",
               "$u^2+v^2=(x^2-y^2)^2+4x^2y^2=(x^2+y^2)^2$, so $x^2+y^2=(u^2+v^2)^{1/2}$."],
     "answer": "$z_x^2+z_y^2=4\\sqrt{u^2+v^2}\\,(z_u^2+z_v^2)$", "check": "Numerical check with a sample $f$ in sympy: residual $\\approx10^{-14}$."},
    {"id": "W5.14", "topic": "T5", "title": "$z=f(x,y)$, $x=e^u\\sin v$, $y=e^u\\cos v$", "srcs": ["ESA Jan-24 s4 1b"], "stars": 3, "flags": [ADD],
     "given": "Show $z_x^2+z_y^2=e^{-2u}(z_u^2+z_v^2)$.",
     "steps": ["$z_u=z_x\\,e^u\\sin v+z_y\\,e^u\\cos v=xz_x+yz_y$.", "$z_v=z_x\\,e^u\\cos v-z_y\\,e^u\\sin v=yz_x-xz_y$.",
               "$z_u^2+z_v^2=(x^2+y^2)(z_x^2+z_y^2)$: the cross terms cancel.", "$x^2+y^2=e^{2u}$."],
     "answer": "$z_x^2+z_y^2=e^{-2u}\\,(z_u^2+z_v^2)$", "check": "sympy with a sample $f$: exact 0."},
    {"id": "W5.15", "topic": "T5", "title": "$z=\\log(u^2+v)$", "srcs": ["ESA Jun-24 1a", "CW U1 P14"], "stars": 3,
     "given": "$z=\\log(u^2+v)$, $u=e^{x+y^2}$, $v=x+y^2$; find $2y\\,z_x-z_y$.",
     "steps": ["$z_u=\\dfrac{2u}{u^2+v}$, $z_v=\\dfrac{1}{u^2+v}$; $u_x=u$, $u_y=2yu$, $v_x=1$, $v_y=2y$.",
               "$z_x=\\dfrac{2u^2+1}{u^2+v}$, $z_y=\\dfrac{2y(2u^2+1)}{u^2+v}$."],
     "answer": "$2y\\,\\dfrac{\\partial z}{\\partial x}-\\dfrac{\\partial z}{\\partial y}=0$", "check": "CW answer: 0. Both depend on $x,y$ only through $x+y^2$."},
    {"id": "W5.16", "topic": "T5", "title": "Polar identity", "srcs": ["CW U1 P15"], "stars": 2,
     "given": "$u=u(x,y)$, $x=r\\cos\\theta$, $y=r\\sin\\theta$.",
     "steps": ["$u_r=u_x\\cos\\theta+u_y\\sin\\theta$.", "$u_\\theta=-u_x\\,r\\sin\\theta+u_y\\,r\\cos\\theta$, so $\\tfrac1r u_\\theta=-u_x\\sin\\theta+u_y\\cos\\theta$.",
               "Square and add: the cross terms cancel and $\\sin^2\\theta+\\cos^2\\theta=1$."],
     "answer": "$u_x^2+u_y^2=u_r^2+\\dfrac{1}{r^2}\\,u_\\theta^2$", "check": "sympy with a sample $u$: residual $\\approx10^{-16}$."},
]

PYQS = [
    {"topic": "T5", "paper": "ESA Jan 2024", "q": "UE23MA141A set 1, Q1.d", "marks": 5,
     "text": "If $u=f\\big(\\frac xy,\\frac yz,\\frac zx\\big)$, find the value of $x\\frac{\\partial u}{\\partial x}+y\\frac{\\partial u}{\\partial y}+z\\frac{\\partial u}{\\partial z}$.", "worked": "W5.11"},
    {"topic": "T5", "paper": "ESA Jan 2024", "q": "UE23MA141A set 2, Q1.d", "marks": 5,
     "text": "If $u=f(x-y,\\,y-z,\\,z-x)$, find the value of $\\frac{\\partial u}{\\partial x}+\\frac{\\partial u}{\\partial y}+\\frac{\\partial u}{\\partial z}$.", "worked": "W5.12"},
    {"topic": "T5", "paper": "ESA Jan 2024", "q": "UE23MA141A set 3, Q1.b", "marks": 6,
     "text": "If $z=f(u,v)$ and $u=x^2-y^2$, $v=2xy$, show that $\\big(\\frac{\\partial z}{\\partial x}\\big)^2+\\big(\\frac{\\partial z}{\\partial y}\\big)^2=4(u^2+v^2)^{1/2}\\Big[\\big(\\frac{\\partial z}{\\partial u}\\big)^2+\\big(\\frac{\\partial z}{\\partial v}\\big)^2\\Big]$.", "worked": "W5.13"},
    {"topic": "T5", "paper": "ESA Jan 2024", "q": "UE23MA141A set 4, Q1.b", "marks": 6,
     "text": "If $z=f(x,y)$ and $x=e^u\\sin v$, $y=e^u\\cos v$, show that $\\big(\\frac{\\partial z}{\\partial x}\\big)^2+\\big(\\frac{\\partial z}{\\partial y}\\big)^2=e^{-2u}\\Big[\\big(\\frac{\\partial z}{\\partial u}\\big)^2+\\big(\\frac{\\partial z}{\\partial v}\\big)^2\\Big]$.", "worked": "W5.14"},
    {"topic": "T5", "paper": "ESA June 2024", "q": "UE23MA141A Q1.a", "marks": 6,
     "text": "If $z=\\log(u^2+v)$, where $u=e^{x+y^2}$, $v=x+y^2$, then find the value of $2y\\frac{\\partial z}{\\partial x}-\\frac{\\partial z}{\\partial y}$.", "worked": "W5.15"},
]

NOTES = [
    {"topic": "T5", "text": "If $z=f(x,y)$ with $x=g(u,v)$, $y=h(u,v)$, then $z$ is a composite function of $u,v$ and "
     "$z_u=z_xx_u+z_yy_u$, $z_v=z_xx_v+z_yy_v$ (one term per path in the tree diagram). With three intermediate variables there "
     "are three terms. If $f$ is unknown, keep $f_x,f_y$ as symbols. Write the final answer in the new variables. Standard results: "
     "$f(x-y,y-z,z-x)$ gives $u_x+u_y+u_z=0$; in polar form $u_x^2+u_y^2=u_r^2+u_\\theta^2/r^2$."},
]

FIGS = [
    {"id": "G5.1", "topic": "T5", "title": "Tree diagram for the chain rule", "stars": 3, "srcs": ["S003·14", "T003a 00:19:42"],
     "howto": "$z$ branches to $x$ and $y$, and each of those branches to both $u$ and $v$, giving four leaves. For $\\partial z/\\partial u$ follow "
              "only the two paths ending at $u$ (blue): $z_xx_u+z_yy_u$. For $\\partial z/\\partial v$ follow the two ending at $v$ "
              "(vermilion). In an exam, draw the tree first and read the terms off it."},
]

FLOWS = [
    {"id": "F5.1", "topic": "T5", "title": "Which rule? Read the chain first.", "stars": 3, "srcs": ["S003·5", "S003·13", "S004·5", "S004·6", "T004b 00:02:31"],
     "layout": "route", "maxw": "165mm",
     "spec": {"question": "What depends on what?",
              "rows": [{"title": "$y=f(g(x))$, one variable throughout", "sub": "Outer to inner, multiply", "kw": "chain rule, one variable"},
                       {"title": "$z=f(x,y)$; $x$, $y$ functions of one $t$", "sub": "$dz/dt=z_x\\,x'+z_y\\,y'$", "kw": "total derivative"},
                       {"title": "$z=f(x,y)$; $x$, $y$ functions of $u,v$", "sub": "$z_u=z_xx_u+z_yy_u$, same for $v$", "kw": "chain rule, partial"},
                       {"title": "$f(x,y)=0$ links $x$ and $y$", "sub": "$dy/dx=-f_x/f_y$", "kw": "implicit, 2 variables"},
                       {"title": "$f(x,y,z)=0$ links three variables", "sub": "$z_x=-f_x/f_z$, $z_y=-f_y/f_z$", "kw": "implicit, 3 variables"},
                       {"title": "Small changes, no time", "sub": "$dz=f_x\\,dx+f_y\\,dy$", "kw": "total differential", "dashed": True}]},
     "remark": "The dashed route has no derivative with respect to a variable: it estimates a change. Everything else starts from the tree diagram."},
    {"id": "F5.2", "topic": "T5", "title": "Proving an identity such as $6v_x+4v_y+3v_z=0$.", "stars": 3, "srcs": ["S003·15", "S003·16", "ESA Jan-24 s2 1d"],
     "layout": "straight", "maxw": "120mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$v=f(2x-3y,\\ 3y-4z,\\ 4z-2x)$", "sub": "Prove $6v_x+4v_y+3v_z=0$"},
         {"kind": "step", "n": 1, "title": "Name the arguments", "fx": "$r=2x-3y,\\ s=3y-4z,\\ t=4z-2x$"},
         {"kind": "step", "n": 2, "title": "Inner derivatives (numbers)", "sub": "$r_x=2,\\ s_x=0,\\ t_x=-2;\\ r_y=-3,\\ s_y=3,\\ t_y=0;\\ r_z=0,\\ s_z=-4,\\ t_z=4$"},
         {"kind": "step", "n": 3, "title": "Chain rule for each", "fx": "$v_x=2v_r-2v_t,\\ \\ v_y=-3v_r+3v_s,\\ \\ v_z=-4v_s+4v_t$"},
         {"kind": "check", "title": "Combine with the weights 6, 4, 3", "sub": "Every $v_r$, $v_s$, $v_t$ cancels, so the sum is 0."}]},
     "trap": "Slide 003·16 drops the 3 in $v_y=-3v_r+3v_s$; without it the terms do not cancel."},
]

COMPARISONS = [
    {"id": "C5.1", "topic": "T5", "title": "Total derivative vs chain rule vs implicit differentiation", "flags": [ADD],
     "srcs": ["S003·5", "S003·13", "S004·4", "S004·6"],
     "head": ["", "Total derivative", "Chain rule (partial)", "Implicit function"],
     "rows": [["Set-up", "$z=f(x,y)$, $x(t)$, $y(t)$", "$z=f(x,y)$, $x(u,v)$, $y(u,v)$", "$f(x,y)=0$ or $f(x,y,z)=0$"],
              ["Final variables", "one: $t$", "two: $u$, $v$", "$x$ (and $y$)"],
              ["Formula", "$z_x\\,x'+z_y\\,y'$", "$z_xx_u+z_yy_u$", "$-f_x/f_y$, $-f_x/f_z$"],
              ["Result written", "$dz/dt$", "$\\partial z/\\partial u$, $\\partial z/\\partial v$", "$dy/dx$, $\\partial z/\\partial x$"],
              ["Typical question", "rate of change at an instant", "prove an identity", "slope or tangent line"]]},
]
