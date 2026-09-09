// Field of view: symmetric shadowcasting (WLD-05, TEC-08).
//
// A faithful port of Albert Ford's *Symmetric Shadowcasting* (2020) reference implementation:
// four quadrants, a row scan per quadrant, slope intervals, and the `is_symmetric` check that
// gives the algorithm its name. Two floor tiles within radius see each other or neither does
// (ACC-78), which is what lets ENM-02 use "the enemy's shadowcast reaches Tick" and
// "Tick sees the enemy" interchangeably.
//
// The reference uses Python `Fraction`s. Slopes here are pairs of integers `(num, den)` with
// `den > 0`, so there is no floating point anywhere in the scan (TEC-08).
//
// Walls are revealed even when the symmetry check fails — that is the reference's behaviour, and
// it is what "walls at the edge are visible" in ACC-78 and "the wall you can see is drawn" in
// WLD-05 ask for. Symmetry is therefore a property of the non-blocking tiles (D-008).

import { W, H, idx, inBounds, chebyshev } from './grid.js';

/** Quadrant transforms: (depth, col) in quadrant `q` -> map tile. */
function transformX(q, ox, depth, col) {
  if (q === 0 || q === 2) return ox + col; // north, south
  if (q === 1) return ox + depth; // east
  return ox - depth; // west
}

function transformY(q, oy, depth, col) {
  if (q === 0) return oy - depth; // north
  if (q === 2) return oy + depth; // south
  return oy + col; // east, west
}

/** floor(a / b) and ceil(a / b) for integer `a` and positive integer `b`. */
function floorDiv(a, b) {
  return Math.floor(a / b);
}

function ceilDiv(a, b) {
  return -Math.floor(-a / b);
}

/**
 * The tiles visible from (ox, oy) within `radius`, as a set of tile indices (`grid.idx`).
 *
 * @param {(x: number, y: number) => boolean} blocksSight walls, closed doors and the Escapement
 *        wheel (WLD-05). Tiles off the map are treated as blocking.
 * @param {number} ox origin x
 * @param {number} oy origin y
 * @param {number} radius Chebyshev radius: 8 for Tick, the enemy's `perception` otherwise
 * @returns {Set<number>} always contains the origin's own index
 */
export function computeFov(blocksSight, ox, oy, radius) {
  const seen = new Set();
  if (!inBounds(ox, oy)) return seen;
  seen.add(idx(ox, oy));
  const r = Math.floor(radius);
  if (!(r > 0)) return seen;

  for (let q = 0; q < 4; q++) {
    const isWall = (depth, col) => {
      const x = transformX(q, ox, depth, col);
      const y = transformY(q, oy, depth, col);
      if (x < 0 || y < 0 || x >= W || y >= H) return true;
      return !!blocksSight(x, y);
    };
    const reveal = (depth, col) => {
      const x = transformX(q, ox, depth, col);
      const y = transformY(q, oy, depth, col);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      if (chebyshev(ox, oy, x, y) > r) return; // the WLD-05 Chebyshev filter
      seen.add(y * W + x);
    };

    // row = { depth, sn/sd = start slope, en/ed = end slope }; start slope is mutated in place
    // by the scan, exactly as in the reference implementation.
    const scan = (row) => {
      if (row.depth > r) return;
      const minCol = floorDiv(2 * row.depth * row.sn + row.sd, 2 * row.sd);
      const maxCol = ceilDiv(2 * row.depth * row.en - row.ed, 2 * row.ed);
      let havePrev = false;
      let prevWall = false;
      for (let col = minCol; col <= maxCol; col++) {
        const wall = isWall(row.depth, col);
        const symmetric =
          col * row.sd >= row.depth * row.sn && col * row.ed <= row.depth * row.en;
        if (wall || symmetric) reveal(row.depth, col);
        if (havePrev && prevWall && !wall) {
          row.sn = 2 * col - 1;
          row.sd = 2 * row.depth;
        }
        if (havePrev && !prevWall && wall) {
          scan({ depth: row.depth + 1, sn: row.sn, sd: row.sd, en: 2 * col - 1, ed: 2 * row.depth });
        }
        havePrev = true;
        prevWall = wall;
      }
      if (havePrev && !prevWall) {
        scan({ depth: row.depth + 1, sn: row.sn, sd: row.sd, en: row.en, ed: row.ed });
      }
    };

    scan({ depth: 1, sn: -1, sd: 1, en: 1, ed: 1 });
  }
  return seen;
}
