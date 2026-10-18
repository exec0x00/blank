#!/usr/bin/env python3
"""Build a source-linked corpus and coverage audit from the bucket manifest."""
from __future__ import annotations
import csv, difflib, hashlib, json, pathlib, re, unicodedata, collections, os
import fitz

REPO=pathlib.Path(__file__).resolve().parents[2]
INV=json.loads((REPO/'study-materials/inventory/source-inventory.json').read_text(encoding='utf-8'))
TREE=json.loads((REPO/'study-materials/inventory/hf-bucket-tree.json').read_text(encoding='utf-8'))
MAN=json.loads((REPO/'study-materials/work/download-manifest.json').read_text(encoding='utf-8'))
MAN_BY={x['path']:x for x in MAN['files']}
SRC=REPO/'study-materials/sources'
VID_EXT={'.mp4','.mkv','.webm'}
VIDEO_ITEMS=[x for x in TREE if x.get('type')=='file' and pathlib.PurePosixPath(x['path']).suffix.lower() in VID_EXT]

def local(remote):
    rel=pathlib.PurePosixPath(remote)
    return SRC.joinpath(*rel.parts[1:])

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def txt_norm(s):
    s=unicodedata.normalize('NFKC',s).lower()
    return ' '.join(re.findall(r'[\w]+',s,flags=re.UNICODE))

def timecode(seconds):
    ms=round(float(seconds)*1000); h,ms=divmod(ms,3_600_000);m,ms=divmod(ms,60_000);s,ms=divmod(ms,1000)
    return f'{h:02d}:{m:02d}:{s:02d}.{ms:03d}'

def parse_md_transcript(text):
    rows=[]
    for line in text.splitlines():
        m=re.match(r'^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)$',line.strip())
        if m: rows.append((m.group(1),m.group(2)))
    return rows

def parse_srt(text):
    rows=[]
    for block in re.split(r'\n\s*\n',text.strip()):
        lines=block.splitlines(); cue=next((l for l in lines if '-->' in l),None)
        if not cue: continue
        left,right=[s.strip().replace(',','.') for s in cue.split('-->',1)]
        body=' '.join(l.strip() for l in lines[lines.index(cue)+1:] if l.strip())
        rows.append({'start':left,'end':right,'text':body})
    return rows

def plain_transcript(text):
    out=[]
    for line in text.splitlines():
        line=line.strip()
        if not line or line.startswith('#') or line.startswith('Automatic transcript') or line.startswith('Transcript from source captions'):
            continue
        out.append(re.sub(r'^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s*','',line))
    return ' '.join(out)

def extract_pages(markdown):
    matches=list(re.finditer(r'(?m)^## Page / slide (\d+)\s*$',markdown))
    pages=[]
    for i,m in enumerate(matches):
        end=matches[i+1].start() if i+1<len(matches) else len(markdown)
        body=markdown[m.end():end].strip()
        pages.append({'page':int(m.group(1)),'text':body})
    return pages

def title_from_stem(name):
    s=pathlib.Path(name).name
    s=re.sub(r'\.[^.]+$','',s)
    s=re.sub(r'__[^_]+$','',s)
    s=re.sub(r'^\d+[_-]*','',s)
    return re.sub(r'[_-]+',' ',s).strip()

def tokens(s):
    return set(re.findall(r'[a-z0-9]+',txt_norm(s)))

def sim(a,b):
    aa,bb=txt_norm(a),txt_norm(b)
    if not aa or not bb:return 0.0
    seq=difflib.SequenceMatcher(None,aa,bb,autojunk=False).ratio()
    ta,tb=tokens(a),tokens(b)
    jac=len(ta&tb)/max(1,len(ta|tb))
    return round(.55*seq+.45*jac,4)

STOP=set('the a an and or of for to with by in from on at as is are be it this that what how which about after before during using'.split())
def topic_coverage(title,candidate):
    tt={t for t in tokens(title) if t not in STOP and len(t)>2}
    ct={t for t in tokens(candidate) if t not in STOP and len(t)>2}
    cov=len(tt&ct)/max(1,len(tt))
    return round(.7*cov+.3*sim(title,candidate),4)

def slide_match_keys(record):
    keys=[record['title']]
    for page in record.get('pages',[]):
        lines=[]
        for raw in page.get('text','').splitlines():
            line=' '.join(re.sub(r'^\s*[•➢*-]+\s*','',raw).split()).strip()
            if len(line)<4 or line.lower().startswith(('engineering chemistry','engineering mathematics','engineering mechanics','department of','pesu')):continue
            if line.startswith('Source:') or line.startswith('http'):continue
            lines.append(line)
        if lines:
            keys.append(' '.join(lines[:4])[:240])
    return keys

def read_text(remote):
    p=local(remote)
    return p.read_text(encoding='utf-8',errors='replace') if p.is_file() else None

def source_record(remote):
    bucket_rel=remote.removeprefix('pesuc/')
    url='https://huggingface.co/buckets/alvin3y10/data/tree/pesuc/'+bucket_rel
    if remote in MAN_BY:
        x=MAN_BY[remote]
        return {'bucket_path':remote,'url':url,'local_path':'study-materials/sources/'+x['local_path'],'sha256':x['sha256'],'bytes':x['size'],'xetHash':x.get('xetHash')}
    x=next((x for x in TREE if x.get('path')==remote),{})
    return {'bucket_path':remote,'url':url,'local_path':None,'sha256':None,'bytes':x.get('size'),'xetHash':x.get('xetHash')}

def formula_candidates(pages,segments,source_ref):
    out=[]
    eq=re.compile(r'(?:=|≈|≃|∝|±|≤|≥|\b(?:is equal to|equals|given by|formula|relation|proportional to)\b|\\(?:frac|sqrt|sum|int|Delta|nu|lambda|omega)|\b(?:cm|m|kg|mol|Pa|N|J|W|Hz)\s*\^?-?\d)',re.I)
    for page in pages:
        for line in page.get('text','').splitlines():
            clean=' '.join(line.split()).strip(' -*')
            if clean and eq.search(clean) and len(clean)<350:
                out.append({'text':clean,'source':source_ref,'locator':f"slide {page['page']}",'review_status':'candidate; compare with original slide before teaching as an equation'})
    for seg in segments:
        clean=' '.join(seg['text'].split())
        if clean and eq.search(clean) and len(clean)<350:
            out.append({'text':clean,'source':source_ref,'locator':f"transcript {timecode(seg['start'])}",'review_status':'spoken candidate; check slide and transcript confidence'})
    seen=set(); unique=[]
    for c in out:
        k=(txt_norm(c['text']),c['locator'])
        if k not in seen:seen.add(k);unique.append(c)
    return unique

# Build subject/unit paths and slide text maps.
course_dirs={c['id']:c['path'] for c in INV['courses']}
files=[x for x in TREE if x.get('type')=='file']
slides_by_unit=collections.defaultdict(list)
all_slide_files=[]
for x in files:
    path=x['path']
    if '/Slides/' in path and path.lower().endswith('.slides.md'):
        p=local(path); text=p.read_text(encoding='utf-8',errors='replace') if p.is_file() else ''
        pages=extract_pages(text)
        parts=path.split('/')
        course=parts[3] if len(parts)>4 else None; unit=parts[4] if len(parts)>4 else None
        record={'path':path,'course_id':course,'unit':unit,'title':title_from_stem(pathlib.Path(path).name),'sha256':MAN_BY.get(path,{}).get('sha256'),'pages':pages,'body':text}
        slides_by_unit[(course,unit)].append(record);all_slide_files.append(record)

slide_decks=[]
for key,records in slides_by_unit.items():
    for md in records:
        stem=md['path'][:-len('.slides.md')]
        parent=pathlib.PurePosixPath(md['path']).parent
        candidates=[stem+'.pptx',stem+'.ppt',stem+'.pdf']
        deck=next((c for c in candidates if c in {x['path'] for x in files}),None)
        txtpath=stem+'.slides.txt'
        slide_decks.append({**{k:v for k,v in md.items() if k!='body'},'deck_path':deck,'text_variant_path':txtpath if txtpath in {x['path'] for x in files} else None})

courses=[]; variant_rows=[]; match_rows=[]; coverage=collections.Counter()
for c in INV['courses']:
    cid=c['id']; base=c['path']
    course={'id':cid,'title':c['name'],'semester':c['semester'],'source_path':base,'units':[],'course_sources':[]}
    for x in files:
        if x['path'].startswith(base+'/') and ('/Unit_' not in x['path']):
            if pathlib.PurePosixPath(x['path']).suffix.lower() in {'.md','.txt','.json','.csv'}:
                course['course_sources'].append(source_record(x['path']))
    unit_names=sorted({x['path'].split('/')[4] for x in files if x['path'].startswith(base+'/') and len(x['path'].split('/'))>5 and re.fullmatch(r'Unit_\d+',x['path'].split('/')[4])})
    for unit_name in unit_names:
        unit={'id':unit_name,'source_path':base+'/'+unit_name,'videos':[],'slide_decks':[],'supporting_pdfs':[],'source_files':[]}
        ufiles=[x for x in files if x['path'].startswith(base+'/'+unit_name+'/')]
        unit['source_files']=[source_record(x['path']) for x in ufiles]
        srecords=slides_by_unit.get((cid,unit['id']),[])
        unit['slide_decks']=[{k:v for k,v in r.items() if k!='body'} for r in slide_decks if (r['course_id'],r['unit'])==(cid,unit['id'])]
        unit_texts={r['path']:r['pages'] for r in srecords}
        for x in ufiles:
            if pathlib.PurePosixPath(x['path']).suffix.lower()=='.pdf':
                # Full page text is included below for papers/question banks and any non-slide PDFs.
                if any(k in x['path'].lower() for k in ('paper','question','esa')):
                    p=local(x['path']); pdf={'source':source_record(x['path']),'pages':[],'password_protected':False}
                    if p.is_file():
                        try:
                            with fitz.open(p) as doc:
                                for n,page in enumerate(doc,1):
                                    txt=page.get_text('text')
                                    pdf['pages'].append({'page':n,'text':txt,'text_chars':len(txt.strip()),'sparse':len(txt.strip())<40})
                        except Exception as exc:pdf['password_protected']=True;pdf['error']=type(exc).__name__
                    unit['supporting_pdfs'].append(pdf)
        video_remote=[x for x in VIDEO_ITEMS if x['path'].startswith(base+'/'+unit['id']+'/')]
        unit['videos'] = []
        for v in sorted(video_remote,key=lambda x:x['path']):
            vp=pathlib.PurePosixPath(v['path']); root=str(vp.parent)+'/'+vp.stem
            remotes={'transcript_json':root+'.transcript.json','transcript_md':root+'.transcript.md','transcript_txt':root+'.transcript.txt','srt':root+'.srt'}
            texts={k:read_text(p) for k,p in remotes.items()}
            j=json.loads(texts['transcript_json']) if texts['transcript_json'] else {'segments':[]}
            segments=[]
            for ix,s in enumerate(j.get('segments',[]),1):
                segments.append({'id':f's{ix:04d}','start':s.get('start',0),'end':s.get('end',0),'timestamp':timecode(s.get('start',0)),'text':s.get('text',''),'avg_logprob':s.get('avg_logprob'),'model':s.get('model')})
            variant_texts={
                'transcript_json':' '.join(s['text'] for s in segments),
                'transcript_md':' '.join(t for _,t in parse_md_transcript(texts['transcript_md'] or '')),
                'transcript_txt':plain_transcript(texts['transcript_txt'] or ''),
                'srt':' '.join(x['text'] for x in parse_srt(texts['srt'] or '')),
            }
            jsonnorm=txt_norm(variant_texts['transcript_json'])
            jsonwords=jsonnorm.split()
            variants={}
            for k,rpath in remotes.items():
                other=txt_norm(variant_texts[k]); otherwords=other.split()
                ratio=(1.0 if jsonwords==otherwords else difflib.SequenceMatcher(None,jsonwords,otherwords).ratio()) if jsonwords and otherwords else 0.0
                variants[k]={'source':source_record(rpath),'normalized_words':len(other.split()),'similarity_to_json':round(ratio,4),'status':'matching transcript variant' if ratio>=0.985 else ('near-match; inspect differences' if ratio>=0.9 else 'variant mismatch; inspect')}
                variant_rows.append({'course':cid,'unit':unit['id'],'video':v['path'],'variant':k,'similarity_to_json':round(ratio,4),'words':len(other.split()),'segments':len(parse_srt(texts[k] or '')) if k=='srt' else len(parse_md_transcript(texts[k] or '')) if k=='transcript_md' else None})
            title=j.get('title') or title_from_stem(vp.name)
            candidates=[]
            for s in srecords:
                score=max(topic_coverage(title,key) for key in slide_match_keys(s))
                score=max(score,sim(title,s['title']))
                vnum=re.match(r'^(\d+)_',vp.name); snum=re.match(r'^(\d+)_',pathlib.PurePosixPath(s['path']).name)
                if vnum and snum and vnum.group(1)==snum.group(1):score=min(1.0,score+.12)
                candidates.append({'path':s['path'],'title':s['title'],'score':round(score,4)})
            candidates.sort(key=lambda z:(-z['score'],z['title']))
            best=candidates[0] if candidates else None
            if best:
                match_rows.append({'course':cid,'unit':unit['id'],'video':v['path'],'video_title':title,'best_slide':best['path'],'slide_title':best['title'],'score':best['score'],'status':'likely' if best['score']>=.56 else 'review'})
            low=[s for s in segments if s['avg_logprob'] is not None and s['avg_logprob']<-.5]
            video={'id':re.sub(r'[^A-Za-z0-9]+','_',f'{cid}_{unit["id"]}_{vp.stem}').strip('_'),'title':title,'video_source':source_record(v['path']),'duration_seconds':j.get('duration_seconds'),'speech_duration_seconds':j.get('speech_duration_seconds'),'transcription_method':j.get('method'),'language':j.get('language'),'segment_count':len(segments),'word_count':len(jsonnorm.split()),'low_confidence_segments':len(low),'low_confidence_locators':[s['timestamp'] for s in low],'transcript_variants':variants,'slide_match_candidates':candidates[:5],'matched_slide':best['path'] if best and best['score']>=.56 else None,'transcript_segments':segments,'formula_candidates':formula_candidates([],segments,remotes['transcript_json'])}
            if video['matched_slide']:
                deck=next((s for s in srecords if s['path']==video['matched_slide']),None)
                if deck:
                    video['slide_pages']=deck['pages']
                    video['formula_candidates']+=formula_candidates(deck['pages'],[],deck['path'])
            else:video['slide_pages']=[]
            unit['videos'].append(video)
        # Include sidecars and support formats as explicit sources even when they are duplicates.
        course['units'].append(unit)
    courses.append(course)

# Include matching legacy paper and supplemental files from the downloaded reference set.
legacy=[]
for x in files:
    if not x['path'].startswith('pesuc/First_Year_8enterprise/'):continue
    if x['path'] not in MAN_BY:continue
    if not any(k in x['path'].lower() for k in ('/papers/','/question bank/','/chemistry/extra/','/math 1/extra/')):continue
    p=local(x['path']); record={'source':source_record(x['path'])}
    if pathlib.PurePosixPath(x['path']).suffix.lower()=='.pdf' and p.is_file():
        record['pages']=[]
        try:
            with fitz.open(p) as doc:
                for n,page in enumerate(doc,1):
                    t=page.get_text('text');record['pages'].append({'page':n,'text':t,'text_chars':len(t.strip()),'sparse':len(t.strip())<40})
        except Exception as exc:record['error']=type(exc).__name__
    legacy.append(record)

result={'schema_version':'1.0','created_utc':'2026-10-18','bucket':'alvin3y10/data','inventory_file':'study-materials/inventory/hf-bucket-tree.json','source_manifest_file':'study-materials/work/download-manifest.json','coverage':{'video_count':sum(len(u['videos']) for c in courses for u in c['units']),'course_count':len(courses),'unit_count':sum(len(c['units']) for c in courses),'nonvideo_sources_downloaded':len(MAN['files']),'transcript_sidecars_checked':len(variant_rows),'legacy_related_question_sources':len(legacy)},'courses':courses,'legacy_related_question_sources':legacy}
out=REPO/'study-materials/datasets/lecture-corpus.json';out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
with (REPO/'study-materials/work/transcript-variants.csv').open('w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=['course','unit','video','variant','similarity_to_json','words','segments']);w.writeheader();w.writerows(variant_rows)
with (REPO/'study-materials/work/video-slide-matches.csv').open('w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=['course','unit','video','video_title','best_slide','slide_title','score','status']);w.writeheader();w.writerows(match_rows)
matched_paths={m['video'] for m in match_rows}
all_video_paths={v['video_source']['bucket_path'] for c in courses for u in c['units'] for v in u['videos']}
report={'coverage':result['coverage'],'transcript_similarity':{'count':len(variant_rows),'below_0_985':sum(x['similarity_to_json']<0.985 for x in variant_rows),'below_0_9':sum(x['similarity_to_json']<0.9 for x in variant_rows)},'video_slide_matches':{'count':len(match_rows),'likely':sum(x['status']=='likely' for x in match_rows),'review':sum(x['status']=='review' for x in match_rows),'unmatched':len(all_video_paths-matched_paths)},'low_confidence_segments':sum(v['low_confidence_segments'] for c in courses for u in c['units'] for v in u['videos']),'pdfs':{'count':sum(len(u['supporting_pdfs']) for c in courses for u in c['units'])+sum('pages' in x for x in legacy),'sparse_pages':sum(p['sparse'] for c in courses for u in c['units'] for pdf in u['supporting_pdfs'] for p in pdf['pages'])+sum(p['sparse'] for x in legacy if 'pages' in x for p in x['pages'])}}
(REPO/'study-materials/work/source-analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
print(f'Corpus written: {out} ({out.stat().st_size/1024**2:.1f} MiB)')
