// Travel and Shift-run step policies (UI-13, UI-10, TEC-11).
//
// Pure: this module plans a path, takes one step at a time through `game.act`, and decides when to
// stop. It owns no timers and touches no DOM — `main.js` calls `step()` from a 60 ms timer for
// Travel and a 40 ms timer for Shift-run (PLN-02 R2, TEC-11).

import { astar, chebyshev, neighbors8, idx } from './grid.js';
import { TILE, walkable, hazardActive } from './tiles.js';
import { diagonalThroughDoor } from './ai.js';
import * as combat from './combat.js';
import * as items from './items.js';
import * as log from './log.js';

/** TEC-11: "Travel ... executes one step per 60 ms"; Shift-run repeats "on a 40 ms timer". */
export const TRAVEL_STEP_MS = 60;
export const RUN_STEP_MS = 40;

/** ENM-08's path cap, which UI-13 reuses ("`ENM-08`'s A* with Tick's passability"). */
export const PATH_CAP = 60;

/** UI-13's two Tension thresholds — travel stops when Tension crosses either. */
export const TENSION_STOPS = Object.freeze([30, 15]);

/** The stop reasons `step()` reports. `arrived` and `blocked` are not interruptions. */
export const STOP = Object.freeze({
  ARRIVED: 'arrived',
  FAILED: 'failed',
  ENEMY: 'enemy',
  DAMAGE: 'damage',
  TENSION: 'tension',
  ITEM: 'item',
  FEATURE: 'feature',
  INPUT: 'input',
  BLOCKED: 'blocked',
  EVENT: 'event',
});

/** The reasons UI-13 calls an interruption, which log SCR-10's "Tick stops." */
const INTERRUPTIONS = new Set([STOP.ENEMY, STOP.DAMAGE, STOP.TENSION, STOP.ITEM, STOP.FEATURE, STOP.INPUT]);

/** ITM-07 / UI-13: the feature tiles that stop a travel when Tick ends a step on one. */
const FEATURE_TILES = new Set([TILE.STAIRS_UP, TILE.STATION]);

/**
 * Tick's passability for UI-13's Travel: "closed doors passable — they are opened on bump; hazards
 * avoided unless no other path; enemies impassable", plus ENM-08's diagonal-door rule.
 *
 * @param {object} state
 * @param {boolean} hazardsPassable the second pass, taken only when the first finds no path
 */
export function tickPassable(state, hazardsPassable) {
  const tiles = state.floor.tiles;
  return (from, to) => {
    if (diagonalThroughDoor(tiles, from, to)) return false;
    const t = tiles[to.y][to.x];
    // A closed door is passable: bumping it opens it (a successful step, UI-13).
    if (t !== TILE.DOOR_CLOSED && !walkable(t)) return false;
    if (!hazardsPassable) {
      const cfg = combat.hazardAt(state, to.x, to.y);
      if (cfg) {
        if (cfg.mechanism === 'CONSTANT') return false;
        if (hazardActive(cfg.kind, state.turn) || hazardActive(cfg.kind, state.turn + 1)) return false;
      }
    }
    const actor = combat.actorAt(state, to.x, to.y);
    if (actor && actor !== state.tick) return false;
    return true;
  };
}

/**
 * The path Tick takes to `(tx, ty)`, hazards avoided when possible (UI-13).
 *
 * @returns {{x: number, y: number}[]|null} the steps after Tick's tile, or null when unreachable
 */
export function travelPathTo(state, tx, ty) {
  const from = { x: state.tick.x, y: state.tick.y };
  const to = { x: tx, y: ty };
  if (from.x === to.x && from.y === to.y) return [];
  const direct = astar(tickPassable(state, false), from, to, { maxLen: PATH_CAP });
  if (direct) return direct;
  return astar(tickPassable(state, true), from, to, { maxLen: PATH_CAP });
}

/**
 * UI-13: "Clicking an enemy travels to the nearest tile adjacent to it and then stops." The
 * candidates are that enemy's free neighbours; the shortest path wins, ties by reading order.
 *
 * @returns {{x: number, y: number}[]|null}
 */
export function approachPathTo(state, ex, ey) {
  let best = null;
  for (const n of neighbors8(ex, ey)) {
    if (n.x === state.tick.x && n.y === state.tick.y) return [];
    const path = travelPathTo(state, n.x, n.y);
    if (!path) continue;
    if (best === null || path.length < best.length) best = path;
  }
  return best;
}

/** The facts UI-13's stop conditions compare across one step. */
export function snapshot(game) {
  const state = game.state;
  const visible = game.view().visible;
  const enemies = new Set();
  for (const e of state.floor.enemies) {
    if (visible.has(idx(e.x, e.y))) enemies.add(e.id);
  }
  return {
    integrity: state.tick.integrity,
    tension: state.tick.tension,
    floorNumber: state.floorNumber,
    enemies,
  };
}

/** Is anything at all visible to stop a Shift-run (UI-10: "stops when an enemy is visible")? */
export function anyEnemyVisible(game) {
  const visible = game.view().visible;
  return game.state.floor.enemies.some((e) => visible.has(idx(e.x, e.y)));
}

/** UI-13: "an item or feature is on the current tile". */
export function underfoot(state) {
  const tick = state.tick;
  if (items.itemAt(state.floor, tick.x, tick.y)) return STOP.ITEM;
  const tile = state.floor.tiles[tick.y][tick.x];
  if (FEATURE_TILES.has(tile)) return STOP.FEATURE;
  return null;
}

/**
 * The UI-13 stop conditions, checked after a step.
 *
 * @param {object} game
 * @param {object} before a `snapshot` taken before the step
 * @param {{baseline?: Set<number>, newEnemiesOnly?: boolean}} [opts]
 *        `baseline` is the set of enemy ids visible when the travel *started* — UI-13 stops on "an
 *        enemy [that] becomes visible that was not visible when the travel started". Shift-run
 *        stops on any visible enemy instead (UI-10), which is `newEnemiesOnly: false`.
 * @returns {string|null}
 */
export function stopReason(game, before, opts = {}) {
  const state = game.state;
  if (game.phase !== 'run') return STOP.EVENT;
  if (state.dead || state.victory) return STOP.EVENT;
  if (state.floorNumber !== before.floorNumber) return STOP.FEATURE;
  if (state.tick.integrity < before.integrity) return STOP.DAMAGE;
  if (opts.newEnemiesOnly === false) {
    if (anyEnemyVisible(game)) return STOP.ENEMY;
  } else {
    const baseline = opts.baseline || before.enemies;
    const after = snapshot(game).enemies;
    for (const id of after) if (!baseline.has(id)) return STOP.ENEMY;
  }
  for (const threshold of TENSION_STOPS) {
    if (before.tension > threshold && state.tick.tension <= threshold) return STOP.TENSION;
  }
  const here = underfoot(state);
  if (here) return here;
  return null;
}

/** SCR-10: an interrupted travel logs "Tick stops." */
export function logStop(game, reason) {
  if (!INTERRUPTIONS.has(reason)) return false;
  log.say(game.state.log, 'travelInterrupted');
  return true;
}

/**
 * One repeating stepper, shared by Travel and Shift-run.
 *
 * @param {object} game the engine facade
 * @param {{nextStep: (game: object) => {dx: number, dy: number}|null, newEnemiesOnly: boolean,
 *          onStepped?: Function, stepMs: number}} policy
 */
function createStepper(game, policy) {
  const baseline = snapshot(game).enemies;
  let stopped = null;

  function finish(reason) {
    stopped = reason;
    logStop(game, reason);
    return { moved: false, done: true, reason };
  }

  return {
    stepMs: policy.stepMs,
    get done() {
      return stopped !== null;
    },
    get reason() {
      return stopped;
    },
    /** Stop because the player pressed a key or clicked (UI-13). */
    interrupt() {
      if (stopped === null) finish(STOP.INPUT);
      return stopped;
    },
    /** Take one step. Returns `{moved, done, reason}`. */
    step() {
      if (stopped !== null) return { moved: false, done: true, reason: stopped };
      if (game.phase !== 'run') return finish(STOP.EVENT);
      const dir = policy.nextStep(game);
      if (!dir) return finish(STOP.ARRIVED);
      const before = snapshot(game);
      const result = game.act({ type: 'move', dx: dir.dx, dy: dir.dy });
      if (!result.ok) return finish(STOP.FAILED);
      if (policy.onStepped) policy.onStepped(game, dir);
      const reason = stopReason(game, before, {
        baseline,
        newEnemiesOnly: policy.newEnemiesOnly,
      });
      if (reason) return finish(reason);
      if (!policy.nextStep(game)) return finish(STOP.ARRIVED);
      return { moved: true, done: false, reason: null, events: result.events };
    },
  };
}

/**
 * UI-13 Travel: walk `path`, one step per turn. A step that opens a closed door leaves Tick where
 * it was and keeps the same path node for the next step.
 *
 * @param {object} game
 * @param {{x: number, y: number}[]} path the steps after Tick's tile
 */
export function createTravel(game, path) {
  let index = 0;
  const steps = path.slice();
  return createStepper(game, {
    stepMs: TRAVEL_STEP_MS,
    newEnemiesOnly: true,
    nextStep(g) {
      if (index >= steps.length) return null;
      const next = steps[index];
      const dx = next.x - g.state.tick.x;
      const dy = next.y - g.state.tick.y;
      if (dx === 0 && dy === 0) return null;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return null;
      return { dx, dy };
    },
    onStepped(g) {
      const next = steps[index];
      // UI-13: opening a door is a successful step that does not move Tick — keep the node.
      if (next && g.state.tick.x === next.x && g.state.tick.y === next.y) index += 1;
    },
  });
}

/** UI-10 Shift-run: repeat one direction until something interesting happens. */
export function createRun(game, dx, dy) {
  return createStepper(game, {
    stepMs: RUN_STEP_MS,
    newEnemiesOnly: false,
    nextStep() {
      return { dx, dy };
    },
  });
}

export { chebyshev };
