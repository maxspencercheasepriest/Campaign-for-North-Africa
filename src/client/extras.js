// Quality-of-life additions for the map screen: click-to-go links, find box, idle-unit cycling, shortcuts, notifications,
// turn summary, hover tooltip, minimap, last-seen enemy ghosts, overview tab, area-of-control shading, shared markers, replay.
// Everything here is guarded so that a fault in an extra can never stop the main screen from drawing.
import { key, parseKey, distance, neighbours, hexToPixel } from '/shared/hex.js';
import { hexFromName, nameOfHex } from '/shared/hexnames.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Pure helpers used by client.js while it builds its HTML ----------

/** A name that centres the map on a hex when clicked (and selects a unit, if given). */
export function goLink(label, pos, selectId) {
  if (!pos) return esc(label);
  return `<a class="go" data-go="${key(...pos)}"${selectId ? ` data-sel="${esc(selectId)}"` : ''} title="Show on the map">${esc(label)}</a>`;
}

/** Turn hex names such as C4807 inside already-escaped text into links. */
export function linkHexes(html) {
  return String(html).replace(/\b([A-E]\d{4})\b/g, (m) => {
    try { const h = hexFromName(m); return h && Number.isInteger(h[0]) ? `<a class="go" data-go="${key(...h)}">${m}</a>` : m; } catch { return m; }
  });
}

export function installExtras(api) {
  const { $, view, canvas, drawMap, send, toast, centre, hexPath, ctx, TILES, LOCATIONS, VISION_RANGE, COLORS } = api;
  const S = () => api.S();
  const g = () => S()?.game;
  const side = () => S()?.you?.side;
  const safe = (name, fn) => (...a) => { try { return fn(...a); } catch (e) { console.error(`[extras:${name}]`, e); } };

  // ---------- Camera ----------
  let flash = null;
  const size = () => ({ w: canvas.width / devicePixelRatio, h: canvas.height / devicePixelRatio });
  function goTo(pos, { zoom = 14, select = null, ring = true } = {}) {
    if (!pos) return;
    if (view.size < zoom) view.size = zoom;
    const p = hexToPixel(pos[0], pos[1], view.size), { w, h } = size();
    view.ox = w / 2 - p.y; view.oy = h / 2 + p.x;
    if (ring) {
      flash = { pos, start: performance.now() };
      const tick = () => { if (!flash) return; drawMap(); if (performance.now() - flash.start < 1800) requestAnimationFrame(tick); else { flash = null; drawMap(); } };
      requestAnimationFrame(tick);
    } else drawMap();
    if (select) api.selectUnit(select);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('[data-go]');
    if (!a) return;
    e.preventDefault();
    goTo(parseKey(a.dataset.go), { select: a.dataset.sel || null });
  });

  // ---------- Find box ----------
  function findItems() {
    const gm = g(); if (!gm) return [];
    const out = [];
    for (const u of gm.units || []) out.push({ label: u.name + (u.side !== side() ? ' (enemy)' : ''), pos: u.pos, sel: u.side === side() ? u.id : null });
    for (const f of gm.air?.facilities || []) { const h = f.hex && hexFromName(f.hex); if (h) out.push({ label: `${f.name || f.kind} (air facility)`, pos: h }); }
    for (const s of gm.fleet?.ships || []) if (s.hex && !s.sunk) out.push({ label: `${s.name} (${s.cls})`, pos: s.hex });
    for (const l of LOCATIONS) if (l.hexes?.[0]) out.push({ label: l.name, pos: l.hexes[0] });
    return out;
  }
  let findCycle = { q: '', i: 0 };
  function findGo(q) {
    q = q.trim().toLowerCase(); if (!q) return;
    let h = null;
    if (/^[a-e]\d{4}$/i.test(q)) { try { h = hexFromName(q.toUpperCase()); } catch { /* not a hex */ } if (h) return goTo(h); }
    const hits = findItems().filter((x) => x.label.toLowerCase().includes(q));
    if (!hits.length) return toast(`Nothing found for "${q}".`);
    findCycle = findCycle.q === q ? { q, i: findCycle.i + 1 } : { q, i: 0 };
    const hit = hits[findCycle.i % hits.length];
    goTo(hit.pos, { select: hit.sel });
    if (hits.length > 1) toast(`${hit.label} (${(findCycle.i % hits.length) + 1} of ${hits.length}; press Enter again for the next)`);
  }
  const findBox = $('findBox');
  if (findBox) {
    findBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); safe('find', findGo)(findBox.value); } e.stopPropagation(); });
  }
  const refreshFind = () => {
    const dl = $('findList'); if (!dl) return;
    const seen = new Set();
    dl.innerHTML = findItems().map((x) => x.label).filter((l) => !seen.has(l) && seen.add(l)).slice(0, 400).map((l) => `<option value="${esc(l)}"></option>`).join('');
  };

  // ---------- Idle units ----------
  let idleIx = -1;
  function idleUnits() {
    const gm = g(); if (!gm || !side()) return [];
    return (gm.units || []).filter((u) => u.side === side() && u.type !== 'hq' && u.str > 0 && !u.cpUsed && !u.reserve);
  }
  function nextIdle(dir = 1) {
    const list = idleUnits();
    if (!list.length) return toast('No idle units: everything has moved or none is yours to move.');
    idleIx = (idleIx + dir + list.length * 1000) % list.length;
    const u = list[idleIx % list.length];
    goTo(u.pos, { select: u.id, zoom: 14 });
  }
  $('idleBtn')?.addEventListener('click', () => nextIdle(1));

  // ---------- Keyboard shortcuts ----------
  const TAB_KEYS = { 1: 'orders', 2: 'supply', 3: 'air', 4: 'overview', 5: 'staff', 6: 'log', 7: 'chat' };
  const help = $('shortcutHelp');
  addEventListener('keydown', safe('keys', (e) => {
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === '?' || k === '/') { help?.classList.toggle('hidden'); e.preventDefault(); return; }
    if (k === 'Escape') { help?.classList.add('hidden'); $('turnSummary')?.classList.add('hidden'); markMode = null; renderMarkBar(); api.cancel?.(); drawMap(); return; }
    if (!g()) return;
    if (k === 'n') nextIdle(1);
    else if (k === 'N') nextIdle(-1);
    else if (k === 'f' || k === 'F') { findBox?.focus(); e.preventDefault(); }
    else if (k === 'm' || k === 'M') { $('mini')?.classList.toggle('hidden'); }
    else if (k === 'g' || k === 'G') { shading = !shading; $('shadeBtn')?.classList.toggle('on', shading); drawMap(); }
    else if (k === 'b' || k === 'B') { $('notes')?.classList.toggle('open'); }
    else if (k === 'p' || k === 'P') { markMode = markMode === 'pin' ? null : 'pin'; arrowFrom = null; renderMarkBar(); }
    else if (k === 'r' || k === 'R') { markMode = markMode === 'arrow' ? null : 'arrow'; arrowFrom = null; renderMarkBar(); }
    else if (k === 'x' || k === 'X') { markMode = markMode === 'erase' ? null : 'erase'; renderMarkBar(); }
    else if (TAB_KEYS[k]) document.querySelector(`#tabs button[data-tab="${TAB_KEYS[k]}"]`)?.click();
  }));
  $('helpBtn')?.addEventListener('click', () => help?.classList.toggle('hidden'));
  help?.addEventListener('click', (e) => { if (e.target === help) help.classList.add('hidden'); });

  // ---------- Notifications ----------
  function computeNotes() {
    const gm = g(), me = side(), notes = [];
    if (!gm || !me) return notes;
    if (gm.decision) notes.push({ icon: '⚑', text: 'A decision is waiting for you.' });
    for (const u of gm.units || []) {
      if (u.side !== me) continue;
      if (u.supplyNote) notes.push({ icon: '⛽', text: `${u.name}: ${u.supplyNote}`, pos: u.pos, sel: u.id });
      else if (u.cohesion != null && u.cohesion <= -10) notes.push({ icon: '⚠', text: `${u.name} is badly disorganised (cohesion ${u.cohesion}).`, pos: u.pos, sel: u.id });
    }
    
    for (const f of gm.damage?.fort || []) if (f.level < f.base) notes.push({ icon: '🏰', text: `Fortification at ${f.hex} is at Level ${f.level} of ${f.base}.`, pos: parseKey(f.hex) });
    for (const p of gm.damage?.ports || []) notes.push({ icon: '⚓', text: `${p.name}: port at ${p.eff}/${p.max} efficiency.`, pos: p.hex });
    for (const f of gm.air?.facilities || []) { const max = api.facilityCap[f.kind]; if (f.owner === me && f.hex && f.cap < max) notes.push({ icon: '✈', text: `${f.name || f.kind} at ${f.hex}: air facility at ${f.cap}/${max}.`, pos: hexFromName(f.hex) }); }
    if (gm.step === 'fleet' && side() === 'cw') { const n = (gm.fleet?.ships || []).filter((s) => s.ready).length; if (n) notes.push({ icon: '⚓', text: `${n} ship${n === 1 ? '' : 's'} ready to sail.` }); }
    if (gm.portRewards && gm.portRewards.points >= gm.portRewards.next - 3) notes.push({ icon: '★', text: `Port points ${gm.portRewards.points}/${gm.portRewards.next}: a reinforcement is close.` });
    return notes;
  }
  function renderNotes() {
    const box = $('notes'); if (!box) return;
    const notes = computeNotes();
    box.classList.toggle('hidden', !g() || !side());
    box.innerHTML = `<button class="notes-btn" id="notesBtn" title="Things that need attention (B)">🔔 ${notes.length}</button>
      <div class="notes-list">${notes.map((n) => `<div class="note-row">${n.pos ? `<a class="go" data-go="${key(...n.pos)}"${n.sel ? ` data-sel="${esc(n.sel)}"` : ''}>${n.icon} ${esc(n.text)}</a>` : `${n.icon} ${esc(n.text)}`}</div>`).join('') || '<div class="note-row muted">All quiet.</div>'}</div>`;
    $('notesBtn').onclick = () => box.classList.toggle('open');
  }

  // ---------- Turn summary ----------
  let lastTurnSeen = null;
  const IMPORTANT = /surrender|destroy|sunk|sink|torpedo|captur|Port points|Port bonus|joins|arrive|lands|pulled|bomb|lost|retreat|rout|wrecked|shot down/i;
  function turnSummary() {
    const gm = g(); if (!gm) return;
    if (lastTurnSeen !== null && gm.turn > lastTurnSeen && side()) {
      const prev = gm.turn - 1;
      const lines = (gm.log || []).filter((l) => l.turn === prev && (l.side === 'all' || l.side === side()) && IMPORTANT.test(l.text)).slice(-14);
      const box = $('turnSummary');
      if (box) {
        box.innerHTML = `<div class="dialog"><h2>Game-Turn ${prev} in review</h2>
          <p><b>Game-Turn ${gm.turn}</b> · ${esc(gm.date)} · Initiative: <b>${esc(api.sideName(gm.initiative?.holder))}</b></p>
          ${lines.length ? `<ul class="sum">${lines.map((l) => `<li>${linkHexes(esc(l.text))}</li>`).join('')}</ul>` : '<p class="muted">A quiet turn.</p>'}
          <button id="sumClose">Carry on</button></div>`;
        box.classList.remove('hidden');
        $('sumClose').onclick = () => box.classList.add('hidden');
      }
    }
    if (lastTurnSeen === null || gm.turn !== lastTurnSeen) lastTurnSeen = gm.turn;
  }

  // ---------- Hover tooltip ----------
  const tip = $('tip');
  canvas.addEventListener('mousemove', (e) => {
    if (!tip) return;
    const html = $('hexInfo')?.innerHTML;
    if (!html || e.buttons) { tip.classList.add('hidden'); return; }
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const r = canvas.parentElement.getBoundingClientRect();
    let x = e.clientX - r.left + 16, y = e.clientY - r.top + 16;
    if (x + tip.offsetWidth > r.width) x = e.clientX - r.left - tip.offsetWidth - 12;
    if (y + tip.offsetHeight > r.height) y = e.clientY - r.top - tip.offsetHeight - 12;
    tip.style.left = `${Math.max(0, x)}px`; tip.style.top = `${Math.max(0, y)}px`;
  });
  canvas.addEventListener('mouseleave', () => tip?.classList.add('hidden'));

  // ---------- Minimap ----------
  const mini = $('mini');
  let miniBase = null, miniB = null;
  function buildMini() {
    if (!mini || miniBase) return;
    const pts = Object.keys(TILES).map((k) => { const [c, r] = parseKey(k); const p = hexToPixel(c, r, 1); return { x: p.y, y: -p.x, t: TILES[k].t }; });
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const W = mini.width, H = mini.height;
    const k = Math.min((W - 6) / (maxX - minX), (H - 6) / (maxY - minY));
    miniB = { minX, minY, k, ox: (W - (maxX - minX) * k) / 2, oy: (H - (maxY - minY) * k) / 2 };
    miniBase = document.createElement('canvas'); miniBase.width = W; miniBase.height = H;
    const m = miniBase.getContext('2d');
    m.fillStyle = '#45616f'; m.fillRect(0, 0, W, H);
    const d = Math.max(1.4, k * 1.8);
    for (const p of pts) { m.fillStyle = COLORS[p.t] || '#e0d0a0'; m.fillRect(miniB.ox + (p.x - minX) * k - d / 2, miniB.oy + (p.y - minY) * k - d / 2, d, d); }
  }
  const toMini = (c, r) => { const p = hexToPixel(c, r, 1); return { x: miniB.ox + (p.y - miniB.minX) * miniB.k, y: miniB.oy + (-p.x - miniB.minY) * miniB.k }; };
  function drawMini() {
    if (!mini || mini.classList.contains('hidden') || !g()) return;
    buildMini();
    const m = mini.getContext('2d');
    m.drawImage(miniBase, 0, 0);
    for (const u of g().units || []) { const p = toMini(...u.pos); m.fillStyle = u.side === side() ? '#1c3d8c' : '#b3261e'; m.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
    for (const x of g().supply || []) { const p = toMini(...x.pos); m.fillStyle = '#5a3d12'; m.fillRect(p.x - 1, p.y - 1, 2, 2); }
    const { w, h } = size();
    const x0 = miniB.ox + ((0 - view.ox) / view.size - miniB.minX) * miniB.k, y0 = miniB.oy + ((0 - view.oy) / view.size - miniB.minY) * miniB.k;
    m.strokeStyle = '#fff'; m.lineWidth = 1.5; m.strokeRect(x0, y0, (w / view.size) * miniB.k, (h / view.size) * miniB.k);
  }
  function miniJump(e) {
    const r = mini.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * mini.width, sy = ((e.clientY - r.top) / r.height) * mini.height;
    const px = (sx - miniB.ox) / miniB.k + miniB.minX, py = (sy - miniB.oy) / miniB.k + miniB.minY; // size-1 pixel coordinates
    const { w, h } = size();
    view.ox = w / 2 - px * view.size; view.oy = h / 2 - py * view.size;
    drawMap();
  }
  if (mini) {
    let down = false;
    mini.addEventListener('mousedown', (e) => { down = true; safe('mini', miniJump)(e); });
    addEventListener('mousemove', (e) => { if (down) safe('mini', miniJump)(e); });
    addEventListener('mouseup', () => { down = false; });
  }

  // ---------- Last-seen enemy ghosts (fog memory) ----------
  const ghosts = new Map();
  let ghostTurn = 0;
  function updateGhosts() {
    const gm = g(); if (!gm || !side()) return;
    if (gm.turn < ghostTurn) ghosts.clear();
    ghostTurn = gm.turn;
    const own = (gm.units || []).filter((u) => u.side === side());
    const seenNow = new Set();
    for (const u of gm.units || []) if (u.side !== side()) { seenNow.add(u.id); ghosts.set(u.id, { ...u, turn: gm.turn, stage: gm.opStage }); }
    for (const [id, gh] of ghosts) if (!seenNow.has(id) && own.some((u) => distance(u.pos, gh.pos) <= VISION_RANGE)) ghosts.delete(id); // we can see the hex and it is empty
  }
  function drawGhosts() {
    const s = view.size;
    if (s < 6) return;
    const here = new Set((g().units || []).map((u) => u.id));
    ctx.save();
    for (const gh of ghosts.values()) {
      if (here.has(gh.id)) continue;
      const { x, y } = centre(...gh.pos), w = s * 1.15, h = s;
      ctx.globalAlpha = 0.45; ctx.setLineDash([4, 3]);
      ctx.fillStyle = '#c9c1b0'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.strokeStyle = '#a3241a'; ctx.lineWidth = 1.5; ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.setLineDash([]); ctx.globalAlpha = 0.85; ctx.fillStyle = '#5a1710'; ctx.textAlign = 'center';
      ctx.font = `bold ${Math.max(7, s * 0.3)}px "Courier New", monospace`;
      ctx.fillText(`?${String(gh.str)}`, x, y + s * 0.1);
      if (s >= 12) { ctx.font = `${Math.max(6, s * 0.24)}px sans-serif`; ctx.fillText(`seen ${gh.turn}.${gh.stage || 0}`, x, y + h / 2 + s * 0.28); }
    }
    ctx.restore();
  }

  // ---------- Area of control shading ----------
  let shading = false;
  let ctl = { stamp: '', map: new Map() };
  function control() {
    const gm = g();
    const stamp = `${gm.turn}.${gm.opStage}.${gm.step}.${gm.half}.${(gm.units || []).map((u) => key(...u.pos)).join(',')}`;
    if (ctl.stamp === stamp) return ctl.map;
    const best = { me: new Map(), foe: new Map() };
    const R = 2;
    for (const u of (gm.units || [])) {
      if (u.type === 'hq' || !(u.str > 0)) continue;
      const tgt = u.side === side() ? best.me : best.foe;
      for (let dc = -R; dc <= R; dc++) for (let dr = -R - 1; dr <= R + 1; dr++) {
        const c = u.pos[0] + dc, r = u.pos[1] + dr, k = key(c, r);
        if (!TILES[k] || TILES[k].t === 'sea') continue;
        const d = distance(u.pos, [c, r]);
        if (d <= R && d < (tgt.get(k) ?? 99)) tgt.set(k, d);
      }
    }
    const map = new Map();
    for (const k of new Set([...best.me.keys(), ...best.foe.keys()])) {
      const a = best.me.get(k) ?? 99, b = best.foe.get(k) ?? 99;
      map.set(k, a < b ? 'me' : b < a ? 'foe' : 'contested');
    }
    ctl = { stamp, map };
    return map;
  }
  function drawShading() {
    if (!shading || !g() || !side()) return;
    const s = view.size, map = control();
    for (const [k, who] of map) {
      const [c, r] = parseKey(k), { x, y } = centre(c, r);
      hexPath(x, y, s);
      ctx.fillStyle = who === 'me' ? 'rgba(40,90,200,0.18)' : who === 'foe' ? 'rgba(200,50,40,0.18)' : 'rgba(150,120,20,0.18)';
      ctx.fill();
    }
    // Front line: edges between our area and theirs.
    ctx.save(); ctx.strokeStyle = 'rgba(80,0,0,0.75)'; ctx.lineWidth = Math.max(2, s * 0.14); ctx.setLineDash([s * 0.4, s * 0.25]);
    for (const [k, who] of map) {
      if (who !== 'me') continue;
      const [c, r] = parseKey(k);
      for (const n of neighbours(c, r)) {
        if (map.get(key(...n)) !== 'foe') continue;
        const [p1, p2] = api.sharedEdge([c, r], n);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------- Shared markers (pins and arrows) ----------
  let markMode = null, arrowFrom = null;
  const marks = () => S()?.marks || [];
  function renderMarkBar() {
    const bar = $('markBar'); if (!bar) return;
    bar.querySelectorAll('[data-mark]').forEach((b) => b.classList.toggle('on', b.dataset.mark === markMode));
    $('shadeBtn')?.classList.toggle('on', shading);
    canvas.style.cursor = markMode ? 'crosshair' : '';
  }
  $('markBar')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mark]'); if (!b) return;
    if (b.dataset.mark === 'clear') { if (marks().length) send({ type: 'mark', op: 'clear' }); return; }
    markMode = markMode === b.dataset.mark ? null : b.dataset.mark; arrowFrom = null; renderMarkBar();
  });
  $('shadeBtn')?.addEventListener('click', () => { shading = !shading; renderMarkBar(); drawMap(); });
  $('replayBtn')?.addEventListener('click', () => toggleReplay());
  // Map clicks go through here first; returning true means the click was used.
  api.handleMapClick = (hex) => {
    if (replay) return true;
    if (!markMode) return false;
    const text = ($('markText')?.value || '').slice(0, 40);
    if (markMode === 'pin') send({ type: 'mark', op: 'add', mark: { kind: 'pin', at: hex, text } });
    else if (markMode === 'arrow') {
      if (!arrowFrom) { arrowFrom = hex; toast('Now click where the arrow points.'); }
      else { send({ type: 'mark', op: 'add', mark: { kind: 'arrow', at: arrowFrom, to: hex, text } }); arrowFrom = null; }
    } else if (markMode === 'erase') {
      const near = marks().map((m) => ({ m, d: Math.min(distance(m.at, hex), m.to ? distance(m.to, hex) : 99) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d <= 1) send({ type: 'mark', op: 'del', id: near.m.id });
    }
    return true;
  };
  function drawMarks() {
    const s = view.size;
    for (const m of marks()) {
      const a = centre(...m.at);
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = '#7b2fbf'; ctx.lineWidth = Math.max(2, s * 0.12);
      if (m.kind === 'arrow' && m.to) {
        const b = centre(...m.to), ang = Math.atan2(b.y - a.y, b.x - a.x), hd = Math.max(8, s * 0.7);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - hd * Math.cos(ang - 0.45), b.y - hd * Math.sin(ang - 0.45)); ctx.lineTo(b.x - hd * Math.cos(ang + 0.45), b.y - hd * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
        if (m.text) { ctx.font = `bold ${Math.max(9, s * 0.38)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#4a1a78'; ctx.fillText(m.text, (a.x + b.x) / 2, (a.y + b.y) / 2 - 6); }
      } else {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y - s * 1.3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(a.x, a.y - s * 1.3); ctx.lineTo(a.x + s * 0.8, a.y - s * 1.0); ctx.lineTo(a.x, a.y - s * 0.7); ctx.closePath(); ctx.fill();
        if (m.text) { ctx.font = `bold ${Math.max(9, s * 0.38)}px sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = '#4a1a78'; ctx.fillText(m.text, a.x + s * 0.9, a.y - s * 1.05); }
      }
      ctx.restore();
    }
    if (arrowFrom) { const a = centre(...arrowFrom); ctx.save(); ctx.strokeStyle = '#7b2fbf'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(a.x, a.y, view.size * 0.7, 0, 7); ctx.stroke(); ctx.restore(); }
  }

  // ---------- Replay (of what this screen has seen) ----------
  const history = [];
  let replay = null;
  function record() {
    const gm = g(); if (!gm || !side()) return;
    const k = `${gm.turn}:${gm.opStage}:${gm.step}:${gm.half}`;
    if (history.length && history[history.length - 1].k === k) {
      history[history.length - 1].units = snapUnits(); // keep the latest picture of this step
      return;
    }
    history.push({ k, turn: gm.turn, stage: gm.opStage, step: gm.step, half: gm.half, units: snapUnits() });
    if (history.length > 500) history.shift();
  }
  const snapUnits = () => (g().units || []).map((u) => ({ side: u.side, name: u.name, pos: [...u.pos], str: u.str }));
  let timer = null;
  function toggleReplay() {
    const bar = $('replayBar'); if (!bar) return;
    if (replay) { replay = null; clearInterval(timer); bar.classList.add('hidden'); drawMap(); return; }
    if (history.length < 2) return toast('Nothing to replay yet: this screen has seen only one step so far.');
    replay = { i: history.length - 1 };
    bar.classList.remove('hidden');
    bar.innerHTML = `<button id="rpPlay">▶</button><input id="rpSlide" type="range" min="0" max="${history.length - 1}" value="${replay.i}"><span id="rpLabel"></span><button id="rpClose">Close</button>`;
    const upd = () => { const h = history[replay.i]; $('rpLabel').textContent = `GT${h.turn}${h.stage ? '.' + h.stage : ''} · ${h.step}${h.half ? ' ' + h.half : ''}`; $('rpSlide').value = replay.i; drawMap(); };
    $('rpSlide').oninput = (e) => { replay.i = +e.target.value; upd(); };
    $('rpClose').onclick = () => toggleReplay();
    $('rpPlay').onclick = () => {
      if (timer) { clearInterval(timer); timer = null; $('rpPlay').textContent = '▶'; return; }
      $('rpPlay').textContent = '❚❚';
      if (replay.i >= history.length - 1) replay.i = 0;
      timer = setInterval(() => { if (!replay) return clearInterval(timer); replay.i++; if (replay.i >= history.length - 1) { clearInterval(timer); timer = null; $('rpPlay').textContent = '▶'; } upd(); }, 450);
    };
    upd();
  }
  function drawReplay() {
    if (!replay) return;
    const h = history[replay.i]; if (!h) return;
    const { w, hh = size().h } = { w: size().w };
    ctx.save(); ctx.fillStyle = 'rgba(245,238,220,0.7)'; ctx.fillRect(0, 0, w, size().h);
    const s = view.size;
    for (const u of h.units) {
      const { x, y } = centre(...u.pos), bw = s * 1.15, bh = s;
      ctx.fillStyle = u.side === side() ? '#9fb8e8' : '#e8a29c'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.2;
      ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh); ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);
      ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.font = `bold ${Math.max(7, s * 0.34)}px "Courier New", monospace`; ctx.fillText(String(u.str), x, y + s * 0.12);
    }
    ctx.restore(); void hh;
  }

  // ---------- Overview tab ----------
  function renderOverview() {
    const el = $('tab-overview'); if (!el) return;
    const gm = g(), me = side();
    if (!gm || !me) { el.innerHTML = ''; return; }
    const mine = (gm.units || []).filter((u) => u.side === me && u.type !== 'hq');
    const foes = (gm.units || []).filter((u) => u.side !== me && u.type !== 'hq');
    const toe = mine.reduce((n, u) => n + u.str, 0);
    const ports = LOCATIONS.filter((l) => l.port).map((l) => {
      const owner = gm.portOwners?.[l.id]; const dmg = (gm.damage?.ports || []).find((p) => p.id === l.id);
      return `<tr class="${owner === me ? '' : 'warn'}"><td>${goLink(l.name, l.hexes[0])}</td><td>${esc(api.sideName(owner))}</td><td>${dmg ? `${dmg.eff}/${dmg.max}` : 'full'}</td></tr>`;
    }).join('');
    const v = gm.victory;
    const pr = gm.portRewards;
    const fl = gm.fleet?.ships;
    el.innerHTML = `<h3>Overview</h3>
      <p>Game-Turn <b>${gm.turn}</b> of ${gm.lastTurn} · ${esc(gm.date)} · Initiative: <b>${esc(api.sideName(gm.initiative?.holder))}</b></p>
      <table class="grid"><tr><th></th><th>You</th><th>Enemy seen</th></tr>
        <tr><td>Formations</td><td>${mine.length}</td><td>${foes.length}</td></tr>
        <tr><td>TOE points</td><td>${toe}</td><td>${foes.reduce((n, u) => n + u.str, 0)}</td></tr>
        <tr><td>Prisoners held</td><td>${gm.prisoners?.[me] ?? 0}</td><td>${gm.prisoners?.[me === 'axis' ? 'cw' : 'axis'] ?? '–'}</td></tr>
        ${pr ? `<tr><td>Port points</td><td>${pr.points}/${pr.next}</td><td>${pr.foe}</td></tr>` : ''}
        ${gm.air?.totals ? `<tr><td>Aircraft ready</td><td>${gm.air.totals.ready}/${gm.air.totals.planes}</td><td>–</td></tr>` : ''}
        ${fl ? `<tr><td>Ships fit for sea</td><td>${fl.filter((s) => !s.sunk && s.ready).length}/${fl.filter((s) => !s.sunk).length}</td><td>–</td></tr>` : ''}
      </table>
      ${v ? `<h3>Victory</h3><p>${v[me] && typeof v[me] === 'object' ? esc(`${v[me].tier}: ${v[me].what}`) : v.tier ? esc(`${v.tier}: ${v.what || ''}`) : typeof v[me] === 'number' ? `You ${v[me]} points` : 'No victory condition met yet.'}</p>` : ''}
      <h3>Ports</h3><table class="grid"><tr><th>Port</th><th>Held by</th><th>Efficiency</th></tr>${ports}</table>
      <p class="help">Click a port name to see it on the map. Keys: <b>?</b> shows every shortcut.</p>`;
  }

  // ---------- Hooks the main client calls ----------
  api.drawUnder = safe('drawUnder', () => { drawShading(); });
  api.drawOver = safe('drawOver', () => {
    if (!g()) return;
    drawGhosts(); drawMarks();
    if (flash) {
      const t = (performance.now() - flash.start) / 1800, p = centre(...flash.pos);
      ctx.save(); ctx.strokeStyle = `rgba(255,60,0,${1 - t})`; ctx.lineWidth = 4;
      for (const k of [0, 0.35]) { ctx.beginPath(); ctx.arc(p.x, p.y, view.size * (0.8 + ((t + k) % 1) * 2.2), 0, 7); ctx.stroke(); }
      ctx.restore();
    }
    drawReplay();
    drawMini();
  });
  api.onRender = safe('onRender', () => {
    updateGhosts(); record(); refreshFind(); renderNotes(); renderOverview(); turnSummary(); renderMarkBar();
  });
}
