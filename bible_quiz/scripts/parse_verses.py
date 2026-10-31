#!/usr/bin/env python3
"""Split converted KRCBC Unicode text into {chapter: {verse: text}} + section headings.

Strategy: remove section-heading lines and parallel-reference lines, join the body
into one stream, then walk the expected sequence of markers (1:1, 1:2, ..., 2:1 ...)
greedily, each time taking the next standalone number equal to the expected marker
(the verse number, or the chapter number for verse 1).

Usage: python3 parse_verses.py book_uni.txt out.json 22,23,18,22
"""
import json, re, sys

KAN = "ಀ-೿"
END_PUNCT = tuple(".?!”’;,:\"')—-")


def is_heading(line, nxt):
    s = line.strip()
    if not s or re.search(r"\d", s) or len(s) > 70:
        return False
    if s.endswith(END_PUNCT):
        return False
    return bool(re.match(r"^\s*\(?\d", nxt or ""))


def main(src, dst, exp):
    lines = [l.rstrip() for l in open(src, encoding="utf-8").read().split("\n")]
    start = next(i for i, l in enumerate(lines) if i > 5 and re.match(r"^1\s+\S", l)
                 and not re.search(r"\d+\.\d+", l))
    body, heads_at = [], []
    stream = ""
    linestarts = set()
    pending = None
    for k in range(start, len(lines)):
        l = lines[k]
        nxt = lines[k + 1] if k + 1 < len(lines) else ""
        if re.match(r"^\s*\(.*\d+[.:]\d+.*\)\s*$", l):
            continue  # parallel references line
        kk = k + 1
        while kk < len(lines) and re.match(r"^\s*\(.*\d+[.:]\d+.*\)\s*$", lines[kk]):
            kk += 1
        nxt = lines[kk] if kk < len(lines) else ""
        if is_heading(l, nxt):
            pending = (pending + " " if pending else "") + l.strip()
            continue
        if pending:
            heads_at.append((len(stream), pending))
            pending = None
        linestarts.add(len(stream))
        stream += l.strip() + " "
    cands = [(m.start(), m.end(), int(m.group(1)), int(m.group(2) or m.group(1))) for m in
             re.finditer(r"(?<![\d.\-:])(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?(?![\d.\-:])", stream)]
    marks = []  # (chapter, first_verse, last_verse, start, end)
    missing = []

    def ok(cand, c, v):
        a, b, n1, n2 = cand
        if v == 1:
            return n1 == c and (a in linestarts or c == 1)
        return n1 == v

    ci = 0
    c, v = 1, 1
    while c <= len(exp):
        nc, nv = (c, v + 1) if v < exp[c - 1] else (c + 1, 1)
        j = ci
        found = None
        while j < len(cands):
            if ok(cands[j], c, v):
                found = ("this", j)
                break
            if nc <= len(exp) and ok(cands[j], nc, nv):
                found = ("next", j)
                break
            j += 1
        if found is None:
            if c == len(exp) and v == exp[-1]:
                missing.append(f"{c}:{v}")
                break
            print("could not find", c, v)
            break
        if found[0] == "next":
            missing.append(f"{c}:{v}")
            # verse v has no marker: it shares the previous verse's text
            pc, pv1, pv2, pa, pb = marks[-1]
            marks[-1] = (pc, pv1, v, pa, pb)
            c, v = nc, nv
            continue
        a, b, n1, n2 = cands[j]
        last = v if v == 1 else n2
        if last < v or last > exp[c - 1]:
            last = v
        marks.append((c, v, last, a, b))
        ci = j + 1
        v = last + 1
        if v > exp[c - 1]:
            c, v = c + 1, 1
    res = {"chapters": {}, "merged": [], "missing_markers": missing, "headings": []}
    warn = []
    for i, (c, v1, v2, s, e) in enumerate(marks):
        end = marks[i + 1][3] if i + 1 < len(marks) else len(stream)
        txt = re.sub(r"\s+", " ", stream[e:end]).strip()
        for v in range(v1, v2 + 1):
            res["chapters"].setdefault(str(c), {})[str(v)] = txt
        if v2 > v1:
            res["merged"].append(f"{c}:{v1}-{v2}")
        for (a, b, n1, n2) in cands:
            if e <= a < end:
                warn.append(f"{c}:{v1} contains number {stream[a:b]!r}")
    for pos, h in heads_at:
        for (c, v1, v2, s, e) in marks:
            if s >= pos:
                res["headings"].append({"chapter": c, "verse": v1, "heading": h})
                if stream[pos:s].strip():
                    warn.append(f"heading {h!r} not directly before {c}:{v1}: {stream[pos:s]!r}")
                break
    # manual splits for verses whose number is missing in the PDF: {"c:v": "first words of v"}
    for key, words in SPLITS.items():
        c, v = key.split(":")
        prev = str(int(v) - 1)
        t = res["chapters"][c][prev]
        i = t.find(words)
        if i > 0:
            res["chapters"][c][prev] = t[:i].strip()
            res["chapters"][c][v] = t[i:].strip()
            res["merged"] = [m for m in res["merged"] if m != f"{c}:{prev}-{v}"]
            res.setdefault("split_fixes", []).append(key)
        else:
            print("SPLIT FAILED", key)
    json.dump(res, open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for w in warn:
        print("WARN", w)
    print("merged verses:", res["merged"], "missing markers:", missing)
    got = [len(res["chapters"].get(str(c), {})) for c in range(1, len(exp) + 1)]
    print("counts", got, "OK" if got == exp else "MISMATCH")


SPLITS = {}

if __name__ == "__main__":
    if len(sys.argv) > 4:
        SPLITS = json.loads(sys.argv[4])
    main(sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(",")])
