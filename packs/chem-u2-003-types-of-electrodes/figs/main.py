"""Figures for class 003: types of electrodes (schematics redrawn with figstyle; not to scale)."""
import numpy as np
from matplotlib.patches import Rectangle, FancyBboxPatch, Circle, Ellipse, Polygon, FancyArrowPatch
from figstyle import BLUE, VERM, GREEN, PURPLE, ORANGE, INK, MUTED, GUIDE, TINT, CURVE, DASH, REF, save, axes2d

SOL = TINT["blue"]
METAL = "#9aa0a6"


def canvas(w, h, xl, yl):
    fig, ax = axes2d(w, h)
    ax.set_xlim(*xl); ax.set_ylim(*yl); ax.set_aspect("equal"); ax.axis("off")
    return fig, ax


def beaker(ax, x0, x1, y0, ylev, ytop, fill=SOL):
    ax.add_patch(Rectangle((x0, y0), x1 - x0, ylev - y0, fc=fill, ec="none", zorder=1))
    ax.plot([x0, x0, x1, x1], [ytop, y0, y0, ytop], color=INK, lw=2.2, zorder=4)
    ax.plot([x0, x1], [ylev, ylev], color=BLUE, lw=1.2, zorder=2)


def label(ax, xy, xyt, text, color=INK, ha="left", fs=12.5):
    ax.annotate(text, xy=xy, xytext=xyt, fontsize=fs, color=color, ha=ha, va="center",
                arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.9, shrinkA=2, shrinkB=1), zorder=6)


def arrow(ax, p, q, color=INK, lw=1.8, rad=0.0):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle="-|>", mutation_scale=14, color=color, lw=lw,
                                 connectionstyle=f"arc3,rad={rad}", zorder=7))


# ---------------------------------------------------------------- G2.1 metal–metal ion electrode
def metal_ion(path):
    fig, ax = canvas(7, 4.6, (0, 12), (-0.6, 7.4))
    beaker(ax, 1, 6.6, 0, 4.4, 5.6)
    ax.add_patch(Rectangle((3.3, 0.8), 1.0, 6.0, fc=METAL, ec=INK, lw=1.4, zorder=3))
    rng = np.random.default_rng(3)
    for (x, y) in [(1.8, 1.0), (2.4, 2.6), (1.7, 3.6), (5.2, 1.4), (5.8, 3.0), (5.0, 3.9), (2.6, 0.5), (5.9, 0.6)]:
        ax.text(x, y, r"$\mathrm{Zn^{2+}}$", fontsize=11, color=BLUE, ha="center", va="center", zorder=5)
    for (x, y) in [(2.0, 1.9), (5.5, 2.3)]:
        ax.text(x, y, r"$\mathrm{SO_4^{2-}}$", fontsize=10, color=MUTED, ha="center", va="center", zorder=5)
    # double layer charges
    for y in np.linspace(1.2, 4.0, 5):
        ax.text(3.18, y, "+", fontsize=11, color=VERM, ha="center", va="center", zorder=6)
    label(ax, (4.3, 6.2), (7.4, 6.6), r"metal rod M ($\mathrm{Zn}$)")
    label(ax, (6.0, 3.3), (7.4, 4.9), r"solution of its own ions" + "\n" + r"$\mathrm{M^{n+}}$ ($\mathrm{ZnSO_4}$)", color=BLUE)
    label(ax, (3.2, 2.5), (7.4, 2.6), "potential develops at the\nmetal–solution interface", color=VERM)
    ax.text(7.4, 0.6, r"$\mathrm{M^{n+}+ne^-\rightleftharpoons M}$", fontsize=13)
    ax.text(7.4, -0.3, r"$\mathrm{Zn\,|\,Zn^{2+}}$", fontsize=13)
    save(fig, path)


# ---------------------------------------------------------------- G3.1 Ag/AgCl electrode
def ag_agcl(path):
    fig, ax = canvas(7, 5.6, (0, 12), (-0.6, 9.6))
    # outer glass tube
    ax.add_patch(FancyBboxPatch((3.0, 0.2), 1.8, 8.4, boxstyle="round,pad=0,rounding_size=0.5", fc="white", ec=INK, lw=1.8, zorder=2))
    ax.add_patch(Rectangle((3.08, 0.3), 1.64, 5.6, fc=SOL, ec="none", zorder=2))
    ax.plot([3.08, 4.72], [5.9, 5.9], color=BLUE, lw=1.1, zorder=3)
    # porous junction
    ax.add_patch(Rectangle((3.6, 0.0), 0.6, 0.35, fc="#cfcfcf", ec=INK, lw=1.0, hatch="....", zorder=4))
    # Ag wire with AgCl coating
    ax.plot([3.9, 3.9], [1.2, 9.4], color=METAL, lw=3.2, zorder=5)
    ax.add_patch(Rectangle((3.72, 1.2), 0.36, 2.6, fc="#c8b7a6", ec=INK, lw=1.0, zorder=6))
    ax.plot([3.9, 3.9, 6.0], [9.4, 9.4, 9.4], color=INK, lw=1.2)
    label(ax, (3.95, 7.4), (6.6, 7.6), r"$\mathrm{Ag}$ wire")
    label(ax, (4.08, 2.6), (6.6, 3.4), r"$\mathrm{AgCl}$ coating (sparingly" + "\n" + "soluble salt of the metal)", color=VERM)
    label(ax, (4.6, 5.0), (6.6, 5.5), r"$\mathrm{KCl}$ (or $\mathrm{HCl}$) solution:" + "\n" + r"soluble salt of the same anion $\mathrm{Cl^-}$", color=BLUE)
    label(ax, (4.2, 0.17), (6.6, 1.0), "porous junction")
    ax.text(6.2, 9.4, "to meter", fontsize=12, va="center")
    ax.text(0.1, -0.35, r"$\mathrm{Ag\,|\,AgCl(s)\,|\,Cl^-}$", fontsize=13)
    save(fig, path)


# ---------------------------------------------------------------- G4.1 standard hydrogen electrode
def she(path):
    fig, ax = canvas(7, 5.4, (0, 12.4), (-0.8, 9.4))
    beaker(ax, 0.6, 7.6, 0, 3.6, 4.8)
    # bell jar (glass hood) dipping into solution
    xs = [3.0, 3.0, 2.4, 2.4, 5.0, 5.0, 4.4, 4.4]
    ys = [8.8, 5.6, 4.8, 1.5, 1.5, 4.8, 5.6, 8.8]
    ax.plot(xs, ys, color=INK, lw=1.8, zorder=4)
    ax.add_patch(Rectangle((2.45, 1.5), 2.5, 2.1, fc=SOL, ec="none", zorder=1))
    # H2 inlet side arm
    ax.plot([0.4, 2.65], [5.9, 5.9], color=INK, lw=1.6)
    ax.plot([0.4, 2.85], [5.5, 5.5], color=INK, lw=1.6)
    arrow(ax, (0.2, 6.6), (2.2, 6.6), color=ORANGE, lw=2.0)
    ax.text(0.2, 7.0, r"$\mathrm{H_2}$ gas, 1 atm", fontsize=12.5, color=ORANGE)
    # Pt wire and platinised foil
    ax.plot([3.7, 3.7], [2.4, 9.2], color=METAL, lw=2.4, zorder=5)
    ax.add_patch(Rectangle((3.35, 1.7), 0.7, 0.75, fc="#2b2b2b", ec=INK, lw=1.0, zorder=6))
    ax.plot([3.7, 6.0], [9.2, 9.2], color=INK, lw=1.2)
    ax.text(6.2, 9.2, "connection", fontsize=12, va="center")
    # bubbles escaping under the hood rim
    for (x, y) in [(2.2, 1.6), (2.0, 2.2), (2.15, 2.9), (5.2, 1.7), (5.4, 2.4), (5.25, 3.1)]:
        ax.add_patch(Circle((x, y), 0.12, fc="white", ec=ORANGE, lw=1.2, zorder=6))
    label(ax, (3.75, 7.6), (7.2, 7.8), r"$\mathrm{Pt}$ wire (electrical contact)")
    label(ax, (4.05, 2.1), (8.2, 2.0), "platinised Pt foil\n(platinum black)", color=INK)
    label(ax, (5.3, 2.4), (8.2, 3.6), r"$\mathrm{H_2}$ bubbles", color=ORANGE)
    label(ax, (6.6, 1.0), (8.2, 0.6), r"1 M $\mathrm{H^+}$ (1 M $\mathrm{HCl}$)", color=BLUE)
    label(ax, (4.4, 6.6), (7.2, 6.1), "glass hood")
    ax.text(0.6, -0.6, r"$\mathrm{Pt\,|\,H_2(1\,atm)\,|\,H^+(1\,M)}$,  $E^\circ=0$ V", fontsize=13)
    save(fig, path)


# ---------------------------------------------------------------- G5.1 lead amalgam electrode
def amalgam(path):
    fig, ax = canvas(7, 4.8, (0, 12), (-0.6, 8.0))
    beaker(ax, 0.8, 6.8, 0, 4.0, 5.2)
    ax.add_patch(FancyBboxPatch((3.2, 0.8), 1.2, 6.8, boxstyle="round,pad=0,rounding_size=0.3", fc="white", ec=INK, lw=1.6, zorder=3))
    ax.add_patch(Rectangle((3.25, 0.85), 1.1, 0.9, fc="#7d8590", ec=INK, lw=1.0, zorder=4))
    ax.plot([3.8, 3.8], [1.75, 7.9], color=INK, lw=1.4, zorder=5)
    for (x, y) in [(1.6, 1.2), (2.3, 2.8), (1.5, 3.4), (5.4, 1.0), (6.0, 2.6), (5.2, 3.5)]:
        ax.text(x, y, r"$\mathrm{Pb^{2+}}$", fontsize=11, color=BLUE, ha="center", va="center", zorder=5)
    label(ax, (4.35, 1.3), (7.4, 1.1), r"lead amalgam $\mathrm{Pb\!-\!Hg}$" + "\n" + "(alloy of Pb with mercury)", color=INK)
    label(ax, (6.2, 3.2), (7.4, 3.2), r"solution of its own ions $\mathrm{Pb^{2+}}$", color=BLUE)
    label(ax, (4.4, 6.0), (7.4, 6.2), "glass tube; wire to the\namalgam pellet")
    ax.text(0.8, -0.45, r"$\mathrm{Pb\!-\!Hg\,|\,Pb^{2+}}$ :  $\mathrm{Pb^{2+}+2e^-\rightleftharpoons Pb(Hg)}$", fontsize=13)
    save(fig, path)


# ---------------------------------------------------------------- G6.1 redox electrode
def redox(path):
    fig, ax = canvas(7, 4.8, (0, 12), (-0.6, 8.0))
    beaker(ax, 0.8, 7.0, 0, 4.4, 5.6)
    ax.add_patch(Rectangle((3.6, 0.9), 0.5, 6.6, fc=METAL, ec=INK, lw=1.3, zorder=3))
    pts4 = [(1.7, 1.2), (5.3, 3.6), (2.3, 3.6), (6.1, 1.4)]
    pts2 = [(2.6, 2.3), (5.0, 1.0), (1.6, 2.7), (5.8, 2.6)]
    for (x, y) in pts4:
        ax.text(x, y, r"$\mathrm{Sn^{4+}}$", fontsize=12, color=VERM, ha="center", va="center", zorder=5)
    for (x, y) in pts2:
        ax.text(x, y, r"$\mathrm{Sn^{2+}}$", fontsize=12, color=BLUE, ha="center", va="center", zorder=5)
    arrow(ax, (3.55, 2.9), (3.0, 3.5), color=GREEN, rad=0.3)
    ax.text(2.75, 4.0, r"$2e^-$", color=GREEN, fontsize=12, ha="center")
    label(ax, (4.1, 6.6), (7.6, 6.8), r"inert $\mathrm{Pt}$: only an" + "\n" + "electrical contact")
    label(ax, (5.8, 3.6), (7.6, 4.4), "oxidised form", color=VERM)
    label(ax, (6.3, 2.6), (7.6, 2.8), "reduced form", color=BLUE)
    ax.text(7.6, 1.2, r"$\mathrm{Sn^{4+}+2e^-\rightleftharpoons Sn^{2+}}$", fontsize=13)
    ax.text(0.8, -0.45, r"$\mathrm{Pt\,|\,Sn^{4+},Sn^{2+}}$ (stannic–stannous)", fontsize=13)
    save(fig, path)


# ---------------------------------------------------------------- G6.2 potential vs pH
def e_vs_ph(path):
    fig, ax = axes2d(7, 4.6)
    ph = np.linspace(0, 14, 50)
    ax.plot(ph, 0.699 - 0.0591 * ph, color=BLUE, lw=CURVE)
    ax.plot(ph, 0 - 0.0591 * ph, color=VERM, lw=CURVE)
    ax.plot(ph, 0.45 - 0.0591 * ph, color=GREEN, lw=2.0, ls=DASH)
    ax.axvline(8, color=MUTED, lw=1.1, ls=REF)
    ax.text(8.15, 0.66, "quinhydrone not\nused above pH 8", color=MUTED, fontsize=11, va="top")
    ax.text(0.3, 0.73, r"quinhydrone: $0.699-0.0591\,\mathrm{pH}$", color=BLUE, fontsize=12.5)
    ax.text(0.3, -0.72, r"hydrogen (1 atm): $-0.0591\,\mathrm{pH}$", color=VERM, fontsize=12.5)
    ax.annotate("glass: $E^\\circ_G-0.0591\\,\\mathrm{pH}$\n($E^\\circ_G$ illustrative)", xy=(10.5, 0.45-0.0591*10.5), xytext=(9.3, 0.42), color=GREEN, fontsize=12, va="top", arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.9))
    ax.set_xlim(0, 14); ax.set_ylim(-0.9, 0.8)
    ax.set_xticks([0, 2, 4, 6, 8, 10, 12, 14])
    ax.set_xlabel("pH", fontsize=13, loc="right"); ax.set_ylabel(r"$E$ / V", fontsize=13, loc="top")
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot([4], [0.699 - 0.0591 * 4], "o", color=INK, ms=6, zorder=5)
    ax.text(4.2, 0.48, r"pH 4: 0.4626 V", fontsize=11.5)
    save(fig, path)


# ---------------------------------------------------------------- G7.1 glass electrode
def glass(path):
    fig, ax = canvas(7, 5.6, (0, 12), (-0.8, 9.6))
    # stem and bulb
    ax.plot([3.4, 3.4], [2.0, 9.0], color=INK, lw=1.8, zorder=3)
    ax.plot([4.6, 4.6], [2.0, 9.0], color=INK, lw=1.8, zorder=3)
    ax.add_patch(Rectangle((3.42, 2.0), 1.16, 4.6, fc=SOL, ec="none", zorder=1))
    ax.add_patch(Circle((4.0, 1.3), 1.0, fc=SOL, ec=VERM, lw=1.2, ls=(0, (2, 1.5)), zorder=2))
    ax.add_patch(Rectangle((3.42, 1.9), 1.16, 0.5, fc=SOL, ec="none", zorder=2))
    ax.plot([3.42, 4.58], [6.6, 6.6], color=BLUE, lw=1.1, zorder=3)
    # internal Ag/AgCl
    ax.plot([4.0, 4.0], [1.0, 9.4], color=METAL, lw=2.6, zorder=5)
    ax.add_patch(Rectangle((3.85, 0.9), 0.3, 1.2, fc="#c8b7a6", ec=INK, lw=0.9, zorder=6))
    ax.plot([4.0, 6.0], [9.4, 9.4], color=INK, lw=1.2)
    ax.text(6.2, 9.4, "to meter", fontsize=12, va="center")
    label(ax, (4.05, 7.8), (6.6, 7.9), r"internal reference: $\mathrm{Ag/AgCl}$ wire")
    label(ax, (4.5, 4.4), (6.6, 5.3), r"0.1 M $\mathrm{HCl}$ (fixed $[\mathrm{H^+}]$)", color=BLUE)
    label(ax, (4.95, 1.0), (6.6, 2.6), "thin pH-sensitive glass\nmembrane (bulb)", color=VERM)
    label(ax, (3.42, 3.6), (0.2, 4.6), "glass stem", ha="left")
    ax.text(1.0, -0.6, "dip the bulb in the test solution; pair with a reference (SCE)", fontsize=12)
    save(fig, path)


FIGURES = {"G2.1": metal_ion, "G3.1": ag_agcl, "G4.1": she, "G5.1": amalgam,
           "G6.1": redox, "G6.2": e_vs_ph, "G7.1": glass}
