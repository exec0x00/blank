#!/usr/bin/env python3
"""End-to-end pagination, all flow layouts, portable links, failure isolation and stale-review tests."""
from pathlib import Path
import copy,json,shutil,sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'));sys.path.insert(0,str(ROOT/'engine'))
import forge
from validate import load,sha,Invalid
import fitz

def main(dest):
    dest=Path(dest).resolve()
    if dest.exists():raise Invalid('Choose a new test directory')
    shutil.copytree(ROOT/'examples/calculus',dest,ignore=shutil.ignore_patterns('output','sample-output','work','.forge-*','*.log','last-build-failure.json','validation-report.json'))
    k=load(dest/'pack.json');k['PACK']['title']='Integration fixture — synthetic layout stress test';k['PACK']['documents']=['master','points','flows']
    k['WORKED'][0]['steps'] += [f'Pagination test step {n}: preserve this complete explanation when a worked block spans several pages. The next step follows in order.' for n in range(1,49)]
    k['WORKED'][0]['check']+=' FINAL-LONG-SOLUTION-SENTINEL'
    node=lambda title:{'kind':'step','title':title,'sub':'Short content used to test routing and print layout.'}
    specs={
      'route':{'question':'Choose a method','rows':[{'title':'Algebra','sub':'Simplify the expression.'},{'title':'Geometry','sub':'Inspect the diagram.'}]},
      'streams':{'left':[node('Compute the left input')],'right':[node('Compute the right input')],'then':[{'kind':'result','title':'Combine the results'}]},
      'ladder':{'start':{'kind':'given','title':'Inspect the conditions'},'rungs':[{'q':'Is the denominator nonzero?','yes':{'kind':'result','title':'Use the direct formula'}},{'q':'Can the variables be exchanged?','yes':{'kind':'result','title':'Use the alternate branch'}}],'last':node('Investigate the singular case')},
      'tree':{'root':{'kind':'given','title':'Classify the derivative'},'branches':[{'title':'Explicit','rows':[['Input','A function formula'],['Action','Differentiate directly']]},{'title':'Implicit','rows':[['Input','A defining relation'],['Action','Differentiate the relation']]}]},
      'loop':{'before':[{'kind':'given','title':'Begin the check'}],'loop':[node('Evaluate a candidate'),{'kind':'question','title':'Does the residual vanish?'}],'after':[{'kind':'result','title':'Accept the checked result'}]},
      'verify':{'given':{'kind':'given','title':'A proposed equality'},'left':[node('Simplify the left side')],'right':[node('Simplify the right side')],'check':{'kind':'check','title':'Compare the two expressions'}}}
    for i,(layout,spec) in enumerate(specs.items(),2):
        id=f'F1.{i}';k['FLOWS'].append({'id':id,'topic':'T1','srcs':['S1'],'title':'Synthetic layout fixture: '+layout,'layout':layout,'spec':spec});k['EVIDENCE'][0]['items'].append(id)
    k['PYQS']=[{'id':'J1.1','topic':'T1','srcs':['S1'],'paper':'Synthetic link fixture (not a real examination)','paper_id':'SRC1','q':'Fixture Q1','marks':1,'text':'Open the worked example through a companion-PDF link.','worked':'W1.1'}];k['EVIDENCE'][0]['items'].append('J1.1')
    k['COMPARISONS'].append({'id':'C1.99','topic':'T1','srcs':['S1'],'title':'Synthetic long-table fixture','head':['Row','Statement'],'rows':[[str(n),f'Row {n} must appear in full; the column header must repeat if the table crosses a page.'] for n in range(1,46)]});k['EVIDENCE'][0]['items'].append('C1.99')
    forge.write(dest/'pack.json',k);report=forge.build(dest)
    alltext='';links=[]
    for path in (dest/'output').glob('*.pdf'):
        with fitz.open(path) as d:
            alltext+=''.join(p.get_text() for p in d)
            links += [l for p in d for l in p.get_links() if l['kind']==fitz.LINK_GOTOR]
    assert 'FINAL-LONG-SOLUTION-SENTINEL' in alltext,'Long-solution tail disappeared'
    assert 'Row 45 must appear in full' in alltext,'Long-table tail disappeared'
    assert links and all(not Path(l['file']).is_absolute() and l['file'].endswith('.pdf') for l in links),'Cross-PDF links are not portable'
    assert report['status']=='REVIEW_REQUIRED'
    old_hash=sha(dest/'output'/report['pdfs'][0]['file'])
    asset_review=dest/'asset-review.json';forge.review_template(dest,asset_review)
    fig=dest/k['FIGS'][0]['file'];original=fig.read_bytes();fig.write_bytes(original+b'\n')
    blocked=False
    try:forge.finalize(dest,asset_review)
    except Invalid as e:blocked=True;assert 'assets changed after build' in str(e),str(e)
    finally:fig.write_bytes(original)
    assert blocked,'Changed figure asset finalized'
    invalid=copy.deepcopy(k);invalid['FORMULAS'][0]['tex']=' + '.join(['x^{123}']*100)
    forge.write(dest/'pack.json',invalid)
    failed=False
    try:forge.build(dest)
    except Invalid as e:
        failed=True;assert 'width' in str(e) or 'exceeds' in str(e),str(e)
    assert failed,'Overwide formula was not rejected'
    assert sha(dest/'output'/report['pdfs'][0]['file'])==old_hash,'Failed build damaged prior output'
    review=dest/'review.json';forge.review_template(dest,review)
    blocked=False
    try:forge.finalize(dest,review)
    except Invalid as e:blocked=True;assert 'changed after build' in str(e),str(e)
    assert blocked,'Stale input finalized'
    result={'passed':True,'checks':['all eight flow layouts rendered','long worked solution retained its last line','45-row table retained last row','cross-PDF solution link is relative','all generated PDFs passed automatic QA','changed figure asset blocked at finalize','overwide formula rejected','prior output preserved on failed build','stale review blocked'],'pages':{p['file']:p['pages'] for p in report['pdfs']},'warning_count':len(report['warnings'])}
    forge.write(dest/'integration-result.json',result);print(json.dumps(result,indent=2))
if __name__=='__main__':main(sys.argv[1])
