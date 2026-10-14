#!/usr/bin/env python3
"""Polynomial-time SAT read-out with an optional complete mode.

Default mode always finishes in polynomial time. It answers SAT (with a
verified pattern), UNSAT (by a sound rule, with a certificate where one
exists), or UNKNOWN. No polynomial method is known that removes UNKNOWN for
every formula: that would prove P = NP.

--complete adds a CDCL search after the polynomial rules. It decides every
formula, but its worst case is exponential.

Rules, cheapest first (n variables, m clauses, N literal occurrences):

  1. normalize          drop duplicate literals, tautologies, duplicates   O(N log N)
  2. unit propagation   watched literals                                   O(N)
  3. two clauses        common literal or compatible pair                  O(N^2)
  4. 2-SAT              implication graph, strongly connected components   O(n + m)
  5. counting           disjoint demands vs at-most-one cliques (Hall),
                        both polarities, two demand orders                 O(nN + m^2)
  6. parity             complete XOR blocks, Gaussian elimination GF(2)    O(q * n) row ops
  7. renamable Horn     2-SAT on flip variables; covers Horn, anti-Horn    O(sum of k^2)
  8. probing            failed literals + literals implied by both
                        branches, to a fixpoint (<= n rounds)              O(n^2 N)
     then 3-7 again on what is left
  9. elimination        Davis-Putnam, only while each variable adds at
                        most `grow` clauses (a constant <= 128)            <= m + 128 n clauses
     then 3-7 again on what is left
 10. local search       WalkSAT, 50 N flips                                O(N^2)

Every SAT answer is checked against every input clause before it is returned.
"""

import argparse
import heapq
import json
import random
import re
import sys
from collections import defaultdict, deque

sys.setrecursionlimit(10000)


# ----------------------------------------------------------------- results

class Result:
    def __init__(self, status, reason, model=None, certificate=None, stats=None):
        self.status, self.reason = status, reason
        self.model = model                 # set of literals (compact ids) or None
        self.certificate = certificate or {}
        self.stats = stats or {}
        self.pattern = ()                  # minimal sufficient cube, original ids


# --------------------------------------------------------------- normalize

def normalize(clauses):
    """Returns (compact clauses, var map compact->original) or raises.

    Literals in each clause are sorted by variable. Small variable numbers
    are kept as they are; large or sparse ones are renumbered 1..n.
    """
    raw, variables = [], set()
    for clause in clauses:
        s = set(clause)
        if 0 in s or not all(type(x) is int for x in s):
            raise ValueError("literals must be nonzero integers")
        raw.append(s)
        variables.update(map(abs, s))
    top = max(variables, default=0)
    if top <= 2 * len(variables) + 16:
        back = list(range(top + 1))
    else:
        back = [None] + sorted(variables)
        ids = {v: i for i, v in enumerate(back) if v is not None}
        raw = [{ids[x] if x > 0 else -ids[-x] for x in s} for s in raw]
    out, seen = [], set()
    for s in raw:
        if any(-x in s for x in s):
            continue                       # tautology
        c = tuple(sorted(s, key=abs))
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out, back


# ------------------------------------------------------- propagation engine

class Engine:
    """Watched-literal assignment engine: propagate, levels, undo, learn."""

    def __init__(self, n, clauses):
        self.n = n
        self.clauses = [list(c) for c in clauses]
        self.val = [0] * (n + 1)           # 1 true, -1 false, 0 free
        self.level = [0] * (n + 1)
        self.reason = [None] * (n + 1)
        self.trail, self.lim, self.qhead = [], [], 0
        self.watch = [[] for _ in range(2 * n + 2)]
        self.props = 0
        self.ok = True
        for ci, c in enumerate(self.clauses):
            if len(c) == 0:
                self.ok = False
            elif len(c) == 1:
                if not self.enqueue(c[0], None):
                    self.ok = False
            else:
                self.watch[self.w(c[0])].append(ci)
                self.watch[self.w(c[1])].append(ci)

    @staticmethod
    def w(lit):
        return 2 * lit if lit > 0 else -2 * lit + 1

    def value(self, lit):
        v = self.val[abs(lit)]
        return v if lit > 0 else -v

    def enqueue(self, lit, reason):
        cur = self.value(lit)
        if cur:
            return cur == 1
        v = abs(lit)
        self.val[v] = 1 if lit > 0 else -1
        self.level[v] = len(self.lim)
        self.reason[v] = reason
        self.trail.append(lit)
        return True

    def propagate(self):
        """Returns a conflicting clause index, or None."""
        clauses, val = self.clauses, self.val
        while self.qhead < len(self.trail):
            lit = self.trail[self.qhead]
            self.qhead += 1
            false = -lit
            ws = self.watch[self.w(false)]
            keep = []
            i = 0
            while i < len(ws):
                ci = ws[i]
                i += 1
                c = clauses[ci]
                self.props += 1
                if c[0] == false:
                    c[0], c[1] = c[1], c[0]
                first = c[0]
                fv = val[abs(first)]
                if (fv if first > 0 else -fv) == 1:
                    keep.append(ci)
                    continue
                for k in range(2, len(c)):
                    x = c[k]
                    xv = val[abs(x)]
                    if (xv if x > 0 else -xv) != -1:
                        c[1], c[k] = x, c[1]
                        self.watch[self.w(x)].append(ci)
                        break
                else:
                    keep.append(ci)
                    if not self.enqueue(first, ci):
                        keep.extend(ws[i:])
                        self.watch[self.w(false)] = keep
                        self.qhead = len(self.trail)
                        return ci
            self.watch[self.w(false)] = keep
        return None

    def new_level(self):
        self.lim.append(len(self.trail))

    def backtrack(self, lvl):
        if len(self.lim) <= lvl:
            return
        cut = self.lim[lvl]
        for lit in self.trail[cut:]:
            v = abs(lit)
            self.val[v] = 0
            self.reason[v] = None
        del self.trail[cut:]
        del self.lim[lvl:]
        self.qhead = len(self.trail)

    def add_clause(self, lits):
        ci = len(self.clauses)
        self.clauses.append(lits)
        if len(lits) >= 2:
            self.watch[self.w(lits[0])].append(ci)
            self.watch[self.w(lits[1])].append(ci)
        return ci

    def residual(self):
        """Clauses not yet satisfied, with false literals removed."""
        out = []
        for c in self.clauses:
            r = []
            for x in c:
                xv = self.value(x)
                if xv == 1:
                    break
                if xv == 0:
                    r.append(x)
            else:
                out.append(tuple(r))
        return out

    def fixed(self):
        return set(self.trail)


# ------------------------------------------------------------ helpers

def covers(clauses, lits):
    s = set(lits)
    return not any(-x in s for x in s) and all(s.intersection(c) for c in clauses)


def minimal_pattern(clauses, model):
    """Inclusion-minimal sub-cube of a model that still satisfies everything.

    Greedy removal with per-clause true counts: O(N) in total.
    """
    model = set(model)
    count = [0] * len(clauses)
    occ = defaultdict(list)
    for ci, c in enumerate(clauses):
        for x in c:
            if x in model:
                count[ci] += 1
                occ[x].append(ci)
    keep = set(model)
    for x in sorted(model, key=lambda l: (abs(l), l < 0)):
        if all(count[ci] >= 2 for ci in occ[x]):
            keep.discard(x)
            for ci in occ[x]:
                count[ci] -= 1
    return keep


def scc_2sat(clauses, variables):
    """Exact 2-SAT. Returns (model set, None) or (None, conflicting variable)."""
    graph = defaultdict(list)
    for c in clauses:
        a, b = (c[0], c[0]) if len(c) == 1 else c
        graph[-a].append(b)
        graph[-b].append(a)
    nodes = [x for v in variables for x in (v, -v)]
    index, low, comp, on, stack = {}, {}, {}, set(), []
    counter = ncomp = 0
    for root in nodes:                     # iterative Tarjan
        if root in index:
            continue
        work = [(root, iter(graph[root]))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on.add(root)
        while work:
            node, it = work[-1]
            nxt = next(it, None)
            if nxt is not None:
                if nxt not in index:
                    index[nxt] = low[nxt] = counter
                    counter += 1
                    stack.append(nxt)
                    on.add(nxt)
                    work.append((nxt, iter(graph[nxt])))
                elif nxt in on:
                    low[node] = min(low[node], index[nxt])
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[node])
            if low[node] == index[node]:
                while True:
                    x = stack.pop()
                    on.discard(x)
                    comp[x] = ncomp
                    if x == node:
                        break
                ncomp += 1
    for v in variables:
        if comp[v] == comp[-v]:
            return None, v
    # Tarjan numbers components in reverse topological order.
    return {v if comp[v] < comp[-v] else -v for v in variables}, None


# ------------------------------------------------------------------ parity

def parity_extract(clauses):
    groups = defaultdict(dict)
    for cid, c in enumerate(clauses):          # clauses are sorted by variable
        support = tuple(x if x > 0 else -x for x in c)
        forbidden = 0
        for i, x in enumerate(c):
            if x < 0:
                forbidden |= 1 << i
        groups[support].setdefault(forbidden, cid)
    eqs = []
    for support, pats in groups.items():
        if not support:
            continue
        half = 1 << (len(support) - 1)
        if len(pats) < half:
            continue
        for parity in (0, 1):
            origins = [cid for mask, cid in pats.items() if bin(mask).count("1") % 2 == parity]
            if len(origins) == half:
                eqs.append((support, 1 - parity, tuple(sorted(origins))))
    return eqs


def parity_solve(clauses, stats):
    """(model or None, certificate or None). Model covers parity blocks only."""
    eqs = parity_extract(clauses)
    stats["parity_equations"] = len(eqs)
    if not eqs:
        return None, None
    total, rhs_total = set(), 0
    for row, rhs, _ in eqs:
        total.symmetric_difference_update(row)
        rhs_total ^= rhs
    if not total and rhs_total:
        return None, {"kind": "GF(2) contradiction",
                      "equation_clause_ids": [list(e[2]) for e in eqs]}
    q, basis, nodes = len(eqs), {}, []
    for eid, (support, rhs, _) in enumerate(eqs):
        row, prov = set(support), eid
        while row:
            pivot = max(row)
            if pivot not in basis:
                basis[pivot] = (frozenset(row), rhs, prov)
                break
            other, value, origin = basis[pivot]
            row.symmetric_difference_update(other)
            rhs ^= value
            nodes.append((prov, origin))
            prov = q + len(nodes) - 1
            stats["parity_row_xors"] = stats.get("parity_row_xors", 0) + 1
        else:
            if rhs:
                coef = bytearray(q + len(nodes))
                coef[prov] = 1
                for i in range(len(nodes) - 1, -1, -1):
                    if coef[q + i]:
                        a, b = nodes[i]
                        coef[a] ^= 1
                        coef[b] ^= 1
                return None, {"kind": "GF(2) contradiction",
                              "equation_clause_ids": [list(eqs[i][2]) for i in range(q) if coef[i]]}
    true = set()
    for pivot in sorted(basis):
        row, rhs, _ = basis[pivot]
        if rhs ^ (len(row & true) % 2):
            true.add(pivot)
    variables = {abs(x) for c in clauses for x in c}
    return {v if v in true else -v for v in variables}, None


def verify_parity(clauses, cert):
    """Independent checker for a GF(2) certificate over normalized clauses."""
    if not isinstance(cert, dict) or cert.get("kind") != "GF(2) contradiction":
        return False
    support_sum, rhs_sum = set(), 0
    for ids in cert.get("equation_clause_ids") or []:
        support = parity = None
        pats = set()
        for cid in ids:
            if not (isinstance(cid, int) and 0 <= cid < len(clauses)):
                return False
            c = clauses[cid]
            s = frozenset(abs(x) for x in c)
            neg = frozenset(-x for x in c if x < 0)
            p = len(neg) % 2
            if support is None:
                support, parity = s, p
            if s != support or p != parity or neg in pats:
                return False
            pats.add(neg)
        if support is None or len(pats) != 1 << (len(support) - 1):
            return False
        support_sum.symmetric_difference_update(support)
        rhs_sum ^= 1 - parity
    return bool(cert.get("equation_clause_ids")) and not support_sum and rhs_sum == 1


# ---------------------------------------------------------------- counting

def counting(clauses, stats):
    """Hall's theorem on disjoint demands vs at-most-one cliques.

    Tries both polarities and two demand orders. Returns
    (candidate model or None, certificate or None).
    """
    binary = [c for c in clauses if len(c) == 2]
    # Without "not both" pairs every resource holds one variable and disjoint
    # demands always fit, so this rule could neither refute nor help.
    signs = [s for s in (1, -1) if any(s * c[0] < 0 and s * c[1] < 0 for c in binary)]
    variables = sorted({abs(x) for c in clauses for x in c})
    if not signs:                          # still offer the cheap candidate
        used, true = set(), set()
        for c in clauses:
            if c[0] > 0 and all(x > 0 for x in c) and not used.intersection(c):
                used.update(c)
                true.add(c[0])
        return {v if v in true else -v for v in variables}, None
    candidate = None
    for sign in signs:
        cl = clauses if sign == 1 else [tuple(-x for x in c) for c in clauses]
        conflicts = {v: set() for v in variables}
        for c in cl:
            if len(c) == 2 and c[0] < 0 and c[1] < 0:
                conflicts[-c[0]].add(-c[1])
                conflicts[-c[1]].add(-c[0])
        resources, res_of, seen = [], {}, set()
        for root in variables:
            if root in seen:
                continue
            comp, stack = [], [root]
            seen.add(root)
            while stack:
                v = stack.pop()
                comp.append(v)
                for u in conflicts[v]:
                    if u not in seen:
                        seen.add(u)
                        stack.append(u)
            clique = all(len(conflicts[v]) == len(comp) - 1 for v in comp)
            for group in ([sorted(comp)] if clique else [[v] for v in comp]):
                for v in group:
                    res_of[v] = len(resources)
                resources.append(group)
        positive = [c for c in cl if all(x > 0 for x in c)]
        for order in (positive, sorted(positive, key=len, reverse=True)):
            demands, used = [], set()
            for c in order:
                if not used.intersection(c):
                    demands.append(c)
                    used.update(c)
            edges = [sorted({res_of[v] for v in c}) for c in demands]
            owner, assigned = {}, {}
            failed = None
            for root in range(len(demands)):
                queue, left_seen, right_seen, parent = deque([root]), {root}, set(), {}
                free = None
                while queue and free is None:
                    left = queue.popleft()
                    for r in edges[left]:
                        stats["matching_edge_visits"] = stats.get("matching_edge_visits", 0) + 1
                        if r in right_seen:
                            continue
                        right_seen.add(r)
                        parent[r] = left
                        if r not in owner:
                            free = r
                            break
                        if owner[r] not in left_seen:
                            left_seen.add(owner[r])
                            queue.append(owner[r])
                if free is None:
                    failed = (left_seen, right_seen)
                    break
                while True:
                    left = parent[free]
                    prev = assigned.get(left)
                    assigned[left] = free
                    owner[free] = left
                    if prev is None:
                        break
                    free = prev
            if failed:
                ls, rs = failed
                return None, {"kind": "Hall deficiency", "polarity": sign,
                              "demands": [[sign * x for x in demands[d]] for d in sorted(ls)],
                              "resources": [resources[r] for r in sorted(rs)]}
            if candidate is None:
                true = {next(v for v in demands[d] if res_of[v] == r) for d, r in assigned.items()}
                candidate = {sign * (v if v in true else -v) for v in variables}
    return candidate, None


# ---------------------------------------------------------- renamable Horn

def renamable_horn(clauses, variables):
    """If some flip of variables makes every clause Horn, return a model.

    Requires a clause set with no unit clauses and no conflict under unit
    propagation (true after step 3). Returns a model or None.
    """
    two = []
    for c in clauses:
        pos = [-abs(x) if x > 0 else abs(x) for x in c]   # literal "x is positive after flip"
        for i in range(len(pos)):
            for j in range(i + 1, len(pos)):
                two.append((-pos[i], -pos[j]))
    flip, _ = scc_2sat(two, variables) if two else ({-v for v in variables}, None)
    if flip is None:
        return None
    # Set every variable so that its renamed-positive literal is false.
    return {v if v in flip else -v for v in variables}


# ------------------------------------------------------------- probing

def probe(engine, stats):
    """Failed literals and both-branch implications to a fixpoint.

    Returns False if the formula is proved UNSAT. At most n changing rounds,
    each 2n probes of one propagation: polynomial.
    """
    n = engine.n
    changed = True
    while changed:
        changed = False
        stats["probe_rounds"] = stats.get("probe_rounds", 0) + 1
        for v in range(1, n + 1):
            if engine.val[v]:
                continue
            implied = {}
            for lit in (v, -v):
                engine.new_level()
                engine.enqueue(lit, None)
                confl = engine.propagate()
                implied[lit] = None if confl is not None else set(engine.trail[engine.lim[0]:])
                engine.backtrack(0)
                stats["probes"] = stats.get("probes", 0) + 1
                if confl is not None:
                    engine.enqueue(-lit, None)
                    if engine.propagate() is not None:
                        return False
                    changed = True
                    break
            else:
                both = (implied[v] & implied[-v]) - {v, -v}
                for x in both:
                    if not engine.enqueue(x, None):
                        return False
                if both:
                    if engine.propagate() is not None:
                        return False
                    changed = True
    return True


# --------------------------------------------------------- local search

def walksat(clauses, variables, budget, seed=1, noise=0.5):
    """WalkSAT with incremental break counts; at most `budget` flips."""
    if not clauses:
        return set()
    rng = random.Random(seed)
    val = {v: rng.random() < 0.5 for v in variables}
    occ = defaultdict(list)
    for ci, c in enumerate(clauses):
        for x in c:
            occ[x].append(ci)
    tc = [0] * len(clauses)                # true literals per clause
    ts = [0] * len(clauses)                # sum of their variables
    brk = defaultdict(int)                 # clauses that need v as sole true literal
    unsat, where = [], {}
    for ci, c in enumerate(clauses):
        for x in c:
            if val[abs(x)] == (x > 0):
                tc[ci] += 1
                ts[ci] += abs(x)
        if tc[ci] == 0:
            where[ci] = len(unsat)
            unsat.append(ci)
        elif tc[ci] == 1:
            brk[ts[ci]] += 1
    for _ in range(budget):
        if not unsat:
            return {v if val[v] else -v for v in variables}
        c = clauses[unsat[rng.randrange(len(unsat))]]
        best = min(brk[abs(x)] for x in c)
        if best and rng.random() < noise:
            v = abs(rng.choice(c))
        else:
            v = abs(rng.choice([x for x in c if brk[abs(x)] == best]))
        old = v if val[v] else -v
        val[v] = not val[v]
        for ci in occ[old]:                # these lose a true literal
            tc[ci] -= 1
            ts[ci] -= v
            if tc[ci] == 0:
                brk[v] -= 1
                where[ci] = len(unsat)
                unsat.append(ci)
            elif tc[ci] == 1:
                brk[ts[ci]] += 1
        for ci in occ[-old]:               # these gain one
            tc[ci] += 1
            ts[ci] += v
            if tc[ci] == 1:
                brk[v] += 1
                i = where.pop(ci)
                last = unsat.pop()
                if last != ci:
                    unsat[i] = last
                    where[last] = i
            elif tc[ci] == 2:
                brk[ts[ci] - v] -= 1
    return None


# --------------------------------------------- bounded variable elimination

def eliminate(clauses, grow, stats):
    """Davis-Putnam elimination, only where it keeps the formula small.

    A variable x is eliminated by replacing every clause with x or !x by all
    their non-tautological resolvents, but only if that adds at most `grow`
    clauses. So at most n eliminations happen and at most m + grow*n clauses
    ever exist: polynomial. Returns (remaining clauses, stack, empty_clause).
    The result is satisfiable exactly when the input is.
    """
    cls = {frozenset(c) for c in clauses}
    occ = defaultdict(set)
    for c in cls:
        for x in c:
            occ[x].add(c)
    stack = []
    progress = True
    while progress:
        progress = False
        live = sorted({abs(x) for c in cls for x in c},
                      key=lambda v: (len(occ[v]) * len(occ[-v]), v))
        for v in live:
            pos, neg = occ[v], occ[-v]
            if not pos and not neg:
                continue
            limit = len(pos) + len(neg) + grow
            out, ok = set(), True
            for a in pos:
                for b in neg:
                    r = (a | b) - {v, -v}
                    if any(-x in r for x in r):
                        continue
                    out.add(r)
                    if len(out) > limit:
                        ok = False
                        break
                if not ok:
                    break
            if not ok:
                continue
            stats["eliminated"] = stats.get("eliminated", 0) + 1
            if frozenset() in out:
                return None, stack, True
            old = pos | neg
            stack.append((v, list(old)))
            for c in old:
                cls.discard(c)
                for x in c:
                    occ[x].discard(c)
            for r in out:
                if r not in cls:
                    cls.add(r)
                    for x in r:
                        occ[x].add(r)
            progress = True
    return [tuple(c) for c in cls], stack, False


def reconstruct(stack, model):
    """Extend a model of the remaining clauses to the eliminated variables."""
    val = {abs(x): x > 0 for x in model}
    for v, cls in reversed(stack):
        need = False
        for c in cls:
            if v in c and not any(val.get(abs(x), False) == (x > 0) for x in c if x != v):
                need = True
                break
        val[v] = need
    return {v if t else -v for v, t in val.items()}


# ---------------------------------------------------------------- CDCL

def cdcl(engine, stats):
    """Complete search. Exponential in the worst case."""
    n = engine.n
    act = [0.0] * (n + 1)
    inc = 1.0
    phase = [False] * (n + 1)
    heap = [(0.0, v) for v in range(1, n + 1)]
    heapq.heapify(heap)

    def luby(i):
        k = 1
        while (1 << k) - 1 < i:
            k += 1
        while (1 << k) - 1 != i:
            i -= (1 << (k - 1)) - 1
            k = 1
            while (1 << k) - 1 < i:
                k += 1
        return 1 << (k - 1)

    restart, conflicts_left = 1, 100 * luby(1)
    while True:
        confl = engine.propagate()
        if confl is not None:
            stats["conflicts"] = stats.get("conflicts", 0) + 1
            if not engine.lim:
                return False
            learnt, seen, counter, p = [None], set(), 0, None
            idx, cur = len(engine.trail) - 1, len(engine.lim)
            clause = engine.clauses[confl]
            while True:
                for q in (clause if p is None else clause[1:]):
                    v = abs(q)
                    if v in seen or engine.level[v] == 0:
                        continue
                    seen.add(v)
                    act[v] += inc
                    heapq.heappush(heap, (-act[v], v))
                    if engine.level[v] == cur:
                        counter += 1
                    else:
                        learnt.append(q)
                while abs(engine.trail[idx]) not in seen:
                    idx -= 1
                p = engine.trail[idx]
                idx -= 1
                counter -= 1
                if counter == 0:
                    break
                clause = engine.clauses[engine.reason[abs(p)]]
            learnt[0] = -p
            inc *= 1.05
            if len(learnt) == 1:
                engine.backtrack(0)
                engine.enqueue(learnt[0], None)
            else:
                j = max(range(1, len(learnt)), key=lambda k: engine.level[abs(learnt[k])])
                learnt[1], learnt[j] = learnt[j], learnt[1]
                engine.backtrack(engine.level[abs(learnt[1])])
                ci = engine.add_clause(learnt)
                engine.enqueue(learnt[0], ci)
            conflicts_left -= 1
            continue
        if conflicts_left <= 0:
            restart += 1
            conflicts_left = 100 * luby(restart)
            engine.backtrack(0)
            continue
        v = 0
        while heap:
            _, cand = heapq.heappop(heap)
            if not engine.val[cand]:
                v = cand
                break
        if not v:
            v = next((u for u in range(1, n + 1) if not engine.val[u]), 0)
            if not v:
                return True
        for lit in engine.trail[engine.lim[0] if engine.lim else 0:]:
            phase[abs(lit)] = lit > 0
        heapq.heappush(heap, (-act[v], v))
        engine.new_level()
        engine.enqueue(v if phase[v] else -v, None)


# ------------------------------------------------------------------ solve

def solve(clauses, complete=False, search_budget=None, seed=1, grow=None):
    norm, back = normalize(clauses)
    n = len(back) - 1
    stats = {"variables": n, "clauses": len(norm), "literals": sum(map(len, norm))}

    def finish(status, reason, model=None, cert=None):
        r = Result(status, reason, model, cert, stats)
        if status == "SAT":
            model = set(model)
            for v in range(1, n + 1):          # free variables: pick false
                if v not in model and -v not in model:
                    model.add(-v)
            assert covers(norm, model), "internal error: model check failed"
            r.pattern = tuple(back[abs(x)] * (1 if x > 0 else -1)
                              for x in sorted(minimal_pattern(norm, model),
                                              key=lambda l: (abs(l), l < 0)))
            r.model = model
        r.normalized = norm
        return r

    if any(len(c) == 0 for c in norm):
        return finish("UNSAT", "empty clause")
    if not norm:
        return finish("SAT", "no clauses", set())

    # 3. unit propagation (nothing to do without unit clauses)
    if any(len(c) == 1 for c in norm):
        eng = Engine(n, norm)
        if not eng.ok or eng.propagate() is not None:
            return finish("UNSAT", "unit propagation contradiction")
        stats["propagations"] = eng.props
        base, base_fixed = eng.residual(), eng.fixed()
    else:
        eng, base, base_fixed = None, norm, set()

    def rules(res, stats, horn=True):
        """Steps 4-7 on a clause set: (status, reason, model, cert) or None."""
        if not res:
            return "SAT", "", set(), None
        vs = sorted({abs(x) for c in res for x in c})
        if len(res) == 2:                                   # 4. two clauses
            a, b = res
            pick = next(iter(set(a) & set(b)), None)
            if pick:
                return "SAT", "two clauses: common literal", {pick}, None
            for x in a:
                for y in b:
                    if x != -y:
                        return "SAT", "two clauses: compatible pair", {x, y}, None
        if all(len(c) <= 2 for c in res):                   # 5. 2-SAT
            model, bad = scc_2sat(res, vs)
            if model is None:
                return ("UNSAT", "2-SAT: x and !x in one implication cycle", None,
                        {"variable": back[bad]})
            return "SAT", "2-SAT", model, None
        cand, cert = counting(res, stats)                   # 6. counting
        if cert is not None:
            return "UNSAT", "counting: more demands than resources (Hall)", None, cert
        if cand is not None and covers(res, cand):
            return "SAT", "counting: matching candidate", cand, None
        if not horn:
            return None
        model = renamable_horn(res, vs)                     # 7. renamable Horn
        if model is not None and covers(res, model):
            return "SAT", "renamable Horn", model, None
        return None

    def apply(out, fixed, tag, stack=()):
        status, reason, model, cert = out
        reason = (reason or "unit propagation") + tag
        if status == "UNSAT":
            if cert is not None:
                cert = dict(cert, unit_literals=sorted(fixed, key=abs))
            return finish("UNSAT", reason, cert=cert)
        return finish("SAT", reason, fixed | reconstruct(stack, model))

    out = rules(base, stats, horn=False)
    if out:
        return apply(out, base_fixed, "")
    # parity (on the input clauses, so certificates name input clauses)
    pmodel, pcert = parity_solve(norm, stats)
    if pcert is not None:
        return finish("UNSAT", "parity equations combine to 0 = 1", cert=pcert)
    if pmodel is not None and covers(norm, pmodel):
        return finish("SAT", "parity solution", pmodel)
    out = rules(base, stats)
    if out:
        return apply(out, base_fixed, "")
    if eng is None:
        eng = Engine(n, norm)
        eng.propagate()
    # 8. probing
    if not probe(eng, stats):
        return finish("UNSAT", "failed-literal probing contradiction")
    out = rules(eng.residual(), stats)
    if out:
        return apply(out, eng.fixed(), " after probing")
    # 9. bounded variable elimination (allowance is a constant: <= 128)
    if grow is None:
        grow = 128 if n <= 50 else 8
    fixed = eng.fixed()
    rest, stack, empty = eliminate(eng.residual(), grow, stats)
    if empty:
        return finish("UNSAT", "variable elimination derived the empty clause")
    out = rules(rest, stats)
    if out:
        return apply(out, fixed, " after variable elimination", stack)
    # 10. local search with a polynomial flip budget
    vs = sorted({abs(x) for c in rest for x in c})
    budget = search_budget if search_budget is not None else 50 * stats["literals"]
    stats["flip_budget"] = budget
    model = walksat(rest, vs, budget, seed)
    if model is not None:
        return finish("SAT", "local search (verified)", fixed | reconstruct(stack, model))
    if not complete:
        return finish("UNKNOWN", "polynomial rules do not decide this formula")
    # optional complete search
    if cdcl(eng, stats):
        return finish("SAT", "complete search (CDCL, exponential worst case)", eng.fixed())
    return finish("UNSAT", "complete search (CDCL, exponential worst case)")


# ------------------------------------------------------------------ input

def parse_formula(text):
    """'(a or not b) and (b or c)'; also | & ! ~."""
    names, clauses = {}, []
    for part in re.split(r"\band\b|&", text):
        part = part.strip().strip("()").strip()
        if not part:
            raise ValueError("empty clause in formula")
        clause = []
        for tok in re.split(r"\bor\b|\|", part):
            tok = tok.strip().strip("()").strip()
            neg = False
            while True:
                if tok.startswith(("!", "~")):
                    neg, tok = not neg, tok[1:].strip()
                elif re.match(r"not\b", tok):
                    neg, tok = not neg, tok[3:].strip()
                else:
                    break
            if not re.fullmatch(r"[A-Za-z_]\w*", tok):
                raise ValueError(f"bad literal: {tok!r}")
            v = names.setdefault(tok, len(names) + 1)
            clause.append(-v if neg else v)
        clauses.append(clause)
    return clauses, {v: k for k, v in names.items()}


def parse_dimacs(text):
    clauses, cur = [], []
    for line in text.splitlines():
        line = line.strip()
        if not line or line[0] in "cp%":
            continue
        for tok in line.split():
            x = int(tok)
            if x == 0:
                clauses.append(cur)
                cur = []
            else:
                cur.append(x)
    if cur:
        clauses.append(cur)
    return clauses, {}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("formula", nargs="?")
    ap.add_argument("--dimacs")
    ap.add_argument("--complete", action="store_true",
                    help="add CDCL search: decides everything, exponential worst case")
    args = ap.parse_args()
    if bool(args.formula) == bool(args.dimacs):
        ap.error("give a formula or --dimacs FILE")
    if args.dimacs:
        with open(args.dimacs) as fh:
            clauses, names = parse_dimacs(fh.read())
    else:
        clauses, names = parse_formula(args.formula)
    r = solve(clauses, complete=args.complete)
    nm = lambda x: ("!" if x < 0 else "") + names.get(abs(x), f"x{abs(x)}")
    out = {"status": r.status, "reason": r.reason,
           "pattern": "(" + ", ".join(nm(x) for x in r.pattern) + ")" if r.status == "SAT" else None,
           "certificate": r.certificate, "stats": r.stats}
    print(json.dumps(out, indent=2, default=list))


if __name__ == "__main__":
    main()
