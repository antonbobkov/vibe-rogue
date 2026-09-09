// Tile types, the two terrain predicates, and the hazard configuration table (WLD-02, WLD-08).
//
// Tiles are small integers so a floor is a dense grid of numbers that serializes to JSON without
// help (TEC-05, TEC-09). Nothing here touches the DOM (PLN-02 R2) and nothing here draws: the
// glyphs and colors live on each entry only so that `render.js` (M10) has one place to read them.
//
// The three hazards of WLD-08 are two mechanisms — CONSTANT and CYCLIC — and three configurations.
// `HAZARDS[kind]` carries every number the turn loop (M04) needs, so the rules stay in the spec and
// the data rather than in a switch.

/** The tile types of WLD-02. Values are stable; the grid stores these numbers. */
export const TILE = Object.freeze({
  WALL: 0,
  FLOOR: 1,
  DOOR_CLOSED: 2,
  DOOR_OPEN: 3,
  STAIRS_UP: 4,
  STATION: 5,
  GRINDING_GEAR: 6,
  STEAM_VENT: 7,
  PENDULUM_SWEEP: 8,
  CHAIR: 9,
  ESCAPEMENT: 10,
});

/** Tile number -> the name WLD-02 gives it, for messages and tests. */
export const TILE_NAME = Object.freeze({
  [TILE.WALL]: 'Wall',
  [TILE.FLOOR]: 'Floor',
  [TILE.DOOR_CLOSED]: 'Closed door',
  [TILE.DOOR_OPEN]: 'Open door',
  [TILE.STAIRS_UP]: 'Up-stairs',
  [TILE.STATION]: 'Winding Station',
  [TILE.GRINDING_GEAR]: 'Grinding Gear',
  [TILE.STEAM_VENT]: 'Steam Vent',
  [TILE.PENDULUM_SWEEP]: 'Pendulum Sweep',
  [TILE.CHAIR]: 'Chair',
  [TILE.ESCAPEMENT]: 'Escapement wheel',
});

/** Tile number -> the glyph of WLD-02 (UI-07 owns colors). */
export const TILE_GLYPH = Object.freeze({
  [TILE.WALL]: '#',
  [TILE.FLOOR]: '.',
  [TILE.DOOR_CLOSED]: '+',
  [TILE.DOOR_OPEN]: "'",
  [TILE.STAIRS_UP]: '<',
  [TILE.STATION]: '&',
  [TILE.GRINDING_GEAR]: '^',
  [TILE.STEAM_VENT]: '^',
  [TILE.PENDULUM_SWEEP]: '~',
  [TILE.CHAIR]: 'h',
  [TILE.ESCAPEMENT]: 'O',
});

const WALKABLE = new Set([
  TILE.FLOOR,
  TILE.DOOR_OPEN,
  TILE.STAIRS_UP,
  TILE.STATION,
  TILE.GRINDING_GEAR,
  TILE.STEAM_VENT,
  TILE.PENDULUM_SWEEP,
]);

const BLOCKS_SIGHT = new Set([TILE.WALL, TILE.DOOR_CLOSED, TILE.ESCAPEMENT]);

const HAZARD_TILES = new Set([TILE.GRINDING_GEAR, TILE.STEAM_VENT, TILE.PENDULUM_SWEEP]);

const DOOR_TILES = new Set([TILE.DOOR_CLOSED, TILE.DOOR_OPEN]);

/** Can an actor stand on this tile? A closed door is not walkable — bumping it opens it (WLD-02). */
export function walkable(t) {
  return WALKABLE.has(t);
}

/** Does this tile stop the shadowcast? Walls, closed doors and the Escapement wheel (WLD-05). */
export function blocksSight(t) {
  return BLOCKS_SIGHT.has(t);
}

/** Is this one of the three hazard tiles of WLD-08? */
export function isHazardTile(t) {
  return HAZARD_TILES.has(t);
}

/** Open or closed door (WLD-06, ENM-08's diagonal rule). */
export function isDoor(t) {
  return DOOR_TILES.has(t);
}

/**
 * The three hazard configurations of WLD-08.
 *
 *   mechanism  'CONSTANT' (always active) or 'CYCLIC'
 *   period     the cycle length; `activePhases` are the values of `turn mod period` that are active
 *   triggers   'ENTER' (moving onto it, never knockback) and/or 'STANDING' (CMB-02 steps 4 and 7)
 *   damage     always ignores Plating (WLD-08)
 *   status     the status the hit applies, or null
 *   noise      the noise the hit makes (CMB-11); 0 for the silent hazards
 *
 * `tile` is the tile number the grid stores, so a hazard record and its terrain never disagree.
 */
export const HAZARDS = Object.freeze({
  GRINDING_GEAR: Object.freeze({
    kind: 'GRINDING_GEAR',
    name: 'Grinding Gear',
    tile: TILE.GRINDING_GEAR,
    mechanism: 'CONSTANT',
    period: 1,
    activePhases: Object.freeze([0]),
    triggers: Object.freeze(['ENTER']),
    damage: 3,
    ignoresPlating: true,
    status: null,
    noise: 6,
    floors: Object.freeze([2, 7]),
  }),
  STEAM_VENT: Object.freeze({
    kind: 'STEAM_VENT',
    name: 'Steam Vent',
    tile: TILE.STEAM_VENT,
    mechanism: 'CYCLIC',
    period: 6,
    activePhases: Object.freeze([0, 1]),
    triggers: Object.freeze(['ENTER', 'STANDING']),
    damage: 4,
    ignoresPlating: true,
    status: Object.freeze({ name: 'Burning', duration: 2 }),
    noise: 0,
    floors: Object.freeze([4]),
  }),
  PENDULUM_SWEEP: Object.freeze({
    kind: 'PENDULUM_SWEEP',
    name: 'Pendulum Sweep',
    tile: TILE.PENDULUM_SWEEP,
    mechanism: 'CYCLIC',
    period: 8,
    activePhases: Object.freeze([0]),
    triggers: Object.freeze(['ENTER', 'STANDING']),
    damage: 6,
    ignoresPlating: true,
    status: Object.freeze({ name: 'Stunned', duration: 1 }),
    noise: 0,
    floors: Object.freeze([7]),
  }),
});

/** Hazard kind -> tile number, and back. */
export const HAZARD_TILE_OF = Object.freeze({
  GRINDING_GEAR: TILE.GRINDING_GEAR,
  STEAM_VENT: TILE.STEAM_VENT,
  PENDULUM_SWEEP: TILE.PENDULUM_SWEEP,
});

/**
 * Is a hazard of this kind active on the given global turn (WLD-08)? Constant hazards are always
 * active; cyclic ones are active when `turn mod period` is one of their `activePhases`.
 */
export function hazardActive(kind, turn) {
  const cfg = HAZARDS[kind];
  if (!cfg) throw new RangeError(`hazardActive: unknown hazard '${kind}'`);
  if (cfg.mechanism === 'CONSTANT') return true;
  const phase = ((turn % cfg.period) + cfg.period) % cfg.period;
  return cfg.activePhases.includes(phase);
}

/**
 * Should this hazard be drawn in the warning color (WLD-08: "the turn *before* they become
 * active")? Constant hazards never warn.
 */
export function hazardWarning(kind, turn) {
  const cfg = HAZARDS[kind];
  if (!cfg) throw new RangeError(`hazardWarning: unknown hazard '${kind}'`);
  if (cfg.mechanism === 'CONSTANT') return false;
  return !hazardActive(kind, turn) && hazardActive(kind, turn + 1);
}

/**
 * Turns until this hazard is next active, for the UI-06 panel readout: 0 while it is active.
 */
export function turnsUntilActive(kind, turn) {
  const cfg = HAZARDS[kind];
  if (!cfg) throw new RangeError(`turnsUntilActive: unknown hazard '${kind}'`);
  if (hazardActive(kind, turn)) return 0;
  for (let d = 1; d <= cfg.period; d++) if (hazardActive(kind, turn + d)) return d;
  return 0; // unreachable: every cyclic hazard has at least one active phase
}
