import math, sys

OUT = sys.argv[1]
INK = "#111"; BLUE = "#0072B2"; VERM = "#D55E00"; GREEN = "#009E73"; GREY = "#9a9a9a"; PURP = "#A0557F"

# ---------------------------------------------------------------- svg helpers
def svg(w, h, body, cls="fig", maxw=None):
    st = f' style="max-width:{maxw}px"' if maxw else ""
    return (f'<svg class="{cls}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg"{st} '
            f'font-family="Latin Modern Roman, CMU Serif, FreeSerif, Liberation Serif, serif">{body}</svg>')

def line(pts, c=INK, w=1.6, dash=None, extra=""):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    p = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    return f'<polyline points="{p}" fill="none" stroke="{c}" stroke-width="{w}" stroke-linejoin="round"{d}{extra}/>'

def text(x, y, s, size=13, anchor="middle", it=False, c=INK, bold=False):
    st = ' font-style="italic"' if it else ""
    b = ' font-weight="700"' if bold else ""
    return f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" fill="{c}"{st}{b}>{s}</text>'

def var(x, y, v, sub="", size=14, anchor="middle", c=INK):
    s = f'<tspan font-style="italic">{v}</tspan>'
    if sub:
        s += f'<tspan font-size="{size*0.72:.0f}" dy="4">{sub}</tspan>'
    return text(x, y, s, size, anchor, c=c)

def dot(x, y, c=INK):
    return f'<circle cx="{x}" cy="{y}" r="3.2" fill="{c}"/>'

def term(x, y):
    return f'<circle cx="{x}" cy="{y}" r="3.6" fill="#fff" stroke="{INK}" stroke-width="1.4"/>'

def diode(x1, y1, x2, y2, label="", lo=(0, -16), c=INK):
    """anode at (x1,y1), cathode at (x2,y2)"""
    L = math.hypot(x2 - x1, y2 - y1); a = math.degrees(math.atan2(y2 - y1, x2 - x1))
    m = L / 2; s = 9
    g = (f'<g transform="translate({x1},{y1}) rotate({a:.2f})">'
         + line([(0, 0), (m - s, 0)], c) + line([(m + s * .7, 0), (L, 0)], c)
         + f'<polygon points="{m-s},{-s} {m-s},{s} {m+s*.7},0" fill="{c}" stroke="{c}" stroke-width="1.2"/>'
         + line([(m + s * .7, -s), (m + s * .7, s)], c, 2.2) + '</g>')
    if label:
        cx, cy = (x1 + x2) / 2 + lo[0], (y1 + y2) / 2 + lo[1]
        g += var(cx, cy, label[0], label[1:], 14)
    return g

def res_v(x, y1, y2, n=6, amp=7):
    mid = (y1 + y2) / 2; z = 46; a = mid - z / 2
    pts = [(x, y1), (x, a)]
    for i in range(n):
        pts.append((x + (amp if i % 2 == 0 else -amp), a + z * (i + .5) / n))
    pts += [(x, a + z), (x, y2)]
    return line(pts)

def res_h(x1, x2, y, n=6, amp=7):
    mid = (x1 + x2) / 2; z = 46; a = mid - z / 2
    pts = [(x1, y), (a, y)]
    for i in range(n):
        pts.append((a + z * (i + .5) / n, y + (-amp if i % 2 == 0 else amp)))
    pts += [(a + z, y), (x2, y)]
    return line(pts)

def coil(x, y1, y2, n=4, right=True):
    r = (y2 - y1) / (2 * n); sw = 1 if right else 0
    d = f"M{x},{y1} " + " ".join(f"a7,{r:.2f} 0 0 {sw} 0,{2*r:.2f}" for _ in range(n))
    return f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="1.6"/>'

def transformer(xp, xs, y1, y2, n=4, ct=False):
    g = coil(xp, y1, y2, n, True) + coil(xs, y1, y2, n, False)
    cx = (xp + xs) / 2
    g += line([(cx - 3, y1 - 4), (cx - 3, y2 + 4)], INK, 1.4) + line([(cx + 3, y1 - 4), (cx + 3, y2 + 4)], INK, 1.4)
    return g

def source(x, y, r=17):
    return (f'<circle cx="{x}" cy="{y}" r="{r}" fill="#fff" stroke="{INK}" stroke-width="1.6"/>'
            f'<path d="M{x-9},{y} q4.5,-10 9,0 t9,0" fill="none" stroke="{INK}" stroke-width="1.5"/>')

def ground(x, y):
    return line([(x - 11, y), (x + 11, y)]) + line([(x - 7, y + 4), (x + 7, y + 4)]) + line([(x - 3, y + 8), (x + 3, y + 8)])

def arrow(x1, y1, x2, y2, c=VERM, w=1.8):
    a = math.atan2(y2 - y1, x2 - x1); h = 7
    p1 = (x2 - h * math.cos(a) + h * .55 * math.sin(a), y2 - h * math.sin(a) - h * .55 * math.cos(a))
    p2 = (x2 - h * math.cos(a) - h * .55 * math.sin(a), y2 - h * math.sin(a) + h * .55 * math.cos(a))
    return line([(x1, y1), (x2, y2)], c, w) + f'<polygon points="{x2},{y2} {p1[0]:.1f},{p1[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}" fill="{c}"/>'

# ---------------------------------------------------------------- waveforms
def f_sin(t): return math.sin(2 * math.pi * t)
def f_hw(t): return max(f_sin(t), 0)
def f_hwn(t): return min(f_sin(t), 0)
def f_fw(t): return abs(f_sin(t))

def rippled(cycles, n):
    tau, v, out = 1.4, 0.0, []
    for i in range(n + 1):
        t = cycles * i / n
        v = max(abs(f_sin(t)), v * math.exp(-(cycles / n) / tau))
        out.append(v)
    return out

def plot(x0, y0, w, h, fn=None, vals=None, cycles=1, amp=1.0, base="mid", c=BLUE, fill=True,
         ticks=True, ylabel="", n=240, only=None, ghost=None, peak=None, axis_label="t"):
    """axes at (x0,y0) top-left box w x h. base mid|low. only=(t0,t1) highlight window."""
    yb = y0 + h / 2 if base == "mid" else y0 + h - 6
    A = (h / 2 - 6) if base == "mid" else (h - 14)
    g = arrow(x0, yb, x0 + w + 6, yb, INK, 1.1) + arrow(x0, y0 + h, x0, y0 - 4, INK, 1.1)
    if vals is None:
        vals = [fn(cycles * i / n) for i in range(n + 1)]
    pts = [(x0 + w * i / n, yb - A * amp * v) for i, v in enumerate(vals)]
    if ghost is not None:  # faint reference curve
        gv = [ghost(cycles * i / n) for i in range(n + 1)]
        g += line([(x0 + w * i / n, yb - A * v) for i, v in enumerate(gv)], GREY, 1, "3 3")
    if only:
        seg = [p for i, p in enumerate(pts) if only[0] <= cycles * i / n <= only[1]]
        rest = pts
        g += line(rest, GREY, 1.2, "4 3")
        pts = seg
    if fill:
        poly = [(pts[0][0], yb)] + pts + [(pts[-1][0], yb)]
        g += f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in poly)}" fill="{c}" fill-opacity=".14"/>'
    g += line(pts, c, 2)
    if ticks:
        for k in range(1, int(cycles * 2) + 1):
            tx = x0 + w * k / (cycles * 2)
            lab = "T/2" if k == 1 else ("T" if k == 2 else f"{k//2}T" if k % 2 == 0 else f"{k}T/2")
            g += line([(tx, yb - 3), (tx, yb + 3)], INK, 1)
            g += text(tx, yb + 15 if base == "low" or True else 0, lab, 10, it=True, c="#444")
    if ylabel:
        g += text(x0 + 6, y0 - 2, ylabel, 12, "start", it=True)
    if axis_label:
        g += text(x0 + w + 10, yb + 4, axis_label, 11, "start", it=True)
    if peak:
        py = yb - A * amp * peak[0]
        g += line([(x0, py), (x0 + w, py)], GREY, .9, "3 3")
        g += text(x0 - 4, py + 4, peak[1], 10.5, "end", c="#333")
    return g

def mini(fn=None, vals=None, only=None, cycles=1, base="mid", c=BLUE, amp=1.0, w=150, h=62, peak=None, ghost=None):
    return svg(w + 40, h + 22, plot(30, 10, w, h, fn, vals, cycles, amp, base, c, only=only, peak=peak, ghost=ghost),
               "mini", w + 40)

# ---------------------------------------------------------------- html helpers
def fr(n, d):
    return f'<span class="fr"><span>{n}</span><span>{d}</span></span>'

def V(s, sub=""):
    return f'<i>{s}</i>' + (f'<sub>{sub}</sub>' if sub else "")

Vm, Im, Vdc, Idc, Vrms, Irms, RL, Vg, rf = V("V", "m"), V("I", "m"), V("V", "dc"), V("I", "dc"), V("V", "rms"), V("I", "rms"), V("R", "L"), V("V", "γ"), V("r", "f")
SQ2 = "√2"

def given(title, body):
    return f'<div class="blk given"><div class="lab">Given</div><div class="btitle">{title}</div><div class="bsub">{body}</div></div>'

def step(n, title, body="", fx=""):
    f = f'<div class="fx">{fx}</div>' if fx else ""
    b = f'<div class="bsub">{body}</div>' if body else ""
    return f'<div class="blk step"><div class="num">{n}</div><div><div class="btitle">{title}</div>{b}{f}</div></div>'

def result(title, body):
    return f'<div class="blk result"><div class="lab">Answer</div><div class="btitle">{title}</div><div class="bsub">{body}</div></div>'

def remark(body):
    return f'<div class="remark">{body}</div>'

ARROW = '<div class="arrow"><div class="shaft"></div><div class="head"></div></div>'

def flow(*blocks):
    return '<div class="flow">' + ARROW.join(blocks) + '</div>'

def question(n, short, qtext, marks=""):
    return (f'<h2 id="Q{n}"><span>Q{n}</span><span>{short}</span></h2>'
            f'<div class="statement"><span class="lab" style="font-style:normal">Question {n}</span><br>{qtext}</div>')

def fig(svgs, cap, meta=""):
    m = f'<div class="meta">{meta}</div>' if meta else ""
    return f'<figure>{svgs}<figcaption><div class="capt">{cap}</div>{m}</figcaption></figure>'

# ================================================================ Q1 block diagram
def q1_svg():
    W, H = 760, 270
    cols = [62, 182, 302, 422, 542, 680]
    names = [None, ("Step-down", "transformer"), ("Rectifier", ""), ("Filter", "(capacitor)"), ("Voltage", "regulator"), None]
    g = ""
    by, bh, bw = 30, 58, 100
    # mains label
    g += f'<rect x="{cols[0]-48}" y="{by}" width="96" height="{bh}" rx="29" fill="#fff" stroke="{INK}" stroke-width="2"/>'
    g += text(cols[0], by + 25, "AC mains", 13, bold=True) + text(cols[0], by + 42, "230 V, 50 Hz", 11.5, c="#444")
    for i in range(1, 5):
        x = cols[i]
        g += f'<rect x="{x-bw/2}" y="{by}" width="{bw}" height="{bh}" rx="12" fill="#fff" stroke="#888" stroke-width="1.2"/>'
        a, b = names[i]
        g += text(x, by + (26 if b else 34), a, 13.5, bold=True)
        if b: g += text(x, by + 43, b, 12, c="#444")
    # load
    x = cols[5]
    g += f'<rect x="{x-44}" y="{by}" width="88" height="{bh}" rx="12" fill="#111"/>'
    g += text(x, by + 25, "Load", 13.5, bold=True, c="#fff")
    g += text(x, by + 42, "steady DC", 11.5, c="#ddd")
    # arrows
    edges = [cols[0] + 48, cols[1] - bw / 2, cols[1] + bw / 2, cols[2] - bw / 2, cols[2] + bw / 2, cols[3] - bw / 2,
             cols[3] + bw / 2, cols[4] - bw / 2, cols[4] + bw / 2, cols[5] - 44]
    for k in range(0, len(edges), 2):
        g += arrow(edges[k] + 2, by + bh / 2, edges[k + 1] - 2, by + bh / 2, "#444", 1.8)
    # graphs: output of each stage
    gy, gw, gh = 135, 92, 60
    rp = rippled(2, 240)
    specs = [
        dict(fn=f_sin, amp=1.0, base="mid", c=BLUE, t="230 V AC (high)"),
        dict(fn=f_sin, amp=.45, base="mid", c=BLUE, t="low-voltage AC"),
        dict(fn=f_fw, amp=.85, base="low", c=VERM, t="pulsating DC"),
        dict(vals=rp, amp=.85, base="low", c=GREEN, t="DC + small ripple"),
        dict(fn=lambda t: .62, amp=1, base="low", c=PURP, t="pure, constant DC"),
    ]
    for i, s in enumerate(specs):
        x = cols[i] - gw / 2 + 4
        g += line([(cols[i], by + bh + 4), (cols[i], gy - 12)], GREY, 1, "2 3")
        g += plot(x, gy, gw, gh, s.get("fn"), s.get("vals"), 2, s["amp"], s["base"], s["c"], ticks=False,
                  axis_label="", ylabel="")
        g += text(cols[i] + 4, gy + gh + 22, s["t"], 11.5, c="#333")
    g += text(cols[5], gy + 24, "Output of each", 11.5, c="#555", it=True)
    g += text(cols[5], gy + 40, "block is drawn", 11.5, c="#555", it=True)
    g += text(cols[5], gy + 56, "under it  ↙", 11.5, c="#555", it=True)
    return svg(W, H, g, "fig", 760)

# ================================================================ circuits
def hwr_circuit():
    g = source(40, 110)
    g += line([(40, 93), (40, 50), (98, 50)]) + line([(40, 127), (40, 170), (98, 170)])
    g += transformer(98, 132, 50, 170, 4)
    g += diode(132, 50, 250, 50, "D", (0, -16))
    g += line([(250, 50), (320, 50)]) + res_v(320, 50, 170) + line([(132, 170), (320, 170)])
    g += var(342, 114, "R", "L") + dot(320, 50) + dot(320, 170)
    g += line([(320, 50), (390, 50)]) + line([(320, 170), (390, 170)]) + term(390, 50) + term(390, 170)
    g += text(390, 74, "+", 16) + text(390, 156, "−", 16) + var(398, 116, "V", "o", 15, "start")
    g += var(40, 196, "v", "i", 14) + text(10, 115, "AC", 11, c="#444")
    g += var(142, 112, "v", "s", 14, "start")
    g += arrow(205, 30, 260, 30) + text(232, 22, "i (+ve half)", 11, c=VERM, it=True)
    g += arrow(338, 70, 338, 92)
    return svg(440, 210, g, "fig", 520)

def ct_circuit():
    g = source(36, 130)
    g += line([(36, 113), (36, 40), (94, 40)]) + line([(36, 147), (36, 220), (94, 220)])
    g += transformer(94, 128, 40, 220, 6)
    g += text(18, 135, "", 11)
    g += diode(128, 40, 250, 40, "D1", (0, -16))
    g += diode(128, 220, 250, 220, "D2", (0, 26))
    g += line([(250, 40), (330, 40), (330, 220), (250, 220)]) + dot(330, 130)
    g += line([(128, 130), (175, 130)]) + dot(128, 130) + res_h(175, 285, 130) + line([(285, 130), (330, 130)])
    g += var(230, 112, "R", "L") + text(286, 152, "+", 15) + text(176, 152, "−", 15)
    g += text(150, 124, "CT", 10.5, "start", c="#444")
    g += var(136, 92, "v", "s", 12, "start") + var(136, 182, "v", "s", 12, "start")
    g += text(136, 58, "A", 12, "start", c="#444") + text(136, 212, "B", 12, "start", c="#444")
    g += line([(330, 40), (392, 40)]) + term(392, 40) + line([(330, 220), (330, 220)])
    g += var(36, 248, "v", "i", 14)
    g += arrow(268, 24, 318, 24) + text(293, 16, "+ve half", 10.5, c=VERM, it=True)
    g += arrow(268, 238, 318, 238, BLUE) + text(293, 256, "−ve half", 10.5, c=BLUE, it=True)
    g += arrow(270, 144, 200, 144, INK, 1.2) + text(236, 160, "same direction", 10, c="#444", it=True)
    g = g.replace(line([(330, 40), (392, 40)]) + term(392, 40), "")
    return svg(400, 266, g, "fig", 470)

def bridge_circuit():
    T, L, R, B = (250, 34), (170, 124), (330, 124), (250, 214)
    g = source(36, 124)
    g += line([(36, 107), (36, 34), (94, 34)]) + line([(36, 141), (36, 214), (94, 214)])
    g += transformer(94, 128, 34, 214, 6)
    g += line([(128, 34), T]) + line([(128, 214), B])
    g += diode(*L, *T, "D1", (-16, -8)) + diode(*T, *R, "D2", (16, -8))
    g += diode(*L, *B, "D3", (-16, 16)) + diode(*B, *R, "D4", (16, 16))
    g += res_h(L[0], R[0], 124) + var(250, 108, "R", "L")
    g += text(L[0] + 24, 118, "−", 15) + text(R[0] - 24, 118, "+", 15)
    g += dot(*T) + dot(*L) + dot(*R) + dot(*B)
    g += line([(330, 124), (390, 124)]) + term(390, 124) + line([(170, 124), (150, 124), (150, 260), (390, 260)]) + term(390, 260)
    g += text(400, 128, "+", 14, "start") + text(400, 264, "−", 14, "start") + var(400, 196, "V", "o", 15, "start")
    g += text(262, 28, "P", 12, "start", c="#444") + text(262, 232, "Q", 12, "start", c="#444")
    g += var(36, 240, "v", "i", 14) + var(140, 128, "v", "s", 12, "start")
    return svg(440, 276, g, "fig", 480)

def q3_circuit():
    g = term(30, 40) + term(30, 190)
    g += text(30, 64, "+", 15) + text(30, 172, "−", 15) + var(30, 120, "v", "i", 15)
    g += diode(190, 40, 90, 40, "D", (0, 28))  # anode on the right (output side)
    g += line([(30, 40), (90, 40)]) + line([(190, 40), (250, 40)]) + dot(250, 40)
    g += res_v(250, 40, 175) + var(222, 113, "R", "") + text(268, 113, "2 kΩ", 13, "start")
    g += ground(250, 175)
    g += line([(250, 40), (330, 40)]) + term(330, 40) + term(330, 190)
    g += text(330, 64, "+", 15, c=BLUE) + text(330, 172, "−", 15, c=BLUE) + var(330, 120, "v", "o", 15, c=BLUE)
    g += line([(30, 190), (330, 190)], GREY, 1, "3 3")
    g += text(180, 208, "common (ground) return", 10.5, c="#555", it=True)
    g += arrow(205, 22, 160, 22) + text(182, 14, "i flows only when vᵢ &lt; 0", 10.5, c=VERM, it=True)
    return svg(370, 216, g, "fig", 420)

# ================================================================ big waveform panels
def panel(rows, w=420, h=74, gap=26, left=56):
    H = len(rows) * (h + gap) + 6
    g = ""
    for k, r in enumerate(rows):
        y = 14 + k * (h + gap)
        g += plot(left, y, w, h, r.get("fn"), r.get("vals"), r.get("cycles", 2), r.get("amp", 1), r.get("base", "mid"),
                  r.get("c", BLUE), ylabel="", peak=r.get("peak"), ghost=r.get("ghost"))
        g += text(10, y + h / 2 + 4, r["lab"], 14, "start", it=True, c=r.get("c", BLUE))
    return svg(w + left + 30, H, g, "fig", 500)

# ================================================================ working tables
def work_table(rows, head=("Cycle", "Diode(s) ON / OFF", "Current path", "V<sub>out</sub> graph (one full cycle)")):
    h = "".join(f"<th>{c}</th>" for c in head)
    b = ""
    for r in rows:
        b += "<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>"
    return f'<table class="t work"><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'

ON = '<span class="on">ON</span>'; OFF = '<span class="off">OFF</span>'

# ================================================================ document
css = open(sys.argv[2]).read()
H = []
H.append(f'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Assessment 1 Solutions</title><style>{css}</style></head><body><main class="page">')
H.append('''<header class="doc-head"><div class="kicker">Unit 2 · Diode Applications · Rectifiers &amp; Power Supplies</div>
<h1>Assessment 1 — Solutions</h1>
<div class="sub">Every question reproduced exactly, followed by a step-by-step answer, circuit, working table and waveforms.</div>
<div class="small" style="margin-top:6px">10 questions · worked solutions · compiled 21 October 2026</div></header>''')
H.append(f'''<div class="legend">
<span><b>Symbols</b></span><span>{Vm} peak (secondary) voltage · {Im} peak load current · {RL} load resistance · {rf} diode forward resistance</span>
<span><b>Silicon diode</b></span><span>Cut-in / knee voltage {Vg} = {V("V","T")} = 0.7 V (ideal diode: 0 V)</span>
<span><b>Handy numbers</b></span><span>1/π = 0.318 · 2/π = 0.636 · √2 = 1.414 · 1/√2 = 0.707</span>
<span><b>Colours</b></span><span><span style="color:{BLUE}">blue</span> = input / main waveform · <span style="color:{VERM}">vermilion</span> = rectified output or current path · grey dashed = reference / non-conducting part</span>
</div>''')
H.append('<div class="recap"><div class="lab">Exam recap</div>Always (1) convert rms → peak with √2, (2) apply the turns ratio, (3) subtract 0.7 V per conducting Si diode (one for HWR/CT, two for bridge), (4) use 0.318 or 0.636, (5) PIV: V<sub>m</sub> (HWR, bridge) or 2V<sub>m</sub> (CT).</div>')
H.append('<nav class="toc"><h4>Contents</h4><ol>' + "".join(f'<li><a href="#Q{i}">{t}</a></li>' for i, t in enumerate([
    "Block diagram of a regulated power supply", "Half-wave rectifier: circuit and working table",
    "Negative half-wave rectifier, ideal vs silicon, 20 V vs 200 V", "Full-wave centre-tapped rectifier: circuit and working table",
    "Full-wave bridge rectifier: circuit and working table", "Formula comparison table: HWR, FWR-CT, Bridge",
    "Bridge rectifier, 120 V rms, 1 kΩ, silicon diodes", "Two-diode FWR, 100 V per half, 975 Ω",
    "Bridge rectifier, 220 V, 4 : 1 transformer, 200 Ω", "Bridge rectifier, 230 sin 314t, 10 : 1, 500 Ω"], 1)) + '</ol></nav>')

# ---------------- Q1
H.append('<section class="topic" style="break-before:page">')
H.append(question(1, "Regulated power supply — block diagram",
    "Write block diagram of Regulated power supply with each block showing simple input and output graph."))
H.append(fig(q1_svg(), "Figure 1 · Block diagram of a regulated DC power supply. The small graph under each block is that block’s <b>output</b>, which is also the <b>input</b> of the next block.",
    "Read left to right: the wave starts as high-voltage AC and ends as a steady DC level."))
rows = [
    ("Step-down transformer", "230 V, 50 Hz AC (large sine)", "Low-voltage AC, same 50 Hz (small sine)", "Reduces the mains voltage to the level needed (e.g. 12 V); also isolates the circuit from the mains."),
    ("Rectifier", "Low-voltage AC", "Pulsating DC (unidirectional humps)", "Diodes conduct in one direction only, so the negative halves are removed (HWR) or flipped (FWR)."),
    ("Filter", "Pulsating DC", "DC with small ripple", "A capacitor charges to the peak and supplies the load between peaks, smoothing the humps."),
    ("Voltage regulator", "DC with ripple (varies with mains and load)", "Pure, constant DC", "Zener diode or IC (78xx) holds the output fixed in spite of input or load changes."),
    ("Load", "Constant DC", "—", "The circuit being powered (e.g. an amplifier, a phone charger)."),
]
H.append('<table class="t"><thead><tr><th>Block</th><th>Input</th><th>Output</th><th>Function</th></tr></thead><tbody>' +
         "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows) + "</tbody></table>")
H.append(remark("<b>Remember the order:</b> <i>T</i>ransformer → <i>R</i>ectifier → <i>F</i>ilter → <i>R</i>egulator → Load (“TRFR”). An <i>unregulated</i> supply is the same chain without the regulator block."))
H.append('</section>')

# ---------------- Q2
H.append('<section class="topic">')
H.append(question(2, "Half-wave rectifier — circuit and working",
    "Write a circuit diagram of Half Wave Rectifier and write it’s working in the table format. For ex.<br>"
    "<span class='mini-head'>Cycle | Diode(on/off) | Current | Vout graph(for one full cycle)</span>"))
H.append(fig(hwr_circuit(), "Figure 2.1 · Half-wave rectifier: transformer secondary, one diode <i>D</i> in series with the load <i>R</i><sub>L</sub>.",
             "Vermilion arrows: direction of current during the positive half-cycle."))
H.append(work_table([
    ("<b>Positive half</b><br>0 → <i>T</i>/2<br><span class='small'>top of secondary +</span>", f"{ON}<br>forward biased (anode +)",
     f"Flows: secondary (+) → D → {RL} (top to bottom) → back to secondary.<br><i>i</i> = <i>v</i><sub>s</sub>/{RL}",
     mini(f_hw, only=(0, .5), c=VERM, peak=(1, "Vm")) + f"<div class='small'><i>V</i><sub>out</sub> = <i>v</i><sub>s</sub> = {Vm} sin ω<i>t</i></div>"),
    ("<b>Negative half</b><br><i>T</i>/2 → <i>T</i><br><span class='small'>top of secondary −</span>", f"{OFF}<br>reverse biased (anode −)",
     "No current: diode acts as an open switch.<br><i>i</i> = 0",
     mini(f_hw, only=(.5, 1), c=VERM, peak=(1, "Vm")) + f"<div class='small'><i>V</i><sub>out</sub> = 0; diode blocks PIV = {Vm}</div>"),
]))
H.append(fig(panel([dict(fn=f_sin, lab="vs", c=BLUE, peak=(1, "+Vm")), dict(fn=f_hw, lab="vo", c=VERM, base="low", peak=(1, "Vm"), ghost=None)]),
             "Figure 2.2 · Input and output over two cycles: only the positive halves reach the load.",
             f"Average output {Vdc} = {Vm}/π = 0.318 {Vm}; output frequency = input frequency (50 Hz)."))
H.append('</section>')

# ---------------- Q3
H.append('<section class="topic">')
H.append(question(3, "Sketch v<sub>o</sub> and find the dc level",
    "a. Sketch the output v<sub>o</sub> and determine the dc level of the output for the network given.<br>"
    "b. Repeat part (a) if the ideal diode is replaced by a silicon diode.<br>"
    "c. Repeat parts (a) and (b) if V<sub>m</sub> is increased to 200 V, and compare solutions.<br>"
    "<span class='small'>Network: <i>v</i><sub>i</sub> = 20 V peak sinusoid (period <i>T</i>), diode in series, <i>R</i> = 2 kΩ to ground, output across <i>R</i>.</span>"))
H.append(fig(q3_circuit(), "Figure 3.1 · The given network. The diode’s <b>anode faces the output</b> (bar towards <i>v</i><sub>i</sub>).",
             "So the diode is forward biased only when v<sub>i</sub> is negative: this is a <b>negative</b> half-wave rectifier."))
H.append(flow(
    step(1, "Decide when the diode conducts",
         f"Anode is at the resistor side (≈ 0 V through <i>R</i> to ground), cathode at <i>v</i><sub>i</sub>. "
         f"Diode is ON when cathode is below anode, i.e. when <i>v</i><sub>i</sub> &lt; 0 (second half, <i>T</i>/2 → <i>T</i>). "
         f"For <i>v</i><sub>i</sub> &gt; 0 it is OFF and <i>v</i><sub>o</sub> = 0."),
    step(2, "(a) Ideal diode: output and dc level",
         "During the negative half the ideal diode is a short, so <i>v</i><sub>o</sub> = <i>v</i><sub>i</sub>: a negative pulse of peak −20 V.",
         f"{Vdc} = −0.318 {Vm} = −0.318 × 20 = <b>−6.36 V</b>"),
    step(3, "(b) Silicon diode: subtract 0.7 V from the peak",
         "The diode needs 0.7 V before it conducts, so the output peak is 0.7 V smaller in magnitude.",
         f"{V('V','m')}′ = −(20 − 0.7) = −19.3 V   ⇒   {Vdc} = −0.318 × 19.3 = <b>−6.14 V</b>"),
    step(4, "(c) Repeat with V<sub>m</sub> = 200 V",
         "",
         f"Ideal: {Vdc} = −0.318 × 200 = <b>−63.6 V</b><br>Silicon: {Vdc} = −0.318 × (200 − 0.7) = −0.318 × 199.3 = <b>−63.38 V</b>"),
))
H.append(fig(panel([dict(fn=f_sin, lab="vi", c=BLUE, peak=(1, "20 V")),
                    dict(fn=f_hwn, lab="vo (a)", c=VERM, peak=(-1, "−20 V")),
                    dict(fn=lambda t: min(f_sin(t) + .035, 0), lab="vo (b)", c=GREEN, peak=(-.965, "−19.3 V"), ghost=f_hwn)], left=70),
             "Figure 3.2 · Sketch of v<sub>o</sub>: (a) ideal diode, negative pulses of −20 V; (b) silicon diode, pulses of −19.3 V that start slightly late and end slightly early (grey dashed = ideal).",
             "In (b) the diode stays OFF while |v<sub>i</sub>| &lt; 0.7 V, so each pulse is a little narrower."))
H.append('<table class="t keep"><thead><tr><th>Case</th><th><i>V</i><sub>m</sub> = 20 V</th><th><i>V</i><sub>m</sub> = 200 V</th></tr></thead><tbody>'
         '<tr><td>Ideal diode</td><td>−6.36 V</td><td>−63.6 V</td></tr>'
         '<tr><td>Silicon diode</td><td>−6.14 V</td><td>−63.38 V</td></tr>'
         '<tr><td>Difference</td><td>0.22 V  (≈ 3.5 %)</td><td>0.22 V  (≈ 0.35 %)</td></tr></tbody></table>')
H.append(result("Comparison",
    "The 0.7 V drop always costs the same ≈ 0.22 V of dc level, but at 20 V it is a noticeable 3.5 % error while at 200 V it is only 0.35 %. "
    "<b>For large peak voltages (V<sub>m</sub> ≫ V<sub>T</sub>) the ideal-diode model is accurate enough;</b> for small voltages the 0.7 V must be included."))
H.append('</section>')

# ---------------- Q4
H.append('<section class="topic">')
H.append(question(4, "Full-wave centre-tap rectifier — circuit and working",
    "Write a circuit diagram of FWR-CT and it’s working in table format."))
H.append(fig(ct_circuit(), "Figure 4.1 · Full-wave centre-tapped rectifier: two diodes, each fed by one half of a centre-tapped secondary.",
             "Each half of the secondary gives v<sub>s</sub> (peak V<sub>m</sub>). Current through R<sub>L</sub> is in the same direction in both halves."))
H.append(work_table([
    ("<b>Positive half</b><br>0 → <i>T</i>/2<br><span class='small'>A +, B − w.r.t. CT</span>", f"D1 {ON}<br>D2 {OFF}",
     f"A → D1 → {RL} (+ to −) → centre tap.<br><i>i</i> = <i>v</i><sub>s</sub>/{RL}",
     mini(f_fw, only=(0, .5), c=VERM, peak=(1, "Vm")) + f"<div class='small'><i>V</i><sub>out</sub> = {Vm} sin ω<i>t</i></div>"),
    ("<b>Negative half</b><br><i>T</i>/2 → <i>T</i><br><span class='small'>B +, A − w.r.t. CT</span>", f"D1 {OFF}<br>D2 {ON}",
     f"B → D2 → {RL} (+ to −, <b>same direction</b>) → centre tap.<br><i>i</i> = |<i>v</i><sub>s</sub>|/{RL}",
     mini(f_fw, only=(.5, 1), c=VERM, peak=(1, "Vm")) + f"<div class='small'><i>V</i><sub>out</sub> = |{Vm} sin ω<i>t</i>|; OFF diode sees PIV = 2{Vm}</div>"),
]))
H.append(fig(panel([dict(fn=f_sin, lab="vs", c=BLUE, peak=(1, "+Vm")), dict(fn=f_fw, lab="vo", c=VERM, base="low", peak=(1, "Vm"))]),
             "Figure 4.2 · Both halves of the input appear across the load with the same polarity.",
             f"{Vdc} = 2{Vm}/π = 0.636 {Vm}; output ripple frequency = 2 × 50 = 100 Hz."))
H.append('</section>')

# ---------------- Q5
H.append('<section class="topic">')
H.append(question(5, "Full-wave bridge rectifier — circuit and working",
    "Write a circuit diagram of FWR-Bridge and it’s working in the table format."))
H.append(fig(bridge_circuit(), "Figure 5.1 · Bridge rectifier: four diodes D1–D4 in a bridge; AC applied across P–Q, load across the other two corners.",
             "The cathodes of D2 and D4 meet at the + output; the anodes of D1 and D3 meet at the − output."))
H.append(work_table([
    ("<b>Positive half</b><br>0 → <i>T</i>/2<br><span class='small'>P +, Q −</span>", f"D2, D3 {ON}<br>D1, D4 {OFF}",
     f"P → D2 → {RL} (+ to −) → D3 → Q.<br>Two diodes in series with the load.",
     mini(f_fw, only=(0, .5), c=VERM, peak=(1, "Vm")) + f"<div class='small'><i>V</i><sub>out</sub> = {Vm} sin ω<i>t</i></div>"),
    ("<b>Negative half</b><br><i>T</i>/2 → <i>T</i><br><span class='small'>Q +, P −</span>", f"D4, D1 {ON}<br>D2, D3 {OFF}",
     f"Q → D4 → {RL} (+ to −, <b>same direction</b>) → D1 → P.",
     mini(f_fw, only=(.5, 1), c=VERM, peak=(1, "Vm")) + f"<div class='small'><i>V</i><sub>out</sub> = |{Vm} sin ω<i>t</i>|; each OFF diode sees PIV = {Vm}</div>"),
]))
H.append(fig(panel([dict(fn=f_sin, lab="vs", c=BLUE, peak=(1, "+Vm")), dict(fn=f_fw, lab="vo", c=VERM, base="low", peak=(1, "Vm"))]),
             "Figure 5.2 · Output identical to the centre-tap circuit, but no centre-tapped transformer is needed.",
             f"{Vdc} = 0.636 {Vm} (ideal) or 0.636({Vm} − 1.4 V) for silicon, because two diodes conduct at a time."))
H.append('</section>')

# ---------------- Q6
H.append('<section class="topic">')
H.append(question(6, "Formula comparison table",
    "Write formula comparison table for HWR and FWR(CT and Bridge) for both ideal and non-ideal case. (Parameters: Vdc, Idc, Vrms, Irms, PIV)"))
def tbl(title, head, rows):
    h = "".join(f"<th>{c}</th>" for c in head)
    b = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<h3><span>{title}</span></h3><table class="t keep fx-t"><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'
head = ["Parameter", "HWR", "FWR – centre tap", "FWR – bridge"]
H.append(tbl("(a) Ideal diode (V<sub>γ</sub> = 0, r<sub>f</sub> = 0)", head, [
    [f"Peak current {Im}", f"{fr(Vm, RL)}", f"{fr(Vm, RL)}", f"{fr(Vm, RL)}"],
    [Vdc, f"{fr(Vm, 'π')} = 0.318 {Vm}", f"{fr('2'+Vm, 'π')} = 0.636 {Vm}", f"{fr('2'+Vm, 'π')} = 0.636 {Vm}"],
    [Idc, f"{fr(Im, 'π')}", f"{fr('2'+Im, 'π')}", f"{fr('2'+Im, 'π')}"],
    [Vrms, f"{fr(Vm, '2')}", f"{fr(Vm, SQ2)}", f"{fr(Vm, SQ2)}"],
    [Irms, f"{fr(Im, '2')}", f"{fr(Im, SQ2)}", f"{fr(Im, SQ2)}"],
    ["PIV", f"{Vm}", f"2{Vm}", f"{Vm}"],
]))
H.append(tbl("(b) Practical / non-ideal diode (cut-in V<sub>γ</sub> = 0.7 V for Si, forward resistance r<sub>f</sub>)", head, [
    [f"Peak current {Im}", f"{fr(Vm+' − '+Vg, RL+' + '+rf)}", f"{fr(Vm+' − '+Vg, RL+' + '+rf)}", f"{fr(Vm+' − 2'+Vg, RL+' + 2'+rf)}"],
    [Vdc, f"{Idc}{RL} = {fr(Im+RL, 'π')}<br><span class='small'>(r<sub>f</sub>=0: 0.318({Vm} − {Vg}))</span>",
          f"{Idc}{RL} = {fr('2'+Im+RL, 'π')}<br><span class='small'>(r<sub>f</sub>=0: 0.636({Vm} − {Vg}))</span>",
          f"{Idc}{RL} = {fr('2'+Im+RL, 'π')}<br><span class='small'>(r<sub>f</sub>=0: 0.636({Vm} − 2{Vg}))</span>"],
    [Idc, f"{fr(Im, 'π')}", f"{fr('2'+Im, 'π')}", f"{fr('2'+Im, 'π')}"],
    [Vrms, f"{Irms}{RL} = {fr(Im+RL, '2')}", f"{Irms}{RL} = {fr(Im+RL, SQ2)}", f"{Irms}{RL} = {fr(Im+RL, SQ2)}"],
    [Irms, f"{fr(Im, '2')}", f"{fr(Im, SQ2)}", f"{fr(Im, SQ2)}"],
    ["PIV", f"{Vm}", f"2{Vm} − {Vg}", f"{Vm} − {Vg}"],
]))
H.append(tbl("(c) Extra comparison points (useful for 2-mark questions)", head, [
    ["No. of diodes", "1", "2", "4"],
    ["Diodes conducting per half", "1 (one half only)", "1", "2 in series"],
    ["Ripple factor γ", "1.21", "0.482", "0.482"],
    ["Max. efficiency η", "40.6 %", "81.2 %", "81.2 %"],
    ["Output (ripple) frequency", "<i>f</i> (50 Hz)", "2<i>f</i> (100 Hz)", "2<i>f</i> (100 Hz)"],
    ["Transformer", "ordinary", "centre-tapped", "ordinary (or none)"],
]))
H.append(remark(f"<b>Note on V<sub>m</sub>:</b> for the centre-tap circuit {Vm} is the peak of <i>one half</i> of the secondary, so the whole secondary has peak 2{Vm} — that is why its PIV is 2{Vm}. In the bridge, {Vm} is the peak of the whole secondary."))
H.append('</section>')

# ---------------- Q7
H.append('<section class="topic">')
H.append(question(7, "Bridge rectifier, 120 V rms, 1 kΩ, silicon",
    "A full-wave bridge rectifier with a 120-V rms sinusoidal input has a load resistor of 1 kΩ.<br>"
    "(a) If silicon diodes are employed, what is the dc voltage available at the load?<br>"
    "(b) Determine the required PIV rating of each diode.<br>"
    "(c) Find the maximum current through each diode during conduction.<br>"
    "(d) What is the required power rating of each diode?"))
H.append(flow(
    given("Bridge rectifier, silicon diodes", f"<i>V</i><sub>rms</sub> = 120 V · {RL} = 1 kΩ · <i>V</i><sub>T</sub> = 0.7 V per diode, two diodes conduct at a time"),
    step(1, "Peak input voltage", "", f"{Vm} = √2 × <i>V</i><sub>rms</sub> = 1.414 × 120 = <b>169.7 V</b>"),
    step(2, "(a) DC load voltage", "Two silicon diodes are in the conduction path, so the load peak is reduced by 2 × 0.7 V.",
         f"<i>V</i><sub>Lm</sub> = 169.7 − 2(0.7) = 168.3 V<br>{Vdc} = 0.636 × 168.3 = <b>107.0 V</b>"),
    step(3, "(b) PIV of each diode", "The OFF diode is across the secondary less the drop of the one ON diode beside it; rate it at least V<sub>m</sub>.",
         f"PIV = {Vm} − 0.7 = 169.0 V   ⇒   choose PIV rating ≥ <b>169.7 V</b> (≈ 170 V)"),
    step(4, "(c) Maximum diode current", "Each conducting diode carries the full load current; its peak is",
         f"<i>I</i><sub>D(max)</sub> = {fr('168.3 V', '1 kΩ')} = <b>168.3 mA</b>"),
    step(5, "(d) Power rating of each diode", "Diode drop × maximum diode current:",
         f"<i>P</i><sub>max</sub> = <i>V</i><sub>T</sub> · <i>I</i><sub>D(max)</sub> = 0.7 × 168.3 mA = <b>117.8 mW</b>"),
    result("Results", "(a) V<sub>dc</sub> ≈ 107 V  ·  (b) PIV ≥ 169.7 V  ·  (c) I<sub>D(max)</sub> = 168.3 mA  ·  (d) P ≈ 117.8 mW"),
))
H.append(remark("<b>Average power check (d):</b> each diode conducts only every other half-cycle, so its average current is I<sub>dc</sub>/2 = 107.0 mA/2 = 53.5 mA and its average power ≈ 0.7 × 53.5 mA = 37.5 mW. The 117.8 mW figure is the safe (peak) rating normally asked for."))
H.append('</section>')

# ---------------- Q8
H.append('<section class="topic">')
H.append(question(8, "Two-diode FWR, 100 V per half, 975 Ω",
    "In a two diode FWR using Si diodes, the RMS voltage across each half of the transformer secondary is 100V. The load resistance is 975 Ω Find<br>"
    "(i) Average current<br>(ii) Average output voltage<br>(iii) PIV of diode."))
H.append(flow(
    given("Centre-tapped FWR, silicon diodes", f"<i>V</i><sub>rms</sub> (each half) = 100 V · {RL} = 975 Ω · {Vg} = 0.7 V (one diode conducts at a time)"),
    step(1, "Peak voltage of each half", "", f"{Vm} = √2 × 100 = <b>141.42 V</b>"),
    step(2, "Peak load current", "One silicon diode is in the path:",
         f"{Im} = {fr(Vm + ' − ' + Vg, RL)} = {fr('141.42 − 0.7', '975')} = {fr('140.72', '975')} = <b>144.33 mA</b>"),
    step(3, "(i) Average (dc) current", "",
         f"{Idc} = {fr('2' + Im, 'π')} = {fr('2 × 144.33 mA', 'π')} = <b>91.88 mA</b>"),
    step(4, "(ii) Average output voltage", "",
         f"{Vdc} = {Idc} · {RL} = 91.88 mA × 975 Ω = <b>89.58 V</b>  <span class='small'>(= 0.636 × 140.72)</span>"),
    step(5, "(iii) PIV of each diode", "The OFF diode sees the full secondary (2V<sub>m</sub>) minus the drop of the ON diode:",
         f"PIV = 2{Vm} − {Vg} = 2(141.42) − 0.7 = <b>282.1 V</b>  <span class='small'>(ideal: 2V<sub>m</sub> = 282.8 V)</span>"),
    result("Results", "(i) I<sub>dc</sub> ≈ 91.9 mA  ·  (ii) V<sub>dc</sub> ≈ 89.6 V  ·  (iii) PIV ≈ 282 V"),
))
H.append(remark("If your class version also gives a diode forward resistance r<sub>f</sub> = 25 Ω, use I<sub>m</sub> = 140.72/(975 + 25) = 140.72 mA → I<sub>dc</sub> = 89.6 mA, V<sub>dc</sub> = 87.3 V. The method is identical."))
H.append('</section>')

# ---------------- Q9
H.append('<section class="topic">')
H.append(question(9, "Bridge rectifier, 220 V, 4 : 1, 200 Ω",
    "A Bridge rectifier with ideal diodes has an ac source of RMS value 220 V, 50Hz connected to the primary of transformer. "
    "If the load resistance is 200Ω and turns ratio of transformer is 4:1, find the dc output voltage, dc output current."))
H.append(flow(
    given("Bridge rectifier, ideal diodes", f"Primary 220 V rms, 50 Hz · turns ratio <i>N</i><sub>1</sub> : <i>N</i><sub>2</sub> = 4 : 1 · {RL} = 200 Ω"),
    step(1, "Secondary rms voltage", "Step-down by the turns ratio:",
         f"<i>V</i><sub>s(rms)</sub> = {fr('220', '4')} = <b>55 V</b>"),
    step(2, "Secondary peak voltage", "", f"{Vm} = √2 × 55 = <b>77.78 V</b>"),
    step(3, "DC output voltage", "Ideal bridge:", f"{Vdc} = {fr('2' + Vm, 'π')} = {fr('2 × 77.78', 'π')} = <b>49.52 V</b>"),
    step(4, "DC output current", "", f"{Idc} = {fr(Vdc, RL)} = {fr('49.52', '200')} = <b>247.6 mA</b>"),
    result("Results", "V<sub>dc</sub> ≈ 49.5 V  ·  I<sub>dc</sub> ≈ 0.248 A"),
))
H.append('</section>')

# ---------------- Q10
H.append('<section class="topic">')
H.append(question(10, "Bridge rectifier, 230 sin 314t, 10 : 1, 500 Ω",
    "The input to a bridge rectifier is given through a 10 : 1 transformer from a supply of 230 Sin 314 t. If R_L = 500 Ω. Determine<br>"
    "DC load voltage<br>RMS load voltage<br>PIV across diodes<br>DC power delivered to the load"))
H.append(flow(
    given("Bridge rectifier (diodes taken as ideal)", f"Primary <i>v</i> = 230 sin 314<i>t</i> ⇒ peak 230 V, ω = 314 rad/s (<i>f</i> = 314/2π = 50 Hz) · 10 : 1 · {RL} = 500 Ω"),
    step(1, "Secondary peak voltage", "The given 230 V is already the <b>peak</b> (coefficient of sin), so just divide by the turns ratio:",
         f"{Vm} = {fr('230', '10')} = <b>23 V</b>"),
    step(2, "DC load voltage", "", f"{Vdc} = {fr('2' + Vm, 'π')} = {fr('2 × 23', 'π')} = <b>14.64 V</b>"),
    step(3, "RMS load voltage", "", f"{Vrms} = {fr(Vm, SQ2)} = {fr('23', '1.414')} = <b>16.26 V</b>"),
    step(4, "PIV across each diode", "Bridge: PIV = V<sub>m</sub>", "PIV = <b>23 V</b>"),
    step(5, "DC power delivered to load", "",
         f"<i>P</i><sub>dc</sub> = {fr(Vdc + '<sup>2</sup>', RL)} = {fr('(14.64)<sup>2</sup>', '500')} = <b>0.429 W</b>  <span class='small'>(I<sub>dc</sub> = 29.28 mA)</span>"),
    result("Results", "V<sub>dc</sub> = 14.64 V  ·  V<sub>rms</sub> = 16.26 V  ·  PIV = 23 V  ·  P<sub>dc</sub> ≈ 429 mW"),
))
H.append(remark("<b>If silicon diodes are assumed:</b> V<sub>Lm</sub> = 23 − 1.4 = 21.6 V → V<sub>dc</sub> = 13.75 V, V<sub>rms</sub> = 15.27 V, PIV = 23 − 0.7 = 22.3 V, P<sub>dc</sub> = 0.378 W."))
H.append('</section></main></body></html>')

open(OUT, "w").write("\n".join(H))
print("written", OUT)
