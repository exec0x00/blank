import asyncio
import gzip
import json
import secrets
import struct
import uuid
import io
import time
import httpx
from PIL import Image
import schema
from errors import APIError
from transport import StudioTransport
from token_budget import count_text

BASE = 'https://claude.ai'
RPC = '/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'
WEB_CLIENT_SHA = '66951a517391433c32196e4c12a37866b5dd8e46'
WEB_CLIENT_BUILD = '1792714324'
MAX_TIMELINE_STREAMS = 15

def message_uuid():
    # Claude web uses UUIDv7 for turn messages, while conversation and request IDs use UUIDv4.
    milliseconds=int(time.time()*1000) & ((1<<48)-1)
    value=(milliseconds<<80)|(7<<76)|(secrets.randbits(12)<<64)|(2<<62)|secrets.randbits(62)
    return str(uuid.UUID(int=value))

def stream_error(error):
    kind = error.type or 'upstream_error'
    status = 429 if error.HasField('rate_limit') or 'rate_limit' in kind else 401 if error.HasField('authentication') else 403 if error.HasField('permission') else 400 if error.HasField('invalid_request') else 502
    return APIError(status, error.display_message or error.message or kind, kind)

class Timeline:
    """Decode only the requested assistant message; never guess text from arbitrary bytes."""
    def __init__(self, assistant_id, model, allow_web_search=False):
        self.assistant_id, self.model = assistant_id, model
        self.messages, self.groups, self.blocks = {}, {}, {}
        self.emitted = ''
        self.allow_web_search = allow_web_search
        self.search_blocks = set()
        self.citations = set()

    def consume(self, event):
        out = []
        if event.HasField('error'): raise stream_error(event.error)
        if event.HasField('mutation_ack') and event.mutation_ack.HasField('error'):
            raise stream_error(event.mutation_ack.error.error)
        if event.HasField('model_fallback'):
            raise APIError(409, 'Claude attempted to change models. The response was stopped.', 'model_fallback_disabled')
        if event.HasField('message_limit'):
            out.append({'type':'limit', 'value':schema.as_dict(event.message_limit)})
        if event.HasField('update'):
            update = event.update
            for ack in update.mutation_acks:
                if ack.HasField('error'): raise stream_error(ack.error.error)
            if update.replace_all_state:
                self.messages.clear(); self.groups.clear(); self.blocks.clear()
            for m in update.messages: self.messages[m.id] = m
            for g in update.display_groups: self.groups[g.id] = g
            for b in update.content_blocks: self.blocks[b.id] = b
            for bid in update.deleted_content_block_ids: self.blocks.pop(bid, None)
            if update.HasField('conversation'):
                c = update.conversation
                if c.model.identifier and c.model.identifier != self.model:
                    raise APIError(409, 'Claude returned a different model.', 'model_fallback_disabled')
                if c.status == 5:
                    status = 429 if c.status_error_class in (1,12,13,20) else 502
                    retry = max(1, c.status_limit_resets_at.seconds - int(__import__('time').time())) if c.HasField('status_limit_resets_at') else None
                    raise APIError(status, c.status_detail or 'Claude stopped with an error.', 'upstream_generation_error', retry_after=retry)
        if event.HasField('append'):
            a = event.append
            if a.content_block_id in self.blocks:
                self.blocks[a.content_block_id].text += a.text_delta
            if a.HasField('citation_start'):
                c=a.citation_start
                key=(c.url,c.title,c.start_index,c.end_index)
                if c.url and key not in self.citations:
                    self.citations.add(key)
                    out.append({'type':'citation','url':c.url,'title':c.title,'start_index':c.start_index,'end_index':c.end_index})
        ordered = []
        for b in self.blocks.values():
            g = self.groups.get(b.display_group_id)
            if not g or g.message_id != self.assistant_id: continue
            for c in b.citations:
                key=(c.url,c.title,c.start_index,c.end_index)
                if c.url and key not in self.citations:
                    self.citations.add(key)
                    out.append({'type':'citation','url':c.url,'title':c.title,'start_index':c.start_index,'end_index':c.end_index})
            if b.row_kind or b.tool_use_id or b.tool_display_name or b.HasField('display_content'):
                if self.allow_web_search and (b.analytics_tool_name=='web_search' or b.tool_display_name.lower()=='web search'):
                    if b.id not in self.search_blocks:
                        self.search_blocks.add(b.id)
                        out.append({'type':'web_search','id':b.tool_use_id or b.id})
                    continue
                raise APIError(409, 'Claude attempted to use a tool while tools are disabled.', 'tools_disabled')
            # Only visible answer text in inline groups. Thinking summaries are not answer text.
            if g.style == 1 and not b.HasField('thinking_display'):
                ordered.append((g.index, b.index, b.text))
        text = ''.join(x[2] for x in sorted(ordered))
        if text and not text.startswith(self.emitted):
            raise APIError(502, 'Claude revised already streamed output; stream cannot be continued safely.', 'upstream_stream_rewrite')
        if len(text) > len(self.emitted):
            out.append({'type':'delta','text':text[len(self.emitted):]}); self.emitted = text
        m = self.messages.get(self.assistant_id)
        if m and m.is_complete:
            if m.stop_reason in (11,12): raise APIError(502, 'Claude generation did not complete successfully.', 'upstream_generation_error')
            out.append({'type':'done','reason':'length' if m.stop_reason in (2,8,9) else 'stop'})
        return out

class Claude:
    def __init__(self, key):
        key = key.strip()
        if key.startswith('sessionKey='): key = key.split('=',1)[1].split(';',1)[0]
        if not key.startswith('sk-ant-sid') or any(c in key for c in '\r\n;'):
            raise APIError(400, 'Enter a valid sessionKey value.', 'invalid_session_key')
        self.http = httpx.AsyncClient(base_url=BASE, headers={
            'Cookie':'sessionKey='+key, 'User-Agent':UA, 'Origin':BASE, 'Referer':BASE+'/new',
            'anthropic-client-platform':'web_claude_ai', 'Accept':'application/json','Accept-Language':'en-US,en;q=0.8',
        }, timeout=httpx.Timeout(180, connect=20), follow_redirects=False,transport=StudioTransport())
        self.org = ''; self.account_id = ''; self.mcp_keys = []; self.catalogue = {}
        self.device_id = str(uuid.uuid4()); self.activity_session_id = str(uuid.uuid4())
        self.legacy_only = False

    async def close(self): await self.http.aclose()

    async def check(self, response):
        if response.status_code < 400: return
        await response.aread()
        if response.headers.get('cf-mitigated') == 'challenge':
            raise APIError(403, 'Cloudflare requires a browser challenge for this session. A session key alone was not accepted.', 'cloudflare_challenge')
        code='upstream_http_error'
        try:
            value=response.json(); error=value.get('error', value)
            text=error.get('message') or error.get('type') if isinstance(error,dict) else str(error)
            details=(value.get('details') or error.get('details') or []) if isinstance(value,dict) and isinstance(error,dict) else []
            if any(isinstance(d,dict) and d.get('debug',{}).get('subReason')=='blocked_by_org_tier' for d in details):
                code='rpc_org_tier_unavailable'
        except Exception: text='Claude rejected the request.'
        retry=response.headers.get('retry-after')
        retry_after=int(retry) if retry and retry.isdigit() else None
        if response.status_code==429:
            # Usage-limit rejections carry a JSON description with the reset time.
            code='rate_limit_error'
            try:
                detail=json.loads(text) if isinstance(text,str) and text.lstrip().startswith('{') else {}
            except ValueError:
                detail={}
            resets=detail.get('resetsAt') if isinstance(detail,dict) else None
            if isinstance(resets,(int,float)) and resets>time.time():
                retry_after=int(resets-time.time())+1
                text='Claude usage limit reached for this account. It resets at '+time.strftime('%H:%M UTC',time.gmtime(resets))+'.'
        raise APIError(response.status_code, (text or 'Claude rejected the request.')[:400], code, retry_after=retry_after)

    async def request(self, method, path, **kwargs):
        try:
            r=await self.http.request(method,path,**kwargs);await self.check(r)
            return r.json() if r.content else {}
        except httpx.HTTPError:
            raise APIError(502,'Could not reach Claude.','upstream_network_error') from None

    async def connect(self):
        account=await self.request('GET','/api/account')
        self.account_id=account.get('uuid','')
        self.mcp_keys=list((account.get('settings',{}).get('enabled_mcp_tools') or {}).keys())
        orgs=await self.request('GET','/api/organizations')
        if not orgs: raise APIError(403,'No organization is available.','no_organization')
        self.org=orgs[0]['uuid']
        data=await self.request('GET',f'/api/organizations/{self.org}/model_selector/chat')
        def visit(v):
            if isinstance(v,dict):
                mid=v.get('id')
                if isinstance(mid,str) and mid.startswith('claude-') and not v.get('disabled') and not v.get('disabled_reason'):
                    self.catalogue[mid]=v
                for child in v.values(): visit(child)
            elif isinstance(v,list):
                for child in v: visit(child)
        for config in data.get('model_selector_config',[]):
            if config.get('id')=='chat':visit(config.get('models',[]))
        if not self.catalogue: raise APIError(502,'Claude returned no explicit selectable models.','model_catalogue_unavailable')
        return self

    async def usage(self):
        return await self.request('GET',f'/api/organizations/{self.org}/usage')

    def headers(self, conversation, streaming=False):
        return {'Content-Type':'application/connect+proto' if streaming else 'application/proto',
                'connect-protocol-version':'1','x-organization-uuid':self.org,
                'anthropic-chat-conversation-uuid':conversation,'Accept':'*/*',
                'connect-accept-encoding':'gzip'}

    def action(self, conversation):
        r=schema.message('PerformActionRequest')
        r.header.conversation_id=conversation
        r.header.mutation_id.session_id='sess_'+secrets.token_hex(8)
        r.header.mutation_id.version=1
        r.header.source=3; r.header.display_language='en-US'
        r.header.origin_nonce=secrets.token_bytes(32)
        return r

    async def perform(self, conversation, request):
        try:
            r=await self.http.post(RPC+'PerformAction',content=request.SerializeToString(),headers=self.headers(conversation))
            await self.check(r)
            result=schema.parse('PerformActionResponse',r.content)
            if result.HasField('ack') and result.ack.HasField('error'):raise stream_error(result.ack.error.error)
            if result.HasField('device_signature_ask'):
                raise APIError(403,'Claude requires device verification.','device_verification_required')
            return result
        except httpx.HTTPError:
            raise APIError(502,'Claude action delivery is uncertain; it will not be automatically resent.','upstream_delivery_uncertain') from None

    async def stop(self, conversation, assistant):
        req=self.action(conversation);req.stop_generation.stopping_message_id=assistant
        try: await self.perform(conversation,req)
        except Exception: pass

    async def convert(self, file):
        value=await self.request('POST',f'/api/organizations/{self.org}/convert_document',files={'file':(file['filename'],file['data'],file['mime'])})
        text=value.get('extracted_content') or value.get('content')
        if not isinstance(text,str):raise APIError(422,'Claude could not extract text from this document.','document_conversion_failed')
        return {'file_name':file['filename'],'file_size':len(file['data']),'file_type':file['mime'],'extracted_content':text}

    async def generate(self, model, prompt, files, effort, max_input, max_output, web_search=False, upstream_state=None):
        if (self.legacy_only and not upstream_state) or (upstream_state and upstream_state.get('transport')=='legacy'):
            async for event in self._generate_legacy(model,prompt,files,effort,max_input,max_output,web_search,upstream_state):
                yield event
            return
        try:
            async for event in self._generate_rpc(model,prompt,files,effort,max_input,max_output,web_search,upstream_state):
                yield event
        except APIError as exc:
            if exc.code!='rpc_org_tier_unavailable' or upstream_state:
                raise
            self.legacy_only=True
            async for event in self._generate_legacy(model,prompt,files,effort,max_input,max_output,web_search,None):
                yield event

    async def _generate_legacy(self, model, prompt, files, effort, max_input, max_output, web_search, upstream_state):
        if web_search:
            raise APIError(501,'Web search is not supported for this account’s browser completion route.','web_search_unavailable')
        for file in files:
            if file['mime'].startswith('image/'):
                raise APIError(501,'Images are not supported for this account’s browser completion route.','image_unavailable')
            if file['mime'].startswith('text/') or file['mime'] in ('application/json','application/xml'):
                try: extracted=file['data'].decode('utf8')
                except UnicodeDecodeError:raise APIError(400,'Text attachments must use UTF-8.','invalid_file_encoding') from None
            else:
                converted=await self.convert(file);extracted=converted['extracted_content']
            prompt+='\nAttached file '+json.dumps(file['filename'])+':\n'+extracted
        if count_text(prompt)+1024+max_output>max_input:
            raise APIError(400,'Input plus reserved output exceeds the safe context budget.','context_length_exceeded')
        conversation=upstream_state['conversation_id'] if upstream_state else str(uuid.uuid4())
        human_id=message_uuid();assistant_id=message_uuid()
        body={'prompt':prompt,'timezone':'UTC','locale':'en-US','model':model,'effort':effort,
              'thinking_mode':'auto','tools':[],'attachments':[],'files':[],'sync_sources':[],
              'turn_message_uuids':{'human_message_uuid':human_id,'assistant_message_uuid':assistant_id},
              'completion_request_id':str(uuid.uuid4()),'rendering_mode':'messages'}
        if upstream_state:body['parent_message_uuid']=upstream_state['parent_message_id']
        else:body['create_conversation_params']={'name':'','model':model,'include_conversation_preferences':False,
                                                 'paprika_mode':'auto','compass_mode':None,'tool_search_mode':'auto',
                                                 'is_temporary':True,'enabled_imagine':False}
        headers={'Accept':'text/event-stream','Content-Type':'application/json',
                 'anthropic-client-sha':WEB_CLIENT_SHA,'anthropic-client-build':WEB_CLIENT_BUILD,
                 'anthropic-client-version':'1.0.0',
                 'anthropic-client-capabilities':'mfa_sms_v1, mfa_email_v1, plugin_reach_v2',
                 'anthropic-device-id':self.device_id,'x-activity-session-id':self.activity_session_id,
                 'Referer':BASE+'/chat/'+conversation}
        assistant=None;reason='stop';finished=False;event_name='';data_lines=[]
        try:
            async with asyncio.timeout(180):
                async with self.http.stream('POST',f'/api/organizations/{self.org}/chat_conversations/{conversation}/completion',json=body,headers=headers) as response:
                    await self.check(response)
                    yield {'type':'started'}
                    async for line in response.aiter_lines():
                        if line.startswith('event:'):
                            event_name=line[6:].strip()
                        elif line.startswith('data:'):
                            data_lines.append(line[5:].lstrip())
                        elif not line and data_lines:
                            payload=json.loads('\n'.join(data_lines));data_lines=[]
                            kind=event_name or payload.get('type','');event_name=''
                            if kind=='error':
                                error=payload.get('error',payload)
                                raise APIError(502,error.get('message','Claude completion failed.'),'upstream_stream_error')
                            if kind=='message_start':
                                assistant=payload.get('message',{}).get('uuid') or payload.get('message',{}).get('id')
                            elif kind=='content_block_delta':
                                delta=payload.get('delta',{})
                                if delta.get('type')=='text_delta' and delta.get('text'):
                                    yield {'type':'delta','text':delta['text']}
                            elif kind=='message_delta':
                                reason='length' if payload.get('delta',{}).get('stop_reason')=='max_tokens' else 'stop'
                            elif kind=='message_limit':
                                limit=payload.get('message_limit',{})
                                if limit:yield {'type':'limit','value':limit}
                            elif kind=='message_stop':
                                if not assistant:raise APIError(502,'Claude did not provide an assistant message ID.','upstream_protocol_error')
                                finished=True
                                yield {'type':'done','reason':reason,'upstream_state':{'conversation_id':conversation,'parent_message_id':assistant,'transport':'legacy'}}
                                return
            if not finished:raise APIError(502,'Claude stream ended before completion.','upstream_stream_incomplete')
        except (TimeoutError,httpx.TimeoutException):raise APIError(504,'Claude response timed out.','upstream_timeout') from None
        except httpx.HTTPError:raise APIError(502,'Claude streaming connection failed.','upstream_network_error') from None

    async def _generate_rpc(self, model, prompt, files, effort, max_input, max_output, web_search=False, upstream_state=None):
        conversation=upstream_state['conversation_id'] if upstream_state else str(uuid.uuid4())
        assistant=str(uuid.uuid4())
        req=self.action(conversation);sm=req.send_message
        sm.message_id=str(uuid.uuid4());sm.assistant_message_id=assistant
        if upstream_state:sm.parent_message_id=upstream_state['parent_message_id']
        sm.text=prompt;sm.model.identifier=model;sm.is_temporary=True
        sm.timezone='UTC';sm.locale='en-US';sm.client_platform=1;sm.chat_memory_mode=2
        settings=sm.settings_update.settings
        for name in ('enabled_drive_search','enabled_gmail_search','enabled_calendar_search','enabled_computer_tools','enabled_imagine'):
            setattr(settings,name,False)
        settings.enabled_web_search=web_search
        settings.tool_search_mode=1 if web_search else 3;settings.research_mode=0
        settings.effort_level_token=effort
        settings.enabled_mcp_tools.SetInParent()
        for name in self.mcp_keys:settings.enabled_mcp_tools.tools[name]=False
        budget=count_text(prompt)+1024+max_output
        for file in files:
            # Native document conversion creates inline text; it does not enable code tools.
            if file['mime'].startswith('text/') or file['mime'] in ('application/json','application/xml'):
                try:text=file['data'].decode('utf8')
                except UnicodeDecodeError:raise APIError(400,'Text attachments must use UTF-8.','invalid_file_encoding')
                inline={'file_name':file['filename'],'file_size':len(file['data']),'file_type':file['mime'],'extracted_content':text}
            elif file['mime'].startswith('image/'):
                try:
                    with Image.open(io.BytesIO(file['data'])) as image:
                        if image.width>1024 or image.height>1024 or getattr(image,'n_frames',1)>1:
                            raise APIError(400,'Images must be static and at most 1024 x 1024 pixels.','image_too_large')
                        if image.format not in ('PNG','JPEG','WEBP','GIF'):
                            raise APIError(400,'Use a PNG, JPEG, WebP, or static GIF image.','unsupported_image')
                        image.verify()
                except APIError:raise
                except Exception:raise APIError(400,'Invalid image attachment.','invalid_image') from None
                budget+=32768 # Conservative reservation, not a claimed exact image token count.
                if budget>max_input:raise APIError(400,'Image reservation exceeds the context budget.','context_length_exceeded')
                uploaded=await self.request('POST',f'/api/{self.org}/upload',files={'file':(file['filename'],file['data'],file['mime'])})
                if not uploaded.get('file_uuid'):raise APIError(502,'Claude did not return an uploaded file ID.','upload_failed')
                attachment=sm.attachments.add(id=uploaded['file_uuid'],file_name=file['filename'],file_size=len(file['data']),media_type=file['mime'],file_kind=1)
                if uploaded.get('document_id'):attachment.document_id=uploaded['document_id']
                continue
            else:inline=await self.convert(file)
            budget+=count_text(inline['extracted_content'])+256
            if budget>max_input:raise APIError(400,'Input plus reserved output exceeds the safe context budget.','context_length_exceeded')
            sm.inline_attachments.add(**inline)
        if budget>max_input:raise APIError(400,'Input plus reserved output exceeds the safe context budget.','context_length_exceeded')
        sent=False;finished=False
        try:
            await self.perform(conversation,req);sent=True
            yield {'type':'started'}
            state=Timeline(assistant,model,allow_web_search=web_search)
            version=None
            async with asyncio.timeout(180):
                for attempt in range(MAX_TIMELINE_STREAMS):
                    request=schema.message('StreamTimelineRequest',conversation_id=conversation,outcome_acks=True,display_language='en-US',timezone='UTC')
                    if version:request.version.value=version
                    payload=request.SerializeToString()
                    body=b'\0'+struct.pack('>I',len(payload))+payload
                    buf=b''
                    async with self.http.stream('POST',RPC+'StreamTimeline',content=body,headers=self.headers(conversation,True)) as response:
                        await self.check(response)
                        async for chunk in response.aiter_bytes():
                            buf+=chunk
                            while len(buf)>=5:
                                flags,length=buf[0],struct.unpack('>I',buf[1:5])[0]
                                if length>16_000_000:raise APIError(502,'Upstream frame exceeded the safety limit.','upstream_protocol_error')
                                if len(buf)<length+5:break
                                raw,buf=buf[5:5+length],buf[5+length:]
                                if flags&1:raw=gzip.decompress(raw)
                                if flags&2:
                                    end=json.loads(raw)
                                    if end.get('error'):raise APIError(502,end['error'].get('message','Claude stream failed.'),'upstream_stream_error')
                                    break
                                reply=schema.parse('StreamTimelineResponse',raw).event
                                if reply.HasField('version') and reply.version.value:version=reply.version.value
                                for event in state.consume(reply):
                                    if event['type']=='done':
                                        finished=True
                                        event['upstream_state']={'conversation_id':conversation,'parent_message_id':assistant}
                                    yield event
                                    if finished:return
                    if buf:raise APIError(502,'Claude returned a truncated stream frame.','upstream_protocol_error')
                    if attempt<MAX_TIMELINE_STREAMS-1:await asyncio.sleep(min(5,0.5*2**attempt))
            raise APIError(502,'Claude stream ended before completion.','upstream_stream_incomplete')
        except (TimeoutError,httpx.TimeoutException):raise APIError(504,'Claude response timed out.','upstream_timeout') from None
        except httpx.HTTPError:raise APIError(502,'Claude streaming connection failed.','upstream_network_error') from None
        finally:
            if sent and not finished:await self.stop(conversation,assistant)
