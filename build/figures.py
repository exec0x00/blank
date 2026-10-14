"""Figures G1–G10 for the Geometrical Interpretation of Partial Derivatives pack.

Style follows Graph_Style_Guide_v2: Okabe–Ito colours in fixed order, Computer
Modern Serif labels, data curves solid 2.4–2.6 px, models/tangents dashed,
references grey dashed, direct labels in each series' own colour.

usage: python3 -I build/figures.py OUTDIR
"""
import os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyArrowPatch
from mpl_toolkits.mplot3d import proj3d

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "..", "output", "assets", "fonts")
for f in ("cmunrm.ttf", "cmunti.ttf", "cmunbx.ttf", "cmunbi.ttf"):
    font_manager.fontManager.addfont(os.path.join(FONTS, f))

BLUE, VERM, GREEN, PURPLE, ORANGE = "#0072B2", "#D55E00", "#009E73", "#A0557F", "#E69F00"
INK, MUTED, GUIDE, TINT = "#1a1a1a", "#5f6368", "#d5d8dd", "#E4F0F8"

plt.rcParams.update({
    "font.family": "CMU Serif", "mathtext.fontset": "cm",
    "font.size": 12, "axes.edgecolor": INK, "axes.labelcolor": INK,
    "xtick.color": INK, "ytick.color": INK, "xtick.direction": "out", "ytick.direction": "out",
    "axes.spines.top": False, "axes.spines.right": False, "axes.linewidth": 1.0,
    "svg.fonttype": "path", "axes.unicode_minus": False, "axes.formatter.use_mathtext": True, "savefig.bbox": "tight", "savefig.pad_inches": 0.08,
})
CURVE = 2.5
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)


def save(fig, name):
    fig.savefig(os.path.join(OUT, f"{name}.svg"), format="svg", transparent=False, facecolor="white")
    plt.close(fig)


class Arrow3D(FancyArrowPatch):
    def __init__(self, xs, ys, zs, *a, **k):
        super().__init__((0, 0), (0, 0), *a, **k)
        self._v = xs, ys, zs

    def do_3d_projection(self, renderer=None):
        xs, ys, zs = proj3d.proj_transform(*self._v, self.axes.M)
        self.set_positions((xs[0], ys[0]), (xs[1], ys[1]))
        return np.min(zs)


def axes3d(w=7.0, h=5.6, elev=22, azim=-58, lim=((-2.2, 2.4), (-2.2, 2.4), (0, 4.6)), labels=True):
    fig = plt.figure(figsize=(w, h))
    ax = fig.add_subplot(111, projection="3d", computed_zorder=False)
    ax.set_proj_type("ortho")
    ax.view_init(elev=elev, azim=azim)
    ax.set_axis_off()
    (x0, x1), (y0, y1), (z0, z1) = lim
    ax.set_xlim(x0, x1); ax.set_ylim(y0, y1); ax.set_zlim(z0, z1)
    ax.set_box_aspect((x1 - x0, y1 - y0, (z1 - z0) * 0.85))
    if labels:
        for v, lab in (((x1, 0, 0), "x"), ((0, y1, 0), "y"), ((0, 0, z1), "z")):
            ax.add_artist(Arrow3D([0, v[0]], [0, v[1]], [0, v[2]], arrowstyle="-|>", mutation_scale=12,
                                  lw=1.2, color=INK, zorder=1))
            ax.text(v[0] * 1.06, v[1] * 1.06, v[2] * 1.04 + (0.05 if lab == "z" else 0), lab,
                    fontsize=14, style="italic", color=INK, zorder=20)
    fig.subplots_adjust(0, 0, 1, 1)
    return fig, ax


def dome(ax, R=2.0, alpha=0.92, zorder=2):
    r = np.linspace(0, R, 22); t = np.linspace(0, 2 * np.pi, 49)
    r, t = np.meshgrid(r, t)
    X, Y = r * np.cos(t), r * np.sin(t)
    ax.plot_surface(X, Y, 4 - X**2 - Y**2, color=TINT, edgecolor="#9cc3de", linewidth=0.35,
                    shade=False, alpha=alpha, rstride=1, cstride=1, zorder=zorder)


def axes2d(w=7.0, h=4.2):
    fig, ax = plt.subplots(figsize=(w, h))
    return fig, ax


# ---------------------------------------------------------------- G1
def g1():
    f = lambda x: 0.2 * x**3 - 0.6 * x + 1.5
    x0 = 1.5; m = 0.6 * x0**2 - 0.6; y0 = f(x0)
    fig, ax = axes2d(7, 4.4)
    x = np.linspace(-2.4, 2.6, 300)
    ax.plot(x, f(x), color=BLUE, lw=CURVE)
    xt = np.linspace(-0.6, 3.0, 2)
    ax.plot(xt, y0 + m * (xt - x0), color=VERM, lw=2.4, ls=(0, (8, 5)))
    ax.plot([x0, x0], [0, y0], color=MUTED, lw=1.2, ls=(0, (6, 4)))
    ax.plot([x0], [y0], "o", color=INK, ms=6, zorder=5)
    # rise / run triangle
    ax.plot([x0, x0 + 1], [y0, y0], color=INK, lw=1.0)
    ax.plot([x0 + 1, x0 + 1], [y0, y0 + m], color=INK, lw=1.0)
    ax.text(x0 + 0.5, y0 - 0.22, "1", ha="center", fontsize=12)
    ax.text(x0 + 1.07, y0 + m / 2, r"$f\,'(x_0)$", va="center", fontsize=13)
    ax.text(-1.75, 2.45, r"$y=f(x)$", color=BLUE, fontsize=14)
    ax.text(3.05, y0 + m * (3.0 - x0) - 0.15, "tangent at $x_0$\nslope $= dy/dx = f\,'(x_0)$",
            color=VERM, fontsize=13, ha="left", va="top")
    ax.text(x0, -0.28, r"$x_0$", ha="center", fontsize=13)
    ax.set_xlim(-2.5, 5.2); ax.set_ylim(0, 4.2)
    ax.set_xticks([]); ax.set_yticks([])
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, "G1")


# ---------------------------------------------------------------- G2, G3
def curve_over(path_xy, name, base_label, zf):
    fig, ax = axes3d(7, 5.2, elev=20, azim=-60, lim=((-2.2, 2.4), (-2.2, 2.4), (0, 4.4)))
    px, py = path_xy
    pz = zf(px, py)
    ax.plot(px, py, 0 * px, color=BLUE, lw=CURVE, zorder=4)
    for i in range(0, len(px), 6):
        ax.plot([px[i], px[i]], [py[i], py[i]], [0, pz[i]], color=GUIDE, lw=1.0, zorder=3)
    ax.plot(px, py, pz, color=VERM, lw=CURVE, zorder=6)
    ax.text2D(0.62, 0.06, base_label, color=BLUE, fontsize=13, transform=ax.transAxes)
    ax.text2D(0.03, 0.86, r"curve on the surface $z=f(x,y)$" + "\nabove the same points", color=VERM,
              fontsize=13, transform=ax.transAxes)
    save(fig, name)


def g2_g3():
    zf = lambda x, y: 2.2 + 0.8 * x * y + 0.5 * x
    t = np.linspace(0, 2 * np.pi, 241)
    curve_over((1.5 * np.cos(t), 1.5 * np.sin(t)), "G2", "circle in the $xy$-plane", zf)
    x = np.linspace(-1.6, 1.6, 241)
    curve_over((x, x**2 - 1.2), "G3", "parabola in the $xy$-plane", zf)


# ---------------------------------------------------------------- G4 many tangents
P = (1.0, -0.5, 2.75)
FX, FY = -2.0, 1.0


def g4():
    fig, ax = axes3d(7, 5.8)
    dome(ax)
    cols = [BLUE, VERM, GREEN, PURPLE, ORANGE, MUTED]
    for k, th in enumerate(np.linspace(0, np.pi, 6, endpoint=False)):
        a, b = np.cos(th), np.sin(th)
        s = np.array([-0.75, 0.75])
        ax.plot(P[0] + a * s, P[1] + b * s, P[2] + (FX * a + FY * b) * s, color=cols[k], lw=2.0,
                ls=(0, (8, 5)) if k else "-", zorder=8)
    ax.scatter(*P, color=INK, s=30, zorder=10)
    ax.text2D(0.62, 0.86, r"$P\,(x_0,y_0,f(x_0,y_0))$" + "\nevery dashed line is a tangent at $P$", fontsize=13, transform=ax.transAxes)
    ax.text(-1.6, -2.0, 0.6, r"$z=f(x,y)$", color=BLUE, fontsize=14, zorder=20)
    save(fig, "G4")


# ---------------------------------------------------------------- G5, G6 traces
def trace(name, axis):
    fig, ax = axes3d(7, 5.8)
    dome(ax, alpha=0.75)
    if axis == "x":
        yy = P[1]; xs = np.linspace(-np.sqrt(4 - yy**2), np.sqrt(4 - yy**2), 120)
        X, Z = np.meshgrid(np.linspace(-2.2, 2.4, 2), np.linspace(0, 4.4, 2))
        ax.plot_surface(X, 0 * X + yy, Z, color="#9a9a9a", alpha=0.22, shade=False, zorder=3)
        ax.plot(xs, 0 * xs + yy, 4 - xs**2 - yy**2, color=BLUE, lw=CURVE, zorder=6)
        s = np.array([-0.85, 0.85])
        ax.plot(P[0] + s, P[1] + 0 * s, P[2] + FX * s, color=VERM, lw=2.4, ls=(0, (8, 5)), zorder=8)
        ax.text(-2.0, yy, 4.5, r"plane $y=y_0$", color=MUTED, fontsize=13, zorder=20)
        ax.text2D(0.0, 0.16, r"trace $z=f(x,y_0)$", color=BLUE, fontsize=13, transform=ax.transAxes)
        ax.text(P[0] + 0.85, P[1], P[2] + FX * 0.85 - 0.25, "slope " + r"$=\partial z/\partial x$",
                color=VERM, fontsize=13, zorder=20)
    else:
        xx = P[0]; ys = np.linspace(-np.sqrt(4 - xx**2), np.sqrt(4 - xx**2), 120)
        Y, Z = np.meshgrid(np.linspace(-2.2, 2.4, 2), np.linspace(0, 4.4, 2))
        ax.plot_surface(0 * Y + xx, Y, Z, color="#9a9a9a", alpha=0.22, shade=False, zorder=3)
        ax.plot(0 * ys + xx, ys, 4 - xx**2 - ys**2, color=GREEN, lw=CURVE, zorder=6)
        s = np.array([-0.85, 0.85])
        ax.plot(P[0] + 0 * s, P[1] + s, P[2] + FY * s, color=PURPLE, lw=2.4, ls=(0, (8, 5)), zorder=8)
        ax.text(xx, 1.6, 4.45, r"plane $x=x_0$", color=MUTED, fontsize=13, zorder=20)
        ax.text2D(0.0, 0.16, r"trace $z=f(x_0,y)$", color=GREEN, fontsize=13, transform=ax.transAxes)
        ax.text(P[0], P[1] + 0.9, P[2] + FY * 0.85 + 0.1, "slope " + r"$=\partial z/\partial y$",
                color=PURPLE, fontsize=13, zorder=20)
    ax.scatter(*P, color=INK, s=30, zorder=10)
    save(fig, name)


# ---------------------------------------------------------------- G7 cross-sections (2 panels stacked)
def g7():
    fig, axs = plt.subplots(2, 1, figsize=(7, 7.6))
    for ax, (var, c, tc, x0, m, f, lab, plane) in zip(axs, [
        ("x", BLUE, VERM, 1.0, FX, lambda u: 3.75 - u**2, r"$z=f(x,\,y_0)=3.75-x^2$", r"(a) in the plane $y=y_0=-0.5$"),
        ("y", GREEN, PURPLE, -0.5, FY, lambda u: 3.0 - u**2, r"$z=f(x_0,\,y)=3-y^2$", r"(b) in the plane $x=x_0=1$"),
    ]):
        u = np.linspace(-2, 2, 200)
        ax.plot(u, f(u), color=c, lw=CURVE)
        ut = np.linspace(x0 - 1.1, x0 + 1.1, 2)
        ax.plot(ut, f(x0) + m * (ut - x0), color=tc, lw=2.4, ls=(0, (8, 5)))
        ax.plot([x0], [f(x0)], "o", color=INK, ms=6, zorder=5)
        ax.plot([x0, x0], [-1, f(x0)], color=MUTED, lw=1.2, ls=(0, (6, 4)))
        ax.text(-2.0, 4.25, lab, color=c, fontsize=13)
        d = "x" if var == "x" else "y"
        ax.text(x0 + 0.95, f(x0) + m * 0.95 + 0.1,
                rf"slope $=\partial z/\partial {d}={int(m)}$", color=tc, fontsize=13, va="bottom")
        ax.set_title(plane, loc="left", fontsize=13, color=INK)
        ax.set_xlim(-2.1, 3.3); ax.set_ylim(-1, 4.8)
        ax.set_xticks([-2, -1, 0, 1, 2]); ax.set_yticks([0, 1, 2, 3, 4])
        ax.set_xlabel(rf"${d}$", fontsize=14, loc="right"); ax.set_ylabel(r"$z$", fontsize=14, loc="top", rotation=0)
    fig.tight_layout(h_pad=2.2)
    save(fig, "G7")


# ---------------------------------------------------------------- G8 gradient components
def g8():
    fig, ax = axes2d(7, 4.8)
    o = np.array([0.0, 0.0])
    def arr(v, c, lw=2.5, ls="-"):
        ax.add_patch(FancyArrowPatch(o, o + v, arrowstyle="-|>", mutation_scale=18, lw=lw, color=c, ls=ls,
                                     shrinkA=0, shrinkB=0))
    gx, gy = FX, FY
    arr(np.array([gx, 0]), BLUE)
    arr(np.array([0, gy]), GREEN)
    ax.plot([gx, gx], [0, gy], color=GUIDE, lw=1.2); ax.plot([0, gx], [gy, gy], color=GUIDE, lw=1.2)
    arr(np.array([gx, gy]), VERM)
    u = np.array([1, -1]) / np.sqrt(2)
    arr(1.3 * u, PURPLE, lw=2.2)
    ax.text(gx / 2, 0.15, r"$f_x\,\mathbf{i}=-2\,\mathbf{i}$", color=BLUE, ha="center", fontsize=13)
    ax.text(0.12, gy / 2, r"$f_y\,\mathbf{j}=+\mathbf{j}$", color=GREEN, va="center", fontsize=13)
    ax.text(gx - 0.1, gy + 0.12, r"$\nabla f=f_x\,\mathbf{i}+f_y\,\mathbf{j}=(-2,\,1)$", color=VERM,
            ha="left", va="bottom", fontsize=13)
    ax.text(1.3 * u[0] + 0.08, 1.3 * u[1], r"a direction $\hat{u}$", color=PURPLE, fontsize=13, va="center")
    ax.plot([0], [0], "o", color=INK, ms=6, zorder=5)
    ax.text(-0.1, -0.15, r"$(x_0,y_0)=(1,\,-0.5)$", fontsize=12, va="top", ha="right")
    ax.axhline(0, color=GUIDE, lw=1, zorder=0); ax.axvline(0, color=GUIDE, lw=1, zorder=0)
    ax.set_xlim(-2.8, 2.2); ax.set_ylim(-1.4, 1.75); ax.set_aspect("equal")
    for s in ax.spines.values(): s.set_visible(False)
    ax.set_xticks([]); ax.set_yticks([])
    ax.text(2.15, 0.06, r"$x$", fontsize=14, ha="right", style="italic")
    ax.text(0.06, 1.7, r"$y$", fontsize=14, va="top", style="italic")
    save(fig, "G8")


# ---------------------------------------------------------------- G9 concavity: saddle
def g9():
    fig, ax = axes3d(7, 5.8, elev=24, azim=-52, lim=((-1.6, 1.8), (-1.6, 1.8), (-2.4, 2.6)))
    u = np.linspace(-1.4, 1.4, 29); X, Y = np.meshgrid(u, u)
    ax.plot_surface(X, Y, X**2 - Y**2, color=TINT, edgecolor="#9cc3de", linewidth=0.35, shade=False,
                    alpha=0.85, zorder=2)
    ax.plot(u, 0 * u, u**2, color=BLUE, lw=CURVE, zorder=6)
    ax.plot(0 * u, u, -u**2, color=VERM, lw=CURVE, zorder=6)
    ax.scatter(0, 0, 0, color=INK, s=28, zorder=10)
    ax.text(1.45, 0, 2.15, r"$y=0$: $z=x^2$, $f_{xx}=2>0$" + "\nconcave up in $x$", color=BLUE, fontsize=13, zorder=20)
    ax.text(0, 1.2, -2.5, r"$x=0$: $z=-y^2$, $f_{yy}=-2<0$" + "\nconcave down in $y$", color=VERM, fontsize=13, zorder=20)
    ax.text(-1.5, -1.4, 2.6, r"$z=x^2-y^2$", color=INK, fontsize=14, zorder=20)
    save(fig, "G9")


# ---------------------------------------------------------------- G10 mixed partial
def g10():
    fig, ax = axes2d(7, 4.8)
    x = np.linspace(0, 1.75, 200); x0 = 1.0
    for yv, c in ((0.5, BLUE), (1.0, VERM), (1.5, GREEN)):
        ax.plot(x, x**2 * yv, color=c, lw=CURVE)
        m = 2 * x0 * yv
        xt = np.linspace(0.55, 1.45, 2)
        ax.plot(xt, yv + m * (xt - x0), color=c, lw=1.8, ls=(0, (8, 5)))
        ax.plot([x0], [yv], "o", color=INK, ms=5, zorder=5)
        ax.text(1.78, 1.75**2 * yv, rf"$y={yv:g}$: slope $f_x={m:g}$", color=c, fontsize=13, va="center")
    ax.axvline(x0, color=MUTED, lw=1.2, ls=(0, (6, 4)))
    ax.text(x0 + 0.03, 0.15, r"$x_0=1$", color=MUTED, fontsize=12)
    ax.set_xlim(0, 2.9); ax.set_ylim(0, 4.7)
    ax.set_xticks([0, 0.5, 1, 1.5]); ax.set_yticks([0, 1, 2, 3, 4])
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$z$", fontsize=14, loc="top", rotation=0)
    ax.set_title(r"$z=x^2y$, sliced at three values of $y$", loc="left", fontsize=13)
    save(fig, "G10")


if __name__ == "__main__":
    g1(); g2_g3(); g4(); trace("G5", "x"); trace("G6", "y"); g7(); g8(); g9(); g10()
    print("figures written to", OUT)
