"""Figures for Unit 2 class 001 (Graph_Style_Guide_v2 via engine/figstyle.py). All added for clarity: the deck has no graphs."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, PURPLE, ORANGE, INK, MUTED, GUIDE, TINT, CURVE, DASH, REF, save, axes2d


def superposition(path):
    """y'' + y = 0: sin x, cos x and the combination 2 sin x + cos x."""
    fig, ax = axes2d(7.2, 4.4)
    x = np.linspace(0, 2 * np.pi, 600)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, np.sin(x), color=BLUE, lw=CURVE)
    ax.plot(x, np.cos(x), color=VERM, lw=CURVE, ls=DASH)
    ax.plot(x, 2 * np.sin(x) + np.cos(x), color=GREEN, lw=CURVE)
    ax.text(3.6, 0.5, r"$y_1=\sin x$", color=BLUE, fontsize=13)
    ax.text(1.9, -1.65, r"$y_2=\cos x$", color=VERM, fontsize=13)
    ax.text(1.55, 2.3, r"$2y_1+y_2=2\sin x+\cos x$", color=GREEN, fontsize=13)
    ax.text(4.3, 1.45, r"all solve $y''+y=0$", color=INK, fontsize=12)
    ax.set_xticks([0, np.pi / 2, np.pi, 3 * np.pi / 2, 2 * np.pi])
    ax.set_xticklabels(["0", r"$\pi/2$", r"$\pi$", r"$3\pi/2$", r"$2\pi$"])
    ax.set_xlim(0, 2 * np.pi); ax.set_ylim(-2.5, 2.7)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def ratio_test(path):
    """Ratio y2/y1 for a dependent pair (constant) and two independent pairs."""
    fig, ax = axes2d(7.2, 4.4)
    x = np.linspace(0.05, 2.2, 500)
    ax.plot(x, np.exp(x), color=BLUE, lw=CURVE)
    ax.plot(x, 3 * np.ones_like(x), color=VERM, lw=CURVE, ls=DASH)
    xc = np.linspace(0.18, 2.2, 500)
    ax.plot(xc, np.cos(xc) / np.sin(xc), color=GREEN, lw=CURVE)
    ax.text(1.55, 6.3, r"$e^{2x}/e^{x}=e^{x}$: independent", color=BLUE, fontsize=12, ha="right")
    ax.text(1.45, 3.25, r"$3e^{x}/e^{x}=3$: dependent", color=VERM, fontsize=12)
    ax.text(0.25, -1.15, r"$\cos x/\sin x=\cot x$: independent", color=GREEN, fontsize=12)
    ax.set_xlim(0, 2.2); ax.set_ylim(-1.5, 8)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y_2/y_1$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def cf_plus_pi(path):
    """y'' + 3y' + 2y = 10 cos x: y = c1 e^{-x} + c2 e^{-2x} + cos x + 3 sin x."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0, 8, 700)
    yp = np.cos(x) + 3 * np.sin(x)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    for (c1, c2), col in zip([(4, 0), (-4, 1), (2, -6), (-1, -2)], [BLUE, VERM, GREEN, PURPLE]):
        ax.plot(x, c1 * np.exp(-x) + c2 * np.exp(-2 * x) + yp, color=col, lw=2.0)
    ax.plot(x, yp, color=INK, lw=1.6, ls=DASH, zorder=5)
    ax.text(0.15, 5.2, r"$c_1=4,\ c_2=0$", color=BLUE, fontsize=12)
    ax.text(0.9, -3.95, r"$c_1=-4,\ c_2=1$", color=VERM, fontsize=12)
    ax.text(0.9, -3.1, r"$c_1=2,\ c_2=-6$", color=GREEN, fontsize=12)
    ax.text(0.9, -2.25, r"$c_1=-1,\ c_2=-2$", color=PURPLE, fontsize=12)
    ax.text(4.55, 3.55, r"PI: $y_p=\cos x+3\sin x$", color=INK, fontsize=12)
    ax.set_xlim(0, 8); ax.set_ylim(-4.3, 5.8)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


FIGURES = {"G4.1": superposition, "G4.2": ratio_test, "G5.1": cf_plus_pi}
