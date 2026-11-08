// The Air Game, stage 2: the Land Support Air Phase. Fighter missions only (bombing and flak come later).
// Rules used: air supply and Tactical Maintenance [38], flight limits [37.22, 39.11], scramble [40.3], CAP and
// strafing missions [40], air-to-air combat [45] and pilot recovery [34.8, 45].
import { AIRCRAFT, SQUADRON_CAPACITY, FACILITY_CAPACITY, facilityHex } from '../shared/air.js';
import { distance, key } from '../shared/hex.js';
import { hexFromName, nameOfHex } from '../shared/hexnames.js';
import { syncStr } from './combat.js';

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
export function bombResult(table, col, roll) {
  if (col < 0) return 0;
  let best = table[0].result;
  for (const row of table) { const c = row.cols[col]; if (c && roll >= c[0] && roll <= c[1]) best = row.result; }
  return best;
}

// ---------- Air supply and maintenance ----------
export const planeInfo = (p) => AIRCRAFT[p.type];
export const flightReady = (p) => p.ready && p.fueled;

// Fuel the refitted planes (each uses its fuel rate), then arm them (1 Ammo per squadron) [38.3, 38.5].
export function fuelAndArm(air, side) {
  const st = air.stock[side];
  for (const sq of air.squadrons.filter((s) => s.side === side)) {
    for (const p of sq.planes) {
      if (!p.ready || p.fueled) continue;
      const need = planeInfo(p).fuel || 0;
      if (st.fuel < need) continue;
      st.fuel -= need;
      p.fueled = true;
    }
    const unarmed = sq.planes.filter((p) => p.ready && p.fueled && !p.armed);
    if (unarmed.length && st.ammo >= 1) { st.ammo -= 1; for (const p of unarmed) p.armed = true; }
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
export const MISSION_KINDS = { capO: 'Offensive patrol', capD: 'Defensive patrol', strafe: 'Strafing', scramble: 'Scramble (stand by)', bCU: 'Bomb troops', bSD: 'Bomb a supply dump', bAF: 'Bomb an air facility' };
const BOMB_KINDS = ['bCU', 'bSD', 'bAF'];
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

export function validateAirOrders(g, side, o, map) {
  if (o.missions != null && !Array.isArray(o.missions)) return 'Missions must be a list.';
  const used = new Set();
  for (const m of o.missions || []) {
    const sq = g.air.squadrons.find((s) => s.id === m.sq);
    if (!sq || sq.side !== side) return 'Choose one of your own squadrons.';
    if (used.has(sq.id)) return `${sq.name} has two missions: one per squadron.`;
    used.add(sq.id);
    if (!MISSION_KINDS[m.kind]) return 'Unknown mission.';
    if (sq.kind === 'fighter' && isBombMission(m.kind)) return `${sq.name} is a fighter squadron; it cannot fly bombing missions.`;
    if (sq.kind === 'bomber' && !isBombMission(m.kind)) return `${sq.name} is a bomber squadron; give it a bombing mission.`;
    if (sq.kind !== 'fighter' && sq.kind !== 'bomber') return `${sq.name}: only fighter and bomber missions are in the game so far.`;
    if (m.kind === 'scramble') continue;
    const hex = typeof m.hex === 'string' ? hexFromName(m.hex) : null;
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


// Apply one bombing mission's result to its target hex.
function bombTarget(f, tons, n, ctx, say) {
  const side = f.side, hex = f.hex, enemy = other(side);
  const where = hexName(hex);
  const tag = `${sideName(side)} bombers (${n} planes, ${tons} tons) over ${where}`;
  const col = bombColumn(tons);
  if (!n) return;
  const roll = rollD66(ctx);
  if (f.kind === 'bCU') {
    if (ctx.map.tiles[key(...hex)]?.t === 'majorcity') { say(`${tag}: units in a major city cannot be bombed.`); return; }
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
    say(`${tag} (d66 ${roll}): ${pct}% of the supplies in the dump destroyed.`);
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
  const fighting = (hexKey, side) => flights.filter((f) => key(...f.hex) === hexKey && f.side === side && f.kind !== 'strafe' && !isBombMission(f.kind)).flatMap((f) => f.planes).filter((e) => !down.has(e.p));
  const raiders = (hexKey, side) => flights.filter((f) => key(...f.hex) === hexKey && f.side === side && (f.kind === 'strafe' || isBombMission(f.kind))).flatMap((f) => f.planes).filter((e) => !down.has(e.p));
  const strafers = (hexKey, side) => flights.filter((f) => key(...f.hex) === hexKey && f.side === side && f.kind === 'strafe').flatMap((f) => f.planes).filter((e) => !down.has(e.p));
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
    const live = f.planes.filter((e) => !down.has(e.p));
    const tons = live.reduce((n, e) => n + planeInfo(e.p).bomb, 0);
    bombTarget(f, tons, live.length, ctx, (t) => { f.result = t.replace(/^.*?\): /, '').replace(/^.*? over \w+ /, ''); say(t); });
  }
  // Record what happened so the map can show it.
  g.lastAir = {
    turn: ctx.turn, stage: ctx.opStage, n: (g.lastAir?.n || 0) + 1,
    flights: [
      ...flights.map((f) => ({
        side: f.side, name: f.sq.name, kind: f.kind, scrambled: !!f.scrambled, from: f.from, to: f.hex,
        sent: f.planes.length, lost: f.planes.filter((e) => down.has(e.p)).length, result: f.result || '',
      })),
      ...grounded,
    ],
  };
  // 5. Planes that flew need refitting, fuelling and arming again [38].
  for (const p of flown) { p.ready = false; p.fueled = false; p.armed = false; }
  // 6. Tactical Maintenance for both sides.
  tacticalMaintenance(air, ctx);
}
