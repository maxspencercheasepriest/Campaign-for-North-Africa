// The Air Game, stage 2: the Land Support Air Phase. Fighter missions only (bombing and flak come later).
// Rules used: air supply and Tactical Maintenance [38], flight limits [37.22, 39.11], scramble [40.3], CAP and
// strafing missions [40], air-to-air combat [45] and pilot recovery [34.8, 45].
import { AIRCRAFT, SQUADRON_CAPACITY, FACILITY_CAPACITY, facilityHex } from '../shared/air.js';
import { distance, key, parseKey } from '../shared/hex.js';
import { hexFromName, nameOfHex } from '../shared/hexnames.js';
import { syncStr } from './combat.js';
import { LOCATIONS } from '../shared/locations.js';

const other = (s) => (s === 'axis' ? 'cw' : 'axis');
const sideName = (s) => (s === 'axis' ? 'Axis' : 'Commonwealth');

// ---------- Tables ----------
// Scramble [40.33]: distance from the base to the incoming flight -> number the d6 must not exceed.
const SCRAMBLE = [[2, 6], [4, 5], [6, 4], [8, 3], [10, 2], [15, 1]];
export const scrambleNumber = (d) => (SCRAMBLE.find(([max]) => d <= max) || [0, 0])[1];

// Maneuver Adjustment [45.2]: Maneuver rating differential -> adjustment.
export const maneuverAdjustment = (diff) => (diff <= 0 ? 0 : diff <= 3 ? 1 : diff <= 7 ? 2 : diff <= 14 ? 3 : diff <= 20 ? 4 : 5);

// TacAir Kill table [45.3]: adjusted differential -> highest d66 (sequential) that kills. 0 = cannot be killed.
export function killNumber(diff) {
  if (diff <= -13) return 0;
  if (diff <= -5) return 11;
  if (diff <= -2) return 12;
  const t = { '-1': 13, 0: 14, 1: 15, 2: 16, 3: 22, 4: 24, 5: 26, 6: 32, 7: 34, 8: 36, 9: 43, 10: 46, 11: 53 };
  return diff >= 12 ? 56 : t[diff];
}

// Refit by squadron [38.4]: modified d6 -> share of the squadron's planes refitted.
const REFIT_PCT = [0, 100, 80, 70, 60, 50, 40, 40, 33, 33];
export const refitShare = (roll) => REFIT_PCT[Math.max(1, Math.min(9, roll))];

// Strafing [40.5]: column by total TacAir; d66 thresholds for 1, 2 and 3 TOE points of infantry eliminated.
const STRAFE_T1 = [64, 61, 54, 51, 43, 35, 26, 21, 11, 11];
const STRAFE_T2 = [99, 99, 66, 65, 64, 63, 62, 61, 56, 51];
const STRAFE_T3 = [99, 99, 99, 99, 99, 99, 99, 99, 66, 65];
export const strafeColumn = (tac) => (tac <= 0 ? -1 : Math.min(9, Math.floor((tac - 1) / 5)));
export function strafeResult(col, roll) {
  if (col < 0) return 0;
  col = Math.min(9, col);
  return roll >= STRAFE_T3[col] ? 3 : roll >= STRAFE_T2[col] ? 2 : roll >= STRAFE_T1[col] ? 1 : 0;
}


// ---------- Air Bombardment and Secondary Barrage Targets Table [41.5] ----------
// Columns by bomb tonnage: 1-20, 21-40, 41-80, 81-120, 121-160, 161-200, 201-260, 261-320, 321-390, 391-470, 471+.
// Each row gives the d66 range (sequential) that yields that result; '-' means it cannot happen in that column.
const COL_MAX = [20, 40, 80, 120, 160, 200, 260, 320, 390, 470, Infinity];
export const bombColumn = (tons) => (tons <= 0 ? -1 : COL_MAX.findIndex((m) => tons <= m));
const rows = (list) => list.map(([result, spec]) => ({ result, cols: spec.split(/\s+/).map((c) => (c === '-' ? null : c.split('-').map(Number).concat(c.includes('-') ? [] : [Number(c)]).slice(0, 2))) }));
const FAC_ROWS = rows([
  [0, '11-62 11-55 11-51 11-42 11-36 11-31 11-15 11-12 - - -'],
  [1, '63-66 56-66 52-66 43-66 41-62 32-56 16-55 13-46 11-43 11-36 11-25'],
  [2, '- - - - 63-66 61-66 56-65 51-64 44-63 41-55 26-52'],
  [3, '- - - - - - 66 65-66 64-65 56-63 53-61'],
  [4, '- - - - - - - - 66 64-66 62-66'],
]);
const DUMP_ROWS = rows([
  [0, '11-62 11-56 11-46 11-34 11-16 - - - - - -'],
  [10, '63-66 61-66 51-66 35-64 21-56 11-46 11-34 11-16 - - -'],
  [20, '- - - 65-66 61-66 51-64 35-56 21-46 11-34 11-16 -'],
  [30, '- - - - - 65-66 61-66 51-64 35-56 21-46 11-34'],
  [40, '- - - - - - - 65-66 61-66 51-64 35-56'],
  [50, '- - - - - - - - - 65-66 61-64'],
  [75, '- - - - - - - - - - 65-66'],
]);
// Troops, trucks, flak and the Commonwealth fleet: battalion-equivalents pinned.
const PIN_ROWS = rows([
  [0, '11-62 11-46 11-16 11-12 - - - - - - -'],
  [1, '63-66 51-66 21-66 13-42 11-24 - - - - - -'],
  [2, '- - - 43-66 25-46 11-36 11-16 - - - -'],
  [3, '- - - - 51-66 41-62 21-46 11-34 11-16 - -'],
  [4, '- - - - - 63-66 51-66 35-64 21-56 11-46 11-16'],
  [5, '- - - - - - - 65-66 61-64 51-56 21-46'],
  [6, '- - - - - - - - 65-66 61-66 51-64'],
  [7, '- - - - - - - - - - 65-66'],
]);
export const BOMB_TABLES = { facility: FAC_ROWS, dump: DUMP_ROWS, pin: PIN_ROWS };
const _ = null; void _;

// Fortification, Railroad and Road rows of the same table: the lowest d66 that gives the damaging result, by column [41.5].
const FORT_T = [66, 64, 61, 53, 44, 34, 25, 21, 14, 12, 11];
const RAIL_T = [64, 62, 54, 44, 33, 23, 15, 11, 11, 11, 11];
const ROAD_T = [66, 64, 61, 52, 41, 26, 21, 14, 11, 11, 11];
export const fortReduced = (col, roll) => col >= 0 && roll >= FORT_T[col];
export const railDestroyed = (col, roll) => col >= 0 && roll >= RAIL_T[col];
export const roadDestroyed = (col, roll) => col >= 0 && roll >= ROAD_T[col];

// ---------- Damage to roads, railways and fortifications ----------
// g.damage = { roads:{hexKey:turn}, rails:{hexKey:turn}, fort:{hexKey:levelsLost}, fortHit:{hexKey:'turn.stage'} }
export const newDamage = () => ({ roads: {}, rails: {}, fort: {}, fortHit: {}, built: {} });
// Major cities are Level 2 fortifications; Cairo and Alexandria Level 3 [25.12]. Elsewhere a fortification exists only where one was built (d.built).
const cityOf = (hex) => LOCATIONS.find((l) => l.city && l.hexes.some((h) => h[0] === hex[0] && h[1] === hex[1]));
export const isCity = (hex) => !!cityOf(hex);
export function fortBase(hex, d) {
  const loc = cityOf(hex);
  if (loc) return /cairo|alexandria/i.test(loc.name) ? 3 : 2;
  return d?.built?.[key(...hex)] || 0;
}
export const fortLevel = (d, hex) => Math.max(0, fortBase(hex, d) - ((d?.fort || {})[key(...hex)] || 0));
// ---------- Port efficiency [55.12-55.18] ----------
const PORT_MAX = { tripoli: 10, alexandria: 10, tobruk: 5, benghazi: 3 }; // every other port is 1 [55.3]
export const portMax = (id) => PORT_MAX[id] ?? 1;
export const portEff = (g, id) => g.portEff?.[id] ?? portMax(id);
// A port that lost no levels to bombs in the last Operations Stage regains one [55.18].
export function repairPorts(g) {
  g.portEff ||= {};
  for (const l of LOCATIONS.filter((x) => x.port)) {
    const e = portEff(g, l.id);
    if (!g.portLost?.[l.id] && e < portMax(l.id)) g.portEff[l.id] = e + 1;
  }
  g.portLost = {};
}

export function bombResult(table, col, roll) {
  if (col < 0) return 0;
  let best = table[0].result;
  for (const row of table) { const c = row.cols[col]; if (c && roll >= c[0] && roll <= c[1]) best = row.result; }
  return best;
}


// ---------- Anti-Aircraft Combat Results Table [46.3] ----------
// Columns by Flak Points: 1-4, 5-8, 9-12, 13-16, 17-20, 21-24, 25-28, 29-32, 33-36, 37+.
const AA_DESTROYED = rows([
  [0, '11-55 11-45 11-36 11-32 11-21 11-12 - - - -'],
  [1, '56-66 46-65 41-62 33-56 22-55 13-53 11-45 11-36 11-32 11-24'],
  [2, '- 66 63-66 61-64 56-64 54-63 46-61 41-54 33-51 25-43'],
  [3, '- - - 65-66 65-66 64-66 62-65 55-64 52-62 44-56'],
  [4, '- - - - - - 66 65-66 63-65 61-64'],
  [5, '- - - - - - - - 66 65-66'],
]);
const AA_ABORTED = rows([
  [0, '11-53 11-42 11-31 11-22 11-13 - - - - -'],
  [1, '54-66 43-64 32-62 23-55 14-52 11-44 11-31 11-21 11-12 -'],
  [2, '- 65-66 63-66 56-64 53-62 45-55 32-52 22-43 13-34 11-26'],
  [3, '- - - 65-66 63-65 56-63 53-62 44-55 35-51 31-43'],
  [4, '- - - - 66 64-66 63-66 56-65 52-63 44-54'],
  [5, '- - - - - - - 66 64-65 55-62'],
  [6, '- - - - - - - - 66 63-65'],
  [7, '- - - - - - - - - 66'],
]);
const AA_FIGHTER = rows([
  [0, '11-64 11-56 11-52 11-42 11-31 11-16 - - - -'],
  [1, '65-66 61-66 53-66 43-66 32-65 21-62 11-56 11-46 11-34 11-16'],
  [2, '- - - - 66 63-66 61-66 51-64 35-62 21-56'],
  [3, '- - - - - - - 65-66 63-66 61-66'],
]);
export const AA_TABLES = { destroyed: AA_DESTROYED, aborted: AA_ABORTED, fighter: AA_FIGHTER };
export const flakColumn = (points) => (points <= 0 ? -1 : Math.min(9, Math.floor((points - 1) / 4)));
// Flak Adjustment Chart [46.4]: columns moved in the firing player's favour by the number of non-fighter planes.
export const flakShift = (nonFighters) => (nonFighters >= 72 ? 3 : nonFighters >= 48 ? 2 : nonFighters >= 24 ? 1 : 0);
export function aaResult(table, col, roll) {
  if (col < 0) return 0;
  let best = table[0].result;
  for (const row of table) { const c = row.cols[Math.min(9, col)]; if (c && roll >= c[0] && roll <= c[1]) best = row.result; }
  return best;
}

// ---------- Air supply and maintenance ----------
export const planeInfo = (p) => AIRCRAFT[p.type];
export const flightReady = (p) => p.ready && p.fueled;

// Under the Abstract Logistics rules [47.22, 47.23] a whole squadron is fuelled for 1 Fuel (fighters), 2 (Axis other) or 3 (Commonwealth other),
// and fighters need no Ammo to be armed while other squadrons are rearmed for 1 Ammo.
export function fuelAndArm(air, side) {
  const st = air.stock[side];
  for (const sq of air.squadrons.filter((q) => q.side === side)) {
    const fighter = sq.kind === 'fighter';
    const toFuel = sq.planes.filter((p) => p.ready && !p.fueled);
    const cost = fighter ? 1 : side === 'axis' ? 2 : 3;
    if (toFuel.length && st.fuel >= cost) { st.fuel -= cost; for (const p of toFuel) p.fueled = true; }
    const unarmed = sq.planes.filter((p) => p.ready && p.fueled && !p.armed);
    if (unarmed.length && (fighter || st.ammo >= 1)) { if (!fighter) st.ammo -= 1; for (const p of unarmed) p.armed = true; }
  }
}

// Refit each squadron's flown planes: one d6 per squadron, 1 Stores each [38.4].
function refit(air, side, ctx, log) {
  const st = air.stock[side];
  for (const sq of air.squadrons.filter((s) => s.side === side)) {
    const cap = SQUADRON_CAPACITY[sq.nation].ready;
    const todo = sq.planes.filter((p) => !p.ready);
    const ready = sq.planes.filter((p) => p.ready).length;
    if (!todo.length || ready >= cap || st.stores < 1) continue;
    if (sq.nation === 'it' && ctx.turn <= ctx.firstTurn && ctx.opStage < 2) continue; // Italians cannot refit before GT1 stage 2
    st.stores -= 1;
    const roll = ctx.d6() + (sq.nation === 'de' ? 1 : sq.nation === 'it' ? 2 : 0);
    const n = Math.min(cap - ready, Math.ceil((todo.length * refitShare(roll)) / 100));
    for (const p of todo.slice(0, n)) p.ready = true;
    log(side, `${sq.name} refit (roll ${roll}): ${n} of ${todo.length} planes made ready.`);
  }
}

export function tacticalMaintenance(air, ctx) {
  for (const side of ['axis', 'cw']) {
    refit(air, side, ctx, ctx.log);
    fuelAndArm(air, side);
  }
}

// Bombed facilities recover one level a Game-Turn. This is a stand-in until the construction rules are built.
export function repairFacilities(air) {
  for (const f of air.facilities) { const max = FACILITY_CAPACITY[f.kind]; if (f.cap < max) f.cap += 1; }
}

// Surviving pilots rejoin their squadron a Game-Turn later [34.83].
export function returnPilots(air, turn) {
  for (const r of air.returning.filter((x) => x.turn <= turn)) {
    const sq = air.squadrons.find((s) => s.id === r.sq);
    const slot = sq && sq.planes.find((p) => p.pilot === 0);
    if (slot) slot.pilot = r.rating;
  }
  air.returning = air.returning.filter((x) => x.turn > turn);
}

// ---------- Orders ----------
export const MISSION_KINDS = { transfer: 'Transfer to another base', capO: 'Offensive patrol', capD: 'Defensive patrol', strafe: 'Strafing', scramble: 'Scramble (stand by)', bCU: 'Bomb troops', bSD: 'Bomb a supply dump', bAF: 'Bomb an air facility', bRD: 'Bomb a road', bRR: 'Bomb a railway', bFC: 'Bomb a fortification', bTC: 'Bomb trucks', bPT: 'Bomb a port', bCF: 'Bomb ships' };
const BOMB_KINDS = ['bCU', 'bSD', 'bAF', 'bRD', 'bRR', 'bFC', 'bTC', 'bPT', 'bCF'];
export const isBombMission = (k) => BOMB_KINDS.includes(k);

// Planes of a squadron that can fly the mission right now.
// In the charts "!" means a capability that may not be flown at night and "N" one that may, so an N-plane can also fly by day [4.44].
const capable = (p, need) => { const t = planeInfo(p).caps.split(' '); return t.includes(need) || t.includes('N'); };
function flyable(sq, kind) {
  if (isBombMission(kind)) return sq.planes.filter((p) => flightReady(p) && p.armed && planeInfo(p).bomb > 0 && capable(p, 'B'));
  const need = kind === 'strafe' ? 'S' : 'F';
  return sq.planes.filter((p) => flightReady(p) && (need === 'S' ? planeInfo(p).caps.split(' ').includes('S') : capable(p, 'F')));
}
// Blenheim IVF, Bf 110 and Ju 88c lose 4 Maneuver points by day [40.92].
const manOf = (p) => planeInfo(p).man - (/Blenheim Mk\.IVF|Bf.?110|Ju.?88c/i.test(p.type) ? 4 : 0);

// Transfer missions [39.0 / 4.44 note]: the whole squadron moves to another friendly facility with room. Stand-in range: a one-way trip
// is twice a plane's normal range (or its printed transfer range if that is longer); the squadron is limited by its shortest-range plane.
export function transferRange(sq) {
  return Math.min(...sq.planes.map((p) => {
    const info = planeInfo(p);
    const tr = Math.max(0, ...(info.alt || []).filter((a) => a.note === 'transfer').map((a) => a.range));
    return Math.max(info.range * 2, tr);
  }));
}
export function transferOptions(g, sq) {
  const here = g.air.facilities.find((f) => f.id === sq.facility);
  const from = here && facilityHex(here);
  if (!from || !sq.planes.length) return [];
  const range = transferRange(sq), boat = sq.kind === 'flyingboat';
  return g.air.facilities
    .filter((f) => f.owner === sq.side && f.id !== sq.facility && f.hex && !f.off && f.used < f.cap && (boat ? f.kind === 'basin' || f.kind === 'alighting' : f.kind === 'airfield' || f.kind === 'strip'))
    .map((f) => ({ id: f.id, name: f.name, kind: f.kind, hex: f.hex, d: distance(from, facilityHex(f)) }))
    .filter((f) => f.d <= range).sort((a, b) => a.d - b.d);
}

export function validateAirOrders(g, side, o, map) {
  if (o.missions != null && !Array.isArray(o.missions)) return 'Missions must be a list.';
  const used = new Set();
  for (const m of o.missions || []) {
    const sq = g.air.squadrons.find((s) => s.id === m.sq);
    if (!sq || sq.side !== side) return 'Choose one of your own squadrons.';
    if (used.has(sq.id)) return `${sq.name} has two missions: one per squadron.`;
    used.add(sq.id);
    if (!MISSION_KINDS[m.kind]) return 'Unknown mission.';
    if (m.kind === 'transfer') {
      if (!transferOptions(g, sq).some((f) => f.id === m.to)) return `${sq.name}: choose a friendly base with room that is within the squadron's transfer range.`;
      continue;
    }
    if (sq.kind === 'fighter' && isBombMission(m.kind)) return `${sq.name} is a fighter squadron; it cannot fly bombing missions.`;
    if (sq.kind === 'bomber' && !isBombMission(m.kind)) return `${sq.name} is a bomber squadron; give it a bombing mission.`;
    if (sq.kind !== 'fighter' && sq.kind !== 'bomber') return `${sq.name}: only fighter and bomber missions are in the game so far.`;
    if (m.kind === 'scramble') continue;
    const hex = typeof m.hex === 'string' ? hexFromName(m.hex) : null;
    if (m.kind === 'bCF' && hex && map.tiles[key(...hex)]) continue; // ships can be bombed at sea [30.32]
    if (!hex || !map.tiles[key(...hex)] || map.tiles[key(...hex)].t === 'sea') return `${sq.name}: give a land hex such as C4807 for the target.`;
  }
  return null;
}

// What an unseated side does: every fighter squadron stands by to scramble.
export function autoAirOrders(g, side) {
  return { missions: g.air.squadrons.filter((s) => s.side === side && s.kind === 'fighter').map((s) => ({ sq: s.id, kind: 'scramble' })) };
}

// ---------- Resolution ----------
const sandOrRain = (ctx, hex) => ['sand', 'rain'].includes(ctx.weatherAt(hex));
const rollD66 = (ctx) => ctx.d6() * 10 + ctx.d6();
const hexName = (h) => nameOfHex(h[0], h[1]);

// A squadron cannot take off with enemy land combat units next to its base [39.11].
function baseBlocked(sq, base, ctx) {
  return ctx.units.some((u) => u.side !== sq.side && u.str > 0 && u.type !== 'hq' && u.type !== 'truck' && distance(u.pos, base) <= 1);
}

function eligiblePlanes(sq, kind, target, ctx) {
  const fac = ctx.air.facilities.find((f) => f.id === sq.facility);
  const base = fac && facilityHex(fac);
  if (!base || fac.cap < 1) return null;
  if (baseBlocked(sq, base, ctx)) return null;
  if (sandOrRain(ctx, base) || sandOrRain(ctx, target)) return null;
  const d = distance(base, target);
  const planes = flyable(sq, kind).filter((p) => planeInfo(p).range >= d);
  return planes.length ? { base, planes, d } : null;
}

const eff = (p, bonus = 0) => (p.armed ? planeInfo(p).tac + (p.pilot || 0) + bonus : 0);

// One duel between an attacking and a defending fighter [45.2-45.3]. Returns the plane that was shot down, or null.
function duel(a, d, ctx) {
  const A = { ...planeInfo(a.p), man: manOf(a.p) }, D = { ...planeInfo(d.p), man: manOf(d.p) };
  const adj = maneuverAdjustment(Math.abs(A.man - D.man));
  const base = eff(a.p, a.bonus || 0) - eff(d.p, d.bonus || 0);
  const diffA = base + (A.man > D.man ? adj : A.man < D.man ? -adj : 0);
  const diffD = -base + (D.man > A.man ? adj : D.man < A.man ? -adj : 0);
  // The weaker differential fires first; a bomber (parenthesised TacAir) may only fire back [41.15].
  const order = D.paren || (!A.paren && diffD >= diffA) ? [[a, d, diffA], [d, a, diffD]] : [[d, a, diffD], [a, d, diffA]];
  for (const [shooter, target, diff] of order) {
    const n = killNumber(diff);
    const roll = rollD66(ctx);
    if (n && roll <= n) return { down: target, by: shooter, roll, n };
  }
  return null;
}

// A shot-down fighter's fate: 1 limped home, 2 only the pilot lives, 3-6 both lost [45.5].
function recover(ent, ctx) {
  const sq = ent.sq, p = ent.p;
  const r = ctx.d6();
  if (r === 1) { p.ready = false; p.fueled = false; p.armed = false; return 'limped home'; }
  sq.planes.splice(sq.planes.indexOf(p), 1);
  if (p.pilot == null) return 'plane lost';
  if (r === 2) { if (p.pilot > 0) ctx.air.returning.push({ sq: sq.id, rating: p.pilot, turn: ctx.turn + 1 }); return 'plane lost, pilot rescued'; }
  return 'plane and pilot lost';
}


// Truck Points are the 30 Motorization Points each supply unit carries; a supply unit below 30 cannot move [32.32]. Losses are spread evenly [41.32].
function truckHits(units, n, ctx) {
  let lost = 0;
  for (let i = 0; i < n; i++) {
    const u = units.filter((x) => x.mp > 0).sort((a, b) => b.mp - a.mp)[0];
    if (!u) break;
    u.mp -= 1; lost++;
  }
  return lost;
}

// Apply one bombing mission's result to its target hex.
function bombTarget(f, tons, n, ctx, say) {
  const side = f.side, hex = f.hex, enemy = other(side);
  const where = hexName(hex);
  const tag = `${sideName(side)} bombers (${n} planes, ${tons} tons) over ${where}`;
  const col = bombColumn(tons);
  if (!n) return;
  const roll = rollD66(ctx);
  if (f.kind === 'bCU') {
    if (ctx.map.tiles[key(...hex)]?.t === 'majorcity' && fortLevel(ctx.damage, hex) > 1) { say(`${tag}: units in a major city cannot be bombed until its fortification is down to Level 1 [41.31].`); return; }
    const targets = ctx.units.filter((u) => u.side === enemy && u.str > 0 && u.type !== 'hq' && u.pos[0] === hex[0] && u.pos[1] === hex[1]);
    if (!targets.length) { say(`${tag}: no enemy troops there.`); return; }
    let points = bombResult(PIN_ROWS, col, roll);
    const els = targets.flatMap((u) => u.elements.filter((e) => e.toe > 0 && ctx.weapons[e.w]));
    let pinned = 0;
    for (let guard = 0; points > 0 && guard < 50; guard++) {
      const open = els.filter((e) => e.toe - (e.airPin || 0) > 0);
      if (!open.length) break;
      const e = open[(ctx.d6() - 1) % open.length];
      const w = ctx.weapons[e.w];
      e.airPin = Math.min(e.toe, (e.airPin || 0) + (w.bn || e.toe));
      points -= w.class === 'infantry' ? 1 : 2; // each tank or gun battalion counts for two [41.31]
      pinned++;
    }
    say(`${tag} (d66 ${roll}): ${pinned ? `${pinned} enemy battalion-sized group${pinned > 1 ? 's' : ''} pinned.` : 'no effect.'}`);
  } else if (f.kind === 'bSD') {
    const dumps = ctx.supplyUnitsAt(hex, enemy);
    if (!dumps.length) { say(`${tag}: no supply dump there.`); return; }
    const pct = bombResult(DUMP_ROWS, col, roll);
    for (const d of dumps) { d.ammo = Math.floor(d.ammo * (1 - pct / 100)); d.fuel = Math.floor(d.fuel * (1 - pct / 100)); }
    const lostTrucks = truckHits(dumps, pct / 10, ctx);
    say(`${tag} (d66 ${roll}): ${pct}% of the supplies in the dump destroyed${lostTrucks ? `, and ${lostTrucks} Truck Point${lostTrucks > 1 ? 's' : ''} with them` : ''}.`);
  } else if (f.kind === 'bRD' || f.kind === 'bRR') {
    const road = f.kind === 'bRD', hk = key(...hex), set = road ? ctx.damage.roads : ctx.damage.rails;
    const lines = road ? ctx.map.roads : ctx.map.rails;
    const has = [...(lines || [])].some((ek) => ek.split('|').includes(hk));
    if (!has) { say(`${tag}: no ${road ? 'road' : 'railway'} left in that hex.`); return; }
    const hit = (road ? roadDestroyed : railDestroyed)(col, roll);
    if (hit) set[hk] = ctx.turn;
    say(`${tag} (d66 ${roll}): ${hit ? `the ${road ? 'road' : 'railway'} in that hex is destroyed${road ? ' and counts as a track [24.52]' : ''}.` : 'no effect.'}`);
  } else if (f.kind === 'bFC') {
    const hk = key(...hex), stamp = `${ctx.turn}.${ctx.opStage}`;
    if (fortBase(hex, ctx.damage) < 1) { say(`${tag}: no fortification there to bomb.`); return; }
    const lv = fortLevel(ctx.damage, hex);
    if (lv < 1) { say(`${tag}: the fortification is already at Level 0.`); return; }
    if (ctx.damage.fortHit[hk] === stamp) { say(`${tag}: only one fortification level can be destroyed per Operations Stage [41.37].`); return; }
    const hit = fortReduced(col, roll);
    if (hit) { ctx.damage.fort[hk] = (ctx.damage.fort[hk] || 0) + 1; ctx.damage.fortHit[hk] = stamp; }
    say(`${tag} (d66 ${roll}): ${hit ? `fortification reduced to Level ${lv - 1}.` : 'no effect.'}`);
  } else if (f.kind === 'bCF') {
    if (side !== 'axis') { say(`${tag}: only the Commonwealth has a fleet to bomb.`); return; }
    const pts = bombResult(PIN_ROWS, col, roll);
    const r = ctx.damageShips ? ctx.damageShips(hex, pts) : { ships: 0, done: 0, sunk: [] };
    say(r.ships ? `${tag} (d66 ${roll}): ${r.done} Damage Point${r.done === 1 ? '' : 's'} on the ships${r.sunk.length ? `; sunk: ${r.sunk.join(', ')}` : ''}.` : `${tag}: no ships there.`);
  } else if (f.kind === 'bPT') {
    const port = LOCATIONS.find((l) => l.port && l.hexes.some((h) => h[0] === hex[0] && h[1] === hex[1]));
    if (!port || ctx.portOwners?.[port.id] === side) { say(`${tag}: no enemy port there.`); return; }
    const g = ctx.game, eff = portEff(g, port.id);
    const lv = Math.min(eff, bombResult(FAC_ROWS, col, roll));
    g.portEff ||= {}; g.portEff[port.id] = eff - lv;
    if (lv) (g.portLost ||= {})[port.id] = true;
    say(`${tag} (d66 ${roll}): ${port.name} ${lv ? `loses ${lv} efficiency level${lv > 1 ? 's' : ''}, now ${eff - lv} of ${portMax(port.id)}` : 'is not hurt'}.`);
  } else if (f.kind === 'bTC') {
    const dumps = ctx.supplyUnitsAt(hex, enemy);
    if (!dumps.length) { say(`${tag}: no trucks there.`); return; }
    if (ctx.map.tiles[key(...hex)]?.t === 'majorcity' && fortLevel(ctx.damage, hex) > 0) { say(`${tag}: trucks in a major city cannot be bombed until its fortification is at Level 0 [41.32].`); return; }
    const n2 = truckHits(dumps, bombResult(PIN_ROWS, col, roll), ctx);
    say(`${tag} (d66 ${roll}): ${n2 ? `${n2} Truck Point${n2 > 1 ? 's' : ''} destroyed.` : 'no trucks destroyed.'}`);
  } else if (f.kind === 'bAF') {
    const fac = ctx.air.facilities.find((x) => x.owner === enemy && x.hex && facilityHex(x) && key(...facilityHex(x)) === key(...hex));
    if (!fac) { say(`${tag}: no enemy air facility there.`); return; }
    const lv = Math.min(fac.cap, bombResult(FAC_ROWS, col, roll));
    fac.cap -= lv;
    const here = ctx.air.squadrons.filter((q) => q.facility === fac.id).flatMap((q) => q.planes.map((p) => ({ q, p })));
    here.sort((a, b) => (a.p.ready ? 1 : 0) - (b.p.ready ? 1 : 0));
    const lost = Math.floor((here.length * 10 * lv) / 100);
    for (const { q, p } of here.slice(0, lost)) q.planes.splice(q.planes.indexOf(p), 1);
    say(`${tag} (d66 ${roll}): ${fac.name} reduced by ${lv} level${lv === 1 ? '' : 's'}${lost ? `, ${lost} planes destroyed on the ground` : ''}.`);
  }
}

function transferSquadron(air, sq, toId, ctx) {
  const from = air.facilities.find((f) => f.id === sq.facility), to = air.facilities.find((f) => f.id === toId);
  const fromHex = from && facilityHex(from), toHex = to && to.hex && !to.off && facilityHex(to);
  const fail = (why) => ctx.log(sq.side, `${sq.name} could not transfer to ${to?.name || toId}: ${why}.`);
  if (!fromHex || !toHex || to.owner !== sq.side) return fail('no such friendly base');
  if (to.used >= to.cap) return fail('the base has no room');
  if (distance(fromHex, toHex) > transferRange(sq)) return fail('out of range');
  if (baseBlocked(sq, fromHex, ctx) || baseBlocked(sq, toHex, ctx)) return fail('enemy troops beside a base');
  if (sandOrRain(ctx, fromHex) || sandOrRain(ctx, toHex)) return fail('bad weather');
  from.used = Math.max(0, from.used - 1); to.used += 1; sq.facility = to.id;
  ctx.log(sq.side, `${sq.name} transfers from ${from.name} to ${to.name}.`);
}

export function resolveAir(g, orders, ctx) {
  const air = g.air;
  ctx.air = air;
  const say = (text) => ctx.log('all', text);
  // 1. Deploy flights.
  const flights = []; // { sq, side, kind, hex, planes:[{sq,p,side}] }
  const grounded = [];
  const standby = [];
  for (const side of ['axis', 'cw']) {
    for (const m of orders[side]?.missions || []) {
      const sq = air.squadrons.find((s) => s.id === m.sq);
      if (!sq) continue;
      if (m.kind === 'transfer') { transferSquadron(air, sq, m.to, ctx); continue; }
      if (m.kind === 'scramble') { standby.push(sq); continue; }
      const target = hexFromName(m.hex);
      const fl = eligiblePlanes(sq, m.kind, target, ctx);
      if (!fl) {
        const fac0 = air.facilities.find((f) => f.id === sq.facility);
        grounded.push({ side, name: sq.name, kind: m.kind, from: fac0 && facilityHex(fac0), to: target, sent: 0, lost: 0, failed: true, result: 'could not take off: no ready, fuelled planes in range, bad weather, or enemy troops beside the base' });
        ctx.log(side, `${sq.name} could not fly its mission (no ready, fuelled planes in range, bad weather, or enemy troops beside the base).`); continue;
      }
      const bonus = isBombMission(m.kind) ? (fl.planes.length >= 18 ? 2 : fl.planes.length >= 6 ? 1 : 0) : 0; // bomber formation bonus [45.7]
      flights.push({ sq, side, kind: m.kind, hex: target, from: fl.base, planes: fl.planes.map((p) => ({ sq, p, side, bonus })) });
    }
  }
  // 2. Scramble: a standby squadron sees the nearest incoming enemy flight within 15 hexes and rolls to meet it [40.3].
  for (const sq of standby) {
    const fac = air.facilities.find((f) => f.id === sq.facility);
    const base = fac && facilityHex(fac);
    if (!base || baseBlocked(sq, base, ctx)) continue;
    const incoming = flights.filter((f) => f.side !== sq.side && f.kind !== 'capD')
      .map((f) => ({ f, d: distance(base, f.hex) })).filter((x) => x.d <= 15).sort((a, b) => a.d - b.d)[0];
    if (!incoming) continue;
    const need = scrambleNumber(incoming.d);
    const roll = ctx.d6();
    if (roll > need) { ctx.log(sq.side, `${sq.name} scrambled too late (rolled ${roll}, needed ${need} or less).`); continue; }
    const fl = eligiblePlanes(sq, 'capD', incoming.f.hex, ctx);
    if (!fl) continue;
    ctx.log(sq.side, `${sq.name} scrambles to ${hexName(incoming.f.hex)} (rolled ${roll}, needed ${need} or less).`);
    flights.push({ sq, side: sq.side, kind: 'capD', scrambled: true, hex: incoming.f.hex, from: fl.base, planes: fl.planes.map((p) => ({ sq, p, side: sq.side })) });
  }
  const flown = new Set(flights.flatMap((f) => f.planes.map((e) => e.p)));
  // 3. Air-to-air combat, hex by hex [45].
  const down = new Set();
  const abortedSet = new Set();
  const fighting = (hexKey, side) => flights.filter((f) => key(...f.hex) === hexKey && f.side === side && f.kind !== 'strafe' && !isBombMission(f.kind)).flatMap((f) => f.planes).filter((e) => !down.has(e.p));
  const raiders = (hexKey, side) => flights.filter((f) => key(...f.hex) === hexKey && f.side === side && (f.kind === 'strafe' || isBombMission(f.kind))).flatMap((f) => f.planes).filter((e) => !down.has(e.p) && !abortedSet.has(e.p));
  const strafers = (hexKey, side) => flights.filter((f) => key(...f.hex) === hexKey && f.side === side && f.kind === 'strafe').flatMap((f) => f.planes).filter((e) => !down.has(e.p) && !abortedSet.has(e.p));
  const hexes = [...new Set(flights.map((f) => key(...f.hex)))];
  const fight = (att, def, what) => {
    const res = duel(att, def, ctx);
    if (!res) { say(`Air combat over ${what}: ${att.p.type} (${sideName(att.side)}) and ${def.p.type} (${sideName(def.side)}) break off without a kill.`); return false; }
    down.add(res.down.p);
    const fate = recover(res.down, ctx);
    say(`Air combat over ${what}: ${res.by.p.type} (${sideName(res.by.side)}) shoots down a ${res.down.p.type} (${sideName(res.down.side)}) (d66 ${res.roll}, needed ${res.n} or less): ${fate}.`);
    return true;
  };
  for (const hk of hexes) {
    const [c, r] = hk.split(',').map(Number);
    const where = hexName([c, r]);
    const axisF = fighting(hk, 'axis'), cwF = fighting(hk, 'cw');
    // Wave 1: the side with more fighters attacks; every defender is covered, extras go to the weakest defender.
    if (axisF.length && cwF.length) {
      let atkSide = axisF.length === cwF.length ? ctx.holder : axisF.length > cwF.length ? 'axis' : 'cw';
      const atk = atkSide === 'axis' ? axisF : cwF, def = atkSide === 'axis' ? cwF : axisF;
      say(`Air combat over ${where}: ${atk.length} ${sideName(atkSide)} fighters attack ${def.length} ${sideName(other(atkSide))}.`);
      const weakest = [...def].sort((x, y) => eff(x.p) - eff(y.p))[0];
      atk.forEach((a, i) => {
        if (down.has(a.p)) return;
        let d = i < def.length ? def[i] : weakest;
        if (down.has(d.p)) d = def.find((x) => !down.has(x.p));
        if (d) fight(a, d, where);
      });
    }
    // Wave 2: fighters left over attack strafers and bombers that have no fighter cover of their own.
    for (const side of ['axis', 'cw']) {
      const sts = raiders(hk, side);
      if (!sts.length || fighting(hk, side).length) continue;
      const hunters = fighting(hk, other(side));
      hunters.forEach((h, i) => {
        const live = sts.filter((s) => !down.has(s.p));
        if (!live.length || down.has(h.p)) return;
        fight(h, live[i % live.length], where);
      });
    }
  }
  // 3b. Anti-aircraft fire, after air-to-air combat and before the missions are flown [46.23].
  const aborted = abortedSet;
  const gone = (p) => down.has(p) || aborted.has(p);
  const aaPoints = (enemy, hex, strafing) => {
    let total = enemy === 'cw' ? (ctx.fleetAA?.(hex) || 0) : 0; // ships always fire as anti-aircraft guns [30.38]
    for (const u of ctx.units.filter((x) => x.side === enemy && x.str > 0 && x.pos[0] === hex[0] && x.pos[1] === hex[1])) {
      const els = u.elements.filter((e) => e.toe > 0 && ctx.weapons[e.w]?.aa > 0 && (strafing || ctx.weapons[e.w].kind === 'aa')); // infantry, recce and tanks only fire at strafers [46.16, 46.22]
      if (!els.length) continue;
      if (els.some((e) => ctx.weapons[e.w].kind === 'aa') && !ctx.drawAmmo(u, 1)) { // gun-class AA needs 1 Ammo per target group [47.21]
        for (let i = els.length - 1; i >= 0; i--) if (ctx.weapons[els[i].w].kind === 'aa') els.splice(i, 1);
      }
      total += els.reduce((n, e) => n + e.toe * ctx.weapons[e.w].aa, 0);
    }
    return total;
  };
  const flakFire = (side, hex, planes, label, { table, strafing, shift = 0, withAbort }) => {
    const live = planes.filter((e) => !gone(e.p));
    if (!live.length) return;
    const pts = aaPoints(other(side), hex, strafing);
    if (pts <= 0) return;
    const col = Math.min(9, flakColumn(pts) + shift);
    const killN = aaResult(table, col, rollD66(ctx));
    const where = hexName(hex);
    let hit = [];
    for (let i = 0; i < killN && live.length; i++) {
      const pool = live.filter((e) => !down.has(e.p));
      if (!pool.length) break;
      const e = pool[(ctx.d6() - 1) % pool.length];
      down.add(e.p);
      hit.push(`${e.p.type}: ${recover(e, ctx)}`);
    }
    let ab = 0;
    if (withAbort) {
      const n = aaResult(AA_ABORTED, col, rollD66(ctx));
      for (let i = 0; i < n; i++) {
        const pool = live.filter((e) => !gone(e.p));
        if (!pool.length) break;
        aborted.add(pool[(ctx.d6() - 1) % pool.length].p); ab++;
      }
    }
    say(`Flak over ${where} (${pts} flak points) at ${sideName(side)} ${label}: ${killN ? `${killN} plane${killN > 1 ? 's' : ''} shot down` : 'no planes shot down'}${ab ? `, ${ab} turned back` : ''}${hit.length ? ` (${hit.join('; ')})` : ''}.`);
  };
  for (const hk of hexes) {
    const hex = parseKey(hk);
    for (const side of ['axis', 'cw']) {
      const mine = flights.filter((f) => key(...f.hex) === hk && f.side === side);
      if (!mine.length) continue;
      const bombers = mine.filter((f) => isBombMission(f.kind));
      const shift = flakShift(bombers.reduce((n, f) => n + f.planes.length, 0));
      for (const f of bombers) flakFire(side, hex, f.planes, `bombers (${f.sq.name})`, { table: AA_DESTROYED, shift, withAbort: true });
      const cap = mine.filter((f) => f.kind === 'capO' || f.kind === 'capD').flatMap((f) => f.planes);
      if (cap.length) flakFire(side, hex, cap, 'patrol fighters', { table: AA_FIGHTER, strafing: false });
      const straf = mine.filter((f) => f.kind === 'strafe').flatMap((f) => f.planes);
      if (straf.length) flakFire(side, hex, straf, 'strafing fighters', { table: AA_FIGHTER, strafing: true });
    }
  }
  // 4. Strafing by the survivors [40.5].
  for (const hk of hexes) {
    const [c, r] = hk.split(',').map(Number);
    for (const side of ['axis', 'cw']) {
      const sts = strafers(hk, side);
      if (!sts.length) continue;
      const hex = [c, r];
      const where = hexName(hex);
      if (ctx.map.tiles[hk]?.t === 'majorcity') { say(`${sideName(side)} strafers over ${where}: no strafing in a major city.`); continue; }
      const tac = sts.reduce((s, e) => s + (e.p.armed ? planeInfo(e.p).tac : 0), 0);
      const targets = ctx.units.filter((u) => u.side !== side && u.str > 0 && u.pos[0] === c && u.pos[1] === r);
      const withInf = targets.filter((u) => u.elements.some((e) => e.toe > 0 && e.w && ctx.weapons[e.w]?.class === 'infantry'));
      if (!targets.length && !ctx.supplyAt(hex, other(side))) { say(`${sideName(side)} strafers over ${where} find nothing there.`); continue; }
      let col = strafeColumn(tac);
      if (col >= 0 && (ctx.supplyAt(hex, other(side)) || targets.some((u) => u.type === 'truck'))) col += 1; // trucks and supply dumps are softer targets
      const roll = rollD66(ctx);
      let killed = strafeResult(col, roll);
      let done = 0;
      while (killed > 0 && withInf.length) {
        const u = withInf[(ctx.d6() - 1) % withInf.length];
        const e = u.elements.find((x) => x.toe > 0 && ctx.weapons[x.w]?.class === 'infantry');
        if (!e) { withInf.splice(withInf.indexOf(u), 1); continue; }
        e.toe -= 1; done++; killed--; syncStr(u);
        if (!u.elements.some((x) => x.toe > 0 && ctx.weapons[x.w]?.class === 'infantry')) withInf.splice(withInf.indexOf(u), 1);
      }
      const sres = done ? `${done} TOE point${done > 1 ? 's' : ''} of infantry eliminated` : 'no effect';
      for (const f of flights.filter((x) => x.kind === 'strafe' && x.side === side && key(...x.hex) === hk)) f.result = sres;
      say(`${sideName(side)} strafing of ${where} (${tac} TacAir, d66 ${roll}): ${sres}.`);
    }
  }
  // 4b. Bombing by the surviving bombers [41.2-41.3]. Flak is not in the game yet.
  for (const f of flights.filter((x) => isBombMission(x.kind))) {
    const live = f.planes.filter((e) => !down.has(e.p) && !aborted.has(e.p));
    if (!live.length) { say(`${sideName(f.side)} bombers over ${hexName(f.hex)} are shot down or turned back by flak before they can bomb.`); continue; }
    const tons = live.reduce((n, e) => n + planeInfo(e.p).bomb, 0);
    bombTarget(f, tons, live.length, ctx, (t) => { f.result = t.replace(/^.*?\): /, '').replace(/^.*? over \w+ /, ''); say(t); });
  }
  // Record what happened so the map can show it.
  g.lastAir = {
    turn: ctx.turn, stage: ctx.opStage, n: (g.lastAir?.n || 0) + 1,
    flights: [
      ...flights.map((f) => ({
        side: f.side, name: f.sq.name, kind: f.kind, scrambled: !!f.scrambled, from: f.from, to: f.hex,
        sent: f.planes.length, lost: f.planes.filter((e) => down.has(e.p)).length, aborted: f.planes.filter((e) => aborted.has(e.p) && !down.has(e.p)).length, result: f.result || '',
      })),
      ...grounded,
    ],
  };
  // 5. Planes that flew need refitting, fuelling and arming again [38].
  for (const p of flown) { p.ready = false; p.fueled = false; p.armed = false; }
  // 6. Tactical Maintenance for both sides.
  tacticalMaintenance(air, ctx);
}
