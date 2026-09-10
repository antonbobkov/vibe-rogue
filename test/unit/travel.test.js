// `src/travel.js` — UI-13's Travel and UI-10's Shift-run step policies. The module is pure
// (PLN-02 R2): it plans, steps through `game.act`, and reports why it stopped; `main.js` owns the
// timers. That makes every stop condition a node test.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STOP, TENSION_STOPS, TRAVEL_STEP_MS, RUN_STEP_MS, PATH_CAP,
  travelPathTo, approachPathTo, tickPassable, snapshot, stopReason, underfoot, anyEnemyVisible,
  createTravel, createRun,
} from '../../src/travel.js';
import { floorFromAscii, aiWait } from '../fixtures/maps.js';
import { createGame } from '../../src/engine.js';
import { TILE } from '../../src/tiles.js';

/** A walled room with Tick at `(2, 2)` and open floor around it. */
const ROOM = [
  '####################',
  '#..................#',
  '#.T................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];

function game(rows, opts = {}) {
  return createGame({ seedString: 'TRAVEL', intro: false, floor: floorFromAscii(rows, opts) });
}

test('@m10 @unit travel: TEC-11 fixes the two step intervals and ENM-08 the path cap', () => {
  assert.equal(TRAVEL_STEP_MS, 60);
  assert.equal(RUN_STEP_MS, 40);
  assert.equal(PATH_CAP, 60);
  // UI-13: travel stops when "Tension crosses 30 or 15".
  assert.deepEqual(TENSION_STOPS, [30, 15]);
});

test('@m10 @unit travel: the path treats a closed door as passable and an enemy as solid', () => {
  const rows = [
    '##########',
    '#.T#.....#',
    '#..+.....#',
    '#..#.....#',
    '##########',
  ];
  const g = game(rows);
  const passable = tickPassable(g.state, false);
  // "closed doors passable — they are opened on bump".
  assert.equal(passable({ x: 2, y: 2 }, { x: 3, y: 2 }), true);
  assert.equal(g.state.floor.tiles[2][3], TILE.DOOR_CLOSED);
  // ENM-08's diagonal-door rule applies to Tick too.
  assert.equal(passable({ x: 2, y: 1 }, { x: 3, y: 2 }), false);
  // A wall is never passable.
  assert.equal(passable({ x: 2, y: 1 }, { x: 3, y: 1 }), false);

  // "enemies impassable".
  const withEnemy = game([
    '##########',
    '#.T......#',
    '#..s.....#',
    '##########',
  ], { enemies: { s: { type: 'Sweeper', state: 'DORMANT', ai: aiWait } } });
  assert.equal(tickPassable(withEnemy.state, false)({ x: 2, y: 1 }, { x: 3, y: 2 }), false);
});

test('@m10 @unit travel: travelPathTo returns the steps after Tick and null when unreachable', () => {
  const g = game(ROOM);
  const path = travelPathTo(g.state, 6, 2);
  // D-006: the steps *after* Tick's tile, up to and including the target. Which of the equal-cost
  // routes A* picks is ENM-08's tie-break (ACC-91), so only the shape is asserted here.
  assert.equal(path.length, 4);
  assert.deepEqual(path[path.length - 1], { x: 6, y: 2 });
  let from = { x: 2, y: 2 };
  for (const step of path) {
    assert.ok(Math.max(Math.abs(step.x - from.x), Math.abs(step.y - from.y)) === 1);
    from = step;
  }
  // A one-tile corridor has one route, and it is the straight line.
  const straight = game([
    '##########',
    '#.T......#',
    '##########',
  ]);
  assert.deepEqual(travelPathTo(straight.state, 5, 1), [
    { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 },
  ]);
  // Tick's own tile is a zero-step path, not a null one.
  assert.deepEqual(travelPathTo(g.state, 2, 2), []);
  // A wall is unreachable.
  assert.equal(travelPathTo(g.state, 0, 0), null);
});

test('@m10 @unit travel: clicking an enemy plans to the nearest adjacent tile, not onto it', () => {
  const rows = [
    '####################',
    '#..................#',
    '#.T.....s..........#',
    '#..................#',
    '####################',
  ];
  const g = game(rows, { enemies: { s: { type: 'Sweeper', state: 'DORMANT', ai: aiWait } } });
  const path = approachPathTo(g.state, 8, 2);
  assert.ok(path.length > 0);
  const last = path[path.length - 1];
  // UI-13: "Clicking an enemy travels to the nearest tile adjacent to it and then stops."
  assert.equal(Math.max(Math.abs(last.x - 8), Math.abs(last.y - 2)), 1);
  assert.ok(!path.some((p) => p.x === 8 && p.y === 2));

  // Already adjacent: nothing to walk.
  const adjacent = game([
    '##########',
    '#.T......#',
    '#..s.....#',
    '##########',
  ], { enemies: { s: { type: 'Sweeper', state: 'DORMANT', ai: aiWait } } });
  assert.deepEqual(approachPathTo(adjacent.state, 3, 2), []);
});

test('@m10 @unit travel: a Travel walks its path one step per turn and reports arrival', () => {
  const g = game(ROOM);
  const path = travelPathTo(g.state, 6, 2);
  const stepper = createTravel(g, path);
  assert.equal(stepper.stepMs, TRAVEL_STEP_MS);

  let steps = 0;
  for (let i = 0; i < 20; i++) {
    const result = stepper.step();
    if (result.moved) steps += 1;
    if (result.done) break;
  }
  assert.equal(g.state.tick.x, 6);
  assert.equal(g.state.tick.y, 2);
  assert.equal(g.state.turn, 4);
  assert.equal(steps, 3);
  assert.equal(stepper.done, true);
  assert.equal(stepper.reason, STOP.ARRIVED);
  // Arriving is not an interruption, so SCR-10's line is not printed.
  assert.ok(!g.state.log.some((l) => l.text === 'Tick stops.'));
});

test('@m10 @unit travel: an interrupted Travel stops and logs SCR-10 Tick stops', () => {
  const g = game(ROOM);
  const stepper = createTravel(g, travelPathTo(g.state, 8, 2));
  stepper.step();
  assert.equal(stepper.done, false);
  stepper.interrupt();
  assert.equal(stepper.done, true);
  assert.equal(stepper.reason, STOP.INPUT);
  assert.equal(g.state.log[g.state.log.length - 1].text, 'Tick stops.');
  // A second interrupt does not log twice.
  stepper.interrupt();
  assert.equal(g.state.log[g.state.log.length - 1].count, 1);
  // A step after the stop does nothing.
  const x = g.state.tick.x;
  assert.deepEqual(stepper.step(), { moved: false, done: true, reason: STOP.INPUT });
  assert.equal(g.state.tick.x, x);
});

test('@m10 @unit travel: UI-13 stops on an item or a feature underfoot', () => {
  const withItem = game([
    '##########',
    '#.T!.....#',
    '##########',
  ], { items: { '!': 'Solder' } });
  const itemStepper = createTravel(withItem, travelPathTo(withItem.state, 6, 1));
  itemStepper.step();
  assert.equal(itemStepper.reason, STOP.ITEM);
  assert.equal(withItem.state.tick.x, 3);
  assert.equal(underfoot(withItem.state), STOP.ITEM);

  const withStairs = game([
    '##########',
    '#.T<.....#',
    '##########',
  ]);
  const stairStepper = createTravel(withStairs, travelPathTo(withStairs.state, 6, 1));
  stairStepper.step();
  assert.equal(stairStepper.reason, STOP.FEATURE);
  assert.equal(underfoot(withStairs.state), STOP.FEATURE);
});

test('@m10 @unit travel: stopReason reports damage, a Tension crossing and a new enemy', () => {
  const g = game(ROOM);
  const before = snapshot(g);
  assert.equal(stopReason(g, before), null);

  // "Tick takes damage".
  assert.equal(stopReason(g, { ...before, integrity: before.integrity + 1 }), STOP.DAMAGE);

  // "Tension crosses 30 or 15" — the crossing, not merely being below.
  g.state.tick.tension = 30;
  assert.equal(stopReason(g, { ...before, tension: 31 }), STOP.TENSION);
  assert.equal(stopReason(g, { ...before, tension: 30 }), null);
  g.state.tick.tension = 15;
  assert.equal(stopReason(g, { ...before, tension: 16 }), STOP.TENSION);
  g.state.tick.tension = 100;

  // "an enemy becomes visible that was not visible when the travel started".
  const seen = game([
    '####################',
    '#.T.....s..........#',
    '####################',
  ], { enemies: { s: { type: 'Sweeper', state: 'DORMANT', ai: aiWait } } });
  assert.equal(anyEnemyVisible(seen), true);
  const seenBefore = snapshot(seen);
  // Already visible when the travel started: no stop.
  assert.equal(stopReason(seen, seenBefore, { baseline: seenBefore.enemies }), null);
  // Not in the baseline: stop.
  assert.equal(stopReason(seen, seenBefore, { baseline: new Set() }), STOP.ENEMY);
  // A Shift-run stops on any visible enemy at all (UI-10).
  assert.equal(stopReason(seen, seenBefore, { newEnemiesOnly: false }), STOP.ENEMY);
  assert.equal(stopReason(g, before, { newEnemiesOnly: false }), null);
});

test('@m10 @unit travel: a Shift-run repeats one direction until the move fails', () => {
  const g = game([
    '##########',
    '#.T......#',
    '##########',
  ]);
  const runner = createRun(g, 1, 0);
  assert.equal(runner.stepMs, RUN_STEP_MS);
  for (let i = 0; i < 30; i++) if (runner.step().done) break;
  // It runs to the wall and the failed step ends it (UI-10).
  assert.equal(g.state.tick.x, 8);
  assert.equal(runner.reason, STOP.FAILED);
  // A failed step is not an interruption, so nothing is logged for it.
  assert.ok(!g.state.log.some((l) => l.text === 'Tick stops.'));
});

test('@m10 @unit travel: a step that opens a closed door keeps the path node', () => {
  const rows = [
    '##########',
    '#.T+.....#',
    '##########',
  ];
  const g = game(rows);
  const stepper = createTravel(g, travelPathTo(g.state, 5, 1));
  const first = stepper.step();
  // UI-13: "A step that opens a closed door is a successful step (Tick stays put and continues)."
  assert.equal(first.done, false);
  assert.equal(g.state.tick.x, 2);
  assert.equal(g.state.floor.tiles[1][3], TILE.DOOR_OPEN);
  assert.ok(g.state.log.some((l) => l.text === 'Tick opens the door.'));

  for (let i = 0; i < 10; i++) if (stepper.step().done) break;
  assert.equal(g.state.tick.x, 5);
  assert.equal(stepper.reason, STOP.ARRIVED);
});
