// The Commonwealth Mediterranean Fleet [30.0, 30.6].
// The rulebook gives names and classes, but the Gun and AA Ratings are printed on counters we do not have.
// Stand-in ratings follow the examples in 30.12 and 30.34: a battleship has Gun 6 and AA 12, a heavy cruiser Gun 4,
// and AA is twice the Gun Rating. Light ships are set at Gun 2 (cruisers) and 1 (destroyers).
export const SHIP_CLASSES = {
  BB: { label: 'Battleship', gun: 6, heavy: true },
  CA: { label: 'Heavy cruiser', gun: 4, heavy: true },
  CL: { label: 'Light cruiser', gun: 2 },
  CLAA: { label: 'AA cruiser', gun: 2, aaBonus: 2 },
  DD: { label: 'Destroyer', gun: 1 },
};
// [name, class, Game-Turn, Operations Stage] the ship joins the fleet [30.6].
export const SHIP_SCHEDULE = [
  ['Valiant', 'BB', 1, 1], ['Arethusa', 'CL', 1, 1], ['Dido', 'CLAA', 1, 1], ['Euryalus', 'CLAA', 1, 1],
  ['Airedale', 'DD', 1, 1], ['Bedouin', 'DD', 1, 1], ['Jervis', 'DD', 1, 1], ['Lance', 'DD', 1, 1], ['Ledbury', 'DD', 1, 1], ['Mohawk', 'DD', 1, 1], ['Nubian', 'DD', 1, 1],
  ['Barham', 'BB', 8, 3], ['York', 'CA', 8, 3], ['Ajax', 'CA', 8, 3], ['Marne', 'DD', 8, 3], ['Partridge', 'DD', 8, 3],
  ['Queen Elizabeth', 'BB', 33, 1], ['Fiji', 'CA', 33, 1], ['Naiad', 'CLAA', 33, 1],
];
export const FLEET_RANGE = 100; // sea hexes from Alexandria [30.15]
// House rule: Axis U-boats arrive in the Mediterranean in the autumn of 1941 (Game-Turn 100).
export const UBOATS = [['U-331', 100], ['U-81', 100], ['U-559', 104]];

export const aaOf = (ship) => ship.gun * (2 + (ship.aaBonus || 0)); // AA is twice the Gun Rating (more for AA cruisers) [30.13]
export const heavy = (ship) => !!SHIP_CLASSES[ship.cls].heavy;

export function createFleet() {
  return {
    ships: SHIP_SCHEDULE.map(([name, cls, turn, stage], i) => ({
      id: `sh${i + 1}`, name, cls, max: SHIP_CLASSES[cls].gun, gun: SHIP_CLASSES[cls].gun, aaBonus: SHIP_CLASSES[cls].aaBonus || 0,
      turn, stage, joined: false, where: 'alex', hex: null, seaStages: 0, rest: 0, repair: 0, spent: false, sunk: false,
    })),
    uboats: UBOATS.map(([name, turn], i) => ({ id: `u${i + 1}`, name, turn, joined: false, lost: false, rest: 0, patrol: null })),
  };
}
