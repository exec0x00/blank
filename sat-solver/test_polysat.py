"""Brute-force checks for polysat.py."""

import itertools
import random
import unittest

from polysat import covers, normalize, solve, verify_parity, parse_formula


def brute(f):
    vs = sorted({abs(x) for c in f for x in c})
    for bits in itertools.product((False, True), repeat=len(vs)):
        a = dict(zip(vs, bits))
        if all(any(a[abs(x)] == (x > 0) for x in c) for c in f):
            return "SAT"
    return "UNSAT"


def random_cnf(rng):
    n = rng.randint(1, 10)
    k = rng.choice((1, 2, 2, 3, 3, 3, 4))
    m = rng.randint(1, 6 * n)
    return [[v * rng.choice((1, -1)) for v in rng.sample(range(1, n + 1), min(k, n))]
            for _ in range(m)]


def php(h, flip=False):
    v = lambda p, j: p * h + j + 1
    cl = [[v(p, j) for j in range(h)] for p in range(h + 1)]
    cl += [[-v(p, j), -v(q, j)] for j in range(h) for p in range(h + 1) for q in range(p + 1, h + 1)]
    return [[-x for x in c] for c in cl] if flip else cl


class Tests(unittest.TestCase):
    def check(self, f, complete):
        r = solve(f, complete=complete)
        real = brute(f)
        if r.status == "SAT":
            self.assertEqual(real, "SAT", f)
            self.assertTrue(covers([tuple(c) for c in f if not any(-x in c for x in c)],
                                   r.pattern), (f, r.pattern))
        elif r.status == "UNSAT":
            self.assertEqual(real, "UNSAT", f)
            if r.certificate.get("kind") == "GF(2) contradiction":
                self.assertTrue(verify_parity(r.normalized, r.certificate))
        else:
            self.assertFalse(complete, "complete mode returned UNKNOWN")
        return r.status

    def test_random_polynomial(self):
        rng = random.Random(11)
        for _ in range(3000):
            self.check(random_cnf(rng), complete=False)

    def test_random_complete(self):
        rng = random.Random(12)
        for _ in range(3000):
            self.check(random_cnf(rng), complete=True)

    def test_examples(self):
        cases = {
            "(a or not b or c or d) and (a or b or d or e)": "SAT",
            "(a) and (b) and (not a or not b)": "UNSAT",
            "(a or b) and (not a or c) and (not c or not b) and (a or not c) and (not a or b)": "SAT",
            "(a or b) and (not a or not b)": "SAT",
        }
        for text, want in cases.items():
            self.assertEqual(solve(parse_formula(text)[0]).status, want, text)

    def test_pigeonhole_variants(self):
        for h in (3, 6, 10):
            self.assertEqual(solve(php(h)).status, "UNSAT")
            self.assertEqual(solve(php(h, flip=True)).status, "UNSAT")
            self.assertEqual(solve([[1, h + 1]] + php(h)).status, "UNSAT")

    def test_parity(self):
        # a xor b xor c = 1 and a xor b xor c = 0: contradiction
        odd = [[1, 2, 3], [1, -2, -3], [-1, 2, -3], [-1, -2, 3]]
        even = [[-x for x in c] for c in odd]
        r = solve(odd + even)
        self.assertEqual(r.status, "UNSAT")
        self.assertTrue(verify_parity(r.normalized, r.certificate))

    def test_edge_cases(self):
        self.assertEqual(solve([]).status, "SAT")
        self.assertEqual(solve([[]]).status, "UNSAT")
        self.assertEqual(solve([[1, -1]]).status, "SAT")
        self.assertEqual(solve([[1, 1], [-1]]).status, "UNSAT")
        self.assertEqual(solve([[5], [7, -5]]).pattern, (5, 7))


if __name__ == "__main__":
    unittest.main()
