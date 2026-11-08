// Reinforcement schedules [4.43a Commonwealth, 4.43b Axis], transcribed from the rulebook charts.
// Arrival turns/Operations Stages are the book's. Unit COMPOSITIONS are templates by unit class (the battalion-level
// Organisation-at-Arrival data is not entered yet), so strengths are approximate. Withdrawals (WD) are not modelled yet.
// Commonwealth units arrive in Cairo [20.14]. Axis units really arrive in Tripoli, which is off this map; here they appear
// at El Agheila, as the scenario rules place early arrivals [61.41].
import { U, E } from './scenario.js';

const ELAG = 'agheila';
// Templates: [type, size, cpa, morale, elements]
const T = {
  cwInfBde: (n = 27) => ['inf', 'brigade', 10, 1, [E('CW inf (k)', n), E('2-pounder AT', 3)]],
  cwMotBde: () => ['mot', 'brigade', 15, 1, [E('CW inf (h)', 18), E('2-pounder AT', 3)]],
  cwInfBn: (n = 9) => ['inf', 'battalion', 10, 1, [E('CW inf (k)', n)]],
  cwMG: () => ['inf', 'battalion', 10, 1, [E('CW MG (u)', 9)]],
  cwArty: (n = 12) => ['art', 'battalion', 15, 1, [E('25-pounder Gun', n)]],
  cwMedArty: () => ['art', 'battalion', 15, 1, [E('5.5in Gun/Howitzer', 8)]],
  cwAT: () => ['art', 'battalion', 15, 1, [E('2-pounder AT', 12)]],
  cwLAA: () => ['art', 'battalion', 15, 1, [E('Bofors 40mm AA', 6)]],
  cwHAA: () => ['art', 'battalion', 15, 1, [E('3.7in AA', 6)]],
  cwMatilda: () => ['arm', 'brigade', 15, 1, [E('Matilda Mk.II', 28)]],
  cwLight: () => ['arm', 'battalion', 35, 1, [E('Mark VI Light', 10)]],
  cwCruiser: (n = 30) => ['arm', 'brigade', 30, 1, [E('Crusader Mk.I', n)]],
  cwArmDiv: () => ['arm', 'division', 30, 1, [E('A13 Cruiser', 18), E('Mark VI Light', 10), E('CW inf (h)', 10), E('25-pounder Gun', 8)]],
  itDiv: () => ['inf', 'division', 10, -1, [E('IT inf (u)', 42), E('IT MG (bb)', 2), E('65/17 Gun', 2), E('47/32 AT', 2), E('75/27 Gun', 6), E('100/17 Howitzer', 3), E('75/46 AA', 2)]],
  itBn: () => ['inf', 'battalion', 10, -1, [E('IT inf (u)', 9)]],
  itLib: () => ['inf', 'battalion', 10, -2, [E('IT inf (x)', 9)]],
  itTank: () => ['arm', 'battalion', 20, -1, [E('M 13/40', 28)]],
  itArmDiv: () => ['arm', 'division', 20, 0, [E('M 13/40', 28), E('IT mot inf (n)', 12), E('75/27 Gun', 6)]],
  itArty: () => ['art', 'battalion', 15, -1, [E('75/27 Gun', 6), E('100/17 Howitzer', 3)]],
  itRecce: () => ['rec', 'battalion', 25, -1, [E('CV 33', 8)]],
  deInf: (n = 12) => ['inf', 'battalion', 25, 2, [E('DE inf', n)]],
  dePanzer: () => ['arm', 'battalion', 25, 2, [E('PzKw III', 20), E('PzKw II', 5)]],
  deAT: () => ['art', 'battalion', 25, 2, [E('47/32 AT', 12)]],
  deArty: () => ['art', 'battalion', 15, 2, [E('105/28 Gun', 12)]],
  deRecce: () => ['rec', 'battalion', 35, 2, [E('PzKw II', 8)]],
};

// [turn, stage, template-key(, arg), id, name, nation]  Commonwealth (4.43a), arrivals only.
const CW = [
  [1, 3, 'cwInfBde', 'cw-pol', 'Polish Bde', 'uk'],
  [2, 3, 'cwMatilda', 'cw-rtr2', '2nd & 7th Royal Tank Regts', 'uk'], [2, 3, 'cwArty', 'cw-6nzfa', '6th NZ Fld Arty Regt', 'nz'],
  [3, 3, 'cwArty', 'cw-1fa', '1st Fld Arty Regt', 'in'], [4, 3, 'cwLight', 'cw-3hus', '3rd Hussars', 'uk'],
  [5, 1, 'cwInfBde', 'cw-7ib', '7th Indian Bde', 'in'], [6, 3, 'cwInfBde', 'cw-6nzb', '6th New Zealand Bde', 'nz'],
  [7, 1, 'cwArty', 'cw-221fa', '2/2 Australian Fld Arty', 'au'], [8, 3, 'cwInfBn', 'cw-czech', '11th Czech Bn', 'uk'],
  [9, 2, 'cwInfBde', 'cw-19au', '19th Australian Bde', 'au'], [9, 3, 'cwArty', 'cw-107rha', '107th RHA', 'uk'],
  [11, 1, 'cwArty', 'cw-211fa', '2/1 Australian Fld Arty', 'au'], [11, 1, 'cwArty', 'cw-106rha', '106th RHA', 'uk'], [11, 2, 'cwLAA', 'cw-13laa', '13th LAA Regt', 'uk'],
  [12, 3, 'cwHAA', 'cw-74haa', '74th HAA Regt', 'uk'], [12, 3, 'cwLAA', 'cw-52laa', '52nd LAA Regt', 'uk'],
  [13, 1, 'cwInfBde', 'cw-20au', '20th Australian Bde', 'au'], [14, 3, 'cwInfBde', 'cw-18au', '18th Australian Bde', 'au'],
  [15, 1, 'cwArmDiv', 'cw-2arm', '2nd Armoured Div', 'uk'], [15, 1, 'cwArty', 'cw-1rha', '1st RHA', 'uk'], [15, 1, 'cwArty', 'cw-51fa', '51st Fld Arty Regt', 'uk'], [15, 1, 'cwHAA', 'cw-2haa', '2nd HAA Regt', 'uk'],
  [15, 2, 'cwArty', 'cw-104rha', '104th RHA', 'uk'], [16, 1, 'cwMedArty', 'cw-64med', '64th Medium Arty Regt', 'uk'],
  [19, 2, 'cwInfBn', 'cw-layforce', 'Layforce Commando', 'uk'],
  [20, 3, 'cwInfBde', 'cw-26au', '26th Australian Bde', 'au'], [20, 3, 'cwAT', 'cw-23at', '2/3 Australian AT Bn', 'au'],
  [21, 2, 'cwInfBde', 'cw-24au', '24th Australian Bde', 'au'], [23, 3, 'cwMotBde', 'cw-3mot', '3rd Indian Motor Bde', 'in'],
  [27, 1, 'cwAT', 'cw-73at', '73rd AT Regt', 'uk'], [28, 1, 'cwHAA', 'cw-61haa', '61st HAA Regt', 'uk'],
  [29, 2, 'cwLight', 'cw-4rtr', '4th Royal Tank Regt', 'uk'], [29, 3, 'cwLight', 'cw-9cav', '9th Australian Cavalry Regt', 'au'],
  [29, 3, 'cwArty', 'cw-228fa', '2/8 Australian Fld Arty', 'au'], [29, 3, 'cwArty', 'cw-2712fa', '2/7 & 2/12 Australian Fld Arty', 'au'], [29, 3, 'cwLAA', 'cw-231laa', '2/3 Australian LAA', 'au'],
  [30, 1, 'cwMG', 'cw-2mg', '2/2 Australian MG Bn', 'au'], [31, 1, 'cwLight', 'cw-1dg', '1st Royal Dragoons', 'uk'], [31, 1, 'cwLAA', 'cw-1laa', '1st LAA Regt', 'uk'],
  [31, 1, 'cwCruiser', 'cw-1armb', '1st Armoured Bde', 'uk'],
  [32, 1, 'cwInfBde', 'cw-5sa', '5th South African Bde', 'sa'], [32, 1, 'cwLight', 'cw-1ilh', '1st Imperial Light Horse', 'sa'],
  [33, 1, 'cwArty', 'cw-4fa', '4th Fld Arty Regt', 'uk'],
  [35, 1, 'cwInfBde', 'cw-14ib', '14th Infantry Bde', 'uk'], [35, 1, 'cwInfBde', 'cw-5nzb', '5th New Zealand Bde', 'nz'], [35, 1, 'cwArty', 'cw-5nzfa', '5th NZ Fld Arty Regt', 'nz'],
  [36, 1, 'cwMatilda', 'cw-1atb', '1st Army Tank Bde', 'uk'], [36, 3, 'cwInfBde', 'cw-2sab', '2nd South African Bde', 'sa'], [36, 3, 'cwInfBde', 'cw-150', '150th Infantry Bde', 'uk'],
  [37, 2, 'cwInfBde', 'cw-1sab', '1st South African Bde', 'sa'],
  [38, 1, 'cwInfBn', 'cw-capetown', 'Capetown Highlanders', 'sa'], [38, 1, 'cwMG', 'cw-steyn', 'President Steyn MG Bn', 'sa'],
  [38, 1, 'cwInfBde', 'cw-3sab', '3rd South African Bde', 'sa'], [38, 1, 'cwInfBde', 'cw-6sab', '6th South African Bde', 'sa'],
  [38, 2, 'cwInfBde', 'cw-9ib', '9th Indian Bde', 'in'], [38, 3, 'cwInfBn', 'cw-1ts', '1st Transvaal Scots', 'sa'], [38, 3, 'cwArty', 'cw-144fa', '144th Fld Arty Regt', 'in'], [38, 3, 'cwArty', 'cw-18fa', '18th Fld Arty Regt', 'uk'],
  [40, 1, 'cwInfBde', 'cw-10ib', '10th Indian Bde', 'in'], [40, 3, 'cwInfBde', 'cw-29ib', '29th Indian Bde', 'in'], [40, 3, 'cwLight', 'cw-doy', '1st DOY Cavalry', 'uk'],
];

// Axis (4.43b), GT9 on. 'itDiv' = a full Italian division, etc.
const AX = [
  [9, 2, 'itArty', 'it-xxvarty', 'XXV Corps Arty Regt', 'it'],
  [10, 1, 'itRecce', 'it-22brs', '22nd Bersaglieri Coy', 'it'], [10, 2, 'itLib', 'it-xxxiii', 'XXXIII Libyan Bn', 'it'], [10, 3, 'itDiv', 'it-61', '61st Sirte Div', 'it'],
  [11, 1, 'itBn', 'it-10brs', '10th Bersaglieri Regt', 'it'],
  [12, 1, 'itDiv', 'it-60', '60th Sabratha Div', 'it'], [12, 2, 'itLib', 'it-xxxiv', 'XXXIV Libyan Bn', 'it'],
  [13, 3, 'itTank', 'it-vm', 'V Medium Tank Bn', 'it'], [13, 3, 'itBn', 'it-140ccnn', '140th CCNN Bn', 'it'],
  [15, 2, 'itLib', 'it-xxxv', 'XXXV Libyan Bn', 'it'], [15, 2, 'itLib', 'it-ii87', 'II/87 Bn', 'it'],
  [17, 3, 'itTank', 'it-xxim', 'XXI Medium Tank Bn', 'it'],
  [18, 1, 'itArmDiv', 'it-132', '132nd Ariete Div', 'it'],
  [21, 1, 'deRecce', 'de-3auf', '3rd Aufklarungs Bn', 'de'], [21, 1, 'deAT', 'de-39pj', '39th Panzerjaeger Bn', 'de'], [21, 1, 'itDiv', 'it-102', '102nd Trento Div', 'it'],
  [21, 2, 'deInf', 'de-200eng', '200th Engineer Bn', 'de'], [21, 2, 'itDiv', 'it-27', '27th Brescia Div', 'it'],
  [22, 2, 'dePanzer', 'de-i5pz', 'I/5 Panzer Bn', 'de'], [22, 2, 'itDiv', 'it-17', '17th Pavia Div', 'it'], [22, 3, 'deAT', 'de-605pj', '605th Panzerjaeger Bn', 'de'],
  [23, 1, 'deArty', 'de-i75', 'I/75 Arty Bn', 'de'],
  [24, 1, 'itDiv', 'it-25', '25th Bologna Div', 'it'], [24, 2, 'dePanzer', 'de-ii5pz', 'II/5 Panzer Bn', 'de'], [24, 2, 'deArty', 'de-529cd', '529th & 532nd CD Arty Bns', 'de'],
  [24, 3, 'deAT', 'de-33pj', '33rd Panzerjaeger Bn', 'de'], [24, 3, 'deArty', 'de-528', '528th Arty Bn', 'de'],
  [25, 1, 'deInf', 'de-300oasis', '300th Oasis Bn (1st & 2nd Coys)', 'de'], [25, 1, 'itDiv', 'it-55', '55th Savona Div', 'it'], [25, 3, 'deInf', 'de-2mg', '2nd MG Bn', 'de'],
  [26, 1, 'deInf', 'de-8mg', '8th MG Bn', 'de'], [26, 1, 'itArty', 'it-2arty', '2nd Arty Ragruppamento', 'it'],
  [27, 2, 'deInf', 'de-200schutz', '200th Schutzen Regt HQ', 'de'],
];
const ROMMEL = { turn: 20, stage: 2, location: ELAG, unit: U('de-dak', 'axis', 'de', 'DAK HQ (Rommel)', 'hq', 'battalion', 30, 2, [], null, { rommel: true }) };

const build = (side, loc) => (row) => {
  const [turn, stage, key, id, name, nation] = row;
  const [type, size, cpa, morale, elements] = T[key]();
  return { turn, stage, location: loc, unit: U(id, side, nation, name, type, size, cpa, morale, elements, null) };
};

export const REINFORCEMENTS = [...CW.map(build('cw', 'cairo')), ...AX.map(build('axis', ELAG)), ROMMEL];
