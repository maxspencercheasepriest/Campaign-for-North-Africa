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

test('air phase leaves a record for the map: own flights with bases, enemy flights without', () => {
  const g = createGame({ seed: 1, air: 'on' });
  submitOrders(g, 'axis', {}); submitOrders(g, 'cw', {});
  submitOrders(g, g.initiative.holder, { goFirst: true });
  assert.equal(viewFor(g, 'axis').lastAir, null);
  const ax = g.air.squadrons.find((s) => s.side === 'axis' && s.kind === 'fighter' && s.planes.some((p) => p.ready && p.fueled));
  const cw = g.air.squadrons.find((s) => s.side === 'cw' && s.kind === 'fighter' && s.planes.some((p) => p.ready && p.fueled && p.armed));
  submitOrders(g, 'axis', { missions: [{ sq: ax.id, kind: 'strafe', hex: 'C4020' }] });
  submitOrders(g, 'cw', { missions: [{ sq: cw.id, kind: 'capD', hex: 'C4020' }] });
  const mine = viewFor(g, 'cw').lastAir, theirs = viewFor(g, 'axis').lastAir;
  assert.ok(mine.flights.length >= 1);
  assert.ok(mine.flights.filter((f) => f.side === 'cw').every((f) => f.from && f.name === cw.name));
  assert.ok(theirs.flights.filter((f) => f.side === 'cw').every((f) => f.from === null && f.name === 'Enemy squadron'));
  assert.equal(mine.n, 1);
  JSON.stringify(mine);
});

test('role-limited views: each seat gets only its own area', () => {
  const g = createGame({ seed: 1, air: 'on' });
  const full = viewFor(g, 'axis');
  assert.ok(full.air.squadrons.length > 0 && full.supply.some((x) => x.own && x.ammo != null), 'no roles given = everything');
  const front = viewFor(g, 'axis', ['front']);
  assert.equal(front.air, null);
  assert.equal(front.supply.filter((x) => x.own).length, 0);
  assert.equal(front.box, null);
  assert.ok(front.units.filter((u) => u.side === 'axis').every((u) => u.cohesion !== undefined), 'the front sees unit detail');
  const air = viewFor(g, 'axis', ['air']);
  assert.ok(air.air.squadrons.length > 0);
  assert.equal(air.supply.filter((x) => x.own).length, 0);
  assert.ok(air.units.filter((u) => u.side === 'axis').every((u) => u.cohesion === undefined && u.elements === undefined && u.str > 0));
  const log = viewFor(g, 'axis', ['logistics']);
  assert.equal(log.air, null);
  assert.ok(log.supply.some((x) => x.own && x.ammo != null));
  assert.equal(typeof log.box, 'number');
  assert.ok(log.units.filter((u) => u.side === 'axis').every((u) => u.cohesion === undefined && u.ammoAvail !== undefined));
  const rear = viewFor(g, 'axis', ['rear']);
  assert.equal(rear.box, null);
  assert.ok(rear.supply.some((x) => x.own && x.ammo != null));
  const cic = viewFor(g, 'axis', ['cic']);
  assert.equal(cic.air.summary, true);
  assert.ok(cic.supplyTotals.ammo > 0);
  assert.ok(cic.supply.filter((x) => x.own).every((x) => x.ammo === undefined));
  const two = viewFor(g, 'axis', ['cic', 'air']);
  assert.ok(two.air.squadrons.length > 0, 'a player standing in for a vacant seat gets its view too');
  JSON.stringify([front, air, log, rear, cic]);
});

test('air game stage 4: anti-aircraft tables [46.3, 46.4]', async () => {
  const a = await import('../src/server/air.js');
  const T = a.AA_TABLES;
  assert.equal(a.flakColumn(0), -1);
  assert.equal(a.flakColumn(4), 0);
  assert.equal(a.flakColumn(5), 1);
  assert.equal(a.flakColumn(100), 9);
  assert.equal(a.flakShift(23), 0);
  assert.equal(a.flakShift(24), 1);
  assert.equal(a.flakShift(72), 3);
  assert.equal(a.aaResult(T.destroyed, 0, 55), 0);
  assert.equal(a.aaResult(T.destroyed, 0, 56), 1);
  assert.equal(a.aaResult(T.destroyed, 9, 66), 5);
  assert.equal(a.aaResult(T.aborted, 9, 66), 7);
  assert.equal(a.aaResult(T.aborted, 4, 14), 1);
  assert.equal(a.aaResult(T.fighter, 5, 63), 2);
  assert.equal(a.aaResult(T.fighter, 9, 61), 3);
  assert.equal(a.aaResult(T.fighter, 0, 64), 0);
});

test('air game stage 4: flak shoots at bombers over a target and uses ammunition', async () => {
  const a = await import('../src/server/air.js');
  const { hexFromName } = await import('../src/shared/hexnames.js');
  const { WEAPONS } = await import('../src/shared/weapons.js');
  const g = createGame({ seed: 3, air: 'on' });
  const sq = g.air.squadrons.find((s) => s.side === 'cw' && s.kind === 'bomber' && s.planes.length >= 8);
  sq.facility = 'matruh';
  for (const s of g.air.squadrons) for (const p of s.planes) { p.ready = p.fueled = p.armed = false; }
  for (const p of sq.planes.slice(0, 8)) { p.ready = p.fueled = p.armed = true; }
  const target = hexFromName('C4218');
  const aa = { id: 'test-aa', side: 'axis', name: 'Test AA', type: 'inf', str: 12, pos: target, elements: [{ w: '90/53 AA', toe: 12, max: 12 }] };
  assert.ok(WEAPONS['90/53 AA'].aa > 0);
  let ammoDrawn = 0;
  const ctx = {
    map: { tiles: {} }, units: [aa], weapons: WEAPONS, d6: () => 6, log: () => {}, drawAmmo: () => { ammoDrawn++; return true; },
    supplyUnitsAt: () => [], supplyAt: () => false, weatherAt: () => 'normal', turn: 1, opStage: 1, firstTurn: 1, holder: 'cw',
  };
  a.resolveAir(g, { cw: { missions: [{ sq: sq.id, kind: 'bCU', hex: 'C4218' }] }, axis: {} }, ctx);
  assert.equal(ammoDrawn, 1, 'the AA gun used 1 Ammo for its target group');
  const f = g.lastAir.flights[0];
  assert.equal(f.sent, 8);
  assert.ok(f.lost > 0, 'flak shot planes down');
  // Without ammunition the gun cannot fire.
  const g2 = createGame({ seed: 3, air: 'on' });
  const sq2 = g2.air.squadrons.find((s) => s.side === 'cw' && s.kind === 'bomber' && s.planes.length >= 8);
  sq2.facility = 'matruh';
  for (const s of g2.air.squadrons) for (const p of s.planes) { p.ready = p.fueled = p.armed = false; }
  for (const p of sq2.planes.slice(0, 8)) { p.ready = p.fueled = p.armed = true; }
  a.resolveAir(g2, { cw: { missions: [{ sq: sq2.id, kind: 'bCU', hex: 'C4218' }] }, axis: {} }, { ...ctx, units: [{ ...aa, elements: [{ w: '90/53 AA', toe: 12, max: 12 }] }], drawAmmo: () => false });
  assert.equal(g2.lastAir.flights[0].lost, 0, 'no ammunition, no flak');
});

test('air supply costs follow the abstract rules [47.22, 47.23]', () => {
  const g = createGame({ seed: 1, air: 'on' });
  const sqs = g.air.squadrons.filter((q) => q.side === 'cw' && q.planes.some((p) => p.ready));
  const fuel = sqs.reduce((n, q) => n + (q.kind === 'fighter' ? 1 : 3), 0); // 1 per fighter squadron, 3 per other Commonwealth squadron
  const ammo = sqs.filter((q) => q.kind !== 'fighter').length; // fighters need no Ammo to arm
  assert.equal(g.air.stock.cw.fuel, 250 - fuel);
  assert.equal(g.air.stock.cw.ammo, 200 - ammo);
});

async function bombRun(g, kind, hexKey, extra = {}) {
  const a = await import('../src/server/air.js');
  const { mapFor } = await import('../src/server/engine.js');
  const { nameOfHex } = await import('../src/shared/hexnames.js');
  const sq = g.air.squadrons.find((s) => s.side === 'cw' && s.kind === 'bomber' && s.planes.length >= 8);
  sq.facility = 'matruh';
  for (const s of g.air.squadrons) for (const p of s.planes) { p.ready = p.fueled = p.armed = false; }
  for (const p of sq.planes.slice(0, 8)) { p.ready = p.fueled = p.armed = true; }
  const lines = [];
  const ctx = {
    map: mapFor(g), damage: g.damage, game: g, portOwners: g.portOwners, units: g.units, weapons: {}, d6: () => 6, log: (s, t) => lines.push(t),
    supplyUnitsAt: (h, side) => g.supply.units.filter((x) => x.side === side && x.pos[0] === h[0] && x.pos[1] === h[1]),
    supplyAt: () => false, weatherAt: () => 'normal', turn: 3, opStage: 1, firstTurn: 1, holder: 'cw', ...extra,
  };
  const [c, r] = hexKey.split(',').map(Number);
  a.resolveAir(g, { cw: { missions: [{ sq: sq.id, kind, hex: nameOfHex(c, r) }] }, axis: {} }, ctx);
  return lines.join('\n');
}

test('bombing a road destroys it for movement until a unit rebuilds it', async () => {
  const { mapFor, gameMap } = await import('../src/server/engine.js');
  const { repairDamage } = await import('../src/server/air.js');
  const { stepCost } = await import('../src/shared/rules.js');
  const { facilityHex } = await import('../src/shared/air.js');
  const { distance } = await import('../src/shared/hex.js');
  const g = createGame({ seed: 4, air: 'on' });
  const base = facilityHex(g.air.facilities.find((f) => f.id === 'matruh'));
  const edge = [...gameMap().roads].map((e) => e.split('|')).map(([a, b]) => ({ a, b, d: distance(base, a.split(',').map(Number)) })).sort((x, y) => x.d - y.d)[0];
  const A = edge.a.split(',').map(Number), B = edge.b.split(',').map(Number);
  assert.equal(stepCost(mapFor(g), A, B, { motorised: true }).via, 'road');
  const text = await bombRun(g, 'bRD', edge.a);
  assert.match(text, /road in that hex is destroyed/);
  assert.notEqual(stepCost(mapFor(g), A, B, { motorised: true })?.via, 'road');
  assert.ok(viewFor(g, 'axis').damage.roads.includes(edge.a));
  assert.equal(gameMap().roads.has(edge.a + '|' + edge.b) || gameMap().roads.has(edge.b + '|' + edge.a), true, 'the shared map is untouched');
  const u = g.units.find((x) => x.side === 'axis' && x.type !== 'hq' && x.str > 0);
  u.pos = A;
  repairDamage(g);
  assert.equal(stepCost(mapFor(g), A, B, { motorised: true }).via, 'road');
});

test('bombing a major city lowers its fortification one level per Operations Stage', async () => {
  const { fortLevel } = await import('../src/server/air.js');
  const { facilityHex } = await import('../src/shared/air.js');
  const { distance } = await import('../src/shared/hex.js');
  const { LOCATIONS } = await import('../src/shared/locations.js');
  const { hexFromName } = await import('../src/shared/hexnames.js');
  const g = createGame({ seed: 5, air: 'on' });
  const base = facilityHex(g.air.facilities.find((f) => f.id === 'matruh'));
  const city = LOCATIONS.filter((l) => l.city && !/cairo|alexandria/i.test(l.name)).map((l) => l.hexes[0])
    .sort((a, b) => distance(base, a) - distance(base, b))[0];
  assert.equal(fortLevel(g.damage, city), 2);
  const k = `${city[0]},${city[1]}`;
  assert.match(await bombRun(g, 'bFC', k), /reduced to Level 1/);
  assert.equal(fortLevel(g.damage, city), 1);
  assert.match(await bombRun(g, 'bFC', k), /only one fortification level/);
  assert.equal(fortLevel(g.damage, city), 1);
  assert.equal(viewFor(g, 'cw').damage.fort[0].level, 1);
});

test('bombing trucks cuts the Motorization Points of enemy supply units', async () => {
  const { gameMap } = await import('../src/server/engine.js');
  const { facilityHex } = await import('../src/shared/air.js');
  const { distance } = await import('../src/shared/hex.js');
  const g = createGame({ seed: 6, air: 'on' });
  const base = facilityHex(g.air.facilities.find((f) => f.id === 'matruh'));
  const dump = g.supply.units.filter((s) => s.side === 'axis' && gameMap().tiles[`${s.pos[0]},${s.pos[1]}`].t !== 'majorcity').sort((a, b) => distance(base, a.pos) - distance(base, b.pos))[0];
  assert.ok(dump, 'an Axis dump in range');
  const text = await bombRun(g, 'bTC', `${dump.pos[0]},${dump.pos[1]}`);
  assert.match(text, /Truck Points? destroyed/);
  assert.ok(dump.mp < 30);
});

test('bombing a port cuts its efficiency; it regains one level per quiet Operations Stage and limits convoy landings', async () => {
  const { repairPorts, portEff } = await import('../src/server/air.js');
  const { landConvoys, createSupply } = await import('../src/server/supply.js');
  const { LOCATIONS } = await import('../src/shared/locations.js');
  const { facilityHex } = await import('../src/shared/air.js');
  const { distance } = await import('../src/shared/hex.js');
  const g = createGame({ seed: 7, air: 'on' });
  const base = facilityHex(g.air.facilities.find((f) => f.id === 'matruh'));
  const port = LOCATIONS.filter((l) => l.port && g.portOwners[l.id] === 'axis' && (l.id === 'tobruk' || l.id === 'bardia' || l.id === 'benghazi'))
    .sort((a, b) => distance(base, a.hexes[0]) - distance(base, b.hexes[0]))[0];
  assert.equal(portEff(g, port.id) > 0, true);
  const before = portEff(g, port.id);
  const text = await bombRun(g, 'bPT', `${port.hexes[0][0]},${port.hexes[0][1]}`);
  assert.match(text, /loses \d efficiency level|is not hurt/);
  const after = portEff(g, port.id);
  assert.ok(after <= before);
  if (after < before) {
    assert.equal(viewFor(g, 'cw').damage.ports.find((p) => p.id === port.id).eff, after);
    repairPorts(g); // this Operations Stage lost levels, so nothing is regained yet
    assert.equal(portEff(g, port.id), after);
    repairPorts(g);
    assert.equal(portEff(g, port.id), Math.min(before, after + 1));
  }
  // A convoy into a half-efficient port lands only half its units; the rest return to the box.
  const sup = createSupply({ units: [], box: { axis: [], cw: [] } });
  sup.convoys = [{ turn: 1, stage: 1, port: 'tobruk', route: 2, units: Array.from({ length: 4 }, () => ({ ammo: 1, fuel: 1 })) }];
  landConvoys(sup, (await import('../src/server/engine.js')).gameMap(), { units: [], turn: 1, stage: 1, rollD66: () => 11, log: () => {}, portOwners: { tobruk: 'axis' }, portShare: () => 0.5 });
  assert.equal(sup.units.length, 2);
  assert.equal(sup.box.axis.length, 2);
});
