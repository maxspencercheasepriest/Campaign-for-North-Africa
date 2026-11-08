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
//   21-22 Breakdown (rolled when a unit stops) and automatic field repair of tanks; 29 Weather.
// STILL PLACEHOLDER: supply/air/convoys (32 / 33-58), truck breakdown, facility repair, and more.

import { REINFORCEMENTS } from '../shared/reinforcements.js';
import { createAir, summariseSquadron, facilityHex } from '../shared/air.js';
import { key, parseKey, distance, neighbours } from '../shared/hex.js';
import { fuelAndArm, validateAirOrders, autoAirOrders, resolveAir, returnPilots, repairFacilities, repairPorts, portEff, portMax, newDamage, repairDamage, fortLevel, fortBase } from './air.js';
import {
  SIDES, accessFor, PORTS, LOCATIONS, MAP_COLS, MAP_ROWS, scenarioById,
  buildMap, initialUnits, initialSupply, initialPortOwners, VISION_RANGE,
} from '../shared/scenario.js';
import {
  createSupply, doubleStock, supplyDiagnosis, supplyReach, suppliesInRange, fuelNeed, ammoCost, draw, drawHere, available, captureAt, hotWeatherLoss, planArrivals,
  receiveArrivals, scheduleConvoys, landConvoys, convoyList, moveSupply, resetMoved, axisConvoyLevel, cwSupplyPeriod,
  MAX_PER_CONVOY_LANE,
} from './supply.js';
import { resolveCombat, makeRetreat, rawDefensiveCA, syncStr } from './combat.js';
import {
  turnDate, initiativeRating, CP, NON_MOTORISED_VOLUNTARY_LIMIT, COHESION_MAX, COHESION_COLLAPSE,
  REST_RP, VICTORY_RP, HEAVY_LOSS_DP, CONTINUAL_MOVE_RANGE, STACKING_POINTS, TERRAIN, HEXSIDES,
  stepCost, stackingLimit, edgeKey, OPS_STAGES_PER_TURN, seasonOfTurn, localWeather,
} from '../shared/rules.js';
import { WEATHER, FOUL_WEATHER_SECTIONS, BREAKDOWN, breakdownColumn } from '../shared/tables.js';
import { WEAPONS } from '../shared/weapons.js';

const other = (side) => (side === 'axis' ? 'cw' : 'axis');

// Steps of the sequence of play, in order. kind:
//   simultaneous - both sides submit orders, resolves when both are in
//   holder       - only the Initiative holder decides
//   phasing      - only the current phasing player (Player A, then Player B) acts
export const STEPS = {
  convoy: { name: 'Naval Convoy Stage', role: 'logistics', kind: 'simultaneous' },
  declare: { name: 'Initiative Declaration', role: 'cic', kind: 'holder' },
  movecombat: { name: 'Movement & Combat Phase', role: 'front', kind: 'phasing' },
  air: { name: 'Land Support Air Phase', role: 'air', kind: 'simultaneous' },
  trucks: { name: 'Truck Convoy Movement Phase', role: 'rear', kind: 'phasing' },
};

let mapCache = null;
export const gameMap = () => (mapCache ||= buildMap());

// The map as this game has it: hexes whose road or railway was bombed lose it, and a destroyed road counts as a track [24.52].
const damaged = new WeakMap();
export function mapFor(g) {
  const base = gameMap(), d = g.damage;
  if (!d || (!Object.keys(d.roads).length && !Object.keys(d.rails).length)) return base;
  const sig = JSON.stringify([Object.keys(d.roads).sort(), Object.keys(d.rails).sort()]);
  const c = damaged.get(g);
  if (c && c.sig === sig) return c.map;
  const hit = (ek, set) => ek.split('|').some((k) => k in set);
  const roads = new Set(), tracks = new Set(base.tracks), rails = new Set();
  for (const ek of base.roads) { if (hit(ek, d.roads)) tracks.add(ek); else roads.add(ek); }
  for (const ek of base.rails || []) if (!hit(ek, d.rails)) rails.add(ek);
  const map = { ...base, roads, tracks, rails };
  damaged.set(g, { sig, map });
  return map;
}

export function createGame(options = {}) {
  const g = {
    version: 7,
    scenario: scenarioById(options.scenario).id,
    turn: scenarioById(options.scenario).firstTurn,
    opStage: 0,
    step: null,
    half: null,
    order: null, // { A: side, B: side } for the current Operations Stage
    initiative: null,
    seg: null,
    options: { pastaRule: true, ...options },
    units: initialUnits(),
    supply: createSupply(initialSupply(options.stock === 'generous' ? 2 : 1)),
    air: createAir(),
    damage: newDamage(),
    portOwners: initialPortOwners(),
    pending: { axis: null, cw: null },
    ready: { axis: false, cw: false },
    log: [],
    lastCombat: null,
    decision: null, // pending choice by the non-phasing side: { kind: 'reaction'|'defence', side, role, ... }
    prisoners: { axis: 0, cw: 0 },
    weather: { type: 'normal', sections: [], roll: null },
    broken: [], // broken-down vehicle markers [21.42]
    winner: null,
    over: false,
    seed: Number.isInteger(options.seed) ? options.seed >>> 0 : (Date.now() ^ 0x9e3779b9) >>> 0,
  };
  if (options.stock === 'generous') doubleStock(g.supply, gameMap());
  for (const sd of SIDES) fuelAndArm(g.air, sd);
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
// The staff seat that acts right now (a pending defender decision belongs to the defending front-line commander).
export const actingRole = (g) => (g.decision ? g.decision.role : currentStep(g).role);
export const phasingSide = (g) => (g.order && g.half ? g.order[g.half] : null);

// Which sides must act in the current step.
export function actingSides(g) {
  if (g.over) return [];
  if (g.decision) return [g.decision.side];
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
  if (g.turn === scenarioOf(g).firstTurn && scenarioOf(g).initiativeFirstTurn) {
    holder = scenarioOf(g).initiativeFirstTurn;
  } else {
    let a, c;
    do { a = d6(g) + ratings.axis; c = d6(g) + ratings.cw; } while (a === c); // ties re-roll
    rolls = { axis: a, cw: c };
    holder = a > c ? 'axis' : 'cw';
  }
  g.initiative = { holder, ratings, rolls };
  log(g, 'all', `Game-Turn ${g.turn} (${turnDate(g.turn)}): ${holder === 'axis' ? 'the Axis' : 'the Commonwealth'} holds the Initiative${rolls ? ` (Axis ${rolls.axis} vs Commonwealth ${rolls.cw})` : ' (scenario rule)'}.`);
  // II. Naval Convoy Stage: supply arrivals for this turn, then new plans [32.4]
  receiveArrivals(g.supply, gameMap(), g.turn, (side, text) => log(g, side, text));
  planArrivals(g.supply, () => d6(g), g.turn, { firstTurn: scenarioOf(g).firstTurn });
  g.opStage = 0;
  g.order = null;
  g.half = null;
  returnPilots(g.air, g.turn);
  if (g.turn > scenarioOf(g).firstTurn) { repairFacilities(g.air); repairDamage(g); }
  setStep(g, 'convoy');
}

function setStep(g, step) {
  g.step = step;
  g.pending = { axis: null, cw: null };
  g.ready = { axis: false, cw: false };
  if (step === 'movecombat') g.seg = { n: 1, mode: 'move', moved: [], attacked: [], frozen: [] };
}

// Weather Determination: the Initiative holder rolls on the season's row [29.1].
function rollWeather(g) {
  const season = seasonOfTurn(g.turn);
  const roll = d6(g) * 10 + d6(g);
  const type = WEATHER[season][roll];
  let sections = [];
  if (type === 'sand' || type === 'rain') sections = FOUL_WEATHER_SECTIONS[d6(g)];
  g.weather = { type, sections, roll, season };
  const where = sections.length ? ` over map section${sections.length > 1 ? 's' : ''} ${sections.join(', ')}` : '';
  log(g, 'all', `Weather (${season}, roll ${roll}): ${{ normal: 'normal', hot: 'hot', sand: 'a sandstorm', rain: 'a rainstorm' }[type]}${where}.`);
}
export const weatherAt = (g, hex) => localWeather(g.weather, gameMap(), hex);

function startOpStage(g, n) {
  g.opStage = n;
  for (const u of g.units) { u.cpUsed = 0; u.bp = 0; u.bpCol = -1; u.sandCp = 0; u.fuelPaid = false; u.reserve = 0; u.relFrom = 0; u.relCap = null; u.assaults = 0; u.resDp = false; for (const e of u.elements || []) e.airPin = 0; }
  resetMoved(g.supply);
  repairPorts(g);
  convoyArrivalPhase(g);
  rollWeather(g);
  if (g.weather.type === 'hot') hotWeatherLoss(g.supply);
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
    case 'convoy': startOpStage(g, 1); break;
    case 'declare': if (g.options.air === 'on') setStep(g, 'air'); else beginHalf(g, 'A'); break;
    case 'air': beginHalf(g, 'A'); break;
    case 'movecombat': setStep(g, 'trucks'); repairPhase(g, phasingSide(g)); break;
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
  g.winner ||= instantWinner(g);
  if (g.turn >= scenarioOf(g).lastTurn || g.winner) {
    g.over = true;
    g.winner ||= scenarioWinner(g);
    log(g, 'all', `The scenario is over. ${g.winner === 'draw' ? 'Neither side achieved its aims.' : `${g.winner === 'axis' ? 'The Axis' : 'The Commonwealth'} wins.`}`);
    return;
  }
  g.turn++;
  startGameTurn(g);
}

// Victory conditions of Graziani's Offensive [60.81]. "In supply" is approximated by the side still having
// supply units to draw on; the full supply-line trace comes with the Logistics Game.
const VICTORY = {
  axis: [
    ['strategic', 'Alexandria or Cairo', (o) => o.alexandria === 'axis' || o.cairo === 'axis'],
    ['decisive', 'Mersa Matruh and Siwa', (o) => o.matruh === 'axis' && o.siwa === 'axis'],
    ['tactical', 'Sidi Barrani, with Sollum, Fort Maddalena and Giarabub', (o) => ['barrani', 'sollum', 'maddalena', 'giarabub'].every((l) => o[l] === 'axis')],
  ],
  cw: [
    ['strategic', 'Tobruk', (o) => o.tobruk === 'cw'],
    ['decisive', 'Bardia, Fort Maddalena, Sidi Omar, Sollum and Siwa', (o) => ['bardia', 'maddalena', 'sidiomar', 'sollum', 'siwa'].every((l) => o[l] === 'cw')],
    ['tactical', 'Sollum, Halfaya Pass and Siwa', (o) => ['sollum', 'halfaya', 'siwa'].every((l) => o[l] === 'cw')],
  ],
};
const TIER = { strategic: 3, decisive: 2, tactical: 1 };
const scenarioOf = (g) => scenarioById(g.scenario);
const hasSupply = (g, side) => g.supply.units.some((s) => s.side === side && (s.ammo > 0 || s.fuel > 0)) || (side === 'axis' && g.supply.box.axis.length > 0);

// Occupation points for the points scenarios [60.82, 64.73]. Ownership is by last occupation (the same state the
// ports and convoys use); the "enough stores and fuel to count" test of 64.73 is approximated by still having supply.
export function victoryPoints(g) {
  const sc = scenarioOf(g);
  const pts = { axis: 0, cw: 0 };
  for (const [loc, [a, c]] of Object.entries(sc.points || {})) {
    const owner = g.portOwners[loc];
    if (owner === 'axis') pts.axis += a; else if (owner === 'cw') pts.cw += c;
  }
  return pts;
}

export function victoryStatus(g) {
  const sc = scenarioOf(g);
  if (sc.victory !== 'tiers') return { mode: 'points', ...victoryPoints(g), supplied: { axis: hasSupply(g, 'axis'), cw: hasSupply(g, 'cw') } };
  const out = {};
  for (const side of SIDES) {
    const hit = hasSupply(g, side) ? VICTORY[side].find(([, , test]) => test(g.portOwners)) : null;
    out[side] = hit ? { tier: hit[0], what: hit[1] } : null;
  }
  return out;
}

// Outright wins that end a points scenario early.
export function instantWinner(g) {
  const sc = scenarioOf(g);
  if (sc.victory === 'campaign') {
    // 64.71: the Axis hold Alexandria and Cairo and can be supplied. 64.72: from Game-Turn 35 an Axis army with no supply loses.
    if (g.portOwners.alexandria === 'axis' && g.portOwners.cairo === 'axis' && hasSupply(g, 'axis')) { g.victoryLevel = 'strategic'; return 'axis'; }
    if (g.turn >= 35 && !hasSupply(g, 'axis')) { g.victoryLevel = 'strategic'; return 'cw'; }
  }
  if (sc.victory === 'points' && !hasSupply(g, 'axis')) { g.victoryLevel = 'strategic'; return 'cw'; } // 60.82: no Italian supply line
  return null;
}

function scenarioWinner(g) {
  const sc = scenarioOf(g);
  if (sc.victory !== 'tiers') {
    const p = victoryPoints(g);
    if (p.axis === p.cw) return 'draw';
    g.victoryLevel = 'points';
    return p.axis > p.cw ? 'axis' : 'cw';
  }
  const v = victoryStatus(g);
  const a = v.axis ? TIER[v.axis.tier] : 0, c = v.cw ? TIER[v.cw.tier] : 0;
  if (a === c) return 'draw';
  const side = a > c ? 'axis' : 'cw';
  g.victoryLevel = v[side].tier;
  return side;
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
      if (g.step === 'air') resolveAirPhase(g, { axis: g.pending.axis, cw: g.pending.cw });
      else resolveConvoy(g, { axis: g.pending.axis, cw: g.pending.cw });
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
    case 'convoy': {
      const list = convoyList(o);
      if (side !== 'axis' || !list.length) return null; // only the Axis ships supply [32.6]; the Commonwealth's arrive on their own
      const lanes = new Set();
      let total = 0;
      for (const c of list) {
        const p = PORTS.find((x) => x.id === c.port);
        if (!p) return 'Choose a port for each convoy.';
        if (g.portOwners[p.id] !== side) return `${p.name} is not in your hands.`;
        if (!Number.isInteger(c.route) || c.route < 1 || c.route > 6) return 'Choose a convoy lane from 1 to 6.';
        if (g.turn <= 2 && ![2, 3, 6].includes(c.route)) return 'In September 1940 the Italians may only use lanes 2, 3 and 6 [60.37].';
        if (lanes.has(c.route)) return `Lane ${c.route} is used twice: one convoy per lane.`;
        lanes.add(c.route);
        if (!Number.isInteger(c.n) || c.n < 0 || c.n > MAX_PER_CONVOY_LANE) return `A convoy lane takes at most ${MAX_PER_CONVOY_LANE} supply units [32.62].`;
        if (c.stage != null && ![1, 2, 3].includes(c.stage)) return 'A convoy arrives in Operations Stage 1, 2 or 3.';
        total += c.n;
      }
      if (total > g.supply.box.axis.length) return `Only ${g.supply.box.axis.length} supply units are waiting in Tripoli.`;
      return null;
    }
    case 'air':
      return validateAirOrders(g, side, o, gameMap());
    case 'trucks':
      return Array.isArray(o.moves || []) ? null : 'Moves must be a list.';
    default:
      return null;
  }
}

// Supply and reach need to know about enemies and weather.
function supplyCtx(g, side) {
  const map = mapFor(g);
  const enemyHexes = new Set(g.units.filter((u) => u.side !== side && u.str > 0).map((u) => key(...u.pos)));
  return {
    map,
    enemyHexes,
    weatherAt: (hex) => weatherAt(g, hex),
    zocBlocked: (sd, hex) => inEnemyZoc(g, { side: sd }, hex),
  };
}

function damageView(g) {
  const d = g.damage || newDamage();
  const ports = LOCATIONS.filter((l) => l.port && portEff(g, l.id) < portMax(l.id)).map((l) => ({ id: l.id, name: l.name, hex: l.hexes[0], eff: portEff(g, l.id), max: portMax(l.id) }));
  return { ports, roads: Object.keys(d.roads), rails: Object.keys(d.rails), fort: Object.keys(d.fort).map((k) => ({ hex: k, level: fortLevel(d, k.split(',').map(Number)), base: fortBase(k.split(',').map(Number)) })) };
}

function resolveAirPhase(g, orders) {
  g.damage ||= newDamage();
  const map = mapFor(g);
  const ctx = {
    d6: () => d6(g), log: (side, text) => log(g, side, text), map, game: g, portOwners: g.portOwners, damage: g.damage, units: g.units, weapons: WEAPONS,
    turn: g.turn, opStage: g.opStage, firstTurn: scenarioOf(g).firstTurn, holder: g.initiative.holder,
    weatherAt: (hex) => weatherAt(g, hex),
    drawAmmo: (u, n) => draw(g.supply, supplyCtx(g, u.side), u, 'ammo', n),
    supplyUnitsAt: (hex, side) => g.supply.units.filter((x) => x.side === side && x.pos[0] === hex[0] && x.pos[1] === hex[1]),
    supplyAt: (hex, side) => g.supply.units.some((x) => x.side === side && x.pos[0] === hex[0] && x.pos[1] === hex[1]),
  };
  resolveAir(g, orders, ctx);
}

function resolveConvoy(g, o) {
  scheduleConvoys(g.supply, { order: o.axis, turn: g.turn, log: (side, text) => log(g, side, text) });
}

// Reinforcements arrive in the Naval Convoy Arrival Phase of the Operations Stage the schedule names [4.42, 4.43].
// Option `reinforce`: 'historical' (the book's dates), 'early' (two Game-Turns sooner), 'none'.
const reinfTurn = (g, r) => (isStrong(g, r) ? scenarioOf(g).firstTurn : r.turn - (g.options.reinforce === 'early' ? 2 : 0));
// Option `troops: 'strong'`: everything due in the first 12 Game-Turns is already on the map at the start (in Cairo and at El Agheila).
const isStrong = (g, r) => g.options.troops === 'strong' && r.turn < scenarioOf(g).firstTurn + 12;
const reinfStage = (g, r) => (isStrong(g, r) ? 1 : r.stage ?? 1);
function reinforcementArrivals(g) {
  if (g.options.reinforce === 'none') return;
  g.arrived ||= [];
  const now = g.turn * 4 + g.opStage;
  // Due now, or held over from an earlier stage because the port was lost or the hexes were full.
  for (const r of REINFORCEMENTS.filter((x) => reinfTurn(g, x) * 4 + reinfStage(g, x) <= now && !g.arrived.includes(x.unit.id))) {
    if (r.unit.rommel && g.turn > reinfTurn(g, r) + 3) { g.arrived.push(r.unit.id); continue; }
    const p = LOCATIONS.find((x) => x.id === r.location);
    if (g.portOwners[p.id] !== r.unit.side) continue;
    const cands = p.hexes.flatMap(([c, rw]) => [[c, rw], ...neighbours(c, rw)]);
    const spot = cands.find((h) =>
      gameMap().tiles[key(...h)] && gameMap().tiles[key(...h)].t !== 'sea' &&
      !unitsAt(g, h).some((u) => u.side !== r.unit.side) &&
      hexSP(unitsAt(g, h)) + (STACKING_POINTS[r.unit.size] ?? 0) <= stackingLimit(gameMap(), h));
    if (!spot) continue;
    g.arrived.push(r.unit.id);
    g.units.push({ ...structuredClone(r.unit), pos: spot });
    log(g, r.unit.side, `Reinforcements: ${r.unit.name} arrives at ${p.name}.`);
  }
}

// Naval Convoy Arrival Phase [III.D]: convoys due in this Operations Stage are bombed and landed.
function convoyArrivalPhase(g) {
  reinforcementArrivals(g);
  landConvoys(g.supply, gameMap(), {
    units: g.units, turn: g.turn, stage: g.opStage, rollD66: () => d6(g) * 10 + d6(g), portOwners: g.portOwners, portShare: (id) => portEff(g, id) / portMax(id),
    log: (side, text) => log(g, side, text),
  });
}

function resolveTrucks(g, side, o) {
  const err = moveSupply(g.supply, supplyCtx(g, side), side, o.moves || [], (sd, text) => log(g, sd, text));
  if (err) log(g, side, `Supply movement stopped: ${err}`);
}

// What an unseated side does by itself: the Axis sends a full convoy to its best port.
export function autoOrders(g, side) {
  if (g.step === 'air') return autoAirOrders(g, side);
  if (g.step === 'convoy' && side === 'axis' && g.supply.box.axis.length) {
    const ports = PORTS.filter((p) => g.portOwners[p.id] === 'axis').sort((a, b) => b.capacity - a.capacity);
    if (ports.length) return { convoys: [{ port: ports[0].id, route: g.turn <= 2 ? 2 : 3, n: Math.min(MAX_PER_CONVOY_LANE, g.supply.box.axis.length), stage: 1 }] };
  }
  return {};
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
  if (!isCombatUnit(u) || collapsed(u) || u.str <= 0) return false; // [10.11, 10.14]
  const hex = unitsAt(g, u.pos).filter((x) => x.side === u.side && isCombatUnit(x));
  if (rawDefensiveCA(hex) < 10) return false; // too weak to control the surrounding hexes [10.15]
  if ((STACKING_POINTS[u.size] ?? 0) > 1) return true;
  return hexSP(hex) > 1;
}

function zocReaches(g, u, target) {
  if (distance(u.pos, target) !== 1) return false;
  const e = gameMap().hexsides[edgeKey(u.pos, target)];
  if (e && (e.type === 'escarpment' || e.type === 'majorRiver')) return false; // [10.21b]
  if (gameMap().tiles[key(...target)]?.t === 'sea') return false;
  return !!stepCost(mapFor(g), u.pos, target, { motorised: isMotorised(u) }); // [10.21c]
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
  if (g.decision) {
    if (g.decision.side !== side) return `Waiting for the ${side === 'axis' ? 'Commonwealth' : 'Axis'} to respond.`;
    switch (a?.action) {
      case 'react': return actReact(g, side, a);
      case 'endReaction': g.decision = null; return null;
      case 'defend': return actDefend(g, side, a);
      default: return 'Respond to the pending decision first.';
    }
  }
  if (g.step !== 'movecombat' || phasingSide(g) !== side) return 'It is not your Movement & Combat Phase.';
  switch (a?.action) {
    case 'move': return actMove(g, side, a);
    case 'reserve': return actReserve(g, side, a);
    case 'release': return actRelease(g, side, a);
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
export function planMove(g, u, path, { reaction = false } = {}) {
  if (!Array.isArray(path) || !path.length) return 'Empty path.';
  const map = mapFor(g);
  let cp = 0, bp = 0, sandCp = 0;
  const startInZoc = inEnemyZoc(g, u, u.pos);
  if (!reaction && (startInZoc || u.contact)) cp += u.engaged ? CP.disengage : CP.breakContact; // [8.15, 8.24]; reaction pays none [8.52]
  let cur = u.pos;
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (!neighbours(...cur).some(([c, r]) => c === step[0] && r === step[1])) return 'Path is not continuous.';
    if (step[0] < 0 || step[1] < 0 || step[0] >= MAP_COLS || step[1] >= MAP_ROWS) return 'Off the map.';
    if (g.units.some((e) => e.side !== u.side && e.pos[0] === step[0] && e.pos[1] === step[1])) return 'Cannot enter an enemy-occupied hex.';
    const wx = weatherAt(g, step);
    const c = stepCost(map, cur, step, { motorised: isMotorised(u), weather: wx });
    if (!c) return `Cannot enter ${key(...step)} (${TERRAIN[map.tiles[key(...step)]?.t]?.label || 'off map'}).`;
    cp += c.cp; bp += c.bp;
    if (wx === 'sand') sandCp += c.cp;
    const intoZoc = inEnemyZoc(g, u, step);
    if (intoZoc && reaction) return 'Reacting units may not enter an enemy zone of control [8.55].';
    if (intoZoc && i === 0 && startInZoc) return 'Cannot move directly from one enemy-controlled hex to another [10.24].';
    if (intoZoc && i < path.length - 1) return 'Units must stop on entering an enemy zone of control [10.23].';
    cur = step;
  }
  return { cp, bp, sandCp };
}

function actMove(g, side, a) {
  if (g.seg.mode !== 'move') return 'Combat has started in this segment; start a new movement segment first.';
  const u = g.units.find((x) => x.id === a.unitId && x.side === side);
  if (!u) return 'Unknown unit.';
  if (collapsed(u)) return `${u.name} is too disorganised to move (cohesion ${u.cohesion}).`;
  if (g.seg.moved.includes(u.id)) return `${u.name} has already moved this segment.`;
  if (g.seg.frozen.includes(u.id)) return `${u.name} finished a segment more than ${CONTINUAL_MOVE_RANGE} hexes from the enemy and cannot move again this phase [8.23].`;
  if (u.reserve === 2) return `${u.name} is in Reserve II and may not move [18.22].`;
  const plan = planMove(g, u, a.path);
  if (typeof plan === 'string') return plan;
  if (u.reserve === 1) {
    // Reserve I: one hex at no CP cost, never into an enemy-controlled hex [18.22].
    if (a.path.length !== 1) return `${u.name} is in Reserve I and may move only one hex [18.22].`;
    if (inEnemyZoc(g, u, a.path[0])) return `${u.name} is in Reserve and may not enter an enemy-controlled hex [18.22].`;
    plan.cp = 0; plan.bp = 0; plan.sandCp = 0;
  }
  if (u.relCap != null && u.cpUsed + plan.cp > u.relCap) return `${u.name} was released from Reserve ${u.relFrom === 1 ? 'I' : 'II'} and may not voluntarily spend more than ${u.relCap} CP this stage [18.23, 18.24].`;
  if (u.cpa <= 10 && u.cpUsed + plan.cp > u.cpa * NON_MOTORISED_VOLUNTARY_LIMIT) {
    return `${u.name} is on foot and may not voluntarily spend more than ${u.cpa * NON_MOTORISED_VOLUNTARY_LIMIT} CP this stage [8.17].`;
  }
  const err = doMove(g, u, a.path, plan);
  if (err) return err;
  g.seg.moved.push(u.id);
  checkBreakdown(g, u, u.start);
  captureBroken(g, u);
  if (isCombatUnit(u)) { const n = captureAt(g.supply, u.pos, side); if (n) log(g, 'all', `${u.name} captures ${n} supply unit${n > 1 ? 's' : ''}!`); }
  offerReaction(g, u);
  // Totally disorganised enemies surrender when approached [6.26].
  for (const e of g.units.filter((x) => x.side !== side && collapsed(x) && distance(x.pos, u.pos) === 1)) {
    log(g, 'all', `${e.name} surrenders to ${u.name}.`);
    g.prisoners[side] = (g.prisoners[side] || 0) + e.str;
    e.elements = []; syncStr(e);
  }
  removeDestroyed(g);
  updateOwnership(g);
  return null;
}

function doMove(g, u, path, plan) {
  const dest = path.at(-1);
  const stackAfter = hexSP(unitsAt(g, dest).filter((x) => x.side === u.side && x !== u)) + (STACKING_POINTS[u.size] ?? 0);
  if (stackAfter > stackingLimit(gameMap(), dest)) return `Stacking limit exceeded at ${key(...dest)} (${stackAfter}/${stackingLimit(gameMap(), dest)}) [9.31].`;
  // Fuel is paid once per Operations Stage from a supply unit within half the unit's CPA [32.23, 32.16].
  if (!u.fuelPaid) {
    const need = fuelNeed(u);
    if (need && !draw(g.supply, supplyCtx(g, u.side), u, 'fuel', need)) return `${u.name} needs ${need} Fuel from a supply unit within ${u.cpa / 2} CP [32.23].`;
    u.fuelPaid = true;
  }
  spendCP(g, u, plan.cp);
  u.bp += plan.bp;
  u.sandCp = (u.sandCp || 0) + (plan.sandCp || 0);
  u.start = u.pos;
  u.pos = dest;
  u.contact = false;
  u.engaged = false;
  return null;
}

// ---------- Breakdown [21.0] and repair [22.0] ----------
// Tanks break down according to the distance and terrain covered. Trucks and armoured cars are not
// yet modelled at formation level (they come with the truck/logistics rules), so only tank points are checked.
const BROKEN_NAMES = (w) => w;
const TOTAL = (els) => els.reduce((s, e) => s + e.toe, 0);

// Percentage that break down for a group, given base column and shifts [21.32-21.37].
export function breakdownPercent(baseCol, shift, roll) {
  if (baseCol === 0) return 0; // 3 points or fewer: no check [21.27]
  const col = Math.min(8, baseCol + shift);
  if (col < 1) return 0; // adjusted below the 4-10 column: no breakdown [21.33]
  return BREAKDOWN[col][roll] ?? 0;
}

function checkBreakdown(g, u, from) {
  if (!u.motorised || !u.elements?.length) return;
  const base = breakdownColumn(u.bp || 0);
  if (base === 0 || base <= (u.bpCol ?? -1)) return; // only re-check on moving into a higher column [21.26]
  u.bpCol = base;
  const hot = g.weather.type === 'hot' ? 1 : 0;
  const sand = (u.sandCp || 0) * 2 >= Math.max(1, u.cpUsed) && u.sandCp > 0 ? 1 : 0; // [21.37d]
  // One check per group of tank points with the same adjustment rating [21.28].
  const groups = new Map();
  for (const e of u.elements) {
    const w = WEAPONS[e.w];
    if (!w || w.kind !== 'tank' || e.toe <= 0) continue;
    if (!groups.has(w.bdr)) groups.set(w.bdr, []);
    groups.get(w.bdr).push(e);
  }
  for (const [bdr, els] of groups) {
    const total = TOTAL(els);
    const roll = d6(g) * 10 + d6(g);
    const pct = breakdownPercent(base, bdr + hot + sand, roll);
    if (!pct) continue;
    if (total === 1 && pct === 10) continue; // [21.35]
    let n = Math.min(total, Math.ceil((pct / 100) * total - 1e-9));
    // Spread as evenly as possible across the types [21.36].
    const out = els.map((e) => ({ e, n: Math.floor((n * e.toe) / total) }));
    let left = n - out.reduce((x, o) => x + o.n, 0);
    for (const o of [...out].sort((a, b) => (b.e.toe - b.n) - (a.e.toe - a.n))) { if (left <= 0) break; if (o.n < o.e.toe) { o.n++; left--; } }
    // Near a larger enemy force at least half stay where the unit started [21.41].
    const threatened = from && g.units.some((x) => x.side !== u.side && isCombatUnit(x) && sizeRank(x) > 1 && distance(x.pos, from) <= 2);
    let atStart = threatened ? Math.ceil(n / 2) : 0;
    for (const { e, n: k } of out) {
      if (!k) continue;
      const here = Math.max(0, k - Math.min(atStart, k)); atStart -= k - here;
      const there = k - here;
      e.toe -= k;
      if (here) addBroken(g, u, e.w, here, u.pos);
      if (there) addBroken(g, u, e.w, there, from);
      log(g, u.side, `${k} ${e.w} of ${u.name} break down (${pct}% of ${total}).`);
    }
    syncStr(u);
  }
}

function addBroken(g, u, w, n, pos) {
  const m = g.broken.find((b) => b.side === u.side && b.parent === u.id && b.w === w && b.pos[0] === pos[0] && b.pos[1] === pos[1]);
  if (m) m.n += n;
  else g.broken.push({ id: `bd${g.broken.length ? Math.max(...g.broken.map((b) => +b.id.slice(2))) + 1 : 1}`, side: u.side, nation: u.nation, parent: u.id, w, n, pos: [...pos] });
}

// A combat unit of battalion size or larger moving next to enemy broken-down vehicles captures them [21.52-21.54].
function captureBroken(g, u) {
  if (!isCombatUnit(u) || sizeRank(u) < 1) return;
  for (const b of g.broken.filter((x) => x.side !== u.side)) {
    if (distance(b.pos, u.pos) !== 1) continue;
    if (g.units.some((x) => x.side === b.side && x.pos[0] === b.pos[0] && x.pos[1] === b.pos[1])) continue; // stacked with friends [21.53]
    if (!stepCost(mapFor(g), u.pos, b.pos, { motorised: u.motorised })) continue; // adjacent through passable terrain [21.54]
    log(g, 'all', `${u.name} captures ${b.n} broken-down ${b.w} at ${key(...b.pos)}.`);
    b.side = u.side;
  }
}

// Field repair of broken-down tanks in the Repair Phase [22.2]: Broken Down Vehicle Repair Table, Field column.
const FIELD_TANK_PCT = { 1: 25, 2: 10, 3: 10, 4: 10, 5: 0, 6: 0 };
function repairPhase(g, side) {
  for (const b of g.broken.filter((x) => x.side === side && x.n > 0)) {
    const stack = g.units.filter((x) => x.side === side && x.pos[0] === b.pos[0] && x.pos[1] === b.pos[1]);
    if (!stack.length) continue; // needs a friendly unit stacked there [22.22]
    if (inEnemyZoc(g, stack[0], b.pos) || g.units.some((x) => x.side !== side && distance(x.pos, b.pos) === 0)) continue; // enemy-controlled hex [22.13a]
    const wx = weatherAt(g, b.pos);
    if (wx === 'sand' || wx === 'rain') continue; // [22.13d]
    // One Fuel Point per tank point attempted, taken from supply units in the hex [22.26].
    const attempt = drawHere(g.supply, b.pos, side, 'fuel', b.n);
    if (!attempt) continue;
    const pct = FIELD_TANK_PCT[d6(g)];
    if (!pct || (attempt === 1 && pct === 10)) { log(g, side, `Field repair of ${b.w} at ${key(...b.pos)} fails.`); continue; }
    const fixed = Math.min(attempt, Math.ceil((pct / 100) * attempt - 1e-9));
    const parent = g.units.find((x) => x.id === b.parent && x.side === side) || stack.find((x) => isCombatUnit(x));
    if (!parent) continue;
    const el = parent.elements.find((e) => e.w === b.w);
    if (el) el.toe = Math.min(el.max ?? el.toe + fixed, el.toe + fixed); else parent.elements.push({ w: b.w, toe: fixed, max: fixed });
    b.n -= fixed;
    syncStr(parent);
    log(g, side, `${fixed} ${b.w} repaired in the field and returned to ${parent.name}.`);
  }
  g.broken = g.broken.filter((b) => b.n > 0);
}

// ---------- Reaction [8.5] ----------
// When a phasing combat unit moves next to them, eligible non-phasing units may move away.
const sizeRank = (u) => ({ company: 0, battalion: 1, brigade: 2, superBrigade: 3, division: 4 })[u.size] ?? 1;
export function reactionCandidates(g, mover) {
  if (!isCombatUnit(mover)) return [];
  return g.units.filter((u) => {
    if (u.side === mover.side || !isCombatUnit(u) || !u.motorised || collapsed(u) || u.engaged) return false; // [8.53a, d]
    if (distance(u.pos, mover.pos) !== 1) return false;
    // Already pinned in some other enemy ZOC [8.53c].
    const others = g.units.filter((e) => e.side === mover.side && e !== mover && exertsZoc(g, e) && zocReaches(g, e, u.pos));
    if (others.length) return false;
    // A much faster enemy pins slower units, unless it is too small to pin them [8.53b, 8.54].
    // (The board game requires the mover to announce a close assault; here that is assumed.)
    const tooSmall = (sizeRank(mover) <= 1 && sizeRank(u) >= 4) || (sizeRank(mover) === 0 && sizeRank(u) >= 2);
    if (mover.cpa >= u.cpa + 6 && !tooSmall) return false;
    return true;
  });
}

function offerReaction(g, mover) {
  const cands = reactionCandidates(g, mover);
  if (!cands.length) return;
  g.decision = { kind: 'reaction', side: cands[0].side, role: 'front', unitIds: cands.map((u) => u.id), trigger: mover.name, moved: [] };
  log(g, cands[0].side, `${mover.name} moves next to ${cands.map((u) => u.name).join(', ')}: you may react.`);
}

function actReact(g, side, a) {
  const d = g.decision;
  if (d.kind !== 'reaction') return 'No reaction is possible right now.';
  if (!d.unitIds.includes(a.unitId)) return 'That unit cannot react.';
  if (d.moved.includes(a.unitId)) return 'That unit has already reacted.';
  const u = g.units.find((x) => x.id === a.unitId);
  if (!u) return 'Unknown unit.';
  const plan = planMove(g, u, a.path, { reaction: true });
  if (typeof plan === 'string') return plan;
  const err = doMove(g, u, a.path, plan);
  if (err) return err;
  checkBreakdown(g, u, u.start);
  d.moved.push(u.id);
  log(g, 'all', `${u.name} reacts, falling back to ${key(...u.pos)}.`);
  if (d.moved.length >= d.unitIds.length) g.decision = null;
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
    const threatened = g.units.filter((u) => u.side === side && isCombatUnit(u) && !u.reserve && zocReaches(g, e, u.pos));
    if (threatened.length) out.push({ enemy: e, threatened });
  }
  return out;
}
// An obligation to attack is waived when none of the units it binds are able to attack that hex: next to it, not collapsed,
// not barred by the terrain or Reserve rules, and with at least the Ammo for a probe in reach [10.31 "if able", 32.21].
function whyCannotAttack(g, side, u, enemy) {
  if (distance(u.pos, enemy.pos) !== 1) return 'not adjacent';
  if (collapsed(u)) return 'too disorganised';
  if (u.reserve) return 'in Reserve';
  if (u.relFrom && (u.assaults || 0) >= 1) return 'already attacked out of Reserve';
  const map = gameMap();
  const e = map.hexsides[edgeKey(u.pos, enemy.pos)];
  if (u.motorised && e?.type === 'escarpment' && e.down === key(...u.pos)) return 'cannot assault up an escarpment';
  if (u.motorised && map.tiles[key(...enemy.pos)].t === 'saltmarsh') return 'cannot assault into a salt marsh';
  const have = suppliesInRange(g.supply, supplyCtx(g, side), u).reduce((t, x) => t + x.ammo, 0);
  if (have < ammoCost(u, true, { probe: true })) return 'no ammunition in reach';
  return null;
}
export const canMeetObligation = (g, side, o) => o.threatened.some((u) => !whyCannotAttack(g, side, u, o.enemy));
function unmetAttackObligations(g, side) {
  const unmet = attackObligations(g, side).filter((o) => !g.seg.attacked.includes(key(...o.enemy.pos)) && canMeetObligation(g, side, o));
  if (!unmet.length) return null;
  return `Units in an enemy zone of control must attack it before the segment ends [10.31]: ${unmet.map((o) => o.enemy.name).join(', ')}.`;
}

// ---------- Reserve [18.0] ----------
// Reserve Designation Phase: before anything has moved in the Phase, the phasing player may place units in Reserve I [18.11, 18.12, 18.15].
function actReserve(g, side, a) {
  if (g.seg.n !== 1 || g.seg.mode !== 'move' || g.seg.moved.length) return 'Units can only be placed in Reserve in the Reserve Designation Phase, before the Phase\'s first movement [18.15].';
  let n = 0;
  for (const id of a.unitIds || []) {
    const u = g.units.find((x) => x.id === id && x.side === side);
    if (!u) return 'Unknown unit.';
    if (!isCombatUnit(u)) return `${u.name} is not a combat unit.`;
    if (collapsed(u)) return `${u.name} is too disorganised to be held in Reserve.`;
    u.reserve = a.off ? 0 : 1;
    n++;
  }
  if (n) log(g, side, `${n} unit${n > 1 ? 's' : ''} ${a.off ? 'taken out of' : 'placed in'} Reserve.`);
  return null;
}

// Reserve Release Segment, after a Combat Segment [18.23, 18.24, 18.25].
function actRelease(g, side, a) {
  if (g.seg.mode !== 'combat') return 'Units are released in the Reserve Release Segment, after the Combat Segment.';
  const released = [];
  for (const id of a.unitIds || []) {
    const u = g.units.find((x) => x.id === id && x.side === side);
    if (!u || !u.reserve) return 'That unit is not in Reserve.';
    if (u.reserve === 2 && g.seg.n === 1) return `${u.name} is in Reserve II and can only be released in a later Reserve Release Segment [18.24].`;
    u.relFrom = u.reserve;
    u.relCap = u.reserve === 1 ? u.cpa : Math.floor(u.cpa / 2);
    u.reserve = 0;
    g.seg.frozen = g.seg.frozen.filter((x) => x !== u.id); // may move next segment even if far from the enemy [18.25]
    released.push(u.name);
  }
  if (released.length) log(g, side, `Released from Reserve: ${released.join(', ')}.`);
  return null;
}

function actNextSegment(g, side) {
  if (g.seg.mode === 'combat') {
    const err = unmetAttackObligations(g, side);
    if (err) return err;
  }
  // Units still in Reserve I after the first Reserve Release Segment go to Reserve II [18.13].
  if (g.seg.n === 1) for (const u of g.units) if (u.side === side && u.reserve === 1) u.reserve = 2;
  freezeAfterSegment(g);
  g.seg = { n: g.seg.n + 1, mode: 'move', moved: [], attacked: [], frozen: g.seg.frozen };
  for (const u of g.units) if (u.side === side) u.contact = inEnemyZoc(g, u, u.pos);
  return null;
}

// Combat [11.0-15.0]: one assault on one enemy hex per segment [15.23], full procedure in combat.js.
function actAttack(g, side, a) {
  if (g.seg.mode !== 'combat') return 'Finish movement and start the combat segment first.';
  const target = g.units.find((x) => x.id === a.targetId && x.side !== side);
  if (!target) return 'Unknown target.';
  const targetPos = target.pos;
  if (g.seg.attacked.includes(key(...targetPos))) return 'That hex has already been attacked this segment [15.23].';
  const attackers = (a.attackerIds || []).map((id) => g.units.find((x) => x.id === id && x.side === side)).filter(Boolean);
  if (!attackers.length) return 'Choose at least one attacking unit.';
  const map = gameMap();
  for (const u of attackers) {
    if (distance(u.pos, targetPos) !== 1) return `${u.name} is not adjacent to ${target.name}.`;
    if (collapsed(u)) return `${u.name} is too disorganised to attack.`;
    if (u.reserve) return `${u.name} is in Reserve and cannot attack until released [18.2].`;
    if (u.relFrom && (u.assaults || 0) >= 1) return `${u.name} came out of Reserve and may make only one offensive assault this Operations Stage [18.23, 18.24].`;
    if (!isCombatUnit(u)) return `${u.name} is not a combat unit.`;
    const e = map.hexsides[edgeKey(u.pos, targetPos)];
    if (u.motorised && e?.type === 'escarpment' && e.down === key(...u.pos)) return `${u.name} is motorised and cannot assault up an escarpment [15.34].`;
    if (u.motorised && map.tiles[key(...targetPos)].t === 'saltmarsh') return `${u.name} is motorised and cannot assault into a salt marsh [8.44].`;
  }
  // Ammunition is spent at the instant of combat from supply units within half the CPA [32.21, 32.22].
  const snap = JSON.parse(JSON.stringify(g.supply.units));
  const sctx = supplyCtx(g, side);
  for (const u of attackers) {
    const cost = ammoCost(u, true, { probe: !!a.probe });
    if (!draw(g.supply, sctx, u, 'ammo', cost)) {
      g.supply.units = snap;
      const have = Math.floor(suppliesInRange(g.supply, sctx, u).reduce((t, x) => t + x.ammo, 0));
      const why = have ? `only ${have} in reach` : (supplyDiagnosis(g.supply, sctx, u, { needAmmo: true, ammoNeed: cost }) || 'none in reach');
      return `${u.name} needs ${cost} Ammo to ${a.probe ? 'probe' : 'attack'} (${why}). ${a.probe ? '' : 'A probe costs only 2. '}Supply units must be within ${u.cpa / 2} CP [32.21].`;
    }
    u.ammo = 1;
  }
  for (const u of attackers) {
    if (!u.relFrom) continue;
    u.assaults = (u.assaults || 0) + 1;
    if (u.relFrom === 2 && !u.resDp) { u.cohesion -= 1; u.resDp = true; } // one Disorganization Point [18.24 (3)]
  }
  // The hex counts as attacked from now on [15.23]; the defender now makes its choices [12.1, 13.0, 14.0].
  g.seg.attacked.push(key(...targetPos));
  const defenders = unitsAt(g, targetPos).filter((u) => u.side !== side);
  g.decision = {
    kind: 'defence', side: defenders[0].side, role: 'front',
    attack: { attackerIds: attackers.map((u) => u.id), targetPos, targetName: target.name, probe: !!a.probe, artilleryForward: a.artilleryForward !== false, tankRole: a.tankRole || 'assault' },
    defenderIds: defenders.map((u) => u.id),
  };
  log(g, 'all', `${attackers.map((u) => u.name).join(', ')} ${a.probe ? 'probe' : 'attack'} ${target.name}${defenders.length > 1 ? ' and the units with it' : ''}. Awaiting the defender's dispositions.`);
  return null;
}

// Defender's dispositions, then the full combat procedure.
// a: { artilleryForward: bool, tankRole: 'antiArmour'|'assault', retreat: [unitIds] (retreat before assault if not pinned) }
function actDefend(g, side, a = {}) {
  const d = g.decision;
  if (d.kind !== 'defence') return 'No attack is waiting for your response.';
  g.decision = null;
  const atk = d.attack;
  const attackers = atk.attackerIds.map((id) => g.units.find((x) => x.id === id)).filter((u) => u && u.str > 0);
  const phasing = attackers[0]?.side;
  const map = mapFor(g);
  g.seg.paid ||= {};
  // A phasing unit pays combat CP at most once per segment (5), a defender at most 3 [11.24].
  const spend = (u, cp) => {
    const already = g.seg.paid[u.id] || 0;
    const cap = u.side === phasing ? 5 : 3;
    const pay = Math.max(0, Math.min(cp, cap - already));
    g.seg.paid[u.id] = already + pay;
    if (pay) spendCP(g, u, pay);
  };
  const ctx = {
    map,
    d6: () => d6(g),
    d66: () => d6(g) * 10 + d6(g),
    spendCP: spend,
    inEnemyZoc,
    log: (t) => log(g, 'all', t),
  };
  ctx.fortLevel = (h) => (map.tiles[key(...h)]?.t === 'majorcity' ? fortLevel(g.damage, h) : 0);
  ctx.retreatUnits = makeRetreat(g, { map, spendCP: (u, cp) => spendCP(g, u, cp), inEnemyZoc });
  if (!attackers.length) return null;
  const defOpts = {
    artilleryForward: !!a.artilleryForward,
    tankRole: a.tankRole === 'assault' ? 'assault' : 'antiArmour',
    retreat: new Set((a.retreat || []).filter((id) => d.defenderIds.includes(id))),
  };
  // Defenders spend ammunition too; a unit that cannot pay cannot fire its guns [32.21].
  const sctx = supplyCtx(g, d.side);
  for (const id of d.defenderIds) {
    const u = g.units.find((x) => x.id === id);
    if (!u) continue;
    const paid = draw(g.supply, sctx, u, 'ammo', ammoCost(u, false, { barrage: !!a.artilleryForward }));
    u.ammo = paid ? 1 : 0;
    if (!paid && a.artilleryForward) { defOpts.artilleryForward = false; log(g, 'all', `${u.name} has no ammunition and cannot fire.`); }
  }
  const res = resolveCombat(g, ctx, attackers, atk.targetPos, { probe: atk.probe, artilleryForward: atk.artilleryForward, tankRole: atk.tankRole, defence: defOpts });
  g.lastCombat = { turn: g.turn, stage: g.opStage, lines: res.lines, title: `${attackers.map((u) => u.name).join(', ')} → ${atk.targetName}` };
  removeDestroyed(g);
  if (res.defendersCleared && !res.vacatedBeforeAssault) for (const u of attackers.filter((x) => x.str > 0)) earnRP(u, VICTORY_RP); // [6.24.2]
  updateOwnership(g);
  return null;
}

// Default answers for a side with nobody seated, or when the host forces things along.
export function autoDecide(g) {
  const d = g.decision;
  if (!d) return;
  if (d.kind === 'reaction') { g.decision = null; return; }
  const own = d.defenderIds.map((id) => g.units.find((x) => x.id === id)).filter(Boolean);
  actDefend(g, d.side, { artilleryForward: false, tankRole: own.some((u) => u.type === 'arm') ? 'antiArmour' : 'assault', retreat: [] });
}

function removeDestroyed(g) {
  for (const u of g.units) if (u.elements) syncStr(u);
  const gone = g.units.filter((x) => x.str <= 0 && x.type !== 'hq');
  for (const u of gone) log(g, 'all', `${u.name} has been destroyed or captured.`);
  g.units = g.units.filter((x) => !gone.includes(x));
}

function updateOwnership(g) {
  for (const l of LOCATIONS) {
    const here = l.hexes.flatMap((h) => unitsAt(g, h)).filter((u) => isCombatUnit(u));
    if (here.length && here.every((u) => u.side !== g.portOwners[l.id])) {
      g.portOwners[l.id] = here[0].side;
      log(g, 'all', `${l.name} has been taken by the ${here[0].side === 'axis' ? 'Axis' : 'Commonwealth'}.`);
    }
  }
}

// ---------- End of Game-Turn ----------

function endGameTurn(g) {
  removeDestroyed(g);


}

// ---------- Views (fog of war) ----------

// Reach is recomputed only when something that could change it has (units cannot move during the trucks phase).
const reachCache = new WeakMap();
function cachedSupplyReach(g, sctx, side, x) {
  const stamp = `${g.turn}:${g.opStage}:${g.half}:${g.supply.units.length}:${g.units.length}:${x.pos}:${g.weather?.type}`;
  let m = reachCache.get(g);
  if (!m || m.stamp !== stamp.split(':').slice(0, 4).join(':')) { m = { stamp: stamp.split(':').slice(0, 4).join(':'), by: new Map() }; reachCache.set(g, m); }
  const k = `${x.id}:${x.pos}:${g.units.length}`;
  if (!m.by.has(k)) m.by.set(k, supplyReach(g.supply, sctx, side, x.pos));
  return m.by.get(k);
}

// Air Game stage 1: your own squadrons and every air facility you can see (your own, or enemy ones within sight).
function airView(g, side, seen) {
  g.air ||= createAir(); // saves from before the Air Game
  const fac = (f) => ({ id: f.id, name: f.name, kind: f.kind, owner: f.owner, cap: f.cap, used: f.used, hex: f.hex, off: !!f.off, own: f.owner === side });
  return {
    facilities: g.air.facilities.filter((f) => f.owner === side || (f.hex && seen(facilityHex(f)))).map(fac),
    squadrons: g.air.squadrons.filter((s) => s.side === side).map(summariseSquadron),
    pilots: g.air.pilots[side], sgsu: g.air.sgsu[side], stock: g.air.stock?.[side] || null,
  };
}

export function viewFor(g, side, roles = null) {
  return applyAccess(buildView(g, side), accessFor(roles), side);
}

function buildView(g, side) {
  const own = g.units.filter((u) => u.side === side);
  const seen = (pos) => own.some((u) => distance(u.pos, pos) <= VISION_RANGE);
  const enemy = g.units
    .filter((u) => u.side !== side && seen(u.pos))
    .map(({ id, side: s, nation, name, type, size, str, pos }) => ({ id, side: s, nation, name, type, size, str, pos }));
  const sctx = supplyCtx(g, side);
  // During the Truck Convoy Phase each of the phasing side's supply units shows where it may go (15 CP, as a medium truck).
  const showReach = g.step === 'trucks' && phasingSide(g) === side;
  const supply = g.supply.units.filter((x) => x.side === side).map((x) => ({
    id: x.id, side, pos: x.pos, ammo: x.ammo, fuel: x.fuel, moved: !!x.moved, own: true,
    ...(showReach && !x.moved ? { reach: cachedSupplyReach(g, sctx, side, x) } : {}),
  }));
  for (const x of g.supply.units.filter((y) => y.side !== side && seen(y.pos))) supply.push({ id: x.id, side: x.side, pos: x.pos, own: false });
  const ownView = own.map((u) => {
    const src = suppliesInRange(g.supply, sctx, u);
    const need = u.fuelPaid ? 0 : fuelNeed(u), fuel = src.reduce((a, x) => a + x.fuel, 0), ammo = src.reduce((a, x) => a + x.ammo, 0);
    const ammoNeed = isCombatUnit(u) ? ammoCost(u, true) : 0;
    const lacking = { needFuel: need > fuel, needAmmo: ammoNeed > ammo, ammoNeed };
    return {
      ...u, fuelNeed: need, fuelAvail: fuel, ammoAvail: ammo, ammoNeed,
      ...((lacking.needFuel || lacking.needAmmo) ? { supplyNote: supplyDiagnosis(g.supply, sctx, u, lacking) } : {}),
    };
  });
  const obligations = g.step === 'movecombat' && phasingSide(g) === side
    ? attackObligations(g, side).filter((o) => seen(o.enemy.pos)).map((o) => ({ enemyId: o.enemy.id, hex: key(...o.enemy.pos), met: g.seg.attacked.includes(key(...o.enemy.pos)), cannot: !canMeetObligation(g, side, o) }))
    : [];
  return {
    turn: g.turn,
    date: turnDate(g.turn),
    lastTurn: scenarioOf(g).lastTurn,
    scenario: scenarioOf(g).name,
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
    units: [...ownView, ...enemy],
    supply,
    air: airView(g, side, seen),
    damage: damageView(g),
    lastAir: g.lastAir ? {
      n: g.lastAir.n, turn: g.lastAir.turn, stage: g.lastAir.stage,
      // The enemy's bases stay hidden; their flights show only where they went and what happened.
      flights: g.lastAir.flights.map((f) => (f.side === side ? f : { ...f, from: null, name: 'Enemy squadron', failed: undefined })).filter((f) => f.side === side || !f.failed && f.sent > 0),
    } : null,
    box: side === 'axis' ? g.supply.box.axis.length : 0,
    plan: g.supply.plan.filter((p) => p.side === side).map(({ turn, n }) => ({ turn, n })),
    atSea: side === 'axis' ? (g.supply.convoys || []).map((c) => ({ turn: c.turn, stage: c.stage, port: c.port, route: c.route, n: c.units.length })) : [],
    victory: victoryStatus(g),
    convoyLevel: side === 'axis' ? axisConvoyLevel(g.turn) : null,
    supplyPeriod: side === 'cw' ? cwSupplyPeriod(g.turn) : null,
    portOwners: g.portOwners,
    options: g.options,
    obligations,
    decision: g.decision ? { ...g.decision, mine: g.decision.side === side } : null,
    lastCombat: g.lastCombat,
    prisoners: g.prisoners,
    weather: g.weather,
    broken: g.broken.filter((b) => b.side === side || seen(b.pos)).map(({ id, side: s, nation, w, n, pos }) => ({ id, side: s, nation, w, n, pos })),
    winner: g.winner,
    over: g.over,
    log: g.log.filter((l) => l.side === 'all' || l.side === side).slice(-100),
  };
}

// Role-limited views: each staff seat sees mostly its own area, so teammates have to share what they know.
const BASIC_UNIT = ['id', 'side', 'nation', 'name', 'type', 'size', 'str', 'maxStr', 'pos'];
const SUPPLY_UNIT = ['fuelNeed', 'fuelAvail', 'ammoAvail', 'ammoNeed', 'supplyNote'];
function applyAccess(v, acc, side) {
  v.access = acc;
  if (acc.unitDetail < 2) {
    const keep = acc.unitDetail === 1 ? [...BASIC_UNIT, ...SUPPLY_UNIT] : BASIC_UNIT;
    v.units = v.units.map((u) => (u.side !== side ? u : Object.fromEntries(keep.filter((k) => k in u).map((k) => [k, u[k]]))));
  }
  const mine = v.supply.filter((x) => x.own);
  if (acc.supply < 2) {
    v.supplyTotals = acc.supply === 1 ? { units: mine.length, ammo: mine.reduce((n, x) => n + x.ammo, 0), fuel: mine.reduce((n, x) => n + x.fuel, 0) } : null;
    v.supply = v.supply.filter((x) => !x.own).concat(acc.supply === 1 ? mine.map(({ id, side: sd, pos, own }) => ({ id, side: sd, pos, own })) : []);
  }
  if (acc.convoys < 2) {
    v.plan = []; v.convoyLevel = null; v.supplyPeriod = null;
    if (acc.convoys === 0) { v.box = null; v.atSea = []; }
  }
  if (acc.air < 2 && v.air) {
    v.air = acc.air === 1
      ? { summary: true, totals: { squadrons: v.air.squadrons.length, planes: v.air.squadrons.reduce((n, q) => n + q.total, 0), ready: v.air.squadrons.reduce((n, q) => n + q.ready, 0) }, squadrons: [], facilities: [], pilots: v.air.pilots, sgsu: v.air.sgsu, stock: null }
      : null;
  }
  return v;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
