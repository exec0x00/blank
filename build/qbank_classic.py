"""Question bank in a classic LaTeX-assignment layout (Computer Modern, boxed headings, numbered questions).
Run: python3 build/qbank_classic.py   -> output/06_question_bank.html"""
import datetime, html, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import qbank as Q
import qbank_new  # noqa: F401  (adds the new-type, quick-fire and mock content to Q.CH)
from qbank import T, M, render, fig_svg, INVENTORY

OUT = Q.OUT
e = html.escape
TITLES = {"Q1": "Rotational (Microwave) Spectroscopy", "Q2": "Vibrational (IR) Spectroscopy — Harmonic Oscillator",
          "Q3": "Anharmonic Oscillator and Overtones", "Q4": "Electronic Spectroscopy, Franck–Condon and Raman",
          "Q5": "Phase Rule, Water and Pb–Ag Systems", "Q6": "Computational Chemistry", "Q7": "Mock Question 1 Papers"}

def boxed(text): return f'<h3 class="boxed"><span>{e(text)}</span></h3>'

def answer_block(steps, ans, label="Solution."):
    out = ""
    if len(steps) == 1:
        out += f'<p class="working"><span class="runin">{label}</span>{T(steps[0])}</p>'
    elif steps:
        li = "".join(f"<li>{T(s)}</li>" for s in steps)
        out += f'<div class="working"><span class="runin">{label}</span><ol class="roman">{li}</ol></div>'
    out += f'<p class="ans"><b>Answer:</b> {T(ans)}</p>'
    return out

def chapter(c, ci):
    n = 0; fig_no = 0
    html_ = [f'<section class="chapter" id="{c["id"]}"><h2 class="chap">Chapter {ci}: {e(TITLES.get(c["id"], c["title"]))}</h2>',
             f'<p class="chapsub">Topics {e(c["topics"])}</p><p class="intro">{e(c["intro"])}</p>']
    # formulas
    html_.append(boxed("Formulas to remember"))
    html_.append('<div class="formulas">' + "".join(f'<div class="dm">{M(t, True)}</div>' for t in c["recap"]) + "</div>")
    if c.get("method"):
        html_.append('<div class="method"><span class="runin">Method.</span><ol class="arabic">' + "".join(f"<li>{T(s)}</li>" for s in c["method"]) + "</ol></div>")
    if c["figs"]:
        figs = ""
        for f in c["figs"]:
            fig_no += 1
            cap = next((x[1] for t in __import__("content").FIG.values() for x in t if x[0] == f), "")
            figs += f'<figure>{fig_svg(f).replace("font-family:Inter, sans-serif", "font-family:CMU Serif, serif")}<figcaption><b>Figure {ci}.{fig_no}</b> ({f}): {e(cap)}</figcaption></figure>'
        html_.append(f'<div class="figrow n{len(c["figs"])}">{figs}</div>')
    if c.get("derivation"):
        t, steps = c["derivation"]
        html_.append(boxed("Derivation"))
        html_.append(f'<p class="dtitle"><b>{e(t.split("·",1)[-1].strip())}</b></p><ol class="arabic deriv">' + "".join(f"<li>{T(s)}</li>" for s in steps) + "</ol>")
    # past questions
    if c["past"]:
        html_.append(boxed("Past ESA questions with solutions"))
        items = []
        for p in c["past"]:
            n += 1
            flag = ' <span class="flagtxt">[Not on current slides]</span>' if p["flag"] else ""
            items.append(f'<li><span class="num">{n}.</span><div class="qbody"><p class="qtext">{T(p["q"])}{flag}</p>'
                         f'<p class="src"><i>{e(p["tag"])}</i><span class="marks">({p["marks"]} marks)</span></p>'
                         f'{answer_block(p["steps"], p["ans"])}</div></li>')
        html_.append('<ol class="qs">' + "".join(items) + "</ol>")
    if c.get("theory"):
        html_.append(boxed("Theory questions with model answers"))
        items = []
        for q, a in c["theory"]:
            n += 1
            items.append(f'<li><span class="num">{n}.</span><div class="qbody"><p class="qtext"><b>{T(q)}</b></p><p class="ans"><b>Answer:</b> {T(a)}</p></div></li>')
        html_.append('<ol class="qs">' + "".join(items) + "</ol>")
    # practice groups
    keys = []
    groups = [(c.get("gtitle_B", "Practice: exam-style variants"), c["sets"]), ("New question types (not yet asked)", c["new"]), ("Quick-fire checks and spot the error", c["quick"])]
    for gtitle, gsets in groups:
        if not gsets: continue
        html_.append(boxed(gtitle.replace(" · ", ": ")))
        for s in gsets:
            title = re.sub(r"^[A-Z]\d+\s*·\s*", "", s["title"]).replace(" · ", ": ")
            mock = c["id"] == "Q7"
            if mock: n = 0
            html_.append(f'<h4 class="settitle">{e(title)}</h4>' + (f'<p class="setnote">{T(s["note"])}</p>' if s["note"] else ""))
            items = []; kitems = []
            for it in s["items"]:
                n += 1
                q = re.sub(r"^(True or False|Spot the error): ", "", it["q"])
                mk = re.match(r"^\(([a-e])\) \[(\d+) marks\] ", q)
                tail = ""; it_marks = ""
                if mk:
                    q = q[mk.end():]; tail = ""; it_marks = f'<span class="mk">({mk.group(2)} marks)</span>'
                items.append(f'<li><span class="num">{n}.</span><div class="qbody"><p class="qtext">{T(q)}{it_marks}</p>{tail}</div></li>')
                kitems.append((n, it))
            html_.append('<ol class="qs">' + "".join(items) + "</ol>")
            keys.append((title, kitems))
    if keys:
        html_.append(f'<div class="keystart">{boxed("Answers")}</div>')
        for title, kitems in keys:
            html_.append(f'<h4 class="settitle">{e(title)}</h4><ol class="qs key">' + "".join(
                f'<li><span class="num">{k}.</span><div class="qbody">{answer_block(it["steps"], it["ans"], "Working.")}</div></li>' for k, it in kitems) + "</ol>")
    html_.append("</section>")
    count = len(c["past"]) + len(c.get("theory", [])) + sum(len(x["items"]) for g in ("sets", "new", "quick") for x in c[g])
    return "".join(html_), count

def build():
    chapters = []; total = 0; counts = []
    for i, c in enumerate(Q.CH, 1):
        h_, n = chapter(c, i); chapters.append(h_); total += n; counts.append(n)
    toc = "".join(f'<li><a href="#{c["id"]}"><span>Chapter {i}: {e(TITLES.get(c["id"], c["title"]))}</span><span class="dots"></span><span class="cnt">{counts[i-1]} questions</span></a></li>' for i, c in enumerate(Q.CH, 1))
    inv = "".join(f"<tr><td>{e(a)}</td><td class='c'>{b.replace('Q','')}</td><td class='c'>{n}</td><td class='c'>{p}</td></tr>" for a, b, n, p in INVENTORY)
    front = f'''<header class="titleblock">
<div class="uni">PES University, Bengaluru</div>
<div class="est">(Established Under Karnataka Act 16 of 2013)</div>
<div class="dept">Department of Science and Humanities</div>
<div class="course">Engineering Chemistry</div>
<div class="code">(UE26CY151A)</div>
<div class="kind"><span>Question Bank</span></div>
<div class="selfstudy">Self-study compilation from past ESA papers and class material — not an official university document</div>
<div class="unit">Unit - 1: Molecular Spectroscopy, Phase Equilibria and Computational Chemistry</div>
</header>
<p class="howto"><b>How to use this bank.</b> Each chapter opens with the formulas and method you need, then the past ESA questions worked out in full. After that come exam-style practice questions, new question types that have not been asked yet, and quick-fire checks. Attempt them before looking: every answer is in the <i>Answers</i> section at the end of the chapter, numbered the same way. Numerical answers are computed from each question's own constants, so small differences from a printed key come from rounding. Chapter 7 has three timed mock papers.</p>
<h3 class="boxed"><span>Contents</span></h3>
<ol class="toc">{toc}</ol>
<p class="total">{total} numbered questions in all, {sum(len(c["past"]) for c in Q.CH)} of them from past ESA papers.</p>
<h3 class="boxed"><span>What the examiners ask</span></h3>
<table class="booktabs"><thead><tr><th>Question type</th><th class="c">Chapter</th><th class="c">Times asked</th><th class="c">Practice here</th></tr></thead><tbody>{inv}</tbody></table>
<p class="note"><i>Left out:</i> conductometric titration, colorimetry and α-Al₂O₃ synthesis appear in older Question 1s but belong to other units. Fe–C, the CO₂ diagram and the Beer–Lambert law are marked <span class="flagtxt">[Not on current slides]</span>; items marked <i>(Extension)</i> go beyond the slides.</p>'''
    css = '<link rel="stylesheet" href="assets/katex/katex.min.css"><link rel="stylesheet" href="assets/classic.css">'
    doc = (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Question Bank · Engineering Chemistry Unit 1</title>{css}</head>'
           f'<body>{front}{"".join(chapters)}</body></html>')
    doc = render(doc)
    doc = unicode_to_markup(doc)
    open(OUT + "06_question_bank.html", "w").write(doc)
    print(f"classic question bank: {total} questions")

SUP = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺", "0123456789−+")
SUB = str.maketrans("₀₁₂₃₄₅₆₇₈₉ₑ", "0123456789e")
def unicode_to_markup(doc):
    """Outside SVG and KaTeX, render unicode super/subscripts as <sup>/<sub> (CMU Serif has no such glyphs)."""
    parts = re.split(r"(<svg.*?</svg>|<span class=\"katex\">.*?</span></span></span>|<title>.*?</title>)", doc, flags=re.S)
    for i in range(0, len(parts), 2):
        p = parts[i]
        p = re.sub(r"[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+", lambda m: "<sup>" + m.group(0).translate(SUP) + "</sup>", p)
        p = re.sub(r"[₀₁₂₃₄₅₆₇₈₉ₑ]+", lambda m: "<sub>" + m.group(0).translate(SUB) + "</sub>", p)
        parts[i] = p.replace("″", "′′").replace("✔", "✓")
    return "".join(parts)

if __name__ == "__main__":
    build()
