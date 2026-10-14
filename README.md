# Study packs

This repo makes exam study packs: six documents, each as HTML and PDF, in one fixed design. They are built from PESU course material: slides, lecture transcripts, videos, class-work sheets and past ESA papers.

## The skill: `.claude/skills/pesu-study-pack/`

Point Claude at the material and say what you want:

> "Do the same for Engineering Chemistry Unit 2", or "make a pack for https://huggingface.co/buckets/alvin3y10/data/tree/pesuc …, Maths Unit 3, Taylor series only".

The skill works for a topic, a section, a whole unit, several units or a whole subject.

| Part | What it holds |
|---|---|
| `SKILL.md` | The step-by-step procedure |
| `references/lessons.md` | Every finding and mistake so far (35 items) |
| `references/sources.md` | Bucket API and layout; which file format to use for what; when to open a video |
| `references/content-schema.md` | Pack format, IDs, source tags, the 8 flowchart layouts |
| `references/design.md` + `references/templates/` | The design system and your two original templates |
| `engine/` | Builder: HTML, KaTeX maths, figures, PDF printing, single-file HTML |
| `scripts/` | Bucket listing and download, slide rendering, contact sheets, video frames, QA, scaffolding, one-command `make.sh` |
| `examples/` | The complete maths pack, as source |

For big scopes there is also a saved workflow, `.claude/workflows/study-pack.js`. Ask Claude to "use a workflow". It scouts the sources, runs one extractor and one checker per group of sessions, builds the pack, reviews it from three angles and applies the fixes.

## Packs

| Pack | Output |
|---|---|
| `packs/maths-u1-geometrical-interpretation/` | Maths Unit 1, class 002. 6 PDFs (37 + 7 + 10 + 11 + 9 + 6 pages) and 6 single-file HTML files in `output/standalone/` |

### Rebuild a pack

```
bash .claude/skills/pesu-study-pack/scripts/setup.sh
bash .claude/skills/pesu-study-pack/scripts/make.sh packs/<pack> --sheets
```
