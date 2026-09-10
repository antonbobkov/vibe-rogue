// `src/input.js` — the UI-10 key table and the UI-13 mouse table, as pure functions over plain
// event data. R2 keeps this module free of the DOM, so it is a node unit test.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LETTER_DIRS, NUMPAD_DIRS, ARROW_DIRS, LOOK_FAR, REGION, PANEL_BUTTONS, PANEL_STAT_ROWS,
  directionOf, isWaitKey, skillSlotOf, runIntent, cursorIntent, listIntent, scrollIntent,
  seedChar, yesNo, regionOf, panelSkillRow, panelButtonAt, panelStatAt, clickTarget,
  MAP_W, MAP_H, PANEL_X, PANEL_TEXT_X, INSPECT_ROW, LOG_ROW,
} from '../../src/input.js';

const ev = (code, key, shiftKey = false) => ({ code, key, shiftKey });

test('@m10 @unit input: UI-10 gives the eight directions three spellings each', () => {
  // "y ↖ k ↑ u ↗ h ← l → b ↙ j ↓ n ↘".
  assert.deepEqual(LETTER_DIRS.y, { dx: -1, dy: -1 });
  assert.deepEqual(LETTER_DIRS.k, { dx: 0, dy: -1 });
  assert.deepEqual(LETTER_DIRS.u, { dx: 1, dy: -1 });
  assert.deepEqual(LETTER_DIRS.h, { dx: -1, dy: 0 });
  assert.deepEqual(LETTER_DIRS.l, { dx: 1, dy: 0 });
  assert.deepEqual(LETTER_DIRS.b, { dx: -1, dy: 1 });
  assert.deepEqual(LETTER_DIRS.j, { dx: 0, dy: 1 });
  assert.deepEqual(LETTER_DIRS.n, { dx: 1, dy: 1 });
  assert.equal(Object.keys(LETTER_DIRS).length, 8);

  // The numpad is laid out as the key pad is: 7 8 9 / 4 . 6 / 1 2 3.
  assert.deepEqual(NUMPAD_DIRS.Numpad7, { dx: -1, dy: -1 });
  assert.deepEqual(NUMPAD_DIRS.Numpad2, { dx: 0, dy: 1 });
  assert.deepEqual(NUMPAD_DIRS.Numpad3, { dx: 1, dy: 1 });
  assert.equal(Object.keys(NUMPAD_DIRS).length, 8);
  assert.equal(NUMPAD_DIRS.Numpad5, undefined);

  assert.equal(Object.keys(ARROW_DIRS).length, 4);
  assert.equal(LOOK_FAR, 5);
});

test('@m10 @unit input: TEC-11 reads the numpad from code and the letters from key', () => {
  // NumLock off or on, `Numpad1` is a move and `Digit1` never is.
  assert.deepEqual(directionOf(ev('Numpad1', '1')), { dx: -1, dy: 1, numpad: true, arrow: false });
  assert.deepEqual(directionOf(ev('Numpad1', 'End')), { dx: -1, dy: 1, numpad: true, arrow: false });
  assert.equal(directionOf(ev('Digit1', '1')), null);
  assert.deepEqual(directionOf(ev('ArrowUp', 'ArrowUp')), { dx: 0, dy: -1, numpad: false, arrow: true });
  assert.deepEqual(directionOf(ev('KeyH', 'h')), { dx: -1, dy: 0, numpad: false, arrow: false });
  // "All keys are case-sensitive letters as shown" (UI-10).
  assert.equal(directionOf(ev('KeyH', 'H')), null);
  assert.equal(directionOf(null), null);

  assert.equal(skillSlotOf(ev('Digit1', '1')), 1);
  assert.equal(skillSlotOf(ev('Digit4', '4')), 4);
  assert.equal(skillSlotOf(ev('Digit5', '5')), null);
  assert.equal(skillSlotOf(ev('Numpad1', '1')), null);

  // UI-10: "`.`, numpad `5`, `z` | Wait".
  assert.equal(isWaitKey(ev('Period', '.')), true);
  assert.equal(isWaitKey(ev('Numpad5', '5')), true);
  assert.equal(isWaitKey(ev('KeyZ', 'z')), true);
  assert.equal(isWaitKey(ev('KeyX', 'x')), false);
});

test('@m10 @unit input: the Run screen key table maps every UI-10 row to an intent', () => {
  assert.deepEqual(runIntent(ev('Numpad3', '3')), { type: 'move', dx: 1, dy: 1 });
  // "Shift + direction | Repeat Move in that direction".
  assert.deepEqual(runIntent(ev('ArrowRight', 'ArrowRight', true)), { type: 'run', dx: 1, dy: 0 });
  assert.deepEqual(runIntent(ev('Digit2', '2')), { type: 'skill', slot: 2 });
  assert.deepEqual(runIntent(ev('Period', '.')), { type: 'wait' });
  assert.deepEqual(runIntent(ev('KeyG', 'g')), { type: 'pickup' });
  assert.deepEqual(runIntent(ev('Comma', ',')), { type: 'pickup' });
  assert.deepEqual(runIntent(ev('KeyE', 'e')), { type: 'interact' });
  assert.deepEqual(runIntent(ev('Comma', '<')), { type: 'ascend' });
  assert.deepEqual(runIntent(ev('KeyC', 'c')), { type: 'closeDoor' });
  assert.deepEqual(runIntent(ev('KeyF', 'f')), { type: 'fire' });
  assert.deepEqual(runIntent(ev('KeyT', 't')), { type: 'throw' });
  assert.deepEqual(runIntent(ev('KeyI', 'i')), { type: 'screen', id: 'inventory' });
  assert.deepEqual(runIntent(ev('KeyS', 's')), { type: 'screen', id: 'skills' });
  assert.deepEqual(runIntent(ev('KeyR', 'r')), { type: 'screen', id: 'journal' });
  assert.deepEqual(runIntent(ev('KeyM', 'm')), { type: 'screen', id: 'history' });
  assert.deepEqual(runIntent(ev('Slash', '?')), { type: 'screen', id: 'help' });
  assert.deepEqual(runIntent(ev('KeyX', 'x')), { type: 'look' });
  assert.deepEqual(runIntent(ev('Escape', 'Escape')), { type: 'cancel' });
  // An unbound key is null, so `main.js` can leave the browser's own default alone.
  assert.equal(runIntent(ev('KeyQ', 'q')), null);
  assert.equal(runIntent(null), null);
});

test('@m10 @unit input: UI-12 look and targeting keys', () => {
  assert.deepEqual(cursorIntent(ev('ArrowLeft', 'ArrowLeft'), { mode: 'look' }),
    { type: 'cursor', dx: -1, dy: 0, step: 1 });
  // "Shift + direction: 5 cells".
  assert.deepEqual(cursorIntent(ev('ArrowLeft', 'ArrowLeft', true), { mode: 'look' }),
    { type: 'cursor', dx: -1, dy: 0, step: LOOK_FAR });
  // "`Enter` opens the popup" in look mode; in targeting it confirms.
  assert.deepEqual(cursorIntent(ev('Enter', 'Enter'), { mode: 'look' }), { type: 'popup' });
  assert.deepEqual(cursorIntent(ev('Enter', 'Enter'), { mode: 'target' }), { type: 'confirm' });
  // "`Tab` / `Shift+Tab` cycle through visible enemies by distance".
  assert.deepEqual(cursorIntent(ev('Tab', 'Tab'), { mode: 'target' }), { type: 'cycle', dir: 1 });
  assert.deepEqual(cursorIntent(ev('Tab', 'Tab', true), { mode: 'target' }), { type: 'cycle', dir: -1 });
  // "`Esc` exits" / "cancels with no turn spent".
  assert.deepEqual(cursorIntent(ev('Escape', 'Escape'), { mode: 'target' }), { type: 'cancel' });
  // "`x`" leaves look mode, and "the same key that opened targeting confirms".
  assert.deepEqual(cursorIntent(ev('KeyX', 'x'), { mode: 'look' }), { type: 'cancel' });
  assert.deepEqual(cursorIntent(ev('KeyF', 'f'), { mode: 'target', openKey: 'f' }), { type: 'confirm' });
  assert.equal(cursorIntent(ev('KeyQ', 'q'), { mode: 'target' }), null);
});

test('@m10 @unit input: the list, scroll, seed and yes/no readers', () => {
  assert.deepEqual(listIntent(ev('ArrowUp', 'ArrowUp')), { type: 'moveSelection', delta: -1 });
  assert.deepEqual(listIntent(ev('ArrowDown', 'ArrowDown')), { type: 'moveSelection', delta: 1 });
  assert.deepEqual(listIntent(ev('ArrowRight', 'ArrowRight')), { type: 'moveSelection', delta: 1, axis: 'x' });
  assert.deepEqual(listIntent(ev('Enter', 'Enter')), { type: 'confirm' });
  assert.deepEqual(listIntent(ev('Escape', 'Escape')), { type: 'cancel' });
  assert.deepEqual(listIntent(ev('KeyB', 'b')), { type: 'letter', letter: 'b' });
  assert.deepEqual(listIntent(ev('KeyW', 'W')), { type: 'letter', letter: 'W' });

  assert.deepEqual(scrollIntent(ev('ArrowDown', 'ArrowDown')), { type: 'scroll', delta: 1 });
  assert.deepEqual(scrollIntent(ev('PageUp', 'PageUp')), { type: 'scroll', page: -1 });
  assert.deepEqual(scrollIntent(ev('End', 'End')), { type: 'scrollTo', to: 'end' });
  assert.deepEqual(scrollIntent(ev('Home', 'Home')), { type: 'scrollTo', to: 'start' });
  // Anything that is not a scroll key is null, so a text box can dismiss on it (UI-16, D-087).
  assert.equal(scrollIntent(ev('Enter', 'Enter')), null);
  assert.equal(scrollIntent(ev('KeyA', 'a')), null);

  // TEC-07 / UI-17: "any printable" character goes into the seed input.
  assert.equal(seedChar(ev('KeyA', 'a')), 'a');
  assert.equal(seedChar(ev('Digit1', '1')), '1');
  assert.equal(seedChar(ev('Space', ' ')), ' ');
  assert.equal(seedChar(ev('Enter', 'Enter')), null);
  assert.equal(seedChar(ev('Escape', 'Escape')), null);

  assert.equal(yesNo(ev('KeyY', 'y')), true);
  assert.equal(yesNo(ev('KeyY', 'Y')), true);
  assert.equal(yesNo(ev('KeyN', 'n')), false);
  assert.equal(yesNo(ev('Escape', 'Escape')), false);
  assert.equal(yesNo(ev('KeyQ', 'q')), null);
});

test('@m10 @unit input: UI-02 regions and UI-03 clickable rows', () => {
  assert.equal(regionOf({ x: 0, y: 0 }).region, REGION.MAP);
  assert.equal(regionOf({ x: MAP_W - 1, y: MAP_H - 1 }).region, REGION.MAP);
  assert.equal(regionOf({ x: PANEL_X, y: 0 }).region, REGION.SEPARATOR);
  assert.equal(regionOf({ x: PANEL_TEXT_X, y: 3 }).region, REGION.PANEL);
  assert.equal(regionOf({ x: 0, y: INSPECT_ROW }).region, REGION.INSPECT);
  assert.equal(regionOf({ x: 0, y: LOG_ROW }).region, REGION.LOG);
  assert.equal(regionOf({ x: 0, y: 29 }).region, REGION.LOG);
  assert.equal(regionOf(null).region, REGION.NONE);

  // UI-03 rows 18-21 are the four skill hotkeys.
  assert.equal(panelSkillRow(17), null);
  assert.equal(panelSkillRow(18), 1);
  assert.equal(panelSkillRow(21), 4);
  assert.equal(panelSkillRow(22), null);

  // UI-03 rows 22-23: `[i]nv  [s]kills` and `[r]ead  [m]sg  [?]`.
  assert.equal(PANEL_BUTTONS.length, 5);
  assert.equal(panelButtonAt(PANEL_TEXT_X, 22).screen, 'inventory');
  assert.equal(panelButtonAt(PANEL_TEXT_X + 7, 22).screen, 'skills');
  assert.equal(panelButtonAt(PANEL_TEXT_X, 23).screen, 'journal');
  assert.equal(panelButtonAt(PANEL_TEXT_X + 8, 23).screen, 'history');
  assert.equal(panelButtonAt(PANEL_TEXT_X + 15, 23).screen, 'help');
  assert.equal(panelButtonAt(PANEL_TEXT_X + 6, 22), null);

  // UI-11: hovering a side-panel stat explains it.
  assert.equal(panelStatAt(1), 'integrity');
  assert.equal(panelStatAt(4), 'tension');
  assert.equal(panelStatAt(9), 'accuracy');
  assert.equal(panelStatAt(7), null);
  assert.equal(Object.keys(PANEL_STAT_ROWS).length, 7);
});

test('@m10 @unit input: UI-13 click targets are decided by geometry alone', () => {
  assert.deepEqual(clickTarget({ x: 5, y: 5 }, { button: 0 }), { kind: 'map', x: 5, y: 5 });
  // "Right-click | Any map cell | Inspect popup".
  assert.deepEqual(clickTarget({ x: 5, y: 5 }, { button: 2 }), { kind: 'inspect', x: 5, y: 5 });
  // "Left-click | Panel row 18-21 | Use that skill".
  assert.deepEqual(clickTarget({ x: 70, y: 19 }, { button: 0 }), { kind: 'skill', slot: 2 });
  // "Left-click | Panel rows 22-23 tokens | Open Inventory / Skills / ...".
  assert.deepEqual(clickTarget({ x: PANEL_TEXT_X + 1, y: 22 }, { button: 0 }),
    { kind: 'screen', id: 'inventory' });
  // "Left-click | Log rows | Open Message History".
  assert.deepEqual(clickTarget({ x: 10, y: LOG_ROW + 2 }, { button: 0 }),
    { kind: 'screen', id: 'history' });
  assert.deepEqual(clickTarget({ x: 10, y: INSPECT_ROW }, { button: 0 }), { kind: 'none' });
  assert.deepEqual(clickTarget(null, { button: 0 }), { kind: 'none' });
  // A right-click on a stat row explains it; on a button row it does nothing.
  assert.deepEqual(clickTarget({ x: 65, y: 3 }, { button: 2 }), { kind: 'panelStat', stat: 'tension' });
  assert.deepEqual(clickTarget({ x: 65, y: 22 }, { button: 2 }), { kind: 'none' });
});
