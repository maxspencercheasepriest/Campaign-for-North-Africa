// Combat procedure tests (barrage -> anti-armour -> close assault) on a controlled position.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, submitOrders, act, gameMap } from '../src/server/engine.js';
import { actual } from '../src/server/combat.js';
import { key, neighbours } from '../src/shared/hex.js';
import { hexFromName } from '../src/shared/hexnames.js';

function setup(seed) {
  const g = createGame();
  g.seed = seed;
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {});
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {});
  submitOrders(g, 'axis', { goFirst: true });
  // Put the 63rd Cirene next to the 4th Indian on clear ground, away from everything else.
  const att = g.units.find((u) => u.id === 'it-63');
  const def = g.units.find((u) => u.id === 'cw-4ind');
  att.pos = hexFromName('C2010'); def.pos = neighbours(...att.pos)[1];
  for (const h of [att.pos, def.pos, ...neighbours(...def.pos)]) gameMap().tiles[key(...h)] = { t: 'clear' };
  for (const ek of Object.keys(gameMap().hexsides)) if (ek.includes(key(...def.pos))) delete gameMap().hexsides[ek];
  g.seg.mode = 'combat';
  return { g, att, def };
}

test('actual points round to nearest and ignore 4 or fewer raw points [11.32-11.33]', () => {
  assert.equal(actual(108), 11);
  assert.equal(actual(65), 7);
  assert.equal(actual(4), 0);
  assert.equal(actual(15), 2);
});

test('an assault runs the full procedure and charges CP, ammo and losses', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const { g, att, def } = setup(seed * 7919);
    const before = { att: att.str, def: def.str, attAmmo: att.ammo, defAmmo: def.ammo };
    assert.equal(act(g, 'axis', { action: 'attack', targetId: def.id, attackerIds: [att.id] }), null);
    assert.ok(g.lastCombat.lines.some((l) => /Close assault/.test(l)) || g.lastCombat.lines.some((l) => /surrender/i.test(l)), g.lastCombat.lines.join('\n'));
    assert.equal(att.cpUsed, 5);
    assert.ok(def.cpUsed === 3 || def.cpUsed === 1 || def.cpUsed > 3, `defender CP ${def.cpUsed}`);
    assert.ok(att.str <= before.att && (g.units.includes(def) ? def.str <= before.def : true));
    assert.equal(att.ammo, before.attAmmo - 1);
    // Can't attack the same hex twice in a segment.
    if (g.units.includes(def) && key(...def.pos) === key(...neighbours(...hexFromName('C2010'))[1])) {
      assert.match(act(g, 'axis', { action: 'attack', targetId: def.id, attackerIds: [att.id] }), /already been attacked/);
    }
  }
});

test('a hopelessly outmatched, ammunition-less defender surrenders', () => {
  const { g, att, def } = setup(42);
  def.ammo = 0;
  const strBefore = def.str;
  act(g, 'axis', { action: 'attack', targetId: def.id, attackerIds: [att.id] });
  assert.ok(!g.units.includes(def));
  assert.equal(g.prisoners.axis, strBefore);
});
