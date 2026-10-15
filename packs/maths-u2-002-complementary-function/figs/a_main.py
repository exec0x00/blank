"""Figures for Unit 2 class 002 (Graph_Style_Guide_v2 via engine/figstyle.py). All added for clarity: the deck has no graphs."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, PURPLE, ORANGE, INK, MUTED, GUIDE, TINT, CURVE, DASH, REF, save, axes2d


def three_cases(path):
    """Same start y(0)=1, y'(0)=0 for the three second-order cases."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0, 6, 600)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, 2 * np.exp(-x) - np.exp(-2 * x), color=BLUE, lw=CURVE)
    ax.plot(x, (1 + x) * np.exp(-x), color=VERM, lw=CURVE, ls=DASH)
    ax.plot(x, np.exp(-x) * (np.cos(2 * x) + 0.5 * np.sin(2 * x)), color=GREEN, lw=CURVE)
    ax.text(2.2, 0.47, r"distinct $-1,-2$: $2e^{-x}-e^{-2x}$", color=BLUE, fontsize=12)
    ax.annotate("", xy=(2.0, 0.27), xytext=(2.25, 0.44), arrowprops=dict(arrowstyle="-", color=BLUE, lw=0.8))
    ax.text(2.9, 0.27, r"equal $-1,-1$: $(1+x)e^{-x}$", color=VERM, fontsize=12)
    ax.annotate("", xy=(2.6, 0.27), xytext=(2.88, 0.29), arrowprops=dict(arrowstyle="-", color=VERM, lw=0.8))
    ax.text(1.75, -0.33, r"complex $-1\pm2i$: $e^{-x}(\cos2x+\frac{1}{2}\sin2x)$", color=GREEN, fontsize=12)
    ax.set_xlim(0, 6); ax.set_ylim(-0.4, 1.1)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def root_plane(path):
    """Roots of the slide examples in the complex plane, with the solution shape each region gives."""
    fig, ax = axes2d(7.2, 5.0)
    ax.axvspan(-4, 0, color=TINT["green"], zorder=0)
    ax.axhline(0, color=MUTED, lw=1.1, zorder=1)
    ax.axvline(0, color=MUTED, lw=1.1, zorder=1)
    pts = [((-3, 0), BLUE, "o"), ((1, 0), BLUE, "o"), ((-2, 0), VERM, "s"), ((2, 3), GREEN, "^"), ((2, -3), GREEN, "^"),
           ((0, 0), PURPLE, "D"), ((0, 2), PURPLE, "D"), ((0, -2), PURPLE, "D")]
    for (a, b), c, mk in pts:
        ax.plot([a], [b], mk, color=c, ms=9, zorder=5)
    ax.text(-3.3, 0.35, r"$-3$", color=BLUE, fontsize=12)
    ax.text(1.1, 0.35, r"$1$", color=BLUE, fontsize=12)
    ax.text(-2.75, -0.75, r"$-2$ (twice)", color=VERM, fontsize=12)
    ax.text(2.2, 3.0, r"$2\pm3i$", color=GREEN, fontsize=12)
    ax.text(0.2, 2.1, r"$\pm2i$", color=PURPLE, fontsize=12)
    ax.text(0.2, -0.75, r"$0$", color=PURPLE, fontsize=12)
    ax.text(-3.9, 3.3, "left half-plane:\nterms decay", color=GREEN, fontsize=12, va="top")
    ax.text(1.0, -0.9, "right half-plane:\nterms grow", color=INK, fontsize=12, va="top")
    ax.text(0.15, 3.65, "imaginary axis:\nsteady oscillation", color=PURPLE, fontsize=12, va="top")
    ax.set_xlim(-4, 4); ax.set_ylim(-3.8, 3.8)
    ax.set_xlabel(r"real part $\alpha$", fontsize=13, loc="right")
    ax.set_ylabel(r"imaginary part $\beta$", fontsize=13, loc="top")
    save(fig, path)


def repeated_real(path):
    """Basis for a triple root m = -1: e^{-x}, x e^{-x}, x^2 e^{-x}."""
    fig, ax = axes2d(7.0, 4.4)
    x = np.linspace(0, 8, 600)
    ax.plot(x, np.exp(-x), color=BLUE, lw=CURVE)
    ax.plot(x, x * np.exp(-x), color=VERM, lw=CURVE, ls=DASH)
    ax.plot(x, x ** 2 * np.exp(-x), color=GREEN, lw=CURVE)
    ax.text(0.25, 0.9, r"$e^{-x}$", color=BLUE, fontsize=13)
    ax.text(3.3, 0.21, r"$xe^{-x}$", color=VERM, fontsize=13)
    ax.text(2.6, 0.6, r"$x^2e^{-x}$", color=GREEN, fontsize=13)
    ax.set_xlim(0, 8); ax.set_ylim(0, 1.05)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    save(fig, path)


def repeated_complex(path):
    """CW P7: roots +-5i twice. cos 5x stays bounded, x cos 5x grows between the lines +-x."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0, 3.2, 900)
    ax.plot(x, x, color=MUTED, lw=1.1, ls=REF)
    ax.plot(x, -x, color=MUTED, lw=1.1, ls=REF)
    ax.plot(x, np.cos(5 * x), color=BLUE, lw=2.2)
    ax.plot(x, x * np.cos(5 * x), color=VERM, lw=2.2, ls=DASH)
    ax.text(1.55, 2.0, r"$y=x$", color=MUTED, fontsize=12)
    ax.text(1.55, -2.25, r"$y=-x$", color=MUTED, fontsize=12)
    ax.text(0.05, 1.25, r"$\cos5x$ (simple $\pm5i$)", color=BLUE, fontsize=12)
    ax.text(0.05, -2.95, r"$x\cos5x$ (repeated $\pm5i$)", color=VERM, fontsize=12)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.set_xlim(0, 3.2); ax.set_ylim(-3.3, 3.3)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def ivp_p9(path):
    """CW P9: y = 2 sin 2x + sin 3x with its four conditions marked."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0, np.pi, 600)
    y = 2 * np.sin(2 * x) + np.sin(3 * x)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, y, color=BLUE, lw=CURVE)
    x0 = np.pi / 2
    s = np.linspace(-0.35, 0.35, 10)
    ax.plot(x0 + s, -1 - 4 * s, color=VERM, lw=2.0, ls=DASH)
    ax.axvline(x0, color=MUTED, lw=1.0, ls=REF)
    ax.plot([0], [0], "o", color=INK, ms=6, zorder=5)
    ax.plot([x0], [-1], "o", color=VERM, ms=6, zorder=5)
    ax.text(0.08, -0.75, r"$y(0)=0,\ y''(0)=0$", color=INK, fontsize=12)
    ax.text(1.75, -0.5, r"$y(\pi/2)=-1$", color=VERM, fontsize=12)
    ax.text(2.1, -2.6, r"slope $y'(\pi/2)=-4$", color=VERM, fontsize=12)
    ax.text(1.7, 2.6, r"$y=2\sin2x+\sin3x$", color=BLUE, fontsize=13)
    ax.set_xticks([0, np.pi / 4, np.pi / 2, 3 * np.pi / 4, np.pi])
    ax.set_xticklabels(["0", r"$\pi/4$", r"$\pi/2$", r"$3\pi/4$", r"$\pi$"])
    ax.set_xlim(0, np.pi); ax.set_ylim(-3.1, 3.3)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


FIGURES = {"G2.1": three_cases, "G2.2": root_plane, "G3.1": repeated_real, "G3.2": repeated_complex, "G4.1": ivp_p9}
