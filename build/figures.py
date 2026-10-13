"""Vector figures for the Unit 1 pack. Run: python3 build/figures.py"""
import re
import numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

O = "/home/user/blank/output/assets/figures/"
INK, MUTED, RULE = "#1b1f24", "#5b6470", "#c9d1db"
BL, GR, VI, AM = "#1f5fa8", "#2e7d4f", "#7a4fb3", "#b26b00"
plt.rcParams.update({
    "svg.fonttype": "none", "font.family": "DejaVu Sans", "font.size": 9,
    "axes.edgecolor": INK, "axes.linewidth": 0.9, "axes.labelcolor": INK,
    "axes.titlesize": 9.5, "axes.titleweight": "bold", "axes.titlelocation": "left",
    "axes.spines.top": False, "axes.spines.right": False,
    "xtick.color": MUTED, "ytick.color": MUTED, "lines.linewidth": 1.6,
    "legend.frameon": False, "legend.fontsize": 7.5,
})


def save(name):
    path = O + name + ".svg"
    plt.savefig(path, format="svg", bbox_inches="tight", transparent=True)
    plt.close()
    s = open(path).read()
    s = re.sub(r"font-family:\s*'?DejaVu Sans'?", "font-family:Inter, sans-serif", s)
    open(path, "w").write(s)


def bare(ax):
    ax.set_xticks([]); ax.set_yticks([])


# G9 rigid-rotor levels
fig, ax = plt.subplots(figsize=(4.3, 3.6))
for J in range(7):
    e = J * (J + 1)
    ax.hlines(e, 0, 1, color=BL, lw=1.8)
    ax.text(1.04, e, f"J = {J}", va="center", fontsize=8, color=INK)
    ax.text(1.38, e, f"{e}B" if e else "0", va="center", fontsize=8, color=MUTED)
    if J < 6:
        x = 0.12 + 0.13 * J
        ax.annotate("", xy=(x, (J + 1) * (J + 2)), xytext=(x, e),
                    arrowprops=dict(arrowstyle="-|>", color=AM, lw=1.1))
        ax.text(x, (e + (J + 1) * (J + 2)) / 2, f" {2*(J+1)}B", fontsize=6.5, color=AM, va="center")
ax.set_xlim(0, 1.7); ax.set_ylim(-3, 46); bare(ax); ax.spines["bottom"].set_visible(False)
ax.set_ylabel(r"$\varepsilon_J$ (cm$^{-1}$)")
ax.set_title("Rotational levels and ΔJ = +1 absorptions")
save("G9")

# G10 rotational stick spectrum
fig, ax = plt.subplots(figsize=(4.8, 2.5))
J = np.arange(0, 10); I = (2 * J + 1) * np.exp(-J * (J + 1) / 22)
ax.vlines(2 * (J + 1), 0, I / I.max(), color=BL, lw=2.2)
ax.annotate("", xy=(4, 1.08), xytext=(2, 1.08), arrowprops=dict(arrowstyle="<->", color=AM, lw=1))
ax.text(3, 1.12, "2B", ha="center", color=AM, fontsize=8)
ax.set_xticks(2 * (J + 1)); ax.set_xticklabels([f"{2*(j+1)}B" for j in J], fontsize=7)
ax.set_yticks([]); ax.set_ylim(0, 1.25); ax.set_xlabel(r"wavenumber (cm$^{-1}$)")
ax.set_title("First line at 2B, constant spacing 2B")
save("G10")

# G13 SHO
fig, ax = plt.subplots(figsize=(4.0, 3.4))
r = np.linspace(-1.75, 1.75, 300); ax.plot(r, r ** 2, color=BL)
for v in range(6):
    e = v + .5; x = np.sqrt(e)
    ax.hlines(e, -x, x, color=INK, lw=.9)
    ax.text(1.85, e, f"v = {v}", va="center", fontsize=7.5)
ax.annotate("", xy=(-0.25, 1.5), xytext=(-0.25, 0.5), arrowprops=dict(arrowstyle="-|>", color=AM))
ax.text(-0.2, 1.0, r" $\bar\nu_{osc}$", color=AM, fontsize=8, va="center")
ax.text(0.95, 0.42, r"$\varepsilon_0=\frac{1}{2}\bar\nu_{osc}$", fontsize=8, color=MUTED)
ax.set_xlim(-1.9, 2.5); ax.set_ylim(0, 3.2); bare(ax)
ax.set_xlabel(r"$r-r_{eq}$"); ax.set_ylabel("potential energy")
ax.set_title("Parabolic potential, equally spaced levels")
save("G13")

# G15 Morse vs harmonic
fig, ax = plt.subplots(figsize=(4.4, 3.6))
r = np.linspace(-.6, 4.2, 400); a = 1.2; V = (1 - np.exp(-a * r)) ** 2
ax.plot(r, V, color=VI, label="Morse (anharmonic)")
ax.plot(r, (a * r) ** 2, "--", color=BL, lw=1.2, label="harmonic")
ax.axhline(1, color=MUTED, ls=":", lw=1)
ax.text(4.1, 1.03, r"dissociation limit,  $D_{eq}$", fontsize=7.5, ha="right", color=MUTED)
for v in range(9):
    e = (v + .5) * .2 - (v + .5) ** 2 * .0115
    if e < 1:
        m = r[V <= e]; ax.hlines(e, m.min(), m.max(), lw=.8, color=INK)
ax.text(2.6, 1.25, "continuum", fontsize=7.5, color=MUTED)
ax.legend(loc="upper right", bbox_to_anchor=(1, .82))
ax.set_ylim(0, 1.45); ax.set_xlim(-.7, 4.2); bare(ax)
ax.set_xlabel("internuclear distance r"); ax.set_ylabel("potential energy")
ax.set_title("Morse curve: levels converge towards dissociation")
save("G15")

# G17 anharmonic spectrum
we, xe = 2000, .02
fig, ax = plt.subplots(figsize=(4.8, 2.5))
lines = [("hot band 1→2", we * (1 - 4 * xe), .28), ("fundamental 0→1", we * (1 - 2 * xe), 1),
         ("1st overtone 0→2", 2 * we * (1 - 3 * xe), .32), ("2nd overtone 0→3", 3 * we * (1 - 4 * xe), .1)]
for k, x, hgt in lines:
    ax.vlines(x, 0, hgt, color=GR, lw=2.4)
    ax.text(x, hgt + .04, k, rotation=55, fontsize=7, ha="left", va="bottom")
ax.set_ylim(0, 1.7); ax.set_yticks([]); ax.set_xticks([])
ax.set_xlabel("wavenumber →  (schematic)")
ax.set_title("Hot band sits left of the fundamental")
save("G17")

# G21 Franck–Condon three cases
fig, axs = plt.subplots(2, 3, figsize=(7.2, 4.6), gridspec_kw={"height_ratios": [2.1, 1]})
r = np.linspace(.6, 5.2, 300)
cases = [(0, "(a)  r$_e'$ = r$_e''$", [1, .5, .22, .1, .04]),
         (.75, "(b)  r$_e'$ > r$_e''$", [.18, .55, 1, .7, .3]),
         (2.3, "(c)  r$_e'$ ≫ r$_e''$", None)]
for i, (shift, t, inten) in enumerate(cases):
    ax = axs[0, i]
    ax.plot(r, (1 - np.exp(-1.3 * (r - 1.5))) ** 2, color=BL, label="ground")
    ax.plot(r, 2 + (1 - np.exp(-1.3 * (r - 1.5 - shift))) ** 2, color=VI, label="excited")
    top = 2 + (1 - np.exp(-1.3 * (-shift))) ** 2
    ax.annotate("", xy=(1.5, min(top, 3.9)), xytext=(1.5, .06), arrowprops=dict(arrowstyle="-|>", lw=1.6, color=AM))
    ax.set_title(t, fontsize=8.5); bare(ax); ax.set_ylim(0, 4)
    if i == 0: ax.legend(loc="upper right", fontsize=6.5)
    ax = axs[1, i]
    if inten:
        ax.vlines(range(5), 0, inten, color=GR, lw=2.4)
        ax.set_xticks(range(5)); ax.set_xticklabels([f"({k},0)" for k in range(5)], fontsize=6)
    else:
        xx = np.linspace(2.4, 6, 60)
        ax.fill_between(xx, 0, np.sqrt((xx - 2.3) / 3.7), color=GR, alpha=.35)
        ax.vlines([0, .9, 1.7], 0, [.15, .25, .35], color=GR, lw=2)
        ax.text(4.2, .9, "continuum", fontsize=7, ha="center"); ax.set_xticks([])
    ax.set_yticks([]); ax.set_ylim(0, 1.15)
fig.tight_layout()
save("G21")

# G22 water phase diagram (schematic coordinates)
fig, ax = plt.subplots(figsize=(5.2, 4.2))
Ox, Oy = 3.0, 2.2
xb = np.linspace(0.2, Ox, 60); yb = Oy * np.exp((xb - Ox) / 0.9)
xa = np.linspace(Ox, 9.0, 80); ya = Oy + (8.6 - Oy) * ((xa - Ox) / 6.0) ** 1.8
ax.plot(xb, yb, color=GR, label="OB  sublimation (ice ⇌ vapour)")
ax.plot(xa, ya, color=BL, label="OA  vaporisation (water ⇌ vapour)")
ax.plot([Ox, 2.55], [Oy, 9.6], color=VI, label="OC  fusion (ice ⇌ water), slope < 0")
xm = np.linspace(1.0, Ox, 40)
ax.plot(xm, Oy * np.exp((xm - Ox) / 1.6), ls="--", color=INK, lw=1.2, label="OA′  supercooled water (metastable)")
ax.axhline(5.0, color=MUTED, ls=":", lw=1)
ax.text(9.6, 5.08, "1 atm", fontsize=7, color=MUTED, ha="right")
x100 = Ox + 6.0 * ((5.0 - Oy) / (8.6 - Oy)) ** (1 / 1.8)
x0 = Ox + (2.55 - Ox) * (5.0 - Oy) / (9.6 - Oy)
for x, s in [(x0, "0 °C"), (x100, "100 °C")]:
    ax.plot(x, 5.0, "o", ms=3.5, color=INK); ax.text(x + .1, 4.6, s, fontsize=7)
ax.plot(Ox, Oy, "o", ms=5, color=AM); ax.plot(9.0, 8.6, "o", ms=5, color=AM)
ax.text(Ox + .15, Oy - .55, "O  triple point\n0.0098 °C, 4.58 mmHg · F = 0", fontsize=7)
ax.text(8.9, 8.85, "A  critical point\n374 °C, 218 atm", fontsize=7, ha="right")
for x, y, s in [(1.1, 7.2, "ICE\nF = 2"), (5.2, 7.4, "WATER\nF = 2"), (7.4, 2.0, "VAPOUR\nF = 2")]:
    ax.text(x, y, s, fontsize=8.5, ha="center", fontweight="bold", color=INK)
ax.set_xlim(0, 9.8); ax.set_ylim(0, 10); bare(ax)
ax.set_xlabel("temperature →"); ax.set_ylabel("pressure →")
ax.legend(loc="upper left", bbox_to_anchor=(0, -0.08), ncol=2, fontsize=6.8)
ax.set_title("Water: one-component system (not to scale)")
save("G22")

# G23 Pb–Ag eutectic (schematic x positions)
fig, ax = plt.subplots(figsize=(5.0, 3.8))
ex, ey = 18, 303
ax.plot([0, ex], [327, ey], color=BL, label="AO  freezing-point curve of Pb")
ax.plot([ex, 100], [ey, 961], color=GR, label="BO  freezing-point curve of Ag")
ax.hlines(ey, 0, 100, color=INK, lw=1.1); ax.vlines(ex, 200, ey, color=MUTED, ls=":", lw=1)
for x, y, s in [(0, 327, "A  Pb, 327 °C"), (100, 961, "B  Ag, 961 °C")]:
    ax.plot(x, y, "o", ms=5, color=AM)
    ax.text(x + (2 if x == 0 else -2), y + 25, s, fontsize=7.5, ha="left" if x == 0 else "right")
ax.plot(ex, ey, "o", ms=5, color=AM)
ax.text(ex + 2, ey - 32, "O  eutectic: 303 °C, 2.6 % Ag, 97.4 % Pb · F = 0", fontsize=7)
for x, y, s in [(30, 820, "Liquid melt\nF = 2"), (60, 520, "Solid Ag + melt\nF = 1"),
                (5, 330, "Pb +\nmelt"), (50, 245, "Solid Pb + solid Ag (eutectic)")]:
    ax.text(x, y, s, fontsize=8, ha="center", fontweight="bold" if "\nF" in s else "normal")
ax.set_xlim(-2, 102); ax.set_ylim(200, 1020)
ax.set_xticks([0, ex, 100]); ax.set_xticklabels(["100 % Pb", "2.6 % Ag", "100 % Ag"], fontsize=7)
ax.set_ylabel("temperature (°C)"); ax.set_xlabel("composition (constant pressure)")
ax.legend(loc="upper left", fontsize=6.8)
ax.set_title("Pb–Ag eutectic system (not to scale)")
save("G23")

# G24 cooling curves
fig, axs = plt.subplots(1, 3, figsize=(7.0, 2.6), sharey=True)
t = np.linspace(0, 10, 200)
pure = np.piecewise(t, [t < 3, (t >= 3) & (t < 6.5), t >= 6.5], [lambda t: 10 - 1.4 * t, 5.8, lambda t: 5.8 - (t - 6.5) * .9])
mix = np.piecewise(t, [t < 2.5, (t >= 2.5) & (t < 5.5), (t >= 5.5) & (t < 8), t >= 8],
                   [lambda t: 10 - 1.4 * t, lambda t: 6.5 - .55 * (t - 2.5), 4.85, lambda t: 4.85 - (t - 8) * .8])
eut = np.piecewise(t, [t < 3.7, (t >= 3.7) & (t < 7.5), t >= 7.5], [lambda t: 10 - 1.4 * t, 4.82, lambda t: 4.82 - (t - 7.5) * .8])
for ax, y, c, ttl, marks in [(axs[0], pure, BL, "Pure metal", [(3, 5.8, "halt")]),
                             (axs[1], mix, GR, "Mixture", [(2.5, 6.5, "break"), (5.5, 4.85, "eutectic halt")]),
                             (axs[2], eut, VI, "Eutectic composition", [(3.7, 4.82, "single halt")])]:
    ax.plot(t, y, color=c)
    for x, yy, s in marks:
        ax.plot(x, yy, "o", ms=3.5, color=AM); ax.text(x + .3, yy + .35, s, fontsize=7)
    ax.set_title(ttl, fontsize=8.5); ax.set_xlabel("time →"); bare(ax)
axs[0].set_ylabel("temperature →")
fig.tight_layout()
save("G24")

# G25 ethane torsion
th = np.linspace(0, 360, 361)
fig, ax = plt.subplots(figsize=(4.4, 2.5))
ax.plot(th, 1.5 * (1 - np.cos(np.radians(3 * th))), color=VI)
ax.annotate("", xy=(60, 3.0), xytext=(60, 0), arrowprops=dict(arrowstyle="<->", color=AM))
ax.text(66, 1.5, "≈ 3.0 kcal/mol", fontsize=7.5, color=AM)
ax.text(0, -.55, "staggered", fontsize=7, ha="left", color=MUTED); ax.text(60, 3.15, "eclipsed", fontsize=7, ha="center", color=MUTED)
ax.set_xticks(range(0, 361, 60)); ax.set_ylim(-.8, 3.6)
ax.set_xlabel("H–C–C–H dihedral angle (°)"); ax.set_ylabel("E (kcal/mol)")
ax.set_title("Ethane rotational barrier")
save("G25")
print("figures ok")
