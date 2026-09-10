// Shared helpers for the BAL-07 bots.
//
// A bot is a *pure policy*: `decide(game, memory)` reads `game.state` and `game.view()` and returns
// one PLN-03 action (or `null` for "nothing to do"). No timers, no wall clock, no `Math.random` —
// every roll a bot causes comes from the engine's seeded play RNG (PLN-02 R6).
//
// The pathing here is `src/travel.js`'s, reused rather than reimplemented: `travelPathTo` and
// `approachPathTo` already carry UI-13's passability (closed doors passable, hazards avoided when
// another path exists, enemies solid) and ENM-08's diagonal-door rule.

import { W, H, idx, chebyshev, readingOrder, neighbors8, bfs } from '../../src/grid.js';
import { TILE, walkable, hazardActive } from '../../src/tiles.js';
import { hazardAt } from '../../src/combat.js';
import { travelPathTo, approachPathTo, tickPassable } from '../../src/travel.js';
import { itemDef, itemAt, isEquipment, stacks, canHoldItem, INVENTORY_SLOTS, STACK_MAX } from '../../src/items.js';
import { ENEMIES_BY_NAME } from '../../data/enemies.js';
import { parseDice } from '../../src/rng.js';

/** CHR-05 / BAL-07 S4: "uses ... Spring-Key < 30". */
export const SPRING_KEY_AT = 30;

/** BAL-07 S3/S4: "uses Solder at < 50%". */
export const SOLDER_AT = 0.5;

/** A tile is on the map and Tick could stand on it right now. */
function standable(state, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  if (!walkable(state.floor.tiles[y][x])) return false;
  if (state.floor.enemies.some((e) => e.x === x && e.y === y)) return false;
  const decoy = state.floor.decoy;
  if (decoy && decoy.x === x && decoy.y === y) return false;
  return true;
}

/** The move action that takes a step from Tick's tile to `to`, or null if it is not one step. */
export function stepTo(state, to) {
  const dx = to.x - state.tick.x;
  const dy = to.y - state.tick.y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return null;
  return { type: 'move', dx, dy };
}

/** The first step of `path` as a move action, or null when the path is empty or unusable. */
export function firstStep(state, path) {
  if (!path || path.length === 0) return null;
  return stepTo(state, path[0]);
}

/**
 * Tick's passability with the actors left out: a Move into an occupied tile is an attack, not a
 * refusal (CMB-05), so a bot that fights is never *blocked* by an enemy — it is delayed by one.
 * Everything else is `tickPassable`'s rule: closed doors passable (bumping opens them), hazards
 * avoided unless `hazardsPassable`, and ENM-08's diagonal-door step refused.
 */
function passableIgnoringActors(state, hazardsPassable) {
  const solid = tickPassable(state, hazardsPassable);
  const tick = state.tick;
  return (from, to) => {
    if (solid(from, to)) return true;
    // The only reason to override is an actor standing there; re-check the terrain by asking the
    // same predicate about a tile with nothing on it, which is what `standable` decides.
    const t = state.floor.tiles[to.y][to.x];
    if (t !== TILE.DOOR_CLOSED && !walkable(t)) return false;
    if (!hazardsPassable) {
      const cfg = hazardAt(state, to.x, to.y);
      if (cfg && (cfg.mechanism === 'CONSTANT' || hazardActive(cfg.kind, state.turn) || hazardActive(cfg.kind, state.turn + 1))) {
        return false;
      }
    }
    if (diagonalDoorStep(state, from, to)) return false;
    const occupied =
      state.floor.enemies.some((e) => e.x === to.x && e.y === to.y) ||
      (state.floor.decoy && state.floor.decoy.x === to.x && state.floor.decoy.y === to.y) ||
      (to.x === tick.x && to.y === tick.y);
    return occupied === true;
  };
}

/** ENM-08: a diagonal step into or out of a door tile is refused. */
function diagonalDoorStep(state, from, to) {
  if (from.x === to.x || from.y === to.y) return false;
  const tiles = state.floor.tiles;
  return isDoorTile(tiles[from.y][from.x]) || isDoorTile(tiles[to.y][to.x]);
}

function isDoorTile(t) {
  return t === TILE.DOOR_CLOSED || t === TILE.DOOR_OPEN;
}

/**
 * A BFS distance field over the whole floor, measured *from* `(tx, ty)` with Tick's passability.
 * The predicate is applied in both directions so the field is a real step count for Tick: `-1`
 * means unreachable.
 *
 * `travelPathTo` is A* with ENM-08's 60-step cap, which a 60x24 map can exceed; this is the
 * uncapped fallback, and it is also literally what BAL-07 S2 asks for ("the BFS-shortest path").
 *
 * @param {object} state
 * @param {number} tx
 * @param {number} ty
 * @param {{hazardsPassable?: boolean, ignoreActors?: boolean}} [opts]
 * @returns {Int32Array}
 */
export function bfsField(state, tx, ty, opts = {}) {
  const pass = opts.ignoreActors
    ? passableIgnoringActors(state, opts.hazardsPassable === true)
    : tickPassable(state, opts.hazardsPassable === true);
  return bfs((from, to) => pass(from, to) && pass(to, from), { x: tx, y: ty });
}

/**
 * One step down a `bfsField`, ties by reading order, or null when no neighbour improves.
 *
 * @param {object} state
 * @param {Int32Array} field
 * @param {{ignoreActors?: boolean}} [opts]
 */
export function stepDownField(state, field, opts = {}) {
  const tick = state.tick;
  const pass = opts.ignoreActors
    ? passableIgnoringActors(state, true)
    : tickPassable(state, true);
  const here = field[idx(tick.x, tick.y)];
  let bestDistance = here < 0 ? Infinity : here;
  let best = null;
  for (const n of neighbors8(tick.x, tick.y)) {
    const d = field[idx(n.x, n.y)];
    if (d < 0 || d >= bestDistance) continue;
    // The predicate is the whole gate: it already lets a closed door through (bumping it opens it,
    // UI-13) and already refuses ENM-08's diagonal-door step.
    if (!pass({ x: tick.x, y: tick.y }, n)) continue;
    best = n;
    bestDistance = d;
  }
  return best ? stepTo(state, best) : null;
}

/**
 * One step toward `(tx, ty)`: UI-13's A* travel path when there is one inside its cap, else the
 * uncapped BFS gradient — first around the hazards and the actors, then through whatever is in the
 * way, because a bot that fights clears its own corridor (CMB-05).
 *
 * @returns {object|null} a move action
 */
export function stepToward(state, tx, ty) {
  const direct = firstStep(state, travelPathTo(state, tx, ty));
  if (direct) return direct;
  for (const opts of [
    { hazardsPassable: false, ignoreActors: false },
    { hazardsPassable: false, ignoreActors: true },
    { hazardsPassable: true, ignoreActors: true },
  ]) {
    const step = stepDownField(state, bfsField(state, tx, ty, opts), opts);
    if (step) return step;
  }
  return null;
}

/**
 * WLD-08's cyclic hazards are telegraphed: they are drawn in the warning colour the turn before
 * they become active, and OVR-05 makes stepping out of the way the intended play. So when the step
 * a bot wants to take would enter a cyclic hazard on the very turn it fires, wait one turn instead
 * — a Tension tick is cheaper than 6 Integrity and a Stun.
 *
 * A hazard that is already underfoot is the exception: `STANDING` triggers punish lingering, so the
 * step is taken as planned.
 *
 * `hazardEnter` is checked with the turn the move will have, which is `state.turn + 1` (WLD-08 as
 * the engine applies it), so that is the turn tested here.
 *
 * @returns {object|null} a `wait` action to take instead, or null to take `action` as planned
 */
export function hazardStall(state, action) {
  if (!action || action.type !== 'move') return null;
  const tick = state.tick;
  if (hazardAt(state, tick.x, tick.y)) return null;
  const cfg = hazardAt(state, tick.x + action.dx, tick.y + action.dy);
  if (!cfg || cfg.mechanism !== 'CYCLIC') return null;
  if (!hazardActive(cfg.kind, state.turn + 1)) return null;
  return { type: 'wait' };
}

/**
 * Every enemy Tick can currently see, nearest first, ties by reading order (ENM-08's rule).
 *
 * With `bossesFirst`, a visible boss outranks everything else regardless of distance: the
 * Conductor's Downbeat keeps four Music-box Dancers on the board (BST-04), so a bot that always
 * swings at the nearest thing fights the summons for ever and never the summoner (D-101).
 *
 * @param {object} game
 * @param {{bossesFirst?: boolean}} [opts]
 */
export function visibleEnemies(game, opts = {}) {
  const visible = game.view().visible;
  const state = game.state;
  const tick = state.tick;
  const out = state.floor.enemies.filter((e) => visible.has(idx(e.x, e.y)));
  const rank = (e) => (opts.bossesFirst && e.isBoss ? 0 : 1);
  out.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      chebyshev(tick.x, tick.y, a.x, a.y) - chebyshev(tick.x, tick.y, b.x, b.y) ||
      readingOrder(a, b),
  );
  return out;
}

/**
 * A chase that makes no progress for this many turns is abandoned for the rest of the floor.
 *
 * ENM-06's SKIRMISHER "retreats when Tick closes", so a melee bot that always swings at whatever it
 * can see will follow a Cuckoo around a floor until the spring runs out — 700 turns in a measured
 * run. Twelve turns is longer than ENM-05's nine-turn `lastKnownAge` memory, so a chase that is
 * genuinely closing is never dropped (D-102).
 */
export const CHASE_PATIENCE = 12;

/**
 * The "am I getting anywhere with this one?" bookkeeping a melee bot needs. Progress is the target
 * losing Integrity or Tick getting closer; `CHASE_PATIENCE` turns without either abandons it.
 */
export function createChaseTracker() {
  let id = null;
  let since = 0;
  let bestRange = Infinity;
  let integrity = Infinity;
  const abandoned = new Set();

  return {
    /** Forget everything: a new floor has new enemies (and new ids). */
    reset() {
      id = null;
      abandoned.clear();
    },
    /** Has this enemy been given up on? */
    abandoned(enemy) {
      return abandoned.has(enemy.id);
    },
    /**
     * Record this turn's attempt on `enemy`.
     *
     * @returns {boolean} true while the chase is still worth continuing
     */
    track(state, enemy) {
      const range = chebyshev(state.tick.x, state.tick.y, enemy.x, enemy.y);
      if (enemy.id !== id) {
        id = enemy.id;
        since = state.turn;
        bestRange = range;
        integrity = enemy.integrity;
        return true;
      }
      if (range < bestRange || enemy.integrity < integrity) {
        since = state.turn;
        bestRange = Math.min(bestRange, range);
        integrity = Math.min(integrity, enemy.integrity);
        return true;
      }
      if (state.turn - since <= CHASE_PATIENCE) return true;
      // A boss is never given up on: BST-04's Downbeat keeps making more summons, so walking away
      // from the Conductor turns floor 3 into an XP farm that never ends (D-101).
      if (enemy.isBoss) return true;
      abandoned.add(enemy.id);
      id = null;
      return false;
    },
  };
}

/**
 * Is the telegraph worth stepping out of? BAL-02 names the four that are — "stepping away from
 * telegraphed hits (Golem, Regulator, Understudy Overwind/Pulse) removes 5-15 per boss from these
 * figures" — and they are exactly the heavy melee hits: `heavyAttack` (ENM-06 BRUISER) and the
 * Understudy's Overwind and Pulse (BST-06).
 *
 * A SKIRMISHER's `windingUp` is a *ranged* wind-up (ENM-06 line 3), and BAL-06's answer to those is
 * the opposite one — "Close with Braced Frame; its 1d4 is small" — so it is not dodged (D-103).
 */
export function isHeavyTelegraph(enemy) {
  if (enemy.ventingUp === true || enemy.pulsingUp === true) return true;
  if (enemy.windingUp !== true) return false;
  const type = ENEMIES_BY_NAME[enemy.type];
  if (type && type.heavyAttack) return true;
  return enemy.isBoss === true;
}

/**
 * BAL-07 S4: "steps away from telegraphs". If any enemy within reach of its telegraphed attack is
 * winding up, step to the adjacent free tile that is furthest from it (ties by reading order).
 *
 * @returns {object|null} a move action, or null when nothing is telegraphing or nowhere is safer
 */
export function stepAwayFromTelegraph(game, reach = 2) {
  const state = game.state;
  const tick = state.tick;
  const threats = visibleEnemies(game).filter(
    (e) => isHeavyTelegraph(e) && chebyshev(tick.x, tick.y, e.x, e.y) <= reach,
  );
  if (threats.length === 0) return null;
  const distance = (x, y) => Math.min(...threats.map((e) => chebyshev(x, y, e.x, e.y)));
  const here = distance(tick.x, tick.y);
  const passable = tickPassable(state, false);
  let best = null;
  let bestDistance = here;
  for (const n of neighbors8(tick.x, tick.y)) {
    if (!standable(state, n.x, n.y)) continue;
    if (!passable({ x: tick.x, y: tick.y }, n)) continue;
    const d = distance(n.x, n.y);
    if (d > bestDistance || (d === bestDistance && best !== null && readingOrder(n, best) < 0)) {
      if (d > bestDistance) best = n;
      else best = readingOrder(n, best) < 0 ? n : best;
      bestDistance = d;
    }
  }
  if (!best) return null;
  return stepTo(state, best);
}

/** The inventory slot holding `name`, or -1 (ITM-03 keeps the inventory dense). */
export function slotWith(tick, name) {
  return tick.inventory.findIndex((entry) => entry && entry.name === name);
}

/**
 * The consumable policy BAL-07 gives S3 and S4: Solder below `SOLDER_AT` of maximum Integrity,
 * Spring-Key below `SPRING_KEY_AT` Tension.
 *
 * @param {object} game
 * @param {{springKeys?: boolean}} [opts] `springKeys: false` disables Spring-Key use (ACC-131)
 * @returns {object|null} a `use` action, or null
 */
export function consumablePolicy(game, opts = {}) {
  const tick = game.state.tick;
  if (tick.integrity < tick.integrityMax * SOLDER_AT) {
    const slot = slotWith(tick, 'Solder');
    if (slot >= 0) return { type: 'use', slot };
  }
  if (opts.springKeys !== false && tick.tension < SPRING_KEY_AT) {
    const slot = slotWith(tick, 'Spring-Key');
    if (slot >= 0) return { type: 'use', slot };
  }
  return null;
}

/** The expected roll of a dice string (`TEC-07`), for comparing two weapons. */
function meanRoll(spec) {
  const { n, sides, mod } = parseDice(spec);
  return (n * (sides + 1)) / 2 + mod;
}

/** How good a piece of equipment is for the bot, per category. Higher is better. */
function equipmentScore(def) {
  switch (def.category) {
    case 'melee':
      return meanRoll(def.dice) + def.accuracyMod / 20;
    case 'ranged':
      return meanRoll(def.dice) + def.accuracyMod / 20 + def.range / 10;
    case 'plating':
      // BAL-02: "Plating 2 by floor 2 makes 1d3 enemies harmless" — Plating dominates evasion.
      return def.plating * 2 - def.evasionPenalty / 4;
    case 'attachment':
      return (
        def.forceMod + def.precisionMod + def.platingMod + def.evasionMod / 10 +
        (def.special === 'REGULATED' ? 3 : 0)
      );
    default:
      return -Infinity;
  }
}

/** ITM-02's three equipment slots, keyed by the category that fills them. */
const SLOT_OF_CATEGORY = { melee: 'weapon', ranged: 'weapon', plating: 'plating', attachment: 'attachment' };

/**
 * ITM-02: equip anything in the inventory that scores better than what is worn. A ranged weapon
 * shares the weapon slot with the melee one, so it is only equipped when nothing melee is better —
 * a melee bot never trades its hammer for a rifle.
 *
 * @returns {object|null} an `equip` action, or null
 */
export function equipPolicy(game, opts = {}) {
  const tick = game.state.tick;
  const allowRanged = opts.allowRanged === true;
  let best = null;
  for (let slot = 0; slot < tick.inventory.length; slot++) {
    const entry = tick.inventory[slot];
    if (!entry || !isEquipment(entry.name)) continue;
    const def = itemDef(entry.name);
    if (def.category === 'ranged' && !allowRanged) continue;
    const which = SLOT_OF_CATEGORY[def.category];
    const worn = tick.equipment[which] ? itemDef(tick.equipment[which]) : null;
    // The weapon slot compares like with like: a rifle never displaces a hammer on damage alone.
    if (which === 'weapon' && worn && worn.category !== def.category) continue;
    const gain = equipmentScore(def) - (worn ? equipmentScore(worn) : -1);
    if (gain > 0 && (best === null || gain > best.gain)) best = { slot, gain };
  }
  return best ? { type: 'equip', slot: best.slot } : null;
}

/** Is there an item under Tick worth a Pickup (ITM-04)? Records always are (CAT-07). */
export function itemUnderfoot(game) {
  const state = game.state;
  return itemAt(state.floor, state.tick.x, state.tick.y) || null;
}

/** ITM-03: would `count` of `name` fit — a non-full stack of the same name, or a free slot? */
export function hasRoomFor(tick, name, count) {
  if (stacks(name)) {
    for (const entry of tick.inventory) {
      if (entry.name === name && entry.count + count <= STACK_MAX) return true;
    }
  }
  return tick.inventory.length < INVENTORY_SLOTS;
}

/**
 * How reluctant a bot is to drop the contents of a slot. Lower is more droppable; `null` means
 * never. Only scores below `DROPPABLE` are ever dropped.
 */
const DROPPABLE = 10;

function dropScore(tick, entry) {
  const def = itemDef(entry.name);
  if (def.category === 'instant') {
    // The two consumables every check's policy is written around (BAL-07 S3/S4).
    if (def.effect === 'SOLDER' || def.effect === 'SPRING_KEY') return null;
    return 5;
  }
  if (isEquipment(entry.name)) {
    const which = SLOT_OF_CATEGORY[def.category];
    const worn = tick.equipment[which] ? itemDef(tick.equipment[which]) : null;
    // Something already superseded by what is worn is dead weight (ITM-02).
    if (worn && equipmentScore(def) <= equipmentScore(worn)) return 1;
    return DROPPABLE + 10;
  }
  if (def.category === 'throwable') return 8;
  return DROPPABLE + 10;
}

/** The slot a full pack should shed first (ITM-07), or -1 when everything carried is worth having. */
export function droppableSlot(tick) {
  let best = -1;
  let bestScore = DROPPABLE;
  for (let slot = 0; slot < tick.inventory.length; slot++) {
    const score = dropScore(tick, tick.inventory[slot]);
    if (score === null || score >= bestScore) continue;
    best = slot;
    bestScore = score;
  }
  return best;
}

/**
 * ITM-06 with ITM-03's ten slots respected: pick the item up when there is room. A record never
 * enters the inventory, so it is always takeable (ITM-03, CAT-07).
 *
 * @returns {object|null} a `pickup` action, or null when there is no room (or nothing there)
 */
export function pickupPolicy(game) {
  const state = game.state;
  const tick = state.tick;
  const here = itemAt(state.floor, tick.x, tick.y);
  if (!here) return null;
  const def = itemDef(here.name);
  if (def.category === 'record') return { type: 'pickup' };
  if (hasRoomFor(tick, here.name, here.count === undefined ? 1 : here.count)) return { type: 'pickup' };
  return null;
}

/**
 * One step to an adjacent tile that could legally take a dropped item (ITM-04's one-item-per-tile
 * rule and ITM-07's "not on a feature tile"), in reading order. This is how a bot with a full pack
 * standing *on* an item makes room: step off, shed, step back.
 *
 * @returns {object|null} a move action
 */
export function stepToDropSpot(state) {
  const tick = state.tick;
  const pass = tickPassable(state, false);
  for (const n of neighbors8(tick.x, tick.y)) {
    if (!standable(state, n.x, n.y)) continue;
    if (!pass({ x: tick.x, y: tick.y }, n)) continue;
    if (!canHoldItem(state.floor, n.x, n.y)) continue;
    return stepTo(state, n);
  }
  return null;
}

/**
 * ITM-07 — shed dead weight so the next find fits. Only ever offered on a tile that can legally
 * take an item: ITM-04 allows one item per tile and ITM-07 forbids dropping on a feature tile, so a
 * Drop proposed anywhere else is refused and costs the bot a turn of clock for nothing.
 *
 * @returns {object|null} a `drop` action, or null
 */
export function declutterPolicy(game) {
  const state = game.state;
  const tick = state.tick;
  if (tick.inventory.length < INVENTORY_SLOTS) return null;
  if (!canHoldItem(state.floor, tick.x, tick.y)) return null;
  const slot = droppableSlot(tick);
  return slot >= 0 ? { type: 'drop', slot } : null;
}

/**
 * Every item Tick remembers seeing and has not collected (WLD-05's memory, `floor.memoryItems`),
 * nearest first. `skip` holds tiles the bot has already failed to reach.
 */
export function rememberedItems(game, skip) {
  const state = game.state;
  const tick = state.tick;
  const out = state.floor.memoryItems.filter((m) => !skip.has(idx(m.x, m.y)));
  out.sort(
    (a, b) =>
      chebyshev(tick.x, tick.y, a.x, a.y) - chebyshev(tick.x, tick.y, b.x, b.y) || readingOrder(a, b),
  );
  return out;
}

/** Has Tick seen any tile of this room (WLD-05's memory)? */
export function roomSeen(state, room) {
  const memory = state.floor.memory;
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) if (memory[y][x] !== -1) return true;
  }
  return false;
}

/**
 * The nearest **frontier** tile: a remembered walkable tile with at least one neighbour Tick has
 * never seen. Walking to one is how an explorer that only knows what it has seen (WLD-05) finds
 * the rest of a floor; when there are none, the floor is mapped.
 *
 * @param {object} state
 * @param {Set<number>} skip tiles already written off
 * @returns {{x: number, y: number}|null}
 */
export function nearestFrontier(state, skip) {
  const memory = state.floor.memory;
  const tick = state.tick;
  let best = null;
  let bestDistance = Infinity;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const remembered = memory[y][x];
      // A closed door is the frontier: WLD-05 stops the shadowcast at one, so everything behind it
      // is unseen, and bumping it opens it (WLD-02).
      if (remembered === -1) continue;
      if (!walkable(remembered) && remembered !== TILE.DOOR_CLOSED) continue;
      if (skip.has(idx(x, y))) continue;
      let open = false;
      for (const n of neighbors8(x, y)) {
        if (memory[n.y][n.x] === -1) {
          open = true;
          break;
        }
      }
      if (!open) continue;
      const d = chebyshev(tick.x, tick.y, x, y);
      if (d < bestDistance) {
        best = { x, y };
        bestDistance = d;
      }
    }
  }
  return best;
}

/** The room rectangle `room` contains `(x, y)`. */
export function inRoom(room, x, y) {
  return x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
}

/** Is the floor's Winding Station usable and known (CHR-05)? Returns its tile or null. */
export function knownStation(game) {
  const state = game.state;
  if (state.floor.stationSpent) return null;
  const station = state.floor.features.station;
  if (!station) return null;
  if (state.floor.memory[station.y][station.x] === -1) return null;
  return station;
}

/** The up-stairs tile, once Tick has seen it (WLD-05). */
export function knownStairs(game) {
  const state = game.state;
  const stairs = state.floor.features.stairs;
  if (!stairs) return null;
  if (state.floor.memory[stairs.y][stairs.x] === -1) return null;
  return stairs;
}

export { approachPathTo, chebyshev, idx, TILE };
