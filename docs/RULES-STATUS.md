# Rules implementation status

This checklist tracks which parts of the rules are in the game. Section numbers follow the original rulebook, so you can look each one up. Our code and wording are our own.

Legend: ✅ implemented · 🟡 partly or simplified · ⬜ not started · 🔶 placeholder (stand-in rules until the real ones are written)

## Land Game

| § | Section | Status | Notes |
|---|---|---|---|
| 5 | Sequence of play | ✅ | Game-Turn = Initiative Stage → Naval Convoy Stage → 3 Operations Stages. In each stage Player A goes, then Player B. Phases not built yet are skipped. |
| 6 | Capability Points and Cohesion | ✅ | CP tracked per Ops Stage. Each point over the CPA becomes a Disorganisation Point. Resting restores up to +5 (never above 0). A cleared hex gives +3. 30% losses cost −3. At −26 a unit can't act and surrenders when approached. Not yet: cohesion averaging across stacks (6.27–6.28), and its effect on morale. |
| 7 | Initiative | ✅ | Die roll + rating from chart 7.2 (by date, Rommel, German presence). The holder chooses first or last in each stage. The scenario can fix the holder for GT1. |
| 8.1–8.4 | Land movement and terrain | ✅ | Full Terrain Effects Chart: hex costs (motorised / non-motorised), roads, tracks, hexsides (slopes, ridges, escarpments up/down, wadis, rivers) and prohibitions. Foot units are capped at 150% of CPA. Breakdown points accumulate. Not yet: off-road markers, road stacking (9.33), rainstorm wadis, rule 8.19 (Marble Arch line). |
| 8.2 | Continual movement | ✅ | Repeated move → combat segments. Units that end a segment more than 2 hexes from the enemy are frozen for the rest of the phase. |
| 8.5 | Reaction | ⬜ | |
| 8.6 | Breaking off | ✅ | Contact costs 2 CP and Engaged costs 4. Engaged results come from the Close Assault table. |
| 8.7 | Rail movement | ⬜ | |
| 8.8–8.9 | Tripoli/Tunisia, motorised units and trucks | ⬜ | |
| 9 | Stacking | 🟡 | Stacking points (division 5, brigade 2, battalion 1, company 0) against each terrain's limit. Not yet: unit equivalents and shells (9.2), road/track limit (9.33). |
| 10 | Zones of control | ✅ | Who exerts a ZOC, including the 10-raw-point defensive minimum. ZOCs don't reach across escarpments, rivers or the sea, or into hexes the unit couldn't enter. Units stop on entry, can't move ZOC-to-ZOC, and a friendly unit in the hex negates the ZOC. Every enemy hex exerting a ZOC must be attacked. Not yet: holding-off barrage, the 3-hex retreat (10.36). |
| 11 | Combat system | ✅ | Units are made of weapon-system TOE points with real ratings. Raw × rating ÷ 10 = actual points, rounded. CP: 5 to attack (2 to probe), 3 to defend (1 if hopeless), capped per segment. |
| 12 | Barrage | 🟡 | Barrage table (12.6) with target classes and terrain shifts. Forward guns combine (Italians only within a hex); Back guns fire separately. Results pin or destroy one battalion-sized target. Not yet: truck rolls, facility barrage, holding-off barrage. |
| 13 | Retreat before assault | ⬜ | The defender's choice, waiting on interactive defender decisions. |
| 14 | Anti-armour combat | 🟡 | Anti-armour table (14.6): column shifts for the phasing player, terrain and hexsides. Damage is absorbed by armour protection, and a quarter of the anti-armour points are reassigned to assault when there's no armour. Not yet: destroyed-tank markers, capture and repair. |
| 15 | Close assault | ✅ | The full Close Assault table (15.79), using each side's sequential and summed rolls. Losses come from raw points; gun vulnerability, overrun, captures (15.89), retreats (10% per hex not taken, cities exempt), Engaged, combined arms, 2:1 raw, organisation size, terrain and hexside shifts, probes and surrender cases are all in. The defender's withholding and gun positions are automatic for now. |
| 16 | Patrols and reconnaissance | ⬜ | Fog of war is a simple 3-hex sight range for now. |
| 17 | Morale | 🟡 | Morale Modifier table (17.4), the largest-unit rule, ±3 cap, surrender (and good troops ignoring it), Rommel +1. Not yet: training (17.3). |
| 18 | Reserve status | ⬜ | |
| 19 | Organisation and reorganisation | ⬜ | Needs the Organisation-at-Arrival data. |
| 20 | Reinforcements, replacements, withdrawals | 🟡 | A few reinforcements arrive. Needs the real schedules. |
| 21–22 | Breakdown and repair | 🟡 | Breakdown points are counted but not yet rolled. |
| 23–26 | Engineers, construction, fortifications, minefields | ⬜ | Minefield and fortification terrain costs are in the chart data. |
| 27 | Desert raiders and commandos | ⬜ | |
| 28 | Prisoners | ⬜ | |
| 29 | Weather | ⬜ | |
| 30 | Mediterranean Fleet | ⬜ | |
| 31 | Rommel | 🟡 | His presence raises Axis initiative. |
| 32 | Abstract logistics and air | 🔶 | Placeholder air points, convoys, trucking and end-of-turn supply. |

## Air Game (33–46) and Logistics Game (47–58)

All ⬜ for now. The placeholder air step and supply rules stand in for them.

## Scenarios (59–64)

| Scenario | Status |
|---|---|
| 60.22 Graziani's Offensive (GT1–6) | 🟡 Turn limits, GT1 initiative, formation-level deployment hexes (60.31, 60.41) and initial dumps (60.34, 60.44) are in. Not yet: battalion-level setup, trucks, air and fleet setup, victory conditions (60.71). |

## Notes on the charts

Every column of every dice table is checked automatically to cover all 36 results exactly once (`test/tables.test.js`). That check turned up four printed entries in the scan that can't be right. Each has been corrected to the only reading that fits its column, and each correction is commented in `src/shared/tables.js`:

- Close Assault, attacker, column −2, 20% losses: printed 13-18, read as 13-16.
- Close Assault, defender, column +2, 5% losses: printed 41-52, read as 34-52.
- Close Assault, defender, column +4, 10% losses: printed 24-45, read as 34-45.
- Morale Modifier, cohesion −4, −2 column: printed 42-55, read as 42-56.

## Data still to enter

- **Map:** 🟡 all five sections are digitised automatically by `tools/map/` (OCR of hex numbers → grid fit → colour classification of each hex and hexside). That gives about 7,000 hexes and about 2,000 hexside features, and the game uses the board's hex numbers (Tobruk = C4807). Known weak spots: the coast road is mostly read as a track; hexes split between two terrains take whichever covers the centre; villages, oases, airfields and minefields aren't read yet. Fixes go in `src/shared/mapfixes.js`.
- **Units:** the Organisation-at-Arrival charts. Italian and Commonwealth weapon ratings are entered; German ones are provisional. Scenario units are built from real weapon types but with approximate compositions.
- **Reinforcement and withdrawal schedules.**
