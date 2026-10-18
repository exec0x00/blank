#!/usr/bin/env python3
"""Single entry point. Run --help; read SKILL.md before authoring."""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess,sys,tempfile,zipfile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'engine'))
from validate import load,validate,sha,LISTS,Invalid

def write(path,obj):Path(path).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def manifest(folder):return {str(p.relative_to(folder)):sha(p) for p in sorted(Path(folder).rglob('*')) if p.is_file() and 'qa' not in p.relative_to(folder).parts and p.name not in ('quality-report.json','review.json','delivery.zip','release.json')}

def input_assets(project,k):
    paths={x['file'] for x in k['FIGS']}
    paths.update(x['local_path'] for x in k['PACK']['sources'] if x.get('availability')=='available')
    return {p:sha(Path(project)/p) for p in sorted(paths)}

def doctor():
    import importlib.metadata
    from playwright.sync_api import sync_playwright
    from runtime import browser_executable
    info={'python':sys.version.split()[0],'node':shutil.which('node'),'dependencies':{},'optional_tools':{x:shutil.which(x) for x in ['soffice','ffmpeg','pdftotext','tesseract']}}
    for name in ['playwright','PyMuPDF','Pillow','matplotlib','numpy','sympy','jsonschema']:info['dependencies'][name]=importlib.metadata.version(name)
    if not info['node']:raise Invalid('Node.js 18+ required for bundled KaTeX')
    subprocess.run([info['node'],str(ROOT/'engine/katex_render.mjs')],input='[{"tex":"x^2","display":false}]',text=True,capture_output=True,check=True)
    with sync_playwright() as p:
        exe=browser_executable(p);b=p.chromium.launch(executable_path=exe);pg=b.new_page();pg.set_content('<p>PDF engine check</p>');data=pg.pdf();b.close()
        if not data.startswith(b'%PDF'):raise Invalid('Browser did not create a PDF')
        info['browser']=exe
    print(json.dumps(info,indent=2));return info

def check(project,draft=False):
    project=Path(project).resolve();k=load(project/'pack.json');r=validate(k,project,final=not draft)
    return k,r

def build(project,draft=False):
    from build import generate
    from render import print_pdfs,repair_pdf_links,audit_pdf
    import inline
    project=Path(project).resolve();k,r=check(project,draft)
    if not r['ok']:
        write(project/'validation-report.json',r);raise Invalid('\n'.join(r['errors']))
    # A private staging tree prevents stale output from satisfying this build's checks.
    stage=Path(tempfile.mkdtemp(prefix='.forge-build-',dir=project));out=stage/'output';out.mkdir()
    report={'schema_version':'1.0','status':'BUILDING','draft':draft,'input_sha256':sha(project/'pack.json'),'input_assets':input_assets(project,k),'engine_sha256':engine_hash(),'validation':r,'errors':[],'warnings':r['warnings'][:],'pdfs':[]}
    try:
        if draft:
            k['PACK']['title']='DRAFT — '+k['PACK']['title'];k['PACK']['header']='DRAFT · '+k['PACK']['header']
        meta=generate(k,str(project),str(out))
        print('HTML and math built',flush=True)
        dom,errors,warnings=print_pdfs(out,meta,k);report['errors']+=errors;report['warnings']+=warnings
        for rdom in dom.values():rdom.pop('text',None)
        write(out/'dom-report.json',dom)
        count,errors=repair_pdf_links(out,meta);report['portable_links_repaired']=count;report['errors']+=errors
        for stem,_ in meta['docs']:
            result=audit_pdf(out/(stem+'.pdf'),out/'qa');report['pdfs'].append(result)
            report['errors'] += [stem+': '+x for x in result['errors']]
            report['warnings'] += [stem+': '+x for x in result['warnings']]
            print(f'{stem}.pdf: {result["pages"]} pages',flush=True)
        inline.main(str(stage))
        for p in (out/'standalone').glob('*.html'):
            if 'src="assets/' in p.read_text() or 'href="assets/' in p.read_text():report['errors'].append(f'{p.name}: standalone assets unresolved')
        report['artifacts']=manifest(out)
        report['status']='FAILED' if report['errors'] else ('DRAFT' if draft else 'REVIEW_REQUIRED')
        write(out/'quality-report.json',report)
        if report['errors']:raise Invalid('\n'.join(report['errors']))
        dest=project/'output';backup=project/'.forge-previous-output'
        if backup.exists():shutil.rmtree(backup)
        if dest.exists():dest.rename(backup)
        try:out.rename(dest)
        except Exception:
            if backup.exists():backup.rename(dest)
            raise
        if backup.exists():shutil.rmtree(backup)
        shutil.rmtree(stage)
        (project/'last-build-failure.json').unlink(missing_ok=True)
        (project/'validation-report.json').unlink(missing_ok=True)
        print(f'{report["status"]}: {dest}\nReview every page in output/qa, then complete a review.json and run finalize.')
        return report
    except Exception as e:
        report['status']='FAILED';report['errors'].append(str(e));write(out/'quality-report.json',report)
        write(project/'last-build-failure.json',{'staging':str(out),'errors':report['errors']})
        raise Invalid(f'Build failed; previous output retained. Details: {out}/quality-report.json\n{e}') from e

def engine_hash():
    h=hashlib.sha256()
    for sub in ['engine','vendor/katex','references/pack.schema.json','scripts/forge.py']:
        p=ROOT/sub
        for f in sorted(p.rglob('*') if p.is_dir() else [p]):
            if f.is_file() and '__pycache__' not in f.parts:h.update(str(f.relative_to(ROOT)).encode());h.update(f.read_bytes())
    return h.hexdigest()

def review_template(project,dest):
    out=Path(project)/'output';q=load(out/'quality-report.json')
    review={'reviewer':'','input_sha256':q['input_sha256'],'engine_sha256':q['engine_sha256'],'content_review':{'source_fidelity':False,'scope_complete':False,'calculations_checked':False,'notes':''},'pdfs':[{'file':p['file'],'sha256':sha(out/p['file']),'pages_reviewed':[],'layout_ok':False,'notes':''} for p in q['pdfs']],'warning_resolutions':[{'warning':w,'resolution':''} for w in q['warnings']],'open_findings':[]}
    dest=Path(dest)
    if dest.exists():raise Invalid('Review file already exists; refusing to overwrite review evidence')
    write(dest,review);print(dest)

def finalize(project,review_path):
    project=Path(project).resolve();out=project/'output';q=load(out/'quality-report.json');r=load(review_path)
    if q['status'] not in ('REVIEW_REQUIRED','RELEASED') or q['draft']:raise Invalid('Only a complete, passing build can be finalized')
    if q['input_sha256']!=sha(project/'pack.json'):raise Invalid('Content changed after build; rebuild')
    if q['engine_sha256']!=engine_hash():raise Invalid('Engine changed after build; rebuild')
    k,v=check(project)
    if not v['ok']:raise Invalid('Current sources/content fail validation: '+'; '.join(v['errors']))
    if q.get('input_assets')!=input_assets(project,k):raise Invalid('Source or figure assets changed after build; rebuild')
    if q['artifacts']!=manifest(out):raise Invalid('Build artifacts changed; rebuild and review again')
    if not r.get('reviewer','').strip() or r.get('input_sha256')!=q['input_sha256'] or r.get('engine_sha256')!=q['engine_sha256']:raise Invalid('Review identity or build hashes missing/mismatched')
    c=r.get('content_review',{})
    if not all(c.get(x) is True for x in ('source_fidelity','scope_complete','calculations_checked')) or not c.get('notes','').strip():raise Invalid('Content review incomplete')
    if r.get('open_findings'):raise Invalid('Open findings remain')
    byfile={p['file']:p for p in r.get('pdfs',[])}
    if len(byfile)!=len(q['pdfs']) or len(r['pdfs'])!=len(q['pdfs']):raise Invalid('Review every PDF exactly once')
    for pdf in q['pdfs']:
        p=byfile.get(pdf['file'],{})
        if p.get('sha256')!=sha(out/pdf['file']) or p.get('layout_ok') is not True or not p.get('notes','').strip() or sorted(p.get('pages_reviewed',[]))!=list(range(1,pdf['pages']+1)):raise Invalid(f'{pdf["file"]}: review every page of this exact PDF')
    wr=r.get('warning_resolutions',[])
    if len(wr)!=len(q['warnings']) or sorted(x.get('warning','') for x in wr)!=sorted(q['warnings']) or any(not x.get('resolution','').strip() for x in wr):raise Invalid('Resolve every layout warning in the review')
    write(out/'review.json',r);q['status']='RELEASED';write(out/'quality-report.json',q)
    write(out/'release.json',{'status':'RELEASED','reviewer':r['reviewer'],'pages':{p['file']:p['pages'] for p in q['pdfs']},'input_sha256':q['input_sha256'],'engine_sha256':q['engine_sha256'],'limitations':'Automated checks and recorded review are evidence, not a guarantee of subject accuracy or PDF/UA certification.'})
    with zipfile.ZipFile(out/'delivery.zip','w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(out.iterdir()):
            if p.suffix=='.pdf' or p.name in ('quality-report.json','release.json','review.json'):z.write(p,p.name)
        for p in sorted((out/'standalone').glob('*.html')):z.write(p,'html/'+p.name)
    print(out/'delivery.zip')

def init(project,title):
    p=Path(project);p.mkdir(parents=True,exist_ok=True)
    if (p/'pack.json').exists():raise Invalid('pack.json already exists')
    k={'schema_version':'1.0','PACK':{'course':'FILL COURSE','unit':'FILL UNIT','scope':'FILL EXACT SCOPE','title':title,'slug':'study-pack','header':title,'date':'FILL DATE','compiled_from':'FILL SOURCES','how_to_use':'FILL READING ROUTE','sources':[],'gaps':[],'documents':['master','formulas','points','figures','flows','recall']},'TOPICS':[],'EVIDENCE':[],'CHECKS':[]}
    for key in LISTS:k.setdefault(key,[])
    write(p/'pack.json',k)
    for name in ['sources','figures','work']:(p/name).mkdir(exist_ok=True)
    print(f'{p}/pack.json created; fill it using examples/calculus/pack.json and references/authoring.md. The empty scaffold intentionally fails validation.')

def main():
    ap=argparse.ArgumentParser(description=__doc__);sub=ap.add_subparsers(dest='cmd',required=True)
    sub.add_parser('doctor')
    p=sub.add_parser('init');p.add_argument('project');p.add_argument('--title',required=True)
    for cmd in ('check','build'):
        p=sub.add_parser(cmd);p.add_argument('project');p.add_argument('--draft',action='store_true',help='Allow declared source gaps; visibly draft output; cannot finalize')
    p=sub.add_parser('review-template');p.add_argument('project');p.add_argument('--out',required=True)
    p=sub.add_parser('finalize');p.add_argument('project');p.add_argument('--review',required=True)
    a=ap.parse_args()
    try:
        if a.cmd=='doctor':doctor()
        elif a.cmd=='init':init(a.project,a.title)
        elif a.cmd=='check':
            _,r=check(a.project,a.draft);print(json.dumps(r,indent=2));return 0 if r['ok'] else 1
        elif a.cmd=='build':build(a.project,a.draft)
        elif a.cmd=='review-template':review_template(a.project,a.out)
        elif a.cmd=='finalize':finalize(a.project,a.review)
    except Exception as e:print(f'ERROR: {e}',file=sys.stderr);return 1
    return 0
if __name__=='__main__':raise SystemExit(main())
