#!/usr/bin/env python3
"""OCR sparse searchable-text pages from question PDFs as an aid to content review."""
from __future__ import annotations
import json, pathlib, subprocess, fitz, re
REPO=pathlib.Path(__file__).resolve().parents[2]
CORPUS=REPO/'study-materials/datasets/lecture-corpus.json'
SRC=REPO/'study-materials/sources'
DATA=json.loads(CORPUS.read_text(encoding='utf-8'))
PW_FILE=SRC/'First_Year_8enterprise/PASSWORD.txt'
PASSWORD=PW_FILE.read_text(encoding='utf-8').strip() if PW_FILE.exists() else ''

def ocr_page(path, n):
    with fitz.open(path) as doc:
        if doc.needs_pass and not doc.authenticate(PASSWORD):
            raise RuntimeError('password required but the supplied bucket password did not unlock this PDF')
        pix=doc[n-1].get_pixmap(dpi=240,alpha=False)
        result=subprocess.run(['tesseract','stdin','stdout','--psm','6'],input=pix.tobytes('png'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=90)
        return result.stdout.decode('utf-8',errors='replace').strip()

def process(record):
    src=record['source']; rel=src.get('local_path')
    if not rel:return []
    p=REPO/rel; events=[]
    for page in record.get('pages',[]):
        if not page.get('sparse'):continue
        try:
            text=ocr_page(p,page['page']);page['ocr_text']=text;page['ocr_text_chars']=len(text)
            page['ocr_status']='OCR extracted; still requires visual confirmation'
            events.append({'source':src['bucket_path'],'page':page['page'],'status':'ocr_text_found' if len(text)>15 else 'ocr_still_sparse','chars':len(text)})
        except Exception as exc:
            page['ocr_status']='OCR failed: '+type(exc).__name__
            events.append({'source':src['bucket_path'],'page':page['page'],'status':'error','error':type(exc).__name__})
    return events

events=[]
for course in DATA['courses']:
    for unit in course['units']:
        for pdf in unit['supporting_pdfs']:events.extend(process(pdf))
for pdf in DATA.get('legacy_related_question_sources',[]):
    if 'pages' in pdf:events.extend(process(pdf))
CORPUS.write_text(json.dumps(DATA,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
out=REPO/'study-materials/work/ocr-report.json'
out.write_text(json.dumps({'sparse_pages_reviewed':len(events),'results':events},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'sparse_pages':len(events),'ocr_text_found':sum(x['status']=='ocr_text_found' for x in events),'still_sparse':sum(x['status']=='ocr_still_sparse' for x in events),'errors':sum(x['status']=='error' for x in events)},indent=2))
