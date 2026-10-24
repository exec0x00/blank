"""Anthropic Messages facade over the Claude website's browser completion route.

The website route is stateful.  A client tool result is posted to its side
channel while the original completion stream is still open.  BrowserTurn keeps
that stream alive between two stateless Messages requests.
"""

import asyncio
import base64
import collections
import copy
import hashlib
import io
import json
import re
import time
import uuid

from PIL import Image

from errors import APIError
from pool import transient
from token_budget import count_text, fit_delta
from rpc import RpcSession, as_dict as rpc_dict
from upstream import BASE, WEB_CLIENT_BUILD, WEB_CLIENT_SHA, message_uuid

# Recent raw upstream stream events, for the admin diagnostics view.
DIAGNOSTICS = collections.deque(maxlen=400)
MAX_ATTACHMENTS = 20
MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024
MAX_IMAGE_EDGE = 2000
PENDING_TOOL_SECONDS = 600
# How long one request waits out Claude burst throttles before failing.
THROTTLE_GIVE_UP = 300


def fail(status, message, code='invalid_request_error'):
    raise APIError(status, message, code)


def canonical(value):
    if isinstance(value, list):
        return [canonical(item) for item in value]
    if isinstance(value, dict):
        return {key: canonical(item) for key, item in value.items()
                if key not in ('cache_control', 'signature', 'citations')}
    return value


def digest(value):
    raw = json.dumps(canonical(value), ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(raw.encode()).hexdigest()


def text_of(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if not isinstance(item, dict):
                continue
            if item.get('type') == 'text':
                parts.append(item.get('text', ''))
            elif item.get('type') == 'image':
                parts.append('[image]')
            elif item.get('type') == 'document':
                parts.append('[document: ' + str(item.get('title') or 'attachment') + ']')
        return '\n'.join(parts)
    return ''


def parse(body, models):
    if not isinstance(body, dict):
        fail(400, 'Request body must be an object.')
    model = body.get('model')
    if not isinstance(model, str) or model not in models:
        fail(404, 'Requested Claude model is unavailable.', 'not_found_error')
    messages = body.get('messages')
    if not isinstance(messages, list) or not messages:
        fail(400, 'messages must be a nonempty array.')
    for item in messages:
        if not isinstance(item, dict) or item.get('role') not in ('user', 'assistant', 'system'):
            fail(400, 'Each message needs a supported role and content.')
        if not isinstance(item.get('content'), (str, list)):
            fail(400, 'Message content must be text or content blocks.')
    max_tokens = body.get('max_tokens')
    if isinstance(max_tokens, bool) or not isinstance(max_tokens, int) or max_tokens < 1:
        fail(400, 'max_tokens must be a positive integer.')
    tools = body.get('tools') or []
    if not isinstance(tools, list) or len(tools) > 128:
        fail(400, 'tools must be an array of at most 128 definitions.')
    client = []
    web_search = False
    for tool in tools:
        if not isinstance(tool, dict):
            fail(400, 'Invalid tool definition.')
        kind = tool.get('type') or 'custom'
        if kind.startswith('web_search_') or (kind == 'custom' and tool.get('name') == 'web_search' and not tool.get('input_schema')):
            web_search = True
            continue
        name = tool.get('name')
        schema = tool.get('input_schema')
        if kind != 'custom' or not isinstance(name, str) or not name or not isinstance(schema, dict):
            fail(400, 'Unsupported tool definition: ' + str(name or kind))
        client.append({'name': name, 'description': str(tool.get('description', ''))[:8000], 'input_schema': schema})
    choice = body.get('tool_choice') or {'type': 'auto'}
    if not isinstance(choice, dict) or choice.get('type', 'auto') not in ('auto', 'none', 'any', 'tool'):
        fail(400, 'Unsupported tool_choice.')
    system = text_of(body.get('system', ''))
    if choice.get('type') == 'none':
        client = []
        web_search = False
    elif choice.get('type') == 'any' and client:
        # The website route cannot force a tool; ask for one instead.
        system = (system + '\n\n' if system else '') + 'You must respond by calling one of the available tools.'
    elif choice.get('type') == 'tool':
        name = choice.get('name')
        if not any(t['name'] == name for t in client):
            fail(400, 'tool_choice names a tool that is not defined.')
        system = (system + '\n\n' if system else '') + f'You must respond by calling the {name} tool.'
    config = body.get('output_config') if isinstance(body.get('output_config'), dict) else {}
    thinking = body.get('thinking') if isinstance(body.get('thinking'), dict) else {}
    thinking_on = thinking.get('type') in ('enabled', 'adaptive')
    effort = config.get('effort')
    effort = {'xhigh': 'max'}.get(effort, effort)
    if effort not in ('low', 'medium', 'high', 'max'):
        effort = 'high' if thinking_on else 'medium'
    return {'model': model, 'messages': messages, 'system': system, 'tools': client, 'web_search': web_search,
            'effort': effort, 'max_tokens': max_tokens, 'stream': body.get('stream', False), 'thinking': thinking_on}


def decode_attachment(block):
    """Turn an Anthropic image or document block into an upload description, or None for references."""
    source = block.get('source') if isinstance(block.get('source'), dict) else {}
    title = str(block.get('title') or '')
    if block.get('type') == 'image':
        if source.get('type') != 'base64':
            return None
        try:
            data = base64.b64decode(source.get('data', ''), validate=True)
        except (ValueError, TypeError):
            fail(400, 'An image attachment is not valid base64.')
        mime = source.get('media_type') or 'image/png'
        return {'kind': 'image', 'filename': title or 'image.' + mime.split('/')[-1], 'mime': mime, 'data': data}
    if source.get('type') == 'text':
        data = str(source.get('data', '')).encode()
        return {'kind': 'text', 'filename': title or 'document.txt', 'mime': 'text/plain', 'data': data}
    if source.get('type') == 'content':
        data = text_of(source.get('content', [])).encode()
        return {'kind': 'text', 'filename': title or 'document.txt', 'mime': 'text/plain', 'data': data}
    if source.get('type') == 'base64':
        try:
            data = base64.b64decode(source.get('data', ''), validate=True)
        except (ValueError, TypeError):
            fail(400, 'A document attachment is not valid base64.')
        mime = source.get('media_type') or 'application/pdf'
        return {'kind': 'document', 'filename': title or ('document.pdf' if mime == 'application/pdf' else 'document'), 'mime': mime, 'data': data}
    return None


def render(messages, system, files=None):
    """Render Messages history as the website prompt; collect attachments into ``files`` when given."""
    parts = []
    if system:
        parts.append('System instructions:\n' + system)
    for item in messages:
        content = item['content']
        out = []
        if isinstance(content, str):
            out.append(content)
        else:
            for block in content:
                if not isinstance(block, dict):
                    continue
                kind = block.get('type')
                if kind == 'text':
                    out.append(block.get('text', ''))
                elif kind == 'tool_use':
                    out.append('Assistant called ' + str(block.get('name')) + ' with ' + json.dumps(block.get('input', {}), ensure_ascii=False))
                elif kind == 'tool_result':
                    value = block.get('content', '')
                    text = text_of(value)
                    if isinstance(value, list) and files is not None:
                        # Images a tool returned (for example Claude Code reading a screenshot) become real attachments.
                        notes = []
                        for part in value:
                            attachment = decode_attachment(part) if isinstance(part, dict) and part.get('type') in ('image', 'document') else None
                            if attachment:
                                files.append(attachment)
                                notes.append(f"[Attached {attachment['kind']}: {attachment['filename']}]")
                        if notes:
                            text = '\n'.join([t for t in [text_of([i for i in value if isinstance(i, dict) and i.get('type') == 'text'])] if t] + notes)
                    out.append('Tool ' + str(block.get('tool_use_id')) + ' returned: ' + text)
                elif kind == 'server_tool_use':
                    query = (block.get('input') or {}).get('query', '')
                    out.append('Assistant searched the web for: ' + str(query))
                elif kind == 'web_search_tool_result':
                    results = block.get('content') if isinstance(block.get('content'), list) else []
                    lines = [f"- {r.get('title', '')} ({r.get('url', '')})" for r in results[:10] if isinstance(r, dict)]
                    out.append('Web search results:\n' + '\n'.join(lines) if lines else 'Web search returned no results.')
                elif kind in ('image', 'document'):
                    attachment = decode_attachment(block)
                    if attachment and files is not None:
                        files.append(attachment)
                        out.append(f"[Attached {attachment['kind']}: {attachment['filename']}]")
                    elif kind == 'image':
                        url = (block.get('source') or {}).get('url')
                        out.append('[Image' + (': ' + url if url else '') + ']')
                    else:
                        out.append('[Document: ' + str(block.get('title') or 'attachment') + ']')
                elif kind in ('thinking', 'redacted_thinking'):
                    continue
                else:
                    out.append('[' + str(kind) + ' content omitted]')
        parts.append(item['role'].capitalize() + ': ' + '\n'.join(out))
    if files is not None and len(files) > MAX_ATTACHMENTS:
        # Keep the most recent attachments; older ones stay mentioned by name only.
        del files[:len(files) - MAX_ATTACHMENTS]
    while files is not None and len(files) > 1 and sum(len(f['data']) for f in files) > MAX_ATTACHMENT_BYTES:
        files.pop(0)
    return '\n\n'.join(parts)


def prepare_image(file):
    """Normalise an image to a static PNG or JPEG the website accepts, downscaling large ones."""
    try:
        with Image.open(io.BytesIO(file['data'])) as image:
            image.load()
            fmt = image.format
            if fmt in ('PNG', 'JPEG', 'WEBP', 'GIF') and max(image.size) <= MAX_IMAGE_EDGE and not getattr(image, 'is_animated', False):
                return file
            image.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE))
            out = io.BytesIO()
            if image.mode in ('RGBA', 'LA', 'P'):
                image.convert('RGBA').save(out, 'PNG')
                mime, ext = 'image/png', 'png'
            else:
                image.convert('RGB').save(out, 'JPEG', quality=90)
                mime, ext = 'image/jpeg', 'jpg'
            name = file['filename'].rsplit('.', 1)[0] + '.' + ext
            return {**file, 'data': out.getvalue(), 'mime': mime, 'filename': name}
    except Exception:
        fail(400, 'An image attachment could not be read. Use PNG, JPEG, WebP, or GIF.')


class BrowserTurn:
    def __init__(self, bridge, account, plan, conversation=None, parent=None):
        self.bridge = bridge
        self.account = account
        self.plan = plan
        self.conversation = conversation or str(uuid.uuid4())
        self.parent = parent
        self.assistant_id = message_uuid()
        self.message_id = 'msg_' + uuid.uuid4().hex
        self.stream_context = None
        self.response = None
        self.lines = None
        self.event_name = ''
        self.data_lines = []
        self.pending = set()
        self.done = False
        self.closed = False
        self.last_content = []
        self.last_stop = 'end_turn'
        self.expire_task = None
        self.stats = {}
        self.reset_stats()

    def reset_stats(self):
        self.stats = {'tool_calls': 0, 'web_searches': 0, 'first_token': None, 'output_tokens': 0, 'input_tokens': 0}

    async def upload(self, files):
        """Upload images and convert documents so the website sees them as real attachments."""
        client = self.account.client
        uploaded, inline = [], []
        if len(files) > MAX_ATTACHMENTS:
            fail(400, f'Attach at most {MAX_ATTACHMENTS} files per message.')
        if sum(len(f['data']) for f in files) > MAX_ATTACHMENT_BYTES:
            fail(413, 'Attachments exceed 30 MiB in one message.')
        for file in files:
            if file['kind'] == 'image':
                file = prepare_image(file)
                value = await client.request('POST', f'/api/{client.org}/upload', files={'file': (file['filename'], file['data'], file['mime'])})
                if not value.get('file_uuid'):
                    fail(502, 'Claude did not accept the image upload.', 'api_error')
                uploaded.append(value['file_uuid'])
            elif file['kind'] == 'text' or file['mime'].startswith('text/') or file['mime'] in ('application/json', 'application/xml'):
                try:
                    text = file['data'].decode('utf8')
                except UnicodeDecodeError:
                    fail(400, 'Text attachments must use UTF-8.')
                inline.append({'file_name': file['filename'], 'file_type': 'text/plain', 'file_size': len(file['data']), 'extracted_content': text})
            else:
                inline.append(await client.convert(file))
        return uploaded, inline

    async def open(self, prompt, files=()):
        client = self.account.client
        uploaded, inline = await self.upload(list(files)) if files else ([], [])
        body = {'prompt': prompt, 'timezone': 'UTC', 'locale': 'en-US', 'model': self.plan['model'],
                'effort': self.plan['effort'], 'thinking_mode': 'auto',
                'tools': self.plan['tools'] + ([{'type': 'web_search_v0', 'name': 'web_search'}] if self.plan['web_search'] else []),
                'attachments': inline, 'files': uploaded, 'sync_sources': [],
                'turn_message_uuids': {'human_message_uuid': message_uuid(), 'assistant_message_uuid': self.assistant_id},
                'completion_request_id': str(uuid.uuid4()), 'rendering_mode': 'messages'}
        if self.parent:
            body['parent_message_uuid'] = self.parent
        else:
            body['create_conversation_params'] = {'name': '', 'model': self.plan['model'],
                'include_conversation_preferences': False, 'paprika_mode': 'auto', 'compass_mode': None,
                'tool_search_mode': 'auto', 'is_temporary': True, 'enabled_imagine': False,
                'enabled_web_search': self.plan['web_search']}
        headers = {'Accept': 'text/event-stream', 'Content-Type': 'application/json',
                   'anthropic-client-sha': WEB_CLIENT_SHA, 'anthropic-client-build': WEB_CLIENT_BUILD,
                   'anthropic-client-version': '1.0.0',
                   'anthropic-client-capabilities': 'mfa_sms_v1, mfa_email_v1, plugin_reach_v2',
                   'anthropic-device-id': client.device_id, 'x-activity-session-id': client.activity_session_id,
                   'Referer': BASE + '/chat/' + self.conversation}
        path = f'/api/organizations/{client.org}/chat_conversations/{self.conversation}/completion'
        self.stream_context = client.http.stream('POST', path, json=body, headers=headers)
        try:
            self.response = await self.stream_context.__aenter__()
            if self.response.status_code >= 400:
                await self.response.aread()
                DIAGNOSTICS.append({'t': time.time(), 'account': self.account.id, 'kind': 'open_error',
                                    'payload': json.dumps({'status': self.response.status_code,
                                                           'headers': {k: v for k, v in self.response.headers.items() if k.lower() not in ('set-cookie',)},
                                                           'body': self.response.text[:1500]})})
            await client.check(self.response)
            self.lines = self.response.aiter_lines()
        except Exception:
            await self.close()
            raise

    async def next_raw(self):
        while True:
            try:
                line = await asyncio.wait_for(self.lines.__anext__(), timeout=240)
            except StopAsyncIteration:
                fail(502, 'Claude closed its completion stream early.', 'api_error')
            except asyncio.TimeoutError:
                fail(504, 'Claude completion timed out.', 'timeout_error')
            if line.startswith('event:'):
                self.event_name = line[6:].strip()
            elif line.startswith('data:'):
                self.data_lines.append(line[5:].lstrip())
            elif not line and self.data_lines:
                try:
                    payload = json.loads('\n'.join(self.data_lines))
                except ValueError:
                    fail(502, 'Claude sent invalid stream JSON.', 'api_error')
                kind = self.event_name or payload.get('type', '')
                self.event_name = ''
                self.data_lines = []
                DIAGNOSTICS.append({'t': time.time(), 'account': self.account.id, 'kind': kind,
                                    'payload': json.dumps(payload, ensure_ascii=False)[:2000]})
                return kind, payload

    async def submit(self, results):
        if not self.pending:
            fail(409, 'No client tool result is pending.', 'invalid_request_error')
        expected = set(self.pending)
        got = {x.get('tool_use_id') for x in results}
        if expected != got:
            fail(400, 'Supply one result for each pending tool use.')
        client = self.account.client
        path = f'/api/organizations/{client.org}/chat_conversations/{self.conversation}/tool_result'
        for result in results:
            content = result.get('content', '')
            if isinstance(content, list):
                content = text_of(content)
            if not isinstance(content, str):
                fail(400, 'tool_result content must be text or content blocks.')
            content, truncated = fit_delta('', content, 12000)
            if truncated:
                content += '\n[Tool output truncated to fit the Claude account route. Narrow the command or read a smaller range.]'
            await client.request('POST', path, json={'type': 'tool_result', 'tool_use_id': result['tool_use_id'],
                                                     'is_error': result.get('is_error', False), 'content': [{'type': 'text', 'text': content}]})
        self.pending.clear()

    async def segment(self):
        if self.done:
            fail(409, 'Claude turn has already completed.')
        self.reset_stats()
        self.message_id = 'msg_' + uuid.uuid4().hex
        content = []
        blocks = {}
        next_index = 0
        tool_ids = []
        stop = 'end_turn'
        client_tools = {x['name'] for x in self.plan['tools']}
        input_tokens = max(1, count_text(render(self.plan['messages'], self.plan['system'])))
        self.stats['input_tokens'] = input_tokens
        yield {'type': 'message_start', 'message': {'id': self.message_id, 'type': 'message', 'role': 'assistant',
               'content': [], 'model': self.plan['model'], 'stop_reason': None, 'stop_sequence': None,
               'usage': {'input_tokens': input_tokens, 'output_tokens': 0}}}

        def start(item, native_index, extra=None):
            nonlocal next_index
            index = next_index
            next_index += 1
            blocks[native_index] = {'index': index, 'item': item, 'json': '', 'citations': {}, 'cite_from': 0, **(extra or {})}
            content.append(item)
            return {'type': 'content_block_start', 'index': index, 'content_block': copy.deepcopy(item)}

        while True:
            kind, payload = await self.next_raw()
            if kind == 'error':
                error = payload.get('error', payload)
                message = error.get('message', 'Claude completion failed.') if isinstance(error, dict) else str(error)
                if isinstance(error, dict) and 'rate_limit' in str(error.get('type', '')):
                    raise APIError(429, message, 'rate_limit_error')
                fail(502, message, 'api_error')
            if kind == 'message_start':
                native = payload.get('message', {})
                self.assistant_id = native.get('uuid') or native.get('id') or self.assistant_id
            elif kind == 'message_limit':
                if isinstance(payload, dict):
                    self.account.update(payload, stream=True)
            elif kind == 'content_block_start':
                block = payload.get('content_block', {})
                native_index = payload.get('index')
                btype = block.get('type')
                if btype == 'tool_use' and block.get('name') in client_tools:
                    yield start({'type': 'tool_use', 'id': block.get('id') or 'toolu_' + uuid.uuid4().hex, 'name': block['name'], 'input': {}},
                                native_index, {'initial_input': block.get('input', {})})
                elif btype == 'tool_use' and block.get('name') == 'web_search' and self.plan['web_search']:
                    self.stats['web_searches'] += 1
                    yield start({'type': 'server_tool_use', 'id': block.get('id') or 'srvtoolu_' + uuid.uuid4().hex, 'name': 'web_search', 'input': {}},
                                native_index, {'initial_input': block.get('input', {})})
                elif btype == 'tool_result' and block.get('name') == 'web_search' and self.plan['web_search']:
                    results = [{'type': 'web_search_result', 'url': r.get('url', ''), 'title': r.get('title', ''),
                                'encrypted_content': '', 'page_age': None}
                               for r in (block.get('content') or []) if isinstance(r, dict) and r.get('url')]
                    yield start({'type': 'web_search_tool_result', 'tool_use_id': block.get('tool_use_id', ''), 'content': results}, native_index)
                elif btype == 'text':
                    yield start({'type': 'text', 'text': ''}, native_index)
                elif btype == 'thinking' and self.plan['thinking']:
                    yield start({'type': 'thinking', 'thinking': '', 'signature': ''}, native_index)
            elif kind == 'content_block_delta':
                block = blocks.get(payload.get('index'))
                if not block:
                    continue
                delta = payload.get('delta', {})
                item = block['item']
                dtype = delta.get('type')
                if item['type'] == 'text' and dtype == 'text_delta':
                    value = delta.get('text', '')
                    if not value:
                        continue
                    if self.stats['first_token'] is None:
                        self.stats['first_token'] = time.time()
                    item['text'] += value
                    yield {'type': 'content_block_delta', 'index': block['index'], 'delta': {'type': 'text_delta', 'text': value}}
                elif item['type'] == 'text' and dtype == 'citation_start_delta':
                    citation = delta.get('citation') or {}
                    block['citations'][citation.get('uuid')] = citation
                elif item['type'] == 'text' and dtype == 'citation_end_delta':
                    citation = block['citations'].pop(delta.get('citation_uuid'), None)
                    if citation and citation.get('url'):
                        # The website marks a citation after the sentence it supports.
                        cited = item['text'][block['cite_from']:].strip()[-300:]
                        block['cite_from'] = len(item['text'])
                        value = {'type': 'web_search_result_location', 'url': citation['url'], 'title': citation.get('title', ''),
                                 'cited_text': cited, 'encrypted_index': ''}
                        item.setdefault('citations', []).append(value)
                        yield {'type': 'content_block_delta', 'index': block['index'], 'delta': {'type': 'citations_delta', 'citation': value}}
                elif item['type'] == 'thinking' and dtype in ('thinking_summary_delta', 'thinking_delta'):
                    value = (delta.get('summary') or {}).get('summary', '') if dtype == 'thinking_summary_delta' else delta.get('thinking', '')
                    if value:
                        value = ('\n\n' if item['thinking'] else '') + value
                        item['thinking'] += value
                        yield {'type': 'content_block_delta', 'index': block['index'], 'delta': {'type': 'thinking_delta', 'thinking': value}}
                elif item['type'] in ('tool_use', 'server_tool_use') and dtype == 'input_json_delta':
                    value = delta.get('partial_json', '')
                    block['json'] += value
                    yield {'type': 'content_block_delta', 'index': block['index'], 'delta': {'type': 'input_json_delta', 'partial_json': value}}
            elif kind == 'content_block_stop':
                block = blocks.pop(payload.get('index'), None)
                if not block:
                    continue
                item = block['item']
                if item['type'] in ('tool_use', 'server_tool_use'):
                    try:
                        item['input'] = json.loads(block['json']) if block['json'] else block.get('initial_input', {})
                    except ValueError:
                        fail(502, 'Claude sent incomplete tool arguments.', 'api_error')
                    if not isinstance(item['input'], dict):
                        fail(502, 'Claude sent invalid tool arguments.', 'api_error')
                    if item['type'] == 'tool_use':
                        tool_ids.append(item['id'])
                        self.stats['tool_calls'] += 1
                elif item['type'] == 'thinking':
                    item['signature'] = 'bridge'
                    yield {'type': 'content_block_delta', 'index': block['index'], 'delta': {'type': 'signature_delta', 'signature': 'bridge'}}
                yield {'type': 'content_block_stop', 'index': block['index']}
                # Website completion blocks here until its /tool_result side channel is posted.
                if tool_ids:
                    stop = 'tool_use'
                    self.pending.update(tool_ids)
                    break
            elif kind == 'message_delta':
                native = payload.get('delta', {}).get('stop_reason')
                if native in ('max_tokens', 'model_context_window_exceeded'):
                    stop = 'max_tokens'
            elif kind == 'message_stop':
                self.done = True
                break
            elif kind == 'ping':
                yield {'type': 'ping'}
        self.account.succeeded()
        self.last_content = copy.deepcopy(content)
        self.last_stop = stop
        output_tokens = max(1, count_text(json.dumps(content, ensure_ascii=False)))
        self.stats['output_tokens'] = output_tokens
        yield {'type': 'message_delta', 'delta': {'stop_reason': stop, 'stop_sequence': None},
               'usage': {'input_tokens': input_tokens, 'output_tokens': output_tokens}}
        yield {'type': 'message_stop'}

    async def close(self):
        if self.closed:
            return
        self.closed = True
        if self.expire_task and self.expire_task is not asyncio.current_task():
            self.expire_task.cancel()
        if self.stream_context is not None:
            try:
                await self.stream_context.__aexit__(None, None, None)
            except Exception:
                pass
        await self.bridge.pool.release(self.account)



USER_SENT = re.compile(r"user sent (?:a new )?message", re.I)


def user_notes(content):
    """Text the user sent alongside tool results, such as a message typed while Claude worked.

    Claude Code wraps such a message in a system reminder; other reminders do not count.
    """
    if not isinstance(content, list):
        return []
    return [b.get('text', '') for b in content if isinstance(b, dict) and b.get('type') == 'text' and b.get('text', '').strip()
            and (not b.get('text', '').lstrip().startswith('<system-reminder>') or USER_SENT.search(b.get('text', '')))]

# claude.ai drops client tools whose names it reserves (Read, Bash, Glob, Skill, Workflow, ...),
# so every tool is declared under this prefix and mapped back when Claude calls it.
TOOL_ALIAS = 'cc_'
DEVICE_PREFIX = 'mcp__claude-device__'


def tool_note(tools):
    names = ', '.join(DEVICE_PREFIX + TOOL_ALIAS + t['name'] for t in tools[:60])
    return ('<bridge-tools>\nThe tools for this conversation are exposed with the prefix ' + DEVICE_PREFIX + TOOL_ALIAS +
            '. When the instructions name a tool (for example Read or Bash), call ' + DEVICE_PREFIX + TOOL_ALIAS +
            'Read or ' + DEVICE_PREFIX + TOOL_ALIAS + 'Bash. Use only tools with this prefix' +
            ' (and web_search when it is offered); do not use other built-in tools that lack the prefix, such as web_fetch or widgets.\n'
            'Available: ' + names + '\n</bridge-tools>')

# Conversation and elicitation states from the RPC schema.
RPC_RUNNING, RPC_WAITING, RPC_ERROR = 2, 3, 5
TOOL_SETTLE_SECONDS = 0.6
RPC_STOP = {1: 'end_turn', 2: 'max_tokens', 3: 'tool_use', 5: 'stop_sequence', 8: 'max_tokens', 9: 'max_tokens', 7: 'pause_turn'}


class RpcTurn(BrowserTurn):
    """A completion over claude.ai's protobuf conversation service.

    Same interface as BrowserTurn. The RPC route is not behind the website's
    per-client burst throttle. Client tool calls arrive as timeline content
    blocks that need the client's approval; the bridge approves them (its
    caller decides what to run), forwards them as ``tool_use`` blocks, and
    returns results with ``submit_client_tool_result``.
    """

    route = 'rpc'

    def __init__(self, bridge, account, plan, conversation=None, parent=None):
        super().__init__(bridge, account, plan, conversation, parent)
        self.session = RpcSession(account.client, self.conversation)
        self.events = None
        self.groups, self.blocks = {}, {}
        self.texts, self.thoughts = {}, {}
        self.calls = {}
        self.approved = set()
        self.emitted = {}
        self.forwarded = set()
        self.waiting = False
        self.complete = None
        self.citations, self.cited = {}, []
        self.reader = None

    async def rpc_files(self, files):
        client = self.account.client
        attachments, inline = [], []
        if len(files) > MAX_ATTACHMENTS:
            fail(400, f'Attach at most {MAX_ATTACHMENTS} files per message.')
        for file in files:
            if file['kind'] == 'image':
                file = prepare_image(file)
                value = await client.request('POST', f'/api/{client.org}/upload', files={'file': (file['filename'], file['data'], file['mime'])})
                if not value.get('file_uuid'):
                    fail(502, 'Claude did not accept the image upload.', 'api_error')
                item = {'id': value['file_uuid'], 'file_name': file['filename'], 'file_size': len(file['data']), 'media_type': file['mime'], 'file_kind': 1}
                if value.get('document_id'):
                    item['document_id'] = value['document_id']
                attachments.append(item)
            elif file['kind'] == 'text' or file['mime'].startswith('text/') or file['mime'] in ('application/json', 'application/xml'):
                try:
                    text = file['data'].decode('utf8')
                except UnicodeDecodeError:
                    fail(400, 'Text attachments must use UTF-8.')
                inline.append({'file_name': file['filename'], 'file_size': len(file['data']), 'file_type': 'text/plain', 'extracted_content': text})
            else:
                inline.append(await client.convert(file))
        return attachments, inline

    async def open(self, prompt, files=()):
        attachments, inline = await self.rpc_files(list(files)) if files else ([], [])
        DIAGNOSTICS.append({'t': time.time(), 'account': self.account.id, 'kind': 'rpc_send',
                            'payload': json.dumps({'tools': [t['name'] for t in self.plan['tools']], 'attachments': attachments, 'inline': len(inline),
                                                   'prompt_chars': len(prompt), 'parent': self.parent, 'web_search': self.plan['web_search']})[:4000]})
        tools = [{**tool, 'name': TOOL_ALIAS + tool['name']} for tool in self.plan['tools']]
        if tools and not self.parent:
            prompt = tool_note(self.plan['tools']) + '\n\n' + prompt
        await self.session.send(prompt=prompt, model=self.plan['model'], assistant_id=self.assistant_id, parent=self.parent,
                                tools=tools, web_search=self.plan['web_search'], effort=self.plan['effort'],
                                thinking=True, attachments=attachments, inline=inline)
        self.events = self.session.events()

    def ours(self, block):
        group = self.groups.get(block.display_group_id)
        return group is not None and group.message_id == self.assistant_id

    def ordered(self):
        items = [b for b in self.blocks.values() if self.ours(b)]
        return sorted(items, key=lambda b: (self.groups[b.display_group_id].index, b.index))

    def kind(self, block):
        if block.HasField('display_content') and block.display_content.HasField('client_tool'):
            return 'tool'
        if block.analytics_tool_name == 'web_search' or block.row_kind == 3:
            return 'search'
        if block.HasField('thinking_display') or len(block.summaries) or block.id in self.thoughts:
            return 'thinking'
        if self.groups[block.display_group_id].style == 1:
            return 'text'
        return 'other'

    async def absorb(self, event):
        """Fold one timeline event into the turn state."""
        if not event.HasField('heartbeat'):
            DIAGNOSTICS.append({'t': time.time(), 'account': self.account.id, 'kind': 'rpc_event',
                                'payload': json.dumps(rpc_dict(event), ensure_ascii=False)[:2000]})
        if event.HasField('message_limit'):
            limit = rpc_dict(event.message_limit)
            self.account.update({'type': limit.get('status', ''), 'windows': limit.get('windows') or {}}, stream=True)
        if event.HasField('model_fallback'):
            fail(409, 'Claude switched to a different model; the response was stopped.', 'api_error')
        if event.HasField('append'):
            append = event.append
            if append.text_delta:
                self.texts[append.content_block_id] = self.texts.get(append.content_block_id, '') + append.text_delta
            if append.HasField('thinking_summary') and append.thinking_summary.summary:
                self.thoughts.setdefault(append.content_block_id, []).append(append.thinking_summary.summary)
            if append.HasField('citation_start') and append.citation_start.url:
                self.citations[append.citation_start.uuid] = append.citation_start
            if append.citation_end:
                self.cited.append((append.content_block_id, append.citation_end))
        if not event.HasField('update'):
            return
        update = event.update
        if update.replace_all_state:
            self.groups.clear()
            self.blocks.clear()
        for group in update.display_groups:
            self.groups[group.id] = group
        for block in update.content_blocks:
            self.blocks[block.id] = block
            if block.text and len(block.text) > len(self.texts.get(block.id, '')):
                self.texts[block.id] = block.text
            if len(block.summaries) > len(self.thoughts.get(block.id, [])):
                self.thoughts[block.id] = [x.summary for x in block.summaries]
            if block.HasField('display_content') and block.display_content.HasField('client_tool'):
                call = block.display_content.client_tool
                known = self.calls.setdefault(call.tool_use_id, {'input': '', 'session': '', 'version': 1})
                known.update(name=call.tool_name[len(TOOL_ALIAS):] if call.tool_name.startswith(TOOL_ALIAS) else call.tool_name, session=call.origin_session_id or known['session'], version=call.origin_version or known['version'])
                if call.input_json:
                    known['input'] = call.input_json
        for block_id in update.deleted_content_block_ids:
            self.blocks.pop(block_id, None)
        for elicitation in update.elicitations:
            request = elicitation.request
            if not request.tool_use_id or elicitation.HasField('response') or request.status != 1 or elicitation.id in self.approved:
                continue
            if request.kind != 1:
                fail(409, 'Claude asked for something the bridge cannot answer: ' + (request.title or 'an input request'), 'api_error')
            self.approved.add(elicitation.id)
            known = self.calls.setdefault(request.tool_use_id, {'input': '', 'session': '', 'version': 1})
            if request.reported_action.tool_input and not known['input']:
                known['input'] = request.reported_action.tool_input
            # The caller (for example Claude Code) applies its own permission rules before running a tool.
            await self.session.approve(elicitation, always=True)
        if update.HasField('conversation'):
            conversation = update.conversation
            if conversation.status == RPC_ERROR:
                status = 429 if conversation.status_error_class in (1, 12, 13, 20) else 502
                fail(status, conversation.status_detail or 'Claude stopped with an error.', 'rate_limit_error' if status == 429 else 'api_error')
            self.waiting = conversation.status == RPC_WAITING
        for message in update.messages:
            if message.id == self.assistant_id and message.is_complete:
                if message.stop_reason in (11, 12):
                    fail(502, 'Claude could not complete this response.', 'api_error')
                self.complete = message.stop_reason

    async def segment(self):
        if self.done:
            fail(409, 'Claude turn has already completed.')
        self.reset_stats()
        self.message_id = 'msg_' + uuid.uuid4().hex
        self.citations, self.cited = {}, []
        content, tool_ids = [], []
        index = -1
        current = None  # (block id, anthropic index, item)
        cite_from = {}
        input_tokens = max(1, count_text(render(self.plan['messages'], self.plan['system'])))
        self.stats['input_tokens'] = input_tokens
        yield {'type': 'message_start', 'message': {'id': self.message_id, 'type': 'message', 'role': 'assistant', 'content': [],
               'model': self.plan['model'], 'stop_reason': None, 'stop_sequence': None,
               'usage': {'input_tokens': input_tokens, 'output_tokens': 0}}}

        def begin(item):
            nonlocal index
            index += 1
            content.append(item)
            return index, {'type': 'content_block_start', 'index': index, 'content_block': copy.deepcopy(item)}

        def finish_current():
            nonlocal current
            if current is None:
                return []
            block_id, at, item = current
            current = None
            out = []
            if item['type'] == 'thinking':
                item['signature'] = 'bridge'
                out.append({'type': 'content_block_delta', 'index': at, 'delta': {'type': 'signature_delta', 'signature': 'bridge'}})
            out.append({'type': 'content_block_stop', 'index': at})
            return out

        def emit():
            """Turn new timeline state into Anthropic events, in display order."""
            nonlocal current
            out = []
            for block in self.ordered():
                kind = self.kind(block)
                if kind == 'other' or (kind == 'thinking' and not self.plan['thinking']):
                    self.forwarded.add(block.id)
                    continue
                if kind in ('text', 'thinking'):
                    if current and current[0] == block.id:
                        pass
                    elif block.id in self.forwarded:
                        continue
                    else:
                        out += finish_current()
                        item = {'type': 'text', 'text': ''} if kind == 'text' else {'type': 'thinking', 'thinking': '', 'signature': ''}
                        at, start = begin(item)
                        out.append(start)
                        current = (block.id, at, item)
                        self.forwarded.add(block.id)
                    at, item = current[1], current[2]
                    if kind == 'text':
                        text = self.texts.get(block.id, '')
                        if len(text) > len(item['text']) and text.startswith(item['text']):
                            delta = text[len(item['text']):]
                            item['text'] = text
                            if self.stats['first_token'] is None:
                                self.stats['first_token'] = time.time()
                            out.append({'type': 'content_block_delta', 'index': at, 'delta': {'type': 'text_delta', 'text': delta}})
                        for block_id, uid in [c for c in self.cited if c[0] == block.id]:
                            self.cited.remove((block_id, uid))
                            citation = self.citations.pop(uid, None)
                            if citation is None:
                                continue
                            cited = item['text'][cite_from.get(block.id, 0):].strip()[-300:]
                            cite_from[block.id] = len(item['text'])
                            value = {'type': 'web_search_result_location', 'url': citation.url, 'title': citation.title,
                                     'cited_text': cited, 'encrypted_index': ''}
                            item.setdefault('citations', []).append(value)
                            out.append({'type': 'content_block_delta', 'index': at, 'delta': {'type': 'citations_delta', 'citation': value}})
                    else:
                        summary = '\n\n'.join(self.thoughts.get(block.id, []))
                        if len(summary) > len(item['thinking']) and summary.startswith(item['thinking']):
                            delta = summary[len(item['thinking']):]
                            item['thinking'] = summary
                            out.append({'type': 'content_block_delta', 'index': at, 'delta': {'type': 'thinking_delta', 'thinking': delta}})
                    continue
                if block.id in self.forwarded:
                    continue
                if kind == 'search':
                    if block.state != 2 and not block.is_complete:
                        break  # Keep display order: wait for the search to finish.
                    out += finish_current()
                    self.forwarded.add(block.id)
                    self.stats['web_searches'] += 1
                    tool_id = block.tool_use_id or 'srvtoolu_' + uuid.uuid4().hex
                    query = {'query': block.input_summary}
                    at, start = begin({'type': 'server_tool_use', 'id': tool_id, 'name': 'web_search', 'input': query})
                    out += [start, {'type': 'content_block_stop', 'index': at}]
                    items = block.display_content.rich_items.items if block.HasField('display_content') else []
                    seen, results = set(), []
                    for entry in items:
                        if entry.url and entry.url not in seen:
                            seen.add(entry.url)
                            results.append({'type': 'web_search_result', 'url': entry.url, 'title': entry.title, 'encrypted_content': '', 'page_age': None})
                    at, start = begin({'type': 'web_search_tool_result', 'tool_use_id': tool_id, 'content': results})
                    out += [start, {'type': 'content_block_stop', 'index': at}]
                    continue
                # A client tool call: forward it once its input is known.
                call = self.calls.get(block.display_content.client_tool.tool_use_id)
                if not call or not call['input']:
                    break
                try:
                    arguments = json.loads(call['input'])
                except ValueError:
                    fail(502, 'Claude sent invalid tool arguments.', 'api_error')
                out += finish_current()
                self.forwarded.add(block.id)
                tool_id = block.display_content.client_tool.tool_use_id
                at, start = begin({'type': 'tool_use', 'id': tool_id, 'name': call['name'], 'input': arguments if isinstance(arguments, dict) else {}})
                out += [start, {'type': 'content_block_delta', 'index': at, 'delta': {'type': 'input_json_delta', 'partial_json': json.dumps(arguments)}},
                        {'type': 'content_block_stop', 'index': at}]
                tool_ids.append(tool_id)
                self.stats['tool_calls'] += 1
            return out

        stop = 'end_turn'
        while True:
            unresolved = [b for b in self.ordered() if self.kind(b) == 'tool' and b.id not in self.forwarded]
            # Every call in this step has its input: hand them over once Claude stops adding calls.
            # (With a standing tool grant the conversation never reports WAITING_FOR_INPUT.)
            settle = TOOL_SETTLE_SECONDS if tool_ids and not unresolved else None
            try:
                event = await self.next_event(settle)
            except StopAsyncIteration:
                fail(502, 'Claude closed its update stream early.', 'api_error')
            if event is None:
                for item in finish_current():
                    yield item
                stop = 'tool_use'
                self.pending.update(tool_ids)
                break
            if event.HasField('heartbeat'):
                yield {'type': 'ping'}
                continue
            await self.absorb(event)
            for item in emit():
                yield item
            if self.complete is not None:
                for item in finish_current():
                    yield item
                stop = RPC_STOP.get(self.complete, 'end_turn')
                if stop == 'tool_use' and not tool_ids:
                    stop = 'end_turn'
                self.done = stop != 'tool_use'
                if tool_ids:
                    self.pending.update(tool_ids)
                break
            unresolved = [b for b in self.ordered() if self.kind(b) == 'tool' and b.id not in self.forwarded]
            if tool_ids and self.waiting and not unresolved:
                for item in finish_current():
                    yield item
                stop = 'tool_use'
                self.pending.update(tool_ids)
                break
        self.account.succeeded()
        self.last_content = copy.deepcopy(content)
        self.last_stop = stop
        output_tokens = max(1, count_text(json.dumps(content, ensure_ascii=False)))
        self.stats['output_tokens'] = output_tokens
        yield {'type': 'message_delta', 'delta': {'stop_reason': stop, 'stop_sequence': None},
               'usage': {'input_tokens': input_tokens, 'output_tokens': output_tokens}}
        yield {'type': 'message_stop'}

    async def next_event(self, timeout=None):
        """The next timeline event, or None after ``timeout`` seconds; a pending read survives for the next call."""
        if self.reader is None:
            self.reader = asyncio.ensure_future(self.events.__anext__())
        done, _ = await asyncio.wait({self.reader}, timeout=timeout)
        if not done:
            return None
        reader, self.reader = self.reader, None
        return reader.result()

    async def submit(self, results):
        if not self.pending:
            fail(409, 'No client tool result is pending.', 'invalid_request_error')
        if set(self.pending) != {x.get('tool_use_id') for x in results}:
            fail(400, 'Supply one result for each pending tool use.')
        for result in results:
            content = result.get('content', '')
            if isinstance(content, list):
                content = text_of(content)
            if not isinstance(content, str):
                fail(400, 'tool_result content must be text or content blocks.')
            content, truncated = fit_delta('', content, 24000)
            if truncated:
                content += '\n[Tool output truncated to fit the Claude account route. Narrow the command or read a smaller range.]'
            call = self.calls.get(result['tool_use_id'], {})
            await self.session.submit(result['tool_use_id'], content, bool(result.get('is_error')),
                                      origin_session=call.get('session'), origin_version=call.get('version'))
        self.pending.clear()
        self.waiting = False
        self.complete = None

    async def close(self):
        if self.closed:
            return
        self.closed = True
        if self.expire_task and self.expire_task is not asyncio.current_task():
            self.expire_task.cancel()
        if not self.done:
            try:
                await asyncio.wait_for(self.session.stop(self.assistant_id), 10)
            except Exception:
                pass
        if self.reader is not None:
            self.reader.cancel()
            await asyncio.gather(self.reader, return_exceptions=True)
        if self.events is not None:
            try:
                await self.events.aclose()
            except Exception:
                pass
        await self.bridge.pool.release(self.account)


class AnthropicBridge:
    def __init__(self, pool):
        self.pool = pool
        self.sessions = {}
        self.lock = asyncio.Lock()
        self.session_locks = {}
        pool.idle_streams = lambda: sum(1 for value in self.sessions.values()
                                        if value['turn'].pending and not value['turn'].closed)

    def session_lock(self, session):
        lock = self.session_locks.get(session)
        if lock is None:
            if len(self.session_locks) > 2000:
                for key in [k for k, v in self.session_locks.items() if not v.locked() and k not in self.sessions][:1000]:
                    self.session_locks.pop(key, None)
            lock = self.session_locks[session] = asyncio.Lock()
        return lock

    async def prepare(self, body, session, authoritative=False):
        """Resume a pending tool turn, continue a linked conversation, or open a new one.

        Only requests within the same session wait for each other; other
        sessions proceed in parallel while this one waits for an account.
        """
        plan = parse(body, self.pool.models())
        messages = plan['messages']
        last = messages[-1]
        result_blocks = [b for b in (last['content'] if isinstance(last['content'], list) else [])
                         if isinstance(b, dict) and b.get('type') == 'tool_result']
        info = {'linked': False, 'handoff': False, 'kind': 'message', 'attachments': 0}
        async with self.session_lock(session):
            previous = self.sessions.get(session)
            turn = previous['turn'] if previous else None
            prefix = previous['expected'] if previous else None
            matching = bool(prefix and len(messages) >= len(prefix) and digest(messages[:len(prefix)]) == digest(prefix)
                            and previous['system'] == plan['system'])
            visual = any(isinstance(c, dict) and c.get('type') in ('image', 'document')
                         for b in result_blocks if isinstance(b.get('content'), list) for c in b['content'])
            # A tool result can only carry tool output. Images and messages from the user need a real
            # user turn, so those close the waiting website turn and replay the conversation instead.
            steering = bool(result_blocks and user_notes(last['content']))
            if result_blocks and turn and turn.pending and not turn.closed and not visual and not steering:
                if turn.expire_task:
                    turn.expire_task.cancel()
                    turn.expire_task = None
                try:
                    await turn.submit(result_blocks)
                except Exception:
                    self.sessions.pop(session, None)
                    await turn.close()
                    raise
                turn.plan = plan
                info.update(kind='tool_result', linked=True)
                return plan, turn, info
            if turn and turn.pending:
                # The client moved on without answering the tool call (for example it was
                # interrupted), or answered with an image the tool_result route cannot carry.
                # Stop that website turn and replay the history with attachments.
                self.sessions.pop(session, None)
                await turn.close()
                turn = None
            linked = bool(turn and turn.done and (matching or authoritative))
            if linked and self.pool.unavailable(turn.account.id, plan['model']):
                linked = False
                info['handoff'] = True
            excluded = set()
            last_error = None
            give_up = time.monotonic() + THROTTLE_GIVE_UP
            while True:
                if linked:
                    conversation, parent = turn.conversation, turn.assistant_id
                    files = []
                    prompt = render(messages[len(prefix):] if matching else [last], '', files)
                else:
                    conversation = parent = None
                    files = []
                    prompt = render(messages, plan['system'], files)
                try:
                    account = await self.pool.acquire(plan['model'], exclude=excluded, account_id=turn.account.id if linked else None)
                except APIError as exc:
                    if linked and exc.status in (429, 503, 409):
                        # Hand the conversation to another account with its full history.
                        linked = False
                        info['handoff'] = True
                        continue
                    if last_error:
                        raise last_error
                    raise
                # A conversation stays on the route it started on; new ones use RPC when the plan allows it.
                kind = type(turn) if linked else (BrowserTurn if account.client.legacy_only else RpcTurn)
                fresh = kind(self, account, plan, conversation, parent)
                try:
                    if kind is BrowserTurn:
                        await self.pool.gate.wait()
                    await fresh.open(prompt, files)
                    if kind is BrowserTurn:
                        self.pool.gate.succeeded()
                    break
                except APIError as exc:
                    await fresh.close()
                    if exc.code == 'rpc_org_tier_unavailable' and kind is RpcTurn:
                        account.client.legacy_only = True
                        if linked:
                            linked = False
                            info['handoff'] = True
                        continue
                    if exc.status != 429:
                        raise
                    account.penalize(exc)
                    last_error = exc
                    if transient(exc):
                        # A burst throttle covers every account: pause all starts, then retry.
                        info['throttled'] = info.get('throttled', 0) + 1
                        self.pool.gate.throttled()
                        if time.monotonic() + self.pool.gate.remaining() > give_up:
                            error = APIError(429, 'Claude is throttling new requests from this Space. Retry in a minute or two.', 'rate_limit_error',
                                             retry_after=int(self.pool.gate.remaining()) + 1)
                            error.throttled = info['throttled']
                            raise error from None
                        continue
                    excluded.add(account.id)
                    if linked:
                        linked = False
                        info['handoff'] = True
                except BaseException:
                    await fresh.close()
                    raise
            info['linked'] = linked
            info['attachments'] = len(files)
            self.sessions[session] = {'turn': fresh, 'expected': [], 'system': plan['system'], 'model': plan['model']}
            return plan, fresh, info

    async def finish(self, session, plan, turn):
        async with self.lock:
            if self.sessions.get(session, {}).get('turn') is turn:
                self.sessions[session]['expected'] = copy.deepcopy(plan['messages']) + [
                    {'role': 'assistant', 'content': copy.deepcopy(turn.last_content)}]
        if turn.done:
            await turn.close()
        elif turn.pending:
            turn.expire_task = asyncio.create_task(self.expire_pending(session, turn))
        else:
            await self.abort(session, turn)

    async def expire_pending(self, session, turn):
        try:
            await asyncio.sleep(PENDING_TOOL_SECONDS)
            await self.abort(session, turn)
        except asyncio.CancelledError:
            pass

    async def abort(self, session, turn):
        async with self.lock:
            if self.sessions.get(session, {}).get('turn') is turn:
                self.sessions.pop(session, None)
        await turn.close()


def sse(event):
    name = event['type']
    return ('event: ' + name + '\ndata: ' + json.dumps(event, ensure_ascii=False, separators=(',', ':')) + '\n\n').encode()
