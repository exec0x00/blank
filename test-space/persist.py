"""Persist Claude session keys on the Space's private, mounted bucket."""

import base64
import hashlib
import json
import os
import tempfile
from pathlib import Path

from cryptography.fernet import Fernet


class KeyStore:
    def __init__(self, directory=None, password=None):
        self.directory = Path(directory or os.environ.get('KEY_BUCKET_PATH', '/data/claude-keys'))
        self.password = password or os.environ.get('PASSWORD')
        if not self.password:
            raise RuntimeError('PASSWORD secret is required')
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'accounts.json'
        self.salt_path = self.directory / 'salt'
        if not self.salt_path.exists():
            self._atomic(self.salt_path, os.urandom(32))
        salt = self.salt_path.read_bytes()
        key = hashlib.pbkdf2_hmac('sha256', self.password.encode(), salt, 600_000)
        self.cipher = Fernet(base64.urlsafe_b64encode(key))

    @staticmethod
    def _atomic(path, payload):
        fd, name = tempfile.mkstemp(dir=path.parent, prefix='.pending-')
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def load(self):
        if not self.path.exists():
            return []
        data = json.loads(self.cipher.decrypt(self.path.read_bytes()))
        if not isinstance(data, list) or any(not isinstance(x, dict) or not isinstance(x.get('key'), str) for x in data):
            raise RuntimeError('Invalid saved accounts file')
        return data

    def save(self, accounts):
        payload = json.dumps(accounts, separators=(',', ':')).encode()
        self._atomic(self.path, self.cipher.encrypt(payload))

