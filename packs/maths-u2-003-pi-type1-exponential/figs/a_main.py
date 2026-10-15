"""Figures for Unit 2 class 003 (PI Type 1). The deck has no graphs: every figure is added for clarity."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, PURPLE, ORANGE, INK, MUTED, GUIDE, TINT, CURVE, DASH, REF, save, axes2d


def ratio_ladder(path):
    """PI / e^{ax} for a = 1: no failure 1/2, one failure x/2, two failures x^2/2."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0, 3, 400)
    ax.plot(x, 0.5 + 0 * x, color=BLUE, lw=CURVE)
    ax.plot(x, x / 2, color=VERM, lw=CURVE, ls=DASH)
    ax.plot(x, x ** 2 / 2, color=GREEN, lw=CURVE)
    ax.text(2.0, 0.22, r"$(D^2+1)y=e^x$: $\frac{1}{2}$", color=BLUE, fontsize=12)
    ax.text(2.0, 0.68, r"$(D^2-1)y=e^x$: $\frac{x}{2}$", color=VERM, fontsize=12)
    ax.text(0.35, 3.3, r"$(D-1)^2y=e^x$: $\frac{x^2}{2}$", color=GREEN, fontsize=12)
    ax.set_xlim(0, 3); ax.set_ylim(0, 4.6)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y_p\,/\,e^{x}$", fontsize=14, loc="top")
    save(fig, path)


def decay_curves(path):
    """Forcing e^{-x}: PI e^{-x}/2, x e^{-x}/2, x^2 e^{-x}/2."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0, 8, 600)
    ax.plot(x, np.exp(-x) / 2, color=BLUE, lw=CURVE, label=r"$(D+2)(D+3)$, $f(-1)\neq0$: $\frac{1}{2}e^{-x}$")
    ax.plot(x, x * np.exp(-x) / 2, color=VERM, lw=CURVE, ls=DASH, label=r"$(D+1)(D+3)$, $f(-1)=0$: $\frac{x}{2}e^{-x}$")
    ax.plot(x, x ** 2 * np.exp(-x) / 2, color=GREEN, lw=CURVE, label=r"$(D+1)^2$, $f(-1)=f'(-1)=0$: $\frac{x^2}{2}e^{-x}$")
    ax.legend(loc="upper right", frameon=False, fontsize=12, handlelength=2.6)
    ax.set_xlim(0, 8); ax.set_ylim(0, 0.62)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y_p$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def sinh_cosh(path):
    """cosh x and sinh x as half-sums of e^{x} and e^{-x}."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-2.5, 2.5, 500)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.axvline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, np.exp(x) / 2, color=MUTED, lw=1.4, ls=REF)
    ax.plot(x, np.exp(-x) / 2, color=MUTED, lw=1.4, ls=REF)
    ax.plot(x, np.cosh(x), color=BLUE, lw=CURVE)
    ax.plot(x, np.sinh(x), color=VERM, lw=CURVE, ls=DASH)
    ax.text(0.35, 3.9, r"$\cosh x=\frac{e^x+e^{-x}}{2}$", color=BLUE, fontsize=12)
    ax.text(0.9, -2.9, r"$\sinh x=\frac{e^x-e^{-x}}{2}$", color=VERM, fontsize=12)
    ax.text(1.35, 1.0, r"$\frac{1}{2}e^{x}$", color=MUTED, fontsize=12)
    ax.text(-2.2, 1.0, r"$\frac{1}{2}e^{-x}$", color=MUTED, fontsize=12)
    ax.set_xlim(-2.5, 2.5); ax.set_ylim(-3.4, 4.4)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def a_power_x(path):
    """a^x = e^{x log a}: 2^x and 2^{-x} are exponentials with exponent +-log 2."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-2.5, 2.5, 500)
    L2 = np.log(2)
    ax.plot(x, np.exp(x), color=MUTED, lw=1.4, ls=REF)
    ax.plot(x, np.exp(L2 * x), color=BLUE, lw=CURVE)
    ax.plot(x, np.exp(-L2 * x), color=VERM, lw=CURVE, ls=DASH)
    ax.plot([0], [1], "o", color=INK, ms=6, zorder=5)
    ax.text(0.45, 4.6, r"$e^{x}$", color=MUTED, fontsize=13)
    ax.annotate("", xy=(1.45, 4.26), xytext=(0.75, 4.65), arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.8))
    ax.text(1.05, 1.3, r"$2^{x}=e^{(\log 2)x}$", color=BLUE, fontsize=12)
    ax.text(-1.4, 4.6, r"$2^{-x}=e^{-(\log 2)x}$", color=VERM, fontsize=12)
    ax.text(-1.4, 5.5, r"replace $D$ by $\pm\log 2\approx\pm0.693$", color=INK, fontsize=12)
    ax.set_xlim(-2.5, 2.5); ax.set_ylim(0, 6)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


FIGURES = {"G3.1": ratio_ladder, "G3.2": decay_curves, "G4.1": sinh_cosh, "G4.2": a_power_x}
