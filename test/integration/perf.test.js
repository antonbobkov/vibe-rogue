// TEC-14 performance targets, as tests (PLN-02 R9, PLN-06 M12 task 1).
//
// Two of TEC-14's four budgets are headless and live here:
//
//   * "A turn (`CMB-02` including AI for <= 30 enemies) completes in < 5 ms."
//   * "Floor generation (including validation retries) completes in < 50 ms."
//
// The other two are browser budgets and live in `test/e2e/perf.spec.js`: a full redraw under 8 ms
// through the duration `CH.render()` returns, and TEC-14's idle check, `CH.timers() === 0`.
//
// PLN-02 R6 forbids wall-clock time in assertions *except* here: the measurement is the test.
// `process.hrtime.bigint()` is the clock, exactly as the M03 generation budget already uses it
// (PLN-06 M03: "allowed here: `tools/` and tests may use timers; `src/` may not"). Nothing else
// about these tests is timing-dependent — the maps, the seeds and the RNG are all fixed, so the
// same turns are executed on every run and only the stopwatch varies.

import test from 'node:test';
import assert from 'node:assert/strict';

import { W, H } from '../../src/grid.js';
import { generateFloor } from '../../src/gen.js';
import { fixtureGame } from '../fixtures/maps.js';

/** Nanoseconds to milliseconds. */
function ms(ns) {
  return Number(ns) / 1e6;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    max: sorted[sorted.length - 1],
  };
}

function report(label, s, budget) {
  return `${label}: mean ${s.mean.toFixed(3)} ms, median ${s.median.toFixed(3)} ms, ` +
    `p95 ${s.p95.toFixed(3)} ms, max ${s.max.toFixed(3)} ms over ${s.n} samples (budget ${budget} ms)`;
}

// ---------------------------------------------------------------------------------------------
// A turn with 30 enemies (TEC-14 bullet 1)
// ---------------------------------------------------------------------------------------------

/**
 * The eleven non-boss archetypes of `22-bestiary.md` by glyph, so the 30 enemies on the fixture
 * exercise every `ENM-06` decision list — CHASER, GUARD, SKIRMISHER, BRUISER, SWARMER and ERRATIC
 * — rather than the cheapest one.
 */
const ROSTER = ['s', 'h', 't', 'd', 'c', 'k', 'g', 'f', 'a', 'p', 'u'];

/** A walled 60 x 24 hall: the largest map the game ever renders (`UI-02`), with nothing in it. */
function hall() {
  const rows = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      row += edge ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

function put(rows, x, y, ch) {
  rows[y] = `${rows[y].slice(0, x)}${ch}${rows[y].slice(x + 1)}`;
}

/**
 * Tick in the middle of an open hall with exactly 30 enemies around him, on Chebyshev rings 4 to
 * 11 so that some are already in reach and the rest have to see, track and path (`ENM-02`,
 * `ENM-05`, `ENM-08`) every turn. Open ground is the worst case for the AI: every enemy runs a
 * shadowcast and an A* of its own, and nothing is hidden behind a wall to cut the work short.
 */
function swarmMap() {
  const rows = hall();
  const tx = 30;
  const ty = 12;
  put(rows, tx, ty, 'T');

  const spots = [];
  for (let r = 4; r <= 11 && spots.length < 30; r++) {
    for (let dy = -r; dy <= r && spots.length < 30; dy++) {
      for (let dx = -r; dx <= r && spots.length < 30; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // the ring, not the disc
        const x = tx + dx;
        const y = ty + dy;
        if (x < 2 || x > W - 3 || y < 2 || y > H - 3) continue;
        if ((x + y) % 3 !== 0) continue; // spread them out; one actor per tile (TEC-15)
        spots.push([x, y]);
      }
    }
  }
  spots.forEach(([x, y], i) => put(rows, x, y, ROSTER[i % ROSTER.length]));
  return { rows, count: spots.length };
}

/** Every roster glyph starts Active, so no enemy is asleep while the turn is being timed. */
const ACTIVE = Object.fromEntries(ROSTER.map((g) => [g, { state: 'ACTIVE' }]));

/**
 * One game on the swarm fixture, waiting one turn at a time until Tick is broken. Returns the
 * per-turn durations in ms. Only `game.act` is inside the stopwatch; building the fixture is not.
 */
function measureRun(seedString, samples) {
  const { rows, count } = swarmMap();
  const game = fixtureGame(rows, { number: 7, seedString, enemies: ACTIVE });
  assert.equal(count, 30, 'the fixture must place exactly 30 enemies');
  assert.equal(game.state.floor.enemies.length, 30, 'all 30 enemies must be on the floor');
  for (const e of game.state.floor.enemies) assert.equal(e.state, 'ACTIVE');

  for (let t = 0; t < 60; t++) {
    const t0 = process.hrtime.bigint();
    const result = game.act({ type: 'wait' });
    const elapsed = process.hrtime.bigint() - t0;
    if (!result.ok) break;
    samples.push(ms(elapsed));
    if (game.state.dead || game.phase !== 'run') break;
  }
}

test('@m12 @unit perf: a turn with 30 enemies runs in under 5 ms (TEC-14)', () => {
  measureRun('PERF-WARMUP', []); // let the JIT see the turn loop and the AI once, untimed

  const samples = [];
  for (let run = 0; run < 40; run++) measureRun(`PERF-TURN-${run}`, samples);

  const s = stats(samples);
  assert.ok(s.n >= 100, `expected at least 100 timed turns; got ${s.n}`);
  assert.ok(s.mean < 5, report('turn with 30 enemies', s, 5));
  assert.ok(s.median < 5, report('turn with 30 enemies (median)', s, 5));
  console.log(report('TEC-14 turn (30 enemies, budget 5 ms)', s, 5));
});

// ---------------------------------------------------------------------------------------------
// Floor generation (TEC-14 bullet 2)
// ---------------------------------------------------------------------------------------------

test('@m12 @unit perf: floor generation runs in under 50 ms per floor (TEC-14)', () => {
  generateFloor('PERF-WARMUP', 1); // untimed

  const samples = [];
  for (let s = 0; s < 300; s++) {
    const n = 1 + (s % 7); // floors 1-7; floor 8 is loaded from data, not generated
    const t0 = process.hrtime.bigint();
    generateFloor(`PERF-GEN-${s}`, n);
    samples.push(ms(process.hrtime.bigint() - t0));
  }

  const st = stats(samples);
  // TEC-14 is per generation ("floor generation ... completes in < 50 ms"), including the WLD-10
  // validation retries, so the worst floor of the 300 is the one that has to fit the budget.
  assert.ok(st.max < 50, report('floor generation (worst floor)', st, 50));
  assert.ok(st.mean < 50, report('floor generation', st, 50));
  console.log(report('TEC-14 floor generation (budget 50 ms)', st, 50));
});
