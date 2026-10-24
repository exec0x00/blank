import asyncio
import collections
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from errors import APIError
from upstream import Claude
from usage_store import UsageStore

# Concurrent completions one Claude account may serve. A turn waiting for a
# client tool result keeps its upstream stream open, so it counts as well.
ACCOUNT_CAPACITY = max(1, int(os.environ.get('ACCOUNT_CONCURRENCY', '3')))
ACQUIRE_WAIT_SECONDS = 300
# Upstream completions open at once across all accounts. Claude throttles every
# account when one client runs more than about four, so requests queue instead.
MAX_STREAMS = max(1, int(os.environ.get('MAX_STREAMS', '3')))
USAGE_REFRESH_SECONDS = 600
# Spacing between completion starts across all accounts. Claude rejects bursts of
# new completions from one client with a 429 and ``retry-after: 0`` on every
# account at once, so starts are paced and the spacing widens after a throttle.
START_INTERVAL = max(0.0, float(os.environ.get('START_INTERVAL', '1.0')))
MAX_START_INTERVAL = 30.0
# Claude counts rejected attempts against the same budget, so a throttled bridge
# must stay quiet: no start at all until the shared pause ends.
THROTTLE_PAUSE = 20.0
MAX_THROTTLE_PAUSE = 120.0
WINDOW_ALIASES = {'5h': '5h', 'five_hour': '5h', '7d': '7d', 'seven_day': '7d'}
EXCEEDED = ('MESSAGE_LIMIT_STATUS_EXCEEDED', 'exceeded', 'exceeded_limit')


def timestamp(value):
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value) / 1000 if value > 10_000_000_000 else float(value)
    if isinstance(value, dict):
        return float(value.get('seconds', 0))
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
        except ValueError:
            pass
    return 0.0


def window_name(name):
    return WINDOW_ALIASES.get(name, name)


def transient(error):
    """A short Claude throttle (no reset time) as opposed to a usage limit."""
    return error.status == 429 and not error.retry_after


class StartGate:
    """Paces completion starts and pauses every start together after a burst throttle.

    Claude extends a throttle while rejected requests keep arriving, so after a
    throttle nothing starts until a shared pause ends; the pause doubles while
    throttles continue and resets on the next success.
    """

    def __init__(self, interval=START_INTERVAL, pause=THROTTLE_PAUSE, throttled_interval=10.0):
        self.base = interval
        self.throttled_interval = throttled_interval
        self.interval = interval
        self.pause = pause
        self.next = 0.0
        self.paused_until = 0.0
        self.consecutive = 0
        self.throttles = 0
        self.queue = collections.deque()

    async def wait(self):
        """Wait for this request's turn to start a completion, first come first served."""
        ticket = object()
        self.queue.append(ticket)
        try:
            while True:
                now = time.monotonic()
                ready = max(self.next, self.paused_until)
                if self.queue[0] is ticket and now >= ready:
                    self.next = now + self.interval
                    return
                await asyncio.sleep(min(0.25, max(0.02, ready - now)))
        finally:
            self.queue.remove(ticket)

    def remaining(self):
        return max(0.0, self.paused_until - time.monotonic())

    def throttled(self):
        self.throttles += 1
        self.consecutive += 1
        self.interval = min(MAX_START_INTERVAL, max(self.interval * 2, self.throttled_interval))
        pause = min(MAX_THROTTLE_PAUSE, self.pause * 2 ** (self.consecutive - 1))
        self.paused_until = max(self.paused_until, time.monotonic() + pause)

    def succeeded(self):
        self.consecutive = 0
        self.interval = max(self.base, self.interval * 0.8)

    def public(self):
        return {'interval': round(self.interval, 2), 'paused_for': round(self.remaining(), 1),
                'throttles': self.throttles, 'max_streams': MAX_STREAMS, 'queued': len(self.queue)}


@dataclass
class Account:
    id: str
    label: str
    client: object
    store: object = None
    windows: dict = field(default_factory=dict)
    cooldown: float = 0
    cooldown_reason: str = ''
    active: int = 0
    capacity: int = ACCOUNT_CAPACITY
    checked: float = 0
    strikes: int = 0
    limit_type: str = ''
    throttled_at: float = 0

    @property
    def key(self):
        return self.client.account_id or self.label

    @property
    def busy(self):
        return self.active >= self.capacity

    def restore(self):
        """Resume the last known usage for this Claude account after a restart."""
        if not self.store:
            return
        saved = self.store.account(self.key)
        self.windows = {k: v for k, v in (saved.get('windows') or {}).items() if isinstance(v, dict)}
        self.checked = float(saved.get('checked') or 0)
        self.limit_type = saved.get('limit_type', '')
        if float(saved.get('cooldown') or 0) > time.time():
            self.cooldown = float(saved['cooldown'])
            self.cooldown_reason = saved.get('cooldown_reason', '')

    def persist(self):
        if not self.store:
            return
        saved = self.store.account(self.key)
        saved.update({'label': self.label, 'windows': self.windows, 'checked': self.checked, 'limit_type': self.limit_type,
                      'cooldown': self.cooldown, 'cooldown_reason': self.cooldown_reason})
        self.store.save_soon()

    def update(self, value, stream=False):
        """Merge usage from a stream ``message_limit`` event or the REST usage endpoint.

        Stream windows report utilization as a 0..1 fraction. The REST endpoint
        reports percentages and returns null for windows without activity; a
        null never erases a window learned from traffic.
        """
        if not isinstance(value, dict):
            return
        if stream:
            limit = value.get('message_limit') if isinstance(value.get('message_limit'), dict) else value
            windows = limit.get('windows') if isinstance(limit.get('windows'), dict) else {}
            for name, w in windows.items():
                if not isinstance(w, dict) or not isinstance(w.get('utilization'), (int, float)):
                    continue
                status = str(w.get('status', ''))
                percent = float(w['utilization']) * 100
                if status in EXCEEDED:
                    percent = max(100.0, percent)
                self.windows[window_name(name)] = {'percent': max(0.0, min(100.0, percent)),
                                                   'resets_at': timestamp(w.get('resets_at', w.get('resetsAt'))),
                                                   'status': status, 'source': 'stream'}
            self.limit_type = str(limit.get('type') or self.limit_type)
            reset = timestamp(limit.get('resetsAt'))
            if self.limit_type in EXCEEDED and reset > time.time():
                self.set_cooldown(reset - time.time(), 'Usage limit reached')
        else:
            for name, w in value.items():
                if not isinstance(w, dict) or not isinstance(w.get('utilization'), (int, float)):
                    continue
                percent = float(w['utilization'])
                self.windows[window_name(name)] = {'percent': max(0.0, min(100.0, percent)),
                                                   'resets_at': timestamp(w.get('resets_at', w.get('resetsAt'))),
                                                   'status': 'exceeded' if percent >= 100 else 'within_limit', 'source': 'usage'}
        self.checked = time.time()
        self.persist()

    def current_windows(self):
        now = time.time()
        result = {}
        for name, w in self.windows.items():
            resets = w.get('resets_at') or 0
            if resets and resets <= now:
                result[name] = {**w, 'percent': 0.0, 'status': 'reset'}
            else:
                result[name] = dict(w)
        return result

    def blocked_until(self, model):
        now = time.time()
        ends = [self.cooldown]
        for name, w in self.current_windows().items():
            # Global windows apply to every model; named windows only to that family.
            if any(x in name for x in ('opus', 'sonnet', 'haiku')) and not any(x in model and x in name for x in ('opus', 'sonnet', 'haiku')):
                continue
            if w['percent'] >= 100 or w['status'] in EXCEEDED:
                ends.append(w['resets_at'] if w['resets_at'] > now else self.checked + 60)
        return max(ends)

    def set_cooldown(self, seconds, reason):
        self.cooldown = max(self.cooldown, time.time() + max(1.0, seconds))
        self.cooldown_reason = reason
        self.persist()

    def penalize(self, error):
        """Back off after an upstream rate limit: exact reset when Claude gives one, else short and growing."""
        if transient(error):
            # Burst throttles are shared by every account; prefer other accounts briefly instead.
            self.throttled_at = time.time()
            return
        self.strikes += 1
        if error.retry_after:
            seconds = float(error.retry_after)
        else:
            seconds = min(300.0, 10.0 * 2 ** (self.strikes - 1))
        self.set_cooldown(seconds, str(error)[:200] or 'Rate limited by Claude')

    def succeeded(self):
        if self.strikes or self.cooldown_reason:
            self.strikes = 0
            if self.cooldown <= time.time():
                self.cooldown_reason = ''
            self.persist()

    def peak(self, model=''):
        values = [w['percent'] for name, w in self.current_windows().items()
                  if not (any(x in name for x in ('opus', 'sonnet', 'haiku')) and not any(x in model and x in name for x in ('opus', 'sonnet', 'haiku')))]
        return max(values, default=0.0)

    def public(self):
        stats = self.store.account(self.key)['stats'] if self.store else {}
        return {'id': self.id, 'label': self.label, 'models': list(self.client.catalogue), 'windows': self.current_windows(),
                'busy': self.active > 0, 'active': self.active, 'capacity': self.capacity,
                'cooldown_until': self.cooldown, 'cooldown_reason': self.cooldown_reason if self.cooldown > time.time() else '',
                'usage_checked_at': self.checked, 'limit_type': self.limit_type, 'stats': stats}


class Pool:
    def __init__(self, factory=Claude, store=None):
        self.accounts = []
        self.lock = asyncio.Lock()
        self.changed = asyncio.Condition(self.lock)
        self.factory = factory
        self.counter = 0
        self.store = store
        self._refresh_task = None
        self.gate = StartGate()
        self.max_streams = MAX_STREAMS
        # Turns parked on a client tool result hold a slot but generate nothing upstream;
        # the bridge reports how many so they do not count against ``max_streams``.
        self.idle_streams = lambda: 0

    async def add(self, key, label):
        client = self.factory(key)
        try:
            await client.connect()
        except Exception:
            await client.close()
            raise
        async with self.lock:
            for a in self.accounts:
                if a.client.account_id == client.account_id:
                    await client.close()
                    raise APIError(409, 'This account is already connected.', 'duplicate_account')
            self.counter += 1
            a = Account('acct_' + str(self.counter), label or 'Account ' + str(self.counter), client, self.store)
            a.restore()
            self.accounts.append(a)
            self.changed.notify_all()
        try:
            a.update(await client.usage())
        except APIError:
            pass
        return a.public()

    async def remove(self, id):
        async with self.lock:
            a = next((x for x in self.accounts if x.id == id), None)
            if not a:
                raise APIError(404, 'Account not found.', 'not_found')
            if a.active:
                raise APIError(409, 'Wait for this account’s active request to finish.', 'account_busy')
            self.accounts.remove(a)
            self.changed.notify_all()
        await a.client.close()

    def get(self, id):
        return next((x for x in self.accounts if x.id == id), None)

    async def refresh(self, ids=None):
        for a in list(self.accounts):
            if ids and a.id not in ids:
                continue
            try:
                a.update(await a.client.usage())
            except APIError:
                continue

    def start_background(self):
        async def loop():
            while True:
                await asyncio.sleep(USAGE_REFRESH_SECONDS)
                try:
                    await self.refresh()
                except Exception as exc:
                    print('Background usage refresh failed:', type(exc).__name__, flush=True)
        if self._refresh_task is None:
            self._refresh_task = asyncio.create_task(loop())

    async def stop_background(self):
        if self._refresh_task:
            self._refresh_task.cancel()
            await asyncio.gather(self._refresh_task, return_exceptions=True)
            self._refresh_task = None

    def models(self):
        values = {}
        for a in self.accounts:
            values.update(a.client.catalogue)
        return values

    def _rank(self, model):
        now = time.time()
        return lambda a: (a.peak(model) >= 90, now - a.throttled_at < 30, a.active, a.peak(model))

    async def acquire(self, model, exclude=(), account_id=None):
        """Reserve capacity on the best account; wait briefly when every account is merely busy."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + ACQUIRE_WAIT_SECONDS
        async with self.changed:
            while True:
                if not self.accounts:
                    raise APIError(503, 'Connect a Claude account in the dashboard first.', 'no_accounts')
                if account_id and not any(a.id == account_id for a in self.accounts):
                    raise APIError(409, 'The Claude account for this conversation is disconnected.', 'conversation_account_unavailable')
                candidates = [a for a in self.accounts if model in a.client.catalogue and a.id not in exclude and (account_id is None or a.id == account_id)]
                if not candidates:
                    if account_id and not any(a.id == account_id and model in a.client.catalogue for a in self.accounts):
                        raise APIError(409, 'The linked Claude account no longer offers this model.', 'conversation_model_unavailable')
                    if model not in self.models():
                        raise APIError(404, 'The requested explicit model is not available.', 'model_not_found', 'model')
                    raise APIError(429, 'All available accounts have reached a limit.', 'rate_limit_exceeded', retry_after=30)
                now = time.time()
                usable = [a for a in candidates if a.blocked_until(model) <= now]
                saturated = sum(a.active for a in self.accounts) - self.idle_streams() >= self.max_streams
                ready = [] if saturated else [a for a in usable if not a.busy]
                if ready:
                    a = min(ready, key=self._rank(model))
                    a.active += 1
                    return a
                if usable:
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        raise APIError(503, 'All Claude accounts are handling other requests. Try again shortly.', 'accounts_busy', retry_after=5)
                    try:
                        await asyncio.wait_for(self.changed.wait(), remaining)
                    except asyncio.TimeoutError:
                        raise APIError(503, 'All Claude accounts are handling other requests. Try again shortly.', 'accounts_busy', retry_after=5) from None
                    continue
                waits = [a.blocked_until(model) - now for a in candidates]
                soonest = min(candidates, key=lambda a: a.blocked_until(model))
                reset = datetime.fromtimestamp(soonest.blocked_until(model), tz=timezone.utc).strftime('%H:%M UTC')
                usage_limited = any(w['percent'] >= 100 or w['status'] in EXCEEDED for a in candidates for w in a.current_windows().values())
                message = (f'Claude usage limit reached on every account for {model}. The next account frees up at {reset}.'
                           if usage_limited else f'Every account is cooling down after a Claude rate limit. The next one is ready at {reset}.')
                raise APIError(429, message, 'rate_limit_exceeded', retry_after=max(1, int(min(waits))))

    async def release(self, account):
        async with self.changed:
            account.active = max(0, account.active - 1)
            self.changed.notify_all()

    def handoff_candidates(self, model, source_id):
        now = time.time()
        return [a for a in self.accounts if a.id != source_id and model in a.client.catalogue and a.blocked_until(model) <= now]

    def unavailable(self, account_id, model):
        """Whether a linked account can no longer serve its conversation right now."""
        account = self.get(account_id)
        if account is None or model not in account.client.catalogue:
            return 'disconnected'
        if account.blocked_until(model) > time.time():
            return 'limited'
        return ''
