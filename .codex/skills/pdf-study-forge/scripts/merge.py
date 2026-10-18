#!/usr/bin/env python3
"""Merge validated JSON packs into one portable source tree, preserving all content and assets."""
from pathlib import Path
import argparse,copy,json,re,shutil,sys,tempfile
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'engine'))
from validate import LISTS,load,validate,resolve_local,Invalid

def merge(inputs,out,title):
    out=Path(out).resolve()
    if out.exists():raise Invalid('Output must be a new directory; existing work is never deleted')
    for p in inputs:
        if out.is_relative_to(Path(p).resolve()):raise Invalid('Merged output must not be inside a source pack')
    out.parent.mkdir(parents=True,exist_ok=True);tmp=Path(tempfile.mkdtemp(prefix='.forge-merge-',dir=out.parent))
    merged={k:[] for k in LISTS};merged.update(schema_version='1.0',EVIDENCE=[],CHECKS=[]);pack=None
    try:
        for n,inp in enumerate(inputs,1):
            inp=Path(inp).resolve();k=load(inp/'pack.json');r=validate(k,inp)
            if not r['ok']:raise Invalid(f'{inp}: '+'; '.join(r['errors']))
            prefix=f'S{n:02d}_'
            ids=[x['id'] for key in LISTS if key!='TOP_FORMULAS' for x in k[key]]+[x['id'] for x in k['EVIDENCE']+k['CHECKS']+k['PACK']['sources']]
            mapping={id:prefix+id for id in ids}
            token=re.compile(r'(?<![\w.])('+ '|'.join(re.escape(x) for x in sorted(mapping,key=len,reverse=True))+r')(?![\w.])')
            def rewrite(x,field=''):
                if field in ('tex','code','local_path','file','path','sha256'):return x
                if isinstance(x,str):return token.sub(lambda m:mapping[m.group(0)],x)
                if isinstance(x,list):return [rewrite(y,field) for y in x]
                if isinstance(x,dict):return {a:rewrite(b,a) for a,b in x.items()}
                return x
            m=rewrite(k)
            if pack is None:pack=copy.deepcopy(m['PACK']);pack['sources']=[];pack['gaps']=[];pack['tag_legend']=[]
            for old,s in zip(k['PACK']['sources'],m['PACK']['sources']):
                if old['availability']=='available':
                    target=Path('sources')/prefix/Path(old['local_path']).name;(tmp/target).parent.mkdir(parents=True,exist_ok=True)
                    # Prefix with source ID so same basenames from different directories never collide.
                    target=target.with_name(s['id']+'-'+target.name);shutil.copyfile(resolve_local(inp,old['local_path']),tmp/target);s['local_path']=str(target)
                pack['sources'].append(s)
            for old,g in zip(k['FIGS'],m['FIGS']):
                target=Path('figures')/(g['id']+'.svg');(tmp/'figures').mkdir(exist_ok=True);shutil.copyfile(resolve_local(inp,old['file']),tmp/target);g['file']=str(target)
            for key in LISTS:
                if key!='MODULES':merged[key]+=m[key]
            merged['MODULES'].append({'id':f'M{n}','title':k['PACK']['title'],'topics':[x['id'] for x in m['TOPICS']]})
            merged['EVIDENCE']+=m['EVIDENCE'];merged['CHECKS']+=m['CHECKS'];pack['gaps']+=[k['PACK']['title']+': '+g for g in m['PACK']['gaps']]
            pack['tag_legend']+=m['PACK'].get('tag_legend',[])
        pack.update(title=title,slug='merged-study-pack',header=title,scope='Combined scope: '+'; '.join(load(Path(p)/'pack.json')['PACK']['scope'] for p in inputs),compiled_from='Merged from complete JSON source packs. All source files and figures required to rebuild are copied into this project.',topic_order=[x['id'] for x in merged['TOPICS']])
        # A merged document can be applicable even if the first source pack had no figures.
        pack['not_applicable']={};merged['PACK']=pack
        for name,keys in [('formulas',['FORMULAS']),('figures',['FIGS']),('flows',['FLOWS','COMPARISONS']),('questions',['PRACTICE'])]:
            if not any(merged[key] for key in keys):pack['not_applicable'][name]='None of the merged sources requires content of this type.'
        r=validate(merged,tmp)
        if not r['ok']:raise Invalid('; '.join(r['errors']))
        (tmp/'pack.json').write_text(json.dumps(merged,ensure_ascii=False,indent=2)+'\n');tmp.rename(out);print(out)
    except Exception:
        shutil.rmtree(tmp,ignore_errors=True);raise
if __name__=='__main__':
    a=argparse.ArgumentParser(description=__doc__);a.add_argument('out');a.add_argument('inputs',nargs='+');a.add_argument('--title',required=True);x=a.parse_args();merge(x.inputs,x.out,x.title)
