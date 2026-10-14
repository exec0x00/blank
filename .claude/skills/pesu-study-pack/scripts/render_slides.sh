#!/usr/bin/env bash
# Render .pptx/.ppt/.docx decks (and PDFs) to PNG pages so equations and diagrams can be READ AS IMAGES.
# The .slides.md/.slides.txt exports drop OLE equations and garble diagram labels.
#
# usage: render_slides.sh <out_dir> <file> [<file> ...]
#   env DPI (default 80), PDF_PASSWORD (for protected PDFs, e.g. 8enterprise)
# Output: <out_dir>/<stem>/p-01.png …  Each LibreOffice run gets its own profile, so several can run in parallel.
set -euo pipefail
out=$1; shift
DPI=${DPI:-80}
mkdir -p "$out"
for f in "$@"; do
  stem=$(basename "${f%.*}" | cut -c1-60)
  dir="$out/$stem"; mkdir -p "$dir"
  case "${f,,}" in
    *.pdf) pdf="$f" ;;
    *) prof="/tmp/lo_$$_$RANDOM"
       soffice -env:UserInstallation=file://$prof --headless --convert-to pdf --outdir "$dir" "$f" >/dev/null 2>&1
       rm -rf "$prof"; pdf=$(ls "$dir"/*.pdf | head -1) ;;
  esac
  if [ -n "${PDF_PASSWORD:-}" ]; then pdftoppm -upw "$PDF_PASSWORD" -r "$DPI" -png "$pdf" "$dir/p"
  else pdftoppm -r "$DPI" -png "$pdf" "$dir/p"; fi
  echo "$dir: $(ls "$dir"/p-*.png | wc -l) pages"
done
