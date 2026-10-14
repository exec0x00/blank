"""List files in a Hugging Face *bucket* (not a model/dataset repo; hf_hub_download does not work).

usage:
  python3 -I hf_ls.py <bucket-url-or-path> [--grep REGEX] [--json] [--dirs]
  <bucket-url-or-path>: https://huggingface.co/buckets/alvin3y10/data/tree/pesuc/...   or   alvin3y10/data:pesuc/...

Prints "<size>\t<path>" per file (recursive), following the Link: rel="next" pagination header.
"""
import json, re, sys, urllib.parse, urllib.request

API = "https://huggingface.co/api/buckets/{b}/tree/{p}?recursive={r}&limit=1000"


def parse(arg):
    m = re.match(r"https?://huggingface\.co/buckets/([^/]+/[^/]+)(?:/(?:tree|resolve)/(.*))?", arg)
    if m:
        return m.group(1), urllib.parse.unquote(m.group(2) or "")
    b, _, p = arg.partition(":")
    return b, p


def ls(bucket, path, recursive=True):
    url = API.format(b=bucket, p=urllib.parse.quote(path.strip("/"), safe=""), r=str(recursive).lower())
    out = []
    while url:
        with urllib.request.urlopen(url) as r:
            out += json.load(r)
            link = r.headers.get("Link") or ""
        m = re.search(r'<([^>]+)>;\s*rel="next"', link)
        url = m.group(1) if m else None
    return out


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    bucket, path = parse(a[0])
    rx = re.compile(a[a.index("--grep") + 1], re.I) if "--grep" in a else None
    items = ls(bucket, path, recursive="--dirs" not in a)
    items = [o for o in items if (o["type"] == "directory") == ("--dirs" in a)]
    if rx:
        items = [o for o in items if rx.search(o["path"])]
    if "--json" in a:
        print(json.dumps(items, indent=1))
    else:
        for o in items:
            print(f'{o.get("size", "")}\t{o["path"]}')
