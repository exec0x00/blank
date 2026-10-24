"""Interactive diagnostics; the session key exists only in memory."""
import asyncio, getpass, json, sys, uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from upstream import Claude
from errors import APIError

async def main():
    c=Claude(getpass.getpass('Claude session key (hidden): '))
    try:
        await c.connect()
        print('Connected. Available models:',list(c.catalogue))
        print('Commands: rpc, legacy, register, quit')
        while True:
            cmd=await asyncio.to_thread(input,'command> ')
            import importlib,upstream
            importlib.reload(upstream);c.__class__=upstream.Claude
            try:
                if cmd=='quit':break
                if cmd=='rpc':
                    async for e in c.generate('claude-sonnet-5-5','Reply with exactly: bridge test ok',[],'low',100000,128):
                        print(json.dumps(e,ensure_ascii=True))
                elif cmd=='legacy':
                    conv=await c.request('POST',f'/api/organizations/{c.org}/chat_conversations',json={'uuid':str(uuid.uuid4()),'name':'Bridge diagnostic','is_temporary':True})
                    async with c.http.stream('POST',f'/api/organizations/{c.org}/chat_conversations/{conv["uuid"]}/completion',json={'prompt':'Reply with exactly: bridge test ok','model':'claude-sonnet-5-5','timezone':'UTC','locale':'en-US'},headers={'Accept':'text/event-stream'}) as r:
                        await c.check(r)
                        count=0
                        async for line in r.aiter_lines():
                            if line.startswith('event:'):print(line);count+=1
                            if count>30:break
                elif cmd=='register':
                    import httpx,re
                    async with httpx.AsyncClient() as local:
                        html=(await local.get('http://127.0.0.1:8795/')).text
                        key=re.search("const key='([^']+)'",html)[1]
                        session=c.http.headers['cookie'].split('=',1)[1]
                        r=await local.post('http://127.0.0.1:8795/admin/accounts',headers={'Authorization':'Bearer '+key},json={'session_key':session,'label':'Primary'},timeout=60)
                        print('Registration status:',r.status_code)
                        if r.status_code!=200:print(r.text)
                else:print('Unknown command')
            except APIError as e:print('API error:',e.status,e.code,str(e))
    except APIError as e:print('Connect failed:',e.status,e.code,str(e))
    finally:await c.close()

asyncio.run(main())
