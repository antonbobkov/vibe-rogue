// Actors: Tick, enemy instances, and the derived stats of CMB-01 / CHR-08.
//
// TEC-05 is normative for the shapes here: everything an actor stores is JSON-serializable, and
// every *derived* value (accuracy, evasion, the Plating attribute, damage dice) is recomputed by
// `derive` / `statsOf` rather than stored. That is what lets M05 (equipment) and M07 (skills) add
// their contributions without the turn loop or the engine changing: both feed one of the two hooks
// `equipmentMods` (in `items.js`) and `skillMods` (below).
//
// Nothing here touches the DOM (PLN-02 R2).

import { parseDice } from './rng.js';
import { ENEMIES_BY_NAME } from '../data/enemies.js';
import { XP_THRESHOLDS } from '../data/skills.js';
import { equipmentMods, meleeWeapon, rangedWeapon, tickImmuneTo, BASE_DECAY_PERIOD } from './items.js';

/** CHR-01 / CHR-03: the mainspring is 100 for the whole game and nothing changes it. */
export const TENSION_MAX = 100;

/** CHR-01's starting numbers. */
export const START_INTEGRITY = 40;

/** CHR-07: level 9 is the cap; +4 Integrity per level. */
export const MAX_LEVEL = 9;
export const LEVEL_INTEGRITY = 4;

/** CMB-03's energy system. */
export const SPEED_ENERGY = Object.freeze({ SLOW: 50, NORMAL: 100, FAST: 200 });
export const ENERGY_CAP = 200;
export const ACTION_ENERGY = 100;

/** CMB-10's five statuses, in the order `22-bestiary.md` lists immunities. */
export const STATUSES = Object.freeze(['Stunned', 'Slowed', 'Burning', 'Blinded', 'Exposed']);

/** CHR-06's cumulative XP thresholds, re-exported so callers need one import (`data/skills.js`). */
export { XP_THRESHOLDS };

/** CMB-10: Burning deals 2 a turn, ignoring Plating; the Rust-moth's `burnDamage` overrides it. */
export const BURN_DAMAGE = 2;

/** BST-03: bosses cap the duration of every status but Burning. */
export const BOSS_STATUS_CAPS = Object.freeze({ Stunned: 1, Slowed: 2, Exposed: 2, Blinded: 2 });

/** Unarmed melee is `1d2` with no accuracy modifier (ITM-08). */
export const UNARMED = Object.freeze({ dice: '1d2', accuracyMod: 0 });

const diceCache = new Map();

/** Parse a dice string once per distinct string (D-014: data keeps the spec's own spelling). */
export function dice(spec) {
  if (spec && typeof spec === 'object') return spec;
  let d = diceCache.get(spec);
  if (!d) {
    d = Object.freeze(parseDice(spec));
    diceCache.set(spec, d);
  }
  return d;
}

/** The `data/enemies.js` type behind an instance. */
export function enemyType(enemy) {
  const type = ENEMIES_BY_NAME[enemy.type];
  if (!type) throw new RangeError(`actors: no enemy type named '${enemy.type}'`);
  return type;
}

/**
 * Tick's starting state (CHR-01), as the `tick` object of TEC-05.
 *
 * @param {{x?: number, y?: number}} [opts] the start tile; `engine.js` sets it on floor entry
 */
export function createTick(opts = {}) {
  return {
    integrity: START_INTEGRITY,
    integrityMax: START_INTEGRITY,
    tension: TENSION_MAX,
    xp: 0,
    level: 1,
    skillPoints: 0,
    skills: [],
    activeSlots: [],
    equipment: { weapon: 'Wrench', plating: null, attachment: null },
    inventory: [
      { name: 'Solder', count: 1 },
      { name: 'Spring-Key', count: 1 },
    ],
    statuses: {},
    guardTimer: 0,
    fieldRepairUsed: false,
    salvageCounter: 0,
    salvageNext: 'Solder',
    decayCounter: 0,
    x: opts.x === undefined ? 0 : opts.x,
    y: opts.y === undefined ? 0 : opts.y,
  };
}

/**
 * An enemy instance from a type name and a spawn record (ENM-01).
 *
 * @param {string} typeName a key of `ENEMIES_BY_NAME`
 * @param {number} x
 * @param {number} y
 * @param {number} id spawn order — CMB-03 resolves the enemy phase in ascending id
 * @param {{homeRoom?: number, isGuard?: boolean, isBoss?: boolean, state?: string,
 *          statuses?: object, ai?: Function}} [opts]
 *        `ai` is a test-only per-enemy decision function (`test/fixtures/maps.js`); `turn.js`
 *        prefers it over `ai.decide` so fixtures stay exact when M06 lands.
 */
export function createEnemy(typeName, x, y, id, opts = {}) {
  const type = ENEMIES_BY_NAME[typeName];
  if (!type) throw new RangeError(`createEnemy: no enemy type named '${typeName}'`);
  const enemy = {
    id,
    type: typeName,
    x,
    y,
    integrity: type.integrity,
    integrityMax: type.integrity,
    state: opts.state || 'DORMANT',
    lastKnown: opts.lastKnown ? { x: opts.lastKnown.x, y: opts.lastKnown.y } : null,
    lastKnownAge: 0,
    homeTile: { x, y },
    homeRoom: opts.homeRoom === undefined ? -1 : opts.homeRoom,
    windingUp: false,
    ventingUp: false,
    pulsingUp: false,
    energy: 0,
    statuses: Object.assign({}, opts.statuses),
    wokeThisTurn: false,
    isGuard: opts.isGuard === true,
    isBoss: opts.isBoss === true,
    actionCount: 0,
    phase: 1,
  };
  if (type.tension !== undefined) enemy.tension = type.tension; // BST-06's own spring (D-019)
  if (opts.ai) enemy.ai = opts.ai;
  if (opts.integrity !== undefined) enemy.integrity = opts.integrity;
  return enemy;
}

/**
 * The skill half of CHR-08. **M07 fills this in**: every passive that changes an attribute
 * (Braced Frame's Plating, Piston Drive's Force, Tuning's Precision) and the Flywheel Guard timer's
 * +3 Plating are summed here from `tick.skills` and `tick.guardTimer`.
 *
 * Until then it returns zeros, so `derive` already has its shape.
 *
 * @param {object} tick the TEC-05 `state.tick`
 * @returns {{force: number, precision: number, plating: number, evasion: number,
 *            meleeAccuracy: number, rangedAccuracy: number, rangedTension: number}}
 */
export function skillMods(tick) {
  return {
    force: 0,
    precision: 0,
    plating: 0,
    evasion: 0,
    meleeAccuracy: 0,
    rangedAccuracy: 0,
    rangedTension: 0,
  };
}

/**
 * Tick's derived stats (CMB-01, CHR-08, CHR-11). Recomputed on demand — never stored (TEC-05).
 *
 *   accuracy        80 + 5 x Precision + the melee weapon's accuracy modifier
 *   rangedAccuracy  the same base with the ranged weapon's modifier (+ skill bonuses)
 *   evasion         10 + attachment/skill modifiers - the plating item's evasion penalty
 *   plating         plating item + attachment + skills (the **Plating** attribute)
 *   force           the **Force** attribute — melee damage only (CMB-06 step 4)
 *   precision       the **Precision** attribute — +5 accuracy per point
 *   attack          the melee dice: the equipped melee weapon's, else unarmed `1d2`
 *   ranged          the equipped ranged weapon's `{dice, range, tensionCost, special}` or null
 *   decayPeriod     CHR-04's Tension decay period: 5, or 6 with the Governor (CAT-05)
 *
 * @param {object} tick the TEC-05 `state.tick`
 */
export function derive(tick) {
  const eq = equipmentMods(tick);
  const sk = skillMods(tick);

  const force = Math.max(0, eq.force + sk.force);
  const precision = Math.max(0, eq.precision + sk.precision);
  const plating = Math.max(0, eq.plating + sk.plating);
  const evasion = 10 + eq.evasion + sk.evasion;

  const melee = meleeWeapon(tick);
  const ranged = rangedWeapon(tick);
  const base = 80 + 5 * precision;

  const rangedTension = ranged
    ? Math.max(1, (ranged.tensionCost || 0) - sk.rangedTension)
    : 0;

  return {
    force,
    precision,
    plating,
    evasion,
    accuracy: base + eq.meleeAccuracyMod + sk.meleeAccuracy,
    rangedAccuracy: base + eq.rangedAccuracyMod + sk.rangedAccuracy,
    attack: dice(melee ? melee.dice : UNARMED.dice),
    weapon: melee,
    ranged: ranged
      ? {
          item: ranged,
          dice: dice(ranged.dice),
          range: ranged.range,
          tensionCost: rangedTension,
          special: ranged.special || null,
        }
      : null,
    decayPeriod: eq.decayPeriod === undefined ? BASE_DECAY_PERIOD : eq.decayPeriod,
  };
}

/** Is this actor Tick? (Identity against the state's own `tick` object — TEC-05 keeps one.) */
export function isTick(state, actor) {
  return actor === state.tick;
}

/**
 * One actor's combat-relevant numbers, whichever kind of actor it is (CMB-01, ENM-07).
 *
 * @returns {{name: string, article: boolean, accuracy: number, evasion: number, plating: number,
 *            attack: object, force: number, isTick: boolean}}
 */
export function statsOf(state, actor) {
  if (isTick(state, actor)) {
    const d = derive(actor);
    return {
      name: 'Tick',
      article: false,
      accuracy: d.accuracy,
      evasion: d.evasion,
      plating: d.plating,
      attack: d.attack,
      force: d.force,
      isTick: true,
      derived: d,
    };
  }
  if (actor.isDecoy) {
    return { name: 'decoy', article: false, accuracy: 0, evasion: 0, plating: 0, attack: dice('0 (flat)'), force: 0, isTick: false };
  }
  const type = enemyType(actor);
  return {
    name: type.name,
    article: true,
    accuracy: type.accuracy,
    evasion: type.evasion,
    plating: type.plating,
    attack: dice(type.attack),
    force: 0, // ENM-07: enemy dice already include it
    isTick: false,
    type,
  };
}

/** The actor's name as SCR-10 wants it: `{name, article}` for `log.format`. */
export function actorLabel(state, actor) {
  const s = statsOf(state, actor);
  return { name: s.name, article: s.article };
}

/**
 * CMB-01 / CMB-10: the actor's speed tier, after **Slowed** lowers it one step. A boss phase may
 * override the type's tier (`speedOverride`, BST-04/05).
 */
export function speedOf(state, actor) {
  let tier = 'NORMAL';
  if (!isTick(state, actor)) tier = actor.speedOverride || enemyType(actor).speed;
  if (actor.statuses && actor.statuses.Slowed > 0) {
    if (tier === 'FAST') tier = 'NORMAL';
    else if (tier === 'NORMAL') tier = 'SLOW';
  }
  return tier;
}

/**
 * CMB-10: an actor listed as immune never receives the status at all. Tick's only immunity comes
 * from equipment (CAT-05 **Cooling**), which `items.js` owns — this is the third equipment hook,
 * alongside `equipmentMods` and the weapon lookups (D-051).
 */
export function immuneTo(state, actor, status) {
  if (isTick(state, actor)) return tickImmuneTo(actor, status);
  if (actor.isDecoy) return true;
  const type = enemyType(actor);
  return type.immunities.includes(status);
}

/** BST-03: bosses reduce any status duration above their cap to the cap. Burning is uncapped. */
export function cappedDuration(state, actor, status, duration) {
  if (isTick(state, actor) || actor.isDecoy) return duration;
  if (!actor.isBoss && enemyType(actor).archetype !== 'BOSS') return duration;
  const cap = BOSS_STATUS_CAPS[status];
  return cap === undefined ? duration : Math.min(duration, cap);
}

/** CMB-10: Burning damage per turn — 2, or the type's `burnDamage` (Rust-moth 4, D-019). */
export function burnDamageOf(state, actor) {
  if (isTick(state, actor) || actor.isDecoy) return BURN_DAMAGE;
  const type = enemyType(actor);
  return type.burnDamage === undefined ? BURN_DAMAGE : type.burnDamage;
}

/**
 * ENM-03/ENM-04 — wake an enemy. On entering ACTIVE its energy is set to 0 and it is marked
 * `wokeThisTurn`, which costs it this turn's energy grant (CMB-03 step 1): a newly woken enemy
 * never acts on the turn it wakes.
 *
 * @param {object} enemy
 * @param {{x: number, y: number}|null} lastKnown where ENM-04 says the enemy's attention goes
 * @returns {boolean} true if this call woke it
 */
export function wake(enemy, lastKnown) {
  if (enemy.state === 'ACTIVE') {
    if (lastKnown) {
      enemy.lastKnown = { x: lastKnown.x, y: lastKnown.y };
      enemy.lastKnownAge = 0;
    }
    return false;
  }
  enemy.state = 'ACTIVE';
  enemy.energy = 0;
  enemy.wokeThisTurn = true;
  if (lastKnown) {
    enemy.lastKnown = { x: lastKnown.x, y: lastKnown.y };
    enemy.lastKnownAge = 0;
  }
  return true;
}

/** The level CHR-06's table gives for a cumulative XP total. */
export function levelForXp(xp) {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) if (xp >= XP_THRESHOLDS[i]) level = i + 1;
  return Math.min(level, MAX_LEVEL);
}
