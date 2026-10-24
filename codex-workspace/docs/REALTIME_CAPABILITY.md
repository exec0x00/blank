# Realtime audio capability decision

Checked **2026-09-20 at 13:20:15 UTC** against the app's only permitted model endpoint, `https://alvin3y10-api.hf.space/api`.

**Do not add realtime audio to the app.** The current endpoint exposes the Responses WebSocket protocol and rejected voice-session startup. There is no verified realtime-audio session contract through this exact route. This applies the user's latest instruction: check support, and omit the feature if unsupported. Realtime audio is therefore excluded from the current release; it is not an unresolved request for the user to supply another endpoint.

## Live evidence

One direct, certificate-verified TLS WebSocket connection used the exact `/api` path, the existing configured placeholder authentication and no redirects, alternate paths or model discovery. The connection had a 35-second working deadline, a 38-second hard deadline and a 64 KiB total response limit.

| Observation | Result |
| --- | --- |
| WebSocket upgrade | HTTP **101**, with a validated `Sec-WebSocket-Accept` |
| First application message sent | The documented Live `session.start`, with a session configuration and no audio |
| First server event | `error`, with `invalid_request_error` |
| Server explanation | “Expected a 'response.create' message as the first websocket event.” |
| Session readiness | No `session.started`, `session.created` or equivalent audio-session readiness event |
| Connection close | Server close code **1000** |
| Elapsed time / received bytes | **0.855 seconds / 689 bytes**, including the handshake |

After the error, the harness wrote a legacy `session.update` event. The peer closed without acknowledging it. That second write is **not** an independently established rejection or acceptance of the legacy protocol. The affirmative evidence is the server's first-event requirement for `response.create`, together with the routing source below. The harness recorded EOF while waiting for the second event; that does not erase the first server response or prove a second capability result.

The check sent **zero audio bytes**, no microphone or user content, no `response.create`, no response-generation command and no tool call. It requested no content generation, closed its socket, and recorded no session credentials or private response payloads. Sanitized observations are in the investigation artifact `/tmp/codex-realtime-capability-check/handshake.json`; this document preserves the durable result.

## Routing source

Read-only public Space metadata reported revision **`7ea650d02b0acb8dad8755b69e030a481b812be6`** for `alvin3y10/api`. Its public files were `.gitattributes`, `README.md` and `app.py`. The fetched `app.py` was 33,955 bytes with SHA-256 **`3e22c90e1cf232f28413d44ee3e4938260d330186d7a297fd82568954913953b`**.

At that immutable revision, `map_api_target` maps exact `/api` to `/v1/responses`. Both `run_http_job` and `handle_api_ws` use that mapping and forward request bodies or events to a worker. The public repository contains neither that worker implementation nor an audio-session adapter. The inspected source revision is not claimed to be an independently verified live deployment revision; the live protocol response above provides separate evidence. [Owner relay source](https://huggingface.co/spaces/alvin3y10/api/blob/7ea650d02b0acb8dad8755b69e030a481b812be6/app.py#L389)

## Why a working WebSocket is insufficient

Official OpenAI documentation distinguishes a voice session from a Responses connection. The documented Live workflow starts a session, waits for session readiness, then exchanges audio and session events. Realtime has its own audio-session protocol. [Voice WebSocket guide](https://developers.openai.com/api/docs/guides/voice-websockets)

Responses WebSocket mode instead starts turns with `response.create` carrying a Responses request. That matches the requirement returned by the fixed service; accepting a WebSocket upgrade alone does not establish bidirectional audio support. [Responses WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode)

The official pages and public relay source were fetched directly over HTTPS on the check date. No alternate route on the model service, including `/models`, `/audio`, `/realtime` or `/live`, was queried.

## Application scope

- Leave realtime voice controls, microphone capture, audio-session transports and realtime agent handoffs absent.
- Do not substitute browser-vendor speech recognition, an extra provider, a proxy or transcription-only behavior and label it realtime support.
- This result does not establish whether an independent batch-audio or transcription request could work, whether an unexamined route supports voice, or whether the service might add a compatible adapter later.
- Existing text Responses and separately verified image-generation support are independent capabilities.

A bounded source inspection found no `getUserMedia`, `MediaRecorder`, browser speech-recognition or realtime session-start entrypoint in the current `client/` and `server/` TypeScript sources. This task adds only this evidence document and no application controls or runtime transport.

The earlier [multimodal parity plan](MULTIMODAL_PARITY_PLAN.md) predates the user's conditional exclusion. Its realtime implementation proposal is not an instruction to add unsupported voice features or hold the release for an alternate transport.
