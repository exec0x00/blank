import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import urllib.parse
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, HTMLResponse, PlainTextResponse, RedirectResponse, Response, StreamingResponse
from errors import APIError
from pool import Pool
from usage_store import UsageStore
from persist import KeyStore
from login_flow import State, PAGE, SEND_SITEKEY, VERIFY_SITEKEY, login as email_login
# How often a queued streaming request sends a keep-alive comment.
QUEUE_NOTE_SECONDS=8
from anthropic_api import DIAGNOSTICS, AnthropicBridge, digest, parse as parse_messages, render as render_messages_api, sse as anthropic_sse
from token_budget import count_text

ROOT=Path(__file__).parent
MAX_REQUEST_BYTES=16*1024*1024

def create_app(pool=None,initial_session_key=None,usage=None):
    password=os.environ.get('PASSWORD')
    if not password:raise RuntimeError('PASSWORD secret is required')
    usage=usage or UsageStore()
    pool=pool or Pool(store=usage)
    if getattr(pool,'store',None) is None:pool.store=usage
    token=password
    store=KeyStore(password=password)
    records=store.load()
    bridge=AnthropicBridge(pool)
    saved={}
    login_state=State()
    login_save_lock=asyncio.Lock()
    admin_cookie=secrets.token_urlsafe(48)
    @asynccontextmanager
    async def life(app):
        async def reconnect():
            to_connect=list(records)
            if initial_session_key:to_connect.append({'key':initial_session_key,'label':'Primary'})
            for record in to_connect:
                try:
                    result=await pool.add(record['key'],record.get('label','Saved account'))
                    saved[result['id']]={'key':record['key'],'label':record.get('label','Saved account')}
                except Exception as exc:
                    print('Could not reconnect a saved account:',type(exc).__name__,flush=True)
            if initial_session_key and all(r['key']!=initial_session_key for r in records):
                records.append({'key':initial_session_key,'label':'Primary'})
                persist()
        reconnect_task=asyncio.create_task(reconnect())
        pool.start_background()
        yield
        reconnect_task.cancel()
        await asyncio.gather(reconnect_task,return_exceptions=True)
        await pool.stop_background()
        usage.flush()
        for state in list(bridge.sessions.values()):
            await state['turn'].close()
        for account in pool.accounts:await account.client.close()
    app=FastAPI(title='Claude account Messages bridge',version='1.0.0',lifespan=life)
    app.state.pool=pool;app.state.api_key=token
    app.state.bridge=bridge

    def has_admin(request):
        return hmac.compare_digest(request.cookies.get('space_admin',''),admin_cookie)

    def persist():store.save(records)

    @app.exception_handler(APIError)
    async def handle_error(request,e):
        kind=e.code if e.code in ('invalid_request_error','authentication_error','permission_error','not_found_error','rate_limit_error','api_error','overloaded_error') else ('rate_limit_error' if e.status==429 else 'api_error' if e.status>=500 else 'invalid_request_error')
        return JSONResponse({'type':'error','error':{'type':kind,'message':str(e)}},status_code=e.status,
                            headers={'Retry-After':str(e.retry_after)} if e.retry_after else {})

    @app.middleware('http')
    async def guard(request,call_next):
        origin=request.headers.get('origin')
        if origin and urllib.parse.urlsplit(origin).netloc != request.headers.get('host'):
            return JSONResponse(APIError(403,'Origin denied.','invalid_origin').body(),status_code=403)
        path=request.url.path
        if path=='/api' or path=='/api/':
            request.scope['path']='/v1/models'
        elif path.startswith('/api/v1/'):
            request.scope['path']=path[4:]
        elif path.startswith('/api/'):
            request.scope['path']='/v1'+path[4:]
        if path.startswith(('/admin','/login')) or path=='/dashboard':
            if not has_admin(request):
                if path=='/dashboard' or path=='/login':return RedirectResponse('/auth')
                return JSONResponse({'error':'Password required'},status_code=401)
        elif path=='/api' or path.startswith(('/api/','/v1/')):
            auth=request.headers.get('authorization','')
            key=request.headers.get('x-api-key','')
            if not (hmac.compare_digest(auth,'Bearer '+token) or hmac.compare_digest(key,token)):
                return JSONResponse({'type':'error','error':{'type':'authentication_error','message':'Invalid API key.'}},status_code=401)
        try:length=int(request.headers.get('content-length','0'))
        except ValueError:length=999_999_999
        if length>MAX_REQUEST_BYTES:
            return JSONResponse({'type':'error','error':{'type':'invalid_request_error','message':'Request exceeds 16 MiB.'}},status_code=413)
        if request.method in ('POST','PUT','PATCH') and not request.headers.get('content-length'):
            data=bytearray()
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data)>MAX_REQUEST_BYTES:return JSONResponse({'type':'error','error':{'type':'invalid_request_error','message':'Request exceeds 16 MiB.'}},status_code=413)
            request._body=bytes(data)
        response=await call_next(request)
        response.headers['x-request-id']='req_'+secrets.token_hex(16)
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        return response

    async def body(request):
        raw=bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw)>MAX_REQUEST_BYTES:raise APIError(413,'Request too large.','request_too_large')
        try:v=json.loads(raw)
        except Exception:raise APIError(400,'Invalid JSON body.','invalid_json') from None
        if not isinstance(v,dict):raise APIError(400,'Body must be a JSON object.','invalid_json')
        return v

    @app.get('/',response_class=PlainTextResponse)
    async def home():return 'status: ok'
    @app.get('/health',response_class=PlainTextResponse)
    async def health():return 'status: ok'
    @app.get('/auth',response_class=HTMLResponse)
    async def auth_page():
        return (ROOT/'static/auth.html').read_text(encoding='utf8')
    @app.post('/auth')
    async def auth_submit(request:Request):
        form=await request.form()
        if not hmac.compare_digest(str(form.get('password','')),password):
            return HTMLResponse('Incorrect password',status_code=401)
        response=RedirectResponse('/dashboard',status_code=303)
        response.set_cookie('space_admin',admin_cookie,httponly=True,secure=True,samesite='strict',path='/')
        return response
    @app.get('/logout')
    async def logout():
        response=RedirectResponse('/auth',status_code=303)
        response.delete_cookie('space_admin',path='/')
        return response
    @app.get('/dashboard',response_class=HTMLResponse)
    async def dashboard():return (ROOT/'static/index.html').read_text(encoding='utf8').replace("'__API_KEY__'",json.dumps(token).replace('<','\\u003c'))
    @app.get('/admin/status')
    async def status():
        return {'accounts':[a.public() for a in pool.accounts],'models':list(pool.models()),
                'limits':{'request_bytes':MAX_REQUEST_BYTES,'input_budget':100000,'tools_per_request':128,
                          'account_concurrency':pool.accounts[0].capacity if pool.accounts else None,'attachments_per_message':20,'attachment_bytes':30*1024*1024,'pacing':pool.gate.public()},
                'totals':usage.totals,'days':usage.days,'requests':list(usage.requests)[-60:][::-1],
                'server_time':time.time(),'live_upstream_verified':True}
    @app.get('/admin/requests')
    async def request_log(limit:int=200,source:str='',status:str=''):
        items=[r for r in reversed(usage.requests) if (not source or r.get('source')==source) and (not status or r.get('status')==status)]
        return {'requests':items[:max(1,min(500,limit))],'total':len(usage.requests)}
    @app.delete('/admin/requests')
    async def clear_requests():
        usage.requests.clear();usage.save_soon();return {'cleared':True}
    @app.post('/admin/accounts/{id}/refresh')
    async def refresh_account(id:str):
        if not pool.get(id):raise APIError(404,'Account not found.','not_found')
        await pool.refresh([id]);return pool.get(id).public()
    @app.post('/admin/accounts')
    async def add_account(request:Request):
        v=await body(request)
        key=str(v.get('session_key',''))
        label=str(v.get('label',''))[:60]
        result=await pool.add(key,label)
        saved[result['id']]={'key':key,'label':label or result['label']}
        records.append(saved[result['id']])
        try:persist()
        except Exception:
            saved.pop(result['id'])
            records.pop()
            await pool.remove(result['id'])
            raise
        return result
    @app.delete('/admin/accounts/{id}')
    async def remove_account(id:str):
        await pool.remove(id)
        record=saved.pop(id,None)
        if record is not None:records.remove(record)
        persist()
        return {'deleted':True}
    @app.get('/admin/accounts/{id}/key')
    async def account_key(id:str):
        record=saved.get(id)
        if record is None:raise APIError(404,'Account not found.','not_found')
        return {'key':record['key']}
    @app.get('/admin/diagnostics')
    async def diagnostics(usage:int=0):
        result={'events':list(DIAGNOSTICS)}
        if usage:
            raw={}
            for a in pool.accounts:
                try:raw[a.id]=await a.client.usage()
                except APIError as exc:raw[a.id]={'error':str(exc),'status':exc.status}
            result['usage']=raw
        return result
    @app.post('/admin/refresh')
    async def refresh():await pool.refresh();return await status()

    @app.get('/login',response_class=HTMLResponse)
    async def login_page():
        page=(PAGE.replace('post(\'/','post(\'/login/')
              .replace("fetch('/state'","fetch('/login/state'")
              .replace('__LOCAL_TOKEN__',login_state.local_token)
              .replace('__SEND_SITEKEY__',SEND_SITEKEY)
              .replace('__VERIFY_SITEKEY__',VERIFY_SITEKEY))
        return page

    @app.get('/login/state')
    async def login_status():
        async with login_save_lock:
            with login_state.lock:
                generation=login_state.generation
                ready=login_state.stage=='done' and bool(login_state.key)
                already=getattr(login_state,'saved_generation',None)==generation
                saved_id=getattr(login_state,'saved_account_id',None)
                key=login_state.key
                label=login_state.email
            if ready and not already:
                try:
                    result=await pool.add(key,label)
                    saved[result['id']]={'key':key,'label':label}
                    records.append(saved[result['id']])
                    try:persist()
                    except Exception:
                        records.pop()
                        saved.pop(result['id'])
                        await pool.remove(result['id'])
                        raise
                    with login_state.lock:
                        login_state.saved_generation=generation
                        login_state.saved_account_id=result['id']
                except APIError as exc:
                    if exc.code=='duplicate_account':
                        with login_state.lock:login_state.saved_generation=generation
                    else:
                        with login_state.lock:login_state.renewal='Could not save account: '+str(exc)
                except Exception as exc:
                    with login_state.lock:login_state.renewal='Could not save account: '+str(exc)
            elif ready and already and saved_id in saved and saved[saved_id]['key']!=key:
                saved[saved_id]['key']=key
                persist()
        return login_state.snapshot()

    @app.post('/login/{action}')
    async def login_action(action:str,request:Request):
        if action not in ('start','stop','captcha','code','key') or request.headers.get('x-local-token')!=login_state.local_token:
            return JSONResponse({'error':'Forbidden'},status_code=403)
        try:
            data=await body(request)
            with login_state.lock:
                if action=='start':
                    email=str(data.get('email','')).strip()
                    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email) or len(email)>254:raise ValueError('Enter a valid email address')
                    if data.get('consent') is not True:raise ValueError('Confirm the age and terms checkbox')
                    if login_state.stage not in ('idle','error','done'):raise ValueError('A login is already in progress')
                    login_state.generation+=1;generation=login_state.generation
                    login_state.email=email;login_state.consent=True
                    login_state.key=None;login_state.key_version=0;login_state.expires_at=None
                    login_state.next_check_at=None;login_state.renewal=''
                    login_state.captcha_queue=__import__('queue').Queue()
                    login_state.code_queue=__import__('queue').Queue()
                    login_state.stage='starting';login_state.message='Checking login methods...'
                    threading.Thread(target=email_login,args=(login_state,generation),daemon=True).start()
                elif action=='stop':
                    if data.get('generation')!=login_state.generation:raise ValueError('This attempt has already changed')
                    old_captcha,old_code=login_state.captcha_queue,login_state.code_queue
                    login_state.generation+=1
                    login_state.stage='idle';login_state.message='Stopped. Enter an email to begin.'
                    login_state.key=None;login_state.email='';login_state.consent=False
                    old_captcha.put((None,None));old_code.put(None)
                elif action=='captcha':
                    stage,challenge=data.get('stage'),data.get('token')
                    if data.get('generation')!=login_state.generation or stage!=login_state.stage or stage not in ('send_captcha','verify_captcha') or not isinstance(challenge,str) or len(challenge)<100:raise ValueError('CAPTCHA token is not expected now')
                    login_state.captcha_queue.put((stage,challenge))
                elif action=='code':
                    code=data.get('code')
                    if data.get('generation')!=login_state.generation or login_state.stage!='code' or not isinstance(code,str) or not re.fullmatch(r'[0-9]{6}',code):raise ValueError('Enter the current six-digit code')
                    login_state.code_queue.put(code)
                elif action=='key':
                    if login_state.stage!='done' or not login_state.key:raise ValueError('No session key is available')
                    return {'key':login_state.key,'key_version':login_state.key_version,'generation':login_state.generation}
            return {'ok':True}
        except (ValueError,TypeError) as exc:
            return JSONResponse({'error':str(exc)},status_code=400)
    @app.head('/v1/hello')
    async def hello():return Response(status_code=200)

    @app.get('/v1/models')
    async def models():
        return {'data':[{'id':model,'type':'model','display_name':model,
                         'created_at':'2026-01-01T00:00:00Z'} for model in pool.models()],
                'has_more':False,'first_id':next(iter(pool.models()),None),
                'last_id':next(reversed(pool.models()),None) if pool.models() else None}

    @app.post('/v1/messages/count_tokens')
    async def count_tokens(request:Request):
        value=await body(request)
        messages=value.get('messages',[])
        if not isinstance(messages,list):raise APIError(400,'messages must be an array.','invalid_request_error')
        return {'input_tokens':max(1,count_text(render_messages_api(messages,
            value.get('system','') if isinstance(value.get('system'),str) else '')))}

    def client_source(request):
        explicit=request.headers.get('x-bridge-client','').lower()
        if explicit in ('playground','dashboard'):return 'playground'
        agent=request.headers.get('user-agent','').lower()
        if 'claude-cli' in agent or 'claude-code' in agent or request.headers.get('x-claude-code-session-id'):return 'claude-code'
        return 'api'

    def record(entry,turn=None):
        account=turn.account if turn else None
        if account:entry['account']=account.label;entry['account_id']=account.id
        usage.record(entry,account.key if account else None)

    @app.post('/v1/messages')
    async def messages(request:Request):
        started=time.time()
        value=await body(request)
        explicit_session=(request.headers.get('x-claude-code-session-id') or
                          request.headers.get('x-session-id'))
        session=(explicit_session or
                 digest([value.get('system',''),(value.get('messages') or [None])[0]]))
        entry={'id':'req_'+secrets.token_hex(6),'t':started,'model':str(value.get('model',''))[:80],'source':client_source(request),
               'session':hashlib.sha256(session.encode()).hexdigest()[:8],'stream':bool(value.get('stream')),
               'web_search_requested':any(isinstance(t,dict) and str(t.get('type','')).startswith('web_search') for t in (value.get('tools') or []))}
        preparing=asyncio.create_task(bridge.prepare(value,session,authoritative=bool(explicit_session)))

        def failed(exc):
            entry.update(status='error',http=exc.status,error=str(exc)[:300],duration_ms=int((time.time()-started)*1000),rate_limited=exc.status==429,
                         throttled=getattr(exc,'throttled',0))
            record(entry)

        def accepted(result):
            plan,turn,info=result
            entry.update(kind=info['kind'],linked=info['linked'],handoff=info['handoff'],attachments=info['attachments'])
            route='tool_result' if info['kind']=='tool_result' else 'handoff' if info['handoff'] else 'linked' if info['linked'] else 'new'
            entry.update(route=route,throttled=info.get('throttled',0))
            return route

        def finalize(turn,status,error=None,http=200):
            stats=turn.stats
            entry.update(status=status,http=http,error=error,duration_ms=int((time.time()-started)*1000),
                         ttft_ms=int((stats['first_token']-started)*1000) if stats.get('first_token') else None,
                         input_tokens=stats.get('input_tokens',0),output_tokens=stats.get('output_tokens',0),
                         tool_calls=stats.get('tool_calls',0),web_searches=stats.get('web_searches',0),
                         stop_reason=turn.last_stop if status=='ok' else None,rate_limited=http==429)
            record(entry,turn)

        async def abandon():
            """The client went away while its request was still queued: give up its place."""
            preparing.cancel()
            try:
                plan,turn,_=await preparing
            except BaseException:
                pass
            else:
                await bridge.abort(session,turn)
            entry.update(status='error',http=499,error='Client disconnected while queued',duration_ms=int((time.time()-started)*1000))
            record(entry)

        def bridge_note(route,turn):
            return ': bridge '+json.dumps({'account':turn.account.label,'route':route})+'\n\n'

        async def events(plan,turn,route):
            completed=False
            try:
                async for event in turn.segment():
                    yield anthropic_sse(event)
                completed=True
                finalize(turn,'ok')
            except APIError as exc:
                kind=exc.code if exc.code in ('rate_limit_error','overloaded_error','invalid_request_error') else ('rate_limit_error' if exc.status==429 else 'api_error')
                if exc.status==429:turn.account.penalize(exc)
                finalize(turn,'error',str(exc)[:300],exc.status)
                yield anthropic_sse({'type':'error','error':{'type':kind,'message':str(exc)}})
            except asyncio.CancelledError:
                finalize(turn,'error','Client disconnected',499)
                raise
            finally:
                if completed:await bridge.finish(session,plan,turn)
                else:await bridge.abort(session,turn)

        # Most requests are ready at once. A request queued behind other work or a Claude
        # throttle may wait minutes, so a streaming one starts its response right away and
        # sends SSE comments (ignored by every client) to keep proxies from closing it.
        done,_=await asyncio.wait({preparing},timeout=QUEUE_NOTE_SECONDS/5)
        if not done and bool(value.get('stream')):
            async def queued_stream():
                try:
                    while True:
                        done,_=await asyncio.wait({preparing},timeout=QUEUE_NOTE_SECONDS)
                        if done:break
                        yield ': queued '+json.dumps(pool.gate.public())+'\n\n'
                except asyncio.CancelledError:
                    await abandon()
                    raise
                try:
                    plan,turn,info=preparing.result()
                except APIError as exc:
                    failed(exc)
                    kind='rate_limit_error' if exc.status==429 else exc.code if exc.code in ('overloaded_error','invalid_request_error') else 'api_error'
                    yield anthropic_sse({'type':'error','error':{'type':kind,'message':str(exc)}})
                    return
                route=accepted((plan,turn,info))
                yield bridge_note(route,turn)
                async for chunk in events(plan,turn,route):
                    yield chunk
            return StreamingResponse(queued_stream(),media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})
        while not done:
            if await request.is_disconnected():
                await abandon()
                return JSONResponse({'type':'error','error':{'type':'api_error','message':'Client disconnected.'}},status_code=499)
            done,_=await asyncio.wait({preparing},timeout=1)
        try:plan,turn,info=preparing.result()
        except APIError as exc:
            failed(exc);raise
        route=accepted((plan,turn,info))
        headers={'x-bridge-account':turn.account.label.encode('ascii','ignore').decode()[:80],'x-bridge-route':route}

        if plan['stream']:
            async def stream():
                yield bridge_note(route,turn)
                async for chunk in events(plan,turn,route):
                    yield chunk
            return StreamingResponse(stream(),media_type='text/event-stream',
                                     headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no',**headers})
        try:
            async for _ in turn.segment():pass
            await bridge.finish(session,plan,turn)
        except APIError as exc:
            if exc.status==429:turn.account.penalize(exc)
            finalize(turn,'error',str(exc)[:300],exc.status)
            await bridge.abort(session,turn)
            raise
        except Exception:
            finalize(turn,'error','Bridge error',500)
            await bridge.abort(session,turn)
            raise
        finalize(turn,'ok')
        content=turn.last_content
        return JSONResponse({'id':turn.message_id,'type':'message','role':'assistant','model':plan['model'],
                'content':content,'stop_reason':turn.last_stop,'stop_sequence':None,
                'usage':{'input_tokens':turn.stats.get('input_tokens',1),'output_tokens':turn.stats.get('output_tokens',1)}},headers=headers)

    @app.api_route('/v1/{path:path}',methods=['GET','POST','DELETE','PATCH'])
    async def unavailable(path:str):
        raise APIError(404,'Only the Anthropic Messages API is available.','not_found_error')
    return app

if __name__=='__main__':
    import uvicorn
    import spaces
    from spaces import zero

    @spaces.GPU(duration=1)
    def _zerogpu_ready():
        return True

    startup=getattr(zero,'startup',None)
    if startup is not None:startup()
    uvicorn.run(create_app(),host='0.0.0.0',port=int(os.environ.get('PORT','7860')),
                access_log=False,ws_max_size=16*1024*1024)
