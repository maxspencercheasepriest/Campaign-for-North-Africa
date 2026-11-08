import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, victoryStatus, victoryPoints, instantWinner } from '../src/server/engine.js';
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

import { submitOrders } from '../src/server/engine.js';
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

test('reinforcements arrive in the Arrival Phase of the stage the schedule names [4.42]', () => {
  const g = createGame({ scenario: 'italian', seed: 1 });
  g.turn = 20; g.opStage = 1;
  g.portOwners.benghazi = 'axis';
  const before = g.units.length;
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {});
  assert.equal(g.units.length, before, 'not yet: Rommel is due in stage 2');
});

test('a unit with some ammo in reach but less than an attack costs is told why', async () => {
  const { createGame, viewFor } = await import('../src/server/engine.js');
  const g = createGame({ seed: 1 });
  const u = viewFor(g, 'cw').units.find((x) => x.supplyNote);
  assert.ok(u, 'someone starts out of supply');
  assert.ok(u.ammoNeed > 0 && u.ammoAvail < u.ammoNeed);
  assert.match(u.supplyNote, /supply unit/);
});
