// The engine facade of PLN-03: `createGame`, `act`, `state`, `phase`, `view`.
//
//   createGame({ seedString, rng })   rng optional: an object {next()} to inject (tests only)
//   game.act(action) -> { ok, reason?, log, events }
//   game.state                        the TEC-05 state object (read-only by convention)
//   game.phase                        'run' | 'awaitDismiss' | 'awaitChoice' | 'ended'
//   game.view()                       { visible: Set<idx>, remembered: Set<idx> }
//
// The engine never draws: it emits the PLN-03 events the UI consumes in order. `ok:false` with a
// `reason` means no turn was spent (CMB-05). While `phase` is `awaitDismiss` only `dismiss` is
// accepted, while `awaitChoice` only `choose`, while `ended` nothing (UI-16).
//
// M04 implemented the whole action schema except `choose` (M08); the item actions are routed to
// `items.js` and the two skill actions to `skills.js`, which own ITM/CAT and CHR/SKL respectively.
//
// Nothing here touches the DOM (PLN-02 R2).

import { W, H, idx, inBounds, chebyshev } from './grid.js';
import { computeFov, FOV_RADIUS } from './fov.js';
import { mulberry32, fnv1a } from './rng.js';
import { TILE, walkable, blocksSight, HAZARDS, hazardActive, hazardWarning, turnsUntilActive } from './tiles.js';
import { generateFloor } from './gen.js';
import * as log from './log.js';
import * as items from './items.js';
import * as combat from './combat.js';
import * as skills from './skills.js';
import * as bosses from './bosses.js';
import * as story from './story.js';
import { runTurn, hazardEnter, tensionWarnings, diagonalThroughDoor } from './turn.js';
import { createTick, createEnemy, derive, statsOf, TENSION_MAX } from './actors.js';
import { SCRIPT } from '../data/script.js';
import { FLOORS } from '../data/floors.js';
import { TUNING } from '../data/tuning.js';
import { SAVE_VERSION } from './save.js';

/** WLD-05: Tick's sight radius, defined in `fov.js` and re-exported here for M04's callers. */
export { FOV_RADIUS };

/** The events that stop the turn loop until the player dismisses them (PLN-03, UI-16). */
const BLOCKING_EVENTS = new Set(['textbox', 'journal', 'descent']);

/** The last floor; there is no ascending from it (FLR-09). */
const LAST_FLOOR = 8;

/**
 * DIF-02 — the tuning object a run plays under: `data/tuning.js`'s defaults with a partial
 * override merged over them. It is frozen and kept on `state.tuning` (TEC-05), so a save restores
 * the run with the numbers it was played under and every module reads one object.
 *
 * @param {object|null|undefined} partial a subset of `TUNING`'s keys
 * @returns {Readonly<Record<string, number>>}
 */
export function mergeTuning(partial) {
  if (!partial) return TUNING;
  const unknown = Object.keys(partial).filter((key) => !(key in TUNING));
  if (unknown.length > 0) {
    throw new RangeError(`createGame: unknown tuning key(s) ${unknown.join(', ')} (see data/tuning.js)`);
  }
  const merged = {};
  for (const key of Object.keys(TUNING)) {
    const value = partial[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new RangeError(`createGame: tuning.${key} must be a finite number, got ${String(value)}`);
    }
    merged[key] = value === undefined ? TUNING[key] : value;
  }
  return Object.freeze(merged);
}

/**
 * Create a game.
 *
 * @param {{seedString?: string, rng?: {next: () => number}, floor?: object, floorNumber?: number,
 *          intro?: boolean, state?: object, store?: object}} [options]
 *        `floor` injects a Floor object (`gen.js`'s shape, or `test/fixtures/maps.js`'s) instead of
 *        generating floor 1 — this is what `CH.loadFixture` and the integration tests use.
 *        `intro: false` skips the SCR-02 text box so a test starts in phase `run`.
 *        `state` restores a saved run (TEC-09 Continue): the state is adopted verbatim, the play RNG
 *        is rewound to its `playRngState`, no floor is generated, no intro is shown, and the log
 *        gets "Tick resumes." (D-082).
 *        `store` is a `save.js` store; when present the engine autosaves and deletes it exactly on
 *        TEC-09's triggers.
 */
export function createGame(options = {}) {
  const restored = options.state || null;
  const seedString = restored
    ? restored.seedString
    : options.seedString === undefined
      ? 'CLOCKWORK'
      : options.seedString;

  let rng;
  if (options.rng) {
    rng = options.rng;
  } else {
    rng = mulberry32(fnv1a(`${seedString}:play`));
    // TEC-09: "Continue restores state verbatim ... including `playRngState` (this is how
    // save-scumming is made pointless: the next rolls are the same rolls)."
    if (restored) rng.setState(restored.playRngState);
  }

  const store = options.store || null;

  const tuning = restored ? Object.freeze(mergeTuning(restored.tuning)) : mergeTuning(options.tuning);

  const state = restored || {
    version: SAVE_VERSION,
    seedString,
    tuning,
    playRngState: typeof rng.getState === 'function' ? rng.getState() : 0,
    turn: 0,
    floorNumber: 0,
    tick: createTick(),
    floor: null,
    journal: { pages: [false, false, false, false, false, false, false, false], blueprint: false },
    uniquesGenerated: [],
    log: [],
    // DIF-15's death-cause table reads `wanderersSpawned` and `itemsStolen` back out of here.
    stats: { enemiesBroken: 0, turns: 0, floorsReached: 1, wanderersSpawned: 0, itemsStolen: 0 },
    // STY-05: the scripted moments fire once per run, so the run remembers which have been shown.
    flags: { tension30Warned: false, momentsSeen: [] },
    dead: null,
    victory: null,
  };

  let events = [];
  const blocking = [];
  let pending = [];
  let awaitingChoice = false;
  let lastView = { visible: new Set(), remembered: new Set() };

  function emit(event) {
    events.push(event);
    pending.push(event);
    if (BLOCKING_EVENTS.has(event.type)) blocking.push(event);
    // PLN-03: the ending choice puts the engine in `awaitChoice`, where only `choose` is accepted.
    if (event.type === 'choice') awaitingChoice = true;
  }

  const ctx = {
    state,
    rng,
    // DIF-02: one frozen object every module reads its difficulty numbers from.
    tuning,
    lines: state.log,
    emit,
    dead: false,
    // The milestone hooks of PLN-06: `skills.js` owns the two that fire inside the turn loop
    // (SKL-03's Salvage and Decoy upkeep, SKL-04's Sympathetic Break); `bosses.js` owns the boss
    // specials and the BST-03 phase machine; `story.js` owns the STY-05 triggers and the endings.
    hooks: {
      onEnemyBroken(hookCtx, enemy) {
        // SKL-05 / D-069: Salvage and Sympathetic Break first, then BST-06's defeat sequence.
        skills.onEnemyBroken(hookCtx, enemy);
        story.onEnemyBroken(hookCtx, enemy);
      },
      onEnemyPhase: skills.onEnemyPhase,
      onRecordTaken: story.onRecordTaken,
      // TEC-09 step 9: the autosave M04 left this seam for (M09).
      autosave,
      bossSpecial: bosses.bossSpecial,
      onBossDamaged: bosses.onDamaged,
    },
    resolveAction,
    onTensionChanged: tensionWarnings,
    summary: () => summary(),
  };

  // -------------------------------------------------------------------------------------------
  // Floors
  // -------------------------------------------------------------------------------------------

  /** A fresh 24x60 memory grid: -1 means "never seen" (WLD-05). */
  function blankMemory() {
    const rows = [];
    for (let y = 0; y < H; y++) rows.push(new Array(W).fill(-1));
    return rows;
  }

  /**
   * Enter a floor: build the TEC-05 `state.floor` from a generator Floor, create the enemy
   * instances from its spawn records in record order (that order *is* the id order CMB-03
   * resolves in), place its items through `items.placeFloorItems`, clear Tick's statuses
   * (CMB-05 Ascend) and emit the `floor` event.
   */
  function enterFloor(data) {
    const floor = {
      number: data.number,
      name: data.name,
      shortName: data.shortName,
      tiles: data.tiles.map((row) => row.slice()),
      memory: blankMemory(),
      memoryItems: [],
      items: [],
      scrap: [],
      hazards: data.hazards.map((h) => ({ kind: h.kind, x: h.x, y: h.y })),
      features: data.features,
      rooms: data.rooms,
      roles: data.roles,
      enemies: [],
      decoy: null,
      nextEnemyId: 1,
      bossFlags: {},
      stationSpent: data.stationSpent === true,
      journalPage: data.journalPage,
      noises: [],
      hazardCycle: null,
      // WLD-14 (DIF-06): turns since Tick arrived, and how many wanderers this floor has sent.
      turnsHere: 0,
      wanderersSpawned: 0,
      // WLD-13's spawn markers, sorted by marker number — BST-06's Phase 2 summons stand on them.
      markers: data.markers ? data.markers.map((m) => ({ n: m.n, x: m.x, y: m.y })) : [],
    };
    for (const s of data.spawns) {
      floor.enemies.push(
        createEnemy(s.type, s.x, s.y, floor.nextEnemyId++, {
          homeRoom: s.homeRoom,
          isGuard: s.isGuard,
          isBoss: s.isBoss,
          state: s.state,
          statuses: s.statuses,
          integrity: s.integrity,
          lastKnown: s.lastKnown,
          ai: s.ai,
          // ENM-12 (DIF-08): the spawn record carries the floor RNG's Overwound roll.
          elite: s.elite,
          tuning,
        }),
      );
    }

    state.floor = floor;
    state.floorNumber = data.number;
    state.stats.floorsReached = Math.max(state.stats.floorsReached, data.number);
    state.tick.x = data.start.x;
    state.tick.y = data.start.y;

    // CMB-05 Ascend: "All statuses on Tick, and the Flywheel Guard timer, are cleared."
    state.tick.statuses = {};
    state.tick.guardTimer = 0;
    // DIF-03: "Ascending ends a repair" — the solder is left on the stair, silently.
    state.tick.repair = null;
    // CHR-03 / SKL-03: the once-per-floor flags reset on arrival.
    state.flags.tension30Warned = false;
    state.tick.fieldRepairUsed = false;

    items.placeFloorItems(floor, data.items, ctx);
    // BST-04: the Conductor's entry trigger is the floor start, so it is Active before Tick's
    // first view of the floor is computed below.
    story.onFloorEntered(ctx);
    emit({ type: 'floor', number: floor.number, name: floor.name });
    updateView();
    updateHazardCycle();
    return floor;
  }

  /** Generate floor `n` of this run's seed and enter it (WLD-10; floor 8 loads from data). */
  function generateAndEnter(n) {
    const data = generateFloor(seedString, n, { uniques: state.uniquesGenerated, tuning });
    return enterFloor(data);
  }

  // -------------------------------------------------------------------------------------------
  // Field of view and memory (WLD-05, CMB-02 step 10)
  // -------------------------------------------------------------------------------------------

  function rememberItem(x, y) {
    const here = items.itemAt(state.floor, x, y);
    const memoryItems = state.floor.memoryItems;
    const at = memoryItems.findIndex((m) => m.x === x && m.y === y);
    if (here) {
      const record = { x, y, name: here.name, count: here.count };
      if (at >= 0) memoryItems[at] = record;
      else memoryItems.push(record);
    } else if (at >= 0) {
      memoryItems.splice(at, 1);
    }
  }

  /** CMB-02 step 10: recompute Tick's FOV and fold it into the floor's memory. */
  function updateView() {
    const floor = state.floor;
    const tiles = floor.tiles;
    const visible = computeFov((x, y) => blocksSight(tiles[y][x]), state.tick.x, state.tick.y, FOV_RADIUS);
    const remembered = new Set();
    for (const i of visible) {
      const x = i % W;
      const y = (i - x) / W;
      floor.memory[y][x] = tiles[y][x];
      rememberItem(x, y);
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if (floor.memory[y][x] !== -1) remembered.add(idx(x, y));
    }
    lastView = { visible, remembered };
    // STY-05 / FLR-04 / BST-05: the triggers that fire on what Tick can now see.
    story.afterView(ctx, visible);
    return lastView;
  }

  /**
   * The panel's cyclic-hazard readout (UI-06, ACC-75/76): which cyclic hazard this floor has, and
   * whether it is active, warning (the turn before it becomes active) or `n` turns away. Derived,
   * refreshed after every action.
   */
  function updateHazardCycle() {
    const floor = state.floor;
    floor.hazardCycle = null;
    for (const h of floor.hazards) {
      const cfg = HAZARDS[h.kind];
      if (!cfg || cfg.mechanism !== 'CYCLIC') continue;
      floor.hazardCycle = {
        kind: h.kind,
        active: hazardActive(h.kind, state.turn),
        warning: hazardWarning(h.kind, state.turn),
        turnsUntilActive: turnsUntilActive(h.kind, state.turn),
      };
      return;
    }
  }

  // -------------------------------------------------------------------------------------------
  // CMB-05 — the action table
  // -------------------------------------------------------------------------------------------

  function refuse(reason, key, params) {
    if (key) log.say(state.log, key, params || {});
    return { ok: false, reason };
  }

  /** CMB-05 Move: attack, open a door, step, or refuse. */
  function doMove(dx, dy) {
    const tick = state.tick;
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || (dx === 0 && dy === 0)) {
      return { ok: false, reason: 'badDirection' };
    }
    const nx = tick.x + dx;
    const ny = tick.y + dy;
    if (!inBounds(nx, ny)) return refuse('blocked', 'wall');

    const target = combat.actorAt(state, nx, ny);
    if (target && target !== tick) {
      // "A Move into a tile containing a dormant enemy is still an attack" (CMB-05).
      if (target.isDecoy) return refuse('blocked');
      combat.meleeAttack(ctx, tick, target);
      return { ok: true };
    }

    // ENM-08: a diagonal step into or out of a door tile is refused, for Tick too.
    if (diagonalThroughDoor(state, tick.x, tick.y, nx, ny)) return { ok: false, reason: 'doorDiagonal' };

    const t = state.floor.tiles[ny][nx];
    // WLD-15 (DIF-12): a Wound Lock on a cache door. Winding it costs Tension and a turn; with too
    // little spring the bump is refused and costs neither (CMB-05).
    if (t === TILE.WOUND_LOCK) {
      if (tick.tension <= tuning.cacheLockCost) return refuse('notEnoughTension', 'lockNoSpring');
      state.floor.tiles[ny][nx] = TILE.DOOR_OPEN;
      combat.spendTension(ctx, tuning.cacheLockCost);
      log.say(state.log, 'lockWound', { n: tick.tension });
      return { ok: true };
    }
    if (t === TILE.DOOR_CLOSED) {
      state.floor.tiles[ny][nx] = TILE.DOOR_OPEN;
      log.say(state.log, 'doorOpen');
      // CAT-05 QUIET: with the Sounding Plate fitted, Tick opening a door is silent (D-051).
      combat.noise(ctx, nx, ny, items.doorNoise(tick));
      // BST-06: opening the antechamber door of FLR-09 is the Understudy's entry trigger.
      story.onDoorOpened(ctx, nx, ny);
      return { ok: true };
    }
    if (!walkable(t)) return refuse('blocked', 'wall');

    tick.x = nx;
    tick.y = ny;
    // WLD-08: an ENTER check during step 1 uses the turn value this action will have (turn + 1).
    hazardEnter(ctx, tick, state.turn + 1);
    if (!ctx.dead) {
      const here = items.itemAt(state.floor, nx, ny);
      if (here) log.say(state.log, 'itemHere', { X: here.name });
    }
    return { ok: true };
  }

  /** CMB-05 Interact: an unspent Winding Station (CHR-05) or the up-stairs. */
  function doInteract() {
    const tick = state.tick;
    const t = state.floor.tiles[tick.y][tick.x];
    if (t === TILE.STAIRS_UP) return doAscend();
    if (t === TILE.STATION) {
      if (state.floor.stationSpent) return refuse('spent', 'stationSpent');
      state.floor.stationSpent = true;
      tick.tension = Math.min(TENSION_MAX, tuning.stationRestore);
      log.say(state.log, 'station', { n: tick.tension });
      // CHR-05 / CMB-11 (DIF-05): winding is loud. The noise wakes every Dormant enemy inside it
      // (`combat.noise`), and every Active one re-targets the station tile — ENM-05's refresh with
      // the station's own radius rather than the enemy's perception, as the Clatter Can does.
      combat.noise(ctx, tick.x, tick.y, tuning.stationNoise);
      for (const e of state.floor.enemies) {
        if (e.state !== 'ACTIVE') continue;
        if (chebyshev(e.x, e.y, tick.x, tick.y) > tuning.stationNoise) continue;
        e.lastKnown = { x: tick.x, y: tick.y };
        e.lastKnownAge = 0;
      }
      log.say(state.log, 'stationLoud');
      return { ok: true };
    }
    return refuse('nothing', 'nothingHereToUse');
  }

  /** CMB-05 Ascend (WLD-10): generate the next floor and arrive on its start tile. */
  function doAscend() {
    const tick = state.tick;
    if (state.floor.tiles[tick.y][tick.x] !== TILE.STAIRS_UP) return { ok: false, reason: 'notStairs' };
    const next = state.floorNumber + 1;
    if (next > LAST_FLOOR) return { ok: false, reason: 'noFloorAbove' };
    const floor = generateAndEnter(next);
    log.say(state.log, 'stairs', { n: floor.number, 'floor name': floor.name });
    return { ok: true };
  }

  /** CMB-05 Close door: an adjacent open door with no actor and no item on it. */
  function doCloseDoor(dx, dy) {
    const tick = state.tick;
    const nx = tick.x + dx;
    const ny = tick.y + dy;
    if (!inBounds(nx, ny)) return { ok: false, reason: 'blocked' };
    if (state.floor.tiles[ny][nx] !== TILE.DOOR_OPEN) return { ok: false, reason: 'notADoor' };
    if (combat.actorAt(state, nx, ny)) return { ok: false, reason: 'occupied' };
    if (items.itemAt(state.floor, nx, ny)) return { ok: false, reason: 'itemInTheWay' };
    state.floor.tiles[ny][nx] = TILE.DOOR_CLOSED;
    log.say(state.log, 'doorClose');
    return { ok: true };
  }

  /** CMB-08 Fire: the ranged weapon, its Tension cost, noise 4, then CMB-06 steps 2-7. */
  function doFire(x, y) {
    const tick = state.tick;
    const d = derive(tick);
    if (!d.ranged) return { ok: false, reason: 'noRangedWeapon' };
    if (!inBounds(x, y)) return { ok: false, reason: 'offMap' };
    if (chebyshev(tick.x, tick.y, x, y) > d.ranged.range) return { ok: false, reason: 'outOfRange' };
    if (!lastView.visible.has(idx(x, y))) return { ok: false, reason: 'notVisible' };

    const shot = combat.projectile(state, tick.x, tick.y, x, y);
    if (!shot.actor) return refuse('nothingToShoot', 'nothingToShoot');

    // CHR-04 / CMB-08: a shot never winds Tick down.
    if (tick.tension <= d.ranged.tensionCost) {
      return refuse('notEnoughTension', 'skillUnaffordable', { X: d.ranged.item.name });
    }
    combat.spendTension(ctx, d.ranged.tensionCost);
    if (ctx.dead) return { ok: true };
    combat.rangedAttack(ctx, tick, shot.actor);
    return { ok: true };
  }

  /** CMB-08 Throw: a throwable from the inventory at a visible tile within its range. */
  function doThrow(slot, x, y) {
    const tick = state.tick;
    const entry = tick.inventory[slot];
    if (!entry) return { ok: false, reason: 'noSuchSlot' };
    const def = items.itemDef(entry.name);
    if (def.category !== 'throwable') return { ok: false, reason: 'notThrowable' };
    if (!inBounds(x, y)) return { ok: false, reason: 'offMap' };
    if (chebyshev(tick.x, tick.y, x, y) > (def.range || 0)) return { ok: false, reason: 'outOfRange' };
    if (!lastView.visible.has(idx(x, y))) return { ok: false, reason: 'notVisible' };
    const name = items.takeFromStack(tick, slot);
    combat.throwAt(ctx, name, tick.x, tick.y, x, y);
    return { ok: true };
  }

  /** CMB-02 step 1 — the action table of CMB-05. */
  function resolveAction(action) {
    switch (action.type) {
      case 'move':
        return doMove(action.dx, action.dy);
      case 'wait':
        return { ok: true };
      case 'pickup':
        return items.pickUp(ctx);
      case 'interact':
        return doInteract();
      case 'ascend':
        return doAscend();
      case 'closeDoor':
        return doCloseDoor(action.dx, action.dy);
      case 'use':
        return items.useItem(ctx, action.slot);
      case 'throw':
        return doThrow(action.slot, action.x, action.y);
      case 'fire':
        return doFire(action.x, action.y);
      case 'equip':
        return items.equip(ctx, action.slot);
      case 'unequip':
        return items.unequip(ctx, action.which);
      case 'drop':
        return items.drop(ctx, action.slot);
      case 'skill':
        // SKL-01: Discord needs to know what Tick can see, and nothing else here does.
        return skills.useSkill(ctx, action, lastView.visible);
      case 'takeSkill':
        // Intercepted by `act` as a free action (D-064), so the turn loop never sees it.
        return { ok: false, reason: 'freeAction' };
      default:
        return { ok: false, reason: 'unknownAction' };
    }
  }

  // -------------------------------------------------------------------------------------------
  // Death and the summary (CMB-12, SCR-08, STY-08)
  // -------------------------------------------------------------------------------------------

  /** STY-08's summary fields, as the death and victory events carry them. */
  function summary() {
    return {
      // STY-08 says "floors reached", so it is the run's high-water mark, not `floorNumber` (D-076).
      floor: state.stats.floorsReached,
      turns: state.turn,
      enemiesBroken: state.stats.enemiesBroken,
      level: state.tick.level,
      skills: state.tick.skills.slice(),
      weapon: items.entryName(state.tick.equipment.weapon),
      plating: items.entryName(state.tick.equipment.plating),
      attachment: items.entryName(state.tick.equipment.attachment),
      pages: state.journal.pages.filter(Boolean).length,
      seed: state.seedString,
    };
  }

  let deathEmitted = false;

  /** SCR-08: the Death screen's header and flavor, chosen by how Tick died (CMB-12). */
  function emitDeath() {
    if (deathEmitted) return;
    deathEmitted = true;
    // CMB-12 / TEC-09: "the autosave is deleted before the Death screen is shown" (ACC-03).
    if (store) store.clear();
    const screen = state.dead.wound ? SCRIPT.screens.woundDown : SCRIPT.screens.broken;
    emit({
      type: 'death',
      cause: state.dead.cause,
      header: screen.header,
      flavor: screen.flavor,
      summary: summary(),
    });
  }

  // -------------------------------------------------------------------------------------------
  // The facade
  // -------------------------------------------------------------------------------------------

  function phase() {
    if (state.dead || state.victory) return 'ended';
    if (blocking.length > 0) return 'awaitDismiss';
    if (awaitingChoice) return 'awaitChoice';
    return 'run';
  }

  /**
   * TEC-09's autosave. Called from the CMB-02 step 9 hook (so after every turn-costing action,
   * Ascend included), after `takeSkill`, after the ending choice, and by the UI when leaving to the
   * title via Pause (`game.autosave`).
   *
   * Three cases, in order (D-083):
   *   * phase `ended` — the run is over: the save is *deleted*, which is TEC-09's death/victory rule
   *     and what ACC-03 and ACC-115 assert.
   *   * any other non-`run` phase — a text box or the ending choice is queued. Those events live
   *     outside `state` and would be lost, so the previous save is left alone rather than replaced
   *     by a state that can no longer reach the sequence it was in the middle of.
   *   * phase `run` — write the state, with `playRngState` brought up to date first, so a restore
   *     resumes on exactly the roll the uninterrupted run would have made (TEC-09, ACC-02).
   */
  function autosave() {
    if (!store) return false;
    const current = phase();
    if (current === 'ended') {
      store.clear();
      return false;
    }
    if (current !== 'run') return false;
    if (typeof rng.getState === 'function') state.playRngState = rng.getState();
    store.save(state);
    return true;
  }

  /** Every log line this action produced, merges included (UI-04). */
  function linesSince(startLen, startLast, startCount) {
    const out = state.log.slice(startLen);
    const last = state.log[startLen - 1];
    if (last && last === startLast && last.count !== startCount) out.unshift(last);
    return out;
  }

  function act(action) {
    if (!action || typeof action.type !== 'string') throw new TypeError('act: an action needs a type');
    const startLen = state.log.length;
    const startLast = state.log[startLen - 1];
    const startCount = startLast ? startLast.count : 0;
    events = [];
    ctx.dead = false;

    const current = phase();
    if (current === 'ended') return { ok: false, reason: 'ended', log: [], events: [] };
    if (current === 'awaitDismiss') {
      if (action.type !== 'dismiss') return { ok: false, reason: 'awaitDismiss', log: [], events: [] };
      blocking.shift();
      return { ok: true, log: [], events: [] };
    }
    if (current === 'awaitChoice') {
      if (action.type !== 'choose') return { ok: false, reason: 'awaitChoice', log: [], events: [] };
      // STY-07 / SCR-07: one action emits page 8, Ending B's descent, the ending text and the
      // Victory screen, and `state.victory` puts the engine in `ended` (PLN-06 M08 task 4).
      const chosen = story.choose(ctx, action.option);
      if (chosen.ok === false) return { ok: false, reason: chosen.reason, log: [], events: [] };
      awaitingChoice = false;
      // TEC-09: the save is deleted on victory (ACC-115); `state.victory` puts us in phase `ended`.
      autosave();
      return { ok: true, log: linesSince(startLen, startLast, startCount), events };
    }
    if (action.type === 'dismiss') return { ok: false, reason: 'nothingToDismiss', log: [], events: [] };
    if (action.type === 'choose') return { ok: false, reason: 'noChoicePending', log: [], events: [] };

    // CHR-07 / CHR-09: taking a skill on the Skills screen costs a skill point, not a turn, and is
    // allowed while Stunned like any other screen action (D-064). It never enters the CMB-02 loop.
    if (action.type === 'takeSkill') {
      const taken = skills.takeSkill(ctx, action.name);
      // TEC-09 writes the save "on skill selection", which is not a turn (D-064).
      if (taken.ok !== false) autosave();
      return {
        ok: taken.ok !== false,
        reason: taken.reason,
        log: linesSince(startLen, startLast, startCount),
        events,
      };
    }

    // CMB-04: while Stunned, Tick's only permitted action is Wait.
    if (state.tick.statuses.Stunned > 0 && action.type !== 'wait') {
      return { ok: false, reason: 'stunned', log: [], events: [] };
    }

    const result = runTurn(ctx, action);
    updateView();
    updateHazardCycle();
    if (typeof rng.getState === 'function') state.playRngState = rng.getState();
    if (state.dead) emitDeath();

    return {
      ok: result.ok !== false,
      reason: result.reason,
      log: linesSince(startLen, startLast, startCount),
      events,
    };
  }

  const game = {
    state,
    get phase() {
      return phase();
    },
    act,
    view() {
      return lastView;
    },
    /** The events emitted since the last drain — how the UI collects the intro (TEC-13). */
    drainEvents() {
      const out = pending;
      pending = [];
      return out;
    },
    /** TEC-13 `CH.loadFloor(n)`: generate floor n of this seed and enter it with Tick's state. */
    loadFloor(n) {
      const floor = generateAndEnter(n);
      updateView();
      return floor;
    },
    /** TEC-13 `CH.loadFixture`: replace the current floor with a fixture Floor, keeping Tick. */
    loadFixture(data) {
      const floor = enterFloor(data);
      updateView();
      return floor;
    },
    /** The turn context, for the tests and tools that drive `combat.js` directly. */
    ctx,
    /** The derived stats of CHR-08/CMB-01 for the panel (UI-03). */
    derived() {
      return derive(state.tick);
    },
    /**
     * TEC-09's autosave, for the one trigger that is not an engine action: "when leaving to the
     * title via Pause" (UI-18). Returns true if a save was written.
     */
    autosave,
    /** TEC-09's delete, for the UI-17 Abandon prompt and the Death/Victory screens. */
    deleteSave() {
      if (!store) return false;
      return store.clear();
    },
  };

  if (restored) {
    // TEC-09 Continue: no floor is generated and no intro is shown — the state is already a run.
    // Only the derived values and the FOV are recomputed (TEC-05), and the log says so.
    log.say(state.log, 'resume');
    updateView();
    updateHazardCycle();
  } else {
    // A new run: floor 1 (or the injected fixture), then the SCR-02 intro text box.
    if (options.floor) enterFloor(options.floor);
    else generateAndEnter(options.floorNumber === undefined ? 1 : options.floorNumber);
    if (options.intro !== false) emit({ type: 'textbox', id: 'intro', text: SCRIPT.intro });
  }

  return game;
}

/** Every floor's name, for the tools that report progress. */
export function floorName(n) {
  return FLOORS[n] ? FLOORS[n].name : null;
}

export { statsOf };
