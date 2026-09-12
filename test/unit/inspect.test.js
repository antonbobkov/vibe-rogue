// The inspect popup (UI-11, ITM-05, CAT-01, CAT-05).
//
// UI-11's box is `POPUP_W` wide and grows to its content, so after TEC-10 word wrap at
// `POPUP_W - 4` it has `POPUP_H - 2` lines of interior and `createInspectScreen` drops any line
// past it. Every string these tests guard is prose that someone will want to lengthen one day; the
// point of the budget tests is that CI says so instead of the text vanishing on screen.
//
// The budget used to be checked for items only, and the enemy popup — the tallest of the three, and
// the one a player reads most — was never measured. It had overflowed for twelve of the sixteen
// bestiary entries: `ENM-11`'s seven stat lines, a blank and a three-line description come to
// eleven rows against the ten a 12-cell box allowed, so every one of them lost the last line of its
// description with nothing on screen to say so. Hence `enemyPopup` is measured here too.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ITEMS, WEAPON_SPECIAL_TEXT, ATTACHMENT_SPECIAL_TEXT, WEAPON_SPECIALS, ATTACHMENT_SPECIALS }
  from '../../data/items.js';
import { STACK_MAX } from '../../src/items.js';
import { ENEMIES } from '../../data/enemies.js';
import { itemPopup, enemyPopup, specialLines, categoryName, POPUP_W, POPUP_H }
  from '../../src/screens/inspect.js';
import { wrap } from '../../src/render.js';
import { fixtureGame } from '../fixtures/maps.js';

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

test('@m10 @unit inspect: the popup names ITM-01 kinds, never the internal category id', () => {
  // `instant` and `record` are ids the player meets nowhere else — a record goes to the Journal.
  const IDS = new Set(['melee', 'ranged', 'plating', 'attachment', 'instant', 'throwable', 'record']);
  const seen = new Set();
  for (const def of ITEMS) {
    const label = categoryName(def);
    assert.ok(!IDS.has(label), `${def.name}: popup shows the raw id "${label}"`);
    assert.equal(label, label[0].toUpperCase() + label.slice(1), `${def.name}: "${label}" not capitalised`);
    assert.equal(wrapped(def.name)[0], label, `${def.name}: kind is not the popup's first line`);
    seen.add(label);
  }
  assert.deepEqual([...seen].sort(), [
    'Attachment', 'Blueprint', 'Consumable', 'Journal page',
    'Melee weapon', 'Plating', 'Ranged weapon', 'Throwable',
  ]);
});

test('@m10 @unit inspect: no item popup overflows the UI-11 box', () => {
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

test('@m10 @unit inspect: no enemy popup overflows the UI-11 box, Overwound included', () => {
  // One enemy of each type, stood next to Tick on a bare room so the popup prints its live lines
  // (ENM-11's State, Statuses and the damage range all read the actual instance).
  const rows = ['#####', '#T e#', '#####'];
  const over = [];
  for (const type of ENEMIES) {
    for (const elite of [false, true]) {
      if (elite && type.boss) continue; // ENM-12: bosses are never Overwound
      const game = fixtureGame(rows, { enemies: { e: { type: type.name, state: 'ACTIVE', elite } } });
      const enemy = game.state.floor.enemies[0];
      assert.ok(enemy, `${type.name}: the fixture placed no enemy`);
      const lines = enemyPopup(game, enemy).lines.flatMap((line) => wrap(line, WRAP_W));
      if (lines.length > INTERIOR) {
        over.push(`${type.name}${elite ? ' (Overwound)' : ''}: ${lines.length} lines`);
      }
    }
  }
  assert.deepEqual(over, [], `these popups lose their last line(s) — budget ${INTERIOR}`);
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
