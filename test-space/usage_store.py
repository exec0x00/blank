"""Durable account usage, request statistics, and a recent request log.

Claude reports usage windows inside every completion stream (``message_limit``).
They are recorded here as requests flow through the bridge, so the dashboard
keeps showing the latest known usage after a refresh or a Space restart without
sending an extra message.
"""

import asyncio
import collections
import json
import os
import tempfile
import time
from pathlib import Path

MAX_REQUESTS = 500
MAX_DAYS = 45


def empty_stats():
    return {'requests': 0, 'ok': 0, 'errors': 0, 'rate_limited': 0, 'input_tokens': 0, 'output_tokens': 0,
            'tool_calls': 0, 'web_searches': 0, 'attachments': 0, 'handoffs': 0, 'last_used': 0,
            'last_error': '', 'last_error_at': 0, 'by_model': {}}


class UsageStore:
    def __init__(self, directory=None):
        self.directory = Path(directory or os.environ.get('KEY_BUCKET_PATH', '/data/claude-keys'))
        self.path = self.directory / 'usage.json'
        self.accounts = {}
        self.requests = collections.deque(maxlen=MAX_REQUESTS)
        self.days = {}
        self.totals = empty_stats()
        self._dirty = False
        self._task = None
        self._load()

    def _load(self):
        try:
            data = json.loads(self.path.read_text(encoding='utf8'))
        except (OSError, ValueError):
            return
        if not isinstance(data, dict):
            return
        accounts = data.get('accounts')
        if isinstance(accounts, dict):
            self.accounts = {k: v for k, v in accounts.items() if isinstance(v, dict)}
        for item in data.get('requests') or []:
            if isinstance(item, dict):
                self.requests.append(item)
        if isinstance(data.get('days'), dict):
            self.days = data['days']
        if isinstance(data.get('totals'), dict):
            self.totals = {**empty_stats(), **data['totals']}

    def account(self, key):
        entry = self.accounts.setdefault(key, {})
        entry.setdefault('windows', {})
        entry['stats'] = {**empty_stats(), **(entry.get('stats') or {})}
        return entry

    def save_soon(self):
        self._dirty = True
        if self._task is None or self._task.done():
            try:
                self._task = asyncio.get_running_loop().create_task(self._flush_later())
            except RuntimeError:
                self.flush()

    async def _flush_later(self):
        await asyncio.sleep(1.5)
        await asyncio.to_thread(self.flush)

    def flush(self):
        if not self._dirty:
            return
        self._dirty = False
        cutoff = time.strftime('%Y-%m-%d', time.gmtime(time.time() - MAX_DAYS * 86400))
        self.days = {k: v for k, v in self.days.items() if k >= cutoff}
        payload = json.dumps({'version': 1, 'accounts': self.accounts, 'requests': list(self.requests),
                              'days': self.days, 'totals': self.totals}, separators=(',', ':')).encode()
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(dir=self.directory, prefix='.usage-')
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(payload)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(name, self.path)
            finally:
                if os.path.exists(name):
                    os.unlink(name)
        except OSError as exc:
            self._dirty = True
            print('Could not save usage:', type(exc).__name__, flush=True)

    def record(self, entry, account_key=None):
        """Add one finished request to the log and the aggregate statistics."""
        self.requests.append(entry)
        targets = [self.totals]
        if account_key:
            targets.append(self.account(account_key)['stats'])
        day = self.days.setdefault(time.strftime('%Y-%m-%d', time.gmtime(entry.get('t', time.time()))),
                                   {'requests': 0, 'errors': 0, 'input_tokens': 0, 'output_tokens': 0})
        ok = entry.get('status') == 'ok'
        for stats in targets:
            stats['requests'] += 1
            stats['ok' if ok else 'errors'] += 1
            if entry.get('http') == 429 or entry.get('rate_limited'):
                stats['rate_limited'] += 1
            for field, key in (('input_tokens', 'input_tokens'), ('output_tokens', 'output_tokens'), ('tool_calls', 'tool_calls'),
                               ('web_searches', 'web_searches'), ('attachments', 'attachments')):
                stats[field] += int(entry.get(key) or 0)
            if entry.get('handoff'):
                stats['handoffs'] += 1
            stats['last_used'] = entry.get('t', time.time())
            if not ok:
                stats['last_error'] = str(entry.get('error') or '')[:300]
                stats['last_error_at'] = entry.get('t', time.time())
            model = entry.get('model') or 'unknown'
            stats['by_model'][model] = stats['by_model'].get(model, 0) + 1
        day['requests'] += 1
        day['errors'] += 0 if ok else 1
        day['input_tokens'] += int(entry.get('input_tokens') or 0)
        day['output_tokens'] += int(entry.get('output_tokens') or 0)
        self.save_soon()
