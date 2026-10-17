"""Figures for Unit 2 class 001: electrode potential and cell potential (schematics drawn with patches)."""
import numpy as np
from matplotlib.patches import Rectangle, FancyBboxPatch, Circle, Polygon, FancyArrowPatch
from figstyle import BLUE, VERM, GREEN, PURPLE, ORANGE, INK, MUTED, GUIDE, TINT, CURVE, DASH, REF, save, axes2d

GREY = "#9aa0a6"
METAL = "#c9ccd1"


def blank(w, h, xl, yl):
    fig, ax = axes2d(w, h)
    ax.set_xlim(*xl); ax.set_ylim(*yl); ax.set_aspect("equal"); ax.axis("off")
    return fig, ax


def arrow(ax, p, q, col=INK, lw=1.8, style="-|>", ms=14, ls="-", rad=0.0, z=6):
    a = FancyArrowPatch(p, q, arrowstyle=style, mutation_scale=ms, color=col, lw=lw, linestyle=ls,
                        connectionstyle=f"arc3,rad={rad}", zorder=z, shrinkA=0, shrinkB=0)
    ax.add_patch(a)


def beaker(ax, x0, y0, w, h, level, tint):
    ax.add_patch(Rectangle((x0, y0), w, level, facecolor=tint, edgecolor="none", zorder=1))
    ax.plot([x0, x0, x0 + w, x0 + w], [y0 + h, y0, y0, y0 + h], color=INK, lw=2.0, zorder=3)


def electrode(ax, x, y0, y1, w, face, label, lcol=INK):
    ax.add_patch(Rectangle((x - w / 2, y0), w, y1 - y0, facecolor=face, edgecolor=INK, lw=1.4, zorder=4))
    if label:
        ax.text(x, y0 + (y1 - y0) * 0.55, label, rotation=90, ha="center", va="center", fontsize=12, color=lcol, zorder=5)


# ---------------------------------------------------------------- G1.1 electrolytic cell
def electrolytic(path):
    fig, ax = blank(7.0, 6.1, (0, 10), (-1.8, 7.6))
    beaker(ax, 2.0, 0.4, 6.0, 4.0, 3.2, TINT["blue"])
    ax.text(5.0, 0.75, r"$\mathrm{CuSO_4}$ solution (electrolyte)", ha="center", fontsize=12, color=BLUE)
    electrode(ax, 3.2, 1.6, 5.4, 0.55, "#e6b48a", r"Cu (anode, +)")
    electrode(ax, 6.8, 1.6, 5.4, 0.55, METAL, r"object (cathode, $-$)")
    # wires and battery
    ax.plot([3.2, 3.2, 4.45], [5.4, 6.4, 6.4], color=INK, lw=1.8)
    ax.plot([5.55, 6.8, 6.8], [6.4, 6.4, 5.4], color=INK, lw=1.8)
    ax.plot([4.45, 4.45], [6.0, 6.8], color=INK, lw=2.4)      # long plate (+)
    ax.plot([4.75, 4.75], [6.15, 6.65], color=INK, lw=4.0)    # short plate (-)
    ax.plot([4.75, 5.55], [6.4, 6.4], color=INK, lw=1.8)
    ax.text(4.25, 6.85, "+", fontsize=15, ha="center"); ax.text(5.0, 6.85, r"$-$", fontsize=15, ha="center")
    ax.text(4.6, 7.35, "external power supply", fontsize=11, ha="center", va="bottom", color=MUTED)
    # electron flow
    arrow(ax, (3.35, 6.0), (4.05, 6.0), col=VERM)
    ax.text(3.0, 5.75, r"$e^-$", color=VERM, fontsize=13, ha="right")
    arrow(ax, (5.95, 6.0), (6.65, 6.0), col=VERM)
    ax.text(7.0, 5.75, r"$e^-$", color=VERM, fontsize=13, ha="left")
    # reactions (below the beaker)
    ax.text(3.2, -0.15, "oxidation at anode:\n" + r"$\mathrm{Cu\rightarrow Cu^{2+}+2e^-}$", fontsize=12, ha="center", va="top")
    ax.text(6.8, -0.15, "reduction at cathode:\n" + r"$\mathrm{Cu^{2+}+2e^-\rightarrow Cu}$", fontsize=12, ha="center", va="top")
    arrow(ax, (3.7, 2.6), (6.3, 2.6), col=BLUE, ls="--")
    ax.text(5.0, 2.75, r"$\mathrm{Cu^{2+}}$ migrates", color=BLUE, fontsize=12, ha="center", va="bottom")
    ax.text(5.0, -1.55, r"non-spontaneous reaction ($\Delta G>0$) driven by the external supply", fontsize=11.5, ha="center", color=MUTED)
    save(fig, path)


# ---------------------------------------------------------------- G2.x double layer
def double_layer(path, case):
    fig, ax = blank(7.0, 4.9, (0, 10), (0, 7.0))
    ax.add_patch(Rectangle((2.0, 0.3), 7.6, 5.4, facecolor=TINT["blue"], edgecolor="none", zorder=0))
    ax.plot([2.0, 9.6], [5.7, 5.7], color=BLUE, lw=1.0, ls=REF)
    ax.text(9.55, 5.85, r"solution of $\mathrm{M^{n+}}$", color=BLUE, fontsize=12, ha="right", va="bottom")
    ax.add_patch(Rectangle((0.9, 0.9), 1.1, 6.0, facecolor=METAL, edgecolor=INK, lw=1.4, zorder=3))
    ax.text(1.45, 6.4, "M", fontsize=14, ha="center", va="center", zorder=5)
    ys = np.linspace(1.2, 5.3, 9)
    metal_sign, sol_sign = ("$-$", "+") if case == 1 else ("+", "$-$")
    mcol, scol = (VERM, BLUE) if case == 1 else (BLUE, VERM)
    for y in ys:
        ax.text(1.8, y, metal_sign, fontsize=15, ha="center", va="center", color=mcol, zorder=6)
        ax.text(2.45, y, sol_sign, fontsize=15, ha="center", va="center", color=scol, zorder=6)
    # bracket for double layer
    ax.plot([1.65, 1.65, 2.65, 2.65], [0.55, 0.4, 0.4, 0.55], color=INK, lw=1.4)
    ax.text(2.15, 0.05, "Helmholtz electrical double layer", fontsize=12, ha="left", va="center")
    # bulk ions on a loose grid (no overlaps)
    for i, x in enumerate((5.0, 6.4, 7.8, 9.1)):
        for j, y in enumerate((0.75, 1.65)):
            lab = r"$\mathrm{M^{n+}}$" if (i + j) % 2 == 0 else r"$\mathrm{A^{-}}$"
            ax.text(x, y, lab, fontsize=10.5, color=MUTED, ha="center", va="center")
    if case == 1:
        arrow(ax, (2.75, 4.6), (4.1, 4.6), col=VERM, lw=2.2)
        ax.text(4.25, 4.6, r"ionisation (faster): $\mathrm{M\rightarrow M^{n+}+ne^-}$", fontsize=12, va="center")
        ax.text(4.25, 3.6, "electrons stay on the metal:\nmetal becomes negative", fontsize=12, va="center", color=VERM)
        ax.text(4.25, 2.55, r"metal attracts a layer of $\mathrm{M^{n+}}$ (+)", fontsize=12, va="center", color=BLUE)
    else:
        arrow(ax, (4.1, 4.6), (2.75, 4.6), col=VERM, lw=2.2)
        ax.text(4.25, 4.6, r"deposition (faster): $\mathrm{M^{n+}+ne^-\rightarrow M}$", fontsize=12, va="center")
        ax.text(4.25, 3.6, "electrons taken from the metal:\nmetal becomes positive", fontsize=12, va="center", color=BLUE)
        ax.text(4.25, 2.55, "metal attracts a layer of anions ($-$)", fontsize=12, va="center", color=VERM)
    save(fig, path)


def case1(path):
    double_layer(path, 1)


def case2(path):
    double_layer(path, 2)


# ---------------------------------------------------------------- G3.1 Daniell cell
def daniell(path):
    fig, ax = blank(7.0, 6.0, (0, 12), (-1.6, 8.7))
    beaker(ax, 0.6, 0.6, 4.2, 4.2, 3.3, TINT["blue"])
    beaker(ax, 7.2, 0.6, 4.2, 4.2, 3.3, TINT["green"])
    electrode(ax, 2.2, 1.6, 6.2, 0.6, METAL, "Zn")
    electrode(ax, 9.8, 1.6, 6.2, 0.6, "#e6b48a", "Cu")
    ax.text(2.7, 0.95, r"$\mathrm{ZnSO_4}$ (1 M)", fontsize=11.5, color=BLUE, ha="center")
    ax.text(9.3, 0.95, r"$\mathrm{CuSO_4}$ (1 M)", fontsize=11.5, color=GREEN, ha="center")
    # salt bridge (inverted U)
    sb = dict(color=PURPLE, lw=9, solid_capstyle="butt", alpha=0.35)
    ax.plot([3.8, 3.8, 8.2, 8.2], [2.4, 5.6, 5.6, 2.4], **sb)
    ax.plot([3.8, 3.8, 8.2, 8.2], [2.4, 5.6, 5.6, 2.4], color=PURPLE, lw=1.0)
    ax.text(6.0, 5.95, "salt bridge (KCl in agar)", color=PURPLE, fontsize=11.5, ha="center", va="bottom")
    # wire + voltmeter
    ax.plot([2.2, 2.2, 5.45], [6.2, 7.7, 7.7], color=INK, lw=1.8)
    ax.plot([6.55, 9.8, 9.8], [7.7, 7.7, 6.2], color=INK, lw=1.8)
    ax.add_patch(Circle((6.0, 7.7), 0.55, facecolor="white", edgecolor=INK, lw=1.8, zorder=5))
    ax.text(6.0, 7.7, "V", fontsize=14, ha="center", va="center", zorder=6)
    ax.text(6.0, 8.35, r"$E^\circ_{cell}=1.10$ V", fontsize=12, ha="center", va="bottom")
    arrow(ax, (3.0, 7.95), (4.8, 7.95), col=VERM)
    ax.text(3.9, 8.1, r"$e^-$ flow", color=VERM, fontsize=12, ha="center", va="bottom")
    # labels
    ax.text(1.9, 6.75, "anode ($-$)", fontsize=12, ha="right", va="center")
    ax.text(10.1, 6.75, "cathode (+)", fontsize=12, ha="left", va="center")
    ax.text(2.7, 0.0, "LHS, oxidation:\n" + r"$\mathrm{Zn\rightarrow Zn^{2+}+2e^-}$", fontsize=11.5, ha="center", va="top")
    ax.text(9.3, 0.0, "RHS, reduction:\n" + r"$\mathrm{Cu^{2+}+2e^-\rightarrow Cu}$", fontsize=11.5, ha="center", va="top")
    save(fig, path)


# ---------------------------------------------------------------- G3.2 cell notation anatomy
def notation(path):
    fig, ax = blank(7.0, 3.0, (0, 13), (0, 5.6))
    toks = [(0.9, r"$\mathrm{Zn(s)}$"), (2.2, r"$|$"), (3.75, r"$\mathrm{Zn^{2+}(1\,M)}$"), (5.55, r"$||$"),
            (7.35, r"$\mathrm{Cu^{2+}(1\,M)}$"), (8.9, r"$|$"), (10.2, r"$\mathrm{Cu(s)}$")]
    for x, t in toks:
        ax.text(x, 3.2, t, fontsize=17, ha="center", va="center")
    for x0, x1, lab, col in ((0.1, 4.95, "anode half-cell (LHS)\noxidation", VERM), (6.15, 11.0, "cathode half-cell (RHS)\nreduction", BLUE)):
        ax.plot([x0, x0, x1, x1], [2.45, 2.2, 2.2, 2.45], color=col, lw=1.6)
        ax.text((x0 + x1) / 2, 1.95, lab, fontsize=12, ha="center", va="top", color=col)
    arrow(ax, (2.2, 5.0), (2.2, 3.85), col=MUTED, lw=1.3)
    arrow(ax, (8.9, 5.0), (8.9, 3.85), col=MUTED, lw=1.3)
    ax.text(2.05, 5.2, "phase boundary", fontsize=11.5, color=MUTED, ha="right", va="center")
    ax.text(9.05, 5.2, "phase boundary", fontsize=11.5, color=MUTED, ha="left", va="center")
    arrow(ax, (5.55, 5.0), (5.55, 3.85), col=PURPLE, lw=1.3)
    ax.text(5.55, 5.2, "salt bridge", fontsize=11.5, color=PURPLE, ha="center", va="bottom")
    ax.text(12.9, 1.0, r"$E_{cell}=E_{R}-E_{L}$", fontsize=13, ha="right", va="center")
    save(fig, path)


# ---------------------------------------------------------------- G4.1 potential ladder
def ladder(path):
    fig, ax = axes2d(7.0, 4.6)
    ax.set_xlim(0, 10); ax.set_ylim(-1.0, 0.65)
    ax.spines["bottom"].set_visible(False); ax.set_xticks([])
    ax.set_yticks([-1.0, -0.76, -0.5, 0, 0.34, 0.5])
    ax.set_ylabel(r"$E^\circ$ (V, reduction)", fontsize=13, loc="top")
    for e, lab, col in ((-0.76, r"$\mathrm{Zn^{2+}/Zn}$  $-0.76$ V", VERM), (0.0, r"$\mathrm{H^+/H_2}$ (SHE)  0.00 V", MUTED), (0.34, r"$\mathrm{Cu^{2+}/Cu}$  $+0.34$ V", BLUE)):
        ax.plot([0.3, 4.2], [e, e], color=col, lw=CURVE if col != MUTED else 1.4, ls="-" if col != MUTED else REF)
        ax.text(0.3, e + 0.03, lab, color=col, fontsize=12, va="bottom")
    arrow(ax, (5.0, -0.76), (5.0, 0.34), col=INK, style="<|-|>", lw=1.8)
    ax.text(5.25, -0.21, r"$E^\circ_{cell}=0.34-(-0.76)=1.10$ V", fontsize=13, va="center")
    ax.text(5.25, 0.45, "higher = cathode (reduced)", fontsize=12, color=BLUE, va="center")
    ax.text(5.25, -0.9, "lower = anode (oxidised)", fontsize=12, color=VERM, va="center")
    save(fig, path)


# ---------------------------------------------------------------- G5.1 electrochemical series
SERIES_DATA = [("Li^+/Li", -3.03), ("K^+/K", -2.92), ("Ca^{2+}/Ca", -2.87), ("Na^+/Na", -2.71), ("Mg^{2+}/Mg", -2.37),
               ("Al^{3+}/Al", -1.66), ("Zn^{2+}/Zn", -0.76), ("Fe^{2+}/Fe", -0.44), ("Pb^{2+}/Pb", -0.13),
               ("2H^+/H_2", 0.00), ("Cu^{2+}/Cu", 0.34), ("Ag^+/Ag", 0.80), ("Au^{3+}/Au", 1.50)]


def series(path):
    fig, ax = axes2d(7.0, 6.4)
    n = len(SERIES_DATA)
    for i, (lab, e) in enumerate(SERIES_DATA):
        y = n - 1 - i
        col = VERM if e < 0 else (BLUE if e > 0 else MUTED)
        ax.barh(y, e, height=0.62, color=col, alpha=0.85 if e else 1)
        ax.text(-3.12, y, r"$\mathrm{" + lab + "}$", fontsize=12, ha="right", va="center")
        txt = f"{e:+.2f}".replace("-", "$-$") if e else "0.00"
        ax.text(max(e, 0) + 0.06, y, txt, fontsize=11.5, ha="left", va="center", color=col)
    ax.axvline(0, color=INK, lw=1.0)
    ax.set_xlim(-4.3, 2.9); ax.set_ylim(-0.8, n - 0.2)
    ax.set_yticks([]); ax.spines["left"].set_visible(False)
    ax.set_xticks([-3, -2, -1, 0, 1, 2])
    ax.set_xlabel(r"standard reduction potential $E^\circ$ (V)", fontsize=13, loc="right")
    arrow(ax, (1.55, 4.0), (1.55, 11.6), col=VERM, lw=2.0)
    ax.text(1.75, 7.8, "metal is a stronger\nreducing agent,\noxidised more easily", fontsize=11.5, color=VERM, va="center")
    arrow(ax, (-2.2, 4.6), (-2.2, 0.4), col=BLUE, lw=2.0)
    ax.text(-2.05, 2.5, "ion is a stronger\noxidising agent,\nreduced more easily", fontsize=11.5, color=BLUE, va="center")
    save(fig, path)


# ---------------------------------------------------------------- G5.2 scratched coatings
def coatings(path):
    fig, axs = __import__("matplotlib.pyplot", fromlist=["subplots"]).subplots(2, 1, figsize=(7.0, 6.6))
    for ax, coat, ecoat, galv in ((axs[0], "Zn", "-0.76", True), (axs[1], "Sn", "-0.14", False)):
        ax.set_xlim(0, 12); ax.set_ylim(-0.6, 5.6); ax.set_aspect("equal"); ax.axis("off")
        ax.add_patch(Rectangle((0.5, 0.2), 11.0, 1.4, facecolor=METAL, edgecolor=INK, lw=1.2))
        ax.text(1.0, 0.9, r"iron, $E^\circ=-0.44$ V", fontsize=12, va="center")
        ccol = TINT["blue"] if galv else TINT["purple"]
        ax.add_patch(Rectangle((0.5, 1.6), 4.8, 0.55, facecolor=ccol, edgecolor=INK, lw=1.2))
        ax.add_patch(Rectangle((6.7, 1.6), 4.8, 0.55, facecolor=ccol, edgecolor=INK, lw=1.2))
        ax.text(0.7, 1.87, f"{coat} coating, " + r"$E^\circ=" + ecoat + r"$ V", fontsize=11.5, va="center")
        ax.add_patch(Polygon([[5.0, 1.6], [7.0, 1.6], [7.6, 2.15], [7.6, 2.75], [6.0, 3.15], [4.4, 2.75], [4.4, 2.15]],
                             closed=True, facecolor=TINT["green"], edgecolor=GREEN, lw=1.2, alpha=0.9))
        ax.text(4.3, 3.0, "moist film", fontsize=10.5, color=GREEN, ha="right", va="center")
        if galv:
            ax.text(0.5, 5.3, r"(a) galvanised: Zn more active $\Rightarrow$ Zn is the anode", fontsize=12.5, va="center")
            ax.text(2.6, 3.95, r"anode: $\mathrm{Zn\rightarrow Zn^{2+}+2e^-}$", fontsize=11.5, color=VERM, ha="center")
            arrow(ax, (2.6, 3.75), (2.6, 2.25), col=VERM, lw=1.6)
            ax.text(9.4, 3.95, "cathode (exposed Fe):\n" + r"$\mathrm{O_2+2H_2O+4e^-\rightarrow 4OH^-}$", fontsize=11.0, color=BLUE, ha="center")
            arrow(ax, (8.4, 3.85), (6.5, 1.75), col=BLUE, lw=1.6)
            ax.text(6.0, -0.3, "iron is protected (sacrificial / cathodic protection) until the zinc is used up", fontsize=11.5, ha="center", color=MUTED)
        else:
            ax.text(0.5, 5.3, r"(b) tinned: Fe more active $\Rightarrow$ exposed Fe is the anode", fontsize=12.5, va="center")
            ax.text(6.0, 3.95, r"anode (small): $\mathrm{Fe\rightarrow Fe^{2+}+2e^-}$", fontsize=11.5, color=VERM, ha="center")
            arrow(ax, (6.0, 3.75), (6.0, 1.7), col=VERM, lw=1.6)
            ax.add_patch(Polygon([[5.4, 1.6], [6.6, 1.6], [6.0, 0.95]], closed=True, facecolor="#8a5a44", edgecolor=INK, lw=1.0))
            ax.text(9.3, 2.85, "large Sn cathode", fontsize=11.5, color=BLUE, ha="center")
            ax.text(6.0, -0.3, "small anode, large cathode: intense local corrosion (pitting) of the exposed iron", fontsize=11.5, ha="center", color=MUTED)
    fig.tight_layout(h_pad=0.4)
    save(fig, path)


FIGURES = {"G1.1": electrolytic, "G2.1": case1, "G2.2": case2, "G3.1": daniell, "G3.2": notation,
           "G4.1": ladder, "G5.1": series, "G5.2": coatings}
