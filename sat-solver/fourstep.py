"""The four-step method applied to whole groups of clauses.

A clause is a list of one-literal patterns: (a or !b or c) = [a], [!b], [c].
Two pattern lists A and B are joined with the four steps:

  Step 1  common:    a pattern in both A and B is kept as it is
  Step 2  first-only and second-only patterns are joined:      a + b
  Step 3/4 a pattern joins the other side's opposite-pair patterns
          (c with b, e with !b); the opposite pair itself (!b with b)
          is dropped because it contains x and !x.
  Finally a pattern containing a smaller one is dropped
  ((a, c) adds nothing next to (a)).

Clauses are joined in pairs like a tournament: (1,2), (3,4), ... then the
results in pairs, until one list is left: every solution pattern.
"""

import sys
import time

from bench import chain, pigeonhole, random_3sat
from patterns import parse


def name_of(names):
    return lambda l: ("!" if l < 0 else "") + names[abs(l)]


def join(A, B, log=None):
    common = [p for p in A if p in B]                       # step 1
    joined = []
    for a in A:
        for b in B:
            if a in common or b in common:
                continue
            q = a | b
            if any(-l in q for l in q):                    # opposite pair
                continue
            joined.append(q)                               # steps 2-4
    if log:
        log(common, joined)
    out = []
    for q in sorted(set(common + joined), key=len):        # drop covered
        if not any(r <= q for r in out):
            out.append(q)
    return out


def solve(clauses, log=None):
    lists = [[frozenset([l]) for l in sorted(c, key=abs)]
             for c in sorted(clauses, key=lambda c: sorted(c))]
    peak = max((len(x) for x in lists), default=0)
    if not lists:
        return [frozenset()], 0
    while len(lists) > 1:
        nxt = []
        for i in range(0, len(lists) - 1, 2):
            r = join(lists[i], lists[i + 1], log)
            if not r:
                return [], peak
            peak = max(peak, len(r))
            nxt.append(r)
        if len(lists) % 2:
            nxt.append(lists[-1])
        lists = nxt
    return lists[0], peak


def main():
    clauses, names = parse(" ".join(sys.argv[1:]))
    nm = name_of(names)
    fmt = lambda p: "(" + " and ".join(nm(l) for l in sorted(p, key=abs)) + ")"

    def log(common, joined):
        print("  common:", ", ".join(fmt(p) for p in common) or "-")
        print("  joined:", ", ".join(fmt(p) for p in joined) or "-")

    result, peak = solve(clauses, log)
    print("result:", " or ".join(fmt(p) for p in result) or "UNSATISFIABLE")


def bench():
    def run(name, sizes, make, limit=30):
        print(f"\n{name}\n{'n':>5} {'peak patterns':>14} {'sec':>7}")
        for n in sizes:
            t = time.time()
            _, peak = solve(make(n))
            dt = time.time() - t
            print(f"{n:>5} {peak:>14} {dt:>7.2f}", flush=True)
            if dt > limit:
                break

    run("chain (x_i or y_i)", [4, 8, 12], chain)
    run("pigeonhole: n+1 pigeons, n holes", [2, 3, 4, 5], pigeonhole)
    run("random 3-SAT 4.26 (seed 0)", [10, 15, 20, 25], lambda n: random_3sat(n, 0))


if __name__ == "__main__":
    bench() if sys.argv[1:] == ["--bench"] else main()
