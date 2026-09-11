// The canvas grid renderer (UI-01, UI-07..09, TEC-10).
//
// Everything the player sees is one 80 x 30 buffer of cells `{glyph, fg, bg}`. Screens
// (`src/screens/*`) compose that buffer with the primitives here; `createCanvasRenderer` paints it
// onto the canvas, sized per TEC-10, and maps pixels back to cells for the mouse (UI-13).
//
// This module and `main.js` and `src/screens/*` are the only places allowed to touch the DOM
// (PLN-02 R2). Everything above the paint call is plain string and number work, so `CH.grid()` can
// hand a test the buffer and every UI rule becomes assertable without reading pixels (TEC-13).

import { W as MAP_W, H as MAP_H } from './grid.js';
import { TILE, TILE_GLYPH, TILE_NAME, hazardActive, hazardWarning } from './tiles.js';
import { resolve, dim, background } from './palette.js';
import { enemyType } from './actors.js';
import { itemDef } from './items.js';
import { DECOY_GLYPH, DECOY_COLOR } from './skills.js';

/** UI-01: the whole game is one fixed 80 x 30 character grid. */
export const COLS = 80;
export const ROWS = 30;

/** UI-02's regions. */
export { MAP_W, MAP_H };
export const PANEL_X = 60;
export const PANEL_TEXT_X = 61;
export const PANEL_W = 19;
export const INSPECT_ROW = 24;
export const LOG_ROW = 25;
export const LOG_ROWS = 5;

/** TEC-10: cell width is 0.6 x cell height, and 10 is the smallest integer cell size. */
export const CELL_ASPECT = 0.6;
export const MIN_INTEGER_CELL = 10;

/** UI-01 / UI-08: the default cell background, and the inspect line's. */
export const BG = '#0c0c10';
export const BG_PANEL = '#14141a';

/** UI-02: column 60 is a vertical separator on every map row. */
export const SEPARATOR = '│';
export const SEPARATOR_COLOR = '#3a3a44';

/** UI-09 rule 2: remembered terrain and items are drawn at 45% brightness. */
export const REMEMBERED_FACTOR = 0.45;

/** UI-09 rule 6: the two one-frame flashes, and how long a frame is (TEC-10). */
export const FLASH_TICK_BG = '#3a1010';
export const FLASH_ENEMY_BG = '#404040';
export const FLASH_MS = 80;

/** UI-07's colors that UI-08 does not name. */
const GLYPH_COLORS = Object.freeze({
  tick: '#ffd75f',
  wall: '#6e6a5e',
  floor: '#3a3a44',
  door: '#b08a4a',
  // WLD-02 / WLD-15 (DIF-12): the brass of a Wound Lock.
  lock: '#ffd75f',
  stairs: '#f0e68c',
  stationUnspent: '#5ad0ff',
  stationSpent: '#2a4a58',
  gear: '#b0b0b0',
  ventInactive: '#704020',
  ventWarning: '#ff9040',
  ventActive: '#ffe0a0',
  ventBg: '#5a2a10',
  pendulumInactive: '#404050',
  pendulumWarning: '#a0a0ff',
  pendulumActive: '#ffffff',
  pendulumBg: '#404070',
  scrapFactor: 0.45,
  record: '#ffffff',
  chair: '#a08060',
  escapement: '#c0c0c0',
  burningBg: '#5a2a10',
  stunned: '#707070',
});

export { GLYPH_COLORS };

// ---------------------------------------------------------------------------------------------
// The cell buffer
// ---------------------------------------------------------------------------------------------

/** A fresh 80 x 30 buffer of blank cells. Rows of `{glyph, fg, bg}` — the shape `CH.grid()` returns. */
export function createBuffer() {
  const rows = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) row.push({ glyph: ' ', fg: '#c8c8c8', bg: BG });
    rows.push(row);
  }
  return rows;
}

/** Reset every cell to a blank on `bg`. */
export function clearBuffer(buf, bg = BG) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cell = buf[y][x];
      cell.glyph = ' ';
      cell.fg = '#c8c8c8';
      cell.bg = bg;
    }
  }
  return buf;
}

/** Write one cell, ignoring anything outside the grid. */
export function put(buf, x, y, glyph, fg, bg) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
  const cell = buf[y][x];
  if (glyph !== undefined && glyph !== null) cell.glyph = glyph;
  if (fg !== undefined && fg !== null) cell.fg = resolve(fg);
  if (bg !== undefined && bg !== null) cell.bg = resolve(bg);
}

/** Set a cell's background without touching its glyph (the UI-09 rule 6 flashes). */
export function setBg(buf, x, y, bg) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
  buf[y][x].bg = resolve(bg);
}

/** Write a string starting at `(x, y)`, clipped at `maxWidth` cells and at the grid edge. */
export function write(buf, x, y, text, fg, bg, maxWidth) {
  const str = String(text === null || text === undefined ? '' : text);
  const limit = maxWidth === undefined ? COLS - x : Math.min(maxWidth, COLS - x);
  for (let i = 0; i < str.length && i < limit; i++) put(buf, x + i, y, str[i], fg, bg);
  return Math.min(str.length, Math.max(0, limit));
}

/** Fill a rectangle with a glyph and colors. */
export function fillRect(buf, x, y, w, h, glyph, fg, bg) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) put(buf, x + dx, y + dy, glyph, fg, bg);
  }
}

/** UI-14 / UI-12: swap a cell's foreground and background ("inverts the cell"). */
export function invert(buf, x, y) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
  const cell = buf[y][x];
  const fg = cell.fg;
  cell.fg = cell.bg;
  cell.bg = fg;
}

/** Invert a whole row span — the selected line of a list screen (UI-14). */
export function invertRow(buf, x, y, w) {
  for (let dx = 0; dx < w; dx++) invert(buf, x + dx, y);
}

const BOX = Object.freeze({
  tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│',
});

export { BOX };

/** A single-line box with a cleared interior. Returns the interior rectangle. */
export function box(buf, x, y, w, h, fg, bg = BG_PANEL, title) {
  fillRect(buf, x, y, w, h, ' ', fg, bg);
  put(buf, x, y, BOX.tl, fg, bg);
  put(buf, x + w - 1, y, BOX.tr, fg, bg);
  put(buf, x, y + h - 1, BOX.bl, fg, bg);
  put(buf, x + w - 1, y + h - 1, BOX.br, fg, bg);
  for (let dx = 1; dx < w - 1; dx++) {
    put(buf, x + dx, y, BOX.h, fg, bg);
    put(buf, x + dx, y + h - 1, BOX.h, fg, bg);
  }
  for (let dy = 1; dy < h - 1; dy++) {
    put(buf, x, y + dy, BOX.v, fg, bg);
    put(buf, x + w - 1, y + dy, BOX.v, fg, bg);
  }
  if (title) write(buf, x + 2, y, ` ${title} `, fg, bg, w - 4);
  return { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
}

// ---------------------------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------------------------

/** Truncate with `…` (UI-03's "truncate with `…` at 17"). */
export function fit(text, width) {
  const str = String(text === null || text === undefined ? '' : text);
  if (width <= 0) return '';
  if (str.length <= width) return str;
  if (width === 1) return '…';
  return `${str.slice(0, width - 1)}…`;
}

/** Pad on the right to exactly `width`, truncating with `…` when too long. */
export function pad(text, width) {
  const str = fit(text, width);
  return str + ' '.repeat(Math.max(0, width - str.length));
}

/**
 * UI-03's two-part rows: `left` at column 0, `right` flush with column `width`, at least one space
 * between them. `left` is truncated with `…` if the pair does not fit.
 */
export function twoColumn(left, right, width) {
  const r = String(right === null || right === undefined ? '' : right);
  const room = Math.max(0, width - r.length - 1);
  const l = fit(left, room);
  return l + ' '.repeat(Math.max(1, width - l.length - r.length)) + r;
}

/** Center a string inside `width`. */
export function center(text, width) {
  const str = fit(text, width);
  const left = Math.max(0, Math.floor((width - str.length) / 2));
  return ' '.repeat(left) + str;
}

/**
 * TEC-10's word wrap: break on spaces at `width`, and break a word longer than the width.
 * `\n` starts a new line; `\n\n` (SCR-02's paragraph separator) leaves a blank line.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
export function wrap(text, width) {
  const out = [];
  const paragraphs = String(text === null || text === undefined ? '' : text).split('\n');
  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      let w = word;
      if (line.length === 0) {
        while (w.length > width) {
          out.push(w.slice(0, width));
          w = w.slice(width);
        }
        line = w;
        continue;
      }
      if (line.length + 1 + w.length <= width) {
        line += ` ${w}`;
        continue;
      }
      out.push(line);
      line = '';
      while (w.length > width) {
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

/**
 * Draw text that may contain SCR-01..07's `*emphasis*` markers, which D-023 says render in
 * `violet`. The markers are not drawn.
 *
 * @returns {number} the number of rows written
 */
export function writeMarkup(buf, x, y, line, fg, bg, width) {
  let cx = x;
  let emphasis = false;
  for (let i = 0; i < line.length && cx < x + width; i++) {
    const ch = line[i];
    if (ch === '*') {
      emphasis = !emphasis;
      continue;
    }
    put(buf, cx, y, ch, emphasis ? 'violet' : fg, bg);
    cx++;
  }
  return cx - x;
}

/** `wrap`, with the `*emphasis*` markers removed from the width calculation (D-023). */
export function wrapMarkup(text, width) {
  const marks = [];
  let plain = '';
  for (const ch of String(text === null || text === undefined ? '' : text)) {
    if (ch === '*') {
      marks.push(plain.length);
      continue;
    }
    plain += ch;
  }
  const lines = wrap(plain, width);
  // Re-insert the markers into the wrapped lines at the offsets they fell on.
  let consumed = 0;
  let markAt = 0;
  const out = [];
  for (const line of lines) {
    let rebuilt = '';
    for (let i = 0; i < line.length; i++) {
      while (markAt < marks.length && marks[markAt] === consumed + i) {
        rebuilt += '*';
        markAt++;
      }
      rebuilt += line[i];
    }
    while (markAt < marks.length && marks[markAt] === consumed + line.length) {
      rebuilt += '*';
      markAt++;
    }
    consumed += line.length;
    // Wrapping consumed the space between words; account for it so later marks line up.
    consumed += 1;
    out.push(rebuilt);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// UI-07 — glyphs and colors
// ---------------------------------------------------------------------------------------------

/** UI-07's terrain entry for a tile, given the floor's hazard cycle state. */
export function terrainStyle(tile, opts = {}) {
  switch (tile) {
    case TILE.WALL:
      return { glyph: '#', fg: GLYPH_COLORS.wall, bg: null };
    case TILE.FLOOR:
      return { glyph: '.', fg: GLYPH_COLORS.floor, bg: null };
    case TILE.DOOR_CLOSED:
      return { glyph: '+', fg: GLYPH_COLORS.door, bg: null };
    case TILE.DOOR_OPEN:
      return { glyph: "'", fg: GLYPH_COLORS.door, bg: null };
    case TILE.STAIRS_UP:
      return { glyph: '<', fg: GLYPH_COLORS.stairs, bg: null };
    case TILE.STATION:
      return {
        glyph: '&',
        fg: opts.stationSpent ? GLYPH_COLORS.stationSpent : GLYPH_COLORS.stationUnspent,
        bg: null,
      };
    case TILE.GRINDING_GEAR:
      return { glyph: '^', fg: GLYPH_COLORS.gear, bg: null };
    case TILE.STEAM_VENT:
      if (opts.active) return { glyph: '^', fg: GLYPH_COLORS.ventActive, bg: GLYPH_COLORS.ventBg };
      if (opts.warning) return { glyph: '^', fg: GLYPH_COLORS.ventWarning, bg: null };
      return { glyph: '^', fg: GLYPH_COLORS.ventInactive, bg: null };
    case TILE.PENDULUM_SWEEP:
      if (opts.active) return { glyph: '~', fg: GLYPH_COLORS.pendulumActive, bg: GLYPH_COLORS.pendulumBg };
      if (opts.warning) return { glyph: '~', fg: GLYPH_COLORS.pendulumWarning, bg: null };
      return { glyph: '~', fg: GLYPH_COLORS.pendulumInactive, bg: null };
    case TILE.CHAIR:
      return { glyph: 'h', fg: GLYPH_COLORS.chair, bg: null };
    case TILE.ESCAPEMENT:
      return { glyph: 'O', fg: GLYPH_COLORS.escapement, bg: null };
    case TILE.WOUND_LOCK:
      return { glyph: '=', fg: GLYPH_COLORS.lock, bg: null };
    default:
      return { glyph: TILE_GLYPH[tile] || ' ', fg: GLYPH_COLORS.floor, bg: null };
  }
}

/** UI-07: an item's glyph and color come from its catalog entry; records are always white `?`. */
export function itemStyle(name) {
  const def = itemDef(name);
  if (def.category === 'record') return { glyph: '?', fg: GLYPH_COLORS.record };
  return { glyph: def.glyph, fg: resolve(def.color) };
}

/** UI-07: an actor's glyph and colors, including the telegraph, Burning and Stunned overrides. */
export function actorStyle(state, actor) {
  if (actor === state.tick) {
    const style = { glyph: '@', fg: GLYPH_COLORS.tick, bg: null };
    return applyStatusStyle(style, actor);
  }
  if (actor.isDecoy) return { glyph: DECOY_GLYPH, fg: resolve(DECOY_COLOR), bg: null };
  const type = enemyType(actor);
  // UI-09 rule 4: a winding-up enemy is drawn with the telegraph colors instead of its own.
  if (isWindingUp(actor)) {
    return { glyph: type.glyph, fg: resolve('telegraph'), bg: background('telegraph') };
  }
  // UI-09 (DIF-08): an Overwound enemy keeps its glyph and color and gains a dark gold ground, so
  // it is the same thing with more of it rather than a new thing to learn.
  const bg = actor.elite === true ? ELITE_BG : null;
  return applyStatusStyle({ glyph: type.glyph, fg: resolve(type.color), bg }, actor);
}

/** UI-09 / ENM-12: the background an **Overwound** enemy is drawn on. */
export const ELITE_BG = '#3a3210';

/** UI-09 rule 5: Burning gives a background, Stunned greys the glyph. */
function applyStatusStyle(style, actor) {
  const statuses = actor.statuses || {};
  if (statuses.Burning > 0) style.bg = GLYPH_COLORS.burningBg;
  if (statuses.Stunned > 0) style.fg = GLYPH_COLORS.stunned;
  return style;
}

/** ENM-06 / UI-09 rule 4 / UI-20: is this enemy telegraphing an attack? */
export function isWindingUp(actor) {
  return Boolean(actor && (actor.windingUp || actor.ventingUp || actor.pulsingUp));
}

/** UI-07: scrap is `%` in the enemy's color at 45%. */
export function scrapStyle(scrap) {
  const color = scrap && scrap.color ? scrap.color : 'iron';
  return { glyph: '%', fg: dim(color, GLYPH_COLORS.scrapFactor) };
}

// ---------------------------------------------------------------------------------------------
// UI-09 — the map
// ---------------------------------------------------------------------------------------------

/** Is a hazard of this kind active / warning on this turn? Cached per draw. */
function hazardStateOf(floor, x, y, tile, turn) {
  if (tile !== TILE.STEAM_VENT && tile !== TILE.PENDULUM_SWEEP) return {};
  const kind = tile === TILE.STEAM_VENT ? 'STEAM_VENT' : 'PENDULUM_SWEEP';
  return { active: hazardActive(kind, turn), warning: hazardWarning(kind, turn) };
}

/**
 * Draw the 60 x 24 map region (UI-02 rows 0-23, cols 0-59) per UI-09's drawing rules.
 *
 * @param {object[][]} buf
 * @param {object} game the engine facade
 * @param {{flashTick?: boolean, flashCells?: {x: number, y: number}[]}} [opts]
 */
export function drawMap(buf, game, opts = {}) {
  const state = game.state;
  const floor = state.floor;
  const view = game.view();
  const visible = view.visible;
  const mapBg = opts.flashTick ? FLASH_TICK_BG : BG;

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      const seen = visible.has(i);
      const remembered = floor.memory[y][x] !== -1;
      if (!seen && !remembered) {
        put(buf, x, y, ' ', GLYPH_COLORS.floor, mapBg);
        continue;
      }
      const tile = seen ? floor.tiles[y][x] : floor.memory[y][x];
      const haz = hazardStateOf(floor, x, y, tile, state.turn);
      const style = terrainStyle(tile, {
        stationSpent: floor.stationSpent,
        active: seen ? haz.active : false,
        warning: seen ? haz.warning : false,
      });
      let fg = style.fg;
      let bg = style.bg === null ? mapBg : style.bg;
      let glyph = style.glyph;
      if (!seen) {
        // UI-09 rule 2: remembered terrain at 45% brightness; no hazard cycle colors.
        fg = dim(fg, REMEMBERED_FACTOR);
        bg = mapBg;
      }
      put(buf, x, y, glyph, fg, bg);

      // UI-09 rule 1: scrap under items, both under actors.
      if (seen) {
        const scrap = pileAt(floor.scrap, x, y);
        if (scrap) {
          const s = scrapStyle(scrap);
          put(buf, x, y, s.glyph, s.fg, bg);
        }
        const item = pileAt(floor.items, x, y);
        if (item) {
          const s = itemStyle(item.name);
          put(buf, x, y, s.glyph, s.fg, bg);
        }
      } else {
        const item = pileAt(floor.memoryItems, x, y);
        if (item) {
          const s = itemStyle(item.name);
          put(buf, x, y, s.glyph, dim(s.fg, REMEMBERED_FACTOR), bg);
        }
      }
    }
  }

  // Actors, on top. UI-09 rule 2: enemies are never drawn on remembered tiles.
  if (floor.decoy && visible.has(floor.decoy.y * MAP_W + floor.decoy.x)) {
    drawActor(buf, state, floor.decoy, mapBg);
  }
  for (const enemy of floor.enemies) {
    if (!visible.has(enemy.y * MAP_W + enemy.x)) continue;
    drawActor(buf, state, enemy, mapBg);
  }
  drawActor(buf, state, state.tick, mapBg);

  // UI-09 rule 6: a hit enemy's own cell flashes.
  for (const cell of opts.flashCells || []) {
    if (cell.x >= 0 && cell.x < MAP_W && cell.y >= 0 && cell.y < MAP_H) {
      setBg(buf, cell.x, cell.y, FLASH_ENEMY_BG);
    }
  }
}

function drawActor(buf, state, actor, mapBg) {
  const style = actorStyle(state, actor);
  put(buf, actor.x, actor.y, style.glyph, style.fg, style.bg === null ? mapBg : style.bg);
}

/** The topmost entry of a positional list on a tile (TEC-15: at most one item per tile). */
export function pileAt(list, x, y) {
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].x === x && list[i].y === y) return list[i];
  }
  return null;
}

/** UI-02: column 60 is a `│` separator in `#3a3a44` on every map row. */
export function drawSeparator(buf) {
  for (let y = 0; y < MAP_H; y++) put(buf, PANEL_X, y, SEPARATOR, SEPARATOR_COLOR, BG);
}

/** The name UI-05 gives a tile. */
export function tileName(tile) {
  return TILE_NAME[tile] || '';
}

// ---------------------------------------------------------------------------------------------
// TEC-10 — the canvas
// ---------------------------------------------------------------------------------------------

/**
 * TEC-10's cell metrics for a viewport: "the largest integer `s` such that `80 x 0.6 s <= width`
 * and `30 x s <= height` … if `s < 10`, use non-integer scaling to fit. The grid is centered."
 *
 * @param {number} width CSS pixels
 * @param {number} height CSS pixels
 */
export function metricsFor(width, height) {
  const byWidth = width / (COLS * CELL_ASPECT);
  const byHeight = height / ROWS;
  let s = Math.floor(Math.min(byWidth, byHeight));
  if (s < MIN_INTEGER_CELL) s = Math.min(byWidth, byHeight);
  s = Math.max(1, s);
  const cellW = CELL_ASPECT * s;
  const cellH = s;
  const gridW = cellW * COLS;
  const gridH = cellH * ROWS;
  return {
    cell: s,
    cellW,
    cellH,
    gridW,
    gridH,
    originX: (width - gridW) / 2,
    originY: (height - gridH) / 2,
    width,
    height,
    cols: COLS,
    rows: ROWS,
    aspect: CELL_ASPECT,
    integer: Number.isInteger(s),
  };
}

/** The font TEC-10 fixes, at a given cell size. */
export function fontFor(cell) {
  return `${0.9 * cell}px "DejaVu Sans Mono", "Consolas", "Menlo", "Liberation Mono", monospace`;
}

/**
 * The canvas half of the renderer: sizing (`devicePixelRatio`-aware), painting a buffer, and
 * mapping a pixel back to a cell for the mouse (UI-01, UI-13).
 *
 * @param {HTMLCanvasElement} canvas
 */
export function createCanvasRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let metrics = metricsFor(1, 1);

  function resize(width, height, dpr) {
    metrics = metricsFor(width, height);
    const ratio = dpr || 1;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return metrics;
  }

  /**
   * Paint the whole buffer. Backgrounds are drawn as runs of equal color so a full redraw stays
   * inside TEC-14's 8 ms budget.
   *
   * @returns {number} nothing; the caller times it (TEC-13 `CH.render()`)
   */
  function paint(buf) {
    const { cellW, cellH, originX, originY, cell, width, height } = metrics;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);
    ctx.font = fontFor(cell);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let y = 0; y < ROWS; y++) {
      const row = buf[y];
      const py = originY + y * cellH;
      let runStart = 0;
      let runColor = row[0].bg;
      for (let x = 1; x <= COLS; x++) {
        const color = x < COLS ? row[x].bg : null;
        if (color === runColor) continue;
        if (runColor !== BG) {
          ctx.fillStyle = runColor;
          ctx.fillRect(originX + runStart * cellW, py, (x - runStart) * cellW + 0.5, cellH + 0.5);
        }
        runStart = x;
        runColor = color;
      }
      for (let x = 0; x < COLS; x++) {
        const c = row[x];
        if (c.glyph === ' ' || c.glyph === '') continue;
        ctx.fillStyle = c.fg;
        ctx.fillText(c.glyph, originX + (x + 0.5) * cellW, py + cellH * 0.5);
      }
    }
  }

  /** UI-01: map a canvas-relative pixel back to a cell, or null when it is in the letterbox. */
  function cellAt(px, py) {
    const { cellW, cellH, originX, originY } = metrics;
    const x = Math.floor((px - originX) / cellW);
    const y = Math.floor((py - originY) / cellH);
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
    return { x, y };
  }

  return {
    resize,
    paint,
    cellAt,
    get metrics() {
      return metrics;
    },
  };
}
