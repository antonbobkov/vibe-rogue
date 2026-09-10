// BAL-07 **S3 Pure melee** — "Bot that attacks the nearest enemy until dead, then travels to the
// stairs; uses Solder at < 50%; never uses skills or stations". Target: dies on floor 3-5 in >= 80%
// of runs, "the boss or floor 4 should stop a skill-less bruteforce".
//
// So: no `skill` action, no `takeSkill`, no `interact` on a Winding Station, and no Spring-Key — the
// only consumable it touches is the Solder the check names.
//
// It *does* loot: it collects the items it has seen and wears the best of them (D-100). BAL-02's
// Integrity budget — the model this check is validating — assumes exactly that progression
// ("Plating 0 -> 1 (Tin, mid-floor)" on floor 1, "Plating 2 (Brass)" on floor 2), and without it
// the bot dies on floors 1-2 in 40% of runs, which is not what BAL-07 says should stop it ("the
// boss or floor 4"). A bruteforce that refuses a better hammer is testing the wrong thing.

import {
  visibleEnemies,
  consumablePolicy,
  equipPolicy,
  itemUnderfoot,
  rememberedItems,
  approachPathTo,
  firstStep,
  stepTo,
  stepToward,
  hazardStall,
  chebyshev,
  idx,
  TILE,
} from './util.js';

export const id = 'S3';
export const label = 'Pure melee';

export function createBot() {
  /** Item tiles the pathfinder could not reach on this floor. */
  let unreachable = new Set();

  return {
    id,
    label,
    /** "never uses skills": nothing is ever taken, so no active is ever available (CHR-09). */
    build: [],

    onFloorEntered() {
      unreachable = new Set();
    },

    decide(game) {
      const state = game.state;
      const tick = state.tick;

      // "uses Solder at < 50%" — and nothing else from the inventory.
      const heal = consumablePolicy(game, { springKeys: false });
      if (heal) return heal;

      // "attacks the nearest enemy until dead": adjacent means attack (CMB-05 Move), else close.
      const enemies = visibleEnemies(game);
      if (enemies.length > 0) {
        const target = enemies[0];
        if (chebyshev(tick.x, tick.y, target.x, target.y) === 1) {
          const step = stepTo(state, target);
          if (step) return step;
        }
        const step = firstStep(state, approachPathTo(state, target.x, target.y));
        if (step) return hazardStall(state, step) || step;
      }

      // Loot: what is underfoot, then what is worth wearing, then what has been seen.
      if (itemUnderfoot(game)) return { type: 'pickup' };
      const equip = equipPolicy(game);
      if (equip) return equip;
      for (const item of rememberedItems(game, unreachable)) {
        const step = stepToward(state, item.x, item.y);
        if (step) return hazardStall(state, step) || step;
        unreachable.add(idx(item.x, item.y));
      }

      // "then travels to the stairs". Never the station (BAL-07 S3).
      if (state.floor.tiles[tick.y][tick.x] === TILE.STAIRS_UP) return { type: 'ascend' };
      const stairs = state.floor.features.stairs;
      if (!stairs) return null;
      const step = stepToward(state, stairs.x, stairs.y);
      if (!step) return null;
      return hazardStall(state, step) || step;
    },
  };
}
