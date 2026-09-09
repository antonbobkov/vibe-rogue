// M04 — hazards (WLD-08): the two cyclic mechanisms and the readout the panel needs (UI-06).
//
// The static halves of ACC-75 and ACC-76 (how many vents a floor 4 gets, which tiles the floor 7
// band covers) belong to the generator and are asserted in M03's `test/unit/gen.test.js`. What is
// tested here is the dynamic half: when a cycle is active, what it does to whoever is standing on
// it, and the `active` / `warning` / `turnsUntilActive` values the engine derives every turn.
//
// The turn a hazard checks against is the global `turn` *after* CMB-02 step 2 (WLD-08), which is
// what `state.floor.hazardCycle` is recomputed from at the end of every action.

import test from 'node:test';
import assert from 'node:assert/strict';

import { queueRng } from '../../src/rng.js';
import { HAZARDS, hazardActive, TILE } from '../../src/tiles.js';
import { fixtureGame, d100 } from '../fixtures/maps.js';

/** Tick beside a hazard tile at (3,2); the tests move Tick onto it or stand it there. */
const VENT_ROOM = ['##########', '#........#', '#.T".....#', '#........#', '##########'];
const BAND_ROOM = ['##########', '#........#', '#.T~.....#', '#........#', '##########'];

/** Stand an actor on a tile without moving there (no ENTER trigger, WLD-08). */
function standOn(game, x, y) {
  game.state.tick.x = x;
  game.state.tick.y = y;
}

/** One Wait, reporting the Integrity it cost and the cycle readout afterwards. */
function waitOnce(game) {
  const before = game.state.tick.integrity;
  game.act({ type: 'wait' });
  return {
    turn: game.state.turn,
    damage: before - game.state.tick.integrity,
    cycle: game.state.floor.hazardCycle,
  };
}

test('ACC-75: a Steam Vent burns whoever stands on it on turns 6k and 6k+1 and is quiet between @m04', () => {
  const game = fixtureGame(VENT_ROOM, { number: 4, name: 'The Furnace Deck', rng: queueRng([]) });
  standOn(game, 3, 2);
  assert.equal(game.state.floor.tiles[2][3], TILE.STEAM_VENT);
  assert.equal(HAZARDS.STEAM_VENT.period, 6, 'WLD-08: period 6, active on turn mod 6 in {0, 1}');

  const damage = [];
  const burning = [];
  for (let t = 1; t <= 8; t++) {
    const step = waitOnce(game);
    damage.push(step.damage);
    burning.push(game.state.tick.statuses.Burning || 0);
  }

  // turn 1: vent 4. 2 and 3: the Burning 2 it applied. 4, 5: nothing at all.
  // turn 6: vent 4. turn 7: Burning 2 (step 3) then vent 4 (step 4) = 6.
  // turn 8: the Burning applied on 7.
  assert.deepEqual(damage, [4, 2, 2, 0, 0, 4, 6, 2]);
  assert.deepEqual(burning, [2, 1, 0, 0, 0, 2, 2, 1], 'each hit applies Burning 2 (WLD-08)');
  assert.equal(game.state.tick.integrity, 40 - 20);
});

test('ACC-75: the vent readout the panel shows is derived every turn, warning on 6k-1 @m04', () => {
  const game = fixtureGame(VENT_ROOM, { number: 4, name: 'The Furnace Deck', rng: queueRng([]) });
  standOn(game, 1, 2); // off the vent: only the readout is under test

  const seen = [];
  for (let t = 1; t <= 8; t++) {
    const { cycle } = waitOnce(game);
    seen.push(`${cycle.active ? 'ACTIVE' : `in ${cycle.turnsUntilActive}`}${cycle.warning ? ' !' : ''}`);
    assert.equal(cycle.kind, 'STEAM_VENT');
  }

  assert.deepEqual(seen, [
    'ACTIVE', // turn 1  (6k+1)
    'in 4', // turn 2
    'in 3', // turn 3
    'in 2', // turn 4
    'in 1 !', // turn 5  — 6k-1, the warning turn (WLD-08)
    'ACTIVE', // turn 6  (6k)
    'ACTIVE', // turn 7  (6k+1)
    'in 4', // turn 8
  ]);
  assert.equal(game.state.tick.integrity, 40, 'nothing touches an actor off the tile');
});

test('ACC-76: the Pendulum Sweep is active on turns 8k and Stuns what it catches @m04', () => {
  const game = fixtureGame(BAND_ROOM, { number: 7, name: 'The Pendulum Stair', rng: queueRng([]) });
  standOn(game, 3, 2);
  assert.equal(game.state.floor.tiles[2][3], TILE.PENDULUM_SWEEP);
  assert.equal(HAZARDS.PENDULUM_SWEEP.period, 8, 'WLD-08: period 8, active on turn mod 8 == 0');
  for (const t of [0, 8, 16]) assert.equal(hazardActive('PENDULUM_SWEEP', t), true);
  for (const t of [1, 2, 3, 4, 5, 6, 7]) assert.equal(hazardActive('PENDULUM_SWEEP', t), false);

  const damage = [];
  const warned = [];
  for (let t = 1; t <= 8; t++) {
    const step = waitOnce(game);
    damage.push(step.damage);
    warned.push(step.cycle.warning);
  }

  assert.deepEqual(damage, [0, 0, 0, 0, 0, 0, 0, 6], 'six damage, ignoring Plating, on turn 8');
  assert.deepEqual(warned, [false, false, false, false, false, false, true, false]);
  assert.equal(game.state.floor.hazardCycle.active, true);
  assert.equal(game.state.tick.statuses.Stunned, 1, 'and Stunned 1 (WLD-08)');

  // CMB-10's counting: a status landing at step 4 first decrements at the next turn's step 3,
  // so the Stun costs Tick exactly one action (CMB-04).
  const move = game.act({ type: 'move', dx: -1, dy: 0 });
  assert.equal(move.ok, false);
  assert.equal(move.reason, 'stunned');
  assert.equal(game.act({ type: 'wait' }).ok, true);
  assert.equal(game.state.tick.statuses.Stunned, undefined);
  assert.equal(game.act({ type: 'move', dx: -1, dy: 0 }).ok, true);
});

test('ACC-75: a Grinding Gear fires on ENTER only, and an ENTER hit is not charged twice @m04', () => {
  // WLD-08's other mechanism, and D-046: ENTER and STANDING are two triggers of one effect, so a
  // step onto an active hazard is not also caught by that same turn's step 4.
  const rows = ['##########', '#........#', '#.T^"....#', '#........#', '##########'];
  const game = fixtureGame(rows, { number: 2, rng: queueRng([]) });

  const step = game.act({ type: 'move', dx: 1, dy: 0 }); // onto the Grinding Gear at (3,2)
  assert.equal(step.ok, true);
  assert.equal(game.state.tick.integrity, 37, 'WLD-08: 3 damage, ignoring Plating, on entry');
  assert.deepEqual(
    step.log.map((l) => l.text),
    ['Tick is caught in the Grinding Gear for 3.'],
    'SCR-10 names the hazard and the number',
  );

  // Standing on it afterwards costs nothing: the Gear has no STANDING trigger.
  for (let t = 0; t < 3; t++) game.act({ type: 'wait' });
  assert.equal(game.state.tick.integrity, 37);
  assert.equal(
    game.state.floor.hazardCycle.kind,
    'STEAM_VENT',
    'the readout tracks the floor\'s cyclic hazard; a constant Gear never appears in it (UI-06)',
  );

  // A cyclic hazard entered while active likewise resolves once for that turn.
  const onto = game.act({ type: 'move', dx: 1, dy: 0 }); // turn 5 -> vent inactive (5 mod 6 = 5)
  assert.equal(game.state.turn, 5);
  assert.equal(onto.ok, true);
  assert.equal(game.state.tick.integrity, 37, 'the vent is not active on 6k-1');
  const active = game.act({ type: 'wait' }); // turn 6 -> 6k, standing
  assert.equal(active.ok, true);
  assert.equal(game.state.tick.integrity, 33, 'exactly one 4-damage hit');
});

test('a hazard hits enemies exactly as it hits Tick, at step 7 @m04 @unit', () => {
  // WLD-08: "Hazards affect enemies exactly as they affect Tick (immunities per 22)." Step 7 of
  // CMB-02 runs the enemy status tick then the enemy hazard check, in id order.
  const rows = ['##########', '#........#', '#.T.s....#', '#........#', '##########'];
  const game = fixtureGame(rows, { number: 4, rng: queueRng([d100(100)]) });
  const sweeper = game.state.floor.enemies[0];
  game.state.floor.tiles[2][4] = TILE.STEAM_VENT;
  game.state.floor.hazards.push({ kind: 'STEAM_VENT', x: 4, y: 2 });

  const result = game.act({ type: 'wait' }); // turn 1: 1 mod 6 = 1, active
  assert.equal(sweeper.integrity, 7 - 4, 'BST-02 Sweeper 7 Integrity, less 4 ignoring Plating');
  assert.equal(sweeper.statuses.Burning, 2);
  assert.ok(
    result.log.some((l) => l.text === 'The Sweeper is caught in the Steam Vent for 4.'),
    'SCR-10 uses the same template for either actor',
  );

  game.act({ type: 'wait' }); // turn 2: inactive; only the Burning ticks (2, D-019 base)
  assert.equal(sweeper.integrity, 1);
  game.act({ type: 'wait' }); // turn 3: the last Burning tick breaks it (CMB-12)
  assert.equal(game.state.floor.enemies.length, 0);
  assert.equal(game.state.stats.enemiesBroken, 1);
});
