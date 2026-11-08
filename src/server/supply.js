// Abstract logistics [rule 32.0]: Supply Units hold Ammo and Fuel, units draw on them within half their CPA,
// Axis convoys bring units from the Tripoli box, the Commonwealth receives them through Cairo/Alexandria.
// Water and Stores are ignored in this mode [32.11]. Motorization Points are abstracted as the 30 that every
// real supply unit carries [32.32] (the loss chart 32.59 and dummy supply units are not in yet).

import { key, neighbours, distance, parseKey } from '../shared/hex.js';
import { stepCost, sectionOfRow } from '../shared/rules.js';
import { nameOfHex } from '../shared/hexnames.js';
import { WEAPONS } from '../shared/weapons.js';
import {
  AXIS_SUPPLY_TABLE, CW_SUPPLY_TABLE, AXIS_CONVOY_LEVEL, CONVOY_BOMB_ROWS, convoyBombColumn, CONVOY_LOSS,
} from '../shared/tables.js';
import { LOCATIONS, PORTS } from '../shared/scenario.js';

export const SUPPLY_MAX = { ammo: 40, fuel: 60 }; // [32.15]
export const SUPPLY_CPA = 15; // Motorization Points carrying a supply unit [32.58]
export const MAX_PER_CONVOY_LANE = 3; // [32.62]
const CITY_STACK = 5, OTHER_STACK = 3; // [32.14]

const cityHexes = new Set(LOCATIONS.filter((l) => l.city).flatMap((l) => l.hexes.map((h) => key(...h))));
export const supplyStackLimit = (map, hex) => (map.tiles[key(...hex)]?.t === 'majorcity' || cityHexes.has(key(...hex)) ? CITY_STACK : OTHER_STACK);

// 'Generous' starting stock: a second supply unit beside each original one, on the nearest land hex with room [32.17].
export function doubleStock(sup, map) {
  for (const s of [...sup.units]) {
    const ring = [s.pos, ...neighbours(...s.pos), ...neighbours(...s.pos).flatMap((h) => neighbours(...h))];
    const spot = ring.find((h) => map.tiles[key(...h)] && map.tiles[key(...h)].t !== 'sea' && supplyAt(sup, h, s.side).length < supplyStackLimit(map, h));
    if (spot) sup.units.push({ ...s, pos: spot });
  }
}

export function createSupply({ units, box }) {
  const g = { units: [], box, plan: [], convoys: [], nextId: 1 };
  for (const u of units) g.units.push({ id: `su${g.nextId++}`, side: u.side, pos: u.pos, ammo: u.ammo, fuel: u.fuel, mp: 30 });
  return g;
}

const supplyAt = (sup, hex, side) => sup.units.filter((s) => s.pos[0] === hex[0] && s.pos[1] === hex[1] && (!side || s.side === side));

// ---------- How much a unit needs [32.21, 32.23, 32.24] ----------
// Fuel: 2 per tank battalion-equivalent, 1 per other motorised battalion-equivalent, paid once per Operations Stage.
export function fuelNeed(u) {
  if (!u.motorised) return 0;
  let tanks = 0, other = 0;
  for (const e of u.elements || []) {
    const w = WEAPONS[e.w];
    if (!w || e.toe <= 0) continue;
    if (w.kind === 'tank') tanks += e.toe / w.bn; else other += e.toe / (w.bn || 6);
  }
  return 2 * Math.ceil(tanks - 1e-9) + (other > 0 ? Math.ceil(other - 1e-9) : 0) || (u.elements?.length ? 1 : 0);
}
// Ammo: a non-phasing battalion-equivalent pays 1 for an assault and 2 for a barrage; the phasing side pays double.
export function ammoCost(u, phasing, { barrage = true, probe = false } = {}) {
  if (probe) return phasing ? 2 : 1; // a probe uses one battalion-equivalent, no barrage [3.1 Probe; 32.21]
  let art = 0, rest = 0;
  for (const e of u.elements || []) {
    const w = WEAPONS[e.w];
    if (!w || e.toe <= 0) continue;
    if (w.class === 'gun' && w.bar > 0) art += e.toe / (w.bn || 6); else rest += e.toe / (w.bn || 6);
  }
  const bn = (x) => (x > 0 ? Math.max(1, Math.ceil(x - 1e-9)) : 0);
  return (bn(rest) + (barrage ? 2 * bn(art) : 0)) * (phasing ? 2 : 1);
}

// ---------- Reach: cheapest CP cost from a hex, travelling as a medium truck (or on foot) [32.16] ----------
// ctx = { map, weatherAt(hex), enemyHexes:Set, zocBlocked(side, hex) }
function costsFrom(ctx, side, from, budget, { motorised }) {
  const best = new Map([[key(...from), 0]]);
  const queue = [from];
  while (queue.length) {
    queue.sort((a, b) => best.get(key(...a)) - best.get(key(...b)));
    const cur = queue.shift();
    const cc = best.get(key(...cur));
    for (const n of neighbours(...cur)) {
      const k = key(...n);
      if (!ctx.map.tiles[k] || ctx.enemyHexes.has(k)) continue;
      const c = stepCost(ctx.map, cur, n, { motorised, weather: ctx.weatherAt(n) });
      if (!c) continue;
      const cost = cc + c.cp;
      if (cost > budget) continue;
      if (ctx.zocBlocked && ctx.zocBlocked(side, n)) continue; // not through enemy ZOCs the owner does not hold [32.16]
      if (!best.has(k) || best.get(k) > cost) { best.set(k, cost); queue.push(n); }
    }
  }
  return best;
}

export function suppliesInRange(sup, ctx, u) {
  const budget = u.cpa / 2;
  // Cheap pre-filter: no hex costs less than half a CP, so anything farther than 2x budget is out of reach.
  if (!sup.units.some((s) => s.side === u.side && distance(u.pos, s.pos) <= budget * 2)) return [];
  const reach = costsFrom(ctx, u.side, u.pos, budget, { motorised: u.motorised });
  return sup.units
    .filter((s) => s.side === u.side && reach.has(key(...s.pos)))
    .map((s) => ({ s, cost: reach.get(key(...s.pos)) }))
    .sort((a, b) => a.cost - b.cost || a.s.id.localeCompare(b.s.id))
    .map((x) => x.s);
}

// Plain-language reason a unit cannot draw what it needs [32.16, 32.2], or null if it is supplied.
export function supplyDiagnosis(sup, ctx, u, { needFuel, needAmmo, ammoNeed = 1 }) {
  const mine = sup.units.filter((s) => s.side === u.side);
  const what = [needFuel && 'fuel', needAmmo && 'ammunition'].filter(Boolean).join(' and ');
  if (!what) return null;
  if (!mine.length) return `No ${what} in reach: you have no supply units left in the field.`;
  const budget = u.cpa / 2;
  const hexName = (s) => nameOfHex(...s.pos);
  const near = suppliesInRange(sup, ctx, u);
  if (near.length) return `Not enough ${what}${needAmmo ? ` (an attack costs ${ammoNeed} Ammo)` : ''}: the supply unit${near.length > 1 ? 's' : ''} within ${budget} CP (${near.map(hexName).join(', ')}) ${near.length > 1 ? 'hold' : 'holds'} only ${Math.floor(near.reduce((a, x) => a + x.ammo, 0))} ammo and ${Math.floor(near.reduce((a, x) => a + x.fuel, 0))} fuel.`;
  const closeBy = mine.filter((s) => distance(u.pos, s.pos) <= budget * 2);
  if (closeBy.length) {
    const open = costsFrom({ ...ctx, zocBlocked: null, enemyHexes: new Set() }, u.side, u.pos, budget, { motorised: u.motorised });
    const cut = closeBy.find((s) => open.has(key(...s.pos)));
    if (cut) return `No ${what} in reach: the supply unit at ${hexName(cut)} is close enough but the route runs through enemy zones of control or hexes held by the enemy [32.16].`;
  }
  const best = mine.map((s) => ({ s, d: distance(u.pos, s.pos) })).sort((a, b) => a.d - b.d)[0];
  return `No ${what} in reach: the nearest supply unit is at ${hexName(best.s)}, ${best.d} hexes away; this unit can only draw from supply units within ${budget} CP (half its CPA). Move supply units forward in the Truck Convoy Phase.`;
}

export function available(sup, ctx, u, res) {
  return suppliesInRange(sup, ctx, u).reduce((a, s) => a + s[res], 0);
}

// Take `amount` of a resource from the nearest supply units; all or nothing.
export function draw(sup, ctx, u, res, amount) {
  if (amount <= 0) return true;
  const src = suppliesInRange(sup, ctx, u);
  if (src.reduce((a, s) => a + s[res], 0) < amount) return false;
  let need = amount;
  for (const s of src) { const t = Math.min(need, s[res]); s[res] -= t; need -= t; if (!need) break; }
  sup.units = sup.units.filter((s) => s.ammo > 0 || s.fuel > 0); // empty supply units are removed [32.15]
  return true;
}

// Fuel for a repair attempt: taken only from supply units in the same hex.
export function drawHere(sup, hex, side, res, amount) {
  const here = supplyAt(sup, hex, side);
  const got = Math.min(amount, here.reduce((a, s) => a + s[res], 0));
  let need = got;
  for (const s of here) { const t = Math.min(need, s[res]); s[res] -= t; need -= t; }
  sup.units = sup.units.filter((s) => s.ammo > 0 || s.fuel > 0);
  return got;
}

// ---------- Capture [32.13] ----------
export function captureAt(sup, hex, bySide) {
  const taken = supplyAt(sup, hex).filter((s) => s.side !== bySide);
  for (const s of taken) s.side = bySide;
  return taken.length;
}

// ---------- Hot weather [29.34] ----------
export function hotWeatherLoss(sup) {
  for (const s of sup.units) s.fuel = Math.floor(s.fuel * 0.95);
}

// ---------- Supply arrivals and planning [32.4] ----------
const monthOf = (gt) => { const m = 8 + Math.floor((gt + 1) / 4); return { year: 1940 + Math.floor(m / 12), month: m % 12 }; };
export function axisConvoyLevel(gt) {
  const { year, month } = monthOf(gt);
  const row = AXIS_CONVOY_LEVEL[year] || AXIS_CONVOY_LEVEL[1942];
  return row[month] || 'B';
}
export function cwSupplyPeriod(gt) {
  const { year, month } = monthOf(gt);
  if (year === 1940 || (year === 1941 && month <= 3)) return 0; // I: through April 1941
  if (year === 1941 || (year === 1942 && month <= 4)) return 1; // II: May 1941 - May 1942
  return 2;
}

// Plan this Game-Turn's future arrivals. Axis plans two turns ahead, Commonwealth four [32.43].
export function planArrivals(sup, roll, gt, { firstTurn }) {
  const add = (side, arrive, n) => { if (n > 0) sup.plan.push({ side, turn: arrive, n }); };
  // On the first turn the turns before the normal look-ahead have nothing planned yet, so plan them too.
  if (gt === firstTurn) {
    for (let d = 1; d <= 1; d++) add('axis', gt + d, AXIS_SUPPLY_TABLE[roll()][AXIS_LETTERS.indexOf(axisConvoyLevel(gt))]);
    for (let d = 1; d <= 3; d++) add('cw', gt + d, CW_SUPPLY_TABLE[roll()][cwSupplyPeriod(gt + d)]);
  }
  add('axis', gt + 2, AXIS_SUPPLY_TABLE[roll()][AXIS_LETTERS.indexOf(axisConvoyLevel(gt))]);
  add('cw', gt + 4, CW_SUPPLY_TABLE[roll()][cwSupplyPeriod(gt + 4)]);
}
const AXIS_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

// Bring this turn's arrivals in: Axis units go to the Tripoli box, Commonwealth units to Cairo/Alexandria [32.42].
export function receiveArrivals(sup, map, gt, log) {
  const due = sup.plan.filter((p) => p.turn === gt);
  sup.plan = sup.plan.filter((p) => p.turn !== gt);
  for (const p of due) {
    if (p.side === 'axis') {
      for (let i = 0; i < p.n; i++) sup.box.axis.push({ ammo: SUPPLY_MAX.ammo, fuel: SUPPLY_MAX.fuel });
      log('axis', `${p.n} supply unit${p.n > 1 ? 's' : ''} reach the Tripoli box.`);
    } else {
      const alex = p.n > 3 ? Math.floor(p.n / 3) : 0;
      const place = (loc, n) => {
        const hexes = LOCATIONS.find((l) => l.id === loc).hexes;
        let left = n;
        for (const h of hexes) {
          while (left > 0 && supplyAt(sup, h, 'cw').length < supplyStackLimit(map, h)) {
            sup.units.push({ id: `su${sup.nextId++}`, side: 'cw', pos: h, ammo: SUPPLY_MAX.ammo, fuel: SUPPLY_MAX.fuel, mp: 30 }); left--;
          }
        }
      };
      place('cairo', p.n - alex);
      if (alex) place('alexandria', alex);
      log('cw', `${p.n} supply unit${p.n > 1 ? 's' : ''} arrive in Egypt.`);
    }
  }
}

// ---------- Axis naval convoy [32.6] ----------
// order = { port, route (1-6), n }. rollD66() returns a two-dice sequential roll. Returns a log line or an error string.
export function qualifyingDivisionRow(units) {
  const rows = units.filter((u) => u.side === 'cw' && u.size === 'division' && u.str > 0).map((u) => u.pos[1]).sort((a, b) => a - b);
  return rows.length >= 2 ? rows[1] : null; // the westernmost division only counts if another is level with or west of it [32.66]
}
export function convoyBombPoints(units, route) {
  const wrow = qualifyingDivisionRow(units);
  if (wrow === null) return 0;
  let bombRow = -1;
  CONVOY_BOMB_ROWS.forEach((row, i) => { if (row[route - 1] !== null && wrow <= row[route - 1]) bombRow = i; });
  if (bombRow < 0) return 0;
  return [30, 60, 100, 140, 180, 230, 290, 355, 430, 500][bombRow]; // any value within that row's band
}
// An order is either one convoy ({port, route, n, stage}) or {convoys: [...]}; one convoy per lane per Game-Turn.
export const convoyList = (order) => (order?.convoys ? order.convoys : order?.n ? [order] : []);

// Axis supply units are assigned to lanes in the Naval Convoy Stage and arrive (or are bombed) in the Naval Convoy
// Arrival Phase of the Operations Stage the Axis names [32.62-32.63, 20.63]. Units leave the Tripoli box now.
export function scheduleConvoys(sup, { order, turn, log }) {
  for (const c of convoyList(order)) {
    const n = Math.min(c.n ?? 0, MAX_PER_CONVOY_LANE, sup.box.axis.length);
    if (!n) continue;
    const stage = [1, 2, 3].includes(c.stage) ? c.stage : 1;
    (sup.convoys ||= []).push({ turn, stage, port: c.port, route: c.route || 2, units: sup.box.axis.splice(0, n) });
    log('axis', `Convoy of ${n} supply unit${n > 1 ? 's' : ''} sails on lane ${c.route || 2} for ${PORTS.find((p) => p.id === c.port)?.name ?? c.port}, due in Operations Stage ${stage}.`);
  }
}

// Naval Convoy Arrival Phase of one Operations Stage: bomb and land the convoys due now.
export function landConvoys(sup, map, { units, turn, stage, rollD66, log, portOwners }) {
  const due = (sup.convoys || []).filter((c) => c.turn === turn && c.stage === stage);
  sup.convoys = (sup.convoys || []).filter((c) => !due.includes(c));
  for (const c of due) {
    const n = c.units.length;
    const port = PORTS.find((p) => p.id === c.port);
    if (!port || portOwners[port.id] !== 'axis') {
      sup.box.axis.push(...c.units);
      log('axis', `${port?.name ?? 'The port'} is no longer in your hands: the convoy turns back to Tripoli.`);
      continue;
    }
    const bombs = convoyBombPoints(units, c.route);
    let lost = 0, pct = 0;
    if (bombs > 0) {
      pct = CONVOY_LOSS[convoyBombColumn(bombs)][rollD66()] ?? 0;
      if (pct >= 20) lost = Math.min(n, Math.max(1, Math.floor((n * pct) / 100))); // [32.65 B]
    }
    const hex = [port.col, port.row];
    let landed = 0;
    for (const b of c.units.slice(0, n - lost)) {
      if (supplyAt(sup, hex, 'axis').length >= supplyStackLimit(map, hex)) { sup.box.axis.push(b); continue; }
      sup.units.push({ id: `su${sup.nextId++}`, side: 'axis', pos: hex, ammo: b.ammo, fuel: b.fuel, mp: 30 }); landed++;
    }
    log('axis', `Convoy on route ${c.route} to ${port.name}: ${bombs ? `bombed (${pct}% loss)` : 'not attacked'}; ${landed} supply unit${landed === 1 ? '' : 's'} landed${lost ? `, ${lost} lost at sea` : ''}.`);
  }
}

// ---------- Moving supply units in the Truck Convoy Phase [32.3] ----------
export function moveSupply(sup, ctx, side, moves, log) {
  for (const m of moves || []) {
    const s = sup.units.find((x) => x.id === m.id && x.side === side);
    if (!s) return 'Unknown supply unit.';
    if (s.moved) return 'A supply unit may only move once per Operations Stage.';
    if (s.mp < 30) return 'A supply unit needs 30 Motorization Points to move [32.32].';
    if (s.fuel < 1) return 'The motorization points need 1 Fuel Point to move [32.24].';
    const dest = parseKey(m.to);
    const reach = costsFrom(ctx, side, s.pos, SUPPLY_CPA, { motorised: true });
    if (!reach.has(m.to)) return 'That hex is out of reach for a supply unit (15 CP).';
    if (ctx.enemyHexes.has(m.to)) return 'Cannot enter an enemy-occupied hex.';
    if (supplyAt(sup, dest, side).length >= supplyStackLimit(ctx.map, dest)) return 'Too many supply units in that hex [32.14].';
    s.fuel -= 1; s.pos = dest; s.moved = true;
    log(side, `A supply unit moves to ${nameOfHex(...dest)}.`);
  }
  return null;
}
// Hexes a supply unit may be moved to this phase (hex key -> CP cost), excluding enemy-held and full hexes.
export function supplyReach(sup, ctx, side, pos) {
  const out = {};
  for (const [k, cost] of costsFrom(ctx, side, pos, SUPPLY_CPA, { motorised: true })) {
    if (ctx.enemyHexes.has(k) || supplyAt(sup, parseKey(k), side).length >= supplyStackLimit(ctx.map, parseKey(k))) continue;
    out[k] = cost;
  }
  return out;
}
export const resetMoved = (sup) => { for (const s of sup.units) s.moved = false; };

export { sectionOfRow, supplyAt, costsFrom };
