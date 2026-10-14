"""Figures for class 006 (Graph_Style_Guide_v2 via engine/figstyle.py)."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, PURPLE, INK, MUTED, GUIDE, CURVE, REF, save, axes2d


def scaling_test(path):
    """u(λx, λy)/u(x, y) against λ on log-log axes at the point (1, 2): a power law is a straight line of slope n."""
    fig, ax = axes2d(7.2, 4.8)
    lam = np.logspace(np.log10(0.25), np.log10(4), 300)
    x, y = 1.0, 2.0
    z = lambda a, b: (a + b) / (np.sqrt(a) + np.sqrt(b))
    s6 = lambda a, b: np.arcsin(np.clip(b / a, -1, 1)) / np.hypot(a, b)
    s8 = lambda a, b: (np.exp(a) - np.exp(b)) / (a - b)
    x6, y6 = 2.0, 1.0                          # sin^{-1}(y/x) needs y <= x
    series = [
        (np.ones_like(lam), BLUE, r"slide 5: degree $0$ (flat)"),
        (s6(lam * x6, lam * y6) / s6(x6, y6), VERM, r"slide 6: degree $-1$"),
        (z(lam * x, lam * y) / z(x, y), GREEN, r"slide 3: $Z$, degree $\frac{1}{2}$"),
        (s8(lam * x, lam * y) / s8(x, y), PURPLE, r"slide 8: not homogeneous"),
    ]
    for r, col, lab in series:
        ax.plot(lam, r, color=col, lw=CURVE)
    ax.set_xscale("log"); ax.set_yscale("log")
    ax.set_xlim(0.25, 4); ax.set_ylim(0.08, 30)
    ax.axvline(1, color=MUTED, lw=1.2, ls=REF)
    ax.text(1.05, 20, r"$\lambda=1$", color=MUTED, fontsize=12)
    ax.text(1.5, 0.88, series[0][2], color=BLUE, fontsize=12, va="top")
    ax.text(0.27, 5.2, series[1][2], color=VERM, fontsize=12)
    ax.text(3.95, 2.25, series[2][2], color=GREEN, fontsize=12, va="bottom", ha="right")
    ax.text(0.9, 12, series[3][2], color=PURPLE, fontsize=12, ha="right")
    ax.set_xticks([0.25, 0.5, 1, 2, 4]); ax.set_xticklabels(["0.25", "0.5", "1", "2", "4"])
    ax.set_yticks([0.1, 0.3, 1, 3, 10, 30]); ax.set_yticklabels(["0.1", "0.3", "1", "3", "10", "30"])
    ax.minorticks_off()
    ax.set_xlabel(r"scale factor $\lambda$ (log scale)", fontsize=13, loc="right")
    ax.set_ylabel(r"$u(\lambda x,\lambda y)\,/\,u(x,y)$", fontsize=13, loc="top")
    save(fig, path)


def extension_g(path):
    """g(u)/n = f(u)/f'(u) for the four choices of f used in class 006."""
    fig, ax = axes2d(7.2, 4.6)
    u = np.linspace(0.02, 1.5, 400)
    ax.plot(u, np.tan(u), color=BLUE, lw=CURVE)
    ax.plot(u, 0.5 * np.sin(2 * u), color=VERM, lw=CURVE)
    ax.plot(u, np.ones_like(u), color=GREEN, lw=CURVE)
    ax.plot(u[u > 0.05], (u * np.log(u))[u > 0.05], color=PURPLE, lw=CURVE)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.text(1.18, 3.2, r"$f=\sin$: $\tan u$", color=BLUE, fontsize=12, ha="right")
    ax.text(0.80, 0.62, r"$f=\tan$: $\frac{1}{2}\sin 2u$", color=VERM, fontsize=12)
    ax.text(0.05, 1.12, r"$f=e^u$: $1$", color=GREEN, fontsize=12)
    ax.text(0.95, -0.42, r"$f=\log$: $u\log u$", color=PURPLE, fontsize=12)
    ax.set_xlim(0, 1.55); ax.set_ylim(-0.6, 4)
    ax.set_xlabel(r"$u$", fontsize=14, loc="right")
    ax.set_ylabel(r"$g(u)/n=f(u)/f'(u)$", fontsize=13, loc="top")
    save(fig, path)


FIGURES = {"G1.1": scaling_test, "G4.1": extension_g}
