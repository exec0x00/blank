"""Unit 2, class 011 VoP (deck SESSION 8): method of variation of parameters."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "The method: $y_p=uy_1+vy_2$ with the Wronskian",
     "overview": r"Variation of parameters finds the particular integral of a second-order linear equation $y''+py'+qy=X$ whose "
                 r"complementary function $y_c=c_1y_1+c_2y_2$ is known. The constants $c_1$, $c_2$ are replaced by functions $u(x)$, $v(x)$: "
                 r"$y_p=uy_1+vy_2$ with $u=-\int\frac{y_2X}{W}dx$, $v=\int\frac{y_1X}{W}dx$, where $W=y_1y_2'-y_2y_1'\neq0$ is the Wronskian. "
                 r"The coefficient of $y''$ must be 1 first. It works for any $X$ (and for variable coefficients once the CF is known); its "
                 r"price is that the CF must be found first and the integrals can be hard."},
    {"id": "T2", "title": "Slide and lecture examples: $xe^{-x}$, $\\tan 2x$, $\\frac{2}{1+e^x}$, a Cauchy equation",
     "overview": r"The deck works three examples in the same three steps (CF and $y_1,y_2$ → Wronskian → $u$, $v$, PI): "
                 r"$y''-2y'-3y=xe^{-x}$ (by parts), $(D^2+4)y=\tan2x$ (the $\sec$ integral) and $(D^2-1)y=\frac{2}{1+e^x}$ (partial "
                 r"fractions and the substitution $t=1+e^{-x}$). Slide 011V·13's boxed answer drops a factor $\cos2x$. The second lecture "
                 r"also solves the Cauchy equation $x^2y''-3xy'+3y=12x^4$ by the method, working in $z=\log x$ (transcript only)."},
    {"id": "T3", "title": "Trigonometric right-hand sides: $\\sec ax$, $\\csc x$, $e^x\\tan x$, $e^{-x}\\sec^3x$",
     "overview": r"For complex AE roots $\alpha\pm i\beta$, $y_1=e^{\alpha x}\cos\beta x$, $y_2=e^{\alpha x}\sin\beta x$ and $W=\beta e^{2\alpha x}$, so the "
                 r"exponentials cancel whenever $X=e^{\alpha x}g(x)$. What remains are the standard integrals of $\tan$, $\cot$, $\sec$ and "
                 r"$\frac{\sin}{\cos^3}$. Two ESA questions (Jan-24 s1 3a $=$ CW P25, Jan-24 s2 3a) and CW P23, P26, P28 are of this kind."},
    {"id": "T4", "title": "Repeated roots with $X=\\frac{e^{mx}}{x^k}$, and the leading-coefficient trap",
     "overview": r"For a repeated root $m$, $y_1=e^{mx}$, $y_2=xe^{mx}$ and $W=e^{2mx}$; with $X=e^{mx}g(x)$ the integrals reduce to "
                 r"$u=-\int xg\,dx$, $v=\int g\,dx$. With $g=\frac1x$ (ESA Jul-23 3c $=$ Jun-24 3a, May-24 3c) the PI is $xe^{mx}\log x$ after "
                 r"absorbing $-xe^{mx}$ into the CF; with $g=\frac{1}{x^2}$ (CW P24) it is $-e^{mx}\log x$. CW P27 has leading coefficient 2: "
                 r"divide by 2 before using $X$."},
]

DEFS = [
    {"topic": "T1", "term": "Method of variation of parameters", "text": r"A method to find the particular integral of a linear differential "
     r"equation whose complementary function is known, by replacing the constants $c_1,c_2$ of $y_c=c_1y_1+c_2y_2$ by functions $u(x)$, $v(x)$.",
     "srcs": ["S011V·4", "T011V 00:00:16", "T011V 00:00:25"]},
    {"topic": "T1", "term": "Wronskian", "text": r"$W(y_1,y_2)=\begin{vmatrix}y_1&y_2\\y_1'&y_2'\end{vmatrix}=y_1y_2'-y_2y_1'$; it is non-zero when "
     r"$y_1$, $y_2$ are linearly independent solutions (class 001).", "srcs": ["S011V·5", "T011V 00:02:35", "T011V 00:03:05"]},
    {"topic": "T1", "term": "Linearly independent", "text": r"$y_1$, $y_2$ are linearly independent if $c_1y_1+c_2y_2\equiv0$ only for $c_1=c_2=0$; "
     r"then $c_1y_1+c_2y_2$ is the CF.", "srcs": ["T011V 00:01:48", "T011V 00:02:06"], "flags": [ADD]},
    {"topic": "T1", "term": "Standard form", "text": r"$\frac{d^2y}{dx^2}+p\frac{dy}{dx}+qy=X$: the coefficient of $\frac{d^2y}{dx^2}$ is 1 and $X$ is the "
     r"right-hand side of this form (divide the whole equation by the leading coefficient first).", "srcs": ["S011V·4", "S011V·6", "T011V 00:06:06"]},
    {"topic": "T1", "term": "Parameters $u$, $v$", "text": r"The functions $u=-\int\frac{y_2X}{W}dx$ and $v=\int\frac{y_1X}{W}dx$, written without "
     r"constants of integration.", "srcs": ["S011V·5", "T011V 00:03:26", "T011V 00:04:18"]},
]

STATEMENTS = [
    {"topic": "T1", "text": r"This method is used to find the particular integral of a linear differential equation whose complimentary function is "
     r"known. Though this method is general, we will illustrate it by applying to a second order LDE with constant coefficients. Consider a "
     r"second order linear differential equation $\frac{d^2y}{dx^2}+p\frac{dy}{dx}+qy=X$ where $p$ and $q$ are constants and $X$, a function of "
     r"$x$. Let its complimentary function be CF $=c_1y_1+c_2y_2$.", "srcs": ["S011V·4"]},
    {"topic": "T1", "text": r"$W$ is the wronskian of $y_1$ and $y_2$ and is given by $W=\begin{vmatrix}y_1&y_2\\y_1'&y_2'\end{vmatrix}$. The particular "
     r"solution of the differential eqn is given by PI $=u.y_1+v.y_2$ where $u$ and $v$ are given by $u=-\int\frac{y_2.X}{W}dx$ and "
     r"$v=\int\frac{y_1.X}{W}dx$. Note: The constant of integration is not written in the expressions of $u$ and $v$.", "srcs": ["S011V·5"]},
    {"topic": "T1", "text": r"This method can also be used on differential equation with variable coefficient provided we know to find the general "
     r"solution of the associated homogeneous equation. The coefficient of $\frac{d^2y}{dx^2}$ in the differential equation must be unity. If it "
     r"is not unity, make it one by dividing the differential equation by the coefficient.", "srcs": ["S011V·6"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Standard form and CF", "tex": r"y''+p\,y'+q\,y=X,\qquad y_c=c_1y_1+c_2y_2",
     "gives": "The starting point: $y_1$, $y_2$ from the CF.", "when": "Coefficient of $y''$ equal to 1.",
     "note": "Divide by the leading coefficient first (CW P27).", "stars": 3,
     "srcs": ["S011V·4", "S011V·6", "T011V 00:00:43", "T011V 00:06:06", "CW U2 P27"]},
    {"id": "E1.2", "topic": "T1", "title": "Wronskian", "tex": r"W=\begin{vmatrix}y_1&y_2\\ y_1'&y_2'\end{vmatrix}=y_1y_2'-y_2y_1'\neq0",
     "gives": "The denominator of both integrals.", "when": "$y_1$, $y_2$ linearly independent.",
     "note": "Order matters: $W(y_2,y_1)=-W(y_1,y_2)$, but the PI is unchanged (T011Vb 00:09:20).", "stars": 3,
     "srcs": ["S011V·5", "S011V·8", "T011V 00:02:35", "T011V 00:10:22", "ESA Jul-23 3c"]},
    {"id": "E1.3", "topic": "T1", "title": "The parameters $u$ and $v$",
     "tex": r"u=-\int\frac{y_2\,X}{W}\,dx,\qquad v=\int\frac{y_1\,X}{W}\,dx",
     "gives": "The two varying parameters.", "when": "Every VoP problem.",
     "note": "Minus sign on $u$ (with $y_2$); no constants of integration.", "stars": 3,
     "srcs": ["S011V·5", "T011V 00:03:26", "T011V 00:04:18", "ESA Jul-23 3c", "ESA May-24 3c", "ESA Jan-24 s1 3a", "ESA Jan-24 s2 3a"]},
    {"id": "E1.4", "topic": "T1", "title": "The particular integral and the general solution",
     "tex": r"y_p=u\,y_1+v\,y_2,\qquad y=c_1y_1+c_2y_2+y_p",
     "gives": "The PI and, with the CF, the general solution.", "when": "After E1.3.",
     "note": "Terms of $y_p$ that are multiples of $y_1$ or $y_2$ may be absorbed into $c_1$, $c_2$.", "stars": 3,
     "srcs": ["S011V·5", "S011V·10", "S011V·17", "T011V 00:14:11", "T011Vb 00:16:16"]},
    {"id": "E1.5", "topic": "T1", "title": "Why: the two conditions on $u'$, $v'$",
     "tex": r"\begin{gathered}u'y_1+v'y_2=0,\qquad u'y_1'+v'y_2'=X\\ \Rightarrow\ u'=-\frac{y_2X}{W},\quad v'=\frac{y_1X}{W}\end{gathered}",
     "gives": "E1.3 by Cramer's rule.", "when": "Derivation; not on the slides.",
     "note": "The first condition is a free choice that keeps $y_p'$ free of $u'$, $v'$; the second is the equation itself.", "stars": 1,
     "srcs": ["S011V·5"], "flags": [ADD]},
    {"id": "E2.1", "topic": "T2", "title": "Integrals of slides 011V·12–16",
     "tex": r"\begin{gathered}\int\sec2x\,dx=\tfrac12\log(\sec2x+\tan2x),\qquad \int\frac{dx}{e^x(1+e^x)}=-e^{-x}+\log(1+e^{-x})\\ \int\frac{e^x}{1+e^x}dx=\log(1+e^x),\qquad \int xe^{-4x}dx=-\frac{e^{-4x}}{4}\Big(x+\frac14\Big)\end{gathered}",
     "gives": "The four integrals the deck needs.", "when": "$\\tan2x$, $\\frac{2}{1+e^x}$, $xe^{-x}$.",
     "note": "$\\frac{1}{e^x(1+e^x)}=\\frac{1}{e^x}-\\frac{1}{1+e^x}$ and $\\frac{1}{1+e^x}=\\frac{e^{-x}}{1+e^{-x}}$.", "stars": 2,
     "srcs": ["S011V·9", "S011V·12", "S011V·15", "S011V·16", "S011V·17", "T011Vb 00:05:21", "T011Vb 00:11:06", "T011Vb 00:12:55"]},
    {"id": "E2.2", "topic": "T2", "title": "Result: $(D^2+4)y=\\tan2x$", "tex": r"y_p=-\frac14\cos2x\,\log(\sec2x+\tan2x)",
     "gives": "The PI (slide 011V·13's line above the box; CW P28).", "when": "$u=\\frac14[\\sin2x-\\log(\\sec2x+\\tan2x)]$, $v=-\\frac{\\cos2x}{4}$.",
     "note": "Slide 011V·13's box omits $\\cos2x$.", "stars": 2, "srcs": ["S011V·13", "CW U2 P28", "T011Vb 00:07:06"]},
    {"id": "E2.3", "topic": "T2", "title": "Result: $(D^2-1)y=\\frac{2}{1+e^x}$",
     "tex": r"y_p=e^x\log(1+e^{-x})-e^{-x}\log(1+e^x)-1",
     "gives": "The PI (slide 011V·17).", "when": "$u=-e^{-x}+\\log(1+e^{-x})$, $v=-\\log(1+e^x)$.",
     "note": "The $-1$ is not a CF term: keep it.", "stars": 2, "srcs": ["S011V·17", "T011Vb 00:15:48"]},
    {"id": "E3.1", "topic": "T3", "title": "Complex roots $\\alpha\\pm i\\beta$ with $X=e^{\\alpha x}g(x)$",
     "tex": r"\begin{gathered}y_1=e^{\alpha x}\cos\beta x,\quad y_2=e^{\alpha x}\sin\beta x,\quad W=\beta e^{2\alpha x}\\ u=-\frac1\beta\int g\sin\beta x\,dx,\qquad v=\frac1\beta\int g\cos\beta x\,dx\end{gathered}",
     "gives": "The integrals with the exponentials already cancelled.", "when": "CW P23, P25, P26, P28; ESA Jan-24 s1 3a, s2 3a.",
     "note": "$\\alpha=0$ for $D^2+a^2$ ($W=a$); $D^2-2D+2$: $1\\pm i$; $D^2+2D+2$: $-1\\pm i$.", "stars": 3,
     "srcs": ["S011V·11", "CW U2 P23", "CW U2 P25", "ESA Jan-24 s1 3a", "ESA Jan-24 s2 3a"], "flags": [ADD]},
    {"id": "E3.2", "topic": "T3", "title": "Trigonometric integrals used",
     "tex": r"\begin{gathered}\int\tan ax\,dx=\tfrac1a\log\sec ax,\qquad \int\cot x\,dx=\log\sin x,\qquad \int\sec x\,dx=\log(\sec x+\tan x)\\ \int\frac{\sin^2x}{\cos x}dx=\log(\sec x+\tan x)-\sin x,\qquad \int\frac{\sin x}{\cos^3x}dx=\frac{\sec^2x}{2}\end{gathered}",
     "gives": "Every integral of Topic 3.", "when": "After E3.1.",
     "note": "Strictly $\\log|\\cdot|$; $\\int\\frac{\\sin x}{\\cos^3x}dx=\\frac{\\tan^2x}{2}$ is also right (differs by $\\frac12$).", "stars": 3,
     "srcs": ["S011V·12", "CW U2 P23", "CW U2 P25", "CW U2 P26", "ESA Jan-24 s2 3a"]},
    {"id": "E3.3", "topic": "T3", "title": "Results: $\\sec ax$, $\\csc x$, $e^x\\tan x$, $e^{-x}\\sec^3x$",
     "tex": r"\begin{gathered}\frac{\sec ax}{D^2+a^2}:\ \frac{\cos ax}{a^2}\log\cos ax+\frac xa\sin ax,\qquad \frac{\csc x}{D^2+1}:\ -x\cos x+\sin x\log\sin x\\ \frac{e^x\tan x}{D^2-2D+2}:\ -e^x\cos x\log(\sec x+\tan x),\qquad \frac{e^{-x}\sec^3x}{D^2+2D+2}:\ \tfrac12e^{-x}\sin x\tan x\end{gathered}",
     "gives": "The four PIs (W3.1–W3.4).", "when": "Asked by variation of parameters.",
     "note": "The last one may also be written $-\\frac{e^{-x}\\cos2x}{2\\cos x}$ (differs by a CF term).", "stars": 3,
     "srcs": ["CW U2 P23", "CW U2 P25", "CW U2 P26", "ESA Jan-24 s1 3a", "ESA Jan-24 s2 3a"]},
    {"id": "E4.1", "topic": "T4", "title": "Repeated root $m$ with $X=e^{mx}g(x)$",
     "tex": r"y_1=e^{mx},\quad y_2=xe^{mx},\quad W=e^{2mx},\qquad u=-\int x\,g\,dx,\quad v=\int g\,dx",
     "gives": "The integrals with the exponentials cancelled.", "when": "$(D-m)^2y=e^{mx}g(x)$: ESA Jul-23 3c, May-24 3c, CW P24.",
     "note": "$g=\\frac1x$: $u=-x$, $v=\\log x$. $g=\\frac{1}{x^2}$: $u=-\\log x$, $v=-\\frac1x$.", "stars": 3,
     "srcs": ["ESA Jul-23 3c", "ESA May-24 3c", "CW U2 P24"], "flags": [ADD]},
    {"id": "E4.2", "topic": "T4", "title": "Results: $\\frac{e^{mx}}{x}$ and $\\frac{e^{mx}}{x^2}$",
     "tex": r"\begin{gathered}(D-m)^2y=\frac{e^{mx}}{x}:\quad y=(c_1+c_2x)e^{mx}+xe^{mx}\log x\\ (D-m)^2y=\frac{e^{mx}}{x^2}:\quad y_p=-e^{mx}\log x\end{gathered}",
     "gives": "The ESA answers with $m=-3$ (Jul-23, Jun-24) and $m=1$ (May-24); CW P24 with $m=-1$.", "when": "After absorbing CF terms.",
     "note": "Raw $uy_1+vy_2$ has an extra $-xe^{mx}$ (resp. $-e^{mx}$): a CF term.", "stars": 3,
     "srcs": ["ESA Jul-23 3c", "ESA Jun-24 3a", "ESA May-24 3c", "CW U2 P24"]},
]

POINTS = [
    {"topic": "T1", "text": "The method gives only the particular integral, and it needs the complementary function first: “the complementary function is "
     "absolutely required to apply this method”.", "stars": 3, "srcs": ["S011V·4", "T011V 00:00:25", "T011V 00:06:42", "T011Vb 00:01:12"]},
    {"topic": "T1", "text": "Three steps: (1) CF, read off $y_1$, $y_2$; (2) Wronskian $W=y_1y_2'-y_2y_1'$; (3) $u=-\\int\\frac{y_2X}{W}dx$, "
     "$v=\\int\\frac{y_1X}{W}dx$, $y_p=uy_1+vy_2$ (Figure F1.1).", "stars": 3,
     "srcs": ["T011V 00:08:55", "T011Vb 00:01:29", "T011Vb 00:08:20", "S011V·7", "S011V·8", "S011V·9"]},
    {"topic": "T1", "text": "Make the coefficient of $\\frac{d^2y}{dx^2}$ equal to 1 before reading off $X$; otherwise $u$ and $v$ are wrong by that factor.",
     "stars": 3, "srcs": ["S011V·6", "T011V 00:06:06", "CW U2 P27"]},
    {"topic": "T1", "text": "No constants of integration in $u$, $v$: “the constant of integration gets absorbed with the constants of the "
     "complementary function”.", "stars": 3, "srcs": ["S011V·5", "T011V 00:04:18", "T011Vb 00:07:06"]},
    {"topic": "T1", "text": "Use it when the question says “by the method of variation of parameters” (every ESA VoP question does), or when $X$ "
     "is not a standard form ($\\tan$, $\\sec$, $\\csc$, $\\frac{e^{mx}}{x}$, $\\frac{1}{1+e^x}$, …).", "stars": 3,
     "srcs": ["T011V 00:08:19", "ESA Jul-23 3c", "ESA Jan-24 s1 3a", "CW U2 P23"]},
    {"topic": "T1", "text": "It is general: it also works for variable coefficients when the CF is known, and for higher order; only second order is taught.",
     "stars": 1, "srcs": ["S011V·6", "T011V 00:05:09", "T011V 00:05:39", "T011Vb 00:16:33"]},
    {"topic": "T1", "text": "Demerits (lecture): it needs the CF, and the integrals can be very difficult.", "stars": 2,
     "srcs": ["T011V 00:06:31", "T011V 00:06:55", "T011Vb 00:04:19"]},
    {"topic": "T1", "text": "Swapping $y_1$ and $y_2$ changes the sign of $W$ but not the final PI.", "stars": 2, "srcs": ["T011Vb 00:09:02", "T011Vb 00:09:20"]},
    {"topic": "T2", "text": "$y''-2y'-3y=xe^{-x}$ could be done by the Type 4 rule; by VoP $W=-4e^{2x}$, $u$ by parts, $v=-\\frac{x^2}{8}$; the two PIs differ by "
     "$-\\frac{e^{-x}}{64}$, a CF term.", "stars": 2, "srcs": ["S011V·7", "S011V·10", "T011V 00:08:02"]},
    {"topic": "T2", "text": "For $\\tan2x$ write $\\frac{\\sin^22x}{\\cos2x}=\\sec2x-\\cos2x$ before integrating.", "stars": 2,
     "srcs": ["S011V·12", "T011Vb 00:04:58"]},
    {"topic": "T2", "text": "For $\\frac{2}{1+e^x}$: partial fractions $\\frac{1}{e^x(1+e^x)}=\\frac{1}{e^x}-\\frac{1}{1+e^x}$, then multiply by $e^{-x}$ "
     "to get $\\frac{e^{-x}}{1+e^{-x}}$, a $\\frac{dt}{t}$ form.", "stars": 2, "srcs": ["S011V·15", "S011V·16", "T011Vb 00:11:06", "T011Vb 00:12:10"]},
    {"topic": "T2", "text": "For a Cauchy equation, first put $x=e^z$; then do VoP in $z$ and return to $x$ at the end (lecture only).", "stars": 1,
     "srcs": ["T011Vb 00:17:57", "T011Vb 00:20:11", "T011Vb 00:23:01"], "flags": [TONLY]},
    {"topic": "T3", "text": "With complex roots and $X=e^{\\alpha x}g$, the exponentials cancel: $W=\\beta e^{2\\alpha x}$ (E3.1). ESA Jan-24 s1 3a and s2 3a are "
     "this pattern.", "stars": 3, "srcs": ["ESA Jan-24 s1 3a", "ESA Jan-24 s2 3a", "CW U2 P25"], "flags": [ADD]},
    {"topic": "T3", "text": "Know the integrals: $\\int\\tan=\\log\\sec$, $\\int\\cot=\\log\\sin$, $\\int\\sec=\\log(\\sec+\\tan)$, $\\int\\frac{\\sin}{\\cos^3}=\\frac{\\sec^2}{2}$.",
     "stars": 3, "srcs": ["CW U2 P23", "CW U2 P26", "ESA Jan-24 s2 3a", "S011V·12"]},
    {"topic": "T4", "text": "ESA Jul-23 3c $=$ Jun-24 3a and May-24 3c are the same pattern: $(D-m)^2y=\\frac{e^{mx}}{x}$, answer "
     "$y=(c_1+c_2x)e^{mx}+xe^{mx}\\log x$.", "stars": 3, "srcs": ["ESA Jul-23 3c", "ESA Jun-24 3a", "ESA May-24 3c"]},
    {"topic": "T4", "text": "State it when you absorb a term: “$-xe^{mx}$ is a multiple of $y_2$ and is absorbed into $c_2$”.", "stars": 2,
     "srcs": ["ESA Jul-23 3c", "CW U2 P24"], "flags": [ADD]},
]

WHY = [
    {"topic": "T1", "q": "Why are $u'$ and $v'$ given by those formulas?",
     "a": "Try $y_p=uy_1+vy_2$ and impose $u'y_1+v'y_2=0$; then $y_p'=uy_1'+vy_2'$ and substituting into $y''+py'+qy=X$ leaves "
          "$u'y_1'+v'y_2'=X$ (because $y_1$, $y_2$ solve the homogeneous equation). Cramer's rule on the two equations gives "
          "$u'=-\\frac{y_2X}{W}$, $v'=\\frac{y_1X}{W}$.", "srcs": ["S011V·5"], "flags": [ADD]},
    {"topic": "T1", "q": "Why must the coefficient of $y''$ be 1?",
     "a": "The derivation substitutes into $y''+py'+qy=X$; the second condition is $u'y_1'+v'y_2'=X$ only for that form. For $2y''+\\dots=R$ "
          "the right-hand side to use is $X=\\frac R2$.", "srcs": ["S011V·6", "T011V 00:06:06"], "flags": [ADD]},
    {"topic": "T1", "q": "Why may constants of integration be dropped?",
     "a": "A constant $k$ in $u$ adds $ky_1$ to $y_p$, which is already in the CF $c_1y_1$; the same for $v$ and $y_2$.",
     "srcs": ["T011V 00:04:18", "S011V·5"]},
    {"topic": "T1", "q": "Why is $W\\neq0$ needed?",
     "a": "$W$ is the determinant of the system for $u'$, $v'$; it is non-zero exactly because $y_1$, $y_2$ are linearly independent.",
     "srcs": ["T011V 00:03:05", "S011V·5"]},
    {"topic": "T4", "q": "Why can the operator rules not do $\\frac{e^{-3x}}{x}$?",
     "a": "Type 4 gives $e^{-3x}\\frac{1}{D^2}\\frac1x$, i.e. integrating $\\frac1x$ twice, which is possible ($x\\log x-x$) — the VoP route just "
          "organises the same integrals. The question asks for VoP, so use it.", "srcs": ["ESA Jul-23 3c"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T2", "text": "Slide 011V·13's box writes $y_p=-\\frac14\\log(\\sec2x+\\tan2x)$: the factor $\\cos2x$ is missing. The correct PI is "
     "$-\\frac14\\cos2x\\log(\\sec2x+\\tan2x)$ (the slide's own previous line; CW P28).", "srcs": ["S011V·13", "CW U2 P28"]},
    {"topic": "T1", "text": "Forgetting the minus sign in $u=-\\int\\frac{y_2X}{W}dx$, or pairing $y_1$ with $u$'s integral: $u$ goes with $y_2$ inside, "
     "$v$ with $y_1$.", "srcs": ["S011V·5"], "flags": [ADD]},
    {"topic": "T1", "text": "Sign of $W$: for $e^{3x}$, $e^{-x}$ it is $-4e^{2x}$, negative. Carry the sign through $u$ and $v$.", "srcs": ["S011V·8", "S011V·14"]},
    {"topic": "T4", "text": "CW P27 ($2y''-y'-\\dots=25e^{-x}$): divide by 2 first, so $X=\\frac{25}{2}e^{-x}$, not $25e^{-x}$.", "srcs": ["CW U2 P27", "S011V·6"]},
    {"topic": "T1", "text": "“Linearly independent if $c_1y_1+c_2y_2\\neq0$” (lecture) is loose: it means $c_1y_1+c_2y_2\\equiv0$ forces $c_1=c_2=0$.",
     "srcs": ["T011V 00:02:06"], "flags": [ADD]},
    {"topic": "T2", "text": "In $(D^2-1)y=\\frac{2}{1+e^x}$ the constant $-1$ in $y_p$ is not a CF term (the CF is $c_1e^x+c_2e^{-x}$): do not drop it.",
     "srcs": ["S011V·17"], "flags": [ADD]},
    {"topic": "T4", "text": "“Solve” means $y=y_c+y_p$: the ESA questions want the general solution, not only $y_p$.", "srcs": ["ESA Jul-23 3c", "ESA May-24 3c"],
     "flags": [ADD]},
]

WORKED = [
    {"id": "W2.1", "topic": "T2", "title": "$y''-2y'-3y=xe^{-x}$ (slides 011V·7–10)", "stars": 2,
     "srcs": ["S011V·7", "S011V·8", "S011V·9", "S011V·10", "T011V 00:07:10", "T011V 00:14:03"],
     "given": "Find the particular integral by the method of variation of parameters: $(D^2-2D-3)y=xe^{-x}$.",
     "steps": ["Step 1: AE $m^2-2m-3=0$, $m=3,-1$. $y_c=c_1e^{3x}+c_2e^{-x}$; $y_1=e^{3x}$, $y_2=e^{-x}$; $X=xe^{-x}$.",
               "Step 2: $W=e^{3x}(-e^{-x})-e^{-x}(3e^{3x})=-4e^{2x}$.",
               "$u=-\\int\\frac{e^{-x}\\cdot xe^{-x}}{-4e^{2x}}dx=\\frac14\\int xe^{-4x}dx=\\frac14\\Big[-\\frac{xe^{-4x}}{4}-\\frac{e^{-4x}}{16}\\Big]=-\\frac{e^{-4x}}{16}\\Big(x+\\frac14\\Big)$ (by parts).",
               "$v=\\int\\frac{e^{3x}\\cdot xe^{-x}}{-4e^{2x}}dx=-\\frac14\\int x\\,dx=-\\frac{x^2}{8}$.",
               "$y_p=uy_1+vy_2=-\\frac{e^{-x}}{16}\\Big(x+\\frac14\\Big)-\\frac{x^2e^{-x}}{8}$."],
     "answer": "$y_p=-\\dfrac{x^2e^{-x}}{8}-\\dfrac{xe^{-x}}{16}-\\dfrac{e^{-x}}{64}$; $\\ y=c_1e^{3x}+c_2e^{-x}+y_p$",
     "check": "Slide 011V·10 agrees. sympy: residual 0; dsolve gives $C_2e^{3x}+(C_1-\\frac{x^2}{8}-\\frac x{16})e^{-x}$, i.e. the $-\\frac{e^{-x}}{64}$ is absorbed "
              "into $c_2$; the Type 4 rule gives the same. Figure G2.1."},
    {"id": "W2.2", "topic": "T2", "title": "$(D^2+4)y=\\tan2x$ (slides 011V·11–13; CW P28)", "stars": 2,
     "srcs": ["S011V·11", "S011V·12", "S011V·13", "T011Vb 00:00:53", "T011Vb 00:07:06", "CW U2 P28"],
     "given": "Find the PI by variation of parameters (CW P28: solve) of $\\frac{d^2y}{dx^2}+4y=\\tan2x$.",
     "steps": ["AE $m^2+4=0$, $m=\\pm2i$. $y_c=c_1\\cos2x+c_2\\sin2x$; $y_1=\\cos2x$, $y_2=\\sin2x$.",
               "$W=\\cos2x\\cdot2\\cos2x-\\sin2x(-2\\sin2x)=2$.",
               "$u=-\\int\\frac{\\sin2x\\tan2x}{2}dx=-\\frac12\\int\\frac{1-\\cos^22x}{\\cos2x}dx=-\\frac12\\int(\\sec2x-\\cos2x)dx$ "
               "$=-\\frac12\\Big[\\frac{\\log(\\sec2x+\\tan2x)}{2}-\\frac{\\sin2x}{2}\\Big]=\\frac14[\\sin2x-\\log(\\sec2x+\\tan2x)]$.",
               "$v=\\int\\frac{\\cos2x\\tan2x}{2}dx=\\frac12\\int\\sin2x\\,dx=-\\frac{\\cos2x}{4}$.",
               "$y_p=\\frac14[\\sin2x-\\log(\\sec2x+\\tan2x)]\\cos2x-\\frac{\\sin2x\\cos2x}{4}$: the $\\sin2x\\cos2x$ terms cancel."],
     "answer": "$y=c_1\\cos2x+c_2\\sin2x-\\dfrac14\\cos2x\\,\\log(\\sec2x+\\tan2x)$",
     "check": "<b>Slide 011V·13's box drops $\\cos2x$</b>; substituting it back fails, the answer above leaves residual 0 (sympy). Matches CW P28 and "
              "the operator method with $a=2$ (class 009, W2.1). T011Vb 00:06:49 says $v=-\\frac{\\cos2x}{2}$; it is $-\\frac{\\cos2x}{4}$. Figure G1.1."},
    {"id": "W2.3", "topic": "T2", "title": "$(D^2-1)y=\\frac{2}{1+e^x}$ (slides 011V·14–17)", "stars": 2,
     "srcs": ["S011V·14", "S011V·15", "S011V·16", "S011V·17", "T011Vb 00:07:39", "T011Vb 00:15:48"],
     "given": "Find the general solution by the method of variation of parameters: $(D^2-1)y=\\frac{2}{1+e^x}$.",
     "steps": ["AE $m^2-1=0$, $m=\\pm1$. $y_c=c_1e^x+c_2e^{-x}$; $y_1=e^x$, $y_2=e^{-x}$. $W=e^x(-e^{-x})-e^{-x}e^x=-2$.",
               "$u=-\\int\\frac{e^{-x}\\cdot\\frac{2}{1+e^x}}{-2}dx=\\int\\frac{dx}{e^x(1+e^x)}=\\int\\Big(\\frac{1}{e^x}-\\frac{1}{1+e^x}\\Big)dx$.",
               "$\\int e^{-x}dx=-e^{-x}$; $\\int\\frac{dx}{1+e^x}=\\int\\frac{e^{-x}}{1+e^{-x}}dx$, $t=1+e^{-x}$, $dt=-e^{-x}dx$: $=-\\log(1+e^{-x})$.",
               "So $u=-e^{-x}+\\log(1+e^{-x})$.",
               "$v=\\int\\frac{e^x\\cdot\\frac{2}{1+e^x}}{-2}dx=-\\int\\frac{e^x}{1+e^x}dx=-\\log(1+e^x)$.",
               "$y_p=e^x[-e^{-x}+\\log(1+e^{-x})]+e^{-x}[-\\log(1+e^x)]$."],
     "answer": "$y=c_1e^x+c_2e^{-x}+e^x\\log(1+e^{-x})-e^{-x}\\log(1+e^x)-1$",
     "check": "Slide 011V·17 agrees (it stops at “$y=y_c+y_p$”). sympy: $u'$, $v'$ match the integrands, residual 0. As $x\\to-\\infty$, $X\\to2$ and "
              "$y_p\\to-2$; as $x\\to\\infty$, $y_p\\to0$. Figure G2.2, Figure F2.1."},
    {"id": "W2.4", "topic": "T2", "title": "$x^2y''-3xy'+3y=12x^4$ by variation of parameters (lecture only)", "stars": 1, "flags": [TONLY],
     "srcs": ["T011Vb 00:16:53", "T011Vb 00:18:50", "T011Vb 00:20:49", "T011Vb 00:22:41", "T011Vb 00:23:25"],
     "given": "Find the general solution by the method of variation of parameters of $x^2\\frac{d^2y}{dx^2}-3x\\frac{dy}{dx}+3y=12x^4$ (Cauchy's equation).",
     "steps": ["$x=e^z$, $z=\\log x$: $xy'=Dy$, $x^2y''=D(D-1)y$ with $D=\\frac{d}{dz}$. So $(D^2-4D+3)y=12e^{4z}$ (leading coefficient 1).",
               "AE $m^2-4m+3=0$, $m=3,1$: $y_c=c_1e^{3z}+c_2e^z$; $y_1=e^{3z}$, $y_2=e^z$, $X=12e^{4z}$.",
               "$W=e^{3z}e^z-e^z\\cdot3e^{3z}=-2e^{4z}$.",
               "$u=-\\int\\frac{e^z\\cdot12e^{4z}}{-2e^{4z}}dz=6\\int e^zdz=6e^z$; $\\ v=\\int\\frac{e^{3z}\\cdot12e^{4z}}{-2e^{4z}}dz=-6\\int e^{3z}dz=-2e^{3z}$.",
               "$y_p=6e^z\\cdot e^{3z}-2e^{3z}\\cdot e^z=4e^{4z}=4x^4$; $y_c=c_1x^3+c_2x$."],
     "answer": "$y=c_1x^3+c_2x+4x^4$",
     "check": "sympy dsolve of the original equation gives $x(C_1+C_2x^2+4x^3)$; $x^2(48x^2)-3x(16x^3)+3(4x^4)=12x^4$. The CF step is from the class "
              "011 Legendre pack."},
    {"id": "W3.1", "topic": "T3", "title": "$y''+a^2y=\\sec ax$ (CW P23)", "stars": 2, "srcs": ["CW U2 P23"],
     "given": "Solve $\\frac{d^2y}{dx^2}+a^2y=\\sec ax$ by the method of variation of parameters.",
     "steps": ["AE $m=\\pm ia$: $y_1=\\cos ax$, $y_2=\\sin ax$; $W=\\cos ax\\cdot a\\cos ax+\\sin ax\\cdot a\\sin ax=a$.",
               "$u=-\\int\\frac{\\sin ax\\sec ax}{a}dx=-\\frac1a\\int\\tan ax\\,dx=-\\frac{1}{a^2}\\log\\sec ax=\\frac{1}{a^2}\\log\\cos ax$.",
               "$v=\\int\\frac{\\cos ax\\sec ax}{a}dx=\\frac1a\\int dx=\\frac xa$.",
               "$y_p=\\frac{\\cos ax}{a^2}\\log\\cos ax+\\frac xa\\sin ax$."],
     "answer": "$y=C_1\\cos ax+C_2\\sin ax+\\dfrac{\\cos ax}{a^2}\\log\\cos ax+\\dfrac xa\\sin ax$",
     "check": "CW answer agrees. sympy (symbolic $a$): $W=a$, $u$, $v$ as above, residual 0. ($\\log|\\cos ax|$ strictly.)"},
    {"id": "W3.2", "topic": "T3", "title": "$y''+y=\\csc x$ (CW P26)", "stars": 2, "srcs": ["CW U2 P26"],
     "given": "Solve $\\frac{d^2y}{dx^2}+y=\\operatorname{cosec}x$ by the method of variation of parameters.",
     "steps": ["$y_1=\\cos x$, $y_2=\\sin x$, $W=1$.",
               "$u=-\\int\\sin x\\csc x\\,dx=-x$; $\\ v=\\int\\cos x\\csc x\\,dx=\\int\\cot x\\,dx=\\log\\sin x$.",
               "$y_p=-x\\cos x+\\sin x\\log\\sin x$."],
     "answer": "$y=C_1\\cos x+C_2\\sin x-x\\cos x+\\sin x\\log\\sin x$",
     "check": "CW answer agrees; sympy residual 0."},
    {"id": "W3.3", "topic": "T3", "title": "$(D^2-2D+2)y=e^x\\tan x$ (ESA Jan-24 s1 3a $=$ CW P25)", "stars": 3,
     "srcs": ["ESA Jan-24 s1 3a", "CW U2 P25"],
     "given": "Solve $(D^2-2D+2)y=e^x\\tan x$ by the method of variation of parameters (7 marks).",
     "steps": ["AE $m^2-2m+2=0$, $m=1\\pm i$: $y_c=e^x(c_1\\cos x+c_2\\sin x)$; $y_1=e^x\\cos x$, $y_2=e^x\\sin x$.",
               "$W=e^x\\cos x\\cdot e^x(\\sin x+\\cos x)-e^x\\sin x\\cdot e^x(\\cos x-\\sin x)=e^{2x}$.",
               "$u=-\\int\\frac{e^x\\sin x\\cdot e^x\\tan x}{e^{2x}}dx=-\\int\\frac{\\sin^2x}{\\cos x}dx=-\\int(\\sec x-\\cos x)dx=\\sin x-\\log(\\sec x+\\tan x)$.",
               "$v=\\int\\frac{e^x\\cos x\\cdot e^x\\tan x}{e^{2x}}dx=\\int\\sin x\\,dx=-\\cos x$.",
               "$y_p=e^x\\cos x[\\sin x-\\log(\\sec x+\\tan x)]-e^x\\sin x\\cos x=-e^x\\cos x\\log(\\sec x+\\tan x)$."],
     "answer": "$y=e^x(c_1\\cos x+c_2\\sin x)-e^x\\cos x\\,\\log(\\sec x+\\tan x)$",
     "check": "sympy: $W=e^{2x}$, $u'$, $v'$ match, residual 0. CW P25's printed answer reads “$e^x\\cos\\log(\\sec x+\\tan x)$”: the $x$ of $\\cos x$ is "
              "missing. Figure F3.1."},
    {"id": "W3.4", "topic": "T3", "title": "$y''+2y'+2y=e^{-x}\\sec^3x$ (ESA Jan-24 s2 3a)", "stars": 3, "srcs": ["ESA Jan-24 s2 3a"],
     "given": "Solve $y''+2y'+2y=e^{-x}\\sec^3x$ by the method of variation of parameters (7 marks).",
     "steps": ["AE $m^2+2m+2=0$, $m=-1\\pm i$: $y_c=e^{-x}(c_1\\cos x+c_2\\sin x)$; $y_1=e^{-x}\\cos x$, $y_2=e^{-x}\\sin x$.",
               "$W=e^{-2x}$ (E3.1 with $\\alpha=-1$, $\\beta=1$).",
               "$u=-\\int\\frac{e^{-x}\\sin x\\cdot e^{-x}\\sec^3x}{e^{-2x}}dx=-\\int\\frac{\\sin x}{\\cos^3x}dx=-\\frac{1}{2\\cos^2x}$ ($t=\\cos x$).",
               "$v=\\int\\frac{e^{-x}\\cos x\\cdot e^{-x}\\sec^3x}{e^{-2x}}dx=\\int\\sec^2x\\,dx=\\tan x$.",
               "$y_p=-\\frac{e^{-x}\\cos x}{2\\cos^2x}+\\frac{e^{-x}\\sin^2x}{\\cos x}=e^{-x}\\frac{2\\sin^2x-1}{2\\cos x}=-\\frac{e^{-x}\\cos2x}{2\\cos x}$.",
               "Equivalently, $-\\frac{e^{-x}\\cos2x}{2\\cos x}=\\frac{e^{-x}\\sin^2x}{2\\cos x}-\\frac12e^{-x}\\cos x$, and $-\\frac12e^{-x}\\cos x$ is absorbed into $c_1$."],
     "answer": "$y=e^{-x}(c_1\\cos x+c_2\\sin x)+\\dfrac12e^{-x}\\sin x\\tan x$",
     "check": "sympy: residual 0 for both forms; dsolve gives $e^{-x}(C_1\\sin x+C_2\\cos x-\\frac{\\cos2x}{2\\cos x})$. Using $u=-\\frac{\\tan^2x}{2}$ gives the "
              "$\\frac12e^{-x}\\sin x\\tan x$ form directly. Figure G3.1."},
    {"id": "W4.1", "topic": "T4", "title": "$y''+6y'+9y=\\frac{e^{-3x}}{x}$ (ESA Jul-23 3c $=$ Jun-24 3a)", "stars": 3,
     "srcs": ["ESA Jul-23 3c", "ESA Jun-24 3a"],
     "given": "Solve $y''+6y'+9y=\\frac{e^{-3x}}{x}$ by the method of variation of parameters (6 marks).",
     "steps": ["AE $(m+3)^2=0$, $m=-3,-3$: $y_c=(c_1+c_2x)e^{-3x}$; $y_1=e^{-3x}$, $y_2=xe^{-3x}$.",
               "$W=e^{-3x}(1-3x)e^{-3x}-xe^{-3x}(-3e^{-3x})=e^{-6x}$.",
               "$u=-\\int\\frac{xe^{-3x}\\cdot e^{-3x}/x}{e^{-6x}}dx=-\\int dx=-x$; $\\ v=\\int\\frac{e^{-3x}\\cdot e^{-3x}/x}{e^{-6x}}dx=\\int\\frac{dx}{x}=\\log x$.",
               "$y_p=-xe^{-3x}+xe^{-3x}\\log x$; $-xe^{-3x}$ is a multiple of $y_2$: absorbed into $c_2$."],
     "answer": "$y=(c_1+c_2x)e^{-3x}+xe^{-3x}\\log x$",
     "check": "sympy: residual 0; dsolve gives $(C_1+x(C_2+\\log x))e^{-3x}$, the same. Figure G4.1, Figure F4.1."},
    {"id": "W4.2", "topic": "T4", "title": "$y''-2y'+y=\\frac{e^x}{x}$ (ESA May-24 3c)", "stars": 3, "srcs": ["ESA May-24 3c"],
     "given": "Solve $\\frac{d^2y}{dx^2}-2\\frac{dy}{dx}+y=\\frac{e^x}{x}$ by the method of variation of parameters (6 marks).",
     "steps": ["AE $(m-1)^2=0$, $m=1,1$: $y_c=(c_1+c_2x)e^x$; $y_1=e^x$, $y_2=xe^x$; $W=e^x(1+x)e^x-xe^x\\cdot e^x=e^{2x}$.",
               "$u=-\\int\\frac{xe^x\\cdot e^x/x}{e^{2x}}dx=-x$; $\\ v=\\int\\frac{e^x\\cdot e^x/x}{e^{2x}}dx=\\log x$.",
               "$y_p=-xe^x+xe^x\\log x$; absorb $-xe^x$ into $c_2xe^x$."],
     "answer": "$y=(c_1+c_2x)e^x+xe^x\\log x$",
     "check": "sympy: residual 0. Same pattern as W4.1 with $m=1$ (E4.2)."},
    {"id": "W4.3", "topic": "T4", "title": "$y''+2y'+y=\\frac{e^{-x}}{x^2}$ (CW P24)", "stars": 2, "srcs": ["CW U2 P24"],
     "given": "Solve $\\frac{d^2y}{dx^2}+2\\frac{dy}{dx}+y=\\frac{e^{-x}}{x^2}$ by the method of variation of parameters.",
     "steps": ["$m=-1,-1$: $y_1=e^{-x}$, $y_2=xe^{-x}$, $W=e^{-2x}$.",
               "$u=-\\int\\frac{xe^{-x}\\cdot e^{-x}/x^2}{e^{-2x}}dx=-\\int\\frac{dx}{x}=-\\log x$; $\\ v=\\int\\frac{e^{-x}\\cdot e^{-x}/x^2}{e^{-2x}}dx=\\int\\frac{dx}{x^2}=-\\frac1x$.",
               "$y_p=-e^{-x}\\log x-\\frac1x\\cdot xe^{-x}=-e^{-x}\\log x-e^{-x}$; absorb $-e^{-x}$ into $C_1$."],
     "answer": "$y=C_1e^{-x}+C_2xe^{-x}-e^{-x}\\log x$",
     "check": "CW answer agrees after the absorption (the sheet does not mention it). sympy residual 0."},
    {"id": "W4.4", "topic": "T4", "title": "$2y''-y'-3y=25e^{-x}$ (CW P27; divide by 2 first)", "stars": 2, "srcs": ["CW U2 P27", "S011V·6"],
     "given": "CW P27, printed “$2\\frac{d^2y}{dx^2}-\\frac{dy}{dx}-y+=25e^{-x}$”; its answer fits $2y''-y'-3y=25e^{-x}$. Solve by variation of parameters.",
     "steps": ["Standard form: $y''-\\frac12y'-\\frac32y=\\frac{25}{2}e^{-x}$, so $X=\\frac{25}{2}e^{-x}$.",
               "AE $2m^2-m-3=0$, $(2m-3)(m+1)=0$, $m=\\frac32,-1$: $y_1=e^{3x/2}$, $y_2=e^{-x}$; $W=e^{3x/2}(-e^{-x})-e^{-x}\\cdot\\frac32e^{3x/2}=-\\frac52e^{x/2}$.",
               "$u=-\\int\\frac{e^{-x}\\cdot\\frac{25}{2}e^{-x}}{-\\frac52e^{x/2}}dx=5\\int e^{-5x/2}dx=-2e^{-5x/2}$; $\\ v=\\int\\frac{e^{3x/2}\\cdot\\frac{25}{2}e^{-x}}{-\\frac52e^{x/2}}dx=-5\\int dx=-5x$.",
               "$y_p=-2e^{-x}-5xe^{-x}$ ($-2e^{-x}$ could be absorbed into $C_2e^{-x}$).",
               "As printed with $-y$: AE $2m^2-m-1=0$, $m=1,-\\frac12$, $W=-\\frac32e^{x/2}$, $u=-\\frac{25}{6}e^{-2x}$, $v=\\frac{50}{3}e^{-x/2}$, $y_p=\\frac{25}{2}e^{-x}$."],
     "answer": "$y=C_1e^{3x/2}+C_2e^{-x}-2e^{-x}-5xe^{-x}$ (with $-3y$, the CW answer); with $-y$: $y=C_1e^x+C_2e^{-x/2}+\\frac{25}{2}e^{-x}$",
     "check": "sympy: both residuals 0; dsolve gives $C_2e^{3x/2}+(C_1-5x)e^{-x}$ and $C_1e^{-x/2}+C_2e^x+\\frac{25}{2}e^{-x}$. Without dividing by 2 every "
              "$u$, $v$ would be twice too large."},
]

PYQS = [
    {"topic": "T4", "paper": "ESA Jul 2023", "q": "UE22MA141A Q3.c", "marks": 6,
     "text": "Solve $y''+6y'+9y=\\frac{e^{-3x}}{x}$ by the method of variation of parameters.", "worked": "W4.1"},
    {"topic": "T4", "paper": "ESA Jun 2024", "q": "UE23MA141A Q3.a", "marks": 6,
     "text": "Solve $y''+6y'+9y=\\frac{e^{-3x}}{x}$ by the method of variation of parameters (repeat of Jul-23 3c).", "worked": "W4.1"},
    {"topic": "T4", "paper": "ESA May 2024", "q": "UE22MA141A Q3.c", "marks": 6,
     "text": "Solve $\\frac{d^2y}{dx^2}-2\\frac{dy}{dx}+y=\\frac{e^x}{x}$ by the method of variation of parameters.", "worked": "W4.2"},
    {"topic": "T3", "paper": "ESA Jan 2024 set 1", "q": "UE23MA141A Q3.a", "marks": 7,
     "text": "Solve $(D^2-2D+2)y=e^x\\tan x$ by the method of variation of parameters (= CW P25).", "worked": "W3.3"},
    {"topic": "T3", "paper": "ESA Jan 2024 set 2", "q": "UE23MA141A Q3.a", "marks": 7,
     "text": "Solve $y''+2y'+2y=e^{-x}\\sec^3x$ by the method of variation of parameters.", "worked": "W3.4"},
]

NOTES = [
    {"topic": "T1", "text": "Variation of parameters gives the PI of $y''+py'+qy=X$ once the CF $c_1y_1+c_2y_2$ is known. Make the coefficient of "
     "$y''$ 1. Wronskian $W=y_1y_2'-y_2y_1'\\neq0$. $u=-\\int\\frac{y_2X}{W}dx$, $v=\\int\\frac{y_1X}{W}dx$ (no constants), $y_p=uy_1+vy_2$, "
     "$y=y_c+y_p$. Works for any $X$ and, with a known CF, for variable coefficients. Demerits: needs the CF; integrals can be hard."},
    {"topic": "T2", "text": "$y''-2y'-3y=xe^{-x}$: $W=-4e^{2x}$, $y_p=-\\frac{e^{-x}}{16}(x+\\frac14)-\\frac{x^2e^{-x}}{8}$. $(D^2+4)y=\\tan2x$: $W=2$, "
     "$y_p=-\\frac14\\cos2x\\log(\\sec2x+\\tan2x)$ (slide box drops $\\cos2x$). $(D^2-1)y=\\frac{2}{1+e^x}$: $W=-2$, "
     "$y_p=e^x\\log(1+e^{-x})-e^{-x}\\log(1+e^x)-1$. Cauchy $x^2y''-3xy'+3y=12x^4$: in $z$, $W=-2e^{4z}$, $y=c_1x^3+c_2x+4x^4$."},
    {"topic": "T3", "text": "Roots $\\alpha\\pm i\\beta$, $X=e^{\\alpha x}g$: $W=\\beta e^{2\\alpha x}$, $u=-\\frac1\\beta\\int g\\sin\\beta x$, $v=\\frac1\\beta\\int g\\cos\\beta x$. "
     "$\\sec ax$: $\\frac{\\cos ax}{a^2}\\log\\cos ax+\\frac xa\\sin ax$. $\\csc x$: $-x\\cos x+\\sin x\\log\\sin x$. $e^x\\tan x$ (ESA): "
     "$-e^x\\cos x\\log(\\sec x+\\tan x)$. $e^{-x}\\sec^3x$ (ESA): $\\frac12e^{-x}\\sin x\\tan x$."},
    {"topic": "T4", "text": "Repeated root $m$: $y_1=e^{mx}$, $y_2=xe^{mx}$, $W=e^{2mx}$. $X=\\frac{e^{mx}}{x}$ (ESA ×3): $u=-x$, $v=\\log x$, "
     "$y=(c_1+c_2x)e^{mx}+xe^{mx}\\log x$. $X=\\frac{e^{-x}}{x^2}$: $y_p=-e^{-x}\\log x$. Leading coefficient 2: divide first (CW P27)."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "The parameters vary: $u(x)$, $v(x)$ and $y_p$ for $(D^2+4)y=\\tan2x$", "stars": 2,
     "srcs": ["S011V·12", "S011V·13"], "flags": [ADD],
     "howto": "On $-\\frac\\pi4<x<\\frac\\pi4$. Green: $u=\\frac14[\\sin2x-\\log(\\sec2x+\\tan2x)]$; purple: $v=-\\frac{\\cos2x}{4}$. In the CF they would be "
              "constants (horizontal lines); here they change with $x$, which is the idea of the method. Blue: $y_p=u\\cos2x+v\\sin2x$ "
              "$=-\\frac14\\cos2x\\log(\\sec2x+\\tan2x)$, which stays bounded although $u$ blows up at the ends."},
    {"id": "G2.1", "topic": "T2", "title": "Slide 011V·10: two particular integrals differ by a CF term", "stars": 2,
     "srcs": ["S011V·10", "T011V 00:08:02"], "flags": [ADD],
     "howto": "Blue: the VoP PI of slide 011V·10, $-\\frac{x^2e^{-x}}{8}-\\frac{xe^{-x}}{16}-\\frac{e^{-x}}{64}$. Vermilion dashed: the Type 4 PI "
              "$-\\frac{x^2e^{-x}}{8}-\\frac{xe^{-x}}{16}$. Grey: their difference $-\\frac{e^{-x}}{64}$, a multiple of $y_2=e^{-x}$, so both are correct PIs."},
    {"id": "G2.2", "topic": "T2", "title": "$(D^2-1)y=\\frac{2}{1+e^x}$: the PI follows $-X$ where $X$ changes slowly", "stars": 2,
     "srcs": ["S011V·17"], "flags": [ADD],
     "howto": "Vermilion dashed: $X=\\frac{2}{1+e^x}$, from 2 (left) to 0 (right). Blue: $y_p=e^x\\log(1+e^{-x})-e^{-x}\\log(1+e^x)-1$. For very "
              "negative $x$, $y_p\\to-2$ (the PI of $y''-y=2$); for large $x$, $y_p\\to0$. Grey: the levels $-2$ and 0."},
    {"id": "G3.1", "topic": "T3", "title": "ESA Jan-24 s2 3a: $y_p=\\frac{1}{2}e^{-x}\\sin x\\tan x$", "stars": 3,
     "srcs": ["ESA Jan-24 s2 3a"], "flags": [ADD],
     "howto": "On $-\\frac\\pi2<x<\\frac\\pi2$, where $\\sec x$ exists. Vermilion dashed: $X=e^{-x}\\sec^3x$. Blue: the PI, zero at $x=0$ and unbounded at the "
              "asymptotes $x=\\pm\\frac\\pi2$ (grey) like $X$. Grey solid: a general solution with $c_1=1$, $c_2=-1$."},
    {"id": "G4.1", "topic": "T4", "title": "ESA Jul-23 3c: $y_p=xe^{-3x}\\log x$ and general solutions", "stars": 3,
     "srcs": ["ESA Jul-23 3c", "ESA Jun-24 3a"], "flags": [ADD],
     "howto": "For $x>0$. Vermilion dashed: $X=\\frac{e^{-3x}}{x}$, unbounded at $x=0$. Blue: $y_p=xe^{-3x}\\log x$, negative for $x<1$, zero at $x=1$, "
              "tending to 0. Grey: two general solutions $(c_1+c_2x)e^{-3x}+y_p$; the dotted green curve is the un-absorbed $uy_1+vy_2=xe^{-3x}(\\log x-1)$, "
              "itself one of the general solutions ($c_2=-1$)."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "Variation of parameters in three steps (slides 011V·4–5)", "stars": 3,
     "srcs": ["S011V·4", "S011V·5", "T011V 00:08:55", "T011Vb 00:08:20"], "layout": "straight", "maxw": "140mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$y''+py'+qy=X$", "sub": "coefficient of $y''$ equal to 1"},
         {"kind": "step", "n": 1, "title": "CF, then $y_1$, $y_2$", "fx": "$y_c=c_1y_1+c_2y_2$"},
         {"kind": "step", "n": 2, "title": "Wronskian", "fx": "$W=y_1y_2'-y_2y_1'$"},
         {"kind": "step", "n": 3, "title": "The parameters (no constants)", "fx": "$u=-\\int\\frac{y_2X}{W}dx,\\ \\ v=\\int\\frac{y_1X}{W}dx$"},
         {"kind": "result", "title": "$y_p=uy_1+vy_2$", "fx": "$y=c_1y_1+c_2y_2+y_p$"}]},
     "remark": "Terms of $y_p$ that are multiples of $y_1$ or $y_2$ may be absorbed into $c_1$, $c_2$.",
     "trap": "Minus sign on $u$; $u$ has $y_2$ inside, $v$ has $y_1$."},
    {"id": "F1.2", "topic": "T1", "title": "Before you start: the standard form (slide 011V·6)", "stars": 3,
     "srcs": ["S011V·6", "T011V 00:06:06", "CW U2 P27"], "layout": "fork", "maxw": "150mm",
     "spec": {"before": [{"kind": "given", "title": "$a_0y''+a_1y'+a_2y=R(x)$"}],
              "question": "Is $a_0=1$?",
              "no": {"kind": "step", "title": "Divide by $a_0$", "fx": "$X=\\frac{R}{a_0}$"},
              "yes": {"kind": "step", "title": "Use as it is", "fx": "$X=R$"},
              "after": [{"kind": "result", "title": "Steps 1–3 of F1.1 with this $X$", "fx": "CW P27: $X=\\frac{25}{2}e^{-x}$"}]},
     "remark": "The CF (AE roots) is the same either way; only $X$ changes."},
    {"id": "F1.3", "topic": "T1", "title": "Which method for the PI?", "stars": 3, "flags": [ADD],
     "srcs": ["T011V 00:08:02", "T011V 00:08:19", "ESA Jul-23 3c", "CW U2 P23"], "layout": "route", "maxw": "150mm",
     "spec": {"question": "What does the question and $X$ look like?",
              "rows": [{"title": "“by the method of variation of parameters”", "sub": "every ESA VoP question; CW P23–P28", "kw": "VoP"},
                       {"title": "$X$ a standard form", "sub": "$e^{ax}$, $\\sin$, $\\cos$, $x^m$, $e^{ax}V$, $xV$", "kw": "operator rules"},
                       {"title": "$X=\\tan$, $\\sec$, $\\csc$, $\\frac{e^{mx}}{x^k}$, $\\frac{1}{1+e^x}$", "sub": "no shortcut rule", "kw": "VoP or 009"},
                       {"title": "Variable coefficients, CF known", "sub": "Cauchy: CF via $x=e^z$", "kw": "VoP", "dashed": True}]},
     "remark": "Class 009's operator method $\\frac{1}{D-m}X=e^{mx}\\int Xe^{-mx}dx$ is the alternative for non-standard $X$."},
    {"id": "F2.1", "topic": "T2", "title": "Slides 011V·14–17: $(D^2-1)y=\\frac{2}{1+e^x}$", "stars": 2,
     "srcs": ["S011V·14", "S011V·15", "S011V·16", "S011V·17"], "layout": "streams", "maxw": "165mm",
     "spec": {"left": [{"kind": "given", "title": "$u=-\\int\\frac{y_2X}{W}dx$", "sub": "$y_2=e^{-x}$, $W=-2$"},
                       {"kind": "step", "n": 1, "title": "Partial fractions", "fx": "$\\int\\big(\\frac{1}{e^x}-\\frac{1}{1+e^x}\\big)dx$"},
                       {"kind": "step", "n": 2, "title": "$t=1+e^{-x}$", "fx": "$u=-e^{-x}+\\log(1+e^{-x})$"}],
              "right": [{"kind": "given", "title": "$v=\\int\\frac{y_1X}{W}dx$", "sub": "$y_1=e^{x}$"},
                        {"kind": "step", "n": 3, "title": "$\\frac{dt}{t}$ form", "fx": "$-\\int\\frac{e^x}{1+e^x}dx$"},
                        {"kind": "step", "n": 4, "title": "Integrate", "fx": "$v=-\\log(1+e^x)$"}],
              "then": [{"kind": "result", "title": "$y_p=uy_1+vy_2$",
                        "fx": "$e^x\\log(1+e^{-x})-e^{-x}\\log(1+e^x)-1$"}]},
     "remark": "Worked in full as W2.3."},
    {"id": "F3.1", "topic": "T3", "title": "ESA Jan-24 s1 3a: $(D^2-2D+2)y=e^x\\tan x$", "stars": 3,
     "srcs": ["ESA Jan-24 s1 3a", "CW U2 P25"], "layout": "streams", "maxw": "165mm",
     "spec": {"left": [{"kind": "given", "title": "$u$", "sub": "$y_2=e^x\\sin x$, $W=e^{2x}$"},
                       {"kind": "step", "n": 1, "title": "Cancel $e^{2x}$", "fx": "$-\\int\\frac{\\sin^2x}{\\cos x}dx$"},
                       {"kind": "step", "n": 2, "title": "$\\sec x-\\cos x$", "fx": "$\\sin x-\\log(\\sec x+\\tan x)$"}],
              "right": [{"kind": "given", "title": "$v$", "sub": "$y_1=e^x\\cos x$"},
                        {"kind": "step", "n": 3, "title": "Cancel $e^{2x}$", "fx": "$\\int\\sin x\\,dx$"},
                        {"kind": "step", "n": 4, "title": "Integrate", "fx": "$-\\cos x$"}],
              "then": [{"kind": "result", "title": "$y_p=-e^x\\cos x\\log(\\sec x+\\tan x)$",
                        "fx": "$y=e^x(c_1\\cos x+c_2\\sin x)+y_p$"}]},
     "remark": "The $e^x\\sin x\\cos x$ terms cancel. Worked in full as W3.3 (7 marks)."},
    {"id": "F4.1", "topic": "T4", "title": "ESA Jul-23 3c: $y''+6y'+9y=\\frac{e^{-3x}}{x}$", "stars": 3,
     "srcs": ["ESA Jul-23 3c", "ESA Jun-24 3a"], "layout": "straight", "maxw": "140mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$m=-3,-3$", "sub": "$y_1=e^{-3x}$, $y_2=xe^{-3x}$"},
         {"kind": "step", "n": 1, "title": "Wronskian", "fx": "$W=e^{-6x}$"},
         {"kind": "step", "n": 2, "title": "Parameters", "fx": "$u=-\\int dx=-x,\\ \\ v=\\int\\frac{dx}{x}=\\log x$"},
         {"kind": "step", "n": 3, "title": "Absorb", "sub": "$-xe^{-3x}$ is a multiple of $y_2$"},
         {"kind": "result", "title": "$y=(c_1+c_2x)e^{-3x}+xe^{-3x}\\log x$", "fx": "W4.1"}]},
     "remark": "May-24 3c is the same with $m=1$: $y=(c_1+c_2x)e^x+xe^x\\log x$."},
]

COMPARISONS = [
    {"id": "C1.1", "topic": "T1", "title": "Variation of parameters or the operator rules?", "flags": [ADD],
     "srcs": ["T011V 00:06:31", "T011V 00:08:02", "S011V·6"],
     "head": ["", "Operator rules (classes 003–006, 009)", "Variation of parameters (this pack)"],
     "rows": [["Needs the CF first?", "no (PI alone)", "yes: $y_1$, $y_2$ and $W$"],
              ["Which $X$?", "standard forms; 009 for any $X$ via $\\frac{1}{D-m}$", "any $X$"],
              ["Variable coefficients", "only after a substitution", "yes, if the CF is known"],
              ["Main difficulty", "choosing the rule; failure cases", "the integrals"],
              ["Use when", "question says “solve”", "question says “by the method of variation of parameters”"]]},
    {"id": "C3.1", "topic": "T3", "title": "Every variation-of-parameters problem in this pack",
     "srcs": ["S011V·7", "S011V·11", "S011V·14", "CW U2 P23", "CW U2 P24", "CW U2 P25", "CW U2 P26", "CW U2 P27", "ESA Jul-23 3c",
              "ESA May-24 3c", "ESA Jan-24 s2 3a"],
     "head": ["Problem", "$y_1$, $y_2$", "$W$", "$u$", "$v$"],
     "rows": [["$xe^{-x}$, $D^2-2D-3$ (W2.1)", "$e^{3x}$, $e^{-x}$", "$-4e^{2x}$", "$-\\frac{e^{-4x}}{16}(x+\\frac14)$", "$-\\frac{x^2}{8}$"],
              ["$\\tan2x$, $D^2+4$ (W2.2)", "$\\cos2x$, $\\sin2x$", "$2$", "$\\frac14[\\sin2x-\\log(\\sec2x+\\tan2x)]$", "$-\\frac{\\cos2x}{4}$"],
              ["$\\frac{2}{1+e^x}$, $D^2-1$ (W2.3)", "$e^x$, $e^{-x}$", "$-2$", "$-e^{-x}+\\log(1+e^{-x})$", "$-\\log(1+e^x)$"],
              ["$\\sec ax$ (W3.1)", "$\\cos ax$, $\\sin ax$", "$a$", "$\\frac{1}{a^2}\\log\\cos ax$", "$\\frac xa$"],
              ["$\\csc x$ (W3.2)", "$\\cos x$, $\\sin x$", "$1$", "$-x$", "$\\log\\sin x$"],
              ["$e^x\\tan x$ (W3.3, ESA)", "$e^x\\cos x$, $e^x\\sin x$", "$e^{2x}$", "$\\sin x-\\log(\\sec x+\\tan x)$", "$-\\cos x$"],
              ["$e^{-x}\\sec^3x$ (W3.4, ESA)", "$e^{-x}\\cos x$, $e^{-x}\\sin x$", "$e^{-2x}$", "$-\\frac{\\sec^2x}{2}$", "$\\tan x$"],
              ["$\\frac{e^{-3x}}{x}$ (W4.1, ESA)", "$e^{-3x}$, $xe^{-3x}$", "$e^{-6x}$", "$-x$", "$\\log x$"],
              ["$\\frac{e^x}{x}$ (W4.2, ESA)", "$e^x$, $xe^x$", "$e^{2x}$", "$-x$", "$\\log x$"],
              ["$\\frac{e^{-x}}{x^2}$ (W4.3)", "$e^{-x}$, $xe^{-x}$", "$e^{-2x}$", "$-\\log x$", "$-\\frac1x$"],
              ["$\\frac{25}{2}e^{-x}$, $-3y$ (W4.4)", "$e^{3x/2}$, $e^{-x}$", "$-\\frac52e^{x/2}$", "$-2e^{-5x/2}$", "$-5x$"]]},
    {"id": "C4.1", "topic": "T4", "title": "Terms you may absorb into the CF", "flags": [ADD],
     "srcs": ["S011V·10", "ESA Jul-23 3c", "ESA May-24 3c", "CW U2 P24", "CW U2 P27", "ESA Jan-24 s2 3a"],
     "head": ["Problem", "Raw $uy_1+vy_2$", "Absorbed term", "Final PI"],
     "rows": [["W2.1", "$-\\frac{x^2e^{-x}}{8}-\\frac{xe^{-x}}{16}-\\frac{e^{-x}}{64}$", "$-\\frac{e^{-x}}{64}$ (into $c_2$)", "$-\\frac{x^2e^{-x}}{8}-\\frac{xe^{-x}}{16}$"],
              ["W4.1", "$xe^{-3x}\\log x-xe^{-3x}$", "$-xe^{-3x}$", "$xe^{-3x}\\log x$"],
              ["W4.2", "$xe^x\\log x-xe^x$", "$-xe^x$", "$xe^x\\log x$"],
              ["W4.3", "$-e^{-x}\\log x-e^{-x}$", "$-e^{-x}$", "$-e^{-x}\\log x$"],
              ["W4.4", "$-2e^{-x}-5xe^{-x}$", "$-2e^{-x}$ (optional)", "$-5xe^{-x}$"],
              ["W3.4", "$-\\frac{e^{-x}\\cos2x}{2\\cos x}$", "$-\\frac12e^{-x}\\cos x$", "$\\frac12e^{-x}\\sin x\\tan x$"],
              ["W2.3", "$e^x\\log(1+e^{-x})-e^{-x}\\log(1+e^x)-1$", "none ($-1$ is not in the CF)", "unchanged"]]},
]

SYMBOLS = [
    {"sym": "$X$", "name": "Right-hand side", "meaning": "Function of $x$ on the right of the standard form $y''+py'+qy=X$ (capital)", "where": "E1.1, E1.3"},
    {"sym": "$p$, $q$", "name": "Coefficients", "meaning": "Constants of $y'$, $y$ after dividing by the coefficient of $y''$", "where": "E1.1"},
    {"sym": "$y_1$, $y_2$", "name": "CF solutions", "meaning": "Linearly independent solutions of the homogeneous equation; $y_c=c_1y_1+c_2y_2$", "where": "E1.1, E1.2"},
    {"sym": "$W$", "name": "Wronskian", "meaning": "$y_1y_2'-y_2y_1'$; never zero here", "where": "E1.2, E3.1, E4.1"},
    {"sym": "$u$, $v$", "name": "Varying parameters", "meaning": "$u=-\\int\\frac{y_2X}{W}dx$, $v=\\int\\frac{y_1X}{W}dx$; functions of $x$ (some books: $A$, $B$)", "where": "E1.3"},
    {"sym": "$y_c$, $y_p$", "name": "CF and PI", "meaning": "Complementary function and particular integral; $y=y_c+y_p$", "where": "E1.4"},
    {"sym": "$c_1$, $c_2$", "name": "Arbitrary constants", "meaning": "In the CF only; absorb constant multiples of $y_1$, $y_2$", "where": "E1.4"},
    {"sym": "$\\alpha\\pm i\\beta$", "name": "Complex AE roots", "meaning": "$y_1=e^{\\alpha x}\\cos\\beta x$, $y_2=e^{\\alpha x}\\sin\\beta x$", "where": "E3.1"},
    {"sym": "$m$", "name": "AE root", "meaning": "Repeated root in Topic 4 ($y_2=xe^{mx}$)", "where": "E4.1, E4.2"},
    {"sym": "$g(x)$", "name": "Reduced right-hand side", "meaning": "$X=e^{\\alpha x}g$ or $e^{mx}g$; what is left after the exponentials cancel", "where": "E3.1, E4.1"},
    {"sym": "$z$, $D$", "name": "Cauchy variable", "meaning": "$z=\\log x$, $D=\\frac{d}{dz}$ in W2.4; elsewhere $D=\\frac{d}{dx}$ (clash)", "where": "W2.4"},
    {"sym": "$t$", "name": "Substitution variable", "meaning": "$t=1+e^{-x}$ or $t=\\cos x$ inside an integral (not time)", "where": "E2.1"},
    {"sym": "$\\log$", "name": "Natural logarithm", "meaning": "$\\log_e$; strictly $\\log|\\cdot|$ in $\\log\\cos ax$, $\\log\\sin x$, $\\log x$", "where": "E3.2, E4.2"},
]

KEYWORDS = [
    {"term": "Variation of parameters", "meaning": "Replace $c_1$, $c_2$ by functions $u(x)$, $v(x)$ to get the PI.", "topic": "T1"},
    {"term": "Complementary function", "meaning": "$c_1y_1+c_2y_2$; needed first.", "topic": "T1"},
    {"term": "Wronskian", "meaning": "$W=y_1y_2'-y_2y_1'\\neq0$.", "topic": "T1"},
    {"term": "Linear independence", "meaning": "$c_1y_1+c_2y_2\\equiv0\\Rightarrow c_1=c_2=0$; $W\\neq0$.", "topic": "T1"},
    {"term": "$u$", "meaning": "$-\\int\\frac{y_2X}{W}dx$.", "topic": "T1"},
    {"term": "$v$", "meaning": "$\\int\\frac{y_1X}{W}dx$.", "topic": "T1"},
    {"term": "Particular integral", "meaning": "$y_p=uy_1+vy_2$.", "topic": "T1"},
    {"term": "Standard form", "meaning": "Coefficient of $y''$ equal to 1.", "topic": "T1"},
    {"term": "Absorbing", "meaning": "Dropping multiples of $y_1$, $y_2$ from $y_p$ into $c_1$, $c_2$.", "topic": "T1"},
    {"term": "Cramer's rule", "meaning": "Solves $u'y_1+v'y_2=0$, $u'y_1'+v'y_2'=X$.", "topic": "T1"},
    {"term": "Integration by parts", "meaning": "$\\int xe^{-4x}dx$ in slide 011V·9.", "topic": "T2"},
    {"term": "$\\int\\sec$", "meaning": "$\\log(\\sec x+\\tan x)$.", "topic": "T2"},
    {"term": "Partial fractions", "meaning": "$\\frac{1}{e^x(1+e^x)}=\\frac{1}{e^x}-\\frac{1}{1+e^x}$.", "topic": "T2"},
    {"term": "Cauchy's equation", "meaning": "$x^2y''+\\dots$: CF via $x=e^z$, then VoP in $z$.", "topic": "T2"},
    {"term": "Complex roots", "meaning": "$\\alpha\\pm i\\beta$: $W=\\beta e^{2\\alpha x}$.", "topic": "T3"},
    {"term": "$\\int\\tan$, $\\int\\cot$", "meaning": "$\\log\\sec x$, $\\log\\sin x$.", "topic": "T3"},
    {"term": "$e^x\\tan x$", "meaning": "ESA Jan-24 s1 3a: $y_p=-e^x\\cos x\\log(\\sec x+\\tan x)$.", "topic": "T3"},
    {"term": "$e^{-x}\\sec^3x$", "meaning": "ESA Jan-24 s2 3a: $y_p=\\frac12e^{-x}\\sin x\\tan x$.", "topic": "T3"},
    {"term": "Repeated root", "meaning": "$y_2=xe^{mx}$, $W=e^{2mx}$.", "topic": "T4"},
    {"term": "$\\frac{e^{mx}}{x}$", "meaning": "ESA ×3: $y_p=xe^{mx}\\log x$.", "topic": "T4"},
]

RAPID = [
    {"q": "What does variation of parameters find?", "a": "Only the PI; the CF must be known first."},
    {"q": "Standard form required?", "a": "$y''+py'+qy=X$: coefficient of $y''$ equal to 1."},
    {"q": "Wronskian?", "a": "$W=y_1y_2'-y_2y_1'$."},
    {"q": "$u$ and $v$?", "a": "$u=-\\int\\frac{y_2X}{W}dx$, $v=\\int\\frac{y_1X}{W}dx$."},
    {"q": "PI?", "a": "$y_p=uy_1+vy_2$."},
    {"q": "Why no constants of integration?", "a": "They would add $ky_1$, $ky_2$, already in the CF."},
    {"q": "Three steps?", "a": "CF ($y_1,y_2$) → Wronskian → $u$, $v$, PI."},
    {"q": "$W$ for $e^{3x}$, $e^{-x}$?", "a": "$-4e^{2x}$."},
    {"q": "$W$ for $\\cos2x$, $\\sin2x$?", "a": "$2$."},
    {"q": "PI of $(D^2+4)y=\\tan2x$?", "a": "$-\\frac14\\cos2x\\log(\\sec2x+\\tan2x)$ (slide box drops $\\cos2x$)."},
    {"q": "PI of $(D^2-1)y=\\frac{2}{1+e^x}$?", "a": "$e^x\\log(1+e^{-x})-e^{-x}\\log(1+e^x)-1$."},
    {"q": "$W$ for complex roots $\\alpha\\pm i\\beta$?", "a": "$\\beta e^{2\\alpha x}$."},
    {"q": "ESA: $(D^2-2D+2)y=e^x\\tan x$?", "a": "$y=e^x(c_1\\cos x+c_2\\sin x)-e^x\\cos x\\log(\\sec x+\\tan x)$."},
    {"q": "ESA: $y''+2y'+2y=e^{-x}\\sec^3x$?", "a": "$y=e^{-x}(c_1\\cos x+c_2\\sin x)+\\frac12e^{-x}\\sin x\\tan x$."},
    {"q": "ESA: $y''+6y'+9y=\\frac{e^{-3x}}{x}$?", "a": "$y=(c_1+c_2x)e^{-3x}+xe^{-3x}\\log x$."},
    {"q": "ESA: $y''-2y'+y=\\frac{e^x}{x}$?", "a": "$y=(c_1+c_2x)e^x+xe^x\\log x$."},
    {"q": "CW P27 first step?", "a": "Divide by 2: $X=\\frac{25}{2}e^{-x}$."},
    {"q": "Cauchy $x^2y''-3xy'+3y=12x^4$ by VoP?", "a": "In $z=\\log x$: $W=-2e^{4z}$, $y=c_1x^3+c_2x+4x^4$."},
]

MNEMONICS = [
    "<i>“$u$ is minus, and takes the other one.”</i> $u=-\\int\\frac{y_2X}{W}$, $v=+\\int\\frac{y_1X}{W}$: each parameter integrates the <i>other</i> solution (study aid).",
]

TOP_FACTS = [
    "VoP gives the PI only; find the CF first; make the coefficient of $y''$ equal to 1.",
    "$W=y_1y_2'-y_2y_1'$; $u=-\\int\\frac{y_2X}{W}dx$, $v=\\int\\frac{y_1X}{W}dx$, no constants; $y_p=uy_1+vy_2$; $y=y_c+y_p$.",
    "Complex roots $\\alpha\\pm i\\beta$: $W=\\beta e^{2\\alpha x}$; repeated root $m$: $W=e^{2mx}$.",
    "ESA ×3: $(D-m)^2y=\\frac{e^{mx}}{x}$ → $y=(c_1+c_2x)e^{mx}+xe^{mx}\\log x$ (absorb $-xe^{mx}$).",
    "ESA: $e^x\\tan x$ over $D^2-2D+2$ → $-e^x\\cos x\\log(\\sec x+\\tan x)$; $e^{-x}\\sec^3x$ over $D^2+2D+2$ → $\\frac12e^{-x}\\sin x\\tan x$.",
    "$\\tan2x$ over $D^2+4$ → $-\\frac14\\cos2x\\log(\\sec2x+\\tan2x)$ (the slide's box drops $\\cos2x$).",
    "Integrals: $\\int\\tan=\\log\\sec$, $\\int\\cot=\\log\\sin$, $\\int\\sec=\\log(\\sec+\\tan)$, $\\frac{\\sin^2}{\\cos}=\\sec-\\cos$.",
]
TOP_FORMULAS = ["E1.2", "E1.3", "E1.4", "E3.1", "E4.2"]
