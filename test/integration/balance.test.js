// The BAL-C1..C6 checks of `31-balance.md`, recomputed from `data/` and `src/` rather than read
// back from the balance document (PLN-06 M11 task 2).
//
// Nothing here runs the game: every check is arithmetic over the tables the game already loads,
// so a change to `data/enemies.js`, `data/floors.js`, `data/skills.js` or the constants in
// `src/actors.js` / `src/items.js` fails the check that depended on it. The balance document's own
// numbers appear only as the expectations, quoted with their spec IDs.
//
// C1, C3, C4 and C6 are fully recomputed. C2 and C5 are documented arithmetic whose inputs live in
// the code, so those two tests assert the inputs (PLN-06 M11 task 2: "C2 and C5 are documented
// arithmetic; the test asserts the inputs they depend on (Solder 15, decay 5, Integrity 40+4/level)").

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FLOORS, NOMINAL_XP } from '../../data/floors.js';
import { ENEMIES, ENEMIES_BY_NAME } from '../../data/enemies.js';
import { SKILLS_BY_NAME, DISCIPLINES, XP_THRESHOLDS } from '../../data/skills.js';
import { HAZARDS } from '../../src/tiles.js';
import { parseDice } from '../../src/rng.js';
import { START_INTEGRITY, LEVEL_INTEGRITY, TENSION_MAX, MAX_LEVEL, levelForXp } from '../../src/actors.js';
import { AMOUNTS, BASE_DECAY_PERIOD, REGULATED_DECAY_PERIOD } from '../../src/items.js';
import { OVERWIND_DICE, PULSE_DICE, VENT_DAMAGE } from '../../src/bosses.js';
import { prerequisiteOf } from '../../src/skills.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BALANCE_DOC = fs.readFileSync(path.join(ROOT, 'specs', '31-balance.md'), 'utf8');

/** Floors 1-8 as a dense list; `FLOORS` itself is 1-indexed (D-029). */
const ALL_FLOORS = FLOORS.slice(1);

// -----------------------------------------------------------------------------------------------
// OVR-04's pacing table — the only input BAL-01 takes from outside `31-balance.md`
// -----------------------------------------------------------------------------------------------

/** OVR-04 "Target turns (full explore)", floors 1-8. */
const OVR_04_TURNS = [180, 220, 240, 240, 240, 260, 260, 120];

/** OVR-04's total. */
const OVR_04_TOTAL_TURNS = 1760;

/**
 * BAL-01's "Skill/shot use" column: the Tension a full-explore, skill-heavy run spends on active
 * skills and ranged shots on each floor. It is an assumption of the model, not a derived value, so
 * it is quoted here exactly as the table writes it.
 */
const BAL_01_SKILL_SHOT = [4, 15, 20, 20, 20, 25, 25, 20];

/** BAL-01: "the Winding Station is reached at 50% of a floor's turns". */
const STATION_AT = 0.5;

/**
 * Which floors have a Winding Station a full-explore run can actually use. Floor 1's is spent at
 * start (WLD-07, CHR-05) and floor 8 has none (FLR-09), which is exactly the two dashes BAL-01's
 * "At station" column shows.
 */
function hasUsableStation(n) {
  return n >= 2 && n <= 7;
}

// -----------------------------------------------------------------------------------------------
// BAL-C1 — the Tension budget
// -----------------------------------------------------------------------------------------------

/**
 * Walk BAL-01's model floor by floor with CHR-04's decay and CHR-05's station, and report every
 * column the table prints.
 *
 * @param {{decayPeriod?: number}} [opts]
 * @returns {{floor: number, turns: number, arrive: number, decayToStation: number|null,
 *            atStation: number|null, rewind: number|null, decayToStairs: number,
 *            skillShot: number, leave: number}[]}
 */
function tensionBudget(opts = {}) {
  const decayPeriod = opts.decayPeriod ?? BASE_DECAY_PERIOD;
  const rows = [];
  let tension = TENSION_MAX;
  for (let n = 1; n <= 8; n++) {
    const turns = OVR_04_TURNS[n - 1];
    const arrive = tension;
    const skillShot = BAL_01_SKILL_SHOT[n - 1];
    let decayToStation = null;
    let atStation = null;
    let rewind = null;
    let decayToStairs;
    if (hasUsableStation(n)) {
      const before = Math.floor(turns * STATION_AT);
      decayToStation = Math.floor(before / decayPeriod);
      atStation = arrive - decayToStation;
      rewind = TENSION_MAX;
      tension = TENSION_MAX;
      decayToStairs = Math.floor((turns - before) / decayPeriod);
    } else {
      // No station this floor: the whole floor's turns decay in one stretch.
      decayToStairs = Math.floor(turns / decayPeriod);
      tension = arrive;
    }
    const leave = tension - decayToStairs - skillShot;
    tension = leave;
    rows.push({ floor: n, turns, arrive, decayToStation, atStation, rewind, decayToStairs, skillShot, leave });
  }
  return rows;
}

test('BAL-C1: the BAL-01 Tension budget recomputed from OVR-04 turns and CHR-04 decay @unit @m11', () => {
  const rows = tensionBudget();

  // CHR-04: "`decayPeriod` is 5", which is what the whole table is built on.
  assert.equal(BASE_DECAY_PERIOD, 5, 'CHR-04 time decay is 1 per 5 turns');
  assert.equal(TENSION_MAX, 100, 'CHR-02 Tension maximum');
  assert.deepEqual(
    rows.map((r) => r.turns),
    OVR_04_TURNS,
    'BAL-01 Turns column is OVR-04 target turns',
  );

  // BAL-01, column by column.
  assert.deepEqual(rows.map((r) => r.arrive), [100, 60, 63, 56, 56, 56, 49, 49], 'BAL-01 Arrive');
  assert.deepEqual(
    rows.map((r) => r.decayToStation),
    [null, 22, 24, 24, 24, 26, 26, null],
    'BAL-01 Decay to station',
  );
  assert.deepEqual(rows.map((r) => r.atStation), [null, 38, 39, 32, 32, 30, 23, null], 'BAL-01 At station');
  assert.deepEqual(rows.map((r) => r.rewind), [null, 100, 100, 100, 100, 100, 100, null], 'BAL-01 Rewind');
  assert.deepEqual(
    rows.map((r) => r.decayToStairs),
    [36, 22, 24, 24, 24, 26, 26, 24],
    'BAL-01 Decay to stairs',
  );
  assert.deepEqual(rows.map((r) => r.skillShot), BAL_01_SKILL_SHOT, 'BAL-01 Skill/shot use');
  assert.deepEqual(rows.map((r) => r.leave), [60, 63, 56, 56, 56, 49, 49, 5], 'BAL-01 Leave');

  // BAL-C1: "the Leave column must never go <= 0 with these assumptions. (Passes: minimum 5.)"
  const minLeave = Math.min(...rows.map((r) => r.leave));
  assert.ok(minLeave > 0, `BAL-C1: some floor ends wound down (min Leave ${minLeave})`);
  assert.equal(minLeave, 5, 'BAL-01 finding: 5 Tension to spare on the final turn');

  // The pre-station low points BAL-01 calls out: 30-39 on floors 2-6, 23 on floor 7.
  const lows = rows.filter((r) => r.atStation !== null).map((r) => r.atStation);
  for (const low of lows) assert.ok(low > 0, `a pre-station low point wound Tick down: ${low}`);
  assert.equal(Math.min(...lows), 23, 'BAL-01 finding: 23 on floor 7 is the run low point');

  // BAL-08 knob 3: "changing to 6 is worth ~ +8 Tension per floor". The Governor is the only thing
  // that does it (CHR-04), and it must not turn the model negative either.
  assert.equal(REGULATED_DECAY_PERIOD, 6, 'CAT-05 Governor decay period');
  const governed = tensionBudget({ decayPeriod: REGULATED_DECAY_PERIOD });
  assert.ok(
    Math.min(...governed.map((r) => r.leave)) > minLeave,
    'BAL-01: the Governor must widen the margin, not narrow it',
  );
});

// -----------------------------------------------------------------------------------------------
// BAL-C2 — the Integrity budget (documented arithmetic; its inputs are asserted)
// -----------------------------------------------------------------------------------------------

/** BAL-02's "Integrity max" column, recomputed from CHR-01 and CHR-07 at OVR-04's level curve. */
function expectedIntegrityMax(n) {
  // OVR-04: the expected character level on exit of floor n is n + 1, so the level *during* floor n
  // is n; CHR-07 adds LEVEL_INTEGRITY per level over CHR-01's START_INTEGRITY.
  return START_INTEGRITY + LEVEL_INTEGRITY * (n - 1);
}

/** BAL-02's "Expected loss" column, worst end of each range. */
const BAL_02_EXPECTED_LOSS = [18, 13, 33, 25, 22, 37, 32, 51];

test('BAL-C2: no floor loses more than 65% of Integrity max + one Solder @unit @m11', () => {
  // The three inputs BAL-02's arithmetic depends on.
  assert.equal(START_INTEGRITY, 40, 'CHR-01 starting Integrity');
  assert.equal(LEVEL_INTEGRITY, 4, 'CHR-07 Integrity per level');
  assert.equal(AMOUNTS.SOLDER.plain, 15, 'CAT-06 Solder amount');

  const maxima = [1, 2, 3, 4, 5, 6, 7, 8].map(expectedIntegrityMax);
  assert.deepEqual(maxima, [40, 44, 48, 52, 56, 60, 64, 68], 'BAL-02 Integrity max column');

  const ratios = BAL_02_EXPECTED_LOSS.map((loss, i) => loss / (maxima[i] + AMOUNTS.SOLDER.plain));
  const worst = Math.max(...ratios);
  const over = ratios
    .map((r, i) => ({ floor: i + 1, percent: Math.round(r * 1000) / 10 }))
    .filter((r) => r.percent > 65);
  assert.deepEqual(over, [], 'BAL-C2: a floor exceeds 65% of the available Integrity');
  assert.ok(worst <= 0.65, `BAL-C2 worst ratio ${Math.round(worst * 1000) / 10}%`);
});

// -----------------------------------------------------------------------------------------------
// BAL-C3 — XP and levels
// -----------------------------------------------------------------------------------------------

/**
 * FLR-10's nominal XP for floor `n`, recomputed from `data/floors.js` and `data/enemies.js`: every
 * spawn entry (a pack counts its mean size, using the entry's `size` override when present), the
 * floor's cache guard, its boss, and a boss's *fixed* summons. The Conductor's dancers are a live
 * cap of 4 rather than a fixed count, so FLR-04 excludes them from the base figure.
 */
function nominalXp(floor) {
  const xpOf = (name) => ENEMIES_BY_NAME[name].xp;
  let xp = 0;
  for (const entry of floor.spawns) {
    if (entry.pack) {
      const size = entry.size ?? ENEMIES_BY_NAME[entry.pack].packSize;
      xp += ((size[0] + size[1]) / 2) * xpOf(entry.pack);
    } else {
      xp += entry.count * xpOf(entry.type);
    }
  }
  if (floor.guard) xp += xpOf(floor.guard);
  if (floor.boss) {
    xp += xpOf(floor.boss.type);
    if (floor.boss.summonCount) xp += floor.boss.summonCount * xpOf(floor.boss.summonType);
  }
  return xp;
}

test('BAL-C3: 75%-kill cumulative XP reaches level n+1 by the end of floor n @unit @m11', () => {
  const perFloor = ALL_FLOORS.map(nominalXp);
  assert.deepEqual(perFloor, [...NOMINAL_XP.byFloor], 'FLR-10 nominal XP per floor');

  const total = perFloor.reduce((a, b) => a + b, 0);
  assert.equal(total, 318, 'FLR-10 total XP placed across a run');
  // CHR-06: "Wave 3 must place at least 300 XP of enemies across a full run (BAL-03 verifies)".
  assert.ok(total >= 300, `CHR-06 requires >= 300 XP placed; found ${total}`);

  // BAL-03's cumulative-at-75% row, and the level each figure buys under CHR-06's thresholds.
  let cumulative = 0;
  const cum = [];
  for (const xp of perFloor) {
    cumulative += xp;
    cum.push(cumulative * 0.75);
  }
  assert.deepEqual(
    cum.map((v) => Math.round(v * 10) / 10),
    [11.6, 31.9, 56.6, 90.4, 123.4, 167.6, 211.5, 238.5],
    'BAL-03 cumulative XP at 75% kills',
  );

  // BAL-C3: the level-n+1 threshold is crossed during or at the end of floor n, for n in 1..8.
  const levels = cum.map((v) => levelForXp(Math.floor(v)));
  assert.deepEqual(levels, [2, 3, 4, 5, 6, 7, 8, 9], 'BAL-03 levels at the end of floors 1-8');
  for (let n = 1; n <= 8; n++) {
    const wanted = XP_THRESHOLDS[n]; // threshold for level n + 1 (XP_THRESHOLDS is 0-based by level - 1)
    assert.ok(
      cum[n - 1] >= wanted,
      `BAL-C3: floor ${n} ends on ${cum[n - 1].toFixed(1)} XP, short of level ${n + 1}'s ${wanted}`,
    );
  }
  // OVR-04's "Expected char. level on exit" column is the same list, and level 9 is the cap.
  assert.equal(levels[7], MAX_LEVEL, 'OVR-04: level 9 on floor 8');
});

// -----------------------------------------------------------------------------------------------
// BAL-C4 — the single-hit cap
// -----------------------------------------------------------------------------------------------

/** The largest number a dice string can roll (`parseDice` handles the `n (flat)` form). */
function maxRoll(spec) {
  const { n, sides, mod } = parseDice(spec);
  return n * sides + mod;
}

/**
 * Every source of a single hit on floor `n`, from data: each enemy type whose BST-02 `floors` list
 * includes `n` (its melee attack, its heavy attack and its ranged attack), each hazard whose WLD-08
 * `floors` list includes `n`, and the boss specials of BST-05 and BST-06.
 */
function singleHitSources(n) {
  const out = [];
  for (const e of ENEMIES) {
    if (!e.floors.includes(n)) continue;
    out.push({ what: `${e.name} melee ${e.attack}`, damage: maxRoll(e.attack) });
    if (e.heavyAttack) out.push({ what: `${e.name} heavy ${e.heavyAttack}`, damage: maxRoll(e.heavyAttack) });
    if (e.ranged) out.push({ what: `${e.name} ranged ${e.ranged.dice}`, damage: maxRoll(e.ranged.dice) });
    if (e.boss === 'REGULATOR') out.push({ what: 'The Regulator Vent', damage: VENT_DAMAGE });
    if (e.boss === 'UNDERSTUDY') {
      out.push({ what: `The Understudy Overwind ${OVERWIND_DICE}`, damage: maxRoll(OVERWIND_DICE) });
      out.push({ what: `The Understudy Pulse ${PULSE_DICE}`, damage: maxRoll(PULSE_DICE) });
    }
  }
  for (const cfg of Object.values(HAZARDS)) {
    if (cfg.floors.includes(n)) out.push({ what: cfg.name, damage: cfg.damage });
  }
  return out;
}

test('BAL-C4: no single hit exceeds 40% of expected Integrity on its floor @unit @m11', () => {
  // BST-06's two specials, as the balance table names them.
  assert.equal(maxRoll(OVERWIND_DICE), 16, 'BAL-04: Understudy Overwind 16');
  assert.equal(maxRoll(PULSE_DICE), 7, 'BAL-04: Understudy Pulse 7');

  const rows = [];
  for (let n = 1; n <= 8; n++) {
    const sources = singleHitSources(n);
    assert.ok(sources.length > 0, `floor ${n} has no attack sources in data`);
    const worst = sources.reduce((a, b) => (b.damage > a.damage ? b : a));
    const cap = expectedIntegrityMax(n);
    rows.push({ floor: n, worst: worst.what, damage: worst.damage, cap, ratio: worst.damage / cap });
  }

  // BAL-04's "Largest possible single hit" column, recomputed over each floor's whole roster.
  assert.deepEqual(
    rows.map((r) => r.damage),
    [3, 5, 5, 12, 5, 15, 12, 16],
    'BAL-04 largest single hit per floor (D-097: the table names the notable threat, not the maximum)',
  );

  // BAL-C4: "all ratios <= 40%. (Passes; the worst is 25%.)"
  const over = rows.filter((r) => r.ratio > 0.4);
  assert.deepEqual(over, [], 'BAL-C4 / OVR-05: a single hit exceeds 40% of expected Integrity');
  const worst = Math.max(...rows.map((r) => r.ratio));
  assert.ok(worst <= 0.4, `BAL-C4 worst ratio ${(worst * 100).toFixed(1)}%`);
  // The worst case is the Regulator's heavy on floor 6: 15 of 60.
  assert.equal(rows[5].damage, 15);
  assert.equal(Math.round(worst * 100), 25, 'BAL-C4 finding: the worst is 25%');
});

// -----------------------------------------------------------------------------------------------
// BAL-C5 — time (documented arithmetic; its inputs are asserted)
// -----------------------------------------------------------------------------------------------

test('BAL-C5: an experienced full-explore win lands inside 30-45 minutes @unit @m11', () => {
  assert.equal(
    OVR_04_TURNS.reduce((a, b) => a + b, 0),
    OVR_04_TOTAL_TURNS,
    'OVR-04 total turns',
  );
  // BAL-05: "At 1.2 s per turn (experienced) = 35 min; text boxes and journal reading ~ 4 min;
  // screens ~ 2 min -> ~ 41 min."
  const playMinutes = (OVR_04_TOTAL_TURNS * 1.2) / 60;
  const total = playMinutes + 4 + 2;
  assert.equal(Math.round(playMinutes), 35, 'BAL-05 play time at 1.2 s per turn');
  assert.ok(total >= 30 && total <= 45, `BAL-C5: ${total.toFixed(1)} min is outside 30-45`);
});

// -----------------------------------------------------------------------------------------------
// BAL-C6 — build viability
// -----------------------------------------------------------------------------------------------

/**
 * BAL-06's three builds: the point spend the table's row heading names, and every skill its four
 * cells name by name. `Ring`, `Harmonic Rifle`, `Clatter Can`, `Solder` and `Flux` are items, not
 * skills, so they are not listed here.
 */
const BAL_06_BUILDS = [
  {
    name: 'Frame',
    spend: { Armature: 4, Tinkering: 4, Resonance: 0 },
    skills: ['Piston Drive', 'Flywheel Guard', 'Braced Frame', 'Clockwork Decoy', 'Field Repair', 'Overwind Strike', 'Salvage'],
  },
  {
    name: 'Bell',
    spend: { Armature: 4, Tinkering: 0, Resonance: 4 },
    skills: ['Discord', 'Resonant Pulse', 'Tuning', 'Sympathetic Break'],
  },
  {
    name: 'Apprentice',
    spend: { Armature: 0, Tinkering: 4, Resonance: 4 },
    skills: ['Clockwork Decoy', 'Discord', 'Efficient Springs', 'Field Repair'],
  },
];

/** BAL-06's four columns — the questions every build must answer. */
const BAL_06_QUESTIONS = ['Golem', 'Cuckoo', 'Regulator', 'Understudy'];

/** CHR-09's total skill points over a run: one per level-up from 1 to 9. */
const SKILL_POINTS = MAX_LEVEL - 1;

/**
 * Can this point spend be taken with `SKILL_POINTS` points under CHR-09's prerequisite rule?
 * Ranks within a discipline must be taken in order, and disciplines are independent, so a spend of
 * `k` in a discipline means exactly its ranks 1..k.
 */
function takeOrderFor(spend) {
  const taken = [];
  for (const discipline of DISCIPLINES) {
    for (let rank = 1; rank <= (spend[discipline] || 0); rank++) {
      const skill = Object.values(SKILLS_BY_NAME).find((s) => s.discipline === discipline && s.rank === rank);
      assert.ok(skill, `CHR-09: ${discipline} has no rank ${rank}`);
      taken.push(skill.name);
    }
  }
  return taken;
}

test('BAL-C6: every BAL-06 build exists, fits 8 points, and answers all four questions @unit @m11', () => {
  // The BAL-06 table itself: three rows, four question columns, no empty cell.
  const rows = BALANCE_DOC.split('\n')
    .filter((line) => line.startsWith('| **Frame**') || line.startsWith('| **Bell**') || line.startsWith('| **Apprentice**'))
    .map((line) => line.slice(1, -1).split(' | ').map((c) => c.trim()));
  assert.equal(rows.length, 3, 'BAL-06 must document exactly three builds');
  for (const row of rows) {
    assert.equal(row.length, 1 + BAL_06_QUESTIONS.length, `BAL-06 row has ${row.length} cells`);
    for (let i = 1; i < row.length; i++) {
      assert.ok(
        row[i].length > 0,
        `BAL-C6: ${row[0]} has an empty answer for ${BAL_06_QUESTIONS[i - 1]}`,
      );
    }
  }

  assert.equal(SKILL_POINTS, 8, 'CHR-09: 8 skill points over a run');

  for (const build of BAL_06_BUILDS) {
    const spent = Object.values(build.spend).reduce((a, b) => a + b, 0);
    assert.equal(spent, SKILL_POINTS, `${build.name} must spend exactly ${SKILL_POINTS} points`);

    // Every skill the build's cells name exists in `data/skills.js` (ACC-132's skill clause).
    const order = takeOrderFor(build.spend);
    for (const name of build.skills) {
      assert.ok(SKILLS_BY_NAME[name], `BAL-06 ${build.name} names an unknown skill: ${name}`);
      assert.ok(order.includes(name), `BAL-06 ${build.name} names ${name}, which its spend cannot take`);
    }

    // CHR-09's prerequisite rule, walked in the acquisition order the spend implies.
    const held = new Set();
    for (const name of order) {
      const prereq = prerequisiteOf(name);
      assert.ok(
        prereq === null || held.has(prereq),
        `CHR-09: ${build.name} takes ${name} before its prerequisite ${prereq}`,
      );
      held.add(name);
    }
    assert.equal(held.size, SKILL_POINTS, `${build.name} takes ${SKILL_POINTS} distinct skills`);

    // CHR-10: no spend yields more than four active skills, so four hotkeys always suffice.
    const actives = order.filter((name) => SKILLS_BY_NAME[name].type === 'A');
    assert.ok(actives.length <= 4, `CHR-10: ${build.name} would need ${actives.length} active slots`);
  }
});
