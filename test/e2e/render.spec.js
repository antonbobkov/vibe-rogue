// The renderer: canvas sizing, the side panel, the log, the two flashes and the telegraph
// (UI-01..UI-09, TEC-10).

import { test, expect } from '@playwright/test';
import {
  boot, newRun, grid, rowText, screenText, act, loadFixture, emptyMap, put, timers,
  waitToTension, logRows, logCount, gainXp, key, press, hoverCell, inspectText, state,
  PANEL_TEXT_X, BG,
} from './helpers.js';

/** UI-08's bar colors. */
const GREEN = '#60e060';
const YELLOW = '#ffd75f';
const RED = '#ff6060';

/** UI-09 rule 6 / UI-08. */
const FLASH_TICK_BG = '#3a1010';
const TELEGRAPH_FG = '#ffffff';
const TELEGRAPH_BG = '#602020';

test('the 80x30 grid stays fully visible and letterboxed at every window size ACC-100 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  const sizes = [
    { width: 1280, height: 720 },
    { width: 800, height: 450 },
    { width: 1920, height: 1080 },
    { width: 1000, height: 900 },
    { width: 640, height: 400 },
  ];

  for (const size of sizes) {
    await page.setViewportSize(size);
    const m = await page.evaluate(() => window.CH.metrics());

    // UI-01: "the canvas scales to fit the browser window while keeping the cell aspect ratio".
    expect(m.aspect).toBe(0.6);
    expect(m.cellW / m.cellH).toBeCloseTo(0.6, 10);
    expect(m.cols).toBe(80);
    expect(m.rows).toBe(30);

    // TEC-10: 80 x 0.6s <= width and 30 x s <= height, so the whole grid is on screen.
    expect(m.gridW).toBeLessThanOrEqual(m.width + 1e-6);
    expect(m.gridH).toBeLessThanOrEqual(m.height + 1e-6);
    expect(m.gridW).toBeCloseTo(80 * m.cellW, 6);
    expect(m.gridH).toBeCloseTo(30 * m.cellH, 6);

    // "The grid is centered; the rest is `bg`" — the letterbox is symmetric and never negative.
    expect(m.originX).toBeGreaterThanOrEqual(0);
    expect(m.originY).toBeGreaterThanOrEqual(0);
    expect(m.originX).toBeCloseTo((m.width - m.gridW) / 2, 6);
    expect(m.originY).toBeCloseTo((m.height - m.gridH) / 2, 6);

    // "the largest integer `s` ... if `s < 10`, use non-integer scaling to fit".
    const ideal = Math.min(m.width / 48, m.height / 30);
    if (ideal >= 10) expect(m.cell).toBe(Math.floor(ideal));
    else expect(m.cell).toBeCloseTo(ideal, 6);

    const g = await grid(page);
    expect(g).toHaveLength(30);
    expect(g[0]).toHaveLength(80);
  }
});

test('the Tension bar turns green, yellow then red with the CHR-03 warnings ACC-107 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  await loadFixture(page, emptyMap(5, 5, 30, 12), { number: 1 });

  // UI-06: "> 30 green; 16-30 yellow; <= 15 red". The bar's first fill cell carries the color.
  const barColor = async () => (await grid(page))[4][PANEL_TEXT_X + 1].fg;

  expect(await waitToTension(page, 31)).toBe(31);
  expect(await barColor()).toBe(GREEN);

  expect(await waitToTension(page, 30)).toBe(30);
  expect(await barColor()).toBe(YELLOW);
  // SCR-10: "The spring is loosening." once per floor at <= 30.
  const loosening = await page.evaluate(() =>
    window.CH.state.log.filter((l) => l.text === 'The spring is loosening.'));
  expect(loosening).toHaveLength(1);
  expect(loosening[0].count).toBe(1);
  expect(loosening[0].color).toBe('yellow');

  expect(await waitToTension(page, 15)).toBe(15);
  expect(await barColor()).toBe(RED);
  // "Tick's spring is nearly slack." every 5th turn at <= 15 — the decay turn itself.
  const slack = await page.evaluate(() =>
    window.CH.state.log.filter((l) => l.text === "Tick's spring is nearly slack."));
  expect(slack.length).toBeGreaterThanOrEqual(1);
  expect(slack[0].color).toBe('yellow');

  // The Integrity bar is untouched at full Integrity: UI-06's "> 50%" blue.
  expect((await grid(page))[2][PANEL_TEXT_X + 1].fg).toBe('#60c0ff');
});

test('an unspent skill point shows as SP:1 in yellow on panel row 0 ACC-108 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  let row0 = rowText(await grid(page), 0);
  expect(row0.slice(PANEL_TEXT_X)).toContain('Lv 1');
  expect(row0.slice(PANEL_TEXT_X)).not.toContain('SP:');

  // CHR-06/07: 4 Sweepers is 12 XP, past the level-2 threshold of 10.
  const gained = await gainXp(page, 4);
  expect(gained.level).toBe(2);
  expect(gained.skillPoints).toBe(1);

  // UI-19: the level-up opens the Skills screen; close it to read the panel underneath.
  expect(screenText(await grid(page))).toContain('Skill points: 1');
  await key(page, 'Escape');

  const g = await grid(page);
  row0 = rowText(g, 0);
  expect(row0.slice(PANEL_TEXT_X)).toContain('SP:1');
  expect(row0.slice(PANEL_TEXT_X)).not.toContain('Lv 2');
  const at = row0.indexOf('SP:1');
  expect(g[0][at].fg).toBe(YELLOW);

  // "until spent": taking a skill puts the level back on row 0.
  await act(page, { type: 'takeSkill', name: 'Braced Frame' });
  row0 = rowText(await grid(page), 0);
  expect(row0.slice(PANEL_TEXT_X)).toContain('Lv 2');
  expect(row0.slice(PANEL_TEXT_X)).not.toContain('SP:');
});

test('the log shows the newest five lines and merges repeats with (x n) ACC-113 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  // UI-04: "Identical consecutive messages are merged as *message* (×n)."
  await loadFixture(page, emptyMap(1, 1, 30, 12), { number: 1 });
  for (let i = 0; i < 3; i++) await act(page, { type: 'move', dx: -1, dy: 0 });
  let rows = await logRows(page);
  expect(rows[rows.length - 1]).toBe('The wall is solid. (×3)');

  // Seven Stokers all act in one enemy phase, so one turn produces more than five lines.
  let map = emptyMap(6, 6, 24, 12);
  for (const [x, y] of [[5, 5], [6, 5], [7, 5], [5, 6], [7, 6], [5, 7], [6, 7]]) map = put(map, x, y, 'k');
  await loadFixture(page, map, { number: 4, enemies: { k: { type: 'Stoker', state: 'ACTIVE' } } });

  const before = await logCount(page);
  await act(page, { type: 'wait' });
  const produced = (await logCount(page)) - before;
  expect(produced).toBeGreaterThanOrEqual(7);

  // Only five rows are on screen...
  rows = await logRows(page);
  expect(rows.length).toBeLessThanOrEqual(5);

  // ...while the Message History screen holds every line of the run (TEC-05's cap is 500).
  await press(page, 'm');
  const history = screenText(await grid(page));
  expect(history).toContain('MESSAGES');
  expect(history).toContain('The wall is solid. (×3)');
  const s = await state(page);
  expect(s.log.reduce((n, l) => n + l.count, 0)).toBeGreaterThanOrEqual(7);
});

test('damage flashes the map background for one frame and nothing else animates ACC-121 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  let map = emptyMap(5, 5, 24, 12);
  map = put(map, 6, 5, 'k');
  await loadFixture(page, map, { number: 4, enemies: { k: { type: 'Stoker', state: 'ACTIVE' } } });

  // Nothing runs while nothing is animating (TEC-14).
  expect(await timers(page)).toBe(0);

  const flashed = await page.evaluate(() => {
    const start = window.CH.state.tick.integrity;
    for (let i = 0; i < 20; i++) {
      window.CH.act({ type: 'wait' });
      if (window.CH.state.tick.integrity < start) break;
    }
    window.CH.render();
    const g = window.CH.grid();
    return {
      hurt: window.CH.state.tick.integrity < start,
      mapBg: g[10][10].bg,
      panelBg: g[1][65].bg,
      timers: window.CH.timers(),
    };
  });
  expect(flashed.hurt).toBe(true);
  // UI-09 rule 6: "the whole map's background becomes #3a1010 for one frame".
  expect(flashed.mapBg).toBe(FLASH_TICK_BG);
  // Only the map — the panel is untouched.
  expect(flashed.panelBg).toBe(BG);
  // A requestAnimationFrame loop runs only while the flash is pending (TEC-10).
  expect(flashed.timers).toBe(1);

  await page.waitForFunction(() => window.CH.timers() === 0, null, { timeout: 3000 });
  const after = await page.evaluate(() => {
    window.CH.render();
    return { mapBg: window.CH.grid()[10][10].bg, timers: window.CH.timers() };
  });
  expect(after.mapBg).toBe(BG);
  // "These are the only animations": once the flash expires, the idle CPU is zero again.
  expect(after.timers).toBe(0);
});

test('a winding-up enemy is drawn in the telegraph colors and says so ACC-122 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  let map = emptyMap(5, 5, 24, 12);
  map = put(map, 6, 5, 'g');
  await loadFixture(page, map, { number: 4, enemies: { g: { type: 'Gear-Golem', state: 'ACTIVE' } } });

  const found = await page.evaluate(() => {
    for (let i = 0; i < 12; i++) {
      const e = window.CH.state.floor.enemies[0];
      if (e && e.windingUp) return { x: e.x, y: e.y };
      window.CH.act({ type: 'wait' });
    }
    return null;
  });
  expect(found).not.toBeNull();

  // UI-09 rule 4: "an enemy that is winding up is drawn with the `telegraph` colors instead of
  // its own" — UI-08's `#ffffff` on `#602020`.
  const cell = (await grid(page))[found.y][found.x];
  expect(cell.glyph).toBe('g');
  expect(cell.fg).toBe(TELEGRAPH_FG);
  expect(cell.bg).toBe(TELEGRAPH_BG);

  // UI-20: "The telegraph state additionally appears in the inspect line as `winding up`."
  await hoverCell(page, found.x, found.y);
  expect(await inspectText(page)).toContain('winding up');
});
