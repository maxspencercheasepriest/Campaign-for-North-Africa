# Fit an affine hex-grid model to OCR'd hex labels: label position = A @ [1, col, rowEff].
import sys, json, numpy as np
labels = json.load(open(sys.argv[1]))
rows = []
for txt, x, y, conf in labels:
    c, r = int(txt[:2]), int(txt[2:])
    if c < 1 or c > 70 or r < 1 or r > 40: continue
    rows.append((c, r + (0.5 if c % 2 == 0 else 0), x, y))
P = np.array(rows, float)
def fit(P):
    X = np.c_[np.ones(len(P)), P[:, 0], P[:, 1]]
    ax, *_ = np.linalg.lstsq(X, P[:, 2], rcond=None)
    ay, *_ = np.linalg.lstsq(X, P[:, 3], rcond=None)
    return ax, ay, X
# RANSAC-ish: start with all, iteratively drop outliers
mask = np.ones(len(P), bool)
for it in range(8):
    ax, ay, X = fit(P[mask])
    Xall = np.c_[np.ones(len(P)), P[:, 0], P[:, 1]]
    err = np.hypot(Xall @ ax - P[:, 2], Xall @ ay - P[:, 3])
    thr = max(12, np.percentile(err[mask], 80) * 1.5) if it < 7 else 12
    mask = err < thr
print(json.dumps({'ax': ax.tolist(), 'ay': ay.tolist(), 'inliers': int(mask.sum()), 'total': len(P), 'rms': float(np.sqrt(np.mean(err[mask] ** 2)))}))
