#!/usr/bin/env python3
"""Download non-video PESU course sources listed in the frozen Hugging Face inventory."""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, json, os, pathlib, tempfile, time, urllib.error, urllib.parse, urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
INVENTORY = REPO / 'study-materials/inventory/hf-bucket-tree.json'
DEFAULT_DEST = REPO / 'study-materials/sources'
MANIFEST = REPO / 'study-materials/work/download-manifest.json'
BUCKET = 'alvin3y10/data'
VIDEO_EXT = {'.mp4', '.mkv', '.webm'}

def atomic_json(path: pathlib.Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.part')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    tmp.replace(path)

def download(item: dict, dest: pathlib.Path, retries: int = 4) -> dict:
    remote = item['path']
    relative = pathlib.PurePosixPath(remote)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError(f'Unsafe source path: {remote}')
    target = dest.joinpath(*relative.parts[1:])
    target.parent.mkdir(parents=True, exist_ok=True)
    url = f'https://huggingface.co/buckets/{BUCKET}/resolve/{urllib.parse.quote(remote, safe="/")}'
    if target.is_file() and target.stat().st_size == item.get('size'):
        digest = hashlib.sha256()
        with target.open('rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                digest.update(chunk)
        return {'path': remote, 'local_path': target.relative_to(dest).as_posix(), 'size': target.stat().st_size, 'sha256': digest.hexdigest(), 'xetHash': item.get('xetHash'), 'status': 'cached'}
    for attempt in range(retries):
        tmp = target.with_name(target.name + f'.part-{os.getpid()}')
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'pdf-study-forge-source-intake/1.0'})
            with urllib.request.urlopen(req, timeout=90) as response, tmp.open('wb') as f:
                hasher = hashlib.sha256(); size = 0
                while True:
                    block = response.read(1024 * 1024)
                    if not block: break
                    f.write(block); hasher.update(block); size += len(block)
                expected = response.headers.get('Content-Length')
                if expected is not None and size != int(expected):
                    raise IOError(f'Content-Length mismatch for {remote}: expected {expected}, received {size}')
                if item.get('size') is not None and size != item['size']:
                    raise IOError(f'Inventory size mismatch for {remote}: expected {item["size"]}, received {size}')
            tmp.replace(target)
            return {'path': remote, 'local_path': target.relative_to(dest).as_posix(), 'size': size, 'sha256': hasher.hexdigest(), 'xetHash': item.get('xetHash'), 'status': 'downloaded'}
        except Exception:
            tmp.unlink(missing_ok=True)
            if attempt + 1 == retries: raise
            time.sleep(min(2 ** attempt, 12))

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=12)
    ap.add_argument('--dest', type=pathlib.Path, default=DEFAULT_DEST)
    ap.add_argument('--include-archive', action='store_true', help='also fetch the 8enterprise archive; not part of current video courses')
    ap.add_argument('--include-reference-papers', action='store_true', help='fetch older question papers/answer keys for subjects matching current courses')
    a = ap.parse_args()
    items = [x for x in json.loads(INVENTORY.read_text(encoding='utf-8')) if x.get('type') == 'file']
    items = [x for x in items if pathlib.PurePosixPath(x['path']).suffix.lower() not in VIDEO_EXT]
    current = [x for x in items if x['path'].startswith('pesuc/PESU_Materials/')]
    refs = []
    if a.include_archive:
        refs = [x for x in items if x['path'].startswith('pesuc/First_Year_8enterprise/')]
    elif a.include_reference_papers:
        matches = ('/Files/Chemistry/', '/Files/Python/', '/Files/Math 1/', '/Files/EPD/',
                   '/Files/MES/', '/Files/Statics/', '/Files/Constitution/')
        refs = [x for x in items if x['path'].startswith('pesuc/First_Year_8enterprise/')
                and any(m in x['path'] for m in matches)
                and any(s in x['path'].lower() for s in ('/papers/', '/question bank/', '/chemistry/extra/', '/math 1/extra/'))]
        password = next((x for x in items if x['path']=='pesuc/First_Year_8enterprise/PASSWORD.txt'), None)
        if password: refs.append(password)
    items = current + refs
    dest = a.dest.resolve(); dest.mkdir(parents=True, exist_ok=True)
    manifest_by_path = {}
    if MANIFEST.is_file():
        try: manifest_by_path = {r['path']: r for r in json.loads(MANIFEST.read_text(encoding='utf-8'))['files']}
        except Exception: manifest_by_path = {}
    done = [x for x in items if x['path'] in manifest_by_path and (dest / manifest_by_path[x['path']]['local_path']).is_file()]
    pending = [x for x in items if x not in done]
    print(f'Sources: {len(items)} non-video files; {sum(x.get("size",0) for x in items)/1024**3:.2f} GiB; already verified {len(done)}; downloading {len(pending)}.', flush=True)
    for x in done: manifest_by_path[x['path']]['status'] = 'cached'
    atomic_json(MANIFEST, {'bucket': BUCKET, 'inventory': 'study-materials/inventory/hf-bucket-tree.json', 'files': sorted(manifest_by_path.values(), key=lambda r:r['path'])})
    errors=[]; completed=len(done)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,a.workers)) as pool:
        futures={pool.submit(download,x,dest):x for x in pending}
        for future in concurrent.futures.as_completed(futures):
            item=futures[future]
            try:
                result=future.result(); manifest_by_path[result['path']]=result
            except Exception as exc:
                errors.append({'path':item['path'],'error':f'{type(exc).__name__}: {exc}'})
            completed += 1
            if completed % 25 == 0 or completed == len(items):
                atomic_json(MANIFEST, {'bucket':BUCKET,'inventory':'study-materials/inventory/hf-bucket-tree.json','files':sorted(manifest_by_path.values(),key=lambda r:r['path']),'errors':errors})
                print(f'Progress {completed}/{len(items)}; successful {len(manifest_by_path)}; failed {len(errors)}', flush=True)
    atomic_json(MANIFEST, {'bucket':BUCKET,'inventory':'study-materials/inventory/hf-bucket-tree.json','files':sorted(manifest_by_path.values(),key=lambda r:r['path']),'errors':errors})
    if errors:
        print('Failures:')
        for e in errors: print(f"  {e['path']}: {e['error']}")
        return 1
    print(f'Complete: {len(manifest_by_path)} source files downloaded or verified.', flush=True)
    return 0

if __name__ == '__main__': raise SystemExit(main())
