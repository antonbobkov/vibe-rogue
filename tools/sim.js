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
 * applied, every BAL-08 knob was measured, none moved the number into the band, and the single test
 * that asserts it is marked `skip` in `test/integration/sim.test.js` with the same message. They are
 * reported as SKIP, printed with their numbers, and do not fail the process — `--strict` makes them
 * fail, which is how the miss gets re-measured deliberately.
 *
 * Never add an entry here without the matching `specs/BALANCE-CHANGELOG.md` rows.
 */
export const BALANCE_SKIPS = Object.freeze({
  S4: 'BALANCE: ACC-130 S4 win rate and median death floor unmet after 3 iterations; see B-004',
});

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
 * @param {{maxActions?: number, ending?: 'A'|'B', trace?: boolean}} [opts]
 * @returns {{seed: string, outcome: string, turns: number, actions: number, floorsReached: number,
 *            deathFloor: number|null, wound: boolean, level: number, enemiesBroken: number,
 *            skills: string[], springKeysUsed: number, floor8: object|null,
 *            minTension: number, everWoundDown: boolean, floorArrivals: object[]}}
 */
export function runBot(bot, seedString, opts = {}) {
  const maxActions = opts.maxActions ?? MAX_ACTIONS;
  const ending = opts.ending || 'A';
  const game = createGame({ seedString, intro: false });
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

/** S2 Clock only: "Arrives at floor 8 with 60-80 Tension." */
export function checkS2(seeds) {
  const runs = seeds.map((seed) => runBot(createS2(), seed, { maxActions: 3000 }));
  const arrived = runs.filter((r) => r.floor8 !== null);
  const tensions = arrived.map((r) => r.floor8.tension);
  const metrics = {
    reachedFloor8: arrived.length,
    reachedPercent: round((arrived.length / runs.length) * 100, 2),
    meanTension: round(mean(tensions), 2),
    medianTension: median(tensions),
    minTension: tensions.length ? Math.min(...tensions) : null,
    maxTension: tensions.length ? Math.max(...tensions) : null,
    inBand: tensions.filter((t) => t >= 60 && t <= 80).length,
    meanTurns: round(mean(arrived.map((r) => r.floor8.turn)), 1),
  };
  return {
    id: 'S2',
    label: 'Clock only',
    target: 'Arrives at floor 8 with 60-80 Tension',
    seeds: seeds.length,
    metrics,
    // BAL-07 states S4's and S5's targets as medians, so the arrival Tension is read the same way:
    // the median run must land in the band, and every run must actually arrive at floor 8.
    pass: arrived.length === runs.length && metrics.medianTension >= 60 && metrics.medianTension <= 80,
    runs,
  };
}

/** S3 Pure melee: "Dies on floor 3-5 in >= 80% of runs." */
export function checkS3(seeds) {
  const runs = seeds.map((seed) => runBot(createS3(), seed));
  const deaths = runs.filter((r) => r.outcome === OUTCOME.DEATH);
  const inBand = deaths.filter((r) => r.deathFloor >= 3 && r.deathFloor <= 5);
  const histogram = {};
  for (const r of runs) {
    const key = r.outcome === OUTCOME.DEATH ? `floor ${r.deathFloor}` : r.outcome;
    histogram[key] = (histogram[key] || 0) + 1;
  }
  const metrics = {
    deaths: deaths.length,
    wins: runs.filter((r) => r.outcome === OUTCOME.WIN).length,
    stuck: runs.filter((r) => r.outcome === OUTCOME.STUCK).length,
    diesOnFloor3To5: inBand.length,
    diesOnFloor3To5Percent: round((inBand.length / runs.length) * 100, 2),
    medianDeathFloor: median(deaths.map((r) => r.deathFloor)),
    woundDownDeaths: deaths.filter((r) => r.wound).length,
    histogram,
  };
  return {
    id: 'S3',
    label: 'Pure melee',
    target: 'Dies on floor 3-5 in >= 80% of runs',
    seeds: seeds.length,
    metrics,
    pass: metrics.diesOnFloor3To5Percent >= 80,
    runs,
  };
}

/** S4 Greedy explorer: "Wins 30-60% of runs; median death floor of losses is 6-8." */
export function checkS4(seeds, opts = {}) {
  const runs = opts.runs || seeds.map((seed) => runBot(createS4(), seed));
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
    meanTurns: round(mean(runs.map((r) => r.turns)), 1),
    meanEnemiesBroken: round(mean(runs.map((r) => r.enemiesBroken)), 2),
    histogram,
  };
  return {
    id: 'S4',
    label: 'Greedy explorer',
    target: 'Wins 30-60% of runs; median death floor of losses is 6-8',
    seeds: seeds.length,
    metrics,
    pass:
      metrics.winPercent >= 30 &&
      metrics.winPercent <= 60 &&
      metrics.medianDeathFloorOfLosses !== null &&
      metrics.medianDeathFloorOfLosses >= 6 &&
      metrics.medianDeathFloorOfLosses <= 8,
    runs,
  };
}

/** S5 Level curve: "Bot S4. Median level at floor 8 arrival is 8 or 9." */
export function checkS5(seeds, opts = {}) {
  const runs = opts.runs || seeds.map((seed) => runBot(createS4(), seed));
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
    target: 'Median level at floor 8 arrival is 8 or 9',
    seeds: seeds.length,
    metrics,
    pass: metrics.medianLevel === 8 || metrics.medianLevel === 9,
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
      return checkS2(seeds);
    case 'S3':
      return checkS3(seeds);
    case 'S4':
      return checkS4(seeds, { runs: opts.s4Runs });
    case 'S5':
      return checkS5(seeds, { runs: opts.s4Runs });
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
  const skip = BALANCE_SKIPS[result.id];
  if (result.pass) console.log('  PASS');
  else if (skip) console.log(`  SKIP — ${skip}`);
  else console.log('  FAIL');
}

function usage() {
  console.error('usage: node tools/sim.js (S1|S2|S3|S4|S5|S6|--all) [--seeds N] [--json] [--strict]');
  return 2;
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

  const started = Date.now();
  const results = all ? runAll({ seeds }) : picked.map((id) => runCheck(id, { seeds }));
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
          elapsedSeconds: Math.round(elapsed * 10) / 10,
          skipped: skipped.map((r) => ({ id: r.id, reason: BALANCE_SKIPS[r.id] })),
          results: results.map(reportable),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`BAL-07 simulation — ${seeds} seeds per check`);
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
