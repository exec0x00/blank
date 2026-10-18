"""Strict structure, provenance, completeness and calculation checks. No input code is executed."""
from pathlib import Path
import ast, collections, hashlib, html, json, re
from html.parser import HTMLParser
import jsonschema
import sympy as sp
ROOT=Path(__file__).resolve().parents[1]
LISTS=['MODULES','TOPICS','DEFS','STATEMENTS','POINTS','WHY','TRAPS','FORMULAS','SYMBOLS','WORKED','PYQS','NOTES','KEYWORDS','RAPID','TOP_FACTS','TOP_FORMULAS','FIGS','FLOWS','COMPARISONS','MNEMONICS','DERIVATIONS','PRACTICE']
CONTENT=[x for x in LISTS if x not in ('MODULES','TOPICS','TOP_FORMULAS')]
class Invalid(ValueError): pass

def resolve_local(base, value):
    p=(Path(base)/value).resolve()
    if not p.is_relative_to(Path(base).resolve()): raise Invalid(f'Path escapes the project: {value}')
    if not p.is_file(): raise Invalid(f'Missing file: {value}')
    return p

def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()

class Markup(HTMLParser):
    def __init__(self): super().__init__(convert_charrefs=False); self.errors=[]
    def handle_starttag(self,tag,attrs):
        if tag not in {'b','strong','i','em','br','p','ul','ol','li','sup','sub','code','a'}:self.errors.append(f'Unsupported markup <{tag}>')
        for key,val in attrs:
            if tag!='a' or key!='href' or not (val or '').startswith('#'):self.errors.append(f'Unsupported attribute {tag}.{key}')

def strings(obj, path=''):
    if isinstance(obj,str): yield path,obj
    elif isinstance(obj,dict):
        for k,v in obj.items():yield from strings(v,f'{path}/{k}')
    elif isinstance(obj,list):
        for i,v in enumerate(obj):yield from strings(v,f'{path}/{i}')

FUNCS={n:getattr(sp,n) for n in ['sin','cos','tan','asin','acos','atan','exp','log','sqrt','Abs','diff','integrate','simplify','factor','expand','limit']}
FUNCS['Rational']=sp.Rational

def expression(text,symbols=None):
    """Tiny AST interpreter: arithmetic, explicit symbols, whitelisted SymPy calls; never eval/parse_expr."""
    if len(text)>5000:raise Invalid('Check expression exceeds 5000 characters')
    env={'pi':sp.pi,'E':sp.E,'oo':sp.oo}
    for name,assumptions in (symbols or {}).items():
        if not re.fullmatch('[A-Za-z][A-Za-z0-9]*',name):raise Invalid(f'Bad symbol {name}')
        if name in FUNCS or name in env:raise Invalid(f'Reserved symbol {name}')
        if set(assumptions)-{'real','positive','negative','nonzero','integer','nonnegative'}:raise Invalid('Unsupported symbol assumption')
        env[name]=sp.Symbol(name,**assumptions)
    tree=ast.parse(text,mode='eval')
    if sum(1 for _ in ast.walk(tree))>500:raise Invalid('Check expression too complex')
    def walk(n):
        if isinstance(n,ast.Constant) and type(n.value) in (int,float):return sp.Rational(str(n.value))
        if isinstance(n,ast.Name) and n.id in env:return env[n.id]
        if isinstance(n,ast.UnaryOp) and isinstance(n.op,(ast.UAdd,ast.USub)):return walk(n.operand)*(1 if isinstance(n.op,ast.UAdd) else -1)
        if isinstance(n,ast.BinOp):
            a,b=walk(n.left),walk(n.right)
            if isinstance(n.op,ast.Add):return a+b
            if isinstance(n.op,ast.Sub):return a-b
            if isinstance(n.op,ast.Mult):return a*b
            if isinstance(n.op,ast.Div):return a/b
            if isinstance(n.op,ast.Pow):
                if b.is_number and abs(b)>10000:raise Invalid('Exponent too large')
                return a**b
        if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id in FUNCS and not n.keywords:return FUNCS[n.func.id](*[walk(x) for x in n.args])
        raise Invalid(f'Unsupported expression: {ast.dump(n)[:100]}; declare symbols explicitly')
    return walk(tree.body)

def run_check(c):
    if not c['reviewed']:return False,'not reviewed'
    if c['method']=='manual':return True,'manual record only; no mathematical proof by software'
    if 'lhs' not in c or 'rhs' not in c:return False,'lhs and rhs required'
    try:
        a=expression(c['lhs'],c.get('symbols'));b=expression(c['rhs'],c.get('symbols'))
        if c['method']=='symbolic':
            diff=sp.simplify(a-b)
            return diff==0,f'residual = {str(diff)[:200]}'
        if a.free_symbols or b.free_symbols:return False,'numeric check has free symbols'
        af,bf=complex(sp.N(a,30)),complex(sp.N(b,30))
        import math
        if not all(math.isfinite(v) for z in (af,bf) for v in (z.real,z.imag)):return False,'non-finite result'
        tol=c.get('atol',1e-10)+c.get('rtol',1e-8)*abs(bf)
        return abs(af-bf)<=tol,f'absolute residual = {abs(af-bf):.4g}; tolerance = {tol:.4g}'
    except Exception as e:return False,str(e)

def load(path):
    p=Path(path); k=json.loads(p.read_text(encoding='utf-8'), parse_constant=lambda value: (_ for _ in ()).throw(Invalid('Non-finite JSON number: '+value)))
    return k

def validate(k,base,final=True):
    errors=[];warnings=[];checks=[]
    schema=json.loads((ROOT/'references/pack.schema.json').read_text())
    for e in jsonschema.Draft202012Validator(schema).iter_errors(k):errors.append('/'+ '/'.join(map(str,e.absolute_path))+': '+e.message)
    if errors:return {'ok':False,'errors':errors,'warnings':warnings,'checks':checks}
    for key in LISTS:k.setdefault(key,[])
    allitems=[x for key in CONTENT for x in k[key]]
    iditems=k['TOPICS']+k['MODULES']+allitems
    ids=[x['id'] for x in iditems];byid={x['id']:x for x in iditems}
    for ident,n in collections.Counter(ids).items():
        if n>1:errors.append(f'Duplicate ID: {ident}')
    topics={x['id']:x for x in k['TOPICS']}
    sources={s['id']:s for s in k['PACK']['sources']}
    if len(sources)!=len(k['PACK']['sources']):errors.append('Duplicate source IDs')
    ev={e['id']:e for e in k['EVIDENCE']}
    if len(ev)!=len(k['EVIDENCE']):errors.append('Duplicate evidence IDs')
    if set(ids)&set(ev):errors.append('Content IDs must differ from evidence IDs')
    if len({c['id'] for c in k['CHECKS']})!=len(k['CHECKS']):errors.append('Duplicate verification IDs')
    for x in allitems:
        if x['topic'] not in topics:errors.append(f'{x["id"]}: unknown topic {x["topic"]}')
    for x in k['TOPICS']+allitems:
        for tag in x['srcs']:
            if tag not in ev:errors.append(f'{x["id"]}: unknown evidence {tag}')
            elif ev[tag]['status']!='covered':errors.append(f'{x["id"]}: cites non-covered evidence {tag}')
            elif x['id'] not in ev[tag]['items']:errors.append(f'{x["id"]}: evidence {tag} does not map back to this item')
        if x.get('stars',0)>0:
            rs=x.get('rank_evidence',[])
            if not rs:errors.append(f'{x["id"]}: importance stars require rank_evidence')
            if any(v not in ev for v in rs):errors.append(f'{x["id"]}: invalid rank_evidence')
    seenunits=collections.Counter()
    for e in k['EVIDENCE']:
        source=sources.get(e['source']);seenunits[(e['source'],e['unit'])]+=1
        if not source:errors.append(f'{e["id"]}: source not registered')
        elif e['unit'] not in source['units']:errors.append(f'{e["id"]}: unit not in source inventory')
        if e['status']=='covered':
            if not e['reviewed']:errors.append(f'{e["id"]}: source unit has not been reviewed')
            if not e['items']:errors.append(f'{e["id"]}: covered unit has no mapped items')
            for i in e['items']:
                if i not in byid:errors.append(f'{e["id"]}: missing content {i}')
                elif e['id'] not in byid[i].get('srcs',[]):errors.append(f'{e["id"]}: {i} lacks reciprocal citation')
        else:
            if not e.get('reason'):errors.append(f'{e["id"]}: {e["status"]} needs a reason')
            if e['items']:errors.append(f'{e["id"]}: non-covered unit cannot claim content')
            if e['status']=='gap':(errors if final else warnings).append(f'{e["id"]}: unresolved source gap: {e.get("reason","")}')
    for sid,s in sources.items():
        for unit in s['units']:
            if seenunits[(sid,unit)]!=1:errors.append(f'{sid}/{unit}: expected exactly one coverage decision, found {seenunits[(sid,unit)]}')
        if s['availability']=='missing':
            (errors if final else warnings).append(f'{sid}: source unavailable')
            continue
        if not s.get('local_path') or not s.get('sha256'):errors.append(f'{sid}: available source needs local_path and sha256');continue
        try:
            p=resolve_local(base,s['local_path'])
            if sha(p)!=s['sha256']:errors.append(f'{sid}: source hash changed; re-review it')
            if s['kind']=='pdf':
                import fitz
                with fitz.open(p) as d:
                    if d.needs_pass:errors.append(f'{sid}: decrypt a local working copy using the supplied password')
                    elif set(s['units'])!={f'p{n}' for n in range(1,len(d)+1)}:errors.append(f'{sid}: inventory must account for every PDF page (including excluded pages)')
        except Exception as e:errors.append(f'{sid}: {e}')
    for t in k['TOPICS']:
        if len(re.sub('<[^>]*>','',t['overview']).split())<20:errors.append(f'{t["id"]}: overview needs at least 20 words explaining scope and purpose')
        for kind,need in t['requirements'].items():
            n=sum(x['topic']==t['id'] for x in k[kind])
            if isinstance(need,int) and n<need:errors.append(f'{t["id"]}: requires {need} {kind}, found {n}')
            if isinstance(need,dict) and n:errors.append(f'{t["id"]}: {kind} declared not applicable but contains {n} items')
        if not any(x['topic']==t['id'] for x in k['NOTES']):errors.append(f'{t["id"]}: missing topic recap')
    assigned=[]
    for m in k['MODULES']:
        assigned+=m['topics']
        if any(t not in topics for t in m['topics']):errors.append(f'{m["id"]}: unknown module topic')
    if assigned and (len(assigned)!=len(set(assigned)) or set(assigned)!=set(topics)):errors.append('Modules must partition all topics exactly once')
    if k['PACK'].get('topic_order') and (set(k['PACK']['topic_order'])!=set(topics) or len(k['PACK']['topic_order'])!=len(topics)):errors.append('topic_order must list every topic once')
    formula_ids={x['id'] for x in k['FORMULAS']};worked_ids={x['id'] for x in k['WORKED']}
    if set(k['TOP_FORMULAS'])-formula_ids:errors.append('TOP_FORMULAS contains missing equations')
    for f in k['FORMULAS']:
        if bool(f.get('tex'))==bool(f.get('code')):errors.append(f'{f["id"]}: provide exactly one of tex or code')
    for p in k['PYQS']:
        if p['worked'] not in worked_ids:errors.append(f'{p["id"]}: missing worked solution {p["worked"]}')
        if p['paper_id'] not in sources:errors.append(f'{p["id"]}: paper_id must identify an inventoried paper')
    for c in k['COMPARISONS']:
        if any(len(row)!=len(c['head']) for row in c['rows']):errors.append(f'{c["id"]}: ragged table')
    for g in k['FIGS']:
        try:
            p=resolve_local(base,g['file'])
            if p.suffix.lower()!='.svg':raise Invalid('use a vector SVG; see plot.py')
            from xml.etree import ElementTree as ET
            r=ET.parse(p).getroot()
            if r.tag.split('}')[-1]!='svg':raise Invalid('not an SVG')
            if not r.get('viewBox'):raise Invalid('SVG needs viewBox')
            for n in r.iter():
                if n.tag.split('}')[-1] in {'script','foreignObject'}:raise Invalid('active SVG content')
                for a,v in n.attrib.items():
                    if any(not u.strip(" \"'").startswith('#') for u in re.findall(r'url\(([^)]+)\)',v,re.I)):raise Invalid('external SVG CSS resource')
                    if a.lower().startswith('on') or (a.split('}')[-1]=='href' and not v.startswith('#')):raise Invalid('external/active SVG reference')
        except Exception as e:errors.append(f'{g["id"]}: {e}')
    for path,value in strings(k):
        if any(ord(c)<32 and c not in '\n\r\t' for c in value):errors.append(f'{path}: control character; check JSON backslash escaping')
        field=path.rsplit('/',1)[-1]
        if any(f'/{s}/' in path for s in ('CHECKS','EVIDENCE')) or field in ('tex','code','path','local_path','file','sha256'):continue
        parser=Markup();parser.feed(value)
        errors.extend(f'{path}: {e}' for e in parser.errors)
        if re.search(r'\b(TODO|TBD|FIXME|INSERT_HERE|PLACEHOLDER)\b',value,re.I):errors.append(f'{path}: placeholder text')
        if value.count('$')%2:errors.append(f'{path}: unmatched $; use &#36; for currency')
        nomath=re.sub(r'\$\$.*?\$\$|\$[^$]*\$','',value,flags=re.S)
        if re.search(r'\\(?:frac|partial|alpha|beta|sqrt|sum|begin)\b|[A-Za-z)]\^\{',nomath):errors.append(f'{path}: TeX outside math delimiters')
    checked=collections.defaultdict(list)
    for c in k['CHECKS']:
        if c['item'] not in byid:errors.append(f'{c["id"]}: check targets missing item')
        ok,note=run_check(c);checks.append({'id':c['id'],'item':c['item'],'ok':bool(ok),'method':c['method'],'result':note})
        checked[c['item']].append(c)
        if not ok:errors.append(f'{c["id"]}: verification failed: {note}')
    for x in k['FORMULAS']+k['WORKED']+k['DERIVATIONS']+k['PRACTICE']:
        if x['id'] not in checked:errors.append(f'{x["id"]}: requires a verification record')
    docs=k['PACK']['documents'];na=k['PACK'].get('not_applicable',{})
    for name,keys in [('formulas',['FORMULAS']),('figures',['FIGS']),('flows',['FLOWS','COMPARISONS']),('questions',['PRACTICE'])]:
        if name in docs and not any(k[x] for x in keys) and not na.get(name):errors.append(f'{name}: empty document needs an explicit not_applicable reason')
    if 'recall' in docs and (not k['KEYWORDS'] or not k['RAPID'] or not k['TOP_FACTS']):errors.append('recall document needs keywords, rapid recall and top facts')
    if 'points' in docs and not any(k[x] for x in ('DEFS','POINTS','STATEMENTS','WHY','TRAPS')):errors.append('points document has no content')
    if k['PYQS'] and 'master' not in docs:errors.append('Past-paper solution links require the master document')
    return {'ok':not errors,'errors':errors,'warnings':warnings,'checks':checks,'counts':{key:len(k[key]) for key in LISTS},'coverage':dict(collections.Counter(e['status'] for e in k['EVIDENCE']))}
