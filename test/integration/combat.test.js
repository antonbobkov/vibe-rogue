// M04 — combat: the hit roll and its clamp (CMB-06), Plating and Exposed, ranged attacks and
// throwing (CMB-08), knockback (CMB-09), doors, and Tick's death
// (CMB-12, SCR-08).
//
// Every test that needs randomness injects `queueRng` and states each draw in the order TEC-07
// fixes: the `d100` hit roll first, then the damage dice (PLN-02 R6). Expected values are written
// from the spec, never read back out of the engine.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as combat from '../../src/combat.js';
import { TILE } from '../../src/tiles.js';
import { queueRng } from '../../src/rng.js';
import { fixtureGame, floorFromAscii, aiWait, d100, die, DROP_ROLL } from '../fixtures/maps.js';

/** A small arena: Tick at (2,2), an enemy on the tile east of it. */
const DUEL = ['##########', '#........#', '#.T?.....#', '#........#', '##########'];

function duel(glyph, opts = {}) {
  const rows = DUEL.map((r) => r.replace('?', glyph));
  return fixtureGame(rows, opts);
}

const texts = (result) => result.log.map((l) => l.text);

test('ACC-15: the hit roll is `clamp(accuracy - evasion, 15, 95)` and 75 hits where 76 misses @m04', () => {
  // Tick's accuracy is 80 (CHR-01) and the Sweeper's evasion is 5 (BST-02), so the chance is 75.
  const game = duel('s', { rng: queueRng([d100(75), die(2, 4)]) });
  const enemy = game.state.floor.enemies[0];
  assert.equal(combat.hitChance(game.ctx, game.state.tick, enemy), 75);

  const hit = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(hit.ok, true);
  assert.deepEqual(texts(hit), ['Tick hits the Sweeper for 3.']);

  const miss = duel('s', { rng: queueRng([d100(76)]) });
  assert.deepEqual(texts(miss.act({ type: 'move', dx: 1, dy: 0 })), ['Tick misses the Sweeper.']);
});

test('ACC-16: an accuracy below the floor still hits on 15 and misses on 16 @m04', () => {
  // Pendulum Flail (-10) + Blinded (-30) vs the Music-box Dancer's evasion 30: 80 - 10 - 30 - 30
  // = 10, which CMB-06 clamps up to 15.
  const game = duel('d', { rng: queueRng([d100(15), die(1, 4), die(1, 4), d100(16)]) });
  game.state.tick.equipment.weapon = 'Pendulum Flail';
  game.state.tick.statuses.Blinded = 9;
  const enemy = game.state.floor.enemies[0];
  assert.equal(combat.hitChance(game.ctx, game.state.tick, enemy), combat.HIT_MIN);
  assert.equal(combat.HIT_MIN, 15);

  assert.equal(combat.attack(game.ctx, game.state.tick, enemy).hit, true);
  assert.equal(combat.attack(game.ctx, game.state.tick, enemy).hit, false);
});

test('ACC-17: damage below the target Plating glances off for 0 @m04', () => {
  // Wrench 1d4+1 with a rolled 1 is 2; the Gear-Golem's Plating is 3 (BST-02).
  const game = duel('g', { rng: queueRng([d100(50), die(1, 4)]) });
  const result = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.deepEqual(texts(result), ["Tick's blow glances off the Gear-Golem."]);
  assert.equal(game.state.floor.enemies[0].integrity, 30);
});

test('ACC-18: an Exposed target has its Plating treated as 0 @m04', () => {
  const game = duel('g', { rng: queueRng([d100(50), die(1, 4)]) });
  combat.applyStatus(game.ctx, game.state.floor.enemies[0], 'Exposed', 4);
  const result = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.deepEqual(texts(result), ['Tick hits the Gear-Golem for 2.']);
  assert.equal(game.state.floor.enemies[0].integrity, 28);
});

test('ACC-22: a shot stops at the first actor on the line of fire @m04', () => {
  const rows = ['##########', '#........#', '#.T..s.s.#', '#........#', '##########'];
  const game = fixtureGame(rows, { rng: queueRng([d100(50), die(4, 6)]) });
  game.state.tick.equipment.weapon = 'Spring-Bolt Launcher'; // 1d6, range 6, 3 Tension

  const result = game.act({ type: 'fire', x: 7, y: 2 });
  assert.equal(result.ok, true);
  assert.deepEqual(texts(result), ['Tick shoots the Sweeper for 4.']);
  assert.equal(game.state.floor.enemies[0].integrity, 3, 'the near Sweeper took the shot');
  assert.equal(game.state.floor.enemies[1].integrity, 7, 'the far Sweeper is untouched');
  assert.equal(game.state.tick.tension, 97, 'the shot cost its 3 Tension (CAT-03)');
});

test('ACC-23: a shot that would wind Tick down is refused and costs no turn @m04', () => {
  const rows = ['##########', '#........#', '#.T..s...#', '#........#', '##########'];
  const game = fixtureGame(rows, { rng: queueRng([]) });
  game.state.tick.equipment.weapon = 'Spring-Bolt Launcher';
  game.state.tick.tension = 2;

  const result = game.act({ type: 'fire', x: 5, y: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'notEnoughTension');
  assert.deepEqual(texts(result), ['Not enough spring for Spring-Bolt Launcher.']);
  assert.equal(game.state.turn, 0, 'no turn was spent (CMB-05)');
  assert.equal(game.state.tick.tension, 2, 'and no Tension was paid');
});

test('ACC-24: a throwable lands on the last passable tile before the wall @m04', () => {
  // (6,5) is visible from (2,2) but its Bresenham line runs into the wall at (4,3).
  const rows = [
    '##########',
    '#........#',
    '#.T......#',
    '#...#....#',
    '#........#',
    '#........#',
    '##########',
  ];
  const game = fixtureGame(rows, { rng: queueRng([]) });
  game.state.tick.inventory.push({ name: 'Oil Flask', count: 2 });

  const shot = combat.projectile(game.state, 2, 2, 6, 5);
  assert.equal(shot.blocked, true);
  assert.deepEqual(shot.landing, { x: 3, y: 3 });

  const result = game.act({ type: 'throw', slot: 2, x: 6, y: 5 });
  assert.equal(result.ok, true);
  assert.equal(texts(result)[0], 'Tick throws the Oil Flask.');
  assert.deepEqual(game.state.tick.inventory[2], { name: 'Oil Flask', count: 1 }, 'one left the stack');
  // CMB-08: the effect covers every actor within the radius, "including Tick" — the flask lands
  // at (3,3), one tile from Tick, so Tick catches its Burning (CAT-06, M05).
  assert.equal(game.state.tick.statuses.Burning, 2, 'Burning 3, ticked once at CMB-02 step 3');
});

test('ACC-25: knockback into a wall moves nothing and costs nothing @m04', () => {
  const rows = ['######', '#....#', '#.Ts.#', '#....#', '######'];
  const game = fixtureGame(rows, { rng: queueRng([]) });
  const enemy = game.state.floor.enemies[0];
  enemy.x = 4;
  enemy.y = 2; // against the east wall
  const before = { x: enemy.x, y: enemy.y, integrity: enemy.integrity };
  const logLength = game.state.log.length;

  assert.equal(combat.knockback(game.ctx, enemy, 2, 2), false);
  assert.deepEqual({ x: enemy.x, y: enemy.y, integrity: enemy.integrity }, before);
  assert.equal(game.state.log.length, logLength, 'a failed push says nothing');
});

test('ACC-26: bumping a closed door opens it, spends a turn and wakes a Dormant enemy through the wall with noise 3 @m04', () => {
  //  T + . #  s  — the Sweeper is 3 tiles from the door, behind a wall, so only noise can wake it.
  const rows = [
    '##########',
    '#........#',
    '#T+.#s...#',
    '#...#....#',
    '##########',
  ];
  const game = fixtureGame(rows, { rng: queueRng([]) });
  const enemy = game.state.floor.enemies[0];
  assert.equal(enemy.state, 'DORMANT');

  const result = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(result.ok, true);
  assert.deepEqual(texts(result), ['Tick opens the door.']);
  assert.equal(game.state.floor.tiles[2][2], TILE.DOOR_OPEN);
  assert.deepEqual({ x: game.state.tick.x, y: game.state.tick.y }, { x: 1, y: 2 }, 'Tick did not move');
  assert.equal(game.state.turn, 1, 'one turn was spent');
  assert.equal(enemy.state, 'ACTIVE', 'noise 3 reached it through the wall (CMB-11)');
  assert.deepEqual(enemy.lastKnown, { x: 2, y: 2 }, 'lastKnown is the noise tile (ENM-04)');
});

test('ACC-27: a diagonal step into a door tile opens it, like any other bump @m04', () => {
  const rows = ['#######', '#..+..#', '#.T...#', '#.....#', '#######'];
  const game = fixtureGame(rows, { rng: queueRng([]) });

  // CMB-05 allows every diagonal, doors included: the bump opens the door and costs the turn.
  const into = game.act({ type: 'move', dx: 1, dy: -1 }); // (2,2) -> the door at (3,1)
  assert.equal(into.ok, true);
  assert.equal(game.state.turn, 1);
  assert.equal(game.state.floor.tiles[1][3], TILE.DOOR_OPEN, 'the diagonal bump opened it');
  assert.deepEqual({ x: game.state.tick.x, y: game.state.tick.y }, { x: 2, y: 2 }, 'opening does not move Tick');

  // And stepping diagonally back out of the open door is legal too — the annoyance this removed.
  const out = game.act({ type: 'move', dx: 1, dy: -1 });
  assert.equal(out.ok, true);
  assert.deepEqual({ x: game.state.tick.x, y: game.state.tick.y }, { x: 3, y: 1 }, 'Tick stepped onto the door');
  const away = game.act({ type: 'move', dx: 1, dy: 1 });
  assert.equal(away.ok, true, 'a diagonal out of a door tile is legal');
  assert.deepEqual({ x: game.state.tick.x, y: game.state.tick.y }, { x: 4, y: 2 });
});

test('ACC-117: Tick broken by a Stoker on floor 4 logs and reports the SCR-08 death screen @m04', () => {
  const rows = ['##########', '#........#', '#.Tk.....#', '#........#', '##########'];
  const game = fixtureGame(rows, {
    number: 4,
    name: 'The Furnace Deck',
    rng: queueRng([d100(1), die(6, 6)]),
    enemies: {
      k: { state: 'ACTIVE', ai: (enemy, state) => ({ type: 'melee', x: state.tick.x, y: state.tick.y }) },
    },
  });
  game.state.tick.integrity = 3;

  const result = game.act({ type: 'wait' });
  assert.equal(
    texts(result).at(-1),
    'Tick was broken by the Stoker on floor 4.',
    'CMB-12 names the source and the floor',
  );

  const death = result.events.find((e) => e.type === 'death');
  assert.ok(death, 'the engine emits a death event (PLN-03)');
  assert.equal(death.cause, 'Stoker');
  assert.equal(death.header, 'TICK WAS BROKEN');
  assert.equal(
    death.flavor,
    'Something she made has stopped something she made. The tower does not notice.',
  );
  assert.equal(death.summary.floor, 4);
  assert.equal(game.phase, 'ended');
  assert.equal(game.act({ type: 'wait' }).reason, 'ended', 'nothing is accepted after the run ends');
});

test('ACC-117: winding down uses the other SCR-08 screen @m04', () => {
  const game = fixtureGame(['#####', '#...#', '#.T.#', '#...#', '#####'], { rng: queueRng([]) });
  game.state.tick.tension = 1;
  game.state.tick.decayCounter = 4;

  const result = game.act({ type: 'wait' });
  assert.equal(texts(result).at(-1), 'Tick wound down on floor 1.');
  const death = result.events.find((e) => e.type === 'death');
  assert.equal(death.cause, 'Tension');
  assert.equal(death.header, 'TICK WOUND DOWN');
  assert.equal(
    death.flavor,
    'The spring goes slack. Whatever Tick was thinking of, it will be thinking of it for a long time.',
  );
});

test('ACC-19: Burning deals 2 a turn and expires after its last tick; the Rust-moth takes 4 @m04', () => {
  // M06 note: the enemy must not act while it burns, so it carries the fixture's `aiWait`
  // override (PLN-04); `src/ai.js` is the real archetype module from M06 on.
  const game = duel('s', { rng: queueRng([]), enemies: { s: { ai: aiWait } } });
  const sweeper = game.state.floor.enemies[0];
  combat.applyStatus(game.ctx, sweeper, 'Burning', 3);

  const seen = [];
  for (let i = 0; i < 3; i++) seen.push(texts(game.act({ type: 'wait' })).join('|'));
  assert.deepEqual(seen, [
    'The Sweeper burns for 2.',
    'The Sweeper burns for 2.',
    'The Sweeper burns for 2.',
  ]);
  assert.equal(sweeper.integrity, 1, '7 - 3 x 2');
  assert.equal(sweeper.statuses.Burning, undefined, 'removed after the 3rd tick');

  // BST-02 / D-019: the Rust-moth takes 4 instead of 2.
  const moths = fixtureGame(DUEL.map((r) => r.replace('?', 'm')), {
    rng: queueRng([DROP_ROLL]),
    enemies: { m: { ai: aiWait } },
  });
  const moth = moths.state.floor.enemies[0];
  combat.applyStatus(moths.ctx, moth, 'Burning', 3);
  assert.deepEqual(texts(moths.act({ type: 'wait' })), ['The Rust-moth burns for 4.', 'The Rust-moth breaks.']);
});

test('ACC-20: reapplying a status takes the longer duration, never the sum @m04', () => {
  const game = duel('s', { rng: queueRng([]) });
  const enemy = game.state.floor.enemies[0];
  combat.applyStatus(game.ctx, enemy, 'Stunned', 2);
  assert.equal(enemy.statuses.Stunned, 2);
  combat.applyStatus(game.ctx, enemy, 'Stunned', 1);
  assert.equal(enemy.statuses.Stunned, 2, 'CMB-10: duration = max(remaining, new)');
  combat.applyStatus(game.ctx, enemy, 'Stunned', 4);
  assert.equal(enemy.statuses.Stunned, 4);
});

test('CMB-11: a fixture map builds the Floor shape the engine consumes @m04 @unit', () => {
  const floor = floorFromAscii(['#####', '#.T.#', '#.s.#', '#####'], {});
  assert.deepEqual(floor.start, { x: 2, y: 1 });
  assert.equal(floor.tiles.length, 24);
  assert.equal(floor.tiles[0].length, 60);
  assert.deepEqual(floor.spawns.map((s) => s.type), ['Sweeper']);
  assert.equal(floor.tiles[1][2], TILE.FLOOR, "Tick's start tile is Floor beneath (WLD-13)");

  // The whole WLD-13 legend, including the two characters D-048 renames away from a bestiary glyph.
  const legend = floorFromAscii(['#######', "#@'+<&#", '#^"~EH#', '#######'], {});
  assert.deepEqual(legend.start, { x: 1, y: 1 }, "WLD-13 writes Tick's start tile '@'");
  assert.deepEqual(legend.tiles[1].slice(1, 6), [
    TILE.FLOOR,
    TILE.DOOR_OPEN,
    TILE.DOOR_CLOSED,
    TILE.STAIRS_UP,
    TILE.STATION,
  ]);
  assert.deepEqual(legend.tiles[2].slice(1, 6), [
    TILE.GRINDING_GEAR,
    TILE.STEAM_VENT,
    TILE.PENDULUM_SWEEP,
    TILE.ESCAPEMENT,
    TILE.CHAIR,
  ]);
  assert.deepEqual(
    legend.hazards,
    [
      { kind: 'GRINDING_GEAR', x: 1, y: 2 },
      { kind: 'STEAM_VENT', x: 2, y: 2 },
      { kind: 'PENDULUM_SWEEP', x: 3, y: 2 },
    ],
    'a hazard tile also emits its WLD-08 record',
  );
  assert.throws(() => floorFromAscii(['###', '#.#', '###'], {}), /start tile/);
});
