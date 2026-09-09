// ASCII fixture maps (PLN-04): `floorFromAscii(rows, opts)` builds a Floor object of the shape
// `gen.js` produces, so `engine.createGame({ floor })` and `CH.loadFixture` can load it.
//
// Combat, AI, item and skill tests across M04-M08 use fixtures rather than the generator, so the
// map, the actors and the RNG are all exact.
//
// ## Legend (WLD-13's, plus the characters the generator's tiles need)
//
//   #  Wall                     .  Floor                   +  Closed door      '  Open door
//   <  Up-stairs                &  Winding Station          T  Tick's start (WLD-13's `@` too)
//   ^  Grinding Gear            "  Steam Vent               ~  Pendulum Sweep
//   E  Escapement wheel (`O` too)                           H  Chair
//
// Two of WLD-13's terrain letters collide with a `22-bestiary.md` glyph, and the enemy wins,
// because placing actors is what a fixture is for: WLD-13's `C` (chair) is The Conductor here and
// its drawn glyph `h` is the Spring-Hound, so the chair is written `H` instead, and the Escapement
// wheel takes both WLD-13's `E` and its drawn `O` (D-048). WLD-13's `U` and `1`-`9` need no ruling:
// on floor 8 those tiles *are* the actors they mark.
//
//   letters   an enemy, by its `22-bestiary.md` glyph (`s` Sweeper, `m` Rust-moth, `k` Stoker,
//             `g` Gear-Golem, `U` The Understudy, ...). `opts.enemies[letter]` overrides every
//             enemy written with that letter.
//   1-9       an enemy defined entirely by `opts.enemies['1']`, which must name a `type`. Use
//             these when two enemies of the same type need different states, ids or AI.
//   ! ) } [ * { ?   an item, named by `opts.items[char]` (a name, or `{name, count}`).
//
// ## Enemy options (`opts.enemies[char]`)
//
//   { type, state: 'DORMANT'|'ACTIVE'|'RETURNING', statuses: {Burning: 3}, integrity: 4,
//     homeRoom, isGuard, isBoss, lastKnown: {x, y},
//     ai: (enemy, state, ctx) => action }
//
// The `ai` override is the important one: `turn.js` prefers it over `src/ai.js`, so a test that
// needs an enemy to attack keeps working when M06 replaces the AI module in place.
//
// Enemy ids are assigned in reading order of the map (top-left to bottom-right), which is the id
// order CMB-03 resolves the enemy phase in.

import { W, H, chebyshev } from '../../src/grid.js';
import { TILE } from '../../src/tiles.js';
import { ENEMIES } from '../../data/enemies.js';
import { createGame } from '../../src/engine.js';

/** Terrain characters -> tile numbers. */
const TERRAIN = Object.freeze({
  '#': TILE.WALL,
  '.': TILE.FLOOR,
  '+': TILE.DOOR_CLOSED,
  "'": TILE.DOOR_OPEN,
  '<': TILE.STAIRS_UP,
  '&': TILE.STATION,
  '^': TILE.GRINDING_GEAR,
  '"': TILE.STEAM_VENT,
  '~': TILE.PENDULUM_SWEEP,
  O: TILE.ESCAPEMENT,
  E: TILE.ESCAPEMENT,
  H: TILE.CHAIR,
  T: TILE.FLOOR,
  '@': TILE.FLOOR,
});

/** The characters that mark Tick's start tile, whose terrain is always Floor beneath (WLD-13). */
const START_CHARS = new Set(['T', '@']);

/** Hazard tiles -> the `HAZARDS` key the floor record carries. */
const HAZARD_KIND = Object.freeze({
  [TILE.GRINDING_GEAR]: 'GRINDING_GEAR',
  [TILE.STEAM_VENT]: 'STEAM_VENT',
  [TILE.PENDULUM_SWEEP]: 'PENDULUM_SWEEP',
});

const ITEM_GLYPHS = new Set(['!', ')', '}', '[', '*', '{', '?']);

/** Enemy glyph -> type name, from `data/enemies.js` (UI-07: every enemy has a distinct glyph). */
const ENEMY_BY_GLYPH = new Map(ENEMIES.map((e) => [e.glyph, e.name]));

/**
 * Build a Floor from ASCII rows.
 *
 * @param {string[]} rows the map, top row first; short rows and missing rows are padded with Wall
 * @param {{number?: number, name?: string, shortName?: string, journalPage?: number,
 *          stationSpent?: boolean, enemies?: object, items?: object}} [opts]
 * @returns {object} a Floor object (`gen.js`'s shape) ready for `createGame({ floor })`
 */
export function floorFromAscii(rows, opts = {}) {
  const enemyOpts = opts.enemies || {};
  const itemNames = opts.items || {};

  const tiles = [];
  for (let y = 0; y < H; y++) tiles.push(new Array(W).fill(TILE.WALL));

  const spawns = [];
  const itemRecords = [];
  const hazards = [];
  let start = null;

  for (let y = 0; y < rows.length && y < H; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length && x < W; x++) {
      const ch = row[x];
      if (ch === ' ') continue;

      if (Object.prototype.hasOwnProperty.call(TERRAIN, ch)) {
        tiles[y][x] = TERRAIN[ch];
        if (START_CHARS.has(ch)) start = { x, y };
        const kind = HAZARD_KIND[tiles[y][x]];
        if (kind) hazards.push({ kind, x, y });
        continue;
      }

      if (ITEM_GLYPHS.has(ch)) {
        const spec = itemNames[ch];
        if (!spec) throw new RangeError(`floorFromAscii: no item named for '${ch}' in opts.items`);
        const record = typeof spec === 'string' ? { name: spec, count: 1 } : { name: spec.name, count: spec.count || 1 };
        tiles[y][x] = TILE.FLOOR;
        itemRecords.push({ name: record.name, count: record.count, x, y, source: 'fixture' });
        continue;
      }

      // Enemies: a bestiary glyph, or a digit whose options name the type.
      tiles[y][x] = TILE.FLOOR;
      const override = enemyOpts[ch] || {};
      const type = override.type || ENEMY_BY_GLYPH.get(ch);
      if (!type) throw new RangeError(`floorFromAscii: '${ch}' is neither terrain, an item glyph, nor an enemy`);
      spawns.push(
        Object.assign({ homeRoom: -1, isGuard: false, isBoss: false, state: 'DORMANT' }, override, {
          type,
          x,
          y,
        }),
      );
      continue;
    }
  }

  if (!start) throw new Error("floorFromAscii: the map has no 'T' or '@' (Tick's start tile)");

  return {
    number: opts.number === undefined ? 1 : opts.number,
    name: opts.name === undefined ? 'The Fixture' : opts.name,
    shortName: opts.shortName === undefined ? 'Fixture' : opts.shortName,
    tiles,
    rooms: [],
    roles: {},
    features: { start, stairs: null, station: null, journal: null, cache: [] },
    stationSpent: opts.stationSpent === true,
    items: itemRecords,
    spawns,
    hazards,
    start,
    journalPage: opts.journalPage === undefined ? 1 : opts.journalPage,
    retries: 0,
    seed: 0,
  };
}

/**
 * A game on a fixture map, with the SCR-02 intro suppressed so `phase` is `run` from the start.
 *
 * @param {string[]} rows
 * @param {object} [opts] every `floorFromAscii` option, plus `seedString` and `rng`
 */
export function fixtureGame(rows, opts = {}) {
  return createGame({
    seedString: opts.seedString === undefined ? 'FIXTURE' : opts.seedString,
    rng: opts.rng,
    floor: floorFromAscii(rows, opts),
    intro: opts.intro === undefined ? false : opts.intro,
  });
}

// ---------------------------------------------------------------------------------------------
// Scripted RNG helpers (PLN-04, R6)
// ---------------------------------------------------------------------------------------------

/**
 * The `queueRng` float that makes `int(rng, 1, sides)` return exactly `value`.
 * `int` is `lo + floor(next() * (hi - lo + 1))`, so the midpoint of the value's band is exact.
 */
export function die(value, sides) {
  if (!(value >= 1 && value <= sides)) throw new RangeError(`die: ${value} is not on a d${sides}`);
  return (value - 0.5) / sides;
}

/** The `queueRng` float for a `d100` hit roll of `value` (CMB-06 step 3). */
export function d100(value) {
  return die(value, 100);
}

/**
 * A spare draw for the ITM-11 drop roll M05 adds to every enemy break. High enough that a `d100`
 * from it is 100, which no `dropChance` in `22-bestiary.md` reaches, so the drop table is never
 * rolled and the rest of a scripted sequence stays valid.
 */
export const DROP_ROLL = d100(100);

// ---------------------------------------------------------------------------------------------
// Test AIs (the fixture `ai` override)
// ---------------------------------------------------------------------------------------------

/** Never acts. Use it for an Active enemy that must exist without disturbing the turn. */
export function aiWait() {
  return { type: 'wait' };
}

/** Attacks Tick whenever adjacent, and otherwise waits — the "always attacks" AI of ACC-12/13. */
export function aiAttackAdjacent(enemy, state) {
  const tick = state.tick;
  if (chebyshev(enemy.x, enemy.y, tick.x, tick.y) <= 1) {
    return { type: 'melee', x: tick.x, y: tick.y };
  }
  return { type: 'wait' };
}

/** Records every action it is asked for on `enemy.actionLog`, then waits (order assertions). */
export function aiRecord(enemy, state) {
  if (!enemy.actionLog) enemy.actionLog = [];
  enemy.actionLog.push(state.turn);
  return { type: 'wait' };
}

/** Steps one tile toward Tick in a straight line, or attacks when adjacent. */
export function aiChase(enemy, state) {
  const tick = state.tick;
  if (chebyshev(enemy.x, enemy.y, tick.x, tick.y) <= 1) return { type: 'melee', x: tick.x, y: tick.y };
  return { type: 'move', x: enemy.x + Math.sign(tick.x - enemy.x), y: enemy.y + Math.sign(tick.y - enemy.y) };
}
