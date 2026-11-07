import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, victoryStatus, victoryPoints, instantWinner } from '../src/server/engine.js';
import { SCENARIOS } from '../src/shared/scenario.js';

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
