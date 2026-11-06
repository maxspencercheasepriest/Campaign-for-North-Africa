# Digitise one map sheet: valid hexes, hex terrain, hexside features, roads/tracks/railways crossing each hexside.
# Usage: python3 digitise.py map.jpg fit.json out.json
import sys, json, math
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

img, fitf, out = sys.argv[1], sys.argv[2], sys.argv[3]
fit = json.loads(open(fitf).read())
ax, ay = np.array(fit['ax']), np.array(fit['ay'])
im = np.asarray(Image.open(img).convert('RGB')).astype(np.int32)
H, W, _ = im.shape
LABEL_TO_CENTRE = 65
X_NUDGE = 5
AP = 94.0          # apothem (centre to edge midpoint)
RC = AP / math.cos(math.pi / 6)  # circumradius

def centre(col, row):
    re_ = row + (0.5 if col % 2 == 0 else 0)
    return (ax[0] + ax[1] * col + ax[2] * re_ + X_NUDGE, ay[0] + ay[1] * col + ay[2] * re_ + LABEL_TO_CENTRE)

def neighbours(col, row):
    if col % 2 == 1:  # odd columns sit higher
        return [(col, row - 1), (col + 1, row - 1), (col + 1, row), (col, row + 1), (col - 1, row), (col - 1, row - 1)]
    return [(col, row - 1), (col + 1, row), (col + 1, row + 1), (col, row + 1), (col - 1, row + 1), (col - 1, row)]

def px(xs, ys):
    xs = np.clip(np.round(xs).astype(int), 0, W - 1)
    ys = np.clip(np.round(ys).astype(int), 0, H - 1)
    return im[ys, xs]

PAL = {
    'cream': (253, 242, 190), 'cream2': (251, 234, 183), 'pale': (233, 224, 186), 'sea': (140, 194, 230),
    'ochre': (231, 189, 30), 'rough': (188, 164, 89), 'mtn': (168, 140, 44), 'grey': (115, 112, 95),
    'dark': (80, 80, 75), 'white': (219, 231, 234), 'green': (190, 200, 70), 'tan': (220, 196, 109),
    'lgreen': (205, 215, 150), 'wadi': (147, 164, 118), 'blue': (70, 150, 205),
    'delta': (195, 193, 109), 'smarsh': (227, 212, 130), 'gravelbg': (251, 228, 155),
}
NAMES = list(PAL)
PA = np.array([PAL[k] for k in NAMES], np.int32)
IDX = {k: i for i, k in enumerate(NAMES)}

def classify(p):
    d = ((p[..., None, :] - PA) ** 2).sum(-1)
    return d.argmin(-1)

def frac(cls, *names):
    if cls.size == 0: return 0.0
    return float(np.isin(cls, [IDX[n] for n in names]).mean())

# Disc sample offsets
rr = np.arange(-60, 61, 3)
DX, DY = np.meshgrid(rr, rr)
INNER = np.hypot(DX, DY) <= 45
ix, iy = DX[INNER].ravel(), DY[INNER].ravel()
WIDE = (np.abs(DY) <= 0.8 * AP) & (np.abs(DX) * 0.866 + np.abs(DY) * 0.5 <= 0.8 * AP) & ~((DY < -0.25 * AP) & (np.abs(DX) < 0.45 * AP))

def hex_terrain(cx, cy):
    ci = classify(px(cx + ix, cy + iy))
    wx, wy = DX[WIDE].ravel(), DY[WIDE].ravel()
    cw = classify(px(cx + wx, cy + wy))
    f = lambda *n: frac(ci, *n)
    fw = lambda *n: frac(cw, *n)
    if fw('white') > 0.3: return None, ci
    if fw('sea') > 0.55 and f('sea') > 0.4: return 'sea', ci
    if f('ochre') >= 0.5: return 'desert', ci
    if f('delta') >= 0.4: return 'delta', ci
    if f('gravelbg') + f('ochre') >= 0.45 and f('ochre') < 0.5 and f('gravelbg') >= 0.25: return 'gravel', ci
    if f('smarsh', 'lgreen', 'tan') >= 0.35 and f('ochre') < 0.35: return 'saltmarsh', ci
    if 0.07 <= f('ochre') < 0.5:
        # Gravel is an even texture of rings; a partly-desert hex is ochre on one side only.
        q = [frac(classify(px(cx + ix[s], cy + iy[s])), 'ochre') for s in (ix < 0, ix >= 0, iy < 0, iy >= 0)]
        if min(q) > 0.05: return 'gravel', ci
        if f('ochre') >= 0.35: return 'desert', ci
    if f('mtn') >= 0.35: return 'mountain', ci
    if f('mtn', 'rough') >= 0.4: return 'rough', ci
    if f('green') >= 0.3: return 'heavyveg', ci
    if f('green', 'lgreen') >= 0.4: return 'delta', ci
    return 'clear', ci

def is_valid(cx, cy):
    # A real hex has drawn edges: look for a darker line at most of its six edge midpoints.
    hits = 0
    s = np.arange(-18, 19)
    for k in range(6):
        a = math.radians(-90 + 60 * k)
        nx, ny = math.cos(a), math.sin(a)
        mx, my = cx + AP * nx, cy + AP * ny
        prof = px(mx + s * nx, my + s * ny).sum(-1) / 3
        if np.median(prof) - prof.min() > 35: hits += 1
    return hits >= 4

def edge_features(c1, c2, ter1, ter2, olive_inner):
    (x1, y1), (x2, y2) = c1, c2
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    nx, ny = dx / L, dy / L          # normal, pointing from hex1 to hex2
    ex, ey = -ny, nx                  # along the edge
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    T = np.arange(-34, 35, 2)
    def band(s0, s1, step=2):
        S = np.arange(s0, s1 + 1, step)
        tt, ss = np.meshgrid(T, S)
        return px(mx + tt * ex + ss * nx, my + tt * ey + ss * ny)
    def preds(p):
        r, g, b = p[..., 0], p[..., 1], p[..., 2]
        lum = p.sum(-1) / 3
        chroma = p.max(-1) - p.min(-1)
        return {
            'wadi': (g > r + 8) & (g > b + 25) & (lum > 110) & (lum < 205),
            'dark': (lum < 140) & (chroma < 40),
            'grey': (lum < 175) & (chroma < 35),
            'olive': (r > 140) & (r < 200) & (b < 95) & (g > 115) & (g < 175),
            'blue': (b > r + 50) & (lum < 190),
        }
    s1, s2, ln = preds(band(-46, -14)), preds(band(14, 46)), preds(band(-10, 10))
    m = lambda d, k: float(d[k].mean())
    res = {}
    land = ter1 not in (None, 'sea') and ter2 not in (None, 'sea')
    if land and m(ln, 'wadi') >= 0.12 and m(s1, 'wadi') < 0.5 and m(s2, 'wadi') < 0.5:
        res['side'] = 'wadi'
    elif land and m(ln, 'blue') >= 0.25 and m(s1, 'blue') + m(s2, 'blue') > 0.15:
        res['side'] = 'river'
    else:
        # Escarpment splash covers most of the edge's length on the down side; a track crossing covers a narrow strip.
        cov = lambda d: float((d['grey'].sum(0) >= 2).mean())
        g1, g2 = cov(s1), cov(s2)
        o1 = m(s1, 'olive') if not olive_inner[0] else 0
        o2 = m(s2, 'olive') if not olive_inner[1] else 0
        if land and max(g1, g2) >= 0.6 and abs(g1 - g2) > 0.3:
            res['side'] = 'escarpment'; res['down'] = 1 if g1 > g2 else 2
        elif land and o1 >= 0.35 and o2 >= 0.35:
            res['side'] = 'ridge'
        elif land and max(o1, o2) >= 0.35 and min(o1, o2) < 0.12:
            res['side'] = 'slope'; res['down'] = 1 if o1 > o2 else 2
    # Linear features crossing the edge: dark pixels on both sides at the same place along the edge.
    if ter1 is not None and ter2 is not None:
        S = np.r_[np.arange(-18, -5, 2), np.arange(6, 19, 2)]
        tt, ss = np.meshgrid(T, S)
        p = px(mx + tt * ex + ss * nx, my + tt * ey + ss * ny)
        lum = p.sum(-1) / 3
        chroma = p.max(-1) - p.min(-1)
        dark = (lum < 150) & (chroma < 45)
        bluish = (p[..., 2] > p[..., 0] + 60) & (lum < 170)
        def crossing(mask):
            a = mask[ss < 0].reshape(-1, len(T)).any(0)
            b = mask[ss > 0].reshape(-1, len(T)).any(0)
            both = a & b
            return both.sum(), a, b
        nd, a, b = crossing(dark)
        if nd >= 2 and nd <= 12:
            # Count separate dark runs along the edge on each side: a road is a pair of thin lines.
            runs = lambda v: int(np.sum(v[1:] & ~v[:-1]) + v[0])
            # Dashed track: gaps along the line direction -> some rows empty
            col_hits = dark[:, a & b] if (a & b).any() else dark
            row_cov = col_hits.any(1).mean()
            res['line'] = 'road' if (runs(a) >= 2 or runs(b) >= 2) and row_cov > 0.9 else 'track'
        nb, _, _ = crossing(bluish)
        if 1 <= nb <= 12 and ter1 != 'sea' and ter2 != 'sea':
            res['rail'] = True
    return res

hexes, sides = {}, {}
inner_cls = {}
cand, valid = {}, set()
for col in range(1, 70):
    for row in range(1, 36):
        cx, cy = centre(col, row)
        if cx - RC < 0 or cy - AP < 0 or cx + RC >= W or cy + AP >= H: continue
        t, ci = hex_terrain(cx, cy)
        if t is None: continue
        cand[(col, row)] = (t, ci, cx, cy)
        if is_valid(cx, cy): valid.add((col, row))
# Fill holes: hexes whose edges are painted over (escarpments, cities) but are surrounded by real hexes.
for _ in range(3):
    add = [c for c in cand if c not in valid and sum(n in valid for n in neighbours(*c)) >= 4]
    valid.update(add)
for (col, row) in valid:
    t, ci, cx, cy = cand[(col, row)]
    hexes[f'{col:02d}{row:02d}'] = {'t': t, 'x': round(cx, 1), 'y': round(cy, 1)}
    inner_cls[(col, row)] = frac(ci, 'mtn', 'rough') >= 0.25
# Keep only hexes connected to the main printed grid (drops chart boxes printed over the sea).
from collections import deque
seed = max(hexes, key=lambda k: sum(f'{n[0]:02d}{n[1]:02d}' in hexes for n in neighbours(int(k[:2]), int(k[2:]))) * 1000 - abs(int(k[:2]) - 25) - abs(int(k[2:]) - 17))
keep, q = {seed}, deque([seed])
while q:
    k = q.popleft()
    for n in neighbours(int(k[:2]), int(k[2:])):
        nk = f'{n[0]:02d}{n[1]:02d}'
        if nk in hexes and nk not in keep:
            keep.add(nk); q.append(nk)
hexes = {k: v for k, v in hexes.items() if k in keep}
for k, h in hexes.items():
    col, row = int(k[:2]), int(k[2:])
    for n in neighbours(col, row):
        nk = f'{n[0]:02d}{n[1]:02d}'
        if nk not in hexes or nk < k: continue
        f = edge_features((h['x'], h['y']), (hexes[nk]['x'], hexes[nk]['y']), h['t'], hexes[nk]['t'],
                          (inner_cls[(col, row)], inner_cls[n]))
        if f:
            if 'down' in f: f['down'] = k if f['down'] == 1 else nk
            sides[f'{k}|{nk}'] = f
json.dump({'hexes': hexes, 'sides': sides}, open(out, 'w'))
from collections import Counter
print(out, len(hexes), Counter(h['t'] for h in hexes.values()), Counter(v.get('side') for v in sides.values()), Counter(v.get('line') for v in sides.values()), sum(1 for v in sides.values() if v.get('rail')))
