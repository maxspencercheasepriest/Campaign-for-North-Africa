// Weapon-system and unit-type ratings [charts 4.46-4.48], encoded as data.
// cpa, aa = anti-air, bar = barrage, arm = anti-armour, vul = vulnerability, ap = armour protection,
// off/def = close assault offensive/defensive, fuel = fuel rate, bdr = breakdown adjustment (columns, +R / -L).
// A rating in parentheses on the charts (usable only when nothing better is in the hex) is marked with `paren: [...]`.
// class: infantry | armour | gun  (target class for barrage, see 3.22)

// bn = TOE points in one battalion-sized barrage target (a tank battalion, an artillery regiment, an infantry battalion).
const T = (cpa, aa, arm, ap, off, def, fuel, bdr) => ({ kind: 'tank', class: 'armour', cpa, aa, bar: 0, arm, vul: 0, ap, off, def, fuel, bdr, bn: 9 });
const G = (cpa, bar, arm, vul, off, def, extra = {}) => ({ kind: 'gun', class: 'gun', cpa, aa: 0, bar, arm, vul, ap: 0, off, def, fuel: 1, bdr: 0, bn: 6, ...extra });
const AT = (cpa, arm, vul, off, def) => ({ kind: 'at', class: 'gun', cpa, aa: 0, bar: 0, arm, vul, ap: 0, off, def, fuel: 1, bdr: 0, bn: 8 });
const AAG = (cpa, aa, arm, vul) => ({ kind: 'aa', class: 'gun', cpa, aa, bar: 0, arm: 0, vul, ap: 0, off: 0, def: 0, fuel: 1, bdr: 0, bn: 6, paren: { arm, off: 1, def: 1 } });
const INF = (cpa, off, def, bn, extra = {}) => ({ kind: 'inf', class: 'infantry', cpa, aa: 0, bar: 0, arm: 0, vul: 0, ap: 0, off, def, fuel: 0, bdr: 0, bn, ...extra });

export const WEAPONS = {
  // ---- Italian tanks and guns [4.48] ----
  'CV 33': T(25, 0, 0, 1, 1, 2, 1, 2),
  'L 6/40': T(25, 0, 1, 2, 2, 2, 2, 0),
  'M 11/39': T(20, 1, 2, 2, 3, 3, 2, 1),
  'M 13/40': T(20, 1, 3, 3, 3, 3, 2, 1),
  'M 14/41': T(20, 1, 3, 3, 3, 3, 2, 0),
  '65/17 Gun': G(15, 5, 0, 3, 1, 1),
  '75/18 Gun-Howitzer': G(15, 6, 0, 5, 1, 0),
  '75/27 Gun': G(15, 6, 2, 4, 1, 1), // anti-armour 0 until GT63
  '100/17 Howitzer': G(15, 8, 0, 5, 1, 0),
  '105/28 Gun': G(15, 9, 1, 7, 1, 1),
  '149/13 Howitzer': G(15, 15, 0, 5, 1, 0),
  '47/32 AT': AT(15, 4, 2, 1, 1),
  'Breda 20mm AA': AAG(15, 1, 2, 2),
  '75/46 AA': AAG(15, 2, 5, 2),
  '90/53 AA': { ...AAG(15, 3, 9, 2), arm: 9, paren: { off: 1, def: 1 } },

  // ---- Commonwealth tanks and guns [4.47] ----
  'A9 Cruiser': T(25, 1, 3, 1, 3, 3, 2, 1),
  'A10 Cruiser': T(15, 1, 3, 2, 3, 3, 2, 1),
  'A13 Cruiser': T(30, 0, 3, 2, 2, 3, 2, 1),
  'Crusader Mk.I': T(25, 1, 3, 3, 3, 4, 3, 1),
  'Crusader Mk.II': T(25, 1, 3, 4, 4, 4, 3, 1),
  'Crusader Mk.III': T(25, 1, 6, 4, 4, 5, 3, 1),
  'Grant M3': T(20, 1, 7, 4, 6, 5, 7, 0),
  'Mark VI Light': T(35, 1, 0, 1, 2, 2, 1, 0),
  'Matilda Mk.II': T(15, 0, 3, 6, 3, 4, 3, 1),
  'Sherman': T(20, 1, 6, 6, 5, 5, 6, 0),
  'Stuart M3': T(35, 1, 4, 3, 4, 4, 4, 0),
  'Valentine Mk.II': T(15, 0, 3, 5, 3, 4, 3, 0),
  '18-pounder Gun': G(15, 7, 0, 4, 0, 1, { paren: { arm: 2 } }),
  '18/25-pounder Gun': G(15, 8, 2, 5, 1, 1),
  '25-pounder Gun': G(15, 8, 5, 6, 1, 1),
  '4.5in Gun': G(15, 11, 1, 9, 1, 0),
  '5.5in Gun/Howitzer': G(15, 15, 1, 7, 1, 0),
  '60-pounder Gun': G(15, 12, 1, 7, 1, 0),
  '3.7in Howitzer': G(15, 7, 0, 3, 0, 0),
  '4.5in Howitzer': G(15, 9, 0, 3, 1, 0),
  '6in Howitzer': G(15, 15, 1, 5, 1, 0),
  '2-pounder AT': AT(15, 4, 2, 1, 1),
  '6-pounder AT': AT(15, 7, 2, 1, 1),
  '17-pounder AT': AT(15, 13, 2, 1, 1),
  'Bofors 40mm AA': AAG(15, 1, 1, 2),
  '3.7in AA': AAG(15, 4, 7, 2),

  // ---- German: PROVISIONAL until the German chart [4.49] is entered ----
  'PzKw II': { ...T(25, 1, 1, 2, 2, 2, 2, 0), provisional: true },
  'PzKw III': { ...T(25, 1, 5, 4, 4, 4, 3, 0), provisional: true },
  'PzKw IV': { ...T(25, 1, 4, 4, 4, 4, 3, 0), provisional: true },

  // ---- Infantry by unit-type code [4.46a/b] (rating per TOE point) ----
  'IT inf (u)': INF(10, 1, 1, 7), // standard Italian infantry battalion
  'IT inf (w)': INF(10, 1, 1, 5), // Libyan motorised battalion
  'IT inf (x)': INF(10, 1, 1, 5), // Libyan battalion
  'IT MG (bb)': INF(8, 5, 7, 2), // machine-gun battalion
  'IT inf (y)': INF(8, 4, 6, 6),
  'IT inf (z)': INF(8, 2, 7, 5),
  'IT inf (aa)': INF(8, 2, 3, 3),
  'IT mot inf (n)': INF(25, 4, 3, 6),
  'IT inf (s)': INF(10, 3, 3, 7, { arm: 2 }),
  'CW inf (h)': INF(15, 2, 2, 5),
  'CW inf (k)': INF(10, 2, 2, 7),
  'CW inf (q)': INF(10, 1, 1, 6),
  'CW MG (u)': INF(8, 4, 6, 3),
  'DE inf': { ...INF(10, 2, 2, 7), provisional: true },
};

export const weapon = (name) => {
  const w = WEAPONS[name];
  if (!w) throw new Error(`Unknown weapon system: ${name}`);
  return w;
};
