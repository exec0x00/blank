import json
import os
import uuid

import httpx
from fastapi.testclient import TestClient

from app import create_app
from pool import Account, Pool


def wire(kind, value):
    return 'event: '+kind+'\ndata: '+json.dumps({'type':kind,**value})+'\n\n'


def native_stream(tool=True):
    events=[wire('message_start',{'message':{'uuid':'assistant-native'}})]
    if tool:
        events += [
            wire('content_block_start',{'index':0,'content_block':{'type':'tool_use','id':'toolu_1','name':'echo_ping','input':{}}}),
            wire('content_block_delta',{'index':0,'delta':{'type':'input_json_delta','partial_json':'{"value":"ping"}'}}),
            wire('content_block_stop',{'index':0}),
            wire('content_block_start',{'index':1,'content_block':{'type':'tool_result','tool_use_id':'toolu_1','name':'echo_ping'}}),
            wire('content_block_stop',{'index':1}),
        ]
    events += [
        wire('content_block_start',{'index':2 if tool else 0,'content_block':{'type':'text','text':''}}),
        wire('content_block_delta',{'index':2 if tool else 0,'delta':{'type':'text_delta','text':'pong'}}),
        wire('content_block_stop',{'index':2 if tool else 0}),
        wire('message_delta',{'delta':{'stop_reason':'end_turn'}}),
        wire('message_stop',{}),
    ]
    return ''.join(events)


class FakeClaude:
    def __init__(self):
        self.org='org';self.legacy_only=True;self.device_id=str(uuid.uuid4());self.activity_session_id=str(uuid.uuid4())
        self.account_id='account-1';self.catalogue={'claude-haiku-5-5':{},'claude-sonnet-5-5':{}}
        self.calls=[]
        def transport(request):
            self.calls.append((request.url.path,json.loads(request.content) if request.content else None))
            if request.url.path.endswith('/completion'):
                return httpx.Response(200,text=native_stream(tool=len([x for x in self.calls if x[0].endswith('/completion')])==1),
                                      headers={'content-type':'text/event-stream'})
            if request.url.path.endswith('/tool_result'):return httpx.Response(200,json={})
            return httpx.Response(404,json={'error':{'message':'missing'}})
        self.http=httpx.AsyncClient(base_url='https://claude.ai',transport=httpx.MockTransport(transport))

    async def check(self,response):
        if response.status_code>=400:raise RuntimeError('upstream failed')

    async def request(self,method,path,**kwargs):
        r=await self.http.request(method,path,**kwargs)
        await self.check(r)
        return r.json()

    async def close(self):await self.http.aclose()


def client(monkeypatch,tmp_path):
    monkeypatch.setenv('PASSWORD','local-test-password')
    monkeypatch.setenv('KEY_BUCKET_PATH',str(tmp_path))
    pool=Pool();upstream=FakeClaude()
    pool.accounts=[Account('acct_1','Test',upstream)]
    return TestClient(create_app(pool=pool)),upstream


def test_native_tool_round_trip_and_conversation(monkeypatch,tmp_path):
    app,upstream=client(monkeypatch,tmp_path)
    headers={'x-api-key':'local-test-password','x-claude-code-session-id':'session-one'}
    tools=[{'name':'echo_ping','description':'Return pong','input_schema':{'type':'object','properties':{'value':{'type':'string'}}}}]
    first={'model':'claude-haiku-5-5','max_tokens':1000,'system':'Always be concise',
           'messages':[{'role':'user','content':'Call echo_ping'}],
           'tools':tools,'stream':False}
    with app:
        response=app.post('/api/v1/messages?beta=true',json=first,headers=headers)
        assert response.status_code==200,response.text
        value=response.json()
        assert value['stop_reason']=='tool_use'
        assert value['content']==[{'type':'tool_use','id':'toolu_1','name':'echo_ping','input':{'value':'ping'}}]
        second={**first,'system':'Always be concise. SDK resumed the tool turn.',
                'messages':first['messages']+[
            {'role':'assistant','content':value['content']},
            {'role':'user','content':[{'type':'tool_result','tool_use_id':'toolu_1',
                                       'content':'abc def ghi jkl mno '*5000}]}]}
        response=app.post('/api/v1/messages?beta=true',json=second,headers=headers)
        assert response.status_code==200,response.text
        answer=response.json()
        assert answer['stop_reason']=='end_turn'
        assert answer['content']==[{'type':'text','text':'pong'}]
        third={**first,'system':'The SDK updated its system reminder again.',
               'model':'claude-sonnet-5-5','messages':second['messages']+[
            {'role':'assistant','content':answer['content']},{'role':'user','content':'continue'}]}
        response=app.post('/api/v1/messages?beta=true',json=third,headers=headers)
        assert response.status_code==200,response.text
        assert response.json()['content'][0]['text']=='pong'
        assert app.post('/api/v1/responses',json={},headers=headers).status_code==404
        assert app.post('/v1/chat/completions',json={},headers=headers).status_code==404
        assert app.get('/').text=='status: ok'
    paths=[x[0] for x in upstream.calls]
    assert len([x for x in paths if x.endswith('/completion')])==2
    assert len([x for x in paths if x.endswith('/tool_result')])==1
    posted=[body for path,body in upstream.calls if path.endswith('/tool_result')][0]
    assert 'Tool output truncated' in posted['content'][0]['text']
    first_chat=upstream.calls[0][0].split('/chat_conversations/')[1].split('/')[0]
    second_chat=[x[0] for x in upstream.calls if x[0].endswith('/completion')][1].split('/chat_conversations/')[1].split('/')[0]
    assert first_chat==second_chat
    assert [body['model'] for path,body in upstream.calls if path.endswith('/completion')]==['claude-haiku-5-5','claude-sonnet-5-5']
    prompts=[body['prompt'] for path,body in upstream.calls if path.endswith('/completion')]
    assert prompts[0].count('Always be concise')==1 and 'Always be concise' not in prompts[1]


def test_stream_shape_and_auth(monkeypatch,tmp_path):
    app,_=client(monkeypatch,tmp_path)
    request={'model':'claude-haiku-5-5','max_tokens':1000,'messages':[{'role':'user','content':'Call echo_ping'}],
             'tools':[{'name':'echo_ping','description':'Return pong','input_schema':{'type':'object'}}],
             'stream':True}
    with app:
        assert app.post('/api/v1/messages',json=request).status_code==401
        response=app.post('/api/v1/messages',json=request,
                          headers={'Authorization':'Bearer local-test-password','x-claude-code-session-id':'stream-one'})
        assert response.status_code==200
        assert 'event: message_start' in response.text
        assert 'event: content_block_start' in response.text
        assert 'event: message_delta' in response.text
        assert '"stop_reason":"tool_use"' in response.text
        assert response.text.rstrip().endswith('data: {"type":"message_stop"}')
