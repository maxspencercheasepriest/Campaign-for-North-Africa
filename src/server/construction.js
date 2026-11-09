// Engineers and construction [23.0, 24.0]: new and rebuilt fortifications, rebuilt roads and railways.
//
// Work is started in a side's own Movement & Combat Phase by units that have not spent a single Capability Point, and is
// counted when the Operations Stage ends: if every unit on the project still has spent no CP, was not pinned from the air
// and the hex had no sandstorm or rainstorm, the stage counts [24.11, 24.12, 24.22, 24.23]. Supplies are paid at the start [24.13].
//
// Stand-ins: the book's "Store Points" are not tracked unit by unit here, so each side has one pool (g.stores) and a supply unit
// must be in the hex for work to start. Water for hot weather [24.21] is ignored, as it is everywhere in the abstract logistics.
// Engineer units are counters of type 'hq' with an `eng` kind: 'bn' battalion, 'co' company, 'rr' NZ railway company, 'road' SA road unit.
// Not built: new railway track toward Tobruk [24.62, 24.67], unfinished Via Balbia stretches [24.51], minefields, air facilities, repair facilities.

import { key, neighbours } from '../shared/hex.js';
import { fortBase, fortLevel, isCity } from './air.js';

export const STORES_START = { axis: 300, cw: 300 };
export const STORES_PER_TURN = 25; // stand-in for Stores arriving with convoys
export const FORT_STORES = 30, FORT_STAGES = 3, ROAD_STORES = 2, RAIL_STORES = 1;
const NO_NEW_FORT = new Set(['mountain', 'saltmarsh', 'desert', 'majorcity', 'delta']); // [24.44]
const FORT_CAP = 2; // counters are Level 1 or 2 [24.41]

export const isEngineer = (u) => !!u.eng;
const infantry = (u) => (u.type === 'inf' || u.type === 'mot') && u.str >= 3 && !u.reserve; // an infantry unit with 3+ TOE [24.42]
const idle = (u) => !u.cpUsed;

export function initConstruction(g) {
  g.projects ||= [];
  g.stores ||= { ...STORES_START };
  g.projectN ||= 0;
  g.damage.built ||= {};
}

const inProject = (g, u) => g.projects.some((p) => p.unitIds.includes(u.id));
const enemyThere = (g, side, hex) => g.units.some((x) => x.side !== side && x.str > 0 && x.type !== 'hq' && x.pos[0] === hex[0] && x.pos[1] === hex[1]);
const hasDump = (g, side, hex) => g.supply.units.some((x) => x.side === side && x.pos[0] === hex[0] && x.pos[1] === hex[1]);

// What each own group of idle units could start where it stands.
export function buildSpots(g, side, ctx) {
  initConstruction(g);
  const d = g.damage;
  const byHex = new Map();
  for (const u of g.units) {
    if (u.side !== side || !(u.eng || u.str > 0) || !idle(u) || inProject(g, u)) continue;
    const k = key(...u.pos);
    if (!byHex.has(k)) byHex.set(k, []);
    byHex.get(k).push(u);
  }
  const spots = [];
  for (const [k, units] of byHex) {
    const hex = units[0].pos;
    const engs = units.filter(isEngineer), inf = units.filter(infantry);
    if (!engs.length && !inf.length) continue;
    const options = [];
    const paid = (cost) => (g.stores[side] < cost ? `needs ${cost} Stores in the pool` : !hasDump(g, side, hex) ? 'needs a supply unit in the hex to hold the Stores' : null);
    // Fortification: one engineer unit plus one infantry unit with 3+ TOE [24.42].
    if (engs.length && inf.length) {
      const terr = ctx.map.tiles[k]?.t;
      const lost = d.fort[k] || 0, built = d.built[k] || 0, base = fortBase(hex, d);
      const rebuild = lost > 0;
      let why = null;
      if (!rebuild) {
        if (!isCity(hex)) { if (built >= FORT_CAP) why = 'already at Level 2'; }
        else why = 'this city is already at its full Level';
        if (!why && NO_NEW_FORT.has(terr)) why = 'fortifications cannot be built from scratch in this terrain';
        if (!why && ctx.inEnemyZoc(g, { side }, hex)) why = 'new fortifications cannot be started in an enemy zone of control';
      }
      if (!why) why = paid(FORT_STORES);
      options.push({
        kind: 'fort', label: rebuild ? 'Rebuild a fortification level' : `Build fortification Level ${built + 1}`, cost: FORT_STORES, stages: FORT_STAGES,
        unitIds: [engs[0].id, inf[0].id], ok: !why, why,
      });
    }
    // Roads and railways: up to three damaged hexes, the one the unit is in plus two adjacent [24.53, 24.63].
    const near = [hex, ...neighbours(...hex)].filter((h) => !enemyThere(g, side, h) && !ctx.inEnemyZoc(g, { side }, h));
    const roadHexes = near.filter((h) => d.roads[key(...h)] != null);
    const railHexes = near.filter((h) => d.rails[key(...h)] != null);
    if (roadHexes.length) {
      const roadEng = engs.filter((u) => ['bn', 'co', 'road'].includes(u.eng));
      const cap = roadEng.some((u) => u.eng === 'bn') || (roadEng.length && inf.length) ? 3 : roadEng.length || inf.length ? 1 : 0;
      const n = Math.min(cap, roadHexes.length);
      if (n) {
        const why = paid(ROAD_STORES * n);
        options.push({ kind: 'road', label: `Rebuild ${n} bombed road hex${n > 1 ? 'es' : ''}`, cost: ROAD_STORES * n, stages: 1, hexes: roadHexes.slice(0, n).map((h) => key(...h)), unitIds: [...(roadEng[0] ? [roadEng[0].id] : []), ...(!roadEng[0] || roadEng[0].eng !== 'bn' ? inf.slice(0, 1).map((u) => u.id) : [])], ok: !why, why });
      }
    }
    if (railHexes.length) {
      const railEng = engs.filter((u) => ['bn', 'co', 'rr'].includes(u.eng));
      const n = Math.min(3 * railEng.length, railHexes.length);
      if (n) {
        const why = paid(RAIL_STORES * n);
        options.push({ kind: 'rail', label: `Rebuild ${n} destroyed railway hex${n > 1 ? 'es' : ''}`, cost: RAIL_STORES * n, stages: 1, hexes: railHexes.slice(0, n).map((h) => key(...h)), unitIds: railEng.map((u) => u.id), ok: !why, why });
      }
    }
    if (options.length) spots.push({ hex: k, pos: hex, options });
  }
  return spots;
}

// Action: { action: 'build', kind, hex: 'c,r' }
export function startBuild(g, side, a, ctx) {
  initConstruction(g);
  const spot = buildSpots(g, side, ctx).find((s) => s.hex === a.hex);
  const opt = spot?.options.find((o) => o.kind === a.kind);
  if (!opt) return 'Nothing of that kind can be built there with the units on hand (units must be idle: no Capability Points spent this Operations Stage).';
  if (!opt.ok) return `Cannot start: ${opt.why}.`;
  if (opt.kind === 'fort' && g.projects.some((p) => key(...p.hex) === a.hex && p.kind === 'fort')) return 'A fortification is already under construction there [24.46].';
  g.stores[side] -= opt.cost;
  g.projects.push({ id: ++g.projectN, side, kind: opt.kind, hex: spot.pos, unitIds: opt.unitIds, hexes: opt.hexes || null, progress: 0, needed: opt.stages, rebuild: opt.label.startsWith('Rebuild a fort') });
  ctx.log(side, `Construction begun at ${a.hex}: ${opt.label.toLowerCase()} (${opt.cost} Stores).`);
  return null;
}

export function cancelBuild(g, side, a, ctx) {
  const i = (g.projects || []).findIndex((p) => p.id === a.projectId && p.side === side);
  if (i < 0) return 'No such project.';
  const p = g.projects[i];
  g.projects.splice(i, 1);
  ctx.log(side, `Construction at ${key(...p.hex)} is called off; the Stores already spent are lost.`);
  return null;
}

// Called as an Operations Stage ends, before Capability Points are reset.
export function closeStage(g, ctx) {
  if (!g.projects?.length) return;
  const keep = [];
  for (const p of g.projects) {
    const units = p.unitIds.map((id) => g.units.find((u) => u.id === id)).filter(Boolean);
    const here = units.length === p.unitIds.length && units.every((u) => u.pos[0] === p.hex[0] && u.pos[1] === p.hex[1]);
    if (!here) { ctx.log(p.side, `Construction at ${key(...p.hex)} is abandoned: the work party is gone.`); continue; }
    const moved = units.some((u) => u.cpUsed > 0);
    const pinned = units.some((u) => (u.elements || []).some((e) => e.airPin > 0));
    const wx = ctx.weatherAt(p.hex);
    if (moved) { ctx.log(p.side, `Construction at ${key(...p.hex)} is halted this stage: the work party spent Capability Points [24.12].`); keep.push(p); continue; }
    if (pinned) { ctx.log(p.side, `Construction at ${key(...p.hex)} is halted this stage: the work party was pinned [24.23].`); keep.push(p); continue; }
    if (wx === 'sand' || wx === 'rain') { ctx.log(p.side, `Construction at ${key(...p.hex)} is halted this stage by the ${wx === 'sand' ? 'sandstorm' : 'rainstorm'} [24.22].`); keep.push(p); continue; }
    p.progress += 1;
    if (p.progress < p.needed) { keep.push(p); continue; }
    finish(g, p, ctx);
  }
  g.projects = keep;
}

function finish(g, p, ctx) {
  const d = g.damage, k = key(...p.hex);
  if (p.kind === 'fort') {
    if ((d.fort[k] || 0) > 0 && p.rebuild) { d.fort[k] -= 1; if (d.fort[k] <= 0) delete d.fort[k]; }
    else d.built[k] = Math.min(FORT_CAP, (d.built[k] || 0) + 1);
    ctx.log(p.side, `Fortification at ${k} complete: now Level ${fortLevel(d, p.hex)}.`);
  } else if (p.kind === 'road') {
    for (const h of p.hexes) delete d.roads[h];
    ctx.log(p.side, `Road rebuilt at ${p.hexes.join(', ')}.`);
  } else if (p.kind === 'rail') {
    for (const h of p.hexes) delete d.rails[h];
    ctx.log(p.side, `Railway rebuilt at ${p.hexes.join(', ')}.`);
  }
}

export function buildView(g, side, ctx, show) {
  initConstruction(g);
  return {
    stores: g.stores[side],
    projects: g.projects.filter((p) => p.side === side).map((p) => ({ id: p.id, kind: p.kind, hex: key(...p.hex), pos: p.hex, progress: p.progress, needed: p.needed })),
    spots: show ? buildSpots(g, side, ctx) : [],
  };
}
