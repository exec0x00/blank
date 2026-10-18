"""Offline Chromium render, DOM audits, portable PDF links, PDF audits and page previews."""
from pathlib import Path
import collections,html,json,re,urllib.parse,mimetypes
import fitz
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
from runtime import browser_executable

DOM_AUDIT=r'''() => {
 const bad=[], warnings=[];const page=document.querySelector('main').getBoundingClientRect();
 const pageHeight=261*96/25.4;
 for(const el of document.querySelectorAll('.worked,.card,.remark,.recap,.practice-answer,.solved-practice,#revision,table.keep')) {
   if(el.getBoundingClientRect().height>pageHeight-10){el.classList.add('long');el.classList.remove('keep');warnings.push('Long block will split: '+(el.id||el.className));}
 }
 const ids=[...document.querySelectorAll('[id]')].map(x=>x.id);
 for(const id of new Set(ids)){if(ids.filter(x=>x===id).length>1)bad.push('Duplicate DOM ID '+id);}
 for(const el of document.querySelectorAll('img')){
  if(!el.complete||!el.naturalWidth)bad.push('Broken image '+el.getAttribute('src'));
 }
 for(const el of document.querySelectorAll('figure,.blk,.wrow,table tr,.practice')){
  if(el.getBoundingClientRect().height>pageHeight-4)bad.push('Unbreakable element exceeds a page: '+(el.id||el.className));
 }
 // Inspect text ink, images and equations against page edges and the nearest block.
 const walker=document.createTreeWalker(document.querySelector('main'),NodeFilter.SHOW_TEXT);
 for(let n; n=walker.nextNode();){
  if(!n.textContent.trim() || n.parentElement.closest('.katex-mathml'))continue;
  const range=document.createRange();range.selectNodeContents(n);
  let box=n.parentElement;
  while(box && (getComputedStyle(box).display==='inline'||box.closest('.katex')))box=box.parentElement;
  const bound=box?box.getBoundingClientRect():page;
  for(const r of range.getClientRects()){
   if(r.width&& (r.left<page.left-2||r.right>page.right+2))bad.push('Text exceeds page width: '+n.textContent.slice(0,90));
   if(r.width&& (r.left<bound.left-3||r.right>bound.right+3))bad.push('Text exceeds block width: '+n.textContent.slice(0,90));
  }
 }
 for(const el of document.querySelectorAll('img,svg,table')){
  const r=el.getBoundingClientRect();if(r.left<page.left-2||r.right>page.right+2)bad.push('Element exceeds page width: '+(el.id||el.tagName));
 }
 const clone=document.querySelector('main').cloneNode(true);
 clone.querySelectorAll('.katex,pre,code').forEach(e=>e.remove());
 const text=clone.textContent;
 if(/\\(frac|partial|sqrt|begin|mathrm)\b/.test(text))bad.push('Raw TeX in rendered prose');
 return {errors:[...new Set(bad)],warnings:[...new Set(warnings)],ids,links:[...document.querySelectorAll('a[href]')].map(x=>x.getAttribute('href')),text};
}'''
STYLE="font-family:Georgia,serif;font-size:8px;color:#5f6368;width:100%;padding:0 16mm;display:flex;justify-content:space-between"

def print_pdfs(out,meta,k):
    out=Path(out); reports={};errors=[];warnings=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=browser_executable(p))
        ctx=browser.new_context(viewport={'width':673,'height':986},java_script_enabled=True)
        def local_route(route):
            u=urllib.parse.urlsplit(route.request.url)
            target=(out/urllib.parse.unquote(u.path).lstrip('/')).resolve()
            if u.hostname=='pdf-forge.invalid' and target.is_relative_to(out.resolve()) and target.is_file():
                route.fulfill(path=str(target),content_type=mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
            else:route.abort()
        ctx.route('**/*',local_route)
        pg=ctx.new_page();pg.emulate_media(media='print')
        for stem,title in meta['docs']:
            failures=[]
            pg.on('pageerror',lambda e:failures.append(str(e)))
            pg.goto('https://pdf-forge.invalid/'+stem+'.html',wait_until='load')
            pg.evaluate('document.fonts.ready.then(()=>true)')
            pg.evaluate('Promise.all([...document.images].map(i=>i.decode()))')
            audit=pg.evaluate(DOM_AUDIT);reports[stem]=audit
            errors.extend(f'{stem}: {e}' for e in audit['errors']+failures)
            warnings.extend(f'{stem}: {e}' for e in audit['warnings'])
            footer=f'<div style="{STYLE};justify-content:center">page&nbsp;<span class="pageNumber"></span>&nbsp;of&nbsp;<span class="totalPages"></span></div>'
            pg.pdf(path=str(out/(stem+'.pdf')),format='A4',prefer_css_page_size=True,print_background=True,display_header_footer=True,
                   header_template=f'<div style="{STYLE}"><span>{html.escape(title)}</span><span>{html.escape(meta["header"])}</span></div>',footer_template=footer,
                   margin={'top':'18mm','bottom':'18mm','left':'16mm','right':'16mm'},outline=True,tagged=True)
        ctx.close();browser.close()
    idsby={stem+'.html':set(r['ids']) for stem,r in reports.items()}
    for stem,r in reports.items():
        for href in r['links']:
            parsed=urllib.parse.urlsplit(href)
            if parsed.scheme or parsed.netloc:errors.append(f'{stem}: unexpected external content link {href}');continue
            target=urllib.parse.unquote(parsed.path) or stem+'.html';anchor=urllib.parse.unquote(parsed.fragment)
            if target not in idsby or (anchor and anchor not in idsby[target]):errors.append(f'{stem}: broken link {href}')
    if 'master' in k['PACK']['documents']:
        expected={x['id'] for key in ['TOPICS','DEFS','STATEMENTS','POINTS','WHY','TRAPS','FORMULAS','SYMBOLS','WORKED','PYQS','NOTES','KEYWORDS','RAPID','TOP_FACTS','FIGS','FLOWS','COMPARISONS','MNEMONICS','DERIVATIONS','PRACTICE'] for x in k[key]}
        absent=expected-idsby[meta['master']+'.html']
        if absent:errors.append('Master omitted content IDs: '+', '.join(sorted(absent)))
    for stem,r in reports.items():
        for word in k['PACK'].get('asr_forbidden',[]):
            main=r['text'].split('Known gaps, conflicts and corrections')[0]
            if re.search(r'(?<!\w)'+re.escape(word)+r'(?!\w)',main,re.I):errors.append(f'{stem}: forbidden ASR phrase {word}')
    return reports,errors,warnings

def repair_pdf_links(out,meta):
    out=Path(out); names={};errors=[]; count=0
    for stem,_ in meta['docs']:
        with fitz.open(out/(stem+'.pdf')) as d:names[stem]=d.resolve_names()
    for stem,_ in meta['docs']:
        path=out/(stem+'.pdf');d=fitz.open(path);changed=False
        for page in d:
            for link in page.get_links():
                if link['kind'] not in (fitz.LINK_LAUNCH,fitz.LINK_URI):continue
                value=link.get('file',link.get('uri',''));u=urllib.parse.urlsplit(value)
                if u.scheme not in ('','file') and u.hostname!='pdf-forge.invalid':continue
                dest=Path(urllib.parse.unquote(u.path)).stem;anchor=urllib.parse.unquote(u.fragment)
                if dest not in names:errors.append(f'{stem}: unknown PDF destination {value}');continue
                target=names[dest].get(anchor)
                if not target:
                    # IDs printed on cards can be found even when Chromium omits unused named destinations.
                    with fitz.open(out/(dest+'.pdf')) as other:
                        for n,pg in enumerate(other):
                            found=pg.search_for(anchor+' ·') if anchor else [fitz.Rect(0,0,1,1)]
                            if found:target={'page':n,'to':(found[0].x0,found[0].y0)};break
                if not target:errors.append(f'{stem}: cannot locate PDF anchor {anchor}');continue
                page.delete_link(link)
                page.insert_link({'kind':fitz.LINK_GOTOR,'from':link['from'],'file':dest+'.pdf','page':target['page'],'to':fitz.Point(0,0),'zoom':0})
                changed=True;count+=1
        if changed:
            tmp=path.with_suffix('.fixed.pdf');d.save(tmp,garbage=4,deflate=True);d.close();tmp.replace(path)
        else:d.close()
    return count,errors

def audit_pdf(path,preview_dir=None):
    path=Path(path);errors=[];warnings=[];pages=[];thumbs=[];fontseen=set()
    with fitz.open(path) as d:
        if not len(d):errors.append('No pages')
        for i,p in enumerate(d):
            if abs(p.rect.width-595.28)>2 or abs(p.rect.height-841.89)>2:errors.append(f'p{i+1}: not A4 portrait')
            text=p.get_text();bodyrect=fitz.Rect(35,45,p.rect.width-35,p.rect.height-45)
            body=p.get_text(clip=bodyrect)
            for w in p.get_text('words'):
                if w[0]<-1 or w[1]<-1 or w[2]>p.rect.width+1 or w[3]>p.rect.height+1:errors.append(f'p{i+1}: text outside page: {w[4]}')
            if '\ufffd' in text:errors.append(f'p{i+1}: replacement glyph')
            for f in p.get_fonts(full=True):
                if f[0] in fontseen:continue
                fontseen.add(f[0])
                if f[2]=='Type3' and d.xref_get_key(f[0],'CharProcs')[0]!='null':continue
                try:font=d.extract_font(f[0])
                except Exception:font=(None,None,None,b'')
                if not font[3] and f[1]!='n/a':errors.append(f'p{i+1}: font not embedded: {f[3]}')
                elif f[1]=='n/a':errors.append(f'p{i+1}: nonembedded font: {f[3]}')
            pix=p.get_pixmap(matrix=fitz.Matrix(.55,.55),clip=bodyrect,colorspace=fitz.csGRAY)
            ink=sum(v<240 for v in pix.samples)/len(pix.samples)
            if ink<.0003:errors.append(f'p{i+1}: blank body')
            if ink<.025 and i>0:warnings.append(f'p{i+1}: sparse page; inspect spacing')
            for l in p.get_links():
                if l['kind']==fitz.LINK_LAUNCH:errors.append(f'p{i+1}: local HTML launch link survived')
                if l['kind']==fitz.LINK_URI and (l.get('uri','').startswith('file:') or 'pdf-forge.invalid' in l.get('uri','')):errors.append(f'p{i+1}: local file URI')
                if l['kind'] in (fitz.LINK_GOTO,fitz.LINK_NAMED) and 'page' in l and not 0<=l['page']<len(d):errors.append(f'p{i+1}: invalid internal link')
                if l['kind']==fitz.LINK_GOTOR:
                    target=(path.parent/l.get('file',''))
                    if not target.is_file():errors.append(f'p{i+1}: missing relative PDF link target')
                    else:
                        with fitz.open(target) as dst:
                            if not 0<=l.get('page',-1)<len(dst):errors.append(f'p{i+1}: invalid cross-PDF page')
            pages.append({'page':i+1,'body_characters':len(body),'ink_ratio':round(ink,4)})
            if preview_dir:
                pix=p.get_pixmap(matrix=fitz.Matrix(1,1),alpha=False)
                im=Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
                dest=Path(preview_dir);dest.mkdir(parents=True,exist_ok=True)
                im.save(dest/f'{path.stem}-p{i+1:04d}.png')
                im.thumbnail((298,421));thumbs.append(im)
        toc=len(d.get_toc())
    sheets=[]
    if preview_dir:
        for start in range(0,len(thumbs),6):
            chunk=thumbs[start:start+6];sheet=Image.new('RGB',(620,450*((len(chunk)+1)//2)),'#d6d9dc');draw=ImageDraw.Draw(sheet)
            for j,im in enumerate(chunk):
                x=(j%2)*310+6;y=(j//2)*450
                draw.text((x,y+3),f'{path.stem} / page {start+j+1}',fill='black');sheet.paste(im,(x,y+24))
            file=Path(preview_dir)/f'{path.stem}-sheet{start//6+1:03d}.jpg';sheet.save(file,quality=88);sheets.append(file.name)
    return {'file':path.name,'pages':len(pages),'outlines':toc,'fonts':len(fontseen),'errors':errors,'warnings':warnings,'page_metrics':pages,'sheets':sheets}
