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
// M04 implements the whole action schema except `skill`, `takeSkill` (M07) and `choose` (M08); the
// item actions are routed to `items.js`, which M05 fills in place.
//
// Nothing here touches the DOM (PLN-02 R2).

import { W, H, idx, inBounds, chebyshev } from './grid.js';
import { computeFov } from './fov.js';
import { mulberry32, fnv1a } from './rng.js';
import { TILE, walkable, blocksSight, HAZARDS, hazardActive, hazardWarning, turnsUntilActive } from './tiles.js';
import { generateFloor } from './gen.js';
import * as log from './log.js';
import * as items from './items.js';
import * as combat from './combat.js';
import { runTurn, hazardEnter, tensionWarnings, diagonalThroughDoor } from './turn.js';
import { createTick, createEnemy, derive, statsOf, TENSION_MAX } from './actors.js';
import { SCRIPT } from '../data/script.js';
import { FLOORS } from '../data/floors.js';

/** WLD-05: Tick's sight radius. */
export const FOV_RADIUS = 8;

/** The events that stop the turn loop until the player dismisses them (PLN-03, UI-16). */
const BLOCKING_EVENTS = new Set(['textbox', 'journal', 'descent']);

/** The last floor; there is no ascending from it (FLR-09). */
const LAST_FLOOR = 8;

/**
 * Create a game.
 *
 * @param {{seedString?: string, rng?: {next: () => number}, floor?: object, floorNumber?: number,
 *          intro?: boolean}} [options]
 *        `floor` injects a Floor object (`gen.js`'s shape, or `test/fixtures/maps.js`'s) instead of
 *        generating floor 1 — this is what `CH.loadFixture` and the integration tests use.
 *        `intro: false` skips the SCR-02 text box so a test starts in phase `run`.
 */
export function createGame(options = {}) {
  const seedString = options.seedString === undefined ? 'CLOCKWORK' : options.seedString;
  const rng = options.rng || mulberry32(fnv1a(`${seedString}:play`));

  const state = {
    version: 1,
    seedString,
    playRngState: typeof rng.getState === 'function' ? rng.getState() : 0,
    turn: 0,
    floorNumber: 0,
    tick: createTick(),
    floor: null,
    journal: { pages: [false, false, false, false, false, false, false, false], blueprint: false },
    uniquesGenerated: [],
    log: [],
    stats: { enemiesBroken: 0, turns: 0, floorsReached: 1 },
    flags: { tension30Warned: false },
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
  }

  const ctx = {
    state,
    rng,
    lines: state.log,
    emit,
    dead: false,
    hooks: {},
    resolveAction,
    onTensionChanged: tensionWarnings,
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
    // CHR-03 / SKL-03: the once-per-floor flags reset on arrival.
    state.flags.tension30Warned = false;
    state.tick.fieldRepairUsed = false;

    items.placeFloorItems(floor, data.items, ctx);
    emit({ type: 'floor', number: floor.number, name: floor.name });
    updateView();
    updateHazardCycle();
    return floor;
  }

  /** Generate floor `n` of this run's seed and enter it (WLD-10; floor 8 loads from data). */
  function generateAndEnter(n) {
    const data = generateFloor(seedString, n, { uniques: state.uniquesGenerated });
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
    if (t === TILE.DOOR_CLOSED) {
      state.floor.tiles[ny][nx] = TILE.DOOR_OPEN;
      log.say(state.log, 'doorOpen');
      // CAT-05 QUIET: with the Sounding Plate fitted, Tick opening a door is silent (D-051).
      combat.noise(ctx, nx, ny, items.doorNoise(tick));
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
      tick.tension = TENSION_MAX;
      log.say(state.log, 'station');
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
      case 'takeSkill':
        return { ok: false, reason: 'notImplemented' }; // M07
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
      floor: state.floorNumber,
      turns: state.turn,
      enemiesBroken: state.stats.enemiesBroken,
      level: state.tick.level,
      skills: state.tick.skills.slice(),
      weapon: state.tick.equipment.weapon,
      plating: state.tick.equipment.plating,
      attachment: state.tick.equipment.attachment,
      pages: state.journal.pages.filter(Boolean).length,
      seed: state.seedString,
    };
  }

  let deathEmitted = false;

  /** SCR-08: the Death screen's header and flavor, chosen by how Tick died (CMB-12). */
  function emitDeath() {
    if (deathEmitted) return;
    deathEmitted = true;
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
      return { ok: false, reason: 'notImplemented', log: [], events: [] }; // M08
    }
    if (action.type === 'dismiss') return { ok: false, reason: 'nothingToDismiss', log: [], events: [] };
    if (action.type === 'choose') return { ok: false, reason: 'noChoicePending', log: [], events: [] };

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
  };

  // A new run: floor 1 (or the injected fixture), then the SCR-02 intro text box.
  if (options.floor) enterFloor(options.floor);
  else generateAndEnter(options.floorNumber === undefined ? 1 : options.floorNumber);
  if (options.intro !== false) emit({ type: 'textbox', id: 'intro', text: SCRIPT.intro });

  return game;
}

/** Every floor's name, for the tools that report progress. */
export function floorName(n) {
  return FLOORS[n] ? FLOORS[n].name : null;
}

export { statsOf };
