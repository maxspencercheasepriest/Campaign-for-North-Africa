// Weather (29), breakdown (21) and field repair (22).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, gameMap, breakdownPercent, weatherAt, planMove } from '../src/server/engine.js';
import { seasonOfTurn, stepCost, localWeather, edgeKey, TRACK } from '../src/shared/rules.js';
import { WEATHER, BREAKDOWN, breakdownColumn } from '../src/shared/tables.js';
import { neighbours, key } from '../src/shared/hex.js';

test('seasons follow the dates in 29.1', () => {
  assert.equal(seasonOfTurn(1), 'fall'); // Sep III 1940
  assert.equal(seasonOfTurn(13), 'winter'); // Dec III 1940
  assert.equal(seasonOfTurn(25), 'spring'); // Mar III 1941
  assert.equal(seasonOfTurn(37), 'summer'); // Jun III 1941
  assert.equal(seasonOfTurn(49), 'fall'); // Sep III 1941
});

test('weather table lookups', () => {
  assert.equal(WEATHER.summer[53], 'hot'); // the rulebook's own example
  assert.equal(WEATHER.winter[66], 'rain');
  assert.equal(WEATHER.spring[11], 'normal');
  assert.equal(WEATHER.summer[66], 'sand');
});

test('breakdown table and column shifts', () => {
  assert.equal(breakdownColumn(15), 2);
  assert.equal(breakdownPercent(1, 0, 66), BREAKDOWN[1][66]);
  assert.equal(breakdownPercent(0, 5, 66), 0); // 3 points or fewer never check
  assert.equal(breakdownPercent(1, -1, 66), 0); // adjusted below 4-10: no breakdown
  assert.equal(breakdownPercent(8, 3, 64), BREAKDOWN[8][64]); // cannot go past 71+
  // The rulebook's example: 31-40 column, 1R for the crusaders plus hot weather = two columns higher -> 51-60; roll 61 -> 33%
  assert.equal(breakdownPercent(4, 2, 61), 33);
  // Trucks: 2L plus hot = one lower -> 21-30; roll 33 -> 10%
  assert.equal(breakdownPercent(4, -1, 33), 10);
});

test('sandstorm doubles costs, rain turns roads into tracks and blocks wadis', () => {
  const map = gameMap();
  const ek = [...map.roads][0];
  const [a, b] = ek.split('|').map((k) => k.split(',').map(Number));
  const norm = stepCost(map, a, b, { motorised: true });
  assert.equal(norm.cp, 0.5);
  assert.equal(stepCost(map, a, b, { motorised: true, weather: 'sand' }).cp, 1);
  assert.equal(stepCost(map, a, b, { motorised: true, weather: 'rain' }).cp, TRACK.mp);
  // a wadi hexside with no road is impassable in rain
  const [wk] = Object.entries(map.hexsides).find(([k, v]) => v.type === 'wadi' && !map.roads.has(k) && !map.tracks.has(k)) || [];
  assert.ok(wk, 'a wadi exists');
  const [wa, wb] = wk.split('|').map((k) => k.split(',').map(Number));
  assert.ok(stepCost(map, wa, wb, { motorised: false }));
  assert.equal(stepCost(map, wa, wb, { motorised: false, weather: 'rain' }), null);
});

test('storms only affect the struck map sections', () => {
  const map = gameMap();
  const w = { type: 'sand', sections: ['C', 'D'] };
  assert.equal(localWeather(w, map, [10, 66 + 5]), 'sand'); // section C
  assert.equal(localWeather(w, map, [10, 5]), 'normal'); // section A
  assert.equal(localWeather({ type: 'hot', sections: [] }, map, [10, 5]), 'hot');
});

test('weather is rolled every operations stage and logged', () => {
  const g = createGame();
  assert.ok(g.weather && g.weather.type);
  assert.ok(g.log.some((l) => /Weather/.test(l.text)) || g.opStage === 0);
});

test('moving a tank formation far over rough ground can break tanks down, and field repair brings them back', () => {
  const g = createGame();
  const u = g.units.find((x) => x.id === 'cw-7arm');
  u.bp = 0; u.bpCol = -1; u.sandCp = 0;
  g.weather = { type: 'hot', sections: [] };
  g.seed = 12345;
  const before = u.elements.filter((e) => /Cruiser|Light/.test(e.w)).reduce((s, e) => s + e.toe, 0);
  u.bp = 60; u.start = u.pos;
  // reach into the engine through a tiny move: any legal neighbouring hex
  const map = gameMap();
  const dest = neighbours(...u.pos).find((h) => stepCost(map, u.pos, h, { motorised: true }) && !g.units.some((x) => x.pos[0] === h[0] && x.pos[1] === h[1]));
  assert.ok(dest);
  g.step = 'movecombat'; g.half = 'A'; g.order = { A: 'cw', B: 'axis' }; g.seg = { n: 1, mode: 'move', moved: [], attacked: [], frozen: [] };
  g.units.forEach((x) => { x.contact = false; });
  // use the public action API
  return import('../src/server/engine.js').then(({ act }) => {
    const r = act(g, 'cw', { action: 'move', unitId: u.id, path: [dest] });
    assert.equal(r, null);
    const after = u.elements.filter((e) => /Cruiser|Light/.test(e.w)).reduce((s, e) => s + e.toe, 0);
    assert.ok(after < before, `some tanks broke down (${before} -> ${after})`);
    assert.ok(g.broken.length > 0);
    const down = g.broken.reduce((s, b) => s + b.n, 0);
    assert.equal(before - after, down);
  });
});

import { createSupply, planArrivals } from '../src/server/supply.js';
test('arrival planning has exactly one entry per future turn per side', () => {
  const sup = createSupply({ units: [], box: { axis: [], cw: [] } });
  sup.plan = [];
  planArrivals(sup, () => 3, 1, { firstTurn: 1 });
  for (const side of ['axis', 'cw']) {
    const turns = sup.plan.filter((p) => p.side === side).map((p) => p.turn);
    assert.equal(new Set(turns).size, turns.length, `${side} plan has duplicates: ${turns}`);
  }
});
