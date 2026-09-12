// M06 — the AI: perception (ENM-02), waking and states (ENM-03, ENM-04), tracking (ENM-05), the
// six archetype decision lists (ENM-06), enemy attacks (ENM-07), pathfinding (ENM-08), doors
// (ENM-09) and the per-type special cases of BST-02.
//
// Every enemy here runs `src/ai.js` itself — no fixture `ai` override — because that module is what
// this milestone builds. Randomness is injected with `queueRng` and every draw is stated in the
// order TEC-07 fixes: the `d100` hit roll, then the damage dice (PLN-02 R6). A flat dice string
// consumes no draw (D-010); the ERRATIC `d10` and its neighbour pick do, and so does the ITM-11
// drop roll on every break.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as ai from '../../src/ai.js';
import { TUNING } from '../../data/tuning.js';
import * as combat from '../../src/combat.js';
import { queueRng } from '../../src/rng.js';
import { TILE } from '../../src/tiles.js';
import { ENEMIES_BY_NAME } from '../../data/enemies.js';
import { fixtureGame, d100, die } from '../fixtures/maps.js';

const texts = (result) => result.log.map((l) => l.text);

/** ENM-05's memory, as DIF-10 tunes it: an Active enemy gives up on the turn after this. */
const MEMORY = TUNING.memoryTurns;

/** Repeat `game.act({type:'wait'})` `n` times and return the last result. */
function waits(game, n) {
  let last = null;
  for (let i = 0; i < n; i++) last = game.act({ type: 'wait' });
  return last;
}

/** The one enemy of a single-enemy fixture. */
const only = (game) => game.state.floor.enemies[0];

/** The `queueRng` float that makes `int(rng, 0, hi)` return exactly `value`. */
function pick(value, count) {
  return (value + 0.5) / count;
}

// ---------------------------------------------------------------------------------------------
// ENM-03 / ENM-04 — waking
// ---------------------------------------------------------------------------------------------

test('ACC-14: an enemy that wakes on sight gains no energy and acts only from the next turn @m06', () => {
  // A NORMAL CHASER three tiles east of Tick, in the open, with nothing between them.
  const game = fixtureGame(['##########', '#T..s....#', '##########'], { rng: queueRng([]) });
  const sweeper = only(game);
  assert.equal(sweeper.state, 'DORMANT');

  game.act({ type: 'wait' });
  assert.equal(sweeper.state, 'ACTIVE', 'ENM-04 rule 1: sight is checked at the start of the phase');
  assert.equal(sweeper.energy, 0, 'ENM-03: on entering ACTIVE energy is set to 0');
  assert.deepEqual({ x: sweeper.x, y: sweeper.y }, { x: 4, y: 1 }, 'and it did not act this turn');
  assert.deepEqual(sweeper.lastKnown, { x: 1, y: 1 }, 'ENM-04: waking by sight remembers Tick');

  game.act({ type: 'wait' });
  assert.deepEqual({ x: sweeper.x, y: sweeper.y }, { x: 3, y: 1 }, 'CHASER line 2 on the next turn');
});

test('ACC-82: noise 5 wakes a Dormant enemy at distance 5 through a wall, but not at 6 @m06', () => {
  // Tick at (1,1) attacks the Rust-moth at (2,1); CMB-06 step 1 emits noise 5 at Tick's tile. The
  // wall at (3,1) keeps both sleepers out of every line of sight, so only the noise can reach them.
  const rows = ['##########', '#Tm#..st.#', '##########'];
  const game = fixtureGame(rows, { rng: queueRng([d100(100)]) });
  const [moth, near, far] = game.state.floor.enemies;
  assert.deepEqual([near.x, far.x], [6, 7], 'distance 5 and distance 6 from Tick');
  assert.equal(near.state, 'DORMANT');
  assert.equal(far.state, 'DORMANT');

  const result = game.act({ type: 'move', dx: 1, dy: 0 }); // a melee attack (CMB-05)
  assert.deepEqual(texts(result), ['Tick misses the Rust-moth.'], 'a forced 100 always misses');
  assert.deepEqual(
    game.state.floor.noises,
    [{ x: 1, y: 1, r: combat.NOISE.MELEE }],
    'CMB-11: a melee attack is noise 5 at the attacker tile',
  );

  assert.equal(near.state, 'ACTIVE', 'ENM-04 rule 2: walls do not block noise');
  assert.deepEqual(near.lastKnown, { x: 1, y: 1 }, 'and lastKnown is the noise tile');
  assert.equal(near.lastKnownAge, 0);
  assert.equal(far.state, 'DORMANT', 'Chebyshev 6 is outside a radius-5 noise');
  assert.equal(moth.state, 'ACTIVE', 'ENM-04 rule 3 / CMB-06 step 2: the target wakes too');
});

// ---------------------------------------------------------------------------------------------
// ENM-05 — tracking
// ---------------------------------------------------------------------------------------------

test('ACC-83: a CHASER sleeps once lastKnownAge passes memoryTurns, and a GUARD walks home first @m06', () => {
  // A Sweeper sealed in its own corridor with `lastKnown` on its own tile: CHASER line 2 says
  // "if already on it and Tick not seen -> Wait", so nothing but the clock moves.
  const chase = fixtureGame(
    ['##########', '#T.......#', '##########', '#.......s#', '##########'],
    { rng: queueRng([]), enemies: { s: { state: 'ACTIVE', lastKnown: { x: 8, y: 3 } } } },
  );
  const sweeper = only(chase);

  waits(chase, MEMORY);
  assert.equal(sweeper.lastKnownAge, MEMORY, 'ENM-05: one turn of forgetting per action');
  assert.equal(sweeper.state, 'ACTIVE', 'still awake at exactly memoryTurns');

  waits(chase, 1);
  assert.equal(sweeper.lastKnownAge, MEMORY + 1);
  assert.equal(sweeper.state, 'DORMANT', 'ENM-05: "if lastKnownAge > memoryTurns … others -> DORMANT"');
  assert.equal(sweeper.energy, 0);

  // A Tin Soldier three tiles from its post, with Tick in bounds but behind a wall.
  const rows = [
    '###########',
    '#.........#',
    '#....t....#',
    '#.........#',
    '###########',
    '#T........#',
    '###########',
  ];
  const post = fixtureGame(rows, {
    rng: queueRng([]),
    enemies: { t: { state: 'ACTIVE', lastKnown: { x: 2, y: 3 } } },
  });
  post.state.floor.rooms = [{ id: 0, x: 1, y: 1, w: 9, h: 3 }];
  const soldier = only(post);
  soldier.homeRoom = 0;
  assert.deepEqual(soldier.homeTile, { x: 5, y: 2 });

  waits(post, 3);
  assert.deepEqual({ x: soldier.x, y: soldier.y }, { x: 2, y: 3 }, 'GUARD line 3 walked to lastKnown');
  waits(post, MEMORY - 3);
  assert.equal(soldier.lastKnownAge, MEMORY);
  assert.equal(soldier.state, 'ACTIVE');

  waits(post, 1);
  assert.equal(soldier.state, 'RETURNING', 'ENM-05: "GUARD -> RETURNING"');
  assert.notDeepEqual({ x: soldier.x, y: soldier.y }, { x: 2, y: 3 }, 'and that action was a step home');

  waits(post, 3);
  assert.deepEqual({ x: soldier.x, y: soldier.y }, { x: 5, y: 2 }, 'back on its homeTile');
  assert.equal(soldier.state, 'DORMANT', 'ENM-03: RETURNING -> DORMANT on arrival');
});

test('ENM-05: a noise within perception + 3 resets lastKnown, and memoryTurns + 1 quiet actions end it @m06 @unit', () => {
  const game = fixtureGame(['##########', '#T.......#', '##########', '#.......s#', '##########'], {
    rng: queueRng([]),
    enemies: { s: { state: 'ACTIVE', lastKnown: { x: 8, y: 3 } } },
  });
  const state = game.state;
  const sweeper = only(game);
  assert.equal(ENEMIES_BY_NAME.Sweeper.perception, 7, 'BST-02');

  ai.track(sweeper, state);
  assert.equal(sweeper.lastKnownAge, 1, 'no sight: the memory ages');

  // A noise at Chebyshev 10 = perception 7 + 3 reaches it; one tile further does not.
  state.floor.noises = [{ x: 8, y: 13, r: 1 }];
  ai.track(sweeper, state);
  assert.deepEqual(sweeper.lastKnown, { x: 8, y: 13 });
  assert.equal(sweeper.lastKnownAge, 0);

  state.floor.noises = [{ x: 8, y: 14, r: 1 }];
  ai.track(sweeper, state);
  assert.deepEqual(sweeper.lastKnown, { x: 8, y: 13 }, 'Chebyshev 11 is out of reach');
  assert.equal(sweeper.lastKnownAge, 1);

  state.floor.noises = [];
  for (let i = 0; i < MEMORY - 1; i++) ai.track(sweeper, state);
  assert.equal(sweeper.lastKnownAge, MEMORY);
  assert.equal(sweeper.state, 'ACTIVE');
  ai.track(sweeper, state);
  assert.equal(sweeper.lastKnownAge, MEMORY + 1);
  assert.equal(sweeper.state, 'DORMANT', 'the action after memoryTurns is the one that gives up');
});

// ---------------------------------------------------------------------------------------------
// ENM-06 GUARD
// ---------------------------------------------------------------------------------------------

const GUARD_ROOM = [
  '###########',
  '#.........#',
  '#....t....#',
  '#.........#',
  '###########',
  '###########',
  '#T........#',
  '###########',
];

/** The guard fixture: a 9x3 room with its guard at (5,2) and Tick three rows below it. */
function guardGame(glyph, opts = {}) {
  const game = fixtureGame(GUARD_ROOM.map((r) => r.replace('t', glyph)), {
    rng: queueRng([]),
    enemies: { [glyph]: Object.assign({ state: 'ACTIVE', lastKnown: { x: 1, y: 6 } }, opts) },
  });
  game.state.floor.rooms = [{ id: 0, x: 1, y: 1, w: 9, h: 3 }];
  only(game).homeRoom = 0;
  return game;
}

test('ACC-84: a GUARD woken with Tick out of bounds goes RETURNING then DORMANT, never nearer @m06', () => {
  const game = guardGame('t');
  const soldier = only(game);
  assert.equal(ai.inHomeBounds(game.state, soldier, game.state.tick), false, 'Chebyshev 3 below the room');

  game.act({ type: 'wait' });
  assert.equal(soldier.state, 'RETURNING', 'ENM-06 GUARD line 4');
  assert.deepEqual({ x: soldier.x, y: soldier.y }, { x: 5, y: 2 }, 'it was already on its homeTile');

  game.act({ type: 'wait' });
  assert.equal(soldier.state, 'DORMANT', 'ENM-06 GUARD line 1');
  assert.deepEqual({ x: soldier.x, y: soldier.y }, { x: 5, y: 2 }, 'so it never approached');
});

test('ACC-92: a cache guard runs the GUARD list whatever its own archetype says @m06', () => {
  // BST-02: "A cache guard of any type is spawned with archetype GUARD … regardless of the table."
  assert.equal(ENEMIES_BY_NAME.Sweeper.archetype, 'CHASER');
  const game = guardGame('s', { isGuard: true });
  const sweeper = only(game);
  assert.equal(ai.archetypeOf(sweeper), 'GUARD');

  waits(game, 2);
  assert.deepEqual({ x: sweeper.x, y: sweeper.y }, { x: 5, y: 2 }, 'it stays in the cache room');
  assert.equal(sweeper.state, 'DORMANT');
});

test('ENM-06 GUARD: in bounds is the room interior plus a Chebyshev-2 halo @m06 @unit', () => {
  const game = guardGame('t');
  const state = game.state;
  const soldier = only(game);
  const at = (x, y) => ai.inHomeBounds(state, soldier, { x, y });

  assert.equal(at(5, 2), true, 'the interior itself');
  assert.equal(at(1, 1), true);
  assert.equal(at(9, 3), true);
  assert.equal(at(11, 3), true, 'two tiles east of the interior');
  assert.equal(at(12, 3), false, 'three is out');
  assert.equal(at(5, 5), true, 'two rows below');
  assert.equal(at(5, 6), false);

  // A guard with no room guards its own tile (D-058).
  soldier.homeRoom = -1;
  assert.equal(at(5, 4), true);
  assert.equal(at(5, 5), false);
});

// ---------------------------------------------------------------------------------------------
// ENM-06 SKIRMISHER — the Cuckoo (BST-02)
// ---------------------------------------------------------------------------------------------

test('ACC-85: the Cuckoo telegraphs, then shrieks for noise 12 and 1d4 ignoring Plating @m06', () => {
  // Range 6 exactly (BST-02), so the Cuckoo can shoot from where it stands.
  const game = fixtureGame(['##########', '#T.....c.#', '##########'], {
    rng: queueRng([d100(50), die(3, 4)]),
  });
  const cuckoo = only(game);
  // Plating 2 on Tick, so "ignores Plating" is visible in the number (ACC-53's item).
  game.state.tick.equipment.plating = 'Brass Plating';

  game.act({ type: 'wait' }); // it wakes on sight and gains no energy (ENM-03)
  assert.equal(cuckoo.state, 'ACTIVE');

  const telegraph = game.act({ type: 'wait' });
  assert.equal(cuckoo.windingUp, true, 'ENM-06 SKIRMISHER line 3 with windUp YES');
  assert.deepEqual(texts(telegraph), ['The Cuckoo draws breath.'], 'BST-02 names the line');
  assert.deepEqual(game.state.floor.noises, [], 'a wind-up is silent');

  const shriek = game.act({ type: 'wait' });
  assert.equal(cuckoo.windingUp, false, 'ENM-06 line 1 clears it either way');
  assert.deepEqual(texts(shriek), ['The Cuckoo shrieks.', 'The Cuckoo shoots Tick for 3.']);
  assert.deepEqual(
    game.state.floor.noises,
    [{ x: 7, y: 1, r: 12 }],
    'BST-02: noise 12 at the Cuckoo tile, hit or miss',
  );
  assert.equal(game.state.tick.integrity, 40 - 3, 'Brass Plating 2 is skipped entirely');
});

test('ACC-85: a shriek is cancelled when Tick leaves the line of fire @m06', () => {
  const rows = ['##########', '#T.....c.#', '#.####...#', '#........#', '##########'];
  const game = fixtureGame(rows, { rng: queueRng([]) });
  const cuckoo = only(game);

  waits(game, 2);
  assert.equal(cuckoo.windingUp, true);

  const away = game.act({ type: 'move', dx: 0, dy: 1 }); // behind the wall at (2..5, 2)
  assert.deepEqual({ x: game.state.tick.x, y: game.state.tick.y }, { x: 1, y: 2 });
  assert.equal(cuckoo.windingUp, false, 'ENM-06 line 1: "otherwise cancel … and Wait"');
  assert.deepEqual(texts(away), [], 'no shriek, no shot');
  assert.deepEqual(game.state.floor.noises, [], 'and no noise 12');
  assert.equal(game.state.tick.integrity, 40);
});

test('ACC-86: a cornered SKIRMISHER retreats, and melees with 1d2 when it cannot @m06', () => {
  const open = fixtureGame(['########', '#......#', '#..Tc..#', '#......#', '########'], {
    rng: queueRng([]),
    enemies: { c: { state: 'ACTIVE' } },
  });
  const cuckoo = only(open);

  open.act({ type: 'wait' });
  // Neighbours at distance 2 are (5,1), (5,2) and (5,3); none is beside another enemy, so the
  // lowest reading order wins (ENM-06 SKIRMISHER line 2).
  assert.deepEqual({ x: cuckoo.x, y: cuckoo.y }, { x: 5, y: 1 });

  // A dead end: every neighbour is a wall or Tick, so nothing increases the distance.
  const boxed = fixtureGame(['####', '#Tc#', '####'], {
    rng: queueRng([d100(10), die(2, 2)]),
    enemies: { c: { state: 'ACTIVE' } },
  });
  const result = boxed.act({ type: 'wait' });
  assert.deepEqual(texts(result), ['The Cuckoo hits Tick for 2.'], "BST-02's melee 1d2");
  assert.deepEqual({ x: only(boxed).x, y: only(boxed).y }, { x: 2, y: 1 }, 'it stood its ground');
});

test('ENM-06 SKIRMISHER: retreat maximises distance, then avoids other enemies, then reads @m06 @unit', () => {
  // Tick at (1,3) and the Cuckoo at (2,3). The neighbours that increase the Chebyshev distance are
  // (3,2), (3,3) and (3,4), all at 2; the Rust-moth at (4,1) is adjacent to (3,2) alone, so the
  // tie-break drops that one and (3,3) wins on reading order.
  const game = fixtureGame(['#######', '#...m.#', '#.....#', '#Tc...#', '#.....#', '#######'], {
    rng: queueRng([]),
    enemies: { c: { state: 'ACTIVE' }, m: { state: 'ACTIVE' } },
  });
  const state = game.state;
  const cuckoo = state.floor.enemies.find((e) => e.type === 'Cuckoo');
  const moth = state.floor.enemies.find((e) => e.type === 'Rust-moth');
  assert.deepEqual({ x: cuckoo.x, y: cuckoo.y }, { x: 2, y: 3 });
  assert.deepEqual({ x: moth.x, y: moth.y }, { x: 4, y: 1 });

  assert.deepEqual(ai.retreatTile(cuckoo, state, state.tick), { x: 3, y: 3 });

  // Move the moth out of the way and the plain reading-order winner comes back.
  moth.x = 5;
  assert.deepEqual(ai.retreatTile(cuckoo, state, state.tick), { x: 3, y: 2 });

  // Nowhere farther at all -> null, which ENM-06 line 2 turns into a melee attack.
  const boxed = fixtureGame(['####', '#Tc#', '####'], { rng: queueRng([]), enemies: { c: { state: 'ACTIVE' } } });
  assert.equal(ai.retreatTile(only(boxed), boxed.state, boxed.state.tick), null);
});

// ---------------------------------------------------------------------------------------------
// ENM-06 BRUISER and ENM-09 doors — the Gear-Golem (BST-02)
// ---------------------------------------------------------------------------------------------

test('ACC-87: the Gear-Golem winds up on one action and lands 3d4 on the next @m06', () => {
  const rows = ['########', '#..Tg..#', '########'];
  const hit = fixtureGame(rows, {
    // Accuracy 70 + 10 (heavy) - Tick's evasion 10 = 70, so a forced 10 hits; then 3d4 = 4 + 4 + 4.
    rng: queueRng([d100(10), die(4, 4), die(4, 4), die(4, 4)]),
    enemies: { g: { state: 'ACTIVE' } },
  });
  const golem = only(hit);
  assert.equal(ENEMIES_BY_NAME['Gear-Golem'].speed, 'SLOW');

  assert.deepEqual(texts(waits(hit, 1)), [], 'SLOW: 50 energy is not an action yet');
  assert.deepEqual(texts(waits(hit, 1)), ['The Gear-Golem raises its arm.'], 'BST-02 telegraph');
  assert.equal(golem.windingUp, true);

  assert.deepEqual(texts(waits(hit, 1)), [], 'and the wind-up spans a whole player turn');
  assert.deepEqual(texts(waits(hit, 1)), [
    'The Gear-Golem brings its arm down.',
    'The Gear-Golem hits Tick for 12.',
  ]);
  assert.equal(golem.windingUp, false);
  assert.equal(hit.state.tick.integrity, 40 - 12);

  // "Stepping away between -> nothing."
  const dodge = fixtureGame(rows, { rng: queueRng([]), enemies: { g: { state: 'ACTIVE' } } });
  const dodger = only(dodge);
  waits(dodge, 2);
  assert.equal(dodger.windingUp, true);
  dodge.act({ type: 'move', dx: -1, dy: 0 });
  const swing = dodge.act({ type: 'wait' });
  assert.equal(dodger.windingUp, false, 'ENM-06 BRUISER line 1: "else nothing. Then windingUp = false"');
  assert.deepEqual(texts(swing), []);
  assert.equal(dodge.state.tick.integrity, 40);
});

test('ACC-88: a BREAKS enemy turns a closed door into Floor; a NO enemy treats it as a wall @m06', () => {
  const rows = ['#########', '#T..+g..#', '#########'];
  const golemGame = fixtureGame(rows, {
    rng: queueRng([]),
    enemies: { g: { state: 'ACTIVE', lastKnown: { x: 1, y: 1 } } },
  });
  const golem = only(golemGame);
  assert.equal(ENEMIES_BY_NAME['Gear-Golem'].opensDoors, 'BREAKS');

  const broken = waits(golemGame, 2); // SLOW: the golem's first action is on turn 2
  assert.equal(golemGame.state.floor.tiles[1][4], TILE.FLOOR, 'ENM-09 BREAKS');
  assert.deepEqual({ x: golem.x, y: golem.y }, { x: 5, y: 1 }, 'and it does not move that action');
  assert.deepEqual(texts(broken), ['The Gear-Golem breaks the door down.']);
  assert.deepEqual(
    golemGame.state.floor.noises,
    [{ x: 4, y: 1, r: combat.NOISE.BREAK }],
    'ENM-09: noise 6',
  );

  const houndGame = fixtureGame(rows.map((r) => r.replace('g', 'h')), {
    rng: queueRng([]),
    enemies: { h: { state: 'ACTIVE', lastKnown: { x: 1, y: 1 } } },
  });
  const hound = only(houndGame);
  assert.equal(ENEMIES_BY_NAME['Spring-Hound'].opensDoors, 'NO');

  waits(houndGame, 2);
  assert.equal(houndGame.state.floor.tiles[1][4], TILE.DOOR_CLOSED, 'ENM-09 NO: a closed door is a wall');
  assert.deepEqual({ x: hound.x, y: hound.y }, { x: 5, y: 1 }, 'with no path, ENM-06 says Wait');
  assert.equal(ai.pathTo(hound, houndGame.state, { x: 1, y: 1 }), null);
});

// ---------------------------------------------------------------------------------------------
// ENM-06 ERRATIC — The Unfinished (BST-02)
// ---------------------------------------------------------------------------------------------

test('ACC-89: The Unfinished splits 1,000 actions 50/30/20 and never sleeps or blinds @m06', () => {
  // Seven free neighbours around (4,2): every tile of the 8-neighborhood but Tick's.
  const NEIGHBORS = 7;
  const draws = [];
  const expected = [];
  for (let i = 0; i < 1000; i++) {
    const roll = (i % 10) + 1;
    draws.push(die(roll, 10));
    if (roll <= 5) expected.push('melee');
    else if (roll <= 8) {
      draws.push(pick(i % NEIGHBORS, NEIGHBORS));
      expected.push('move');
    } else expected.push('wait');
  }

  const game = fixtureGame(['########', '#......#', '#..Tu..#', '#......#', '########'], {
    rng: queueRng(draws),
    enemies: { u: { state: 'ACTIVE' } },
  });
  const unfinished = only(game);
  assert.equal(ENEMIES_BY_NAME['The Unfinished'].archetype, 'ERRATIC');

  // `decide` is asked directly, so the enemy never moves and the neighbour count stays 7.
  const seen = { melee: 0, move: 0, wait: 0 };
  for (let i = 0; i < 1000; i++) {
    const action = ai.decide(unfinished, game.state, game.ctx);
    assert.equal(action.type, expected[i], `action ${i}`);
    seen[action.type] += 1;
  }
  assert.deepEqual(seen, { melee: 500, move: 300, wait: 200 }, 'ENM-06: d10 1-5 / 6-8 / 9-10');
  assert.equal(unfinished.state, 'ACTIVE');

  // "Erratics never go Dormant once woken", and BST-02 makes it immune to Blinded.
  const alone = fixtureGame(['######', '#T...#', '######', '#...u#', '######'], {
    rng: queueRng(new Array(12).fill(die(10, 10))),
    enemies: { u: { state: 'ACTIVE', lastKnown: { x: 4, y: 3 } } },
  });
  const loner = only(alone);
  for (let i = 0; i < 12; i++) ai.decide(loner, alone.state, alone.ctx);
  assert.equal(loner.lastKnownAge, 12, 'the memory still ages');
  assert.equal(loner.state, 'ACTIVE', 'but it never returns to Dormant');
  assert.equal(combat.applyStatus(alone.ctx, loner, 'Blinded', 3), false);
  assert.equal(loner.statuses.Blinded, undefined);
});

// ---------------------------------------------------------------------------------------------
// ENM-06 SWARMER / ENM-08 pathing
// ---------------------------------------------------------------------------------------------

test('ACC-90: swarmers plan through each other but Wait when the next tile is occupied @m06', () => {
  const swarm = fixtureGame(['#########', '#Tmm....#', '#########'], {
    // The front Rust-moth is FAST, so it attacks twice; `1 (flat)` costs no damage draw (D-010).
    rng: queueRng([d100(100), d100(100)]),
  });
  const [front, back] = swarm.state.floor.enemies;

  swarm.act({ type: 'wait' }); // both wake on sight and gain no energy
  const result = swarm.act({ type: 'wait' });

  assert.deepEqual(texts(result), ['The Rust-moth misses Tick.']);
  assert.equal(result.log[0].count, 2, 'the front moth acted twice; the back one never attacked');
  assert.deepEqual({ x: front.x, y: front.y }, { x: 2, y: 1 }, 'the front moth stayed to attack');
  assert.deepEqual({ x: back.x, y: back.y }, { x: 3, y: 1 }, 'and the back one waited');

  const planned = ai.pathTo(back, swarm.state, { x: 1, y: 1 });
  assert.deepEqual(planned, [{ x: 2, y: 1 }, { x: 1, y: 1 }], 'ENM-08: a SWARMER plans through it');

  // The same corridor with CHASERs: another enemy really is a wall, so there is no path at all.
  const line = fixtureGame(['#########', '#Tss....#', '#########'], { rng: queueRng([d100(100), d100(100)]) });
  const rear = line.state.floor.enemies[1];
  assert.equal(ai.pathTo(rear, line.state, { x: 1, y: 1 }), null);
});

// ---------------------------------------------------------------------------------------------
// ENM-06 — the decision lists as a table
// ---------------------------------------------------------------------------------------------

const TABLE_ROWS = ['##########', '#........#', '#.T...?..#', '#........#', '##########'];

/**
 * A one-enemy arena with Tick at (2,2) and the enemy at `x` on the same row, Active.
 * `opts` seeds `lastKnown`, `windingUp` and the like.
 */
function situation(glyph, x, opts = {}) {
  const row = TABLE_ROWS[2].split('');
  row[6] = '.';
  row[x] = glyph;
  const rows = TABLE_ROWS.slice();
  rows[2] = row.join('');
  const game = fixtureGame(rows, {
    rng: queueRng([]),
    enemies: { [glyph]: { state: 'ACTIVE', lastKnown: opts.lastKnown } },
  });
  const enemy = only(game);
  // `createEnemy` takes no wind-up flag (it is the AI's own bookkeeping), so it is set here.
  if (opts.windingUp) enemy.windingUp = true;
  return { game, enemy, state: game.state };
}

test('ENM-06: each archetype decision list on the same table of situations @m06 @unit', () => {
  const here = { x: 2, y: 2 }; // Tick's tile
  // ENM-08 breaks A* ties by lowest `f`, then lowest `h`, then reading order, so a step west from
  // (6,2) toward (2,2) is the north-west diagonal (5,1), not the flat (5,2).
  const WEST = { type: 'move', x: 5, y: 1 };

  // --- CHASER: attack, approach, wait ---
  {
    const adj = situation('s', 3);
    assert.deepEqual(ai.chaser(adj.enemy, adj.state), { type: 'melee', x: 2, y: 2 });

    const seen = situation('s', 6, { lastKnown: here });
    assert.deepEqual(ai.chaser(seen.enemy, seen.state), WEST);

    const lost = situation('s', 6);
    lost.enemy.lastKnown = null;
    assert.deepEqual(ai.chaser(lost.enemy, lost.state), ai.WAIT, 'line 3');

    const standing = situation('s', 6, { lastKnown: { x: 6, y: 2 } });
    assert.deepEqual(ai.chaser(standing.enemy, standing.state), ai.WAIT, 'already on lastKnown');
  }

  // --- SWARMER: the same list ---
  {
    const adj = situation('m', 3);
    assert.deepEqual(ai.swarmer(adj.enemy, adj.state), { type: 'melee', x: 2, y: 2 });
    assert.equal(ai.swarmer, ai.chaser, 'ENM-06: "Same decision list as CHASER"');
  }

  // --- GUARD: melee beats bounds; out of bounds is a walk home ---
  {
    const adj = situation('t', 3, { lastKnown: here });
    adj.state.floor.rooms = [{ id: 0, x: 1, y: 1, w: 8, h: 3 }];
    adj.enemy.homeRoom = 0;
    assert.deepEqual(ai.guard(adj.enemy, adj.state), { type: 'melee', x: 2, y: 2 });

    const away = situation('t', 6, { lastKnown: here });
    away.state.floor.rooms = [{ id: 0, x: 6, y: 2, w: 1, h: 1 }];
    away.enemy.homeRoom = 0;
    assert.deepEqual(ai.guard(away.enemy, away.state), ai.WAIT, 'line 4: home already, nothing to do');
    assert.equal(away.enemy.state, 'RETURNING', 'and Tick at Chebyshev 4 is out of bounds');
  }

  // --- SKIRMISHER: wind-up, retreat, telegraph, approach ---
  {
    const pending = situation('c', 6, { lastKnown: here, windingUp: true });
    assert.deepEqual(ai.skirmisher(pending.enemy, pending.state), { type: 'ranged', x: 2, y: 2 });
    assert.equal(pending.enemy.windingUp, false, 'line 1 clears it either way');

    const ranged = situation('c', 6, { lastKnown: here });
    assert.deepEqual(ai.skirmisher(ranged.enemy, ranged.state), {
      type: 'telegraph',
      flag: 'windingUp',
      message: 'cuckooTelegraph',
    });

    const adj = situation('c', 3);
    assert.deepEqual(
      ai.skirmisher(adj.enemy, adj.state),
      { type: 'move', x: 4, y: 1 },
      'the farthest tile, lowest reading order',
    );

    // Sealed off in its own corridor: nothing to see, nothing to shoot.
    const sealed = (opts) => {
      const game = fixtureGame(['#########', '#T......#', '#########', '#....c..#', '#########'], {
        rng: queueRng([]),
        enemies: { c: { state: 'ACTIVE', lastKnown: opts.lastKnown } },
      });
      if (opts.windingUp) only(game).windingUp = true;
      return game;
    };

    const blocked = sealed({ lastKnown: { x: 7, y: 3 }, windingUp: true });
    assert.deepEqual(ai.skirmisher(only(blocked), blocked.state), ai.WAIT, 'cancelled: no line');
    assert.equal(only(blocked).windingUp, false);

    const lost = sealed({ lastKnown: { x: 7, y: 3 } });
    assert.deepEqual(ai.skirmisher(only(lost), lost.state), { type: 'move', x: 6, y: 3 }, 'line 4');

    const idle = sealed({});
    assert.deepEqual(ai.skirmisher(only(idle), idle.state), ai.WAIT, 'line 5');
  }

  // --- BRUISER: wind up, land it, approach ---
  {
    const adj = situation('g', 3);
    assert.deepEqual(ai.bruiser(adj.enemy, adj.state), {
      type: 'telegraph',
      flag: 'windingUp',
      message: 'golemTelegraph',
    });

    const pending = situation('g', 3, { windingUp: true });
    assert.deepEqual(ai.bruiser(pending.enemy, pending.state), { type: 'heavy', x: 2, y: 2 });
    assert.equal(pending.enemy.windingUp, false);

    const missed = situation('g', 6, { lastKnown: here, windingUp: true });
    assert.deepEqual(ai.bruiser(missed.enemy, missed.state), ai.WAIT, 'not adjacent: nothing happens');
    assert.equal(missed.enemy.windingUp, false);

    const approach = situation('g', 6, { lastKnown: here });
    assert.deepEqual(ai.bruiser(approach.enemy, approach.state), WEST);

    const idle = situation('g', 6);
    idle.enemy.lastKnown = null;
    assert.deepEqual(ai.bruiser(idle.enemy, idle.state), ai.WAIT);
  }
});

test('ENM-08: a diagonal step past a door is legal, and closed doors follow opensDoors @m06 @unit', () => {
  //  # # # #        ENM-08 no longer refuses a diagonal into or out of a door, so an enemy may
  //  # T ' . #      cut the corner at the open door on (2,1) in either direction. (A *closed*
  //  # . # . #      door is a separate matter: it is not walkable, and `opensDoors` decides it.)
  const rows = ['######', "#T'..#", '#.#..#', '######'];
  const game = fixtureGame(rows, { rng: queueRng([]), enemies: {} });

  const free = ai.freeNeighbors({ x: 1, y: 2 }, game.state).map((p) => `${p.x},${p.y}`);
  assert.ok(free.includes('2,1'), `a diagonal into a door is a legal step, got ${free.join(' ')}`);
  const out = ai.freeNeighbors({ x: 2, y: 1 }, game.state).map((p) => `${p.x},${p.y}`);
  assert.ok(out.includes('3,2'), `a diagonal out of a door is a legal step, got ${out.join(' ')}`);
  assert.equal(ai.diagonalThroughDoor, undefined, 'the rule is removed, not merely unused');

  const doored = fixtureGame(['######', '#s+T.#', '######'], {
    rng: queueRng([]),
    enemies: { s: { state: 'ACTIVE', lastKnown: { x: 3, y: 1 } } },
  });
  const sweeper = only(doored);
  assert.equal(ENEMIES_BY_NAME.Sweeper.opensDoors, 'YES');
  assert.deepEqual(ai.decide(sweeper, doored.state, doored.ctx), { type: 'openDoor', x: 2, y: 1 });

  const hounded = fixtureGame(['######', '#h+T.#', '######'], {
    rng: queueRng([]),
    enemies: { h: { state: 'ACTIVE', lastKnown: { x: 3, y: 1 } } },
  });
  assert.deepEqual(ai.decide(only(hounded), hounded.state, hounded.ctx), ai.WAIT, 'ENM-09 NO');
});
test('ENM-04 rule 3: a damage wake points at Tick within 10 and at the damage source beyond it @unit @m06', () => {
  // A Steam Vent on a 30-wide map with a Dormant Sweeper standing on it. The vent is the damage
  // source; whether `lastKnown` becomes Tick's tile or the vent tile depends only on how far away
  // Tick is (ENM-04, D-063).
  const row = (marks) => {
    const cells = new Array(30).fill('.');
    cells[0] = '#';
    cells[29] = '#';
    for (const [x, ch] of marks) cells[x] = ch;
    return cells.join('');
  };
  const wall = '#'.repeat(30);

  const hit = (sx) => {
    const game = fixtureGame([wall, row([[2, 'T']]), row([[sx, 's']]), wall], {
      rng: queueRng([]),
      enemies: { s: { state: 'DORMANT' } },
    });
    const enemy = game.state.floor.enemies[0];
    game.state.floor.hazards = [{ kind: 'STEAM_VENT', x: sx, y: 2 }];
    game.state.floor.tiles[2][sx] = TILE.STEAM_VENT;
    combat.hazardHit(game.ctx, enemy, combat.hazardAt(game.state, sx, 2), game.state.turn);
    return enemy;
  };

  // Tick sits at (2,1); the vent at (5,2) is Chebyshev 3 away, so Tick's tile wins.
  const near = hit(5);
  assert.equal(near.state, 'ACTIVE', 'damage woke it');
  assert.deepEqual(near.lastKnown, { x: 2, y: 1 }, "Tick within 10 -> Tick's tile");

  // The vent at (25,2) is Chebyshev 23 from Tick, so the damage source wins.
  const far = hit(25);
  assert.equal(far.state, 'ACTIVE', 'damage woke it');
  assert.deepEqual(far.lastKnown, { x: 25, y: 2 }, 'Tick beyond 10 -> the damage source tile');
});
