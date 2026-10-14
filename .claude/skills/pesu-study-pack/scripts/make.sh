#!/usr/bin/env bash
# One command to (re)build a pack: figures → HTML → PDF → standalone HTML → QA.
# usage: make.sh <pack_dir> [--sheets]
set -euo pipefail
SKILL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACK="$(cd "$1" && pwd)"; shift || true
python3 -I "$SKILL/engine/figures_run.py" "$PACK"
python3 -I "$SKILL/engine/build.py" "$PACK"
python3 -I "$SKILL/engine/build_pdf.py" "$PACK"
python3 -I "$SKILL/engine/inline.py" "$PACK"
python3 -I "$SKILL/scripts/qa.py" "$PACK" "$@"
