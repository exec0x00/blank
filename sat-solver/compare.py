"""Head-to-head: polysat.py vs another solver's readout.solve (path given).

Usage: python3 compare.py PATH/TO/OTHER/sat-solver
"""

import importlib.util
import itertools
import random
import sys
import time

from polysat import solve as mine
from test_polysat import brute, php


def load_other(path):
    sys.path.insert(0, path)
    spec = importlib.util.spec_from_file_location("other_readout", f"{path}/readout.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.path.pop(0)
    return mod.solve


def tseitin(vertices, seed):
    rng = random.Random(seed)
    edges = {frozenset((i, (i + 1) % vertices)) for i in range(vertices)}
    while True:
        order = list(range(vertices))
        rng.shuffle(order)
        match = [frozenset(order[i:i + 2]) for i in range(0, vertices, 2)]
        if not any(e in edges for e in match):
            break
    edges = sorted(edges | set(match), key=sorted)
    rng.shuffle(edges)
    var = {e: i + 1 for i, e in enumerate(edges)}
    inc = {v: [] for v in range(vertices)}
    for e, x in var.items():
        for v in e:
            inc[v].append(x)
    cl = []
    for v, xs in inc.items():
        charge = 1 if v == 0 else 0
        for signs in itertools.product((1, -1), repeat=3):
            # forbid assignments with the wrong parity
            ones = sum(1 for s in signs if s < 0)        # clause false when negated vars are 1
            if ones % 2 != charge:
                cl.append([s * x for s, x in zip(signs, xs)])
    return cl


def timed(f, clauses, **kw):
    t = time.perf_counter()
    try:
        s = f(clauses, **kw).status
    except Exception as e:                       # report, don't hide
        s = f"ERROR {type(e).__name__}"
    return s, time.perf_counter() - t


def row(name, clauses, other):
    a, ta = timed(other, clauses)
    b, tb = timed(mine, clauses)
    print(f"{name:<38} {a:<8} {ta:>8.3f}s   {b:<8} {tb:>8.3f}s", flush=True)
    return a, b


def main():
    other = load_other(sys.argv[1])
    print(f"{'formula':<38} {'upload':<8} {'time':>9}   {'polysat':<8} {'time':>9}")

    rng = random.Random(5)
    counts = {"upload": {}, "polysat": {}}
    t_up = t_me = 0
    both_up = both_me = 0           # time on formulas the upload decides
    for _ in range(2000):
        n = rng.randint(3, 12)
        k = rng.choice((2, 3, 3, 4))
        f = [[v * rng.choice((1, -1)) for v in rng.sample(range(1, n + 1), min(k, n))]
             for _ in range(rng.randint(1, 5 * n))]
        a, ta = timed(other, f)
        b, tb = timed(mine, f)
        t_up += ta
        t_me += tb
        if a in ("SAT", "UNSAT"):
            both_up += ta
            both_me += tb
        counts["upload"][a] = counts["upload"].get(a, 0) + 1
        counts["polysat"][b] = counts["polysat"].get(b, 0) + 1
    print(f"2000 random small formulas: upload {counts['upload']} in {t_up:.2f}s; "
          f"polysat {counts['polysat']} in {t_me:.2f}s")
    print(f"  on the formulas the upload decides: upload {both_up:.2f}s, polysat {both_me:.2f}s")

    for h in (5, 10, 20):
        row(f"pigeonhole n={h}", php(h), other)
    row("pigeonhole n=6, all variables flipped", php(6, flip=True), other)
    row("pigeonhole n=6 + clause (x1 or x7)", [[1, 7]] + php(6), other)
    for n in (50, 100, 200):
        for s in range(3):
            r2 = random.Random(s)
            f = [[v * r2.choice((1, -1)) for v in r2.sample(range(1, n + 1), 3)]
                 for _ in range(round(4.26 * n))]
            row(f"random 3-SAT 4.26 n={n} seed {s}", f, other)
    for n in (100, 200):
        r2 = random.Random(9)
        f = [[v * r2.choice((1, -1)) for v in r2.sample(range(1, n + 1), 3)]
             for _ in range(round(3.8 * n))]
        row(f"random 3-SAT 3.8 n={n}", f, other)
    r2 = random.Random(3)
    f = [[v * r2.choice((1, -1)) for v in r2.sample(range(1, 20001), 2)] for _ in range(19000)]
    row("random 2-SAT 20000 vars", f, other)
    for v in (1000, 10000, 100000):
        row(f"Tseitin parity {v} vertices", tseitin(v, 1), other)


if __name__ == "__main__":
    main()
