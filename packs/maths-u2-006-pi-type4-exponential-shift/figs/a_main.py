"""Figures for Unit 2 class 006 (PI Types 4 and 5). The deck has no graphs: every figure is added for clarity."""
import numpy as np
import matplotlib.pyplot as plt
from figstyle import BLUE, VERM, GREEN, INK, MUTED, GUIDE, CURVE, DASH, save, axes2d


def envelope(path):
    """(D^2-2D+4)y = e^x cos x: y_p = e^x cos x / 2 with envelope +-e^x/2 (slides 006-5/6)."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-2, 3.6, 700)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, np.exp(x) / 2, color=VERM, lw=1.8, ls=DASH)
    ax.plot(x, -np.exp(x) / 2, color=VERM, lw=1.8, ls=DASH)
    ax.plot(x, np.exp(x) * np.cos(x) / 2, color=BLUE, lw=CURVE)
    ax.text(3.0, 14.5, r"$+\frac{e^x}{2}$", color=VERM, fontsize=14, ha="right")
    ax.text(2.55, -15.5, r"$-\frac{e^x}{2}$", color=VERM, fontsize=14, ha="right")
    ax.text(-1.9, 4.0, r"$y_p=\frac{e^x\cos x}{2}$", color=BLUE, fontsize=13)
    ax.set_xlim(-2, 3.6); ax.set_ylim(-19, 19)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def strip_exponential(path):
    """(D^2+2)y = x^2 e^{3x}: y_p and leading term (top); y_p e^{-3x} = polynomial (bottom)."""
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(6.4, 7.0))
    for ax in (a1, a2):
        ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)
        ax.tick_params(direction="out")
    x = np.linspace(-1.5, 1.2, 500)
    poly = (x ** 2 - 12 * x / 11 + 50 / 121) / 11
    a1.axhline(0, color=GUIDE, lw=1, zorder=0)
    a1.plot(x, x ** 2 * np.exp(3 * x) / 11, color=VERM, lw=1.8, ls=DASH)
    a1.plot(x, poly * np.exp(3 * x), color=BLUE, lw=CURVE)
    a1.text(-1.45, 3.0, r"$y_p=\frac{e^{3x}}{11}\left(x^2-\frac{12x}{11}+\frac{50}{121}\right)$", color=BLUE, fontsize=12)
    a1.text(-1.45, 2.2, r"leading term $\frac{x^2e^{3x}}{11}$", color=VERM, fontsize=12)
    a1.set_xlim(-1.5, 1.2); a1.set_ylim(-0.3, 4.0)
    a1.set_xlabel(r"$x$", fontsize=13, loc="right")
    a2.axhline(0, color=GUIDE, lw=1, zorder=0)
    a2.plot(x, x ** 2 / 11, color=MUTED, lw=1.4, ls=DASH)
    a2.plot(x, poly, color=GREEN, lw=CURVE)
    a2.text(-0.95, 0.44, r"$y_p\,e^{-3x}=\frac{1}{11}\left(x^2-\frac{12x}{11}+\frac{50}{121}\right)$", color=GREEN, fontsize=12)
    a2.text(0.98, 0.125, r"$\frac{x^2}{11}$", color=MUTED, fontsize=12)
    a2.set_xlim(-1.5, 1.2); a2.set_ylim(-0.03, 0.5)
    a2.set_xlabel(r"$x$", fontsize=13, loc="right")
    fig.tight_layout(h_pad=2.0)
    save(fig, path)


def type5_growth(path):
    """(D^2-1)y = x sin 3x (CW P19): y_p = -x sin3x/10 - 3cos3x/50, envelope +-x/10, correction -3cos3x/50."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0, 12, 900)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, x / 10, color=VERM, lw=1.6, ls=DASH)
    ax.plot(x, -x / 10, color=VERM, lw=1.6, ls=DASH)
    ax.plot(x, -3 * np.cos(3 * x) / 50, color=GREEN, lw=1.6, ls=DASH)
    ax.plot(x, -x * np.sin(3 * x) / 10 - 3 * np.cos(3 * x) / 50, color=BLUE, lw=2.2)
    ax.text(11.9, 1.32, r"$\pm\frac{x}{10}$", color=VERM, fontsize=14, ha="right")
    ax.text(0.2, -0.62, r"$-\frac{3\cos 3x}{50}$", color=GREEN, fontsize=13)
    ax.text(0.2, 1.05, r"$y_p=-\frac{x\sin 3x}{10}-\frac{3\cos 3x}{50}$", color=BLUE, fontsize=13)
    ax.set_xlim(0, 12); ax.set_ylim(-1.45, 1.45)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


FIGURES = {"G1.1": envelope, "G2.1": strip_exponential, "G3.1": type5_growth}
