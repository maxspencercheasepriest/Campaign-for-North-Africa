# Find the blue filled dots that mark villages, wells and oases on the scanned map sections and
# turn them into hex coordinates. Usage: python3 places.py <workdir with map-00N.jpg and fit-N.json> out.json
import sys, json, cv2, numpy as np
Image = None
cv2.setNumThreads(4)
work, out = sys.argv[1], sys.argv[2]
places = []
for s in range(5):
    fit = json.load(open(f'{work}/work/fit-{s}.json'))
    ax, ay = np.array(fit['ax']), np.array(fit['ay'])
    img = cv2.imread(f'{work}/map-00{s}.jpg')
    R, G, B = (img[:, :, 2].astype(int), img[:, :, 1].astype(int), img[:, :, 0].astype(int))
    m = ((R < 125) & (B > 140) & (G > 115) & (G < 185) & (B - R > 55)).astype(np.uint8)
    o = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    n, lab, st, cen = cv2.connectedComponentsWithStats(o)
    A = np.array([[ax[1], ax[2]], [ay[1], ay[2]]])
    for i in range(1, n):
        area = st[i][4]; w, h = st[i][2], st[i][3]
        if not (60 <= area <= 700) or not (0.6 < w / h < 1.6) or area < 0.6 * w * h:  # filled and roughly round
            continue
        x, y = cen[i]
        col_f, row_eff = np.linalg.solve(A, [x - ax[0], y - ay[0]])
        col = int(round(col_f))
        row = int(round(row_eff - (0.5 if col % 2 == 0 else 0)))
        if 1 <= col <= 61 and 1 <= row <= 34:
            places.append({'section': 'ABCDE'[s], 'col': col, 'row': row, 'px': [int(x), int(y)]})
json.dump(places, open(out, 'w'))
print(len(places), 'candidate dots')
