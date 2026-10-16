"""Unit 2, class 004: particular integral, Type 2 (X = sin(ax+b), cos(ax+b)) and right-hand sides reducible to it."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "The Type 2 rule: replace $D^2$ by $-a^2$",
     "overview": r"When $X=\sin(ax+b)$ or $\cos(ax+b)$, the PI $\frac{1}{f(D)}X$ is found by replacing every $D^2$ in $f(D)$ by $-a^2$ "
                 r"(minus $a$ squared), provided the result is not zero. Odd powers are first written through $D^2$ ($D^3=D^2\cdot D$), so a "
                 r"single $D$ can remain; it is removed by multiplying above and below by the conjugate (rationalising), which turns the "
                 r"denominator into a function of $D^2$ again. The PI always has the same frequency $a$ as $X$, only a new amplitude and phase."},
    {"id": "T2", "title": "Case of failure: $f(-a^2)=0$",
     "overview": r"If replacing $D^2$ by $-a^2$ makes the denominator zero, $D^2+a^2$ is a factor of $f(D)$: $\pm ai$ are roots of the "
                 r"auxiliary equation and $\sin ax$, $\cos ax$ are already in the CF. Then multiply by $x$ and differentiate $f(D)$ with "
                 r"respect to $D$: $\frac{\sin(ax+b)}{f(D^2)}=x\frac{\sin(ax+b)}{f'(-a^2)}$, and again with $x^2$ and $f''$ if $f'$ also fails. "
                 r"The PI then grows like $x\sin$ or $x\cos$ (resonance). The ESA question $(D-2)^2y=8(e^{2x}+\sin2x)$ combines a double "
                 r"Type 1 failure with a Type 2 term."},
    {"id": "T3", "title": "Products, powers and sums: reducing to Type 2",
     "overview": r"The same rule gives the PI of $\sin ax\cos bx$, $\cos ax\cos bx$, $\sin ax\sin bx$, $\sin^2ax$, $\cos^2ax$, $\sin^3ax$ and "
                 r"$\cos^3ax$, after a trigonometric identity turns the product or power into a sum of single sines and cosines (and perhaps "
                 r"a constant, which is Type 1 with $a=0$). Since the operator is linear, the PI of a sum is the sum of the PIs: split $X$, "
                 r"find PI$_1$, PI$_2$, … separately and add them."},
]

DEFS = [
    {"topic": "T1", "term": "Type 2 right-hand side", "text": "$X=\\sin(ax+b)$ or $X=\\cos(ax+b)$, with constants $a$ and $b$.",
     "srcs": ["S004·3", "S004·4", "T004 00:00:00"]},
    {"topic": "T1", "term": "$f(-a^2)$", "text": "The expression obtained from $f(D)$ by replacing only the $D^2$ terms by $-a^2$ (minus $a$ squared). "
     "$D^3$ is written $D^2\\cdot D$ and $D^4$ as $(D^2)^2$ first.", "srcs": ["T004 00:01:15", "T004 00:01:53", "T004b 00:06:32"]},
    {"topic": "T1", "term": "Rationalising (conjugate)", "text": "If a single $D$ remains, as in $\\frac{1}{p+qD}$, multiply numerator and denominator by "
     "$p-qD$ to get $\\frac{p-qD}{p^2-q^2D^2}$; then replace $D^2$ by $-a^2$ again and let $p-qD$ act on $X$ (differentiate).",
     "srcs": ["S004·9", "T004 00:11:48", "T004b 00:06:59"]},
    {"topic": "T2", "term": "Case of failure", "text": "$f(-a^2)=0$; it happens when $D^2+a^2$ is a factor of $f(D)$.",
     "srcs": ["S004·5", "T004 00:02:42"]},
    {"topic": "T2", "term": "$f'(D)$", "text": "The derivative of $f(D)$ with respect to $D$, as if $D$ were a variable: $(D^2+3)'=2D$.",
     "srcs": ["T004 00:03:26", "S004·16"]},
    {"topic": "T2", "term": "Resonance", "text": "Forcing at a frequency already present in the CF; the PI carries an extra factor $x$ and its "
     "amplitude grows without bound.", "srcs": ["S004·5"], "flags": [ADD]},
    {"topic": "T3", "term": "Transformation formula", "text": "A product-to-sum identity such as $\\sin A\\cos B=\\frac12[\\sin(A+B)+\\sin(A-B)]$.",
     "srcs": ["S004·7", "T004 00:05:42"]},
    {"topic": "T3", "term": "Superposition", "text": "$\\frac{1}{f(D)}(X_1+X_2)=\\frac{1}{f(D)}X_1+\\frac{1}{f(D)}X_2$, so PI $=$ PI$_1+$PI$_2$.",
     "srcs": ["S004·11", "T004 00:17:28"]},
]

STATEMENTS = [
    {"topic": "T1", "text": "Type (ii); When $X=\\sin(ax+b)$ or $\\cos(ax+b)$: $\\frac{\\sin(ax+b)}{f(D^2)}=\\frac{\\sin(ax+b)}{f(-a^2)}$ provided "
     "$f(-a^2)\\neq0$; $\\frac{\\cos(ax+b)}{f(D^2)}=\\frac{\\cos(ax+b)}{f(-a^2)}$ provided $f(-a^2)\\neq0$.", "srcs": ["S004·4"]},
    {"topic": "T2", "text": "Case of failure; If $f(-a^2)=0$, then $\\frac{\\sin(ax+b)}{f(D^2)}=x.\\frac{\\sin(ax+b)}{f'(-a^2)}$ provided "
     "$f'(-a^2)\\neq0$; $\\frac{\\cos(ax+b)}{f(D^2)}=x.\\frac{\\cos(ax+b)}{f'(-a^2)}$ provided $f'(-a^2)\\neq0$.", "srcs": ["S004·5"]},
    {"topic": "T2", "text": "If $f'(-a^2)=0$, then $\\frac{\\sin(ax+b)}{f(D^2)}=x^2.\\frac{\\sin(ax+b)}{f''(-a^2)}$ provided $f''(-a^2)\\neq0$ "
     "(and the same for $\\cos(ax+b)$); “similarly, it proceeds on when $f''(a)=0$……”.", "srcs": ["S004·6", "S004·15"]},
    {"topic": "T3", "text": "The same formula can be used to find the PI for the following functions also. When $X=\\sin ax.\\cos bx$ or "
     "$\\cos ax.\\cos bx$ or $\\sin ax.\\sin bx$; When $X=\\sin^2ax$ or $\\cos^2ax$; When $X=\\sin^3ax$ or $\\cos^3ax$.", "srcs": ["S004·7"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Type 2 rule", "tex": r"\begin{gathered}\frac{1}{f(D^2)}\sin(ax+b)=\frac{\sin(ax+b)}{f(-a^2)}\\ \frac{1}{f(D^2)}\cos(ax+b)=\frac{\cos(ax+b)}{f(-a^2)}\end{gathered}",
     "gives": "The PI of a sine or cosine.", "when": "$f(-a^2)\\neq0$, i.e. $\\pm ai$ not roots of the AE.",
     "note": "Replace $D^2$ by $-a^2$, not by $(-a)^2$; $b$ plays no part.", "stars": 3,
     "srcs": ["S004·4", "S004·15", "T004 00:00:58", "T004b 00:06:32"]},
    {"id": "E1.2", "topic": "T1", "title": "Writing odd powers through $D^2$", "tex": r"D^3=D^2\cdot D\to-a^2D,\qquad D^4=(D^2)^2\to a^4,\qquad D^5=(D^2)^2D\to a^4D",
     "gives": "A denominator of the form $p+qD$.", "when": "$f(D)$ has odd powers of $D$.",
     "note": "Lecture example: $D+D^2+D^3\\to D-a^2-a^2D$.", "stars": 3, "srcs": ["T004 00:01:42", "T004 00:11:10", "S004·9"]},
    {"id": "E1.3", "topic": "T1", "title": "Rationalising a linear denominator", "tex": r"\frac{1}{p+qD}X=\frac{(p-qD)}{p^2-q^2D^2}X=\frac{(p-qD)X}{p^2+q^2a^2}",
     "gives": "A PI with no $D$ left in the denominator.", "when": "After E1.2 a single $D$ remains; $X=\\sin(ax+b)$ or $\\cos(ax+b)$.",
     "note": "$p-qD$ then acts on $X$: $D\\sin(ax+b)=a\\cos(ax+b)$, $D\\cos(ax+b)=-a\\sin(ax+b)$.", "stars": 3,
     "srcs": ["S004·9", "S004·17", "T004 00:12:01", "T004b 00:11:14"]},
    {"id": "E2.1", "topic": "T2", "title": "First case of failure", "tex": r"f(-a^2)=0:\quad \frac{1}{f(D^2)}\sin(ax+b)=x\,\frac{\sin(ax+b)}{f'(-a^2)}\quad(\text{same for }\cos)",
     "gives": "The PI when the frequency is in the CF.", "when": "$f(-a^2)=0$, $f'(-a^2)\\neq0$.",
     "note": "$f'$ = derivative w.r.t. $D$; it usually leaves a $D$ (e.g. $2D$), which is then integration $\\frac1D$.", "stars": 3,
     "srcs": ["S004·5", "S004·15", "S004·16", "T004 00:03:07", "T004b 00:07:32"]},
    {"id": "E2.2", "topic": "T2", "title": "Standard results for $D^2+a^2$", "tex": r"\frac{1}{D^2+a^2}\sin ax=-\frac{x\cos ax}{2a},\qquad \frac{1}{D^2+a^2}\cos ax=\frac{x\sin ax}{2a}",
     "gives": "The failure PI in one line.", "when": "$f(D)=D^2+a^2$ (or this factor, with the rest applied first).",
     "note": "From E2.1: $\\frac{x}{2D}\\sin ax=\\frac{x}{2}\\int\\sin ax\\,dx$.", "stars": 3,
     "srcs": ["S004·16", "T004 00:23:17"], "flags": [ADD]},
    {"id": "E2.3", "topic": "T2", "title": "Second case of failure", "tex": r"f'(-a^2)=0:\quad \frac{1}{f(D^2)}\sin(ax+b)=x^2\,\frac{\sin(ax+b)}{f''(-a^2)}",
     "gives": "The PI when $D^2+a^2$ is a repeated factor.", "when": "$f(-a^2)=f'(-a^2)=0$, $f''(-a^2)\\neq0$.",
     "note": "And so on: $x^3$ and $f'''$ if $f''$ also fails.", "stars": 1, "srcs": ["S004·6", "S004·15", "T004 00:04:23", "T004 00:05:06"]},
    {"id": "E3.1", "topic": "T3", "title": "Product to sum", "tex": r"\begin{gathered}\sin A\cos B=\tfrac12[\sin(A+B)+\sin(A-B)]\\ \cos A\cos B=\tfrac12[\cos(A+B)+\cos(A-B)]\\ \sin A\sin B=\tfrac12[\cos(A-B)-\cos(A+B)]\end{gathered}",
     "gives": "Single sines and cosines.", "when": "$X=\\sin ax\\cos bx$, $\\cos ax\\cos bx$, $\\sin ax\\sin bx$.",
     "note": "Only the first identity is spoken in the lecture; the other two are standard.", "stars": 1,
     "srcs": ["S004·7", "T004 00:05:42"]},
    {"id": "E3.2", "topic": "T3", "title": "Squares", "tex": r"\sin^2ax=\frac{1-\cos2ax}{2},\qquad \cos^2ax=\frac{1+\cos2ax}{2}",
     "gives": "A constant (Type 1 with $a=0$) plus a Type 2 term at frequency $2a$.", "when": "$X=\\sin^2ax$ or $\\cos^2ax$.",
     "note": "$\\cos^2\\frac x2=\\frac{1+\\cos x}{2}$, $\\sin^2\\frac x2=\\frac{1-\\cos x}{2}$.", "stars": 3,
     "srcs": ["S004·7", "S004·13", "S004·17", "T004 00:06:23", "T004 00:20:36", "ESA Jan-24 s3 2c", "ESA Jan-24 s4 2c"]},
    {"id": "E3.3", "topic": "T3", "title": "Cubes", "tex": r"\sin^3A=\frac{3\sin A-\sin3A}{4},\qquad \cos^3A=\frac{3\cos A+\cos3A}{4}",
     "gives": "Two Type 2 terms, at frequencies $a$ and $3a$.", "when": "$X=\\sin^3ax$ or $\\cos^3ax$.",
     "note": "Listed on slide 004·7 without the identity.", "stars": 1, "srcs": ["S004·7", "T004 00:06:41"], "flags": [ADD]},
    {"id": "E3.4", "topic": "T3", "title": "Superposition", "tex": r"\frac{1}{f(D)}(X_1+X_2+\dots)=\frac{1}{f(D)}X_1+\frac{1}{f(D)}X_2+\dots=\text{PI}_1+\text{PI}_2+\dots",
     "gives": "The PI of a sum of terms of different types.", "when": "$X$ is a sum, e.g. $e^x+\\cos^2\\frac x2$.",
     "note": "Each term chooses its own rule (Type 1, Type 2, failure).", "stars": 3,
     "srcs": ["S004·11", "S004·14", "T004 00:17:10", "ESA Dec-23 3a"]},
    {"id": "E3.5", "topic": "T3", "title": "Factor by factor", "tex": r"\frac{1}{\varphi(D)\psi(D)}X=\frac{1}{\psi(D)}\Big[\frac{1}{\varphi(D)}X\Big]",
     "gives": "A way round a failure in one factor.", "when": "Apply the non-failing factor first, then the other.",
     "note": "Slide 004·13: $\\frac{1}{(D-1)^2}$ on $\\cos x$ first, then $\\frac{1}{D^2+1}$.", "stars": 2,
     "srcs": ["S004·12", "S004·13", "T004 00:18:17", "T004 00:21:50"]},
]

POINTS = [
    {"topic": "T1", "text": "Replace only $D^2$, never $D$. Write $D^3=D^2\\cdot D$ and replace the $D^2$ part.", "stars": 3,
     "srcs": ["T004 00:01:15", "T004 00:01:53", "T004b 00:06:32"]},
    {"topic": "T1", "text": "“It is not minus 2 the whole square. It is minus into 2 square, which is minus 4.”", "stars": 3,
     "srcs": ["T004 00:11:33", "T004b 00:06:32"]},
    {"topic": "T1", "text": "If a $D$ remains after the replacement, rationalise with the conjugate so that $D^2$ appears, then replace again.", "stars": 3,
     "srcs": ["S004·9", "T004 00:11:48", "T004b 00:06:59"]},
    {"topic": "T1", "text": "$\\frac{1}{1+4D}$, $(1+4D)$ are operators: the function always stays to the right of the operator.", "stars": 2,
     "srcs": ["T004 00:12:15"]},
    {"topic": "T1", "text": "After rationalising, the numerator operator $(p-qD)$ differentiates $X$: $(1+4D)\\cos(2x+3)=\\cos(2x+3)-8\\sin(2x+3)$.", "stars": 3,
     "srcs": ["S004·9", "T004 00:13:23"]},
    {"topic": "T1", "text": "The PI has the same frequency as $X$; a sine input can give a mixture of sine and cosine (a phase shift), Figure G1.1.", "stars": 2,
     "srcs": ["S004·9"], "flags": [ADD]},
    {"topic": "T2", "text": "$f(-a^2)=0$ exactly when $D^2+a^2$ is a factor of $f(D)$, i.e. when $\\pm ai$ are AE roots. Look at the CF first: "
     "it tells you in advance which terms will fail.", "stars": 3, "srcs": ["T004 00:02:53", "S004·16"]},
    {"topic": "T2", "text": "On failure, write $x$ outside the operator and differentiate the denominator with respect to $D$: "
     "$\\frac{\\cos\\sqrt3x}{D^2+3}=x\\frac{\\cos\\sqrt3x}{2D}$.", "stars": 3, "srcs": ["S004·16", "T004 00:23:34", "T004b 00:08:45"]},
    {"topic": "T2", "text": "$\\frac1D$ means integrate, with no constant: $\\frac{x}{2D}\\cos\\sqrt3x=\\frac x2\\int\\cos\\sqrt3x\\,dx=\\frac{x\\sin\\sqrt3x}{2\\sqrt3}$.", "stars": 3,
     "srcs": ["S004·16", "T004 00:22:41", "T004b 00:09:05"]},
    {"topic": "T2", "text": "The $x$ stays outside: only the trigonometric function is integrated, not $x$ times it.", "stars": 2,
     "srcs": ["S004·14", "T004 00:23:44"], "flags": [ADD]},
    {"topic": "T2", "text": "When only one factor of $f(D)$ fails, apply the other factor first (E3.5), then the failing one.", "stars": 2,
     "srcs": ["S004·13", "T004 00:21:50"]},
    {"topic": "T2", "text": "ESA $(D-2)^2y=8(e^{2x}+\\sin2x)$: $e^{2x}$ fails twice (Type 1), $\\sin2x$ does not fail (Type 2 with $D^2=-4$ leaves $-4D$).", "stars": 3,
     "srcs": ["ESA Dec-23 3a", "ESA May-24 3b", "ESA Jun-24 2a"]},
    {"topic": "T3", "text": "No formula exists for $\\cos^2\\frac x2$ itself: rewrite it with an identity first, then use the rule.", "stars": 3,
     "srcs": ["T004 00:20:16", "T004 00:20:36"]},
    {"topic": "T3", "text": "The constant from $\\sin^2$ or $\\cos^2$ is $\\frac12e^{0x}$: Type 1 with $D\\to0$, and it fails if $D$ is a factor of $f(D)$ "
     "($\\frac{1}{2(D^3-2D^2+D)}\\to\\frac x2$).", "stars": 3, "srcs": ["S004·13", "S004·17", "T004 00:21:33", "T004b 00:09:42"]},
    {"topic": "T3", "text": "Split a mixed right-hand side into PI$_1$, PI$_2$, … and find each separately; the PI is their sum.", "stars": 3,
     "srcs": ["S004·11", "T004 00:17:28"]},
    {"topic": "T3", "text": "If the question says “find the PI”, stop at the PI; if it says “solve”, write $y=$ CF $+$ PI.", "stars": 2,
     "srcs": ["T004 00:24:12"]},
]

WHY = [
    {"topic": "T1", "q": "Why may $D^2$ be replaced by $-a^2$?",
     "a": "$D^2\\sin(ax+b)=-a^2\\sin(ax+b)$, and the same for cosine, so on these functions $D^2$ acts as multiplication by $-a^2$. Hence "
          "$f(D^2)\\frac{\\sin(ax+b)}{f(-a^2)}=\\sin(ax+b)$. A single $D$ turns sine into cosine, so it cannot be replaced by a number.",
     "srcs": ["S004·4"], "flags": [ADD]},
    {"topic": "T2", "q": "Why does an $x$ appear when $f(-a^2)=0$?",
     "a": "Then $\\sin ax$, $\\cos ax$ solve the homogeneous equation (they are in the CF), so no multiple of them can give $X$. Multiplying by "
          "$x$ gives a new function; the rule's $x\\frac{1}{f'}$ is the limit of $\\frac{1}{f}$ as the frequency approaches the root (same idea as Type 1).",
     "srcs": ["S004·5", "T004 00:02:53"], "flags": [ADD]},
    {"topic": "T1", "q": "Why multiply by the conjugate?",
     "a": "$(p+qD)(p-qD)=p^2-q^2D^2$ contains only $D^2$, which can be replaced by $-a^2$, a number. The conjugate moves to the numerator, where "
          "it is just differentiation.", "srcs": ["S004·9", "T004 00:11:48", "T004b 00:11:29"]},
]

TRAPS = [
    {"topic": "T1", "text": "$-a^2$ is not $(-a)^2$. For $a=2$, $D^2\\to-4$, so $D^3+1\\to1-4D$ (slide 004·9).", "srcs": ["T004 00:11:33", "S004·9"]},
    {"topic": "T1", "text": "Do not replace a lone $D$ by $a$ or by $ia$: rationalise it (E1.3).", "srcs": ["T004b 00:06:59"], "flags": [ADD]},
    {"topic": "T3", "text": "Slide 004·14 (and the lecture) give the constant part of PI$_2$ for $(D-1)^2(D^2+1)y=\\cos^2\\frac x2$ as $\\frac14$; it is "
     "$\\frac12\\cdot\\frac1{f(0)}=\\frac12$.", "srcs": ["S004·14", "T004 00:21:33"], "flags": [ADD]},
    {"topic": "T3", "text": "Slide 004·17's boxed answer drops the 2 of $\\frac{\\cos2x}{2(\\dots)}$: the correct PI is $\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$ "
     "(as in CW P18), not $\\frac x2-\\frac{8\\cos2x}{100}+\\frac{6\\sin2x}{100}$.", "srcs": ["S004·17", "T004b 00:10:35", "CW U2 P18"], "flags": [ADD]},
    {"topic": "T2", "text": "Slide 004·15 writes $f'(a)$ in the failure formula; it means $f'(D)$ with $D^2\\to-a^2$ (slides 004·5–6), never $f'$ at the number $a$.",
     "srcs": ["S004·15", "S004·5"], "flags": [ADD]},
    {"topic": "T2", "text": "For $\\frac{1}{D^2+a^2}\\sin ax$ the answer is $-\\frac{x\\cos ax}{2a}$: the integral of $\\sin$ brings a minus sign.",
     "srcs": ["T004 00:23:44"], "flags": [ADD]},
    {"topic": "T3", "text": "$\\sin^2x=\\frac{1-\\cos2x}{2}$ (frequency doubles), not $\\frac{1-\\cos x}{2}$ as said at T004b 00:09:26.",
     "srcs": ["S004·17", "T004b 00:09:26"], "flags": [ADD]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "$(D^3+1)y=\\cos(2x+3)$ (slides 004·8–9)", "stars": 3,
     "srcs": ["S004·8", "S004·9", "T004 00:07:01", "T004 00:13:58"],
     "given": "Solve $(D^3+1)y=\\cos(2x+3)$.",
     "steps": ["AE $m^3+1=0$, $(m+1)(m^2-m+1)=0$: $m=-1,\\ \\frac12\\pm\\frac{\\sqrt3}{2}i$. CF $=c_1e^{-x}+e^{x/2}\\big(c_2\\cos\\frac{\\sqrt3}2x+c_3\\sin\\frac{\\sqrt3}2x\\big)$.",
               "PI $=\\frac{\\cos(2x+3)}{D\\cdot D^2+1}$; $D^2\\to-4$: $\\frac{\\cos(2x+3)}{1-4D}$.",
               "Rationalise: $\\frac{(1+4D)\\cos(2x+3)}{1-16D^2}=\\frac{(1+4D)\\cos(2x+3)}{1+64}$.",
               "$(1+4D)\\cos(2x+3)=\\cos(2x+3)-8\\sin(2x+3)$."],
     "answer": "$y=c_1e^{-x}+e^{x/2}\\big(c_2\\cos\\tfrac{\\sqrt3}{2}x+c_3\\sin\\tfrac{\\sqrt3}{2}x\\big)+\\tfrac{1}{65}\\big[\\cos(2x+3)-8\\sin(2x+3)\\big]$",
     "check": "sympy dsolve and checkodesol agree; the slide stops at $y=y_c+y_p$. Figure G1.1."},
    {"id": "W1.2", "topic": "T1", "title": "$y'''-y''+4y'-4y=\\sin3x$ (CW P13)", "stars": 2, "srcs": ["CW U2 P13"],
     "given": "Solve $y'''-y''+4y'-4y=\\sin3x$, i.e. $(D^3-D^2+4D-4)y=\\sin3x$.",
     "steps": ["AE $(m-1)(m^2+4)=0$: $m=1,\\ \\pm2i$. CF $=c_1e^x+c_2\\cos2x+c_3\\sin2x$.",
               "$D^2\\to-9$: $-9D+9+4D-4=5-5D$, so PI $=\\frac{\\sin3x}{5(1-D)}$ ($3i$ is not a root: no failure).",
               "Rationalise: $\\frac{(1+D)\\sin3x}{5(1-D^2)}=\\frac{(1+D)\\sin3x}{5\\cdot10}$.",
               "$(1+D)\\sin3x=\\sin3x+3\\cos3x$."],
     "answer": "$y=c_1e^x+c_2\\cos2x+c_3\\sin2x+\\dfrac{3\\cos3x+\\sin3x}{50}$",
     "check": "CW answer agrees; sympy dsolve and checkodesol agree."},
    {"id": "W1.3", "topic": "T1", "title": "Type 2 term of $(D^2-5D+6)y=e^{4x}+\\sin x+x^2$ (ESA)", "stars": 2, "srcs": ["ESA Jul-23 3b"],
     "given": "Find $\\frac{1}{D^2-5D+6}\\sin x$ (the full question is solved in the class 005 pack).",
     "steps": ["$D^2\\to-1$: $-1-5D+6=5-5D$, so $\\frac{\\sin x}{5(1-D)}$.",
               "Rationalise: $\\frac{(1+D)\\sin x}{5(1-D^2)}=\\frac{(1+D)\\sin x}{10}$."],
     "answer": "$\\dfrac{1}{D^2-5D+6}\\sin x=\\dfrac{\\sin x+\\cos x}{10}$",
     "check": "Substituting back gives $\\sin x$ (sympy)."},
    {"id": "W1.4", "topic": "T1", "title": "The lecture's $D+D^2+D^3$ with $X=\\sin2x$", "stars": 1, "srcs": ["T004 00:01:42"], "flags": [ADD],
     "given": "Find $\\frac{1}{D^3+D^2+D}\\sin2x$ (the lecture names this $f(D)$ but works no example).",
     "steps": ["$D^3=D^2\\cdot D\\to-4D$, $D^2\\to-4$: $-4D-4+D=-(4+3D)$.",
               "Rationalise: $-\\frac{(4-3D)\\sin2x}{16-9D^2}=-\\frac{(4-3D)\\sin2x}{52}$.",
               "$(4-3D)\\sin2x=4\\sin2x-6\\cos2x$."],
     "answer": "$\\dfrac{1}{D^3+D^2+D}\\sin2x=\\dfrac{3\\cos2x-2\\sin2x}{26}$",
     "check": "Substituting back gives $\\sin2x$ (sympy)."},
    {"id": "W2.1", "topic": "T2", "title": "$(D^2+3)y=\\cos\\sqrt3x$ (slide 004·16, CW P14)", "stars": 3,
     "srcs": ["S004·16", "T004b 00:08:13", "T004b 00:09:05", "CW U2 P14"],
     "given": "Solve $(D^2+3)y=\\cos\\sqrt3x$ (the slide asks for the PI only).",
     "steps": ["AE $m^2+3=0$: $m=\\pm\\sqrt3i$. CF $=c_1\\cos\\sqrt3x+c_2\\sin\\sqrt3x$.",
               "$a=\\sqrt3$, $D^2\\to-3$: $f(-3)=0$, a failure.",
               "E2.1: PI $=x\\frac{\\cos\\sqrt3x}{2D}=\\frac x2\\int\\cos\\sqrt3x\\,dx$."],
     "answer": "$y=c_1\\cos\\sqrt3x+c_2\\sin\\sqrt3x+\\dfrac{x\\sin\\sqrt3x}{2\\sqrt3}$",
     "check": "Slide and CW answer agree; E2.2 with $a=\\sqrt3$; sympy dsolve gives $\\frac{\\sqrt3}{6}x\\sin\\sqrt3x$, the same."},
    {"id": "W2.2", "topic": "T2", "title": "Type 2 term of $(D^2+4)y=x^2+\\cos2x+2^{-x}$ (ESA)", "stars": 2, "srcs": ["ESA Jan-24 s1 2d"],
     "given": "Find $\\frac{1}{D^2+4}\\cos2x$ (the full question is solved in the class 005 pack).",
     "steps": ["$D^2\\to-4$: $f(-4)=0$, a failure.", "PI $=x\\frac{\\cos2x}{2D}=\\frac x2\\cdot\\frac{\\sin2x}{2}$."],
     "answer": "$\\dfrac{1}{D^2+4}\\cos2x=\\dfrac{x\\sin2x}{4}$", "check": "E2.2 with $a=2$; substituting back gives $\\cos2x$ (sympy)."},
    {"id": "W2.3", "topic": "T2", "title": "$(D-2)^2y=8(e^{2x}+\\sin2x)$ (ESA, asked three times)", "stars": 3,
     "srcs": ["ESA Dec-23 3a", "ESA May-24 3b", "ESA Jun-24 2a", "CW U2 P21"],
     "given": "Solve $(D-2)^2y=8(e^{2x}+\\sin2x)$, where $D=\\frac{d}{dx}$.",
     "steps": ["AE $(m-2)^2=0$: $m=2,2$. CF $=(c_1+c_2x)e^{2x}$.",
               "PI$_1=\\frac{8e^{2x}}{(D-2)^2}$: $f(2)=0$, $f'(D)=2(D-2)$, $f'(2)=0$, $f''=2$: PI$_1=8\\cdot\\frac{x^2e^{2x}}{2}=4x^2e^{2x}$ (Type 1, class 003).",
               "PI$_2=\\frac{8\\sin2x}{D^2-4D+4}$; $D^2\\to-4$: $\\frac{8\\sin2x}{-4D}=-2\\cdot\\frac1D\\sin2x$ (no failure, the lone $D$ is integration).",
               "$-2\\int\\sin2x\\,dx=-2\\cdot\\big(-\\frac{\\cos2x}{2}\\big)=\\cos2x$."],
     "answer": "$y=(c_1+c_2x)e^{2x}+4x^2e^{2x}+\\cos2x$",
     "check": "sympy dsolve and checkodesol agree. CW P21 (the same with $+x^2$) prints the same terms plus $2x^2+4x+3$."},
    {"id": "W3.1", "topic": "T3", "title": "$(D-1)^2(D^2+1)y=e^x+\\cos^2\\frac x2$ (slides 004·10–14)", "stars": 3,
     "srcs": ["S004·10", "S004·11", "S004·12", "S004·13", "S004·14", "T004 00:14:16", "T004 00:24:01"],
     "given": "Solve $(D-1)^2(D^2+1)y=e^x+\\cos^2\\frac x2$.",
     "steps": ["AE $(m-1)^2(m^2+1)=0$: $m=1,1,\\pm i$. CF $=(c_1+c_2x)e^x+c_3\\cos x+c_4\\sin x$.",
               "PI$_1=\\frac{1}{(D-1)^2}\\big[\\frac{e^x}{D^2+1}\\big]=\\frac{1}{(D-1)^2}\\frac{e^x}{2}=\\frac{x^2e^x}{2\\cdot2}=\\frac{x^2e^x}{4}$.",
               "PI$_2$: $\\cos^2\\frac x2=\\frac{1+\\cos x}{2}$. Constant: $\\frac{1}{2(0-1)^2(0+1)}=\\frac12$ (slide 004·14 prints $\\frac14$).",
               "Cosine: $\\frac12\\cdot\\frac{1}{D^2+1}\\big[\\frac{\\cos x}{D^2-2D+1}\\big]=\\frac12\\cdot\\frac{1}{D^2+1}\\big[\\frac{\\cos x}{-2D}\\big]=-\\frac14\\cdot\\frac{\\sin x}{D^2+1}$.",
               "Failure ($D^2+1\\to0$): $-\\frac14\\cdot x\\frac{\\sin x}{2D}=-\\frac14\\cdot x\\cdot\\frac{-\\cos x}{2}=\\frac{x\\cos x}{8}$."],
     "answer": "$y=(c_1+c_2x)e^x+c_3\\cos x+c_4\\sin x+\\dfrac{x^2e^x}{4}+\\dfrac12+\\dfrac{x\\cos x}{8}$",
     "check": "sympy dsolve and checkodesol agree. With the slide's $\\frac14$, substituting back leaves $-\\frac14$."},
    {"id": "W3.2", "topic": "T3", "title": "$(D^3-2D^2+D)y=\\sin^2x$ (slide 004·17; ESA Jan-24 s3 2c part)", "stars": 3,
     "srcs": ["S004·17", "T004b 00:09:26", "T004b 00:12:08", "ESA Jan-24 s3 2c", "CW U2 P18"],
     "given": "Find the PI of $(D^3-2D^2+D)y=\\sin^2x$.",
     "steps": ["$\\sin^2x=\\frac{1-\\cos2x}{2}$, so PI $=\\frac{e^{0x}}{2(D^3-2D^2+D)}-\\frac{\\cos2x}{2(D^3-2D^2+D)}$.",
               "Constant: $f(0)=0$, $f'(D)=3D^2-4D+1$, $f'(0)=1$: $\\frac12\\cdot\\frac x1=\\frac x2$.",
               "Cosine: $D^2\\to-4$: $-4D+8+D=8-3D$; rationalise: $\\frac{(8+3D)\\cos2x}{64-9D^2}=\\frac{8\\cos2x-6\\sin2x}{100}$.",
               "Keep the factor $\\frac12$: $-\\frac12\\cdot\\frac{8\\cos2x-6\\sin2x}{100}$."],
     "answer": "PI $=\\dfrac x2-\\dfrac{8\\cos2x-6\\sin2x}{200}=\\dfrac x2-\\dfrac{\\cos2x}{25}+\\dfrac{3\\sin2x}{100}$",
     "check": "Agrees with CW P18; the slide's boxed $\\frac x2-\\frac{8\\cos2x}{100}+\\frac{6\\sin2x}{100}$ leaves $-\\frac{\\cos2x}{2}$ when substituted (sympy)."},
    {"id": "W3.3", "topic": "T3", "title": "A product: $(D^2+1)y=\\sin2x\\cos x$", "stars": 1, "srcs": ["S004·7", "T004 00:05:42"], "flags": [ADD],
     "given": "Solve $(D^2+1)y=\\sin2x\\cos x$ (slide 004·7 lists products but works none).",
     "steps": ["CF $=c_1\\cos x+c_2\\sin x$. $\\sin2x\\cos x=\\frac12(\\sin3x+\\sin x)$.",
               "$\\frac12\\cdot\\frac{\\sin3x}{D^2+1}=\\frac12\\cdot\\frac{\\sin3x}{-9+1}=-\\frac{\\sin3x}{16}$.",
               "$\\frac12\\cdot\\frac{\\sin x}{D^2+1}$ fails: $\\frac12\\big(-\\frac{x\\cos x}{2}\\big)=-\\frac{x\\cos x}{4}$ (E2.2)."],
     "answer": "$y=c_1\\cos x+c_2\\sin x-\\dfrac{\\sin3x}{16}-\\dfrac{x\\cos x}{4}$", "check": "Substituting back gives $\\sin2x\\cos x$ (sympy)."},
    {"id": "W3.4", "topic": "T3", "title": "A cube: $(D^2+4)y=\\sin^3x$", "stars": 1, "srcs": ["S004·7", "T004 00:06:41"], "flags": [ADD],
     "given": "Solve $(D^2+4)y=\\sin^3x$.",
     "steps": ["CF $=c_1\\cos2x+c_2\\sin2x$. $\\sin^3x=\\frac{3\\sin x-\\sin3x}{4}$ (E3.3).",
               "$\\frac34\\cdot\\frac{\\sin x}{-1+4}=\\frac{\\sin x}{4}$; $-\\frac14\\cdot\\frac{\\sin3x}{-9+4}=\\frac{\\sin3x}{20}$."],
     "answer": "$y=c_1\\cos2x+c_2\\sin2x+\\dfrac{\\sin x}{4}+\\dfrac{\\sin3x}{20}$", "check": "Substituting back gives $\\sin^3x$ (sympy)."},
    {"id": "W3.5", "topic": "T3", "title": "Type 2 term of $(D-1)^2(D+1)^2y=\\sin^2\\frac x2+2^{-x}+x$ (ESA)", "stars": 2,
     "srcs": ["ESA Jan-24 s4 2c", "CW U2 P22"],
     "given": "Find $\\frac{1}{(D-1)^2(D+1)^2}\\sin^2\\frac x2$ (the full question is solved in the class 005 pack).",
     "steps": ["$(D-1)^2(D+1)^2=(D^2-1)^2$; $\\sin^2\\frac x2=\\frac{1-\\cos x}{2}$.",
               "Constant: $\\frac12\\cdot\\frac{1}{(0-1)^2}=\\frac12$. Cosine: $D^2\\to-1$: $(-1-1)^2=4$, so $-\\frac12\\cdot\\frac{\\cos x}{4}$."],
     "answer": "$\\dfrac{1}{(D^2-1)^2}\\sin^2\\dfrac x2=\\dfrac12-\\dfrac{\\cos x}{8}$", "check": "Agrees with CW P22; substituting back gives $\\sin^2\\frac x2$ (sympy)."},
]

PYQS = [
    {"topic": "T2", "paper": "ESA Dec 2023", "q": "UE22MA141A Q3.a (= May 2024 Q3.b, June 2024 Q2.a)", "marks": 7,
     "text": "Solve $(D-2)^2y=8(e^{2x}+\\sin2x)$, where $D=\\frac{d}{dx}$.", "worked": "W2.3"},
    {"topic": "T1", "paper": "ESA Jul 2023", "q": "UE22MA141A Q3.b", "marks": 7,
     "text": "Solve $(D^2-5D+6)y=e^{4x}+\\sin x+x^2$. Type 2 part: $\\frac{\\sin x+\\cos x}{10}$. Full solution: class 005 pack.", "worked": "W1.3"},
    {"topic": "T2", "paper": "ESA Jan 2024", "q": "UE23MA141A set 1, Q2.d", "marks": 5,
     "text": "Solve $(D^2+4)y=x^2+\\cos2x+2^{-x}$. Type 2 part (failure): $\\frac{x\\sin2x}{4}$. Full solution: class 005 pack.", "worked": "W2.2"},
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 3, Q2.c (= CW P18)", "marks": 6,
     "text": "Solve $(D^3-2D^2+D)y=x^2e^{-x}+\\sin^2x$. $\\sin^2x$ part: $\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$. Full solution: class 006 pack.", "worked": "W3.2"},
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 4, Q2.c (= CW P22)", "marks": 6,
     "text": "Solve $[(D-1)^2(D+1)^2]y=\\sin^2\\frac x2+2^{-x}+x$. $\\sin^2\\frac x2$ part: $\\frac12-\\frac{\\cos x}{8}$. Full solution: class 005 pack.", "worked": "W3.5"},
]

NOTES = [
    {"topic": "T1", "text": "Type 2: $X=\\sin(ax+b)$ or $\\cos(ax+b)$. PI $=\\frac{X}{f(-a^2)}$: replace every $D^2$ by $-a^2$ (minus $a$ squared), "
     "$D^3=D^2D\\to-a^2D$. If a lone $D$ remains, $\\frac{1}{p+qD}=\\frac{p-qD}{p^2-q^2D^2}$, replace $D^2$ again, and let $p-qD$ "
     "differentiate $X$. Example: $\\frac{\\cos(2x+3)}{D^3+1}=\\frac{\\cos(2x+3)-8\\sin(2x+3)}{65}$; CW P13: $\\frac{\\sin3x}{D^3-D^2+4D-4}=\\frac{3\\cos3x+\\sin3x}{50}$."},
    {"topic": "T2", "text": "Failure: $f(-a^2)=0\\iff D^2+a^2$ divides $f(D)$ ($\\pm ai$ in the CF). Then PI $=x\\frac{X}{f'(-a^2)}$, $f'$ w.r.t. $D$; "
     "if $f'$ also fails, $x^2\\frac{X}{f''(-a^2)}$. Standard: $\\frac{\\sin ax}{D^2+a^2}=-\\frac{x\\cos ax}{2a}$, $\\frac{\\cos ax}{D^2+a^2}=\\frac{x\\sin ax}{2a}$; "
     "$\\frac{\\cos\\sqrt3x}{D^2+3}=\\frac{x\\sin\\sqrt3x}{2\\sqrt3}$. ESA ×3: $(D-2)^2y=8(e^{2x}+\\sin2x)$: $y=(c_1+c_2x)e^{2x}+4x^2e^{2x}+\\cos2x$."},
    {"topic": "T3", "text": "Reduce first: $\\sin A\\cos B=\\frac12[\\sin(A+B)+\\sin(A-B)]$; $\\sin^2=\\frac{1-\\cos2ax}{2}$, $\\cos^2=\\frac{1+\\cos2ax}{2}$; "
     "$\\sin^3A=\\frac{3\\sin A-\\sin3A}{4}$. The constant is Type 1 ($D\\to0$; fails if $D$ divides $f$). Add the separate PIs. "
     "$(D-1)^2(D^2+1)y=e^x+\\cos^2\\frac x2$: PI $=\\frac{x^2e^x}{4}+\\frac12+\\frac{x\\cos x}{8}$ (slide prints $\\frac14$). "
     "$\\frac{\\sin^2x}{D^3-2D^2+D}=\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$ (slide drops a 2)."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "Same frequency, new amplitude and phase: the PI of $(D^3+1)y=\\cos(2x+3)$", "stars": 2,
     "srcs": ["S004·8", "S004·9"], "flags": [ADD],
     "howto": "The forcing $\\cos(2x+3)$ (blue) and ten times its PI $\\frac{\\cos(2x+3)-8\\sin(2x+3)}{65}$ (vermilion dashed). Both have period $\\pi$; "
              "the PI is a single sinusoid of amplitude $\\frac{\\sqrt{1+64}}{65}=\\frac{1}{\\sqrt{65}}$ (grey lines, scaled by 10) shifted in phase. "
              "This is what the rationalised answer $\\cos-8\\sin$ means."},
    {"id": "G2.1", "topic": "T2", "title": "Amplitude of the PI, $\\frac{1}{|f(-a^2)|}$, against the forcing frequency $a$", "stars": 3,
     "srcs": ["S004·4", "S004·5"], "flags": [ADD],
     "howto": "For $(D^2+4)y=\\sin ax$ the PI is $\\frac{\\sin ax}{4-a^2}$, of amplitude $\\frac{1}{|4-a^2|}$ (blue). It is $\\frac14$ at $a=0$, $\\frac13$ at $a=1$ "
              "(black dot) and blows up at $a=2$ (grey line), where $f(-a^2)=0$ and the Type 2 rule fails. With a damping term "
              "($D^2+0.8D+4$, vermilion dashed) $f(-a^2)=4-a^2+0.8D$ never vanishes and the peak stays finite (resonance)."},
    {"id": "G2.2", "topic": "T2", "title": "The failure case grows: $x\\cos2x$ against a bounded PI", "stars": 3,
     "srcs": ["S004·5", "S004·16"], "flags": [ADD],
     "howto": "With $(D^2+4)y=\\sin2x$ the frequency 2 is in the CF, so the PI is $-\\frac{x\\cos2x}{4}$ (vermilion): an oscillation whose envelope "
              "$\\pm\\frac x4$ (grey dashed) grows linearly. With $\\sin x$ instead ($f(-1)=3\\neq0$) the PI $\\frac{\\sin x}{3}$ (blue) stays bounded."},
    {"id": "G3.1", "topic": "T3", "title": "$\\sin^2x$ is a constant plus a cosine of double frequency", "stars": 2,
     "srcs": ["S004·7", "S004·17"], "flags": [ADD],
     "howto": "$\\sin^2x$ (blue) never goes negative and has period $\\pi$. It is the constant $\\frac12$ (green dashed, a Type 1 term with $a=0$) "
              "plus $-\\frac12\\cos2x$ (vermilion dashed, a Type 2 term with $a=2$, not 1). Each part gets its own rule; the two PIs are added."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "The Type 2 fork: does $f(-a^2)$ vanish?", "stars": 3,
     "srcs": ["S004·4", "S004·5", "T004 00:01:15", "T004 00:11:48", "T004b 00:07:32"], "layout": "fork", "maxw": "160mm",
     "spec": {"before": [{"kind": "given", "title": "$\\frac{1}{f(D)}\\sin(ax+b)$ or $\\cos(ax+b)$", "sub": "read $a$; $b$ is irrelevant"},
                         {"kind": "step", "n": 1, "title": "Replace $D^2$ by $-a^2$", "fx": "$D^3=D^2D\\to-a^2D$, $D^4\\to a^4$"}],
              "question": "Is the denominator zero?",
              "no": {"kind": "step", "n": 2, "title": "Lone $D$ left? Rationalise", "fx": "$\\frac{1}{p+qD}=\\frac{p-qD}{p^2+q^2a^2}$"},
              "yes": {"kind": "step", "n": 2, "title": "Failure: write $x$, use $f'(D)$", "fx": "$x\\frac{X}{f'(D)}$, then $D^2\\to-a^2$"},
              "after": [{"kind": "step", "n": 3, "title": "Let the operator act", "fx": "$D$ differentiates, $\\frac1D$ integrates"},
                        {"kind": "result", "title": "PI", "fx": "same frequency $a$ (times $x$ on failure)"}]},
     "remark": "The CF warns you: if $\\pm ai$ are AE roots, the answer is “yes”.",
     "trap": "$-a^2$, not $(-a)^2$."},
    {"id": "F2.1", "topic": "T2", "title": "The Type 2 ladder", "stars": 3,
     "srcs": ["S004·4", "S004·5", "S004·6", "S004·15", "T004 00:04:04", "T004 00:05:06"], "layout": "ladder", "maxw": "165mm",
     "spec": {"start": {"kind": "given", "title": "$\\frac{1}{f(D^2)}\\sin(ax+b)$", "sub": "same for $\\cos(ax+b)$"},
              "rungs": [{"q": "Is $f(-a^2)\\neq0$?", "yes": {"lab": "", "title": "PI $=\\frac{\\sin(ax+b)}{f(-a^2)}$", "sub": "$\\pm ai$ not AE roots"}},
                        {"q": "Is $f'(-a^2)\\neq0$?", "yes": {"lab": "", "title": "PI $=x\\frac{\\sin(ax+b)}{f'(-a^2)}$", "sub": "$D^2+a^2$ a simple factor"}},
                        {"q": "Is $f''(-a^2)\\neq0$?", "yes": {"lab": "", "title": "PI $=x^2\\frac{\\sin(ax+b)}{f''(-a^2)}$", "sub": "repeated factor"}}],
              "last": {"kind": "result", "title": "PI $=x^3\\frac{\\sin(ax+b)}{f'''(-a^2)}$, and so on", "fx": "one more $x$ per failure"}},
     "remark": "Derivatives are with respect to $D$; any odd $D$ left is rationalised or, if alone, integrated ($\\frac1D$).",
     "trap": "Slide 004·15 writes $f'(a)$; read $f'(-a^2)$."},
    {"id": "F2.2", "topic": "T2", "title": "ESA: $(D-2)^2y=8(e^{2x}+\\sin2x)$", "stars": 3,
     "srcs": ["ESA Dec-23 3a", "ESA May-24 3b", "ESA Jun-24 2a"], "layout": "streams", "maxw": "165mm",
     "spec": {"left": [{"kind": "given", "title": "PI$_1=\\frac{8e^{2x}}{(D-2)^2}$", "sub": "Type 1, $a=2$"},
                       {"kind": "step", "n": 1, "title": "$f(2)=f'(2)=0$", "fx": "$f''=2$"},
                       {"kind": "step", "n": 2, "title": "Double failure", "fx": "PI$_1=4x^2e^{2x}$"}],
              "right": [{"kind": "given", "title": "PI$_2=\\frac{8\\sin2x}{D^2-4D+4}$", "sub": "Type 2, $a=2$"},
                        {"kind": "step", "n": 1, "title": "$D^2\\to-4$", "fx": "$\\frac{8\\sin2x}{-4D}$"},
                        {"kind": "step", "n": 2, "title": "$\\frac1D$ integrates", "fx": "PI$_2=\\cos2x$"}],
              "then": [{"kind": "result", "title": "$y=(c_1+c_2x)e^{2x}+4x^2e^{2x}+\\cos2x$", "fx": "CF from $m=2,2$"}]},
     "remark": "No rationalising is needed: the denominator is a pure $D$, so $\\frac{1}{-4D}$ is just $-\\frac14\\int$."},
    {"id": "F3.1", "topic": "T3", "title": "Reduce $X$ to Type 2 first", "stars": 3,
     "srcs": ["S004·7", "T004 00:05:24", "T004 00:06:12", "T004 00:20:36"], "layout": "route", "maxw": "165mm",
     "spec": {"question": "What is the trigonometric term of $X$?",
              "rows": [{"title": "$\\sin(ax+b)$, $\\cos(ax+b)$", "sub": "use the rule directly", "kw": "E1.1"},
                       {"title": "$\\sin ax\\cos bx$, $\\cos ax\\cos bx$, $\\sin ax\\sin bx$", "sub": "product to sum", "kw": "E3.1"},
                       {"title": "$\\sin^2ax$, $\\cos^2ax$", "sub": "constant $+\\frac12\\cos2ax$", "kw": "E3.2"},
                       {"title": "$\\sin^3ax$, $\\cos^3ax$", "sub": "frequencies $a$ and $3a$", "kw": "E3.3"},
                       {"title": "plus $e^{ax}$, constants", "sub": "Type 1 for those terms", "kw": "E3.4", "dashed": True}]},
     "remark": "After rewriting, every term is either Type 1 ($D\\to a$) or Type 2 ($D^2\\to-a^2$); add the PIs."},
]

COMPARISONS = [
    {"id": "C1.1", "topic": "T1", "title": "Type 1 and Type 2 side by side", "srcs": ["S004·4", "S004·5", "T004b 00:00:41", "T004b 00:06:12"],
     "head": ["", "Type 1: $X=e^{ax}$", "Type 2: $X=\\sin(ax+b)$, $\\cos(ax+b)$"],
     "rows": [["Replace", "$D$ by $a$", "$D^2$ by $-a^2$ (odd $D$ kept, then rationalised)"],
              ["PI (no failure)", "$\\frac{e^{ax}}{f(a)}$", "$\\frac{X}{f(-a^2)}$"],
              ["Fails when", "$a$ is an AE root", "$\\pm ai$ are AE roots ($D^2+a^2$ divides $f$)"],
              ["First failure", "$x\\frac{e^{ax}}{f'(a)}$", "$x\\frac{X}{f'(-a^2)}$"],
              ["Second failure", "$x^2\\frac{e^{ax}}{f''(a)}$", "$x^2\\frac{X}{f''(-a^2)}$"]]},
    {"id": "C3.1", "topic": "T3", "title": "Identities that reduce $X$ to Type 2", "srcs": ["S004·7", "T004 00:05:42", "T004 00:06:23"], "flags": [ADD],
     "head": ["$X$", "Rewrite as", "Rule for each term"],
     "rows": [["$\\sin ax\\cos bx$", "$\\frac12[\\sin(a+b)x+\\sin(a-b)x]$", "Type 2 at $a+b$ and $a-b$"],
              ["$\\cos ax\\cos bx$", "$\\frac12[\\cos(a+b)x+\\cos(a-b)x]$", "Type 2 at $a+b$ and $a-b$"],
              ["$\\sin ax\\sin bx$", "$\\frac12[\\cos(a-b)x-\\cos(a+b)x]$", "Type 2 at $a-b$ and $a+b$"],
              ["$\\sin^2ax$", "$\\frac12-\\frac12\\cos2ax$", "Type 1 ($D\\to0$) + Type 2 at $2a$"],
              ["$\\cos^2ax$", "$\\frac12+\\frac12\\cos2ax$", "Type 1 ($D\\to0$) + Type 2 at $2a$"],
              ["$\\sin^3ax$", "$\\frac34\\sin ax-\\frac14\\sin3ax$", "Type 2 at $a$ and $3a$"],
              ["$\\cos^3ax$", "$\\frac34\\cos ax+\\frac14\\cos3ax$", "Type 2 at $a$ and $3a$"]]},
    {"id": "C3.2", "topic": "T3", "title": "The Type 2 term inside every ESA question", "flags": [ADD],
     "srcs": ["ESA Dec-23 3a", "ESA May-24 3b", "ESA Jun-24 2a", "ESA Jul-23 3b", "ESA Jan-24 s1 2d", "ESA Jan-24 s3 2c", "ESA Jan-24 s4 2c"],
     "head": ["Paper, Q", "$f(D)$", "Type 2 term", "Its PI", "Full solution"],
     "rows": [["Dec-23 3a (= May-24 3b, Jun-24 2a)", "$(D-2)^2$", "$8\\sin2x$", "$\\cos2x$ (W2.3)", "here, W2.3"],
              ["Jul-23 3b", "$D^2-5D+6$", "$\\sin x$", "$\\frac{\\sin x+\\cos x}{10}$ (W1.3)", "class 005"],
              ["Jan-24 s1 2d", "$D^2+4$", "$\\cos2x$", "$\\frac{x\\sin2x}{4}$, failure (W2.2)", "class 005"],
              ["Jan-24 s3 2c", "$D^3-2D^2+D$", "$\\sin^2x$", "$\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$ (W3.2)", "class 006"],
              ["Jan-24 s4 2c", "$(D-1)^2(D+1)^2$", "$\\sin^2\\frac x2$", "$\\frac12-\\frac{\\cos x}{8}$ (W3.5)", "class 005"]]},
]

SYMBOLS = [
    {"sym": "$D$", "name": "Differential operator", "meaning": "$\\frac{d}{dx}$; $\\frac1D$ = integration without a constant", "where": "E1.2, E2.1"},
    {"sym": "$f(D)$, $f(D^2)$", "name": "Operator polynomial", "meaning": "$f(D^2)$: $f(D)$ written through $D^2$ where possible", "where": "E1.1"},
    {"sym": "$f(-a^2)$", "name": "Replaced denominator", "meaning": "Every $D^2$ replaced by $-a^2$ (minus $a$ squared)", "where": "E1.1, E2.1"},
    {"sym": "$f'(D)$, $f''(D)$", "name": "Derivatives w.r.t. $D$", "meaning": "Used in the failure cases; slide 004·15 writes $f'(a)$", "where": "E2.1, E2.3"},
    {"sym": "$a$", "name": "Frequency", "meaning": "In $\\sin(ax+b)$; not the exponent of Type 1 (same letter)", "where": "E1.1"},
    {"sym": "$b$", "name": "Phase constant", "meaning": "Never enters the rule", "where": "E1.1"},
    {"sym": "$p+qD$", "name": "Linear remainder", "meaning": "What is left after $D^2\\to-a^2$; rationalised with $p-qD$", "where": "E1.3"},
    {"sym": "PI$_1$, PI$_2$", "name": "Partial PIs", "meaning": "PIs of the separate terms of $X$", "where": "E3.4"},
    {"sym": "$X$", "name": "Right-hand side", "meaning": "A function of $x$; capital $X$, small $x$", "where": "E1.1"},
]

KEYWORDS = [
    {"term": "Type 2", "meaning": "$X=\\sin(ax+b)$ or $\\cos(ax+b)$.", "topic": "T1"},
    {"term": "$D^2\\to-a^2$", "meaning": "The Type 2 replacement; minus $a$ squared.", "topic": "T1"},
    {"term": "$f(-a^2)$", "meaning": "Denominator after the replacement.", "topic": "T1"},
    {"term": "Odd powers", "meaning": "$D^3=D^2\\cdot D$, $D^5=(D^2)^2D$.", "topic": "T1"},
    {"term": "Rationalise", "meaning": "Multiply by the conjugate $p-qD$.", "topic": "T1"},
    {"term": "Operator on the left", "meaning": "The function stays to the right of every operator.", "topic": "T1"},
    {"term": "Phase shift", "meaning": "PI $=A\\cos+B\\sin$ at the same frequency.", "topic": "T1"},
    {"term": "Case of failure", "meaning": "$f(-a^2)=0$.", "topic": "T2"},
    {"term": "$D^2+a^2$ factor", "meaning": "Why $f(-a^2)=0$; $\\pm ai$ in the CF.", "topic": "T2"},
    {"term": "Multiply by $x$", "meaning": "$x\\frac{X}{f'(-a^2)}$, $f'$ w.r.t. $D$.", "topic": "T2"},
    {"term": "$\\frac1D$", "meaning": "Integration, no constant.", "topic": "T2"},
    {"term": "Resonance", "meaning": "PI $\\propto x\\sin$, $x\\cos$: grows.", "topic": "T2"},
    {"term": "Standard result", "meaning": "$\\frac{\\cos ax}{D^2+a^2}=\\frac{x\\sin ax}{2a}$.", "topic": "T2"},
    {"term": "Factor by factor", "meaning": "Apply the non-failing factor first.", "topic": "T2"},
    {"term": "Transformation formula", "meaning": "Product to sum.", "topic": "T3"},
    {"term": "Half-angle identity", "meaning": "$\\sin^2=\\frac{1-\\cos2ax}{2}$.", "topic": "T3"},
    {"term": "Triple-angle identity", "meaning": "$\\sin^3A=\\frac{3\\sin A-\\sin3A}{4}$.", "topic": "T3"},
    {"term": "Constant term", "meaning": "$ke^{0x}$: Type 1 with $D\\to0$.", "topic": "T3"},
    {"term": "Superposition", "meaning": "PI $=$ PI$_1+$PI$_2+\\dots$", "topic": "T3"},
]

RAPID = [
    {"q": "Type 2 rule?", "a": "$\\frac{\\sin(ax+b)}{f(D^2)}=\\frac{\\sin(ax+b)}{f(-a^2)}$, $f(-a^2)\\neq0$."},
    {"q": "For $\\cos2x$, $D^2$ becomes?", "a": "$-4$ (not $+4$)."},
    {"q": "$D^3$ for $\\sin3x$?", "a": "$D^2\\cdot D\\to-9D$."},
    {"q": "How to remove a lone $D$ in $\\frac{1}{p+qD}$?", "a": "Multiply by $p-qD$: $\\frac{p-qD}{p^2-q^2D^2}$."},
    {"q": "$\\frac{\\cos(2x+3)}{D^3+1}$?", "a": "$\\frac{\\cos(2x+3)-8\\sin(2x+3)}{65}$."},
    {"q": "$\\frac{\\sin3x}{D^3-D^2+4D-4}$ (CW P13)?", "a": "$\\frac{3\\cos3x+\\sin3x}{50}$."},
    {"q": "When does $f(-a^2)=0$?", "a": "When $D^2+a^2$ is a factor of $f(D)$ ($\\pm ai$ AE roots)."},
    {"q": "PI on failure?", "a": "$x\\frac{X}{f'(-a^2)}$, $f'$ w.r.t. $D$."},
    {"q": "$\\frac{\\cos\\sqrt3x}{D^2+3}$?", "a": "$\\frac{x\\sin\\sqrt3x}{2\\sqrt3}$."},
    {"q": "$\\frac{\\sin ax}{D^2+a^2}$?", "a": "$-\\frac{x\\cos ax}{2a}$."},
    {"q": "$\\frac{\\cos ax}{D^2+a^2}$?", "a": "$\\frac{x\\sin ax}{2a}$."},
    {"q": "Solve $(D-2)^2y=8(e^{2x}+\\sin2x)$?", "a": "$y=(c_1+c_2x)e^{2x}+4x^2e^{2x}+\\cos2x$."},
    {"q": "$\\frac{8\\sin2x}{(D-2)^2}$?", "a": "$\\frac{8\\sin2x}{-4D}=\\cos2x$."},
    {"q": "$\\sin^2x$ rewritten?", "a": "$\\frac{1-\\cos2x}{2}$."},
    {"q": "Constant part of $\\frac{\\cos^2(x/2)}{(D-1)^2(D^2+1)}$?", "a": "$\\frac12$ (slide 004·14 prints $\\frac14$)."},
    {"q": "PI of $(D-1)^2(D^2+1)y=e^x+\\cos^2\\frac x2$?", "a": "$\\frac{x^2e^x}{4}+\\frac12+\\frac{x\\cos x}{8}$."},
    {"q": "PI of $(D^3-2D^2+D)y=\\sin^2x$?", "a": "$\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$ (slide drops a 2)."},
    {"q": "$\\sin^3x$ rewritten?", "a": "$\\frac{3\\sin x-\\sin3x}{4}$."},
]

MNEMONICS = [
    "<i>“Square goes negative, odd D gets a partner.”</i> $D^2\\to-a^2$; a lone $D$ is rationalised with its conjugate (study aid).",
]

TOP_FACTS = [
    "Type 2: $\\frac{X}{f(D^2)}=\\frac{X}{f(-a^2)}$; replace $D^2$ by $-a^2$ (minus $a$ squared), $D^3=D^2D$.",
    "Lone $D$ left: multiply by the conjugate, $\\frac{1}{p+qD}=\\frac{p-qD}{p^2+q^2a^2}$; the numerator differentiates $X$.",
    "Failure $f(-a^2)=0$ ($D^2+a^2$ divides $f$): PI $=x\\frac{X}{f'(-a^2)}$; $\\frac{\\cos ax}{D^2+a^2}=\\frac{x\\sin ax}{2a}$, $\\frac{\\sin ax}{D^2+a^2}=-\\frac{x\\cos ax}{2a}$.",
    "$\\frac1D$ = integrate (no constant); the $x$ stays outside.",
    "ESA ×3: $(D-2)^2y=8(e^{2x}+\\sin2x)$ ⇒ $y=(c_1+c_2x)e^{2x}+4x^2e^{2x}+\\cos2x$.",
    "Products → sums; $\\sin^2,\\cos^2$ → $\\frac12\\mp\\frac12\\cos2ax$ (the constant is Type 1, $D\\to0$); $\\sin^3A=\\frac{3\\sin A-\\sin3A}{4}$.",
    "Slide slips: 004·14 constant is $\\frac12$ (not $\\frac14$); 004·17 PI is $\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$.",
]
TOP_FORMULAS = ["E1.1", "E1.3", "E2.1", "E2.2", "E3.2", "E3.4"]
