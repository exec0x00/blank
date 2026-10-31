#!/bin/bash
# Download (if needed) and extract the KRCBC books used in this quiz into verse JSON.
set -e
cd "$(dirname "$0")/.."
declare -A URL=( [ruth]="ರೂತಳು" [galatians]="ಗಲಾತ್ಯರಿಗೆ" [john]="ಯೋಹಾನ" )
declare -A CNT=( [ruth]="22,23,18,22" [galatians]="24,21,29,31,26,18" [john]="51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25" )
declare -A SPL=( [ruth]="{}" [galatians]="{}" [john]='{"1:51":"ತಮ್ಮ ಮಾತನ್ನು ಮುಂದುವರಿಸುತ್ತಾ"}' )
for b in ruth galatians john; do
  [ -f source/$b.pdf ] || curl -sS -g "https://krcbcbible.org/pdf/${URL[$b]}.pdf" -o source/$b.pdf
  pdftotext -raw source/$b.pdf source/${b}_raw.txt
  python3 scripts/nudi2uni.py source/${b}_raw.txt source/${b}_uni.txt
  python3 scripts/parse_verses.py source/${b}_uni.txt source/${b}_verses.json "${CNT[$b]}" "${SPL[$b]}" > source/${b}_parse.log
  grep -v "contains number" source/${b}_parse.log
done
