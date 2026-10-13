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
