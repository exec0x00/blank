import asyncio
import base64
import io
import json
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import create_app
from pool import Account, Pool, StartGate
from usage_store import UsageStore

KEY = 'local-test-password'
HEADERS = {'x-api-key': KEY}


def wire(kind, value):
    return 'event: ' + kind + '\ndata: ' + json.dumps({'type': kind, **value}) + '\n\n'


def limit_event(five=0.42, seven=0.1, kind='within_limit'):
    return wire('message_limit', {'message_limit': {'type': kind, 'resetsAt': None,
        'windows': {'5h': {'status': 'within_limit', 'resets_at': 4102444800, 'utilization': five},
                    '7d': {'status': 'within_limit', 'resets_at': 4102444800, 'utilization': seven}}}})


def text_stream(text='pong', extra=''):
    return ''.join([wire('message_start', {'message': {'uuid': 'assistant-' + uuid.uuid4().hex[:6]}}),
                    wire('content_block_start', {'index': 0, 'content_block': {'type': 'text', 'text': ''}}),
                    wire('content_block_delta', {'index': 0, 'delta': {'type': 'text_delta', 'text': text}}),
                    wire('content_block_stop', {'index': 0}), extra,
                    wire('message_delta', {'delta': {'stop_reason': 'end_turn'}}), limit_event(), wire('message_stop', {})])


def tool_stream():
    return ''.join([wire('message_start', {'message': {'uuid': 'assistant-tool'}}),
                    wire('content_block_start', {'index': 0, 'content_block': {'type': 'tool_use', 'id': 'toolu_1', 'name': 'echo_ping', 'input': {}}}),
                    wire('content_block_delta', {'index': 0, 'delta': {'type': 'input_json_delta', 'partial_json': '{"value":"ping"}'}}),
                    wire('content_block_stop', {'index': 0}),
                    wire('content_block_start', {'index': 1, 'content_block': {'type': 'text', 'text': ''}}),
                    wire('content_block_delta', {'index': 1, 'delta': {'type': 'text_delta', 'text': 'done'}}),
                    wire('content_block_stop', {'index': 1}),
                    wire('message_delta', {'delta': {'stop_reason': 'end_turn'}}), wire('message_stop', {})])


def search_stream():
    return ''.join([
        wire('message_start', {'message': {'uuid': 'assistant-search'}}),
        wire('content_block_start', {'index': 0, 'content_block': {'type': 'thinking', 'thinking': ''}}),
        wire('content_block_delta', {'index': 0, 'delta': {'type': 'thinking_summary_delta', 'summary': {'summary': 'Planning a search.'}}}),
        wire('content_block_stop', {'index': 0}),
        wire('content_block_start', {'index': 1, 'content_block': {'type': 'tool_use', 'id': 'toolu_s', 'name': 'web_search', 'input': {}}}),
        wire('content_block_delta', {'index': 1, 'delta': {'type': 'input_json_delta', 'partial_json': '{"query": "python"}'}}),
        wire('content_block_stop', {'index': 1}),
        wire('content_block_start', {'index': 2, 'content_block': {'type': 'tool_result', 'tool_use_id': 'toolu_s', 'name': 'web_search',
             'content': [{'type': 'knowledge', 'title': 'Python', 'url': 'https://python.org'}]}}),
        wire('content_block_stop', {'index': 2}),
        wire('content_block_start', {'index': 3, 'content_block': {'type': 'text', 'text': ''}}),
        wire('content_block_delta', {'index': 3, 'delta': {'type': 'text_delta', 'text': 'Python 3.15 is current.'}}),
        wire('content_block_delta', {'index': 3, 'delta': {'type': 'citation_start_delta', 'citation': {'uuid': 'c1', 'title': 'Python', 'url': 'https://python.org'}}}),
        wire('content_block_delta', {'index': 3, 'delta': {'type': 'citation_end_delta', 'citation_uuid': 'c1'}}),
        wire('content_block_stop', {'index': 3}),
        wire('message_delta', {'delta': {'stop_reason': 'end_turn'}}), limit_event(0.5), wire('message_stop', {})])


class FakeClaude:
    def __init__(self, account_id='account-1', streams=None, status=None, fails=None, retry_after=None):
        self.org = 'org'
        self.legacy_only = True  # These fakes speak the legacy SSE route.
        self.device_id = str(uuid.uuid4())
        self.activity_session_id = str(uuid.uuid4())
        self.account_id = account_id
        self.catalogue = {'claude-haiku-5-5': {}, 'claude-sonnet-5-5': {}}
        self.calls = []
        self.streams = list(streams or [])
        self.status = status
        self.fails = fails  # Number of completions rejected with ``status`` before the stream works.
        self.retry_after = retry_after
        self.gate = None

        async def transport(request):
            body = None
            if request.content and request.headers.get('content-type', '').startswith('application/json'):
                body = json.loads(request.content)
            self.calls.append((request.url.path, body))
            if request.url.path.endswith('/completion'):
                if self.status and (self.fails is None or self.fails > 0):
                    if self.fails:
                        self.fails -= 1
                    return httpx.Response(self.status, json={'error': {'message': 'rate limited'}})
                if self.gate:
                    await self.gate.wait()
                stream = self.streams.pop(0) if self.streams else text_stream()
                return httpx.Response(200, text=stream, headers={'content-type': 'text/event-stream'})
            if request.url.path.endswith('/tool_result'):
                return httpx.Response(200, json={})
            if request.url.path.endswith('/upload'):
                return httpx.Response(200, json={'file_uuid': 'file-1'})
            if request.url.path.endswith('/convert_document'):
                return httpx.Response(200, json={'extracted_content': 'pdf text'})
            return httpx.Response(404, json={'error': {'message': 'missing'}})
        self.http = httpx.AsyncClient(base_url='https://claude.ai', transport=httpx.MockTransport(transport))

    async def check(self, response):
        if response.status_code >= 400:
            from errors import APIError
            await response.aread()
            raise APIError(response.status_code, 'upstream failed', 'rate_limit_error' if response.status_code == 429 else 'upstream',
                           retry_after=self.retry_after)

    async def request(self, method, path, **kwargs):
        r = await self.http.request(method, path, **kwargs)
        await self.check(r)
        return r.json()

    async def convert(self, file):
        value = await self.request('POST', f'/api/organizations/{self.org}/convert_document', files={'file': (file['filename'], file['data'], file['mime'])})
        return {'file_name': file['filename'], 'file_size': len(file['data']), 'file_type': file['mime'], 'extracted_content': value['extracted_content']}

    async def usage(self):
        return {'five_hour': None}

    async def close(self):
        await self.http.aclose()


def make_app(monkeypatch, tmp_path, *clients, capacity=3):
    monkeypatch.setenv('PASSWORD', KEY)
    monkeypatch.setenv('KEY_BUCKET_PATH', str(tmp_path))
    store = UsageStore(tmp_path)
    pool = Pool(store=store)
    pool.accounts = [Account(f'acct_{i + 1}', f'Account {i + 1}', c, store, capacity=capacity) for i, c in enumerate(clients)]
    pool.gate = StartGate(0, pause=0.05, throttled_interval=0.05)
    monkeypatch.setattr('anthropic_api.THROTTLE_GIVE_UP', 0.5)
    return create_app(pool=pool, usage=store), store, pool


def request(content, **extra):
    return {'model': 'claude-haiku-5-5', 'max_tokens': 500, 'messages': [{'role': 'user', 'content': content}], **extra}


def test_usage_is_inferred_from_traffic_and_persisted(monkeypatch, tmp_path):
    upstream = FakeClaude()
    app, store, pool = make_app(monkeypatch, tmp_path, upstream)
    with TestClient(app) as client:
        response = client.post('/v1/messages', json=request('hi'), headers={**HEADERS, 'x-bridge-client': 'playground'})
        assert response.status_code == 200, response.text
        assert response.headers['x-bridge-route'] == 'new'
        status = client.get('/admin/status', cookies={}).status_code
        assert status == 401
    windows = pool.accounts[0].public()['windows']
    assert round(windows['5h']['percent']) == 42 and round(windows['7d']['percent']) == 10
    store.flush()
    reloaded = UsageStore(tmp_path)
    saved = reloaded.account('account-1')
    assert round(saved['windows']['5h']['percent']) == 42
    assert saved['stats']['requests'] == 1 and saved['stats']['ok'] == 1
    assert reloaded.requests[-1]['source'] == 'playground'
    # A restored account starts from the stored usage without sending a message.
    restored = Account('acct_9', 'Again', FakeClaude(), reloaded)
    restored.restore()
    assert round(restored.public()['windows']['5h']['percent']) == 42


def test_web_search_citations_and_thinking_map_to_messages_blocks(monkeypatch, tmp_path):
    upstream = FakeClaude(streams=[search_stream()])
    app, store, _ = make_app(monkeypatch, tmp_path, upstream)
    body = request('search', tools=[{'type': 'web_search_20250305', 'name': 'web_search'}], thinking={'type': 'enabled', 'budget_tokens': 1024})
    with TestClient(app) as client:
        value = client.post('/v1/messages', json=body, headers=HEADERS).json()
    kinds = [b['type'] for b in value['content']]
    assert kinds == ['thinking', 'server_tool_use', 'web_search_tool_result', 'text']
    assert value['content'][0]['thinking'] == 'Planning a search.'
    assert value['content'][1]['input'] == {'query': 'python'}
    assert value['content'][2]['content'][0]['url'] == 'https://python.org'
    assert value['content'][3]['citations'][0]['url'] == 'https://python.org'
    assert 'Python 3.15' in value['content'][3]['citations'][0]['cited_text']
    assert store.requests[-1]['web_searches'] == 1
    completion = [b for p, b in upstream.calls if p.endswith('/completion')][0]
    assert {'type': 'web_search_v0', 'name': 'web_search'} in completion['tools']


def test_thinking_hidden_unless_requested(monkeypatch, tmp_path):
    upstream = FakeClaude(streams=[search_stream()])
    app, _, _ = make_app(monkeypatch, tmp_path, upstream)
    with TestClient(app) as client:
        value = client.post('/v1/messages', json=request('search', tools=[{'type': 'web_search_20250305', 'name': 'web_search'}]), headers=HEADERS).json()
    assert [b['type'] for b in value['content']] == ['server_tool_use', 'web_search_tool_result', 'text']


def test_attachments_are_uploaded_or_inlined(monkeypatch, tmp_path):
    upstream = FakeClaude()
    app, store, _ = make_app(monkeypatch, tmp_path, upstream)
    image = io.BytesIO()
    Image.new('RGB', (3000, 1000), 'red').save(image, 'PNG')
    content = [{'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': base64.b64encode(image.getvalue()).decode()}},
               {'type': 'document', 'title': 'notes.txt', 'source': {'type': 'text', 'media_type': 'text/plain', 'data': 'hello notes'}},
               {'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': base64.b64encode(b'%PDF-1.4 fake').decode()}},
               {'type': 'text', 'text': 'Describe these'}]
    with TestClient(app) as client:
        response = client.post('/v1/messages', json=request(content), headers=HEADERS)
        assert response.status_code == 200, response.text
    completion = [b for p, b in upstream.calls if p.endswith('/completion')][0]
    assert completion['files'] == ['file-1']
    names = [a['file_name'] for a in completion['attachments']]
    assert names == ['notes.txt', 'document.pdf']
    assert completion['attachments'][1]['extracted_content'] == 'pdf text'
    assert '[Attached image' in completion['prompt'] and 'Describe these' in completion['prompt']
    assert store.requests[-1]['attachments'] == 3


def test_linked_conversation_hands_off_when_account_is_limited(monkeypatch, tmp_path):
    first, second = FakeClaude('account-1'), FakeClaude('account-2')
    app, store, pool = make_app(monkeypatch, tmp_path, first, second)
    headers = {**HEADERS, 'x-claude-code-session-id': 'handoff'}
    with TestClient(app) as client:
        one = client.post('/v1/messages', json=request('first question', system='Be brief'), headers=headers).json()
        used = next(a for a in pool.accounts if [c for c in a.client.calls if c[0].endswith('/completion')])
        used.set_cooldown(600, 'Usage limit reached')
        follow = request('first question', system='Be brief')
        follow['messages'] += [{'role': 'assistant', 'content': one['content']}, {'role': 'user', 'content': 'second question'}]
        response = client.post('/v1/messages', json=follow, headers=headers)
        assert response.status_code == 200, response.text
        assert response.headers['x-bridge-route'] == 'handoff'
    other = next(a for a in pool.accounts if a is not used)
    prompt = [b for p, b in other.client.calls if p.endswith('/completion')][-1]['prompt']
    assert 'first question' in prompt and 'second question' in prompt and 'Be brief' in prompt
    assert store.requests[-1]['handoff'] is True


def test_usage_limited_account_cools_down_until_reset_and_next_account_serves(monkeypatch, tmp_path):
    limited, healthy = FakeClaude('account-1', status=429, retry_after=120), FakeClaude('account-2')
    app, store, pool = make_app(monkeypatch, tmp_path, limited, healthy)
    with TestClient(app) as client:
        for _ in range(2):
            response = client.post('/v1/messages', json=request('hello ' + uuid.uuid4().hex), headers=HEADERS)
            assert response.status_code == 200, response.text
    account = pool.accounts[0]
    assert 100 < account.cooldown - __import__('time').time() <= 121
    assert len([c for c in limited.calls if c[0].endswith('/completion')]) == 1


def test_burst_throttle_retries_without_cooling_down_accounts(monkeypatch, tmp_path):
    # Claude throttles every account at once with retry-after 0; the request waits and succeeds.
    first, second = FakeClaude('account-1', status=429, fails=1), FakeClaude('account-2', status=429, fails=1)
    app, store, pool = make_app(monkeypatch, tmp_path, first, second)
    with TestClient(app) as client:
        response = client.post('/v1/messages', json=request('hello'), headers=HEADERS)
        assert response.status_code == 200, response.text
        assert all(a.cooldown == 0 for a in pool.accounts)
        assert pool.gate.throttles == 2
        assert store.requests[-1]['throttled'] == 2


def test_persistent_throttle_gives_a_clear_retryable_error(monkeypatch, tmp_path):
    app, store, pool = make_app(monkeypatch, tmp_path, FakeClaude('account-1', status=429))
    with TestClient(app) as client:
        response = client.post('/v1/messages', json=request('hello'), headers=HEADERS)
        assert response.status_code == 429
        assert 'throttling' in response.json()['error']['message']
        assert pool.accounts[0].cooldown == 0


@pytest.mark.anyio
async def test_streams_beyond_the_global_cap_queue(monkeypatch, tmp_path):
    first, second = FakeClaude('account-1'), FakeClaude('account-2')
    first.gate = asyncio.Event()
    app, _, pool = make_app(monkeypatch, tmp_path, first, second)
    pool.max_streams = 1
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        slow = asyncio.create_task(client.post('/v1/messages', json=request('slow'), headers={**HEADERS, 'x-session-id': 'a'}))
        await asyncio.sleep(0.2)
        queued = asyncio.create_task(client.post('/v1/messages', json=request('queued'), headers={**HEADERS, 'x-session-id': 'b'}))
        await asyncio.sleep(0.3)
        assert not queued.done()
        assert not [c for c in second.calls if c[0].endswith('/completion')]
        first.gate.set()
        assert (await slow).status_code == 200
        assert (await asyncio.wait_for(queued, 5)).status_code == 200


def test_abandoned_tool_call_does_not_block_the_session(monkeypatch, tmp_path):
    upstream = FakeClaude(streams=[tool_stream(), text_stream('fresh')])
    app, _, _ = make_app(monkeypatch, tmp_path, upstream)
    tools = [{'name': 'echo_ping', 'description': 'x', 'input_schema': {'type': 'object'}}]
    headers = {**HEADERS, 'x-claude-code-session-id': 'abandon'}
    with TestClient(app) as client:
        value = client.post('/v1/messages', json=request('call it', tools=tools), headers=headers).json()
        assert value['stop_reason'] == 'tool_use'
        follow = request('call it', tools=tools)
        follow['messages'] += [{'role': 'assistant', 'content': value['content']}, {'role': 'user', 'content': 'never mind, say hi'}]
        response = client.post('/v1/messages', json=follow, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()['content'][0]['text'] == 'fresh'


@pytest.mark.anyio
async def test_sessions_do_not_block_each_other(monkeypatch, tmp_path):
    slow, quick = FakeClaude('account-1'), FakeClaude('account-2')
    slow.gate = asyncio.Event()
    app, _, _ = make_app(monkeypatch, tmp_path, slow, quick, capacity=1)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        first = asyncio.create_task(client.post('/v1/messages', json=request('slow one'), headers={**HEADERS, 'x-session-id': 'a'}))
        await asyncio.sleep(0.2)
        second = await asyncio.wait_for(client.post('/v1/messages', json=request('quick one'), headers={**HEADERS, 'x-session-id': 'b'}), 5)
        assert second.status_code == 200
        slow.gate.set()
        assert (await first).status_code == 200


@pytest.fixture
def anyio_backend():
    return 'asyncio'


@pytest.mark.anyio
async def test_start_gate_stays_quiet_while_paused_and_keeps_order():
    gate = StartGate(0, pause=0.3, throttled_interval=0.05)
    gate.throttled()
    order, started = [], __import__('time').monotonic()

    async def start(name):
        await gate.wait()
        order.append((name, __import__('time').monotonic() - started))

    await asyncio.gather(*(start(n) for n in 'abc'))
    assert [n for n, _ in order] == ['a', 'b', 'c']
    assert order[0][1] >= 0.29
    assert order[2][1] - order[0][1] >= 0.09


def test_image_tool_result_replays_with_the_image_attached(monkeypatch, tmp_path):
    upstream = FakeClaude(streams=[tool_stream(), text_stream('I see a red square')])
    app, _, _ = make_app(monkeypatch, tmp_path, upstream)
    tools = [{'name': 'echo_ping', 'description': 'x', 'input_schema': {'type': 'object'}}]
    headers = {**HEADERS, 'x-claude-code-session-id': 'image-tool'}
    with TestClient(app) as client:
        value = client.post('/v1/messages', json=request('look at it', tools=tools), headers=headers).json()
        assert value['stop_reason'] == 'tool_use'
        follow = request('look at it', tools=tools)
        follow['messages'] += [{'role': 'assistant', 'content': value['content']},
                               {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': value['content'][0]['id'],
                                                             'content': [{'type': 'text', 'text': 'Read screenshot.png'}, png_block()]}]}]
        response = client.post('/v1/messages', json=follow, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()['content'][0]['text'] == 'I see a red square'
    assert any(path.endswith('/upload') for path, _ in upstream.calls)
    assert not any(path.endswith('/tool_result') for path, _ in upstream.calls)
    completions = [body for path, body in upstream.calls if path.endswith('/completion')]
    assert completions[-1]['files'] == ['file-1'] and 'Read screenshot.png' in completions[-1]['prompt']


def png_block():
    image = io.BytesIO()
    Image.new('RGB', (8, 8), 'red').save(image, 'PNG')
    return {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': base64.b64encode(image.getvalue()).decode()}}


@pytest.mark.anyio
async def test_queued_stream_starts_at_once_and_keeps_the_connection_alive(monkeypatch, tmp_path):
    first, second = FakeClaude('account-1'), FakeClaude('account-2')
    first.gate = asyncio.Event()
    app, store, pool = make_app(monkeypatch, tmp_path, first, second)
    monkeypatch.setattr('app.QUEUE_NOTE_SECONDS', 0.1)
    pool.max_streams = 1
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        slow = asyncio.create_task(client.post('/v1/messages', json=request('slow'), headers={**HEADERS, 'x-session-id': 'a'}))
        await asyncio.sleep(0.1)
        asyncio.get_running_loop().call_later(0.5, first.gate.set)
        response = await asyncio.wait_for(client.post('/v1/messages', json=request('queued', stream=True), headers={**HEADERS, 'x-session-id': 'b'}), 10)
        assert response.status_code == 200
        lines = response.text.splitlines()
        assert any(line.startswith(': queued') for line in lines)
        assert (await slow).status_code == 200
    assert any(line.startswith(': bridge') for line in lines)
    assert any('message_stop' in line for line in lines)
    assert store.requests[-1]['status'] == 'ok'
