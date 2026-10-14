# Resume notes: polynomial-time SAT with the four-step method

Everything needed to pick this work up later: the goal, the method, the
data structure, what was built and measured, and exactly what still has to
be found for the method to work.

Code: `sat-solver/` on branch `ccr-01d13eda-ajczw9` of `exec0x00/blank`.
Python 3, no dependencies.

---

## 1. The goal

Build a SAT solver that runs in **polynomial time**, meaning time like
(number of clauses) × (number of literals), or some fixed power of the
input size, never exponential. Requirements:

1. **Use the four-step method** (section 2) to find which literals go
   together.
2. **Skip variables that can be anything.** A solution pattern lists only
   the literals it needs; every other variable is free.
3. **Store results in a data structure, without expanding them.** Use a
   dictionary of literal positions (`a`, `!a`, …) or something better.
   Finding the literals (common, first-only, second-only, opposite) is the
   only work done; adding them to the structure should cost almost
   nothing.
4. **The structure should become the solution.** Reading a solution out
   of it may take some computation, as long as that is **not exponential**.
5. **Output format:** nested AND / choice structure, e.g.
   `(a, [!b, (c, g)], d)` (section 3).

---

## 2. The four-step method (two clauses)

Example: `(a or not b or c or d) and (a or b or d or e)`

| step | rule | example |
|---|---|---|
| 1. Common | literals in both clauses; any one of them satisfies both | `a`, `d` → patterns `(a)`, `(d)` |
| 2. First-only × second-only | ignore common literals and opposite pairs; take one literal from each side | first-only `c`, second-only `e` → `(c and e)` |
| 3. First-only × clause 2's opposite literal | | `c` with `b` → `(c and b)` |
| 4. Second-only × clause 1's opposite literal | | `e` with `!b` → `(e and !b)` |
| (dropped) | the opposite pair itself | `!b` with `b` is impossible |

Result: `(a) or (d) or (c and e) or (c and b) or (e and !b)`.

This is **correct and complete for two clauses**: it lists every minimal
way to satisfy both. Brute force confirmed it on thousands of random cases.

---

## 3. Output notation

| notation | meaning |
|---|---|
| `a` | a must be 1 |
| `!b` | b must be 0 |
| `( … )` | AND: every element must hold |
| `[ … ]` | choice: pick any one element |
| `N1 = …` | a shared part, written once and referred to by name (makes it a graph) |

Variables missing from a chosen path can be anything. A valid structure
never has `x` and `!x`, or the same variable twice, on one path.

Example: `(a, [!b, (c, g)], d)` means a = 1, d = 1, and either b = 0 or
(c = 1 and g = 1).
The example formula: `[a, d, (b, c), (!b, e)]`.

---

## 4. The current data structure (position structure)

This is the latest version (`pairs.py`), combining everything above.

**Positions.** Every literal occurrence gets a position
`(clause number, literal number)`.

```
clause 1: 1:a  2:!b  3:c  4:d
clause 2: 1:a  2:b   3:d  4:e
```

**Dictionary.** Literal → every position where it appears.

```
a  -> (1,1), (2,1)        b  -> (2,2)        !b -> (1,2)
c  -> (1,3)               d  -> (1,4), (2,3) e  -> (2,4)
```

**Pair table.** For **every pair of clauses** (i, j), the four steps,
found by dictionary lookups:

```
clauses 1 & 2:  common: a, d   first-only: c   second-only: e   opposite: !b
```

**Opposite links.** Position ↔ positions holding the opposite literal:
`(1,2) <-> (2,2)` (that is, `!b` ↔ `b`).

**What a solution is.** Choose **one position per clause** so that no two
chosen positions are opposite-linked. The chosen literals form the
solution pattern; every other variable is free.

**Cost to build:** about (clauses)² × (literals per clause). That is
polynomial, and the benchmarks confirm it (under 0.5 s for every hard
formula tested).

---

## 5. What was built and measured

Benchmark formula families:

- **chain** `(x1 or y1) and … and (xn or yn)`: easy, but has 2ⁿ flat patterns.
- **random 3-SAT** with 4.26 clauses per variable: the hardest random region.
- **pigeonhole**, n+1 pigeons and n holes: always unsatisfiable, a famous hard case.

| file | method | result |
|---|---|---|
| `patterns.py` | nested `( … )` / `[ … ]` graph: split on most-common literal, independent parts joined by AND, shared parts reused | chain linear (5000 pairs in 0.13 s); random 3-SAT about ×3 work per +20 variables; pigeonhole about ×3 per extra hole |
| `indexed.py` | flat pattern list + literal-position dictionary, one clause at a time with the four steps | chain exactly 2ⁿ patterns; pigeonhole exactly (n+1)ⁿ |
| `fourstep.py` | four steps joining whole pattern lists, tournament order | chain 2ⁿ (65,536 at n = 16); pigeonhole n = 5 did not finish in 9 min |
| `positions.py` | patterns stored only as positions + opposite links; back-tracking read-out | build polynomial; read-out pigeonhole 179 → 8,262 → over 2,000,000 steps |
| `pairs.py` | **four steps on every pair**, stored by position (section 4) | build polynomial; direct read-out (no going back) stuck on every hard formula |
| `readout.py` | **polynomial read-outs** of the pair structure (below) | never proved UNSAT; often stuck on SAT formulas |

Polynomial read-outs tried (`readout.py`; neither ever undoes a choice):

| read-out | random 3-SAT, 12 variables | pigeonhole (really UNSAT) |
|---|---|---|
| **propagate**: remove a position if it is opposite to every position of some other clause; repeat; then pick and repeat | right on 74 of 300 (all SAT ones); stuck on 226 | stuck on n = 3, 4, 5, 6 |
| **probe**: also try each position alone and remove it if propagation empties a clause | right on 26 of 40; stuck on 14 | stuck on n = 3, 4 |

Tests: `python3 test_patterns.py` (and the inline checks used for each
file) compare against brute force on thousands of random formulas. Every
method gives correct answers; the only problem is speed (or "stuck").

---

## 6. Why it blows up (what was learned)

1. **Patterns multiply, they don't add.** Joining a clause with k literals
   can turn each pattern into k patterns. The chain has 2ⁿ minimal
   patterns, and none of their literals is free, so skipping free
   variables can't shrink a flat list.
2. **Nested structures help only when parts are independent.** A clause
   like `(!x1 or !x2)` ties two parts together and forces a split.
3. **The position structure is cheap, but reading it is the hard part.**
   "One position per clause, no opposite links" is exactly the
   **independent set** problem from Karp's 1972 NP-completeness proof.
4. **Pair information is not enough.** In
   `(a) and (b) and (not a or not b)` every pair of clauses has a
   pattern, but the whole formula has none. The conflict involves three
   clauses at once, and checking only pairs (or any fixed small group)
   misses conflicts like this.
5. **The read-out is where all the difficulty goes.** The structure is
   built from the formula in polynomial time, and the formula can be
   rebuilt from it. So a polynomial read-out would be a polynomial SAT
   algorithm, which would prove **P = NP**.

Known results any successful method has to get around:

- **CNF → flat patterns (DNF)** can need 2ⁿ terms; the chain formula proves it.
- **Haken (1985):** pigeonhole formulas need exponentially long
  *resolution* proofs. The four steps are closely related to resolution
  (from `(c or !b)` and `(e or b)` they derive `(c and e)`, the same
  thing resolution derives), so methods built only from clause-combining
  steps like these run into the same limit on pigeonhole.
- **Bova, Capelli, Mengel, Slivovsky (2016):** some CNF formulas have
  **no** polynomial-size nested (DNNF) structure at all.
- **Checking fixed-size groups of clauses** (pairs, triples, … k at a
  time) corresponds to bounded-width resolution (Atserias and Dalmau,
  2008), and pigeonhole needs width that grows with n. A read-out that
  only looks at groups of a fixed size fails on pigeonhole.

---

## 7. What must be found to solve it this way

The build is done and is polynomial. The **one missing piece** is:

> **A read-out rule R** that takes the position structure (section 4)
> and, in polynomial time, either returns one position per clause with no
> opposite links, or correctly says no such choice exists.

R must pass all of these:

1. **The three-clause trap.** `(a) and (b) and (not a or not b)` → UNSAT.
2. **No-going-back trap.**
   `(a or b) and (not a or c) and (not c or not b) and (a or not c) and (not a or b)`
   → SAT with `!a, b, !c`, without guessing and undoing.
3. **Pigeonhole.** Says UNSAT for n = 5, 6, 8, 10, … with step counts
   that grow like a fixed power of n (for example n³ or n⁴), **not**
   ×3 per extra hole.
4. **Random 3-SAT at 4.26.** Correct on every formula (check small ones
   against brute force), with step counts that grow polynomially for
   n = 50, 100, 200, 400.
5. **Not only resolution or fixed-size groups.** By section 6, a rule
   built only from the four steps on pairs or triples, or from more
   rounds of combining clauses, is expected to fail item 3; every such
   rule measured here did. R needs an
   ingredient that is **not** "combine clauses the four-step way".
   Examples of directions people explore: counting arguments, algebra
   over numbers instead of true/false, geometry (linear programming
   relaxations). Each of these is also known to fail on some formulas,
   so any new idea should be tested on pigeonhole first.
6. **A proof, not just benchmarks.** Passing tests is evidence; a claim
   of polynomial time needs a proof that the step count is bounded by a
   polynomial for **every** formula.

Honest context: a rule passing all six would prove P = NP. Most
researchers believe no such rule exists, but it has never been proved
either way. Item 3 is the quickest way to test a new idea: almost every
attempt fails it.

---

## 8. How to resume

```
git checkout ccr-01d13eda-ajczw9
cd sat-solver

python3 patterns.py "(a or not b or c or d) and (a or b or d or e)"   # nested output
python3 pairs.py    "(a or not b or c or d) and (a or b or d or e)"   # pair table + read-out
python3 pairs.py --bench        # build time and read-out cost on all families
python3 readout.py              # polynomial read-outs: correctness on random + pigeonhole
python3 test_patterns.py        # brute-force correctness check
```

To try a new read-out rule:

1. Add a function `my_step(options, bad, chosen)` to `readout.py` with
   the same shape as `propagate`. `options` maps clause → positions still
   allowed, `bad` maps position → its opposite positions, and `chosen`
   holds the picks made so far. Return the reduced `options`, or `None`
   if some clause has no position left.
2. Add `("mine", my_step)` to the list in `main()`.
3. Run `python3 readout.py`. You want "right on all" for random formulas
   and "UNSAT" for every pigeonhole, with run time growing slowly.
4. Then go up to bigger n with `pigeonhole(n)` from `bench.py`.

Input formats: `"(a or not b) and (b or c)"` (also `| & ! ~`) for every
script; `patterns.py` and `indexed.py` also read a DIMACS `.cnf` file.
