// M01 — src/grid.js (TEC-08, ENM-08, CMB-08, WLD-11).
//
// Maps are written as ASCII rows anchored at (0, 0); every tile the rows do not mention is a wall,
// so the expected paths below are forced by geometry and can be read straight off the picture.
// Legend: '#' wall, '.' floor, '+' closed door (only the corner-cutting map uses it).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  W,
  H,
  DIRS8,
  idx,
  xOf,
  yOf,
  pointOf,
  inBounds,
  chebyshev,
  readingOrder,
  neighbors8,
  bresenham,
  bfs,
  astar,
} from '../../src/grid.js';

/** An ASCII map as a lookup: returns the character at (x, y), '#' outside the rows. */
function asciiMap(rows) {
  const chars = new Array(W * H).fill('#');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (inBounds(x, y)) chars[idx(x, y)] = ch;
    });
  });
  return (x, y) => (inBounds(x, y) ? chars[idx(x, y)] : '#');
}

/** Plain passability: anything that is not a wall may be entered, diagonals included. */
function openStep(at) {
  return (_from, to) => at(to.x, to.y) !== '#';
}

/**
 * Passability that forbids cutting a corner at a door. No rule in the game asks for this any more,
 * but it is the sharpest illustration of the callback contract: a step rule the caller owns and
 * `astar` knows nothing about. Keeping it here keeps that contract under test.
 */
function doorAwareStep(at) {
  return (from, to) => {
    if (at(to.x, to.y) === '#') return false;
    const diagonal = from.x !== to.x && from.y !== to.y;
    if (diagonal && (at(from.x, from.y) === '+' || at(to.x, to.y) === '+')) return false;
    return true;
  };
}

const p = (x, y) => ({ x, y });
const path = (...pairs) => pairs.map(([x, y]) => p(x, y));

test('@m01 @unit grid: the grid is 60 x 24 with reading-order indices and neighbours', () => {
  assert.equal(W, 60);
  assert.equal(H, 24);
  assert.equal(idx(0, 0), 0);
  assert.equal(idx(59, 23), W * H - 1);
  assert.equal(idx(3, 2), 123);
  assert.equal(xOf(123), 3);
  assert.equal(yOf(123), 2);
  assert.deepEqual(pointOf(123), p(3, 2));

  assert.equal(inBounds(0, 0), true);
  assert.equal(inBounds(59, 23), true);
  assert.equal(inBounds(-1, 0), false);
  assert.equal(inBounds(60, 0), false);
  assert.equal(inBounds(0, 24), false);

  assert.equal(chebyshev(5, 5, 5, 5), 0);
  assert.equal(chebyshev(5, 5, 8, 6), 3);
  assert.equal(chebyshev(8, 6, 5, 5), 3);
  assert.equal(chebyshev(0, 0, 3, 3), 3);

  // Reading order is ascending y, then ascending x — the same order as the tile index.
  const tiles = [p(5, 2), p(1, 3), p(0, 2), p(9, 0)];
  assert.deepEqual([...tiles].sort(readingOrder), [p(9, 0), p(0, 2), p(5, 2), p(1, 3)]);
  const byIndex = [...tiles].sort((a, b) => idx(a.x, a.y) - idx(b.x, b.y));
  assert.deepEqual([...tiles].sort(readingOrder), byIndex);

  assert.deepEqual(
    DIRS8.map((d) => [d.dx, d.dy]),
    [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
  );
  assert.deepEqual(
    neighbors8(5, 5),
    path([4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6], [6, 6]),
  );
  assert.deepEqual(neighbors8(0, 0), path([1, 0], [0, 1], [1, 1]), 'neighbours are clipped to the map');
  assert.equal(neighbors8(59, 23).length, 3);
});

test('@m01 @unit grid: bresenham matches TEC-08 on twelve hand-computed lines', () => {
  const lines = [
    // both axis families, both directions
    [[5, 5], [8, 5], path([6, 5], [7, 5], [8, 5])],
    [[5, 5], [2, 5], path([4, 5], [3, 5], [2, 5])],
    [[5, 5], [5, 8], path([5, 6], [5, 7], [5, 8])],
    [[5, 5], [5, 2], path([5, 4], [5, 3], [5, 2])],
    // the four pure diagonals
    [[5, 5], [8, 8], path([6, 6], [7, 7], [8, 8])],
    [[5, 5], [2, 2], path([4, 4], [3, 3], [2, 2])],
    [[5, 5], [8, 2], path([6, 4], [7, 3], [8, 2])],
    [[5, 5], [2, 8], path([4, 6], [3, 7], [2, 8])],
    // shallow octant, and the diagonal tie: the line runs exactly through the corner at (2,1)
    // and at (4,2), so both branches fire and the step is diagonal
    [[0, 0], [4, 2], path([1, 0], [2, 1], [3, 1], [4, 2])],
    [[0, 0], [5, 2], path([1, 0], [2, 1], [3, 1], [4, 2], [5, 2])],
    // steep octant family (dy > dx), and the same shallow line mirrored into the third octant
    [[0, 0], [2, 4], path([0, 1], [1, 2], [1, 3], [2, 4])],
    [[10, 10], [6, 8], path([9, 10], [8, 9], [7, 9], [6, 8])],
  ];
  assert.equal(lines.length, 12);
  for (const [[x0, y0], [x1, y1], expected] of lines) {
    const got = bresenham(x0, y0, x1, y1);
    assert.deepEqual(got, expected, `bresenham(${x0},${y0} -> ${x1},${y1})`);
    assert.deepEqual(got[got.length - 1], p(x1, y1), 'the end tile is included');
    assert.ok(!got.some((t) => t.x === x0 && t.y === y0), 'the start tile is excluded');
    // Every emitted tile is one step from the previous one.
    let prev = p(x0, y0);
    for (const t of got) {
      assert.equal(chebyshev(prev.x, prev.y, t.x, t.y), 1, 'steps are single tiles');
      prev = t;
    }
  }
  // A degenerate line stops as soon as the end tile is emitted, which happens before any step.
  assert.deepEqual(bresenham(3, 3, 3, 3), [p(3, 3)]);
});

test('@m01 @unit grid: bfs gives 8-connected step distances over passable tiles', () => {
  const rows = [
    '#####',
    '#...#',
    '#.#.#',
    '#...#',
    '#####',
  ];
  const at = asciiMap(rows);
  const dist = bfs(openStep(at), p(1, 1));

  const expected = [
    [1, 1, 0], [2, 1, 1], [3, 1, 2],
    [1, 2, 1], [3, 2, 2],
    [1, 3, 2], [2, 3, 2], [3, 3, 3],
  ];
  for (const [x, y, d] of expected) assert.equal(dist[idx(x, y)], d, `distance to (${x},${y})`);
  assert.equal(dist[idx(2, 2)], -1, 'the wall in the middle is unreachable');
  assert.equal(dist[idx(0, 0)], -1, 'the surrounding wall is unreachable');
  assert.equal(dist[idx(40, 12)], -1, 'tiles off the map fragment are unreachable');
  assert.equal(dist.length, W * H);
  assert.equal([...dist].filter((d) => d >= 0).length, 8, 'exactly the eight floor tiles are reached');

  // Multi-source: every source is distance 0 and the fronts meet.
  const both = bfs(openStep(at), [p(1, 1), p(3, 3)]);
  assert.equal(both[idx(1, 1)], 0);
  assert.equal(both[idx(3, 3)], 0);
  assert.equal(both[idx(3, 1)], 2);
  assert.equal(both[idx(2, 3)], 1);

  // Two sealed halves: BFS never crosses the wall.
  const split = asciiMap(['#####', '#.#.#', '#.#.#', '#####']);
  const half = bfs(openStep(split), p(1, 1));
  assert.equal(half[idx(1, 2)], 1);
  assert.equal(half[idx(3, 1)], -1);
});

test('@m01 @unit grid: astar finds the unique shortest path on five maps', () => {
  const maps = [
    {
      name: 'straight corridor',
      rows: ['##########', '#........#', '##########'],
      from: p(1, 1),
      to: p(8, 1),
      expected: path([2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1]),
    },
    {
      name: 'L corridor (the corner is cut diagonally)',
      rows: ['#####', '#...#', '###.#', '###.#', '###.#', '#####'],
      from: p(1, 1),
      to: p(3, 4),
      expected: path([2, 1], [3, 2], [3, 3], [3, 4]),
    },
    {
      name: 'diagonal staircase',
      rows: ['########', '#.######', '##.#####', '###.####', '####.###', '#####.##', '######.#', '########'],
      from: p(1, 1),
      to: p(6, 6),
      expected: path([2, 2], [3, 3], [4, 4], [5, 5], [6, 6]),
    },
    {
      name: 'two corridors joined by one gap',
      rows: ['##########', '#........#', '#####.####', '#........#', '##########'],
      from: p(1, 1),
      to: p(1, 3),
      expected: path([2, 1], [3, 1], [4, 1], [5, 2], [4, 3], [3, 3], [2, 3], [1, 3]),
    },
    {
      name: 'dog-leg with a dead end',
      rows: ['#######', '#.#...#', '#.#.#.#', '#...#.#', '#####.#', '#######'],
      from: p(1, 1),
      to: p(5, 3),
      expected: path([1, 2], [2, 3], [3, 2], [4, 1], [5, 2], [5, 3]),
    },
  ];

  for (const m of maps) {
    const at = asciiMap(m.rows);
    const got = astar(openStep(at), m.from, m.to, { maxLen: 60 });
    assert.deepEqual(got, m.expected, `astar on the ${m.name}`);
    // The path is a legal walk: single steps, all passable, start excluded, goal included.
    let prev = m.from;
    for (const step of got) {
      assert.equal(chebyshev(prev.x, prev.y, step.x, step.y), 1);
      assert.notEqual(at(step.x, step.y), '#');
      prev = step;
    }
    assert.deepEqual(got[got.length - 1], m.to);
    // It really is shortest: BFS over the same predicate agrees on the length.
    const dist = bfs(openStep(at), m.from);
    assert.equal(got.length, dist[idx(m.to.x, m.to.y)], `${m.name}: astar length equals the BFS distance`);
  }

  assert.deepEqual(astar(openStep(asciiMap(['###', '#.#', '###'])), p(1, 1), p(1, 1)), [], 'from === to is no steps');
});

test('@m01 @unit grid: astar returns null when there is no path or the path is longer than maxLen', () => {
  const sealed = asciiMap(['#####', '#.#.#', '#.#.#', '#####']);
  assert.equal(astar(openStep(sealed), p(1, 1), p(3, 2)), null, 'sealed halves have no path');

  const corridor = asciiMap(['##########', '#........#', '##########']);
  assert.equal(astar(openStep(corridor), p(1, 1), p(8, 1), { maxLen: 5 }), null, '7 steps exceeds maxLen 5');
  assert.equal(astar(openStep(corridor), p(1, 1), p(8, 1), { maxLen: 7 }).length, 7, 'a path of exactly maxLen is kept');

  // A serpentine whose shortest route is 78 steps: over the ENM-08 cap of 60, so "no path".
  const rows = [];
  rows[0] = '#'.repeat(42);
  rows[1] = `#${'.'.repeat(40)}#`;
  rows[2] = `${'#'.repeat(40)}.#`;
  rows[3] = `#${'.'.repeat(40)}#`;
  rows[4] = '#'.repeat(42);
  const snake = asciiMap(rows);
  assert.equal(astar(openStep(snake), p(1, 1), p(1, 3)), null, 'the default cap is 60 steps');
  const long = astar(openStep(snake), p(1, 1), p(1, 3), { maxLen: 100 });
  assert.equal(long.length, 78);
  assert.deepEqual(long[long.length - 1], p(1, 3));

  assert.equal(astar(openStep(corridor), p(1, 1), p(-1, 1)), null, 'off-map destinations have no path');
});

test('@m01 @unit grid: astar takes step legality from its passability callback', () => {
  // A door at (3,2) is the only way between the two halves. The two callbacks differ on one thing
  // only — whether the diagonal shortcut through the door is legal — and astar follows each.
  const rows = ['#######', '#.....#', '###+###', '#.....#', '#######'];
  const at = asciiMap(rows);

  assert.deepEqual(
    astar(openStep(at), p(1, 1), p(1, 3)),
    path([2, 1], [3, 2], [2, 3], [1, 3]),
    'a callback that allows the corner cut: 4 steps',
  );
  assert.deepEqual(
    astar(doorAwareStep(at), p(1, 1), p(1, 3)),
    path([2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3]),
    'a callback that forbids it: the door is entered and left straight on, in 6 steps',
  );
});

test('@m01 ACC-91 grid: astar is deterministic and breaks ties by reading order', () => {
  // A symmetric fork: (1,2) on the left and (3,2) on the right are both one step from the start
  // and one step from the goal. ENM-08 breaks the tie by f, then h, then reading order, and
  // (1,2) has the lower tile index (121 < 123).
  const rows = ['#####', '#...#', '#.#.#', '#...#', '#####'];
  const at = asciiMap(rows);
  const from = p(2, 1);
  const to = p(2, 3);

  const first = astar(openStep(at), from, to);
  assert.deepEqual(first, path([1, 2], [2, 3]), 'the tie goes to the lower reading-order tile');
  assert.ok(idx(1, 2) < idx(3, 2));

  for (let i = 0; i < 10; i++) {
    assert.deepEqual(astar(openStep(at), from, to), first, 'identical inputs give an identical array');
  }
  assert.notEqual(astar(openStep(at), from, to), first, 'a fresh array is returned each call');

  // The mirrored fork resolves the other way for the same reason: (1,2) is still the lower tile.
  const mirrored = astar(openStep(at), p(2, 3), p(2, 1));
  assert.deepEqual(mirrored, path([1, 2], [2, 1]));

  // Determinism does not depend on the order the caller asks: a longer map, repeated.
  const bigRows = ['##########', '#........#', '#.######.#', '#........#', '##########'];
  const bigAt = asciiMap(bigRows);
  const big = astar(openStep(bigAt), p(1, 1), p(8, 3));
  for (let i = 0; i < 10; i++) assert.deepEqual(astar(openStep(bigAt), p(1, 1), p(8, 3)), big);
  assert.equal(big.length, bfs(openStep(bigAt), p(1, 1))[idx(8, 3)]);
});
