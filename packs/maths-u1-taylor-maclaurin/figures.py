"""Figures for class 007 (Graph_Style_Guide_v2 via engine/figstyle.py)."""
import math
import numpy as np
from figstyle import BLUE, VERM, GREEN, PURPLE, INK, MUTED, GUIDE, CURVE, DASH, REF, save, axes2d, axes3d, surface, plane


def _sin_poly(x, terms):
    return sum((-1) ** j * x ** (2 * j + 1) / math.factorial(2 * j + 1) for j in range(terms))


def sine_polys(path):
    fig, ax = axes2d(7.4, 4.6)
    x = np.linspace(-2 * np.pi, 2 * np.pi, 600)
    ax.plot(x, np.sin(x), color=BLUE, lw=CURVE + 0.6)
    for n, col in ((2, VERM), (4, GREEN), (6, PURPLE)):
        ax.plot(x, _sin_poly(x, n), color=col, lw=1.9, ls=DASH)
    ax.axhline(0, color=GUIDE, lw=1, zorder=0); ax.axvline(0, color=GUIDE, lw=1, zorder=0)
    ax.set_xlim(-2 * np.pi, 2 * np.pi); ax.set_ylim(-2.2, 2.2)
    ax.set_xticks([-2 * np.pi, -np.pi, 0, np.pi, 2 * np.pi]); ax.set_xticklabels(["-2π", "-π", "0", "π", "2π"])
    ax.set_yticks([-2, -1, 0, 1, 2])
    ax.text(-2.3, -1.55, r"$\sin x$", color=BLUE, fontsize=13)
    ax.text(2.55, 1.9, r"2 terms: $x-\frac{x^3}{3!}$", color=VERM, fontsize=12)
    ax.text(4.35, -1.75, "4 terms", color=GREEN, fontsize=12)
    ax.text(5.2, 0.35, "6 terms", color=PURPLE, fontsize=12)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right")
    save(fig, path)


def tangent_line(path):
    fig, ax = axes2d(7.0, 4.6)
    a = 1.0
    x = np.linspace(-0.6, 2.6, 400)
    ax.plot(x, np.exp(x), color=BLUE, lw=CURVE)
    e = np.e
    ax.plot(x, e + e * (x - a), color=VERM, lw=2.0, ls=DASH)
    ax.plot(x, e + e * (x - a) + e * (x - a) ** 2 / 2, color=GREEN, lw=2.0, ls=DASH)
    ax.plot([a], [e], "o", color=INK, ms=6, zorder=5)
    ax.axvline(a, color=MUTED, lw=1.1, ls=REF)
    ax.text(a + 0.05, 0.25, r"$x=a$", color=MUTED, fontsize=12)
    ax.text(1.5, 11, r"$f(x)=e^x$", color=BLUE, fontsize=13, ha="right")
    ax.text(1.6, 2.2, r"$f(a)+(x-a)f'(a)$", color=VERM, fontsize=12)
    ax.text(-0.55, 3.6, "+ second-degree term", color=GREEN, fontsize=12)
    ax.set_xlim(-0.6, 2.6); ax.set_ylim(0, 13)
    ax.set_xlabel(r"$x$", fontsize=14, loc="right"); ax.set_ylabel(r"$y$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


def surface_plane(path):
    fig, ax = axes3d(8.4, 5.6, elev=24, azim=-62, lim=((-1.9, 2.3), (-1.2, 1.3), (0, 6.2)), labels=("x", "y", "z"))
    u = np.linspace(0.2, 2.0, 26); v = np.linspace(-1.0, 1.0, 26)
    X, Y = np.meshgrid(u, v)
    surface(ax, X, Y, X * np.exp(Y) + 1, tint="blue", alpha=0.85)
    plane(ax, X, Y, 1 + X + Y, alpha=0.30)
    ax.plot([1], [0], [2], "o", color=VERM, ms=7, zorder=10)
    ax.text2D(0.0, 0.92, r"blue: $f(x,y)=xe^y+1$", transform=ax.transAxes, color=BLUE, fontsize=13)
    ax.text2D(0.0, 0.85, r"grey: $L(x,y)=1+x+y$", transform=ax.transAxes, color=MUTED, fontsize=13)
    ax.text2D(0.0, 0.79, "(first degree)", transform=ax.transAxes, color=MUTED, fontsize=13)
    ax.text2D(0.0, 0.71, r"point $(1,0,2)$", transform=ax.transAxes, color=VERM, fontsize=13)
    save(fig, path)


def slice_compare(path):
    fig, ax = axes2d(7.0, 4.4)
    y = np.linspace(-1.5, 1.5, 400)
    ax.plot(y, 1 + np.exp(y), color=BLUE, lw=CURVE)
    ax.plot(y, 2 + y, color=VERM, lw=2.0, ls=DASH)
    ax.plot(y, 2 + y + y ** 2 / 2, color=GREEN, lw=2.0, ls=DASH)
    ax.plot([0], [2], "o", color=INK, ms=6, zorder=5)
    ax.text(0.15, 4.6, r"$f(1,y)=1+e^y$", color=BLUE, fontsize=13, ha="right")
    ax.text(0.75, 2.2, r"first degree: $2+y$", color=VERM, fontsize=12)
    ax.text(-1.45, 2.05, r"second degree: $2+y+\frac{y^2}{2}$", color=GREEN, fontsize=12)
    ax.set_xlim(-1.5, 1.5); ax.set_ylim(0, 5.6)
    ax.set_xlabel(r"$y$ (with $x=1$)", fontsize=13, loc="right"); ax.set_ylabel(r"$z$", fontsize=14, loc="top", rotation=0)
    save(fig, path)


FIGURES = {"G1.1": sine_polys, "G2.1": tangent_line, "G3.1": surface_plane, "G3.2": slice_compare}
