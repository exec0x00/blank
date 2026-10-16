"""Unit 2, class 006: particular integral, Type 4 (X = e^{ax}V, exponential shift) and Type 5 (X = xV)."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "The Type 4 rule: $X=e^{ax}V$ (exponential shift)",
     "overview": r"When the right-hand side is a product $e^{ax}V$, with $V$ a function of $x$, the exponential can be pulled out of the inverse "
                 r"operator to the left, provided every $D$ in $f(D)$ is replaced by $D+a$: $\frac{1}{f(D)}(e^{ax}V)=e^{ax}\frac{1}{f(D+a)}V$. "
                 r"The new operator acts on $V$ alone, so the problem drops back to a type already known: Type 2 when $V$ is a sine or cosine, "
                 r"Type 3 when $V$ is a polynomial, plain integration when $f(D+a)$ is a power of $D$. This topic takes $V=\sin bx$ or $\cos bx$."},
    {"id": "T2", "title": "Type 4 with a polynomial: $x^me^{ax}$ and mixed right-hand sides",
     "overview": r"When $V$ is a polynomial ($x^2e^{3x}$, $xe^{3x}$, $x^2e^{-x}$), the shifted operator $\frac{1}{f(D+a)}$ is expanded in ascending "
                 r"powers of $D$ exactly as in Type 3, up to $D^m$. If the shift leaves only $D^k$ (because $a$ is a $k$-fold root of the AE), "
                 r"$\frac{1}{D^k}$ is $k$ integrations without constants. The one ESA question on Type 4 (Jan-24 set 3 2c, = CW P18) mixes "
                 r"$x^2e^{-x}$ with $\sin^2x$; each term gets its own rule and the PIs are added."},
    {"id": "T3", "title": "The Type 5 rule: $X=xV$",
     "overview": r"When $X$ is $x$ times a function $V$ (in practice $x\sin ax$ or $x\cos ax$), slide 006·4 gives "
                 r"$\frac{1}{f(D)}(xV)=\big[\frac{x}{f(D)}-\frac{f'(D)}{(f(D))^2}\big]V$: find $\frac{1}{f(D)}V$ and multiply it by $x$, then "
                 r"subtract $\frac{f'(D)}{(f(D))^2}V$, both by the Type 2 rule. The deck states the rule but works no example; the class-work sheet "
                 r"has two (P19, P20). A shorter route, added for clarity, writes $x\sin ax=\text{Im}(xe^{iax})$ and uses Type 4 with $V=x$."},
]

DEFS = [
    {"topic": "T1", "term": "Type 4 right-hand side", "text": "$X=e^{ax}V$, where $V$ is a function of $x$ (in the problems: $\\sin bx$, $\\cos bx$, a "
     "polynomial, or a product such as $x\\cos x$).", "srcs": ["S006·3", "S006·4", "S006·10", "T006 00:00:00"]},
    {"topic": "T1", "term": "Exponential shift", "text": "Moving $e^{ax}$ from the right of $\\frac{1}{f(D)}$ to its left while replacing $D$ by $D+a$: "
     "“$e^{ax}$ can be taken outside the operator by replacing $D$ by $D+a$ in $f(D)$”.", "srcs": ["S006·4", "T006 00:01:00"]},
    {"topic": "T1", "term": "$a$", "text": "The coefficient of $x$ in the exponential factor: $a=1$ for $e^x$, $a=3$ for $e^{3x}$, $a=-1$ for $e^{-x}$.",
     "srcs": ["T006 00:01:18", "T006b 00:12:13"]},
    {"topic": "T1", "term": "$f(D+a)$", "text": "The shifted operator: $f(D)$ with every $D$ replaced by $D+a$, then expanded and simplified "
     "(e.g. $D^2-2D+4\\to(D+1)^2-2(D+1)+4=D^2+3$).", "srcs": ["S006·6", "T006 00:03:41"]},
    {"topic": "T2", "term": "$\\frac{1}{D^k}$", "text": "$k$ successive integrations with respect to $x$, “without writing the constant of integration”.",
     "srcs": ["S006·8", "S006·9", "T006 00:06:58", "T006 00:07:16"]},
    {"topic": "T3", "term": "Type 5 right-hand side", "text": "$X=xV$, where $V$ is a function of $x$ (in the problems: $\\sin ax$ or $\\cos ax$).",
     "srcs": ["S006·4", "T006 00:01:28"]},
    {"topic": "T3", "term": "$f'(D)$", "text": "The derivative of the polynomial $f(D)$ with respect to $D$: for $f(D)=D^2-5D+6$, $f'(D)=2D-5$.",
     "srcs": ["S006·4", "T006 00:01:28"]},
]

STATEMENTS = [
    {"topic": "T1", "text": "Type (iv); When $X=e^{ax}V$, where $V$ is a function of $x$: $\\frac{1}{f(D)}(e^{ax}V)=e^{ax}\\frac{1}{f(D+a)}V$.",
     "srcs": ["S006·4"]},
    {"topic": "T1", "text": "When $X=e^{ax}V$, $V$ being a function of $x$, the particular integral is given by "
     "$y_p=\\text{P.I.}=\\frac{1}{f(D)}e^{ax}V(x)=e^{ax}\\frac{1}{f(D+a)}V(x)=e^{ax}[f(D+a)]^{-1}V(x)$ where $V(x)$ is of some particular form.",
     "srcs": ["S006·10"]},
    {"topic": "T3", "text": "Type (v); When $X=xV$ where $V$ is a function of $x$: $\\frac{1}{f(D)}(xV)=\\Big[\\frac{x}{f(D)}-\\frac{f'(D)}{(f(D))^2}\\Big]V$.",
     "srcs": ["S006·4"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Type 4: the exponential shift", "tex": r"\frac{1}{f(D)}\big(e^{ax}V\big)=e^{ax}\,\frac{1}{f(D+a)}\,V=e^{ax}\big[f(D+a)\big]^{-1}V",
     "gives": "The PI of $e^{ax}$ times any function $V$.", "when": "$X=e^{ax}V$; $a$ = coefficient of $x$ in the exponent.",
     "note": "Write $e^{ax}$ to the left first, then replace every $D$ by $D+a$; $V$ is untouched.", "stars": 2,
     "srcs": ["S006·4", "S006·10", "T006 00:00:52", "T006 00:01:00", "T006b 00:10:19", "ESA Jan-24 s3 2c"]},
    {"id": "E1.2", "topic": "T1", "title": "Why it works: $D$ past $e^{ax}$", "tex": r"D\big(e^{ax}V\big)=e^{ax}(D+a)V,\qquad f(D)\big(e^{ax}V\big)=e^{ax}f(D+a)V",
     "gives": "The shift rule in the forward direction; inverting both sides gives E1.1.", "when": "Product rule, repeated.",
     "note": "$D^2(e^{ax}V)=e^{ax}(D+a)^2V$, and so on for every power.", "stars": 1, "srcs": ["S006·4"], "flags": [ADD]},
    {"id": "E1.3", "topic": "T1", "title": "Then $V=\\sin bx$ or $\\cos bx$ (Type 2)", "tex": r"e^{ax}\frac{1}{f(D+a)}\cos bx:\quad D^2\to-b^2\ \text{in } f(D+a)",
     "gives": "The second half of the work when $V$ is trigonometric.", "when": "After the shift; rationalise a leftover $D$ (class 004).",
     "note": "Use $b$ of $V$, not $a$ of the exponential: $e^x\\cos x$: $D^2\\to-1$.", "stars": 2,
     "srcs": ["S006·6", "T006 00:04:20", "T006b 00:10:53", "CW U2 P17"]},
    {"id": "E1.4", "topic": "T1", "title": "The Type 1 failure rule is a shift", "tex": r"\frac{e^{ax}}{(D-a)^k\,\psi(D)}=e^{ax}\frac{1}{D^k\,\psi(D+a)}\,1=\frac{x^k}{k!}\,\frac{e^{ax}}{\psi(a)}",
     "gives": "Why $a$ being a $k$-fold AE root brings in $x^k$.", "when": "$V=1$ and $f(a)=0$ ($\\psi(a)\\neq0$).",
     "note": "Same answer as $x\\frac{e^{ax}}{f'(a)}$, $x^2\\frac{e^{ax}}{f''(a)}$ of class 003.", "stars": 1, "srcs": ["S006·14"], "flags": [ADD]},
    {"id": "E2.1", "topic": "T2", "title": "Then $V=x^m$ (Type 3)", "tex": r"\frac{1}{f(D)}\big(x^me^{ax}\big)=\frac{e^{ax}}{b_0}\big[1\pm\varphi(D)\big]^{-1}x^m,\quad f(D+a)=b_0\big[1\pm\varphi(D)\big]",
     "gives": "The PI of a polynomial times an exponential.", "when": "After the shift, $f(D+a)$ has a constant term $b_0=f(a)\\neq0$.",
     "note": "Expand up to $D^m$ only (class 005 series). The PI is $e^{ax}$ times a polynomial of degree $m$.", "stars": 2,
     "srcs": ["S006·11", "S006·12", "T006b 00:12:47", "T006b 00:13:06", "T006 00:12:09", "CW U2 P18"]},
    {"id": "E2.2", "topic": "T2", "title": "When the shift leaves only $D^k$", "tex": r"\frac{1}{(D-a)^k}\big(e^{ax}V\big)=e^{ax}\frac{1}{D^k}V=e^{ax}\underbrace{\int\!\!\cdots\!\!\int}_{k}V\,dx\cdots dx",
     "gives": "The PI by $k$ integrations (no constants).", "when": "$f(D)=(D-a)^k$, e.g. $D^2-2D+1=(D-1)^2$ with $a=1$.",
     "note": "Integrate by parts for $x\\cos x$; “without writing the constant of integration, that is very important”.", "stars": 2,
     "srcs": ["S006·8", "S006·9", "S006·14", "T006 00:06:40", "T006 00:07:16", "T006b 00:14:42"]},
    {"id": "E2.3", "topic": "T2", "title": "Integration by parts (for $\\frac1D$ of $x\\cos x$, $x\\sin x$)", "tex": r"\int uv\,dx=u\int v\,dx-\int\Big(\int v\,dx\Big)u'\,dx",
     "gives": "$\\int x\\cos x\\,dx=x\\sin x+\\cos x$, $\\int x\\sin x\\,dx=-x\\cos x+\\sin x$.", "when": "$\\frac1D$ of $x$ times a sine or cosine.",
     "note": "Slide 006·9 integrates $x\\sin x$ instead of $x\\cos x$ (gap list).", "stars": 2, "srcs": ["S006·9", "T006 00:07:34", "T006 00:09:11"]},
    {"id": "E2.4", "topic": "T2", "title": "Superposition", "tex": r"\frac{1}{f(D)}(X_1+X_2)=\frac{1}{f(D)}X_1+\frac{1}{f(D)}X_2=\text{PI}_1+\text{PI}_2",
     "gives": "The PI of a mixed right-hand side.", "when": "$X$ = a Type 4 term plus a Type 1, 2 or 3 term.",
     "note": "Each term chooses its own rule; see the class 005 pack for more mixed questions.", "stars": 2,
     "srcs": ["T006 00:10:40", "ESA Jan-24 s3 2c", "CW U2 P18"]},
    {"id": "E2.5", "topic": "T2", "title": "Reminder: $\\sin^2x$ and a factor $D$", "tex": r"\sin^2x=\frac{1-\cos2x}{2},\qquad \frac{1}{D\,\psi(D)}\,k=\frac{kx}{\psi(0)}",
     "gives": "The constant part of $\\sin^2x$ when $D$ is a factor of $f(D)$.", "when": "ESA Jan-24 s3 2c: $f(D)=D(D-1)^2$.",
     "note": "Taught in the class 004 and 005 packs.", "stars": 2, "srcs": ["ESA Jan-24 s3 2c", "CW U2 P18"]},
    {"id": "E3.1", "topic": "T3", "title": "Type 5: $X=xV$", "tex": r"\frac{1}{f(D)}(xV)=\left[\frac{x}{f(D)}-\frac{f'(D)}{\big(f(D)\big)^2}\right]V=x\,\frac{1}{f(D)}V-\frac{f'(D)}{\big(f(D)\big)^2}V",
     "gives": "The PI of $x$ times a function (usually $x\\sin ax$, $x\\cos ax$).", "when": "$X=xV$; $f'(D)=\\frac{d}{dD}f(D)$.",
     "note": "$\\frac{x}{f(D)}V$ means: apply $\\frac{1}{f(D)}$ to $V$, then multiply by $x$.", "stars": 2,
     "srcs": ["S006·4", "T006 00:01:28", "CW U2 P19", "CW U2 P20"]},
    {"id": "E3.2", "topic": "T3", "title": "Where Type 5 comes from", "tex": r"f(D)(xU)=x\,f(D)U+f'(D)U\ \Rightarrow\ \frac{1}{f(D)}(xV)=x\frac{1}{f(D)}V-\frac{1}{f(D)}f'(D)\frac{1}{f(D)}V",
     "gives": "E3.1, with $U=\\frac{1}{f(D)}V$; constant-coefficient operators commute, so the last term is $\\frac{f'(D)}{(f(D))^2}V$.",
     "when": "Leibniz: $D^n(xU)=xD^nU+nD^{n-1}U$.", "note": "Not on the slides.", "stars": 1, "srcs": ["S006·4"], "flags": [ADD]},
    {"id": "E3.3", "topic": "T3", "title": "Shortcut: $x\\sin ax$ as an imaginary part", "tex": r"\frac{1}{f(D)}\,x\sin ax=\text{Im}\Big[e^{iax}\frac{1}{f(D+ia)}\,x\Big],\qquad \frac{1}{f(D)}\,x\cos ax=\text{Re}\Big[\dots\Big]",
     "gives": "The same PI by Type 4 (with $a\\to ia$) and Type 3 ($V=x$).", "when": "$f(D)$ has real coefficients.",
     "note": "Only for checking or for fast work; the slide method is E3.1.", "stars": 1, "srcs": ["S006·4", "CW U2 P19", "CW U2 P20"], "flags": [ADD]},
]

POINTS = [
    {"topic": "T1", "text": "Recognise Type 4: $X$ is a product with an exponential factor, “$e^{ax}$ into $V$” ($e^x\\cos x$, $x^2e^{3x}$, $e^{2x}\\cos x$). "
     "“If $x^2$ is not there, case 1; if $e^{3x}$ is not there, case 3; both are there, so case 4”.", "stars": 2,
     "srcs": ["T006 00:00:18", "T006b 00:11:45", "S006·10"]},
    {"topic": "T1", "text": "Write $e^{ax}$ to the <b>left</b> of the operator and replace <b>every</b> $D$ in $f(D)$ by $D+a$; leave $V$ as it is.", "stars": 2,
     "srcs": ["S006·4", "T006 00:01:00", "T006b 00:10:19"]},
    {"topic": "T1", "text": "Expand and simplify $f(D+a)$ before doing anything else: $(D+1)^2-2(D+1)+4=D^2+3$; $(D+1)^2-2(D+1)+1=D^2$.", "stars": 2,
     "srcs": ["S006·6", "S006·8", "T006 00:03:58", "T006 00:06:23"]},
    {"topic": "T1", "text": "After the shift, the rule is chosen by $V$ alone: $\\sin$/$\\cos$ → Type 2; polynomial → Type 3; $f(D+a)=D^k$ → integrate $k$ times.",
     "stars": 2, "srcs": ["T006b 00:10:40", "T006b 00:10:53", "T006 00:04:20", "T006 00:12:09"]},
    {"topic": "T1", "text": "In Type 2 after the shift, $D^2\\to-b^2$ uses $b$ from $V=\\cos bx$, not $a$ from $e^{ax}$: $\\frac{e^x\\cos x}{D^2+3}\\to\\frac{e^x\\cos x}{-1+3}$.",
     "stars": 2, "srcs": ["S006·6", "T006 00:04:20", "CW U2 P17"]},
    {"topic": "T1", "text": "The shift handles failure by itself: if $a$ is a root of the AE, $f(D+a)$ has a factor $D$, and $\\frac1D$ integrates "
     "(slide 006·14: $(D-1)^2\\to D^2$).", "stars": 2, "srcs": ["S006·14", "T006b 00:14:22"]},
    {"topic": "T1", "text": "“Find the general solution” needs $y=y_c+y_p$ written out: “this is must”.", "stars": 2,
     "srcs": ["T006 00:09:28", "S006·6", "S006·9"]},
    {"topic": "T2", "text": "For $x^me^{ax}$, take the constant $f(a)$ out of $f(D+a)$ and expand $[1\\pm\\varphi(D)]^{-1}$ up to $D^m$ (class 005 rule).",
     "stars": 2, "srcs": ["S006·11", "S006·12", "T006b 00:12:47", "T006 00:12:25"]},
    {"topic": "T2", "text": "Stop the series at the degree of the polynomial: for $x^2$ keep $D^2$ (“$a^2$ is not needed, $b^2$ is needed, $2ab$ is not "
     "needed”); for $x$ keep only the $D$ term.", "stars": 2, "srcs": ["S006·12", "T006b 00:13:25", "T006 00:13:20"]},
    {"topic": "T2", "text": "$\\frac{1}{D^2}$ means integrate twice, with no constants (the constants are already in the CF).", "stars": 2,
     "srcs": ["S006·8", "T006 00:06:58", "T006 00:07:16"]},
    {"topic": "T2", "text": "With a mixed $X$ (ESA Jan-24 s3 2c), split $X$, find PI$_1$ by the shift and PI$_2$ by Type 2, and add.", "stars": 2,
     "srcs": ["ESA Jan-24 s3 2c", "CW U2 P18", "T006 00:10:40"]},
    {"topic": "T2", "text": "Leading-term check: the PI of $x^me^{ax}$ starts with $\\frac{x^me^{ax}}{f(a)}$ when $f(a)\\neq0$ ($\\frac{x^2e^{3x}}{11}$, "
     "$-\\frac{x^2e^{-x}}{4}$).", "stars": 1, "srcs": ["S006·12", "CW U2 P18"], "flags": [ADD]},
    {"topic": "T3", "text": "Type 5: $\\frac{1}{f(D)}(xV)=x\\frac{1}{f(D)}V-\\frac{f'(D)}{(f(D))^2}V$. Two Type 2 computations: first $\\frac{V}{f(D)}$, "
     "then $\\frac{f'(D)V}{(f(D))^2}$.", "stars": 2, "srcs": ["S006·4", "T006 00:01:28", "CW U2 P19", "CW U2 P20"]},
    {"topic": "T3", "text": "In $\\frac{f'(D)}{(f(D))^2}V$, replace $D^2$ by $-a^2$ in $(f(D))^2$ after squaring, then rationalise any leftover $D$.",
     "stars": 2, "srcs": ["CW U2 P20"], "flags": [ADD]},
    {"topic": "T3", "text": "Check with the complex shortcut: $x\\sin ax=\\text{Im}(xe^{iax})$, Type 4 with $a\\to ia$ and $V=x$.", "stars": 1,
     "srcs": ["CW U2 P19"], "flags": [ADD]},
]

WHY = [
    {"topic": "T1", "q": "Why does $D$ become $D+a$?",
     "a": "By the product rule $D(e^{ax}V)=e^{ax}(DV+aV)=e^{ax}(D+a)V$; applying this repeatedly, $f(D)(e^{ax}V)=e^{ax}f(D+a)V$. Reading this "
          "backwards for the inverse operator gives E1.1: to undo $f(D)$ on $e^{ax}V$, undo $f(D+a)$ on $V$.",
     "srcs": ["S006·4"], "flags": [ADD]},
    {"topic": "T1", "q": "Why does the shift resolve a failure case without a special rule?",
     "a": "If $a$ is a $k$-fold root of the AE, $f(D)=(D-a)^k\\psi(D)$, so $f(D+a)=D^k\\psi(D+a)$: the shifted operator has $D^k$ as a factor and "
          "the $k$ integrations produce the extra $x^k$. Slide 006·14 is an example: $(D-1)^2\\to D^2$.",
     "srcs": ["S006·14", "T006b 00:14:22"], "flags": [ADD]},
    {"topic": "T1", "q": "Why can Type 2 not be used directly on $e^x\\cos x$?",
     "a": "Type 2 replaces $D^2$ by $-b^2$ because $D^2\\cos bx=-b^2\\cos bx$; but $D^2(e^x\\cos x)=-2e^x\\sin x$ is not a multiple of $e^x\\cos x$. "
          "After the shift the operator acts on $\\cos x$ alone, where the substitution is valid.", "srcs": ["S006·6", "T006 00:03:23"], "flags": [ADD]},
    {"topic": "T3", "q": "Why is there a correction term $-\\frac{f'(D)}{(f(D))^2}V$?",
     "a": "Multiplying by $x$ does not commute with $D$: $D(xU)=xDU+U$. So $f(D)$ applied to $x\\frac{V}{f(D)}$ gives $xV$ plus the extra "
          "$f'(D)\\frac{V}{f(D)}$; the correction term removes that extra (E3.2).", "srcs": ["S006·4"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T2", "text": "Slide 006·9 (and T006 00:07:16) integrates $x\\sin x$ instead of $x\\cos x$; its answer $-e^x(x\\sin x+2\\cos x)$ is wrong. "
     "$\\frac{1}{D^2}(x\\cos x)=2\\sin x-x\\cos x$, so the PI is $e^x(2\\sin x-x\\cos x)$.", "srcs": ["S006·9", "T006 00:07:16"], "flags": [ADD]},
    {"topic": "T1", "text": "Slide 006·5 writes the CF as $e^x(c_1\\cos\\sqrt3x+c_1\\cos\\sqrt3x)$; it is $e^x(c_1\\cos\\sqrt3x+c_2\\sin\\sqrt3x)$.",
     "srcs": ["S006·5", "T006 00:03:06"], "flags": [ADD]},
    {"topic": "T1", "text": "Do not leave $e^{ax}$ inside: $\\frac{1}{f(D+a)}(e^{ax}V)$ is wrong; the exponential moves to the left and disappears from what the "
     "operator acts on.", "srcs": ["S006·4", "T006 00:01:00"]},
    {"topic": "T1", "text": "Replace every $D$, including the $D$ inside $-2D$ and $4D$: $D^2+4D+3\\to(D+2)^2+4(D+2)+3$, not $(D+2)^2+4D+3$.",
     "srcs": ["CW U2 P17", "S006·6"], "flags": [ADD]},
    {"topic": "T1", "text": "Do not put $D=a$ (Type 1) when $V$ is not a constant: that rule is only for $V=1$.", "srcs": ["S006·4"], "flags": [ADD]},
    {"topic": "T2", "text": "No constants of integration when evaluating $\\frac1D$: “that's very important”.", "srcs": ["T006 00:07:16"]},
    {"topic": "T2", "text": "Slide 004·17's boxed PI for the $\\sin^2x$ part of ESA Jan-24 s3 2c drops a factor 2; the correct part is "
     "$\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$ (class 004 pack, CW P18).", "srcs": ["ESA Jan-24 s3 2c", "CW U2 P18"], "flags": [ADD]},
    {"topic": "T3", "text": "$\\frac{x}{f(D)}V$ is $x\\cdot\\big(\\frac{1}{f(D)}V\\big)$, not $\\frac{1}{f(D)}(xV)$ (that is what you are trying to find).",
     "srcs": ["S006·4"], "flags": [ADD]},
    {"topic": "T3", "text": "Square $f(D)$ before substituting $D^2=-a^2$ is fine, but keep the cross term: $(2-5D)^2=4-20D+25D^2$, not $4+25D^2$.",
     "srcs": ["CW U2 P20"], "flags": [ADD]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "$\\frac{d^2y}{dx^2}-2\\frac{dy}{dx}+4y=e^x\\cos x$ (slides 006·5–6)", "stars": 2,
     "srcs": ["S006·5", "S006·6", "T006 00:01:55", "T006 00:04:34"],
     "given": "Find the general solution of $y''-2y'+4y=e^x\\cos x$, i.e. $(D^2-2D+4)y=e^x\\cos x$.",
     "steps": ["AE $m^2-2m+4=0$: $m=1\\pm\\sqrt3i$ ($\\alpha=1$, $\\beta=\\sqrt3$). CF $=e^x(c_1\\cos\\sqrt3x+c_2\\sin\\sqrt3x)$ (slide prints $c_1\\cos$ twice).",
               "PI $=\\frac{e^x\\cos x}{D^2-2D+4}=e^x\\frac{\\cos x}{(D+1)^2-2(D+1)+4}$ (shift, $a=1$).",
               "$(D+1)^2-2(D+1)+4=D^2+2D+1-2D-2+4=D^2+3$.",
               "Type 2: $D^2\\to-1^2$: PI $=e^x\\frac{\\cos x}{-1+3}=\\frac{e^x\\cos x}{2}$."],
     "answer": "$y=e^x(c_1\\cos\\sqrt3x+c_2\\sin\\sqrt3x)+\\dfrac{e^x\\cos x}{2}$",
     "check": "PI agrees with the slide; sympy dsolve and checkodesol agree. Figure G1.1."},
    {"id": "W1.2", "topic": "T1", "title": "$(D^2-2D+1)y=e^x\\sin x$: the shift handles the repeated root (slides 006·13–14)", "stars": 2,
     "srcs": ["S006·13", "S006·14", "T006b 00:14:02", "T006b 00:15:02"],
     "given": "Solve $(D^2-2D+1)y=e^x\\sin x$.",
     "steps": ["AE $m^2-2m+1=0$: $m=1,1$. CF $=(c_1+c_2x)e^x$.",
               "PI $=\\frac{e^x\\sin x}{(D-1)^2}=e^x\\frac{\\sin x}{(D+1-1)^2}=e^x\\frac{1}{D^2}\\sin x$.",
               "Integrate twice: $\\int\\sin x\\,dx=-\\cos x$, $\\int(-\\cos x)\\,dx=-\\sin x$. (Or Type 2: $D^2\\to-1$.)"],
     "answer": "$y=(c_1+c_2x)e^x-e^x\\sin x$",
     "check": "Slide answer agrees; sympy dsolve and checkodesol agree. $a=1$ is a double root, yet no failure rule was needed."},
    {"id": "W1.3", "topic": "T1", "title": "$(D^2+4D+3)y=e^{2x}\\cos x$ (CW P17)", "stars": 2, "srcs": ["CW U2 P17"],
     "given": "Solve $(D^2+4D+3)y=e^{2x}\\cos x$.",
     "steps": ["AE $(m+1)(m+3)=0$: CF $=c_1e^{-x}+c_2e^{-3x}$.",
               "PI $=e^{2x}\\frac{\\cos x}{(D+2)^2+4(D+2)+3}=e^{2x}\\frac{\\cos x}{D^2+8D+15}$.",
               "$D^2\\to-1$: $e^{2x}\\frac{\\cos x}{8D+14}=e^{2x}\\frac{(8D-14)\\cos x}{64D^2-196}=e^{2x}\\frac{(8D-14)\\cos x}{-260}$.",
               "$(8D-14)\\cos x=-8\\sin x-14\\cos x$: PI $=e^{2x}\\frac{8\\sin x+14\\cos x}{260}$."],
     "answer": "$y=c_1e^{-x}+c_2e^{-3x}+\\dfrac{e^{2x}(7\\cos x+4\\sin x)}{130}$",
     "check": "CW answer agrees; sympy dsolve and checkodesol agree."},
    {"id": "W1.4", "topic": "T1", "title": "$(D-2)^2y=e^{2x}$: the Type 1 failure case by the shift", "stars": 1, "srcs": ["S006·14"], "flags": [ADD],
     "given": "Find the PI of $(D-2)^2y=e^{2x}$ by the Type 4 rule ($V=1$).",
     "steps": ["$f(2)=0$, so Type 1 fails ($m=2$ is a double AE root).",
               "Shift: $e^{2x}\\frac{1}{(D+2-2)^2}1=e^{2x}\\frac{1}{D^2}1$.",
               "Integrate twice: $\\int1\\,dx=x$, $\\int x\\,dx=\\frac{x^2}{2}$."],
     "answer": "PI $=\\dfrac{x^2e^{2x}}{2}$",
     "check": "Same as the class 003 rule $x^2\\frac{e^{2x}}{f''(2)}=\\frac{x^2e^{2x}}{2}$; substituting back gives $e^{2x}$ (sympy)."},
    {"id": "W2.1", "topic": "T2", "title": "$(D^2+2)y=x^2e^{3x}$ (slides 006·11–12)", "stars": 2,
     "srcs": ["S006·11", "S006·12", "T006b 00:11:07", "T006b 00:13:44"],
     "given": "Solve $(D^2+2)y=x^2e^{3x}$.",
     "steps": ["AE $m^2+2=0$: $m=\\pm\\sqrt2i$. CF $=c_1\\cos\\sqrt2x+c_2\\sin\\sqrt2x$.",
               "PI $=e^{3x}\\frac{1}{(D+3)^2+2}x^2=e^{3x}\\frac{1}{D^2+6D+11}x^2=\\frac{e^{3x}}{11}\\big[1+\\frac{D^2+6D}{11}\\big]^{-1}x^2$.",
               "Up to $D^2$: $1-\\frac{D^2+6D}{11}+\\frac{36D^2}{121}$ (from the square keep only $36D^2$; the cube has $D^3$ and higher).",
               "$D(x^2)=2x$, $D^2(x^2)=2$: $\\frac{e^{3x}}{11}\\big[x^2-\\frac{2}{11}-\\frac{12x}{11}+\\frac{72}{121}\\big]$."],
     "answer": "$y=c_1\\cos\\sqrt2x+c_2\\sin\\sqrt2x+\\dfrac{e^{3x}}{11}\\Big[x^2-\\dfrac{12x}{11}+\\dfrac{50}{121}\\Big]$",
     "check": "Slide answer agrees; sympy dsolve and checkodesol agree. Figure G2.1."},
    {"id": "W2.2", "topic": "T2", "title": "$y''-2y'+y=xe^x\\cos x$ (slides 006·7–9, corrected)", "stars": 2,
     "srcs": ["S006·7", "S006·8", "S006·9", "T006 00:04:55", "T006 00:09:11"],
     "given": "Find the general solution of $y''-2y'+y=xe^x\\cos x$, i.e. $(D^2-2D+1)y=xe^x\\cos x$.",
     "steps": ["AE $m^2-2m+1=0$: $m=1,1$. CF $=(c_1+c_2x)e^x$.",
               "PI $=e^x\\frac{x\\cos x}{(D+1)^2-2(D+1)+1}=e^x\\frac{1}{D^2}(x\\cos x)$ ($V=x\\cos x$, $a=1$).",
               "First $\\frac1D$: $\\int x\\cos x\\,dx=x\\sin x+\\cos x$ (by parts). <b>The slide integrates $x\\sin x$ here.</b>",
               "Second $\\frac1D$: $\\int(x\\sin x+\\cos x)\\,dx=(-x\\cos x+\\sin x)+\\sin x=2\\sin x-x\\cos x$.",
               "PI $=e^x(2\\sin x-x\\cos x)$."],
     "answer": "$y=(c_1+c_2x)e^x+e^x(2\\sin x-x\\cos x)$",
     "check": "sympy dsolve and checkodesol agree. The slide's $-e^x(x\\sin x+2\\cos x)$ fails the substitution test. Cross-check by Type 5 with "
              "$f(D)=D^2$: $x\\frac{\\cos x}{D^2}-\\frac{2D}{D^4}\\cos x=-x\\cos x+2\\sin x$."},
    {"id": "W2.3", "topic": "T2", "title": "$(D^3-2D^2+D)y=x^2e^{-x}+\\sin^2x$ (ESA Jan-24 s3 2c; CW P18)", "stars": 2,
     "srcs": ["ESA Jan-24 s3 2c", "CW U2 P18"],
     "given": "Solve $(D^3-2D^2+D)y=x^2e^{-x}+\\sin^2x$.",
     "steps": ["$f(D)=D(D-1)^2$; AE roots $0,1,1$: CF $=c_1+(c_2+c_3x)e^x$.",
               "PI$_1$: shift $a=-1$: $f(D-1)=(D-1)(D-2)^2=D^3-5D^2+8D-4=-4\\big[1-\\frac{8D-5D^2+D^3}{4}\\big]$.",
               "$(1-z)^{-1}$ up to $D^2$: $1+\\big(2D-\\frac{5D^2}{4}\\big)+4D^2=1+2D+\\frac{11D^2}{4}$; on $x^2$: $x^2+4x+\\frac{11}{2}$.",
               "PI$_1=-\\frac{e^{-x}}{4}\\big(x^2+4x+\\frac{11}{2}\\big)=e^{-x}\\big(-\\frac{x^2}{4}-x-\\frac{11}{8}\\big)$.",
               "PI$_2$: $\\sin^2x=\\frac12-\\frac{\\cos2x}{2}$. $\\frac{1}{2f(D)}=\\frac{1}{2D(D-1)^2}1=\\frac x2$ (factor $D$: integrate once).",
               "$-\\frac{\\cos2x}{2f(D)}$: $D^2\\to-4$: $f\\to-4D+8+D=8-3D$; $-\\frac{(8+3D)\\cos2x}{2(64-9D^2)}=-\\frac{8\\cos2x-6\\sin2x}{200}$."],
     "answer": "$y=c_1+(c_2+c_3x)e^x+e^{-x}\\Big(-\\dfrac{x^2}{4}-x-\\dfrac{11}{8}\\Big)+\\dfrac x2-\\dfrac{\\cos2x}{25}+\\dfrac{3\\sin2x}{100}$",
     "check": "CW answer agrees ($\\frac12(x-\\frac{1}{100}(-6\\sin2x+8\\cos2x))$ is the same); sympy dsolve and checkodesol agree. Slide 004·17's "
              "boxed $\\sin^2x$ part drops a factor 2."},
    {"id": "W2.4", "topic": "T2", "title": "$(D^2-3D+2)y=xe^{3x}+\\sin2x$ (lecture example)", "stars": 2, "flags": [TONLY],
     "srcs": ["T006 00:09:45", "T006 00:14:10", "T006 00:16:19"],
     "given": "Find the general solution of $y''-3y'+2y=xe^{3x}+\\sin2x$.",
     "steps": ["AE $m^2-3m+2=0$: $m=1,2$. CF $=c_1e^x+c_2e^{2x}$.",
               "PI$_1=e^{3x}\\frac{x}{(D+3)^2-3(D+3)+2}=e^{3x}\\frac{x}{D^2+3D+2}=\\frac{e^{3x}}{2}\\big[1+\\frac{D^2+3D}{2}\\big]^{-1}x$.",
               "$m=1$: keep $1-\\frac{3D}{2}$: PI$_1=\\frac{e^{3x}}{2}\\big(x-\\frac32\\big)$.",
               "PI$_2$: $D^2\\to-4$: $\\frac{\\sin2x}{-2-3D}=-\\frac{(3D-2)\\sin2x}{9D^2-4}=\\frac{(3D-2)\\sin2x}{40}=\\frac{6\\cos2x-2\\sin2x}{40}$."],
     "answer": "$y=c_1e^x+c_2e^{2x}+\\dfrac{e^{3x}}{2}\\Big(x-\\dfrac32\\Big)+\\dfrac{3\\cos2x-\\sin2x}{20}$",
     "check": "sympy dsolve and checkodesol agree. The lecture stops at “PI $=$ PI$_1+$PI$_2$”."},
    {"id": "W3.1", "topic": "T3", "title": "$(D^2-1)y=x\\sin3x$ (CW P19)", "stars": 2, "srcs": ["CW U2 P19", "S006·4"],
     "given": "Solve $(D^2-1)y=x\\sin3x$.",
     "steps": ["AE $m^2-1=0$: CF $=c_1e^x+c_2e^{-x}$. $f(D)=D^2-1$, $f'(D)=2D$, $V=\\sin3x$.",
               "$\\frac{x}{f(D)}\\sin3x=x\\frac{\\sin3x}{-9-1}=-\\frac{x\\sin3x}{10}$.",
               "$\\frac{f'(D)}{(f(D))^2}\\sin3x=\\frac{2D\\sin3x}{(-10)^2}=\\frac{6\\cos3x}{100}=\\frac{3\\cos3x}{50}$.",
               "PI $=-\\frac{x\\sin3x}{10}-\\frac{3\\cos3x}{50}$.",
               "Check (E3.3): $\\text{Im}\\big[e^{3ix}\\frac{1}{D^2+6iD-10}x\\big]=\\text{Im}\\big[-\\frac{e^{3ix}}{10}\\big(x+\\frac{6i}{10}\\big)\\big]$, the same."],
     "answer": "$y=c_1e^x+c_2e^{-x}-\\dfrac{x\\sin3x}{10}-\\dfrac{3\\cos3x}{50}$",
     "check": "CW answer agrees; sympy dsolve and checkodesol agree. Figure G3.1."},
    {"id": "W3.2", "topic": "T3", "title": "$y''-5y'+6y=x\\cos2x$ (CW P20, homework)", "stars": 2, "srcs": ["CW U2 P20", "S006·4"],
     "given": "Solve $y''-5y'+6y=x\\cos2x$.",
     "steps": ["AE $(m-2)(m-3)=0$: CF $=c_1e^{2x}+c_2e^{3x}$. $f(D)=D^2-5D+6$, $f'(D)=2D-5$.",
               "$\\frac{\\cos2x}{f(D)}$: $D^2\\to-4$: $\\frac{\\cos2x}{2-5D}=\\frac{(2+5D)\\cos2x}{4-25D^2}=\\frac{2\\cos2x-10\\sin2x}{104}$; times $x$.",
               "$(f(D))^2\\to(2-5D)^2=4-20D+25D^2\\to-96-20D=-4(24+5D)$.",
               "$\\frac{(2D-5)\\cos2x}{-4(24+5D)}=-\\frac{(2D-5)(24-5D)\\cos2x}{4(576+100)}=-\\frac{(73D-80)\\cos2x}{2704}=\\frac{146\\sin2x+80\\cos2x}{2704}$.",
               "PI $=\\frac{x(2\\cos2x-10\\sin2x)}{104}-\\frac{146\\sin2x+80\\cos2x}{2704}$."],
     "answer": "$y=c_1e^{2x}+c_2e^{3x}+\\dfrac{x(\\cos2x-5\\sin2x)}{52}-\\dfrac{73\\sin2x}{1352}-\\dfrac{5\\cos2x}{169}$",
     "check": "CW answer agrees (it is the same, unreduced); sympy dsolve and checkodesol agree. By E3.3: $\\text{Re}\\big[e^{2ix}\\big(\\frac{(1+5i)x}{52}"
              "-\\frac{5}{169}+\\frac{73i}{1352}\\big)\\big]$, the same."},
]

PYQS = [
    {"topic": "T2", "paper": "ESA Jan 2024", "q": "UE23MA141A set 3, Q2.c (= CW P18)", "marks": 6,
     "text": "Solve $(D^3-2D^2+D)y=x^2e^{-x}+\\sin^2x$.", "worked": "W2.3"},
]

NOTES = [
    {"topic": "T1", "text": "Type 4: $X=e^{ax}V$. $\\frac{1}{f(D)}(e^{ax}V)=e^{ax}\\frac{1}{f(D+a)}V$: take $e^{ax}$ to the left, replace every $D$ by "
     "$D+a$, simplify, then use the rule for $V$ ($\\sin$/$\\cos$: $D^2\\to-b^2$). Reason: $D(e^{ax}V)=e^{ax}(D+a)V$. Examples: "
     "$\\frac{e^x\\cos x}{D^2-2D+4}=e^x\\frac{\\cos x}{D^2+3}=\\frac{e^x\\cos x}{2}$; $\\frac{e^x\\sin x}{(D-1)^2}=e^x\\frac{\\sin x}{D^2}=-e^x\\sin x$; "
     "CW P17: $\\frac{e^{2x}\\cos x}{D^2+4D+3}=\\frac{e^{2x}(7\\cos x+4\\sin x)}{130}$. A root $a$ of the AE gives a factor $D$ after the shift."},
    {"topic": "T2", "text": "$V$ a polynomial: $\\frac{x^me^{ax}}{f(D)}=e^{ax}[f(D+a)]^{-1}x^m$, take $f(a)$ out, expand up to $D^m$. "
     "$\\frac{x^2e^{3x}}{D^2+2}=\\frac{e^{3x}}{11}(x^2-\\frac{12x}{11}+\\frac{50}{121})$. If $f(D+a)=D^k$, integrate $k$ times, no constants: "
     "$\\frac{xe^x\\cos x}{(D-1)^2}=e^x(2\\sin x-x\\cos x)$ (slide 006·9 is wrong). ESA: $\\frac{x^2e^{-x}+\\sin^2x}{D^3-2D^2+D}=e^{-x}(-\\frac{x^2}{4}-x-\\frac{11}{8})"
     "+\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$."},
    {"topic": "T3", "text": "Type 5: $X=xV$. $\\frac{1}{f(D)}(xV)=x\\frac{1}{f(D)}V-\\frac{f'(D)}{(f(D))^2}V$, both parts by Type 2. CW P19: "
     "$\\frac{x\\sin3x}{D^2-1}=-\\frac{x\\sin3x}{10}-\\frac{3\\cos3x}{50}$. CW P20: $\\frac{x\\cos2x}{D^2-5D+6}=\\frac{x(\\cos2x-5\\sin2x)}{52}-\\frac{73\\sin2x}{1352}"
     "-\\frac{5\\cos2x}{169}$. Check: $x\\sin ax=\\text{Im}(xe^{iax})$, then Type 4 with $V=x$."},
]

FIGS = [
    {"id": "G1.1", "topic": "T1", "title": "The PI $\\frac{e^x\\cos x}{2}$ oscillates inside its envelope $\\pm\\frac{e^x}{2}$", "stars": 2,
     "srcs": ["S006·5", "S006·6"], "flags": [ADD],
     "howto": "The PI of $(D^2-2D+4)y=e^x\\cos x$ (blue) is the shifted problem's answer $\\frac{\\cos x}{2}$ multiplied by $e^x$: it touches the "
              "envelope $\\pm\\frac{e^x}{2}$ (vermilion dashed) where $\\cos x=\\pm1$ and crosses zero where $\\cos x=0$. The factor $e^{ax}$ survives the "
              "shift unchanged; only the oscillating part $V$ is operated on."},
    {"id": "G2.1", "topic": "T2", "title": "Strip the exponential: $y_p e^{-3x}$ is the Type 3 polynomial", "stars": 2,
     "srcs": ["S006·11", "S006·12"], "flags": [ADD], "tall": True,
     "howto": "Top: the PI $y_p=\\frac{e^{3x}}{11}(x^2-\\frac{12x}{11}+\\frac{50}{121})$ of $(D^2+2)y=x^2e^{3x}$ (blue) next to $\\frac{x^2e^{3x}}{11}$ "
              "(vermilion dashed), the leading term alone. Bottom: divided by $e^{3x}$, the PI is the polynomial $\\frac{1}{11}(x^2-\\frac{12x}{11}+\\frac{50}{121})$ "
              "(green), the answer of the shifted Type 3 problem $\\frac{1}{D^2+6D+11}x^2$; the correction terms $-\\frac{12x}{121}+\\frac{50}{1331}$ "
              "move its vertex off the origin."},
    {"id": "G3.1", "topic": "T3", "title": "Type 5: the PI of $(D^2-1)y=x\\sin3x$ grows like $\\frac{x}{10}$", "stars": 2,
     "srcs": ["CW U2 P19"], "flags": [ADD],
     "howto": "The PI $-\\frac{x\\sin3x}{10}-\\frac{3\\cos3x}{50}$ (blue) has an amplitude that grows linearly, like the right-hand side $x\\sin3x$ "
              "scaled by $\\frac{1}{f(-9)}=-\\frac{1}{10}$; the lines $\\pm\\frac{x}{10}$ (vermilion dashed) are the envelope of the first term. The "
              "correction $-\\frac{3\\cos3x}{50}$ (green dashed) is the $\\frac{f'(D)}{(f(D))^2}V$ term: small, of fixed amplitude, and it dominates only near $x=0$."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "The Type 4 procedure (slide 006·4)", "stars": 2,
     "srcs": ["S006·4", "S006·10", "T006 00:01:00", "T006b 00:10:19", "T006b 00:10:53"], "layout": "straight", "maxw": "130mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "PI $=\\frac{1}{f(D)}(e^{ax}V)$", "sub": "$a$ = coefficient of $x$ in the exponent"},
         {"kind": "step", "n": 1, "title": "Take $e^{ax}$ to the left", "fx": "$e^{ax}\\frac{1}{f(D+a)}V$"},
         {"kind": "step", "n": 2, "title": "Expand and simplify $f(D+a)$", "sub": "replace every $D$", "fx": "$(D+1)^2-2(D+1)+4=D^2+3$"},
         {"kind": "step", "n": 3, "title": "Operate on $V$ with the rule for $V$", "sub": "Figure F1.2"},
         {"kind": "result", "title": "PI $=e^{ax}\\times$ (result)", "fx": "$y=\\text{CF}+\\text{PI}$"}]},
     "remark": "The exponential is never differentiated: it waits on the left while $f(D+a)$ works on $V$.",
     "trap": "Replace the $D$ in every term ($-2D\\to-2(D+1)$), not only in $D^2$."},
    {"id": "F1.2", "topic": "T1", "title": "After the shift: which rule for $V$?", "stars": 2,
     "srcs": ["T006b 00:10:53", "S006·6", "S006·8", "S006·12", "S006·14"], "layout": "route", "maxw": "165mm",
     "spec": {"question": "What is $V$, and what is $f(D+a)$?",
              "rows": [{"title": "$V=\\sin bx$, $\\cos bx$", "sub": "Type 2: $D^2\\to-b^2$ in $f(D+a)$; rationalise a lone $D$ (W1.1, W1.3)", "kw": "E1.3"},
                       {"title": "$V=x^m$, polynomial", "sub": "Type 3: take $f(a)$ out, expand up to $D^m$ (W2.1, W2.3)", "kw": "E2.1"},
                       {"title": "$f(D+a)=D^k$", "sub": "integrate $V$ $k$ times, no constants (W1.2, W2.2)", "kw": "E2.2"},
                       {"title": "$V=1$", "sub": "Type 1 failure case by the shift (W1.4)", "kw": "E1.4", "dashed": True},
                       {"title": "$V=x\\cos bx$, $x\\sin bx$", "sub": "Type 5 on the shifted operator (cross-check of W2.2)", "kw": "E3.1", "dashed": True}]},
     "remark": "T006b 00:10:53: “If $V$ is sine or cos, we go with case 2. If $V$ is a polynomial, we go with case 3.”"},
    {"id": "F2.1", "topic": "T2", "title": "Slides 006·11–12: $(D^2+2)y=x^2e^{3x}$", "stars": 2,
     "srcs": ["S006·11", "S006·12", "T006b 00:12:13", "T006b 00:13:25"], "layout": "straight", "maxw": "150mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$\\frac{1}{D^2+2}x^2e^{3x}$", "sub": "$a=3$, $V=x^2$ ($m=2$)"},
         {"kind": "step", "n": 1, "title": "Shift $D\\to D+3$", "fx": "$e^{3x}\\frac{1}{D^2+6D+11}x^2$"},
         {"kind": "step", "n": 2, "title": "Take 11 out", "fx": "$\\frac{e^{3x}}{11}\\big[1+\\frac{D^2+6D}{11}\\big]^{-1}x^2$"},
         {"kind": "table", "head": ["Term of the series", "Kept ($D^{\\le2}$)"],
          "rows": [["$-\\frac{D^2+6D}{11}$", "$-\\frac{D^2}{11}-\\frac{6D}{11}$"],
                   ["$+\\frac{(D^2+6D)^2}{121}$", "$\\frac{36D^2}{121}$ only"],
                   ["$-\\frac{(D^2+6D)^3}{1331}$", "nothing ($D^3$ and up)"]]},
         {"kind": "step", "n": 3, "title": "Operate on $x^2$", "fx": "$x^2-\\frac{12x}{11}-\\frac{2}{11}+\\frac{72}{121}$"},
         {"kind": "result", "title": "PI $=\\frac{e^{3x}}{11}\\big[x^2-\\frac{12x}{11}+\\frac{50}{121}\\big]$", "fx": "W2.1"}]},
     "remark": "“$a^2$ is not needed, $b^2$ is needed, $2ab$ is not needed” (T006b 00:13:25)."},
    {"id": "F2.2", "topic": "T2", "title": "Slides 006·7–9: $(D-1)^2y=xe^x\\cos x$, corrected", "stars": 2,
     "srcs": ["S006·8", "S006·9", "T006 00:06:40", "T006 00:07:16"], "layout": "straight", "maxw": "140mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$\\frac{1}{(D-1)^2}xe^x\\cos x$", "sub": "$a=1$, $V=x\\cos x$"},
         {"kind": "step", "n": 1, "title": "Shift $D\\to D+1$", "fx": "$e^x\\frac{1}{D^2}(x\\cos x)$"},
         {"kind": "step", "n": 2, "title": "First integral (by parts)", "fx": "$\\int x\\cos x\\,dx=x\\sin x+\\cos x$"},
         {"kind": "step", "n": 3, "title": "Second integral", "fx": "$\\int(x\\sin x+\\cos x)\\,dx=2\\sin x-x\\cos x$"},
         {"kind": "result", "title": "PI $=e^x(2\\sin x-x\\cos x)$", "fx": "W2.2"}]},
     "trap": "Slide 006·9 integrates $x\\sin x$ at step 2 and ends with $-e^x(x\\sin x+2\\cos x)$, which does not satisfy the equation."},
    {"id": "F2.3", "topic": "T2", "title": "ESA Jan-24 s3 2c (= CW P18): $(D^3-2D^2+D)y=x^2e^{-x}+\\sin^2x$", "stars": 2,
     "srcs": ["ESA Jan-24 s3 2c", "CW U2 P18"], "layout": "streams", "maxw": "165mm",
     "spec": {"left": [{"kind": "given", "title": "CF and PI$_1$", "sub": "$f(D)=D(D-1)^2$; roots $0,1,1$"},
                       {"kind": "step", "n": 1, "title": "CF", "fx": "$c_1+(c_2+c_3x)e^x$"},
                       {"kind": "step", "n": 2, "title": "Shift $D\\to D-1$", "fx": "$-\\frac{e^{-x}}{4}\\big[1-\\frac{8D-5D^2}{4}\\big]^{-1}x^2$"},
                       {"kind": "step", "n": 3, "title": "Up to $D^2$", "fx": "$-\\frac{e^{-x}}{4}\\big(1+2D+\\frac{11D^2}{4}\\big)x^2$"}],
              "right": [{"kind": "given", "title": "PI$_2$", "sub": "$\\sin^2x=\\frac12-\\frac{\\cos2x}{2}$"},
                        {"kind": "step", "n": 4, "title": "Constant: factor $D$", "fx": "$\\frac{1}{2D(D-1)^2}1=\\frac x2$"},
                        {"kind": "step", "n": 5, "title": "$D^2\\to-4$", "fx": "$-\\frac{\\cos2x}{2(8-3D)}=-\\frac{(8+3D)\\cos2x}{200}$"},
                        {"kind": "step", "n": 6, "title": "Operate", "fx": "$-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$"}],
              "then": [{"kind": "result", "title": "$y=c_1+(c_2+c_3x)e^x+e^{-x}\\big(-\\tfrac{x^2}{4}-x-\\tfrac{11}{8}\\big)$",
                        "fx": "$+\\tfrac x2-\\tfrac{\\cos2x}{25}+\\tfrac{3\\sin2x}{100}$"}]},
     "remark": "Worked in full as W2.3 (6 marks). The $\\sin^2x$ part is the class 004 pack's W3.2."},
    {"id": "F3.1", "topic": "T3", "title": "The Type 5 procedure, on CW P19: $(D^2-1)y=x\\sin3x$", "stars": 2,
     "srcs": ["S006·4", "CW U2 P19"], "layout": "streams", "maxw": "160mm",
     "spec": {"left": [{"kind": "given", "title": "First term", "sub": "$x\\cdot\\frac{1}{f(D)}V$"},
                       {"kind": "step", "n": 1, "title": "Type 2 on $V$", "fx": "$\\frac{\\sin3x}{-9-1}=-\\frac{\\sin3x}{10}$"},
                       {"kind": "step", "n": 2, "title": "Multiply by $x$", "fx": "$-\\frac{x\\sin3x}{10}$"}],
              "right": [{"kind": "given", "title": "Correction", "sub": "$\\frac{f'(D)}{(f(D))^2}V$, $f'(D)=2D$"},
                        {"kind": "step", "n": 3, "title": "$(f(D))^2\\to(-10)^2$", "fx": "$\\frac{2D\\sin3x}{100}$"},
                        {"kind": "step", "n": 4, "title": "Operate", "fx": "$\\frac{6\\cos3x}{100}=\\frac{3\\cos3x}{50}$"}],
              "then": [{"kind": "result", "title": "PI $=$ first $-$ correction", "fx": "$-\\tfrac{x\\sin3x}{10}-\\tfrac{3\\cos3x}{50}$"}]},
     "remark": "Both halves are ordinary Type 2 work. Worked as W3.1; W3.2 (CW P20) needs rationalising in both halves."},
    {"id": "F3.2", "topic": "T3", "title": "Two routes to the PI of $x\\sin3x$, one answer", "stars": 1,
     "srcs": ["S006·4", "CW U2 P19"], "flags": [ADD], "layout": "verify", "maxw": "160mm",
     "spec": {"given": {"kind": "given", "title": "$\\frac{1}{D^2-1}\\,x\\sin3x$"},
              "left": [{"kind": "step", "n": 1, "title": "Type 5 (slide)", "fx": "$x\\frac{\\sin3x}{D^2-1}-\\frac{2D\\sin3x}{(D^2-1)^2}$"},
                       {"kind": "step", "n": 2, "title": "Type 2 twice", "fx": "$-\\frac{x\\sin3x}{10}-\\frac{3\\cos3x}{50}$"}],
              "right": [{"kind": "step", "n": 1, "title": "$\\text{Im}(xe^{3ix})$, shift $D\\to D+3i$", "fx": "$e^{3ix}\\frac{1}{D^2+6iD-10}x$"},
                        {"kind": "step", "n": 2, "title": "Type 3, $m=1$", "fx": "$\\text{Im}\\big[-\\frac{e^{3ix}}{10}(x+\\frac{3i}{5})\\big]$"}],
              "check": {"kind": "check", "title": "Same PI", "sub": "$\\text{Im}$ gives $-\\frac{x\\sin3x}{10}-\\frac{3\\cos3x}{50}$ (sympy)"}},
     "remark": "The right-hand route is added for clarity; write the slide method (left) in the exam."},
]

COMPARISONS = [
    {"id": "C1.1", "topic": "T1", "title": "The five PI types side by side", "srcs": ["S006·4", "S006·10"], "flags": [ADD],
     "head": ["Type", "$X$", "Rule", "Special case", "Class pack"],
     "rows": [["1", "$e^{ax}$", "$D\\to a$", "$f(a)=0$: $x\\frac{e^{ax}}{f'(a)}$", "003"],
              ["2", "$\\sin ax$, $\\cos ax$", "$D^2\\to-a^2$", "$f(-a^2)=0$: multiply by $x$, differentiate", "004"],
              ["3", "$x^m$", "$[f(D)]^{-1}$ in powers of $D$, up to $D^m$", "$f(0)=0$: take $D^k$ out", "005"],
              ["4", "$e^{ax}V$", "$e^{ax}\\frac{1}{f(D+a)}V$", "none needed: the shift gives $D^k$", "006 (this pack)"],
              ["5", "$xV$", "$\\big[\\frac{x}{f(D)}-\\frac{f'(D)}{(f(D))^2}\\big]V$", "use Type 2 on both terms", "006 (this pack)"]]},
    {"id": "C2.1", "topic": "T2", "title": "Every Type 4 and Type 5 problem in this pack", "flags": [ADD],
     "srcs": ["S006·5", "S006·7", "S006·11", "S006·13", "T006 00:09:45", "CW U2 P17", "CW U2 P18", "CW U2 P19", "CW U2 P20", "ESA Jan-24 s3 2c"],
     "head": ["Source (worked)", "Equation", "After the shift / rule", "PI"],
     "rows": [["S006·5–6 (W1.1)", "$(D^2-2D+4)y=e^x\\cos x$", "$e^x\\frac{\\cos x}{D^2+3}$", "$\\frac{e^x\\cos x}{2}$"],
              ["S006·13–14 (W1.2)", "$(D-1)^2y=e^x\\sin x$", "$e^x\\frac{\\sin x}{D^2}$", "$-e^x\\sin x$"],
              ["CW P17 (W1.3)", "$(D^2+4D+3)y=e^{2x}\\cos x$", "$e^{2x}\\frac{\\cos x}{D^2+8D+15}$", "$\\frac{e^{2x}(7\\cos x+4\\sin x)}{130}$"],
              ["S006·11–12 (W2.1)", "$(D^2+2)y=x^2e^{3x}$", "$e^{3x}\\frac{x^2}{D^2+6D+11}$", "$\\frac{e^{3x}}{11}(x^2-\\frac{12x}{11}+\\frac{50}{121})$"],
              ["S006·7–9 (W2.2)", "$(D-1)^2y=xe^x\\cos x$", "$e^x\\frac{x\\cos x}{D^2}$", "$e^x(2\\sin x-x\\cos x)$"],
              ["ESA s3 2c = P18 (W2.3)", "$(D^3-2D^2+D)y=x^2e^{-x}+\\dots$", "$e^{-x}\\frac{x^2}{D^3-5D^2+8D-4}$", "$e^{-x}(-\\frac{x^2}{4}-x-\\frac{11}{8})+\\dots$"],
              ["T006 only (W2.4)", "$(D^2-3D+2)y=xe^{3x}+\\sin2x$", "$e^{3x}\\frac{x}{D^2+3D+2}$", "$\\frac{e^{3x}}{2}(x-\\frac32)+\\frac{3\\cos2x-\\sin2x}{20}$"],
              ["CW P19 (W3.1)", "$(D^2-1)y=x\\sin3x$", "Type 5", "$-\\frac{x\\sin3x}{10}-\\frac{3\\cos3x}{50}$"],
              ["CW P20 (W3.2)", "$(D^2-5D+6)y=x\\cos2x$", "Type 5", "$\\frac{x(\\cos2x-5\\sin2x)}{52}-\\frac{73\\sin2x}{1352}-\\frac{5\\cos2x}{169}$"]]},
    {"id": "C3.1", "topic": "T3", "title": "Type 5 formula or complex exponential?", "srcs": ["S006·4", "CW U2 P19", "CW U2 P20"], "flags": [ADD],
     "head": ["", "Type 5 formula (slide)", "$\\text{Im}/\\text{Re}$ of $xe^{iax}$"],
     "rows": [["Steps", "two Type 2 computations", "one shift, one Type 3 series with complex numbers"],
              ["Needs", "$f'(D)$ and $(f(D))^2$", "$f(D+ia)$ and complex division"],
              ["Best for", "the exam (it is the taught rule)", "checking the answer"],
              ["CW P19", "$-\\frac{x\\sin3x}{10}-\\frac{3\\cos3x}{50}$", "same"],
              ["CW P20", "$\\frac{x(\\cos2x-5\\sin2x)}{52}-\\frac{73\\sin2x}{1352}-\\frac{5\\cos2x}{169}$", "same"]]},
]

SYMBOLS = [
    {"sym": "$D$", "name": "Differential operator", "meaning": "$\\frac{d}{dx}$; $\\frac1D$ = integration without a constant", "where": "E1.1, E2.2"},
    {"sym": "$f(D)$", "name": "Operator polynomial", "meaning": "Left-hand side operator of $f(D)y=X$", "where": "E1.1, E3.1"},
    {"sym": "$f(D+a)$", "name": "Shifted operator", "meaning": "$f(D)$ with every $D$ replaced by $D+a$", "where": "E1.1, E1.2"},
    {"sym": "$f'(D)$", "name": "f dash of D", "meaning": "Derivative of the polynomial $f(D)$ with respect to $D$", "where": "E3.1, E3.2"},
    {"sym": "$a$", "name": "Exponent coefficient", "meaning": "Coefficient of $x$ in $e^{ax}$; in Type 1 and Type 2 also the frequency of $\\sin ax$ (clash)", "where": "E1.1"},
    {"sym": "$b$", "name": "Frequency of $V$", "meaning": "$V=\\sin bx$ or $\\cos bx$; $D^2\\to-b^2$ after the shift", "where": "E1.3"},
    {"sym": "$V$", "name": "Remaining factor", "meaning": "$V(x)$: what is left after $e^{ax}$ (Type 4) or $x$ (Type 5) is split off", "where": "E1.1, E3.1"},
    {"sym": "$\\varphi(D)$", "name": "Phi of $D$", "meaning": "$f(D+a)=f(a)[1\\pm\\varphi(D)]$, only positive powers of $D$", "where": "E2.1"},
    {"sym": "$b_0$", "name": "Constant of $f(D+a)$", "meaning": "Equals $f(a)$; taken out before the series", "where": "E2.1"},
    {"sym": "$\\psi(D)$", "name": "Psi of $D$", "meaning": "$f(D)=(D-a)^k\\psi(D)$ with $\\psi(a)\\neq0$", "where": "E1.4"},
    {"sym": "$\\text{Im}$, $\\text{Re}$", "name": "Imaginary, real part", "meaning": "$x\\sin ax=\\text{Im}(xe^{iax})$, $x\\cos ax=\\text{Re}(xe^{iax})$", "where": "E3.3"},
    {"sym": "PI$_1$, PI$_2$", "name": "Partial PIs", "meaning": "PIs of the separate terms of $X$", "where": "E2.4"},
]

KEYWORDS = [
    {"term": "Type 4", "meaning": "$X=e^{ax}V$, $V$ a function of $x$.", "topic": "T1"},
    {"term": "Exponential shift", "meaning": "$\\frac{1}{f(D)}e^{ax}V=e^{ax}\\frac{1}{f(D+a)}V$.", "topic": "T1"},
    {"term": "$D\\to D+a$", "meaning": "Replace every $D$ in $f(D)$.", "topic": "T1"},
    {"term": "$a$", "meaning": "Coefficient of $x$ in the exponent.", "topic": "T1"},
    {"term": "Shifted operator", "meaning": "$f(D+a)$, expanded and simplified.", "topic": "T1"},
    {"term": "$V=\\sin bx$, $\\cos bx$", "meaning": "After the shift, Type 2 with $D^2\\to-b^2$.", "topic": "T1"},
    {"term": "Failure by shift", "meaning": "AE root $a$ gives a factor $D$ in $f(D+a)$.", "topic": "T1"},
    {"term": "$x^me^{ax}$", "meaning": "After the shift, Type 3 series up to $D^m$.", "topic": "T2"},
    {"term": "$\\frac{1}{D^k}$", "meaning": "Integrate $k$ times, no constants.", "topic": "T2"},
    {"term": "Integration by parts", "meaning": "$\\int x\\cos x\\,dx=x\\sin x+\\cos x$.", "topic": "T2"},
    {"term": "Superposition", "meaning": "PI $=$ PI$_1+$PI$_2$.", "topic": "T2"},
    {"term": "$\\sin^2x$", "meaning": "$\\frac{1-\\cos2x}{2}$.", "topic": "T2"},
    {"term": "Type 5", "meaning": "$X=xV$.", "topic": "T3"},
    {"term": "Type 5 rule", "meaning": "$\\big[\\frac{x}{f(D)}-\\frac{f'(D)}{(f(D))^2}\\big]V$.", "topic": "T3"},
    {"term": "$f'(D)$", "meaning": "Derivative of $f(D)$ with respect to $D$.", "topic": "T3"},
    {"term": "Correction term", "meaning": "$\\frac{f'(D)}{(f(D))^2}V$, subtracted.", "topic": "T3"},
    {"term": "$\\text{Im}(xe^{iax})$", "meaning": "$x\\sin ax$: Type 4 with $a\\to ia$ (check only).", "topic": "T3"},
]

RAPID = [
    {"q": "Type 4 rule?", "a": "$\\frac{1}{f(D)}(e^{ax}V)=e^{ax}\\frac{1}{f(D+a)}V$."},
    {"q": "Why $D+a$?", "a": "$D(e^{ax}V)=e^{ax}(D+a)V$ (product rule)."},
    {"q": "$(D+1)^2-2(D+1)+4$?", "a": "$D^2+3$."},
    {"q": "$\\frac{e^x\\cos x}{D^2-2D+4}$?", "a": "$e^x\\frac{\\cos x}{D^2+3}=\\frac{e^x\\cos x}{2}$."},
    {"q": "$\\frac{e^x\\sin x}{(D-1)^2}$?", "a": "$e^x\\frac{\\sin x}{D^2}=-e^x\\sin x$."},
    {"q": "$\\frac{e^{2x}\\cos x}{D^2+4D+3}$ (CW P17)?", "a": "$\\frac{e^{2x}(7\\cos x+4\\sin x)}{130}$."},
    {"q": "$\\frac{x^2e^{3x}}{D^2+2}$?", "a": "$\\frac{e^{3x}}{11}(x^2-\\frac{12x}{11}+\\frac{50}{121})$."},
    {"q": "$\\frac{xe^x\\cos x}{(D-1)^2}$?", "a": "$e^x(2\\sin x-x\\cos x)$; slide 006·9 is wrong."},
    {"q": "$\\frac{xe^{3x}}{D^2-3D+2}$?", "a": "$\\frac{e^{3x}}{2}(x-\\frac32)$."},
    {"q": "$\\frac{x^2e^{-x}}{D^3-2D^2+D}$?", "a": "$e^{-x}(-\\frac{x^2}{4}-x-\\frac{11}{8})$."},
    {"q": "PI of $\\sin^2x$ for $D^3-2D^2+D$?", "a": "$\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$."},
    {"q": "$\\frac{e^{2x}}{(D-2)^2}$ by the shift?", "a": "$e^{2x}\\frac{1}{D^2}1=\\frac{x^2e^{2x}}{2}$."},
    {"q": "Type 5 rule?", "a": "$\\frac{1}{f(D)}(xV)=\\big[\\frac{x}{f(D)}-\\frac{f'(D)}{(f(D))^2}\\big]V$."},
    {"q": "$\\frac{x\\sin3x}{D^2-1}$ (CW P19)?", "a": "$-\\frac{x\\sin3x}{10}-\\frac{3\\cos3x}{50}$."},
    {"q": "$\\frac{x\\cos2x}{D^2-5D+6}$ (CW P20)?", "a": "$\\frac{x(\\cos2x-5\\sin2x)}{52}-\\frac{73\\sin2x}{1352}-\\frac{5\\cos2x}{169}$."},
    {"q": "Which ESA question uses Type 4?", "a": "Jan-24 set 3 2c, $(D^3-2D^2+D)y=x^2e^{-x}+\\sin^2x$ (= CW P18)."},
]

MNEMONICS = [
    "<i>“Exponent out, $D$ moves up by $a$, then $V$ decides.”</i> The three steps of Type 4 (study aid).",
]

TOP_FACTS = [
    "Type 4: $\\frac{1}{f(D)}(e^{ax}V)=e^{ax}\\frac{1}{f(D+a)}V$: $e^{ax}$ out to the left, every $D\\to D+a$, simplify, then the rule for $V$.",
    "After the shift: $\\sin$/$\\cos$ → $D^2\\to-b^2$; polynomial → series up to $D^m$; $D^k$ alone → integrate $k$ times, no constants.",
    "An AE root $a$ needs no failure rule: $f(D+a)$ has a factor $D$ ($\\frac{e^x\\sin x}{(D-1)^2}=-e^x\\sin x$).",
    "Type 5: $\\frac{1}{f(D)}(xV)=x\\frac{1}{f(D)}V-\\frac{f'(D)}{(f(D))^2}V$, both by Type 2.",
    "ESA Jan-24 s3 2c (= CW P18): PI $=e^{-x}(-\\frac{x^2}{4}-x-\\frac{11}{8})+\\frac x2-\\frac{\\cos2x}{25}+\\frac{3\\sin2x}{100}$.",
    "CW P19: $-\\frac{x\\sin3x}{10}-\\frac{3\\cos3x}{50}$; CW P20: $\\frac{x(\\cos2x-5\\sin2x)}{52}-\\frac{73\\sin2x}{1352}-\\frac{5\\cos2x}{169}$.",
    "Slide slips: 006·9 should give $e^x(2\\sin x-x\\cos x)$; 006·5's CF needs $c_2\\sin\\sqrt3x$.",
]
TOP_FORMULAS = ["E1.1", "E1.3", "E2.1", "E2.2", "E3.1"]
