"""Local Claude email login UI. Python 3.10+; standard library only.

Run: python claude_session_local.py
Open the printed local URL. No Claude web page or browser automation is loaded.
The browser loads this local page and hCaptcha's challenge assets only.
The session key is shown on the local page after login for selection or copying.
"""

import argparse
import datetime
import http.cookiejar
import json
import queue
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = "https://claude.ai"
SEND_SITEKEY = "f1b21a9c-9100-4022-a928-8d5c29de2e6a"
VERIFY_SITEKEY = "a8086506-2036-46f4-ae50-00d8be805efa"
# Versions and role choices captured from Claude's 2026-10-20 web bundle in
# claude3.har. If Claude changes these document versions, the server may reject
# the request; the app will show that error instead of claiming completion.
LEGAL_VERSIONS = {
    "aup": "22742366-2ef0-4c7a-a833-6523f10d3944",
    "consumer-terms": "79dbc8c6-7f64-43d6-8101-207cede59a4d",
    "privacy": "baeb68ac-c81c-4931-9539-58f46b6f090c",
}
WORK_FUNCTIONS = (
    "Product Management", "Engineering", "Human Resources", "Finance",
    "Marketing", "Sales", "Operations", "Data Science", "Design", "Legal",
    "Student", "Founder", "Healthcare", "Writer", "Educator",
    "Consultant", "Researcher", "Other",
)
FIRST_NAMES = ("Alex", "Avery", "Casey", "Drew", "Jordan", "Morgan", "Quinn", "Riley", "Sam", "Taylor")
LAST_NAMES = ("Bennett", "Brooks", "Carter", "Ellis", "Hayes", "Morgan", "Parker", "Reed", "Rowan", "Sloan")
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36")

PAGE = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude session login</title>
<style>
:root{font:15px/1.5 system-ui,sans-serif;color:#292520;background:#f5f1ea}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px}
main{width:min(480px,100%);background:#fff;border:1px solid #e5dcd1;border-radius:18px;padding:28px;box-shadow:0 14px 40px #3b251315}
h1{font:30px Georgia,serif;margin:0 0 8px}p{color:#665d52;margin:0 0 20px}
label{display:block;font-weight:650;margin:16px 0 7px}input{width:100%;padding:12px 14px;border:1px solid #b9aa99;border-radius:9px;font:inherit}
button{padding:11px 17px;border:0;border-radius:9px;background:#b65e3c;color:#fff;font:inherit;font-weight:650;cursor:pointer}
button.secondary{background:#eee7df;color:#3b3029}
button:disabled{opacity:.5;cursor:default}.row{display:flex;gap:10px;align-items:center;margin-top:15px}
.hide{display:none}#captcha{min-height:76px;margin:15px 0}#status{margin:17px 0 0;min-height:23px}
.error{color:#aa3730!important}.meta{font-size:13px;color:#655a50;margin-top:12px}
#sessionKey{font-family:ui-monospace,monospace;cursor:copy}
</style></head><body><main>
<h1>Claude session login</h1><p>Enter your email, complete the CAPTCHA, then enter the emailed code.</p>
<form id="emailForm"><label for="email">Email address</label><input id="email" type="email" autocomplete="email" required>
<label style="font-weight:400"><input id="consent" type="checkbox" style="width:auto;margin-right:8px" required>I confirm I am over 24. If this is a new account, I agree to Claude's <a href="https://www.anthropic.com/legal/consumer-terms" target="_blank" rel="noopener">Consumer Terms</a>, <a href="https://www.anthropic.com/legal/aup" target="_blank" rel="noopener">Acceptable Use Policy</a>, and <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a>. Do not sign me up for marketing email.</label>
<div class="row"><button type="submit">Continue</button></div></form>
<div id="captchaSection" class="hide"><label>CAPTCHA</label><div id="captcha"></div></div>
<form id="codeForm" class="hide"><label for="code">Six-digit email code</label><input id="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required>
<div class="row"><button type="submit">Verify code</button></div></form>
<div id="done" class="hide"><label for="sessionKey">Session key</label><input id="sessionKey" type="text" readonly autocomplete="off" spellcheck="false" title="Click to copy, or select and copy manually">
<div class="row"><button id="copy" type="button">Copy session key</button></div>
<div class="meta" id="profile"></div><div class="meta" id="expiry"></div><div class="meta" id="nextCheck"></div><div class="meta" id="renewal"></div></div>
<div id="stopRow" class="row hide"><button id="stop" class="secondary" type="button">Stop and return to email</button></div>
<p id="status" role="status" aria-live="polite"></p>
</main><script>
'use strict';const localToken='__LOCAL_TOKEN__';const keys={send_captcha:'__SEND_SITEKEY__',verify_captcha:'__VERIFY_SITEKEY__'};
let stage='',widget=null,expiresAt=null,nextCheckAt=null,version=0,attempt=0;
const $=id=>document.getElementById(id);
function show(s,error=false){$('status').textContent=s;$('status').classList.toggle('error',error)}
async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':localToken},body:JSON.stringify(body),cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d}
function challenge(s,g){if(!window.hcaptcha)return;if(widget!==null&&hcaptcha.remove)hcaptcha.remove(widget);$('captcha').replaceWith(Object.assign(document.createElement('div'),{id:'captcha'}));widget=hcaptcha.render('captcha',{sitekey:keys[s],theme:'light',callback:async token=>{try{show('Submitting CAPTCHA...');await post('/captcha',{stage:s,token,generation:g});show('CAPTCHA received. Continuing...')}catch(e){if(g===attempt)show(e.message,true)}},'error-callback':e=>show('CAPTCHA error: '+e,true),'expired-callback':()=>{show('CAPTCHA expired. Try again.',true);hcaptcha.reset(widget)}})}
function countdown(){const now=Date.now();$('expiry').textContent=expiresAt?'Cookie expires in '+format(Math.max(0,expiresAt-now)):'Cookie expiry: not provided by Claude';$('nextCheck').textContent=nextCheckAt?'Next session check in '+format(Math.max(0,nextCheckAt-now)):'Next session check: unavailable'}
function format(ms){let s=Math.floor(ms/1000);const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);s%=60;return(d?d+'d ':'')+(h||d?h+'h ':'')+(m||h||d?m+'m ':'')+s+'s'}
async function poll(){try{const r=await fetch('/state',{cache:'no-store'});const d=await r.json();expiresAt=d.expires_at?d.expires_at*1000:null;nextCheckAt=d.next_check_at?d.next_check_at*1000:null;$('renewal').textContent=d.renewal||'';$('profile').textContent=d.profile_name?'New profile: '+d.profile_name+' · '+d.work_function:'';if(d.stage!==stage||d.generation!==attempt){stage=d.stage;attempt=d.generation;$('emailForm').classList.toggle('hide',stage!=='idle'&&stage!=='error');$('captchaSection').classList.toggle('hide',!keys[stage]);$('codeForm').classList.toggle('hide',stage!=='code');$('done').classList.toggle('hide',stage!=='done');$('stopRow').classList.toggle('hide',stage==='idle'||stage==='error');if(stage!=='done')$('sessionKey').value='';if(keys[stage])challenge(stage,attempt);else if(widget!==null){if(window.hcaptcha&&hcaptcha.remove)hcaptcha.remove(widget);widget=null;$('captcha').replaceChildren()}if(stage==='code')$('code').focus();if(stage==='error')show(d.message,true);else if(stage!=='done')show(d.message);else show('Verification complete.')}if(stage!=='done')version=0;else if(d.key_version!==version){const k=await post('/key',{});if(k.generation===attempt&&k.key_version===d.key_version){$('sessionKey').value=k.key;version=k.key_version;if(version>1)show('Claude issued an updated session key. Copy it again.')}}if(keys[stage]&&widget===null&&window.hcaptcha)challenge(stage,attempt);countdown()}catch(e){show(e.message||'Local server connection lost.',true)}}
$('emailForm').onsubmit=async e=>{e.preventDefault();try{await post('/start',{email:$('email').value.trim(),consent:$('consent').checked});poll()}catch(x){show(x.message,true)}};
$('codeForm').onsubmit=async e=>{e.preventDefault();try{await post('/code',{code:$('code').value.trim(),generation:attempt});$('code').value='';poll()}catch(x){show(x.message,true)}};
$('stop').onclick=async()=>{try{await post('/stop',{generation:attempt});$('code').value='';await poll();$('email').focus()}catch(e){show(e.message,true)}};
async function copyKey(){const field=$('sessionKey');if(!field.value)return show('Session key is not ready yet.',true);field.focus();field.select();try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(field.value);else if(!document.execCommand('copy'))throw Error('Browser copy was unavailable');show('Session key copied.')}catch(e){show('Copy failed. The key is selected; press Ctrl+C to copy it.',true)}}
$('copy').onclick=copyKey;$('sessionKey').onclick=copyKey;
window.onHCaptchaReady=()=>poll();setInterval(poll,1000);poll();
</script><script src="https://js.hcaptcha.com/1/api.js?render=explicit&onload=onHCaptchaReady" async defer></script></body></html>'''


def request_json(opener, path, headers, data=None, method=None):
    payload = None if data is None else json.dumps(data, separators=(",", ":")).encode()
    req = urllib.request.Request(BASE + path, data=payload,
                                 headers={**headers, **({"Content-Type": "application/json"} if payload is not None else {})},
                                 method=method or ("POST" if payload is not None else "GET"))
    try:
        with opener.open(req, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            body = json.loads(raw)
            error = body.get("error", {})
            message = error.get("message", "Request rejected") if isinstance(error, dict) else body.get("message", "Request rejected")
        except (ValueError, UnicodeDecodeError):
            message = "Cloudflare blocked the request" if exc.code == 403 else "Non-JSON server response"
        raise RuntimeError(f"{path.split('?',1)[0]}: HTTP {exc.code}: {message}") from None


def key_cookie(jar):
    for name in ("sessionKey", "sessionKeyV3"):
        for cookie in jar:
            if cookie.name == name and cookie.domain.lstrip(".") == "claude.ai" and cookie.value:
                return cookie
    return None


class Cancelled(Exception):
    pass


class State:
    def __init__(self):
        self.lock = threading.RLock()
        self.local_token = secrets.token_urlsafe(32)
        self.stage = "idle"
        self.message = "Enter your email to begin."
        self.email = ""
        self.captcha_queue = queue.Queue()
        self.code_queue = queue.Queue()
        self.jar = None
        self.opener = None
        self.headers = None
        self.key = None
        self.expires_at = None
        self.key_version = 0
        self.renewal = ""
        self.next_check_at = None
        self.generation = 0
        self.profile_name = ""
        self.work_function = ""
        self.consent = False

    def set(self, stage, message):
        with self.lock:
            self.stage, self.message = stage, message
        print(message, flush=True)

    def ensure_current(self, generation):
        with self.lock:
            if self.generation != generation:
                raise Cancelled()

    def set_for_generation(self, generation, stage, message):
        with self.lock:
            if self.generation != generation:
                raise Cancelled()
            self.stage, self.message = stage, message
        print(message, flush=True)

    def snapshot(self):
        with self.lock:
            return {"stage": self.stage, "message": self.message, "email": self.email,
                    "generation": self.generation,
                    "expires_at": self.expires_at, "key_version": self.key_version,
                    "renewal": self.renewal, "next_check_at": self.next_check_at,
                    "profile_name": self.profile_name, "work_function": self.work_function}

    def update_key(self):
        cookie = key_cookie(self.jar)
        if cookie is None:
            return False
        with self.lock:
            if cookie.value != self.key:
                self.key, self.key_version = cookie.value, self.key_version + 1
                self.renewal = "Session key updated by Claude." if self.key_version > 1 else "Session key received from Claude."
            self.expires_at = cookie.expires
        return True


def finish_new_account(state, generation, call, account):
    """Perform the onboarding mutations observed in claude3.har."""
    settings = account.get("settings") or {}
    accepted = account.get("accepted_clickwrap_versions") or {}
    if not settings.get("has_started_claudeai_onboarding"):
        state.set_for_generation(generation, "onboarding", "Starting Claude onboarding...")
        call("/api/account/settings", {"has_started_claudeai_onboarding": True}, method="PATCH")
    missing = [kind for kind, version in LEGAL_VERSIONS.items() if accepted.get(kind) != version]
    if missing:
        if not state.consent:
            raise RuntimeError("Legal document consent was not provided.")
        state.set_for_generation(generation, "onboarding", "Accepting Claude's legal documents...")
        call("/api/account/accept_legal_docs", {
            "acceptances": [{"document_id": f"v3:{kind}:{LEGAL_VERSIONS[kind]}",
                             "accepted_via_checkbox": True} for kind in missing],
            "marketing_email": {"choice": "unticked", "form": "legal_notices"},
        }, method="PUT")
    if not account.get("age_is_verified"):
        state.set_for_generation(generation, "onboarding", "Recording age confirmation...")
        call("/api/account", {"age_is_verified": True}, method="PUT")
    name = " ".join((secrets.choice(FIRST_NAMES), secrets.choice(LAST_NAMES)))
    role = secrets.choice(WORK_FUNCTIONS)
    state.set_for_generation(generation, "onboarding", "Setting up the new profile...")
    call("/api/account", {"display_name": name, "full_name": name}, method="PUT")
    call("/api/account_profile", {"work_function": role}, method="PUT")
    call("/api/account/settings", {"has_finished_claudeai_onboarding": True, "work_function": role}, method="PATCH")
    with state.lock:
        state.ensure_current(generation)
        state.profile_name, state.work_function = name, role


def login(state, generation):
    email = state.email
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.8",
               "Origin": BASE, "Referer": BASE + "/login",
               "anthropic-anonymous-id": "claudeai.v1." + str(uuid.uuid4()),
               "anthropic-client-platform": "web_claude_ai", "anthropic-client-version": "1.0.0",
               "anthropic-client-capabilities": "mfa_sms_v1, mfa_email_v1",
               "anthropic-device-id": str(uuid.uuid4()), "x-activity-session-id": str(uuid.uuid4())}
    def call(path, data=None, method=None):
        state.ensure_current(generation)
        result = request_json(opener, path, headers, data, method)
        state.ensure_current(generation)
        return result
    try:
        query = urllib.parse.urlencode({"email": email, "source": "claude-ai"})
        methods = call("/api/auth/login_methods?" + query)
        if not isinstance(methods.get("methods"), list):
            raise RuntimeError("Claude returned unexpected login methods.")
        state.set_for_generation(generation, "send_captcha", "Complete CAPTCHA to send the verification email.")
        _, send_token = state.captcha_queue.get()
        state.set_for_generation(generation, "sending", "Sending verification email...")
        offset = datetime.datetime.now().astimezone().utcoffset()
        utc_offset = -int(offset.total_seconds() // 60) if offset else 0
        sent = call("/api/auth/send_magic_link", {
            "utc_offset": utc_offset, "email_address": email, "login_intent": None,
            "locale": "en-US", "return_to": None,
            "client_attestation": {"hcaptcha_token": send_token}, "source": "claude"})
        send_token = None
        if not sent.get("sent"):
            raise RuntimeError("Claude did not confirm sending the email.")
        state.set_for_generation(generation, "code", f"Email sent to {email}. Enter the six-digit code.")
        code = state.code_queue.get()
        state.set_for_generation(generation, "verify_captcha", "Complete the second CAPTCHA to verify the code.")
        _, verify_token = state.captcha_queue.get()
        state.set_for_generation(generation, "verifying", "Verifying the code...")
        verified = call("/api/auth/verify_magic_link", {
            "credentials": {"method": "code", "email_address": email, "code": code},
            "locale": "en-US", "client_attestation": {"hcaptcha_token": verify_token}, "source": "claude"})
        code = verify_token = None
        if verified.get("success") is not True:
            raise RuntimeError("Claude did not confirm the login.")
        account = verified.get("account")
        if not isinstance(account, dict):
            raise RuntimeError("Claude did not return account details after login.")
        if not account.get("onboarding_complete"):
            finish_new_account(state, generation, call, account)
        with state.lock:
            state.ensure_current(generation)
            state.jar, state.opener, state.headers = jar, opener, headers
            if not state.update_key():
                raise RuntimeError("Login succeeded but Claude did not set a sessionKey cookie.")
            state.next_check_at = time.time() + 30
            state.renewal = "First session check is scheduled in 30 seconds."
        state.set_for_generation(generation, "done", "Session key is ready. Click it to copy, or select it manually.")
        threading.Thread(target=check_session_loop, args=(state, generation), daemon=True).start()
    except Cancelled:
        return
    except (RuntimeError, OSError, ValueError) as exc:
        try:
            state.set_for_generation(generation, "error", str(exc))
        except Cancelled:
            pass


def check_session_loop(state, generation):
    # A normal authenticated request may rotate cookies. We observe Set-Cookie in
    # the same CookieJar; no undocumented refresh endpoint is assumed.
    while True:
        with state.lock:
            if state.generation != generation or state.stage != "done":
                return
            due = state.next_check_at
        time.sleep(max(1, min(30, due - time.time())))
        if time.time() < due:
            continue
        with state.lock:
            if state.generation != generation or state.stage != "done":
                return
            opener, headers = state.opener, state.headers
        try:
            request_json(opener, "/api/auth/accounts", headers)
            with state.lock:
                if state.generation != generation or state.stage != "done":
                    return
                changed = state.key != (key_cookie(state.jar).value if key_cookie(state.jar) else None)
                state.update_key()
                state.renewal = "Claude updated the key." if changed else "Session checked; key unchanged."
                remaining = (state.expires_at - time.time()) if state.expires_at else None
                interval = 600 if remaining is None else min(600, max(30, remaining - 300))
                state.next_check_at = time.time() + interval
        except (RuntimeError, OSError) as exc:
            with state.lock:
                if state.generation != generation or state.stage != "done":
                    return
                state.renewal = f"Automatic check stopped: {exc}"
                state.next_check_at = None
            return


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/":
            page = (PAGE.replace("__LOCAL_TOKEN__", self.server.state.local_token)
                    .replace("__SEND_SITEKEY__", SEND_SITEKEY)
                    .replace("__VERIFY_SITEKEY__", VERIFY_SITEKEY)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(page)
        elif self.path == "/state":
            self.reply(200, self.server.state.snapshot())
        else:
            self.reply(404, {"error": "Not found"})

    def do_POST(self):
        state = self.server.state
        if self.path not in ("/start", "/captcha", "/code", "/key", "/stop") or self.headers.get("X-Local-Token") != state.local_token:
            return self.reply(403, {"error": "Forbidden"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 10000:
                raise ValueError("Invalid request size")
            data = json.loads(self.rfile.read(size))
            if self.path == "/start":
                email = data.get("email", "").strip()
                if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
                    raise ValueError("Enter a valid email address")
                if data.get("consent") is not True:
                    raise ValueError("Confirm the age and terms checkbox to continue")
                with state.lock:
                    if state.stage not in ("idle", "error", "done"):
                        raise ValueError("A login is already in progress")
                    state.generation += 1
                    gen = state.generation
                    state.email = email
                    state.consent = True
                    state.key, state.expires_at, state.key_version = None, None, 0
                    state.next_check_at, state.renewal = None, ""
                    state.profile_name, state.work_function = "", ""
                    state.captcha_queue = queue.Queue()
                    state.code_queue = queue.Queue()
                    state.jar = state.opener = state.headers = None
                    state.stage, state.message = "starting", "Checking login methods..."
                threading.Thread(target=login, args=(state, gen), daemon=True).start()
            elif self.path == "/stop":
                with state.lock:
                    if data.get("generation") != state.generation:
                        raise ValueError("This attempt has already changed")
                    old_captcha, old_code = state.captcha_queue, state.code_queue
                    state.generation += 1
                    state.stage, state.message = "idle", "Stopped. Enter an email to begin. A request already sent to Claude may still finish."
                    state.email, state.consent = "", False
                    state.key, state.expires_at, state.key_version = None, None, 0
                    state.jar = state.opener = state.headers = None
                    state.next_check_at, state.renewal = None, ""
                    state.profile_name, state.work_function = "", ""
                    state.captcha_queue, state.code_queue = queue.Queue(), queue.Queue()
                    old_captcha.put((None, None))
                    old_code.put(None)
            elif self.path == "/captcha":
                stage, token = data.get("stage"), data.get("token")
                with state.lock:
                    if data.get("generation") != state.generation or stage != state.stage or stage not in ("send_captcha", "verify_captcha") or not isinstance(token, str) or len(token) < 100:
                        raise ValueError("CAPTCHA token is not expected now")
                    state.captcha_queue.put((stage, token))
            elif self.path == "/code":
                code = data.get("code")
                with state.lock:
                    if data.get("generation") != state.generation or state.stage != "code" or not isinstance(code, str) or not re.fullmatch(r"[0-9]{6}", code):
                        raise ValueError("Enter the current six-digit code")
                    state.code_queue.put(code)
            elif self.path == "/key":
                with state.lock:
                    if state.stage != "done" or not state.key:
                        raise ValueError("No session key is available")
                    return self.reply(200, {"key": state.key, "key_version": state.key_version,
                                            "generation": state.generation})
            self.reply(200, {"ok": True})
        except (ValueError, TypeError, OSError, json.JSONDecodeError) as exc:
            self.reply(400, {"error": str(exc)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8789)
    parser.add_argument("--no-open", action="store_true", help="Do not open the browser automatically")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be 1-65535")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.state = State()
    url = f"http://localtest.me:{args.port}/"
    print("Local login page:", url, flush=True)
    if not args.no_open:
        threading.Timer(.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
