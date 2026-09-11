// Enemy decisions: perception (ENM-02), states and waking (ENM-03, ENM-04), tracking (ENM-05),
// the six archetype decision lists (ENM-06), enemy attacks (ENM-07), pathfinding (ENM-08) and
// doors (ENM-09), plus the per-type special cases of BST-02.
//
// **This module is a contract** (D-040). `turn.js` calls `decide` once for every enemy action of
// the enemy phase (CMB-03) and executes whatever it returns, so nothing here edits the engine.
// A fixture's per-enemy `ai` override still wins over this module (`test/fixtures/maps.js`).
//
// ## The enemy action schema (executed by `turn.js#executeEnemyAction`)
//
//   { type: 'wait' }                           do nothing
//   { type: 'move', x, y }                     step to an adjacent tile (hazard ENTER applies)
//   { type: 'melee', x, y }                    CMB-06 against the actor on that tile
//   { type: 'heavy', x, y }                    BRUISER heavy attack: `heavyAttack` dice, accuracy +10
//   { type: 'ranged', x, y }                   CMB-08 with the type's `ranged` block
//   { type: 'openDoor', x, y }                 ENM-09 YES — the door opens, noise 3, no move
//   { type: 'breakDoor', x, y }                ENM-09 BREAKS — the door becomes Floor, noise 6
//   { type: 'telegraph', flag, message? }      set `windingUp`/`ventingUp`/`pulsingUp` (+ log line)
//   { type: 'special', id, ... }               boss specials (M08), dispatched to `ctx.bossSpecial`
//
// ## Division of labour
//
// An enemy's own bookkeeping — ENM-05 tracking (`lastKnown`, `lastKnownAge`), ENM-03 transitions to
// RETURNING/DORMANT, and clearing a wind-up flag — happens here: `decide` receives the live instance
// and mutates those fields before returning its action. Everything with a rule in
// `10-turns-and-combat.md` (damage, noise, statuses, death) belongs to `combat.js`.
//
// Each archetype is exported as its own decision list so the table of ENM-06 situations can be
// tested directly. They are functions of `(enemy, state)` alone except `erratic`, which needs the
// play RNG for its `d10` and therefore takes `ctx` as well (ENM-06).
//
// Nothing here touches the DOM (PLN-02 R2).

import { chebyshev, neighbors8, astar, readingOrder } from './grid.js';
import { TILE, walkable, isDoor, hazardActive } from './tiles.js';
import { enemyType } from './actors.js';
import { canSee } from './turn.js';
import * as combat from './combat.js';
import * as log from './log.js';
import { int } from './rng.js';
import * as bosses from './bosses.js';
import { TUNING } from '../data/tuning.js';

/** The action every actor may always take. */
export const WAIT = Object.freeze({ type: 'wait' });

/**
 * ENM-05: an Active enemy gives up once `lastKnownAge` passes `tuning.memoryTurns` — on turn 26 at
 * M13's default of 25 (DIF-10). This constant is the default, for callers with no run state.
 */
export const MEMORY_TURNS = TUNING.memoryTurns;

/** ENM-05: a noise refreshes `lastKnown` out to `perception + 3`. */
export const NOISE_BONUS = 3;

/** ENM-06 GUARD: "in bounds" reaches this far outside `homeRoom`'s interior (Chebyshev). */
export const GUARD_HALO = 2;

/** ENM-08: a path longer than this counts as no path. */
export const PATH_CAP = 60;

/**
 * BST-02's per-type flavour lines, as SCR-10 template keys.
 *
 *   `telegraph`  printed with the wind-up action (through the `telegraph` action's `message`)
 *   `action`     printed just before the telegraphed attack resolves
 *
 * M08's boss rows: the Regulator's BRUISER phases telegraph and announce through the same table
 * (BST-05); the Conductor's and the Understudy's lines belong to their phase scripts in
 * `bosses.js`, which prints them itself.
 */
export const FLAVOR = Object.freeze({
  Cuckoo: Object.freeze({ telegraph: 'cuckooTelegraph', action: 'cuckooShriek' }),
  Archivist: Object.freeze({ telegraph: 'archivistTelegraph', action: 'archivistShot' }),
  'Gear-Golem': Object.freeze({ telegraph: 'golemTelegraph', action: 'golemHeavy' }),
  'The Regulator': Object.freeze({ telegraph: 'regulatorTelegraph', action: 'regulatorHeavy' }),
});

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Choose one enemy action (ENM-06).
 *
 * @param {object} enemy the live enemy instance (`actors.createEnemy`)
 * @param {object} state the TEC-05 state
 * @param {{rng: {next: () => number}, lines: object[], emit: Function}} [ctx] the engine turn
 *        context: the play RNG (ERRATIC's `d10`), the log line array, the event sink
 * @returns {{type: string}} one action from the schema above
 */
export function decide(enemy, state, ctx) {
  if (enemy.state === 'DORMANT') return WAIT;
  track(enemy, state);
  // Tracking may have sent it back to sleep (ENM-05); a Dormant enemy does nothing.
  if (enemy.state === 'DORMANT') return WAIT;

  const action = actionFor(enemy, state, ctx) || WAIT;
  announce(enemy, action, ctx);
  return action;
}

/** Dispatch to the archetype's decision list. A cache guard is a GUARD whatever its type (BST-02). */
function actionFor(enemy, state, ctx) {
  switch (archetypeOf(enemy)) {
    case 'GUARD':
      // ENM-13 (DIF-10): a Cuckoo's shriek takes a guard off its door for `rallyTurns`.
      if (rallied(enemy, state)) return chaser(enemy, state);
      return guard(enemy, state);
    case 'THIEF':
      return thief(enemy, state);
    case 'SKIRMISHER':
      return skirmisher(enemy, state);
    case 'BRUISER':
      return bruiser(enemy, state);
    case 'ERRATIC':
      return erratic(enemy, state, ctx);
    // ENM-06 BOSS: the phase scripts of BST-04-06 live in `bosses.js`; each of their fallback lines
    // is one of the archetype lists above, so bosses still path and melee "like any enemy".
    case 'BOSS':
      return bosses.decide(enemy, state, ctx);
    case 'SWARMER':
    case 'CHASER':
    default:
      return chaser(enemy, state);
  }
}

/**
 * The archetype this instance runs. BST-02: "A cache guard of any type is spawned with archetype
 * GUARD … regardless of the table above."
 */
export function archetypeOf(enemy) {
  if (enemy.isGuard === true) return 'GUARD';
  return enemyType(enemy).archetype;
}

/** BST-02's flavour line for a telegraphed attack, printed just before the attack resolves. */
function announce(enemy, action, ctx) {
  if (!ctx || !ctx.lines) return;
  const flavor = FLAVOR[enemy.type];
  if (!flavor || !flavor.action) return;
  if (action.type !== 'heavy' && action.type !== 'ranged') return;
  log.say(ctx.lines, flavor.action, {}, log.LOG_COLORS.scripted);
}

// ---------------------------------------------------------------------------------------------
// ENM-02 / ENM-05 — what an enemy knows
// ---------------------------------------------------------------------------------------------

/**
 * The enemy's current target (ENM-06: "'Tick' in these lists means the enemy's current target,
 * which is the Decoy while `SKL-03` redirects it").
 *
 * M07 marks a redirected enemy with `decoyed = true`; SKL-03's own exception — "Enemies that *see*
 * Tick adjacent to themselves still attack Tick" — is applied here so every archetype gets it.
 */
export function targetOf(state, enemy) {
  const decoy = state.floor ? state.floor.decoy : null;
  if (!decoy || enemy.decoyed !== true) return state.tick;
  if (chebyshev(enemy.x, enemy.y, state.tick.x, state.tick.y) === 1 && canSee(state, enemy, state.tick)) {
    return state.tick;
  }
  return decoy;
}

/**
 * ENM-05 — the update an Active enemy makes at the start of each of its actions: refresh
 * `lastKnown` from sight, else age it, let a noise from this turn refresh it, and give up at
 * `lastKnownAge > 8`.
 *
 * RETURNING guards are not Active and do not track: ENM-06's GUARD line 1 sends them home first.
 */
export function track(enemy, state) {
  if (enemy.state !== 'ACTIVE') return;
  const tuning = state.tuning || TUNING;
  const target = targetOf(state, enemy);

  // ENM-13 (DIF-10): a rally that has run out puts the guard back on its way home.
  if (enemy.ralliedUntil !== undefined && state.turn > enemy.ralliedUntil) {
    // TEC-05: `undefined` is not JSON, so a spent rally is removed rather than blanked (D-080).
    delete enemy.ralliedUntil;
    if (archetypeOf(enemy) === 'GUARD') {
      enemy.state = 'RETURNING';
      return;
    }
  }

  // ENM-13 (DIF-10): "Spring-Hounds ... hunt by sound." A woken hound keeps the target's tile
  // fresh while it is within `houndRange`, walls notwithstanding, and never goes Dormant again.
  if (enemyType(enemy).huntsBySound === true) {
    if (target && chebyshev(enemy.x, enemy.y, target.x, target.y) <= tuning.houndRange) {
      enemy.lastKnown = { x: target.x, y: target.y };
      enemy.lastKnownAge = 0;
      return;
    }
  }

  if (target && canSee(state, enemy, target)) {
    enemy.lastKnown = { x: target.x, y: target.y };
    enemy.lastKnownAge = 0;
    return;
  }

  enemy.lastKnownAge += 1;

  // "Any noise event during the previous player turn within its `perception + 3` sets `lastKnown`
  // to the noise tile." `state.floor.noises` is cleared at CMB-02 step 1, so it holds exactly this
  // turn's emissions; the most recent one within reach wins (D-060).
  const reach = enemyType(enemy).perception + NOISE_BONUS;
  const noises = state.floor && state.floor.noises ? state.floor.noises : [];
  for (const n of noises) {
    if (chebyshev(enemy.x, enemy.y, n.x, n.y) <= reach) {
      enemy.lastKnown = { x: n.x, y: n.y };
      enemy.lastKnownAge = 0;
    }
  }

  if (enemy.lastKnownAge <= tuning.memoryTurns) return;

  // ENM-06 / BST-02: "Erratics never go Dormant once woken." BST-03: nor do bosses after their
  // entry trigger. ENM-13 (DIF-10): nor does a woken Spring-Hound.
  const archetype = archetypeOf(enemy);
  if (archetype === 'ERRATIC' || archetype === 'BOSS' || enemy.isBoss === true) return;
  if (enemyType(enemy).huntsBySound === true) return;
  if (archetype === 'GUARD') {
    enemy.state = 'RETURNING';
    return;
  }
  enemy.state = 'DORMANT';
  enemy.energy = 0;
}

// ---------------------------------------------------------------------------------------------
// ENM-06 — the archetype decision lists
// ---------------------------------------------------------------------------------------------

/** CHASER — *clear this floor*. Also SWARMER's list; the difference is in `pathTo` (ENM-08). */
export function chaser(enemy, state) {
  const target = targetOf(state, enemy);
  if (target && adjacent(enemy, target)) return { type: 'melee', x: target.x, y: target.y };
  if (enemy.lastKnown) return stepToward(enemy, state, enemy.lastKnown);
  return WAIT;
}

/** SWARMER — *eat the oil*. The same list as CHASER (ENM-06); `pathTo` ignores other enemies. */
export const swarmer = chaser;

/** ENM-13 (DIF-10): is this enemy still off its post because a Cuckoo shrieked? */
export function rallied(enemy, state) {
  return enemy.ralliedUntil !== undefined && state.turn <= enemy.ralliedUntil;
}

/**
 * THIEF — *take one bright thing* (ENM-06, DIF-11). As CHASER until it has stolen something; then
 * it only runs, using the SKIRMISHER's retreat step, and never attacks again.
 *
 * The theft itself is CMB-06's business (`combat.steal`, called on a hit), so this list only has
 * to know which of the two halves of the Magpie's life it is in.
 */
export function thief(enemy, state) {
  const target = targetOf(state, enemy);
  if (enemy.fleeing === true) {
    if (!target) return WAIT;
    const tile = retreatTile(enemy, state, target);
    if (tile) return { type: 'move', x: tile.x, y: tile.y };
    return WAIT;
  }
  return chaser(enemy, state);
}

/** GUARD — *guard this room*. */
export function guard(enemy, state) {
  const target = targetOf(state, enemy);

  // 1. RETURNING: home, or a step toward it.
  if (enemy.state === 'RETURNING') {
    if (enemy.x === enemy.homeTile.x && enemy.y === enemy.homeTile.y) {
      enemy.state = 'DORMANT';
      enemy.energy = 0;
      return WAIT;
    }
    return stepToward(enemy, state, enemy.homeTile);
  }

  // 2. Adjacent -> melee.
  if (target && adjacent(enemy, target)) return { type: 'melee', x: target.x, y: target.y };

  // 3. In bounds and remembered -> approach.
  const bounds = target ? inHomeBounds(state, enemy, target) : false;
  if (bounds && enemy.lastKnown) return stepToward(enemy, state, enemy.lastKnown);

  // 4. Out of bounds -> RETURNING; this action is already a step toward home.
  if (!bounds) {
    enemy.state = 'RETURNING';
    return stepToward(enemy, state, enemy.homeTile);
  }

  // 5. Wait.
  return WAIT;
}

/** SKIRMISHER — *announce the hour*. */
export function skirmisher(enemy, state) {
  const type = enemyType(enemy);
  const ranged = type.ranged || null;
  const target = targetOf(state, enemy);
  const flavor = FLAVOR[enemy.type] || {};

  // 1. A pending shot: fire it if the shot is still there, otherwise cancel. Either way the
  //    wind-up is cleared.
  if (enemy.windingUp) {
    enemy.windingUp = false;
    if (target && canFire(state, enemy, target, ranged)) {
      return { type: 'ranged', x: target.x, y: target.y };
    }
    return WAIT;
  }

  // 2. Cornered: back away, or hit what it cannot get away from.
  if (target && adjacent(enemy, target)) {
    const tile = retreatTile(enemy, state, target);
    if (tile) return { type: 'move', x: tile.x, y: tile.y };
    return { type: 'melee', x: target.x, y: target.y };
  }

  // 3. A clear shot: telegraph it, or take it.
  if (target && canFire(state, enemy, target, ranged)) {
    if (ranged.windUp) return { type: 'telegraph', flag: 'windingUp', message: flavor.telegraph };
    return { type: 'ranged', x: target.x, y: target.y };
  }

  // 4/5. Approach what it remembers, else wait.
  if (enemy.lastKnown) return stepToward(enemy, state, enemy.lastKnown);
  return WAIT;
}

/** BRUISER — *regulate the mechanism*. Never makes a plain melee attack (BST-02). */
export function bruiser(enemy, state) {
  const target = targetOf(state, enemy);
  const flavor = FLAVOR[enemy.type] || {};

  if (enemy.windingUp) {
    enemy.windingUp = false;
    if (target && adjacent(enemy, target)) return { type: 'heavy', x: target.x, y: target.y };
    return WAIT;
  }
  if (target && adjacent(enemy, target)) {
    return { type: 'telegraph', flag: 'windingUp', message: flavor.telegraph };
  }
  if (enemy.lastKnown) return stepToward(enemy, state, enemy.lastKnown);
  return WAIT;
}

/**
 * ERRATIC — *no instruction*. The one archetype that draws: a `d10` every action (`1–5` chase,
 * `6–8` a random free neighbour, `9–10` wait), plus one more draw to pick the neighbour.
 */
export function erratic(enemy, state, ctx) {
  const rng = ctx ? ctx.rng : null;
  if (!rng) return chaser(enemy, state);
  const d10 = int(rng, 1, 10);
  if (d10 <= 5) return chaser(enemy, state);
  if (d10 <= 8) {
    const tiles = freeNeighbors(enemy, state);
    if (tiles.length === 0) return WAIT;
    const pick = tiles[int(rng, 0, tiles.length - 1)];
    return { type: 'move', x: pick.x, y: pick.y };
  }
  return WAIT;
}

// ---------------------------------------------------------------------------------------------
// Decision-list helpers
// ---------------------------------------------------------------------------------------------

/** ENM-06: "Adjacent" is the 8-neighborhood. */
export function adjacent(a, b) {
  return chebyshev(a.x, a.y, b.x, b.y) === 1;
}

/**
 * CMB-08 as a SKIRMISHER reads it: the target is seen, within `range`, and the projectile from the
 * enemy's tile reaches it before anything else.
 */
export function canFire(state, enemy, target, ranged) {
  if (!ranged) return false;
  if (!canSee(state, enemy, target)) return false;
  if (chebyshev(enemy.x, enemy.y, target.x, target.y) > ranged.range) return false;
  const shot = combat.projectile(state, enemy.x, enemy.y, target.x, target.y);
  return shot.actor === target;
}

/**
 * ENM-06 SKIRMISHER line 2 — the tile to retreat to: of the free neighbours that *increase* the
 * Chebyshev distance to the target, the farthest; ties go to one that is not adjacent to any other
 * enemy, then to the lowest reading order. `null` means "nowhere farther" — melee instead.
 */
export function retreatTile(enemy, state, target) {
  const here = chebyshev(enemy.x, enemy.y, target.x, target.y);
  const farther = freeNeighbors(enemy, state).filter(
    (p) => chebyshev(p.x, p.y, target.x, target.y) > here,
  );
  if (farther.length === 0) return null;

  let best = 0;
  for (const p of farther) best = Math.max(best, chebyshev(p.x, p.y, target.x, target.y));
  const tied = farther.filter((p) => chebyshev(p.x, p.y, target.x, target.y) === best);
  const alone = tied.filter((p) => !nextToAnotherEnemy(state, enemy, p));
  const pool = alone.length > 0 ? alone : tied;
  return pool.slice().sort(readingOrder)[0];
}

/** Is any enemy other than `self` within Chebyshev 1 of this tile? */
function nextToAnotherEnemy(state, self, tile) {
  for (const e of state.floor.enemies) {
    if (e === self) continue;
    if (chebyshev(e.x, e.y, tile.x, tile.y) <= 1) return true;
  }
  return false;
}

/**
 * The neighbouring tiles an enemy may simply step onto: walkable, unoccupied, and not a diagonal
 * into or out of a door tile (ENM-08). Reading order, as `neighbors8` gives them.
 */
export function freeNeighbors(enemy, state) {
  const tiles = state.floor.tiles;
  const out = [];
  for (const p of neighbors8(enemy.x, enemy.y)) {
    if (!walkable(tiles[p.y][p.x])) continue;
    if (diagonalThroughDoor(tiles, enemy, p)) continue;
    if (combat.actorAt(state, p.x, p.y)) continue;
    out.push(p);
  }
  return out;
}

/**
 * ENM-06's "step toward X": the first step of the ENM-08 path. A closed door in the way is the
 * action itself (ENM-09); a first step that is blocked at execution time is a Wait.
 */
export function stepToward(enemy, state, dest) {
  const path = pathTo(enemy, state, dest);
  if (!path || path.length === 0) return WAIT;
  const next = path[0];

  const nextTile = state.floor.tiles[next.y][next.x];
  if (nextTile === TILE.DOOR_CLOSED || nextTile === TILE.WOUND_LOCK) {
    const opens = enemyType(enemy).opensDoors;
    // WLD-15: only a BREAKS enemy gets through a lock — a Gear-Golem can open a cache for you.
    if (nextTile === TILE.WOUND_LOCK) {
      return opens === 'BREAKS' ? { type: 'breakDoor', x: next.x, y: next.y } : WAIT;
    }
    if (opens === 'YES') return { type: 'openDoor', x: next.x, y: next.y };
    if (opens === 'BREAKS') return { type: 'breakDoor', x: next.x, y: next.y };
    return WAIT; // `NO` never plans through a door, but never move into one either
  }
  // "If the first step is blocked at execution time, the enemy Waits (no swapping, no shoving)."
  if (combat.actorAt(state, next.x, next.y)) return WAIT;
  return { type: 'move', x: next.x, y: next.y };
}

/** ENM-06 GUARD: Tick's tile is inside `homeRoom`'s interior or within Chebyshev 2 of it. */
export function inHomeBounds(state, enemy, target) {
  const room = homeRoomOf(state, enemy);
  const dx = Math.max(room.x - target.x, 0, target.x - (room.x + room.w - 1));
  const dy = Math.max(room.y - target.y, 0, target.y - (room.y + room.h - 1));
  return Math.max(dx, dy) <= GUARD_HALO;
}

/**
 * The guard's home room rectangle (`gen.js` writes the interior as `{id, x, y, w, h}`). A guard
 * with no room — a fixture enemy, or a spawn record that named none — guards its own tile (D-058).
 */
export function homeRoomOf(state, enemy) {
  const rooms = state.floor && state.floor.rooms ? state.floor.rooms : [];
  if (enemy.homeRoom >= 0) {
    for (const r of rooms) if (r.id === enemy.homeRoom) return r;
    if (enemy.homeRoom < rooms.length) return rooms[enemy.homeRoom];
  }
  return { id: -1, x: enemy.homeTile.x, y: enemy.homeTile.y, w: 1, h: 1 };
}

// ---------------------------------------------------------------------------------------------
// ENM-08 — pathfinding
// ---------------------------------------------------------------------------------------------

/**
 * The ENM-08 path from the enemy's tile to `dest`: A* over `grid.js` with a step predicate that
 * carries the door rules, the `opensDoors` rule, hazards and occupancy (D-006).
 *
 * Grinding Gears are impassable "unless no path exists at all — in that case the enemy re-plans
 * with them passable", which is the second attempt below.
 *
 * @returns {{x: number, y: number}[]|null} the steps after the enemy's tile, or `null`
 */
export function pathTo(enemy, state, dest) {
  const direct = astar(stepPassable(enemy, state, dest, false), enemy, dest, { maxLen: PATH_CAP });
  if (direct) return direct;
  return astar(stepPassable(enemy, state, dest, true), enemy, dest, { maxLen: PATH_CAP });
}

/** ENM-08's passability, as the `(from, to) => boolean` step callback `grid.astar` takes. */
function stepPassable(enemy, state, dest, gearsPassable) {
  const type = enemyType(enemy);
  const opens = type.opensDoors;
  const swarms = archetypeOf(enemy) === 'SWARMER';
  const target = targetOf(state, enemy);
  const tiles = state.floor.tiles;

  return (from, to) => {
    if (diagonalThroughDoor(tiles, from, to)) return false;

    const t = tiles[to.y][to.x];
    if (t === TILE.DOOR_CLOSED) {
      if (opens === 'NO') return false;
    } else if (t === TILE.WOUND_LOCK) {
      // WLD-15 (DIF-12): "Enemies with `opensDoors: YES` treat it as a wall; `BREAKS` breaks it."
      if (opens !== 'BREAKS') return false;
    } else if (!walkable(t)) {
      return false;
    }

    if (!hazardPassable(state, to.x, to.y, gearsPassable)) return false;

    const actor = combat.actorAt(state, to.x, to.y);
    if (actor) {
      if (actor === enemy) return true;
      // "except the destination tile when it holds Tick"
      if (to.x === dest.x && to.y === dest.y && actor === target) return true;
      // "SWARMER plans as if other enemies were not there"
      if (swarms && actor !== state.tick && actor !== state.floor.decoy) return true;
      return false;
    }
    return true;
  };
}

/**
 * WLD-08 / ENM-08: enemies path around a hazard that is active now or would be active on their
 * arrival turn (the next turn). Grinding Gears are constant, so they are impassable until the
 * re-plan (D-059).
 */
function hazardPassable(state, x, y, gearsPassable) {
  const cfg = combat.hazardAt(state, x, y);
  if (!cfg) return true;
  if (cfg.mechanism === 'CONSTANT') return gearsPassable === true;
  return !hazardActive(cfg.kind, state.turn) && !hazardActive(cfg.kind, state.turn + 1);
}

/**
 * ENM-08's last bullet: "a step is illegal if either the source or the destination is a door tile
 * and the step is diagonal". `turn.js` applies the same rule to Tick.
 */
export function diagonalThroughDoor(tiles, from, to) {
  if (from.x === to.x || from.y === to.y) return false;
  return isDoor(tiles[from.y][from.x]) || isDoor(tiles[to.y][to.x]);
}
