// BAL-07 **S2 Clock only** — "Bot that walks the BFS-shortest path to the stairs each floor, never
// fights (enemies removed)". Target: arrives at floor 8 with 60-80 Tension.
//
// Two readings had to be fixed to make the check runnable; both are logged as D-entries.
//
//  * **The station.** BAL-07 spells out "never uses ... stations" for S3 and says nothing about
//    stations for S2, and the target is unreachable either way if the omission is read as a
//    prohibition: seven BFS-shortest paths are ~450 turns, which is 90 Tension of CHR-04 decay, so
//    a station-less clock bot arrives at floor 8 with ~10 and no BAL-08 knob can lift it to 60.
//    Winding at every station overshoots the other way (~92). So S2 winds the spring exactly when
//    the game itself says to: at CHR-03's first warning, Tension <= 30 — which is also where
//    BAL-01's own model puts the player when they reach the station ("the pre-station low points
//    (30-39 on floors 2-6 ...) cross the yellow/red warnings (CHR-03), which is the moment the game
//    asks 'station first, or loot first?'"). See D-098.
//  * **Wanderers.** WLD-14 (DIF-06) keeps sending enemies at a floor for as long as Tick is on
//    it, so "enemies removed" has to be applied after every action rather than once on arrival —
//    otherwise this bot measures a fight it is not meant to be in, and dies to it (D-112).
//  * **Hazards.** The path avoids WLD-08 hazards when another one exists (UI-13's rule), and
//    crosses them only when the stairs are otherwise unreachable. Walking a Grinding Gear line at
//    level 1 kills the bot outright, and a dead bot measures nothing. See D-099.
//
// "enemies removed" is the one liberty this bot takes with the state, and BAL-07 names it.

import { bfsField, stepDownField, hazardStall, stepsIntoLock, idx, TILE } from './util.js';

export const id = 'S2';
export const label = 'Clock only';

/** The last floor S2 reaches: BAL-07 measures it on arrival at floor 8. */
export const STOP_ON_FLOOR = 8;

/** CHR-03's first Tension warning, and UI-13's first travel stop. */
export const WIND_AT = 30;

/** A BFS field toward `(x, y)` that routes around hazards when it can (UI-13). */
function fieldTo(state, target) {
  if (!target) return null;
  // WLD-15 (DIF-12): a clock bot never spends spring on a lock, so it plans around them.
  const avoiding = bfsField(state, target.x, target.y, { locks: false });
  if (avoiding[idx(state.tick.x, state.tick.y)] >= 0) return avoiding;
  return bfsField(state, target.x, target.y, { hazardsPassable: true, locks: false });
}

export function createBot() {
  /** The two fields this floor needs, computed once on entry — the map does not move. */
  let stairsField = null;
  let stationField = null;

  return {
    id,
    label,
    stopOnFloor: STOP_ON_FLOOR,
    /** No skills: an unspent point is left unspent, which changes nothing about the clock. */
    build: [],

    /** WLD-14: the floor keeps making more, so they keep being removed (D-112). */
    afterAction(game) {
      game.state.floor.enemies.length = 0;
    },

    onFloorEntered(game) {
      const state = game.state;
      state.floor.enemies.length = 0;
      state.floor.decoy = null;
      stairsField = fieldTo(state, state.floor.features.stairs);
      stationField = fieldTo(state, state.floor.features.station);
    },

    decide(game) {
      const state = game.state;
      const tick = state.tick;

      // CHR-05: wind at the station once CHR-03's warning has fired and there is one to wind.
      const station = state.floor.features.station;
      if (station && !state.floor.stationSpent && stationField && tick.tension <= WIND_AT) {
        if (tick.x === station.x && tick.y === station.y) return { type: 'interact' };
        const step = stepDownField(state, stationField, { locks: false });
        if (step) return hazardStall(state, step) || step;
      }

      if (state.floor.tiles[tick.y][tick.x] === TILE.STAIRS_UP) return { type: 'ascend' };
      if (!stairsField) return null;
      const step = stepDownField(state, stairsField, { locks: false });
      if (!step) return null;
      return hazardStall(state, step) || step;
    },
  };
}
