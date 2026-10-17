"""Figures for Unit 2 class 015 (SHM). G1.1 redraws slide 015·5; the rest are added for clarity."""
import numpy as np
from matplotlib.patches import Rectangle
from figstyle import BLUE, VERM, GREEN, PURPLE, INK, MUTED, GUIDE, CURVE, DASH, REF, save, axes2d


def _spring(ax, x, y_top, y_bot, coils=9, w=0.22):
    ys = np.linspace(y_top, y_bot, 2 * coils + 1)
    xs = [x] + [x + (w if k % 2 else -w) for k in range(1, 2 * coils)] + [x]
    ax.plot(xs, ys, color=INK, lw=1.6)


def springs(path):
    fig, ax = axes2d(7.0, 4.6)
    ax.set_axis_off()
    top = 10.0
    ax.add_patch(Rectangle((0.2, top), 8.6, 0.25, fc="#dddddd", ec=INK, lw=1.2))
    L_end, s_end, x_end = 5.4, 4.2, 2.4
    # natural length
    _spring(ax, 1.2, top, L_end)
    ax.text(1.2, L_end - 0.6, "natural length", ha="center", fontsize=11, color=MUTED)
    # equilibrium
    _spring(ax, 4.2, top, s_end)
    ax.add_patch(Rectangle((3.75, s_end - 0.9), 0.9, 0.9, fc="#FBE9DF", ec=INK, lw=1.2))
    ax.text(4.2, s_end - 0.45, r"$m$", ha="center", va="center", fontsize=13)
    ax.text(4.2, s_end - 1.5, r"equilibrium: $mg=ks$", ha="center", fontsize=11, color=MUTED)
    # in motion
    _spring(ax, 7.2, top, x_end)
    ax.add_patch(Rectangle((6.75, x_end - 0.9), 0.9, 0.9, fc="#FBE9DF", ec=INK, lw=1.2))
    ax.text(7.2, x_end - 0.45, r"$m$", ha="center", va="center", fontsize=13)
    ax.text(7.2, x_end - 1.5, "in motion", ha="center", fontsize=11, color=MUTED)
    # reference lines
    ax.plot([0.6, 8.6], [L_end, L_end], color=MUTED, lw=1, ls=REF)
    ax.plot([3.0, 8.6], [s_end, s_end], color=VERM, lw=1, ls=REF)
    ax.text(8.65, s_end, r"$x=0$", color=VERM, fontsize=12, va="center")
    # dimension arrows
    def dim(xp, y0, y1, lab, dx=0.35):
        ax.annotate("", xy=(xp, y1), xytext=(xp, y0), arrowprops=dict(arrowstyle="<->", color=INK, lw=1.0))
        ax.text(xp + dx, (y0 + y1) / 2, lab, fontsize=13, va="center")
    dim(2.0, top, L_end, r"$L$")
    dim(5.0, L_end, s_end, r"$s$")
    dim(8.0, s_end, x_end, r"$x$")
    ax.annotate("", xy=(1.2, 1.6), xytext=(1.2, 3.0), arrowprops=dict(arrowstyle="->", color=BLUE, lw=1.4))
    ax.text(1.4, 2.3, "positive $x$\ndownward", color=BLUE, fontsize=10, va="center")
    ax.set_xlim(0, 9.6); ax.set_ylim(0.6, 10.5)
    save(fig, path)


def motion12(path):
    fig, ax = axes2d(7.2, 4.4)
    t = np.linspace(0, 2.0, 2000)
    x = np.cos(8 * t) / 3 - np.sin(8 * t) / 4
    A = 5 / 12
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.axhline(A, color=MUTED, lw=1.1, ls=REF)
    ax.axhline(-A, color=MUTED, lw=1.1, ls=REF)
    ax.plot(t, x, color=BLUE, lw=CURVE)
    ax.plot([0], [1 / 3], "o", color=INK, ms=6, zorder=5)
    T = np.pi / 4
    ax.annotate("", xy=(T + 0.08, 0.5), xytext=(0.08, 0.5), arrowprops=dict(arrowstyle="<->", color=INK, lw=1.0))
    ax.text(0.2, 0.53, r"period $T=\pi/4$", fontsize=12)
    ax.text(1.32, A + 0.03, r"$A=5/12$", color=MUTED, fontsize=12)
    ax.text(1.32, -A - 0.1, r"$-A$", color=MUTED, fontsize=12)
    ax.text(0.05, 0.27, r"$x(0)=\frac{1}{3}$", fontsize=12)
    ax.text(1.02, 0.52, r"$x=\frac{1}{3}\cos 8t-\frac{1}{4}\sin 8t$", color=BLUE, fontsize=12)
    ax.set_xlim(0, 2.0); ax.set_ylim(-0.55, 0.62)
    ax.set_xlabel(r"$t$ (s)", fontsize=13, loc="right")
    ax.set_ylabel(r"$x$ (ft)", fontsize=13, loc="top")
    save(fig, path)


def motion8(path):
    fig, ax = axes2d(7.2, 4.4)
    w = 4 * np.sqrt(3)
    t = np.linspace(0, 2.0, 2000)
    x = -5 / 12 * np.cos(w * t)
    v = 5 * np.sqrt(3) / 3 * np.sin(w * t)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(t, v, color=VERM, lw=2.2, ls=DASH)
    ax.plot(t, x, color=BLUE, lw=CURVE)
    tz = np.pi / (2 * w)
    ax.plot([tz], [5 / np.sqrt(3)], "o", color=VERM, ms=6)
    ax.plot([tz], [0], "o", color=BLUE, ms=6)
    ax.text(tz + 0.04, 5 / np.sqrt(3) + 0.12, r"$v_{\max}=5/\sqrt{3}$ at $x=0$", color=VERM, fontsize=12)
    ax.text(0.76, -3.3, r"$x=-\frac{5}{12}\cos 4\sqrt{3}t$ (ft)", color=BLUE, fontsize=12)
    ax.text(1.42, 3.05, r"$\dot x$ (ft/s)", color=VERM, fontsize=12)
    ax.set_xlim(0, 2.0); ax.set_ylim(-3.6, 3.6)
    ax.set_xlabel(r"$t$ (s)", fontsize=13, loc="right")
    save(fig, path)


def damped(path):
    fig, ax = axes2d(7.2, 4.6)
    t = np.linspace(0, 25, 3000)

    def under(l):
        wd = np.sqrt(1 - l * l)
        return np.exp(-l * t) * np.sin(wd * t) / wd
    env = np.exp(-0.1 * t) / np.sqrt(1 - 0.01)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(t, env, color=MUTED, lw=1.1, ls=REF)
    ax.plot(t, -env, color=MUTED, lw=1.1, ls=REF)
    ax.plot(t, under(0.1), color=BLUE, lw=CURVE)
    ax.plot(t, under(0.3), color=VERM, lw=CURVE)
    ax.plot(t, t * np.exp(-t), color=GREEN, lw=CURVE, ls=DASH)
    r = np.sqrt(3)
    ax.plot(t, np.exp(-2 * t) * np.sinh(r * t) / r, color=PURPLE, lw=CURVE)
    ax.text(14, 0.95, r"$\lambda=0.1$", color=BLUE, fontsize=12)
    ax.text(14, 0.82, r"$\lambda=0.3$", color=VERM, fontsize=12)
    ax.text(14, 0.69, r"$\lambda=1$ (critical)", color=GREEN, fontsize=12)
    ax.text(14, 0.56, r"$\lambda=2$ (overdamped)", color=PURPLE, fontsize=12)
    ax.text(19.5, 0.22, r"$\pm e^{-0.1t}/\sqrt{0.99}$", color=MUTED, fontsize=11)
    ax.set_xlim(0, 25); ax.set_ylim(-1.05, 1.1)
    ax.set_xlabel(r"$nt$", fontsize=13, loc="right")
    ax.set_ylabel(r"$x\,n/x_0$", fontsize=13, loc="top")
    save(fig, path)


FIGURES = {"G1.1": springs, "G2.1": motion12, "G2.2": motion8, "G3.1": damped}
