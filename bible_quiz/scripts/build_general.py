#!/usr/bin/env python3
"""Build the 'General Questions' set.

Section 1  ಗ್ರಂಥಗಳ ಪರಿಚಯ     – hand-written, from the KRCBC introductions (ಮುನ್ನುಡಿ) and contents (ಪರಿವಿಡಿ)
Section 2  KRCBC ಬೈಬಲ್ ಗ್ರಂಥಗಳು – generated from the KRCBC book list (titles read from each book PDF)
Section 3  ಭಾಗಗಳ ಸಾಮಾನ್ಯ ಪ್ರಶ್ನೆಗಳು – hand-written questions across Ruth, Galatians and John 1–12

Input  authoring/general.txt  (section | refs | type | question | answer)
Output json/general/general_secN.json  (same shape as chapter JSON, so render_html works)
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from books import ROOT
from build_chapter import norm, BANNED, difficulty

NUM = {1: "ಒಂದು", 2: "ಎರಡು", 3: "ಮೂರು", 4: "ನಾಲ್ಕು", 13: "ಹದಿಮೂರು", 16: "ಹದಿನಾರು",
       27: "ಇಪ್ಪತ್ತೇಳು", 46: "ನಲವತ್ತಾರು", 73: "ಎಪ್ಪತ್ತಮೂರು", 21: "ಇಪ್ಪತ್ತೊಂದು"}
ORD = ["", "ಮೊದಲನೆಯ", "ಎರಡನೆಯ", "ಮೂರನೆಯ", "ನಾಲ್ಕನೆಯ", "ಐದನೆಯ"]
SECTIONS = {1: "ಗ್ರಂಥಗಳ ಪರಿಚಯ (ಮುನ್ನುಡಿ ಮತ್ತು ಪರಿವಿಡಿ)",
            2: "KRCBC ಬೈಬಲಿನ ಗ್ರಂಥಗಳು",
            3: "ರಸಪ್ರಶ್ನೆಯ ಭಾಗಗಳನ್ನು ಕುರಿತ ಸಾಮಾನ್ಯ ಪ್ರಶ್ನೆಗಳು"}


def canon_questions(books):
    REF = "KRCBC ಗ್ರಂಥಪಟ್ಟಿ"
    ot = [b for b in books if b["n"] <= 46]
    nt = [b for b in books if b["n"] > 46]
    q = []
    add = lambda t, qu, a: q.append({"refs": [REF], "type": t, "question": qu, "answer": a, "source": "auto"})
    add("howmany", "KRCBC ಕನ್ನಡ ಬೈಬಲಿನಲ್ಲಿ ಒಟ್ಟು ಎಷ್ಟು ಗ್ರಂಥಗಳಿವೆ?", f"{len(books)} (ಎಪ್ಪತ್ತಮೂರು)")
    add("howmany", "KRCBC ಬೈಬಲಿನ ಹಳೆಯ ಒಡಂಬಡಿಕೆಯಲ್ಲಿ ಎಷ್ಟು ಗ್ರಂಥಗಳಿವೆ?", f"{len(ot)} (ನಲವತ್ತಾರು)")
    add("howmany", "KRCBC ಬೈಬಲಿನ ಹೊಸ ಒಡಂಬಡಿಕೆಯಲ್ಲಿ ಎಷ್ಟು ಗ್ರಂಥಗಳಿವೆ?", f"{len(nt)} (ಇಪ್ಪತ್ತೇಳು)")
    add("list", "KRCBC ಬೈಬಲಿನ ಎರಡು ಮುಖ್ಯ ಭಾಗಗಳು ಯಾವುವು?", "ಹಳೆಯ ಒಡಂಬಡಿಕೆ ಮತ್ತು ಹೊಸ ಒಡಂಬಡಿಕೆ")
    add("what", "KRCBC ಬೈಬಲಿನ ಮೊದಲನೆಯ ಗ್ರಂಥ ಯಾವುದು?", books[0]["title"])
    add("what", "KRCBC ಬೈಬಲಿನ ಕೊನೆಯ ಗ್ರಂಥ ಯಾವುದು?", books[-1]["title"])
    add("what", "KRCBC ಬೈಬಲಿನ ಹಳೆಯ ಒಡಂಬಡಿಕೆಯ ಕೊನೆಯ ಗ್ರಂಥ ಯಾವುದು?", ot[-1]["title"])
    add("what", "KRCBC ಬೈಬಲಿನ ಹೊಸ ಒಡಂಬಡಿಕೆಯ ಮೊದಲನೆಯ ಗ್ರಂಥ ಯಾವುದು?", nt[0]["title"])
    gospels = [b for b in books if "ಶುಭಸಂದೇಶ" in b["title"]]
    add("howmany", "KRCBC ಹೊಸ ಒಡಂಬಡಿಕೆಯಲ್ಲಿ ಎಷ್ಟು ಶುಭಸಂದೇಶಗಳಿವೆ?", f"{len(gospels)} (ನಾಲ್ಕು)")
    add("list", "KRCBC ಹೊಸ ಒಡಂಬಡಿಕೆಯ ನಾಲ್ಕು ಶುಭಸಂದೇಶಗಳನ್ನು ಕ್ರಮವಾಗಿ ಹೆಸರಿಸಿ.", "; ".join(f"{i+1}) {b['title']}" for i, b in enumerate(gospels)))
    for i, b in enumerate(gospels, 1):
        add("what", f"KRCBC ಹೊಸ ಒಡಂಬಡಿಕೆಯ {ORD[i]} ಶುಭಸಂದೇಶ ಯಾವುದು?", b["title"])
    paul = [b for b in books if b["title"].startswith("ಪೌಲನು")]
    add("howmany", "KRCBC ಬೈಬಲಿನಲ್ಲಿ ‘ಪೌಲನು … ಬರೆದ ಪತ್ರ’ ಎಂಬ ಶೀರ್ಷಿಕೆಯ ಪತ್ರಗಳು ಎಷ್ಟು?", f"{len(paul)} (ಹದಿಮೂರು)")
    add("what", "KRCBC ಬೈಬಲಿನಲ್ಲಿ ಪೌಲನ ಪತ್ರಗಳಲ್ಲಿ ಮೊದಲನೆಯದು ಯಾವುದು?", paul[0]["title"])
    add("what", "KRCBC ಬೈಬಲಿನಲ್ಲಿ ಪೌಲನ ಪತ್ರಗಳಲ್ಲಿ ಕೊನೆಯದು ಯಾವುದು?", paul[-1]["title"])
    gi = [b["n"] for b in paul].index(55) + 1
    add("what", "KRCBC ಬೈಬಲಿನ ಪೌಲನ ಪತ್ರಗಳ ಕ್ರಮದಲ್ಲಿ ಗಲಾತ್ಯರಿಗೆ ಬರೆದ ಪತ್ರ ಎಷ್ಟನೆಯದು?", f"{ORD[gi] if gi < len(ORD) else gi} ({gi}ನೆಯ)")
    prophets = [b for b in books if b["title"].startswith("ಪ್ರವಾದಿ")]
    add("howmany", "KRCBC ಹಳೆಯ ಒಡಂಬಡಿಕೆಯಲ್ಲಿ ‘ಪ್ರವಾದಿ … ಗ್ರಂಥ’ ಎಂಬ ಶೀರ್ಷಿಕೆಯ ಗ್ರಂಥಗಳು ಎಷ್ಟು?", f"{len(prophets)} (ಹದಿನಾರು)")
    add("what", "KRCBC ಬೈಬಲಿನಲ್ಲಿ ‘ಪ್ರವಾದಿ … ಗ್ರಂಥ’ ಎಂಬ ಶೀರ್ಷಿಕೆಯ ಮೊದಲ ಗ್ರಂಥ ಯಾವುದು?", prophets[0]["title"])
    add("what", "KRCBC ಬೈಬಲಿನಲ್ಲಿ ‘ಪ್ರವಾದಿ … ಗ್ರಂಥ’ ಎಂಬ ಶೀರ್ಷಿಕೆಯ ಕೊನೆಯ ಗ್ರಂಥ ಯಾವುದು?", prophets[-1]["title"])
    yov = [b for b in books if b["title"].startswith("ಯೊವಾನ್ನನು")]
    add("list", "KRCBC ಬೈಬಲಿನಲ್ಲಿ ‘ಯೊವಾನ್ನನು’ ಎಂಬ ಹೆಸರಿನಿಂದ ಆರಂಭವಾಗುವ ಗ್ರಂಥಗಳು ಯಾವುವು?", "; ".join(b["title"] for b in yov))
    add("howmany", "KRCBC ಬೈಬಲಿನಲ್ಲಿ ‘ಯೊವಾನ್ನನು ಬರೆದ … ಪತ್ರ’ಗಳು ಎಷ್ಟು?", f"{sum('ಪತ್ರ' in b['title'] for b in yov)} (ಮೂರು)")
    for key, bid in (("ರೂತಳು", 8), ("ಗಲಾತ್ಯರಿಗೆ ಬರೆದ ಪತ್ರ", 55), ("ಯೊವಾನ್ನನು ಬರೆದ ಶುಭಸಂದೇಶ", 50)):
        b = books[bid - 1]
        add("what", f"KRCBC ಬೈಬಲಿನ ಗ್ರಂಥಗಳ ಕ್ರಮದಲ್ಲಿ ‘{b['title']}’ ಎಷ್ಟನೆಯ ಗ್ರಂಥ?", f"{bid}ನೆಯ ಗ್ರಂಥ")
        add("what", f"‘{b['title']}’ ಯಾವ ಒಡಂಬಡಿಕೆಗೆ ಸೇರಿದೆ?", b["testament"])
        add("what", f"KRCBC ಬೈಬಲಿನಲ್ಲಿ ‘{b['title']}’ ಗ್ರಂಥಕ್ಕೆ ಮುಂಚಿನ ಗ್ರಂಥ ಯಾವುದು?", books[bid - 2]["title"])
    # what comes after each book
    for a, b in zip(books, books[1:]):
        add("what", f"KRCBC ಬೈಬಲಿನ ಗ್ರಂಥಗಳ ಕ್ರಮದಲ್ಲಿ ‘{a['title']}’ ಗ್ರಂಥದ ನಂತರ ಬರುವ ಗ್ರಂಥ ಯಾವುದು?", b["title"])
    # testament of selected books
    for n in (17, 18, 20, 21, 27, 28, 32, 51, 65, 66, 72, 73, 22, 31, 7):
        b = books[n - 1]
        add("what", f"‘{b['title']}’ ಯಾವ ಒಡಂಬಡಿಕೆಗೆ ಸೇರಿದ ಗ್ರಂಥ?", b["testament"])
    return q


def main():
    books = json.load(open(os.path.join(ROOT, "source", "krcbc_books.json"), encoding="utf-8"))["books"]
    texts = " ".join(open(os.path.join(ROOT, "source", f"{b}_uni.txt"), encoding="utf-8").read() for b in ("ruth", "galatians", "john"))
    alltext = norm(texts.replace("ಹ¯ವಾರು", "ಹಲವಾರು"))
    items = {1: [], 2: canon_questions(books), 3: []}
    errors = []
    for ln, line in enumerate(open(os.path.join(ROOT, "authoring", "general.txt"), encoding="utf-8"), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        p = [x.strip() for x in line.split("|")]
        if len(p) != 5:
            sys.exit(f"general.txt:{ln}: expected 5 fields")
        sec, refs, t, qu, a = p
        it = {"refs": [r.strip() for r in refs.split(";")], "type": t, "question": qu, "answer": a, "source": "manual", "line": ln}
        for txt in (qu, a):
            for bad, good in BANNED.items():
                if bad in txt and good not in txt:
                    errors.append(f"line {ln}: non-KRCBC word '{bad}'")
            for qt in re.findall(r"[“‘]([^”’]{6,})[”’]", txt):
                segs = [norm(s) for s in re.split(r"…", qt) if norm(s)]
                if not all(s in alltext for s in segs):
                    errors.append(f"line {ln}: quote not in KRCBC text: {qt[:70]}")
        items[int(sec)].append(it)
    seen = set()
    od = os.path.join(ROOT, "json", "general")
    os.makedirs(od, exist_ok=True)
    total = 0
    for sec, lst in items.items():
        out = []
        for n, it in enumerate(lst, 1):
            k = norm(it["question"])
            if k in seen:
                errors.append(f"duplicate: {it['question'][:60]}")
            seen.add(k)
            out.append({"number": n, "type": it["type"], "difficulty": difficulty(it["type"]), "question": it["question"],
                        "answer": it["answer"], "refs": it["refs"], "source": it["source"]})
        total += len(out)
        res = {"book": "ಸಾಮಾನ್ಯ ಪ್ರಶ್ನೆಗಳು", "book_id": "general", "translation": "KRCBC",
               "source_url": "https://krcbcbible.org/kannada_bible.php", "chapter": sec,
               "chapter_label": f"ಭಾಗ {sec}", "section_title": SECTIONS[sec], "verses": None,
               "question_count": len(out), "questions": out}
        json.dump(res, open(os.path.join(od, f"general_ch{sec:02d}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"section {sec}: {len(out)} questions")
    print("total", total)
    for e in errors:
        print("ERROR", e)
    sys.exit(1 if errors or total < 250 else 0)


if __name__ == "__main__":
    main()
