"""Figures for class 001 (Graph_Style_Guide_v2 via engine/figstyle.py)."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, PURPLE, INK, MUTED, GUIDE, CURVE, DASH, REF, save, axes2d, axes3d, surface


def sinxcosy(path):
    fig, ax = axes3d(7.6, 5.6, elev=28, azim=-55, lim=((-3.4, 3.8), (-3.4, 3.8), (-1.3, 1.9)))
    u = np.linspace(-3.2, 3.2, 41)
    X, Y = np.meshgrid(u, u)
    surface(ax, X, Y, np.sin(X) * np.cos(Y), alpha=0.9)
    ax.text2D(0.02, 0.92, r"$z=\sin x\cos y$", transform=ax.transAxes, color=BLUE, fontsize=14)
    ax.text2D(0.02, 0.85, r"$-\pi\leq x,\ y\leq\pi$;  $-1\leq z\leq1$", transform=ax.transAxes, color=MUTED, fontsize=12)
    save(fig, path)


def bell(path):
    fig, ax = axes3d(7.6, 5.6, elev=24, azim=-58, lim=((-2.2, 2.5), (-2.2, 2.5), (0, 3.4)))
    r = np.linspace(0, 2.0, 22); t = np.linspace(0, 2 * np.pi, 49)
    R, T = np.meshgrid(r, t)
    X, Y = R * np.cos(T), R * np.sin(T)
    surface(ax, X, Y, np.exp(1 - X**2 - Y**2), alpha=0.92)
    tt = np.linspace(0, 2 * np.pi, 121)
    for c in (0.6, 1.0, 1.4):
        ax.plot(c * np.cos(tt), c * np.sin(tt), 0 * tt + np.exp(1 - c**2), color=GREEN, lw=1.6, zorder=8)
    ax.plot([0], [0], [np.e], "o", color=VERM, ms=6, zorder=10)
    ax.text2D(0.02, 0.92, r"$z=e^{1-x^2-y^2}$", transform=ax.transAxes, color=BLUE, fontsize=14)
    ax.text2D(0.02, 0.85, r"top $(0,0,e)$", transform=ax.transAxes, color=VERM, fontsize=13)
    ax.text2D(0.02, 0.78, "green: level curves $z=$ const (circles)", transform=ax.transAxes, color=GREEN, fontsize=12)
    save(fig, path)


def paths(path):
    fig, ax = axes2d(7.0, 4.6)
    a, b = 2.0, 1.5
    # line
    x = np.linspace(0.2, a, 50); ax.plot(x, b + 0.55 * (x - a), color=BLUE, lw=CURVE)
    # parabola from the right
    x = np.linspace(a, 3.7, 80); ax.plot(x, b + 0.45 * (x - a) ** 2, color=VERM, lw=CURVE)
    # ellipse arc from below
    t = np.linspace(-np.pi / 2, 0.0, 80); ax.plot(a - 1.6 + 1.6 * np.cos(t) * 1.0 + 0.0, b + 1.2 * np.sin(t), color=GREEN, lw=CURVE)
    # spiral
    t = np.linspace(0, 3.3 * np.pi, 300); rr = 0.08 * t
    ax.plot(a + rr * np.cos(t + 1.2), b + rr * np.sin(t + 1.2), color=PURPLE, lw=1.8)
    ax.plot([a], [b], "o", color=INK, ms=7, zorder=6)
    ax.text(a + 0.08, b - 0.22, r"$(a,b)$", fontsize=14)
    ax.text(0.25, b + 0.55 * (0.25 - a) + 0.12, "line", color=BLUE, fontsize=13)
    ax.text(3.3, b + 0.45 * 1.3 ** 2 - 0.45, "parabola", color=VERM, fontsize=13)
    ax.text(0.55, 0.15, "arc of an ellipse", color=GREEN, fontsize=13)
    ax.text(2.6, 2.75, "any other curve", color=PURPLE, fontsize=13)
    ax.set_xlim(0, 4.2); ax.set_ylim(0, 3.2); ax.set_xticks([]); ax.set_yticks([])
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def along_lines(path):
    fig, ax = axes2d(7.0, 4.2)
    m = np.linspace(-6, 6, 600)
    ax.plot(m, 2 * m / (3 + m**2), color=BLUE, lw=CURVE)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    for mv, lab, dx, dy, ha in ((0, r"$y=0$: value $0$", 0.2, -0.13, "left"), (1, r"$y=x$: value $\frac{1}{2}$", -0.25, 0.02, "right")):
        ax.plot([mv], [2 * mv / (3 + mv**2)], "o", color=VERM, ms=7, zorder=5)
        ax.text(mv + dx, 2 * mv / (3 + mv**2) + dy, lab, color=VERM, fontsize=13, ha=ha)
    s3 = np.sqrt(3)
    ax.axhline(1 / s3, color=MUTED, lw=1.1, ls=REF); ax.axhline(-1 / s3, color=MUTED, lw=1.1, ls=REF)
    ax.text(2.6, 1 / s3 + 0.05, r"max $1/\sqrt{3}$ at $m=\sqrt{3}$", color=MUTED, fontsize=12)
    ax.text(-5.9, 0.12, r"$\frac{2m}{3+m^2}$", color=BLUE, fontsize=15)
    ax.set_xlim(-6, 6); ax.set_ylim(-0.7, 0.75)
    ax.set_xlabel(r"slope $m$ of the path $y=mx$", fontsize=13, loc="right")
    ax.set_ylabel("value along the path", fontsize=12, loc="top")
    save(fig, path)


def _polar_surface(fn, path, lim, labels):
    fig, ax = axes3d(7.6, 5.6, elev=26, azim=-60, lim=lim)
    r = np.linspace(0.02, 2.0, 26); t = np.linspace(0, 2 * np.pi, 73)
    R, T = np.meshgrid(r, t)
    X, Y = R * np.cos(T), R * np.sin(T)
    surface(ax, X, Y, fn(X, Y), alpha=0.9)
    for i, (s, col) in enumerate(labels):
        ax.text2D(0.02, 0.92 - 0.07 * i, s, transform=ax.transAxes, color=col, fontsize=13)
    return fig, ax


def removable(path):
    fn = lambda x, y: 3 * x**2 * y / (x**2 + y**2)
    fig, ax = _polar_surface(fn, path, ((-2.2, 2.5), (-2.2, 2.5), (-2.2, 2.4)),
                             [(r"$z=\dfrac{3x^2y}{x^2+y^2}$", BLUE), (r"limit $0$ at the origin; $f(0,0)$ undefined", VERM)])
    ax.plot([0], [0], [0], "o", color=VERM, ms=7, mfc="white", mew=2, zorder=10)
    save(fig, path)


def nolimit(path):
    fn = lambda x, y: 2 * x * y / (3 * x**2 + y**2)
    fig, ax = _polar_surface(fn, path, ((-2.2, 2.5), (-2.2, 2.5), (-0.8, 1.2)),
                             [(r"$z=\dfrac{2xy}{3x^2+y^2}$", BLUE), (r"ray $y=x$: height $\frac{1}{2}$", VERM), (r"$x$-axis: height $0$", GREEN)])
    s = np.linspace(0, 1.414, 30)
    ax.plot(s, s, 0 * s + 0.5, color=VERM, lw=CURVE, zorder=8)
    ax.plot(np.linspace(0, 2, 30), 0 * s, 0 * s, color=GREEN, lw=CURVE, zorder=8)
    ax.plot([0, 0], [0, 0], [0, 0.5], color=MUTED, lw=1.2, ls=REF, zorder=9)
    save(fig, path)


FIGURES = {"G1.1": sinxcosy, "G1.2": bell, "G2.1": paths, "G2.2": along_lines, "G3.1": removable, "G3.2": nolimit}
