"""Build the six HTML documents of a study pack.

usage: python3 -I <skill>/engine/build.py <pack_dir>

<pack_dir>/pack.py      PACK metadata (+ optionally any content lists)
<pack_dir>/parts/*.py   content lists (TOPICS, FORMULAS, …) — merged in filename order
Writes <pack_dir>/output/*.html and copies assets (css, fonts, katex) into <pack_dir>/output/assets/.
See references/content-schema.md for every field.
"""
import datetime, glob, html, importlib.util, json, os, re, shutil, subprocess, sys

ENGINE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ENGINE)
import lib as L  # noqa: E402

LISTS = ["MODULES", "TOPICS", "DEFS", "STATEMENTS", "POINTS", "WHY", "TRAPS", "FORMULAS", "SYMBOLS", "WORKED",
         "PYQS", "NOTES", "KEYWORDS", "RAPID", "TOP_FACTS", "TOP_FORMULAS", "FIGS", "FLOWS", "COMPARISONS", "MNEMONICS"]
DOCS = [("01", "formulas_and_symbols", "Formulas and symbols"),
        ("02", "important_points", "Important points"),
        ("03", "graphs_and_diagrams", "Graphs and diagrams"),
        ("04", "flowcharts_and_visuals", "Flowcharts and visuals"),
        ("05", "short_notes_keywords", "Short notes and keywords")]

LEGEND_ROWS = [
    ("ESA ★★★", "Asked repeatedly in past ESA papers"),
    ("ESA ★★", "Asked in past ESA papers or computed in class-work problems"),
    ("ESA ★", "Conceptual: taught in class, not examined so far"),
    ('<span class="flag">added for clarity</span>', "Standard context that is not in the class material"),
    ('<span class="flag">transcript only</span>', "Said in the lecture but not on any slide"),
    ('<span class="flag">video only</span>', "Seen only in a frame of the class video"),
    ('<span class="flag">not on current slides</span>', "From older material or past papers, not this year's slides"),
]


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def load_pack(pack_dir):
    files = [os.path.join(pack_dir, "pack.py")] + sorted(glob.glob(os.path.join(pack_dir, "parts", "*.py")))
    K = {k: [] for k in LISTS}
    K["PACK"] = {}
    for i, f in enumerate(files):
        m = load_module(f, f"packpart{i}")
        if hasattr(m, "PACK"):
            K["PACK"].update(m.PACK)
        for k in LISTS:
            K[k] += list(getattr(m, k, []))
    order = K["PACK"].get("topic_order")
    if order:
        K["TOPICS"].sort(key=lambda t: order.index(t["id"]) if t["id"] in order else 10**6)
    ids = [x["id"] for k in ("TOPICS", "FORMULAS", "WORKED", "FIGS", "FLOWS", "COMPARISONS") for x in K[k]]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        sys.exit(f"duplicate ids: {dup}")
    return K


class Pack:
    def __init__(self, K, pack_dir):
        self.K, self.dir = K, pack_dir
        self.P = K["PACK"]
        self.T = K["TOPICS"]
        self.num = {t["id"]: i + 1 for i, t in enumerate(self.T)}
        self.master = f'00_MASTER_{self.P["slug"]}'
        self.today = self.P.get("date") or datetime.date.today().strftime("%d %B %Y")
        self.module_of = {}
        for m in K["MODULES"]:
            for t in m["topics"]:
                self.module_of[t] = m

    def by(self, key, topic):
        return [x for x in self.K[key] if x.get("topic") == topic]

    # -------------------------------------------------------------- shell
    def legend(self):
        rows = "".join(f'<span>{a}</span><span>{b}</span>' for a, b in LEGEND_ROWS)
        tags = self.P.get("tag_legend", [])
        rows += "".join(f'<span class="src">{a}</span><span>{b}</span>' for a, b in tags)
        return f'<div class="legend">{rows}</div>'

    def head(self, title, sub):
        return (f'<header class="doc-head"><div class="kicker">{self.P["course"]} · {self.P["unit"]}</div><h1>{title}</h1>'
                f'<div class="sub">{sub}</div><div class="small" style="margin-top:6px">{self.P["scope"]} · compiled {self.today}</div></header>')

    def toc(self, items):
        lis = "".join(f'<li><a href="#{i}">{t}</a></li>' for i, t in items)
        return f'<nav id="toc" class="toc"><h4>Contents</h4><ol>{lis}</ol></nav>'

    def topic_items(self):
        return [(t["id"], f'{self.num[t["id"]]} · {t["title"]}') for t in self.T]

    def page(self, title, body):
        return ("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
                f"<title>{title}</title><link rel=\"stylesheet\" href=\"assets/katex/katex.min.css\">"
                "<link rel=\"stylesheet\" href=\"assets/study.css\"></head><body><main class=\"page\">"
                f"{body}</main></body></html>")

    def topic_sections(self, render, first_cls=True, skip_empty=True):
        """Yield topic sections, inserting module banners when the module changes."""
        out, cur, first = [], None, first_cls
        for t in self.T:
            inner = render(t)
            if skip_empty and not inner:
                continue
            m = self.module_of.get(t["id"])
            if m and m is not cur:
                out.append(f'<div class="module-banner" id="{m["id"]}"><div class="mnum">{m["id"]}</div><div class="mtitle">{m["title"]}</div></div>')
                cur = m
                first = True
            cls = "topic first" if first else "topic"
            first = False
            out.append(f'<section class="{cls}" id="{t["id"]}" data-topic="{t["id"]}">{L.h2(self.num[t["id"]], t["title"])}{inner}</section>')
        return "".join(out)

    def symbols_table(self):
        has_unit = any(s.get("unit") for s in self.K["SYMBOLS"])
        th = "<th>Symbol</th><th>Name</th><th>Meaning</th>" + ("<th>Unit</th>" if has_unit else "") + "<th>Appears in</th>"
        rows = "".join("<tr><td class=sym>{}</td><td>{}</td><td>{}</td>{}<td>{}</td></tr>".format(
            s["sym"], s["name"], s["meaning"], f'<td>{s.get("unit", "")}</td>' if has_unit else "", s.get("where", ""))
            for s in self.K["SYMBOLS"])
        return f'<table class="t"><thead><tr>{th}</tr></thead><tbody>{rows}</tbody></table>'

    def flows(self, topic):
        return "".join(L.flowchart(f) for f in self.by("FLOWS", topic))

    def figs(self, topic):
        return "".join(L.figure(g["id"], g) for g in self.by("FIGS", topic))

    def comps(self, topic):
        return "".join(L.comparison(c) for c in self.by("COMPARISONS", topic))

    def pyqs(self, topic, in_master):
        pre = "" if in_master else f"{self.master}.html"
        return "".join(L.pyq(p, pre) for p in self.by("PYQS", topic))

    def note(self, topic):
        n = self.by("NOTES", topic)
        return n[0]["text"] if n else ""

    # -------------------------------------------------------------- documents
    def doc01(self):
        b = [self.head("Formulas and symbols", "Every formula in scope, then a glossary of every symbol used."), self.legend(),
             self.toc([("partA", "Part A · Formula sheet")] + [ti for ti in self.topic_items() if self.by("FORMULAS", ti[0])] + [("partB", "Part B · Symbol glossary")]
                      + ([("partC", "Part C · Notation and conversions")] if self.P.get("notation_table") else []))]
        b.append(f'<section class="part first" id="partA">{L.h2("A", "Formula sheet")}')
        for t in self.T:
            fs = self.by("FORMULAS", t["id"])
            if fs:
                b.append(f'<div id="{t["id"]}">{L.h3(self.num[t["id"]], t["title"])}' + "".join(L.formula_card(e) for e in fs) + "</div>")
        b.append("</section>")
        b.append(f'<section class="part" id="partB">{L.h2("B", "Symbol glossary")}{self.symbols_table()}'
                 + (L.remark(self.P["symbols_remark"]) if self.P.get("symbols_remark") else "") + "</section>")
        nt = self.P.get("notation_table")
        if nt:
            b.append(f'<section class="part" id="partC">{L.h2("C", nt["title"])}'
                     + L.comparison(dict(nt, id="notation", title="")) + "</section>")
        return self.page("Formulas and symbols", "".join(b))

    def doc02(self):
        def render(t):
            i, parts = t["id"], []
            if self.by("DEFS", i): parts.append("<h4>Definitions</h4>" + "".join(L.definition(d) for d in self.by("DEFS", i)))
            if self.by("STATEMENTS", i): parts.append("<h4>Statements in the class material</h4>" + "".join(L.statement(s) for s in self.by("STATEMENTS", i)))
            if self.by("POINTS", i): parts.append("<h4>Key points</h4>" + L.point_list(self.by("POINTS", i)))
            if self.by("WHY", i): parts.append("<h4>Why?</h4>" + "".join(L.why(w) for w in self.by("WHY", i)))
            if self.by("TRAPS", i): parts.append("<h4>Exam traps</h4>" + "".join(L.trap(x) for x in self.by("TRAPS", i)))
            return "".join(parts)
        b = [self.head("Important points", "Definitions, statements, key points, “why” reasoning and exam traps, topic by topic."),
             self.legend(), self.toc([ti for ti in self.topic_items() if render(next(t for t in self.T if t["id"] == ti[0]))] + [("pyq", "Past-paper questions")]), self.topic_sections(render)]
        allp = "".join(f'<h4>{self.num[t["id"]]} · {t["title"]}</h4>' + self.pyqs(t["id"], False) for t in self.T if self.by("PYQS", t["id"]))
        b.append(f'<section class="part" id="pyq">{L.h2("★", "Past-paper questions")}'
                 f'<p class="lead">{self.P.get("pyq_note", "")}</p>{allp or "<p>No past-paper questions in scope.</p>"}</section>')
        return self.page("Important points", "".join(b))

    def doc03(self):
        figs = self.K["FIGS"]
        b = [self.head("Graphs and diagrams", "Every graph and diagram in scope, redrawn as clean vector figures."), self.legend(),
             self.toc([(g["id"], f'Figure {g["id"]} · {g["title"]}') for g in figs])]
        if self.P.get("figure_note"):
            b.append(f'<p class="lead">{self.P["figure_note"]}</p>')
        b.append(self.topic_sections(lambda t: self.figs(t["id"])))
        return self.page("Graphs and diagrams", "".join(b))

    def doc04(self):
        items = [(f["id"], f'Figure {f["id"]} · {f["title"]}') for f in self.K["FLOWS"]] + [(c["id"], c["title"]) for c in self.K["COMPARISONS"]]
        b = [self.head("Flowcharts and visuals", "Procedures, decisions, concept maps and comparison tables."), self.legend(), self.toc(items),
             self.topic_sections(lambda t: self.flows(t["id"]) + self.comps(t["id"]))]
        return self.page("Flowcharts and visuals", "".join(b))

    def doc05(self):
        b = [self.head("Short notes and keywords", "Short answers, a keyword index, rapid recall and a last-10-minutes page."),
             self.toc([("notes", "Short notes"), ("kw", "Keyword index"), ("rapid", "Rapid recall"), ("last", "Last 10 minutes")])]
        notes = "".join(f'<div class="card"><div class="chead"><span class="ctitle">{self.num[t["id"]]} · {t["title"]}</span></div><div>{self.note(t["id"])}</div></div>'
                        for t in self.T if self.note(t["id"]))
        b.append(f'<section class="topic first" id="notes">{L.h2(1, "Short notes")}{notes}</section>')
        kws = "".join(f'<div><b>{k["term"]}</b> ({self.num.get(k["topic"], "")}). {k["meaning"]}</div>'
                      for k in sorted(self.K["KEYWORDS"], key=lambda x: x["term"].lower()))
        b.append(f'<section class="topic" id="kw">{L.h2(2, "Keyword index")}<p class="small">{len(self.K["KEYWORDS"])} terms; '
                 f'the number in brackets is the topic.</p><div class="kwlist">{kws}</div></section>')
        qa = "".join(f'<div class="qa"><b>{i + 1}</b><span>{r["q"]}</span><span>{r["a"]}</span></div>' for i, r in enumerate(self.K["RAPID"]))
        mn = "".join(L.remark(m, "Mnemonic (study aid).") for m in self.K["MNEMONICS"])
        b.append(f'<section class="topic" id="rapid">{L.h2(3, "Rapid recall")}{qa}{mn}</section>')
        facts = "".join(f"<li>{f}</li>" for f in self.K["TOP_FACTS"])
        fm = {e["id"]: e for e in self.K["FORMULAS"]}
        b.append(f'<section class="topic" id="last">{L.h2(4, "Last 10 minutes before the exam")}<h4>Top facts</h4><ol class="pts">{facts}</ol>'
                 "<h4>Top formulas</h4>" + "".join(L.formula_card(fm[i]) for i in self.K["TOP_FORMULAS"] if i in fm) + "</section>")
        return self.page("Short notes and keywords", "".join(b))

    def doc00(self):
        P = self.P
        cover = (f'<section class="cover"><div class="kicker">{P["course"]} · {P["unit"]}</div><h1>{P["title"]}</h1>'
                 f'<div class="sub">{P.get("subtitle", "")}</div><div class="small">{P.get("compiled_from", "")} Generated {self.today}.</div></section>')
        how = (f'<section class="part" id="how">{L.h2("·", "How to use this pack")}<p class="lead">{P.get("how_to_use", "")} '
               'Every topic has the same parts: overview, key terms, formulas, figures, flowcharts, important points, worked examples, '
               'past-paper questions and a recap. IDs are shared with the separate documents: E = formula, G = graph, F = flowchart, '
               'W = worked example. Each ID is numbered by topic, so E4.2 is the second formula of topic 4.</p>'
               + self.legend() + self.toc(self.topic_items() + [("appA", "Appendix A · Symbol glossary"), ("appB", "Appendix B · Sources, coverage and gaps")]) + "</section>")

        def render(t):
            i = t["id"]
            parts = [f'<p class="lead">{t.get("overview", "")}</p>']
            if self.by("DEFS", i) or self.by("STATEMENTS", i):
                parts.append("<h4>Key terms and definitions</h4>" + "".join(L.definition(d) for d in self.by("DEFS", i))
                             + "".join(L.statement(s) for s in self.by("STATEMENTS", i)))
            if self.by("FORMULAS", i): parts.append("<h4>Formulas</h4>" + "".join(L.formula_card(e) for e in self.by("FORMULAS", i)))
            if self.by("FIGS", i): parts.append("<h4>Graphs and diagrams</h4>" + self.figs(i))
            if self.by("FLOWS", i): parts.append("<h4>Flowcharts</h4>" + self.flows(i))
            if self.by("COMPARISONS", i): parts.append(self.comps(i))
            if self.by("POINTS", i) or self.by("WHY", i) or self.by("TRAPS", i):
                parts.append("<h4>Important points and why</h4>" + L.point_list(self.by("POINTS", i))
                             + "".join(L.why(w) for w in self.by("WHY", i)) + "".join(L.trap(x) for x in self.by("TRAPS", i)))
            if self.by("WORKED", i): parts.append("<h4>Worked examples</h4>" + "".join(L.worked(w) for w in self.by("WORKED", i)))
            if self.by("PYQS", i): parts.append("<h4>Past-paper questions</h4>" + self.pyqs(i, True))
            if self.note(i): parts.append(L.recap(self.note(i)))
            return "".join(parts)

        b = [cover, how, self.topic_sections(render, first_cls=False, skip_empty=False)]
        b.append(f'<section class="part" id="appA">{L.h2("A", "Symbol glossary")}{self.symbols_table()}</section>')
        srows = "".join(f'<tr><td>{s["name"]}</td><td class="src" style="word-break:break-all">{html.escape(s["path"])}</td><td>{s.get("use", "")}</td></tr>'
                        for s in P.get("sources", []))
        gaps = "".join(f"<li>{g}</li>" for g in P.get("gaps", []))
        b.append(f'<section class="part" id="appB">{L.h2("B", "Sources, coverage and gaps")}'
                 f'<table class="t"><thead><tr><th>Source</th><th>Path</th><th>Use</th></tr></thead><tbody>{srows}</tbody></table>'
                 + (f'<p class="small">{P["pyq_note"]}</p>' if P.get("pyq_note") else "")
                 + f'<h4>Known gaps, conflicts and corrections</h4><ol class="pts">{gaps}</ol><h4>Coverage</h4>__COVERAGE__</section>')
        return self.page(P["title"], "".join(b))

    def coverage(self):
        """One row per deck (slides listed as slide×count), one row per other source family."""
        decks, other = {}, {}
        for tag, n in L.SRC_COUNT.items():
            m = re.match(r"^(S[^·\s]+)·(\d+)$", tag)
            if m:
                decks.setdefault(m.group(1), {})
                decks[m.group(1)][int(m.group(2))] = decks[m.group(1)].get(int(m.group(2)), 0) + n
            else:
                key = tag.split(" ")[0] if " " in tag else tag
                other[key] = other.get(key, 0) + n

        def sk(k):
            return [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", k)]
        rows = "".join(f"<tr><td>{html.escape(d)}</td><td>{sum(c.values())}</td><td>"
                       + ", ".join(f"{s}×{c[s]}" for s in sorted(c)) + "</td></tr>" for d, c in sorted(decks.items(), key=lambda kv: sk(kv[0])))
        rows += "".join(f"<tr><td>{html.escape(k)}</td><td>{v}</td><td></td></tr>" for k, v in sorted(other.items(), key=lambda kv: sk(kv[0])))
        extra = f'<p class="small">{self.P["coverage_note"]}</p>' if self.P.get("coverage_note") else ""
        keep = ' keep' if len(decks) + len(other) <= 12 else ''
        return (f'<table class="t{keep}"><thead><tr><th>Source</th><th>Citations</th><th>Slides cited (slide × citations)</th></tr></thead>'
                f'<tbody>{rows}</tbody></table>{extra}')


# ------------------------------------------------------------------ math + assets
MATH_RE = re.compile(r"\$\$(.+?)\$\$|\$(.+?)\$", re.S)


def ensure_katex():
    d = os.path.join(ENGINE, "node_modules", "katex")
    if not os.path.isdir(d):
        subprocess.run(["npm", "install", "--silent", "--no-audit", "--no-fund"], cwd=ENGINE, check=True)
    return d


def render_math(docs):
    items, keys = [], {}
    for d in docs.values():
        for m in MATH_RE.finditer(d):
            k = (m.group(1), True) if m.group(1) is not None else (m.group(2), False)
            if k not in keys:
                keys[k] = len(items)
                items.append({"tex": html.unescape(k[0]), "display": k[1]})
    res = subprocess.run(["node", os.path.join(ENGINE, "katex_render.mjs")], input=json.dumps(items),
                         capture_output=True, text=True, cwd=ENGINE)
    if res.returncode:
        sys.exit("KaTeX failed:\n" + res.stderr[-3000:])
    out = json.loads(res.stdout)

    def sub(m):
        k = (m.group(1), True) if m.group(1) is not None else (m.group(2), False)
        return out[keys[k]]
    return {n: MATH_RE.sub(sub, d) for n, d in docs.items()}


def copy_assets(out_dir):
    a = os.path.join(out_dir, "assets")
    os.makedirs(os.path.join(a, "figures"), exist_ok=True)
    shutil.copy(os.path.join(ENGINE, "study.css"), a)
    extra = os.path.join(os.path.dirname(out_dir), "extra.css")   # optional per-pack overrides
    if os.path.exists(extra):
        with open(os.path.join(a, "study.css"), "a") as f:
            f.write("\n" + open(extra).read())
    shutil.copytree(os.path.join(ENGINE, "fonts"), os.path.join(a, "fonts"), dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("*.ttf"))
    k = ensure_katex()
    os.makedirs(os.path.join(a, "katex"), exist_ok=True)
    shutil.copy(os.path.join(k, "dist", "katex.min.css"), os.path.join(a, "katex"))
    shutil.copytree(os.path.join(k, "dist", "fonts"), os.path.join(a, "katex", "fonts"), dirs_exist_ok=True)


def main(pack_dir):
    pack_dir = os.path.abspath(pack_dir)
    K = load_pack(pack_dir)
    p = Pack(K, pack_dir)
    out_dir = os.path.join(pack_dir, "output")
    os.makedirs(out_dir, exist_ok=True)
    copy_assets(out_dir)
    missing = [g["id"] for g in K["FIGS"] if not os.path.exists(os.path.join(out_dir, "assets", "figures", g["id"] + ".svg"))]
    if missing:
        print("WARNING: figures not drawn yet:", missing, "(run engine/figures_run.py first)")
    docs = {}
    for n, slug, _ in DOCS:
        docs[f"{n}_{slug}"] = getattr(p, f"doc{n}")()
    L.SRC_COUNT.clear()          # coverage counts only the master, which holds everything once
    docs[p.master] = p.doc00().replace("__COVERAGE__", p.coverage())
    docs = render_math(docs)
    for n, d in docs.items():
        with open(os.path.join(out_dir, n + ".html"), "w") as f:
            f.write(d)
        print("wrote", n + ".html")
    with open(os.path.join(out_dir, ".docs.json"), "w") as f:
        json.dump({"master": p.master, "title": K["PACK"]["title"], "header": K["PACK"]["header"],
                   "docs": [[p.master, "Master: " + K["PACK"]["title"]]] + [[f"{n}_{s}", t] for n, s, t in DOCS]}, f)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
