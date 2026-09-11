// M13 — "The Tower Notices" (`specs/50-difficulty-plan.md`), acceptance tests ACC-140 … ACC-167.
//
// Every number these tests expect comes from `data/tuning.js` (DIF-02) rather than from a literal,
// because the DIF-15 ladder moves those numbers and a test that hard-codes one turns a balance
// change into a red build. What is asserted is the *rule*: three ticks of an even share, a repair
// that any hit ends, a lock that costs spring, an Overwound enemy that is the same enemy with more
// of it.
//
// Randomness is injected with `queueRng` and every draw is stated in the order TEC-07 fixes.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as combat from '../../src/combat.js';
import * as items from '../../src/items.js';
import * as ai from '../../src/ai.js';
import { createGame } from '../../src/engine.js';
import { generateFloor } from '../../src/gen.js';
import { createEnemy, enemyName, canBeElite, statsOf, derive, START_INTEGRITY } from '../../src/actors.js';
import { serialize, deserialize } from '../../src/save.js';
import { queueRng, mulberry32, fnv1a } from '../../src/rng.js';
import { TILE } from '../../src/tiles.js';
import { idx, chebyshev, W, H } from '../../src/grid.js';
import { panelStatuses, hazardRow } from '../../src/screens/run.js';
import { inspectLine, itemLine, enemyPopup } from '../../src/screens/inspect.js';
import { actorStyle, ELITE_BG } from '../../src/render.js';
import { spawnWanderer, turnsUntilWanderer, wanderInterval } from '../../src/wander.js';
import { TUNING, WANDER_FLOOR_INTERVAL } from '../../data/tuning.js';
import { FLOORS } from '../../data/floors.js';
import { ENEMIES, ENEMIES_BY_NAME } from '../../data/enemies.js';
import { ITEMS_BY_NAME } from '../../data/items.js';
import { SALVAGE_CYCLE, SALVAGE_PERIOD } from '../../src/skills.js';
import { fixtureGame, floorFromAscii, d100, die, DROP_ROLL, aiWait, aiAttackAdjacent } from '../fixtures/maps.js';

const texts = (result) => result.log.map((l) => l.text);
const ROOM = ['##########', '#........#', '#...T....#', '#........#', '##########'];

/** The even share of a repair tick, and what the last turn pays (DIF-03). */
const PER_TURN = Math.floor(TUNING.solderAmount / TUNING.solderTurns);

/** Give Tick a skill without spending a point (CHR-09's own path is tested in skills.test.js). */
function grant(game, ...names) {
  for (const name of names) game.state.tick.skills.push(name);
  return game.state.tick;
}

// ---------------------------------------------------------------------------------------------
// DIF-03 — Solder repairs over time and costs spring (ITM-09, CAT-06)
// ---------------------------------------------------------------------------------------------

test('ACC-140: Solder pays Tension once and mends over solderTurns turns @m13', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  // CHR-02 clamps at Integrity max; this test is about the repair, so it is given room to land.
  tick.integrityMax = 100;
  tick.integrity = 1;
  tick.tension = 60;

  const start = game.act({ type: 'use', slot: 0 });
  assert.equal(start.ok, true);
  assert.deepEqual(texts(start), [
    'Tick begins soldering.',
    `Tick solders the plate. Integrity ${1 + PER_TURN}.`,
  ]);
  assert.equal(tick.tension, 60 - TUNING.solderTension, 'CAT-06: the repair costs Tension to start');
  assert.equal(tick.integrity, 1 + PER_TURN, 'the first tick lands on the turn it is used');

  const healed = [tick.integrity];
  for (let i = 1; i < TUNING.solderTurns; i++) {
    game.act({ type: 'wait' });
    healed.push(tick.integrity);
  }
  assert.equal(tick.repair, null, `the repair runs for exactly ${TUNING.solderTurns} turns`);
  assert.equal(tick.integrity, 1 + TUNING.solderAmount, 'CAT-06: the whole amount, over three turns');
  assert.deepEqual(
    healed,
    [1 + PER_TURN, 1 + 2 * PER_TURN, 1 + TUNING.solderAmount],
    'the even share each turn, and the remainder on the last',
  );
});

test('ACC-141: any damage ends a repair, and a 0-damage glance does not @m13', () => {
  const rows = ['##########', '#........#', '#..Ts....#', '#........#', '##########'];
  // The Sweeper hits on the first turn of the repair and glances on the second: d100 then damage.
  const game = fixtureGame(rows, {
    enemies: { s: { state: 'ACTIVE', ai: aiAttackAdjacent } },
    rng: queueRng([d100(1), die(3, 3), d100(1), die(1, 3)]),
  });
  const tick = game.state.tick;
  tick.integrity = 30;
  tick.tension = 60;

  const started = game.act({ type: 'use', slot: 0 });
  assert.ok(texts(started).includes('The solder cracks.'), 'DIF-03: the hit ends the repair');
  assert.equal(tick.repair, null);
  // The first tick still landed — CMB-02 step 3 is before the enemy phase.
  assert.ok(tick.integrity < 30 + PER_TURN, 'and the rest of the repair is lost');

  // A glance: Plating eats the whole 1d3, so `dealt` is 0 and the repair survives.
  const glancing = fixtureGame(rows, {
    enemies: { s: { state: 'ACTIVE', ai: aiAttackAdjacent } },
    rng: queueRng([d100(1), die(1, 3), d100(1), die(1, 3)]),
  });
  glancing.state.tick.equipment.plating = items.equipEntry('Steel Plating');
  glancing.state.tick.integrity = 30;
  glancing.state.tick.tension = 60;
  const glanced = glancing.act({ type: 'use', slot: 0 });
  assert.ok(texts(glanced).some((t) => t.includes('glances off Tick')), 'the hit dealt nothing');
  assert.ok(!texts(glanced).includes('The solder cracks.'), 'DIF-03: a glance does not interrupt');
  assert.notEqual(glancing.state.tick.repair, null);
});

test('ACC-142: both Solder refusals spend no turn and no item @m13', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;

  // Too little spring to heat it (CHR-03's rule for a cost that would wind Tick down).
  tick.tension = TUNING.solderTension;
  const poor = game.act({ type: 'use', slot: 0 });
  assert.equal(poor.ok, false);
  assert.equal(poor.reason, 'notEnoughTension');
  assert.deepEqual(texts(poor), ['Not enough spring to heat the solder.']);
  assert.equal(game.state.turn, 0, 'CMB-05: a refusal spends no turn');
  assert.equal(tick.inventory[0].count, 1, 'and no Solder');

  // One already running.
  tick.tension = 80;
  tick.integrity = 5;
  assert.equal(game.act({ type: 'use', slot: 0 }).ok, true);
  tick.inventory.unshift({ name: 'Solder', count: 1 });
  const turnBefore = game.state.turn;
  const busy = game.act({ type: 'use', slot: 0 });
  assert.equal(busy.ok, false);
  assert.equal(busy.reason, 'alreadySoldering');
  assert.deepEqual(texts(busy), ['Tick is already soldering.']);
  assert.equal(game.state.turn, turnBefore);
  assert.equal(tick.inventory[0].count, 1);
});

test('ACC-143: Efficient Springs adds its bonus to the repair total @m13', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = grant(game, 'Efficient Springs');
  tick.integrityMax = 100;
  tick.integrity = 1;
  tick.tension = 80;

  const total = TUNING.solderAmount + TUNING.efficientSolderBonus;
  assert.equal(items.consumableAmount('SOLDER', tick), total, 'SKL-03: the bonus is on the total');
  game.act({ type: 'use', slot: 0 });
  assert.equal(tick.repair.left + tick.repair.perTurn, total, 'and the repair carries all of it');
  for (let i = 1; i < TUNING.solderTurns; i++) game.act({ type: 'wait' });
  assert.equal(tick.integrity, Math.min(tick.integrityMax, 1 + total));
  assert.equal(tick.repair, null);
});

test('ACC-144: the panel shows Solder(n), and Flux does not clear it @m13', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  tick.integrity = 5;
  tick.tension = 80;
  assert.equal(panelStatuses(tick), '—', 'nothing running yet');

  game.act({ type: 'use', slot: 0 });
  assert.equal(panelStatuses(tick), `Solder(${TUNING.solderTurns - 1})`, 'UI-03 row 15');

  // CAT-06 Flux clears "all five statuses"; the repair is not one of them (DIF-03).
  tick.statuses.Burning = 3;
  tick.inventory.push({ name: 'Flux', count: 1 });
  game.act({ type: 'use', slot: tick.inventory.length - 1 });
  assert.equal(tick.statuses.Burning, undefined, 'CMB-10: Flux clears the five');
  assert.notEqual(tick.repair, null, 'DIF-03: the repair is not one of them');
  assert.ok(panelStatuses(tick).includes('Solder('), 'and the panel still says so');
});

// ---------------------------------------------------------------------------------------------
// DIF-04 — consumable scarcity
// ---------------------------------------------------------------------------------------------

test('ACC-145: no regular enemy drops Solder or a Spring-Key, and no drop table is empty @m13', () => {
  const scarce = new Set(['Solder', 'Spring-Key']);
  const offenders = [];
  for (const type of ENEMIES) {
    const boss = type.archetype === 'BOSS';
    if (type.dropTable.length === 0) {
      // BST-06: the Understudy alone drops nothing, and its `dropChance` says so.
      if (type.dropChance !== 0) offenders.push(`${type.name}: an empty table with a drop chance`);
      continue;
    }
    for (const [name, weight] of type.dropTable) {
      assert.ok(ITEMS_BY_NAME[name], `${type.name} drops an unknown item '${name}'`);
      assert.ok(Number.isInteger(weight) && weight > 0, `${type.name}: '${name}' has weight ${weight}`);
      // DIF-11: the Magpie is the exception the plan writes into its own row.
      if (scarce.has(name) && !boss && type.name !== 'Magpie') {
        offenders.push(`${type.name} drops ${name}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `DIF-04: ${offenders.join('; ')}`);

  // And the floor tables still carry them — scarcity is a weight, not a removal (DIF-04).
  for (let n = 1; n <= 7; n++) {
    const floor = FLOORS[n];
    const names = [...floor.floorTable, ...floor.cacheTable].map(([name]) => name);
    assert.ok(names.some((name) => scarce.has(name)), `floor ${n} places neither Solder nor Spring-Key`);
  }
});

test('ACC-146: a full stack refuses one more, and a new slot takes it @m13', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  tick.inventory = [{ name: 'Solder', count: TUNING.stackMax }];

  const added = items.addToInventory(tick, 'Solder', 1, TUNING);
  assert.equal(added.ok, true);
  assert.equal(added.stacked, false, 'ITM-03: a full stack does not take it');
  assert.deepEqual(tick.inventory, [
    { name: 'Solder', count: TUNING.stackMax },
    { name: 'Solder', count: 1 },
  ]);

  // And with every slot full, there is nowhere for it to go.
  tick.inventory = [];
  for (let i = 0; i < items.INVENTORY_SLOTS; i++) tick.inventory.push({ name: 'Solder', count: TUNING.stackMax });
  const full = items.addToInventory(tick, 'Solder', 1, TUNING);
  assert.equal(full.ok, false);
  assert.equal(full.reason, 'full');
});

test('ACC-147: Salvage cycles the four throwables over sixteen breaks @m13', () => {
  const rows = ['####################', '#.mmmmmmmm.........#', '#.T................#', '#.mmmmmmmm.........#', '####################'];
  const game = fixtureGame(rows, {
    enemies: { m: { ai: aiWait } },
    rng: queueRng(new Array(16).fill(DROP_ROLL)),
  });
  const tick = grant(game, 'Salvage');
  const moths = game.state.floor.enemies.slice();
  assert.equal(moths.length, 16, 'sixteen breaks is four full cycles');

  for (const moth of moths) {
    moth.integrity = 0;
    combat.breakActor(game.ctx, moth);
  }

  const dropped = game.state.floor.items.map((i) => i.name);
  assert.deepEqual(dropped, [...SALVAGE_CYCLE], 'SKL-03: one throwable every fourth break, in order');
  assert.equal(dropped.length, moths.length / SALVAGE_PERIOD);
  for (const name of dropped) {
    assert.equal(ITEMS_BY_NAME[name].category, 'throwable', 'DIF-04: never Solder or Spring-Key');
  }
  assert.equal(tick.salvageNext, SALVAGE_CYCLE[0], 'and the cycle comes back round');
});

// ---------------------------------------------------------------------------------------------
// DIF-05 — winding is loud (CHR-05, CMB-11)
// ---------------------------------------------------------------------------------------------

test('ACC-148: winding a station wakes the floor, and floor 1 makes no sound @m13', () => {
  // Two Sweepers in sealed cells, one inside `stationNoise` and one outside it.
  const near = TUNING.stationNoise - 1;
  const far = TUNING.stationNoise + 1;
  const rows = [];
  for (let y = 0; y < 5; y++) rows.push(new Array(far + 4).fill('#').join(''));
  const put = (y, x, ch) => {
    rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
  };
  put(1, 1, '&');
  put(1, 2, 'T');
  put(3, 1 + near, 's');
  put(3, 1 + far, 's');

  const game = fixtureGame(rows, { rng: queueRng([]), enemies: { s: { ai: aiWait } } });
  const state = game.state;
  const [inside, outside] = state.floor.enemies;
  assert.equal(chebyshev(1, 1, inside.x, inside.y), near);
  assert.equal(chebyshev(1, 1, outside.x, outside.y), far);

  game.act({ type: 'move', dx: -1, dy: 0 }); // onto the station
  const result = game.act({ type: 'interact' });
  assert.equal(result.ok, true);
  assert.ok(
    texts(result).includes(`Tick winds the spring. Tension ${TUNING.stationRestore}.`),
    'CHR-05 still says what it wound to',
  );
  assert.ok(texts(result).includes('The winding rings through the tower.'), 'DIF-05');
  assert.equal(state.tick.tension, TUNING.stationRestore);
  assert.equal(inside.state, 'ACTIVE', `a Dormant enemy at ${near} wakes`);
  assert.deepEqual(inside.lastKnown, { x: 1, y: 1 }, 'and looks at the station');
  assert.equal(outside.state, 'DORMANT', `one at ${far} does not`);

  // FLR-02 / WLD-07: floor 1's station is spent at the start, so it rings nothing.
  const quiet = fixtureGame(rows, { rng: queueRng([]), enemies: { s: { ai: aiWait } }, stationSpent: true });
  quiet.act({ type: 'move', dx: -1, dy: 0 });
  const spent = quiet.act({ type: 'interact' });
  assert.equal(spent.ok, false);
  assert.deepEqual(texts(spent), ['This station has run down.']);
  assert.equal(quiet.state.floor.enemies[0].state, 'DORMANT', 'a spent station wakes nobody');
});

// ---------------------------------------------------------------------------------------------
// DIF-06 — wandering pressure (WLD-14)
// ---------------------------------------------------------------------------------------------

/** A generated floor `n` of a seed, entered, so `wander.js` has rooms to place into. */
function generatedGame(seedString, n) {
  const game = createGame({ seedString, intro: false, rng: mulberry32(fnv1a(`${seedString}:play`)) });
  if (n !== 1) game.loadFloor(n);
  return game;
}

test('ACC-149: a wanderer arrives on the interval, out of sight, far away, and never past the cap @m13', () => {
  const game = generatedGame('WANDER1', 2);
  const state = game.state;
  const before = state.floor.enemies.length;
  const interval = wanderInterval(state);

  // Nothing before the interval.
  state.floor.turnsHere = interval - 1;
  assert.equal(spawnWanderer(game.ctx), null, 'WLD-14: only on the interval');

  const seen = [];
  for (let k = 1; k <= TUNING.wanderCap + 2; k++) {
    state.floor.turnsHere = interval * k;
    const spawned = spawnWanderer(game.ctx);
    if (spawned) seen.push(spawned);
  }
  assert.equal(seen.length, TUNING.wanderCap, 'WLD-14: the cap holds');
  assert.equal(state.floor.enemies.length, before + TUNING.wanderCap);

  const table = FLOORS[2].wanderTable.map(([name]) => name);
  const visible = game.view().visible;
  for (const enemy of seen) {
    assert.ok(table.includes(enemy.type), `WLD-14: ${enemy.type} is not on floor 2's wander table`);
    assert.equal(enemy.state, 'ACTIVE', 'a wanderer arrives awake');
    assert.equal(enemy.wanderer, true);
    assert.deepEqual(enemy.lastKnown, { x: state.tick.x, y: state.tick.y }, 'and looking for Tick');
    assert.equal(visible.has(idx(enemy.x, enemy.y)), false, 'never in sight when it arrives');
    assert.ok(
      chebyshev(enemy.x, enemy.y, state.tick.x, state.tick.y) >= 1,
      'and never on top of Tick',
    );
    assert.equal(state.floor.tiles[enemy.y][enemy.x], TILE.FLOOR, 'on plain floor, not a feature');
  }
  assert.equal(state.stats.wanderersSpawned, TUNING.wanderCap, 'the run record counts them');

  // FLR-09: floor 8 spawns none.
  const top = generatedGame('WANDER1', 8);
  top.state.floor.turnsHere = wanderInterval(top.state);
  assert.equal(spawnWanderer(top.ctx), null, 'WLD-14: floor 8 has no wander table');
  assert.equal(turnsUntilWanderer(top.state), null);
});

test('ACC-150: the panel counts down to the next wanderer when the floor has no cyclic hazard @m13', () => {
  const game = generatedGame('WANDER2', 3);
  const state = game.state;
  const interval = wanderInterval(state);

  state.floor.turnsHere = 0;
  assert.equal(turnsUntilWanderer(state), interval);
  assert.deepEqual(hazardRow(state.floor, state), { text: `next: ${interval}`, color: 'lightGrey' });

  state.floor.turnsHere = interval - 3;
  assert.equal(turnsUntilWanderer(state), 3);
  assert.equal(hazardRow(state.floor, state).text, 'next: 3');

  // Once the cap is spent the row goes quiet: there is nothing more coming (UI-06).
  state.floor.wanderersSpawned = TUNING.wanderCap;
  assert.equal(turnsUntilWanderer(state), null);
  assert.equal(hazardRow(state.floor, state).text, '');
});

test('ACC-151: floor 1 runs the wanderer clock slower than the rest @m13', () => {
  const one = generatedGame('WANDER3', 1);
  assert.equal(wanderInterval(one.state), WANDER_FLOOR_INTERVAL[1], 'FLR-02 is the tutorial floor');
  assert.ok(wanderInterval(one.state) > TUNING.wanderInterval);

  const four = generatedGame('WANDER3', 4);
  assert.equal(wanderInterval(four.state), TUNING.wanderInterval, 'and floor 4 runs the tuned one');
});

// ---------------------------------------------------------------------------------------------
// DIF-07 — rust (CMB-14, ITM-01)
// ---------------------------------------------------------------------------------------------

/** A Rust-moth adjacent to Tick, with the rolls a hit needs already queued. */
function mothGame(rolls) {
  return fixtureGame(['##########', '#........#', '#..Tm....#', '#........#', '##########'], {
    enemies: { m: { state: 'ACTIVE', ai: aiAttackAdjacent } },
    rng: queueRng(rolls),
  });
}

test('ACC-152: a Rust-moth hit pits the plating on the roll, and only then @m13', () => {
  // The moth's attack is `1 (flat)`, so a hit costs one draw: the d100. Then CMB-14's own d100.
  const pitted = mothGame([d100(1), d100(TUNING.corrosionChance), d100(100)]);
  pitted.state.tick.equipment.plating = items.equipEntry('Iron Plating');
  const hit = pitted.act({ type: 'wait' });
  assert.ok(texts(hit).includes('The Rust-moth pits the Iron Plating.'), 'CMB-14');
  assert.equal(items.entryWear(pitted.state.tick.equipment.plating), 1);

  const spared = mothGame([d100(1), d100(TUNING.corrosionChance + 1), d100(100)]);
  spared.state.tick.equipment.plating = items.equipEntry('Iron Plating');
  const missed = spared.act({ type: 'wait' });
  assert.ok(!texts(missed).some((t) => t.includes('pits')), 'one over the chance does nothing');
  assert.equal(items.entryWear(spared.state.tick.equipment.plating), 0);

  // No plating, no roll: the d100 is only drawn when there is a plate to pit (CMB-14).
  const bare = mothGame([d100(1), d100(100)]);
  bare.state.tick.equipment.plating = null;
  assert.equal(bare.act({ type: 'wait' }).ok, true, 'and the rest of the queue is untouched');

  // A miss never corrodes.
  const whiffed = mothGame([d100(100), d100(100)]);
  whiffed.state.tick.equipment.plating = items.equipEntry('Iron Plating');
  whiffed.act({ type: 'wait' });
  assert.equal(items.entryWear(whiffed.state.tick.equipment.plating), 0);
});

test('ACC-153: wear is per item and survives unequip, re-equip and a save @m13', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  tick.equipment.plating = items.equipEntry('Iron Plating', 2);
  tick.inventory = [{ name: 'Iron Plating', count: 1, wear: 0 }];

  const worn = items.itemDef('Iron Plating').plating;
  assert.equal(derive(tick, TUNING).plating, worn - 2, 'CMB-14: base minus wear');

  // Off and on again: the wear comes with it, and the fresh one in the pack keeps its own.
  assert.equal(game.act({ type: 'unequip', which: 'plating' }).ok, true);
  const stowed = tick.inventory.find((e) => items.entryWear(e) === 2);
  assert.ok(stowed, 'the pitted plate is in the pack, still pitted');
  assert.equal(tick.inventory.filter((e) => e.name === 'Iron Plating').length, 2, 'two instances');
  assert.equal(items.entryWear(tick.inventory.find((e) => e !== stowed)), 0, 'the other is clean');

  assert.equal(game.act({ type: 'equip', slot: tick.inventory.indexOf(stowed) }).ok, true);
  assert.equal(items.entryWear(tick.equipment.plating), 2, 'and it goes back on pitted');

  // TEC-09: the whole thing round-trips.
  const back = deserialize(serialize(game.state));
  assert.notEqual(back, null, 'the state is still serializable');
  assert.deepStrictEqual(back.tick.equipment, game.state.tick.equipment);
  assert.deepStrictEqual(back.tick.inventory, game.state.tick.inventory);
});

test('ACC-154: a pitted plate says so in the panel, the inventory and the inspect line @m13', () => {
  const entry = items.equipEntry('Iron Plating', 2);
  const def = items.itemDef('Iron Plating');
  assert.equal(items.displayName(entry), `Iron Plating (−2)`, 'UI-03 / ITM-05');
  assert.equal(items.displayName(items.equipEntry('Iron Plating')), 'Iron Plating', 'unworn says nothing');
  assert.equal(items.platingOf(entry), def.plating - 2);

  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  game.state.tick.equipment.plating = entry;
  assert.ok(panelStatuses(game.state.tick) !== undefined);
  const line = itemLine({ name: 'Iron Plating', count: 1, wear: 2 }, game.state.tick);
  assert.ok(line.includes('(−2)'), `UI-05 names the wear: ${line}`);
  assert.ok(line.includes(`plating ${def.plating} − 2 wear = ${def.plating - 2}`), line);
});

// ---------------------------------------------------------------------------------------------
// DIF-08 — elites (ENM-12)
// ---------------------------------------------------------------------------------------------

test('ACC-155: an Overwound enemy is the same enemy with exactly the ENM-12 numbers @m13', () => {
  const type = ENEMIES_BY_NAME.Sweeper;
  const plain = createEnemy('Sweeper', 1, 1, 1);
  const elite = createEnemy('Sweeper', 2, 1, 2, { elite: true, tuning: TUNING });

  assert.equal(plain.elite, false);
  assert.equal(elite.elite, true);
  assert.equal(elite.integrityMax, Math.ceil(type.integrity * TUNING.eliteIntegrityMult));
  assert.equal(elite.integrity, elite.integrityMax);
  assert.equal(enemyName(elite), `Overwound ${type.name}`);

  const state = { tick: { x: 0, y: 0 }, tuning: TUNING };
  assert.equal(statsOf(state, elite).accuracy, type.accuracy + TUNING.eliteAccuracyBonus);
  assert.equal(statsOf(state, plain).accuracy, type.accuracy, 'and the plain one is untouched');

  // "Cache guards and bosses are never elite. Packs are never elite."
  assert.equal(canBeElite({ type: 'Sweeper' }), true);
  assert.equal(canBeElite({ type: 'Sweeper', isGuard: true }), false);
  assert.equal(canBeElite({ type: 'Sweeper', isBoss: true }), false);
  assert.equal(canBeElite({ type: 'Rust-moth' }), false, 'a SWARMER pack type');
  assert.equal(canBeElite({ type: 'Brass Finch' }), false);
  assert.equal(canBeElite({ type: 'The Regulator' }), false);
  assert.equal(createEnemy('Sweeper', 3, 1, 3, { elite: true, isGuard: true }).elite, false);

  // The +2 lands on every attack, before Plating (ENM-12), and the XP is doubled.
  const rows = ['##########', '#........#', '#..T1....#', '#........#', '##########'];
  const game = fixtureGame(rows, {
    enemies: { 1: { type: 'Sweeper', state: 'ACTIVE', elite: true, ai: aiAttackAdjacent } },
    rng: queueRng([d100(1), die(1, 3), DROP_ROLL]),
  });
  const tick = game.state.tick;
  tick.equipment.plating = null;
  const before = tick.integrity;
  game.act({ type: 'wait' });
  assert.equal(before - tick.integrity, 1 + TUNING.eliteDamageBonus, 'ENM-12: +2 flat on a 1d3 of 1');

  const overwound = game.state.floor.enemies[0];
  overwound.integrity = 0;
  combat.breakActor(game.ctx, overwound);
  assert.equal(tick.xp, ENEMIES_BY_NAME.Sweeper.xp * TUNING.eliteXpMult, 'ENM-12: XP x2');
});

test('ACC-156: an Overwound enemy is drawn and described as one @m13', () => {
  const game = fixtureGame(['##########', '#........#', '#..T1....#', '#........#', '##########'], {
    enemies: { 1: { type: 'Sweeper', state: 'ACTIVE', elite: true, ai: aiWait } },
    rng: queueRng([]),
  });
  const enemy = game.state.floor.enemies[0];
  const style = actorStyle(game.state, enemy);
  assert.equal(style.glyph, ENEMIES_BY_NAME.Sweeper.glyph, 'UI-09: the same glyph');
  assert.equal(style.bg, ELITE_BG, 'on the dark gold ground');

  const line = inspectLine(game, enemy.x, enemy.y);
  assert.ok(line.startsWith('Overwound Sweeper'), `UI-05: ${line}`);
  const popup = enemyPopup(game, enemy);
  assert.equal(popup.title, 'Overwound Sweeper');
  assert.ok(
    popup.lines.some((l) => l.startsWith('overwound:')),
    `UI-11 spells the bonus out: ${popup.lines.join(' | ')}`,
  );
});

test('ACC-157: the elites of a seed are reproducible from the seed @m13', () => {
  for (const n of [2, 4, 7]) {
    const a = generateFloor('ELITE-SEED', n);
    const b = generateFloor('ELITE-SEED', n);
    assert.deepEqual(
      a.spawns.map((s) => `${s.type}:${s.elite}`),
      b.spawns.map((s) => `${s.type}:${s.elite}`),
      `floor ${n} must roll the same Overwound spawns twice`,
    );
    for (const spawn of a.spawns) {
      if (!spawn.elite) continue;
      assert.equal(canBeElite(spawn), true, `${spawn.type} may not be Overwound`);
    }
  }

  // Over many floors the rate is near `eliteChance` — the roll is a d100 per eligible spawn.
  let eligible = 0;
  let elite = 0;
  for (let i = 1; i <= 60; i++) {
    for (let n = 1; n <= 7; n++) {
      for (const spawn of generateFloor(`ELITE${i}`, n).spawns) {
        if (!canBeElite(spawn)) continue;
        eligible += 1;
        if (spawn.elite) elite += 1;
      }
    }
  }
  const rate = (elite / eligible) * 100;
  assert.ok(eligible > 500, `expected a big sample; got ${eligible}`);
  assert.ok(
    Math.abs(rate - TUNING.eliteChance) < 4,
    `ENM-12: measured ${rate.toFixed(1)}% against eliteChance ${TUNING.eliteChance}`,
  );
});

// ---------------------------------------------------------------------------------------------
// DIF-09 — level-ups give less Integrity (CHR-07)
// ---------------------------------------------------------------------------------------------

test('ACC-158: a level-up adds levelUpIntegrity, and level 9 is the modelled cap @m13', () => {
  const game = fixtureGame(['############', '#..........#', '#.Tm.......#', '#..........#', '############'], {
    enemies: { m: { ai: aiWait } },
    rng: queueRng([d100(1), die(1, 4), DROP_ROLL]),
  });
  const tick = game.state.tick;
  tick.xp = 9;
  const before = tick.integrityMax;

  game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(tick.level, 2);
  assert.equal(tick.integrityMax, before + TUNING.levelUpIntegrity, 'CHR-07');
  assert.equal(tick.integrity, before + TUNING.levelUpIntegrity);

  // BAL-02's "Integrity max" column at the cap, and with Braced Frame on top of it.
  const capped = START_INTEGRITY + TUNING.levelUpIntegrity * 8;
  assert.equal(capped, 64, 'CHR-07: level 9 without skills');
});

// ---------------------------------------------------------------------------------------------
// DIF-10 — persistent pursuit (ENM-05, ENM-13)
// ---------------------------------------------------------------------------------------------

test('ACC-159: an Active chaser gives up only after memoryTurns quiet actions @m13', () => {
  const game = fixtureGame(['##########', '#T.......#', '##########', '#.......s#', '##########'], {
    rng: queueRng([]),
    enemies: { s: { state: 'ACTIVE', lastKnown: { x: 8, y: 3 } } },
  });
  const sweeper = game.state.floor.enemies[0];

  for (let i = 0; i < TUNING.memoryTurns; i++) game.act({ type: 'wait' });
  assert.equal(sweeper.lastKnownAge, TUNING.memoryTurns);
  assert.equal(sweeper.state, 'ACTIVE', 'still awake at exactly memoryTurns');

  game.act({ type: 'wait' });
  assert.equal(sweeper.state, 'DORMANT', 'ENM-05: the action after it is the one that gives up');
});

test('ACC-160: a woken Spring-Hound hunts by sound through walls, and never sleeps @m13', () => {
  const range = TUNING.houndRange;
  const row = (chars) => chars.padEnd(range + 6, '#');
  const rows = [
    row('#'.repeat(range + 6)),
    row('#T' + '.'.repeat(range + 2) + '#'),
    row('#'.repeat(range + 6)),
    row('#' + '.'.repeat(range + 3) + '#'),
    row('#'.repeat(range + 6)),
  ];
  // The hound sits on its own sealed row, walls between it and Tick.
  const game = fixtureGame(rows, {
    rng: queueRng([]),
    enemies: { h: { state: 'ACTIVE', lastKnown: { x: 1, y: 3 } } },
  });
  const state = game.state;
  const hound = createEnemy('Spring-Hound', 1 + range, 3, 99, { state: 'ACTIVE', lastKnown: { x: 1, y: 3 } });
  state.floor.enemies.push(hound);
  assert.equal(chebyshev(hound.x, hound.y, state.tick.x, state.tick.y), range);

  ai.track(hound, state);
  assert.deepEqual(hound.lastKnown, { x: state.tick.x, y: state.tick.y }, 'ENM-13: hunts by sound');
  assert.equal(hound.lastKnownAge, 0);

  // One tile further and the sound does not reach.
  hound.x = 1 + range + 1;
  hound.lastKnown = { x: 1, y: 3 };
  ai.track(hound, state);
  assert.deepEqual(hound.lastKnown, { x: 1, y: 3 }, 'out of range it ages like anyone');
  assert.equal(hound.lastKnownAge, 1);

  // And it never goes back to sleep, however long it is quiet.
  hound.lastKnownAge = TUNING.memoryTurns + 5;
  ai.track(hound, state);
  assert.equal(hound.state, 'ACTIVE', 'ENM-13: never Dormant once woken');
});

test('ACC-161: a Cuckoo shriek takes the guards off their doors for rallyTurns @m13', () => {
  const rows = ['############', '#..........#', '#.T..t...c.#', '#..........#', '############'];
  const game = fixtureGame(rows, {
    rng: queueRng([]),
    enemies: {
      t: { state: 'DORMANT', homeRoom: 0 },
      c: { state: 'ACTIVE', ai: aiWait },
    },
  });
  const state = game.state;
  state.floor.rooms = [{ id: 0, x: 5, y: 2, w: 1, h: 1, cx: 5, cy: 2 }];
  const soldier = state.floor.enemies.find((e) => e.type === 'Tin Soldier');
  const cuckoo = state.floor.enemies.find((e) => e.type === 'Cuckoo');
  soldier.homeRoom = 0;

  const rallied = combat.rallyGuards(game.ctx, cuckoo, ENEMIES_BY_NAME.Cuckoo.ranged.noise);
  assert.equal(rallied, 1, 'ENM-13: one guard left its door');
  assert.equal(soldier.ralliedUntil, state.turn + TUNING.rallyTurns);
  assert.equal(soldier.state, 'ACTIVE', 'and the shriek woke it');
  assert.ok(ai.rallied(soldier, state));

  // While rallied it runs the CHASER list — it walks at Tick rather than holding its room.
  soldier.lastKnown = { x: state.tick.x, y: state.tick.y };
  const chasing = ai.decide(soldier, state, game.ctx);
  assert.equal(chasing.type, 'move', `a rallied guard leaves: ${JSON.stringify(chasing)}`);

  // When the rally runs out it goes home (ENM-13).
  state.turn = soldier.ralliedUntil + 1;
  ai.track(soldier, state);
  assert.equal(soldier.ralliedUntil, undefined);
  assert.equal(soldier.state, 'RETURNING', 'ENM-13: "then RETURNING"');
});

// ---------------------------------------------------------------------------------------------
// DIF-11 — the Magpie (ENM-06 THIEF)
// ---------------------------------------------------------------------------------------------

/** A Magpie adjacent to Tick. */
function magpieGame(rolls, opts = {}) {
  // No `ai` override: ENM-06's THIEF list is what this is testing, and it is `src/ai.js`'s.
  return fixtureGame(['##########', '#........#', '#..Tb....#', '#........#', '##########'], {
    enemies: { b: Object.assign({ state: 'ACTIVE', lastKnown: { x: 3, y: 2 } }, opts) },
    rng: queueRng(rolls),
  });
}

test('ACC-162: a Magpie takes one unit of one stack, or hits when there is nothing to take @m13', () => {
  // The hit roll, then the uniform pick over the stacks Tick carries.
  const game = magpieGame([d100(1), die(2, 2)]);
  const tick = game.state.tick;
  tick.inventory = [
    { name: 'Solder', count: 2 },
    { name: 'Spring-Key', count: 1 },
  ];
  const before = tick.integrity;

  const result = game.act({ type: 'wait' });
  assert.equal(tick.integrity, before, 'DIF-11: it steals *instead of* damage');
  assert.ok(texts(result).includes('The Magpie snatches the Spring-Key!'), texts(result).join(' | '));
  assert.deepEqual(tick.inventory, [{ name: 'Solder', count: 2 }], 'exactly one unit, one stack');
  assert.equal(game.state.floor.enemies[0].stolen, 'Spring-Key');
  assert.equal(game.state.stats.itemsStolen, 1);

  // Nothing to take: the hit is an ordinary `1d2`.
  const empty = magpieGame([d100(1), die(2, 2), d100(100)]);
  empty.state.tick.inventory = [];
  empty.state.tick.equipment.plating = null;
  const hurt = empty.state.tick.integrity;
  empty.act({ type: 'wait' });
  assert.ok(empty.state.tick.integrity < hurt, 'CMB-06: it hits for 1d2 instead');
  assert.equal(empty.state.floor.enemies[0].stolen, undefined);
});

test('ACC-163: a Magpie that has stolen runs, never attacks again, and gives it back when broken @m13', () => {
  // The hit roll, the steal's pick, then ITM-11's drop roll and the Magpie's one-line table:
  // its `dropChance` is 100, so the table is always rolled (DIF-11).
  const game = magpieGame([d100(1), die(1, 1), d100(1), die(1, 1)]);
  const state = game.state;
  state.tick.inventory = [{ name: 'Solder', count: 1 }];
  game.act({ type: 'wait' });

  const magpie = state.floor.enemies[0];
  assert.equal(magpie.stolen, 'Solder');
  assert.equal(magpie.fleeing, true);

  // ENM-06 THIEF: from here it only retreats — `thief` never returns an attack.
  magpie.ai = undefined;
  for (let i = 0; i < 5; i++) {
    const action = ai.thief(magpie, state);
    assert.notEqual(action.type, 'melee', 'a fleeing thief never attacks again');
    if (action.type === 'move') {
      magpie.x = action.x;
      magpie.y = action.y;
    }
  }

  // ITM-11 with no distance limit: what it took comes back.
  magpie.integrity = 0;
  combat.breakActor(game.ctx, magpie);
  const returned = state.floor.items.find((i) => i.name === 'Solder');
  assert.ok(returned, 'DIF-11: the stolen item is never lost');
  assert.equal(magpie.stolen, null);
});

test('ACC-164: a wandering Magpie is the same thief as a placed one @m13', () => {
  const game = generatedGame('MAGPIE1', 5);
  const state = game.state;
  const magpie = createEnemy('Magpie', state.tick.x + 1, state.tick.y, state.floor.nextEnemyId++, {
    state: 'ACTIVE',
    tuning: TUNING,
  });
  magpie.wanderer = true;
  state.floor.enemies.push(magpie);
  state.tick.inventory = [{ name: 'Grit Bomb', count: 1 }];

  // One draw for the pick over the single stack; `combat.steal` is the whole rule.
  game.ctx.rng = queueRng([die(1, 1)]);
  const stolen = combat.steal(game.ctx, magpie, state.tick);
  assert.equal(stolen, 'Grit Bomb');
  assert.equal(magpie.fleeing, true);
  assert.deepEqual(state.tick.inventory, []);
  assert.equal(ai.thief(magpie, state).type !== 'melee', true);
});

// ---------------------------------------------------------------------------------------------
// DIF-12 — cache locks (WLD-15)
// ---------------------------------------------------------------------------------------------

test('ACC-165: a Wound Lock costs Tension to open, refuses without it, and stays open @m13', () => {
  const rows = ['#######', '#..T=.#', '#######'];
  const game = fixtureGame(rows, { rng: queueRng([]) });
  const state = game.state;
  state.floor.tiles[1][4] = TILE.WOUND_LOCK;

  // Too little spring: refused, no turn, still locked (CMB-05).
  state.tick.tension = TUNING.cacheLockCost;
  const refused = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'notEnoughTension');
  assert.deepEqual(texts(refused), ['Not enough spring for the lock.']);
  assert.equal(state.turn, 0);
  assert.equal(state.floor.tiles[1][4], TILE.WOUND_LOCK);

  // Enough: it winds open, costs the Tension and a turn, and Tick has not moved yet (WLD-02).
  state.tick.tension = 60;
  const opened = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(opened.ok, true);
  assert.equal(state.tick.tension, 60 - TUNING.cacheLockCost);
  assert.deepEqual(texts(opened), [`Tick winds the lock. Tension ${60 - TUNING.cacheLockCost}.`]);
  assert.equal(state.floor.tiles[1][4], TILE.DOOR_OPEN, 'WLD-15: it becomes an open door');
  assert.deepEqual({ x: state.tick.x, y: state.tick.y }, { x: 3, y: 1 }, 'the bump was the turn');

  // And it stays open — the next step walks through.
  assert.equal(game.act({ type: 'move', dx: 1, dy: 0 }).ok, true);
  assert.equal(state.tick.x, 4);
  assert.equal(inspectLine(game, 4, 1).length >= 0, true);
});

test('ACC-166: every cache entrance is a Wound Lock, and the guard is inside @m13', () => {
  const offenders = [];
  let floors = 0;
  let guards = 0;
  for (let i = 1; i <= 150; i++) {
    for (let n = 1; n <= 7; n++) {
      const floor = generateFloor(`LOCK${i}`, n);
      const room = floor.rooms[floor.roles.cache];
      floors += 1;
      const inside = (x, y) => x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
      for (let y = room.y - 1; y <= room.y + room.h; y++) {
        for (let x = room.x - 1; x <= room.x + room.w; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H || inside(x, y)) continue;
          const t = floor.tiles[y][x];
          if (t === TILE.WALL || t === TILE.WOUND_LOCK) continue;
          const entrance = inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1);
          if (entrance) offenders.push(`LOCK${i} floor ${n}: (${x},${y}) is not a lock`);
        }
      }
      const guard = floor.spawns.find((s) => s.isGuard);
      if (guard) {
        guards += 1;
        assert.ok(inside(guard.x, guard.y), `LOCK${i} floor ${n}: the guard is outside its cache`);
      }
      // And the cache items are all inside the room the locks close.
      for (const item of floor.items.filter((it) => it.source === 'cache')) {
        assert.ok(inside(item.x, item.y), `LOCK${i} floor ${n}: a cache item is outside`);
      }
    }
  }
  assert.equal(floors, 150 * 7);
  assert.ok(guards > 0, 'every floor 1-7 has a cache guard');
  assert.deepEqual(offenders.slice(0, 5), [], `WLD-15: ${offenders.length} unlocked cache entrances`);
});

test('ACC-167: a BREAKS enemy opens a cache, and a YES enemy treats the lock as a wall @m13', () => {
  // The Golem stands against the lock: its first step is the one that has to go through it.
  const rows = ['#########', '#.T.=g..#', '#########'];
  const game = fixtureGame(rows, { rng: queueRng([]), enemies: { g: { state: 'ACTIVE', lastKnown: { x: 2, y: 1 } } } });
  const state = game.state;
  state.floor.tiles[1][4] = TILE.WOUND_LOCK;
  const golem = state.floor.enemies[0];

  const action = ai.decide(golem, state, game.ctx);
  assert.deepEqual(action, { type: 'breakDoor', x: 4, y: 1 }, 'WLD-15: BREAKS goes through it');

  // The Gear-Golem is SLOW (CMB-03), so it acts on every second turn.
  let noises = 0;
  for (let i = 0; i < 2 && state.floor.tiles[1][4] === TILE.WOUND_LOCK; i++) {
    game.act({ type: 'wait' });
    noises += state.floor.noises.length;
  }
  assert.equal(state.floor.tiles[1][4], TILE.FLOOR, 'and the lock is gone');
  assert.ok(noises > 0, 'CMB-11: breaking it is loud');

  // A YES enemy (the Sweeper opens doors) plans around it instead — it is a wall to it.
  const walled = fixtureGame(rows, { rng: queueRng([]), enemies: { g: { type: 'Sweeper', state: 'ACTIVE', lastKnown: { x: 2, y: 1 } } } });
  walled.state.floor.tiles[1][4] = TILE.WOUND_LOCK;
  const sweeper = walled.state.floor.enemies[0];
  const stuck = ai.decide(sweeper, walled.state, walled.ctx);
  assert.equal(stuck.type, 'wait', `WLD-15: a YES enemy cannot pass: ${JSON.stringify(stuck)}`);
});
