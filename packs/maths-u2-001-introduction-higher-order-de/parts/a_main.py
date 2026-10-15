"""Unit 2, class 001: introduction to second and higher order linear DEs with constant coefficients."""
ADD = "added for clarity"
TONLY = "transcript only"

TOPICS = [
    {"id": "T1", "title": "Linear differential equations and their order",
     "overview": r"An ordinary differential equation is either linear or non-linear. It is <i>linear</i> when the dependent variable "
                 r"$y$ and its derivatives occur only in the first degree and are not multiplied together; the coefficients may "
                 r"depend on $x$ but not on $y$. The <i>order</i> is the order of the highest derivative present. The deck writes "
                 r"the general linear equation of order 1, 2 and $n$; Unit 2 is about orders 2 and higher."},
    {"id": "T2", "title": "Constant or variable coefficients; homogeneous or not",
     "overview": r"A linear DE of order $n$, $\frac{d^ny}{dx^n}+a_1\frac{d^{n-1}y}{dx^{n-1}}+\dots+a_ny=X$, comes in two forms: with "
                 r"constant coefficients, where all $a_i$ are numbers, or with variable coefficients, where some $a_i$ are functions of $x$. An equation "
                 r"with constant coefficients is <i>homogeneous</i> when the right-hand side $X$ is zero and <i>non-homogeneous</i> "
                 r"when $X$ is a nonzero function of $x$. Every non-homogeneous equation has an associated homogeneous equation, "
                 r"obtained by putting $X=0$."},
    {"id": "T3", "title": "The differential operator $D$ and $f(D)$",
     "overview": r"Writing $D=\frac{d}{dx}$, $D^2=\frac{d^2}{dx^2}$, …, $D^n=\frac{d^n}{dx^n}$ turns the equation into $f(D)y=X$, where "
                 r"$f(D)=D^n+a_1D^{n-1}+\dots+a_n$ is the <i>linear differential operator</i>. With constant coefficients $f(D)$ is "
                 r"a polynomial in $D$: it can be factorised and its factors taken in any order. Every constant-coefficient ESA "
                 r"question of Unit 2 is written this way."},
    {"id": "T4", "title": "Linear independence and the complementary function",
     "overview": r"Functions $f_1,\dots,f_n$ are linearly dependent on an interval when some combination $c_1f_1+\dots+c_nf_n$ with "
                 r"constants not all zero vanishes identically; otherwise they are independent. Two functions are independent when "
                 r"neither is a constant multiple of the other. If $y_1,\dots,y_n$ are $n$ independent solutions of an $n$-th order "
                 r"homogeneous LDE, then $c_1y_1+\dots+c_ny_n$ is its complete solution, the <i>complementary function</i> (CF)."},
    {"id": "T5", "title": "The general solution: $y=\\text{CF}+\\text{PI}$",
     "overview": r"For the non-homogeneous equation $f(D)y=X$, if $y_c$ is the complete solution of $f(D)y=0$ and $y_p$ is any one "
                 r"solution of $f(D)y=X$, the complete solution is $y=y_c+y_p$. The particular solution $y_p$ is called the "
                 r"<i>particular integral</i> (PI). The CF carries all $n$ arbitrary constants; the PI has none. Every Unit 2 ESA "
                 r"question is answered in this form; classes 002–006 give the methods for the CF and the PI."},
]

DEFS = [
    {"topic": "T1", "term": "Linear differential equation (slide)",
     "text": "A differential equation in which the dependent variable and its derivative occur in first degree and are not multiplied together is a Linear Differential Equation.",
     "srcs": ["S001·6", "T001 00:05:13"]},
    {"topic": "T1", "term": "Linear differential equation (lecture form)",
     "text": r"A differential equation is linear if (1) the coefficients of $y$ and its derivatives are functions of $x$ or constants (never of $y$), and (2) the degree of $y$ and of each derivative is 1.",
     "srcs": ["T001 00:06:27", "T001 00:06:41"]},
    {"topic": "T1", "term": "Non-linear differential equation",
     "text": r"A differential equation which is not linear, e.g. $y^2\frac{dy}{dx}+\sin y=x^2e^{2y}$.", "srcs": ["S001·5", "T001 00:03:29"]},
    {"topic": "T1", "term": "Order",
     "text": "The order of the highest-order derivative present in the differential equation.", "srcs": ["T001 00:05:51"]},
    {"topic": "T1", "term": "Higher-order LDE",
     "text": r"A linear differential equation of order 2 or more: $\frac{d^ny}{dx^n}+a_1\frac{d^{n-1}y}{dx^{n-1}}+a_2\frac{d^{n-2}y}{dx^{n-2}}+\dots+a_ny=X$, where $a_1,a_2,\dots,a_n$ are functions of $x$ or constants and $X$ is a function of $x$ alone.",
     "srcs": ["S001·8", "T001 00:09:46"]},
    {"topic": "T2", "term": "LDE with constant coefficients",
     "text": "In this type, the coefficient of derivatives are constants.", "srcs": ["S001·8", "T001 00:10:28"]},
    {"topic": "T2", "term": "LDE with variable coefficients",
     "text": r"In this type, the coefficient of derivatives $a_1,a_2,\dots,a_n$ are functions of $x$.", "srcs": ["S001·9", "T001 00:11:33"]},
    {"topic": "T2", "term": "Homogeneous LDE", "text": r"RHS $X$ is zero.", "srcs": ["S001·10", "T001 00:13:22"]},
    {"topic": "T2", "term": "Non-homogeneous LDE", "text": r"RHS $X$ is a nonzero function of $x$.", "srcs": ["S001·10", "T001 00:13:34"]},
    {"topic": "T2", "term": "Associated homogeneous equation",
     "text": r"The equation obtained from a non-homogeneous LDE by replacing $X$ by 0: for $f(D)y=X$ it is $f(D)y=0$.",
     "srcs": ["T001 00:14:44", "T001 00:14:52"]},
    {"topic": "T3", "term": "Differential operator $D$",
     "text": r"$D=\frac{d}{dx}$, $D^2=\frac{d^2}{dx^2}$, $D^3=\frac{d^3}{dx^3}$, …, $D^n=\frac{d^n}{dx^n}$.", "srcs": ["S001·11", "T001 00:15:16"]},
    {"topic": "T3", "term": "Linear differential operator $f(D)$",
     "text": r"$f(D)=D^n+a_1D^{n-1}+a_2D^{n-2}+\dots+a_n$, so that the LDE reads $f(D)y=X$.", "srcs": ["S001·11", "T001 00:16:29"]},
    {"topic": "T4", "term": "Linearly dependent functions",
     "text": r"A set of functions $f_1(x),f_2(x),\dots,f_n(x)$ are said to be linearly dependent on an interval $I$ if there exists constants $c_1,c_2,\dots,c_n$ not all zero, such that $c_1f_1+c_2f_2+\dots+c_nf_n=0$.",
     "srcs": ["S001·13", "T001 00:19:05"]},
    {"topic": "T4", "term": "Linearly independent functions",
     "text": r"If not linearly dependent, the functions are called linearly independent: $c_1f_1+c_2f_2+\dots+c_nf_n=0\Rightarrow c_1=c_2=\dots=c_n=0$.",
     "srcs": ["S001·13", "T001 00:19:59"]},
    {"topic": "T4", "term": "Complementary function (CF)",
     "text": r"The complete solution $y=c_1y_1+c_2y_2+\dots+c_ny_n$ of the homogeneous LDE of order $n$, where $y_1,\dots,y_n$ are $n$ linearly independent solutions.",
     "srcs": ["S001·12", "S001·16", "T001 00:25:38"]},
    {"topic": "T5", "term": "Particular integral (PI)",
     "text": r"A particular solution $y_p$ of the non-homogeneous equation $f(D)y=X$: one solution, containing no arbitrary constant.",
     "srcs": ["S001·17", "T001 00:27:16", "T001 00:27:52"]},
    {"topic": "T5", "term": "Complete (general) solution",
     "text": r"$y=y_c+y_p$, CF plus PI.", "srcs": ["S001·17", "T001 00:27:34"]},
]

STATEMENTS = [
    {"topic": "T1", "text": r"A linear differential equation of first order is of the form $\frac{dy}{dx}+P\cdot y=Q$ where $P$ and $Q$ are functions of $x$ alone.",
     "srcs": ["S001·7"]},
    {"topic": "T1", "text": r"A linear differential equation of order two is of the form $\frac{d^2y}{dx^2}+P_1\frac{dy}{dx}+P_2y=X$ where $P_1$ and $P_2$ and $X$ are functions of $x$ alone.",
     "srcs": ["S001·7"]},
    {"topic": "T1", "text": r"A linear differential equation of order $n$ is of the form $\frac{d^ny}{dx^n}+P_1\frac{d^{n-1}y}{dx^{n-1}}+P_2\frac{d^{n-2}y}{dx^{n-2}}+\dots+P_ny=X$ where $P_1,P_2,\dots,P_n$ and $X$ are functions of $x$ alone.",
     "srcs": ["S001·7"]},
    {"topic": "T3", "text": r"Thus, in terms of operator notation $\frac{d^ny}{dx^n}+a_1\frac{d^{n-1}y}{dx^{n-1}}+a_2\frac{d^{n-2}y}{dx^{n-2}}+\dots+a_ny=X$ can be written as "
                            r"$D^ny+a_1D^{n-1}y+a_2D^{n-2}y+\dots+a_ny=X$, $f(D)y=X$, where $f(D)=D^n+a_1D^{n-1}+a_2D^{n-2}+\dots+a_n$ called linear differential operator.",
     "srcs": ["S001·11"]},
    {"topic": "T4", "text": r"Two functions $y_1$ and $y_2$ are linearly independent when $c_1y_1+c_2y_2\neq0$ for non zero constants $c_1$ and $c_2$, i.e. $c_1y_1\neq-c_2y_2\ \to\ y_1\neq\left(\frac{-c_2}{c_1}\right)y_2$.",
     "srcs": ["S001·14"]},
    {"topic": "T4", "text": r"If $y_1$ and $y_2$ are two linearly independent solutions of a second order homogeneous linear differential equation, then $c_1y_1+c_2y_2$ is also a solution of the differential equation. It is the complete solution of the differential equation.",
     "srcs": ["S001·15"]},
    {"topic": "T4", "text": r"If the $n$th order LDE with constant coefficients $\frac{d^ny}{dx^n}+a_1\frac{d^{n-1}y}{dx^{n-1}}+a_2\frac{d^{n-2}y}{dx^{n-2}}+\dots+a_ny=0$ has $n$ linearly independent solutions $y_1,y_2,y_3,\dots,y_n$, then their linear combination "
                            r"$c_1y_1+c_2y_2+\dots+c_ny_n$ is also a solution of the differential equation. $y=c_1y_1+c_2y_2+\dots+c_ny_n$, the complete solution is called COMPLEMENTARY FUNCTION of the differential equation.",
     "srcs": ["S001·16"]},
    {"topic": "T5", "text": "The general solution of the non homogeneous linear differential equation has two components: Complementary Function and particular Integral. The complementary function is the complete solution of homogeneous linear differential equation.",
     "srcs": ["S001·12"]},
    {"topic": "T5", "text": r"Consider a non homogeneous linear differential equation $f(D)y=X$. If $y=y_c$ is the complete solution of $f(D)y=0$ and $y=y_p$ is a particular solution of the differential equation $f(D)y=X$, then the complete solution is $y=y_c+y_p$. The particular solution $y_p$ is called PARTICULAR INTEGRAL.",
     "srcs": ["S001·17"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "First-order linear DE", "tex": r"\frac{dy}{dx}+P\,y=Q",
     "gives": "The general linear equation of order 1.", "when": r"$P$, $Q$ functions of $x$ alone.",
     "note": "Solved in the earlier unit by an integrating factor; not part of Unit 2.", "stars": 1, "srcs": ["S001·6", "S001·7", "T001 00:07:04"]},
    {"id": "E1.2", "topic": "T1", "title": "Second-order linear DE", "tex": r"\frac{d^2y}{dx^2}+P_1\frac{dy}{dx}+P_2\,y=X",
     "gives": "The general linear equation of order 2.", "when": r"$P_1$, $P_2$, $X$ functions of $x$ alone.",
     "note": r"The lecture writes $P_0y''+P_1y'+P_2y=X$ with $P_0\neq0$; dividing by $P_0$ gives the slide's form.", "stars": 2,
     "srcs": ["S001·7", "T001 00:07:22"]},
    {"id": "E1.3", "topic": "T1", "title": "Linear DE of order $n$",
     "tex": r"\frac{d^ny}{dx^n}+a_1\frac{d^{n-1}y}{dx^{n-1}}+a_2\frac{d^{n-2}y}{dx^{n-2}}+\dots+a_ny=X",
     "gives": r"The general linear equation of order $n$.", "when": r"$a_1,\dots,a_n$ functions of $x$ or constants; $X$ a function of $x$ alone.",
     "note": r"Slide 001·7 writes $P_1,\dots,P_n$; slide 001·8 onward $a_1,\dots,a_n$.", "stars": 2, "srcs": ["S001·7", "S001·8", "T001 00:08:38", "T001 00:09:46"]},
    {"id": "E2.1", "topic": "T2", "title": "Homogeneous and non-homogeneous", "tex": r"X=0:\ \text{homogeneous};\qquad X\not\equiv0:\ \text{non-homogeneous}",
     "gives": "The type of the equation from its right-hand side.", "when": "Any LDE (the deck states it for constant coefficients).",
     "note": r"Slide 001·10: $2y''-3y'+9y=0$ (homogeneous) and $2y''-3y'+9y=x\sinh x$ (non-homogeneous).", "stars": 2,
     "srcs": ["S001·10", "T001 00:13:22", "T001 00:13:52"]},
    {"id": "E3.1", "topic": "T3", "title": "Operator notation", "tex": r"D=\frac{d}{dx},\quad D^2=\frac{d^2}{dx^2},\quad D^3=\frac{d^3}{dx^3},\ \dots,\ D^n=\frac{d^n}{dx^n}",
     "gives": r"Shorthand for derivatives: $Dy=y'$, $D^2y=y''$.", "when": "Always; ESA questions use it.", "note": r"$D^2y$ means $\frac{d^2y}{dx^2}$, not $\left(\frac{dy}{dx}\right)^2$.",
     "stars": 3, "srcs": ["S001·11", "T001 00:15:16"]},
    {"id": "E3.2", "topic": "T3", "title": "The equation as $f(D)y=X$", "tex": r"f(D)\,y=X,\qquad f(D)=D^n+a_1D^{n-1}+a_2D^{n-2}+\dots+a_n",
     "gives": "The compact form used in every later class.", "when": r"Constant $a_i$: $f(D)$ is a polynomial in $D$.",
     "note": r"$a_n$ multiplies $y$ itself ($D^0=1$).", "stars": 3, "srcs": ["S001·11", "S001·12", "T001 00:16:29"]},
    {"id": "E3.3", "topic": "T3", "title": "Factorising $f(D)$ (constant coefficients)", "tex": r"(D-\alpha)(D-\beta)y=(D-\beta)(D-\alpha)y=\big[D^2-(\alpha+\beta)D+\alpha\beta\big]y",
     "gives": r"$f(D)$ may be factorised into linear factors, taken in any order.", "when": r"$\alpha,\beta$ constants.",
     "note": "“It obeys the laws of algebra” (T001 00:16:49). Fails for variable coefficients.", "stars": 2, "srcs": ["T001 00:16:49", "T001 00:17:07"]},
    {"id": "E3.4", "topic": "T3", "title": "Preview: $f(D)$ acting on $e^{mx}$", "tex": r"D^ke^{mx}=m^ke^{mx}\ \Longrightarrow\ f(D)e^{mx}=f(m)e^{mx}",
     "gives": r"$e^{mx}$ solves $f(D)y=0$ exactly when $f(m)=0$, the auxiliary equation.", "when": "Constant coefficients.",
     "note": "Not in this deck; the auxiliary equation and all CF cases are class 002.", "stars": 3, "srcs": ["S001·16"], "flags": [ADD]},
    {"id": "E4.1", "topic": "T4", "title": "Linear dependence and independence",
     "tex": r"\text{independent:}\quad c_1f_1+c_2f_2+\dots+c_nf_n=0\ \Rightarrow\ c_1=c_2=\dots=c_n=0",
     "gives": "The test for a set of functions.", "when": r"On an interval $I$; “$=0$” means for every $x$ in $I$.",
     "note": "Dependent: some constants not all zero make the combination vanish.", "stars": 1, "srcs": ["S001·13", "T001 00:19:05", "T001 00:20:17"]},
    {"id": "E4.2", "topic": "T4", "title": "Two functions", "tex": r"y_1,\,y_2\ \text{independent}\iff \frac{y_1}{y_2}\neq\text{constant}",
     "gives": "A quick test for a pair.", "when": "Two functions only.",
     "note": "Neither is a constant multiple of the other (T001 00:22:00).", "stars": 2, "srcs": ["S001·14", "T001 00:21:01", "T001 00:22:00"]},
    {"id": "E4.3", "topic": "T4", "title": "Wronskian of two functions", "tex": r"W(y_1,y_2)=\begin{vmatrix}y_1&y_2\\y_1'&y_2'\end{vmatrix}=y_1y_2'-y_2y_1'",
     "gives": r"$W\neq0$ (at some point of $I$) shows $y_1,y_2$ independent; for two solutions of the same LDE, $W\equiv0$ means dependent.",
     "when": r"For $n$ functions: the $n\times n$ determinant of the functions and their first $n-1$ derivatives.",
     "note": r"Not in the deck. $W(e^x,e^{2x})=e^{3x}$, $W(e^x,3e^x)=0$. Used in class 011 (variation of parameters).", "stars": 1,
     "srcs": ["S001·14"], "flags": [ADD]},
    {"id": "E4.4", "topic": "T4", "title": "Superposition: the complementary function", "tex": r"y_c=c_1y_1+c_2y_2+\dots+c_ny_n",
     "gives": r"The complete solution of the homogeneous LDE $f(D)y=0$ of order $n$.", "when": r"$y_1,\dots,y_n$ are $n$ linearly independent solutions.",
     "note": r"Second order: $y_c=c_1y_1+c_2y_2$. Exactly $n$ arbitrary constants.", "stars": 3, "srcs": ["S001·15", "S001·16", "T001 00:24:29", "T001 00:25:14"]},
    {"id": "E5.1", "topic": "T5", "title": "Complete solution of $f(D)y=X$", "tex": r"y=y_c+y_p=\text{CF}+\text{PI}",
     "gives": "The answer to every non-homogeneous LDE.", "when": r"$y_c$: complete solution of $f(D)y=0$; $y_p$: any one solution of $f(D)y=X$.",
     "note": "All 24 Unit 2 ESA occurrences are answered in this form.", "stars": 3, "srcs": ["S001·12", "S001·17", "T001 00:27:16", "T001 00:27:34"]},
    {"id": "E5.2", "topic": "T5", "title": "Why it works (linearity)", "tex": r"f(D)(y_c+y_p)=f(D)y_c+f(D)y_p=0+X=X",
     "gives": r"$y_c+y_p$ solves $f(D)y=X$ and has all $n$ constants.", "when": r"$f(D)$ linear.",
     "note": r"Also: the PI of $X_1+X_2$ is the sum of the PIs of $X_1$ and $X_2$ (W5.3).", "stars": 2, "srcs": ["S001·17"], "flags": [ADD]},
]

POINTS = [
    {"topic": "T5", "text": r"Every Unit 2 ESA question (19 distinct, 24 occurrences in 8 papers) is a non-homogeneous linear DE whose answer is $y=\text{CF}+\text{PI}$. Write both parts and add them; an answer with only the CF or only the PI is incomplete.",
     "stars": 3, "srcs": ["S001·17", "ESA Dec-23 3a", "ESA Jul-23 3b", "ESA Jan-24 s2 2d"]},
    {"topic": "T5", "text": r"The CF holds all $n$ arbitrary constants of an $n$-th order equation; the PI has none. Count the constants as a check.",
     "stars": 3, "srcs": ["S001·16", "S001·17", "T001 00:25:38"]},
    {"topic": "T5", "text": r"The CF is the complete solution of the associated homogeneous equation $f(D)y=0$ (put $X=0$); find it first.",
     "stars": 3, "srcs": ["S001·12", "T001 00:17:58", "T001 00:26:57"]},
    {"topic": "T3", "text": r"Constant-coefficient ESA questions are written as $f(D)y=X$, e.g. $(D-2)^2y=8(e^{2x}+\sin2x)$ and $(D^3-6D^2+11D-6)y=e^{2x}+x$; read $D$ as $\frac{d}{dx}$.",
     "stars": 3, "srcs": ["S001·11", "ESA Dec-23 3a", "ESA Jan-24 s2 2d"]},
    {"topic": "T3", "text": r"$f(D)$ with constant coefficients behaves like an algebraic polynomial: factorise it into linear factors, in any order.",
     "stars": 2, "srcs": ["T001 00:16:49", "T001 00:17:07"]},
    {"topic": "T1", "text": r"Linear means: $y$ and its derivatives only to the first degree, never multiplied together, and coefficients free of $y$. $y\frac{dy}{dx}$, $y^2$, $\sin y$, $e^{y}$ make an equation non-linear.",
     "stars": 1, "srcs": ["S001·5", "S001·6", "T001 00:05:18", "T001 00:05:34"]},
    {"topic": "T1", "text": "The order is the highest derivative present, not the highest power.", "stars": 1, "srcs": ["T001 00:05:51", "T001 00:11:19"]},
    {"topic": "T1", "text": r"Unit 2 treats only linear equations of order 2 and higher; first-order and non-linear equations were the previous unit.", "stars": 1,
     "srcs": ["T001 00:04:04", "T001 00:04:22"]},
    {"topic": "T2", "text": r"Classify before solving: constant coefficients (classes 002–006, operator methods) or variable coefficients (class 011: Legendre and Cauchy forms, 8 ESA occurrences). Homogeneous (CF only) or non-homogeneous (CF + PI).",
     "stars": 2, "srcs": ["S001·3", "S001·8", "S001·9", "ESA Jan-24 s3 3d"]},
    {"topic": "T2", "text": r"A constant term or a function of $x$ on the right makes the equation non-homogeneous; only $X\equiv0$ is homogeneous.", "stars": 2,
     "srcs": ["S001·10", "T001 00:13:34"]},
    {"topic": "T2", "text": r"Every non-homogeneous LDE has an associated homogeneous equation: the same left side with $X$ replaced by 0.", "stars": 2,
     "srcs": ["T001 00:14:27", "T001 00:14:52"]},
    {"topic": "T4", "text": r"Two functions are independent when neither is a constant multiple of the other: $e^x,e^{2x}$ and $\sin x,\cos x$ are; $e^x,3e^x$ are not.",
     "stars": 2, "srcs": ["S001·14", "T001 00:22:00"]},
    {"topic": "T4", "text": r"Any linear combination of solutions of a homogeneous LDE is again a solution (superposition). With $n$ independent solutions it is the complete solution, the CF.",
     "stars": 3, "srcs": ["S001·15", "S001·16", "T001 00:24:11"]},
    {"topic": "T4", "text": r"“Very important concept”: linearly independent and dependent functions (T001 00:18:47). Independence guarantees the $n$ constants are genuinely different.",
     "stars": 2, "srcs": ["T001 00:18:47", "S001·13"]},
]

WHY = [
    {"topic": "T4", "q": "Why must the solutions in the CF be linearly independent?",
     "a": r"If $y_2=ky_1$, then $c_1y_1+c_2y_2=(c_1+kc_2)y_1$ has only one effective constant, so it cannot be the complete solution of a "
          r"second-order equation, which needs two. Independence makes the $n$ constants genuinely different.",
     "srcs": ["S001·14", "S001·15", "T001 00:22:18"]},
    {"topic": "T5", "q": r"Why is $y_c+y_p$ the complete solution of $f(D)y=X$?",
     "a": r"$f(D)$ is linear: $f(D)(y_c+y_p)=0+X$. Conversely, if $y$ is any solution, $f(D)(y-y_p)=0$, so $y-y_p$ is a solution of the "
          r"homogeneous equation and is contained in $y_c$. Hence every solution has the form $y_c+y_p$.",
     "srcs": ["S001·17"], "flags": [ADD]},
    {"topic": "T5", "q": "Why is the PI called “particular”?",
     "a": r"It is one particular solution, with no arbitrary constants. Any other choice differs from it by a solution of $f(D)y=0$, which the CF "
          r"absorbs: $\frac12e^{3x}$ and $\frac12e^{3x}+e^x$ are both PIs of $y''-3y'+2y=e^{3x}$ (W5.1).",
     "srcs": ["S001·17", "T001 00:27:34"], "flags": [ADD]},
    {"topic": "T3", "q": "Why is the operator notation useful?",
     "a": r"With constant coefficients $f(D)$ is a polynomial: it can be factorised, and (class 002) $f(D)e^{mx}=f(m)e^{mx}$ turns the DE into an "
          r"algebraic equation. Classes 003–006 also invert it, $y_p=\frac1{f(D)}X$.",
     "srcs": ["S001·11", "T001 00:16:49"], "flags": [ADD]},
]

TRAPS = [
    {"topic": "T4", "text": r"The lecture says $c_1y_1+c_2y_2$ is a solution “only when $y_1$ and $y_2$ are linearly independent” (T001 00:23:40). Wrong: every combination of solutions of a homogeneous LDE is a solution. Independence is what makes it the <i>complete</i> solution.",
     "srcs": ["T001 00:23:40", "S001·15"], "flags": [ADD]},
    {"topic": "T4", "text": r"Slide 001·14's “$c_1y_1+c_2y_2\neq0$ for non zero constants” must be read as: the combination is not identically zero unless $c_1=c_2=0$. Equivalently $y_1/y_2$ is not a constant.",
     "srcs": ["S001·14", "T001 00:22:00"], "flags": [ADD]},
    {"topic": "T4", "text": r"Superposition holds for the homogeneous equation only. Two PIs of $f(D)y=X$ do not add to a PI: their sum solves $f(D)y=2X$.",
     "srcs": ["S001·17"], "flags": [ADD]},
    {"topic": "T3", "text": r"$f(D)$ commutes and factorises like a polynomial only with constant coefficients: $D(xDy)=xD^2y+Dy\neq xD(Dy)$.",
     "srcs": ["T001 00:16:49"], "flags": [ADD]},
    {"topic": "T3", "text": r"$D^2y$ is $\frac{d^2y}{dx^2}$, not $\left(\frac{dy}{dx}\right)^2$; and the last coefficient $a_n$ multiplies $y$, so $(D^2+4)y=y''+4y$.",
     "srcs": ["S001·11"], "flags": [ADD]},
    {"topic": "T1", "text": r"The lecture says “$P_0$ equal to 0” for the second-order form (T001 00:07:34); it must be $P_0\neq0$, otherwise the equation is not of order 2.",
     "srcs": ["T001 00:07:34", "T001 00:08:55"]},
    {"topic": "T2", "text": r"$2x^3y'''-(5x^2+2)y''+xy'+y=x^2\sin x$ is linear (variable coefficients). Functions of $x$ in the coefficients do not make an equation non-linear; only $y$ in a coefficient does.",
     "srcs": ["S001·9", "T001 00:12:08"]},
    {"topic": "T5", "text": r"Put the constants in the CF only; the PI has none. Do not fit initial conditions to the CF alone: apply them to $y=y_c+y_p$.",
     "srcs": ["S001·17"], "flags": [ADD]},
]

WORKED = [
    {"id": "W1.1", "topic": "T1", "title": "Linear or non-linear? (slide 001·5)", "srcs": ["S001·5", "T001 00:03:46", "T001 00:05:18"], "stars": 1,
     "given": r"Classify (a) $\frac{dy}{dx}+2xy=x^2$ and (b) $y^2\frac{dy}{dx}+\sin y=x^2e^{2y}$.",
     "steps": [r"(a) $y$ and $\frac{dy}{dx}$ occur to the first degree, not multiplied together; the coefficient $2x$ is a function of $x$ only.",
               r"(b) $y^2\frac{dy}{dx}$ multiplies $y$ (squared) by its derivative; $\sin y$ and $e^{2y}$ are not first degree in $y$."],
     "answer": "(a) linear, order 1; (b) non-linear, order 1.", "check": "Both definitions (slide 001·6 and the lecture's two conditions) agree."},
    {"id": "W2.1", "topic": "T2", "title": "Classify the deck's four equations", "srcs": ["S001·8", "S001·9", "S001·10", "T001 00:11:01", "T001 00:12:26", "T001 00:14:09"], "stars": 2,
     "given": r"Give order, type of coefficients and homogeneity: (a) $2y'''-5y''+7y'+y=x^2$; (b) $2x^3y'''-(5x^2+2)y''+xy'+y=x^2\sin x$; (c) $2y''-3y'+9y=0$; (d) $2y''-3y'+9y=x\sinh x$.",
     "steps": [r"(a) Coefficients $2,-5,7,1$ are numbers; highest derivative $y'''$; $X=x^2\neq0$.",
               r"(b) Coefficients $2x^3,\ -(5x^2+2),\ x,\ 1$ are functions of $x$; order 3; $X=x^2\sin x$.",
               r"(c) Constants $2,-3,9$; order 2; $X=0$. (d) Same left side; $X=x\sinh x\neq0$, and (c) is its associated homogeneous equation."],
     "answer": "(a) order 3, constant coefficients, non-homogeneous; (b) order 3, variable coefficients, non-homogeneous; (c) order 2, constant, homogeneous; (d) order 2, constant, non-homogeneous.",
     "check": r"sympy: the general solution of (a) has 3 constants, matching order 3; $y=e^{3x/4}\cos\frac{3\sqrt7x}{4}$ satisfies (c) (roots of $2m^2-3m+9=0$ are $\frac34\pm\frac{3\sqrt7}4i$)."},
    {"id": "W3.1", "topic": "T3", "title": "Write in operator form", "srcs": ["S001·8", "S001·11", "ESA Jan-24 s2 2d"], "stars": 3,
     "given": r"Write (a) $2\frac{d^3y}{dx^3}-5\frac{d^2y}{dx^2}+7\frac{dy}{dx}+y=x^2$ and (b) $y'''-6y''+11y'-6y=e^{2x}+x$ as $f(D)y=X$.",
     "steps": [r"Replace $\frac{d^ky}{dx^k}$ by $D^ky$ and take $y$ out: (a) $(2D^3-5D^2+7D+1)y=x^2$.",
               r"In the slide's normalised form divide by 2: $\left(D^3-\tfrac52D^2+\tfrac72D+\tfrac12\right)y=\tfrac12x^2$.",
               r"(b) $(D^3-6D^2+11D-6)y=e^{2x}+x$, exactly as ESA Jan-24 s2 2d is printed; $f(D)=(D-1)(D-2)(D-3)$."],
     "answer": r"(a) $f(D)=2D^3-5D^2+7D+1$, $X=x^2$. (b) $f(D)=D^3-6D^2+11D-6=(D-1)(D-2)(D-3)$, $X=e^{2x}+x$.",
     "check": r"Expanding $(D-1)(D-2)(D-3)$ gives $D^3-6D^2+11D-6$ (sympy)."},
    {"id": "W3.2", "topic": "T3", "title": "Factors commute (constant coefficients only)", "srcs": ["T001 00:16:49", "T001 00:17:07"], "stars": 2, "flags": [ADD],
     "given": r"Show $(D-1)(D-2)u=(D-2)(D-1)u=(D^2-3D+2)u$ for any $u(x)$, and that $D(xD)\neq(xD)D$.",
     "steps": [r"$(D-2)u=u'-2u$; then $(D-1)(u'-2u)=u''-2u'-u'+2u=u''-3u'+2u$.",
               r"$(D-1)u=u'-u$; then $(D-2)(u'-u)=u''-u'-2u'+2u=u''-3u'+2u$. Same.",
               r"Variable coefficient: $D(xu')=u'+xu''$, but $xD(u')=xu''$. They differ by $u'$."],
     "answer": r"Constant-coefficient factors commute; $D(xD)-(xD)D=D$.", "check": "sympy: difference 0 in the first case and $u'$ in the second."},
    {"id": "W4.1", "topic": "T4", "title": "Dependent or independent?", "srcs": ["S001·13", "S001·14", "T001 00:22:00"], "stars": 2,
     "given": r"Test (a) $e^x,e^{2x}$; (b) $e^x,3e^x$; (c) $\sin x,\cos x$; (d) $1,x,x^2$.",
     "steps": [r"(a) $e^{2x}/e^x=e^x$, not constant: independent. $W=e^x\cdot2e^{2x}-e^{2x}\cdot e^x=e^{3x}\neq0$.",
               r"(b) $3e^x/e^x=3$, constant: $3\cdot e^x-1\cdot3e^x=0$ with $c_1=3,c_2=-1$ not zero. Dependent; $W=0$.",
               r"(c) $\tan x$ is not constant; $W=\sin x(-\sin x)-\cos x\cos x=-1\neq0$. Independent.",
               r"(d) $c_1+c_2x+c_3x^2\equiv0$ forces $c_1=c_2=c_3=0$ (a nonzero polynomial has finitely many roots); $W=2$."],
     "answer": "(a) independent, (b) dependent, (c) independent, (d) independent.", "check": "sympy Wronskians: $e^{3x}$, 0, $-1$, 2."},
    {"id": "W4.2", "topic": "T4", "title": "Superposition for $y''-3y'+2y=0$", "srcs": ["S001·15", "T001 00:23:19"], "stars": 3,
     "given": r"Verify that $y_1=e^x$ and $y_2=e^{2x}$ solve $(D^2-3D+2)y=0$, and that $c_1e^x+c_2e^{2x}$ is the complete solution.",
     "steps": [r"$y_1$: $e^x-3e^x+2e^x=0$. $y_2$: $4e^{2x}-6e^{2x}+2e^{2x}=0$.",
               r"$(D^2-3D+2)(c_1y_1+c_2y_2)=c_1\cdot0+c_2\cdot0=0$ by linearity.",
               r"$y_1,y_2$ independent (W4.1a) and the order is 2, so two constants suffice."],
     "answer": r"$y_c=c_1e^x+c_2e^{2x}$", "check": "sympy dsolve gives the same; substitution gives 0 for all $c_1,c_2$."},
    {"id": "W5.1", "topic": "T5", "title": "Check a CF + PI solution", "srcs": ["S001·17"], "stars": 3, "flags": [ADD],
     "given": r"Verify that $y=c_1e^x+c_2e^{2x}+\frac12e^{3x}$ is the complete solution of $(D^2-3D+2)y=e^{3x}$.",
     "steps": [r"CF: $c_1e^x+c_2e^{2x}$ solves $(D^2-3D+2)y=0$ (W4.2).",
               r"PI: $y_p=\frac12e^{3x}$: $\frac92e^{3x}-\frac92e^{3x}+e^{3x}=e^{3x}$ ✓.",
               r"Sum: $f(D)(y_c+y_p)=0+e^{3x}$; two constants for order 2."],
     "answer": r"$y=c_1e^x+c_2e^{2x}+\tfrac12e^{3x}$ (CF + PI)",
     "check": r"sympy dsolve agrees. $\frac12e^{3x}+e^x$ is also a PI; the extra $e^x$ is absorbed in $c_1$."},
    {"id": "W5.2", "topic": "T5", "title": "Anatomy of an ESA answer (ESA Dec-23 3a)", "srcs": ["ESA Dec-23 3a", "ESA May-24 3b", "ESA Jun-24 2a"], "stars": 3,
     "given": r"Solve $(D-2)^2y=8(e^{2x}+\sin2x)$ (asked 3 times). Identify the CF, the PI and the complete solution.",
     "steps": [r"Associated homogeneous: $(D-2)^2y=0$; the root 2 repeats, so $y_c=(c_1+c_2x)e^{2x}$ (class 002).",
               r"PI (classes 003–004): $y_p=4x^2e^{2x}+\cos2x$. Check: $(D-2)^2(4x^2e^{2x})=8e^{2x}$ and $(D^2-4D+4)\cos2x=8\sin2x$.",
               r"Add: $y=y_c+y_p$."],
     "answer": r"$y=(c_1+c_2x)e^{2x}+4x^2e^{2x}+\cos2x$",
     "check": "sympy dsolve and checkodesol agree. The PI methods are in the class 004 pack; here only the structure matters."},
    {"id": "W5.3", "topic": "T5", "title": "PI of a sum is the sum of PIs (ESA Jul-23 3b)", "srcs": ["ESA Jul-23 3b"], "stars": 3,
     "given": r"For $(D^2-5D+6)y=e^{4x}+\sin x+x^2$, verify $y_{p1}=\frac12e^{4x}$, $y_{p2}=\frac1{10}(\sin x+\cos x)$, $y_{p3}=\frac{x^2}6+\frac{5x}{18}+\frac{19}{108}$ for the three terms, and write the complete solution.",
     "steps": [r"$f(D)y_{p1}=e^{4x}$, $f(D)y_{p2}=\sin x$, $f(D)y_{p3}=x^2$ (substitute each; sympy).",
               r"Linearity: $f(D)(y_{p1}+y_{p2}+y_{p3})=e^{4x}+\sin x+x^2$, so the PI is the sum.",
               r"CF: $f(D)=(D-2)(D-3)$, $y_c=c_1e^{2x}+c_2e^{3x}$."],
     "answer": r"$y=c_1e^{2x}+c_2e^{3x}+\tfrac12e^{4x}+\tfrac1{10}(\sin x+\cos x)+\tfrac{x^2}6+\tfrac{5x}{18}+\tfrac{19}{108}$",
     "check": "sympy dsolve and checkodesol agree. How each PI is found: class 005 pack."},
]

PYQS = [
    {"topic": "T5", "paper": "ESA Dec 2023", "q": "UE22MA141A Q3.a (also May 2024 Q3.b, June 2024 Q2.a)", "marks": 7,
     "text": r"Solve $(D-2)^2y=8(e^{2x}+\sin2x)$. (Here: the CF + PI structure.)", "worked": "W5.2"},
    {"topic": "T5", "paper": "ESA Jul 2023", "q": "UE22MA141A Q3.b", "marks": 7,
     "text": r"Solve $(D^2-5D+6)y=e^{4x}+\sin x+x^2$. (Here: the PI of a sum.)", "worked": "W5.3"},
    {"topic": "T3", "paper": "ESA Jan 2024", "q": "UE23MA141A set 2, Q2.d", "marks": 5,
     "text": r"Solve $(D^3-6D^2+11D-6)y=e^{2x}+x$. (Here: reading $f(D)$; full solution in class 005.)", "worked": "W3.1"},
]

NOTES = [
    {"topic": "T1", "text": r"A DE is linear when $y$ and its derivatives occur only in the first degree and are not multiplied together; coefficients may be functions of $x$ "
     r"or constants, never of $y$. Order = highest derivative. Linear of order $n$: $y^{(n)}+a_1y^{(n-1)}+\dots+a_ny=X$. Example: $\frac{dy}{dx}+2xy=x^2$ is linear; "
     r"$y^2\frac{dy}{dx}+\sin y=x^2e^{2y}$ is not."},
    {"topic": "T2", "text": r"Two forms: constant coefficients ($2y'''-5y''+7y'+y=x^2$) and variable coefficients ($2x^3y'''-(5x^2+2)y''+xy'+y=x^2\sin x$). Homogeneous: $X=0$ "
     r"($2y''-3y'+9y=0$); non-homogeneous: $X$ a nonzero function of $x$ ($2y''-3y'+9y=x\sinh x$). Putting $X=0$ gives the associated homogeneous equation."},
    {"topic": "T3", "text": r"$D=\frac{d}{dx}$, $D^n=\frac{d^n}{dx^n}$. The LDE becomes $f(D)y=X$ with $f(D)=D^n+a_1D^{n-1}+\dots+a_n$, the linear differential operator. "
     r"With constant coefficients $f(D)$ is a polynomial in $D$: factorise it, in any order. Preview: $f(D)e^{mx}=f(m)e^{mx}$ (class 002)."},
    {"topic": "T4", "text": r"$f_1,\dots,f_n$ are linearly dependent if $c_1f_1+\dots+c_nf_n=0$ with constants not all zero; otherwise independent. Two functions: independent if neither "
     r"is a constant multiple of the other ($e^x,e^{2x}$ yes; $e^x,3e^x$ no). If $y_1,\dots,y_n$ are $n$ independent solutions of the homogeneous LDE, the complete solution "
     r"$c_1y_1+\dots+c_ny_n$ is the complementary function."},
    {"topic": "T5", "text": r"For $f(D)y=X$: $y=y_c+y_p$, where $y_c$ (CF) is the complete solution of $f(D)y=0$ and $y_p$ (PI) is one particular solution of $f(D)y=X$. "
     r"CF: $n$ constants; PI: none. Linearity gives $f(D)(y_c+y_p)=X$, and the PI of a sum of terms is the sum of their PIs. Every Unit 2 ESA answer has this form."},
]

FIGS = [
    {"id": "G4.1", "topic": "T4", "title": "Superposition: a combination of solutions is a solution", "stars": 3,
     "srcs": ["S001·15", "S001·16"], "flags": [ADD],
     "howto": r"For $y''+y=0$, $y_1=\sin x$ (blue) and $y_2=\cos x$ (vermilion dashed) are independent solutions. Their combination "
              r"$2\sin x+\cos x$ (green) is again a solution; it has a different amplitude and phase, so it is not a multiple of either. "
              r"Varying $c_1,c_2$ gives every solution: the CF $c_1\sin x+c_2\cos x$ (sympy dsolve)."},
    {"id": "G4.2", "topic": "T4", "title": "The ratio test for two functions", "stars": 2,
     "srcs": ["S001·14", "T001 00:22:00"], "flags": [ADD],
     "howto": r"Plot $y_2/y_1$. For $e^x$ and $3e^x$ the ratio is the constant 3 (vermilion dashed): dependent. For $e^x$ and $e^{2x}$ it is $e^x$ "
              r"(blue), and for $\sin x$ and $\cos x$ it is $\cot x$ (green): not constant, so independent. A constant ratio is exactly linear dependence."},
    {"id": "G5.1", "topic": "T5", "title": "Every solution is CF + PI: one PI, many CFs", "stars": 3,
     "srcs": ["S001·17", "S001·12"], "flags": [ADD],
     "howto": r"For $y''+3y'+2y=10\cos x$ the PI is $y_p=\cos x+3\sin x$ (black dashed) and the CF is $c_1e^{-x}+c_2e^{-2x}$. Four choices of "
              r"$c_1,c_2$ (coloured curves) start at different values but all approach $y_p$, because here the CF decays. The constants come from the "
              r"CF only; the PI is the same for all. Every curve was checked with sympy dsolve."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "Classifying an ordinary differential equation (slide 001·5)", "stars": 1,
     "srcs": ["S001·5", "T001 00:02:54", "T001 00:03:46"], "layout": "tree", "maxw": "160mm",
     "spec": {"root": {"kind": "given", "title": "Ordinary differential equation", "sub": "any order"},
              "branches": [
                  {"title": "Linear DE", "sub": "$y$, $y'$, … first degree, not multiplied together",
                   "rows": [["Example", "$\\frac{dy}{dx}+2xy=x^2$"], ["Order", "1"]]},
                  {"title": "Non-linear DE", "sub": "not linear",
                   "rows": [["Example", "$y^2\\frac{dy}{dx}+\\sin y=x^2e^{2y}$"], ["Order", "1"]]}]},
     "remark": "Unit 2 treats only the left branch, for orders 2 and higher."},
    {"id": "F2.1", "topic": "T2", "title": "Classifying a linear DE (slides 001·8–001·10)", "stars": 2,
     "srcs": ["S001·8", "S001·9", "S001·10", "T001 00:10:11", "T001 00:13:13"], "layout": "ladder", "maxw": "160mm",
     "spec": {"start": {"kind": "given", "title": "Linear DE of order $n$", "sub": "$y^{(n)}+a_1y^{(n-1)}+\\dots+a_ny=X$"},
              "rungs": [{"q": "Is some $a_i$ a function of $x$?", "yes": {"lab": "", "title": "Variable coefficients", "sub": "e.g. Legendre, Cauchy (class 011)"}},
                        {"q": "Is $X\\equiv0$?", "yes": {"lab": "", "title": "Homogeneous, constant coefficients", "sub": "solution = CF (class 002)"}}],
              "last": {"kind": "result", "title": "Non-homogeneous, constant coefficients", "fx": "$y=\\text{CF}+\\text{PI}$ (classes 002–006)"}},
     "remark": "Slide 001·10 draws the homogeneous / non-homogeneous split as a tree under “LDE with constant coefficients”; the example pair is $2y''-3y'+9y=0$ and $2y''-3y'+9y=x\\sinh x$."},
    {"id": "F5.1", "topic": "T5", "title": "The plan of every Unit 2 answer", "stars": 3,
     "srcs": ["S001·12", "S001·17", "T001 00:18:29", "ESA Dec-23 3a"], "layout": "streams", "maxw": "165mm",
     "spec": {"left": [{"kind": "given", "title": "Associated homogeneous", "sub": "$f(D)y=0$"},
                       {"kind": "step", "n": 1, "title": "Complementary function", "fx": "$y_c=c_1y_1+\\dots+c_ny_n$", "sub": "class 002"}],
              "right": [{"kind": "given", "title": "Given equation", "sub": "$f(D)y=X$"},
                        {"kind": "step", "n": 2, "title": "Particular integral", "fx": "one solution $y_p$, no constants", "sub": "classes 003–006"}],
              "then": [{"kind": "result", "title": "Complete solution", "fx": "$y=y_c+y_p$"},
                       {"kind": "check", "title": "Check", "sub": "$n$ constants; $f(D)y_p=X$ by substitution"}]},
     "remark": "Initial conditions, if given, are applied to the complete solution $y_c+y_p$, never to the CF alone."},
    {"id": "F4.1", "topic": "T4", "title": "Are two functions linearly independent?", "stars": 2,
     "srcs": ["S001·13", "S001·14", "T001 00:22:00"], "layout": "fork", "maxw": "150mm",
     "spec": {"before": [{"kind": "given", "title": "Two functions $y_1,\\ y_2$", "sub": "on an interval $I$"},
                         {"kind": "step", "n": 1, "title": "Form the ratio", "fx": "$y_1/y_2$ (or the Wronskian $W$)"}],
              "question": "Is the ratio a constant ($W\\equiv0$)?",
              "no": {"kind": "step", "title": "Linearly independent", "fx": "$c_1y_1+c_2y_2$: two genuine constants"},
              "yes": {"kind": "step", "title": "Linearly dependent", "fx": "$y_1=ky_2$: only one constant"},
              "after": [{"kind": "check", "title": "Use in the CF", "sub": "order $n$ needs $n$ independent solutions"}]},
     "remark": "The Wronskian is added for clarity (not in the deck). For a set of $n$ functions use the definition E4.1 or the $n\\times n$ Wronskian.",
     "flags": [ADD]},
]

COMPARISONS = [
    {"id": "C2.1", "topic": "T2", "title": "The forms of a linear DE in the deck", "srcs": ["S001·7", "S001·8", "S001·9", "S001·10"],
     "head": ["Form", "Coefficients", "RHS $X$", "Deck example", "Order"],
     "rows": [["First-order linear", "$P$ function of $x$", "$Q(x)$", "$\\frac{dy}{dx}+2xy=x^2$", "1"],
              ["Constant coefficients", "numbers", "$x^2$", "$2y'''-5y''+7y'+y=x^2$", "3"],
              ["Variable coefficients", "functions of $x$", "$x^2\\sin x$", "$2x^3y'''-(5x^2+2)y''+xy'+y=x^2\\sin x$", "3"],
              ["Homogeneous (const.)", "numbers", "0", "$2y''-3y'+9y=0$", "2"],
              ["Non-homogeneous (const.)", "numbers", "$x\\sinh x$", "$2y''-3y'+9y=x\\sinh x$", "2"]]},
    {"id": "C5.1", "topic": "T5", "title": "Complementary function against particular integral", "srcs": ["S001·12", "S001·16", "S001·17"],
     "head": ["", "Complementary function $y_c$", "Particular integral $y_p$"],
     "rows": [["Solves", "$f(D)y=0$ (associated homogeneous)", "$f(D)y=X$ (given equation)"],
              ["Arbitrary constants", "$n$ (order of the DE)", "none"],
              ["Form", "$c_1y_1+\\dots+c_ny_n$, $y_i$ independent", "one function of $x$"],
              ["Unique?", "the complete family", "no: any two differ by part of the CF"],
              ["Depends on", "$f(D)$ only", "$f(D)$ and $X$"],
              ["Found in", "class 002 (auxiliary equation)", "classes 003–006, 011 (variation of parameters)"]]},
    {"id": "C5.2", "topic": "T5", "title": "Every Unit 2 ESA question is CF + PI", "srcs": ["ESA Dec-23 3a", "ESA Jul-23 3c", "ESA Jan-24 s3 3b", "ESA Jan-24 s3 3d", "ESA Dec-23 3c"],
     "head": ["Kind of question", "Distinct (occurrences)", "Coefficients", "Answer form"],
     "rows": [["PI by operator rules", "7 (9)", "constant, $f(D)y=X$", "CF + PI"],
              ["Legendre / Cauchy", "6 (8)", "variable; reduced to constant", "CF + PI in $z$, then back to $x$"],
              ["Variation of parameters", "4 (5)", "constant", "CF + PI (PI from $W$)"],
              ["LCR circuits", "2 (2)", "constant, in $t$", "charge = CF (transient) + PI (steady state)"],
              ["Total", "19 (24)", "", "all CF + PI"]]},
]

SYMBOLS = [
    {"sym": "$x$", "name": "Independent variable", "meaning": "The variable we differentiate with respect to", "where": "all"},
    {"sym": "$y$", "name": "Dependent variable", "meaning": r"The unknown function $y(x)$", "where": "all"},
    {"sym": "$X$", "name": "Right-hand side", "meaning": r"A function of $x$ alone; $X=0$ homogeneous. Not the variable $x$", "where": "E1.2, E1.3, E3.2"},
    {"sym": "$n$", "name": "Order", "meaning": "Highest derivative; also the number of constants in the CF", "where": "E1.3, E4.4"},
    {"sym": "$P,\\ Q$", "name": "First-order coefficients", "meaning": r"Functions of $x$ in $y'+Py=Q$", "where": "E1.1"},
    {"sym": "$P_1,\\dots,P_n$", "name": "Coefficients (slide 001·7)", "meaning": r"Functions of $x$; the lecture adds $P_0\neq0$", "where": "E1.2"},
    {"sym": "$a_1,\\dots,a_n$", "name": "Coefficients (slides 001·8 on)", "meaning": r"Functions of $x$ or constants", "where": "E1.3, E3.2"},
    {"sym": "$k_1,\\ k_2$", "name": "Constant coefficients", "meaning": r"In $y''+k_1y'+k_2y=0$ (slide 001·15)", "where": "S001·15"},
    {"sym": "$D$", "name": "Differential operator", "meaning": r"$\frac{d}{dx}$; $D^n=\frac{d^n}{dx^n}$", "where": "E3.1"},
    {"sym": "$f(D)$", "name": "Linear differential operator", "meaning": r"$D^n+a_1D^{n-1}+\dots+a_n$", "where": "E3.2, E5.1"},
    {"sym": "$f_1,\\dots,f_n$", "name": "Functions", "meaning": "Tested for linear dependence", "where": "E4.1"},
    {"sym": "$c_1,\\dots,c_n$", "name": "Constants", "meaning": "In a linear combination; the arbitrary constants of the CF", "where": "E4.1, E4.4"},
    {"sym": "$y_1,\\dots,y_n$", "name": "Independent solutions", "meaning": r"Of the homogeneous LDE", "where": "E4.4"},
    {"sym": "$W$", "name": "Wronskian", "meaning": r"$y_1y_2'-y_2y_1'$ (added for clarity)", "where": "E4.3"},
    {"sym": "$y_c$", "name": "Complementary function", "meaning": r"Complete solution of $f(D)y=0$", "where": "E4.4, E5.1"},
    {"sym": "$y_p$", "name": "Particular integral", "meaning": r"One solution of $f(D)y=X$", "where": "E5.1"},
    {"sym": "$m$", "name": "Root of the auxiliary equation", "meaning": r"$f(m)=0$ (preview of class 002)", "where": "E3.4"},
]

KEYWORDS = [
    {"term": "Ordinary DE", "meaning": "One independent variable; linear or non-linear.", "topic": "T1"},
    {"term": "Linear DE", "meaning": r"$y$ and derivatives first degree, not multiplied together.", "topic": "T1"},
    {"term": "Non-linear DE", "meaning": r"Not linear: $yy'$, $y^2$, $\sin y$ …", "topic": "T1"},
    {"term": "Order", "meaning": "Highest derivative present.", "topic": "T1"},
    {"term": "Higher-order LDE", "meaning": "Linear, order 2 or more.", "topic": "T1"},
    {"term": "Constant coefficients", "meaning": r"All $a_i$ numbers.", "topic": "T2"},
    {"term": "Variable coefficients", "meaning": r"Some $a_i$ functions of $x$.", "topic": "T2"},
    {"term": "Homogeneous LDE", "meaning": r"RHS $X=0$.", "topic": "T2"},
    {"term": "Non-homogeneous LDE", "meaning": r"RHS $X$ a nonzero function of $x$.", "topic": "T2"},
    {"term": "Associated homogeneous equation", "meaning": r"$f(D)y=0$ for $f(D)y=X$.", "topic": "T2"},
    {"term": "Differential operator", "meaning": r"$D=\frac{d}{dx}$.", "topic": "T3"},
    {"term": "Linear differential operator", "meaning": r"$f(D)=D^n+a_1D^{n-1}+\dots+a_n$.", "topic": "T3"},
    {"term": "Operator form", "meaning": r"$f(D)y=X$.", "topic": "T3"},
    {"term": "Linearly dependent", "meaning": r"$\sum c_if_i=0$ with $c_i$ not all zero.", "topic": "T4"},
    {"term": "Linearly independent", "meaning": r"$\sum c_if_i=0$ only for all $c_i=0$.", "topic": "T4"},
    {"term": "Wronskian", "meaning": r"$y_1y_2'-y_2y_1'$; nonzero means independent.", "topic": "T4"},
    {"term": "Superposition", "meaning": "Combinations of solutions of a homogeneous LDE are solutions.", "topic": "T4"},
    {"term": "Complementary function", "meaning": r"$y_c=c_1y_1+\dots+c_ny_n$, complete solution of $f(D)y=0$.", "topic": "T4"},
    {"term": "Particular integral", "meaning": r"$y_p$: one solution of $f(D)y=X$, no constants.", "topic": "T5"},
    {"term": "Complete solution", "meaning": r"$y=y_c+y_p$.", "topic": "T5"},
    {"term": "Auxiliary equation", "meaning": r"$f(m)=0$ (class 002).", "topic": "T3"},
]

RAPID = [
    {"q": "When is a DE linear?", "a": "$y$ and its derivatives occur in the first degree and are not multiplied together."},
    {"q": "Is $y^2y'+\\sin y=x^2e^{2y}$ linear?", "a": "No."},
    {"q": "Order of a DE?", "a": "Order of the highest derivative present."},
    {"q": "General linear DE of order $n$?", "a": "$y^{(n)}+a_1y^{(n-1)}+\\dots+a_ny=X$."},
    {"q": "Constant against variable coefficients?", "a": "$a_i$ numbers against $a_i$ functions of $x$."},
    {"q": "Homogeneous LDE?", "a": "RHS $X=0$."},
    {"q": "Is $2x^3y'''-(5x^2+2)y''+xy'+y=x^2\\sin x$ linear?", "a": "Yes: order 3, variable coefficients, non-homogeneous."},
    {"q": "$D$ and $D^2$ mean?", "a": "$\\frac{d}{dx}$ and $\\frac{d^2}{dx^2}$."},
    {"q": "$f(D)$ for $y''-5y'+6y$?", "a": "$D^2-5D+6=(D-2)(D-3)$."},
    {"q": "Do the factors of $f(D)$ commute?", "a": "Yes, with constant coefficients only."},
    {"q": "$y_1,y_2$ independent when?", "a": "Neither is a constant multiple of the other."},
    {"q": "Are $e^x$ and $3e^x$ independent?", "a": "No: ratio 3."},
    {"q": "$W(e^x,e^{2x})$?", "a": "$e^{3x}$."},
    {"q": "CF of an $n$-th order homogeneous LDE?", "a": "$c_1y_1+\\dots+c_ny_n$ with $y_i$ independent solutions."},
    {"q": "Complete solution of $f(D)y=X$?", "a": "$y=y_c+y_p$ = CF + PI."},
    {"q": "How many constants in the PI?", "a": "None; all $n$ are in the CF."},
    {"q": "PI of $(D^2-3D+2)y=e^{3x}$?", "a": "$\\frac12e^{3x}$."},
    {"q": "PI of $X_1+X_2$?", "a": "PI of $X_1$ plus PI of $X_2$."},
    {"q": "How many Unit 2 ESA occurrences use CF + PI?", "a": "All 24 (19 distinct questions)."},
]

MNEMONICS = [
    "<i>“Constants live in the CF; the PI travels alone.”</i> The PI carries no arbitrary constants (study aid).",
    "<i>“Ratio constant, dependent.”</i> The quick test for two functions (study aid).",
]

TOP_FACTS = [
    "Linear: $y$ and derivatives first degree, not multiplied; coefficients functions of $x$ or constants.",
    "Order $n$ LDE: $y^{(n)}+a_1y^{(n-1)}+\\dots+a_ny=X$; constant or variable coefficients.",
    "Homogeneous: $X=0$; non-homogeneous: $X$ a nonzero function of $x$.",
    "$D=\\frac{d}{dx}$; the LDE is $f(D)y=X$, $f(D)=D^n+a_1D^{n-1}+\\dots+a_n$; factors commute (constant coefficients).",
    "Independent: $\\sum c_if_i=0$ only for all $c_i=0$; two functions: ratio not constant.",
    "CF = $c_1y_1+\\dots+c_ny_n$ ($y_i$ independent solutions of $f(D)y=0$): $n$ constants.",
    "Complete solution $y=y_c+y_p$ = CF + PI; the PI has no constants.",
    "All 24 Unit 2 ESA occurrences are answered as CF + PI.",
]
TOP_FORMULAS = ["E1.3", "E3.2", "E4.4", "E5.1", "E5.2"]
