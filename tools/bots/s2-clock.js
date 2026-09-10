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
//  * **Hazards.** The path avoids WLD-08 hazards when another one exists (UI-13's rule), and
//    crosses them only when the stairs are otherwise unreachable. Walking a Grinding Gear line at
//    level 1 kills the bot outright, and a dead bot measures nothing. See D-099.
//
// "enemies removed" is the one liberty this bot takes with the state, and BAL-07 names it.

import { bfsField, stepDownField, hazardStall, idx, TILE } from './util.js';

export const id = 'S2';
export const label = 'Clock only';

/** The last floor S2 reaches: BAL-07 measures it on arrival at floor 8. */
export const STOP_ON_FLOOR = 8;

/** CHR-03's first Tension warning, and UI-13's first travel stop. */
export const WIND_AT = 30;

/** A BFS field toward `(x, y)` that routes around hazards when it can (UI-13). */
function fieldTo(state, target) {
  if (!target) return null;
  const avoiding = bfsField(state, target.x, target.y);
  if (avoiding[idx(state.tick.x, state.tick.y)] >= 0) return avoiding;
  return bfsField(state, target.x, target.y, { hazardsPassable: true });
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
        const step = stepDownField(state, stationField);
        if (step) return hazardStall(state, step) || step;
      }

      if (state.floor.tiles[tick.y][tick.x] === TILE.STAIRS_UP) return { type: 'ascend' };
      if (!stairsField) return null;
      const step = stepDownField(state, stairsField);
      if (!step) return null;
      return hazardStall(state, step) || step;
    },
  };
}
