#!/usr/bin/env python3
"""Check live Space visibility, native volume, environment, and access controls."""

from __future__ import annotations

import argparse
from datetime import datetime
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener

from huggingface_hub import HfApi
from huggingface_hub.errors import HfHubHTTPError

DOWNLOAD_BUCKET = "alvin3y12/codex-downloads"


def get(url: str, *, accept: str = "application/json") -> tuple[int, bytes]:
    request = Request(url, headers={"Accept": accept, "User-Agent": "Arc-Workspace-Check/1.0"})
    try:
        with build_opener(ProxyHandler({})).open(request, timeout=25) as response:
            return response.status, response.read(65536)
    except HTTPError as error:
        return error.code, error.read(65536)


def authenticated_checks(url: str, password: str, bucket: str, download_bucket: str | None = None) -> dict[str, bool]:
    opener = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))

    def request(path: str, method: str = "GET", body: dict | None = None) -> tuple[int, dict]:
        encoded = json.dumps(body).encode() if body is not None else None
        headers = {"Accept": "application/json", "Origin": url, "X-Codex-Workspace": "1"}
        if encoded is not None:
            headers["Content-Type"] = "application/json"
        call = Request(f"{url}/api/{path}", method=method, data=encoded, headers=headers)
        try:
            with opener.open(call, timeout=25) as response:
                data = response.read(65536)
                payload = json.loads(data) if data else {}
                return response.status, payload if isinstance(payload, dict) else {}
        except HTTPError as error:
            return error.code, {}

    checks: dict[str, bool] = {}
    login_code, session = request("session", "POST", {"password": password})
    checks["password_login"] = login_code == 200 and session.get("authenticated") is True
    if not checks["password_login"]:
        return checks
    try:
        provider_code, provider = request("provider/status")
        checks["authenticated_provider_status"] = (
            provider_code == 200 and provider.get("method") in {"api-key", "chatgpt"}
            and isinstance(provider.get("apiKeyConfigured"), bool)
            and isinstance(provider.get("chatgptConnected"), bool)
            and all(name not in provider for name in ["token", "accessToken", "refreshToken", "apiKey"])
        )
        storage_code, storage = request("storage")
        checks["authenticated_native_storage"] = (
            storage_code == 200 and storage.get("path") == "/data"
            and storage.get("persistent") is True and storage.get("writable") is True
            and storage.get("bucket") == bucket
        )
        metadata = storage.get("metadata") or {}
        checks["file_metadata_initialized"] = (
            isinstance(metadata, dict) and metadata.get("initialized") is True
            and metadata.get("error") is None and metadata.get("issueCount") == 0
        )
        if download_bucket is not None:
            download_code, downloads = request("downloads/status")
            checks["download_service_ready"] = (
                download_code == 200 and downloads.get("enabled") is True and downloads.get("ready") is True
                and downloads.get("state") == "ready" and downloads.get("bucket") == download_bucket
                and not downloads.get("error")
            )
            cleanup = downloads.get("lastCleanupAt")
            try:
                valid_cleanup = isinstance(cleanup, str) and datetime.fromisoformat(cleanup.replace("Z", "+00:00")).tzinfo is not None
            except ValueError:
                valid_cleanup = False
            checks["download_cleanup_timestamp"] = valid_cleanup and downloads.get("unknownTimestampCount") == 0
            checks["download_status_safe_fields"] = set(downloads).issubset({
                "enabled", "ready", "state", "bucket", "lastCleanupAt", "unknownTimestampCount", "error",
            })
    finally:
        logout_code, session = request("session", "DELETE")
        checks["logout"] = logout_code == 200 and session.get("authenticated") is False
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--space", default=os.environ.get("HF_SPACE_ID", "alvin3y12/codex-workspace"))
    parser.add_argument("--bucket", default=os.environ.get("HF_BUCKET", "alvin3y12/data"))
    parser.add_argument("--credentials-file", type=Path)
    parser.add_argument("--url", help="Override the public application URL")
    parser.add_argument("--authenticated", action="store_true", help="Also check login, provider/storage routes, and logout")
    parser.add_argument("--downloads", action="store_true", help="Require the configured public download service; includes authenticated checks")
    parser.add_argument("--expected-commit", help="Require this source and running runtime commit")
    args = parser.parse_args()
    try:
        supplied = json.loads(args.credentials_file.read_text()) if args.credentials_file else {}
        token = os.environ.get("HF_TOKEN") or supplied.get("hfToken")
        password = os.environ.get("WORKSPACE_PASSWORD") or supplied.get("workspacePassword")
        if not token:
            raise ValueError("Set HF_TOKEN or provide --credentials-file to inspect native volume and secret names.")
        authenticate = args.authenticated or args.downloads
        if authenticate and not password:
            raise ValueError("Authenticated checks require WORKSPACE_PASSWORD or workspacePassword in the external credentials file.")
        api = HfApi(token=token)
        info = api.space_info(args.space)
        runtime = api.get_space_runtime(args.space)
        bucket = api.bucket_info(args.bucket)
        variables = api.get_space_variables(args.space)
        secret_names = api.get_space_secrets(args.space)
        volumes = (info.runtime.volumes if info.runtime is not None else None) or []
        downloads_configured = "HF_DOWNLOAD_BUCKET" in variables or "HF_DOWNLOAD_TOKEN" in secret_names or "HF_DOWNLOAD_TOKEN" in variables
        check_downloads = args.downloads or downloads_configured
        checks = {
            "space_public": info.private is False,
            "zerogpu_entrypoint_sdk": info.sdk == "gradio",
            "zerogpu_hardware": runtime.hardware == "zero-a10g" and runtime.requested_hardware == "zero-a10g",
            "bucket_public": bucket.private is False,
            "native_data_volume": any(volume.type == "bucket" and volume.source == args.bucket and volume.mount_path == "/data" and volume.read_only is not True for volume in volumes),
            "required_secrets_present": all(key in secret_names for key in ["WORKSPACE_PASSWORD", "SESSION_SECRET", "ENCRYPTION_KEY"]),
            # This checks only the environment name. HF_DOWNLOAD_TOKEN is an
            # explicitly authorized server writer and may hold the supplied Hub
            # credential; its presence must not be described as token absence.
            "hf_token_environment_not_set": "HF_TOKEN" not in secret_names and "HF_TOKEN" not in variables,
            "persistent_data_required": variables.get("REQUIRE_PERSISTENT_DATA") is not None and variables["REQUIRE_PERSISTENT_DATA"].value == "1",
            "data_directory": variables.get("DATA_DIR") is not None and variables["DATA_DIR"].value == "/data",
            "runtime_running": runtime.stage == "RUNNING",
            "running_source_matches_repository": bool(info.sha) and runtime.raw.get("sha") == info.sha,
        }
        if args.expected_commit:
            checks["expected_commit_running"] = info.sha == args.expected_commit and runtime.raw.get("sha") == args.expected_commit
        if check_downloads:
            checks["download_bucket_variable"] = variables.get("HF_DOWNLOAD_BUCKET") is not None and variables["HF_DOWNLOAD_BUCKET"].value == DOWNLOAD_BUCKET
            checks["download_writer_secret_present"] = "HF_DOWNLOAD_TOKEN" in secret_names
            checks["download_writer_not_public_variable"] = "HF_DOWNLOAD_TOKEN" not in variables
            checks["download_bucket_public"] = api.bucket_info(DOWNLOAD_BUCKET).private is False
        url = args.url or info.host or f"https://{args.space.replace('/', '-')}.hf.space"
        if not url.startswith(("https://", "http://")):
            url = f"https://{url}"
        url = url.rstrip("/")
        if checks["runtime_running"]:
            root_code, root_body = get(f"{url}/")
            workspace_code, workspace_body = get(f"{url}/work", accept="text/html")
            health_code, health_body = get(f"{url}/health")
            protected_code, _ = get(f"{url}/api/bootstrap")
            provider_code, _ = get(f"{url}/api/provider/status")
            storage_code, _ = get(f"{url}/api/storage")
            session_code, session_body = get(f"{url}/api/session")
            checks["health"] = health_code == 200
            checks["root_status_only"] = root_code == 200 and root_body == b"status: ok"
            checks["arc_workspace_entry"] = (workspace_code == 200 and b'<title>Arc Workspace</title>' in workspace_body
                                             and b'id="root"' in workspace_body)
            checks["workspace_requires_login"] = protected_code == 401
            checks["provider_requires_login"] = provider_code == 401
            checks["storage_requires_login"] = storage_code == 401
            if check_downloads:
                download_code, _ = get(f"{url}/api/downloads/status")
                checks["downloads_require_login"] = download_code == 401
            try:
                checks["anonymous_session"] = session_code == 200 and json.loads(session_body).get("authenticated") is False
            except (ValueError, AttributeError):
                checks["anonymous_session"] = False
            if health_code == 200:
                try:
                    checks["health_no_sensitive_data"] = isinstance(json.loads(health_body), dict) and all(key not in json.loads(health_body) for key in ["password", "sessionSecret", "encryptionKey", "apiKey", "token"])
                except (ValueError, TypeError):
                    checks["health_no_sensitive_data"] = False
            if authenticate:
                checks.update(authenticated_checks(url, password, args.bucket, DOWNLOAD_BUCKET if check_downloads else None))
        else:
            checks["health"] = False
            checks["workspace_requires_login"] = False
        credential_use = {
            "HF_TOKEN": "environment present" if "HF_TOKEN" in secret_names or "HF_TOKEN" in variables else "environment not configured",
            "HF_DOWNLOAD_TOKEN": "authorized server download writer" if "HF_DOWNLOAD_TOKEN" in secret_names else "secret not configured",
        }
        print(json.dumps({"space": args.space, "url": url, "source_commit": info.sha, "runtime_commit": runtime.raw.get("sha"), "runtime_stage": runtime.stage,
            "hub_credential_use": credential_use, "download_readiness_checked": check_downloads and authenticate and checks["runtime_running"],
            "checks": checks, "passed": all(checks.values())}, indent=2))
        return 0 if all(checks.values()) else 1
    except HfHubHTTPError as error:
        status = error.response.status_code if error.response is not None else "unknown"
        print(f"Space check failed: Hugging Face returned HTTP {status}.", file=sys.stderr)
        return 1
    except (ValueError, OSError, URLError) as error:
        print(f"Space check failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
