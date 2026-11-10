"""Synthesise the soundtrack: a music-box waltz arrangement of
"Happy Birthday to You" (public domain), built to the video's timeline.

Usage: python3 scripts/make_music.py   ->  public/audio/music.wav

Timeline (30 fps, one 3/4 bar = 50 frames, 108 BPM):
  bars  0-3   intro            (F major)
  bars  4-11  verse 1          music box alone
  bars 12-15  interlude        playful arpeggios
  bars 16-23  verse 2          waltz + strings
  bars 24-31  verse 3          key lifts to G, full bells
  bars 32-34  outro, then the last chord rings out
"""
import wave
from pathlib import Path
import numpy as np

SR = 44100
FPS = 30
BAR_FRAMES = 50
BEAT = BAR_FRAMES / FPS / 3          # seconds per beat
TOTAL = 1860 / FPS                   # seconds
N = int(TOTAL * SR)
rng = np.random.default_rng(7)

dry = np.zeros((2, N))               # goes straight to the mix
wet = np.zeros((2, N))               # reverb send


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


queued = []                          # struck-tine notes, rendered by flush()


def music_box(m, vel=1.0):
    return ("box", m, vel)


def glock(m, vel=1.0):
    return ("glock", m, vel)


def place(sig, t0, pan=0.0, gain=1.0, send=0.35):
    if isinstance(sig, tuple):
        queued.append((t0, sig, pan, gain, send))
        return
    i = int(round(t0 * SR))
    if i >= N or i < 0:
        return
    sig = sig[: N - i]
    l = np.cos((pan + 1) * np.pi / 4) * gain
    r = np.sin((pan + 1) * np.pi / 4) * gain
    dry[0, i:i + len(sig)] += sig * l
    dry[1, i:i + len(sig)] += sig * r
    wet[0, i:i + len(sig)] += sig * l * send
    wet[1, i:i + len(sig)] += sig * r * send


def ramp(n, a):
    e = np.ones(n)
    k = min(n, max(1, int(a * SR)))
    e[:k] = np.linspace(0, 1, k)
    return e


def _music_box(m, vel=1.0):
    f = hz(m)
    tau = 0.85 * (440 / f) ** 0.35
    t = np.arange(int(min(4.0, tau * 6) * SR)) / SR
    s = (np.sin(2 * np.pi * f * t) * np.exp(-t / tau)
         + 0.38 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / (tau * 0.5))
         + 0.14 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t / (tau * 0.3))
         + 0.10 * np.sin(2 * np.pi * 5.42 * f * t) * np.exp(-t / (tau * 0.1)))
    return s * ramp(len(t), 0.002) * vel


def _glock(m, vel=1.0):
    f = hz(m)
    tau = 0.7 * (880 / f) ** 0.3
    t = np.arange(int(tau * 6 * SR)) / SR
    s = (np.sin(2 * np.pi * f * t) * np.exp(-t / tau)
         + 0.25 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t / (tau * 0.35))
         + 0.08 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t / (tau * 0.15)))
    return s * ramp(len(t), 0.001) * vel


def harp(m, vel=1.0):
    f = hz(m)
    tau = 0.55 * (330 / f) ** 0.3
    t = np.arange(int(tau * 6 * SR)) / SR
    s = np.zeros_like(t)
    for n in range(1, 7):
        s += np.sin(2 * np.pi * n * f * t) / n ** 2 * np.exp(-t * n ** 0.7 / tau)
    return s * ramp(len(t), 0.004) * vel


def bass(m, vel=1.0):
    f = hz(m)
    t = np.arange(int(1.6 * SR)) / SR
    s = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t)
         + 0.1 * np.sin(2 * np.pi * 3 * f * t)) * np.exp(-t / 0.55)
    return s * ramp(len(t), 0.012) * vel


def pad(m, dur, vel=1.0):
    f = hz(m)
    n = int((dur + 0.9) * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for det in (-0.004, 0.0, 0.005):
        ff = f * (1 + det)
        vib = 1 + 0.0025 * np.sin(2 * np.pi * 5.1 * t + rng.uniform(0, 6))
        ph = 2 * np.pi * np.cumsum(ff * vib) / SR
        for k in range(1, 6):
            s += np.sin(k * ph + rng.uniform(0, 6)) / k ** 1.9
    env = np.minimum(1, t / 0.45) * np.minimum(1, np.maximum(0, (dur + 0.9 - t) / 0.9))
    return s * env * vel / 3


def chime_sweep(t0, key, up=True, count=16, span=0.9, gain=0.05):
    scale = [0, 2, 4, 7, 9]
    notes = [84 + key + 12 * (i // 5) + scale[i % 5] for i in range(10)]
    order = np.linspace(0, len(notes) - 1, count)
    if not up:
        order = order[::-1]
    for j, idx in enumerate(order):
        m = notes[int(round(idx))]
        place(glock(m, 1.0), t0 + span * (j / count) ** 1.25 + rng.uniform(0, 0.012),
              pan=rng.uniform(-0.8, 0.8), gain=gain * rng.uniform(0.6, 1), send=0.8)


def beat_t(b):
    return b * BEAT


# ---- harmony ---------------------------------------------------------
# chords as scale-relative semitone sets (key added later)
I, IV, V, V7, vi, ii7 = (0, 4, 7), (5, 9, 12), (7, 11, 14), (7, 11, 14, 17), (9, 12, 16), (2, 5, 9, 12)
VERSE_CHORDS = [I, V, V7, I, I, IV, (I, V7), I]

# melody in C, beats relative to the first downbeat of the verse
G4, A4, B4, C5, D5, E5, F5, G5 = 67, 69, 71, 72, 74, 76, 77, 79
MELODY = [(-1, .75, G4), (-.25, .25, G4),
          (0, 1, A4), (1, 1, G4), (2, 1, C5),
          (3, 2, B4), (5, .75, G4), (5.75, .25, G4),
          (6, 1, A4), (7, 1, G4), (8, 1, D5),
          (9, 2, C5), (11, .75, G4), (11.75, .25, G4),
          (12, 1, G5), (13, 1, E5), (14, 1, C5),
          (15, 1, B4), (16, 1, A4), (17, .75, F5), (17.75, .25, F5),
          (18, 1, E5), (19, 1, C5), (20, 1, D5),
          (21, 3, C5)]


def chord_at(rel_beat):
    bar = int(max(0, rel_beat) // 3)
    ch = VERSE_CHORDS[min(bar, 7)]
    if isinstance(ch[0], tuple):
        ch = ch[1] if (rel_beat % 3) >= 2 else ch[0]
    return ch


def harmony_note(m, ch, key):
    """Highest chord tone at least a third below the melody note."""
    pcs = {(key + c) % 12 for c in ch}
    for cand in range(m - 3, m - 13, -1):
        if cand % 12 in pcs:
            return cand
    return m - 12


def verse(bar0, key, level):
    b0 = bar0 * 3
    # melody
    for rb, d, m in MELODY:
        t = beat_t(b0 + rb)
        note = m + key
        accent = 1.0 if rb % 3 == 0 else 0.86
        v = accent * rng.uniform(0.94, 1.04)
        if level == 1:
            place(music_box(note, v), t, pan=0.05, gain=0.20)
            place(music_box(note + 12, v), t + 0.004, pan=-0.1, gain=0.035)
        elif level == 2:
            place(music_box(note, v), t, pan=0.05, gain=0.19)
            place(music_box(note + 12, v), t + 0.004, pan=0.2, gain=0.05)
            if rb >= 0 and d >= 1:
                place(music_box(harmony_note(note, chord_at(rb), key), v), t + 0.008,
                      pan=-0.3, gain=0.07)
        else:
            place(music_box(note, v), t, pan=0.05, gain=0.19)
            place(glock(note + 12, v), t + 0.003, pan=0.3, gain=0.075, send=0.6)
            if rb >= 0:
                place(music_box(harmony_note(note, chord_at(rb), key), v), t + 0.008,
                      pan=-0.3, gain=0.085)
    # accompaniment
    for bar in range(8):
        ch = VERSE_CHORDS[bar]
        parts = [(0, 3, ch)] if not isinstance(ch[0], tuple) else [(0, 2, ch[0]), (2, 1, ch[1])]
        tb = beat_t(b0 + bar * 3)
        root = 36 + (key + parts[0][2][0]) % 12
        if root < 41:
            root += 12
        if level == 1:
            # gentle broken chord on the music box, an octave below the tune
            c = parts[0][2]
            c2 = parts[-1][2]
            arp = [(0, 48 + key + c[0]), (.5, 48 + key + c[2]), (1, 60 + key + c[0]),
                   (1.5, 48 + key + c[2]), (2, 48 + key + c2[1]), (2.5, 48 + key + c2[2])]
            for ob, m in arp:
                while m > 67 + key:
                    m -= 12
                place(music_box(m, 0.8 if ob else 1.0), tb + ob * BEAT,
                      pan=-0.25, gain=0.065)
        else:
            g = 0.5 if level == 2 else 0.62
            place(bass(root, 1.0), tb, pan=0, gain=0.34 * g, send=0.1)
            if level == 3:
                place(bass(root + 12, 1.0), tb, pan=0, gain=0.10, send=0.1)
            for beat in (1, 2):
                c = parts[-1][2] if (beat == 2 and len(parts) == 2) else parts[0][2]
                for j, iv in enumerate(c[:3] if len(c) == 3 else c[1:]):
                    m = 53 + (key + iv - 5) % 12
                    place(harp(m, 1.0), tb + beat * BEAT + j * 0.012,
                          pan=0.35 - 0.3 * j, gain=0.085 * g * (1.0 if beat == 1 else 0.85))
            for bb, dd, c in parts:
                for iv in c:
                    m = 55 + (key + iv - 7) % 12
                    place(pad(m, dd * BEAT, 1.0), tb + bb * BEAT, pan=rng.uniform(-.6, .6),
                          gain=0.030 * (1.0 if level == 2 else 1.35), send=0.7)
                if level == 3:
                    place(pad(67 + (key + c[0]) % 12, dd * BEAT), tb + bb * BEAT,
                          pan=0.2, gain=0.016, send=0.8)


def arps(bar0, key, chords, playful=False):
    for i, c in enumerate(chords):
        tb = beat_t((bar0 + i) * 3)
        base = 60 + key
        if playful:
            pat = [c[0], c[1], c[2], c[1] + 12 if len(c) < 4 else c[3], c[2], c[1]]
            place(bass(36 + (key + c[0]) % 12 + (12 if (key + c[0]) % 12 < 5 else 0)), tb,
                  gain=0.15, send=0.1)
            for iv in c[:3]:
                place(pad(55 + (key + iv - 7) % 12, 3 * BEAT), tb,
                      pan=rng.uniform(-.6, .6), gain=0.022, send=0.7)
        else:
            pat = [c[0], c[2], c[0] + 12, c[1] + 12, c[0] + 12, c[2]]
        for j, iv in enumerate(pat):
            m = base + iv
            while m > 84:
                m -= 12
            place(music_box(m, 1.0 if j % 2 == 0 else 0.8), tb + j * BEAT / 2,
                  pan=-0.4 + 0.16 * j, gain=0.12 if not playful else 0.13)
            if playful and j in (0, 3):
                place(glock(m + 12, 1.0), tb + j * BEAT / 2, pan=0.4, gain=0.03, send=0.7)


F, G = 5, 7

# intro
chime_sweep(0.15, F, up=True, count=14, span=1.1, gain=0.04)
arps(0, F, [I, vi, IV, V7])
for iv in I:
    place(pad(55 + (F + iv - 7) % 12, 12 * BEAT), 0.3, gain=0.014, send=0.8)

verse(4, F, 1)
arps(12, F, [IV, I, ii7, V7], playful=True)
verse(16, F, 2)

# lift into G: the last beat of verse 2 turns to D7, sweep into the reveal
t_lift = beat_t(24 * 3 - 1)
for m in (50, 54, 57, 60):
    place(harp(m + 12), t_lift, gain=0.07)
    place(pad(m + 12, BEAT), t_lift, gain=0.03, send=0.8)
chime_sweep(beat_t(24 * 3) - 0.75, G, up=True, count=22, span=0.85, gain=0.06)
verse(24, G, 3)
# sparkle on "dear A-lee-na"
chime_sweep(beat_t((24 + 5) * 3) + 0.1, G, up=False, count=10, span=0.7, gain=0.03)

# outro: IV - I - I with a last flourish
tb = beat_t(32 * 3)
arps(32, G, [IV, I], playful=True)
chime_sweep(beat_t(34 * 3) - 0.95, G, up=True, count=24, span=1.0, gain=0.055)
tf = beat_t(34 * 3)
for j, m in enumerate((43, 55, 62, 67, 71, 74, 79)):
    ins = bass if j == 0 else music_box
    place(ins(m), tf + j * 0.045, pan=-0.5 + j * 0.17, gain=0.2 if j == 0 else 0.11, send=0.6)
place(glock(91), tf + 0.38, pan=0.3, gain=0.06, send=0.9)
for m in (55, 59, 62, 67):
    place(pad(m, 2.6), tf, pan=rng.uniform(-.5, .5), gain=0.035, send=0.9)

def flush():
    """Render the queued tine notes. Striking a tine that is still ringing
    damps the old vibration first (as a real comb does), which also keeps
    repeated notes from phase-cancelling each other."""
    by_pitch = {}
    for ev in queued:
        by_pitch.setdefault(ev[1][:2], []).append(ev)
    for (kind, m), evs in by_pitch.items():
        evs.sort(key=lambda e: e[0])
        for j, (t0, (_, _, vel), pan, gain, send) in enumerate(evs):
            sig = (_music_box if kind == "box" else _glock)(m, vel)
            nxt = next((e[0] for e in evs[j + 1:] if e[0] - t0 > 0.02), None)
            if nxt is not None:
                cut = int((nxt - t0) * SR)
                if cut < len(sig):
                    k = min(cut, int(0.02 * SR))
                    sig = sig[:cut].copy()
                    sig[-k:] *= np.linspace(1, 0, k)
            place(sig, t0, pan, gain, send)
    queued.clear()


flush()

# ---- reverb (synthetic hall) -----------------------------------------
def reverb(x, seed):
    r = np.random.default_rng(seed)
    n = int(2.6 * SR)
    t = np.arange(n) / SR
    ir = r.standard_normal(n) * np.exp(-t / 0.55)
    ir[: int(0.012 * SR)] = 0                      # pre-delay
    # darken the tail: one-pole low-pass via FFT shaping
    spec = np.fft.rfft(ir)
    fr = np.fft.rfftfreq(n, 1 / SR)
    spec *= 1 / np.sqrt(1 + (fr / 4200) ** 2)
    ir = np.fft.irfft(spec, n)
    ir /= np.sqrt(np.sum(ir ** 2))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)
    return y[: len(x)]


mix = dry + 0.9 * np.stack([reverb(wet[0], 1), reverb(wet[1], 2)])

# master: gentle limiter, fade the tail, normalise
fade = np.ones(N)
k = int(2.8 * SR)
fade[-k:] = np.linspace(1, 0, k) ** 1.6
mix *= fade
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.5) / np.tanh(1.5)
mix *= 0.89 / np.max(np.abs(mix))

out = Path(__file__).resolve().parent.parent / "public" / "audio" / "music.wav"
out.parent.mkdir(parents=True, exist_ok=True)
pcm = (mix.T * 32767).astype("<i2")
with wave.open(str(out), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
rms = np.sqrt(np.mean(mix ** 2))
print(f"wrote {out}  {TOTAL:.1f}s  rms {20 * np.log10(rms):.1f} dBFS")
