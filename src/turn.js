// The turn loop: CMB-02 steps 1-10, the energy system and enemy phase of CMB-03, Tick's double
// enemy phase while Slowed (CMB-04), the status ticks of CMB-10, the hazard ticks of WLD-08, and
// the wake rules of ENM-03 / ENM-04.
//
// `runTurn` is written to read like CMB-02: one numbered block per step, in order, with the rule
// each block implements quoted next to it. Step 1 is delegated to `ctx.resolveAction`, which
// `engine.js` owns (the action table of CMB-05); step 6 asks `ai.decide` — or a fixture's per-enemy
// `ai` override — for each enemy action and executes it.
//
// Nothing here touches the DOM (PLN-02 R2).

import { chebyshev, idx } from './grid.js';
import { computeFov } from './fov.js';
import { TILE, blocksSight, walkable, hazardActive } from './tiles.js';
import * as log from './log.js';
import * as ai from './ai.js';
import * as combat from './combat.js';
import * as items from './items.js';
import { spawnWanderer } from './wander.js';
import {
  derive,
  actorLabel,
  isTick,
  enemyType,
  speedOf,
  burnDamageOf,
  levelForXp,
  wake,
  STATUSES,
  SPEED_ENERGY,
  ENERGY_CAP,
  ACTION_ENERGY,
  LEVEL_INTEGRITY,
  MAX_LEVEL,
} from './actors.js';

/** CHR-03: at Tension <= 30 the log warns once per floor; at <= 15 it warns every 5th turn. */
export const TENSION_WARN = 30;
export const TENSION_SLACK = 15;
export const SLACK_PERIOD = 5;

/** A pass loop that can never run away: energy caps at 200, so two actions each is the maximum. */
const MAX_PASSES = 4;

/**
 * One turn (CMB-02). Runs steps 1-10 exactly once for one turn-costing player action.
 *
 * @param {object} ctx the engine turn context (see `combat.js` for its fields) plus
 *        `resolveAction(action) -> {ok, reason?}` for step 1 and `hooks` for steps 8 and 9
 * @param {object} action a PLN-03 action
 * @returns {{ok: boolean, reason?: string}} `ok:false` means no turn was spent (CMB-05) and steps
 *          2-10 did not run
 */
export function runTurn(ctx, action) {
  const state = ctx.state;
  state.floor.noises = [];

  // ---- 1. Resolve the player's action -------------------------------------------------------
  const result = ctx.resolveAction(action) || { ok: false, reason: 'unknown' };
  if (result.ok === false) return result;
  if (ctx.dead) return result;

  advanceClock(ctx);
  if (ctx.dead) return result;

  // ---- 3. Tick's repair, then Tick's statuses (CMB-02 step 3, DIF-03) -----------------------
  items.repairTick(ctx);

  playerStatusTick(ctx);
  if (ctx.dead) return result;

  hazardStanding(ctx, state.tick);
  if (ctx.dead) return result;

  // ---- 5. Death check for Tick --------------------------------------------------------------
  if (combat.isBroken(state.tick)) {
    combat.checkDeath(ctx, state.tick, 'damage');
    return result;
  }

  // ---- 6. Enemy phase (twice while Tick is Slowed, CMB-04) ----------------------------------
  enemyPhase(ctx);
  if (!ctx.dead && state.tick.statuses.Slowed > 0) enemyPhase(ctx);
  if (ctx.dead) return result;

  enemyStatusAndHazardTick(ctx);
  if (ctx.dead) return result;

  levelUpCheck(ctx);

  // ENM-03's "woke this turn gains no energy" flag has done its work by here: it is cleared before
  // the autosave, not after, so the saved state is one a restore can resume from without charging
  // the penalty a second time (TEC-09, ACC-02, D-085).
  for (const e of state.floor.enemies) e.wokeThisTurn = false;

  // ---- 9. Autosave (TEC-09) -----------------------------------------------------------------
  if (ctx.hooks && ctx.hooks.autosave) ctx.hooks.autosave(ctx);

  // Step 10 (FOV + render) belongs to the caller: `engine.act` recomputes the view.
  return result;
}

// ---------------------------------------------------------------------------------------------
// 2. Advance the clock
// ---------------------------------------------------------------------------------------------

/**
 * CMB-02 step 2: `turn += 1; decayCounter += 1`; at `decayPeriod` Tick loses 1 Tension and the
 * counter resets (CHR-04). `decayPeriod` is derived (`items.js` REGULATED), never stored.
 */
function advanceClock(ctx) {
  const state = ctx.state;
  const tick = state.tick;
  state.turn += 1;
  state.stats.turns = state.turn;
  // WLD-14 (DIF-06): the floor's own clock, which the wanderer schedule runs on.
  state.floor.turnsHere = (state.floor.turnsHere || 0) + 1;
  tick.decayCounter += 1;
  const period = derive(tick, ctx.tuning).decayPeriod;
  if (tick.decayCounter >= period) {
    tick.decayCounter = 0;
    combat.spendTension(ctx, 1);
  }
  if (ctx.dead) return;
  // CHR-03: "At <= 15, every 5th turn the log also prints 'Tick's spring is nearly slack.'"
  if (tick.tension <= TENSION_SLACK && state.turn % SLACK_PERIOD === 0) {
    log.say(ctx.lines, 'tensionNearlySlack');
  }
  // WLD-14 (DIF-06): the wanderer schedule, drawn after the decay so the turn's order is fixed.
  spawnWanderer(ctx);
}

/**
 * CHR-03 / SCR-10: "The spring is loosening." the first time Tension reaches 30 on a floor.
 * Called by `combat.spendTension` through `ctx.onTensionChanged`, so every Tension cost — decay,
 * a skill, a shot — goes through it.
 */
export function tensionWarnings(ctx) {
  const state = ctx.state;
  if (state.tick.tension <= TENSION_WARN && state.tick.tension > 0 && !state.flags.tension30Warned) {
    state.flags.tension30Warned = true;
    log.say(ctx.lines, 'tensionLoosening');
  }
}

// ---------------------------------------------------------------------------------------------
// 3 / 7. Status ticks (CMB-10)
// ---------------------------------------------------------------------------------------------

/**
 * One actor's status tick (CMB-10): per-turn effects first (Burning), then every duration -1,
 * then removal of anything at 0. Death is left to the caller's death check (steps 5 and 7).
 */
export function statusTick(ctx, actor) {
  const state = ctx.state;
  const statuses = actor.statuses;

  if (statuses.Burning > 0) {
    const dealt = combat.damage(ctx, actor, burnDamageOf(state, actor), {
      ignoresPlating: true,
      cause: 'Burning',
      deferDeath: true,
    });
    log.say(
      ctx.lines,
      'burningTick',
      { D: actorLabel(state, actor), n: dealt },
      isTick(state, actor) ? log.LOG_COLORS.tickHurt : log.LOG_COLORS.tickHits,
    );
  }

  for (const name of STATUSES) {
    if (!(statuses[name] > 0)) continue;
    statuses[name] -= 1;
    if (statuses[name] <= 0) {
      delete statuses[name];
      // SCR-10 prints an expiry line for Tick only.
      if (isTick(state, actor)) log.say(ctx.lines, 'statusExpired', { status: name });
    }
  }

  // SKL-02's Flywheel Guard timer runs on the same clock but is not one of the five statuses.
  if (isTick(state, actor) && actor.guardTimer > 0) {
    actor.guardTimer -= 1;
    if (actor.guardTimer === 0) log.say(ctx.lines, 'flywheelEnd');
  }
}

function playerStatusTick(ctx) {
  statusTick(ctx, ctx.state.tick);
  if (!ctx.dead && combat.isBroken(ctx.state.tick)) combat.checkDeath(ctx, ctx.state.tick, 'Burning');
}

// ---------------------------------------------------------------------------------------------
// 4 / 7. Hazards (WLD-08)
// ---------------------------------------------------------------------------------------------

/**
 * WLD-08's **standing** trigger, checked at steps 4 and 7: the actor is on a hazard tile that is
 * active on the current global `turn` (the value after step 2).
 */
export function hazardStanding(ctx, actor) {
  const state = ctx.state;
  const cfg = combat.hazardAt(state, actor.x, actor.y);
  if (!cfg || !cfg.triggers.includes('STANDING')) return false;
  if (!hazardActive(cfg.kind, state.turn)) return false;
  if (actor.hazardTurn === state.turn) return false; // already caught by the ENTER trigger (D-046)
  combat.hazardHit(ctx, actor, cfg, state.turn);
  return true;
}

/**
 * WLD-08's **enter** trigger: moving onto the tile, never knockback. An enter check during step 1
 * uses the turn value the action will have after step 2 — the pre-increment `turn + 1`.
 */
export function hazardEnter(ctx, actor, turnValue) {
  const state = ctx.state;
  const cfg = combat.hazardAt(state, actor.x, actor.y);
  if (!cfg || !cfg.triggers.includes('ENTER')) return false;
  if (!hazardActive(cfg.kind, turnValue)) return false;
  combat.hazardHit(ctx, actor, cfg, turnValue);
  return true;
}

// ---------------------------------------------------------------------------------------------
// 6. The enemy phase (CMB-03)
// ---------------------------------------------------------------------------------------------

/** ENM-02: does this enemy see Tick? Its own shadowcast, its own perception, the Blinded rule. */
export function canSee(state, enemy, target) {
  const type = enemyType(enemy);
  const d = chebyshev(enemy.x, enemy.y, target.x, target.y);
  if (enemy.statuses.Blinded > 0) return d <= 1;
  if (d > type.perception) return false;
  const tiles = state.floor.tiles;
  const fov = computeFov((x, y) => blocksSight(tiles[y][x]), enemy.x, enemy.y, type.perception);
  return fov.has(idx(target.x, target.y));
}

/** Enemies in ascending `id` — the order CMB-03 and TEC-07 fix for the phase and its draws. */
function byId(enemies) {
  return enemies.slice().sort((a, b) => a.id - b.id);
}

/**
 * CMB-03's enemy phase: wake by sight, grant energy, then repeat passes in id order until a pass
 * performs no action.
 */
export function enemyPhase(ctx) {
  const state = ctx.state;
  const tick = state.tick;

  // SKL-03: the Clockwork Decoy retargets every Active enemy within 8 "at the start of each enemy
  // phase", and expires there too. `skills.js` owns the rule (M07's hook).
  if (ctx.hooks && ctx.hooks.onEnemyPhase) ctx.hooks.onEnemyPhase(ctx);

  // ENM-04 rule 1: every Dormant enemy checks its sight at the start of the phase.
  for (const e of byId(state.floor.enemies)) {
    if (e.state !== 'DORMANT') continue;
    if (canSee(state, e, tick)) wake(e, { x: tick.x, y: tick.y });
  }

  // 1. Energy. Dormant enemies gain none and keep 0; Stunned enemies are set to 0 instead of
  //    gaining; an enemy that woke this turn gains none (ENM-03).
  for (const e of state.floor.enemies) {
    if (e.state === 'DORMANT') {
      e.energy = 0;
      continue;
    }
    if (e.statuses.Stunned > 0) {
      e.energy = 0;
      continue;
    }
    if (e.wokeThisTurn) continue;
    e.energy = Math.min(ENERGY_CAP, e.energy + SPEED_ENERGY[speedOf(state, e)]);
  }

  // 2. Passes until a pass performs no action.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let acted = false;
    for (const e of byId(state.floor.enemies)) {
      if (!state.floor.enemies.includes(e)) continue; // broken mid-pass
      if (e.state === 'DORMANT') continue;
      if (e.statuses.Stunned > 0) continue;
      if (e.energy < ACTION_ENERGY) continue;
      e.energy -= ACTION_ENERGY;
      performEnemyAction(ctx, e);
      acted = true;
      if (ctx.dead) return;
    }
    if (!acted) return;
  }
  throw new Error('enemyPhase: passes did not settle (CMB-03 caps energy at 200)');
}

/**
 * Ask for one enemy decision and execute it. A fixture's per-enemy `ai` override wins over
 * `ai.decide`, so the M04 tests stay exact when M06 replaces `ai.js` (PLN-04).
 */
export function performEnemyAction(ctx, enemy) {
  const state = ctx.state;
  enemy.actionCount += 1;
  const decide = typeof enemy.ai === 'function' ? enemy.ai : ai.decide;
  const action = decide(enemy, state, ctx) || ai.WAIT;
  executeEnemyAction(ctx, enemy, action);
}

/** The enemy action schema of `ai.js`. */
export function executeEnemyAction(ctx, enemy, action) {
  const state = ctx.state;
  switch (action.type) {
    case 'wait':
      return;
    case 'move': {
      if (chebyshev(enemy.x, enemy.y, action.x, action.y) !== 1) return;
      if (!walkable(state.floor.tiles[action.y][action.x])) return;
      if (combat.actorAt(state, action.x, action.y)) return;
      enemy.x = action.x;
      enemy.y = action.y;
      hazardEnter(ctx, enemy, state.turn);
      return;
    }
    case 'melee': {
      const target = combat.actorAt(state, action.x, action.y);
      if (!target) return;
      combat.meleeAttack(ctx, enemy, target, action.opts || {});
      return;
    }
    case 'heavy': {
      const target = combat.actorAt(state, action.x, action.y);
      if (!target) return;
      const type = enemyType(enemy);
      combat.attack(ctx, enemy, target, { dice: type.heavyAttack, accuracy: 10, onHit: type.onHit || null });
      return;
    }
    case 'ranged': {
      const shot = combat.projectile(state, enemy.x, enemy.y, action.x, action.y);
      if (!shot.actor) {
        // The line is blocked: the shot still makes its noise (ENM-07) and hits nothing — and a
        // Cuckoo's shriek still rallies the guards inside it (ENM-13, DIF-10).
        const type = enemyType(enemy);
        const r = type.ranged;
        const radius = r && r.noise !== undefined ? r.noise : combat.NOISE.SHOT;
        combat.noise(ctx, enemy.x, enemy.y, radius);
        combat.rallyGuards(ctx, enemy, radius);
        return;
      }
      combat.rangedAttack(ctx, enemy, shot.actor, action.opts || {});
      return;
    }
    case 'openDoor': {
      if (state.floor.tiles[action.y][action.x] !== TILE.DOOR_CLOSED) return;
      state.floor.tiles[action.y][action.x] = TILE.DOOR_OPEN;
      combat.noise(ctx, action.x, action.y, combat.NOISE.DOOR);
      return;
    }
    case 'breakDoor': {
      const t = state.floor.tiles[action.y][action.x];
      // WLD-15 (DIF-12): a Wound Lock breaks like a door for a BREAKS enemy.
      if (t !== TILE.DOOR_CLOSED && t !== TILE.WOUND_LOCK) return;
      state.floor.tiles[action.y][action.x] = TILE.FLOOR;
      log.say(ctx.lines, 'doorBroken', { A: { name: enemyType(enemy).name, article: true } });
      combat.noise(ctx, action.x, action.y, combat.NOISE.BREAK);
      return;
    }
    case 'telegraph': {
      enemy[action.flag || 'windingUp'] = true;
      if (action.message) log.say(ctx.lines, action.message, action.params || {}, log.LOG_COLORS.scripted);
      return;
    }
    case 'special': {
      if (ctx.hooks && ctx.hooks.bossSpecial) ctx.hooks.bossSpecial(ctx, enemy, action);
      return;
    }
    default:
      throw new RangeError(`turn: unknown enemy action '${action.type}' (see ai.js)`);
  }
}

// ---------------------------------------------------------------------------------------------
// 7. Enemy status and hazard tick
// ---------------------------------------------------------------------------------------------

/** CMB-02 step 7: for each living enemy, in id order — status tick, hazard standing, death. */
export function enemyStatusAndHazardTick(ctx) {
  const state = ctx.state;
  for (const e of byId(state.floor.enemies)) {
    if (!state.floor.enemies.includes(e)) continue;
    statusTick(ctx, e);
    if (combat.isBroken(e)) {
      combat.breakActor(ctx, e);
      continue;
    }
    hazardStanding(ctx, e);
    if (combat.isBroken(e)) combat.breakActor(ctx, e);
    if (ctx.dead) return;
  }
}

// ---------------------------------------------------------------------------------------------
// 8. Level-up (CHR-07)
// ---------------------------------------------------------------------------------------------

/**
 * CHR-07: one level per check. `tuning.levelUpIntegrity` max Integrity and as much Integrity
 * (DIF-09), one skill point, the log line, and the `levelUp` event the UI turns into the Skills
 * screen (`hooks.onLevelUp` is the optional seam a screen stack can hang off).
 */
export function levelUpCheck(ctx) {
  const state = ctx.state;
  const tick = state.tick;
  if (tick.level >= MAX_LEVEL) return false;
  if (levelForXp(tick.xp) <= tick.level) return false;
  const gain = ctx.tuning ? ctx.tuning.levelUpIntegrity : LEVEL_INTEGRITY;
  tick.level += 1;
  tick.integrityMax += gain;
  tick.integrity = Math.min(tick.integrityMax, tick.integrity + gain);
  tick.skillPoints += 1;
  log.say(ctx.lines, 'levelUp', { n: tick.level });
  ctx.emit({ type: 'levelUp', level: tick.level });
  if (ctx.hooks && ctx.hooks.onLevelUp) ctx.hooks.onLevelUp(ctx);
  return true;
}

