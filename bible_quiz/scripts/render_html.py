#!/usr/bin/env python3
"""Render chapter JSON files into a paginated A4 HTML quiz (layout follows the kit:
questions on top, that page's answer key at the bottom).

Every chapter starts on a new page, its numbering starts at 1, and every page header
names the book and the chapter.  Pagination is done in the browser (scripts inside the
HTML), so the same file works when opened directly and when printed to PDF.

Usage:
  python3 render_html.py ruth 1            -> html/ruth/ruth_ch01.html (one chapter)
  python3 render_html.py ruth all          -> html/ruth_master.html   (all built chapters)
"""
import html, json, os, re, sys, glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from books import BOOKS, ROOT

CSS = r"""
@font-face { font-family:'Noto Serif Kannada'; font-weight:400; src:url('FONTDIR/NotoSerifKannada-400.ttf'); }
@font-face { font-family:'Noto Serif Kannada'; font-weight:700; src:url('FONTDIR/NotoSerifKannada-700.ttf'); }
@font-face { font-family:'Noto Sans Kannada'; font-weight:400; src:url('FONTDIR/NotoSansKannada-400.ttf'); }
@font-face { font-family:'Noto Sans Kannada'; font-weight:700; src:url('FONTDIR/NotoSansKannada-700.ttf'); }
:root { --ink:#111; --ink-soft:#333; --muted:#777; --rule:#cfcfcf; --hair:#e6e6e6; }
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; background:#ececec; color:var(--ink);
  font-family:'Noto Serif Kannada', serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body { padding:28px 0 40px; }
#src { display:none; }
.page { width:210mm; height:297mm; margin:0 auto 28px; background:#fff; overflow:hidden;
  box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.06);
  padding:15mm 18mm 13mm; display:flex; flex-direction:column; position:relative; }
.head { display:flex; align-items:flex-end; justify-content:space-between; padding-bottom:2.5mm;
  border-bottom:0.75pt solid var(--ink); }
.book { font-family:'Noto Sans Kannada',sans-serif; font-weight:700; font-size:12.5pt; line-height:1.3; }
.book small { display:block; font-weight:400; font-size:8pt; color:var(--muted); margin-bottom:.6mm; }
.book .chap { font-weight:700; }
.folio { font-family:'Noto Sans Kannada',sans-serif; font-weight:700; font-size:12.5pt; }
.chapter-banner { margin-top:5mm; padding:3mm 4mm; border:0.75pt solid var(--ink);
  font-family:'Noto Sans Kannada',sans-serif; display:flex; justify-content:space-between; align-items:baseline; }
.chapter-banner b { font-size:15pt; }
.chapter-banner span { font-size:9pt; color:var(--ink-soft); }
.questions { list-style:none; margin:4mm 0 0; padding:0; }
.questions li { display:flex; font-size:10.6pt; line-height:1.6; padding:1.2mm 0; }
.num { flex:0 0 10mm; font-family:'Noto Sans Kannada',sans-serif; font-weight:700; font-size:9.6pt; line-height:1.75;
  font-variant-numeric:tabular-nums; }
.answers { margin-top:auto; }
.answers-title { font-family:'Noto Sans Kannada',sans-serif; font-weight:700; font-size:8.6pt;
  padding-top:2.4mm; margin-bottom:1.8mm; border-top:0.75pt solid var(--ink); }
.answer-box { column-count:2; column-gap:8mm; }
.ans { display:flex; font-family:'Noto Sans Kannada',sans-serif;
  font-size:8.6pt; line-height:1.5; color:var(--ink-soft); padding:.5mm 0; break-inside:avoid; }
.ans .num { flex:0 0 8mm; font-size:8.4pt; line-height:1.6; color:var(--ink); }
.ans p { margin:0; flex:1; }
.ref { font-size:7.8pt; color:var(--muted); white-space:nowrap; }
.cover { justify-content:center; align-items:center; text-align:center; font-family:'Noto Sans Kannada',sans-serif; }
.cover h1 { font-size:26pt; margin:0 0 4mm; }
.cover h2 { font-size:14pt; font-weight:400; margin:0 0 10mm; color:var(--ink-soft); }
.cover .meta { font-size:11pt; line-height:1.9; }
.cover table { margin:10mm auto 0; border-collapse:collapse; font-size:10.5pt; }
.cover td, .cover th { border-bottom:0.5pt solid var(--rule); padding:1.6mm 6mm; text-align:left; }
.cover .src { margin-top:12mm; font-size:8.5pt; color:var(--muted); }
@media print { html, body { background:#fff; } body { padding:0; }
  .page { margin:0; box-shadow:none; break-after:page; } }
"""

JS = r"""
(function(){
  const data = JSON.parse(document.getElementById('src').textContent);
  const root = document.getElementById('root');
  let folio = 0;
  function el(tag, cls, html){ const e=document.createElement(tag); if(cls) e.className=cls; if(html!=null) e.innerHTML=html; return e; }
  function cover(){
    const p = el('div','page cover');
    p.appendChild(el('h1',null,data.title));
    p.appendChild(el('h2',null,'ವಿದ್ಯಾರ್ಥಿಗಳ ಬೈಬಲ್ ರಸಪ್ರಶ್ನೆ – ಸಾಮಾನ್ಯ (ಲಿಖಿತ)'));
    p.appendChild(el('div','meta','ಭಾಗ: '+data.portion+'<br>ಭಾಷೆ: ಕನ್ನಡ · ಪಠ್ಯ: KRCBC ಕನ್ನಡ ಬೈಬಲ್'));
    const t = el('table'); t.id='toc';
    t.innerHTML = '<tr><th>ಅಧ್ಯಾಯ</th><th>ಪ್ರಶ್ನೆಗಳು</th><th>ಪುಟ</th></tr>';
    p.appendChild(t);
    p.appendChild(el('div','src','ಪ್ರತಿಯೊಂದು ಉತ್ತರದ ಕೊನೆಯಲ್ಲಿ ವಚನದ ಉಲ್ಲೇಖವಿದೆ. ಪ್ರತಿ ಅಧ್ಯಾಯದ ಪ್ರಶ್ನೆಗಳ ಸಂಖ್ಯೆ 1ರಿಂದ ಆರಂಭವಾಗುತ್ತದೆ.<br>ಆಧಾರ: krcbcbible.org/kannada_bible.php'));
    root.appendChild(p);
    return t;
  }
  function newPage(ch, first){
    folio++;
    const p = el('div','page');
    const h = el('div','head');
    h.appendChild(el('div','book','<small>ವಿದ್ಯಾರ್ಥಿಗಳ ಬೈಬಲ್ ರಸಪ್ರಶ್ನೆ · KRCBC</small>'+data.title+' — <span class="chap">'+ch.label+'</span>'));
    h.appendChild(el('div','folio',String(folio)));
    p.appendChild(h);
    if(first){
      p.appendChild(el('div','chapter-banner','<b>'+ch.label+'</b><span>'+data.title+' '+ch.chapter+' · '+ch.verses+' ವಚನಗಳು · '+ch.questions.length+' ಪ್ರಶ್ನೆಗಳು</span>'));
    }
    const ol = el('ol','questions'); p.appendChild(ol);
    const ans = el('div','answers');
    ans.appendChild(el('div','answers-title','ಉತ್ತರಗಳು — '+ch.label));
    const box = el('div','answer-box'); ans.appendChild(box);
    p.appendChild(ans);
    root.appendChild(p);
    return {p, ol, box};
  }
  function overflow(pg){ return pg.p.scrollHeight > pg.p.clientHeight + 0.5; }
  const toc = data.cover ? cover() : null;
  for(const ch of data.chapters){
    let pg = newPage(ch, true);
    const startFolio = folio;
    let count = 0;
    for(const q of ch.questions){
      const li = el('li', null, '<span class="num">'+q.n+'.</span><span>'+q.q+'</span>');
      const an = el('div','ans','<span class="num">'+q.n+'.</span><p>'+q.a+' <span class="ref">('+q.r+')</span></p>');
      pg.ol.appendChild(li); pg.box.appendChild(an);
      if(overflow(pg)){
        if(count===0){ console.warn('question does not fit an empty page', q.n); }
        else {
          pg.ol.removeChild(li); pg.box.removeChild(an);
          pg = newPage(ch, false); count = 0;
          pg.ol.appendChild(li); pg.box.appendChild(an);
        }
      }
      count++;
    }
    if(toc){ const r=document.createElement('tr'); r.innerHTML='<td>'+ch.label+'</td><td>'+ch.questions.length+'</td><td>'+startFolio+'</td>'; toc.appendChild(r); }
  }
  window.__paginated = true;
})();
"""


def esc(s):
    s = html.escape(s, quote=False)
    s = s.replace("______", '<span style="display:inline-block;min-width:20mm;border-bottom:0.6pt solid #333;transform:translateY(-2pt);margin:0 1mm"></span>')
    return s


def chapter_payload(d):
    qs = []
    for q in d["questions"]:
        qs.append({"n": q["number"], "q": esc(q["question"]), "a": esc(q["answer"]),
                   "r": esc("; ".join(q["refs"]))})
    return {"chapter": d["chapter"], "label": d["chapter_label"], "verses": d["verses"], "questions": qs}


def render(book, chapters_json, out_path, cover):
    meta = BOOKS[book]
    payload = {"title": meta["title"], "portion": meta["portion"], "cover": cover,
               "chapters": [chapter_payload(d) for d in chapters_json]}
    fontdir = os.path.relpath(os.path.join(ROOT, "fonts"), os.path.dirname(out_path))
    title = meta["title"] + (" — ಬೈಬಲ್ ರಸಪ್ರಶ್ನೆ" if cover else f" — {chapters_json[0]['chapter_label']} ರಸಪ್ರಶ್ನೆ")
    doc = f"""<!DOCTYPE html>
<html lang="kn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(title)}</title>
<style>{CSS.replace('FONTDIR', fontdir)}</style>
</head>
<body>
<script id="src" type="application/json">{json.dumps(payload, ensure_ascii=False).replace('</', '<\\/')}</script>
<div id="root"></div>
<script>
Promise.all(["400 11pt 'Noto Serif Kannada'","700 11pt 'Noto Serif Kannada'","400 9pt 'Noto Sans Kannada'","700 9pt 'Noto Sans Kannada'"].map(f=>document.fonts.load(f,'ಕನ್ನಡ'))).then(()=>document.fonts.ready).then(()=>{{
{JS}
}});
</script>
</body>
</html>
"""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    open(out_path, "w", encoding="utf-8").write(doc)
    return out_path


def main():
    book, which = sys.argv[1], sys.argv[2]
    if which == "all":
        files = sorted(glob.glob(os.path.join(ROOT, "json", book, f"{book}_ch*.json")))
        ds = [json.load(open(f, encoding="utf-8")) for f in files]
        ds.sort(key=lambda d: d["chapter"])
        out = os.path.join(ROOT, "html", f"{book}_master.html")
        render(book, ds, out, cover=True)
    else:
        ch = int(which)
        d = json.load(open(os.path.join(ROOT, "json", book, f"{book}_ch{ch:02d}.json"), encoding="utf-8"))
        out = os.path.join(ROOT, "html", book, f"{book}_ch{ch:02d}.html")
        render(book, [d], out, cover=False)
    print(out)


if __name__ == "__main__":
    main()
