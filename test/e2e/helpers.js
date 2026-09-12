// Shared helpers for the browser tier (PLN-04, TEC-13).
//
// Every assertion in `test/e2e/*.spec.js` goes through `CH.grid()` and `CH.state`, so these
// helpers only do three things: boot the page, deliver input the way TEC-11 describes it
// (`event.code` for the numpad, real mouse pixels computed from the canvas rect and the cell
// size), and turn the returned cell buffer into strings a test can read.

/** UI-01's grid, so a helper never has to ask the page for its dimensions. */
export const COLS = 80;
export const ROWS = 30;

/** UI-02's regions. */
export const MAP_W = 60;
export const MAP_H = 24;
export const PANEL_TEXT_X = 61;
export const INSPECT_ROW = 24;
export const LOG_ROW = 25;
export const LOG_ROWS = 5;

/** UI-01 / UI-08's default cell background. */
export const BG = '#0c0c10';

/**
 * Load the page and wait for the boot to install `window.CH`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{clear?: boolean}} [opts] `clear: false` keeps `localStorage` across the load, which is
 *        what the TEC-09 reload tests need.
 */
export async function boot(page, opts = {}) {
  if (opts.clear !== false) {
    await page.addInitScript(() => {
      try {
        window.localStorage.clear();
      } catch {
        /* a browser with storage disabled still boots (TEC-09) */
      }
    });
  }
  await page.goto('/index.html');
  await page.waitForFunction(() => window.CH && typeof window.CH.grid === 'function');
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** Start a run on a fixed seed and dismiss the SCR-02 intro text box (UI-17). */
export async function newRun(page, seed = 'TEST1234') {
  await page.evaluate((s) => window.CH.newRun(s), seed);
  await dismiss(page);
}

/** Dismiss whatever blocking box is open, if one is (UI-16: "any key"). */
export async function dismiss(page) {
  await key(page, 'Enter');
}

/** Dispatch one keydown exactly as TEC-11 reads it: `code` for the numpad, `key` for letters. */
/**
 * UI-17: the Death / Victory screen ignores input for its grace period after it opens, so the
 * keystroke that ended the run cannot dismiss the summary before it is read. The grace is one
 * `app.later` timer and it is the only thing animating on that screen, so TEC-14's `CH.timers()`
 * reaching 0 is exactly "the screen will now accept a key" — and waiting on it beats sleeping for a
 * duration the test would have to keep in step with `GRACE_MS`.
 */
export async function waitForSummaryInput(page) {
  await page.waitForFunction(() => window.CH.timers() === 0, null, { timeout: 5000 });
}

export async function key(page, code, options = {}) {
  const data = {
    code,
    key: options.key === undefined ? keyForCode(code) : options.key,
    shiftKey: options.shift === true,
  };
  await page.evaluate((ev) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { ...ev, bubbles: true, cancelable: true }));
  }, data);
}

/** Dispatch a keyup, for the Shift-run release rule (TEC-11). */
export async function keyUp(page, code, options = {}) {
  const data = { code, key: options.key === undefined ? keyForCode(code) : options.key };
  await page.evaluate((ev) => {
    window.dispatchEvent(new KeyboardEvent('keyup', { ...ev, bubbles: true, cancelable: true }));
  }, data);
}

/** Type a letter or punctuation key the way a US keyboard reports it. */
export async function press(page, character, options = {}) {
  await key(page, codeForCharacter(character), { ...options, key: character });
}

const NAMED_KEYS = {
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
  Space: ' ',
};

function keyForCode(code) {
  if (NAMED_KEYS[code]) return NAMED_KEYS[code];
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) return numpad[1];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  return code;
}

/** The `event.code` a US keyboard reports for a printable character. */
export function codeForCharacter(ch) {
  if (/^[a-z]$/.test(ch)) return `Key${ch.toUpperCase()}`;
  if (/^[A-Z]$/.test(ch)) return `Key${ch}`;
  if (/^[0-9]$/.test(ch)) return `Digit${ch}`;
  const punctuation = {
    '.': 'Period', ',': 'Comma', '?': 'Slash', '<': 'Comma', '/': 'Slash', ' ': 'Space',
  };
  return punctuation[ch] || 'Unidentified';
}

/** The last rendered 80 x 30 buffer (TEC-13). */
export async function grid(page) {
  return page.evaluate(() => window.CH.grid());
}

/** One row of the buffer as a string. */
export function rowText(g, y) {
  return g[y].map((c) => c.glyph).join('');
}

/** The whole buffer as one newline-joined string, for "does the screen say X" assertions. */
export function screenText(g) {
  return g.map((row) => row.map((c) => c.glyph).join('')).join('\n');
}

/** UI-05's inspect line, trimmed of its padding. */
export async function inspectText(page) {
  const g = await grid(page);
  return rowText(g, INSPECT_ROW).trimEnd();
}

/** UI-04's five log rows, oldest first, blanks dropped. */
export async function logRows(page) {
  const g = await grid(page);
  const out = [];
  for (let i = 0; i < LOG_ROWS; i++) {
    const text = rowText(g, LOG_ROW + i).trimEnd();
    if (text.length > 0) out.push(text);
  }
  return out;
}

/** `CH.state`, or a slice of it. */
export async function state(page) {
  return page.evaluate(() => window.CH.state);
}

/** Where a grid cell is on the page, in CSS pixels (UI-01's pixel-to-cell mapping, inverted). */
export async function cellCenter(page, x, y) {
  return page.evaluate(({ cx, cy }) => {
    const canvas = document.getElementById('game');
    const rect = canvas.getBoundingClientRect();
    const m = window.CH.metrics();
    return {
      x: rect.left + m.originX + (cx + 0.5) * m.cellW,
      y: rect.top + m.originY + (cy + 0.5) * m.cellH,
    };
  }, { cx: x, cy: y });
}

/** Move the real mouse over a cell (UI-13's hover row). */
export async function hoverCell(page, x, y) {
  const at = await cellCenter(page, x, y);
  await page.mouse.move(at.x, at.y);
}

/** Click a cell with the real mouse (UI-13). */
export async function clickCell(page, x, y, options = {}) {
  const at = await cellCenter(page, x, y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y, { button: options.button || 'left' });
}

/** How many timers are live (TEC-14's idle check, through TEC-13's hook). */
export async function timers(page) {
  return page.evaluate(() => window.CH.timers());
}

/** One engine action through TEC-13's `CH.act`. */
export async function act(page, action) {
  return page.evaluate((a) => {
    const result = window.CH.act(a);
    return { ok: result.ok, reason: result.reason };
  }, action);
}

/** Repeat `{type:'wait'}` until a predicate holds or the budget runs out. */
export async function actUntil(page, action, predicateName, limit = 400) {
  return page.evaluate(({ a, name, max }) => {
    for (let i = 0; i < max; i++) {
      const s = window.CH.state;
      if (name === 'dead' && s.dead) return i;
      if (name === 'victory' && s.victory) return i;
      const result = window.CH.act(a);
      if (!result.ok && result.reason === 'ended') return i;
    }
    return -1;
  }, { a: action, name: predicateName, max: limit });
}

/** Load a fixture map through TEC-13's hook (the loader lives under `test/fixtures`). */
export async function loadFixture(page, rows, opts = {}) {
  return page.evaluate(({ r, o }) => window.CH.loadFixture(r, o), { r: rows, o: opts });
}

/** An empty room fixture: a walled box with Tick in it, and whatever else the caller writes. */
export function room(lines, opts = {}) {
  return { rows: lines, opts };
}

/** The engine events the UI has consumed since the last drain (TEC-13). */
export async function events(page) {
  return page.evaluate(() => window.CH.events().map((e) => ({ ...e })));
}

/** A wall-and-floor map of the given size with Tick at `(tx, ty)` and no enemies. */
export function emptyMap(tx = 5, ty = 5, width = 40, height = 16) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row += edge ? '#' : '.';
    }
    rows.push(row);
  }
  const row = rows[ty];
  rows[ty] = `${row.slice(0, tx)}T${row.slice(tx + 1)}`;
  return rows;
}

/** Put a character on an ASCII map. */
export function put(rows, x, y, ch) {
  const copy = rows.slice();
  copy[y] = `${copy[y].slice(0, x)}${ch}${copy[y].slice(x + 1)}`;
  return copy;
}

/**
 * Break `kills` one-Integrity dormant Sweepers, one fixture at a time, to reach a level (CHR-06:
 * 3 XP each; CHR-07's thresholds are 10 / 25 / 45). Each Sweeper starts adjacent and dormant, so
 * one hit ends it and ENM-03's "woke this turn does not act" keeps Tick untouched.
 */
export async function gainXp(page, kills) {
  return page.evaluate(async (n) => {
    const rows = [];
    for (let y = 0; y < 9; y++) {
      let row = '';
      for (let x = 0; x < 20; x++) row += (x === 0 || y === 0 || x === 19 || y === 8) ? '#' : '.';
      rows.push(row);
    }
    rows[4] = `${rows[4].slice(0, 5)}Ts${rows[4].slice(7)}`;
    for (let i = 0; i < n; i++) {
      await window.CH.loadFixture(rows, {
        number: 1,
        enemies: { s: { type: 'Sweeper', integrity: 1, state: 'DORMANT' } },
      });
      for (let k = 0; k < 20; k++) {
        if (window.CH.state.floor.enemies.length === 0) break;
        window.CH.act({ type: 'move', dx: 1, dy: 0 });
      }
    }
    const t = window.CH.state.tick;
    return { xp: t.xp, level: t.level, skillPoints: t.skillPoints };
  }, kills);
}

/** Wait `{type:'wait'}` until Tick's Tension reaches `target` (CHR-04's decay), or give up. */
export async function waitToTension(page, target, limit = 900) {
  return page.evaluate(({ t, max }) => {
    for (let i = 0; i < max; i++) {
      if (window.CH.state.tick.tension <= t) return window.CH.state.tick.tension;
      const r = window.CH.act({ type: 'wait' });
      if (!r.ok) return -1;
    }
    return -1;
  }, { t: target, max: limit });
}

/** The total number of messages the player has read, merges expanded (UI-04). */
export async function logCount(page) {
  return page.evaluate(() => window.CH.state.log.reduce((n, l) => n + l.count, 0));
}

/** The raw save text under TEC-09's key, or null. */
export async function savedText(page) {
  return page.evaluate(() => window.localStorage.getItem('clockworkHollow.save.v1'));
}

/**
 * A one-tile-wide east-west corridor with Tick at its western end, so a travel has exactly one
 * route and every tile on it is walked (UI-13's stop conditions are then exact).
 */
export function corridor(length = 16, tx = 2, ty = 6) {
  const rows = [];
  const width = tx + length + 2;
  for (let y = 0; y < 14; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const inCorridor = y === ty && x > 0 && x < width - 1;
      row += inCorridor ? '.' : '#';
    }
    rows.push(row);
  }
  rows[ty] = `${rows[ty].slice(0, tx)}T${rows[ty].slice(tx + 1)}`;
  return rows;
}

/** Box-drawing characters, which sit between text and its neighbours in the buffer. */
const BOX_CHARS = /[┌┐└┘─│]/g;

/**
 * The whole buffer as one line: box borders removed and whitespace collapsed, so a sentence that
 * the renderer wrapped across rows of a full-width box reads as one string.
 */
export function flatten(g) {
  return g.map((row) => row.map((c) => c.glyph).join(''))
    .join(' ')
    .replace(BOX_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One rectangle of the buffer as a single collapsed line. Needed for a box that is narrower than
 * the grid (UI-16's 56 x 20 text box), where a whole-row join would interleave the side panel.
 */
export function regionText(g, x0, y0, x1, y1) {
  const rows = [];
  for (let y = y0; y <= y1; y++) rows.push(g[y].slice(x0, x1 + 1).map((c) => c.glyph).join(''));
  return rows.join(' ').replace(BOX_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/** UI-16's text box: the interior of the 56 x 20 box centered over the map. */
export function textboxText(g) {
  return regionText(g, 3, 3, 57, 20);
}
