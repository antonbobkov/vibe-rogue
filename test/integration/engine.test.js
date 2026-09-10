// M04 — the engine facade (PLN-03): phase gating, field of view and memory (WLD-05), the floor
// transition of CMB-05's Ascend, the Tension warnings of CHR-03, and the two module-level checks
// the plan asks for: `log.js` merging and its cap, and `derive()` on a fresh Tick (CHR-01).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createGame } from '../../src/engine.js';
import { createTick, derive, TENSION_MAX, START_INTEGRITY } from '../../src/actors.js';
import * as log from '../../src/log.js';
import { queueRng } from '../../src/rng.js';
import { idx } from '../../src/grid.js';
import { TILE } from '../../src/tiles.js';
import { BASE_DECAY_PERIOD } from '../../src/items.js';
import { fixtureGame, aiWait } from '../fixtures/maps.js';

/** Two rooms joined by a door; the west room holds an item and a Sweeper, Tick starts east. */
const TWO_ROOMS = [
  '####################',
  '#........#.........#',
  '#..!.....+....T....#',
  '#.....s..#.........#',
  '####################',
];

test('ACC-79: memory keeps the terrain and the last-seen item, and never an enemy @m04', () => {
  // The Sweeper stays put through the fixture's `aiWait` override (PLN-04): this test is about
  // WLD-05's memory, not ENM-06, and from M06 on `src/ai.js` would walk it toward Tick.
  const game = fixtureGame(TWO_ROOMS, {
    rng: queueRng([]),
    items: { '!': 'Solder' },
    enemies: { s: { ai: aiWait } },
  });
  const itemTile = idx(3, 2);
  const enemyTile = idx(6, 3);

  // Nothing across the map is known before Tick has been there (WLD-05: memory starts empty).
  assert.equal(game.view().remembered.has(itemTile), false);
  assert.equal(game.state.floor.memory[2][3], -1);

  for (let i = 0; i < 9; i++) game.act({ type: 'move', dx: -1, dy: 0 }); // west, through the door
  assert.equal(game.state.tick.x, 6, 'one of the nine steps went on opening the door (CMB-05)');
  assert.equal(game.view().visible.has(itemTile), true);
  assert.deepEqual(
    game.state.floor.memoryItems,
    [{ x: 3, y: 2, name: 'Solder', count: 1 }],
    'the item on a seen tile is remembered with the tile',
  );

  for (let i = 0; i < 11; i++) game.act({ type: 'move', dx: 1, dy: 0 }); // back east, out of range
  assert.equal(game.state.tick.x, 17);

  const view = game.view();
  assert.deepEqual(Object.keys(view).sort(), ['remembered', 'visible'], 'PLN-03 fixes the shape');
  assert.equal(view.visible.has(itemTile), false, 'the far room is out of FOV again');
  assert.equal(view.remembered.has(itemTile), true, 'but remembered');
  assert.equal(game.state.floor.memory[2][3], TILE.FLOOR, 'with its terrain (WLD-05)');
  assert.deepEqual(
    game.state.floor.memoryItems,
    [{ x: 3, y: 2, name: 'Solder', count: 1 }],
    'and still showing the item nobody picked up',
  );

  // "Enemies are never drawn on remembered-only tiles" — the view carries tile indices only, so a
  // remembered tile can never name the enemy standing on it.
  assert.equal(view.remembered.has(enemyTile), true, 'the tile it stands on was seen');
  assert.equal(view.visible.has(enemyTile), false);
  const enemy = game.state.floor.enemies[0];
  assert.equal(view.visible.has(idx(enemy.x, enemy.y)), false, 'so the enemy is not visible');
  for (const value of view.remembered) assert.equal(typeof value, 'number');
});

test('ACC-80: Ascend generates the next floor, clears every status and logs the SCR-10 line @m04', () => {
  const game = fixtureGame(['##########', '#........#', '#.T<.....#', '#........#', '##########'], {
    seedString: 'TEST1234',
    number: 1,
    rng: queueRng([]),
  });
  game.act({ type: 'move', dx: 1, dy: 0 }); // stand on the up-stairs
  assert.equal(game.state.floor.tiles[2][3], TILE.STAIRS_UP);

  game.state.tick.statuses.Burning = 5;
  game.state.tick.statuses.Slowed = 3;
  game.state.tick.guardTimer = 2;
  game.state.flags.tension30Warned = true;
  game.state.tick.fieldRepairUsed = true;
  const oldFloor = game.state.floor;

  const result = game.act({ type: 'ascend' });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.log.map((l) => l.text),
    ['Tick climbs. Floor 2: The Gear Gallery.'],
    'SCR-10: "Tick climbs. Floor {n}: {floor name}."',
  );
  assert.deepEqual(game.state.tick.statuses, {}, 'CMB-05: all statuses on Tick are cleared');
  assert.equal(game.state.tick.guardTimer, 0, 'and the Flywheel Guard timer with them (SKL-02)');
  assert.equal(game.state.floorNumber, 2);
  assert.equal(game.state.stats.floorsReached, 2);
  assert.notEqual(game.state.floor, oldFloor, 'the old floor and its enemies are discarded');
  assert.deepEqual(
    result.events.filter((e) => e.type === 'floor'),
    [{ type: 'floor', number: 2, name: 'The Gear Gallery' }],
    'PLN-03: a `floor` event announces the new floor',
  );
  assert.equal(game.state.flags.tension30Warned, false, 'CHR-03: the warning is once per floor');
  assert.equal(game.state.tick.fieldRepairUsed, false, 'SKL-03: once-per-floor flags reset');
  assert.deepEqual(
    { x: game.state.tick.x, y: game.state.tick.y },
    game.state.floor.features.start,
    'WLD-07: Tick arrives on the new floor start tile',
  );

  // The last floor has nothing above it (FLR-09).
  game.loadFloor(8);
  assert.equal(game.act({ type: 'ascend' }).reason, 'notStairs');
});

test('a move while a text box is up is refused with reason awaitDismiss @m04 @unit', () => {
  // PLN-03 / UI-16: while `phase` is `awaitDismiss` only `dismiss` is accepted, so a scripted
  // moment can never race the turn loop.
  const game = createGame({ seedString: 'TEST1234' });
  assert.equal(game.phase, 'awaitDismiss');
  assert.equal(game.state.turn, 0);

  const move = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.deepEqual(move, { ok: false, reason: 'awaitDismiss', log: [], events: [] });
  assert.equal(game.state.turn, 0, 'and no turn was spent');

  assert.equal(game.act({ type: 'dismiss' }).ok, true);
  assert.equal(game.phase, 'run');
  assert.equal(game.act({ type: 'dismiss' }).reason, 'nothingToDismiss');
  assert.equal(game.act({ type: 'choose', option: 'A' }).reason, 'noChoicePending');
  assert.equal(game.act({ type: 'wait' }).ok, true);
  assert.equal(game.state.turn, 1);
});

test('the TEC-05 state a new run starts from @m04 @unit', () => {
  const game = createGame({ seedString: 'TEST1234' });
  assert.deepEqual(Object.keys(game.state), [
    'version',
    'seedString',
    'playRngState',
    'turn',
    'floorNumber',
    'tick',
    'floor',
    'journal',
    'uniquesGenerated',
    'log',
    'stats',
    'flags',
    'dead',
    'victory',
  ]);
  assert.equal(game.state.floorNumber, 1);
  assert.equal(game.state.tick.integrity, START_INTEGRITY);
  assert.equal(game.state.tick.tension, TENSION_MAX);
  assert.equal(game.state.tick.level, 1);
  assert.equal(game.state.floor.tiles.length, 24);
  assert.equal(game.state.floor.tiles[0].length, 60);
  assert.equal(game.state.floor.nextEnemyId, game.state.floor.enemies.length + 1);
});

test('CHR-03 prints the two Tension warnings, the first once per floor @m04 @unit', () => {
  const game = fixtureGame(['#####', '#...#', '#.T.#', '#...#', '#####'], { rng: queueRng([]) });
  game.state.tick.tension = 31;
  game.state.tick.decayCounter = 4;

  const first = game.act({ type: 'wait' }); // 31 -> 30
  assert.deepEqual(first.log.map((l) => l.text), ['The spring is loosening.']);
  assert.equal(game.state.flags.tension30Warned, true);
  assert.equal(first.log[0].color, log.LOG_COLORS.tension, 'UI-04 colors the Tension warnings');

  game.state.tick.decayCounter = 4;
  const second = game.act({ type: 'wait' }); // 30 -> 29
  assert.deepEqual(second.log.map((l) => l.text), [], 'once per floor only (CHR-03)');

  // At <= 15 the second warning prints on every 5th turn.
  game.state.tick.tension = 15;
  game.state.turn = 24;
  const quiet = game.act({ type: 'wait' }); // turn 25... a multiple of 5
  assert.deepEqual(quiet.log.map((l) => l.text), ["Tick's spring is nearly slack."]);
  const silent = game.act({ type: 'wait' }); // turn 26
  assert.deepEqual(silent.log.map((l) => l.text), []);
});

test('log.js merges identical consecutive lines and caps the history at 500 @m04 @unit', () => {
  const lines = [];
  log.push(lines, 'Tick hits the Sweeper for 3.');
  log.push(lines, 'Tick hits the Sweeper for 3.');
  log.push(lines, 'Tick hits the Sweeper for 3.');
  assert.equal(lines.length, 1, 'UI-04: identical consecutive lines merge');
  assert.equal(lines[0].count, 3);
  assert.equal(log.renderLine(lines[0]), 'Tick hits the Sweeper for 3. (×3)');

  log.push(lines, 'Tick misses the Sweeper.');
  log.push(lines, 'Tick hits the Sweeper for 3.');
  assert.equal(lines.length, 3, 'a different line between them breaks the run');
  assert.equal(lines[2].count, 1);
  assert.equal(log.renderLine(lines[2]), 'Tick hits the Sweeper for 3.');

  // Same text in a different color is a different line (the color is part of the message, UI-04).
  log.push(lines, 'Tick hits the Sweeper for 3.', log.LOG_COLORS.tickHurt);
  assert.equal(lines.length, 4);

  const capped = [];
  for (let i = 0; i < log.LOG_CAP + 120; i++) log.push(capped, `line ${i}`);
  assert.equal(log.LOG_CAP, 500);
  assert.equal(capped.length, log.LOG_CAP, 'the history is trimmed from the front');
  assert.equal(capped[0].text, 'line 120');
  assert.equal(capped.at(-1).text, `line ${log.LOG_CAP + 119}`);

  // SCR-10's templates and its article rule, through `format`.
  assert.equal(
    log.format('hit', { A: log.label('Tick', false), D: log.label('Sweeper', true), n: 4 }),
    'Tick hits the Sweeper for 4.',
  );
  assert.equal(
    log.format('miss', { A: log.label('The Unfinished', true), D: log.label('Tick', false) }),
    'The Unfinished misses Tick.',
    'a name that already begins with "The" is used as is (SCR-10)',
  );
  assert.equal(
    log.format('enemyBroken', { D: log.label('Sweeper', true) }),
    'The Sweeper breaks.',
    'and the article is capitalised at the start of a sentence',
  );
  assert.throws(() => log.format('noSuchTemplate'), RangeError);
});

test('derive() on a fresh Tick is the CHR-01 line of the panel @m04 @unit', () => {
  const tick = createTick();
  const d = derive(tick);

  assert.equal(d.accuracy, 80, 'CHR-01/CMB-01: 80 + 5 x Precision 0 + the Wrench\'s 0');
  assert.equal(d.evasion, 10, 'CMB-01: 10 with no plating item and no attachment');
  assert.equal(d.plating, 0);
  assert.equal(d.force, 0);
  assert.equal(d.precision, 0);
  assert.deepEqual(d.attack, { n: 1, sides: 4, mod: 1 }, 'the equipped Wrench is 1d4+1 (CAT-02)');
  assert.equal(d.weapon.name, 'Wrench');
  assert.equal(d.ranged, null, 'and no ranged weapon');
  assert.equal(d.decayPeriod, BASE_DECAY_PERIOD, 'CHR-04: 5 turns per Tension point');
  assert.equal(BASE_DECAY_PERIOD, 5);

  // CHR-08: the attributes are recomputed from their sources, never stored.
  assert.equal('accuracy' in tick, false);
  assert.equal('plating' in tick, false);
  assert.equal('decayPeriod' in tick, false);

  // Equipment feeds `derive` through the one hook M05 fills (CHR-08).
  tick.equipment.plating = 'Brass Plating';
  const armored = derive(tick);
  assert.equal(armored.plating, 2, 'CAT-04 Brass Plating: Plating 2, evasion penalty 2');
  assert.equal(armored.evasion, 8);
  assert.equal(armored.accuracy, 80, 'a plating item does not touch accuracy');
});
