// Every column of every d66 table must cover all 36 results exactly once —
// this catches transcription mistakes from the printed charts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  D66, _raw, CA_ATTACKER_LOSS, CA_DEFENDER_LOSS, BARRAGE, MORALE_TABLE, antiArmourRow, antiArmourDamage,
  caColumnForDifferential, moraleModifier, orgSizeShift,
} from '../src/shared/tables.js';

function checkPartition(name, rows, ncols) {
  for (let c = 0; c < ncols; c++) {
    const seen = new Map();
    for (const [label, cells] of rows) {
      for (const v of _raw.parseRange(cells[c])) {
        assert.ok(!seen.has(v), `${name} column ${c}: ${v} appears in both ${seen.get(v)} and ${label}`);
        seen.set(v, label);
      }
    }
    assert.equal(seen.size, 36, `${name} column ${c} covers ${seen.size}/36 results`);
  }
}

test('close assault table columns each cover all 36 results once', () => {
  checkPartition('attacker', _raw.ATTACKER_LOSS_ROWS, 18);
  checkPartition('defender', _raw.DEFENDER_LOSS_ROWS, 18);
  assert.equal(Object.keys(CA_ATTACKER_LOSS[0]).length, 36);
});

test('barrage table columns each cover all 36 results once', () => {
  for (const [k, rows] of Object.entries(_raw.BARRAGE_ROWS)) checkPartition(`barrage/${k}`, rows, 9);
  assert.equal(BARRAGE.infantry[0][11], 'none');
  assert.equal(BARRAGE.infantry[8][66], '2');
});

test('morale table rows each cover all 36 results once', () => {
  for (const [lvl, map] of Object.entries(MORALE_TABLE)) assert.equal(Object.keys(map).length, 36, `cohesion ${lvl}`);
  // Worked example from the rules: cohesion -4, roll 42 -> -2.
  assert.equal(moraleModifier(-4, 42), -2);
  // Example from 15.64: cohesion +2, roll 63 -> no change.
  assert.equal(moraleModifier(2, 63), 0);
  assert.equal(moraleModifier(-30, 11), 'SURR');
});

test('anti-armour table matches the rules example', () => {
  // 14.43: five Actual points, roll 35 -> 7 damage points.
  assert.equal(antiArmourDamage(antiArmourRow(35), 5), 7);
  assert.equal(antiArmourDamage(antiArmourRow(11), 0), 0);
  assert.equal(antiArmourDamage(antiArmourRow(66), 16), 32);
  for (const v of D66) assert.ok(antiArmourRow(v) >= 0);
});

test('close assault columns and organisation shifts', () => {
  assert.equal(caColumnForDifferential(-20), 0);
  assert.equal(caColumnForDifferential(0), 7);
  assert.equal(caColumnForDifferential(6), 12);
  assert.equal(caColumnForDifferential(40), 17);
  // Rules example 15.73: attacker at +3 rolling 34 takes 5% losses.
  assert.equal(CA_ATTACKER_LOSS[caColumnForDifferential(3)][34], 5);
  // Defender at +3 rolling 12 takes 20%.
  assert.equal(CA_DEFENDER_LOSS[caColumnForDifferential(3)][12], 20);
  assert.equal(orgSizeShift(5, 1), 4);
  assert.equal(orgSizeShift(2, 2), 0);
});
