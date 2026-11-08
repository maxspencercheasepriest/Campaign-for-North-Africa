// Reserve Status [18.0].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, submitOrders, act } from '../src/server/engine.js';
import { neighbours, key } from '../src/shared/hex.js';

function start() {
  const g = createGame({ seed: 1 });
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {});
  submitOrders(g, g.initiative.holder, { goFirst: true });
  const side = g.initiative.holder; // goes first: Player A
  const mine = g.units.filter((u) => u.side === side && u.type !== 'hq');
  return { g, side, mine };
}

test('only the phasing player designates Reserve, and only before the first movement [18.11, 18.15]', () => {
  const { g, side, mine } = start();
  const other = side === 'axis' ? 'cw' : 'axis';
  assert.match(act(g, other, { action: 'reserve', unitIds: [mine[0].id] }), /not your Movement/);
  assert.equal(act(g, side, { action: 'reserve', unitIds: [mine[0].id] }), null);
  assert.equal(mine[0].reserve, 1);
  assert.equal(act(g, side, { action: 'reserve', unitIds: [mine[0].id], off: true }), null);
  assert.equal(mine[0].reserve, 0);
  act(g, side, { action: 'toCombat' });
  assert.match(act(g, side, { action: 'reserve', unitIds: [mine[0].id] }), /Reserve Designation Phase/);
});

test('Reserve II may never move; Reserve I moves one hex only [18.22]', () => {
  const { g, side, mine } = start();
  const [a, b] = mine;
  act(g, side, { action: 'reserve', unitIds: [a.id, b.id] });
  const hex = (u) => neighbours(...u.pos).find((h) => !g.units.some((x) => x.pos[0] === h[0] && x.pos[1] === h[1]));
  b.reserve = 2;
  assert.match(act(g, side, { action: 'move', unitId: b.id, path: [hex(b)] }), /Reserve II and may not move/);
  const h1 = hex(a);
  const before = a.cpUsed;
  const e1 = act(g, side, { action: 'move', unitId: a.id, path: [h1] });
  if (e1 === null) assert.equal(a.cpUsed, before, 'a Reserve I move costs no CP');
  else assert.doesNotMatch(e1, /Reserve/, 'only terrain may stop a one-hex Reserve I move');
});

test('release: Reserve I only in the first segment, Reserve II only later; restrictions apply [18.23-18.25]', () => {
  const { g, side, mine } = start();
  const [a, b] = mine;
  act(g, side, { action: 'reserve', unitIds: [a.id, b.id] });
  assert.match(act(g, side, { action: 'release', unitIds: [a.id] }), /after the Combat Segment/);
  act(g, side, { action: 'toCombat' });
  assert.equal(act(g, side, { action: 'release', unitIds: [a.id] }), null);
  assert.equal(a.reserve, 0);
  assert.equal(a.relFrom, 1);
  assert.equal(a.relCap, a.cpa, 'may not voluntarily exceed its CPA');
  b.reserve = 2; // as if flipped
  assert.match(act(g, side, { action: 'release', unitIds: [b.id] }), /later Reserve Release Segment/);
  act(g, side, { action: 'nextSegment' });
  assert.equal(b.reserve, 2, 'stays in Reserve II');
  act(g, side, { action: 'toCombat' });
  assert.equal(act(g, side, { action: 'release', unitIds: [b.id] }), null);
  assert.equal(b.relFrom, 2);
  assert.equal(b.relCap, Math.floor(b.cpa / 2), 'half CPA from Reserve II');
});

test('units still in Reserve I after the first release segment flip to Reserve II [18.13]', () => {
  const { g, side, mine } = start();
  act(g, side, { action: 'reserve', unitIds: [mine[0].id] });
  act(g, side, { action: 'toCombat' });
  act(g, side, { action: 'nextSegment' });
  assert.equal(mine[0].reserve, 2);
});

test('a unit in Reserve cannot attack; released units get one offensive assault [18.2, 18.23]', () => {
  const { g, side, mine } = start();
  const u = mine[0];
  u.reserve = 1;
  act(g, side, { action: 'toCombat' });
  const foe = g.units.find((x) => x.side !== side);
  foe.pos = neighbours(...u.pos)[0]; // put an enemy next to it so only the Reserve rules can refuse
  assert.match(act(g, side, { action: 'attack', attackerIds: [u.id], targetId: foe.id }), /in Reserve and cannot attack/);
  u.reserve = 0; u.relFrom = 1; u.assaults = 1;
  assert.match(act(g, side, { action: 'attack', attackerIds: [u.id], targetId: foe.id }), /only one offensive assault/);
});

test('Reserve lasts only for the Operations Stage', () => {
  const { g, side, mine } = start();
  act(g, side, { action: 'reserve', unitIds: [mine[0].id] });
  mine[0].relCap = 3; mine[0].assaults = 1;
  // end both phases of this stage; the next stage resets everything
  act(g, side, { action: 'endPhase' }); submitOrders(g, side, { moves: [] });
  const other = side === 'axis' ? 'cw' : 'axis';
  act(g, other, { action: 'endPhase' }); submitOrders(g, other, { moves: [] });
  assert.equal(g.opStage, 2);
  assert.equal(mine[0].reserve, 0);
  assert.equal(mine[0].relCap, null);
  assert.equal(mine[0].assaults, 0);
});
