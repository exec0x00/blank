"""Clause-by-clause solver with a position dictionary.

The solution is a numbered list of patterns. Each pattern is an AND of
literals; the solution is a choice between patterns:

    1: (a)   2: (d)   3: (!b, e)   4: (b, c)   5: (c, e)

The dictionary maps every literal to the patterns it appears in:

    a -> {1}   d -> {2}   !b -> {3}   b -> {4}   c -> {4, 5}   e -> {3, 5}

Start: the first clause, one pattern per literal.
For each next clause C, every current pattern P is handled by your rules,
using the dictionary instead of scanning:

  * Common:      P already contains a literal of C (lookup C's literals)
                 -> P satisfies C too, keep it unchanged.
  * Opposite:    P contains !x for a literal x of C (lookup -x)
                 -> P cannot be extended with x.
  * First-only x second-only:
                 otherwise make P + x for every allowed literal x of C.
  * Drop any pattern that contains another whole pattern (it adds nothing:
    (a, !b) is covered by (a)). Found with the dictionary too: a pattern R
    is inside Q when every literal of Q points at R len(R) times in total.
"""

import sys
from collections import Counter

from patterns import parse, read_dimacs


class Solution:
    def __init__(self):
        self.patterns = {}   # position -> frozenset of literals
        self.where = {}      # literal -> set of positions
        self.next_pos = 1

    def add(self, pattern):
        pos = self.next_pos
        self.next_pos += 1
        self.patterns[pos] = pattern
        for l in pattern:
            self.where.setdefault(l, set()).add(pos)
        return pos

    def remove(self, pos):
        for l in self.patterns.pop(pos):
            self.where[l].discard(pos)

    def contained_in(self, q):
        """Positions of patterns R with R a subset of q."""
        hits = Counter()
        for l in q:
            hits.update(self.where.get(l, ()))
        return [r for r, h in hits.items() if h == len(self.patterns[r])]

    def add_clause(self, clause):
        common = set()
        for l in clause:
            common |= self.where.get(l, set())
        todo = [p for p in self.patterns if p not in common]
        new = []
        for p in todo:
            pat = self.patterns[p]
            self.remove(p)
            for x in clause:
                if p in self.where.get(-x, ()) or -x in pat:   # opposite pair
                    continue
                new.append(pat | {x})
        # Shortest first, so a pattern is never added after one it covers.
        for q in sorted(set(new), key=len):
            if self.contained_in(q):
                continue
            for r in [r for r in self.contained_in_by(q)]:
                self.remove(r)
            self.add(q)

    def contained_in_by(self, q):
        """Kept patterns that strictly contain q (q makes them redundant)."""
        if not q:
            return list(self.patterns)
        lits = iter(q)
        cand = set(self.where.get(next(lits), ()))
        for l in lits:
            cand &= self.where.get(l, set())
        return [r for r in cand if self.patterns[r] != q]


def solve(clauses, trace=None):
    clauses = sorted(clauses, key=lambda c: (len(c), sorted(c)))
    s = Solution()
    s.add(frozenset())          # the empty pattern: nothing required yet
    peak = 1
    for i, c in enumerate(clauses, 1):
        s.add_clause(c)
        peak = max(peak, len(s.patterns))
        if trace:
            trace(i, c, s)
        if not s.patterns:
            break
    return s, peak


def show(s, names):
    def name(l):
        return ("!" if l < 0 else "") + names[abs(l)]

    if not s.patterns:
        return "UNSATISFIABLE (no solution)"
    lines = ["patterns:"]
    for pos, pat in s.patterns.items():
        body = ", ".join(name(l) for l in sorted(pat, key=abs)) or "anything"
        lines.append(f"  {pos}: ({body})")
    lines.append("dictionary:")
    for l in sorted(s.where, key=lambda l: (abs(l), l < 0)):
        if s.where[l]:
            lines.append(f"  {name(l)} -> {sorted(s.where[l])}")
    return "\n".join(lines)


def main():
    if len(sys.argv) > 1 and sys.argv[1].endswith(".cnf"):
        clauses, names = read_dimacs(sys.argv[1])
    else:
        clauses, names = parse(" ".join(sys.argv[1:]) or sys.stdin.read())
    s, peak = solve(clauses)
    print(show(s, names))
    print(f"\npatterns: {len(s.patterns)} at the end, {peak} at the peak")


if __name__ == "__main__":
    main()
