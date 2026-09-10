// Key and mouse maps (UI-10..UI-13). Pure: every function here takes plain event data
// (`{code, key, shiftKey}`) or cell coordinates and returns a description of what the player asked
// for. `main.js` owns the listeners and the timers (PLN-02 R2), so nothing in this module touches
// the DOM and nothing here mutates game state.
//
// TEC-11: `event.code` distinguishes `Numpad1..9` from `Digit1..4`; `event.key` carries the letters
// and punctuation (`?`, `<`, `,`, `.`).

import { COLS, MAP_W, MAP_H, PANEL_X, PANEL_TEXT_X, PANEL_W, INSPECT_ROW, LOG_ROW, LOG_ROWS } from './render.js';

/** UI-10's eight directions, by the letter that moves in them. */
export const LETTER_DIRS = Object.freeze({
  y: Object.freeze({ dx: -1, dy: -1 }),
  k: Object.freeze({ dx: 0, dy: -1 }),
  u: Object.freeze({ dx: 1, dy: -1 }),
  h: Object.freeze({ dx: -1, dy: 0 }),
  l: Object.freeze({ dx: 1, dy: 0 }),
  b: Object.freeze({ dx: -1, dy: 1 }),
  j: Object.freeze({ dx: 0, dy: 1 }),
  n: Object.freeze({ dx: 1, dy: 1 }),
});

/** UI-10's numpad directions, by `event.code` (TEC-11). */
export const NUMPAD_DIRS = Object.freeze({
  Numpad7: Object.freeze({ dx: -1, dy: -1 }),
  Numpad8: Object.freeze({ dx: 0, dy: -1 }),
  Numpad9: Object.freeze({ dx: 1, dy: -1 }),
  Numpad4: Object.freeze({ dx: -1, dy: 0 }),
  Numpad6: Object.freeze({ dx: 1, dy: 0 }),
  Numpad1: Object.freeze({ dx: -1, dy: 1 }),
  Numpad2: Object.freeze({ dx: 0, dy: 1 }),
  Numpad3: Object.freeze({ dx: 1, dy: 1 }),
});

/** The arrow keys, by `event.code`. */
export const ARROW_DIRS = Object.freeze({
  ArrowUp: Object.freeze({ dx: 0, dy: -1 }),
  ArrowDown: Object.freeze({ dx: 0, dy: 1 }),
  ArrowLeft: Object.freeze({ dx: -1, dy: 0 }),
  ArrowRight: Object.freeze({ dx: 1, dy: 0 }),
});

/** UI-12: Shift + direction moves the look cursor 5 cells instead of 1. */
export const LOOK_FAR = 5;

/**
 * The direction a key names, or null. Numpad and arrows are read from `event.code`; the eight
 * `vi` letters from `event.key`, case-sensitively as UI-10 writes them.
 *
 * @param {{code?: string, key?: string}} ev
 * @returns {{dx: number, dy: number, numpad: boolean, arrow: boolean}|null}
 */
export function directionOf(ev) {
  if (!ev) return null;
  const code = ev.code || '';
  if (NUMPAD_DIRS[code]) return { ...NUMPAD_DIRS[code], numpad: true, arrow: false };
  if (ARROW_DIRS[code]) return { ...ARROW_DIRS[code], numpad: false, arrow: true };
  const key = ev.key || '';
  if (LETTER_DIRS[key]) return { ...LETTER_DIRS[key], numpad: false, arrow: false };
  return null;
}

/** UI-10: `.`, numpad `5` and `z` all Wait. */
export function isWaitKey(ev) {
  if (!ev) return false;
  return ev.code === 'Numpad5' || ev.key === '.' || ev.key === 'z';
}

/** UI-10: the skill hotkeys are `Digit1..4` — never the numpad, whatever NumLock is doing. */
export function skillSlotOf(ev) {
  if (!ev) return null;
  const m = /^Digit([1-4])$/.exec(ev.code || '');
  return m ? Number(m[1]) : null;
}

/**
 * The Run screen's key table (UI-10). Returns a UI intent, not an engine action: `main.js` turns
 * the ones that need a target into a targeting mode first.
 *
 * Intents:
 *   {type:'move', dx, dy}        {type:'run', dx, dy}      {type:'wait'}
 *   {type:'pickup'}              {type:'interact'}         {type:'ascend'}
 *   {type:'closeDoor'}           {type:'fire'}             {type:'throw'}
 *   {type:'skill', slot}         {type:'screen', id}       {type:'look'}
 *   {type:'cancel'}
 *
 * @param {{code?: string, key?: string, shiftKey?: boolean}} ev
 * @returns {object|null} null when the key is not bound
 */
export function runIntent(ev) {
  if (!ev) return null;
  if (ev.key === 'Escape') return { type: 'cancel' };

  const slot = skillSlotOf(ev);
  if (slot !== null) return { type: 'skill', slot };

  const dir = directionOf(ev);
  if (dir) {
    // UI-10: Shift + direction repeats the move until something interesting happens.
    return ev.shiftKey ? { type: 'run', dx: dir.dx, dy: dir.dy } : { type: 'move', dx: dir.dx, dy: dir.dy };
  }
  if (isWaitKey(ev)) return { type: 'wait' };

  switch (ev.key) {
    case 'g':
    case ',':
      return { type: 'pickup' };
    case 'e':
      return { type: 'interact' };
    case '<':
      return { type: 'ascend' };
    case 'c':
      return { type: 'closeDoor' };
    case 'f':
      return { type: 'fire' };
    case 't':
      return { type: 'throw' };
    case 'i':
      return { type: 'screen', id: 'inventory' };
    case 's':
      return { type: 'screen', id: 'skills' };
    case 'r':
      return { type: 'screen', id: 'journal' };
    case 'm':
      return { type: 'screen', id: 'history' };
    case '?':
      return { type: 'screen', id: 'help' };
    case 'x':
      return { type: 'look' };
    default:
      return null;
  }
}

/**
 * Look and targeting mode (UI-12).
 *
 * Intents: {type:'cursor', dx, dy, step} · {type:'confirm'} · {type:'cancel'} ·
 *          {type:'popup'} · {type:'cycle', dir} · {type:'exit'}
 *
 * @param {{code?: string, key?: string, shiftKey?: boolean}} ev
 * @param {{mode: 'look'|'target', openKey?: string}} [opts] `openKey` is UI-12's "the same key that
 *        opened targeting confirms"
 */
export function cursorIntent(ev, opts = {}) {
  if (!ev) return null;
  if (ev.key === 'Escape') return { type: 'cancel' };
  if (ev.key === 'Tab') return { type: 'cycle', dir: ev.shiftKey ? -1 : 1 };
  const dir = directionOf(ev);
  if (dir) return { type: 'cursor', dx: dir.dx, dy: dir.dy, step: ev.shiftKey ? LOOK_FAR : 1 };
  if (ev.key === 'Enter') return opts.mode === 'look' ? { type: 'popup' } : { type: 'confirm' };
  if (opts.mode === 'look' && ev.key === 'x') return { type: 'cancel' };
  if (opts.openKey && ev.key === opts.openKey) return { type: 'confirm' };
  return null;
}

/**
 * A list screen's navigation keys (UI-14, UI-15, UI-17 menus).
 *
 * Intents: {type:'moveSelection', delta} · {type:'confirm'} · {type:'cancel'} ·
 *          {type:'page', delta} · {type:'letter', letter}
 */
export function listIntent(ev) {
  if (!ev) return null;
  if (ev.key === 'Escape') return { type: 'cancel' };
  if (ev.key === 'Enter') return { type: 'confirm' };
  if (ev.code === 'ArrowUp' || ev.code === 'Numpad8') return { type: 'moveSelection', delta: -1 };
  if (ev.code === 'ArrowDown' || ev.code === 'Numpad2') return { type: 'moveSelection', delta: 1 };
  if (ev.code === 'ArrowLeft' || ev.code === 'Numpad4') return { type: 'moveSelection', delta: -1, axis: 'x' };
  if (ev.code === 'ArrowRight' || ev.code === 'Numpad6') return { type: 'moveSelection', delta: 1, axis: 'x' };
  if (ev.key === 'PageUp') return { type: 'page', delta: -1 };
  if (ev.key === 'PageDown') return { type: 'page', delta: 1 };
  if (typeof ev.key === 'string' && ev.key.length === 1) return { type: 'letter', letter: ev.key };
  return null;
}

/** UI-16: the scroll keys of the History, Help, Journal-page and text-box screens. */
export function scrollIntent(ev) {
  if (!ev) return null;
  if (ev.code === 'ArrowUp' || ev.code === 'Numpad8') return { type: 'scroll', delta: -1 };
  if (ev.code === 'ArrowDown' || ev.code === 'Numpad2') return { type: 'scroll', delta: 1 };
  if (ev.key === 'PageUp') return { type: 'scroll', page: -1 };
  if (ev.key === 'PageDown') return { type: 'scroll', page: 1 };
  if (ev.key === 'Home') return { type: 'scrollTo', to: 'start' };
  if (ev.key === 'End') return { type: 'scrollTo', to: 'end' };
  return null;
}

/** TEC-07 / UI-17: a printable character for the seed input (max 16, "any printable"). */
export function seedChar(ev) {
  if (!ev || typeof ev.key !== 'string' || ev.key.length !== 1) return null;
  const code = ev.key.charCodeAt(0);
  return code >= 0x20 && code !== 0x7f ? ev.key : null;
}

/** UI-17's `y`/`n` prompts (Abandon, "Take *Name*?"). */
export function yesNo(ev) {
  if (!ev || typeof ev.key !== 'string') return null;
  const k = ev.key.toLowerCase();
  if (k === 'y') return true;
  if (k === 'n' || ev.key === 'Escape') return false;
  return null;
}

// ---------------------------------------------------------------------------------------------
// UI-13 — the mouse
// ---------------------------------------------------------------------------------------------

/** UI-02's regions, for a cell the mouse is over. */
export const REGION = Object.freeze({
  MAP: 'map',
  SEPARATOR: 'separator',
  PANEL: 'panel',
  INSPECT: 'inspect',
  LOG: 'log',
  NONE: 'none',
});

/**
 * Which UI-02 region a grid cell belongs to.
 *
 * @param {{x: number, y: number}|null} cell
 * @returns {{region: string, x: number, y: number, row?: number}}
 */
export function regionOf(cell) {
  if (!cell) return { region: REGION.NONE, x: -1, y: -1 };
  const { x, y } = cell;
  if (y < MAP_H) {
    if (x < MAP_W) return { region: REGION.MAP, x, y };
    if (x === PANEL_X) return { region: REGION.SEPARATOR, x, y };
    return { region: REGION.PANEL, x, y, row: y };
  }
  if (y === INSPECT_ROW) return { region: REGION.INSPECT, x, y };
  if (y >= LOG_ROW && y < LOG_ROW + LOG_ROWS) return { region: REGION.LOG, x, y };
  return { region: REGION.NONE, x, y };
}

/** UI-03 rows 18-21: which skill hotkey a panel row is, or null. */
export function panelSkillRow(row) {
  return row >= 18 && row <= 21 ? row - 17 : null;
}

/**
 * UI-03 rows 22-23: the bracketed clickable tokens and the columns they occupy.
 * `[i]nv  [s]kills` on row 22 and `[r]ead  [m]sg  [?]` on row 23, laid out from column 61.
 */
export const PANEL_BUTTONS = Object.freeze([
  Object.freeze({ row: 22, text: '[i]nv', screen: 'inventory', col: PANEL_TEXT_X, width: 5 }),
  Object.freeze({ row: 22, text: '[s]kills', screen: 'skills', col: PANEL_TEXT_X + 7, width: 8 }),
  Object.freeze({ row: 23, text: '[r]ead', screen: 'journal', col: PANEL_TEXT_X, width: 6 }),
  Object.freeze({ row: 23, text: '[m]sg', screen: 'history', col: PANEL_TEXT_X + 8, width: 5 }),
  Object.freeze({ row: 23, text: '[?]', screen: 'help', col: PANEL_TEXT_X + 15, width: 3 }),
]);

/** The screen a click on a panel button opens, or null. */
export function panelButtonAt(x, y) {
  for (const b of PANEL_BUTTONS) {
    if (b.row === y && x >= b.col && x < b.col + b.width) return b;
  }
  return null;
}

/** The panel's stat rows, for UI-11's "hovering a side-panel stat shows its breakdown". */
export const PANEL_STAT_ROWS = Object.freeze({
  1: 'integrity',
  2: 'integrity',
  3: 'tension',
  4: 'tension',
  6: 'decay',
  8: 'attributes',
  9: 'accuracy',
});

/** The panel row a hover is on, translated to the stat it explains, or null. */
export function panelStatAt(y) {
  return PANEL_STAT_ROWS[y] || null;
}

/**
 * UI-13's left-click table, as far as it can be decided from geometry alone. `main.js` resolves the
 * map cases against the state (adjacent enemy, own tile, walkable, …).
 *
 * @param {{x: number, y: number}|null} cell
 * @param {{button?: number}} [ev]
 */
export function clickTarget(cell, ev = {}) {
  const at = regionOf(cell);
  const right = ev.button === 2;
  switch (at.region) {
    case REGION.MAP:
      return { kind: right ? 'inspect' : 'map', x: at.x, y: at.y };
    case REGION.PANEL: {
      if (right) {
        const stat = panelStatAt(at.y);
        return stat ? { kind: 'panelStat', stat } : { kind: 'none' };
      }
      const button = panelButtonAt(at.x, at.y);
      if (button) return { kind: 'screen', id: button.screen };
      const slot = panelSkillRow(at.y);
      if (slot !== null) return { kind: 'skill', slot };
      const stat = panelStatAt(at.y);
      return stat ? { kind: 'panelStat', stat } : { kind: 'none' };
    }
    case REGION.LOG:
      // UI-13: a click on the log rows opens the Message History screen.
      return right ? { kind: 'none' } : { kind: 'screen', id: 'history' };
    default:
      return { kind: 'none' };
  }
}

export { COLS, MAP_W, MAP_H, PANEL_X, PANEL_TEXT_X, PANEL_W, INSPECT_ROW, LOG_ROW, LOG_ROWS };
