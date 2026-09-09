// The eight floors (23-floors.md), shaped per TEC-03 `FloorDef`.
//
// Transcription notes (logged in specs/DECISIONS.md):
//  - Loot tables are `[itemName, weight]` pairs in the order 23 writes them; ITM-10 walks them in
//    that order, so the order is part of the data.
//  - A spawn entry is `{type, count}` for individuals or `{pack, size?}` for one SWARMER pack;
//    `size` overrides the bestiary's `packSize` for that entry (FLR-01).
//  - Floor 8 is handcrafted (FLR-09): no cache, so `guard` is `null`; its boss stands on the map's
//    `U` marker rather than in a stairs room, so `boss.room` is `'fixed'` (D-020).
//  - `boss.summonType` / `summonCount` / `summonCap` carry the summons BST-04 and BST-06 script, so
//    the FLR-10 XP arithmetic can be recomputed from data (D-021). The Conductor's dancers are a
//    live cap and are excluded from the nominal totals; the Understudy's two Unfinished are fixed
//    and are included.
//  - Floor 8 still names `journalPage: 8`, the page the ending sequence delivers (SCR-07); there is
//    no journal room on it (D-022).

/**
 * FLR-09's map, verbatim: 60 columns × 24 rows in the WLD-13 legend.
 * `@` Tick's start (5, 4) · `+` the antechamber door (11, 4) · `U` the Understudy (51, 5) ·
 * `C` Aurelie's chair (52, 4) · `E` the Escapement wheel · `1` `2` the two Unfinished.
 */
const FLOOR_8_MAP = Object.freeze([
  '############################################################',
  '#..........#################################################',
  '#..........###########................................######',
  '#..........##########..................................#####',
  '#....@.....+........................................C...####',
  '#..........########................................U.....###',
  '#..........#######........................................##',
  '##################.........#..................#...........##',
  '##################........................................##',
  '##################........................................##',
  '##################..................EEEE..................##',
  '##################..................EEEE..................##',
  '##################..................EEEE..................##',
  '##################........................................##',
  '##################........................................##',
  '##################.........#..................#...........##',
  '##################........................................##',
  '##################........................................##',
  '###################.....1.........................2......###',
  '####################....................................####',
  '#####################..................................#####',
  '######################................................######',
  '############################################################',
  '############################################################',
]);

/**
 * Floors 1–8, indexed by floor number: `FLOORS[n]` is floor `n` (PLN-06 M02, D-029).
 * Index 0 is `null` so that a 0-based mistake fails loudly instead of returning floor 1.
 * Iterate with `FLOORS.slice(1)`.
 * @type {readonly (object|null)[]}
 */
export const FLOORS = Object.freeze([
  null,
  // ---- FLR-02 Floor 1 — The Workshop ----------------------------------------------------
  Object.freeze({
    number: 1,
    name: 'The Workshop',
    shortName: 'Workshop',
    roomTarget: 7,
    extraCorridors: 1,
    doorChance: 60,
    hazards: Object.freeze([]),
    itemCount: 3,
    floorTable: Object.freeze([
      Object.freeze(['Solder', 6]),
      Object.freeze(['Spring-Key', 4]),
      Object.freeze(['Tin Plating', 3]),
      Object.freeze(['Mallet', 3]),
      Object.freeze(['Grit Bomb', 2]),
      Object.freeze(['Balance Wheel', 1]),
    ]),
    cacheCount: Object.freeze([2, 3]),
    cacheFirstRollTable: Object.freeze([
      Object.freeze(['Tin Plating', 1]),
      Object.freeze(['Brass Plating', 1]),
    ]),
    cacheTable: Object.freeze([
      Object.freeze(['Mallet', 3]),
      Object.freeze(['Balance Wheel', 2]),
      Object.freeze(['Solder', 3]),
      Object.freeze(['Spring-Key', 3]),
      Object.freeze(['Grit Bomb', 1]),
    ]),
    spawns: Object.freeze([
      Object.freeze({ pack: 'Rust-moth', size: Object.freeze([3, 4]) }),
      Object.freeze({ type: 'Sweeper', count: 3 }),
    ]),
    guard: 'Sweeper',
    journalPage: 1,
  }),

  // ---- FLR-03 Floor 2 — The Gear Gallery ------------------------------------------------
  Object.freeze({
    number: 2,
    name: 'The Gear Gallery',
    shortName: 'Gallery',
    roomTarget: 8,
    extraCorridors: 2,
    doorChance: 60,
    hazards: Object.freeze([Object.freeze({ kind: 'GRINDING_GEAR', count: 6 })]),
    itemCount: 4,
    floorTable: Object.freeze([
      Object.freeze(['Solder', 6]),
      Object.freeze(['Spring-Key', 5]),
      Object.freeze(['Cog Saw', 2]),
      Object.freeze(['Spring-Bolt Launcher', 2]),
      Object.freeze(['Brass Plating', 2]),
      Object.freeze(['Counterweight', 1]),
      Object.freeze(['Oil Flask', 2]),
      Object.freeze(['Clatter Can', 2]),
    ]),
    cacheCount: Object.freeze([2, 3]),
    cacheTable: Object.freeze([
      Object.freeze(['Cog Saw', 3]),
      Object.freeze(['Spring-Bolt Launcher', 3]),
      Object.freeze(['Brass Plating', 3]),
      Object.freeze(['Counterweight', 2]),
      Object.freeze(['Balance Wheel', 2]),
      Object.freeze(['Spring-Key', 2]),
    ]),
    spawns: Object.freeze([
      Object.freeze({ type: 'Sweeper', count: 2 }),
      Object.freeze({ type: 'Spring-Hound', count: 1 }),
      Object.freeze({ type: 'Tin Soldier', count: 1 }),
      Object.freeze({ pack: 'Rust-moth' }),
    ]),
    guard: 'Tin Soldier',
    journalPage: 2,
  }),

  // ---- FLR-04 Floor 3 — The Music Room --------------------------------------------------
  Object.freeze({
    number: 3,
    name: 'The Music Room',
    shortName: 'Music Room',
    roomTarget: 8,
    extraCorridors: 2,
    doorChance: 70,
    hazards: Object.freeze([]),
    itemCount: 4,
    floorTable: Object.freeze([
      Object.freeze(['Solder', 5]),
      Object.freeze(['Spring-Key', 5]),
      Object.freeze(['Tuning Fork', 2]),
      Object.freeze(['Iron Plating', 2]),
      Object.freeze(['Oil Flask', 2]),
      Object.freeze(['Grit Bomb', 2]),
      Object.freeze(['Cog Saw', 1]),
      Object.freeze(['Oil Reservoir', 1]),
    ]),
    cacheCount: Object.freeze([2, 3]),
    cacheTable: Object.freeze([
      Object.freeze(['Iron Plating', 3]),
      Object.freeze(['Oil Reservoir', 2]),
      Object.freeze(['Spring-Bolt Launcher', 2]),
      Object.freeze(['Tuning Fork', 2]),
      Object.freeze(['Solder', 2]),
      Object.freeze(['Spring-Key', 2]),
      Object.freeze(['Balance Wheel', 1]),
    ]),
    spawns: Object.freeze([
      Object.freeze({ type: 'Music-box Dancer', count: 1 }),
      Object.freeze({ type: 'Cuckoo', count: 1 }),
      Object.freeze({ type: 'Sweeper', count: 1 }),
      Object.freeze({ pack: 'Rust-moth' }),
    ]),
    guard: 'Tin Soldier',
    boss: Object.freeze({
      type: 'The Conductor',
      room: 'stairs',
      summonType: 'Music-box Dancer',
      summonCap: 4,
    }),
    journalPage: 3,
  }),

  // ---- FLR-05 Floor 4 — The Furnace Deck ------------------------------------------------
  Object.freeze({
    number: 4,
    name: 'The Furnace Deck',
    shortName: 'Furnace',
    roomTarget: 8,
    extraCorridors: 2,
    doorChance: 50,
    hazards: Object.freeze([Object.freeze({ kind: 'STEAM_VENT', count: 10 })]),
    itemCount: 4,
    floorTable: Object.freeze([
      Object.freeze(['Solder', 5]),
      Object.freeze(['Spring-Key', 5]),
      Object.freeze(['Flux', 2]),
      Object.freeze(['Escapement Blade', 2]),
      Object.freeze(['Iron Plating', 2]),
      Object.freeze(['Oil Reservoir', 1]),
      Object.freeze(['Grit Bomb', 1]),
      Object.freeze(['Clatter Can', 1]),
    ]),
    cacheCount: Object.freeze([2, 3]),
    cacheTable: Object.freeze([
      Object.freeze(['Escapement Blade', 3]),
      Object.freeze(['Iron Plating', 2]),
      Object.freeze(['Oil Reservoir', 2]),
      Object.freeze(['Counterweight', 1]),
      Object.freeze(['Flux', 2]),
      Object.freeze(['Spring-Key', 2]),
      Object.freeze(['Solder', 2]),
    ]),
    spawns: Object.freeze([
      Object.freeze({ type: 'Stoker', count: 2 }),
      Object.freeze({ type: 'Gear-Golem', count: 1 }),
      Object.freeze({ type: 'Spring-Hound', count: 1 }),
      Object.freeze({ type: 'Sweeper', count: 2 }),
    ]),
    guard: 'Tin Soldier',
    journalPage: 4,
  }),

  // ---- FLR-06 Floor 5 — The Aviary ------------------------------------------------------
  Object.freeze({
    number: 5,
    name: 'The Aviary',
    shortName: 'Aviary',
    roomTarget: 9,
    extraCorridors: 3,
    doorChance: 40,
    hazards: Object.freeze([]),
    itemCount: 4,
    floorTable: Object.freeze([
      Object.freeze(['Solder', 5]),
      Object.freeze(['Spring-Key', 5]),
      Object.freeze(['Harmonic Rifle', 2]),
      Object.freeze(['Pendulum Flail', 1]),
      Object.freeze(['Steel Plating', 1]),
      Object.freeze(['Lacquered Plating', 2]),
      Object.freeze(['Sounding Plate', 1]),
      Object.freeze(['Tuning Fork', 2]),
      Object.freeze(['Grit Bomb', 2]),
    ]),
    cacheCount: Object.freeze([2, 3]),
    cacheTable: Object.freeze([
      Object.freeze(['Harmonic Rifle', 3]),
      Object.freeze(['Steel Plating', 2]),
      Object.freeze(['Lacquered Plating', 2]),
      Object.freeze(['Sounding Plate', 2]),
      Object.freeze(['Pendulum Flail', 2]),
      Object.freeze(['Spring-Key', 2]),
      Object.freeze(['Solder', 2]),
    ]),
    spawns: Object.freeze([
      Object.freeze({ type: 'Cuckoo', count: 3 }),
      Object.freeze({ pack: 'Brass Finch' }),
      Object.freeze({ pack: 'Brass Finch' }),
      Object.freeze({ type: 'Spring-Hound', count: 1 }),
    ]),
    guard: 'Tin Soldier',
    journalPage: 5,
  }),

  // ---- FLR-07 Floor 6 — The Archive -----------------------------------------------------
  Object.freeze({
    number: 6,
    name: 'The Archive',
    shortName: 'Archive',
    roomTarget: 9,
    extraCorridors: 1,
    doorChance: 80,
    hazards: Object.freeze([]),
    itemCount: 4,
    floorTable: Object.freeze([
      Object.freeze(['Solder', 5]),
      Object.freeze(['Spring-Key', 5]),
      Object.freeze(['Flux', 2]),
      Object.freeze(['Piston Hammer', 1]),
      Object.freeze(['Escapement Blade', 2]),
      Object.freeze(['Steel Plating', 2]),
      Object.freeze(['Oil Flask', 2]),
      Object.freeze(['Clatter Can', 2]),
      Object.freeze(['Sounding Plate', 1]),
    ]),
    cacheCount: Object.freeze([2, 3]),
    cacheTable: Object.freeze([
      Object.freeze(['Piston Hammer', 3]),
      Object.freeze(['Steel Plating', 2]),
      Object.freeze(['Lacquered Plating', 2]),
      Object.freeze(['Harmonic Rifle', 2]),
      Object.freeze(['Flux', 2]),
      Object.freeze(['Solder', 2]),
      Object.freeze(['Spring-Key', 2]),
    ]),
    cacheExtra: Object.freeze(['Understudy Blueprint']),
    spawns: Object.freeze([
      Object.freeze({ type: 'The Unfinished', count: 1 }),
      Object.freeze({ type: 'Archivist', count: 2 }),
      Object.freeze({ type: 'Tin Soldier', count: 1 }),
      Object.freeze({ pack: 'Rust-moth' }),
    ]),
    guard: 'Pendulum Knight',
    boss: Object.freeze({ type: 'The Regulator', room: 'stairs' }),
    journalPage: 6,
  }),

  // ---- FLR-08 Floor 7 — The Pendulum Stair ----------------------------------------------
  Object.freeze({
    number: 7,
    name: 'The Pendulum Stair',
    shortName: 'Stair',
    roomTarget: 8,
    extraCorridors: 3,
    doorChance: 50,
    hazards: Object.freeze([
      Object.freeze({ kind: 'PENDULUM_BAND' }),
      Object.freeze({ kind: 'GRINDING_GEAR', count: 4 }),
    ]),
    itemCount: 5,
    floorTable: Object.freeze([
      Object.freeze(['Solder', 6]),
      Object.freeze(['Spring-Key', 6]),
      Object.freeze(['Flux', 2]),
      Object.freeze(['Piston Hammer', 1]),
      Object.freeze(['Pendulum Flail', 1]),
      Object.freeze(['Steel Plating', 1]),
      Object.freeze(['Lacquered Plating', 1]),
      Object.freeze(['Oil Flask', 2]),
      Object.freeze(['Grit Bomb', 2]),
      Object.freeze(['Tuning Fork', 2]),
    ]),
    cacheCount: Object.freeze([2, 3]),
    cacheTable: Object.freeze([
      Object.freeze(['Piston Hammer', 2]),
      Object.freeze(['Pendulum Flail', 2]),
      Object.freeze(['Steel Plating', 2]),
      Object.freeze(['Harmonic Rifle', 1]),
      Object.freeze(['Flux', 2]),
      Object.freeze(['Spring-Key', 3]),
      Object.freeze(['Solder', 3]),
    ]),
    spawns: Object.freeze([
      Object.freeze({ type: 'Pendulum Knight', count: 1 }),
      Object.freeze({ type: 'Stoker', count: 1 }),
      Object.freeze({ type: 'Cuckoo', count: 1 }),
      Object.freeze({ type: 'Music-box Dancer', count: 1 }),
      Object.freeze({ type: 'The Unfinished', count: 1 }),
      Object.freeze({ pack: 'Brass Finch' }),
    ]),
    guard: 'Pendulum Knight',
    journalPage: 7,
  }),

  // ---- FLR-09 Floor 8 — The Escapement (handcrafted) ------------------------------------
  Object.freeze({
    number: 8,
    name: 'The Escapement',
    shortName: 'Escapement',
    roomTarget: 0,
    extraCorridors: 0,
    doorChance: 0,
    hazards: Object.freeze([]),
    itemCount: 0,
    floorTable: Object.freeze([]),
    cacheCount: Object.freeze([0, 0]),
    cacheTable: Object.freeze([]),
    spawns: Object.freeze([Object.freeze({ type: 'The Unfinished', count: 2 })]),
    guard: null,
    boss: Object.freeze({
      type: 'The Understudy',
      room: 'fixed',
      summonType: 'The Unfinished',
      summonCount: 2,
    }),
    journalPage: 8,
    fixedMap: FLOOR_8_MAP,
  }),
]);

/** WLD-13's legend — the only characters `fixedMap` may contain. */
export const FIXED_MAP_LEGEND = Object.freeze({
  '#': 'Wall',
  '.': 'Floor',
  '+': 'Closed door',
  '@': 'Player start (Floor beneath)',
  'U': "The Understudy's start tile (Floor beneath)",
  'C': 'Chair tile (drawn h)',
  'E': 'Escapement wheel tile (drawn O)',
  '1': 'Enemy spawn marker',
  '2': 'Enemy spawn marker',
  '3': 'Enemy spawn marker',
  '4': 'Enemy spawn marker',
  '5': 'Enemy spawn marker',
  '6': 'Enemy spawn marker',
  '7': 'Enemy spawn marker',
  '8': 'Enemy spawn marker',
  '9': 'Enemy spawn marker',
  '~': 'Pendulum Sweep hazard',
});

/** FLR-10's nominal XP per floor, and the totals it derives from them. */
export const NOMINAL_XP = Object.freeze({
  byFloor: Object.freeze([15.5, 27, 33, 45, 44, 59, 58.5, 36]),
  conductorSummons: 16,
  total: 318,
  totalWithConductorSummons: 334,
});

/** WLD-08's hazard kinds, as they appear in `FloorDef.hazards`. */
export const HAZARD_KINDS = Object.freeze(['GRINDING_GEAR', 'STEAM_VENT', 'PENDULUM_BAND']);
