#!/usr/bin/env python3
"""Quality audit of all chapter JSON files against the kit's rules (QUESTION_GENERATION_GUIDE B2/B6)."""
import json, glob, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_chapter import norm, STOP, BANNED
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
texts = {b: norm(" ".join(" ".join(c.values()) for c in json.load(open(f"{ROOT}/source/{b}_verses.json"))["chapters"].values()))
         for b in ("ruth", "galatians", "john")}
allt = " ".join(texts.values())
issues = collections.defaultdict(list)
summary = []
for f in sorted(glob.glob(f"{ROOT}/json/*/*_ch*.json")):
    d = json.load(open(f)); bid = d["book_id"]; ch = d["chapter"]; tag = f"{bid} {ch}"
    qs = d["questions"]; n = len(qs)
    tc = collections.Counter(q["type"] for q in qs)
    top, topn = tc.most_common(1)[0]
    man = sum(q["source"] == "manual" for q in qs)
    summary.append((tag, n, man, n - man, top, round(100 * topn / n)))
    if n < 250: issues["count<250"].append(tag)
    seen = {}
    for q in qs:
        k = f"{tag} #{q['number']}"
        Q, A = q["question"], q["answer"]
        if not q["refs"]: issues["no ref"].append(k)
        if not A.strip(): issues["empty answer"].append(k)
        nq = norm(Q)
        if nq in seen: issues["duplicate"].append(f"{k} = #{seen[nq]}")
        seen[nq] = q["number"]
        for t in (Q, A):
            for bad, good in BANNED.items():
                if bad in t and good not in t: issues["non-KRCBC word"].append(f"{k}: {bad}")
            if re.search(r"ಯೇಸು(ಸ್ವಾಮಿ)? [^ ]*(ದನು|ಹೇಳಿದನು|ಮಾಡಿದನು|ಕೇಳಿದನು)\b", t): issues["Jesus singular verb"].append(k)
        if bid != "general":
            for qt in re.findall(r"[“‘]([^”’]{6,})[”’]", Q + " " + A):
                segs = [norm(s) for s in re.split(r"______|…", qt) if norm(s)]
                if not all(s in allt for s in segs): issues["quote not in KRCBC"].append(f"{k}: {qt[:50]}")
        if q["type"] == "fill":
            for w in A.split("; "):
                if w in STOP or len(w) < 3: issues["weak blank word"].append(f"{k}: {w}")
                body = Q.split("“", 1)[-1]
                if body.count(w) >= 1 and w in body.replace("______", ""): issues["blank answer also visible in sentence"].append(f"{k}: {w}")
            if Q.rstrip("”").rstrip().endswith(","): issues["fragment ends with comma"].append(k)
        if q["type"] == "continue":
            if len(A.replace("“… ", "").split()) < 2: issues["continue answer too short"].append(k)
        if q["source"] == "manual" and q["type"] not in ("quote", "speaker", "which", "list", "synthesis") and len(A) > 12 and norm(A) in norm(Q):
            issues["answer leaked in question"].append(f"{k}: {A[:40]}")
print(f"{'chapter':14} total manual auto  top-type share%")
for s in summary: print(f"{s[0]:14} {s[1]:5} {s[2]:6} {s[3]:4}  {s[4]:9} {s[5]}")
print("TOTAL", sum(s[1] for s in summary))
for k, v in issues.items():
    print(f"\n## {k}: {len(v)}")
    for x in v[:12]: print("  ", x)
