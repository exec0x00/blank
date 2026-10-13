"""Growth of the clause-by-clause dictionary method (peak number of patterns)."""

import time

from bench import chain, pigeonhole, random_3sat
from indexed import solve


def run(name, sizes, make, limit=20):
    print(f"\n{name}")
    print(f"{'n':>5} {'peak patterns':>14} {'sec':>8}  result")
    for n in sizes:
        t = time.time()
        s, peak = solve(make(n))
        dt = time.time() - t
        print(f"{n:>5} {peak:>14} {dt:>8.2f}  {'SAT' if s.patterns else 'UNSAT'}",
              flush=True)
        if dt > limit:
            print("      (stopping: too slow)")
            break


if __name__ == "__main__":
    run("chain (x_i or y_i)", [4, 6, 8, 10, 12], chain)
    run("random 3-SAT, 4.26 clauses per variable (seed 0)",
        [10, 15, 20, 25, 30], lambda n: random_3sat(n, 0))
    run("pigeonhole: n+1 pigeons, n holes", [2, 3, 4, 5], pigeonhole)
