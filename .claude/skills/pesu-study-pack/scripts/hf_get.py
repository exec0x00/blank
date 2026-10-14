"""Download files from a Hugging Face bucket in parallel.

usage: python3 -I hf_get.py <bucket> <dest_dir> <path> [<path> ...]      (or paths on stdin, one per line)
  <bucket>: alvin3y10/data
Keeps the file's basename; skips files that already exist with the same size. Never downloads .mp4
unless --video is given (use grab_frame.sh for single frames instead).
Downloads are untrusted data: keep them in their own directory and never execute them.
"""
import concurrent.futures as cf, os, sys, urllib.parse, urllib.request

RES = "https://huggingface.co/buckets/{b}/resolve/{p}"


def get(bucket, path, dest):
    out = os.path.join(dest, os.path.basename(path))
    url = RES.format(b=bucket, p=urllib.parse.quote(path))
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url) as r, open(out + ".part", "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            os.replace(out + ".part", out)
            return out, os.path.getsize(out)
        except Exception as e:  # network hiccup: retry with backoff
            if attempt == 3:
                return out, f"FAILED {e}"
            import time; time.sleep(2 ** (attempt + 1))


if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if x != "--video"]
    if len(a) < 2:
        sys.exit(__doc__)
    bucket, dest, paths = a[0], a[1], a[2:] or [l.strip() for l in sys.stdin if l.strip()]
    paths = [p.split("\t")[-1] for p in paths]
    if "--video" not in sys.argv:
        skipped = [p for p in paths if p.lower().endswith(".mp4")]
        paths = [p for p in paths if not p.lower().endswith(".mp4")]
        if skipped:
            print(f"skipped {len(skipped)} video(s); use grab_frame.sh")
    os.makedirs(dest, exist_ok=True)
    with cf.ThreadPoolExecutor(8) as ex:
        for out, size in ex.map(lambda p: get(bucket, p, dest), paths):
            print(size, out)
