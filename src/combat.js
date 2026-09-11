// Combat: hit and damage (CMB-06, CMB-07), ranged attacks and throwing (CMB-08), knockback
// (CMB-09), statuses (CMB-10), noise (CMB-11) and death (CMB-12).
//
// Every function takes the engine's turn context `ctx`:
//
//   ctx.state    the TEC-05 state
//   ctx.rng      the play RNG — every draw here is in the order TEC-07 fixes (hit roll, then
//                damage roll; enemies resolved in id order)
//   ctx.lines    the log line array for this action (`state.log`)
//   ctx.emit(e)  push a PLN-03 event
//   ctx.hooks    optional milestone hooks: `onEnemyBroken` (Salvage / Sympathetic Break),
//                `bossSpecial` (M08). Absent hooks are simply not called.
//
// Nothing here touches the DOM (PLN-02 R2).

import { idx, chebyshev, bresenham, inBounds } from './grid.js';
import { walkable, isHazardTile, HAZARDS } from './tiles.js';
import { roll, int, chance } from './rng.js';
import * as log from './log.js';
import * as items from './items.js';
import * as skills from './skills.js';
import { tuningOf } from './items.js';
import {
  statsOf,
  actorLabel,
  isTick,
  enemyType,
  wake,
  immuneTo,
  cappedDuration,
  dice,
  TENSION_MAX,
} from './actors.js';

/** CMB-11's standard noise radii. */
export const NOISE = Object.freeze({
  MELEE: 5,
  SHOT: 4,
  THROW: 3,
  DOOR: 3,
  BREAK: 6,
  GRINDING_GEAR: 6,
});

/** CMB-06 step 3: the hit chance is clamped to this band whatever the numbers say. */
export const HIT_MIN = 15;
export const HIT_MAX = 95;

/** CMB-10: Blinded costs 30 accuracy, applied after everything else and before the clamp. */
export const BLIND_PENALTY = 30;

// ---------------------------------------------------------------------------------------------
// Actors on tiles
// ---------------------------------------------------------------------------------------------

/** The living actor on a tile: Tick, an enemy, or the Decoy (M07). */
export function actorAt(state, x, y) {
  if (state.tick.x === x && state.tick.y === y) return state.tick;
  for (const e of state.floor.enemies) if (e.x === x && e.y === y) return e;
  const decoy = state.floor.decoy;
  if (decoy && decoy.x === x && decoy.y === y) return decoy;
  return null;
}

/** Every actor within Chebyshev `radius` of a tile: Tick first, then enemies in id order. */
export function actorsWithin(state, x, y, radius) {
  const out = [];
  if (chebyshev(state.tick.x, state.tick.y, x, y) <= radius) out.push(state.tick);
  for (const e of state.floor.enemies) if (chebyshev(e.x, e.y, x, y) <= radius) out.push(e);
  return out;
}

// ---------------------------------------------------------------------------------------------
// CMB-11 Noise
// ---------------------------------------------------------------------------------------------

/**
 * Emit noise of radius `r` at (x, y). Every Dormant enemy within Chebyshev `r` wakes, walls
 * notwithstanding, with `lastKnown` set to the noise tile (ENM-04). Active enemies are unaffected
 * here; ENM-05's `perception + 3` refresh is the AI's business and reads `state.floor.noises`.
 */
export function noise(ctx, x, y, r) {
  if (!(r > 0)) return;
  const state = ctx.state;
  state.floor.noises.push({ x, y, r });
  for (const e of state.floor.enemies) {
    if (e.state !== 'DORMANT') continue;
    if (chebyshev(e.x, e.y, x, y) <= r) wake(e, { x, y });
  }
}

// ---------------------------------------------------------------------------------------------
// CMB-10 Statuses
// ---------------------------------------------------------------------------------------------

/**
 * Apply a status for `duration` turns (CMB-10). Reapplication is `max(remaining, new)`, never
 * additive; immune actors never receive it; bosses cap every status but Burning (BST-03).
 *
 * @returns {boolean} whether the status is now on the target
 */
export function applyStatus(ctx, target, name, duration, opts = {}) {
  const state = ctx.state;
  if (duration <= 0) return false;
  if (immuneTo(state, target, name)) return false;
  // SKL-02: the Flywheel Guard makes Tick immune to Stun (and to knockback) while it runs.
  if (name === 'Stunned' && isTick(state, target) && target.guardTimer > 0) return false;

  const capped = cappedDuration(state, target, name, duration);
  const remaining = target.statuses[name] || 0;
  const next = Math.max(remaining, capped);
  if (next === remaining && remaining > 0) return true; // already at least this long — no new line
  target.statuses[name] = next;

  // CMB-10: a Stun clears whatever the actor was winding up.
  if (name === 'Stunned' && !isTick(state, target)) {
    target.windingUp = false;
    target.ventingUp = false;
    target.pulsingUp = false;
  }
  if (opts.silent !== true) {
    log.say(ctx.lines, 'statusApplied', { D: actorLabel(state, target), status: name }, colorFor(state, target));
  }
  return true;
}

/** UI-04: lines about damage to Tick are red; everything Tick does to an enemy is silver. */
function colorFor(state, target) {
  return isTick(state, target) ? log.LOG_COLORS.tickHurt : log.LOG_COLORS.tickHits;
}

// ---------------------------------------------------------------------------------------------
// CMB-06 / CMB-07 Damage
// ---------------------------------------------------------------------------------------------

/**
 * Deal `amount` damage to an actor (CMB-07). Plating is subtracted unless the source ignores it or
 * the target is **Exposed**; the result is clamped at 0 and never negative.
 *
 * @param {object} ctx
 * @param {object} target
 * @param {number} amount raw damage before Plating
 * @param {{ignoresPlating?: boolean, cause?: string, causeLabel?: object, deferDeath?: boolean,
 *          flash?: boolean}} [opts]
 *        `cause` is what CMB-12 names in Tick's death line (an enemy, a hazard, or "Burning").
 * @returns {number} the damage actually dealt
 */
export function damage(ctx, target, amount, opts = {}) {
  const state = ctx.state;
  const stats = statsOf(state, target);
  const exposed = (target.statuses && target.statuses.Exposed > 0) || false;
  const plating = opts.ignoresPlating || exposed ? 0 : stats.plating;
  const dealt = Math.max(0, amount - plating);

  if (dealt > 0) {
    target.integrity -= dealt;
    if (isTick(state, target)) {
      if (target.integrity < 0) target.integrity = 0;
      ctx.emit({ type: 'flash', kind: 'tick', x: target.x, y: target.y });
      // DIF-03: "Any damage to Tick ends the repair at once." A 0-damage glance never reaches
      // here, which is the rule's other half.
      items.endRepair(ctx);
    } else {
      ctx.emit({ type: 'flash', kind: 'enemy', x: target.x, y: target.y });
      // ENM-04 rule 3: any damage wakes a Dormant enemy. `lastKnown` is Tick's tile when Tick is
      // within 10, otherwise the damage source tile — callers that have a source other than Tick
      // (a hazard, a chained break) pass it as `wakeTo`; with none named, Tick's tile stands
      // (D-063). The Decoy has no AI state to wake (SKL-03).
      if (target.isDecoy !== true) {
        const tickTile = { x: state.tick.x, y: state.tick.y };
        const tickNear = chebyshev(target.x, target.y, state.tick.x, state.tick.y) <= 10;
        wake(target, tickNear || !opts.wakeTo ? tickTile : opts.wakeTo);
      }
      // BST-03: "Phase transitions happen at the moment Integrity crosses the threshold, and any
      // log line for the transition is printed then." `bosses.js` owns the phase machine (D-073).
      if (ctx.hooks && ctx.hooks.onBossDamaged) ctx.hooks.onBossDamaged(ctx, target);
    }
  }
  if (opts.deferDeath !== true) checkDeath(ctx, target, opts.cause, opts.causeLabel);
  return dealt;
}

/** Restore Integrity, clamped to `integrityMax` (CHR-02). */
export function heal(state, target, amount) {
  const before = target.integrity;
  target.integrity = Math.min(target.integrityMax, target.integrity + amount);
  return target.integrity - before;
}

// ---------------------------------------------------------------------------------------------
// CMB-12 Death
// ---------------------------------------------------------------------------------------------

/** Is this actor broken (CMB-12)? */
export function isBroken(actor) {
  return actor.integrity <= 0;
}

/**
 * Check CMB-12 for one actor and resolve it if it is broken. Tick's death ends the run and stops
 * the turn loop (`ctx.dead`); an enemy breaks through `breakActor`.
 */
export function checkDeath(ctx, target, cause, causeLabel) {
  if (!isBroken(target)) return false;
  if (isTick(ctx.state, target)) {
    killTick(ctx, cause || 'damage', causeLabel);
    return true;
  }
  breakActor(ctx, target);
  return true;
}

/**
 * CMB-12 — an enemy breaks: it is removed, leaves scrap (WLD-04), awards XP (CHR-06), rolls its
 * drop (ITM-11, `items.onBreak`) and emits noise 6.
 */
export function breakActor(ctx, enemy) {
  const state = ctx.state;
  // SKL-03: the Decoy is not an enemy. At 0 Integrity it is simply removed — "no scrap, no XP, no
  // noise" — and it has no drop table to roll.
  if (enemy.isDecoy === true) {
    skills.removeDecoy(ctx, 'broken');
    return;
  }
  const list = state.floor.enemies;
  const at = list.indexOf(enemy);
  if (at < 0) return; // already resolved this pass
  const type = enemyType(enemy);

  list.splice(at, 1);
  enemy.broken = true;
  log.say(ctx.lines, 'enemyBroken', { D: actorLabel(state, enemy) }, log.LOG_COLORS.tickHits);

  state.floor.scrap.push({ x: enemy.x, y: enemy.y, color: type.color });
  // ENM-12 (DIF-08): an Overwound enemy is worth `eliteXpMult` times the XP.
  state.tick.xp += enemy.elite === true ? type.xp * tuningOf(ctx).eliteXpMult : type.xp;
  state.stats.enemiesBroken += 1;

  // DIF-11: "When broken it drops the stolen item (ITM-11 placement, unlimited search — never
  // lost)", before its own drop table is rolled so the two never fight over the same tile.
  if (enemy.stolen) {
    const tile = items.dropTile(state.floor, enemy.x, enemy.y, Infinity);
    if (tile) {
      state.floor.items.push({ name: enemy.stolen, count: 1, x: tile.x, y: tile.y });
      log.say(ctx.lines, 'magpieDrops', { X: enemy.stolen });
    }
    enemy.stolen = null;
  }

  items.onBreak(enemy, ctx);
  if (ctx.hooks && ctx.hooks.onEnemyBroken) ctx.hooks.onEnemyBroken(ctx, enemy);
  noise(ctx, enemy.x, enemy.y, NOISE.BREAK);
}

/** CMB-12 / SCR-08 — Tick is broken or wound down. Ends the run. */
export function killTick(ctx, cause, causeLabel) {
  const state = ctx.state;
  if (state.dead) return;
  const floorNumber = state.floorNumber;
  let key = 'deathByHazard';
  let params = { X: cause, n: floorNumber };
  if (cause === 'Tension') {
    key = 'deathByTension';
    params = { n: floorNumber };
  } else if (cause === 'Burning') {
    key = 'deathByBurning';
    params = { n: floorNumber };
  } else if (causeLabel) {
    key = 'deathByEnemy';
    params = { A: causeLabel, n: floorNumber };
  }
  log.say(ctx.lines, key, params, log.LOG_COLORS.tickHurt);
  state.dead = { cause, wound: cause === 'Tension', floor: floorNumber };
  ctx.dead = true;
}

/** CMB-12 — Tension reaching 0 winds Tick down, checked whenever Tension changes (CHR-03). */
export function spendTension(ctx, amount) {
  const tick = ctx.state.tick;
  tick.tension = Math.max(0, Math.min(TENSION_MAX, tick.tension - amount));
  if (ctx.onTensionChanged) ctx.onTensionChanged(ctx);
  if (tick.tension <= 0) killTick(ctx, 'Tension');
  return tick.tension;
}

// ---------------------------------------------------------------------------------------------
// CMB-06 Attacks
// ---------------------------------------------------------------------------------------------

/**
 * CMB-06 step 3: `clamp(A.accuracy - D.evasion, 15, 95)`, with **Blinded**'s -30 applied after
 * everything else and before the clamp (CMB-10).
 */
export function hitChance(ctx, attacker, defender, bonus = 0) {
  const state = ctx.state;
  const a = statsOf(state, attacker);
  const d = statsOf(state, defender);
  let acc = a.accuracy + bonus;
  if (attacker.statuses && attacker.statuses.Blinded > 0) acc -= BLIND_PENALTY;
  return Math.max(HIT_MIN, Math.min(HIT_MAX, acc - d.evasion));
}

/**
 * A melee attack (CMB-06). Steps 1–7 in order, with exactly two draws on a hit (the `d100` hit
 * roll, then the damage dice) and one on a miss — the order TEC-07 fixes.
 *
 * @param {object} opts
 *   `dice`        override the attacker's own dice (heavy attacks, Overwind Strike)
 *   `accuracy`    accuracy bonus (heavy +10, Overwind +25)
 *   `noise`       noise radius, default 5 (CMB-11); 0 for silent attacks
 *   `force`       add the attacker's Force (default true for melee, false for ranged)
 *   `ranged`      use the ranged log templates and skip the Force bonus
 *   `onHit`       an on-hit id (TEC-04) to resolve after damage
 *   `ignoresPlating` for attacks whose damage ignores Plating (the Cuckoo's shriek)
 * @returns {{hit: boolean, dealt: number, roll: number, chance: number}}
 */
export function attack(ctx, attacker, defender, opts = {}) {
  const state = ctx.state;
  const a = statsOf(state, attacker);
  const ranged = opts.ranged === true;

  // 1. Noise at the attacker's tile.
  const r = opts.noise === undefined ? (ranged ? NOISE.SHOT : NOISE.MELEE) : opts.noise;
  noise(ctx, attacker.x, attacker.y, r);
  // ENM-13 (DIF-10): the Cuckoo's shriek is a rally as well as a noise.
  if (ranged && !isTick(state, attacker)) rallyGuards(ctx, attacker, r);

  // 2. Wake: a Dormant defender wakes before the hit roll.
  if (!isTick(state, defender) && defender.state === 'DORMANT') {
    wake(defender, { x: attacker.x, y: attacker.y });
  }

  // 3. Hit roll.
  const chance = hitChance(ctx, attacker, defender, opts.accuracy || 0);
  const d100 = int(ctx.rng, 1, 100);
  const label = { A: actorLabel(state, attacker), D: actorLabel(state, defender) };
  const color = isTick(state, defender) ? log.LOG_COLORS.tickHurt : log.LOG_COLORS.tickHits;
  if (d100 > chance) {
    log.say(ctx.lines, ranged ? 'rangedMiss' : 'miss', label, color);
    return { hit: false, dealt: 0, roll: d100, chance };
  }

  // ENM-06 THIEF (DIF-11): a Magpie's hit takes something instead of doing something.
  const stolen = steal(ctx, attacker, defender);
  if (stolen !== null) return { hit: true, dealt: 0, roll: d100, chance, stolen };

  // 4. Damage.
  const attackDice = opts.dice ? dice(opts.dice) : a.attack;
  let raw = roll(ctx.rng, attackDice);
  if (!ranged && opts.force !== false) raw += a.force;
  if (opts.damageBonus) raw += opts.damageBonus;
  // ENM-12 (DIF-08): "every attack (melee, heavy, ranged) +eliteDamageBonus flat".
  if (attacker.elite === true) raw += tuningOf(ctx).eliteDamageBonus;

  // 5. Apply.
  const dealt = damage(ctx, defender, raw, {
    ignoresPlating: opts.ignoresPlating === true,
    cause: isTick(state, attacker) ? undefined : statsOf(state, attacker).name,
    causeLabel: isTick(state, attacker) ? undefined : label.A,
    deferDeath: true,
  });
  if (dealt > 0) {
    log.say(ctx.lines, ranged ? 'rangedHit' : 'hit', Object.assign({ n: dealt }, label), color);
  } else {
    log.say(ctx.lines, 'glance', label, color);
  }

  // CMB-14 (DIF-07): the Rust-moth pits Tick's plating on any hit that lands, whatever the
  // damage after Plating was.
  corrode(ctx, attacker, defender);

  // 6. On-hit effects (the weapon's or the enemy type's; TEC-04 ids).
  const onHit = opts.onHit === undefined ? null : opts.onHit;
  if (onHit) applyOnHit(ctx, onHit, defender, dealt);
  // The equipped weapon's own special (`REND`, `SWEEP`, `KNOCK`, `TEMPO`, `RING`) is M05's, and
  // lives in `items.js` so M05 needs no edit here (PLN-06 M05 task 3).
  if (opts.special) items.applyWeaponSpecial(ctx, opts.special, attacker, defender, dealt);

  // 7. Death check.
  checkDeath(ctx, defender, isTick(state, attacker) ? undefined : a.name, label.A);
  return { hit: true, dealt, roll: d100, chance };
}

/**
 * CMB-14 (DIF-07) — corrosion. "When a Rust-moth's melee **hits** Tick (hit roll succeeds,
 * regardless of damage after Plating) and Tick has plating equipped, roll `d100`; if
 * `<= corrosionChance`, the equipped plating item gains 1 **wear**." An Overwound moth corrodes on
 * `eliteCorrosionChance` instead (ENM-12).
 *
 * The `d100` is only drawn when there is a plate to pit, which is how the rule is written.
 *
 * @returns {boolean} whether the plate took a point of wear
 */
export function corrode(ctx, attacker, defender) {
  const state = ctx.state;
  if (!isTick(state, defender)) return false;
  if (isTick(state, attacker) || attacker.isDecoy === true) return false;
  if (enemyType(attacker).corrodes !== true) return false;
  const worn = state.tick.equipment.plating;
  if (!worn) return false;

  const tuning = tuningOf(ctx);
  const percent = attacker.elite === true ? tuning.eliteCorrosionChance : tuning.corrosionChance;
  if (!chance(ctx.rng, percent)) return false;

  const name = items.entryName(worn);
  state.tick.equipment.plating = items.equipEntry(name, items.entryWear(worn) + 1);
  log.say(ctx.lines, 'corrode', { X: name }, log.LOG_COLORS.tickHurt);
  return true;
}

/**
 * ENM-13 (DIF-10) — the Cuckoo's rally. "A Cuckoo shriek (noise 12) makes every **GUARD** within its
 * radius behave as **CHASER** for `rallyTurns` turns, then RETURNING."
 *
 * A rallied guard is woken as well: a shriek it cannot hear is not a shriek (CMB-11's noise has
 * already woken the Dormant ones inside the radius).
 *
 * @returns {number} how many guards left their doors
 */
export function rallyGuards(ctx, source, radius) {
  const state = ctx.state;
  if (!(radius > 0)) return 0;
  if (enemyType(source).rallies !== true) return 0;
  const tuning = tuningOf(ctx);
  let count = 0;
  for (const e of state.floor.enemies) {
    if (e === source) continue;
    if (chebyshev(e.x, e.y, source.x, source.y) > radius) continue;
    if (e.isBoss === true) continue;
    if (!(e.isGuard === true || enemyType(e).archetype === 'GUARD')) continue;
    e.ralliedUntil = state.turn + tuning.rallyTurns;
    if (e.state !== 'ACTIVE') wake(e, { x: state.tick.x, y: state.tick.y });
    count += 1;
  }
  if (count > 0) log.say(ctx.lines, 'guardsRally', {}, log.LOG_COLORS.scripted);
  return count;
}

/**
 * ENM-06 THIEF (DIF-11) — the Magpie's theft, resolved in place of CMB-06's damage roll. "One unit
 * from a random consumable stack in Tick's inventory (play RNG, uniform over stacks); if Tick
 * carries no consumables, the hit deals `1d2` as normal." The thief then flees and never attacks
 * again; what it took comes back when it breaks (`breakActor`).
 *
 * @returns {string|null} the item taken, or null when this hit is an ordinary one
 */
export function steal(ctx, attacker, defender) {
  const state = ctx.state;
  if (isTick(state, attacker) || attacker.isDecoy === true) return null;
  if (!isTick(state, defender)) return null;
  if (attacker.fleeing === true) return null;
  if (enemyType(attacker).archetype !== 'THIEF') return null;

  const slots = [];
  state.tick.inventory.forEach((entry, slot) => {
    if (entry && items.stacks(entry.name)) slots.push(slot);
  });
  if (slots.length === 0) return null;

  const slot = slots[int(ctx.rng, 0, slots.length - 1)];
  const name = items.takeFromStack(state.tick, slot);
  attacker.stolen = name;
  attacker.fleeing = true;
  state.stats.itemsStolen = (state.stats.itemsStolen || 0) + 1;
  log.say(ctx.lines, 'magpieSteals', { X: name }, log.LOG_COLORS.tickHurt);
  return name;
}

/** TEC-04's enemy on-hit ids. Weapon specials are M05's. */
export function applyOnHit(ctx, id, defender, dealt) {
  switch (id) {
    case 'BURN_2':
      // BST-02: the Stoker's Burning applies only on a hit that dealt >= 1 after Plating.
      if (dealt >= 1) applyStatus(ctx, defender, 'Burning', 2);
      return;
    case 'EXPOSE_2':
      applyStatus(ctx, defender, 'Exposed', 2);
      return;
    default:
      throw new RangeError(`combat: unknown on-hit id '${id}' (TEC-04)`);
  }
}

/** Tick's melee attack with the equipped weapon (CMB-05's Move-into-enemy, ITM-08). */
export function meleeAttack(ctx, attacker, defender, opts = {}) {
  const state = ctx.state;
  if (isTick(state, attacker)) {
    const d = statsOf(state, attacker).derived;
    // CAT-05 QUIET: the Sounding Plate makes Tick's *plain* melee noise 2. A skill that passes its
    // own `noise` (Overwind Strike's 6) still wins, because `opts` is assigned last (D-051).
    const result = attack(
      ctx,
      attacker,
      defender,
      Object.assign(
        {
          dice: d.attack,
          special: d.weapon ? d.weapon.special || null : null,
          noise: items.meleeNoise(attacker),
        },
        opts,
      ),
    );
    // SKL-02 **Piston Drive**: every melee hit by Tick, Overwind Strike's included (SKL-05), is
    // tested against its >= 6 threshold. `skills.js` owns the rule.
    skills.onTickMeleeHit(ctx, defender, result);
    return result;
  }
  const type = enemyType(attacker);
  return attack(ctx, attacker, defender, Object.assign({ onHit: type.onHit || null }, opts));
}

/**
 * An enemy's ranged attack (ENM-07): the type's `ranged` block, its own noise, no Force.
 */
export function rangedAttack(ctx, attacker, defender, opts = {}) {
  const state = ctx.state;
  if (isTick(state, attacker)) {
    const d = statsOf(state, attacker).derived;
    if (!d.ranged) throw new Error('rangedAttack: Tick has no ranged weapon equipped');
    return attack(
      ctx,
      attacker,
      defender,
      Object.assign(
        {
          ranged: true,
          dice: d.ranged.dice,
          accuracy: d.rangedAccuracy - d.accuracy,
          noise: NOISE.SHOT,
          special: d.ranged.special,
        },
        opts,
      ),
    );
  }
  const type = enemyType(attacker);
  const r = type.ranged;
  if (!r) throw new Error(`rangedAttack: ${type.name} has no ranged attack`);
  return attack(
    ctx,
    attacker,
    defender,
    Object.assign(
      {
        ranged: true,
        dice: r.dice,
        noise: r.noise === undefined ? NOISE.SHOT : r.noise,
        ignoresPlating: r.ignoresPlating === true,
        onHit: r.onHit || null,
      },
      opts,
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// CMB-08 Line of fire
// ---------------------------------------------------------------------------------------------

/**
 * Walk the Bresenham line of TEC-08 from (x0, y0) to (x1, y1). The projectile stops at the first
 * tile that is not walkable or holds an actor (CMB-08).
 *
 * @returns {{tile: {x, y}, actor: object|null, blocked: boolean, landing: {x, y}}}
 *   `tile`    where the projectile stopped (the blocking tile itself when `blocked`)
 *   `actor`   the actor it stopped on, if any
 *   `landing` where a throwable comes to rest: the actor's tile, or the last passable tile before
 *             an obstacle (D-045)
 */
export function projectile(state, x0, y0, x1, y1) {
  const path = bresenham(x0, y0, x1, y1);
  let last = { x: x0, y: y0 };
  for (const p of path) {
    if (!inBounds(p.x, p.y) || !walkable(state.floor.tiles[p.y][p.x])) {
      return { tile: p, actor: null, blocked: true, landing: last };
    }
    const a = actorAt(state, p.x, p.y);
    if (a && !(p.x === x0 && p.y === y0)) {
      return { tile: p, actor: a, blocked: false, landing: p };
    }
    last = p;
  }
  return { tile: last, actor: null, blocked: false, landing: last };
}

/**
 * CMB-08 — throw a consumable at a tile. The item has already left the inventory; this resolves
 * the flight, the landing tile, the noise 3 and the effect (`items.applyThrowEffect`, M05).
 *
 * @returns {{x: number, y: number}} the landing tile
 */
export function throwAt(ctx, name, x0, y0, x1, y1) {
  const state = ctx.state;
  const shot = projectile(state, x0, y0, x1, y1);
  const landing = shot.landing;
  const def = items.itemDef(name);
  log.say(ctx.lines, 'throw', { X: name });
  noise(ctx, landing.x, landing.y, NOISE.THROW);
  const targets = actorsWithin(state, landing.x, landing.y, def.radius || 0);
  items.applyThrowEffect(ctx, name, landing.x, landing.y, targets);
  return landing;
}

// ---------------------------------------------------------------------------------------------
// CMB-09 Knockback
// ---------------------------------------------------------------------------------------------

/**
 * Push an actor one tile directly away from (sx, sy). If the destination is not walkable or is
 * occupied the push does nothing — no damage, no bonus (CMB-09, ACC-25). Pushed actors do not
 * trigger hazard **enter** effects.
 *
 * @returns {boolean} whether the actor moved
 */
export function knockback(ctx, target, sx, sy) {
  const state = ctx.state;
  // SKL-02: the Flywheel Guard also makes Tick immune to knockback.
  if (isTick(state, target) && target.guardTimer > 0) return false;
  const dx = Math.sign(target.x - sx);
  const dy = Math.sign(target.y - sy);
  if (dx === 0 && dy === 0) return false;
  const nx = target.x + dx;
  const ny = target.y + dy;
  if (!inBounds(nx, ny)) return false;
  if (!walkable(state.floor.tiles[ny][nx])) return false;
  if (actorAt(state, nx, ny)) return false;
  target.x = nx;
  target.y = ny;
  log.say(ctx.lines, 'knockback', { D: actorLabel(state, target) }, colorFor(state, target));
  return true;
}

// ---------------------------------------------------------------------------------------------
// WLD-08 Hazards
// ---------------------------------------------------------------------------------------------

/** The hazard configuration on a tile, or null. */
export function hazardAt(state, x, y) {
  const t = state.floor.tiles[y][x];
  if (!isHazardTile(t)) return null;
  for (const kind of Object.keys(HAZARDS)) if (HAZARDS[kind].tile === t) return HAZARDS[kind];
  return null;
}

/**
 * Apply a hazard's effect to an actor standing on it (WLD-08): damage that always ignores Plating,
 * its status, and its noise.
 */
export function hazardHit(ctx, actor, cfg, turnValue) {
  const state = ctx.state;
  const label = actorLabel(state, actor);
  // WLD-08 lists ENTER and STANDING as two triggers of one effect: an actor that stepped onto an
  // active hazard this turn does not take it again at the turn's standing check (D-046).
  actor.hazardTurn = turnValue === undefined ? state.turn : turnValue;
  const dealt = damage(ctx, actor, cfg.damage, {
    ignoresPlating: true,
    cause: cfg.name,
    deferDeath: true,
    // ENM-04 rule 3: the hazard tile is the damage source, used when Tick is more than 10 away.
    wakeTo: { x: actor.x, y: actor.y },
  });
  log.say(
    ctx.lines,
    'hazard',
    { D: label, X: cfg.name, n: dealt },
    isTick(state, actor) ? log.LOG_COLORS.tickHurt : log.LOG_COLORS.tickHits,
  );
  if (cfg.noise > 0) noise(ctx, actor.x, actor.y, cfg.noise);
  if (cfg.status) applyStatus(ctx, actor, cfg.status.name, cfg.status.duration);
  checkDeath(ctx, actor, cfg.name);
  return dealt;
}

/** The tile index helper the engine and tests share. */
export { idx };
