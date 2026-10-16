"""Figures for Unit 2 class 009 (PI when X is any other form). The deck has no graphs: every figure is added for clarity."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, INK, MUTED, GUIDE, CURVE, DASH, REF, save, axes2d


def integrate_twice(path):
    """y'' = ln x (slides 009-8/9): ln x, its first integral x ln x - x, and the PI x^2 ln x/2 - 3x^2/4."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0.02, 4.2, 600)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, np.log(x), color=GREEN, lw=2.0)
    ax.plot(x, x * np.log(x) - x, color=VERM, lw=2.0, ls=DASH)
    ax.plot(x, x ** 2 * np.log(x) / 2 - 0.75 * x ** 2, color=BLUE, lw=CURVE)
    ax.text(3.0, 1.35, r"$X=\ln x$", color=GREEN, fontsize=13)
    ax.text(0.3, 0.6, r"$\frac{1}{D}\ln x=x\ln x-x$", color=VERM, fontsize=13, va="bottom")
    ax.text(0.15, -4.1, r"$y_p=\frac{1}{D^2}\ln x=\frac{x^2\ln x}{2}-\frac{3x^2}{4}$", color=BLUE, fontsize=13)
    ax.set_xlim(0, 4.2); ax.set_ylim(-5, 2.5)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def tan_pi(path):
    """(D^2+1)y = tan x (slides 009-5..7 with a = 1): X = tan x and y_p = -cos x ln(sec x + tan x)."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-1.565, 1.565, 900)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    for xv in (-np.pi / 2, np.pi / 2):
        ax.axvline(xv, color=MUTED, lw=1.1, ls=REF)
    ax.plot(x, np.tan(x), color=VERM, lw=2.0, ls=DASH)
    yp = -np.cos(x) * np.log(1 / np.cos(x) + np.tan(x))
    ax.plot(x, yp, color=BLUE, lw=CURVE)
    ax.text(0.62, 2.9, r"$X=\tan x$", color=VERM, fontsize=13)
    ax.text(-1.45, 1.05, r"$y_p=-\cos x\,\ln(\sec x+\tan x)$", color=BLUE, fontsize=13)
    ax.text(1.5, -3.6, r"$x=\frac{\pi}{2}$", color=MUTED, fontsize=12, ha="right")
    ax.text(-1.5, -3.6, r"$x=-\frac{\pi}{2}$", color=MUTED, fontsize=12, ha="left")
    ax.set_xlim(-1.75, 1.75); ax.set_ylim(-4, 4)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def eex(path):
    """ESA Dec-23 3c: y''+3y'+2y = e^{e^x}; y_p = e^{-2x}e^{e^x}, minimum e^2/4 at x = ln 2."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-1.0, 1.6, 600)
    ax.plot(x, np.exp(np.exp(x)), color=VERM, lw=2.0, ls=DASH)
    ax.plot(x, np.exp(-2 * x + np.exp(x)), color=BLUE, lw=CURVE)
    for c1, c2 in ((2, -3), (-3, 2)):
        ax.plot(x, c1 * np.exp(-x) + c2 * np.exp(-2 * x) + np.exp(-2 * x + np.exp(x)), color=MUTED, lw=1.2)
    xm = np.log(2)
    ax.plot([xm], [np.e ** 2 / 4], "o", color=INK, ms=5)
    ax.plot([xm, xm], [0, np.e ** 2 / 4], color=MUTED, lw=1.0, ls=REF)
    ax.text(xm + 0.04, 0.25, r"minimum $(\ln 2,\ \frac{e^2}{4})$", color=INK, fontsize=12)
    ax.text(0.98, 10.6, r"$X=e^{e^x}$", color=VERM, fontsize=13)
    ax.text(-0.95, 4.2, r"$y_p=e^{-2x}e^{e^x}$", color=BLUE, fontsize=13)
    ax.text(0.1, 11.0, r"general solutions (grey)", color=MUTED, fontsize=11)
    ax.set_xlim(-1.0, 1.6); ax.set_ylim(0, 12)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def sin_ex(path):
    """(D+1)(D+2)y = sin(e^x) (slides 009-12/13): X oscillates ever faster, y_p = -e^{-2x} sin(e^x) dies away."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-0.5, 3.2, 1500)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, np.sin(np.exp(x)), color=VERM, lw=1.4, ls=DASH)
    ax.plot(x, -np.exp(-2 * x) * np.sin(np.exp(x)), color=BLUE, lw=CURVE)
    ax.text(-0.45, 1.08, r"$X=\sin(e^x)$", color=VERM, fontsize=13)
    ax.text(0.3, -1.85, r"$y_p=-e^{-2x}\sin(e^x)$", color=BLUE, fontsize=13)
    ax.set_xlim(-0.5, 3.2); ax.set_ylim(-2.2, 1.4)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


FIGURES = {"G1.1": integrate_twice, "G2.1": tan_pi, "G3.1": eex, "G3.2": sin_ex}
