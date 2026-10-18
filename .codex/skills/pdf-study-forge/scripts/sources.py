#!/usr/bin/env python3
"""Inventory local sources and render PDF/office source pages. Reading/review is a separate step."""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess,tempfile
import fitz

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def inventory(root,out):
    root=Path(root).resolve();rows=[]
    for p in sorted(root.rglob('*')):
        if not p.is_file() or p.resolve()==Path(out).resolve():continue
        suffix=p.suffix.lower();s={'id':'S'+hashlib.sha256(str(p.relative_to(root)).encode()).hexdigest()[:10],'name':p.name,'path':str(p.relative_to(root)),'local_path':str(p.relative_to(root.parent)),'sha256':digest(p),'availability':'available','use':'REVIEW REQUIRED','units':[],'kind':'text'}
        if suffix=='.pdf':
            s['kind']='pdf'
            with fitz.open(p) as d:
                if d.needs_pass:
                    if not d.authenticate(os.environ.get('PDF_FORGE_PASSWORD','')):raise ValueError(f'{p.name}: password required; set PDF_FORGE_PASSWORD and render a decrypted working copy')
                s['units']=[f'p{i}' for i in range(1,len(d)+1)]
        elif suffix in ('.png','.jpg','.jpeg','.svg'):s['kind']='image';s['units']=['image1']
        elif suffix in ('.mp4','.webm','.mkv'):s['kind']='video';s['units']=['full-video-review-or-declared-exclusion']
        elif suffix in ('.pptx','.ppt','.docx'):s['kind']='slides';s['units']=['CONVERT_TO_PDF_AND_INVENTORY_PAGES']
        elif suffix in ('.md','.txt','.srt','.json','.csv'):
            lines=p.read_text(encoding='utf-8').splitlines();s['kind']='transcript' if 'transcript' in p.name or suffix=='.srt' else 'text'
            s['units']=[f'lines-{i+1}-{min(i+40,len(lines))}' for i in range(0,len(lines),40)] or ['empty-file']
        else:s['units']=['unsupported-format-declare-gap-or-convert']
        rows.append(s)
    Path(out).write_text(json.dumps({'source_root':str(root),'sources':rows,'note':'Proposed inventory only. Source paths are relative to the parent of this source folder. Review every unit, record EVIDENCE, and use these sources in PACK.sources.'},indent=2)+'\n')
    print(f'{len(rows)} files inventoried; none automatically marked reviewed')

def render(source,out,dpi):
    p=Path(source).resolve();dest=Path(out).resolve();dest.mkdir(parents=True,exist_ok=True)
    if p.suffix.lower()!='.pdf':
        exe=shutil.which('soffice')
        if not exe:raise ValueError('LibreOffice (soffice) required for office files; supply a PDF export if unavailable')
        with tempfile.TemporaryDirectory() as tmp:
            profile=Path(tmp)/'profile';converted=Path(tmp)/'converted';converted.mkdir()
            subprocess.run([exe,'-env:UserInstallation='+profile.as_uri(),'--headless','--convert-to','pdf','--outdir',str(converted),str(p)],check=True,timeout=180,capture_output=True)
            pdfs=list(converted.glob('*.pdf'))
            if len(pdfs)!=1:raise ValueError('Office conversion did not produce one PDF')
            target=dest/(p.stem+'.pdf');shutil.copyfile(pdfs[0],target);p=target
    with fitz.open(p) as d:
        if d.needs_pass:
            if not d.authenticate(os.environ.get('PDF_FORGE_PASSWORD','')):raise ValueError('Set PDF_FORGE_PASSWORD to the password supplied with the source')
            d.save(dest/(p.stem+'-decrypted.pdf'),encryption=fitz.PDF_ENCRYPT_NONE)
        texts=[];scanned=[]
        for i,page in enumerate(d,1):
            t=page.get_text();texts.append(f'\n--- PAGE {i} ---\n'+t)
            if len(t.strip())<40:scanned.append(i)
            page.get_pixmap(dpi=dpi,alpha=False).save(dest/f'page-{i:04d}.png')
        (dest/'extracted-text.txt').write_text(''.join(texts));(dest/'render-report.json').write_text(json.dumps({'pages':len(d),'image_or_sparse_pages':scanned,'review_required':True,'warning':'Text extraction does not prove equations, diagrams or all content were read.'},indent=2))
    print(dest)

def main():
    a=argparse.ArgumentParser(description=__doc__);sub=a.add_subparsers(dest='cmd',required=True)
    p=sub.add_parser('inventory');p.add_argument('root');p.add_argument('--out',required=True)
    p=sub.add_parser('render');p.add_argument('source');p.add_argument('--out',required=True);p.add_argument('--dpi',type=int,default=120)
    args=a.parse_args()
    if args.cmd=='inventory':inventory(args.root,args.out)
    else:render(args.source,args.out,args.dpi)
if __name__=='__main__':main()
