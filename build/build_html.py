"""Builds the six Unit 1 HTML documents. Run: python3 build/build_html.py"""
import datetime, html, json, os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from content import MODS, TN, FL, SYM, PTS, FIG, FLOWS, TABLES, PYQ, SHORT, KEYS, W

OUT = "/home/user/blank/output/"
BUILD = os.path.dirname(os.path.abspath(__file__))
KATEX = os.environ.get("KATEX_PATH", "/tmp/claude-0/npm/node_modules/katex")

# ---------- LaTeX for every formula card ----------
TEX = {
    "F1": r"E = h\nu",
    "F2": r"\nu = \frac{c}{\lambda}",
    "F3": r"\bar{\nu} = \frac{1}{\lambda} \qquad E = hc\,\bar{\nu}",
    "F4": r"\Delta E = E_2 - E_1 = h\nu",
    "F5": r"E = E_{trans} + E_{rot} + E_{vib} + E_{elec} \;\approx\; E_{rot} + E_{vib} + E_{elec}",
    "F6": r"E_{rot} \ll E_{vib} \ll E_{elec}",
    "F7": r"\Delta E_{total} = \Delta E_{elec} + \Delta E_{vib} + \Delta E_{rot}",
    "F8": r"A = \log\frac{I_0}{I} = \varepsilon c l",
    "F9": r"m_1 r_1 = m_2 r_2 \qquad r_0 = r_1 + r_2",
    "F10": r"r_1 = \frac{m_2\, r_0}{m_1 + m_2} \qquad r_2 = \frac{m_1\, r_0}{m_1 + m_2}",
    "F11": r"I = m_1 r_1^2 + m_2 r_2^2 = \mu r_0^2, \qquad \mu = \frac{m_1 m_2}{m_1 + m_2}",
    "F12": r"E_r = \tfrac{1}{2} I \omega^2 = \frac{L^2}{2I}",
    "F13": r"E_J = \frac{h^2}{8\pi^2 I}\, J(J+1)\ \text{J}",
    "F14": r"\varepsilon_J = \frac{h}{8\pi^2 I c}\, J(J+1) = BJ(J+1)\ \text{cm}^{-1}, \qquad B = \frac{h}{8\pi^2 I c}",
    "F15": r"\Delta J = \pm 1",
    "F16": r"\Delta\varepsilon_{J \to J+1} = 2B(J+1)\ \text{cm}^{-1}; \quad \text{levels } 0, 2B, 6B, 12B, 20B, 30B, 42B",
    "F17": r"F = -kx \qquad PE = \tfrac{1}{2} k (r - r_{eq})^2",
    "F18": r"\nu_{osc} = \frac{1}{2\pi}\sqrt{\frac{k}{\mu}}\ \text{Hz}",
    "F19": r"\bar{\nu}_{osc} = \frac{1}{2\pi c}\sqrt{\frac{k}{\mu}}\ \text{cm}^{-1}",
    "F20": r"E_v = \left(v + \tfrac{1}{2}\right) h\nu_{osc}\ \text{J} \qquad \varepsilon_v = \left(v + \tfrac{1}{2}\right)\bar{\nu}_{osc}\ \text{cm}^{-1}",
    "F21": r"\varepsilon_0 = \tfrac{1}{2}\,\bar{\nu}_{osc}",
    "F22": r"\Delta v = \pm 1; \quad \varepsilon_{v+1} - \varepsilon_v = \bar{\nu}_{osc} \;\Rightarrow\; \text{one line at } \bar{\nu}_{osc}",
    "F23": r"k = 4\pi^2 c^2 \bar{\nu}^2 \mu",
    "F24": r"PE = D_{eq}\left[1 - \exp\{a(r_{eq} - r)\}\right]^2",
    "F25": r"\varepsilon_v = \left(v + \tfrac{1}{2}\right)\bar{\omega}_e - \left(v + \tfrac{1}{2}\right)^2 \bar{\omega}_e x_e\ \text{cm}^{-1}",
    "F26": r"\begin{aligned} 0\to1 &: \ \bar{\omega}_e(1 - 2x_e) && \text{fundamental} \\ 0\to2 &: \ 2\bar{\omega}_e(1 - 3x_e) && \text{1st overtone} \\ 0\to3 &: \ 3\bar{\omega}_e(1 - 4x_e) && \text{2nd overtone} \end{aligned}",
    "F27": r"1\to2:\ \bar{\omega}_e(1 - 4x_e) \qquad \varepsilon_0 = \tfrac{1}{2}\bar{\omega}_e\left(1 - \tfrac{1}{2}x_e\right)",
    "F28": r"\varepsilon = \varepsilon_{elec} + \varepsilon_{vib}; \quad \text{lines labelled } (v', v'')",
    "F29": r"F = C - P + 2",
    "F30": r"F = \underbrace{P(C-1) + 2}_{\text{variables}} - \underbrace{C(P-1)}_{\text{constraints}} = C - P + 2",
    "F31": r"\mu_i^{\alpha} = \mu_i^{\beta} = \mu_i^{\gamma} = \cdots",
    "F32": r"\mu_i = \left(\frac{\partial G}{\partial n_i}\right)_{T,\,P,\,n_j}",
    "F33": r"F = 3 - P",
    "F34": r"\frac{dP}{dT} = \frac{\Delta H}{T\,\Delta V}",
    "F35": r"F = C - P + 1",
}
WIDE = {"F5", "F11", "F14", "F16", "F20", "F22", "F26", "F30"}

DERIV = {
    "T4": ("Moment of inertia of a diatomic rigid rotor  ·  I = μr₀²", [
        (r"m_1 r_1 = m_2 r_2 = m_2(r_0 - r_1)", "Balance about the centre of mass C; r₀ = r₁ + r₂"),
        (r"r_1 = \frac{m_2 r_0}{m_1 + m_2}, \qquad r_2 = \frac{m_1 r_0}{m_1 + m_2}", "Solve for each distance"),
        (r"I = m_1 r_1^2 + m_2 r_2^2 = \frac{m_1 m_2^2 r_0^2 + m_2 m_1^2 r_0^2}{(m_1+m_2)^2}", "Substitute into the definition of I"),
        (r"I = \frac{m_1 m_2}{m_1 + m_2}\, r_0^2 = \mu r_0^2", "Factor m₁m₂(m₁+m₂)"),
    ]),
    "T9": ("Gibbs phase rule for C components and P phases", [
        (r"\text{composition variables} = P(C-1)", "Each phase needs C − 1 mole fractions (they sum to 1)"),
        (r"\text{total variables} = P(C-1) + 2", "Add temperature and pressure (same in every phase)"),
        (r"\mu_i^{\alpha} = \mu_i^{\beta} = \cdots \;\Rightarrow\; (P-1) \text{ equations per component}", "Equilibrium: equal chemical potential in all phases"),
        (r"\text{total constraints} = C(P-1)", "Over all C components"),
        (r"F = P(C-1) + 2 - C(P-1) = C - P + 2", "Degrees of freedom = variables − constraints"),
    ]),
}

DOCS = {
    "00": ("Unit 1 — Complete Study Pack", "Master edition", "Everything in one place: notes, formulas, figures, flowcharts, worked examples and past-paper questions, organised topic by topic."),
    "01": ("Formulas & Symbols", "Formula sheet", "Every formula in Unit 1 as a card with conditions and units, followed by a full glossary of the symbols they use."),
    "02": ("Important Points", "Key points", "Definitions, statements of laws, selection rules, “why” reasoning and exam traps, with past-paper questions per topic."),
    "03": ("Graphs & Diagrams", "Figures", "Redrawn energy-level diagrams, spectra, potential curves and phase diagrams, each with what to label in an exam."),
    "04": ("Flowcharts & Visuals", "Process maps", "Step-by-step problem-solving flows, decision paths and comparison tables."),
    "05": ("Short Notes & Keywords", "Quick revision", "Exam-ready short notes, a keyword index and a last-ten-minutes checklist."),
}

# ---------- KaTeX: collect, render once in Node, substitute ----------
_math = []
def m(tex, display=False):
    _math.append((tex, display))
    return f"\x00M{len(_math)-1}\x00"

def render_math(doc):
    if not _math:
        return doc
    with tempfile.TemporaryDirectory() as d:
        inp, out = os.path.join(d, "in.json"), os.path.join(d, "out.json")
        json.dump(_math, open(inp, "w"))
        subprocess.run(["node", os.path.join(BUILD, "katex_render.js"), inp, out],
                       check=True, env={**os.environ, "KATEX_PATH": KATEX})
        rendered = json.load(open(out))
    for i, h_ in enumerate(rendered):
        doc = doc.replace(f"\x00M{i}\x00", h_)
    return doc

# ---------- small helpers ----------
import re
_SUB = re.compile(r"(?<=[A-Za-zΑ-ωε̄])_(\{[^}]+\}|[A-Za-z0-9]+)")
def e(x):
    """Escape text and turn ASCII subscripts (ν̄_osc, E_rot) into <sub>."""
    return _SUB.sub(lambda g: "<sub>" + g.group(1).strip("{}") + "</sub>", html.escape(x))
MOD_OF = {t: mod for mod in MODS for t in mod[3]}
def mcls(t): return MOD_OF[t][2]
def stars(n):
    n = int(n)
    return f'<span class="stars" title="exam weight {n}/3">{"★"*n}<i>{"★"*(3-n)}</i></span>'
def src(s): return f'<span class="src">{e(s)}</span>' if s and s != "—" else ""
def flags(f): return "".join(f'<span class="flag">{e(x.strip())}</span>' for x in f.split("·") if x.strip()) if f else ""
def topic_weight(t):
    ws = [int(f[7]) for f in FL if f[1] == t] + [p[2] for p in PTS.get(t, [])]
    return max(ws) if ws else 1

# ---------- components ----------
def formula_card(f):
    i, t, name, _, gives, applies, units, w, s, fl = f
    wide = " wide" if i in WIDE else ""
    rows = "".join(f"<dt>{k}</dt><dd>{e(v)}</dd>" for k, v in [("Gives", gives), ("Applies", applies), ("Units", units)] if v)
    return (f'<article class="fcard{wide}" id="{i}"><header><span class="fid">{i}</span>'
            f'<span class="fname">{e(name)}</span>{stars(w)}</header>'
            f'<div class="eq">{m(TEX[i], True)}</div>{flags(fl)}<dl>{rows}</dl>'
            f'<footer>{src(s)}</footer></article>')

def formula_grid(t):
    fs = [f for f in FL if f[1] == t]
    # a half-width card with no partner (next is wide, or it is last) spans the full row
    col = 0
    for k, f in enumerate(fs):
        if f[0] in WIDE:
            col = 0; continue
        nxt_wide = k + 1 == len(fs) or fs[k + 1][0] in WIDE
        if col == 0 and nxt_wide:
            WIDE.add(f[0]); continue
        col = 1 - col
    cards = [formula_card(f) for f in fs]
    return f'<div class="fgrid">{"".join(cards)}</div>' if cards else ""

TAGS = {"def": ("Definition", "tag-def"), "stmt": ("Law", "tag-law"), "why": ("Why", "tag-why"),
        "trap": ("Exam trap", "tag-trap"), "pt": ("Key point", "tag-pt")}
def point(p):
    k, text, w, s, fl = p
    lab, cls = TAGS[k]
    body = f"<blockquote>{e(text)}</blockquote>" if k == "stmt" else f"<p>{e(text)}</p>"
    return (f'<div class="point {cls}"><div class="ptag">{lab}</div>'
            f'<div class="pbody">{body}<div class="pmeta">{stars(w)}{src(s)}{flags(fl)}</div></div></div>')

def points(t): return "".join(point(p) for p in PTS.get(t, []))

def figure(fid, cap, how):
    svg = open(OUT + f"assets/figures/{fid}.svg").read()
    svg = svg[svg.find("<svg"):]
    return (f'<figure id="{fid}"><div class="fig-inner">{svg}</div>'
            f'<figcaption><span class="fignum">Fig. {fid}</span>{e(cap)}</figcaption>'
            f'<p class="howto"><b>In the exam</b> {e(how)}</p></figure>')

def figures(t): return "".join(figure(*f) for f in FIG.get(t, []))

def flowchart(fl):
    i, name, steps = fl
    li = "".join(f'<li><span class="n">{k}</span><span>{e(s)}</span></li>' for k, s in enumerate(steps, 1))
    return f'<div class="flow" id="{i}"><h4><span class="fid">{i}</span>{e(name)}</h4><ol>{li}</ol></div>'

def table(tb):
    name, head, rows = tb
    th = "".join(f"<th>{e(x)}</th>" for x in head)
    tr = "".join("<tr>" + "".join(f"<td>{e(x)}</td>" for x in r) + "</tr>" for r in rows)
    return f'<div class="tbl"><div class="tcap">{e(name)}</div><table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div>'

FLOW_TOPIC = {"F3": "T4", "F4": "T4", "F5": "T5", "F6": "T6", "F7": "T7", "F8": "T9", "F9": "T8",
              "F10": "T11", "F11": "T12", "F12": "T13", "F13": "T13", "F14": "T13"}
TABLE_TOPIC = {0: "T1", 1: "T2", 2: "T6", 3: "T2", 4: "T13"}
def visuals(t):
    fl = [flowchart(f) for f in FLOWS if FLOW_TOPIC[f[0]] == t]
    tb = [table(TABLES[i]) for i, tt in TABLE_TOPIC.items() if tt == t]
    return (f'<div class="flows">{"".join(fl)}</div>' if fl else "") + "".join(tb)

def worked(t):
    out = []
    for k, (tt, q, sol, ans, _) in enumerate([w for w in W if w[0] == t], 1):
        out.append(f'<div class="worked"><div class="wh">Worked example {t}.{k}<span class="chip">ESA</span></div>'
                   f'<div class="wrow"><span>Given</span><p>{e(q)}</p></div>'
                   f'<div class="wrow"><span>Method</span><p>{e(sol)}</p></div>'
                   f'<div class="wrow ans"><span>Answer</span><p>{e(ans)}</p></div></div>')
    return "".join(out)

def derivation(t):
    if t not in DERIV:
        return ""
    title, steps = DERIV[t]
    li = "".join(f'<li><div class="dstep">{m(tex, True)}</div><div class="dnote">{e(n)}</div></li>' for tex, n in steps)
    return f'<div class="deriv"><div class="dh">Derivation · {e(title)}</div><ol>{li}</ol></div>'

def pyqs(t):
    q = [(x, y) for tt, x, y in PYQ if tt == t]
    if not q:
        return ""
    li = "".join(f'<li><span class="chip">{e(y)}</span>{e(x)}</li>' for x, y in q)
    return f'<div class="pyq"><div class="ph">Asked in past ESA papers</div><ul>{li}</ul></div>'

def shortnote(t): return f'<div class="snote"><div class="sh">Short note</div><p>{e(SHORT[t])}</p></div>'

def glossary():
    rows = "".join(f'<tr><td class="sym">{e(a)}</td><td>{e(b)}</td><td>{e(c)}</td><td>{e(d)}</td></tr>' for a, b, c, d in SYM)
    return ('<div class="callout warn"><b>Same letter, different meaning.</b> μ is reduced mass (spectroscopy) and chemical potential (phase rule). '
            'P is number of phases and pressure. ε is energy in cm⁻¹ and molar absorptivity (Beer–Lambert).</div>'
            f'<div class="tbl"><table class="gloss"><thead><tr><th>Symbol</th><th>Meaning in this unit</th><th>Unit</th><th>Value / note</th></tr></thead><tbody>{rows}</tbody></table></div>')

CONSTS = [("h", "Planck constant", "6.626 × 10⁻³⁴ J s", "slides also use 6.625"),
          ("c", "speed of light", "3 × 10⁸ m s⁻¹ = 3 × 10¹⁰ cm s⁻¹", "use cm s⁻¹ with cm⁻¹"),
          ("N_A", "Avogadro constant", "6.022 × 10²³ mol⁻¹", ""),
          ("amu", "atomic mass unit", "1.66 × 10⁻²⁷ kg", "μ must be in kg"),
          ("π", "pi", "3.14", "as used in papers")]
CONV = [("J → cm⁻¹", "divide by hc"), ("cm⁻¹ → Hz", "multiply by c"), ("1 eV", "1.602 × 10⁻¹⁹ J = 8065.5 cm⁻¹"),
        ("1 kJ mol⁻¹", "83.59 cm⁻¹"), ("1 Å", "10⁻¹⁰ m")]
def constants():
    a = "".join(f'<div class="const"><div class="cs">{e(s)}</div><div><b>{e(v)}</b><small>{e(n)}{" · " + e(x) if x else ""}</small></div></div>' for s, n, v, x in CONSTS)
    b = "".join(f'<div class="conv"><span>{e(x)}</span><b>{e(y)}</b></div>' for x, y in CONV)
    return f'<div class="consts">{a}</div><div class="convs">{b}</div>'

# ---------- page frame ----------
def cover(num, title, kicker, blurb):
    mods = "".join(f'<div class="cmod {c}"><span>{mid}</span>{e(n)}<small>{len(ts)} topic{"s" if len(ts)>1 else ""}</small></div>' for mid, n, c, ts in MODS)
    return f'''<section class="cover">
<div class="cbar"><i class="m1"></i><i class="m2"></i><i class="m3"></i></div>
<div class="ctop"><span class="course">UE26CY151A · Engineering Chemistry</span><span class="unit">Semester 1 · Unit 1</span></div>
<div class="cmain"><div class="cnum">{num}</div><div class="ckicker">{e(kicker)}</div><h1 class="ctitle">{e(title)}</h1><p class="cblurb">{e(blurb)}</p></div>
<div class="cmods">{mods}</div>
<div class="clegend"><div><b>Exam weight</b> {stars(3)} high · {stars(2)} medium · {stars(1)} low</div>
<div><b>Flags</b> <span class="flag">Not on current slides</span> <span class="flag">Transcript only</span> <span class="flag">Added for clarity</span></div>
<div><b>Sources</b> <span class="src">S004·8</span> slide 8 of deck 004 · <span class="src">T009</span> class transcript · <span class="src">PDF</span> Unit-1 slide PDF · <span class="src">ESA</span> past paper</div></div>
<div class="cfoot">Compiled from PESU AV-summary transcripts, class slides and past ESA papers · {datetime.date.today():%d %B %Y}</div>
</section>'''

def toc(prefix, extra):
    parts = []
    for mid, name, c, ts in MODS:
        rows = "".join(f'<a class="trow" href="#{prefix}-{t}"><span class="tid {c}">{t}</span><span class="tname">{e(TN[t])}</span>{stars(topic_weight(t))}</a>' for t in ts)
        parts.append(f'<div class="tmod"><a class="tmh {c}" href="#{prefix}-{mid}"><span>{mid}</span>{e(name)}</a>{rows}</div>')
    ex = "".join(f'<a class="trow" href="#{h}"><span class="tid">+</span><span class="tname">{e(n)}</span></a>' for h, n in extra)
    return f'<nav id="toc" class="toc"><h2>Contents</h2>{"".join(parts)}{"<div class=tmod>"+ex+"</div>" if ex else ""}</nav>'

def module_banner(prefix, mid, name, c, ts):
    chips = "".join(f'<span class="tchip">{t} · {e(TN[t])}</span>' for t in ts)
    return f'<div class="mbanner {c}" id="{prefix}-{mid}"><div class="mnum">{mid.replace("M","Module ")}</div><h1>{e(name)}</h1><div class="mchips">{chips}</div></div>'

def topic_head(t):
    return f'<header class="thead {mcls(t)}"><span class="tid">{t}</span><h2>{e(TN[t])}</h2>{stars(topic_weight(t))}</header>'

def sub(h, body): return f'<h3 class="sub">{h}</h3>{body}' if body else ""

def document(num, prefix, topic_fn, appendix="", extra_toc=()):
    title, kicker, blurb = DOCS[num]
    body = [cover(num, title, kicker, blurb), toc(prefix, extra_toc)]
    for mid, name, c, ts in MODS:
        sections = []
        for t in ts:
            inner = topic_fn(t)
            sections.append(f'<section class="topic {c}" id="{prefix}-{t}" data-topic="{t}">{topic_head(t)}{inner}</section>')
        body.append(f'<div class="module">{module_banner(prefix, mid, name, c, ts)}{"".join(sections)}</div>')
    body.append(appendix)
    css = '<link rel="stylesheet" href="assets/katex/katex.min.css"><link rel="stylesheet" href="assets/study.css">'
    doc = (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
           f'<title>{html.escape(title)} · Engg. Chemistry Unit 1</title>{css}</head><body class="doc-{num}">{"".join(body)}</body></html>')
    return render_math(doc)

def appendix_block(aid, title, body): return f'<section class="appendix" id="{aid}"><h1 class="ah">{e(title)}</h1>{body}</section>'

def empty(msg): return f'<p class="empty">{e(msg)}</p>'

FILES = {"00": "00_MASTER_unit1_complete", "01": "01_formulas_and_symbols", "02": "02_important_points",
         "03": "03_graphs_and_diagrams", "04": "04_flowcharts_and_visuals", "05": "05_short_notes_keywords"}

def write(num, html_):
    open(OUT + FILES[num] + ".html", "w").write(html_)
    _math.clear()

# ---------- Doc 01 ----------
def d1(t): return formula_grid(t) or empty("No formula in this topic — see the important points.")
write("01", document("01", "d1", d1,
      appendix_block("d1-const", "Constants & unit conversions", constants()) +
      appendix_block("d1-gloss", "Symbol glossary", glossary()),
      [("d1-const", "Constants & unit conversions"), ("d1-gloss", "Symbol glossary")]))

# ---------- Doc 02 ----------
def d2(t): return points(t) + pyqs(t)
write("02", document("02", "d2", d2))

# ---------- Doc 03 ----------
def d3(t): return figures(t) or empty("No graph for this topic.")
write("03", document("03", "d3", d3))

# ---------- Doc 04 ----------
def d4(t): return visuals(t) or empty("No flowchart for this topic.")
write("04", document("04", "d4", d4))

# ---------- Doc 05 ----------
def d5(t):
    kws = sorted((k, v[1]) for k, v in KEYS.items() if v[0] == t)
    kl = "".join(f"<li><b>{e(k)}</b> — {e(v)}</li>" for k, v in kws)
    return shortnote(t) + (f'<ul class="kwlist">{kl}</ul>' if kl else "")
kw_rows = "".join(f'<div class="kw"><b>{e(k)}</b><span class="tid {mcls(t)}">{t}</span><p>{e(mn)}</p></div>'
                  for k, (t, mn) in sorted(KEYS.items(), key=lambda x: x[0].lower()))
LAST = ["E = hν,  ν = c/λ,  ν̄ = 1/λ", "E_rot ≪ E_vib ≪ E_elec  (microwave < IR < UV-Vis)",
        "ε_J = BJ(J+1);  lines at 2B(J+1);  spacing 2B;  first line at 2B", "I = μr₀²  →  r₀ = √(I/μ), μ in kg",
        "Microwave needs a permanent dipole, ΔJ = ±1", "ν̄ = (1/2πc)√(k/μ);  ε_v = (v+½)ν̄;  ZPE = ½ν̄",
        "IR needs a changing dipole;  SHO gives one line (Δv = ±1)", "Fundamental ω̄ₑ(1−2xₑ);  1st overtone 2ω̄ₑ(1−3xₑ)",
        "Franck–Condon: vertical transitions; 3 cases; continuum = dissociation", "F = C − P + 2  from  P(C−1)+2 − C(P−1)",
        "Water: F = 3 − P;  triple point 0.0098 °C, 4.58 mmHg;  critical 374 °C, 218 atm", "OC slope negative because ice → water shrinks (ΔV < 0)",
        "Two components at fixed P:  F = C − P + 1", "Pb–Ag eutectic 303 °C, 2.6 % Ag, F = 0;  Pb 327 °C, Ag 961 °C"]
last = '<ol class="last">' + "".join(f"<li>{e(x)}</li>" for x in LAST) + "</ol>"
write("05", document("05", "d5", d5,
      appendix_block("d5-kw", "Keyword index", f'<div class="kwgrid">{kw_rows}</div>') +
      appendix_block("d5-last", "Last 10 minutes before the exam", last),
      [("d5-kw", "Keyword index"), ("d5-last", "Last 10 minutes before the exam")]))

# ---------- Master ----------
def dm(t):
    return (shortnote(t) + sub("Formulas", formula_grid(t)) + sub("Derivation", derivation(t)) +
            sub("Key points", points(t)) + sub("Graphs &amp; diagrams", figures(t)) +
            sub("Flowcharts &amp; comparisons", visuals(t)) + sub("Worked examples", worked(t)) + pyqs(t))
appx = (appendix_block("A", "Appendix A · Symbol glossary", glossary()) +
        appendix_block("B", "Appendix B · Constants & unit conversions", constants()) +
        appendix_block("C", "Appendix C · Possibly examinable, not in current material",
            '<div class="callout"><span class="flag">Not on current slides</span><p><b>Iron–carbon (Fe–C) phase diagram.</b> Named in the 2025 module list and asked in 2024 ESAs (peritectic and eutectoid points). The class 010 transcript says it comes “next class”, but there is no 2026 deck or transcript for it.</p></div>'
            '<div class="callout"><span class="flag">Not on current slides</span><p><b>CO₂ phase diagram.</b> Asked once (January 2024); not in the current material.</p></div>'
            '<div class="callout"><span class="flag">Not on current slides</span><p><b>Beer–Lambert law.</b> In the 2025 module overview and the Dec 2024 ESA; summarised under T3b.</p></div>') +
        appendix_block("D", "Appendix D · Sources & known gaps",
            '<div class="tbl"><table><thead><tr><th>Source</th><th>Used for</th></tr></thead><tbody>'
            '<tr><td>12 class slide decks (2026), rendered .pptx + .slides.md/.txt</td><td>Definitions, statements, formulas, values</td></tr>'
            '<tr><td>Unit-1 slide PDF (2025, 137 pp.)</td><td>Cross-check of derivations</td></tr>'
            '<tr><td>ESA past papers (Q1), via the brief\'s ranking</td><td>Exam weights, worked examples</td></tr>'
            '</tbody></table></div><div class="callout warn"><b>Known gaps.</b> The class 003 video failed to download (HTTP 401), so it has no transcript. Class 012 never had a video. No videos were consulted.</div>'))
write("00", document("00", "m", dm, appx,
      [("A", "Appendix A · Symbol glossary"), ("B", "Appendix B · Constants"), ("C", "Appendix C · Not in current material"), ("D", "Appendix D · Sources & gaps")]))
print("built 6 documents")
