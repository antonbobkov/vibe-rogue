// Randomness, string hashing, and dice (TEC-07, TEC-03, ITM-10).
//
// Every random draw in the game goes through this module so that a seed string plus a sequence of
// player actions reproduces a run exactly. Nothing here touches the DOM (PLN-02 R2) and nothing
// here calls Math.random: the callers own their streams.
//
//   floorRng(n) = mulberry32(fnv1a(seedString + ':floor:' + n))
//   playRng     = mulberry32(fnv1a(seedString + ':play'))
//
// An "rng" is any object with `next() -> float in [0, 1)`. `mulberry32` adds `getState`/`setState`
// so the play stream can be serialized (TEC-09); `queueRng` is the scripted stand-in used by tests.

/**
 * The mulberry32 PRNG named by TEC-07, with its 32-bit state exposed.
 *
 * @param {number} seed unsigned 32-bit seed (anything else is coerced with `>>> 0`)
 * @returns {{next: () => number, getState: () => number, setState: (s: number) => void}}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    getState() {
      return a;
    },
    setState(s) {
      a = s >>> 0;
    },
  };
}

/**
 * FNV-1a, 32-bit, over the UTF-8 bytes of `str` (TEC-07).
 *
 * The UTF-8 expansion is done by hand rather than through TextEncoder so the module has no
 * platform surface at all. Lone surrogates are encoded as U+FFFD, matching TextEncoder.
 *
 * @param {string} str
 * @returns {number} unsigned 32-bit hash
 */
export function fnv1a(str) {
  let h = 2166136261 >>> 0;
  const mix = (byte) => {
    h ^= byte;
    h = Math.imul(h, 16777619) >>> 0;
  };
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code < 0x80) {
      mix(code);
    } else if (code < 0x800) {
      mix(0xc0 | (code >> 6));
      mix(0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      mix(0xe0 | (code >> 12));
      mix(0x80 | ((code >> 6) & 0x3f));
      mix(0x80 | (code & 0x3f));
    } else {
      mix(0xf0 | (code >> 18));
      mix(0x80 | ((code >> 12) & 0x3f));
      mix(0x80 | ((code >> 6) & 0x3f));
      mix(0x80 | (code & 0x3f));
    }
  }
  return h >>> 0;
}

/**
 * A scripted stand-in for an rng (PLN-03, PLN-04): `next()` hands back `values` in order and then
 * throws, so a test that under-supplies draws fails loudly instead of drifting into real randomness.
 *
 * @param {number[]} values the floats `next()` should return, each in [0, 1)
 */
export function queueRng(values) {
  if (!Array.isArray(values)) throw new TypeError('queueRng: expected an array of floats in [0, 1)');
  values.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v >= 1) {
      throw new RangeError(`queueRng: value ${i} is ${v}; every value must be a float in [0, 1)`);
    }
  });
  const queue = values.slice();
  let i = 0;
  return {
    next() {
      if (i >= queue.length) {
        throw new Error(`queueRng exhausted: ${queue.length} value(s) supplied, draw ${i + 1} requested`);
      }
      return queue[i++];
    },
    /** How many scripted values are still unconsumed (test convenience). */
    remaining() {
      return queue.length - i;
    },
  };
}

/**
 * Inclusive uniform integer in [lo, hi] (TEC-07): `lo + floor(next() * (hi - lo + 1))`.
 */
export function int(rng, lo, hi) {
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new TypeError('int: bounds must be integers');
  if (hi < lo) throw new RangeError(`int: empty range [${lo}, ${hi}]`);
  return lo + Math.floor(rng.next() * (hi - lo + 1));
}

/**
 * A percentage check (TEC-07): `int(1, 100) <= p`. `chance(rng, 100)` is always true and
 * `chance(rng, 0)` always false, and both still consume exactly one draw.
 */
export function chance(rng, p) {
  return int(rng, 1, 100) <= p;
}

const DICE_RE = /^(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?$/;
const FLAT_RE = /^([+-]?\d+)\s*(?:\(\s*flat\s*\))?$/;

/**
 * Parse a dice string into the TEC-03 `Dice` shape.
 *
 *   '2d4+1'    -> { n: 2, sides: 4, mod: 1 }
 *   '1 (flat)' -> { n: 0, sides: 1, mod: 1 }
 *   '1'        -> { n: 0, sides: 1, mod: 1 }
 *
 * A `Dice` object is passed through unchanged, so callers may hand `roll` either form.
 *
 * @param {string|{n: number, sides: number, mod: number}} spec
 * @returns {{n: number, sides: number, mod: number}}
 */
export function parseDice(spec) {
  if (spec && typeof spec === 'object') {
    const { n, sides, mod } = spec;
    if (Number.isInteger(n) && Number.isInteger(sides) && Number.isInteger(mod)) return { n, sides, mod };
    throw new TypeError('parseDice: object form must be {n, sides, mod} integers');
  }
  if (typeof spec !== 'string') throw new TypeError(`parseDice: expected a string, got ${typeof spec}`);
  const s = spec.trim().toLowerCase();
  const dice = DICE_RE.exec(s);
  if (dice) {
    const n = Number(dice[1]);
    const sides = Number(dice[2]);
    if (sides < 1) throw new RangeError(`parseDice: '${spec}' has ${sides} sides`);
    const mod = dice[4] === undefined ? 0 : (dice[3] === '-' ? -1 : 1) * Number(dice[4]);
    return { n, sides, mod };
  }
  const flat = FLAT_RE.exec(s);
  if (flat) return { n: 0, sides: 1, mod: Number(flat[1]) };
  throw new SyntaxError(`parseDice: cannot parse '${spec}'`);
}

/**
 * Roll dice (TEC-07): the sum of `n` calls to `int(1, sides)` plus `mod`. Flat dice (`n = 0`)
 * consume no draws.
 */
export function roll(rng, dice) {
  const { n, sides, mod } = parseDice(dice);
  let total = mod;
  for (let i = 0; i < n; i++) total += int(rng, 1, sides);
  return total;
}

/**
 * Walk a weighted table exactly as ITM-10 says: `total = sum of weights`, draw `r` uniformly from
 * `[1, total]`, subtract weights in table order until `r <= 0`, and return that entry's value.
 * Exactly one draw is consumed.
 *
 * @param {[unknown, number][]} table `(value, weight)` pairs with positive integer weights
 */
export function weighted(rng, table) {
  if (!Array.isArray(table) || table.length === 0) throw new RangeError('weighted: empty table');
  let total = 0;
  for (const entry of table) {
    const w = entry[1];
    if (!Number.isInteger(w) || w <= 0) throw new RangeError(`weighted: '${entry[0]}' has weight ${w}; weights are positive integers`);
    total += w;
  }
  let r = int(rng, 1, total);
  for (const entry of table) {
    r -= entry[1];
    if (r <= 0) return entry[0];
  }
  return table[table.length - 1][0]; // unreachable while weights are positive
}
