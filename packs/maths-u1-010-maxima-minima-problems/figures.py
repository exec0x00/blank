"""Figures for class 010 (Graph_Style_Guide_v2 via engine/figstyle.py)."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, INK, MUTED, GUIDE, CURVE, REF, save, axes2d


def _contour(path, f, xr, yr, levels, pts, w=7.0, h=6.0, clip=None):
    fig, ax = axes2d(w, h)
    x = np.linspace(*xr, 400); y = np.linspace(*yr, 400)
    X, Y = np.meshgrid(x, y)
    Z = f(X, Y)
    if clip is not None:
        Z = np.where(clip(X, Y), Z, np.nan)
    ax.contour(X, Y, Z, levels=levels, colors=MUTED, linewidths=0.8, linestyles="solid")
    style = {"max": dict(marker="^", color=VERM), "min": dict(marker="o", color=BLUE), "saddle": dict(marker="X", color=GREEN)}
    for (px, py, kind, lab, dx, dy) in pts:
        ax.plot([px], [py], ls="none", ms=10, zorder=6, mec="white", mew=0.8, **style[kind])
        ax.text(px + dx, py + dy, lab, color=style[kind]["color"], fontsize=13, zorder=7,
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.85))
    ax.set_xlim(*xr); ax.set_ylim(*yr); ax.set_aspect("equal")
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    return fig, ax


def esa1(path):
    f = lambda x, y: x**3 + 3 * x * y**2 - 15 * x**2 - 15 * y**2 + 72 * x
    lv = np.concatenate([np.arange(100, 108, 1.0), np.arange(108.25, 112, 0.5), [110], np.arange(112.5, 118, 1.0)])
    pts = [(4, 0, "max", "max 112", -0.62, 0.12), (6, 0, "min", "min 108", 0.12, 0.12),
           (5, 1, "saddle", r"saddle $(5,1)$", 0.1, 0.12), (5, -1, "saddle", r"saddle $(5,-1)$", 0.1, -0.3)]
    fig, ax = _contour(path, f, (3.0, 7.0), (-2.2, 2.2), np.unique(lv), pts)
    save(fig, path)


def esa2(path):
    f = lambda x, y: x**3 - 12 * x + y**3 + 3 * y**2 - 9 * y
    pts = [(-2, -3, "max", "max 43", 0.2, -0.15), (2, 1, "min", "min $-21$", 0.2, -0.15),
           (2, -3, "saddle", r"saddle $(2,-3)$", 0.2, 0.15), (-2, 1, "saddle", r"saddle $(-2,1)$", 0.2, 0.15)]
    fig, ax = _contour(path, f, (-4.0, 4.0), (-5.5, 3.0), np.arange(-40, 60, 5.0), pts)
    save(fig, path)


def quartic(path):
    f = lambda x, y: x**4 + y**4 - x**2 - y**2 + 1
    a = 1 / np.sqrt(2)
    pts = [(0, 0, "max", "max 1", 0.06, 0.06)]
    pts += [(sx * a, sy * a, "min", r"min $\frac{1}{2}$", 0.06, 0.06) for sx in (1, -1) for sy in (1, -1)]
    pts += [(a, 0, "saddle", "", 0, 0), (-a, 0, "saddle", "", 0, 0), (0, a, "saddle", "", 0, 0), (0, -a, "saddle", "saddle", 0.06, -0.16)]
    fig, ax = _contour(path, f, (-1.25, 1.25), (-1.25, 1.25), [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9, 1.0, 1.1, 1.3], pts)
    save(fig, path)


def temperature(path):
    f = lambda x, y: 400 * x * y * (1 - x**2 - y**2)
    pts = [(0.5, 0.5, "max", "50", 0.06, 0.05), (-0.5, -0.5, "max", "50", 0.06, 0.05),
           (0.5, -0.5, "min", "$-50$", 0.06, 0.05), (-0.5, 0.5, "min", "$-50$", 0.06, 0.05),
           (0, 0, "saddle", "saddle", 0.06, 0.05), (1, 0, "saddle", "", 0, 0), (-1, 0, "saddle", "", 0, 0),
           (0, 1, "saddle", "", 0, 0), (0, -1, "saddle", "", 0, 0)]
    fig, ax = _contour(path, f, (-1.15, 1.15), (-1.15, 1.15), [-45, -35, -25, -15, -5, 5, 15, 25, 35, 45], pts,
                       clip=lambda X, Y: X**2 + Y**2 <= 1)
    t = np.linspace(0, 2 * np.pi, 300)
    ax.plot(np.cos(t), np.sin(t), color=INK, lw=1.4)
    ax.text(0.62, 0.98, r"$x^2+y^2=1$", fontsize=12)
    save(fig, path)


def box(path):
    fig, ax = axes2d(7.0, 4.2)
    x = np.linspace(1.2, 4.6, 300)
    A = x**2 + 40 / x
    ax.plot(x, A, color=BLUE, lw=CURVE)
    xm = 20 ** (1 / 3); xc = 10 ** (1 / 3)
    ax.plot([xm], [xm**2 + 40 / xm], "o", color=VERM, ms=8, zorder=5)
    ax.text(xm + 0.1, xm**2 + 40 / xm - 1.7, r"minimum $22.10$ at $x=\sqrt[3]{20}$", color=VERM, fontsize=13)
    ax.plot([xc], [xc**2 + 40 / xc], "s", color=MUTED, ms=7, zorder=5)
    ax.text(2.0, 26.0, r"slide's cube $\sqrt[3]{10}$: $23.21$", color=MUTED, fontsize=12, ha="left")
    ax.plot([xc, 2.12], [xc**2 + 40 / xc + 0.25, 25.7], color=MUTED, lw=0.8)
    ax.text(3.75, 31.5, r"$A=x^2+\frac{40}{x}$", color=BLUE, fontsize=14)
    ax.set_xlim(1.2, 4.6); ax.set_ylim(18, 40)
    ax.set_xlabel(r"base edge $x=y$ (m)", fontsize=13, loc="right"); ax.set_ylabel(r"area $A$ (m$^2$)", fontsize=13, loc="top")
    save(fig, path)


FIGURES = {"G1.1": esa1, "G1.2": esa2, "G2.1": quartic, "G3.1": temperature, "G3.2": box}
