// Prototype scenario: Graziani's Offensive, from Game-Turn 1 (September 1940).
// The MAP is the full board (sections A-E), digitised automatically from the scanned map sheets.
// Unit values (CPA, strength, supplies) are PLACEHOLDERS until the Organisation-at-Arrival charts are entered.

import { key, neighbours } from './hex.js';
import { edgeKey } from './rules.js';

import { MAP_DATA } from './mapdata.js';
import { MAP_FIXES } from './mapfixes.js';
import { LOCATIONS } from './locations.js';
import { hexFromName } from './hexnames.js';

export const MAP_COLS = MAP_DATA.cols;
export const MAP_ROWS = MAP_DATA.rows;
export { LOCATIONS };

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

// Ports for convoys: locations with a port, positioned at their (first) hex.
export const PORTS = LOCATIONS.filter((l) => l.port).map((l) => ({ id: l.id, name: l.name, col: l.hexes[0][0], row: l.hexes[0][1], capacity: l.capacity }));

const CODE_TO_TERRAIN = { s: 'sea', c: 'clear', g: 'gravel', m: 'saltmarsh', v: 'heavyveg', r: 'rough', M: 'mountain', l: 'delta', d: 'desert', C: 'majorcity', w: 'swamp' };
const SIDE_TYPES = { wadi: 'wadi', river: 'minorRiver', escarpment: 'escarpment', slope: 'slope', ridge: 'ridge', majorRiver: 'majorRiver' };

// Returns { tiles, hexsides, roads:Set, tracks:Set, rails:Set } built from the digitised board.
export function buildMap() {
  const tiles = {};
  MAP_DATA.grid.forEach((col, c) => {
    for (let r = 0; r < col.length; r++) if (col[r] !== '_') tiles[key(c, r)] = { t: CODE_TO_TERRAIN[col[r]] };
  });
  for (const l of LOCATIONS) if (l.city) for (const h of l.hexes) if (tiles[key(...h)]) tiles[key(...h)].t = 'majorcity';
  const hexsides = {};
  for (const [c1, r1, c2, r2, type, down] of MAP_DATA.hexsides) {
    const e = { type: SIDE_TYPES[type] || type };
    if (down !== undefined) e.down = down === 0 ? key(c1, r1) : key(c2, r2);
    hexsides[edgeKey([c1, r1], [c2, r2])] = e;
  }
  const set = (list) => new Set(list.map(([a, b, c, d]) => edgeKey([a, b], [c, d])));
  const map = { tiles, hexsides, roads: set(MAP_DATA.roads), tracks: set(MAP_DATA.tracks), rails: set(MAP_DATA.rails) };
  applyFixes(map);
  return map;
}

// Hand corrections on top of the automatic digitisation (see mapfixes.js).
function applyFixes(map) {
  for (const f of MAP_FIXES) {
    if (f.hex) { const h = hexFromName(f.hex); if (h) { if (f.t === null) delete map.tiles[key(...h)]; else map.tiles[key(...h)] = { t: f.t }; } }
    if (f.edge) {
      const [a, b] = f.edge.map(hexFromName);
      const ek = edgeKey(a, b);
      if ('side' in f) { if (f.side) map.hexsides[ek] = { type: f.side, ...(f.down ? { down: key(...hexFromName(f.down)) } : {}) }; else delete map.hexsides[ek]; }
      for (const kind of ['roads', 'tracks', 'rails']) if (kind in f) { if (f[kind]) map[kind].add(ek); else map[kind].delete(ek); }
    }
  }
}

const at = (name) => hexFromName(name);

// A formation is a counter made of weapon-system elements, each with TOE Strength Points (see weapons.js).
// size: division | brigade | battalion (stacking points 5 / 2 / 1). cpa <= 10 means foot-bound.
// Compositions follow the Organisation-at-Arrival style but are PROVISIONAL until those charts are fully entered.
const E = (w, toe) => ({ w, toe, max: toe });
const U = (id, side, nation, name, type, size, cpa, morale, elements, pos, extra = {}) => {
  const u = {
    id, side, nation, name, type, size, cpa, morale, elements,
    motorised: cpa > 10,
    fuel: cpa > 10 ? 30 : 0, water: 3, ammo: 3,
    cpUsed: 0, cohesion: 0, bp: 0,
    pos,
    ...extra,
  };
  u.str = elements.reduce((s, e) => s + e.toe, 0);
  u.maxStr = u.str;
  return u;
};

const itDiv = () => [E('IT inf (u)', 42), E('IT MG (bb)', 2), E('65/17 Gun', 2), E('47/32 AT', 2), E('75/27 Gun', 6), E('100/17 Howitzer', 3), E('75/46 AA', 2)];
const libDiv = () => [E('IT inf (x)', 25), E('75/27 Gun', 3), E('47/32 AT', 1)];

// Positions from the scenario's initial deployment (60.31, 60.41), at formation level.
export function initialUnits() {
  return [
    U('it-1cc', 'axis', 'it', '1st Blackshirt Div', 'inf', 'division', 10, -1, itDiv(), at('C4218')),
    U('it-63', 'axis', 'it', '63rd Cirene Div', 'inf', 'division', 10, -1, itDiv(), at('C4120')),
    U('it-1lib', 'axis', 'it', '1st Libyan Div', 'inf', 'division', 10, -2, libDiv(), at('C4020')),
    U('it-2lib', 'axis', 'it', '2nd Libyan Div', 'inf', 'division', 10, -2, [...libDiv(), E('CV 33', 4)], at('C3920')),
    U('it-62', 'axis', 'it', '62nd Marmarica Div', 'inf', 'division', 10, -1, itDiv(), at('C3918')),
    U('it-mal', 'axis', 'it', 'Maletti Group', 'mot', 'division', 20, -2, [E('IT inf (w)', 15), E('IT inf (x)', 10), E('75/27 Gun', 3), E('75/18 Gun-Howitzer', 2), E('M 11/39', 7)], at('C3617')),
    U('it-64', 'axis', 'it', '64th Catanzaro Div', 'inf', 'division', 10, -1, itDiv(), at('C4707')),
    U('it-4cc', 'axis', 'it', '4th Blackshirt Div', 'inf', 'division', 10, -1, itDiv(), at('C4507')),
    U('it-bgar', 'axis', 'it', 'Bardia Garrison', 'inf', 'brigade', 10, -3, [E('IT inf (u)', 14), E('75/27 Gun', 3)], at('C4321')),
    U('it-tgar', 'axis', 'it', 'Tobruk Garrison', 'inf', 'brigade', 10, -3, [E('IT inf (u)', 14), E('75/27 Gun', 3), E('47/32 AT', 2)], at('C4807')),
    U('cw-7spt', 'cw', 'uk', '7th Support Group', 'mot', 'brigade', 15, 1, [E('CW inf (h)', 10), E('18/25-pounder Gun', 6), E('2-pounder AT', 4)], at('C3922')),
    U('cw-sg', 'cw', 'uk', '2nd Scots Guards', 'inf', 'battalion', 10, 1, [E('CW inf (h)', 5), E('25-pounder Gun', 4)], at('C4131')),
    U('cw-7arm', 'cw', 'uk', '7th Armoured Div', 'arm', 'division', 25, 1, [E('Mark VI Light', 10), E('A9 Cruiser', 3), E('A10 Cruiser', 3), E('A13 Cruiser', 4)], at('D3612')),
    U('cw-mat', 'cw', 'uk', 'Matruh Garrison', 'inf', 'brigade', 10, 0, [E('CW inf (q)', 18), E('3.7in Howitzer', 2)], at('D3714')),
    U('cw-4ind', 'cw', 'in', '4th Indian Div', 'inf', 'division', 10, 1, [E('CW inf (k)', 63), E('18/25-pounder Gun', 12), E('2-pounder AT', 4)], at('D3615')),
    U('cw-16', 'cw', 'uk', '16th Infantry Bde', 'inf', 'brigade', 15, 1, [E('CW inf (h)', 15)], at('E1829')),
    U('cw-2nz', 'cw', 'nz', '2nd New Zealand Div (part)', 'inf', 'division', 10, 1, [E('CW inf (k)', 21), E('CW MG (u)', 3), E('25-pounder Gun', 4)], at('E3613')),
  ];
}

export const REINFORCEMENTS = [
  { turn: 13, location: 'alexandria', unit: U('cw-6aus', 'cw', 'au', '6th Australian Div', 'inf', 'division', 10, 1, [E('CW inf (k)', 63), E('25-pounder Gun', 12), E('2-pounder AT', 4)], null) },
  { turn: 22, location: 'benghazi', unit: U('de-5l', 'axis', 'de', '5th Light Div', 'arm', 'division', 25, 2, [E('PzKw II', 6), E('PzKw III', 6), E('DE inf', 20)], null) },
  { turn: 22, location: 'benghazi', unit: U('de-dak', 'axis', 'de', 'DAK HQ (Rommel)', 'hq', 'battalion', 30, 2, [], null, { rommel: true }) },
];

const D = (fuel, water, ammo, stores) => ({ fuel, water, ammo, stores });

// Initial supply dumps (60.34, 60.44). Water is a placeholder (the scenario gives none; wells come later).
export function initialDumps() {
  const k = (n) => key(...at(n));
  return {
    [k('C4807')]: { side: 'axis', ...D(2000, 500, 200, 500) },
    [k('C4321')]: { side: 'axis', ...D(1000, 300, 100, 200) },
    [k('A4827')]: { side: 'axis', ...D(250, 200, 100, 100) },
    [k('B5925')]: { side: 'axis', ...D(250, 100, 0, 50) },
    [k('D3714')]: { side: 'cw', ...D(3000, 1000, 1000, 4000) },
    [k('C4131')]: { side: 'cw', ...D(500, 200, 250, 100) },
    [k('E3613')]: { side: 'cw', ...D(9999, 9999, 9999, 9999) }, // unlimited at Alexandria
  };
}

export function initialPortOwners() {
  const owners = {};
  for (const l of LOCATIONS) owners[l.id] = l.side;
  return owners;
}

// ---- Placeholders until the logistics rules (32.0 / 49.0-58.0) are implemented ----
export const AIR_POINTS = { axis: 6, cw: 5 };
export const TRUCK_CAPACITY = { axis: 60, cw: 60 };
export const CONVOY = { axis: D(80, 40, 50, 50), cw: D(70, 60, 50, 50) };
export const FUEL_EVAPORATION = { axis: 0.03, cw: 0.07 };
export const SUPPLY_RANGE = 3;
export const VISION_RANGE = 3;
