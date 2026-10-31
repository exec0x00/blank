#!/usr/bin/env python3
"""Build the question JSON for one chapter.

Inputs
  authoring/<book>_<cc>.txt   hand-written questions (KRCBC wording), one per line:
        refs | type | question | answer
     refs: verse numbers of this chapter: "5", "5-7", "5,9", or full "2:3" for other chapters,
           or "ಮತ್ತಾಯ 3:1" style for other books.
     type: who what where when why howmany quote speaker whowhom list comp referent fill synthesis
  source/<book>_verses.json   KRCBC text split into verses

Output
  json/<book>/<book>_ch<cc>.json

Hand-written questions come first in verse order; then verbatim-text questions
(fill-in-the-blank / complete-the-verse / which-verse) generated from the KRCBC verse
text are added until the chapter reaches the target count (default 250).

Usage: python3 build_chapter.py ruth 1 [--target 250]
"""
import argparse, json, os, re, sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from books import BOOKS, ROOT, verses

DASH = "–"
QUOTE_CHARS = "“”‘’\"'"

BANNED = {
    "ಸುವಾರ್ತೆ": "ಶುಭಸಂದೇಶ", "ಪರಲೋಕರಾಜ್ಯ": "ಸ್ವರ್ಗಸಾಮ್ರಾಜ್ಯ", "ಮನುಷ್ಯಕುಮಾರ": "ನರಪುತ್ರ",
    "ಯೋಹಾನ": "ಯೊವಾನ್ನ", "ಸಾಮ್ಯ": "ಸಾಮತಿ", "ಸಭಾಮಂದಿರ": "ಪ್ರಾರ್ಥನಾಮಂದಿರ", "ಕಪೆರ್ನೌಮ್": "ಕಫೆರ್ನವುಮ್",
    "ಯೇಸು ಹೇಳಿದನು": "ಯೇಸು ಹೇಳಿದರು", "ಯೇಸು ಮಾಡಿದನು": "ಯೇಸು ಮಾಡಿದರು", "ನೊವೊಮಿ": "ನವೊಮಿ",
    "ನೊಯೊಮಿ": "ನವೊಮಿ", "ಬೋವಜನಿಗೆಯು": "ಬೋವಜನಿಗೆ", "ಗಲಾತ್ಯದವರಿಗೆ": "ಗಲಾತ್ಯರಿಗೆ",
}

STOP = set("""ಮತ್ತು ಆಗ ಎಂದು ಎಂದನು ಎಂದಳು ಎಂದರು ಅದಕ್ಕೆ ಈ ಆ ನಾನು ನೀನು ನೀವು ಅವರು ಅವನು ಅವಳು ಅದು ಇದು
ನಾವು ಅವರ ಅವನ ಅವಳ ನನ್ನ ನಿನ್ನ ನಿಮ್ಮ ನಮ್ಮ ತನ್ನ ತಮ್ಮ ಇಲ್ಲ ಹಾಗೂ ಹಾಗು ಆದರೆ ಆದರೂ ಇನ್ನು ಅಲ್ಲ ಅಲ್ಲಿ ಇಲ್ಲಿ
ಎಂಬ ಎಂಬುದು ಎಂದೂ ಒಂದು ಒಬ್ಬ ಕೂಡ ಸಹ ಬಗ್ಗೆ ಹೀಗೆ ಹಾಗೆ ಅಂತೆಯೇ ಏಕೆಂದರೆ ಅಂದರೆ ಅದರಿಂದ ಅವರಿಗೆ ಅವನಿಗೆ
ಅವಳಿಗೆ ನನಗೆ ನಿನಗೆ ನಿಮಗೆ ನಮಗೆ ತನಗೆ ತಮಗೆ ಇವರು ಇವನು ಇವಳು ಯಾರು ಏನು ಏಕೆ ಹೇಗೆ ಎಲ್ಲಿ ಎಷ್ಟು ಅಥವಾ
ಹೇಳಿದನು ಹೇಳಿದಳು ಹೇಳಿದರು ಕೇಳಿದನು ಕೇಳಿದಳು ಕೇಳಿದರು ಉತ್ತರಕೊಟ್ಟನು ಉತ್ತರಕೊಟ್ಟರು ಉತ್ತರಕೊಟ್ಟಳು ಅವರೆಲ್ಲರೂ
ಎಲ್ಲರೂ ಎಲ್ಲಾ ಎಲ್ಲ ಅವುಗಳನ್ನು ಅದನ್ನು ಇದನ್ನು ಇದಕ್ಕೆ ಅದರ ಇದರ ಅನಂತರ ನಂತರ ಮೇಲೆ ಬಳಿಗೆ ಬಳಿ ಹತ್ತಿರ""".split())

PUNCT_STRIP = ".,;:?!“”‘’\"'()–—-"


def norm(s):
    s = re.sub(r"[“”‘’\"'.,;:?!()\-–—…]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_refs(r, ch):
    """'5' -> ['ch:5'], '5-7' -> ['ch:5–7'], '5,9' -> ['ch:5','ch:9'], '2:3' kept."""
    out = []
    for part in [p.strip() for p in r.split(",") if p.strip()]:
        part = part.replace("-", DASH)
        if ":" in part or not re.match(r"^\d", part):
            out.append(part)
        else:
            out.append(f"{ch}:{part}")
    return out


def ref_verses(ref, ch):
    """Return list of (chapter, verse) ints covered by a ref of this book, or [] if other book."""
    m = re.match(r"^(\d+):(\d+)(?:" + DASH + r"(\d+))?$", ref)
    if not m:
        return []
    c, a, b = int(m.group(1)), int(m.group(2)), int(m.group(3) or m.group(2))
    return [(c, v) for v in range(a, b + 1)]


def first_verse(refs, ch):
    for r in refs:
        vv = ref_verses(r, ch)
        if vv and vv[0][0] == ch:
            return vv[0][1]
    for r in refs:
        vv = ref_verses(r, ch)
        if vv:
            return 0 if vv[0][0] < ch else 999
    return 999


def load_manual(path, ch):
    items = []
    if not os.path.exists(path):
        return items
    for ln, line in enumerate(open(path, encoding="utf-8"), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 4:
            raise SystemExit(f"{path}:{ln}: expected 4 fields, got {len(parts)}: {line[:80]}")
        r, t, q, a = parts
        items.append({"refs": parse_refs(r, ch), "type": t, "question": q, "answer": a,
                      "source": "manual", "line": ln})
    return items


# ---------------------------------------------------------------- auto generation
def chunks_of(text):
    """Split a verse into sentence-like chunks of 4..22 words (quotes removed)."""
    t = text
    for c in "“”‘’\"":
        t = t.replace(c, "")
    t = re.sub(r"\(.*?\)", "", t)
    parts = re.split(r"(?<=[.?!;:])\s+", t)
    out = []
    for p in parts:
        p = p.strip()
        w = p.split()
        if len(w) > 22:
            # cut at commas into pieces
            sub = re.split(r"(?<=,)\s+", p)
            buf = []
            for s in sub:
                buf.append(s)
                if len(" ".join(buf).split()) >= 6:
                    out.append(" ".join(buf))
                    buf = []
            if buf:
                if out and len(" ".join(buf).split()) < 4:
                    out[-1] += " " + " ".join(buf)
                else:
                    out.append(" ".join(buf))
        elif len(w) >= 4:
            out.append(p)
    return [o.strip() for o in out if 4 <= len(o.split()) <= 26]


def clean_word(w):
    return w.strip(PUNCT_STRIP)


def blank_candidates(chunk, names):
    words = chunk.split()
    cands = []
    for i, w in enumerate(words):
        cw = clean_word(w)
        if len(cw) < 3 or cw in STOP or re.search(r"\d", cw):
            continue
        score = len(cw)
        if any(cw.startswith(n) for n in names):
            score += 12
        cands.append((score, i, cw))
    cands.sort(key=lambda x: (-x[0], x[1]))
    return cands


def make_blank(chunk, idxs):
    words = chunk.split()
    ans = []
    for i in sorted(idxs):
        w = words[i]
        cw = clean_word(w)
        pre = w[:w.find(cw)] if cw in w else ""
        post = w[w.find(cw) + len(cw):] if cw in w else ""
        words[i] = pre + "______" + post
        ans.append(cw)
    return " ".join(words), ans


def ref_str(ch, v, merged_map):
    if (ch, v) in merged_map:
        a, b = merged_map[(ch, v)]
        return f"{ch}:{a}{DASH}{b}"
    return f"{ch}:{v}"


def autogen(book, ch, vdict, merged_map, need, existing_norm, manual_per_verse):
    names = BOOKS[book]["names"]
    title = BOOKS[book]["ref_name"]
    # count chunk occurrences across chapter to keep "which verse" unambiguous
    chunk_count = defaultdict(int)
    vchunks = {}
    seen_text = {}
    for v in sorted(vdict, key=int):
        t = vdict[v]
        if seen_text.get(t):  # merged verse sharing text: generate only once
            vchunks[int(v)] = []
            continue
        seen_text[t] = v
        cs = chunks_of(t)
        vchunks[int(v)] = cs
        for c in cs:
            chunk_count[norm(c)] += 1
    # candidate pool per verse, in rotating type order
    pools = {}
    for v, cs in vchunks.items():
        tiers = [[], [], [], []]
        for k, c in enumerate(cs):
            cands = blank_candidates(c, names)
            nw = len(c.split())
            alt = k % 2  # alternate the second item type between chunks for variety
            if cands:
                q, a = make_blank(c, [cands[0][1]])
                tiers[0].append(("fill", f"ವಾಕ್ಯ ಪೂರ್ಣಗೊಳಿಸಿ: “{q}”", a[0], c))
            which = None
            if chunk_count[norm(c)] == 1 and nw >= 5:
                which = ("which", f"“{c}” — ಈ ಮಾತುಗಳು {title} {ch}ನೇ ಅಧ್ಯಾಯದ ಯಾವ ವಚನದಲ್ಲಿವೆ?", None, c)
            cont = None
            if nw >= 8:
                ws = c.split()
                cut = nw // 2
                cont = ("continue", f"ವಚನವನ್ನು ಮುಂದುವರಿಸಿ: “{' '.join(ws[:cut])} …”", f"“… {' '.join(ws[cut:])}”", c)
            first, second = (which, cont) if alt == 0 else (cont, which)
            if first: tiers[1].append(first)
            if len(cands) > 1:
                q, a = make_blank(c, [cands[1][1]])
                tiers[2].append(("fill", f"ವಾಕ್ಯ ಪೂರ್ಣಗೊಳಿಸಿ: “{q}”", a[0], c))
            if second: tiers[3].append(second)
            if len(cands) > 3 and nw >= 9:
                q, a = make_blank(c, [cands[2][1], cands[3][1]])
                tiers[3].append(("fill", f"ವಾಕ್ಯ ಪೂರ್ಣಗೊಳಿಸಿ: “{q}”", "; ".join(a), c))
        # write-out-the-verse (common in written quizzes) for verses of moderate length
        full = vdict[str(v)]
        nfull = len(full.split())
        if 5 <= nfull <= 40:
            r = ref_str(ch, v, merged_map)
            tiers[2].insert(0, ("recite", f"{title} {r} ವಚನವನ್ನು ಬರೆಯಿರಿ.", full, full))
        for k, c in enumerate(cs):
            cands = blank_candidates(c, names)
            if len(cands) > 4:
                q, a = make_blank(c, [cands[4][1]])
                tiers[3].append(("fill", f"ವಾಕ್ಯ ಪೂರ್ಣಗೊಳಿಸಿ: “{q}”", a[0], c))
        pools[v] = tiers[0] + tiers[1] + tiers[2] + tiers[3]
    # order each verse's pool: round-robin over chunks by type priority already; just keep
    out = []
    used = set(existing_norm)
    # weight: verses with fewer manual questions get auto questions first
    order = sorted(pools, key=lambda v: (manual_per_verse.get(v, 0), v))
    idx = {v: 0 for v in pools}
    rounds = 0
    while len(out) < need and rounds < 40:
        progressed = False
        for v in sorted(pools, key=lambda v: (manual_per_verse.get(v, 0) + sum(1 for o in out if o["_v"] == v), v)):
            if len(out) >= need:
                break
            while idx[v] < len(pools[v]):
                typ, q, a, ev = pools[v][idx[v]]
                idx[v] += 1
                key = norm(q)
                if key in used:
                    continue
                used.add(key)
                r = ref_str(ch, v, merged_map)
                if typ == "which":
                    a = "ವಚನ " + r.split(":")[1]
                out.append({"refs": [r], "type": typ, "question": q, "answer": a, "evidence": ev,
                            "source": "auto", "_v": v})
                progressed = True
                break
        rounds += 1
        if not progressed:
            break
    return out


# ---------------------------------------------------------------- validation
def validate(items, book, ch, allv):
    chap_text = norm(" ".join(allv["chapters"][str(ch)].values()))
    book_text = norm(" ".join(" ".join(c.values()) for c in allv["chapters"].values()))
    errors, warns = [], []
    seen = {}
    nch = len(allv["chapters"])
    for it in items:
        tag = f"line {it.get('line', '?')}" if it["source"] == "manual" else "auto"
        if not it["answer"].strip():
            errors.append(f"{tag}: empty answer")
        if not it["refs"]:
            errors.append(f"{tag}: no reference")
        for r in it["refs"]:
            for (c, v) in ref_verses(r, ch):
                if str(c) not in allv["chapters"] or str(v) not in allv["chapters"][str(c)]:
                    errors.append(f"{tag}: bad ref {r}")
        k = norm(it["question"])
        if k in seen:
            errors.append(f"{tag}: duplicate question (also {seen[k]}): {it['question'][:60]}")
        seen[k] = tag
        for txt in (it["question"], it["answer"]):
            for bad, good in BANNED.items():
                if bad in txt and good not in txt:
                    errors.append(f"{tag}: non-KRCBC word '{bad}' (use '{good}')")
            if it["source"] == "manual":
                for qt in re.findall(r"[“‘]([^”’]{6,})[”’]", txt):
                    if "______" in qt:
                        parts = [norm(p) for p in qt.split("______") if norm(p)]
                        if not all(p in chap_text or p in book_text for p in parts):
                            errors.append(f"{tag}: blank-quote not in KRCBC text: {qt[:70]}")
                        continue
                    nq = norm(qt.replace("…", " "))
                    segs = [norm(s) for s in qt.split("…") if norm(s)]
                    if not all(s in chap_text or s in book_text for s in segs):
                        errors.append(f"{tag}: quote not in KRCBC text: {qt[:80]}")
        if it["type"] == "fill" and "______" not in it["question"]:
            errors.append(f"{tag}: fill type without blank")
    return errors, warns


def difficulty(t):
    return {"who": "easy", "what": "easy", "where": "easy", "when": "medium", "why": "medium",
            "howmany": "medium", "quote": "medium", "speaker": "easy", "whowhom": "medium",
            "list": "hard", "comp": "medium", "referent": "medium", "fill": "medium",
            "continue": "hard", "which": "hard", "recite": "hard", "synthesis": "hard", "ot": "hard"}.get(t, "medium")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("book")
    ap.add_argument("chapter", type=int)
    ap.add_argument("--target", type=int, default=250)
    ap.add_argument("--max-auto-share", type=float, default=0.62)
    a = ap.parse_args()
    book, ch = a.book, a.chapter
    allv = verses(book)
    vdict = allv["chapters"][str(ch)]
    merged_map = {}
    for m in allv.get("merged", []):
        c, rng = m.split(":")
        x, y = map(int, rng.split("-"))
        if int(c) == ch:
            for v in range(x, y + 1):
                merged_map[(ch, v)] = (x, y)
    manual = load_manual(os.path.join(ROOT, "authoring", f"{book}_{ch:02d}.txt"), ch)
    for it in manual:
        it["_v"] = first_verse(it["refs"], ch)
    mpv = defaultdict(int)
    for it in manual:
        mpv[it["_v"]] += 1
    need = max(0, a.target - len(manual)) + 6  # small margin above the minimum
    auto = autogen(book, ch, vdict, merged_map, need, {norm(i["question"]) for i in manual}, mpv)
    items = manual + auto
    errors, warns = validate(items, book, ch, allv)
    # order: by first verse, manual before auto, stable
    items.sort(key=lambda it: (it["_v"], 0 if it["source"] == "manual" else 1))
    out_q = []
    for n, it in enumerate(items, 1):
        q = {"number": n, "type": it["type"], "difficulty": difficulty(it["type"]),
             "question": it["question"], "answer": it["answer"], "refs": it["refs"],
             "source": it["source"]}
        if it.get("evidence"):
            q["evidence"] = it["evidence"]
        out_q.append(q)
    stats = defaultdict(int)
    for q in out_q:
        stats[q["type"]] += 1
    res = {"book": BOOKS[book]["title"], "book_id": book, "translation": "KRCBC",
           "source_url": "https://krcbcbible.org/kannada_bible.php",
           "chapter": ch, "chapter_label": f"ಅಧ್ಯಾಯ {ch}", "verses": len(vdict),
           "question_count": len(out_q), "manual_count": len(manual), "auto_count": len(auto),
           "type_counts": dict(stats), "questions": out_q}
    od = os.path.join(ROOT, "json", book)
    os.makedirs(od, exist_ok=True)
    path = os.path.join(od, f"{book}_ch{ch:02d}.json")
    json.dump(res, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{book} {ch}: manual {len(manual)} + auto {len(auto)} = {len(out_q)} questions -> {path}")
    print("types:", dict(stats))
    share = len(auto) / max(1, len(out_q))
    if len(out_q) < a.target:
        errors.append(f"only {len(out_q)} questions (< {a.target}); write more by hand")
    if share > a.max_auto_share:
        warns.append(f"auto share {share:.0%} above {a.max_auto_share:.0%}")
    for w in warns:
        print("WARN", w)
    for e in errors:
        print("ERROR", e)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
