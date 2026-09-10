// BAL-07 **S6 Loot** — no bot, 1,000 floors. "Every floor's item multiset is non-empty; a plating
// item appears in >= 99% of floor-1 caches; uniques <= 1 per run."
//
// Each run generates floors 1-7 of one seed with ITM-10's unique tracking threaded through, exactly
// as the engine does on Ascend, so "per run" means what it means in a game. Floor 8 carries no
// items at all (FLR-09), which is why the sweep is floors 1-7 — seven floors per seed, so 200 seeds
// is 1,400 floors and the check's 1,000 is covered.

import { generateFloor } from '../../src/gen.js';
import { itemDef, isUnique } from '../../src/items.js';

export const id = 'S6';
export const label = 'Loot';

/** The floors that carry items (FLR-02..FLR-08). */
export const FLOORS = [1, 2, 3, 4, 5, 6, 7];

/** BAL-07 S6: "a plating item appears in >= 99% of floor-1 caches". */
export const PLATING_CATEGORY = 'plating';

/**
 * @param {string} seedString
 * @returns {{seed: string, floors: {number: number, items: string[], cache: string[],
 *            cachePlating: boolean}[], uniques: string[]}}
 */
export function runSeed(seedString) {
  const uniques = [];
  const floors = [];
  for (const n of FLOORS) {
    const floor = generateFloor(seedString, n, { uniques });
    const cache = floor.items.filter((i) => i.source === 'cache').map((i) => i.name);
    floors.push({
      number: n,
      items: floor.items.map((i) => i.name),
      cache,
      cachePlating: cache.some((name) => itemDef(name).category === PLATING_CATEGORY),
    });
    for (const item of floor.items) {
      if (isUnique(item.name) && !uniques.includes(item.name)) uniques.push(item.name);
    }
  }
  return { seed: seedString, floors, uniques };
}
