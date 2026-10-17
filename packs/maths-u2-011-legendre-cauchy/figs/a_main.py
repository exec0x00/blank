"""Figures for Unit 2 class 011 Legendre. The deck has no graphs: every figure is added for clarity."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, PURPLE, INK, MUTED, GUIDE, CURVE, DASH, REF, save, axes2d


def _labels(ax, ylab=r"$y$"):
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(ylab, fontsize=14, loc="top", rotation=0)


def new_variable(path):
    """z = log(2x+3) and z = log x."""
    fig, ax = axes2d(7.2, 4.6)
    x1 = np.linspace(-1.499, 6, 900)
    x2 = np.linspace(0.005, 6, 900)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.axvline(0, color=GUIDE, lw=1, zorder=0)
    ax.axvline(-1.5, color=MUTED, lw=1.1, ls=REF)
    ax.plot(x1, np.log(2 * x1 + 3), color=BLUE, lw=CURVE)
    ax.plot(x2, np.log(x2), color=VERM, lw=2.0, ls=DASH)
    ax.text(2.6, 2.75, r"Legendre: $z=\log(2x+3)$", color=BLUE, fontsize=13)
    ax.text(3.2, 0.45, r"Cauchy: $z=\log x$", color=VERM, fontsize=13)
    ax.text(-1.42, -3.3, r"$x=-\frac{3}{2}$", color=MUTED, fontsize=12)
    ax.set_xlim(-2, 6); ax.set_ylim(-3.6, 3.3)
    _labels(ax, r"$z$")
    save(fig, path)


def log_oscillation(path):
    """CF terms cos(log(1+x)), sin(log(1+x)) and the CW P29 PI, on a log axis of 1+x."""
    fig, ax = axes2d(7.2, 4.6)
    u = np.logspace(-3, 4, 4000)
    L = np.log(u)
    ax.set_xscale("log")
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(u, 3 * np.cos(L), color=GREEN, lw=1.8)
    ax.plot(u, 3 * np.sin(L), color=PURPLE, lw=1.8, ls=DASH)
    ax.plot(u, -L * np.cos(L), color=BLUE, lw=CURVE)
    ax.text(0.02, 4.3, r"$3\cos(\log(1+x))$", color=GREEN, fontsize=12)
    ax.text(0.25, -4.6, r"$3\sin(\log(1+x))$", color=PURPLE, fontsize=12)
    ax.text(2, 8.0, r"$y_p=-\log(1+x)\cos(\log(1+x))$", color=BLUE, fontsize=12)
    ax.set_xlim(1e-3, 1e4); ax.set_ylim(-10, 10)
    ax.set_xticks([10.0 ** k for k in range(-3, 5)])
    ax.set_xticklabels([r"$10^{%d}$" % k for k in range(-3, 5)])
    ax.minorticks_off()
    ax.set_xlabel(r"$1+x$ (log scale)", fontsize=13, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def slide_example(path):
    """(2x+3)^2 y'' - 2(2x+3) y' - 12 y = 6x: PI and two general solutions."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-1.47, 2.5, 800)
    yp = 0.75 - 3 * (2 * x + 3) / 16
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.axvline(-1.5, color=MUTED, lw=1.1, ls=REF)
    for c1, c2 in ((0.01, 0.2), (-0.01, 0.5)):
        ax.plot(x, c1 * (2 * x + 3) ** 3 + c2 / (2 * x + 3) + yp, color=MUTED, lw=1.3)
    ax.plot(x, yp, color=BLUE, lw=CURVE)
    ax.text(0.9, -0.95, r"$y_p=\frac{3}{4}-\frac{3(2x+3)}{16}$", color=BLUE, fontsize=13)
    ax.text(0.15, 2.1, r"general solutions (grey)", color=MUTED, fontsize=11)
    ax.text(-1.43, -2.75, r"$x=-\frac{3}{2}$", color=MUTED, fontsize=12)
    ax.set_xlim(-1.8, 2.5); ax.set_ylim(-3, 3)
    _labels(ax)
    save(fig, path)


def esa_sinx(path):
    """x^2 y'' - 4x y' + 6y = x^4 sin x: y_p = -x^2 sin x."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0, 12, 1200)
    yp = -x ** 2 * np.sin(x)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, x ** 2, color=MUTED, lw=1.0, ls=REF)
    ax.plot(x, -x ** 2, color=MUTED, lw=1.0, ls=REF)
    ax.plot(x, x ** 3 / 10, color=PURPLE, lw=1.6, ls=DASH)
    ax.plot(x, x ** 2 + (-0.1) * x ** 3 + yp, color=MUTED, lw=1.3)
    ax.plot(x, yp, color=BLUE, lw=CURVE)
    ax.text(9.0, 120, r"$\pm x^2$", color=MUTED, fontsize=12)
    ax.text(8.0, 178, r"$x^3/10$", color=PURPLE, fontsize=13)
    ax.text(0.4, 95, r"$y_p=-x^2\sin x$", color=BLUE, fontsize=13)
    ax.text(0.4, -175, r"grey: $c_1=1,\ c_2=-0.1$", color=MUTED, fontsize=11)
    ax.set_xlim(0, 12); ax.set_ylim(-200, 200)
    _labels(ax)
    save(fig, path)


FIGURES = {"G2.1": new_variable, "G2.2": log_oscillation, "G3.1": slide_example, "G4.1": esa_sinx}
