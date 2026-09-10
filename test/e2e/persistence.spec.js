// The browser forms of TEC-07's determinism and TEC-09's autosave: a real page reload, the real
// `localStorage` key, and the Title's Continue and Abandon paths (ACC-01..ACC-06).

import { test, expect } from '@playwright/test';
import {
  boot, newRun, grid, screenText, act, loadFixture, emptyMap, put, key, press, clickCell,
  hoverCell, state, savedText,
} from './helpers.js';

/** TEC-09's key. */
const SAVE_KEY = 'clockworkHollow.save.v1';

/** UI-17's menu rows. */
const MENU_ROW = 15;

/** A fixed script of 50 actions: deterministic whatever the map turns out to be (CMB-05). */
const SCRIPT_50 = (() => {
  const cycle = [
    { type: 'wait' },
    { type: 'move', dx: 1, dy: 0 },
    { type: 'move', dx: 0, dy: 1 },
    { type: 'move', dx: -1, dy: 0 },
    { type: 'move', dx: 0, dy: -1 },
    { type: 'pickup' },
  ];
  const out = [];
  for (let i = 0; i < 50; i++) out.push(cycle[i % cycle.length]);
  return out;
})();

async function runScript(page, actions) {
  return page.evaluate((list) => {
    for (const action of list) window.CH.act(action);
    const s = window.CH.state;
    return {
      json: JSON.stringify({ ...s, log: null }),
      log: s.log.map((l) => `${l.text}|${l.count}`),
      turn: s.turn,
      playRngState: s.playRngState,
      tiles: s.floor.tiles.map((row) => row.join(',')).join(';'),
    };
  }, actions);
}

async function reloadInto(page, saved) {
  await page.evaluate(({ k, v }) => window.localStorage.setItem(k, v), { k: SAVE_KEY, v: saved });
  await page.reload();
  await page.waitForFunction(() => window.CH && typeof window.CH.grid === 'function');
}

test('the same seed and the same 50 actions give the same run in a fresh session ACC-01 @m10', async ({ page }) => {
  await boot(page, { clear: false });
  await newRun(page, 'TEST1234');
  const first = await runScript(page, SCRIPT_50);
  expect(first.turn).toBeGreaterThan(0);

  // A fresh session: reload the page and start the same seed again from the Title.
  await page.evaluate((k) => window.localStorage.removeItem(k), SAVE_KEY);
  await page.reload();
  await page.waitForFunction(() => window.CH && typeof window.CH.grid === 'function');
  await newRun(page, 'TEST1234');
  const second = await runScript(page, SCRIPT_50);

  expect(second.tiles).toBe(first.tiles);
  expect(second.json).toBe(first.json);
  expect(second.log).toEqual(first.log);
  expect(second.playRngState).toBe(first.playRngState);
});

test('reloading mid-run and pressing Continue resumes the identical run ACC-02 @m10', async ({ page }) => {
  await boot(page, { clear: false });
  await newRun(page, 'TEST1234');
  // "Mid-run on floor 3".
  await page.evaluate(() => window.CH.loadFloor(3));
  await runScript(page, SCRIPT_50.slice(0, 20));
  expect((await state(page)).floorNumber).toBe(3);

  // The save that the next 20 actions will start from.
  const saved = await savedText(page);
  expect(saved).not.toBeNull();
  const mid = await state(page);

  // Branch A: carry straight on.
  const uninterrupted = await runScript(page, SCRIPT_50.slice(20, 40));
  const nextRollA = await page.evaluate(() => window.CH.playRng.next());

  // Branch B: reload the page, press Continue, and take exactly the same 20 actions.
  await reloadInto(page, saved);
  const title = screenText(await grid(page));
  expect(title).toContain('Continue');
  expect(title).toContain(`Floor ${mid.floorNumber}, turn ${mid.turn}`);
  await clickCell(page, 40, MENU_ROW + 1);

  const restored = await state(page);
  expect(restored.turn).toBe(mid.turn);
  expect(restored.floorNumber).toBe(3);
  expect(restored.playRngState).toBe(mid.playRngState);
  // TEC-09: Continue "shows the Run screen with the log line 'Tick resumes.'".
  expect(restored.log[restored.log.length - 1].text).toBe('Tick resumes.');
  // The FOV is recomputed, not restored (TEC-05).
  const view = await page.evaluate(() => window.CH.game.view().visible.size);
  expect(view).toBeGreaterThan(0);

  const afterReload = await runScript(page, SCRIPT_50.slice(20, 40));
  const nextRollB = await page.evaluate(() => window.CH.playRng.next());

  expect(afterReload.json).toBe(uninterrupted.json);
  expect(afterReload.turn).toBe(uninterrupted.turn);
  expect(afterReload.playRngState).toBe(uninterrupted.playRngState);
  // "the *next* hit roll [is] identical to not reloading".
  expect(nextRollB).toBe(nextRollA);
  // D-084: the only difference in the log is the restore line the spec asks for.
  expect(afterReload.log.filter((l) => l !== 'Tick resumes.|1')).toEqual(uninterrupted.log);
});

test('death removes the save and the Title stops offering Continue ACC-03 @m10', async ({ page }) => {
  await boot(page, { clear: false });
  await newRun(page, 'TEST1234');
  await act(page, { type: 'wait' });
  expect(await savedText(page)).not.toBeNull();

  let map = emptyMap(5, 5, 20, 10);
  for (const [x, y] of [[4, 4], [6, 6], [6, 4], [4, 6]]) map = put(map, x, y, 'k');
  await loadFixture(page, map, { number: 4, enemies: { k: { type: 'Stoker', state: 'ACTIVE' } } });
  await page.evaluate(() => {
    for (let i = 0; i < 400; i++) {
      if (window.CH.state.dead) return;
      window.CH.act({ type: 'wait' });
    }
  });

  // "localStorage key is absent on the Death screen".
  expect(screenText(await grid(page))).toContain('TICK WAS BROKEN');
  expect(await savedText(page)).toBeNull();

  // "Title shows no Continue" — both straight away and after a reload.
  await key(page, 'Enter');
  expect(screenText(await grid(page))).not.toContain('Continue');
  await page.reload();
  await page.waitForFunction(() => window.CH && typeof window.CH.grid === 'function');
  expect(screenText(await grid(page))).not.toContain('Continue');
});

test('Abandon keeps the save on n and deletes it on y ACC-04 @m10', async ({ page }) => {
  await boot(page, { clear: false });
  await newRun(page, 'TEST1234');
  await act(page, { type: 'wait' });
  await act(page, { type: 'wait' });
  const saved = await savedText(page);
  expect(saved).not.toBeNull();

  // Back to the Title with the autosave intact (UI-18).
  await key(page, 'Escape');
  await clickCell(page, 30, 12);
  expect(screenText(await grid(page))).toContain('Continue');

  // "New run → answer `n` to Abandon | Save unchanged; still on Title."
  await clickCell(page, 40, MENU_ROW);
  expect(screenText(await grid(page))).toContain('Abandon the saved run? (y/n)');
  await press(page, 'n');
  expect(await savedText(page)).toBe(saved);
  const stillTitle = screenText(await grid(page));
  expect(stillTitle).toContain('CLOCKWORK HOLLOW');
  expect(stillTitle).not.toContain('Abandon the saved run?');

  // "Answer `y` | Save deleted; intro shown."
  await clickCell(page, 40, MENU_ROW);
  expect(screenText(await grid(page))).toContain('Abandon the saved run? (y/n)');
  await press(page, 'y');
  expect(await savedText(page)).toBeNull();
  expect(screenText(await grid(page))).toContain('The Hollow is a clock tower');
});

test('a version 0 save is treated as no save and removed ACC-05 @m10', async ({ page }) => {
  await boot(page, { clear: false });
  await newRun(page, 'TEST1234');
  await act(page, { type: 'wait' });
  const good = await savedText(page);
  expect(good).not.toBeNull();

  // "Save with `version: 0` injected | Load page | Treated as no save; key removed."
  const bad = JSON.stringify({ ...JSON.parse(good), version: 0 });
  await reloadInto(page, bad);
  expect(await savedText(page)).toBeNull();
  expect(screenText(await grid(page))).not.toContain('Continue');

  // TEC-09: "or `JSON.parse` fails" — the same branch.
  await reloadInto(page, 'not json at all');
  expect(await savedText(page)).toBeNull();
  expect(screenText(await grid(page))).not.toContain('Continue');
});

test('hovering, inspecting and opening screens 100 times draws no randomness ACC-06 @m10', async ({ page }) => {
  await boot(page, { clear: false });
  await newRun(page, 'TEST1234');
  let map = emptyMap(6, 6, 30, 14);
  map = put(map, 9, 6, 's');
  await loadFixture(page, map, { number: 1 });
  await act(page, { type: 'wait' });

  const before = await state(page);
  const rngBefore = await page.evaluate(() => window.CH.playRng.getState());

  for (let i = 0; i < 25; i++) {
    await hoverCell(page, 6 + (i % 8), 6);
    await hoverCell(page, 9, 6);
    await press(page, 'i');
    await key(page, 'Escape');
    await press(page, 'r');
    await key(page, 'Escape');
    await press(page, 'x');
    await key(page, 'Enter');
    await key(page, 'Escape');
    await key(page, 'Escape');
  }

  const after = await state(page);
  // TEC-07's last bullet: "Mouse hover, inspect, and screens never consume randomness."
  expect(after.playRngState).toBe(before.playRngState);
  expect(await page.evaluate(() => window.CH.playRng.getState())).toBe(rngBefore);
  expect(after.turn).toBe(before.turn);
});
