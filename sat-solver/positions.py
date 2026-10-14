"""Position graph: every pattern stored implicitly by positions.

A position is (clause number, literal number), e.g. (2, 1) is the first
literal of clause 2. A pattern is one position chosen from every clause:
"take literal 3 of clause 1, literal 1 of clause 2, ...". Nothing is
expanded, so storing all patterns costs only:

  * a table  literal -> positions where it appears        (your dictionary)
  * conflict edges between positions holding x and !x     (opposite pairs)

Both are built in time about (number of literals)^2: polynomial.

The catch: a chosen set of positions is a real solution only if no two of
them are joined by a conflict edge. Finding such a choice is the search
below, and its step count is what the benchmark measures.
"""

import sys
import time

from bench import chain, pigeonhole, random_3sat
from patterns import parse


def build(clauses):
    clauses = [sorted(c, key=lambda l: (abs(l), l < 0)) for c in clauses]
    where = {}
    for ci, c in enumerate(clauses, 1):
        for li, l in enumerate(c, 1):
            where.setdefault(l, []).append((ci, li))
    conflicts = {}
    for l, ps in where.items():
        for p in ps:
            conflicts[p] = conflicts.get(p, []) + where.get(-l, [])
    return clauses, where, conflicts


def search(clauses, conflicts, limit=None):
    """Choose one position per clause with no conflicts between choices.

    Backtracking: always fill the clause with the fewest positions left;
    choosing a position removes all positions that conflict with it.
    Returns (choice or None, number of steps).
    """
    options = {ci: {(ci, li) for li in range(1, len(c) + 1)}
               for ci, c in enumerate(clauses, 1)}
    chosen, steps = {}, 0

    def go():
        nonlocal steps
        if len(chosen) == len(options):
            return True
        ci = min((c for c in options if c not in chosen),
                 key=lambda c: len(options[c]))
        for p in sorted(options[ci]):
            steps += 1
            if limit and steps > limit:
                raise TimeoutError
            removed = [q for q in conflicts.get(p, ())
                       if q[0] not in chosen and q in options[q[0]]]
            for q in removed:
                options[q[0]].discard(q)
            if all(options[c] for c in options if c not in chosen and c != ci):
                chosen[ci] = p
                if go():
                    return True
                del chosen[ci]
            for q in removed:
                options[q[0]].add(q)
        return False

    found = go()
    return (dict(chosen) if found else None), steps


def main():
    clauses, names = parse(" ".join(sys.argv[1:]))
    cl, where, conflicts = build(clauses)

    def nm(l):
        return ("!" if l < 0 else "") + names[abs(l)]

    for ci, c in enumerate(cl, 1):
        print(f"clause {ci}: " + ", ".join(f"{li}:{nm(l)}" for li, l in enumerate(c, 1)))
    print("dictionary:")
    for l in sorted(where, key=lambda l: (abs(l), l < 0)):
        print(f"  {nm(l)} -> {where[l]}")
    print("conflicts:")
    for p, qs in sorted(conflicts.items()):
        if qs and p < min(qs):
            print(f"  {p} <-> {qs}")
    choice, steps = search(cl, conflicts)
    if choice is None:
        print("UNSATISFIABLE")
    else:
        lits = sorted({cl[ci - 1][li - 1] for ci, li in choice.values()}, key=abs)
        print("solution positions:", [choice[c] for c in sorted(choice)])
        print("solution:", ", ".join(nm(l) for l in lits), "(others: any value)")
    print("search steps:", steps)


def bench():
    def run(name, sizes, make):
        print(f"\n{name}\n{'n':>5} {'build size':>11} {'search steps':>13} {'sec':>7}")
        for n in sizes:
            t = time.time()
            cl, where, conflicts = build(make(n))
            edges = sum(len(v) for v in conflicts.values()) // 2
            try:
                _, steps = search(cl, conflicts, limit=2_000_000)
            except TimeoutError:
                steps = "> 2000000"
            print(f"{n:>5} {edges:>11} {steps:>13} {time.time() - t:>7.2f}", flush=True)
            if steps == "> 2000000":
                break

    run("chain (x_i or y_i)", [10, 100, 1000], chain)
    run("pigeonhole: n+1 pigeons, n holes", [3, 4, 5, 6, 7, 8], pigeonhole)
    run("random 3-SAT 4.26 (seed 0)", [20, 30, 40, 50, 60], lambda n: random_3sat(n, 0))


if __name__ == "__main__":
    bench() if sys.argv[1:] == ["--bench"] else main()
