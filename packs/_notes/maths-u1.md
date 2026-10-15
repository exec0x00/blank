# Maths Unit 1 (UE26MA141A Engineering Mathematics – I · Partial Differentiation)

Branch `claude/packs-maths-u1`. Bucket `alvin3y10/data`, `pesuc/PESU_Materials/Sem-1/UE26MA141A_Engineering_Mathematics_-_I/Unit_01`.
Subject material: `pesuc/First_Year_8enterprise/Files/Math 1/` (CW sheet `Math_Unit1&2_CW`, 8 ESA papers, extra
`lagrange-ques`). ESA map: `packs/_shared/maths/esa_map.md`.

## Packs built in this session

| Pack | Session | Sources | PDFs (pages: 00/01/02/03/04/05) | QA |
|---|---|---|---|---|
| `maths-u1-001-intro-partial-differentiation` | 001 | deck 001 (18 slides), transcripts 001a (Introduction) + 001b (Continuity and differentiability), CW P4, P7, P8 | 28 / 4 / 7 / 7 / 6 / 5 | passed |
| `maths-u1-009-maxima-minima-intro` | 009 | deck 009 (10 slides), transcript 009 (Extremas of functions), CW P31 | 19 / 3 / 6 / 5 / 3 / 5 | passed |
| `maths-u1-010-maxima-minima-problems` | 010 | deck 010 (15 slides), transcripts 010a (Extremas continued) + 010b (Problems), CW P29, P31, P32, P34 | 24 / 3 / 5 / 6 / 4 / 5 | passed |
| `maths-u1-011-lagrange-multipliers` | 011 | deck 011 (15 slides), transcripts 011a (theory) + 011b (problems), CW P33–P36, extra list | 21 / 3 / 5 / 4 / 3 / 5 | passed |
| `maths-u1-unit-master` | 001–011 | merge_unit.py of the 10 packs below | see below | see below |

Unit master order: 001-intro, geometrical-interpretation (002), total-derivative-chain-rule-implicit (003–004),
homogeneous-euler (005), euler-problems (006), taylor-maclaurin (007), taylor-problems (008), 009, 010, 011.
`maths-u1-implicit-composite-functions` (004 only) is not in the master, as instructed. Existing packs 002–008 were not modified.

No video was opened: every slide was readable and every disputed number was settled by recomputation.

## ESA coverage (8 papers, deduplicated)

Every Unit 1 question of every paper is mapped in `esa_map.md`. Sessions built here:

- **Free extrema (010):** Dec-23 1c = Jan-24 s1 1a ($x^3+3xy^2-15x^2-15y^2+72x$: max 112 at (4,0), min 108 at (6,0),
  saddles (5,±1)); Jan-24 s2 1a ($x^3-12x+y^3+3y^2-9y$: max 43 at (−2,−3), min −21 at (2,1), saddles (2,−3), (−2,1)). ★★★
- **Lagrange (011):** Jul-23 1c (distances to $5x^2+6xy+5y^2=8$: max 2, min 1); May-24 1c (box in sphere is a cube);
  Jan-24 s3 1a = s4 1a (ellipsoid, $8abc/(3\sqrt3)$); Jun-24 1d ($400xyz^2$ on the unit sphere: 50). ★★★ All solved and
  verified with sympy; Jun-24 1d is also cross-checked by elimination in 010.
- **001/009:** never asked directly. Computing partials is asked in Dec-23 1a and Jan-24 s4 1c (worked in the 002 pack;
  001 works the CW problems of the same type). 009's test is the whole of the three 010 questions.

## Gaps and conflicts found (all flagged in the packs' gaps and as exam traps)

- 001: slide limit point (2,1) → −8, lecture uses (2,−1) → −6; slide 12's Gnuplot caption shows $3xy/(x^2+y^2)$ (no limit) while the
  text is $3x^2y/(x^2+y^2)$ (limit 0); "continuous if smooth" (lecture) corrected; Clairaut needs continuity (counter-example added).
- 009: slide calls $f_x=f_y=0$, $rt-s^2>0$ "necessary and sufficient"; lecture calls $f''=0$ "a saddle point" and once says
  $rt-s^2<0$ gives no conclusion. Slides give no worked example (short ones added, flagged).
- 010: slide 4's $rt-s^2$ values (−1600, 356000) should be −160000, 320000; slides miss four saddle points (±1,0), (0,±1) of
  $400xy(1-x^2-y^2)$ and never classify the minima; **open-box slides/lecture are wrong** (area model and a derivative slip give
  a cube $\sqrt[3]{10}$; correct is base $\sqrt[3]{20}$ square, height half, area 22.10 m², matching CW P34); slide 8 says max at
  (6,0) (it is (4,0)) and drops a 36; slide 12 says $r=-2$ at all four saddles; slide 14 prints $rt-s^2=3/4$ (it is 9/4).
- 011: slide 6 typo ($2y^2\lambda$ for $2z^2\lambda$); slide 9 "z=0, λ=1" loose; CW P33's condition is garbled in the text
  layer — the rendered page shows $1/x+1/y+1/z=1$ and the answer $(a+b+c)^3$ is right.
- ASR corrections listed per pack (Clydoids→Clairaut, Hesian→Hessian, Lagrangius→Lagrange's, stattle→saddle, …).

## Notes for the orchestrator / lessons

1. **Lesson candidate (slides solving an applied problem with the wrong model):** class 010's open-box problem writes the
   area of an open box as $2xy+2yz+zx$ and then differentiates it wrongly; two errors cancel into a plausible "cube" answer.
   Re-derive the model (not just the algebra) of every applied problem, and compare with the CW key (P34 had the right answer).
2. **Lesson candidate (garbled CW constraint):** in CW P33 `pdftotext` drops the fractions of the constraint
   ($\frac1x+\frac1y+\frac1z=1$), leaving only "1 1 1" on the line above; the problem looks like $x+y+z=1$ and the printed
   answer then looks wrong. Render the page before calling a CW answer wrong (extends lesson 9).
3. Two background sub-agents for 010 and 011 were stopped by the account's rate limit twice; the packs were finished in the
   main session. One agent had already written a correct `pack.py` for 010 (kept after re-verification).
4. Engine: no change needed. `findfont: Failed to find font weight normal for CMU Serif` warnings appear when a figure uses
   `ax.contour` labels/ticks; output is unaffected.
