// `src/render.js`'s pure half: the cell buffer, TEC-10's sizing and text layout, and UI-07's
// glyph and color table. The canvas half is exercised by the browser tier.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLS, ROWS, BG, BG_PANEL, CELL_ASPECT, MIN_INTEGER_CELL, PANEL_X, PANEL_TEXT_X, PANEL_W,
  INSPECT_ROW, LOG_ROW, LOG_ROWS, MAP_W, MAP_H, REMEMBERED_FACTOR,
  FLASH_TICK_BG, FLASH_ENEMY_BG, FLASH_MS, GLYPH_COLORS,
  createBuffer, clearBuffer, put, setBg, write, fillRect, invert, invertRow, box,
  fit, pad, twoColumn, center, wrap, wrapMarkup, writeMarkup, emphasisColor, terrainStyle, itemStyle, scrapStyle,
  metricsFor, fontFor, pileAt, drawSeparator, tileName,
} from '../../src/render.js';
import { TILE } from '../../src/tiles.js';

test('@m10 @unit render: the buffer is UI-01 exactly, 80 x 30 cells on the bg color', () => {
  assert.equal(COLS, 80);
  assert.equal(ROWS, 30);
  assert.equal(BG, '#0c0c10');
  assert.equal(BG_PANEL, '#14141a');
  const buf = createBuffer();
  assert.equal(buf.length, 30);
  for (const row of buf) {
    assert.equal(row.length, 80);
    for (const cell of row) assert.deepEqual(cell, { glyph: ' ', fg: '#c8c8c8', bg: BG });
  }
});

test('@m10 @unit render: UI-02 fixes the regions the panel, inspect line and log occupy', () => {
  assert.equal(MAP_W, 60);
  assert.equal(MAP_H, 24);
  assert.equal(PANEL_X, 60);
  assert.equal(PANEL_TEXT_X, 61);
  assert.equal(PANEL_W, 19);
  assert.equal(PANEL_TEXT_X + PANEL_W, COLS);
  assert.equal(INSPECT_ROW, 24);
  assert.equal(LOG_ROW, 25);
  assert.equal(LOG_ROWS, 5);
  assert.equal(LOG_ROW + LOG_ROWS, ROWS);

  // Column 60 is a `│` separator in `#3a3a44` on every map row, and only there.
  const buf = createBuffer();
  drawSeparator(buf);
  for (let y = 0; y < MAP_H; y++) {
    assert.equal(buf[y][PANEL_X].glyph, '│');
    assert.equal(buf[y][PANEL_X].fg, '#3a3a44');
  }
  assert.equal(buf[MAP_H][PANEL_X].glyph, ' ');
});

test('@m10 @unit render: put, write and fillRect clip at the grid edge', () => {
  const buf = createBuffer();
  put(buf, -1, 0, 'x');
  put(buf, 0, -1, 'x');
  put(buf, COLS, 0, 'x');
  put(buf, 0, ROWS, 'x');
  assert.equal(buf[0][0].glyph, ' ');

  assert.equal(write(buf, 78, 0, 'abcd'), 2);
  assert.equal(buf[0][78].glyph, 'a');
  assert.equal(buf[0][79].glyph, 'b');

  assert.equal(write(buf, 0, 1, 'abcdef', null, null, 3), 3);
  assert.equal(buf[1].slice(0, 4).map((c) => c.glyph).join(''), 'abc ');

  fillRect(buf, 2, 2, 3, 2, '#', 'red', 'bg');
  assert.equal(buf[2].slice(2, 5).map((c) => c.glyph).join(''), '###');
  assert.equal(buf[3].slice(2, 5).map((c) => c.glyph).join(''), '###');
  assert.equal(buf[2][2].fg, '#ff6060');
});

test('@m10 @unit render: invert swaps fg and bg, and setBg leaves the glyph alone', () => {
  const buf = createBuffer();
  put(buf, 5, 5, '@', '#ffd75f', '#0c0c10');
  invert(buf, 5, 5);
  assert.deepEqual(buf[5][5], { glyph: '@', fg: '#0c0c10', bg: '#ffd75f' });
  invert(buf, 5, 5);
  assert.deepEqual(buf[5][5], { glyph: '@', fg: '#ffd75f', bg: '#0c0c10' });

  setBg(buf, 5, 5, FLASH_ENEMY_BG);
  assert.equal(buf[5][5].glyph, '@');
  assert.equal(buf[5][5].bg, '#404040');

  invertRow(buf, 0, 6, 3);
  for (let x = 0; x < 3; x++) assert.equal(buf[6][x].fg, BG);
});

test('@m10 @unit render: UI-09 rule 6 names the two flash colors and the frame length', () => {
  assert.equal(FLASH_TICK_BG, '#3a1010');
  assert.equal(FLASH_ENEMY_BG, '#404040');
  assert.equal(FLASH_MS, 80);
  assert.equal(REMEMBERED_FACTOR, 0.45);
});

test('@m10 @unit render: box draws a single-line frame and returns its interior', () => {
  const buf = createBuffer();
  const inner = box(buf, 2, 2, 10, 5, 'iron');
  assert.deepEqual(inner, { x: 3, y: 3, w: 8, h: 3 });
  assert.equal(buf[2][2].glyph, '┌');
  assert.equal(buf[2][11].glyph, '┐');
  assert.equal(buf[6][2].glyph, '└');
  assert.equal(buf[6][11].glyph, '┘');
  assert.equal(buf[2][5].glyph, '─');
  assert.equal(buf[4][2].glyph, '│');
  assert.equal(buf[4][5].glyph, ' ');
  assert.equal(buf[4][5].bg, BG_PANEL);

  const titled = createBuffer();
  box(titled, 0, 0, 20, 3, 'iron', BG_PANEL, 'PAUSED');
  assert.equal(titled[0].slice(2, 10).map((c) => c.glyph).join(''), ' PAUSED ');
});

test('@m10 @unit render: fit, pad, twoColumn and center lay out UI-03 rows', () => {
  // UI-03: "truncate with `…` at 17".
  assert.equal(fit('Escapement Blade', 17), 'Escapement Blade');
  assert.equal(fit('Escapement Blade!!', 17), 'Escapement Blade…');
  assert.equal(fit('Escapement Blade!!', 17).length, 17);
  assert.equal(fit('abc', 1), '…');
  assert.equal(fit('abc', 0), '');
  assert.equal(fit(null, 5), '');

  assert.equal(pad('TICK', 19), 'TICK               ');
  assert.equal(pad('TICK', 19).length, 19);

  // `TICK           Lv 3` and `INTEGRITY    28/44` are UI-03's own examples.
  assert.equal(twoColumn('TICK', 'Lv 3', 19), 'TICK           Lv 3');
  assert.equal(twoColumn('INTEGRITY', '28/44', 19), 'INTEGRITY     28/44');
  assert.equal(twoColumn('TICK', 'Lv 3', 19).length, 19);
  // A left side that will not fit is truncated, and one space always separates the two.
  const tight = twoColumn('A very long weapon name', 'x', 8);
  assert.equal(tight.length, 8);
  assert.ok(tight.endsWith(' x'));

  assert.equal(center('ab', 6), '  ab');
  assert.equal(center('abc', 6), ' abc');
});

test('@m10 @unit render: TEC-10 word wrap breaks on spaces and splits an over-long word', () => {
  assert.deepEqual(wrap('one two three', 7), ['one two', 'three']);
  assert.deepEqual(wrap('', 10), ['']);
  // A word longer than the width is broken.
  assert.deepEqual(wrap('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrap('hi abcdefghij', 4), ['hi', 'abcd', 'efgh', 'ij']);
  // SCR-02's paragraph separator leaves a blank line.
  assert.deepEqual(wrap('a\n\nb', 10), ['a', '', 'b']);
  for (const line of wrap('The Hollow is a clock tower above the harbor town of Lowmere.', 20)) {
    assert.ok(line.length <= 20, line);
  }
});

test('@m10 @unit render: D-023 emphasis markers wrap with the text and are not drawn', () => {
  const lines = wrapMarkup('plain *emphasis here* plain', 12);
  assert.equal(lines.join(' ').replace(/\*/g, ''), 'plain emphasis here plain');
  assert.ok(lines.join('').includes('*'));

  const buf = createBuffer();
  const written = writeMarkup(buf, 0, 0, 'a*b*c', 'lightGrey', BG, 10);
  assert.equal(written, 3);
  assert.equal(buf[0].slice(0, 3).map((c) => c.glyph).join(''), 'abc');
  assert.equal(buf[0][1].fg, '#c0a0ff');
  assert.equal(buf[0][0].fg, '#c8c8c8');

  // UI-04: a scripted log line is already violet, so its emphasis has to lift to something else or
  // it is not emphasis at all — which is what it was until the log learned to render markup.
  const onViolet = createBuffer();
  writeMarkup(onViolet, 0, 0, 'a*b*c', 'violet', BG, 10);
  assert.equal(onViolet[0][0].fg, '#c0a0ff', 'the surrounding text stays violet');
  assert.equal(onViolet[0][1].fg, '#ffffff', 'and the emphasis lifts to white');
  assert.equal(emphasisColor('lightGrey'), 'violet');
  assert.equal(emphasisColor('violet'), 'white');

  // A span that survives the wrap is closed and reopened, because `writeMarkup` runs once per line
  // and keeps no state: without this the continuation renders inverted — the emphasised words plain
  // and whatever follows the stray marker emphasised instead.
  assert.deepEqual(
    wrapMarkup('one two three *four five six seven eight* nine', 14),
    ['one two three', '*four five six*', '*seven eight*', 'nine'],
  );
  for (const wrapped of wrapMarkup('a *b c d e f g h i j* k', 6)) {
    assert.equal((wrapped.match(/\*/g) || []).length % 2, 0, `unbalanced line: ${wrapped}`);
  }
});

test('@m10 @unit render: UI-07 gives every terrain and item its glyph and color', () => {
  assert.deepEqual(terrainStyle(TILE.WALL), { glyph: '#', fg: '#6e6a5e', bg: null });
  assert.deepEqual(terrainStyle(TILE.FLOOR), { glyph: '.', fg: '#3a3a44', bg: null });
  assert.deepEqual(terrainStyle(TILE.DOOR_CLOSED), { glyph: '+', fg: '#b08a4a', bg: null });
  assert.deepEqual(terrainStyle(TILE.DOOR_OPEN), { glyph: "'", fg: '#b08a4a', bg: null });
  assert.deepEqual(terrainStyle(TILE.STAIRS_UP), { glyph: '<', fg: '#f0e68c', bg: null });
  assert.equal(terrainStyle(TILE.STATION).fg, '#5ad0ff');
  assert.equal(terrainStyle(TILE.STATION, { stationSpent: true }).fg, '#2a4a58');
  assert.deepEqual(terrainStyle(TILE.GRINDING_GEAR), { glyph: '^', fg: '#b0b0b0', bg: null });

  // The three vent states and the three pendulum states of UI-07.
  assert.equal(terrainStyle(TILE.STEAM_VENT).fg, '#704020');
  assert.equal(terrainStyle(TILE.STEAM_VENT, { warning: true }).fg, '#ff9040');
  assert.deepEqual(terrainStyle(TILE.STEAM_VENT, { active: true }),
    { glyph: '^', fg: '#ffe0a0', bg: '#5a2a10' });
  assert.equal(terrainStyle(TILE.PENDULUM_SWEEP).fg, '#404050');
  assert.equal(terrainStyle(TILE.PENDULUM_SWEEP, { warning: true }).fg, '#a0a0ff');
  assert.deepEqual(terrainStyle(TILE.PENDULUM_SWEEP, { active: true }),
    { glyph: '~', fg: '#ffffff', bg: '#404070' });
  assert.deepEqual(terrainStyle(TILE.CHAIR), { glyph: 'h', fg: '#a08060', bg: null });
  assert.deepEqual(terrainStyle(TILE.ESCAPEMENT), { glyph: 'O', fg: '#c0c0c0', bg: null });

  assert.equal(GLYPH_COLORS.tick, '#ffd75f');
  assert.equal(tileName(TILE.WALL), 'Wall');

  // Records are always a white `?`, whatever their catalogue color (UI-07).
  assert.deepEqual(itemStyle('Journal page 1'), { glyph: '?', fg: '#ffffff' });
  assert.deepEqual(itemStyle('Brass Plating'), { glyph: '[', fg: '#ffd75f' });
  // Scrap is `%` in the enemy's color at 45%.
  assert.equal(scrapStyle({ color: '#ffffff' }).glyph, '%');
  assert.equal(scrapStyle({ color: '#ffffff' }).fg, '#737373');
});

test('@m10 @unit render: pileAt returns the topmost entry on a tile', () => {
  const list = [{ x: 1, y: 1, name: 'a' }, { x: 2, y: 2, name: 'b' }, { x: 1, y: 1, name: 'c' }];
  assert.equal(pileAt(list, 1, 1).name, 'c');
  assert.equal(pileAt(list, 2, 2).name, 'b');
  assert.equal(pileAt(list, 3, 3), null);
  assert.equal(pileAt(null, 0, 0), null);
});

test('@m10 @unit render: TEC-10 sizing takes the largest integer cell and centers the grid', () => {
  assert.equal(CELL_ASPECT, 0.6);
  assert.equal(MIN_INTEGER_CELL, 10);

  // 1280 x 720: 1280 / 48 = 26.6, 720 / 30 = 24 -> s = 24.
  const wide = metricsFor(1280, 720);
  assert.equal(wide.cell, 24);
  assert.equal(wide.integer, true);
  assert.ok(Math.abs(wide.cellW - 14.4) < 1e-9);
  assert.equal(wide.cellH, 24);
  assert.ok(Math.abs(wide.gridW - 1152) < 1e-9);
  assert.equal(wide.gridH, 720);
  assert.ok(Math.abs(wide.originX - 64) < 1e-9);
  assert.equal(wide.originY, 0);

  // UI-20's minimum window, 800 x 450: 800 / 48 = 16.6, 450 / 30 = 15 -> s = 15, an exact fit.
  const minimum = metricsFor(800, 450);
  assert.equal(minimum.cell, 15);
  assert.equal(minimum.gridH, 450);
  assert.ok(minimum.gridW <= 800);

  // Below s = 10, TEC-10 switches to non-integer scaling rather than losing the grid.
  const small = metricsFor(400, 300);
  assert.equal(small.integer, false);
  assert.ok(Math.abs(small.gridW - 400) < 1e-9);
  assert.ok(small.gridH <= 300);
  assert.equal(small.originX, 0);

  // The grid is never larger than the viewport, and always centered, at any size.
  for (const [w, h] of [[1920, 1080], [1000, 900], [640, 400], [3000, 500], [200, 2000]]) {
    const m = metricsFor(w, h);
    assert.ok(m.gridW <= w + 1e-9, `${w}x${h} width`);
    assert.ok(m.gridH <= h + 1e-9, `${w}x${h} height`);
    assert.ok(Math.abs(m.cellW / m.cellH - CELL_ASPECT) < 1e-9);
    assert.ok(Math.abs(m.originX - (w - m.gridW) / 2) < 1e-9);
    assert.ok(Math.abs(m.originY - (h - m.gridH) / 2) < 1e-9);
  }

  assert.equal(fontFor(20), '18px "DejaVu Sans Mono", "Consolas", "Menlo", "Liberation Mono", monospace');
});

test('@m10 @unit render: clearBuffer resets every cell to the given background', () => {
  const buf = createBuffer();
  fillRect(buf, 0, 0, COLS, ROWS, '#', 'red', 'red');
  clearBuffer(buf, BG_PANEL);
  for (const row of buf) {
    for (const cell of row) assert.deepEqual(cell, { glyph: ' ', fg: '#c8c8c8', bg: BG_PANEL });
  }
});
