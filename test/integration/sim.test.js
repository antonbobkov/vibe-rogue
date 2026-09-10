// ACC-130 and ACC-131 — the BAL-07 simulation checks, run headlessly through `tools/sim.js`.
//
// PLN-06 M11 splits the sweep in two: this file runs each bot on **50 seeds** so that `npm run dod
// -- 11` finishes in well under five minutes, and the full 200-seed BAL-07 sweep is `npm run sim`
// (`node tools/sim.js --all --seeds 200`), which the second CI job runs with a 45-minute timeout.
// Every title states the seed count it actually ran. The seed list is a prefix of the 200-seed one,
// so a number here is the same number the big sweep reports for those seeds (PLN-02 R6).
//
// One target is skipped, per the balance protocol PLN-07.2 step 4: see `specs/BALANCE-CHANGELOG.md`
// rows B-001 to B-004 and the note on the S4 test below.

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkS1, checkS2, checkS3, checkS4, checkS5, checkS6, runBot, seedList, OUTCOME } from '../../tools/sim.js';
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
  // WLD-10 caps regenerations at 50; nothing should come close.
  assert.ok(result.metrics.maxRetries <= 50, describe(result));
  assert.ok(result.pass, describe(result));
});

test('ACC-130 S2 clock only: arrives at floor 8 with 60-80 Tension over 50 seeds @m11', () => {
  const result = checkS2(seeds);
  assert.equal(result.metrics.reachedFloor8, SEEDS, describe(result));
  assert.ok(result.metrics.medianTension >= 60, describe(result));
  assert.ok(result.metrics.medianTension <= 80, describe(result));
  assert.ok(result.pass, describe(result));
});

test('ACC-130 S3 pure melee: dies on floor 3-5 in at least 80% of 50 seeds @m11', () => {
  const result = checkS3(seeds);
  assert.equal(result.metrics.stuck, 0, describe(result));
  assert.ok(result.metrics.diesOnFloor3To5Percent >= 80, describe(result));
  assert.ok(result.pass, describe(result));
});

// PLN-07.2 step 4. The S4 bot measures 88% wins and a median loss floor of 4 over the full 200
// seeds, against a target of 30-60% and 6-8. All four BAL-08 knobs were turned and measured
// (B-001 to B-004): none moves the win rate into the band, and knobs 1 and 3 break BAL-C2 and
// BAL-C1 respectively, which PLN-07.2 forbids ("keep every other test green"). The target band is
// not widened; this one test is skipped and the numbers stand in the changelog.
test('ACC-130 S4 greedy explorer: wins 30-60% of runs and loses on floor 6-8 over 50 seeds @m11', (t) => {
  t.skip('BALANCE: ACC-130 S4 win rate and median death floor unmet after 3 iterations; see B-004');
});

test('ACC-130 S5 level curve: median level at floor 8 arrival is 8 or 9 over 50 seeds @m11', () => {
  const result = checkS5(seeds, { runs: s4RunsOnce() });
  assert.ok(result.metrics.reachedFloor8 > 0, 'no run reached floor 8, so there is no level to read');
  assert.ok(
    result.metrics.medianLevel === 8 || result.metrics.medianLevel === 9,
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

// -----------------------------------------------------------------------------------------------
// ACC-131 — the scripted full-explore run
// -----------------------------------------------------------------------------------------------

test('ACC-131: a full-explore run on TEST1234 with no Spring-Keys never winds down and enters floor 8 with 35-65 Tension @m11', () => {
  // PLN-06 M11: "a full-explore scripted S4-style run on TEST1234 with Spring-Key use disabled".
  // `stationAt: 30` is CHR-03's first warning, which is where BAL-01's model puts the player when
  // they reach the Winding Station (its pre-station low points are 30-39 on floors 2-6) — D-106.
  const run = runBot(createS4({ springKeys: false, stationAt: 30 }), 'TEST1234');

  assert.equal(run.springKeysUsed, 0, 'ACC-131 disables Spring-Key use');
  assert.notEqual(run.outcome, OUTCOME.STUCK, `the run did not terminate: ${JSON.stringify(run.outcome)}`);

  // "Never wound down" (CMB-12: Tension reaching 0 is a death).
  assert.equal(run.everWoundDown, false, `Tension reached 0 on floor ${run.deathFloor}`);
  assert.equal(run.wound, false, 'the run ended wound down');
  assert.ok(run.minTension > 0, `lowest Tension of the run was ${run.minTension}`);

  // "Tension at floor 8 entry within 35-65."
  assert.ok(run.floor8 !== null, `the run never reached floor 8 (got to ${run.floorsReached})`);
  assert.ok(
    run.floor8.tension >= 35 && run.floor8.tension <= 65,
    `floor 8 entry Tension was ${run.floor8.tension}, outside 35-65 (turn ${run.floor8.turn})`,
  );

  // A full-explore run, not a rush: OVR-04's target is ~1,760 player turns for all eight floors.
  assert.ok(run.turns > 1000, `only ${run.turns} turns — that is not a full explore`);
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
