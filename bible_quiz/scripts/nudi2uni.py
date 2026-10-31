#!/usr/bin/env python3
"""Convert Nudi (legacy ASCII-font) Kannada text, as extracted by `pdftotext -raw`
from the KRCBC Bible PDFs, into Unicode Kannada.

The glyph tables (nudi_tables.json) were taken as data from the GPL ascii2unicode
project by Aravinda VK; the conversion logic is re-implemented here.

Usage: python3 nudi2uni.py input_raw.txt output_unicode.txt
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, "nudi_tables.json"), encoding="utf-8"))
MAPPING = T["mapping"]
BROKEN = T["broken_cases"]
DEP = set(T["dependent_vowels"])
IGNORE = set(T["ignore_list"])
VATTU = T["vattaksharagalu"]
ARKA = T["ascii_arkavattu"]
HALANT = "್"
ZWJ = "‍"
MAXKEY = max(len(k) for k in MAPPING)


def vattakshara(op, t):
    if op and op[-1] in DEP:
        last = op[-1]
        op[-1] = HALANT
        op.append(VATTU[t])
        op.append(last)
    else:
        op.append(HALANT)
        op.append(VATTU[t])


def arkavattu(op, t):
    # ವರ್ಷ  is typed ವ + ಷ + arkavattu ; move ರ್ before the last consonant
    if not op:
        return
    if op[-1] in DEP and len(op) > 1:
        last, cons = op[-1], op[-2]
        # walk back over a consonant cluster (C್C) so ರ್ goes before the whole cluster
        i = len(op) - 2
        while i >= 2 and op[i - 1] == HALANT:
            i -= 2
        op[i:i] = [ARKA[t], HALANT]
    else:
        i = len(op) - 1
        while i >= 2 and op[i - 1] == HALANT:
            i -= 2
        op[i:i] = [ARKA[t], HALANT]


def broken(op, t):
    m = BROKEN[t]["mapping"]
    if op and op[-1] in m:
        op[-1] = m[op[-1]]
    else:
        op.append(BROKEN[t]["value"])


def word(w):
    op = []
    i = 0
    n = len(w)
    while i < n:
        c = w[i]
        if c in IGNORE:
            i += 1
            continue
        hit = False
        for L in range(min(MAXKEY, n - i), 0, -1):
            t = w[i:i + L]
            if t in MAPPING:
                if op and op[-1].endswith(HALANT):
                    op.append(ZWJ)
                op.extend(list(MAPPING[t]))
                i += L
                hit = True
                break
        if hit:
            continue
        if c in ARKA:
            arkavattu(op, c)
        elif c in VATTU:
            vattakshara(op, c)
        elif c in BROKEN:
            broken(op, c)
        else:
            op.append(c)
        i += 1
    s = "".join(op)
    return s


def fix(s):
    # cleanup of common artefacts
    s = s.replace("ø", "ೃ")
    s = s.replace("‍", "")
    s = s.replace("ೋ", "ೋ")
    return s


def line(l):
    return fix(" ".join(word(w) for w in l.split(" ")))


def convert(text):
    return "\n".join(line(l) for l in text.split("\n"))


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    txt = open(src, encoding="utf-8").read()
    open(dst, "w", encoding="utf-8").write(convert(txt))
