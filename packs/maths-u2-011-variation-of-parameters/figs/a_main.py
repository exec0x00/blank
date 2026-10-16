"""Figures for Unit 2 class 011 VoP. The deck has no graphs: every figure is added for clarity."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, PURPLE, INK, MUTED, GUIDE, CURVE, DASH, REF, save, axes2d


def _labels(ax):
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)


def params_tan(path):
    """(D^2+4)y = tan 2x: u(x), v(x) and y_p on (-pi/4, pi/4)."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-0.775, 0.775, 800)
    L = np.log(1 / np.cos(2 * x) + np.tan(2 * x))
    u = 0.25 * (np.sin(2 * x) - L)
    v = -np.cos(2 * x) / 4
    yp = -0.25 * np.cos(2 * x) * L
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    for xv in (-np.pi / 4, np.pi / 4):
        ax.axvline(xv, color=MUTED, lw=1.1, ls=REF)
    ax.plot(x, u, color=GREEN, lw=2.0)
    ax.plot(x, v, color=PURPLE, lw=2.0)
    ax.plot(x, yp, color=BLUE, lw=CURVE)
    ax.text(-0.6, 0.62, r"$u(x)=\frac{1}{4}[\sin 2x-\ln(\sec 2x+\tan 2x)]$", color=GREEN, fontsize=12)
    ax.text(-0.25, -0.36, r"$v(x)=-\frac{1}{4}\cos 2x$", color=PURPLE, fontsize=12)
    ax.text(0.05, 0.16, r"$y_p=-\frac{1}{4}\cos 2x\,\ln(\sec 2x+\tan 2x)$", color=BLUE, fontsize=12)
    ax.text(0.77, -0.86, r"$x=\frac{\pi}{4}$", color=MUTED, fontsize=12, ha="right")
    ax.text(-0.77, -0.86, r"$x=-\frac{\pi}{4}$", color=MUTED, fontsize=12, ha="left")
    ax.set_xlim(-0.85, 0.85); ax.set_ylim(-0.95, 0.85)
    _labels(ax)
    save(fig, path)


def two_pis(path):
    """Slide 011V-10: VoP PI vs Type-4 PI; difference -e^{-x}/64."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-1.0, 5, 600)
    t4 = -x ** 2 * np.exp(-x) / 8 - x * np.exp(-x) / 16
    vop = t4 - np.exp(-x) / 64
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, vop, color=BLUE, lw=CURVE)
    ax.plot(x, t4, color=VERM, lw=2.0, ls=DASH)
    ax.plot(x, -np.exp(-x) / 64, color=MUTED, lw=1.4)
    ax.text(1.6, -0.215, r"VoP: $-\frac{x^2e^{-x}}{8}-\frac{xe^{-x}}{16}-\frac{e^{-x}}{64}$", color=BLUE, fontsize=12)
    ax.text(2.2, -0.03, r"Type 4: $-\frac{x^2e^{-x}}{8}-\frac{xe^{-x}}{16}$", color=VERM, fontsize=12)
    ax.text(2.3, 0.025, r"grey: difference $-\frac{e^{-x}}{64}$ (a CF term)", color=MUTED, fontsize=11)
    ax.set_xlim(-1.0, 5); ax.set_ylim(-0.26, 0.08)
    _labels(ax)
    save(fig, path)


def one_plus_ex(path):
    """(D^2-1)y = 2/(1+e^x): X and y_p with limits -2 and 0."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-6, 6, 800)
    X = 2 / (1 + np.exp(x))
    yp = np.exp(x) * np.log1p(np.exp(-x)) - np.exp(-x) * np.log1p(np.exp(x)) - 1
    ax.axhline(0, color=MUTED, lw=1.0, ls=REF)
    ax.axhline(-2, color=MUTED, lw=1.0, ls=REF)
    ax.plot(x, X, color=VERM, lw=2.0, ls=DASH)
    ax.plot(x, yp, color=BLUE, lw=CURVE)
    ax.text(-5.8, 1.68, r"$X=\frac{2}{1+e^x}$", color=VERM, fontsize=13)
    ax.text(0.6, -1.2, r"$y_p=e^x\ln(1+e^{-x})-e^{-x}\ln(1+e^x)-1$", color=BLUE, fontsize=12)
    ax.text(5.9, -1.88, r"$y=-2$", color=MUTED, fontsize=12, ha="right")
    ax.text(5.9, 0.12, r"$y=0$", color=MUTED, fontsize=12, ha="right")
    ax.set_xlim(-6, 6); ax.set_ylim(-2.4, 2.3)
    _labels(ax)
    save(fig, path)


def sec3(path):
    """ESA Jan-24 s2 3a: y'' + 2y' + 2y = e^{-x} sec^3 x; y_p = e^{-x} sin x tan x / 2."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(-1.52, 1.52, 800)
    X = np.exp(-x) / np.cos(x) ** 3
    yp = 0.5 * np.exp(-x) * np.sin(x) * np.tan(x)
    gen = np.exp(-x) * (np.cos(x) - np.sin(x)) + yp
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    for xv in (-np.pi / 2, np.pi / 2):
        ax.axvline(xv, color=MUTED, lw=1.1, ls=REF)
    ax.plot(x, X, color=VERM, lw=2.0, ls=DASH)
    ax.plot(x, gen, color=MUTED, lw=1.3)
    ax.plot(x, yp, color=BLUE, lw=CURVE)
    ax.text(-0.35, 4.6, r"$X=e^{-x}\sec^3x$", color=VERM, fontsize=13)
    ax.text(-0.2, -1.3, r"$y_p=\frac{1}{2}e^{-x}\sin x\tan x$", color=BLUE, fontsize=13)
    ax.text(0.3, 6.6, r"grey: $c_1=1,\ c_2=-1$", color=MUTED, fontsize=11)
    ax.text(1.55, 7.3, r"$x=\frac{\pi}{2}$", color=MUTED, fontsize=12, ha="right")
    ax.text(-1.55, 7.3, r"$x=-\frac{\pi}{2}$", color=MUTED, fontsize=12, ha="left")
    ax.set_xlim(-1.7, 1.7); ax.set_ylim(-2, 8)
    _labels(ax)
    save(fig, path)


def exp_over_x(path):
    """ESA Jul-23 3c: y'' + 6y' + 9y = e^{-3x}/x; y_p = x e^{-3x} ln x."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0.01, 3, 800)
    X = np.exp(-3 * x) / x
    yp = x * np.exp(-3 * x) * np.log(x)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, X, color=VERM, lw=2.0, ls=DASH)
    for c1, c2 in ((0.3, 0.0), (-0.2, 0.6)):
        ax.plot(x, (c1 + c2 * x) * np.exp(-3 * x) + yp, color=MUTED, lw=1.2)
    ax.plot(x, yp - x * np.exp(-3 * x), color=GREEN, lw=1.6, ls=(0, (2, 2)))
    ax.plot(x, yp, color=BLUE, lw=CURVE)
    ax.plot([1], [0], "o", color=INK, ms=5)
    ax.text(0.08, 0.42, r"$X=\frac{e^{-3x}}{x}$", color=VERM, fontsize=13)
    ax.text(1.3, 0.06, r"$y_p=xe^{-3x}\ln x$", color=BLUE, fontsize=13)
    ax.text(0.8, -0.26, r"$uy_1+vy_2=xe^{-3x}(\ln x-1)$", color=GREEN, fontsize=11)
    ax.text(1.6, 0.17, r"general solutions (grey)", color=MUTED, fontsize=11)
    ax.set_xlim(0, 3); ax.set_ylim(-0.3, 0.5)
    _labels(ax)
    save(fig, path)


FIGURES = {"G1.1": params_tan, "G2.1": two_pis, "G2.2": one_plus_ex, "G3.1": sec3, "G4.1": exp_over_x}
