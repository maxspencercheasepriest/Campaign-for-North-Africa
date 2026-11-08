import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, viewFor, submitOrders, victoryStatus, victoryPoints, instantWinner } from '../src/server/engine.js';
import { SCENARIOS, buildMap } from '../src/shared/scenario.js';

test('scenarios share the 1940 start but differ in length and victory', () => {
  assert.deepEqual(Object.values(SCENARIOS).map((s) => s.lastTurn), [6, 20, 111]);
  for (const id of Object.keys(SCENARIOS)) {
    const g = createGame({ scenario: id, seed: 1 });
    assert.equal(g.scenario, id);
    assert.equal(g.turn, 1);
    assert.ok(g.units.length > 10);
  }
  assert.equal(createGame({ scenario: 'nonsense', seed: 1 }).scenario, 'graziani', 'unknown ids fall back to the default');
});

test('points scenarios score the towns each side holds [60.82]', () => {
  const g = createGame({ scenario: 'italian', seed: 1 });
  assert.deepEqual(victoryPoints(g), { axis: 100, cw: 10 }); // Tobruk 50 + Derna 20 + Giarabub 10 + Benghazi 10 + Agedabia 10; Siwa 10
  g.portOwners.matruh = 'axis';
  assert.equal(victoryPoints(g).axis, 200);
  g.portOwners.tobruk = 'cw';
  assert.deepEqual(victoryPoints(g), { axis: 150, cw: 35 });
  assert.equal(victoryStatus(g).mode, 'points');
});

test('campaign game: holding Alexandria and Cairo wins outright [64.71]; no Axis supply loses from GT35 [64.72]', () => {
  const g = createGame({ scenario: 'campaign', seed: 1 });
  assert.equal(instantWinner(g), null);
  g.portOwners.alexandria = 'axis'; g.portOwners.cairo = 'axis';
  assert.equal(instantWinner(g), 'axis');
  g.portOwners.alexandria = 'cw';
  assert.equal(instantWinner(g), null);
  g.turn = 35; g.supply.units = g.supply.units.filter((u) => u.side !== 'axis'); g.supply.box.axis = [];
  assert.equal(instantWinner(g), 'cw');
});

test('Graziani keeps the short tiered victory and no early outright win', () => {
  const g = createGame({ scenario: 'graziani', seed: 1 });
  assert.equal(instantWinner(g), null);
  assert.equal(victoryStatus(g).mode, undefined);
});

import { landConvoys } from '../src/server/supply.js';

test('Axis convoys are assigned in the Convoy Stage and land in the chosen Operations Stage [32.62, 20.63]', () => {
  const g = createGame({ scenario: 'graziani', seed: 1 });
  const before = g.supply.units.filter((u) => u.side === 'axis').length;
  const box = g.supply.box.axis.length;
  const orders = { convoys: [{ port: 'benghazi', route: 2, n: 2, stage: 2 }, { port: 'tobruk', route: 3, n: 3, stage: 3 }] };
  assert.equal(submitOrders(g, 'axis', orders), null);
  assert.equal(submitOrders(g, 'cw', {}), null);
  // Stage 1: units have left the box but nothing has landed yet.
  assert.equal(g.opStage, 1);
  assert.equal(g.supply.box.axis.length, box - 5);
  assert.equal(g.supply.convoys.length, 2);
  assert.equal(g.supply.units.filter((u) => u.side === 'axis').length, before);
  const map = buildMap();
  const land = (stage) => landConvoys(g.supply, map, { units: [], turn: g.turn, stage, rollD66: () => 11, log: () => {}, portOwners: g.portOwners });
  land(1);
  assert.equal(g.supply.convoys.length, 2, 'nothing is due in stage 1');
  land(2);
  assert.equal(g.supply.convoys.length, 1);
  assert.equal(g.supply.units.filter((u) => u.side === 'axis').length, before + 2, 'two units landed at Benghazi in stage 2');
  land(3);
  assert.equal(g.supply.convoys.length, 0);
  // Tobruk already holds 3 supply units and takes 5 at most [32.14]: 2 land and the third goes back to the Tripoli box.
  assert.equal(g.supply.units.filter((u) => u.side === 'axis').length, before + 4);
  assert.equal(g.supply.box.axis.length, box - 5 + 1);
});

test('convoy orders are validated: one per lane, at most 3 each, lanes limited early on', () => {
  const g = createGame({ scenario: 'graziani', seed: 1 });
  const bad = (convoys) => submitOrders(g, 'axis', { convoys });
  assert.match(bad([{ port: 'benghazi', route: 2, n: 2 }, { port: 'tobruk', route: 2, n: 1 }]), /one convoy per lane/);
  assert.match(bad([{ port: 'benghazi', route: 1, n: 1 }]), /lanes 2, 3 and 6/);
  assert.match(bad([{ port: 'benghazi', route: 2, n: 4 }]), /at most 3/);
  assert.match(bad([{ port: 'benghazi', route: 2, n: 1, stage: 4 }]), /Stage 1, 2 or 3/);
  assert.match(bad([{ port: 'matruh', route: 2, n: 1 }]), /not in your hands/);
});

const arrive = (opts, turn) => {
  const g = createGame({ seed: 1, ...opts });
  g.turn = turn;
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {});
  return g;
};
const has = (g, id) => g.units.some((u) => u.id === id);

test('reinforcements arrive on the turn and stage the schedule names, and are held over if missed [4.42, 4.43]', () => {
  const g = arrive({}, 3); // stage 1 of Game-Turn 3
  assert.ok(has(g, 'cw-pol'), 'Polish Bde is due 1/3');
  assert.ok(has(g, 'cw-rtr2'), '2 and 7 RTR are due 2/3');
  assert.ok(!has(g, 'cw-1fa'), '1st Fld Arty is due 3/3, not yet');
  const pol = g.units.find((u) => u.id === 'cw-pol');
  assert.ok(g.log.some((l) => /Polish Bde arrives at Cairo/.test(l.text || l)));
  assert.ok(pol.pos, 'placed on the map');
});

test('axis reinforcements start at GT9 and Rommel is dated GT20 stage 2', () => {
  assert.ok(!has(arrive({}, 8), 'it-xxvarty'));
  assert.ok(has(arrive({}, 10), 'it-xxvarty'));
  assert.ok(!has(arrive({}, 20), 'de-dak'), 'GT20 stage 1: not yet');
});

test('reinforcement options: early brings them two turns sooner, none brings none', () => {
  assert.ok(has(arrive({ reinforce: 'early' }, 5), 'cw-1fa'), '3/3 due by turn 5 stage 1 when early (turn 1)');
  assert.ok(!has(arrive({ reinforce: 'none' }, 30), 'cw-pol'));
});

test('generous stock doubles the starting supply units without breaking stack limits', () => {
  const a = createGame({ seed: 1 }), b = createGame({ seed: 1, stock: 'generous' });
  assert.equal(b.supply.units.length, a.supply.units.length * 2);
  const per = new Map();
  for (const s of b.supply.units) per.set(`${s.side}${s.pos}`, (per.get(`${s.side}${s.pos}`) || 0) + 1);
  assert.ok([...per.values()].every((n) => n <= 5));
});

test('a unit with some ammo in reach but less than an attack costs is told why', async () => {
  const { createGame, viewFor } = await import('../src/server/engine.js');
  const g = createGame({ seed: 1 });
  const u = viewFor(g, 'cw').units.find((x) => x.supplyNote);
  assert.ok(u, 'someone starts out of supply');
  assert.ok(u.ammoNeed > 0 && u.ammoAvail < u.ammoNeed);
  assert.match(u.supplyNote, /supply unit/);
});

test('a probe costs far less ammunition than a full attack', async () => {
  const { ammoCost } = await import('../src/server/supply.js');
  const g = createGame({ seed: 1 });
  const u = g.units.find((x) => x.id === 'it-63');
  assert.equal(ammoCost(u, true, { probe: true }), 2);
  assert.ok(ammoCost(u, true) > 2);
});

test('a unit that has already paid its fuel this stage is not shown as short of fuel after it moves away', () => {
  const g = createGame({ seed: 1 });
  const u = g.units.find((x) => x.id === 'it-63');
  u.fuelPaid = true;
  const v = viewFor(g, 'axis').units.find((x) => x.id === 'it-63');
  assert.equal(v.fuelNeed, 0);
});
