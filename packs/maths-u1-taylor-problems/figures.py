"""Figures for class 008 (Graph_Style_Guide_v2 via engine/figstyle.py)."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, PURPLE, INK, MUTED, GUIDE, CURVE, DASH, REF, save, axes2d


def atan_line(path):
    """tan^-1(xy) and its Taylor polynomials about (1,-1), along the line through (1,-1) and (0.9,-1.2)."""
    fig, ax = axes2d(7.2, 4.6)
    s = np.linspace(-3, 3, 400)               # (x, y) = (1 - 0.1 s, -1 - 0.2 s)
    h, k = -0.1 * s, -0.2 * s
    x, y = 1 + h, -1 + k
    ax.plot(s, np.arctan(x * y), color=BLUE, lw=CURVE)
    ax.plot(s, -np.pi / 4 - h / 2 + k / 2, color=VERM, lw=2.0, ls=DASH)
    ax.plot(s, -np.pi / 4 - h / 2 + k / 2 + (h ** 2 + k ** 2) / 4, color=GREEN, lw=2.0, ls=DASH)
    ax.axvline(1, color=MUTED, lw=1.1, ls=REF)
    ax.plot([0], [-np.pi / 4], "o", color=INK, ms=6, zorder=5)
    ax.plot([1, 1], [-0.8354, -0.8238], "o", color=VERM, ms=5, zorder=6)
    ax.text(1.08, -0.47, r"$(0.9,\,-1.2)$", color=MUTED, fontsize=12)
    ax.text(0.08, -0.76, r"$(1,\,-1)$", color=INK, fontsize=12)
    ax.text(-2.9, -0.44, r"$\tan^{-1}(xy)$", color=BLUE, fontsize=13)
    ax.text(1.7, -0.96, "first degree", color=VERM, fontsize=12)
    ax.text(-1.1, -0.6, "second degree", color=GREEN, fontsize=12)
    ax.set_xlim(-3, 3); ax.set_ylim(-1.0, -0.4)
    ax.set_xlabel(r"steps $s$ along the line: $(x,y)=(1-0.1s,\ -1-0.2s)$", fontsize=12, loc="right")
    ax.set_ylabel(r"$f$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def log_combo(path):
    """log(2x+y+1) depends only on t=2x+y: compare with the one-variable series of log(1+t)."""
    fig, ax = axes2d(7.0, 4.6)
    t = np.linspace(-0.8, 1.5, 400)
    ax.plot(t, np.log1p(t), color=BLUE, lw=CURVE)
    ax.plot(t, t, color=VERM, lw=2.0, ls=DASH)
    ax.plot(t, t - t ** 2 / 2, color=GREEN, lw=2.0, ls=DASH)
    ax.plot(t, t - t ** 2 / 2 + t ** 3 / 3, color=PURPLE, lw=2.0, ls=DASH)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0); ax.axvline(0, color=GUIDE, lw=1, zorder=0)
    ax.text(-0.75, 0.45, r"$\log(1+t)$, $t=2x+y$", color=BLUE, fontsize=13)
    ax.text(0.95, 1.35, r"$t$", color=VERM, fontsize=13)
    ax.text(1.05, 0.25, r"$t-\frac{t^2}{2}$", color=GREEN, fontsize=13)
    ax.text(1.12, 1.62, r"$+\frac{t^3}{3}$", color=PURPLE, fontsize=13)
    ax.set_xlim(-0.8, 1.5); ax.set_ylim(-1.7, 1.9)
    ax.set_xlabel(r"$t=2x+y$", fontsize=13, loc="right")
    save(fig, path)


def sinxy_slice(path):
    """sin(xy) along y = pi/2 against its second-degree Taylor polynomial about (1, pi/2)."""
    fig, ax = axes2d(7.0, 4.4)
    x = np.linspace(-0.2, 2.2, 400)
    ax.plot(x, np.sin(x * np.pi / 2), color=BLUE, lw=CURVE)
    ax.plot(x, 1 - np.pi ** 2 / 8 * (x - 1) ** 2, color=GREEN, lw=2.0, ls=DASH)
    ax.axhline(1, color=VERM, lw=2.0, ls=DASH)
    ax.plot([1], [1], "o", color=INK, ms=6, zorder=5)
    ax.text(0.0, 0.6, r"$\sin\!\left(\frac{\pi x}{2}\right)$", color=BLUE, fontsize=13)
    ax.text(1.55, 1.06, "first degree: 1", color=VERM, fontsize=12)
    ax.text(1.45, -0.55, r"$1-\frac{\pi^2}{8}(x-1)^2$", color=GREEN, fontsize=13)
    ax.set_xlim(-0.2, 2.2); ax.set_ylim(-1.2, 1.3)
    ax.set_xlabel(r"$x$ (with $y=\pi/2$)", fontsize=13, loc="right")
    save(fig, path)


FIGURES = {"G1.1": sinxy_slice, "G2.1": log_combo, "G3.1": atan_line}
