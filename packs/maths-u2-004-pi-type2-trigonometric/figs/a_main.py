"""Figures for Unit 2 class 004 (PI Type 2). The deck has no graphs: every figure is added for clarity."""
import numpy as np
from figstyle import BLUE, VERM, GREEN, PURPLE, ORANGE, INK, MUTED, GUIDE, CURVE, DASH, REF, save, axes2d


def pi_vs_forcing(path):
    """Slide 004·8-9: forcing cos(2x+3) and its PI (cos(2x+3) - 8 sin(2x+3))/65, scaled by 10."""
    fig, ax = axes2d(7.2, 4.4)
    x = np.linspace(0, 2 * np.pi, 600)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    X = np.cos(2 * x + 3)
    P = (np.cos(2 * x + 3) - 8 * np.sin(2 * x + 3)) / 65
    ax.plot(x, X, color=BLUE, lw=CURVE)
    ax.plot(x, 10 * P, color=VERM, lw=CURVE, ls=DASH)
    amp = 10 / np.sqrt(65)
    ax.axhline(amp, color=MUTED, lw=1.1, ls=REF)
    ax.axhline(-amp, color=MUTED, lw=1.1, ls=REF)
    ax.text(0.1, 1.62, r"$X=\cos(2x+3)$", color=BLUE, fontsize=13)
    ax.text(2.9, 1.62, r"$10\times y_p$, $y_p=\frac{\cos(2x+3)-8\sin(2x+3)}{65}$", color=VERM, fontsize=12)
    ax.text(5.35, amp - 0.22, r"$\pm\frac{10}{\sqrt{65}}$", color=MUTED, fontsize=12)
    ax.set_xlim(0, 2 * np.pi); ax.set_ylim(-1.6, 1.95)
    ax.set_xticks([0, np.pi / 2, np.pi, 3 * np.pi / 2, 2 * np.pi])
    ax.set_xticklabels(["0", r"$\pi/2$", r"$\pi$", r"$3\pi/2$", r"$2\pi$"])
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    save(fig, path)


def amplitude_curve(path):
    """Amplitude of the PI of (D^2+4)y = sin ax is 1/|4-a^2|: blows up at a=2 where f(-a^2)=0."""
    fig, ax = axes2d(7.2, 4.6)
    a1 = np.linspace(0, 1.93, 300)
    a2 = np.linspace(2.07, 4, 300)
    ax.plot(a1, 1 / np.abs(4 - a1 ** 2), color=BLUE, lw=CURVE)
    ax.plot(a2, 1 / np.abs(4 - a2 ** 2), color=BLUE, lw=CURVE)
    a = np.linspace(0, 4, 600)
    damped = 1 / np.sqrt((4 - a ** 2) ** 2 + (0.8 * a) ** 2)
    ax.plot(a, damped, color=VERM, lw=2.2, ls=DASH)
    ax.axvline(2, color=MUTED, lw=1.2, ls=REF)
    ax.plot([1], [1 / 3], "o", color=INK, ms=6, zorder=5)
    ax.text(0.1, 1.6, r"$(D^2+4)y=\sin ax$: $\frac{1}{|4-a^2|}$", color=BLUE, fontsize=12)
    ax.text(2.45, 1.05, r"$(D^2+0.8D+4)y=\sin ax$", color=VERM, fontsize=12)
    ax.text(2.12, 2.8, r"$a=2$: $f(-a^2)=0$", color=MUTED, fontsize=12)
    ax.text(1.05, 0.12, r"$a=1$: $\frac{1}{3}$", color=INK, fontsize=12)
    ax.set_xlim(0, 4); ax.set_ylim(0, 3.1)
    ax.set_xlabel(r"forcing frequency $a$", fontsize=13, loc="right")
    ax.set_ylabel(r"amplitude of $y_p$", fontsize=13, loc="top")
    save(fig, path)


def growth_curve(path):
    """Failure case: PI of (D^2+4)y = sin 2x is -x cos 2x / 4 (grows), vs (D^2+4)y = sin x: sin x / 3 (bounded)."""
    fig, ax = axes2d(7.2, 4.6)
    x = np.linspace(0, 6 * np.pi, 1200)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, x / 4, color=MUTED, lw=1.1, ls=REF)
    ax.plot(x, -x / 4, color=MUTED, lw=1.1, ls=REF)
    ax.plot(x, -x * np.cos(2 * x) / 4, color=VERM, lw=2.2)
    ax.plot(x, np.sin(x) / 3, color=BLUE, lw=CURVE)
    ax.text(0.6, 3.9, r"$f(-a^2)=0$: $(D^2+4)y=\sin2x$, $y_p=-\frac{x\cos2x}{4}$", color=VERM, fontsize=12)
    ax.text(0.6, -4.55, r"$f(-a^2)\neq0$: $(D^2+4)y=\sin x$, $y_p=\frac{\sin x}{3}$", color=BLUE, fontsize=12)
    ax.text(15.6, 4.35, r"$\pm\frac{x}{4}$", color=MUTED, fontsize=12)
    ax.set_xlim(0, 6 * np.pi); ax.set_ylim(-5, 5)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    ax.set_ylabel(r"$y_p$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def sin_square(path):
    """sin^2 x = 1/2 - cos 2x / 2: a constant (Type 1, a=0) plus a Type 2 term."""
    fig, ax = axes2d(7.2, 4.4)
    x = np.linspace(0, 2 * np.pi, 600)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(x, np.sin(x) ** 2, color=BLUE, lw=CURVE)
    ax.axhline(0.5, color=GREEN, lw=2.2, ls=DASH)
    ax.plot(x, -np.cos(2 * x) / 2, color=VERM, lw=2.2, ls=DASH)
    ax.text(0.1, 1.07, r"$\sin^2x$", color=BLUE, fontsize=13)
    ax.text(2.45, 0.58, r"$\frac{1}{2}$ (Type 1, $a=0$)", color=GREEN, fontsize=12)
    ax.text(2.0, -0.7, r"$-\frac{1}{2}\cos2x$ (Type 2, $a=2$)", color=VERM, fontsize=12)
    ax.set_xlim(0, 2 * np.pi); ax.set_ylim(-0.8, 1.25)
    ax.set_xticks([0, np.pi / 2, np.pi, 3 * np.pi / 2, 2 * np.pi])
    ax.set_xticklabels(["0", r"$\pi/2$", r"$\pi$", r"$3\pi/2$", r"$2\pi$"])
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    save(fig, path)


FIGURES = {"G1.1": pi_vs_forcing, "G2.1": amplitude_curve, "G2.2": growth_curve, "G3.1": sin_square}
