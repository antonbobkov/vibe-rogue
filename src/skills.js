// Skills and progression: the twelve skills of `20-skills.md`, the framework of `11` (CHR-06…CHR-10)
// and the interaction notes of SKL-05.
//
// **This module is a contract**, like `items.js` and `ai.js`: the engine calls only the functions
// below, so every rule of CHR-06…CHR-10 and SKL-01…SKL-05 lives here rather than in the turn loop.
//
// What the engine calls, and from where:
//   * `passiveMods(tick)`   — `actors.js#skillMods`, the skill half of CHR-08 (Braced Frame's
//                             Plating, Piston Drive's Force, Tuning's Precision / ranged bonuses,
//                             and the Flywheel Guard timer's +3 Plating).
//   * `takeSkill(ctx, name)` — `engine.js`'s `takeSkill` action (CHR-09, a free action — D-064).
//   * `useSkill(ctx, action, visible)` — `engine.js#resolveAction`'s `skill` action (CMB-05).
//   * `onEnemyBroken(ctx, enemy)` — `combat.breakActor` through `ctx.hooks` (Salvage, Sympathetic
//                             Break; XP itself is CMB-12's own line in `combat.js`).
//   * `onTickMeleeHit(ctx, defender, result)` — `combat.meleeAttack` (Piston Drive's ≥ 6 threshold).
//   * `onEnemyPhase(ctx)`   — `turn.js#enemyPhase` through `ctx.hooks` (the Decoy's upkeep).
//   * `removeDecoy(ctx, reason)` — `combat.breakActor` when the Decoy is what broke.
//   * `activeSlotRows(tick)` — the UI-03 skill rows, including the `(used)` flag (UI-06).
//
// Nothing here touches the DOM (PLN-02 R2). `combat.js` and `actors.js` import this module, so the
// namespace imports below are ESM cycles: they resolve at call time and are only ever *read inside
// functions*, never at module-evaluation time.

import { SKILLS, SKILLS_BY_NAME, DISCIPLINES, XP_THRESHOLDS } from '../data/skills.js';
import { chebyshev, idx, inBounds } from './grid.js';
import { walkable } from './tiles.js';
import { roll } from './rng.js';
import * as log from './log.js';
import * as combat from './combat.js';
import * as items from './items.js';
import * as actors from './actors.js';

export { SKILLS, SKILLS_BY_NAME, DISCIPLINES, XP_THRESHOLDS };

/** SKL-02 **Braced Frame**: +1 Plating, +6 `integrityMax` and +6 Integrity when taken. */
export const BRACED_FRAME_PLATING = 1;
export const BRACED_FRAME_INTEGRITY = 6;

/** SKL-02 **Overwind Strike**: the dice part twice, accuracy +25, noise 6 instead of 5. */
export const OVERWIND_ACCURACY = 25;
export const OVERWIND_NOISE = 6;

/** SKL-02 **Flywheel Guard**: 4 turns of +3 Plating and Stun / knockback immunity. */
export const GUARD_TURNS = 4;
export const GUARD_PLATING = 3;

/** SKL-02 **Piston Drive**: +2 Force; a melee hit of 6+ after Plating knocks back and Stuns 1. */
export const PISTON_FORCE = 2;
export const PISTON_THRESHOLD = 6;
export const PISTON_STUN = 1;

/**
 * SKL-03 **Salvage**: every 4th break drops one of these, in this order, cycling.
 *
 * DIF-04 took Solder and Spring-Key out of it: Salvage was ~16 extra consumables a run, which is
 * most of the healing and most of the clock. It now pays in throwables, which are tactics rather
 * than resources.
 */
export const SALVAGE_PERIOD = 4;
export const SALVAGE_CYCLE = Object.freeze(['Grit Bomb', 'Oil Flask', 'Tuning Fork', 'Clatter Can']);

/** SKL-03 **Field Repair**: +12 Integrity, once per floor. */
export const FIELD_REPAIR_INTEGRITY = 12;

/** SKL-03 **Clockwork Decoy**: a 12-Integrity actor that holds enemies within 8 for 6 turns. */
export const DECOY_INTEGRITY = 12;
export const DECOY_TURNS = 6;
export const DECOY_RADIUS = 8;
export const DECOY_GLYPH = '0';
export const DECOY_COLOR = 'teal';

/** SKL-04 **Tuning**: +1 Precision, ranged shots -1 Tension (min 1) and +5 ranged accuracy. */
export const TUNING_PRECISION = 1;
export const TUNING_RANGED_TENSION = 1;
export const TUNING_RANGED_ACCURACY = 5;

/** SKL-04 **Resonant Pulse**: `1d4+2` ignoring Plating within Chebyshev 2, then a push. Noise 8. */
export const PULSE_RADIUS = 2;
export const PULSE_DICE = '1d4+2';
export const PULSE_NOISE = 8;

/** SKL-04 **Discord**: Exposed 4 and Slowed 4 on a visible enemy within 6. Noise 0. */
export const DISCORD_RANGE = 6;
export const DISCORD_DURATION = 4;

/** SKL-04 **Sympathetic Break**: 4 damage ignoring Plating within Chebyshev 3 of a break. */
export const SYMPATHETIC_RADIUS = 3;
export const SYMPATHETIC_DAMAGE = 4;

// ---------------------------------------------------------------------------------------------
// CHR-09 — the catalog, prerequisites, and taking a skill
// ---------------------------------------------------------------------------------------------

/** The `data/skills.js` entry for a name, or null when the name is not one of the twelve. */
export function skillDef(name) {
  return SKILLS_BY_NAME[name] || null;
}

/** Has Tick taken this skill? */
export function has(tick, name) {
  return !!tick && Array.isArray(tick.skills) && tick.skills.includes(name);
}

/** The four skills of one discipline, rank 1 → 4 (CHR-09). */
export function lineOf(discipline) {
  return SKILLS.filter((s) => s.discipline === discipline).sort((a, b) => a.rank - b.rank);
}

/**
 * CHR-09's prerequisite: "rank *n* of a discipline can be taken only if rank *n−1* of the same
 * discipline is already taken. Rank 1 has no prerequisite."
 *
 * @returns {string|null} the name of the skill this one needs, or null for a rank-1 skill
 */
export function prerequisiteOf(name) {
  const def = skillDef(name);
  if (!def || def.rank <= 1) return null;
  const previous = lineOf(def.discipline).find((s) => s.rank === def.rank - 1);
  return previous ? previous.name : null;
}

/**
 * May Tick take this skill right now (CHR-09)? The reasons are the ones `takeSkill` refuses with.
 *
 * @returns {{ok: boolean, reason?: string}}
 */
export function canTake(tick, name) {
  const def = skillDef(name);
  if (!def) return { ok: false, reason: 'noSuchSkill' };
  if (has(tick, name)) return { ok: false, reason: 'alreadyTaken' };
  const prerequisite = prerequisiteOf(name);
  if (prerequisite && !has(tick, prerequisite)) return { ok: false, reason: 'locked' };
  if (!(tick.skillPoints > 0)) return { ok: false, reason: 'noSkillPoints' };
  return { ok: true };
}

/** UI-15's "available" state: unlocked, untaken, and affordable. */
export function available(tick, name) {
  return canTake(tick, name).ok;
}

/** UI-15's "locked" state: the prerequisite is missing (independent of skill points). */
export function locked(tick, name) {
  const prerequisite = prerequisiteOf(name);
  return prerequisite !== null && !has(tick, prerequisite);
}

/**
 * CHR-09 — take a skill: one skill point, permanently, in acquisition order (CHR-10). A free
 * action: it costs no turn, so `engine.act` resolves it outside the CMB-02 loop (D-064).
 *
 * Braced Frame's `integrityMax` and Integrity are applied here, "immediately when taken" (SKL-02);
 * every other passive is derived (`passiveMods`).
 *
 * @param {object} ctx the engine turn context
 * @param {string} name one of the twelve skill names
 * @returns {{ok: boolean, reason?: string}}
 */
export function takeSkill(ctx, name) {
  const tick = ctx.state.tick;
  const check = canTake(tick, name);
  if (!check.ok) return check;
  const def = skillDef(name);

  tick.skillPoints -= 1;
  tick.skills.push(name);
  // CHR-10: "Active skills are bound to hotkeys 1-4 in the order they were acquired."
  if (def.type === 'A') tick.activeSlots.push(name);

  if (name === 'Braced Frame') {
    tick.integrityMax += BRACED_FRAME_INTEGRITY;
    tick.integrity = Math.min(tick.integrityMax, tick.integrity + BRACED_FRAME_INTEGRITY);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// CHR-08 — the skill half of `derive()`
// ---------------------------------------------------------------------------------------------

/**
 * Every passive attribute contribution of the twelve skills, summed for `actors.js#derive` (CHR-08,
 * recomputed on demand per CHR-08's "recomputed from their sources whenever equipment or skills
 * change").
 *
 * @param {object} tick the TEC-05 `state.tick`
 * @returns {{force: number, precision: number, plating: number, evasion: number,
 *            meleeAccuracy: number, rangedAccuracy: number, rangedTension: number}}
 */
export function passiveMods(tick) {
  const mods = {
    force: 0,
    precision: 0,
    plating: 0,
    evasion: 0,
    meleeAccuracy: 0,
    rangedAccuracy: 0,
    rangedTension: 0,
  };
  if (!tick) return mods;

  if (has(tick, 'Braced Frame')) mods.plating += BRACED_FRAME_PLATING;
  if (has(tick, 'Piston Drive')) mods.force += PISTON_FORCE;
  if (has(tick, 'Tuning')) {
    mods.precision += TUNING_PRECISION;
    mods.rangedAccuracy += TUNING_RANGED_ACCURACY;
    mods.rangedTension += TUNING_RANGED_TENSION;
  }
  // SKL-02: the Flywheel Guard's +3 Plating lasts as long as its timer (not one of the five
  // statuses, and not removable). The Stun and knockback immunities live in `combat.js`.
  if (tick.guardTimer > 0) mods.plating += GUARD_PLATING;

  return mods;
}

// ---------------------------------------------------------------------------------------------
// CHR-10 / UI-03 — the active slots
// ---------------------------------------------------------------------------------------------

/** The skill on hotkey `slot` (1-4), or null (CHR-10). */
export function skillInSlot(tick, slot) {
  if (!Number.isInteger(slot) || slot < 1) return null;
  return tick.activeSlots[slot - 1] || null;
}

/** Is this once-per-floor skill spent on this floor (SKL-03; UI-06's `(used)`)? */
export function oncePerFloorUsed(tick, name) {
  return name === 'Field Repair' && tick.fieldRepairUsed === true;
}

/**
 * UI-03 rows 18-21: the four hotkey rows, each with the skill's Tension cost and, for a
 * once-per-floor skill, whether it is already spent on this floor (UI-06).
 *
 * @returns {{slot: number, name: string, cost: number, oncePerFloor: boolean, used: boolean}[]}
 */
export function activeSlotRows(tick) {
  return tick.activeSlots.map((name, i) => {
    const def = skillDef(name);
    return {
      slot: i + 1,
      name,
      cost: def ? def.cost : 0,
      oncePerFloor: def ? def.oncePerFloor === true : false,
      used: oncePerFloorUsed(tick, name),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// CMB-05 "Use skill" — the `skill` action
// ---------------------------------------------------------------------------------------------

/**
 * CMB-05 / SKL-01 — use an active skill.
 *
 * The order of the gates is the order SKL-01 states them, and every one of them refuses without
 * spending a turn (CMB-05): the skill must be taken and active, a once-per-floor skill must not be
 * spent, the target must be valid, and Tick's Tension must be *greater* than the cost ("a skill
 * never winds Tick down").
 *
 * @param {object} ctx the engine turn context
 * @param {{slot?: number, name?: string, x?: number, y?: number, dx?: number, dy?: number}} action
 *        the PLN-03 `skill` action; `slot` is the UI-10 hotkey 1-4, and `name` names the skill
 *        directly (D-065)
 * @param {Set<number>} [visible] the tile indices of Tick's current FOV — Discord's only
 *        requirement besides range (`SKL-04`)
 * @returns {{ok: boolean, reason?: string}}
 */
export function useSkill(ctx, action, visible) {
  const state = ctx.state;
  const tick = state.tick;

  const name = action.name === undefined ? skillInSlot(tick, action.slot) : action.name;
  if (!name) return { ok: false, reason: 'noSuchSlot' };
  const def = skillDef(name);
  if (!def) return { ok: false, reason: 'noSuchSkill' };
  if (!has(tick, name)) return { ok: false, reason: 'notTaken' };
  if (def.type !== 'A') return { ok: false, reason: 'notActive' };

  // SKL-03 / ACC-39: a spent once-per-floor skill is refused before anything is paid.
  if (def.oncePerFloor && oncePerFloorUsed(tick, name)) {
    log.say(ctx.lines, 'oncePerFloorSpent', { X: name });
    return { ok: false, reason: 'spentThisFloor' };
  }

  const plan = planFor(ctx, def, action, visible);
  if (plan.ok === false) return plan;

  // SKL-01 / CMB-05: "If Tick's Tension is not greater than the cost, the action is refused and no
  // turn is spent; a skill never winds Tick down."
  if (tick.tension <= def.cost) {
    log.say(ctx.lines, 'skillUnaffordable', { X: name });
    return { ok: false, reason: 'notEnoughTension' };
  }
  combat.spendTension(ctx, def.cost);
  if (ctx.dead) return { ok: true };

  plan.run();
  return { ok: true };
}

/**
 * Validate an active skill's target (SKL-01's four targeting kinds) and return the effect as a
 * closure, so that nothing happens until the Tension is paid.
 *
 * @returns {{ok: boolean, reason?: string, run?: Function}}
 */
function planFor(ctx, def, action, visible) {
  const state = ctx.state;
  const tick = state.tick;

  switch (def.name) {
    case 'Overwind Strike': {
      // Target `direction`: one of the 8 adjacent tiles, "only valid if an enemy is there".
      const dx = action.dx;
      const dy = action.dy;
      if (!Number.isInteger(dx) || !Number.isInteger(dy)) return { ok: false, reason: 'badDirection' };
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) {
        return { ok: false, reason: 'badDirection' };
      }
      const x = tick.x + dx;
      const y = tick.y + dy;
      if (!inBounds(x, y)) return { ok: false, reason: 'offMap' };
      const target = state.floor.enemies.find((e) => e.x === x && e.y === y);
      if (!target) return { ok: false, reason: 'noTarget' };
      return { ok: true, run: () => overwindStrike(ctx, target) };
    }

    case 'Flywheel Guard':
      return { ok: true, run: () => flywheelGuard(ctx) };

    case 'Field Repair':
      return { ok: true, run: () => fieldRepair(ctx) };

    case 'Clockwork Decoy': {
      // Target `adjacent-free`: an adjacent walkable, unoccupied tile.
      const x = action.x === undefined ? tick.x + (action.dx || 0) : action.x;
      const y = action.y === undefined ? tick.y + (action.dy || 0) : action.y;
      if (!inBounds(x, y)) return { ok: false, reason: 'offMap' };
      if (chebyshev(tick.x, tick.y, x, y) !== 1) return { ok: false, reason: 'notAdjacent' };
      if (!walkable(state.floor.tiles[y][x])) return { ok: false, reason: 'blocked' };
      if (combat.actorAt(state, x, y)) return { ok: false, reason: 'occupied' };
      return { ok: true, run: () => placeDecoy(ctx, x, y) };
    }

    case 'Resonant Pulse':
      return { ok: true, run: () => resonantPulse(ctx) };

    case 'Discord': {
      // Target `tile`: "No line of fire is needed - only that the target is visible and within 6."
      const x = action.x;
      const y = action.y;
      if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(x, y)) {
        return { ok: false, reason: 'offMap' };
      }
      if (chebyshev(tick.x, tick.y, x, y) > DISCORD_RANGE) return { ok: false, reason: 'outOfRange' };
      if (visible && !visible.has(idx(x, y))) return { ok: false, reason: 'notVisible' };
      const target = state.floor.enemies.find((e) => e.x === x && e.y === y);
      if (!target) return { ok: false, reason: 'noTarget' };
      return { ok: true, run: () => discord(ctx, target) };
    }

    default:
      return { ok: false, reason: 'notActive' };
  }
}

// ---------------------------------------------------------------------------------------------
// SKL-02 Armature
// ---------------------------------------------------------------------------------------------

/**
 * SKL-02 **Overwind Strike** — a melee attack with the equipped weapon, "rolling the weapon's `NdS`
 * dice part **twice** and summing, then adding the weapon's `+M` modifier once and Force once
 * (Wrench `1d4+1` with rolls 4 and 4 → 4 + 4 + 1 = 9), and accuracy +25 … Noise 6 instead of 5".
 *
 * Doubling `n` is exactly that: `roll` sums `2n` dice and adds `mod` once, and `combat.attack` adds
 * Force once for a melee attack. The weapon's `special` applies normally because `meleeAttack`
 * supplies it (SKL-05), and the doubled roll therefore also counts toward Piston Drive's ≥ 6
 * threshold (SKL-05).
 */
function overwindStrike(ctx, target) {
  const d = actors.derive(ctx.state.tick);
  log.say(ctx.lines, 'skillUsed', { X: 'Overwind Strike' });
  return combat.meleeAttack(ctx, ctx.state.tick, target, {
    dice: { n: d.attack.n * 2, sides: d.attack.sides, mod: d.attack.mod },
    accuracy: OVERWIND_ACCURACY,
    noise: OVERWIND_NOISE,
  });
}

/**
 * SKL-02 **Flywheel Guard** — "for 4 turns … Plating +3; Tick cannot be Stunned or knocked back.
 * Reusing while active resets the timer to 4."
 *
 * The timer is set one higher than the 4 turns it grants because `turn.js` decrements it at CMB-02
 * step 3 of the same turn the skill was used in step 1 — the analogue of CMB-10's counting rule,
 * under which a duration is the number of enemy phases the effect covers (D-066).
 */
function flywheelGuard(ctx) {
  ctx.state.tick.guardTimer = GUARD_TURNS + 1;
  log.say(ctx.lines, 'flywheelStart');
}

/**
 * SKL-02 **Piston Drive** — "Whenever a melee hit by Tick deals ≥ 6 damage after Plating, the
 * target is knocked back 1 tile (`CMB-09`) and Stunned 1. The Stun applies even if the knockback
 * fails. Boss Stun caps apply (`BST-03`)."
 *
 * Called by `combat.meleeAttack` for every melee attack Tick makes, Overwind Strike included
 * (SKL-05).
 */
export function onTickMeleeHit(ctx, defender, result) {
  const state = ctx.state;
  const tick = state.tick;
  if (!has(tick, 'Piston Drive')) return;
  if (!result || result.hit !== true) return;
  if (result.dealt < PISTON_THRESHOLD) return;
  // The target may already have broken at CMB-06 step 7; there is nothing left to push or Stun.
  if (!state.floor.enemies.includes(defender)) return;

  combat.knockback(ctx, defender, tick.x, tick.y);
  combat.applyStatus(ctx, defender, 'Stunned', PISTON_STUN);
}

// ---------------------------------------------------------------------------------------------
// SKL-03 Tinkering
// ---------------------------------------------------------------------------------------------

/**
 * SKL-03 **Salvage** — "a counter `salvage` … increments each time any enemy breaks (any cause)
 * after the skill is taken. When it reaches 4 it resets to 0 and a consumable is placed on that
 * enemy's tile per `ITM-11` placement: alternately **Solder** then **Spring-Key**, starting with
 * Solder. This is in addition to the enemy's own drop. Counter persists across floors."
 *
 * The Decoy never reaches this hook (it is not an enemy, and `combat.breakActor` returns early for
 * it); summoned enemies do, because they are ordinary members of `floor.enemies`.
 */
function salvage(ctx, enemy) {
  const state = ctx.state;
  const tick = state.tick;
  if (!has(tick, 'Salvage')) return null;

  tick.salvageCounter += 1;
  if (tick.salvageCounter < SALVAGE_PERIOD) return null;
  tick.salvageCounter = 0;

  const at = SALVAGE_CYCLE.indexOf(tick.salvageNext);
  const name = at >= 0 ? SALVAGE_CYCLE[at] : SALVAGE_CYCLE[0];
  // ITM-11's placement search: the enemy's own tile, else the nearest free tile within 2.
  const tile = items.dropTile(state.floor, enemy.x, enemy.y, items.DROP_SEARCH_RADIUS);
  if (!tile) return null; // ITM-11: with nothing free within 2, no item is created

  const record = { name, count: 1, x: tile.x, y: tile.y };
  state.floor.items.push(record);
  tick.salvageNext = SALVAGE_CYCLE[(Math.max(0, at) + 1) % SALVAGE_CYCLE.length];
  log.say(ctx.lines, 'salvage', { X: name });
  return record;
}

/** SKL-03 **Field Repair** — "Integrity +12 (clamped). Usable once per floor; resets on Ascend." */
function fieldRepair(ctx) {
  const state = ctx.state;
  const tick = state.tick;
  tick.fieldRepairUsed = true;
  combat.heal(state, tick, FIELD_REPAIR_INTEGRITY);
  // SKL-05: "Field Repair can be used at full Integrity; it still costs Tension and is spent for
  // the floor", so the line is printed either way.
  log.say(ctx.lines, 'fieldRepair', { n: tick.integrity });
}

/**
 * SKL-03 **Clockwork Decoy** — "places a **Decoy** on the chosen adjacent tile … integrity 12,
 * evasion 0, plating 0, no speed (it never acts), glyph `0` in `teal`, immune to all statuses …
 * Only one Decoy exists at a time; placing a new one removes the old."
 *
 * The Decoy is not in `floor.enemies`, so it never acts, never counts as an enemy for Resonant
 * Pulse or Sympathetic Break, and `combat.breakActor` gives it no scrap, XP or noise.
 */
function placeDecoy(ctx, x, y) {
  const state = ctx.state;
  if (state.floor.decoy) removeDecoy(ctx, 'replaced');
  state.floor.decoy = {
    isDecoy: true,
    x,
    y,
    integrity: DECOY_INTEGRITY,
    integrityMax: DECOY_INTEGRITY,
    statuses: {},
    timer: DECOY_TURNS,
    lastPhaseTurn: -1,
  };
  log.say(ctx.lines, 'decoyPlaced');
  // "On placement and at the start of each enemy phase for 6 turns …"
  retargetToDecoy(state);
}

/**
 * SKL-03's retargeting rule: "every Active enemy within Chebyshev 8 of the Decoy has `lastKnown`
 * set to the Decoy's tile and treats the Decoy as its target … instead of Tick".
 *
 * `ai.targetOf` reads the `decoyed` flag this sets and applies the rule's own exception (an enemy
 * that *sees* Tick adjacent to itself still attacks Tick), so every archetype gets it at once.
 */
function retargetToDecoy(state) {
  const decoy = state.floor.decoy;
  if (!decoy) return;
  for (const e of state.floor.enemies) {
    const within = e.state === 'ACTIVE' && chebyshev(e.x, e.y, decoy.x, decoy.y) <= DECOY_RADIUS;
    e.decoyed = within;
    if (!within) continue;
    e.lastKnown = { x: decoy.x, y: decoy.y };
    e.lastKnownAge = 0;
  }
}

/**
 * The Decoy's upkeep, run at the start of every enemy phase (`turn.js`). The timer counts turns, so
 * it is decremented once per turn even when Tick is Slowed and the phase runs twice (CMB-04).
 *
 * The expiry is noticed at the *start* of the phase after the last one it held enemies for: the
 * Decoy retargets on the placement turn's phase and the five after it — six phases, "for 6 turns" —
 * and is removed at the seventh (D-067).
 */
export function onEnemyPhase(ctx) {
  const state = ctx.state;
  const decoy = state.floor ? state.floor.decoy : null;
  if (!decoy) return;
  if (decoy.timer <= 0) {
    removeDecoy(ctx, 'expired');
    return;
  }
  retargetToDecoy(state);
  if (decoy.lastPhaseTurn !== state.turn) {
    decoy.lastPhaseTurn = state.turn;
    decoy.timer -= 1;
  }
}

/**
 * Remove the Decoy (SKL-03: "After 6 turns, or when its Integrity reaches 0, the Decoy is removed
 * (no scrap, no XP, no noise)").
 *
 * @param {object} ctx
 * @param {'expired'|'broken'|'replaced'} reason `replaced` prints nothing: the new Decoy's own line
 *        follows immediately
 */
export function removeDecoy(ctx, reason) {
  const state = ctx.state;
  if (!state.floor || !state.floor.decoy) return;
  state.floor.decoy = null;
  for (const e of state.floor.enemies) e.decoyed = false;
  if (reason === 'broken') log.say(ctx.lines, 'decoyBroken');
  else if (reason === 'expired') log.say(ctx.lines, 'decoyExpires');
}

// ---------------------------------------------------------------------------------------------
// SKL-04 Resonance
// ---------------------------------------------------------------------------------------------

/**
 * SKL-04 **Resonant Pulse** — "every enemy within Chebyshev 2 of Tick takes `1d4+2` damage ignoring
 * Plating, then is knocked back 1 tile away from Tick (`CMB-09`), resolved in enemy `id` order.
 * Noise 8."
 *
 * Each enemy rolls its own `1d4`, in id order, which is the order TEC-07 fixes for anything that
 * touches several enemies (D-068). A break resolves before the next enemy is damaged, so its own
 * drop roll and Sympathetic Break chain stay in id order too.
 */
function resonantPulse(ctx) {
  const state = ctx.state;
  const tick = state.tick;
  log.say(ctx.lines, 'skillUsed', { X: 'Resonant Pulse' });
  combat.noise(ctx, tick.x, tick.y, PULSE_NOISE);

  const victims = state.floor.enemies
    .filter((e) => chebyshev(e.x, e.y, tick.x, tick.y) <= PULSE_RADIUS)
    .sort((a, b) => a.id - b.id);

  for (const victim of victims) {
    if (!state.floor.enemies.includes(victim)) continue; // a chained break already removed it
    const amount = roll(ctx.rng, actors.dice(PULSE_DICE));
    const dealt = combat.damage(ctx, victim, amount, { ignoresPlating: true, deferDeath: true });
    log.say(
      ctx.lines,
      'indirectDamage',
      { D: actors.actorLabel(state, victim), n: dealt, X: 'Resonant Pulse' },
      log.LOG_COLORS.tickHits,
    );
    if (combat.isBroken(victim)) {
      combat.breakActor(ctx, victim);
      continue;
    }
    combat.knockback(ctx, victim, tick.x, tick.y);
  }
}

/**
 * SKL-04 **Discord** — "the target enemy becomes **Exposed** 4 and **Slowed** 4 … Bosses: cap 2
 * each (`BST-03`). Noise 0."
 *
 * `combat.applyStatus` applies BST-03's caps and CMB-10's immunities, so SKL-05's Understudy note
 * ("Slowed never applies; Exposed applies with the boss cap of 2") needs no special case here.
 */
function discord(ctx, target) {
  log.say(ctx.lines, 'skillUsed', { X: 'Discord' });
  combat.applyStatus(ctx, target, 'Exposed', DISCORD_DURATION);
  combat.applyStatus(ctx, target, 'Slowed', DISCORD_DURATION);
}

/**
 * SKL-04 **Sympathetic Break** — "whenever any enemy breaks (any cause), every other enemy within
 * Chebyshev 3 of its tile takes 4 damage ignoring Plating. Enemies broken by this trigger it again
 * (resolve recursively in `id` order). The Decoy is not an enemy. Bosses take this damage normally."
 *
 * `combat.breakActor` has already removed the broken enemy from `floor.enemies`, so the victim list
 * is "every other enemy" by construction. Each victim that breaks is resolved before the next one is
 * damaged, which is what "recursively in id order" describes.
 */
function sympatheticBreak(ctx, enemy) {
  const state = ctx.state;
  if (!has(state.tick, 'Sympathetic Break')) return;

  const victims = state.floor.enemies
    .filter((e) => chebyshev(e.x, e.y, enemy.x, enemy.y) <= SYMPATHETIC_RADIUS)
    .sort((a, b) => a.id - b.id);
  if (victims.length === 0) return;

  log.say(ctx.lines, 'sympatheticBreak', {}, log.LOG_COLORS.tickHits);
  for (const victim of victims) {
    if (!state.floor.enemies.includes(victim)) continue; // broken earlier in this chain
    const dealt = combat.damage(ctx, victim, SYMPATHETIC_DAMAGE, {
      ignoresPlating: true,
      deferDeath: true,
      // ENM-04 rule 3 / D-063: the break, not Tick, is the damage source.
      wakeTo: { x: enemy.x, y: enemy.y },
    });
    log.say(
      ctx.lines,
      'indirectDamage',
      { D: actors.actorLabel(state, victim), n: dealt, X: 'Sympathetic Break' },
      log.LOG_COLORS.tickHits,
    );
    if (combat.isBroken(victim)) combat.breakActor(ctx, victim);
  }
}

// ---------------------------------------------------------------------------------------------
// The break hook (CMB-12, `combat.breakActor`)
// ---------------------------------------------------------------------------------------------

/**
 * Both passives that fire on a break, in the order SKL-05 implies: "**Sympathetic Break +
 * Salvage:** both trigger on the same break; Salvage counts chained breaks." Salvage runs first, so
 * the counter advances in the order the breaks happen (D-069).
 *
 * XP (CHR-06) is awarded by `combat.breakActor` itself, before this hook, and the level-up check of
 * CHR-07 runs at CMB-02 step 8.
 */
export function onEnemyBroken(ctx, enemy) {
  salvage(ctx, enemy);
  sympatheticBreak(ctx, enemy);
}
