// The overlay screens: Inventory, Skills, Journal, Help, the Title's seed entry, the Pause menu's
// round trip, the text box, and the Death and Victory summaries (UI-14..UI-19, SCR-08, SCR-09).

import { test, expect } from '@playwright/test';
import {
  boot, newRun, grid, rowText, screenText, flatten, textboxText, act, loadFixture, emptyMap,
  put, key, press, clickCell, state, gainXp, timers, savedText,
} from './helpers.js';
import { RUN_KEYS, CURSOR_KEYS, INVENTORY_KEYS } from '../../src/screens/help.js';
import { SCRIPT } from '../../data/script.js';

/** UI-08's midGrey, which UI-14 uses for an action that does not apply. */
const MID_GREY = '#707070';

/** UI-17's menu rows (`src/screens/title.js`'s `MENU_ROW`). */
const MENU_ROW = 15;

/** UI-14's action-button row, inside the box that fills the map area. */
const BUTTON_ROW = 18;

test('the Inventory greys the actions that do not apply and uses the ones that do ACC-109 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  await loadFixture(page, emptyMap(6, 6, 30, 14), { number: 1 });

  let s = await state(page);
  expect(s.tick.inventory[0].name).toBe('Solder');
  const turnBefore = s.turn;

  await press(page, 'i');
  let g = await grid(page);
  let text = screenText(g);
  expect(text).toContain('INVENTORY');
  expect(text).toContain('a) Solder');
  expect(text).toContain('EQUIPPED');
  expect(text).toContain('W) Wrench');

  // Select the consumable and read the button row: `[e]quip` is greyed, `[u]se` is not (UI-14).
  await press(page, 'a');
  g = await grid(page);
  const buttonRow = rowText(g, BUTTON_ROW);
  const equipAt = buttonRow.indexOf('[e]quip');
  const useAt = buttonRow.indexOf('[u]se');
  expect(equipAt).toBeGreaterThan(0);
  expect(useAt).toBeGreaterThan(0);
  expect(g[BUTTON_ROW][equipAt].fg).toBe(MID_GREY);
  expect(g[BUTTON_ROW][useAt].fg).not.toBe(MID_GREY);

  // "Select a consumable, press `e` | Nothing (action greyed)."
  await press(page, 'e');
  s = await state(page);
  expect(s.turn).toBe(turnBefore);
  expect(s.tick.equipment.weapon).toBe('Wrench');
  expect(screenText(await grid(page))).toContain('INVENTORY');

  // "Press `u` | Used, screen closes, turn passes."
  await press(page, 'u');
  s = await state(page);
  expect(screenText(await grid(page))).not.toContain('INVENTORY');
  expect(s.turn).toBe(turnBefore + 1);
  // ITM-03 compacts the slots, so the Solder is simply gone from the inventory.
  expect(s.tick.inventory.some((slot) => slot && slot.name === 'Solder')).toBe(false);

  // ITM-02 / ACC-52: equipping a weapon from the inventory swaps it into the slot it came from.
  await loadFixture(page, put(emptyMap(6, 6, 30, 14), 7, 6, ')'), {
    number: 1,
    items: { ')': 'Mallet' },
  });
  await press(page, 'l');
  await press(page, 'g');
  s = await state(page);
  const malletSlot = s.tick.inventory.findIndex((slot) => slot && slot.name === 'Mallet');
  await press(page, 'i');
  await press(page, String.fromCharCode(97 + malletSlot));
  await press(page, 'e');
  s = await state(page);
  expect(s.tick.equipment.weapon.name).toBe('Mallet');
  expect(s.tick.inventory[malletSlot].name).toBe('Wrench');
  // The inventory stays open for `e` so a second slot can be filled without reopening it.
  expect(screenText(await grid(page))).toContain('INVENTORY');
  // Selecting the equipped weapon makes `[e]quip/unequip` apply again.
  await press(page, 'W');
  g = await grid(page);
  expect(g[BUTTON_ROW][rowText(g, BUTTON_ROW).indexOf('[e]quip')].fg).not.toBe(MID_GREY);
  await key(page, 'Escape');
  expect(screenText(await grid(page))).not.toContain('INVENTORY');
});

test('the Skills screen refuses a locked skill and takes an available one on y ACC-110 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  const gained = await gainXp(page, 4);
  expect(gained.skillPoints).toBe(1);
  // The level-up already opened the screen (UI-19).
  let text = screenText(await grid(page));
  expect(text).toContain('SKILLS');
  expect(text).toContain('Skill points: 1');
  expect(text).toContain('Armature');
  expect(text).toContain('Tinkering');
  expect(text).toContain('Resonance');
  // UI-15: available skills are marked `▸`, locked ones are not.
  expect(text).toContain('▸1. Braced Frame');
  expect(text).toContain(' 2. Overwind Strike');

  // "Select locked skill, Enter | Nothing." Rank 2 needs rank 1 first (CHR-09).
  await key(page, 'ArrowDown');
  expect(screenText(await grid(page))).toContain('Overwind Strike  —  Armature 2');
  expect(screenText(await grid(page))).toContain('Needs Braced Frame.');
  await key(page, 'Enter');
  expect(screenText(await grid(page))).not.toContain('Take *');
  let s = await state(page);
  expect(s.tick.skills).toEqual([]);
  expect(s.tick.skillPoints).toBe(1);

  // "Select available, Enter, `y` | Taken; SP −1."
  await key(page, 'ArrowUp');
  await key(page, 'Enter');
  // UI-15's confirmation prompt is "Take *Name*? y/n"; the markers render as violet, not text.
  text = screenText(await grid(page));
  expect(text).toContain('Take Braced Frame? y/n');
  // `n` cancels without spending the point.
  await press(page, 'n');
  s = await state(page);
  expect(s.tick.skills).toEqual([]);
  expect(s.tick.skillPoints).toBe(1);

  await key(page, 'Enter');
  await press(page, 'y');
  s = await state(page);
  expect(s.tick.skills).toEqual(['Braced Frame']);
  expect(s.tick.skillPoints).toBe(0);
  // SKL-02: Braced Frame gives +1 Plating and +6 max Integrity immediately (ACC-33).
  expect(screenText(await grid(page))).toContain('Skill points: 0');
  await key(page, 'Escape');

  // The full summary of the longest skill is shown, not truncated (SKL-01, D-025).
  await press(page, 's');
  await key(page, 'ArrowRight');
  await key(page, 'ArrowRight');
  await key(page, 'ArrowDown');
  await key(page, 'ArrowDown');
  await key(page, 'ArrowDown');
  expect(flatten(await grid(page))).toContain('Sympathetic Break');
  await key(page, 'ArrowLeft');
  const long = flatten(await grid(page));
  expect(long).toContain('Clockwork Decoy');
  // SKL-04's 79-character summary is shown in full, wrapped rather than truncated (D-025, D-093).
  expect(long).toContain('Place a 12-Integrity decoy; enemies within 8 target it for 6 turns. 15 Tension.');
  expect(long).not.toContain('…');
});

test('the Journal marks found pages and shows their exact text ACC-111 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  // SCR-04 / ITM-03: a journal page picked up goes to the Journal, not the inventory.
  for (const n of [1, 2, 3]) {
    await loadFixture(page, put(emptyMap(6, 6, 30, 14), 7, 6, '?'), {
      number: n,
      items: { '?': `Journal page ${n}` },
    });
    await press(page, 'l');
    await press(page, 'g');
  }
  let s = await state(page);
  expect(s.journal.pages.slice(0, 3)).toEqual([true, true, true]);
  expect(s.journal.pages.slice(3)).toEqual([false, false, false, false, false]);

  await press(page, 'r');
  const g = await grid(page);
  let text = screenText(g);
  // "list `Page 1 … Page 8` with found ones bright and unfound as `— not found —`" (UI-15).
  for (const n of [1, 2, 3]) expect(text).not.toContain(`Page ${n}  — not found —`);
  for (const n of [4, 5, 6, 7, 8]) expect(text).toContain(`Page ${n}  — not found —`);
  // Bright is UI-08's white; unfound is midGrey. Row 3 is page 1, row 6 is page 4.
  expect(g[3][6].fg).toBe('#ffffff');
  expect(g[6][6].fg).toBe(MID_GREY);

  // "Enter shows the exact `SCR-03` text".
  await key(page, 'Enter');
  text = flatten(await grid(page));
  expect(text).toContain('Page 1 — The Workshop');
  expect(text).toContain('Wound the first frame at six this morning.');
  expect(text).toContain('— A.V.');
  await key(page, 'Escape');
  expect(screenText(await grid(page))).toContain('— not found —');
  await key(page, 'Escape');

  // "page 8 renders with no signature" (SCR-03: it ends mid-sentence).
  await loadFixture(page, put(emptyMap(6, 6, 30, 14), 7, 6, '?'), {
    number: 8,
    items: { '?': 'Journal page 8' },
  });
  await press(page, 'l');
  await press(page, 'g');
  s = await state(page);
  expect(s.journal.pages[7]).toBe(true);
  await press(page, 'r');
  for (let i = 0; i < 7; i++) await key(page, 'ArrowDown');
  await key(page, 'Enter');
  text = flatten(await grid(page));
  expect(text).toContain('Page 8 — The Escapement');
  expect(text).toContain('Fourth attempt at this entry.');
  expect(text).not.toContain('— A.V.');
});

test('Help lists every key of UI-10, UI-12 and UI-14 and the six SCR-09 rules ACC-120 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  await loadFixture(page, emptyMap(6, 6, 30, 14), { number: 1 });

  await press(page, '?');
  // UI-16 lets the screen scroll; the union of the top and bottom views is the whole list.
  const top = screenText(await grid(page));
  await key(page, 'End');
  const bottom = screenText(await grid(page));
  const shown = `${top}\n${bottom}`;
  const flat = shown.replace(/\s+/g, ' ');

  expect(top).toContain('HELP');
  expect(shown).toContain('RUN SCREEN');
  expect(shown).toContain('LOOK AND TARGETING');
  expect(shown).toContain('INVENTORY');
  expect(shown).toContain('THE RULES');

  // Every key row of UI-10 (17 rows), UI-12 and UI-14 is on the screen, untruncated.
  expect(RUN_KEYS).toHaveLength(17);
  for (const [keys, action] of [...RUN_KEYS, ...CURSOR_KEYS, ...INVENTORY_KEYS]) {
    expect(flat, `key row "${keys}"`).toContain(keys);
    expect(flat, `action for "${keys}"`).toContain(action);
  }
  // Spot-checks straight out of UI-10's own table, so a lost row cannot hide behind the tables.
  for (const spelling of ['hjklyubn', 'numpad 1-9', '. or numpad 5 or z', 'g or ,',
    'c then a direction', '1 2 3 4', 'Shift + direction', 'Tab, Shift+Tab', 'a-j, W, P, A']) {
    expect(flat, spelling).toContain(spelling);
  }

  // "the six rule lines of `SCR-09` verbatim" — wrapped, never truncated (D-094).
  expect(SCRIPT.help).toHaveLength(6);
  for (const line of SCRIPT.help) expect(flat, line).toContain(line.replace(/\s+/g, ' '));
  expect(flat).not.toContain('…');

  await key(page, 'Escape');
  expect(screenText(await grid(page))).not.toContain('THE RULES');
});

test('a typed seed starts that run and the summary reports it ACC-118 @m10', async ({ page }) => {
  await boot(page);
  expect(await savedText(page)).toBeNull();

  // UI-17: "`Enter seed` shows a one-line text input (up to 16 characters, any printable)".
  await clickCell(page, 40, MENU_ROW + 1);
  expect(screenText(await grid(page))).toContain('Seed:');
  for (const ch of 'abc') await press(page, ch);
  expect(screenText(await grid(page))).toContain('Seed: abc_');
  await key(page, 'Enter');

  // "confirming starts a new run with that seed (`TEC-07`)" — the intro first (UI-19).
  expect(screenText(await grid(page))).toContain('The Hollow is a clock tower');
  await key(page, 'Enter');
  let s = await state(page);
  expect(s.seedString).toBe('abc');

  // "summary later shows `Seed abc`" (SCR-08's label is `Seed {seed}`).
  let map = emptyMap(5, 5, 20, 10);
  for (const [x, y] of [[4, 4], [6, 6], [6, 4], [4, 6]]) map = put(map, x, y, 'k');
  await loadFixture(page, map, { number: 4, enemies: { k: { type: 'Stoker', state: 'ACTIVE' } } });
  const waits = await page.evaluate(() => {
    for (let i = 0; i < 400; i++) {
      if (window.CH.state.dead) return i;
      window.CH.act({ type: 'wait' });
    }
    return -1;
  });
  expect(waits).toBeGreaterThanOrEqual(0);
  const text = screenText(await grid(page));
  expect(text).toContain('Seed abc');
  s = await state(page);
  expect(s.seedString).toBe('abc');
});

test('the Death screen carries SCR-08 header, flavor and summary ACC-117 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');

  // ACC-117: Integrity 0 by a Stoker on floor 4.
  let map = emptyMap(5, 5, 20, 10);
  for (const [x, y] of [[4, 4], [6, 6], [6, 4], [4, 6]]) map = put(map, x, y, 'k');
  await loadFixture(page, map, { number: 4, enemies: { k: { type: 'Stoker', state: 'ACTIVE' } } });
  await page.evaluate(() => {
    for (let i = 0; i < 400; i++) {
      if (window.CH.state.dead) return;
      window.CH.act({ type: 'wait' });
    }
  });

  const s = await state(page);
  expect(s.tick.integrity).toBeLessThanOrEqual(0);
  expect(s.log.some((l) => /^Tick was broken by (the Stoker|Burning) on floor 4\.$/.test(l.text))).toBe(true);

  const text = screenText(await grid(page));
  expect(text).toContain(SCRIPT.screens.broken.header);
  expect(text).toContain(SCRIPT.screens.broken.flavor);
  // STY-08's two-column table.
  for (const label of ['Floor reached', 'Turns', 'Enemies broken', 'Level', 'Skills',
    'Weapon', 'Plating', 'Attachment']) {
    expect(text, label).toContain(label);
  }
  expect(text).toContain('Journal pages 0/8');
  expect(text).toContain('Seed TEST1234');
  expect(text).toContain(SCRIPT.summaryFooter);

  // TEC-12: the seed is also in the hidden input, selected, so Ctrl+C copies it.
  const seedInput = await page.evaluate(() => {
    const el = document.getElementById('seed');
    return { value: el.value, hidden: el.hidden, start: el.selectionStart, end: el.selectionEnd };
  });
  expect(seedInput.value).toBe('TEST1234');
  expect(seedInput.hidden).toBe(false);
  expect(seedInput.end - seedInput.start).toBe('TEST1234'.length);

  // ACC-03 / TEC-09: the save is gone, and the Title offers no Continue.
  expect(await savedText(page)).toBeNull();
  await key(page, 'Enter');
  const title = screenText(await grid(page));
  expect(title).toContain('CLOCKWORK HOLLOW');
  expect(title).not.toContain('Continue');
});

test('Pause quits to the Title and Continue resumes the run exactly ACC-119 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  await loadFixture(page, emptyMap(6, 6, 30, 14), { number: 1 });
  for (let i = 0; i < 6; i++) await act(page, { type: 'wait' });
  await act(page, { type: 'move', dx: 1, dy: 0 });

  const before = await state(page);
  const beforeJson = JSON.stringify({ ...before, log: null });
  const beforeLog = before.log.map((l) => `${l.text}|${l.count}`);

  // UI-18: Esc → Quit to title. "the autosave remains; Continue resumes it".
  await key(page, 'Escape');
  expect(screenText(await grid(page))).toContain('PAUSED');
  await clickCell(page, 30, 12);
  const title = screenText(await grid(page));
  expect(title).toContain('CLOCKWORK HOLLOW');
  expect(title).toContain('Continue');
  expect(title).toContain(`Floor ${before.floorNumber}, turn ${before.turn}`);
  expect(await savedText(page)).not.toBeNull();

  await clickCell(page, 40, MENU_ROW + 1);
  const after = await state(page);
  expect(JSON.stringify({ ...after, log: null })).toBe(beforeJson);
  // TEC-09's restore line is the only difference in the log.
  expect(after.log.map((l) => `${l.text}|${l.count}`)).toEqual([...beforeLog, 'Tick resumes.|1']);
  expect(await timers(page)).toBe(0);

  // The run continues from exactly there.
  await act(page, { type: 'wait' });
  expect((await state(page)).turn).toBe(before.turn + 1);
});

test('a text box blocks the turn loop until it is dismissed ACC-114 @m10', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.CH.newRun('TEST1234'));

  // "The game does not advance while it is open" (UI-16) — the engine refuses every action.
  const refused = await act(page, { type: 'move', dx: 1, dy: 0 });
  expect(refused).toEqual({ ok: false, reason: 'awaitDismiss' });
  expect((await state(page)).turn).toBe(0);
  expect(await page.evaluate(() => window.CH.game.phase)).toBe('awaitDismiss');

  // The exact SCR-02 text, wrapped by the renderer (TEC-10).
  let text = textboxText(await grid(page));
  expect(text).toContain('The Hollow is a clock tower above the harbor town of Lowmere.');
  expect(text).toContain('— more —');
  // UI-16: "Text longer than the box scrolls with arrows/wheel and shows `— more —` on the last
  // line until the end is reached."
  await key(page, 'ArrowDown');
  expect(textboxText(await grid(page))).toContain('— more —');
  await key(page, 'End');
  text = textboxText(await grid(page));
  expect(text).toContain('The others are still running their last orders. They will not stop for you.');
  expect(text).toContain('Climb.');
  expect(text).toContain('— any key —');
  expect(text).not.toContain('— more —');

  // "Dismissed by any key or click."
  await key(page, 'Enter');
  expect(await page.evaluate(() => window.CH.game.phase)).toBe('run');
  expect(screenText(await grid(page))).not.toContain('The Hollow is a clock tower');

  // A scripted moment behaves the same way, and a click dismisses it (SCR-05).
  await loadFixture(page, put(emptyMap(5, 5, 20, 10), 6, 5, 'U'), {
    number: 8,
    enemies: { U: { type: 'The Understudy', integrity: 1, state: 'ACTIVE' } },
  });
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) {
      if (window.CH.game.phase !== 'run') return;
      window.CH.act({ type: 'move', dx: 1, dy: 0 });
    }
  });
  text = textboxText(await grid(page));
  expect(text).toContain('The Understudy kneels.');
  expect(text).toContain('"Turn it, then. Someone has to."');
  await clickCell(page, 30, 12);
  text = textboxText(await grid(page));
  expect(text).toContain(SCRIPT.moments['3b'].replace(/\*/g, ''));
});

test('Ending A shows page 8, the ending text and THE KEEPER ACC-115 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  await loadFixture(page, put(emptyMap(5, 5, 20, 10), 6, 5, 'U'), {
    number: 8,
    enemies: { U: { type: 'The Understudy', integrity: 1, state: 'ACTIVE' } },
  });
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) {
      if (window.CH.game.phase !== 'run') return;
      window.CH.act({ type: 'move', dx: 1, dy: 0 });
    }
  });
  // moment 3a → moment 3b → the ending choice (UI-19).
  await key(page, 'Enter');
  await key(page, 'Enter');
  let text = textboxText(await grid(page));
  expect(text).toContain('The Master Key fits any mainspring.');
  expect(text).toContain('A) Wind the tower');
  expect(text).toContain('B) Wind yourself');

  // "No cancel" (UI-17).
  await key(page, 'Escape');
  expect(textboxText(await grid(page))).toContain('A) Wind the tower');

  await press(page, 'a');
  // Page 8 as a Journal view, with no signature (SCR-03).
  text = flatten(await grid(page));
  expect(text).toContain('JOURNAL');
  expect(text).toContain('Page 8 — The Escapement');
  expect(text).not.toContain('— A.V.');
  expect((await state(page)).journal.pages[7]).toBe(true);

  await key(page, 'Enter');
  text = textboxText(await grid(page));
  expect(text).toContain('You set the Key into the Escapement and turn it.');

  await key(page, 'End');
  await key(page, 'Enter');
  text = screenText(await grid(page));
  expect(text).toContain(SCRIPT.screens.keeper.header);
  expect(text).toContain(SCRIPT.screens.keeper.flavor);
  expect(text).toContain('Journal pages 1/8');
  expect(text).toContain('Seed TEST1234');
  expect(text).toContain(SCRIPT.summaryFooter);
  expect((await state(page)).victory.ending).toBe('A');
  // TEC-09: the save is deleted on victory.
  expect(await savedText(page)).toBeNull();

  // UI-19: "Death / Victory | any key | Title".
  await key(page, 'Enter');
  const title = screenText(await grid(page));
  expect(title).toContain('CLOCKWORK HOLLOW');
  expect(title).not.toContain('Continue');
});

test('Ending B walks the seven descent lines then THE WALKER ACC-116 @m10', async ({ page }) => {
  await boot(page);
  await newRun(page, 'TEST1234');
  await loadFixture(page, put(emptyMap(5, 5, 20, 10), 6, 5, 'U'), {
    number: 8,
    enemies: { U: { type: 'The Understudy', integrity: 1, state: 'ACTIVE' } },
  });
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) {
      if (window.CH.game.phase !== 'run') return;
      window.CH.act({ type: 'move', dx: 1, dy: 0 });
    }
  });
  await key(page, 'Enter');
  await key(page, 'Enter');
  await press(page, 'b');

  // Page 8 first (UI-19's row).
  expect(screenText(await grid(page))).toContain('Page 8 — The Escapement');
  await key(page, 'Enter');

  // SCR-07: seven lines, one at a time, each held 1.5 s — a timer runs while they play.
  expect(await timers(page)).toBe(1);
  expect(screenText(await grid(page))).toContain(SCRIPT.descent[0]);
  expect(screenText(await grid(page))).not.toContain(SCRIPT.descent[1]);
  expect(SCRIPT.descent).toHaveLength(7);

  // The next line replaces it after 1.5 s.
  await page.waitForTimeout(1700);
  expect(screenText(await grid(page))).toContain(SCRIPT.descent[1]);

  // "(skippable)".
  await key(page, 'Enter');
  expect(await timers(page)).toBe(0);
  let text = textboxText(await grid(page));
  expect(text).toContain('You set the Key into your own spring and turn it.');

  await key(page, 'End');
  await key(page, 'Enter');
  text = screenText(await grid(page));
  expect(text).toContain(SCRIPT.screens.walker.header);
  expect(text).toContain(SCRIPT.screens.walker.flavor);
  expect((await state(page)).victory.ending).toBe('B');
  expect(await savedText(page)).toBeNull();
});
