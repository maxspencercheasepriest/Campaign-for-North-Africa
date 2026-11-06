// Unit tests for rules implemented from the rulebook (engine level, no networking).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, submitOrders, act, planMove, inEnemyZoc, actingSides, gameMap } from '../src/server/engine.js';
import { turnDate, initiativeRating, stepCost, edgeKey } from '../src/shared/rules.js';
import { key } from '../src/shared/hex.js';

const toMoveCombat = (g) => {
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {}); // air
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
  const g = createGame();
  assert.equal(g.turn, 1);
  assert.equal(g.initiative.holder, 'axis'); // scenario rule for GT1
  assert.equal(g.step, 'air');
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
  assert.equal(g.step, 'air');
  assert.ok(g.initiative.rolls, 'GT2 initiative is rolled');
});

test('terrain effects: roads, tracks, escarpments, salt marsh', () => {
  const map = gameMap();
  const road = [...map.roads][0].split('|').map((k) => k.split(',').map(Number));
  assert.deepEqual(stepCost(map, road[0], road[1], { motorised: true }), { cp: 0.5, bp: 0.5, via: 'road' });
  assert.equal(stepCost(map, road[0], road[1], { motorised: false }).cp, 1);
  // Escarpment at column 48: north (down) side is row 4, south (up) side row 5.
  const down = [48, 4], up = [48, 5];
  assert.equal(map.hexsides[edgeKey(up, down)].type, 'escarpment');
  assert.equal(stepCost(map, down, up, { motorised: true }), null, 'vehicles cannot climb an escarpment');
  assert.equal(stepCost(map, down, up, { motorised: false }).cp, (map.tiles[key(...up)].t === 'clear' || map.tiles[key(...up)].t === 'gravel' ? 2 : 3) + 6);
  assert.equal(stepCost(map, up, down, { motorised: true }), null, 'vehicles go down escarpments only by track');
  // Sollum track down the escarpment at column 46.
  assert.equal(stepCost(map, [46, 5], [46, 4], { motorised: true }).cp, 1 + 8);
  assert.equal(stepCost(map, [46, 4], [46, 5], { motorised: true }), null);
  // Qattara salt marsh is closed to vehicles off-road.
  assert.equal(stepCost(map, [56, 9], [56, 10], { motorised: true }), null);
  assert.equal(stepCost(map, [56, 9], [56, 10], { motorised: false }).cp, 3);
});

test('capability points, disorganisation and the 150% foot limit', () => {
  const g = createGame();
  toMoveCombat(g);
  const u = g.units.find((x) => x.id === 'it-pav'); // foot, CPA 8
  u.pos = [2, 3]; // Tripoli, on the coast road
  const path = [3, 4, 5, 6, 7, 8, 9, 10].map((c) => [c, 3]); // 8 road hexes = 8 CP on foot
  u.cpUsed = 5;
  assert.match(act(g, 'axis', { action: 'move', unitId: u.id, path }), /may not voluntarily spend more than 12/);
  assert.equal(act(g, 'axis', { action: 'move', unitId: u.id, path: path.slice(0, 7) }), null);
  assert.equal(u.cpUsed, 12);
  assert.equal(u.cohesion, -4, '4 CP over a CPA of 8 = 4 Disorganisation Points');
});

test('zones of control: stop on entry, no ZOC-to-ZOC, mandatory attack', () => {
  const g = createGame();
  toMoveCombat(g);
  const mal = g.units.find((x) => x.id === 'it-mal');
  const arm = g.units.find((x) => x.id === 'cw-7arm');
  // Put the 7th Armoured two hexes east of Maletti on open ground for a clean test.
  arm.pos = [mal.pos[0] + 2, mal.pos[1]];
  for (const h of [mal.pos, [mal.pos[0] + 1, mal.pos[1]], arm.pos]) gameMap().tiles[key(...h)].t = 'clear';
  const between = [mal.pos[0] + 1, mal.pos[1]];
  assert.equal(inEnemyZoc(g, mal, between), true);
  const beyond = [mal.pos[0] + 1, mal.pos[1] + 1];
  const err = planMove(g, mal, [between, beyond]);
  assert.match(err, /stop on entering/);
  assert.equal(act(g, 'axis', { action: 'move', unitId: mal.id, path: [between] }), null);
  act(g, 'axis', { action: 'toCombat' });
  assert.match(act(g, 'axis', { action: 'endPhase' }), /must attack/);
  assert.equal(act(g, 'axis', { action: 'attack', targetId: arm.id, attackerIds: [mal.id] }), null);
  assert.ok(mal.cpUsed >= 5, 'assault costs the phasing unit 5 CP');
  assert.equal(act(g, 'axis', { action: 'endPhase' }), null);
});
