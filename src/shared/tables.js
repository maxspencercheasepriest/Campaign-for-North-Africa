// Combat result tables, encoded from the game's charts as data.
// Dice: two dice read "sequentially" (one die is tens, the other units) giving 11..66.
// Every column is validated (see test/tables.test.js) to cover all 36 results exactly once.

export const D66 = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) D66.push(a * 10 + b);
const idx = (v) => D66.indexOf(v);

// "11-15" -> every d66 value from 11 to 15 in sequence; "-" -> none; "66" -> one value.
function parseRange(s) {
  if (!s || s === '-') return [];
  const [a, b] = s.split('-').map(Number);
  if (b === undefined) return [a];
  return D66.slice(idx(a), idx(b) + 1);
}
// Dice-sum ranges like "9-10,12" or "3-4,6-9".
function parseSum(s) {
  if (!s || s === '-') return [];
  return s.split(',').flatMap((part) => {
    const [a, b] = part.split('-').map(Number);
    if (b === undefined) return [a];
    const out = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
  });
}

// Build lookup: table[col][d66] = row label.
function buildColumns(rows, ncols) {
  const cols = Array.from({ length: ncols }, () => ({}));
  for (const [label, cells] of rows) {
    cells.forEach((cell, c) => { for (const v of parseRange(cell)) cols[c][v] = label; });
  }
  return cols;
}

// ---------------- [12.6] Artillery Barrage Table ----------------
// Columns by Actual Barrage Points: 1-2, 3-4, 5-6, 7-8, 9-10, 11-12, 13-14, 15-16, 17+.
export const BARRAGE_COLUMNS = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, Infinity]];
const BARRAGE_ROWS = {
  infantry: [
    ['none', ['11-53', '11-44', '11-41', '11-34', '11-24', '11-16', '-', '-', '-']],
    ['P', ['54-66', '45-66', '42-65', '35-64', '25-61', '21-44', '11-35', '11-32', '11-31']],
    ['1', ['-', '-', '66', '65-66', '62-66', '45-66', '36-64', '33-56', '32-55']],
    ['2', ['-', '-', '-', '-', '-', '-', '65-66', '61-66', '56-66']],
  ],
  armour: [
    ['none', ['11-62', '11-54', '11-45', '11-36', '11-31', '11-22', '11-14', '-', '-']],
    ['P', ['63-66', '55-66', '46-66', '41-66', '32-66', '23-66', '15-63', '11-62', '11-54']],
    ['1', ['-', '-', '-', '-', '-', '-', '64-66', '63-66', '55-66']],
  ],
  gun: [
    ['none', ['11-61', '11-54', '11-46', '11-36', '11-26', '11-22', '11-12', '-', '-']],
    ['1', ['62-66', '55-66', '51-66', '41-66', '31-66', '23-64', '13-56', '11-54', '11-36']],
    ['2', ['-', '-', '-', '-', '-', '65-66', '61-66', '55-66', '41-66']],
  ],
  truck: [
    ['none', ['11-66', '11-64', '11-62', '11-56', '11-55', '11-53', '11-46', '11-42', '11-32']],
    ['1', ['-', '65-66', '63-66', '61-66', '56-63', '54-63', '51-61', '43-61', '33-61']],
    ['2', ['-', '-', '-', '-', '64-66', '64-66', '62-66', '62-66', '62-66']],
  ],
};
export const BARRAGE = Object.fromEntries(Object.entries(BARRAGE_ROWS).map(([k, rows]) => [k, buildColumns(rows, 9)]));
export function barrageColumn(points) {
  return BARRAGE_COLUMNS.findIndex(([a, b]) => points >= a && points <= b);
}

// ---------------- [14.6] Anti-Armour Fire Table ----------------
// Columns: Actual Anti-Armour Points 0* (only for 1-4 raw points), 1..15, 16+. Rows are pairs of d66 results.
// Result = Damage Points (armour protection points that must be removed).
const AA_ROWS = [
  [11, '- - - 1 2 3 4 6 8 10 11 12 14 16 18 20 22'],
  [13, '- - - 1 3 4 5 6 8 10 11 13 15 17 19 20 22'],
  [15, '- - 1 1 3 4 5 7 9 10 12 13 15 17 19 21 23'],
  [21, '- - 1 2 4 5 6 8 9 11 12 14 16 18 20 21 23'],
  [23, '- - 1 2 4 5 6 8 10 11 13 14 16 18 20 22 24'],
  [25, '- - 2 3 4 6 7 9 10 12 13 15 17 19 20 22 24'],
  [31, '- 1 2 3 5 6 8 9 11 12 14 15 17 19 21 23 25'],
  [33, '- 1 2 3 5 7 8 10 11 13 14 16 18 20 21 23 25'],
  [35, '- 1 3 4 5 7 9 10 12 13 15 16 18 20 22 24 26'],
  [41, '- 2 3 4 6 7 9 11 12 14 15 17 19 21 22 24 26'],
  [43, '- 2 3 5 6 8 10 11 13 14 16 17 19 21 23 25 27'],
  [45, '- 2 4 5 7 8 10 12 13 15 16 18 20 22 23 25 27'],
  [51, '1 3 4 6 7 9 11 12 14 15 17 19 20 22 24 26 28'],
  [53, '1 3 4 6 8 9 11 13 14 16 17 20 21 23 25 27 29'],
  [55, '1 3 5 7 8 10 12 13 15 16 19 21 22 24 26 28 30'],
  [61, '1 4 5 7 8 10 12 14 15 17 19 22 23 25 27 29 31'],
  [63, '1 4 6 8 9 11 13 14 16 18 21 22 24 26 28 29 32'],
  [65, '2 4 6 8 9 11 13 15 17 19 21 23 24 26 28 30 32'],
].map(([first, cells]) => ({ first, cells: cells.split(' ').map((c) => (c === '-' ? 0 : Number(c))) }));
export const ANTI_ARMOUR_ROWS = AA_ROWS.length;
export function antiArmourRow(d66) {
  return AA_ROWS.findIndex((r) => d66 === r.first || d66 === r.first + 1);
}
// column: 0 = the 0* column, 1..15, 16 = 16+
export function antiArmourDamage(row, column) {
  return AA_ROWS[Math.max(0, Math.min(AA_ROWS.length - 1, row))].cells[Math.max(0, Math.min(16, column))];
}

// ---------------- [15.79] Close Assault Combat Results Table ----------------
// 18 columns of Final Close Assault Differential.
export const CA_COLUMNS = [
  [-Infinity, -11], [-10, -8], [-7, -6], [-5, -4], [-3, -3], [-2, -2], [-1, -1], [0, 0], [1, 1], [2, 2],
  [3, 3], [4, 4], [5, 6], [7, 8], [9, 10], [11, 13], [14, 16], [17, Infinity],
];
export const CA_OVERRUN_FROM = 15; // columns +11 and up
export const CA_COLUMN_LABELS = ['≤−11', '−10…−8', '−7…−6', '−5…−4', '−3', '−2', '−1', '0', '+1', '+2', '+3', '+4', '+5…+6', '+7…+8', '+9…+10', '+11…+13', '+14…+16', '≥+17'];
export function caColumnForDifferential(d) {
  return CA_COLUMNS.findIndex(([a, b]) => d >= a && d <= b);
}
const _ = '-';
const ATTACKER_LOSS_ROWS = [
  [50, ['11-15', '11-12', '11', _, _, _, _, _, _, _, _, _, _, _, _, _, _, _]],
  [40, ['16-24', '13-16', '12-14', '11', _, _, _, _, _, _, _, _, _, _, _, _, _, _]],
  [30, ['25-33', '21-26', '15-23', '12-15', '11-12', _, _, _, _, _, _, _, _, _, _, _, _, _]],
  [25, ['34-36', '31-34', '24-32', '16-23', '13-16', '11-12', '11', '11', '11', '11', _, _, _, _, _, _, _, _]],
  // The -2 column's 20% entry reads "13-18" in our scan (18 is not a possible roll); "13-16" fits the column.
  [20, ['41-46', '35-43', '33-41', '24-33', '21-26', '13-16', '12-13', '12', '12', '12', '11-12', '11-12', '11', _, _, _, _, _]],
  [15, ['51-56', '44-53', '42-51', '34-44', '31-36', '21-33', '14-26', '13-24', '13-22', '13-16', '13-16', '13-15', '12-13', '11-12', '11', _, _, _]],
  [10, ['61-63', '54-62', '52-56', '45-53', '41-46', '34-44', '31-42', '25-36', '23-33', '21-31', '21-26', '16-25', '14-21', '13-21', '12-16', '11-16', '11-13', '11-12']],
  [5, ['64-66', '63-65', '61-63', '54-61', '51-56', '45-54', '43-52', '41-51', '34-46', '32-44', '31-42', '26-41', '22-35', '22-33', '21-31', '21-26', '14-21', '13-16']],
  [0, [_, '66', '64-66', '62-66', '61-66', '55-66', '53-66', '52-66', '51-66', '45-66', '43-66', '42-66', '36-66', '34-66', '32-66', '31-66', '22-66', '21-66']],
];
const DEFENDER_LOSS_ROWS = [
  [50, [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, '11-13', '11-16']],
  [40, [_, _, _, _, _, _, _, _, _, _, _, _, _, '11', '11-12', '11-13', '14-25', '21-26']],
  [30, [_, _, _, _, _, _, _, _, _, _, _, _, '11', '12-14', '13-16', '14-22', '26-33', '31-36']],
  [25, [_, _, _, _, _, _, _, _, _, '11', '11', '11-12', '12-14', '15-22', '21-26', '23-33', '34-43', '41-46']],
  [20, [_, _, _, _, _, '11', '11', '11-12', '11-13', '12-13', '12-14', '13-16', '15-23', '23-31', '31-41', '34-46', '44-55', '51-56']],
  [15, [_, _, _, '11', '11-13', '12-13', '12-16', '13-23', '14-22', '14-23', '15-25', '21-33', '24-36', '32-45', '42-56', '51-62', '56-63', '61-63']],
  // Note: the +4 column's 10% entry is printed "24-45" in our scan; "34-45" is the only reading that keeps the column consistent.
  [10, ['11', '11', '11-13', '12-15', '14-21', '14-23', '21-26', '24-32', '23-33', '24-33', '26-42', '34-45', '41-54', '46-61', '61-63', '63-64', '64', '64-65']],
  // The +2 column's 5% entry reads "41-52" in our scan, leaving 34-36 unassigned; "34-52" fits the column.
  [5, ['12-16', '12-23', '14-26', '16-31', '22-41', '24-44', '31-46', '33-51', '34-51', '34-52', '43-54', '46-56', '55-62', '62-64', '64-65', '65', '65-66', '66']],
  [0, ['21-66', '24-66', '31-66', '32-66', '42-66', '45-66', '51-66', '52-66', '52-66', '53-66', '55-66', '61-66', '63-66', '65-66', '66', '66', _, _]],
];
export const CA_ATTACKER_LOSS = buildColumns(ATTACKER_LOSS_ROWS, 18);
export const CA_DEFENDER_LOSS = buildColumns(DEFENDER_LOSS_ROWS, 18);
// Results read from the dice SUM (2..12).
export const CA_ATTACKER_CAPTURED = ['2-7', '2-6', '2-5', '2-4', '2-3', '2', _, _, _, _, _, _, _, _, _, _, _, _].map(parseSum);
export const CA_ATTACKER_ENGAGED = ['10-12', '10-11', '11-12', '12', '11-12', '10-11', '10-12', '9-10,12', '9-11', '9-12', '8-10,12', '8-10', '9-10,12', '10-12', '9-11', _, _, _].map(parseSum);
export const CA_DEFENDER_CAPTURED = [_, _, _, _, _, _, _, '2', '2', '2', '2-3', '2-3', '2-4', '2-4', '2-5', '2-6', '2-7', '2-8'].map(parseSum);
export const CA_DEFENDER_RETREAT = {
  1: [_, _, _, _, '10', '9', '8', '5-6', '4-6', '5-7', '4-7', '3-7', '7-9', '7-9,12', '4-7,12', '3-4,6-9', '2,5-7,9,11', '2-9,11'].map(parseSum),
  2: [_, _, _, _, _, _, _, _, _, _, '11', '11', '5', '5', '8', '12', '8,10', '10'].map(parseSum),
  3: [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, '11', '12', '12'].map(parseSum),
};

// ---------------- [15.89] Prisoners Captured Results Table ----------------
export const PRISONERS_PCT = [null, 10, 25, 33, 50, 50, 75]; // by one die

// ---------------- [15.53] Organisation Size Close Assault Modifications ----------------
// Keyed by stacking points of each side's largest unit: [larger, smaller] -> column shift for the larger side.
export function orgSizeShift(largerSP, smallerSP) {
  if (largerSP <= smallerSP) return 0;
  if (largerSP >= 5) return { 3: 1, 2: 2, 1: 4, 0: 8 }[smallerSP] ?? 0;
  if (largerSP >= 2) return { 1: 2, 0: 4 }[smallerSP] ?? 0;
  if (largerSP === 1 && smallerSP === 0) return 2;
  return 0;
}

// ---------------- [17.4] Morale Modifier Table ----------------
// Rows by Cohesion Level (+8 or better ... -17 or worse); columns +4 +3 +2 +1 NO -1 -2 -3 -4 SURR.
export const MORALE_COLUMNS = [4, 3, 2, 1, 0, -1, -2, -3, -4, 'SURR'];
const M = (...cells) => cells;
const MORALE_ROWS = {
  8: M('11-26', '31-46', '51-65', '66', _, _, _, _, _, _),
  7: M('11-16', '21-36', '41-56', '61-66', _, _, _, _, _, _),
  6: M('11-12', '13-25', '26-36', '41-66', _, _, _, _, _, _),
  5: M('11', '12-21', '22-33', '34-65', '66', _, _, _, _, _),
  4: M(_, '11-14', '15-31', '32-56', '61-66', _, _, _, _, _),
  3: M(_, '11-13', '14-21', '22-44', '45-66', _, _, _, _, _),
  2: M(_, _, '11-12', '13-36', '41-66', _, _, _, _, _),
  1: M(_, _, _, '11-26', '31-66', _, _, _, _, _),
  0: M(_, _, _, '11', '12-65', '66', _, _, _, _),
  [-1]: M(_, _, _, _, '11-54', '55-65', '66', _, _, _),
  [-2]: M(_, _, _, _, '11-46', '51-56', '61-66', _, _, _),
  [-3]: M(_, _, _, _, '11-42', '43-46', '51-66', _, _, _),
  // Printed "42-55"; "42-56" is the only reading that covers every result.
  [-4]: M(_, _, _, _, '11-33', '34-41', '42-56', '61-66', _, _),
  [-5]: M(_, _, _, _, '11-23', '24-32', '33-46', '51-66', _, _),
  [-6]: M(_, _, _, _, '11-12', '13-25', '26-36', '41-63', '64-66', _),
  [-7]: M(_, _, _, _, '11', '12-16', '21-33', '34-51', '52-63', '64-66'),
  [-8]: M(_, _, _, _, _, '11-13', '14-31', '32-44', '45-61', '62-66'),
  [-9]: M(_, _, _, _, _, '11', '12-26', '31-41', '42-55', '56-66'),
  [-10]: M(_, _, _, _, _, _, '11-21', '22-34', '35-53', '54-66'),
  [-11]: M(_, _, _, _, _, _, '11-14', '15-33', '34-46', '51-66'),
  [-12]: M(_, _, _, _, _, _, '11', '12-26', '31-44', '45-66'),
  [-13]: M(_, _, _, _, _, _, '11', '12-21', '22-36', '41-66'),
  [-14]: M(_, _, _, _, _, _, _, '11-16', '21-33', '34-66'),
  [-15]: M(_, _, _, _, _, _, _, '11', '12-26', '31-66'),
  [-16]: M(_, _, _, _, _, _, _, _, '11-21', '22-66'),
  [-17]: M(_, _, _, _, _, _, _, _, _, '11-66'),
};
export const MORALE_TABLE = Object.fromEntries(Object.entries(MORALE_ROWS).map(([lvl, cells]) => {
  const map = {};
  cells.forEach((cell, c) => { for (const v of parseRange(cell)) map[v] = MORALE_COLUMNS[c]; });
  return [lvl, map];
}));
export function moraleModifier(cohesion, d66) {
  const lvl = Math.max(-17, Math.min(8, Math.round(cohesion)));
  return MORALE_TABLE[lvl][d66];
}

// Exposed for tests.


// ---------- Breakdown Table [21.38] ----------
// Nine columns of accumulated breakdown points; each row is the percentage of vehicles that break down.
export const BREAKDOWN_COLUMNS = ['0-3', '4-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71+'];
const BREAKDOWN_ROWS = [
  [0, ['11-66', '11-42', '11-32', '11-26', '11-23', '11-16', '11-14', '-', '-']],
  [10, ['-', '43-64', '33-62', '31-55', '24-53', '21-46', '15-42', '11-33', '11-25']],
  [25, ['-', '65', '63-64', '56-62', '54-61', '51-56', '43-54', '34-52', '26-43']],
  [33, ['-', '66', '65', '63-65', '62-64', '61-63', '55-63', '53-62', '44-55']],
  [50, ['-', '-', '66', '66', '65-66', '64-65', '64-65', '63-64', '56-63']],
  [75, ['-', '-', '-', '-', '-', '66', '66', '65-66', '64-66']],
];
export const BREAKDOWN = Array.from({ length: 9 }, () => ({}));
BREAKDOWN_ROWS.forEach(([pct, cells]) => cells.forEach((cell, c) => { for (const v of parseRange(cell)) BREAKDOWN[c][v] = pct; }));
// Column index for accumulated breakdown points (fractions round up) [21.31, 21.33].
export function breakdownColumn(points) {
  const p = Math.ceil(points);
  return p <= 3 ? 0 : p <= 10 ? 1 : p <= 20 ? 2 : p <= 30 ? 3 : p <= 40 ? 4 : p <= 50 ? 5 : p <= 60 ? 6 : p <= 70 ? 7 : 8;
}

// ---------- Weather Table [29.61] and Foul Weather Location Table [29.7] ----------
// By season (see rules.js seasonOfTurn): rolls giving Normal, Hot, Sandstorm, Rainstorm.
const WEATHER_ROWS = {
  spring: ['11-42', '43-55', '56-64', '65-66'],
  summer: ['11-23', '24-55', '56-66', '-'],
  fall: ['11-35', '36-54', '55-61', '62-66'],
  winter: ['11-52', '-', '-', '53-66'],
};
export const WEATHER_TYPES = ['normal', 'hot', 'sand', 'rain'];
export const WEATHER = Object.fromEntries(Object.entries(WEATHER_ROWS).map(([season, cells]) => {
  const m = {};
  cells.forEach((cell, i) => { for (const v of parseRange(cell)) m[v] = WEATHER_TYPES[i]; });
  return [season, m];
}));
// Map sections struck by a sandstorm or rainstorm, by one die. D,E* : sandstorms never cover delta hexes.
export const FOUL_WEATHER_SECTIONS = { 1: ['A', 'B'], 2: ['C', 'D'], 3: ['D', 'E'], 4: ['B', 'C'], 5: ['B', 'D'], 6: ['B', 'C', 'D'] };


// ---------- Abstract logistics tables [32.46, 32.47, 56.4, 32.66, 41.5] ----------
// Axis Simplified Supply Availability Table: supply units arriving, by die (1-6) and tonnage letter A-G.
export const AXIS_SUPPLY_TABLE = {
  1: [0, 0, 1, 1, 1, 1, 2], 2: [0, 1, 1, 1, 2, 2, 3], 3: [1, 1, 1, 2, 2, 3, 3],
  4: [1, 2, 2, 3, 3, 4, 4], 5: [2, 2, 3, 3, 3, 4, 5], 6: [2, 3, 3, 3, 4, 4, 6],
};
// Commonwealth table: by die and supply period I, II, III.
export const CW_SUPPLY_TABLE = { 1: [1, 2, 3], 2: [1, 3, 4], 3: [2, 3, 5], 4: [2, 3, 5], 5: [3, 4, 6], 6: [3, 4, 7] };
// Axis Naval Convoy Level Chart: letter per month (index 0 = January).
export const AXIS_CONVOY_LEVEL = {
  1940: [null, null, null, null, null, null, null, null, 'B', 'B', 'B', 'B'],
  1941: ['B', 'E', 'F', 'E', 'D', 'G', 'C', 'E', 'C', 'D', 'E', 'A'],
  1942: ['C', 'B', 'B', 'G', 'F', 'A', 'F', 'B', 'D', 'A', 'G', 'C'],
};
// Simple Axis Naval Convoy Bombing Chart: for each convoy route 1-6 the locations (map section + east-west hexrow,
// given as game rows) at which the Commonwealth gains more bomb points. Rows correspond to the bomb-point
// columns 21-40, 41-80, 81-120, 121-160, 161-200, 201-260, 261-320, 321-390, 391-470, 471+.
const loc = (s) => (s ? 33 * 'ABCDE'.indexOf(s[0]) + parseInt(s.slice(1), 10) - 1 : null);
export const CONVOY_BOMB_ROWS = [
  ['C01', 'D01', 'D01', 'E01', 'E11', 'D11'], ['B16', 'C16', 'C21', 'D21', 'E01', 'D01'],
  ['B01', 'C01', 'C11', 'D11', 'D21', 'C21'], ['A18', 'B16', 'C01', 'D01', 'D11', 'C11'],
  [null, 'B01', 'B26', 'C21', 'D01', 'C01'], [null, 'A18', 'B20', 'C11', 'C21', 'B26'],
  [null, null, 'B10', 'C01', 'C11', 'B20'], [null, null, 'B01', 'B26', 'C01', 'B10'],
  [null, null, 'A18', 'B20', 'B26', 'B01'], [null, null, null, 'B10', 'B20', 'A18'],
].map((row) => row.map(loc));
// Bomb points -> column of the Air Bombardment table (1-20 is column 0).
export function convoyBombColumn(points) {
  const edges = [20, 40, 80, 120, 160, 200, 260, 320, 390, 470];
  const i = edges.findIndex((e) => points <= e);
  return i < 0 ? 10 : i;
}
// Air Bombardment and Secondary Barrage Targets Table, "Axis Naval Convoy" rows: percentage destroyed.
const CONVOY_ROWS = [
  [0, ['11-66', '11-54', '11-33', '11-22', '-', '-', '-', '-', '-', '-', '-']],
  [5, ['-', '55-64', '34-64', '23-54', '11-45', '11-32', '11-21', '11-14', '-', '-', '-']],
  [10, ['-', '65-66', '65-66', '55-64', '46-63', '33-56', '22-51', '15-42', '11-23', '11-15', '-']],
  [20, ['-', '-', '-', '65-66', '64-66', '61-66', '52-63', '43-56', '24-51', '16-34', '11-24']],
  [25, ['-', '-', '-', '-', '-', '-', '64-66', '61-66', '52-63', '35-52', '25-36']],
  [30, ['-', '-', '-', '-', '-', '-', '-', '-', '64-66', '53-63', '41-54']],
  [40, ['-', '-', '-', '-', '-', '-', '-', '-', '-', '64-66', '55-63']],
  [50, ['-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '64-66']],
];
export const CONVOY_LOSS = Array.from({ length: 11 }, () => ({}));
CONVOY_ROWS.forEach(([pct, cells]) => cells.forEach((cell, c) => { for (const v of parseRange(cell)) CONVOY_LOSS[c][v] = pct; }));

export const _raw = { ATTACKER_LOSS_ROWS, DEFENDER_LOSS_ROWS, BARRAGE_ROWS, MORALE_ROWS, BREAKDOWN_ROWS, WEATHER_ROWS, CONVOY_ROWS, parseRange };
