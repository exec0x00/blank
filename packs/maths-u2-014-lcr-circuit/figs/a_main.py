"""Figures for Unit 2 class 014 (LCR circuits). G1.1 redraws slide 014·4; the rest are added for clarity."""
import numpy as np
from matplotlib.patches import Circle
from figstyle import BLUE, VERM, GREEN, INK, MUTED, GUIDE, CURVE, DASH, REF, save, axes2d


def circuit(path):
    """Series RLC loop: source + switch left, R top, L right, C bottom."""
    fig, ax = axes2d(7.0, 4.4)
    ax.set_axis_off()
    lw = 2.0
    x0, x1, y0, y1 = 0.0, 8.0, 0.0, 5.0
    # top wire with resistor zigzag
    zx = np.linspace(3.2, 4.8, 9)
    zy = y1 + np.array([0, .3, -.3, .3, -.3, .3, -.3, .3, 0])
    ax.plot([x0, 3.2], [y1, y1], color=INK, lw=lw)
    ax.plot(zx, zy, color=INK, lw=lw)
    ax.plot([4.8, x1], [y1, y1], color=INK, lw=lw)
    ax.text(4.0, y1 + 0.55, r"$R$", ha="center", fontsize=15)
    ax.text(4.0, y1 - 0.85, r"$V_R=RI$", ha="center", fontsize=12, color=MUTED)
    # right wire with inductor coils
    ax.plot([x1, x1], [y1, 3.4], color=INK, lw=lw)
    th = np.linspace(-np.pi / 2, np.pi / 2, 40)
    for k in range(4):
        yc = 3.2 - 0.4 * k
        ax.plot(x1 + 0.3 * np.cos(th), yc + 0.2 * np.sin(th), color=INK, lw=lw)
    ax.plot([x1, x1], [1.6, y0], color=INK, lw=lw)
    ax.text(x1 + 0.55, 2.45, r"$L$", fontsize=15, va="center")
    ax.text(x1 - 0.35, 2.45, r"$V_L=L\frac{dI}{dt}$", fontsize=12, color=MUTED, ha="right", va="center")
    # bottom wire with capacitor plates
    ax.plot([x1, 4.2], [y0, y0], color=INK, lw=lw)
    ax.plot([4.2, 4.2], [y0 - 0.5, y0 + 0.5], color=INK, lw=2.6)
    ax.plot([3.8, 3.8], [y0 - 0.5, y0 + 0.5], color=INK, lw=2.6)
    ax.plot([3.8, x0], [y0, y0], color=INK, lw=lw)
    ax.text(4.0, y0 - 1.05, r"$C$", ha="center", fontsize=15)
    ax.text(4.0, y0 + 0.75, r"$V_C=Q/C$", ha="center", fontsize=12, color=MUTED)
    ax.text(4.75, y0 + 0.3, r"$+Q$", fontsize=11, color=MUTED)
    # left: source and switch
    ax.plot([x0, x0], [y0, 1.9], color=INK, lw=lw)
    ax.add_patch(Circle((x0, 2.4), 0.5, fill=False, ec=INK, lw=lw))
    ax.text(x0, 2.4, r"$E(t)$", ha="center", va="center", fontsize=12)
    ax.plot([x0, x0], [2.9, 3.6], color=INK, lw=lw)
    ax.plot([x0, x0 + 0.55], [3.6, 4.4], color=INK, lw=lw)
    ax.plot([x0], [3.6], "o", color=INK, ms=4)
    ax.plot([x0], [4.4], "o", color=INK, ms=4)
    ax.plot([x0, x0], [4.4, y1], color=INK, lw=lw)
    ax.text(x0 - 0.3, 4.0, "switch", ha="right", va="center", fontsize=12)
    # current arrow
    ax.annotate("", xy=(2.6, y1), xytext=(1.4, y1), arrowprops=dict(arrowstyle="-|>", color=VERM, lw=2))
    ax.text(2.0, y1 + 0.35, r"$I$", color=VERM, fontsize=15, ha="center")
    ax.set_xlim(-2.0, 10.6); ax.set_ylim(-1.5, 6.2); ax.set_aspect("equal")
    save(fig, path)


def slide_example(path):
    fig, ax = axes2d(7.2, 4.4)
    t = np.linspace(0, 6, 600)
    Q = 1 + np.exp(-2 * t) * (-np.cos(t) - 2 * np.sin(t))
    I = 5 * np.exp(-2 * t) * np.sin(t)
    ax.axhline(1, color=MUTED, lw=1.1, ls=REF)
    ax.plot(t, Q, color=BLUE, lw=CURVE)
    ax.plot(t, I, color=VERM, lw=CURVE)
    ax.text(3.0, 1.06, r"$Q(t)=1-e^{-2t}(\cos t+2\sin t)$", color=BLUE, fontsize=12)
    ax.text(5.0, 0.9, r"$CE=1$", color=MUTED, fontsize=12)
    ax.text(0.75, 1.13, r"$I(t)=5e^{-2t}\sin t$", color=VERM, fontsize=12)
    ax.set_xlim(0, 6); ax.set_ylim(0, 1.3)
    ax.set_xlabel(r"$t$ (s)", fontsize=13, loc="right")
    ax.set_ylabel(r"$Q$ (C), $I$ (A)", fontsize=13, loc="top")
    save(fig, path)


def regimes(path):
    fig, ax = axes2d(7.2, 4.6)
    t = np.linspace(0, 16, 1000)

    def free(R):
        m1, m2 = np.roots([1, R, 1]).astype(complex)
        return np.real((m2 * np.exp(m1 * t) - m1 * np.exp(m2 * t)) / (m2 - m1))
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(t, np.exp(-t / 4), color=MUTED, lw=1.1, ls=REF)
    ax.plot(t, -np.exp(-t / 4), color=MUTED, lw=1.1, ls=REF)
    ax.plot(t, free(0.5), color=VERM, lw=CURVE)
    ax.plot(t, (1 + t) * np.exp(-t), color=GREEN, lw=CURVE, ls=DASH)
    ax.plot(t, free(3.0), color=BLUE, lw=CURVE)
    ax.text(3.4, 0.62, r"$R=3$: overdamped ($9>4$)", color=BLUE, fontsize=12)
    ax.text(8.6, 0.4, r"$R=2$: critical ($4=4$)", color=GREEN, fontsize=12)
    ax.text(6.6, -0.78, r"$R=0.5$: underdamped ($0.25<4$)", color=VERM, fontsize=12)
    ax.text(12.8, -0.33, r"$\pm e^{-t/4}$", color=MUTED, fontsize=12)
    ax.set_xlim(0, 16); ax.set_ylim(-1.0, 1.1)
    ax.set_xlabel(r"$t$", fontsize=14, loc="right")
    ax.set_ylabel(r"$Q$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def slide_ac(path):
    fig, ax = axes2d(7.2, 4.4)
    t = np.linspace(0, 0.06, 3000)
    ss = -0.483808 * np.cos(377 * t) + 1.38044 * np.sin(377 * t)
    i = -0.0423597 * np.exp(-10.1021 * t) + 0.526168 * np.exp(-989.898 * t) + ss
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(t * 1000, ss, color=MUTED, lw=1.4, ls=REF)
    ax.plot(t * 1000, i - ss, color=GREEN, lw=2.2, ls=DASH)
    ax.plot(t * 1000, i, color=VERM, lw=CURVE)
    ax.text(1.8, -1.3, r"transient $i-i_{ss}$", color=GREEN, fontsize=12)
    ax.text(0.5, 1.75, r"$i(t)$, from $i(0)=0$", color=VERM, fontsize=12)
    ax.text(22, 1.75, r"steady state $-0.484\cos377t+1.380\sin377t$", color=MUTED, fontsize=12)
    ax.set_xlim(0, 60); ax.set_ylim(-1.8, 2.0)
    ax.set_xlabel(r"$t$ (ms)", fontsize=13, loc="right")
    ax.set_ylabel(r"$i$ (A)", fontsize=13, loc="top")
    save(fig, path)


def esa_s3(path):
    fig, ax = axes2d(7.2, 4.6)
    t = np.linspace(0, 2.5, 2000)
    ss = 0.15 * np.cos(5 * t) + 0.05 * np.sin(5 * t)
    tr = -np.exp(-20 * t) * (0.15 * np.cos(15 * t) + 13 / 60 * np.sin(15 * t))
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(t, ss, color=MUTED, lw=1.4, ls=REF)
    ax.plot(t, tr, color=GREEN, lw=2.2, ls=DASH)
    ax.plot(t, ss + tr, color=BLUE, lw=CURVE)
    ax.text(0.12, 0.205, r"$Q=$ transient $+$ steady state", color=BLUE, fontsize=12)
    ax.text(0.3, -0.2, r"transient $-e^{-20t}(0.15\cos15t+\frac{13}{60}\sin15t)$", color=GREEN, fontsize=12)
    ax.text(1.5, 0.205, r"$0.15\cos5t+0.05\sin5t$", color=MUTED, fontsize=12)
    ax.set_xlim(0, 2.5); ax.set_ylim(-0.24, 0.25)
    ax.set_xlabel(r"$t$ (s)", fontsize=13, loc="right")
    ax.set_ylabel(r"$Q$ (C)", fontsize=13, loc="top")
    save(fig, path)


def discharge(path):
    fig, ax = axes2d(7.2, 4.4)
    t = np.linspace(0, 0.012, 3000)
    w = 500 * np.sqrt(7)
    q = np.exp(-500 * t) * (0.002 * np.cos(w * t) + 0.002 / np.sqrt(7) * np.sin(w * t))
    A = np.hypot(0.002, 0.002 / np.sqrt(7))
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(t * 1000, 1000 * A * np.exp(-500 * t), color=MUTED, lw=1.1, ls=REF)
    ax.plot(t * 1000, -1000 * A * np.exp(-500 * t), color=MUTED, lw=1.1, ls=REF)
    ax.plot(t * 1000, 1000 * q, color=BLUE, lw=CURVE)
    ax.text(3.6, 1.55, r"$q=e^{-500t}(0.002\cos1322.9t+0.000756\sin1322.9t)$", color=BLUE, fontsize=12)
    ax.text(6.3, 0.7, r"$\pm0.00214\,e^{-500t}$", color=MUTED, fontsize=12)
    ax.set_xlim(0, 12); ax.set_ylim(-1.8, 2.3)
    ax.set_xlabel(r"$t$ (ms)", fontsize=13, loc="right")
    ax.set_ylabel(r"$q$ (mC)", fontsize=13, loc="top")
    save(fig, path)


def rl(path):
    fig, ax = axes2d(7.2, 4.4)
    E, R, L, w = 10, 2, 1, 4
    Z = np.hypot(R, L * w); ph = np.arctan2(L * w, R)
    t = np.linspace(0, 6, 1500)
    ss = E / Z * np.sin(w * t - ph)
    tr = E / Z * np.sin(ph) * np.exp(-R * t / L)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0)
    ax.plot(t, ss, color=MUTED, lw=1.4, ls=REF)
    ax.plot(t, tr, color=GREEN, lw=2.2, ls=DASH)
    ax.plot(t, ss + tr, color=VERM, lw=CURVE)
    ax.text(0.9, 3.3, r"transient $\frac{E\sin\varphi}{\sqrt{R^2+L^2\omega^2}}e^{-Rt/L}$", color=GREEN, fontsize=12)
    ax.text(3.0, -3.0, r"steady state $\frac{E}{\sqrt{R^2+L^2\omega^2}}\sin(\omega t-\varphi)$", color=MUTED, fontsize=12)
    ax.text(5.0, 3.3, r"$i(t)$", color=VERM, fontsize=13)
    ax.set_xlim(0, 6); ax.set_ylim(-3.2, 4.0)
    ax.set_xlabel(r"$t$ (s)", fontsize=13, loc="right")
    ax.set_ylabel(r"$i$ (A)", fontsize=13, loc="top")
    save(fig, path)


FIGURES = {"G1.1": circuit, "G2.1": slide_example, "G2.2": regimes, "G2.3": slide_ac,
           "G3.1": esa_s3, "G3.2": discharge, "G4.1": rl}
