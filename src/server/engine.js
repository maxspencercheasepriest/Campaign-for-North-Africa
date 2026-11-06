// Authoritative game rules. Runs only on the host. Clients send orders; the engine validates and resolves.
// Rules here are a working PROTOTYPE of the systems (air, convoys, rear-area trucking, movement,
// combat, stores expenditure). They get replaced stage by stage as the real rules are transcribed.

import { key, parseKey, distance, neighbours } from '../shared/hex.js';
import {
  SIDES, ROLES, STAGES, PORTS, TERRAIN, ROAD_COST, MAP_COLS, MAP_ROWS,
  buildMap, initialUnits, initialDumps, initialPortOwners, REINFORCEMENTS,
  AIR_POINTS, TRUCK_CAPACITY, CONVOY, FUEL_EVAPORATION, SUPPLY_RANGE, VISION_RANGE,
} from '../shared/scenario.js';

const RES = ['fuel', 'water', 'ammo', 'stores'];
const other = (side) => (side === 'axis' ? 'cw' : 'axis');

export function createGame(options = {}) {
  return {
    version: 1,
    turn: 1,
    stageIndex: 0,
    options: { pastaRule: true, ...options },
    units: initialUnits(),
    dumps: initialDumps(),
    portOwners: initialPortOwners(),
    air: { axis: null, cw: null },
    pending: { axis: null, cw: null },
    ready: { axis: false, cw: false },
    log: [], // { turn, side: 'axis'|'cw'|'all', text }
    winner: null,
    seed: Date.now() >>> 0,
  };
}

let tilesCache = null;
export const tiles = () => (tilesCache ||= buildMap());

export const currentStage = (g) => STAGES[g.stageIndex];

function rng(g) {
  // xorshift on the saved seed so a reloaded game continues deterministically.
  let x = g.seed || 1;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  g.seed = x >>> 0;
  return g.seed / 4294967296;
}
const d6 = (g) => 1 + Math.floor(rng(g) * 6);

function log(g, side, text) {
  g.log.push({ turn: g.turn, side, text });
  if (g.log.length > 500) g.log.splice(0, g.log.length - 500);
}

// ---------- Orders ----------

// Returns an error string, or null if accepted.
export function submitOrders(g, side, orders) {
  if (g.winner) return 'The game is over.';
  const stage = currentStage(g);
  const err = validate(g, side, stage.id, orders || {});
  if (err) return err;
  g.pending[side] = orders || {};
  g.ready[side] = true;
  return null;
}

export function unready(g, side) {
  g.ready[side] = false;
}

function validate(g, side, stageId, o) {
  switch (stageId) {
    case 'air': {
      const vals = ['malta', 'escort', 'ground'].map((k) => o[k] ?? 0);
      if (vals.some((v) => !Number.isInteger(v) || v < 0)) return 'Air points must be whole numbers.';
      if (vals.reduce((a, b) => a + b, 0) > AIR_POINTS[side]) return `You only have ${AIR_POINTS[side]} air points.`;
      return null;
    }
    case 'convoy': {
      if (!o.port) return null; // no convoy this stage
      const p = PORTS.find((x) => x.id === o.port);
      if (!p) return 'Unknown port.';
      if (g.portOwners[p.id] !== side) return `${p.name} is not in your hands.`;
      return null;
    }
    case 'rear': {
      const transfers = o.transfers || [];
      let load = 0;
      for (const t of transfers) {
        const from = g.dumps[t.from];
        if (!from || from.side !== side) return 'Transfers must start at one of your dumps.';
        if (!RES.includes(t.res)) return 'Unknown resource.';
        if (!Number.isInteger(t.amount) || t.amount <= 0) return 'Amounts must be positive whole numbers.';
        if (from[t.res] < t.amount) return `Not enough ${t.res} at that dump.`;
        const to = t.to;
        const dest = g.dumps[to];
        const ownUnitThere = g.units.some((u) => u.side === side && key(...u.pos) === to);
        if (!(dest && dest.side === side) && !ownUnitThere) return 'Destination must be your dump or a hex your units hold.';
        load += t.amount * Math.max(1, Math.ceil(distance(parseKey(t.from), parseKey(to)) / 8));
      }
      if (load > TRUCK_CAPACITY[side]) return `Over truck capacity (${load}/${TRUCK_CAPACITY[side]}).`;
      return null;
    }
    case 'move': {
      for (const m of o.moves || []) {
        const u = g.units.find((x) => x.id === m.unitId && x.side === side);
        if (!u) return 'Unknown unit.';
        const err = pathError(g, u, m.path);
        if (err) return `${u.name}: ${err}`;
      }
      return null;
    }
    case 'combat': {
      for (const a of o.attacks || []) {
        const target = g.units.find((x) => x.id === a.targetId && x.side === other(side));
        if (!target) return 'Unknown target.';
        for (const id of a.attackerIds || []) {
          const u = g.units.find((x) => x.id === id && x.side === side);
          if (!u) return 'Unknown attacker.';
          if (distance(u.pos, target.pos) !== 1) return `${u.name} is not adjacent to ${target.name}.`;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

export function moveCost(c, r) {
  const t = tiles()[key(c, r)];
  if (!t) return Infinity;
  return t.road ? ROAD_COST : TERRAIN[t.t].cost;
}

export function pathError(g, u, path) {
  if (!Array.isArray(path) || path.length === 0) return 'empty path';
  let cur = u.pos;
  let mp = 0;
  for (const step of path) {
    if (!neighbours(...cur).some(([c, r]) => c === step[0] && r === step[1])) return 'path is not continuous';
    if (step[0] < 0 || step[1] < 0 || step[0] >= MAP_COLS || step[1] >= MAP_ROWS) return 'off the map';
    mp += moveCost(...step);
    cur = step;
  }
  if (mp > u.mp) return `needs ${mp} MP, has ${u.mp}`;
  if (u.type !== 'inf' && path.length > u.fuel) return `not enough fuel (${u.fuel})`;
  return null;
}

// ---------- Resolution ----------

export function bothReady(g) {
  return SIDES.every((s) => g.ready[s]);
}

export function resolveStage(g) {
  const stage = currentStage(g);
  const o = { axis: g.pending.axis || {}, cw: g.pending.cw || {} };
  ({ air: resolveAir, convoy: resolveConvoy, rear: resolveRear, move: resolveMove, combat: resolveCombat })[stage.id](g, o);
  g.pending = { axis: null, cw: null };
  g.ready = { axis: false, cw: false };
  g.stageIndex++;
  if (g.stageIndex >= STAGES.length) {
    endOfTurn(g);
    g.stageIndex = 0;
    g.turn++;
  }
}

function resolveAir(g, o) {
  for (const s of SIDES) {
    g.air[s] = { malta: o[s].malta || 0, escort: o[s].escort || 0, ground: o[s].ground || 0 };
    log(g, s, `Air: ${g.air[s].malta} on Malta missions, ${g.air[s].escort} on convoy escort, ${g.air[s].ground} on ground support.`);
  }
}

function resolveConvoy(g, o) {
  const a = g.air.axis || {}, c = g.air.cw || {};
  const lossPct = {
    // Axis convoys run past Malta. Allied Malta strength sinks ships; Axis raids on Malta and escorts protect them.
    axis: clamp(15 + 8 * (c.malta || 0) - 6 * (a.malta || 0) - 4 * (a.escort || 0), 0, 80),
    cw: clamp(10 + 2 * (a.escort || 0) - 3 * (c.escort || 0), 0, 50),
  };
  for (const s of SIDES) {
    const portId = o[s].port;
    if (!portId) continue;
    const p = PORTS.find((x) => x.id === portId);
    const k = key(p.col, p.row);
    const dump = (g.dumps[k] ||= { side: s, fuel: 0, water: 0, ammo: 0, stores: 0 });
    const landed = {};
    for (const r of RES) {
      landed[r] = Math.floor(CONVOY[s][r] * (1 - lossPct[s] / 100) * p.capacity);
      dump[r] += landed[r];
    }
    log(g, s, `Convoy to ${p.name}: ${lossPct[s]}% lost at sea; port landed ${fmt(landed)}.`);
  }
}

function resolveRear(g, o) {
  for (const s of SIDES) {
    for (const t of o[s].transfers || []) {
      const from = g.dumps[t.from];
      if (!from || from[t.res] < t.amount) continue; // dump captured or emptied since orders
      from[t.res] -= t.amount;
      const truckFuel = Math.ceil((t.amount * distance(parseKey(t.from), parseKey(t.to))) / 40);
      from.fuel = Math.max(0, from.fuel - truckFuel);
      const dest = (g.dumps[t.to] ||= { side: s, fuel: 0, water: 0, ammo: 0, stores: 0 });
      dest[t.res] += t.amount;
      log(g, s, `Trucks moved ${t.amount} ${t.res} (${truckFuel} fuel burned by the trucks).`);
    }
  }
}

function resolveMove(g, o) {
  // Simultaneous movement, one hex per pulse. A unit stops when it would enter an enemy-held hex,
  // or after entering a hex next to an enemy (zone of control).
  const plans = new Map();
  for (const s of SIDES) for (const m of o[s].moves || []) plans.set(m.unitId, [...m.path]);
  let moved = true;
  while (moved) {
    moved = false;
    for (const u of g.units) {
      const path = plans.get(u.id);
      if (!path || !path.length) continue;
      const next = path[0];
      const enemyThere = g.units.some((e) => e.side !== u.side && e.pos[0] === next[0] && e.pos[1] === next[1]);
      if (enemyThere) { plans.delete(u.id); continue; }
      path.shift();
      u.pos = next;
      if (u.type !== 'inf') u.fuel = Math.max(0, u.fuel - 1);
      moved = true;
      const inZoc = g.units.some((e) => e.side !== u.side && distance(e.pos, u.pos) === 1);
      if (inZoc) plans.delete(u.id);
    }
  }
  updateOwnership(g);
}

function resolveCombat(g, o) {
  const groundAir = { axis: g.air.axis?.ground || 0, cw: g.air.cw?.ground || 0 };
  for (const s of SIDES) {
    const attacks = o[s].attacks || [];
    const airEach = attacks.length ? groundAir[s] / attacks.length : 0;
    for (const a of attacks) {
      const target = g.units.find((x) => x.id === a.targetId);
      const attackers = (a.attackerIds || []).map((id) => g.units.find((x) => x.id === id)).filter((u) => u && u.str > 0 && distance(u.pos, target?.pos || [-99, -99]) === 1);
      if (!target || target.str <= 0 || !attackers.length) continue;
      const att = attackers.reduce((sum, u) => sum + effStr(u), 0) + airEach;
      const t = tiles()[key(...target.pos)];
      const def = effStr(target) * TERRAIN[t.t].defence;
      for (const u of attackers) u.ammo = Math.max(0, u.ammo - 1);
      target.ammo = Math.max(0, target.ammo - 1);
      const ratio = att / Math.max(0.5, def);
      const roll = d6(g) + (ratio >= 3 ? 2 : ratio >= 2 ? 1 : ratio < 1 ? -1 : 0);
      let result;
      if (roll <= 2) { hit(attackers[0], 1); result = 'attack repulsed, attacker loses a step'; }
      else if (roll <= 4) { hit(target, 1); hit(attackers[0], 1); result = 'both sides lose a step'; }
      else if (roll <= 6) { hit(target, 1); retreat(g, target); result = 'defender loses a step and falls back'; }
      else { hit(target, 2); retreat(g, target); result = 'defender routed'; }
      const names = attackers.map((u) => u.name).join(', ');
      log(g, 'all', `${names} attacked ${target.name} (${att.toFixed(1)} vs ${def.toFixed(1)}, roll ${roll}): ${result}.`);
    }
  }
  removeDestroyed(g);
  updateOwnership(g);
}

// Ammo-starved units fight at half strength.
const effStr = (u) => (u.ammo > 0 ? u.str : u.str / 2);
const hit = (u, n) => { u.str -= n; };

function retreat(g, u) {
  if (u.str <= 0) return;
  const options = neighbours(...u.pos).filter(([c, r]) =>
    moveCost(c, r) < Infinity &&
    !g.units.some((x) => x.pos[0] === c && x.pos[1] === r) &&
    !g.units.some((x) => x.side !== u.side && distance(x.pos, [c, r]) === 1));
  if (!options.length) { u.str -= 1; return; } // nowhere to go
  // Fall back towards home: Axis west, Commonwealth east.
  options.sort((A, B) => (u.side === 'axis' ? A[0] - B[0] : B[0] - A[0]));
  u.pos = options[0];
}

function removeDestroyed(g) {
  for (const u of g.units.filter((x) => x.str <= 0)) log(g, 'all', `${u.name} has been destroyed.`);
  g.units = g.units.filter((x) => x.str > 0);
}

function updateOwnership(g) {
  // Ports and dumps change hands when only the enemy holds the hex.
  for (const p of PORTS) {
    const here = g.units.filter((u) => u.pos[0] === p.col && u.pos[1] === p.row);
    if (here.length && here.every((u) => u.side !== g.portOwners[p.id])) {
      g.portOwners[p.id] = here[0].side;
      log(g, 'all', `${p.name} has been taken by the ${here[0].side === 'axis' ? 'Axis' : 'Commonwealth'}.`);
    }
  }
  for (const [k, d] of Object.entries(g.dumps)) {
    const here = g.units.filter((u) => key(...u.pos) === k);
    if (here.length && here.every((u) => u.side !== d.side)) {
      d.side = here[0].side;
      log(g, 'all', `A supply dump has been captured intact (${fmt(d)}).`);
    }
  }
}

function endOfTurn(g) {
  // Stores expenditure: draw from the nearest dump in range, then consume.
  for (const u of g.units) {
    const dumps = Object.entries(g.dumps)
      .filter(([k, d]) => d.side === u.side && distance(parseKey(k), u.pos) <= SUPPLY_RANGE)
      .sort(([a], [b]) => distance(parseKey(a), u.pos) - distance(parseKey(b), u.pos));
    const caps = { fuel: u.type === 'inf' ? 0 : 6, water: 3, ammo: 3 };
    for (const r of ['fuel', 'water', 'ammo']) {
      for (const [, d] of dumps) {
        const need = caps[r] - u[r];
        if (need <= 0) break;
        const take = Math.min(need, Math.floor(d[r]));
        d[r] -= take; u[r] += take;
      }
    }
    const waterNeed = 1 + (g.options.pastaRule && u.nation === 'it' ? 1 : 0); // Italian units boil water for pasta
    u.water -= waterNeed;
    if (u.water < 0) {
      u.water = 0; u.str -= 1;
      log(g, u.side, `${u.name} is out of water and loses a step.`);
    }
  }
  for (const d of Object.values(g.dumps)) {
    d.fuel = Math.floor(d.fuel * (1 - FUEL_EVAPORATION[d.side]));
    d.water = Math.floor(d.water * 0.98);
  }
  removeDestroyed(g);

  for (const r of REINFORCEMENTS.filter((x) => x.turn === g.turn + 1)) {
    const p = PORTS.find((x) => x.id === r.port);
    if (g.portOwners[p.id] !== r.unit.side) continue;
    const spot = [[p.col, p.row], ...neighbours(p.col, p.row)].find(([c, rr]) => moveCost(c, rr) < Infinity && !g.units.some((u) => u.pos[0] === c && u.pos[1] === rr));
    if (!spot) continue;
    g.units.push({ ...structuredClone(r.unit), pos: spot });
    log(g, r.unit.side, `Reinforcements: ${r.unit.name} arrives at ${p.name}.`);
  }

  if (g.portOwners.alexandria === 'axis') g.winner = 'axis';
  else if (g.portOwners.tripoli === 'cw') g.winner = 'cw';
  if (g.winner) log(g, 'all', `${g.winner === 'axis' ? 'The Axis' : 'The Commonwealth'} has won the campaign.`);
}

// ---------- Views (fog of war) ----------

export function viewFor(g, side) {
  const own = g.units.filter((u) => u.side === side);
  const seen = (pos) => own.some((u) => distance(u.pos, pos) <= VISION_RANGE);
  const enemy = g.units
    .filter((u) => u.side !== side && seen(u.pos))
    // Enemy counters show identity and rough strength only — not their supplies.
    .map(({ id, side: s, nation, name, type, str, pos }) => ({ id, side: s, nation, name, type, str, pos }));
  const dumps = {};
  for (const [k, d] of Object.entries(g.dumps)) {
    if (d.side === side) dumps[k] = d;
    else if (seen(parseKey(k))) dumps[k] = { side: d.side, spotted: true };
  }
  return {
    turn: g.turn,
    stageIndex: g.stageIndex,
    ready: g.ready,
    myOrders: g.pending[side],
    units: [...own, ...enemy],
    dumps,
    portOwners: g.portOwners,
    air: g.air[side],
    airPoints: AIR_POINTS[side],
    truckCapacity: TRUCK_CAPACITY[side],
    options: g.options,
    winner: g.winner,
    log: g.log.filter((l) => l.side === 'all' || l.side === side).slice(-80),
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (d) => RES.map((r) => `${r} ${Math.floor(d[r] ?? 0)}`).join(', ');

export { ROLES };
