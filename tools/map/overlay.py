import sys, json, math
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None
img, dig, out = sys.argv[1], sys.argv[2], sys.argv[3]
crop = tuple(map(int, sys.argv[4].split(','))) if len(sys.argv) > 4 else None
d = json.load(open(dig))
im = Image.open(img).convert('RGB')
if crop: im = im.crop(crop)
ox, oy = (crop[0], crop[1]) if crop else (0, 0)
S = float(sys.argv[5]) if len(sys.argv) > 5 else 0.25
im = im.resize((int(im.width * S), int(im.height * S)))
dr = ImageDraw.Draw(im)
L = {'sea': 'S', 'desert': 'D', 'gravel': 'G', 'mountain': 'M', 'rough': 'R', 'heavyveg': 'V', 'saltmarsh': 'Z', 'clear': '', 'delta': 'L'}
for k, h in d['hexes'].items():
    x, y = (h['x'] - ox) * S, (h['y'] - oy) * S
    if L[h['t']]: dr.text((x - 3, y - 5), L[h['t']], fill=(200, 0, 0))
C = {'wadi': (0, 160, 0), 'escarpment': (0, 0, 0), 'slope': (150, 70, 0), 'ridge': (255, 120, 0), 'river': (0, 0, 255)}
for k, f in d['sides'].items():
    a, b = k.split('|')
    A, B = d['hexes'][a], d['hexes'][b]
    mx, my = ((A['x'] + B['x']) / 2 - ox) * S, ((A['y'] + B['y']) / 2 - oy) * S
    dx, dy = B['x'] - A['x'], B['y'] - A['y']; Ln = math.hypot(dx, dy); ex, ey = -dy / Ln, dx / Ln
    h = 50 * S
    if 'side' in f:
        dr.line([(mx - ex * h, my - ey * h), (mx + ex * h, my + ey * h)], fill=C[f['side']], width=max(2, int(12 * S)))
        if 'down' in f:
            D = d['hexes'][f['down']]
            dr.line([(mx, my), (mx + ((D['x'] - ox) * S - mx) * 0.3, my + ((D['y'] - oy) * S - my) * 0.3)], fill=C[f['side']], width=2)
    if 'line' in f:
        dr.line([((A['x'] - ox) * S, (A['y'] - oy) * S), ((B['x'] - ox) * S, (B['y'] - oy) * S)], fill=(230, 0, 0) if f['line'] == 'road' else (255, 0, 255), width=max(1, int(6 * S)))
    if f.get('rail'):
        dr.line([((A['x'] - ox) * S + 3, (A['y'] - oy) * S), ((B['x'] - ox) * S + 3, (B['y'] - oy) * S)], fill=(0, 120, 255), width=max(1, int(6 * S)))
im.save(out)
