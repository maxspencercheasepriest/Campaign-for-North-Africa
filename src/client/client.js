import { key, parseKey, distance, neighbours, hexToPixel, pixelToHex } from '/shared/hex.js';
import {
  MAP_COLS, MAP_ROWS, SCENARIOS, SIDES, SIDE_NAMES, ROLES, ROLE_NAMES, PORTS, LOCATIONS, VISION_RANGE, buildMap,
} from '/shared/scenario.js';
import { hexFromName, nameOfHex } from '/shared/hexnames.js';
import { FACILITY_NAMES as AIR_FACILITY_NAMES } from '/shared/air.js';
import { TERRAIN, HEXSIDES, STACKING_POINTS, NON_MOTORISED_VOLUNTARY_LIMIT, CP, stepCost, edgeKey, localWeather } from '/shared/rules.js';

import { BASICS, stepHelp } from './tutorial.js';

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
let selected = null;
let selectedSupply = null; // selected own unit id
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
  if (g.lastAir && g.lastAir.n !== airSeen) { const first = airSeen === null; airSeen = g.lastAir.n; if (!first) startAirAnim(); }
  applyTabAccess();
  renderOrders();
  renderSupply();
  renderAir();
  $('tab-staff').innerHTML = '';
  $('tab-staff').appendChild(seatGrid());
  renderLog();
  renderChat();
  renderCoach();
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
  const wx = g.weather && g.opStage ? ` · <span class="pill" title="Weather this Operations Stage">${{ normal: 'Normal', hot: 'Hot', sand: 'Sandstorm ' + g.weather.sections.join(','), rain: 'Rainstorm ' + g.weather.sections.join(',') }[g.weather.type]}</span>` : '';
  $('turnInfo').innerHTML = `GT <b>${g.turn}</b>/${g.lastTurn} · ${esc(g.date)} · ${where}${wx}${who} · <b>${esc(st.name)}</b>${seg}`;
  $('readyInfo').innerHTML = `<span class="pill" title="Initiative holder this Game-Turn">Initiative: ${sideName(g.initiative?.holder)}</span> ` +
    (g.acting || []).map((s) => `<span class="pill waiting">waiting on ${sideName(s)}</span>`).join(' ');
}

// ---------- Optional tutorial ----------

let coachTab = 'step'; // 'step' | 'basics'
let coachPage = 0;
const coachState = () => store.get('tutorial') || 'unseen'; // unseen | on | off

function renderCoach() {
  const el = $('coach'), btn = $('tutorialBtn');
  const inGame = S?.phase === 'game' && S.game && mySide();
  btn.classList.toggle('hidden', !inGame);
  if (!inGame || coachState() === 'off') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (coachState() === 'unseen') {
    el.innerHTML = `<h4>New to the game?</h4><p>There is an optional guide that explains the turn sequence and tells you what to do at each step as you play.</p>
      <div class="cnav"><button data-coach="decline">No thanks</button><button data-coach="accept" class="primary" style="width:auto;margin:0">Show me how</button></div>`;
  } else if (coachTab === 'basics') {
    const pg = BASICS[coachPage];
    el.innerHTML = `${coachHead()}<p><b>${esc(pg.title)}</b> (${coachPage + 1}/${BASICS.length})</p>${pg.body.map((t) => `<p>${esc(t)}</p>`).join('')}
      <div class="cnav"><button data-coach="prev" ${coachPage === 0 ? 'disabled' : ''}>Back</button><button data-coach="next" ${coachPage === BASICS.length - 1 ? 'disabled' : ''}>Next</button></div>`;
  } else {
    const h = stepHelp(S.game, { side: mySide(), canAct: S.canAct });
    el.innerHTML = `${coachHead()}<p><b>${esc(h.title)}</b></p>${h.body.map((t) => `<p>${esc(t)}</p>`).join('')}`;
  }
  el.querySelectorAll('[data-coach]').forEach((b) => (b.onclick = () => coachAction(b.dataset.coach)));
}

function coachHead() {
  return `<h4>Tutorial <button class="x" data-coach="close" title="Hide the tutorial">✕</button></h4>
    <div class="ctabs"><button data-coach="step" class="${coachTab === 'step' ? 'active' : ''}">This step</button><button data-coach="basics" class="${coachTab === 'basics' ? 'active' : ''}">How to play</button></div>`;
}

function coachAction(a) {
  if (a === 'accept') store.set('tutorial', 'on');
  else if (a === 'decline' || a === 'close') store.set('tutorial', 'off');
  else if (a === 'step' || a === 'basics') coachTab = a;
  else if (a === 'prev') coachPage = Math.max(0, coachPage - 1);
  else if (a === 'next') coachPage = Math.min(BASICS.length - 1, coachPage + 1);
  renderCoach();
}

$('tutorialBtn').onclick = () => { store.set('tutorial', coachState() === 'on' ? 'off' : 'on'); renderCoach(); };

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
function reachable(u, { reaction = false } = {}) {
  const startZoc = zocAt(u, u.pos) || u.contact;
  const base = startZoc && !reaction ? (u.engaged ? CP.disengage : CP.breakContact) : 0;
  const cap = u.cpa <= 10 ? u.cpa * NON_MOTORISED_VOLUNTARY_LIMIT - u.cpUsed : Infinity;
  const maxSteps = Infinity; // fuel is paid once per Operations Stage from supply units [32.23], not per hex
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
      const c = stepCost(MAP, cur, n, { motorised: u.motorised, weather: localWeather(S.game.weather, MAP, n) });
      if (!c) continue;
      const cost = cb.cost + c.cp;
      const steps = cb.steps + 1;
      if (cost > budget || steps > maxSteps) continue;
      const intoZoc = zocAt(u, n);
      if (intoZoc && reaction) continue; // reacting units never enter an enemy ZOC
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
  if (g.decision) {
    el.innerHTML = decisionPanel(g.decision);
    if (!S.canAct) for (const input of el.querySelectorAll('input, select, button')) input.disabled = true;
    wireDecision(el, g.decision);
    return;
  }
  const SEES = { cic: 'the whole map, every formation, and summaries of supply, convoys and air', logistics: 'supply units, convoys and reinforcements, and each formation\'s fuel and ammunition position', rear: 'supply units and truck movement, and each formation\'s fuel and ammunition position', air: 'squadrons, bases, air stocks and air missions', front: 'full detail on your formations: cohesion, movement and weapons' };
  const seat = S.you?.role ? `<p class="muted">${esc(ROLE_NAMES[S.you.role])}: you see ${SEES[S.you.role]}, plus the map, weather and log. Ask your teammates in staff chat for the rest.</p>` : '';
  let head = `${seat}<h3>${esc(st.name)}</h3>${st.placeholder ? '<p class="note">Placeholder rules: this step will be replaced by the full rules.</p>' : ''}`;
  if (!acting) {
    const who = (g.acting || []).map(sideName).join(' and ');
    head += `<p class="note">${g.ready?.[mySide()] ? 'Your orders are in. ' : ''}Waiting on ${who || 'the host'}.</p>`;
  } else if (!S.canAct) {
    head += `<p class="note">${esc(S.actingFor || 'Nobody')} (${esc(ROLE_NAMES[st.role])} or stand-in) is acting for ${sideName(mySide())}. Advise them in staff chat.</p>`;
  }
  const body = ({ convoy: convoyForm, declare: declareForm, air: airForm, movecombat: moveCombatPanel, trucks: trucksForm })[g.step]();
  el.innerHTML = head + body;
  if (!S.canAct) for (const input of el.querySelectorAll('input, select, button')) input.disabled = true;
  if (S.canAct && ['convoy', 'trucks', 'air'].includes(g.step)) {
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = g.step === 'trucks' ? 'Move supply units and finish' : g.step === 'air' ? 'Fly these missions' : 'Submit orders';
    btn.onclick = () => send({ type: 'submit', orders: draft });
    el.appendChild(btn);
  }
  if (!S.canAct && st.kind === 'simultaneous' && g.ready?.[mySide()] && S.you && S.canAct === false) { /* view only */ }
  wireOrders(el);
}

// ---------- Decisions the non-phasing side makes during the enemy's phase ----------

function decisionPanel(d) {
  if (!d.mine) {
    const what = d.kind === 'reaction' ? 'decide whether to react' : 'set out its defence';
    return `<h3>Enemy response</h3><p class="note">Waiting for the ${sideName(d.side)} to ${what}.</p>` + lastCombatReport();
  }
  const who = S.canAct ? '' : `<p class="note">${esc(S.actingFor || 'Nobody')} (Front-line Commander or stand-in) decides this for ${sideName(mySide())}. Advise them in staff chat.</p>`;
  if (d.kind === 'reaction') {
    const units = d.unitIds.map((id) => myUnits().find((u) => u.id === id)).filter(Boolean);
    return `<h3>Reaction</h3>${who}<p><b>${esc(d.trigger)}</b> has moved next to your units. Motorised units may move away now, paying movement CP but no break-off cost. They may not enter an enemy zone of control.</p>
      <p class="help">Select a unit, then click a highlighted hex. Reaction is optional.</p>
      <ul class="orders">${units.map((u) => `<li>${d.moved.includes(u.id) ? '✓ ' : ''}<button class="act ${selected === u.id ? 'sel' : ''}" data-pick="${u.id}" ${d.moved.includes(u.id) ? 'disabled' : ''}>${esc(u.name)}</button> <span class="muted">CP ${fmtCP(u.cpUsed)}/${u.cpa}</span></li>`).join('')}</ul>
      <button class="primary act" data-end-reaction>Done: stay put</button>`;
  }
  const a = d.attack;
  const own = d.defenderIds.map((id) => myUnits().find((u) => u.id === id)).filter(Boolean);
  const attackers = a.attackerIds.map((id) => S.game.units.find((u) => u.id === id)).filter(Boolean);
  const hasArty = own.some((u) => (u.elements || []).some((e) => /Gun|Howitzer/.test(e.w)));
  const hasTanks = own.some((u) => u.type === 'arm' || (u.elements || []).some((e) => /CV 33|M 1[134]|Cruiser|Matilda|Crusader|Light|Stuart|Valentine|Pz/.test(e.w)));
  return `<h3>Under attack</h3>${who}
    <p><b>${attackers.map((u) => esc(u.name)).join(', ') || 'Enemy forces'}</b> ${a.probe ? 'probe' : 'attack'} your units at ${esc(hexLabel(key(...a.targetPos)))}.</p>
    <div class="attack">
      ${hasArty ? `<label class="check"><input type="checkbox" id="dFwd"> Artillery Forward <span class="muted">(guns combine fire and help defend, but are exposed to losses)</span></label>` : ''}
      ${hasTanks ? `<label class="check"><input type="checkbox" id="dTanks"> Tanks join the close assault <span class="muted">(otherwise they fire anti-armour)</span></label>` : ''}
      <p class="help"><b>Retreat before assault:</b> ticked units fall back after the barrage, unless the barrage pins them. If every unit leaves, there is no assault.</p>
      ${own.map((u) => `<label class="check"><input type="checkbox" data-rba value="${u.id}"> ${esc(u.name)} <span class="muted">(${u.str} TOE, cohesion ${u.cohesion})</span></label>`).join('')}
    </div>
    <button class="primary act" data-defend>Stand to</button>`;
}

function wireDecision(el, d) {
  el.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { selected = b.dataset.pick; renderOrders(); drawMap(); }));
  el.querySelector('[data-end-reaction]')?.addEventListener('click', () => { selected = null; send({ type: 'action', action: 'endReaction' }); });
  el.querySelector('[data-defend]')?.addEventListener('click', () => {
    send({
      type: 'action', action: 'defend',
      artilleryForward: !!el.querySelector('#dFwd')?.checked,
      tankRole: el.querySelector('#dTanks')?.checked ? 'assault' : 'antiArmour',
      retreat: [...el.querySelectorAll('[data-rba]:checked')].map((c) => c.value),
    });
  });
}

const reactionMode = () => S.game.decision?.kind === 'reaction' && S.game.decision.mine && S.canAct;

function convoyForm() {
  const g = S.game;
  if (mySide() === 'cw') {
    const next = (g.plan || []).map((p) => `Game-Turn ${p.turn}: ${p.n}`).join(' · ') || 'none planned';
    return `<p>Commonwealth supply arrives in Cairo and Alexandria by itself [32.7]. Supply period: <b>${['I', 'II', 'III'][g.supplyPeriod] ?? '–'}</b>.</p>
    <p class="help">Already scheduled: ${esc(next)}.</p><p class="note">Nothing to order this step.</p>`;
  }
  const ports = PORTS.filter((p) => g.portOwners[p.id] === 'axis').sort((a, b) => b.capacity - a.capacity);
  const lanes = g.turn <= 2 ? [2, 3, 6] : [1, 2, 3, 4, 5, 6];
  const box = g.box || 0;
  draft.convoys ||= box ? [{ port: ports[0]?.id || '', route: lanes[0], n: Math.min(3, box), stage: 1 }] : [];
  const used = new Set(draft.convoys.map((c) => c.route));
  const total = draft.convoys.reduce((a, c) => a + (c.n || 0), 0);
  const next = (g.plan || []).map((p) => `GT${p.turn}: ${p.n}`).join(' · ') || 'none';
  const sea = (g.atSea || []).map((c) => `${c.n} → ${PORTS.find((p) => p.id === c.port)?.name} (GT${c.turn} stage ${c.stage})`).join('; ');
  const row = (c, i) => `<div class="convoy-row">
    <select data-cv="port" data-i="${i}">${ports.map((p) => `<option value="${p.id}" ${c.port === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <label>Lane <select data-cv="route" data-i="${i}">${lanes.map((l) => `<option ${c.route === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Units <input type="number" min="0" max="3" data-cv="n" data-i="${i}" value="${c.n}"></label>
    <label>Arrives in stage <select data-cv="stage" data-i="${i}">${[1, 2, 3].map((st) => `<option ${c.stage === st ? 'selected' : ''}>${st}</option>`).join('')}</select></label>
    <button class="x" data-del-convoy="${i}" title="Remove this convoy">✕</button></div>`;
  return `<p>Supply units waiting in Tripoli: <b>${box}</b>. Convoy level this month: <b>${g.convoyLevel ?? '–'}</b>. Arrivals planned: ${esc(next)}.</p>
  ${draft.convoys.map(row).join('') || '<p class="muted">No convoys planned this turn.</p>'}
  <p class="help">Sending ${total} of ${box}. One convoy per lane, at most 3 supply units each [32.62]. Each convoy is bombed when it reaches port, in the Operations Stage you choose, so a later stage lets you see where the Commonwealth divisions are first.${sea ? ` At sea now: ${esc(sea)}.` : ''}</p>
  <button data-add-convoy ${used.size >= lanes.length || total >= box ? 'disabled' : ''}>Add a convoy</button>`;
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
  if ((g.access?.unitDetail ?? 2) < 2) return `<p>${sideName(g.phasing)} is Player ${g.half}, moving and fighting. Your seat doesn't see unit orders: the Front-line Commander runs this. Pass them what you know in staff chat.</p>` + lastCombatReport();
  if (!myPhase()) return `<p>${sideName(g.phasing)} is Player ${g.half} and is moving and fighting. Your units may only react once Reaction is implemented.</p>` + lastCombatReport();
  const seg = g.seg;
  const sel = myUnits().find((u) => u.id === selected);
  let html = `<p>Segment <b>${seg.n}</b> · ${seg.mode === 'move' ? 'Movement' : 'Combat'}.</p>`;
  if (seg.mode === 'move') {
    html += `<p class="help">Click one of your units, then a highlighted hex. Units stop on entering an enemy zone of control. Units that end a segment more than 2 hexes from the enemy can't move again this phase.</p>`;
    if (sel) html += unitCard(sel);
    if (seg.n === 1 && !seg.moved.length && sel && isCombat(sel)) {
      html += `<div class="btnrow"><button data-reserve="${sel.id}" data-off="${sel.reserve ? 1 : 0}">${sel.reserve ? 'Take out of Reserve' : 'Place in Reserve'}</button></div><p class="help">Reserve Designation Phase [18]: do this before anything moves. Units in Reserve I may move one hex; the rest of the Phase they may be released after combat.</p>`;
    }
    const inRes = myUnits().filter((u) => u.reserve);
    if (inRes.length) html += `<p class="help">In Reserve: ${inRes.map((u) => `${esc(u.name)} (${u.reserve === 1 ? 'I' : 'II'})`).join(', ')}.</p>`;
    html += `<div class="btnrow"><button class="act" data-act="toCombat">Finish moving → combat</button></div>`;
    html += lastCombatReport();
  } else {
    html += combatList();
    const rel = myUnits().filter((u) => u.reserve && (u.reserve === 1 ? seg.n === 1 : seg.n > 1));
    if (rel.length) html += `<h4>Reserve Release Segment</h4>${rel.map((u) => `<div class="btnrow"><button data-release="${u.id}">Release ${esc(u.name)}</button></div>`).join('')}<p class="help">Released from Reserve I: may not exceed its CPA, one assault. From Reserve II: half CPA, one assault, +1 disorganization point if it assaults [18.23-18.24].</p>`;
    html += `<div class="btnrow"><button class="act" data-act="nextSegment">New movement segment</button></div>`;
  }
  html += obligationList();
  html += `<button class="primary act" data-act="endPhase">End Movement &amp; Combat Phase</button>`;
  return html;
}

function unitCard(u) {
  const frozen = S.game.seg?.frozen?.includes(u.id);
  const moved = S.game.seg?.moved?.includes(u.id);
  const acc = S.game.access || { unitDetail: 2 };
  if (acc.unitDetail < 2) {
    return `<div class="unitcard"><b>${esc(u.name)}</b><br>TOE ${u.str}/${u.maxStr}${u.fuelNeed ? ` · fuel ${Math.floor(u.fuelAvail)}/${u.fuelNeed}` : ''}${acc.unitDetail === 1 && u.ammoAvail != null ? ` · ammo in reach ${Math.floor(u.ammoAvail)}` : ''}<br><span class="muted">Movement, cohesion and weapons are the Front-line Commander's business: ask in staff chat.</span></div>`;
  }
  return `<div class="unitcard"><b>${esc(u.name)}</b><br>
    CPA ${u.cpa} · used ${fmtCP(u.cpUsed)}${u.cpa <= 10 ? ` (foot: max ${u.cpa * NON_MOTORISED_VOLUNTARY_LIMIT})` : ''} · cohesion <b class="${u.cohesion < 0 ? 'bad' : ''}">${u.cohesion}</b><br>
    Morale ${u.morale > 0 ? '+' : ''}${u.morale} · TOE ${u.str}/${u.maxStr}${u.fuelNeed ? ` · fuel ${Math.floor(u.fuelAvail)}/${u.fuelNeed}` : ''} · ammo in reach ${Math.floor(u.ammoAvail)}${u.ammoNeed ? `/${u.ammoNeed} to attack` : ""}${u.motorised ? ` · breakdown pts ${fmtCP(u.bp)}` : ''}
    <br><span class="muted">${(u.elements || []).map((e) => `${e.toe}× ${esc(e.w)}`).join(' · ')}</span>
    ${u.supplyNote ? `<br><span class="bad">${esc(u.supplyNote)}</span>` : ''}
    ${u.reserve ? `<br><b>In Reserve ${u.reserve === 1 ? 'I (may move one hex)' : 'II (may not move)'}.</b>` : u.relFrom ? `<br><span class="muted">Released from Reserve ${u.relFrom === 1 ? 'I' : 'II'}: max ${u.relCap} CP, one assault.</span>` : ''}
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
        ${adj.map((u) => `<label class="check"><input type="checkbox" data-att="${e.id}" value="${u.id}" checked> ${esc(u.name)} (${u.str} TOE, cohesion ${u.cohesion}, <span class="${u.ammoAvail >= u.ammoNeed ? '' : 'bad'}">ammo ${Math.floor(u.ammoAvail)}/${u.ammoNeed} for a full attack</span>${u.ammoAvail >= 2 ? '' : ', <span class="bad">too little even to probe</span>'})</label>`).join('')}
        <div class="opts">
          <label class="check"><input type="checkbox" data-opt-fwd="${e.id}" checked> Artillery forward <span class="muted">(fires together and joins the assault, but is exposed)</span></label>
          <label class="check"><input type="checkbox" data-opt-at="${e.id}"> Tanks fire anti-armour <span class="muted">(instead of joining the close assault)</span></label>
          <label class="check"><input type="checkbox" data-opt-probe="${e.id}"> Probe only <span class="muted">(2 CP, 2 Ammo each, no Engaged result)</span></label>
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

function airForm() {
  draft.missions ||= [];
  const sqs = (S.game.air?.squadrons || []).filter((q) => q.kind === 'fighter' || q.kind === 'bomber');
  const cur = (id) => draft.missions.find((m) => m.sq === id) || { kind: '', hex: '' };
  const rows = sqs.map((q) => {
    const m = cur(q.id);
    return `<li><b>${esc(q.name)}</b> <span class="muted">at ${esc(q.facility)}: ${q.fueled} fuelled, ${q.armed} armed of ${q.ready} ready</span><br>
      <select data-am="kind" data-sq="${q.id}"><option value="">Stay on the ground</option>
        ${q.kind === 'bomber' ? `<option value="bCU" ${m.kind === 'bCU' ? 'selected' : ''}>Bomb troops in…</option>
        <option value="bSD" ${m.kind === 'bSD' ? 'selected' : ''}>Bomb a supply dump in…</option>
        <option value="bAF" ${m.kind === 'bAF' ? 'selected' : ''}>Bomb an air facility in…</option>` : `<option value="scramble" ${m.kind === 'scramble' ? 'selected' : ''}>Scramble against raiders</option>
        <option value="capO" ${m.kind === 'capO' ? 'selected' : ''}>Offensive patrol over…</option>
        <option value="capD" ${m.kind === 'capD' ? 'selected' : ''}>Defensive patrol over…</option>
        <option value="strafe" ${m.kind === 'strafe' ? 'selected' : ''}>Strafe enemy troops in…</option>`}</select>
      <input data-am="hex" data-sq="${q.id}" size="6" placeholder="C4807" value="${esc(m.hex || '')}"></li>`;
  }).join('');
  const st = S.game.air?.stock;
  return `<p class="help">Fighters fly, fight and strafe this phase. A squadron needs refitted, fuelled planes within range; armed planes hit hard, unarmed ones do not. Bombers need armed planes: tons delivered set the damage. Fighters over the target can shoot bombers down, so send an offensive patrol to the same hex. Planes that fly must be refitted, fuelled and armed again. Flak is not in the game yet.</p>
    ${st ? `<p class="muted">Air stocks: ${st.ammo} Ammo, ${st.fuel} Fuel, ${st.stores} Stores.</p>` : ''}
    <ul class="orders">${rows || '<li class="muted">You have no fighter or bomber squadrons.</li>'}</ul>`;
}

function trucksForm() {
  draft.moves ||= [];
  const mine = (S.game.supply || []).filter((x) => x.own);
  const sel = mine.find((x) => x.id === selectedSupply);
  return `<p>Truck Convoy Phase. Click one of your supply units on the map (square markers), then click a destination hex up to 15 CP away. Each move costs 1 Fuel.</p>
  <p class="help">${sel ? `Selected: supply unit at ${esc(hexLabel(key(...sel.pos)))} (ammo ${sel.ammo}, fuel ${sel.fuel}).` : 'No supply unit selected.'}</p>
  <ul class="orders">${draft.moves.map((m, i) => `<li>${esc(m.id)} → ${esc(hexLabel(m.to))} <button class="x" data-del-move="${i}">✕</button></li>`).join('') || '<li class="muted">No moves ordered.</li>'}</ul>`;
}

function wireOrders(el) {
  el.querySelectorAll('[data-am]').forEach((i) => (i.onchange = () => {
    draft.missions ||= [];
    let m = draft.missions.find((x) => x.sq === i.dataset.sq);
    if (!m) { m = { sq: i.dataset.sq, kind: '', hex: '' }; draft.missions.push(m); }
    m[i.dataset.am] = i.value.trim();
    draft.missions = draft.missions.filter((x) => x.kind);
  }));
  el.querySelectorAll('[data-cv]').forEach((i) => (i.onchange = () => {
    const k = i.dataset.cv, c = draft.convoys[+i.dataset.i];
    c[k] = k === 'port' ? i.value : Math.max(0, parseInt(i.value, 10) || 0);
    renderOrders();
  }));
  el.querySelectorAll('[data-del-convoy]').forEach((b) => (b.onclick = () => { draft.convoys.splice(+b.dataset.delConvoy, 1); renderOrders(); }));
  const addCv = el.querySelector('[data-add-convoy]');
  if (addCv) addCv.onclick = () => {
    const lanes = S.game.turn <= 2 ? [2, 3, 6] : [1, 2, 3, 4, 5, 6];
    const free = lanes.find((l) => !draft.convoys.some((c) => c.route === l));
    const left = (S.game.box || 0) - draft.convoys.reduce((a, c) => a + c.n, 0);
    draft.convoys.push({ port: draft.convoys[0]?.port || '', route: free, n: Math.min(3, Math.max(0, left)), stage: 1 });
    renderOrders();
  };
  el.querySelectorAll('[data-declare]').forEach((b) => (b.onclick = () => send({ type: 'submit', orders: { goFirst: b.dataset.declare === 'first' } })));
  el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
    if (b.dataset.act === 'endPhase' && !confirm('End your Movement & Combat Phase?')) return;
    selected = null;
    send({ type: 'action', action: b.dataset.act });
  }));
  el.querySelectorAll('[data-reserve]').forEach((b) => (b.onclick = () => send({ type: 'action', action: 'reserve', unitIds: [b.dataset.reserve], off: b.dataset.off === '1' })));
  el.querySelectorAll('[data-release]').forEach((b) => (b.onclick = () => send({ type: 'action', action: 'release', unitIds: [b.dataset.release] })));
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
  el.querySelectorAll('[data-del-move]').forEach((b) => (b.onclick = () => { draft.moves.splice(+b.dataset.delMove, 1); renderOrders(); drawMap(); }));
}

// ---------- Supply / formations ----------

function victoryHtml(v) {
  if (!v) return '';
  if (v.mode === 'points') {
    const me = mySide(), foe = me === 'axis' ? 'cw' : 'axis';
    return `<h3>Victory points</h3><p>${sideName(me)}: <b>${v[me]}</b> · ${sideName(foe)}: <b>${v[foe]}</b></p><p class="help">Points for the towns each side holds when the scenario ends (60.82, 64.73). The side with most wins.</p>`;
  }
  const line = (side) => (v[side] ? `${sideName(side)}: ${v[side].tier} (${esc(v[side].what)})` : `${sideName(side)}: no victory condition met yet`);
  return `<h3>Victory</h3><p>${line(mySide())}</p><p>${line(mySide() === 'axis' ? 'cw' : 'axis')}</p>`;
}

function renderSupply() {
  const el = $('tab-supply');
  if (!mySide()) { el.innerHTML = ''; return; }
  const g = S.game;
  const acc = g.access || { supply: 2, convoys: 2, air: 2, unitDetail: 2 };
  const n = (v) => Math.floor(v);
  const sup = (g.supply || []).filter((x) => x.own);
  const v = g.victory;
  const cols = acc.unitDetail === 2 ? '<th>CP</th><th>Coh</th>' : '';
  const row = (u) => `<tr class="${(acc.unitDetail === 2 && u.cohesion <= -10) || (u.fuelNeed > u.fuelAvail) ? 'warn' : ''}"><td>${esc(u.name)}</td>${acc.unitDetail === 2 ? `<td>${fmtCP(u.cpUsed)}/${u.cpa}</td><td>${u.cohesion}</td>` : ''}<td>${u.str}/${u.maxStr}</td><td>${u.fuelNeed || '–'}</td><td>${n(u.fuelAvail)}</td><td>${n(u.ammoAvail)}${u.ammoNeed ? `/${u.ammoNeed}` : ''}</td></tr>`;
  const formations = acc.unitDetail >= 1
    ? `<h3>Formations</h3><table class="grid"><tr><th>Unit</th>${cols}<th>Str</th><th>Fuel need</th><th>Fuel</th><th>Ammo</th></tr>${myUnits().map(row).join('')}</table>
      ${myUnits().filter((u) => u.supplyNote).map((u) => `<p class="bad"><b>${esc(u.name)}:</b> ${esc(u.supplyNote)}</p>`).join('')}` : '';
  const dumps = acc.supply === 2
    ? `<h3>Supply units</h3><table class="grid"><tr><th>Where</th><th>Ammo</th><th>Fuel</th></tr>
      ${sup.map((x) => `<tr><td>${esc(hexLabel(key(...x.pos)))}</td><td>${n(x.ammo)}</td><td>${n(x.fuel)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">None in the field.</td></tr>'}</table>`
    : g.supplyTotals ? `<h3>Supplies</h3><p>${g.supplyTotals.units} supply units in the field, holding <b>${n(g.supplyTotals.ammo)}</b> Ammo and <b>${n(g.supplyTotals.fuel)}</b> Fuel in all. The Logistics and Rear Area Commanders have the detail.</p>` : '';
  const box = acc.convoys >= 1 && g.box != null && mySide() === 'axis' ? `<p>Waiting in Tripoli: <b>${g.box}</b> supply unit${g.box === 1 ? '' : 's'}.</p>` : '';
  el.innerHTML = `${formations}${dumps}${box}
    <p>Prisoners held: <b>${g.prisoners?.[mySide()] ?? 0}</b> TOE points.</p>
    ${victoryHtml(v)}
    <p class="help">Units draw Fuel (once per Operations Stage) and Ammunition (at combat) from supply units within half their CPA [32.2]. Spending past the allowance costs cohesion. A stage spent resting restores up to 5 cohesion (never above 0). At −26 a unit can't move or fight.</p>`;
}

// ---------- Air tab (Air Game, stage 1: forces and bases) ----------
let airSeen = null; // number of the last air phase the map has shown
let airAnim = null;
const AIR_VERB = { capO: 'offensive patrol', capD: 'defensive patrol', strafe: 'strafing', bCU: 'bombing troops', bSD: 'bombing a supply dump', bAF: 'bombing an air facility' };
function startAirAnim() {
  airAnim = { start: performance.now(), dur: 3600 };
  const tick = () => {
    if (!airAnim) return;
    drawMap();
    if (performance.now() - airAnim.start < airAnim.dur) requestAnimationFrame(tick); else { airAnim = null; drawMap(); }
  };
  requestAnimationFrame(tick);
}
const KIND_LABEL = { fighter: 'Fighters', bomber: 'Bombers', recon: 'Recon', transport: 'Transports', flyingboat: 'Flying boats' };
function lastAirReport() {
  const la = S.game.lastAir;
  if (!la) return '';
  const me = mySide();
  const rows = la.flights.map((f) => {
    const mine = f.side === me;
    const where = esc(nameOfHex(...f.to));
    const what = AIR_VERB[f.kind] || f.kind;
    const out = f.failed ? esc(f.result) : `${f.sent} plane${f.sent === 1 ? '' : 's'}${f.lost ? `, ${f.lost} lost` : ''}${f.result ? `: ${esc(f.result)}` : ''}`;
    return `<tr class="${mine ? '' : 'warn'}"><td>${mine ? esc(f.name) : 'Enemy'}</td><td>${f.scrambled ? 'scrambled to ' : ''}${what}</td><td>${where}</td><td>${out}</td></tr>`;
  }).join('');
  return `<h3>Last air phase <span class="muted">(Game-Turn ${la.turn}, Operations Stage ${la.stage})</span></h3>${rows ? `<table class="grid"><tr><th>Flight</th><th>Mission</th><th>Over</th><th>Result</th></tr>${rows}</table>` : '<p class="muted">No missions were flown.</p>'}`;
}

function renderAir() {
  const el = $('tab-air');
  if (!mySide() || !S.game?.air) { el.innerHTML = ''; return; }
  const a = S.game.air;
  if (a.summary) {
    el.innerHTML = `<h3>Air forces</h3><p><b>${a.totals.planes}</b> aircraft in <b>${a.totals.squadrons}</b> squadrons, <b>${a.totals.ready}</b> ready to fly. The Air Commander runs them: ask in staff chat for detail, or to arrange cover.</p>${lastAirReport()}`;
    return;
  }
  const fname = (id) => a.facilities.find((f) => f.id === id)?.name || id;
  const planes = a.squadrons.reduce((n, s) => n + s.total, 0), ready = a.squadrons.reduce((n, s) => n + s.ready, 0);
  const pilots = Object.entries(a.pilots).filter(([, n]) => n).sort((x, y) => y[0] - x[0]).map(([r, n]) => `${n}×${r}`).join(', ');
  el.innerHTML = `<h3>Air forces</h3>
    <p><b>${planes}</b> aircraft in <b>${a.squadrons.length}</b> squadrons (<b>${ready}</b> ready to fly). Rated pilots: ${pilots || 'none'} (others fly as zero-rated). Squadron Ground Support Units available: ${a.sgsu}.</p>
    <table class="grid"><tr><th>Squadron</th><th>Role</th><th>Based at</th><th>Planes</th><th>Ready</th><th>Pilots</th></tr>
    ${a.squadrons.map((s) => `<tr><td>${esc(s.name)}</td><td>${KIND_LABEL[s.kind] || s.kind}</td><td>${esc(fname(s.facility))}</td><td>${s.total}</td><td>${s.ready}</td><td>${s.pilots.length ? s.pilots.join(', ') : '–'}</td></tr>`).join('')}</table>
    <h3>Air facilities</h3><table class="grid"><tr><th>Facility</th><th>Type</th><th>Squadrons</th><th>Hex</th></tr>
    ${a.facilities.map((f) => `<tr class="${f.own ? '' : 'warn'}"><td>${esc(f.name)}${f.own ? '' : ' (enemy)'}</td><td>${esc(AIR_FACILITY_NAMES[f.kind])}</td><td>${f.own ? `${f.used}/${f.cap}` : '–'}</td><td>${f.off ? 'off-map' : esc(f.hex)}</td></tr>`).join('')}</table>
    ${lastAirReport()}
    <p class="help">Squadrons are 12 Italian planes (9 ready, 3 in reserve) or 20 Commonwealth planes (15 + 5) [35.23]. Fighter and bomber missions are given in the Orders tab during the Land Support Air Phase; flights are drawn on the map afterwards. Flak, recon and convoy bombing are not built yet.</p>`;
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
      const hostCanRemove = !!p && !mine && S.you.isHost;
      seat.disabled = !!p && !mine && !hostCanRemove;
      seat.onclick = () => {
        if (mine) return send({ type: 'leaveSeat' });
        if (hostCanRemove) { if (confirm(`Remove ${p.name}${p.connected ? '' : ' (away)'} from the ${ROLE_NAMES[role]} seat? Their seat becomes vacant and can be taken by someone else.`)) send({ type: 'kick', playerId: p.id }); return; }
        send({ type: 'claim', side, role });
      };
      if (mine) seat.title = 'Click to leave this seat';
      if (hostCanRemove) seat.title = 'Host: click to remove this player from the seat';
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
const scenSel = $('optScenario');
scenSel.innerHTML = Object.values(SCENARIOS).map((sc) => `<option value="${sc.id}">${esc(sc.name)} (GT 1-${sc.lastTurn})</option>`).join('');
const showBlurb = () => { const sc = SCENARIOS[scenSel.value]; $('scenarioBlurb').textContent = `${sc.blurb} Estimated play: ${sc.hours}.`; };
scenSel.onchange = showBlurb; showBlurb();
$('startBtn').onclick = () => send({ type: 'start', options: { scenario: scenSel.value, reinforce: $('optReinforce').value, troops: $('optTroops').value, stock: $('optStock').value, air: $('optAir').value } });

// ---------- Tabs ----------

// Hide the tabs a seat has nothing in [role-limited views].
function applyTabAccess() {
  const acc = S.game?.access || { supply: 2, air: 2, unitDetail: 2 };
  const show = { supply: acc.supply > 0 || acc.unitDetail > 0, air: acc.air > 0 };
  for (const [tab, ok] of Object.entries(show)) {
    document.querySelector(`#tabs button[data-tab="${tab}"]`)?.classList.toggle('hidden', !ok);
    if (!ok && !$(`tab-${tab}`).classList.contains('hidden')) document.querySelector('#tabs button[data-tab="orders"]').click();
  }
}


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
  reachCache = !sel ? null
    : reactionMode() ? (S.game.decision.unitIds.includes(sel.id) && !S.game.decision.moved.includes(sel.id) ? reachable(sel, { reaction: true }) : null)
    : myPhase() && !S.game.decision && S.game.seg?.mode === 'move' && S.canAct ? reachable(sel) : null;

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
      { const w = t.t !== 'sea' && localWeather(S.game.weather, MAP, [c, r]); if (w === 'sand' || w === 'rain') { hexPath(x, y, s); ctx.fillStyle = w === 'sand' ? 'rgba(214,170,90,0.38)' : 'rgba(70,110,170,0.32)'; ctx.fill(); } }
      if (t.t !== 'sea' && !visible(c, r)) { hexPath(x, y, s); ctx.fillStyle = 'rgba(40,30,15,0.16)'; ctx.fill(); }
      if (s >= 9) {
        hexPath(x, y, s);
        ctx.strokeStyle = 'rgba(80,60,30,0.22)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
  // Where the selected supply unit may be moved (Truck Convoy Phase)
  const selSup = S.game.step === 'trucks' && S.canAct ? (S.game.supply || []).find((x) => x.id === selectedSupply && x.reach) : null;
  if (selSup) {
    for (const [k, cost] of Object.entries(selSup.reach)) {
      if (k === key(...selSup.pos)) continue;
      const [c, r] = parseKey(k); const { x, y } = centre(c, r);
      hexPath(x, y, s); ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill();
      if (s >= 16) { ctx.fillStyle = '#222'; ctx.font = `${Math.max(8, s * 0.38)}px "Courier New", monospace`; ctx.textAlign = 'center'; ctx.fillText(fmtCP(cost), x, y + s * 0.55); }
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
  // Supply units (squares, with a cross if selected)
  for (const x of S.game.supply || []) {
    const { x: px, y: py } = centre(...x.pos);
    ctx.fillStyle = x.side === 'axis' ? '#6b6b4a' : '#7a5a2e'; ctx.strokeStyle = x.id === selectedSupply ? '#d11' : '#111'; ctx.lineWidth = x.id === selectedSupply ? 2.5 : 1;
    ctx.fillRect(px + s * 0.3, py - s * 0.8, s * 0.38, s * 0.38); ctx.strokeRect(px + s * 0.3, py - s * 0.8, s * 0.38, s * 0.38);
  }
  // Broken-down vehicles
  for (const b of S.game.broken || []) {
    const { x, y } = centre(...b.pos);
    ctx.fillStyle = SIDE_COLORS[b.side]?.fill || '#ccc'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x - s * 0.4, y + s * 0.45, s * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.font = `bold ${Math.max(8, s * 0.3)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(String(b.n), x - s * 0.4, y + s * 0.55);
  }
  // Planned supply moves
  if (S.game.step === 'trucks') for (const m of draft.moves || []) {
    const src = (S.game.supply || []).find((x) => x.id === m.id);
    if (!src) continue;
    const a = centre(...src.pos), b = centre(...parseKey(m.to));
    ctx.strokeStyle = '#2f5d3a'; ctx.setLineDash([3, 3]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  }
  // Units (stacks fan out slightly)
  const stacks = new Map();
  for (const u of S.game.units) { const k = key(...u.pos); if (!stacks.has(k)) stacks.set(k, []); stacks.get(k).push(u); }
  for (const list of stacks.values()) list.forEach((u, i) => drawCounter(u, i, list.length));
  drawAirOverlay();
}

// Flight paths from the last Land Support Air Phase, plus the missions being planned now.
function drawAirOverlay() {
  const s = view.size;
  const t = airAnim ? Math.min(1, (performance.now() - airAnim.start) / (airAnim.dur * 0.7)) : 1;
  const colour = (f) => (f.failed ? '#777' : f.side === 'axis' ? '#4a4a2a' : '#8a4b16');
  const plane = (x, y, ang, col) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s * 0.45, 0); ctx.lineTo(-s * 0.3, s * 0.3); ctx.lineTo(-s * 0.15, 0); ctx.lineTo(-s * 0.3, -s * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  };
  const la = S.game.lastAir;
  for (const f of la?.flights || []) {
    const to = centre(...f.to);
    const col = colour(f);
    if (f.from) {
      const from = centre(...f.from);
      ctx.strokeStyle = col; ctx.globalAlpha = 0.75; ctx.lineWidth = 2; ctx.setLineDash(f.failed ? [2, 5] : [7, 5]);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (!f.failed && t < 1) plane(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, Math.atan2(to.y - from.y, to.x - from.x), col);
    } else if (t < 1) {
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(to.x, to.y, s * (0.4 + t), 0, Math.PI * 2); ctx.stroke(); // enemy raid: only the target shows
    }
    if (t >= 1 || !f.from) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(to.x + s * 0.55, to.y - s * 0.55, s * 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(8, s * 0.34)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(f.failed ? '×' : String(f.sent), to.x + s * 0.55, to.y - s * 0.43);
      if (f.lost) { ctx.fillStyle = '#c11'; ctx.font = `bold ${Math.max(8, s * 0.3)}px sans-serif`; ctx.fillText(`−${f.lost}`, to.x + s * 0.55, to.y - s * 0.95); }
    }
  }
  // Missions being planned in the Land Support Air Phase
  if (S.game.step === 'air' && S.canAct) {
    const a = S.game.air;
    for (const m of draft.missions || []) {
      const sq = a.squadrons.find((q) => q.id === m.sq);
      const fac = sq && a.facilities.find((x) => x.id === sq.facility);
      const hex = m.hex && hexFromName(m.hex);
      if (!fac?.hex || !hex) continue;
      const from = centre(...hexFromName(fac.hex)), to = centre(...hex);
      ctx.strokeStyle = '#1c3d8c'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]);
      plane(to.x, to.y, Math.atan2(to.y - from.y, to.x - from.x), '#1c3d8c');
    }
  }
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
  if (u.reserve) { // Reserve marker on top of the unit [18.12]
    ctx.fillStyle = '#7a1f1f'; ctx.fillRect(x - w / 2, y - h / 2 - s * 0.05, w * 0.5, s * 0.32);
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(6, s * 0.26)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(u.reserve === 1 ? 'R I' : 'R II', x - w / 4, y - h / 2 + s * 0.2);
  }
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
  const sup = (S.game.supply || []).filter((x) => key(...x.pos) === key(c, r));
  const port = LOCATIONS.find((l) => l.hexes.some((h) => h[0] === c && h[1] === r));
  const reach = reachCache?.get(key(c, r));
  const terr = TERRAIN[t.t];
  $('hexInfo').innerHTML = [
    `<b>${nameOfHex(c, r)}</b> ${esc(terr.label)} <span class="muted">(CP ${terr.np === Infinity ? 'P' : terr.np}/${terr.mp === Infinity ? 'P' : terr.mp}, stack ${terr.stack})</span>`,
    port ? `${esc(port.name)} (${sideName(S.game.portOwners[port.id])}${port.port ? ', port' : ''}${port.city ? ', major city' : ''}${port.victory ? ', victory location' : ''})` : '',
    ...us.map((u) => `${esc(u.name)} · ${u.str}/${u.maxStr} TOE points${u.side === mySide() && u.cohesion != null ? ` · CP ${fmtCP(u.cpUsed)}/${u.cpa} · coh ${u.cohesion}` : ''}`),
    ...sup.map((x) => x.own ? (x.ammo != null ? `Supply unit: ammo ${Math.floor(x.ammo)}, fuel ${Math.floor(x.fuel)}` : 'Your supply unit') : 'Enemy supply unit'),
    reach ? `Move here: ${fmtCP(reach.cost)} CP${reach.stop ? ' · enters enemy ZOC (must stop)' : ''}` : '',
  ].filter(Boolean).join('<br>');
}

function clickHex([c, r]) {
  if (!S?.game || S.game.over || !mySide()) return;
  if (S.game.step === 'trucks' && S.canAct) {
    const k0 = key(c, r);
    const here = (S.game.supply || []).filter((x) => x.own && key(...x.pos) === k0 && !x.moved && !(draft.moves || []).some((m) => m.id === x.id));
    if (here.length && (!selectedSupply || !here.some((x) => x.id === selectedSupply))) { selectedSupply = here[0].id; renderOrders(); drawMap(); return; }
    if (selectedSupply) {
      const su = (S.game.supply || []).find((x) => x.id === selectedSupply);
      if (!su?.reach?.[k0]) { toast('A supply unit cannot go there (15 CP by truck, not into the sea or enemy hexes).'); return; }
      draft.moves ||= [];
      draft.moves.push({ id: selectedSupply, to: k0 });
      selectedSupply = null; renderOrders(); drawMap();
      return;
    }
    return;
  }
  const mine = unitsAt(c, r).filter((u) => u.side === mySide());
  const k = key(c, r);
  // Moving the selected unit takes priority if the hex is reachable.
  if (selected && reachCache?.has(k) && k !== key(...myUnits().find((u) => u.id === selected).pos)) {
    const path = pathTo(reachCache, k);
    send({ type: 'action', action: reactionMode() ? 'react' : 'move', unitId: selected, path });
    if (reactionMode()) selected = null;
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
  supplyReach() { const x = (S?.game?.supply || []).find((y) => y.id === selectedSupply); return x?.reach ? Object.keys(x.reach).map((k) => nameOfHex(...parseKey(k))) : []; },
  myUnitIds() { return (S?.game?.units || []).filter((u) => u.own !== false && u.side === mySide() && u.type !== 'hq').map((u) => u.id); },
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
