import asyncio
import json
import struct

import httpx
from fastapi.testclient import TestClient
from google.protobuf import json_format

import schema
from upstream import BASE, RPC, Claude
from test_bridge_features import HEADERS, make_app, request, text_stream


def frame(event):
    payload = json_format.ParseDict({'event': event}, schema.message('StreamTimelineResponse')).SerializeToString()
    return b'\0' + struct.pack('>I', len(payload)) + payload


class FakeRpc(Claude):
    """Speaks claude.ai's protobuf conversation service from a script of timeline events."""

    def __init__(self, script, account_id='rpc-1'):
        super().__init__('sk-ant-sid-test')
        self.org = 'org'
        self.account_id = account_id
        self.catalogue = {'claude-haiku-5-5': {}}
        self.script = script
        self.actions = []
        self.queue = asyncio.Queue()
        self.http = httpx.AsyncClient(base_url=BASE, transport=httpx.MockTransport(self.handle))

    async def usage(self):
        return {}

    async def handle(self, request):
        path = request.url.path
        if path.endswith('PerformAction'):
            action = schema.parse('PerformActionRequest', request.content)
            kind = action.WhichOneof('action') if action.DESCRIPTOR.oneofs else None
            kind = kind or next(f.name for f, _ in action.ListFields() if f.name != 'header')
            self.actions.append((kind, action))
            for event in self.script(kind, action, self):
                self.queue.put_nowait(event)
            return httpx.Response(200, content=schema.message('PerformActionResponse').SerializeToString())
        if path.endswith('StreamTimeline'):
            async def body():
                while True:
                    event = await self.queue.get()
                    yield frame(event)
            return httpx.Response(200, content=body())
        if path.endswith('/completion'):
            return httpx.Response(200, text=text_stream('legacy reply'), headers={'content-type': 'text/event-stream'})
        return httpx.Response(404)


def group(id, message, index, style):
    return {'id': id, 'message_id': message, 'index': index, 'style': style}


def done(message, reason='STOP_REASON_END_TURN'):
    return {'update': {'messages': [{'id': message, 'role': 'ROLE_ASSISTANT', 'is_complete': True, 'stop_reason': reason}],
                       'conversation': {'status': 'STATUS_IDLE'}}}


def chat_script(kind, action, fake):
    if kind != 'send_message':
        return []
    a = action.send_message.assistant_message_id
    fake.sent = action.send_message
    return [
        {'heartbeat': {}},
        {'append': {'content_block_id': 'think', 'thinking_summary': {'summary': 'Planning a greeting.'}}},
        {'update': {'display_groups': [group('g1', a, 0, 'GROUP_STYLE_TIMELINE'), group('g2', a, 1, 'GROUP_STYLE_INLINE')],
                    'content_blocks': [{'id': 'think', 'display_group_id': 'g1', 'thinking_display': {}, 'summaries': [{'summary': 'Planning a greeting.'}]},
                                       {'id': 'text', 'display_group_id': 'g2', 'text': 'Hel'}]}},
        {'append': {'content_block_id': 'text', 'text_delta': 'lo there.'}},
        {'append': {'content_block_id': 'text', 'citation_start': {'uuid': 'c1', 'title': 'Example', 'url': 'https://example.com'}}},
        {'append': {'content_block_id': 'text', 'citation_end': 'c1'}},
        {'message_limit': {'status': 'MESSAGE_LIMIT_STATUS_WITHIN_LIMIT',
                           'windows': {'5h': {'status': 'MESSAGE_LIMIT_STATUS_WITHIN_LIMIT', 'resets_at': '2099-01-01T00:00:00Z', 'utilization': 0.25}}}},
        done(a),
    ]


def tool_script(kind, action, fake):
    if kind == 'send_message':
        fake.assistant = a = action.send_message.assistant_message_id
        session = action.header.mutation_id.session_id
        call = {'tool_name': 'cc_echo_ping', 'tool_use_id': 'toolu_rpc', 'origin_session_id': session, 'origin_version': '1'}
        fake.call = call
        return [
            {'update': {'display_groups': [group('g1', a, 0, 'GROUP_STYLE_TIMELINE')],
                        'content_blocks': [{'id': 'tool', 'display_group_id': 'g1', 'state': 'CONTENT_BLOCK_STATE_PENDING_APPROVAL',
                                            'display_content': {'client_tool': call}, 'tool_use_id': 'toolu_rpc'}],
                        'elicitations': [{'id': 'elicit_1', 'request': {'status': 'STATUS_PENDING', 'kind': 'KIND_APPROVAL', 'ask_nonce': 'nonce',
                                          'tool_use_id': 'toolu_rpc', 'reported_action': {'tool_name': 'echo_ping', 'tool_input': '{"value": "ping"}'}}}],
                        'conversation': {'status': 'STATUS_WAITING_FOR_INPUT'}}},
        ]
    if kind == 'respond_to_elicitation':
        return [{'update': {'content_blocks': [{'id': 'tool', 'display_group_id': 'g1', 'state': 'CONTENT_BLOCK_STATE_RUNNING',
                                                'display_content': {'client_tool': {**fake.call, 'input_json': '{"value": "ping"}'}}}]}}]
    if kind == 'submit_client_tool_result':
        a = fake.assistant
        return [
            {'update': {'conversation': {'status': 'STATUS_RUNNING'}}},
            {'update': {'display_groups': [group('g2', a, 1, 'GROUP_STYLE_INLINE')], 'content_blocks': [{'id': 'answer', 'display_group_id': 'g2', 'text': ''}]}},
            {'append': {'content_block_id': 'answer', 'text_delta': 'The tool said pong.'}},
            done(a),
        ]
    return []


def rpc_app(monkeypatch, tmp_path, script):
    fake = FakeRpc(script)
    app, store, pool = make_app(monkeypatch, tmp_path, fake)
    return app, store, pool, fake


def test_rpc_chat_maps_thinking_text_citations_and_usage(monkeypatch, tmp_path):
    app, store, pool, fake = rpc_app(monkeypatch, tmp_path, chat_script)
    body = request('hello', thinking={'type': 'enabled', 'budget_tokens': 1024}, model='claude-haiku-5-5')
    with TestClient(app) as client:
        response = client.post('/v1/messages', json=body, headers=HEADERS)
        assert response.status_code == 200, response.text
        value = response.json()
    assert [b['type'] for b in value['content']] == ['thinking', 'text']
    assert value['content'][0]['thinking'] == 'Planning a greeting.'
    assert value['content'][1]['text'] == 'Hello there.'
    assert value['content'][1]['citations'][0]['url'] == 'https://example.com'
    assert value['stop_reason'] == 'end_turn'
    assert pool.accounts[0].windows['5h']['percent'] == 25.0
    assert store.requests[-1]['status'] == 'ok'
    assert fake.sent.model.identifier == 'claude-haiku-5-5'


def test_rpc_client_tool_round_trip(monkeypatch, tmp_path):
    app, store, pool, fake = rpc_app(monkeypatch, tmp_path, tool_script)
    tools = [{'name': 'echo_ping', 'description': 'Echo', 'input_schema': {'type': 'object'}}]
    headers = {**HEADERS, 'x-claude-code-session-id': 'rpc-tools'}
    with TestClient(app) as client:
        first = client.post('/v1/messages', json=request('call it', tools=tools, model='claude-haiku-5-5'), headers=headers).json()
        assert first['stop_reason'] == 'tool_use', first
        assert first['content'][-1] == {'type': 'tool_use', 'id': 'toolu_rpc', 'name': 'echo_ping', 'input': {'value': 'ping'}}
        follow = request('call it', tools=tools, model='claude-haiku-5-5')
        follow['messages'] += [{'role': 'assistant', 'content': first['content']},
                               {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 'toolu_rpc', 'content': 'pong'}]}]
        second = client.post('/v1/messages', json=follow, headers=headers)
        assert second.status_code == 200, second.text
        assert second.headers['x-bridge-route'] == 'tool_result'
        assert second.json()['content'][0]['text'] == 'The tool said pong.'
    kinds = [kind for kind, _ in fake.actions]
    assert kinds == ['send_message', 'respond_to_elicitation', 'submit_client_tool_result']
    submit = fake.actions[2][1]
    assert json.loads(submit.submit_client_tool_result.result_json) == 'pong'
    assert submit.header.mutation_id.session_id == fake.call['origin_session_id']
    declared = fake.actions[0][1].send_message.client_tools[0]
    assert declared.name == 'cc_echo_ping' and json.loads(declared.input_schema_json) == {'type': 'object'}
    assert 'mcp__claude-device__cc_echo_ping' in fake.actions[0][1].send_message.text


def test_rpc_unavailable_plan_falls_back_to_legacy(monkeypatch, tmp_path):
    def blocked(kind, action, fake):
        return []
    fake = FakeRpc(blocked)

    async def refuse(conversation, request):
        from errors import APIError
        raise APIError(403, 'This isn’t available for your account.', 'rpc_org_tier_unavailable')
    fake.perform = refuse
    app, store, pool = make_app(monkeypatch, tmp_path, fake)
    with TestClient(app) as client:
        response = client.post('/v1/messages', json=request('hello', model='claude-haiku-5-5'), headers=HEADERS)
        assert response.status_code == 200, response.text
        assert response.json()['content'][0]['text'] == 'legacy reply'
    assert fake.legacy_only is True


def test_text_sent_with_a_tool_result_reaches_claude(monkeypatch, tmp_path):
    app, store, pool, fake = rpc_app(monkeypatch, tmp_path, tool_script)
    tools = [{'name': 'echo_ping', 'description': 'Echo', 'input_schema': {'type': 'object'}}]
    headers = {**HEADERS, 'x-claude-code-session-id': 'rpc-steer'}
    with TestClient(app) as client:
        first = client.post('/v1/messages', json=request('call it', tools=tools, model='claude-haiku-5-5'), headers=headers).json()
        follow = request('call it', tools=tools, model='claude-haiku-5-5')
        follow['messages'] += [{'role': 'assistant', 'content': first['content']},
                               {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 'toolu_rpc', 'content': 'pong'},
                                                            {'type': 'text', 'text': '<system-reminder>todo list</system-reminder>'},
                                                            {'type': 'text', 'text': 'Also say goodbye.'},
                                                            {'type': 'text', 'text': '<system-reminder>\nThe user sent a new message while you were working:\nUse French.\n</system-reminder>'}]}]
        assert client.post('/v1/messages', json=follow, headers=headers).status_code == 200
    submitted = json.loads(fake.actions[2][1].submit_client_tool_result.result_json)
    assert submitted.startswith('pong') and 'Also say goodbye.' in submitted and 'todo list' not in submitted
    assert 'Use French.' in submitted
