// Unit tests for rules implemented from the rulebook (engine level, no networking).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, submitOrders, act, planMove, inEnemyZoc, actingSides, gameMap } from '../src/server/engine.js';
import { turnDate, initiativeRating, stepCost, edgeKey } from '../src/shared/rules.js';
import { key, distance } from '../src/shared/hex.js';
import { hexFromName, nameOfHex } from '../src/shared/hexnames.js';

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
  const g = createGame();
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
