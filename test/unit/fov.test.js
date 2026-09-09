// M01 — src/fov.js (WLD-05, TEC-08, ACC-78).
//
// Symmetry is the property that matters: a naive ray cast passes every other check here and fails
// the first one. Walls are deliberately outside the symmetry claim — the reference implementation
// reveals a wall whenever any scan line touches it, which is what "walls at the edge are visible"
// asks for (D-008).

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeFov } from '../../src/fov.js';
import { W, H, idx, chebyshev, inBounds } from '../../src/grid.js';
import { mulberry32, fnv1a } from '../../src/rng.js';

/** A map of walls: every tile is a wall unless `carve` opens it. */
function walls() {
  const grid = new Uint8Array(W * H).fill(1);
  return {
    grid,
    blocks: (x, y) => grid[idx(x, y)] === 1,
    open(x, y) {
      grid[idx(x, y)] = 0;
    },
    /** Open the rectangle [x0..x1] x [y0..y1] inclusive. */
    room(x0, y0, x1, y1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[idx(x, y)] = 0;
      return this;
    },
  };
}

/** Every open tile of a map, in reading order. */
function floorsOf(map) {
  const out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map.grid[idx(x, y)] === 0) out.push({ x, y });
  return out;
}

/** A seeded random map: a `size` x `size` block of walls and floor at (x0, y0). */
function randomMap(seed, x0, y0, size, wallChance) {
  const map = walls();
  const rng = mulberry32(fnv1a(`fov:${seed}`));
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) if (rng.next() >= wallChance) map.open(x, y);
  }
  return map;
}

test('@m01 ACC-78 fov: two floor tiles within radius see each other or neither does', () => {
  let pairs = 0;
  let mutual = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const map = randomMap(seed, 4, 4, 15, 0.3);
    const floors = floorsOf(map);
    assert.ok(floors.length > 100, `seed ${seed} produced a degenerate map`);

    const views = new Map();
    for (const f of floors) views.set(idx(f.x, f.y), computeFov(map.blocks, f.x, f.y, 8));

    for (const a of floors) {
      const aView = views.get(idx(a.x, a.y));
      assert.ok(aView.has(idx(a.x, a.y)), 'the origin is always visible');
      for (const b of floors) {
        if (chebyshev(a.x, a.y, b.x, b.y) > 8) continue;
        pairs++;
        const aSeesB = aView.has(idx(b.x, b.y));
        const bSeesA = views.get(idx(b.x, b.y)).has(idx(a.x, a.y));
        if (aSeesB) mutual++;
        assert.equal(
          aSeesB,
          bSeesA,
          `seed ${seed}: (${a.x},${a.y}) sees (${b.x},${b.y}) = ${aSeesB} but the reverse is ${bSeesA}`,
        );
      }
    }
  }
  assert.ok(pairs > 1000000, `expected a large sample, checked ${pairs} pairs`);
  assert.ok(mutual > 0 && mutual < pairs, 'the maps must both reveal and hide things');
});

test('@m01 ACC-78 fov: nothing is visible beyond Chebyshev 8 and the origin always is', () => {
  const open = walls().room(0, 0, W - 1, H - 1);

  const seen = computeFov(open.blocks, 30, 12, 8);
  assert.equal(seen.size, 17 * 17, 'an open field within radius 8 is the full 17 x 17 block');
  for (const i of seen) {
    const x = i % W;
    const y = (i - x) / W;
    assert.ok(chebyshev(30, 12, x, y) <= 8, `(${x},${y}) is beyond Chebyshev 8`);
  }
  for (let d = 0; d <= 8; d++) assert.ok(seen.has(idx(30 + d, 12 + d)), `the diagonal tile at ${d} is visible`);
  assert.ok(!seen.has(idx(39, 12)), 'a tile at Chebyshev 9 is not visible');
  assert.ok(seen.has(idx(38, 20)), 'the diagonal corner at Chebyshev 8 is visible');
  assert.ok(!seen.has(idx(39, 20)), 'one tile further out, at Chebyshev 9, is not');

  // The radius is a parameter: an enemy's perception (ENM-02) uses the same function.
  assert.equal(computeFov(open.blocks, 30, 12, 4).size, 9 * 9);
  assert.equal(computeFov(open.blocks, 30, 12, 1).size, 9);
  assert.deepEqual([...computeFov(open.blocks, 30, 12, 0)], [idx(30, 12)], 'radius 0 is the origin alone');

  // The map edge clips the view without breaking it.
  const corner = computeFov(open.blocks, 0, 0, 8);
  assert.equal(corner.size, 9 * 9);
  assert.ok(corner.has(idx(0, 0)));
  for (const i of corner) assert.ok(inBounds(i % W, Math.floor(i / W)));
});

test('@m01 ACC-78 fov: a sealed 5 x 5 room shows exactly its interior and its wall ring', () => {
  const map = walls().room(10, 5, 14, 9); // interior 5 x 5, wall ring at x = 9/15, y = 4/10
  const expected = new Set();
  for (let y = 4; y <= 10; y++) for (let x = 9; x <= 15; x++) expected.add(idx(x, y));

  for (const origin of [{ x: 12, y: 7 }, { x: 10, y: 5 }, { x: 14, y: 9 }, { x: 10, y: 9 }, { x: 14, y: 5 }]) {
    const seen = computeFov(map.blocks, origin.x, origin.y, 8);
    assert.deepEqual(
      [...seen].sort((a, b) => a - b),
      [...expected].sort((a, b) => a - b),
      `from (${origin.x},${origin.y}): 25 interior tiles plus the 24 wall tiles around them`,
    );
    assert.equal(seen.size, 49);
  }
});

test('@m01 ACC-78 fov: a wall next to the origin is visible and hides what is behind it', () => {
  const map = walls().room(2, 2, 30, 20);
  map.grid[idx(13, 10)] = 1; // a single pillar three tiles east of the origin

  const seen = computeFov(map.blocks, 10, 10, 8);
  assert.ok(seen.has(idx(13, 10)), 'the blocking tile itself is visible');
  assert.ok(!seen.has(idx(14, 10)), 'the tile directly behind it on the straight line is not');
  assert.ok(!seen.has(idx(15, 10)), 'nor is the next one');
  assert.ok(seen.has(idx(12, 10)), 'the tile in front of it is visible');
  assert.ok(seen.has(idx(14, 9)), 'the shadow is only the straight line behind the pillar');

  // A wall in the 8-neighbourhood of the origin is always visible (WLD-05: the wall you can see is drawn).
  const boxed = walls().room(5, 5, 25, 18);
  const seenBoxed = computeFov(boxed.blocks, 5, 5, 8);
  for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [4, 6]]) {
    assert.ok(seenBoxed.has(idx(x, y)), `the adjacent wall at (${x},${y}) is visible`);
  }
});

test('@m01 ACC-78 fov: standing in a room corner matches an enemy looking back', () => {
  // A room whose interior is larger than the radius, so the far walls really are out of range.
  const map = walls().room(10, 5, 25, 15);
  const tick = { x: 10, y: 5 }; // the north-west interior corner
  const tickView = computeFov(map.blocks, tick.x, tick.y, 8);

  assert.ok(tickView.has(idx(9, 4)), 'the corner wall behind Tick is visible');
  for (let x = 9; x <= 18; x++) assert.ok(tickView.has(idx(x, 4)), `the north wall at x=${x} is visible`);
  for (let y = 4; y <= 13; y++) assert.ok(tickView.has(idx(9, y)), `the west wall at y=${y} is visible`);
  assert.ok(!tickView.has(idx(19, 4)), 'the north wall stops at Chebyshev 8');
  assert.ok(tickView.has(idx(18, 13)), 'the far interior corner of the radius is visible in an open room');

  // "Symmetric with an enemy's view": every enemy tile Tick can see, sees Tick back.
  for (const enemy of floorsOf(map)) {
    const d = chebyshev(tick.x, tick.y, enemy.x, enemy.y);
    if (d > 8) continue;
    const enemyView = computeFov(map.blocks, enemy.x, enemy.y, 8);
    assert.equal(
      tickView.has(idx(enemy.x, enemy.y)),
      enemyView.has(idx(tick.x, tick.y)),
      `(${enemy.x},${enemy.y}) at distance ${d}`,
    );
  }

  // The same holds with the smaller perception radius an enemy actually uses, as long as the
  // distance is inside both radii (WLD-05).
  const enemy = { x: 14, y: 9 };
  const enemyView = computeFov(map.blocks, enemy.x, enemy.y, 6);
  assert.ok(chebyshev(tick.x, tick.y, enemy.x, enemy.y) <= 6);
  assert.equal(tickView.has(idx(enemy.x, enemy.y)), enemyView.has(idx(tick.x, tick.y)));
});
