# Provenance and third-party notices

This skill was prepared from the user-requested repository branch:
https://github.com/exec0x00/blank/tree/claude/keen-fermat-l52u0o
at `adc8008e25aed6b6a84175c8add5d219ef91a0ee`.

`engine/build.py`, `lib.py`, `study.css`, `figstyle.py`, `inline.py`, the Hugging Face listing helper and the two HTML design templates are adapted from that repository. Other code was rewritten or added for this package. `audit/original-lessons.md` and audit extracts preserve repository material for the requested analysis. No root license was found in the source snapshot; this package does not assign a new blanket license to upstream material or represent it as exclusively original work. Consult the source owner before unrelated redistribution.

Bundled libraries and fonts retain their own licenses:

| Component | Version / source | License |
|---|---|---|
| KaTeX, including its fonts | 0.16.11, https://github.com/KaTeX/KaTeX | MIT; `licenses/KaTeX-LICENSE.txt` |
| mhchem extension in KaTeX | Bundled `vendor/katex/contrib/mhchem.mjs`; adapted MathJax/mhchem code retains copyright notices | MIT notices in KaTeX and Apache 2.0 notices in extension; `licenses/Apache-2.0.txt` |
| Computer Modern Unicode fonts | Retained from requested repository; CMU font project | SIL Open Font License 1.1; `licenses/CMU-OFL.txt` |
| DejaVu Sans / Sans Mono | System DejaVu fonts, https://dejavu-fonts.github.io/ | Bitstream Vera/Arev notices; `licenses/DejaVu-LICENSE.txt` |

Python dependencies are installed separately, not copied into this ZIP. They retain their respective licenses. In particular, PyMuPDF is offered under AGPL/commercial terms; consult its current distribution terms when integrating this renderer into another product. This notice does not change any component's license.

The three supplied source lessons and their illustrative data were authored for the examples in this package. They do not claim to be actual university lecture slides or examination papers.
