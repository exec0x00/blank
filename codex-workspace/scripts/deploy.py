#!/usr/bin/env python3
"""Publish the application and configure HF's native public bucket attachment.

Requires huggingface_hub==1.16.1. Run from any directory; repository location is
derived from this file. Secrets are read from environment or an external 0600
JSON file and are never printed, copied into source, or uploaded as files.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import zipfile
import zlib

from huggingface_hub import HfApi, Volume, hf_hub_download
from huggingface_hub.errors import HfHubHTTPError, RepositoryNotFoundError

if __package__:
    from .release_build import prepare_release, validate_release
else:
    from release_build import prepare_release, validate_release


ROOT = Path(__file__).resolve().parents[1]
DOWNLOAD_BUCKET = "alvin3y12/codex-downloads"
ALLOW_PATTERNS = [
    "README.md", "AGENTS.md", "LICENSE", "NOTICE", "Dockerfile", ".dockerignore",
    "app.py", "requirements.txt", "packages.txt",
    ".gitignore", ".env.example", "package.json", "package-lock.json", "index.html",
    "tsconfig*.json", "vite.config.*", "vitest.config.*", "playwright.config.*",
    "client/**", "server/**", "shared/**", "public/**", "native/**", "scripts/**", "docs/**",
    "tests/**", "upstream/**", ".github/workflows/**",
    "release/workspace-build.json", "release/workspace-build.zip",
]
IGNORE_PATTERNS = [
    "**/.git/**", "**/node_modules/**", "**/dist/**", "**/__pycache__/**", "*.pyc",
    ".env", ".env.local", ".env.production", ".env.development", ".env.test",
    "**/.env", "**/.env.*",
    "**/.local-data/**", "**/test-results/**", "**/playwright-report/**",
    "**/*credentials*.json", "**/*.log", "**/*.key", "**/*.pem",
]
VARIABLES = {
    "DATA_DIR": "/data",
    "REQUIRE_PERSISTENT_DATA": "1",
    "PORT": "7860",
    "NODE_ENV": "production",
}
# Only these application-owned files have an explicit retirement instruction.
# Publishing new source must preserve every other existing remote file.
RETIRED_SOURCE_FILES = (
    "client/components/ProviderConnection.tsx",
    "client/components/provider.css",
    "client/components/chat/AgentsPanel.tsx",
)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--space", default=os.environ.get("HF_SPACE_ID", "alvin3y12/codex-workspace"))
    parser.add_argument("--bucket", default=os.environ.get("HF_BUCKET", "alvin3y12/data"))
    parser.add_argument("--credentials-file", type=Path, help="External mode-0600 JSON with hfToken/workspacePassword")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--configure-only", action="store_true", help="Configure the Space without uploading source")
    mode.add_argument("--source-only", action="store_true", help="Publish to an existing Space without changing any settings")
    mode.add_argument("--configure-downloads", action="store_true", help="Initialize the authorized writer from HF_DOWNLOAD_TOKEN or the supplied Hub credential after the new bootstrap is running")
    parser.add_argument("--expected-commit", help="Exact running source SHA required by --configure-downloads")
    parser.add_argument("--parent-commit", help="Publish only if the Space source still matches this exact commit")
    parser.add_argument("--skip-verify", action="store_true", help="Require a matching receipt or portable package from scripts/release_build.py verify")
    parser.add_argument("--message", default="Update Arc Workspace")
    args = parser.parse_args()
    if args.configure_downloads and not re.fullmatch(r"[a-f0-9]{40}", args.expected_commit or ""):
        parser.error("--configure-downloads requires --expected-commit with the exact 40-character source SHA.")
    if args.expected_commit and not args.configure_downloads:
        parser.error("--expected-commit belongs to the separate --configure-downloads step.")
    if args.parent_commit and (not re.fullmatch(r"[a-f0-9]{40}", args.parent_commit) or args.configure_only or args.configure_downloads):
        parser.error("--parent-commit requires an exact 40-character source SHA and a source publication.")
    return args


def credentials(path: Path | None) -> tuple[str, str | None]:
    supplied: dict[str, str] = {}
    if path is not None:
        resolved = path.resolve()
        if resolved == ROOT or ROOT in resolved.parents:
            raise ValueError("The credentials file must be outside the source directory.")
        if stat.S_IMODE(resolved.stat().st_mode) & 0o077:
            raise ValueError("The credentials file must have mode 0600 or stricter.")
        supplied = json.loads(resolved.read_text())
    token = os.environ.get("HF_TOKEN") or supplied.get("hfToken")
    password = os.environ.get("WORKSPACE_PASSWORD") or supplied.get("workspacePassword")
    if not token:
        raise ValueError("Set HF_TOKEN or supply an external --credentials-file.")
    if password is not None and len(password) < 8:
        raise ValueError("WORKSPACE_PASSWORD must contain at least 8 characters.")
    return token, password


def source_files() -> list[Path]:
    # Use the Hub's matcher so validation covers exactly what upload_folder sees.
    from huggingface_hub.utils import filter_repo_objects
    candidates = []
    for directory, names, filenames in os.walk(ROOT, followlinks=False):
        names[:] = [name for name in names if name not in {".git", "node_modules", ".local-data", "dist", "__pycache__"}]
        for filename in filenames:
            path = Path(directory) / filename
            candidates.append(path.relative_to(ROOT).as_posix())
    accepted = filter_repo_objects(candidates, allow_patterns=ALLOW_PATTERNS, ignore_patterns=IGNORE_PATTERNS)
    return [ROOT / relative for relative in accepted]


def validate_source(token: str, password: str | None) -> None:
    for name in ["app.py", "requirements.txt", "packages.txt", "README.md", "package-lock.json", "server/index.ts", "index.html"]:
        if not (ROOT / name).is_file():
            raise ValueError(f"Application source is incomplete: missing {name}.")
    private_values = [value.encode() for value in [token, password, os.environ.get("SESSION_SECRET"), os.environ.get("ENCRYPTION_KEY"), os.environ.get("HF_DOWNLOAD_TOKEN")] if value]
    for path in source_files():
        if path.is_symlink():
            raise ValueError(f"Refusing to publish a source symlink: {path.relative_to(ROOT)}")
        content = path.read_bytes()
        if re.fullmatch(rb"version https://git-lfs.github.com/spec/v1\r?\noid sha256:[a-f0-9]{64}\r?\nsize [0-9]+\r?\n?", content):
            raise ValueError(f"Unresolved Git LFS pointer in {path.relative_to(ROOT)}; fetch and verify the actual file before publishing.")
        if any(value in content for value in private_values):
            raise ValueError(f"A deployment secret occurs in {path.relative_to(ROOT)}; upload stopped.")


def plan_retired_deletions(remote_files: list[str], source_root: Path | None = None) -> list[str]:
    """Delete only explicitly retired files that are absent from local source."""
    root = source_root or ROOT
    remote = set(remote_files)
    retired = []
    for relative in RETIRED_SOURCE_FILES:
        parts = Path(relative).parts
        if any((root / Path(*parts[:index])).is_symlink() for index in range(1, len(parts))):
            raise ValueError(f"Cannot determine retired source through a directory symlink: {relative}")
        # lexists also recognizes a directory or dangling symlink as present.
        # Source validation handles invalid upload entries without deleting the
        # existing remote file merely because Path.exists() would return false.
        if relative in remote and not os.path.lexists(root / relative):
            retired.append(relative)
    return retired


def configure(api: HfApi, space: str, bucket: str, password: str | None) -> None:
    # The user explicitly selected public, unencrypted workspace storage.
    bucket_info = api.bucket_info(bucket)
    if bucket_info.private:
        raise ValueError(f"{bucket} is private; this deployment expects the user's public bucket. No visibility was changed.")

    values = {**VARIABLES, "HF_BUCKET": bucket}
    try:
        info = api.space_info(space)
    except RepositoryNotFoundError:
        if password is None:
            raise ValueError("A new Space requires WORKSPACE_PASSWORD to initialize its login secret.") from None
        api.create_repo(
            repo_id=space, repo_type="space", space_sdk="gradio", space_hardware="zero-a10g", private=False, exist_ok=True,
            space_secrets=[
                {"key": "WORKSPACE_PASSWORD", "value": password},
                {"key": "SESSION_SECRET", "value": secrets.token_hex(32)},
                {"key": "ENCRYPTION_KEY", "value": secrets.token_hex(32)},
            ],
            space_variables=[{"key": key, "value": value} for key, value in values.items()],
        )
        info = api.space_info(space)

    if info.sdk != "gradio":
        raise ValueError(f"{space} uses SDK {info.sdk!r}; expected the Gradio SDK for its minimal ZeroGPU entry point.")
    if info.private:
        api.update_repo_settings(space, repo_type="space", private=False)

    present_secrets = api.get_space_secrets(space)
    required = {"SESSION_SECRET": lambda: secrets.token_hex(32), "ENCRYPTION_KEY": lambda: secrets.token_hex(32)}
    if "WORKSPACE_PASSWORD" not in present_secrets:
        if password is None:
            raise ValueError("Set WORKSPACE_PASSWORD to initialize the Space login secret.")
        api.add_space_secret(space, "WORKSPACE_PASSWORD", password)
    for key, generate in required.items():
        if key not in present_secrets:
            api.add_space_secret(space, key, generate())
    # Existing values are intentionally retained. Rotating ENCRYPTION_KEY would
    # make previously connected account credentials unreadable.
    present_variables = api.get_space_variables(space)
    for key, value in values.items():
        if key not in present_variables or present_variables[key].value != value:
            api.add_space_variable(space, key, value)

    expected = Volume(type="bucket", source=bucket, mount_path="/data", read_only=False)
    runtime = api.get_space_runtime(space)
    if runtime.requested_hardware != "zero-a10g":
        api.request_space_hardware(space, hardware="zero-a10g")
    # The dedicated /runtime endpoint omits configured volumes. Space metadata
    # includes them under info.runtime, even before the app has started.
    volumes = (info.runtime.volumes if info.runtime is not None else None) or []
    current = next((volume for volume in volumes if volume.mount_path == "/data"), None)
    if current is None or current.source != bucket or current.type != "bucket" or current.read_only is True:
        # Preserve unrelated native volume attachments; replace only /data.
        api.set_space_volumes(space, [volume for volume in volumes if volume.mount_path != "/data"] + [expected])
    print(f"Configured public Space {space}; native read-write bucket {bucket} at /data.")
    print("Workspace files remain unencrypted. Existing password and account-protection keys were preserved.")


def validate_existing_space(api: HfApi, space: str, bucket: str) -> None:
    """Read-only preflight for normal source updates to an existing instance."""
    info = api.space_info(space)
    runtime = api.get_space_runtime(space)
    volumes = (info.runtime.volumes if info.runtime is not None else None) or []
    variables = api.get_space_variables(space)
    secret_names = api.get_space_secrets(space)
    expected_variables = {**VARIABLES, "HF_BUCKET": bucket}
    checks = {
        "public ZeroGPU Space": info.private is False and info.sdk == "gradio" and runtime.requested_hardware == "zero-a10g",
        "public bucket": api.bucket_info(bucket).private is False,
        "native read-write /data volume": any(volume.type == "bucket" and volume.source == bucket and volume.mount_path == "/data" and volume.read_only is not True for volume in volumes),
        "required secret names": all(key in secret_names for key in ["WORKSPACE_PASSWORD", "SESSION_SECRET", "ENCRYPTION_KEY"]),
        "required storage/runtime variables": all(key in variables and variables[key].value == value for key, value in expected_variables.items()),
    }
    missing = [name for name, passed in checks.items() if not passed]
    if missing:
        raise ValueError("Source-only preflight failed: " + ", ".join(missing) + ". No settings were changed.")
    print(f"Verified existing public ZeroGPU Space {space}. All settings remain unchanged.")


def bootstrap_scrubs_download_token(source: bytes) -> bool:
    """Recognize the reviewed build-environment scrub in the startup entry point."""
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return False
    main = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main"), None)
    if main is None:
        return False
    for node in ast.walk(main):
        if not isinstance(node, ast.For) or not isinstance(node.target, ast.Name) or not isinstance(node.iter, (ast.List, ast.Tuple)):
            continue
        if not any(isinstance(value, ast.Constant) and value.value == "HF_DOWNLOAD_TOKEN" for value in node.iter.elts):
            continue
        for statement in node.body:
            call = statement.value if isinstance(statement, ast.Expr) else None
            if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                and isinstance(call.func.value, ast.Name) and call.func.value.id == "build_environment"
                and call.func.attr == "pop" and call.args and isinstance(call.args[0], ast.Name)
                and call.args[0].id == node.target.id):
                return True
    return False


def configure_downloads(api: HfApi, space: str, bucket: str, writer_token: str, expected_commit: str) -> None:
    """Configure downloads separately, after the verified new code is serving.

    This mode never publishes source or changes hardware, native volumes, bucket
    visibility, the workspace password, or the session/account-protection keys.
    The authorized writer may be the same supplied Hub token used to publish.
    """
    if not re.fullmatch(r"[a-f0-9]{40}", expected_commit or "") or not writer_token:
        raise ValueError("An exact expected commit and authorized download writer token are required.")
    validate_existing_space(api, space, bucket)
    info = api.space_info(space)
    runtime = api.get_space_runtime(space)
    if runtime.stage != "RUNNING" or info.sha != expected_commit or runtime.raw.get("sha") != expected_commit:
        raise ValueError("The expected source commit must be RUNNING before adding the download credential. No settings were changed.")

    local_bootstrap = (ROOT / "app.py").read_bytes()
    if not bootstrap_scrubs_download_token(local_bootstrap):
        raise ValueError("The local bootstrap does not contain the reviewed HF_DOWNLOAD_TOKEN build scrub. No settings were changed.")
    # Read the immutable public revision, then compare it with the reviewed local
    # release. Never add this secret while the previous bootstrap is still live.
    remote_path = hf_hub_download(space, "app.py", repo_type="space", revision=expected_commit, token=False)
    remote_bootstrap = Path(remote_path).read_bytes()
    if hashlib.sha256(remote_bootstrap).digest() != hashlib.sha256(local_bootstrap).digest():
        raise ValueError("The running bootstrap does not match this reviewed release. No settings were changed.")
    if DOWNLOAD_BUCKET == bucket or api.bucket_info(DOWNLOAD_BUCKET).private is not False:
        raise ValueError("Downloads require the separate public codex-downloads bucket. No bucket settings were changed.")

    variables = api.get_space_variables(space)
    secret_names = api.get_space_secrets(space)
    if "HF_DOWNLOAD_TOKEN" in variables:
        raise ValueError("HF_DOWNLOAD_TOKEN must be stored as a Space secret, not a public variable. No settings were changed.")
    core = ["WORKSPACE_PASSWORD", "SESSION_SECRET", "ENCRYPTION_KEY"]
    before = {name: vars(secret_names[name]).copy() if hasattr(secret_names[name], "__dict__") else secret_names[name] for name in core}
    if "HF_DOWNLOAD_BUCKET" not in variables or variables["HF_DOWNLOAD_BUCKET"].value != DOWNLOAD_BUCKET:
        api.add_space_variable(space, "HF_DOWNLOAD_BUCKET", DOWNLOAD_BUCKET)
        print("HF_DOWNLOAD_BUCKET variable: updated.")
    else:
        print("HF_DOWNLOAD_BUCKET variable: preserved.")
    if "HF_DOWNLOAD_TOKEN" not in secret_names:
        api.add_space_secret(space, "HF_DOWNLOAD_TOKEN", writer_token, description="Authorized server-side writer for the separate public download bucket.")
        print("HF_DOWNLOAD_TOKEN secret: initialized for authorized download writing.")
    else:
        print("HF_DOWNLOAD_TOKEN secret: preserved.")
    after_names = api.get_space_secrets(space)
    after_variables = api.get_space_variables(space)
    if ("HF_DOWNLOAD_TOKEN" not in after_names or "HF_DOWNLOAD_BUCKET" not in after_variables
        or after_variables["HF_DOWNLOAD_BUCKET"].value != DOWNLOAD_BUCKET):
        raise ValueError("The platform has not confirmed both download settings. Inspect their state before retrying.")
    after = {name: vars(after_names[name]).copy() if hasattr(after_names[name], "__dict__") else after_names[name] for name in core}
    print("Core secret metadata unchanged: " + str(before == after).lower() + ".")


def main() -> int:
    args = arguments()
    operation = "deployment preparation"
    try:
        token, password = credentials(args.credentials_file)
        publish_source = not (args.configure_only or args.configure_downloads)
        if publish_source:
            validate_source(token, password)
            operation = "application verification and release packaging"
            private_values = tuple(value.encode() for value in [token, password, os.environ.get("SESSION_SECRET"),
                                    os.environ.get("ENCRYPTION_KEY"), os.environ.get("HF_DOWNLOAD_TOKEN")] if value)
            prepare_release(ROOT, skip_verify=args.skip_verify, private_values=private_values)
            # Also scan newly generated release files. Compressed asset contents
            # are separately checked by the release helper before publication.
            validate_source(token, password)
        api = HfApi(token=token)
        if args.configure_downloads:
            operation = "download service configuration"
            configure_downloads(api, args.space, args.bucket, os.environ.get("HF_DOWNLOAD_TOKEN") or token, args.expected_commit)
        elif args.source_only:
            operation = "read-only Space validation"
            validate_existing_space(api, args.space, args.bucket)
        else:
            operation = "Space configuration"
            configure(api, args.space, args.bucket, password)
        if publish_source:
            operation = "source file inspection"
            removed_files = plan_retired_deletions(api.list_repo_files(args.space, repo_type="space"))
            validate_release(ROOT, private_values)
            operation = "source publication"
            commit = api.upload_folder(
                repo_id=args.space, repo_type="space", folder_path=ROOT,
                allow_patterns=ALLOW_PATTERNS, ignore_patterns=IGNORE_PATTERNS,
                delete_patterns=removed_files or None,
                commit_message=args.message,
                parent_commit=args.parent_commit,
            )
            print(f"Published source commit {commit.oid}.")
            if removed_files:
                print("Removed retired application files: " + ", ".join(removed_files))
        operation = "runtime status check"
        runtime = api.get_space_runtime(args.space)
        print(f"Runtime stage: {runtime.stage}")
        print(f"Space: https://huggingface.co/spaces/{args.space}")
        print("Run python3 scripts/check-space.py to verify the live service after its build.")
        return 0
    except HfHubHTTPError as error:
        status = error.response.status_code if error.response is not None else "unknown"
        print(f"Hugging Face rejected {operation} with HTTP {status}.", file=sys.stderr)
        reason = getattr(error, "server_message", None)
        if reason:
            for value in [token, password, os.environ.get("HF_DOWNLOAD_TOKEN")]:
                if value:
                    reason = reason.replace(value, "[REDACTED]")
            print("Platform reason: " + " ".join(reason.split())[:1000], file=sys.stderr)
        return 1
    except (ValueError, OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired, zipfile.BadZipFile, RuntimeError, EOFError, zlib.error) as error:
        print(f"Deployment stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
