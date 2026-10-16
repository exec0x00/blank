"""Figures for Unit 2 class 005 (PI Type 3, X = x^m). The deck has no graphs: every figure is added for clarity."""
import numpy as np
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from figstyle import BLUE, VERM, GREEN, INK, MUTED, GUIDE, CURVE, DASH, REF, save, axes2d


def settle_onto_pi(path):
    """(D^2+3D+2)y = x^3+x^2: y_p (slides 005-11/12) and general solutions y_p + c1 e^-x + c2 e^-2x."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0, 5, 600)
    yp = 0.5 * (x ** 3 - 3.5 * x ** 2 + 7.5 * x - 7.75)
    for c1, c2 in [(8, -2), (4, 3), (-3, -2), (10, 4)]:
        ax.plot(x, yp + c1 * np.exp(-x) + c2 * np.exp(-2 * x), color=VERM, lw=1.8, ls=DASH)
    ax.plot(x, yp, color=BLUE, lw=CURVE)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.text(3.55, 13.0, r"$y_p=\frac{1}{2}\left(x^3-\frac{7x^2}{2}+\frac{15x}{2}-\frac{31}{4}\right)$", color=BLUE, fontsize=12, ha="right")
    ax.text(0.15, 11.6, r"$y_p+c_1e^{-x}+c_2e^{-2x}$", color=VERM, fontsize=12)
    ax.set_xlim(0, 5); ax.set_ylim(-6.5, 22)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def staircase(path):
    """Derivative staircase of x^3+x^2 and the operator terms 1, D, D^2, D^3 of W2.1 (schematic)."""
    fig, ax = axes2d(7.4, 3.6)
    ax.set_axis_off()
    labels = [r"$x^3+x^2$", r"$3x^2+2x$", r"$6x+2$", r"$6$", r"$0$"]
    ops = [r"$1$", r"$-\frac{3}{2}D$", r"$+\frac{7}{4}D^2$", r"$-\frac{15}{8}D^3$", r"$D^4,\,D^5,\dots$"]
    xs = [0.6, 2.25, 3.9, 5.4, 6.75]
    for i, (xc, lab, op) in enumerate(zip(xs, labels, ops)):
        col = MUTED if i == 4 else BLUE
        w = 1.2 if i < 2 else 1.0
        ax.add_patch(FancyBboxPatch((xc - w / 2, 1.55), w, 0.7, boxstyle="round,pad=0.02,rounding_size=0.12",
                                    fc="white", ec=col, lw=1.8, ls="-" if i < 4 else "--"))
        ax.text(xc, 1.9, lab, ha="center", va="center", fontsize=13, color=INK if i < 4 else MUTED)
        ax.text(xc, 0.75, op, ha="center", va="center", fontsize=13, color=VERM if i < 4 else MUTED)
        ax.text(xc, 2.65, r"$D^{%d}$" % i, ha="center", va="center", fontsize=12, color=MUTED)
        if i < 4:
            x0 = xc + (w / 2) + 0.03
            x1 = xs[i + 1] - (1.2 if i + 1 < 2 else 1.0) / 2 - 0.03
            ax.add_patch(FancyArrowPatch((x0, 1.9), (x1, 1.9), arrowstyle="-|>", mutation_scale=14, color=INK, lw=1.6))
    ax.plot([6.05, 6.05], [0.35, 2.9], color=MUTED, lw=1.2, ls=REF)
    ax.text(6.1, 0.15, "cut here", fontsize=11, color=MUTED)
    ax.text(0.0, 0.15, "operator terms that survive (W2.1)", fontsize=11, color=VERM)
    ax.set_xlim(-0.1, 7.4); ax.set_ylim(0, 3.0)
    save(fig, path)


def degree_rise(path):
    """X = x^2+2x+4: PI for D^2+D+1 is x^2+2 (degree 2); for D^2+D it is x^3/3+4x (degree 3)."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-3, 3, 400)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, x ** 2 + 2 * x + 4, color=BLUE, lw=CURVE)
    ax.plot(x, x ** 2 + 2, color=GREEN, lw=2.2, ls=DASH)
    ax.plot(x, x ** 3 / 3 + 4 * x, color=VERM, lw=CURVE)
    ax.text(-2.9, 15.5, r"$X=x^2+2x+4$", color=BLUE, fontsize=12)
    ax.text(-2.9, 13.3, r"$(D^2+D+1)y=X$: $y_p=x^2+2$", color=GREEN, fontsize=12)
    ax.text(0.2, -12.5, r"$(D^2+D)y=X$: $y_p=\frac{x^3}{3}+4x$", color=VERM, fontsize=12)
    ax.set_xlim(-3, 3); ax.set_ylim(-22, 20)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def superposition(path):
    """ESA Jul-23 3b: PI parts e^{4x}/2, (sin x + cos x)/10, x^2/6+5x/18+19/108, and their sum."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-3, 0.35, 500)
    p1 = np.exp(4 * x) / 2
    p2 = (np.sin(x) + np.cos(x)) / 10
    p3 = x ** 2 / 6 + 5 * x / 18 + 19 / 108
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, p1, color=BLUE, lw=2.2)
    ax.plot(x, p2, color=VERM, lw=2.2, ls=DASH)
    ax.plot(x, p3, color=GREEN, lw=2.2, ls=DASH)
    ax.plot(x, p1 + p2 + p3, color=INK, lw=CURVE)
    ax.text(-0.05, 1.95, r"$\frac{e^{4x}}{2}$", color=BLUE, fontsize=13, ha="right")
    ax.text(-2.95, -0.44, r"$\frac{\sin x+\cos x}{10}$", color=VERM, fontsize=12)
    ax.text(-2.95, 1.12, r"$\frac{x^2}{6}+\frac{5x}{18}+\frac{19}{108}$", color=GREEN, fontsize=12)
    ax.text(-1.45, 1.35, r"$y_p=$ sum of the three", color=INK, fontsize=12)
    ax.set_xlim(-3, 0.35); ax.set_ylim(-0.55, 2.6)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    save(fig, path)


FIGURES = {"G1.1": settle_onto_pi, "G2.1": staircase, "G3.1": degree_rise, "G4.1": superposition}
