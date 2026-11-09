// Air transport of personnel and supplies [42.3, 47.35]: ready, fuelled transport-capable planes carry cargo that starts the stage in
// their base hex. Supply units need 20 (CW) or 30 (Axis) planes if they hold little, else 50 / 60 planes [47.35]. Personnel use the
// TOE-point capacity printed on the aircraft chart. STAND-IN: units cannot be split, so a unit is carried whole or not at all.
import { AIRCRAFT } from '../shared/air.js';

export const SUPPLY_LIFT = { axis: { ammo: 8, fuel: 20, small: 30, big: 60 }, cw: { ammo: 10, fuel: 25, small: 20, big: 50 } };

const frac = (t) => t.split('/').length === 2 ? Number(t.split('/')[0]) / Number(t.split('/')[1]) : Number(t) || 0;
// 'Passengers' in TOE points from strings such as '1 or 10 tons', '1/4 or 5 tons', '1P or 2 1/2 tons', '0 or 1/2'.
export function paxOf(p) {
  const t = AIRCRAFT[p.type]?.transport;
  if (t == null) return null;
  return String(t).split(' or ')[0].replace(/[^\d/ ]/g, '').trim().split(/\s+/).filter(Boolean).reduce((n, x) => n + frac(x), 0);
}
export const liftPlanes = (sq) => sq.kind === 'flyingboat' ? [] : sq.planes.filter((p) => p.ready && p.fueled && paxOf(p) != null);

const sameHex = (a, b) => a[0] === b[0] && a[1] === b[1];
export const airliftable = (u) => u.str > 0 && !u.motorised && (u.type === 'inf' || u.sas) && u.type !== 'hq';

// What could be loaded at this squadron's base (the cargo must start the stage in the hex with the transport [42.32]).
export function cargoAtBase(g, sq, baseHex) {
  if (!baseHex) return { units: [], supply: [] };
  return {
    units: g.units.filter((u) => u.side === sq.side && airliftable(u) && sameHex(u.pos, baseHex)).map((u) => ({ id: u.id, name: u.name, str: u.str })),
    supply: g.supply.units.filter((s) => s.side === sq.side && sameHex(s.pos, baseHex)).map((s) => ({ id: s.id, ammo: s.ammo, fuel: s.fuel })),
  };
}

// Can this pool of planes carry the cargo? Returns an error text or null.
export function checkCapacity(g, side, planes, cargo) {
  const units = (cargo.units || []).map((id) => g.units.find((u) => u.id === id && u.side === side));
  const sups = (cargo.supply || []).map((id) => g.supply.units.find((s) => s.id === id && s.side === side));
  if (units.some((u) => !u || !airliftable(u))) return 'Only your own un-motorised infantry and airborne units can be flown [42.37].';
  if (sups.some((s) => !s)) return 'Unknown supply unit.';
  const L = SUPPLY_LIFT[side];
  const need = sups.reduce((n, s) => n + (s.ammo <= L.ammo && s.fuel <= L.fuel ? L.small : L.big), 0);
  if (planes.length < need) return `Flying those supplies needs ${need} ready, fuelled transport planes at the base; ${planes.length} are available [47.35].`;
  const rest = [...planes].sort((a, b) => paxOf(a) - paxOf(b)).slice(need);
  const cap = rest.reduce((n, p) => n + paxOf(p), 0), load = units.reduce((n, u) => n + u.str, 0);
  if (load > cap + 1e-9) return `The cargo planes carry ${cap} TOE points of personnel but ${load} were loaded [42.31].`;
  return null;
}
