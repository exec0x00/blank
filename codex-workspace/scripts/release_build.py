#!/usr/bin/env python3
"""Verify and package the portable application assets for the Space launcher.

Only this repository's fixed npm verification command can issue a local build
receipt. The deployed archive never contains node_modules or native binaries;
the host still installs its dependencies and compiles its own Node-API binding.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 1
NODE_MAJOR = 22
RECEIPT = "dist/release-build-receipt.json"
ARCHIVE = "release/workspace-build.zip"
MANIFEST = "release/workspace-build.json"
INPUT_ROOTS = ("client", "server", "shared", "public", "native", "scripts", "tests")
INPUT_REQUIRED = ("app.py", "package.json", "package-lock.json", "index.html")
INPUT_CONFIGS = ("tsconfig*.json", "*.config.*")
SKIP_DIRECTORIES = {".git", "node_modules", "dist", "__pycache__", ".local-data", "test-results", "playwright-report"}
SKIP_FILES = ("*.pyc", "*.log", "*credentials*.json", "*.key", "*.pem")
CLIENT_EXTENSIONS = {".html", ".js", ".mjs", ".css", ".json", ".svg", ".png", ".jpg", ".jpeg",
                     ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".txt", ".wasm", ".webmanifest"}
REQUIRED_ASSETS = {"dist/client/index.html", "dist/server/index.js"}
MAX_INPUT_FILES = 8192
MAX_ASSET_FILES = 2048
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_INPUT_BYTES = 256 * 1024 * 1024
MAX_ASSET_BYTES = 128 * 1024 * 1024
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
HEX_DIGEST = re.compile(r"[a-f0-9]{64}")
SENSITIVE_ENVIRONMENT = re.compile(r"password|secret|token|credential|(?:^|_)key(?:_|$)|(?:^|_)auth(?:_|$)", re.I)


class ReleaseBuildError(ValueError):
    """A missing, stale or unsafe portable build must never be executed."""


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")


def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _relative_name(name: str) -> bool:
    return (isinstance(name, str) and 0 < len(name) <= 512 and "\\" not in name and ":" not in name
            and not any(ord(character) < 32 or ord(character) == 127 for character in name)
            and not name.startswith("/") and all(part not in {"", ".", ".."} for part in name.split("/"))
            and PurePosixPath(name).as_posix() == name)


def _safe_path(root: Path, relative: str, *, allow_missing=False) -> Path:
    if not _relative_name(relative):
        raise ReleaseBuildError("The build contains an unsafe path.")
    path = root
    parts = PurePosixPath(relative).parts
    for index, part in enumerate(parts):
        path = path / part
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            if allow_missing:
                continue
            raise ReleaseBuildError("A required build file is missing.") from None
        if stat.S_ISLNK(metadata.st_mode) or (index < len(parts) - 1 and not stat.S_ISDIR(metadata.st_mode)):
            raise ReleaseBuildError("Build paths must not contain symlinks or non-directory parents.")
    return path


def _read_file(root: Path, relative: str, limit: int) -> bytes:
    path = _safe_path(root, relative)
    descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise ReleaseBuildError("A build file is not a bounded regular file.")
        content = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    current = path.lstat()
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
    if len(content) > limit or identity(before) != identity(after) or identity(after) != identity(current):
        raise ReleaseBuildError("A build file changed while it was being checked.")
    return content


def _walk_files(root: Path, relative: str, *, source=False) -> list[str]:
    directory = _safe_path(root, relative)
    if not directory.is_dir():
        raise ReleaseBuildError("A required build directory is missing.")
    files = []
    for parent, names, filenames in os.walk(directory, followlinks=False):
        names[:] = sorted(name for name in names if not source or name not in SKIP_DIRECTORIES)
        for name in names:
            _safe_path(root, (Path(parent) / name).relative_to(root).as_posix())
        for name in sorted(filenames):
            if source and (name.startswith(".env") or any(fnmatch.fnmatch(name, pattern) for pattern in SKIP_FILES)):
                continue
            relative_file = (Path(parent) / name).relative_to(root).as_posix()
            _safe_path(root, relative_file)
            files.append(relative_file)
            if len(files) > (MAX_INPUT_FILES if source else MAX_ASSET_FILES):
                raise ReleaseBuildError("The build contains too many files.")
    return files


def source_fingerprint(root: Path) -> str:
    """Hash contents and relative names, never host paths, modes or timestamps."""
    files = set(INPUT_REQUIRED)
    for pattern in INPUT_CONFIGS:
        files.update(path.relative_to(root).as_posix() for path in root.glob(pattern))
    for relative in INPUT_ROOTS:
        files.update(_walk_files(root, relative, source=True))
    if len(files) > MAX_INPUT_FILES:
        raise ReleaseBuildError("The build has too many source inputs.")
    inputs, total = [], 0
    for relative in sorted(files):
        content = _read_file(root, relative, MAX_FILE_BYTES)
        total += len(content)
        if total > MAX_INPUT_BYTES:
            raise ReleaseBuildError("The build source exceeds the release limit.")
        inputs.append({"path": relative, "size": len(content), "sha256": _digest(content)})
    return _digest(_json_bytes({"schema": SCHEMA, "nodeMajor": NODE_MAJOR, "mode": "production", "inputs": inputs}))


def _asset_name(relative: str) -> bool:
    if not _relative_name(relative):
        return False
    if relative == "dist/server/index.js":
        return True
    return (relative.startswith("dist/client/") and len(PurePosixPath(relative).parts) >= 3
            and not any(part.startswith(".") for part in PurePosixPath(relative).parts)
            and PurePosixPath(relative).suffix.lower() in CLIENT_EXTENSIONS)


def _check_asset(content: bytes, private_values: tuple[bytes, ...]) -> None:
    if content.startswith((b"\x7fELF", b"MZ", b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe")):
        raise ReleaseBuildError("Host executable files cannot be published in the portable application build.")
    if any(value and value in content for value in private_values):
        raise ReleaseBuildError("A deployment secret occurs in a built application asset; publication stopped.")


def asset_inventory(root: Path, private_values: tuple[bytes, ...] = ()) -> list[dict]:
    files = sorted(_walk_files(root, "dist/client") + _walk_files(root, "dist/server"))
    if not REQUIRED_ASSETS.issubset(files) or len(files) > MAX_ASSET_FILES:
        raise ReleaseBuildError("The portable application build is incomplete or too large.")
    inventory, total = [], 0
    for relative in files:
        if not _asset_name(relative):
            raise ReleaseBuildError("Only the application JavaScript and static client assets may be packaged.")
        content = _read_file(root, relative, MAX_FILE_BYTES)
        _check_asset(content, private_values)
        total += len(content)
        if total > MAX_ASSET_BYTES:
            raise ReleaseBuildError("The portable application build exceeds the release limit.")
        inventory.append({"path": relative, "size": len(content), "sha256": _digest(content)})
    return inventory


def verification_environment(environment: dict[str, str]) -> dict[str, str]:
    # Vite substitutes its public environment at compile time. This application
    # has no configurable public build variables; both release and fallback
    # builds use the same production values and never inherit deployment keys.
    result = {key: value for key, value in environment.items()
              if not SENSITIVE_ENVIRONMENT.search(key) and not key.upper().startswith("VITE_")
              and key not in {"CODEX_BOOTSTRAP_LISTEN_FD", "CODEX_BOOTSTRAP_READY_FD"}}
    # The fixed npm verify pipeline also runs React tests. Leave NODE_ENV unset
    # so Vitest selects test mode and the subsequent Vite build selects its
    # default production mode, rather than forcing production React into tests.
    result.pop("NODE_ENV", None)
    return result


def _json_object(content: bytes) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ReleaseBuildError("The build manifest contains duplicate fields.")
            result[key] = value
        return result
    try:
        value = json.loads(content, object_pairs_hook=unique)
    except (ValueError, UnicodeError, RecursionError):
        raise ReleaseBuildError("The build manifest is not valid JSON.") from None
    if not isinstance(value, dict):
        raise ReleaseBuildError("The build manifest must be an object.")
    return value


def _validate_inventory(files: object) -> list[dict]:
    if not isinstance(files, list) or not 2 <= len(files) <= MAX_ASSET_FILES:
        raise ReleaseBuildError("The build manifest has an invalid file list.")
    previous, total = "", 0
    for entry in files:
        if not isinstance(entry, dict) or set(entry) != {"path", "size", "sha256"}:
            raise ReleaseBuildError("The build manifest has an invalid file record.")
        name, size, digest = entry["path"], entry["size"], entry["sha256"]
        if (not _asset_name(name) or name <= previous or type(size) is not int or not 0 <= size <= MAX_FILE_BYTES
                or not isinstance(digest, str) or not HEX_DIGEST.fullmatch(digest)):
            raise ReleaseBuildError("The build manifest has an unsafe or duplicate file record.")
        previous, total = name, total + size
        if total > MAX_ASSET_BYTES:
            raise ReleaseBuildError("The build manifest exceeds the release limit.")
    if not REQUIRED_ASSETS.issubset(entry["path"] for entry in files):
        raise ReleaseBuildError("The build manifest is missing the application entry points.")
    return files


def _validate_record(value: dict, *, archive: bool) -> dict:
    expected = {"schema", "nodeMajor", "mode", "verification", "sourceSha256", "files"}
    if archive:
        expected |= {"archiveSha256", "archiveSize"}
    if (set(value) != expected or type(value.get("schema")) is not int or value["schema"] != SCHEMA
            or type(value.get("nodeMajor")) is not int or value["nodeMajor"] != NODE_MAJOR
            or value.get("mode") != "production" or value.get("verification") != "npm run verify"
            or not isinstance(value.get("sourceSha256"), str) or not HEX_DIGEST.fullmatch(value["sourceSha256"])):
        raise ReleaseBuildError("The build record is unsupported or does not record successful verification.")
    _validate_inventory(value["files"])
    if archive and (type(value["archiveSize"]) is not int or not 0 < value["archiveSize"] <= MAX_ARCHIVE_BYTES
                    or not isinstance(value["archiveSha256"], str) or not HEX_DIGEST.fullmatch(value["archiveSha256"])):
        raise ReleaseBuildError("The build archive record exceeds its bounds or is invalid.")
    return value


def _write_json_atomic(root: Path, relative: str, value: dict) -> None:
    destination = _safe_path(root, relative, allow_missing=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    content = _json_bytes(value)
    if len(content) > MAX_MANIFEST_BYTES:
        raise ReleaseBuildError("The build manifest exceeds the release limit.")
    with tempfile.NamedTemporaryFile(prefix=".release-record-", dir=destination.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(content)
            stream.flush()
            os.fchmod(stream.fileno(), 0o644)
            stream.close()
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)


def verify_build(root: Path = ROOT) -> dict:
    """Run the fixed verification pipeline; an old dist alone proves nothing."""
    receipt = _safe_path(root, RECEIPT, allow_missing=True)
    receipt.unlink(missing_ok=True)
    # These files are deliberately never published. Refuse to bake local Vite
    # overrides into a release that would not match the deployed source tree.
    if any(path.name != ".env.example" for path in root.glob(".env*")):
        raise ReleaseBuildError("Remove private/local Vite environment files before verifying a portable release.")
    environment = verification_environment(dict(os.environ))
    version = subprocess.run(["node", "--version"], cwd=root, env=environment, check=True, capture_output=True, text=True, timeout=10)
    match = re.fullmatch(r"v22\.(\d+)\.\d+\s*", version.stdout)
    if not match or int(match.group(1)) < 12:
        raise ReleaseBuildError("Verify portable releases with Node 22.12 or newer in the Node 22 series.")
    before = source_fingerprint(root)
    subprocess.run(["npm", "run", "verify"], cwd=root, env=environment, check=True)
    files = asset_inventory(root)
    if source_fingerprint(root) != before:
        raise ReleaseBuildError("Source changed during verification. Run the verification helper again before publishing.")
    result = {"schema": SCHEMA, "nodeMajor": NODE_MAJOR, "mode": "production", "verification": "npm run verify",
              "sourceSha256": before, "files": files}
    _write_json_atomic(root, RECEIPT, result)
    print("Recorded verified portable application assets for the current source and package lock.", flush=True)
    return result


def package_release(root: Path = ROOT, private_values: tuple[bytes, ...] = ()) -> dict:
    receipt = _validate_record(_json_object(_read_file(root, RECEIPT, MAX_MANIFEST_BYTES)), archive=False)
    if source_fingerprint(root) != receipt["sourceSha256"] or asset_inventory(root, private_values) != receipt["files"]:
        raise ReleaseBuildError("The build receipt is stale. Run python3 scripts/release_build.py verify before publishing.")
    destination = _safe_path(root, ARCHIVE, allow_missing=True)
    _safe_path(root, MANIFEST, allow_missing=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".release-package-", dir=destination.parent) as temporary:
        archive_path = Path(temporary) / "workspace-build.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for entry in receipt["files"]:
                content = _read_file(root, entry["path"], MAX_FILE_BYTES)
                _check_asset(content, private_values)
                if len(content) != entry["size"] or _digest(content) != entry["sha256"]:
                    raise ReleaseBuildError("A verified asset changed during packaging.")
                info = zipfile.ZipInfo(entry["path"], date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, content, compresslevel=6)
        if source_fingerprint(root) != receipt["sourceSha256"]:
            raise ReleaseBuildError("Source changed during packaging. Run verification again before publishing.")
        archive_bytes = _read_file(Path(temporary), "workspace-build.zip", MAX_ARCHIVE_BYTES)
        manifest = {**receipt, "archiveSha256": _digest(archive_bytes), "archiveSize": len(archive_bytes)}
        os.chmod(archive_path, 0o644)
        os.replace(archive_path, destination)
        _write_json_atomic(root, MANIFEST, manifest)
    print(f"Packaged {len(receipt['files'])} verified portable assets ({len(archive_bytes):,} compressed bytes).", flush=True)
    return manifest


def _archive_directory_bounds(content: bytes, expected_count: int) -> None:
    # Our bounded releases never need ZIP64, split volumes or ZIP comments.
    # Check the central directory before ZipFile allocates a record per member.
    if len(content) < 22 or content[:4] != b"PK\x03\x04" or content[-22:-18] != b"PK\x05\x06":
        raise ReleaseBuildError("The application archive has an unsupported container layout.")
    _signature, disk, directory_disk, disk_count, count, size, offset, comment_length = struct.unpack("<4s4H2IH", content[-22:])
    if (disk != 0 or directory_disk != 0 or disk_count != count or count != expected_count or count > MAX_ASSET_FILES
            or comment_length != 0 or not count * 46 <= size <= MAX_MANIFEST_BYTES or offset < 30
            or offset + size != len(content) - 22):
        raise ReleaseBuildError("The application archive directory exceeds its bounds or is inconsistent.")


def validate_release(root: Path = ROOT, private_values: tuple[bytes, ...] = (), *, staging: Path | None = None) -> dict:
    """Check the entire bounded archive before admitting it for deployment/use."""
    manifest = _validate_record(_json_object(_read_file(root, MANIFEST, MAX_MANIFEST_BYTES)), archive=True)
    if source_fingerprint(root) != manifest["sourceSha256"]:
        raise ReleaseBuildError("The portable application archive does not match the source and package lock.")
    content = _read_file(root, ARCHIVE, MAX_ARCHIVE_BYTES)
    if len(content) != manifest["archiveSize"] or _digest(content) != manifest["archiveSha256"]:
        raise ReleaseBuildError("The portable application archive failed its integrity check.")
    expected = {entry["path"]: entry for entry in manifest["files"]}
    _archive_directory_bounds(content, len(expected))
    with zipfile.ZipFile(io.BytesIO(content), "r") as archive:
        members = archive.infolist()
        if len(members) != len(expected) or len({member.filename for member in members}) != len(members):
            raise ReleaseBuildError("The application archive contains unexpected or duplicate entries.")
        for member in members:
            record = expected.get(member.filename)
            if (record is None or not _asset_name(member.filename) or member.orig_filename != member.filename
                    or member.create_system != 3 or not stat.S_ISREG(member.external_attr >> 16)
                    or member.flag_bits & 1 or member.compress_type not in {zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED}
                    or member.extra or member.comment or member.is_dir()
                    or member.file_size != record["size"] or member.compress_size > MAX_ARCHIVE_BYTES):
                raise ReleaseBuildError("The application archive contains an unsafe or inconsistent entry.")
        for member in members:
            record = expected[member.filename]
            with archive.open(member, "r") as stream:
                data = stream.read(record["size"] + 1)
                if len(data) != record["size"] or stream.read(1) or _digest(data) != record["sha256"]:
                    raise ReleaseBuildError("A portable application asset failed its integrity check.")
            _check_asset(data, private_values)
            if staging is not None:
                target = _safe_path(staging, member.filename, allow_missing=True)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with target.open("xb") as output:
                    output.write(data)
                target.chmod(0o644)
        if source_fingerprint(root) != manifest["sourceSha256"]:
            raise ReleaseBuildError("The source changed while checking the portable application archive.")
    return manifest


def restore_release_build(working: Path) -> bool:
    """An optional optimization in owned startup scratch; never a readiness gate."""
    try:
        # The caller copied source without dist. Never overwrite a directory or
        # symlink supplied by another writer, even when a package is valid.
        if os.path.lexists(working / "dist"):
            return False
        with tempfile.TemporaryDirectory(prefix=".release-extract-", dir=working) as temporary:
            staging = Path(temporary)
            validate_release(working, staging=staging)
            os.rename(staging / "dist", working / "dist")
        return True
    except (ReleaseBuildError, OSError, zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError, zlib.error):
        # Missing/stale/corrupt artifacts use the exact existing production
        # build path. No exception detail, archive content or secret is logged.
        return False


def prepare_release(root: Path = ROOT, *, skip_verify: bool, private_values: tuple[bytes, ...] = ()) -> dict:
    if not skip_verify:
        verify_build(root)
    if os.path.lexists(root / RECEIPT):
        return package_release(root, private_values)
    # CI's separate publication job receives only this verified portable
    # package, not node_modules, native output or a host-specific dependency tree.
    try:
        return validate_release(root, private_values)
    except (ReleaseBuildError, OSError, zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError, zlib.error) as error:
        raise ReleaseBuildError("No matching verified build is available. Run python3 scripts/release_build.py verify, then package, before using --skip-verify.") from error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify", "package", "check"))
    args = parser.parse_args()
    try:
        if args.command == "verify":
            verify_build()
        elif args.command == "package":
            package_release()
        else:
            validate_release()
            print("Portable application release matches the current source and package lock.", flush=True)
        return 0
    except (ValueError, OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired, zipfile.BadZipFile, RuntimeError, EOFError, zlib.error) as error:
        print(f"Portable release stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
