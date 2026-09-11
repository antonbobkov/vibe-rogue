// Keyboard and mouse-free input: the UI-10 key table, the UI-05 inspect line, the UI-11 popup and
// UI-12's targeting mode.

import { test, expect } from '@playwright/test';
import {
  boot, newRun, grid, rowText, screenText, act, loadFixture, emptyMap, put, key, keyUp, press,
  state, hoverCell, clickCell, inspectText, logRows, gainXp, timers,
} from './helpers.js';

/** UI-10's eight directions, by the three ways the spec spells each of them. */
const DIRECTIONS = [
  { dx: -1, dy: -1, numpad: 'Numpad7', letter: 'y' },
  { dx: 0, dy: -1, numpad: 'Numpad8', letter: 'k', arrow: 'ArrowUp' },
  { dx: 1, dy: -1, numpad: 'Numpad9', letter: 'u' },
  { dx: -1, dy: 0, numpad: 'Numpad4', letter: 'h', arrow: 'ArrowLeft' },
  { dx: 1, dy: 0, numpad: 'Numpad6', letter: 'l', arrow: 'ArrowRight' },
  { dx: -1, dy: 1, numpad: 'Numpad1', letter: 'b' },
  { dx: 0, dy: 1, numpad: 'Numpad2', letter: 'j', arrow: 'ArrowDown' },
  { dx: 1, dy: 1, numpad: 'Numpad3', letter: 'n' },
];

async function tickAt(page) {
  const s = await state(page);
  return { x: s.tick.x, y: s.tick.y, turn: s.turn, tension: s.tick.tension };
}

test('every movement spelling of UI-10 moves in its own direction ACC-101 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  await loadFixture(page, emptyMap(10, 8, 30, 16), { number: 1 });

  for (const dir of DIRECTIONS) {
    // TEC-11: the numpad is read from `event.code`, so NumLock cannot turn a move into a skill.
    let before = await tickAt(page);
    await key(page, dir.numpad);
    let after = await tickAt(page);
    expect({ x: after.x - before.x, y: after.y - before.y })
      .toEqual({ x: dir.dx, y: dir.dy });
    expect(after.turn).toBe(before.turn + 1);

    // The eight `vi` letters, read from `event.key`.
    before = after;
    await press(page, dir.letter);
    after = await tickAt(page);
    expect({ x: after.x - before.x, y: after.y - before.y })
      .toEqual({ x: dir.dx, y: dir.dy });

    if (dir.arrow) {
      before = after;
      await key(page, dir.arrow);
      after = await tickAt(page);
      expect({ x: after.x - before.x, y: after.y - before.y })
        .toEqual({ x: dir.dx, y: dir.dy });
    }
  }

  // UI-10: "`.`, numpad `5`, `z` | Wait".
  for (const waitKey of [{ code: 'Period', ch: '.' }, { code: 'Numpad5' }, { code: 'KeyZ', ch: 'z' }]) {
    const before = await tickAt(page);
    if (waitKey.ch) await press(page, waitKey.ch);
    else await key(page, waitKey.code);
    const after = await tickAt(page);
    expect(after.turn).toBe(before.turn + 1);
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
  }

  // UI-10 / TEC-11: Shift + direction repeats the Move; releasing the key stops it.
  const before = await tickAt(page);
  await key(page, 'ArrowRight', { shift: true });
  expect(await timers(page)).toBe(1);
  await page.waitForTimeout(200);
  await keyUp(page, 'ArrowRight');
  const after = await tickAt(page);
  expect(after.x).toBeGreaterThan(before.x + 1);
  expect(after.turn).toBeGreaterThan(before.turn + 1);
  expect(await timers(page)).toBe(0);
});

test('Digit1 uses skill 1 while Numpad1 moves, and each command key acts ACC-101 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  // With no skill in slot 1, `Digit1` must still never be read as a numpad move.
  await loadFixture(page, emptyMap(10, 8, 30, 16), { number: 1 });
  let before = await tickAt(page);
  await key(page, 'Digit1');
  let after = await tickAt(page);
  expect({ x: after.x, y: after.y, turn: after.turn }).toEqual({ x: before.x, y: before.y, turn: before.turn });
  await key(page, 'Numpad1');
  after = await tickAt(page);
  expect({ x: after.x - before.x, y: after.y - before.y }).toEqual({ x: -1, y: 1 });

  // CHR-06/07: 9 Sweepers is 27 XP, which is level 3 and two skill points — enough for the
  // cheapest active skill (Resonance rank 2, Resonant Pulse, 8 Tension).
  const gained = await gainXp(page, 9);
  expect(gained.level).toBe(3);
  await key(page, 'Escape');
  await act(page, { type: 'takeSkill', name: 'Tuning' });
  await act(page, { type: 'takeSkill', name: 'Resonant Pulse' });
  let s = await state(page);
  expect(s.tick.activeSlots).toEqual(['Resonant Pulse']);

  await loadFixture(page, emptyMap(10, 8, 30, 16), { number: 1 });
  before = await tickAt(page);
  await key(page, 'Digit1');
  after = await tickAt(page);
  expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
  expect(before.tension - after.tension).toBeGreaterThanOrEqual(8);
  expect(after.turn).toBe(before.turn + 1);

  // UI-10: `g` and `,` pick up.
  let map = put(emptyMap(10, 8, 30, 16), 11, 8, '!');
  await loadFixture(page, map, { number: 1, items: { '!': 'Solder' } });
  await press(page, 'l');
  await press(page, 'g');
  s = await state(page);
  expect(s.tick.inventory.some((slot) => slot && slot.name === 'Solder' && slot.count === 2)).toBe(true);

  // UI-10: `e` interacts with a Winding Station (CHR-05).
  map = put(emptyMap(10, 8, 30, 16), 11, 8, '&');
  await loadFixture(page, map, { number: 1 });
  await press(page, 'l');
  await press(page, 'e');
  s = await state(page);
  // CHR-05 (DIF-05): the station winds to `stationRestore`, and says which number it wound to.
  expect(s.tick.tension).toBe(s.tuning.stationRestore);
  expect(s.log.some((l) => l.text === `Tick winds the spring. Tension ${s.tuning.stationRestore}.`)).toBe(true);
  expect(s.log.some((l) => l.text === 'The winding rings through the tower.')).toBe(true);

  // UI-10: `c` then a direction closes a door; the glyph goes from `'` to `+` (UI-07).
  map = put(emptyMap(10, 8, 30, 16), 11, 8, "'");
  await loadFixture(page, map, { number: 1 });
  expect((await grid(page))[8][11].glyph).toBe("'");
  await press(page, 'c');
  expect(await inspectText(page)).toContain('Close which door?');
  await press(page, 'l');
  expect((await grid(page))[8][11].glyph).toBe('+');

  // Esc cancels the `c` prompt instead of closing anything.
  map = put(emptyMap(10, 8, 30, 16), 11, 8, "'");
  await loadFixture(page, map, { number: 1 });
  await press(page, 'c');
  await key(page, 'Escape');
  expect((await grid(page))[8][11].glyph).toBe("'");

  // UI-10: `f` with no ranged weapon and `t` with nothing to throw refuse on the inspect line and
  // spend no turn — SCR-10 has no template for either (D-090).
  await loadFixture(page, emptyMap(10, 8, 30, 16), { number: 1 });
  const quiet = await state(page);
  await press(page, 'f');
  expect(await inspectText(page)).toBe('No ranged weapon equipped.');
  await press(page, 't');
  expect(await inspectText(page)).toBe('Nothing to throw.');
  s = await state(page);
  expect(s.turn).toBe(quiet.turn);
  expect(s.log.map((l) => l.text)).toEqual(quiet.log.map((l) => l.text));

  // UI-10: `t` with a throwable opens the letter list, and the letter enters targeting (UI-12).
  await loadFixture(page, put(emptyMap(10, 8, 30, 16), 11, 8, '{'), {
    number: 1,
    items: { '{': 'Oil Flask' },
  });
  await press(page, 'l');
  await press(page, 'g');
  s = await state(page);
  const flaskSlot = s.tick.inventory.findIndex((slot) => slot && slot.name === 'Oil Flask');
  expect(flaskSlot).toBeGreaterThanOrEqual(0);
  await press(page, 't');
  expect(await inspectText(page)).toBe('Throw which? (letter, Esc cancels)');
  expect(screenText(await grid(page))).toContain('Oil Flask');
  // Esc leaves the list without spending a turn.
  const beforeThrow = await state(page);
  await key(page, 'Escape');
  expect((await state(page)).turn).toBe(beforeThrow.turn);
  await press(page, 't');
  await press(page, String.fromCharCode(97 + flaskSlot));
  // Targeting opened: the cursor inverts Tick's own tile, since there is no enemy in sight.
  const g = await grid(page);
  expect(g[8][11].bg).not.toBe('#0c0c10');
  await key(page, 'Escape');
  expect((await state(page)).turn).toBe(beforeThrow.turn);
});

test('the screen keys open their screens and Esc opens the Pause menu ACC-101 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  await loadFixture(page, emptyMap(10, 8, 30, 16), { number: 1 });

  const screens = [
    { keyChar: 'i', marker: 'INVENTORY' },
    { keyChar: 's', marker: 'SKILLS' },
    { keyChar: 'r', marker: 'JOURNAL' },
    { keyChar: 'm', marker: 'MESSAGES' },
    { keyChar: '?', marker: 'HELP' },
  ];
  for (const s of screens) {
    await press(page, s.keyChar);
    expect(screenText(await grid(page))).toContain(s.marker);
    await key(page, 'Escape');
    expect(screenText(await grid(page))).not.toContain(s.marker);
  }

  // UI-10: "`Esc` ... on the plain Run screen opens the Pause menu (UI-18)".
  await key(page, 'Escape');
  const paused = screenText(await grid(page));
  expect(paused).toContain('PAUSED');
  expect(paused).toContain('Resume');
  expect(paused).toContain('Quit to title');
  await key(page, 'Escape');
  expect(screenText(await grid(page))).not.toContain('PAUSED');

  // UI-10: `x` is look mode, and `Esc` leaves it (UI-12) without spending a turn.
  const before = await tickAt(page);
  await press(page, 'x');
  expect((await grid(page))[before.y][before.x].bg).toBe('#ffd75f');
  await key(page, 'Escape');
  expect((await state(page)).turn).toBe(before.turn);
});

test('Ascend only works while Tick stands on the up-stairs ACC-101 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  const map = put(emptyMap(10, 8, 30, 16), 11, 8, '<');
  await loadFixture(page, map, { number: 1 });

  // Off the stairs: refused, and no turn is spent (CMB-05).
  const before = await tickAt(page);
  await press(page, '<');
  expect((await state(page)).turn).toBe(before.turn);
  expect((await state(page)).floorNumber).toBe(1);

  // On the stairs: the next floor (WLD-10) and SCR-10's line.
  await press(page, 'l');
  await press(page, '<');
  const s = await state(page);
  expect(s.floorNumber).toBe(2);
  expect(s.log.some((l) => /^Tick climbs\. Floor 2: /.test(l.text))).toBe(true);
});

test('the inspect line describes whatever the mouse is over ACC-102 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  let map = emptyMap(6, 6, 30, 14);
  map = put(map, 10, 6, 's');
  map = put(map, 8, 6, '!');
  map = put(map, 6, 9, '&');
  map = put(map, 12, 9, '"');
  await loadFixture(page, map, { number: 4, items: { '!': 'Brass Plating' } });

  // UI-05 enemy: "Sweeper  7/7  hits you 55% for 1–3  · plating 0 · normal · dormant".
  await hoverCell(page, 10, 6);
  expect(await inspectText(page)).toMatch(/^Sweeper {2}7\/7 {2}hits you \d+% for \d+–\d+ {2}· plating 0/);

  // UI-05 item: "Brass Plating  [ plating 2  evasion −2".
  await hoverCell(page, 8, 6);
  expect(await inspectText(page)).toBe('Brass Plating  [ plating 2  evasion −2');

  // UI-05 feature.
  await hoverCell(page, 6, 9);
  expect(await inspectText(page)).toBe('Winding Station (unspent) — press e. Loud: wakes the floor.');

  // UI-05 hazard: "Steam Vent — active in 2 turns: 4 damage, Burning 2".
  await hoverCell(page, 12, 9);
  expect(await inspectText(page)).toMatch(/^Steam Vent — (active in \d+ turns?|ACTIVE): 4 damage, Burning 2$/);

  // UI-05 floor / wall.
  await hoverCell(page, 7, 7);
  expect(await inspectText(page)).toBe('Floor');
  await hoverCell(page, 0, 0);
  expect(await inspectText(page)).toBe('Wall');

  // UI-05: an unseen tile is blank. (30 x 14 map, so (28,12) is outside Chebyshev 8 of (6,6).)
  await hoverCell(page, 28, 12);
  expect(await inspectText(page)).toBe('');

  // A remembered tile still names itself, and the memory keeps its item (ACC-79).
  await loadFixture(page, put(emptyMap(6, 6, 40, 14), 14, 6, '!'), { number: 1, items: { '!': 'Solder' } });
  for (let i = 0; i < 12; i++) await press(page, 'h');
  const s = await state(page);
  expect(s.floor.memoryItems.some((m) => m.x === 14 && m.y === 6)).toBe(true);
  await hoverCell(page, 14, 6);
  // CAT-06 (DIF-03): the Solder line names the repair's total, its length and its Tension cost.
  const tuning = (await state(page)).tuning;
  expect(await inspectText(page)).toBe(
    `Solder  ! +${tuning.solderAmount} Integrity over ${tuning.solderTurns}, ${tuning.solderTension} Tension`,
  );

  // With nothing hovered the line is blank (UI-05's last bullet).
  await page.mouse.move(1, 1);
  expect(await inspectText(page)).toBe('');
});

test('right-click opens the inspect popup and three things close it ACC-103 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  let map = emptyMap(6, 6, 30, 14);
  map = put(map, 10, 6, 's');
  await loadFixture(page, map, { number: 1 });

  await clickCell(page, 10, 6, { button: 'right' });
  let text = screenText(await grid(page));
  // UI-11 / ENM-11: name, cur/max, hit % vs Tick, damage after Plating, Plating, speed, state,
  // statuses, description.
  expect(text).toContain('Sweeper');
  expect(text).toContain('Integrity 7/7');
  expect(text).toMatch(/Hits you \d+%/);
  expect(text).toMatch(/Damage \d+–\d+ after your plating/);
  expect(text).toContain('Plating 0');
  expect(text).toContain('Speed normal');
  expect(text).toContain('State dormant');
  expect(text).toContain('Statuses —');
  expect(text).toContain('Broom for an arm');

  // Free: no turn is spent (UI-11).
  const before = await state(page);
  expect(before.turn).toBe(0);

  // "Esc, right-click again, or any move key closes it."
  await key(page, 'Escape');
  expect(screenText(await grid(page))).not.toContain('Integrity 7/7');

  await clickCell(page, 10, 6, { button: 'right' });
  expect(screenText(await grid(page))).toContain('Integrity 7/7');
  await clickCell(page, 10, 6, { button: 'right' });
  expect(screenText(await grid(page))).not.toContain('Integrity 7/7');

  await clickCell(page, 10, 6, { button: 'right' });
  expect(screenText(await grid(page))).toContain('Integrity 7/7');
  await press(page, 'l');
  expect(screenText(await grid(page))).not.toContain('Integrity 7/7');

  // UI-11: hovering a side-panel stat shows its breakdown in the same popup style.
  await clickCell(page, 65, 3, { button: 'right' });
  const panelPopup = screenText(await grid(page));
  expect(panelPopup).toContain('Tension');
  expect(panelPopup).toMatch(/Drops 1 every \d+ turns/);
  await key(page, 'Escape');
});

test('targeting starts on the nearest enemy, cycles, and cancels for free ACC-112 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  // Equip the Launcher on an empty floor first, so the enemies of the real fixture have not had a
  // turn when targeting opens and no flash is pending.
  await loadFixture(page, put(emptyMap(6, 6, 30, 14), 7, 6, '}'), {
    number: 1,
    items: { '}': 'Spring-Bolt Launcher' },
  });
  await press(page, 'l');
  await press(page, 'g');
  await act(page, { type: 'equip', slot: 2 });
  // ITM-01 (DIF-07): an equipment slot holds `{name, wear}`, not a bare name.
  expect((await state(page)).tick.equipment.weapon.name).toBe('Spring-Bolt Launcher');

  // Two dormant Sweepers on one row, the far one behind the near one.
  let map = emptyMap(7, 6, 30, 14);
  map = put(map, 9, 6, 's');
  map = put(map, 11, 6, '1');
  await loadFixture(page, map, {
    number: 1,
    enemies: {
      s: { type: 'Sweeper', state: 'DORMANT' },
      1: { type: 'Sweeper', state: 'DORMANT' },
    },
  });

  const turnBefore = (await state(page)).turn;
  await press(page, 'f');

  // "the cursor starts on the nearest visible enemy (Chebyshev; ties: reading order)" — the
  // cursor inverts its cell (UI-07), and the inspect line follows it.
  let g = await grid(page);
  expect(g[6][9].bg).not.toBe('#0c0c10');
  expect(g[6][11].bg).toBe('#0c0c10');
  expect(await inspectText(page)).toContain('Sweeper');
  // TEC-08 excludes the start tile from the projectile path, so Tick's own tile is not inverted.
  expect(g[6][7].bg).toBe('#0c0c10');
  // The intermediate cell of the clear line is inverted, and not red.
  expect(g[6][8].bg).not.toBe('#0c0c10');
  expect(g[6][8].bg).not.toBe('#ff6060');

  // Tab cycles through the visible enemies by distance: the far Sweeper is next.
  await key(page, 'Tab');
  g = await grid(page);
  expect(g[6][11].bg).not.toBe('#0c0c10');
  // "the line of fire ... in red if the shot would stop early" — the near Sweeper blocks it.
  expect(g[6][8].bg).toBe('#ff6060');
  expect(g[6][9].bg).toBe('#ff6060');
  expect(g[6][11].bg).toBe('#ff6060');

  // Shift+Tab cycles back to the nearest.
  await key(page, 'Tab', { shift: true });
  g = await grid(page);
  expect(g[6][9].bg).not.toBe('#ff6060');
  expect(g[6][9].bg).not.toBe('#0c0c10');

  // Esc cancels with no turn spent.
  await key(page, 'Escape');
  expect((await state(page)).turn).toBe(turnBefore);
  expect((await grid(page))[6][9].bg).toBe('#0c0c10');

  // A click on a cell confirms it (UI-12), and the shot spends a turn and Tension.
  await press(page, 'f');
  const tensionBefore = (await state(page)).tick.tension;
  await clickCell(page, 9, 6);
  const s = await state(page);
  expect(s.turn).toBe(turnBefore + 1);
  expect(tensionBefore - s.tick.tension).toBeGreaterThanOrEqual(3);
  expect((await logRows(page)).join('\n')).toMatch(/Tick (shoots|'s shot misses)/);
});
