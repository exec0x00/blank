#!/usr/bin/env bash
# One-time environment check/setup for the study-pack skill. Safe to re-run.
set -uo pipefail
SKILL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -c "import matplotlib, sympy, playwright, PIL" 2>/dev/null || pip install -q matplotlib sympy playwright pillow numpy
[ -d "$SKILL/engine/node_modules/katex" ] || (cd "$SKILL/engine" && npm install --silent --no-audit --no-fund)
for t in soffice pdftoppm pdftotext pdfinfo pdffonts ffmpeg node; do
  command -v $t >/dev/null || echo "MISSING TOOL: $t"
done
ls /opt/pw-browsers/chromium-*/chrome-linux*/chrome >/dev/null 2>&1 || echo "NOTE: no pre-installed Chromium found; build_pdf.py falls back to Playwright's default"
chmod +x "$SKILL"/scripts/*.sh
echo "setup ok"
