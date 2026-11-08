// The Air Game, stage 1: aircraft data [4.44], air facilities [36.0], squadrons [35.0] and the 1940 starting air forces [60.32, 60.42, 60.5].
// Not built yet: missions, flight, air-to-air combat, flak, bombing, air supply, pilots arriving, reinforcements (see docs/RULES-STATUS.md).
// Values are copied from the Aircraft Characteristics Charts (pages 112-113, 144-145). null = could not be read from the scan.
import { hexFromName } from './hexnames.js';

// range, tac (TacAir; paren = may never initiate air-to-air combat), man (Maneuver), bomb, torp, fuel, caps = mission capability letters
// kind: fighter | bomber | recon | transport | flyingboat. alt = other loads the plane may be readied with.
const P = (kind, range, tac, paren, man, bomb, fuel, caps, extra = {}) => ({ kind, range, tac, paren, man, bomb, fuel, caps, ...extra });
const F = (range, tac, man, bomb, fuel, caps, extra) => P('fighter', range, tac, false, man, bomb, fuel, caps, extra);
const B = (range, tac, man, bomb, fuel, caps, extra) => P('bomber', range, tac, true, man, bomb, fuel, caps, extra);

export const AIRCRAFT = {
  // Commonwealth fighters
  'Gladiator Mk.II': F(44, 2, 27, 0, 0, 'F S', { side: 'cw', pilot: true }),
  'Sea Gladiator': F(38, 2, 27, 0, 1, 'F S', { side: 'cw', pilot: true }),
  'Hurricane Mk.I': F(52, 4, 32, 0, 1, 'F S', { side: 'cw', pilot: true }),
  'Hurricane Mk.IIA': F(88, 4, 25, 0, 2, 'F', { side: 'cw', pilot: true, alt: [{ range: 44, man: 36, bomb: 0, fuel: 1, caps: 'F S' }, { range: 39, man: 33, bomb: 2, fuel: 1, caps: 'F D' }] }),
  'Hurricane Mk.IIB': F(88, 6, 25, 0, 2, 'F', { side: 'cw', pilot: true, alt: [{ range: 44, man: 36, bomb: 0, fuel: 1, caps: 'F S' }, { range: 39, man: 32, bomb: 4, fuel: 1, caps: 'F D' }] }),
  'Hurricane Mk.IIC': F(86, 8, 25, 0, 2, 'F', { side: 'cw', pilot: true, alt: [{ range: 43, man: 36, bomb: 0, fuel: 1, caps: 'F S' }, { range: 38, man: 30, bomb: 6, fuel: 1, caps: 'F D' }] }),
  'P-40 Tomahawk': F(75, 2, 27, 0, 2, 'F', { side: 'cw', pilot: true, alt: [{ range: 62, man: 32, bomb: 0, fuel: 1, caps: 'F S' }] }),
  'P-40 Kittyhawk I': F(94, 4, 31, 0, 2, 'F', { side: 'cw', pilot: true, alt: [{ range: 71, man: 33, bomb: 0, fuel: 1, caps: 'F S' }, { range: 60, man: 29, bomb: 2, fuel: 1, caps: 'F D' }] }),
  'Spitfire Mk.VB': F(39, 6, 40, 0, 1, 'F S', { side: 'cw', pilot: true }),
  'Fulmar Mk.II': F(74, 4, 29, 0, 1, 'N S', { side: 'cw', pilot: true }),
  'Beaufighter Mk.IF': F(117, 11, 30, 0, 3, 'N S', { side: 'cw', pilot: true }),
  'Blenheim Mk.IVF': F(146, 5, 30, 0, 3, 'N 0', { side: 'cw', pilot: true }),
  'MS406': F(45, 4, 32, 0, 1, 'F S', { side: 'cw', pilot: true, note: 'French' }),
  'C.714': F(49, 2, 30, 0, 1, 'F', { side: 'cw', pilot: true, note: 'French' }),
  'D.520': F(56, 4, 37, 0, 1, 'F', { side: 'cw', pilot: true, note: 'French' }),
  // Commonwealth bombers, flying boats, transports, recon
  'Anson Mk.I': B(71, 2, 20, 2, 2, 'R B', { side: 'cw', kind: 'bomber' }),
  'Blenheim Mk.I': B(101, 1, 22, 5, 2, 'B', { side: 'cw' }),
  'Blenheim Mk.IV': B(131, 3, 21, 6, 3, 'B', { side: 'cw' }),
  'Bombay Mk.I': B(88, 1, 5, 10, 2, 'B', { side: 'cw', kind: 'bomber', transport: '1 or 10 tons', alt: [{ range: 203, note: 'transfer', man: 6, bomb: 0, fuel: 2 }] }),
  'Boston Mk.III': B(102, 5, 23, 10, 3, 'B', { side: 'cw' }),
  'Wellington Mk.I': B(229, 3, 20, 5, 4, 'N', { side: 'cw', alt: [{ range: 108, man: 18, bomb: 23, fuel: 4, caps: 'N' }] }),
  'Wellington Mk.IV': B(220, 3, 23, 6, 5, 'N', { side: 'cw', alt: [{ range: 157, man: 19, bomb: 17, fuel: 5, caps: 'N' }, { range: 126, man: 18, bomb: 23, fuel: 5, caps: 'N' }] }),
  'Halifax Mk.II': B(194, 5, 27, 7, 6, 'B', { side: 'cw', alt: [{ range: 62, man: 26, bomb: 65, fuel: 6, caps: 'B' }] }),
  'B-24 Liberator III': B(208, 5, 23, 64, 7, 'B', { side: 'cw' }),
  'B-25 Mitchell II': B(125, 6, 25, 14, 4, 'B', { side: 'cw' }),
  'Baltimore I': B(101, 6, 22, 10, 3, 'B', { side: 'cw' }),
  'Maryland': B(76, 3, 20, 9, 3, 'R B', { side: 'cw' }),
  'Beaufort Mk.I': B(144, 2, 24, 0, 1, 'B', { side: 'cw', torp: 8 }),
  'Swordfish Mk.I': B(48, 1, 7, 0, 1, 'B', { side: 'cw', torp: 8 }),
  'Lysander Mk.I': P('recon', 60, 2, true, 20, 0, 1, 'S R', { side: 'cw' }),
  'Potez 63.11': P('recon', 75, 5, true, 26, 0, 1, 'R', { side: 'cw', note: 'French' }),
  'Hudson (A-28)': P('transport', 145, 3, true, 8, 0, 2, '', { side: 'cw', transport: '1 or 10 tons' }),
  'Valentia': P('transport', 31, 0, true, 1, 10, 1, 'B', { side: 'cw', transport: '1/4 or 5 tons' }),
  'Sunderland': P('flyingboat', 176, 5, true, 11, 9, 4, 'R B', { side: 'cw', alt: [{ range: 238, man: 7, bomb: 0, fuel: 4, caps: 'R' }] }),
  // Italian fighters
  'C.R. 32': F(42, 3, 25, 1, 1, 'F S D', { side: 'axis', pilot: true }),
  'C.R. 42 Falco': F(43, 3, 28, 0, 1, 'N S', { side: 'axis', pilot: true }),
  'C.R. 42AS Falco': F(41, 3, 27, 1, 1, 'F S D', { side: 'axis', pilot: true }),
  'C 200 Saetta': F(40, 2, 33, 0, 1, 'F S D', { side: 'axis', pilot: true }),
  'C 202 Folgore': F(47, 2, 35, 1, 1, 'F S D', { side: 'axis', pilot: true }),
  'G. 50 Freccia': F(57, 3, 25, 0, 1, 'F S', { side: 'axis', pilot: true }),
  'Re. 2000 Falco I': F(47, 2, 34, 0, 2, 'F S', { side: 'axis', pilot: true }),
  'Re. 2001 Falco II': F(42, 3, 35, 0, 3, 'F S', { side: 'axis', pilot: true }),
  // Italian bombers, flying boats, transports, recon
  'Ba 65': B(55, 4, 18, 10, 2, 'D', { side: 'axis' }),
  'Ba 88 Lince': B(92, 4, 16, 11, 3, 'R B', { side: 'axis' }),
  'B.R. 20 Cicogna': B(145, 2, 17, 17, 3, 'N', { side: 'axis' }),
  'Ca 309 Ghibli': B(84, 2, 9, 4, 2, 'R B', { side: 'axis', transport: '0 or 1/2' }),
  'Ca 311': B(108, 2, 10, 4, 2, 'R B', { side: 'axis' }),
  'Cant Z. 501 Gabbiano': P('flyingboat', 130, 2, true, 7, 7, 2, 'R B', { side: 'axis' }),
  'Cant Z. 506B Airone': P('flyingboat', null, 3, true, 14, 11, 3, 'R B', { side: 'axis', torp: 8 }),
  'Cant Z. 1007bis Alcione': B(120, 3, 23, 15, 4, 'B', { side: 'axis', torp: 10 }),
  'Ro 37bis': P('recon', 93, 2, true, 20, 2, 2, 'R B', { side: 'axis' }),
  'S.M. 79 Sparviero': B(120, 4, 19, 12, 3, 'B', { side: 'axis', torp: 6 }),
  'S.M. 81 Pipistrello': B(90, 5, 14, 11, 3, 'R B N', { side: 'axis', transport: '1P or 2 1/2 tons' }),
  'S.M. 84': B(101, 4, 16, 22, 4, 'B', { side: 'axis', torp: 14 }),
  // German aircraft, as far as the chart pages were transcribed
  'Bf. 109E': F(41, 6, 34, 0, 1, 'F S D', { side: 'axis', pilot: true }),
  'Bf. 109F': F(44, 6, 39, 0, 1, 'F S', { side: 'axis', pilot: true }),
  'Bf. 109G': F(53, 8, 36, 0, 1, 'F S', { side: 'axis', pilot: true }),
  'He. 111': B(112, 6, 22, 27, 3, 'N', { side: 'axis' }),
  'Ju. 87B': B(36, 3, 25, 5, 1, 'D', { side: 'axis' }),
  'Ju. 87D': B(62, 4, 22, 20, 2, 'D', { side: 'axis' }),
  'Ju. 88D': B(118, 5, 25, 33, 2, 'D R', { side: 'axis' }),
  'Ju. 52/3m': P('transport', 72, 2, true, 8, 0, 2, '', { side: 'axis', transport: '1 or 2 1/2 tons' }),
  'Hs. 126': P('recon', 45, 2, true, 14, 2, 1, 'D R', { side: 'axis' }),
  'Fw. 200 C': B(205, 5, 21, 14, 3, 'D R', { side: 'axis' }),
  'Ar. 196': P('flyingboat', 60, 3, true, 10, 1, 1, 'R B', { side: 'axis' }),
};

export const aircraft = (name) => {
  const a = AIRCRAFT[name];
  if (!a) throw new Error(`Unknown aircraft: ${name}`);
  return a;
};

// Squadron size: ready capacity + reserve capacity [35.23]. Commonwealth squadrons grow from July 1941 (Game-Turn 91).
export const SQUADRON_CAPACITY = { it: { ready: 9, reserve: 3 }, de: { ready: 12, reserve: 4 }, cw: { ready: 15, reserve: 5 } };
// Squadron capacity of each kind of air facility [36.12, 36.2, 36.3, 36.4].
export const FACILITY_CAPACITY = { airfield: 6, strip: 1, basin: 3, alighting: 1 };
export const FACILITY_NAMES = { airfield: 'Airfield', strip: 'Landing strip', basin: 'Flying boat basin', alighting: 'Alighting area' };

// [60.5] Air facilities in existence at the start (page 79). Hexes whose OCR was doubtful were cross-checked with 61.33.
const F_ = (id, name, kind, hex, side, off = false) => ({ id, name, kind, hex, side, off });
export const FACILITIES = [
  // Axis airfields (Libya)
  F_('benina', 'Benina', 'airfield', 'A4829', 'axis'), F_('barce', 'Barce', 'airfield', 'B5504', 'axis'), F_('martuba', 'Martuba', 'airfield', 'B5526', 'axis'),
  F_('eladem', 'El Adem', 'airfield', 'C4507', 'axis'), F_('maddalena', 'Ft. Maddalena', 'airfield', 'C3019', 'axis'), F_('soluch', 'Soluch', 'airfield', 'A4130', 'axis'),
  ...['Tripoli', 'Tunisia 1', 'Tunisia 2', 'Tunisia 3'].map((n, i) => F_(`axbox${i}`, n + ' (off-map)', 'airfield', null, 'axis', true)),
  // Commonwealth airfields (Egypt)
  F_('matruh', 'Mersa Matruh', 'airfield', 'D3714', 'cw'), F_('amiriya', 'Amiriya', 'airfield', 'E3212', 'cw'), F_('dekheila', 'Dekheila', 'airfield', 'E3512', 'cw'),
  F_('alex1', 'Alexandria (west)', 'airfield', 'E3613', 'cw'), F_('alex2', 'Alexandria (east)', 'airfield', 'E3714', 'cw'), F_('abbassia', 'Abbassia', 'airfield', 'E2132', 'cw'),
  F_('aboukir', 'Aboukir', 'airfield', 'E3815', 'cw'), F_('almaza', 'Almaza', 'airfield', 'E2133', 'cw'),
  ...['Abu Seier', 'Deversoir', 'Fayid', 'Ismailia', 'Kabrit'].map((n) => F_(`cwoff-${n.toLowerCase().replace(' ', '')}`, n + ' (off-map)', 'airfield', null, 'cw', true)),
  // Flying boat bases
  F_('alexbasin', 'Alexandria basin', 'basin', 'E3614', 'cw'), F_('bomba', 'Bomba basin', 'basin', 'B5331', 'axis'), F_('portsaid', 'Port Said basin (off-map)', 'basin', null, 'cw', true),
  F_('derna-fb', 'Derna alighting area', 'alighting', 'B5925', 'axis'),
  // Air landing strips (Libya, then Egypt) [60.5]
  ...[['augila', 'Augila', 'B0707'], ['bardia', 'Bardia', 'C4321'], ['elagheila', 'El Agheila', 'A1816'], ['capuzzo', 'Ft. Capuzzo', 'C4020'], ['giarabub', 'Giarabub', 'C1014'],
    ['mechili', 'Mechili', 'B4921'], ['menastir', 'Menastir', 'C4419'], ['sidiazeiz', 'Sidi Azeiz', 'C4218'], ['sidiomar', 'Sidi Omar', 'C3618'], ['sollum', 'Sollum', 'C4021'],
    ['tmimi', 'Tmimi', 'B5229'], ['ztert', 'Ztert', 'B5917'], ['tobruk', 'Tobruk', 'C4807'], ['gambut', 'Gambut', 'C4414'], ['gazala', 'Gazala', 'B4933'], ['maraua', 'Maraua', 'B5410'],
    ['bugbug', 'Buq Buq', 'C3926'], ['sidibarrani', 'Sidi Barrani', 'C4131'], ['birgubi', 'Bir el Gubi', 'C4108']].map(([id, name, hex]) => F_(id, name, 'strip', hex, id === 'sidibarrani' || id === 'bugbug' || id === 'birgubi' ? 'cw' : 'axis')),
  ...[['burgelarab', 'Burg el Arab', 'E3109'], ['elhamman', 'El Hamman', 'E3007'], ['fuka', 'Fuka', 'D3323'], ['qotifiya', 'Qotifiya', 'D3227'], ['sidihaneish', 'Sidi Haneish', 'D3418'],
    ['maatenbaggush', 'Maaten Baggush', 'D3520'], ['gerawla', 'Gerawla', 'D3516'], ['siwa', 'Siwa', 'C0127']].map(([id, name, hex]) => F_(id, name, 'strip', hex, 'cw')),
];

export const facilityHex = (f) => (f.hex ? hexFromName(f.hex) : null);

// [60.32] Italian and [60.42] Commonwealth North African Air Forces: [type, total available, total refitted (ready)].
export const START_FORCES = {
  axis: {
    nation: 'it', pilots: { 3: 3, 2: 10, 1: 15 }, sgsu: 39,
    planes: [['C.R. 42 Falco', 65, 25], ['C.R. 32', 70, 28], ['Ba 65', 10, 2], ['Ba 88 Lince', 24, 6], ['S.M. 79 Sparviero', 133, 35], ['S.M. 81 Pipistrello', 17, 4],
      ['Ca 309 Ghibli', 56, 12], ['Ro 37bis', 10, 6], ['Cant Z. 501 Gabbiano', 9, 9]],
  },
  cw: {
    nation: 'cw', pilots: { 3: 1, 2: 5, 1: 8 }, sgsu: 14,
    planes: [['Lysander Mk.I', 12, 8], ['Bombay Mk.I', 15, 12], ['Sunderland', 18, 11], ['Blenheim Mk.I', 26, 18], ['Blenheim Mk.IV', 12, 12], ['Blenheim Mk.IVF', 9, 5],
      ['Gladiator Mk.II', 36, 30], ['Hurricane Mk.I', 6, 4], ['MS406', 4, 2], ['Potez 63.11', 2, 2], ['Valentia', 3, 1]],
  },
};

// Where to put each squadron, in order of preference (the player may rebase later; that is a transfer mission, not built yet).
const PLACEMENT = {
  axis: { fighter: ['eladem', 'maddalena', 'martuba', 'barce', 'benina', 'soluch'], bomber: ['benina', 'barce', 'martuba', 'soluch', 'eladem', 'maddalena', 'axbox0', 'axbox1'], recon: ['barce', 'benina', 'martuba', 'eladem'], transport: ['benina'], flyingboat: ['bomba', 'derna-fb'] },
  cw: { fighter: ['matruh', 'amiriya', 'dekheila', 'alex1', 'alex2'], bomber: ['alex1', 'alex2', 'amiriya', 'dekheila', 'aboukir', 'almaza', 'abbassia', 'cwoff-deversoir', 'cwoff-fayid', 'cwoff-kabrit'], recon: ['matruh', 'amiriya', 'alex2'], transport: ['almaza', 'abbassia'], flyingboat: ['alexbasin', 'portsaid'] },
};

// Starting air stocks of Ammo, Fuel and Stores [60.32, 60.42]. Kept as one pool per side for now (the book keeps them per facility).
export const AIR_STOCK = { axis: { ammo: 1200, fuel: 850, stores: 100 }, cw: { ammo: 200, fuel: 250, stores: 50 } };

// Build the starting air order of battle for both sides.
export function createAir() {
  const facilities = FACILITIES.map((f) => ({ ...f, owner: f.side, cap: FACILITY_CAPACITY[f.kind], used: 0 }));
  const squadrons = [];
  const notes = [];
  for (const side of ['axis', 'cw']) {
    const f = START_FORCES[side];
    const size = SQUADRON_CAPACITY[f.nation].ready + SQUADRON_CAPACITY[f.nation].reserve;
    const readyCap = SQUADRON_CAPACITY[f.nation].ready;
    let n = 0;
    // The Free French fighters, recon and Potez may share a squadron [60.42 note].
    const groups = f.planes.map(([type, total, ready]) => ({ type, total, ready }));
    const french = groups.filter((g) => AIRCRAFT[g.type].note === 'French');
    const rest = groups.filter((g) => !french.includes(g));
    const make = (types, label) => {
      const list = types.flatMap((g) => Array.from({ length: g.total }, () => ({ type: g.type, ready: false })));
      const kind = AIRCRAFT[types[0].type].kind;
      const chunks = [];
      for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
      // Deal the refitted planes out evenly across the squadrons, no more than the ready capacity in each [35.23].
      for (const g of types) {
        let left = g.ready, k = 0, guard = 0;
        while (left > 0 && guard++ < 100000) {
          const c = chunks[k % chunks.length];
          const p = c.find((x) => x.type === g.type && !x.ready);
          if (p && c.filter((x) => x.ready).length < readyCap) { p.ready = true; left--; }
          k++;
        }
      }
      for (let i = 0; i < chunks.length; i++) {
        const planes = chunks[i];
        const placeKind = kind;
        const bases = PLACEMENT[side][placeKind];
        const fits = (x) => x.owner === side && x.used < x.cap && (kind === 'flyingboat' ? x.kind === 'basin' || x.kind === 'alighting' : x.kind === 'airfield' || x.kind === 'strip');
        const base = bases.map((id) => facilities.find((x) => x.id === id)).find((x) => x && fits(x))
          || facilities.filter(fits).sort((a, b) => (a.kind === 'airfield' ? 0 : 1) - (b.kind === 'airfield' ? 0 : 1))[0]; // overflow to any other facility with room
        if (!base) { notes.push(`${label}: no room for a squadron of ${types[0].type}`); continue; }
        base.used++;
        n++;
        squadrons.push({ id: `${side}-sq${n}`, side, nation: f.nation, name: `${label} ${i + 1}`, kind, facility: base.id, planes: planes.map((p) => ({ type: p.type, ready: p.ready, fueled: false, armed: false, pilot: AIRCRAFT[p.type].pilot ? 0 : null })) });
      }
    };
    for (const g of rest) make([g], g.type);
    if (french.length) make(french, 'Free French');
  }
  assignPilots(squadrons);
  return { facilities, squadrons, notes, returning: [], stock: { axis: { ...AIR_STOCK.axis }, cw: { ...AIR_STOCK.cw } }, pilots: { axis: START_FORCES.axis.pilots, cw: START_FORCES.cw.pilots }, sgsu: { axis: START_FORCES.axis.sgsu, cw: START_FORCES.cw.sgsu } };
}

// Rated pilots (3 best) go to fighters, spread across the fighter squadrons; the rest fly as zero-rated pilots [34.83].
function assignPilots(squadrons) {
  for (const side of ['axis', 'cw']) {
    const sqs = squadrons.filter((s) => s.side === side && s.kind === 'fighter');
    const pool = [];
    for (const r of [3, 2, 1]) for (let i = 0; i < START_FORCES[side].pilots[r]; i++) pool.push(r);
    let i = 0;
    while (pool.length && sqs.length) {
      const sq = sqs[i % sqs.length];
      const slot = sq.planes.find((p) => p.pilot === 0 && p.ready) || sq.planes.find((p) => p.pilot === 0);
      if (slot) slot.pilot = pool.shift();
      i++;
      if (i > 100000) break;
    }
  }
}

// Summary used by the client.
export function summariseSquadron(s) {
  const types = {};
  for (const p of s.planes) { types[p.type] = (types[p.type] || 0) + 1; }
  return { id: s.id, name: s.name, kind: s.kind, facility: s.facility, total: s.planes.length, ready: s.planes.filter((p) => p.ready).length, fueled: s.planes.filter((p) => p.ready && p.fueled).length, armed: s.planes.filter((p) => p.ready && p.armed).length, nation: s.nation, types, pilots: s.planes.filter((p) => p.pilot > 0).map((p) => p.pilot) };
}
