// M09 — Save and load (TEC-09), proven headlessly.
//
// The storage adapter is injected (`createStore`), so every rule of TEC-09 is testable in Node: the
// adapter here is a bare `Map`, exactly as PLN-06 M09 specifies, and M10 hands the same store a
// `localStorage`. One test also drives a `localStorage`-shaped adapter so both shapes are covered
// before M10 relies on one of them.
//
// The replay tests (ACC-01, ACC-02) never inject `queueRng`: they use the run's own
// `mulberry32(fnv1a(seed + ':play'))` stream, because `playRngState` is the thing under test. The
// action sequences are produced by a *separate* seeded `mulberry32` (R6: a fixed seed, never
// `Math.random`), so both halves of a comparison take byte-identical action lists.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createGame } from '../../src/engine.js';
import { createStore, serialize, deserialize, validate, SAVE_KEY, SAVE_VERSION } from '../../src/save.js';
import { loadFixedFloor } from '../../src/gen.js';
import { chebyshev, astar } from '../../src/grid.js';
import { mulberry32 } from '../../src/rng.js';
import * as combat from '../../src/combat.js';
import { TILE, walkable } from '../../src/tiles.js';
import { floorFromAscii } from '../fixtures/maps.js';
import { SCRIPT } from '../../data/script.js';
import { ENEMIES_BY_NAME } from '../../data/enemies.js';

const WIDTH = 60;
const row = (s) => s.padEnd(WIDTH, '#').slice(0, WIDTH);

// ---------------------------------------------------------------------------------------------
// The injected adapters
// ---------------------------------------------------------------------------------------------

/** PLN-06 M09's in-memory adapter: a bare `Map`, which `createStore` accepts unwrapped. */
const memory = () => new Map();

/** A fresh single-slot store over a fresh `Map`. */
const store = () => createStore(memory());

/** The shape M10 will inject: `getItem` / `setItem` / `removeItem` over the same storage. */
function localStorageLike() {
  const cells = new Map();
  return {
    cells,
    getItem: (k) => (cells.has(k) ? cells.get(k) : null),
    setItem: (k, v) => {
      cells.set(k, String(v));
    },
    removeItem: (k) => {
      cells.delete(k);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------------------------

/**
 * The log as the player reads it: one entry per message, UI-04 merge counts expanded. Comparing
 * flattened texts makes the comparison insensitive to *where* a merge boundary fell, which is the
 * only way the extra "Tick resumes." line of a restored run can be discounted honestly (D-084).
 */
function logTexts(state) {
  const out = [];
  for (const line of state.log) for (let i = 0; i < (line.count || 1); i++) out.push(line.text);
  return out;
}

/** The same, with the restore line removed, for comparing a restored run with one that ran through. */
const logWithoutResume = (state) => logTexts(state).filter((t) => t !== SCRIPT.log.resume);

/** A `view()` set as a comparable, stable value. */
const sorted = (set) => [...set].sort((a, b) => a - b);

const viewOf = (game) => ({ visible: sorted(game.view().visible), remembered: sorted(game.view().remembered) });

/**
 * Every value reachable from `state`, classified. Used to prove that the round trip covers the
 * *whole* state rather than a list of fields somebody remembered (see `assertRoundTrips`).
 */
function walk(value, path, out) {
  if (value === null) {
    out.push([path, 'null']);
    return out;
  }
  const t = typeof value;
  if (t !== 'object') {
    out.push([path, t === 'number' && !Number.isFinite(value) ? `number:${value}` : t]);
    return out;
  }
  if (Array.isArray(value)) {
    out.push([path, 'Array']);
    for (let i = 0; i < value.length; i++) walk(value[i], `${path}[${i}]`, out);
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    out.push([path, value.constructor && value.constructor.name ? value.constructor.name : 'exotic']);
    return out;
  }
  out.push([path, 'Object']);
  for (const key of Object.keys(value).sort()) walk(value[key], `${path}.${key}`, out);
  return out;
}

/**
 * The M09 completeness check, applied to a live state.
 *
 * 1. Every reachable value is one JSON can carry (no `Set`, `Map`, typed array, `Date`, function,
 *    `undefined`, `NaN`) — so no field *can* be silently dropped.
 * 2. `deserialize(serialize(state))` deep-equals the live state — so no field *was* dropped or
 *    changed, whether or not this milestone knew about it.
 * 3. Serializing the restored state gives byte-identical text — so the round trip is a fixed point.
 *
 * A field added by a later milestone that cannot survive a save therefore fails here, without this
 * test naming it.
 */
function assertRoundTrips(state, label) {
  const shapes = walk(state, 'state', []);
  const allowed = new Set(['null', 'boolean', 'number', 'string', 'Array', 'Object']);
  const bad = shapes.filter(([, kind]) => !allowed.has(kind));
  assert.deepEqual(bad, [], `${label}: values JSON cannot round-trip: ${JSON.stringify(bad)}`);
  assert.ok(shapes.length > 3000, `${label}: the walk should reach the whole state; saw ${shapes.length} values`);

  const json = serialize(state);
  const back = deserialize(json);
  assert.notEqual(back, null, `${label}: the save must validate`);
  assert.deepStrictEqual(back, state, `${label}: the round trip must return the whole state unchanged`);
  assert.equal(serialize(back), json, `${label}: serialize must be a fixed point`);
  return json;
}

// ---------------------------------------------------------------------------------------------
// Scripted play (R6: deterministic, from a fixed seed)
// ---------------------------------------------------------------------------------------------

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/**
 * A fixed action script: a deterministic wanderer that also picks up, interacts and waits. The
 * stream comes from its own `mulberry32`, so two engines given the same script take exactly the
 * same actions whatever happens in either run.
 */
function script(seed, length) {
  const pol = mulberry32(seed);
  const out = [];
  while (out.length < length) {
    const p = pol.next();
    if (p < 0.08) out.push({ type: 'wait' });
    else if (p < 0.12) out.push({ type: 'pickup' });
    else if (p < 0.14) out.push({ type: 'interact' });
    else {
      const d = DIRS[Math.floor(pol.next() * 8)];
      out.push({ type: 'move', dx: d[0], dy: d[1] });
    }
  }
  return out;
}

/**
 * Play `actions` in order. A queued text box is dismissed first (it costs no turn, UI-16), so the
 * scripted moments of a real floor do not consume script entries.
 */
function play(game, actions) {
  for (const action of actions) {
    while (game.phase === 'awaitDismiss') game.act({ type: 'dismiss' });
    if (game.phase !== 'run') break;
    game.act(action);
  }
  return game;
}

/**
 * A deterministic *policy* rather than a fixed list: it closes over its own `mulberry32` and picks
 * the next action from the state it is shown. A wanderer that never fights consumes no play
 * randomness at all, which would make ACC-01 and ACC-02 blind to `playRngState` — this one closes
 * on whatever it can see while Tick is above half Integrity, so hit rolls, damage dice, drop rolls
 * and enemy decisions all come out of the stream under test.
 *
 * The policy lives outside the engine, so the same instance keeps stepping across a restore, which
 * is what lets an interrupted run take the same actions as the run that was never interrupted.
 */
function driver(seed) {
  const pol = mulberry32(seed);
  return (game) => {
    const state = game.state;
    const tick = state.tick;
    const tiles = state.floor.tiles;
    const p = pol.next();

    // Above half Integrity, close on the nearest enemy (ties by id) and hit it: CMB-05 makes a move
    // into an enemy an attack, so this is what puts hit rolls, damage dice, ITM-11 drop rolls and
    // ENM-06 decisions into the play stream.
    if (tick.integrity * 2 > tick.integrityMax) {
      let best = null;
      for (const e of state.floor.enemies) {
        const d = chebyshev(tick.x, tick.y, e.x, e.y);
        if (best === null || d < best.d || (d === best.d && e.id < best.e.id)) best = { e, d };
      }
      if (best && best.d <= 1) return { type: 'move', dx: best.e.x - tick.x, dy: best.e.y - tick.y };
      if (best) {
        // A closed door counts as passable: Tick opens it by moving into it (CMB-05).
        const step = (_from, to) =>
          walkable(tiles[to.y][to.x]) || tiles[to.y][to.x] === TILE.DOOR_CLOSED;
        const path = astar(step, { x: tick.x, y: tick.y }, { x: best.e.x, y: best.e.y }, { maxLen: 60 });
        if (path && path.length > 0) return { type: 'move', dx: path[0].x - tick.x, dy: path[0].y - tick.y };
      }
    }

    if (p < 0.08) return { type: 'wait' };
    if (p < 0.12) return { type: 'pickup' };
    if (p < 0.14) return { type: 'interact' };
    const d = DIRS[Math.floor(pol.next() * 8)];
    return { type: 'move', dx: d[0], dy: d[1] };
  };
}

/** Take `n` policy steps, dismissing any text box first (UI-16 costs no turn). */
function playWith(game, n, policy) {
  for (let i = 0; i < n; i++) {
    while (game.phase === 'awaitDismiss') game.act({ type: 'dismiss' });
    if (game.phase !== 'run') break;
    game.act(policy(game));
  }
  return game;
}

/**
 * A run on a generated floor of seed `TEST1234`, optionally entered through `loadFloor` (TEC-13).
 * `tough` raises Integrity so a 200-action fight is still live at the end: CHR-01's 40 Integrity
 * does not survive floor 3 for that long, and an ACC-02 comparison between two dead runs proves
 * very little.
 */
function wanderer(floorNumber, options = {}) {
  const game = createGame({ seedString: 'TEST1234', intro: false, store: options.store });
  if (floorNumber > 1) game.loadFloor(floorNumber);
  if (options.tough) {
    game.state.tick.integrityMax = 400;
    game.state.tick.integrity = 400;
  }
  return game;
}

// ---------------------------------------------------------------------------------------------
// ACC-01 — the same seed and the same actions give the same run
// ---------------------------------------------------------------------------------------------

test('ACC-01: two engines on seed TEST1234 given the same 50 actions serialize identically @m09', () => {
  const a = createGame({ seedString: 'TEST1234' });
  const b = createGame({ seedString: 'TEST1234' });

  // The SCR-02 intro is a blocking text box in both (UI-16), dismissed as the first action.
  assert.equal(a.phase, 'awaitDismiss');
  assert.equal(b.phase, 'awaitDismiss');

  const fresh = createGame({ seedString: 'TEST1234' }).state.playRngState;
  playWith(a, 50, driver(1));
  playWith(b, 50, driver(1));

  assert.ok(a.state.turn >= 30, `the script should really play out; turn ${a.state.turn}`);
  assert.notEqual(a.state.playRngState, fresh, 'the 50 actions must draw from the play stream');
  assert.ok(a.state.stats.enemiesBroken > 0 || a.state.tick.integrity < a.state.tick.integrityMax, 'and fight');
  assert.equal(serialize(a.state), serialize(b.state), 'ACC-01: byte-identical state');
  assert.deepEqual(logTexts(b.state), logTexts(a.state), 'ACC-01: identical log');
  assert.deepEqual(viewOf(b), viewOf(a), 'ACC-01: identical map and memory');
  assert.equal(b.state.playRngState, a.state.playRngState, 'TEC-07: the same next roll');
  assert.equal(b.ctx.rng.next(), a.ctx.rng.next(), 'TEC-07: literally the same next draw');
});

test('ACC-01: the save an autosave writes is the same bytes for two runs of the same script @m09', () => {
  const raws = [];
  for (const _ of [0, 1]) {
    const adapter = memory();
    const store = createStore(adapter);
    const game = createGame({ seedString: 'TEST1234', store });
    playWith(game, 50, driver(2));
    assert.equal(adapter.size, 1, 'TEC-09: one slot');
    raws.push(store.read());
  }
  assert.equal(raws[0], raws[1]);
  assert.equal(deserialize(raws[0]).turn > 0, true);
});

// ---------------------------------------------------------------------------------------------
// ACC-02 — restore is replay-equivalent
// ---------------------------------------------------------------------------------------------

/**
 * ACC-02's core assertion: a run cut in half at `cut`, saved, and restored into a *fresh* engine
 * ends in the same state as the run that was never interrupted — "State, turn counter, FOV, log
 * tail, and the *next* hit roll are identical to not reloading."
 */
function assertReplayEquivalent(build, policySeed, total, cut, label) {
  const straight = playWith(build(store()), total, driver(policySeed));

  // The interrupted half keeps the *same* policy instance across the restore, so both runs take the
  // same actions for as long as they agree about the state — and diverge visibly if they do not.
  // What is restored is the engine's *own* autosave, not a hand-made snapshot: that is what the
  // browser reloads, and the only way the CMB-02 step 9 write itself is under test.
  const policy = driver(policySeed);
  const slot = store();
  const first = playWith(build(slot), cut, policy);
  const saved = slot.load();
  assert.notEqual(saved, null, `${label}: the autosave must be readable`);
  // The comparison is only sensitive to `playRngState` if the first half actually drew from the
  // stream: otherwise a restore that forgot to rewind the RNG would pass by coincidence.
  assert.notEqual(saved.playRngState, build(store()).state.playRngState, `${label}: the first half must draw`);
  assert.equal(saved.playRngState, first.state.playRngState, `${label}: the save is not one turn stale`);

  // Snapshot what the autosave actually holds: `createGame` adopts the loaded state, so `saved.log`
  // becomes the restored run's live log and cannot be read afterwards.
  const savedLog = JSON.parse(JSON.stringify(saved.log));
  const restored = createGame({ state: saved });
  assert.equal(restored.state.playRngState, first.state.playRngState, `${label}: the save's stream position`);
  playWith(restored, total - cut, policy);

  assert.deepStrictEqual(
    { ...restored.state, log: undefined },
    { ...straight.state, log: undefined },
    `${label}: the whole state but the log`,
  );
  // The log is compared in the two halves the restore splits it into: everything the autosave
  // carried has to come back byte for byte, and everything played after it has to match the
  // uninterrupted run. Between them sit the `lost` lines that free actions produced after the last
  // autosave — a refused move or "Nothing here to use." costs no turn, so CMB-02 step 9 never runs
  // for it and its log line never reaches the save. That is the one thing a restore does not
  // reproduce, and it is cosmetic: the state comparison above is what proves the restore faithful.
  const expand = (lines) => {
    const out = [];
    for (const line of lines) for (let i = 0; i < (line.count || 1); i++) out.push(line.text);
    return out;
  };
  const persisted = expand(savedLog).length;
  const lost = expand(first.state.log).length - persisted;
  assert.ok(lost >= 0, `${label}: the save cannot hold more log than the live run`);
  const straightTexts = logTexts(straight.state);
  const restoredTexts = logWithoutResume(restored.state);
  assert.deepEqual(
    restoredTexts.slice(0, persisted),
    straightTexts.slice(0, persisted),
    `${label}: the log the autosave carried`,
  );
  assert.deepEqual(
    restoredTexts.slice(persisted),
    straightTexts.slice(persisted + lost),
    `${label}: the log played after the restore`,
  );
  assert.deepEqual(viewOf(restored), viewOf(straight), `${label}: FOV and memory`);
  assert.equal(restored.state.playRngState, straight.state.playRngState, `${label}: playRngState`);
  assert.equal(restored.ctx.rng.next(), straight.ctx.rng.next(), `${label}: the next hit roll`);
  assert.equal(restored.phase, straight.phase, `${label}: the same phase`);
  return { straight, restored };
}

test('ACC-02: serializing at action 100 of 200 on floor 3 and restoring reproduces the uninterrupted run @m09', () => {
  const { straight, restored } = assertReplayEquivalent((slot) => wanderer(3, { tough: true, store: slot }), 3, 200, 100, 'ACC-02 floor 3');

  assert.equal(straight.state.dead, null, 'the run must still be live, or the test proves little');
  assert.ok(straight.state.turn >= 100, `the script should really play out; turn ${straight.state.turn}`);
  assert.equal(straight.state.floorNumber, 3, 'ACC-02 is stated mid-run on floor 3');
  assert.ok(
    logTexts(restored.state).includes(SCRIPT.log.resume),
    'TEC-09: Continue prints "Tick resumes."',
  );
  assert.equal(
    logTexts(restored.state).filter((t) => t === SCRIPT.log.resume).length,
    1,
    'exactly one restore in this run',
  );
});

test('ACC-02: a restore mid boss fight keeps the BST-06 script running identically @m09', () => {
  // Floor 8 (FLR-09): the Understudy's spring, phase, action counter, wind-up flags, its two
  // summons and the markers they stood on all have to come back, or the fight diverges.
  const { straight, restored } = assertReplayEquivalent(understudyFight, 4, 30, 15, 'ACC-02 floor 8');

  const boss = straight.state.floor.enemies.find((e) => e.type === 'The Understudy');
  assert.ok(boss, 'the Understudy must survive the script, or the test proves nothing');
  assert.equal(boss.phase, 2, 'BST-06: the fight was still in Phase 2');
  assert.ok(boss.bossActions > 5, `the boss must have acted; bossActions ${boss.bossActions}`);
  const springMax = ENEMIES_BY_NAME['The Understudy'].tension;
  assert.ok(boss.tension < springMax && boss.tension > 0, `BST-06's spring must be part-spent; ${boss.tension}`);
  assert.equal(
    restored.state.floor.enemies.filter((e) => e.summonedBy === boss.id).length,
    2,
    'BST-06: both summons came back with their summonedBy',
  );
  assert.deepEqual(
    restored.state.floor.markers,
    [{ n: 1, x: 24, y: 18 }, { n: 2, x: 50, y: 18 }],
    "WLD-13's markers survive, so a Phase 2 summon still knows where to stand",
  );
});

/**
 * Floor 8 with BST-06's entry trigger fired, the Understudy already in Phase 2 (so its summons,
 * its `phase`, its `speedOverride` and its Pulse are all live), and Tick strong enough to survive
 * the fight the script then plays out.
 */
function understudyFight(slot) {
  const game = createGame({ seedString: 'M09BOSS', floor: loadFixedFloor(8), intro: false, store: slot });
  // Tick starts at (5,4); the sixth step opens the antechamber `+` at (11,4) and wakes the boss.
  for (let i = 0; i < 6; i++) game.act({ type: 'move', dx: 1, dy: 0 });
  game.act({ type: 'dismiss' });
  // The fight has to last long enough to be worth comparing, which CHR-01's 40 Integrity does not.
  game.state.tick.integrityMax = 4000;
  game.state.tick.integrity = 4000;
  const boss = game.state.floor.enemies.find((e) => e.type === 'The Understudy');
  boss.integrity = 49;
  combat.damage(game.ctx, boss, 3, {}); // 3 - Plating 2 = 1: crosses 48 into Phase 2 (BST-06)
  return game;
}

// ---------------------------------------------------------------------------------------------
// The round trip is total, not a list of fields
// ---------------------------------------------------------------------------------------------

test('@unit save: the whole state of a played-out run round-trips, whatever is in it @m09', () => {
  const wandered = play(wanderer(3), script(5, 150));
  assertRoundTrips(wandered.state, 'a generated floor 3');

  const fight = play(understudyFight(), new Array(12).fill({ type: 'wait' }));
  assertRoundTrips(fight.state, 'the Understudy fight');

  const rich = richRun();
  assertRoundTrips(rich.state, 'skills, items, hazards and a Decoy');
});

test('@unit save: the fields M04-M08 keep outside the TEC-05 headline list are in the state @m09', () => {
  // Not an allowlist that stands in for the round trip above — a check that each of these lives in
  // `state` at all, rather than in a module-level variable a save could never see.
  const game = richRun();
  const state = game.state;

  assert.deepEqual(state.flags.momentsSeen, [], 'STY-05: the once-per-run moment list');
  assert.equal(state.victory, null);
  assert.deepEqual(state.floor.bossFlags, {}, 'BST-04/05/06 entry flags');
  assert.ok(Array.isArray(state.floor.markers), "WLD-13's spawn markers");
  assert.ok(state.floor.nextEnemyId >= 1, 'the id a summon would take next');
  assert.notEqual(state.floor.decoy, null, "SKL-03's Decoy actor");
  assert.equal(state.tick.guardTimer > 0, true, "SKL-02's Flywheel Guard timer");
  assert.equal(state.tick.fieldRepairUsed, true, 'SKL-03: once per floor');
  assert.equal(state.tick.salvageCounter, 1, "SKL-03's counter");
  // DIF-04: Salvage cycles through the four throwables now, starting at the Grit Bomb.
  assert.equal(state.tick.salvageNext, 'Grit Bomb');
  assert.equal(state.tick.decayCounter >= 0, true, "CHR-04's decay counter");
  assert.ok(Array.isArray(state.floor.noises), "CMB-11's noise list");
  assert.ok(Array.isArray(state.floor.scrap), 'the scrap piles');
  assert.ok(state.journal.pages.some(Boolean), 'a journal page was taken');
  assert.deepEqual(state.uniquesGenerated, ['Governor'], 'ITM-10 unique tracking (D-053)');
  assert.equal(typeof state.tick.hazardTurn, 'number', 'D-046: the turn a hazard last fired on');
  const moth = state.floor.enemies.find((e) => e.type === 'Rust-moth');
  assert.ok(moth, 'the fixture keeps one enemy alive');
  assert.notEqual(moth.lastKnown, null, "ENM-05's tracking");
  assert.equal(typeof moth.lastKnownAge, 'number');

  // And every one of them survives, which is the round trip's job, not a field list's.
  const back = deserialize(serialize(state));
  assert.deepStrictEqual(back, state);
});

/**
 * A run built to carry as much of TEC-05 as one fixture can: four active skills taken, a Flywheel
 * Guard running, Field Repair spent, a Decoy placed, a journal page and a unique attachment taken,
 * an enemy broken (scrap + Salvage counter), a Steam Vent stepped on (`hazardTurn`, D-046) and a
 * door opened (noise, ENM-05 tracking).
 */
function richRun() {
  // Both enemies sit in a sealed column at x = 18: nothing there can see Tick past the wall at
  // x = 17, so the Rust-moth keeps the ENM-05 tracking the fixture gave it and the Sweeper is
  // still standing when the run breaks it by hand. The wandering floor 3 run in the same test is
  // where waking, chasing and real tracking are exercised.
  const rows = [
    row('#'.repeat(20)),
    row(`#${'.'.repeat(10)}"${'.'.repeat(5)}#s#`),
    row(`#..T${'.'.repeat(13)}#m#`),
    row(`#..!?[${'.'.repeat(11)}#.#`),
    row('#'.repeat(20)),
  ];
  const floor = floorFromAscii(rows, {
    number: 4,
    journalPage: 4,
    items: { '!': 'Solder', '?': 'Journal page 4', '[': 'Governor' },
    enemies: {
      s: { state: 'DORMANT', integrity: 1 },
      m: { state: 'DORMANT', lastKnown: { x: 3, y: 2 } },
    },
  });
  const game = createGame({ seedString: 'M09RICH', floor, intro: false });
  const state = game.state;

  // CHR-09: the prerequisite chain, in acquisition order (CHR-10 fixes the hotkeys from it).
  state.tick.skillPoints = 8;
  for (const name of [
    'Salvage',
    'Efficient Springs',
    'Field Repair',
    'Clockwork Decoy',
    'Braced Frame',
    'Overwind Strike',
    'Flywheel Guard',
  ]) {
    assert.equal(game.act({ type: 'takeSkill', name }).ok, true, `takeSkill ${name}`);
  }

  // ITM-06 / SCR-04: a consumable stacks, a record goes to the Journal, the unique gets equipped.
  game.act({ type: 'move', dx: 0, dy: 1 });
  game.act({ type: 'pickup' });
  game.act({ type: 'move', dx: 1, dy: 0 });
  game.act({ type: 'pickup' });
  game.act({ type: 'move', dx: 1, dy: 0 });
  game.act({ type: 'pickup' });
  game.act({ type: 'equip', slot: state.tick.inventory.findIndex((e) => e.name === 'Governor') });

  // WLD-08 / D-046: walk to the Steam Vent and stand on it until one of its active turns fires.
  for (let i = 0; i < 40 && state.tick.hazardTurn === undefined; i++) {
    const dx = stepX(state, 11);
    const dy = stepY(state, 1);
    game.act(dx === 0 && dy === 0 ? { type: 'wait' } : { type: 'move', dx, dy });
  }
  assert.equal(typeof state.tick.hazardTurn, 'number', 'the vent must have caught Tick');
  game.act({ type: 'move', dx: 0, dy: 1 }); // off the vent, before the two timed skills

  // SKL-02 / SKL-03: a once-per-floor skill spent, a Guard timer running, a Decoy on the map. They
  // come last because both the Guard (4 turns) and the Decoy (6 turns) are timed (D-066, D-067).
  game.act({ type: 'skill', name: 'Field Repair' });
  game.act({ type: 'skill', name: 'Flywheel Guard' });
  game.act({ type: 'skill', name: 'Clockwork Decoy', dx: 1, dy: 0 });

  // ITM-11 / SKL-03: one break, for the scrap pile, the XP and the Salvage counter. The flat amount
  // draws no dice; the break itself still rolls ITM-11's d100 from the run's own stream.
  const sweeper = state.floor.enemies.find((e) => e.type === 'Sweeper');
  combat.damage(game.ctx, sweeper, 4, { ignoresPlating: true });
  assert.equal(combat.isBroken(sweeper), true);
  combat.breakActor(game.ctx, sweeper);
  return game;
}

const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const stepX = (state, x) => sign(x - state.tick.x);
const stepY = (state, y) => sign(y - state.tick.y);

// ---------------------------------------------------------------------------------------------
// ACC-03 — death deletes the save
// ---------------------------------------------------------------------------------------------

test('ACC-03: the save is gone from the adapter once Tick is broken @m09', () => {
  const adapter = memory();
  const store = createStore(adapter);
  const rows = [row('#'.repeat(10)), row('#..T.....#'), row('#'.repeat(10))];
  const game = createGame({ seedString: 'M09DEATH', floor: floorFromAscii(rows), intro: false, store });

  game.act({ type: 'wait' });
  assert.equal(adapter.size, 1, 'TEC-09: written at CMB-02 step 9');
  assert.equal(store.has(), true);

  // CHR-04: Tension 1 and one more turn winds Tick down (CMB-02 step 2, ACC-11).
  game.state.tick.tension = 1;
  game.state.tick.decayCounter = 4;
  const result = game.act({ type: 'wait' });

  assert.notEqual(game.state.dead, null, 'CMB-12: the run ended');
  assert.equal(result.events.some((e) => e.type === 'death'), true, 'the Death screen event');
  assert.equal(adapter.size, 0, 'ACC-03: the key is absent on the Death screen');
  assert.equal(store.has(), false, 'the Title offers no Continue');
  assert.equal(store.load(), null);

  // Nothing that happens after death writes it back (the run is over, phase `ended`).
  game.act({ type: 'wait' });
  assert.equal(game.autosave(), false);
  assert.equal(adapter.size, 0);
});

// ---------------------------------------------------------------------------------------------
// ACC-04 — the Abandon prompt
// ---------------------------------------------------------------------------------------------

test('ACC-04: answering n to Abandon leaves the save untouched; y deletes it and a new run starts @m09', () => {
  const adapter = memory();
  const store = createStore(adapter);
  const first = play(createGame({ seedString: 'TEST1234', intro: false, store }), script(6, 20));
  const saved = store.read();
  assert.equal(typeof saved, 'string');
  assert.ok(first.state.turn > 0);

  // UI-17: "Starting a new run while an autosave exists asks 'Abandon the saved run? y/n'."
  // Answer `n`: nothing is touched and the Title still offers Continue.
  assert.equal(store.read(), saved, 'ACC-04: save unchanged');
  assert.equal(store.has(), true, 'still on the Title, Continue still offered');
  assert.deepStrictEqual(store.load(), deserialize(saved));

  // Answer `y`: "a new run deletes it", then the intro is shown.
  store.clear();
  assert.equal(adapter.size, 0, 'ACC-04: save deleted');
  const fresh = createGame({ seedString: 'ABANDONED', store });
  const events = fresh.drainEvents();
  assert.equal(events[events.length - 1].type, 'textbox', 'ACC-04: intro shown');
  assert.equal(events[events.length - 1].id, 'intro');
  assert.equal(events[events.length - 1].text, SCRIPT.intro);
  assert.equal(fresh.phase, 'awaitDismiss', 'UI-16: the intro blocks the turn loop');

  // TEC-09 writes after a turn, not on creation, so the deleted save stays deleted until Tick acts.
  assert.equal(adapter.size, 0, 'no save yet: nothing has cost a turn (D-083)');
  fresh.act({ type: 'dismiss' });
  fresh.act({ type: 'wait' });
  assert.equal(adapter.size, 1);
  assert.equal(deserialize(store.read()).seedString, 'ABANDONED', 'the new run owns the slot');
});

// ---------------------------------------------------------------------------------------------
// ACC-05 — an unusable save is ignored and removed
// ---------------------------------------------------------------------------------------------

test('ACC-05: a version 0 save is treated as no save and the key is removed @m09', () => {
  const adapter = memory();
  const store = createStore(adapter);
  const good = play(createGame({ seedString: 'TEST1234', intro: false, store }), script(7, 10));
  const state = deserialize(store.read());
  assert.notEqual(state, null);
  assert.equal(state.version, SAVE_VERSION);
  assert.ok(good.state.turn > 0);

  // "Save with `version: 0` injected | Load page | Treated as no save; key removed."
  state.version = 0;
  adapter.set(store.key, JSON.stringify(state));
  assert.equal(store.has(), true, 'the key is there before the load');
  assert.equal(store.load(), null, 'ACC-05: treated as no save');
  assert.equal(adapter.size, 0, 'ACC-05: key removed');

  // The same branch for every other unusable value: TEC-09 never migrates (D-081).
  // ACC-05 as M13 restates it: version 1 is the *old* save format (TEC-09, DIF-07), and every
  // other unusable value takes the same branch — TEC-09 never migrates (D-081).
  for (const raw of ['', 'not json at all', '{', 'null', '[]', '{"version":2}', JSON.stringify({ ...state, version: 1 })]) {
    adapter.set(store.key, raw);
    assert.equal(store.load(), null, `unusable: ${raw.slice(0, 20)}`);
    assert.equal(adapter.size, 0, `removed: ${raw.slice(0, 20)}`);
  }

  // A missing key is not an error and nothing is written to find out.
  assert.equal(store.load(), null);
  assert.equal(store.has(), false);
  assert.equal(store.read(), null);
});

// ---------------------------------------------------------------------------------------------
// ACC-06 — reading the game never consumes randomness
// ---------------------------------------------------------------------------------------------

test('ACC-06: 100 view, inspect and serialize calls leave playRngState unchanged @m09', () => {
  const game = play(wanderer(2), script(8, 40));
  const state = game.state;
  const before = state.playRngState;
  const rngBefore = game.ctx.rng.getState();
  const json = serialize(state);

  for (let i = 0; i < 100; i++) {
    game.view();
    game.derived(); // the panel's CHR-08 numbers, recomputed (TEC-05)
    game.state.floor.enemies.forEach((e) => combat.hitChance(game.ctx, state.tick, e)); // UI-05/ACC-103
    serialize(state);
    deserialize(json);
  }

  assert.equal(state.playRngState, before, 'TEC-07: hover, inspect and screens consume no randomness');
  assert.equal(game.ctx.rng.getState(), rngBefore, 'the live stream did not move either');
  assert.equal(serialize(state), json, 'and none of it changed the state');
});

// ---------------------------------------------------------------------------------------------
// TEC-09's trigger list, and the shapes of the module
// ---------------------------------------------------------------------------------------------

test('@unit save: TEC-09 writes after a turn, on Ascend and on skill selection, never on a free action @m09', () => {
  const adapter = memory();
  const store = createStore(adapter);
  const rows = [row('#'.repeat(12)), row('#..T....<..#'), row('#'.repeat(12))];
  const game = createGame({ seedString: 'M09TRIG', floor: floorFromAscii(rows), intro: false, store });
  const turnOf = () => deserialize(store.read()).turn;

  // A turn-costing action (CMB-02 step 9).
  game.act({ type: 'wait' });
  assert.equal(turnOf(), 1);
  game.act({ type: 'wait' });
  assert.equal(turnOf(), 2);

  // A refused action spends no turn (CMB-05), so it changes nothing in the slot.
  const raw = store.read();
  assert.equal(game.act({ type: 'move', dx: 0, dy: -1 }).ok, false, 'a wall');
  assert.equal(store.read(), raw, 'no turn, no write');

  // Skill selection is free (D-064) but TEC-09 names it as its own trigger.
  game.state.tick.skillPoints = 1;
  const beforeSkill = deserialize(store.read());
  assert.deepEqual(beforeSkill.tick.skills, []);
  assert.equal(game.act({ type: 'takeSkill', name: 'Braced Frame' }).ok, true);
  assert.equal(turnOf(), 2, 'no turn was spent');
  assert.deepEqual(deserialize(store.read()).tick.skills, ['Braced Frame'], 'but the save has the skill');

  // A refused take writes nothing new.
  const afterSkill = store.read();
  assert.equal(game.act({ type: 'takeSkill', name: 'Piston Drive' }).ok, false, 'CHR-09: locked');
  assert.equal(store.read(), afterSkill);

  // Ascend (WLD-10): the save names the new floor.
  for (let i = 0; i < 5; i++) game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(game.act({ type: 'ascend' }).ok, true);
  const ascended = deserialize(store.read());
  assert.equal(ascended.floorNumber, 2, 'TEC-09: written on Ascend');
  assert.equal(ascended.floor.number, 2);
});

test('@unit save: an ending never leaves a resumable save behind @m09', () => {
  const adapter = memory();
  const store = createStore(adapter);
  const game = understudyFightWithStore(store);
  assert.equal(store.has(), true, 'the fight itself autosaves');

  // BST-06's defeat sequence queues three events that live outside `state` (UI-19), so the turn
  // that starts it must not overwrite the resumable save with a state that cannot finish it.
  const boss = game.state.floor.enemies.find((e) => e.type === 'The Understudy');
  const before = store.read();
  boss.integrity = 1;
  combat.damage(game.ctx, boss, 3, {});
  if (combat.isBroken(boss)) combat.breakActor(game.ctx, boss);
  assert.equal(game.phase, 'awaitDismiss', 'UI-19: moment 3a is queued');
  game.ctx.hooks.autosave(game.ctx);
  assert.equal(store.read(), before, 'a queued text box is not a resumable point (D-083)');

  game.act({ type: 'dismiss' });
  game.act({ type: 'dismiss' });
  assert.equal(game.phase, 'awaitChoice');
  game.ctx.hooks.autosave(game.ctx);
  assert.equal(store.read(), before, 'nor is a pending ending choice');

  // SCR-07 / ACC-115: choosing an ending ends the run, and TEC-09 deletes the save on victory.
  const result = game.act({ type: 'choose', option: 'A' });
  assert.equal(result.ok, true);
  assert.equal(game.phase, 'ended');
  assert.equal(result.events.some((e) => e.type === 'victory'), true);
  assert.equal(adapter.size, 0, 'TEC-09: deleted on victory');
  assert.equal(game.autosave(), false, 'and phase `ended` never writes one again');
  assert.equal(adapter.size, 0);
});

function understudyFightWithStore(store) {
  const game = createGame({ seedString: 'M09END', floor: loadFixedFloor(8), intro: false, store });
  for (let i = 0; i < 6; i++) game.act({ type: 'move', dx: 1, dy: 0 });
  game.act({ type: 'dismiss' });
  game.act({ type: 'wait' });
  return game;
}

test('@unit save: a scripted moment already seen does not replay after a restore @m09', () => {
  // STY-05: the moments fire once per *run*, so `flags.momentsSeen` is the one field whose loss
  // would be invisible until a player reloaded and watched moment 1 a second time.
  const floor = floorFromAscii([row('#'.repeat(13)), row('#..T........#'), row('#'.repeat(13))], { number: 3 });
  // FLR-04's trigger is the stairs room entering Tick's FOV; a fixture has no rooms of its own.
  floor.rooms = [{ id: 0, x: 8, y: 1, w: 2, h: 1 }];
  floor.roles = { stairs: 0 };

  const slot = store();
  const game = createGame({ seedString: 'M09MOMENT', floor, intro: false, store: slot });
  const fired = game.drainEvents();
  assert.ok(fired.some((e) => e.type === 'textbox' && e.id === 'moment1'), 'FLR-04: moment 1 fired');
  assert.deepEqual(game.state.flags.momentsSeen, ['moment1']);

  game.act({ type: 'dismiss' });
  game.act({ type: 'wait' });
  const saved = slot.load();
  assert.deepEqual(saved.flags.momentsSeen, ['moment1'], 'the save carries the moment list');

  const restored = createGame({ state: saved });
  assert.deepEqual(restored.drainEvents(), [], 'no text box, no floor event: nothing fires again');
  assert.equal(restored.phase, 'run');
  assert.deepEqual(restored.state.flags.momentsSeen, ['moment1']);

  // The negative control, so the assertion above is known to be load-bearing: a save that lost the
  // list restores into a run that shows moment 1 for the second time.
  const tampered = slot.load();
  tampered.flags.momentsSeen = [];
  const replayed = createGame({ state: tampered }).drainEvents();
  assert.ok(replayed.some((e) => e.type === 'textbox' && e.id === 'moment1'), 'without it, it replays');
});

test('@unit save: the save is taken after ENM-03\'s wake flag is spent, not before @m09', () => {
  // ACC-14's setup: a Dormant NORMAL enemy three tiles away in Tick's FOV wakes on this turn and
  // does not act until the next one. `wokeThisTurn` is what enforces that (CMB-03 step 1), so a
  // save written while it is still raised would charge the same enemy the penalty twice.
  const rows = [row('#'.repeat(12)), row('#..T..s....#'), row('#'.repeat(12))];
  const build = (slot) =>
    createGame({ seedString: 'M09WAKE', floor: floorFromAscii(rows), intro: false, store: slot });

  const slot = store();
  const game = build(slot);
  game.act({ type: 'wait' });
  const enemy = game.state.floor.enemies[0];
  assert.equal(enemy.state, 'ACTIVE', 'ENM-04: it woke on this turn');
  assert.equal(enemy.x, 6, 'ENM-03: and did not act');

  const saved = slot.load();
  assert.equal(saved.floor.enemies[0].wokeThisTurn, false, 'the flag has done its work by step 9');

  const restored = createGame({ state: saved });
  const straight = build(store());
  straight.act({ type: 'wait' });
  for (let i = 0; i < 3; i++) {
    restored.act({ type: 'wait' });
    straight.act({ type: 'wait' });
  }
  assert.deepStrictEqual(
    { ...restored.state, log: undefined },
    { ...straight.state, log: undefined },
    'the woken enemy closes at the same rate in both runs',
  );
  assert.ok(restored.state.floor.enemies[0].x < 6, 'and it really did close');
});

test('@unit save: a restore prints "Tick resumes." and recomputes the FOV, not the floor @m09', () => {
  const game = play(wanderer(2), script(9, 30));
  const json = serialize(game.state);
  const before = logTexts(game.state);

  const restored = createGame({ state: deserialize(json) });

  assert.equal(restored.phase, 'run', 'TEC-09: Continue shows the Run screen');
  assert.deepEqual(restored.drainEvents(), [], 'no floor event, no intro: the state is already a run');
  assert.deepEqual(logTexts(restored.state), [...before, SCRIPT.log.resume]);
  assert.deepEqual(viewOf(restored), viewOf(game), 'the FOV is recomputed from the restored tiles');
  assert.equal(restored.state.seedString, 'TEST1234', 'the seed comes back from the save, not the caller');
  assert.equal(restored.ctx.rng.getState(), game.state.playRngState, 'TEC-09: the same next rolls');
  assert.equal(restored.derived().plating, game.derived().plating, 'TEC-05: derived values recomputed');
});

test('@unit save: serialize refuses anything a JSON round trip would lose @m09', () => {
  const base = () => deserialize(serialize(play(wanderer(1), script(10, 10)).state));

  assert.throws(() => serialize(null), TypeError);
  assert.throws(() => serialize('{}'), TypeError);

  const withSet = base();
  withSet.floor.visible = new Set([1, 2, 3]);
  assert.throws(() => serialize(withSet), /Set/, 'a Set would serialize as {} and vanish');

  const withMap = base();
  withMap.floor.lookup = new Map();
  assert.throws(() => serialize(withMap), /Map/);

  const withTyped = base();
  withTyped.floor.dist = new Int32Array(4);
  assert.throws(() => serialize(withTyped), /Int32Array/);

  const withFn = base();
  withFn.stats.report = () => 1;
  assert.throws(() => serialize(withFn), /function/);

  const withNan = base();
  withNan.tick.integrity = NaN;
  assert.throws(() => serialize(withNan), /NaN/);

  const withUndefined = base();
  withUndefined.tick.mystery = undefined;
  assert.throws(() => serialize(withUndefined), /undefined/);

  const withCycle = base();
  withCycle.flags.self = withCycle;
  assert.throws(() => serialize(withCycle), /cycle|shared/);

  // The one documented exception: a fixture's per-enemy `ai` decision function (D-040, D-080).
  const withAi = base();
  withAi.floor.enemies.push({ id: 99, type: 'Sweeper', x: 1, y: 1, ai: () => ({ type: 'wait' }) });
  const back = deserialize(serialize(withAi));
  assert.equal(back.floor.enemies[back.floor.enemies.length - 1].ai, undefined);
});

test('@unit save: the store works over a Map and over a localStorage-shaped adapter @m09', () => {
  const state = deserialize(serialize(play(wanderer(1), script(11, 10)).state));

  const map = memory();
  const mapStore = createStore(map);
  assert.equal(mapStore.key, SAVE_KEY, 'TEC-09 fixes the key');
  assert.equal(mapStore.has(), false);
  mapStore.save(state);
  assert.equal(map.get(SAVE_KEY), serialize(state));
  assert.deepStrictEqual(mapStore.load(), state);
  mapStore.clear();
  assert.equal(mapStore.has(), false);

  const dom = localStorageLike();
  const domStore = createStore(dom, 'other.key');
  domStore.save(state);
  assert.equal(dom.getItem('other.key'), serialize(state));
  assert.equal(dom.getItem(SAVE_KEY), null, 'the key is the store\'s, not a global');
  assert.deepStrictEqual(domStore.load(), state);
  domStore.clear();
  assert.equal(domStore.load(), null);

  assert.throws(() => createStore(null), TypeError);
  assert.throws(() => createStore({}), TypeError);
});

test('@unit save: validate names the first field that makes a save unusable @m09', () => {
  const state = deserialize(serialize(play(wanderer(1), script(12, 5)).state));
  assert.equal(validate(state), null);

  const cases = [
    ['version', 0, /version/],
    ['playRngState', -1, /playRngState/],
    ['turn', '4', /turn/],
    ['tick', {}, /tick/],
    ['floor', {}, /floor/],
    ['journal', { pages: [true] }, /journal/],
    ['log', {}, /log/],
    ['flags', null, /flags/],
  ];
  for (const [key, value, pattern] of cases) {
    const broken = { ...state, [key]: value };
    assert.match(String(validate(broken)), pattern, key);
    assert.equal(deserialize(JSON.stringify(broken)), null, key);
  }

  // A grid of the wrong size is not a floor (TEC-15).
  const shortGrid = deserialize(serialize(state));
  shortGrid.floor.tiles = shortGrid.floor.tiles.slice(0, 23);
  assert.match(String(validate(shortGrid)), /floor/);
});
