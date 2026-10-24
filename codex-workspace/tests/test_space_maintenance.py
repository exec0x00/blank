"""Real subprocess/HTTP checks of the Python gate before Node bootstrap."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


APP = Path(__file__).resolve().parents[1] / "app.py"
HARNESS = r'''
import importlib.util, os, pathlib, sys, types, urllib.request
spaces = types.ModuleType("spaces")
spaces.GPU = lambda **kwargs: lambda function: function
spaces.zero = types.SimpleNamespace(startup=lambda: pathlib.Path(sys.argv[2]).with_name("registration.txt").write_text("ZeroGPU registered"))
sys.modules["spaces"] = spaces
spec = importlib.util.spec_from_file_location("workspace_entrypoint", sys.argv[1])
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
original_wait = app.wait_for_maintenance_release
app.wait_for_maintenance_release = lambda data, host, port, **kwargs: original_wait(data, host, port, poll_seconds=0.025, **kwargs)
def reached_node():
    # The same public listener stays available while normal preparation begins.
    with urllib.request.urlopen("http://127.0.0.1:" + os.environ["PORT"] + "/?starting=1") as response:
        assert response.read() == b"status: ok"
    pathlib.Path(sys.argv[2]).write_text("Node bootstrap reached with the status listener available")
    raise SystemExit(0)
app.node_binary = reached_node
raise SystemExit(app.main())
'''


class MaintenanceGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="space-maintenance-test-")
        self.root = Path(self.temporary.name)
        self.data = self.root / "data"
        (self.data / "codex-workspace").mkdir(parents=True)
        self.marker = self.data / "codex-workspace/maintenance-v1.json"
        self.sentinel = self.root / "node-reached.txt"
        self.registration = self.root / "registration.txt"
        self.preserved = self.data / "preserved.txt"
        self.preserved.write_text("source, secrets and history are untouched by this gate")
        self.value = {
            "version": 1, "purpose": "one-time-space-data-reset", "space": "alvin3y12/codex-workspace",
            "nonce": "a" * 32, "entrypoint_sha256": hashlib.sha256(APP.read_bytes()).hexdigest(),
        }
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        self.url = f"http://127.0.0.1:{self.port}"
        self.process = None

    def tearDown(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
            self.process.communicate(timeout=5)
        self.temporary.cleanup()

    def start(self):
        environment = {**os.environ, "DATA_DIR": str(self.data), "HOST": "127.0.0.1", "PORT": str(self.port)}
        self.process = subprocess.Popen([sys.executable, "-c", HARNESS, str(APP), str(self.sentinel)],
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=environment)

    def receipt(self, state="waiting"):
        deadline = time.monotonic() + 6
        last = None
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                out, error = self.process.communicate()
                self.fail(f"Gate exited early: {out} {error}")
            try:
                with urlopen(self.url + "/_maintenance", timeout=0.4) as response:
                    last = json.loads(response.read())
                if last["state"] == state:
                    return last
            except (URLError, OSError):
                pass
            time.sleep(0.025)
        self.fail(f"Expected maintenance state {state}; last receipt was {last}")

    def test_no_marker_reaches_normal_startup_without_mutating_data(self):
        self.start()
        self.assertEqual(self.process.wait(timeout=5), 0)
        self.assertTrue(self.sentinel.is_file())
        self.assertEqual(self.preserved.read_text(), "source, secrets and history are untouched by this gate")
        self.assertFalse(self.marker.exists())

    def test_live_gate_holds_node_refuses_remote_mutations_and_releases_after_removal(self):
        self.marker.write_text(json.dumps(self.value))
        self.start()
        receipt = self.receipt()
        self.assertEqual(self.registration.read_text(), "ZeroGPU registered")
        self.assertEqual(receipt["nonce"], self.value["nonce"])
        self.assertEqual(receipt["entrypoint_sha256"], self.value["entrypoint_sha256"])
        self.assertEqual(receipt["process_id"], self.process.pid)
        self.assertFalse(receipt["node_started"])
        self.assertFalse(self.sentinel.exists())
        self.assertEqual(len(receipt["boot_id"]), 32)
        with urlopen(self.url + "/", timeout=1) as response:
            self.assertEqual(response.read(), b"status: ok")
        with self.assertRaises(HTTPError) as work:
            urlopen(self.url + "/work", timeout=1)
        self.assertEqual(work.exception.code, 503)
        self.assertIn(b"Workspace maintenance", work.exception.read())
        for route, status in [("/_maintenance", 405), ("/reset", 503), ("/api/auth/login", 503)]:
            with self.subTest(route=route), self.assertRaises(HTTPError) as raised:
                urlopen(Request(self.url + route, data=b"{}", method="POST"), timeout=1)
            self.assertEqual(raised.exception.code, status)
        with self.assertRaises(HTTPError) as raised:
            urlopen(self.url + "/api/workspaces", timeout=1)
        self.assertEqual(raised.exception.code, 503)
        self.assertTrue(self.marker.exists())
        self.assertFalse(self.sentinel.exists())
        self.marker.unlink()
        self.assertEqual(self.process.wait(timeout=5), 0)
        self.assertTrue(self.sentinel.exists())
        self.assertEqual(self.preserved.read_text(), "source, secrets and history are untouched by this gate")

    def test_malformed_marker_fails_closed_without_leaking_contents(self):
        self.marker.write_text('{"secret":"should-never-be-exposed", broken')
        self.start()
        receipt = self.receipt("blocked")
        self.assertIsNone(receipt["nonce"])
        self.assertIn("not valid", receipt["error"])
        self.assertNotIn("should-never-be-exposed", json.dumps(receipt))
        self.assertFalse(self.sentinel.exists())
        self.marker.unlink()
        self.assertEqual(self.process.wait(timeout=5), 0)
        out, error = self.process.communicate()
        self.assertNotIn("should-never-be-exposed", out + error)

    def test_wrong_release_hash_holds_until_corrected(self):
        self.marker.write_text(json.dumps({**self.value, "entrypoint_sha256": "0" * 64}))
        self.start()
        self.receipt("blocked")
        self.assertFalse(self.sentinel.exists())
        self.marker.write_text(json.dumps(self.value))
        receipt = self.receipt()
        self.assertEqual(receipt["nonce"], self.value["nonce"])
        self.marker.unlink()
        self.assertEqual(self.process.wait(timeout=5), 0)

    def test_disappearing_data_parent_never_counts_as_marker_release(self):
        self.marker.write_text(json.dumps(self.value))
        self.start()
        self.receipt()
        parent = self.marker.parent
        moved = self.data / "temporarily-unavailable"
        parent.rename(moved)
        receipt = self.receipt("blocked")
        self.assertIn("safely", receipt["error"])
        self.assertFalse(self.sentinel.exists())
        moved.rename(parent)
        self.receipt()
        self.marker.unlink()
        self.assertEqual(self.process.wait(timeout=5), 0)

    def test_symlink_marker_is_blocked_and_signal_never_starts_node(self):
        external = self.root / "external.json"
        external.write_text(json.dumps(self.value))
        self.marker.symlink_to(external)
        self.start()
        receipt = self.receipt("blocked")
        self.assertIn("symlinks", receipt["error"])
        self.process.terminate()
        self.assertEqual(self.process.wait(timeout=5), 143)
        self.assertFalse(self.sentinel.exists())
        self.assertEqual(json.loads(external.read_text()), self.value)


if __name__ == "__main__":
    unittest.main()
