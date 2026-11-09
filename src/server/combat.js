// Land combat [11.0-15.0, 17.0]: Barrage, Anti-Armour fire, Close Assault, with Morale.
// One call resolves the full combat procedure against one enemy-occupied hex.
//
// Choices the board game gives the DEFENDER mid-combat (gun positions, anti-armour assignment, Retreat Before
// Assault, withholding) are made automatically for now; the attacker chooses artillery position, tank role and probe.

import { key, neighbours, distance } from '../shared/hex.js';
import { WEAPONS } from '../shared/weapons.js';
import { TERRAIN, HEXSIDES, STACKING_POINTS, edgeKey, stepCost, stackingLimit } from '../shared/rules.js';
import {
  BARRAGE, barrageColumn, antiArmourRow, antiArmourDamage, ANTI_ARMOUR_ROWS,
  CA_COLUMNS, CA_OVERRUN_FROM, CA_COLUMN_LABELS, caColumnForDifferential, CA_ATTACKER_LOSS, CA_DEFENDER_LOSS,
  CA_ATTACKER_CAPTURED, CA_ATTACKER_ENGAGED, CA_DEFENDER_CAPTURED, CA_DEFENDER_RETREAT, PRISONERS_PCT,
  orgSizeShift, moraleModifier,
} from '../shared/tables.js';

const W = (e) => WEAPONS[e.w];
export const actual = (raw) => (raw <= 4 ? 0 : Math.floor(raw / 10 + 0.5)); // [11.32-11.33]
const shift = (s) => (!s ? 0 : s[0] === 'L' ? -Number(s.slice(1)) : s[0] === 'R' ? Number(s.slice(1)) : 0);
const rawOf = (els, rating, pinned) => els.reduce((s, x) => s + (W(x.e)[rating] || 0) * Math.max(0, x.e.toe - (pinned?.get(x) || 0)), 0);
export const syncStr = (u) => { u.elements = u.elements.filter((e) => e.toe > 0); u.str = u.elements.reduce((s, e) => s + e.toe, 0); };

// Crossing type from attacker hex into defender hex, as seen by the attacker.
function crossing(map, from, to) {
  const e = map.hexsides[edgeKey(from, to)];
  if (!e) return null;
  if (e.type === 'escarpment') return e.down === key(...to) ? 'downEscarpment' : 'upEscarpment';
  if (e.type === 'slope') return e.down === key(...to) ? 'downSlope' : 'upSlope';
  return e.type;
}

export function rawDefensiveCA(units) {
  return units.reduce((s, u) => s + u.elements.reduce((t, e) => t + (WEAPONS[e.w].def || 0) * e.toe, 0), 0);
}

function sideMorale(units) {
  // Largest-unit rule [6.27]: average the basic morale and cohesion of the biggest units present.
  const biggest = Math.max(...units.map((u) => STACKING_POINTS[u.size] ?? 0));
  const top = units.filter((u) => (STACKING_POINTS[u.size] ?? 0) === biggest);
  const avg = (f) => Math.round(top.reduce((s, u) => s + f(u), 0) / top.length);
  return { basic: avg((u) => u.morale ?? 0), cohesion: avg((u) => u.cohesion) };
}

// ---- Odds preview: the close-assault differential and column the attack would start from, before dice ----
// Mirrors the arithmetic of resolveCombat without side effects. Barrage, anti-armour fire and morale rolls can still move the
// column, so the figures are a starting point. The defender is assumed to take the automatic dispositions.
export function previewAssault(g, ctx, attackers, targetPos, opts = {}) {
  const { map } = ctx;
  const side = attackers[0].side;
  const defenders = g.units.filter((u) => u.side !== side && u.str > 0 && u.pos[0] === targetPos[0] && u.pos[1] === targetPos[1]);
  if (!defenders.length) return null;
  const terr = TERRAIN[map.tiles[key(...targetPos)].t];
  const fort = ctx.fortLevel ? ctx.fortLevel(targetPos) : terr.fortified ? 2 : 0;
  const tShift = Math.min(shift(terr.combat?.closeAssault), fort ? -fort : 0);
  const tag = (units) => units.flatMap((u) => u.elements.map((e) => ({ u, e })));
  const att = tag(attackers), def = tag(defenders);
  const tankRole = opts.tankRole || 'assault', artyForward = opts.artilleryForward !== false;
  const attCA = att.filter((x) => W(x.e).kind === 'inf' || (W(x.e).kind === 'tank' && tankRole === 'assault') || (W(x.e).kind === 'gun' && artyForward));
  const attAT = att.filter((x) => W(x.e).kind === 'at' || (W(x.e).kind === 'tank' && tankRole === 'antiArmour'));
  const defCA = def.filter((x) => W(x.e).kind === 'inf');
  const noPin = new Map();
  const attRaw = rawOf(attCA, 'off', noPin), defRaw = rawOf(defCA, 'def', noPin);
  if (defRaw <= 0) return { empty: true, attRaw, defRaw: 0, fort, terrain: terr.label, note: 'Nothing there could defend in the close assault: the hex would be abandoned.' };
  let attAct = attRaw < 5 ? 0 : actual(attRaw), defAct = defRaw < 5 ? 0 : actual(defRaw);
  if (attRaw < 10 && defRaw < 10) { attAct = attRaw < 5 ? 0 : attRaw; defAct = defRaw < 5 ? 0 : defRaw; }
  const hasArmour = def.some((x) => W(x.e).ap > 0);
  if (!hasArmour && attAT.length) attAct += Math.floor(actual(rawOf(attAT, 'arm')) / 4);
  const comb = (xs) => {
    const tanks = xs.filter((x) => W(x.e).kind === 'tank').reduce((n, x) => n + x.e.toe, 0);
    const inf = xs.filter((x) => W(x.e).kind === 'inf').reduce((n, x) => n + x.e.toe, 0);
    return Math.min(4, Math.ceil(Math.max(0, tanks - inf) / 3));
  };
  attAct = Math.max(0, attAct - comb(attCA)); defAct = Math.max(0, defAct - comb(defCA));
  const basic = attAct - defAct;
  let shifts = 0; const notes = [];
  if (tShift) { shifts += tShift; notes.push(`${fort ? 'fortification' : 'terrain'} ${tShift}`); }
  const crossings = attackers.map((u) => crossing(map, u.pos, targetPos)).filter(Boolean);
  if (crossings.length) {
    const hs = crossings.map((c) => shift(HEXSIDES[c]?.combat?.closeAssault));
    const hsShift = Math.min(...hs.filter((v) => v < 0), 0) + Math.max(...hs.filter((v) => v > 0), 0);
    if (hsShift) { shifts += hsShift; notes.push(`hexside ${hsShift > 0 ? '+' : ''}${hsShift}`); }
  }
  if (attRaw >= 2 * defRaw) { shifts += 2; notes.push('2:1 raw +2'); } else if (defRaw >= 2 * attRaw) { shifts -= 2; notes.push('2:1 raw −2'); }
  const spA = Math.max(...attackers.map((u) => STACKING_POINTS[u.size] ?? 0)), spD = Math.max(...defenders.map((u) => STACKING_POINTS[u.size] ?? 0));
  const org = spA > spD ? orgSizeShift(spA, spD) : -orgSizeShift(spD, spA);
  if (org) { shifts += org; notes.push(`size ${org > 0 ? '+' : ''}${org}`); }
  const top = CA_COLUMNS.length - 1;
  const base = Math.max(0, Math.min(top, caColumnForDifferential(basic) + shifts));
  const loss = (tbl, col) => { let n = 0, c = 0; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) { c++; n += tbl[col][a * 10 + b] || 0; } return Math.round(n / c); };
  const colInfo = (col) => ({ label: CA_COLUMN_LABELS[col], overrun: col >= CA_OVERRUN_FROM, attLoss: loss(CA_ATTACKER_LOSS, col), defLoss: loss(CA_DEFENDER_LOSS, col) });
  const around = [-1, 0, 1].map((d) => Math.max(0, Math.min(top, base + d)));
  return {
    attRaw, defRaw, attAct, defAct, basic, notes, fort, terrain: terr.label,
    column: colInfo(base), low: colInfo(around[0]), high: colInfo(around[2]),
    attackerTOE: attackers.reduce((n, u) => n + u.str, 0), defenderTOE: defenders.reduce((n, u) => n + u.str, 0),
  };
}

// Remove TOE points so that at least `points` of `rating` are absorbed [14.43, 15.83d].
function absorb(pool, rating, points, removed) {
  let left = points;
  while (left > 0) {
    const cands = pool.filter((x) => x.e.toe > 0 && (W(x.e)[rating] || 0) > 0);
    if (!cands.length) break;
    // Prefer a point that just covers what's left; otherwise the biggest contributor.
    cands.sort((a, b) => (W(b.e)[rating] * b.e.toe) - (W(a.e)[rating] * a.e.toe));
    const exact = cands.filter((x) => W(x.e)[rating] >= left).sort((a, b) => W(a.e)[rating] - W(b.e)[rating])[0];
    const pick = exact || cands[0];
    pick.e.toe -= 1;
    left -= W(pick.e)[rating];
    const k = `${pick.u.id}|${pick.e.w}`;
    removed[k] = (removed[k] || 0) + 1;
  }
}

/**
 * Resolve a full combat against the enemy hex `targetPos`.
 * opts: { probe, artilleryForward, tankRole: 'assault'|'antiArmour' }
 * Returns { lines, defendersCleared, attackers, defenders }.
 */
export function resolveCombat(g, ctx, attackers, targetPos, opts = {}) {
  const { map, d66, d6, spendCP, log, retreatUnits } = ctx;
  const side = attackers[0].side;
  const defenders = g.units.filter((u) => u.side !== side && u.pos[0] === targetPos[0] && u.pos[1] === targetPos[1]);
  const lines = [];
  const say = (t) => lines.push(t);
  const probe = !!opts.probe;
  const artyForward = opts.artilleryForward !== false;
  const tankRole = opts.tankRole || 'assault';
  const dOpt = opts.defence || { artilleryForward: false, tankRole: 'antiArmour', retreat: new Set() };
  const terr = TERRAIN[map.tiles[key(...targetPos)].t];
  // A fortified hex gives one column shift per Level, and the defender takes only the better of fortification and terrain [14.33, 25.2].
  const fort = ctx.fortLevel ? ctx.fortLevel(targetPos) : terr.fortified ? 2 : 0;
  const tShiftOf = (kind) => Math.min(shift(terr.combat?.[kind]), fort ? -fort : 0);
  const crossings = attackers.map((u) => crossing(map, u.pos, targetPos)).filter(Boolean);

  // ---- Capability points [11.2] (defender cost may be reduced after the result, 11.27) ----
  for (const u of attackers) spendCP(u, probe ? 2 : 5);
  const defCPBefore = defenders.map((d) => d.cpUsed);

  // ---- Automatic surrender cases [15.15, 15.88] ----
  if (defenders.every((d) => d.ammo <= 0 || d.cohesion <= -17)) {
    say(`${defenders.map((d) => d.name).join(', ')} surrender${defenders.length > 1 ? '' : 's'} without a fight (out of ammunition or cohesion −17 or worse).`);
    for (const d of defenders) { g.prisoners[side] = (g.prisoners[side] || 0) + d.str; d.elements = []; syncStr(d); }
    return { lines, defendersCleared: true, attackers, defenders };
  }
  for (const d of defenders) spendCP(d, probe ? 2 : 3);

  // Flatten into element handles.
  const flat = (units) => units.flatMap((u) => u.elements.map((e) => ({ u, e, get toe() { return e.toe; } })));
  const att = flat(attackers);
  const def = flat(defenders);
  const pinned = new Map(); // element handle -> TOE points pinned (one battalion-sized target each time)
  for (const x of [...att, ...def]) if (x.e.airPin > 0) pinned.set(x, Math.min(x.e.toe, x.e.airPin)); // pinned from the air earlier this stage [41.9]
  const pin = (x) => pinned.set(x, Math.min(x.e.toe, (pinned.get(x) || 0) + (W(x.e).bn || x.e.toe)));

  // Roles.
  const attArty = att.filter((x) => W(x.e).kind === 'gun');
  const attAT = att.filter((x) => W(x.e).kind === 'at' || (W(x.e).kind === 'tank' && tankRole === 'antiArmour'));
  const attCA = att.filter((x) => W(x.e).kind === 'inf' || (W(x.e).kind === 'tank' && tankRole === 'assault') || (W(x.e).kind === 'gun' && artyForward));
  // Defender's dispositions [12.1, 14.26]: guns Forward or Back; tanks fire anti-armour or join the close assault.
  // Anti-tank guns always fire anti-armour; a TOE point is never used for both.
  let defArty = def.filter((x) => W(x.e).kind === 'gun');
  let defAT = def.filter((x) => W(x.e).kind === 'at' || (W(x.e).kind === 'tank' && dOpt.tankRole !== 'assault'));
  let defCA = def.filter((x) => W(x.e).kind === 'inf' || (W(x.e).kind === 'tank' && dOpt.tankRole === 'assault') || (W(x.e).kind === 'gun' && dOpt.artilleryForward));
  say(`Defender: artillery ${dOpt.artilleryForward ? 'Forward' : 'Back'}, tanks ${dOpt.tankRole === 'assault' ? 'in the close assault' : 'firing anti-armour'}${dOpt.retreat.size ? `, ${dOpt.retreat.size} unit(s) to retreat before assault if able` : ''}.`);

  // ---- Barrage step [12.0] ----
  const barrage = (firers, targets, targetTerrainShift, who) => {
    if (!firers.length || !targets.length) return;
    // Forward guns combine; Back guns fire unit by unit [12.13-12.16]. Italians combine only within a hex [12.14].
    const groups = [];
    if ((who === 'att' && artyForward) || who === 'defFwd') {
      const byHex = new Map();
      for (const f of firers) {
        const k = f.u.nation === 'it' ? key(...f.u.pos) : 'all';
        if (!byHex.has(k)) byHex.set(k, []);
        byHex.get(k).push(f);
      }
      groups.push(...byHex.values());
    } else {
      const byUnit = new Map();
      for (const f of firers) { if (!byUnit.has(f.u.id)) byUnit.set(f.u.id, []); byUnit.get(f.u.id).push(f); }
      groups.push(...byUnit.values());
    }
    for (const grp of groups) {
      const raw = rawOf(grp, 'bar');
      const pts = actual(raw);
      if (pts <= 0) continue;
      if (fireBarrage(grp[0].u.name, `${raw} raw → ${pts}`, pts, targets, targetTerrainShift) === 'stop') return;
    }
  };
  // One barrage fire at the best target among `targets`; ships use the same resolution as guns [30.22].
  const fireBarrage = (who, how, pts, targets, targetTerrainShift) => {
      // Target: one battalion-sized target, picked from the most numerous enemy element (the firer
      // knows only how many targets of each class are there) [12.23-12.24].
      const live = targets.filter((t) => t.e.toe - (pinned.get(t) || 0) > 0 && W(t.e).kind !== 'aa');
      if (!live.length) return 'stop';
      live.sort((a, b) => (b.e.toe - (pinned.get(b) || 0)) - (a.e.toe - (pinned.get(a) || 0)));
      const tgt = live[0];
      const cls = W(tgt.e).class === 'armour' ? 'armour' : W(tgt.e).class === 'gun' ? 'gun' : 'infantry';
      let col = barrageColumn(pts) + targetTerrainShift;
      const roll = d66();
      if (col < 0) { say(`Barrage (${pts} pts) on ${tgt.u.name} ${tgt.e.w}: shifted off the table by terrain, no effect.`); return 'skip'; }
      col = Math.min(col, 8);
      const res = BARRAGE[cls][col][roll];
      if (res === 'P') pin(tgt);
      else if (res === '1' || res === '2') {
        tgt.e.toe = Math.max(0, tgt.e.toe - Number(res));
        if (cls !== 'gun') pin(tgt);
      }
      const bn = Math.min(W(tgt.e).bn || tgt.e.toe, tgt.e.toe);
      say(`Barrage by ${who} (${how}) on a ${cls} target in ${tgt.u.name} (${bn} TOE of ${tgt.e.w}): roll ${roll} → ${res === 'none' ? 'no effect' : res === 'P' ? 'pinned' : `${res} TOE lost${cls !== 'gun' ? ' and pinned' : ''}`}.`);
  };
  // Ships of the Commonwealth Fleet fire as artillery that needs no ammunition [30.22]: first at the defenders for an attacking fleet, and at the attackers for a defending one.
  const shipsFire = (shipSide, targets, hexes, shift) => {
    for (const sh of ctx.navalFire?.(shipSide, hexes) || []) {
      if (fireBarrage(sh.name, `${sh.gun} gun${sh.half ? ', halved at range' : ''} → ${sh.pts}`, sh.pts, targets.filter((t) => sh.hexes.some((h) => h[0] === t.u.pos[0] && h[1] === t.u.pos[1])), shift) === 'stop') continue;
      ctx.navalSpent?.(sh);
    }
  };
  shipsFire(attackers[0].side, def, [targetPos], tShiftOf('barrage'));
  shipsFire(defenders[0].side, att, attackers.map((u) => u.pos), 0);
  barrage(attArty, def, tShiftOf('barrage'), 'att');
  // Defenders' guns fire back at the attacking hexes (no terrain benefit modelled for the attacker yet).
  barrage(defArty, att, 0, dOpt.artilleryForward ? 'defFwd' : 'def');

  // ---- Retreat Before Assault [13.0]: chosen units that were not pinned fall back before the assault ----
  let vacatedBeforeAssault = false;
  if (dOpt.retreat.size) {
    const pinnedUnit = (u) => def.some((x) => x.u === u && pinned.has(x));
    const goers = defenders.filter((u) => dOpt.retreat.has(u.id) && u.str > 0);
    for (const u of goers) {
      if (pinnedUnit(u)) { say(`${u.name} is pinned by the barrage and cannot retreat before the assault.`); continue; }
      if (u.cohesion <= -26) { say(`${u.name} is too disorganised to retreat.`); continue; }
      const before = key(...u.pos);
      retreatUnits([u], attackers, 2);
      if (key(...u.pos) === before) { say(`${u.name} has nowhere to retreat to and must stand.`); continue; }
      say(`${u.name} retreats before the assault to ${key(...u.pos)}.`);
      // Elements that left take no further part [13.28].
      for (const list of [def, defArty, defAT, defCA]) for (let i = list.length - 1; i >= 0; i--) if (list[i].u === u) list.splice(i, 1);
    }
    const stillThere = defenders.filter((u) => u.str > 0 && u.pos[0] === targetPos[0] && u.pos[1] === targetPos[1]);
    if (!stillThere.length) {
      say('The defenders have withdrawn; there is no assault.');
      vacatedBeforeAssault = true;
      for (const u of attackers) u.ammo = Math.max(0, u.ammo - 1);
      for (const l of lines) log(l);
      return { lines, defendersCleared: true, vacatedBeforeAssault, attackers, defenders };
    }
  }

  // ---- Anti-armour step [14.0] (simultaneous) ----
  const armourOf = (xs) => xs.filter((x) => W(x.e).ap > 0 && x.e.toe > 0);
  const attArmourCommitted = armourOf([...attCA, ...attAT]);
  const defArmour = armourOf(def);
  let hexsideAA = 0;
  for (const c of crossings) hexsideAA = Math.min(hexsideAA, shift(HEXSIDES[c]?.combat?.antiArmour));
  const downEscarpment = crossings.length && crossings.every((c) => c === 'downEscarpment');
  const aaFire = (firers, phasing, colShift) => {
    const raw = rawOf(firers, 'arm', pinned);
    if (raw <= 0) return { raw: 0, dmg: 0 };
    const act = raw <= 4 ? 0 : Math.min(16, actual(raw));
    const col = act + colShift;
    const roll = d66();
    let row = antiArmourRow(roll);
    if (phasing && row > 0) row -= 1; // phasing player's fire is one row worse
    const dmg = col < 0 ? 0 : antiArmourDamage(row, col);
    return { raw, act, col, roll, dmg };
  };
  let reassignedToCA = 0;
  if (defArmour.length) {
    const r = aaFire(attAT, true, tShiftOf('antiArmour') + hexsideAA);
    if (r.raw) {
      const removed = {};
      absorb(defArmour.map((x) => x), 'ap', r.dmg, removed);
      say(`Anti-armour fire into the hex: ${r.raw} raw → column ${r.col}, roll ${r.roll} → ${r.dmg} damage points${fmtRemoved(removed)}.`);
    }
  } else if (attAT.length) {
    // No armour there: up to a quarter of the anti-armour points switch to close assault [14.23].
    reassignedToCA = Math.floor(actual(rawOf(attAT, 'arm')) / 4);
  }
  if (attArmourCommitted.length && !downEscarpment) {
    const r = aaFire(defAT, false, 0);
    if (r.raw) {
      const removed = {};
      absorb(attArmourCommitted, 'ap', r.dmg, removed);
      say(`Defensive anti-armour fire: ${r.raw} raw → column ${r.col}, roll ${r.roll} → ${r.dmg} damage points${fmtRemoved(removed)}.`);
    }
  }

  // ---- Close assault [15.0] ----
  const attLive = attCA.filter((x) => x.e.toe - (pinned.get(x) || 0) > 0);
  const defLive = defCA.filter((x) => x.e.toe - (pinned.get(x) || 0) > 0);
  let attRaw = rawOf(attLive, 'off', pinned);
  let defRaw = rawOf(defLive, 'def', pinned);
  const defRawForLosses = rawOf(def.filter((x) => x.e.toe > 0 && (W(x.e).kind !== 'gun' || dOpt.artilleryForward)), 'def'); // includes pinned [15.83b]

  if (defRaw <= 0) {
    // Nothing able to defend: the hex is abandoned [15.29].
    say('No defending units could take part in the close assault: the defenders fall back three hexes and are disorganised.');
    for (const d of defenders) d.cohesion -= 3;
    retreatUnits(defenders.filter((d) => d.str > 0), attackers, 3);
    finish();
    return { lines, defendersCleared: !g.units.some((u) => u.side !== side && u.pos[0] === targetPos[0] && u.pos[1] === targetPos[1] && u.str > 0), attackers, defenders };
  }

  let attAct = attRaw < 5 ? 0 : actual(attRaw);
  let defAct = defRaw < 5 ? 0 : actual(defRaw);
  if (attRaw < 10 && defRaw < 10) { attAct = attRaw < 5 ? 0 : attRaw; defAct = defRaw < 5 ? 0 : defRaw; } // [15.28]
  attAct += reassignedToCA;
  // Combined arms [15.4]: tanks need equal infantry from the same side.
  const combined = (xs) => {
    const tanks = xs.filter((x) => W(x.e).kind === 'tank').reduce((s, x) => s + x.e.toe, 0);
    const inf = xs.filter((x) => W(x.e).kind === 'inf').reduce((s, x) => s + x.e.toe, 0);
    return Math.min(4, Math.ceil(Math.max(0, tanks - inf) / 3));
  };
  attAct = Math.max(0, attAct - combined(attLive));
  defAct = Math.max(0, defAct - combined(defLive));
  const basic = attAct - defAct;

  // Column shifts.
  let shifts = 0;
  const notes = [];
  const tShift = tShiftOf('closeAssault');
  if (tShift) { shifts += tShift; notes.push(`terrain ${tShift > 0 ? '+' : ''}${tShift}`); }
  // Hexsides: the defender benefits from one type only; down-slope bonuses offset [15.33-15.36].
  if (crossings.length) {
    const hs = crossings.map((c) => shift(HEXSIDES[c]?.combat?.closeAssault));
    const hsShift = Math.min(...hs.filter((v) => v < 0), 0) + Math.max(...hs.filter((v) => v > 0), 0);
    if (hsShift) { shifts += hsShift; notes.push(`hexside ${hsShift > 0 ? '+' : ''}${hsShift}`); }
  }
  if (attRaw >= 2 * defRaw) { shifts += 2; notes.push('2:1 raw +2'); } // [15.51]
  else if (defRaw >= 2 * attRaw) { shifts -= 2; notes.push('2:1 raw −2'); }
  const spA = Math.max(...attackers.map((u) => STACKING_POINTS[u.size] ?? 0));
  const spD = Math.max(...defenders.map((u) => STACKING_POINTS[u.size] ?? 0));
  const org = spA > spD ? orgSizeShift(spA, spD) : -orgSizeShift(spD, spA);
  if (org) { shifts += org; notes.push(`size ${org > 0 ? '+' : ''}${org}`); }

  // Morale [15.6, 17.2].
  const rommelWith = (units) => units.some((u) => u.side === 'axis') && g.units.some((r) => r.rommel && units.some((u) => key(...u.pos) === key(...r.pos)));
  const morale = (units, ownRaw, enemyRaw, label) => {
    const m = sideMorale(units);
    const roll = d66();
    let mod = moraleModifier(m.cohesion, roll);
    let surrender = false;
    if (mod === 'SURR') {
      if (m.basic >= 1 && m.cohesion > -11 && enemyRaw < 3 * ownRaw) mod = -4; // good troops hold [17.26]
      else surrender = true;
    }
    let adj = surrender ? -3 : Math.max(-3, Math.min(3, m.basic + mod));
    if (rommelWith(units)) adj += 1; // [17.28]
    say(`${label} morale: basic ${fmt(m.basic)}, cohesion ${m.cohesion}, roll ${roll} → ${surrender ? 'SURRENDER' : `modifier ${fmt(mod)}, adjusted ${fmt(adj)}`}.`);
    return { adj, surrender };
  };
  const mA = morale(attackers, attRaw, defRaw, 'Attacker');
  const mD = morale(defenders, defRaw, attRaw, 'Defender');
  if (mA.surrender && mD.surrender) {
    say('Both sides break: no assault takes place and both are Engaged.');
    for (const u of [...attackers, ...defenders]) u.engaged = true;
    finish();
    return { lines, defendersCleared: false, attackers, defenders };
  }
  if (mD.surrender || mA.surrender) {
    const quitters = mD.surrender ? defenders : attackers;
    const winner = mD.surrender ? side : defenders[0].side;
    for (const u of quitters) { g.prisoners[winner] = (g.prisoners[winner] || 0) + u.str; u.elements = []; syncStr(u); }
    say(`${quitters.map((u) => u.name).join(', ')} surrender${quitters.length > 1 ? '' : 's'}.`);
    finish();
    return { lines, defendersCleared: mD.surrender, attackers, defenders };
  }
  const moraleShift = mA.adj - mD.adj;
  if (moraleShift) { shifts += moraleShift; notes.push(`morale ${moraleShift > 0 ? '+' : ''}${moraleShift}`); }

  const baseCol = caColumnForDifferential(basic);
  const col = Math.max(0, Math.min(CA_COLUMNS.length - 1, baseCol + shifts));
  const overrun = col >= CA_OVERRUN_FROM;
  say(`Close ${probe ? 'assault (probe)' : 'assault'}: attacker ${attRaw} raw → ${attAct}, defender ${defRaw} raw → ${defAct}; differential ${basic > 0 ? '+' : ''}${basic}${notes.length ? `, shifts: ${notes.join(', ')}` : ''} → column ${CA_COLUMN_LABELS[col]}${overrun ? ' (OVERRUN)' : ''}.`);

  // Dice: each side rolls once; sequential for losses, summed for the other results [15.73].
  const aRoll = [d6(), d6()], dRoll = [d6(), d6()];
  const seq = ([a, b]) => a * 10 + b;
  const aSeq = seq(aRoll), dSeq = seq(dRoll), aSum = aRoll[0] + aRoll[1], dSum = dRoll[0] + dRoll[1];
  const aPct = CA_ATTACKER_LOSS[col][aSeq];
  let dPct = CA_DEFENDER_LOSS[col][dSeq];
  let retreatHexes = [3, 2, 1].find((n) => CA_DEFENDER_RETREAT[n][col].includes(dSum)) || 0;
  const aEngaged = CA_ATTACKER_ENGAGED[col].includes(aSum) && !probe;
  const aCapt = CA_ATTACKER_CAPTURED[col].includes(aSum);
  const dCapt = CA_DEFENDER_CAPTURED[col].includes(dSum);

  // Retreats the defender can't make cost 10% per hex; major cities may ignore retreats [15.82].
  if (retreatHexes && fort >= 1) { say('Defenders in a major city ignore the retreat result.'); retreatHexes = 0; }
  let shortfall = 0;
  if (retreatHexes) {
    shortfall = retreatUnits(defenders.filter((d) => d.str > 0), attackers, retreatHexes, { dryRun: true });
    dPct += 10 * shortfall;
  }

  // Losses [15.83].
  const attLossRaw = Math.ceil((aPct / 100) * attRaw);
  const defLossRaw = overrun ? Math.ceil((dPct / 100) * (defRawForLosses + (dOpt.artilleryForward ? 0 : rawOf(defArty, 'def')))) : Math.floor((dPct / 100) * defRawForLosses);
  const attRemoved = {}, defRemoved = {};
  const attTOEBefore = attackers.reduce((s, u) => s + u.str, 0);
  const defTOEBefore = defenders.reduce((s, u) => s + u.str, 0);
  absorb(attLive, 'off', attLossRaw, attRemoved);
  absorb(def.filter((x) => W(x.e).kind !== 'gun' || overrun), 'def', defLossRaw, defRemoved);
  // Forward guns lose vulnerability points equal to half the raw points lost [15.84]; artillery that joined
  // an offensive assault has its vulnerability halved (rounded up) [12.18].
  const gunLoss = (guns, lostRaw, removed, halve) => {
    if (lostRaw <= 0 || !guns.length) return;
    const need = Math.max(1, Math.ceil(lostRaw / 2));
    const pool = guns.map((x) => ({ ...x, eff: halve ? Math.ceil(W(x.e).vul / 2) : W(x.e).vul }));
    let left = need;
    while (left > 0) {
      const c = pool.filter((x) => x.e.toe > 0 && x.eff > 0).sort((a, b) => b.eff - a.eff)[0];
      if (!c) break;
      c.e.toe -= 1; left -= c.eff;
      removed[`${c.u.id}|${c.e.w}`] = (removed[`${c.u.id}|${c.e.w}`] || 0) + 1;
    }
  };
  gunLoss(def.filter((x) => W(x.e).kind === 'at' || (W(x.e).kind === 'gun' && (overrun || dOpt.artilleryForward))), defLossRaw, defRemoved, false);
  if (artyForward) gunLoss(attArty.filter((x) => attCA.includes(x)), attLossRaw, attRemoved, true);
  for (const u of [...attackers, ...defenders]) syncStr(u);

  const attLostTOE = attTOEBefore - attackers.reduce((s, u) => s + u.str, 0);
  const defLostTOE = defTOEBefore - defenders.reduce((s, u) => s + u.str, 0);
  say(`Attacker roll ${aSeq} (sum ${aSum}): ${aPct}% losses → ${attLossRaw} raw points${fmtRemoved(attRemoved)}${aEngaged ? '; Engaged' : ''}.`);
  say(`Defender roll ${dSeq} (sum ${dSum}): ${dPct}% losses${shortfall ? ` (incl. ${shortfall * 10}% for retreat not possible)` : ''} → ${defLossRaw} raw points${fmtRemoved(defRemoved)}${retreatHexes ? `; retreat ${retreatHexes} hex${retreatHexes > 1 ? 'es' : ''}` : ''}.`);

  // Prisoners [15.85-15.86].
  const capture = (lostTOE, by, label) => {
    if (lostTOE <= 0) return;
    const pct = PRISONERS_PCT[d6()];
    const n = Math.ceil((pct / 100) * lostTOE);
    g.prisoners[by] = (g.prisoners[by] || 0) + n;
    say(`${label}: ${pct}% of losses captured (${n} TOE points become prisoners).`);
  };
  if (dCapt) capture(defLostTOE, side, 'Defenders captured');
  if (aCapt) capture(attLostTOE, defenders[0].side, 'Attackers captured');

  // Heavy losses disorganise [15.87].
  if (attTOEBefore && attLostTOE / attTOEBefore >= 0.3) for (const u of attackers) u.cohesion -= 3;
  if (defTOEBefore && defLostTOE / defTOEBefore >= 0.3) for (const u of defenders) u.cohesion -= 3;

  // Defender CP refund on a hopeless assault [11.27, 15.96].
  if (basic + shifts <= -4) defenders.forEach((d, i) => { d.cpUsed = defCPBefore[i] + (probe ? 0 : 1); });

  // Retreat / Engaged [15.81-15.82, 15.74].
  const survivors = defenders.filter((d) => d.str > 0);
  if (retreatHexes && survivors.length) retreatUnits(survivors, attackers, retreatHexes);
  else if (aEngaged) for (const u of [...attackers, ...survivors]) u.engaged = true;

  finish();
  const cleared = !g.units.some((u) => u.side !== side && u.pos[0] === targetPos[0] && u.pos[1] === targetPos[1] && u.str > 0);
  return { lines, defendersCleared: cleared, vacatedBeforeAssault, attackers, defenders };

  function finish() {
    for (const u of [...attackers, ...defenders]) { u.ammo = Math.max(0, u.ammo - 1); syncStr(u); }
    for (const l of lines) log(l);
  }
}

const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
function fmtRemoved(removed) {
  const parts = Object.entries(removed).map(([k, n]) => `${n}× ${k.split('|')[1]}`);
  return parts.length ? ` (lost ${parts.join(', ')})` : '';
}

// Move units away from attackers, N hexes, avoiding enemy ZOC and stacking violations [15.82, 9.35].
// Returns the number of hexes that could NOT be retreated (for the 10%-per-hex penalty).
export function makeRetreat(g, ctx) {
  const { map, spendCP, inEnemyZoc } = ctx;
  return (units, attackers, n, { dryRun = false } = {}) => {
    let worstShort = 0;
    for (const u of units) {
      let pos = u.pos;
      let moved = 0;
      const seen = new Set([key(...pos)]);
      for (let i = 0; i < n; i++) {
        const opts = neighbours(...pos).filter((h) => {
          if (seen.has(key(...h))) return false;
          const c = stepCost(map, pos, h, { motorised: u.motorised });
          if (!c) return false;
          if (g.units.some((x) => x.side !== u.side && x.str > 0 && x.pos[0] === h[0] && x.pos[1] === h[1])) return false;
          if (inEnemyZoc(g, u, h)) return false;
          const sp = g.units.filter((x) => x.side === u.side && x !== u && x.pos[0] === h[0] && x.pos[1] === h[1]).reduce((s, x) => s + (STACKING_POINTS[x.size] ?? 0), 0);
          if (sp + (STACKING_POINTS[u.size] ?? 0) > stackingLimit(map, h)) return false;
          return Math.min(...attackers.map((a) => distance(a.pos, h))) > Math.min(...attackers.map((a) => distance(a.pos, pos)));
        });
        if (!opts.length) break;
        opts.sort((a, b) => stepCost(map, pos, a, { motorised: u.motorised }).cp - stepCost(map, pos, b, { motorised: u.motorised }).cp);
        const next = opts[0];
        if (!dryRun) spendCP(u, stepCost(map, pos, next, { motorised: u.motorised }).cp);
        pos = next; seen.add(key(...pos)); moved++;
      }
      if (!dryRun) { u.pos = pos; u.contact = false; u.engaged = false; }
      worstShort = Math.max(worstShort, n - moved);
    }
    return worstShort;
  };
}
