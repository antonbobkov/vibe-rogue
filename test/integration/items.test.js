// M05 — items and inventory: the inventory model and its actions (ITM-03, ITM-06, ITM-07), the
// equipment swap (ITM-02), consumables and throwables (ITM-09, CAT-06), the weapon and attachment
// specials (CAT-01, CAT-05), and loot (ITM-10, ITM-11).
//
// Every test that needs randomness injects `queueRng` and states each draw in the order TEC-07
// fixes: the `d100` hit roll before the damage dice, the ITM-11 `d100` drop roll before the drop
// table's own draw, enemies in id order. Expected values are written from the spec (PLN-02 R6).

import test from 'node:test';
import assert from 'node:assert/strict';

import * as items from '../../src/items.js';
import * as combat from '../../src/combat.js';
import { createTick, derive } from '../../src/actors.js';
import { queueRng } from '../../src/rng.js';
import { TILE } from '../../src/tiles.js';
import { fixtureGame, floorFromAscii, d100, die, aiWait } from '../fixtures/maps.js';

const texts = (result) => result.log.map((l) => l.text);

/** A small arena: Tick at (2,2), open floor around it. */
const ROOM = ['##########', '#........#', '#.T......#', '#........#', '##########'];

/** Put an item record on Tick's own tile (ITM-04: at most one item per tile). */
function itemUnderTick(game, name, count = 1) {
  const { x, y } = game.state.tick;
  game.state.floor.items.push({ name, count, x, y });
  return game.state.floor.items.at(-1);
}

/** Fill the inventory to `n` slots with a non-stacking item (ITM-01: weapons never stack). */
function fillSlots(game, n) {
  const inv = game.state.tick.inventory;
  while (inv.length < n) inv.push({ name: 'Mallet', count: 1 });
  return inv;
}

// ---------------------------------------------------------------------------------------------
// ITM-03 / ITM-06 — the inventory and picking things up
// ---------------------------------------------------------------------------------------------

test('ACC-50: a pickup with all ten slots full is refused, spends no turn and says so @m05', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  itemUnderTick(game, 'Cog Saw'); // ITM-01: a weapon never stacks, so it needs a slot of its own
  fillSlots(game, items.INVENTORY_SLOTS);

  const result = game.act({ type: 'pickup' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'full');
  assert.deepEqual(texts(result), ["No room. Tick's frame carries ten things."]);
  assert.equal(game.state.turn, 0, 'CMB-05: a refused pickup spends no turn');
  assert.equal(game.state.floor.items.length, 1, 'and the item is still on the floor');
  assert.equal(game.state.tick.inventory.length, items.INVENTORY_SLOTS);
});

test('ACC-51: a full stack of five takes a new slot, and is refused when no slot is free @m05', () => {
  // ITM-03: "Picking up a consumable adds to an existing non-full stack of the same name first;
  // otherwise it takes a new slot."
  const roomy = fixtureGame(ROOM, { rng: queueRng([]) });
  roomy.state.tick.inventory = [{ name: 'Solder', count: items.STACK_MAX }];
  itemUnderTick(roomy, 'Solder');

  assert.equal(roomy.act({ type: 'pickup' }).ok, true);
  assert.deepEqual(roomy.state.tick.inventory, [
    { name: 'Solder', count: 5 },
    { name: 'Solder', count: 1 },
  ]);
  assert.equal(roomy.state.turn, 1, 'ITM-07: a pickup costs a turn');

  const packed = fixtureGame(ROOM, { rng: queueRng([]) });
  packed.state.tick.inventory = [{ name: 'Solder', count: items.STACK_MAX }];
  fillSlots(packed, items.INVENTORY_SLOTS);
  itemUnderTick(packed, 'Solder');

  const refused = packed.act({ type: 'pickup' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'full');
  assert.equal(packed.state.turn, 0);

  // A non-full stack is filled before any free slot is taken.
  const stacking = fixtureGame(ROOM, { rng: queueRng([]) });
  stacking.state.tick.inventory = [{ name: 'Mallet', count: 1 }, { name: 'Solder', count: 2 }];
  itemUnderTick(stacking, 'Solder', 1);
  assert.equal(stacking.act({ type: 'pickup' }).ok, true);
  assert.deepEqual(stacking.state.tick.inventory, [
    { name: 'Mallet', count: 1 },
    { name: 'Solder', count: 3 },
  ]);
  assert.equal(
    texts(stacking.act({ type: 'wait' })).length,
    0,
    'and nothing else was logged by the wait that follows',
  );
});

test('ITM-03: removing an item compacts the list and the letters shift up one @m05 @unit', () => {
  const tick = createTick();
  tick.inventory = [];
  for (const name of ['Solder', 'Spring-Key', 'Mallet', 'Grit Bomb']) items.addToInventory(tick, name);
  assert.deepEqual(tick.inventory.map((s) => s.name), ['Solder', 'Spring-Key', 'Mallet', 'Grit Bomb']);
  assert.deepEqual([0, 1, 2, 3].map(items.slotLetter), ['a', 'b', 'c', 'd']);

  // "Items occupy slots in the order acquired; removing an item compacts the list."
  items.takeFromStack(tick, 1); // the Spring-Key stack empties
  assert.deepEqual(tick.inventory.map((s) => s.name), ['Solder', 'Mallet', 'Grit Bomb']);
  assert.equal(items.slotOf(tick, 'Mallet'), 1, 'the Mallet moved from c to b');
  assert.equal(items.slotOf(tick, 'Grit Bomb'), 2);

  // A stack that is not empty keeps its slot.
  items.addToInventory(tick, 'Grit Bomb', 2);
  assert.deepEqual(tick.inventory[2], { name: 'Grit Bomb', count: 3 });
  items.takeFromStack(tick, 2);
  assert.deepEqual(tick.inventory[2], { name: 'Grit Bomb', count: 2 });

  // ITM-03: ten slots, lettered a-j in display order, and nothing beyond them.
  assert.equal(items.INVENTORY_SLOTS, 10);
  assert.equal(items.slotLetter(9), 'j');
  assert.equal(items.slotLetter(10), null);
  assert.equal(items.slotOfLetter('a'), 0);
  assert.equal(items.slotOfLetter('j'), 9);
  assert.equal(items.slotOfLetter('k'), -1);
});

test('ITM-06: picking up a stack names both numbers, and a single item names itself @m05 @unit', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  game.state.tick.inventory = [{ name: 'Solder', count: 1 }];
  itemUnderTick(game, 'Solder', 2);

  // ITM-06's own example: "Tick picks up 2 Solder (now 3)." (D-049).
  assert.deepEqual(texts(game.act({ type: 'pickup' })), ['Tick picks up 2 Solder (now 3).']);
  assert.deepEqual(game.state.tick.inventory, [{ name: 'Solder', count: 3 }]);

  const single = fixtureGame(ROOM, { rng: queueRng([]) });
  itemUnderTick(single, 'Cog Saw');
  assert.deepEqual(texts(single.act({ type: 'pickup' })), ['Tick picks up the Cog Saw.']);
  assert.equal(single.state.floor.items.length, 0, 'ITM-04: it left the tile');

  // "If no item, no turn is spent." (CMB-05)
  const empty = fixtureGame(ROOM, { rng: queueRng([]) });
  const nothing = empty.act({ type: 'pickup' });
  assert.equal(nothing.ok, false);
  assert.equal(nothing.reason, 'nothingHere');
  assert.equal(empty.state.turn, 0);
});

test('ACC-65: a journal page goes to the Journal, never the inventory, and logs the SCR-04 line @m05', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const before = game.state.tick.inventory.length;
  itemUnderTick(game, 'Journal page 1');

  const result = game.act({ type: 'pickup' });
  assert.equal(result.ok, true);
  assert.equal(game.state.turn, 1, 'ITM-03: it takes a turn like any pickup');
  assert.deepEqual(texts(result), ['Tick finds a page in her hand. (Journal, page 1)']);
  assert.equal(result.log[0].color, 'green', 'SCR-04: the line is green (UI-04)');
  assert.equal(game.state.tick.inventory.length, before, 'records never enter the inventory');
  assert.equal(game.state.journal.pages[0], true, 'the Journal screen shows page 1 (UI-15)');
  assert.deepEqual(game.state.journal.pages.slice(1), [false, false, false, false, false, false, false]);
  assert.equal(game.state.floor.items.length, 0);

  // CAT-07: the Understudy Blueprint is the ninth record and has its own line.
  const six = fixtureGame(ROOM, { number: 6, rng: queueRng([]) });
  itemUnderTick(six, 'Understudy Blueprint');
  assert.deepEqual(texts(six.act({ type: 'pickup' })), ['Tick unfolds a drawing. (Journal, Blueprint)']);
  assert.equal(six.state.journal.blueprint, true);
});

// ---------------------------------------------------------------------------------------------
// ITM-02 / ITM-07 — equipment
// ---------------------------------------------------------------------------------------------

test('ACC-52: equipping a weapon swaps the old one into the slot it came from @m05', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  tick.inventory.push({ name: 'Mallet', count: 1 }); // slot c (CHR-01 fills a and b)
  assert.equal(items.slotLetter(2), 'c');
  assert.equal(tick.equipment.weapon, 'Wrench');

  const result = game.act({ type: 'equip', slot: 2 });
  assert.equal(result.ok, true);
  assert.equal(game.state.turn, 1, 'ITM-07: equipping costs a turn');
  assert.deepEqual(texts(result), ['Tick wields the Mallet.']);
  assert.equal(tick.equipment.weapon, 'Mallet');
  assert.deepEqual(tick.inventory[2], { name: 'Wrench', count: 1 }, 'ITM-02: the old item takes slot c');
  assert.equal(tick.inventory.length, 3, 'and no letter moved');
  assert.deepEqual(derive(tick).attack, { n: 1, sides: 6, mod: 1 }, 'CAT-02: the Mallet is 1d6+1');
  assert.equal(derive(tick).accuracy, 75, '80 + the Mallet is -5');

  // An empty slot takes the item straight out of the inventory and compacts (ITM-03).
  tick.inventory.push({ name: 'Balance Wheel', count: 1 }); // slot d
  assert.equal(game.act({ type: 'equip', slot: 3 }).ok, true);
  assert.equal(tick.equipment.attachment, 'Balance Wheel');
  assert.equal(tick.inventory.length, 3);
  assert.equal(derive(tick).precision, 1, 'CAT-05: +1 Precision');
  assert.equal(derive(tick).evasion, 15, 'and +5 evasion on CMB-01 base 10');

  // ITM-07: unequipping needs a free slot, and is refused without a turn when there is none.
  fillSlots(game, items.INVENTORY_SLOTS);
  const turnBefore = game.state.turn;
  const refused = game.act({ type: 'unequip', which: 'attachment' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'full');
  assert.equal(game.state.turn, turnBefore);
  assert.equal(tick.equipment.attachment, 'Balance Wheel');

  tick.inventory.pop();
  assert.equal(game.act({ type: 'unequip', which: 'attachment' }).ok, true);
  assert.equal(tick.equipment.attachment, null);
  assert.deepEqual(tick.inventory.at(-1), { name: 'Balance Wheel', count: 1 });
});

test('ACC-53: Brass Plating reads PLT 2 and EVA 8 on the panel @m05', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  tick.inventory.push({ name: 'Brass Plating', count: 1 });

  const result = game.act({ type: 'equip', slot: 2 });
  assert.deepEqual(texts(result), ['Tick bolts on the Brass Plating.']);
  const d = game.derived();
  assert.equal(d.plating, 2, 'CAT-04: Brass Plating is 2');
  assert.equal(d.evasion, 8, 'CMB-01: 10 - the 2 evasion penalty');
  assert.equal(tick.inventory.length, 2, 'the item left the inventory (ITM-02)');
});

test('ACC-54: dropping onto a tile that already holds an item is refused without a turn @m05', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  itemUnderTick(game, 'Solder');

  const refused = game.act({ type: 'drop', slot: 1 }); // the Spring-Key of CHR-01
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'tileOccupied');
  assert.equal(game.state.turn, 0);
  assert.equal(game.state.tick.inventory.length, 2, 'nothing left the inventory');
  assert.equal(game.state.floor.items.length, 1, 'ITM-04: a tile holds at most one item');

  // On a clear tile the whole stack goes down and the list compacts.
  const clear = fixtureGame(ROOM, { rng: queueRng([]) });
  clear.state.tick.inventory[1] = { name: 'Spring-Key', count: 3 };
  const dropped = clear.act({ type: 'drop', slot: 1 });
  assert.equal(dropped.ok, true);
  assert.deepEqual(texts(dropped), ['Tick sets down the Spring-Key.']);
  assert.deepEqual(clear.state.tick.inventory, [{ name: 'Solder', count: 1 }]);
  assert.deepEqual(clear.state.floor.items, [{ name: 'Spring-Key', count: 3, x: 2, y: 2 }]);

  // ITM-07: a feature tile refuses the drop too (D-055).
  const stairs = fixtureGame(['##########', '#........#', '#.T<.....#', '#........#', '##########'], {
    rng: queueRng([]),
  });
  stairs.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(stairs.state.floor.tiles[2][3], TILE.STAIRS_UP);
  const onStairs = stairs.act({ type: 'drop', slot: 0 });
  assert.equal(onStairs.ok, false);
  assert.equal(onStairs.reason, 'featureTile');
});

// ---------------------------------------------------------------------------------------------
// ITM-09 / CAT-06 — consumables
// ---------------------------------------------------------------------------------------------

test('ITM-09: Solder mends 15 and Spring-Key winds 30, and a wasted one is still spent @m05 @unit', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  tick.integrity = 20;
  tick.tension = 50;

  assert.deepEqual(texts(game.act({ type: 'use', slot: 0 })), ['Tick solders the plate. Integrity 35.']);
  assert.equal(tick.integrity, 35, 'CAT-06: Integrity +15');
  assert.deepEqual(tick.inventory, [{ name: 'Spring-Key', count: 1 }], 'the stack emptied and compacted');

  assert.deepEqual(texts(game.act({ type: 'use', slot: 0 })), ['Tick fits the Spring-Key. Tension 80.']);
  assert.equal(tick.tension, 80, 'CAT-06: Tension +30');
  assert.deepEqual(tick.inventory, []);

  // ITM-09: "Using a consumable that would have no effect ... is still allowed and still consumes
  // it; the log says 'Nothing needed mending.'"
  tick.integrity = tick.integrityMax;
  tick.inventory.push({ name: 'Solder', count: 2 });
  assert.deepEqual(texts(game.act({ type: 'use', slot: 0 })), ['Nothing needed mending.']);
  assert.deepEqual(tick.inventory, [{ name: 'Solder', count: 1 }], 'and one still left the stack');

  // CHR-03: restoring above 100 is wasted, and says so.
  tick.tension = 100;
  tick.inventory.push({ name: 'Spring-Key', count: 1 });
  assert.deepEqual(texts(game.act({ type: 'use', slot: 1 })), ['The spring is already tight.']);

  // ITM-07: Use is for instant consumables only; a throwable is refused without a turn.
  tick.inventory.push({ name: 'Oil Flask', count: 1 });
  const turnBefore = game.state.turn;
  const refused = game.act({ type: 'use', slot: tick.inventory.length - 1 });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'notUsable');
  assert.equal(game.state.turn, turnBefore);
});

test('CAT-06: Flux clears all five statuses from Tick and mends 5 @m05 @unit', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  tick.integrity = 30;
  tick.statuses = { Stunned: 0, Slowed: 3, Burning: 4, Blinded: 2, Exposed: 5 };
  tick.inventory = [{ name: 'Flux', count: 1 }];

  // Stunned would forbid every action but Wait (CMB-04), so it is not one of the four set here.
  const result = game.act({ type: 'use', slot: 0 });
  assert.equal(result.ok, true);
  assert.deepEqual(tick.statuses, {}, 'CAT-06: "Remove all five statuses from Tick"');
  assert.equal(tick.integrity, 35, 'and Integrity +5');
  assert.equal(
    texts(result).at(-1),
    'Tick cleans the joints. Integrity 35.',
    'SCR-10: the Flux line reports the new Integrity',
  );
  assert.equal(texts(result).includes('Nothing needed mending.'), false);
  assert.deepEqual(tick.inventory, []);
});

// ---------------------------------------------------------------------------------------------
// CAT-01 — weapon specials at CMB-06 step 6
// ---------------------------------------------------------------------------------------------

test('ACC-58: the Cog Saw Rends, so the following turn ignores Plating and the one after does not @m05', () => {
  // Cog Saw 1d4+1 (+5 accuracy) against the Gear-Golem: accuracy 85, evasion 0, Plating 3 (BST-02).
  const game = fixtureGame(['##########', '#........#', '#.Tg.....#', '#........#', '##########'], {
    enemies: { g: { ai: aiWait } },
    rng: queueRng([
      d100(50), die(4, 4), // turn 1: hit for 1d4+1 = 5, Plating 3 applies -> 2
      d100(50), die(4, 4), // turn 2: hit while Exposed -> the whole 5
      d100(90),            // turn 3: a miss, so Rend does not renew the Exposed
      d100(50), die(4, 4), // turn 4: Exposed has expired, Plating 3 applies again -> 2
    ]),
  });
  game.state.tick.equipment.weapon = 'Cog Saw';
  const golem = game.state.floor.enemies[0];
  const swing = () => texts(game.act({ type: 'move', dx: 1, dy: 0 }));

  assert.deepEqual(swing(), ['Tick hits the Gear-Golem for 2.', 'The Gear-Golem is Exposed.']);
  assert.equal(golem.integrity, 28);
  assert.equal(golem.statuses.Exposed, 1, 'CMB-10: Exposed 2, decremented once at step 7');

  assert.deepEqual(
    swing(),
    ['Tick hits the Gear-Golem for 5.', 'The Gear-Golem is Exposed.'],
    'ACC-58: Plating is treated as 0, and the hit Rends again (CAT-01)',
  );
  assert.equal(golem.integrity, 23);
  assert.equal(golem.statuses.Exposed, 1, 'the hit renewed it to 2, then step 7 took one off');

  assert.deepEqual(swing(), ['Tick misses the Gear-Golem.']);
  assert.equal(golem.statuses.Exposed, undefined, 'a miss never Rends, so it expired');

  assert.deepEqual(swing(), ['Tick hits the Gear-Golem for 2.', 'The Gear-Golem is Exposed.']);
  assert.equal(golem.integrity, 21, 'the attack after that pays Plating again');
});

test('ACC-59: a Pendulum Flail hit sweeps every other adjacent enemy for 2, minus its Plating @m05', () => {
  // ids follow reading order: 1 = the Sweeper above Tick, 2 = the Tin Soldier west, 3 = the
  // Sweeper east, which is the one Tick attacks.
  const rows = ['#####', '#.s.#', '#tTs#', '#...#', '#####'];
  const game = fixtureGame(rows, {
    enemies: { s: { ai: aiWait }, t: { ai: aiWait } },
    rng: queueRng([d100(50), die(1, 4), die(1, 4)]),
  });
  game.state.tick.equipment.weapon = 'Pendulum Flail'; // 2d4+2, -10 accuracy, Sweep
  const [above, west, east] = game.state.floor.enemies;
  assert.deepEqual([above.id, west.id, east.id], [1, 2, 3]);

  const result = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.deepEqual(texts(result), [
    'Tick hits the Sweeper for 4.',
    'The Sweeper takes 2 from the Pendulum Flail.',
    'The Tin Soldier takes 1 from the Pendulum Flail.',
  ]);
  assert.equal(east.integrity, 3, '7 - (1 + 1 + 2)');
  assert.equal(above.integrity, 5, 'CAT-01: 2 damage, Plating 0');
  assert.equal(west.integrity, 15, 'CAT-01: "Plating applies" — the Tin Soldier has 1');
});

test('CAT-01: Knock pushes on damage 6 or more, Tempo Slows, and Ring Exposes @m05 @unit', () => {
  // Piston Hammer 3d4 (-5 accuracy) against a Sweeper: 70 - 5 = 65 to hit, Plating 0.
  const knock = fixtureGame(['##########', '#........#', '#.Ts.....#', '#........#', '##########'], {
    enemies: { s: { ai: aiWait } },
    rng: queueRng([d100(50), die(2, 4), die(2, 4), die(2, 4), d100(50), die(1, 4), die(1, 4), die(1, 4)]),
  });
  knock.state.tick.equipment.weapon = 'Piston Hammer';
  knock.state.floor.enemies[0].integrity = 40; // survive both blows
  knock.act({ type: 'move', dx: 1, dy: 0 }); // 6 damage: at the threshold
  assert.deepEqual(
    { x: knock.state.floor.enemies[0].x, y: knock.state.floor.enemies[0].y },
    { x: 4, y: 2 },
    'CAT-01: "On damage >= 6" pushes 1 tile directly away (CMB-09)',
  );

  knock.state.floor.enemies[0].x = 3; // back to adjacent
  knock.act({ type: 'move', dx: 1, dy: 0 }); // 3 damage: below the threshold
  assert.deepEqual(
    { x: knock.state.floor.enemies[0].x, y: knock.state.floor.enemies[0].y },
    { x: 3, y: 2 },
    'and does nothing below it',
  );
  assert.equal(knock.state.floor.enemies[0].statuses.Stunned, undefined, 'CAT-01: "No Stun."');

  // Conductor's Baton 1d6+2 (+15): Tempo. 95 - 5 = 90 to hit.
  const tempo = fixtureGame(['##########', '#........#', '#.Ts.....#', '#........#', '##########'], {
    enemies: { s: { ai: aiWait } },
    rng: queueRng([d100(50), die(1, 6)]),
  });
  tempo.state.tick.equipment.weapon = "Conductor's Baton";
  const slowed = texts(tempo.act({ type: 'move', dx: 1, dy: 0 }));
  assert.deepEqual(slowed, ['Tick hits the Sweeper for 3.', 'The Sweeper is Slowed.'], 'CAT-01: Slowed 1');
  assert.equal(
    tempo.state.floor.enemies[0].statuses.Slowed,
    undefined,
    'CMB-10: a 1-turn status covers this turn\'s enemy phase and expires at step 7',
  );

  // Harmonic Rifle 2d4 (+5, range 7, 4 Tension): Ring, on a ranged hit.
  const ring = fixtureGame(['##########', '#........#', '#.T..s...#', '#........#', '##########'], {
    enemies: { s: { ai: aiWait } },
    rng: queueRng([d100(50), die(1, 4), die(1, 4)]),
  });
  ring.state.tick.equipment.weapon = 'Harmonic Rifle';
  const shot = ring.act({ type: 'fire', x: 5, y: 2 });
  assert.equal(shot.ok, true);
  assert.equal(ring.state.tick.tension, 96, 'CAT-03: 4 Tension a shot');
  assert.equal(ring.state.floor.enemies[0].statuses.Exposed, 1, 'CAT-01: Exposed 2, ticked at step 7');
});

// ---------------------------------------------------------------------------------------------
// CAT-06 — throwables
// ---------------------------------------------------------------------------------------------

test('ACC-63: a Clatter Can makes noise 10 and points every Active enemy within 10 at it @m05', () => {
  //   T . . . . . X . . s . . h      X is the landing tile; s is Dormant, h is Active.
  const rows = [
    '################',
    '#..............#',
    '#.T........s..h#',
    '#..............#',
    '################',
  ];
  const game = fixtureGame(rows, {
    enemies: { s: { ai: aiWait }, h: { state: 'ACTIVE', ai: aiWait } },
    rng: queueRng([]),
  });
  const [sweeper, hound] = game.state.floor.enemies;
  assert.equal(sweeper.state, 'DORMANT');
  assert.equal(hound.lastKnown, null, 'the Spring-Hound has never seen Tick (perception 9)');

  game.state.tick.inventory.push({ name: 'Clatter Can', count: 1 }); // slot c
  const result = game.act({ type: 'throw', slot: 2, x: 8, y: 2 });

  assert.equal(result.ok, true);
  assert.deepEqual(texts(result), ['Tick throws the Clatter Can.']);
  assert.deepEqual(
    game.state.floor.noises,
    [{ x: 8, y: 2, r: combat.NOISE.THROW }, { x: 8, y: 2, r: items.CLATTER_NOISE }],
    'CMB-08 noise 3 for the landing, then CAT-06 noise 10 for the can',
  );
  assert.equal(sweeper.state, 'ACTIVE', 'ENM-04: noise 10 reaches 3 tiles');
  assert.deepEqual(sweeper.lastKnown, { x: 8, y: 2 });
  assert.deepEqual(hound.lastKnown, { x: 8, y: 2 }, 'CAT-06: Active enemies within 10 head for it');
  assert.equal(hound.lastKnownAge, 0);
  assert.equal(game.state.tick.inventory.length, 2, 'the can left the inventory (CMB-08)');
});

test('CAT-06: the Oil Flask burns a 3x3, the Grit Bomb blinds it, the Tuning Fork stuns one @m05 @unit', () => {
  const rows = ['##########', '#........#', '#.T..s.s.#', '#....s...#', '##########'];
  const enemies = { s: { ai: aiWait } };

  // Oil Flask: radius 1, "Every actor in the 3x3 area gets Burning 3."
  const oil = fixtureGame(rows, { enemies, rng: queueRng([]) });
  oil.state.tick.inventory.push({ name: 'Oil Flask', count: 1 });
  assert.equal(oil.act({ type: 'throw', slot: 2, x: 5, y: 2 }).ok, true);
  const [near, far, below] = oil.state.floor.enemies;
  assert.equal(near.statuses.Burning, 2, 'Burning 3, ticked once at CMB-02 step 7');
  assert.equal(below.statuses.Burning, 2, 'the tile below the landing is inside the 3x3');
  assert.equal(far.statuses.Burning, undefined, 'two tiles away is outside it');
  assert.equal(oil.state.tick.statuses.Burning, undefined, 'and Tick is three tiles away');

  // Grit Bomb: 1 damage ignoring Plating, and Blinded 4.
  const grit = fixtureGame(rows, { enemies, rng: queueRng([]) });
  grit.state.tick.inventory.push({ name: 'Grit Bomb', count: 1 });
  const result = grit.act({ type: 'throw', slot: 2, x: 5, y: 2 });
  assert.deepEqual(texts(result), [
    'Tick throws the Grit Bomb.',
    'The Sweeper takes 1 from the Grit Bomb.',
    'The Sweeper is Blinded.',
    'The Sweeper takes 1 from the Grit Bomb.',
    'The Sweeper is Blinded.',
  ]);
  assert.equal(grit.state.floor.enemies[0].integrity, 6);
  assert.equal(grit.state.floor.enemies[0].statuses.Blinded, 3, 'Blinded 4, ticked once');

  // Tuning Fork: radius 0, "The actor on the landing tile (if any) gets Stunned 2."
  const fork = fixtureGame(rows, { enemies, rng: queueRng([]) });
  fork.state.tick.inventory.push({ name: 'Tuning Fork', count: 1 });
  assert.equal(fork.act({ type: 'throw', slot: 2, x: 5, y: 2 }).ok, true);
  assert.equal(fork.state.floor.enemies[0].statuses.Stunned, 1, 'Stunned 2, ticked once at step 7');
  assert.equal(fork.state.floor.enemies[2].statuses.Stunned, undefined, 'radius 0 touches one tile');
});

// ---------------------------------------------------------------------------------------------
// CAT-05 — attachment specials
// ---------------------------------------------------------------------------------------------

test('ACC-61: the Sounding Plate makes a melee attack noise 2 and opening a door silent @m05', () => {
  //  The two rooms are sealed from each other, so only noise can cross.
  const rows = ['##########', '#..T#....#', '#..s#..s.#', '#...#....#', '##########'];
  const enemies = { s: { ai: aiWait } };

  const quiet = fixtureGame(rows, { enemies, rng: queueRng([d100(100)]) });
  quiet.state.tick.equipment.attachment = 'Sounding Plate';
  const farQuiet = quiet.state.floor.enemies[1];

  quiet.act({ type: 'move', dx: 0, dy: 1 }); // a melee attack on the Sweeper below
  assert.deepEqual(
    quiet.state.floor.noises,
    [{ x: 3, y: 1, r: items.QUIET_MELEE_NOISE }],
    'CAT-05: "Tick\'s plain melee noise is 2 instead of 5"',
  );
  assert.equal(farQuiet.state, 'DORMANT', 'four tiles away, it never heard it');

  // Without the plate the same swing is CMB-11's noise 5 and wakes it.
  const loud = fixtureGame(rows, { enemies, rng: queueRng([d100(100)]) });
  loud.act({ type: 'move', dx: 0, dy: 1 });
  assert.deepEqual(loud.state.floor.noises, [{ x: 3, y: 1, r: combat.NOISE.MELEE }]);
  assert.equal(loud.state.floor.enemies[1].state, 'ACTIVE');

  // "opening a door is silent": ACC-26's map, where only noise can reach the Sweeper.
  const doorRows = ['##########', '#........#', '#T+.#s...#', '#...#....#', '##########'];
  const door = fixtureGame(doorRows, { enemies, rng: queueRng([]) });
  door.state.tick.equipment.attachment = 'Sounding Plate';
  assert.deepEqual(texts(door.act({ type: 'move', dx: 1, dy: 0 })), ['Tick opens the door.']);
  assert.equal(door.state.floor.tiles[2][2], TILE.DOOR_OPEN);
  assert.deepEqual(door.state.floor.noises, [], 'CAT-05: no noise event at all');
  assert.equal(door.state.floor.enemies[0].state, 'DORMANT');
});

test('CAT-05: the Governor derives decayPeriod 6 and the Oil Reservoir refuses Burning @m05 @unit', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;

  assert.equal(derive(tick).decayPeriod, items.BASE_DECAY_PERIOD, 'CHR-04: 5 by default');
  tick.equipment.attachment = 'Governor';
  assert.equal(derive(tick).decayPeriod, items.REGULATED_DECAY_PERIOD, 'CAT-05 REGULATED: 6');
  assert.equal(derive(tick).precision, 1);
  assert.equal(derive(tick).plating, 1);

  // "decayCounter is kept when the Governor is fitted or removed."
  tick.decayCounter = 3;
  tick.equipment.attachment = null;
  assert.equal(tick.decayCounter, 3);
  assert.equal(derive(tick).decayPeriod, items.BASE_DECAY_PERIOD);

  // COOLING: "Tick cannot receive Burning." Nothing else changes.
  assert.equal(combat.applyStatus(game.ctx, tick, 'Burning', 3), true);
  delete tick.statuses.Burning;
  tick.equipment.attachment = 'Oil Reservoir';
  assert.equal(combat.applyStatus(game.ctx, tick, 'Burning', 3), false);
  assert.equal(tick.statuses.Burning, undefined);
  assert.equal(combat.applyStatus(game.ctx, tick, 'Blinded', 3), true, 'and only Burning');
  assert.equal(derive(tick).plating, 1, 'CAT-05: the Oil Reservoir is +1 Plating');
});

// ---------------------------------------------------------------------------------------------
// ITM-10 / ITM-11 — loot
// ---------------------------------------------------------------------------------------------

test('ACC-56: a duplicate equipment roll is re-rolled once; consumables never are @m05 @unit', () => {
  // ITM-10 walks `[name, weight]` pairs in table order, so on a two-entry table of weight 1 a
  // `d2` of 1 is the first entry and 2 is the second.
  const table = [['Mallet', 1], ['Solder', 1]];

  const rerolled = queueRng([die(1, 2), die(2, 2)]);
  assert.equal(
    items.rollTable(rerolled, table, { generated: new Set(['Mallet']) }),
    'Solder',
    'the duplicate Mallet was re-rolled once',
  );
  assert.equal(rerolled.remaining(), 0, 'and it cost exactly two draws');

  // "if the re-roll also duplicates, keep it"
  const twice = queueRng([die(1, 2), die(1, 2)]);
  assert.equal(items.rollTable(twice, table, { generated: new Set(['Mallet']) }), 'Mallet');
  assert.equal(twice.remaining(), 0, 'exactly one re-roll, never two');

  // "Consumables are never re-rolled."
  const consumable = queueRng([die(2, 2)]);
  assert.equal(items.rollTable(consumable, table, { generated: new Set(['Solder']) }), 'Solder');
  assert.equal(consumable.remaining(), 0);

  // A fresh equipment roll is recorded, so the next roll of the same table sees the duplicate.
  const generated = new Set();
  assert.equal(items.rollTable(queueRng([die(1, 2)]), table, { generated }), 'Mallet');
  assert.deepEqual([...generated], ['Mallet']);
});

test('ACC-57: a unique already generated this run is re-rolled until it is not @m05 @unit', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  assert.deepEqual(game.state.uniquesGenerated, []);

  // Placing a floor's items records its uniques in the run state (ITM-10, D-053).
  const floor = floorFromAscii(['#####', '#.T.#', '#####'], {});
  game.loadFixture(floor);
  items.placeFloorItems(game.state.floor, [{ name: 'Governor', count: 1, x: 3, y: 1 }], game.ctx);
  assert.deepEqual(game.state.uniquesGenerated, ['Governor']);

  // A later floor's table can roll it, and must not produce it.
  const table = [['Governor', 1], ['Solder', 1]];
  const rng = queueRng([die(1, 2), die(1, 2), die(2, 2)]);
  assert.equal(items.rollTable(rng, table, { uniques: game.state.uniquesGenerated }), 'Solder');
  assert.equal(rng.remaining(), 0, 'ITM-10 re-rolls *until* it is not a spent unique');

  // The generator is handed the same list on the next floor (WLD-10), so the run is consistent.
  game.loadFixture(floorFromAscii(['#####', '#.T.#', '#####'], { number: 2 }));
  assert.deepEqual(game.state.uniquesGenerated, ['Governor'], 'and it survives the floor change');

  // ITM-11: a boss drop is never lost, so a table with no other entry keeps its roll (D-056).
  const only = queueRng([die(1, 1)]);
  assert.equal(items.rollTable(only, [['Governor', 1]], { uniques: ['Governor'] }), 'Governor');
  assert.equal(only.remaining(), 0);
});

test('ACC-55: a drop lands on the nearest free tile in reading order, or is not created @m05', () => {
  // The Sweeper stands on an item, so ITM-11 searches: (1,1) and (2,1) are wall, so the first
  // free tile at Chebyshev 1 in reading order is (3,1) — ahead of (1,2), which is also at 1.
  const rows = ['##########', '###......#', '#.s......#', '#........#', '#....T...#', '##########'];
  const game = fixtureGame(rows, {
    enemies: { s: { ai: aiWait } },
    rng: queueRng([d100(10), die(1, 3)]), // ITM-11: the d100 drop roll, then the table's own draw
  });
  const sweeper = game.state.floor.enemies[0];
  game.state.floor.items.push({ name: 'Spring-Key', count: 1, x: sweeper.x, y: sweeper.y });

  combat.breakActor(game.ctx, sweeper); // dropChance 15, so a d100 of 10 drops
  assert.deepEqual(
    game.state.floor.items.map((i) => `${i.name}@${i.x},${i.y}`),
    ['Spring-Key@2,2', 'Solder@3,1'],
    'the table is [Solder 2, Spring-Key 1], so a d3 of 1 is Solder',
  );

  // "if none within distance 2, the item is not created"
  const sealed = fixtureGame(['##########', '#s##.T...#', '##########'], {
    enemies: { s: { ai: aiWait } },
    rng: queueRng([d100(10), die(1, 3)]),
  });
  const walled = sealed.state.floor.enemies[0];
  sealed.state.floor.items.push({ name: 'Spring-Key', count: 1, x: walled.x, y: walled.y });
  combat.breakActor(sealed.ctx, walled);
  assert.equal(sealed.state.floor.items.length, 1, 'the drop was rolled and then lost');

  // The d100 is drawn on every break, whatever the outcome (TEC-07).
  const missed = fixtureGame(rows, { enemies: { s: { ai: aiWait } }, rng: queueRng([d100(16)]) });
  combat.breakActor(missed.ctx, missed.state.floor.enemies[0]);
  assert.deepEqual(missed.state.floor.items, [], 'a d100 of 16 is above the Sweeper dropChance 15');
});

test('ITM-11: the drop tile search prefers the tile itself, then distance, then reading order @m05 @unit', () => {
  const game = fixtureGame(['#######', '#.....#', '#..T..#', '#.....#', '#######'], { rng: queueRng([]) });
  const f = game.state.floor;
  assert.deepEqual(items.dropTile(f, 3, 2), { x: 3, y: 2 }, 'a free tile keeps the drop');

  f.items.push({ name: 'Solder', count: 1, x: 3, y: 2 });
  assert.deepEqual(items.dropTile(f, 3, 2), { x: 2, y: 1 }, 'ties at distance 1 go to reading order');

  for (const [x, y] of [[2, 1], [3, 1], [4, 1]]) f.items.push({ name: 'Solder', count: 1, x, y });
  assert.deepEqual(items.dropTile(f, 3, 2), { x: 2, y: 2 }, 'then the next free tile in reading order');

  // Nothing within 2 leaves the caller to discard the item (ITM-11).
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 5; x++) {
      if (!items.itemAt(f, x, y)) f.items.push({ name: 'Solder', count: 1, x, y });
    }
  }
  assert.equal(items.dropTile(f, 3, 2), null);
});
