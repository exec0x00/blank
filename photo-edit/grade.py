import sys
import numpy as np
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
img = Image.open(src).convert("RGB")
W, H = img.size

# light denoise on the night noise before grading
img = img.filter(ImageFilter.MedianFilter(3))
x = np.asarray(img).astype(np.float32) / 255.0


def _box(a, r, axis):
    # running-mean box filter with edge padding
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    p = np.pad(a, pad, mode="edge")
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
    lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(arr, sigma):
    """Approximate Gaussian blur (3 box passes) on a float HxW or HxWxC array."""
    # box radius giving the requested sigma over 3 passes
    r = max(1, int(round((np.sqrt(4 * sigma * sigma + 1) - 1) / 2)))
    out = arr.astype(np.float32)
    for _ in range(3):
        out = _box(out, r, 0)
        out = _box(out, r, 1)
    return out


def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# --- 1. Exposure + local contrast (clarity) ---------------------------------
x = np.clip(x * 1.08, 0, 1)
L = lum(x)
base = blur(L, 40)
detail = L - base
L2 = np.clip(base + detail * 1.45, 0, 1)
x = x * ((L2 + 1e-4) / (L + 1e-4))[..., None]
x = np.clip(x, 0, 1)

# --- 2. Green foliage -> cooler, deeper emerald (less sickly yellow) ---------
r, g, b = x[..., 0], x[..., 1], x[..., 2]
greenish = np.clip((g - b) * 3.0, 0, 1) * np.clip((g - r * 0.85) * 4.0 + 0.5, 0, 1)
new_r = r * (1 - 0.30 * greenish)
new_g = g * (1 - 0.12 * greenish)
new_b = b + (g - b) * 0.30 * greenish
x = np.stack([new_r, new_g, new_b], -1)

# --- 3. Tone curve: deep blacks w/ slight matte lift, rolled highlights ------
L = lum(x)
pts_in = np.array([0.0, 0.04, 0.15, 0.35, 0.60, 0.85, 1.0])
pts_out = np.array([0.025, 0.035, 0.12, 0.36, 0.66, 0.89, 0.98])
Lc = np.interp(L, pts_in, pts_out)
x = x * ((Lc + 1e-4) / (L + 1e-4))[..., None]
x = np.clip(x, 0, 1)

# --- 4. Split tone: teal/blue shadows, amber highlights ----------------------
L = lum(x)
sh = (1 - smooth(0.0, 0.45, L))[..., None]
hi = smooth(0.35, 0.9, L)[..., None]
shadow_tint = np.array([-0.020, 0.008, 0.045])
high_tint = np.array([0.060, 0.022, -0.045])
x = x + sh * shadow_tint * 0.9 + hi * high_tint
x = np.clip(x, 0, 1)

# --- 5. Sky: richer, deeper blue (top-right region, bluish pixels) -----------
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
r, g, b = x[..., 0], x[..., 1], x[..., 2]
blueness = np.clip((b - np.maximum(r, g)) * 6, 0, 1)
sky_zone = smooth(0.75, 0.35, yy / H)  # stronger toward the top
sky = (blueness * sky_zone)[..., None]
deep_blue = x * np.array([0.72, 0.82, 1.08])
x = x * (1 - sky * 0.7) + deep_blue * (sky * 0.7)
x = np.clip(x, 0, 1)

# --- 6. Vibrance (protect already-saturated & skin-ish tones) ----------------
mx = x.max(-1, keepdims=True)
mn = x.min(-1, keepdims=True)
sat = (mx - mn) / (mx + 1e-4)
L = lum(x)[..., None]
amount = 0.35 * (1 - sat)
x = L + (x - L) * (1 + amount)
x = np.clip(x, 0, 1)

# --- 7. Bloom / glow around the street lamps ---------------------------------
L = lum(x)
bright = np.clip((L - 0.62) / 0.38, 0, 1)[..., None] * x
glow_small = blur(bright, 18)
glow_big = blur(bright, 90)
glow = glow_small * 0.85 + glow_big * 1.2
glow = glow * np.array([1.0, 0.78, 0.48])  # warm sodium glow
x = 1 - (1 - x) * (1 - np.clip(glow, 0, 1))  # screen blend

# --- 8. Warm the wet road reflections a touch --------------------------------
road = smooth(0.62, 0.85, yy / H)[..., None]
L = lum(x)[..., None]
x = x + road * smooth(0.25, 0.7, L) * np.array([0.03, 0.012, -0.02])
x = np.clip(x, 0, 1)

# --- 9. Vignette (elliptical, soft) -----------------------------------------
cx, cy = W * 0.58, H * 0.48
d = np.sqrt(((xx - cx) / (W * 0.62)) ** 2 + ((yy - cy) / (H * 0.62)) ** 2)
vig = 1 - 0.55 * smooth(0.55, 1.35, d)
x = x * vig[..., None]

# --- 10. Gentle sharpening on the subject/mid-ground -------------------------
out = Image.fromarray((np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8))
out = out.filter(ImageFilter.UnsharpMask(radius=2.2, percent=70, threshold=3))
x = np.asarray(out).astype(np.float32) / 255.0

# --- 11. Fine film grain (luma, stronger in mids) ----------------------------
rng = np.random.default_rng(7)
noise = rng.normal(0, 1, (H, W)).astype(np.float32)
noise = blur(noise * 0.5 + 0.5, 0.7) * 2 - 1
L = lum(x)
grain_amt = 0.018 * (1 - np.abs(L - 0.4) * 1.4).clip(0.2, 1)
x = x + (noise * grain_amt)[..., None]

out = Image.fromarray((np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8))
out.save(dst, quality=95, subsampling=0)
print("saved", dst, out.size)
