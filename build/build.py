"""Build the six HTML documents of the study pack.

usage: python3 -I build/build.py      (run from the repo root; writes output/*.html)
"""
import datetime, html, json, os, re, subprocess, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import content as C  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, ".."))
OUT = os.path.join(ROOT, "output")
TODAY = datetime.date.today().strftime("%d %B %Y")
TNAME = dict((t[0], t[1]) for t in C.TOPICS)
TOVER = dict((t[0], t[2]) for t in C.TOPICS)
TNUM = {t[0]: i + 1 for i, t in enumerate(C.TOPICS)}
FORM = {f[0]: f for f in C.FORMULAS}
SRC_COUNT = Counter()

# ============================================================== small components
def stars(n):
    return f'<span class="stars">ESA {"★" * n if isinstance(n, int) else n}</span>'

def src(tags):
    for t in tags:
        SRC_COUNT[t] += 1
    return f'<span class="src">{" · ".join(html.escape(t) for t in tags)}</span>' if tags else ""

def flags(fl):
    return "".join(f'<span class="flag">{html.escape(f)}</span>' for f in fl)

def tagline(fl, tags):
    return f'<div class="tags">{flags(fl)}{src(tags)}</div>'

def h2(num, title, id_=None):
    return f'<h2{f" id=\"{id_}\"" if id_ else ""}><span>{num}</span><span>{title}</span></h2>'

def h3(num, title, id_=None):
    return f'<h3{f" id=\"{id_}\"" if id_ else ""}><span>{num}</span><span>{title}</span></h3>'

def arrow():
    return '<div class="arrow"><div class="shaft"></div><div class="head"></div></div>'

def given(title, sub="", lab="given", center=False):
    st = ' style="text-align:center"' if center else ""
    return (f'<div class="blk given"{st}><div class="lab">{lab}</div><div class="btitle">{title}</div>'
            + (f'<div class="bsub">{sub}</div>' if sub else "") + "</div>")

def step(n, title, sub="", fx=""):
    return (f'<div class="blk step"><span class="num">{n}</span><div style="min-width:0"><div class="btitle">{title}</div>'
            + (f'<div class="bsub">{sub}</div>' if sub else "") + (f'<div class="fx">{fx}</div>' if fx else "")
            + "</div></div>")

def result(title, fx="", sub="", lab="result", n=None):
    num = f'<span class="num">{n}</span>' if n else ""
    inner = ((f'<div class="lab">{lab}</div>' if lab else "") + f'<div class="btitle">{title}</div>'
             + (f'<div class="fx">{fx}</div>' if fx else "") + (f'<div class="bsub">{sub}</div>' if sub else ""))
    if n:
        return f'<div class="blk result" style="display:flex;gap:12px"><span class="num">{n}</span><div>{inner}</div></div>'
    return f'<div class="blk result">{inner}</div>'

def question(text):
    return f'<div class="q"><span class="dia"></span><span class="qt">{text}</span></div>'

def remark(text, lab="Remark."):
    return f'<div class="remark"><b><i>{lab}</i></b> {text}</div>'

def check(title, sub):
    return (f'<div class="blk check"><span class="tick">✓</span><div><div class="lab">check</div>'
            f'<div class="btitle">{title}</div><div class="bsub">{sub}</div></div></div>')

def flowfig(fid, title, star, fl, tags, body, rem="", maxw="150mm"):
    return (f'<figure class="flowfig" id="{fid}"><div class="flow" style="max-width:{maxw}">{body}</div>'
            + (f'<div style="width:100%;max-width:130mm">{rem}</div>' if rem else "")
            + f'<figcaption><div class="capt"><b>Figure {fid}.</b> {title} {stars(star)}</div>{tagline(fl, tags)}</figcaption></figure>')

# ============================================================== flowcharts
def F1():
    body = (given("Surface $z=f(x,y)$ and a point $(x_0,y_0)$", "$P=(x_0,y_0,f(x_0,y_0))$ lies on the surface")
            + arrow() + step(1, "Fix $y$: cut with the plane $y=y_0$", "The trace depends on $x$ only", "$z=f(x,y_0)$")
            + arrow() + step(2, "Differentiate the trace with respect to $x$", "An ordinary derivative", r"$\dfrac{d}{dx}\,f(x,y_0)$")
            + arrow() + step(3, "Substitute $x=x_0$", "Only after differentiating")
            + arrow() + result("Slope of the tangent parallel to the $x$-axis",
                               r"$\left.\dfrac{\partial f}{\partial x}\right|_{(x_0,y_0)}$", "The tangent lies in the plane $y=y_0$"))
    rem = remark("For $\\partial f/\\partial y$, swap the roles: cut with $x=x_0$, differentiate $f(x_0,y)$ in $y$, then put $y=y_0$.")
    return flowfig("F1", "Partial derivative as the slope of a tangent, step by step.", 2, [],
                   ["S002·6", "S002·7", "V002 00:07:45", "T002 00:06:10"], body, rem, "115mm")

def F2():
    rows = [
        ("Slope parallel to the $x$-axis", "Tangent in the plane $y=y_0$", "$f_x$", False),
        ("Slope parallel to the $y$-axis", "Tangent in the plane $x=x_0$", "$f_y$", False),
        ("Bending along $x$ or along $y$", "Concave up if positive, down if negative", "$f_{xx},\\ f_{yy}$", False),
        ("Change of one slope in the other direction", "$f_{xy}$: $x$-slope as $y$ moves", "$f_{xy},\\ f_{yx}$", False),
        ("Slope in any other direction $\\hat u$", "Combine both components (vector calculus)", "$\\nabla f\\cdot\\hat u$", True),
    ]
    out = ['<div class="route"><div class="hub"><div class="hubq"><span class="dia" style="width:10px;height:10px;transform:rotate(45deg);background:#111"></span>'
           '<span class="qt">What does the question ask about the surface at $P$?</span></div><div class="stub"></div></div><div class="col">']
    for i, (t, s, kw, dashed) in enumerate(rows):
        cls = "rrow" + (" first" if i == 0 else "") + (" last" if i == len(rows) - 1 else "")
        hstyle = ' style="border-top:2px dashed #444;background:none;height:0"' if dashed else ""
        out.append(f'<div class="{cls}"><div class="conn"><div class="v"></div><div class="h"{hstyle}></div><div class="t"></div></div>'
                   f'<div class="cell"><div class="rbox{" dashed" if dashed else ""}"><div style="min-width:0"><div class="btitle" style="font-size:11pt">{t}</div>'
                   f'<div class="bsub" style="margin-top:0">{s}</div></div><span class="kw">{kw}</span></div></div></div>')
    out.append("</div></div>")
    rem = remark("The dashed route is the gradient idea from slide 8. Its formula $\\nabla f\\cdot\\hat u$ is added here for clarity and studied in vector calculus.")
    return flowfig("F2", "Which derivative answers which geometric question.", 2, [ADDF],
                   ["S002·6", "S002·8", "S002·9", "T002 00:07:54"], "".join(out), rem, "160mm")

ADDF = C.ADD

def F3():
    left = ('<div class="col">' + given("Trace in the plane $y=y_0$", "$z=f(x,y_0)$") + arrow()
            + '<div class="blk step" style="margin:0 10px"><div><div class="btitle">Slope along $x$</div><div class="fx">$f_x(x_0,y_0)$</div></div></div>'
            + '<div class="join-l"></div></div>')
    right = ('<div class="col">' + given("Trace in the plane $x=x_0$", "$z=f(x_0,y)$") + arrow()
             + '<div class="blk step" style="margin:0 10px"><div><div class="btitle">Slope along $y$</div><div class="fx">$f_y(x_0,y_0)$</div></div></div>'
             + '<div class="join-r"></div></div>')
    left = left.replace('<div class="blk given">', '<div class="blk given" style="margin:0 10px">')
    right = right.replace('<div class="blk given">', '<div class="blk given" style="margin:0 10px">')
    body = (f'<div class="two">{left}{right}</div>' + arrow()
            + '<div style="width:100%;max-width:105mm;margin:0 auto">'
            + result("Resultant: the gradient", "$\\nabla f=f_x\\,\\mathbf i+f_y\\,\\mathbf j$", "Vector addition of the two components")
            + "</div>" + arrow()
            + '<div style="width:100%;max-width:105mm;margin:0 auto">'
            + step(4, "Slope along a unit direction $\\hat u=(a,b)$", "Dot product with the gradient", "$D_{\\hat u}f=a\\,f_x+b\\,f_y$")
            + "</div>")
    rem = remark("Check $\\hat u=(1,0)$: you get back $f_x$. The steepest slope is $|\\nabla f|=\\sqrt{f_x^2+f_y^2}$. Example: the dome at $(1,-0.5)$ gives $\\nabla f=(-2,1)$ (W2).")
    return flowfig("F3", "Two slopes combine into the gradient.", 1, [ADDF],
                   ["S002·8", "T002 00:09:06", "T002 00:09:23"], body, rem, "140mm")

def F4():
    def harrow():
        return '<div class="harrow"><div class="hs"></div><div class="hh"></div><span class="pill yes">yes</span></div>'
    def varrow():
        return '<div class="varrow"><div class="shaft" style="width:2px;background:#444"></div><div class="head" style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #444"></div><span class="pill">no</span></div><div></div><div></div>'
    body = ('<div class="ladder">'
            + given("Compute $f_{xx}$ at $P$", "Differentiate twice in $x$, then substitute") + "<div></div><div></div>"
            + arrow() + "<div></div><div></div>"
            + question("Is $f_{xx}>0$?") + harrow() + result("Concave up in the $x$ direction", "", "The $x$-slope increases as $x$ increases", lab="")
            + varrow()
            + question("Is $f_{xx}<0$?") + harrow() + result("Concave down in the $x$ direction", "", "The $x$-slope decreases as $x$ increases", lab="")
            + varrow()
            + '<div class="blk step"><div><div class="btitle">$f_{xx}=0$</div><div class="bsub">This test says nothing about bending in $x$ at $P$</div></div></div><div></div><div></div>'
            + "</div>")
    rem = remark("Run the same ladder with $f_{yy}$ for the $y$ direction. Read the sign of $f_{xy}$ in the same way: positive means the $x$-slope increases as $y$ increases (Figure G10).")
    return flowfig("F4", "Reading concavity from a second-order partial.", 2, [ADDF],
                   ["S002·9", "T002 00:11:19", "T002 00:11:38"], body, rem, "165mm")

def F5():
    def side(first, second, d1, d2):
        return ('<div class="col"><div class="fork-%s"></div>' % ("l" if first == "x" else "r")
                + f'<div style="margin:0 10px">{step(1, f"Differentiate in ${first}$ first", "", d1)}</div>'
                + arrow() + f'<div style="margin:0 10px">{step(2, f"Then in ${second}$", "", d2)}</div>'
                + '<div class="join-%s" style="min-height:26px"></div></div>' % ("l" if first == "x" else "r"))
    body = ('<div style="width:100%;max-width:100mm;margin:0 auto">'
            + given("$f(x,y)=x^y,\\ x>0$", "Verify that the mixed partial derivatives are equal", center=True) + "</div>"
            + '<div class="stem"><div></div></div><div class="two">'
            + side("x", "y", "$f_x=y\\,x^{y-1}$", "$f_{xy}=x^{y-1}(1+y\\log x)$")
            + side("y", "x", "$f_y=x^y\\log x$", "$f_{yx}=x^{y-1}(1+y\\log x)$")
            + "</div>" + arrow()
            + '<div style="width:100%;max-width:100mm;margin:0 auto">'
            + check("Both sides equal $x^{y-1}(1+y\\log x)$", "Hence $f_{xy}=f_{yx}$, as Clairaut's theorem predicts.") + "</div>")
    rem = remark("In $x$, $x^y$ is a power; in $y$, it is an exponential. Using the wrong rule is the usual slip.", "Exam trap.")
    return flowfig("F5", "Verifying equal mixed partial derivatives.", 2, [],
                   ["CW U1 P2", "T002 00:14:59"], body, rem, "150mm")

def F6():
    def branch(var, rows, side):
        r = "".join(f'<div class="frow"><b>{a}</b><span style="color:#333">{b}</span></div>' for a, b in rows)
        return (f'<div class="col"><div class="fork-{side}" style="height:30px"></div>'
                f'<div class="ftable" style="margin:0 10px"><div class="fhead"><div class="btitle">$f_{var}$</div>'
                f'<div class="bsub" style="color:#ddd">differentiate in ${var}$ first</div></div>{r}</div></div>')
    body = ('<div style="width:100%;max-width:90mm;margin:0 auto">'
            + given("$f(x,y)$", "Two independent variables", lab="function", center=True) + "</div>"
            + '<div class="stem"><div></div></div><div class="two">'
            + branch("x", [("2nd order", "$f_{xx},\\ f_{xy}$"), ("3rd order", "$f_{xxx},\\ f_{xxy},$<br>$f_{xyx},\\ f_{xyy}$")], "l")
            + branch("y", [("2nd order", "$f_{yx},\\ f_{yy}$"), ("3rd order", "$f_{yxx},\\ f_{yxy},$<br>$f_{yyx},\\ f_{yyy}$")], "r")
            + "</div>")
    rem = remark("Totals: 2, 4, 8, …, $2^n$. With $m$ variables there are $m^n$. When mixed partials are equal, only $n+1$ of the $2^n$ are different.")
    return flowfig("F6", "Counting partial derivatives of each order.", 1, [],
                   ["S002·3", "T002 00:01:37", "T002 00:02:13"], body, rem, "150mm")

def F7():
    body = (given("$f(x,y)$, the point, and the derivatives asked for", "e.g. $f=e^x\\log y+\\cos y\\log x$ at $(1,\\pi/2)$")
            + arrow() + step(1, "Differentiate in the order the subscripts are written", "$f_{xyy}$: $x$ first, then $y$, then $y$")
            + arrow() + step(2, "Reuse intermediate results", "$f_x$ feeds both $f_{xx}$ and $f_{xy}$")
            + arrow() + step(3, "Simplify each expression")
            + arrow() + step(4, "Substitute the point last", "$\\cos\\frac\\pi2=0,\\ \\sin\\frac\\pi2=1,\\ \\log1=0$")
            + arrow() + result("Values at the point", "$f_{xxx}=e\\log\\tfrac{\\pi}{2}$<br>$f_{xyy}=-\\tfrac{4e}{\\pi^2}$<br>$f_{yyy}=\\tfrac{16e}{\\pi^3}$"))
    rem = remark("$\\log$ is the natural logarithm, so $\\frac{d}{dy}\\log y=\\frac1y$. Check one value against the CW answer key if you can.")
    return flowfig("F7", "Evaluating higher-order partials at a point (ESA Dec 2023 Q1.a).", 2, [],
                   ["ESA Dec-23 1a", "CW U1 P5", "S002·3"], body, rem, "115mm")

FLOWS = {"F6": ("T1", F6), "F1": ("T4", F1), "F2": ("T4", F2), "F3": ("T5", F3), "F4": ("T6", F4), "F5": ("T7", F5), "F7": ("T7", F7)}

FLOW_TITLES = {"F6": "Counting partial derivatives", "F1": "Partial derivative as a slope, step by step",
               "F2": "Which derivative answers which question", "F3": "Two slopes combine into the gradient",
               "F4": "Reading concavity", "F5": "Verifying equal mixed partials", "F7": "Higher-order partials at a point"}

COMPARE = ('<table class="t keep"><thead><tr><th></th><th>One variable, $y=f(x)$</th><th>Two variables, $z=f(x,y)$</th></tr></thead><tbody>'
           '<tr><td><b>Graph</b></td><td>Curve in a plane</td><td>Surface in 3-D</td></tr>'
           '<tr><td><b>Tangents at a point</b></td><td>One</td><td>Infinitely many, one per direction</td></tr>'
           '<tr><td><b>First derivative</b></td><td>$dy/dx$: slope of the tangent</td><td>$f_x$, $f_y$: slopes parallel to the $x$- and $y$-axes; $\\nabla f$ for other directions</td></tr>'
           '<tr><td><b>Second derivative</b></td><td>$d^2y/dx^2$: concave up or down</td><td>$f_{xx}$, $f_{yy}$: concavity in $x$, $y$; $f_{xy}$, $f_{yx}$: change of one slope along the other direction</td></tr>'
           '<tr><td><b>Number of order $n$</b></td><td>1</td><td>$2^n$ (or $m^n$ for $m$ variables)</td></tr>'
           '</tbody></table>')

# ============================================================== content renderers
def fcard(fid):
    f = FORM[fid]
    _, t, title, tex, gives, when, notes, st, tags, fl = f
    grid = f'<b>gives</b><span>{gives}</span><b>applies</b><span>{when}</span>' + (f'<b>note</b><span>{notes}</span>' if notes else "")
    return (f'<div class="card" id="{fid}"><div class="chead"><span class="ctitle">{fid} · {title}</span>{stars(st)}</div>'
            f'<div class="fx">$${tex}$$</div><div class="grid">{grid}</div>{tagline(fl, tags)}</div>')

def defs(t):
    return "".join(f'<div class="def"><span class="term">{a}.</span> {b} {flags(fl)} {src(tags)}</div>' for a, b, tags, fl in C.DEFS.get(t, []))

def statements(t):
    return "".join(f'<div class="statement">“{s}” {src(tags)}</div>' for s, tags in C.STATEMENTS.get(t, []))

def points(t):
    items = "".join(f'<li>{p} {stars(s)} {flags(fl)} {src(tags)}</li>' for p, s, tags, fl in C.POINTS.get(t, []))
    return f'<ol class="pts">{items}</ol>' if items else ""

def whys(t):
    return "".join(f'<div class="why"><div class="wq">{q}</div><div>{a}</div>{tagline(fl, tags)}</div>' for q, a, tags, fl in C.WHY.get(t, []))

def traps(t):
    return "".join(f'<div class="trap"><span class="tl">Exam trap.</span> {s} {flags(fl)}</div>' for s, fl in C.TRAPS.get(t, []))

def worked(w):
    wid, t, title, tags, st, giv, steps, ans, chk = w
    rows = "".join(f'<div class="wrow"><b>{"step " + str(i + 1)}</b><span>{s}</span></div>' for i, s in enumerate(steps))
    return (f'<div class="worked" id="{wid}"><div class="wh"><span class="btitle">{wid} · {title}</span>{stars(st)}</div><div class="wb">'
            f'<div class="wrow"><b>given</b><span>{giv}</span></div>{rows}'
            f'<div class="wrow"><b>answer</b><span><span class="ans">{ans}</span></span></div>'
            f'<div class="wrow"><b>check</b><span>{chk}</span></div>{src(tags)}</div></div>')

def pyq(p):
    t, paper, q, marks, text, w = p
    return (f'<div class="pyq"><div class="ph"><span class="pill yes">{paper}</span><span class="pill">{marks} marks</span>'
            f'<span class="src">{q} · solved in <a href="00_MASTER_geometrical_interpretation.html#{w}">{w}</a></span></div>{text}</div>')

def figure(gid, sec=None):
    t, title, st, tags, fl, howto, tall = C.FIGS[gid]
    return (f'<figure class="chart{" tall" if tall else ""}" id="{gid}"><img src="assets/figures/{gid}.svg" alt="Figure {gid}: {html.escape(title)}">'
            f'<figcaption><div class="capt"><b>Figure {gid}.</b> {title}. {stars(st)}</div>{tagline(fl, tags)}</figcaption>'
            f'<div class="howto">{remark(howto, "How to read it.")}</div></figure>')

def recap(t):
    return f'<div class="recap"><div class="lab">short-note recap</div><div>{C.NOTES[t]}</div></div>'

def topic_pyqs(t):
    return "".join(pyq(p) for p in C.PYQS if p[0] == t)

# ============================================================== page shell
LEGEND = ('<div class="legend">'
          f'<span>{stars(2)}</span><span>Computed in past ESA papers or class-work problems</span>'
          f'<span>{stars(1)}</span><span>Conceptual: explained in class, not examined so far</span>'
          '<span><span class="flag">added for clarity</span></span><span>Standard context that is not on the class slides</span>'
          '<span><span class="flag">transcript only</span></span><span>Said in the lecture but not on any slide</span>'
          '<span class="src">S002·7</span><span>Deck 002, slide 7 (rendered .pptx)</span>'
          '<span class="src">T002 00:06:10</span><span>AV-summary transcript 002, segment start time</span>'
          '<span class="src">V002 00:07:45</span><span>Frame grabbed from the class 002 video</span>'
          '<span class="src">CW U1 P2 · ESA Dec-23 1a</span><span>Unit 1 class-work problem 2 · past paper question</span>'
          '</div>')

def head(title, sub):
    return (f'<header class="doc-head"><div class="kicker">{C.COURSE} · {C.UNIT}</div><h1>{title}</h1>'
            f'<div class="sub">{sub}</div><div class="small" style="margin-top:6px">{C.SESSION} · compiled {TODAY}</div></header>')

def toc(items):
    lis = "".join(f'<li><a href="#{i}">{t}</a></li>' for i, t in items)
    return f'<nav id="toc" class="toc"><h4>Contents</h4><ol>{lis}</ol></nav>'

def page(title, body):
    return ("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            f"<title>{title}</title><link rel=\"stylesheet\" href=\"assets/katex/katex.min.css\">"
            "<link rel=\"stylesheet\" href=\"assets/study.css\"></head><body><main class=\"page\">"
            f"{body}</main></body></html>")

def topic_list():
    return [(t, f"{TNUM[t]} · {TNAME[t]}") for t, _, _ in C.TOPICS]

# ============================================================== documents
def doc01():
    b = [head("Formulas and symbols", "Every formula from the session, followed by a glossary of every symbol used."),
         LEGEND, toc([("partA", "Part A · Formula sheet")] + topic_list() + [("partB", "Part B · Symbol glossary"), ("partC", "Part C · Notation equivalents")])]
    b.append(f'<section class="part" id="partA">{h2("A", "Formula sheet")}')
    first = True
    for t, name, _ in C.TOPICS:
        fs = [f[0] for f in C.FORMULAS if f[1] == t]
        if not fs:
            b.append(f'<div id="{t}">{h3(TNUM[t], name)}<p class="small">No new formulas in this topic. Its worked problems use F1–F4 (see the master document, <a href="00_MASTER_geometrical_interpretation.html#{t}">topic {TNUM[t]}</a>).</p></div>')
            continue
        b.append(f'<div id="{t}">{h3(TNUM[t], name)}' + "".join(fcard(i) for i in fs) + "</div>")
    b.append("</section>")
    rows = "".join(f"<tr><td class=sym>{s}</td><td>{n}</td><td>{m}</td><td>{a}</td></tr>" for s, n, m, a in C.SYMBOLS)
    b.append(f'<section class="part" id="partB">{h2("B", "Symbol glossary")}'
             '<table class="t"><thead><tr><th>Symbol</th><th>Name</th><th>Meaning in this session</th><th>Appears in</th></tr></thead>'
             f'<tbody>{rows}</tbody></table>'
             + remark("No physical units here: every slope is a pure number (rise per unit run) unless $x$, $y$, $z$ carry units. Then $f_x$ has units of $z$ per unit of $x$.") + "</section>")
    eq = [("$f_x$", "$\\dfrac{\\partial f}{\\partial x}$", "$z_x$, $\\dfrac{\\partial z}{\\partial x}$", "slope along $x$"),
          ("$f_{xx}$", "$\\dfrac{\\partial^2 f}{\\partial x^2}$", "$z_{xx}$", "bending along $x$"),
          ("$f_{xy}$", "$\\dfrac{\\partial^2 f}{\\partial y\\,\\partial x}$", "$(f_x)_y$", "$x$ first, then $y$"),
          ("$f_{yx}$", "$\\dfrac{\\partial^2 f}{\\partial x\\,\\partial y}$", "$(f_y)_x$", "$y$ first, then $x$"),
          ("$\\nabla f$", "$f_x\\,\\mathbf i+f_y\\,\\mathbf j$", "grad $f$", "vector of slopes")]
    rows = "".join(f"<tr><td>{a}</td><td>{b_}</td><td>{c}</td><td>{d}</td></tr>" for a, b_, c, d in eq)
    b.append(f'<section class="part" id="partC">{h2("C", "Notation equivalents")}'
             '<table class="t"><thead><tr><th>Subscript</th><th>Leibniz</th><th>Also written</th><th>Read as</th></tr></thead>'
             f'<tbody>{rows}</tbody></table>' + traps("T1") + "</section>")
    return page("Formulas and symbols", "".join(b))

def doc02():
    b = [head("Important points", "Definitions, slide statements, key points, “why” reasoning and exam traps, topic by topic."),
         LEGEND, toc(topic_list() + [("pyq", "Past-paper questions")])]
    for i, (t, name, _) in enumerate(C.TOPICS):
        parts = []
        if C.DEFS.get(t): parts.append("<h4>Definitions</h4>" + defs(t))
        if C.STATEMENTS.get(t): parts.append("<h4>Statements on the slides</h4>" + statements(t))
        if C.POINTS.get(t): parts.append("<h4>Key points</h4>" + points(t))
        if C.WHY.get(t): parts.append("<h4>Why?</h4>" + whys(t))
        if C.TRAPS.get(t): parts.append("<h4>Exam traps</h4>" + traps(t))
        cls = "topic first" if i == 0 else "topic"
        b.append(f'<section class="{cls}" id="{t}" data-topic="{t}">{h2(TNUM[t], name)}{"".join(parts)}</section>')
    b.append(f'<section class="part" id="pyq">{h2("★", "Past-paper questions on this session")}<p class="lead">{C.PYQ_NOTE}</p>'
             + "".join(pyq(p) for p in C.PYQS) + "</section>")
    return page("Important points", "".join(b))

def doc03():
    b = [head("Graphs and diagrams", "Every figure for the session, redrawn as clean vectors following the Graph Style Guide."),
         LEGEND, toc([(g, f"Figure {g} · {C.FIGS[g][1]}") for g in C.FIGS]),
         '<p class="lead">Colours follow the Okabe–Ito order: blue = main curve, vermilion = comparison or tangent, '
         'green = second trace, purple = other direction. Tangents are dashed. Grey dashed lines are references. The surfaces '
         '(dome $z=4-x^2-y^2$, saddle $z=x^2-y^2$, $z=x^2y$) are illustrative choices that reproduce the shapes on slides 5–10. '
         'The slide images themselves are third-party screenshots and are not copied.</p>']
    for i, (t, name, _) in enumerate(C.TOPICS):
        gs = [g for g in C.FIGS if C.FIGS[g][0] == t]
        if not gs:
            continue
        cls = "topic first" if i == 1 else "topic"
        b.append(f'<section class="{cls}" id="{t}">{h2(TNUM[t], name)}' + "".join(figure(g) for g in gs) + "</section>")
    return page("Graphs and diagrams", "".join(b))

def doc04():
    b = [head("Flowcharts and visuals", "Procedures, decision ladders and comparison tables, built from the Flowchart Template blocks."),
         LEGEND, toc([(f, f"Figure {f} · {FLOW_TITLES[f]}") for f in FLOWS] + [("compare", "One variable vs two variables")])]
    first = True
    for t, name, _ in C.TOPICS:
        fl = [k for k, (tt, _) in FLOWS.items() if tt == t]
        if not fl:
            continue
        b.append(f'<section class="topic{" first" if first else ""}" id="{t}">{h2(TNUM[t], name)}' + "".join(FLOWS[k][1]() for k in fl) + "</section>")
        first = False
    b.append(f'<section class="part" id="compare">{h2("·", "One variable vs two variables")}{COMPARE}'
             f'{tagline([ADDF], ["S002·4", "S002·6", "S002·9", "S002·3"])}</section>')
    return page("Flowcharts and visuals", "".join(b))

def doc05():
    b = [head("Short notes and keywords", "Two-to-three-mark answers, a keyword index, rapid recall and a last-10-minutes page."),
         toc([("notes", "Short notes"), ("kw", "Keyword index"), ("rapid", "Rapid recall"), ("last", "Last 10 minutes")])]
    notes = "".join(f'<div class="card"><div class="chead"><span class="ctitle">{TNUM[t]} · {name}</span></div><div>{C.NOTES[t]}</div></div>' for t, name, _ in C.TOPICS)
    b.append(f'<section class="topic first" id="notes">{h2(1, "Short notes")}{notes}</section>')
    kws = "".join(f'<div><b>{k}</b> ({TNUM[t]}). {v}</div>' for k, v, t in sorted(C.KEYWORDS, key=lambda x: x[0].lower()))
    b.append(f'<section class="topic" id="kw">{h2(2, "Keyword index")}<p class="small">{len(C.KEYWORDS)} terms; the number in brackets is the topic.</p><div class="kwlist">{kws}</div></section>')
    qa = "".join(f'<div class="qa"><b>{i + 1}</b><span>{q}</span><span>{a}</span></div>' for i, (q, a) in enumerate(C.RAPID))
    b.append(f'<section class="topic" id="rapid">{h2(3, "Rapid recall")}{qa}'
             + remark("Mnemonic (study aid): <i>“Fix the other, slope the trace.”</i> To read $f_x$ at a point, fix $y$, look at the trace, and take its slope.") + "</section>")
    facts = "".join(f"<li>{f}</li>" for f in C.TOP_FACTS)
    b.append(f'<section class="topic" id="last">{h2(4, "Last 10 minutes before the exam")}<h4>Top 10 facts</h4><ol class="pts">{facts}</ol>'
             f'<h4>Top formulas</h4>' + "".join(fcard(i) for i in C.TOP_FORMULAS) + "</section>")
    return page("Short notes and keywords", "".join(b))

def doc00():
    cover = (f'<section class="cover"><div class="kicker">{C.COURSE} · {C.UNIT}</div>'
             '<h1>Geometrical Interpretation of Partial Derivatives</h1>'
             '<div class="sub">Complete study pack: higher-order partials, partial derivatives as slopes, gradient, concavity '
             'and mixed partials, and problems</div>'
             '<div class="small">Compiled from the PESU class 002 slide deck, the class 002 AV-summary transcript (with three '
             f'targeted video frames), the Unit 1 class-work sheet and past ESA papers. Generated {TODAY}.</div></section>')
    how = (f'<section class="part" id="how">{h2("·", "How to use this pack")}<p class="lead">Topics 1–7 follow the order of the '
           'lecture. Each topic has the same parts: overview, key terms, formulas, figures, flowcharts, important points, worked '
           'examples, past-paper questions and a recap. Figures and flowcharts reuse the IDs of the separate documents '
           '(G = graph, F = flowchart, W = worked example). Formula IDs are F1–F14 in the formula sheet; flowchart IDs are '
           'written as “Figure F1–F7”.</p>'
           + LEGEND + toc(topic_list() + [("appA", "Appendix A · Symbol glossary"), ("appB", "Appendix B · Sources, coverage and gaps")]) + "</section>")
    b = [cover, how]
    for t, name, over in C.TOPICS:
        parts = [f'<p class="lead">{over}</p>']
        if C.DEFS.get(t) or C.STATEMENTS.get(t): parts.append("<h4>Key terms and definitions</h4>" + defs(t) + statements(t))
        fs = [f[0] for f in C.FORMULAS if f[1] == t]
        if fs: parts.append("<h4>Formulas</h4>" + "".join(fcard(i) for i in fs))
        gs = [g for g in C.FIGS if C.FIGS[g][0] == t]
        if gs: parts.append("<h4>Graphs and diagrams</h4>" + "".join(figure(g) for g in gs))
        fl = [k for k, (tt, _) in FLOWS.items() if tt == t]
        if fl: parts.append("<h4>Flowchart</h4>" + "".join(FLOWS[k][1]() for k in fl))
        if C.POINTS.get(t) or C.WHY.get(t) or C.TRAPS.get(t):
            parts.append("<h4>Important points and why</h4>" + points(t) + whys(t) + traps(t))
        ws = [w for w in C.WORKED if w[1] == t]
        if ws: parts.append("<h4>Worked examples</h4>" + "".join(worked(w) for w in ws))
        if t == "T7":
            parts.append("<h4>Past-paper questions</h4>" + f'<p class="small">{C.PYQ_NOTE}</p>' + topic_pyqs(t))
        if t == "T6":
            parts.append(f'<h4>Comparison</h4>{COMPARE}')
        parts.append(recap(t))
        b.append(f'<section class="topic" id="{t}" data-topic="{t}">{h2(TNUM[t], name)}{"".join(parts)}</section>')
    rows = "".join(f"<tr><td class=sym>{s}</td><td>{n}</td><td>{m}</td><td>{a}</td></tr>" for s, n, m, a in C.SYMBOLS)
    b.append(f'<section class="part" id="appA">{h2("A", "Symbol glossary")}<table class="t"><thead><tr><th>Symbol</th><th>Name</th>'
             f'<th>Meaning</th><th>Formulas</th></tr></thead><tbody>{rows}</tbody></table></section>')
    b.append(f'<section class="part" id="appB">{h2("B", "Sources, coverage and gaps")}' + SOURCES_HTML + "</section>")
    return page("Geometrical interpretation of partial derivatives: master", "".join(b))

HF = "pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01/"
HF2 = "pesuc/First_Year_8enterprise/Files/Math 1/"
SOURCES = [
    ("Deck 002 (.pptx, rendered to images; .slides.md; .slides.txt)", HF + "Slides/002_Geometrical_interpretation_of_Partial_derivatives_Problems_on_partial_derivatives__714d38d7a06bef55.*", "11 slides; content on slides 3–10"),
    ("Transcript 002 (.transcript.md / .json / .srt / .txt)", HF + "AV_Summaries/002_Geometrical_interpretation_of_Partial_derivatives__374c7bb76e445af3.*", "15.7 min lecture"),
    ("Video 002 (.mp4): 3 single frames at 00:07:45, 00:09:05, 00:12:40", HF + "AV_Summaries/002_…374c7bb76e445af3.mp4", "Remote seek; the full video was not downloaded"),
    ("Unit 1 & 2 class-work sheet (UE24MA141A)", HF2 + "CW/Math_Unit1&2_CW__1jKDN6W8iw.pdf", "Problems 1, 2, 5 used"),
    ("ESA papers, UE22MA141A: Dec 2023, Jul 2023, May 2024", HF2 + "Papers/ESA Papers/UE22MA141A/*.pdf", "Q1 read for Unit 1"),
    ("ESA papers, UE23MA141A: Jan sets 1–4, June 2024", HF2 + "Papers/ESA Papers/UE23MA141A/*.pdf", "Q1 read for Unit 1"),
]
GAPS = [
    "The deck's title says “Problems on partial derivatives”, but the deck has no problem slides, and the transcript defers problems to the next class (T002 00:14:59). Problems were taken from the class-work sheet and ESA papers instead.",
    "Slide 10 shows an interactive “Second-Order Partial Derivatives” demonstration. The transcript names its source unclearly (“Ultra Am lab”), and the video frame at 00:12:40 does not show a name, so the tool is described without one.",
    "The link promised “in my next slide” (T002 00:15:16) is not in the deck; slide 11 is the closing slide.",
    "Slides 4, 5 and 8 use third-party images (a YouTube source is credited on the slide). They were redrawn as Figures G1–G3 and G8 rather than copied.",
    "The UE23MA141A papers are headed “JAN 2023”, but the browser print header says Jan 2024. They are cited as Jan 2024.",
    "Transcript recognition errors were corrected silently: “geometally” → geometrically, “Z1” → $z_y$, “impartial derivatives” → in partial derivatives, “Claret theorem” → Clairaut's theorem, “jowl” → jolt (another name for jerk).",
]

def sources_html():
    rows = "".join(f'<tr><td>{a}</td><td class="src" style="word-break:break-all">{html.escape(b)}</td><td>{c}</td></tr>' for a, b, c in SOURCES)
    gaps = "".join(f"<li>{g}</li>" for g in GAPS)
    return ('<table class="t"><thead><tr><th>Source</th><th>Hugging Face bucket path (alvin3y10/data)</th><th>Use</th></tr></thead>'
            f'<tbody>{rows}</tbody></table><h4>Known gaps and conflicts</h4><ol class="pts">{gaps}</ol>'
            '<h4>Coverage</h4><div id="coverage-table">__COVERAGE__</div>')

SOURCES_HTML = sources_html()

def coverage():
    slides = Counter(); tr = 0; vid = 0; other = Counter()
    for k, v in SRC_COUNT.items():
        if k.startswith("S002·"): slides[int(k.split("·")[1])] += v
        elif k.startswith("T002"): tr += v
        elif k.startswith("V002"): vid += v
        else: other[k.split(" ")[0] + " " + k.split(" ")[1]] += v
    rows = "".join(f"<tr><td>Slide {n}</td><td>{slides[n]}</td></tr>" for n in range(3, 11))
    rows += f"<tr><td>Transcript 002 (all citations)</td><td>{tr}</td></tr><tr><td>Video frames</td><td>{vid}</td></tr>"
    rows += "".join(f"<tr><td>{k}</td><td>{v}</td></tr>" for k, v in sorted(other.items()))
    return ('<table class="t"><thead><tr><th>Source</th><th>Citations in this pack</th></tr></thead><tbody>'
            f'{rows}</tbody></table><p class="small">Slides 1, 2 and 11 are the title, session and closing slides and hold no content.</p>')

# ============================================================== math rendering
MATH_RE = re.compile(r"\$\$(.+?)\$\$|\$(.+?)\$", re.S)

def render_math(docs):
    items, keys = [], {}
    for d in docs.values():
        for m in MATH_RE.finditer(d):
            tex, disp = (m.group(1), True) if m.group(1) is not None else (m.group(2), False)
            k = (tex, disp)
            if k not in keys:
                keys[k] = len(items); items.append({"tex": html.unescape(tex), "display": disp})
    res = subprocess.run(["node", os.path.join(HERE, "katex_render.mjs")], input=json.dumps(items),
                         capture_output=True, text=True, cwd=HERE)
    if res.returncode:
        sys.exit(res.stderr)
    out = json.loads(res.stdout)
    def sub(m):
        k = (m.group(1), True) if m.group(1) is not None else (m.group(2), False)
        return out[keys[k]]
    return {n: MATH_RE.sub(sub, d) for n, d in docs.items()}

if __name__ == "__main__":
    docs = {"01_formulas_and_symbols": doc01(), "02_important_points": doc02(), "03_graphs_and_diagrams": doc03(),
            "04_flowcharts_and_visuals": doc04(), "05_short_notes_keywords": doc05()}
    SRC_COUNT.clear()
    docs["00_MASTER_geometrical_interpretation"] = doc00()
    docs["00_MASTER_geometrical_interpretation"] = docs["00_MASTER_geometrical_interpretation"].replace("__COVERAGE__", coverage())
    docs = render_math(docs)
    for n, d in docs.items():
        with open(os.path.join(OUT, n + ".html"), "w") as f:
            f.write(d)
        print("wrote", n + ".html", len(d) // 1024, "KB")
