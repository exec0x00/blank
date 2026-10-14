"""HTML components for study packs.

Visual language = Flowchart_Template_v7 (blocks, layouts) + Graph_Style_Guide_v2 (figure captions).
Every function returns an HTML string. Maths stays as $…$ / $$…$$ and is rendered later by KaTeX.
"""
import html
from collections import Counter

SRC_COUNT = Counter()   # every source tag emitted, for the coverage table


# ------------------------------------------------------------------ chips and tags
def stars(n):
    if n in (None, 0, ""):
        return ""
    return f'<span class="stars">ESA {"★" * n if isinstance(n, int) else n}</span>'


def src(tags):
    for t in tags or []:
        SRC_COUNT[t] += 1
    return f'<span class="src">{" · ".join(html.escape(t) for t in tags)}</span>' if tags else ""


def flags(fl):
    return "".join(f'<span class="flag">{html.escape(f)}</span>' for f in (fl or []))


def tagline(fl, tags):
    return f'<div class="tags">{flags(fl)}{src(tags)}</div>'


def h2(num, title, id_=None):
    i = f' id="{id_}"' if id_ else ""
    return f'<h2{i}><span>{num}</span><span>{title}</span></h2>'


def h3(num, title, id_=None):
    i = f' id="{id_}"' if id_ else ""
    return f'<h3{i}><span>{num}</span><span>{title}</span></h3>'


# ------------------------------------------------------------------ flowchart blocks
def arrow():
    return '<div class="arrow"><div class="shaft"></div><div class="head"></div></div>'


def given(title, sub="", lab="given", center=False, **_):
    st = ' style="text-align:center"' if center else ""
    return (f'<div class="blk given"{st}><div class="lab">{lab}</div><div class="btitle">{title}</div>'
            + (f'<div class="bsub">{sub}</div>' if sub else "") + "</div>")


def step(n=None, title="", sub="", fx="", **_):
    num = f'<span class="num">{n}</span>' if n else ""
    return (f'<div class="blk step">{num}<div style="min-width:0"><div class="btitle">{title}</div>'
            + (f'<div class="bsub">{sub}</div>' if sub else "") + (f'<div class="fx">{fx}</div>' if fx else "")
            + "</div></div>")


def result(title, fx="", sub="", lab="result", n=None, **_):
    inner = ((f'<div class="lab">{lab}</div>' if lab else "") + f'<div class="btitle">{title}</div>'
             + (f'<div class="fx">{fx}</div>' if fx else "") + (f'<div class="bsub">{sub}</div>' if sub else ""))
    if n:
        return f'<div class="blk result" style="display:flex;gap:12px"><span class="num">{n}</span><div>{inner}</div></div>'
    return f'<div class="blk result">{inner}</div>'


def question(title, **_):
    return f'<div class="q"><span class="dia"></span><span class="qt">{title}</span></div>'


def remark(text, lab="Remark."):
    return f'<div class="remark"><b><i>{lab}</i></b> {text}</div>'


def check(title, sub="", **_):
    return (f'<div class="blk check"><span class="tick">✓</span><div><div class="lab">check</div>'
            f'<div class="btitle">{title}</div>' + (f'<div class="bsub">{sub}</div>' if sub else "") + "</div></div>")


def table_block(head, rows, **_):
    n = len(head)
    g = f"grid-template-columns:repeat({n},minmax(0,1fr))"
    h = "".join(f"<span>{c}</span>" for c in head)
    r = "".join(f'<div class="tb-row" style="{g}">' + "".join(f"<span>{c}</span>" for c in row) + "</div>" for row in rows)
    return f'<div class="tblock"><div class="tb-head" style="{g}">{h}</div>{r}</div>'


KINDS = {"given": given, "step": step, "result": result, "question": question, "check": check, "table": table_block}


def node(d):
    """d = {"kind": "given|step|result|question|check|table", "title":..., "sub":..., "fx":..., "n":..., "lab":...}"""
    d = dict(d)
    k = d.pop("kind", "step")
    return KINDS[k](**d)


def chain(nodes, margin=False):
    out = []
    for i, n in enumerate(nodes):
        if i:
            out.append(arrow())
        h = node(n)
        out.append(f'<div style="margin:0 10px">{h}</div>' if margin else h)
    return "".join(out)


def center(h, w="105mm"):
    return f'<div style="width:100%;max-width:{w};margin:0 auto">{h}</div>'


# ------------------------------------------------------------------ the eight layouts of Flowchart_Template_v7
def lay_straight(spec):
    """{"nodes": [...]}: a procedure with no choices."""
    return chain(spec["nodes"])


def lay_fork(spec):
    """Fork and rejoin. {"before": [...], "question": "...", "no": node, "yes": node, "after": [...]}"""
    def col(side, n, pill):
        cls = "yes" if pill == "yes" else ""
        return (f'<div class="col"><div class="fork-{side}"><div class="head"></div><span class="pill {cls}">{pill}</span></div>'
                f'<div style="flex:1;margin:0 10px;display:flex;flex-direction:column">{node(n)}</div><div class="join-{side}"></div></div>')
    body = center(chain(spec.get("before", []) + [{"kind": "question", "title": spec["question"]}]), "120mm")
    body += '<div class="stem"><div></div></div><div class="two">' + col("l", spec["no"], "no") + col("r", spec["yes"], "yes") + "</div>"
    if spec.get("after"):
        body += arrow() + center(chain(spec["after"]), "120mm")
    return body


def lay_route(spec):
    """Pick a route. {"question": "...", "rows": [{"title","sub","kw","dashed"}]}"""
    rows = spec["rows"]
    out = ['<div class="route"><div class="hub"><div class="hubq"><span class="dia"></span>'
           f'<span class="qt">{spec["question"]}</span></div><div class="stub"></div></div><div class="col">']
    for i, r in enumerate(rows):
        cls = "rrow" + (" first" if i == 0 else "") + (" last" if i == len(rows) - 1 else "")
        dashed = r.get("dashed")
        out.append(f'<div class="{cls}"><div class="conn"><div class="v"></div><div class="h{" dashed" if dashed else ""}"></div><div class="t"></div></div>'
                   f'<div class="cell"><div class="rbox{" dashed" if dashed else ""}"><div style="min-width:0"><div class="btitle" style="font-size:11pt">{r["title"]}</div>'
                   + (f'<div class="bsub" style="margin-top:0">{r["sub"]}</div>' if r.get("sub") else "")
                   + f'</div>' + (f'<span class="kw">{r["kw"]}</span>' if r.get("kw") else "") + "</div></div></div>")
    out.append("</div></div>")
    return "".join(out)


def lay_streams(spec):
    """Two streams meet. {"left": [...], "right": [...], "then": [...]}"""
    def col(side, nodes):
        return f'<div class="col">{chain(nodes, margin=True)}<div class="join-{side}"></div></div>'
    return (f'<div class="two">{col("l", spec["left"])}{col("r", spec["right"])}</div>' + arrow()
            + center(chain(spec["then"])))


def lay_ladder(spec):
    """Decision ladder. {"start": node, "rungs": [{"q": "...", "yes": node}], "last": node}"""
    def harrow():
        return '<div class="harrow"><div class="hs"></div><div class="hh"></div><span class="pill yes">yes</span></div>'
    def varrow():
        return ('<div class="varrow"><div class="vs"></div><div class="vh"></div><span class="pill">no</span></div><div></div><div></div>')
    out = ['<div class="ladder">', node(spec["start"]), "<div></div><div></div>", arrow(), "<div></div><div></div>"]
    for i, r in enumerate(spec["rungs"]):
        if i:
            out.append(varrow())
        out += [question(r["q"]), harrow(), node(dict(r["yes"], kind=r["yes"].get("kind", "result")))]
    if spec.get("last"):
        out += [varrow(), node(spec["last"]), "<div></div><div></div>"]
    out.append("</div>")
    return "".join(out)


def lay_tree(spec):
    """Family tree. {"root": node, "branches": [{"title","sub","rows": [[a, b], ...]}]}"""
    br = spec["branches"]
    cols = []
    for i, b in enumerate(br):
        side = "l" if i == 0 else ("r" if i == len(br) - 1 else "m")
        rows = "".join(f'<div class="frow"><b>{a}</b><span>{c}</span></div>' for a, c in b["rows"])
        cols.append(f'<div class="col"><div class="fork-{side}" style="height:30px"><div class="head"></div></div>'
                    f'<div class="ftable" style="margin:0 10px"><div class="fhead"><div class="btitle">{b["title"]}</div>'
                    + (f'<div class="bsub">{b["sub"]}</div>' if b.get("sub") else "") + f"</div>{rows}</div></div>")
    grid = f'style="display:grid;grid-template-columns:repeat({len(br)},minmax(0,1fr))"'
    return center(node(dict(spec["root"], center=True)), "95mm") + f'<div class="stem"><div></div></div><div {grid}>' + "".join(cols) + "</div>"


def lay_loop(spec):
    """Repeat until. {"before": [...], "loop": [...] (last one is usually a question), "after": [...]}.
    The return line runs from the last loop node back to the first loop node."""
    out = [f'<div style="margin-right:60px">{chain(spec.get("before", []))}</div>']
    if spec.get("before"):
        out.append(f'<div style="margin-right:60px">{arrow()}</div>')
    out.append(f'<div class="loopbox">{chain(spec["loop"])}<div class="loopline"></div><div class="loophead"></div>'
               '<span class="pill">no</span></div>')
    if spec.get("after"):
        out.append('<div style="margin-right:60px" class="varrow"><div class="vs"></div><div class="vh"></div><span class="pill yes">yes</span></div>')
        out.append(f'<div style="margin-right:60px">{chain(spec["after"])}</div>')
    return "".join(out)


def lay_verify(spec):
    """Verify both sides. {"given": node, "left": [...], "right": [...], "check": node}"""
    def col(side, nodes):
        return f'<div class="col"><div class="fork-{side}"><div class="head"></div></div>{chain(nodes, margin=True)}<div class="join-{side}" style="min-height:26px"></div></div>'
    return (center(node(dict(spec["given"], center=True)), "100mm") + '<div class="stem"><div></div></div>'
            + f'<div class="two">{col("l", spec["left"])}{col("r", spec["right"])}</div>' + arrow()
            + center(node(dict(spec["check"], kind="check")), "100mm"))


LAYOUTS = {"straight": lay_straight, "fork": lay_fork, "route": lay_route, "streams": lay_streams,
           "ladder": lay_ladder, "tree": lay_tree, "loop": lay_loop, "verify": lay_verify}


def flowchart(f):
    """f = {"id","topic","title","stars","flags","srcs","layout","spec","remark","trap","maxw"}"""
    body = LAYOUTS[f["layout"]](f["spec"])
    rem = ""
    if f.get("remark"):
        rem += remark(f["remark"])
    if f.get("trap"):
        rem += remark(f["trap"], "Exam trap.")
    rem = f'<div style="width:100%;max-width:130mm;display:flex;flex-direction:column;gap:8px">{rem}</div>' if rem else ""
    return (f'<figure class="flowfig" id="{f["id"]}"><div class="flow" style="max-width:{f.get("maxw", "150mm")}">{body}</div>{rem}'
            f'<figcaption><div class="capt"><b>Figure {f["id"]}.</b> {f["title"]} {stars(f.get("stars"))}</div>'
            f'{tagline(f.get("flags"), f.get("srcs"))}</figcaption></figure>')


# ------------------------------------------------------------------ content blocks
def formula_card(e):
    grid = f'<b>gives</b><span>{e["gives"]}</span>'
    if e.get("when"):
        grid += f'<b>applies</b><span>{e["when"]}</span>'
    if e.get("units"):
        grid += f'<b>units</b><span>{e["units"]}</span>'
    if e.get("note"):
        grid += f'<b>note</b><span>{e["note"]}</span>'
    return (f'<div class="card" id="{e["id"]}"><div class="chead"><span class="ctitle">{e["id"]} · {e["title"]}</span>{stars(e.get("stars"))}</div>'
            + (f'<pre class="code">{html.escape(e["code"]).replace("$", "&#36;")}</pre>' if e.get("code") else f'<div class="fx">$${e["tex"]}$$</div>')
            + f'<div class="grid">{grid}</div>{tagline(e.get("flags"), e.get("srcs"))}</div>')


def definition(d):
    return f'<div class="def"><span class="term">{d["term"]}.</span> {d["text"]} {flags(d.get("flags"))} {src(d.get("srcs"))}</div>'


def statement(s):
    return f'<div class="statement">“{s["text"]}” {src(s.get("srcs"))}</div>'


def point_list(pts):
    items = "".join(f'<li>{p["text"]} {stars(p.get("stars"))} {flags(p.get("flags"))} {src(p.get("srcs"))}</li>' for p in pts)
    return f'<ol class="pts">{items}</ol>' if items else ""


def why(w):
    return f'<div class="why"><div class="wq">{w["q"]}</div><div>{w["a"]}</div>{tagline(w.get("flags"), w.get("srcs"))}</div>'


def trap(t):
    return f'<div class="trap"><span class="tl">Exam trap.</span> {t["text"]} {flags(t.get("flags"))} {src(t.get("srcs"))}</div>'


def worked(w):
    rows = "".join(f'<div class="wrow"><b>step {i + 1}</b><span>{s}</span></div>' for i, s in enumerate(w["steps"]))
    chk = f'<div class="wrow"><b>check</b><span>{w["check"]}</span></div>' if w.get("check") else ""
    return (f'<div class="worked" id="{w["id"]}"><div class="wh"><span class="btitle">{w["id"]} · {w["title"]}</span>{stars(w.get("stars"))}</div><div class="wb">'
            f'<div class="wrow"><b>given</b><span>{w["given"]}</span></div>{rows}'
            f'<div class="wrow"><b>answer</b><span><span class="ans">{w["answer"]}</span></span></div>{chk}'
            f'{tagline(w.get("flags"), w.get("srcs"))}</div></div>')


def pyq(p, link_prefix=""):
    sol = f' · solved in <a href="{link_prefix}#{p["worked"]}">{p["worked"]}</a>' if p.get("worked") else ""
    marks = f'<span class="pill">{p["marks"]} marks</span>' if p.get("marks") else ""
    return (f'<div class="pyq"><div class="ph"><span class="pill yes">{p["paper"]}</span>{marks}'
            f'<span class="src">{p.get("q", "")}{sol}</span></div>{p["text"]}</div>')


def figure(gid, g):
    cls = "chart tall" if g.get("tall") else "chart"
    howto = f'<div class="howto">{remark(g["howto"], "How to read it.")}</div>' if g.get("howto") else ""
    return (f'<figure class="{cls}" id="{gid}"><img src="assets/figures/{gid}.svg" alt="Figure {gid}: {html.escape(g["title"])}">'
            f'<figcaption><div class="capt"><b>Figure {gid}.</b> {g["title"]}. {stars(g.get("stars"))}</div>'
            f'{tagline(g.get("flags"), g.get("srcs"))}</figcaption>{howto}</figure>')


def comparison(c):
    head = "".join(f"<th>{h}</th>" for h in c["head"])
    rows = "".join("<tr>" + "".join(f"<td>{'<b>' + x + '</b>' if j == 0 and c.get('row_heads', True) else x}</td>"
                                     for j, x in enumerate(r)) + "</tr>" for r in c["rows"])
    keep = " keep" if len(c["rows"]) <= 8 else ""
    return (f'<div id="{c["id"]}"><h4>{c["title"]}</h4><table class="t{keep}"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>'
            f'{tagline(c.get("flags"), c.get("srcs"))}</div>')


def recap(text):
    return f'<div class="recap"><div class="lab">short-note recap</div><div>{text}</div></div>'
