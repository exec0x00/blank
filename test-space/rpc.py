"""Low-level access to claude.ai's protobuf conversation service.

The website's newer RPC route accepts client tool declarations, returns tool
calls as timeline content blocks, and takes tool results as a separate action.
Unlike the legacy SSE completion route it is not subject to the per-client
burst throttle, so it is the preferred route for accounts whose plan allows it.
"""

import asyncio
import gzip
import json
import struct
import uuid

import httpx

import schema
from errors import APIError
from upstream import RPC, stream_error

MAX_FRAME = 16_000_000


def frame(message):
    payload = message.SerializeToString()
    return b'\0' + struct.pack('>I', len(payload)) + payload


class RpcSession:
    """One website conversation driven over the RPC route."""

    def __init__(self, client, conversation=None):
        self.client = client
        self.conversation = conversation or str(uuid.uuid4())
        self.version = None

    async def send(self, *, prompt, model, assistant_id, parent=None, tools=(), web_search=False, effort='medium',
                   thinking=True, attachments=(), inline=()):
        client = self.client
        request = client.action(self.conversation)
        message = request.send_message
        message.message_id = str(uuid.uuid4())
        message.assistant_message_id = assistant_id
        if parent:
            message.parent_message_id = parent
        message.text = prompt
        message.model.identifier = model
        message.is_temporary = True
        message.timezone = 'UTC'
        message.locale = 'en-US'
        message.client_platform = 1
        message.chat_memory_mode = 2
        settings = message.settings_update.settings
        for name in ('enabled_drive_search', 'enabled_gmail_search', 'enabled_calendar_search', 'enabled_computer_tools', 'enabled_imagine'):
            setattr(settings, name, False)
        settings.enabled_web_search = web_search
        settings.tool_search_mode = 1 if web_search else 3
        settings.research_mode = 0
        settings.effort_level_token = effort
        settings.thinking_mode_token = 'auto' if thinking else 'off'
        settings.enabled_mcp_tools.SetInParent()
        for name in client.mcp_keys:
            settings.enabled_mcp_tools.tools[name] = False
        for tool in tools:
            message.client_tools.add(name=tool['name'], description=tool.get('description', ''),
                                     input_schema_json=json.dumps(tool.get('input_schema') or {'type': 'object'}))
        for item in attachments:
            message.attachments.add(**item)
        for item in inline:
            message.inline_attachments.add(**item)
        await client.perform(self.conversation, request)

    async def submit(self, tool_use_id, result, is_error=False, origin_session=None, origin_version=None):
        request = self.client.action(self.conversation)
        if origin_session:
            # A client tool call belongs to the mutation session that sent the message.
            request.header.mutation_id.session_id = origin_session
            request.header.mutation_id.version = int(origin_version or 1) + 1
        submit = request.submit_client_tool_result
        submit.tool_use_id = tool_use_id
        submit.result_json = json.dumps(result)
        submit.is_error = bool(is_error)
        await self.client.perform(self.conversation, request)

    async def approve(self, elicitation, always=True):
        """Approve a client tool call; claude.ai holds the call (and its input) until the client consents."""
        request = self.client.action(self.conversation)
        answer = request.respond_to_elicitation
        answer.elicitation_id = elicitation.id
        answer.ask_nonce = elicitation.request.ask_nonce
        answer.response.ask_nonce = elicitation.request.ask_nonce
        answer.response.verdict = 1
        answer.response.approval_option = 2 if always else 1
        await self.client.perform(self.conversation, request)

    async def stop(self, assistant_id):
        await self.client.stop(self.conversation, assistant_id)

    async def events(self, idle_timeout=240):
        """Yield StreamEvents, reconnecting with the last version when the server ends a stream."""
        client = self.client
        for attempt in range(40):
            request = schema.message('StreamTimelineRequest', conversation_id=self.conversation, outcome_acks=True,
                                     display_language='en-US', timezone='UTC')
            if self.version:
                request.version.value = self.version
            buffer = b''
            try:
                async with client.http.stream('POST', RPC + 'StreamTimeline', content=frame(request),
                                              headers=client.headers(self.conversation, True)) as response:
                    await client.check(response)
                    chunks = response.aiter_bytes()
                    while True:
                        try:
                            chunk = await asyncio.wait_for(chunks.__anext__(), idle_timeout)
                        except StopAsyncIteration:
                            break
                        except asyncio.TimeoutError:
                            raise APIError(504, 'Claude stopped sending updates.', 'timeout_error') from None
                        buffer += chunk
                        while len(buffer) >= 5:
                            flags, length = buffer[0], struct.unpack('>I', buffer[1:5])[0]
                            if length > MAX_FRAME:
                                raise APIError(502, 'Claude sent an oversized frame.', 'api_error')
                            if len(buffer) < length + 5:
                                break
                            raw, buffer = buffer[5:5 + length], buffer[5 + length:]
                            if flags & 1:
                                raw = gzip.decompress(raw)
                            if flags & 2:
                                end = json.loads(raw or b'{}')
                                if end.get('error'):
                                    raise APIError(502, end['error'].get('message', 'Claude stream failed.'), 'api_error')
                                break
                            event = schema.parse('StreamTimelineResponse', raw).event
                            if event.HasField('version') and event.version.value:
                                self.version = event.version.value
                            if event.HasField('error'):
                                raise stream_error(event.error)
                            yield event
            except httpx.HTTPError:
                pass
            await asyncio.sleep(min(3.0, 0.25 * 2 ** min(attempt, 4)))
        raise APIError(502, 'Claude kept closing its update stream.', 'api_error')


def strip_any(message, seen=None):
    """Clear google.protobuf.Any fields in place; their payload types are not in the captured schema."""
    for field, value in message.ListFields():
        if field.message_type is None:
            continue
        if field.message_type.full_name == 'google.protobuf.Any':
            if seen is not None:
                for item in (value if field.label == field.LABEL_REPEATED else [value]):
                    seen.append({'type_url': item.type_url, 'bytes': item.value[:400].hex()})
            message.ClearField(field.name)
        elif field.label == field.LABEL_REPEATED:
            if field.message_type.GetOptions().map_entry:
                continue
            for item in value:
                strip_any(item, seen)
        else:
            strip_any(value, seen)


def as_dict(message, extras=None):
    copy = type(message)()
    copy.CopyFrom(message)
    strip_any(copy, extras)
    return schema.as_dict(copy)
