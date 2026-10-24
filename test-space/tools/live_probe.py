"""Read-only live check. Credentials are read silently and never saved."""
import getpass, json, sys, urllib.request, urllib.error
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from upstream import UA
key=getpass.getpass('Claude session key (hidden): ').strip()
headers={'Cookie':'sessionKey='+key,'User-Agent':UA,'Origin':'https://claude.ai','Referer':'https://claude.ai/new','Accept':'application/json','Accept-Language':'en-US,en;q=0.8','anthropic-client-platform':'web_claude_ai'}
def get(path):
    with urllib.request.urlopen(urllib.request.Request('https://claude.ai'+path,headers=headers),timeout=30) as r:
        return json.load(r)
try:
    account=get('/api/account')
    print('Authenticated. Settings keys:',list(account.get('settings',{})))
    orgs=get('/api/organizations');org=orgs[0]['uuid']
    models=get(f'/api/organizations/{org}/model_selector/chat')
    print('Model response:',json.dumps(models)[:14000])
    print('Usage:',json.dumps(get(f'/api/organizations/{org}/usage'))[:1500])
except urllib.error.HTTPError as e:
    print('HTTP',e.code,'challenge:',e.headers.get('cf-mitigated')=='challenge')
