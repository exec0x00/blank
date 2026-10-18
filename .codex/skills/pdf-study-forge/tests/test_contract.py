"""Regression tests for real omission, provenance and rendering failure modes."""
from pathlib import Path
import copy,json,sys,tempfile,unittest,shutil
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'engine'));sys.path.insert(0,str(ROOT/'scripts'))
from validate import load,validate,expression,Invalid
BASE=ROOT/'examples/calculus'
class ContractTests(unittest.TestCase):
 def setUp(self):self.k=load(BASE/'pack.json')
 def reject(self,fragment):
  r=validate(self.k,BASE);self.assertFalse(r['ok']);self.assertTrue(any(fragment in e for e in r['errors']),r['errors'])
 def test_complete_fixture(self):self.assertTrue(validate(self.k,BASE)['ok'])
 def test_unknown_root_key(self):self.k['FORMULA']=[];self.reject('Additional properties')
 def test_duplicate_id(self):self.k['WORKED'][0]['id']=self.k['FORMULAS'][0]['id'];self.reject('Duplicate ID')
 def test_unknown_topic(self):self.k['WORKED'][0]['topic']='T999';self.reject('unknown topic')
 def test_unsourced_trap(self):self.k['TRAPS'][0]['srcs']=[];self.reject('non-empty')
 def test_unknown_citation(self):self.k['DEFS'][0]['srcs']=['nonexistent'];self.reject('unknown evidence')
 def test_missing_source_unit(self):self.k['PACK']['sources'][0]['units'].append('unread');self.reject('expected exactly one')
 def test_unreviewed_source(self):self.k['EVIDENCE'][0]['reviewed']=False;self.reject('not been reviewed')
 def test_false_coverage_mapping(self):self.k['EVIDENCE'][0]['items'].remove('E1.1');self.reject('does not map back')
 def test_hash_mismatch(self):self.k['PACK']['sources'][0]['sha256']='0'*64;self.reject('source hash changed')
 def test_missing_source(self):self.k['PACK']['sources'][0]['local_path']='absent.pdf';self.reject('Missing file')
 def test_escape_source_path(self):self.k['PACK']['sources'][0]['local_path']='../../requirements.txt';self.reject('escapes the project')
 def test_gap_blocks_release_validation(self):self.k['EVIDENCE'][0].update(status='gap',items=[],reason='Unread image');self.reject('unresolved source gap')
 def test_low_content_topic(self):self.k['TOPICS'][0]['overview']='Title only.';self.reject('at least 20 words')
 def test_missing_worked(self):self.k['WORKED']=[x for x in self.k['WORKED'] if x['topic']!='T1'];self.reject('requires 1 WORKED')
 def test_missing_check(self):self.k['CHECKS']=[x for x in self.k['CHECKS'] if x['item']!='E1.1'];self.reject('requires a verification record')
 def test_wrong_answer_assertion(self):self.k['CHECKS'][0]['rhs']='999';self.reject('verification failed')
 def test_manual_check_not_reviewed(self):self.k['CHECKS'][2]['reviewed']=False;self.reject('not reviewed')
 def test_bad_math(self):self.k['POINTS'][0]['text']='Broken $x';self.reject('unmatched $')
 def test_unrendered_math(self):self.k['POINTS'][0]['text']=r'Use \frac{x}{y} here.';self.reject('outside math')
 def test_script_html(self):self.k['POINTS'][0]['text']='<script>alert(1)</script>';self.reject('Unsupported markup')
 def test_external_attribute(self):self.k['POINTS'][0]['text']='<a href="https://example.com">text</a>';self.reject('Unsupported attribute')
 def test_placeholder(self):self.k['POINTS'][0]['text']='TODO fill later';self.reject('placeholder')
 def test_missing_top_equation(self):self.k['TOP_FORMULAS'].append('E999');self.reject('missing equations')
 def test_unsourced_rank(self):self.k['FORMULAS'][0]['stars']=3;self.reject('rank_evidence')
 def test_ragged_table(self):self.k['COMPARISONS'][0]['rows'][0].pop();self.reject('ragged table')
 def test_missing_figure(self):self.k['FIGS'][0]['file']='absent.svg';self.reject('Missing file')
 def test_modules_overlap(self):self.k['MODULES']=[{'id':'M1','title':'One','topics':['T1','T2','T3','T3']}];self.reject('partition')
 def test_no_formula_and_code_together(self):self.k['FORMULAS'][0]['code']='x=1';self.reject('exactly one')
 def test_safe_expression_arithmetic(self):self.assertEqual(expression('2+3*4'),14)
 def test_expression_rejects_code(self):
  for text in ['__import__("os").system("true")','x.__class__','[x for x in []]','open("x")']:
   with self.assertRaises((Invalid,SyntaxError)):expression(text)
 def test_unknown_symbol(self):
  with self.assertRaises(Invalid):expression('a+1')
 def test_relocated_merge(self):
  from merge import merge
  with tempfile.TemporaryDirectory() as td:
   dst=Path(td)/'merged';merge([BASE,ROOT/'examples/chemistry'],dst,'Portable combined example')
   moved=Path(td)/'relocated';dst.rename(moved);k=load(moved/'pack.json');r=validate(k,moved)
   self.assertTrue(r['ok'],r['errors']);self.assertEqual(len(k['TOP_FORMULAS']),4)
 def test_multiple_notes_render(self):
  from build import Pack
  second=dict(self.k['NOTES'][0],id='N1.2',text='A second independent recap must survive.')
  self.k['NOTES'].append(second);p=Pack(self.k,str(BASE));self.assertIn(second['text'],p.note('T1'));self.assertIn(self.k['NOTES'][0]['text'],p.note('T1'))
if __name__=='__main__':unittest.main(verbosity=2)
