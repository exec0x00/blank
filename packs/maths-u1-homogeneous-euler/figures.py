"""Figures for class 005 (Graph_Style_Guide_v2 via engine/figstyle.py)."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, PURPLE, INK, MUTED, GUIDE, CURVE, DASH, REF, save, axes2d


def scaling(path):
    fig, ax = axes2d(7, 4.6)
    t = np.linspace(0.05, 2.2, 300)
    for n, col, lab, ls in ((2, BLUE, r"$n=2$: $x^2+y^2$", "-"), (1, VERM, r"$n=1$: $3x+4y$", "-"),
                            (0, GREEN, r"$n=0$: $y/x$", "-"), (-0.5, PURPLE, r"$n=-\frac{1}{2}$: $\frac{\sqrt{x}+\sqrt{y}}{x+y}$", "-")):
        ax.plot(t, t**n, color=col, lw=CURVE, ls=ls)
        yl = min(2.2**n, 4.6)
        ax.text(2.25, yl, lab, color=col, fontsize=13, va="center")
    ax.axvline(1, color=MUTED, lw=1.2, ls=REF); ax.text(1.03, 4.5, r"$t=1$", color=MUTED, fontsize=12)
    ax.set_xlim(0, 3.6); ax.set_ylim(0, 4.9)
    ax.set_xticks([0, 0.5, 1, 1.5, 2]); ax.set_yticks([0, 1, 2, 3, 4])
    ax.set_xlabel(r"scale factor $t$", fontsize=13, loc="right"); ax.set_ylabel(r"$u(tx,ty)\,/\,u(x,y)=t^n$", fontsize=13, loc="top")
    save(fig, path)


def level_scaled(path):
    fig, ax = axes2d(6.4, 6.0)
    u = np.linspace(-4, 4, 500); X, Y = np.meshgrid(u, u); U = X**2 + X * Y + Y**2
    cs = ax.contour(X, Y, U, levels=[1, 4, 9], colors=[BLUE, BLUE, BLUE], linewidths=[CURVE, 1.8, 1.4])
    for lev in (1, 4, 9):
        ax.text(-0.12, np.sqrt(lev) + 0.12, f"$u={lev}$", color=BLUE, fontsize=12, ha="right")
    d = np.array([1.0, 0.35]); d /= np.linalg.norm(d)
    s = np.linspace(0, 3.8, 2); ax.plot(s * d[0], s * d[1], color=VERM, lw=2.0, ls=DASH)
    for k in (1, 2, 3):
        r = k / np.sqrt(d[0]**2 + d[0] * d[1] + d[1]**2)
        ax.plot(r * d[0], r * d[1], "o", color=INK, ms=5, zorder=5)
    ax.text(2.0, -0.95, "ray: points at\n" + r"distance $\propto\sqrt{u}$", color=VERM, fontsize=12)
    ax.text(-3.8, 3.5, r"$u=x^2+xy+y^2$ (degree 2)", fontsize=13)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0); ax.axvline(0, color=GUIDE, lw=1, zorder=0)
    ax.set_xlim(-4, 4); ax.set_ylim(-4, 4); ax.set_aspect("equal")
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


FIGURES = {"G1.1": scaling, "G2.1": level_scaled}
