import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASICS, stepHelp } from '../src/client/tutorial.js';

test('every basics page has a title and text', () => {
  assert.ok(BASICS.length >= 5);
  for (const p of BASICS) { assert.ok(p.title); assert.ok(p.body.length > 0); }
});

test('step help exists for every step and respects side and seat', () => {
  for (const step of ['convoy', 'declare', 'movecombat', 'trucks']) {
    const h = stepHelp({ step, phasing: 'axis', seg: { mode: 'move' } }, { side: 'axis', canAct: true });
    assert.ok(h.title && h.body.length, step);
  }
  assert.match(stepHelp({ step: 'convoy' }, { side: 'cw', canAct: true }).body[0], /arrives by itself/);
  assert.match(stepHelp({ step: 'movecombat', phasing: 'axis' }, { side: 'cw', canAct: true }).title, /Enemy/);
  assert.match(stepHelp({ step: 'movecombat', phasing: 'cw', seg: { mode: 'combat' } }, { side: 'cw', canAct: true }).title, /Combat/);
  assert.ok(stepHelp({ step: 'trucks' }, { side: 'cw', canAct: false }).body.some((l) => /not your seat/.test(l)));
  assert.equal(stepHelp({ over: true }, {}).title, 'Scenario over');
});
