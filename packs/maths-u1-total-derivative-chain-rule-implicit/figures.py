"""Figures for classes 003–004 (Graph_Style_Guide_v2 via engine/figstyle.py)."""
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


# ------------------------------------------------------------------ G2.1 tree, total derivative
def tree_total(path):
    fig, ax = plt.subplots(figsize=(7, 3.8)); _bare(ax)
    z, x, y, t1, t2 = (0, 0), (3, 1.3), (3, -1.3), (6, 1.3), (6, -1.3)
    _edge(ax, z, x, r"$\dfrac{\partial z}{\partial x}$", BLUE, off=(-0.25, 0.3))
    _edge(ax, z, y, r"$\dfrac{\partial z}{\partial y}$", VERM, off=(-0.25, -0.3))
    _edge(ax, x, t1, r"$\dfrac{dx}{dt}$", BLUE, off=(0, 0.45))
    _edge(ax, y, t2, r"$\dfrac{dy}{dt}$", VERM, off=(0, -0.45))
    _node(ax, *z, r"$z=f(x,y)$"); _node(ax, *x, r"$x=x(t)$", BLUE); _node(ax, *y, r"$y=y(t)$", VERM)
    _node(ax, *t1, r"$t$", BLUE); _node(ax, *t2, r"$t$", VERM)
    ax.text(7.0, 1.3, r"$\dfrac{\partial z}{\partial x}\dfrac{dx}{dt}$", color=BLUE, fontsize=15, va="center")
    ax.text(7.0, -1.3, r"$\dfrac{\partial z}{\partial y}\dfrac{dy}{dt}$", color=VERM, fontsize=15, va="center")
    ax.text(7.35, 0, r"$+$", fontsize=18, va="center", ha="center")
    ax.set_xlim(-1.2, 8.6); ax.set_ylim(-2.2, 2.2)
    save(fig, path)


# ------------------------------------------------------------------ G2.2 path on a surface
def path_surface(path):
    fig, ax = axes3d(7, 5.8, elev=24, azim=-60, lim=((-0.2, 2.4), (-0.2, 2.4), (0, 3.4)))
    u = np.linspace(0, 2.2, 23); X, Y = np.meshgrid(u, u)
    f = lambda x, y: 1.2 + 0.35 * x * y + 0.25 * np.sin(2 * x)
    surface(ax, X, Y, f(X, Y), alpha=0.75)
    t = np.linspace(0, 1, 120)
    px, py = 0.2 + 1.8 * t, 0.3 + 1.6 * t**2
    ax.plot(px, py, 0 * t, color=BLUE, lw=CURVE, zorder=6)
    ax.plot(px, py, f(px, py), color=VERM, lw=CURVE, zorder=7)
    for k in range(0, 120, 20):
        ax.plot([px[k]] * 2, [py[k]] * 2, [0, f(px[k], py[k])], color=GUIDE, lw=1.0, zorder=5)
    k = 70
    ax.scatter(px[k], py[k], f(px[k], py[k]), color=INK, s=28, zorder=10)
    ax.text2D(0.02, 0.06, r"path $(x(t),\,y(t))$" + "\n" + r"in the $xy$-plane", color=BLUE, fontsize=13, transform=ax.transAxes)
    ax.text2D(0.02, 0.88, r"height $z(t)=f(x(t),y(t))$" + "\n" + r"$dz/dt$ = how fast it rises", color=VERM, fontsize=13, transform=ax.transAxes)
    save(fig, path)


# ------------------------------------------------------------------ G3.1 differential vs true change
def differential(path):
    fig, ax = axes2d(7, 4.6)
    f = lambda x: 0.25 * x**2 + 1
    x0, dx = 1.5, 1.6
    xs = np.linspace(0, 3.6, 200)
    ax.plot(xs, f(xs), color=BLUE, lw=CURVE)
    m = 0.5 * x0
    xt = np.linspace(0.3, 3.6, 2)
    ax.plot(xt, f(x0) + m * (xt - x0), color=VERM, lw=2.2, ls=DASH)
    x1 = x0 + dx
    ax.plot([x0, x1], [f(x0)] * 2, color=INK, lw=1.0)
    ax.plot([x1, x1], [f(x0), f(x0) + m * dx], color=VERM, lw=2.4)
    ax.plot([x1 + 0.08] * 2, [f(x0), f(x1)], color=BLUE, lw=2.4)
    for xx in (x0, x1):
        ax.plot([xx, xx], [0, f(xx) if xx == x1 else f(x0)], color=MUTED, lw=1.0, ls=REF)
    ax.plot([x0], [f(x0)], "o", color=INK, ms=6, zorder=5)
    ax.text(x0 + dx / 2, f(x0) - 0.18, r"$dx$", ha="center", fontsize=14)
    ax.text(x1 - 0.1, f(x0) + 0.3, r"$dz=f'\,dx$", ha="right", color=VERM, fontsize=14, va="center")
    ax.text(x1 + 0.18, (f(x0) + f(x1)) / 2 + 0.25, r"$\Delta z$ (true)", color=BLUE, fontsize=14, va="center")
    ax.text(0.15, 3.85, r"$z=f(x)$ along one direction", color=BLUE, fontsize=13)
    ax.text(x0, -0.28, r"$x_0$", ha="center", fontsize=13); ax.text(x1, -0.28, r"$x_0+dx$", ha="center", fontsize=13)
    ax.set_xlim(0, 4.6); ax.set_ylim(0, 4.3); ax.set_xticks([]); ax.set_yticks([])
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$z$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


# ------------------------------------------------------------------ G4.1 saddle and cylinder
def saddle_cylinder(path):
    fig, ax = axes3d(7, 5.0, elev=22, azim=-50, lim=((-2.8, 3.0), (-2.8, 3.0), (-1.2, 1.4)))
    u = np.linspace(-2.6, 2.6, 27); X, Y = np.meshgrid(u, u)
    Z = X**2 / 16 - Y**2 / 9
    surface(ax, X, Y, Z, alpha=0.65)
    th = np.linspace(0, 2 * np.pi, 120); zz = np.linspace(-1.1, 1.1, 2)
    TH, ZZ = np.meshgrid(th, zz)
    plane(ax, np.sqrt(5) * np.cos(TH), np.sqrt(5) * np.sin(TH), ZZ, alpha=0.18)
    cx, cy = np.sqrt(5) * np.cos(th), np.sqrt(5) * np.sin(th)
    ax.plot(cx, cy, cx**2 / 16 - cy**2 / 9, color=VERM, lw=CURVE, zorder=8)
    ax.scatter(2, 1, 4 / 16 - 1 / 9, color=INK, s=34, zorder=10)
    ax.text(2.15, 1.0, 0.33, r"$P(2,1,\frac{5}{36})$", fontsize=13, zorder=20)
    ax.text2D(0.02, 0.9, r"saddle $z=\dfrac{x^2}{16}-\dfrac{y^2}{9}$", color=BLUE, fontsize=13, transform=ax.transAxes)
    ax.text2D(0.02, 0.8, r"cylinder $x^2+y^2=5$", color=MUTED, fontsize=13, transform=ax.transAxes)
    ax.text2D(0.5, 0.2, r"intersection curve: path of $P$", color=VERM, fontsize=13, transform=ax.transAxes)
    save(fig, path)


# ------------------------------------------------------------------ G4.2 triangle
def triangle(path):
    fig, ax = plt.subplots(figsize=(7, 3.6)); _bare(ax); ax.set_aspect("equal")
    th = np.pi / 6; X, Y = 6.0, 4.4
    A, B, C = np.array([0, 0]), np.array([X, 0]), Y * np.array([np.cos(th), np.sin(th)])
    ax.fill([A[0], B[0], C[0]], [A[1], B[1], C[1]], color="#E4F0F8", zorder=0)
    ax.plot([A[0], B[0], C[0], A[0]], [A[1], B[1], C[1], A[1]], color=INK, lw=1.6)
    ax.plot([C[0], C[0]], [0, C[1]], color=MUTED, lw=1.3, ls=REF)
    a = np.linspace(0, th, 30); ax.plot(0.9 * np.cos(a), 0.9 * np.sin(a), color=PURPLE, lw=1.8)
    ax.text(1.15, 0.27, r"$\theta$", color=PURPLE, fontsize=15)
    ax.text(X / 2, -0.38, r"$x$ (first side, $+3$ cm/s)", ha="center", color=BLUE, fontsize=13)
    ax.text(C[0] / 2 - 1.2, C[1] / 2 + 0.25, r"$y$ (second side, $-2$ cm/s)", ha="center", color=VERM, fontsize=13)
    ax.text(C[0] - 0.12, 0.55, r"height $=y\sin\theta$", color=MUTED, fontsize=13, va="center", ha="right")
    ax.text(4.6, 1.75, r"$A=\frac{1}{2}\,x\,y\sin\theta$", fontsize=15)
    ax.set_xlim(-2.6, 7.2); ax.set_ylim(-0.8, 2.6)
    save(fig, path)


# ------------------------------------------------------------------ G5.1 tree, chain rule
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


# ------------------------------------------------------------------ G6.1 branch (diamond) diagram
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


# ------------------------------------------------------------------ G6.2 implicit curve + tangent
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


# ------------------------------------------------------------------ G6.3 level curves of x^2+y^2
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


FIGURES = {"G2.1": tree_total, "G2.2": path_surface, "G3.1": differential, "G4.1": saddle_cylinder, "G4.2": triangle,
           "G5.1": tree_chain, "G6.1": diamond, "G6.2": implicit_curve, "G6.3": level_curves}
