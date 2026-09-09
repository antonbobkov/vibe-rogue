// M04 — the turn loop: the clock and Tension decay (CMB-02 step 2), the ordering that lets the
// clock kill Tick before the enemies act (CMB-02), and the energy system of CMB-03 / CMB-04.
//
// Every enemy here carries a fixture `ai` override (PLN-04): `src/ai.js` is the M04 stub that
// always Waits, so a test that needs an enemy to act supplies its own decision function. `turn.js`
// prefers the override, which keeps these tests exact once M06 replaces the AI module in place.
//
// Randomness is injected with `queueRng` and every draw is stated in the order TEC-07 fixes
// (PLN-02 R6). A Rust-moth's attack is `1 (flat)`, which by D-010 consumes no draw, so an attack
// costs exactly one `d100` hit roll.

import test from 'node:test';
import assert from 'node:assert/strict';

import { queueRng } from '../../src/rng.js';
import { SPEED_ENERGY, ENERGY_CAP } from '../../src/actors.js';
import { fixtureGame, d100 } from '../fixtures/maps.js';

/** An empty cell with Tick alone in it. */
const EMPTY = ['#####', '#...#', '#.T.#', '#...#', '#####'];

/** Tick at (2,2) with one enemy east of it at (3,2). */
const ADJACENT = ['##########', '#........#', '#.T?.....#', '#........#', '##########'];

/** A decision function that records the turn each action falls on, then waits. */
function recorder(into) {
  return (enemy, state) => {
    into.push({ id: enemy.id, turn: state.turn });
    return { type: 'wait' };
  };
}

test('ACC-10: five turns of Wait cost exactly one Tension @m04', () => {
  const game = fixtureGame(EMPTY, { rng: queueRng([]) });
  assert.equal(game.state.tick.tension, 100, 'CHR-01 starts the mainspring at 100');

  const after = [];
  for (let i = 0; i < 5; i++) {
    game.act({ type: 'wait' });
    after.push(game.state.tick.tension);
  }
  // CMB-02 step 2: decayCounter reaches decayPeriod (5, CHR-04) only on the fifth turn.
  assert.deepEqual(after, [100, 100, 100, 100, 99]);
  assert.equal(game.state.turn, 5);
  assert.equal(game.state.tick.decayCounter, 0, 'and the counter reset');

  // The sixth turn starts the next period rather than costing a second point.
  game.act({ type: 'wait' });
  assert.equal(game.state.tick.tension, 99);
  assert.equal(game.state.tick.decayCounter, 1);
});

test('ACC-11: at Tension 1 on turn 4 the clock kills Tick before any enemy acts @m04', () => {
  const actions = [];
  const game = fixtureGame(ADJACENT.map((r) => r.replace('?', 's')), {
    rng: queueRng([]),
    enemies: { s: { state: 'ACTIVE', ai: recorder(actions) } },
  });
  game.state.turn = 4;
  game.state.tick.tension = 1;
  game.state.tick.decayCounter = 4; // the fifth turn of this decay period is the one about to run

  const result = game.act({ type: 'wait' });

  assert.deepEqual(
    result.log.map((l) => l.text),
    ['Tick wound down on floor 1.'],
    'CMB-12 / SCR-10: Tension 0 is death, and step 2 is where it happens',
  );
  assert.deepEqual(actions, [], 'step 6 never ran (CMB-02 order)');
  assert.equal(game.state.tick.tension, 0);
  assert.equal(game.state.dead.cause, 'Tension');
  assert.equal(game.phase, 'ended');
});

test('ACC-12: a SLOW enemy acts on turns 2 and 4 only @m04', () => {
  const actions = [];
  // The Gear-Golem is the SLOW type of BST-02; 50 energy a turn needs two turns to reach 100.
  const game = fixtureGame(ADJACENT.map((r) => r.replace('?', 'g')), {
    rng: queueRng([]),
    enemies: { g: { state: 'ACTIVE', ai: recorder(actions) } },
  });
  assert.equal(SPEED_ENERGY.SLOW, 50, 'CMB-03 fixes the SLOW grant');

  for (let i = 0; i < 4; i++) game.act({ type: 'wait' });

  assert.deepEqual(actions.map((a) => a.turn), [2, 4]);
  assert.equal(game.state.floor.enemies[0].energy, 0, 'each action spends exactly 100');
});

test('ACC-13: two FAST enemies act 1, 2, 1, 2 because the passes interleave @m04', () => {
  const actions = [];
  // Rust-moths are the FAST type of BST-02: 200 energy a turn is two actions each.
  const rows = ['##########', '#........#', '#mTm.....#', '#........#', '##########'];
  const game = fixtureGame(rows, {
    rng: queueRng([d100(100), d100(100), d100(100), d100(100)]),
    enemies: {
      m: {
        state: 'ACTIVE',
        ai: (enemy, state) => {
          actions.push(enemy.id);
          return { type: 'melee', x: state.tick.x, y: state.tick.y };
        },
      },
    },
  });
  assert.equal(SPEED_ENERGY.FAST, 200);
  assert.equal(ENERGY_CAP, 200, 'CMB-03 caps energy so no enemy can bank a third action');
  assert.deepEqual(game.state.floor.enemies.map((e) => e.id), [1, 2], 'ids are spawn order');

  const result = game.act({ type: 'wait' });

  assert.deepEqual(actions, [1, 2, 1, 2]);
  // Rust-moth accuracy 60 - Tick's evasion 10 = 50, so a forced d100 of 100 always misses;
  // four identical lines merge into one with UI-04's counter.
  assert.deepEqual(result.log.map((l) => l.text), ['The Rust-moth misses Tick.']);
  assert.equal(result.log[0].count, 4, 'four separate actions resolved');
});

test('ACC-21: while Tick is Slowed the enemy phase runs twice @m04', () => {
  const actions = [];
  const game = fixtureGame(ADJACENT.map((r) => r.replace('?', 's')), {
    rng: queueRng([]),
    enemies: { s: { state: 'ACTIVE', ai: recorder(actions) } },
  });
  game.state.tick.statuses.Slowed = 3;

  game.act({ type: 'wait' });

  // CMB-04: a NORMAL enemy gains 100 in each of the two phases, so it acts twice in one turn.
  assert.deepEqual(actions, [{ id: 1, turn: 1 }, { id: 1, turn: 1 }]);

  actions.length = 0;
  game.state.tick.statuses = {};
  game.act({ type: 'wait' });
  assert.deepEqual(actions, [{ id: 1, turn: 2 }], 'and once when Tick is not Slowed');
});

test('the enemy phase gives no energy to an enemy that woke this turn @m04 @unit', () => {
  // ENM-03: "a newly woken enemy therefore never acts on the turn it wakes, whatever its speed".
  const actions = [];
  const rows = ['##########', '#........#', '#Tm......#', '#........#', '##########'];
  const game = fixtureGame(rows, {
    rng: queueRng([d100(100), d100(100)]),
    enemies: { m: { state: 'DORMANT', ai: recorder(actions) } },
  });
  const moth = game.state.floor.enemies[0];

  game.act({ type: 'wait' });
  assert.equal(moth.state, 'ACTIVE', 'it saw Tick at the start of the phase (ENM-04 rule 1)');
  assert.equal(moth.energy, 0);
  assert.deepEqual(actions, [], 'and gained no energy on the turn it woke');

  game.act({ type: 'wait' });
  assert.deepEqual(actions.map((a) => a.turn), [2, 2], 'a FAST enemy acts twice from the next turn');
});

test('a Stunned enemy is set to 0 energy and a Stunned Tick may only Wait @m04 @unit', () => {
  const actions = [];
  const game = fixtureGame(ADJACENT.map((r) => r.replace('?', 's')), {
    rng: queueRng([]),
    enemies: { s: { state: 'ACTIVE', ai: recorder(actions) } },
  });
  const sweeper = game.state.floor.enemies[0];
  sweeper.statuses.Stunned = 2;

  // CMB-03: "Stunned enemies have their energy set to 0 in step 1 instead of gaining."
  // CMB-10: Stunned N on an enemy costs it exactly N enemy phases.
  game.act({ type: 'wait' });
  game.act({ type: 'wait' });
  assert.deepEqual(actions, [], 'two phases lost');
  assert.equal(sweeper.statuses.Stunned, undefined, 'and the status has expired');
  game.act({ type: 'wait' });
  assert.deepEqual(actions.map((a) => a.turn), [3]);

  // CMB-04: Tick's only permitted action while Stunned is Wait.
  game.state.tick.statuses.Stunned = 1;
  const move = game.act({ type: 'move', dx: 0, dy: -1 });
  assert.equal(move.ok, false);
  assert.equal(move.reason, 'stunned');
  assert.equal(game.state.turn, 3, 'a refused action spends no turn (CMB-05)');
  assert.equal(game.act({ type: 'wait' }).ok, true);
});
