#!/usr/bin/env python3
"""Check the dedicated public download bucket without touching workspace data.

The default check is read-only. --round-trip creates only two tiny, uniquely
named verification objects and deletes those same objects in a finally block.
This deployment check is separate from the TypeScript application runtime.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import tempfile
import time
from urllib.parse import quote
from urllib.request import Request, urlopen


BUCKET = "alvin3y12/codex-downloads"
HUB = "https://huggingface.co"
RETENTION = timedelta(hours=24)


def public_request(url: str, *, method: str = "GET") -> tuple[bytes, dict[str, str], int]:
    request = Request(url, method=method, headers={"User-Agent": "codex-workspace-bucket-check/1"})
    with urlopen(request, timeout=30) as response:
        return response.read(), dict(response.headers.items()), response.status


def read_token(credentials_file: Path | None) -> str:
    token = os.environ.get("HF_DOWNLOAD_TOKEN") or os.environ.get("HF_TOKEN")
    if not token and credentials_file is not None:
        metadata = credentials_file.stat()
        if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600:
            raise ValueError("The external credentials file must be a regular file with mode 0600.")
        data = json.loads(credentials_file.read_text())
        token = data.get("hfDownloadToken") or data.get("hfToken")
    if not isinstance(token, str) or not token.startswith("hf_"):
        raise ValueError("Round-trip verification needs HF_DOWNLOAD_TOKEN or a mode-0600 external credentials file.")
    return token


def safe_error(error: Exception, token: str | None) -> str:
    message = str(error)
    if token:
        message = message.replace(token, "[redacted]")
    return re.sub(r"hf_[A-Za-z0-9_\-]+", "[redacted]", message)[:1000]


def check_public_bucket() -> dict[str, object]:
    body, _, status = public_request(f"{HUB}/api/buckets/{BUCKET}")
    info = json.loads(body)
    if status != 200 or info.get("private") is not False:
        raise RuntimeError("The dedicated download bucket is unavailable or is not public.")
    return {"bucket": BUCKET, "public": True, "anonymousMetadataStatus": status}


def round_trip(token: str) -> dict[str, object]:
    from huggingface_hub import HfApi
    from huggingface_hub.utils import disable_progress_bars

    disable_progress_bars()
    api = HfApi(token=token)
    prefix = f"verification/{secrets.token_hex(16)}"
    original = f"{prefix}/round-trip.txt"
    copied = f"{prefix}/copy-check.txt"
    owned_paths = [original, copied]
    payload = b"Arc Workspace temporary public download-bucket verification.\n"
    started_at = datetime.now(timezone.utc)
    result: dict[str, object] = {}
    try:
        with tempfile.TemporaryDirectory(prefix="codex-download-check-") as directory:
            local = Path(directory) / "round-trip.txt"
            local.write_bytes(payload)
            old_timestamp = (started_at - timedelta(days=7)).timestamp()
            os.utime(local, (old_timestamp, old_timestamp))
            started = time.monotonic()
            api.batch_bucket_files(BUCKET, add=[(local, original)])
            result["uploadMilliseconds"] = round((time.monotonic() - started) * 1000)

        entries = list(api.get_bucket_paths_info(BUCKET, [original], token=False))
        if len(entries) != 1 or entries[0].size != len(payload):
            raise RuntimeError("Uploaded object metadata is missing or its size differs.")
        entry = entries[0]
        if entry.uploaded_at is None or entry.uploaded_at < started_at - timedelta(minutes=1):
            raise RuntimeError("The bucket did not return a fresh server upload timestamp.")
        if entry.mtime is None or entry.mtime >= started_at - RETENTION:
            raise RuntimeError("The old source modification-time fixture was not preserved.")
        result["retentionTimestamp"] = "uploadedAt"
        result["oldSourceMtimeIsFreshUpload"] = True

        direct_url = f"{HUB}/buckets/{BUCKET}/resolve/{quote(original, safe='/')}?download=true"
        _, head_headers, head_status = public_request(direct_url, method="HEAD")
        if head_status != 200:
            raise RuntimeError("Anonymous direct HEAD did not resolve successfully.")
        disposition = next((v for k, v in head_headers.items() if k.lower() == "content-disposition"), "")
        if not disposition.startswith("attachment;") or "round-trip.txt" not in disposition:
            raise RuntimeError("The bucket direct link did not request an attachment with the expected filename.")
        body, _, get_status = public_request(direct_url)
        if get_status != 200 or body != payload:
            raise RuntimeError("Anonymous direct download did not match the original bytes.")
        result["anonymousHeadStatus"] = head_status
        result["anonymousDownloadStatus"] = get_status
        result["sha256"] = hashlib.sha256(body).hexdigest()

        api.batch_bucket_files(BUCKET, copy=[("bucket", BUCKET, entry.xet_hash, copied)])
        copy_url = f"{HUB}/buckets/{BUCKET}/resolve/{quote(copied, safe='/')}?download=true"
        copy_body, _, copy_status = public_request(copy_url)
        if copy_status != 200 or copy_body != payload:
            raise RuntimeError("The server-side copy did not match the original bytes.")
        result["serverSideCopy"] = True
    finally:
        # This list is generated locally for this invocation; it never includes
        # arbitrary bucket entries, another bucket, or any workspace data path.
        api.batch_bucket_files(BUCKET, delete=owned_paths)
        remaining = list(api.get_bucket_paths_info(BUCKET, owned_paths, token=False))
        if remaining:
            raise RuntimeError("Verification-object cleanup failed; no unrelated objects were deleted.")
        result["verificationObjectsDeleted"] = True
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--round-trip", action="store_true", help="Upload, copy, download, and delete tiny verification objects.")
    parser.add_argument("--credentials-file", type=Path, help="External mode-0600 deployment credentials JSON; never copied or printed.")
    arguments = parser.parse_args()
    token = None
    try:
        result = check_public_bucket()
        if arguments.round_trip:
            token = read_token(arguments.credentials_file)
            result.update(round_trip(token))
        print(json.dumps(result, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({"error": safe_error(error, token)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
