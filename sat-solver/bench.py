"""How fast does the structure grow? Prints size and time as n grows.

If the method were polynomial, size would grow like n^c for a fixed c:
doubling n would multiply size by a constant. Exponential growth shows up
as size multiplying by a constant every time n goes up by a fixed step.
"""

import random
import time

from patterns import Builder, FALSE, size


def chain(n):  # (x1 or y1) and ... and (xn or yn): easy, independent parts
    return frozenset(frozenset((2 * i + 1, 2 * i + 2)) for i in range(n))


def random_3sat(n, seed, ratio=4.26):  # hardest random region
    rng = random.Random(seed)
    return frozenset(
        frozenset(v * rng.choice((1, -1)) for v in rng.sample(range(1, n + 1), 3))
        for _ in range(round(ratio * n)))


def pigeonhole(h):  # h+1 pigeons, h holes: always unsatisfiable
    var = lambda p, j: p * h + j + 1
    cl = [frozenset(var(p, j) for j in range(h)) for p in range(h + 1)]
    for j in range(h):
        for p in range(h + 1):
            for q in range(p + 1, h + 1):
                cl.append(frozenset((-var(p, j), -var(q, j))))
    return frozenset(cl)


def run(name, sizes, make, limit=60):
    print(f"\n{name}")
    print(f"{'n':>5} {'nodes':>10} {'edges':>10} {'steps':>10} {'sec':>8}  result")
    for n in sizes:
        f = make(n)
        b = Builder()
        t = time.time()
        root = b.solve(f)
        dt = time.time() - t
        nodes, edges = size(b, root)
        print(f"{n:>5} {nodes:>10} {edges:>10} {len(b.memo):>10} {dt:>8.2f}  "
              f"{'UNSAT' if root == FALSE else 'SAT'}")
        if dt > limit:
            print("      (stopping: too slow)")
            break


if __name__ == "__main__":
    run("chain (x_i or y_i)", [10, 100, 1000, 5000], chain)
    run("random 3-SAT, 4.26 clauses per variable (seed 0)",
        [10, 20, 30, 40, 50, 60, 70, 80], lambda n: random_3sat(n, 0))
    run("pigeonhole: n+1 pigeons, n holes", [2, 3, 4, 5, 6, 7, 8], pigeonhole)
