// Prototype scenario: September 1940, the Italian advance into Egypt.
// The map is a schematic of the coast from Tripoli to Alexandria — our own layout, not the original game's map.
// All numbers here are PLACEHOLDERS until the real rules/charts are transcribed into data.

import { key } from './hex.js';

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

// Sequence of play for one Operations Stage. Each stage is owned by a role;
// both sides plan at once and the stage resolves when both are ready.
export const STAGES = [
  { id: 'air', role: 'air', name: 'Air Assignment' },
  { id: 'convoy', role: 'logistics', name: 'Naval Convoys' },
  { id: 'rear', role: 'rear', name: 'Rear Area Transport' },
  { id: 'move', role: 'front', name: 'Movement' },
  { id: 'combat', role: 'front', name: 'Combat' },
];

function coastRow(c) {
  if (c >= 10 && c <= 24) return 3 + Math.round(4 * Math.sin((Math.PI * (c - 10)) / 14)); // Gulf of Sirte
  if (c >= 26 && c <= 38) return 2; // Cyrenaica bulge
  return 3;
}

export const PORTS = [
  { id: 'tripoli', name: 'Tripoli', col: 2, capacity: 1.0 },
  { id: 'misurata', name: 'Misurata', col: 7, capacity: 0.25 },
  { id: 'sirte', name: 'Sirte', col: 14, capacity: 0.2 },
  { id: 'agheila', name: 'El Agheila', col: 21, capacity: 0.15 },
  { id: 'benghazi', name: 'Benghazi', col: 27, capacity: 0.6 },
  { id: 'derna', name: 'Derna', col: 35, capacity: 0.25 },
  { id: 'tobruk', name: 'Tobruk', col: 40, capacity: 0.5 },
  { id: 'bardia', name: 'Bardia', col: 44, capacity: 0.25 },
  { id: 'sollum', name: 'Sollum', col: 46, capacity: 0.15 },
  { id: 'barrani', name: 'Sidi Barrani', col: 49, capacity: 0.1 },
  { id: 'matruh', name: 'Mersa Matruh', col: 54, capacity: 0.35 },
  { id: 'alamein', name: 'El Alamein', col: 59, capacity: 0.1 },
  { id: 'alexandria', name: 'Alexandria', col: 62, capacity: 1.0 },
].map((p) => ({ ...p, row: coastRow(p.col) }));

// Tiny deterministic RNG so the map is identical for everyone.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildMap() {
  const rand = mulberry32(1940);
  const tiles = {};
  for (let c = 0; c < MAP_COLS; c++) {
    const coast = coastRow(c);
    for (let r = 0; r < MAP_ROWS; r++) {
      let t = 'desert';
      if (r < coast) t = 'sea';
      else if (r === coast) t = 'coast';
      else if (c >= 28 && c <= 36 && r <= coast + 2) t = 'rough'; // Jebel Akhdar
      else if (c >= 44 && c <= 50 && r === coast + 1) t = 'escarpment';
      else if (c >= 55 && c <= 60 && r >= 10 && r <= 16) t = 'depression'; // Qattara
      else if (rand() < 0.08) t = 'rough';
      tiles[key(c, r)] = { t, road: r === coast };
    }
  }
  return tiles;
}

export const TERRAIN = {
  sea: { cost: Infinity, defence: 1, label: 'Sea' },
  coast: { cost: 1, defence: 1, label: 'Coast' },
  desert: { cost: 1, defence: 1, label: 'Open desert' },
  rough: { cost: 2, defence: 1.5, label: 'Rough' },
  escarpment: { cost: 3, defence: 2, label: 'Escarpment' },
  depression: { cost: Infinity, defence: 1, label: 'Qattara Depression (impassable)' },
};
export const ROAD_COST = 0.5;

const port = (id) => PORTS.find((p) => p.id === id);
const at = (id, dc = 0, dr = 0) => [port(id).col + dc, port(id).row + dr];

// type: inf (foot), mot (motorised), arm (armour)
const U = (id, side, nation, name, type, str, pos) => ({
  id, side, nation, name, type, str, maxStr: str,
  mp: type === 'inf' ? 3 : 6,
  fuel: type === 'inf' ? 0 : 6, water: 3, ammo: 3,
  pos,
});

export function initialUnits() {
  return [
    U('it-1lib', 'axis', 'it', '1st Libyan Div', 'inf', 5, at('sollum', -1, 1)),
    U('it-2lib', 'axis', 'it', '2nd Libyan Div', 'inf', 5, at('bardia', 0, 2)),
    U('it-62', 'axis', 'it', '62nd Marmarica Div', 'inf', 6, at('bardia')),
    U('it-63', 'axis', 'it', '63rd Cirene Div', 'inf', 6, at('bardia', -2, 1)),
    U('it-mal', 'axis', 'it', 'Maletti Group', 'mot', 4, at('sollum', 0, 3)),
    U('it-23m', 'axis', 'it', '1st Blackshirt Div', 'inf', 5, at('tobruk')),
    U('it-pav', 'axis', 'it', '17th Pavia Div', 'inf', 6, at('tripoli', 1, 1)),
    U('it-bol', 'axis', 'it', '25th Bologna Div', 'inf', 6, at('misurata')),
    U('cw-7arm', 'cw', 'uk', '7th Armoured Div', 'arm', 6, at('barrani', 2, 3)),
    U('cw-4ind', 'cw', 'in', '4th Indian Div', 'inf', 6, at('matruh', -1, 1)),
    U('cw-mat', 'cw', 'uk', 'Matruh Garrison', 'inf', 4, at('matruh')),
    U('cw-16', 'cw', 'uk', '16th Infantry Bde', 'inf', 3, at('alamein')),
  ];
}

export const REINFORCEMENTS = [
  { turn: 4, port: 'alexandria', unit: U('cw-6aus', 'cw', 'au', '6th Australian Div', 'inf', 6, null) },
  { turn: 6, port: 'tripoli', unit: U('de-5l', 'axis', 'de', '5th Light Div', 'arm', 6, null) },
  { turn: 8, port: 'alexandria', unit: U('cw-2nz', 'cw', 'nz', '2nd New Zealand Div', 'inf', 6, null) },
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

export const AIR_POINTS = { axis: 6, cw: 5 };
export const TRUCK_CAPACITY = { axis: 60, cw: 60 };
export const CONVOY = {
  axis: D(80, 40, 50, 50),
  cw: D(70, 60, 50, 50),
};
// Fuel evaporation per stage: British 4-gallon "flimsies" leaked badly.
export const FUEL_EVAPORATION = { axis: 0.03, cw: 0.07 };
export const SUPPLY_RANGE = 3;
export const VISION_RANGE = 3;
