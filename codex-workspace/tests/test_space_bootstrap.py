"""Real loopback/subprocess checks of the early status listener and FD handoff."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

APP = Path(__file__).resolve().parents[1] / "app.py"
NODE = os.environ.get("NODE_BOOTSTRAP_TEST_BINARY") or shutil.which("node")
NODE_SERVER = r'''
const fs = require('node:fs'), http = require('node:http');
const root = process.env.BOOT_TEST_ROOT;
fs.writeFileSync(root + '/node-pid', String(process.pid));
const count = Number(fs.existsSync(root + '/node-count') ? fs.readFileSync(root + '/node-count', 'utf8') : '0') + 1;
fs.writeFileSync(root + '/node-count', String(count));
fs.writeFileSync(root + '/node-threadpool', JSON.stringify(process.env.UV_THREADPOOL_SIZE ?? null));
const server = http.createServer((req, res) => {
  res.setHeader('Connection', 'close');
  res.end(req.url.split('?')[0] === '/' ? 'status: ok' : 'node-workspace');
});
const timer = setInterval(() => {
  if (!fs.existsSync(root + '/application-release')) return;
  clearInterval(timer);
  server.listen({ fd: Number(process.env.CODEX_BOOTSTRAP_LISTEN_FD) }, () => {
    fs.writeSync(Number(process.env.CODEX_BOOTSTRAP_READY_FD), 'codex-workspace-ready-v1\n');
    fs.closeSync(Number(process.env.CODEX_BOOTSTRAP_READY_FD));
  });
}, 10);
process.on('SIGTERM', () => {
  clearInterval(timer);
  if (server.listening) server.close(() => process.exit(7));
  else process.exit(7);
});
'''

MAIN_HARNESS = r'''
import importlib.util, json, os, pathlib, sys, time, types
root = pathlib.Path(sys.argv[2])
spaces = types.ModuleType("spaces")
spaces.GPU = lambda **kwargs: lambda function: function
spaces.zero = types.SimpleNamespace(startup=lambda: (root / "registered").write_text("yes"))
sys.modules["spaces"] = spaces
spec = importlib.util.spec_from_file_location("workspace_bootstrap_main", sys.argv[1])
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
app.SOURCE = root / "source"
sleep = time.sleep
def gate(name):
    (root / (name + "-entered")).write_text("yes")
    while not (root / (name + "-release")).exists():
        sleep(0.01)
def node():
    assert (root / "registered").is_file()
    gate("node")
    return pathlib.Path(os.environ["BOOT_TEST_NODE"])
app.node_binary = node
original_child = app.run_child
build_calls = 0
def child(command, directory, environment, *, bootstrap=None):
    global build_calls
    if bootstrap is None:
        assert not any(name in environment for name in app.BOOTSTRAP_FD_VARIABLES)
        assert "WORKSPACE_PASSWORD" not in environment
        assert "CUSTOM_ACCESS_TOKEN" not in environment
        (root / "build-threadpool").write_text(json.dumps(environment.get("UV_THREADPOOL_SIZE")))
        build_calls += 1
        if build_calls == 1:
            gate("build")
            return 19
        return 0
    (root / "application-entered").write_text("yes")
    return original_child([str(node_path), "-e", os.environ["BOOT_TEST_NODE_SOURCE"]], directory,
                          {**environment, "BOOT_TEST_ROOT": str(root)}, bootstrap=bootstrap)
node_path = pathlib.Path(os.environ["BOOT_TEST_NODE"])
app.run_child = child
retries = 0
def controlled_sleep(seconds):
    global retries
    if seconds >= 1:
        retries += 1
        gate("retry-" + str(retries))
    else:
        sleep(seconds)
app.time.sleep = controlled_sleep
raise SystemExit(app.main())
'''


def load_entrypoint():
    spaces = types.ModuleType("spaces")
    spaces.GPU = lambda **_kwargs: lambda function: function
    spec = importlib.util.spec_from_file_location("workspace_bootstrap_test", APP)
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, {"spaces": spaces}):
        spec.loader.exec_module(module)
    return module


def response(base, path="/", method="GET", headers=None):
    request = Request(base + path, method=method, headers=headers or {})
    try:
        result = urlopen(request, timeout=1.5)
    except HTTPError as error:
        result = error
    with result:
        return result.status, dict(result.headers), result.read()


def until(predicate, seconds=6):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("The owned bootstrap fixture did not reach its expected state.")


class BootstrapListenerTests(unittest.TestCase):
    def setUp(self):
        self.app = load_entrypoint()
        self.temporary = tempfile.TemporaryDirectory(prefix="codex-bootstrap-status-test-")
        self.root = Path(self.temporary.name)
        self.server = self.app.BootstrapServer("127.0.0.1", 0)
        self.base = "http://127.0.0.1:" + str(self.server.server.server_address[1])
        self.runner = None
        self.result = []

    def tearDown(self):
        process = self.app.ACTIVE_PROCESS
        if process is not None and process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
        if self.runner is not None:
            self.runner.join(timeout=5)
            self.assertFalse(self.runner.is_alive())
        self.server.close()
        self.temporary.cleanup()

    def start_node(self, code=NODE_SERVER):
        self.assertTrue(NODE, "An installed Node binary is needed for socket handoff proof.")
        self.runner = threading.Thread(target=lambda: self.result.append(self.app.run_child(
            [NODE, "-e", code], self.root, {"PATH": os.environ.get("PATH", ""), "BOOT_TEST_ROOT": str(self.root)},
            bootstrap=self.server)))
        self.runner.start()

    def test_root_is_exact_and_work_health_api_upgrade_are_honestly_unavailable(self):
        for route in ["/", "/?workspace=anything", "/?check=1&next=%2Fwork"]:
            status, headers, body = response(self.base, route)
            self.assertEqual((status, body), (200, b"status: ok"))
            self.assertEqual(headers["Content-Type"], "text/plain; charset=utf-8")
            self.assertEqual(headers["Cache-Control"], "no-store")
            status, headers, body = response(self.base, route, "HEAD")
            self.assertEqual((status, body), (200, b""))
            self.assertEqual(headers["Content-Length"], "10")
        status, headers, body = response(self.base, "/work?workspace=retained")
        self.assertEqual(status, 503)
        self.assertIn(b"http-equiv=refresh", body)
        self.assertIn(b"Starting Arc Workspace", body)
        for route, method in [("/health", "GET"), ("/api/session", "GET"), ("/api/session", "POST"),
                              ("/ws/terminal", "GET")]:
            status, headers, body = response(self.base, route, method, {"Upgrade": "websocket", "Connection": "Upgrade"})
            self.assertEqual(status, 503)
            self.assertNotIn("Set-Cookie", headers)
        self.server.set_phase("failed")
        self.assertEqual(response(self.base)[2], b"status: ok")
        self.assertIn(b"Workspace startup failed", response(self.base, "/work")[2])
        self.assertEqual(response(self.base, "/health")[0], 503)

    def test_same_listener_has_no_rebind_gap_during_delayed_node_handoff_and_exit(self):
        listener = self.server.listener_fd
        identity = os.fstat(listener)
        failures, observations = [], []
        stop = threading.Event()
        def probe():
            while not stop.is_set():
                try:
                    observations.append(response(self.base, "/?continuous=1"))
                except Exception as error:
                    failures.append(type(error).__name__)
                stop.wait(0.005)
        polling = threading.Thread(target=probe)
        polling.start()
        try:
            self.start_node()
            until(lambda: (self.root / "node-pid").exists())
            self.assertEqual(response(self.base, "/work")[0], 503)
            (self.root / "application-release").write_text("ready")
            until(lambda: self.server.worker is None)
            self.assertEqual(response(self.base, "/work")[2], b"node-workspace")
            time.sleep(0.15)
            self.assertEqual((self.root / "node-count").read_text(), "1")
            os.killpg(self.app.ACTIVE_PROCESS.pid, signal.SIGTERM)
            self.runner.join(timeout=5)
            self.assertEqual(self.result, [7])
            self.assertEqual(response(self.base)[2], b"status: ok")
            self.assertEqual(response(self.base, "/work")[0], 503)
            self.assertIsNotNone(self.server.worker)
            current = os.fstat(listener)
            self.assertEqual((current.st_dev, current.st_ino), (identity.st_dev, identity.st_ino))
        finally:
            stop.set()
            polling.join(timeout=3)
        self.assertEqual(failures, [])
        self.assertGreater(len(observations), 10)
        self.assertTrue(all(status == 200 and body == b"status: ok" for status, _headers, body in observations))

    def test_invalid_readiness_never_hands_off_and_stops_only_the_failed_child(self):
        self.start_node("require('node:fs').writeSync(Number(process.env.CODEX_BOOTSTRAP_READY_FD), 'wrong-ready\\n'); setInterval(() => {}, 100);")
        self.runner.join(timeout=5)
        self.assertFalse(self.runner.is_alive())
        self.assertNotEqual(self.result[0], 0)
        self.assertIsNotNone(self.server.worker)
        self.assertEqual(response(self.base)[2], b"status: ok")
        self.assertIn(b"Workspace startup failed", response(self.base, "/work")[2])

    def test_spawn_failure_keeps_status_available_and_closes_the_private_pipe(self):
        before = set(os.listdir("/proc/self/fd"))
        with self.assertRaises(FileNotFoundError):
            self.app.run_child([str(self.root / "missing-executable")], self.root, {}, bootstrap=self.server)
        self.assertEqual(set(os.listdir("/proc/self/fd")), before)
        self.assertIsNone(self.app.ACTIVE_PROCESS)
        self.assertEqual(response(self.base)[2], b"status: ok")
        self.assertEqual(response(self.base, "/work")[0], 503)

    def test_signal_between_spawn_and_assignment_reaches_the_exact_new_child(self):
        original = subprocess.Popen
        def interrupted_spawn(*args, **kwargs):
            process = original(*args, **kwargs)
            self.app.forward_signal(signal.SIGTERM, None)
            return process
        with mock.patch.object(self.app.subprocess, "Popen", side_effect=interrupted_spawn):
            result = self.app.run_child([sys.executable, "-c", "import time; time.sleep(20)"],
                                        self.root, {}, bootstrap=self.server)
        self.assertNotEqual(result, 0)
        self.assertEqual(self.app.STOP_SIGNAL, signal.SIGTERM)
        self.assertIsNone(self.app.ACTIVE_PROCESS)
        self.assertEqual(response(self.base)[2], b"status: ok")

    def test_real_application_adopts_the_python_listener_and_preserves_authentication(self):
        source = APP.parent
        environment = {
            "PATH": os.environ.get("PATH", ""), "NODE_ENV": "test", "CODEX_CLI_TEST_START": "0",
            "HOST": "127.0.0.1", "PORT": str(self.server.server.server_address[1]),
            "DATA_DIR": str(self.root / "data"), "RUNTIME_DIR": str(self.root / "runtime"),
            "CLIENT_DIST_DIR": str(source / "dist" / "client"), "REQUIRE_PERSISTENT_DATA": "0",
            "WORKSPACE_PASSWORD": "bootstrap-owned-fixture-password",
            "SESSION_SECRET": "bootstrap-owned-fixture-session-secret-12345",
            "ENCRYPTION_KEY": "bootstrap-owned-fixture-credential-key-12345",
        }
        command = [NODE, "--import", str(source / "node_modules" / "tsx" / "dist" / "loader.mjs"),
                   str(source / "server" / "index.ts")]
        self.runner = threading.Thread(target=lambda: self.result.append(
            self.app.run_child(command, source, environment, bootstrap=self.server)))
        self.runner.start()
        reads = 0
        deadline = time.monotonic() + 15
        while self.server.worker is not None and time.monotonic() < deadline:
            self.assertEqual(response(self.base, "/?real-node-starting=1")[2], b"status: ok")
            reads += 1
            time.sleep(0.01)
        self.assertIsNone(self.server.worker, "The real Node application did not confirm listener adoption.")
        self.assertGreater(reads, 0)
        self.assertEqual(response(self.base, "/health")[0], 200)
        self.assertEqual(response(self.base, "/work")[0], 200)
        self.assertEqual(response(self.base, "/api/bootstrap")[0], 401)
        request = Request(self.base + "/api/session", method="POST",
                          data=json.dumps({"password": environment["WORKSPACE_PASSWORD"]}).encode(),
                          headers={"Content-Type": "application/json", "X-Codex-Workspace": "1"})
        with urlopen(request, timeout=3) as logged_in:
            self.assertEqual(json.loads(logged_in.read()), {"authenticated": True})
            cookie = logged_in.headers["Set-Cookie"].split(";", 1)[0]
        status, _headers, body = response(self.base, "/api/bootstrap", headers={"Cookie": cookie})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["storage"]["path"], str(self.root / "data"))
        os.killpg(self.app.ACTIVE_PROCESS.pid, signal.SIGTERM)
        self.runner.join(timeout=5)
        self.assertEqual(self.result, [0])
        self.assertEqual(response(self.base)[2], b"status: ok")
        self.assertEqual(response(self.base, "/health")[0], 503)

    def test_build_children_receive_neither_private_descriptors_nor_credential_aliases(self):
        identity = os.fstat(self.server.listener_fd)
        saved = self.root / "child.json"
        environment = self.app.build_environment({
            "PATH": os.environ.get("PATH", ""), "WORKSPACE_PASSWORD": "not-a-real-password",
            "CUSTOM_ACCESS_TOKEN": "not-a-real-token", "ENCRYPTION_KEY": "not-a-real-key",
            "HF_TOKEN": "not-a-real-token", "LANG": "C.UTF-8",
            "CODEX_BOOTSTRAP_LISTEN_FD": "999", "CODEX_BOOTSTRAP_READY_FD": "998",
        }, self.root)
        script = r'''
import json, os, sys
try:
    value = os.fstat(int(sys.argv[2]))
    inherited = (value.st_dev, value.st_ino) == (int(sys.argv[3]), int(sys.argv[4]))
except OSError:
    inherited = False
with open(sys.argv[1], "w") as stream:
    json.dump({"inherited": inherited, "names": sorted(os.environ)}, stream)
'''
        self.assertEqual(self.app.run_child([sys.executable, "-c", script, str(saved), str(self.server.listener_fd),
                                            str(identity.st_dev), str(identity.st_ino)], self.root, environment), 0)
        observed = json.loads(saved.read_text())
        self.assertFalse(observed["inherited"])
        for name in ["WORKSPACE_PASSWORD", "CUSTOM_ACCESS_TOKEN", "ENCRYPTION_KEY", "HF_TOKEN",
                     *self.app.BOOTSTRAP_FD_VARIABLES]:
            self.assertNotIn(name, observed["names"])
        self.assertIn("LANG", observed["names"])
        self.assertEqual(response(self.base)[2], b"status: ok")

    def test_idle_connections_are_bounded_and_close_releases_all_owned_connections(self):
        connections = [socket.create_connection(self.server.server.server_address, timeout=1) for _ in range(28)]
        try:
            until(lambda: len(self.server.server.connections) >= 20)
            self.assertLessEqual(len(self.server.server.connections), 24)
            descriptor = self.server.listener_fd
            started = time.monotonic()
            self.server.close()
            self.assertLess(time.monotonic() - started, 2)
            self.assertEqual(self.server.server.connections, set())
            with self.assertRaises(OSError):
                os.fstat(descriptor)
        finally:
            for connection in connections:
                connection.close()


class BootstrapMainTests(unittest.TestCase):
    def test_root_survives_slow_prepare_failed_build_delayed_handoff_exit_retry_and_sigterm(self):
        self.check_startup(None)

    def test_runtime_pool_respects_an_explicit_operator_value(self):
        self.check_startup("6")

    def check_startup(self, configured_pool):
        self.assertTrue(NODE)
        with tempfile.TemporaryDirectory(prefix="codex-bootstrap-main-test-") as temporary:
            root = Path(temporary)
            (root / "source").mkdir()
            (root / "source" / "README.md").write_text("An owned source fixture.")
            (root / "data").mkdir()
            preserved = root / "data" / "preserved.txt"
            preserved.write_text("Retained workspace bytes")
            with socket.socket() as reserved:
                reserved.bind(("127.0.0.1", 0))
                port = reserved.getsockname()[1]
            base = "http://127.0.0.1:" + str(port)
            environment = {"PATH": os.environ.get("PATH", ""), "HOST": "127.0.0.1", "PORT": str(port),
                           "DATA_DIR": str(root / "data"), "BOOT_TEST_NODE": NODE, "BOOT_TEST_NODE_SOURCE": NODE_SERVER,
                           "WORKSPACE_PASSWORD": "fixture-private-value", "CUSTOM_ACCESS_TOKEN": "fixture-private-value"}
            if configured_pool is not None:
                environment["UV_THREADPOOL_SIZE"] = configured_pool
            process = subprocess.Popen([sys.executable, "-c", MAIN_HARNESS, str(APP), str(root)],
                                       env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            failures, samples = [], []
            stop = threading.Event()
            def probe():
                while not stop.is_set():
                    try:
                        samples.append(response(base, "/?during=startup"))
                    except Exception as error:
                        failures.append(type(error).__name__)
                    stop.wait(0.005)
            polling = None
            try:
                until(lambda: (root / "node-entered").exists())
                self.assertTrue((root / "registered").exists())
                polling = threading.Thread(target=probe)
                polling.start()
                self.assertEqual(response(base)[2], b"status: ok")
                self.assertEqual(response(base, "/work")[0], 503)
                (root / "node-release").write_text("continue")
                until(lambda: (root / "build-entered").exists())
                self.assertEqual(response(base, "/health")[0], 503)
                (root / "build-release").write_text("fail this owned build")
                until(lambda: (root / "retry-1-entered").exists())
                self.assertIn(b"Workspace startup failed", response(base, "/work")[2])
                self.assertEqual(response(base)[2], b"status: ok")
                (root / "retry-1-release").write_text("retry")
                until(lambda: (root / "application-entered").exists())
                self.assertEqual(response(base, "/api/session")[0], 503)
                (root / "application-release").write_text("ready")
                until(lambda: response(base, "/work")[2] == b"node-workspace")
                self.assertEqual(json.loads((root / "node-threadpool").read_text()), configured_pool or "16")
                self.assertEqual(json.loads((root / "build-threadpool").read_text()), configured_pool)
                first_pid = int((root / "node-pid").read_text())
                time.sleep(0.15)
                self.assertEqual((root / "node-count").read_text(), "1")
                os.kill(first_pid, signal.SIGTERM)
                until(lambda: (root / "retry-2-entered").exists())
                self.assertIn(b"Workspace startup failed", response(base, "/work")[2])
                self.assertEqual(response(base)[2], b"status: ok")
                (root / "retry-2-release").write_text("restart only the exited child")
                until(lambda: (root / "node-count").read_text() == "2")
                until(lambda: response(base, "/work")[2] == b"node-workspace")
                stop.set()
                polling.join(timeout=3)
                process.terminate()
                self.assertEqual(process.wait(timeout=5), 143)
                out, error = process.communicate(timeout=2)
                self.assertNotIn("fixture-private-value", out + error)
                self.assertEqual(preserved.read_text(), "Retained workspace bytes")
                self.assertEqual(failures, [])
                self.assertGreater(len(samples), 10)
                self.assertTrue(all(status == 200 and body == b"status: ok" for status, _headers, body in samples))
            finally:
                stop.set()
                if polling is not None:
                    polling.join(timeout=3)
                if process.poll() is None:
                    process.terminate()
                process.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
