#!/bin/bash
# Build the General Questions set: JSON -> HTML (per section + master) -> PDF.
set -e
cd "$(dirname "$0")/.."
python3 scripts/build_general.py
for s in 1 2 3; do python3 scripts/render_html.py general $s >/dev/null; done
python3 scripts/render_html.py general all >/dev/null
node scripts/html2pdf.js html/general_master.html pdf/general.pdf
