import { key, parseKey, distance, neighbours, hexToPixel, pixelToHex } from '/shared/hex.js';
import {
  MAP_COLS, MAP_ROWS, SIDES, SIDE_NAMES, ROLES, ROLE_NAMES, PORTS, LOCATIONS, VISION_RANGE, buildMap,
} from '/shared/scenario.js';
import { hexFromName, nameOfHex } from '/shared/hexnames.js';
import { TERRAIN, HEXSIDES, STACKING_POINTS, NON_MOTORISED_VOLUNTARY_LIMIT, CP, stepCost, edgeKey } from '/shared/rules.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const params = new URLSearchParams(location.search);
const hostToken = params.get('host');
const inviteUrl = params.get('invite');
const MAP = buildMap();
const TILES = MAP.tiles;

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
$('forceBtn').onclick = () => { if (confirm('Host override: pass the current step for whoever is holding it up (empty orders, outstanding attacks skipped)?')) send({ type: 'force' }); };

// ---------- Render root ----------

function render() {
  const inGame = S.phase === 'game';
  $('lobby').classList.toggle('hidden', inGame);
  $('game').classList.toggle('hidden', !inGame);
  $('forceBtn').classList.toggle('hidden', !(inGame && S.you.isHost));
  renderTop();
  if (!inGame) return renderLobby();
  const g = S.game;
  const sk = `${g.turn}:${g.opStage}:${g.step}:${g.half}`;
  if (sk !== draftStageKey) { draftStageKey = sk; draft = g.myOrders ? structuredClone(g.myOrders) : {}; }
  if (selected && !myUnits().some((u) => u.id === selected)) selected = null;
  renderOrders();
  renderSupply();
  $('tab-staff').innerHTML = '';
  $('tab-staff').appendChild(seatGrid());
  renderLog();
  renderChat();
  drawMap();
}

const sideName = (s) => SIDE_NAMES[s] || '—';

function renderTop() {
  if (S.phase !== 'game') { $('turnInfo').textContent = 'Lobby'; $('readyInfo').textContent = ''; return; }
  const g = S.game;
  const st = S.steps[g.step];
  const where = g.opStage ? `Ops Stage ${g.opStage}` : 'Naval Convoy Stage';
  const who = g.half ? ` · Player ${g.half}: <b>${sideName(g.phasing)}</b>` : '';
  const seg = g.step === 'movecombat' && g.seg ? ` <span class="muted">(segment ${g.seg.n}, ${g.seg.mode})</span>` : '';
  $('turnInfo').innerHTML = `GT <b>${g.turn}</b>/${g.lastTurn} · ${esc(g.date)} · ${where}${who} · <b>${esc(st.name)}</b>${seg}`;
  $('readyInfo').innerHTML = `<span class="pill" title="Initiative holder this Game-Turn">Initiative: ${sideName(g.initiative?.holder)}</span> ` +
    (g.acting || []).map((s) => `<span class="pill waiting">waiting on ${sideName(s)}</span>`).join(' ');
}

// ---------- Helpers on game state ----------

const mySide = () => S.you.side;
const myUnits = () => (S.game.units || []).filter((u) => u.side === mySide());
const enemyUnits = () => (S.game.units || []).filter((u) => u.side !== mySide());
const unitsAt = (c, r) => (S.game.units || []).filter((u) => u.pos[0] === c && u.pos[1] === r);
const portName = (k) => LOCATIONS.find((l) => l.hexes.some((h) => key(...h) === k))?.name;
const hexLabel = (k) => portName(k) || nameOfHex(...parseKey(k));
const isCombat = (u) => u.type !== 'hq';
const sp = (u) => STACKING_POINTS[u.size] ?? 0;
const myPhase = () => S.game.step === 'movecombat' && S.game.phasing === mySide();

// Client-side ZOC approximation from what we can see (the host has the final say).
function exertsZoc(e) {
  if (!isCombat(e)) return false;
  if (sp(e) > 1) return true;
  return unitsAt(...e.pos).filter((x) => x.side === e.side && isCombat(x)).reduce((s, x) => s + sp(x), 0) > 1;
}
function zocAt(u, pos) {
  if (unitsAt(...pos).some((x) => x !== u && x.side === u.side && isCombat(x))) return false;
  return enemyUnits().some((e) => exertsZoc(e) && distance(e.pos, pos) === 1 && (() => {
    const h = MAP.hexsides[edgeKey(e.pos, pos)];
    if (h && (h.type === 'escarpment' || h.type === 'majorRiver')) return false;
    return !!stepCost(MAP, e.pos, pos, { motorised: e.motorised ?? e.type !== 'inf' });
  })());
}

// Cheapest CP paths for a unit, honouring terrain, enemy-occupied hexes and stop-in-ZOC.
function reachable(u) {
  const startZoc = zocAt(u, u.pos) || u.contact;
  const base = startZoc ? (u.engaged ? CP.disengage : CP.breakContact) : 0;
  const cap = u.cpa <= 10 ? u.cpa * NON_MOTORISED_VOLUNTARY_LIMIT - u.cpUsed : Infinity;
  const maxSteps = u.motorised ? u.fuel : Infinity;
  const best = new Map([[key(...u.pos), { cost: base, steps: 0, prev: null, stop: false }]]);
  const queue = [u.pos];
  const enemyAt = new Set(enemyUnits().map((e) => key(...e.pos)));
  const budget = Math.min(cap, u.cpa * 1.5 - u.cpUsed); // show up to 50% past the allowance
  while (queue.length) {
    queue.sort((a, b) => best.get(key(...a)).cost - best.get(key(...b)).cost);
    const cur = queue.shift();
    const cb = best.get(key(...cur));
    if (cb.stop) continue;
    for (const n of neighbours(...cur)) {
      if (n[0] < 0 || n[1] < 0 || n[0] >= MAP_COLS || n[1] >= MAP_ROWS) continue;
      const k = key(...n);
      if (enemyAt.has(k)) continue;
      const c = stepCost(MAP, cur, n, { motorised: u.motorised });
      if (!c) continue;
      const cost = cb.cost + c.cp;
      const steps = cb.steps + 1;
      if (cost > budget || steps > maxSteps) continue;
      const intoZoc = zocAt(u, n);
      if (intoZoc && cb.steps === 0 && startZoc) continue; // no ZOC-to-ZOC
      if (!best.has(k) || best.get(k).cost > cost) { best.set(k, { cost, steps, prev: key(...cur), stop: intoZoc }); queue.push(n); }
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
  const g = S.game;
  const st = S.steps[g.step];
  if (g.over) { el.innerHTML = `<h3>Scenario over</h3><p>${g.winner === 'draw' ? 'A draw.' : `${sideName(g.winner)} victory.`}</p>`; return; }
  if (!mySide()) { el.innerHTML = '<p>You are not on a staff. Take a seat in the <b>Staff</b> tab.</p>'; return; }
  const acting = (g.acting || []).includes(mySide());
  let head = `<h3>${esc(st.name)}</h3>${st.placeholder ? '<p class="note">Placeholder rules: this step will be replaced by the full rules.</p>' : ''}`;
  if (!acting) {
    const who = (g.acting || []).map(sideName).join(' and ');
    head += `<p class="note">${g.ready?.[mySide()] ? 'Your orders are in. ' : ''}Waiting on ${who || 'the host'}.</p>`;
  } else if (!S.canAct) {
    head += `<p class="note">${esc(S.actingFor || 'Nobody')} (${esc(ROLE_NAMES[st.role])} or stand-in) is acting for ${sideName(mySide())}. Advise them in staff chat.</p>`;
  }
  const body = ({ air: airForm, convoy: convoyForm, declare: declareForm, movecombat: moveCombatPanel, trucks: trucksForm })[g.step]();
  el.innerHTML = head + body;
  if (!S.canAct) for (const input of el.querySelectorAll('input, select, button')) input.disabled = true;
  if (S.canAct && ['air', 'convoy', 'trucks'].includes(g.step)) {
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = g.step === 'trucks' ? 'Dispatch convoys and finish' : 'Submit orders';
    btn.onclick = () => send({ type: 'submit', orders: draft });
    el.appendChild(btn);
  }
  if (!S.canAct && st.kind === 'simultaneous' && g.ready?.[mySide()] && S.you && S.canAct === false) { /* view only */ }
  wireOrders(el);
}

function airForm() {
  const pts = S.game.airPoints;
  const v = (k) => draft[k] ?? 0;
  const used = ['malta', 'escort', 'ground'].reduce((a, k) => a + v(k), 0);
  return `<p>Allot your ${pts} air points. <b>${used}/${pts}</b> assigned.</p>
  <label class="row">Malta missions <input type="number" min="0" max="${pts}" data-air="malta" value="${v('malta')}"></label>
  <label class="row">Convoy escort <input type="number" min="0" max="${pts}" data-air="escort" value="${v('escort')}"></label>
  <label class="row">Ground support <input type="number" min="0" max="${pts}" data-air="ground" value="${v('ground')}"></label>`;
}

function convoyForm() {
  const ports = PORTS.filter((p) => S.game.portOwners[p.id] === mySide());
  return `<p>Choose where this week's convoy unloads. Bigger ports land more of it.</p>
  <select data-convoy><option value="">No convoy</option>${ports.map((p) => `<option value="${p.id}" ${draft.port === p.id ? 'selected' : ''}>${p.name} (capacity ${Math.round(p.capacity * 100)}%)</option>`).join('')}</select>`;
}

function declareForm() {
  const g = S.game;
  return `<p>${sideName(g.initiative.holder)} holds the Initiative this Game-Turn${g.initiative.rolls ? ` (rolled Axis ${g.initiative.rolls.axis}, Commonwealth ${g.initiative.rolls.cw})` : ''}.
  For Operations Stage ${g.opStage}, choose whether to move first (Player A) or last (Player B).</p>
  <p class="help">Going last in one stage and first in the next gives you two phases in a row.</p>
  <div class="btnrow"><button class="act" data-declare="first">Move first</button><button class="act" data-declare="last">Move last</button></div>`;
}

function moveCombatPanel() {
  const g = S.game;
  if (!myPhase()) return `<p>${sideName(g.phasing)} is Player ${g.half} and is moving and fighting. Your units may only react once Reaction is implemented.</p>` + lastCombatReport();
  const seg = g.seg;
  const sel = myUnits().find((u) => u.id === selected);
  let html = `<p>Segment <b>${seg.n}</b> · ${seg.mode === 'move' ? 'Movement' : 'Combat'}.</p>`;
  if (seg.mode === 'move') {
    html += `<p class="help">Click one of your units, then a highlighted hex. Units stop on entering an enemy zone of control. Units that end a segment more than 2 hexes from the enemy can't move again this phase.</p>`;
    if (sel) html += unitCard(sel);
    html += `<div class="btnrow"><button class="act" data-act="toCombat">Finish moving → combat</button></div>`;
    html += lastCombatReport();
  } else {
    html += combatList();
    html += `<div class="btnrow"><button class="act" data-act="nextSegment">New movement segment</button></div>`;
  }
  html += obligationList();
  html += `<button class="primary act" data-act="endPhase">End Movement &amp; Combat Phase</button>`;
  return html;
}

function unitCard(u) {
  const frozen = S.game.seg?.frozen?.includes(u.id);
  const moved = S.game.seg?.moved?.includes(u.id);
  return `<div class="unitcard"><b>${esc(u.name)}</b><br>
    CPA ${u.cpa} · used ${fmtCP(u.cpUsed)}${u.cpa <= 10 ? ` (foot: max ${u.cpa * NON_MOTORISED_VOLUNTARY_LIMIT})` : ''} · cohesion <b class="${u.cohesion < 0 ? 'bad' : ''}">${u.cohesion}</b><br>
    Morale ${u.morale > 0 ? '+' : ''}${u.morale} · TOE ${u.str}/${u.maxStr}${u.motorised ? ` · fuel ${u.fuel}` : ''} · water ${u.water} · ammo ${u.ammo}${u.motorised ? ` · breakdown pts ${fmtCP(u.bp)}` : ''}
    <br><span class="muted">${(u.elements || []).map((e) => `${e.toe}× ${esc(e.w)}`).join(' · ')}</span>
    ${frozen ? '<br><span class="bad">Cannot move again this phase.</span>' : moved ? '<br><span class="muted">Already moved this segment.</span>' : ''}</div>`;
}
const fmtCP = (n) => (Number.isInteger(n) ? n : n.toFixed(1));

function combatList() {
  const targets = enemyUnits().filter((e) => myUnits().some((u) => isCombat(u) && distance(u.pos, e.pos) === 1));
  if (!targets.length) return '<p>No enemy units are adjacent.</p>' + lastCombatReport();
  const attackedHexes = new Set(S.game.seg?.attacked || []);
  return `<p class="help">Each hex can be attacked once per segment. A full assault costs each attacker ${CP.phasingAssault} CP and each defender ${CP.defend} CP; a probe costs 2. The fight runs barrage, anti-armour fire, then close assault, with morale checks. The defender's choices are automatic for now.</p>` +
    targets.map((e) => {
      const adj = myUnits().filter((u) => isCombat(u) && distance(u.pos, e.pos) === 1);
      const t = TILES[key(...e.pos)];
      const done = attackedHexes.has(key(...e.pos));
      return `<div class="attack"><b>${esc(e.name)}</b> <span class="muted">(${e.str} TOE, ${esc(TERRAIN[t.t].label)})</span>
        ${done ? '<span class="muted">Already attacked this segment.</span>' : `
        ${adj.map((u) => `<label class="check"><input type="checkbox" data-att="${e.id}" value="${u.id}" checked> ${esc(u.name)} (${u.str} TOE, cohesion ${u.cohesion}${u.ammo ? '' : ', no ammo!'})</label>`).join('')}
        <div class="opts">
          <label class="check"><input type="checkbox" data-opt-fwd="${e.id}" checked> Artillery forward <span class="muted">(fires together and joins the assault, but is exposed)</span></label>
          <label class="check"><input type="checkbox" data-opt-at="${e.id}"> Tanks fire anti-armour <span class="muted">(instead of joining the close assault)</span></label>
          <label class="check"><input type="checkbox" data-opt-probe="${e.id}"> Probe only <span class="muted">(2 CP, no Engaged result)</span></label>
        </div>
        <button class="act" data-attack="${e.id}">Attack</button>`}</div>`;
    }).join('') + lastCombatReport();
}

function lastCombatReport() {
  const c = S.game.lastCombat;
  if (!c || c.turn !== S.game.turn) return '';
  return `<details class="report" open><summary>Last combat: ${esc(c.title)}</summary>${c.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</details>`;
}

function obligationList() {
  const ob = S.game.obligations || [];
  if (!ob.length) return '';
  return `<p class="help"><b>Must attack</b> before the segment ends (enemy zones of control on your units):</p><ul class="orders">${ob.map((o) => {
    const e = S.game.units.find((u) => u.id === o.enemyId);
    return `<li>${esc(e?.name || o.hex)} ${o.met ? '<span class="ok">✓</span>' : '<span class="bad">outstanding</span>'}</li>`;
  }).join('')}</ul>`;
}

function trucksForm() {
  draft.transfers ||= [];
  const dumps = Object.entries(S.game.dumps).filter(([, d]) => d.side === mySide() && !d.spotted);
  const dests = new Map(dumps.map(([k]) => [k, hexLabel(k)]));
  for (const u of myUnits()) if (!dests.has(key(...u.pos))) dests.set(key(...u.pos), `${u.name} (${key(...u.pos)})`);
  const load = draft.transfers.reduce((a, t) => a + t.amount * Math.max(1, Math.ceil(distance(parseKey(t.from), parseKey(t.to)) / 8)), 0);
  const opt = (m) => [...m].map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('');
  return `<p>Move supplies with second- and third-line trucks. Capacity used: <b>${load}/${S.game.truckCapacity}</b>.</p>
  <div class="transfer">
    <select id="tFrom">${opt(new Map(dumps.map(([k]) => [k, hexLabel(k)])))}</select>
    <span>→</span>
    <select id="tTo">${opt(dests)}</select>
    <select id="tRes"><option>fuel</option><option>water</option><option>ammo</option><option>stores</option></select>
    <input id="tAmt" type="number" min="1" value="10">
    <button data-add-transfer>Add</button>
  </div>
  <ul class="orders">${draft.transfers.map((t, i) => `<li>${t.amount} ${t.res}: ${esc(hexLabel(t.from))} → ${esc(hexLabel(t.to))} <button class="x" data-del-transfer="${i}">✕</button></li>`).join('') || '<li class="muted">No convoys.</li>'}</ul>`;
}

function wireOrders(el) {
  el.querySelectorAll('[data-air]').forEach((i) => (i.onchange = () => { draft[i.dataset.air] = Math.max(0, parseInt(i.value, 10) || 0); renderOrders(); }));
  el.querySelectorAll('[data-convoy]').forEach((s) => (s.onchange = () => { draft.port = s.value || null; }));
  el.querySelectorAll('[data-declare]').forEach((b) => (b.onclick = () => send({ type: 'submit', orders: { goFirst: b.dataset.declare === 'first' } })));
  el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
    if (b.dataset.act === 'endPhase' && !confirm('End your Movement & Combat Phase?')) return;
    selected = null;
    send({ type: 'action', action: b.dataset.act });
  }));
  el.querySelectorAll('[data-attack]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.attack;
    const attackerIds = [...el.querySelectorAll(`[data-att="${id}"]:checked`)].map((c) => c.value);
    if (!attackerIds.length) return toast('Tick at least one attacking unit.');
    send({
      type: 'action', action: 'attack', targetId: id, attackerIds,
      artilleryForward: el.querySelector(`[data-opt-fwd="${id}"]`).checked,
      tankRole: el.querySelector(`[data-opt-at="${id}"]`).checked ? 'antiArmour' : 'assault',
      probe: el.querySelector(`[data-opt-probe="${id}"]`).checked,
    });
  }));
  el.querySelector('[data-add-transfer]')?.addEventListener('click', () => {
    const t = { from: $('tFrom').value, to: $('tTo').value, res: $('tRes').value, amount: parseInt($('tAmt').value, 10) || 0 };
    if (!t.from || !t.to || t.from === t.to || t.amount <= 0) return toast('Pick two different places and an amount.');
    draft.transfers.push(t); renderOrders(); drawMap();
  });
  el.querySelectorAll('[data-del-transfer]').forEach((b) => (b.onclick = () => { draft.transfers.splice(+b.dataset.delTransfer, 1); renderOrders(); drawMap(); }));
}

// ---------- Supply / formations ----------

function renderSupply() {
  const el = $('tab-supply');
  if (!mySide()) { el.innerHTML = ''; return; }
  const dumps = Object.entries(S.game.dumps).filter(([, d]) => d.side === mySide() && !d.spotted);
  const n = (v) => Math.floor(v);
  el.innerHTML = `<h3>Formations</h3><table class="grid"><tr><th>Unit</th><th>CP</th><th>Coh</th><th>Str</th><th>Fuel</th><th>Water</th><th>Ammo</th></tr>
    ${myUnits().map((u) => `<tr class="${u.cohesion <= -10 || u.water <= 0 ? 'warn' : ''}"><td>${esc(u.name)}</td><td>${fmtCP(u.cpUsed)}/${u.cpa}</td><td>${u.cohesion}</td><td>${u.str}/${u.maxStr}</td><td>${u.motorised ? u.fuel : '–'}</td><td>${u.water}</td><td>${u.ammo}</td></tr>`).join('')}</table>
    <h3>Supply dumps</h3><table class="grid"><tr><th>Dump</th><th>Fuel</th><th>Water</th><th>Ammo</th><th>Stores</th></tr>
    ${dumps.map(([k, d]) => `<tr><td>${esc(hexLabel(k))}</td><td>${n(d.fuel)}</td><td>${n(d.water)}</td><td>${n(d.ammo)}</td><td>${n(d.stores)}</td></tr>`).join('')}</table>
    <p>Prisoners held: <b>${S.game.prisoners?.[mySide()] ?? 0}</b> TOE points.</p>
    <p class="help">CP = capability points used this Operations Stage / allowance. Spending past the allowance costs cohesion. A stage spent resting restores up to 5 cohesion (never above 0). At −26 a unit can't move or fight.</p>
    <p class="help">Supply is still placeholder: units within 3 hexes of a dump top up at the end of each Game-Turn${S.game.options?.pastaRule ? '; Italian units need extra water for pasta' : ''}.</p>`;
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

// ---------- Log / chat ----------

function renderLog() {
  $('tab-log').innerHTML = (S.game.log || []).slice().reverse().map((l) => `<p class="logline ${l.side}"><span class="muted">GT${l.turn}${l.stage ? '.' + l.stage : ''}</span> ${esc(l.text)}</p>`).join('') || '<p class="muted">Nothing yet.</p>';
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
// The board's grid runs with north to the right; we draw it rotated so north is up.
const view = { size: 16, ox: 0, oy: 0, placed: false };
const COLORS = { sea: '#7d9bab', clear: '#ead9ad', gravel: '#dcc795', saltmarsh: '#cfc3a6', heavyveg: '#a9b57f', rough: '#c3aa78', mountain: '#a48b62', delta: '#b8c38a', desert: '#f0dc9c', majorcity: '#cbb8a0', swamp: '#9fb39a' };
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
    const a = (Math.PI / 3) * i + Math.PI / 6;
    ctx[i ? 'lineTo' : 'moveTo'](cx + s * Math.cos(a), cy + s * Math.sin(a));
  }
  ctx.closePath();
}
const centre = (c, r) => { const p = hexToPixel(c, r, view.size); return { x: p.y + view.ox, y: -p.x + view.oy }; };
function placeView() {
  // Start centred on the Libyan-Egyptian frontier.
  const [c, r] = hexFromName('C4021');
  const p = hexToPixel(c, r, view.size);
  const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
  view.ox = w / 2 - p.y; view.oy = h / 2 + p.x;
  view.placed = true;
}

// Endpoints of the shared side between two adjacent hexes.
function sharedEdge(a, b) {
  const A = centre(...a), B = centre(...b);
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
  const half = view.size / 2;
  return [{ x: mx - (dy / len) * half, y: my + (dx / len) * half }, { x: mx + (dy / len) * half, y: my - (dx / len) * half }, { dx: dx / len, dy: dy / len }];
}

let reachCache = null;

function drawMap() {
  if (!S?.game) return;
  if (!view.placed && canvas.width) placeView();
  const s = view.size;
  const VW = canvas.width / devicePixelRatio, VH = canvas.height / devicePixelRatio;
  const onScreen = (x, y) => x > -s * 3 && y > -s * 3 && x < VW + s * 3 && y < VH + s * 3;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = '#5f7f90';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const own = myUnits();
  const visible = (c, r) => !mySide() || own.some((u) => distance(u.pos, [c, r]) <= VISION_RANGE);
  const sel = own.find((u) => u.id === selected);
  reachCache = sel && myPhase() && S.game.seg?.mode === 'move' && S.canAct ? reachable(sel) : null;

  for (let c = 0; c < MAP_COLS; c++) {
    for (let r = 0; r < MAP_ROWS; r++) {
      const t = TILES[key(c, r)];
      if (!t) continue;
      const { x, y } = centre(c, r);
      if (!onScreen(x, y)) continue;
      hexPath(x, y, s);
      ctx.fillStyle = COLORS[t.t] || '#e0d0a0';
      ctx.fill();
      if (t.t === 'saltmarsh' && s >= 10) { ctx.strokeStyle = '#c9b45a'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = -s * 0.6; i < s * 0.6; i += 5) { ctx.moveTo(x + i, y - s * 0.5); ctx.lineTo(x + i + 4, y + s * 0.5); } ctx.stroke(); }
      if (t.t === 'gravel' && s >= 10) { ctx.strokeStyle = '#d9a21c'; ctx.lineWidth = 1; for (const [dx, dy] of [[-0.3, -0.2], [0.25, -0.3], [0, 0.25], [-0.35, 0.3], [0.35, 0.2]]) { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, s * 0.12, 0, Math.PI * 2); ctx.stroke(); } }
      if (t.t === 'mountain') { ctx.fillStyle = '#7d6748'; ctx.beginPath(); ctx.moveTo(x - s * 0.4, y + s * 0.3); ctx.lineTo(x, y - s * 0.35); ctx.lineTo(x + s * 0.4, y + s * 0.3); ctx.fill(); }
      if (t.t !== 'sea' && !visible(c, r)) { hexPath(x, y, s); ctx.fillStyle = 'rgba(40,30,15,0.16)'; ctx.fill(); }
      if (s >= 9) {
        hexPath(x, y, s);
        ctx.strokeStyle = 'rgba(80,60,30,0.22)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
  // Reachable hexes with CP cost
  if (reachCache) {
    for (const [k, v] of reachCache) {
      if (k === key(...sel.pos)) continue;
      const [c, r] = parseKey(k);
      const { x, y } = centre(c, r);
      hexPath(x, y, s);
      const over = sel.cpUsed + v.cost > sel.cpa;
      ctx.fillStyle = v.stop ? 'rgba(200,60,40,0.30)' : over ? 'rgba(230,160,40,0.35)' : 'rgba(255,255,255,0.45)';
      ctx.fill();
      if (s >= 16) { ctx.fillStyle = '#222'; ctx.font = `${Math.max(8, s * 0.38)}px "Courier New", monospace`; ctx.textAlign = 'center'; ctx.fillText(fmtCP(v.cost), x, y + s * 0.55); }
    }
  }
  // Hexsides
  for (const [ek, h] of Object.entries(MAP.hexsides)) {
    const [a, b] = ek.split('|').map(parseKey);
    const ca = centre(...a);
    if (!onScreen(ca.x, ca.y)) continue;
    const [p1, p2, n] = sharedEdge(a, b);
    if (h.type === 'slope' || h.type === 'ridge') {
      ctx.strokeStyle = h.type === 'ridge' ? '#8a6a1c' : '#a8862e'; ctx.lineWidth = h.type === 'ridge' ? 3.5 : 2.5;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      continue;
    }
    if (h.type === 'minorRiver' || h.type === 'majorRiver') {
      ctx.strokeStyle = '#3d86c6'; ctx.lineWidth = h.type === 'majorRiver' ? 4 : 2.5;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      continue;
    }
    if (h.type === 'escarpment') {
      // Ticks point towards the down side.
      const down = parseKey(h.down);
      const D = centre(...down), M = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const dir = Math.sign((D.x - M.x) * n.dx + (D.y - M.y) * n.dy) || 1;
      ctx.strokeStyle = '#5a4122'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.beginPath();
      for (let t = 0.15; t < 1; t += 0.23) {
        const x = p1.x + (p2.x - p1.x) * t, y = p1.y + (p2.y - p1.y) * t;
        ctx.moveTo(x, y); ctx.lineTo(x + n.dx * dir * s * 0.22, y + n.dy * dir * s * 0.22);
      }
      ctx.stroke();
    } else if (h.type === 'wadi') {
      ctx.strokeStyle = '#6f9a72'; ctx.lineWidth = 2.5; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // Roads and tracks
  const drawEdges = (set, style, width, dash) => {
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
    for (const ek of set) {
      const [a, b] = ek.split('|').map(parseKey);
      const A = centre(...a), B = centre(...b);
      if (!onScreen(A.x, A.y)) continue;
      ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  };
  drawEdges(MAP.roads, '#7a1f12', 2.5, []);
  drawEdges(MAP.tracks, '#5d4a2c', 1.5, [4, 3]);
  drawEdges(MAP.rails, '#2f7fbf', 1.5, [2, 2]);

  // Important locations (ports, cities, garrisons, victory hexes)
  for (const l of LOCATIONS) {
    const [c0, r0] = l.hexes[0];
    const { x, y } = centre(c0, r0);
    if (!onScreen(x, y)) continue;
    const owner = S.game.portOwners[l.id];
    for (const h of l.hexes) {
      const q = centre(...h);
      ctx.beginPath(); ctx.arc(q.x, q.y, s * (l.city ? 0.32 : 0.22), 0, Math.PI * 2);
      ctx.fillStyle = SIDE_COLORS[owner]?.fill || '#ccc'; ctx.fill();
      ctx.lineWidth = l.victory ? 2.5 : 1.5; ctx.strokeStyle = l.victory ? '#a3241a' : SIDE_COLORS[owner]?.edge || '#333'; ctx.stroke();
    }
    ctx.font = `bold ${Math.max(9, s * 0.55)}px Georgia, serif`; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,250,235,0.85)'; ctx.strokeText(l.name, x, y - s * 0.9);
    ctx.fillStyle = '#1e2a33'; ctx.fillText(l.name, x, y - s * 0.9);
  }
  // Dumps
  for (const [k, d] of Object.entries(S.game.dumps)) {
    const { x, y } = centre(...parseKey(k));
    ctx.fillStyle = d.side === mySide() ? '#2f5d3a' : '#8c2b1e';
    ctx.fillRect(x + s * 0.3, y - s * 0.75, s * 0.32, s * 0.32);
  }
  // Planned truck convoys
  if (S.game.step === 'trucks') for (const t of draft.transfers || []) {
    const a = centre(...parseKey(t.from)), b = centre(...parseKey(t.to));
    ctx.strokeStyle = '#2f5d3a'; ctx.setLineDash([3, 3]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  }
  // Units (stacks fan out slightly)
  const stacks = new Map();
  for (const u of S.game.units) { const k = key(...u.pos); if (!stacks.has(k)) stacks.set(k, []); stacks.get(k).push(u); }
  for (const list of stacks.values()) list.forEach((u, i) => drawCounter(u, i, list.length));
}

function drawCounter(u, i, n) {
  const s = view.size;
  const c0 = centre(...u.pos);
  const x = c0.x + (i - (n - 1) / 2) * s * 0.28, y = c0.y + (i - (n - 1) / 2) * s * 0.18;
  const w = s * 1.15, h = s * 1.0;
  const frozen = myPhase() && S.game.seg?.frozen?.includes(u.id);
  ctx.globalAlpha = frozen ? 0.6 : 1;
  ctx.fillStyle = NATION_COLORS[u.nation] || SIDE_COLORS[u.side].fill;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.lineWidth = u.id === selected ? 3 : 1.5;
  ctx.strokeStyle = u.id === selected ? '#1c3d8c' : u.side !== mySide() ? '#a3241a' : SIDE_COLORS[u.side].edge;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  // NATO-style symbol
  const bw = w * 0.6, bh = h * 0.42, bx = x - bw / 2, by = y - h * 0.38;
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1.2; ctx.strokeRect(bx, by, bw, bh);
  ctx.beginPath();
  if (u.type === 'inf' || u.type === 'mot') { ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by + bh); ctx.moveTo(bx + bw, by); ctx.lineTo(bx, by + bh); }
  if (u.type === 'arm' || u.type === 'mot') { ctx.ellipse(x, by + bh / 2, bw * 0.32, bh * 0.3, 0, 0, Math.PI * 2); }
  if (u.type === 'hq') { ctx.moveTo(bx, by + bh); ctx.lineTo(bx, by + bh * 1.8); }
  ctx.stroke();
  // Size marks above the box: XX division, X brigade, II battalion
  const mark = { division: 'XX', brigade: 'X', battalion: 'II' }[u.size] || '';
  ctx.fillStyle = '#111'; ctx.font = `bold ${Math.max(6, s * 0.28)}px sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(mark, x, by - 1);
  ctx.font = `bold ${Math.max(8, s * 0.4)}px "Courier New", monospace`;
  ctx.fillText(String(u.str), x, y + h * 0.42);
  // Cohesion warning pip
  if (u.side === mySide() && u.cohesion < 0) { ctx.fillStyle = u.cohesion <= -10 ? '#a3241a' : '#c98a1e'; ctx.fillRect(x + w / 2 - s * 0.22, y - h / 2, s * 0.22, s * 0.22); }
  ctx.globalAlpha = 1;
}

// Map interaction: pan, zoom, select, move.
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
  view.size = Math.min(60, Math.max(3, view.size * (e.deltaY < 0 ? 1.12 : 0.89)));
  view.ox = mx - ((mx - view.ox) * view.size) / old;
  view.oy = my - ((my - view.oy) * view.size) / old;
  drawMap();
}, { passive: false });

function eventHex(e) {
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left - view.ox, sy = e.clientY - r.top - view.oy;
  return pixelToHex(-sy, sx, view.size); // undo the north-up rotation
}

function showHexInfo([c, r]) {
  const t = TILES[key(c, r)];
  if (!t) { $('hexInfo').textContent = ''; return; }
  const us = unitsAt(c, r);
  const d = S.game.dumps[key(c, r)];
  const port = LOCATIONS.find((l) => l.hexes.some((h) => h[0] === c && h[1] === r));
  const reach = reachCache?.get(key(c, r));
  const terr = TERRAIN[t.t];
  $('hexInfo').innerHTML = [
    `<b>${nameOfHex(c, r)}</b> ${esc(terr.label)} <span class="muted">(CP ${terr.np === Infinity ? 'P' : terr.np}/${terr.mp === Infinity ? 'P' : terr.mp}, stack ${terr.stack})</span>`,
    port ? `${esc(port.name)} (${sideName(S.game.portOwners[port.id])}${port.port ? ', port' : ''}${port.city ? ', major city' : ''}${port.victory ? ', victory location' : ''})` : '',
    ...us.map((u) => `${esc(u.name)} · ${u.str} steps${u.side === mySide() ? ` · CP ${fmtCP(u.cpUsed)}/${u.cpa} · coh ${u.cohesion}` : ''}`),
    d && !d.spotted && d.side === mySide() ? `Dump: fuel ${Math.floor(d.fuel)}, water ${Math.floor(d.water)}, ammo ${Math.floor(d.ammo)}` : d ? 'Enemy dump' : '',
    reach ? `Move here: ${fmtCP(reach.cost)} CP${reach.stop ? ' · enters enemy ZOC (must stop)' : ''}` : '',
  ].filter(Boolean).join('<br>');
}

function clickHex([c, r]) {
  if (!S?.game || S.game.over || !mySide()) return;
  const mine = unitsAt(c, r).filter((u) => u.side === mySide());
  const k = key(c, r);
  // Moving the selected unit takes priority if the hex is reachable.
  if (selected && reachCache?.has(k) && k !== key(...myUnits().find((u) => u.id === selected).pos)) {
    const path = pathTo(reachCache, k);
    send({ type: 'action', action: 'move', unitId: selected, path });
    return;
  }
  if (mine.length) {
    // Repeated clicks cycle through a stack.
    const idx = mine.findIndex((u) => u.id === selected);
    selected = mine[(idx + 1) % mine.length].id;
    if (idx === mine.length - 1) selected = null;
    renderOrders(); drawMap(); showHexInfo([c, r]);
    return;
  }
  selected = null;
  renderOrders(); drawMap();
}

// Small hook used by automated UI tests and screenshot scripts.
window.__desertCommand = {
  reachable() { return reachCache ? [...reachCache.entries()].map(([k, v]) => ({ name: nameOfHex(...parseKey(k)), cost: v.cost, stop: v.stop })) : []; },
  unitHex(id) { const u = (S?.game?.units || []).find((x) => x.id === id); return u ? nameOfHex(...u.pos) : null; },
  neighbours(name) { return neighbours(...hexFromName(name)).map((h) => nameOfHex(...h)); },
  screenOf(name) {
    const r = canvas.getBoundingClientRect();
    const p = centre(...hexFromName(name));
    return { x: p.x + r.left, y: p.y + r.top };
  },
  centreOn(name, size) {
    if (size) view.size = size;
    const [c, rr] = hexFromName(name);
    const p = hexToPixel(c, rr, view.size);
    view.ox = canvas.width / devicePixelRatio / 2 - p.y; view.oy = canvas.height / devicePixelRatio / 2 + p.x; view.placed = true;
    drawMap();
  },
};
