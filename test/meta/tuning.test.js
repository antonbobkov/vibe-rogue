// DIF-02 — the tuning object is the only place a difficulty number lives.
//
// `50-difficulty-plan.md` DIF-02: "**no difficulty number may be a literal in `src/`**; the meta
// test `test/meta/tuning.test.js` asserts every key above is read somewhere in `src/` ... the test
// checks the *symbol* usage: each `TUNING.<key>` appears at least once."
//
// Engine modules read the object through `ctx.tuning` / `state.tuning` rather than by importing
// `TUNING` directly (that is the whole point — a run carries its own numbers), so "the symbol is
// used" means the key is read as a property somewhere under `src/`. A key nothing reads is a knob
// the DIF-15 ladder could turn all day with no effect, which is the failure this catches.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TUNING, TUNING_KEYS, WANDER_FLOOR_INTERVAL } from '../../data/tuning.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');
const DATA = path.join(ROOT, 'data');

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Every `src/` file as `{rel, text}`. */
const sources = jsFiles(SRC).map((file) => ({
  rel: path.relative(ROOT, file).split(path.sep).join('/'),
  text: fs.readFileSync(file, 'utf8'),
}));

/**
 * Which `src/` files read `<key>` — as a property access (`tuning.solderTurns`) or as a quoted key
 * in a lookup table (`items.js` maps each CAT-06 effect to the two tuning keys behind it). Both are
 * the symbol, which is what DIF-02 asks this scan to find.
 */
function readersOf(key) {
  const re = new RegExp(`\\.${key}\\b|['"\`]${key}['"\`]`);
  return sources.filter((s) => re.test(s.text)).map((s) => s.rel);
}

test('DIF-02: every tuning key is read somewhere under src/ @unit @m13', () => {
  assert.ok(TUNING_KEYS.length >= 20, `expected the DIF-02 knob set; found ${TUNING_KEYS.length}`);
  const unread = TUNING_KEYS.filter((key) => readersOf(key).length === 0);
  assert.deepEqual(unread, [], `tuning keys nothing in src/ reads: ${unread.join(', ')}`);
});

test('DIF-02: the tuning object is frozen data with numeric values only @unit @m13', () => {
  assert.equal(Object.isFrozen(TUNING), true, 'TUNING must be frozen');
  assert.equal(Object.isFrozen(WANDER_FLOOR_INTERVAL), true, 'WANDER_FLOOR_INTERVAL must be frozen');
  for (const key of TUNING_KEYS) {
    const value = TUNING[key];
    assert.equal(typeof value, 'number', `tuning.${key} must be a number`);
    assert.ok(Number.isFinite(value), `tuning.${key} must be finite`);
    assert.ok(value >= 0, `tuning.${key} must not be negative`);
  }
  assert.deepEqual(TUNING_KEYS, Object.keys(TUNING), 'TUNING_KEYS must list every key');
  // WLD-14's per-floor overrides are floor numbers 1-7 mapped to turn counts.
  for (const [floor, interval] of Object.entries(WANDER_FLOOR_INTERVAL)) {
    assert.ok(Number(floor) >= 1 && Number(floor) <= 7, `WANDER_FLOOR_INTERVAL floor ${floor}`);
    assert.ok(Number.isInteger(interval) && interval > 0, `WANDER_FLOOR_INTERVAL[${floor}]`);
  }
});

test('DIF-02: the difficulty numbers are not written twice @unit @m13', () => {
  // The one thing the "symbol usage" check cannot see: a module that hard-codes the *value* next
  // to the key it belongs to. These are the keys whose values are distinctive enough to grep for,
  // and `src/` may not contain the bare number as a whole word on a line that also names the rule.
  const distinctive = ['solderAmount', 'springKeyAmount', 'memoryTurns', 'cacheLockCost', 'stationRestore'];
  const offenders = [];
  for (const key of distinctive) {
    const value = String(TUNING[key]);
    for (const source of sources) {
      for (const line of source.text.split('\n')) {
        if (!line.includes(key)) continue;
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
        if (new RegExp(`(^|[^\\w.])${value}([^\\w]|$)`).test(line)) {
          offenders.push(`${source.rel}: ${line.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `DIF-02: a tuning value is hard-coded beside its key:\n${offenders.join('\n')}`);
});

test('DIF-02: data/tuning.js is data, and the engine is the only thing that merges it @unit @m13', () => {
  const text = fs.readFileSync(path.join(DATA, 'tuning.js'), 'utf8');
  assert.ok(!/\bfunction\b/.test(text), 'PLN-02 R3: data modules hold no functions');
  assert.ok(!/=>/.test(text), 'PLN-02 R3: data modules hold no arrows');

  // Every key carries a comment naming the rule it feeds (DIF-02: "with a comment naming the rule
  // it feeds"). The comment may be on the key's own line or in the block above it.
  const lines = text.split('\n');
  const missing = [];
  for (const key of TUNING_KEYS) {
    const at = lines.findIndex((line) => line.trim().startsWith(`${key}:`));
    assert.ok(at >= 0, `tuning.${key} must be declared on its own line`);
    const own = lines[at].includes('//');
    const above = lines.slice(Math.max(0, at - 4), at).some((line) => line.trim().startsWith('//'));
    if (!own && !above) missing.push(key);
  }
  assert.deepEqual(missing, [], `tuning keys with no rule named in a comment: ${missing.join(', ')}`);
});
