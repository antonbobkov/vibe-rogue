// M02 — the content tables in data/ are shaped per TEC-03 and add up to what the specs claim.
//
// Everything asserted here is written from the spec, not from the data (PLN-04: "expected values
// are written in the test from the spec"). ACC-132 is the referential-integrity check across
// 21/22/23 and the palette; the static half of ACC-77 is the floor 8 map.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PALETTE, PALETTE_BG } from '../../data/palette.js';
import { resolve, resolves } from '../../src/palette.js';
import {
  ITEMS,
  ITEMS_BY_NAME,
  WEAPON_SPECIALS,
  ATTACHMENT_SPECIALS,
  CONSUMABLE_EFFECTS,
} from '../../data/items.js';
import {
  ENEMIES,
  ENEMIES_BY_NAME,
  STATUSES,
  ARCHETYPES,
  SPEEDS,
  DOOR_BEHAVIOURS,
  ON_HIT_IDS,
} from '../../data/enemies.js';
import { SKILLS, SKILLS_BY_NAME, DISCIPLINES } from '../../data/skills.js';
import { FLOORS, FIXED_MAP_LEGEND, NOMINAL_XP } from '../../data/floors.js';

/** Floors 1–8 as a dense list; `FLOORS` itself is 1-indexed (D-029). */
const ALL_FLOORS = FLOORS.slice(1);
import * as SCRIPT from '../../data/script.js';

// ---------------------------------------------------------------------------------------
// Helpers (test-local; the data modules themselves hold no logic — PLN-02 R3)
// ---------------------------------------------------------------------------------------

/** Fields every item has, and the extras each ITM-01 category defines. */
const ITEM_FIELDS = {
  common: { required: ['name', 'category', 'glyph', 'color', 'description', 'floors'], optional: ['unique'] },
  melee: { required: ['dice', 'accuracyMod'], optional: ['special'] },
  ranged: { required: ['dice', 'accuracyMod', 'range', 'tensionCost'], optional: ['special'] },
  plating: { required: ['plating', 'evasionPenalty'], optional: [] },
  attachment: { required: ['forceMod', 'precisionMod', 'platingMod', 'evasionMod'], optional: ['special'] },
  instant: { required: ['effect'], optional: [] },
  throwable: { required: ['range', 'radius', 'effect'], optional: [] },
  record: { required: [], optional: ['journalIndex', 'blueprint'] },
};

/** ITM-01's fixed glyph per category (UI-07). */
const CATEGORY_GLYPH = {
  melee: ')',
  ranged: '}',
  plating: '[',
  attachment: '*',
  instant: '!',
  throwable: '{',
  record: '?',
};

/** TEC-03 `EnemyType` / ENM-01: the fields every enemy type defines. */
const ENEMY_REQUIRED = [
  'name',
  'glyph',
  'color',
  'description',
  'floors',
  'integrity',
  'accuracy',
  'evasion',
  'plating',
  'attack',
  'speed',
  'archetype',
  'perception',
  'opensDoors',
  'immunities',
  'xp',
  'dropChance',
  'dropTable',
];

/** TEC-03 `FloorDef`. */
const FLOOR_REQUIRED = [
  'number',
  'name',
  'shortName',
  'roomTarget',
  'extraCorridors',
  'doorChance',
  'hazards',
  'itemCount',
  'floorTable',
  'cacheCount',
  'cacheTable',
  'spawns',
  'guard',
  'journalPage',
];
const FLOOR_OPTIONAL = ['cacheFirstRollTable', 'cacheExtra', 'boss', 'fixedMap', 'wanderTable'];

/** The twelve skill names, hard-coded from `11-character-and-skills.md` / `20-skills.md`. */
const SPEC_SKILL_NAMES = [
  'Braced Frame',
  'Overwind Strike',
  'Flywheel Guard',
  'Piston Drive',
  'Salvage',
  'Efficient Springs',
  'Field Repair',
  'Clockwork Decoy',
  'Tuning',
  'Resonant Pulse',
  'Discord',
  'Sympathetic Break',
];

/** Every `[name, weight]` table on a floor def, labelled for error messages. */
function floorTables(floor) {
  const out = [
    [`floor ${floor.number} floorTable`, floor.floorTable],
    [`floor ${floor.number} cacheTable`, floor.cacheTable],
  ];
  if (floor.cacheFirstRollTable) out.push([`floor ${floor.number} cacheFirstRollTable`, floor.cacheFirstRollTable]);
  return out;
}

function words(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function duplicates(values) {
  const seen = new Set();
  const dupes = [];
  for (const v of values) {
    if (seen.has(v)) dupes.push(v);
    seen.add(v);
  }
  return dupes;
}

/** Every object and array reachable from `value`, for the deep-freeze check. */
function unfrozen(value, path, out) {
  if (value === null || typeof value !== 'object') return out;
  if (!Object.isFrozen(value)) out.push(path);
  if (Array.isArray(value)) value.forEach((v, i) => unfrozen(v, `${path}[${i}]`, out));
  else for (const [k, v] of Object.entries(value)) unfrozen(v, `${path}.${k}`, out);
  return out;
}

// ---------------------------------------------------------------------------------------
// Items (21-items-catalog.md, ITM-01, TEC-03)
// ---------------------------------------------------------------------------------------

test('data/items: every item has its category fields and no others (ITM-01, TEC-03) @unit @m02', () => {
  const problems = [];
  for (const item of ITEMS) {
    const spec = ITEM_FIELDS[item.category];
    if (!spec) {
      problems.push(`${item.name}: unknown category '${item.category}'`);
      continue;
    }
    const allowed = new Set([
      ...ITEM_FIELDS.common.required,
      ...ITEM_FIELDS.common.optional,
      ...spec.required,
      ...spec.optional,
    ]);
    const present = Object.keys(item);
    for (const field of [...ITEM_FIELDS.common.required, ...spec.required]) {
      if (!present.includes(field)) problems.push(`${item.name}: missing required field '${field}'`);
    }
    for (const field of present) {
      if (!allowed.has(field)) problems.push(`${item.name}: unexpected field '${field}' for a ${item.category}`);
    }
    if (item.glyph !== CATEGORY_GLYPH[item.category]) {
      problems.push(`${item.name}: glyph '${item.glyph}' is not the ${item.category} glyph '${CATEGORY_GLYPH[item.category]}'`);
    }
    if (!Array.isArray(item.floors) || item.floors.some((n) => !Number.isInteger(n) || n < 1 || n > 8)) {
      problems.push(`${item.name}: floors must be integers in 1..8`);
    }
    if (item.category === 'record') {
      const hasIndex = Object.prototype.hasOwnProperty.call(item, 'journalIndex');
      const hasBlueprint = Object.prototype.hasOwnProperty.call(item, 'blueprint');
      if (hasIndex === hasBlueprint) problems.push(`${item.name}: a record has exactly one of journalIndex / blueprint`);
    }
    if (item.category === 'plating' && !(item.plating >= 1 && item.evasionPenalty >= 0)) {
      problems.push(`${item.name}: plating >= 1 and evasionPenalty >= 0 (ITM-01)`);
    }
  }
  assert.deepEqual(problems, []);
});

test('data/items: every effect and special id is in its TEC-04 closed set @unit @m02', () => {
  const problems = [];
  for (const item of ITEMS) {
    if (item.category === 'melee' || item.category === 'ranged') {
      if (item.special && !WEAPON_SPECIALS.includes(item.special)) problems.push(`${item.name}: ${item.special}`);
    }
    if (item.category === 'attachment') {
      if (item.special && !ATTACHMENT_SPECIALS.includes(item.special)) problems.push(`${item.name}: ${item.special}`);
    }
    if (item.category === 'instant' || item.category === 'throwable') {
      if (!CONSUMABLE_EFFECTS.includes(item.effect)) problems.push(`${item.name}: ${item.effect}`);
    }
  }
  assert.deepEqual(problems, []);
  assert.deepEqual([...WEAPON_SPECIALS], ['REND', 'SWEEP', 'KNOCK', 'TEMPO', 'RING']);
  assert.deepEqual([...ATTACHMENT_SPECIALS], ['COOLING', 'QUIET', 'REGULATED']);
  assert.deepEqual(
    [...CONSUMABLE_EFFECTS],
    ['SOLDER', 'SPRING_KEY', 'FLUX', 'OIL_FLASK', 'GRIT_BOMB', 'TUNING_FORK', 'CLATTER_CAN'],
  );
});

test('data/items: item names are unique and the by-name index is complete @unit @m02', () => {
  assert.deepEqual(duplicates(ITEMS.map((i) => i.name)), []);
  assert.equal(Object.keys(ITEMS_BY_NAME).length, ITEMS.length);
  for (const item of ITEMS) assert.equal(ITEMS_BY_NAME[item.name], item, `${item.name} missing from ITEMS_BY_NAME`);
});

test('data/items: the counts are CAT-08 (7+2 weapons, 5, 5, 7, 9; two uniques) @unit @m02', () => {
  const count = (category) => ITEMS.filter((i) => i.category === category).length;
  assert.equal(count('melee'), 7, 'melee weapons');
  assert.equal(count('ranged'), 2, 'ranged weapons');
  assert.equal(count('plating'), 5, 'platings');
  assert.equal(count('attachment'), 5, 'attachments');
  assert.equal(count('instant') + count('throwable'), 7, 'consumables');
  assert.equal(count('record'), 9, 'records');
  assert.equal(ITEMS.length, 35);
  assert.deepEqual(
    ITEMS.filter((i) => i.unique).map((i) => i.name),
    ["Conductor's Baton", 'Governor'],
  );
});

test('data/items: the nine records are journal pages 1-8 plus the Understudy Blueprint (CAT-07) @unit @m02', () => {
  const records = ITEMS.filter((i) => i.category === 'record');
  assert.deepEqual(
    records.filter((r) => r.journalIndex).map((r) => r.journalIndex),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  const blueprint = records.find((r) => r.blueprint);
  assert.equal(blueprint.name, 'Understudy Blueprint');
  assert.deepEqual([...blueprint.floors], [6], 'the Blueprint is the floor 6 cache extra (FLR-07)');
  assert.equal(ITEMS_BY_NAME['Master Key'], undefined, 'the Master Key is narrative only (CAT-07)');
});

// ---------------------------------------------------------------------------------------
// Enemies (22-bestiary.md, ENM-01, TEC-03)
// ---------------------------------------------------------------------------------------

test('data/enemies: every enemy type has all the ENM-01 fields @unit @m02', () => {
  const problems = [];
  for (const enemy of ENEMIES) {
    for (const field of ENEMY_REQUIRED) {
      if (!Object.prototype.hasOwnProperty.call(enemy, field)) problems.push(`${enemy.name}: missing '${field}'`);
    }
    if (!ARCHETYPES.includes(enemy.archetype)) problems.push(`${enemy.name}: archetype '${enemy.archetype}'`);
    if (!SPEEDS.includes(enemy.speed)) problems.push(`${enemy.name}: speed '${enemy.speed}'`);
    if (!DOOR_BEHAVIOURS.includes(enemy.opensDoors)) problems.push(`${enemy.name}: opensDoors '${enemy.opensDoors}'`);
    for (const status of enemy.immunities) {
      if (!STATUSES.includes(status)) problems.push(`${enemy.name}: immunity '${status}' is not one of the five statuses`);
    }
    if (enemy.onHit && !ON_HIT_IDS.includes(enemy.onHit)) problems.push(`${enemy.name}: onHit '${enemy.onHit}'`);
    if (enemy.ranged) {
      for (const field of ['dice', 'range', 'windUp', 'noise']) {
        if (!Object.prototype.hasOwnProperty.call(enemy.ranged, field)) {
          problems.push(`${enemy.name}: ranged is missing '${field}'`);
        }
      }
      if (enemy.ranged.onHit && !ON_HIT_IDS.includes(enemy.ranged.onHit)) {
        problems.push(`${enemy.name}: ranged onHit '${enemy.ranged.onHit}'`);
      }
    }
    // ENM-01: packSize belongs to SWARMERs; heavyAttack to BRUISERs; boss keys to BOSSes.
    if ((enemy.archetype === 'SWARMER') !== Boolean(enemy.packSize)) {
      problems.push(`${enemy.name}: packSize is a SWARMER field`);
    }
    if ((enemy.archetype === 'BOSS') !== Boolean(enemy.boss)) {
      problems.push(`${enemy.name}: 'boss' names a boss script and belongs to BOSS types only`);
    }
    if (enemy.archetype === 'BRUISER' && !enemy.heavyAttack) problems.push(`${enemy.name}: BRUISER needs heavyAttack`);
    if (enemy.archetype === 'SKIRMISHER' && !enemy.ranged) problems.push(`${enemy.name}: SKIRMISHER needs a ranged attack`);
    if (!Array.isArray(enemy.floors) || enemy.floors.some((n) => !Number.isInteger(n) || n < 1 || n > 8)) {
      problems.push(`${enemy.name}: floors must be integers in 1..8`);
    }
    if (!(enemy.dropChance >= 0 && enemy.dropChance <= 100)) problems.push(`${enemy.name}: dropChance out of range`);
    for (const entry of enemy.dropTable) {
      if (!(Array.isArray(entry) && entry.length === 2 && Number.isInteger(entry[1]) && entry[1] > 0)) {
        problems.push(`${enemy.name}: drop table entries are [name, positive weight]`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('data/enemies: names and glyphs are unique, bosses uppercase and the rest lowercase (UI-07) @unit @m02', () => {
  assert.deepEqual(duplicates(ENEMIES.map((e) => e.name)), []);
  assert.deepEqual(duplicates(ENEMIES.map((e) => e.glyph)), []);
  const problems = [];
  for (const enemy of ENEMIES) {
    if (!/^[A-Za-z]$/.test(enemy.glyph)) problems.push(`${enemy.name}: glyph '${enemy.glyph}' is not a letter`);
    const isBoss = enemy.archetype === 'BOSS';
    const isUpper = enemy.glyph === enemy.glyph.toUpperCase();
    if (isBoss !== isUpper) problems.push(`${enemy.name}: bosses use uppercase glyphs, others lowercase`);
  }
  assert.deepEqual(problems, []);
  assert.deepEqual(
    ENEMIES.filter((e) => e.archetype === 'BOSS').map((e) => e.name),
    ['The Conductor', 'The Regulator', 'The Understudy'],
  );
  assert.equal(Object.keys(ENEMIES_BY_NAME).length, ENEMIES.length);
});

test('data/enemies: BST-07 XP inventory is transcribed exactly @unit @m02', () => {
  const expected = {
    'Rust-moth': 1,
    'Sweeper': 3,
    'Spring-Hound': 5,
    'Tin Soldier': 6,
    'Music-box Dancer': 4,
    'Cuckoo': 6,
    'Stoker': 8,
    'Gear-Golem': 12,
    'Brass Finch': 3,
    'Archivist': 8,
    'The Unfinished': 9,
    'Pendulum Knight': 12,
    // DIF-11: the Magpie, M13's thirteenth regular enemy.
    'Magpie': 6,
    'The Conductor': 10,
    'The Regulator': 12,
    'The Understudy': 0,
  };
  assert.deepEqual(Object.fromEntries(ENEMIES.map((e) => [e.name, e.xp])), expected);
  assert.equal(ENEMIES_BY_NAME['The Understudy'].dropChance, 0, 'BST-06: the Understudy drops nothing');
  assert.deepEqual([...ENEMIES_BY_NAME['The Understudy'].dropTable], []);
});

// ---------------------------------------------------------------------------------------
// Skills (20-skills.md, CHR-09)
// ---------------------------------------------------------------------------------------

test('data/skills: CHR-09 shape — three disciplines, ranks 1-4 unique, 2 actives + 2 passives @unit @m02', () => {
  assert.equal(SKILLS.length, 12);
  for (const discipline of DISCIPLINES) {
    const line = SKILLS.filter((s) => s.discipline === discipline);
    assert.equal(line.length, 4, `${discipline} has four skills`);
    assert.deepEqual(line.map((s) => s.rank).sort((a, b) => a - b), [1, 2, 3, 4], `${discipline} ranks 1-4`);
    assert.equal(line.filter((s) => s.type === 'A').length, 2, `${discipline} has exactly two actives`);
    assert.equal(line.filter((s) => s.type === 'P').length, 2, `${discipline} has exactly two passives`);
    for (const skill of line) {
      if (skill.type === 'A') {
        assert.ok(skill.cost >= 5 && skill.cost <= 20, `${skill.name} costs 5-20 Tension (CHR-04)`);
        assert.ok(skill.target, `${skill.name} names a target (SKL-01)`);
      } else {
        assert.equal(skill.cost, undefined, `${skill.name} is passive and has no cost`);
        assert.equal(skill.target, undefined, `${skill.name} is passive and has no target`);
      }
      // SKL-01 asks for summaries "≤ 60 chars", but three of the twelve summaries written in
      // SKL-02..04 are longer (62, 77, 79). The text is transcribed verbatim (R1) and the length
      // rule is not asserted — see D-025. Descriptions do obey their "≤ 40 words".
      assert.ok(words(skill.description) <= 40, `${skill.name} description is <= 40 words (SKL-01)`);
    }
  }
  // CHR-10: no build reaches more than four actives, so four hotkeys suffice.
  assert.equal(SKILLS.filter((s) => s.type === 'A').length, 6);
  assert.equal(SKILLS.filter((s) => s.oncePerFloor).map((s) => s.name).join(), 'Field Repair');
});

test('data/skills: the SKL-02..04 ranks, types, costs, targets and summaries are verbatim @unit @m02', () => {
  assert.deepEqual(
    SKILLS.map((s) => [s.discipline, s.rank, s.type, s.cost ?? null, s.target ?? null]),
    [
      ['Armature', 1, 'P', null, null],
      ['Armature', 2, 'A', 8, 'direction'],
      ['Armature', 3, 'A', 10, 'self'],
      ['Armature', 4, 'P', null, null],
      ['Tinkering', 1, 'P', null, null],
      ['Tinkering', 2, 'P', null, null],
      ['Tinkering', 3, 'A', 12, 'self'],
      ['Tinkering', 4, 'A', 15, 'adjacent-free'],
      ['Resonance', 1, 'P', null, null],
      ['Resonance', 2, 'A', 8, 'self'],
      ['Resonance', 3, 'A', 10, 'tile'],
      ['Resonance', 4, 'P', null, null],
    ],
  );
  assert.deepEqual(SKILLS.map((s) => s.summary), [
    '+1 Plating, +6 max Integrity.',
    'Melee hit: double weapon dice, +25 accuracy. 8 Tension.',
    '4 turns: +3 Plating, immune to Stun and knockback. 10 Tension.',
    '+2 Force. Melee hits of 6+ knock back and Stun 1.',
    // DIF-04: Salvage pays in throwables, and Efficient Springs is a bonus on each amount.
    'Every 4th enemy broken drops a throwable.',
    'Spring-Key +10, Solder +15, Flux +5.',
    '+12 Integrity. Once per floor. 12 Tension.',
    'Place a 12-Integrity decoy; enemies within 8 target it for 6 turns. 15 Tension.',
    '+1 Precision. Ranged shots −1 Tension, +5 accuracy.',
    'All enemies within 2: 1d4+2 damage (ignores Plating), pushed back. 8 Tension.',
    'Target within 6: Exposed 4 and Slowed 4. 10 Tension.',
    'When an enemy breaks, enemies within 3 take 4 damage.',
  ]);
});

test('data/items and data/enemies: every description is <= 25 words (ITM-01, BST-02, STY-09) @unit @m02', () => {
  const problems = [];
  for (const item of ITEMS) if (words(item.description) > 25) problems.push(`${item.name}: ${words(item.description)}`);
  for (const e of ENEMIES) if (words(e.description) > 25) problems.push(`${e.name}: ${words(e.description)}`);
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------------------
// Floors (23-floors.md, TEC-03 FloorDef)
// ---------------------------------------------------------------------------------------

test('data/floors: every floor has the FloorDef fields and nothing unexpected @unit @m02', () => {
  const problems = [];
  assert.equal(FLOORS.length, 9);
  assert.equal(FLOORS[0], null);
  ALL_FLOORS.forEach((floor, i) => {
    assert.equal(floor.number, i + 1);
    const allowed = new Set([...FLOOR_REQUIRED, ...FLOOR_OPTIONAL]);
    for (const field of FLOOR_REQUIRED) {
      if (!Object.prototype.hasOwnProperty.call(floor, field)) problems.push(`floor ${floor.number}: missing '${field}'`);
    }
    for (const field of Object.keys(floor)) {
      if (!allowed.has(field)) problems.push(`floor ${floor.number}: unexpected field '${field}'`);
    }
    if (floor.shortName.length > 11) problems.push(`floor ${floor.number}: shortName > 11 chars (FLR-01)`);
    if (floor.journalPage !== floor.number) problems.push(`floor ${floor.number}: journalPage ${floor.journalPage}`);
    const [lo, hi] = floor.cacheCount;
    if (!(Number.isInteger(lo) && Number.isInteger(hi) && lo <= hi)) problems.push(`floor ${floor.number}: cacheCount`);
    for (const hazard of floor.hazards) {
      if (!['GRINDING_GEAR', 'STEAM_VENT', 'PENDULUM_BAND'].includes(hazard.kind)) {
        problems.push(`floor ${floor.number}: hazard kind '${hazard.kind}' (WLD-08)`);
      }
    }
    for (const [label, table] of floorTables(floor)) {
      for (const entry of table) {
        if (!(Array.isArray(entry) && entry.length === 2 && Number.isInteger(entry[1]) && entry[1] > 0)) {
          problems.push(`${label}: entries are [name, positive weight] (ITM-10)`);
        }
      }
    }
    for (const entry of floor.spawns) {
      const isIndividual = Object.prototype.hasOwnProperty.call(entry, 'type');
      const isPack = Object.prototype.hasOwnProperty.call(entry, 'pack');
      if (isIndividual === isPack) problems.push(`floor ${floor.number}: a spawn entry is {type,count} or {pack,size?}`);
      if (isIndividual && !(Number.isInteger(entry.count) && entry.count > 0)) {
        problems.push(`floor ${floor.number}: spawn count for ${entry.type}`);
      }
      if (isPack && entry.size && !(entry.size.length === 2 && entry.size[0] <= entry.size[1])) {
        problems.push(`floor ${floor.number}: pack size override for ${entry.pack}`);
      }
    }
  });
  assert.deepEqual(problems, []);
});

test('data/floors: the FLR-01 short names and FLR-02..09 generator inputs are transcribed exactly @unit @m02', () => {
  assert.deepEqual(
    ALL_FLOORS.map((f) => f.shortName),
    ['Workshop', 'Gallery', 'Music Room', 'Furnace', 'Aviary', 'Archive', 'Stair', 'Escapement'],
  );
  assert.deepEqual(
    ALL_FLOORS.slice(0, 7).map((f) => [f.roomTarget, f.extraCorridors, f.doorChance]),
    [[7, 1, 60], [8, 2, 60], [8, 2, 70], [8, 2, 50], [9, 3, 40], [9, 1, 80], [8, 3, 50]],
  );
  assert.deepEqual(ALL_FLOORS.map((f) => f.itemCount), [3, 4, 4, 4, 4, 4, 5, 0]);
  assert.deepEqual(
    ALL_FLOORS.map((f) => f.hazards.map((h) => `${h.kind}${h.count === undefined ? '' : ` x${h.count}`}`)),
    [[], ['GRINDING_GEAR x6'], [], ['STEAM_VENT x10'], [], [], ['PENDULUM_BAND', 'GRINDING_GEAR x4'], []],
  );
  assert.deepEqual(
    ALL_FLOORS.map((f) => f.guard),
    ['Sweeper', 'Tin Soldier', 'Tin Soldier', 'Tin Soldier', 'Tin Soldier', 'Pendulum Knight', 'Pendulum Knight', null],
  );
  assert.deepEqual(
    ALL_FLOORS.filter((f) => f.boss).map((f) => [f.number, f.boss.type, f.boss.room]),
    [[3, 'The Conductor', 'stairs'], [6, 'The Regulator', 'stairs'], [8, 'The Understudy', 'fixed']],
  );
  // ITM-12 / FLR-02: floor 1's first cache roll always yields a plating.
  assert.deepEqual(FLOORS[1].cacheFirstRollTable.map((e) => e[0]), ['Tin Plating', 'Brass Plating']);
  for (const name of FLOORS[1].cacheFirstRollTable.map((e) => e[0])) {
    assert.equal(ITEMS_BY_NAME[name].category, 'plating');
  }
  // FLR-07 / CAT-07: the Blueprint is guaranteed in the floor 6 cache, in addition to the rolls.
  assert.deepEqual([...FLOORS[6].cacheExtra], ['Understudy Blueprint']);
  assert.deepEqual(ALL_FLOORS.filter((f) => f.cacheExtra).map((f) => f.number), [6]);
});

test('data/floors: nominal XP per floor equals FLR-10 @unit @m02', () => {
  const xpOf = (name) => ENEMIES_BY_NAME[name].xp;
  const packMean = (entry) => {
    const size = entry.size ?? ENEMIES_BY_NAME[entry.pack].packSize;
    return (size[0] + size[1]) / 2;
  };
  const nominal = ALL_FLOORS.map((floor) => {
    let xp = 0;
    for (const entry of floor.spawns) {
      xp += entry.pack ? packMean(entry) * xpOf(entry.pack) : entry.count * xpOf(entry.type);
    }
    if (floor.guard) xp += xpOf(floor.guard);
    if (floor.boss) {
      xp += xpOf(floor.boss.type);
      // BST-06's two summoned Unfinished are fixed and counted (FLR-09); BST-04's dancers are a
      // live cap of 4 and are excluded from the base figure (FLR-04).
      if (floor.boss.summonCount) xp += floor.boss.summonCount * xpOf(floor.boss.summonType);
    }
    return xp;
  });
  // M13: floor 4 gains a Rust-moth pack (DIF-07) and floors 5 and 7 a Magpie (DIF-11). WLD-14's
  // wanderers are *not* counted — they are a live stream, like the Conductor's dancers (FLR-10).
  assert.deepEqual(nominal, [15.5, 27, 33, 49, 50, 59, 64.5, 36]);
  assert.deepEqual(nominal, [...NOMINAL_XP.byFloor]);
  assert.equal(nominal.reduce((a, b) => a + b, 0), 334, 'FLR-10 total without the Conductor summons');
  const conductor = FLOORS[3].boss;
  assert.equal(conductor.summonCap * ENEMIES_BY_NAME[conductor.summonType].xp, 16, 'FLR-04 up to 16 summon XP');
  assert.equal(334 + 16, 350, 'FLR-10 total with the Conductor summons');
  assert.equal(NOMINAL_XP.total, 334);
  assert.equal(NOMINAL_XP.totalWithConductorSummons, 350);
  // CHR-06 wants >= 300 XP placed across a run (BAL-03).
  assert.ok(334 >= 300);
});

// ---------------------------------------------------------------------------------------
// ACC-132 — referential integrity across 21, 22, 23, 11/20 and the palette
// ---------------------------------------------------------------------------------------

test('ACC-132: every item named in a floor, cache, drop or extra table exists in data/items @m02', () => {
  const missing = [];
  for (const floor of ALL_FLOORS) {
    for (const [label, table] of floorTables(floor)) {
      for (const [name] of table) if (!ITEMS_BY_NAME[name]) missing.push(`${label}: ${name}`);
    }
    for (const name of floor.cacheExtra ?? []) {
      if (!ITEMS_BY_NAME[name]) missing.push(`floor ${floor.number} cacheExtra: ${name}`);
    }
  }
  for (const enemy of ENEMIES) {
    for (const [name] of enemy.dropTable) if (!ITEMS_BY_NAME[name]) missing.push(`${enemy.name} drop table: ${name}`);
  }
  assert.deepEqual(missing, []);
  // ITM-01: an item in floor N's floor or cache table must list N in its `floors`.
  const wrongFloor = [];
  for (const floor of ALL_FLOORS) {
    for (const [label, table] of floorTables(floor)) {
      for (const [name] of table) {
        if (!ITEMS_BY_NAME[name].floors.includes(floor.number)) wrongFloor.push(`${label}: ${name}`);
      }
    }
    for (const name of floor.cacheExtra ?? []) {
      if (!ITEMS_BY_NAME[name].floors.includes(floor.number)) wrongFloor.push(`floor ${floor.number} cacheExtra: ${name}`);
    }
  }
  assert.deepEqual(wrongFloor, [], 'ITM-01: floor and cache tables only name items whose `floors` include that floor');
});

test('ACC-132: every enemy named in a spawn list, guard or boss exists in data/enemies @m02', () => {
  const missing = [];
  for (const floor of ALL_FLOORS) {
    for (const entry of floor.spawns) {
      const name = entry.type ?? entry.pack;
      if (!ENEMIES_BY_NAME[name]) missing.push(`floor ${floor.number} spawns: ${name}`);
      else if (entry.pack && ENEMIES_BY_NAME[name].archetype !== 'SWARMER') {
        missing.push(`floor ${floor.number}: ${name} is not a SWARMER but is spawned as a pack`);
      }
    }
    if (floor.guard !== null && !ENEMIES_BY_NAME[floor.guard]) missing.push(`floor ${floor.number} guard: ${floor.guard}`);
    if (floor.boss) {
      if (!ENEMIES_BY_NAME[floor.boss.type]) missing.push(`floor ${floor.number} boss: ${floor.boss.type}`);
      if (floor.boss.summonType && !ENEMIES_BY_NAME[floor.boss.summonType]) {
        missing.push(`floor ${floor.number} boss summons: ${floor.boss.summonType}`);
      }
    }
  }
  assert.deepEqual(missing, []);
  // BST-02: an enemy on a floor's spawn list lists that floor; a cache guard may be any type.
  const wrongFloor = [];
  for (const floor of ALL_FLOORS) {
    for (const entry of floor.spawns) {
      const name = entry.type ?? entry.pack;
      if (!ENEMIES_BY_NAME[name].floors.includes(floor.number)) wrongFloor.push(`floor ${floor.number}: ${name}`);
    }
    if (floor.boss && !ENEMIES_BY_NAME[floor.boss.type].floors.includes(floor.number)) {
      wrongFloor.push(`floor ${floor.number} boss: ${floor.boss.type}`);
    }
  }
  assert.deepEqual(wrongFloor, []);
});

test('ACC-132: every skill named in 11/20 exists in data/skills @m02', () => {
  assert.deepEqual(SKILLS.map((s) => s.name), SPEC_SKILL_NAMES);
  for (const name of SPEC_SKILL_NAMES) assert.ok(SKILLS_BY_NAME[name], `${name} is missing from data/skills.js`);
  assert.equal(Object.keys(SKILLS_BY_NAME).length, SPEC_SKILL_NAMES.length);
});

test('ACC-132: every color named in data resolves in the palette (UI-08 + BST-01) @m02', () => {
  const unresolved = [];
  for (const item of ITEMS) if (!resolves(item.color)) unresolved.push(`item ${item.name}: ${item.color}`);
  for (const enemy of ENEMIES) if (!resolves(enemy.color)) unresolved.push(`enemy ${enemy.name}: ${enemy.color}`);
  assert.deepEqual(unresolved, []);
  // The palette itself is UI-08 verbatim: 24 names, all #rrggbb.
  assert.equal(Object.keys(PALETTE).length, 24);
  for (const [name, hex] of Object.entries(PALETTE)) {
    assert.match(hex, /^#[0-9a-f]{6}$/, `${name} is not a #rrggbb value`);
    assert.equal(resolve(name), hex);
  }
  assert.equal(PALETTE.bg, '#0c0c10');
  assert.equal(PALETTE.telegraph, '#ffffff');
  assert.equal(PALETTE_BG.telegraph, '#602020');
  assert.equal(resolve('#FFD75F'), '#ffd75f', 'literal hex is accepted and lowercased');
  assert.throws(() => resolve('chartreuse'), RangeError);
  // BST-01 adds nothing: every color the bestiary uses is already a UI-08 name.
  for (const enemy of ENEMIES) assert.ok(Object.prototype.hasOwnProperty.call(PALETTE, enemy.color));
});

// ---------------------------------------------------------------------------------------
// ACC-77 (static clause) — the handcrafted floor 8 map
// ---------------------------------------------------------------------------------------

test('ACC-77: the floor 8 fixed map is 24 x 60 in the WLD-13 legend with one @, U and C @m02', () => {
  const map = FLOORS[8].fixedMap;
  assert.equal(map.length, 24, 'FLR-09 / TEC-15: 24 rows');
  for (const row of map) assert.equal(row.length, 60, 'FLR-09 / TEC-15: 60 columns');

  const flat = map.join('');
  const legend = new Set(Object.keys(FIXED_MAP_LEGEND));
  const stray = [...new Set(flat)].filter((c) => !legend.has(c));
  assert.deepEqual(stray, [], 'only WLD-13 legend characters');

  const countOf = (ch) => flat.split(ch).length - 1;
  assert.equal(countOf('@'), 1, 'exactly one player start');
  assert.equal(countOf('U'), 1, 'exactly one Understudy tile');
  assert.equal(countOf('C'), 1, 'exactly one chair tile');
  assert.equal(countOf('1'), 1, 'marker 1 appears once');
  assert.equal(countOf('2'), 1, 'marker 2 appears once');
  assert.equal(countOf('+'), 1, 'the antechamber door');

  for (let x = 0; x < 60; x++) {
    assert.equal(map[0][x], '#', `top ring at x=${x}`);
    assert.equal(map[23][x], '#', `bottom ring at x=${x}`);
  }
  for (let y = 0; y < 24; y++) {
    assert.equal(map[y][0], '#', `left ring at y=${y}`);
    assert.equal(map[y][59], '#', `right ring at y=${y}`);
  }

  const at = (ch) => {
    for (let y = 0; y < 24; y++) {
      const x = map[y].indexOf(ch);
      if (x >= 0) return [x, y];
    }
    return null;
  };
  assert.deepEqual(at('@'), [5, 4], 'Tick starts at (5, 4)');
  assert.deepEqual(at('U'), [51, 5], 'the Understudy stands at (51, 5)');
  assert.deepEqual(at('+'), [11, 4], 'the antechamber door is at (11, 4)');
  assert.deepEqual(at('1'), [24, 18], 'marker 1 at (24, 18)');
  assert.deepEqual(at('2'), [50, 18], 'marker 2 at (50, 18)');
  assert.deepEqual(at('C'), [52, 4], "Aurelie's chair");
  // FLR-09: the pillars and the EEEE block are the only sight blockers inside the chamber.
  for (const [x, y] of [[27, 7], [46, 7], [27, 15], [46, 15]]) assert.equal(map[y][x], '#', `pillar (${x}, ${y})`);
  assert.equal(flat.split('E').length - 1, 12, 'the 4 x 3 Escapement wheel');
  // FLR-09: no stairs, no station, no cache, no floor items on floor 8.
  assert.equal(FLOORS[8].itemCount, 0);
  assert.deepEqual([...FLOORS[8].floorTable], []);
  assert.deepEqual([...FLOORS[8].cacheTable], []);
  assert.equal(FLOORS[8].guard, null);
  assert.ok(!flat.includes('<'), 'no up-stairs');
  assert.ok(!flat.includes('&'), 'no winding station');
});

// ---------------------------------------------------------------------------------------
// Script (24-script.md)
// ---------------------------------------------------------------------------------------

test('data/script: SCR-01..09 strings are present and correctly sized @unit @m02', () => {
  assert.equal(SCRIPT.title, 'CLOCKWORK HOLLOW');
  assert.equal(SCRIPT.tagline.length, 4, 'SCR-01: four tagline lines');
  assert.equal(SCRIPT.tagline[3], 'Climb.');
  assert.deepEqual([...SCRIPT.menu], ['New run', 'Continue', 'Enter seed', 'Help']);
  assert.equal(SCRIPT.descent.length, 7, 'SCR-07: the descent is seven lines');
  assert.equal(SCRIPT.descent[0], '7. The pendulum swings once more, and hangs.');
  assert.equal(SCRIPT.descent[6], '1. The workshop. Your bench. The screwdriver, second-best.');
  assert.equal(SCRIPT.help.length, 6, 'SCR-09');
  assert.deepEqual(Object.keys(SCRIPT.screens), ['broken', 'woundDown', 'keeper', 'walker']);
  assert.equal(SCRIPT.screens.broken.header, 'TICK WAS BROKEN');
  assert.equal(SCRIPT.screens.woundDown.header, 'TICK WOUND DOWN');
  assert.equal(SCRIPT.screens.keeper.header, 'THE KEEPER');
  assert.equal(SCRIPT.screens.walker.header, 'THE WALKER');
  assert.equal(SCRIPT.screens.keeper.flavor, SCRIPT.screens.walker.flavor);
  assert.ok(words(SCRIPT.intro) <= 180, `SCR-02 intro is ${words(SCRIPT.intro)} words`);
  assert.deepEqual(Object.keys(SCRIPT.moments), ['1', '2', '3a', '3b']);
});

test('data/script: the journal pages are 110-170 words and signed, except page 8 (SCR-03) @unit @m02', () => {
  const problems = [];
  for (let n = 1; n <= 8; n++) {
    const page = SCRIPT.pages[n];
    assert.equal(typeof page, 'string', `page ${n} exists`);
    const count = words(page);
    if (count < 110 || count > 170) problems.push(`page ${n}: ${count} words`);
    if (n === 8) {
      if (page.includes('— A.V.')) problems.push('page 8 must not be signed (SCR-03: the last line is left ragged)');
    } else if (!page.endsWith('\n\n— A.V.')) {
      problems.push(`page ${n} must end with the signature`);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(SCRIPT.pages[8].endsWith('then it is the one who'), 'page 8 ends mid-sentence');
});

test("data/script: the Understudy's four lines are SCR-06 verbatim @unit @m02", () => {
  assert.deepEqual(Object.keys(SCRIPT.understudy), ['1', '2', '3', '4']);
  assert.equal(SCRIPT.understudy[4], 'Turn it, then. Someone has to.');
  assert.equal(SCRIPT.understudy[2], 'You fight the way she taught the soldiers to. She was not a soldier.');
  assert.equal(
    SCRIPT.understudy[3],
    'I am running down. So are you. Tell me what you would do with a heart, first attempt.',
  );
  assert.ok(SCRIPT.understudy[1].startsWith('Tick. She wrote about you.'));
  for (const line of Object.values(SCRIPT.understudy)) {
    assert.ok(!line.startsWith('"') && !line.endsWith('"'), 'the table quotes are not part of the line');
  }
  // SCR-05: the defeat line is quoted inside moment 3's first text box.
  assert.ok(SCRIPT.moments['3a'].includes(`"${SCRIPT.understudy[4]}"`));
});

test('data/script: the SCR-10 log templates use only the documented placeholders @unit @m02', () => {
  const allowed = new Set(['{A}', '{D}', '{n}', '{X}', '{status}', '{floor name}']);
  const problems = [];
  for (const [key, template] of Object.entries(SCRIPT.log)) {
    assert.equal(typeof template, 'string', `log.${key}`);
    for (const found of template.match(/\{[^}]*\}/g) ?? []) {
      if (!allowed.has(found)) problems.push(`log.${key}: ${found}`);
    }
  }
  assert.deepEqual(problems, []);
  assert.equal(SCRIPT.log.hit, '{A} hits {D} for {n}.');
  assert.equal(SCRIPT.log.enemyBroken, 'The {D} breaks.');
  assert.equal(SCRIPT.log.station, 'Tick winds the spring. Tension {n}.');
  assert.equal(SCRIPT.log.stationSpent, 'This station has run down.');
  assert.equal(SCRIPT.log.stairs, 'Tick climbs. Floor {n}: {floor name}.');
  assert.equal(SCRIPT.log.levelUp, 'Tick feels a new gear catch. Level {n}.');
  assert.equal(SCRIPT.log.tensionLoosening, 'The spring is loosening.');
  assert.equal(SCRIPT.log.tensionNearlySlack, "Tick's spring is nearly slack.");
  assert.equal(SCRIPT.log.journalPage, 'Tick finds a page in her hand. (Journal, page {n})');
  assert.equal(SCRIPT.log.blueprint, 'Tick unfolds a drawing. (Journal, Blueprint)');
});

// ---------------------------------------------------------------------------------------
// PLN-02 R3 — the exported tables are deeply frozen plain data
// ---------------------------------------------------------------------------------------

test('data/*: every exported table is deeply frozen plain data (PLN-02 R3) @unit @m02', () => {
  const problems = [];
  const roots = {
    PALETTE,
    PALETTE_BG,
    ITEMS,
    ITEMS_BY_NAME,
    ENEMIES,
    ENEMIES_BY_NAME,
    SKILLS,
    SKILLS_BY_NAME,
    FLOORS,
    FIXED_MAP_LEGEND,
    NOMINAL_XP,
    SCRIPT: SCRIPT.SCRIPT,
  };
  for (const [name, value] of Object.entries(roots)) unfrozen(value, name, problems);
  assert.deepEqual(problems, []);
  const seenFunctions = [];
  const walk = (value, path) => {
    if (typeof value === 'function') seenFunctions.push(path);
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
  };
  for (const [name, value] of Object.entries(roots)) walk(value, name);
  assert.deepEqual(seenFunctions, [], 'data holds no callables');
});
