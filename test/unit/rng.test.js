// M01 — src/rng.js (TEC-07, TEC-03, ITM-10).
//
// Determinism is the whole point of this module (PLN-02 R6): every expectation below is either a
// hand-computed value from the spec or a property checked over a fixed seed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32, fnv1a, queueRng, int, chance, parseDice, roll, weighted } from '../../src/rng.js';

/** FNV-1a computed independently from real UTF-8 bytes, to cross-check the hand-rolled encoder. */
function fnv1aOverBytes(str) {
  let h = 2166136261 >>> 0;
  for (const byte of Buffer.from(str, 'utf8')) {
    h ^= byte;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

test('@m01 @unit rng: mulberry32 gives the same 1,000 values for the same seed', () => {
  const seed = fnv1a('TEST1234:play');
  const a = mulberry32(seed);
  const b = mulberry32(seed);
  const first = [];
  for (let i = 0; i < 1000; i++) first.push(a.next());
  const second = [];
  for (let i = 0; i < 1000; i++) second.push(b.next());
  assert.deepEqual(second, first, 'the same seed must replay the same stream');
  assert.equal(new Set(first).size > 990, true, 'the stream must not be constant');
  for (const v of first) {
    assert.equal(typeof v, 'number');
    assert.ok(v >= 0 && v < 1, `next() returned ${v}, outside [0, 1)`);
  }
  const different = mulberry32(seed + 1);
  const other = [];
  for (let i = 0; i < 1000; i++) other.push(different.next());
  assert.notDeepEqual(other, first, 'a different seed must give a different stream');
});

test('@m01 @unit rng: mulberry32 state is one uint32 and getState/setState round-trips', () => {
  const rng = mulberry32(fnv1a('SEEDSEED:play'));
  for (let i = 0; i < 10; i++) rng.next();

  const saved = rng.getState();
  assert.ok(Number.isInteger(saved) && saved >= 0 && saved <= 0xffffffff, `state ${saved} is not a uint32`);

  const after = [];
  for (let i = 0; i < 10; i++) after.push(rng.next());

  rng.setState(saved);
  assert.equal(rng.getState(), saved);
  const replay = [];
  for (let i = 0; i < 10; i++) replay.push(rng.next());
  assert.deepEqual(replay, after, 'restoring the state must resume the identical stream');

  // A fresh generator restored to the same state agrees too — this is what TEC-09 saves.
  const restored = mulberry32(0);
  restored.setState(saved);
  const third = [];
  for (let i = 0; i < 10; i++) third.push(restored.next());
  assert.deepEqual(third, after);
});

test('@m01 @unit rng: fnv1a hashes the UTF-8 bytes of a string', () => {
  assert.equal(fnv1a(''), 2166136261, 'FNV-1a offset basis');
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.equal(fnv1a('foobar'), 0xbf9cf968);
  for (const s of ['', 'a', 'TEST1234', 'TEST1234:play', 'TEST1234:floor:8', 'é', 'ünïcödé', '\u{1F551}']) {
    assert.equal(fnv1a(s), fnv1aOverBytes(s), `fnv1a('${s}') must hash the UTF-8 bytes`);
    assert.ok(Number.isInteger(fnv1a(s)) && fnv1a(s) >= 0 && fnv1a(s) <= 0xffffffff);
  }
  assert.notEqual(fnv1a('TEST1234:play'), fnv1a('TEST1234:floor:1'), 'the streams of TEC-07 must differ');
});

test('@m01 @unit rng: int stays inside its bounds over 10,000 draws', () => {
  const ranges = [[1, 6], [1, 100], [0, 0], [5, 5], [-3, 3], [1, 2]];
  for (const [lo, hi] of ranges) {
    const rng = mulberry32(fnv1a(`bounds:${lo}:${hi}`));
    const hit = new Set();
    for (let i = 0; i < 10000; i++) {
      const v = int(rng, lo, hi);
      assert.ok(Number.isInteger(v), `int(${lo}, ${hi}) returned a non-integer ${v}`);
      assert.ok(v >= lo && v <= hi, `int(${lo}, ${hi}) returned ${v}`);
      hit.add(v);
    }
    assert.equal(hit.size, hi - lo + 1, `int(${lo}, ${hi}) never produced every value in the range`);
  }
  // The TEC-07 formula, checked at both edges of next()'s domain.
  assert.equal(int(queueRng([0]), 1, 6), 1);
  assert.equal(int(queueRng([0.9999999]), 1, 6), 6);
  assert.equal(int(queueRng([0.5]), 1, 100), 51);
});

test('@m01 @unit rng: chance(100) is always true, chance(0) always false', () => {
  const rng = mulberry32(fnv1a('chance'));
  for (let i = 0; i < 1000; i++) {
    assert.equal(chance(rng, 100), true);
    assert.equal(chance(rng, 0), false);
  }
  // chance is int(1,100) <= p, so it always spends exactly one draw.
  assert.equal(queueRng([0.5]).remaining(), 1);
  const q = queueRng([0.0, 0.5]);
  assert.equal(chance(q, 1), true, 'roll 1 <= 1');
  assert.equal(chance(q, 50), false, 'roll 51 > 50');
  assert.equal(q.remaining(), 0);
});

test('@m01 @unit rng: parseDice reads every dice form the catalogue uses', () => {
  const cases = [
    ['2d4+1', { n: 2, sides: 4, mod: 1 }],
    ['1d6', { n: 1, sides: 6, mod: 0 }],
    ['3d5', { n: 3, sides: 5, mod: 0 }],
    ['1d4+2', { n: 1, sides: 4, mod: 2 }],
    ['0d1+1', { n: 0, sides: 1, mod: 1 }],
    ['1 (flat)', { n: 0, sides: 1, mod: 1 }],
    ['0 (flat)', { n: 0, sides: 1, mod: 0 }],
    ['1', { n: 0, sides: 1, mod: 1 }],
  ];
  assert.equal(cases.length, 8);
  for (const [text, expected] of cases) {
    assert.deepEqual(parseDice(text), expected, `parseDice('${text}')`);
  }
  // Tolerated spelling variants; the catalogue is transcribed verbatim in M02 but stays parseable.
  assert.deepEqual(parseDice(' 1D12 '), { n: 1, sides: 12, mod: 0 });
  assert.deepEqual(parseDice('2d4 - 1'), { n: 2, sides: 4, mod: -1 });
  assert.deepEqual(parseDice({ n: 2, sides: 4, mod: 1 }), { n: 2, sides: 4, mod: 1 });
  for (const bad of ['', 'd6', '2d', 'two d four', '1d0', 'flat']) {
    assert.throws(() => parseDice(bad), `parseDice('${bad}') must throw`);
  }
});

test('@m01 @unit rng: roll sums n d-sides draws plus the modifier', () => {
  // 2d4+1 with next() = 0 -> 1 and next() = 0.99 -> 4, so 1 + 4 + 1 = 6.
  assert.equal(roll(queueRng([0, 0.99]), '2d4+1'), 6);
  assert.equal(roll(queueRng([0, 0, 0]), '3d5'), 3);
  assert.equal(roll(queueRng([0.99, 0.99, 0.99]), '3d5'), 15);
  assert.equal(roll(queueRng([0.5]), '1d6'), 4, 'int(1,6) with 0.5 is 4');

  // Flat dice consume no draws at all (n = 0).
  const flat = queueRng([]);
  assert.equal(roll(flat, '1 (flat)'), 1);
  assert.equal(roll(flat, '0 (flat)'), 0);
  assert.equal(flat.remaining(), 0);

  // The draws happen in order, one per die.
  const q = queueRng([0, 0.99]);
  assert.equal(roll(q, '2d4'), 5);
  assert.equal(q.remaining(), 0);
});

test('@m01 @unit rng: weighted walks the table in order per ITM-10', () => {
  const table = [['first', 1], ['second', 2], ['third', 3]];
  const total = 6;

  assert.equal(weighted(queueRng([0]), table), 'first', 'r = 1 is the first entry');
  assert.equal(weighted(queueRng([(total - 1) / total]), table), 'third', 'r = total is the last entry');

  // Every value of r, mapped by walking the table: 1 -> first, 2..3 -> second, 4..6 -> third.
  const expected = ['first', 'second', 'second', 'third', 'third', 'third'];
  for (let r = 1; r <= total; r++) {
    const draw = (r - 1) / total;
    assert.equal(weighted(queueRng([draw]), table), expected[r - 1], `r = ${r}`);
  }

  // Exactly one draw per roll, and table order (not weight order) decides the walk.
  const q = queueRng([0, 0]);
  assert.equal(weighted(q, [['a', 5], ['b', 1]]), 'a');
  assert.equal(weighted(q, [['b', 1], ['a', 5]]), 'b');
  assert.equal(q.remaining(), 0);

  assert.throws(() => weighted(queueRng([0]), []), /empty table/);
  assert.throws(() => weighted(queueRng([0]), [['a', 0]]), /positive integers/);
});

test('@m01 @unit rng: queueRng returns its values in order then throws when exhausted', () => {
  const q = queueRng([0.25, 0.5, 0.75]);
  assert.equal(q.next(), 0.25);
  assert.equal(q.next(), 0.5);
  assert.equal(q.next(), 0.75);
  assert.equal(q.remaining(), 0);
  assert.throws(() => q.next(), /queueRng exhausted/, 'an under-supplied test must fail loudly');
  assert.throws(() => queueRng([1]), /\[0, 1\)/, 'next() never returns 1');
  assert.throws(() => queueRng([-0.1]), /\[0, 1\)/);
  assert.throws(() => queueRng('nope'), TypeError);
});

test('@m01 @unit rng: 100,000 int(1,6) draws are flat within 15-18.5% per face', () => {
  const rng = mulberry32(fnv1a('TEST1234:play'));
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const draws = 100000;
  for (let i = 0; i < draws; i++) counts[int(rng, 1, 6)]++;
  for (let face = 1; face <= 6; face++) {
    const share = (counts[face] / draws) * 100;
    assert.ok(share >= 15 && share <= 18.5, `face ${face} came up ${share.toFixed(2)}% of the time`);
  }
  assert.equal(counts.slice(1).reduce((a, b) => a + b, 0), draws);
});
