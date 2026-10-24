"""Minimal ZeroGPU entry point; the actual workspace runs in Node.js.

Matches the empty GPU registration pattern in alvin3y10/exec. It neither serves
a Gradio interface nor allocates a GPU for editor/terminal/model operations.
Hugging Face supplies /data through its native bucket attachment.
"""

from __future__ import annotations

import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import platform
import re
import select
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
from uuid import uuid4

import spaces

from scripts.release_build import restore_release_build


@spaces.GPU(duration=1)
def _zerogpu_ready() -> bool:
    """Register the Space with ZeroGPU; the workspace never calls this function."""
    return True


SOURCE = Path(__file__).resolve().parent
NODE_VERSION = "22.23.2"
NODE_SHA256 = {
    "x64": "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307",
    "arm64": "fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8",
}
ACTIVE_PROCESS: subprocess.Popen | None = None
SPAWNING_PROCESS = False
STOP_SIGNAL: int | None = None
STOP_DEADLINE: float | None = None
FORWARDED_STOP_PID: int | None = None
SHUTDOWN_GRACE_SECONDS = 120
BOOTSTRAP_READY = b"codex-workspace-ready-v1\n"
BOOTSTRAP_FD_VARIABLES = ("CODEX_BOOTSTRAP_LISTEN_FD", "CODEX_BOOTSTRAP_READY_FD")
MAINTENANCE_MARKER = Path("codex-workspace/maintenance-v1.json")
MAINTENANCE_PURPOSE = "one-time-space-data-reset"
SPACE_ID = "alvin3y12/codex-workspace"


class BoundedBootstrapHTTPServer(ThreadingHTTPServer):
    """Small startup responses only; never a proxy for the application."""

    daemon_threads = True
    block_on_close = False
    request_queue_size = 64

    def __init__(self, address, handler):
        self.slots = threading.BoundedSemaphore(24)
        self.connections = set()
        self.connections_changed = threading.Condition()
        if ":" in address[0]:
            self.address_family = socket.AF_INET6
        super().__init__(address, handler)
        # Node's accept loop briefly shares this socket during handoff. Another
        # acceptor must never leave Python blocked after winning the same event.
        self.socket.setblocking(False)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        with self.connections_changed:
            self.connections.add(request)
        try:
            super().process_request(request, address)
        except BaseException:
            self.finished_request(request)
            raise

    def finished_request(self, request):
        with self.connections_changed:
            self.connections.discard(request)
            self.connections_changed.notify_all()
        self.slots.release()

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.finished_request(request)

    def handle_error(self, _request, _address):
        # Do not put arbitrary request lines, cookies or exception text in logs.
        pass

    def close_connections(self):
        with self.connections_changed:
            connections = tuple(self.connections)
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
        with self.connections_changed:
            self.connections_changed.wait_for(lambda: not self.connections, timeout=4)


class BootstrapServer:
    """Own the public listener across preparation, Node handoff and failures."""

    phases = {
        "starting": ("Starting Arc Workspace", "The workspace is starting. This page refreshes automatically."),
        "preparing": ("Starting Arc Workspace", "The application is being prepared. This page refreshes automatically."),
        "building": ("Starting Arc Workspace", "The application is being built. This page refreshes automatically."),
        "launching": ("Starting Arc Workspace", "Saved workspace state is being opened. This page refreshes automatically."),
        "failed": ("Workspace startup failed", "The workspace could not start. Startup will retry shortly."),
        "maintenance": ("Workspace maintenance", "Startup is waiting for maintenance to finish. This page refreshes automatically."),
        "stopping": ("Workspace is stopping", "The workspace is shutting down. This page refreshes automatically."),
    }

    def __init__(self, host: str, port: int):
        self.lock = threading.Lock()
        self.phase = "starting"
        self.receipt: dict | None = None
        self.worker: threading.Thread | None = None
        self.closed = False
        bootstrap = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "ArcBootstrap/1"
            sys_version = ""

            def setup(self):
                super().setup()
                self.connection.settimeout(3)

            def log_message(self, _format, *args):
                pass

            def respond(self, *, head=False):
                route = self.path.split("?", 1)[0]
                with bootstrap.lock:
                    phase = bootstrap.phase
                    receipt = dict(bootstrap.receipt) if bootstrap.receipt is not None else None
                content_type = "application/json; charset=utf-8"
                if self.command not in ("GET", "HEAD"):
                    status = 405 if route == "/_maintenance" else 503
                    body = b'{"error":"The workspace is not ready.","code":"WORKSPACE_STARTING"}'
                elif route == "/":
                    status, body = 200, b"status: ok"
                    content_type = "text/plain; charset=utf-8"
                elif route == "/_maintenance" and receipt is not None:
                    status, body = 200, json.dumps(receipt, sort_keys=True).encode("utf-8")
                elif route in ("/work", "/work/"):
                    title, message = bootstrap.phases[phase]
                    status = 503
                    content_type = "text/html; charset=utf-8"
                    body = ("<!doctype html><html lang=en><head><meta charset=utf-8>"
                            "<meta name=viewport content='width=device-width,initial-scale=1'>"
                            "<meta name=color-scheme content=dark><meta http-equiv=refresh content=3>"
                            "<title>" + title + "</title><style>"
                            "*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100dvh;"
                            "display:grid;place-items:center;padding:24px;background:#000;color:#ececec;"
                            "font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}"
                            ".arc-opening-boot{display:flex;flex-direction:column;align-items:center;gap:36px;width:min(100%,320px);min-width:0}"
                            ".arc-opening-boot>svg{flex:0 0 auto}.arc-opening-track{width:144px;max-width:100%;height:3px;"
                            "overflow:hidden;border-radius:3px;background:#232323}.arc-opening-track>span{display:block;width:42%;"
                            "height:100%;border-radius:inherit;background:#d7d7d7;transform:translateX(-105%);animation:arc-boot-progress 1.8s ease-in-out infinite}"
                            ".arc-opening-accessible{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;"
                            "clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0}"
                            ".arc-opening-error{min-width:0;text-align:center}.arc-opening-error h1{margin:0;font-size:14px;line-height:22px;font-weight:500}"
                            ".arc-opening-error p{margin:8px 0 0;color:#a3a3a3;font-size:13px;line-height:20px;overflow-wrap:anywhere}"
                            ".arc-opening-retry{display:inline-flex;align-items:center;justify-content:center;min-height:32px;margin-top:-20px;"
                            "padding:4px 12px;border:1px solid #424242;border-radius:8px;color:#ececec;background:#191919;font-size:13px;line-height:20px;text-decoration:none}"
                            ".arc-opening-retry:hover{background:#232323}.arc-opening-retry:focus-visible{outline:2px solid #9e9e9e;outline-offset:3px}"
                            "@keyframes arc-boot-progress{from{transform:translateX(-105%)}to{transform:translateX(245%)}}"
                            "@media(max-width:679px),(pointer:coarse){.arc-opening-retry{min-height:44px}}"
                            "@media(prefers-reduced-motion:reduce){.arc-opening-track>span{animation:none;transform:translateX(69%)}}"
                            "</style></head><body data-phase='" + phase + "'>"
                            "<main class=arc-opening-boot aria-busy='" + ("false" if phase == "failed" else "true") + "'>"
                            "<svg width=56 height=56 viewBox='0 0 32 32' fill=none stroke=currentColor stroke-width=3.2 stroke-linecap=square role=img aria-label='Arc Workspace'>"
                            "<path d='M27 16A11 11 0 1 0 16 27'/><path d='M21 16A5 5 0 1 0 16 21'/></svg>"
                            + ("<div class=arc-opening-error role=alert><h1>" + title + "</h1><p>" + message + "</p></div>"
                               "<a class=arc-opening-retry href=''>Try again</a>" if phase == "failed" else
                               "<div class=arc-opening-track aria-hidden=true><span></span></div>")
                            + "</main>" + ("" if phase == "failed" else "<p class=arc-opening-accessible role=status aria-live=polite>" + title + ". " + message + "</p>")
                            + "</body></html>").encode("utf-8")
                else:
                    status = 503
                    body = json.dumps({"status": phase, "ready": False,
                                       "error": "The workspace is not ready.", "code": "WORKSPACE_STARTING"}).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self' https://huggingface.co https://*.huggingface.co; base-uri 'none'; form-action 'none'")
                self.send_header("Connection", "close")
                if status == 405:
                    self.send_header("Allow", "GET, HEAD")
                if status == 503:
                    self.send_header("Retry-After", "3")
                self.end_headers()
                if not head:
                    self.wfile.write(body)

            def do_GET(self):
                self.respond()

            def do_HEAD(self):
                self.respond(head=True)

            do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_CONNECT = do_TRACE = do_GET

        self.server = BoundedBootstrapHTTPServer((host, port), Handler)
        self.resume()

    @property
    def listener_fd(self) -> int:
        return self.server.fileno()

    def set_phase(self, phase: str):
        if phase not in self.phases:
            raise ValueError("Unknown workspace startup phase.")
        with self.lock:
            self.phase = phase

    def set_receipt(self, receipt: dict | None):
        with self.lock:
            self.receipt = dict(receipt) if receipt is not None else None
            self.phase = "maintenance" if receipt is not None else "starting"

    def pause(self):
        # Keep the socket open: Node inherited the same kernel listener.
        if self.worker is not None:
            self.server.shutdown()
            self.worker.join(timeout=2)
            self.worker = None

    def resume(self):
        if self.closed:
            raise RuntimeError("The bootstrap listener is closed.")
        if self.worker is None:
            self.worker = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
            self.worker.start()

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.pause()
        self.server.close_connections()
        self.server.server_close()


def maintenance_marker(data_dir: Path, entrypoint_sha256: str) -> dict | None:
    """Read only the explicit operator marker; never touch application data."""
    path = data_dir / MAINTENANCE_MARKER
    for ancestor in [data_dir, path.parent, path]:
        try:
            info = ancestor.lstat()
        except FileNotFoundError:
            return None
        if stat.S_ISLNK(info.st_mode):
            raise ValueError("Maintenance marker and its parents must not be symlinks.")
        if ancestor != path and not stat.S_ISDIR(info.st_mode):
            raise ValueError("Maintenance marker parent is not a directory.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Maintenance marker must be a regular JSON file.")
        raw = stream.read(4097)
    if len(raw) > 4096:
        raise ValueError("Maintenance marker exceeds 4096 bytes.")
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise ValueError("Maintenance marker is not valid UTF-8 JSON.") from error
    if (not isinstance(value, dict)
        or set(value) != {"version", "purpose", "space", "nonce", "entrypoint_sha256"}
        or type(value.get("version")) is not int or value["version"] != 1
        or value.get("purpose") != MAINTENANCE_PURPOSE
        or value.get("space") != SPACE_ID
        or not isinstance(value.get("nonce"), str)
        or not re.fullmatch(r"[a-f0-9]{32,128}", value["nonce"])
        or value.get("entrypoint_sha256") != entrypoint_sha256):
        raise ValueError("Maintenance marker schema, Space, nonce or entrypoint SHA-256 is invalid.")
    return value


def wait_for_maintenance_release(
    data_dir: Path, host: str, port: int, *, poll_seconds: float = 1.0,
    bootstrap: BootstrapServer | None = None,
) -> None:
    """Hold before Node/build startup until the operator removes the marker.

    The receipt proves this entrypoint is running without a Node child. It is
    public, contains no credentials, and grants no reset/login/release ability.
    Only the bucket marker controls this gate; there are no remote write calls.
    """
    entrypoint_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    gate_active = False

    def observe() -> tuple[dict | None, str | None]:
        try:
            if gate_active:
                # A missing mount/parent is not an operator removing just the
                # marker. Keep holding if either previously present root goes.
                for parent in (data_dir, data_dir / MAINTENANCE_MARKER.parent):
                    if not stat.S_ISDIR(parent.lstat().st_mode):
                        raise ValueError("Maintenance data directory is unavailable.")
            return maintenance_marker(data_dir, entrypoint_sha256), None
        except (OSError, ValueError) as error:
            # Do not print raw marker bytes or arbitrary path/OS error text.
            message = str(error) if isinstance(error, ValueError) else "Maintenance marker cannot be read safely."
            return None, message

    marker, error = observe()
    if marker is None and error is None:
        return  # Normal startup/restart has no reset or maintenance behavior.
    gate_active = True

    boot_id = uuid4().hex
    receipt = {
        "version": 1, "purpose": MAINTENANCE_PURPOSE, "space": SPACE_ID,
        "entrypoint_sha256": entrypoint_sha256, "boot_id": boot_id,
        "process_id": os.getpid(), "node_started": False,
    }

    def update_receipt(value: dict | None, problem: str | None, absent: bool = False) -> None:
        receipt.update(
            state="blocked" if problem else "releasing" if absent else "waiting",
            nonce=value["nonce"] if value else None, error=problem,
        )
        if bootstrap is not None:
            bootstrap.set_receipt(receipt)

    update_receipt(marker, error)

    owned_bootstrap = bootstrap is None
    if bootstrap is None:
        bootstrap = BootstrapServer(host, port)
    bootstrap.set_receipt(receipt)
    print("Explicit maintenance marker detected; Node startup is held. Receipt: /_maintenance", flush=True)
    last_error = None
    missing_observations = 0
    try:
        while True:
            if error and error != last_error:
                print(f"Maintenance gate is closed: {error}", file=sys.stderr, flush=True)
            last_error = error
            if marker is None and error is None:
                missing_observations += 1
                update_receipt(None, None, absent=True)
                # Native bucket mounts can cache metadata. Require repeated
                # missing observations; a read failure never releases the gate.
                if missing_observations >= 3:
                    break
            else:
                missing_observations = 0
                update_receipt(marker, error)
            time.sleep(poll_seconds)
            marker, error = observe()
    finally:
        bootstrap.set_receipt(None)
        if owned_bootstrap:
            bootstrap.close()
    print("Maintenance marker removed; starting the workspace.", flush=True)


def forward_signal(signum: int, _frame: object) -> None:
    global STOP_SIGNAL, STOP_DEADLINE
    if STOP_SIGNAL is None:
        STOP_SIGNAL = signum
        STOP_DEADLINE = time.monotonic() + SHUTDOWN_GRACE_SECONDS
    if ACTIVE_PROCESS is not None and ACTIVE_PROCESS.poll() is None:
        forward_stop_to_child(ACTIVE_PROCESS)
    elif not SPAWNING_PROCESS:
        raise SystemExit(128 + signum)


def forward_stop_to_child(process: subprocess.Popen) -> None:
    global FORWARDED_STOP_PID
    if STOP_SIGNAL is None or FORWARDED_STOP_PID == process.pid:
        return
    try:
        os.killpg(process.pid, STOP_SIGNAL)
    except ProcessLookupError:
        pass
    FORWARDED_STOP_PID = process.pid


def direct_environment() -> dict[str, str]:
    # Provider/agent networking and bootstrap downloads must remain direct.
    return {key: value for key, value in os.environ.items() if key.lower() not in {
        "http_proxy", "https_proxy", "all_proxy", "ftp_proxy", "no_proxy",
        "npm_config_proxy", "npm_config_https_proxy",
        *(name.lower() for name in BOOTSTRAP_FD_VARIABLES),
    }}


def build_environment(environment: dict[str, str], working: Path) -> dict[str, str]:
    # Public source/dependency builds need no account or application credentials.
    # Keep ordinary tool/locale/resource settings while removing credential
    # aliases as well as the private activation capability names.
    sensitive = re.compile(r"password|secret|token|credential|(?:^|_)key(?:_|$)|(?:^|_)auth(?:_|$)", re.I)
    result = {key: value for key, value in environment.items()
              if not sensitive.search(key) and not key.upper().startswith("VITE_")
              and key not in BOOTSTRAP_FD_VARIABLES}
    result["NODE_ENV"] = "production"
    result["npm_config_cache"] = str(working / ".npm-cache")
    result["npm_config_python"] = sys.executable
    return result


def prepare_application(working: Path, npm: str, environment: dict[str, str], bootstrap: BootstrapServer) -> int:
    """Use verified portable assets; host dependencies/bindings remain local."""
    bootstrap.set_phase("preparing")
    result = run_child([npm, "ci", "--include=dev", "--no-audit", "--no-fund"], working, environment)
    if STOP_SIGNAL is not None or result != 0:
        return result
    if restore_release_build(working):
        print("Verified prebuilt application assets match this source; compiling only the host native binding.", flush=True)
        command = [npm, "run", "build:native"]
    else:
        bootstrap.set_phase("building")
        print("No matching prebuilt application assets are available; building the application from source.", flush=True)
        command = [npm, "run", "build"]
    return run_child(command, working, environment)


def node_binary() -> Path:
    existing = shutil.which("node")
    if existing:
        result = subprocess.run([existing, "--version"], capture_output=True, text=True, timeout=10)
        match = re.fullmatch(r"v22\.(\d+)\.\d+\s*", result.stdout)
        if result.returncode == 0 and match and int(match.group(1)) >= 12:
            return Path(existing)

    architecture = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine().lower())
    if architecture not in NODE_SHA256 or sys.platform != "linux":
        raise RuntimeError("The ZeroGPU entry point requires Linux x64 or arm64.")
    archive_name = f"node-v{NODE_VERSION}-linux-{architecture}"
    cache = Path(tempfile.gettempdir()) / "codex-workspace-node"
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = cache / archive_name
    executable = destination / "bin" / "node"
    if executable.is_file():
        return executable

    print(f"Preparing Node.js {NODE_VERSION} from the official distribution.", flush=True)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with tempfile.TemporaryDirectory(prefix="download-", dir=cache) as temporary:
        temporary_path = Path(temporary)
        archive = temporary_path / f"{archive_name}.tar.xz"
        digest = hashlib.sha256()
        downloaded = 0
        address = f"https://nodejs.org/dist/v{NODE_VERSION}/{archive_name}.tar.xz"
        with opener.open(address, timeout=60) as response, archive.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                downloaded += len(chunk)
                if downloaded > 80 * 1024 * 1024:
                    raise RuntimeError("Node.js download exceeded its expected size.")
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != NODE_SHA256[architecture]:
            raise RuntimeError("The official Node.js archive failed checksum verification.")
        with tarfile.open(archive, "r:xz") as bundle:
            bundle.extractall(temporary_path, filter="data")
        (temporary_path / archive_name).rename(destination)
    return executable


def run_child(command: list[str], directory: Path, environment: dict[str, str], *,
              bootstrap: BootstrapServer | None = None) -> int:
    global ACTIVE_PROCESS, SPAWNING_PROCESS, FORWARDED_STOP_PID
    if STOP_SIGNAL is not None:
        return 128 + STOP_SIGNAL
    if ACTIVE_PROCESS is not None:
        raise RuntimeError("A workspace startup child is already running.")
    child_environment = {key: value for key, value in environment.items() if key not in BOOTSTRAP_FD_VARIABLES}
    ready_read = ready_write = None
    inherited: tuple[int, ...] = ()
    process = None
    try:
        if bootstrap is not None:
            ready_read, ready_write = os.pipe2(os.O_CLOEXEC | os.O_NONBLOCK)
            inherited = (bootstrap.listener_fd, ready_write)
            child_environment[BOOTSTRAP_FD_VARIABLES[0]] = str(bootstrap.listener_fd)
            child_environment[BOOTSTRAP_FD_VARIABLES[1]] = str(ready_write)
        # A signal arriving between Popen and assignment must not orphan a new
        # session. The handler records it, and this exact child then receives it.
        SPAWNING_PROCESS = True
        FORWARDED_STOP_PID = None
        try:
            process = subprocess.Popen(command, cwd=directory, env=child_environment,
                                       start_new_session=True, close_fds=True, pass_fds=inherited)
            ACTIVE_PROCESS = process
        finally:
            SPAWNING_PROCESS = False
        forward_stop_to_child(process)
        if ready_write is not None:
            closing_write = ready_write
            ready_write = None
            os.close(closing_write)
        readiness = bytearray()
        bad_readiness_deadline = None
        while True:
            result = process.poll()
            if result is not None:
                return result
            if STOP_SIGNAL is not None and ready_read is not None:
                closing_read = ready_read
                ready_read = None
                os.close(closing_read)
            if ready_read is not None and select.select([ready_read], [], [], 0.05)[0]:
                chunk = os.read(ready_read, len(BOOTSTRAP_READY) + 1)
                readiness.extend(chunk)
                if not chunk or not BOOTSTRAP_READY.startswith(readiness):
                    print("Workspace startup readiness could not be confirmed.", file=sys.stderr, flush=True)
                    bad_readiness_deadline = time.monotonic() + SHUTDOWN_GRACE_SECONDS
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    closing_read = ready_read
                    ready_read = None
                    os.close(closing_read)
                    bootstrap.set_phase("failed")
                elif readiness == BOOTSTRAP_READY:
                    if STOP_SIGNAL is None and process.poll() is None:
                        bootstrap.pause()
                    closing_read = ready_read
                    ready_read = None
                    os.close(closing_read)
            elif ready_read is None:
                time.sleep(0.05)
            if STOP_SIGNAL is not None:
                forward_stop_to_child(process)
                if bootstrap is not None:
                    bootstrap.set_phase("stopping")
                    bootstrap.resume()
            deadline = STOP_DEADLINE if STOP_SIGNAL is not None else bad_readiness_deadline
            if deadline is not None and time.monotonic() >= deadline:
                if process.poll() is None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
    finally:
        for descriptor in (ready_read, ready_write):
            if descriptor is not None:
                os.close(descriptor)
        # Unexpected supervision failures must not leave another acceptor or
        # startup writer alive behind the still-running status service.
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=SHUTDOWN_GRACE_SECONDS)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
            except ProcessLookupError:
                process.wait(timeout=5)
        ACTIVE_PROCESS = None
        if bootstrap is not None:
            bootstrap.set_phase("stopping" if STOP_SIGNAL is not None else "failed")
            bootstrap.resume()


def main() -> int:
    signal.signal(signal.SIGTERM, forward_signal)
    signal.signal(signal.SIGINT, forward_signal)

    # Keep this Python parent alive so ZeroGPU's registration remains available.
    from spaces import zero
    startup = getattr(zero, "startup", None)
    if startup is not None:
        startup()
        print("ZeroGPU registration ready. Starting the Node workspace.", flush=True)
    else:
        # The spaces decorator is deliberately inert outside ZeroGPU. This
        # keeps the same entry point usable in an ordinary local Python process.
        print("ZeroGPU integration is inactive in this environment. Starting the Node workspace.", flush=True)

    # Bind immediately after required ZeroGPU registration, before marker reads,
    # native storage checks, downloads, source copies or npm. HF's root liveness
    # probe must not depend on any of that work finishing successfully.
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "7860"))
    data_dir = Path(os.environ.get("DATA_DIR", "/data"))
    bootstrap = BootstrapServer(host, port)
    print(f"Workspace startup status is listening on port {bootstrap.server.server_address[1]}.", flush=True)
    retry_delay = 5
    try:
        while STOP_SIGNAL is None:
            try:
                wait_for_maintenance_release(data_dir, host, port, bootstrap=bootstrap)
                bootstrap.set_phase("preparing")
                node = node_binary()
                environment = direct_environment()
                environment["PATH"] = str(node.parent) + os.pathsep + environment.get("PATH", "")
                environment.setdefault("NODE_ENV", "production")
                environment.setdefault("DATA_DIR", "/data")
                environment["PORT"] = str(bootstrap.server.server_address[1])
                environment.setdefault("HOST", host)
                environment.setdefault("REQUIRE_PERSISTENT_DATA", "1")

                # Only this owned scratch copy is removed. Normal startup and
                # retries never reset source, workspaces, history or credentials.
                with tempfile.TemporaryDirectory(prefix="codex-workspace-build-") as temporary:
                    working = Path(temporary)
                    shutil.copytree(SOURCE, working, dirs_exist_ok=True, ignore=shutil.ignore_patterns(
                        ".git", ".github", "node_modules", "dist", ".local-data", "upstream",
                        "test-results", "playwright-report", "__pycache__", ".env*",
                        "*credentials*.json", "*.log", "*.key", "*.pem"))
                    build_env = build_environment(environment, working)
                    npm = str(node.parent / "npm")
                    result = prepare_application(working, npm, build_env, bootstrap)
                    if STOP_SIGNAL is not None:
                        return 128 + STOP_SIGNAL
                    if result != 0:
                        raise RuntimeError("Workspace preparation did not finish.")
                    print("Workspace preparation complete; starting Claude Workspace.", flush=True)
                    # Remote bucket operations should overlap within the
                    # application's bounded metadata workers. Set this only
                    # for the runtime; builds and explicit operator values keep
                    # their existing environment.
                    environment.setdefault("UV_THREADPOOL_SIZE", "16")
                    retry_delay = 5
                    while STOP_SIGNAL is None:
                        wait_for_maintenance_release(data_dir, host, port, bootstrap=bootstrap)
                        bootstrap.set_phase("launching")
                        started_at = time.monotonic()
                        result = run_child([str(node), "dist/server/index.js"], working, environment, bootstrap=bootstrap)
                        if STOP_SIGNAL is not None:
                            return 128 + STOP_SIGNAL
                        print(f"Workspace process exited with status {result}; startup will retry.", file=sys.stderr, flush=True)
                        bootstrap.set_phase("failed")
                        if time.monotonic() - started_at >= 60:
                            retry_delay = 5
                        time.sleep(retry_delay)
                        retry_delay = min(30, retry_delay * 2)
            except Exception as error:
                # No exception body, environment, command arguments or arbitrary
                # upstream response is published through the startup page/log.
                print(f"Workspace preparation failed ({type(error).__name__}); startup will retry.", file=sys.stderr, flush=True)
            if STOP_SIGNAL is not None:
                return 128 + STOP_SIGNAL
            bootstrap.set_phase("failed")
            time.sleep(retry_delay)
            retry_delay = min(30, retry_delay * 2)
        return 128 + STOP_SIGNAL
    finally:
        bootstrap.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Workspace launcher failed ({type(error).__name__}).", file=sys.stderr, flush=True)
        raise SystemExit(1)
