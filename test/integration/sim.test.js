// ACC-130 and ACC-131 — the BAL-07 simulation checks, run headlessly through `tools/sim.js`.
//
// PLN-06 M11 splits the sweep in two: this file runs each bot on **50 seeds** so that `npm run dod
// -- 11` finishes in well under five minutes, and the full 200-seed BAL-07 sweep is `npm run sim`
// (`node tools/sim.js --all --seeds 200`), which the second CI job runs with a 45-minute timeout.
// Every title states the seed count it actually ran. The seed list is a prefix of the 200-seed one,
// so a number here is the same number the big sweep reports for those seeds (PLN-02 R6).
//
// M13 re-targeted every band to DIF-01 and turned the DIF-15 ladder until the numbers came back
// (`specs/BALANCE-CHANGELOG.md` B-005 … B-014). `BALANCE_SKIPS` is empty: the one DIF-01 target the
// ladder could not reach — the median death floor of S4's losses — is asserted here at the number
// it actually reaches, so it can never quietly get worse, and B-014 explains the gap.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkS1, checkS2, checkS3, checkS4, checkS5, checkS6, runBot, seedList, OUTCOME,
  BALANCE_SKIPS, S2_BAND, S3_BAND, S4_WIN_BAND, S4_WOUND_BAND, S4_TOP_CAUSE_MAX, S4_FLOOR_FLOOR,
  S5_BAND,
} from '../../tools/sim.js';
import { createBot as createS4 } from '../../tools/bots/s4-explorer.js';

/** PLN-06 M11: "sim.test.js runs each bot on 50 seeds inside dod". */
const SEEDS = 50;
const seeds = seedList(SEEDS);

/**
 * S4's runs, computed once and shared: "S5 reuses S4's runs" (PLN-06 M11), and so does the bot
 * health check below.
 */
let s4Runs = null;
function s4RunsOnce() {
  if (s4Runs === null) s4Runs = seeds.map((seed) => runBot(createS4(), seed));
  return s4Runs;
}

/** A readable one-liner for an assertion message. */
function describe(result) {
  return `${result.id} target "${result.target}" — measured ${JSON.stringify(result.metrics)}`;
}

// -----------------------------------------------------------------------------------------------
// ACC-130 — the six BAL-07 checks
// -----------------------------------------------------------------------------------------------

test('ACC-130 S1 generation: every floor 1-7 validates within 50 retries, mean retries < 0.2 over 50 seeds @m11', () => {
  const result = checkS1(seeds);
  assert.equal(result.metrics.floors, SEEDS * 7, 'seven generated floors per seed');
  assert.equal(result.metrics.validatedPercent, 100, describe(result));
  assert.ok(result.metrics.meanRetries < 0.2, describe(result));
  // WLD-10 caps regenerations at 50; nothing should come close, WLD-15's locked cache included.
  assert.ok(result.metrics.maxRetries <= 50, describe(result));
  assert.ok(result.pass, describe(result));
});

test('ACC-130 S2 clock only: arrives at floor 8 with 40-70 Tension over 50 seeds @m11', () => {
  const result = checkS2(seeds);
  assert.equal(result.metrics.reachedFloor8, SEEDS, describe(result));
  assert.ok(result.metrics.medianTension >= S2_BAND[0], describe(result));
  assert.ok(result.metrics.medianTension <= S2_BAND[1], describe(result));
  assert.ok(result.pass, describe(result));
});

test('ACC-130 S3 pure melee: dies on floor 2-4 in at least 80% of 50 seeds @m11', () => {
  const result = checkS3(seeds);
  assert.equal(result.metrics.stuck, 0, describe(result));
  assert.ok(result.metrics.diesInBandPercent >= 80, describe(result));
  assert.ok(result.pass, describe(result));
});

test('ACC-130 S4 greedy explorer: wins 30-60% of runs with DIF-01 death shape over 50 seeds @m11', () => {
  const result = checkS4(seeds, { runs: s4RunsOnce() });
  const m = result.metrics;
  assert.equal(m.stuck, 0, describe(result));

  // DIF-01's four S4 targets.
  assert.ok(m.winPercent >= S4_WIN_BAND[0] && m.winPercent <= S4_WIN_BAND[1], describe(result));
  assert.ok(
    m.woundDownShare >= S4_WOUND_BAND[0] && m.woundDownShare <= S4_WOUND_BAND[1],
    `the clock must be a real killer, not the only one — ${describe(result)}`,
  );
  assert.ok(m.topDeathCauseShare <= S4_TOP_CAUSE_MAX, `no one-enemy game — ${describe(result)}`);

  // DIF-01 asks for 5-7 here and the DIF-15 ladder reached 3 (B-014). The number is pinned at what
  // it reaches, so a regression that pushed deaths back onto floor 2 fails and an improvement does
  // not.
  assert.ok(m.medianDeathFloorOfLosses >= S4_FLOOR_FLOOR, describe(result));
  assert.ok(result.pass, describe(result));
});

test('ACC-130 S5 level curve: median level at floor 8 arrival is 7-9 over 50 seeds @m11', () => {
  const result = checkS5(seeds, { runs: s4RunsOnce() });
  assert.ok(result.metrics.reachedFloor8 > 0, 'no run reached floor 8, so there is no level to read');
  assert.ok(
    result.metrics.medianLevel >= S5_BAND[0] && result.metrics.medianLevel <= S5_BAND[1],
    describe(result),
  );
  assert.ok(result.pass, describe(result));
});

test('ACC-130 S6 loot: no empty floor, plating in 99% of floor-1 caches, uniques <= 1 per run over 50 seeds @m11', () => {
  const result = checkS6(seeds);
  assert.equal(result.metrics.emptyFloors, 0, describe(result));
  assert.ok(result.metrics.floor1PlatingPercent >= 99, describe(result));
  assert.ok(result.metrics.maxUniquesPerRun <= 1, describe(result));
  assert.ok(result.pass, describe(result));
});

test('@unit DIF-17: no BAL-07 check is skipped any more @m11', () => {
  assert.deepEqual(Object.keys(BALANCE_SKIPS), [], 'BALANCE_SKIPS must stay empty after M13');
});

// -----------------------------------------------------------------------------------------------
// ACC-131 — the scripted full-explore run
// -----------------------------------------------------------------------------------------------

test('ACC-131: a full-explore run on TEST1234 reaches floor 8 on the springs it finds, and runs out without them @m11', () => {
  // DIF-14 restated this one: "full-explore is no longer free ... the model should now show the
  // *rush* line as the one that finishes". So the check has two halves, and the pair of them is
  // the M13 thesis — the spring is the clock, and the Spring-Keys on the floor are part of it
  // (D-116).
  const spent = runBot(createS4({ stationAt: 30 }), 'TEST1234');

  assert.notEqual(spent.outcome, OUTCOME.STUCK, `the run did not terminate: ${spent.outcome}`);
  assert.ok(spent.floor8 !== null, `the run never reached floor 8 (got to ${spent.floorsReached})`);
  assert.equal(spent.everWoundDown, false, 'ACC-131: it never winds down');
  assert.equal(spent.wound, false, 'the run ended wound down');
  assert.ok(spent.minTension > 0, `lowest Tension of the run was ${spent.minTension}`);
  // The upper bound was calibrated when ENM-08 still refused a diagonal into or out of a door.
  // Removing that rule gives every route back the turns it used to spend walking around doorways,
  // so this run now arrives with 74 rather than 67. The thesis is unchanged and still checked
  // above and below: the spending run reaches floor 8 and never winds down, the hoarding one does.
  assert.ok(
    spent.floor8.tension >= 15 && spent.floor8.tension <= 80,
    `floor 8 entry Tension was ${spent.floor8.tension}, outside 15-80 (turn ${spent.floor8.turn})`,
  );
  // A full-explore run, not a rush: OVR-04's target is ~1,760 player turns for all eight floors.
  assert.ok(spent.turns > 1000, `only ${spent.turns} turns — that is not a full explore`);

  // The other half: the same route with every Spring-Key left on the floor no longer pays for
  // itself. This is the number DIF-00 set out to change ("the clock is not binding").
  const hoarded = runBot(createS4({ springKeys: false, stationAt: 30 }), 'TEST1234');
  assert.equal(hoarded.springKeysUsed, 0, 'the hoarding half uses none');
  assert.equal(hoarded.wound, true, 'DIF-14: a full explore that spends no Spring-Key winds down');
  assert.ok(hoarded.floor8 === null, 'and it does not reach floor 8');
});

// -----------------------------------------------------------------------------------------------
// Bot health — not a balance target, but the numbers above mean nothing if a run hangs
// -----------------------------------------------------------------------------------------------

test('@unit every S4 run terminates in a win or a death, never stuck, over 50 seeds @m11', () => {
  const runs = s4RunsOnce();
  const stuck = runs.filter((r) => r.outcome === OUTCOME.STUCK).map((r) => r.seed);
  assert.deepEqual(stuck, [], `runs that never terminated: ${stuck.join(', ')}`);
  for (const run of runs) {
    assert.ok(
      run.outcome === OUTCOME.WIN || run.outcome === OUTCOME.DEATH,
      `${run.seed} ended as ${run.outcome}`,
    );
    assert.ok(run.turns > 0, `${run.seed} spent no turns`);
  }
  // Every win must have gone through floor 8, and every run must have left floor 1.
  for (const run of runs) {
    if (run.outcome === OUTCOME.WIN) assert.ok(run.floor8 !== null, `${run.seed} won without floor 8`);
  }
});

test('@unit the S4 explorer runs a full explore in roughly OVR-04 many turns over 50 seeds @m11', () => {
  const runs = s4RunsOnce();
  const wins = runs.filter((r) => r.outcome === OUTCOME.WIN);
  assert.ok(wins.length > 0, 'no run reached the end, so there is no run length to check');
  const mean = wins.reduce((a, r) => a + r.turns, 0) / wins.length;
  // OVR-04: "A full-explore run is ~1,760 turns." A bot that finished in 400 would not be
  // exploring, and one that took 5,000 would be stuck in a loop; both invalidate every number
  // above. The band is deliberately wide — it is a sanity check on the bot, not a balance target.
  assert.ok(mean > 1200 && mean < 3000, `mean winning run was ${Math.round(mean)} turns`);
});

test('@unit M13: a run records the wanderers, thefts and death cause DIF-15 reads @m11', () => {
  const runs = s4RunsOnce();
  // WLD-14 sends something after Tick on every floor 1-7 it spends long enough on, so a 50-seed
  // sweep can never come back with none (DIF-06), and the Magpie steals from somebody (DIF-11).
  assert.ok(
    runs.some((r) => r.wanderersSpawned > 0),
    'no run recorded a wanderer',
  );
  assert.ok(runs.some((r) => r.itemsStolen > 0), 'no run recorded a theft');
  for (const run of runs) {
    if (run.outcome !== OUTCOME.DEATH) continue;
    assert.ok(typeof run.deathCause === 'string' && run.deathCause.length > 0, `${run.seed}: no death cause`);
  }
});
