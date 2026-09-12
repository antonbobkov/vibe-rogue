// The Journal screen's list cursor (UI-15).
//
// The cursor used to be a local in `createJournalScreen`, and `main.js` builds a fresh screen on
// every `r`, so the Journal always reopened on Page 1 however far down the list you had read. It
// now lives on the run as `state.journal.selected`, which also lets `items.takeRecord` point it at
// a page the moment that page is found. These tests pin both halves of that.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createJournalScreen } from '../../src/screens/journal.js';
import { fixtureGame } from '../fixtures/maps.js';

/** The three things `createJournalScreen` asks of `main.js`, and nothing more. */
function stubApp(game) {
  return { game, markDirty() {}, pop() {} };
}

// UI-10: `listIntent` reads the arrows from `ev.code`, not `ev.key`.
const down = { code: 'ArrowDown' };
const enter = { key: 'Enter' };

/** A run with every journal page already found, so the whole list is selectable. */
function gameWithAllPages() {
  const game = fixtureGame(['#####', '#T..#', '#####']);
  game.state.journal.pages = game.state.journal.pages.map(() => true);
  return game;
}

test('@m10 @unit journal: the list cursor is remembered across closing and reopening (UI-15)', () => {
  const game = gameWithAllPages();
  const app = stubApp(game);

  const first = createJournalScreen(app, {});
  first.onKey(down);
  first.onKey(down); // Page 1 -> Page 3
  assert.equal(game.state.journal.selected, 2, 'the cursor is kept on the run, not in the screen');

  // A second screen is what pressing `r` again builds.
  const second = createJournalScreen(app, {});
  second.onKey(enter);
  assert.equal(second.mode, 'page', 'Enter opened the remembered page');
  assert.equal(game.state.journal.selected, 2, 'and reading it did not move the cursor');
});

test('@m10 @unit journal: taking a page moves the cursor to it (ITM-03, UI-15)', () => {
  // A page 5 on the tile east of Tick, stepped onto and picked up.
  const game = fixtureGame(['#####', '#T?.#', '#####'], { items: { '?': 'Journal page 5' } });
  game.act({ type: 'move', dx: 1, dy: 0 });
  game.act({ type: 'pickup' });

  assert.equal(game.state.journal.pages[4], true, 'page 5 was found');
  assert.equal(game.state.journal.selected, 4, 'the cursor moved to the page just found');

  const screen = createJournalScreen(stubApp(game), {});
  screen.onKey(enter);
  assert.equal(screen.mode, 'page', 'the Journal opens straight on the newest page');
});

test('@m10 @unit journal: the ending sequence page view leaves the cursor alone (PLN-03)', () => {
  const game = gameWithAllPages();
  game.state.journal.selected = 3;

  // `{page: 8, blocking: true}` is the ending's own view; it is not the list.
  const ending = createJournalScreen(stubApp(game), { page: 8, blocking: true });
  assert.equal(ending.mode, 'page');
  assert.equal(game.state.journal.selected, 3, 'the remembered list cursor is untouched');
});

test('@m10 @unit journal: a remembered cursor past the end of a shorter list is clamped', () => {
  // The Blueprint row only exists once it is found, so a cursor remembered with it present must
  // not point past the end of a list without it.
  const game = gameWithAllPages();
  game.state.journal.blueprint = true;
  const app = stubApp(game);

  const withBlueprint = createJournalScreen(app, {});
  for (let i = 0; i < 8; i++) withBlueprint.onKey(down); // onto the Blueprint row, index 8
  assert.equal(game.state.journal.selected, 8);

  game.state.journal.blueprint = false;
  createJournalScreen(app, {}); // clamping happens when the screen opens
  assert.equal(game.state.journal.selected, 7, 'clamped to the last row that exists');
});
