// Grid maths: indexing, Chebyshev distance, reading order, Bresenham, BFS and A*
// (TEC-08, ENM-08, CMB-08, WLD-11).
//
// Conventions used across the whole codebase (D-006):
//   * A tile is a plain point `{x, y}`; `x` grows right, `y` grows down.
//   * A tile index is `idx(x, y) = y * W + x`, the key TEC-08 names for the A* heap.
//   * "Reading order" is ascending `y`, then ascending `x` — the same order as the index.
//   * Passability is always injected as a callback `(from, to) => boolean` taking the *step*, not
//     the tile, so the ENM-08 door-diagonal rule and the per-enemy `opensDoors` rule live in the
//     caller and this module stays free of tile semantics.
//   * `bfs` returns an `Int32Array` of length `W * H`, distance in steps, `-1` for unreachable.
//   * `astar` returns the steps *after* the start, up to and including the destination, or `null`.

/** The play field is 60 x 24 tiles (TEC-05; the 80 x 30 cell buffer of UI-02 is a render concern). */
export const W = 60;
export const H = 24;

/** The 8 neighbourhood offsets, in reading order (TEC-08). */
export const DIRS8 = Object.freeze([
  Object.freeze({ dx: -1, dy: -1 }),
  Object.freeze({ dx: 0, dy: -1 }),
  Object.freeze({ dx: 1, dy: -1 }),
  Object.freeze({ dx: -1, dy: 0 }),
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: -1, dy: 1 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: 1, dy: 1 }),
]);

/** Tile index for (x, y). Callers are expected to have checked `inBounds` first. */
export function idx(x, y) {
  return y * W + x;
}

/** The x of a tile index. */
export function xOf(i) {
  return i % W;
}

/** The y of a tile index. */
export function yOf(i) {
  return (i - (i % W)) / W;
}

/** The tile a tile index names. */
export function pointOf(i) {
  const x = i % W;
  return { x, y: (i - x) / W };
}

/** Is (x, y) on the map? */
export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < W && y < H;
}

/** Chebyshev distance `max(|dx|, |dy|)` — the game's one distance metric (WLD-05, CMB-08). */
export function chebyshev(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy);
}

/**
 * Comparator for `Array#sort`: reading order, ascending `y` then ascending `x` (TEC-08).
 * Accepts points `{x, y}`.
 */
export function readingOrder(a, b) {
  return a.y - b.y || a.x - b.x;
}

/**
 * The 8 neighbours of (x, y) that are on the map, in reading order.
 * Passability is not considered — that is the caller's predicate.
 */
export function neighbors8(x, y) {
  const out = [];
  for (const { dx, dy } of DIRS8) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(nx, ny)) out.push({ x: nx, y: ny });
  }
  return out;
}

/**
 * The Bresenham line of TEC-08, integer form. The start tile is excluded and the end tile is
 * included, which is exactly the projectile path CMB-08 walks. Both branches may fire in one
 * iteration, producing a diagonal step.
 *
 * A degenerate line (start === end) yields `[start]`: the algorithm stops as soon as the end tile
 * has been emitted, and here that happens before any step is taken (D-007).
 *
 * @returns {{x: number, y: number}[]}
 */
export function bresenham(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = Math.sign(x1 - x0);
  const sy = Math.sign(y1 - y0);
  let err = dx - dy;
  let x = x0;
  let y = y0;
  const out = [];
  const guard = 4 * (dx + dy) + 8; // the loop is bounded; this only turns a bug into a throw
  for (let steps = 0; ; steps++) {
    if (steps > guard) throw new Error(`bresenham: runaway line (${x0},${y0})->(${x1},${y1})`);
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    out.push({ x, y });
    if (x === x1 && y === y1) return out;
  }
}

/**
 * Breadth-first distances over the 8-connected passable tiles (TEC-08, WLD-11 step 5).
 *
 * @param {(from: {x: number, y: number}, to: {x: number, y: number}) => boolean} passable
 * @param {{x: number, y: number}|{x: number, y: number}[]} starts one or more sources, distance 0
 * @returns {Int32Array} `W * H` distances in steps; `-1` where unreachable
 */
export function bfs(passable, starts) {
  const dist = new Int32Array(W * H).fill(-1);
  const sources = Array.isArray(starts) ? starts : [starts];
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  for (const s of sources) {
    if (!inBounds(s.x, s.y)) continue;
    const i = idx(s.x, s.y);
    if (dist[i] !== -1) continue;
    dist[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    const y = (i - x) / W;
    const d = dist[i];
    for (const { dx, dy } of DIRS8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = ny * W + nx;
      if (dist[ni] !== -1) continue;
      if (!passable({ x, y }, { x: nx, y: ny })) continue;
      dist[ni] = d + 1;
      queue[tail++] = ni;
    }
  }
  return dist;
}

/** Binary min-heap over `{f, h, i}` nodes, ordered by f, then h, then tile index (TEC-08). */
class Heap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  static before(a, b) {
    return a.f - b.f || a.h - b.h || a.i - b.i;
  }

  push(node) {
    const items = this.items;
    items.push(node);
    let c = items.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (Heap.before(items[c], items[p]) >= 0) break;
      const t = items[c];
      items[c] = items[p];
      items[p] = t;
      c = p;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = l + 1;
        let best = p;
        if (l < items.length && Heap.before(items[l], items[best]) < 0) best = l;
        if (r < items.length && Heap.before(items[r], items[best]) < 0) best = r;
        if (best === p) break;
        const t = items[p];
        items[p] = items[best];
        items[best] = t;
        p = best;
      }
    }
    return top;
  }
}

/**
 * A* on the 8-connected grid per ENM-08: cost 1 per step (diagonals included), Chebyshev
 * heuristic, ties broken by lowest `f`, then lowest `h`, then reading order of the tile.
 * Fully deterministic (ACC-91).
 *
 * @param {(from: {x: number, y: number}, to: {x: number, y: number}) => boolean} passable
 *        whether the *step* from one tile to an adjacent tile may be taken. The door-diagonal rule,
 *        `opensDoors`, hazards and occupancy all live here.
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {{maxLen?: number}} [options] path length cap, default 60 (ENM-08)
 * @returns {{x: number, y: number}[]|null} the steps after `from` up to and including `to`, or
 *          `null` when there is no path within the cap. `from === to` yields `[]`.
 */
export function astar(passable, from, to, options = {}) {
  const maxLen = options.maxLen === undefined ? 60 : options.maxLen;
  if (!inBounds(from.x, from.y) || !inBounds(to.x, to.y)) return null;
  const start = idx(from.x, from.y);
  const goal = idx(to.x, to.y);
  if (start === goal) return [];
  if (chebyshev(from.x, from.y, to.x, to.y) > maxLen) return null;

  const size = W * H;
  const g = new Int32Array(size).fill(-1);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = new Heap();

  g[start] = 0;
  const h0 = chebyshev(from.x, from.y, to.x, to.y);
  open.push({ f: h0, h: h0, i: start });

  while (open.size > 0) {
    const node = open.pop();
    if (closed[node.i]) continue;
    closed[node.i] = 1;
    if (node.i === goal) {
      const path = [];
      for (let i = goal; i !== start; i = cameFrom[i]) path.push(pointOf(i));
      path.reverse();
      return path;
    }
    const cg = g[node.i];
    if (cg >= maxLen) continue; // any extension would exceed the ENM-08 cap
    const x = node.i % W;
    const y = (node.i - x) / W;
    for (const { dx, dy } of DIRS8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const ng = cg + 1;
      if (g[ni] !== -1 && ng >= g[ni]) continue;
      if (!passable({ x, y }, { x: nx, y: ny })) continue;
      g[ni] = ng;
      cameFrom[ni] = node.i;
      const nh = chebyshev(nx, ny, to.x, to.y);
      open.push({ f: ng + nh, h: nh, i: ni });
    }
  }
  return null;
}
