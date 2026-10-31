#!/bin/bash
# Build one chapter: JSON -> chapter HTML -> book master HTML -> book master PDF.
# Usage: scripts/make_chapter.sh ruth 1
set -e
cd "$(dirname "$0")/.."
book=$1; ch=$2
python3 scripts/build_chapter.py "$book" "$ch"
python3 scripts/render_html.py "$book" "$ch" >/dev/null
python3 scripts/render_html.py "$book" all >/dev/null
mkdir -p pdf
node scripts/html2pdf.js "html/${book}_master.html" "pdf/${book}.pdf"
