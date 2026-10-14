"""Four steps on every pair of clauses, stored in the position structure.

Positions are (clause, literal number), as in positions.py. For every pair
of clauses i < j the four steps are run with the literal dictionary and the
result is stored, nothing more:

  common       literals in both clauses           -> solution patterns
  first-only   literals only in clause i
  second-only  literals only in clause j
  opposite     literal x in i and !x in j          (never pick both)

Work: each pair costs (literals in i + literals in j), so the whole build
is about (number of clauses)^2 x (literals per clause): polynomial.

Reading a full solution out of the stored pairs means choosing one
position per clause so that no chosen pair is an opposite pair. Two ways
are tried:

  direct   take each clause's first position that is not opposite to an
           earlier choice; no going back (fast, may get stuck)
  search   go back and try another position when stuck, filling the
           clause with the fewest positions left first (positions.py);
           always right, and the step count shows the cost
"""

import sys
import time
from itertools import combinations

from bench import chain, pigeonhole, random_3sat
from patterns import parse
from positions import search as smart_search


def build(clauses):
    clauses = [sorted(c, key=lambda l: (abs(l), l < 0)) for c in clauses]
    where = {}                                  # literal -> positions
    for ci, c in enumerate(clauses, 1):
        for li, l in enumerate(c, 1):
            where.setdefault(l, []).append((ci, li))
    table = {}                                  # (i, j) -> four steps
    for i, j in combinations(range(1, len(clauses) + 1), 2):
        ci, cj = set(clauses[i - 1]), set(clauses[j - 1])
        common = ci & cj
        opposite = {l for l in ci if -l in cj}
        table[i, j] = {
            "common": common,
            "first-only": ci - common - opposite,
            "second-only": cj - common - {-l for l in opposite},
            "opposite": opposite,
        }
    return clauses, where, table


def opposite_positions(clauses, where):
    """Position -> positions it may never be chosen together with."""
    bad = {}
    for l, ps in where.items():
        for p in ps:
            bad[p] = [q for q in where.get(-l, ()) if q[0] != p[0]]
    return bad


def direct(clauses, bad):
    chosen, taken = {}, set()
    for ci, c in enumerate(clauses, 1):
        for li in range(1, len(c) + 1):
            p = (ci, li)
            if p not in taken:
                chosen[ci] = p
                taken.update(bad.get(p, ()))
                break
        else:
            return None                          # stuck: no position left
    return chosen



def main():
    clauses, names = parse(" ".join(sys.argv[1:]), ordered=True)
    cl, where, table = build(clauses)
    nm = lambda l: ("!" if l < 0 else "") + names[abs(l)]
    group = lambda s: ", ".join(nm(l) for l in sorted(s, key=abs)) or "-"
    for (i, j), t in table.items():
        print(f"clauses {i} & {j}: " + "   ".join(
            f"{k}: {group(v)}" for k, v in t.items()))
    bad = opposite_positions(cl, where)
    for label, choice in (("direct", direct(cl, bad)), ("search", smart_search(cl, bad)[0])):
        if choice is None:
            print(f"{label}: no solution found")
        else:
            lits = sorted({cl[c - 1][p[1] - 1] for c, p in choice.items()}, key=abs)
            print(f"{label}: {group(lits)}  (others: any value)")


def bench():
    print(f"{'formula':<22} {'clauses':>8} {'build sec':>10} {'direct':>14} "
          f"{'search steps':>13}")
    cases = ([("chain", n, chain(n)) for n in (100, 400, 1600)]
             + [("random 3-SAT 4.26", n, random_3sat(n, 0)) for n in (20, 40, 60, 80)]
             + [("pigeonhole", n, pigeonhole(n)) for n in (3, 4, 5, 6)])
    for name, n, f in cases:
        t = time.time()
        cl, where, table = build(f)
        bt = time.time() - t
        bad = opposite_positions(cl, where)
        d = "found" if direct(cl, bad) else "stuck/none"
        try:
            sol, steps = smart_search(cl, bad, limit=2_000_000)
            steps = f"{steps} ({'SAT' if sol else 'UNSAT'})"
        except TimeoutError:
            steps = "> 2000000"
        print(f"{name + ' n=' + str(n):<22} {len(cl):>8} {bt:>10.2f} {d:>14} "
              f"{steps:>13}", flush=True)


if __name__ == "__main__":
    bench() if sys.argv[1:] == ["--bench"] else main()
