# Solution-pattern SAT solver

Builds every solution of a CNF formula as a nested structure:

| notation  | meaning                          |
|-----------|----------------------------------|
| `a`       | a must be 1                      |
| `!b`      | b must be 0                      |
| `( … )`   | AND: every element must hold     |
| `[ … ]`   | choice: pick any one element     |

Variables missing from a chosen path can take any value. Shared
sub-structures are printed once as `N1 = …` (the structure is a graph).
No path ever uses a variable twice, so no path contains both `x` and `!x`.

```
$ python3 patterns.py "(a or not b or c or d) and (a or b or d or e)"
[a, d, (b, c), (!b, e)]
```

The method generalizes the two-clause rules (common literals, first-only and
second-only literals, opposite pairs) to any number of clauses; see the
docstring at the top of `patterns.py`.

- `python3 patterns.py "<formula>"` or `python3 patterns.py file.cnf` (DIMACS)
- `python3 test_patterns.py` checks 3000 random formulas against brute force
- `python3 bench.py` measures how the work grows with formula size

## Measured growth

"Steps" = distinct sub-formulas solved (the real amount of work).

| formula family                          | growth                                      |
|-----------------------------------------|---------------------------------------------|
| chain `(x1∨y1)∧…∧(xn∨yn)`               | linear: n=5000 in 0.13 s                    |
| random 3-SAT, 4.26 clauses/var (median of 5) | n=40: 121, 60: 687, 80: 1840, 100: 5433, 120: 16735 steps, about ×3 per +20 variables |
| pigeonhole, n+1 pigeons / n holes       | n=4: 96, 5: 361, 6: 1163, 7: 3398, 8: 9306 steps, about ×3 per extra hole |

The work grows by a constant factor per fixed increase in n, which is
exponential, not polynomial, on the hard families.

## Second method: clause by clause with a position dictionary (`indexed.py`)

Start with the first clause as the solution (one pattern per literal) and
keep a dictionary `literal -> pattern positions`. For each next clause,
dictionary lookups find the patterns that already contain one of its
literals (common, kept as is) and those holding the opposite literal
(opposite pairs, can't take that literal); every other pattern is extended
with each allowed literal. Patterns that contain a smaller pattern are
dropped.

```
$ python3 indexed.py "(a or not b or c or d) and (a or b or d or e)"
patterns:  3: (a)  4: (d)  6: (b, c)  7: (c, e)  8: (!b, e)
dictionary:  a -> [3]  b -> [6]  !b -> [8]  c -> [6, 7]  d -> [4]  e -> [7, 8]
```

The dictionary makes each lookup fast, but the number of patterns still
grows exponentially (`python3 bench_indexed.py`, peak patterns kept):

| formula family        | peak patterns                                        |
|-----------------------|------------------------------------------------------|
| chain, n pairs        | 16, 64, 256, 1024, 4096 for n = 4…12: exactly 2^n    |
| random 3-SAT          | 32, 108, 953, 3203 for n = 10, 15, 20, 25            |
| pigeonhole, n holes   | 9, 64, 625, 7776 for n = 2…5: exactly (n+1)^n        |

## Third method: patterns stored only as positions (`positions.py`)

A position is (clause, literal number). A pattern is one position per
clause, so all patterns are stored implicitly by a dictionary
`literal -> positions` plus conflict edges between positions holding `x`
and `!x`. Building this takes polynomial size (the "build size" column).
The work moves into choosing one position per clause with no conflict edge
between any two choices (`python3 positions.py --bench`):

| formula family      | search steps                                       |
|---------------------|----------------------------------------------------|
| chain, n pairs      | n (linear)                                         |
| pigeonhole, n holes | 179, 8262, > 2,000,000 for n = 3, 4, 5             |
| random 3-SAT        | 97, 4898, 220759, 13594, 122882 for n = 20…60      |

## Fourth method: the four steps on whole groups (`fourstep.py`)

The four steps (common, first-only x second-only, opposite-pair
combinations, drop x/!x pairs) join two pattern lists. Clauses are joined
in pairs like a tournament until one list is left.

```
$ python3 fourstep.py "(a or not b or c or d) and (a or b or d or e)"
  common: (a), (d)
  joined: (!b and e), (b and c), (c and e)
result: (a) or (d) or (b and c) or (c and e) or (!b and e)
```

Peak patterns (`python3 fourstep.py --bench`): chain 16, 256, 4096, 65536
for n = 4, 8, 12, 16 (2^n; n = 16 took 321 s); pigeonhole 4, 126, 2816 for
n = 2, 3, 4, and n = 5 did not finish in 9 minutes.

## Fifth method: four steps on every pair, stored by position (`pairs.py`)

For every pair of clauses the four steps (common, first-only, second-only,
opposite) are found with the dictionary and stored. The build is
polynomial: about clauses^2 x literals per clause. Reading a full solution
out of the stored pairs means picking one position per clause with no
opposite pair among the picks:

| formula             | build     | direct pick, no going back | search steps        |
|---------------------|-----------|----------------------------|---------------------|
| chain n=1600        | 21 s      | found                      | 1600                |
| random 3-SAT n=20…80| < 0.5 s   | stuck on every one         | 97 … > 2,000,000    |
| pigeonhole n=3…6    | < 0.03 s  | stuck on every one         | 179, 8262, > 2M, > 2M |

`(a) and (b) and (not a or not b)`: every pair of clauses has a solution
pattern, but the whole formula has none, so the pair results alone do not
give the answer.

## Polynomial read-outs (`readout.py`)

Read-outs that never undo a choice (so polynomial time), applied to the
pair structure: **propagate** was right on 74 of 300 random 12-variable
formulas and stuck on the rest; **probe** was right on 26 of 40. Neither
ever proved a formula UNSAT, and both were stuck on every pigeonhole
formula tried. Full write-up and next steps: `RESUME.md`.
