"""Figures for class 009 (Graph_Style_Guide_v2 via engine/figstyle.py)."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, INK, MUTED, GUIDE, CURVE, DASH, save, axes2d, axes3d, surface


def peaks(path):
    fig, ax = axes3d(7.6, 5.6, elev=24, azim=-60, lim=((-3.2, 3.6), (-3.2, 3.6), (0, 3.6)))
    u = np.linspace(-3, 3, 49)
    X, Y = np.meshgrid(u, u)
    Z = 2.6 * np.exp(-((X - 1) ** 2 + (Y - 0.6) ** 2)) + 1.7 * np.exp(-((X + 1.3) ** 2 + (Y + 1.0) ** 2) / 0.8)
    surface(ax, X, Y, Z, alpha=0.9)
    zt = 1.7 + 2.6 * np.exp(-((-1.3 - 1) ** 2 + (-1.0 - 0.6) ** 2))
    p = np.linspace(-0.7, 0.7, 2)
    PX, PY = np.meshgrid(p - 1.3, p - 1.0)
    ax.plot_surface(PX, PY, 0 * PX + zt, color=VERM, alpha=0.35, shade=False, zorder=8)
    ax.plot([1], [0.6], [2.6 + 1.7 * np.exp(-((2.3) ** 2 + 1.6 ** 2) / 0.8)], "o", color=VERM, ms=6, zorder=10)
    ax.plot([-1.3], [-1.0], [zt], "o", color=VERM, ms=6, zorder=10)
    ax.text2D(0.02, 0.92, "two local maxima (peaks)", transform=ax.transAxes, color=BLUE, fontsize=13)
    ax.text2D(0.02, 0.85, "vermilion: horizontal tangent plane", transform=ax.transAxes, color=VERM, fontsize=13)
    save(fig, path)


def bowl(path):
    fig, ax = axes3d(7.2, 5.4, elev=22, azim=-58, lim=((-2.2, 2.5), (-2.2, 2.5), (0, 4.6)))
    r = np.linspace(0, 2.0, 21); t = np.linspace(0, 2 * np.pi, 49)
    R, T = np.meshgrid(r, t)
    surface(ax, R * np.cos(T), R * np.sin(T), R**2, alpha=0.85)
    ax.plot([0], [0], [0], "o", color=VERM, ms=7, zorder=10)
    ax.text2D(0.02, 0.92, r"$z=x^2+y^2$", transform=ax.transAxes, color=BLUE, fontsize=14)
    ax.text2D(0.02, 0.85, r"minimum at $(0,0)$: $rt-s^2=4>0,\ r=2>0$", transform=ax.transAxes, color=VERM, fontsize=13)
    save(fig, path)


def saddle(path):
    fig, ax = axes3d(7.4, 6.0, elev=24, azim=-62, lim=((-1.8, 2.1), (-1.8, 2.1), (-2.8, 5.4)))
    u = np.linspace(-1.6, 1.6, 33)
    X, Y = np.meshgrid(u, u)
    surface(ax, X, Y, X**2 - Y**2, alpha=0.85)
    s = np.linspace(-1.6, 1.6, 60)
    ax.plot(s, 0 * s, s**2, color=GREEN, lw=CURVE, zorder=8)
    ax.plot(0 * s, s, -s**2, color=VERM, lw=CURVE, zorder=8)
    ax.plot([0], [0], [0], "o", color=INK, ms=6, zorder=10)
    ax.text2D(0.02, 0.92, r"$z=x^2-y^2$", transform=ax.transAxes, color=BLUE, fontsize=14)
    ax.text2D(0.02, 0.85, r"green: along $x$, curves up", transform=ax.transAxes, color=GREEN, fontsize=13)
    ax.text2D(0.02, 0.78, r"vermilion: along $y$, curves down", transform=ax.transAxes, color=VERM, fontsize=13)
    ax.text2D(0.02, 0.71, r"saddle at $(0,0)$: $rt-s^2=-4<0$", transform=ax.transAxes, color=INK, fontsize=13)
    save(fig, path)


def onevar(path):
    fig, ax = axes2d(7.2, 4.4)
    f = lambda x: 0.25 * x**4 - 0.5 * 2.5 * x**2 + 0.6 * x + 3
    fp = lambda x: x**3 - 2.5 * x + 0.6
    x = np.linspace(-2.1, 2.1, 400)
    ax.plot(x, f(x), color=BLUE, lw=CURVE)
    roots = np.sort(np.real(np.roots([1, 0, -2.5, 0.6])))
    labels = ["local min", "local max", "local min"]
    for x0, lab in zip(roots, labels):
        ax.plot([x0 - 0.45, x0 + 0.45], [f(x0)] * 2, color=VERM, lw=2.0, ls=DASH)
        ax.plot([x0], [f(x0)], "o", color=INK, ms=6, zorder=5)
        dy = 0.25 if lab == "local max" else -0.45
        ax.text(x0, f(x0) + dy, lab, ha="center", fontsize=12)
    ax.text(1.35, 3.7, r"$y=f(x)$", color=BLUE, fontsize=14)
    ax.text(-2.05, 3.75, r"dashed: tangent with $\frac{dy}{dx}=0$", color=VERM, fontsize=12)
    ax.set_xlim(-2.2, 2.2); ax.set_ylim(0.3, 4.3); ax.set_xticks([]); ax.set_yticks([])
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


FIGURES = {"G1.1": peaks, "G1.2": bowl, "G1.3": saddle, "G1.4": onevar}
