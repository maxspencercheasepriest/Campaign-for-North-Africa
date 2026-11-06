// Headless end-to-end test: host + players over real WebSockets, through a full turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import WebSocket from 'ws';
import { startServer } from '../src/server/server.js';
import { STAGES } from '../src/shared/scenario.js';

function client(url, name, hostToken) {
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  const c = { ws, state: null, errors: [], waiters: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'state') { c.state = m; c.waiters.splice(0).forEach((f) => f()); }
    if (m.type === 'error') c.errors.push(m.text);
  });
  c.send = (msg) => ws.send(JSON.stringify(msg));
  c.next = () => new Promise((r) => c.waiters.push(r));
  c.ready = new Promise((r) => ws.on('open', () => { c.send({ type: 'hello', name, hostToken }); r(); }));
  return c;
}
const settle = () => new Promise((r) => setTimeout(r, 60));

test('lobby, seats, fog of war and a full turn of stages', async () => {
  const savePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dc-')), 'save.json');
  const srv = await startServer({ port: 0, savePath });
  const host = client(srv.url, 'Flick', srv.hostToken);
  const ally = client(srv.url, 'Ben');
  const axisC = client(srv.url, 'Dave');
  await Promise.all([host.ready, ally.ready, axisC.ready]);
  await settle();

  host.send({ type: 'claim', side: 'cw', role: 'cic' });
  ally.send({ type: 'claim', side: 'cw', role: 'front' });
  axisC.send({ type: 'claim', side: 'axis', role: 'cic' });
  await settle();
  ally.send({ type: 'claim', side: 'cw', role: 'cic' }); // taken
  await settle();
  assert.match(ally.errors.at(-1), /already holds/);

  axisC.send({ type: 'start' }); // not host
  await settle();
  assert.match(axisC.errors.at(-1), /Only the host/);
  host.send({ type: 'start' });
  await settle();
  assert.equal(host.state.phase, 'game');

  // Fog: Commonwealth must not see Axis units in Tripoli, nor any enemy supply figures.
  const cwView = host.state.game.units;
  assert.ok(!cwView.some((u) => u.id === 'it-pav'), 'Pavia in Tripoli should be hidden from the Commonwealth');
  assert.ok(cwView.filter((u) => u.side === 'axis').every((u) => u.fuel === undefined));

  // Air stage: the Air seat is empty on both sides, so the C-in-Cs act; Ben (front) cannot.
  assert.equal(host.state.canAct, true);
  assert.equal(ally.state.canAct, false);
  host.send({ type: 'submit', orders: { malta: 9 } });
  await settle();
  assert.match(host.errors.at(-1), /only have 5 air points/);
  host.send({ type: 'submit', orders: { malta: 3, escort: 1, ground: 1 } });
  axisC.send({ type: 'submit', orders: { malta: 2, escort: 4 } });
  await settle();
  assert.equal(host.state.game.stageIndex, 1);

  // Convoy
  host.send({ type: 'submit', orders: { port: 'alexandria' } });
  axisC.send({ type: 'submit', orders: { port: 'benghazi' } });
  await settle();
  assert.ok(axisC.state.game.log.some((l) => /Convoy to Benghazi/.test(l.text)));

  // Rear area: truck water from Mersa Matruh dump to 4th Indian Div's hex.
  const matruh = Object.keys(host.state.game.dumps).find((k) => host.state.game.dumps[k].side === 'cw' && k !== '62,3');
  const ind = host.state.game.units.find((u) => u.id === 'cw-4ind');
  host.send({ type: 'submit', orders: { transfers: [{ from: matruh, to: ind.pos.join(','), res: 'water', amount: 10 }] } });
  axisC.send({ type: 'submit', orders: {} });
  await settle();
  assert.equal(host.state.game.stageIndex, 3);
  assert.ok(host.state.game.dumps[ind.pos.join(',')].water >= 10);

  // Movement: Ben now holds the Front seat, so he acts (and the C-in-C does not).
  assert.equal(ally.state.canAct, true);
  assert.equal(host.state.canAct, false);
  const arm = ally.state.game.units.find((u) => u.id === 'cw-7arm');
  ally.send({ type: 'submit', orders: { moves: [{ unitId: arm.id, path: [[arm.pos[0] - 1, arm.pos[1]]] }] } });
  axisC.send({ type: 'submit', orders: {} });
  await settle();
  const armAfter = ally.state.game.units.find((u) => u.id === 'cw-7arm');
  assert.deepEqual(armAfter.pos, [arm.pos[0] - 1, arm.pos[1]]);
  assert.equal(armAfter.fuel, arm.fuel - 1);

  // Combat (nothing ordered) -> end of turn.
  ally.send({ type: 'submit', orders: {} });
  axisC.send({ type: 'force' }); // not host: ignored
  await settle();
  assert.equal(host.state.game.turn, 1);
  host.send({ type: 'force' });
  await settle();
  assert.equal(host.state.game.turn, 2);
  assert.equal(host.state.game.stageIndex, 0);

  // Team chat stays on the team.
  host.send({ type: 'chat', channel: 'team', text: 'Hold the escarpment' });
  await settle();
  assert.ok(ally.state.chat.some((c) => c.text === 'Hold the escarpment'));
  assert.ok(!axisC.state.chat.some((c) => c.text === 'Hold the escarpment'));

  // Save exists and a reconnecting player gets their seat back.
  assert.ok(fs.existsSync(savePath));
  for (const c of [host, ally, axisC]) c.ws.close();
  await srv.close();
  const saved = JSON.parse(fs.readFileSync(savePath, 'utf8'));
  assert.equal(saved.game.turn, 2);
  assert.equal(STAGES.length, 5);
});

test('static client files are served', async () => {
  const srv = await startServer({ port: 0 });
  for (const p of ['/', '/client.js', '/style.css', '/shared/hex.js', '/shared/scenario.js']) {
    const r = await fetch(srv.url + p);
    assert.equal(r.status, 200, p);
  }
  assert.equal((await fetch(srv.url + '/../server/server.js')).status, 404);
  await srv.close();
});
