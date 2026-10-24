#!/bin/sh
# Copy source from the fast working tree to the user's durable source directory.
# This does not attach, mount, encrypt, or change any filesystem.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
destination_dir=${1:-/data/codex-final}

python3 - "$source_dir" "$destination_dir" <<'PY'
from pathlib import Path
import fnmatch
import os
import shutil
import stat
import sys

source = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
if source == destination:
    print(f"Source already lives in {destination}.")
    raise SystemExit(0)
if source in destination.parents or destination in source.parents:
    raise SystemExit("Source and destination must be separate directories.")
skip_dirs = {".git", "node_modules", "dist", ".local-data", "test-results", "playwright-report", "coverage", "__pycache__"}
skip_files = ["*credentials*.json", "*.log", "*.pyc", "*.key", "*.pem"]
retired_files = (
    "client/components/ProviderConnection.tsx",
    "client/components/provider.css",
    "client/components/chat/AgentsPanel.tsx",
)
copied = 0
for directory, names, filenames in os.walk(source, followlinks=False):
    names[:] = [name for name in names if name not in skip_dirs and not (Path(directory) / name).is_symlink()]
    relative = Path(directory).relative_to(source)
    target_directory = destination / relative
    if any((destination / Path(*relative.parts[:index])).is_symlink() for index in range(1, len(relative.parts) + 1)):
        raise SystemExit(f"Refusing to follow a destination directory symlink: {target_directory}")
    target_directory.mkdir(parents=True, exist_ok=True)
    for filename in filenames:
        if filename.startswith(".env") and filename != ".env.example":
            continue
        if any(fnmatch.fnmatch(filename, pattern) for pattern in skip_files):
            continue
        src = Path(directory) / filename
        if src.is_symlink():
            continue
        target = target_directory / filename
        if target.is_symlink():
            raise SystemExit(f"Refusing to overwrite a destination symlink: {target}")
        src_stat = src.stat()
        if target.exists():
            target_stat = target.stat()
            if src_stat.st_size == target_stat.st_size and src_stat.st_mtime_ns == target_stat.st_mtime_ns:
                continue
        shutil.copy2(src, target)
        copied += 1
removed = 0
for relative in retired_files:
    parts = Path(relative).parts
    if any((source / Path(*parts[:index])).is_symlink() for index in range(1, len(parts))):
        raise SystemExit(f"Refusing to infer a retired file through a source directory symlink: {relative}")
    if os.path.lexists(source / relative):
        continue
    if any((destination / Path(*parts[:index])).is_symlink() for index in range(1, len(parts))):
        raise SystemExit(f"Refusing to remove a retired file through a destination directory symlink: {relative}")
    target = destination / relative
    try:
        target_stat = target.lstat()
    except FileNotFoundError:
        continue
    if not stat.S_ISREG(target_stat.st_mode):
        raise SystemExit(f"Refusing to remove an unexpected object at the retired file path: {target}")
    target.unlink()
    removed += 1
print(f"Synchronized {copied} source files to {destination}; removed {removed} retired application files; local data and credentials excluded.")
PY
