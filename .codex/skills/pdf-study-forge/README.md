# PDF Study Forge

One skill, one JSON source, a complete academic PDF workflow. Read **SKILL.md** as the agent's entry point.

The ZIP contains the renderer, schema, source tools, graphics tools, original design references, three complete teaching examples, regression tests, and a repository audit. It requires no special Claude workflow API, sub-agents, sibling repository or paid service. A Python/Node/browser runtime is required.

## Install

Extract the `pdf-study-forge/` folder into your agent's skill directory, for example `.claude/skills/` or the skill directory supported by your host. For hosts with an Upload Skill action, upload this ZIP. For a plain coding agent, point it at `pdf-study-forge/SKILL.md`. Installing a folder does not itself install runtime dependencies.

Requirements: Python 3.11+, Node.js 18+, and Chrome/Chromium. Python packages are pinned in `requirements.txt`. Linux/macOS:

```bash
bash /path/to/pdf-study-forge/scripts/setup.sh
```

This creates a local `.venv` and installs packages. If the browser check fails, install Chrome/Chromium through the host environment, or run the following once when downloads are supported:

```bash
/path/to/pdf-study-forge/.venv/bin/python -m playwright install chromium
```

For Windows or a host without Bash:

```text
python -m venv path/to/pdf-study-forge/.venv
path/to/pdf-study-forge/.venv/Scripts/python -m pip install -r path/to/pdf-study-forge/requirements.txt
path/to/pdf-study-forge/.venv/Scripts/python path/to/pdf-study-forge/scripts/forge.py doctor
```

Set `PDF_FORGE_BROWSER` to an existing browser executable if needed. The engine discovers Playwright Chromium, system Chrome/Chromium and the original `/opt/pw-browsers` installation. Optional source readers: LibreOffice for office documents, ffmpeg for videos and an OCR tool for scanned text. Ordinary PDF builds do not require those optional tools.

Use the same Python interpreter for all subsequent commands. Network is needed for initial dependency installation or source downloads. Building an already prepared project uses bundled fonts and KaTeX/mhchem; browser requests are fulfilled from the local output tree and all other requests are aborted.

## Try the included example

Copy `examples/calculus/` to a writable location outside the installed skill. Its source lesson and SVGs are included. Then:

```bash
python3 /path/to/pdf-study-forge/scripts/forge.py check /path/to/copied-calculus
python3 /path/to/pdf-study-forge/scripts/forge.py build /path/to/copied-calculus
```

Use the skill's `.venv/bin/python` instead of `python3` if you installed the isolated environment. The result includes the master, five reference documents and a seventh question bank. A successful build remains `REVIEW_REQUIRED` until every page is inspected and a hash-bound review record is finalized. The review step is work for the authoring agent, not a mandatory extra user-approval conversation.

Ready-made example PDFs are under `examples/<name>/sample-output/`. Their editable inputs are alongside them. This compact snapshot includes PDFs, contact sheets and review records; rebuild to regenerate the full HTML/assets/output tree described by each quality report. Example sources are original teaching fixtures, not external lecture/past-paper evidence. The chemistry fixture uses mhchem and units; the programming fixture tests exact code output and literal dollar signs. Do not use a demonstration as a substitute for a user's sources.

## Tell a model what to do

> Read `/path/to/pdf-study-forge/SKILL.md` and use it to create a complete study pack from [my source folder]. Scope: [exact unit/topics]. Audience: [level]. Include full worked solutions and requested derivations. Do the source coverage, calculation checks, PDF build and page-by-page review. Deliver the actual PDFs and the delivery ZIP, with any unresolved gaps stated honestly.

The skill narrows the decisions a weaker model must make, supplies examples and catches many objective mistakes. It cannot guarantee factual quality from a model that cannot read the sources or reason correctly.

## Tests and audit

```bash
python3 -m unittest discover -s /path/to/pdf-study-forge/tests -v
python3 /path/to/pdf-study-forge/tests/integration.py /path/to/writable-test-folder
```

See `audit/AUDIT.md`, `audit/TEST-REPORT.md` and `THIRD-PARTY-NOTICES.md`. The audited source branch is pinned in the audit; the complete downloaded Git repository was used during development but is not duplicated into this skill ZIP.
