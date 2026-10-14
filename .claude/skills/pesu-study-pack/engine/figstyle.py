"""Matplotlib house style for study-pack figures (Graph_Style_Guide_v2).

In a pack's figures module:
    from figstyle import *            # palette, axes2d, axes3d, Arrow3D, save, CURVE, TANGENT
    def G4_1(path): fig, ax = axes2d(); ...; save(fig, path)
    FIGURES = {"G4.1": G4_1}

Rules baked in (learned the hard way):
- Computer Modern (CMU Serif) labels; the font has no U+2212, so unicode_minus is off and tick
  labels use mathtext (gives a real minus).
- svg.fonttype = "path": figures never depend on installed fonts.
- mathtext has no \\Big, \\left|…\\right| sizing quirks; keep labels simple.
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyArrowPatch
from mpl_toolkits.mplot3d import proj3d

_FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
for _f in ("cmunrm.ttf", "cmunti.ttf", "cmunbx.ttf", "cmunbi.ttf"):
    font_manager.fontManager.addfont(os.path.join(_FONTS, _f))

# Okabe–Ito, in this order: series 1..4, highlight
BLUE, VERM, GREEN, PURPLE, ORANGE = "#0072B2", "#D55E00", "#009E73", "#A0557F", "#E69F00"
SERIES = [BLUE, VERM, GREEN, PURPLE, ORANGE]
INK, MUTED, GUIDE = "#1a1a1a", "#5f6368", "#d5d8dd"
TINT = {"blue": "#E4F0F8", "verm": "#FBE9DF", "green": "#E0F3EE", "purple": "#F3E7EE", "orange": "#FCF1D9"}
CURVE = 2.5                       # data curve width
DASH = (0, (8, 5))                # model / approximation / tangent
REF = (0, (6, 4))                 # grey reference line (limits, 1 atm, x = x0)

plt.rcParams.update({
    "font.family": "CMU Serif", "mathtext.fontset": "cm", "font.size": 12,
    "axes.edgecolor": INK, "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK,
    "xtick.direction": "out", "ytick.direction": "out",
    "axes.spines.top": False, "axes.spines.right": False, "axes.linewidth": 1.0,
    "axes.unicode_minus": False, "axes.formatter.use_mathtext": True,
    "svg.fonttype": "path", "savefig.bbox": "tight", "savefig.pad_inches": 0.08,
})


def save(fig, path):
    fig.savefig(path, format="svg", facecolor="white")
    plt.close(fig)


def axes2d(w=7.0, h=4.4):
    """Left and bottom axes only, ticks outward. Label axes with ax.set_xlabel(..., loc="right")."""
    return plt.subplots(figsize=(w, h))


class Arrow3D(FancyArrowPatch):
    def __init__(self, xs, ys, zs, *a, **k):
        super().__init__((0, 0), (0, 0), *a, **k)
        self._v = xs, ys, zs

    def do_3d_projection(self, renderer=None):
        xs, ys, zs = proj3d.proj_transform(*self._v, self.axes.M)
        self.set_positions((xs[0], ys[0]), (xs[1], ys[1]))
        return np.min(zs)


def axes3d(w=7.0, h=5.6, elev=22, azim=-58, lim=((-2.2, 2.4), (-2.2, 2.4), (0, 4.6)), labels=("x", "y", "z")):
    """Orthographic 3-D axes with the box hidden and hand-drawn x, y, z arrows from the origin.
    Draw surfaces first, then lines with a higher zorder (computed_zorder is off, so zorder wins).
    Put long labels with ax.text2D(x, y, s, transform=ax.transAxes) so they never collide with the plot.
    Check the base point faces the viewer: a point on the silhouette makes all tangents look bunched."""
    fig = plt.figure(figsize=(w, h))
    ax = fig.add_subplot(111, projection="3d", computed_zorder=False)
    ax.set_proj_type("ortho")
    ax.view_init(elev=elev, azim=azim)
    ax.set_axis_off()
    (x0, x1), (y0, y1), (z0, z1) = lim
    ax.set_xlim(x0, x1); ax.set_ylim(y0, y1); ax.set_zlim(z0, z1)
    ax.set_box_aspect((x1 - x0, y1 - y0, (z1 - z0) * 0.85))
    if labels:
        for v, lab in (((x1, 0, 0), labels[0]), ((0, y1, 0), labels[1]), ((0, 0, z1), labels[2])):
            ax.add_artist(Arrow3D([0, v[0]], [0, v[1]], [0, v[2]], arrowstyle="-|>", mutation_scale=12, lw=1.2, color=INK, zorder=1))
            ax.text(v[0] * 1.06, v[1] * 1.06, v[2] * 1.04, lab, fontsize=14, style="italic", color=INK, zorder=20)
    fig.subplots_adjust(0, 0, 1, 1)
    return fig, ax


def surface(ax, X, Y, Z, tint="blue", alpha=0.9, zorder=2):
    """Tinted mesh surface in the series-colour tint with thin edge lines."""
    edge = {"blue": "#9cc3de", "verm": "#eab49a", "green": "#9fd8c6", "purple": "#d8b6c9", "orange": "#f0cf8a"}[tint]
    ax.plot_surface(X, Y, Z, color=TINT[tint], edgecolor=edge, linewidth=0.35, shade=False, alpha=alpha, zorder=zorder)


def plane(ax, X, Y, Z, alpha=0.22, zorder=3):
    ax.plot_surface(X, Y, Z, color="#9a9a9a", alpha=alpha, shade=False, zorder=zorder)
