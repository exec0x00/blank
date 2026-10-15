"""Figures for class 011 (Graph_Style_Guide_v2 via engine/figstyle.py)."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, INK, MUTED, GUIDE, CURVE, DASH, save, axes2d


def _frame(ax, lim):
    ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim); ax.set_aspect("equal")
    ax.axhline(0, color=GUIDE, lw=1, zorder=0); ax.axvline(0, color=GUIDE, lw=1, zorder=0)


def tangency(path):
    fig, ax = axes2d(6.6, 6.6)
    t = np.linspace(0, 2 * np.pi, 400); R = np.sqrt(2)
    ax.plot(R * np.cos(t), R * np.sin(t), color=BLUE, lw=CURVE)
    x = np.linspace(0.12, 2.6, 300)
    for c in (0.3, 0.6, 1.6, 2.4):
        ax.plot(x, c / x, color=MUTED, lw=0.9)
    ax.plot(x, 1 / x, color=VERM, lw=CURVE)
    ax.plot([1], [1], "o", color=INK, ms=7, zorder=6)
    ax.annotate("", xy=(1.55, 1.55), xytext=(1, 1), arrowprops=dict(arrowstyle="-|>", color=VERM, lw=1.8))
    ax.annotate("", xy=(1.85, 1.85), xytext=(1, 1), arrowprops=dict(arrowstyle="-|>", color=BLUE, lw=1.4, ls="--"))
    ax.text(1.62, 1.35, r"$\nabla f=(1,1)$", color=VERM, fontsize=13)
    ax.text(1.9, 1.95, r"$\nabla\phi=(2,2)$", color=BLUE, fontsize=13)
    ax.text(-1.95, 1.62, r"$\phi:\ x^2+y^2=2$", color=BLUE, fontsize=13)
    ax.text(-2.45, 2.3, r"vermilion: $xy=1$ touches", color=VERM, fontsize=13)
    ax.text(1.75, 0.2, r"$xy=c$", color=MUTED, fontsize=12)
    ax.text(0.42, 0.72, r"$(1,1)$", fontsize=13)
    _frame(ax, 2.6)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def bubble(path):
    fig, ax = axes2d(7.0, 5.0)
    s = np.linspace(-1.6, 1.6, 300)
    for sg in (1, -1):
        ax.plot(sg * np.cosh(s), np.sinh(s), color=BLUE, lw=CURVE)
    t = np.linspace(0, 2 * np.pi, 300)
    for rad in (0.4, 0.7):
        ax.plot(rad * np.cos(t), rad * np.sin(t), color=MUTED, lw=1.0, ls=DASH)
    ax.plot(np.cos(t), np.sin(t), color=VERM, lw=2.0)
    ax.plot([1, -1], [0, 0], "o", color=INK, ms=7, zorder=6)
    ax.text(1.08, -0.3, r"$(1,0,0)$", fontsize=13); ax.text(-1.95, -0.3, r"$(-1,0,0)$", fontsize=13)
    ax.text(1.75, 0.95, r"$x^2-z^2=1$", color=BLUE, fontsize=13)
    ax.text(-0.55, 1.08, "radius 1 touches", color=VERM, fontsize=13)
    ax.text(-0.38, 0.45, "bubble", color=MUTED, fontsize=11)
    ax.set_xlim(-3, 3); ax.set_ylim(-2.5, 2.5); ax.set_aspect("equal")
    ax.axhline(0, color=GUIDE, lw=1, zorder=0); ax.axvline(0, color=GUIDE, lw=1, zorder=0)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$z$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def ellipse(path):
    fig, ax = axes2d(6.6, 6.6)
    t = np.linspace(0, 2 * np.pi, 400)
    u, v = np.cos(t), 2 * np.sin(t)          # 8u^2 + 2v^2 = 8
    x, y = (u - v) / np.sqrt(2), (u + v) / np.sqrt(2)
    ax.plot(x, y, color=BLUE, lw=CURVE)
    ax.plot(np.cos(t), np.sin(t), color=VERM, lw=1.8, ls=DASH)
    ax.plot(2 * np.cos(t), 2 * np.sin(t), color=GREEN, lw=1.8, ls=DASH)
    a = 1 / np.sqrt(2); b = np.sqrt(2)
    ax.plot([a, -a], [a, -a], "o", color=VERM, ms=7, zorder=6)
    ax.plot([b, -b], [-b, b], "o", color=GREEN, ms=7, zorder=6)
    ax.text(a + 0.08, a + 0.1, r"min 1", color=VERM, fontsize=13)
    ax.text(b + 0.08, -b - 0.25, r"max 2", color=GREEN, fontsize=13)
    ax.text(-2.45, 2.25, r"$5x^2+6xy+5y^2=8$", color=BLUE, fontsize=13)
    ax.text(-0.6, 0.12, r"$x^2+y^2=1$", color=VERM, fontsize=12)
    ax.text(1.05, 1.95, r"$x^2+y^2=4$", color=GREEN, fontsize=12)
    _frame(ax, 2.5)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


FIGURES = {"G1.1": tangency, "G2.1": bubble, "G2.2": ellipse}
