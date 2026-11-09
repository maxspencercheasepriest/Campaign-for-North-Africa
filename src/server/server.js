// Game host: serves the client over HTTP and runs the authoritative game over WebSockets.
// The host's Electron app starts this locally; a Cloudflare tunnel exposes it to the other players.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { SIDES, ROLES } from '../shared/scenario.js';
import { previewAttack, createGame, submitOrders, unready, act, viewFor, currentStep, actingSides, actingRole, autoDecide, autoOrders, STEPS } from './engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');
const STATIC_ROOTS = { '/shared/': path.join(SRC, 'shared'), '/': path.join(SRC, 'client') };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function startServer({ port = 0, savePath = null, hostToken = crypto.randomBytes(16).toString('hex') } = {}) {
  let room = {
    phase: 'lobby', // lobby | game
    players: [], // { id, token, name, side, role, connected }
    game: null,
    chat: [],
    marks: { axis: [], cw: [] },
  };
  if (savePath && fs.existsSync(savePath)) {
    try {
      room = { ...room, ...JSON.parse(fs.readFileSync(savePath, 'utf8')) };
      for (const p of room.players) p.connected = false;
      if (room.game && room.game.version !== 7) {
        console.error('Save is from an older rules version; returning to the lobby with seats kept.');
        room.game = null;
        room.phase = 'lobby';
      }
    } catch (e) {
      console.error('Could not read save, starting fresh:', e.message);
    }
  }

  const save = () => {
    if (!savePath) return;
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    const tmp = savePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ phase: room.phase, players: room.players.map(({ connected, ...p }) => p), game: room.game, chat: room.chat.slice(-200) }));
    fs.renameSync(tmp, savePath);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const [prefix, root] = Object.entries(STATIC_ROOTS).find(([pre]) => p.startsWith(pre));
    const file = path.normalize(path.join(root, p.slice(prefix.length)));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  const sockets = new Map(); // ws -> player id

  const playerOf = (ws) => room.players.find((p) => p.id === sockets.get(ws));
  const isHost = (ws) => !!playerOf(ws)?.isHost;

  // Who may act for a side in the current stage: the seat owner, else the C-in-C, else anyone on that side.
  function authority(side, role) {
    const onSide = room.players.filter((p) => p.side === side);
    return onSide.find((p) => p.role === role) || onSide.find((p) => p.role === 'cic') || onSide[0] || null;
  }

  // Sides with nobody seated pass automatically so a game can be tested solo.
  function autoActEmptySides() {
    if (room.phase !== 'game' || !room.game) return;
    for (let guard = 0; guard < 500 && !room.game.over; guard++) {
      const empty = actingSides(room.game).filter((s) => !room.players.some((p) => p.side === s));
      if (!empty.length) return;
      const s = empty[0];
      const step = room.game.step;
      if (room.game.decision) autoDecide(room.game);
      else if (step === 'movecombat') act(room.game, s, { action: 'endPhase' });
      else if (step === 'declare') submitOrders(room.game, s, { goFirst: true });
      else submitOrders(room.game, s, autoOrders(room.game, s));
    }
  }

  function broadcast() {
    for (const [ws, pid] of sockets) {
      const me = room.players.find((p) => p.id === pid);
      if (!me || ws.readyState !== 1) continue;
      const step = room.game ? currentStep(room.game) : null;
      const msg = {
        type: 'state',
        you: { id: me.id, name: me.name, side: me.side, role: me.role, isHost: !!me.isHost },
        phase: room.phase,
        players: room.players.map(({ token, ...p }) => p),
        marks: me.side ? room.marks?.[me.side] || [] : [],
        chat: room.chat.filter((c) => c.channel === 'all' || c.channel === me.side).slice(-60),
        steps: STEPS,
      };
      if (room.game && me.side) {
        // A player sees their own seat, plus any vacant seat they stand in for.
        const covered = me.role ? ROLES.filter((r) => r === me.role || authority(me.side, r)?.id === me.id) : null;
        msg.game = viewFor(room.game, me.side, covered);
        const auth = authority(me.side, actingRole(room.game));
        msg.canAct = !room.game.over && actingSides(room.game).includes(me.side) && auth?.id === me.id;
        msg.actingFor = auth ? auth.name : null;
      } else if (room.game) {
        const v = viewFor(room.game, 'axis');
        msg.game = { ...v, units: [], supply: [], box: 0, seg: null, obligations: [], myOrders: null, air: null, log: room.game.log.filter((l) => l.side === 'all').slice(-60) };
      }
      ws.send(JSON.stringify(msg));
    }
  }

  const reply = (ws, type, text) => ws.readyState === 1 && ws.send(JSON.stringify({ type, text }));

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      const me = playerOf(ws);

      if (m.type === 'hello') {
        const name = String(m.name || 'Officer').slice(0, 24);
        let p = room.players.find((x) => x.token && x.token === m.token);
        if (!p) {
          p = { id: crypto.randomUUID(), token: crypto.randomBytes(16).toString('hex'), name, side: null, role: null };
          room.players.push(p);
        }
        p.name = name;
        p.connected = true;
        if (m.hostToken && m.hostToken === hostToken) {
          for (const other of room.players) other.isHost = false;
          p.isHost = true;
        }
        sockets.set(ws, p.id);
        ws.send(JSON.stringify({ type: 'welcome', token: p.token }));
        broadcast();
        return;
      }
      if (!me) return;

      switch (m.type) {
        case 'claim': {
          if (!SIDES.includes(m.side) || !ROLES.includes(m.role)) return;
          const taken = room.players.find((p) => p.side === m.side && p.role === m.role && p.id !== me.id);
          if (taken) return reply(ws, 'error', `${taken.name} already holds that seat.`);
          me.side = m.side; me.role = m.role;
          break;
        }
        case 'leaveSeat':
          me.side = null; me.role = null;
          break;
        case 'start':
          if (!isHost(ws)) return reply(ws, 'error', 'Only the host can start the campaign.');
          if (room.phase !== 'game') {
            room.game ||= createGame(m.options || {});
            room.phase = 'game';
          }
          break;
        case 'submit': {
          if (room.phase !== 'game' || !me.side) return;
          const step = currentStep(room.game);
          if (authority(me.side, step.role)?.id !== me.id) return reply(ws, 'error', `This step is for the ${step.role} seat.`);
          const err = submitOrders(room.game, me.side, m.orders);
          if (err) return reply(ws, 'error', err);
          break;
        }
        case 'action': {
          if (room.phase !== 'game' || !me.side) return;
          const role = actingRole(room.game);
          if (authority(me.side, role)?.id !== me.id) return reply(ws, 'error', `This is for the ${role} seat.`);
          const err = act(room.game, me.side, m);
          if (err) return reply(ws, 'error', err);
          break;
        }
        case 'odds': {
          if (room.phase !== 'game' || !me.side) return;
          let odds = null;
          try { odds = previewAttack(room.game, me.side, m); } catch { /* no preview */ }
          ws.send(JSON.stringify({ type: 'odds', id: m.targetId, odds }));
          return; // no state change: a broadcast would redraw the panel and reset the tick boxes
        }
        case 'unready': {
          if (room.phase !== 'game' || !me.side) return;
          const step = currentStep(room.game);
          if (authority(me.side, step.role)?.id !== me.id) return;
          unready(room.game, me.side);
          break;
        }
        case 'force': {
          // Host override: pass the current step for whichever side is holding things up.
          if (!isHost(ws) || room.phase !== 'game') return;
          if (room.game.decision) { autoDecide(room.game); break; }
          for (const s of actingSides(room.game)) {
            if (room.game.step === 'movecombat') {
              room.game.seg.mode = 'move'; // skip outstanding attack obligations
              act(room.game, s, { action: 'endPhase' });
            } else if (room.game.step === 'declare') submitOrders(room.game, s, { goFirst: true });
            else submitOrders(room.game, s, autoOrders(room.game, s));
          }
          break;
        }
        case 'chat': {
          const channel = m.channel === 'team' && me.side ? me.side : 'all';
          const text = String(m.text || '').slice(0, 400).trim();
          if (!text) return;
          room.chat.push({ from: me.name, side: me.side, role: me.role, channel, text, at: Date.now() });
          if (room.chat.length > 400) room.chat.splice(0, 100);
          break;
        }
        case 'mark': {
          if (!me.side || !room.marks?.[me.side]) return;
          const list = room.marks[me.side];
          const hex = (h) => Array.isArray(h) && h.length === 2 && h.every((n) => Number.isInteger(n)) ? h : null;
          if (m.op === 'add' && m.mark && ['pin', 'arrow'].includes(m.mark.kind) && hex(m.mark.at) && (m.mark.kind === 'pin' || hex(m.mark.to))) {
            list.push({ id: (list.at(-1)?.id || 0) + 1, kind: m.mark.kind, at: m.mark.at, to: m.mark.kind === 'arrow' ? m.mark.to : undefined, text: String(m.mark.text || '').slice(0, 40), by: me.name });
            if (list.length > 60) list.shift();
          } else if (m.op === 'del') { const i = list.findIndex((x) => x.id === m.id); if (i >= 0) list.splice(i, 1); }
          else if (m.op === 'clear') list.length = 0;
          break;
        }
        case 'kick': {
          if (!isHost(ws)) return;
          const target = room.players.find((p) => p.id === m.playerId && !p.isHost);
          if (target) { target.side = null; target.role = null; }
          break;
        }
        default:
          return;
      }
      if (room.phase === 'game') autoActEmptySides();
      save();
      broadcast();
    });

    ws.on('close', () => {
      const p = playerOf(ws);
      sockets.delete(ws);
      if (p && ![...sockets.values()].includes(p.id)) p.connected = false;
      broadcast();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        url: `http://127.0.0.1:${actual}`,
        hostToken,
        close: () => new Promise((r) => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(() => r()); }),
      });
    });
  });
}
