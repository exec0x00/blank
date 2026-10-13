"""Question bank: every past Unit 1 ESA question (solved) + graded practice variants.
Run: python3 build/qbank.py   (writes output/06_question_bank.html)
All numerical answers are computed here, never typed by hand."""
import datetime, html, json, math, os, re, subprocess, sys, tempfile

OUT = "/home/user/blank/output/"
BUILD = os.path.dirname(os.path.abspath(__file__))
KATEX = os.environ.get("KATEX_PATH", "/tmp/claude-0/npm/node_modules/katex")
AMU, H0, C0, PI = 1.66e-27, 6.626e-34, 3e10, math.pi

# ------------------------------------------------------------------ paper tags
P = {"J24a": "Jun-24 · UE23 · Set 1", "J24b": "Jun-24 · UE23 · Set 2", "D24a": "Dec-24 · UE23",
     "JAN": "Jan · UE23A · Set 2", "M24": "Jan–May-24 · UE22", "D24b": "Dec-24 · UE22", "D23": "Dec-23 · UE22",
     "L23a": "Jul-23 · UE22 · A", "L23b": "Jul-23 · UE22 · B", "J25a": "Jan-25 · UE24 · Set 1", "J25b": "Jan-25 · UE24 · Set 2"}

# ------------------------------------------------------------------ number formatting
def g3(x): return f"{x:.3g}"
def sci(x, d=3):
    if x == 0: return "0"
    e = int(math.floor(math.log10(abs(x)))); mnt = x / 10 ** e
    return f"{mnt:.{d-1}f}\\times10^{{{e}}}"
def sc(x, d=3): return "$" + sci(x, d) + "$"

# ------------------------------------------------------------------ physics helpers
def mu_amu(m1, m2): return m1 * m2 / (m1 + m2)
def rot_I(B_cm, h=H0, c=C0, pi=PI): return h / (8 * pi ** 2 * c * B_cm)      # kg m^2, c in cm/s
def rot_B_from_I(I, h=H0, c=C0, pi=PI): return h / (8 * pi ** 2 * c * I)    # cm^-1
def r0_from_line(line, m1, m2, h=H0, c=C0, pi=PI, amu=AMU):
    B = line / 2; I = rot_I(B, h, c, pi); mu = mu_amu(m1, m2) * amu
    return B, I, mu, math.sqrt(I / mu)
def sho_nu(k, m1, m2, c=C0, pi=PI, amu=AMU): return math.sqrt(k / (mu_amu(m1, m2) * amu)) / (2 * pi * c)
def sho_k(nu, m1, m2, c=C0, pi=PI, amu=AMU): return 4 * pi ** 2 * c ** 2 * nu ** 2 * mu_amu(m1, m2) * amu
def anh_from(f, o): we = 3 * f - o; xe = (f - o / 2) / we; return xe, we

# ------------------------------------------------------------------ rendering
_math = []
def M(tex, disp=False):
    _math.append((tex, disp)); return f"\x00M{len(_math)-1}\x00"
def T(s):
    """Escape text; $...$ segments are KaTeX; **bold** (may span maths) and newlines supported."""
    s = re.sub(r"\*\*(.+?)\*\*", "\x01\\1\x02", s, flags=re.S)
    parts = s.split("$"); out = []
    for i, p in enumerate(parts):
        if i % 2: out.append(M(p))
        else: out.append(html.escape(p).replace("\n", "<br>"))
    return "".join(out).replace("\x01", "<b>").replace("\x02", "</b>")
def render(doc):
    with tempfile.TemporaryDirectory() as d:
        i, o = os.path.join(d, "i.json"), os.path.join(d, "o.json")
        json.dump(_math, open(i, "w"))
        subprocess.run(["node", os.path.join(BUILD, "katex_render.js"), i, o], check=True, env={**os.environ, "KATEX_PATH": KATEX})
        for k, h_ in enumerate(json.load(open(o))): doc = doc.replace(f"\x00M{k}\x00", h_)
    return doc

# ------------------------------------------------------------------ data model
CH = []     # chapters
def chapter(cid, title, cls, topics, intro, recap, figs=()):
    c = dict(id=cid, title=title, cls=cls, topics=topics, intro=intro, recap=recap, figs=list(figs), past=[], sets=[], new=[], quick=[])
    CH.append(c); return c
def past(c, tag, marks, q, steps, ans, flag=""): c["past"].append(dict(tag=P.get(tag, tag), marks=marks, q=q, steps=steps, ans=ans, flag=flag))
def pset(c, title, note, items): c["sets"].append(dict(title=title, note=note, items=items))
def item(q, steps, ans): return dict(q=q, steps=steps, ans=ans)
def fig_svg(fid):
    s = open(OUT + f"assets/figures/{fid}.svg").read(); return s[s.find("<svg"):]

def rot_steps(line, m1, m2, h, c_ms_note, pi, name="the molecule", hdisp=None, cdisp=None):
    B, I, mu, r = r0_from_line(line, m1, m2, h, C0, pi)
    st = [f"First line at $2B$, so $B=\\dfrac{{{line}}}{{2}}={B:.4g}\\ \\text{{cm}}^{{-1}}$.",
          f"$I=\\dfrac{{h}}{{8\\pi^2cB}}=\\dfrac{{{sci(h)}}}{{8({pi:.3g})^2(3\\times10^{{10}})({B:.4g})}}={sc(I)[1:-1]}\\ \\text{{kg m}}^2$"
          + (" (used $c=3\\times10^{10}$ cm s$^{-1}$ because $B$ is in cm$^{-1}$)" if c_ms_note else ""),
          f"$\\mu=\\dfrac{{m_1m_2}}{{m_1+m_2}}=\\dfrac{{{m1}\\times{m2}}}{{{m1+m2:.4g}}}={mu/AMU:.4g}\\ \\text{{amu}}={sci(mu)}\\ \\text{{kg}}$.",
          f"$r_0=\\sqrt{{I/\\mu}}=\\sqrt{{\\dfrac{{{sci(I)}}}{{{sci(mu)}}}}}={sci(r)}\\ \\text{{m}}={r*1e10:.3f}\\ \\text{{Å}}$."]
    return st, B, I, mu, r

# ================================================================== CH1 ROTATIONAL
c1 = chapter("Q1", "Rotational (microwave) spectroscopy", "m1", "T4",
    "The rigid-rotor chapter is the most heavily examined part of Unit 1: a bond-length calculation, the moment-of-inertia derivation and a level/spectrum sketch appear almost every sitting.",
    [r"\varepsilon_J = BJ(J+1)\ \text{cm}^{-1}", r"B=\dfrac{h}{8\pi^2 I c}", r"I=\mu r_0^2,\ \ \mu=\dfrac{m_1m_2}{m_1+m_2}", r"\Delta J=\pm1,\ \ \text{line}(J\to J+1)=2B(J+1)", r"\text{first line}=2B,\ \ \text{spacing}=2B"],
    ["G9", "G10"])
c1["method"] = ["Read the first line (or the spacing): $B=\\text{line}/2$.", "$I=h/(8\\pi^2cB)$ with $c$ in cm s$^{-1}$.", "$\\mu$ in **kg**: amu × $1.66\\times10^{-27}$.", "$r_0=\\sqrt{I/\\mu}$, then convert m → Å."]

# --- past: bond length from first line
st, B, I, mu, r = rot_steps(21.18, 1.008, 35.45, 6.627e-34, True, 3.14)
past(c1, "J24b", 6, "For a rigid-rotor heteronuclear diatomic molecule AX the first line in the pure rotational spectrum is at 21.18 cm$^{-1}$. Derive an expression for the moment of inertia and calculate the moment of inertia and bond length of AX. (A = 1.008 amu, X = 35.45 amu; $c=3\\times10^{10}$ cm s$^{-1}$, $\\pi=3.14$, $h=6.627\\times10^{-34}$ J s, 1 amu $=1.66\\times10^{-27}$ kg)",
     ["**Derivation:** see Q1-D above (I = μr₀²)."] + st, f"$I={sci(I)}$ kg m², $r_0={r*1e10:.2f}$ Å")
st, B, I, mu, r = rot_steps(21.18, 1.008, 35.45, 6.6e-34, True, PI)
past(c1, "D23", 4, "The first line in the pure rotational spectrum of HCl appears at 21.18 cm$^{-1}$. Calculate the bond length. (H = 1.008, Cl = 35.45 amu; 1 amu $=1.66\\times10^{-27}$ kg, $c=3\\times10^8$ m s$^{-1}$, $h=6.6\\times10^{-34}$ J s)",
     ["Because $c$ is given in m s$^{-1}$, convert $B$ to m$^{-1}$ (×100) or use $c=3\\times10^{10}$ cm s$^{-1}$ — same result."] + st, f"$r_0\\approx{r*1e10:.2f}$ Å")
st, B, I, mu, r = rot_steps(17.19, 1.0, 79.9, 6.627e-34, True, PI)
past(c1, "L23a", 4, "For HBr, the rotational spectrum shows the first line at 17.19 cm$^{-1}$. Calculate the bond length (rigid rotor). (H = 1.0, Br = 79.9 amu; $h=6.627\\times10^{-34}$ J s, $c=3\\times10^{10}$ cm s$^{-1}$)", st, f"$r_0\\approx{r*1e10:.2f}$ Å")
st, B, I, mu, r = rot_steps(13.022, 1.0, 126.9, 6.627e-34, True, 3.14)
past(c1, "J25a", 3, "The first spectral line in the rotational spectrum of HI appears at 13.022 cm$^{-1}$. Calculate the bond length. (H = 1.0, I = 126.9 amu; $c=3\\times10^8$ m s$^{-1}$, 1 amu $=1.66\\times10^{-27}$ kg, $\\pi=3.14$, $h=6.627\\times10^{-34}$ J s)", st, f"$I\\approx{sci(I)}$ kg m², $r_0\\approx{r*1e10:.2f}$ Å")

# --- past: I and spacing from B
I1 = rot_I(10.56, 6.625e-34, 3e10, 3.14)
past(c1, "J24a", 6, "For a rigid-rotor diatomic molecule: (i) draw the energy-level diagram up to $J=5$; (ii) draw the rotational spectrum; (iii) calculate the moment of inertia and the distance between two spectral lines if $B=10.56$ cm$^{-1}$. ($c=3\\times10^8$ m s$^{-1}$, $\\pi=3.14$, $h=6.625\\times10^{-34}$ J s)",
     ["(i) Levels $\\varepsilon_J=BJ(J+1)$: 0, 2B, 6B, 12B, 20B, 30B for J = 0…5 — gaps grow 2B, 4B, 6B, 8B, 10B (**Fig. G9**).",
      "(ii) Allowed lines $J\\to J+1$ at 2B, 4B, 6B, 8B, 10B… equally spaced by 2B; intensity rises then falls (**Fig. G10**).",
      f"(iii) $I=\\dfrac{{h}}{{8\\pi^2cB}}=\\dfrac{{6.625\\times10^{{-34}}}}{{8(3.14)^2(3\\times10^{{10}})(10.56)}}={sci(I1)}$ kg m².",
      f"Spacing between adjacent lines $=2B=2(10.56)=21.12$ cm$^{{-1}}$."], f"$I={sci(I1)}$ kg m², spacing $=21.12$ cm$^{{-1}}$")
past(c1, "JAN", 6, "For a rotating diatomic molecule: (i) derive an expression for the moment of inertia $I$; (ii) if $B=10$ cm$^{-1}$, give the rotational energy levels for $J=0,1,2,3$ in cm$^{-1}$ and draw the energy-level diagram up to $J=3$.",
     ["(i) See derivation Q1-D.", "(ii) $\\varepsilon_J=10\\,J(J+1)$: $J=0\\to0$; $J=1\\to20$; $J=2\\to60$; $J=3\\to120$ cm$^{-1}$. Draw four horizontal lines at these heights (gaps 20, 40, 60) with $\\Delta J=+1$ arrows."],
     "Levels: 0, 20, 60, 120 cm$^{-1}$")
past(c1, "D24b", 2, "For a rigid-rotor diatomic molecule draw the energy-level diagram up to $J=6$.",
     ["$\\varepsilon_J=BJ(J+1)$: 0, 2B, 6B, 12B, 20B, 30B, 42B — see **Fig. G9** (it is drawn to J = 6). Label J on each level and show gaps increasing 2B, 4B, … 12B."], "Levels 0, 2B, 6B, 12B, 20B, 30B, 42B")
# --- past: line position
past(c1, "L23b", 6, "(ii) If the rotational transition $J=0\\to1$ for HCl occurs at 20.68 cm$^{-1}$, find the energy required for the $J=20\\to21$ transition in cm$^{-1}$. (iii) If the moment of inertia of HBr is $3.26\\times10^{-47}$ kg m², at what wavenumber (in m$^{-1}$) does the first line appear? ($h=6.62\\times10^{-34}$ J s, $c=3\\times10^8$ m s$^{-1}$)",
     ["(ii) $J=0\\to1$ gives $2B=20.68$, so $B=10.34$ cm$^{-1}$. $\\Delta\\varepsilon(J\\to J+1)=2B(J+1)$; for $J=20$: $2B\\times21=21\\times20.68=\\mathbf{434.28}$ cm$^{-1}$.",
      f"(iii) $B=\\dfrac{{h}}{{8\\pi^2Ic}}=\\dfrac{{6.62\\times10^{{-34}}}}{{8\\pi^2(3.26\\times10^{{-47}})(3\\times10^{{8}})}}={rot_B_from_I(3.26e-47,6.62e-34,3e8,PI):.1f}\\ \\text{{m}}^{{-1}}$ (c in m s$^{{-1}}$ gives m$^{{-1}}$ directly).",
      f"First line $=2B={2*rot_B_from_I(3.26e-47,6.62e-34,3e8,PI):.0f}$ m$^{{-1}}$ $={2*rot_B_from_I(3.26e-47,6.62e-34,3e8,PI)/100:.2f}$ cm$^{{-1}}$."],
     f"(ii) 434.28 cm$^{{-1}}$ · (iii) ≈ {2*rot_B_from_I(3.26e-47,6.62e-34,3e8,PI):.0f} m$^{{-1}}$")
mu_ = mu_amu(1.008, 79.9) * AMU; Ir = mu_ * (1.404e-10) ** 2; Bm = rot_B_from_I(Ir, 6.6e-34, 3e8, PI)
past(c1, "J25b", 6, "For HBr, with bond length 1.404 Å, at what energy (in m$^{-1}$) does the first line appear in the rotational spectrum? (H = 1.008, Br = 79.9 amu; 1 amu $=1.66\\times10^{-27}$ kg, $c=3\\times10^8$ m s$^{-1}$, $h=6.6\\times10^{-34}$ J s)",
     [f"$\\mu=\\dfrac{{1.008\\times79.9}}{{80.908}}\\ \\text{{amu}}={mu_/AMU:.4f}$ amu $={sci(mu_)}$ kg.", f"$I=\\mu r_0^2={sci(mu_)}\\times(1.404\\times10^{{-10}})^2={sci(Ir)}$ kg m².",
      f"$B=\\dfrac{{h}}{{8\\pi^2Ic}}={Bm:.1f}$ m$^{{-1}}$.", f"First line $=2B={2*Bm:.0f}$ m$^{{-1}}$ (≈ {2*Bm/100:.2f} cm$^{{-1}}$)."], f"First line ≈ {2*Bm:.0f} m$^{{-1}}$")
c1["derivation"] = ("Q1-D · Derivation: I = μr₀² (asked ×4)", [
    "Let masses $m_1,m_2$ be at distances $r_1,r_2$ from the centre of mass C, with $r_0=r_1+r_2$.",
    "Balance about C: $m_1r_1=m_2r_2$. Substitute $r_2=r_0-r_1$: $m_1r_1=m_2(r_0-r_1)\\Rightarrow r_1=\\dfrac{m_2r_0}{m_1+m_2}$ and $r_2=\\dfrac{m_1r_0}{m_1+m_2}$.",
    "$I=m_1r_1^2+m_2r_2^2=\\dfrac{m_1m_2^2r_0^2+m_2m_1^2r_0^2}{(m_1+m_2)^2}=\\dfrac{m_1m_2(m_1+m_2)r_0^2}{(m_1+m_2)^2}$.",
    "$\\therefore\\ I=\\dfrac{m_1m_2}{m_1+m_2}\\,r_0^2=\\mu r_0^2$. (Also the energy: $E_r=\\tfrac12I\\omega^2=L^2/2I$, giving $E_J=\\dfrac{h^2J(J+1)}{8\\pi^2I}$.)"])

# --- practice sets
# Set 1: first line → bond length (same pattern as the exam)
mols = [("HF", 1.008, 18.998, 41.9, "H", "F"), ("CO", 12.0, 15.995, 3.86, "C", "O"), ("HBr", 1.008, 79.904, 17.19, "H", "Br"),
        ("HI", 1.008, 126.9, 13.0, "H", "I"), ("CS", 12.0, 31.97, 1.632, "C", "S"), ("HCl", 1.008, 35.45, 21.18, "H", "Cl")]
its = []
for n, a, b, ln, A, Bx in mols:
    Bq, Iq, muq, rq = r0_from_line(ln, a, b)
    its.append(item(f"The first line in the rotational spectrum of {n} is at {ln} cm$^{{-1}}$. Calculate $B$, $I$ and the bond length. ({A} = {a}, {Bx} = {b} amu; $h=6.626\\times10^{{-34}}$ J s, $c=3\\times10^{{10}}$ cm s$^{{-1}}$, 1 amu $=1.66\\times10^{{-27}}$ kg)",
        [f"$B={ln}/2={Bq:.4g}$ cm$^{{-1}}$; $I=h/8\\pi^2cB={sci(Iq)}$ kg m²; $\\mu={muq/AMU:.4g}$ amu."], f"$B={Bq:.4g}$ cm$^{{-1}}$, $I={sci(Iq)}$ kg m², $r_0={rq*1e10:.3f}$ Å"))
pset(c1, "Set 1 · Bond length from the first line", "Same pattern as the exam. Do all six — the method never changes.", its)
# Set 2: from B
its = []
for Bv in (10.56, 5.0, 1.93, 8.5, 0.39):
    Iq = rot_I(Bv)
    its.append(item(f"A rigid rotor has $B={Bv}$ cm$^{{-1}}$. Calculate its moment of inertia, the spacing between adjacent lines, and the positions of the first three lines. ($h=6.626\\times10^{{-34}}$, $c=3\\times10^{{10}}$ cm s$^{{-1}}$)",
        ["$I=h/8\\pi^2cB$; spacing $=2B$; lines at $2B,4B,6B$."], f"$I={sci(Iq)}$ kg m²; spacing ${2*Bv:g}$ cm$^{{-1}}$; lines ${2*Bv:g}$, ${4*Bv:g}$, ${6*Bv:g}$ cm$^{{-1}}$"))
pset(c1, "Set 2 · Moment of inertia and line spacing from B", "Watch the units: B in cm⁻¹ pairs with c in cm s⁻¹.", its)
# Set 3: line positions
its = []
for (J, ln0, mol) in [(20, 20.68, "HCl"), (9, 21.18, "HCl"), (14, 17.19, "HBr"), (4, 13.022, "HI"), (29, 3.86, "CO")]:
    its.append(item(f"For {mol} the $J=0\\to1$ line is at {ln0} cm$^{{-1}}$. Find the line for $J={J}\\to{J+1}$ and the wavenumber gap between it and the previous line.",
        ["$\\Delta\\varepsilon=2B(J+1)=(J+1)\\times(\\text{first line})$; adjacent-line gap $=2B$."], f"${(J+1)*ln0:.2f}$ cm$^{{-1}}$; gap $={ln0}$ cm$^{{-1}}$"))
pset(c1, "Set 3 · Position of a high-J line", "The trick: first line = 2B, so the J→J+1 line is simply (J+1) × first line.", its)
# Set 4: first line from I or r0
its = []
for (n, a, b, Iv, rv) in [("HBr", 1.008, 79.9, 3.26e-47, None), ("HCl", 1.008, 35.45, 2.64e-47, None), ("HI", 1.008, 126.9, None, 1.61e-10), ("CO", 12.0, 15.995, None, 1.128e-10), ("HF", 1.008, 18.998, None, 0.917e-10)]:
    if Iv is None: Iv = mu_amu(a, b) * AMU * rv ** 2; q = f"The bond length of {n} is {rv*1e10:g} Å. At what wavenumber (cm$^{{-1}}$) does the first rotational line appear? ({'H' if a<2 else 'C'} = {a}, {n[-1] if n!='HCl' else 'Cl'} = {b} amu)"
    else: q = f"The moment of inertia of {n} is ${sci(Iv)}$ kg m². At what wavenumber (cm$^{{-1}}$) does the first rotational line appear?"
    Bq = rot_B_from_I(Iv)
    its.append(item(q + " ($h=6.626\\times10^{-34}$, $c=3\\times10^{10}$ cm s$^{-1}$)", ["If $r_0$ is given: $I=\\mu r_0^2$. Then $B=h/8\\pi^2Ic$, first line $=2B$."], f"$B={Bq:.3f}$ cm$^{{-1}}$, first line $={2*Bq:.2f}$ cm$^{{-1}}$"))
pset(c1, "Set 4 · The reverse problem: from I or r₀ to the first line", "Exam variants (HBr I = 3.26×10⁻⁴⁷; HBr r₀ = 1.404 Å) are in this family.", its)
# Set 5: isotope twist and concept
Bh = 21.18 / 2; muH = mu_amu(1.008, 35.45); muD = mu_amu(2.014, 35.45); Bd = Bh * muH / muD
pset(c1, "Set 5 · Concept twists", "Same ideas, asked differently.", [
    item("DCl has the same bond length as HCl (D = 2.014 amu). If HCl's first line is at 21.18 cm$^{-1}$, predict DCl's first line. Is it higher or lower? Why?",
         ["$r_0$ is unchanged (electronic structure identical) so $I=\\mu r_0^2$ and $B\\propto1/\\mu$.", f"$\\mu_{{HCl}}={muH:.4f}$, $\\mu_{{DCl}}={muD:.4f}$ amu, so $B_{{DCl}}=B_{{HCl}}\\,\\mu_{{HCl}}/\\mu_{{DCl}}$."], f"First line ≈ {2*Bd:.2f} cm$^{{-1}}$ — lower, because heavier μ gives larger I and smaller B."),
    item("A rotational spectrum shows lines at 42.4, 63.6 and 84.8 cm$^{-1}$ with no line at 21.2 cm$^{-1}$ shown. Deduce $B$ and the $J$ values involved.",
         ["Spacing $=2B=21.2$ so $B=10.6$ cm$^{-1}$. Lines $=2B(J+1)$: 42.4 → $J+1=2$ ($J=1\\to2$); 63.6 → 3; 84.8 → 4."], "$B=10.6$ cm$^{-1}$; transitions $1\\to2$, $2\\to3$, $3\\to4$"),
    item("Which of these show a pure rotational spectrum: H$_2$, HCl, CO$_2$, CO, N$_2$, HF, Cl$_2$, H$_2$O? Give the rule.", ["Gross rule: permanent dipole moment. Specific rule: $\\Delta J=\\pm1$."], "Active: HCl, CO, HF, H$_2$O. Inactive: H$_2$, CO$_2$ (symmetric, zero net dipole), N$_2$, Cl$_2$."),
    item("Why does the intensity of rotational lines first rise and then fall with $J$?", ["Level $J$ has $(2J+1)$ states (degeneracy) but its population also falls exponentially as energy rises (Boltzmann factor)."], "Degeneracy $(2J+1)$ grows; Boltzmann population $e^{-E_J/kT}$ decays; the product peaks at an intermediate $J$."),
    item("How many lines appear between 0 and 100 cm$^{-1}$ for $B=10.56$ cm$^{-1}$?", ["Lines at $21.12\\,(J+1)$; $21.12n<100\\Rightarrow n\\le4$."], "4 lines (21.12, 42.24, 63.36, 84.48 cm$^{-1}$)")])

# ================================================================== CH2 SHO
c2 = chapter("Q2", "Vibrational (IR) spectroscopy – harmonic oscillator", "m1", "T5",
    "Every paper has a k ↔ ν̄ calculation, usually with zero-point energy, plus the 'why only one line' reason. Learn the one-line formula and practise the unit handling.",
    [r"\bar\nu_{osc}=\dfrac{1}{2\pi c}\sqrt{\dfrac{k}{\mu}}\ \text{cm}^{-1}", r"k=4\pi^2c^2\bar\nu^2\mu", r"\varepsilon_v=\left(v+\tfrac12\right)\bar\nu_{osc}", r"\text{ZPE}=\varepsilon_0=\tfrac12\bar\nu_{osc}\ \ (E_0=\tfrac12 h c\bar\nu)", r"\Delta v=\pm1\ \Rightarrow\ \text{one line at }\bar\nu_{osc}"], ["G13"])
c2["method"] = ["Find $\\mu$ in kg.", "$\\bar\\nu=\\dfrac{1}{2\\pi c}\\sqrt{k/\\mu}$ ($c$ in cm s$^{-1}$ → cm$^{-1}$).", "ZPE $=\\tfrac12\\bar\\nu$ (multiply by $hc$ for joules).", "For $k$: $k=4\\pi^2c^2\\bar\\nu^2\\mu$."]
def sho_steps(k, a, b, c=C0, pi=PI):
    mu = mu_amu(a, b) * AMU; nu = sho_nu(k, a, b, c, pi)
    return [f"$\\mu=\\dfrac{{{a}\\times{b}}}{{{a+b:.5g}}}={mu/AMU:.4f}$ amu $={sci(mu)}$ kg.",
            f"$\\bar\\nu=\\dfrac{{1}}{{2\\pi c}}\\sqrt{{\\dfrac{{k}}{{\\mu}}}}=\\dfrac{{1}}{{2({pi:.3g})(3\\times10^{{10}})}}\\sqrt{{\\dfrac{{{k:g}}}{{{sci(mu)}}}}}={nu:.0f}$ cm$^{{-1}}$.",
            f"ZPE $=\\tfrac12\\bar\\nu={nu/2:.0f}$ cm$^{{-1}}$ $={sci(nu/2*H0*c)}\\ \\text{{J}}$ (×$hc$)."], nu
st, nu = sho_steps(970, 1.008, 18.99, pi=3.14)
past(c2, "J24a", 6, "(i) The force constant of HF (SHO) is 970 N m$^{-1}$. Calculate the oscillation frequency (cm$^{-1}$) and the zero-point energy. (ii) Why does the SHO spectrum show only one line? (c = 3×10⁸ m s⁻¹, π = 3.14, 1 amu = 1.66×10⁻²⁷ kg; H = 1.008, F = 18.99 amu)",
     st + ["(ii) Levels $\\varepsilon_v=(v+\\tfrac12)\\bar\\nu$ are equally spaced and the selection rule is $\\Delta v=\\pm1$, so every allowed transition needs the same energy $\\bar\\nu$ — one line."], f"$\\bar\\nu\\approx{nu:.0f}$ cm$^{{-1}}$, ZPE ≈ {nu/2:.0f} cm$^{{-1}}$ ≈ ${sci(nu/2*H0*C0)}$ J")
st, nu = sho_steps(970, 1.004, 18.998, pi=3.14)
past(c2, "D24b", 6, "Same HF question with H = 1.004 amu, F = 18.998 amu (k = 970 N m⁻¹): (i) oscillation frequency in cm⁻¹; (ii) zero-point energy; (iii) why one line?", st + ["(iii) Equal spacing + $\\Delta v=\\pm1$."], f"$\\bar\\nu\\approx{nu:.0f}$ cm$^{{-1}}$; ZPE ≈ {nu/2:.0f} cm$^{{-1}}$")
k = sho_k(2168, 12, 15.999, pi=3.14)
past(c2, "J24b", 6, "(i) CO absorbs at 2168 cm$^{-1}$ in a vibrational transition. Calculate the ground-state vibrational energy and force constant (SHO). ($c=3\\times10^{10}$ cm s$^{-1}$, $h=6.625\\times10^{-34}$ J s, C = 12, O = 15.999 amu). (ii) Write a note on the failure of the SHO model.",
     [f"Ground state ($v=0$): $\\varepsilon_0=\\tfrac12(2168)=1084$ cm$^{{-1}}$ $=1084\\times hc={sci(1084*6.625e-34*3e10)}$ J.", f"$\\mu={mu_amu(12,15.999):.4f}$ amu; $k=4\\pi^2c^2\\bar\\nu^2\\mu={sci(k)}\\approx{k:.0f}$ N m$^{{-1}}$.",
      "(ii) See Q3 and the note after this chapter: real bonds dissociate, levels converge, overtones/hot bands occur — SHO predicts none."], f"$\\varepsilon_0=1084$ cm$^{{-1}}$; $k\\approx{k:.0f}$ N m$^{{-1}}$")
past(c2, "JAN", 6, "(i) Radiation absorbed by CO in a vibrational transition is 2168 cm⁻¹. Calculate the ground-state vibrational energy and the force constant (SHO; π = 3.14, h = 6.627×10⁻³⁴ J s, c = 3×10¹⁰ cm s⁻¹, C = 12, O = 15.999). (ii) Only one peak is observed in the SHO model. Substantiate.",
     ["Same as the previous CO question: $\\varepsilon_0=1084$ cm$^{-1}$; $k\\approx1.90\\times10^3$ N m$^{-1}$.", "(ii) Equal level spacing and $\\Delta v=\\pm1$."], "ZPE 1084 cm⁻¹; k ≈ 1.90×10³ N m⁻¹")
k = sho_k(2050, 12, 15.9994, pi=PI, c=3e10)
past(c2, "L23b", 4, "If the IR spectrum of CO shows only one line at 2050 cm$^{-1}$, calculate the force constant of CO. (C = 12, O = 15.9994 amu; 1 amu $=1.66\\times10^{-27}$ kg, $c=3\\times10^8$ m s$^{-1}$)",
     [f"$\\mu={mu_amu(12,15.9994):.4f}$ amu $={sci(mu_amu(12,15.9994)*AMU)}$ kg; $\\bar\\nu=2050$ cm$^{{-1}}=205000$ m$^{{-1}}$.", f"$k=4\\pi^2c^2\\bar\\nu^2\\mu={sci(k)}\\ \\text{{N m}}^{{-1}}$."], f"$k\\approx{k:.0f}$ N m$^{{-1}}$")
k = (2 * PI * 3e8 * 2649 * 100) ** 2 * 1.639e-27
past(c2, "M24", 6, "For HBr (SHO) the vibrational spectrum shows a fundamental at 2649 cm$^{-1}$. Determine the force constant. (Reduced mass of HBr $=1.639\\times10^{-27}$ kg, $c=3\\times10^8$ m s$^{-1}$)",
     ["$\\mu$ is given — no need to compute it.", f"$k=4\\pi^2c^2\\bar\\nu^2\\mu$ with $\\bar\\nu=264900$ m$^{{-1}}$: $k={sci(k)}\\approx{k:.0f}$ N m$^{{-1}}$."], f"$k\\approx{k:.0f}$ N m$^{{-1}}$")
st, nu = sho_steps(1840, 12.0, 15.9994, c=3e10, pi=PI)
past(c2, "D24a", 4, "The force constant of CO is 1840 N m$^{-1}$. Calculate the oscillation frequency and wavenumber. (1 amu $=1.66\\times10^{-27}$ kg, $c=3\\times10^8$ m s$^{-1}$; C = 12.000, O = 15.9994)",
     st[:2] + [f"Frequency $\\nu=c\\bar\\nu=(3\\times10^{{10}})({nu:.0f})={sci(3e10*nu)}$ Hz."], f"$\\bar\\nu\\approx{nu:.0f}$ cm$^{{-1}}$; $\\nu\\approx{sci(3e10*nu,3)}$ Hz")
nuNO = sho_nu(1530, 14, 16, pi=3.14)
past(c2, "J25a", 7, "(i) Using the harmonic oscillator model calculate the zero-point vibrational energy of NO (k = 1530 N m$^{-1}$; N = 14, O = 16 amu). (ii) Draw the vibrational level diagram and the spectrum. (iii) Calculate the energies of $v=3$ and $v=4$. ($c=3\\times10^8$ m s$^{-1}$, $\\pi=3.14$, $h=6.627\\times10^{-34}$ J s)",
     sho_steps(1530, 14, 16, pi=3.14)[0][:2] + [f"ZPE $=\\tfrac12\\bar\\nu={nuNO/2:.0f}$ cm$^{{-1}}$ $={sci(nuNO/2*6.627e-34*3e10)}$ J (using $h=6.627\\times10^{{-34}}$).", "(ii) Equally spaced levels (gap $\\bar\\nu$) on a parabola; one line at $\\bar\\nu$ (**Fig. G13**).",
      f"(iii) $\\varepsilon_3=3.5\\bar\\nu={3.5*nuNO:.0f}$ cm$^{{-1}}$; $\\varepsilon_4=4.5\\bar\\nu={4.5*nuNO:.0f}$ cm$^{{-1}}$."], f"ZPE ≈ {nuNO/2:.0f} cm⁻¹; ε₃ ≈ {3.5*nuNO:.0f}, ε₄ ≈ {4.5*nuNO:.0f} cm⁻¹")
c2["theory"] = [
    ("Why does the SHO spectrum show only one line? (asked ×5)", "Levels $\\varepsilon_v=(v+\\tfrac12)\\bar\\nu$ are **equally spaced**; the selection rule $\\Delta v=\\pm1$ allows only neighbouring-level jumps. Every jump has the same energy $\\bar\\nu$, so all coincide in one line."),
    ("Why is CO₂ IR-active though it has no permanent dipole? (asked ×3)", "IR activity needs a change in dipole during vibration, not a permanent dipole. CO₂'s symmetric stretch gives no change (inactive), but the asymmetric stretch and the bending mode do (active). It has no permanent dipole, so it is microwave-inactive."),
    ("Why is HI IR-active but H₂ and I₂ inactive?", "HI is heteronuclear: stretching changes its dipole moment. H₂ and I₂ are homonuclear: zero dipole at every bond length, so the vibration never changes it."),
    ("Write a note on the failure of the SHO model. (asked ×1, relevant ×4)", "The SHO assumes a parabolic potential and equal spacing, so it predicts a single line and never dissociation. Real bonds break when stretched (anharmonic, Morse), levels converge, $\\Delta v=\\pm2,\\pm3$ overtones and hot bands appear, and the molecule can dissociate. The SHO therefore fails at high $v$ and cannot explain overtones.")]
# practice
its = []
for (n, k_, a, b) in [("HCl", 516, 1.008, 35.45), ("HBr", 412, 1.008, 79.9), ("HI", 314, 1.008, 126.9), ("CO", 1857, 12.0, 15.995), ("HF", 966, 1.008, 18.998), ("NO", 1595, 14.0, 16.0)]:
    nu_ = sho_nu(k_, a, b)
    its.append(item(f"The force constant of {n} is {k_} N m$^{{-1}}$. Calculate the vibrational wavenumber (cm$^{{-1}}$), the frequency (Hz) and the zero-point energy in cm$^{{-1}}$ and joules. ($c=3\\times10^{{10}}$ cm s$^{{-1}}$, $h=6.626\\times10^{{-34}}$ J s, 1 amu $=1.66\\times10^{{-27}}$ kg; masses {a}, {b} amu)",
        [f"$\\mu={mu_amu(a,b):.4f}$ amu; $\\bar\\nu=(1/2\\pi c)\\sqrt{{k/\\mu}}$; ZPE $=\\tfrac12\\bar\\nu$."], f"$\\bar\\nu={nu_:.0f}$ cm$^{{-1}}$; $\\nu={sci(3e10*nu_)}$ Hz; ZPE $={nu_/2:.0f}$ cm$^{{-1}}$ $={sci(nu_/2*H0*C0)}$ J"))
pset(c2, "Set 1 · k → wavenumber and zero-point energy", "Exam pattern: HF, NO, CO k-values. Practise with other diatomics.", its)
its = []
for (n, nu_, a, b) in [("HCl", 2886, 1.008, 35.45), ("CO", 2143, 12.0, 15.995), ("HF", 4138, 1.008, 18.998), ("NO", 1904, 14.0, 16.0), ("HI", 2309, 1.008, 126.9)]:
    its.append(item(f"The fundamental IR band of {n} (treated as an SHO) is at {nu_} cm$^{{-1}}$. Calculate the force constant. ({a} and {b} amu; $c=3\\times10^{{10}}$ cm s$^{{-1}}$)", ["$k=4\\pi^2c^2\\bar\\nu^2\\mu$, with $\\mu$ in kg."], f"$k={sci(sho_k(nu_, a, b))}\\approx{sho_k(nu_, a, b):.0f}$ N m$^{{-1}}$"))
pset(c2, "Set 2 · ν̄ → force constant", "The reverse calculation. A stiffer bond (larger k) gives a higher ν̄.", its)
its = []
for (n, k_, a, b, vs) in [("NO", 1530, 14, 16, (0, 1, 2, 3, 4)), ("HCl", 516, 1.008, 35.45, (0, 1, 2, 5)), ("CO", 1857, 12.0, 15.995, (0, 2, 3, 6)), ("HF", 966, 1.008, 18.998, (1, 2, 4))]:
    nu_ = sho_nu(k_, a, b)
    its.append(item(f"For {n} ($k={k_}$ N m$^{{-1}}$) calculate the energies of levels $v={', '.join(map(str,vs))}$ in cm$^{{-1}}$, and the spacing between neighbouring levels.", ["$\\varepsilon_v=(v+\\tfrac12)\\bar\\nu$; spacing $=\\bar\\nu$."],
        f"$\\bar\\nu={nu_:.0f}$: " + ", ".join(f"$\\varepsilon_{v}={ (v+.5)*nu_:.0f}$" for v in vs) + f" cm$^{{-1}}$; spacing {nu_:.0f} cm$^{{-1}}$"))
pset(c2, "Set 3 · Energy of the v-th level", "Draw the ladder yourself first; the exam also asks for the level diagram and the single-line spectrum.", its)
nuH = sho_nu(516, 1.008, 35.45); nuD = sho_nu(516, 2.014, 35.45)
pset(c2, "Set 4 · Concept twists", "", [
    item("HCl and DCl have the same force constant (516 N m$^{-1}$). Compare their fundamental wavenumbers and ZPE.", [f"$\\bar\\nu\\propto1/\\sqrt\\mu$: $\\mu_{{HCl}}={mu_amu(1.008,35.45):.4f}$, $\\mu_{{DCl}}={mu_amu(2.014,35.45):.4f}$ amu."], f"HCl {nuH:.0f} cm⁻¹ (ZPE {nuH/2:.0f}); DCl {nuD:.0f} cm⁻¹ (ZPE {nuD/2:.0f}). Ratio {nuH/nuD:.3f}. Heavier isotope → lower ν̄ and ZPE."),
    item("Which of the following are IR active: N₂, HCl, CO₂ (symmetric stretch), CO₂ (bend), H₂O (bend), O₂, CH₄ (all stretches)?", ["Test: does the dipole moment change during the vibration?"], "Active: HCl, CO₂ (bend), H₂O (bend), CH₄ (some stretches). Inactive: N₂, O₂, CO₂ symmetric stretch, CH₄ totally symmetric stretch."),
    item("If $k$ is doubled, by what factor does the SHO wavenumber change? If $\\mu$ is doubled?", ["$\\bar\\nu\\propto\\sqrt{k/\\mu}$."], "×√2 = 1.414 when k doubles; ×1/√2 = 0.707 when μ doubles."),
    item("State the gross and specific selection rules for IR absorption of a diatomic.", ["Gross: dipole moment must change on vibration. Specific (SHO): $\\Delta v=\\pm1$."], "Gross: change in dipole; Specific: Δv = ±1 (SHO), Δv = ±1, ±2, ±3… (anharmonic).")])

# ================================================================== CH3 ANHARMONIC
c3 = chapter("Q3", "Anharmonic oscillator and overtones", "m1", "T6",
    "Anharmonic problems are two-equation puzzles: you are given two of fundamental / overtone / ωₑ / xₑ and must find the others. Memorise the three transition expressions.",
    [r"\varepsilon_v=(v+\tfrac12)\bar\omega_e-(v+\tfrac12)^2\bar\omega_e x_e", r"0\to1:\ \bar\omega_e(1-2x_e)", r"0\to2:\ 2\bar\omega_e(1-3x_e)", r"0\to3:\ 3\bar\omega_e(1-4x_e)", r"1\to2\ (\text{hot}):\ \bar\omega_e(1-4x_e)"], ["G15", "G17"])
c3["method"] = ["Write the two given transitions as two equations in $\\bar\\omega_e$ and $x_e$.", "Subtract: $\\bar\\omega_e x_e=f-o/2$; then $\\bar\\omega_e=3f-o$ and $x_e=(f-o/2)/\\bar\\omega_e$.", "If $x_e$ is given instead: $\\bar\\omega_e=f/(1-2x_e)$."]
xe, we = anh_from(2559.08, 5027.54)
past(c3, "L23a", 4, "For HBr the vibrational spectrum shows the fundamental at 2559.08 cm$^{-1}$ and the first overtone at 5027.54 cm$^{-1}$. Calculate the anharmonicity constant (anharmonic model).",
     ["Fundamental: $\\bar\\omega_e(1-2x_e)=2559.08$. First overtone: $2\\bar\\omega_e(1-3x_e)=5027.54\\Rightarrow\\bar\\omega_e(1-3x_e)=2513.77$.", f"Subtract: $\\bar\\omega_ex_e=2559.08-2513.77=45.31$ cm$^{{-1}}$. Then $\\bar\\omega_e=2559.08+2(45.31)=3(2559.08)-5027.54={we:.2f}$ cm$^{{-1}}$.", f"$x_e=45.31/{we:.2f}={xe:.4f}$."], f"$x_e\\approx{xe:.4f}$ ($\\bar\\omega_e\\approx{we:.1f}$ cm$^{{-1}}$)")
past(c3, "J25b", 2, "The fundamental stretching frequency of CO is 2143 cm$^{-1}$ and its anharmonicity constant is 0.01. Calculate its oscillational (equilibrium) frequency.", ["$\\bar\\omega_e(1-2x_e)=2143$.", f"$\\bar\\omega_e=\\dfrac{{2143}}{{1-2(0.01)}}=\\dfrac{{2143}}{{0.98}}={2143/0.98:.1f}$ cm$^{{-1}}$."], f"$\\bar\\omega_e\\approx{2143/.98:.1f}$ cm$^{{-1}}$")
past(c3, "L23b", 2, "Assuming CO shows anharmonic oscillation, calculate the wavenumber of the first overtone if $x_e=0.017$ and the equilibrium vibrational frequency is 2050 cm$^{-1}$.", ["First overtone $0\\to2$: $2\\bar\\omega_e(1-3x_e)=2(2050)(1-3\\times0.017)=2(2050)(0.949)$."], f"${2*2050*(1-3*.017):.1f}$ cm$^{{-1}}$")
past(c3, "J25b", 4, "(i) What is the selection rule for the anharmonic oscillator? What is the first overtone transition? Give its expression and explain the terms.",
     ["Selection rule: $\\Delta v=\\pm1,\\pm2,\\pm3\\ldots$ (gross rule: dipole must change).", "First overtone $v=0\\to2$: $\\Delta\\bar\\nu=2\\bar\\omega_e(1-3x_e)$, where $\\bar\\omega_e$ is the equilibrium vibrational wavenumber (cm$^{-1}$) and $x_e$ is the small positive anharmonicity constant. It is a little less than twice the fundamental."], "$2\\bar\\omega_e(1-3x_e)$")
past(c3, "D24a", 5, "Briefly describe the Born–Oppenheimer approximation and draw the ground and excited electronic states of a diatomic molecule showing rotational and vibrational energy levels (anharmonic model).",
     ["B–O: electronic, vibrational and rotational energies are independent; $E=E_{rot}+E_{vib}+E_{elec}$ (translation negligible), with $E_{rot}\\ll E_{vib}\\ll E_{elec}$.", "Diagram: two Morse curves (ground below, excited above and displaced to longer $r_e$); levels converge towards each dissociation limit; each vibrational level carries closely spaced rotational sub-levels (**Fig. G15** for the Morse shape)."], "See statement + diagram")
its = []
for (n, f, o) in [("HCl", 2885.3, 5665.0), ("CO", 2143.2, 4259.9), ("HF", 3958.5, 7737.2), ("NO", 1876.1, 3724.0), ("HBr", 2559.08, 5027.54)]:
    xe_, we_ = anh_from(f, o)
    its.append(item(f"{n}: fundamental {f} cm$^{{-1}}$, first overtone {o} cm$^{{-1}}$. Calculate $x_e$ and $\\bar\\omega_e$.", [f"$\\bar\\omega_ex_e=f-o/2={f-o/2:.2f}$; $\\bar\\omega_e=3f-o={we_:.1f}$."], f"$\\bar\\omega_e={we_:.1f}$ cm$^{{-1}}$, $x_e={xe_:.4f}$"))
pset(c3, "Set 1 · xₑ and ωₑ from fundamental + first overtone", "The standard exam puzzle.", its)
its = []
for (n, f, x) in [("CO", 2143, 0.01), ("HCl", 2886, 0.0177), ("HF", 3959, 0.0217), ("NO", 1876, 0.0074), ("HI", 2230, 0.0183)]:
    we_ = f / (1 - 2 * x)
    its.append(item(f"{n}: fundamental {f} cm$^{{-1}}$ and $x_e={x}$. Find $\\bar\\omega_e$ and the first and second overtones.", ["$\\bar\\omega_e=f/(1-2x_e)$; overtones $2\\bar\\omega_e(1-3x_e)$ and $3\\bar\\omega_e(1-4x_e)$."],
        f"$\\bar\\omega_e={we_:.1f}$; 1st overtone ${2*we_*(1-3*x):.1f}$; 2nd overtone ${3*we_*(1-4*x):.1f}$ cm$^{{-1}}$"))
pset(c3, "Set 2 · ωₑ from the fundamental and xₑ; overtones", "Exam: CO 2143, xₑ = 0.01. Same method, other molecules.", its)
its = []
for (n, we_, x) in [("CO", 2050, 0.017), ("HCl", 2990, 0.0177), ("NO", 1904, 0.0074), ("HF", 4138, 0.0217)]:
    its.append(item(f"{n}: $\\bar\\omega_e={we_}$ cm$^{{-1}}$, $x_e={x}$. Calculate the fundamental, first overtone, second overtone and the hot band ($1\\to2$).", ["Use the four expressions in the recap."],
        f"Fundamental {we_*(1-2*x):.1f}; 1st overtone {2*we_*(1-3*x):.1f}; 2nd overtone {3*we_*(1-4*x):.1f}; hot band {we_*(1-4*x):.1f} cm$^{{-1}}$ (hot band lies below the fundamental)"))
pset(c3, "Set 3 · All transitions from ωₑ and xₑ", "Exam: CO ωₑ = 2050, xₑ = 0.017, first overtone.", its)
pset(c3, "Set 4 · Concept twists", "", [
    item("Why do the lines of an anharmonic spectrum get closer together at higher energy?", ["Levels converge towards the dissociation limit: spacing $=\\bar\\omega_e[1-2x_e(v+1)]$ shrinks with $v$."], "Because the Morse levels converge; the gap between $v$ and $v+1$ decreases as $v$ increases."),
    item("Give the transition energy of the hot band relative to the fundamental for $\\bar\\omega_e=2000$, $x_e=0.02$.", ["Fundamental $2000(0.96)=1920$; hot band $2000(0.92)=1840$."], "Hot band 1840 cm⁻¹ — 80 cm⁻¹ below the fundamental (the left side of the spectrum)."),
    item("Compare SHO and anharmonic oscillator on: potential, level spacing, selection rule, number of lines.", [], "SHO: parabola, equal, Δv = ±1, one line. Anharmonic: Morse curve, converging, Δv = ±1, ±2, ±3…, fundamental + overtones (+ hot bands)."),
    item("Calculate the anharmonic zero-point energy of CO ($\\bar\\omega_e=2169.8$, $x_e=0.00612$) and compare with $\\tfrac12\\bar\\omega_e$.", ["$\\varepsilon_0=\\tfrac12\\bar\\omega_e(1-\\tfrac12x_e)$ (added for clarity)."], f"$\\varepsilon_0={0.5*2169.8*(1-0.5*0.00612):.1f}$ cm$^{{-1}}$ vs {0.5*2169.8:.1f} — slightly lower.")])

# ================================================================== CH4 ELECTRONIC / FC / BO / RAMAN
c4 = chapter("Q4", "Born–Oppenheimer, electronic spectra, Franck–Condon and Raman", "m1", "T1–T3, T7",
    "Largely theory: statements, diagrams and 'what can you conclude?' questions. Franck–Condon diagrams appear in more than half of all papers.",
    [r"E=E_{rot}+E_{vib}+E_{elec},\ \ E_{rot}\ll E_{vib}\ll E_{elec}", r"E=h\nu=hc\bar\nu,\ \ \bar\nu=1/\lambda", r"\text{electronic lines labelled }(v',v'')", r"A=\log\dfrac{I_0}{I}=\varepsilon c l\ \ (\text{Beer–Lambert; older syllabus})"], ["G21"])
c4["method"] = ["Franck–Condon: always draw the vertical arrow from the centre of $v''=0$.", "Compare $r_e'$ with $r_e''$: equal → (0,0) strongest; larger → (v′,0) with v′>0 strongest; much larger → continuum."]
c4["theory"] = [
    ("State the Franck–Condon principle. Draw the three cases and comment on each spectrum. (asked ×5)", "**Statement:** “An electronic transition takes place so rapidly that a vibrating molecule does not change its internuclear distance appreciably during the transition,” so transitions are vertical.\n(a) $r_e'=r_e''$: vertical arrow lands on $v'=0$; the (0,0) line is strongest and intensity falls for (1,0), (2,0)…\n(b) $r_e'>r_e''$: arrow lands on a higher $v'$ (e.g. 2); the (v′,0) line with v′>0 is strongest, so the maximum is displaced along the progression.\n(c) $r_e'\\gg r_e''$: arrow lands above the dissociation limit; a few discrete lines then a **continuum** (**Fig. G21**)."),
    ("The vibrational–electronic spectrum of a molecule shows a continuum. What can be inferred? (asked ×2)", "The molecule has been excited above the dissociation limit of the upper state, so it **dissociates** into atoms. The atoms carry away the excess energy as unquantised kinetic energy, so no discrete lines appear — a continuum. (It also implies $r_e'\\gg r_e''$.)"),
    ("State the Born–Oppenheimer approximation. (asked ×3)", "The total energy of a molecule is the sum of independent translational, rotational, vibrational and electronic parts; translation is negligible, so $E=E_{rot}+E_{vib}+E_{elec}$ with $E_{rot}\\ll E_{vib}\\ll E_{elec}$ (electronic levels are far apart, rotational levels very close)."),
    ("What are Rayleigh scattering and Raman scattering? Differentiate Stokes and anti-Stokes lines. (asked ×2)", "**Rayleigh:** elastic scattering — scattered light has the same frequency as the incident light. **Raman:** inelastic scattering — frequency shifts because the molecule exchanges vibrational/rotational energy with the photon. **Stokes:** scattered frequency lower than incident (molecule gains energy, goes up). **Anti-Stokes:** higher than incident (molecule loses energy, comes down); weaker because fewer molecules start in an excited level. (Transcript-based; not on the 2026 slides.)"),
    ("State the Beer–Lambert law and explain the terms. (older syllabus)", "$A=\\log(I_0/I)=\\varepsilon c l$: absorbance is proportional to concentration $c$ (mol L⁻¹) and path length $l$ (cm); $\\varepsilon$ is the molar absorptivity (L mol⁻¹ cm⁻¹); $I_0$ and $I$ are incident and transmitted intensities. **Flag: not on current slides.**"),
    ("Why does the excited electronic state usually have a larger equilibrium bond length?", "An electron is promoted to an antibonding orbital (e.g. π→π*), weakening the bond, so the minimum of the upper potential curve shifts to larger $r$."),
    ("Why do homonuclear molecules (H₂, N₂) show vibration/rotation only in electronic spectra?", "They have no dipole change for IR or rotation, but all molecules can undergo electronic transitions, which carry vibrational (coarse) and rotational (fine) structure.")]
past(c4, "D24b", 7, "State the Franck–Condon principle. With a diagram show the electronic transitions and spectra when (i) $v''=0\\to v'=0$ is strongest; (ii) $v''=0\\to v'=2$ is strongest.", ["Statement as in the theory box. (i) is case (a) of **Fig. G21** ($r_e'=r_e''$): (0,0) strongest. (ii) is case (b) ($r_e'>r_e''$): the vertical arrow ends on $v'=2$, so the (2,0) line is strongest and the progression peaks there."], "Cases (a) and (b)")
past(c4, "J24b", 4, "Justify the Franck–Condon principle by drawing the transitions and spectra when (1) the internuclear distances in ground and excited states are the same; (2) the excited-state distance is much larger.", ["(1) case (a): (0,0) most intense. (2) case (c): vertical arrow above the dissociation limit → continuum (**Fig. G21**)."], "Cases (a) and (c)")
past(c4, "L23b", 6, "(i) What is the Franck–Condon principle? If a vibrational-electronic spectrum shows a continuum, what can one infer? (ii) Why is bulk aluminium stable whereas nano aluminium is combustible?", ["(i) Statement + dissociation (theory box). (ii) is a nano-materials question (Unit 4) — not covered here."], "Dissociation")
past(c4, "M24", 6, "(i) State the Born–Oppenheimer approximation. (ii) What does the appearance of a continuum in an electronic spectrum let us conclude?", ["Statement and dissociation reasoning — see theory box."], "See theory box")
past(c4, "D23", 4, "What do you mean by Rayleigh scattering and Raman scattering? Mention the difference between Stokes and anti-Stokes lines.", ["See theory box."], "See theory box")
past(c4, "L23b", 2, "How is it that carbon dioxide is IR active even though it has no permanent dipole? (also Jan-24 UE22 'Why is CO₂ IR active but microwave inactive?')", ["See Q2 theory box: asymmetric stretch and bend change the dipole; symmetric stretch does not."], "Dipole change, not permanent dipole")
# practice: EM conversions
its = []
for lam_nm in (500, 250, 700, 10000, 3000):
    lam_cm = lam_nm * 1e-7; nu_bar = 1 / lam_cm; nu = 3e10 * nu_bar; E = H0 * nu
    reg = "UV" if lam_nm < 400 else ("visible" if lam_nm <= 700 else "IR")
    its.append(item(f"Light of wavelength {lam_nm} nm: find the wavenumber (cm$^{{-1}}$), frequency (Hz), photon energy (J) and region. ($h=6.626\\times10^{{-34}}$ J s, $c=3\\times10^{{10}}$ cm s$^{{-1}}$)", ["$\\bar\\nu=1/\\lambda$ (λ in cm); $\\nu=c\\bar\\nu$; $E=h\\nu$."], f"$\\bar\\nu={sci(nu_bar)}$ cm$^{{-1}}$; $\\nu={sci(nu)}$ Hz; $E={sci(E)}$ J; region: {reg}"))
pset(c4, "Set 1 · Wavelength, wavenumber, frequency, energy", "Basic conversions that underpin every spectroscopy question.", its)
pset(c4, "Set 2 · Franck–Condon outcomes", "Decide the case, then describe the spectrum.", [
    item("A diatomic's ground and excited states have almost identical bond lengths. Which line is the most intense?", [], "(0,0): case (a); intensity decreases for (1,0), (2,0)…"),
    item("The spectrum shows the strongest line as (3,0). Compare $r_e'$ and $r_e''$ and sketch the transition.", [], "$r_e'>r_e''$ (case b): the vertical arrow from $v''=0$ ends on $v'=3$."),
    item("A spectrum has a few discrete lines that merge into a featureless band at high energy. What happened to the molecule?", [], "It dissociated (case c); the continuum is unquantised kinetic energy of the atoms."),
    item("Why can't a vibrational spectrum of an electronic transition be explained without the Franck–Condon principle even though there is no vibrational selection rule?", [], "With no selection rule all (v′,v″) lines are allowed, yet they differ greatly in intensity. Franck–Condon (vertical transitions + nuclear probability) explains which are strong."),
    item("State two differences between the case where $r_e'=r_e''$ and $r_e'>r_e''$.", [], "(a) one dominant (0,0) line, intensity falls quickly; (b) intensity maximum shifts to (v′,0) with v′>0 and the progression is longer.")])
pset(c4, "Set 3 · Selecting the right region and transition", "", [
    item("Which transition type and region: (a) spin reversal of nuclei; (b) rotation; (c) vibration; (d) valence-electron redistribution; (e) inner-electron; (f) nuclear rearrangement?", [], "(a) radio/NMR 10 m–1 cm; (b) microwave 1 cm–100 µm; (c) IR 100 µm–1 µm; (d) UV-Vis 1 µm–10 nm; (e) X-ray 10 nm–100 pm; (f) γ-ray 100–1 pm."),
    item("Order rotation, vibration and electronic transitions by increasing energy and say which spectroscopy each belongs to.", [], "$E_{rot}<E_{vib}<E_{elec}$: microwave < IR < UV-Vis."),
    item("Name the three electronic transitions common in organic molecules and the orbitals involved.", [], "σ→σ*, π→π*, n→π* (HOMO → LUMO)."),
    item("Draw/describe Stokes and anti-Stokes lines relative to the Rayleigh line.", [], "Rayleigh at the incident frequency; Stokes at lower frequency (red side); anti-Stokes at higher frequency (blue side), weaker.")])

# ================================================================== CH5 PHASE EQUILIBRIA
c5 = chapter("Q5", "Phase rule, water and Pb–Ag systems", "m2", "T8–T12",
    "Phase equilibria questions come in three flavours: derive the rule, count C/P/F for a system, and draw-and-label a diagram. Practise counting until it is automatic.",
    [r"F=C-P+2", r"\text{variables}=P(C-1)+2,\ \ \text{constraints}=C(P-1)", r"\text{reduced:}\ F=C-P+1", r"\text{water: }F=3-P", r"\dfrac{dP}{dT}=\dfrac{\Delta H}{T\Delta V}"], ["G22", "G23", "G24"])
c5["method"] = ["Count phases $P$ (each solid, each immiscible liquid, all gases = 1).", "Count components $C$ = species − independent reactions − composition restrictions.", "$F=C-P+2$ (or $C-P+1$ if pressure is fixed / condensed).", "$F=2$ bivariant, 1 univariant, 0 invariant."]
c5["derivation"] = ("Q5-D · Derivation of the phase rule (asked ×3)", [
    "System of $C$ components in $P$ phases at equilibrium. Variables: temperature, pressure and the composition of each phase.",
    "Composition of one phase needs $C-1$ mole fractions (they sum to 1). For $P$ phases: $P(C-1)$. Add $T$ and $P$: **total variables $=P(C-1)+2$**.",
    "At equilibrium the chemical potential of each component is equal in every phase: $\\mu_i^\\alpha=\\mu_i^\\beta=\\mu_i^\\gamma=\\cdots$ — that is $(P-1)$ equations per component, **$C(P-1)$ constraints** in all.",
    "$F=$ variables − constraints $=P(C-1)+2-C(P-1)=PC-P+2-CP+C=\\ \\mathbf{C-P+2}$."])
for tag in ("J24a", "J25a"):
    past(c5, tag, 4, "Derive the phase rule for a system of $C$ components and $P$ phases in equilibrium.", ["See derivation Q5-D."], "$F=C-P+2$")
past(c5, "JAN", 4, "(i) Define component. Give the number of phases and components for the closed system MgCO$_3$(s) ⇌ MgO(s) + CO$_2$(g). (ii) Define eutectoid and peritectic points in the Fe–C system.",
     ["(i) **Component:** the smallest number of independently variable constituents by which the composition of every phase can be expressed. Phases: MgCO₃(s), MgO(s), CO₂(g): $P=3$. Species 3 − 1 reaction = **$C=2$** (e.g. choose MgO and CO₂: MgCO₃ = MgO + CO₂).",
      "(ii) Eutectoid: one solid phase transforms isothermally into two other solids (austenite → ferrite + cementite, 727 °C, 0.76 wt% C). Peritectic: liquid + one solid → a new solid (liquid + δ-ferrite → austenite, 1493 °C, 0.17 wt% C). **Flag: Fe–C is not in the current material; values are standard textbook figures.**"], "$P=3$, $C=2$")
past(c5, "J25b", 6, "(i) Why is the phase rule $F=C-P+2$ for water but $F=C-P+1$ for the Pb–Ag system? (ii) For CaCO$_3$(s) ⇌ CaO(s) + CO$_2$(g) in a closed container give the number of components and phases.",
     ["(i) Water is a one-component system with $T$ and $P$ both variable. For Pb–Ag, $C=2$ so $F=4-P$, giving $F=3$ for one phase — a 3-D diagram. Pressure is therefore fixed (≈1 atm) and, since solid–liquid equilibria (condensed systems, no gas) hardly depend on pressure, the rule reduces to $F=C-P+1$.",
      "(ii) $P=3$ (CaCO₃, CaO, CO₂); species 3 − 1 reaction ⇒ $C=2$."], "(ii) $P=3$, $C=2$")
past(c5, "J25a", 6, "(i) Draw a neat labelled phase diagram of water (areas, lines, triple point, critical point, pressure, temperature) and calculate the degree of freedom along the freezing-point curve. (ii) What is the condensed phase rule and why is it applied to the two-component Pb–Ag system?",
     ["(i) Diagram: **Fig. G22**. Triple point O: 0.0098 °C, 4.58 mmHg; critical point A: 374 °C, 218 atm. Along a curve $C=1,P=2$: $F=1-2+2=\\mathbf{1}$ (univariant).", "(ii) $F=C-P+1$: used when pressure is constant and the gas phase is absent (condensed systems), as in Pb–Ag where $P$ has little effect."], "$F=1$ on the freezing curve")
past(c5, "J24b", 6, "(i) Draw a neat labelled phase diagram of the water system with areas, lines and T, P values at the triple and critical points. (ii) Which phases are in equilibrium on the metastable curve? (iii) Calculate $F$ at the triple point.",
     ["(i) **Fig. G22**.", "(ii) Supercooled liquid water ⇌ vapour (curve OA′, an extension of OA below the triple point).", "(iii) $C=1,P=3$: $F=1-3+2=\\mathbf{0}$ — invariant."], "(ii) liquid + vapour; (iii) F = 0")
past(c5, "D24a", 8, "(i) Draw the phase diagram of water, label areas and boundaries, and calculate $F$ in the areas, along phase boundaries and at the triple point. (ii) Using the Clausius–Clapeyron equation, discuss why the melting-point curve has a negative slope. (iii) What is the reduced phase rule and when is it used?",
     ["(i) **Fig. G22**: areas $F=3-1=2$; lines $F=3-2=1$; triple point $F=3-3=0$.", "(ii) $\\dfrac{dP}{dT}=\\dfrac{\\Delta H_{fus}}{T\\Delta V}$. Fusion: $\\Delta H>0$; ice → water **decreases** volume ($\\Delta V<0$), so $dP/dT<0$: raising pressure lowers the melting point. The slope is steep because $|\\Delta V|$ is small. (OA and OB have $\\Delta V>0$ and large, so gentle positive slopes.)", "(iii) $F=C-P+1$ — for condensed systems at constant pressure."], "F = 2, 1, 0; dP/dT < 0 because ΔV < 0")
past(c5, "J24a", 6, "(i) Draw a neat labelled phase diagram of the lead–silver system indicating areas and lines. Give the temperature and composition at the eutectic point. (ii) For the Fe–C system mention the phases in equilibrium, temperature and wt% C at the peritectic point.",
     ["(i) **Fig. G23**: Pb melts at 327 °C, Ag at 961 °C; curves AO and BO fall to the eutectic point O at **303 °C, 2.6 % Ag (97.4 % Pb)**; areas: liquid melt; liquid + solid Ag; liquid + solid Pb; solid Pb + solid Ag. At O: $C=2,P=3,F=0$.", "(ii) Peritectic: liquid + δ-ferrite ⇌ austenite at **1493 °C, 0.17 wt% C** (flag: Fe–C not in current material)."], "Eutectic: 303 °C, 2.6 % Ag")
past(c5, "JAN", 6, "(i) Draw a neat labelled phase diagram of the CO$_2$ system with areas, lines, triple and critical points (T, P). (ii) What is the reduced phase rule? Why is the general Gibbs rule not applied to a two-component system?",
     ["(i) Like water but the solid–liquid line leans **right** (positive slope, since solid CO₂ is denser). Triple point **−56.6 °C, 5.11 atm**; critical point **31.1 °C, 73 atm**; at 1 atm CO₂ sublimes (−78.5 °C). **Flag: not in current material; standard values.**", "(ii) For $C=2$, $F=4-P$ gives $F=3$ when $P=1$, needing three axes ($T,P$, composition). So pressure is fixed: $F=C-P+1$."], "Triple −56.6 °C / 5.11 atm; critical 31.1 °C / 73 atm", flag="Not on current slides")
# counting practice
count_sys = [
    ("Ice ⇌ water ⇌ water vapour at the triple point", 3, 1, "single substance, three physical phases"),
    ("Liquid water in equilibrium with its vapour", 2, 1, "one substance"),
    ("CaCO₃(s) ⇌ CaO(s) + CO₂(g) (closed)", 3, 2, "3 species − 1 reaction"),
    ("MgCO₃(s) ⇌ MgO(s) + CO₂(g) (closed)", 3, 2, "3 species − 1 reaction"),
    ("NH₄Cl(s) ⇌ NH₃(g) + HCl(g), starting from NH₄Cl only", 2, 1, "gas has NH₃ : HCl = 1 : 1, an extra restriction"),
    ("NH₄Cl(s) ⇌ NH₃(g) + HCl(g) with excess NH₃ added", 2, 2, "the 1 : 1 restriction is lost"),
    ("Saturated NaCl solution + excess solid NaCl + vapour", 3, 2, "NaCl and water; solid, solution, vapour"),
    ("Two immiscible liquids (oil and water) and their vapour", 3, 2, "two components; liquid, liquid, vapour"),
    ("Rhombic sulphur ⇌ monoclinic sulphur ⇌ sulphur vapour", 3, 1, "one component, three phases"),
    ("PCl₅(g) ⇌ PCl₃(g) + Cl₂(g) in a closed vessel, starting from PCl₅ only", 1, 1, "single gas phase; composition fixed by [PCl₃] = [Cl₂]"),
    ("H₂(g) + I₂(g) ⇌ 2HI(g), all three initially present", 1, 2, "3 species − 1 reaction"),
    ("Na₂SO₄·10H₂O(s) ⇌ Na₂SO₄(s) + 10 H₂O(g)", 3, 2, "salt and water as components; hydrate, anhydrate, vapour"),
]
its = []
for (s, Pn, Cn, why) in count_sys:
    F2 = Cn - Pn + 2
    its.append(item(f"For the system: {s}, find $P$, $C$ and $F$ using $F=C-P+2$.", [why + "."], f"$P={Pn}$, $C={Cn}$, $F={Cn}-{Pn}+2=\\mathbf{{{F2}}}$ ({['invariant','univariant','bivariant'][F2] if 0<=F2<=2 else 'multivariant'})"))
pset(c5, "Set 1 · Count P, C and F", "The exam asks this for CaCO₃ and MgCO₃. The twist is usually NH₄Cl or an added reactant.", its)
its = []
for (a, b) in [(2, 1), (2, 2), (2, 3), (3, 2), (3, 4)]:
    its.append(item(f"For a system of $C={a}$ components in $P={b}$ phases: how many composition variables, total variables, constraints and what is $F$?", ["Variables $=P(C-1)+2$; constraints $=C(P-1)$."],
        f"Composition: {b*(a-1)}; total variables: {b*(a-1)+2}; constraints: {a*(b-1)}; $F={b*(a-1)+2}-{a*(b-1)}=\\mathbf{{{a-b+2}}}$"))
pset(c5, "Set 2 · Number of variables and constraints (derivation check)", "Using the derivation to confirm F = C − P + 2.", its)
pset(c5, "Set 3 · Water diagram", "Draw Fig. G22 from memory, then check.", [
    item("What are $F$ in an area, on a line, and at the triple point of water? Name the systems.", ["$F=3-P$."], "Area $F=2$ (bivariant); line $F=1$ (univariant); triple point $F=0$ (invariant)."),
    item("Name the curves OA, OB, OC and OA′ and the phases in equilibrium on each.", [], "OA vaporisation (water ⇌ vapour); OB sublimation (ice ⇌ vapour); OC fusion (ice ⇌ water, negative slope); OA′ metastable supercooled water ⇌ vapour."),
    item("Give the temperature and pressure at the triple point and critical point.", [], "Triple point 0.0098 °C, 4.58 mmHg; critical point 374 °C, 218 atm."),
    item("Why does water stop existing as a liquid above the critical point?", [], "The liquid–vapour interface vanishes — above the critical temperature no pressure can liquefy the vapour."),
    item("What happens to the melting point of ice if pressure increases, and why?", [], "It decreases: ice melts to a smaller volume ($\\Delta V<0$), so by Clausius–Clapeyron $dP/dT<0$."),
    item("State the F-value and meaning of: ice + water at 1 atm. What is the temperature?", [], "$P=2$, $F=1$; at fixed 1 atm $T$ is fixed at 0 °C (normal melting point).")])
dHf, dVf = 6010, -1.63e-6; sl = dHf / (273.15 * dVf); sl_atm = sl / 101325
dHv, dVv = 40700, 30.6e-3 - 1.9e-5; sl2 = dHv / (373.15 * dVv)
pset(c5, "Set 4 · Clausius–Clapeyron slopes (extension)", "Not asked numerically in past papers — included to make the sign argument concrete (Added for clarity).", [
    item("Ice melting at 273.15 K: $\\Delta H_{fus}=6010$ J mol$^{-1}$, $\\Delta V=-1.63\\times10^{-6}$ m$^3$ mol$^{-1}$. Find $dP/dT$.", ["$dP/dT=\\Delta H/(T\\Delta V)$."], f"$dP/dT={sci(sl)}$ Pa K$^{{-1}}\\approx{sl_atm:.0f}$ atm K$^{{-1}}$ — large and negative: very steep curve OC."),
    item("Water boiling at 373.15 K: $\\Delta H_{vap}=40700$ J mol$^{-1}$, $\\Delta V\\approx30.6\\times10^{-3}$ m$^3$ mol$^{-1}$. Find $dP/dT$ and compare with Set 4 Q1.", ["Same equation."], f"$dP/dT\\approx{sl2:.0f}$ Pa K$^{{-1}}$ ≈ {sl2/101325*1000:.1f}×10⁻³ atm K⁻¹ — positive and tiny by comparison (large ΔV), so OA is gentle."),
    item("Predict the sign of the slope for a substance that expands on melting.", [], "$\\Delta V>0\\Rightarrow dP/dT>0$: melting curve leans right (e.g. CO₂).")])
pset(c5, "Set 5 · Reduced phase rule and the Pb–Ag system", "", [
    item("Why do we use $F=C-P+1$ for Pb–Ag?", ["Condensed system (no gas), pressure fixed."], "Because $C=2$ would need 3-D at $F=C-P+2$; at constant pressure one variable is removed."),
    item("Find $F$ at the eutectic point of Pb–Ag and name the three phases present.", ["$C=2,P=3$."], "$F=2-3+1=0$ (invariant). Phases: solid Pb, solid Ag and liquid melt (303 °C, 2.6 % Ag)."),
    item("Find $F$ along the freezing-point curves AO and BO and in the one-phase liquid region.", [], "Curves: $P=2$ so $F=1$ (univariant); liquid region $P=1$ so $F=2$ (bivariant)."),
    item("Describe what happens when a melt of 10 % Ag in Pb is cooled slowly from 600 °C.", [], "Solid Pb is not the first to separate here — at 10 % Ag the composition lies on the Ag-rich side of O? **No:** 10 % Ag is above the 2.6 % eutectic, so Ag-rich... (see answer note)"),
    item("What is a eutectic mixture? Give two properties.", [], "A mixture of two components with the lowest freezing point of all compositions; it has a definite composition and a sharp melting point and solidifies at constant temperature (F = 0)."),
    item("How does the phase rule explain why the cooling curve of the eutectic composition shows a single halt?", [], "At the eutectic $F=0$: temperature stays fixed while all three phases coexist until solidification is complete.")])
# fix the awkward Pb–Ag cooling-path item
c5["sets"][-1]["items"][3] = item("A Pb–Ag melt contains 10 % Ag. It is cooled slowly from 700 °C. Describe the cooling path.",
    ["10 % Ag is richer in Ag than the eutectic (2.6 % Ag), so the melt cools until it meets the Ag freezing-point curve (O to the Ag melting point): solid Ag separates first and the melt becomes richer in Pb."],
    "Solid Ag separates first on the Ag-side curve; the melt composition slides down that curve to O (303 °C, 2.6 % Ag); there Pb and Ag crystallise together at constant temperature (halt, F = 0); below 303 °C: solid Pb + solid Ag. (A melt with less than 2.6 % Ag would separate Pb first.)")
pset(c5, "Set 6 · Cooling curves (thermal analysis)", "", [
    item("Sketch the cooling curve of a pure metal and explain the flat portion.", [], "Smooth fall, then a **halt** at the freezing point (solid and liquid coexist, $F=C-P+1=1-2+1=0$), then a fall again. (Fig. G24)"),
    item("Sketch the cooling curve of a binary mixture (not eutectic) and explain the break and the halt.", [], "Fall → **break** (change of slope) when the first solid appears (heat of crystallisation slows cooling, $F=1$) → fall → **halt** at the eutectic temperature ($F=0$) → fall."),
    item("How is a phase diagram constructed from cooling curves?", [], "Record cooling curves for several compositions; read the break and halt temperatures; plot them against composition and join the break points (liquidus) and the common halt temperature (eutectic line).")])

# ================================================================== CH6 COMPUTATIONAL
c6 = chapter("Q6", "Computational chemistry", "m3", "T13",
    "A recently added topic: one question in 2025 so far (definition + three applications). Expect short-answer questions.",
    [r"\text{Classical: MM, MD}\ \ |\ \ \text{Quantum: semi-empirical, ab initio, DFT}"], [])
past(c6, "J25b", 7, "(i) What is computational chemistry? Give any three applications of computational chemistry.",
     ["**Definition:** a set of techniques that solves chemical problems by simulating molecular, biological or materials systems to give reliable, accurate, atomic-level information, using theoretical chemistry built into efficient computer programs.", "**Three applications:** (1) predicting molecular properties — HOMO/LUMO and UV-Vis, IR, NMR spectra; (2) studying reaction mechanisms and kinetics; (3) designing new materials (conductivity, thermal stability); (also drug discovery by simulating drug–target interaction)."], "Definition + any three applications")
pset(c6, "Set 1 · Short answers", "Practise writing 2–3-mark answers in your own words.", [
    item("Define computational chemistry and name the first theoretical investigation.", [], "Techniques to simulate chemical systems and compute properties at the atomic level. First theoretical work: Heitler and London, 1927."),
    item("List four areas in which computational modelling is used.", [], "Molecular properties/spectra, reaction mechanism and kinetics, material design, drug discovery."),
    item("Differentiate classical and quantum methods of computational chemistry.", [], "Classical (molecular mechanics, molecular dynamics): Newtonian, atoms as spheres and bonds as springs, electrons ignored, very fast. Quantum (semi-empirical, ab initio, DFT): based on the Schrödinger equation, treat electrons explicitly, slower but more accurate."),
    item("What is molecular mechanics? Why is it fast?", [], "Model of a molecule as balls (atoms) joined by springs (bonds), energy from classical force fields; large molecules such as steroids can be optimised in seconds."),
    item("How does DFT differ from ab initio methods?", [], "DFT derives the electron density directly instead of a conventional many-electron wave function; faster than ab initio but slower than semi-empirical."),
    item("Rank MM, semi-empirical, DFT and ab initio by speed and accuracy.", [], "Speed: MM > semi-empirical > DFT > ab initio. Accuracy (generally): ab initio > DFT > semi-empirical > MM."),
    item("List three advantages of computational chemistry. Does it replace experiments?", [], "Easier, cheaper and safer than experiments. It does not replace experiments; it helps chemists design and develop desired products."),
    item("Write the steps of the electronic-structure determination of ethylene.", [], "1 Define geometry of C₂H₄; 2 select a basis set; 3 apply the method to get orbital energies and density; 4 solve the equations for the wave function / electron density; 5 visualise the orbitals (HOMO = π, LUMO = π*)."),
    item("Describe the bonding and HOMO/LUMO of ethylene.", [], "Each carbon is sp²: 2 C–H σ bonds + 1 C–C σ bond; one unhybridised p orbital per carbon forms the π bond. HOMO = π, LUMO = π*."),
    item("Give two scopes and two advantages of AI-enhanced computational chemistry.", [], "Scopes: accelerated molecular discovery; property prediction; reaction-pathway mapping; structure generation. Advantages: massive speed-up (hours/days → milliseconds once trained); large-scale screening; pattern recognition of structure–property relations.")])

# ================================================================== inventory
INVENTORY = [
    ("Rigid rotor: derive I = μr₀²", "Q1", 4, 1),
    ("Rigid rotor: bond length from first line (HCl, HI, HBr)", "Q1", 4, 6),
    ("Rigid rotor: I and spacing from B; level diagram J ≤ 5/6 and spectrum", "Q1", 4, 5),
    ("Rigid rotor: J→J+1 line; first line from I or r₀", "Q1", 2, 5),
    ("SHO: ν̄ and zero-point energy from k (HF ×2, NO, CO)", "Q2", 5, 6),
    ("SHO: k from ν̄ (CO ×3, HBr)", "Q2", 4, 5),
    ("SHO: why one line; CO₂ and HI IR activity", "Q2", 6, 4),
    ("Anharmonic: xₑ, ωₑ, overtone calculations", "Q3", 3, 12),
    ("Anharmonic: selection rule, B–O diagram, SHO failure", "Q3", 3, 4),
    ("Franck–Condon statement, three cases, spectra", "Q4", 5, 5),
    ("Continuum / B–O / Raman / Stokes / Beer–Lambert", "Q4", 5, 6),
    ("Phase rule: derivation", "Q5", 3, 5),
    ("Phase rule: count C, P, F", "Q5", 3, 12),
    ("Water diagram, F values, metastable curve, Clausius–Clapeyron", "Q5", 4, 9),
    ("Reduced phase rule and Pb–Ag diagram, cooling curves", "Q5", 4, 9),
    ("Computational chemistry: definition, applications, methods", "Q6", 1, 10),
    ("Mock Q1 papers (timed, new numbers)", "Q7", "—", 15)]

# ================================================================== HTML
e = html.escape
def qcard(n, q, tagline=""):
    return f'<div class="q"><div class="qn">{n}</div><div class="qb">{T(q)}{tagline}</div></div>'
def sol(steps, ans, flag=""):
    li = "".join(f"<li>{T(s)}</li>" for s in steps)
    return f'<div class="sol">{"<ol>"+li+"</ol>" if li else ""}<div class="fa"><span>Answer</span><p>{T(ans)}</p></div></div>'

def chapter_html(c, ci):
    cid = c["id"]
    recap = "".join(f'<div class="rf">{M(t, True)}</div>' for t in c["recap"])
    method = ""
    if c.get("method"): method = '<div class="method"><div class="mh">Method</div><ol>' + "".join(f"<li>{T(s)}</li>" for s in c["method"]) + "</ol></div>"
    figs = "".join(f'<div class="rfig">{fig_svg(f)}<div class="rcap">Fig. {f}</div></div>' for f in c["figs"])
    deriv = ""
    if c.get("derivation"):
        t, steps = c["derivation"]
        deriv = f'<div class="deriv"><div class="dh">{e(t)}</div><ol>' + "".join(f"<li>{T(s)}</li>" for s in steps) + "</ol></div>"
    # theory
    th = ""
    if c.get("theory"):
        th = '<h3 class="sub">Theory questions · model answers</h3>' + "".join(
            f'<div class="tq"><div class="tqq">{T(q)}</div><div class="tqa">{T(a)}</div></div>' for q, a in c["theory"])
    # past
    pastq = ""
    for i, p in enumerate(c["past"], 1):
        n = f"{cid}.{i}"
        tag = f'<div class="qmeta"><span class="chip">{e(p["tag"])}</span><span class="chip">{p["marks"]} marks</span>' + ('<span class="flag">Not on current slides</span>' if p["flag"] else "") + '</div>'
        pastq += f'<div class="qa">{qcard(n, p["q"], tag)}{sol(p["steps"], p["ans"])}</div>'
    # practice / new / quick sets: questions, then one answer key
    groups = [("B", c.get("gtitle_B", "Practice · exam-style variants of past questions"), c["sets"], "P"),
              ("C", "New question types · not yet asked, but examinable", c["new"], "N"),
              ("D", "Quick-fire concept checks and spot-the-error", c["quick"], "Z")]
    sets = ""; key = ""
    for letter, gtitle, gsets, code in groups:
        if not gsets: continue
        sets += f'<h3 class="sub">{letter} · {e(gtitle)}</h3>'
        for si, s_ in enumerate(gsets, 1):
            qs = "".join(f'<div class="qa pq">{qcard(f"{cid}.{code}{si}.{k}", it["q"])}</div>' for k, it in enumerate(s_["items"], 1))
            sets += f'<div class="pset"><h4>{e(s_["title"])}</h4>{"<p class=pnote>"+T(s_["note"])+"</p>" if s_["note"] else ""}{qs}</div>'
            ak = "".join(f'<div class="ak"><b>{cid}.{code}{si}.{k}</b><div>{sol(it["steps"], it["ans"])}</div></div>' for k, it in enumerate(s_["items"], 1))
            key += f'<div class="akset"><h4>{e(s_["title"])}</h4>{ak}</div>'
    npr = sum(len(x["items"]) for x in c["sets"]); nnew = sum(len(x["items"]) for x in c["new"]); nq = sum(len(x["items"]) for x in c["quick"])
    chips = "".join(f'<span class="tchip">{n} {l}</span>' for n, l in [(len(c["past"]), "solved past"), (npr, "exam-style practice"), (nnew, "new-type questions"), (nq, "quick-fire"), (len(c.get("theory", [])), "theory answers")] if n)
    pastsec = f'<h3 class="sub">A · Past ESA questions, fully solved</h3>{pastq}' if c["past"] else ""
    return f'''<section class="chap {c["cls"]}" id="{cid}">
<div class="mbanner {c["cls"]}"><div class="mnum">Chapter {ci} · Topics {e(c["topics"])}</div><h1>{e(c["title"])}</h1><div class="mchips">{chips}</div></div>
<p class="intro">{e(c["intro"])}</p>
<h3 class="sub">Recap · formulas you need</h3><div class="recap">{recap}</div>{method}{figs and f'<div class="rfigs">{figs}</div>'}{deriv}
{pastsec}{th}
{sets}
<h3 class="sub">E · Answer key for sections B, C and D</h3><div class="key">{key}</div></section>'''

def build():
    nchap = len(CH)
    tot_past = sum(len(c["past"]) for c in CH); tot_pr = sum(len(s["items"]) for c in CH for g in ("sets","new","quick") for s in c[g]); tot_th = sum(len(c.get("theory", [])) for c in CH)
    toc = "".join(f'<a class="trow" href="#{c["id"]}"><span class="tid {c["cls"]}">{c["id"]}</span><span class="tname">{e(c["title"])}</span><span class="tcount">{len(c["past"])} past · {sum(len(s["items"]) for g in ("sets","new","quick") for s in c[g])} practice</span></a>' for c in CH)
    inv = "".join(f"<tr><td>{e(a)}</td><td>{b}</td><td>{n}</td><td>{p}</td></tr>" for a, b, n, p in INVENTORY)
    cover = f'''<section class="cover"><div class="cbar"><i class="m1"></i><i class="m2"></i><i class="m3"></i></div>
<div class="ctop"><span class="course">UE26CY151A · Engineering Chemistry</span><span class="unit">Semester 1 · Unit 1</span></div>
<div class="cmain"><div class="cnum">06</div><div class="ckicker">Question bank</div><h1 class="ctitle">Every Unit 1 question — solved, then drilled</h1>
<p class="cblurb">All Unit 1 questions from the past ESA papers (Question 1 of each paper, 2023–2025), each worked out step by step, followed by several practice variants of every question type so you can see the same idea from different angles.</p></div>
<div class="cmods"><div class="cmod m1"><span>{tot_past}</span>solved past questions</div><div class="cmod m2"><span>{tot_pr}</span>practice, new-type and quick-fire questions with answers</div><div class="cmod m3"><span>{tot_th}</span>theory model answers</div></div>
<div class="clegend"><div><b>How to use</b> Read the recap → study the solved past questions → do B (exam-style), then C (new types) and D (quick-fire) without looking → check the answer key.</div>
<div><b>Papers</b> 12 distinct ESA papers (UE22, UE23, UE24 syllabi); duplicate papers removed.</div>
<div><b>Flags</b> <span class="flag">Not on current slides</span> marks topics from older syllabi (Fe–C, CO₂ diagram, Beer–Lambert).</div></div>
<div class="cfoot">Numerical answers are computed by script from each question's own constants, so small differences from a printed key come from rounding of constants. · {datetime.date.today():%d %B %Y}</div></section>'''
    toc_html = f'''<nav id="toc" class="toc"><h2>Contents</h2><div class="tmod">{toc}</div>
<h3 class="sub">What the examiners ask — question types</h3><div class="tbl"><table><thead><tr><th>Question type</th><th>Chapter</th><th>Times asked</th><th>Practice variants here</th></tr></thead><tbody>{inv}</tbody></table></div>
<div class="callout"><b>Not Unit 1 any more.</b> Conductometric titration, colorimetry and α-Al₂O₃ synthesis appear in older Q1s but belong to other units/labs; they are left out. Papers 1, 4 and 6 are the same paper. Paper “Jan · UE23A Set 2” has Q1.b as an image, which was read directly.</div></nav>'''
    body = cover + toc_html + "".join(chapter_html(c, i) for i, c in enumerate(CH, 1))
    css = '<link rel="stylesheet" href="assets/katex/katex.min.css"><link rel="stylesheet" href="assets/study.css"><link rel="stylesheet" href="assets/qbank.css">'
    doc = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Question Bank · Engg. Chemistry Unit 1</title>{css}</head><body class="doc-06">{body}</body></html>'
    open(OUT + "06_question_bank.html", "w").write(render(doc))
    print(f"question bank: {tot_past} past, {tot_pr} practice, {tot_th} theory")

if __name__ == "__main__":
    build()
