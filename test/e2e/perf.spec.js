// TEC-14's two browser budgets (PLN-02 R9, PLN-06 M12 task 1):
//
//   * "A full redraw completes in < 8 ms."  — measured with the duration `CH.render()` returns,
//     which brackets `drawFrame()`: clear the 80 x 30 buffer, redraw every screen on the stack,
//     and paint the whole buffer onto the canvas (TEC-13).
//   * "Idle CPU is zero: no timers run when nothing is animating or repeating." — measured with
//     `CH.timers()`, which counts the live timers `main.js` owns (TEC-13).
//
// PLN-02 R6 forbids wall-clock time in assertions except in the perf measurements themselves,
// which is all this file does. The idle check is the one place a real second has to elapse: TEC-14
// states the budget in seconds and there is nothing else to observe.
//
// The redraw is measured on the most expensive screen the game can show: a fully remembered map
// (every one of the 60 x 24 map cells carries a glyph, so the paint loop does the most work it
// ever does), 30 enemies on the floor, a full five-line log and the side panel. Memory is filled
// in directly rather than by walking, because WLD-05 memory only ever grows and the point of the
// measurement is the worst case, not a typical one.

import { test, expect } from '@playwright/test';
import { boot, newRun, act, loadFixture, timers, key, state, MAP_W, MAP_H } from './helpers.js';

/** The budgets, verbatim from TEC-14. */
const REDRAW_BUDGET_MS = 8;
const IDLE_SECONDS = 1;

/** The eleven non-boss archetypes of `22-bestiary.md`, by glyph. */
const ROSTER = ['s', 'h', 't', 'd', 'c', 'k', 'g', 'f', 'a', 'p', 'u'];

/** A walled 60 x 24 hall with Tick in the middle and 30 enemies on the rings around him. */
function swarmHall() {
  const rows = [];
  for (let y = 0; y < MAP_H; y++) {
    let row = '';
    for (let x = 0; x < MAP_W; x++) {
      const edge = x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
      row += edge ? '#' : '.';
    }
    rows.push(row);
  }
  const write = (x, y, ch) => {
    rows[y] = `${rows[y].slice(0, x)}${ch}${rows[y].slice(x + 1)}`;
  };

  const tx = 30;
  const ty = 12;
  write(tx, ty, 'T');

  let placed = 0;
  for (let r = 3; r <= 11 && placed < 30; r++) {
    for (let dy = -r; dy <= r && placed < 30; dy++) {
      for (let dx = -r; dx <= r && placed < 30; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (x < 2 || x > MAP_W - 3 || y < 2 || y > MAP_H - 3) continue;
        if ((x + y) % 3 !== 0) continue;
        write(x, y, ROSTER[placed % ROSTER.length]);
        placed++;
      }
    }
  }
  return { rows, placed };
}

/** Every roster glyph starts Active, so the telegraph and the enemy glyphs are all being drawn. */
const ACTIVE = Object.fromEntries(ROSTER.map((g) => [g, { state: 'ACTIVE' }]));

/** Mark every map tile as remembered (WLD-05), so the whole map region is drawn. */
async function rememberWholeFloor(page) {
  return page.evaluate(() => {
    const floor = window.CH.state.floor;
    let cells = 0;
    for (let y = 0; y < floor.memory.length; y++) {
      for (let x = 0; x < floor.memory[y].length; x++) {
        floor.memory[y][x] = floor.tiles[y][x];
        cells++;
      }
    }
    return cells;
  });
}

/**
 * Force `n` full redraws through TEC-13's hook and return the distribution of the durations it
 * reports, after an untimed warm-up so the first paint's lazy font work is not what is measured.
 *
 * One redraw per animation frame, which is how `main.js` paints (D-107): redrawing in a tight
 * loop measures the canvas back-pressure of 80 paints the compositor never gets to show, not the
 * redraw itself — measured on this machine, a tight loop reports the same 2.3 ms median with a
 * 15 ms p95, while one redraw per frame reports 2.3 ms at both.
 */
async function measureRedraws(page, n = 60) {
  return page.evaluate(async (count) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let i = 0; i < 10; i++) {
      await frame();
      window.CH.render(); // warm-up, untimed
    }
    const samples = [];
    for (let i = 0; i < count; i++) {
      await frame();
      samples.push(window.CH.render());
    }
    samples.sort((a, b) => a - b);
    const sum = samples.reduce((a, b) => a + b, 0);
    return {
      n: samples.length,
      mean: sum / samples.length,
      median: samples[Math.floor(samples.length / 2)],
      p95: samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))],
      max: samples[samples.length - 1],
    };
  }, n);
}

function report(label, s, budget) {
  return `${label}: mean ${s.mean.toFixed(3)} ms, median ${s.median.toFixed(3)} ms, ` +
    `p95 ${s.p95.toFixed(3)} ms, max ${s.max.toFixed(3)} ms over ${s.n} redraws (budget ${budget} ms)`;
}

test('a full redraw of the busiest screen stays under 8 ms @unit @m12', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  const { rows, placed } = swarmHall();
  expect(placed).toBe(30);
  await loadFixture(page, rows, { number: 7, enemies: ACTIVE });
  expect((await state(page)).floor.enemies.length).toBe(30);

  // Fill the UI-04 log (five lines) with real combat, then remember the whole map.
  for (let i = 0; i < 3; i++) await act(page, { type: 'wait' });
  expect(await rememberWholeFloor(page)).toBe(MAP_W * MAP_H);

  // TEC-10 scales the cell to the window, so the budget is checked at two real window sizes.
  const sizes = [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const s = await measureRedraws(page);
    const label = `TEC-14 full redraw at ${size.width}x${size.height}`;
    const text = report(label, s, REDRAW_BUDGET_MS);
    console.log(text);
    // TEC-14 is per redraw ("a full redraw completes in < 8 ms"), so the slowest of the 60 is the
    // one that has to fit; the mean is asserted too so a bimodal result cannot pass on luck.
    expect(s.max, text).toBeLessThan(REDRAW_BUDGET_MS);
    expect(s.mean, text).toBeLessThan(REDRAW_BUDGET_MS);
  }
});

test('no timer runs while the game sits idle @unit @m12', async ({ page }) => {
  await boot(page);

  // The title screen, before anything has been started.
  await page.waitForTimeout(IDLE_SECONDS * 1000);
  expect(await timers(page)).toBe(0);

  // Mid-run, after a turn has been taken and the flash from it has expired (UI-09 rule 6).
  await newRun(page, 'TEST1234');
  await act(page, { type: 'wait' });
  await page.waitForTimeout(IDLE_SECONDS * 1000);
  expect(await timers(page), 'a turn must leave no timer behind').toBe(0);

  // And with a screen open on the stack (UI-14), which is where an animation would hide.
  await key(page, 'KeyI');
  await page.waitForTimeout(IDLE_SECONDS * 1000);
  expect(await timers(page), 'an open screen must leave no timer behind').toBe(0);
});
