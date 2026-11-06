// Rules data shared by the host (authoritative) and the client (for previews such as reachable hexes).
// Numbers are taken from the game's charts and encoded as data; descriptions are our own words.
// Rule references in brackets point at the case numbers in the original rulebook.

import { key } from './hex.js';

// ---------- Time [5.1, turn record track] ----------
// One Game-Turn = one week, four per month; Game-Turn 1 is the third week of September 1940.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function turnDate(gt) {
  const k = gt + 1; // weeks since 1st week of Sep 1940 (0-based)
  const m = 8 + Math.floor(k / 4);
  return `${MONTHS[m % 12]} ${['I', 'II', 'III', 'IV'][k % 4]} ${1940 + Math.floor(m / 12)}`;
}
// Seasons [29.1]: Spring Mar III-Jun II, Summer Jun III-Sep II, Fall Sep III-Dec II, Winter Dec III-Mar II.
export function seasonOfTurn(gt) {
  const k = gt + 1;
  const week = ((8 + Math.floor(k / 4)) % 12) * 4 + (k % 4); // 0-based week of the year, Jan I = 0
  if (week >= 10 && week < 22) return 'spring';
  if (week >= 22 && week < 34) return 'summer';
  if (week >= 34 && week < 46) return 'fall';
  return 'winter';
}
export const SECTION_ROWS = 33; // each map section is 33 hex rows deep
export const sectionOfRow = (r) => 'ABCDE'[Math.min(4, Math.floor(r / SECTION_ROWS))];
// Weather actually felt in one hex: hot is everywhere, storms only on the struck sections [29.31, 29.41, 29.51].
// Sandstorms never reach the Nile delta [29.41].
export function localWeather(weather, map, hex) {
  if (!weather || weather.type === 'normal') return 'normal';
  if (weather.type === 'hot') return 'hot';
  if (!weather.sections.includes(sectionOfRow(hex[1]))) return 'normal';
  const t = map?.tiles[key(...hex)]?.t;
  if (weather.type === 'sand' && t === 'delta') return 'normal';
  return weather.type;
}
export const OPS_STAGES_PER_TURN = 3;
export const LAST_GAME_TURN = 111;

// ---------- Initiative [7.0, chart 7.2] ----------
export function initiativeRating(side, { gt, rommelOnMap, germanCombatOnMap }) {
  if (side === 'cw') return gt <= 42 ? 3 : gt <= 90 ? 4 : 5;
  if (rommelOnMap) return 6;
  if (germanCombatOnMap) return 3;
  return 1;
}

// ---------- Capability Points [6.0, chart 6.3] ----------
export const CP = {
  breakContact: 2, // leave an enemy ZOC you started the segment in [8.15, 8.65]
  disengage: 4, // break off when Engaged [8.66]
  phasingAssault: 5, // barrage and/or an assault other than a probe
  phasingUndergoBarrage: 3,
  phasingProbe: 2,
  defend: 3, // non-phasing: barrage, be barraged, or defend against an assault
  defendProbe: 2,
  reserve: 0,
};
export const NON_MOTORISED_MAX_CPA = 10; // a CPA of 10 or less means foot-bound [8.17]
export const NON_MOTORISED_VOLUNTARY_LIMIT = 1.5; // may not voluntarily spend more than 150% of CPA [8.17]
export const COHESION_MAX = 10; // [6.23]
export const COHESION_COLLAPSE = -26; // cannot move, attack or defend; surrenders when approached [6.26]
export const REST_RP = 5; // a stage spent idle restores up to 5 points, never above 0 [6.24]
export const VICTORY_RP = 3; // assault that clears the defender's hex [6.24]
export const HEAVY_LOSS_DP = 3; // 30%+ losses in one close assault [6.21]
export const CONTINUAL_MOVE_RANGE = 2; // only units ending within 2 hexes of the enemy may move again [8.23]

// ---------- Stacking [9.0, chart 9.4] ----------
export const STACKING_POINTS = { division: 5, superBrigade: 3, brigade: 2, battalion: 1, company: 0 };

// ---------- Terrain Effects [8.37] ----------
// np/mp = CP to enter for non-motorised / motorised units; bp = breakdown value;
// stack = stacking limit; combat = column shifts (L = towards defender, R = towards attacker).
// P = prohibited (Infinity).
const P = Infinity;
export const TERRAIN = {
  sea: { label: 'Sea', np: P, mp: P, bp: 0, stack: 0 },
  clear: { label: 'Clear', np: 2, mp: 2, bp: 4, stack: 6 },
  gravel: { label: 'Gravel', np: 2, mp: 2, bp: 6, stack: 6 },
  saltmarsh: { label: 'Salt Marsh', np: 3, mp: 2, bp: 6, stack: 6, combat: { closeAssault: 'R1' }, vehiclesOnlyByRoadOrTrack: true },
  heavyveg: { label: 'Heavy Vegetation', np: 3, mp: 3, bp: 3, stack: 6, combat: { antiArmour: 'L1', closeAssault: 'L1' } },
  rough: { label: 'Rough', np: 3, mp: 4, bp: 8, stack: 6, combat: { barrage: 'L1', antiArmour: 'L1', closeAssault: 'L2' } },
  mountain: { label: 'Mountain', np: 4, mp: 6, bp: 12, stack: 3, combat: { barrage: 'L2', antiArmour: 'L2', closeAssault: 'L3' } },
  delta: { label: 'Delta', np: 2, mp: 4, bp: 2, stack: 6 },
  desert: { label: 'Desert (sand sea)', np: 3, mp: 4, bp: 24, stack: 6, lightVehiclesProhibited: true },
  majorcity: { label: 'Major City', np: 1, mp: 0.5, bp: 0.5, stack: 8, fortified: true },
  swamp: { label: 'Swamp', np: P, mp: P, bp: 0, stack: 6, onlyByRoad: true },
};
export const ROAD = { np: 1, mp: 0.5, bp: 0.5, stack: 5 };
export const TRACK = { np: 1, mp: 1, stack: 5 }; // halves hexside costs and breakdown [8.46]

// Hexside features. "Up"/"down" matter for slopes and escarpments [8.35].
export const HEXSIDES = {
  ridge: { label: 'Ridge', np: 2, mp: 4, bp: 2, combat: { antiArmour: 'L2', closeAssault: 'L2' } },
  upSlope: { label: 'Slope (up)', np: 2, mp: 4, bp: 2, combat: { antiArmour: 'L1', closeAssault: 'L2' } },
  downSlope: { label: 'Slope (down)', np: 1, mp: 2, bp: 2, combat: { antiArmour: 'L1', closeAssault: 'R1' } },
  upEscarpment: { label: 'Escarpment (up)', np: 6, mp: P, bp: 0, combat: { antiArmour: 'P', closeAssault: 'L3' } },
  downEscarpment: { label: 'Escarpment (down)', np: 4, mp: 8, bp: 6, combat: { antiArmour: 'L2', closeAssault: 'R1' }, vehiclesOnlyByTrack: true },
  wadi: { label: 'Wadi', np: 1, mp: 4, bp: 8, combat: { closeAssault: 'L1' } },
  majorRiver: { label: 'Major River', np: 8, mp: P, bp: 0, combat: { closeAssault: 'L6' } },
  minorRiver: { label: 'Minor River', np: 3, mp: 6, bp: 1, combat: { closeAssault: 'L2' } },
};

export const edgeKey = (a, b) => {
  const ka = key(...a), kb = key(...b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

// Hexside as seen when crossing from `from` to `to`.
function crossing(map, from, to) {
  const e = map.hexsides[edgeKey(from, to)];
  if (!e) return null;
  if (e.type === 'slope') return e.down === key(...to) ? 'downSlope' : 'upSlope';
  if (e.type === 'escarpment') return e.down === key(...to) ? 'downEscarpment' : 'upEscarpment';
  return e.type;
}

// Cost for a unit to step from one hex to an adjacent one, or null if it may not [8.3, 8.4].
// map = { tiles, hexsides, roads:Set(edgeKey), tracks:Set(edgeKey) }
export function stepCost(map, from, to, { motorised, weather = 'normal' }) {
  const tile = map.tiles[key(...to)];
  if (!tile) return null;
  const terr = TERRAIN[tile.t];
  const ek = edgeKey(from, to);
  const side = crossing(map, from, to);
  const sideData = side ? HEXSIDES[side] : null;

  const onRail = map.rails?.has(ek);
  let res;
  if (map.roads.has(ek)) {
    // Roads ignore terrain in the hex and negate hexside features.
    // In a rainstorm they cost and break vehicles like tracks [29.56].
    res = weather === 'rain'
      ? { cp: TRACK[motorised ? 'mp' : 'np'], bp: motorised ? terr.bp / 2 : 0, via: 'road' }
      : { cp: motorised ? ROAD.mp : ROAD.np, bp: motorised ? ROAD.bp : 0, via: 'road' };
  } else {
    res = stepCostOffRoad(map, tile, terr, ek, side, sideData, motorised, weather, onRail);
  }
  if (res && weather === 'sand') res = { ...res, cp: res.cp * 2 }; // [29.44]
  return res;
}

function stepCostOffRoad(map, tile, terr, ek, side, sideData, motorised, weather, onRail) {
  if (tile.t === 'sea' || terr.onlyByRoad) return null;
  if (weather === 'rain') {
    // Wadis and rivers are uncrossable except by road or rail [29.55, 29.57]; deltas cannot be entered by vehicles off-road [29.58].
    if (side === 'wadi' || side === 'majorRiver' || side === 'minorRiver') { if (!onRail) return null; }
    if (motorised && tile.t === 'delta' && !onRail) return null;
  }

  if (map.tracks.has(ek)) {
    if (motorised && side === 'upEscarpment') return null; // vehicles never go up an escarpment [8.42]
    let cp = TRACK[motorised ? 'mp' : 'np'];
    let bp = motorised ? terr.bp / 2 : 0;
    if (sideData) {
      const full = sideData[motorised ? 'mp' : 'np'];
      // Tracks halve hexside costs, except the CP for vehicles going down an escarpment [TEC note 8].
      cp += side === 'downEscarpment' && motorised ? full : full / 2;
      if (motorised) bp += sideData.bp / 2;
    }
    return { cp, bp, via: 'track' };
  }

  if (motorised && terr.vehiclesOnlyByRoadOrTrack) return null; // salt marsh [8.44]
  if (sideData) {
    if (motorised && sideData.vehiclesOnlyByTrack) return null;
    if (sideData[motorised ? 'mp' : 'np'] === P) return null;
  }
  const base = terr[motorised ? 'mp' : 'np'];
  if (base === P) return null;
  const cp = base + (sideData ? sideData[motorised ? 'mp' : 'np'] : 0);
  const bp = motorised ? terr.bp + (sideData ? sideData.bp : 0) : 0;
  return { cp, bp, via: 'terrain' };
}

export function stackingLimit(map, hex) {
  const t = map.tiles[key(...hex)];
  return t ? TERRAIN[t.t].stack : 0;
}
