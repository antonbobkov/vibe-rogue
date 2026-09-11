// BAL-07 **S4 Greedy explorer** — "Bot that visits every room, fights everything, uses the station
// on sight, takes Armature then Tinkering, uses Solder < 50% and Spring-Key < 30, steps away from
// telegraphs". Targets: wins 30-60% of runs; median death floor of losses is 6-8.
//
// It is also ACC-131's bot, with `springKeys: false` — "a full-explore scripted run on seed
// TEST1234 with no Spring-Keys used".
//
// The policy is a fixed priority list, read top to bottom every turn. Nothing here is random: the
// only rolls a run makes are the engine's, from the seeded play RNG (PLN-02 R6).
//
// Two pieces of bookkeeping are not in BAL-07's sentence but are needed for the sentence to mean
// anything, and both are logged as D-entries:
//
//  * A **committed travel goal** (D-104). "Visits every room" needs a goal that survives more than
//    one turn: choosing the Chebyshev-nearest unvisited room afresh every turn makes Tick oscillate
//    between two tiles for ever whenever the nearest room flips back and forth along the path. A
//    goal is kept until it is reached, invalidated, or times out.
//  * **Giving up** on a chase, a telegraph dodge, and an unreachable item (D-101 to D-103), each
//    for the same reason: the engine's own rules (a retreating SKIRMISHER, a re-winding BRUISER, a
//    full pack) otherwise produce loops that run until the spring is empty.

import {
  visibleEnemies,
  createChaseTracker,
  stepAwayFromTelegraph,
  stepAwayFromEnemies,
  consumablePolicy,
  throwPolicy,
  equipPolicy,
  itemUnderfoot,
  pickupPolicy,
  declutterPolicy,
  droppableSlot,
  stepToDropSpot,
  rememberedItems,
  knownStation,
  knownStairs,
  inRoom,
  roomSeen,
  nearestFrontier,
  approachPathTo,
  firstStep,
  stepTo,
  stepToward,
  hazardStall,
  stepsIntoLock,
  slotWith,
  SPRING_KEY_AT,
  chebyshev,
  idx,
  LOCK_TENSION,
} from './util.js';

export const id = 'S4';
export const label = 'Greedy explorer';

/** "takes Armature then Tinkering" (BAL-07 S4) — CHR-09's rank order within each discipline. */
export const BUILD = Object.freeze([
  'Braced Frame',
  'Overwind Strike',
  'Flywheel Guard',
  'Piston Drive',
  'Salvage',
  'Efficient Springs',
  'Field Repair',
  'Clockwork Decoy',
]);

/** Above this Tension the bot is willing to spend 8 on an Overwind Strike (BAL-01's model). */
const OVERWIND_TENSION_FLOOR = 45;

/**
 * DIF-03 — **breaking off to mend**. A repair takes three turns and any hit ends it, so a bot that
 * swings at whatever it can see never solders at all: measured on the M13 defaults, the S4 bot
 * spent 4.6% of its turns below 60% Integrity and was out of contact for 8% of those, so it died
 * on floor 3 with a full pack of Solder. Getting out is the answer the rule is asking for, and a
 * fifth-run player gives it (OVR-05), so the bot does too (D-113).
 *
 * Below `RETREAT_AT` of maximum Integrity, with Solder in the pack, it steps away from what it can
 * see instead of trading — for at most `RETREAT_PATIENCE` consecutive turns, so a FAST enemy it
 * cannot outrun is fought rather than kited around the floor for ever.
 */
const RETREAT_AT = 0.55;
const RETREAT_PATIENCE = 10;

/**
 * CHR-05 (DIF-05) — **when to wind**. BAL-07 wrote "uses the station on sight", which was free
 * advice while winding was silent: winding at 90 Tension throws away 90 of the 100 and, since
 * M13, also rings the floor's every enemy at Tick (`stationNoise`). A fifth-run player winds when
 * the spring is actually low, so the bot does too (D-114). ACC-131's variant is CHR-03's own
 * warning, 30.
 */
const STATION_AT = 45;

/** An enemy worth an Overwind Strike rather than a plain swing: bosses and the heavy regulars. */
const OVERWIND_INTEGRITY = 16;

/**
 * How long one travel goal may take before it is written off. Twice ENM-08's 60-step path cap,
 * which bounds the longest legal route across a 60x24 floor, so a goal that is actually being
 * approached is never dropped.
 */
const GOAL_PATIENCE = 120;

/**
 * @param {{springKeys?: boolean, stationAt?: number|'sight'}} [opts]
 *        `springKeys: false` and `stationAt: 30` are ACC-131's run (D-106).
 */
export function createBot(opts = {}) {
  const springKeys = opts.springKeys !== false;
  const stationAt = opts.stationAt === undefined ? STATION_AT : opts.stationAt;

  /** Per-floor memory. */
  let visitedRooms = new Set();
  let abandonedRooms = new Set();
  /** Tiles written off: unreachable, or holding an item this run will not carry. */
  let avoid = new Set();
  let goal = null;
  let dodgedLastTurn = false;
  let retreating = 0;
  const chase = createChaseTracker();

  return {
    id,
    label,
    build: BUILD,
    springKeys,

    onFloorEntered(game) {
      visitedRooms = new Set();
      abandonedRooms = new Set();
      avoid = new Set();
      goal = null;
      dodgedLastTurn = false;
      retreating = 0;
      chase.reset();
      markRoom(game);
    },

    /** Called after every action, so "visits every room" is measured on where Tick has been. */
    afterAction(game) {
      markRoom(game);
    },

    /** Has every room on this floor been entered? Floor 8 has no rooms, so it is trivially done. */
    exploredEverything(game) {
      return game.state.floor.rooms.every(
        (room) => visitedRooms.has(room.id) || abandonedRooms.has(room.id),
      );
    },

    decide(game) {
      const state = game.state;
      const tick = state.tick;

      // 1. "uses Solder < 50% and Spring-Key < 30".
      const consumable = consumablePolicy(game, { springKeys });
      if (consumable) return consumable;

      // 1b. DIF-03: break off and mend. A repair only runs while nothing is looking at Tick, so
      //     the Solder in the pack is worth nothing until the fight is left behind (D-113).
      const inContact = visibleEnemies(game).length > 0;
      if (!inContact) retreating = 0;
      if (
        inContact &&
        tick.integrity < tick.integrityMax * RETREAT_AT &&
        !tick.repair &&
        slotWith(tick, 'Solder') >= 0 &&
        // Backing away costs turns, and turns are spring: with the spring already low there is
        // nothing to buy the retreat with, so the fight is finished instead (CHR-04).
        tick.tension > SPRING_KEY_AT &&
        retreating < RETREAT_PATIENCE
      ) {
        const away = stepAwayFromEnemies(game);
        if (away) {
          retreating += 1;
          return away;
        }
      }

      // 2. Field Repair is the fallback when the Solder has run out (SKL-03, once per floor).
      if (
        tick.integrity < tick.integrityMax * 0.5 &&
        slotWith(tick, 'Solder') < 0 &&
        tick.skills.includes('Field Repair') &&
        !tick.fieldRepairUsed &&
        tick.tension > 12
      ) {
        return { type: 'skill', name: 'Field Repair' };
      }

      // 3. "steps away from telegraphs" — the heavy hits BAL-02 names, and only on alternate turns
      //    so that a re-winding BRUISER is traded with rather than danced around for ever (D-103).
      if (!dodgedLastTurn) {
        const dodge = stepAwayFromTelegraph(game);
        if (dodge) {
          dodgedLastTurn = true;
          return dodge;
        }
      }
      dodgedLastTurn = false;

      // 3b. DIF-04: spend the throwables Salvage pays in, rather than carrying them to the grave
      //     (D-115). A Stun or a Blind is worth more than the swing it replaces.
      const thrown = throwPolicy(game);
      if (thrown) return thrown;

      // 4. "fights everything" — a visible boss first, then the nearest, skipping the ones this
      //    floor's chases have given up on (ENM-06's retreating SKIRMISHER).
      for (const target of visibleEnemies(game, { bossesFirst: true })) {
        if (chase.abandoned(target)) continue;
        if (!chase.track(state, target)) continue;
        if (chebyshev(tick.x, tick.y, target.x, target.y) === 1) {
          // A big target is worth the 8 Tension Overwind Strike costs (SKL-02, BAL-06 Frame).
          if (
                tick.skills.includes('Overwind Strike') &&
            tick.tension > OVERWIND_TENSION_FLOOR &&
            target.integrity >= OVERWIND_INTEGRITY
          ) {
            return {
              type: 'skill',
              name: 'Overwind Strike',
              dx: sign(target.x - tick.x),
              dy: sign(target.y - tick.y),
            };
          }
          const step = stepTo(state, target);
          if (step) return step;
        }
        // WLD-15 (DIF-12): the guard inside a locked cache is only worth the spring if there is
        // spring to spare.
        const locks = tick.tension >= LOCK_TENSION;
        const approach = firstStep(state, approachPathTo(state, target.x, target.y, { locks }));
        if (approach) return approach;
        const far = stepToward(state, target.x, target.y, { locks });
        if (far) return far;
      }

      // 5. Loot underfoot, wear the best of what is carried, shed the rest (ITM-02, ITM-04, ITM-07).
      //    `avoid` doubles as the "leave this one alone" set: without it, shedding dead weight and
      //    then standing on it is a pickup/drop cycle that never ends.
      const hereIndex = idx(tick.x, tick.y);
      if (!avoid.has(hereIndex)) {
        const pick = pickupPolicy(game);
        if (pick) return pick;
        if (itemUnderfoot(game)) {
          // ITM-03: ten slots, all full. Step off, shed something, and come back for this.
          const away = droppableSlot(tick) >= 0 ? stepToDropSpot(state) : null;
          if (away) return away;
          avoid.add(hereIndex);
        }
      }
      const equip = equipPolicy(game);
      if (equip) return equip;
      const declutter = declutterPolicy(game);
      if (declutter) {
        // Whatever is shed lands on this tile, so the bot must not come back for it.
        avoid.add(hereIndex);
        return declutter;
      }

      // 6. Travel: the station on sight, then the loot, then the unvisited rooms, then up. One goal
      //    at a time, kept until it is reached, invalidated or timed out (D-104). Five attempts is
      //    enough to retire the whole priority list within one turn.
      for (let attempt = 0; attempt < 5; attempt++) {
        if (goal === null) goal = chooseGoal(game);
        if (goal === null) break;
        if (!goalIsValid(game, goal) || state.turn - goal.since > GOAL_PATIENCE) {
          retire(goal);
          continue;
        }
        if (tick.x === goal.x && tick.y === goal.y) {
          if (goal.kind === 'station') return { type: 'interact' };
          if (goal.kind === 'stairs') return { type: 'ascend' };
          // An item or a room goal is finished by standing there; step 5 handles the item.
          goal = null;
          continue;
        }
        // WLD-15 (DIF-12): the cache costs spring. Below `LOCK_TENSION` the bot plans around the
        // locks, and a goal only a lock can reach is written off for this floor.
        const step = stepToward(state, goal.x, goal.y, { locks: tick.tension >= LOCK_TENSION });
        if (step) {
          if (stepsIntoLock(state, step) && tick.tension < LOCK_TENSION) {
            retire(goal);
            continue;
          }
          return hazardStall(state, step) || step;
        }
        retire(goal);
      }
      return null;
    },
  };

  function sign(n) {
    return n > 0 ? 1 : n < 0 ? -1 : 0;
  }

  /** Record the room Tick is standing in as visited. */
  function markRoom(game) {
    const tick = game.state.tick;
    for (const room of game.state.floor.rooms) {
      if (inRoom(room, tick.x, tick.y)) visitedRooms.add(room.id);
    }
  }

  /** Write a goal off for the rest of the floor. */
  function retire(current) {
    if (current) {
      avoid.add(idx(current.x, current.y));
      if (current.roomId !== undefined) abandonedRooms.add(current.roomId);
    }
    goal = null;
  }

  /** Is this goal still worth walking to? */
  function goalIsValid(game, current) {
    const state = game.state;
    switch (current.kind) {
      case 'station':
        return knownStation(game) !== null;
      case 'item':
        return state.floor.memoryItems.some((m) => m.x === current.x && m.y === current.y);
      case 'room':
        return !visitedRooms.has(current.roomId);
      default:
        return true;
    }
  }

  /** BAL-07's priority order: the station on sight, the loot, every room, then the way up. */
  function chooseGoal(game) {
    const state = game.state;
    const tick = state.tick;
    const at = (kind, x, y, extra) => Object.assign({ kind, x, y, since: state.turn }, extra || {});

    // "uses the station on sight" (CHR-05). ACC-131's variant waits for CHR-03's warning instead,
    // which is where BAL-01's model puts the player when they reach the station (D-106).
    const station = knownStation(game);
    const wantStation = stationAt === 'sight' || tick.tension <= stationAt;
    if (station && wantStation && !avoid.has(idx(station.x, station.y))) {
      return at('station', station.x, station.y);
    }

    // Everything already seen and not yet carried (WLD-05's item memory).
    const item = rememberedItems(game, avoid)[0];
    if (item) return at('item', item.x, item.y);

    // "visits every room": the nearest room Tick has seen and not yet entered. Only rooms it has
    // seen — a bot that reads unseen room rectangles out of the floor object knows more than the
    // game ever shows a player, which is not what WLD-05 models (D-105).
    let room = null;
    let best = Infinity;
    for (const candidate of state.floor.rooms) {
      if (visitedRooms.has(candidate.id) || abandonedRooms.has(candidate.id)) continue;
      if (!roomSeen(state, candidate)) continue;
      const d = chebyshev(tick.x, tick.y, candidate.cx, candidate.cy);
      if (d < best) {
        room = candidate;
        best = d;
      }
    }
    if (room) return at('room', room.cx, room.cy, { roomId: room.id });

    // Nothing known left to visit: walk to the edge of what is mapped and look further.
    const frontier = nearestFrontier(state, avoid);
    if (frontier) return at('frontier', frontier.x, frontier.y);

    // Up. Floor 8 has no stairs — its exit is the Understudy (FLR-09, BST-06).
    const stairs = knownStairs(game) || state.floor.features.stairs;
    if (stairs) return at('stairs', stairs.x, stairs.y);
    const understudy = state.floor.features.understudy;
    if (understudy) return at('understudy', understudy.x, understudy.y);
    return null;
  }
}
