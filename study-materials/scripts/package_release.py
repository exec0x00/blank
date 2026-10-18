#!/usr/bin/env python3
"""Create the combined notes-first release ZIP with shared HTML assets."""
from __future__ import annotations

import hashlib
import json
import os
import re
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "study-materials"
DELIVERABLES = STUDY / "deliverables"
OUT = STUDY / "pesu-allsubjects-notes.zip"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def candidates() -> list[Path]:
    files = []
    files.extend(sorted(p for p in (STUDY / "datasets").rglob("*") if p.is_file()))
    files.extend(sorted(p for p in DELIVERABLES.rglob("*") if p.is_file()))
    for base in (STUDY / "packs", STUDY / "video-packs"):
        files.extend(sorted(base.rglob("pack.json")))
    for rel in (
        "work/unit-pack-index.json", "work/video-pack-index.json",
        "work/forge-build-summary.json",
        "inventory/coverage.md", "inventory/source-inventory.json",
        "README.md", "PLAN.md",
    ):
        path = STUDY / rel
        if path.is_file():
            files.append(path)
    script_names = (
        "author_study_notes.py", "prepare_video_packs.py", "export_study_dataset.py",
        "publish_deliverables.py", "build_all_forge_packs.py", "prepare_forge_runtime.py",
        "package_release.py",
    )
    files.extend(STUDY / "scripts" / name for name in script_names if (STUDY / "scripts" / name).is_file())
    return sorted(set(files))


def main() -> None:
    docs = json.loads((DELIVERABLES / "deliverables-index.json").read_text(encoding="utf-8"))["documents"]
    asset_files: dict[str, tuple[Path, str]] = {}
    asset_dirs = {Path(d["assets_directory"]) for d in docs}
    for asset_dir in asset_dirs:
        local = ROOT / "study-materials" / asset_dir
        if not local.is_dir():
            raise FileNotFoundError(local)
        for path in sorted(x for x in local.rglob("*") if x.is_file()):
            rel = path.relative_to(local).as_posix()
            sha = digest(path)
            if rel in asset_files and asset_files[rel][1] != sha:
                raise ValueError(f"Per-document asset differs from the shared copy: {rel}")
            asset_files.setdefault(rel, (path, sha))

    html_member_data = {}
    for record in docs:
        rel = record["html"]
        path = STUDY / rel
        parent = PurePosixPath(rel).parent
        shared = PurePosixPath(os.path.relpath(
            "deliverables/_shared-assets/assets", parent.as_posix()
        ).replace(os.sep, "/"))
        prefix = shared.as_posix().rstrip("/") + "/"
        data = re.sub(rb'((?:href|src)="|url\()assets/', lambda m: m.group(1) + prefix.encode("utf-8"), path.read_bytes())
        html_member_data[rel] = data
    assets_hash = hashlib.sha256()
    for rel, (_, sha) in sorted(asset_files.items()):
        assets_hash.update(rel.encode("utf-8"))
        assets_hash.update(b"\0")
        assets_hash.update(bytes.fromhex(sha))
    assets_bytes = sum(path.stat().st_size for path, _ in asset_files.values())

    manifest = []
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for path in candidates():
            rel = path.relative_to(STUDY).as_posix()
            if rel == "pesu-allsubjects-notes.zip":
                continue
            if any(PurePosixPath(rel).is_relative_to(asset_dir) for asset_dir in asset_dirs):
                continue
            if rel in html_member_data:
                data = html_member_data[rel]
            elif rel == "deliverables/deliverables-index.json":
                index = json.loads(path.read_text(encoding="utf-8"))
                for record in index["documents"]:
                    record["html_sha256"] = hashlib.sha256(html_member_data[record["html"]]).hexdigest()
                    record["assets_directory"] = "deliverables/_shared-assets/assets/"
                    record["asset_count"] = len(asset_files)
                    record["asset_bytes"] = assets_bytes
                    record["assets_sha256"] = assets_hash.hexdigest()
                data = json.dumps(index, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
            else:
                data = path.read_bytes()
            archive.writestr(rel, data)
            manifest.append({"path": rel, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

        for rel, (path, _) in sorted(asset_files.items()):
            name = f"deliverables/_shared-assets/assets/{rel}"
            archive.write(path, name)
            manifest.append({"path": name, "bytes": path.stat().st_size, "sha256": digest(path)})

        archive.writestr("archive-manifest.json", json.dumps({
            "schema_version": "1.0",
            "title": "PESU all-subject notes-first release",
            "status": "DRAFT: source and page-level review remains incomplete",
            "shared_html_assets": True,
            "files": manifest,
        }, ensure_ascii=False, separators=(",", ":")) + "\n")

    print(json.dumps({"zip": str(OUT.relative_to(ROOT)), "files": len(manifest),
                      "shared_assets": len(asset_files), "bytes": OUT.stat().st_size}, indent=2))


if __name__ == "__main__":
    main()
