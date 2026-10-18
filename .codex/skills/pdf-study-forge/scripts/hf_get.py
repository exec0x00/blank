#!/usr/bin/env python3
"""Fetch bucket paths without basename collisions. Output includes the original path and SHA-256."""
from pathlib import Path,PurePosixPath
import argparse,hashlib,json,os,sys,urllib.parse,urllib.request

def main():
    a=argparse.ArgumentParser();a.add_argument('bucket');a.add_argument('dest');a.add_argument('paths',nargs='*');a.add_argument('--video',action='store_true');x=a.parse_args()
    if len(x.bucket.split('/'))!=2:raise ValueError('Use owner/bucket')
    paths=x.paths or [l.strip().split('\t')[-1] for l in sys.stdin if l.strip()];dest=Path(x.dest).resolve();dest.mkdir(parents=True,exist_ok=True);report=[]
    for name in paths:
        parts=PurePosixPath(name)
        if parts.is_absolute() or '..' in parts.parts:raise ValueError('Invalid bucket path')
        if parts.suffix.lower() in ('.mp4','.mkv','.webm') and not x.video:raise ValueError(f'Video {name} requires --video; use only when requested or needed to close a logged evidence gap')
        out=(dest/str(parts)).resolve()
        if not out.is_relative_to(dest):raise ValueError('Destination escapes folder')
        out.parent.mkdir(parents=True,exist_ok=True);tmp=out.with_name(out.name+'.part')
        url='https://huggingface.co/buckets/'+x.bucket+'/resolve/'+urllib.parse.quote(name,safe='/')
        try:
            with urllib.request.urlopen(url,timeout=60) as r,tmp.open('wb') as f:
                h=hashlib.sha256();size=0
                while data:=r.read(1024*1024):f.write(data);h.update(data);size+=len(data)
                expected=r.headers.get('Content-Length')
                if expected and size!=int(expected):raise ValueError('Incomplete download')
            tmp.replace(out);report.append({'path':name,'file':str(out.relative_to(dest)),'sha256':h.hexdigest(),'bytes':size,'url':url})
        except Exception:
            tmp.unlink(missing_ok=True);raise
    (dest/'download-manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(f'{len(report)} files downloaded')
if __name__=='__main__':main()
