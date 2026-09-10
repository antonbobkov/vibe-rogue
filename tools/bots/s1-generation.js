// BAL-07 **S1 Generation** — no bot. "100% of floors 1-7 validate within 50 retries; mean retries
// < 0.2."
//
// `generateFloor` throws when WLD-10's 50 regenerations are exhausted, and records the number it
// took on `floor.retries` (PLN-06 M03 task 3), so both halves of the target are read straight off
// the generator. Floor 8 is loaded from data (WLD-13) and never validated, which is why the check
// names floors 1-7.

import { generateFloor } from '../../src/gen.js';
import { isUnique } from '../../src/items.js';

export const id = 'S1';
export const label = 'Generation';

/** WLD-10: "regenerate on validation failure ... up to 50". */
export const MAX_RETRIES = 50;

/** The floors the check covers. */
export const FLOORS = [1, 2, 3, 4, 5, 6, 7];

/**
 * Generate floors 1-7 of one seed, threading ITM-10's unique tracking through the run.
 *
 * @param {string} seedString
 * @returns {{seed: string, floors: {number: number, retries: number}[], failed: number}}
 */
export function runSeed(seedString) {
  const uniques = [];
  const floors = [];
  let failed = 0;
  for (const n of FLOORS) {
    try {
      const floor = generateFloor(seedString, n, { uniques });
      floors.push({ number: n, retries: floor.retries });
      // ITM-10 / D-053: the engine records exactly the uniques a floor placed, and the next
      // floor's rolls are made against that list.
      for (const item of floor.items) {
        if (isUnique(item.name) && !uniques.includes(item.name)) uniques.push(item.name);
      }
    } catch (error) {
      failed += 1;
      floors.push({ number: n, retries: MAX_RETRIES + 1, error: error.message });
    }
  }
  return { seed: seedString, floors, failed };
}
