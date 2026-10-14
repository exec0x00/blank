#!/usr/bin/env bash
# Grab single frames from a bucket video WITHOUT downloading it (ffmpeg seeks over HTTP, ~3 s/frame).
# Use only to close a logged gap: unreadable equation, transcript-only content, undecodable speech,
# missing diagram, or an empty slide. Pick the second from transcript.json "start"; prefer a few seconds
# before the next slide change (annotations are fullest).
#
# usage: grab_frame.sh <bucket> <path/to/video.mp4> <out_dir> <seconds> [<seconds> ...]
#   e.g. grab_frame.sh alvin3y10/data "pesuc/.../002_x.mp4" work/frames 465 545 760
set -euo pipefail
bucket=$1; path=$2; out=$3; shift 3
mkdir -p "$out"
enc=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$path")
url="https://huggingface.co/buckets/$bucket/resolve/$enc"
stem=$(basename "${path%.*}" | cut -c1-40)
for t in "$@"; do
  ffmpeg -v error -y -ss "$t" -i "$url" -frames:v 1 -vf scale=960:-1 "$out/${stem}_t$(printf %05d "$t").png" &
done
wait
ls "$out" | grep "$stem"
