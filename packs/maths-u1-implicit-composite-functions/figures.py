"""Figures for class 004 (Graph_Style_Guide_v2 via engine/figstyle.py)."""
import numpy as np
import matplotlib.pyplot as plt
from figstyle import (BLUE, VERM, GREEN, PURPLE, ORANGE, INK, MUTED, GUIDE, CURVE, DASH, REF,
                      save, axes2d, axes3d, surface, plane)


def _bare(ax):
    ax.set_axis_off()


def _node(ax, x, y, s, color=INK, size=15):
    ax.text(x, y, s, ha="center", va="center", fontsize=size, color=color,
            bbox=dict(boxstyle="round,pad=0.35", fc="white", ec=color, lw=1.2))


def _edge(ax, a, b, label, color, side=1, off=(0, 0)):
    ax.plot([a[0], b[0]], [a[1], b[1]], color=color, lw=2.0, zorder=0)
    mx, my = (a[0] + b[0]) / 2 + off[0], (a[1] + b[1]) / 2 + off[1]
    ax.text(mx, my, label, ha="center", va="center", fontsize=14, color=color,
            bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none"))


def tree_chain(path):
    fig, ax = plt.subplots(figsize=(7, 5.0)); _bare(ax)
    z, x, y = (0, 0), (3, 1.9), (3, -1.9)
    leaves = {"xu": (6, 2.9), "xv": (6, 0.9), "yu": (6, -0.9), "yv": (6, -2.9)}
    _edge(ax, z, x, r"$\dfrac{\partial z}{\partial x}$", INK, off=(-0.3, 0.35))
    _edge(ax, z, y, r"$\dfrac{\partial z}{\partial y}$", INK, off=(-0.3, -0.35))
    _edge(ax, x, leaves["xu"], r"$\dfrac{\partial x}{\partial u}$", BLUE, off=(0, 0.42))
    _edge(ax, x, leaves["xv"], r"$\dfrac{\partial x}{\partial v}$", VERM, off=(0, -0.42))
    _edge(ax, y, leaves["yu"], r"$\dfrac{\partial y}{\partial u}$", BLUE, off=(0, 0.42))
    _edge(ax, y, leaves["yv"], r"$\dfrac{\partial y}{\partial v}$", VERM, off=(0, -0.42))
    _node(ax, *z, r"$z=f(x,y)$"); _node(ax, *x, r"$x=g(u,v)$"); _node(ax, *y, r"$y=h(u,v)$")
    for k, p in leaves.items():
        _node(ax, *p, "$" + k[1] + "$", BLUE if k[1] == "u" else VERM)
    ax.text(-1.3, -4.0, r"$\dfrac{\partial z}{\partial u}=\dfrac{\partial z}{\partial x}\dfrac{\partial x}{\partial u}+\dfrac{\partial z}{\partial y}\dfrac{\partial y}{\partial u}$", color=BLUE, fontsize=14)
    ax.text(3.6, -4.0, r"$\dfrac{\partial z}{\partial v}=\dfrac{\partial z}{\partial x}\dfrac{\partial x}{\partial v}+\dfrac{\partial z}{\partial y}\dfrac{\partial y}{\partial v}$", color=VERM, fontsize=14)
    ax.set_xlim(-1.4, 7.6); ax.set_ylim(-4.6, 3.6)
    save(fig, path)


def diamond(path):
    fig, ax = plt.subplots(figsize=(7, 4.6)); _bare(ax)
    top, left, right, bot = (0, 2.2), (-2.2, 0), (2.2, 0), (0, -2.2)
    _edge(ax, top, left, r"$\dfrac{\partial z}{\partial x}=f_x$", BLUE, off=(-0.75, 0.3))
    _edge(ax, top, right, r"$\dfrac{\partial z}{\partial y}=f_y$", VERM, off=(0.75, 0.3))
    _edge(ax, left, bot, r"$\dfrac{dx}{dx}=1$", BLUE, off=(-0.65, -0.3))
    _edge(ax, right, bot, r"$\dfrac{dy}{dx}=h'(x)$", VERM, off=(0.85, -0.3))
    _node(ax, *top, r"$z=f(x,y)$"); _node(ax, *left, r"$x$", BLUE); _node(ax, *right, r"$y=h(x)$", VERM); _node(ax, *bot, r"$x$")
    ax.text(0, -3.15, r"$\dfrac{dz}{dx}=f_x\cdot1+f_y\,\dfrac{dy}{dx}=0\ \ \Longrightarrow\ \ \dfrac{dy}{dx}=-\dfrac{f_x}{f_y}$", ha="center", fontsize=15)
    ax.set_xlim(-4.2, 4.2); ax.set_ylim(-3.7, 2.8)
    save(fig, path)


def implicit_curve(path):
    fig, ax = axes2d(7, 5.2)
    u = np.linspace(-3, 3, 600); X, Y = np.meshgrid(u, u)
    F = X * np.exp(Y) + Y * np.exp(X)
    ax.contour(X, Y, F, levels=[0], colors=[BLUE], linewidths=CURVE)
    ax.plot(u, -u, color=VERM, lw=2.2, ls=DASH)
    ax.plot([0], [0], "o", color=INK, ms=6, zorder=5)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0); ax.axvline(0, color=GUIDE, lw=1, zorder=0)
    ax.text(-2.9, 2.55, r"$x e^{y}+y e^{x}=0$", color=BLUE, fontsize=14)
    ax.text(-2.9, -2.3, r"tangent $x+y=0$" + "\n" + r"slope $-f_x/f_y=-1$", color=VERM, fontsize=13)
    ax.set_xlim(-3, 3); ax.set_ylim(-3, 3); ax.set_aspect("equal")
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def level_curves(path):
    fig, ax = axes2d(6.4, 6.0)
    t = np.linspace(0, 2 * np.pi, 300)
    for c, col in ((1, GUIDE), (2, GUIDE), (5, BLUE), (9, GUIDE)):
        ax.plot(np.sqrt(c) * np.cos(t), np.sqrt(c) * np.sin(t), color=col if c == 5 else MUTED, lw=CURVE if c == 5 else 1.2)
        lx, ly = {1: (0, -0.8), 2: (-0.95, 1.1), 5: (-0.7, 2.35), 9: (-2.45, -2.6)}[c]
        ax.text(lx, ly, f"$c={c}$", color=BLUE if c == 5 else MUTED, fontsize=12, ha="center")
    xt = np.linspace(0.9, 3.1, 2)
    ax.plot(xt, 1 - 2 * (xt - 2), color=VERM, lw=2.2, ls=DASH)
    ax.plot([2], [1], "o", color=INK, ms=6, zorder=5)
    ax.text(1.85, 0.72, r"$(2,1)$", fontsize=13, ha="right")
    ax.text(-3.45, 2.95, r"slope $-f_x/f_y=-2$", color=VERM, fontsize=13)
    ax.text(-3.45, 3.35, r"level curves $x^2+y^2=c$", color=INK, fontsize=13)
    ax.set_xlim(-3.5, 3.6); ax.set_ylim(-3.3, 3.8); ax.set_aspect("equal")
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def spheres(path):
    fig, ax = axes3d(7, 5.4, elev=20, azim=-55, lim=((-3.2, 3.4), (-3.2, 3.4), (0, 3.4)))
    th, ph = np.meshgrid(np.linspace(0, 2 * np.pi, 49), np.linspace(0, np.pi / 2, 13))
    for R, tint, a in ((3.0, "blue", 0.18), (2.0, "green", 0.32), (1.0, "verm", 0.55)):
        surface(ax, R * np.cos(th) * np.sin(ph), R * np.sin(th) * np.sin(ph), R * np.cos(ph), tint=tint, alpha=a, zorder=2 + (3 - R))
    ax.text2D(0.03, 0.88, r"$x^2+y^2+z^2=c$: one shell per value of $c$", fontsize=13, transform=ax.transAxes)
    for R, col, y in ((1.0, VERM, 0.20), (2.0, GREEN, 0.13), (3.0, BLUE, 0.06)):
        ax.text2D(0.66, y, f"$c={int(R * R)}$" + ("  (unit sphere)" if R == 1 else ""), color=col, fontsize=13, transform=ax.transAxes)
    save(fig, path)


def polar(path):
    fig, ax = axes2d(6.6, 5.2)
    r, th = 2.4, np.radians(35)
    P = (r * np.cos(th), r * np.sin(th))
    ax.plot([0, P[0]], [0, P[1]], color=BLUE, lw=CURVE)
    ax.plot([P[0], P[0]], [0, P[1]], color=MUTED, lw=1.2, ls=REF); ax.plot([0, P[0]], [P[1], P[1]], color=MUTED, lw=1.2, ls=REF)
    a = np.linspace(0, th, 40); ax.plot(0.7 * np.cos(a), 0.7 * np.sin(a), color=PURPLE, lw=1.8)
    a2 = np.linspace(th - 0.35, th + 0.55, 60); ax.plot(r * np.cos(a2), r * np.sin(a2), color=VERM, lw=2.0, ls=DASH)
    t = np.array([-np.sin(th), np.cos(th)]) * 0.9
    ax.annotate("", xy=(P[0] + t[0], P[1] + t[1]), xytext=P, arrowprops=dict(arrowstyle="-|>", color=VERM, lw=2.0))
    ax.plot(*P, "o", color=INK, ms=6, zorder=5)
    ax.text(P[0] + 0.3, P[1] + 0.05, r"$(x,y)=(r\cos\theta,\ r\sin\theta)$", fontsize=13, va="bottom")
    ax.text(P[0] / 2 - 0.15, P[1] / 2 + 0.15, r"$r$", color=BLUE, fontsize=15)
    ax.text(0.78, 0.18, r"$\theta$", color=PURPLE, fontsize=15)
    ax.text(0.15, 3.25, r"turning by $d\theta$: $(x_\theta,\,y_\theta)=(-r\sin\theta,\ r\cos\theta)$", color=VERM, fontsize=13, ha="left")
    ax.text(P[0], -0.32, r"$x$", ha="center", fontsize=13); ax.text(-0.12, P[1], r"$y$", va="center", ha="right", fontsize=13)
    ax.set_xlim(-0.5, 4.6); ax.set_ylim(-0.5, 3.5); ax.set_aspect("equal"); ax.set_xticks([]); ax.set_yticks([])
    ax.spines["left"].set_position(("data", 0)); ax.spines["bottom"].set_position(("data", 0))
    save(fig, path)


FIGURES = {"G1.1": spheres, "G1.2": level_curves, "G2.1": diamond, "G2.2": implicit_curve, "G4.1": tree_chain, "G5.1": polar}
