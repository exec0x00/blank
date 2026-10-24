#!/usr/bin/env python3
"""Explicit one-time, allowlisted cleanup after authenticated API retirement.

No network requests, platform operations, startup hooks, or periodic reset.
Global indexes/preferences/account/session records are never rewritten here.
The coordinator owns the verified-release gate and the API quiescence receipt.
"""

from __future__ import annotations

import argparse
import ctypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import time
from uuid import uuid4

WORKSPACE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
UUID = r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
THREAD_ID = r"thr_[a-f0-9]{32}"
THREAD = re.compile(rf"^{THREAD_ID}$")
OWNED_THREAD = re.compile(rf"^(?:thread|thread-summary|thread-goal|thread-naming|agent)-({THREAD_ID})\.json$")
JOURNAL = re.compile(rf"^thread-turn-({THREAD_ID})-(?:run|turn)_[a-f0-9]{{32}}\.json$")
BACKUP = re.compile(r"^thread-backup-history_[a-f0-9]{32}\.json$")
REVIEW = re.compile(r"^review-snapshot-review_[a-f0-9]{32}\.json$")
ATTACHMENT = re.compile(r"^att_[a-f0-9]{32}\.(?:json|image|upload)$|^att_[a-f0-9]{32}\.[a-f0-9]{32}\.meta\.tmp$")
TEMP = re.compile(rf"^(.+\.json)\.({UUID})\.tmp$")
STATE = Path("codex-workspace/state")
RESET_ROOT = Path("codex-workspace/reset-backups")
MAX_ENTRIES = 250_000
MAX_JSON = 40 * 1024 * 1024
AUDIT_ONLY = (
    "workspaces.json", "active-workspace.json", "thread-index.json", "agent-index.json",
    "agent-changes.json", "thread-goal-index.json", "thread-naming-pending.json",
    "ui-state.json", "extensions.json", "filesystem-metadata.json",
)


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path) -> object:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError(f"Expected a regular JSON file: {path}")
        raw = stream.read(MAX_JSON + 1)
    if len(raw) > MAX_JSON:
        raise ValueError(f"JSON exceeds the reviewed size limit: {path}")
    return json.loads(raw)


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + f".{os.getpid()}.tmp")
    with temporary.open("x", encoding="utf8") as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def data_root(value: str) -> Path:
    root = Path(os.path.abspath(value))
    if root != root.resolve(strict=True) or not root.is_dir():
        raise ValueError("The data root must be a real directory without symlink ancestors.")
    for relative in [Path("workspaces"), STATE]:
        safe_path(root, relative, require=True, directory=True)
    return root


def safe_path(root: Path, relative: Path | str, *, require: bool = False, directory: bool = False) -> Path:
    relative = Path(relative)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise ValueError("Unsafe relative path in reset manifest.")
    current = root
    for index, part in enumerate(relative.parts):
        current = current / part
        if os.path.lexists(current) and current.is_symlink():
            raise ValueError(f"A managed target or ancestor is a symlink: {relative}")
        if index < len(relative.parts) - 1 and current.exists() and not current.is_dir():
            raise ValueError(f"A managed ancestor is not a directory: {relative}")
    if require and not current.exists():
        raise ValueError(f"Managed path is missing: {relative}")
    if directory and current.exists() and not current.is_dir():
        raise ValueError(f"Managed path is not a directory: {relative}")
    return current


def move_noreplace(source: Path, target: Path) -> None:
    """Linux atomic rename that cannot overwrite a concurrently created target."""
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, "renameat2", None)
    if rename is None:
        raise OSError("Atomic no-replace rename is unavailable; no fallback overwrite is allowed.")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(source), -100, os.fsencode(target), 1) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(target))


def save_planning_output(root: Path, output: Path, value: object) -> None:
    encoded = (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf8")
    if len(encoded) > MAX_JSON:
        raise ValueError("Planning metadata exceeds the bounded reader limit. Reduce the reviewed batch before any API retirement.")
    target = Path(os.path.abspath(output))
    if target == root or root in target.parents:
        raise ValueError("Read-only planning output must be outside the managed data directory.")
    if target.parent.resolve(strict=False) != target.parent or os.path.lexists(target):
        raise ValueError("Planning output must be a new file without symlink ancestors.")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if target.parent.resolve(strict=True) != target.parent:
        raise ValueError("Planning output directory changed.")
    temporary = target.with_name(target.name + "." + uuid4().hex + ".tmp")
    try:
        save_json(temporary, value)
        move_noreplace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def fingerprint(path: Path, *, detailed: bool = False) -> dict:
    """Hash bytes and link metadata without following project child symlinks."""
    items = []
    total = 0

    def visit(location: Path, relative: str) -> None:
        nonlocal total
        info = location.lstat()
        item = {"path": relative, "mode": stat.S_IMODE(info.st_mode), "mtime_ns": info.st_mtime_ns}
        if stat.S_ISLNK(info.st_mode):
            item.update(kind="symlink", target=os.readlink(location))
        elif stat.S_ISDIR(info.st_mode):
            item["kind"] = "directory"
            items.append(item)
            if len(items) > MAX_ENTRIES:
                raise ValueError("Managed snapshot exceeds the entry limit.")
            for child in sorted(location.iterdir(), key=lambda entry: entry.name):
                visit(child, f"{relative}/{child.name}" if relative else child.name)
            after = location.lstat()
            if (info.st_ino, info.st_mtime_ns, info.st_ctime_ns) != (after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
                raise ValueError(f"Directory changed during inventory: {location}")
            return
        elif stat.S_ISREG(info.st_mode):
            hashed = hashlib.sha256()
            fd = os.open(location, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as stream:
                opened = os.fstat(stream.fileno())
                if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                    raise ValueError(f"File changed during inventory: {location}")
                while chunk := stream.read(1024 * 1024):
                    hashed.update(chunk)
                after = os.fstat(stream.fileno())
            if (info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise ValueError(f"File changed during inventory: {location}")
            total += info.st_size
            item.update(kind="file", bytes=info.st_size, sha256=hashed.hexdigest())
        else:
            raise ValueError(f"Special filesystem object requires inspection: {location}")
        items.append(item)
        if len(items) > MAX_ENTRIES:
            raise ValueError("Managed snapshot exceeds the entry limit.")

    visit(path, "")
    result = {"sha256": digest(items), "entries": len(items), "bytes": total, "kind": items[0]["kind"]}
    if detailed:
        result["items"] = items  # Portable modes/timestamps/empty directories/link targets for bucket recovery.
    return result


def validated_scope(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("Reset scope must be an object.")
    workspaces = value.get("workspace_ids")
    threads = value.get("thread_ids")
    if (not isinstance(workspaces, list) or not isinstance(threads, list)
        or len(workspaces) > 5000 or len(threads) > 100_000
        or any(not isinstance(item, str) or not WORKSPACE_ID.fullmatch(item) for item in workspaces)
        or any(not isinstance(item, str) or not THREAD.fullmatch(item) for item in threads)):
        raise ValueError("Reset scope IDs are invalid or exceed their bounds.")
    return {"workspace_ids": sorted(set(workspaces)), "thread_ids": sorted(set(threads))}


def owned_state(path: Path, scope: dict) -> bool:
    name = path.name
    # Keep all permanent deletion/archive markers and every shared index.
    match = OWNED_THREAD.fullmatch(name) or JOURNAL.fullmatch(name)
    if match:
        return match.group(1) in scope["thread_ids"]
    temporary = TEMP.fullmatch(name)
    if temporary:
        base = OWNED_THREAD.fullmatch(temporary.group(1)) or JOURNAL.fullmatch(temporary.group(1))
        return bool(base and base.group(1) in scope["thread_ids"])
    if BACKUP.fullmatch(name):
        record = read_json(path)
        return isinstance(record, dict) and record.get("threadId") in scope["thread_ids"]
    if REVIEW.fullmatch(name):
        record = read_json(path)
        return isinstance(record, dict) and record.get("workspaceId") in scope["workspace_ids"]
    return False


def discover(root: Path) -> dict:
    workspace_ids = set()
    thread_ids = set()
    for entry in (root / "workspaces").iterdir():
        if re.fullmatch(UUID, entry.name) and entry.is_dir() and not entry.is_symlink():
            workspace_ids.add(entry.name)
    trash = safe_path(root, Path("workspaces/.trash"), directory=True)
    if trash.exists():
        for entry in trash.iterdir():
            if re.fullmatch(UUID, entry.name) and entry.is_dir() and not entry.is_symlink():
                workspace_ids.add(entry.name)
    for entry in (root / STATE).iterdir():
        if entry.is_symlink() or not entry.is_file():
            continue
        match = OWNED_THREAD.fullmatch(entry.name) or JOURNAL.fullmatch(entry.name)
        if match:
            thread_ids.add(match.group(1))
        if entry.name == "workspaces.json" or entry.name.startswith(("workspace-record-", "workspace-legacy-")):
            value = read_json(entry)
            for row in value if isinstance(value, list) else [value]:
                if (isinstance(row, dict) and isinstance(row.get("id"), str) and WORKSPACE_ID.fullmatch(row["id"])
                    and row.get("path") == str(root / "workspaces" / row["id"])):
                    workspace_ids.add(row["id"])
    return validated_scope({"workspace_ids": list(workspace_ids), "thread_ids": list(thread_ids)})


def new_conversation_conflicts(root: Path, scope: dict) -> None:
    for entry in (root / STATE).iterdir():
        match = re.fullmatch(rf"thread-({THREAD_ID})\.json", entry.name)
        if not match or match.group(1) in scope["thread_ids"] or entry.is_symlink() or not entry.is_file():
            continue
        record = read_json(entry)
        if isinstance(record, dict) and isinstance(record.get("thread"), dict) and record["thread"].get("workspaceId") in scope["workspace_ids"]:
            raise ValueError("A new conversation belongs to a reset project. Preserve it and refresh the reviewed scope.")


def make_plan(root: Path, scope: dict, reset_id: str) -> dict:
    if not re.fullmatch(UUID, reset_id):
        raise ValueError("reset-id must be a lowercase UUID.")
    new_conversation_conflicts(root, scope)
    selected: list[tuple[Path, str]] = []
    for workspace_id in scope["workspace_ids"]:
        path = safe_path(root, Path("workspaces") / workspace_id, directory=True)
        if path.exists():
            selected.append((path, "project"))
        trash = safe_path(root, Path("workspaces/.trash") / workspace_id, directory=True)
        if trash.exists():
            selected.append((trash, "project-trash"))
    for entry in sorted((root / STATE).iterdir()):
        if entry.is_symlink():
            if OWNED_THREAD.fullmatch(entry.name) or JOURNAL.fullmatch(entry.name):
                raise ValueError(f"Owned state path is a symlink: {entry.name}")
            continue
        if entry.is_file() and owned_state(entry, scope):
            selected.append((entry, "conversation-state"))
    for workspace_id in scope["workspace_ids"]:
        relative = STATE / "image-attachments-v1" / hashlib.sha256(workspace_id.encode()).hexdigest()
        directory = safe_path(root, relative, directory=True)
        if directory.exists():
            if any(not child.is_file() or child.is_symlink() or not ATTACHMENT.fullmatch(child.name) for child in directory.iterdir()):
                raise ValueError("Attachment storage contains an unknown object; inspect it instead of deleting the directory.")
            selected.append((directory, "attachments"))
    entries = [{"path": path.relative_to(root).as_posix(), "category": category, **fingerprint(path, detailed=True)} for path, category in selected]
    protected = {}
    for entry in sorted((root / STATE).iterdir()):
        if (entry.is_file() and not entry.is_symlink()
            and (entry.name.startswith("github-") or entry.name in {"protected-credentials.json", "settings.json"})):
            protected[entry.relative_to(root).as_posix()] = fingerprint(entry)
    plan = {"version": 1, "reset_id": reset_id, "created_at": now(), "data_root": str(root), "scope": scope,
        "scope_sha256": digest(scope), "entries": entries, "protected": protected,
        "preserved": ["deployment source", "home/**", "all GitHub/account/session records", "all shared indexes", "ui-state.json", "extensions.json", "filesystem-metadata.json", "download-jobs-v1.json", "unknown paths", "archive/deletion markers"]}
    plan["plan_sha256"] = digest(plan)
    return plan


def load_plan(path: Path) -> tuple[dict, Path]:
    plan = read_json(path)
    if not isinstance(plan, dict) or plan.get("version") != 1:
        raise ValueError("Unknown reset plan format.")
    checksum = plan.get("plan_sha256")
    if checksum != digest({key: value for key, value in plan.items() if key != "plan_sha256"}):
        raise ValueError("Reset plan checksum changed.")
    root = data_root(plan["data_root"])
    scope = validated_scope(plan["scope"])
    if digest(scope) != plan["scope_sha256"] or not re.fullmatch(UUID, plan["reset_id"]):
        raise ValueError("Reset scope changed.")
    entries = plan.get("entries")
    if not isinstance(entries, list) or len(entries) > MAX_ENTRIES or any(not isinstance(entry, dict) or not isinstance(entry.get("path"), str) for entry in entries):
        raise ValueError("Reset entries are invalid.")
    if len({entry["path"] for entry in entries}) != len(entries):
        raise ValueError("Reset entries contain duplicate paths.")
    if any(not isinstance(entry.get("items"), list) or len(entry["items"]) != entry.get("entries") or digest(entry["items"]) != entry.get("sha256") for entry in entries):
        raise ValueError("Portable rollback metadata does not match the frozen fingerprints.")
    # Re-authorize every path; a manifest is data, not permission to delete arbitrary paths.
    for entry in plan["entries"]:
        relative = Path(entry["path"])
        allowed_project = len(relative.parts) == 2 and relative.parts[0] == "workspaces" and relative.parts[1] in scope["workspace_ids"]
        allowed_trash = len(relative.parts) == 3 and relative.parts[:2] == ("workspaces", ".trash") and relative.parts[2] in scope["workspace_ids"]
        allowed_attachment = len(relative.parts) == 4 and relative.parts[:3] == (*STATE.parts, "image-attachments-v1") and relative.parts[3] in {hashlib.sha256(item.encode()).hexdigest() for item in scope["workspace_ids"]}
        candidate = safe_path(root, relative)
        direct = OWNED_THREAD.fullmatch(relative.name) or JOURNAL.fullmatch(relative.name)
        temporary = TEMP.fullmatch(relative.name)
        if not direct and temporary:
            direct = OWNED_THREAD.fullmatch(temporary.group(1)) or JOURNAL.fullmatch(temporary.group(1))
        allowed_absent = bool(direct and direct.group(1) in scope["thread_ids"])
        # ID-independent review/history records must be backed by the original,
        # content-validated copy after their authenticated API has removed them.
        if not candidate.exists() and (BACKUP.fullmatch(relative.name) or REVIEW.fullmatch(relative.name)):
            saved = safe_path(root, RESET_ROOT / plan["reset_id"] / "before" / relative)
            allowed_absent = saved.is_file() and owned_state(saved, scope)
        allowed_state = relative.parent == STATE and (owned_state(candidate, scope) if candidate.exists() else allowed_absent)
        if not (allowed_project or allowed_trash or allowed_attachment or allowed_state):
            raise ValueError(f"Path is outside the reviewed allowlist: {relative}")
    return plan, root


def receipt(path: Path, plan: dict, stage: str) -> dict:
    value = read_json(path)
    if not isinstance(value, dict) or value.get("version") != 1 or value.get("reset_id") != plan["reset_id"] or value.get("plan_sha256") != plan["plan_sha256"]:
        raise ValueError("API receipt is not bound to this exact reset plan.")
    if value.get("verified_release_ready") is not True or value.get("stage") != stage:
        raise ValueError("The verified release/API cleanup gate is not complete.")
    if not isinstance(value.get("expires_at"), (int, float)) or not time.time() < value["expires_at"] <= time.time() + 3600:
        raise ValueError("API receipt is missing, expired, or too long-lived.")
    if value.get("target_runs_stopped") is not True or value.get("target_terminals_closed") is not True:
        raise ValueError("Target runs and terminals must be stopped through their authenticated APIs.")
    if stage in {"api-cleaned", "metadata-captured"}:
        if set(value.get("deleted_thread_ids", [])) != set(plan["scope"]["thread_ids"]) or set(value.get("archived_or_absent_workspace_ids", [])) != set(plan["scope"]["workspace_ids"]):
            raise ValueError("API deletion/archive receipt does not cover the reviewed IDs.")
    return value


def storage(root: Path, plan: dict) -> Path:
    return safe_path(root, RESET_ROOT / plan["reset_id"], directory=True)


def validate_journal(value: object, plan: dict) -> dict:
    if not isinstance(value, dict) or value.get("version") != 1 or value.get("reset_id") != plan["reset_id"] or value.get("plan_sha256") != plan["plan_sha256"]:
        raise ValueError("Reset journal belongs to a different plan.")
    allowed = {entry["path"] for entry in plan["entries"]}
    moves = value.get("moves")
    removed = value.get("api_removed")
    restored = value.get("restored_paths", [])
    if (not isinstance(moves, list) or not isinstance(removed, list) or not isinstance(restored, list)
        or len(moves) > len(allowed) or len(removed) > len(allowed)
        or any(not isinstance(move, dict) or move.get("path") not in allowed or not isinstance(move.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", move["sha256"]) for move in moves)
        or any(not isinstance(item, str) or item not in allowed for item in removed)):
        raise ValueError("Reset journal contains an unplanned path or invalid move.")
    paths = [move["path"] for move in moves]
    if len(set(paths)) != len(paths) or len(set(removed)) != len(removed) or set(paths) & set(removed) or len(set(restored)) != len(restored) or not set(restored) <= set(paths):
        raise ValueError("Reset journal has duplicate or inconsistent progress.")
    return value


def verify_backups(root: Path, plan: dict) -> None:
    for entry in plan["entries"]:
        path = safe_path(root, RESET_ROOT / plan["reset_id"] / "before" / entry["path"], require=True)
        if fingerprint(path)["sha256"] != entry["sha256"]:
            raise ValueError("A rollback copy is missing or altered. Do not proceed with API deletion or cleanup.")


def require_unchanged_moves(journal: dict, plan: dict) -> None:
    expected = {entry["path"]: entry["sha256"] for entry in plan["entries"]}
    if any(move["sha256"] != expected[move["path"]] for move in journal["moves"]):
        raise ValueError("Quarantine contains a concurrent change. Retain its bytes for reviewed physical rollback; apply/completion cannot resume.")


def observe_protected(root: Path, plan: dict) -> list[str]:
    changed = []
    for relative, wanted in plan["protected"].items():
        try:
            path = safe_path(root, relative)
            different = not path.exists() or fingerprint(path) != wanted
        except (OSError, ValueError):
            different = True
        if different:
            changed.append(relative)
    return changed


def backup(plan: dict, root: Path, gate: Path) -> dict:
    receipt(gate, plan, "stopped")
    new_conversation_conflicts(root, plan["scope"])
    destination = storage(root, plan)
    journal_path = destination / "journal.json"
    if journal_path.exists():
        journal = validate_journal(read_json(journal_path), plan)
        if journal.get("status") != "backing-up":
            verify_backups(root, plan)
            return journal
    else:
        if destination.exists():
            raise ValueError("An unjournaled backup directory already exists; retain it for inspection.")
        journal = None
    for entry in plan["entries"]:
        if fingerprint(safe_path(root, entry["path"], require=True)) != {key: entry[key] for key in ["sha256", "entries", "bytes", "kind"]}:
            raise ValueError(f"An inventoried target changed; refresh the plan: {entry['path']}")
    protected_before = observe_protected(root, plan)
    required = sum(entry["bytes"] for entry in plan["entries"])
    if shutil.disk_usage(root).free < required + 64 * 1024 * 1024:
        raise ValueError("Insufficient local capacity for the rollback copy; nothing was removed.")
    if journal is None:
        destination.mkdir(parents=True, mode=0o700)
        save_json(destination / "plan.json", plan)
        journal = {"version": 1, "reset_id": plan["reset_id"], "plan_sha256": plan["plan_sha256"], "status": "backing-up", "moves": [], "api_removed": [], "protected_changes_observed": protected_before}
        save_json(journal_path, journal)
    for entry in plan["entries"]:
        source = safe_path(root, entry["path"], require=True)
        target = safe_path(root, RESET_ROOT / plan["reset_id"] / "before" / entry["path"])
        if target.exists():
            if fingerprint(target)["sha256"] != entry["sha256"]:
                raise ValueError("Existing rollback copy differs; it was not overwritten.")
            continue
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        partial = safe_path(root, RESET_ROOT / plan["reset_id"] / "partial" / uuid4().hex)
        partial.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if source.is_dir():
            shutil.copytree(source, partial, symlinks=True)
        else:
            shutil.copy2(source, partial, follow_symlinks=False)
        if fingerprint(partial)["sha256"] != entry["sha256"]:
            raise ValueError("Rollback copy validation failed; no source path was removed.")
        safe_path(root, target.relative_to(root))
        move_noreplace(partial, target)
    for name in AUDIT_ONLY:
        try:
            source = safe_path(root, STATE / name)
            if source.is_file():
                target = safe_path(root, RESET_ROOT / plan["reset_id"] / "api-before" / name)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                if not target.exists():
                    shutil.copy2(source, target, follow_symlinks=False)
        except (OSError, ValueError):
            journal.setdefault("audit_snapshots_unavailable", []).append(name)
    verify_backups(root, plan)
    journal.update(status="backed-up", backed_up_at=now())
    save_json(journal_path, journal)
    return journal


def apply(plan: dict, root: Path, gate: Path) -> dict:
    receipt(gate, plan, "api-cleaned")
    destination = storage(root, plan)
    journal_path = destination / "journal.json"
    journal = validate_journal(read_json(journal_path), plan)
    require_unchanged_moves(journal, plan)
    if journal.get("status") == "complete":
        return journal  # Completion is durable: normal restart/re-invocation never repeats the reset.
    if journal.get("status") not in {"backed-up", "applying"}:
        raise ValueError("Reset journal is not ready for apply.")
    verify_backups(root, plan)
    new_conversation_conflicts(root, plan["scope"])
    journal["protected_changes_observed"] = observe_protected(root, plan)
    done = {item["path"] for item in journal["moves"]} | set(journal["api_removed"])
    for entry in plan["entries"]:
        if entry["path"] in done:
            continue
        source = safe_path(root, entry["path"])
        quarantined = safe_path(root, RESET_ROOT / plan["reset_id"] / "quarantined" / entry["path"])
        if not source.exists() and quarantined.exists():
            observed = fingerprint(quarantined)
            journal["moves"].append({"path": entry["path"], "sha256": observed["sha256"]})
            done.add(entry["path"])
            save_json(journal_path, journal)
            if observed["sha256"] != entry["sha256"]:
                journal.update(status="needs-review", reason="quarantine_content_changed")
                save_json(journal_path, journal)
                raise ValueError("An interrupted quarantine contains changed data; retain it for review.")
            continue
        if source.exists() and fingerprint(source)["sha256"] != entry["sha256"]:
            raise ValueError(f"A target changed after backup/API retirement; preserve it and refresh the plan: {entry['path']}")
    journal["status"] = "applying"
    save_json(journal_path, journal)
    for entry in plan["entries"]:
        receipt(gate, plan, "api-cleaned")
        if entry["path"] in done:
            continue
        source = safe_path(root, entry["path"])
        if not source.exists():
            journal["api_removed"].append(entry["path"])
            save_json(journal_path, journal)
            continue
        if fingerprint(source)["sha256"] != entry["sha256"]:
            raise ValueError("A target changed during cleanup; remaining files were left untouched.")
        if entry["category"] in {"project", "project-trash"}:
            new_conversation_conflicts(root, plan["scope"])
        target = safe_path(root, RESET_ROOT / plan["reset_id"] / "quarantined" / entry["path"])
        if os.path.lexists(target):
            raise ValueError("Quarantine destination already exists; inspect the journal before resuming.")
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        move_noreplace(source, target)
        observed = fingerprint(target)
        journal["moves"].append({"path": entry["path"], "sha256": observed["sha256"]})
        save_json(journal_path, journal)
        if observed["sha256"] != entry["sha256"]:
            journal.update(status="needs-review", reason="quarantine_content_changed")
            save_json(journal_path, journal)
            raise ValueError("A concurrent write entered quarantine. Its bytes were retained; review before rollback.")
    new_conversation_conflicts(root, plan["scope"])
    journal["protected_changes_observed"] = observe_protected(root, plan)
    journal.update(status="awaiting-metadata-capture", cleaned_at=now())
    save_json(journal_path, journal)
    return journal


def complete(plan: dict, root: Path, gate: Path) -> dict:
    evidence = receipt(gate, plan, "metadata-captured")
    destination = storage(root, plan)
    journal = validate_journal(read_json(destination / "journal.json"), plan)
    require_unchanged_moves(journal, plan)
    if journal.get("status") not in {"awaiting-metadata-capture", "complete"}:
        raise ValueError("Cleanup is not awaiting completion.")
    if journal["status"] == "complete":
        return journal
    new_conversation_conflicts(root, plan["scope"])
    for move in journal["moves"]:
        quarantined = safe_path(root, RESET_ROOT / plan["reset_id"] / "quarantined" / move["path"], require=True)
        if fingerprint(quarantined)["sha256"] != move["sha256"]:
            journal.update(status="needs-review", reason="quarantine_changed_after_cleanup")
            save_json(destination / "journal.json", journal)
            raise ValueError("A writer changed quarantined data after cleanup. Its bytes were retained; inspect before completing.")
    for entry in plan["entries"]:
        if os.path.lexists(safe_path(root, entry["path"])):
            raise ValueError("A retired path reappeared. Do not delete it blindly; inspect before completing.")
    cleaned = datetime.fromisoformat(journal["cleaned_at"])
    captured = datetime.fromisoformat(evidence.get("metadata_captured_at", ""))
    if captured.tzinfo is None or captured <= cleaned or evidence.get("metadata_error") is not None:
        raise ValueError("Observe a successful metadata capture after cleanup before completing.")
    metadata = read_json(safe_path(root, STATE / "filesystem-metadata.json", require=True))
    entries = metadata.get("entries") if isinstance(metadata, dict) else None
    if not isinstance(entries, list) or not all(isinstance(item, dict) and isinstance(item.get("path"), str) for item in entries) or not all(any(item.get("root") == name and item.get("path") == "" for item in entries) for name in ["home", "workspaces"]):
        raise ValueError("File metadata roots are invalid; it was not rewritten by this executor.")
    def retired_path(value: str) -> bool:
        parts = value.split('/')
        return parts[0] in plan["scope"]["workspace_ids"] or len(parts) > 1 and parts[0] == ".trash" and parts[1] in plan["scope"]["workspace_ids"]
    if any(item.get("root") == "workspaces" and retired_path(item["path"]) for item in entries):
        raise ValueError("Metadata still references retired project paths; wait for the supported capture/drain path.")
    journal["protected_changes_observed"] = observe_protected(root, plan)
    journal.update(status="complete", completed_at=now())
    save_json(destination / "journal.json", journal)
    return journal


def rollback(plan: dict, root: Path, gate: Path) -> dict:
    receipt(gate, plan, "stopped")
    destination = storage(root, plan)
    journal_path = destination / "journal.json"
    journal = validate_journal(read_json(journal_path), plan)
    if journal.get("status") == "physical-rollback":
        return journal
    restored = set(journal.get("restored_paths", []))
    # Restore only physical paths moved by this executor. API index/cache/tombstone
    # restoration is a separate reviewed application recovery, never a blind JSON copy.
    for move in journal.get("moves", []):
        target = safe_path(root, move["path"])
        source = safe_path(root, RESET_ROOT / plan["reset_id"] / "quarantined" / move["path"])
        if move["path"] in restored:
            if not target.exists() or fingerprint(target)["sha256"] != move["sha256"]:
                raise ValueError("An already restored path changed; it was not overwritten.")
            continue
        if target.exists() and not source.exists() and fingerprint(target)["sha256"] == move["sha256"]:
            restored.add(move["path"])
            journal["restored_paths"] = sorted(restored)
            save_json(journal_path, journal)
            continue
        if os.path.lexists(target) or fingerprint(source)["sha256"] != move["sha256"]:
            raise ValueError("Rollback would overwrite new data or an altered quarantine. Nothing was restored.")
    journal["status"] = "rolling-back"
    save_json(journal_path, journal)
    for move in reversed(journal.get("moves", [])):
        if move["path"] in restored:
            continue
        receipt(gate, plan, "stopped")
        target = safe_path(root, move["path"])
        source = safe_path(root, RESET_ROOT / plan["reset_id"] / "quarantined" / move["path"], require=True)
        if os.path.lexists(target) or fingerprint(source)["sha256"] != move["sha256"]:
            raise ValueError("Rollback source or destination changed; remaining paths were not restored.")
        target.parent.mkdir(parents=True, exist_ok=True)
        move_noreplace(source, target)
        restored.add(move["path"])
        journal["restored_paths"] = sorted(restored)
        save_json(journal_path, journal)
    journal.update(status="physical-rollback", rolled_back_at=now())
    save_json(destination / "journal.json", journal)
    return journal


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["discover", "plan", "backup", "apply", "complete", "rollback"])
    parser.add_argument("--data-dir", default="/data")
    parser.add_argument("--scope", type=Path)
    parser.add_argument("--reset-id")
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.operation in {"discover", "plan"}:
        root = data_root(args.data_dir)
        if args.output is None:
            parser.error("Read-only discovery/planning requires an explicit output path.")
        if args.operation == "discover":
            value = discover(root)
        else:
            if args.scope is None or args.reset_id is None:
                parser.error("Plan requires the reviewed --scope and --reset-id; it never expands old IDs automatically.")
            value = make_plan(root, validated_scope(read_json(args.scope)), args.reset_id)
        save_planning_output(root, args.output, value)
        print(json.dumps({"operation": args.operation, "output": str(args.output), "plan_sha256": value.get("plan_sha256"), "targets": len(value.get("entries", []))}))
        return
    if args.plan is None or args.receipt is None:
        parser.error("Execution requires the exact --plan and a plan-bound API --receipt.")
    plan, root = load_plan(args.plan)
    result = {"backup": backup, "apply": apply, "complete": complete, "rollback": rollback}[args.operation](plan, root, args.receipt)
    print(json.dumps({"reset_id": result["reset_id"], "status": result["status"], "moved_paths": len(result.get("moves", [])), "api_removed_paths": len(result.get("api_removed", [])), "protected_changes_observed": result.get("protected_changes_observed", [])}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Managed reset stopped: {error}")
