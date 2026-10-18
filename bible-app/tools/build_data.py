#!/usr/bin/env python3
"""Bible data pipeline (build time only; Python 3 standard library).

Usage:
    python3 -I tools/build_data.py --work <download dir> --out <assets dir>

Downloads the World English Bible (USFM) and OpenBible.info topic votes into
<download dir> (reusing files already there), parses and validates them, then
writes into <assets dir>:

    bible.txt     one line per verse:  id TAB flags TAB heading TAB text
    books.txt     one line per book:   idx TAB code TAB name TAB abbr TAB testament TAB intro
    library.json  the curated verse-of-the-day library
    manifest.json source hashes, build date and the text version

Deterministic: same inputs, same outputs. The build fails if any validation
check fails.
"""
import argparse
import collections
import hashlib
import json
import os
import re
import sys
import urllib.request
import zipfile

WEB_URL = "https://ebible.org/Scriptures/engwebp_usfm.zip"
VOTES_URL = "https://a.openbible.info/data/topic-votes.txt"
TEXT_VERSION = "2026-10"

# (code, name, abbreviation, one-line intro). Order is canonical.
BOOKS = [
    ("GEN", "Genesis", "Gen", "The book of beginnings: creation, the first families, and the stories of Abraham, Isaac, Jacob and Joseph."),
    ("EXO", "Exodus", "Exod", "How God frees Israel from slavery in Egypt, gives the law at Sinai and comes to live among his people."),
    ("LEV", "Leviticus", "Lev", "Instructions for worship, offerings and holy living, given to Israel at Sinai."),
    ("NUM", "Numbers", "Num", "Israel's forty years in the wilderness, from the census at Sinai to the edge of the promised land."),
    ("DEU", "Deuteronomy", "Deut", "Moses' farewell speeches, calling Israel to remember the covenant before entering the land."),
    ("JOS", "Joshua", "Josh", "Joshua leads Israel into the promised land and divides it among the tribes."),
    ("JDG", "Judges", "Judg", "A cycle of failure and rescue as Israel is led by judges like Deborah, Gideon and Samson."),
    ("RUT", "Ruth", "Ruth", "A short story of loyalty and redemption, set in the days of the judges."),
    ("1SA", "1 Samuel", "1Sam", "The prophet Samuel anoints Israel's first kings, Saul and then David."),
    ("2SA", "2 Samuel", "2Sam", "David's reign as king of Israel, with its triumphs and its failures."),
    ("1KI", "1 Kings", "1Kgs", "Solomon builds the temple, then the kingdom divides and Elijah confronts its kings."),
    ("2KI", "2 Kings", "2Kgs", "The kings of Israel and Judah decline until both kingdoms are taken into exile."),
    ("1CH", "1 Chronicles", "1Chr", "A retelling of Israel's story from Adam to David, centred on the temple and worship."),
    ("2CH", "2 Chronicles", "2Chr", "From Solomon's temple to the exile and the call to return, told through the kings of Judah."),
    ("EZR", "Ezra", "Ezra", "The exiles return from Babylon to rebuild the temple and renew the law."),
    ("NEH", "Nehemiah", "Neh", "Nehemiah rebuilds the walls of Jerusalem and leads the people in renewing the covenant."),
    ("EST", "Esther", "Esth", "A Jewish queen in Persia risks her life to save her people."),
    ("JOB", "Job", "Job", "A righteous man suffers terribly, and he and his friends wrestle with why."),
    ("PSA", "Psalms", "Ps", "Israel's songbook of 150 prayers and praises: lament, thanks, trust and worship."),
    ("PRO", "Proverbs", "Prov", "Short sayings of wisdom about how to live well."),
    ("ECC", "Ecclesiastes", "Eccl", "A teacher reflects on work, pleasure and death, and asks what makes life meaningful."),
    ("SNG", "Song of Songs", "Song", "A series of love poems celebrating devotion between a bride and groom."),
    ("ISA", "Isaiah", "Isa", "The prophet Isaiah speaks of judgment and comfort, and of a coming servant and king."),
    ("JER", "Jeremiah", "Jer", "Jeremiah warns Judah of coming exile and promises a new covenant."),
    ("LAM", "Lamentations", "Lam", "Five poems of grief over the fall of Jerusalem."),
    ("EZK", "Ezekiel", "Ezek", "Ezekiel's visions among the exiles in Babylon: judgment first, then hope of restoration."),
    ("DAN", "Daniel", "Dan", "Stories of faithfulness in exile in Babylon, and visions of the future."),
    ("HOS", "Hosea", "Hos", "Hosea's own marriage pictures God's faithful love for an unfaithful Israel."),
    ("JOL", "Joel", "Joel", "A locust plague becomes a call to return to God, with a promise of his Spirit."),
    ("AMO", "Amos", "Amos", "A shepherd-prophet calls Israel to justice and honest worship."),
    ("OBA", "Obadiah", "Obad", "A short prophecy against Edom for its pride and cruelty."),
    ("JON", "Jonah", "Jonah", "A reluctant prophet is sent to Nineveh and learns about God's mercy."),
    ("MIC", "Micah", "Mic", "Micah calls for justice and mercy and promises a ruler from Bethlehem."),
    ("NAM", "Nahum", "Nah", "A prophecy about the fall of Nineveh."),
    ("HAB", "Habakkuk", "Hab", "Habakkuk questions God about injustice and learns to trust him."),
    ("ZEP", "Zephaniah", "Zeph", "A warning of the day of the LORD, with a promise to restore a humble remnant."),
    ("HAG", "Haggai", "Hag", "Haggai urges the returned exiles to finish rebuilding the temple."),
    ("ZEC", "Zechariah", "Zech", "Visions and promises that encourage the rebuilding of the temple and look to a coming king."),
    ("MAL", "Malachi", "Mal", "The last prophet of the Old Testament calls the people back to faithful worship."),
    ("MAT", "Matthew", "Matt", "The life and teaching of Jesus, written to show him as Israel's promised king."),
    ("MRK", "Mark", "Mark", "The shortest and fastest-moving account of Jesus' life and ministry."),
    ("LUK", "Luke", "Luke", "Luke's orderly account of Jesus' life, written so a reader could be sure of what they had been taught."),
    ("JHN", "John", "John", "An account of Jesus' life written so that readers will believe and have life."),
    ("ACT", "Acts", "Acts", "How the good news spreads from Jerusalem across the Roman world."),
    ("ROM", "Romans", "Rom", "Paul explains the gospel and how it changes the way we live."),
    ("1CO", "1 Corinthians", "1Cor", "Paul answers questions and problems in the divided church in Corinth."),
    ("2CO", "2 Corinthians", "2Cor", "Paul defends his ministry and writes about weakness, comfort and generosity."),
    ("GAL", "Galatians", "Gal", "Paul insists that we are made right with God by faith, not by keeping the law."),
    ("EPH", "Ephesians", "Eph", "Paul describes the church as one family in Christ, and how to live as one."),
    ("PHP", "Philippians", "Phil", "A warm letter of joy, written by Paul from prison."),
    ("COL", "Colossians", "Col", "Paul shows that Christ is supreme over everything."),
    ("1TH", "1 Thessalonians", "1Th", "Paul encourages a young church to stand firm and hope in Christ's return."),
    ("2TH", "2 Thessalonians", "2Th", "Paul corrects confusion about Christ's return and urges steady work."),
    ("1TI", "1 Timothy", "1Tim", "Paul advises Timothy on leading and caring for the church."),
    ("2TI", "2 Timothy", "2Tim", "Paul's last letter, urging Timothy to stay faithful."),
    ("TIT", "Titus", "Titus", "Paul tells Titus how to order the church in Crete and teach good living."),
    ("PHM", "Philemon", "Phlm", "A personal appeal to welcome back a runaway slave as a brother."),
    ("HEB", "Hebrews", "Heb", "Shows that Jesus is greater than the prophets, the angels and the old priesthood."),
    ("JAS", "James", "Jas", "Practical advice on living out faith through action."),
    ("1PE", "1 Peter", "1Pet", "Peter encourages Christians who are suffering for their faith."),
    ("2PE", "2 Peter", "2Pet", "Peter warns against false teachers and urges growth in faith."),
    ("1JN", "1 John", "1Jn", "John writes about love, truth and knowing that we have eternal life."),
    ("2JN", "2 John", "2Jn", "A short letter urging truth and love, and caution about false teachers."),
    ("3JN", "3 John", "3Jn", "A short letter praising hospitality to traveling teachers."),
    ("JUD", "Jude", "Jude", "A short warning to defend the faith against false teachers."),
    ("REV", "Revelation", "Rev", "John's visions of Christ's victory and of a new heaven and a new earth."),
]
CODE_INDEX = {b[0]: i + 1 for i, b in enumerate(BOOKS)}

# Encouraging topics used to rank the widget's verse library (OpenBible topic names).
TOPIC_ALLOWLIST = [
    "hope", "peace", "comfort", "strength", "love", "joy", "faith", "trust", "encouragement",
    "anxiety", "fear", "fear not", "worry", "grace", "forgiveness", "patience", "perseverance",
    "gratitude", "thankfulness", "courage", "healing", "guidance", "wisdom", "kindness", "prayer",
    "rest", "mercy", "faithfulness", "contentment", "new beginnings", "overcoming fear",
    "difficult times", "hard times", "being strong", "protection", "provision", "renewal",
    "presence of god", "loneliness", "peace of mind", "goodness", "light", "purpose", "trials",
    "endurance", "salvation",
]

# Verses that carry only a footnote about a variant reading in this edition. They stay in the
# data (so verse counts and ids are standard) but have no text; the app skips them when showing.
EMPTY_OK = {42017036, 44008037, 44015034, 44024007, 45016025}

# Passages the automatic filters let through that read wrongly out of context or are not
# encouraging (reviewed by hand against the printed candidate list, `--show-candidates`).
LIBRARY_BLOCKLIST_REFS = set("""
Leviticus 20:13|Genesis 2:18|Romans 8:6–7|1 Peter 4:7|Matthew 6:7|Proverbs 15:18|Matthew 6:15
Romans 16:20|Matthew 11:2–3|Exodus 23:12|Romans 1:11–12|1 Timothy 1:16|James 1:6|Ecclesiastes 7:9
Romans 14:16–17|Job 11:18|1 Corinthians 14:32–33|Mark 2:27|Luke 18:1–2|Matthew 17:20|2 Timothy 4:1–2
Deuteronomy 31:2|1 Timothy 2:8|Exodus 34:21|1 Timothy 2:1–2|1 Peter 4:3|1 John 4:1|Philippians 4:3
Revelation 3:11|Proverbs 28:1|Matthew 8:24|Galatians 6:8|Acts 1:14|Matthew 24:42|John 16:32|James 4:2
Matthew 6:12|Job 13:15|Psalms 44:3|Proverbs 12:20|1 Corinthians 15:19|Acts 2:42|Mark 10:52|Proverbs 12:15
James 4:3|John 15:16|Mark 6:32|Matthew 27:46|Psalms 39:12|Ecclesiastes 5:12|1 Corinthians 1:18|Psalms 27:2
Psalms 66:17|Ezra 10:4|1 Peter 3:7|Proverbs 17:9|James 2:19|Proverbs 15:29|Romans 15:3|Genesis 29:20
Matthew 10:8|2 Timothy 1:6|1 Thessalonians 4:13|Matthew 10:28|Proverbs 11:17|Mark 10:18|Acts 4:31
Jeremiah 33:12|1 Corinthians 2:4–5|Acts 12:5|Psalms 37:37|1 Timothy 1:1–2|Psalms 25:2|Matthew 10:1
2 Timothy 4:16|Isaiah 57:1–2|Luke 6:12|1 Peter 3:1–2|Acts 16:25|Hebrews 4:4–5|Hebrews 10:2
Matthew 14:13|Proverbs 14:23|2 Corinthians 3:12–13|Luke 12:2|Revelation 14:12|Isaiah 53:3
1 Corinthians 4:17|Leviticus 23:3|Proverbs 20:3|1 Peter 5:8|Ezra 8:23|Numbers 23:19|Proverbs 13:2
Romans 1:20|Joel 3:16|Job 37:23|Proverbs 15:8|Romans 4:18|Psalms 42:3|Romans 11:22|Acts 9:31
1 Corinthians 15:1–2|1 Timothy 4:4|Revelation 3:10|Deuteronomy 31:3|Luke 1:35|1 Timothy 4:10
1 Corinthians 13:2|Revelation 14:13|Psalms 37:2|Luke 11:1|Matthew 6:9|Isaiah 48:22|2 Samuel 10:12
Matthew 6:2|Habakkuk 2:3|Psalms 90:3|Matthew 12:21|Deuteronomy 3:22|Mark 5:36|Psalms 38:9
""".replace("\n", "|").split("|")) - {""}


def fetch(url, path):
    if not os.path.exists(path):
        print("downloading", url)
        req = urllib.request.Request(url, headers={"User-Agent": "bible-app-data-pipeline"})
        with urllib.request.urlopen(req, timeout=300) as r, open(path, "wb") as f:
            f.write(r.read())
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


# --------------------------------------------------------------------------- USFM

W_RE = re.compile(r"\\\+?w ([^|\\]*?)(?:\|[^\\]*)?\\\+?w\*")
NOTE_RE = re.compile(r"\\(f|x)\b.*?\\\1\*", re.S)
CHAR_RE = re.compile(r"\\\+?[a-z]+\d?\*?")


def clean_inline(s):
    s = NOTE_RE.sub("", s)
    s = W_RE.sub(lambda m: m.group(1), s)
    s = CHAR_RE.sub("", s)
    s = s.replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\s+([,.;:!?])", r"\1", s)
    return s


def parse_book(path, book):
    """Returns list of dicts: ch, v, text, para, poetry, heading."""
    verses = []
    cur = None
    chapter = 0
    pending_break = False   # a paragraph/stanza break precedes the next verse
    pending_poetry = 0
    pending_heading = ""
    first_in_chapter = False
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    for raw in lines:
        line = raw.rstrip()
        if not line.startswith("\\"):
            continue
        m = re.match(r"\\(\+?[a-z]+\d?)\b ?(.*)", line)
        if not m:
            continue
        mk, rest = m.group(1), m.group(2)
        if mk == "c":
            chapter = int(rest.split()[0])
            pending_break = True
            first_in_chapter = True
            pending_heading = ""
            cur = None
        elif mk == "d":
            # Psalm titles follow the \c line: keep them as headings, never verse text.
            pending_heading = clean_inline(rest)
            cur = None
        elif mk in ("p", "pi1", "pi2", "mi", "nb") or (mk == "b"):
            if mk in ("p", "pi1", "pi2", "b"):
                pending_break = True
            pending_poetry = 0
            if rest.strip() and cur is not None:
                cur["text"] += " " + rest
        elif mk in ("q1", "q2", "q3", "q4", "qr", "qc", "qm1", "qm2"):
            level = 2 if mk in ("q2", "q3", "q4", "qm2") else 1
            pending_poetry = level
            if rest.strip().startswith("\\v "):
                pass
            elif rest.strip() and cur is not None:
                cur["text"] += " " + rest
                pending_break = False  # the break lies inside the verse
                continue
            else:
                continue
            # fallthrough handled below: line holds a verse after the marker
            m2 = re.match(r"\\v (\d+)\s*(.*)", rest.strip())
            if m2:
                cur = new_verse(verses, chapter, int(m2.group(1)), m2.group(2), pending_break, level, pending_heading)
                pending_break = False
                pending_heading = ""
        elif mk in ("m", "li1", "li2", "li3", "li4", "ili", "ili1", "ili2", "pm", "pmo", "pmc"):
            pending_poetry = 0
            if rest.strip() and cur is not None:
                cur["text"] += " " + rest
                pending_break = False
        elif mk == "v":
            m2 = re.match(r"(\d+)(?:-\d+)?\s*(.*)", rest)
            cur = new_verse(verses, chapter, int(m2.group(1)), m2.group(2), pending_break, pending_poetry, pending_heading)
            pending_break = False
            pending_heading = ""
        elif mk in ("qs", "k", "bk", "wj", "w", "+w", "sc", "nd", "add", "tl", "f", "x"):
            if cur is not None:
                cur["text"] += " " + line
                pending_break = False
        elif mk in ("ms1", "ms2", "s1", "s2", "s", "r", "sp", "is1", "ip", "cl", "mt1", "mt2", "mt3",
                    "toc1", "toc2", "toc3", "h", "id", "ide", "usfm", "cd"):
            continue
        else:
            # Unknown marker: continuation text for the current verse, if any.
            if cur is not None and rest.strip():
                cur["text"] += " " + rest
    for v in verses:
        v["text"] = clean_inline(v["text"])
    return verses


def new_verse(verses, ch, v, text, para, poetry, heading):
    d = {"ch": ch, "v": v, "text": text, "para": para, "poetry": poetry, "heading": heading}
    verses.append(d)
    return d


# --------------------------------------------------------------------------- units

SENT_END = re.compile(r"[.?!][\u2019\u201d\"')\]]*$")


def build_units(rows):
    """rows: list of (id, book, ch, v, text, words, para). Returns list of (first_idx, last_idx)."""
    units = []
    start = 0
    for i, r in enumerate(rows):
        last_in_chapter = i + 1 >= len(rows) or rows[i + 1][1:3] != r[1:3]
        if SENT_END.search(r[4]) or last_in_chapter:
            units.append((start, i))
            start = i + 1
    return units


# --------------------------------------------------------------------------- library

STOP_START = re.compile(r"^[\u201c\u2018\"']?[A-Z0-9]")


def trim_quotes(text):
    """Remove an orphan opening or closing quote at the very start or end. Never changes a word."""
    def count(s, a, b):
        return s.count(a), s.count(b)
    t = text
    # leading
    if t[:1] in "\u201c\u2018":
        a, b = (("\u201c", "\u201d") if t[0] == "\u201c" else ("\u2018", "\u2019"))
        if t.count(a) > t.count(b):
            t = t[1:].lstrip()
    # trailing
    if t[-1:] in "\u201d\u2019":
        a, b = (("\u201c", "\u201d") if t[-1] == "\u201d" else ("\u2018", "\u2019"))
        if t.count(b) > t.count(a) and not (b == "\u2019" and re.search(r"s\u2019$", t)):
            t = t[:-1].rstrip()
    return t


def first_sentence(text):
    m = re.search(r"[.?!][\u2019\u201d\"')\]]*(?=\s|$)", text)
    if not m:
        return text
    return text[: m.end()]


def curate_library(votes_path, ref_rows, verse_by_id, id_to_idx):
    score = collections.defaultdict(lambda: [0, collections.Counter()])
    allowed = set(TOPIC_ALLOWLIST)
    with open(votes_path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or line.startswith("Topic\t"):
                continue
            p = line.rstrip("\n").split("\t")
            if len(p) < 4 or p[0] not in allowed:
                continue
            try:
                s = int(p[1])
                e = int(p[2]) if p[2] else s
                votes = int(p[3])
            except ValueError:
                continue
            if votes <= 0:
                continue
            sid = (s // 1000000) * 1000000 + ((s // 1000) % 1000) * 1000 + s % 1000
            eid = (e // 1000000) * 1000000 + ((e // 1000) % 1000) * 1000 + e % 1000
            # OpenBible ids are bbcccvvv; convert to our book*1e6 + ch*1e3 + v.
            def conv(x):
                b, c, v = x // 1000000, (x // 1000) % 1000, x % 1000
                return b * 1000000 + c * 1000 + v
            s2, e2 = conv(s), conv(e)
            if s2 not in id_to_idx or e2 not in id_to_idx:
                continue
            if id_to_idx[e2] - id_to_idx[s2] > 2 or id_to_idx[e2] < id_to_idx[s2]:
                continue
            key = (s2, e2)
            score[key][0] += votes
            score[key][1][p[0]] += votes
    cands = []
    for (s, e), (sc, topics) in score.items():
        i0, i1 = id_to_idx[s], id_to_idx[e]
        # Completeness: capital start, sentence-punctuation end; try extending one verse either way.
        best = None
        for a, b in ((i0, i1), (i0 - 1, i1), (i0, i1 + 1)):
            if a < 0 or b >= len(ref_rows) or b - a > 2:
                continue
            if ref_rows[a][1] != ref_rows[b][1]:
                continue
            txt = " ".join(r[4] for r in ref_rows[a:b + 1])
            txt = trim_quotes(txt)
            if not txt or not STOP_START.match(txt) or not SENT_END.search(txt):
                continue
            if len(txt.split()) > 45:
                continue
            # A fragment that starts with a lowercase continuation or "and/but/for" is still allowed
            # only if it begins a capitalised sentence (checked above).
            best = (a, b, txt)
            break
        if best is None:
            continue
        a, b, txt = best
        cands.append((sc, ref_rows[a][0], ref_rows[b][0], txt, topics.most_common(1)[0][0]))
    # Remove overlaps, keeping the higher score.
    cands.sort(key=lambda c: (-c[0], c[1]))
    taken = []
    used = set()
    for sc, s, e, txt, topic in cands:
        ia, ib = id_to_idx[s], id_to_idx[e]
        if any(i in used for i in range(ia, ib + 1)):
            continue
        for i in range(ia, ib + 1):
            used.add(i)
        taken.append((sc, s, e, txt, topic))
    return taken


def ref_str(s, e):
    b, c, v = s // 1000000, (s // 1000) % 1000, s % 1000
    name = BOOKS[b - 1][1]
    if e == s:
        return f"{name} {c}:{v}"
    ec, ev = (e // 1000) % 1000, e % 1000
    return f"{name} {c}:{v}\u2013{ev}" if ec == c else f"{name} {c}:{v}\u2013{ec}:{ev}"


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--library-size", type=int, default=366)
    ap.add_argument("--show-candidates", type=int, default=0)
    args = ap.parse_args()
    os.makedirs(args.work, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)

    web_zip = os.path.join(args.work, "web.zip")
    votes = os.path.join(args.work, "votes.txt")
    h_web = fetch(WEB_URL, web_zip)
    h_votes = fetch(VOTES_URL, votes)
    usfm_dir = os.path.join(args.work, "usfm")
    if not os.path.isdir(usfm_dir):
        with zipfile.ZipFile(web_zip) as z:
            z.extractall(usfm_dir)

    files = {}
    for fn in os.listdir(usfm_dir):
        m = re.match(r"\d+-([0-9A-Z]{3})engwebp\.usfm$", fn)
        if m and m.group(1) in CODE_INDEX:
            files[m.group(1)] = os.path.join(usfm_dir, fn)
    missing = [b[0] for b in BOOKS if b[0] not in files]
    if missing:
        sys.exit(f"missing books: {missing}")

    rows = []  # (id, book, ch, v, text, words, para, poetry, heading)
    for code, _, _, _ in BOOKS:
        bi = CODE_INDEX[code]
        for v in parse_book(files[code], code):
            vid = bi * 1000000 + v["ch"] * 1000 + v["v"]
            words = len(v["text"].split())
            rows.append((vid, bi, v["ch"], v["v"], v["text"], words, v["para"], v["poetry"], v["heading"]))

    # ---- validation
    errors = []
    n_books = len({r[1] for r in rows})
    n_chapters = len({(r[1], r[2]) for r in rows})
    total_words = sum(r[5] for r in rows)
    if n_books != 66: errors.append(f"books {n_books} != 66")
    if n_chapters != 1189: errors.append(f"chapters {n_chapters} != 1189")
    if len(rows) != 31103: errors.append(f"verses {len(rows)} != 31103")
    if abs(total_words - 756000) > 7560: errors.append(f"total words {total_words} not within 1% of 756,000")
    for r in rows:
        if "\\" in r[4] or "|strong=" in r[4] or (not r[4] and r[0] not in EMPTY_OK):
            errors.append(f"bad verse text at {r[0]}: {r[4][:60]!r}")
        if r[5] >= 100:
            errors.append(f"verse {r[0]} has {r[5]} words (>= 100)")
    if len({r[0] for r in rows}) != len(rows): errors.append("duplicate verse ids")
    ids_sorted = [r[0] for r in rows]
    if ids_sorted != sorted(ids_sorted): errors.append("verses not in canonical order")
    psa23_6 = next(r for r in rows if r[0] == 19023006)
    if psa23_6[4].endswith("A Psalm by David."): errors.append("Psalm 23:6 title regression")
    if next(r for r in rows if r[0] == 19024001)[8] != "A Psalm by David.": errors.append("Psalm 24 title missing")

    id_to_idx = {r[0]: i for i, r in enumerate(rows)}
    units = build_units([(r[0], r[1], r[2], r[3], r[4], r[5], r[6]) for r in rows])
    for (a, b) in units:
        last = rows[b]
        nxt_same_chapter = b + 1 < len(rows) and rows[b + 1][1:3] == last[1:3]
        if nxt_same_chapter and not SENT_END.search(last[4]):
            errors.append(f"unit ends without sentence punctuation at {last[0]}")

    # ---- library
    taken = curate_library(votes, rows, None, id_to_idx)
    if args.show_candidates:
        for sc, s, e, txt, topic in taken[: args.show_candidates]:
            print(f"{sc:5d} {ref_str(s, e):28s} [{topic}] {txt}")
    keep = [t for t in taken if ref_str(t[1], t[2]) not in LIBRARY_BLOCKLIST_REFS][: args.library_size]
    library = []
    for sc, s, e, txt, topic in keep:
        library.append({
            "first": s, "last": e, "ref": ref_str(s, e), "text": txt,
            "words": len(txt.split()), "chars": len(txt),
            "sentence": first_sentence(txt), "topic": topic, "score": sc,
        })
    if len(library) < args.library_size:
        errors.append(f"library has {len(library)} verses, wanted {args.library_size}")
    for item in library:
        if item["words"] > 45 or not SENT_END.search(item["text"]):
            errors.append(f"library verse invalid: {item['ref']}")

    if errors:
        print("VALIDATION FAILED:")
        for e in errors[:40]:
            print("  ", e)
        sys.exit(1)

    # ---- write outputs
    with open(os.path.join(args.out, "bible.txt"), "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            flags = (1 if r[6] else 0) | (r[7] << 1)
            f.write(f"{r[0]}\t{flags}\t{r[8]}\t{r[4]}\n")
    with open(os.path.join(args.out, "books.txt"), "w", encoding="utf-8", newline="\n") as f:
        for i, (code, name, abbr, intro) in enumerate(BOOKS, 1):
            f.write(f"{i}\t{code}\t{name}\t{abbr}\t{'OT' if i <= 39 else 'NT'}\t{intro}\n")
    with open(os.path.join(args.out, "library.json"), "w", encoding="utf-8") as f:
        json.dump(library, f, ensure_ascii=False, indent=0)
    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({
            "textVersion": TEXT_VERSION, "translation": "WEB", "edition": "engwebp",
            "sources": {"web": {"url": WEB_URL, "sha256": h_web}, "openbible": {"url": VOTES_URL, "sha256": h_votes}},
            "counts": {"books": n_books, "chapters": n_chapters, "verses": len(rows), "words": total_words,
                       "units": len(units), "paragraphStarts": sum(1 for r in rows if r[6]),
                       "library": len(library)},
        }, f, indent=1)

    # ---- summary for human review
    ot = sum(r[5] for r in rows if r[1] <= 39)
    print(f"books {n_books}  chapters {n_chapters}  verses {len(rows)}  words {total_words} (OT {ot}, NT {total_words - ot})")
    print(f"units {len(units)}  paragraph starts {sum(1 for r in rows if r[6])}  library {len(library)}")
    uw = sorted(((sum(rows[i][5] for i in range(a, b + 1)), a, b) for a, b in units), reverse=True)
    print("longest units:")
    for w, a, b in uw[:10]:
        print(f"  {w:4d} words  {ref_str(rows[a][0], rows[b][0])}")


if __name__ == "__main__":
    main()
