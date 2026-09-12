// The inspect popup (UI-11, ITM-05, CAT-01, CAT-05).
//
// UI-11 fixes the box at "max 40 x 12 cells", so after TEC-10 word wrap at `POPUP_W - 4` an item
// popup has exactly `POPUP_H - 2` lines of interior and `createInspectScreen` drops any line past
// it *silently*. Every string these tests guard is prose that someone will want to lengthen one
// day; the point of the budget test is that CI says so instead of the text vanishing on screen.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ITEMS, WEAPON_SPECIAL_TEXT, ATTACHMENT_SPECIAL_TEXT, WEAPON_SPECIALS, ATTACHMENT_SPECIALS }
  from '../../data/items.js';
import { STACK_MAX } from '../../src/items.js';
import { itemPopup, specialLines, POPUP_W, POPUP_H } from '../../src/screens/inspect.js';
import { wrap } from '../../src/render.js';

const TICK = Object.freeze({ level: 1, skills: [], integrity: 60, integrityMax: 60, tension: 100 });
const WRAP_W = POPUP_W - 4;
const INTERIOR = POPUP_H - 2;

/** The popup as `createInspectScreen` lays it out: every line wrapped, in order. */
function wrapped(name, wear = 0) {
  return itemPopup({ name, count: 1, wear }, TICK).lines.flatMap((line) => wrap(line, WRAP_W));
}

test('@m10 @unit inspect: ITM-05 gives every special its CAT-01 prose, not just the token', () => {
  // The failure this replaces: the tables existed and nothing imported them, so the popup showed
  // `rend` and never said what Rend does — against OVR-02's "no secret formulas".
  for (const def of ITEMS) {
    const lines = specialLines(def);
    if (!def.special) {
      assert.deepEqual(lines, [], `${def.name} has no special and must add no lines`);
      continue;
    }
    const text = lines.join(' ');
    assert.ok(text.length > 0, `${def.name}: special ${def.special} explained nowhere`);
    if (def.category === 'attachment') {
      assert.equal(lines.length, 1);
      assert.equal(lines[0], ATTACHMENT_SPECIAL_TEXT[def.special]);
    } else {
      const entry = WEAPON_SPECIAL_TEXT[def.special];
      assert.equal(lines[0], `${entry.name} (${entry.trigger})`);
      assert.equal(lines[1], entry.effect);
    }
    // And the prose actually reaches the popup.
    assert.ok(wrapped(def.name).join(' ').includes(lines[0].slice(0, 20)), `${def.name}: not in popup`);
  }
});

test('@m10 @unit inspect: every CAT-01 and CAT-05 special id has prose written for it', () => {
  for (const id of WEAPON_SPECIALS) {
    const entry = WEAPON_SPECIAL_TEXT[id];
    assert.ok(entry && entry.name && entry.trigger && entry.effect, `WEAPON_SPECIAL_TEXT missing ${id}`);
  }
  for (const id of ATTACHMENT_SPECIALS) {
    assert.ok(ATTACHMENT_SPECIAL_TEXT[id], `ATTACHMENT_SPECIAL_TEXT missing ${id}`);
  }
});

test('@m10 @unit inspect: no item popup overflows UI-11 max 40 x 12 box', () => {
  const over = [];
  for (const def of ITEMS) {
    const n = wrapped(def.name).length;
    if (n > INTERIOR) over.push(`${def.name}: ${n} lines`);
    // A worn plate also prints the CMB-14 arithmetic, which is the longest its fields line gets.
    if (def.category === 'plating') {
      const worn = wrapped(def.name, 2).length;
      if (worn > INTERIOR) over.push(`${def.name} (worn): ${worn} lines`);
    }
  }
  assert.deepEqual(over, [], `these popups lose their last line(s) silently — budget ${INTERIOR}`);
});

test('@m10 @unit inspect: a stacked consumable popup still fits with its Count row', () => {
  // ITM-03: only consumables stack, to `tuning.stackMax` (DIF-04).
  const stackable = ITEMS.filter((d) => d.category === 'instant' || d.category === 'throwable');
  assert.ok(stackable.length > 0, 'expected some stacking items');
  for (const def of stackable) {
    const lines = itemPopup({ name: def.name, count: STACK_MAX, wear: 0 }, TICK)
      .lines.flatMap((line) => wrap(line, WRAP_W));
    assert.ok(lines[0].startsWith('Count '), `${def.name}: Count row missing`);
    assert.ok(lines.length <= INTERIOR, `${def.name}: ${lines.length} lines over ${INTERIOR}`);
  }
});
