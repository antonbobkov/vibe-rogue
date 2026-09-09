// Items, inventory, equipment and loot — the M04 stub (PLN-06 M04 task 4, M05).
//
// **This module is a contract.** M05 replaces it *in place*: `engine.js`, `turn.js`, `combat.js`
// and `actors.js` call only the functions below, so the full inventory of `12-items-and-inventory.md`
// and the loot tables of `ITM-10`/`ITM-11` can be written here without touching the engine.
//
// What is already real in M04 (because CMB-01 and CMB-06 need it):
//   * `itemDef`          — the catalog lookup.
//   * `equipmentMods`    — CHR-08's equipment half of `derive()` (attributes, evasion, decayPeriod).
//   * `placeFloorItems`  — the generator's records, verbatim (WLD-11 step 8 already rolled them).
//   * `itemAt`, `takeFromStack`, `addToInventory` — the ITM-03/ITM-04 bookkeeping the throw and
//     pickup paths in `engine.js` drive.
//
// What is a declared stub, to be filled by M05 without changing its signature:
//   * `onBreak`          — ITM-11 drops. Rolls nothing here, and consumes **no** RNG draw, so the
//                          scripted `queueRng` sequences of the M04 tests stay exact. When M05
//                          adds the `d100` drop roll, every test that breaks an enemy needs one
//                          more draw; the M04 tests already supply spare high values for it.
//   * `useItem`, `equip`, `unequip`, `drop` — ITM-07, ITM-09.
//   * `applyThrowEffect`   — CAT-06's throwable effects, called by `combat.throwAt` once the
//                          landing tile is known.
//   * `applyWeaponSpecial` — CAT-02/CAT-03's `REND`, `SWEEP`, `KNOCK`, `TEMPO`, `RING`, called by
//                          `combat.attack` at CMB-06 step 6 with the damage already dealt.
//
// Nothing here touches the DOM (PLN-02 R2). M04 imports nothing from `combat.js`, but M05 may:
// `combat.js` imports this module as a namespace (`import * as items`), and an ESM namespace cycle
// resolves at call time, so `import * as combat from './combat.js'` here is safe as long as the
// binding is only *read inside functions*, never at module-evaluation time.

import { ITEMS_BY_NAME } from '../data/items.js';

/** The base Tension decay period of CHR-04; the Governor's REGULATED special is the only change. */
export const BASE_DECAY_PERIOD = 5;
export const REGULATED_DECAY_PERIOD = 6;

/** ITM-03: ten slots, lettered a–j, consumables stacking to five. */
export const INVENTORY_SLOTS = 10;
export const STACK_MAX = 5;

/** The catalog entry for an item name (`21-items-catalog.md`), or a throw for a typo. */
export function itemDef(name) {
  if (name === null || name === undefined) return null;
  const def = ITEMS_BY_NAME[name];
  if (!def) throw new RangeError(`items: no item named '${name}' in data/items.js`);
  return def;
}

/** Is this a consumable that stacks (ITM-01)? */
export function stacks(name) {
  const def = itemDef(name);
  return def.category === 'instant' || def.category === 'throwable';
}

/**
 * CHR-08's equipment contribution to `derive()` (`actors.js`).
 *
 * `evasion` is the *signed* modifier CMB-01 adds to the base 10: an attachment's `evasionMod`
 * minus the plating item's `evasionPenalty`. `decayPeriod` is CHR-04's, which only the Governor
 * (`REGULATED`, CAT-05) changes.
 *
 * @param {object} tick the TEC-05 `state.tick`
 * @returns {{force: number, precision: number, plating: number, evasion: number,
 *            decayPeriod: number, meleeAccuracyMod: number, rangedAccuracyMod: number}}
 */
export function equipmentMods(tick) {
  const eq = (tick && tick.equipment) || {};
  const weapon = itemDef(eq.weapon || null);
  const plating = itemDef(eq.plating || null);
  const attachment = itemDef(eq.attachment || null);

  const mods = {
    force: 0,
    precision: 0,
    plating: 0,
    evasion: 0,
    decayPeriod: BASE_DECAY_PERIOD,
    meleeAccuracyMod: 0,
    rangedAccuracyMod: 0,
  };

  if (plating) {
    mods.plating += plating.plating || 0;
    mods.evasion -= plating.evasionPenalty || 0;
  }
  if (attachment) {
    mods.force += attachment.forceMod || 0;
    mods.precision += attachment.precisionMod || 0;
    mods.plating += attachment.platingMod || 0;
    mods.evasion += attachment.evasionMod || 0;
    if (attachment.special === 'REGULATED') mods.decayPeriod = REGULATED_DECAY_PERIOD;
  }
  if (weapon) {
    if (weapon.category === 'melee') mods.meleeAccuracyMod = weapon.accuracyMod || 0;
    if (weapon.category === 'ranged') mods.rangedAccuracyMod = weapon.accuracyMod || 0;
  }
  return mods;
}

/** The equipped melee weapon (ITM-08: a ranged weapon in the slot leaves Tick unarmed, D-043). */
export function meleeWeapon(tick) {
  const def = itemDef((tick.equipment && tick.equipment.weapon) || null);
  return def && def.category === 'melee' ? def : null;
}

/** The equipped ranged weapon, or null when the weapon slot holds something else (CMB-08). */
export function rangedWeapon(tick) {
  const def = itemDef((tick.equipment && tick.equipment.weapon) || null);
  return def && def.category === 'ranged' ? def : null;
}

// ---------------------------------------------------------------------------------------------
// Items on the floor (ITM-04)
// ---------------------------------------------------------------------------------------------

/** The item record on a tile, or null. At most one item per tile (ITM-04). */
export function itemAt(floor, x, y) {
  for (const it of floor.items) if (it.x === x && it.y === y) return it;
  return null;
}

/**
 * Put the generator's item records on a new floor (WLD-11 step 8; `gen.js` already rolled them,
 * so M04 and M05 both place them verbatim).
 *
 * @param {object} floor the TEC-05 `state.floor` under construction
 * @param {{name: string, count?: number, x: number, y: number, source?: string}[]} records
 * @param {object} ctx the engine turn context (`{state, rng, lines, emit}`) — unused here, but
 *        M05 keeps the signature so a future rule may log or roll.
 */
export function placeFloorItems(floor, records, ctx) {
  for (const r of records) {
    floor.items.push({ name: r.name, count: r.count === undefined ? 1 : r.count, x: r.x, y: r.y });
  }
  return floor.items;
}

/**
 * ITM-11 — an enemy broke: roll `d100` against its `dropChance`, roll its drop table, and place
 * the item on its tile or the nearest free tile (bosses: no distance limit).
 *
 * **M04 stub: rolls nothing, places nothing, and consumes no RNG draw.** M05 implements it; the
 * engine already calls it from `combat.breakActor`, so no engine edit is needed.
 *
 * @param {object} enemy the broken enemy instance (`x`, `y`, `type`, `isBoss`)
 * @param {{state: object, rng: {next: () => number}, lines: object[], emit: Function}} ctx
 * @returns {{name: string, count: number, x: number, y: number}|null} the placed record, or null
 */
export function onBreak(enemy, ctx) {
  return null;
}

// ---------------------------------------------------------------------------------------------
// Inventory bookkeeping (ITM-03) — the parts the M04 engine drives
// ---------------------------------------------------------------------------------------------

/** The inventory slot index holding `name`, or -1. */
export function slotOf(tick, name) {
  return tick.inventory.findIndex((s) => s.name === name);
}

/**
 * Add `count` of an item to the inventory per ITM-03 (fill a non-full stack of the same name
 * first, else take a free slot).
 *
 * @returns {{ok: boolean, reason?: string, slot?: number}} `ok:false, reason:'full'` when neither
 *          a stack nor a slot has room (ITM-03, ACC-50).
 */
export function addToInventory(tick, name, count = 1) {
  if (stacks(name)) {
    for (let i = 0; i < tick.inventory.length; i++) {
      const slot = tick.inventory[i];
      if (slot.name === name && slot.count + count <= STACK_MAX) {
        slot.count += count;
        return { ok: true, slot: i };
      }
    }
  }
  if (tick.inventory.length >= INVENTORY_SLOTS) return { ok: false, reason: 'full' };
  tick.inventory.push({ name, count });
  return { ok: true, slot: tick.inventory.length - 1 };
}

/**
 * Remove one item from the stack in `slot`, compacting the inventory when the stack empties
 * (ITM-03). Returns the item's name, or null when the slot does not exist.
 */
export function takeFromStack(tick, slot) {
  const entry = tick.inventory[slot];
  if (!entry) return null;
  entry.count -= 1;
  if (entry.count <= 0) tick.inventory.splice(slot, 1);
  return entry.name;
}

// ---------------------------------------------------------------------------------------------
// Declared stubs — M05 fills these in place (ITM-07, ITM-09, CAT-06)
// ---------------------------------------------------------------------------------------------

/** The refusal every M04 stub returns, so a caller never mistakes it for a spent turn. */
const NOT_YET = Object.freeze({ ok: false, reason: 'notImplemented' });

/**
 * ITM-06 — pick the item on Tick's tile up. Records go to the Journal (ITM-03, SCR-04).
 * @param {object} ctx the engine turn context
 * @returns {{ok: boolean, reason?: string}}
 */
export function pickUp(ctx) {
  return NOT_YET;
}

/**
 * ITM-09 — use the instant consumable in `slot` (effect ids per TEC-04).
 * @param {object} ctx the engine turn context
 * @param {number} slot inventory slot index
 */
export function useItem(ctx, slot) {
  return NOT_YET;
}

/** ITM-02/ITM-07 — equip the item in `slot`, swapping whatever occupies its slot. */
export function equip(ctx, slot) {
  return NOT_YET;
}

/** ITM-07 — unequip 'weapon' | 'plating' | 'attachment' into a free inventory slot. */
export function unequip(ctx, which) {
  return NOT_YET;
}

/** ITM-07 — drop the whole stack in `slot` onto Tick's tile. */
export function drop(ctx, slot) {
  return NOT_YET;
}

/**
 * CAT-06 — apply a thrown consumable's effect at its landing tile. Called by `combat.throwAt`
 * once the landing tile is known and the noise has been emitted (CMB-08).
 *
 * @param {object} ctx the engine turn context
 * @param {string} name the thrown item's name
 * @param {number} x landing tile x
 * @param {number} y landing tile y
 * @param {object[]} targets every actor within the throwable's `radius` (Chebyshev), Tick
 *        included, in enemy id order with Tick first if present
 */
export function applyThrowEffect(ctx, name, x, y, targets) {
  return null;
}

/**
 * CAT-02 / CAT-03 — the equipped weapon's own special, resolved at CMB-06 step 6 ("on-hit effects
 * from the weapon"). `combat.attack` calls this for Tick's melee and ranged attacks with the
 * weapon's `special` id; enemies never wield items, so they never reach it.
 *
 * **M04 stub: does nothing and consumes no RNG draw.** M05 implements the five ids without editing
 * `combat.js` (PLN-06 M05 task 3).
 *
 * @param {object} ctx the engine turn context
 * @param {'REND'|'SWEEP'|'KNOCK'|'TEMPO'|'RING'} special the id from `data/items.js` (TEC-04)
 * @param {object} attacker Tick
 * @param {object} defender the actor that was hit
 * @param {number} dealt the damage after Plating — the trigger several specials test
 */
export function applyWeaponSpecial(ctx, special, attacker, defender, dealt) {
  return null;
}
