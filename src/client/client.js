import { key, parseKey, distance, neighbours, hexToPixel, pixelToHex } from '/shared/hex.js';
import {
  MAP_COLS, MAP_ROWS, SIDES, SIDE_NAMES, ROLES, ROLE_NAMES, PORTS, TERRAIN, ROAD_COST, VISION_RANGE, buildMap,
} from '/shared/scenario.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const params = new URLSearchParams(location.search);
const hostToken = params.get('host');
const inviteUrl = params.get('invite');
const TILES = buildMap();

let ws;
let S = null; // last state from server
let draft = {}; // orders being built for the current stage
let draftStageKey = null;
let selected = null; // selected own unit id
let hoverHex = null;

// ---------- Connection ----------

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onopen = () => {
    $('conn').textContent = 'connected';
    $('conn').className = 'conn ok';
    ws.send(JSON.stringify({ type: 'hello', name: store.get('dc:name'), token: store.get(`dc:token:${location.host}`), hostToken }));
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'welcome') store.set(`dc:token:${location.host}`, m.token);
    else if (m.type === 'error') toast(m.text);
    else if (m.type === 'state') { S = m; render(); }
  };
  ws.onclose = () => {
    $('conn').textContent = 'reconnecting…';
    $('conn').className = 'conn bad';
    setTimeout(connect, 1500);
  };
}
const send = (msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 4000);
}

// ---------- Name gate ----------

if (!store.get('dc:name')) $('nameGate').classList.remove('hidden');
else connect();
$('nameForm').addEventListener('submit', (e) => {
  e.preventDefault();
  store.set('dc:name', $('nameInput').value.trim());
  $('nameGate').classList.add('hidden');
  connect();
});

// ---------- Top bar ----------

if (inviteUrl) $('inviteBtn').classList.remove('hidden');
$('inviteBtn').onclick = async () => {
  try {
    if (window.desktop) await window.desktop.copy(inviteUrl);
    else await navigator.clipboard.writeText(inviteUrl);
    toast(`Copied ${inviteUrl}`);
  } catch { toast(inviteUrl); }
};
if (window.desktop) {
  $('launcherBtn').classList.remove('hidden');
  $('launcherBtn').onclick = () => { if (confirm('Leave this game? If you are hosting, everyone will be disconnected (the campaign is saved).')) window.desktop.backToLauncher(); };
}
$('forceBtn').onclick = () => { if (confirm('Resolve this stage now? Anyone not ready submits no orders.')) send({ type: 'force' }); };

// ---------- Render root ----------

function render() {
  const inGame = S.phase === 'game';
  $('lobby').classList.toggle('hidden', inGame);
  $('game').classList.toggle('hidden', !inGame);
  $('forceBtn').classList.toggle('hidden', !(inGame && S.you.isHost));
  renderTop();
  if (!inGame) return renderLobby();
  const sk = `${S.game.turn}:${S.game.stageIndex}`;
  if (sk !== draftStageKey) { draftStageKey = sk; draft = S.game.myOrders ? structuredClone(S.game.myOrders) : {}; selected = null; }
  renderOrders();
  renderSupply();
  $('tab-staff').innerHTML = '';
  $('tab-staff').appendChild(seatGrid());
  renderLog();
  renderChat();
  drawMap();
}

function renderTop() {
  if (S.phase !== 'game') { $('turnInfo').textContent = 'Lobby'; $('readyInfo').textContent = ''; return; }
  const st = S.stages[S.game.stageIndex];
  $('turnInfo').innerHTML = `Turn <b>${S.game.turn}</b> · <b>${esc(st.name)}</b> <span class="muted">(${esc(ROLE_NAMES[st.role])})</span>`;
  $('readyInfo').innerHTML = SIDES.map((s) => `<span class="pill ${S.game.ready[s] ? 'ready' : ''}">${SIDE_NAMES[s]}: ${S.game.ready[s] ? 'orders in' : 'planning'}</span>`).join(' ');
}

// ---------- Lobby / staff ----------

function seatGrid() {
  const grid = document.createElement('div');
  grid.className = 'seat-grid';
  for (const side of SIDES) {
    const col = document.createElement('div');
    col.className = `side-col ${side}`;
    col.innerHTML = `<h2>${SIDE_NAMES[side]}</h2>`;
    for (const role of ROLES) {
      const p = S.players.find((x) => x.side === side && x.role === role);
      const mine = p && p.id === S.you.id;
      const seat = document.createElement('button');
      seat.className = `seat ${p ? 'taken' : ''} ${mine ? 'mine' : ''}`;
      seat.innerHTML = `<span class="role">${ROLE_NAMES[role]}</span><span class="who">${p ? esc(p.name) + (p.connected ? '' : ' (away)') : 'vacant — take this seat'}</span>`;
      seat.disabled = !!p && !mine;
      seat.onclick = () => (mine ? send({ type: 'leaveSeat' }) : send({ type: 'claim', side, role }));
      if (mine) seat.title = 'Click to leave this seat';
      col.appendChild(seat);
    }
    grid.appendChild(col);
  }
  return grid;
}

function renderLobby() {
  const g = $('seatGrid');
  g.replaceWith(Object.assign(seatGrid(), { id: 'seatGrid' }));
  $('lobbyHost').classList.toggle('hidden', !S.you.isHost);
  $('lobbyWait').classList.toggle('hidden', S.you.isHost);
  const un = S.players.filter((p) => !p.side && p.connected);
  $('unseated').textContent = un.length ? `In the mess tent: ${un.map((p) => p.name).join(', ')}` : '';
}
$('startBtn').onclick = () => send({ type: 'start', options: { pastaRule: $('optPasta').checked } });

// ---------- Tabs ----------

for (const b of document.querySelectorAll('#tabs button')) {
  b.onclick = () => {
    for (const x of document.querySelectorAll('#tabs button')) x.classList.toggle('active', x === b);
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('hidden', t.id !== `tab-${b.dataset.tab}`);
  };
}

// ---------- Helpers on game state ----------

const mySide = () => S.you.side;
const myUnits = () => (S.game.units || []).filter((u) => u.side === mySide());
const enemyUnits = () => (S.game.units || []).filter((u) => u.side !== mySide());
const unitAt = (c, r) => (S.game.units || []).find((u) => u.pos[0] === c && u.pos[1] === r);
const portName = (k) => PORTS.find((p) => key(p.col, p.row) === k)?.name;
const hexLabel = (k) => portName(k) || `hex ${k}`;
const stage = () => S.stages[S.game.stageIndex];

function moveCost(c, r) {
  const t = TILES[key(c, r)];
  if (!t) return Infinity;
  return t.road ? ROAD_COST : TERRAIN[t.t].cost;
}

// Cheapest paths within the unit's movement allowance (and fuel for vehicles).
function reachable(u) {
  const best = new Map([[key(...u.pos), { cost: 0, steps: 0, prev: null }]]);
  const queue = [u.pos];
  const enemyAt = new Set(enemyUnits().map((e) => key(...e.pos)));
  while (queue.length) {
    queue.sort((a, b) => best.get(key(...a)).cost - best.get(key(...b)).cost);
    const cur = queue.shift();
    const cb = best.get(key(...cur));
    for (const n of neighbours(...cur)) {
      if (n[0] < 0 || n[1] < 0 || n[0] >= MAP_COLS || n[1] >= MAP_ROWS) continue;
      const k = key(...n);
      if (enemyAt.has(k)) continue;
      const cost = cb.cost + moveCost(...n);
      const steps = cb.steps + 1;
      if (cost > u.mp || (u.type !== 'inf' && steps > u.fuel)) continue;
      if (!best.has(k) || best.get(k).cost > cost) { best.set(k, { cost, steps, prev: key(...cur) }); queue.push(n); }
    }
  }
  return best;
}
function pathTo(reach, k) {
  const path = [];
  while (reach.get(k)?.prev) { path.unshift(parseKey(k)); k = reach.get(k).prev; }
  return path;
}

// ---------- Orders panel ----------

function renderOrders() {
  const el = $('tab-orders');
  const st = stage();
  const g = S.game;
  if (g.winner) { el.innerHTML = `<h3>Campaign over</h3><p>${SIDE_NAMES[g.winner]} victory.</p>`; return; }
  if (!mySide()) { el.innerHTML = '<p>You are not on a staff. Take a seat in the <b>Staff</b> tab.</p>'; return; }
  const ready = g.ready[mySide()];
  let head = `<h3>${esc(st.name)}</h3>`;
  if (!S.canAct) head += `<p class="note">${esc(S.actingFor || 'Nobody')} is issuing ${SIDE_NAMES[mySide()]} orders this stage. You can watch the map and advise in staff chat.</p>`;
  else if (ready) head += '<p class="note ok">Orders are in. Waiting for the other staff.</p>';
  const body = { air: airForm, convoy: convoyForm, rear: rearForm, move: moveForm, combat: combatForm }[st.id]();
  el.innerHTML = head + body;
  const disabled = !S.canAct || ready;
  for (const input of el.querySelectorAll('input, select, button.edit')) input.disabled = disabled;
  if (S.canAct) {
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = ready ? 'Change orders' : 'Submit orders';
    btn.onclick = () => (ready ? send({ type: 'unready' }) : send({ type: 'submit', orders: draft }));
    el.appendChild(btn);
  }
  wireOrders(el);
}

function airForm() {
  const pts = S.game.airPoints;
  const v = (k) => draft[k] ?? 0;
  const used = ['malta', 'escort', 'ground'].reduce((a, k) => a + v(k), 0);
  return `<p>Allot your ${pts} air points. <b>${used}/${pts}</b> assigned.</p>
  <label class="row">Malta missions <input type="number" min="0" max="${pts}" data-air="malta" value="${v('malta')}"></label>
  <label class="row">Convoy escort <input type="number" min="0" max="${pts}" data-air="escort" value="${v('escort')}"></label>
  <label class="row">Ground support <input type="number" min="0" max="${pts}" data-air="ground" value="${v('ground')}"></label>
  <p class="help">${mySide() === 'axis' ? 'Raids on Malta and escorts cut convoy losses.' : 'Malta strikes sink Axis convoys; escorts protect your own.'} Ground support is split across this turn's attacks.</p>`;
}

function convoyForm() {
  const ports = PORTS.filter((p) => S.game.portOwners[p.id] === mySide());
  return `<p>Choose where this stage's convoy unloads. Bigger ports land more of it.</p>
  <select data-convoy><option value="">No convoy</option>${ports.map((p) => `<option value="${p.id}" ${draft.port === p.id ? 'selected' : ''}>${p.name} (capacity ${Math.round(p.capacity * 100)}%)</option>`).join('')}</select>`;
}

function rearForm() {
  draft.transfers ||= [];
  const dumps = Object.entries(S.game.dumps).filter(([, d]) => d.side === mySide() && !d.spotted);
  const dests = new Map(dumps.map(([k]) => [k, hexLabel(k)]));
  for (const u of myUnits()) if (!dests.has(key(...u.pos))) dests.set(key(...u.pos), `${u.name} (${key(...u.pos)})`);
  const load = draft.transfers.reduce((a, t) => a + t.amount * Math.max(1, Math.ceil(distance(parseKey(t.from), parseKey(t.to)) / 8)), 0);
  const opt = (m) => [...m].map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('');
  return `<p>Truck capacity used: <b>${load}/${S.game.truckCapacity}</b> (amount × distance in 8-hex legs). Trucks burn fuel at the source dump.</p>
  <div class="transfer">
    <select id="tFrom">${opt(new Map(dumps.map(([k]) => [k, hexLabel(k)])))}</select>
    <span>→</span>
    <select id="tTo">${opt(dests)}</select>
    <select id="tRes"><option>fuel</option><option>water</option><option>ammo</option><option>stores</option></select>
    <input id="tAmt" type="number" min="1" value="10">
    <button class="edit" data-add-transfer>Add</button>
  </div>
  <ul class="orders">${draft.transfers.map((t, i) => `<li>${t.amount} ${t.res}: ${esc(hexLabel(t.from))} → ${esc(hexLabel(t.to))} <button class="edit x" data-del-transfer="${i}">✕</button></li>`).join('') || '<li class="muted">No transfers.</li>'}</ul>`;
}

function moveForm() {
  draft.moves ||= [];
  const sel = myUnits().find((u) => u.id === selected);
  return `<p>Click one of your units, then click a highlighted hex. Moves are simultaneous; units stop on contact with the enemy.</p>
  ${sel ? `<p class="note">Selected: <b>${esc(sel.name)}</b> · ${sel.mp} MP${sel.type !== 'inf' ? ` · fuel ${sel.fuel}` : ''}</p>` : ''}
  <ul class="orders">${draft.moves.map((m, i) => {
    const u = myUnits().find((x) => x.id === m.unitId);
    return `<li>${esc(u?.name)} → ${key(...m.path.at(-1))} (${m.path.length} hexes) <button class="edit x" data-del-move="${i}">✕</button></li>`;
  }).join('') || '<li class="muted">No moves planned.</li>'}</ul>`;
}

function combatForm() {
  draft.attacks ||= [];
  const targets = enemyUnits().filter((e) => myUnits().some((u) => distance(u.pos, e.pos) === 1));
  if (!targets.length) return '<p>No enemy units are in contact. Submit to carry on.</p>' + attackList();
  return `<p>Pick a target and the adjacent units that will attack it. Each attacker spends ammunition.</p>
  ${targets.map((e) => {
    const adj = myUnits().filter((u) => distance(u.pos, e.pos) === 1);
    return `<div class="attack"><b>${esc(e.name)}</b> <span class="muted">(${e.str} steps, ${esc(TERRAIN[TILES[key(...e.pos)].t].label)})</span>
      ${adj.map((u) => `<label class="check"><input type="checkbox" data-att="${e.id}" value="${u.id}"> ${esc(u.name)} (${u.str}${u.ammo ? '' : ', no ammo!'})</label>`).join('')}
      <button class="edit" data-add-attack="${e.id}">Order attack</button></div>`;
  }).join('')}${attackList()}`;
}
const attackList = () => `<ul class="orders">${(draft.attacks || []).map((a, i) => {
  const t = enemyUnits().find((e) => e.id === a.targetId);
  return `<li>${a.attackerIds.length} unit(s) → ${esc(t?.name)} <button class="edit x" data-del-attack="${i}">✕</button></li>`;
}).join('')}</ul>`;

function wireOrders(el) {
  el.querySelectorAll('[data-air]').forEach((i) => (i.onchange = () => { draft[i.dataset.air] = Math.max(0, parseInt(i.value, 10) || 0); renderOrders(); }));
  el.querySelectorAll('[data-convoy]').forEach((s) => (s.onchange = () => { draft.port = s.value || null; }));
  el.querySelector('[data-add-transfer]')?.addEventListener('click', () => {
    const t = { from: $('tFrom').value, to: $('tTo').value, res: $('tRes').value, amount: parseInt($('tAmt').value, 10) || 0 };
    if (!t.from || !t.to || t.from === t.to || t.amount <= 0) return toast('Pick two different places and an amount.');
    draft.transfers.push(t); renderOrders(); drawMap();
  });
  el.querySelectorAll('[data-del-transfer]').forEach((b) => (b.onclick = () => { draft.transfers.splice(+b.dataset.delTransfer, 1); renderOrders(); drawMap(); }));
  el.querySelectorAll('[data-del-move]').forEach((b) => (b.onclick = () => { draft.moves.splice(+b.dataset.delMove, 1); renderOrders(); drawMap(); }));
  el.querySelectorAll('[data-add-attack]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.addAttack;
    const attackerIds = [...el.querySelectorAll(`[data-att="${id}"]:checked`)].map((c) => c.value);
    if (!attackerIds.length) return toast('Tick at least one attacking unit.');
    draft.attacks = draft.attacks.filter((a) => a.targetId !== id);
    draft.attacks.push({ targetId: id, attackerIds });
    renderOrders(); drawMap();
  }));
  el.querySelectorAll('[data-del-attack]').forEach((b) => (b.onclick = () => { draft.attacks.splice(+b.dataset.delAttack, 1); renderOrders(); drawMap(); }));
}

// ---------- Supply / log / chat ----------

function renderSupply() {
  const el = $('tab-supply');
  if (!mySide()) { el.innerHTML = ''; return; }
  const dumps = Object.entries(S.game.dumps).filter(([, d]) => d.side === mySide() && !d.spotted);
  const n = (v) => Math.floor(v);
  el.innerHTML = `<h3>Supply dumps</h3><table class="grid"><tr><th>Dump</th><th>Fuel</th><th>Water</th><th>Ammo</th><th>Stores</th></tr>
    ${dumps.map(([k, d]) => `<tr><td>${esc(hexLabel(k))}</td><td>${n(d.fuel)}</td><td>${n(d.water)}</td><td>${n(d.ammo)}</td><td>${n(d.stores)}</td></tr>`).join('')}</table>
    <h3>Formations</h3><table class="grid"><tr><th>Unit</th><th>Str</th><th>Fuel</th><th>Water</th><th>Ammo</th></tr>
    ${myUnits().map((u) => `<tr class="${u.water <= 0 ? 'warn' : ''}"><td>${esc(u.name)}</td><td>${u.str}/${u.maxStr}</td><td>${u.type === 'inf' ? '–' : u.fuel}</td><td>${u.water}</td><td>${u.ammo}</td></tr>`).join('')}</table>
    <p class="help">Units within 3 hexes of a friendly dump draw supplies at the end of each turn. Every unit drinks water each turn${S.game.options?.pastaRule ? ' (Italian units need extra for pasta)' : ''}; dumps lose fuel to leaking cans.</p>`;
}

function renderLog() {
  $('tab-log').innerHTML = (S.game.log || []).slice().reverse().map((l) => `<p class="logline ${l.side}"><span class="muted">T${l.turn}</span> ${esc(l.text)}</p>`).join('') || '<p class="muted">Nothing yet.</p>';
}

function renderChat() {
  const box = $('chatLog');
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 10;
  box.innerHTML = S.chat.map((c) => `<p class="chatline ${c.channel === 'all' ? 'all' : 'team'}"><b>${esc(c.from)}</b>${c.role ? ` <span class="muted">${esc(ROLE_NAMES[c.role])}</span>` : ''}${c.channel === 'all' ? ' <span class="muted">[all]</span>' : ''}: ${esc(c.text)}</p>`).join('');
  if (atBottom) box.scrollTop = box.scrollHeight;
}
$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  send({ type: 'chat', channel: $('chatChannel').value, text: $('chatInput').value });
  $('chatInput').value = '';
});

// ---------- Map ----------

const canvas = $('map');
const ctx = canvas.getContext('2d');
const view = { size: 22, ox: 30, oy: 30 };
const COLORS = { sea: '#7d9bab', coast: '#dcc791', desert: '#e6d3a3', rough: '#c3aa78', escarpment: '#9b8457', depression: '#cdb98d' };
const SIDE_COLORS = { axis: { fill: '#9a9f86', edge: '#3e4434' }, cw: { fill: '#d2ad6e', edge: '#5b3d16' } };
const NATION_COLORS = { it: '#a6ad7f', de: '#8f959b', uk: '#d2ad6e', in: '#c99d5f', au: '#d8b77a', nz: '#c7a76f' };

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width * devicePixelRatio;
  canvas.height = r.height * devicePixelRatio;
  canvas.style.width = r.width + 'px';
  canvas.style.height = r.height + 'px';
  if (S?.phase === 'game') drawMap();
}
addEventListener('resize', resize);
new ResizeObserver(resize).observe($('mapWrap'));

function hexPath(cx, cy, s) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    ctx[i ? 'lineTo' : 'moveTo'](cx + s * Math.cos(a), cy + s * Math.sin(a));
  }
  ctx.closePath();
}
const centre = (c, r) => { const p = hexToPixel(c, r, view.size); return { x: p.x + view.ox, y: p.y + view.oy }; };

function drawMap() {
  if (!S?.game) return;
  const s = view.size;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = '#5f7f90';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const own = myUnits();
  const visible = (c, r) => !mySide() || own.some((u) => distance(u.pos, [c, r]) <= VISION_RANGE);
  const reach = selected && stage().id === 'move' ? reachable(own.find((u) => u.id === selected)) : null;

  for (let c = 0; c < MAP_COLS; c++) {
    for (let r = 0; r < MAP_ROWS; r++) {
      const t = TILES[key(c, r)];
      const { x, y } = centre(c, r);
      hexPath(x, y, s);
      ctx.fillStyle = COLORS[t.t];
      ctx.fill();
      if (t.t === 'depression') { ctx.strokeStyle = '#a8946a'; ctx.lineWidth = 1; for (let i = -s; i < s; i += 5) { ctx.beginPath(); ctx.moveTo(x + i, y - s * 0.6); ctx.lineTo(x + i + 6, y + s * 0.6); ctx.stroke(); } }
      if (t.t === 'escarpment') { ctx.strokeStyle = '#6b5636'; ctx.lineWidth = 2; ctx.beginPath(); for (let i = -0.7; i <= 0.7; i += 0.35) { ctx.moveTo(x + i * s, y + 2); ctx.lineTo(x + i * s + 3, y + 7); } ctx.stroke(); }
      if (t.t !== 'sea' && !visible(c, r)) { hexPath(x, y, s); ctx.fillStyle = 'rgba(40,30,15,0.18)'; ctx.fill(); }
      if (reach?.has(key(c, r)) && key(c, r) !== key(...own.find((u) => u.id === selected).pos)) { hexPath(x, y, s); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill(); }
      hexPath(x, y, s);
      ctx.strokeStyle = 'rgba(80,60,30,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  // Coast road
  ctx.strokeStyle = '#6d4f2b'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]); ctx.beginPath();
  let first = true;
  for (let c = 0; c < MAP_COLS; c++) for (let r = 0; r < MAP_ROWS; r++) if (TILES[key(c, r)].road) { const p = centre(c, r); ctx[first ? 'moveTo' : 'lineTo'](p.x, p.y); first = false; }
  ctx.stroke(); ctx.setLineDash([]);

  // Ports
  for (const p of PORTS) {
    const { x, y } = centre(p.col, p.row);
    const owner = S.game.portOwners[p.id];
    ctx.beginPath(); ctx.arc(x, y, s * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = SIDE_COLORS[owner].fill; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = SIDE_COLORS[owner].edge; ctx.stroke();
    ctx.font = `bold ${Math.max(9, s * 0.5)}px Georgia, serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#1e2a33';
    ctx.fillText(p.name, x, y - s * 0.95);
  }
  // Dumps
  for (const [k, d] of Object.entries(S.game.dumps)) {
    const { x, y } = centre(...parseKey(k));
    ctx.fillStyle = d.side === mySide() ? '#2f5d3a' : '#8c2b1e';
    ctx.fillRect(x + s * 0.3, y - s * 0.75, s * 0.32, s * 0.32);
  }
  // Planned moves & transfers
  if (stage().id === 'move') for (const m of draft.moves || []) {
    const u = own.find((x) => x.id === m.unitId); if (!u) continue;
    ctx.strokeStyle = '#1c3d8c'; ctx.lineWidth = 3; ctx.beginPath();
    const p0 = centre(...u.pos); ctx.moveTo(p0.x, p0.y);
    for (const st of m.path) { const p = centre(...st); ctx.lineTo(p.x, p.y); }
    ctx.stroke();
  }
  if (stage().id === 'rear') for (const t of draft.transfers || []) {
    const a = centre(...parseKey(t.from)), b = centre(...parseKey(t.to));
    ctx.strokeStyle = '#2f5d3a'; ctx.setLineDash([3, 3]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  }
  if (stage().id === 'combat') for (const a of draft.attacks || []) {
    const t = S.game.units.find((u) => u.id === a.targetId); if (!t) continue;
    const b = centre(...t.pos);
    for (const id of a.attackerIds) { const u = own.find((x) => x.id === id); if (!u) continue; const p = centre(...u.pos); ctx.strokeStyle = '#a3241a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }
  // Units
  for (const u of S.game.units) drawCounter(u);
}

function drawCounter(u) {
  const s = view.size;
  const { x, y } = centre(...u.pos);
  const w = s * 1.15, h = s * 1.0;
  ctx.fillStyle = NATION_COLORS[u.nation] || SIDE_COLORS[u.side].fill;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.lineWidth = u.id === selected ? 3 : 1.5;
  ctx.strokeStyle = u.id === selected ? '#1c3d8c' : u.side !== mySide() ? '#a3241a' : SIDE_COLORS[u.side].edge;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  // NATO-style symbol box
  const bw = w * 0.6, bh = h * 0.42, bx = x - bw / 2, by = y - h * 0.38;
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1.2; ctx.strokeRect(bx, by, bw, bh);
  ctx.beginPath();
  if (u.type === 'inf' || u.type === 'mot') { ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by + bh); ctx.moveTo(bx + bw, by); ctx.lineTo(bx, by + bh); }
  if (u.type === 'arm' || u.type === 'mot') { ctx.ellipse(x, by + bh / 2, bw * 0.32, bh * 0.3, 0, 0, Math.PI * 2); }
  ctx.stroke();
  ctx.fillStyle = '#111'; ctx.font = `bold ${Math.max(8, s * 0.42)}px "Courier New", monospace`; ctx.textAlign = 'center';
  ctx.fillText(String(u.str), x, y + h * 0.42);
}

// Map interaction: pan, zoom, select, order.
let drag = null;
canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false }; });
addEventListener('mousemove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) { view.ox = drag.ox + dx; view.oy = drag.oy + dy; drawMap(); }
  }
  if (e.target === canvas && S?.game) {
    const h = eventHex(e);
    if (!hoverHex || h[0] !== hoverHex[0] || h[1] !== hoverHex[1]) { hoverHex = h; showHexInfo(h); }
  }
});
addEventListener('mouseup', (e) => {
  if (drag && !drag.moved && e.target === canvas) clickHex(eventHex(e));
  drag = null;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const old = view.size;
  view.size = Math.min(60, Math.max(10, view.size * (e.deltaY < 0 ? 1.12 : 0.89)));
  view.ox = mx - ((mx - view.ox) * view.size) / old;
  view.oy = my - ((my - view.oy) * view.size) / old;
  drawMap();
}, { passive: false });

function eventHex(e) {
  const r = canvas.getBoundingClientRect();
  return pixelToHex(e.clientX - r.left - view.ox, e.clientY - r.top - view.oy, view.size);
}

function showHexInfo([c, r]) {
  const t = TILES[key(c, r)];
  if (!t) { $('hexInfo').textContent = ''; return; }
  const u = unitAt(c, r);
  const d = S.game.dumps[key(c, r)];
  const port = PORTS.find((p) => p.col === c && p.row === r);
  $('hexInfo').innerHTML = [
    `<b>${key(c, r)}</b> ${esc(TERRAIN[t.t].label)}${t.road ? ' · road' : ''}`,
    port ? `${esc(port.name)} (${SIDE_NAMES[S.game.portOwners[port.id]]})` : '',
    u ? `${esc(u.name)} · ${u.str} steps${u.side === mySide() ? ` · F${u.fuel} W${u.water} A${u.ammo}` : ''}` : '',
    d && !d.spotted && d.side === mySide() ? `Dump: fuel ${Math.floor(d.fuel)}, water ${Math.floor(d.water)}, ammo ${Math.floor(d.ammo)}` : d ? 'Enemy dump' : '',
  ].filter(Boolean).join('<br>');
}

function clickHex([c, r]) {
  if (!S?.game || S.game.winner || !mySide()) return;
  const u = unitAt(c, r);
  const st = stage().id;
  if (u && u.side === mySide()) { selected = u.id === selected ? null : u.id; renderOrders(); drawMap(); return; }
  if (st === 'move' && selected && S.canAct && !S.game.ready[mySide()]) {
    const unit = myUnits().find((x) => x.id === selected);
    const reach = reachable(unit);
    const k = key(c, r);
    if (!reach.has(k) || k === key(...unit.pos)) return toast('Out of reach this stage.');
    draft.moves = (draft.moves || []).filter((m) => m.unitId !== unit.id);
    draft.moves.push({ unitId: unit.id, path: pathTo(reach, k) });
    selected = null;
    renderOrders(); drawMap();
  }
}
