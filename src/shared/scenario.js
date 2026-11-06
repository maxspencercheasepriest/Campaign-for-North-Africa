// Prototype scenario: Graziani's Offensive, from Game-Turn 1 (September 1940).
// The MAP here is a schematic stand-in until the real five map sections are digitised.
// Unit values (CPA, strength, supplies) are PLACEHOLDERS until the Organisation-at-Arrival charts are entered.

import { key, neighbours } from './hex.js';
import { edgeKey } from './rules.js';

export const MAP_COLS = 64;
export const MAP_ROWS = 18;

export const SIDES = ['axis', 'cw'];
export const SIDE_NAMES = { axis: 'Axis', cw: 'Commonwealth' };

// The five staff seats per side.
export const ROLES = ['cic', 'logistics', 'rear', 'air', 'front'];
export const ROLE_NAMES = {
  cic: 'Commander-in-Chief',
  logistics: 'Logistics Commander',
  rear: 'Rear Area Commander',
  air: 'Air Commander',
  front: 'Front-line Commander',
};

export const SCENARIO = {
  id: 'graziani',
  name: "Graziani's Offensive",
  firstTurn: 1,
  lastTurn: 6,
  initiativeFirstTurn: 'axis', // the Italians hold the initiative for Game-Turn 1
};

function coastRow(c) {
  if (c >= 10 && c <= 24) return 3 + Math.round(4 * Math.sin((Math.PI * (c - 10)) / 14)); // Gulf of Sirte
  if (c >= 26 && c <= 38) return 2; // Cyrenaica bulge
  return 3;
}

export const PORTS = [
  { id: 'tripoli', name: 'Tripoli', col: 2, capacity: 1.0, city: true },
  { id: 'misurata', name: 'Misurata', col: 7, capacity: 0.25 },
  { id: 'sirte', name: 'Sirte', col: 14, capacity: 0.2 },
  { id: 'agheila', name: 'El Agheila', col: 21, capacity: 0.15 },
  { id: 'benghazi', name: 'Benghazi', col: 27, capacity: 0.6, city: true },
  { id: 'derna', name: 'Derna', col: 35, capacity: 0.25 },
  { id: 'tobruk', name: 'Tobruk', col: 40, capacity: 0.5 },
  { id: 'bardia', name: 'Bardia', col: 44, capacity: 0.25 },
  { id: 'sollum', name: 'Sollum', col: 46, capacity: 0.15 },
  { id: 'barrani', name: 'Sidi Barrani', col: 49, capacity: 0.1 },
  { id: 'matruh', name: 'Mersa Matruh', col: 54, capacity: 0.35 },
  { id: 'alamein', name: 'El Alamein', col: 59, capacity: 0.1 },
  { id: 'alexandria', name: 'Alexandria', col: 62, capacity: 1.0, city: true },
].map((p) => ({ ...p, row: coastRow(p.col) }));

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Returns { tiles, hexsides, roads:Set, tracks:Set } using the Terrain Effects Chart's terrain types.
export function buildMap() {
  const rand = mulberry32(1940);
  const tiles = {};
  const hexsides = {};
  const roads = new Set();
  const tracks = new Set();
  for (let c = 0; c < MAP_COLS; c++) {
    const coast = coastRow(c);
    for (let r = 0; r < MAP_ROWS; r++) {
      let t = rand() < 0.35 ? 'gravel' : 'clear';
      if (r < coast) t = 'sea';
      else if (c >= 28 && c <= 36 && r > coast && r <= coast + 2) t = rand() < 0.3 ? 'mountain' : 'rough'; // Jebel Akhdar
      else if (c >= 55 && c <= 60 && r >= 10 && r <= 16) t = 'saltmarsh'; // Qattara Depression
      else if (r >= 15 && c <= 40) t = 'desert'; // edge of the sand sea
      else if (rand() < 0.06) t = 'rough';
      tiles[key(c, r)] = { t };
    }
  }
  for (const p of PORTS) if (p.city) tiles[key(p.col, p.row)].t = 'majorcity';

  // Coast road (Via Balbia): link each coast hex to the next column's coast hex.
  const coastHex = (c) => [c, coastRow(c)];
  for (let c = 0; c < MAP_COLS - 1; c++) {
    const a = coastHex(c), b = coastHex(c + 1);
    if (neighbours(...a).some(([x, y]) => x === b[0] && y === b[1])) roads.add(edgeKey(a, b));
    else {
      // Coast steps by more than one row: route through the intermediate hex.
      const mid = neighbours(...a).find(([x, y]) => neighbours(x, y).some(([p, q]) => p === b[0] && q === b[1]) && tiles[key(x, y)]?.t !== 'sea');
      if (mid) { roads.add(edgeKey(a, mid)); roads.add(edgeKey(mid, b)); }
    }
  }
  // A desert track inland from Bardia south-east towards Sidi Barrani's hinterland, and the Trigh Capuzzo-like
  // track from Tobruk eastwards (schematic).
  const trackLine = (pts) => { for (let i = 0; i < pts.length - 1; i++) tracks.add(edgeKey(pts[i], pts[i + 1])); };
  trackLine([[40, 4], [41, 5], [42, 5], [43, 6], [44, 6], [45, 7], [46, 7], [47, 8], [48, 8], [49, 9], [50, 9], [51, 9]]);
  trackLine([[46, 4], [46, 5], [46, 6], [46, 7]]); // track down the escarpment near Sollum ("Halfaya")

  // The coastal escarpment between Bardia and Sidi Barrani: low ground (coast) on the north side.
  for (let c = 44; c <= 51; c++) {
    const up = [c, coastRow(c) + 2], down = [c, coastRow(c) + 1];
    hexsides[edgeKey(up, down)] = { type: 'escarpment', down: key(...down) };
  }
  // Wadis cutting the Jebel Akhdar.
  for (const c of [29, 31, 33, 35]) hexsides[edgeKey([c, 3], [c + 1, 3 + (c & 1 ? 1 : 0)])] = { type: 'wadi' };

  return { tiles, hexsides, roads, tracks };
}

const port = (id) => PORTS.find((p) => p.id === id);
const at = (id, dc = 0, dr = 0) => [port(id).col + dc, port(id).row + dr];

// size: division | brigade | battalion (stacking points 5 / 2 / 1)
// cpa: Capability Point Allowance (<= 10 means foot-bound)
const U = (id, side, nation, name, type, size, cpa, str, pos, extra = {}) => ({
  id, side, nation, name, type, size, cpa, str, maxStr: str,
  motorised: cpa > 10,
  fuel: cpa > 10 ? 30 : 0, water: 3, ammo: 3,
  cpUsed: 0, cohesion: 0, bp: 0,
  pos,
  ...extra,
});

export function initialUnits() {
  return [
    U('it-1lib', 'axis', 'it', '1st Libyan Div', 'inf', 'division', 8, 5, at('sollum', -1, 3)),
    U('it-2lib', 'axis', 'it', '2nd Libyan Div', 'inf', 'division', 8, 5, at('bardia', 0, 3)),
    U('it-62', 'axis', 'it', '62nd Marmarica Div', 'inf', 'division', 8, 6, at('bardia')),
    U('it-63', 'axis', 'it', '63rd Cirene Div', 'inf', 'division', 8, 6, at('bardia', -2, 1)),
    U('it-mal', 'axis', 'it', 'Maletti Group', 'mot', 'division', 20, 4, at('sollum', 0, 4)),
    U('it-1cc', 'axis', 'it', '1st Blackshirt Div', 'inf', 'division', 8, 5, at('tobruk')),
    U('it-pav', 'axis', 'it', '17th Pavia Div', 'inf', 'division', 8, 6, at('tripoli', 1, 1)),
    U('it-bol', 'axis', 'it', '25th Bologna Div', 'inf', 'division', 8, 6, at('misurata')),
    U('cw-7arm', 'cw', 'uk', '7th Armoured Div', 'arm', 'division', 25, 6, at('barrani', 2, 3)),
    U('cw-4ind', 'cw', 'in', '4th Indian Div', 'mot', 'division', 20, 6, at('matruh', -1, 1)),
    U('cw-mat', 'cw', 'uk', 'Matruh Garrison', 'inf', 'brigade', 8, 4, at('matruh')),
    U('cw-16', 'cw', 'uk', '16th Infantry Bde', 'inf', 'brigade', 10, 3, at('alamein')),
  ];
}

export const REINFORCEMENTS = [
  { turn: 13, port: 'alexandria', unit: U('cw-6aus', 'cw', 'au', '6th Australian Div', 'inf', 'division', 10, 6, null) },
  { turn: 22, port: 'tripoli', unit: U('de-5l', 'axis', 'de', '5th Light Div', 'arm', 'division', 25, 6, null) },
  { turn: 22, port: 'tripoli', unit: U('de-dak', 'axis', 'de', 'DAK HQ (Rommel)', 'hq', 'battalion', 30, 1, null, { rommel: true }) },
  { turn: 26, port: 'alexandria', unit: U('cw-2nz', 'cw', 'nz', '2nd New Zealand Div', 'inf', 'division', 10, 6, null) },
];

const D = (fuel, water, ammo, stores) => ({ fuel, water, ammo, stores });

export function initialDumps() {
  return {
    [key(...at('tripoli'))]: { side: 'axis', ...D(200, 200, 150, 150) },
    [key(...at('tobruk'))]: { side: 'axis', ...D(60, 60, 60, 60) },
    [key(...at('bardia'))]: { side: 'axis', ...D(40, 40, 40, 40) },
    [key(...at('alexandria'))]: { side: 'cw', ...D(200, 200, 150, 150) },
    [key(...at('matruh'))]: { side: 'cw', ...D(80, 80, 60, 60) },
  };
}

export function initialPortOwners() {
  const owners = {};
  for (const p of PORTS) owners[p.id] = p.col <= 46 ? 'axis' : 'cw';
  return owners;
}

// ---- Placeholders until the logistics rules (32.0 / 49.0-58.0) are implemented ----
export const AIR_POINTS = { axis: 6, cw: 5 };
export const TRUCK_CAPACITY = { axis: 60, cw: 60 };
export const CONVOY = { axis: D(80, 40, 50, 50), cw: D(70, 60, 50, 50) };
export const FUEL_EVAPORATION = { axis: 0.03, cw: 0.07 };
export const SUPPLY_RANGE = 3;
export const VISION_RANGE = 3;
