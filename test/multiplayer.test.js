// Headless end-to-end test: host + players over real WebSockets, through a full turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import WebSocket from 'ws';
import { startServer } from '../src/server/server.js';
import { gameMap } from '../src/server/engine.js';
import { stepCost } from '../src/shared/rules.js';
import { neighbours, key } from '../src/shared/hex.js';
import { hexFromName } from '../src/shared/hexnames.js';

let lastMessage = Date.now();
function client(url, name, hostToken) {
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  const c = { ws, state: null, errors: [], waiters: [] };
  ws.on('message', (raw) => {
    lastMessage = Date.now();
    const m = JSON.parse(raw);
    if (m.type === 'state') { c.state = m; c.waiters.splice(0).forEach((f) => f()); }
    if (m.type === 'error') c.errors.push(m.text);
  });
  c.send = (msg) => ws.send(JSON.stringify(msg));
  c.next = () => new Promise((r) => c.waiters.push(r));
  c.ready = new Promise((r) => ws.on('open', () => { c.send({ type: 'hello', name, hostToken }); r(); }));
  return c;
}
// Wait until the server has been quiet for 150ms (robust on a busy machine), at most 5s.
const waitFor = async (fn, ms = 6000) => {
  const start = Date.now();
  while (!fn() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 40));
};
const settle = async () => {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 300));
  while (Date.now() - lastMessage < 150 && Date.now() - start < 5000) await new Promise((r) => setTimeout(r, 50));
};

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
  host.send({ type: 'start', options: { seed: 1 } });
  await settle();
  assert.equal(host.state.phase, 'game', JSON.stringify(host.errors));

  // Fog: Commonwealth must not see Axis units in Tripoli, nor any enemy supply figures.
  const cwView = host.state.game.units;
  assert.ok(!cwView.some((u) => u.id === 'it-pav'), 'Pavia in Tripoli should be hidden from the Commonwealth');
  assert.ok(cwView.filter((u) => u.side === 'axis').every((u) => u.fuelAvail === undefined));

  // Convoy step: the Convoy seat is empty on both sides, so the C-in-Cs act; Ben (front) cannot.
  assert.equal(host.state.game.step, 'convoy');
  assert.equal(host.state.canAct, true);
  assert.equal(ally.state.canAct, false);
  host.send({ type: 'submit', orders: {} });
  axisC.send({ type: 'submit', orders: { port: 'benghazi', route: 2, n: 1 } });
  await settle();
  assert.ok(axisC.state.game.log.some((l) => /Convoy on route 2 to Benghazi/.test(l.text)), JSON.stringify([axisC.errors, axisC.state.game.log.slice(-4), axisC.state.game.step]));

  // Initiative declaration: the Axis holds the initiative on Game-Turn 1, so only Dave can act.
  assert.equal(axisC.state.game.step, 'declare');
  assert.equal(axisC.state.canAct, true);
  assert.equal(host.state.canAct, false);
  axisC.send({ type: 'submit', orders: { goFirst: false } });
  await settle();
  assert.deepEqual(host.state.game.order, { A: 'cw', B: 'axis' });

  // Commonwealth is Player A: Ben (front seat) moves the 7th Armoured one hex west.
  assert.equal(ally.state.game.step, 'movecombat');
  assert.equal(ally.state.canAct, true);
  assert.equal(host.state.canAct, false);
  const arm = ally.state.game.units.find((u) => u.id === 'cw-7arm');
  const dest = neighbours(...arm.pos).find((h) => stepCost(gameMap(), arm.pos, h, { motorised: true }) && !ally.state.game.units.some((u) => key(...u.pos) === key(...h)));
  ally.send({ type: 'action', action: 'move', unitId: arm.id, path: [dest] });
  await settle();
  const armAfter = ally.state.game.units.find((u) => u.id === 'cw-7arm');
  assert.deepEqual(armAfter.pos, dest);
  assert.ok(armAfter.cpUsed > 0);
  ally.send({ type: 'action', action: 'endPhase' });
  await settle();

  // Truck convoy phase belongs to the Rear Area seat; empty, so the C-in-C (host) acts.
  await waitFor(() => host.state.game.step === 'trucks');
  assert.equal(host.state.game.step, 'trucks');
  host.send({ type: 'submit', orders: { moves: [] } });
  await settle();
  assert.equal(host.state.game.half, 'B');

  // Host can force the rest of the turn along.
  for (let i = 0; i < 40 && host.state.game.turn === 1; i++) { host.send({ type: 'force' }); await settle(); }
  assert.equal(host.state.game.turn, 2);
  assert.equal(host.state.game.step, 'convoy');

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
});

test('static client files are served', async () => {
  const srv = await startServer({ port: 0 });
  for (const p of ['/', '/client.js', '/style.css', '/shared/hex.js', '/shared/scenario.js', '/tutorial.js']) {
    const r = await fetch(srv.url + p);
    assert.equal(r.status, 200, p);
  }
  assert.equal((await fetch(srv.url + '/../server/server.js')).status, 404);
  await srv.close();
});
