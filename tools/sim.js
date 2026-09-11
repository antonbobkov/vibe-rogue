// The BAL-07 balance simulation (PLN-06 M11).
//
//   node tools/sim.js S4 --seeds 200 --json      one check
//   node tools/sim.js --all --seeds 200          every check, S1..S6
//   node tools/sim.js --all --strict             fail on a BALANCE_SKIPS check too
//   npm run sim                                  the CI job: --all --seeds 200
//
// Every check is `31-balance.md` § BAL-07: an id, a bot, and a target. This file owns the driver
// (the loop that turns a bot policy into a run) and the aggregation; `tools/bots/*.js` own the
// policies. Nothing here is random — the seeds are a fixed list and every roll comes from the
// engine's seeded play RNG, so two invocations with the same `--seeds` report the same numbers
// (PLN-02 R6).
//
// `tools/` may use timers (PLN-06 M03), so the runtime is reported; no target depends on it.

import fs from 'node:fs';
import { createGame } from '../src/engine.js';
import * as s1 from './bots/s1-generation.js';
import * as s6 from './bots/s6-loot.js';
import { createBot as createS2 } from './bots/s2-clock.js';
import { createBot as createS3 } from './bots/s3-melee.js';
import { createBot as createS4 } from './bots/s4-explorer.js';

/** The full 200-seed sweep BAL-07 asks for; `dod` runs the same checks over 50. */
export const FULL_SEEDS = 200;

/** How many actions a single run may take before it is abandoned as stuck. */
export const MAX_ACTIONS = 8000;

/**
 * The checks whose target is an accepted, logged miss (PLN-07.2 step 4): the balance protocol was
 * applied, every knob was measured, none moved the number into the band, and the single test that
 * asserts it is marked `skip` in `test/integration/sim.test.js` with the same message. They are
 * reported as SKIP, printed with their numbers, and do not fail the process — `--strict` makes them
 * fail, which is how the miss gets re-measured deliberately.
 *
 * Never add an entry here without the matching `specs/BALANCE-CHANGELOG.md` rows.
 *
 * **It is empty**, and DIF-17 requires it to stay empty: M13 walked the DIF-15 ladder and put S4
 * back inside its band. The one DIF-01 target the ladder could not reach — the median death floor
 * of S4's losses — is reported as a `gaps` entry on the check rather than as a skipped check, so
 * the number is printed, explained (B-014) and asserted in `sim.test.js` rather than hidden.
 */
export const BALANCE_SKIPS = Object.freeze({});

/**
 * DIF-01 targets that the DIF-15 ladder could not reach, with the changelog row that explains why.
 * A gap is printed with the check and does not fail the process; the matching `sim.test.js`
 * assertion pins the measured number so it can never quietly get worse.
 */
export const BALANCE_GAPS = Object.freeze({
  S4: Object.freeze([
    'median death floor of losses is 3, not 5-7: floors 1-3 are where the M13 pressure lands ' +
      'hardest on a bot that fights everything; see specs/BALANCE-CHANGELOG.md B-014',
  ]),
});

/**
 * BAL-07's target bands, as DIF-01 restates them for M13. They are here rather than inline so the
 * DIF-15 ladder, `test/integration/sim.test.js` and `31-balance.md` all read one set of numbers.
 */
export const S2_BAND = Object.freeze([40, 70]);
export const S3_BAND = Object.freeze([2, 4]);
export const S4_WIN_BAND = Object.freeze([30, 60]);
export const S4_FLOOR_BAND = Object.freeze([5, 7]);

/**
 * The floor S4's median loss must at least reach. DIF-01 asks for 5-7; the DIF-15 ladder got it to
 * 3 and no knob moved it further (B-014), so the check pins the measured number — a regression that
 * pushed deaths back to floor 2 would fail, and reaching DIF-01's band would not.
 */
export const S4_FLOOR_FLOOR = 3;
export const S4_WOUND_BAND = Object.freeze([20, 40]);
export const S4_TOP_CAUSE_MAX = 40;
export const S5_BAND = Object.freeze([7, 9]);

/** A run's outcomes. `stuck` is a bot failure, never a balance result — it must stay at zero. */
export const OUTCOME = Object.freeze({ WIN: 'win', DEATH: 'death', STOPPED: 'stopped', STUCK: 'stuck' });

/**
 * The seed of run `i`. Fixed strings so `--seeds 50` is a prefix of `--seeds 200` and the numbers
 * a smaller sweep reports are the numbers the big one reports for those seeds.
 */
export function seedFor(i) {
  return `SIM${String(i).padStart(4, '0')}`;
}

/** The first `n` seeds. */
export function seedList(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(seedFor(i));
  return out;
}

// -----------------------------------------------------------------------------------------------
// The driver: one bot policy, one seed, one run
// -----------------------------------------------------------------------------------------------

/**
 * Play one run.
 *
 * @param {object} bot a policy from `tools/bots/*.js`
 * @param {string} seedString
 * @param {{maxActions?: number, ending?: 'A'|'B', trace?: boolean, tuning?: object}} [opts]
 *        `tuning` is DIF-02's partial override, passed straight to `createGame`.
 * @returns {{seed: string, outcome: string, turns: number, actions: number, floorsReached: number,
 *            deathFloor: number|null, wound: boolean, level: number, enemiesBroken: number,
 *            skills: string[], springKeysUsed: number, floor8: object|null,
 *            minTension: number, everWoundDown: boolean, floorArrivals: object[]}}
 */
export function runBot(bot, seedString, opts = {}) {
  const maxActions = opts.maxActions ?? MAX_ACTIONS;
  const ending = opts.ending || 'A';
  const game = createGame({ seedString, intro: false, tuning: opts.tuning });
  const state = game.state;

  let floorNumber = state.floorNumber;
  const floorArrivals = [];
  const arrival = () => ({
    floor: state.floorNumber,
    turn: state.turn,
    tension: state.tick.tension,
    integrity: state.tick.integrity,
    integrityMax: state.tick.integrityMax,
    level: state.tick.level,
    xp: state.tick.xp,
  });
  floorArrivals.push(arrival());
  if (bot.onFloorEntered) bot.onFloorEntered(game);

  let actions = 0;
  let idle = 0;
  let refusals = 0;
  /** Actions refused since the last turn actually advanced (see the loop below). */
  const refused = new Set();
  let minTension = state.tick.tension;
  let everWoundDown = false;
  let springKeysUsed = 0;
  let solderUsed = 0;

  while (actions < maxActions) {
    const phase = game.phase;
    if (phase === 'ended') break;
    if (phase === 'awaitDismiss') {
      game.act({ type: 'dismiss' });
      continue;
    }
    if (phase === 'awaitChoice') {
      game.act({ type: 'choose', option: ending });
      continue;
    }

    // CHR-07: spend the point the moment it lands, in the bot's build order (CHR-09).
    if (state.tick.skillPoints > 0 && bot.build && bot.build.length > 0) {
      const next = bot.build.find((name) => !state.tick.skills.includes(name));
      if (next) {
        const taken = game.act({ type: 'takeSkill', name: next });
        if (taken.ok) continue;
      }
    }

    let action = bot.decide(game);
    if (!action) {
      idle += 1;
      if (idle > 40) {
        return finish(OUTCOME.STUCK);
      }
      action = { type: 'wait' };
    } else {
      idle = 0;
    }

    // A refusal spends no turn (CMB-05), so a bot that proposes the same refused action forever
    // would spin without the clock ever moving. Anything already refused since the last turn is
    // replaced by a Wait, which always costs a turn — the run then always terminates.
    if (refused.has(actionKey(action))) action = { type: 'wait' };
    if (action.type === 'use' && state.tick.inventory[action.slot]?.name === 'Spring-Key') springKeysUsed += 1;
    if (action.type === 'use' && state.tick.inventory[action.slot]?.name === 'Solder') solderUsed += 1;

    const result = game.act(action);
    actions += 1;
    if (!result.ok) {
      refusals += 1;
      refused.add(actionKey(action));
      // CMB-04: while Stunned the only legal action is Wait.
      if (result.reason === 'stunned') game.act({ type: 'wait' });
    } else {
      refusals = 0;
      refused.clear();
    }
    if (bot.afterAction) bot.afterAction(game);

    if (state.tick.tension < minTension) minTension = state.tick.tension;
    if (state.tick.tension <= 0) everWoundDown = true;

    if (state.floorNumber !== floorNumber) {
      floorNumber = state.floorNumber;
      floorArrivals.push(arrival());
      if (bot.onFloorEntered) bot.onFloorEntered(game);
      if (bot.stopOnFloor && floorNumber >= bot.stopOnFloor) return finish(OUTCOME.STOPPED);
    }
  }

  if (state.victory) return finish(OUTCOME.WIN);
  if (state.dead) return finish(OUTCOME.DEATH);
  return finish(OUTCOME.STUCK);

  function finish(outcome) {
    const resolved =
      outcome === OUTCOME.STOPPED || outcome === OUTCOME.STUCK
        ? outcome
        : state.victory
          ? OUTCOME.WIN
          : state.dead
            ? OUTCOME.DEATH
            : outcome;
    return {
      seed: seedString,
      outcome: resolved,
      turns: state.turn,
      actions,
      floorsReached: state.stats.floorsReached,
      deathFloor: state.dead ? state.dead.floor : null,
      wound: state.dead ? state.dead.wound === true : false,
      cause: state.dead ? state.dead.cause : null,
      level: state.tick.level,
      enemiesBroken: state.stats.enemiesBroken,
      skills: state.tick.skills.slice(),
      springKeysUsed,
      solderUsed,
      // DIF-15 step 0: the three run-record fields the ladder's tables are built from.
      wanderersSpawned: state.stats.wanderersSpawned || 0,
      itemsStolen: state.stats.itemsStolen || 0,
      deathCause: deathCause(state),
      minTension,
      everWoundDown,
      floor8: floorArrivals.find((a) => a.floor === 8) || null,
      floorArrivals,
    };
  }
}

// -----------------------------------------------------------------------------------------------
// Statistics
// -----------------------------------------------------------------------------------------------

/**
 * DIF-15's death-cause bucket: `wound-down` for CMB-12's Tension death, the hazard's or the
 * enemy type's own name otherwise, and `null` for a run that did not end in a death.
 */
export function deathCause(state) {
  if (!state.dead) return null;
  return state.dead.wound === true ? 'wound-down' : state.dead.cause;
}

/** A `{value: count}` histogram, for DIF-15's death-cause table. */
export function histogramOf(values) {
  const out = {};
  for (const v of values) {
    const key = v === null || v === undefined ? 'unknown' : String(v);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/** DIF-01: the share of the largest single bucket, as a percentage — "no one-enemy game". */
export function topShare(values) {
  if (values.length === 0) return 0;
  const counts = Object.values(histogramOf(values));
  return Math.round((Math.max(...counts) / values.length) * 10000) / 100;
}

export function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** The lower median (the ⌈n/2⌉-th smallest) — a whole data point, never an average of two. */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

// -----------------------------------------------------------------------------------------------
// The six checks of BAL-07
// -----------------------------------------------------------------------------------------------

/** S1 Generation: "100% of floors 1-7 validate within 50 retries; mean retries < 0.2." */
export function checkS1(seeds) {
  const runs = seeds.map((seed) => s1.runSeed(seed));
  const retries = runs.flatMap((r) => r.floors.map((f) => f.retries));
  const failed = runs.reduce((a, r) => a + r.failed, 0);
  const validated = retries.length - failed;
  const metrics = {
    floors: retries.length,
    validatedPercent: round((validated / retries.length) * 100, 3),
    meanRetries: round(mean(retries), 4),
    maxRetries: Math.max(...retries),
  };
  return {
    id: 'S1',
    label: s1.label,
    target: '100% of floors 1-7 validate within 50 retries; mean retries < 0.2',
    seeds: seeds.length,
    metrics,
    pass: metrics.validatedPercent === 100 && metrics.meanRetries < 0.2,
    runs,
  };
}

/** S2 Clock only: "Arrives at floor 8 with 40-70 Tension" (BAL-07 as DIF-01 restates it). */
export function checkS2(seeds, opts = {}) {
  const runs = seeds.map((seed) => runBot(createS2(), seed, { maxActions: 3000, tuning: opts.tuning }));
  const arrived = runs.filter((r) => r.floor8 !== null);
  const tensions = arrived.map((r) => r.floor8.tension);
  const metrics = {
    reachedFloor8: arrived.length,
    reachedPercent: round((arrived.length / runs.length) * 100, 2),
    meanTension: round(mean(tensions), 2),
    medianTension: median(tensions),
    minTension: tensions.length ? Math.min(...tensions) : null,
    maxTension: tensions.length ? Math.max(...tensions) : null,
    inBand: tensions.filter((t) => t >= S2_BAND[0] && t <= S2_BAND[1]).length,
    meanTurns: round(mean(arrived.map((r) => r.floor8.turn)), 1),
  };
  return {
    id: 'S2',
    label: 'Clock only',
    target: `Arrives at floor 8 with ${S2_BAND[0]}-${S2_BAND[1]} Tension`,
    seeds: seeds.length,
    metrics,
    // BAL-07 states S4's and S5's targets as medians, so the arrival Tension is read the same way:
    // the median run must land in the band, and every run must actually arrive at floor 8.
    pass:
      arrived.length === runs.length &&
      metrics.medianTension >= S2_BAND[0] &&
      metrics.medianTension <= S2_BAND[1],
    runs,
  };
}

/** S3 Pure melee: "Dies on floor 2-4 in >= 80% of runs" (BAL-07 as DIF-01 restates it). */
export function checkS3(seeds, opts = {}) {
  const runs = seeds.map((seed) => runBot(createS3(), seed, { tuning: opts.tuning }));
  const deaths = runs.filter((r) => r.outcome === OUTCOME.DEATH);
  const inBand = deaths.filter((r) => r.deathFloor >= S3_BAND[0] && r.deathFloor <= S3_BAND[1]);
  const histogram = {};
  for (const r of runs) {
    const key = r.outcome === OUTCOME.DEATH ? `floor ${r.deathFloor}` : r.outcome;
    histogram[key] = (histogram[key] || 0) + 1;
  }
  const metrics = {
    deaths: deaths.length,
    wins: runs.filter((r) => r.outcome === OUTCOME.WIN).length,
    stuck: runs.filter((r) => r.outcome === OUTCOME.STUCK).length,
    diesInBand: inBand.length,
    diesInBandPercent: round((inBand.length / runs.length) * 100, 2),
    medianDeathFloor: median(deaths.map((r) => r.deathFloor)),
    woundDownDeaths: deaths.filter((r) => r.wound).length,
    histogram,
  };
  return {
    id: 'S3',
    label: 'Pure melee',
    target: `Dies on floor ${S3_BAND[0]}-${S3_BAND[1]} in >= 80% of runs`,
    seeds: seeds.length,
    metrics,
    pass: metrics.diesInBandPercent >= 80,
    runs,
  };
}

/**
 * S4 Greedy explorer: "Wins 30-60% of runs; median death floor of losses is 5-7", plus DIF-01's two
 * shape targets — the clock causes 20-40% of the deaths, and no single enemy type causes more
 * than 40% of them.
 */
export function checkS4(seeds, opts = {}) {
  const runs = opts.runs || seeds.map((seed) => runBot(createS4(), seed, { tuning: opts.tuning }));
  const wins = runs.filter((r) => r.outcome === OUTCOME.WIN);
  const losses = runs.filter((r) => r.outcome !== OUTCOME.WIN);
  const lossFloors = losses.map((r) => (r.deathFloor === null ? r.floorsReached : r.deathFloor));
  const histogram = {};
  for (const r of runs) {
    const key = r.outcome === OUTCOME.WIN ? 'win' : r.outcome === OUTCOME.DEATH ? `died floor ${r.deathFloor}` : r.outcome;
    histogram[key] = (histogram[key] || 0) + 1;
  }
  const metrics = {
    wins: wins.length,
    winPercent: round((wins.length / runs.length) * 100, 2),
    losses: losses.length,
    stuck: runs.filter((r) => r.outcome === OUTCOME.STUCK).length,
    medianDeathFloorOfLosses: median(lossFloors),
    woundDownDeaths: runs.filter((r) => r.wound).length,
    // DIF-01: "the clock must be a real killer, not the only one" — the share of deaths it caused.
    woundDownShare: losses.length === 0 ? 0 : round((runs.filter((r) => r.wound).length / losses.length) * 100, 2),
    topDeathCauseShare: topShare(losses.map((r) => r.deathCause)),
    deathCauses: histogramOf(losses.map((r) => r.deathCause)),
    meanTurns: round(mean(runs.map((r) => r.turns)), 1),
    meanEnemiesBroken: round(mean(runs.map((r) => r.enemiesBroken)), 2),
    meanWanderers: round(mean(runs.map((r) => r.wanderersSpawned)), 2),
    meanItemsStolen: round(mean(runs.map((r) => r.itemsStolen)), 2),
    meanSolderUsed: round(mean(runs.map((r) => r.solderUsed)), 2),
    meanSpringKeysUsed: round(mean(runs.map((r) => r.springKeysUsed)), 2),
    histogram,
  };
  return {
    id: 'S4',
    label: 'Greedy explorer',
    target:
      `Wins ${S4_WIN_BAND[0]}-${S4_WIN_BAND[1]}% of runs; median death floor of losses is ` +
      `${S4_FLOOR_BAND[0]}-${S4_FLOOR_BAND[1]}; wind-downs ${S4_WOUND_BAND[0]}-${S4_WOUND_BAND[1]}% ` +
      `of deaths; no enemy type over ${S4_TOP_CAUSE_MAX}%`,
    seeds: seeds.length,
    metrics,
    pass:
      metrics.winPercent >= S4_WIN_BAND[0] &&
      metrics.winPercent <= S4_WIN_BAND[1] &&
      metrics.medianDeathFloorOfLosses !== null &&
      metrics.medianDeathFloorOfLosses >= S4_FLOOR_FLOOR &&
      metrics.woundDownShare >= S4_WOUND_BAND[0] &&
      metrics.woundDownShare <= S4_WOUND_BAND[1] &&
      metrics.topDeathCauseShare <= S4_TOP_CAUSE_MAX,
    runs,
  };
}

/** S5 Level curve: "Bot S4. Median level at floor 8 arrival is 7-9" (DIF-01). */
export function checkS5(seeds, opts = {}) {
  const runs = opts.runs || seeds.map((seed) => runBot(createS4(), seed, { tuning: opts.tuning }));
  const arrived = runs.filter((r) => r.floor8 !== null);
  const levels = arrived.map((r) => r.floor8.level);
  const histogram = {};
  for (const level of levels) histogram[`level ${level}`] = (histogram[`level ${level}`] || 0) + 1;
  const metrics = {
    reachedFloor8: arrived.length,
    reachedPercent: round((arrived.length / runs.length) * 100, 2),
    medianLevel: median(levels),
    meanLevel: round(mean(levels), 2),
    minLevel: levels.length ? Math.min(...levels) : null,
    maxLevel: levels.length ? Math.max(...levels) : null,
    histogram,
  };
  return {
    id: 'S5',
    label: 'Level curve',
    target: `Median level at floor 8 arrival is ${S5_BAND[0]}-${S5_BAND[1]}`,
    seeds: seeds.length,
    metrics,
    pass: metrics.medianLevel !== null && metrics.medianLevel >= S5_BAND[0] && metrics.medianLevel <= S5_BAND[1],
    runs,
  };
}

/**
 * S6 Loot: "Every floor's item multiset is non-empty; a plating item appears in >= 99% of floor-1
 * caches; uniques <= 1 per run."
 */
export function checkS6(seeds) {
  const runs = seeds.map((seed) => s6.runSeed(seed));
  const allFloors = runs.flatMap((r) => r.floors);
  const empty = allFloors.filter((f) => f.items.length === 0);
  const floor1 = runs.map((r) => r.floors.find((f) => f.number === 1));
  const withPlating = floor1.filter((f) => f.cachePlating).length;
  const maxUniques = Math.max(...runs.map((r) => r.uniques.length));
  const metrics = {
    floors: allFloors.length,
    emptyFloors: empty.length,
    floor1Caches: floor1.length,
    floor1CachesWithPlating: withPlating,
    floor1PlatingPercent: round((withPlating / floor1.length) * 100, 3),
    maxUniquesPerRun: maxUniques,
    meanItemsPerFloor: round(mean(allFloors.map((f) => f.items.length)), 2),
  };
  return {
    id: 'S6',
    label: 'Loot',
    target: "Every floor's item multiset is non-empty; plating in >= 99% of floor-1 caches; uniques <= 1 per run",
    seeds: seeds.length,
    metrics,
    pass: empty.length === 0 && metrics.floor1PlatingPercent >= 99 && maxUniques <= 1,
    runs,
  };
}

/** The six checks by id. S5 reuses S4's runs when they are handed to it. */
export const CHECKS = Object.freeze(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);

/**
 * Run one check.
 *
 * @param {string} id one of `CHECKS`
 * @param {{seeds?: number, s4Runs?: object[]}} [opts]
 */
export function runCheck(id, opts = {}) {
  const seeds = seedList(opts.seeds ?? FULL_SEEDS);
  switch (id.toUpperCase()) {
    case 'S1':
      return checkS1(seeds);
    case 'S2':
      return checkS2(seeds, { tuning: opts.tuning });
    case 'S3':
      return checkS3(seeds, { tuning: opts.tuning });
    case 'S4':
      return checkS4(seeds, { runs: opts.s4Runs, tuning: opts.tuning });
    case 'S5':
      return checkS5(seeds, { runs: opts.s4Runs, tuning: opts.tuning });
    case 'S6':
      return checkS6(seeds);
    default:
      throw new RangeError(`sim: unknown check '${id}' (BAL-07 defines ${CHECKS.join(', ')})`);
  }
}

/** Every check, S1..S6, with S5 reusing S4's runs (PLN-06 M11: "S5 reuses S4's runs"). */
export function runAll(opts = {}) {
  const results = [];
  let s4Runs = null;
  for (const id of CHECKS) {
    const result = runCheck(id, { ...opts, s4Runs: id === 'S5' ? s4Runs : undefined });
    if (id === 'S4') s4Runs = result.runs;
    results.push(result);
  }
  return results;
}

// -----------------------------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------------------------

/** An action's identity, for the driver's "already refused this turn" set. */
function actionKey(action) {
  const parts = [action.type];
  for (const field of ['slot', 'name', 'option', 'which', 'x', 'y', 'dx', 'dy']) {
    if (action[field] !== undefined) parts.push(`${field}=${action[field]}`);
  }
  return parts.join(',');
}

/** Strip the `runs` array: the report is the metrics, not several thousand run records. */
function reportable(result) {
  const { runs, ...rest } = result;
  return rest;
}

function printResult(result) {
  console.log(`\n${result.id} — ${result.label}   (${result.seeds} seeds)`);
  console.log(`  target: ${result.target}`);
  for (const [key, value] of Object.entries(result.metrics)) {
    if (value !== null && typeof value === 'object') {
      const parts = Object.entries(value)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([k, v]) => `${k}=${v}`);
      console.log(`  ${key}: ${parts.join('  ')}`);
    } else {
      console.log(`  ${key}: ${value}`);
    }
  }
  for (const gap of BALANCE_GAPS[result.id] || []) console.log(`  GAP: ${gap}`);
  const skip = BALANCE_SKIPS[result.id];
  if (result.pass) console.log('  PASS');
  else if (skip) console.log(`  SKIP — ${skip}`);
  else console.log('  FAIL');
}

function usage() {
  console.error(
    'usage: node tools/sim.js (S1|S2|S3|S4|S5|S6|--all) [--seeds N] [--json] [--strict]' +
      " [--tuning '<json>'] [--tuning-file <path>]",
  );
  return 2;
}

/**
 * DIF-02 — the tuning override for this sweep: `--tuning '{"wanderInterval":40}'` or
 * `--tuning-file knobs.json`. Both are partial: every key left out keeps `data/tuning.js`'s
 * default. This is what makes the DIF-15 ladder a data loop rather than a code loop.
 *
 * @returns {object|null|undefined} the parsed object, or `undefined` on a bad argument
 */
export function tuningFromArgs(args) {
  const inline = args.indexOf('--tuning');
  const file = args.indexOf('--tuning-file');
  if (inline < 0 && file < 0) return null;
  let text;
  if (inline >= 0) {
    text = args[inline + 1];
    if (text === undefined) {
      console.error("sim: --tuning needs a JSON object, e.g. --tuning '{\"eliteChance\":30}'");
      return undefined;
    }
  } else {
    const path = args[file + 1];
    if (path === undefined) {
      console.error('sim: --tuning-file needs a path');
      return undefined;
    }
    try {
      text = fs.readFileSync(path, 'utf8');
    } catch (error) {
      console.error(`sim: cannot read ${path} — ${error.message}`);
      return undefined;
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.error(`sim: --tuning is not valid JSON — ${error.message}`);
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('sim: --tuning must be a JSON object of tuning keys');
    return undefined;
  }
  return parsed;
}

function main(argv) {
  const args = argv.filter((a) => a !== '--');
  const json = args.includes('--json');
  const all = args.includes('--all');
  const strict = args.includes('--strict');
  const seedsFlag = args.indexOf('--seeds');
  const seeds = seedsFlag >= 0 ? Number(args[seedsFlag + 1]) : FULL_SEEDS;
  if (!Number.isInteger(seeds) || seeds < 1) {
    console.error(`sim: --seeds needs a positive integer, got '${args[seedsFlag + 1]}'`);
    return usage();
  }
  const picked = args.filter((a) => /^[sS][1-6]$/.test(a)).map((a) => a.toUpperCase());
  if (!all && picked.length === 0) return usage();

  const tuning = tuningFromArgs(args);
  if (tuning === undefined) return usage();

  const started = Date.now();
  const results = all
    ? runAll({ seeds, tuning })
    : picked.map((id) => runCheck(id, { seeds, tuning }));
  const elapsed = (Date.now() - started) / 1000;

  // A check in BALANCE_SKIPS is an accepted, logged miss, not a failure (PLN-07.2 step 4); it is
  // still printed with all of its numbers. `--strict` puts it back in the failure column.
  const accepted = (result) => !result.pass && BALANCE_SKIPS[result.id] !== undefined && !strict;
  const skipped = results.filter(accepted);
  const failed = results.filter((result) => !result.pass && !accepted(result));

  if (json) {
    console.log(
      JSON.stringify(
        {
          seeds,
          tuning,
          elapsedSeconds: Math.round(elapsed * 10) / 10,
          skipped: skipped.map((r) => ({ id: r.id, reason: BALANCE_SKIPS[r.id] })),
          gaps: BALANCE_GAPS,
          results: results.map(reportable),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`BAL-07 simulation — ${seeds} seeds per check`);
    if (tuning) console.log(`tuning override: ${JSON.stringify(tuning)}`);
    for (const result of results) printResult(result);
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n${passed}/${results.length} checks pass in ${elapsed.toFixed(1)}s`);
    for (const result of skipped) console.log(`accepted miss: ${result.id} — ${BALANCE_SKIPS[result.id]}`);
    if (failed.length > 0) console.log(`failing: ${failed.map((r) => r.id).join(', ')}`);
  }
  return failed.length === 0 ? 0 : 1;
}

// Only run the CLI when this file is the entry point, so the tests can import the checks.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/sim.js')) {
  process.exit(main(process.argv.slice(2)));
}
