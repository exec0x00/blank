"""Draw every figure of a pack.

usage: python3 -I <skill>/engine/figures_run.py <pack_dir> [ID ...]

Imports <pack_dir>/figures.py and <pack_dir>/figs/*.py; each defines FIGURES = {"G4.1": fn, ...}
where fn(path) writes one SVG. Output: <pack_dir>/output/assets/figures/<ID>.svg
"""
import glob, importlib.util, os, sys, traceback

ENGINE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ENGINE)
import figstyle  # noqa: E402,F401  (sets rcParams before any pack module draws)


def main(pack_dir, only):
    pack_dir = os.path.abspath(pack_dir)
    out = os.path.join(pack_dir, "output", "assets", "figures")
    os.makedirs(out, exist_ok=True)
    mods = [p for p in [os.path.join(pack_dir, "figures.py")] if os.path.exists(p)] + sorted(glob.glob(os.path.join(pack_dir, "figs", "*.py")))
    figs, bad = {}, []
    for i, p in enumerate(mods):
        spec = importlib.util.spec_from_file_location(f"packfigs{i}", p)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        for k, fn in getattr(m, "FIGURES", {}).items():
            if k in figs:
                sys.exit(f"figure {k} defined twice")
            figs[k] = fn
    for k, fn in figs.items():
        if only and k not in only:
            continue
        try:
            fn(os.path.join(out, k + ".svg"))
            print("drew", k)
        except Exception:
            bad.append(k)
            traceback.print_exc()
    if bad:
        sys.exit(f"failed: {bad}")


if __name__ == "__main__":
    main(sys.argv[1], set(sys.argv[2:]))
