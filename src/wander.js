// WLD-14 — wandering pressure (M13, DIF-06).
//
// Every `tuning.wanderInterval` turns on a floor, the tower sends something after Tick: one enemy
// drawn from the floor's `wanderTable` (`data/floors.js`), placed out of sight and far away, and
// **Active** from its first breath. Floors 1–7 only; floor 1 is slower (`WANDER_FLOOR_INTERVAL`)
// and floor 8 has none.
//
// This is the change aimed at "explore everything": a floor is no longer a fixed number of enemies
// that can be cleared and then strolled through — standing still costs, and so does going back.
//
// `turn.js` calls `spawnWanderer` at CMB-02 step 2, right after the Tension decay, so a wanderer's
// first action is in the same turn's enemy phase — minus ENM-03's "woke this turn gains no energy",
// which is applied here too, so nothing ever appears and acts in one turn (D-110).
//
// Nothing here touches the DOM (PLN-02 R2).

import { W, H, idx, chebyshev, bfs } from './grid.js';
import { computeFov, FOV_RADIUS } from './fov.js';
import { TILE, walkable, blocksSight } from './tiles.js';
import { int, weighted, chance } from './rng.js';
import { createEnemy } from './actors.js';
import * as combat from './combat.js';
import * as items from './items.js';
import * as log from './log.js';
import { FLOORS } from '../data/floors.js';
import { WANDER_FLOOR_INTERVAL } from '../data/tuning.js';

/** WLD-14: how far from Tick a wanderer must appear, and how many tiles are sampled for it. */
export const MIN_DISTANCE = 10;
export const PLACE_RETRIES = 50;

/** The floor's wander table (`FLR-*`), or an empty list for a floor that spawns nothing. */
export function wanderTable(floorNumber) {
  const def = FLOORS[floorNumber];
  return def && def.wanderTable ? def.wanderTable : [];
}

/** WLD-14: this floor's interval — `tuning.wanderInterval`, unless the floor overrides it. */
export function wanderInterval(state) {
  const override = WANDER_FLOOR_INTERVAL[state.floorNumber];
  return override === undefined ? state.tuning.wanderInterval : override;
}

/** Does this floor spawn wanderers at all (WLD-14: floors 1–7 with a non-empty table)? */
export function wanders(state) {
  return wanderTable(state.floorNumber).length > 0;
}

/**
 * UI-06's countdown: turns until the next wanderer, or `null` when this floor spawns none or has
 * already had its `wanderCap`. It is the panel's row 16 when the floor has no cyclic hazard, so
 * the pressure is legible rather than a surprise (OVR-02 pillar 3).
 */
export function turnsUntilWanderer(state) {
  if (!wanders(state)) return null;
  const floor = state.floor;
  if ((floor.wanderersSpawned || 0) >= state.tuning.wanderCap) return null;
  const interval = wanderInterval(state);
  const here = floor.turnsHere || 0;
  return interval - (here % interval);
}

/**
 * CMB-02 step 2 — the WLD-14 scheduler. Called once per turn, after `turnsHere` has been advanced.
 *
 * @param {object} ctx the engine turn context
 * @returns {object|null} the enemy spawned, or null
 */
export function spawnWanderer(ctx) {
  const state = ctx.state;
  const floor = state.floor;
  if (!wanders(state)) return null;
  const turnsHere = floor.turnsHere || 0;
  if (turnsHere <= 0) return null;
  if (turnsHere % wanderInterval(state) !== 0) return null;
  if ((floor.wanderersSpawned || 0) >= state.tuning.wanderCap) return null;

  // One weighted roll for the type (ITM-10's walk, play RNG), then the placement search.
  const type = weighted(ctx.rng, wanderTable(state.floorNumber));
  const tile = placeWanderer(ctx);
  // "if none, skip this spawn (it does not count)" — the cap is a count of arrivals, not of tries.
  if (!tile) return null;

  // DIF-08: a wanderer is a regular, non-pack spawn, so it rolls for Overwound like any other.
  const elite = chance(ctx.rng, state.tuning.eliteChance);

  const enemy = createEnemy(type, tile.x, tile.y, floor.nextEnemyId++, {
    state: 'ACTIVE',
    lastKnown: { x: state.tick.x, y: state.tick.y },
    elite,
    tuning: state.tuning,
  });
  // ENM-03: nothing acts on the turn it wakes, and a wanderer wakes as it arrives (D-110).
  enemy.wokeThisTurn = true;
  enemy.wanderer = true;
  floor.enemies.push(enemy);
  floor.wanderersSpawned = (floor.wanderersSpawned || 0) + 1;
  state.stats.wanderersSpawned = (state.stats.wanderersSpawned || 0) + 1;
  log.say(ctx.lines, 'wanderer', {}, log.LOG_COLORS.scripted);
  return enemy;
}

/**
 * WLD-14's placement: a random interior tile of a room Tick cannot see, at BFS distance >= 10,
 * with no actor, no feature, no hazard and no item on it. Fifty rejection samples (room, then x,
 * then y, as WLD-11 step 9 draws), then the farthest valid room tile, then nothing.
 *
 * @returns {{x: number, y: number}|null}
 */
export function placeWanderer(ctx) {
  const state = ctx.state;
  const floor = state.floor;
  const rooms = floor.rooms || [];
  if (rooms.length === 0) return null;

  const tiles = floor.tiles;
  const visible = computeFov((x, y) => blocksSight(tiles[y][x]), state.tick.x, state.tick.y, FOV_RADIUS);
  const dist = bfs(
    (_from, to) => walkable(tiles[to.y][to.x]) || tiles[to.y][to.x] === TILE.DOOR_CLOSED,
    { x: state.tick.x, y: state.tick.y },
  );

  const valid = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = idx(x, y);
    // Plain floor only: that is "no feature, no hazard" in one test (WLD-02's tile numbers).
    if (tiles[y][x] !== TILE.FLOOR) return false;
    if (visible.has(i)) return false;
    if (dist[i] < MIN_DISTANCE) return false;
    if (combat.actorAt(state, x, y)) return false;
    if (items.itemAt(floor, x, y)) return false;
    return true;
  };

  for (let t = 0; t < PLACE_RETRIES; t++) {
    const room = rooms[int(ctx.rng, 0, rooms.length - 1)];
    const x = int(ctx.rng, room.x, room.x + room.w - 1);
    const y = int(ctx.rng, room.y, room.y + room.h - 1);
    if (valid(x, y)) return { x, y };
  }

  // "then the farthest valid room tile" — by BFS distance from Tick, ties by reading order.
  let best = null;
  let bestDistance = -1;
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (!valid(x, y)) continue;
        const d = dist[idx(x, y)];
        if (d > bestDistance) {
          best = { x, y };
          bestDistance = d;
        }
      }
    }
  }
  return best;
}
