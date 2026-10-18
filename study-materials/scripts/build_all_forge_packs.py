#!/usr/bin/env python3
"""Build every unit master and standalone video project with PDF Study Forge."""
from __future__ import annotations
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
FORGE = ROOT / "study-materials/work/runtime/pdf-study-forge/scripts/forge.py"
UNIT_INDEX = ROOT / "study-materials/work/unit-pack-index.json"
VIDEO_INDEX = ROOT / "study-materials/work/video-pack-index.json"
LOG_DIR = ROOT / "study-materials/work/build-logs"


def file_sha(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def build(project_rel: str, family: str, number: int, total: int) -> dict:
    project = ROOT / project_rel
    out = project / "output"
    pack = project / "pack.json"
    current_sha = file_sha(pack)
    report_path = out / "quality-report.json"
    if report_path.exists():
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
            current_assets = {x["file"] for x in json.loads(pack.read_text(encoding="utf-8")).get("FIGS", [])}
            current_assets.update(x["local_path"] for x in json.loads(pack.read_text(encoding="utf-8"))["PACK"]["sources"] if x.get("availability") == "available")
            asset_shas = {name: file_sha(project / name) for name in sorted(current_assets)}
            if (report.get("input_sha256") == current_sha and report.get("input_assets") == asset_shas
                    and report.get("draft") is True and report.get("status") == "DRAFT"):
                record = {"family": family, "project": project_rel, "status": "DRAFT", "skipped_current_build": True, "pages": sum(x.get("pages", 0) for x in report.get("pdfs", [])), "warnings": len(report.get("warnings", [])), "errors": len(report.get("errors", [])), "pdf_bytes": sum((out / x["file"]).stat().st_size for x in report.get("pdfs", []) if (out / x["file"]).exists()), "html_bytes": sum(x.stat().st_size for x in (out / "standalone").glob("*.html"))}
                print(f"[{number}/{total}] {family} {project_rel}: DRAFT (current build retained) pages={record['pages']}", flush=True)
                return record
        except Exception:
            pass
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([sys.executable, str(FORGE), "build", str(project), "--draft"], cwd=ROOT, text=True, capture_output=True)
    safe = project_rel.replace("/", "__")
    (LOG_DIR / f"{safe}.stdout.log").write_text(result.stdout, encoding="utf-8")
    (LOG_DIR / f"{safe}.stderr.log").write_text(result.stderr, encoding="utf-8")
    record = {"family": family, "project": project_rel, "returncode": result.returncode, "status": "DRAFT" if result.returncode == 0 else "FAILED", "skipped_current_build": False}
    if report_path.exists():
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
            record.update({"status": report.get("status", record["status"]), "pages": sum(x.get("pages", 0) for x in report.get("pdfs", [])), "warnings": len(report.get("warnings", [])), "errors": len(report.get("errors", [])), "input_sha256": report.get("input_sha256")})
        except Exception:
            pass
    if out.exists():
        record["pdf_bytes"] = sum(p.stat().st_size for p in out.glob("*.pdf"))
        record["html_bytes"] = sum(p.stat().st_size for p in (out / "standalone").glob("*.html"))
    if result.returncode:
        record["failure_tail"] = (result.stderr or result.stdout)[-4000:]
    print(f"[{number}/{total}] {family} {project_rel}: {record['status']} pages={record.get('pages', 0)} warnings={record.get('warnings', 0)} errors={record.get('errors', 0)}", flush=True)
    return record


def main() -> None:
    units = json.loads(UNIT_INDEX.read_text(encoding="utf-8"))["packs"]
    videos = json.loads(VIDEO_INDEX.read_text(encoding="utf-8"))["projects"]
    jobs = [(x["pack_path"].rsplit("/", 1)[0], "unit") for x in units]
    jobs.extend((x["project"], "video") for x in videos)
    results = []
    for number, (project, family) in enumerate(jobs, 1):
        results.append(build(project, family, number, len(jobs)))
        if number % 10 == 0:
            target = ROOT / "study-materials/work/forge-build-report.json"
            target.write_text(json.dumps({"schema_version": "1.0", "completed": len(results), "total": len(jobs), "results": results}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    target = ROOT / "study-materials/work/forge-build-report.json"
    target.write_text(json.dumps({"schema_version": "1.0", "completed": len(results), "total": len(jobs), "results": results, "failed": sum(x["status"] == "FAILED" for x in results)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {family: {"count": sum(x["family"] == family for x in results), "failed": sum(x["family"] == family and x["status"] == "FAILED" for x in results), "pages": sum(x.get("pages", 0) for x in results if x["family"] == family), "pdf_bytes": sum(x.get("pdf_bytes", 0) for x in results if x["family"] == family), "html_bytes": sum(x.get("html_bytes", 0) for x in results if x["family"] == family)} for family in ("unit", "video")}
    (ROOT / "study-materials/work/forge-build-summary.json").write_text(json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
