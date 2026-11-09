// Combat procedure tests (barrage -> anti-armour -> close assault) on a controlled position.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, submitOrders, act, gameMap, previewAttack } from '../src/server/engine.js';
import { actual } from '../src/server/combat.js';
import { key, neighbours } from '../src/shared/hex.js';
import { hexFromName } from '../src/shared/hexnames.js';

function setup(seed) {
  const g = createGame({ seed: 1 });
  g.seed = seed;
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {}); // convoy
  submitOrders(g, 'axis', { goFirst: true });
  // Put the 63rd Cirene next to the 4th Indian on clear ground, away from everything else.
  const att = g.units.find((u) => u.id === 'it-63');
  const def = g.units.find((u) => u.id === 'cw-4ind');
  att.pos = hexFromName('C2010'); def.pos = neighbours(...att.pos)[1];
  for (const h of [att.pos, def.pos, ...neighbours(...def.pos)]) gameMap().tiles[key(...h)] = { t: 'clear' };
  for (const ek of Object.keys(gameMap().hexsides)) if (ek.includes(key(...def.pos))) delete gameMap().hexsides[ek];
  g.supply.units.push({ id: 'T-att', side: 'axis', pos: [...att.pos], ammo: 40, fuel: 60 }); // supply on the attacker's hex
  g.supply.units.push({ id: 'T-def', side: 'cw', pos: [...def.pos], ammo: 40, fuel: 60 });
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
    const before = { att: att.str, def: def.str };
    assert.equal(act(g, 'axis', { action: 'attack', targetId: def.id, attackerIds: [att.id] }), null);
    assert.equal(g.decision.kind, 'defence');
    assert.equal(act(g, 'cw', { action: 'defend' }), null);
    assert.ok(g.lastCombat.lines.some((l) => /Close assault/.test(l)) || g.lastCombat.lines.some((l) => /surrender/i.test(l)), g.lastCombat.lines.join('\n'));
    assert.equal(att.cpUsed, 5);
    assert.ok(def.cpUsed === 3 || def.cpUsed === 1 || def.cpUsed > 3, `defender CP ${def.cpUsed}`);
    assert.ok(att.str <= before.att && (g.units.includes(def) ? def.str <= before.def : true));
    assert.equal(att.ammo, 0, 'ammunition was paid from the supply unit and the flag spent');
    assert.ok(g.supply.units.find((x) => x.id === 'T-att').ammo < 40);
    // Can't attack the same hex twice in a segment.
    if (g.units.includes(def) && key(...def.pos) === key(...neighbours(...hexFromName('C2010'))[1])) {
      assert.match(act(g, 'axis', { action: 'attack', targetId: def.id, attackerIds: [att.id] }), /already been attacked/);
    }
  }
});

test('a hopelessly outmatched, ammunition-less defender surrenders', () => {
  const { g, att, def } = setup(42);
  g.supply.units = g.supply.units.filter((x) => x.id !== 'T-def'); // no ammunition within reach
  def.ammo = 0;
  const strBefore = def.str;
  act(g, 'axis', { action: 'attack', targetId: def.id, attackerIds: [att.id] });
  act(g, 'cw', { action: 'defend' });
  assert.ok(!g.units.includes(def));
  assert.equal(g.prisoners.axis, strBefore);
});

test('retreat before assault: an unpinned defender can withdraw and the assault is cancelled [13.0]', () => {
  let withdrew = 0, stood = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { g, att, def } = setup(seed * 104729);
    const pos = key(...def.pos);
    act(g, 'axis', { action: 'attack', targetId: def.id, attackerIds: [att.id] });
    act(g, 'cw', { action: 'defend', retreat: [def.id] });
    const lines = g.lastCombat.lines.join('\n');
    if (key(...def.pos) !== pos) {
      withdrew++;
      assert.match(lines, /no assault/);
      assert.ok(!att.cohesion || att.cohesion <= 0, 'no victory cohesion bonus for an empty hex');
    } else {
      stood++;
      assert.match(lines, /pinned by the barrage|nowhere to retreat|Close assault|surrender/i);
    }
  }
  assert.ok(withdrew > 0, 'some withdrawals happened');
});

test('the odds preview matches the differential of the real assault and changes nothing', () => {
  const { g, att, def } = setup(5);
  const snap = JSON.stringify([g.units, g.supply.units, g.rng ?? g.seed]);
  const o = previewAttack(g, 'axis', { targetId: def.id, attackerIds: [att.id] });
  assert.equal(JSON.stringify([g.units, g.supply.units, g.rng ?? g.seed]), snap);
  assert.ok(o && Number.isInteger(o.basic) && o.column.label);
  act(g, 'axis', { action: 'attack', targetId: def.id, attackerIds: [att.id] });
  act(g, 'cw', { action: 'defend' });
  const m = g.lastCombat.lines.join(' ').match(/defender (\d+) raw/);
  if (m) assert.ok(o.defRaw >= Number(m[1]), 'barrage can only lower the defence the preview shows'); // the preview comes before barrage
  assert.ok(g.lastCombat.from.length === 1 && Array.isArray(g.lastCombat.to));
});
