# OCR the 4-digit hex numbers on a map sheet, in tiles, returning (label, cx, cy) of each word.
import sys, json, re, subprocess, os
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('L')
W, H = im.size
T = 1400; O = 100
res = []
for y0 in range(0, H, T):
    for x0 in range(0, W, T):
        box = (max(0, x0 - O), max(0, y0 - O), min(W, x0 + T + O), min(H, y0 + T + O))
        tile = im.crop(box)
        tile = tile.resize((tile.width * 3, tile.height * 3), Image.LANCZOS).point(lambda p: 0 if p < 170 else 255)
        p = f'/tmp/tile_{os.getpid()}.png'
        tile.save(p)
        tsv = subprocess.run(['tesseract', p, '-', '--psm', '11', '-c', 'tessedit_char_whitelist=0123456789', 'tsv'], capture_output=True, text=True).stdout
        for line in tsv.splitlines()[1:]:
            f = line.split('\t')
            if len(f) < 12: continue
            txt = f[11].strip()
            if re.fullmatch(r'\d{4}', txt) and float(f[10]) > 50:
                l, t, w, h = map(int, f[6:10])
                cx, cy = box[0] + (l + w / 2) / 3, box[1] + (t + h / 2) / 3
                if box[0] + O <= cx < box[0] + O + T or box[0] == 0:
                    res.append((txt, cx, cy, float(f[10])))
json.dump(res, open(out, 'w'))
print(src, len(res))
