"""Polynomial read-outs for the pair structure (pairs.py).

No read-out here ever goes back on a choice, so each one takes polynomial
time. They answer SAT (with a solution), UNSAT, or "stuck".

  propagate  remove every position that is opposite to all positions of
             some other clause, and repeat until nothing changes;
             a clause left with no position means UNSAT
  probe      also try each position on its own: pick it, propagate, and
             if some clause loses every position, remove that position
  read-out   propagate/probe, then pick the first position left in the
             smallest clause, propagate/probe again, ... never undoing a pick
"""

import itertools
import random
import time

from bench import pigeonhole, random_3sat
from pairs import build, opposite_positions


def propagate(options, bad, chosen):
    """Positions that stay possible, given the picks in `chosen`."""
    options = {c: set(ps) for c, ps in options.items()}
    for p in chosen.values():
        for q in bad.get(p, ()):
            options[q[0]].discard(q)
    changed = True
    while changed:
        changed = False
        for c, ps in options.items():
            if not ps:
                return None
            for p in list(ps):
                for d, qs in options.items():
                    if d != c and qs and all(q in bad.get(p, ()) for q in qs):
                        ps.discard(p)        # p would leave clause d empty
                        changed = True
                        break
        if any(not ps for ps in options.values()):
            return None
    return options


def probe(options, bad, chosen):
    options = propagate(options, bad, chosen)
    changed = True
    while options is not None and changed:
        changed = False
        for c, ps in options.items():
            if c in chosen:
                continue
            for p in list(ps):
                if propagate(options, bad, {**chosen, c: p}) is None:
                    ps.discard(p)
                    changed = True
        options = propagate(options, bad, chosen) if changed else options
    return options


def read_out(clauses, bad, step):
    options = {c: {(c, i) for i in range(1, len(cl) + 1)}
               for c, cl in enumerate(clauses, 1)}
    chosen = {}
    while True:
        options = step(options, bad, chosen)
        if options is None:
            return "UNSAT" if not chosen else "stuck", None
        free = [c for c in options if c not in chosen]
        if not free:
            return "SAT", chosen
        c = min(free, key=lambda c: len(options[c]))
        chosen[c] = min(options[c])


def truth(f, n):
    return any(all(any(a[abs(l) - 1] == (l > 0) for l in c) for c in f)
               for a in itertools.product((0, 1), repeat=n))


def main():
    for name, step in (("propagate", propagate), ("probe", probe)):
        print(f"\n== {name} ==")
        rng = random.Random(0)
        right = {"SAT": 0, "UNSAT": 0}
        wrong = 0
        total = 300 if step is propagate else 40
        for _ in range(total):
            f = random_3sat(12, rng.randrange(10**9))
            cl, where, _ = build(f)
            ans, sol = read_out(cl, opposite_positions(cl, where), step)
            real = "SAT" if truth(f, 12) else "UNSAT"
            if ans == real:
                right[real] += 1
            else:
                wrong += 1
        print(f"random 3-SAT, 12 vars, {total} formulas: right on "
              f"{right['SAT']} SAT + {right['UNSAT']} UNSAT, stuck on {wrong}")
        for n in ((3, 4, 5, 6) if step is propagate else (3, 4)):
            t = time.time()
            cl, where, _ = build(pigeonhole(n))
            ans, _ = read_out(cl, opposite_positions(cl, where), step)
            print(f"pigeonhole n={n} (really UNSAT): answered {ans:<6}"
                  f"  {time.time() - t:.2f} s", flush=True)


if __name__ == "__main__":
    main()
