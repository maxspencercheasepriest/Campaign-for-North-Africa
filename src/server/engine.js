// Authoritative game rules. Runs only on the host; clients send orders/actions and receive filtered views.
//
// IMPLEMENTED FROM THE RULES (see docs/RULES-STATUS.md for the full checklist):
//   5.0  Game-Turn sequence: Initiative Stage -> Naval Convoy Stage -> three Operations Stages, each with
//        Player A then Player B taking their phases.
//   6.0  Capability Points and Cohesion (DP for overspending, RP for rest and victories, collapse at -26).
//   7.0  Initiative (die + rating by date / Rommel / German presence; holder picks first or last each stage).
//   8.1-8.4, 8.2  Land movement with the Terrain Effects Chart, roads/tracks/hexsides, continual movement.
//   8.6  Breaking off from contact.
//   9.0  Stacking points and terrain stacking limits.
//   10.0 Zones of control (who exerts them, where they reach, stop-on-entry, no ZOC-to-ZOC, mandatory attack).
// STILL PLACEHOLDER: combat resolution (11-15), supply/air/convoys (32 / 33-58), weather (29), and more.

import { key, parseKey, distance, neighbours } from '../shared/hex.js';
import {
  SIDES, PORTS, MAP_COLS, MAP_ROWS, SCENARIO,
  buildMap, initialUnits, initialDumps, initialPortOwners, REINFORCEMENTS,
  AIR_POINTS, TRUCK_CAPACITY, CONVOY, FUEL_EVAPORATION, SUPPLY_RANGE, VISION_RANGE,
} from '../shared/scenario.js';
import {
  turnDate, initiativeRating, CP, NON_MOTORISED_VOLUNTARY_LIMIT, COHESION_MAX, COHESION_COLLAPSE,
  REST_RP, VICTORY_RP, HEAVY_LOSS_DP, CONTINUAL_MOVE_RANGE, STACKING_POINTS, TERRAIN, HEXSIDES,
  stepCost, stackingLimit, edgeKey, OPS_STAGES_PER_TURN,
} from '../shared/rules.js';

const RES = ['fuel', 'water', 'ammo', 'stores'];
const other = (side) => (side === 'axis' ? 'cw' : 'axis');

// Steps of the sequence of play, in order. kind:
//   simultaneous - both sides submit orders, resolves when both are in
//   holder       - only the Initiative holder decides
//   phasing      - only the current phasing player (Player A, then Player B) acts
export const STEPS = {
  air: { name: 'Air Allocation', role: 'air', kind: 'simultaneous', placeholder: true },
  convoy: { name: 'Naval Convoy Stage', role: 'logistics', kind: 'simultaneous', placeholder: true },
  declare: { name: 'Initiative Declaration', role: 'cic', kind: 'holder' },
  movecombat: { name: 'Movement & Combat Phase', role: 'front', kind: 'phasing' },
  trucks: { name: 'Truck Convoy Movement Phase', role: 'rear', kind: 'phasing', placeholder: true },
};

let mapCache = null;
export const gameMap = () => (mapCache ||= buildMap());

export function createGame(options = {}) {
  const g = {
    version: 2,
    scenario: SCENARIO.id,
    turn: SCENARIO.firstTurn,
    opStage: 0,
    step: null,
    half: null,
    order: null, // { A: side, B: side } for the current Operations Stage
    initiative: null,
    seg: null,
    options: { pastaRule: true, ...options },
    units: initialUnits(),
    dumps: initialDumps(),
    portOwners: initialPortOwners(),
    air: { axis: null, cw: null },
    pending: { axis: null, cw: null },
    ready: { axis: false, cw: false },
    log: [],
    winner: null,
    over: false,
    seed: (Date.now() ^ 0x9e3779b9) >>> 0,
  };
  startGameTurn(g);
  return g;
}

// ---------- Randomness ----------
function rng(g) {
  let x = g.seed || 1;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  g.seed = x >>> 0;
  return g.seed / 4294967296;
}
const d6 = (g) => 1 + Math.floor(rng(g) * 6);

function log(g, side, text) {
  g.log.push({ turn: g.turn, stage: g.opStage, side, text });
  if (g.log.length > 600) g.log.splice(0, g.log.length - 600);
}

// ---------- Sequence of play ----------

export const currentStep = (g) => STEPS[g.step];
export const phasingSide = (g) => (g.order && g.half ? g.order[g.half] : null);

// Which sides must act in the current step.
export function actingSides(g) {
  if (g.over) return [];
  const st = currentStep(g);
  if (st.kind === 'simultaneous') return SIDES.filter((s) => !g.ready[s]);
  if (st.kind === 'holder') return [g.initiative.holder];
  return [phasingSide(g)];
}

function startGameTurn(g) {
  // I. Initiative Determination Stage [7.14]
  const onMap = (pred) => g.units.some(pred);
  const ctx = {
    gt: g.turn,
    rommelOnMap: onMap((u) => u.rommel),
    germanCombatOnMap: onMap((u) => u.nation === 'de' && u.type !== 'hq'),
  };
  const ratings = { axis: initiativeRating('axis', ctx), cw: initiativeRating('cw', ctx) };
  let holder, rolls = null;
  if (g.turn === SCENARIO.firstTurn && SCENARIO.initiativeFirstTurn) {
    holder = SCENARIO.initiativeFirstTurn;
  } else {
    let a, c;
    do { a = d6(g) + ratings.axis; c = d6(g) + ratings.cw; } while (a === c); // ties re-roll
    rolls = { axis: a, cw: c };
    holder = a > c ? 'axis' : 'cw';
  }
  g.initiative = { holder, ratings, rolls };
  log(g, 'all', `Game-Turn ${g.turn} (${turnDate(g.turn)}): ${holder === 'axis' ? 'the Axis' : 'the Commonwealth'} holds the Initiative${rolls ? ` (Axis ${rolls.axis} vs Commonwealth ${rolls.cw})` : ' (scenario rule)'}.`);
  // II. Naval Convoy Stage (abstracted for now)
  g.opStage = 0;
  g.order = null;
  g.half = null;
  setStep(g, 'air');
}

function setStep(g, step) {
  g.step = step;
  g.pending = { axis: null, cw: null };
  g.ready = { axis: false, cw: false };
  if (step === 'movecombat') g.seg = { n: 1, mode: 'move', moved: [], attacked: [], frozen: [] };
}

function startOpStage(g, n) {
  g.opStage = n;
  for (const u of g.units) u.cpUsed = 0;
  setStep(g, 'declare');
}

function beginHalf(g, half) {
  g.half = half;
  setStep(g, 'movecombat');
  // Units starting the phase in an enemy ZOC are in Contact [8.62].
  for (const u of g.units) u.contact = u.side === phasingSide(g) && inEnemyZoc(g, u, u.pos);
}

function advance(g) {
  switch (g.step) {
    case 'air': setStep(g, 'convoy'); break;
    case 'convoy': startOpStage(g, 1); break;
    case 'declare': beginHalf(g, 'A'); break;
    case 'movecombat': setStep(g, 'trucks'); break;
    case 'trucks':
      if (g.half === 'A') beginHalf(g, 'B');
      else endOpStage(g);
      break;
  }
}

function endOpStage(g) {
  // A unit that spent no CP all stage recovers cohesion, but never above 0 [6.24.1].
  for (const u of g.units) {
    if (u.cpUsed === 0 && u.cohesion < 0) u.cohesion = Math.min(0, u.cohesion + REST_RP);
  }
  g.half = null;
  if (g.opStage < OPS_STAGES_PER_TURN) return startOpStage(g, g.opStage + 1);
  endGameTurn(g);
  if (g.turn >= SCENARIO.lastTurn || g.winner) {
    g.over = true;
    g.winner ||= scenarioWinner(g);
    log(g, 'all', `The scenario is over. ${g.winner === 'draw' ? 'Neither side achieved its aims.' : `${g.winner === 'axis' ? 'The Axis' : 'The Commonwealth'} wins.`}`);
    return;
  }
  g.turn++;
  startGameTurn(g);
}

function scenarioWinner(g) {
  // Placeholder until the scenario victory conditions (60.71) are implemented:
  // Axis wins Graziani's Offensive by holding Sidi Barrani or anything further east.
  const east = ['barrani', 'matruh', 'alamein', 'alexandria'];
  return east.some((p) => g.portOwners[p] === 'axis') ? 'axis' : 'cw';
}

// ---------- Orders (form-based steps) ----------

// Returns an error string, or null if accepted.
export function submitOrders(g, side, orders) {
  if (g.over) return 'The game is over.';
  const st = currentStep(g);
  if (!actingSides(g).includes(side)) return 'It is not your side\'s turn to act.';
  orders ||= {};
  const err = validateOrders(g, side, g.step, orders);
  if (err) return err;
  if (st.kind === 'simultaneous') {
    g.pending[side] = orders;
    g.ready[side] = true;
    if (SIDES.every((s) => g.ready[s])) {
      ({ air: resolveAir, convoy: resolveConvoy })[g.step](g, { axis: g.pending.axis, cw: g.pending.cw });
      advance(g);
    }
    return null;
  }
  if (g.step === 'declare') {
    const holder = g.initiative.holder;
    const first = orders.goFirst !== false;
    g.order = first ? { A: holder, B: other(holder) } : { A: other(holder), B: holder };
    log(g, 'all', `Operations Stage ${g.opStage}: ${g.order.A === 'axis' ? 'Axis' : 'Commonwealth'} moves first (Player A).`);
    advance(g);
    return null;
  }
  if (g.step === 'trucks') {
    resolveTrucks(g, side, orders);
    advance(g);
    return null;
  }
  return 'This step is played with map actions, not orders.';
}

export function unready(g, side) {
  if (currentStep(g).kind === 'simultaneous') g.ready[side] = false;
}

function validateOrders(g, side, step, o) {
  switch (step) {
    case 'air': {
      const vals = ['malta', 'escort', 'ground'].map((k) => o[k] ?? 0);
      if (vals.some((v) => !Number.isInteger(v) || v < 0)) return 'Air points must be whole numbers.';
      if (vals.reduce((a, b) => a + b, 0) > AIR_POINTS[side]) return `You only have ${AIR_POINTS[side]} air points.`;
      return null;
    }
    case 'convoy': {
      if (!o.port) return null;
      const p = PORTS.find((x) => x.id === o.port);
      if (!p) return 'Unknown port.';
      if (g.portOwners[p.id] !== side) return `${p.name} is not in your hands.`;
      return null;
    }
    case 'trucks': {
      let load = 0;
      for (const t of o.transfers || []) {
        const from = g.dumps[t.from];
        if (!from || from.side !== side) return 'Transfers must start at one of your dumps.';
        if (!RES.includes(t.res)) return 'Unknown resource.';
        if (!Number.isInteger(t.amount) || t.amount <= 0) return 'Amounts must be positive whole numbers.';
        if (from[t.res] < t.amount) return `Not enough ${t.res} at that dump.`;
        const dest = g.dumps[t.to];
        const ownUnitThere = g.units.some((u) => u.side === side && key(...u.pos) === t.to);
        if (!(dest && dest.side === side) && !ownUnitThere) return 'Destination must be your dump or a hex your units hold.';
        load += t.amount * Math.max(1, Math.ceil(distance(parseKey(t.from), parseKey(t.to)) / 8));
      }
      if (load > TRUCK_CAPACITY[side]) return `Over truck capacity (${load}/${TRUCK_CAPACITY[side]}).`;
      return null;
    }
    default:
      return null;
  }
}

function resolveAir(g, o) {
  for (const s of SIDES) {
    const x = o[s] || {};
    g.air[s] = { malta: x.malta || 0, escort: x.escort || 0, ground: x.ground || 0 };
    log(g, s, `Air: ${g.air[s].malta} on Malta missions, ${g.air[s].escort} on convoy escort, ${g.air[s].ground} on ground support.`);
  }
}

function resolveConvoy(g, o) {
  const a = g.air.axis || {}, c = g.air.cw || {};
  const lossPct = {
    axis: clamp(15 + 8 * (c.malta || 0) - 6 * (a.malta || 0) - 4 * (a.escort || 0), 0, 80),
    cw: clamp(10 + 2 * (a.escort || 0) - 3 * (c.escort || 0), 0, 50),
  };
  for (const s of SIDES) {
    const portId = o[s]?.port;
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

function resolveTrucks(g, side, o) {
  for (const t of o.transfers || []) {
    const from = g.dumps[t.from];
    if (!from || from[t.res] < t.amount) continue;
    from[t.res] -= t.amount;
    const truckFuel = Math.ceil((t.amount * distance(parseKey(t.from), parseKey(t.to))) / 40);
    from.fuel = Math.max(0, from.fuel - truckFuel);
    const dest = (g.dumps[t.to] ||= { side, fuel: 0, water: 0, ammo: 0, stores: 0 });
    dest[t.res] += t.amount;
    log(g, side, `Truck convoy moved ${t.amount} ${t.res} (${truckFuel} fuel burned).`);
  }
}

// ---------- Capability points & cohesion [6.0] ----------

const isMotorised = (u) => u.motorised;
const collapsed = (u) => u.cohesion <= COHESION_COLLAPSE;

// Spend CP; anything beyond the CPA becomes Disorganisation Points straight away [6.21-6.22].
function spendCP(g, u, cp) {
  const before = u.cpUsed;
  u.cpUsed += cp;
  const over = Math.max(0, u.cpUsed - Math.max(u.cpa, before));
  if (over > 0) {
    const dp = Math.ceil(over);
    u.cohesion -= dp;
    log(g, u.side, `${u.name} pushes past its CPA: ${dp} Disorganisation Point${dp > 1 ? 's' : ''} (cohesion ${u.cohesion}).`);
  }
}
function earnRP(u, rp) { u.cohesion = Math.min(COHESION_MAX, u.cohesion + rp); }

// ---------- Zones of control [10.0] ----------

const hexSP = (units) => units.reduce((s, u) => s + (STACKING_POINTS[u.size] ?? 0), 0);
const unitsAt = (g, pos) => g.units.filter((u) => u.pos[0] === pos[0] && u.pos[1] === pos[1]);
const isCombatUnit = (u) => u.type !== 'hq' && u.type !== 'truck';

function exertsZoc(g, u) {
  if (!isCombatUnit(u) || collapsed(u)) return false; // [10.11, 10.14]
  if ((STACKING_POINTS[u.size] ?? 0) > 1) return true;
  return hexSP(unitsAt(g, u.pos).filter((x) => x.side === u.side && isCombatUnit(x))) > 1;
}

function zocReaches(g, u, target) {
  if (distance(u.pos, target) !== 1) return false;
  const e = gameMap().hexsides[edgeKey(u.pos, target)];
  if (e && (e.type === 'escarpment' || e.type === 'majorRiver')) return false; // [10.21b]
  if (gameMap().tiles[key(...target)]?.t === 'sea') return false;
  return !!stepCost(gameMap(), u.pos, target, { motorised: isMotorised(u) }); // [10.21c]
}

// Is `pos` controlled by an enemy of `unit`'s side, for movement purposes? [10.26]
export function inEnemyZoc(g, unit, pos) {
  const friendlyCombatThere = g.units.some((x) => x !== unit && x.side === unit.side && isCombatUnit(x) && x.pos[0] === pos[0] && x.pos[1] === pos[1]);
  if (friendlyCombatThere) return false;
  return g.units.some((e) => e.side !== unit.side && exertsZoc(g, e) && zocReaches(g, e, pos));
}

// ---------- Map actions (Movement & Combat Phase) ----------

export function act(g, side, a) {
  if (g.over) return 'The game is over.';
  if (g.step !== 'movecombat' || phasingSide(g) !== side) return 'It is not your Movement & Combat Phase.';
  switch (a?.action) {
    case 'move': return actMove(g, side, a);
    case 'toCombat':
      if (g.seg.mode !== 'move') return 'Already in the combat segment.';
      g.seg.mode = 'combat';
      return null;
    case 'attack': return actAttack(g, side, a);
    case 'nextSegment': return actNextSegment(g, side);
    case 'endPhase': {
      const err = g.seg.mode === 'combat' ? unmetAttackObligations(g, side) : null;
      if (err) return err;
      freezeAfterSegment(g);
      log(g, side, `${side === 'axis' ? 'Axis' : 'Commonwealth'} ends its Movement & Combat Phase.`);
      advance(g);
      return null;
    }
    default: return 'Unknown action.';
  }
}

// Validates a path and returns { cp, bp, hexes, stopAt } or an error string.
export function planMove(g, u, path) {
  if (!Array.isArray(path) || !path.length) return 'Empty path.';
  const map = gameMap();
  let cp = 0, bp = 0;
  const startInZoc = inEnemyZoc(g, u, u.pos);
  if (startInZoc || u.contact) cp += u.engaged ? CP.disengage : CP.breakContact; // [8.15, 8.24]
  let cur = u.pos;
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (!neighbours(...cur).some(([c, r]) => c === step[0] && r === step[1])) return 'Path is not continuous.';
    if (step[0] < 0 || step[1] < 0 || step[0] >= MAP_COLS || step[1] >= MAP_ROWS) return 'Off the map.';
    if (g.units.some((e) => e.side !== u.side && e.pos[0] === step[0] && e.pos[1] === step[1])) return 'Cannot enter an enemy-occupied hex.';
    const c = stepCost(map, cur, step, { motorised: isMotorised(u) });
    if (!c) return `Cannot enter ${key(...step)} (${TERRAIN[map.tiles[key(...step)]?.t]?.label || 'off map'}).`;
    cp += c.cp; bp += c.bp;
    const intoZoc = inEnemyZoc(g, u, step);
    if (intoZoc && i === 0 && startInZoc) return 'Cannot move directly from one enemy-controlled hex to another [10.24].';
    if (intoZoc && i < path.length - 1) return 'Units must stop on entering an enemy zone of control [10.23].';
    cur = step;
  }
  return { cp, bp };
}

function actMove(g, side, a) {
  if (g.seg.mode !== 'move') return 'Combat has started in this segment; start a new movement segment first.';
  const u = g.units.find((x) => x.id === a.unitId && x.side === side);
  if (!u) return 'Unknown unit.';
  if (collapsed(u)) return `${u.name} is too disorganised to move (cohesion ${u.cohesion}).`;
  if (g.seg.moved.includes(u.id)) return `${u.name} has already moved this segment.`;
  if (g.seg.frozen.includes(u.id)) return `${u.name} finished a segment more than ${CONTINUAL_MOVE_RANGE} hexes from the enemy and cannot move again this phase [8.23].`;
  if (u.motorised && u.fuel <= 0) return `${u.name} has no fuel.`;
  const plan = planMove(g, u, a.path);
  if (typeof plan === 'string') return plan;
  if (u.cpa <= 10 && u.cpUsed + plan.cp > u.cpa * NON_MOTORISED_VOLUNTARY_LIMIT) {
    return `${u.name} is on foot and may not voluntarily spend more than ${u.cpa * NON_MOTORISED_VOLUNTARY_LIMIT} CP this stage [8.17].`;
  }
  const dest = a.path.at(-1);
  const stackAfter = hexSP(unitsAt(g, dest).filter((x) => x.side === side && x !== u)) + (STACKING_POINTS[u.size] ?? 0);
  if (stackAfter > stackingLimit(gameMap(), dest)) return `Stacking limit exceeded at ${key(...dest)} (${stackAfter}/${stackingLimit(gameMap(), dest)}) [9.31].`;
  // Fuel: placeholder of 1 point per hex until the Fuel Consumption Chart (49.19) is in.
  if (u.motorised) {
    if (u.fuel < a.path.length) return `${u.name} has only ${u.fuel} fuel.`;
    u.fuel -= a.path.length;
  }
  spendCP(g, u, plan.cp);
  u.bp += plan.bp;
  u.pos = dest;
  u.contact = false;
  u.engaged = false;
  g.seg.moved.push(u.id);
  // Totally disorganised enemies surrender when approached [6.26].
  for (const e of g.units.filter((x) => x.side !== side && collapsed(x) && distance(x.pos, u.pos) === 1)) {
    log(g, 'all', `${e.name} surrenders to ${u.name}.`);
    e.str = 0;
  }
  removeDestroyed(g);
  updateOwnership(g);
  return null;
}

function freezeAfterSegment(g) {
  const side = phasingSide(g);
  const enemies = g.units.filter((x) => x.side !== side && isCombatUnit(x));
  for (const id of g.seg.moved) {
    const u = g.units.find((x) => x.id === id);
    if (!u) continue;
    const near = enemies.some((e) => distance(e.pos, u.pos) <= CONTINUAL_MOVE_RANGE);
    if (!near && !g.seg.frozen.includes(id)) g.seg.frozen.push(id);
  }
}

// Every enemy hex exerting a ZOC on a phasing combat unit must be attacked in the combat segment [10.31].
export function attackObligations(g, side) {
  const out = [];
  for (const e of g.units.filter((x) => x.side !== side && exertsZoc(g, x))) {
    const threatened = g.units.filter((u) => u.side === side && isCombatUnit(u) && zocReaches(g, e, u.pos));
    if (threatened.length) out.push({ enemy: e, threatened });
  }
  return out;
}
function unmetAttackObligations(g, side) {
  const unmet = attackObligations(g, side).filter((o) => !g.seg.attacked.includes(key(...o.enemy.pos)));
  if (!unmet.length) return null;
  return `Units in an enemy zone of control must attack it before the segment ends [10.31]: ${unmet.map((o) => o.enemy.name).join(', ')}.`;
}

function actNextSegment(g, side) {
  if (g.seg.mode === 'combat') {
    const err = unmetAttackObligations(g, side);
    if (err) return err;
  }
  freezeAfterSegment(g);
  g.seg = { n: g.seg.n + 1, mode: 'move', moved: [], attacked: [], frozen: g.seg.frozen };
  for (const u of g.units) if (u.side === side) u.contact = inEnemyZoc(g, u, u.pos);
  return null;
}

// PLACEHOLDER combat until Barrage / Anti-Armour / Close Assault (11.0-15.0) are implemented.
// CP costs and cohesion effects already follow the rules.
function actAttack(g, side, a) {
  if (g.seg.mode !== 'combat') return 'Finish movement and start the combat segment first.';
  const target = g.units.find((x) => x.id === a.targetId && x.side !== side);
  if (!target) return 'Unknown target.';
  const attackers = (a.attackerIds || []).map((id) => g.units.find((x) => x.id === id && x.side === side)).filter(Boolean);
  if (!attackers.length) return 'Choose at least one attacking unit.';
  for (const u of attackers) {
    if (distance(u.pos, target.pos) !== 1) return `${u.name} is not adjacent to ${target.name}.`;
    if (collapsed(u)) return `${u.name} is too disorganised to attack.`;
    if (!isCombatUnit(u)) return `${u.name} is not a combat unit.`;
  }
  const defenders = unitsAt(g, target.pos);
  for (const u of attackers) spendCP(g, u, CP.phasingAssault);
  for (const d of defenders) spendCP(g, d, CP.defend);
  const strBefore = defenders.reduce((s, d) => s + d.str, 0);
  const attStrBefore = attackers.reduce((s, u) => s + u.str, 0);

  const groundAir = g.air[side]?.ground || 0;
  const att = attackers.reduce((s, u) => s + effStr(u), 0) + groundAir / 3;
  const terr = TERRAIN[gameMap().tiles[key(...target.pos)].t];
  const terrMult = 1 + 0.25 * shiftCount(terr.combat?.closeAssault) + hexsideDefence(target.pos, attackers);
  const def = defenders.reduce((s, d) => s + (collapsed(d) ? 0 : effStr(d)), 0) * Math.max(0.5, terrMult);
  for (const u of attackers) u.ammo = Math.max(0, u.ammo - 1);
  for (const d of defenders) d.ammo = Math.max(0, d.ammo - 1);
  const ratio = att / Math.max(0.5, def);
  const roll = d6(g) + (ratio >= 3 ? 2 : ratio >= 2 ? 1 : ratio < 1 ? -1 : 0);
  let result;
  if (roll <= 2) { attackers[0].str -= 1; result = 'attack repulsed, attacker loses a step'; }
  else if (roll <= 4) { target.str -= 1; attackers[0].str -= 1; result = 'both sides lose a step'; for (const d of defenders) d.engaged = true; }
  else if (roll <= 6) { target.str -= 1; retreat(g, defenders); result = 'defender loses a step and falls back'; }
  else { target.str -= 2; retreat(g, defenders); result = 'defender routed'; }

  // Heavy losses disorganise [6.21]; clearing the hex rewards the attackers [6.24.2].
  const defLossPct = 1 - defenders.reduce((s, d) => s + Math.max(0, d.str), 0) / strBefore;
  const attLossPct = 1 - attackers.reduce((s, u) => s + Math.max(0, u.str), 0) / attStrBefore;
  if (defLossPct >= 0.3) for (const d of defenders) d.cohesion -= HEAVY_LOSS_DP;
  if (attLossPct >= 0.3) for (const u of attackers) u.cohesion -= HEAVY_LOSS_DP;
  removeDestroyed(g);
  const hexCleared = !g.units.some((x) => x.side !== side && key(...x.pos) === key(...target.pos));
  if (hexCleared) for (const u of attackers.filter((x) => x.str > 0)) earnRP(u, VICTORY_RP);
  g.seg.attacked.push(key(...target.pos));
  log(g, 'all', `${attackers.map((u) => u.name).join(', ')} assaulted ${target.name} (${att.toFixed(1)} vs ${def.toFixed(1)}, roll ${roll}): ${result}.`);
  updateOwnership(g);
  return null;
}

const shiftCount = (s) => (s && s[0] === 'L' ? Number(s.slice(1)) : s && s[0] === 'R' ? -Number(s.slice(1)) : 0);
function hexsideDefence(targetPos, attackers) {
  // Use the worst (most defensive) hexside the attackers cross.
  let best = 0;
  for (const u of attackers) {
    const e = gameMap().hexsides[edgeKey(u.pos, targetPos)];
    if (!e) continue;
    const t = e.type === 'escarpment' ? (e.down === key(...u.pos) ? 'upEscarpment' : 'downEscarpment') : e.type === 'slope' ? (e.down === key(...u.pos) ? 'upSlope' : 'downSlope') : e.type;
    best = Math.max(best, 0.25 * shiftCount(HEXSIDES[t]?.combat?.closeAssault));
  }
  return best;
}

const effStr = (u) => (u.ammo > 0 ? u.str : u.str / 2);

function retreat(g, defenders) {
  for (const u of defenders) {
    if (u.str <= 0) continue;
    const options = neighbours(...u.pos).filter((n) =>
      stepCost(gameMap(), u.pos, n, { motorised: isMotorised(u) }) &&
      !g.units.some((x) => x.side !== u.side && x.pos[0] === n[0] && x.pos[1] === n[1]) &&
      !inEnemyZoc(g, u, n) &&
      hexSP(unitsAt(g, n).filter((x) => x.side === u.side)) + (STACKING_POINTS[u.size] ?? 0) <= stackingLimit(gameMap(), n));
    if (!options.length) { u.str -= 1; continue; } // must stand and take further losses
    options.sort((A, B) => (u.side === 'axis' ? A[0] - B[0] : B[0] - A[0]));
    const c = stepCost(gameMap(), u.pos, options[0], { motorised: isMotorised(u) });
    spendCP(g, u, c.cp); // involuntary movement still costs CP [8.12]
    u.pos = options[0];
  }
}

function removeDestroyed(g) {
  for (const u of g.units.filter((x) => x.str <= 0)) log(g, 'all', `${u.name} has been destroyed or captured.`);
  g.units = g.units.filter((x) => x.str > 0);
}

function updateOwnership(g) {
  for (const p of PORTS) {
    const here = unitsAt(g, [p.col, p.row]);
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

// ---------- End of Game-Turn (PLACEHOLDER supply until 32.0 / Logistics Game) ----------

function endGameTurn(g) {
  for (const u of g.units) {
    const dumps = Object.entries(g.dumps)
      .filter(([k, d]) => d.side === u.side && distance(parseKey(k), u.pos) <= SUPPLY_RANGE)
      .sort(([a], [b]) => distance(parseKey(a), u.pos) - distance(parseKey(b), u.pos));
    const caps = { fuel: u.motorised ? 30 : 0, water: 3, ammo: 3 };
    for (const r of ['fuel', 'water', 'ammo']) {
      for (const [, d] of dumps) {
        const need = caps[r] - u[r];
        if (need <= 0) break;
        const take = Math.min(need, Math.floor(d[r]));
        d[r] -= take; u[r] += take;
      }
    }
    const waterNeed = 1 + (g.options.pastaRule && u.nation === 'it' ? 1 : 0);
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
    const spot = [[p.col, p.row], ...neighbours(p.col, p.row)].find((h) =>
      gameMap().tiles[key(...h)] && gameMap().tiles[key(...h)].t !== 'sea' &&
      hexSP(unitsAt(g, h)) + (STACKING_POINTS[r.unit.size] ?? 0) <= stackingLimit(gameMap(), h));
    if (!spot) continue;
    g.units.push({ ...structuredClone(r.unit), pos: spot });
    log(g, r.unit.side, `Reinforcements: ${r.unit.name} arrives at ${p.name}.`);
  }

  if (g.portOwners.alexandria === 'axis') g.winner = 'axis';
  else if (g.portOwners.tripoli === 'cw') g.winner = 'cw';
}

// ---------- Views (fog of war) ----------

export function viewFor(g, side) {
  const own = g.units.filter((u) => u.side === side);
  const seen = (pos) => own.some((u) => distance(u.pos, pos) <= VISION_RANGE);
  const enemy = g.units
    .filter((u) => u.side !== side && seen(u.pos))
    .map(({ id, side: s, nation, name, type, size, str, pos }) => ({ id, side: s, nation, name, type, size, str, pos }));
  const dumps = {};
  for (const [k, d] of Object.entries(g.dumps)) {
    if (d.side === side) dumps[k] = d;
    else if (seen(parseKey(k))) dumps[k] = { side: d.side, spotted: true };
  }
  const obligations = g.step === 'movecombat' && phasingSide(g) === side
    ? attackObligations(g, side).filter((o) => seen(o.enemy.pos)).map((o) => ({ enemyId: o.enemy.id, hex: key(...o.enemy.pos), met: g.seg.attacked.includes(key(...o.enemy.pos)) }))
    : [];
  return {
    turn: g.turn,
    date: turnDate(g.turn),
    lastTurn: SCENARIO.lastTurn,
    scenario: SCENARIO.name,
    opStage: g.opStage,
    step: g.step,
    half: g.half,
    order: g.order,
    phasing: phasingSide(g),
    initiative: g.initiative,
    seg: g.step === 'movecombat' && phasingSide(g) === side ? g.seg : g.seg ? { n: g.seg.n, mode: g.seg.mode } : null,
    ready: g.ready,
    myOrders: g.pending[side],
    acting: actingSides(g),
    units: [...own, ...enemy],
    dumps,
    portOwners: g.portOwners,
    air: g.air[side],
    airPoints: AIR_POINTS[side],
    truckCapacity: TRUCK_CAPACITY[side],
    options: g.options,
    obligations,
    winner: g.winner,
    over: g.over,
    log: g.log.filter((l) => l.side === 'all' || l.side === side).slice(-100),
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (d) => RES.map((r) => `${r} ${Math.floor(d[r] ?? 0)}`).join(', ');
