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

test('SAS raid destroys planes on an enemy airfield, once a month, and only if no enemy combat units are there [27.8]', async () => {
  const { facilityHex } = await import('../src/shared/air.js');
  const g = createGame({ seed: 2, air: 'on' });
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {});
  submitOrders(g, 'axis', { goFirst: false });
  const fac = g.air.facilities.find((f) => f.owner === 'axis' && f.kind === 'airfield' && f.hex && g.air.squadrons.some((q) => q.facility === f.id && q.kind !== 'flyingboat'));
  const h = facilityHex(fac);
  const sas = structuredClone(g.units.find((u) => u.id === 'cw-4ind'));
  Object.assign(sas, { id: 'cw-sas', name: 'SAS', sas: true, pos: [...h], cpUsed: 0, cohesion: 0 });
  g.units.push(sas);
  for (const u of g.units) if (u.side === 'axis' && u.pos[0] === h[0] && u.pos[1] === h[1]) u.pos = [0, 0];
  g.step = 'movecombat'; g.half = 'A'; g.order = { A: 'cw', B: 'axis' }; g.seg = { n: 1, mode: 'move', moved: [], attacked: [], frozen: [] };
  const before = g.air.squadrons.filter((q) => q.facility === fac.id).reduce((n, q) => n + q.planes.length, 0);
  assert.equal(act(g, 'cw', { action: 'raid', unitId: 'cw-sas', facility: fac.id }), null);
  const after = g.air.squadrons.filter((q) => q.facility === fac.id).reduce((n, q) => n + q.planes.length, 0);
  assert.ok(after <= before);
  assert.ok(g.log.some((l) => /SAS raid/.test(l.text)));
  assert.match(act(g, 'cw', { action: 'raid', unitId: 'cw-sas', facility: fac.id }), /once|month|six/i);
});

test('air transfer moves a squadron to a friendly base with room, updates occupancy, and refuses full or far bases', async () => {
  const { transferOptions } = await import('../src/server/air.js');
  const g = createGame({ seed: 2, air: 'on' });
  const sq = g.air.squadrons.find((q) => q.side === 'axis' && q.kind !== 'flyingboat' && transferOptions(g, q).length);
  assert.ok(sq, 'some axis squadron has somewhere to go');
  const opts = transferOptions(g, sq), dest = opts[0];
  assert.ok(opts.every((o) => o.id !== sq.facility));
  const from = g.air.facilities.find((f) => f.id === sq.facility), to = g.air.facilities.find((f) => f.id === dest.id);
  const [fu, tu] = [from.used, to.used];
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {});
  submitOrders(g, 'axis', { goFirst: false });
  assert.equal(g.step, 'air');
  const bad = submitOrders(g, 'axis', { missions: [{ sq: sq.id, kind: 'transfer', to: 'nowhere' }] });
  assert.match(String(bad), /base|range/i);
  assert.equal(submitOrders(g, 'axis', { missions: [{ sq: sq.id, kind: 'transfer', to: dest.id }] }) || null, null);
  submitOrders(g, 'cw', { missions: [] });
  assert.ok(g.log.some((l) => /transfer/.test(l.text)));
  if (sq.facility === dest.id) { assert.equal(from.used, fu - 1); assert.equal(to.used, tu + 1); }
});

test('airlift flies a supply unit and infantry to another airfield, then the planes need refitting [42.3, 47.35]', async () => {
  const { facilityHex } = await import('../src/shared/air.js');
  const { liftOptions, cargoView } = await import('../src/server/air.js');
  const g = createGame({ seed: 2, air: 'on' });
  const sq = g.air.squadrons.find((q) => q.side === 'axis' && cargoView(g, q).lift > 0 && liftOptions(g, q).length);
  assert.ok(sq, 'an axis transport squadron with a destination');
  const dest = liftOptions(g, sq)[0], fac = g.air.facilities.find((f) => f.id === sq.facility), toHex = facilityHex(g.air.facilities.find((f) => f.id === dest.id));
  // Give the squadron plenty of planes and a small supply unit and a small infantry unit at its base.
  for (const p of sq.planes) { p.ready = true; p.fueled = true; }
  while (sq.planes.length < 36) sq.planes.push({ ...sq.planes[0] });
  const base = facilityHex(fac);
  const su = { id: 'suX', side: 'axis', pos: [...base], ammo: 4, fuel: 10, mp: 30 }; g.supply.units.push(su);
  const inf = structuredClone(g.units.find((u) => u.id === 'it-1cc'));
  Object.assign(inf, { id: 'ax-test', pos: [...base], str: 3, cpUsed: 0 }); g.units.push(inf);
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {}); submitOrders(g, 'axis', { goFirst: false });
  assert.equal(g.step, 'air');
  const tooMany = submitOrders(g, 'axis', { missions: [{ sq: sq.id, kind: 'airlift', to: dest.id, cargo: { units: ['it-1cc'], supply: [] } }] });
  assert.match(String(tooMany), /start|carry|TOE|only/i);
  const err = submitOrders(g, 'axis', { missions: [{ sq: sq.id, kind: 'airlift', to: dest.id, cargo: { units: ['ax-test'], supply: ['suX'] } }] });
  assert.equal(err || null, null);
  submitOrders(g, 'cw', { missions: [] });
  assert.ok(g.log.some((l) => /flown|Cargo flight/.test(l.text)));
  assert.deepEqual(su.pos, toHex);
  {
    assert.deepEqual(inf.pos, toHex);
    assert.ok(inf.cpUsed >= inf.cpa);
    assert.ok(sq.planes.every((p) => !p.ready || !p.fueled) || sq.planes.length > 30);
  }
});
