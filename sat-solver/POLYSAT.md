# polysat.py: polynomial SAT read-out, plus an optional complete mode

`polysat.py` is a self-contained rewrite of the uploaded `readout.py` (Python 3,
no dependencies). The output format and command line match that solver.

- **Default mode is polynomial.** Every rule has a polynomial bound, and no
  rule ever goes back on a choice. The answer is SAT (with a verified,
  inclusion-minimal pattern), UNSAT (with a certificate where one exists), or
  UNKNOWN.
- **`--complete`** adds a CDCL search (learning, restarts, activity order)
  after the polynomial rules. It always answers SAT or UNSAT, but its worst
  case is exponential. It's labelled as such in the output.

```sh
python3 polysat.py "(a or not b or c or d) and (a or b or d or e)"
python3 polysat.py --dimacs input.cnf
python3 polysat.py --complete --dimacs input.cnf
python3 -m unittest -v test_polysat              # brute-force checks
python3 compare.py PATH/TO/UPLOAD/sat-solver     # head-to-head with readout.py
```

## Rules and their bounds

n variables, m clauses, N literal occurrences, k clause length.

| # | rule | decides | bound |
|---|---|---|---|
| 1 | normalize (duplicates, tautologies) | — | O(N log N) |
| 2 | unit propagation, watched literals | unit chains, UP conflicts | O(N) |
| 3 | two clauses: common literal or compatible pair (the corrected four-step rule) | any 2-clause formula | O(N²) |
| 4 | 2-SAT by strongly connected components | every 2-SAT formula | O(n + m) |
| 5 | counting: disjoint demands vs at-most-one cliques, Hall's theorem; **both polarities, two demand orders** | pigeonhole-shaped UNSAT | O(nN + m²) |
| 6 | parity: complete XOR blocks, Gaussian elimination over GF(2), checkable certificate | XOR / Tseitin formulas | O(q·n) row operations |
| 7 | renamable Horn: 2-SAT on "flip" variables | Horn, anti-Horn, renamable Horn | O(Σ k²) |
| 8 | probing: failed literals + literals implied by both branches, to a fixpoint | many UNSAT and forced cases | ≤ n rounds × 2n probes × O(N) |
| 9 | bounded variable elimination (Davis–Putnam), only while each step adds ≤ `grow` clauses (128 if n ≤ 50, else 8) | whenever every variable can be eliminated | ≤ n steps, ≤ m + 128n clauses |
| 10 | WalkSAT local search, 50·N flips | satisfiable formulas it finds | O(N²) |

Rules 3–7 run again after probing and after elimination. A SAT answer is
always checked against every input clause before it is returned. An UNSAT
answer comes from a sound rule:

- conflict under unit propagation
- an implication cycle containing x and !x (2-SAT)
- a Hall deficiency (counting)
- 0 = 1 over GF(2) (parity)
- a failed literal on both sides (probing)
- an empty resolvent (elimination)

## Correctness checks

`test_polysat.py`: 3000 random formulas in polynomial mode and 3000 in
complete mode are checked against brute force. Every SAT pattern is checked
to satisfy the input, and every parity certificate is verified independently.
Complete mode never returned UNKNOWN. It also covers your examples, the
pigeonhole variants that broke the upload, and edge cases. All tests pass.

## Head-to-head with the uploaded `readout.py`

Same inputs, same machine, both in Python (`compare.py`).

| formula | upload | time | polysat | time |
|---|---|---:|---|---:|
| 2000 random small formulas | 920 SAT, 280 UNSAT, **800 UNKNOWN** | 0.34 s | 1670 SAT, 326 UNSAT, **4 UNKNOWN** | 2.8 s |
| … only the ones the upload decides | | 0.16 s | | **0.13 s** |
| pigeonhole n = 20 | UNSAT | 0.015 s | UNSAT | 0.016 s |
| pigeonhole n = 6, variables flipped | **UNKNOWN** | | **UNSAT** | 0.001 s |
| pigeonhole n = 6 + clause (x1 or x7) | **UNKNOWN** | | **UNSAT** | 0.001 s |
| random 3-SAT 4.26, n = 50/100/200, 9 formulas | 9 UNKNOWN | ≤ 0.01 s | 6 SAT, 3 UNKNOWN | ≤ 1 s |
| random 3-SAT 3.8, n = 100, 200 | 2 UNKNOWN | | 2 SAT | ≤ 0.07 s |
| random 2-SAT, 20,000 variables | SAT | **119 s** | SAT | **0.29 s** |
| Tseitin parity, 100,000 vertices (150k variables, 400k clauses) | UNSAT | 4.3 s | UNSAT | 4.1 s |

On every formula the upload decides, polysat gives the same answer in equal
or less time. The extra total time on the small batch is spent on the 800
formulas the upload gives up on; polysat decides 796 of them.

## Exploration: where UNKNOWN is left, and why

1. **What's still UNKNOWN is only UNSAT random 3-SAT near the threshold.**
   Every UNKNOWN case in the comparison was confirmed UNSAT by `--complete`
   (n = 100: 461 conflicts, 0.5 s; n = 200: 14,586 and 22,138 conflicts,
   18 s and 44 s). All the satisfiable ones were decided.
2. **More elimination allowance helps small formulas, but not these.**

   | grow | small batch UNKNOWN | random 3-SAT 4.26 UNKNOWN (n = 50/100/200) |
   |---|---|---|
   | 0 | 40 | 1 / 4 / 4 |
   | 8 | 24 | 1 / 4 / 4 |
   | 32 | 14 | 1 / 4 / 4 |
   | 128 | 4 | 1 / 4 / 4 |

   On random 3-SAT, eliminating any variable adds far more than 128
   clauses, so this rule stops early however large the constant is.
3. **Why this is the real frontier.** Chvátal and Szemerédi (1988) proved
   that UNSAT random 3-SAT at constant density needs exponentially long
   *resolution* proofs. Elimination, probing, unit propagation and the
   four-step products are all resolution-style steps, so no amount of
   tuning them closes this case. A rule that does must reason in a
   different way.
4. **Directions not yet tried here.** Each needs a new kind of reasoning:
   - Spectral or semidefinite refutation (Feige–Ofek style). Known to work
     on random 3-SAT, but only at much higher clause density (about
     n^1.5 clauses).
   - Algebraic proofs over larger fields (polynomial calculus). Rule 6 is
     the linear piece of this.
   - Cutting planes, meaning counting with general inequalities. Rule 5 is
     a special case.

   Each of these is known to fail on some other family, so a candidate
   should be measured on all the families above with `compare.py`.

## What changed relative to the upload

- **Counting** tries both polarities and two demand orders. The upload
  checked only all-positive demands in input order, so renaming variables
  or adding one extra clause broke it.
- **New rules:** renamable Horn, probing, bounded elimination with model
  reconstruction, and local search.
- **Faster 2-SAT and propagation:** linear-time Tarjan SCC and
  watched-literal propagation. The upload's repeated full scans took 119 s
  on a 20,000-variable 2-SAT formula.
- **Order:** cheap rules run first. Parity runs after the cheap checks,
  before renamable Horn. Counting is skipped when it can't refute (no
  "not both" pairs), but its O(N) candidate model is still tried.
- **Optional `--complete` CDCL**, so every formula can be decided when
  polynomial time isn't required.
