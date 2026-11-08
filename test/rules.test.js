// Unit tests for rules implemented from the rulebook (engine level, no networking).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, submitOrders, act, planMove, inEnemyZoc, actingSides, gameMap, viewFor } from '../src/server/engine.js';
import { turnDate, initiativeRating, stepCost, edgeKey } from '../src/shared/rules.js';
import { key, distance, neighbours } from '../src/shared/hex.js';
import { hexFromName, nameOfHex } from '../src/shared/hexnames.js';

const toMoveCombat = (g) => {
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {}); // convoy
  submitOrders(g, g.initiative.holder, { goFirst: true }); // declare
};

test('turn dates follow the turn record track', () => {
  assert.equal(turnDate(1), 'Sep III 1940');
  assert.equal(turnDate(2), 'Sep IV 1940');
  assert.equal(turnDate(3), 'Oct I 1940');
  assert.equal(turnDate(15), 'Jan I 1941');
});

test('initiative ratings chart', () => {
  assert.equal(initiativeRating('cw', { gt: 10 }), 3);
  assert.equal(initiativeRating('cw', { gt: 43 }), 4);
  assert.equal(initiativeRating('cw', { gt: 100 }), 5);
  assert.equal(initiativeRating('axis', { gt: 30, rommelOnMap: true }), 6);
  assert.equal(initiativeRating('axis', { gt: 30, germanCombatOnMap: true }), 3);
  assert.equal(initiativeRating('axis', { gt: 1 }), 1);
});

test('sequence of play: naval stage, declaration, A then B, three ops stages, next game-turn', () => {
  const g = createGame({ seed: 1 });
  assert.equal(g.turn, 1);
  assert.equal(g.initiative.holder, 'axis'); // scenario rule for GT1
  assert.equal(g.step, 'convoy');
  toMoveCombat(g);
  assert.equal(g.opStage, 1);
  assert.equal(g.step, 'movecombat');
  assert.deepEqual(g.order, { A: 'axis', B: 'cw' });
  assert.deepEqual(actingSides(g), ['axis']);
  assert.match(act(g, 'cw', { action: 'endPhase' }), /not your/);
  for (let stage = 1; stage <= 3; stage++) {
    if (stage > 1) submitOrders(g, 'axis', { goFirst: stage !== 2 });
    const order = g.order;
    assert.equal(act(g, order.A, { action: 'endPhase' }), null);
    assert.equal(g.step, 'trucks');
    submitOrders(g, order.A, {});
    assert.equal(g.half, 'B');
    act(g, order.B, { action: 'endPhase' });
    submitOrders(g, order.B, {});
  }
  assert.equal(g.turn, 2);
  assert.equal(g.step, 'convoy');
  assert.ok(g.initiative.rolls, 'GT2 initiative is rolled');
});

test('terrain effects on the real map: roads, escarpments, salt marsh', () => {
  const map = gameMap();
  const edge = (ek) => ek.split('|').map((k) => k.split(',').map(Number));
  const [ra, rb] = edge([...map.roads][0]);
  assert.deepEqual(stepCost(map, ra, rb, { motorised: true }), { cp: 0.5, bp: 0.5, via: 'road' });
  assert.equal(stepCost(map, ra, rb, { motorised: false }).cp, 1);
  // An escarpment not crossed by a road or track: vehicles can't use it either way; foot pays +6 going up.
  const [ek, esc] = Object.entries(map.hexsides).find(([k, h]) => h.type === 'escarpment' && !map.roads.has(k) && !map.tracks.has(k) &&
    edge(k).every((h2) => ['clear', 'gravel'].includes(map.tiles[key(...h2)]?.t)));
  const [a, b] = edge(ek);
  const down = esc.down === key(...a) ? a : b, up = down === a ? b : a;
  assert.equal(stepCost(map, down, up, { motorised: true }), null, 'vehicles cannot climb an escarpment');
  assert.equal(stepCost(map, up, down, { motorised: true }), null, 'vehicles go down escarpments only by track');
  assert.equal(stepCost(map, down, up, { motorised: false }).cp, 2 + 6);
  // Salt marsh is closed to vehicles off-road.
  const sm = Object.keys(map.tiles).find((k) => map.tiles[k].t === 'saltmarsh');
  const smHex = sm.split(',').map(Number);
  const from = [[smHex[0], smHex[1] - 1], [smHex[0], smHex[1] + 1]].find((h) => map.tiles[key(...h)] && map.tiles[key(...h)].t !== 'sea' && !map.roads.has(edgeKey(h, smHex)) && !map.tracks.has(edgeKey(h, smHex)));
  assert.equal(stepCost(map, from, smHex, { motorised: true }), null);
  assert.equal(stepCost(map, from, smHex, { motorised: false }) && stepCost(map, from, smHex, { motorised: false }).cp >= 3, true);
});

test('board hex names map onto the grid', () => {
  assert.deepEqual(hexFromName('C4807'), [47, 72]);
  assert.deepEqual(hexFromName('A0134'), hexFromName('B0101'), 'row 34 of one section is row 01 of the next');
  assert.equal(nameOfHex(...hexFromName('E3613')), 'E3613');
  assert.equal(gameMap().tiles[key(...hexFromName('C4807'))].t, 'majorcity', 'Tobruk');
});

test('capability points, disorganisation and the 150% foot limit', () => {
  const g = createGame({ seed: 1 });
  toMoveCombat(g);
  const u = g.units.find((x) => x.id === 'it-62'); // foot, CPA 10
  // Find a run of 8 connected road/track hexes away from everyone (1 CP per hex on foot either way).
  const map = gameMap();
  const adj = new Map();
  for (const ek of [...map.roads, ...map.tracks]) {
    const [a, b] = ek.split('|');
    if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b); adj.get(b).push(a);
  }
  let path = null;
  for (const start of adj.keys()) {
    const p = [start]; const seen = new Set(p);
    while (p.length < 9) { const nx = (adj.get(p.at(-1)) || []).find((n) => !seen.has(n)); if (!nx) break; p.push(nx); seen.add(nx); }
    const free = p.every((k) => !g.units.some((x) => key(...x.pos) === k || distance(x.pos, k.split(',').map(Number)) <= 1));
    if (p.length === 9 && free) { path = p.map((k) => k.split(',').map(Number)); break; }
  }
  u.pos = path[0];
  const route = path.slice(1); // 8 road hexes = 8 CP on foot
  u.cpUsed = 8;
  assert.match(act(g, 'axis', { action: 'move', unitId: u.id, path: route }), /may not voluntarily spend more than 15/);
  assert.equal(act(g, 'axis', { action: 'move', unitId: u.id, path: route.slice(0, 7) }), null);
  assert.equal(u.cpUsed, 15);
  assert.equal(u.cohesion, -5, '5 CP over a CPA of 10 = 5 Disorganisation Points');
});

test('zones of control: stop on entry, no ZOC-to-ZOC, mandatory attack', () => {
  const g = createGame({ seed: 1 });
  toMoveCombat(g);
  const mal = g.units.find((x) => x.id === 'it-mal');
  const arm = g.units.find((x) => x.id === 'cw-7arm');
  // Put the 7th Armoured two hexes east of Maletti on open ground for a clean test.
  arm.pos = [mal.pos[0] + 2, mal.pos[1]];
  for (const h of [mal.pos, [mal.pos[0] + 1, mal.pos[1]], arm.pos]) gameMap().tiles[key(...h)].t = 'clear';
  g.supply.units.push({ id: 'T-ax', side: 'axis', pos: [...mal.pos], ammo: 40, fuel: 60 });
  g.supply.units.push({ id: 'T-cw', side: 'cw', pos: [...arm.pos], ammo: 40, fuel: 60 });
  const between = [mal.pos[0] + 1, mal.pos[1]];
  assert.equal(inEnemyZoc(g, mal, between), true);
  const beyond = [mal.pos[0] + 1, mal.pos[1] + 1];
  const err = planMove(g, mal, [between, beyond]);
  assert.match(err, /stop on entering/);
  arm.engaged = true; // keep it from reacting away for this test
  assert.equal(act(g, 'axis', { action: 'move', unitId: mal.id, path: [between] }), null);
  act(g, 'axis', { action: 'toCombat' });
  assert.match(act(g, 'axis', { action: 'endPhase' }), /must attack/);
  assert.equal(act(g, 'axis', { action: 'attack', targetId: arm.id, attackerIds: [mal.id] }), null);
  assert.deepEqual(actingSides(g), ['cw'], 'the defender now chooses its dispositions');
  assert.match(act(g, 'axis', { action: 'endPhase' }), /Waiting/);
  assert.equal(act(g, 'cw', { action: 'defend', tankRole: 'antiArmour' }), null);
  assert.ok(mal.cpUsed >= 5, 'assault costs the phasing unit 5 CP');
  assert.equal(act(g, 'axis', { action: 'endPhase' }), null);
});

test('a mandatory attack is waived when no unit can make it (no ammunition in reach)', () => {
  const g = createGame({ seed: 1 });
  toMoveCombat(g);
  const mal = g.units.find((x) => x.id === 'it-mal');
  const arm = g.units.find((x) => x.id === 'cw-7arm');
  arm.pos = [mal.pos[0] + 2, mal.pos[1]];
  for (const h of [mal.pos, [mal.pos[0] + 1, mal.pos[1]], arm.pos]) gameMap().tiles[key(...h)].t = 'clear';
  g.supply.units.push({ id: 'T-ax', side: 'axis', pos: [...mal.pos], ammo: 0, fuel: 60 });
  g.supply.units.push({ id: 'T-cw', side: 'cw', pos: [...arm.pos], ammo: 40, fuel: 60 });
  for (const x of g.supply.units.filter((y) => y.side === 'axis')) x.ammo = 0;
  arm.engaged = true;
  assert.equal(act(g, 'axis', { action: 'move', unitId: mal.id, path: [[mal.pos[0] + 1, mal.pos[1]]] }), null);
  act(g, 'axis', { action: 'toCombat' });
  const ob = viewFor(g, 'axis').obligations;
  assert.ok(ob.length && ob.every((o) => o.cannot), 'the obligation is shown as waived');
  assert.equal(act(g, 'axis', { action: 'endPhase' }), null, 'with no ammunition the phase can end');
});

test('reaction: a motorised unit may slip away from a slower approaching enemy [8.5]', () => {
  const g = createGame({ seed: 1 });
  toMoveCombat(g);
  const inf = g.units.find((x) => x.id === 'it-1cc'); // foot, CPA 10
  const arm = g.units.find((x) => x.id === 'cw-7arm'); // CPA 25
  arm.pos = [inf.pos[0] + 2, inf.pos[1]];
  g.supply.units.push({ id: 'T-cw', side: 'cw', pos: [...arm.pos], ammo: 40, fuel: 60 });
  for (const h of [inf.pos, [inf.pos[0] + 1, inf.pos[1]], arm.pos, [arm.pos[0] + 1, arm.pos[1]], [arm.pos[0] + 2, arm.pos[1]]]) gameMap().tiles[key(...h)] = { t: 'clear' };
  for (const ek of Object.keys(gameMap().hexsides)) if ([inf.pos, arm.pos].some((h) => ek.includes(key(...h)))) delete gameMap().hexsides[ek];
  assert.equal(act(g, 'axis', { action: 'move', unitId: inf.id, path: [[inf.pos[0] + 1, inf.pos[1]]] }), null);
  assert.equal(g.decision?.kind, 'reaction');
  assert.deepEqual(actingSides(g), ['cw']);
  const shared = neighbours(...arm.pos).find((h) => neighbours(...inf.pos).some((n) => key(...n) === key(...h)));
  gameMap().tiles[key(...shared)] = { t: 'clear' };
  assert.match(act(g, 'cw', { action: 'react', unitId: arm.id, path: [shared] }), /zone of control/);
  const cpBefore = arm.cpUsed;
  assert.equal(act(g, 'cw', { action: 'react', unitId: arm.id, path: [[arm.pos[0] + 1, arm.pos[1]], [arm.pos[0] + 2, arm.pos[1]]] }), null);
  assert.equal(g.decision, null, 'all reacting units used: back to the phasing player');
  assert.equal(arm.cpUsed - cpBefore, 4, 'reaction costs movement CP but no break-off cost');
});

test('reaction is blocked when the enemy is 6+ CPA faster [8.53b]', () => {
  const g = createGame({ seed: 1 });
  toMoveCombat(g);
  const fast = g.units.find((x) => x.id === 'it-mal'); fast.cpa = 30;
  const slow = g.units.find((x) => x.id === 'cw-7arm'); // CPA 25 -> 30 >= 31? no; make it 20
  slow.cpa = 20;
  slow.pos = [fast.pos[0] + 2, fast.pos[1]];
  for (const h of [fast.pos, [fast.pos[0] + 1, fast.pos[1]], slow.pos]) gameMap().tiles[key(...h)] = { t: 'clear' };
  for (const ek of Object.keys(gameMap().hexsides)) if ([fast.pos, slow.pos].some((h) => ek.includes(key(...h)))) delete gameMap().hexsides[ek];
  act(g, 'axis', { action: 'move', unitId: fast.id, path: [[fast.pos[0] + 1, fast.pos[1]]] });
  assert.equal(g.decision, null);
});
