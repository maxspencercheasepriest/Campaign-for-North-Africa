// Commonwealth Mediterranean Fleet (rule 30) and the Axis U-boat house rule.
import { SHIP_CLASSES, FLEET_RANGE, aaOf, heavy } from '../shared/fleet.js';
import { distance, key } from '../shared/hex.js';
import { hexFromName, nameOfHex } from '../shared/hexnames.js';
import { LOCATIONS } from '../shared/locations.js';

const ALEX = LOCATIONS.find((l) => l.id === 'alexandria').hexes[0];
export const shipAA = (s) => (s.sunk || s.gun <= 0 ? 0 : aaOf(s));
// A ship better than half its Gun Rating may leave port [30.36].
export const fit = (s) => s.gun * 2 > s.max;
export const available = (s) => s.joined && !s.sunk && (s.where === 'sea' || (s.where === 'alex' && s.rest === 0 && fit(s)));

const isSea = (map, h) => map.tiles[key(...h)]?.t === 'sea';
const coastal = (map, h) => map.tiles[key(...h)] && map.tiles[key(...h)].t !== 'sea' && neighbours(h).some((n) => isSea(map, n));
import { neighbours } from '../shared/hex.js';
const placeable = (map, h) => h && map.tiles[key(...h)] && (isSea(map, h) || coastal(map, h));

export function fleetArrivals(g) {
  const f = g.fleet; if (!f) return;
  const now = g.turn * 4 + g.opStage;
  for (const s of f.ships.filter((x) => !x.joined && x.turn * 4 + x.stage <= now)) { s.joined = true; if (g.log) g.log.push({ turn: g.turn, stage: g.opStage, side: 'cw', text: `${s.name} (${SHIP_CLASSES[s.cls].label}) joins the Mediterranean Fleet.` }); }
  for (const u of f.uboats.filter((x) => !x.joined && x.turn <= g.turn)) { u.joined = true; g.log.push({ turn: g.turn, stage: g.opStage, side: 'axis', text: `${u.name} reaches the Mediterranean.` }); }
}

// Does either side have anything to do in the Fleet Assignment Segment?
export const cwHasShips = (g) => !!g.fleet?.ships.some(available);
export const axisHasBoats = (g) => !!g.fleet?.uboats.some((u) => u.joined && !u.lost && u.rest === 0);

export function validateFleetOrders(g, side, o, map) {
  const f = g.fleet;
  if (side === 'cw') {
    const seen = new Set();
    for (const a of o.ships || []) {
      const s = f.ships.find((x) => x.id === a.id);
      if (!s || !available(s)) return 'That ship cannot go to sea: it is resting in port (two Operations Stages for each one at sea), too damaged (half its Gun Rating or less), or sunk [30.16, 30.36].';
      if (seen.has(s.id)) return `${s.name} is assigned twice.`;
      seen.add(s.id);
      if (s.where === 'sea' && s.seaStages >= 3) return `${s.name} has had three Operations Stages at sea and must return to port [30.16].`;
      const h = typeof a.hex === 'string' ? hexFromName(a.hex) : null;
      if (!placeable(map, h)) return `${s.name}: choose a sea hex or a coastal hex.`;
      if (distance(ALEX, h) > FLEET_RANGE) return `${s.name}: more than ${FLEET_RANGE} hexes from Alexandria [30.15].`;
    }
  } else {
    const seen = new Set();
    for (const a of o.uboats || []) {
      const u = f.uboats.find((x) => x.id === a.id);
      if (!u || !u.joined || u.lost || u.rest > 0) return 'That U-boat is not ready to sail.';
      if (seen.has(u.id)) return `${u.name} is assigned twice.`;
      seen.add(u.id);
      const h = typeof a.hex === 'string' ? hexFromName(a.hex) : null;
      if (!h || !isSea(map, h)) return `${u.name}: patrol a sea hex.`;
    }
  }
  return null;
}

const say = (g, side, text) => g.log.push({ turn: g.turn, stage: g.opStage, side, text });

export function resolveFleet(g, orders, ctx) {
  const f = g.fleet;
  // Commonwealth: ships assigned go to sea; ships at sea that are not reassigned go home [30.15, 30.16].
  const assigned = new Map((orders.cw?.ships || []).map((a) => [a.id, a]));
  for (const s of f.ships.filter((x) => !x.sunk && x.joined)) {
    const a = assigned.get(s.id);
    if (a) {
      s.hex = hexFromName(a.hex);
      s.seaStages = s.where === 'sea' ? s.seaStages + 1 : 1;
      s.where = 'sea'; s.spent = false; s.repair = 0;
    } else if (s.where === 'sea') {
      s.rest = 2 * s.seaStages; s.seaStages = 0; s.where = 'alex'; s.hex = null;
    }
  }
  if (assigned.size) say(g, 'cw', `Fleet at sea: ${[...assigned.keys()].map((id) => { const s = f.ships.find((x) => x.id === id); return `${s.name} (${nameOfHex(...s.hex)})`; }).join(', ')}.`);
  // Axis U-boats on patrol: they hunt ships within one hex of the patrol hex.
  for (const a of orders.axis?.uboats || []) {
    const u = f.uboats.find((x) => x.id === a.id);
    const h = hexFromName(a.hex);
    u.patrol = h;
    const near = f.ships.filter((s) => s.where === 'sea' && !s.sunk && s.hex && distance(s.hex, h) <= 1);
    const escorts = f.ships.filter((s) => s.where === 'sea' && !s.sunk && s.cls === 'DD' && s.hex && distance(s.hex, h) <= 2).length;
    if (!near.length) { say(g, 'axis', `${u.name} patrols ${a.hex} and finds nothing.`); u.rest = 2; continue; }
    const find = ctx.d6();
    if (find < 5) { say(g, 'axis', `${u.name} patrols ${a.hex} but loses the contact (${find}).`); u.rest = 2; continue; }
    const target = [...near].sort((x, y) => Number(heavy(y)) - Number(heavy(x)) || y.gun - x.gun)[0];
    const hit = ctx.d6();
    const damaged = hit >= 4;
    const dmg = heavy(target) ? 3 : 2;
    if (damaged) { target.gun = Math.max(0, target.gun - dmg); if (target.gun <= 0) { target.sunk = true; target.where = 'sunk'; target.hex = null; } }
    const text = damaged ? `${u.name} torpedoes ${target.name}: ${dmg} Gun Rating points lost${target.sunk ? ' and she sinks!' : ` (now ${target.gun}/${target.max}).`}` : `${u.name} fires at ${target.name} and misses.`;
    say(g, 'all', text);
    const survive = ctx.d6() > Math.min(escorts, 5);
    if (!survive) { u.lost = true; say(g, 'all', `${u.name} is sunk by the escorts.`); } else u.rest = 2;
  }
}

// End of an Operations Stage: ships that fired go home for two stages; ships in port rest and repair [30.25, 30.37].
export function fleetEndStage(g) {
  const f = g.fleet; if (!f) return;
  for (const s of f.ships.filter((x) => x.joined && !x.sunk)) {
    if (s.where === 'sea') {
      if (s.spent) { s.rest = 2; s.seaStages = 0; s.where = 'alex'; s.hex = null; }
      else if (s.seaStages >= 3) { s.rest = 6; s.seaStages = 0; s.where = 'alex'; s.hex = null; }
    } else {
      if (s.rest > 0) s.rest -= 1;
      if (s.gun < s.max) { s.repair += 1; if (s.repair >= 6) { s.gun += 1; s.repair = 0; } }
    }
  }
  for (const u of f.uboats) { if (u.rest > 0) u.rest -= 1; u.patrol = null; }
}

// Ships fire as ammunition-free artillery [30.22]. Light ships hit only the hex they are in; battleships and heavy
// cruisers also the adjacent hexes, and at two hexes with half strength [30.21, 30.22]. One firing per ship per stage [30.24].
export function navalFire(g, side, hexes) {
  if (side !== 'cw' || !g.fleet) return [];
  const out = [];
  for (const s of g.fleet.ships.filter((x) => x.where === 'sea' && !x.sunk && !x.spent && x.hex && x.gun > 0)) {
    let best = null;
    for (const h of hexes) {
      const d = distance(s.hex, h);
      const ok = d === 0 || (heavy(s) && d <= 2);
      if (!ok) continue;
      const half = d === 2;
      if (!best || (!half && best.half)) best = { half, h };
    }
    if (!best) continue;
    const pts = best.half ? Math.max(1, Math.floor(s.gun / 2)) : s.gun;
    out.push({ ship: s, name: s.name, gun: s.gun, pts, half: best.half, hexes: hexes.filter((h) => distance(s.hex, h) === distance(s.hex, best.h)) });
  }
  return out;
}

// Bombs on ships: Damage Points come off Gun Ratings [30.34]. Returns the points that landed.
export function damageShips(g, hex, points, d6) {
  const here = g.fleet?.ships.filter((s) => s.where === 'sea' && !s.sunk && s.hex && s.hex[0] === hex[0] && s.hex[1] === hex[1]) || [];
  let done = 0;
  const sunk = [];
  for (let i = 0; i < points && here.some((s) => s.gun > 0); i++) {
    const live = here.filter((s) => s.gun > 0);
    const s = live[(d6() - 1) % live.length];
    s.gun -= 1; done++;
    if (s.gun <= 0) { s.sunk = true; s.where = 'sunk'; s.hex = null; sunk.push(s.name); }
  }
  return { done, sunk, ships: here.length };
}
export const aaAt = (g, hex) => (g.fleet?.ships || []).filter((s) => s.where === 'sea' && !s.sunk && s.hex && s.hex[0] === hex[0] && s.hex[1] === hex[1]).reduce((n, s) => n + shipAA(s), 0);
