"""Brute-force check: the structure accepts exactly the satisfying assignments,
and no path uses a variable twice (so never both x and !x)."""

import itertools
import random

from patterns import Builder, FALSE, evaluate, one_solution


def random_cnf(rng, n, m, k):
    return frozenset(
        frozenset(v * rng.choice((1, -1)) for v in rng.sample(range(1, n + 1), k))
        for _ in range(m))


def paths_consistent(b, root):
    """Every node's paths mention each variable at most once."""
    memo = {}

    def vars_of(i):  # variables mentioned anywhere below i; raises on conflict
        if i in memo:
            return memo[i]
        node = b.nodes[i]
        if node[0] == "lit":
            r = {abs(node[1])}
        elif node[0] == "and":
            r = set()
            for k in node[1]:
                vk = vars_of(k)
                assert not (r & vk), "AND children share a variable"
                r |= vk
        elif node[0] == "or":
            r = set().union(*(vars_of(k) for k in node[1]))
        else:
            r = set()
        memo[i] = r
        return r

    vars_of(root)


def test_random(trials=3000, seed=1):
    rng = random.Random(seed)
    for _ in range(trials):
        n = rng.randint(1, 8)
        k = rng.randint(1, min(3, n))
        f = random_cnf(rng, n, rng.randint(1, 4 * n), k)
        b = Builder()
        root = b.solve(f)
        paths_consistent(b, root)
        any_sat = False
        for bits in itertools.product((False, True), repeat=n):
            a = dict(enumerate(bits, 1))
            truth = all(any(a[abs(l)] == (l > 0) for l in c) for c in f)
            any_sat |= truth
            assert evaluate(b, root, a) == truth, (f, a)
        assert (root != FALSE) == any_sat
        if any_sat:  # the extracted pattern really satisfies every clause
            sol = set(one_solution(b, root))
            assert all(c & sol for c in f), (f, sol)
    print(f"ok: {trials} random formulas match brute force")


if __name__ == "__main__":
    test_random()
