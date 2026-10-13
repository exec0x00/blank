"""New (not-yet-asked) question types, quick-fire checks, spot-the-error items and mock papers.
Run: python3 build/qbank_new.py   -> rebuilds output/06_question_bank.html"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import qbank as Q
from qbank import item, pset, sci, sc, mu_amu, rot_I, rot_B_from_I, r0_from_line, sho_nu, sho_k, anh_from, AMU, H0, C0, PI

c1, c2, c3, c4, c5, c6 = Q.CH
KB_CM = 0.695                      # kT/hc in cm^-1 per kelvin
EV_CM = 8065.54                    # 1 eV in cm^-1
NAV = 6.022e23
def us(x, d=3):
    """plain-text scientific notation with unicode superscripts"""
    if x == 0: return "0"
    e = int(math.floor(math.log10(abs(x)))); m = x / 10 ** e
    sup = str(e).translate(str.maketrans("-0123456789", "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"))
    return f"{m:.{d-1}f}×10{sup}"
def tf(stmt, truth, why): return item("True or False: " + stmt, [], ("**True** — " if truth else "**False** — ") + why)
def err(wrong, why): return item("Spot the error: " + wrong, [], why)

# =====================================================================  CH1  new types
def N1():
    its = []
    for (n, a, b, r0) in [("HCl", 1.008, 35.45, 1.275), ("HF", 1.008, 18.998, 0.917), ("CO", 12.0, 15.995, 1.128), ("NaCl", 22.99, 35.45, 2.36), ("LiH", 6.94, 1.008, 1.595), ("HBr", 1.008, 79.9, 1.414)]:
        r1 = b * r0 / (a + b); r2 = a * r0 / (a + b); I = a * AMU * (r1 * 1e-10) ** 2 + b * AMU * (r2 * 1e-10) ** 2; mu = mu_amu(a, b) * AMU
        its.append(item(f"{n}: $m_1={a}$, $m_2={b}$ amu, bond length {r0} Å. Find the distances of each atom from the centre of mass, then $I=m_1r_1^2+m_2r_2^2$ and verify $I=\\mu r_0^2$.",
            ["$r_1=m_2r_0/(m_1+m_2)$, $r_2=m_1r_0/(m_1+m_2)$ — the lighter atom is further from C."],
            f"$r_1={r1:.4f}$ Å, $r_2={r2:.4f}$ Å; $I={us(I)}$ kg m²; $\\mu r_0^2={us(mu*(r0*1e-10)**2)}$ kg m² ✔ (same)"))
    return pset(c1, "N1 · Centre of mass and moment of inertia from the masses", "Tests the derivation numerically: the two routes to I must agree.", its) and None
def N2():
    its = []
    for (n, B) in [("HCl", 10.59), ("CO", 1.93), ("HF", 20.9), ("HBr", 8.46), ("HI", 6.51)]:
        nu1 = 2 * B; f = C0 * nu1; lam = 1 / nu1 * 10; E = H0 * C0 * nu1
        its.append(item(f"{n} has $B={B}$ cm$^{{-1}}$. For the $J=0\\to1$ absorption find: the frequency (GHz), wavelength (mm), photon energy (J and kJ mol$^{{-1}}$), and verify that it lies in the microwave region (1 cm – 100 µm).",
            ["Line $=2B$ cm$^{-1}$; $\\nu=c\\bar\\nu$; $\\lambda=1/\\bar\\nu$; $E=hc\\bar\\nu$; $E\\times N_A$."],
            f"Line {nu1:.2f} cm⁻¹; ν = {f/1e9:.0f} GHz; λ = {lam:.3f} mm ({'microwave ✔' if 0.01<lam<10 else 'check'}); E = {us(E)} J = {E*NAV/1000:.3f} kJ mol⁻¹"))
    pset(c1, "N2 · Frequency, wavelength and energy of rotational lines", "Links rotational spectroscopy to the EM-spectrum table: lines are in the microwave region.", its)
def N3():
    its = []
    for (B, J, mol) in [(10.35, 3, "HCl"), (1.93, 6, "CO"), (20.9, 2, "HF"), (8.46, 5, "HBr")]:
        l1, l2 = 2 * B * (J + 1), 2 * B * (J + 2)
        its.append(item(f"Two adjacent lines in the rotational spectrum of {mol} are at {l1:.2f} and {l2:.2f} cm$^{{-1}}$. Find $B$, and the $J\\to J+1$ transitions that produced them.",
            ["Adjacent gap $=2B$; then line $=2B(J+1)$ gives $J+1$."], f"$2B={l2-l1:.2f}\\Rightarrow B={B}$ cm$^{{-1}}$; lines are $J={J}\\to{J+1}$ and $J={J+1}\\to{J+2}$"))
    for (B, J) in [(5.0, 7), (2.5, 4)]:
        l = 2 * B * (J + 1)
        its.append(item(f"A single line is seen at {l:g} cm$^{{-1}}$ and the next lower line is 10 cm$^{{-1}}$ away… identify $B$ and $J$ for $B$ a multiple of 0.5.", ["Gap $=2B$."], f"This single-line puzzle only works with the gap: gap 10 ⇒ B = 5. (If gap is {2*B:g} then B = {B:g}, J+1 = {l/(2*B):g}.)")) if False else None
    pset(c1, "N3 · Identify J and B from two adjacent lines", "Reverse engineering a spectrum. The gap is always 2B; the line number is position ÷ gap.", its)
def N4():
    its = []
    for (n, a1, a2, b, B1, lab1, lab2) in [("CO", 12.0, 13.003, 15.995, 1.9313, "¹²CO", "¹³CO"), ("HCl", 1.008, 1.008, 35.45, 10.59, "H³⁵Cl", "H³⁷Cl"), ("HCl", 1.008, 2.014, 35.45, 10.59, "HCl", "DCl"), ("HBr", 1.008, 2.014, 79.9, 8.46, "HBr", "DBr")]:
        if lab2 == "H³⁷Cl": m2 = (1.008, 36.966); m1 = (1.008, 34.969)
        elif lab1 == "¹²CO": m1 = (12.0, 15.995); m2 = (13.003, 15.995)
        else: m1 = (a1, b); m2 = (a2, b)
        mu1, mu2 = mu_amu(*m1), mu_amu(*m2); B2 = B1 * mu1 / mu2
        its.append(item(f"{lab1} has $B={B1}$ cm$^{{-1}}$. Predict $B$ and the first rotational line of {lab2} (same bond length). Is the line higher or lower, and by how much?",
            ["Same electronic structure ⇒ same $r_0$ ⇒ $I=\\mu r_0^2$, so $B\\propto1/\\mu$: $B_2=B_1\\,\\mu_1/\\mu_2$."],
            f"μ₁ = {mu1:.4f}, μ₂ = {mu2:.4f} amu; B₂ = {B2:.4f} cm⁻¹; first line {2*B2:.3f} cm⁻¹ — {'lower' if B2<B1 else 'higher'} by {abs(2*B1-2*B2):.3f} cm⁻¹"))
    pset(c1, "N4 · Isotopic substitution", "A classic experimental use: isotopic shifts confirm that a spectrum belongs to a given molecule.", its)
def N5():
    its = []
    for (X, mX, line, r0) in [("Cl", 35.45, 21.18, 1.275), ("Br", 79.9, 17.0, 1.414), ("F", 18.998, 41.9, 0.917), ("I", 126.9, 13.022, 1.617)]:
        B, I, mu, r = r0_from_line(line, 1.008, mX)
        # from first line + r0 -> mu = I / r0^2 -> mX
        mu_amu_ = I / (r0 * 1e-10) ** 2 / AMU; mx = mu_amu_ * 1.008 / (1.008 - mu_amu_)
        its.append(item(f"A hydrogen halide HX has its first rotational line at {line} cm$^{{-1}}$ and bond length {r0} Å. Find $I$, $\\mu$ and the atomic mass of X, and identify X. (H = 1.008 amu)",
            ["$B=\\text{line}/2$; $I=h/8\\pi^2cB$; $\\mu=I/r_0^2$; then $\\mu=\\dfrac{m_Hm_X}{m_H+m_X}\\Rightarrow m_X=\\dfrac{\\mu m_H}{m_H-\\mu}$."],
            f"$I={us(I)}$ kg m²; μ = {mu_amu_:.4f} amu; $m_X≈{mx:.1f}$ amu → X = {X}"))
    pset(c1, "N5 · Find the unknown atom", "Run the bond-length method backwards: from I and r₀ to μ and then to a mass.", its)
def N6():
    its = []
    for (n, B, T) in [("HCl", 10.59, 300), ("CO", 1.93, 300), ("HF", 20.9, 300), ("CO", 1.93, 500), ("HI", 6.51, 298)]:
        Jm = math.sqrt(KB_CM * T / (2 * B)) - 0.5
        its.append(item(f"(Extension) The most intense rotational line has $J_{{max}}=\\sqrt{{kT/2hcB}}-\\tfrac12$. Find $J_{{max}}$ for {n} ($B={B}$ cm$^{{-1}}$) at {T} K ($kT/hc=0.695\\,T$ cm$^{{-1}}$) and the wavenumber of the strongest line.",
            ["Population ∝ $(2J+1)e^{-\\varepsilon_J/kT}$; set its derivative to zero."], f"$J_{{max}}={Jm:.2f}$ → nearest level {round(Jm)}; strongest line $\\approx2B(J+1)={2*B*(round(Jm)+1):.1f}$ cm⁻¹"))
    pset(c1, "N6 · Which line is the strongest? (extension)", "Beyond the slides but explains why the spectrum's intensity rises then falls — a favourite 'why' question.", its)
def N7():
    its = []
    for (n, B) in [("HCl", 10.59), ("CO", 1.93), ("HF", 20.9)]:
        its.append(item(f"For {n} ($B={B}$ cm$^{{-1}}$) tabulate $\\varepsilon_J$ for $J=0$ to 4 and the allowed absorption lines $J\\to J+1$. Which gaps are equal?",
            ["$\\varepsilon_J=BJ(J+1)$; line $=\\varepsilon_{J+1}-\\varepsilon_J=2B(J+1)$."],
            "ε: " + ", ".join(f"J={j}: {B*j*(j+1):.2f}" for j in range(5)) + " cm⁻¹. Lines: " + ", ".join(f"{j}→{j+1}: {2*B*(j+1):.2f}" for j in range(4)) + ". Adjacent lines are equally spaced (2B); adjacent levels are not."))
    kT = KB_CM * 298
    its.append(item("At 298 K, $kT/hc\\approx207$ cm$^{-1}$. For HCl, how does the first rotational line (21.18 cm$^{-1}$) compare with $kT$? What does this say about populations?", [], "21.18 ≪ 207: many rotational levels are thermally populated at room temperature, so the spectrum shows many lines starting from J > 0 (as the slide notes)."))
    pset(c1, "N7 · Level tables and thermal energy", "", its)
def N8():
    pset(c1, "N8 · Selection rules and active molecules", "More variants of 'which is microwave active, and why?'", [
        item("Classify as microwave active/inactive and explain: N₂, NO, HBr, CS₂, OCS, SO₂, CH₄, H₂O, HD.", [], "Active (permanent dipole): NO, HBr, OCS, SO₂, H₂O, HD (tiny dipole, weak). Inactive: N₂, CS₂ (linear symmetric), CH₄ (tetrahedral, zero dipole)."),
        item("Why can a molecule with no permanent dipole still be IR-active but never microwave-active?", [], "IR needs a dipole change during vibration, which symmetric molecules can still show; rotation of a non-polar molecule produces no oscillating dipole."),
        item("If $B$ is halved, what happens to $I$, to the first line and to the line spacing?", [], "$I\\propto1/B$ doubles; the first line and the spacing both halve ($=2B$)."),
        item("If the bond length is doubled, by what factor does $B$ change?", ["$B\\propto1/I\\propto1/r_0^2$."], "B falls by a factor of 4; the spectrum compresses by 4."),
        item("Why is the rigid-rotor model an approximation? What really happens at high $J$?", [], "Bonds stretch under centrifugal force at high J, so $I$ increases and levels lie slightly below $BJ(J+1)$ (non-rigid rotor). Lines then converge slightly."),
        item("How many rotational lines lie between 0 and 200 cm⁻¹ for HI ($B=6.51$ cm$^{-1}$)?", ["Lines at $13.02\\,n$; $n\\le 200/13.02=15.4$."], "15 lines.")])
for f in (N1, N2, N3, N4, N5, N6, N7, N8): f()
# move last 'pset' calls into 'new' list: re-route
c1["new"] = c1["sets"][5:]; c1["sets"] = c1["sets"][:5]

# =====================================================================  CH1 quick
c1["quick"].append(dict(title="Z1 · True or false", note="Answer first; the key explains why.", items=[
    tf("The first line in a rigid-rotor spectrum appears at $B$.", False, "it appears at $2B$ ($J=0\\to1$)."),
    tf("Adjacent lines in the rotational spectrum are separated by $2B$.", True, "$2B(J+2)-2B(J+1)=2B$."),
    tf("A molecule must have a permanent dipole to absorb microwave radiation.", True, "gross selection rule."),
    tf("$J$ can start at 1.", False, "$J=0,1,2\\ldots$; $\\varepsilon_0=0$."),
    tf("CO₂ shows a pure rotational spectrum.", False, "linear and symmetric: no permanent dipole."),
    tf("$I=\\mu r_0^2$ where $\\mu$ is reduced mass.", True, "result of the derivation."),
    tf("Increasing the reduced mass shifts rotational lines to higher wavenumber.", False, "larger μ ⇒ larger I ⇒ smaller B ⇒ lines move lower."),
    tf("The energy gap between levels $J$ and $J+1$ is $2B(J+1)$.", True, "$BJ(J+1)\\to B(J+1)(J+2)$ gives $2B(J+1)$."),
    tf("ΔJ = ±2 is the selection rule for the rigid rotor.", False, "ΔJ = ±1 (±2 is for rotational Raman)."),
    tf("The most intense line is always the first line.", False, "intensity peaks at $J_{max}$ (thermal population × degeneracy)."),
    tf("H₂ and HD both show microwave spectra.", False, "H₂ has no dipole; HD has a very small one, so only HD is (weakly) active."),
    tf("Rotational energy levels get closer together as $J$ increases.", False, "gaps $2B(J+1)$ increase with $J$.")]))
c1["quick"].append(dict(title="Z2 · Spot the error", note="Each worked 'solution' contains one mistake.", items=[
    err("HCl first line = 21.18 cm⁻¹, so B = 21.18 cm⁻¹ and I = h/8π²cB.", "B = 21.18/2 = 10.59 cm⁻¹; the first line is 2B."),
    err("I = h/(8π²cB) = 6.63×10⁻³⁴/(8π²·3×10⁸·10.59) = 2.64×10⁻⁴⁷ (c in m s⁻¹, B in cm⁻¹).", "c and B must use matching length units: use c = 3×10¹⁰ cm s⁻¹ with B in cm⁻¹ (or c in m s⁻¹ with B in m⁻¹)."),
    err("μ of HCl = (1.008×35.45)/(1.008+35.45) = 0.98 kg, so r₀ = √(I/μ).", "0.98 is in amu; multiply by 1.66×10⁻²⁷ to get kg (1.63×10⁻²⁷ kg)."),
    err("Rotational levels J = 0 to 3 for B = 10: 10, 20, 30, 40 cm⁻¹.", "ε_J = BJ(J+1): 0, 20, 60, 120 cm⁻¹."),
    err("The line J = 20→21 is at 20 × 2B.", "It is 2B(J+1) = 21 × 2B = 21 × first line."),
    err("Bond length of HCl is 1.27 m.", "r₀ = 1.27×10⁻¹⁰ m = 1.27 Å — check units at the end.")]))

# =====================================================================  CH2 new types
def M1():
    its = []
    for (n, nu_) in [("HCl", 2886), ("CO", 2143), ("HF", 3959), ("NO", 1876), ("HI", 2230), ("O–H stretch", 3400)]:
        lam = 1e4 / nu_; f = C0 * nu_; E = H0 * f
        its.append(item(f"A fundamental IR band of {n} is at {nu_} cm$^{{-1}}$. Find the wavelength (µm), frequency (Hz), photon energy (J, eV and kJ mol$^{{-1}}$) and confirm the region.",
            ["$\\lambda(\\mu m)=10^4/\\bar\\nu$; $\\nu=c\\bar\\nu$; $E=h\\nu$."], f"λ = {lam:.3f} µm (IR: 1–100 µm ✔); ν = {us(f)} Hz; E = {us(E)} J = {nu_/EV_CM:.3f} eV = {E*NAV/1000:.1f} kJ mol⁻¹"))
    pset(c2, "N1 · Convert IR absorptions: λ, ν, E", "The conversions that link the table of regions to calculations.", its)
def M2():
    its = []
    for (n, k_, a, b) in [("HCl", 516, 1.008, 35.45), ("HF", 966, 1.008, 18.998), ("CO", 1857, 12.0, 15.995), ("NO", 1595, 14.0, 16.0), ("HBr", 412, 1.008, 79.9)]:
        nu_ = sho_nu(k_, a, b); z = nu_ / 2; J = z * H0 * C0
        its.append(item(f"{n} ($k={k_}$ N m$^{{-1}}$): express the zero-point energy in joules, eV and kJ mol$^{{-1}}$, and find the energy needed to excite $v=0\\to v=1$ in each unit.",
            ["First $\\bar\\nu$; ZPE $=\\tfrac12\\bar\\nu$; $E=hc\\bar\\nu$; 1 eV = 8065.5 cm⁻¹."], f"ν̄ = {nu_:.0f} cm⁻¹; ZPE = {us(J)} J = {z/EV_CM:.3f} eV = {J*NAV/1000:.2f} kJ mol⁻¹; 0→1: {us(2*J)} J = {nu_/EV_CM:.3f} eV = {2*J*NAV/1000:.2f} kJ mol⁻¹"))
    pset(c2, "N2 · Zero-point energy in J, eV and kJ/mol", "Zero-point energy is the most-asked sub-part in Unit 1; this set drills every unit it can appear in.", its)
def M3():
    its = []
    for (lab, a1, b1, a2, b2, nu1) in [("HCl → DCl", 1.008, 35.45, 2.014, 35.45, 2886), ("¹²CO → ¹³CO", 12.0, 15.995, 13.003, 15.995, 2143), ("H⁷⁹Br → D⁷⁹Br", 1.008, 78.918, 2.014, 78.918, 2559), ("¹⁴N¹⁶O → ¹⁵N¹⁶O", 14.003, 15.995, 15.000, 15.995, 1876), ("HF → DF", 1.008, 18.998, 2.014, 18.998, 3959)]:
        m1, m2 = mu_amu(a1, b1), mu_amu(a2, b2); nu2 = nu1 * math.sqrt(m1 / m2)
        its.append(item(f"{lab}: the original band is at {nu1} cm$^{{-1}}$. Assuming the same force constant, predict the new band and the ZPE of both.",
            ["$\\bar\\nu\\propto1/\\sqrt\\mu$, so $\\bar\\nu_2=\\bar\\nu_1\\sqrt{\\mu_1/\\mu_2}$."], f"μ₁ = {m1:.4f}, μ₂ = {m2:.4f} amu; ν̄₂ = {nu2:.0f} cm⁻¹ (shift {nu1-nu2:.0f} lower); ZPE {nu1/2:.0f} → {nu2/2:.0f} cm⁻¹"))
    pset(c2, "N3 · Isotope effect on the IR band", "Same force constant, heavier atom, lower frequency.", its)
def M4():
    mol = [("HCl", 2, True, "1 (stretch)", "active"), ("N₂", 2, True, "1 (stretch)", "inactive: no dipole change"), ("CO₂", 3, True, "4 (sym. stretch, asym. stretch, 2 bends)", "asym. stretch and bend active; sym. stretch inactive"),
           ("H₂O", 3, False, "3 (sym. stretch, asym. stretch, bend)", "all three active"), ("SO₂", 3, False, "3", "all three active"), ("NH₃", 4, False, "6", "all active"), ("CH₄", 5, False, "9", "only the asymmetric stretch and bend are IR-active")]
    its = []
    for (n, N, lin, modes, act) in mol:
        k = 3 * N - (5 if lin else 6)
        its.append(item(f"(Extension) How many fundamental vibrational modes does {n} have ($3N-5$ for linear, $3N-6$ for non-linear) and which are IR-active?", [f"$N={N}$, {'linear' if lin else 'non-linear'}: $3N-{5 if lin else 6}={k}$."], f"{k} modes ({modes}); IR: {act}."))
    pset(c2, "N4 · Number of vibrational modes and IR activity (extension)", "Beyond diatomics: the same dipole-change test applied to polyatomics. Added for clarity — the slides treat CO₂ only.", its)
def M5():
    its = []
    for (n1, nu1, a1, b1, n2, nu2, a2, b2) in [("HF", 3959, 1.008, 18.998, "HCl", 2886, 1.008, 35.45), ("CO", 2143, 12.0, 15.995, "NO", 1876, 14.0, 16.0), ("HCl", 2886, 1.008, 35.45, "HBr", 2559, 1.008, 79.9), ("HBr", 2559, 1.008, 79.9, "HI", 2230, 1.008, 126.9)]:
        k1, k2 = sho_k(nu1, a1, b1), sho_k(nu2, a2, b2)
        its.append(item(f"{n1} absorbs at {nu1} cm$^{{-1}}$ and {n2} at {nu2} cm$^{{-1}}$. Which has the stronger bond? Calculate both force constants and their ratio.", ["$k=4\\pi^2c^2\\bar\\nu^2\\mu$ — note a higher $\\bar\\nu$ does not automatically mean a higher $k$ (μ matters)."],
            f"k({n1}) = {k1:.0f} N m⁻¹; k({n2}) = {k2:.0f} N m⁻¹; ratio = {k1/k2:.2f} → {n1 if k1>k2 else n2} has the stronger bond."))
    pset(c2, "N5 · Compare bond strengths from two spectra", "", its)
def M6():
    its = []
    for (n, k_, a, b, dx) in [("HCl", 516, 1.008, 35.45, 0.1), ("HF", 966, 1.008, 18.998, 0.05), ("CO", 1857, 12.0, 15.995, 0.05)]:
        F = k_ * dx * 1e-10; Ep = 0.5 * k_ * (dx * 1e-10) ** 2; z = sho_nu(k_, a, b) / 2 * H0 * C0
        its.append(item(f"{n} has $k={k_}$ N m$^{{-1}}$. Using Hooke's law find the restoring force and potential energy when the bond is stretched by {dx} Å, and compare with the zero-point energy.",
            ["$F=-kx$; $PE=\\tfrac12kx^2$."], f"|F| = {us(F)} N; PE = {us(Ep)} J; ZPE = {us(z)} J (stretch energy is {Ep/z:.2f} × ZPE)"))
    pset(c2, "N6 · Hooke's law numerically", "", its)
def M7():
    its = []
    for (a, b, n, nu_, k_) in [(1.008, None, "HX", 2886, 516), (1.008, None, "HY", 2559, 412), (1.008, None, "HZ", 4138, 966)]:
        mu = k_ / (4 * PI ** 2 * C0 ** 2 * nu_ ** 2) / AMU; mx = mu * a / (a - mu)
        its.append(item(f"A diatomic HX has a fundamental at {nu_} cm$^{{-1}}$ and $k={k_}$ N m$^{{-1}}$. Find $\\mu$ and the atomic mass of X (H = 1.008 amu).", ["$\\mu=k/(4\\pi^2c^2\\bar\\nu^2)$ then $m_X=\\mu m_H/(m_H-\\mu)$."], f"μ = {mu:.4f} amu; m_X ≈ {mx:.1f} amu"))
    its.append(item("The ratio of $\\bar\\nu$ for HCl to $\\bar\\nu$ for HBr (same $k$) equals…?", ["$\\sqrt{\\mu_{HBr}/\\mu_{HCl}}$."], f"{math.sqrt(mu_amu(1.008,79.9)/mu_amu(1.008,35.45)):.4f} (≈ 1.0 — both μ ≈ 1 amu because H is light)."))
    pset(c2, "N7 · Find the unknown atom from IR data", "", its)
for f in (M1, M2, M3, M4, M5, M6, M7): f()
c2["new"] = c2["sets"][4:]; c2["sets"] = c2["sets"][:4]
c2["quick"].append(dict(title="Z1 · True or false", note="", items=[
    tf("The SHO zero-point energy is zero.", False, "$\\varepsilon_0=\\tfrac12\\bar\\nu_{osc}$."),
    tf("IR absorption requires a permanent dipole.", False, "it requires a change in dipole during vibration."),
    tf("Doubling the force constant doubles the wavenumber.", False, "$\\bar\\nu\\propto\\sqrt{k}$, so it rises by √2."),
    tf("The energy levels of the SHO are equally spaced.", True, "spacing $=\\bar\\nu_{osc}$."),
    tf("For SHO, $\\Delta v=\\pm2$ transitions are allowed.", False, "only $\\Delta v=\\pm1$."),
    tf("Replacing H by D lowers the vibrational frequency.", True, "μ increases ⇒ ν̄ decreases by about √2."),
    tf("Homonuclear diatomics are IR-active.", False, "no dipole change on stretching."),
    tf("CO₂'s symmetric stretch is IR-inactive.", True, "no change in dipole moment."),
    tf("A stiffer bond has a larger force constant and a higher stretching frequency (same μ).", True, "$\\bar\\nu\\propto\\sqrt{k/\\mu}$."),
    tf("ZPE can be removed by cooling to 0 K.", False, "it is the energy of the lowest quantum state itself."),
    tf("The vibrational spectrum of the SHO has one line for all molecules of a given type.", True, "equal spacing and Δv = ±1."),
    tf("In an exam, $\\mu$ must be converted to kg before using $\\bar\\nu=(1/2\\pi c)\\sqrt{k/\\mu}$ with $k$ in N m$^{-1}$.", True, "N = kg m s⁻²; units must be SI.")]))
c2["quick"].append(dict(title="Z2 · Spot the error", note="", items=[
    err("ZPE of HF = ν̄ = 4145 cm⁻¹.", "ZPE = ½ν̄ ≈ 2073 cm⁻¹."),
    err("μ = m₁m₂/(m₁+m₂) = 0.95 kg, used directly in √(k/μ).", "0.95 is in amu; convert to kg (1.58×10⁻²⁷ kg)."),
    err("ν̄ = √(k/μ)/(2πc) with c = 3×10⁸ cm s⁻¹.", "c = 3×10¹⁰ cm s⁻¹ (or 3×10⁸ m s⁻¹ and then convert m⁻¹ → cm⁻¹ by ÷100)."),
    err("The v = 3 level of the SHO is at 3ν̄.", "ε₃ = (3 + ½)ν̄ = 3.5ν̄."),
    err("Only one line appears because Δv = ±2 is forbidden and overtones are weak.", "The reason is equal level spacing with Δv = ±1; overtones are absent in SHO (they appear only in the anharmonic model)."),
    err("CO₂ is IR-inactive because it has no permanent dipole.", "IR needs a dipole change; asymmetric stretch and bending change it, so CO₂ is IR-active.")]))

# =====================================================================  CH3 new
def A1():
    its = []
    for (n, we, x) in [("CO", 2169.8, 0.00612), ("HCl", 2990.9, 0.01765), ("HF", 4138.3, 0.02172), ("NO", 1904.2, 0.00739)]:
        f = we * (1 - 2 * x); t = 3 * we * (1 - 4 * x); xe_ = (f - t / 3) / (2 * (f - t / 3) * 0 + (3 * f - 2 * t) * 0 + 1) if False else None
        # f = we(1-2x); t/3 = we(1-4x)  ->  we x = (f - t/3)/2 ; we = f + 2 we x
        wex = (f - t / 3) / 2; we2 = f + 2 * wex; x2 = wex / we2
        its.append(item(f"{n}: the fundamental is at {f:.1f} cm$^{{-1}}$ and the **second overtone** at {t:.1f} cm$^{{-1}}$. Find $x_e$ and $\\bar\\omega_e$.",
            ["Fundamental $\\bar\\omega_e(1-2x_e)$; second overtone $3\\bar\\omega_e(1-4x_e)$ ⇒ $t/3=\\bar\\omega_e(1-4x_e)$. Subtract: $2\\bar\\omega_ex_e=f-t/3$."], f"ω̄ₑxₑ = {wex:.2f}; ω̄ₑ = {we2:.1f} cm⁻¹; xₑ = {x2:.5f}"))
    for (n, we, x) in [("CO", 2169.8, 0.00612), ("HCl", 2990.9, 0.01765)]:
        o1 = 2 * we * (1 - 3 * x); o2 = 3 * we * (1 - 4 * x); w = (o2 / 3 - o1 / 2); wex = w / 1 ; # o1/2=we(1-3x), o2/3=we(1-4x) -> we x = o1/2 - o2/3
        wex = o1 / 2 - o2 / 3; we2 = o1 / 2 + 3 * wex; x2 = wex / we2
        its.append(item(f"{n}: first overtone {o1:.1f} cm$^{{-1}}$ and second overtone {o2:.1f} cm$^{{-1}}$. Find $x_e$ and $\\bar\\omega_e$.", ["$o_1/2=\\bar\\omega_e(1-3x_e)$, $o_2/3=\\bar\\omega_e(1-4x_e)$; subtract."], f"ω̄ₑxₑ = {wex:.2f}; ω̄ₑ = {we2:.1f}; xₑ = {x2:.5f}"))
    pset(c3, "N1 · xₑ and ωₑ from other pairs of bands", "Past papers used fundamental + first overtone. Any two bands work — set up two equations.", its)
def A2():
    its = []
    for (n, we, x) in [("CO", 2169.8, 0.00612), ("HCl", 2990.9, 0.01765), ("HF", 4138.3, 0.02172)]:
        rows = [];
        for v in range(6):
            e = (v + .5) * we - (v + .5) ** 2 * we * x; sh = (v + .5) * we; rows.append((v, e, sh))
        its.append(item(f"{n}: $\\bar\\omega_e={we}$ cm$^{{-1}}$, $x_e={x}$. Tabulate $\\varepsilon_v$ for $v=0$–5 (anharmonic) and compare with the SHO values $(v+\\tfrac12)\\bar\\omega_e$. Give the spacing $\\varepsilon_{{v+1}}-\\varepsilon_v$.",
            ["$\\varepsilon_v=(v+\\tfrac12)\\bar\\omega_e-(v+\\tfrac12)^2\\bar\\omega_ex_e$."],
            "; ".join(f"v={v}: {e:.1f} (SHO {sh:.1f})" for v, e, sh in rows) + ". Spacings: " + ", ".join(f"{rows[v+1][1]-rows[v][1]:.1f}" for v in range(5)) + " cm⁻¹ — decreasing."))
    pset(c3, "N2 · Anharmonic ladder vs SHO ladder", "See levels converge: the spacing falls by $2\\bar\\omega_e x_e$ at each step.", its)
def A3():
    its = []
    for (n, we, x) in [("CO", 2169.8, 0.00612), ("HCl", 2990.9, 0.01765), ("HF", 4138.3, 0.02172), ("NO", 1904.2, 0.00739)]:
        De = we / (4 * x); z = 0.5 * we * (1 - 0.5 * x); D0 = De - z; vmax = 1 / (2 * x) - 0.5
        its.append(item(f"(Extension) For the Morse oscillator $D_e\\approx\\bar\\omega_e/4x_e$. {n}: $\\bar\\omega_e={we}$ cm$^{{-1}}$, $x_e={x}$. Find $D_e$ (cm$^{{-1}}$, eV, kJ mol$^{{-1}}$), the spectroscopic dissociation energy $D_0=D_e-\\varepsilon_0$ and the highest bound level $v_{{max}}\\approx1/2x_e-\\tfrac12$.",
            ["$\\varepsilon_0=\\tfrac12\\bar\\omega_e(1-\\tfrac12x_e)$; 1 cm⁻¹ = 0.01196 kJ mol⁻¹."], f"D_e ≈ {De:.0f} cm⁻¹ = {De/EV_CM:.2f} eV = {De*0.011963:.0f} kJ mol⁻¹; ε₀ = {z:.0f}; D₀ ≈ {D0:.0f} cm⁻¹ ({D0*0.011963:.0f} kJ mol⁻¹); v_max ≈ {vmax:.0f}"))
    pset(c3, "N3 · Dissociation energy from ωₑ and xₑ (extension)", "Shows what 'the molecule dissociates when stretched' means quantitatively. Added for clarity — not on the slides.", its)
def A4():
    its = []
    for (n, f, x) in [("CO", 2143, 0.0061), ("HCl", 2886, 0.0177), ("HF", 3959, 0.0217), ("NO", 1876, 0.0074)]:
        we = f / (1 - 2 * x); hot = we * (1 - 4 * x)
        its.append(item(f"{n}: fundamental {f} cm$^{{-1}}$, $x_e={x}$. Find the hot-band ($1\\to2$) position, its shift relative to the fundamental, and state on which side of the fundamental it lies.", ["$\\bar\\omega_e=f/(1-2x_e)$; hot $=\\bar\\omega_e(1-4x_e)$; shift $=2\\bar\\omega_ex_e$."], f"ω̄ₑ = {we:.1f}; hot band = {hot:.1f} cm⁻¹, i.e. {f-hot:.1f} cm⁻¹ below the fundamental (left side)."))
    pset(c3, "N4 · Hot bands", "", its)
def A5():
    its = []
    for r in (1.95, 1.90, 1.98, 1.92):
        x = (2 - r) / (6 - 2 * r)
        its.append(item(f"The ratio (first overtone)/(fundamental) for a diatomic is {r}. Find $x_e$. Explain why the ratio is less than 2.", ["$r=\\dfrac{2(1-3x_e)}{(1-2x_e)}\\Rightarrow x_e=\\dfrac{2-r}{6-2r}$."], f"xₑ = {x:.5f}. The ratio is < 2 because the levels converge (anharmonicity): the 0→2 gap is smaller than twice the 0→1 gap."))
    for (n, we, x, v) in [("CO", 2169.8, 0.00612, 3), ("HCl", 2990.9, 0.01765, 3), ("HF", 4138.3, 0.02172, 4)]:
        a = (v + .5) * we - (v + .5) ** 2 * we * x; sh = (v + .5) * we
        its.append(item(f"{n}: by how much does the SHO overestimate the energy of level $v={v}$ when $\\bar\\omega_e={we}$, $x_e={x}$?", ["Difference $=(v+\\tfrac12)^2\\bar\\omega_ex_e$."], f"anharmonic {a:.1f} vs SHO {sh:.1f}: error {sh-a:.1f} cm⁻¹ ({(sh-a)/sh*100:.1f} %)."))
    pset(c3, "N5 · Overtone/fundamental ratio and SHO error", "", its)
def A6():
    its = []
    for (n, nu_) in [("HCl", 2886), ("CO", 2143), ("I₂ (stretch)", 214), ("Br₂ (stretch)", 323), ("HF", 3959)]:
        r = math.exp(-nu_ / (KB_CM * 298))
        its.append(item(f"(Extension) At 298 K ($kT/hc=207$ cm$^{{-1}}$) estimate $N_{{v=1}}/N_{{v=0}}=e^{{-\\bar\\nu/(kT/hc)}}$ for {n} ($\\bar\\nu={nu_}$ cm$^{{-1}}$). Will hot bands be visible?", ["Boltzmann factor."], f"N₁/N₀ = {us(r)} — {'hot bands practically invisible' if r<1e-3 else 'hot bands are significant'}."))
    pset(c3, "N6 · Why do hot bands appear only for low-frequency modes? (extension)", "Gives a quantitative reason behind 'at higher temperature, hot bands appear'.", its)
for f in (A1, A2, A3, A4, A5, A6): f()
c3["new"] = c3["sets"][4:]; c3["sets"] = c3["sets"][:4]
c3["quick"].append(dict(title="Z1 · True or false", note="", items=[
    tf("In the Morse model the energy levels converge as $v$ increases.", True, "spacing $=\\bar\\omega_e[1-2x_e(v+1)]$ shrinks."),
    tf("The first overtone is exactly twice the fundamental.", False, "it is $2\\bar\\omega_e(1-3x_e)$, a little less than $2\\bar\\omega_e(1-2x_e)$."),
    tf("$x_e$ is small and positive for bond stretching.", True, "typically 0.005–0.03."),
    tf("The hot band lies to the right (higher wavenumber) of the fundamental.", False, "it lies to the left (lower), by $2\\bar\\omega_ex_e$."),
    tf("The anharmonic selection rule allows Δv = ±1, ±2, ±3….", True, "overtones become weakly allowed."),
    tf("Most absorptions start from $v=0$ because it is the most populated level.", True, "Boltzmann population at room temperature."),
    tf("A harmonic oscillator can dissociate.", False, "the parabola rises forever; only the Morse potential has a dissociation limit."),
    tf("$\\bar\\omega_e=3f-o$ where $f$ is the fundamental and $o$ is the first overtone.", True, "derived from the two equations."),
    tf("The Morse curve is wider than the harmonic parabola at high energy.", True, "it flattens towards $D_e$."),
    tf("A larger $x_e$ means faster convergence of levels.", True, "spacing falls by $2\\bar\\omega_ex_e$ per level.")]))
c3["quick"].append(dict(title="Z2 · Spot the error", note="", items=[
    err("Fundamental = ω̄ₑ(1 − xₑ).", "It is ω̄ₑ(1 − 2xₑ)."),
    err("First overtone = 3ω̄ₑ(1 − 4xₑ).", "That is the second overtone; the first overtone (0→2) is 2ω̄ₑ(1 − 3xₑ)."),
    err("Hot band is at ω̄ₑ(1 − 2xₑ) + 2ω̄ₑxₑ.", "Hot band is below the fundamental: ω̄ₑ(1 − 4xₑ) = fundamental − 2ω̄ₑxₑ."),
    err("xₑ = 2559.08/2649.7 for HBr.", "xₑ = ω̄ₑxₑ/ω̄ₑ = 45.31/2649.7 = 0.0171; ω̄ₑxₑ = f − o/2."),
    err("The spacing between all anharmonic levels is ω̄ₑ.", "The spacing decreases: ω̄ₑ[1 − 2xₑ(v+1)].")]))

# =====================================================================  CH4 new
def E1():
    its = []
    for (n, lam, note) in [("ethene (π→π*)", 165, "far UV"), ("1,3-butadiene (π→π*)", 217, "UV"), ("benzene", 255, "UV"), ("β-carotene", 450, "visible (blue absorbed → orange)"), ("methylene blue", 664, "visible (red absorbed → blue)")]:
        nub = 1e7 / lam; E = H0 * C0 * nub; ev = nub / EV_CM
        its.append(item(f"The HOMO→LUMO absorption maximum of {n} is at {lam} nm. Find the wavenumber (cm$^{{-1}}$), the energy gap (J, eV, kJ mol$^{{-1}}$) and the spectral region.", ["$\\bar\\nu=10^7/\\lambda(\\text{nm})$; $\\Delta E=hc\\bar\\nu$."], f"ν̄ = {nub:.0f} cm⁻¹; ΔE = {us(E)} J = {ev:.2f} eV = {E*NAV/1000:.0f} kJ mol⁻¹; region: {note}"))
    for ev in (6.2, 4.4, 3.1, 2.0):
        lam = 1239.84 / ev
        its.append(item(f"A molecule has a HOMO–LUMO gap of {ev} eV. At what wavelength does it absorb? ($hc=1239.84$ eV nm)", ["$\\lambda=hc/\\Delta E$."], f"λ = {lam:.0f} nm ({'UV' if lam<400 else 'visible' if lam<=700 else 'IR'})"))
    pset(c4, "N1 · HOMO–LUMO gap ↔ absorption wavelength", "Electronic spectroscopy by number: smaller gap → longer wavelength → colour.", its)
def E2():
    its = []
    for (A0, A1_, label) in [(100, 25, "I₀ = 100, I = 25"), (80, 20, "I₀ = 80, I = 20"), (100, 10, "I₀ = 100, I = 10"), (5.0, 3.5, "I₀ = 5.0, I = 3.5")]:
        A = math.log10(A0 / A1_); T = A1_ / A0 * 100
        its.append(item(f"(Beer–Lambert; older syllabus) A solution transmits light with {label}. Find absorbance and % transmittance.", ["$A=\\log_{10}(I_0/I)$; $\\%T=100\\,I/I_0$."], f"A = {A:.3f}; %T = {T:.1f} %"))
    for (A, c, l) in [(0.45, 3.0e-5, 1.0), (0.80, 1.6e-4, 1.0), (0.30, 5.0e-5, 2.0), (1.20, 2.0e-4, 0.5)]:
        eps = A / (c * l)
        its.append(item(f"A solution of concentration {us(c,2)} mol L$^{{-1}}$ in a {l} cm cell has absorbance {A}. Find $\\varepsilon$.", ["$\\varepsilon=A/(cl)$."], f"ε = {us(eps,2) if eps>=1e3 else f'{eps:.3g}'} L mol⁻¹ cm⁻¹"))
    for (eps, A, l) in [(15000, 0.60, 1.0), (8500, 0.25, 1.0), (22000, 0.90, 2.0)]:
        c = A / (eps * l)
        its.append(item(f"ε = {eps} L mol⁻¹ cm⁻¹, A = {A}, path {l} cm. Find the concentration.", ["$c=A/(\\varepsilon l)$."], f"c = {us(c)} mol L⁻¹"))
    its.append(item("Why does Beer's law fail at high concentration?", [], "Interactions between absorbing species, changes in refractive index and stray light cause deviations; use dilute solutions."))
    pset(c4, "N2 · Beer–Lambert law (flagged: older syllabus)", "Asked once (Dec 2024 / Jun 2024 Q4). Short, numeric and easy marks.", its)
def E3():
    its = []
    for (lam0, sh) in [(514.5, 1000), (532.0, 1332), (488.0, 520), (632.8, 2331), (514.5, 218)]:
        n0 = 1e7 / lam0; st = n0 - sh; ast = n0 + sh
        its.append(item(f"(Transcript-based) A laser of {lam0} nm excites a sample showing a Raman shift of {sh} cm$^{{-1}}$. Find the wavelengths of the Rayleigh, Stokes and anti-Stokes lines.", ["$\\bar\\nu_0=10^7/\\lambda$; Stokes $=\\bar\\nu_0-\\Delta$; anti-Stokes $=\\bar\\nu_0+\\Delta$."],
            f"Rayleigh {lam0} nm ({n0:.0f} cm⁻¹); Stokes {1e7/st:.1f} nm ({st:.0f} cm⁻¹); anti-Stokes {1e7/ast:.1f} nm ({ast:.0f} cm⁻¹). Stokes is on the red side, anti-Stokes on the blue side."))
    pset(c4, "N3 · Raman shifts", "Rayleigh, Stokes and anti-Stokes as numbers (concept is examined; arithmetic is an extension).", its)
def E4():
    its = []
    for (lam, u) in [(5, "m"), (3, "cm"), (200, "µm"), (10, "µm"), (500, "nm"), (2.5, "µm"), (1, "nm"), (10, "pm"), (0.5, "mm"), (350, "nm")]:
        m = lam * {"m": 1, "cm": 1e-2, "mm": 1e-3, "µm": 1e-6, "nm": 1e-9, "pm": 1e-12}[u]
        if m > 1e-2: reg, tr = "Radio-frequency (10 m – 1 cm)", "nuclear/electron spin reversal (NMR, ESR)"
        elif m > 1e-4: reg, tr = "Microwave (1 cm – 100 µm)", "rotational"
        elif m > 1e-6: reg, tr = "Infrared (100 µm – 1 µm)", "vibrational"
        elif m > 1e-8: reg, tr = "UV–Visible (1 µm – 10 nm)", "electronic (valence electrons)"
        elif m > 1e-10: reg, tr = "X-ray (10 nm – 100 pm)", "inner-electron redistribution"
        else: reg, tr = "γ-ray (100 pm – 1 pm)", "nuclear rearrangement"
        its.append(item(f"Radiation of wavelength {lam} {u}: name the region, the type of transition it can excite, and its wavenumber.", ["Compare λ with the region table (10 m–1 cm, 1 cm–100 µm, 100 µm–1 µm, 1 µm–10 nm, 10 nm–100 pm, 100–1 pm)."], f"{reg}; {tr}; ν̄ = {us(1/(m*100),2)} cm⁻¹"))
    pset(c4, "N4 · Identify the region and the transition", "A quick-fire table drill — the whole EM-spectrum slide in ten questions.", its)
def E5():
    its = []
    for (rp, rg, rule) in [(1.21, 1.21, ""), (1.35, 1.21, ""), (2.30, 1.21, ""), (1.50, 1.50, ""), (1.60, 1.40, ""), (3.00, 1.10, "")]:
        d = rp - rg
        case, spec = (("a", "(0,0) strongest, intensity falls steadily") if abs(d) < 0.02 else (("b", "strongest line (v′,0) with v′>0; progression longer") if d < 0.6 else ("c", "a few lines then a continuum (dissociation)")))
        its.append(item(f"Ground-state bond length $r_e''={rg}$ Å, excited-state $r_e'={rp}$ Å. (Take Δr < 0.02 Å as 'same' and Δr > 0.6 Å as 'much larger'.) Identify the Franck–Condon case and describe the spectrum.", ["Compare $r_e'$ with $r_e''$; draw the vertical arrow from $v''=0$."], f"Δr = {d:+.2f} Å → case ({case}): {spec}."))
    its.append(item("If the excited state had a shorter bond than the ground state (r_e′ < r_e″) what would the vertical transition land on?", [], "A vibrational level $v'>0$ on the inner (left) wall — again the strongest line is (v′,0) with v′>0; the spectrum looks like case (b)."))
    pset(c4, "N5 · Classify the Franck–Condon case from bond lengths", "", its)
def E6():
    pset(c4, "N6 · Born–Oppenheimer and energy scales", "Order-of-magnitude reasoning (added for clarity): E_elec ~ 10⁴–10⁵ cm⁻¹, E_vib ~ 10²–10⁴ cm⁻¹, E_rot ~ 1–10² cm⁻¹.", [
        item("For HCl: rotation ≈ 21 cm⁻¹ (first line), vibration ≈ 2886 cm⁻¹, electronic ≈ 80000 cm⁻¹. Find the ratios $E_{vib}/E_{rot}$ and $E_{elec}/E_{vib}$ and the region of each.", [], f"E_vib/E_rot ≈ {2886/21.18:.0f}; E_elec/E_vib ≈ {80000/2886:.0f}; microwave, IR, UV respectively. Hence E_rot ≪ E_vib ≪ E_elec."),
        item("A single electronic transition may show vibrational and rotational structure. Explain using B–O.", [], "Since the three energies are independent and additive, $\\Delta E=\\Delta E_{elec}+\\Delta E_{vib}+\\Delta E_{rot}$: each electronic band splits into vibrational coarse structure, and each vibrational line into rotational fine structure."),
        item("Why do we neglect translational energy in the B–O treatment?", [], "Translational levels are so closely spaced and so small that they are effectively continuous and do not appear in the spectrum."),
        item("Why is the electronic energy gap much larger than the vibrational gap?", [], "Electrons are far lighter than nuclei, so electronic motion is much faster and electronic levels are much farther apart; nuclear motion is slow."),
        item("Which spectroscopy gives structural information about N₂?", [], "Only electronic spectroscopy (and Raman); N₂ is inactive in microwave and IR.")])
def E7():
    pset(c4, "N7 · Franck–Condon in words (long answer practice)", "Write each answer in 4–5 lines, then compare.", [
        item("Explain why 'vertical transition' is used. What is 'vertical' about it?", [], "Electronic excitation takes ~10⁻¹⁵ s but nuclei vibrate in ~10⁻¹³ s, so $r$ stays the same during excitation: on a PE-vs-$r$ plot the arrow is vertical."),
        item("Why do the transitions begin at the centre of $v''=0$?", [], "For $v=0$ the probability of finding the nuclei is maximum at the equilibrium position (centre), while for higher $v$ it is at the turning points."),
        item("Explain 'progression' and why the lines converge.", [], "A series of lines $(v',0)$ from $v''=0$ to successive $v'$; they converge because the excited-state levels converge (anharmonic), reaching the dissociation limit."),
        item("Differentiate 'coarse structure' from 'fine structure'.", [], "Coarse = vibrational changes accompanying the electronic transition; fine = rotational changes."),
        item("Why is the intensity unequal even though there is no vibrational selection rule?", [], "Franck–Condon overlap of nuclear wave functions governs relative intensity.")])
for f in (E1, E2, E3, E4, E5, E6, E7): f()
c4["new"] = c4["sets"][3:]; c4["sets"] = c4["sets"][:3]
c4["quick"].append(dict(title="Z1 · True or false", note="", items=[
    tf("Franck–Condon transitions are vertical.", True, "internuclear distance is unchanged."),
    tf("If $r_e'=r_e''$ the (0,0) line is the strongest.", True, "case (a)."),
    tf("A continuum implies the molecule remained intact.", False, "it implies dissociation."),
    tf("Stokes lines appear at higher frequency than the Rayleigh line.", False, "Stokes: lower; anti-Stokes: higher."),
    tf("Rayleigh scattering is inelastic.", False, "it is elastic; Raman is inelastic."),
    tf("The excited state usually has a longer bond than the ground state.", True, "antibonding character."),
    tf("All molecules can show electronic transitions.", True, "unlike microwave or IR, no dipole condition."),
    tf("There is no selection rule for vibrational changes during an electronic transition.", True, "intensity is set by Franck–Condon factors."),
    tf("$E_{rot}\\gg E_{vib}$.", False, "$E_{rot}\\ll E_{vib}\\ll E_{elec}$."),
    tf("UV–Vis spectroscopy gives rise to rotational spectra.", False, "microwave; though rotational *fine structure* rides on electronic bands."),
    tf("A = log(I₀/I) is the Beer–Lambert absorbance.", True, "flagged older syllabus."),
    tf("The Raman effect needs the molecule to have a permanent dipole.", False, "it depends on polarisability, not permanent dipole.")]))
c4["quick"].append(dict(title="Z2 · Spot the error", note="", items=[
    err("Franck–Condon: the molecule rapidly changes bond length during excitation, so the arrow is slanted.", "The bond length does not change appreciably; the arrow is vertical."),
    err("Case (c) gives (0,0) as the strongest line.", "In case (c) the arrow lands above the dissociation limit; a continuum results."),
    err("Stokes line = ν̄₀ + Δν̄.", "Stokes = ν̄₀ − Δν̄ (lower frequency); anti-Stokes is ν̄₀ + Δν̄."),
    err("Wavenumber = λ in nm × 10⁷.", "ν̄ (cm⁻¹) = 10⁷ / λ(nm)."),
    err("The first overtone appears in the electronic spectrum as the (0,2) line.", "Electronic lines are labelled (v′, v″); 'overtone' belongs to IR vibrational spectra.")]))

# =====================================================================  CH5 new
def P1():
    sys_ = [
        ("An unsaturated NaCl solution (no solid, no vapour considered)", 1, 2),
        ("A saturated NaCl solution with no excess solid, and its vapour", 2, 2),
        ("A mixture of N₂ and O₂ gases", 1, 2),
        ("Ice + saturated salt solution + vapour", 3, 2),
        ("Fe(s) + H₂O(g) ⇌ FeO(s) + H₂(g) (closed vessel)", 3, 3),
        ("Graphite ⇌ diamond (solid phases only)", 2, 1),
        ("Benzene + toluene (miscible liquids) + vapour", 2, 2),
        ("Ethanol + water solution + vapour", 2, 2),
        ("CuSO₄·5H₂O(s) ⇌ CuSO₄·3H₂O(s) + 2H₂O(g)", 3, 2),
        ("NaCl(aq) + ice", 2, 2),
        ("Pure water boiling at 1 atm (liquid + vapour)", 2, 1),
        ("Pure CO₂ at its triple point", 3, 1),
        ("Sulphur: rhombic + monoclinic + vapour (transition)", 3, 1),
        ("Hg(l) in equilibrium with Hg vapour", 2, 1),
        ("C(s) + CO₂(g) ⇌ 2CO(g) (closed vessel)", 2, 2),
        ("Solid I₂ ⇌ I₂ vapour", 2, 1),
        ("CaCO₃(s) ⇌ CaO(s) + CO₂(g) with extra CO₂ added", 3, 2),
        ("CaSO₄·2H₂O(s) ⇌ CaSO₄(s) + 2H₂O(g)", 3, 2)]
    its = []
    for (s, Pn, Cn) in sys_:
        F = Cn - Pn + 2
        its.append(item(f"Find $P$, $C$ and $F$ for: {s}. (Use $F=C-P+2$.)", ["Count phases first; then components = species − independent reactions − composition restrictions."], f"$P={Pn}$, $C={Cn}$, $F={F}$ ({['invariant','univariant','bivariant','trivariant'][F] if 0<=F<=3 else 'check'})"))
    pset(c5, "N1 · Counting phases, components and degrees of freedom — 18 systems", "Exam: CaCO₃, MgCO₃, NH₄Cl. Here is the full range of systems an examiner could use.", its)
def P2():
    its = [
        item("Complete the table of $F=3-P$ for the water system: single-phase areas (ice, water, vapour), the three curves, the triple point, the critical point and the metastable curve.", ["$C=1$."], "Areas: P=1, F=2. OA, OB, OC: P=2, F=1. OA′ (metastable, liquid+vapour): P=2, F=1. Triple point O: P=3, F=0. Critical point A: liquid and vapour become identical; treated as invariant (F=0)."),
        item("Complete the table of $F=C-P+1$ for the Pb–Ag system: liquid melt, liquid+Pb, liquid+Ag, solid Pb+Ag (below eutectic), the eutectic point, the freezing curves, and the pure-metal melting points A and B.", ["$C=2$, reduced rule."], "Liquid melt: P=1, F=2. Liquid + one solid: P=2, F=1. Solid Pb + solid Ag: P=2, F=1. Curves AO and BO: P=2, F=1. Eutectic O: P=3 (Pb + Ag + melt), F=0. Pure metal melting point A or B: C=1, P=2 ⇒ F = 1−2+1 = 0."),
        item("At the triple point of water the pressure is 4.58 mmHg. Why can't you change either T or P without losing a phase?", ["$F=0$."], "F = 0 (invariant): T and P are both fixed; changing either removes at least one phase."),
        item("At 1 atm water boils at 100 °C. Why is the temperature fixed? Use the phase rule.", ["Two phases, $C=1$."], "F = 1 − 2 + 2 = 1; fixing the pressure at 1 atm uses up the single degree of freedom, so T is fixed at 100 °C."),
        item("A system of 3 components can have at most how many phases at equilibrium? Generalise.", ["$F\\ge0\\Rightarrow P\\le C+2$."], "P_max = C + 2 = 5 (general rule); for a condensed system, P_max = C + 1."),
        item("What is the maximum number of phases for C = 1, 2, 3, 4 (general and condensed)?", ["$P_{max}=C+2$ and $C+1$."], "General: 3, 4, 5, 6. Condensed: 2, 3, 4, 5 (so Pb–Ag has at most 3 phases at the eutectic).")]
    pset(c5, "N2 · Complete the F-table", "", its)
def P3():
    its = []
    for (x0, M) in [(0.05, 1000), (0.10, 1000), (0.20, 1000), (0.50, 500)]:
        mel = M * x0 / 2.6; pb = M - mel
        its.append(item(f"(Desilverisation of argentiferous lead — transcript) {M} kg of molten lead contains {x0} % Ag. It is cooled slowly and pure solid Pb is skimmed off until the melt reaches the eutectic composition (2.6 % Ag). How much Pb is removed and how much Ag-rich melt remains?", ["Ag is conserved: $M\\,x_0=m_{melt}\\times2.6\\%$."],
            f"m_melt = {M}×{x0}/2.6 = {mel:.1f} kg (2.6 % Ag); Pb removed = {pb:.1f} kg ({pb/M*100:.1f} % of the charge). The melt then holds all the {M*x0/100:.2f} kg of Ag. [Idealised: pure solid Pb, no Ag in solid.]"))
    pset(c5, "N3 · Desilverisation (Pattinson) mass balance", "Applies the Pb–Ag diagram: the melt gets enriched in silver as pure lead crystallises. Transcript-only topic; the arithmetic is an extension.", its)
def P4():
    its = []
    for dP in (1, 10, 100, 500, 1000):
        dT = dP * 101325 * 273.15 * (-1.63e-6) / 6010
        its.append(item(f"(Extension) Using $dP/dT=\\Delta H/T\\Delta V$ with $\\Delta H_{{fus}}=6010$ J mol$^{{-1}}$ and $\\Delta V=-1.63\\times10^{{-6}}$ m$^3$ mol$^{{-1}}$ at 273.15 K, find the change in melting point of ice when the pressure rises by {dP} atm.", ["$\\Delta T\\approx T\\Delta V\\,\\Delta P/\\Delta H$ (small changes)."], f"ΔT = {dT:.3f} K — melting point falls ({dT:.2f} °C); sign negative because ΔV < 0."))
    for P2_ in (0.5, 0.7, 2.0, 5.0):
        T2 = 1 / (1 / 373.15 - 8.314 * math.log(P2_) / 40700)
        its.append(item(f"(Extension) Using $\\ln(P_2/P_1)=\\dfrac{{\\Delta H_{{vap}}}}{{R}}\\left(\\dfrac1{{T_1}}-\\dfrac1{{T_2}}\\right)$ with $\\Delta H_{{vap}}=40.7$ kJ mol$^{{-1}}$, find the boiling point of water at {P2_} atm.", ["$P_1=1$ atm, $T_1=373.15$ K."], f"T₂ = {T2:.1f} K = {T2-273.15:.1f} °C"))
    pset(c5, "N4 · Clausius–Clapeyron numbers (extension)", "Shows what the curves mean quantitatively: very steep OC, gentle OA. Altitude cooking and pressure cookers use curve OA.", its)
def P5():
    tr = [("25 °C, 1 atm", "liquid water", 1, "area, F=2"), ("−10 °C, 1 atm", "ice", 1, "area, F=2"), ("150 °C, 1 atm", "water vapour", 1, "area, F=2"), ("100 °C, 1 atm", "liquid + vapour", 2, "on OA, F=1"),
          ("0 °C, 1 atm", "ice + liquid", 2, "on OC, F=1"), ("0.0098 °C, 4.58 mmHg", "ice + liquid + vapour", 3, "triple point, F=0"), ("374 °C, 218 atm", "critical point (liquid and vapour indistinguishable)", 1, "A, F=0"),
          ("−10 °C, 1 mmHg", "vapour (ice's vapour pressure is 1.95 mmHg)", 1, "area, F=2"), ("−10 °C, 10 mmHg", "ice", 1, "area, F=2"), ("25 °C, 760 mmHg", "liquid water", 1, "area, F=2")]
    its = [item(f"At {s}, which phase(s) of water are present, and what is $F$?", ["Locate the point on **Fig. G22**."], f"{ph}; {fnote}.") for s, ph, n, fnote in tr]
    pset(c5, "N5 · Where are we on the water diagram?", "Read the diagram like a map.", its)
def P6():
    its = [
        item("A pure metal's cooling curve shows a flat portion at 327 °C. Give $F$ on the flat portion, and the phases.", ["Reduced rule, $C=1$."], "Solid + liquid in equilibrium: F = 1 − 2 + 1 = 0 — temperature stays constant until all liquid solidifies."),
        item("A Pb–Ag melt's cooling curve shows a change of slope at 800 °C and a long halt at 303 °C. Interpret.", [], "Break at 800 °C = start of crystallisation of the first solid (F=1, cooling slows); halt at 303 °C = eutectic crystallisation, three phases, F=0."),
        item("A melt of unknown composition shows only a halt at 303 °C, with no break above it. What is its composition?", [], "The eutectic composition, 2.6 % Ag (97.4 % Pb)."),
        item("Which of 0 %, 2.6 %, 50 % and 100 % Ag in Pb shows (i) a halt only; (ii) a break then a halt; (iii) halt only at 961 °C?", [], "(i) 2.6 % (halt at 303 °C) and the pure metals (halt at 327 °C for 0 %, 961 °C for 100 %); (ii) 50 %; (iii) 100 % Ag."),
        item("How does the duration of the eutectic halt vary with composition?", [], "It is longest at the eutectic composition (all liquid solidifies there) and decreases towards the pure-metal ends (little eutectic liquid)."),
        item("Explain how the Pb–Ag diagram is built from six cooling curves.", [], "Plot break temperatures against composition for the liquidus curves, the common halt temperature for the eutectic line, and the pure-metal halts for the two ends (see Fig. G24).")]
    pset(c5, "N6 · Interpret cooling curves", "", its)
def P7():
    pset(c5, "N7 · Definitions in your own words", "", [
        item("Define phase with three examples that are not water.", [], "Homogeneous, physically distinct, mechanically separable part. Examples: a mixture of gases is one phase; two immiscible liquids (oil + water) are two phases; each polymorph (rhombic/monoclinic sulphur) is a separate phase."),
        item("Define component. Why are 'zero and negative values' allowed in the definition?", [], "Smallest number of independently variable constituents that express every phase's composition. Zero/negative coefficients let a constituent be absent from a phase or be consumed (e.g. CaO = CaCO₃ − CO₂)."),
        item("Define degree of freedom/variance with an example.", [], "Number of intensive variables (T, P, concentration) that can be varied independently without changing the number of phases; for liquid water alone F = 2."),
        item("What is a condensed system?", [], "A system in which the gas phase is absent, so small pressure changes have little effect (solid–liquid)."),
        item("What is a metastable equilibrium? Give an example.", [], "A state not at the true minimum of Gibbs energy but persisting until disturbed — supercooled water below 0 °C (curve OA′)."),
        item("State the conditions under which F = C − P + 2 is valid.", [], "Heterogeneous system at equilibrium, not influenced by external forces (gravity, electrical, magnetic)."),
        item("What are bivariant, univariant and invariant systems?", [], "F = 2, 1, 0 respectively.")])
def P8():
    pset(c5, "N8 · Derivation variants and logic", "", [
        item("Derive the reduced phase rule $F=C-P+1$ from $F=C-P+2$.", [], "Pressure is held constant (condensed system), removing one variable: $F=C-P+2-1=C-P+1$."),
        item("Show that for $C=2$ the unreduced rule gives $F=3$ when $P=1$, and why this needs three dimensions.", [], "$F=2-1+2=3$: T, P and composition must all be specified — a 3-D diagram."),
        item("In deriving the phase rule, why is the number of composition variables $P(C-1)$ and not $PC$?", [], "In each phase the mole fractions sum to 1, so only $C-1$ are independent."),
        item("In the derivation, why are there $C(P-1)$ equations?", [], "For each of C components, $P$ chemical potentials must be equal: $P-1$ independent equations."),
        item("For a system with $C=3$ and $P=2$: number of variables, constraints, F.", [], "variables $=2(2)+2=6$; constraints $=3$; $F=3$ ($=3-2+2$)."),
        item("Why do we say chemical potential 'drives' a system to equilibrium?", [], "Matter flows from higher to lower μ; at equilibrium μ is equal in all phases and there is no net transfer.")])
for f in (P1, P2, P3, P4, P5, P6, P7, P8): f()
c5["new"] = c5["sets"][6:]; c5["sets"] = c5["sets"][:6]
c5["quick"].append(dict(title="Z1 · True or false", note="", items=[
    tf("The phase rule $F=C-P+2$ applies to the Pb–Ag diagram at constant pressure.", False, "at constant pressure use $F=C-P+1$."),
    tf("Ice present as many pieces is still one phase.", True, "a phase is not defined by the number of pieces."),
    tf("NH₄Cl heated in a closed vessel has C = 1.", True, "NH₃ : HCl = 1 : 1 in the gas, so one component; C=2 if extra NH₃ or HCl is added."),
    tf("At the triple point of water $F=2$.", False, "F = 1 − 3 + 2 = 0."),
    tf("The fusion curve of water has a positive slope.", False, "negative: $\\Delta V<0$."),
    tf("Increasing pressure raises the melting point of ice.", False, "it lowers it slightly."),
    tf("The critical point is where the liquid–vapour interface disappears.", True, "374 °C, 218 atm."),
    tf("At the eutectic point of Pb–Ag, three phases coexist and $F=0$.", True, "solid Pb, solid Ag and melt."),
    tf("The eutectic mixture has the highest melting point of all compositions.", False, "the lowest."),
    tf("Metastable water at −5 °C has a lower vapour pressure than ice at −5 °C.", False, "its vapour pressure is higher."),
    tf("A component is the same as a chemical species.", False, "components are the minimum independent set; species − reactions − restrictions."),
    tf("Gas mixtures form one phase regardless of the number of gases.", True, "gases are completely miscible.")]))
c5["quick"].append(dict(title="Z2 · Spot the error", note="", items=[
    err("CaCO₃ ⇌ CaO + CO₂ has C = 3 because there are three species.", "Three species minus one reaction gives C = 2."),
    err("Water has P = 3 at the triple point so F = 3 − 3 + 2 = 2.", "F = C − P + 2 with C = 1: 1 − 3 + 2 = 0."),
    err("Variables = PC + 2.", "Variables = P(C − 1) + 2 (mole fractions sum to 1)."),
    err("The Pb–Ag eutectic has F = 2 − 3 + 2 = 1.", "Use the reduced rule: 2 − 3 + 1 = 0."),
    err("The melting curve of water slopes up because ice is denser than water.", "Ice is less dense (ΔV < 0 on melting), so the slope is negative."),
    err("Along curve OB, P = 2, so F = 2.", "F = 1 − 2 + 2 = 1.")]))

# =====================================================================  CH6 new
def K1():
    pset(c6, "N1 · Which method would you use?", "Scenario questions: choose and justify (speed vs accuracy).", [
        item("Optimise the geometry of a 400-atom steroid derivative in seconds.", [], "Molecular mechanics — balls and springs, very fast."),
        item("Study how a protein folds over nanoseconds.", [], "Molecular dynamics — applies laws of motion to follow atom movements."),
        item("Quick qualitative geometry and excited states of a mid-size organic molecule at modest cost.", [], "Semi-empirical — a middle road; can handle transition states and excited states."),
        item("Obtain the electron distribution of a 20-atom molecule with good accuracy without the full cost of a wave-function calculation.", [], "DFT — derives electron density directly; faster than ab initio, slower than semi-empirical."),
        item("Compute the most accurate energy of a very small molecule such as H₂ or ethylene.", [], "Ab initio — based on the Schrödinger equation and the wave function; the most demanding."),
        item("Predict HOMO/LUMO and the UV-Vis spectrum of a new dye.", [], "A quantum method (DFT or semi-empirical)."),
        item("Screen a million candidate drug molecules for binding to a target.", [], "Fast classical methods (MM/MD) plus AI/ML surrogate models trained on quantum data."),
        item("Estimate how electrolyte molecules interact in a battery.", [], "MD for dynamics, DFT for electronic structure; AI to speed up screening.")])
def K2():
    pset(c6, "N2 · Compare the methods", "", [
        item("Tabulate MM, MD, semi-empirical, ab initio and DFT: theory, handles electrons?, speed, accuracy.", [], "MM: classical, no electrons, fastest, lowest. MD: classical dynamics, no electrons, fast. Semi-empirical: quantum (approximate Schrödinger), yes, fast, medium. DFT: quantum (density), yes, medium, high. Ab initio: quantum (wave function), yes, slowest, highest."),
        item("What is a force field?", [], "The set of equations/parameters that gives the potential energy of a molecule as the sum of attractive and repulsive atom–atom interactions (bond stretching, bending, non-bonded)."),
        item("What is a wave function? What does $|\\psi|^2$ give?", [], "A mathematical function from the Schrödinger equation describing electrons; $|\\psi|^2$ gives the electron probability density."),
        item("What is a basis set?", [], "The set of mathematical functions used to build molecular orbitals in a calculation (step 2 of the ethylene workflow)."),
        item("Give two limitations of computational chemistry.", [], "Cost grows quickly with molecular size and accuracy; results depend on the chosen method/basis set and are not a replacement for experiment."),
        item("Name the 1998 Nobel laureates linked with computational chemistry.", [], "Walter Kohn and John Pople (DFT and computational methods). [Added for clarity; 2013: Karplus, Levitt, Warshel.]")])
def K3():
    pset(c6, "N3 · Ethylene and the electronic-structure workflow", "", [
        item("How many σ and π bonds does ethylene (C₂H₄) have? State the hybridisation of carbon.", [], "5 σ (4 C–H + 1 C–C) and 1 π; each carbon is sp²."),
        item("Draw the π and π* orbitals of ethylene; which is HOMO and which LUMO?", [], "π: in-phase overlap of the two p orbitals (bonding, HOMO). π*: out-of-phase overlap with a node between the carbons (antibonding, LUMO)."),
        item("List the 5 computational steps to determine the electronic structure of ethylene.", [], "1 Define geometry. 2 Select basis set. 3 Apply the method (orbital energies and density). 4 Solve equations (wave function / density). 5 Visualise (orbital diagrams, density maps, HOMO and LUMO)."),
        item("How does the HOMO–LUMO gap connect to UV-Vis spectroscopy?", [], "Absorption of light promotes an electron HOMO → LUMO; a smaller gap absorbs at longer wavelength (see Ch. 4 N1)."),
        item("Why is ethylene's π bond the site of reactivity?", [], "Its π electrons are higher in energy and more exposed than the σ framework; the HOMO (π) donates and the LUMO (π*) accepts electrons."),
        item("Why is the ethane rotational barrier (≈3 kcal/mol) a typical molecular-mechanics problem?", [], "It is described by torsional terms in a force field: staggered conformers lowest, eclipsed highest (Fig. G25).")])
def K4():
    pset(c6, "N4 · AI-enhanced computational chemistry", "", [
        item("Describe the AI-enhanced workflow in four steps.", [], "Quantum simulations generate data → build a dataset → train an ML model → predict properties in milliseconds."),
        item("List four scopes of AI-enhanced computational chemistry.", [], "Accelerated molecular discovery; property prediction; reaction-pathway mapping; structure generation."),
        item("List three advantages of AI-enhanced computational chemistry.", [], "Massive speed-up (hours/days → milliseconds after training); broad screening of vast chemical spaces; pattern recognition of subtle structure–property relationships."),
        item("Why can't an AI model work without quantum calculations first?", [], "It is trained on data produced by quantum simulations (or experiments); the model interpolates, it does not replace the underlying physics."),
        item("Give an engineering example of AI-assisted screening.", [], "Battery-electrolyte or polymer screening: predict stability and conductivity of thousands of candidates before synthesis.")])
for f in (K1, K2, K3, K4): f()
c6["new"] = c6["sets"][1:]; c6["sets"] = c6["sets"][:1]
c6["quick"].append(dict(title="Z1 · True or false", note="", items=[
    tf("Molecular mechanics treats atoms as spheres and bonds as springs.", True, "classical force field."),
    tf("DFT calculates the full many-electron wave function.", False, "it derives the electron density directly."),
    tf("Ab initio methods are usually faster than semi-empirical ones.", False, "slower but more accurate."),
    tf("Computational chemistry replaces laboratory experiments.", False, "it complements them."),
    tf("The first theoretical investigation was by Heitler and London in 1927.", True, "slide 3."),
    tf("In ethylene HOMO = π and LUMO = π*.", True, "slide 16."),
    tf("Quantum methods ignore electrons.", False, "classical methods ignore electrons."),
    tf("AI-enhanced models can reduce prediction time to milliseconds once trained.", True, "slide 20."),
    tf("Semi-empirical methods can calculate transition states and excited states.", True, "slide 10."),
    tf("Molecular dynamics is based on the laws of motion.", True, "slide 9.")]))
c6["quick"].append(dict(title="Z2 · Spot the error", note="", items=[
    err("Ab initio means 'based on experimental parameters'.", "Ab initio ('from the beginning') uses the Schrödinger equation with no empirical parameters (that is what semi-empirical methods add)."),
    err("DFT is faster than semi-empirical methods.", "DFT is faster than ab initio but slower than semi-empirical."),
    err("Ethylene's HOMO is π*.", "HOMO is π (bonding); LUMO is π*.")]))

# =====================================================================  CH7 mock papers
c7 = Q.chapter("Q7", "Mock Q1 papers (timed)", "m1", "All Unit 1",
    "Three full-length mock 'Question 1' papers in the exam format, with new molecules and new numbers (nothing repeated from the solved past questions). Allow about 30 minutes per paper; write full answers before checking.",
    [r"\varepsilon_J=BJ(J+1),\ I=\mu r_0^2", r"\bar\nu=\dfrac{1}{2\pi c}\sqrt{k/\mu},\ \text{ZPE}=\tfrac12\bar\nu", r"\bar\omega_e(1-2x_e),\ 2\bar\omega_e(1-3x_e)", r"F=C-P+2,\ F=C-P+1"], [])
c7["gtitle_B"] = "Mock papers · attempt cold, then check"
def mock(title, a, b, c_, d, e_):
    items = []
    for k, (lab, marks, q, st, ans) in enumerate((a, b, c_, d, e_)): items.append(item(f"({'abcde'[k]}) [{marks} marks] {q}", st, ans))
    pset(c7, title, "Total 22 marks · about 30 minutes · constants: h = 6.626×10⁻³⁴ J s, c = 3×10¹⁰ cm s⁻¹, 1 amu = 1.66×10⁻²⁷ kg, π = 3.14.", items)
def rotq(n, ln, a, b, A, Bx):
    B, I, mu, r = r0_from_line(ln, a, b, 6.626e-34, 3e10, 3.14)
    return (n, 6, f"The first line in the rotational spectrum of {n} is at {ln} cm$^{{-1}}$ ({A} = {a}, {Bx} = {b} amu). (i) Derive $I=\\mu r_0^2$. (ii) Calculate $I$ and the bond length. (iii) Draw the energy levels to $J=4$ and the spectrum.",
            ["(i) Derivation Q1-D.", f"(ii) $B={ln/2:.4g}$ cm$^{{-1}}$; $I={sci(I)}$ kg m²; $\\mu={mu_amu(a,b):.4f}$ amu; $r_0={r*1e10:.3f}$ Å.", f"(iii) Levels 0, 2B, 6B, 12B, 20B = 0, {2*ln/2:.2f}, {6*ln/2:.2f}, {12*ln/2:.2f}, {20*ln/2:.2f} cm⁻¹; lines every {ln:.2f} cm⁻¹."], f"$I={sci(I)}$ kg m²; $r_0={r*1e10:.3f}$ Å")
def shoq(n, k_, a, b, A, Bx):
    nu_ = sho_nu(k_, a, b, pi=3.14)
    return (n, 6, f"{n} ($k={k_}$ N m$^{{-1}}$; {A} = {a}, {Bx} = {b} amu) is treated as an SHO. (i) Find $\\bar\\nu$ and the zero-point energy (cm$^{{-1}}$ and J). (ii) Find $\\varepsilon_2$ and $\\varepsilon_5$. (iii) Why is only one line seen?",
            [f"$\\mu={mu_amu(a,b):.4f}$ amu; $\\bar\\nu={nu_:.0f}$ cm$^{{-1}}$.", f"ZPE $={nu_/2:.0f}$ cm$^{{-1}}$ $={us(nu_/2*6.626e-34*3e10)}$ J; $\\varepsilon_2={2.5*nu_:.0f}$, $\\varepsilon_5={5.5*nu_:.0f}$ cm$^{{-1}}$.", "(iii) Equal spacing and Δv = ±1."], f"ν̄ = {nu_:.0f} cm⁻¹, ZPE = {nu_/2:.0f} cm⁻¹")
def anq(n, f, o, extra):
    xe, we = anh_from(f, o)
    return (n, 4, f"{n}: fundamental {f} cm$^{{-1}}$ and first overtone {o} cm$^{{-1}}$. Find $x_e$, $\\bar\\omega_e$ and the second overtone; state the selection rule.", [f"$\\bar\\omega_e=3f-o={we:.1f}$; $x_e={xe:.5f}$; 2nd overtone $=3\\bar\\omega_e(1-4x_e)={3*we*(1-4*xe):.1f}$ cm$^{{-1}}$.", "Δv = ±1, ±2, ±3…"], f"xₑ = {xe:.5f}, ω̄ₑ = {we:.1f} cm⁻¹, 2nd overtone {3*we*(1-4*xe):.1f} cm⁻¹")
def phq(sys_txt, Pn, Cn, label):
    F = Cn - Pn + 2
    return (label, 4, f"Derive the phase rule. For {sys_txt} find $P$, $C$, $F$.", ["Derivation Q5-D.", f"$P={Pn}$, $C={Cn}$, $F={Cn}-{Pn}+2={F}$."], f"F = C − P + 2; P = {Pn}, C = {Cn}, F = {F}")
fc = ("Franck–Condon", 4, "State the Franck–Condon principle. Draw the vibrational–electronic transitions and spectra when (i) $r_e'=r_e''$ and (ii) $r_e'\\gg r_e''$. What does a continuum imply?", ["Statement; case (a) and case (c) of Fig. G21."], "(0,0) strongest for (i); continuum (dissociation) for (ii)")
water = ("Water + Pb–Ag", 4, "Draw the water phase diagram with triple and critical points and give $F$ in each region. Why is $F=C-P+1$ used for Pb–Ag?", ["Fig. G22; areas F=2, lines F=1, triple point F=0; condensed system at constant pressure."], "F = 2, 1, 0; reduced rule for condensed Pb–Ag")
def conc(topic, q, a): return (topic, 2, q, [], a)
mock("Mock paper 1", rotq("CO", 3.86, 12.0, 15.995, "C", "O"), shoq("HF", 966, 1.008, 18.998, "H", "F"), anq("HCl", 2885.3, 5665.0, ""), phq("MgCO₃(s) ⇌ MgO(s) + CO₂(g)", 3, 2, "Phase rule"), conc("Raman", "Differentiate Stokes and anti-Stokes lines and state which is stronger.", "Stokes: lower frequency (molecule gains energy), stronger; anti-Stokes: higher frequency, weaker (fewer molecules in excited levels)."))
mock("Mock paper 2", rotq("HF", 41.9, 1.008, 18.998, "H", "F"), shoq("NO", 1595, 14.0, 16.0, "N", "O"), fc, water, conc("B–O", "State the Born–Oppenheimer approximation and the order of energies.", "$E=E_{rot}+E_{vib}+E_{elec}$, independent; $E_{rot}\\ll E_{vib}\\ll E_{elec}$."))
mock("Mock paper 3", rotq("HBr", 17.0, 1.008, 79.9, "H", "Br"), shoq("CO", 1857, 12.0, 15.995, "C", "O"), anq("HF", 3958.5, 7737.2, ""), phq("NH₄Cl(s) ⇌ NH₃(g) + HCl(g), with excess NH₃ added", 2, 2, "Phase rule"), conc("Computational", "What is computational chemistry? Name two quantum methods and one classical method.", "Simulating chemical systems at the atomic level; quantum: ab initio, DFT (semi-empirical); classical: molecular mechanics/dynamics."))

if __name__ == "__main__":
    Q.build()
