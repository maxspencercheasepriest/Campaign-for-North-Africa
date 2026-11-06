// Important locations [Summary of Important Locations, map section A].
// city = Major City, port = Port, garrison = has an assigned garrison, victory = scenario victory location.
// side = who holds it at the start of the 1940 scenarios (Libya: Axis, Egypt: Commonwealth).
// capacity = PLACEHOLDER port throughput until the Port Capacity chart (55.3) is entered.
import { hexFromName } from './hexnames.js';

const L = (id, name, hexes, flags, side, capacity = 0) => ({
  id, name, hexes: hexes.map(hexFromName), hexNames: hexes, side, capacity,
  city: flags.includes('C'), port: flags.includes('P'), garrison: flags.includes('G'), victory: flags.includes('V'),
});

export const LOCATIONS = [
  L('aboukir', 'Aboukir', ['E3815'], 'P', 'cw', 0.2),
  L('agedabia', 'Agedabia', ['A2629'], 'V', 'axis'),
  L('alexandria', 'Alexandria', ['E3613', 'E3714'], 'CPV', 'cw', 1.0),
  L('bardia', 'Bardia', ['C4321'], 'CPGV', 'axis', 0.25),
  L('benghazi', 'Benghazi', ['A4827'], 'CPV', 'axis', 0.6),
  L('benina', 'Benina', ['A4829'], 'G', 'axis'),
  L('scheferzen', 'Bir Scheferzen', ['C3419'], 'G', 'axis'),
  L('cairo', 'Cairo', ['E1730', 'E1829', 'E1830', 'E1930', 'E1931'], 'CV', 'cw'),
  L('derna', 'Derna', ['B5925'], 'PGV', 'axis', 0.25),
  L('agheila', 'el Agheila', ['A1816'], 'V', 'axis'),
  L('grein', 'el Grein', ['C1715'], 'G', 'axis'),
  L('maddalena', 'Fort Maddalena', ['C3019'], 'GV', 'axis'),
  L('giarabub', 'Giarabub', ['C1014'], 'GV', 'axis'),
  L('halfaya', 'Halfaya Pass', ['C3922', 'C3821'], 'V', 'cw'),
  L('helwan', 'Helwan', ['E1430'], 'C', 'cw'),
  L('jalo', 'Jalo', ['B0513'], 'V', 'axis'),
  L('marblearch', 'Marble Arch', ['A2109'], 'V', 'axis'),
  L('mechili', 'Mechili', ['B4921'], 'G', 'axis'),
  L('brega', 'Mersa Brega', ['A2021'], 'V', 'axis'),
  L('matruh', 'Mersa Matruh', ['D3714'], 'PGV', 'cw', 0.35),
  L('nofilia', 'Nofilia', ['A2703'], 'P', 'axis', 0.1),
  L('raselali', 'Ras el Ali', ['A2010'], 'P', 'axis', 0.1),
  L('rosetta', 'Rosetta', ['E4019'], 'P', 'cw', 0.1),
  L('barrani', 'Sidi Barrani', ['C4131'], 'V', 'cw'),
  L('sidiomar', 'Sidi Omar', ['C3618'], 'V', 'axis'),
  L('siwa', 'Siwa', ['C0127'], 'V', 'cw'),
  L('sollum', 'Sollum', ['C4021'], 'PV', 'cw', 0.15),
  L('soluch', 'Soluch', ['A4130'], 'G', 'axis'),
  L('tobruk', 'Tobruk', ['C4807'], 'CPGV', 'axis', 0.5),
  L('zuetina', 'Zuetina', ['A2928'], 'P', 'axis', 0.1),
];
