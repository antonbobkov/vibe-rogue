// M08 — the three boss scripts of `22-bestiary.md`: BST-03's framework, BST-04 (The Conductor),
// BST-05 (The Regulator) and BST-06 (The Understudy).
//
// Every test that needs randomness passes `rng: queueRng([...])` and states each draw in the order
// TEC-07 fixes (hit roll, then damage dice; enemies in id order). Flat dice consume no draw; every
// break consumes one ITM-11 `d100` (`DROP_ROLL`).

import test from 'node:test';
import assert from 'node:assert/strict';

import * as bosses from '../../src/bosses.js';
import * as combat from '../../src/combat.js';
import { createGame } from '../../src/engine.js';
import { generateFloor, loadFixedFloor } from '../../src/gen.js';
import { speedOf, cappedDuration, BOSS_STATUS_CAPS } from '../../src/actors.js';
import { queueRng } from '../../src/rng.js';
import { SCRIPT } from '../../data/script.js';
import { ENEMIES_BY_NAME } from '../../data/enemies.js';
import { fixtureGame, floorFromAscii, d100, die, DROP_ROLL } from '../fixtures/maps.js';
import { enemyPopup } from '../../src/screens/inspect.js';

const WIDTH = 60;

/** One row of a fixture map, padded to 60 columns with Wall. */
const row = (s) => s.padEnd(WIDTH, '#').slice(0, WIDTH);

/** An open arena `h` rows tall, walled all round — no doors, no hazards, no items. */
function arena(h) {
  const out = ['#'.repeat(WIDTH)];
  for (let y = 1; y <= h; y++) out.push(row('#' + '.'.repeat(WIDTH - 2) + '#'));
  out.push('#'.repeat(WIDTH));
  return out;
}

const texts = (result) => result.log.map((line) => line.text);
const names = (state, type) => state.floor.enemies.filter((e) => e.type === type);

/** Floor 8 (FLR-09) with BST-06's entry trigger already fired and its text box dismissed. */
function floor8(rng) {
  const game = createGame({ seedString: 'FIXTURE', rng, floor: loadFixedFloor(8), intro: false });
  // Tick starts at (5,4); five steps reach (10,4) and the sixth opens the `+` at (11,4).
  for (let i = 0; i < 6; i++) game.act({ type: 'move', dx: 1, dy: 0 });
  game.act({ type: 'dismiss' });
  return game;
}

const understudyOf = (game) => game.state.floor.enemies.find((e) => e.type === 'The Understudy');

/** SCR-06's lines are text boxes, so a phase threshold stops the loop until one is dismissed. */
function clearBoxes(game) {
  let guard = 0;
  while (game.phase === 'awaitDismiss' && guard++ < 8) game.act({ type: 'dismiss' });
}

// BST-06's spring is a balance number (it is a failsafe, not a race the player can win), so these
// tests take it from the data rather than restating it — the rule under test is "2 an action".
const SPRING_MAX = ENEMIES_BY_NAME['The Understudy'].tension;

// ---------------------------------------------------------------------------------------------
// BST-03 — the framework
// ---------------------------------------------------------------------------------------------

test('@unit bosses: the phase thresholds are 16, 24, and 48 / 24 (BST-04, BST-05, BST-06) @m08', () => {
  assert.equal(bosses.CONDUCTOR_PHASE_2, 16);
  assert.equal(bosses.phaseFor('CONDUCTOR', 17), 1);
  assert.equal(bosses.phaseFor('CONDUCTOR', 16), 2);
  assert.equal(bosses.phaseFor('CONDUCTOR', 1), 2);

  assert.equal(bosses.REGULATOR_PHASE_2, 24);
  assert.equal(bosses.phaseFor('REGULATOR', 25), 1);
  assert.equal(bosses.phaseFor('REGULATOR', 24), 2);

  assert.equal(bosses.UNDERSTUDY_PHASE_2, 48);
  assert.equal(bosses.UNDERSTUDY_PHASE_3, 24);
  assert.equal(bosses.phaseFor('UNDERSTUDY', 49), 1);
  assert.equal(bosses.phaseFor('UNDERSTUDY', 48), 2);
  assert.equal(bosses.phaseFor('UNDERSTUDY', 25), 2);
  assert.equal(bosses.phaseFor('UNDERSTUDY', 24), 3);
});

test('@unit bosses: the BST-03 status caps are Stunned 1, Slowed 2, Exposed 2, Blinded 2 @m08', () => {
  assert.deepEqual(BOSS_STATUS_CAPS, { Stunned: 1, Slowed: 2, Exposed: 2, Blinded: 2 });

  // A boss and a regular enemy on the same floor: only the boss's durations are reduced.
  const withBoss = fixtureGame(bossArena('C', 's'), { number: 3, rng: queueRng([]) });
  const state = withBoss.state;
  const conductor = state.floor.enemies.find((e) => e.type === 'The Conductor');
  const sweeper = state.floor.enemies.find((e) => e.type === 'Sweeper');
  for (const [status, cap] of Object.entries(BOSS_STATUS_CAPS)) {
    assert.equal(cappedDuration(state, conductor, status, cap + 3), cap, status);
    assert.equal(cappedDuration(state, sweeper, status, cap + 3), cap + 3, `not ${status} on a Sweeper`);
    assert.equal(cappedDuration(state, state.tick, status, cap + 3), cap + 3, `not ${status} on Tick`);
  }
  // "Burning is uncapped."
  assert.equal(cappedDuration(state, conductor, 'Burning', 9), 9);
});

test('ACC-97: a boss reduces Stunned 3 to 1 and Exposed 4 to 2 @m08', () => {
  for (const glyph of ['C', 'R', 'U']) {
    const game = fixtureGame(bossArena(glyph), { number: 3, rng: queueRng([]) });
    const boss = game.state.floor.enemies[0];
    const ctx = game.ctx;

    combat.applyStatus(ctx, boss, 'Stunned', 3);
    combat.applyStatus(ctx, boss, 'Exposed', 4);
    assert.equal(boss.statuses.Stunned, 1, `${boss.type}: Stunned 3 becomes 1`);
    assert.equal(boss.statuses.Exposed, 2, `${boss.type}: Exposed 4 becomes 2`);

    // CMB-10 is checked first: an immunity beats the cap (BST-05 Slowed/Burning, BST-06 Slowed).
    combat.applyStatus(ctx, boss, 'Slowed', 4);
    const immune = glyph === 'R' || glyph === 'U';
    assert.equal(boss.statuses.Slowed, immune ? undefined : 2, `${boss.type}: Slowed`);
  }
});

/** Put `glyph` at (x, y) on an arena row, keeping the walls. */
function withActor(rows, y, glyph, x) {
  const out = rows.slice();
  const line = out[y].split('');
  line[x] = glyph;
  out[y] = line.join('');
  return out;
}

/**
 * An arena with Tick at (2,4) and the given glyphs from x 20 on — far enough apart that no actor is
 * ever adjacent, so a status assertion is never disturbed by an attack. `floorFromAscii` needs a
 * literal `T`, so it is written into the row rather than left to the fixture's default.
 */
function bossArena(...glyphs) {
  let rows = withActor(arena(6), 4, 'T', 2);
  glyphs.forEach((g, i) => {
    rows = withActor(rows, 4, g, 20 + i * 2);
  });
  return rows;
}

// ---------------------------------------------------------------------------------------------
// BST-04 — The Conductor
// ---------------------------------------------------------------------------------------------

test('ACC-93: the Conductor stands in floor 3\'s stairs room and is Active from the floor start @m08', () => {
  const data = generateFloor('TEST1234', 3);
  const spawn = data.spawns.find((s) => s.type === 'The Conductor');
  assert.ok(spawn, 'FLR-04: floor 3 spawns The Conductor');
  assert.equal(spawn.isBoss, true);

  const stairs = data.rooms.find((r) => r.id === data.roles.stairs);
  assert.ok(
    spawn.x >= stairs.x && spawn.x < stairs.x + stairs.w && spawn.y >= stairs.y && spawn.y < stairs.y + stairs.h,
    `BST-04: the Conductor is on an interior tile of the stage (stairs) room, not (${spawn.x}, ${spawn.y})`,
  );

  const game = createGame({ seedString: 'TEST1234', rng: queueRng([]), floorNumber: 3, intro: false });
  const boss = game.state.floor.enemies.find((e) => e.type === 'The Conductor');
  assert.equal(boss.state, 'ACTIVE', 'BST-04: entry trigger = floor start');
  assert.equal(boss.bossSeen, undefined, 'but it has not seen Tick yet');
  assert.equal(boss.bossActions, undefined, 'and Waits before first sight do not increment n');
});

test('ACC-93: entering the stage room\'s FOV shows moment 1 and the Conductor counts Tick as seen @m08', () => {
  const rows = arena(8);
  // Tick at (2,4); the stage room's interior is x 18..22, y 2..6 with the Conductor at (20,4).
  rows[4] = row('#.T' + '.'.repeat(17) + 'C' + '.'.repeat(WIDTH - 22) + '#');
  const floor = floorFromAscii(rows, { number: 3 });
  floor.rooms = [{ id: 0, x: 18, y: 2, w: 5, h: 5, cx: 20, cy: 4 }];
  floor.roles = { stairs: 0 };
  const game = createGame({ seedString: 'FIXTURE', rng: queueRng([]), floor, intro: false });
  const boss = game.state.floor.enemies[0];

  // Seven steps keep the whole room outside Tick's radius-8 FOV (WLD-05).
  for (let i = 0; i < 7; i++) {
    const step = game.act({ type: 'move', dx: 1, dy: 0 });
    assert.equal(step.events.length, 0, `step ${i + 1} shows nothing`);
    assert.equal(game.phase, 'run');
  }

  const arrival = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.deepEqual(
    arrival.events,
    [{ type: 'textbox', id: 'moment1', text: SCRIPT.moments[1] }],
    'SCR-05: moment 1, verbatim from data/script.js',
  );
  assert.equal(game.phase, 'awaitDismiss', 'STY-05: play does not resume until it is dismissed');
  assert.equal(boss.bossSeen, true, 'FLR-04: at that moment the Conductor counts Tick as seen');
  assert.deepEqual(boss.lastKnown, { x: game.state.tick.x, y: game.state.tick.y });
  assert.equal(boss.bossActions, 0, 'BST-04: its action counter starts at 0 on first sight');

  // STY-05: the moment fires once.
  game.act({ type: 'dismiss' });
  const after = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.deepEqual(after.events.filter((e) => e.type === 'textbox'), []);
});

test('ACC-93: every third Conductor action telegraphs, the next summons two Dancers, and four alive is the cap @m08', () => {
  const rows = arena(8);
  rows[4] = row('#....C..T' + '.'.repeat(WIDTH - 10) + '#');
  // No stairs room is declared, so moment 1 never interrupts; Tick keeps its distance by stepping
  // away each turn, so nothing is ever adjacent and no attack draws any dice.
  const game = fixtureGame(rows, { number: 3, rng: queueRng([]) });
  const state = game.state;
  const boss = state.floor.enemies[0];
  const step = () => game.act({ type: 'move', dx: 1, dy: 0 });

  step(); // n 0 -> CHASER
  assert.equal(boss.bossSeen, true, 'BST-04: first sight starts the script');
  step(); // n 1 -> CHASER
  assert.equal(boss.windingUp, false);

  const telegraph = step(); // n 2 -> the Downbeat's telegraph
  assert.deepEqual(texts(telegraph), ['The Conductor raises the baton.']);
  assert.equal(telegraph.log[0].color, 'violet', 'UI-04: boss lines are scripted colour');
  assert.equal(boss.windingUp, true);
  assert.equal(names(state, 'Music-box Dancer').length, 0);

  const stage = { x: boss.x, y: boss.y };
  const downbeat = step(); // n 3 -> Downbeat
  assert.deepEqual(texts(downbeat), ['The Conductor brings the baton down.']);
  assert.equal(boss.windingUp, false);
  const dancers = names(state, 'Music-box Dancer');
  assert.equal(dancers.length, 2, 'BST-04: two dancers');
  assert.deepEqual(
    dancers.map((d) => ({ x: d.x, y: d.y })),
    [
      { x: stage.x - 1, y: stage.y - 1 },
      { x: stage.x, y: stage.y - 1 },
    ],
    'the two free adjacent tiles first in reading order',
  );
  for (const d of dancers) {
    assert.equal(d.state, 'ACTIVE');
    assert.deepEqual(d.lastKnown, { x: state.tick.x, y: state.tick.y });
    assert.equal(d.summonedBy, boss.id);
    assert.ok(d.id > boss.id, 'SKL-03: a summon takes a fresh floor.nextEnemyId');
  }
  assert.equal(state.floor.nextEnemyId, dancers[1].id + 1);

  step(); // n 4
  step(); // n 5 -> telegraph
  const second = step(); // n 6 -> Downbeat
  assert.deepEqual(texts(second), ['The Conductor brings the baton down.']);
  assert.equal(names(state, 'Music-box Dancer').length, 4, 'four alive');

  step(); // n 7
  step(); // n 8 -> telegraph
  const capped = step(); // n 9 -> Downbeat with the cap reached
  assert.deepEqual(texts(capped), ['The Conductor brings the baton down.'], 'the action still happens');
  assert.equal(names(state, 'Music-box Dancer').length, 4, 'BST-04: at the cap Downbeat summons nothing');
});

test('ACC-93: at Integrity 16 the Conductor logs its tempo line, turns FAST, and summons no more @m08', () => {
  const rows = arena(8);
  rows[4] = row('#....C..T' + '.'.repeat(WIDTH - 10) + '#');
  const game = fixtureGame(rows, { number: 3, rng: queueRng([]) });
  const state = game.state;
  const boss = state.floor.enemies[0];
  game.act({ type: 'move', dx: 1, dy: 0 }); // first sight

  assert.equal(speedOf(state, boss), 'NORMAL', 'BST-04: NORMAL in Phase 1');
  boss.integrity = 17;
  boss.windingUp = true;
  combat.damage(game.ctx, boss, 2, {}); // 2 - plating 1 = 1, crossing to 16

  assert.equal(boss.integrity, 16);
  assert.equal(boss.phase, 2);
  assert.equal(state.log[state.log.length - 1].text, "The Conductor's tempo doubles.");
  assert.equal(state.log[state.log.length - 1].color, 'violet');
  assert.equal(speedOf(state, boss), 'FAST', 'BST-04: Speed becomes FAST');
  assert.equal(boss.windingUp, false, 'the Phase 1 wind-up goes with the script that used it');

  // FAST is 200 energy a phase: two actions per turn, and never a telegraph or a summon again.
  const before = boss.bossActions;
  game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(boss.bossActions - before, 2, 'CMB-03: FAST acts twice per turn');
  assert.equal(boss.windingUp, false);
  assert.equal(names(state, 'Music-box Dancer').length, 0);
});

// ---------------------------------------------------------------------------------------------
// BST-05 — The Regulator
// ---------------------------------------------------------------------------------------------

test('ACC-94: the Regulator wakes when the stairs room enters Tick\'s FOV, or on a noise @m08', () => {
  const rows = arena(8);
  rows[4] = row('#.T' + '.'.repeat(17) + 'R' + '.'.repeat(WIDTH - 22) + '#');
  const floor = floorFromAscii(rows, { number: 6 });
  floor.rooms = [{ id: 0, x: 18, y: 2, w: 5, h: 5, cx: 20, cy: 4 }];
  floor.roles = { stairs: 0 };
  const game = createGame({ seedString: 'FIXTURE', rng: queueRng([]), floor, intro: false });
  const boss = game.state.floor.enemies[0];
  assert.equal(boss.state, 'DORMANT', 'BST-05: Dormant before the trigger');

  for (let i = 0; i < 7; i++) game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(boss.state, 'DORMANT');
  game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(boss.state, 'ACTIVE', 'BST-05: the stairs room in FOV is the entry trigger');
  assert.deepEqual(boss.lastKnown, { x: game.state.tick.x, y: game.state.tick.y });
  assert.deepEqual(game.state.floor.bossFlags, { regulatorEntered: true });

  // "it can also be woken by noise like any enemy, which counts as the trigger" (ENM-04).
  const quiet = createGame({
    seedString: 'FIXTURE',
    rng: queueRng([]),
    floor: (() => {
      const f = floorFromAscii(rows, { number: 6 });
      f.rooms = floor.rooms;
      f.roles = floor.roles;
      return f;
    })(),
    intro: false,
  });
  const sleeper = quiet.state.floor.enemies[0];
  combat.noise(quiet.ctx, sleeper.x, sleeper.y, 6);
  assert.equal(sleeper.state, 'ACTIVE');
});

test('ACC-94: Phase 1 is BRUISER with the 3d5 heavy and its two BST-05 log lines @m08', () => {
  const rows = arena(8);
  rows[4] = row('#.T.R' + '.'.repeat(WIDTH - 6) + '#');
  const game = fixtureGame(rows, {
    number: 6,
    // The heavy: one d100 hit roll (75 + 10 heavy - 10 evasion = 75) then three d5.
    rng: queueRng([d100(50), die(5, 5), die(5, 5), die(5, 5)]),
    enemies: { R: { state: 'ACTIVE', lastKnown: { x: 2, y: 4 } } },
  });
  const state = game.state;
  const boss = state.floor.enemies[0];
  assert.equal(speedOf(state, boss), 'SLOW', 'BST-05: SLOW in Phase 1');

  const seen = [];
  for (let t = 0; t < 6; t++) seen.push(texts(game.act({ type: 'wait' })).join(''));
  assert.deepEqual(
    seen.filter(Boolean),
    ["The Regulator's arm ratchets back.", "The Regulator's arm drops.The Regulator hits Tick for 15."],
    'ENM-06 BRUISER: telegraph one turn, heavy the next',
  );
  assert.equal(state.tick.integrity, 25, '3d5 at 5,5,5 = 15 against Plating 0');
  assert.equal(boss.windingUp, false);
});

test('ACC-94: at Integrity 24 the Regulator turns NORMAL and every fourth action Vents @m08', () => {
  const rows = arena(8);
  rows[4] = row('#.T..R' + '.'.repeat(WIDTH - 7) + '#');
  const game = fixtureGame(rows, {
    // One d100 for the heavy that misses on the third action (75 + 10 - 10 = 75 to hit).
    number: 6,
    rng: queueRng([d100(100)]),
    enemies: { R: { state: 'ACTIVE', lastKnown: { x: 2, y: 4 }, integrity: 25 } },
  });
  const state = game.state;
  const boss = state.floor.enemies[0];

  combat.damage(game.ctx, boss, 5, {}); // 5 - plating 4 = 1, crossing to 24
  assert.equal(boss.integrity, 24);
  assert.equal(boss.phase, 2);
  assert.equal(state.log[state.log.length - 1].text, "The Regulator's governor spins free.");
  assert.equal(speedOf(state, boss), 'NORMAL', 'BST-05: Speed becomes NORMAL');

  // The wind-up flags are read after each turn, not after the loop: they are cleared by the very
  // action they set up, so only a per-turn snapshot can see them raised (D-078).
  const seen = [];
  const flags = [];
  for (let t = 0; t < 5; t++) {
    seen.push(texts(game.act({ type: 'wait' })));
    flags.push({ windingUp: boss.windingUp === true, ventingUp: boss.ventingUp === true });
  }
  assert.deepEqual(seen[2], ["The Regulator's arm ratchets back."], 'n 2 -> the BRUISER fallback');
  assert.deepEqual(flags[2], { windingUp: true, ventingUp: false }, 'the heavy hit is pending');
  assert.deepEqual(seen[3], ["The Regulator's seams glow."], 'n 3 -> the Vent telegraph');
  assert.deepEqual(
    flags[3],
    { windingUp: false, ventingUp: true },
    'BST-05: `ventingUp = true` and `windingUp = false` — the pending heavy hit is dropped',
  );
  assert.deepEqual(
    seen[4],
    ['Steam bursts from the Regulator.', 'Tick takes 4 from the Vent.', 'Tick is Burning.'],
    'BST-05: 4 damage ignoring Plating and Burning 2, at radius 2',
  );
  assert.equal(boss.ventingUp, false, 'the Vent clears it');
  assert.equal(state.tick.integrity, 36, '4 damage, Plating ignored');
  assert.equal(state.tick.statuses.Burning, 2);
  assert.equal(bosses.VENT_RADIUS, 2);
  assert.equal(bosses.VENT_NOISE, 6);
});

// ---------------------------------------------------------------------------------------------
// BST-06 — The Understudy
// ---------------------------------------------------------------------------------------------

test('ACC-95: opening the antechamber door shows line 1 and wakes the Understudy @m08', () => {
  const game = createGame({ seedString: 'FIXTURE', rng: queueRng([]), floor: loadFixedFloor(8), intro: false });
  const state = game.state;
  const boss = understudyOf(game);
  assert.deepEqual({ x: boss.x, y: boss.y }, { x: 51, y: 5 }, 'FLR-09: the `U` tile');
  assert.equal(boss.state, 'DORMANT');
  assert.equal(boss.tension, SPRING_MAX, "BST-06: its own spring starts at the type's `tension`");

  for (let i = 0; i < 5; i++) {
    const step = game.act({ type: 'move', dx: 1, dy: 0 });
    assert.deepEqual(step.events, []);
  }
  const open = game.act({ type: 'move', dx: 1, dy: 0 });
  // SCR-06 line 1 is a box *and* a log line, so a box skipped on a stray key is still recoverable.
  assert.deepEqual(texts(open), ['Tick opens the door.', SCRIPT.understudy[1]]);
  assert.deepEqual(
    open.events,
    [{ type: 'textbox', id: 'understudy1', text: SCRIPT.understudy[1] }],
    'SCR-06 line 1, verbatim from data/script.js',
  );
  assert.equal(game.phase, 'awaitDismiss');
  assert.equal(boss.state, 'ACTIVE');
  assert.deepEqual(boss.lastKnown, { x: 10, y: 4 }, 'BST-06: lastKnown = Tick\'s tile');
  assert.deepEqual(game.state.floor.bossFlags, { understudyEntered: true });

  // A second door is not a second trigger.
  game.act({ type: 'dismiss' });
  assert.equal(game.phase, 'run');
  assert.equal(state.floor.enemies.filter((e) => e.type === 'The Understudy').length, 1);
});

test('ACC-95: Phase 1 Overwind fires on the action after the fourth, and the spring falls 2 an action @m08', () => {
  const game = floor8(
    // Three plain melee attacks that miss (85 - 10 = 75 to hit), then the Overwind: one d100 at
    // 85 + 15 - 10 = 90, then `2d4` twice = four d4.
    queueRng([d100(100), d100(100), d100(100), d100(50), die(4, 4), die(4, 4), die(4, 4), die(4, 4)]),
  );
  const state = game.state;
  const boss = understudyOf(game);
  state.tick.x = 50;
  state.tick.y = 5; // adjacent to the Understudy at (51,5)

  const seen = [];
  for (let t = 0; t < 5; t++) seen.push(texts(game.act({ type: 'wait' })));
  assert.deepEqual(seen[0], ['The Understudy misses Tick.']);
  assert.deepEqual(seen[3], ['The Understudy tightens.'], 'BST-06: n mod 4 == 3 and adjacent');
  assert.deepEqual(
    seen[4],
    ["The Understudy's arm unwinds all at once.", 'The Understudy hits Tick for 16.'],
    'Overwind: 2d4 twice at 4,4,4,4 = 16',
  );
  assert.equal(boss.windingUp, false);
  assert.equal(state.tick.integrity, 24);
  assert.equal(boss.tension, SPRING_MAX - 5 * bosses.SPRING_COST, 'BST-06: five actions at 2 each');
  assert.equal(bosses.OVERWIND_DICE, '4d4');
  assert.equal(bosses.OVERWIND_ACCURACY, 15);
});

test('ACC-95: at Integrity 48 the Understudy speaks line 2 and two Unfinished appear at the markers @m08', () => {
  const free = floor8(queueRng([]));
  // With the markers empty the summons stand on them exactly (WLD-13, BST-06).
  free.state.floor.enemies = free.state.floor.enemies.filter((e) => e.type === 'The Understudy');
  const freeBoss = understudyOf(free);
  freeBoss.integrity = 49;
  combat.damage(free.ctx, freeBoss, 3, {}); // 3 - plating 2 = 1
  assert.equal(freeBoss.integrity, 48);
  assert.equal(freeBoss.phase, 2);
  assert.deepEqual(
    names(free.state, 'The Unfinished').map((e) => ({ x: e.x, y: e.y })),
    [{ x: 24, y: 18 }, { x: 50, y: 18 }],
    'marker tiles 1 and 2',
  );

  const game = floor8(queueRng([]));
  const state = game.state;
  const boss = understudyOf(game);
  boss.integrity = 49;
  combat.damage(game.ctx, boss, 3, {});

  const line = state.log[state.log.length - 1];
  assert.equal(line.text, SCRIPT.understudy[2], 'SCR-06 line 2, in the log');
  assert.equal(line.color, 'violet', 'SCR-06: violet');

  const summoned = names(state, 'The Unfinished').filter((e) => e.summonedBy === boss.id);
  assert.equal(summoned.length, 2);
  assert.deepEqual(
    summoned.map((e) => ({ x: e.x, y: e.y })),
    [{ x: 23, y: 17 }, { x: 49, y: 17 }],
    'the markers are occupied, so the nearest free tiles by Chebyshev, ties by reading order',
  );
  for (const e of summoned) {
    assert.equal(e.state, 'ACTIVE');
    assert.deepEqual(e.lastKnown, { x: state.tick.x, y: state.tick.y });
    assert.ok(state.floor.enemies.includes(e), 'SKL-03: summoned enemies are in floor.enemies');
  }
});

test('ACC-95: Phase 2 Pulse deals 1d6+1 ignoring Plating within 2 and pushes, after the "hums" telegraph @m08', () => {
  const game = floor8(queueRng([d100(100), d100(100), d100(100), die(6, 6)]));
  const state = game.state;
  const boss = understudyOf(game);
  boss.integrity = 49;
  combat.damage(game.ctx, boss, 3, {});
  clearBoxes(game); // line 2's text box, raised by the Phase 2 transition
  // Drop the four Unfinished so only the Understudy draws from the queue (ERRATIC rolls a d10).
  state.floor.enemies = state.floor.enemies.filter((e) => e.type === 'The Understudy');
  state.tick.x = 50;
  state.tick.y = 5;

  // `pulsingUp` is read after each turn: the Pulse clears it, so after the loop it is false (D-078).
  const seen = [];
  const pulsing = [];
  for (let t = 0; t < 5; t++) {
    seen.push(texts(game.act({ type: 'wait' })));
    pulsing.push(boss.pulsingUp === true);
  }
  assert.deepEqual(seen[3], ['The Understudy hums.'], 'BST-06: n mod 4 == 3 and Tick within 2');
  assert.deepEqual(pulsing, [false, false, false, true, false], 'raised by the telegraph, cleared by the Pulse');
  assert.deepEqual(
    seen[4],
    ['The Understudy rings like a bell.', 'Tick takes 7 from the Pulse.', 'Tick is knocked back.'],
    '1d6+1 at 6 = 7, ignoring Plating, then a push',
  );
  assert.equal(boss.pulsingUp, false);
  assert.equal(state.tick.integrity, 33);
  assert.deepEqual({ x: state.tick.x, y: state.tick.y }, { x: 49, y: 5 }, 'CMB-09: one tile away');
  assert.equal(bosses.PULSE_DICE, '1d6+1');
  assert.equal(bosses.PULSE_NOISE, 8);
});

test('ACC-95: at Integrity 24 the Understudy speaks line 3, turns SLOW, and drops its specials @m08', () => {
  const game = floor8(queueRng([]));
  const state = game.state;
  const boss = understudyOf(game);
  boss.integrity = 49;
  combat.damage(game.ctx, boss, 3, {}); // into Phase 2
  state.floor.enemies = state.floor.enemies.filter((e) => e.type === 'The Understudy');

  boss.integrity = 26;
  boss.windingUp = true;
  boss.pulsingUp = true;
  combat.damage(game.ctx, boss, 4, {}); // 4 - plating 2 = 2, crossing to 24

  assert.equal(boss.integrity, 24);
  assert.equal(boss.phase, 3);
  const line = state.log[state.log.length - 1];
  assert.equal(line.text, SCRIPT.understudy[3]);
  assert.equal(line.color, 'violet');
  assert.equal(speedOf(state, boss), 'SLOW', 'BST-06: speed becomes SLOW permanently');
  assert.equal(boss.windingUp, false);
  assert.equal(boss.pulsingUp, false);

  // "Script: CHASER only. No specials." Six actions next to Tick never telegraph again.
  state.tick.x = 50;
  state.tick.y = 5;
  const rng = [];
  for (let t = 0; t < 12; t++) rng.push(d100(100)); // SLOW: one action every other turn, all missing
  const solo = floor8(queueRng(rng));
  const other = understudyOf(solo);
  solo.state.floor.enemies = solo.state.floor.enemies.filter((e) => e.type === 'The Understudy');
  other.integrity = 49;
  combat.damage(solo.ctx, other, 3, {});
  solo.state.floor.enemies = solo.state.floor.enemies.filter((e) => e.type === 'The Understudy');
  other.integrity = 26;
  combat.damage(solo.ctx, other, 4, {});
  solo.state.tick.x = 50;
  solo.state.tick.y = 5;
  for (let t = 0; t < 12; t++) {
    solo.act({ type: 'wait' });
    assert.equal(other.windingUp, false, `turn ${t + 1}: no wind-up in Phase 3`);
    assert.equal(other.pulsingUp, false, `turn ${t + 1}: no pulse in Phase 3`);
  }
});

test('ACC-95: the inspect popup shows the Understudy spring (BST-06) @m08', () => {
  // The rule was specified from the start and the line was written nowhere, so the one clock in the
  // fight the player does not control was invisible — which is why the boss winding itself down read
  // as a bug rather than as the mechanic it is.
  const game = floor8(queueRng([]));
  const boss = understudyOf(game);
  const lines = enemyPopup(game, boss).lines;
  assert.ok(lines.includes(`Spring ${SPRING_MAX}/${SPRING_MAX}`), `no Spring line: ${lines.join(' | ')}`);

  boss.tension = SPRING_MAX - 40;
  assert.ok(
    enemyPopup(game, boss).lines.includes(`Spring ${SPRING_MAX - 40}/${SPRING_MAX}`),
    'the line tracks the live value',
  );

  // No other enemy has a spring, so no other popup may grow a Spring row.
  const unfinished = createGame({
    seedString: 'SPRING',
    intro: false,
    floor: floorFromAscii(['#####', '#T.u#', '#####'], { enemies: { u: { type: 'The Unfinished' } } }),
  });
  assert.ok(
    !enemyPopup(unfinished, unfinished.state.floor.enemies[0]).lines.some((l) => l.startsWith('Spring')),
    'only the Understudy has a spring of its own',
  );
});

test('ACC-95: all four Understudy lines reach both a text box and the log @m08', () => {
  // Lines 2 and 3 were log-only, which put the boss's only dialogue during the fight into one row of
  // a five-row log that combat refills every turn - players finished the fight never having seen
  // them. They are boxes now, and all four keep a log copy because UI-16 dismisses a box on any key.
  const game = floor8(queueRng([DROP_ROLL]));
  const state = game.state;
  const boss = understudyOf(game);

  // Line 1 came with the entry trigger that `floor8` already fired.
  assert.ok(texts({ log: state.log }).includes(SCRIPT.understudy[1]), 'line 1 in the log');

  // Line 2, at Integrity 48. Plating 2 comes off the raw amount, so 3 lands 1.
  boss.integrity = 49;
  combat.damage(game.ctx, boss, 3, {});
  assert.equal(boss.phase, 2);
  assert.ok(state.log.some((l) => l.text === SCRIPT.understudy[2]), 'line 2 in the log');
  assert.equal(game.phase, 'awaitDismiss', 'line 2 raises a box, so the fight stops to be read');
  clearBoxes(game);

  // Line 3, at Integrity 24.
  boss.integrity = 26;
  combat.damage(game.ctx, boss, 4, {});
  assert.equal(boss.phase, 3);
  assert.ok(state.log.some((l) => l.text === SCRIPT.understudy[3]), 'line 3 in the log');
  assert.equal(game.phase, 'awaitDismiss', 'and line 3 raises a box too');
  clearBoxes(game);
});

test('ACC-95: the spring reaches Phase 3 as readily as Integrity, once @m08', () => {
  const game = floor8(queueRng([]));
  const state = game.state;
  const boss = understudyOf(game);
  const saidLine3 = () => state.log.filter((l) => l.text === SCRIPT.understudy[3]).length;

  // A long fight winds it down without the player having reached Integrity 24. Phase 2's summons
  // are not skipped on the way (D-073), so the walk runs both transitions.
  boss.integrity = 72;
  boss.tension = bosses.UNDERSTUDY_SPRING_LOW + bosses.SPRING_COST;
  assert.equal(boss.phase || 1, 1, 'still Phase 1 by Integrity');

  game.act({ type: 'wait' });
  assert.equal(boss.phase, 3, 'BST-06: the spring drives the whole transition, not just the line');
  assert.equal(speedOf(state, boss), 'SLOW', 'Phase 3 speed, at full Integrity');
  assert.equal(boss.windingUp, false, 'Phase 3 drops a pending wind-up');
  assert.equal(boss.pulsingUp, false);
  assert.equal(saidLine3(), 1, 'the spring earned line 3');
  assert.equal(game.phase, 'awaitDismiss', 'and it arrives as a text box');
  assert.equal(saidLine3(), 1);
  clearBoxes(game);

  // Integrity falling past 24 afterwards must not repeat anything: the phase only ever increases.
  boss.integrity = 26;
  combat.damage(game.ctx, boss, 4, {});
  clearBoxes(game);
  assert.equal(boss.phase, 3);
  assert.equal(saidLine3(), 1, 'BST-06: the same line is never said twice');
});

test('@unit bosses: the Understudy spring outlasts the fight, so it is a failsafe (BST-06) @m08', () => {
  // BST-06: 125 actions against a 12-35 turn damage kill. At the 1.1.0 value of 100 the two clocks
  // were the same length, so every turn spent not attacking advanced the kill and walking away
  // finished the boss. If this ever drops back near the damage clock, that returns.
  const actionsToSelfDefeat = SPRING_MAX / bosses.SPRING_COST;
  assert.ok(
    actionsToSelfDefeat >= 100,
    `${actionsToSelfDefeat} actions is close enough to a real fight that time alone can win it`,
  );

  // And it still is a failsafe: a boss that has spent its spring is defeated, not stuck.
  const game = floor8(queueRng([DROP_ROLL]));
  const boss = understudyOf(game);
  boss.tension = bosses.SPRING_COST;
  game.act({ type: 'wait' });
  assert.ok(!game.state.floor.enemies.includes(boss), 'the failsafe still resolves the fight');
});

test('@unit bosses: the Understudy is defeated when its own spring reaches 0 (BST-06) @m08', () => {
  const game = floor8(queueRng([DROP_ROLL]));
  const state = game.state;
  const boss = understudyOf(game);
  assert.equal(bosses.SPRING_COST, 2);
  boss.tension = 2;

  const turn = game.act({ type: 'wait' });
  assert.equal(boss.tension, 0);
  assert.ok(!state.floor.enemies.includes(boss), 'defeated exactly as if broken');
  assert.deepEqual(state.floor.scrap, [], 'BST-06: no scrap');
  assert.equal(state.tick.xp, 0, 'BST-06: no XP');
  assert.deepEqual(
    turn.events.map((e) => e.type),
    ['textbox', 'textbox', 'choice'],
    'the defeat sequence runs whichever way the Understudy is defeated',
  );
  assert.equal(game.phase, 'awaitDismiss');
});

test('ACC-96: the Understudy\'s defeat shows moment 3 and line 4, then thought 3, then the ending choice @m08', () => {
  // Tick's Wrench is `1d4+1`: one d100 (80 + 1 accuracy - 15 evasion = 66) then one d4, and the
  // break's ITM-11 drop roll.
  const game = floor8(queueRng([d100(50), die(4, 4), DROP_ROLL]));
  const state = game.state;
  const boss = understudyOf(game);
  boss.integrity = 3;
  state.tick.x = 50;
  state.tick.y = 5;

  const kill = game.act({ type: 'move', dx: 1, dy: 0 });
  // Line 4's box is SCR-05's moment 3 (asserted below); the log carries the line itself, like 1-3.
  assert.deepEqual(
    texts(kill),
    ['Tick hits The Understudy for 3.', 'The Understudy breaks.', SCRIPT.understudy[4]],
  );
  assert.deepEqual(state.floor.scrap, [], 'no scrap');
  assert.equal(state.tick.xp, 0, 'no XP');
  assert.deepEqual(state.floor.items, [], 'BST-06: dropChance 0 and an empty drop table');

  assert.deepEqual(
    kill.events.filter((e) => e.type !== 'flash'),
    [
      { type: 'textbox', id: 'moment3a', text: SCRIPT.moments['3a'] },
      { type: 'textbox', id: 'moment3b', text: SCRIPT.moments['3b'] },
      { type: 'choice', id: 'endingChoice', text: SCRIPT.endingChoice, options: ['A) Wind the tower', 'B) Wind yourself'] },
    ],
    'UI-19: text box (line 4) -> text box (thought 3) -> Ending choice',
  );
  assert.ok(SCRIPT.moments['3a'].includes(SCRIPT.understudy[4]), 'SCR-05: line 4 is inside moment 3');

  assert.equal(game.phase, 'awaitDismiss');
  assert.equal(game.act({ type: 'wait' }).reason, 'awaitDismiss');
  game.act({ type: 'dismiss' });
  assert.equal(game.phase, 'awaitDismiss');
  game.act({ type: 'dismiss' });
  assert.equal(game.phase, 'awaitChoice', 'PLN-03: the choice event puts the engine in awaitChoice');
  assert.equal(game.act({ type: 'move', dx: 1, dy: 0 }).reason, 'awaitChoice');
});
