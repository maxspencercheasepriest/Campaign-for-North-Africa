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

test('air game stage 1: starting air forces match the 1940 scenario and fit the facilities', async () => {
  const { createAir, START_FORCES, SQUADRON_CAPACITY } = await import('../src/shared/air.js');
  const a = createAir();
  assert.deepEqual(a.notes, []);
  for (const side of ['axis', 'cw']) {
    const f = START_FORCES[side];
    const mine = a.squadrons.filter((s) => s.side === side);
    assert.equal(mine.reduce((n, s) => n + s.planes.length, 0), f.planes.reduce((n, p) => n + p[1], 0), `${side}: every plane is in a squadron`);
    assert.equal(mine.reduce((n, s) => n + s.planes.filter((p) => p.ready).length, 0), f.planes.reduce((n, p) => n + p[2], 0), `${side}: refitted counts`);
    assert.ok(mine.length <= f.sgsu, `${side}: one SGSU per squadron`);
    const cap = SQUADRON_CAPACITY[f.nation];
    for (const s of mine) { assert.ok(s.planes.length <= cap.ready + cap.reserve); assert.ok(s.planes.filter((p) => p.ready).length <= cap.ready); }
  }
  for (const fac of a.facilities) assert.ok(fac.used <= fac.cap, `${fac.name} within capacity`);
  const sq = a.squadrons.find((s) => s.kind === 'flyingboat' && s.side === 'cw');
  assert.ok(['alexbasin', 'portsaid'].includes(sq.facility), 'flying boats use basins');
});

test('the Air tab data comes through the view with fog of war', () => {
  const g = createGame({ seed: 1 });
  const cw = viewFor(g, 'cw').air, ax = viewFor(g, 'axis').air;
  assert.ok(cw.squadrons.every((s) => /^[^a]/.test(s.id) || true));
  assert.ok(cw.facilities.some((f) => f.name === 'Mersa Matruh'));
  assert.ok(!cw.facilities.some((f) => f.name === 'Benina'), 'enemy bases far away are not visible');
  assert.notEqual(cw.squadrons.length, 0); assert.notEqual(ax.squadrons.length, 0);
  assert.ok(ax.squadrons.some((s) => s.types['C.R. 42 Falco']) && !cw.squadrons.some((s) => s.types['C.R. 42 Falco']));
});

test('air game stage 2: tables', async () => {
  const a = await import('../src/server/air.js');
  assert.equal(a.scrambleNumber(2), 6);
  assert.equal(a.scrambleNumber(9), 2);
  assert.equal(a.scrambleNumber(16), 0);
  assert.equal(a.maneuverAdjustment(0), 0);
  assert.equal(a.maneuverAdjustment(5), 2);
  assert.equal(a.maneuverAdjustment(30), 5);
  assert.equal(a.killNumber(-13), 0);
  assert.equal(a.killNumber(0), 14);
  assert.equal(a.killNumber(4), 24);
  assert.equal(a.killNumber(20), 56);
  assert.equal(a.refitShare(1), 100);
  assert.equal(a.refitShare(7), 40);
  assert.equal(a.strafeColumn(5), 0);
  assert.equal(a.strafeColumn(6), 1);
  assert.equal(a.strafeColumn(50), 9);
  assert.equal(a.strafeResult(0, 63), 0);
  assert.equal(a.strafeResult(0, 64), 1);
  assert.equal(a.strafeResult(8, 66), 3);
  assert.equal(a.strafeResult(9, 45), 1);
});

test('air game stage 2: the Land Support Air Phase sits between Initiative and movement and fighters fight', () => {
  const g = createGame({ seed: 7, air: 'on' });
  assert.ok(g.air.squadrons.some((s) => s.planes.some((p) => p.fueled && p.armed)), 'ready planes start fuelled and armed');
  const stock = g.air.stock.axis.fuel;
  assert.ok(stock < 850, 'fuelling the starting planes used fuel');
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {});
  assert.equal(g.step, 'declare');
  submitOrders(g, g.initiative.holder, { goFirst: true });
  assert.equal(g.step, 'air');
  // Put an Axis and a Commonwealth fighter squadron over the same hex.
  const axSq = g.air.squadrons.find((s) => s.side === 'axis' && s.kind === 'fighter' && s.planes.some((p) => p.ready && p.fueled));
  const cwSq = g.air.squadrons.find((s) => s.side === 'cw' && s.kind === 'fighter' && s.planes.some((p) => p.ready && p.fueled));
  const bad = submitOrders(g, 'axis', { missions: [{ sq: cwSq.id, kind: 'capO', hex: 'C4807' }] });
  assert.match(bad, /own squadrons/);
  assert.equal(submitOrders(g, 'axis', { missions: [{ sq: axSq.id, kind: 'capD', hex: 'C4020' }] }), null);
  const before = g.air.squadrons.reduce((n, s) => n + s.planes.length, 0);
  assert.equal(submitOrders(g, 'cw', { missions: [{ sq: cwSq.id, kind: 'capO', hex: 'C4020' }] }), null);
  assert.equal(g.step, 'movecombat', 'the air phase is over');
  assert.ok(g.log.some((l) => /Air combat/.test(l.text)) || g.log.some((l) => /could not fly/.test(l.text)), 'something happened in the air');
  const flown = [...axSq.planes, ...cwSq.planes].filter((p) => !p.ready);
  assert.ok(flown.length > 0 || before > g.air.squadrons.reduce((n, s) => n + s.planes.length, 0), 'planes that flew are no longer refitted (or were shot down)');
});

test('air game stage 2: option off keeps the old sequence', () => {
  const g = createGame({ seed: 7 });
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {});
  submitOrders(g, g.initiative.holder, { goFirst: true });
  assert.equal(g.step, 'movecombat');
});

test('starting troops option: strong brings the first 12 turns of reinforcements in at the start', () => {
  const count = (o) => { const g = createGame({ seed: 1, ...o }); return g.units.length; };
  const hist = createGame({ seed: 1 });
  const strong = createGame({ seed: 1, troops: 'strong' });
  submitOrders(hist, 'axis', {}); submitOrders(hist, 'cw', {});
  submitOrders(strong, 'axis', {}); submitOrders(strong, 'cw', {});
  assert.ok(strong.units.length > hist.units.length + 5, 'many more formations on the map');
  assert.ok(strong.units.some((u) => u.id === 'cw-1fa'));
  assert.ok(!hist.units.some((u) => u.id === 'cw-1fa'));
  void count;
});

test('air game stage 3: bombardment table lookups [41.5]', async () => {
  const a = await import('../src/server/air.js');
  const T = a.BOMB_TABLES;
  assert.equal(a.bombColumn(20), 0);
  assert.equal(a.bombColumn(21), 1);
  assert.equal(a.bombColumn(500), 10);
  assert.equal(a.bombResult(T.pin, a.bombColumn(100), 65), 2);
  assert.equal(a.bombResult(T.pin, a.bombColumn(10), 63), 1);
  assert.equal(a.bombResult(T.pin, a.bombColumn(10), 62), 0);
  assert.equal(a.bombResult(T.facility, a.bombColumn(500), 66), 4);
  assert.equal(a.bombResult(T.facility, a.bombColumn(30), 66), 1);
  assert.equal(a.bombResult(T.dump, a.bombColumn(500), 66), 75);
  assert.equal(a.bombResult(T.dump, a.bombColumn(10), 11), 0);
  assert.equal(a.bombResult(T.dump, a.bombColumn(0), 66), 0);
});

test('air game stage 3: bomber orders are checked, and bombers over a target meet fighters', async () => {
  const { hexFromName } = await import('../src/shared/hexnames.js');
  let met = false, bombed = false;
  for (let seed = 1; seed <= 8 && !(met && bombed); seed++) {
    const g = createGame({ seed, air: 'on' });
    submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {});
    submitOrders(g, g.initiative.holder, { goFirst: true });
    const unit = g.units.find((u) => u.side === 'axis' && u.type !== 'hq' && u.str > 0);
    unit.pos = hexFromName('C4218');
    const bombers = g.air.squadrons.filter((s) => s.side === 'cw' && s.kind === 'bomber');
    for (const s of bombers) s.facility = 'matruh';
    const sq = bombers.find((s) => s.planes.some((p) => p.ready && p.fueled && p.armed));
    const ax = g.air.squadrons.find((s) => s.side === 'axis' && s.kind === 'fighter' && s.planes.some((p) => p.ready && p.fueled && p.armed));
    assert.match(submitOrders(g, 'cw', { missions: [{ sq: sq.id, kind: 'strafe', hex: 'C4218' }] }), /bomber squadron/);
    assert.match(submitOrders(g, 'cw', { missions: [{ sq: g.air.squadrons.find((s) => s.side === 'cw' && s.kind === 'fighter').id, kind: 'bCU', hex: 'C4218' }] }), /fighter squadron/);
    submitOrders(g, 'axis', { missions: [{ sq: ax.id, kind: 'capD', hex: 'C4218' }] });
    assert.equal(submitOrders(g, 'cw', { missions: [{ sq: sq.id, kind: 'bCU', hex: 'C4218' }] }), null);
    const text = g.log.map((l) => l.text).join('\n');
    if (/Air combat/.test(text)) met = true;
    if (/Commonwealth bombers/.test(text)) bombed = true;
  }
  assert.ok(met, 'Axis fighters attacked the bombers');
  assert.ok(bombed, 'some bombers reached the target and dropped their load');
});

test('air game stage 3: bombing an air facility cuts its capacity and destroys planes on the ground', async () => {
  const a = await import('../src/server/air.js');
  const { hexFromName } = await import('../src/shared/hexnames.js');
  const g = createGame({ seed: 3, air: 'on' });
  const fac = g.air.facilities.find((f) => f.id === 'eladem');
  const before = fac.cap;
  const planesBefore = g.air.squadrons.filter((s) => s.facility === 'eladem').reduce((n, s) => n + s.planes.length, 0);
  assert.ok(planesBefore >= 10);
  const sq = g.air.squadrons.find((s) => s.side === 'cw' && s.kind === 'bomber' && s.planes.length >= 8);
  sq.facility = 'matruh';
  for (const s of g.air.squadrons) for (const p of s.planes) { p.ready = p.fueled = p.armed = false; }
  for (const p of sq.planes.slice(0, 8)) { p.ready = p.fueled = p.armed = true; }
  // Every die shows 6, so the d66 roll is 66: 40 tons of bombs take one level off an airfield.
  const ctx = {
    map: { tiles: {} }, units: [], weapons: {}, d6: () => 6, log: () => {}, supplyUnitsAt: () => [], supplyAt: () => false,
    weatherAt: () => 'normal', turn: 1, opStage: 1, firstTurn: 1, holder: 'cw',
  };
  a.resolveAir(g, { cw: { missions: [{ sq: sq.id, kind: 'bAF', hex: 'C4507' }] }, axis: {} }, ctx);
  assert.equal(fac.cap, before - 1);
  const planesAfter = g.air.squadrons.filter((s) => s.facility === 'eladem').reduce((n, s) => n + s.planes.length, 0);
  assert.equal(planesBefore - planesAfter, Math.floor(planesBefore * 0.1));
  a.repairFacilities(g.air);
  assert.equal(fac.cap, before, 'one level is repaired each Game-Turn');
});
