// Optional in-game tutorial. Pure content: the client decides when and where to show it.

export const BASICS = [
  {
    title: 'The campaign',
    body: [
      'Two teams run the desert war: the Axis (Italians, later the Germans) and the Commonwealth. Each side has up to five staff seats; any seat nobody fills is covered by your Commander-in-Chief.',
      'Each Game-Turn is one week. A turn has a Naval Convoy Stage, then three Operations Stages. Look at the top bar: it always tells you the date, the stage and who is acting.',
      'The scenario ends on its last Game-Turn and is scored on the objectives held (see the Supply tab).',
    ],
  },
  {
    title: 'Reading the map',
    body: [
      'Drag to pan and use the wheel to zoom. Hover any hex for its terrain, movement costs and anything in it. Click one of your counters to select it; click again to cycle through a stack.',
      'You can only see enemy units within a few hexes of your own (fog of war). Tinted hexes show weather: tan for sandstorm, blue for rainstorm. Small squares are supply units.',
    ],
  },
  {
    title: 'Sequence of play',
    body: [
      '1. Convoy: the Axis plans convoys from Tripoli and picks the Operations Stage each lands in; Commonwealth supply arrives by itself.',
      '2. Initiative: the holder chooses to move first (Player A) or last (Player B) in each Operations Stage.',
      '3. Movement & Combat: Player A moves and fights, then Player B does. Within a phase you alternate movement and combat segments.',
      '4. Truck Convoy: supply units move.',
      'Then the next Operations Stage begins; after the third, the Game-Turn ends.',
    ],
  },
  {
    title: 'Capability Points and cohesion',
    body: [
      'Every unit has a Capability Point Allowance (CPA). Moving costs CP by terrain; roads are cheap, rough ground and sand are dear. An assault costs the attacker 5 CP.',
      'Spending past your allowance is allowed (up to 50% for most units) but each CP over costs cohesion. Low cohesion hurts in combat; at -26 a unit cannot move or fight. Resting restores some cohesion.',
      'Entering an enemy zone of control (the hexes next to an enemy) ends a move, and you may not go straight from one enemy zone to another.',
    ],
  },
  {
    title: 'Supply',
    body: [
      'Supply units hold Ammunition and Fuel. A unit draws from supply units within half its CPA, by the route a truck would take, and never through enemy zones of control.',
      'Fuel is paid once per Operations Stage by motorised units. Ammunition is paid when you attack or defend. A unit that cannot be supplied cannot move (fuel) or attack (ammo), and an unsupplied defender may surrender.',
      'An enemy combat unit entering a hex captures any supply units there, so keep them behind your line. The Supply tab lists what each of your units can reach.',
    ],
  },
  {
    title: 'Combat in brief',
    body: [
      'Select your attackers in the combat list, tick them against a target, and choose options (forward artillery, anti-armour role, probe). The defender then chooses dispositions; the defender may try to retreat before the assault.',
      'Combat runs barrage, then anti-armour, then close assault. Results cost steps (strength) and cohesion, and may force retreats or surrender.',
      'Units in an enemy zone of control at the end of movement must attack in the combat segment if able; the game lists these obligations for you.',
    ],
  },
];

// What to do right now, for the step the game is in.
export function stepHelp(game, { side, canAct }) {
  const out = (title, body) => ({ title, body });
  if (!game) return out('Waiting', ['The campaign has not started yet.']);
  if (game.over) return out('Scenario over', ['The scenario has finished. Check the log for how it ended.']);
  const watch = canAct === false ? ['It is not your seat\'s turn to act here. Watch the log, and advise whoever is acting through staff chat.'] : [];
  switch (game.step) {
    case 'convoy':
      if (side === 'cw') return out('Naval Convoy Stage', ['Commonwealth supply arrives by itself in Cairo and Alexandria, so you have nothing to order. Submit to continue.', ...watch]);
      return out('Naval Convoy Stage', [
        'Plan your convoys. Each one takes a port you hold, a lane (1-6, one convoy per lane), up to 3 supply units from Tripoli, and the Operations Stage it arrives in. On the first two turns only lanes 2, 3 and 6 are allowed.',
        'A convoy is bombed when it reaches port, using where the Commonwealth divisions are at that moment, so a later stage lets you see before you commit. Units that land appear at the port and must then be trucked forward.',
        ...watch,
      ]);
    case 'air':
      return out('Land Support Air Phase', ['Give each fighter squadron a job: offensive patrol over a target hex, defensive patrol over your own, strafing of enemy infantry, or stand by to scramble when raiders come near its base. Type the target hex as a name like C4807.', 'Fighters meet in the air before they strafe. Planes that fly need refitting, fuelling and arming again afterwards, which uses your air Stores, Fuel and Ammo.', ...watch]);
    case 'declare':
      return out('Initiative', ['The side holding the Initiative decides whether to move first (Player A) or last (Player B) this Operations Stage.', 'Going last in one stage and first in the next gives you two phases in a row.', ...watch]);
    case 'movecombat': {
      const mine = game.phasing === side;
      if (!mine) return out('Enemy phase', ['The enemy is moving and fighting. If they attack you, a panel will ask how to defend and whether to retreat before the assault. Watch the log.']);
      if (game.seg?.mode === 'combat') {
        return out('Combat segment', ['Choose a target in the list, tick the units that attack it, and press Attack. Obligations marked outstanding must be attacked before you can end the phase.', 'Units you held in Reserve can be released here (Reserve Release Segment). Press New movement segment to move again, or End phase when finished.']);
      }
      return out('Movement segment', ['Click one of your units; reachable hexes are highlighted with their CP cost. Click a hex to move there.', 'Units that start next to the enemy pay extra to break contact. When you are done, press Finish moving to go to combat.', 'Motorised units need fuel in reach of a supply unit (see the Supply tab) or they cannot move.', 'Before anything moves in the phase you may hold units back in Reserve: select a unit and press Place in Reserve. Reserve I units may shuffle one hex; release them after combat to use them later in the phase (Reserve rules, 18).']);
    }
    case 'trucks':
      return out('Truck Convoy Phase', ['Click one of your supply units (small square) and then a destination hex up to 15 CP away. Each move costs the unit 1 Fuel and it can move once per stage.', 'Move supply forward to keep your army fed, but not within reach of the enemy. Press the button to finish.', ...watch]);
    default:
      return out('Playing', ['Follow the prompts in the Orders tab.']);
  }
}
