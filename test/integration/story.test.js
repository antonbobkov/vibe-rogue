// M08 — the story layer of `src/story.js`: the three scripted moments of STY-05 / SCR-05, the
// ending state machine of STY-07 / SCR-07 / UI-19, and the STY-08 run summary.
//
// The text-box, journal, descent, choice and victory events are all asserted against
// `data/script.js` itself, so a test can never disagree with the script (R1).
//
// Every test that needs randomness passes `rng: queueRng([...])` and states each draw in the order
// TEC-07 fixes (hit roll, then damage dice). Flat dice consume no draw; every break consumes one
// ITM-11 `d100` (`DROP_ROLL`).
//
// The parts of ACC-115/116 that are not headless — the seed being selectable, "any key → Title",
// the deleted save, the 1.5-second hold on each descent line — belong to the save layer (M09) and
// the UI (M10); what the engine owes them is the event sequence, and that is what is asserted here.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as story from '../../src/story.js';
import { createGame } from '../../src/engine.js';
import { loadFixedFloor } from '../../src/gen.js';
import { queueRng } from '../../src/rng.js';
import { SCRIPT } from '../../data/script.js';
import { fixtureGame, floorFromAscii, d100, die, DROP_ROLL } from '../fixtures/maps.js';

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
const types = (events) => events.map((e) => e.type);

/**
 * Floor 3 with Tick at (2,4) and a stairs room whose interior is x 18..22, y 2..6 — eight steps
 * east put its nearest tile inside Tick's radius-8 lantern (WLD-05), which is moment 1's trigger.
 */
function stageFloor() {
  const floor = floorFromAscii(arena(8).map((r, y) => (y === 4 ? row('#.T' + '.'.repeat(WIDTH - 4) + '#') : r)), {
    number: 3,
  });
  floor.rooms = [{ id: 0, x: 18, y: 2, w: 5, h: 5, cx: 20, cy: 4 }];
  floor.roles = { stairs: 0 };
  return floor;
}

/** Floor 8 (FLR-09) with BST-06's entry trigger already fired and its text box dismissed. */
function floor8(rng) {
  const game = createGame({ seedString: 'FIXTURE', rng, floor: loadFixedFloor(8), intro: false });
  // Tick starts at (5,4); five steps reach (10,4) and the sixth opens the `+` at (11,4).
  for (let i = 0; i < 6; i++) game.act({ type: 'move', dx: 1, dy: 0 });
  game.act({ type: 'dismiss' });
  return game;
}

/**
 * Break the Understudy with one Wrench hit and walk the two moment-3 boxes off, leaving the engine
 * in `awaitChoice`. The scripted draws are the Wrench's `1d4+1` (one `d100`, one `d4`) and the
 * ITM-11 drop roll every break consumes.
 */
function toEndingChoice() {
  const game = floor8(queueRng([d100(50), die(4, 4), DROP_ROLL]));
  const state = game.state;
  const boss = state.floor.enemies.find((e) => e.type === 'The Understudy');
  boss.integrity = 3;
  state.tick.x = 50;
  state.tick.y = 5;

  const kill = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.deepEqual(
    kill.events.filter((e) => e.type !== 'flash'),
    [
      { type: 'textbox', id: 'moment3a', text: SCRIPT.moments['3a'] },
      { type: 'textbox', id: 'moment3b', text: SCRIPT.moments['3b'] },
      { type: 'choice', id: 'endingChoice', text: SCRIPT.endingChoice, options: SCRIPT.endingOptions.slice() },
    ],
    'UI-19: text box (line 4) -> text box (thought 3) -> Ending choice',
  );
  game.act({ type: 'dismiss' });
  game.act({ type: 'dismiss' });
  assert.equal(game.phase, 'awaitChoice', 'PLN-03: only `choose` is accepted now');
  return game;
}

// ---------------------------------------------------------------------------------------------
// STY-05 / SCR-05 — the scripted moments
// ---------------------------------------------------------------------------------------------

test('ACC-114: moment 1 shows the exact SCR-05 text and blocks every action until it is dismissed @m08', () => {
  const game = createGame({ seedString: 'FIXTURE', rng: queueRng([]), floor: stageFloor(), intro: false });
  const state = game.state;

  for (let i = 0; i < 7; i++) {
    const step = game.act({ type: 'move', dx: 1, dy: 0 });
    assert.deepEqual(step.events, [], `step ${i + 1}: the stairs room is still dark`);
    assert.equal(game.phase, 'run');
  }

  const arrival = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.deepEqual(
    arrival.events,
    [{ type: 'textbox', id: 'moment1', text: SCRIPT.moments[1] }],
    'SCR-05 moment 1, verbatim from data/script.js',
  );
  assert.ok(SCRIPT.moments[1].includes('*She said they were for the festival. There was no festival.*'));
  assert.equal(game.phase, 'awaitDismiss', 'PLN-03: a text box is a blocking event');
  assert.deepEqual(state.flags.momentsSeen, ['moment1'], 'STY-05: the run remembers it');

  // "Game does not advance until dismissed": nothing but `dismiss` is accepted, and no turn passes.
  const turn = state.turn;
  for (const action of [
    { type: 'move', dx: 1, dy: 0 },
    { type: 'wait' },
    { type: 'pickup' },
    { type: 'interact' },
    { type: 'ascend' },
    { type: 'choose', option: 'A' },
  ]) {
    assert.deepEqual(
      game.act(action),
      { ok: false, reason: 'awaitDismiss', log: [], events: [] },
      `${action.type} is refused while the box is up`,
    );
  }
  assert.equal(state.turn, turn, 'no refused action spent a turn (CMB-05)');

  const dismissed = game.act({ type: 'dismiss' });
  assert.deepEqual(dismissed, { ok: true, log: [], events: [] });
  assert.equal(game.phase, 'run', 'play resumes');
  assert.equal(state.turn, turn, 'STY-05: scripted moments never take a turn');

  // STY-05: it fires once. Walking further into the room shows nothing more.
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(game.act({ type: 'move', dx: 1, dy: 0 }).events, []);
  }
  assert.deepEqual(state.flags.momentsSeen, ['moment1']);
});

test('ACC-114: moment 2 fires on taking the Understudy Blueprint, and never a second time @m08', () => {
  // Two Blueprints on floor 6: the first shows the box, the second cannot show it again (STY-05).
  const rows = arena(6).map((r, y) => (y === 4 ? row('#.T!.!' + '.'.repeat(WIDTH - 7) + '#') : r));
  const game = fixtureGame(rows, { number: 6, rng: queueRng([]), items: { '!': 'Understudy Blueprint' } });
  const state = game.state;

  game.act({ type: 'move', dx: 1, dy: 0 });
  const taken = game.act({ type: 'pickup' });
  assert.deepEqual(texts(taken), ['Tick unfolds a drawing. (Journal, Blueprint)'], 'SCR-04');
  assert.deepEqual(
    taken.events,
    [{ type: 'textbox', id: 'moment2', text: SCRIPT.moments[2] }],
    'SCR-05 moment 2, verbatim from data/script.js',
  );
  assert.ok(SCRIPT.moments[2].includes('*It has a place for the Key. I do not.*'));
  assert.equal(game.phase, 'awaitDismiss');
  assert.equal(state.journal.blueprint, true, 'ITM-03: the drawing goes to the Journal');
  assert.deepEqual(state.flags.momentsSeen, ['moment2']);

  game.act({ type: 'dismiss' });
  game.act({ type: 'move', dx: 1, dy: 0 });
  game.act({ type: 'move', dx: 1, dy: 0 });
  const again = game.act({ type: 'pickup' });
  assert.deepEqual(texts(again), ['Tick unfolds a drawing. (Journal, Blueprint)'], 'the pickup still happens');
  assert.deepEqual(again.events, [], 'STY-05: the moment does not fire twice');
  assert.equal(game.phase, 'run');
});

test('@unit story: a moment fires only on the floor its trigger belongs to (FLR-04, FLR-07) @m08', () => {
  assert.equal(story.MOMENT_1_FLOOR, 3);
  assert.equal(story.UNDERSTUDY_FLOOR, 8);
  assert.equal(story.FINAL_PAGE, 8);
  assert.deepEqual(story.ENDINGS, ['A', 'B']);

  // The same stairs room on floor 4 is just a room: FLR-04 puts moment 1 on floor 3 only.
  const floor = stageFloor();
  floor.number = 4;
  const game = createGame({ seedString: 'FIXTURE', rng: queueRng([]), floor, intro: false });
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(game.act({ type: 'move', dx: 1, dy: 0 }).events, []);
  }
  assert.deepEqual(game.state.flags.momentsSeen, []);
  assert.equal(story.seen(game.state, 'moment1'), false);
});

// ---------------------------------------------------------------------------------------------
// STY-07 / SCR-07 / UI-19 — the ending machine
// ---------------------------------------------------------------------------------------------

test('ACC-115: choosing A gives page 8, the Ending A text, and the THE KEEPER victory @m08', () => {
  const game = toEndingChoice();
  const state = game.state;
  assert.equal(state.journal.pages[story.FINAL_PAGE - 1], false, 'page 8 is not on the floor 8 map');

  const chosen = game.act({ type: 'choose', option: 'A' });
  assert.equal(chosen.ok, true);
  assert.deepEqual(types(chosen.events), ['journal', 'textbox', 'victory'], 'UI-19: no descent in Ending A');
  const [page, ending, victory] = chosen.events;

  // "After the choice, before either ending: Tick takes page 8 from the chair … and marked found."
  assert.deepEqual(page, { type: 'journal', page: 8 });
  assert.equal(state.journal.pages[7], true, 'SCR-07: page 8 is marked found');

  assert.deepEqual(ending, { type: 'textbox', id: 'endingA', text: SCRIPT.endingA });
  assert.equal(victory.ending, 'A');
  assert.equal(victory.header, 'THE KEEPER', 'SCR-08');
  assert.equal(victory.flavor, 'The other choice is still up there.');
  assert.equal(victory.header, SCRIPT.screens.keeper.header);
  assert.equal(victory.flavor, SCRIPT.screens.keeper.flavor);

  // STY-08: the victory screen carries the run summary.
  assert.deepEqual(Object.keys(victory.summary), [
    'floor',
    'turns',
    'enemiesBroken',
    'level',
    'skills',
    'weapon',
    'plating',
    'attachment',
    'pages',
    'seed',
  ]);
  assert.equal(victory.summary.floor, 8);
  assert.equal(victory.summary.turns, state.turn);
  assert.equal(victory.summary.enemiesBroken, 1, 'the Understudy');
  assert.equal(victory.summary.pages, 1, 'page 8, taken by the ending sequence');
  assert.equal(victory.summary.seed, 'FIXTURE');

  assert.deepEqual(state.victory, { ending: 'A', floor: 8, turn: state.turn });
  assert.equal(game.phase, 'ended', 'PLN-03: nothing is accepted after the run ends');
  assert.deepEqual(game.act({ type: 'wait' }), { ok: false, reason: 'ended', log: [], events: [] });
  assert.deepEqual(game.act({ type: 'choose', option: 'B' }), { ok: false, reason: 'ended', log: [], events: [] });
});

test('ACC-116: choosing B adds the seven descent lines between page 8 and the Ending B text @m08', () => {
  const game = toEndingChoice();
  const state = game.state;

  const chosen = game.act({ type: 'choose', option: 'B' });
  assert.equal(chosen.ok, true);
  assert.deepEqual(
    types(chosen.events),
    ['journal', 'descent', 'textbox', 'victory'],
    'UI-19: Journal page 8 -> descent lines -> Ending text -> Victory',
  );
  const [page, descent, ending, victory] = chosen.events;

  assert.deepEqual(page, { type: 'journal', page: 8 });
  assert.equal(state.journal.pages[7], true);

  assert.equal(descent.lines.length, 7, 'SCR-07: seven lines, floor 7 down to floor 1');
  assert.deepEqual(descent.lines, SCRIPT.descent.slice(), 'verbatim from data/script.js');
  assert.equal(descent.lines[0], '7. The pendulum swings once more, and hangs.');
  assert.equal(descent.lines[6], '1. The workshop. Your bench. The screwdriver, second-best.');

  assert.deepEqual(ending, { type: 'textbox', id: 'endingB', text: SCRIPT.endingB });
  assert.equal(victory.ending, 'B');
  assert.equal(victory.header, 'THE WALKER', 'SCR-08');
  assert.equal(victory.header, SCRIPT.screens.walker.header);
  assert.equal(victory.flavor, SCRIPT.screens.walker.flavor);
  assert.equal(victory.summary.floor, 8);
  assert.equal(victory.summary.pages, 1);

  assert.deepEqual(state.victory, { ending: 'B', floor: 8, turn: state.turn });
  assert.equal(game.phase, 'ended');
});

test('@unit story: only A and B are endings; any other option leaves the choice open @m08', () => {
  const game = toEndingChoice();
  const state = game.state;

  for (const option of ['C', '', 'AB', undefined, 1]) {
    assert.deepEqual(
      game.act({ type: 'choose', option }),
      { ok: false, reason: 'badOption', log: [], events: [] },
      `${String(option)} is not an ending`,
    );
    assert.equal(game.phase, 'awaitChoice', 'STY-07: there is no way to defer, and no third option');
    assert.equal(state.journal.pages[7], false, 'a refused choice takes no page');
    assert.equal(state.victory, null);
  }

  // "Options: `A) Wind the tower` · `B) Wind yourself`" — the lower-case spelling is the same choice.
  assert.equal(game.act({ type: 'choose', option: 'b' }).ok, true);
  assert.equal(game.state.victory.ending, 'B');
});

// ---------------------------------------------------------------------------------------------
// STY-08 — the run summary
// ---------------------------------------------------------------------------------------------

test('@unit story: the STY-08 summary names floors, turns, breaks, level, skills, equipment, pages and seed @m08', () => {
  // A Rust-moth to break, two journal pages to find, and a plating and an attachment to fit.
  const rows = arena(6).map((r, y) => (y === 4 ? row('#.Tm?{![' + '.'.repeat(WIDTH - 9) + '#') : r));
  const game = fixtureGame(rows, {
    number: 6,
    seedString: 'SUMMARY',
    // The Wrench's `1d4+1`: one `d100` (80 - 20 evasion = 60 to hit) and one `d4`, then the ITM-11
    // drop roll the break consumes. The moth is Dormant and never acts, so it draws nothing.
    rng: queueRng([d100(50), die(4, 4), DROP_ROLL]),
    items: {
      '?': 'Journal page 1',
      '{': 'Journal page 2',
      '!': 'Steel Plating',
      '[': 'Balance Wheel',
    },
  });
  const state = game.state;
  const tick = state.tick;

  // CHR-09: two skills, in acquisition order. Braced Frame unlocks Overwind Strike.
  tick.skillPoints = 2;
  assert.equal(game.act({ type: 'takeSkill', name: 'Braced Frame' }).ok, true);
  assert.equal(game.act({ type: 'takeSkill', name: 'Overwind Strike' }).ok, true);
  assert.deepEqual(tick.skills, ['Braced Frame', 'Overwind Strike']);

  state.floor.enemies[0].integrity = 1;
  const hit = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.deepEqual(texts(hit).at(-1), 'The Rust-moth breaks.');
  assert.equal(state.stats.enemiesBroken, 1);

  // The attack did not move Tick, so the moth's scrap tile costs one extra step (STY-03).
  // ITM-02's `slot` is the inventory index, and equipping splices the item out, so it is re-read.
  const slotOf = (name) => tick.inventory.findIndex((i) => i.name === name);
  game.act({ type: 'move', dx: 1, dy: 0 });
  for (const step of ['page 1', 'page 2', 'Steel Plating', 'Balance Wheel']) {
    game.act({ type: 'move', dx: 1, dy: 0 });
    assert.equal(game.act({ type: 'pickup' }).ok, true, step);
  }
  assert.equal(game.act({ type: 'equip', slot: slotOf('Steel Plating') }).ok, true);
  assert.equal(game.act({ type: 'equip', slot: slotOf('Balance Wheel') }).ok, true);
  assert.deepEqual(state.journal.pages.slice(0, 2), [true, true]);

  // CMB-12: Tension 0 ends the run, and the death event carries the same STY-08 summary.
  tick.tension = 1;
  tick.decayCounter = 4;
  const end = game.act({ type: 'wait' });
  const death = end.events.find((e) => e.type === 'death');
  assert.ok(death, 'PLN-03: a death event');
  assert.deepEqual(death.summary, {
    floor: 6,
    turns: state.turn,
    enemiesBroken: 1,
    level: 1,
    skills: ['Braced Frame', 'Overwind Strike'],
    weapon: 'Wrench',
    plating: 'Steel Plating',
    attachment: 'Balance Wheel',
    pages: 2,
    seed: 'SUMMARY',
  });
  assert.equal(death.summary.floor, state.stats.floorsReached, 'STY-08 counts floors reached');
  assert.equal(game.phase, 'ended');
});
