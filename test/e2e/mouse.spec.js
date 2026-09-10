// The mouse table of UI-13: hover, click-to-travel, click-to-attack, and the three meanings of a
// click on Tick's own tile.

import { test, expect } from '@playwright/test';
import {
  boot, newRun, grid, screenText, act, loadFixture, emptyMap, corridor, put, clickCell, press,
  key, state, timers, inspectText,
} from './helpers.js';

/** TEC-11: "Travel executes one step per 60 ms via a timer." */
const TRAVEL_STEP_MS = 60;

async function settle(page) {
  await page.waitForFunction(() => window.CH.timers() === 0, null, { timeout: 8000 });
}

test('clicking a far walkable tile travels there one step per 60 ms ACC-104 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  await loadFixture(page, emptyMap(4, 6, 30, 14), { number: 1 });

  const before = await state(page);
  const started = Date.now();
  await clickCell(page, 11, 6);
  // A timer is live while the travel runs (TEC-11), and nothing else is.
  expect(await timers(page)).toBe(1);
  await settle(page);
  const elapsed = Date.now() - started;

  const after = await state(page);
  expect({ x: after.tick.x, y: after.tick.y }).toEqual({ x: 11, y: 6 });
  // Seven steps, one turn each, and the timer paced them: the first is immediate, so six waits.
  expect(after.turn).toBe(before.turn + 7);
  expect(elapsed).toBeGreaterThan(5 * TRAVEL_STEP_MS);
  expect(await timers(page)).toBe(0);
  // Arriving is not an interruption, so SCR-10's line is not printed.
  expect((await state(page)).log.some((l) => l.text === 'Tick stops.')).toBe(false);
});

test('travel stops on an item underfoot and on any input, logging Tick stops ACC-104 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  // UI-13: "stop when ... an item or feature is on the current tile". A one-tile corridor leaves
  // A* exactly one route, so the item tile is certainly walked.
  await loadFixture(page, put(corridor(16, 2, 6), 6, 6, '!'), {
    number: 1,
    items: { '!': 'Brass Plating' },
  });
  // WLD-05 caps Tick's sight at Chebyshev 8, so the target must be within it to be clickable.
  await clickCell(page, 10, 6);
  await settle(page);
  let s = await state(page);
  expect({ x: s.tick.x, y: s.tick.y }).toEqual({ x: 6, y: 6 });
  expect(s.log.some((l) => l.text === 'Tick stops.')).toBe(true);

  // UI-13: "or the player presses any key or clicks".
  await loadFixture(page, corridor(20, 2, 6), { number: 1 });
  await clickCell(page, 10, 6);
  await page.waitForTimeout(TRAVEL_STEP_MS * 2);
  await press(page, '.');
  expect(await timers(page)).toBe(0);
  s = await state(page);
  expect(s.tick.x).toBeGreaterThan(2);
  expect(s.tick.x).toBeLessThan(10);
  expect(s.log[s.log.length - 1].text).toBe('Tick stops.');

  // A failed step also ends it: an unreachable click never starts one.
  const turn = (await state(page)).turn;
  await clickCell(page, 0, 0);
  expect(await timers(page)).toBe(0);
  expect((await state(page)).turn).toBe(turn);

  // UI-13: an unseen tile is not a travel target at all.
  await loadFixture(page, emptyMap(4, 6, 40, 14), { number: 1 });
  const fresh = await state(page);
  await clickCell(page, 38, 12);
  expect(await timers(page)).toBe(0);
  expect((await state(page)).turn).toBe(fresh.turn);
});

test('clicking an enemy attacks it when adjacent and only approaches when not ACC-105 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  // A dormant Sweeper two tiles away: the approach is a single step, so ENM-03's "woke this turn
  // does not act" keeps the fixture exact.
  await loadFixture(page, put(emptyMap(6, 6, 30, 14), 8, 6, 's'), {
    number: 1,
    enemies: { s: { type: 'Sweeper', state: 'DORMANT' } },
  });

  let s = await state(page);
  expect(s.floor.enemies[0].integrity).toBe(7);

  // "Left-click | Visible enemy, not adjacent | Travel toward it" — to an adjacent tile, then stop.
  await clickCell(page, 8, 6);
  await settle(page);
  s = await state(page);
  const enemy = s.floor.enemies[0];
  expect(Math.max(Math.abs(s.tick.x - enemy.x), Math.abs(s.tick.y - enemy.y))).toBe(1);
  // "it does not attack automatically".
  expect(enemy.integrity).toBe(7);
  expect(s.log.some((l) => /Tick hits|Tick misses|glances off/.test(l.text))).toBe(false);

  // "Left-click | Visible enemy, adjacent | Melee Attack".
  const turnBefore = s.turn;
  await clickCell(page, enemy.x, enemy.y);
  s = await state(page);
  expect(s.turn).toBe(turnBefore + 1);
  const struck = s.log.some((l) => /Tick hits the Sweeper|Tick misses the Sweeper|glances off/.test(l.text))
    || s.floor.enemies.length === 0;
  expect(struck).toBe(true);
});

test('clicking Tick own tile picks up, interacts or waits ACC-106 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  // "Left-click | Tick's own tile | Pick up if an item is here".
  await loadFixture(page, put(emptyMap(6, 6, 30, 14), 7, 6, '!'), {
    number: 1,
    items: { '!': 'Brass Plating' },
  });
  await press(page, 'l');
  await clickCell(page, 7, 6);
  let s = await state(page);
  expect(s.tick.inventory.some((slot) => slot && slot.name === 'Brass Plating')).toBe(true);

  // "else Interact if a feature is here".
  await loadFixture(page, put(emptyMap(6, 6, 30, 14), 7, 6, '&'), { number: 1 });
  await press(page, 'l');
  await act(page, { type: 'wait' });
  await act(page, { type: 'wait' });
  await clickCell(page, 7, 6);
  s = await state(page);
  expect(s.tick.tension).toBe(100);
  expect(s.floor.stationSpent).toBe(true);

  // "else Wait".
  await loadFixture(page, emptyMap(6, 6, 30, 14), { number: 1 });
  s = await state(page);
  const turn = s.turn;
  await clickCell(page, 6, 6);
  s = await state(page);
  expect(s.turn).toBe(turn + 1);
  expect({ x: s.tick.x, y: s.tick.y }).toEqual({ x: 6, y: 6 });

  // "Left-click | Stairs tile while standing on it | Ascend".
  await loadFixture(page, put(emptyMap(6, 6, 30, 14), 7, 6, '<'), { number: 1 });
  await press(page, 'l');
  await clickCell(page, 7, 6);
  expect((await state(page)).floorNumber).toBe(2);
});

test('clicking the panel buttons and the log rows opens their screens ACC-106 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  await loadFixture(page, emptyMap(6, 6, 30, 14), { number: 1 });

  // UI-03 rows 22-23: each bracketed token is clickable (UI-13).
  const buttons = [
    { x: 62, y: 22, marker: 'INVENTORY' },
    { x: 69, y: 22, marker: 'SKILLS' },
    { x: 62, y: 23, marker: 'JOURNAL' },
    { x: 70, y: 23, marker: 'MESSAGES' },
    { x: 77, y: 23, marker: 'HELP' },
  ];
  for (const b of buttons) {
    await clickCell(page, b.x, b.y);
    expect(screenText(await grid(page))).toContain(b.marker);
    await key(page, 'Escape');
  }

  // UI-13: "Left-click | Log rows | Open Message History".
  await act(page, { type: 'wait' });
  await clickCell(page, 20, 29);
  expect(screenText(await grid(page))).toContain('MESSAGES');
  await key(page, 'Escape');

  // UI-13: hovering the panel updates the inspect line (UI-05's last row of the table).
  await page.mouse.move(1, 1);
  expect(await inspectText(page)).toBe('');
  const at = await page.evaluate(() => {
    const rect = document.getElementById('game').getBoundingClientRect();
    const m = window.CH.metrics();
    return { x: rect.left + m.originX + 65.5 * m.cellW, y: rect.top + m.originY + 1.5 * m.cellH };
  });
  await page.mouse.move(at.x, at.y);
  expect(await inspectText(page)).toContain('Integrity');
});
