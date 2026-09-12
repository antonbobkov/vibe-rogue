// The three boss scripts of `22-bestiary.md`: the framework of BST-03 and the phase lists of
// BST-04 (The Conductor), BST-05 (The Regulator) and BST-06 (The Understudy).
//
// **This module is a contract**, like `items.js`, `ai.js` and `skills.js`. What the engine calls,
// and from where:
//
//   * `decide(enemy, state, ctx)`   — `ai.js#actionFor`'s `BOSS` case (ENM-06 BOSS).
//   * `bossSpecial(ctx, enemy, a)`  — `turn.js#executeEnemyAction`'s `special` action, through
//                                     `ctx.hooks.bossSpecial` (D-040).
//   * `onDamaged(ctx, enemy)`       — `combat.damage` through `ctx.hooks.onBossDamaged`: BST-03's
//                                     "phase transitions happen at the moment Integrity crosses
//                                     the threshold, and any log line … is printed then".
//   * `onFloorEntered(ctx)`         — `story.js` on floor entry (BST-04's entry trigger).
//   * `triggerEntry(ctx, script)`   — `story.js` for BST-05's and BST-06's entry triggers.
//
// The framework guarantees of BST-03:
//   * an **action counter** `n` per boss (`enemy.bossActions`), incremented on every action the
//     boss takes, telegraphs and Waits included; the phase lists read it *before* the increment,
//     so `n mod k == k - 1` fires on every `k`-th action;
//   * **status caps** — `actors.cappedDuration` / `BOSS_STATUS_CAPS`, applied by
//     `combat.applyStatus` (Stunned 1, Slowed 2, Exposed 2, Blinded 2; Burning uncapped);
//   * **phase transitions** at the Integrity thresholds, with their log lines and side effects;
//   * bosses are **never Dormant after their entry trigger** (`ai.track` never sleeps a boss);
//   * bosses **path and melee like any enemy** (ENM-08, CMB-06) — every fallback line below is one
//     of the ENM-06 archetype lists from `ai.js`.
//
// Every string comes from `data/script.js` (R1, D-057/D-072); nothing here touches the DOM (R2).

import { chebyshev, neighbors8, readingOrder } from './grid.js';
import { walkable } from './tiles.js';
import { createEnemy, enemyType, actorLabel, wake, dice } from './actors.js';
import { canSee } from './turn.js';
import { roll } from './rng.js';
import * as ai from './ai.js';
import * as combat from './combat.js';
import * as log from './log.js';
import { SCRIPT } from '../data/script.js';
import { FLOORS } from '../data/floors.js';

// ---------------------------------------------------------------------------------------------
// BST-04 The Conductor
// ---------------------------------------------------------------------------------------------

/** Integrity at or below which the Conductor is in Phase 2 (BST-04). */
export const CONDUCTOR_PHASE_2 = 16;
/** BST-04 Phase 1 line 2: `n mod 3 == 2` telegraphs the Downbeat. */
export const CONDUCTOR_PERIOD = 3;
/** Downbeat: two adjacent tiles, first in reading order; at most 4 summoned dancers alive. */
export const CONDUCTOR_SUMMONS = 2;
export const CONDUCTOR_SUMMON_CAP = 4;
export const CONDUCTOR_NOISE = 8;

// ---------------------------------------------------------------------------------------------
// BST-05 The Regulator
// ---------------------------------------------------------------------------------------------

export const REGULATOR_PHASE_2 = 24;
/** BST-05 Phase 2 line 2: `n mod 4 == 3` telegraphs the Vent. */
export const REGULATOR_PERIOD = 4;
export const VENT_RADIUS = 2;
export const VENT_DAMAGE = 4;
export const VENT_BURNING = 2;
export const VENT_NOISE = 6;

// ---------------------------------------------------------------------------------------------
// BST-06 The Understudy
// ---------------------------------------------------------------------------------------------

export const UNDERSTUDY_PHASE_2 = 48;
export const UNDERSTUDY_PHASE_3 = 24;
/** BST-06: `n mod 4 == 3` telegraphs Overwind (Phase 1) or Pulse (Phase 2). */
export const UNDERSTUDY_PERIOD = 4;
/** Overwind: "a melee attack rolling `2d4` twice (sum), accuracy +15". */
export const OVERWIND_DICE = '4d4';
export const OVERWIND_ACCURACY = 15;
/** Pulse: `1d6+1` ignoring Plating within Chebyshev 2, then a push. Noise 8. */
export const PULSE_RADIUS = 2;
export const PULSE_DICE = '1d6+1';
export const PULSE_NOISE = 8;
/**
 * BST-06: the Understudy's own spring starts at `tension` (250) and every action it takes costs 2,
 * so it winds itself down in 125 actions.
 *
 * That number is deliberately far longer than the fight. A geared Tick breaks 72 Integrity through
 * Plating 2 in 12-35 turns, so at the original 100 spring — 50 actions — the two clocks were the
 * same length, and every turn the player spent *not* attacking (mending, repositioning, clearing
 * the two summoned Unfinished) still advanced the kill. Walking away finished the boss, which read
 * as a bug even though it was this rule working. At 125 actions the spring is what `STY-02` always
 * meant it to be: the tower winding down while you fight, and a failsafe for a player who arrives
 * unable to out-damage it — never a faster way to win than fighting.
 */
export const SPRING_COST = 2;

/**
 * BST-06: the spring at or below which the Understudy says line 3 — "I am running down. So are you."
 * A third of 250, mirroring the Integrity threshold that says the same line (24 of 72). The line is
 * about the spring, so it should not depend on the player having done damage: a fight long enough to
 * wind it most of the way down has earned it whatever Integrity says.
 */
export const UNDERSTUDY_SPRING_LOW = 80;

/**
 * SCR-06's four Understudy lines, each delivered as **both** a text box and a log line.
 *
 * Lines 2 and 3 used to be log lines only (BST-06 said "log line 2"), which meant the boss's only
 * dialogue during the fight arrived as one row in a five-row log that combat is filling every turn:
 * players finished the fight having seen nothing but the opening and the defeat. They are text boxes
 * now. The log copy is kept for all four because UI-16 dismisses a text box on any key, and a player
 * already pressing keys in a fight will skip one without reading it — the log is where they find it
 * again, and the History screen (`m`) is where it stays.
 *
 * @param {object} ctx
 * @param {number} n which of SCR-06's four lines
 * @param {{box?: boolean}} [opts] `box: false` where the line already has one — line 4 is carried
 *        inside SCR-05's moment 3, which `story.js` shows as its own box.
 */
export function speak(ctx, n, opts = {}) {
  const text = SCRIPT.understudy[n];
  if (!text) return;
  if (opts.box !== false) ctx.emit({ type: 'textbox', id: `understudy${n}`, text });
  log.push(ctx.lines, text, log.LOG_COLORS.scripted);
}

/**
 * Line 3, said once however it is earned: BST-06 reaches it at Integrity 24, and a long fight
 * reaches it at `UNDERSTUDY_SPRING_LOW` spring. Whichever comes first speaks; the other stays quiet.
 */
function sayRunningDown(ctx, enemy) {
  if (enemy.saidRunningDown === true) return;
  enemy.saidRunningDown = true;
  speak(ctx, 3);
}

/** The `{X}` names BST-05 and BST-06 give their two area specials, for SCR-10's damage line. */
const SPECIAL_NAMES = Object.freeze({ VENT: 'Vent', PULSE: 'Pulse' });

// ---------------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------------

/** The boss script this instance runs (`data/enemies.js`'s `boss` field), or null. */
export function bossScriptOf(enemy) {
  if (!enemy || enemy.isDecoy === true || typeof enemy.type !== 'string') return null;
  const type = enemyType(enemy);
  return type.boss || null;
}

/** Is this actor one of the three bosses (BST-03)? */
export function isBoss(enemy) {
  return bossScriptOf(enemy) !== null;
}

/** The living boss running `script` on this floor, or null. */
export function bossOf(state, script) {
  if (!state.floor) return null;
  for (const e of state.floor.enemies) if (bossScriptOf(e) === script) return e;
  return null;
}

/** The `FloorDef` of the floor a boss belongs to — where its summon table lives (FLR-04, FLR-09). */
function floorDefOf(enemy) {
  const floors = enemyType(enemy).floors;
  return FLOORS[floors[0]] || null;
}

// ---------------------------------------------------------------------------------------------
// BST-03 — the action counter and the phase machine
// ---------------------------------------------------------------------------------------------

/**
 * BST-03's action counter: the number of actions this boss has already taken. The phase lists read
 * it before this action is counted, so `n mod k == k - 1` is "every k-th action".
 */
function beat(enemy) {
  const n = enemy.bossActions === undefined ? 0 : enemy.bossActions;
  enemy.bossActions = n + 1;
  return n;
}

/** The phase a boss's current Integrity puts it in (BST-04, BST-05, BST-06). */
export function phaseFor(script, integrity) {
  switch (script) {
    case 'CONDUCTOR':
      return integrity > CONDUCTOR_PHASE_2 ? 1 : 2;
    case 'REGULATOR':
      return integrity > REGULATOR_PHASE_2 ? 1 : 2;
    case 'UNDERSTUDY':
      if (integrity > UNDERSTUDY_PHASE_2) return 1;
      return integrity > UNDERSTUDY_PHASE_3 ? 2 : 3;
    default:
      return 1;
  }
}

/**
 * `ctx.hooks.onBossDamaged` — BST-03: "Phase transitions happen at the moment Integrity crosses
 * the threshold, and any log line for the transition is printed then; the new phase's script
 * applies from the boss's next action."
 *
 * A single hit that crosses two thresholds runs both transitions, in order (D-073). A hit that
 * breaks the boss runs none: it is defeated, not transitioning.
 */
export function onDamaged(ctx, enemy) {
  const script = bossScriptOf(enemy);
  if (!script) return;
  if (enemy.integrity <= 0) return;
  const target = phaseFor(script, enemy.integrity);
  while ((enemy.phase || 1) < target) enterPhase(ctx, enemy, (enemy.phase || 1) + 1);
}

/** One phase transition: its log line, its speed change, and its one-off effects. */
function enterPhase(ctx, enemy, phase) {
  enemy.phase = phase;
  const script = bossScriptOf(enemy);

  if (script === 'CONDUCTOR' && phase === 2) {
    // "on transition, log 'The Conductor's tempo doubles.' Speed becomes FAST. Script: CHASER
    // only. No more summons." A wind-up carried in is dropped with the script that used it.
    log.say(ctx.lines, 'conductorPhase2', {}, log.LOG_COLORS.scripted);
    enemy.speedOverride = 'FAST';
    enemy.windingUp = false;
    return;
  }
  if (script === 'REGULATOR' && phase === 2) {
    log.say(ctx.lines, 'regulatorPhase2', {}, log.LOG_COLORS.scripted);
    enemy.speedOverride = 'NORMAL';
    return;
  }
  if (script === 'UNDERSTUDY' && phase === 2) {
    // "on transition: log line 2 (SCR-06), then summon two The Unfinished on marker tiles 1 and 2
    // (or the nearest free tiles by Chebyshev, reading order), Active, and `n` continues."
    speak(ctx, 2);
    summonAtMarkers(ctx, enemy);
    return;
  }
  if (script === 'UNDERSTUDY' && phase === 3) {
    sayRunningDown(ctx, enemy);
    enemy.speedOverride = 'SLOW';
    enemy.windingUp = false;
    enemy.pulsingUp = false;
  }
}

// ---------------------------------------------------------------------------------------------
// Entry triggers
// ---------------------------------------------------------------------------------------------

/**
 * BST-04: "Active from the start of the floor (entry trigger = floor start)". Called on every
 * floor entry; the other two bosses keep the Dormant state their spawn record gave them until
 * their own trigger fires (BST-05 sight/noise, BST-06 the antechamber door).
 */
export function onFloorEntered(ctx) {
  const state = ctx.state;
  if (!state.floor) return;
  for (const e of state.floor.enemies) {
    if (bossScriptOf(e) !== 'CONDUCTOR') continue;
    e.state = 'ACTIVE';
    e.energy = 0;
    state.floor.bossFlags.conductorEntered = true;
  }
}

/**
 * BST-05 / BST-06's entry trigger: the boss becomes Active with `lastKnown = Tick's tile`, once.
 *
 * @returns {object|null} the boss, if this call was the trigger
 */
export function triggerEntry(ctx, script) {
  const state = ctx.state;
  if (!state.floor) return null;
  const flags = state.floor.bossFlags;
  const key = `${script.toLowerCase()}Entered`;
  if (flags[key] === true) return null;
  const boss = bossOf(state, script);
  if (!boss) return null;
  flags[key] = true;
  wake(boss, { x: state.tick.x, y: state.tick.y });
  boss.state = 'ACTIVE';
  return boss;
}

/**
 * FLR-04: "Scripted moment 1 fires the first time any interior tile of the stairs room enters
 * Tick's FOV; at that moment the Conductor counts Tick as seen." BST-04 starts its counter there.
 */
export function conductorSeesTick(ctx) {
  const state = ctx.state;
  const boss = bossOf(state, 'CONDUCTOR');
  if (!boss || boss.bossSeen === true) return null;
  boss.bossSeen = true;
  boss.bossActions = 0;
  boss.state = 'ACTIVE';
  boss.lastKnown = { x: state.tick.x, y: state.tick.y };
  boss.lastKnownAge = 0;
  return boss;
}

// ---------------------------------------------------------------------------------------------
// ENM-06 BOSS — the phase scripts
// ---------------------------------------------------------------------------------------------

/**
 * One boss action (ENM-06 BOSS). `ai.decide` has already run ENM-05 tracking, so `lastKnown` is
 * current and `ai.targetOf` gives the Decoy when SKL-03 redirects this boss.
 */
export function decide(enemy, state, ctx) {
  switch (bossScriptOf(enemy)) {
    case 'CONDUCTOR':
      return conductor(enemy, state, ctx);
    case 'REGULATOR':
      return regulator(enemy, state, ctx);
    case 'UNDERSTUDY':
      return understudy(enemy, state, ctx);
    default:
      // BST-03: a boss with no script still paths and melees like any enemy.
      return ai.chaser(enemy, state);
  }
}

/** BST-04's phase lists. */
function conductor(enemy, state, ctx) {
  const target = ai.targetOf(state, enemy);
  const sees = !!target && canSee(state, enemy, target);

  // "it does not leave its room until Tick has been seen: before first sight it Waits … Its action
  // counter `n` starts at 0 on first sight; Waits before first sight do not increment it."
  if (enemy.bossSeen !== true) {
    if (!sees) return ai.WAIT;
    conductorSeesTick(ctx);
  }

  const n = beat(enemy);
  if ((enemy.phase || 1) >= 2) return ai.chaser(enemy, state); // Phase 2: CHASER only, no summons

  if (enemy.windingUp) return { type: 'special', id: 'DOWNBEAT' };
  if (n % CONDUCTOR_PERIOD === CONDUCTOR_PERIOD - 1 && sees) {
    return { type: 'telegraph', flag: 'windingUp', message: 'conductorTelegraph' };
  }
  return ai.chaser(enemy, state);
}

/** BST-05's phase lists. Phase 1 and the fallback are the ENM-06 BRUISER list with `3d5`. */
function regulator(enemy, state, ctx) {
  const n = beat(enemy);
  if ((enemy.phase || 1) >= 2) {
    if (enemy.ventingUp) return { type: 'special', id: 'VENT' };
    if (n % REGULATOR_PERIOD === REGULATOR_PERIOD - 1) {
      // "`ventingUp = true` and `windingUp = false` … a pending heavy hit is dropped."
      enemy.windingUp = false;
      return { type: 'telegraph', flag: 'ventingUp', message: 'regulatorVentTelegraph' };
    }
  }
  return ai.bruiser(enemy, state);
}

/** BST-06's phase lists, plus its own spring. */
function understudy(enemy, state, ctx) {
  // "Every action it takes costs 2. If it reaches 0, the Understudy is defeated exactly as if
  // broken." It pays before it acts, so the action that empties the spring is never taken (D-074).
  const spring = enemy.tension === undefined ? 0 : enemy.tension;
  enemy.tension = Math.max(0, spring - SPRING_COST);
  if (enemy.tension <= 0) {
    enemy.integrity = 0;
    combat.breakActor(ctx, enemy);
    return ai.WAIT;
  }

  // "I am running down. So are you." — earned by the spring as readily as by Integrity (BST-06).
  if (enemy.tension <= UNDERSTUDY_SPRING_LOW) sayRunningDown(ctx, enemy);

  const n = beat(enemy);
  const target = ai.targetOf(state, enemy);
  const range = target ? chebyshev(enemy.x, enemy.y, target.x, target.y) : Infinity;
  const phase = enemy.phase || 1;

  if (phase >= 3) return ai.chaser(enemy, state); // Phase 3: CHASER only. No specials.

  if (phase === 2) {
    if (enemy.pulsingUp) return { type: 'special', id: 'PULSE' };
    if (n % UNDERSTUDY_PERIOD === UNDERSTUDY_PERIOD - 1 && range <= PULSE_RADIUS) {
      return { type: 'telegraph', flag: 'pulsingUp', message: 'understudyPulseTelegraph' };
    }
    // Otherwise Phase 1 lines 1-3 (BST-06).
  }

  if (enemy.windingUp) {
    enemy.windingUp = false;
    if (range === 1) return { type: 'special', id: 'OVERWIND', x: target.x, y: target.y };
    return ai.WAIT; // "If Tick not adjacent, clear and Wait."
  }
  if (range === 1 && n % UNDERSTUDY_PERIOD === UNDERSTUDY_PERIOD - 1) {
    return { type: 'telegraph', flag: 'windingUp', message: 'understudyTelegraph' };
  }
  return ai.chaser(enemy, state);
}

// ---------------------------------------------------------------------------------------------
// The special actions (`ctx.hooks.bossSpecial`)
// ---------------------------------------------------------------------------------------------

/** `turn.js`'s `{type:'special', id}` action, dispatched here through `ctx.hooks.bossSpecial`. */
export function bossSpecial(ctx, enemy, action) {
  switch (action.id) {
    case 'DOWNBEAT':
      return downbeat(ctx, enemy);
    case 'VENT':
      return vent(ctx, enemy);
    case 'PULSE':
      return pulse(ctx, enemy);
    case 'OVERWIND':
      return overwind(ctx, enemy, action);
    default:
      throw new RangeError(`bosses: unknown special '${action.id}' (BST-04..06)`);
  }
}

/**
 * BST-04 **Downbeat** — "summon Music-box Dancers on the two free tiles adjacent to the Conductor
 * that are first in reading order (fewer if fewer are free), each Active with `lastKnown` = Tick's
 * tile. Summoned dancers count toward a cap of 4 alive summoned dancers; if the cap is reached,
 * Downbeat summons nothing. Noise 8."
 */
function downbeat(ctx, enemy) {
  const state = ctx.state;
  enemy.windingUp = false;
  log.say(ctx.lines, 'conductorDownbeat', {}, log.LOG_COLORS.scripted);
  combat.noise(ctx, enemy.x, enemy.y, CONDUCTOR_NOISE);

  const def = floorDefOf(enemy);
  const boss = def ? def.boss : null;
  if (!boss || !boss.summonType) return;
  const cap = boss.summonCap === undefined ? CONDUCTOR_SUMMON_CAP : boss.summonCap;
  const room = cap - summonedAlive(state, enemy);
  if (room <= 0) return; // the cap is reached: Downbeat summons nothing

  const tiles = freeAdjacent(state, enemy).slice(0, Math.min(CONDUCTOR_SUMMONS, room));
  for (const p of tiles) summon(ctx, enemy, boss.summonType, p);
}

/**
 * BST-05 **Vent** — "every actor within Chebyshev 2 of the Regulator takes 4 damage ignoring
 * Plating and gets Burning 2. Noise 6." The Regulator itself is not one of its own victims
 * (D-075); it is immune to Burning in any case.
 */
function vent(ctx, enemy) {
  enemy.ventingUp = false;
  log.say(ctx.lines, 'regulatorVent', {}, log.LOG_COLORS.scripted);
  combat.noise(ctx, enemy.x, enemy.y, VENT_NOISE);

  for (const victim of areaVictims(ctx, enemy, VENT_RADIUS)) {
    if (!stillThere(ctx, victim)) continue;
    hurt(ctx, enemy, victim, VENT_DAMAGE, 'VENT');
    if (!stillThere(ctx, victim)) continue;
    combat.applyStatus(ctx, victim, 'Burning', VENT_BURNING);
  }
}

/**
 * BST-06 **Pulse** — "every actor within Chebyshev 2 takes `1d6+1` ignoring Plating and is knocked
 * back 1 away from the Understudy. Noise 8." One roll per actor, in the order
 * `combat.actorsWithin` gives (Tick first, then enemies by id) — the precedent is D-068.
 */
function pulse(ctx, enemy) {
  enemy.pulsingUp = false;
  log.say(ctx.lines, 'understudyPulse', {}, log.LOG_COLORS.scripted);
  combat.noise(ctx, enemy.x, enemy.y, PULSE_NOISE);

  for (const victim of areaVictims(ctx, enemy, PULSE_RADIUS)) {
    if (!stillThere(ctx, victim)) continue;
    const amount = roll(ctx.rng, dice(PULSE_DICE));
    hurt(ctx, enemy, victim, amount, 'PULSE');
    if (!stillThere(ctx, victim)) continue;
    combat.knockback(ctx, victim, enemy.x, enemy.y);
  }
}

/**
 * BST-06 **Overwind** — "melee attack rolling `2d4` twice (sum), accuracy +15. Log: 'The
 * Understudy's arm unwinds all at once.'"
 */
function overwind(ctx, enemy, action) {
  const state = ctx.state;
  log.say(ctx.lines, 'understudyOverwind', {}, log.LOG_COLORS.scripted);
  const target = combat.actorAt(state, action.x, action.y);
  if (!target) return;
  combat.attack(ctx, enemy, target, { dice: OVERWIND_DICE, accuracy: OVERWIND_ACCURACY });
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/** The actors an area special reaches: `combat.actorsWithin` minus the boss itself. */
function areaVictims(ctx, enemy, radius) {
  return combat.actorsWithin(ctx.state, enemy.x, enemy.y, radius).filter((a) => a !== enemy);
}

/** Is this victim still on the map (an earlier victim's break may have removed it)? */
function stillThere(ctx, victim) {
  const state = ctx.state;
  if (victim === state.tick) return !state.dead;
  return state.floor.enemies.includes(victim);
}

/** One area special's damage on one actor: it ignores Plating, and names the boss on Tick's death. */
function hurt(ctx, enemy, victim, amount, specialId) {
  const state = ctx.state;
  const name = enemyType(enemy).name;
  const label = { name, article: true };
  const dealt = combat.damage(ctx, victim, amount, {
    ignoresPlating: true,
    cause: name,
    causeLabel: label,
    deferDeath: true,
    wakeTo: { x: enemy.x, y: enemy.y },
  });
  log.say(
    ctx.lines,
    'indirectDamage',
    { D: actorLabel(state, victim), n: dealt, X: SPECIAL_NAMES[specialId] },
    victim === state.tick ? log.LOG_COLORS.tickHurt : log.LOG_COLORS.tickHits,
  );
  combat.checkDeath(ctx, victim, name, label);
  return dealt;
}

/** ENM-10: the walkable, unoccupied neighbours of a tile, in reading order (`neighbors8`). */
export function freeAdjacent(state, actor) {
  const tiles = state.floor.tiles;
  const out = [];
  for (const p of neighbors8(actor.x, actor.y)) {
    if (!walkable(tiles[p.y][p.x])) continue;
    if (combat.actorAt(state, p.x, p.y)) continue;
    out.push(p);
  }
  return out;
}

/** How many of this boss's summons are still alive (BST-04's cap of 4). */
function summonedAlive(state, enemy) {
  let n = 0;
  for (const e of state.floor.enemies) if (e.summonedBy === enemy.id) n += 1;
  return n;
}

/**
 * ENM-10 — put a summoned enemy on the floor. It takes a fresh `floor.nextEnemyId`, so Salvage,
 * Sympathetic Break and every other id-ordered effect sees it (SKL-03: "Summoned enemies count").
 * With `energy` 0 and no grant left in this phase it never acts on the turn it appears.
 */
export function summon(ctx, enemy, typeName, p) {
  const state = ctx.state;
  const floor = state.floor;
  const e = createEnemy(typeName, p.x, p.y, floor.nextEnemyId++, {
    state: 'ACTIVE',
    lastKnown: { x: state.tick.x, y: state.tick.y },
  });
  e.summonedBy = enemy.id;
  floor.enemies.push(e);
  return e;
}

/**
 * BST-06's Phase 2 summons: "two **The Unfinished** on marker tiles `1` and `2` (or the nearest
 * free tiles by Chebyshev, reading order)". The markers come from `gen.loadFixedFloor` (WLD-13).
 */
function summonAtMarkers(ctx, enemy) {
  const state = ctx.state;
  const def = floorDefOf(enemy);
  const boss = def ? def.boss : null;
  if (!boss || !boss.summonType) return [];
  const count = boss.summonCount === undefined ? 2 : boss.summonCount;

  const markers = state.floor.markers || [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const marker = markers[i];
    const p = marker ? nearestFree(state, marker.x, marker.y) : nearestFree(state, enemy.x, enemy.y);
    if (!p) continue;
    out.push(summon(ctx, enemy, boss.summonType, p));
  }
  return out;
}

/**
 * The nearest free tile to (x, y) by Chebyshev distance, ties by reading order — the tile itself
 * when it is free (BST-06). Searches out to the radius the chamber of FLR-09 can need.
 */
function nearestFree(state, x, y) {
  const tiles = state.floor.tiles;
  for (let r = 0; r <= 8; r++) {
    const ring = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || ny >= tiles.length || nx >= tiles[0].length) continue;
        if (!walkable(tiles[ny][nx])) continue;
        if (combat.actorAt(state, nx, ny)) continue;
        ring.push({ x: nx, y: ny });
      }
    }
    if (ring.length > 0) return ring.sort(readingOrder)[0];
  }
  return null;
}
