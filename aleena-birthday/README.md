# Aleena's birthday video

A 62-second vertical (1080×1920, 30 fps) birthday video built with [Remotion](https://www.remotion.dev).
It tells her story from baby photos to today, then lands on a "Happy Birthday Aleena" reveal.

## What is not in this repository

The photos and the rendered video are personal, and this repository is public, so they are
git-ignored (`public/photos/`, `out/`). To render the video you need the original photos locally.

## Rendering

```bash
npm install

# 1. Prepare the photos: orients them, and cuts the five photos that only
#    exist inside the collage out of it. Expects the original file names.
python3 scripts/prepare_photos.py /path/to/original/photos

# 2. (Optional) rebuild the soundtrack. public/audio/music.mp3 is already committed.
python3 scripts/make_music.py
ffmpeg -y -i public/audio/music.wav -b:a 192k public/audio/music.mp3

# 3. Preview or render
npm run studio
npm run render        # -> out/aleena-birthday.mp4
```

`prepare_photos.py` needs Pillow, `make_music.py` needs NumPy.

## How it is put together

| Frames | Scene | Photos |
| --- | --- | --- |
| 0–200 | Intro: "Once upon a time…" then the title | – |
| 200–600 | Four memories, one taped-in print each | baby, tricycle\*, two hats, hat close-up |
| 600–800 | Four instant prints drop in, one per bar | nativity\*, balloon\*, smile\*, fishing net\* |
| 800–1100 | Three more memories | sunglasses, trophy, forest |
| 1100–1200 | Cake, candles being lit | – |
| 1200–1500 | The reveal: portrait, bunting, confetti, her name | portrait |
| 1500–1660 | Photo wall with the wish | all twelve |
| 1660–1860 | Closing card | portrait |

\* cut out of the collage.

The soundtrack is a music-box waltz arrangement of "Happy Birthday to You" (public domain),
synthesised by `scripts/make_music.py`. One bar of music is exactly 50 frames and every cut
sits on a bar line. The third verse lifts a key at the reveal, and her name writes itself on
where the song sings it.

- `src/theme.ts` holds the timeline, colours and the name.
- `src/Video.tsx` lists the scenes and their captions.
- `src/photos.ts` records where the face is in each photo, so crops and zooms keep it in view.
