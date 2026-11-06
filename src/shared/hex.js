// Hex maths shared by server and client.
// Flat-topped hexes in "odd-q" offset layout: odd columns are shoved down half a hex.

export const key = (c, r) => `${c},${r}`;
export const parseKey = (k) => k.split(',').map(Number);

export function toCube(c, r) {
  const x = c;
  const z = r - (c - (c & 1)) / 2;
  return { x, y: -x - z, z };
}

export function distance(a, b) {
  const A = toCube(a[0], a[1]);
  const B = toCube(b[0], b[1]);
  return Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.z - B.z));
}

const EVEN = [[+1, 0], [+1, -1], [0, -1], [-1, -1], [-1, 0], [0, +1]];
const ODD = [[+1, +1], [+1, 0], [0, -1], [-1, 0], [-1, +1], [0, +1]];

export function neighbours(c, r) {
  const dirs = c & 1 ? ODD : EVEN;
  return dirs.map(([dc, dr]) => [c + dc, r + dr]);
}

// Pixel centre of a hex for rendering (size = centre-to-corner radius).
export function hexToPixel(c, r, size) {
  const x = size * 1.5 * c;
  const y = size * Math.sqrt(3) * (r + 0.5 * (c & 1));
  return { x, y };
}

export function pixelToHex(px, py, size) {
  // Convert to fractional axial, round in cube space, back to offset.
  const q = ((2 / 3) * px) / size;
  const r = ((-1 / 3) * px + (Math.sqrt(3) / 3) * py) / size;
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  const col = rx;
  const row = rz + (rx - (rx & 1)) / 2;
  return [col, row];
}
