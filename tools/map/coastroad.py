# The double-line coast road is hard to read from the scans (it runs through towns, coastlines and labels),
# so we trace it between known towns along it, following detected road/track edges where possible.
# Usage: python3 coastroad.py src/shared/mapdata.js
import json, sys, heapq, re
ROUTES = [
    # Via Balbia (Libya)
    ['A2109', 'A1816', 'A2021', 'A2629', 'A4130', 'A4827', 'B5504', 'B5925', 'C4807', 'C4321', 'C4021'],
    # Egyptian coast road
    ['D3714', 'E3613'],
]
p = sys.argv[1]
src = open(p).read()
m = re.search(r'export const MAP_DATA = (\{.*\});', src)
data = json.loads(m.group(1))
def hx(name):
    s = 'ABCDE'.index(name[0]); return (int(name[1:3]) - 1, 33 * s + int(name[3:5]) - 1)
def nb(c, r):
    return [(c, r - 1), (c, r + 1), (c - 1, r), (c + 1, r), (c - 1, r + (1 if c % 2 else -1)), (c + 1, r + (1 if c % 2 else -1))]
land = lambda c, r: 0 <= c < data['cols'] and 0 <= r < data['rows'] and data['grid'][c][r] not in ('_', 's')
ek = lambda a, b: (min(a, b), max(a, b))
roads = {ek((e[0], e[1]), (e[2], e[3])) for e in data['roads']}
tracks = {ek((e[0], e[1]), (e[2], e[3])) for e in data['tracks']}
added = 0
for route in ROUTES:
    for a, b in zip(route, route[1:]):
        A, B = hx(a), hx(b)
        dist, prev, q = {A: 0}, {}, [(0, A)]
        while q:
            d, x = heapq.heappop(q)
            if x == B: break
            if d > dist[x]: continue
            for n in nb(*x):
                if not land(*n): continue
                e = ek(x, n)
                w = 1 if e in roads else 1.6 if e in tracks else 4
                if d + w < dist.get(n, 1e9):
                    dist[n] = d + w; prev[n] = x; heapq.heappush(q, (d + w, n))
        if B not in prev: print('no path', a, b); continue
        x = B
        while x != A:
            e = ek(prev[x], x)
            if e not in roads: roads.add(e); added += 1
            tracks.discard(e)
            x = prev[x]
data['roads'] = [[a[0], a[1], b[0], b[1]] for a, b in sorted(roads)]
data['tracks'] = [[a[0], a[1], b[0], b[1]] for a, b in sorted(tracks)]
open(p, 'w').write(src[:m.start(1)] + json.dumps(data, separators=(',', ':')) + src[m.end(1):])
print('coast road edges added:', added, 'roads now', len(roads))
