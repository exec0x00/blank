"""Solution-pattern SAT solver.

Builds every solution of a CNF formula as a nested structure written as

    a        a must be 1
    !b       b must be 0
    ( ... )  AND: every element must hold
    [ ... ]  choice: pick any one element

Variables that do not appear on a chosen path can take any value.

The structure is a graph: identical sub-structures are built once and shared.
Every path through it is consistent: a variable appears at most once on a
path, so a path never contains both x and !x.

How it generalizes the two-clause method (common literals, first-only /
second-only literals, opposite pairs) to any number of clauses:

  * Unit clauses force a literal:                  (x, rest)
  * Clauses that share no variables are independent and are joined with AND:
                                                   (part1, part2)
  * Otherwise pick the literal shared by the most clauses (your "common
    literal") and make a choice:
        [ (x, rest when x=1), (!x, rest when x=0) ]
    If !x never occurs, the second branch does not depend on x, so the
    label !x is dropped. That is your Step 1: (a or d) needs no "not a".
    Your opposite-pair rule is the case where both x and !x occur: the
    two branches get the labels x and !x, so they can never be mixed.
  * A sub-formula that was already solved is reused (the graph sharing).
"""

import sys
from collections import Counter

sys.setrecursionlimit(100000)

TRUE = 0   # node id of the empty pattern (always satisfied)
FALSE = 1  # node id of "no solution"


class Builder:
    def __init__(self):
        # node id -> ("true",) | ("false",) | ("lit", l) | ("and", ids) | ("or", ids)
        self.nodes = [("true",), ("false",)]
        self.index = {n: i for i, n in enumerate(self.nodes)}
        self.memo = {}

    # ---- node construction (hash-consed, so equal nodes are shared) ----

    def _node(self, node):
        i = self.index.get(node)
        if i is None:
            i = len(self.nodes)
            self.nodes.append(node)
            self.index[node] = i
        return i

    def lit(self, l):
        return self._node(("lit", l))

    def AND(self, kids):
        out = []
        for k in kids:
            if k == FALSE:
                return FALSE
            if k == TRUE:
                continue
            if self.nodes[k][0] == "and":
                out.extend(self.nodes[k][1])
            else:
                out.append(k)
        if not out:
            return TRUE
        if len(out) == 1:
            return out[0]
        return self._node(("and", tuple(out)))

    def OR(self, kids):
        out = []
        for k in kids:
            if k == FALSE:
                continue
            if k == TRUE:
                return TRUE
            if self.nodes[k][0] == "or":
                out.extend(self.nodes[k][1])
            else:
                out.append(k)
        out = list(dict.fromkeys(out))
        if not out:
            return FALSE
        if len(out) == 1:
            return out[0]
        return self._node(("or", tuple(out)))

    # ---- the solver ----

    def solve(self, clauses):
        """clauses: frozenset of frozensets of int literals (x or -x)."""
        if frozenset() in clauses:
            return FALSE
        if not clauses:
            return TRUE
        if clauses in self.memo:
            return self.memo[clauses]

        # Unit clauses force their literal.
        forced = []
        f = clauses
        while True:
            unit = next((c for c in f if len(c) == 1), None)
            if unit is None:
                break
            (l,) = unit
            forced.append(l)
            f = condition(f, l)
            if frozenset() in f:
                self.memo[clauses] = FALSE
                return FALSE

        if forced:
            result = self.AND([self.lit(l) for l in forced] + [self.solve(f)])
        else:
            parts = components(f)
            if len(parts) > 1:
                result = self.AND([self.solve(p) for p in parts])
            else:
                result = self.split(f)

        self.memo[clauses] = result
        return result

    def split(self, f):
        counts = Counter(l for c in f for l in c)
        x = max(counts, key=lambda l: (counts[l], -abs(l), l))
        with_x = self.AND([self.lit(x), self.solve(condition(f, x))])
        rest = self.solve(condition(f, -x))
        if counts[-x]:
            rest = self.AND([self.lit(-x), rest])
        return self.OR([with_x, rest])


def condition(clauses, l):
    """Set literal l true: drop satisfied clauses, remove -l from the others."""
    return frozenset(c - {-l} for c in clauses if l not in c)


def components(clauses):
    """Split clauses into groups that share no variables."""
    clauses = list(clauses)
    parent = {}

    def find(v):
        while parent.setdefault(v, v) != v:
            parent[v] = parent[parent[v]]
            v = parent[v]
        return v

    for c in clauses:
        vs = [abs(l) for l in c]
        for v in vs[1:]:
            parent[find(v)] = find(vs[0])
    groups = {}
    for c in clauses:
        groups.setdefault(find(abs(next(iter(c)))), []).append(c)
    parts = [frozenset(g) for g in groups.values()]
    return sorted(parts, key=lambda g: min(abs(l) for c in g for l in c))


# ---- reading formulas ----

def parse(text):
    """Parse '(a or not b or c) and (a or b)' style input.

    Also accepts | & ! ~ - and the words or/and/not.
    Returns (clauses, names) where names[i] is the name of variable i.
    """
    t = text.replace("|", " or ").replace("&", " and ")
    t = t.replace("(", " ").replace(")", " ")
    ids, names, clauses = {}, [None], []
    for part in t.split(" and "):
        clause = set()
        neg = False
        for tok in part.split():
            if tok == "or":
                continue
            if tok == "not":
                neg = True
                continue
            while tok[0] in "!~-":
                neg = not neg
                tok = tok[1:]
            if tok not in ids:
                ids[tok] = len(names)
                names.append(tok)
            clause.add(-ids[tok] if neg else ids[tok])
            neg = False
        if clause:
            clauses.append(frozenset(clause))
    return frozenset(clauses), names


def read_dimacs(path):
    clauses, cur, n = [], [], 0
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line[0] in "c%":
                continue
            if line[0] == "p":
                n = int(line.split()[2])
                continue
            for tok in line.split():
                v = int(tok)
                if v == 0:
                    clauses.append(frozenset(cur))
                    cur = []
                else:
                    cur.append(v)
                    n = max(n, abs(v))
    return frozenset(clauses), [None] + [f"x{i}" for i in range(1, n + 1)]


# ---- output ----

def show(b, root, names):
    """Print the structure in ( ... ) / [ ... ] notation.

    Sub-structures used more than once are printed once, as N1 = ...,
    and referred to by name; that is the graph.
    """
    if root == TRUE:
        return "TRUE (any assignment works)"
    if root == FALSE:
        return "UNSATISFIABLE (no solution)"

    uses = Counter()
    seen = set()

    def count(i):
        uses[i] += 1
        if i in seen:
            return
        seen.add(i)
        kind = b.nodes[i][0]
        if kind in ("and", "or"):
            for k in b.nodes[i][1]:
                count(k)

    count(root)
    shared = {}
    for i in sorted(seen):
        if uses[i] > 1 and b.nodes[i][0] in ("and", "or"):
            shared[i] = f"N{len(shared) + 1}"

    def lit_name(l):
        return ("!" if l < 0 else "") + names[abs(l)]

    def fmt(i, top=False):
        if i in shared and not top:
            return shared[i]
        kind = b.nodes[i][0]
        if kind == "lit":
            return lit_name(b.nodes[i][1])
        inner = ", ".join(fmt(k) for k in b.nodes[i][1])
        return f"({inner})" if kind == "and" else f"[{inner}]"

    lines = [fmt(root)]
    for i, name in shared.items():
        lines.append(f"{name} = {fmt(i, top=True)}")
    return "\n".join(lines)


def size(b, root):
    """Number of distinct nodes and edges reachable from root."""
    seen, edges, stack = set(), 0, [root]
    while stack:
        i = stack.pop()
        if i in seen:
            continue
        seen.add(i)
        if b.nodes[i][0] in ("and", "or"):
            edges += len(b.nodes[i][1])
            stack.extend(b.nodes[i][1])
    return len(seen), edges


def one_solution(b, root):
    """Follow the first choice everywhere; returns a list of literals."""
    out, stack = [], [root]
    while stack:
        i = stack.pop()
        kind = b.nodes[i][0]
        if kind == "lit":
            out.append(b.nodes[i][1])
        elif kind == "and":
            stack.extend(b.nodes[i][1])
        elif kind == "or":
            stack.append(b.nodes[i][1][0])
    return out


def evaluate(b, root, assignment):
    """Does the structure accept this full assignment? (dict var -> bool)"""
    cache = {}

    def ev(i):
        if i in cache:
            return cache[i]
        kind = b.nodes[i][0]
        if kind == "true":
            r = True
        elif kind == "false":
            r = False
        elif kind == "lit":
            l = b.nodes[i][1]
            r = assignment[abs(l)] == (l > 0)
        elif kind == "and":
            r = all(ev(k) for k in b.nodes[i][1])
        else:
            r = any(ev(k) for k in b.nodes[i][1])
        cache[i] = r
        return r

    return ev(root)


def main():
    if len(sys.argv) > 1 and sys.argv[1].endswith(".cnf"):
        clauses, names = read_dimacs(sys.argv[1])
    else:
        text = " ".join(sys.argv[1:]) or sys.stdin.read()
        clauses, names = parse(text)
    b = Builder()
    root = b.solve(clauses)
    print(show(b, root, names))
    nodes, edges = size(b, root)
    print(f"\nsize: {nodes} nodes, {edges} edges")
    if root != FALSE:
        sol = sorted(one_solution(b, root), key=abs)
        print("one solution:", ", ".join(
            f"{names[abs(l)]}={int(l > 0)}" for l in sol),
            "(others: any value)")


if __name__ == "__main__":
    main()
