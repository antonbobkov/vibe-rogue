// The Help screen (UI-16, SCR-09): "full-screen static list of every key in UI-10, UI-12, UI-14,
// and a 6-line summary of the core rules (Tension decay, no regen, stations, permadeath). Text
// in `24`."
//
// The six rule lines come from `data/script.js` verbatim (`SCRIPT.help`). The key list is
// "generated from `UI-10`" (SCR-09), so the key rows are transcribed here from the UI-10, UI-12
// and UI-14 tables — they are UI content, not `24` content (D-086).
//
// Longer than 30 rows, so it scrolls with the UI-16 scroll keys.

import { COLS, ROWS, BG, write, fit, center, wrap } from '../render.js';
import { scrollIntent } from '../input.js';
import { SCRIPT } from '../../data/script.js';

export const KEY_X = 1;
export const ACTION_X = 32;
export const FIRST_ROW = 1;
export const FOOTER_ROW = ROWS - 1;
export const VISIBLE_ROWS = FOOTER_ROW - FIRST_ROW;

/** UI-10's key table, verbatim in its order. */
export const RUN_KEYS = Object.freeze([
  ['Arrows, numpad 1-9, hjklyubn', 'Move in the 8 directions'],
  ['. or numpad 5 or z', 'Wait'],
  ['g or ,', 'Pick up'],
  ['e', 'Interact (station / stairs)'],
  ['<', 'Ascend (only on stairs)'],
  ['c then a direction', 'Close door (Esc cancels; free)'],
  ['f', 'Fire ranged weapon (targeting)'],
  ['t', 'Throw (letter list, then targeting)'],
  ['1 2 3 4', 'Use the active skill in that slot'],
  ['i', 'Inventory screen'],
  ['s', 'Skills screen'],
  ['r', 'Journal (read) screen'],
  ['x', 'Look mode'],
  ['m', 'Message history screen'],
  ['?', 'Help screen'],
  ['Esc', 'Cancel a mode; else the Pause menu'],
  ['Shift + direction', 'Repeat the Move until something happens'],
]);

/** UI-12's look and targeting keys. */
export const CURSOR_KEYS = Object.freeze([
  ['Directions', 'Move the cursor 1 cell'],
  ['Shift + direction', 'Move the cursor 5 cells'],
  ['Enter', 'Inspect popup (look) / confirm (targeting)'],
  ['Tab, Shift+Tab', 'Cycle visible enemies by distance'],
  ['Esc', 'Leave; targeting spends no turn'],
]);

/** UI-14's inventory keys. */
export const INVENTORY_KEYS = Object.freeze([
  ['a-j, W, P, A', 'Select an inventory or equipped item'],
  ['Up / Down', 'Select'],
  ['e', 'Equip, or unequip an equipped item'],
  ['u', 'Use'],
  ['t', 'Throw'],
  ['d', 'Drop'],
]);

/** UI-11 / UI-13's mouse table, in one block. */
export const MOUSE_KEYS = Object.freeze([
  ['Hover', 'Updates the inspect line'],
  ['Left-click a tile', 'Travel there; adjacent enemy: attack'],
  ['Left-click your tile', 'Pick up, else interact, else wait'],
  ['Right-click', 'Inspect popup'],
  ['Click the log', 'Message history'],
  ['Wheel', 'Scroll a scrolling screen'],
]);

/** Every row of the screen, in order: `{heading}` or `{keys, action}` or `{text}` or blank. */
export function helpLines() {
  const out = [];
  const block = (heading, rows) => {
    out.push({ heading });
    for (const [keys, action] of rows) out.push({ keys, action });
    out.push({});
  };
  block('RUN SCREEN', RUN_KEYS);
  block('LOOK AND TARGETING', CURSOR_KEYS);
  block('INVENTORY', INVENTORY_KEYS);
  block('MOUSE', MOUSE_KEYS);
  out.push({ heading: 'THE RULES' });
  // SCR-09's six lines run up to 90 characters, so they wrap rather than truncate: ACC-120 wants
  // them "verbatim", which a `…` would break (D-094).
  for (const line of SCRIPT.help) {
    wrap(line, COLS - 4).forEach((part, i) => out.push({ text: i === 0 ? part : ` ${part}` }));
  }
  return out;
}

export function createHelpScreen(app) {
  const lines = helpLines();
  const maxScroll = Math.max(0, lines.length - VISIBLE_ROWS);
  let scroll = 0;

  function close() {
    app.pop();
    return true;
  }

  const screen = {
    id: 'help',
    opaque: true,
    free: true,

    draw(buf) {
      write(buf, KEY_X, 0, 'HELP', 'brass', BG, 20);
      write(buf, COLS - 21, 0, '(? / Esc to close)', 'midGrey', BG, 20);
      for (let i = 0; i < VISIBLE_ROWS; i++) {
        const row = lines[scroll + i];
        if (!row) break;
        const y = FIRST_ROW + i;
        if (row.heading) {
          write(buf, KEY_X, y, fit(row.heading, COLS - 2), 'brass', BG);
        } else if (row.text) {
          write(buf, KEY_X + 1, y, fit(row.text, COLS - 3), 'lightGrey', BG);
        } else if (row.keys) {
          write(buf, KEY_X + 1, y, fit(row.keys, ACTION_X - KEY_X - 2), 'steel', BG);
          write(buf, ACTION_X, y, fit(row.action, COLS - ACTION_X - 1), 'lightGrey', BG);
        }
      }
      const hint = scroll < maxScroll ? '— more (↓ PgDn End) —' : '';
      if (hint) write(buf, 0, FOOTER_ROW, center(hint, COLS), 'midGrey', BG, COLS);
    },

    onKey(ev) {
      if (ev.key === 'Escape' || ev.key === '?') return close();
      const intent = scrollIntent(ev);
      if (!intent) return true;
      if (intent.to === 'start') scroll = 0;
      else if (intent.to === 'end') scroll = maxScroll;
      else scroll += intent.page ? intent.page * VISIBLE_ROWS : intent.delta;
      scroll = Math.max(0, Math.min(maxScroll, scroll));
      app.markDirty();
      return true;
    },

    onMouse() {
      return close();
    },

    onWheel(ev) {
      scroll = Math.max(0, Math.min(maxScroll, scroll + ev.delta));
      app.markDirty();
    },
  };

  return screen;
}
