"""Flowcharts (Flowchart_Template_v7 layouts, as data) and comparison tables for class 002."""
ADD = "added for clarity"

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "Counting partial derivatives of each order.", "stars": 1,
     "srcs": ["S002·3", "T002 00:01:37", "T002 00:02:13"], "layout": "tree", "maxw": "150mm",
     "spec": {"root": {"kind": "given", "lab": "function", "title": "$f(x,y)$", "sub": "Two independent variables"},
              "branches": [
                  {"title": "$f_x$", "sub": "differentiate in $x$ first",
                   "rows": [["2nd order", "$f_{xx},\\ f_{xy}$"], ["3rd order", "$f_{xxx},\\ f_{xxy},$<br>$f_{xyx},\\ f_{xyy}$"]]},
                  {"title": "$f_y$", "sub": "differentiate in $y$ first",
                   "rows": [["2nd order", "$f_{yx},\\ f_{yy}$"], ["3rd order", "$f_{yxx},\\ f_{yxy},$<br>$f_{yyx},\\ f_{yyy}$"]]}]},
     "remark": "Totals: 2, 4, 8, …, $2^n$. With $m$ variables there are $m^n$. When mixed partials are equal, only $n+1$ of the $2^n$ are different."},

    {"id": "F4.1", "topic": "T4", "title": "Partial derivative as the slope of a tangent, step by step.", "stars": 2,
     "srcs": ["S002·6", "S002·7", "V002 00:07:45", "T002 00:06:10"], "layout": "straight", "maxw": "115mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "Surface $z=f(x,y)$ and a point $(x_0,y_0)$", "sub": "$P=(x_0,y_0,f(x_0,y_0))$ lies on the surface"},
         {"kind": "step", "n": 1, "title": "Fix $y$: cut with the plane $y=y_0$", "sub": "The trace depends on $x$ only", "fx": "$z=f(x,y_0)$"},
         {"kind": "step", "n": 2, "title": "Differentiate the trace with respect to $x$", "sub": "An ordinary derivative", "fx": "$\\dfrac{d}{dx}\\,f(x,y_0)$"},
         {"kind": "step", "n": 3, "title": "Substitute $x=x_0$", "sub": "Only after differentiating"},
         {"kind": "result", "title": "Slope of the tangent parallel to the $x$-axis",
          "fx": "$\\left.\\dfrac{\\partial f}{\\partial x}\\right|_{(x_0,y_0)}$", "sub": "The tangent lies in the plane $y=y_0$"}]},
     "remark": "For $\\partial f/\\partial y$, swap the roles: cut with $x=x_0$, differentiate $f(x_0,y)$ in $y$, then put $y=y_0$."},

    {"id": "F4.2", "topic": "T4", "title": "Which derivative answers which geometric question.", "stars": 2, "flags": [ADD],
     "srcs": ["S002·6", "S002·8", "S002·9", "T002 00:07:54"], "layout": "route", "maxw": "160mm",
     "spec": {"question": "What does the question ask about the surface at $P$?",
              "rows": [{"title": "Slope parallel to the $x$-axis", "sub": "Tangent in the plane $y=y_0$", "kw": "$f_x$"},
                       {"title": "Slope parallel to the $y$-axis", "sub": "Tangent in the plane $x=x_0$", "kw": "$f_y$"},
                       {"title": "Bending along $x$ or along $y$", "sub": "Concave up if positive, down if negative", "kw": "$f_{xx},\\ f_{yy}$"},
                       {"title": "Change of one slope in the other direction", "sub": "$f_{xy}$: $x$-slope as $y$ moves", "kw": "$f_{xy},\\ f_{yx}$"},
                       {"title": "Slope in any other direction $\\hat u$", "sub": "Combine both components (vector calculus)", "kw": "$\\nabla f\\cdot\\hat u$", "dashed": True}]},
     "remark": "The dashed route is the gradient idea from slide 8. Its formula $\\nabla f\\cdot\\hat u$ is added here for clarity and studied in vector calculus."},

    {"id": "F5.1", "topic": "T5", "title": "Two slopes combine into the gradient.", "stars": 1, "flags": [ADD],
     "srcs": ["S002·8", "T002 00:09:06", "T002 00:09:23"], "layout": "streams", "maxw": "140mm",
     "spec": {"left": [{"kind": "given", "title": "Trace in the plane $y=y_0$", "sub": "$z=f(x,y_0)$"},
                       {"kind": "step", "title": "Slope along $x$", "fx": "$f_x(x_0,y_0)$"}],
              "right": [{"kind": "given", "title": "Trace in the plane $x=x_0$", "sub": "$z=f(x_0,y)$"},
                        {"kind": "step", "title": "Slope along $y$", "fx": "$f_y(x_0,y_0)$"}],
              "then": [{"kind": "result", "title": "Resultant: the gradient", "fx": "$\\nabla f=f_x\\,\\mathbf i+f_y\\,\\mathbf j$",
                        "sub": "Vector addition of the two components"},
                       {"kind": "step", "n": 4, "title": "Slope along a unit direction $\\hat u=(a,b)$", "sub": "Dot product with the gradient",
                        "fx": "$D_{\\hat u}f=a\\,f_x+b\\,f_y$"}]},
     "remark": "Check $\\hat u=(1,0)$: you get back $f_x$. The steepest slope is $|\\nabla f|=\\sqrt{f_x^2+f_y^2}$. Example: the dome at $(1,-0.5)$ gives $\\nabla f=(-2,1)$ (W5.1)."},

    {"id": "F6.1", "topic": "T6", "title": "Reading concavity from a second-order partial.", "stars": 2, "flags": [ADD],
     "srcs": ["S002·9", "T002 00:11:19", "T002 00:11:38"], "layout": "ladder", "maxw": "165mm",
     "spec": {"start": {"kind": "given", "title": "Compute $f_{xx}$ at $P$", "sub": "Differentiate twice in $x$, then substitute"},
              "rungs": [{"q": "Is $f_{xx}>0$?", "yes": {"lab": "", "title": "Concave up in the $x$ direction", "sub": "The $x$-slope increases as $x$ increases"}},
                        {"q": "Is $f_{xx}<0$?", "yes": {"lab": "", "title": "Concave down in the $x$ direction", "sub": "The $x$-slope decreases as $x$ increases"}}],
              "last": {"kind": "step", "title": "$f_{xx}=0$", "sub": "This test says nothing about bending in $x$ at $P$"}},
     "remark": "Run the same ladder with $f_{yy}$ for the $y$ direction. Read the sign of $f_{xy}$ in the same way: positive means the $x$-slope increases as $y$ increases (Figure G6.2)."},

    {"id": "F7.1", "topic": "T7", "title": "Verifying equal mixed partial derivatives.", "stars": 2,
     "srcs": ["CW U1 P2", "T002 00:14:59"], "layout": "verify", "maxw": "150mm",
     "spec": {"given": {"kind": "given", "title": "$f(x,y)=x^y,\\ x>0$", "sub": "Verify that the mixed partial derivatives are equal"},
              "left": [{"kind": "step", "n": 1, "title": "Differentiate in $x$ first", "fx": "$f_x=y\\,x^{y-1}$"},
                       {"kind": "step", "n": 2, "title": "Then in $y$", "fx": "$f_{xy}=x^{y-1}(1+y\\log x)$"}],
              "right": [{"kind": "step", "n": 1, "title": "Differentiate in $y$ first", "fx": "$f_y=x^y\\log x$"},
                        {"kind": "step", "n": 2, "title": "Then in $x$", "fx": "$f_{yx}=x^{y-1}(1+y\\log x)$"}],
              "check": {"title": "Both sides equal $x^{y-1}(1+y\\log x)$", "sub": "Hence $f_{xy}=f_{yx}$, as Clairaut's theorem predicts."}},
     "trap": "In $x$, $x^y$ is a power; in $y$, it is an exponential. Using the wrong rule is the usual slip."},

    {"id": "F7.2", "topic": "T7", "title": "Evaluating higher-order partials at a point (ESA Dec 2023 Q1.a).", "stars": 2,
     "srcs": ["ESA Dec-23 1a", "CW U1 P5", "S002·3"], "layout": "straight", "maxw": "115mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$f(x,y)$, the point, and the derivatives asked for", "sub": "e.g. $f=e^x\\log y+\\cos y\\log x$ at $(1,\\pi/2)$"},
         {"kind": "step", "n": 1, "title": "Differentiate in the order the subscripts are written", "sub": "$f_{xyy}$: $x$ first, then $y$, then $y$"},
         {"kind": "step", "n": 2, "title": "Reuse intermediate results", "sub": "$f_x$ feeds both $f_{xx}$ and $f_{xy}$"},
         {"kind": "step", "n": 3, "title": "Simplify each expression"},
         {"kind": "step", "n": 4, "title": "Substitute the point last", "sub": "$\\cos\\frac\\pi2=0,\\ \\sin\\frac\\pi2=1,\\ \\log1=0$"},
         {"kind": "result", "title": "Values at the point",
          "fx": "$f_{xxx}=e\\log\\tfrac{\\pi}{2}$<br>$f_{xyy}=-\\tfrac{4e}{\\pi^2}$<br>$f_{yyy}=\\tfrac{16e}{\\pi^3}$"}]},
     "remark": "$\\log$ is the natural logarithm, so $\\frac{d}{dy}\\log y=\\frac1y$. Check one value against the CW answer key if you can."},
]

COMPARISONS = [
    {"id": "C6.1", "topic": "T6", "title": "One variable vs two variables", "flags": [ADD],
     "srcs": ["S002·4", "S002·6", "S002·9", "S002·3"],
     "head": ["", "One variable, $y=f(x)$", "Two variables, $z=f(x,y)$"],
     "rows": [["Graph", "Curve in a plane", "Surface in 3-D"],
              ["Tangents at a point", "One", "Infinitely many, one per direction"],
              ["First derivative", "$dy/dx$: slope of the tangent", "$f_x$, $f_y$: slopes parallel to the $x$- and $y$-axes; $\\nabla f$ for other directions"],
              ["Second derivative", "$d^2y/dx^2$: concave up or down", "$f_{xx}$, $f_{yy}$: concavity in $x$, $y$; $f_{xy}$, $f_{yx}$: change of one slope along the other direction"],
              ["Number of order $n$", "1", "$2^n$ (or $m^n$ for $m$ variables)"]]},
]
