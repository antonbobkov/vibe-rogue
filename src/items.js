// Items, inventory, equipment and loot: `12-items-and-inventory.md` and `21-items-catalog.md`.
//
// **This module is a contract.** M05 fills in the M04 stub *in place*: `engine.js`, `turn.js`,
// `combat.js` and `actors.js` call only the functions below, so every rule of ITM-01…ITM-12 and
// CAT-01…CAT-07 lives here rather than in the engine.
//
// What the engine calls, and from where:
//   * `equipmentMods(tick)`   — `actors.js#derive()`, CHR-08's equipment half (attributes, evasion,
//                               accuracy modifiers, CHR-04's `decayPeriod`).
//   * `meleeWeapon`/`rangedWeapon` — `actors.js#derive()` (ITM-08, D-043).
//   * `placeFloorItems`       — `engine.js` on every floor entry (WLD-11 step 8).
//   * `itemAt`                — `engine.js` (the map, the memory, the close-door rule).
//   * `pickUp`/`useItem`/`equip`/`unequip`/`drop` — `engine.js#resolveAction` (CMB-05, ITM-07).
//   * `takeFromStack`         — `engine.js`'s throw action, before `combat.throwAt`.
//   * `applyThrowEffect`      — `combat.throwAt`, once the landing tile and the noise are done.
//   * `applyWeaponSpecial`    — `combat.attack` at CMB-06 step 6.
//   * `onBreak`               — `combat.breakActor` (ITM-11 drops).
//   * `tickImmuneTo`          — `actors.js#immuneTo` (CAT-05 COOLING, D-051).
//   * `meleeNoise`/`doorNoise` — `combat.meleeAttack` and `engine.js`'s door bump (CAT-05 QUIET,
//                               D-051).
//
// Nothing here touches the DOM (PLN-02 R2). `combat.js` and `actors.js` import this module, so the
// two namespace imports below are ESM cycles: they resolve at call time and are only ever *read
// inside functions*, never at module-evaluation time.

import { ITEMS_BY_NAME } from '../data/items.js';
import { TUNING } from '../data/tuning.js';
import { ENEMIES_BY_NAME } from '../data/enemies.js';
import { TILE, walkable } from './tiles.js';
import { chebyshev, inBounds, readingOrder } from './grid.js';
import { weighted, chance } from './rng.js';
import * as log from './log.js';
import * as combat from './combat.js';
import * as actors from './actors.js';

/**
 * DIF-02 — the tuning object behind a call. Every difficulty number in this module comes from it;
 * `data/tuning.js`'s defaults stand in for the callers that have no run context (the UI's item
 * descriptions, and the tests that ask about an item rather than about a run).
 */
export function tuningOf(ctx) {
  return (ctx && ctx.tuning) || TUNING;
}

/**
 * The base Tension decay period of CHR-04 (`tuning.decayPeriod`); the Governor's REGULATED special
 * adds `REGULATED_BONUS` to whatever that is (CAT-05). Both constants are the *defaults*: a run
 * reads its own period through `equipmentMods(tick, tuning)`.
 */
export const BASE_DECAY_PERIOD = TUNING.decayPeriod;
export const REGULATED_BONUS = 1;
export const REGULATED_DECAY_PERIOD = TUNING.decayPeriod + REGULATED_BONUS;

/** ITM-03: ten slots, lettered a–j; consumables stack to `tuning.stackMax` (DIF-04). */
export const INVENTORY_SLOTS = 10;
export const STACK_MAX = TUNING.stackMax;

/**
 * ITM-01/02/03 (DIF-07) — an **equipment entry**. A worn or carried piece of equipment is
 * `{name, wear}` (in the inventory, `{name, count: 1, wear}`) rather than a bare name, because
 * CMB-14's corrosion is per item *instance*: two Iron Platings in one pack wear separately, and a
 * plate's wear survives unequipping, re-equipping and a save (ACC-153).
 *
 * A bare string is still read as an unworn entry, so anything that only cares about the name can
 * keep saying what it means.
 */
export function entryName(entry) {
  if (entry === null || entry === undefined) return null;
  return typeof entry === 'string' ? entry : entry.name || null;
}

/** CMB-14: how much wear an equipment entry carries. */
export function entryWear(entry) {
  if (!entry || typeof entry === 'string') return 0;
  return entry.wear > 0 ? entry.wear : 0;
}

/** An equipment entry built from a name and a wear count, as the slots store it. */
export function equipEntry(name, wear = 0) {
  return wear > 0 ? { name, wear } : { name, wear: 0 };
}

/** CMB-14 / ITM-01: a plating entry's effective Plating — `max(0, base - wear)`. */
export function platingOf(entry) {
  const def = itemDef(entryName(entry));
  if (!def || !def.plating) return 0;
  return Math.max(0, def.plating - entryWear(entry));
}

/** ITM-05 / UI-03: how a worn entry is written — `Iron Plating (-2)`. */
export function displayName(entry) {
  const name = entryName(entry);
  if (name === null) return null;
  const wear = entryWear(entry);
  return wear > 0 ? `${name} (${MINUS}${wear})` : name;
}

/** UI-05 writes a negative with a true minus sign. */
const MINUS = '\u2212';

/** ITM-01's three equipment slots (ITM-02), and the category each accepts. */
export const EQUIP_SLOTS = Object.freeze(['weapon', 'plating', 'attachment']);
const SLOT_OF_CATEGORY = Object.freeze({
  melee: 'weapon',
  ranged: 'weapon',
  plating: 'plating',
  attachment: 'attachment',
});
const EQUIP_LOG = Object.freeze({
  weapon: 'equipWeapon',
  plating: 'equipPlating',
  attachment: 'equipAttachment',
});

/** CAT-05 QUIET: Tick's plain melee noise, and the door that makes none (D-051). */
export const QUIET_MELEE_NOISE = 2;
export const SILENT = 0;

/** CAT-06: the three instant amounts, and the **Efficient Springs** (SKL-03) bonus on each. */
export const EFFICIENT_SPRINGS = 'Efficient Springs';

/** The two `tuning` keys behind each CAT-06 amount: the plain total, then the SKL-03 bonus. */
const AMOUNT_KEYS = Object.freeze({
  SOLDER: Object.freeze(['solderAmount', 'efficientSolderBonus']),
  SPRING_KEY: Object.freeze(['springKeyAmount', 'efficientKeyBonus']),
  FLUX: Object.freeze(['fluxAmount', 'efficientFluxBonus']),
});

/**
 * CAT-06 / SKL-03 — what one instant consumable is worth to this Tick: the tuned amount plus
 * **Efficient Springs**' bonus when Tick has the skill. For Solder this is the *total* of the
 * DIF-03 repair, not a per-turn figure.
 *
 * @param {'SOLDER'|'SPRING_KEY'|'FLUX'} effect
 * @param {object|null} tick the TEC-05 `state.tick`, or null for "without the skill"
 * @param {object} [tuning] `data/tuning.js`'s defaults unless a run's own is passed
 * @returns {number|null} null for an effect with no amount (the four throwables)
 */
export function consumableAmount(effect, tick, tuning = TUNING) {
  const keys = AMOUNT_KEYS[effect];
  if (!keys) return null;
  const efficient = tick && Array.isArray(tick.skills) ? tick.skills.includes(EFFICIENT_SPRINGS) : false;
  return tuning[keys[0]] + (efficient ? tuning[keys[1]] : 0);
}

/** ITM-11 — how far from its tile a non-boss drop may be placed. */
export const DROP_SEARCH_RADIUS = 2;

/** ITM-07 / ITM-11: the feature tiles an item may not be dropped on or dropped onto. */
const FEATURE_TILES = new Set([TILE.STAIRS_UP, TILE.STATION, TILE.CHAIR, TILE.ESCAPEMENT]);

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

/** ITM-01: the four categories that go into an equipment slot. */
export function isEquipment(name) {
  const def = itemDef(name);
  return def !== null && SLOT_OF_CATEGORY[def.category] !== undefined;
}

/** ITM-10: is this item generated at most once per run? */
export function isUnique(name) {
  const def = itemDef(name);
  return def !== null && def.unique === true;
}

/** ITM-03: the slot letters of the inventory screen, `a`–`j` in display order. */
export function slotLetter(i) {
  if (!Number.isInteger(i) || i < 0 || i >= INVENTORY_SLOTS) return null;
  return String.fromCharCode(97 + i);
}

/** The inventory index a letter `a`–`j` names, or -1. */
export function slotOfLetter(letter) {
  if (typeof letter !== 'string' || letter.length !== 1) return -1;
  const i = letter.charCodeAt(0) - 97;
  return i >= 0 && i < INVENTORY_SLOTS ? i : -1;
}

// ---------------------------------------------------------------------------------------------
// Equipment (ITM-02, ITM-08, CHR-08)
// ---------------------------------------------------------------------------------------------

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
export function equipmentMods(tick, tuning = TUNING) {
  const eq = (tick && tick.equipment) || {};
  const weapon = itemDef(entryName(eq.weapon));
  const plating = itemDef(entryName(eq.plating));
  const attachment = itemDef(entryName(eq.attachment));

  const mods = {
    force: 0,
    precision: 0,
    plating: 0,
    evasion: 0,
    decayPeriod: tuning.decayPeriod,
    meleeAccuracyMod: 0,
    rangedAccuracyMod: 0,
  };

  if (plating) {
    // CMB-14 (DIF-07): wear eats the plate, never the evasion penalty of wearing it.
    mods.plating += platingOf(eq.plating);
    mods.evasion -= plating.evasionPenalty || 0;
  }
  if (attachment) {
    mods.force += attachment.forceMod || 0;
    mods.precision += attachment.precisionMod || 0;
    mods.plating += attachment.platingMod || 0;
    mods.evasion += attachment.evasionMod || 0;
    if (attachment.special === 'REGULATED') mods.decayPeriod = tuning.decayPeriod + REGULATED_BONUS;
  }
  if (weapon) {
    if (weapon.category === 'melee') mods.meleeAccuracyMod = weapon.accuracyMod || 0;
    if (weapon.category === 'ranged') mods.rangedAccuracyMod = weapon.accuracyMod || 0;
  }
  return mods;
}

/** The equipped melee weapon (ITM-08: a ranged weapon in the slot leaves Tick unarmed, D-043). */
export function meleeWeapon(tick) {
  const def = itemDef(entryName(tick.equipment && tick.equipment.weapon));
  return def && def.category === 'melee' ? def : null;
}

/** The equipped ranged weapon, or null when the weapon slot holds something else (CMB-08). */
export function rangedWeapon(tick) {
  const def = itemDef(entryName(tick.equipment && tick.equipment.weapon));
  return def && def.category === 'ranged' ? def : null;
}

/** The `special` id of the fitted attachment (CAT-05), or null. */
export function attachmentSpecial(tick) {
  const def = itemDef(entryName(tick && tick.equipment && tick.equipment.attachment));
  return def ? def.special || null : null;
}

/** Is this CAT-05 attachment special currently fitted? */
export function hasAttachmentSpecial(tick, id) {
  return attachmentSpecial(tick) === id;
}

/**
 * CAT-05 **Cooling** — "Tick cannot receive Burning." `actors.js#immuneTo` asks this for Tick, the
 * one place CMB-10 checks immunity, so the Oil Reservoir covers every source at once (D-051).
 */
export function tickImmuneTo(tick, status) {
  return status === 'Burning' && hasAttachmentSpecial(tick, 'COOLING');
}

/**
 * CAT-05 **Quiet** — "Tick's plain melee noise is 2 instead of 5 (Overwind Strike stays 6)".
 * `combat.meleeAttack` asks for the radius of Tick's own melee attack; a skill that passes its own
 * `noise` option still wins, which is what keeps Overwind Strike at 6 (D-051).
 */
export function meleeNoise(tick) {
  return hasAttachmentSpecial(tick, 'QUIET') ? QUIET_MELEE_NOISE : combat.NOISE.MELEE;
}

/** CAT-05 **Quiet** — "opening a door is silent" for Tick; enemies still make CMB-11's noise 3. */
export function doorNoise(tick) {
  return hasAttachmentSpecial(tick, 'QUIET') ? SILENT : combat.NOISE.DOOR;
}

// ---------------------------------------------------------------------------------------------
// Items on the floor (ITM-04)
// ---------------------------------------------------------------------------------------------

/** The item record on a tile, or null. At most one item per tile (ITM-04). */
export function itemAt(floor, x, y) {
  for (const it of floor.items) if (it.x === x && it.y === y) return it;
  return null;
}

/** ITM-07 / ITM-11: stairs, station, chair and Escapement wheel never hold an item. */
export function isFeatureTile(floor, x, y) {
  return FEATURE_TILES.has(floor.tiles[y][x]);
}

/** ITM-04: may a free-standing item rest here? Walkable, no feature, no other item. */
export function canHoldItem(floor, x, y) {
  if (!inBounds(x, y)) return false;
  if (!walkable(floor.tiles[y][x])) return false;
  if (isFeatureTile(floor, x, y)) return false;
  return itemAt(floor, x, y) === null;
}

/**
 * Put the generator's item records on a new floor (WLD-11 step 8; `gen.js` already rolled them,
 * so they are placed verbatim) and record any `unique` among them in the run state (ITM-10):
 * `gen.js` rolls against a *copy* of `state.uniquesGenerated`, so this is where the run learns
 * which uniques exist (D-053).
 *
 * @param {object} floor the TEC-05 `state.floor` under construction
 * @param {{name: string, count?: number, x: number, y: number, source?: string}[]} records
 * @param {object} ctx the engine turn context (`{state, rng, lines, emit}`)
 */
export function placeFloorItems(floor, records, ctx) {
  const state = ctx && ctx.state;
  for (const r of records) {
    const record = { name: r.name, count: r.count === undefined ? 1 : r.count, x: r.x, y: r.y };
    if (r.wear > 0) record.wear = r.wear;
    floor.items.push(record);
    if (state && isUnique(r.name)) markUnique(state, r.name);
  }
  return floor.items;
}

/** ITM-10: remember that a unique item now exists in this run (TEC-05 `uniquesGenerated`). */
function markUnique(state, name) {
  if (!Array.isArray(state.uniquesGenerated)) state.uniquesGenerated = [];
  if (!state.uniquesGenerated.includes(name)) state.uniquesGenerated.push(name);
}

// ---------------------------------------------------------------------------------------------
// Loot tables (ITM-10)
// ---------------------------------------------------------------------------------------------

/**
 * ITM-10 — roll one item from a `(name, weight)` table.
 *
 * Two re-roll rules, in the order ITM-10 states them:
 *   * **equipment** — a weapon, plating or attachment already generated on this floor is re-rolled
 *     **once**; a second duplicate is kept. Consumables are never re-rolled. This rule is for the
 *     floor and cache tables only, so `generated` is passed only by those callers.
 *   * **unique** — an item already generated this run is re-rolled *until* it is not. The loop only
 *     runs while the table still holds an entry that is not an exhausted unique, so a table whose
 *     every entry is spent (a boss's one-line drop table) returns its roll rather than spinning
 *     (ITM-11: "a unique item is never lost").
 *
 * @param {{next: () => number}} rng the play RNG
 * @param {[string, number][]} table
 * @param {{generated?: Set<string>, uniques?: string[]}} [opts]
 * @returns {string} the item name
 */
export function rollTable(rng, table, opts = {}) {
  const generated = opts.generated || null;
  const uniques = opts.uniques || [];
  const spent = (name) => isUnique(name) && uniques.includes(name);

  let name = weighted(rng, table);
  if (generated && isEquipment(name) && generated.has(name)) name = weighted(rng, table);

  if (table.some((entry) => !spent(entry[0]))) {
    while (spent(name)) name = weighted(rng, table);
  }

  if (generated && isEquipment(name)) generated.add(name);
  return name;
}

/**
 * ITM-11 — an enemy broke: roll `d100` against its `dropChance`, roll its drop table, and place the
 * item on its tile or the nearest free tile. The `d100` is drawn on **every** break, whatever the
 * type's `dropChance`, so the play stream advances by exactly one draw per break (TEC-07).
 *
 * @param {object} enemy the broken enemy instance (`x`, `y`, `type`, `isBoss`)
 * @param {{state: object, rng: {next: () => number}, lines: object[], emit: Function}} ctx
 * @returns {{name: string, count: number, x: number, y: number}|null} the placed record, or null
 */
export function onBreak(enemy, ctx) {
  const state = ctx.state;
  const type = ENEMIES_BY_NAME[enemy.type];
  if (!type) throw new RangeError(`items: no enemy type named '${enemy.type}'`);
  const boss = enemy.isBoss === true || type.archetype === 'BOSS';

  // ITM-11: "roll d100; if <= dropChance". Bosses always drop — their dropChance is 100.
  // ENM-12 (DIF-08): an Overwound enemy's drop chance is doubled, capped at 100.
  const dropChance = enemy.elite === true ? Math.min(100, type.dropChance * 2) : type.dropChance;
  if (!chance(ctx.rng, dropChance)) return null;
  if (!type.dropTable || type.dropTable.length === 0) return null;

  const name = rollTable(ctx.rng, type.dropTable, { uniques: state.uniquesGenerated });
  // "for them the search has no distance limit (a unique item is never lost)"
  const tile = dropTile(state.floor, enemy.x, enemy.y, boss ? Infinity : DROP_SEARCH_RADIUS);
  if (!tile) return null;

  const record = { name, count: 1, x: tile.x, y: tile.y };
  state.floor.items.push(record);
  if (isUnique(name)) markUnique(state, name);
  return record;
}

/**
 * ITM-11's placement search: the enemy's own tile if it can hold an item, else the nearest free
 * walkable non-feature tile by Chebyshev distance, ties broken by reading order (TEC-08).
 *
 * @param {object} floor
 * @param {number} x
 * @param {number} y
 * @param {number} maxDistance 2 for a regular enemy; `Infinity` for a boss (ITM-11)
 * @returns {{x: number, y: number}|null}
 */
export function dropTile(floor, x, y, maxDistance = DROP_SEARCH_RADIUS) {
  if (canHoldItem(floor, x, y)) return { x, y };
  const limit = Number.isFinite(maxDistance) ? maxDistance : Math.max(floor.tiles[0].length, floor.tiles.length);
  for (let d = 1; d <= limit; d++) {
    const ring = [];
    for (let ty = y - d; ty <= y + d; ty++) {
      for (let tx = x - d; tx <= x + d; tx++) {
        if (chebyshev(x, y, tx, ty) !== d) continue;
        if (canHoldItem(floor, tx, ty)) ring.push({ x: tx, y: ty });
      }
    }
    if (ring.length > 0) return ring.sort(readingOrder)[0];
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Inventory bookkeeping (ITM-03)
// ---------------------------------------------------------------------------------------------

/** The inventory slot index holding `name`, or -1. */
export function slotOf(tick, name) {
  return tick.inventory.findIndex((s) => s.name === name);
}

/**
 * Add `count` of an item to the inventory per ITM-03 (fill a non-full stack of the same name
 * first, else take a free slot). A stack is never split across two slots (D-050).
 *
 * @returns {{ok: boolean, reason?: string, slot?: number, stacked?: boolean}}
 *          `ok:false, reason:'full'` when neither a stack nor a slot has room (ITM-03, ACC-50).
 */
export function addToInventory(tick, name, count = 1, tuning = TUNING, wear = 0) {
  if (stacks(name)) {
    for (let i = 0; i < tick.inventory.length; i++) {
      const slot = tick.inventory[i];
      if (slot.name === name && slot.count + count <= tuning.stackMax) {
        slot.count += count;
        return { ok: true, slot: i, stacked: true };
      }
    }
  }
  if (tick.inventory.length >= INVENTORY_SLOTS) return { ok: false, reason: 'full' };
  // DIF-07: equipment carries its wear into the pack; consumables have none.
  tick.inventory.push(isEquipment(name) ? { name, count, wear } : { name, count });
  return { ok: true, slot: tick.inventory.length - 1, stacked: false };
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
// The inventory actions of CMB-05 and ITM-07
// ---------------------------------------------------------------------------------------------

/**
 * ITM-06 — pick the item on Tick's tile up. Records never enter the inventory: they go to the
 * Journal and still cost the turn (ITM-03, CAT-07, SCR-04).
 *
 * @param {object} ctx the engine turn context
 * @returns {{ok: boolean, reason?: string}}
 */
export function pickUp(ctx) {
  const state = ctx.state;
  const tick = state.tick;
  const here = itemAt(state.floor, tick.x, tick.y);
  if (!here) return { ok: false, reason: 'nothingHere' };
  const def = itemDef(here.name);

  if (def.category === 'record') {
    removeFloorItem(state.floor, here);
    takeRecord(ctx, def);
    return { ok: true };
  }

  const added = addToInventory(tick, here.name, here.count, tuningOf(ctx), entryWear(here));
  if (!added.ok) {
    log.say(ctx.lines, 'inventoryFull');
    return { ok: false, reason: 'full' };
  }
  removeFloorItem(state.floor, here);

  const total = tick.inventory[added.slot].count;
  if (total === here.count && here.count === 1) {
    log.say(ctx.lines, 'pickup', { X: here.name });
  } else {
    // SCR-10 writes `{n}` twice in this template; ITM-06's example shows the two numbers differ
    // ("Tick picks up 2 Solder (now 3)."), so they are filled positionally (D-049).
    const text = log
      .template('pickupStack')
      .replace('{n}', String(here.count))
      .replace('{n}', String(total))
      .replace('{X}', here.name);
    log.push(ctx.lines, text, log.colorFor('pickupStack'));
  }
  return { ok: true };
}

/** ITM-03 / CAT-07 / SCR-04 — a record goes to the Journal screen, never to the inventory. */
function takeRecord(ctx, def) {
  const state = ctx.state;
  if (def.blueprint) {
    state.journal.blueprint = true;
    log.say(ctx.lines, 'blueprint');
  } else {
    state.journal.pages[def.journalIndex - 1] = true;
    log.say(ctx.lines, 'journalPage', { n: def.journalIndex });
  }
  // STY-05 moment 2 fires on the Blueprint; M08 owns the text box, so it hangs off a hook here.
  if (ctx.hooks && ctx.hooks.onRecordTaken) ctx.hooks.onRecordTaken(ctx, def);
}

/** Take an item record off the floor (ITM-04: one item per tile, so identity is enough). */
function removeFloorItem(floor, record) {
  const at = floor.items.indexOf(record);
  if (at >= 0) floor.items.splice(at, 1);
}

/**
 * ITM-07 / ITM-09 — use the instant consumable in `slot`. Using one that would have no effect is
 * still allowed and still consumes it (ITM-09).
 */
export function useItem(ctx, slot) {
  const tick = ctx.state.tick;
  const entry = tick.inventory[slot];
  if (!entry) return { ok: false, reason: 'noSuchSlot' };
  const def = itemDef(entry.name);
  if (def.category !== 'instant') return { ok: false, reason: 'notUsable' };

  // ITM-09 / CAT-06 (DIF-03): Solder starts a *repair*. Both of its refusals cost no turn and
  // neither consumes the item (CMB-05).
  if (def.effect === 'SOLDER') {
    const tuning = tuningOf(ctx);
    if (tick.repair) {
      log.say(ctx.lines, 'alreadySoldering');
      return { ok: false, reason: 'alreadySoldering' };
    }
    // CHR-03, read as CMB-08 reads it for the ranged weapon: a cost that would wind Tick down is
    // refused rather than paid.
    if (tick.tension <= tuning.solderTension) {
      log.say(ctx.lines, 'solderNoSpring');
      return { ok: false, reason: 'notEnoughTension' };
    }
  }

  takeFromStack(tick, slot);
  applyEffect(ctx, def.effect);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// ITM-09 / CAT-06 — the Solder repair (DIF-03)
// ---------------------------------------------------------------------------------------------

/**
 * Start a repair: pay `solderTension`, then restore `solderAmount` over `solderTurns` turns. The
 * per-turn share is the even split, and whatever the split leaves over is paid on the last turn —
 * which is how **Efficient Springs**' bonus lands (DIF-03).
 *
 * `repair.left` carries the untouched remainder, so one field does the work of an even share and a
 * remainder both (D-109).
 *
 * @returns {{turnsLeft: number, perTurn: number, left: number}|null}
 */
export function startRepair(ctx) {
  const tuning = tuningOf(ctx);
  const tick = ctx.state.tick;
  combat.spendTension(ctx, tuning.solderTension);
  if (ctx.dead) return null;
  const total = consumableAmount('SOLDER', tick, tuning);
  const turns = Math.max(1, tuning.solderTurns);
  tick.repair = { turnsLeft: turns, perTurn: Math.floor(total / turns), left: total };
  log.say(ctx.lines, 'solderStart');
  return tick.repair;
}

/**
 * CMB-02 step 3 — one turn of a running repair, applied *before* the status ticks. `turn.js` calls
 * it on the turn the Solder was used and on each of the next `solderTurns - 1` turns.
 *
 * @returns {number} the Integrity actually restored this turn
 */
export function repairTick(ctx) {
  const tick = ctx.state.tick;
  const repair = tick.repair;
  if (!repair) return 0;
  const amount = repair.turnsLeft <= 1 ? repair.left : Math.min(repair.perTurn, repair.left);
  const healed = combat.heal(ctx.state, tick, amount);
  repair.left -= amount;
  repair.turnsLeft -= 1;
  if (repair.turnsLeft <= 0 || repair.left <= 0) tick.repair = null;
  log.say(ctx.lines, 'solder', { n: tick.integrity });
  return healed;
}

/**
 * DIF-03 — "Any damage to Tick ends the repair at once (remaining healing lost)". `combat.damage`
 * calls it for a hit on Tick that dealt 1 or more; a 0-damage glance does not interrupt.
 *
 * @returns {boolean} whether a repair was running
 */
export function endRepair(ctx) {
  const tick = ctx.state.tick;
  if (!tick.repair) return false;
  tick.repair = null;
  log.say(ctx.lines, 'solderCracks');
  return true;
}

/** CAT-06's instant effects (TEC-04 ids). */
function applyEffect(ctx, effect) {
  const state = ctx.state;
  const tick = state.tick;
  const tuning = tuningOf(ctx);
  const amount = (id) => consumableAmount(id, tick, tuning);

  switch (effect) {
    case 'SOLDER':
      // DIF-03: the Solder no longer mends on the spot — it starts a three-turn repair.
      startRepair(ctx);
      return;
    case 'SPRING_KEY': {
      const before = tick.tension;
      tick.tension = Math.min(actors.TENSION_MAX, tick.tension + amount('SPRING_KEY'));
      if (tick.tension > before) log.say(ctx.lines, 'springKey', { n: tick.tension });
      else log.say(ctx.lines, 'alreadyTight');
      return;
    }
    case 'FLUX': {
      // CAT-06: "Remove all five statuses from Tick; Integrity +5."
      let cleared = 0;
      for (const name of actors.STATUSES) {
        if (!(name in tick.statuses)) continue;
        const held = tick.statuses[name] > 0;
        delete tick.statuses[name];
        if (!held) continue;
        cleared += 1;
        log.say(ctx.lines, 'statusExpired', { status: name });
      }
      const healed = combat.heal(state, tick, amount('FLUX'));
      if (healed > 0 || cleared > 0) log.say(ctx.lines, 'flux', { n: tick.integrity });
      else log.say(ctx.lines, 'nothingToMend');
      return;
    }
    default:
      throw new RangeError(`items: '${effect}' is not an instant effect id (TEC-04)`);
  }
}

/**
 * ITM-02 / ITM-07 — equip the item in `slot`. An occupied slot swaps: the old item goes into the
 * inventory slot the new item came from, so no letter moves (ACC-52).
 */
export function equip(ctx, slot) {
  const tick = ctx.state.tick;
  const entry = tick.inventory[slot];
  if (!entry) return { ok: false, reason: 'noSuchSlot' };
  const def = itemDef(entryName(entry));
  const which = SLOT_OF_CATEGORY[def.category];
  if (!which) return { ok: false, reason: 'notEquippable' };

  const previous = tick.equipment[which] || null;
  // DIF-07: the wear goes on and comes off with the item, both ways round.
  tick.equipment[which] = equipEntry(def.name, entryWear(entry));
  if (previous) tick.inventory[slot] = { name: entryName(previous), count: 1, wear: entryWear(previous) };
  else tick.inventory.splice(slot, 1);

  log.say(ctx.lines, EQUIP_LOG[which], { X: def.name });
  return { ok: true };
}

/**
 * ITM-07 — unequip into a free inventory slot. With no free slot the action is refused and costs
 * no turn. SCR-10 has no unequip line, so nothing is logged on success (D-052).
 */
export function unequip(ctx, which) {
  const tick = ctx.state.tick;
  if (!EQUIP_SLOTS.includes(which)) return { ok: false, reason: 'noSuchSlot' };
  const worn = tick.equipment[which];
  if (!worn) return { ok: false, reason: 'nothingEquipped' };
  if (tick.inventory.length >= INVENTORY_SLOTS) {
    log.say(ctx.lines, 'inventoryFull');
    return { ok: false, reason: 'full' };
  }
  tick.equipment[which] = null;
  tick.inventory.push({ name: entryName(worn), count: 1, wear: entryWear(worn) });
  return { ok: true };
}

/**
 * ITM-07 — drop the whole stack in `slot` onto Tick's tile. Refused without a turn when the tile
 * already holds an item or is a feature tile (ACC-54).
 */
export function drop(ctx, slot) {
  const state = ctx.state;
  const tick = state.tick;
  const entry = tick.inventory[slot];
  if (!entry) return { ok: false, reason: 'noSuchSlot' };
  if (itemAt(state.floor, tick.x, tick.y)) return { ok: false, reason: 'tileOccupied' };
  if (isFeatureTile(state.floor, tick.x, tick.y)) return { ok: false, reason: 'featureTile' };

  tick.inventory.splice(slot, 1);
  const dropped = { name: entry.name, count: entry.count, x: tick.x, y: tick.y };
  if (entryWear(entry) > 0) dropped.wear = entryWear(entry);
  state.floor.items.push(dropped);
  log.say(ctx.lines, 'drop', { X: entry.name });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Throwables (CAT-06, CMB-08)
// ---------------------------------------------------------------------------------------------

/**
 * CAT-06 — apply a thrown consumable's effect at its landing tile. Called by `combat.throwAt` once
 * the landing tile is known and the CMB-08 noise 3 has been emitted.
 *
 * @param {object} ctx the engine turn context
 * @param {string} name the thrown item's name
 * @param {number} x landing tile x
 * @param {number} y landing tile y
 * @param {object[]} targets every actor within the throwable's `radius` (Chebyshev), Tick
 *        included, Tick first and enemies in id order
 */
export function applyThrowEffect(ctx, name, x, y, targets) {
  const def = itemDef(name);
  switch (def.effect) {
    case 'OIL_FLASK':
      // "Every actor in the 3x3 area gets Burning 3."
      for (const actor of targets) combat.applyStatus(ctx, actor, 'Burning', 3);
      return null;
    case 'GRIT_BOMB':
      // "Every actor in the 3x3 area takes 1 damage (ignores Plating) and gets Blinded 4."
      for (const actor of targets) {
        if (!isAlive(ctx.state, actor)) continue;
        const dealt = combat.damage(ctx, actor, 1, { ignoresPlating: true, cause: name, deferDeath: true });
        log.say(ctx.lines, 'indirectDamage', { D: actors.actorLabel(ctx.state, actor), n: dealt, X: name });
        combat.applyStatus(ctx, actor, 'Blinded', 4);
        combat.checkDeath(ctx, actor, name);
        if (ctx.dead) return null;
      }
      return null;
    case 'TUNING_FORK': {
      // "The actor on the landing tile (if any) gets Stunned 2."
      const actor = combat.actorAt(ctx.state, x, y);
      if (actor) combat.applyStatus(ctx, actor, 'Stunned', 2);
      return null;
    }
    case 'CLATTER_CAN': {
      // "Noise 10 at the landing tile. Every Active enemy within 10 sets lastKnown to it."
      combat.noise(ctx, x, y, CLATTER_NOISE);
      for (const e of ctx.state.floor.enemies) {
        if (e.state !== 'ACTIVE') continue;
        if (chebyshev(e.x, e.y, x, y) > CLATTER_NOISE) continue;
        e.lastKnown = { x, y };
        e.lastKnownAge = 0;
      }
      return null;
    }
    default:
      throw new RangeError(`items: '${def.effect}' is not a throwable effect id (TEC-04)`);
  }
}

/** CAT-06: the Clatter Can's noise and the radius its `lastKnown` rule uses. */
export const CLATTER_NOISE = 10;

/** Is this actor still on the floor (a Grit Bomb may break one before the next is resolved)? */
function isAlive(state, actor) {
  if (actor === state.tick) return true;
  if (state.floor.decoy === actor) return true;
  return state.floor.enemies.includes(actor);
}

// ---------------------------------------------------------------------------------------------
// Weapon specials (CAT-01), CMB-06 step 6
// ---------------------------------------------------------------------------------------------

/**
 * CAT-01 / CAT-02 / CAT-03 — the equipped weapon's own on-hit rule, resolved at CMB-06 step 6.
 * `combat.attack` only reaches this on a hit, which is the trigger four of the five specials use;
 * `KNOCK` tests the damage after Plating as well.
 *
 * None of the five consumes an RNG draw (TEC-07): Sweep's 2 damage is flat and the other four are
 * status applications.
 *
 * @param {object} ctx the engine turn context
 * @param {'REND'|'SWEEP'|'KNOCK'|'TEMPO'|'RING'} special the id from `data/items.js` (TEC-04)
 * @param {object} attacker Tick
 * @param {object} defender the actor that was hit
 * @param {number} dealt the damage after Plating — the trigger `KNOCK` tests
 */
export function applyWeaponSpecial(ctx, special, attacker, defender, dealt) {
  const state = ctx.state;
  switch (special) {
    case 'REND':
      combat.applyStatus(ctx, defender, 'Exposed', 2);
      return null;
    case 'SWEEP': {
      // "Every other enemy adjacent to Tick takes 2 damage (Plating applies)." Resolved in id
      // order, the order CMB-03 and TEC-07 fix for anything that touches several enemies (D-054).
      const weapon = meleeWeapon(state.tick);
      const label = weapon ? weapon.name : 'Sweep';
      const victims = state.floor.enemies
        .filter((e) => e !== defender && chebyshev(e.x, e.y, attacker.x, attacker.y) <= 1)
        .sort((a, b) => a.id - b.id);
      for (const victim of victims) {
        if (!isAlive(state, victim)) continue;
        const took = combat.damage(ctx, victim, SWEEP_DAMAGE, { deferDeath: true });
        log.say(ctx.lines, 'indirectDamage', { D: actors.actorLabel(state, victim), n: took, X: label });
        combat.checkDeath(ctx, victim);
      }
      return null;
    }
    case 'KNOCK':
      if (dealt >= KNOCK_THRESHOLD) combat.knockback(ctx, defender, attacker.x, attacker.y);
      return null;
    case 'TEMPO':
      combat.applyStatus(ctx, defender, 'Slowed', 1);
      return null;
    case 'RING':
      combat.applyStatus(ctx, defender, 'Exposed', 2);
      return null;
    default:
      throw new RangeError(`items: unknown weapon special '${special}' (TEC-04)`);
  }
}

/** CAT-01: Sweep's flat damage, and the damage Knock triggers on. */
export const SWEEP_DAMAGE = 2;
export const KNOCK_THRESHOLD = 6;
