"""Unit 2, class 009 (deck SESSION 7): particular integral when X is any other form."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "The general method: linear factors, partial fractions and $\\frac{1}{D-m}X$",
     "overview": r"When the right-hand side $X$ is not $e^{ax}$, $\sin(ax+b)$ or $\cos(ax+b)$, a polynomial $x^m$, or $e^{ax}V$, none of the "
                 r"shortcut rules applies. Then $f(D)$ is resolved into linear factors $(D-m_1)\cdots(D-m_n)$, $\frac{1}{f(D)}$ is split into "
                 r"partial fractions $\sum\frac{A_k}{D-m_k}$, and each term is evaluated by the standard result "
                 r"$\frac{1}{D-m}X=e^{mx}\int Xe^{-mx}\,dx$. The CF is found exactly as before. With $m=0$ the result is plain integration, "
                 r"so $\frac{1}{D^2}\ln x$ is $\ln x$ integrated twice (slides 009·8–9)."},
    {"id": "T2", "title": "Complex linear factors: $(D^2+a^2)y=\\tan ax$",
     "overview": r"For $D^2+a^2=(D+ia)(D-ia)$ the partial fractions have complex coefficients, $\frac{1}{2ia}\big[\frac{1}{D-ia}-\frac{1}{D+ia}\big]$. "
                 r"Each term is an integral of $\tan ax\,e^{\mp iax}$, which Euler's formula $e^{\mp iax}=\cos ax\mp i\sin ax$ turns into "
                 r"elementary integrals; the second term follows from the first by changing $i$ to $-i$. The imaginary parts cancel and the PI is "
                 r"real: $-\frac{1}{a^2}\cos ax\log(\sec ax+\tan ax)$. The same equation can also be solved by variation of parameters (class 011)."},
    {"id": "T3", "title": "Right-hand sides in $e^x$: the substitution $t=e^x$",
     "overview": r"When $X$ is a function of $e^x$ ($e^{e^x}$, $\sin(e^x)$, $e^{2x}\sin(e^x)$), each integral $e^{mx}\int Xe^{-mx}\,dx$ becomes, "
                 r"with $t=e^x$, $dt=e^x\,dx$, an integral of a power of $t$ times $e^t$ or $\sin t$, done by parts (or Bernoulli's rule). "
                 r"The one ESA question of this kind, Dec-23 3c, is $y''+3y'+2y=e^{e^x}$, the same equation as slide 009·10: its PI is "
                 r"$e^{-2x}e^{e^x}$. Applying the factors one after another, in the right order, is a shorter route (added for clarity)."},
]

DEFS = [
    {"topic": "T1", "term": "“Any other form”", "text": "A right-hand side $X$ that is not one of the four standard forms: not $e^{ax}$, not "
     "$\\sin(ax+b)$ or $\\cos(ax+b)$, not a polynomial $x^m$, and not $e^{ax}V$. Examples: $\\tan ax$, $\\ln x$, $e^{e^x}$, $\\sin(e^x)$.",
     "srcs": ["S009·3", "T009 00:00:07", "T009 00:00:27", "T009b 00:00:32"]},
    {"topic": "T1", "term": "Linear factors of $f(D)$", "text": "$f(D)=(D-m_1)(D-m_2)\\cdots(D-m_n)$, where $m_1,\\dots,m_n$ are the roots of the "
     "auxiliary equation $f(m)=0$ (real or complex).", "srcs": ["S009·3", "T009 00:01:19"]},
    {"topic": "T1", "term": "Inverse operator $\\frac{1}{D-m}$", "text": "$\\frac{1}{D-m}X$ is the function $u$ with $(D-m)u=X$, i.e. $u'-mu=X$; "
     "it equals $e^{mx}\\int Xe^{-mx}\\,dx$ (no constant of integration: the constants are in the CF).",
     "srcs": ["S009·4", "T009 00:02:11", "T009b 00:03:01"]},
    {"topic": "T1", "term": "$\\frac{1}{D^k}$", "text": "$k$ successive integrations with respect to $x$ (the case $m=0$ of $\\frac{1}{D-m}$, applied $k$ times).",
     "srcs": ["S009·8", "T009 00:12:09"]},
    {"topic": "T3", "term": "Substitution $t=e^x$", "text": "$dt=e^x\\,dx$, so $e^{kx}\\,dx=t^{k-1}\\,dt$; it turns $\\int e^{kx}F(e^x)\\,dx$ into "
     "$\\int t^{k-1}F(t)\\,dt$.", "srcs": ["S009·11", "S009·12", "S009·15", "T009b 00:03:57"]},
    {"topic": "T3", "term": "Bernoulli's rule", "text": "Repeated integration by parts in one line: $\\int uv\\,dx=uv_1-u'v_2+u''v_3-\\cdots$, where "
     "$v_1,v_2,\\dots$ are successive integrals of $v$; used for $\\int t^3\\sin t\\,dt$, $\\int t^4\\sin t\\,dt$.",
     "srcs": ["T009b 00:08:37", "S009·16"]},
]

STATEMENTS = [
    {"topic": "T1", "text": "When $X$ is any other function of $x$. Rules for Finding the Particular Integral. Consider the differential equation, "
     "$(D^n+a_1D^{n-1}+a_2D^{n-2}+\\dots+a_{n-1}D+a_n)y=X$. It can be written as: $f(D)y=X$ $\\therefore$ P.I. $=\\frac{1}{f(D)}X$. Resolve $f(D)$ "
     "into linear factors. Let $f(D)=(D-m_1)(D-m_2)\\dots(D-m_n)$. Then, P.I. $=\\frac{1}{f(D)}X=\\frac{1}{(D-m_1)(D-m_2)\\dots(D-m_n)}X$.",
     "srcs": ["S009·3"]},
    {"topic": "T1", "text": "Use partial fractions: $P.I=\\Big(\\frac{A_1}{D-m_1}+\\frac{A_2}{D-m_2}+\\dots+\\frac{A_n}{D-m_n}\\Big)X$, "
     "$P.I=A_1\\frac{1}{D-m_1}X+A_2\\frac{1}{D-m_2}X+\\dots+A_n\\frac{1}{D-m_n}X$, "
     "$P.I=A_1e^{m_1x}\\int Xe^{-m_1x}dx+A_2e^{m_2x}\\int Xe^{-m_2x}dx+\\dots+A_ne^{m_nx}\\int Xe^{-m_nx}dx$.",
     "srcs": ["S009·4"]},
    {"topic": "T1", "text": "Standard formula (lecture): “one over $D$ minus $a$ of $f(x)$ … is nothing but $e^{ax}$ integral $e^{-ax}f(x)\\,dx$”.",
     "srcs": ["T009 00:02:11", "T009b 00:03:01"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "The standard result for one linear factor",
     "tex": r"\frac{1}{D-m}\,X=e^{mx}\int X\,e^{-mx}\,dx",
     "gives": "The PI contribution of one factor $D-m$.", "when": "Any $X$; $m$ real or complex.",
     "note": "Sign: $\\frac{1}{D+1}X=e^{-x}\\int Xe^{x}dx$ ($m=-1$). No constant of integration.", "stars": 2,
     "srcs": ["S009·4", "T009 00:02:11", "T009b 00:03:01", "T009b 00:03:36", "ESA Dec-23 3c"]},
    {"id": "E1.2", "topic": "T1", "title": "Why: a first-order linear equation", "tex": r"u=\frac{1}{D-m}X\iff u'-mu=X\iff\big(e^{-mx}u\big)'=Xe^{-mx}",
     "gives": "E1.1 by the integrating factor $e^{-mx}$.", "when": "Derivation; not on the slides.",
     "note": "Integrating and multiplying by $e^{mx}$ gives E1.1.", "stars": 1, "srcs": ["S009·4"], "flags": [ADD]},
    {"id": "E1.3", "topic": "T1", "title": "Partial fractions of $\\frac{1}{f(D)}$",
     "tex": r"\begin{gathered}\frac{1}{f(D)}=\frac{A_1}{D-m_1}+\dots+\frac{A_n}{D-m_n}\\ \text{P.I.}=A_1e^{m_1x}\!\int\! Xe^{-m_1x}dx+\dots+A_ne^{m_nx}\!\int\! Xe^{-m_nx}dx\end{gathered}",
     "gives": "The PI as a sum of $n$ single-factor terms.", "when": "Distinct roots $m_1,\\dots,m_n$.",
     "note": "Cover-up: $A_k=\\frac{1}{f'(m_k)}$; e.g. $\\frac{1}{(D+1)(D+2)}=\\frac{1}{D+1}-\\frac{1}{D+2}$.", "stars": 2,
     "srcs": ["S009·4", "S009·10", "S009·12", "S009·14", "T009 00:01:32", "T009 00:01:52"]},
    {"id": "E1.4", "topic": "T1", "title": "Successive application (no partial fractions)",
     "tex": r"\frac{1}{(D-m_1)(D-m_2)}X=\frac{1}{D-m_1}\Big[\frac{1}{D-m_2}X\Big]=\frac{1}{D-m_1}\Big[e^{m_2x}\!\int\! Xe^{-m_2x}dx\Big]",
     "gives": "The same PI by two single-factor steps, inner factor first.", "when": "Also with repeated roots ($(D-m)^2$), where partial fractions need an extra term.",
     "note": "The factors commute; choose the order that makes the integrals easy (W3.1, W3.2).", "stars": 2,
     "srcs": ["S009·3", "S009·10", "ESA Dec-23 3c"], "flags": [ADD]},
    {"id": "E1.5", "topic": "T1", "title": "$m=0$: integrate", "tex": r"\frac{1}{D}X=\int X\,dx,\qquad \frac{1}{D^2}X=\iint X\,dx\,dx",
     "gives": "The PI when $f(D)=D^k$.", "when": "$y''=X$, $y'''=X$, …", "note": "$\\iint\\ln x\\,dx\\,dx=\\frac{x^2\\ln x}{2}-\\frac{3x^2}{4}$ (slide 009·9).",
     "stars": 1, "srcs": ["S009·8", "S009·9", "T009 00:12:09"]},
    {"id": "E1.6", "topic": "T1", "title": "Integrals of $\\ln x$", "tex": r"\int\ln x\,dx=x\ln x-x,\qquad \int x\ln x\,dx=\frac{x^2}{2}\ln x-\frac{x^2}{4}",
     "gives": "The two integrations of slide 009·9.", "when": "By parts with $u=\\ln x$.", "note": "Write $\\ln x=\\ln x\\cdot1$ for the first one.",
     "stars": 1, "srcs": ["S009·9", "T009 00:12:37"]},
    {"id": "E2.1", "topic": "T2", "title": "Complex factors of $D^2+a^2$",
     "tex": r"\frac{1}{D^2+a^2}=\frac{1}{(D+ia)(D-ia)}=\frac{1}{2ia}\left[\frac{1}{D-ia}-\frac{1}{D+ia}\right]",
     "gives": "The partial fractions for complex AE roots $\\pm ia$.", "when": "CF $c_1\\cos ax+c_2\\sin ax$.",
     "note": "$A=\\frac{1}{2ia}$, $B=-\\frac{1}{2ia}$ (T009 00:05:02).", "stars": 2, "srcs": ["S009·5", "S009·6", "T009 00:04:31"]},
    {"id": "E2.2", "topic": "T2", "title": "Euler's formula", "tex": r"e^{\pm iax}=\cos ax\pm i\sin ax",
     "gives": "$e^{-iax}\\tan ax=\\sin ax-i\\frac{\\sin^2ax}{\\cos ax}$, and $e^{iax}(\\cos ax-i\\sin ax)=1$.", "when": "Inside $\\int\\tan ax\\,e^{\\mp iax}dx$.",
     "note": "$\\frac{\\sin^2ax}{\\cos ax}=\\sec ax-\\cos ax$.", "stars": 1, "srcs": ["S009·6", "T009 00:05:33", "T009 00:07:03"]},
    {"id": "E2.3", "topic": "T2", "title": "Integrals used", "tex": r"\int\sin ax\,dx=-\frac{\cos ax}{a},\qquad \int\sec ax\,dx=\frac{1}{a}\log(\sec ax+\tan ax)",
     "gives": "The two pieces of $\\int\\tan ax\\,e^{-iax}dx$.", "when": "Slide 009·6.", "note": "Also $\\int\\cos ax\\,dx=\\frac{\\sin ax}{a}$.",
     "stars": 1, "srcs": ["S009·6", "T009 00:07:38"]},
    {"id": "E2.4", "topic": "T2", "title": "One factor on $\\tan ax$",
     "tex": r"\frac{1}{D\mp ia}\tan ax=-\frac{1}{a}\Big[1\pm i\,e^{\pm iax}\log(\sec ax+\tan ax)\Big]",
     "gives": "The two partial results (upper signs: slide 009·6; lower signs: 009·7 by $i\\to-i$).", "when": "$(D^2+a^2)y=\\tan ax$.",
     "note": "Changing $i$ to $-i$ gives the second from the first.", "stars": 2, "srcs": ["S009·6", "S009·7", "T009 00:08:41", "T009 00:08:58"]},
    {"id": "E2.5", "topic": "T2", "title": "Result: PI of $\\tan ax$", "tex": r"\frac{1}{D^2+a^2}\tan ax=-\frac{1}{a^2}\cos ax\,\log(\sec ax+\tan ax)",
     "gives": "The PI; with the CF, $y=c_1\\cos ax+c_2\\sin ax-\\frac{1}{a^2}\\cos ax\\log(\\sec ax+\\tan ax)$.", "when": "Any $a\\neq0$.",
     "note": "$a=2$ gives CW P28's answer (asked there by variation of parameters).", "stars": 2,
     "srcs": ["S009·7", "T009 00:11:09", "CW U2 P28"]},
    {"id": "E3.1", "topic": "T3", "title": "The substitution $t=e^x$",
     "tex": r"e^{-mx}\!\!\int e^{kx}F(e^x)\,dx=e^{-mx}\!\!\int t^{k-1}F(t)\,dt,\qquad t=e^x,\ dt=e^x dx",
     "gives": "Integrals of powers of $e^x$ times a function of $e^x$.", "when": "$X=e^{e^x}$, $\\sin(e^x)$, $e^{2x}\\sin(e^x)$, …",
     "note": "Write $e^{kx}dx=e^{(k-1)x}\\cdot e^xdx=t^{k-1}dt$; substitute back $t=e^x$ at the end.", "stars": 2,
     "srcs": ["S009·11", "S009·12", "S009·13", "S009·15", "T009 00:14:05", "T009b 00:03:57", "ESA Dec-23 3c"]},
    {"id": "E3.2", "topic": "T3", "title": "Integrals in $t$", "tex": r"\begin{gathered}\int te^t\,dt=(t-1)e^t,\qquad \int t\sin t\,dt=-t\cos t+\sin t\\ \int t^3\sin t\,dt=-t^3\cos t+3t^2\sin t+6t\cos t-6\sin t\end{gathered}",
     "gives": "The by-parts results used on slides 009·11, 009·13, 009·16.", "when": "After $t=e^x$.",
     "note": "$\\int t^4\\sin t\\,dt=-t^4\\cos t+4t^3\\sin t+12t^2\\cos t-24t\\sin t-24\\cos t$.", "stars": 2,
     "srcs": ["S009·11", "S009·13", "S009·16", "T009 00:14:43", "T009b 00:05:16", "T009b 00:08:37"]},
    {"id": "E3.3", "topic": "T3", "title": "ESA Dec-23 3c: PI of $e^{e^x}$", "tex": r"\frac{1}{D^2+3D+2}\,e^{e^x}=e^{-2x}e^{e^x}",
     "gives": "The PI; $y=c_1e^{-x}+c_2e^{-2x}+e^{-2x}e^{e^x}$.", "when": "$y''+3y'+2y=e^{e^x}$.",
     "note": "Same as slide 009·10–11; checked by substitution (sympy).", "stars": 2, "srcs": ["S009·10", "S009·11", "ESA Dec-23 3c"]},
]

POINTS = [
    {"topic": "T1", "text": "First check the four standard forms ($e^{ax}$; $\\sin$/$\\cos(ax+b)$; $x^m$; $e^{ax}V$). Only if $X$ is none of them "
     "($\\tan ax$, $\\ln x$, $e^{e^x}$, $\\sin(e^x)$) use this method.", "stars": 2,
     "srcs": ["T009 00:00:27", "T009 00:03:13", "T009b 00:00:32", "T009b 00:01:25"]},
    {"topic": "T1", "text": "“There's no change in computing the complementary function”: AE, roots, CF exactly as in class 002.", "stars": 2,
     "srcs": ["T009 00:03:33", "S009·5"]},
    {"topic": "T1", "text": "Procedure: factorise $f(D)$ into linear factors → partial fractions $\\sum\\frac{A_k}{D-m_k}$ → "
     "$\\frac{1}{D-m}X=e^{mx}\\int Xe^{-mx}dx$ for each term → add (Figure F1.1).", "stars": 2,
     "srcs": ["S009·3", "S009·4", "T009 00:01:19", "T009 00:01:52", "T009 00:02:11"]},
    {"topic": "T1", "text": "Watch the sign: $\\frac{1}{D+2}X=e^{-2x}\\int Xe^{2x}dx$ ($m=-2$): the outside exponential has the AE root, the inside one its negative.",
     "stars": 2, "srcs": ["T009b 00:03:36", "S009·11", "S009·12"]},
    {"topic": "T1", "text": "No constants of integration in a PI: the arbitrary constants are already in the CF.", "stars": 2,
     "srcs": ["S009·9", "S009·11"], "flags": [ADD]},
    {"topic": "T1", "text": "With $m=0$ ($f(D)=D^2$), $\\frac{1}{D^2}$ means “integrate twice”: $\\frac{1}{D^2}\\ln x=\\frac{x^2\\ln x}{2}-\\frac{3x^2}{4}$.",
     "stars": 1, "srcs": ["S009·8", "S009·9", "T009 00:12:09"]},
    {"topic": "T1", "text": "Shortcut (not on the slides): apply the factors one after another, $\\frac{1}{D-m_1}\\big[\\frac{1}{D-m_2}X\\big]$; this "
     "avoids partial fractions and also works for repeated factors.", "stars": 2, "srcs": ["S009·3", "ESA Dec-23 3c"], "flags": [ADD]},
    {"topic": "T2", "text": "$D^2+a^2=(D+ia)(D-ia)$, so $\\frac{1}{D^2+a^2}=\\frac{1}{2ia}\\big[\\frac{1}{D-ia}-\\frac{1}{D+ia}\\big]$.", "stars": 2,
     "srcs": ["S009·5", "S009·6", "T009 00:04:31"]},
    {"topic": "T2", "text": "Compute $\\frac{1}{D-ia}\\tan ax$ once; get $\\frac{1}{D+ia}\\tan ax$ by changing $i$ to $-i$ (“we simply replace $i$ by $-i$”).",
     "stars": 2, "srcs": ["S009·7", "T009 00:08:58"]},
    {"topic": "T2", "text": "The imaginary parts must cancel: the PI of a real equation is real ($e^{iax}+e^{-iax}=2\\cos ax$ at the end).", "stars": 2,
     "srcs": ["S009·7", "T009 00:10:30", "T009 00:10:48"]},
    {"topic": "T2", "text": "Result to remember: $\\frac{1}{D^2+a^2}\\tan ax=-\\frac{1}{a^2}\\cos ax\\log(\\sec ax+\\tan ax)$.", "stars": 2,
     "srcs": ["S009·7", "T009 00:11:09"]},
    {"topic": "T2", "text": "$\\tan ax$, $\\sec ax$, $\\csc ax$ right-hand sides can equally be solved by variation of parameters (class 011); "
     "the CW sheet asks them that way (P23, P26, P28). Read the question: “by the method of variation of parameters” forces that method.",
     "stars": 2, "srcs": ["CW U2 P23", "CW U2 P26", "CW U2 P28"], "flags": [ADD]},
    {"topic": "T3", "text": "For $X$ built from $e^x$, substitute $t=e^x$, $dt=e^xdx$ in each integral: $e^{kx}dx=t^{k-1}dt$.", "stars": 2,
     "srcs": ["S009·11", "S009·12", "S009·15", "T009 00:14:05", "T009b 00:03:57"]},
    {"topic": "T3", "text": "Split the exponential to make $e^xdx$ visible: $e^{2x}=e^x\\cdot e^x$, $e^{4x}=e^{3x}\\cdot e^x$ (“let us split $e^{2x}$ to be "
     "$e^x$ times $e^x$”).", "stars": 2, "srcs": ["T009 00:14:22", "T009b 00:04:57", "T009b 00:08:00"]},
    {"topic": "T3", "text": "ESA Dec-23 3c ($y''+3y'+2y=e^{e^x}$, 7 marks) is the slide 009·10 problem: PI $=e^{-2x}e^{e^x}$; write the full $y$.",
     "stars": 2, "srcs": ["ESA Dec-23 3c", "S009·10", "S009·11"]},
    {"topic": "T3", "text": "Always simplify after substituting back: in $\\frac{1}{(D+1)(D+2)}\\sin(e^x)$ the terms $-e^{-x}\\cos(e^x)$ cancel, leaving "
     "$-e^{-2x}\\sin(e^x)$.", "stars": 2, "srcs": ["S009·13", "T009b 00:06:04"]},
    {"topic": "T3", "text": "Choosing the order $\\frac{1}{D+2}\\big[\\frac{1}{D+1}X\\big]$ for $e^{e^x}$ and $\\sin(e^x)$ needs only $\\int e^t dt$ and "
     "$\\int\\cos t\\,dt$: two lines each (W3.1, W3.2).", "stars": 2, "srcs": ["S009·10", "S009·12", "ESA Dec-23 3c"], "flags": [ADD]},
]

WHY = [
    {"topic": "T1", "q": "Why does $\\frac{1}{D-m}X$ equal $e^{mx}\\int Xe^{-mx}dx$?",
     "a": "$u=\\frac{1}{D-m}X$ means $u'-mu=X$, a first-order linear equation. Multiplying by the integrating factor $e^{-mx}$ gives "
          "$(ue^{-mx})'=Xe^{-mx}$; integrating and multiplying by $e^{mx}$ gives the formula.", "srcs": ["S009·4"], "flags": [ADD]},
    {"topic": "T1", "q": "Why do the shortcut rules of Types 1–5 fail for $\\tan ax$ or $e^{e^x}$?",
     "a": "Those rules work because $D$ maps $e^{ax}$, $\\sin ax$, $x^m$ into the same family. The derivatives of $\\tan ax$ or $e^{e^x}$ are "
          "new functions every time, so no substitution $D\\to a$ or $D^2\\to-a^2$ exists; the integral formula always works.",
     "srcs": ["T009 00:00:27", "T009 00:03:13"], "flags": [ADD]},
    {"topic": "T2", "q": "Why is the PI real although the computation is complex?",
     "a": "The equation has real coefficients and a real right-hand side. The two partial results are complex conjugates, so "
          "$\\frac{1}{2ia}(P_1-\\bar P_1)=\\frac{1}{a}\\text{Im}\\,P_1$ is real.", "srcs": ["S009·7", "T009 00:10:30"], "flags": [ADD]},
    {"topic": "T3", "q": "Why does the order of successive factors matter for $e^{e^x}$?",
     "a": "$\\frac{1}{D+1}e^{e^x}=e^{-x}e^{e^x}$ is easy, and then $\\frac{1}{D+2}$ needs $\\int e^{2x}e^{-x}e^{e^x}dx=\\int e^xe^{e^x}dx=e^{e^x}$. The other "
          "order leaves $\\int(1-e^{-x})e^{e^x}dx$, which needs spotting a derivative.", "srcs": ["S009·10", "ESA Dec-23 3c"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T3", "text": "Slide 009·16 (and 009·17) writes the first term of (1) as $-e^{-x}\\cos(e^x)$; it is $e^{-2x}\\cdot(-e^{3x}\\cos(e^x))=-e^{x}\\cos(e^x)$. "
     "The boxed answer is right only because the correct $-e^{x}\\cos(e^x)$ cancels with (2).", "srcs": ["S009·16", "S009·17"], "flags": [ADD]},
    {"topic": "T1", "text": "Do not write $\\frac{1}{D+1}X=e^{x}\\int Xe^{-x}dx$: for $D+1=D-(-1)$, $m=-1$, so it is $e^{-x}\\int Xe^{x}dx$.",
     "srcs": ["T009b 00:03:36", "S009·12"], "flags": [ADD]},
    {"topic": "T1", "text": "Partial fractions with the wrong sign: $\\frac{1}{(D+1)(D+2)}=\\frac{1}{D+1}-\\frac{1}{D+2}$ ($A=1$ at $D=-1$, $B=-1$ at $D=-2$). "
     "Slide 009·10 lists the fractions as $\\frac{A}{D+2}+\\frac{B}{D+1}$, so there $A=-1$, $B=1$ — the same split.", "srcs": ["S009·10", "S009·12"]},
    {"topic": "T1", "text": "Do not forget the CF: “solve” means $y=y_c+y_p$ (slides 009·10–17 stop at the PI; the ESA question asks to solve).",
     "srcs": ["ESA Dec-23 3c", "S009·11"], "flags": [ADD]},
    {"topic": "T2", "text": "Do not integrate $\\frac{\\sin^2ax}{\\cos ax}$ in one go: write it as $\\sec ax-\\cos ax$ first, then $\\int\\sec ax\\,dx=\\frac1a\\log(\\sec ax+\\tan ax)$.",
     "srcs": ["S009·6", "T009 00:06:46"], "flags": [ADD]},
    {"topic": "T2", "text": "The PI has $\\frac{1}{a^2}$, not $\\frac1a$: one $\\frac1a$ from the integration and one from $\\frac{1}{2ia}$.",
     "srcs": ["S009·7"], "flags": [ADD]},
    {"topic": "T3", "text": "After $t=e^x$, also convert the $dx$: $e^{2x}e^{e^x}dx=te^t\\,dt$, not $t^2e^t\\,dt$ (one $e^x$ goes into $dt$).",
     "srcs": ["S009·11", "T009 00:14:22"], "flags": [ADD]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "$\\frac{d^2y}{dx^2}=\\ln x$ (slides 009·8–9)", "stars": 1,
     "srcs": ["S009·8", "S009·9", "T009 00:11:30", "T009 00:12:55"],
     "given": "Solve $\\frac{d^2y}{dx^2}=\\ln x$, i.e. $D^2y=\\ln x$.",
     "steps": ["AE $m^2=0$: $m=0,0$. CF $=c_1+c_2x$.",
               "PI $=\\frac{1}{D^2}\\ln x=\\iint\\ln x\\,dx\\,dx$ ($\\frac{1}{D-m}$ with $m=0$, twice).",
               "First: $\\int\\ln x\\cdot1\\,dx=x\\ln x-\\int x\\cdot\\frac1x\\,dx=x\\ln x-x$.",
               "Second: $\\int(x\\ln x-x)\\,dx=\\frac{x^2}{2}\\ln x-\\frac12\\int x\\,dx-\\int x\\,dx=\\frac{x^2}{2}\\ln x-\\frac{x^2}{4}-\\frac{x^2}{2}$."],
     "answer": "$y=c_1+c_2x+\\dfrac{x^2\\ln x}{2}-\\dfrac{3x^2}{4}$",
     "check": "Slide answer agrees; sympy dsolve gives the same, and $\\frac{d^2}{dx^2}\\big(\\frac{x^2\\ln x}{2}-\\frac{3x^2}{4}\\big)=\\ln x$. Figure G1.1."},
    {"id": "W2.1", "topic": "T2", "title": "$(D^2+a^2)y=\\tan ax$ (slides 009·5–7)", "stars": 2,
     "srcs": ["S009·5", "S009·6", "S009·7", "T009 00:03:13", "T009 00:11:09"],
     "given": "Solve $(D^2+a^2)y=\\tan ax$.",
     "steps": ["AE $m^2+a^2=0$: $m=\\pm ia$ ($\\alpha=0$, $\\beta=a$). CF $=c_1\\cos ax+c_2\\sin ax$.",
               "PI $=\\frac{1}{(D+ia)(D-ia)}\\tan ax=\\frac{1}{2ia}\\Big[\\frac{1}{D-ia}-\\frac{1}{D+ia}\\Big]\\tan ax$.",
               "$\\frac{1}{D-ia}\\tan ax=e^{iax}\\int\\tan ax\\,(\\cos ax-i\\sin ax)\\,dx=e^{iax}\\int\\Big(\\sin ax-i\\frac{\\sin^2ax}{\\cos ax}\\Big)dx$.",
               "$\\frac{\\sin^2ax}{\\cos ax}=\\sec ax-\\cos ax$: the integral is $-\\frac{\\cos ax}{a}-\\frac ia\\log(\\sec ax+\\tan ax)+\\frac ia\\sin ax$ "
               "$=-\\frac1a\\big[(\\cos ax-i\\sin ax)+i\\log(\\sec ax+\\tan ax)\\big]$.",
               "Times $e^{iax}$ ($e^{iax}(\\cos ax-i\\sin ax)=1$): $\\frac{1}{D-ia}\\tan ax=-\\frac1a\\big[1+ie^{iax}\\log(\\sec ax+\\tan ax)\\big]$.",
               "$i\\to-i$: $\\frac{1}{D+ia}\\tan ax=-\\frac1a\\big[1-ie^{-iax}\\log(\\sec ax+\\tan ax)\\big]$.",
               "PI $=\\frac{1}{2ia}\\cdot\\Big(-\\frac ia\\Big)(e^{iax}+e^{-iax})\\log(\\sec ax+\\tan ax)=-\\frac{1}{a^2}\\cos ax\\log(\\sec ax+\\tan ax)$."],
     "answer": "$y=c_1\\cos ax+c_2\\sin ax-\\dfrac{1}{a^2}\\cos ax\\,\\log(\\sec ax+\\tan ax)$",
     "check": "Slide answer agrees; sympy: $(D^2+a^2)$ of the PI minus $\\tan ax$ simplifies to 0 (symbolic $a$), and both partial results satisfy "
              "$u'\\mp iau=\\tan ax$ numerically at $a=2$, $x=0.1,0.3$. Figure G2.1. By variation of parameters: class 011 pack."},
    {"id": "W3.1", "topic": "T3", "title": "$y''+3y'+2y=e^{e^x}$ (ESA Dec-23 3c; slides 009·10–11)", "stars": 2,
     "srcs": ["ESA Dec-23 3c", "S009·10", "S009·11", "T009 00:13:23", "T009 00:14:43"],
     "given": "Solve $\\frac{d^2y}{dx^2}+3\\frac{dy}{dx}+2y=e^{e^x}$, i.e. $(D^2+3D+2)y=e^{e^x}$ (7 marks).",
     "steps": ["AE $m^2+3m+2=0$: $(m+1)(m+2)=0$, $m=-1,-2$. CF $=c_1e^{-x}+c_2e^{-2x}$.",
               "$e^{e^x}$ is none of the standard forms. PI $=\\frac{1}{(D+1)(D+2)}e^{e^x}=\\Big[\\frac{1}{D+1}-\\frac{1}{D+2}\\Big]e^{e^x}$.",
               "$\\frac{1}{D+1}e^{e^x}=e^{-x}\\int e^xe^{e^x}dx$; $t=e^x$, $dt=e^xdx$: $e^{-x}\\int e^tdt=e^{-x}e^{e^x}$.",
               "$\\frac{1}{D+2}e^{e^x}=e^{-2x}\\int e^{2x}e^{e^x}dx=e^{-2x}\\int te^tdt=e^{-2x}(t-1)e^t=e^{-2x}(e^x-1)e^{e^x}$.",
               "PI $=e^{-x}e^{e^x}-e^{-x}e^{e^x}+e^{-2x}e^{e^x}=e^{-2x}e^{e^x}$.",
               "Shortcut (E1.4): $\\frac{1}{D+2}\\big[\\frac{1}{D+1}e^{e^x}\\big]=\\frac{1}{D+2}\\big[e^{-x}e^{e^x}\\big]=e^{-2x}\\int e^{x}e^{e^x}dx=e^{-2x}e^{e^x}$."],
     "answer": "$y=c_1e^{-x}+c_2e^{-2x}+e^{-2x}e^{e^x}$",
     "check": "Slide 009·11's PI agrees; sympy dsolve gives $y=(c_1+(c_2+e^{e^x})e^{-x})e^{-x}$, the same, and checkodesol returns 0. Figure G3.1, Figure F3.1."},
    {"id": "W3.2", "topic": "T3", "title": "$(D+1)(D+2)y=\\sin(e^x)$ (slides 009·12–13)", "stars": 2,
     "srcs": ["S009·12", "S009·13", "T009b 00:01:25", "T009b 00:06:24"],
     "given": "Find the particular integral of $(D+1)(D+2)y=\\sin(e^x)$.",
     "steps": ["(CF, for the general solution: $c_1e^{-x}+c_2e^{-2x}$.)",
               "$y_p=\\Big[\\frac{1}{D+1}-\\frac{1}{D+2}\\Big]\\sin(e^x)$.",
               "$\\frac{1}{D+1}\\sin(e^x)=e^{-x}\\int e^x\\sin(e^x)dx=e^{-x}\\int\\sin t\\,dt=-e^{-x}\\cos(e^x)$.",
               "$\\frac{1}{D+2}\\sin(e^x)=e^{-2x}\\int t\\sin t\\,dt=e^{-2x}(-t\\cos t+\\sin t)=-e^{-x}\\cos(e^x)+e^{-2x}\\sin(e^x)$.",
               "$y_p=-e^{-x}\\cos(e^x)-\\big[-e^{-x}\\cos(e^x)+e^{-2x}\\sin(e^x)\\big]=-e^{-2x}\\sin(e^x)$.",
               "Shortcut: $\\frac{1}{D+2}\\big[-e^{-x}\\cos(e^x)\\big]=-e^{-2x}\\int e^x\\cos(e^x)dx=-e^{-2x}\\sin(e^x)$."],
     "answer": "$y_p=-e^{-2x}\\sin(e^x)$; $\\ y=c_1e^{-x}+c_2e^{-2x}-e^{-2x}\\sin(e^x)$",
     "check": "Slide answer agrees; sympy dsolve gives the same; substituting back leaves 0. Figure G3.2."},
    {"id": "W3.3", "topic": "T3", "title": "$(D^2+5D+6)y=e^{2x}\\sin(e^x)$ (slides 009·14–17)", "stars": 2,
     "srcs": ["S009·14", "S009·15", "S009·16", "S009·17", "T009b 00:06:50", "T009b 00:09:35"],
     "given": "Find the particular integral of $(D^2+5D+6)y=e^{2x}\\sin(e^x)$.",
     "steps": ["$(D+2)(D+3)$; CF $=c_1e^{-2x}+c_2e^{-3x}$. $y_p=\\Big[\\frac{1}{D+2}-\\frac{1}{D+3}\\Big]e^{2x}\\sin(e^x)$.",
               "$=e^{-2x}\\int e^{4x}\\sin(e^x)dx-e^{-3x}\\int e^{5x}\\sin(e^x)dx=e^{-2x}\\int t^3\\sin t\\,dt-e^{-3x}\\int t^4\\sin t\\,dt$.",
               "(1) $e^{-2x}[-t^3\\cos t+3t^2\\sin t+6t\\cos t-6\\sin t]=-e^{x}\\cos(e^x)+3\\sin(e^x)+6e^{-x}\\cos(e^x)-6e^{-2x}\\sin(e^x)$. "
               "<b>Slide 009·16 prints the first term as $-e^{-x}\\cos(e^x)$.</b>",
               "(2) $e^{-3x}[-t^4\\cos t+4t^3\\sin t+12t^2\\cos t-24t\\sin t-24\\cos t]$ $=-e^{x}\\cos(e^x)+4\\sin(e^x)+12e^{-x}\\cos(e^x)-24e^{-2x}\\sin(e^x)-24e^{-3x}\\cos(e^x)$.",
               "(1) $-$ (2): the $-e^x\\cos(e^x)$ terms cancel; $3-4=-1$, $6-12=-6$, $-6+24=18$, $0+24=24$."],
     "answer": "$y_p=-\\sin(e^x)-6e^{-x}\\cos(e^x)+18e^{-2x}\\sin(e^x)+24e^{-3x}\\cos(e^x)$",
     "check": "Slide's boxed answer agrees (despite the slip in line (1)); sympy: $\\int t^3\\sin t$, $\\int t^4\\sin t$ as above, (1)$-$(2) equals $y_p$, "
              "dsolve gives the same PI, and substituting back leaves 0."},
]

PYQS = [
    {"topic": "T3", "paper": "ESA Dec 2023", "q": "UE22MA141A Q3.c", "marks": 7,
     "text": "Solve $y''+3y'+2y=e^{e^x}$.", "worked": "W3.1"},
]

NOTES = [
    {"topic": "T1", "text": "When $X$ is not $e^{ax}$, $\\sin$/$\\cos(ax+b)$, $x^m$ or $e^{ax}V$: CF as usual; factorise $f(D)=(D-m_1)\\cdots(D-m_n)$; "
     "partial fractions $\\frac{1}{f(D)}=\\sum\\frac{A_k}{D-m_k}$; each term by $\\frac{1}{D-m}X=e^{mx}\\int Xe^{-mx}dx$ (no constants). Or apply the "
     "factors one after another. $m=0$: integrate. Example: $D^2y=\\ln x$: $y=c_1+c_2x+\\frac{x^2\\ln x}{2}-\\frac{3x^2}{4}$."},
    {"topic": "T2", "text": "$(D^2+a^2)y=\\tan ax$: $\\frac{1}{D^2+a^2}=\\frac{1}{2ia}\\big[\\frac{1}{D-ia}-\\frac{1}{D+ia}\\big]$; "
     "$\\frac{1}{D-ia}\\tan ax=e^{iax}\\int\\tan ax\\,e^{-iax}dx=-\\frac1a[1+ie^{iax}\\log(\\sec ax+\\tan ax)]$; $i\\to-i$ for the other. "
     "PI $=-\\frac{1}{a^2}\\cos ax\\log(\\sec ax+\\tan ax)$. $\\tan$, $\\sec$, $\\csc$ can also be done by variation of parameters (class 011)."},
    {"topic": "T3", "text": "$X$ in $e^x$: $t=e^x$, $e^{kx}dx=t^{k-1}dt$. ESA Dec-23 3c: $\\frac{e^{e^x}}{(D+1)(D+2)}=e^{-x}e^{e^x}-e^{-2x}(e^x-1)e^{e^x}"
     "=e^{-2x}e^{e^x}$, $y=c_1e^{-x}+c_2e^{-2x}+e^{-2x}e^{e^x}$. $\\frac{\\sin(e^x)}{(D+1)(D+2)}=-e^{-2x}\\sin(e^x)$. "
     "$\\frac{e^{2x}\\sin(e^x)}{(D+2)(D+3)}=-\\sin(e^x)-6e^{-x}\\cos(e^x)+18e^{-2x}\\sin(e^x)+24e^{-3x}\\cos(e^x)$."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "$\\frac{1}{D^2}\\ln x$: integrate twice", "stars": 1, "srcs": ["S009·8", "S009·9"], "flags": [ADD],
     "howto": "Green: the right-hand side $\\ln x$. Vermilion dashed: one integration, $\\frac1D\\ln x=x\\ln x-x$ (its slope is $\\ln x$). Blue: the "
              "second integration, the PI $\\frac{x^2\\ln x}{2}-\\frac{3x^2}{4}$, whose slope is the vermilion curve and whose curvature is the green one. "
              "Each curve has a turning point where the one below it crosses zero ($x=1$ for $x\\ln x-x$, $x=e$ for the PI)."},
    {"id": "G2.1", "topic": "T2", "title": "$(D^2+1)y=\\tan x$: the PI stays bounded where $\\tan x$ blows up", "stars": 2,
     "srcs": ["S009·5", "S009·7"], "flags": [ADD],
     "howto": "Slide 009·7 with $a=1$. Vermilion dashed: $X=\\tan x$, with asymptotes at $x=\\pm\\frac\\pi2$ (grey). Blue: the PI "
              "$-\\cos x\\ln(\\sec x+\\tan x)$; it is odd, like $\\tan x$, and tends to 0 at $x=\\pm\\frac\\pi2$ (where $\\cos x\\to0$ beats the logarithm) although $X$ is unbounded there."},
    {"id": "G3.1", "topic": "T3", "title": "ESA Dec-23 3c: $y_p=e^{-2x}e^{e^x}$ and general solutions", "stars": 2,
     "srcs": ["ESA Dec-23 3c", "S009·11"], "flags": [ADD],
     "howto": "Vermilion dashed: $X=e^{e^x}$. Blue: the PI $e^{-2x}e^{e^x}$; its minimum is where $(e^x-2x)'=e^x-2=0$, at $x=\\ln2$, value $\\frac{e^2}{4}$. "
              "Grey: two general solutions $c_1e^{-x}+c_2e^{-2x}+y_p$ ($c_1,c_2=2,-3$ and $-3,2$); the CF dies out for large $x$, so every solution "
              "approaches $y_p$ there; note $y_p=e^{-2x}X$ exactly."},
    {"id": "G3.2", "topic": "T3", "title": "$(D+1)(D+2)y=\\sin(e^x)$: a chirp in, a damped chirp out", "stars": 2,
     "srcs": ["S009·12", "S009·13"], "flags": [ADD],
     "howto": "Vermilion dashed: $X=\\sin(e^x)$, which oscillates faster and faster as $x$ grows. Blue: the PI $-e^{-2x}\\sin(e^x)$: the same zeros "
              "($e^x=k\\pi$) but an amplitude $e^{-2x}$ that dies away, because $f(D)$ amplifies fast oscillations ($D^2$ dominates), so their PI is small."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "PI when $X$ is any other form (slides 009·3–4)", "stars": 2,
     "srcs": ["S009·3", "S009·4", "T009 00:00:58", "T009 00:01:32", "T009 00:02:11"], "layout": "straight", "maxw": "140mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$f(D)y=X$, $X$ not a standard form", "sub": "$\\tan ax$, $\\ln x$, $e^{e^x}$, $\\sin(e^x)$, …"},
         {"kind": "step", "n": 1, "title": "CF as usual", "sub": "AE $f(m)=0$, roots $m_1,\\dots,m_n$"},
         {"kind": "step", "n": 2, "title": "Linear factors", "fx": "$f(D)=(D-m_1)\\cdots(D-m_n)$"},
         {"kind": "step", "n": 3, "title": "Partial fractions", "fx": "$\\frac{1}{f(D)}=\\frac{A_1}{D-m_1}+\\dots+\\frac{A_n}{D-m_n}$"},
         {"kind": "step", "n": 4, "title": "Each term", "fx": "$\\frac{1}{D-m_k}X=e^{m_kx}\\int Xe^{-m_kx}dx$"},
         {"kind": "result", "title": "PI $=\\sum A_k e^{m_kx}\\int Xe^{-m_kx}dx$", "fx": "$y=\\text{CF}+\\text{PI}$"}]},
     "remark": "No constants of integration in step 4; the CF already holds them.",
     "trap": "$\\frac{1}{D+2}$ has $m=-2$: outside $e^{-2x}$, inside $e^{+2x}$."},
    {"id": "F1.2", "topic": "T1", "title": "Partial fractions or one factor at a time?", "stars": 2,
     "srcs": ["S009·4", "S009·10", "ESA Dec-23 3c"], "flags": [ADD], "layout": "fork", "maxw": "150mm",
     "spec": {"before": [{"kind": "given", "title": "PI $=\\frac{1}{(D-m_1)(D-m_2)}X$"}],
              "question": "Does one order give easy integrals?",
              "no": {"kind": "step", "title": "Partial fractions (slides)", "fx": "$\\frac{1}{m_1-m_2}\\Big[\\frac{1}{D-m_1}-\\frac{1}{D-m_2}\\Big]X$"},
              "yes": {"kind": "step", "title": "Successive (E1.4)", "fx": "$\\frac{1}{D-m_1}\\Big[\\frac{1}{D-m_2}X\\Big]$"},
              "after": [{"kind": "result", "title": "Same PI either way", "fx": "$e^{e^x}$: $e^{-2x}e^{e^x}$"}]},
     "remark": "The slides always use partial fractions; the successive route is a check or a shortcut. For a repeated factor $(D-m)^2$ use the successive route."},
    {"id": "F2.1", "topic": "T2", "title": "Slides 009·5–7: $(D^2+a^2)y=\\tan ax$", "stars": 2,
     "srcs": ["S009·5", "S009·6", "S009·7", "T009 00:04:12", "T009 00:11:09"], "layout": "straight", "maxw": "150mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$\\frac{1}{(D+ia)(D-ia)}\\tan ax$", "sub": "CF $c_1\\cos ax+c_2\\sin ax$"},
         {"kind": "step", "n": 1, "title": "Partial fractions", "fx": "$\\frac{1}{2ia}\\big[\\frac{1}{D-ia}-\\frac{1}{D+ia}\\big]\\tan ax$"},
         {"kind": "step", "n": 2, "title": "E1.1 with $m=ia$ and Euler", "fx": "$e^{iax}\\int\\big(\\sin ax-i\\frac{\\sin^2ax}{\\cos ax}\\big)dx$"},
         {"kind": "step", "n": 3, "title": "Integrate, multiply by $e^{iax}$", "fx": "$-\\frac1a\\big[1+ie^{iax}\\log(\\sec ax+\\tan ax)\\big]$"},
         {"kind": "step", "n": 4, "title": "$i\\to-i$ for $\\frac{1}{D+ia}$", "fx": "$-\\frac1a\\big[1-ie^{-iax}\\log(\\sec ax+\\tan ax)\\big]$"},
         {"kind": "result", "title": "PI $=-\\frac{1}{a^2}\\cos ax\\log(\\sec ax+\\tan ax)$", "fx": "W2.1"}]},
     "remark": "The constants $-\\frac1a$ cancel and $e^{iax}+e^{-iax}=2\\cos ax$ makes the result real."},
    {"id": "F3.1", "topic": "T3", "title": "ESA Dec-23 3c: $y''+3y'+2y=e^{e^x}$", "stars": 2,
     "srcs": ["ESA Dec-23 3c", "S009·10", "S009·11"], "layout": "streams", "maxw": "165mm",
     "spec": {"left": [{"kind": "given", "title": "$\\frac{1}{D+1}e^{e^x}$", "sub": "$m=-1$"},
                       {"kind": "step", "n": 1, "title": "E1.1", "fx": "$e^{-x}\\int e^xe^{e^x}dx$"},
                       {"kind": "step", "n": 2, "title": "$t=e^x$", "fx": "$e^{-x}\\int e^tdt=e^{-x}e^{e^x}$"}],
              "right": [{"kind": "given", "title": "$\\frac{1}{D+2}e^{e^x}$", "sub": "$m=-2$"},
                        {"kind": "step", "n": 3, "title": "E1.1", "fx": "$e^{-2x}\\int e^{2x}e^{e^x}dx$"},
                        {"kind": "step", "n": 4, "title": "$t=e^x$, by parts", "fx": "$e^{-2x}(e^x-1)e^{e^x}$"}],
              "then": [{"kind": "result", "title": "PI = left − right $=e^{-2x}e^{e^x}$",
                        "fx": "$y=c_1e^{-x}+c_2e^{-2x}+e^{-2x}e^{e^x}$"}]},
     "remark": "CF from $m=-1,-2$. Worked in full as W3.1 (7 marks)."},
    {"id": "F3.2", "topic": "T3", "title": "Slides 009·14–17: $(D+2)(D+3)y=e^{2x}\\sin(e^x)$", "stars": 2,
     "srcs": ["S009·14", "S009·15", "S009·16", "S009·17"], "layout": "straight", "maxw": "160mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$\\big[\\frac{1}{D+2}-\\frac{1}{D+3}\\big]e^{2x}\\sin(e^x)$"},
         {"kind": "step", "n": 1, "title": "E1.1 on both", "fx": "$e^{-2x}\\int e^{4x}\\sin(e^x)dx-e^{-3x}\\int e^{5x}\\sin(e^x)dx$"},
         {"kind": "step", "n": 2, "title": "$t=e^x$", "fx": "$e^{-2x}\\int t^3\\sin t\\,dt-e^{-3x}\\int t^4\\sin t\\,dt$"},
         {"kind": "step", "n": 3, "title": "Bernoulli's rule, back to $x$", "sub": "(1) starts $-e^{x}\\cos(e^x)$, not $-e^{-x}\\cos(e^x)$ (slide slip)"},
         {"kind": "result", "title": "$y_p=-\\sin(e^x)-6e^{-x}\\cos(e^x)$", "fx": "$+18e^{-2x}\\sin(e^x)+24e^{-3x}\\cos(e^x)$"}]},
     "trap": "Slide 009·16's line (1) has $-e^{-x}\\cos(e^x)$; with that slip the $e^x$ terms would not cancel."},
]

COMPARISONS = [
    {"id": "C1.1", "topic": "T1", "title": "Which PI rule? (the four standard forms and “any other form”)", "srcs": ["T009 00:00:27", "T009b 00:00:32", "S009·3"],
     "head": ["$X$", "Rule", "Class pack"],
     "rows": [["$e^{ax}$", "$D\\to a$", "003"],
              ["$\\sin(ax+b)$, $\\cos(ax+b)$", "$D^2\\to-a^2$", "004"],
              ["$x^m$", "series in $D$ up to $D^m$", "005"],
              ["$e^{ax}V$ (and $xV$)", "$e^{ax}\\frac{1}{f(D+a)}V$; $\\big[\\frac{x}{f(D)}-\\frac{f'(D)}{(f(D))^2}\\big]V$", "006"],
              ["anything else", "linear factors, partial fractions, $\\frac{1}{D-m}X=e^{mx}\\int Xe^{-mx}dx$", "009 (this pack)"]]},
    {"id": "C2.1", "topic": "T2", "title": "$\\tan$, $\\sec$, $\\csc$ right-hand sides: operator method or variation of parameters", "flags": [ADD],
     "srcs": ["S009·5", "S009·7", "CW U2 P23", "CW U2 P26", "CW U2 P28", "ESA Jan-24 s1 3a"],
     "head": ["", "Operator method (this pack)", "Variation of parameters (class 011)"],
     "rows": [["Idea", "$\\frac{1}{D-m}X=e^{mx}\\int Xe^{-mx}dx$, complex $m=\\pm ia$", "$y_p=-y_1\\int\\frac{y_2X}{W}dx+y_2\\int\\frac{y_1X}{W}dx$"],
              ["Arithmetic", "complex numbers, Euler's formula", "real; needs the Wronskian $W$"],
              ["Same answer?", "yes: $\\frac{\\tan ax}{D^2+a^2}=-\\frac{1}{a^2}\\cos ax\\log(\\sec ax+\\tan ax)$", "yes (up to CF terms)"],
              ["Asked as", "slides 009·5–7; ESA Dec-23 3c ($e^{e^x}$)", "CW P23 ($\\sec ax$), P26 ($\\csc x$), P28 ($\\tan2x$); ESA VoP questions"],
              ["When to use", "question says “solve” and $X$ is no standard form", "question says “by the method of variation of parameters”"]]},
    {"id": "C3.1", "topic": "T3", "title": "Every “any other form” problem in this pack", "flags": [ADD],
     "srcs": ["S009·5", "S009·8", "S009·10", "S009·12", "S009·14", "ESA Dec-23 3c"],
     "head": ["Source (worked)", "Equation", "Integrals after $t=e^x$ / by parts", "PI"],
     "rows": [["S009·8–9 (W1.1)", "$D^2y=\\ln x$", "$\\iint\\ln x$", "$\\frac{x^2\\ln x}{2}-\\frac{3x^2}{4}$"],
              ["S009·5–7 (W2.1)", "$(D^2+a^2)y=\\tan ax$", "$\\int\\sin ax$, $\\int\\sec ax$", "$-\\frac{1}{a^2}\\cos ax\\log(\\sec ax+\\tan ax)$"],
              ["S009·10–11, ESA (W3.1)", "$(D^2+3D+2)y=e^{e^x}$", "$\\int e^t$, $\\int te^t$", "$e^{-2x}e^{e^x}$"],
              ["S009·12–13 (W3.2)", "$(D+1)(D+2)y=\\sin(e^x)$", "$\\int\\sin t$, $\\int t\\sin t$", "$-e^{-2x}\\sin(e^x)$"],
              ["S009·14–17 (W3.3)", "$(D^2+5D+6)y=e^{2x}\\sin(e^x)$", "$\\int t^3\\sin t$, $\\int t^4\\sin t$", "$-\\sin(e^x)-6e^{-x}\\cos(e^x)+\\dots$"]]},
]

SYMBOLS = [
    {"sym": "$D$", "name": "Differential operator", "meaning": "$\\frac{d}{dx}$; $\\frac1D$ = integration without a constant", "where": "E1.1, E1.5"},
    {"sym": "$f(D)$", "name": "Operator polynomial", "meaning": "Left-hand operator of $f(D)y=X$", "where": "E1.3"},
    {"sym": "$X$", "name": "Right-hand side", "meaning": "A function of $x$ (capital); here not of a standard form", "where": "E1.1"},
    {"sym": "$m_k$", "name": "AE root", "meaning": "Root of $f(m)=0$; $f(D)=\\prod(D-m_k)$", "where": "E1.1, E1.3"},
    {"sym": "$A_k$", "name": "Partial-fraction coefficient", "meaning": "$\\frac{1}{f(D)}=\\sum\\frac{A_k}{D-m_k}$; $A_k=\\frac{1}{f'(m_k)}$ (not an arbitrary constant)", "where": "E1.3"},
    {"sym": "$a$", "name": "Constant", "meaning": "In $D^2+a^2$, $\\tan ax$: $m=\\pm ia$; in the lecture's $\\frac{1}{D-a}f(x)$ it is the root (clash)", "where": "E2.1, E2.5"},
    {"sym": "$i$", "name": "Imaginary unit", "meaning": "$i^2=-1$; $e^{\\pm iax}=\\cos ax\\pm i\\sin ax$", "where": "E2.2, E2.4"},
    {"sym": "$t$", "name": "Substitution variable", "meaning": "$t=e^x$, $dt=e^xdx$ (not time)", "where": "E3.1, E3.2"},
    {"sym": "$\\ln x$, $\\log x$", "name": "Natural logarithm", "meaning": "Both mean $\\log_e x$ on these slides", "where": "E1.6, E2.3"},
    {"sym": "$c_1,c_2$", "name": "Arbitrary constants", "meaning": "In the CF only", "where": "E2.5, E3.3"},
]

KEYWORDS = [
    {"term": "Any other form", "meaning": "$X$ not $e^{ax}$, $\\sin$/$\\cos$, $x^m$ or $e^{ax}V$.", "topic": "T1"},
    {"term": "Linear factors", "meaning": "$f(D)=(D-m_1)\\cdots(D-m_n)$.", "topic": "T1"},
    {"term": "Partial fractions", "meaning": "$\\frac{1}{f(D)}=\\sum\\frac{A_k}{D-m_k}$.", "topic": "T1"},
    {"term": "Standard formula", "meaning": "$\\frac{1}{D-m}X=e^{mx}\\int Xe^{-mx}dx$.", "topic": "T1"},
    {"term": "Integrating factor", "meaning": "$e^{-mx}$ for $u'-mu=X$ (why E1.1 holds).", "topic": "T1"},
    {"term": "Successive application", "meaning": "$\\frac{1}{D-m_1}\\big[\\frac{1}{D-m_2}X\\big]$, no partial fractions.", "topic": "T1"},
    {"term": "$\\frac{1}{D^2}$", "meaning": "Integrate twice, no constants.", "topic": "T1"},
    {"term": "$\\frac{1}{D^2}\\ln x$", "meaning": "$\\frac{x^2\\ln x}{2}-\\frac{3x^2}{4}$.", "topic": "T1"},
    {"term": "Complex factors", "meaning": "$D^2+a^2=(D+ia)(D-ia)$.", "topic": "T2"},
    {"term": "Euler's formula", "meaning": "$e^{\\pm iax}=\\cos ax\\pm i\\sin ax$.", "topic": "T2"},
    {"term": "$i\\to-i$", "meaning": "Gives $\\frac{1}{D+ia}X$ from $\\frac{1}{D-ia}X$ (real $X$).", "topic": "T2"},
    {"term": "PI of $\\tan ax$", "meaning": "$-\\frac{1}{a^2}\\cos ax\\log(\\sec ax+\\tan ax)$.", "topic": "T2"},
    {"term": "Variation of parameters", "meaning": "Alternative for $\\tan$, $\\sec$, $\\csc$ (class 011).", "topic": "T2"},
    {"term": "$t=e^x$", "meaning": "$dt=e^xdx$, $e^{kx}dx=t^{k-1}dt$.", "topic": "T3"},
    {"term": "Bernoulli's rule", "meaning": "Repeated integration by parts in one line.", "topic": "T3"},
    {"term": "$e^{e^x}$", "meaning": "ESA Dec-23 3c; PI $e^{-2x}e^{e^x}$ for $(D+1)(D+2)$.", "topic": "T3"},
    {"term": "$\\sin(e^x)$", "meaning": "PI $-e^{-2x}\\sin(e^x)$ for $(D+1)(D+2)$.", "topic": "T3"},
]

RAPID = [
    {"q": "When is this method used?", "a": "When $X$ is none of $e^{ax}$, $\\sin$/$\\cos(ax+b)$, $x^m$, $e^{ax}V$."},
    {"q": "$\\frac{1}{D-m}X$?", "a": "$e^{mx}\\int Xe^{-mx}dx$."},
    {"q": "$\\frac{1}{D+2}X$?", "a": "$e^{-2x}\\int Xe^{2x}dx$."},
    {"q": "Why does $\\frac{1}{D-m}X=e^{mx}\\int Xe^{-mx}dx$ hold?", "a": "$u'-mu=X$; integrating factor $e^{-mx}$."},
    {"q": "Partial fractions of $\\frac{1}{(D+1)(D+2)}$?", "a": "$\\frac{1}{D+1}-\\frac{1}{D+2}$."},
    {"q": "Partial fractions of $\\frac{1}{D^2+a^2}$?", "a": "$\\frac{1}{2ia}\\big[\\frac{1}{D-ia}-\\frac{1}{D+ia}\\big]$."},
    {"q": "$\\frac{1}{D^2}\\ln x$?", "a": "$\\frac{x^2\\ln x}{2}-\\frac{3x^2}{4}$."},
    {"q": "$\\frac{1}{D-ia}\\tan ax$?", "a": "$-\\frac1a[1+ie^{iax}\\log(\\sec ax+\\tan ax)]$."},
    {"q": "PI of $(D^2+a^2)y=\\tan ax$?", "a": "$-\\frac{1}{a^2}\\cos ax\\log(\\sec ax+\\tan ax)$."},
    {"q": "Other method for $\\tan$, $\\sec$, $\\csc$?", "a": "Variation of parameters (class 011; CW P23, P26, P28)."},
    {"q": "Substitution for $X=e^{e^x}$, $\\sin(e^x)$?", "a": "$t=e^x$, $dt=e^xdx$."},
    {"q": "$\\int te^t\\,dt$?", "a": "$(t-1)e^t$."},
    {"q": "ESA Dec-23 3c: solve $y''+3y'+2y=e^{e^x}$.", "a": "$y=c_1e^{-x}+c_2e^{-2x}+e^{-2x}e^{e^x}$."},
    {"q": "$\\frac{1}{(D+1)(D+2)}\\sin(e^x)$?", "a": "$-e^{-2x}\\sin(e^x)$."},
    {"q": "$\\frac{1}{(D+2)(D+3)}e^{2x}\\sin(e^x)$?", "a": "$-\\sin(e^x)-6e^{-x}\\cos(e^x)+18e^{-2x}\\sin(e^x)+24e^{-3x}\\cos(e^x)$."},
    {"q": "Slide slip in this deck?", "a": "009·16 line (1): $-e^{-x}\\cos(e^x)$ should be $-e^{x}\\cos(e^x)$ (final answer right)."},
]

MNEMONICS = [
    "<i>“Root outside, minus root inside.”</i> $\\frac{1}{D-m}X=e^{+mx}\\int Xe^{-mx}dx$ (study aid).",
]

TOP_FACTS = [
    "Not a standard form? Factorise $f(D)$, partial fractions, then $\\frac{1}{D-m}X=e^{mx}\\int Xe^{-mx}dx$ for each factor; CF unchanged.",
    "$\\frac{1}{D+1}X=e^{-x}\\int Xe^{x}dx$, $\\frac{1}{D+2}X=e^{-2x}\\int Xe^{2x}dx$; no constants of integration.",
    "$\\frac{1}{D^2}\\ln x=\\frac{x^2\\ln x}{2}-\\frac{3x^2}{4}$.",
    "$\\frac{1}{D^2+a^2}\\tan ax=-\\frac{1}{a^2}\\cos ax\\log(\\sec ax+\\tan ax)$ (via $\\frac{1}{2ia}[\\frac{1}{D-ia}-\\frac{1}{D+ia}]$, $i\\to-i$).",
    "ESA Dec-23 3c: $y''+3y'+2y=e^{e^x}$: $y=c_1e^{-x}+c_2e^{-2x}+e^{-2x}e^{e^x}$ ($t=e^x$).",
    "$\\frac{\\sin(e^x)}{(D+1)(D+2)}=-e^{-2x}\\sin(e^x)$; one factor at a time: $\\frac{1}{D+2}[-e^{-x}\\cos(e^x)]$.",
    "$\\tan$, $\\sec$, $\\csc$ can also go by variation of parameters (class 011) — use it when the question names it.",
]
TOP_FORMULAS = ["E1.1", "E1.3", "E2.5", "E3.1", "E3.3"]
