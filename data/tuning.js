// The difficulty knobs of `50-difficulty-plan.md` (DIF-02), in one frozen object.
//
// **Every number M13 introduces or moves lives here**, with a comment naming the rule it feeds.
// Engine modules read it through `ctx.tuning` (which is `state.tuning`, a TEC-05 field, so a save
// restores the run with the numbers it was played under); `createGame({ tuning })` merges a partial
// override over these defaults, and `tools/sim.js --tuning` / `--tuning-file` pass one through.
// That is what makes the DIF-15 balancing ladder a data loop rather than a code loop.
//
// The rule for M13 and after: **no difficulty number is a literal in `src/`**. `test/meta/tuning
// .test.js` asserts every key below is read somewhere under `src/`.
//
// This module is data (PLN-02 R3): no functions, no logic.

/** @type {Readonly<Record<string, number>>} the DIF-02 defaults. */
export const TUNING = Object.freeze({
  // Several of the values below are the DIF-15 ladder's result rather than DIF-02's opening
  // numbers; every move is one row of `specs/BALANCE-CHANGELOG.md` (B-005 … B-013), measured
  // before and after.
  //
  // DIF-03 healing
  solderAmount: 50, // CAT-06 Solder total, spread over `solderTurns` (B-006)
  solderTurns: 3, // CAT-06 turns the repair takes
  solderTension: 5, // CAT-06 Tension paid to start a repair
  springKeyAmount: 30, // CAT-06
  fluxAmount: 5, // CAT-06
  efficientSolderBonus: 15, // SKL-03 Efficient Springs (B-006)
  efficientKeyBonus: 10, // SKL-03 (was +15)
  efficientFluxBonus: 5, // SKL-03 (unchanged by DIF-03, surfaced for the ladder)
  stackMax: 4, // ITM-03 (was 5; B-009)
  // DIF-15 ladder knob 1: every Solder and Spring-Key weight in every floor and cache table is
  // scaled by this percentage at generation (ITM-10), rounded, never below 1. 100 is the DIF-04
  // table as written.
  consumableWeight: 300, // B-005
  // DIF-05 station
  stationNoise: 20, // CHR-05
  stationRestore: 85, // CHR-05 (B-010)
  // DIF-06 wanderers
  wanderInterval: 50, // WLD-14 turns between wanderer spawns (floors 1-3 run slower)
  wanderCap: 4, // WLD-14 per floor (B-008)
  // DIF-07 rust
  corrosionChance: 10, // BST-02 Rust-moth (B-007)
  eliteCorrosionChance: 50, // BST-02 an Overwound Rust-moth
  // DIF-08 elites
  eliteChance: 8, // ENM-12 percent of regular spawns (B-007)
  eliteIntegrityMult: 1.5, // ENM-12 Integrity multiplier, rounded up
  eliteAccuracyBonus: 10, // ENM-12 accuracy, in CMB-06's points
  eliteDamageBonus: 2, // ENM-12 flat damage on every attack, before Plating
  eliteXpMult: 2, // ENM-12 XP multiplier (CHR-06)
  // DIF-09 progression
  levelUpIntegrity: 3, // CHR-07 (was 4; B-009)
  // DIF-10 pursuit
  memoryTurns: 25, // ENM-05 (was 8)
  rallyTurns: 20, // ENM-13 Cuckoo shriek makes Guards chase
  houndRange: 12, // ENM-13 a woken Spring-Hound hunts by sound out to this range
  // DIF-12 cache
  cacheLockCost: 10, // WLD-15 (B-008)
  // existing, surfaced here so the ladder can reach them
  decayPeriod: 5, // CHR-04
});

/**
 * WLD-14: the floors that run the wanderer schedule on their own clock. Floor 1 is the tutorial
 * floor and floor 2 the one a first run is still learning on, so both are slower than
 * `tuning.wanderInterval`; floor 8 spawns none at all (its `wanderTable` is empty).
 *
 * The floor-2 override is DIF-15 step 2's remedy for "median death floor of losses < 5" (B-011).
 */
export const WANDER_FLOOR_INTERVAL = Object.freeze({ 1: 90, 2: 70, 3: 60 });

/** Every key of `TUNING`, for the merge in `engine.js` and for `test/meta/tuning.test.js`. */
export const TUNING_KEYS = Object.freeze(Object.keys(TUNING));
