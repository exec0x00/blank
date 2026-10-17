"""Figures for Unit 2 class 002: Nernst equation (Graph_Style_Guide_v2 via engine/figstyle.py)."""
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyBboxPatch, Circle, FancyArrowPatch
from figstyle import BLUE, VERM, GREEN, PURPLE, ORANGE, INK, MUTED, GUIDE, TINT, CURVE, DASH, REF, save, axes2d

S = 0.0591   # 2.303RT/F at 298 K, as on the slides


def _beaker(ax, x0, w, h, fill):
    ax.add_patch(Rectangle((x0, 0.4), w, h * 0.78, facecolor=fill, edgecolor="none", zorder=1))
    ax.plot([x0, x0, x0 + w, x0 + w], [0.4 + h, 0.4, 0.4, 0.4 + h], color=INK, lw=2.2, zorder=3)


def single_electrode(path):
    fig, ax = plt.subplots(figsize=(7.0, 4.6))
    ax.set_xlim(0, 10); ax.set_ylim(0, 6.2); ax.axis("off")
    _beaker(ax, 1.0, 4.2, 4.4, TINT["blue"])
    ax.add_patch(Rectangle((2.65, 1.3), 0.9, 4.6, facecolor="#c9ccd1", edgecolor=INK, lw=1.6, zorder=4))
    ax.text(3.1, 5.55, r"$\mathrm{M}$", ha="center", fontsize=15, zorder=5)
    # double layer: charges on metal surface and solution side (case: deposition faster)
    for y in np.linspace(1.6, 3.6, 5):
        ax.text(3.72, y, "+", color=VERM, fontsize=13, ha="center", va="center", zorder=5)
        ax.text(4.12, y, r"$-$", color=BLUE, fontsize=13, ha="center", va="center", zorder=5)
    for (x, y) in ((1.5, 1.2), (1.6, 2.9), (4.7, 1.0), (4.75, 3.9), (1.9, 3.9)):
        ax.text(x, y, r"$\mathrm{M^{n+}}$", color=BLUE, fontsize=12, ha="center", va="center", zorder=5)
    ax.text(3.1, 0.05, r"solution of $\mathrm{M^{n+}}$, concentration $[\mathrm{M^{n+}}]$", ha="center", fontsize=12)
    # reaction box on the right
    ax.text(5.9, 4.9, "reduction at the electrode", fontsize=12, color=MUTED)
    ax.text(5.9, 4.25, r"$\mathrm{M^{n+}} + n\,e^- \rightleftharpoons \mathrm{M}$", fontsize=15)
    ax.text(5.9, 3.25, r"$E$ = electrode potential", fontsize=13)
    ax.text(5.9, 2.65, r"depends on $[\mathrm{M^{n+}}]$ and $T$", fontsize=13)
    ax.text(5.9, 1.65, "electrical double layer", fontsize=12, color=VERM)
    ax.add_patch(FancyArrowPatch((5.85, 1.75), (4.3, 2.6), arrowstyle="-|>", mutation_scale=12, color=VERM, lw=1.2))
    save(fig, path)


def e_minus_e0(path):
    fig, ax = axes2d(7.0, 4.4)
    x = np.linspace(-4, 0.5, 100)
    for n, col, ls, yl in ((1, BLUE, "-", 0.042), (2, VERM, "-", 0.016), (3, GREEN, DASH, -0.012)):
        ax.plot(x, S / n * x, color=col, lw=CURVE, ls=ls)
        ax.text(0.62, yl, rf"$n={n}$: slope ${S / n + 1e-9:.4f}$", color=col, fontsize=12, va="center")
    ax.axhline(0, color=MUTED, lw=1.0, ls=REF); ax.axvline(0, color=MUTED, lw=1.0, ls=REF)
    ax.text(-3.95, 0.008, r"$E=E^\circ$ at $[\mathrm{M^{n+}}]=1\ \mathrm{M}$", color=MUTED, fontsize=11)
    ax.plot([-2], [-2 * S / 2], "o", color=INK, ms=6, zorder=5)
    ax.annotate(r"$\mathrm{Zn^{2+}}$ 0.01 M: $-0.0591$ V", (-2, -S), (-3.1, -0.225), fontsize=12,
                arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.9))
    ax.set_xlim(-4.1, 2.6); ax.set_ylim(-0.25, 0.06)
    ax.set_xticks([-4, -3, -2, -1, 0]); ax.set_yticks([-0.24, -0.18, -0.12, -0.06, 0])
    ax.set_xlabel(r"$\log_{10}[\mathrm{M^{n+}}]$", fontsize=13, loc="right")
    ax.set_ylabel(r"$E-E^\circ$ / V", fontsize=13, loc="top")
    save(fig, path)


def zn_cu_lines(path):
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(7.0, 6.4), sharex=True)
    x = np.linspace(-4, 0.3, 100)
    for ax, E0, col, name, pts in ((a1, 0.34, VERM, r"$\mathrm{Cu^{2+}/Cu}$", [(-1, "0.1 M")]),
                                    (a2, -0.76, BLUE, r"$\mathrm{Zn^{2+}/Zn}$", [(-2, "0.01 M")])):
        ax.plot(x, E0 + S / 2 * x, color=col, lw=CURVE)
        ax.axhline(E0, color=MUTED, lw=1.0, ls=REF)
        ax.text(-3.95, E0 + 0.006, rf"$E^\circ={E0:+.2f}$ V", color=MUTED, fontsize=11)
        ax.text(-3.95, E0 - 0.035, name + r", $n=2$, slope $0.0296$ V/decade", color=col, fontsize=12)
        for lx, lab in pts:
            y = E0 + S / 2 * lx
            ax.plot([lx], [y], "o", color=INK, ms=6, zorder=5)
            ax.annotate(rf"{lab}: ${y:+.4f}$ V", (lx, y), (lx + 0.3, y - 0.05),
                        fontsize=12, arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.9))
        ax.set_ylim(E0 - 0.14, E0 + 0.03)
        ax.set_ylabel(r"$E$ / V", fontsize=13, loc="top")
        ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)
    a2.set_xlabel(r"$\log_{10}[\mathrm{M^{n+}}]$", fontsize=13, loc="right")
    a2.set_xticks([-4, -3, -2, -1, 0])
    fig.tight_layout(h_pad=2.0)
    save(fig, path)


def factor_vs_T(path):
    fig, ax = axes2d(7.0, 4.0)
    T = np.linspace(273, 373, 50)
    f = 2.303 * 8.314 * T / 96500
    ax.plot(T, f, color=BLUE, lw=CURVE)
    for t, lab, dx, dy in ((298, "298 K: 0.0591 V", -22, 0.0016), (308, "308 K: 0.0611 V", 6, -0.0016)):
        y = 2.303 * 8.314 * t / 96500
        ax.plot([t], [y], "o", color=INK, ms=6, zorder=5)
        ax.text(t + dx, y + dy, lab, fontsize=12)
    ax.text(345, 0.0585, r"$2.303\,RT/F$", color=BLUE, fontsize=14)
    ax.set_xlim(270, 376); ax.set_ylim(0.053, 0.0755)
    ax.set_xlabel(r"$T$ / K", fontsize=13, loc="right"); ax.set_ylabel(r"factor / V", fontsize=13, loc="top")
    save(fig, path)


def al_cu_cell(path):
    fig, ax = plt.subplots(figsize=(7.0, 4.9))
    ax.set_xlim(0, 12); ax.set_ylim(-0.4, 7.4); ax.axis("off")
    _beaker(ax, 0.7, 3.6, 3.9, TINT["blue"]); _beaker(ax, 7.7, 3.6, 3.9, TINT["verm"])
    ax.add_patch(Rectangle((2.15, 1.2), 0.7, 4.2, facecolor="#c9ccd1", edgecolor=INK, lw=1.5, zorder=4))
    ax.add_patch(Rectangle((9.15, 1.2), 0.7, 4.2, facecolor="#d9a07a", edgecolor=INK, lw=1.5, zorder=4))
    ax.text(2.5, 1.55, r"$\mathrm{Al}$", ha="center", fontsize=13, zorder=5)
    ax.text(9.5, 1.55, r"$\mathrm{Cu}$", ha="center", fontsize=13, zorder=5)
    # salt bridge (inverted U)
    xs = [3.5, 3.5, 8.5, 8.5]; ys = [2.3, 4.95, 4.95, 2.3]
    ax.plot(xs, ys, color=MUTED, lw=12, solid_capstyle="butt", zorder=2, alpha=0.55)
    ax.text(6.0, 5.5, "salt bridge", ha="center", fontsize=12, color=MUTED)
    # wire and voltmeter
    ax.plot([2.5, 2.5, 5.45], [5.4, 6.7, 6.7], color=INK, lw=1.6)
    ax.plot([6.55, 9.5, 9.5], [6.7, 6.7, 5.4], color=INK, lw=1.6)
    ax.add_patch(Circle((6.0, 6.7), 0.55, facecolor="white", edgecolor=INK, lw=1.8, zorder=5))
    ax.text(6.0, 6.7, "V", ha="center", va="center", fontsize=14, zorder=6)
    ax.add_patch(FancyArrowPatch((3.2, 7.05), (5.2, 7.05), arrowstyle="-|>", mutation_scale=14, color=VERM, lw=1.6))
    ax.text(3.2, 7.2, r"$e^-$ flow", color=VERM, fontsize=12)
    ax.text(2.5, 0.0, r"$\mathrm{Al^{3+}}$ (0.35 M)", ha="center", fontsize=12, color=BLUE)
    ax.text(9.5, 0.0, r"$\mathrm{Cu^{2+}}$ (0.6 M)", ha="center", fontsize=12, color=VERM)
    ax.text(0.5, 6.0, "anode $(-)$\noxidation", fontsize=12, ha="left")
    ax.text(11.5, 6.0, "cathode $(+)$\nreduction", fontsize=12, ha="right")
    ax.text(2.5, -0.55, r"$\mathrm{Al\rightarrow Al^{3+}+3e^-}$", ha="center", fontsize=12)
    ax.text(9.5, -0.55, r"$\mathrm{Cu^{2+}+2e^-\rightarrow Cu}$", ha="center", fontsize=12)
    save(fig, path)


def ecell_vs_logq(path):
    fig, ax = axes2d(7.0, 4.2)
    x = np.linspace(-3, 3, 100)
    for n, col, ls, lab in ((2, BLUE, "-", r"Daniell, $n=2$"), (6, VERM, DASH, r"$\mathrm{Al/Cu}$, $n=6$")):
        ax.plot(x, -S / n * x, color=col, lw=CURVE, ls=ls)
        ax.text(3.08, -S / n * 3, lab + rf": slope $-{S / n + 1e-9:.4f}$", color=col, fontsize=12, va="center")
    ax.axhline(0, color=MUTED, lw=1.0, ls=REF); ax.axvline(0, color=MUTED, lw=1.0, ls=REF)
    lq = np.log10(0.35**2 / 0.6**3)
    ax.plot([lq], [-S / 6 * lq], "o", color=INK, ms=6, zorder=5)
    ax.annotate(r"ESA: $\log Q=-0.246$, $+0.0024$ V", (lq, -S / 6 * lq), (0.5, 0.032), fontsize=12,
                arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.9))
    ax.plot([-1], [S / 2], "o", color=INK, ms=6, zorder=5)
    ax.annotate(r"$\mathrm{Zn}$ 0.01 M, $\mathrm{Cu}$ 0.1 M: $+0.0296$ V", (-1, S / 2), (0.3, 0.068), fontsize=12,
                arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.9))
    ax.text(0.08, -0.085, r"$Q=1$: $E_{cell}=E^\circ_{cell}$", color=MUTED, fontsize=11)
    ax.set_xlim(-3.1, 6.6); ax.set_ylim(-0.095, 0.095)
    ax.set_xticks([-3, -2, -1, 0, 1, 2, 3])
    ax.set_xlabel(r"$\log_{10} Q$", fontsize=13, loc="right"); ax.set_ylabel(r"$E_{cell}-E^\circ_{cell}$ / V", fontsize=13, loc="top")
    save(fig, path)


FIGURES = {"G1.1": single_electrode, "G3.1": e_minus_e0, "G3.2": zn_cu_lines, "G3.3": factor_vs_T,
           "G4.1": al_cu_cell, "G4.2": ecell_vs_logq}
