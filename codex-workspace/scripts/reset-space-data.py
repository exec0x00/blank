#!/usr/bin/env python3
"""Reviewed, one-time reset of this Space's old conversations and projects.

This operator tool is never imported or run by app startup. `plan` is read-only
apart from its exclusive local output. `backup` downloads essential selected
files into a new, sealed directory outside source and /data. `apply` requires
the reviewed plan digest, verified backup, and the live Python maintenance
receipt before deleting exact file names through the bucket API. It never
pauses/restarts the Space, changes credentials, or removes the gate marker.

The coordinator deploys the verified release with the marker in place, checks
the receipt, makes a fresh plan, backs up, reviews the manifest, applies and
verifies, then separately removes the marker to resume ordinary persistence.
Hugging Face Hub with bucket support is only needed for remote operations.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import uuid4


SPACE = "alvin3y12/codex-workspace"
DATA_BUCKET = "alvin3y12/data"
TRANSFER_BUCKET = "alvin3y12/codex-downloads"
BUCKETS = (DATA_BUCKET, TRANSFER_BUCKET)
PURPOSE = "one-time-space-data-reset"
MARKER_PATH = "codex-workspace/maintenance-v1.json"
RECEIPT_URL = "https://alvin3y12-codex-workspace.hf.space/_maintenance"
HUB = "https://huggingface.co"
SOURCE = Path(__file__).resolve().parent.parent
MAX_ENTRIES = 250_000
MAX_JSON = 128 * 1024 * 1024
HEX64 = re.compile(r"[a-f0-9]{64}")
UUID = r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
THREAD = r"thr_[a-f0-9]{32}"
STATE_ROOT = "codex-workspace/state/"
CODEX_ROOTS = ("codex-workspace/native-codex/", "home/.codex/")

# Stable reusable settings, credentials, account records, installed skills and
# source are intentionally absent. Unknown files are preserved, never swept.
STATE_FILES = {
    "active-workspace.json", "workspaces.json", "workspace-trash.json",
    "agent-index.json", "agent-changes.json", "thread-index.json",
    "thread-goal-index.json", "thread-naming-pending.json", "ui-state.json",
    "filesystem-metadata.json", "conversation-file-uploads-v1.json",
    "download-jobs-v1.json", "upload-jobs-v1.json", "file-transfer-jobs-v1.json",
    "file-rewind-expired-previews.json",
}
STATE_DIRECTORIES = {
    "codex-cli-inputs-v1", "conversation-files-v1", "image-attachments-v1",
    "memories", "git-checkpoints-v1", "file-rewinds", "terminal-history",
}
STATE_RECORDS = [
    re.compile(rf"(?:thread(?:-(?:summary|context|view|goal|naming|deleted))?|agent)-{THREAD}\.json"),
    re.compile(rf"thread-turn-{THREAD}-(?:run|turn)_[a-f0-9]{{32}}\.json"),
    re.compile(r"thread-backup-history_[a-f0-9]{32}\.json"),
    re.compile(r"review-snapshot-review_[a-f0-9]{32}\.json"),
    re.compile(rf"codex-thread-{UUID}\.json"),
    re.compile(r"workspace-(?:record|archived|legacy(?:-v)?|restored|trash-record|trash-cleanup-issue|untrash|cleanup|conversation-cleanup)-[A-Za-z0-9_-]{1,160}\.json"),
    re.compile(r"managed-worktree-[A-Za-z0-9_-]{1,128}\.json"),
    re.compile(r"file-rewind-(?:turn|block|latest|operation|plan|review)-[A-Za-z0-9_-]{1,160}\.json"),
    re.compile(r"file-transfer-[A-Za-z0-9_-]{1,128}\.json"),
]
NATIVE_DATABASE = re.compile(r"(?:state|thread_history|goals|queue|logs|memories)_[0-9]+\.sqlite(?:-wal|-shm|-journal)?")
NATIVE_HISTORY_DIRECTORIES = {
    "sessions", "archived_sessions", "memories", "memory", "shell_snapshots",
    "thread-writer-locks", "log", "logs",
}
NATIVE_HISTORY_FILES = {"history.jsonl", "session_index.jsonl"}


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_relative(path: object) -> str:
    if (not isinstance(path, str) or not path or len(path) > 4096 or "\\" in path
        or any(ord(character) < 32 or ord(character) == 127 for character in path)
        or any(part in {"", ".", ".."} for part in path.split("/"))):
        raise ValueError("Inventory contains an unsafe bucket path.")
    return path


def state_record(name: str) -> bool:
    if name in STATE_FILES or any(pattern.fullmatch(name) for pattern in STATE_RECORDS):
        return True
    temporary = re.fullmatch(rf"(.+\.json)\.(?:{UUID}|[a-f0-9]{{32}})\.tmp", name)
    return bool(temporary and state_record(temporary[1]))


def classify(bucket: str, path: str) -> tuple[str, str, bool]:
    """Return action/category/essential-backup only for exact owned namespaces."""
    safe_relative(path)
    if bucket not in BUCKETS:
        raise ValueError("This workflow only covers the two reviewed Space buckets.")
    if bucket == TRANSFER_BUCKET:
        if path.startswith(("imports/", "exports/")):
            return "delete", "transfer-staging", True
        return "preserve", "unrelated-transfer-object", False
    if path.startswith("codex-final/"):
        return "preserve", "application-source", False
    if path == MARKER_PATH:
        return "preserve", "maintenance-marker", False
    if path.startswith("workspaces/"):
        return "delete", "projects-and-trash", True
    if path.startswith("generated-images-v1/"):
        return "delete", "conversation-images", True
    if path.startswith(STATE_ROOT):
        relative = path[len(STATE_ROOT):]
        directory = relative.split("/", 1)[0]
        if directory in STATE_DIRECTORIES or "/" not in relative and state_record(relative):
            return "delete", "conversation-and-project-state", True
        transaction = re.fullmatch(r"\.state-cas-(.+)-[a-f0-9]{32}/.+", relative)
        if transaction and state_record(transaction[1] + ".json"):
            return "delete", "retired-state-transaction", True
        return "preserve", "configuration-accounts-or-unclassified-state", False
    for prefix in CODEX_ROOTS:
        if not path.startswith(prefix):
            continue
        relative = path[len(prefix):]
        first = relative.split("/", 1)[0]
        if NATIVE_DATABASE.fullmatch(relative) or relative in NATIVE_HISTORY_FILES or first in NATIVE_HISTORY_DIRECTORIES:
            return "delete", "native-and-legacy-conversation-history", True
        if (relative.startswith(".tmp/plugins/")
            or relative in {".tmp/plugins.sha", ".tmp/plugins.sync.lock", "packages/standalone/install.lock"}
            or re.fullmatch(r"\.tmp/git-[A-Za-z0-9_-]+/.+", relative)):
            return "delete", "reproducible-native-cache", False
        return "preserve", "native-configuration-skills-auth-or-unclassified", False
    if path.startswith("home/.local/state/terminal-history/") or path in {
        "home/.bash_history", "home/.zsh_history", "home/.python_history",
    }:
        return "delete", "terminal-history", True
    return "preserve", "unrelated-or-unclassified-data", False


def normalize_inventory(bucket: str, entries: object) -> list[dict]:
    if not isinstance(entries, list) or len(entries) > MAX_ENTRIES:
        raise ValueError("Bucket inventory must be a bounded list.")
    normalized = []
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Bucket inventory entry must be an object.")
        if entry.get("type") == "directory":
            continue  # Bucket directories are virtual; only exact files delete.
        if entry.get("type", "file") != "file":
            raise ValueError("Unknown bucket object kind must be reviewed.")
        path = safe_relative(entry.get("path"))
        size, xet_hash = entry.get("size"), entry.get("xet_hash")
        if (path in seen or type(size) is not int or size < 0 or size > 1024 ** 4
            or not isinstance(xet_hash, str) or not HEX64.fullmatch(xet_hash)):
            raise ValueError("Duplicate path or invalid bucket size/content hash.")
        seen.add(path)
        normalized.append({"bucket": bucket, "path": path, "size": size, "xet_hash": xet_hash})
    return sorted(normalized, key=lambda entry: entry["path"])


def marker_value(value: object) -> dict:
    if (not isinstance(value, dict) or set(value) != {"version", "purpose", "space", "nonce", "entrypoint_sha256"}
        or type(value.get("version")) is not int or value["version"] != 1
        or value.get("purpose") != PURPOSE or value.get("space") != SPACE
        or not isinstance(value.get("nonce"), str) or not re.fullmatch(r"[a-f0-9]{32,128}", value["nonce"])
        or not isinstance(value.get("entrypoint_sha256"), str) or not HEX64.fullmatch(value["entrypoint_sha256"])):
        raise ValueError("Maintenance marker has an invalid schema or target.")
    return value


def make_plan(inventories: dict[str, list[dict]], marker: dict) -> dict:
    marker_value(marker)
    if set(inventories) != set(BUCKETS):
        raise ValueError("Both complete bucket inventories are required.")
    entries = []
    for bucket in BUCKETS:
        for entry in normalize_inventory(bucket, inventories[bucket]):
            action, category, backup_required = classify(bucket, entry["path"])
            entries.append({**entry, "action": action, "category": category, "backup_required": backup_required})
    if len(entries) > MAX_ENTRIES:
        raise ValueError("Combined inventory exceeds the reviewed limit.")
    plan = {
        "version": 1, "purpose": PURPOSE, "space": SPACE, "reset_id": uuid4().hex,
        "created_at": now(), "maintenance": marker, "entries": entries,
    }
    plan["plan_sha256"] = digest(plan)
    return plan


def validate_plan(value: object) -> dict:
    if (not isinstance(value, dict) or set(value) != {"version", "purpose", "space", "reset_id", "created_at", "maintenance", "entries", "plan_sha256"}
        or type(value.get("version")) is not int or value["version"] != 1
        or value.get("purpose") != PURPOSE or value.get("space") != SPACE
        or not isinstance(value.get("reset_id"), str) or not re.fullmatch(r"[a-f0-9]{32}", value["reset_id"])
        or not isinstance(value.get("entries"), list) or len(value["entries"]) > MAX_ENTRIES):
        raise ValueError("Reset plan schema or target is invalid.")
    if digest({key: item for key, item in value.items() if key != "plan_sha256"}) != value.get("plan_sha256"):
        raise ValueError("Reset plan digest does not match its contents.")
    marker_value(value["maintenance"])
    seen = set()
    for entry in value["entries"]:
        if (not isinstance(entry, dict) or set(entry) != {"bucket", "path", "size", "xet_hash", "action", "category", "backup_required"}
            or type(entry.get("backup_required")) is not bool):
            raise ValueError("Reset plan entry schema is invalid.")
        bucket, path = entry["bucket"], entry["path"]
        normalize_inventory(bucket, [entry])
        if (bucket, path) in seen or (entry["action"], entry["category"], entry["backup_required"]) != classify(bucket, path):
            raise ValueError("Reset plan selection differs from the reviewed allowlist.")
        seen.add((bucket, path))
    return value


def file_key(entry: dict) -> str:
    return entry["bucket"] + ":" + entry["path"]


def compare_inventory(plan: dict, observed: dict[str, list[dict]], *, allowed_missing: set[str] | None = None) -> None:
    expected = {file_key(entry): entry for entry in plan["entries"]}
    actual = {file_key(entry): entry for bucket in BUCKETS for entry in normalize_inventory(bucket, observed[bucket])}
    allowed_missing = allowed_missing or set()
    for key, entry in expected.items():
        current = actual.pop(key, None)
        if current is None and entry["action"] == "delete" and key in allowed_missing:
            continue
        if current is None or (current["size"], current["xet_hash"]) != (entry["size"], entry["xet_hash"]):
            raise ValueError(f"Bucket snapshot changed; refresh/review before further deletion: {key}")
    if actual:
        raise ValueError("New bucket files appeared after the reviewed snapshot; no additional paths are authorized.")


def gate_receipt(plan: dict, fetch, *, expected_boot_id: str | None = None) -> dict:
    value = fetch()
    marker = plan["maintenance"]
    if (not isinstance(value, dict) or type(value.get("version")) is not int or value["version"] != 1
        or value.get("purpose") != PURPOSE or value.get("space") != SPACE
        or value.get("state") != "waiting" or value.get("node_started") is not False
        or value.get("nonce") != marker["nonce"] or value.get("entrypoint_sha256") != marker["entrypoint_sha256"]
        or not isinstance(value.get("boot_id"), str) or not re.fullmatch(r"[a-f0-9]{32}", value["boot_id"])
        or type(value.get("process_id")) is not int or value["process_id"] < 1
        or expected_boot_id is not None and value["boot_id"] != expected_boot_id):
        raise ValueError("Live maintenance receipt does not prove the expected release is holding before Node startup.")
    return value


def safe_local(path: Path) -> Path:
    path = Path(os.path.abspath(path))
    if path.resolve(strict=False) != path:
        raise ValueError("Local reset paths must not contain symlinks.")
    return path


def read_json(path: Path) -> object:
    path = safe_local(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Reset metadata must be a regular file.")
        raw = stream.read(MAX_JSON + 1)
    if len(raw) > MAX_JSON:
        raise ValueError("Reset metadata exceeds its size bound.")
    return json.loads(raw)


def sync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save_exclusive(path: Path, value: object, *, mode: int = 0o400) -> None:
    path = safe_local(path)
    with path.open("xb") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(canonical(value) + b"\n")
        stream.flush()
        os.fsync(stream.fileno())
        os.fchmod(stream.fileno(), mode)
    sync_directory(path.parent)


def save_journal(path: Path, value: dict) -> None:
    path = safe_local(path)
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    try:
        save_exclusive(temporary, value, mode=0o600)
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def backup_root(path: Path) -> Path:
    path = safe_local(path)
    for forbidden in (SOURCE, Path("/data"), Path("/home/user/.codex")):
        if path == forbidden or forbidden in path.parents:
            raise ValueError("Backup must be outside source, /data, and the coordinator's Codex home.")
    if path == Path("/"):
        raise ValueError("Backup must use a new dedicated directory.")
    return path


def sha256_file(path: Path) -> tuple[str, int]:
    path = safe_local(path)
    hashed = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Backup object is not a regular file.")
        size = 0
        while chunk := stream.read(1024 * 1024):
            hashed.update(chunk)
            size += len(chunk)
        after = os.fstat(stream.fileno())
    if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError("Backup object changed while being verified.")
    return hashed.hexdigest(), size


def make_backup(plan: dict, client, directory: Path, fetch) -> dict:
    validate_plan(plan)
    receipt = gate_receipt(plan, fetch)
    compare_inventory(plan, client.inventory())
    directory = backup_root(directory)
    directory.mkdir(mode=0o700)  # Exclusive: partial/existing backups never overwrite.
    objects_dir = directory / "objects"
    objects_dir.mkdir(mode=0o700)
    objects = []
    for entry in plan["entries"]:
        if not entry["backup_required"]:
            continue
        # Downloads are read-only. Check periodically and again after the
        # complete snapshot, avoiding hundreds of redundant public requests.
        if len(objects) % 25 == 0:
            gate_receipt(plan, fetch, expected_boot_id=receipt["boot_id"])
        filename = "objects/" + hashlib.sha256(file_key(entry).encode()).hexdigest()
        target = directory / filename
        # The client streams into a new file; neither credentials nor original
        # source/account records are written into this backup.
        streamed_sha256, streamed_size = client.download(entry, target)
        verified_sha256, verified_size = sha256_file(target)
        if (streamed_sha256, streamed_size) != (verified_sha256, verified_size) or verified_size != entry["size"]:
            raise ValueError("Backup reread did not match the downloaded bytes and reviewed size.")
        target.chmod(0o400)
        objects.append({
            "bucket": entry["bucket"], "path": entry["path"], "size": entry["size"],
            "xet_hash": entry["xet_hash"], "sha256": verified_sha256, "filename": filename,
        })
    compare_inventory(plan, client.inventory())
    gate_receipt(plan, fetch, expected_boot_id=receipt["boot_id"])
    backup = {
        "version": 1, "reset_id": plan["reset_id"], "plan_sha256": plan["plan_sha256"],
        "created_at": now(), "boot_id": receipt["boot_id"], "objects": objects,
    }
    backup["backup_sha256"] = digest(backup)
    save_exclusive(directory / "plan.json", plan)
    save_exclusive(directory / "backup.json", backup)
    sync_directory(objects_dir)
    objects_dir.chmod(0o500)
    sync_directory(directory)
    sync_directory(directory.parent)
    verify_backup(plan, directory)
    return backup


def verify_backup(plan: dict, directory: Path) -> dict:
    directory = backup_root(directory)
    backup = read_json(directory / "backup.json")
    if (not isinstance(backup, dict) or backup.get("version") != 1
        or backup.get("reset_id") != plan["reset_id"] or backup.get("plan_sha256") != plan["plan_sha256"]
        or not isinstance(backup.get("objects"), list)
        or not isinstance(backup.get("boot_id"), str) or not re.fullmatch(r"[a-f0-9]{32}", backup["boot_id"])
        or digest({key: value for key, value in backup.items() if key != "backup_sha256"}) != backup.get("backup_sha256")
        or read_json(directory / "plan.json") != plan):
        raise ValueError("Backup seal or immutable plan does not match this reset.")
    expected = {file_key(entry): entry for entry in plan["entries"] if entry["backup_required"]}
    for item in backup["objects"]:
        if not isinstance(item, dict) or set(item) != {"bucket", "path", "size", "xet_hash", "sha256", "filename"}:
            raise ValueError("Backup object schema is invalid.")
        key = file_key(item)
        entry = expected.pop(key, None)
        filename = "objects/" + hashlib.sha256(key.encode()).hexdigest()
        if (entry is None or item["filename"] != filename
            or (entry["size"], entry["xet_hash"]) != (item["size"], item["xet_hash"])):
            raise ValueError("Backup objects do not exactly cover essential selected data.")
        target = directory / filename
        if stat.S_IMODE(target.lstat().st_mode) != 0o400 or sha256_file(target) != (item["sha256"], item["size"]):
            raise ValueError("An immutable backup object is missing, writable or changed.")
    if expected:
        raise ValueError("Essential selected files are missing from the verified backup.")
    for name in ("plan.json", "backup.json"):
        if stat.S_IMODE((directory / name).lstat().st_mode) != 0o400:
            raise ValueError("Backup metadata is not sealed read-only.")
    return backup


def verify_removed(plan: dict, client) -> dict:
    selected = {file_key(entry) for entry in plan["entries"] if entry["action"] == "delete"}
    inventory = client.inventory()
    compare_inventory(plan, inventory, allowed_missing=selected)
    current = {file_key(entry) for bucket in BUCKETS for entry in normalize_inventory(bucket, inventory[bucket])}
    if current & selected:
        raise ValueError("Selected files remain in the bucket; keep maintenance active.")
    return {"deleted_files": len(selected), "preserved_files": len(plan["entries"]) - len(selected)}


def apply_plan(plan: dict, client, directory: Path, journal_path: Path, reviewed_sha256: str, fetch, *, batch_size: int = 250) -> dict:
    validate_plan(plan)
    if reviewed_sha256 != plan["plan_sha256"]:
        raise ValueError("Apply requires the exact independently reviewed plan SHA-256.")
    if type(batch_size) is not int or not 1 <= batch_size <= 500:
        raise ValueError("Delete batch size must be between 1 and 500.")
    backup = verify_backup(plan, directory)
    gate_receipt(plan, fetch, expected_boot_id=backup["boot_id"])
    journal_path = safe_local(journal_path)
    selected = {file_key(entry): entry for entry in plan["entries"] if entry["action"] == "delete"}
    if journal_path.exists():
        journal = read_json(journal_path)
        if (not isinstance(journal, dict) or journal.get("version") != 1 or journal.get("reset_id") != plan["reset_id"]
            or journal.get("plan_sha256") != plan["plan_sha256"] or journal.get("backup_sha256") != backup["backup_sha256"]
            or journal.get("status") not in {"deleting", "complete"}
            or not isinstance(journal.get("attempted"), list) or not isinstance(journal.get("deleted"), list)
            or any(not isinstance(key, str) or key not in selected for key in journal["attempted"])
            or any(not isinstance(key, str) or key not in journal["attempted"] for key in journal["deleted"])):
            raise ValueError("Existing journal does not belong to this exact reset.")
    else:
        compare_inventory(plan, client.inventory())
        journal = {
            "version": 1, "reset_id": plan["reset_id"], "plan_sha256": plan["plan_sha256"],
            "backup_sha256": backup["backup_sha256"], "started_at": now(),
            "status": "deleting", "attempted": [], "deleted": [],
        }
        save_exclusive(journal_path, journal, mode=0o600)
    compare_inventory(plan, client.inventory(), allowed_missing=set(journal["attempted"]))
    if journal["status"] == "complete":
        verify_removed(plan, client)
        return journal
    for bucket in BUCKETS:
        candidates = [entry for key, entry in selected.items() if entry["bucket"] == bucket and key not in journal["deleted"]]
        for start in range(0, len(candidates), batch_size):
            gate_receipt(plan, fetch, expected_boot_id=backup["boot_id"])
            batch = candidates[start:start + batch_size]
            observed = {entry["path"]: entry for entry in normalize_inventory(bucket, client.info(bucket, [entry["path"] for entry in batch]))}
            pending = []
            for entry in batch:
                actual = observed.pop(entry["path"], None)
                key = file_key(entry)
                if actual is None and key in journal["attempted"]:
                    if key not in journal["deleted"]:
                        journal["deleted"].append(key)
                    continue
                if actual is None or (actual["size"], actual["xet_hash"]) != (entry["size"], entry["xet_hash"]):
                    raise ValueError("A pending target changed after backup; remaining files were left untouched.")
                pending.append(entry)
            if observed:
                raise ValueError("Bucket metadata returned an unexpected path.")
            for entry in pending:
                key = file_key(entry)
                if key not in journal["attempted"]:
                    journal["attempted"].append(key)
            # The API is non-transactional. Record attempted exact paths before
            # calling it so interrupted/partial batches can safely resume.
            save_journal(journal_path, journal)
            if pending:
                gate_receipt(plan, fetch, expected_boot_id=backup["boot_id"])
                paths = [entry["path"] for entry in pending]
                client.delete(bucket, paths)
                if client.info(bucket, paths):
                    raise ValueError("A delete batch is incomplete; retain the journal and maintenance marker.")
                journal["deleted"].extend(file_key(entry) for entry in pending)
                save_journal(journal_path, journal)
    gate_receipt(plan, fetch, expected_boot_id=backup["boot_id"])
    result = verify_removed(plan, client)
    verify_backup(plan, directory)
    journal.update(result, status="complete", completed_at=now())
    save_journal(journal_path, journal)
    return journal


def allowed_download_url(address: str) -> bool:
    try:
        value = urlsplit(address)
        hostname = value.hostname or ""
        return (value.scheme == "https" and not value.username and not value.password
                and value.port in {None, 443} and not value.fragment
                and (hostname == "huggingface.co" or hostname.endswith(".huggingface.co") or hostname.endswith(".hf.co")))
    except ValueError:
        return False


class ReviewedXetRedirectHandler(HTTPRedirectHandler):
    """Bind the final stream to the resolver's reviewed immutable Xet object.

    The signed storage response can omit x-xet-hash, so remember the hash from
    earlier HTTPS responses. Every supplied hash must agree, and at least one
    response must attest the reviewed hash before any backup bytes are written.
    """
    max_redirections = 5

    def __init__(self, expected_hash: str):
        super().__init__()
        if not HEX64.fullmatch(expected_hash):
            raise ValueError("Backup requires a valid reviewed Xet hash.")
        self.expected_hash = expected_hash
        self.observed_expected_hash = False
        self.redirect_count = 0

    def observe(self, headers) -> None:
        values = headers.get_all("x-xet-hash", [])
        if values:
            if len(values) != 1 or values[0] != self.expected_hash:
                raise ValueError("Backup response does not match the reviewed Xet hash.")
            self.observed_expected_hash = True

    def redirect_request(self, request, response, code, message, headers, new_url):
        try:
            self.observe(headers)
            self.redirect_count += 1
            if self.redirect_count > self.max_redirections or not allowed_download_url(new_url):
                raise ValueError("Backup redirect exceeds the allowed HTTPS Hugging Face route.")
            return super().redirect_request(request, response, code, message, headers, new_url)
        except Exception:
            response.close()
            raise


class BucketClient:
    def __init__(self, token: str | None = None):
        from huggingface_hub import HfApi
        self.api = HfApi(token=token if token else False)
        self.token = token

    @staticmethod
    def entry(value) -> dict:
        return {"type": "file", "path": value.path, "size": value.size, "xet_hash": value.xet_hash}

    def inventory(self) -> dict[str, list[dict]]:
        return {bucket: [self.entry(value) for value in self.api.list_bucket_tree(bucket, recursive=True, token=False)
                         if hasattr(value, "xet_hash")] for bucket in BUCKETS}

    def info(self, bucket: str, paths: list[str]) -> list[dict]:
        return [self.entry(value) for value in self.api.get_bucket_paths_info(bucket, paths, token=False)]

    def download(self, entry: dict, target: Path) -> tuple[str, int]:
        if entry["bucket"] not in BUCKETS:
            raise ValueError("Backup download is outside the reviewed Space buckets.")
        address = f"{HUB}/buckets/{entry['bucket']}/resolve/{quote(entry['path'], safe='/')}?download=true"
        request = Request(address, headers={"Cache-Control": "no-cache", "Accept-Encoding": "identity"})
        identity = ReviewedXetRedirectHandler(entry["xet_hash"])
        hashed = hashlib.sha256()
        size = 0
        with build_opener(ProxyHandler({}), identity).open(request, timeout=60) as response:
            identity.observe(response.headers)
            if response.status != 200 or not allowed_download_url(response.geturl()) or not identity.observed_expected_hash:
                raise ValueError("Backup response did not attest the reviewed Xet object on an allowed HTTPS route.")
            with target.open("xb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > entry["size"]:
                        raise ValueError("Backup download exceeded the reviewed size.")
                    hashed.update(chunk)
                    stream.write(chunk)
                if size != entry["size"]:
                    raise ValueError("Backup download did not match the reviewed size.")
                stream.flush()
                os.fsync(stream.fileno())
        return hashed.hexdigest(), size

    def delete(self, bucket: str, paths: list[str]) -> None:
        if not self.token or bucket not in BUCKETS or any(classify(bucket, path)[0] != "delete" for path in paths):
            raise ValueError("Deletion is missing explicit credentials or exceeds the reviewed namespace.")
        self.api.batch_bucket_files(bucket, delete=paths, token=self.token)


def fetch_receipt() -> dict:
    request = Request(RECEIPT_URL + "?t=" + str(time.time_ns()), headers={"Cache-Control": "no-cache"})
    with build_opener(ProxyHandler({})).open(request, timeout=20) as response:
        raw = response.read(8193)
    if len(raw) > 8192:
        raise ValueError("Maintenance receipt exceeds its size bound.")
    return json.loads(raw)


def read_token(credentials_file: Path | None) -> str:
    token = os.environ.get("HF_TOKEN")
    if not token and credentials_file is not None:
        credentials_file = safe_local(credentials_file)
        metadata = credentials_file.lstat()
        if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600:
            raise ValueError("External credentials must be a regular mode-0600 file.")
        value = read_json(credentials_file)
        token = value.get("hfToken") if isinstance(value, dict) else None
    if not isinstance(token, str) or not re.fullmatch(r"hf_[A-Za-z0-9_-]+", token):
        raise ValueError("Apply needs HF_TOKEN or an external mode-0600 deployment credentials file.")
    return token


def summary(plan: dict) -> dict:
    categories = Counter(entry["category"] for entry in plan["entries"])
    selected = [entry for entry in plan["entries"] if entry["action"] == "delete"]
    return {
        "plan_sha256": plan["plan_sha256"], "selected_files": len(selected),
        "selected_bytes": sum(entry["size"] for entry in selected),
        "essential_backup_files": sum(entry["backup_required"] for entry in selected),
        "essential_backup_bytes": sum(entry["size"] for entry in selected if entry["backup_required"]),
        "preserved_files": len(plan["entries"]) - len(selected), "categories": dict(categories),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    marker = commands.add_parser("marker", help="Write an explicit marker locally for the coordinator to publish.")
    marker.add_argument("--output", required=True, type=Path)
    marker.add_argument("--nonce", default=None)
    plan = commands.add_parser("plan", help="Read-only dry run; every selected and preserved file is listed.")
    plan.add_argument("--marker-file", required=True, type=Path)
    plan.add_argument("--data-inventory", type=Path)
    plan.add_argument("--transfer-inventory", type=Path)
    plan.add_argument("--output", required=True, type=Path)
    for name in ("backup", "apply", "verify"):
        command = commands.add_parser(name)
        command.add_argument("--plan", required=True, type=Path)
        command.add_argument("--backup-dir", required=True, type=Path)
        if name == "apply":
            command.add_argument("--reviewed-plan-sha256", required=True)
            command.add_argument("--journal", required=True, type=Path)
            command.add_argument("--credentials-file", type=Path)
            command.add_argument("--batch-size", type=int, default=250)
    args = parser.parse_args()
    token = None
    try:
        if args.command == "marker":
            value = marker_value({
                "version": 1, "purpose": PURPOSE, "space": SPACE,
                "nonce": args.nonce or uuid4().hex,
                "entrypoint_sha256": hashlib.sha256((SOURCE / "app.py").read_bytes()).hexdigest(),
            })
            save_exclusive(args.output, value)
            print(json.dumps({"marker_file": str(args.output), **value}, indent=2))
            return 0
        if args.command == "plan":
            if bool(args.data_inventory) != bool(args.transfer_inventory):
                raise ValueError("Supply both complete inventories or omit both for a fresh remote inventory.")
            inventories = {
                DATA_BUCKET: read_json(args.data_inventory), TRANSFER_BUCKET: read_json(args.transfer_inventory),
            } if args.data_inventory else BucketClient().inventory()
            value = make_plan(inventories, marker_value(read_json(args.marker_file)))
            save_exclusive(args.output, value)
            print(json.dumps(summary(value), indent=2))
            return 0
        value = validate_plan(read_json(args.plan))
        if args.command == "backup":
            result = make_backup(value, BucketClient(), args.backup_dir, fetch_receipt)
            print(json.dumps({"backup_sha256": result["backup_sha256"], "backed_up_files": len(result["objects"])}))
        elif args.command == "apply":
            token = read_token(args.credentials_file)
            result = apply_plan(value, BucketClient(token), args.backup_dir, args.journal, args.reviewed_plan_sha256, fetch_receipt, batch_size=args.batch_size)
            print(json.dumps({key: item for key, item in result.items() if key not in {"attempted", "deleted"}}, indent=2))
        else:
            backup = verify_backup(value, args.backup_dir)
            gate_receipt(value, fetch_receipt, expected_boot_id=backup["boot_id"])
            print(json.dumps({"plan_sha256": value["plan_sha256"], "backup_sha256": backup["backup_sha256"], **verify_removed(value, BucketClient())}, indent=2))
        return 0
    except Exception as error:
        message = str(error)
        if token:
            message = message.replace(token, "[redacted]")
        message = re.sub(r"hf_[A-Za-z0-9_-]+", "[redacted]", message)
        print(json.dumps({"error": message[:1500]}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
