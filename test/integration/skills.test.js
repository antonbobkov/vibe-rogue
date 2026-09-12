// M07 — skills and progression: XP and level-ups (CHR-06, CHR-07), the discipline lines and their
// prerequisites (CHR-09), the active slots (CHR-10), all twelve skills of `20-skills.md` and the
// interaction notes of SKL-05 — plus the three item ACCs that depend on a skill or on a derived
// value M07 owns (ACC-60, ACC-62, ACC-64).
//
// Every test that needs randomness injects `queueRng` and states each draw in the order TEC-07
// fixes: the `d100` hit roll before the damage dice, several enemies in ascending id, and the
// ITM-11 `d100` drop roll on every break. Expected values are written from the spec (PLN-02 R6).

import test from 'node:test';
import assert from 'node:assert/strict';

import * as skills from '../../src/skills.js';
import * as combat from '../../src/combat.js';
import * as items from '../../src/items.js';
import { derive, levelForXp, XP_THRESHOLDS, MAX_LEVEL, START_INTEGRITY } from '../../src/actors.js';
import { TUNING } from '../../data/tuning.js';
import { queueRng, mulberry32, fnv1a } from '../../src/rng.js';
import { SKILLS, DISCIPLINES } from '../../data/skills.js';
import { fixtureGame, floorFromAscii, d100, die, DROP_ROLL, aiWait, aiAttackAdjacent } from '../fixtures/maps.js';

const texts = (result) => result.log.map((l) => l.text);
const logText = (game) => game.state.log.map((l) => l.text);

/** A plain arena: Tick at (2,2), floor from (1,1) to (10,5). */
const ROOM = [
  '############',
  '#..........#',
  '#.T........#',
  '#..........#',
  '#..........#',
  '############',
];

/**
 * Take skills honestly, one skill point each, in the order given — so the CHR-09 prerequisite rule
 * and the CHR-10 acquisition order are exercised by every test that needs a skill.
 */
function grant(game, ...names) {
  const tick = game.state.tick;
  for (const name of names) {
    tick.skillPoints += 1;
    const result = skills.takeSkill(game.ctx, name);
    assert.equal(result.ok, true, `takeSkill('${name}') should succeed: ${result.reason}`);
  }
  return tick;
}

// ---------------------------------------------------------------------------------------------
// CHR-06 / CHR-07 — experience and level-ups
// ---------------------------------------------------------------------------------------------

test('@m07 @unit CHR-06: the cumulative XP table maps totals to levels 1-9 and caps at 9', () => {
  assert.deepEqual([...XP_THRESHOLDS], [0, 10, 25, 45, 70, 100, 135, 175, 220]);
  assert.equal(MAX_LEVEL, 9);

  const table = [
    [0, 1],
    [9, 1],
    [10, 2],
    [24, 2],
    [25, 3],
    [44, 3],
    [45, 4],
    [69, 4],
    [70, 5],
    [99, 5],
    [100, 6],
    [134, 6],
    [135, 7],
    [174, 7],
    [175, 8],
    [219, 8],
    [220, 9],
    [1000, 9],
  ];
  for (const [xp, level] of table) assert.equal(levelForXp(xp), level, `xp ${xp}`);
});

test('ACC-30: XP 9 plus a 1-XP break is level 2 — +2/+2 Integrity, a skill point and the event @m07', () => {
  // CHR-06: the Rust-moth is worth 1 XP; CHR-07 gives `levelUpIntegrity` max Integrity, as much
  // Integrity, and 1 point (DIF-09 halved it from 4).
  const game = fixtureGame(['############', '#..........#', '#.Tm.......#', '#..........#', '############'], {
    enemies: { m: { ai: aiWait } },
    // d100 hit (chance 80 - 25 evasion = 55), 1d4 = 1 so the Wrench deals 2 to a 2-Integrity moth,
    // then the ITM-11 drop roll every break consumes.
    rng: queueRng([d100(1), die(1, 4), DROP_ROLL]),
  });
  game.state.tick.xp = 9;

  const result = game.act({ type: 'move', dx: 1, dy: 0 });
  const tick = game.state.tick;

  assert.equal(result.ok, true);
  assert.equal(game.state.floor.enemies.length, 0, 'the moth broke');
  assert.equal(tick.xp, 10, 'CHR-06: XP is awarded when the enemy breaks');
  assert.equal(tick.level, 2);
  assert.equal(tick.integrityMax, START_INTEGRITY + TUNING.levelUpIntegrity);
  assert.equal(tick.integrity, START_INTEGRITY + TUNING.levelUpIntegrity);
  assert.equal(tick.skillPoints, 1, "UI-03 shows SP:1 until it is spent");
  assert.ok(texts(result).includes('A new gear catches. Level 2.'));
  assert.deepEqual(
    result.events.filter((e) => e.type === 'levelUp'),
    [{ type: 'levelUp', level: 2 }],
    'CHR-07: the UI opens the Skills screen off this event',
  );
});

test('ACC-31: XP past 220 still counts but the level stays at the cap of 9 @m07', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  tick.level = 8;
  tick.xp = 300;

  game.act({ type: 'wait' });
  assert.equal(tick.level, 9, 'CHR-07 resolves one level per check');
  game.act({ type: 'wait' });
  game.act({ type: 'wait' });
  assert.equal(tick.level, 9, 'CHR-06: level 9 is the cap');
  assert.equal(tick.xp, 300, 'and the XP total is still displayed');
  assert.equal(tick.skillPoints, 1, 'only the one level-up granted a point');
});

// ---------------------------------------------------------------------------------------------
// CHR-09 / CHR-10 — disciplines, prerequisites and slots
// ---------------------------------------------------------------------------------------------

test('@m07 @unit CHR-09: rank n needs rank n-1 of the same discipline, and each take costs a point', () => {
  // Shape first: three disciplines of four ranks, two actives and two passives each.
  for (const discipline of DISCIPLINES) {
    const line = skills.lineOf(discipline);
    assert.deepEqual(
      line.map((s) => s.rank),
      [1, 2, 3, 4],
      discipline,
    );
    assert.equal(line.filter((s) => s.type === 'A').length, 2, `${discipline}: two actives`);
    assert.equal(line.filter((s) => s.type === 'P').length, 2, `${discipline}: two passives`);
  }

  // Every rank-1 skill has no prerequisite; every other names the rank below it.
  for (const def of SKILLS) {
    const expected = def.rank === 1 ? null : skills.lineOf(def.discipline).find((s) => s.rank === def.rank - 1).name;
    assert.equal(skills.prerequisiteOf(def.name), expected, def.name);
  }

  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;

  assert.deepEqual(skills.canTake(tick, 'Braced Frame'), { ok: false, reason: 'noSkillPoints' });
  tick.skillPoints = 2;
  assert.deepEqual(skills.canTake(tick, 'Flywheel Guard'), { ok: false, reason: 'locked' });
  assert.deepEqual(skills.canTake(tick, 'Not A Skill'), { ok: false, reason: 'noSuchSkill' });

  assert.deepEqual(skills.takeSkill(game.ctx, 'Braced Frame'), { ok: true });
  assert.equal(tick.skillPoints, 1, 'CHR-09: exactly one point per skill');
  assert.deepEqual(skills.takeSkill(game.ctx, 'Braced Frame'), { ok: false, reason: 'alreadyTaken' });
  assert.deepEqual(skills.canTake(tick, 'Overwind Strike'), { ok: true }, 'rank 2 unlocked by rank 1');
  assert.deepEqual(skills.canTake(tick, 'Salvage'), { ok: true }, 'CHR-09: disciplines are independent');
});

test('ACC-32: with no Armature skills Overwind Strike is locked and Braced Frame is available @m07', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  tick.skillPoints = 1;

  assert.equal(skills.locked(tick, 'Overwind Strike'), true);
  assert.equal(skills.available(tick, 'Overwind Strike'), false);
  assert.equal(skills.available(tick, 'Braced Frame'), true);

  const refused = game.act({ type: 'takeSkill', name: 'Overwind Strike' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'locked');
  assert.deepEqual(tick.skills, []);
  assert.equal(tick.skillPoints, 1, 'a refused take spends nothing');

  const taken = game.act({ type: 'takeSkill', name: 'Braced Frame' });
  assert.equal(taken.ok, true);
  assert.deepEqual(tick.skills, ['Braced Frame']);
  assert.equal(game.state.turn, 0, 'CHR-07/CHR-09: taking a skill is a free action (D-064)');
  assert.equal(skills.locked(tick, 'Overwind Strike'), false, 'now unlocked, but there is no point left');
  assert.deepEqual(skills.canTake(tick, 'Overwind Strike'), { ok: false, reason: 'noSkillPoints' });
});

test('ACC-33: Braced Frame gives +1 Plating and +6 max Integrity and Integrity at once @m07', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  assert.equal(derive(tick).plating, 0);

  grant(game, 'Braced Frame');

  assert.equal(derive(tick).plating, 1);
  assert.equal(tick.integrityMax, 46);
  assert.equal(tick.integrity, 46);
});

test('ACC-45: four actives acquired T3, A2, R2, A3 map to hotkeys 1-4 in that order @m07', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  // CHR-09's prerequisites force the ranks below each of the four to be taken first: eight points.
  const tick = grant(
    game,
    'Salvage',
    'Efficient Springs',
    'Field Repair', // Tinkering 3 — the first active taken
    'Braced Frame',
    'Overwind Strike', // Armature 2
    'Tuning',
    'Resonant Pulse', // Resonance 2
    'Flywheel Guard', // Armature 3
  );

  assert.equal(tick.skills.length, 8);
  assert.deepEqual(tick.activeSlots, ['Field Repair', 'Overwind Strike', 'Resonant Pulse', 'Flywheel Guard']);
  assert.equal(skills.skillInSlot(tick, 1), 'Field Repair');
  assert.equal(skills.skillInSlot(tick, 2), 'Overwind Strike');
  assert.equal(skills.skillInSlot(tick, 3), 'Resonant Pulse');
  assert.equal(skills.skillInSlot(tick, 4), 'Flywheel Guard');
  assert.equal(skills.skillInSlot(tick, 5), null, 'CHR-10: four slots always suffice');
});

test('@m07 @unit UI-03/UI-06: the four skill rows carry the cost and the once-per-floor (used) flag', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = grant(game, 'Salvage', 'Efficient Springs', 'Field Repair', 'Braced Frame', 'Overwind Strike');

  assert.deepEqual(skills.activeSlotRows(tick), [
    { slot: 1, name: 'Field Repair', cost: 12, oncePerFloor: true, used: false },
    { slot: 2, name: 'Overwind Strike', cost: 8, oncePerFloor: false, used: false },
  ]);

  assert.equal(game.act({ type: 'skill', slot: 1 }).ok, true);
  assert.equal(tick.fieldRepairUsed, true);
  assert.equal(skills.oncePerFloorUsed(tick, 'Field Repair'), true);
  assert.equal(skills.activeSlotRows(tick)[0].used, true, 'UI-06 shows `(used)` until Ascend');
  assert.equal(skills.oncePerFloorUsed(tick, 'Overwind Strike'), false);
});

// ---------------------------------------------------------------------------------------------
// SKL-02 Armature
// ---------------------------------------------------------------------------------------------

test('ACC-34: Overwind Strike doubles the Wrench dice for 9, makes noise 6 and costs 8 Tension @m07', () => {
  const rows = ['############', '#..........#', '#.Ts.......#', '#..........#', '############'];
  const game = fixtureGame(rows, {
    // A Sweeper with 20 Integrity survives the hit, so the damage is readable from the log.
    enemies: { s: { integrity: 20, ai: aiWait } },
    // Hit roll 95 (accuracy 80 + 25 - evasion 5 = 100, clamped to 95), then the two d4 rolls of 4.
    rng: queueRng([d100(95), die(4, 4), die(4, 4)]),
  });
  const tick = grant(game, 'Braced Frame', 'Overwind Strike');

  const result = game.act({ type: 'skill', slot: 1, dx: 1, dy: 0 });
  assert.equal(result.ok, true);
  assert.deepEqual(texts(result), ['Overwind Strike.', 'Tick hits the Sweeper for 9.']);
  assert.equal(game.state.floor.enemies[0].integrity, 11, 'SKL-02: 4 + 4 + 1, the modifier added once');
  assert.equal(tick.tension, 92, 'CHR-04: 8 Tension, paid before the effect');
  assert.deepEqual(game.state.floor.noises[0], { x: 2, y: 2, r: 6 }, 'noise 6 instead of 5');

  // The same roll without the skill's +25 accuracy is a miss (chance 80 - 5 = 75), which is what
  // makes the hit above evidence of the bonus.
  const plain = fixtureGame(rows, {
    enemies: { s: { integrity: 20, ai: aiWait } },
    rng: queueRng([d100(95)]),
  });
  assert.deepEqual(texts(plain.act({ type: 'move', dx: 1, dy: 0 })), ['Tick misses the Sweeper.']);

  // A direction with no enemy in it is refused without spending a turn or Tension (SKL-01).
  const refused = game.act({ type: 'skill', slot: 1, dx: 0, dy: -1 });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'noTarget');
  assert.equal(tick.tension, 92);
});

test('@m07 @unit SKL-05: an Overwind Strike carries the weapon special and its doubled roll Pistons', () => {
  const game = fixtureGame(['############', '#..........#', '#.Ts.......#', '#..........#', '############'], {
    enemies: { s: { integrity: 20, ai: aiWait } },
    // Cog Saw 1d4+1 at accuracy 80 + 5 + 25, so 95 after the clamp; then two d4 rolls of 2.
    rng: queueRng([d100(1), die(2, 4), die(2, 4)]),
  });
  const tick = grant(game, 'Braced Frame', 'Overwind Strike', 'Flywheel Guard', 'Piston Drive');
  tick.equipment.weapon = 'Cog Saw';

  // Driven through `skills.js` so the two 1-turn statuses are read before CMB-10's step-7 tick.
  assert.deepEqual(skills.useSkill(game.ctx, { slot: 1, dx: 1, dy: 0 }), { ok: true });
  const enemy = game.state.floor.enemies[0];

  assert.ok(logText(game).includes('Tick hits the Sweeper for 7.'), '2 + 2 + 1 + Force 2');
  assert.equal(enemy.statuses.Exposed, 2, 'SKL-05: Rend triggers as on any hit');
  assert.equal(enemy.statuses.Stunned, 1, 'SKL-05: the doubled roll counts toward the >= 6 threshold');
  assert.equal(enemy.x, 4, 'and the knockback with it');
  assert.equal(tick.tension, 92);

  // One d4 of 2 would be 2 + 1 + 2 = 5, below the threshold — the doubling is what carries it over.
  assert.equal(derive(tick).attack.n, 1, 'the weapon itself still rolls one die');
});

test('ACC-35: with Flywheel Guard up the Pendulum Sweep deals its 6 and cannot Stun @m07', () => {
  // WLD-08: the sweep is active when `turn % 8 === 0` and its 6 damage ignores Plating, so the
  // Guard's +3 does not reduce it — only its Stun immunity shows (SKL-05).
  const rows = ['############', '#..........#', '#.T.~......#', '#..........#', '############'];

  const game = fixtureGame(rows, { rng: queueRng([]) });
  const tick = grant(game, 'Braced Frame', 'Overwind Strike', 'Flywheel Guard');

  assert.equal(game.act({ type: 'skill', slot: 2 }).ok, true); // Flywheel Guard is the second active
  assert.equal(tick.tension, 90);
  assert.equal(tick.guardTimer, 4, 'SKL-02: four turns of guard after this turn (D-066)');
  assert.equal(derive(tick).plating, 4, '+1 Braced Frame, +3 while the flywheel runs');

  game.act({ type: 'move', dx: 1, dy: 0 }); // step to (3,2), next to the band
  game.state.turn = 7; // the next action lands on turn 8 — an active sweep

  const result = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(result.ok, true);
  assert.ok(texts(result).includes('Tick is caught in the Pendulum Sweep for 6.'));
  assert.equal(tick.integrity, 40, "6 damage off Braced Frame's 46, ignoring Plating");
  assert.equal(tick.statuses.Stunned, undefined, 'SKL-02: Tick cannot be Stunned while the guard is up');
  assert.ok(
    !texts(result).includes('Tick is Stunned.'),
    'SKL-05: hazards cannot Stun Tick while the Flywheel Guard is active',
  );
  assert.ok(tick.guardTimer > 0);

  // Without the Guard the same step applies the Stun, which is what the immunity above prevents.
  const bare = fixtureGame(rows, { rng: queueRng([]) });
  bare.act({ type: 'move', dx: 1, dy: 0 });
  bare.state.turn = 7;
  const stung = bare.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(bare.state.tick.integrity, 34);
  assert.ok(texts(stung).includes('Tick is Stunned.'));
});

test('ACC-36: a Piston Drive melee hit of exactly 6 knocks back and Stuns 1, capped on a boss @m07', () => {
  const rows = ['############', '#..........#', '#.Ts.......#', '#..........#', '############'];
  const armature = ['Braced Frame', 'Overwind Strike', 'Flywheel Guard', 'Piston Drive'];

  // Force 2 + Wrench 1d4+1 with a roll of 3 is exactly 6 against Plating 0. The attack is driven
  // through `combat.js` so the Stun is read before CMB-10's step-7 decrement takes it away again.
  const game = fixtureGame(rows, {
    enemies: { s: { integrity: 20, ai: aiWait } },
    rng: queueRng([d100(1), die(3, 4)]),
  });
  const tick = grant(game, ...armature);
  assert.equal(derive(tick).force, 2);

  const enemy = game.state.floor.enemies[0];
  const hit = combat.meleeAttack(game.ctx, tick, enemy);
  assert.equal(hit.dealt, 6);
  assert.ok(logText(game).includes('Tick hits the Sweeper for 6.'));
  assert.equal(enemy.x, 4, 'CMB-09: pushed one tile directly away');
  assert.equal(enemy.y, 2);
  assert.equal(enemy.statuses.Stunned, 1);
  assert.equal(enemy.integrity, 14);

  // Through the turn loop the Stun costs the enemy exactly one enemy phase and is then gone
  // (CMB-10's counting rule), which is the observable effect of applying it in step 1.
  const looped = fixtureGame(rows, {
    enemies: { s: { integrity: 20, ai: aiAttackAdjacent } },
    rng: queueRng([d100(1), die(3, 4)]),
  });
  grant(looped, ...armature);
  const stunned = looped.state.floor.enemies[0];
  looped.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(stunned.x, 4, 'knocked out of reach');
  assert.equal(stunned.statuses.Stunned, undefined, 'the 1-turn Stun expired at step 7');
  assert.equal(stunned.energy, 0, 'CMB-10: its energy was set to 0 instead of granted');
  assert.equal(looped.state.tick.integrity, 46, 'so it never swung back');

  // Five is below the threshold: no push, no Stun.
  const under = fixtureGame(rows, {
    enemies: { s: { integrity: 20, ai: aiWait } },
    rng: queueRng([d100(1), die(2, 4)]),
  });
  const underTick = grant(under, ...armature);
  const spared = under.state.floor.enemies[0];
  assert.equal(combat.meleeAttack(under.ctx, underTick, spared).dealt, 5);
  assert.equal(spared.x, 3, 'a 5-damage hit does not reach the >= 6 trigger');
  assert.equal(spared.statuses.Stunned, undefined);

  // BST-03 caps a boss's Stun at 1, which is what Piston Drive applies anyway.
  const boss = fixtureGame(rows, {
    enemies: { s: { integrity: 20, isBoss: true, ai: aiWait } },
    rng: queueRng([d100(1), die(3, 4)]),
  });
  const bossTick = grant(boss, ...armature);
  const target = boss.state.floor.enemies[0];
  combat.meleeAttack(boss.ctx, bossTick, target);
  assert.equal(target.statuses.Stunned, 1, 'BST-03: cap 1');
});

// ---------------------------------------------------------------------------------------------
// SKL-03 Tinkering
// ---------------------------------------------------------------------------------------------

test('ACC-37: Salvage drops a Grit Bomb on the 4th break and an Oil Flask on the 8th @m07', () => {
  // The counter increments on *any* break, so the breaks are driven straight through CMB-12's
  // `breakActor`; each one still consumes the ITM-11 drop roll (a Rust-moth's 5% never lands on 100).
  const rows = ['############', '#.mmmm.....#', '#.T........#', '#.mmmm.....#', '############'];
  const game = fixtureGame(rows, {
    enemies: { m: { ai: aiWait } },
    rng: queueRng(new Array(8).fill(DROP_ROLL)),
  });
  const tick = grant(game, 'Salvage');
  const moths = game.state.floor.enemies.slice();
  assert.equal(moths.length, 8);

  const counters = [];
  for (const moth of moths) {
    moth.integrity = 0;
    combat.breakActor(game.ctx, moth);
    counters.push(tick.salvageCounter);
  }

  assert.deepEqual(counters, [1, 2, 3, 0, 1, 2, 3, 0], 'SKL-03: the counter shows n/4 and resets at 4');
  // DIF-04: the cycle is the four throwables, in CAT-06's order, and never a Solder or a
  // Spring-Key — those are the two the plan took out of every drop table.
  assert.deepEqual(
    game.state.floor.items,
    [
      { name: 'Grit Bomb', count: 1, x: moths[3].x, y: moths[3].y },
      { name: 'Oil Flask', count: 1, x: moths[7].x, y: moths[7].y },
    ],
    'the throwable cycle, on the breaking enemy tile (ITM-11 placement)',
  );
  assert.equal(tick.salvageNext, 'Tuning Fork', 'the cycle moves on');
  const lines = logText(game).filter((t) => t.startsWith('Something worth keeping'));
  assert.deepEqual(lines, ['Something worth keeping: Grit Bomb.', 'Something worth keeping: Oil Flask.']);
});

test('@m07 @unit SKL-03: the Salvage counter survives the floor change Ascend performs', () => {
  const game = fixtureGame(['############', '#.mm.......#', '#.T........#', '############'], {
    enemies: { m: { ai: aiWait } },
    rng: queueRng(new Array(4).fill(DROP_ROLL)),
  });
  const tick = grant(game, 'Salvage', 'Efficient Springs', 'Field Repair');
  tick.integrity = 20;
  assert.equal(game.act({ type: 'skill', slot: 1 }).ok, true);
  assert.equal(tick.fieldRepairUsed, true);

  for (const moth of game.state.floor.enemies.slice()) {
    moth.integrity = 0;
    combat.breakActor(game.ctx, moth);
  }
  assert.equal(tick.salvageCounter, 2);

  // CMB-05 Ascend enters the next floor through the same path `engine.enterFloor` runs.
  game.loadFixture(floorFromAscii(['############', '#.mm.......#', '#.T........#', '############'], {
    number: 2,
    enemies: { m: { ai: aiWait } },
  }));
  assert.equal(tick.salvageCounter, 2, 'SKL-03: "Counter persists across floors"');
  assert.equal(tick.salvageNext, 'Grit Bomb');
  assert.equal(tick.fieldRepairUsed, false, 'SKL-03: the once-per-floor flag resets');
  assert.equal(tick.guardTimer, 0, 'CMB-05: the Flywheel Guard timer is cleared');

  for (const moth of game.state.floor.enemies.slice()) {
    moth.integrity = 0;
    combat.breakActor(game.ctx, moth);
  }
  assert.equal(tick.salvageCounter, 0, 'the 4th break of the run, two floors apart');
  assert.equal(game.state.floor.items.length, 1);
  assert.equal(game.state.floor.items[0].name, 'Grit Bomb');
});

test('ACC-38: Efficient Springs adds its bonus to the Spring-Key and to the Solder repair @m07', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = grant(game, 'Salvage', 'Efficient Springs');
  tick.tension = 50;
  tick.integrity = 10;
  tick.inventory = [
    { name: 'Spring-Key', count: 1 },
    { name: 'Solder', count: 1 },
  ];

  const keyTotal = TUNING.springKeyAmount + TUNING.efficientKeyBonus;
  const key = game.act({ type: 'use', slot: 0 });
  assert.equal(key.ok, true);
  assert.equal(tick.tension, 50 + keyTotal, `CAT-06: ${keyTotal} instead of ${TUNING.springKeyAmount}`);
  assert.ok(texts(key).includes(`Tick fits the Spring-Key. Tension ${50 + keyTotal}.`));

  // DIF-03: the Solder is a repair, so the bonus lands over `solderTurns` turns — the even share
  // first and whatever the split leaves over on the last one.
  const solderTotal = TUNING.solderAmount + TUNING.efficientSolderBonus;
  const solder = game.act({ type: 'use', slot: 0 });
  assert.equal(solder.ok, true);
  assert.deepEqual(tick.inventory, []);
  for (let i = 1; i < TUNING.solderTurns; i++) game.act({ type: 'wait' });
  assert.equal(tick.repair, null, 'the repair ran to its end');
  // CHR-02 clamps at Integrity max, so the bonus is checked on the repair's own book-keeping as
  // well as on what actually landed.
  assert.equal(
    tick.integrity,
    Math.min(tick.integrityMax, 10 + solderTotal),
    `CAT-06: ${solderTotal} instead of ${TUNING.solderAmount}`,
  );
  assert.equal(
    solderTotal,
    TUNING.solderAmount + TUNING.efficientSolderBonus,
    'SKL-03: Efficient Springs adds its bonus to the repair total',
  );
});

test('ACC-39: Field Repair mends 12 once a floor and is refused until the next Ascend @m07', () => {
  const rows = ['############', '#.<........#', '#.T........#', '#..........#', '############'];
  // The Ascend generates floor 2, so this run uses a seeded PRNG rather than a scripted queue (R6).
  const game = fixtureGame(rows, { seedString: 'ACC39', rng: mulberry32(fnv1a('ACC39:play')) });
  const tick = grant(game, 'Salvage', 'Efficient Springs', 'Field Repair');
  tick.integrity = 20;

  const first = game.act({ type: 'skill', slot: 1 });
  assert.equal(first.ok, true);
  assert.equal(tick.integrity, 32, 'SKL-03: +12, clamped to integrityMax');
  assert.equal(tick.tension, 88);
  assert.ok(texts(first).includes('Tick mends the frame. Integrity 32.'));

  const again = game.act({ type: 'skill', slot: 1 });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'spentThisFloor');
  assert.deepEqual(texts(again), ['Field Repair is spent until the next floor.']);
  assert.equal(tick.tension, 88, 'a refusal costs no Tension');
  assert.equal(game.state.turn, 1, 'and no turn (CMB-05)');

  game.act({ type: 'move', dx: 0, dy: -1 }); // onto the up-stairs
  assert.equal(game.act({ type: 'ascend' }).ok, true);
  assert.equal(game.state.floorNumber, 2);
  assert.equal(tick.fieldRepairUsed, false, 'SKL-03: "resets on Ascend"');

  const onFloorTwo = game.act({ type: 'skill', slot: 1 });
  assert.equal(onFloorTwo.ok, true);
  assert.equal(tick.fieldRepairUsed, true);
});

test('@m07 @unit SKL-03: the Decoy is a 12-Integrity status-immune actor, and only one exists', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = grant(game, 'Salvage', 'Efficient Springs', 'Field Repair', 'Clockwork Decoy');

  assert.equal(game.act({ type: 'skill', slot: 2, x: 3, y: 2 }).ok, true);
  const first = game.state.floor.decoy;
  assert.equal(tick.tension, 85);
  assert.deepEqual(
    { x: first.x, y: first.y, integrity: first.integrity, integrityMax: first.integrityMax, timer: first.timer },
    { x: 3, y: 2, integrity: 12, integrityMax: 12, timer: 5 },
  );
  assert.equal(combat.actorAt(game.state, 3, 2), first, 'the Decoy occupies its tile');
  for (const status of ['Stunned', 'Slowed', 'Burning', 'Blinded', 'Exposed']) {
    assert.equal(combat.applyStatus(game.ctx, first, status, 3), false, `immune to ${status}`);
  }
  assert.deepEqual(first.statuses, {});

  // "Only one Decoy exists at a time; placing a new one removes the old."
  assert.equal(game.act({ type: 'skill', slot: 2, x: 2, y: 3 }).ok, true);
  const second = game.state.floor.decoy;
  assert.notEqual(second, first);
  assert.deepEqual({ x: second.x, y: second.y, timer: second.timer }, { x: 2, y: 3, timer: 5 });
  assert.equal(combat.actorAt(game.state, 3, 2), null, 'the old tile is free again');
  assert.equal(tick.tension, 70);

  // CMB-05: a Move into the Decoy's tile is refused, and costs no turn.
  const bump = game.act({ type: 'move', dx: 0, dy: 1 });
  assert.equal(bump.ok, false);
  assert.equal(game.state.tick.y, 2);

  // Targeting: only an adjacent, walkable, unoccupied tile (SKL-01 `adjacent-free`).
  assert.equal(game.act({ type: 'skill', slot: 2, x: 6, y: 2 }).reason, 'notAdjacent');

  const corner = fixtureGame(['####', '#T.#', '#..#', '####'], { rng: queueRng([]) });
  grant(corner, 'Salvage', 'Efficient Springs', 'Field Repair', 'Clockwork Decoy');
  assert.equal(corner.act({ type: 'skill', slot: 2, x: 0, y: 0 }).reason, 'blocked', 'not a wall');
  assert.equal(corner.state.floor.decoy, null);
  assert.equal(corner.state.tick.tension, 100, 'and nothing was paid');
});

test('ACC-40: enemies within 8 target the Decoy, which goes at 0 Integrity or after 6 turns @m07', () => {
  // The Sweeper at (4,2) is adjacent to the Decoy at (3,2) but two tiles from Tick, so SKL-03's own
  // exception ("enemies that see Tick adjacent to themselves still attack Tick") does not apply.
  const arena = ['##############', '#............#', '#.T.s........#', '#............#', '##############'];
  const line = ['Salvage', 'Efficient Springs', 'Field Repair', 'Clockwork Decoy'];
  const distance = (a, x, y) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y));

  const game = fixtureGame(arena, {
    enemies: { s: { state: 'ACTIVE' } },
    // The Sweeper's d100 (accuracy 65 - the Decoy's evasion 0) and its 1d3, twice over.
    rng: queueRng([d100(1), die(3, 3), d100(1), die(1, 3)]),
  });
  grant(game, ...line);

  const placed = game.act({ type: 'skill', slot: 2, x: 3, y: 2 });
  assert.equal(placed.ok, true);
  assert.ok(texts(placed).includes('The decoy rattles.'));

  const decoy = game.state.floor.decoy;
  const near = game.state.floor.enemies[0];
  assert.equal(near.decoyed, true);
  assert.deepEqual(near.lastKnown, { x: 3, y: 2 }, "lastKnown is set to the Decoy's tile");
  assert.equal(decoy.integrity, 9, 'it attacked the Decoy, not Tick');
  assert.equal(game.state.tick.integrity, 40);
  assert.equal(near.x, 4, 'and stayed where it was to swing');
  assert.ok(texts(placed).includes('The Sweeper hits decoy for 3.'));

  // At 0 Integrity it is removed at once: no scrap, no XP, no noise.
  decoy.integrity = 1;
  const broken = game.act({ type: 'wait' });
  assert.equal(game.state.floor.decoy, null);
  assert.ok(texts(broken).includes('The decoy is broken.'));
  assert.equal(game.state.floor.scrap.length, 0);
  assert.equal(game.state.tick.xp, 0);
  assert.equal(game.state.stats.enemiesBroken, 0);
  assert.equal(near.decoyed, false);
  assert.ok(!texts(broken).some((t) => t.includes('breaks.')));

  // Enemies that are not adjacent to it path toward it instead of toward Tick.
  const walkers = fixtureGame(
    [
      '##############',
      '#............#',
      '#.T.....s....#',
      '#............#',
      '#............#',
      '#.......s....#',
      '#............#',
      '##############',
    ],
    { enemies: { s: { state: 'ACTIVE' } }, rng: queueRng([]) },
  );
  grant(walkers, ...line);
  assert.equal(walkers.act({ type: 'skill', slot: 2, x: 3, y: 2 }).ok, true);
  for (const enemy of walkers.state.floor.enemies) {
    assert.equal(enemy.decoyed, true, 'every Active enemy within Chebyshev 8 of the Decoy');
    assert.deepEqual(enemy.lastKnown, { x: 3, y: 2 });
    assert.equal(distance(enemy, 3, 2), 4, 'each stepped one tile closer to the Decoy');
  }
  assert.equal(walkers.state.tick.integrity, 40);

  // "After 6 turns … the Decoy is removed": its own turn plus the five following it (D-067).
  const quiet = fixtureGame(ROOM, { rng: queueRng([]) });
  grant(quiet, ...line);
  assert.equal(quiet.act({ type: 'skill', slot: 2, x: 3, y: 2 }).ok, true);
  for (let i = 0; i < 5; i++) {
    quiet.act({ type: 'wait' });
    assert.ok(quiet.state.floor.decoy, `still there after wait ${i + 1}`);
  }
  const gone = quiet.act({ type: 'wait' });
  assert.equal(quiet.state.floor.decoy, null, 'gone on the sixth turn after placement');
  assert.deepEqual(texts(gone), ['The decoy runs down.']);
});

// ---------------------------------------------------------------------------------------------
// SKL-04 Resonance
// ---------------------------------------------------------------------------------------------

test('ACC-41: Tuning makes the Spring-Bolt Launcher cost 2 with a base accuracy of 90 @m07', () => {
  const rows = ['############', '#..........#', '#.T..s.....#', '#..........#', '############'];
  const game = fixtureGame(rows, {
    enemies: { s: { ai: aiWait } },
    // 90 base - 5 evasion = 85, so a roll of 85 hits; then the launcher's 1d6.
    rng: queueRng([d100(85), die(6, 6)]),
  });
  const tick = game.state.tick;
  tick.equipment.weapon = 'Spring-Bolt Launcher';

  const before = derive(tick);
  assert.equal(before.rangedAccuracy, 80, 'CMB-01: 80 with no Precision and no weapon modifier');
  assert.equal(before.ranged.tensionCost, 3);

  grant(game, 'Tuning');
  const after = derive(tick);
  assert.equal(after.precision, 1);
  assert.equal(after.rangedAccuracy, 90, 'SKL-04: 80 + 5 x Precision + 5');
  assert.equal(after.ranged.tensionCost, 2, 'one less Tension, minimum 1');

  const shot = game.act({ type: 'fire', x: 5, y: 2 });
  assert.equal(shot.ok, true);
  assert.equal(tick.tension, 98, 'the reduced cost is what is paid');
  assert.ok(texts(shot).includes('Tick shoots the Sweeper for 6.'));
});

test('ACC-42: Resonant Pulse hits distance 1 and 2 ignoring Plating and pushes them, not 3 @m07', () => {
  // Stokers have Plating 1, so a `1d4+2` roll of 1 dealing 3 proves the Plating is ignored.
  const rows = [
    '############',
    '#..........#',
    '#..........#',
    '#..Tk......#',
    '#..........#',
    '#..k.......#',
    '#.....k....#',
    '############',
  ];
  const game = fixtureGame(rows, {
    enemies: { k: { ai: aiWait } },
    rng: queueRng([die(1, 4), die(4, 4)]), // one 1d4 per enemy, in id order
  });
  const tick = grant(game, 'Tuning', 'Resonant Pulse');

  const result = game.act({ type: 'skill', slot: 1 });
  const [one, two, three] = game.state.floor.enemies;
  assert.equal(result.ok, true);
  assert.equal(tick.tension, 92);
  assert.deepEqual(game.state.floor.noises[0], { x: 3, y: 3, r: 8 }, 'noise 8');

  assert.equal(one.integrity, 15, '1 + 2 damage, ignoring Plating 1');
  assert.equal(two.integrity, 12, '4 + 2 damage');
  assert.equal(three.integrity, 18, 'Chebyshev 3 is outside the pulse');
  assert.deepEqual({ x: one.x, y: one.y }, { x: 5, y: 3 }, 'CMB-09: pushed away from Tick');
  assert.deepEqual({ x: two.x, y: two.y }, { x: 3, y: 6 });
  assert.deepEqual({ x: three.x, y: three.y }, { x: 6, y: 6 }, 'untouched');
  assert.deepEqual(texts(result).slice(0, 3), [
    'Resonant Pulse.',
    'The Stoker takes 3 from the Resonant Pulse.',
    'The Stoker is knocked back.',
  ]);
});

test('ACC-43: Discord applies Exposed 4 and Slowed 4, capped at 2 each on a boss @m07', () => {
  const rows = ['############', '#..........#', '#.T..s.....#', '#..........#', '############'];
  const line = ['Tuning', 'Resonant Pulse', 'Discord'];

  // The caps are read before CMB-10's step-7 decrement, so the skill is driven directly here.
  const boss = fixtureGame(rows, { enemies: { s: { isBoss: true, ai: aiWait } }, rng: queueRng([]) });
  grant(boss, ...line);
  const target = boss.state.floor.enemies[0];
  assert.deepEqual(skills.useSkill(boss.ctx, { slot: 2, x: 5, y: 2 }, boss.view().visible), { ok: true });
  assert.deepEqual(target.statuses, { Exposed: 2, Slowed: 2 }, 'BST-03: cap 2 each');
  assert.equal(boss.state.tick.tension, 90);

  const plain = fixtureGame(rows, { enemies: { s: { ai: aiWait } }, rng: queueRng([]) });
  grant(plain, ...line);
  const sweeper = plain.state.floor.enemies[0];
  assert.deepEqual(skills.useSkill(plain.ctx, { slot: 2, x: 5, y: 2 }, plain.view().visible), { ok: true });
  assert.deepEqual(sweeper.statuses, { Exposed: 4, Slowed: 4 }, 'SKL-04: 4 each on anything else');

  // SKL-05: "Discord on the Understudy: Slowed never applies (it is immune); Exposed applies with
  // the boss cap of 2."
  const understudy = fixtureGame(['############', '#..........#', '#.T..U.....#', '#..........#', '############'], {
    enemies: { U: { ai: aiWait } },
    rng: queueRng([]),
  });
  grant(understudy, ...line);
  const silver = understudy.state.floor.enemies[0];
  assert.deepEqual(skills.useSkill(understudy.ctx, { slot: 2, x: 5, y: 2 }, understudy.view().visible), { ok: true });
  assert.deepEqual(silver.statuses, { Exposed: 2 });

  // End to end, through the turn loop: one decrement at step 7 (CMB-10), and the targeting rules.
  const full = fixtureGame(rows, { enemies: { s: { ai: aiWait } }, rng: queueRng([]) });
  grant(full, ...line);
  const acted = full.act({ type: 'skill', slot: 2, x: 5, y: 2 });
  assert.equal(acted.ok, true);
  assert.deepEqual(full.state.floor.enemies[0].statuses, { Exposed: 3, Slowed: 3 });
  assert.deepEqual(full.state.floor.noises, [], 'noise 0');
  assert.equal(full.act({ type: 'skill', slot: 2, x: 5, y: 3 }).reason, 'noTarget');
  assert.equal(full.act({ type: 'skill', slot: 2, x: 5, y: 9 }).reason, 'outOfRange');
});

test('ACC-44: Sympathetic Break chains three enemies in one action, with XP and Salvage for all @m07', () => {
  // Three Sweepers in a line at distance 1 each; the first has 1 Integrity, the others 4.
  const rows = ['############', '#..........#', '#.T123.....#', '#..........#', '############'];
  const game = fixtureGame(rows, {
    enemies: {
      1: { type: 'Sweeper', integrity: 1, ai: aiWait },
      2: { type: 'Sweeper', integrity: 4, ai: aiWait },
      3: { type: 'Sweeper', integrity: 4, ai: aiWait },
    },
    // The hit roll and its 1d4, then the ITM-11 drop roll of each of the three breaks.
    rng: queueRng([d100(1), die(1, 4), DROP_ROLL, DROP_ROLL, DROP_ROLL]),
  });
  const tick = grant(game, 'Salvage', 'Tuning', 'Resonant Pulse', 'Discord', 'Sympathetic Break');

  const result = game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(result.ok, true);
  assert.equal(game.state.floor.enemies.length, 0, 'all three break in one action');
  assert.equal(game.state.stats.enemiesBroken, 3);
  assert.equal(tick.xp, 9, 'CHR-06: 3 XP a Sweeper, for all three');
  assert.equal(tick.salvageCounter, 3, 'SKL-05: Salvage counts chained breaks');
  assert.equal(game.state.floor.scrap.length, 3);
  assert.equal(tick.level, 1, '9 XP is one short of level 2');

  assert.deepEqual(texts(result), [
    'Tick hits the Sweeper for 2.',
    'The Sweeper breaks.',
    'The break carries.',
    'The Sweeper takes 4 from the Sympathetic Break.',
    'The Sweeper breaks.',
    'The break carries.',
    'The Sweeper takes 4 from the Sympathetic Break.',
    'The Sweeper breaks.',
  ]);
});

// ---------------------------------------------------------------------------------------------
// The item ACCs that wait on a skill or on a derived value (M05's remainder)
// ---------------------------------------------------------------------------------------------

test('ACC-60: the Oil Reservoir stops a Stoker and a Steam Vent from setting Tick alight @m07', () => {
  const stoker = fixtureGame(['############', '#..........#', '#.Tk.......#', '#..........#', '############'], {
    enemies: { k: { state: 'ACTIVE', ai: aiAttackAdjacent } },
    // The Stoker's d100 (accuracy 75 - evasion 10) and its 1d6.
    rng: queueRng([d100(1), die(6, 6)]),
  });
  stoker.state.tick.equipment.attachment = 'Oil Reservoir';

  const hit = stoker.act({ type: 'wait' });
  assert.ok(texts(hit).some((t) => t.startsWith('The Stoker hits Tick')));
  assert.equal(stoker.state.tick.statuses.Burning, undefined, 'CAT-05 Cooling: Tick cannot receive Burning');
  assert.equal(stoker.state.tick.integrity, 35, '6 damage less the attachment Plating 1');

  // WLD-08: the vent is active when `turn % 6` is 0 or 1, and its 4 damage ignores Plating.
  const vent = fixtureGame(['############', '#..........#', '#.T".......#', '#..........#', '############'], {
    rng: queueRng([]),
  });
  vent.state.tick.equipment.attachment = 'Oil Reservoir';
  vent.state.turn = 5;

  const step = vent.act({ type: 'move', dx: 1, dy: 0 });
  assert.ok(texts(step).includes('Tick is caught in the Steam Vent for 4.'));
  assert.equal(vent.state.tick.integrity, 36, 'still 4 damage');
  assert.equal(vent.state.tick.statuses.Burning, undefined, 'and still no Burning');
});

test('ACC-62: with the Governor fitted 30 turns cost 5 Tension, not 6 @m07', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  tick.equipment.attachment = 'Governor';
  assert.equal(derive(tick).decayPeriod, 6, 'CAT-05 Regulated (D-044: derived, never stored)');

  for (let i = 0; i < 30; i++) assert.equal(game.act({ type: 'wait' }).ok, true);
  assert.equal(game.state.turn, 30);
  assert.equal(tick.tension, 95, 'CHR-04: one Tension every 6 turns');
  assert.equal(tick.decayCounter, 0);

  // "decayCounter is kept when the Governor is fitted or removed" (CAT-05).
  const swap = fixtureGame(ROOM, { rng: queueRng([]) });
  swap.state.tick.inventory = [{ name: 'Governor', count: 1 }];
  for (let i = 0; i < 3; i++) swap.act({ type: 'wait' });
  assert.equal(swap.state.tick.decayCounter, 3);
  assert.equal(swap.act({ type: 'equip', slot: 0 }).ok, true);
  assert.equal(swap.state.tick.decayCounter, 4, 'the counter is not reset by fitting it');
  swap.act({ type: 'wait' });
  assert.equal(swap.state.tick.tension, 100, 'the 5th turn no longer decays');
  swap.act({ type: 'wait' });
  assert.equal(swap.state.tick.tension, 99, 'the 6th does');
  assert.equal(swap.state.tick.decayCounter, 0);
});

test('ACC-64: Flux at full Integrity while Burning clears the status and is still consumed @m07', () => {
  const game = fixtureGame(ROOM, { rng: queueRng([]) });
  const tick = game.state.tick;
  tick.inventory = [{ name: 'Flux', count: 1 }];
  tick.statuses.Burning = 3;

  const result = game.act({ type: 'use', slot: 0 });
  assert.equal(result.ok, true);
  const lines = texts(result);
  assert.ok(lines.includes('Tick is no longer Burning.'));
  assert.ok(lines.includes('Tick cleans the joints. Integrity 40.'));
  assert.ok(!lines.includes('Nothing needed mending.'), 'ITM-09: the status was removed, so something happened');
  assert.equal(tick.statuses.Burning, undefined);
  assert.equal(tick.integrity, 40, 'CHR-02: Integrity is clamped to the maximum');
  assert.deepEqual(tick.inventory, [], 'the item is consumed either way');
  assert.equal(game.state.turn, 1);
});
