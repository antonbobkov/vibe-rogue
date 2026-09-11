// The floor generator: WLD-11 step by step for floors 1-7, and WLD-13's loader for floor 8.
//
// Every random choice goes through one `floorRng = mulberry32(fnv1a(seedString + ':floor:' + n))`
// (TEC-07) in the order WLD-11 writes, so the same seed and floor number always produce the same
// map. A floor that fails WLD-11 step 10 is regenerated from `floorSeed + 1`, up to 50 times
// (WLD-10); the number of retries it took is kept on the floor for the S1 sim (M11).
//
// M03 emits *records*, not instances: `spawns[]` says which enemy type stands where, and M04 turns
// those into actors through `actors.createEnemy`. Likewise `items[]` names items and positions and
// M05's `items.placeFloorItems` realises them.
//
// Draw-order conventions (D-030): a "random interior tile" with no stated retry budget is drawn as
// one index into the candidate list, in reading order (`pickFrom`); where WLD-11 states a retry
// budget (steps 8 and 9, FLR-01's boss) the draws are rejection samples of `(x, y)` — x first, then
// y — exactly as the spec's "retry up to N times, then ..." describes.

import { W, H, idx, inBounds, chebyshev, bfs } from './grid.js';
import { computeFov } from './fov.js';
import { mulberry32, fnv1a, int, chance, weighted } from './rng.js';
import { TILE, walkable, blocksSight, isHazardTile, HAZARD_TILE_OF } from './tiles.js';
import { FLOORS } from '../data/floors.js';
import { ITEMS_BY_NAME } from '../data/items.js';
import { ENEMIES_BY_NAME } from '../data/enemies.js';
import { TUNING } from '../data/tuning.js';
import { canBeElite } from './actors.js';

/** The Pendulum band of FLR-08: every Floor or door tile in these columns becomes a Sweep tile. */
export const BAND_X0 = 28;
export const BAND_X1 = 31;

/** WLD-10: the first attempt plus 50 regenerations. */
const MAX_REGENERATIONS = 50;
/** WLD-11 step 2. */
const ROOM_ATTEMPTS = 300;
/** WLD-11 step 7. */
const HAZARD_DRAWS = 100;
/** WLD-11 steps 8 and 9. */
const PLACE_RETRIES = 50;
/** WLD-12's visibility fix. */
const VISIBILITY_RETRIES = 20;
/** WLD-05's radius, used for the WLD-12 check from the start tile. */
const FOV_RADIUS = 8;

const EQUIPMENT_CATEGORIES = new Set(['melee', 'ranged', 'plating', 'attachment']);

/** DIF-15 knob 1: the two consumables whose table weights `tuning.consumableWeight` scales. */
const SCALED_ITEMS = new Set(['Solder', 'Spring-Key']);

/**
 * ITM-10 / DIF-15 — a loot table with the Solder and Spring-Key weights scaled by
 * `tuning.consumableWeight` (rounded, never below 1). At 100 the table is returned unchanged, and
 * the roll costs exactly one draw either way, so a seed's other choices do not move when the knob
 * does (TEC-07).
 */
function scaledTable(table, tuning) {
  const percent = tuning.consumableWeight;
  if (percent === 100) return table;
  return table.map((entry) =>
    SCALED_ITEMS.has(entry[0]) ? [entry[0], Math.max(1, Math.round((entry[1] * percent) / 100))] : entry,
  );
}

/** `floorSeed = fnv1a(seedString + ':floor:' + n)` (TEC-07, ACC-80). */
export function floorSeed(seedString, n) {
  return fnv1a(`${seedString}:floor:${n}`);
}

/**
 * Generate floor `n` of the run seeded by `seedString` (WLD-11, WLD-10).
 *
 * @param {string} seedString the run seed exactly as TEC-07 spells it
 * @param {number} n floor number 1-8; floor 8 is loaded from data (WLD-13)
 * @param {{uniques?: string[]}} [options] unique item names already generated this run (ITM-10)
 * @returns {object} the Floor described at the bottom of this file
 */
export function generateFloor(seedString, n, options = {}) {
  const def = FLOORS[n];
  if (!def) throw new RangeError(`generateFloor: no floor ${n} (FLOORS is 1-indexed, 1..8)`);
  if (def.fixedMap) return loadFixedFloor(n);

  const base = floorSeed(seedString, n);
  const uniques = new Set(options.uniques || []);
  const tuning = options.tuning || TUNING;
  for (let retries = 0; retries <= MAX_REGENERATIONS; retries++) {
    const rng = mulberry32((base + retries) >>> 0);
    const floor = attempt(def, rng, new Set(uniques), tuning);
    if (floor) {
      floor.retries = retries;
      floor.seed = (base + retries) >>> 0;
      return floor;
    }
  }
  throw new Error(
    `generateFloor: floor ${n} of seed "${seedString}" failed validation ${MAX_REGENERATIONS + 1} times (WLD-10)`,
  );
}

// ---------------------------------------------------------------------------------------------
// One generation attempt: WLD-11 steps 1-10. Returns null when step 10 fails.
// ---------------------------------------------------------------------------------------------

function attempt(def, rng, uniques, tuning = TUNING) {
  const n = def.number;
  const hasBand = def.hazards.some((h) => h.kind === 'PENDULUM_BAND');

  // --- Step 1: fill with Wall (TILE.WALL is 0, so a fresh array is already filled). ------------
  const tiles = new Uint8Array(W * H);
  const roomOf = new Int16Array(W * H).fill(-1);

  // --- Step 2: rooms --------------------------------------------------------------------------
  const rooms = carveRooms(def, rng, tiles, roomOf);
  if (rooms.length < 5) return null;

  // --- Steps 3 and 4: spanning corridors, extra corridors, then WLD-06's door rule ------------
  carveCorridors(def, rng, tiles, roomOf, rooms);
  applyDoorAdjacencyRule(tiles);

  // --- FLR-08: the Pendulum band replaces every Floor/door tile in columns 28..31 -------------
  const hazards = [];
  if (hasBand) {
    for (let y = 0; y < H; y++) {
      for (let x = BAND_X0; x <= BAND_X1; x++) {
        const i = y * W + x;
        if (tiles[i] === TILE.FLOOR || tiles[i] === TILE.DOOR_CLOSED) {
          tiles[i] = TILE.PENDULUM_SWEEP;
          hazards.push({ kind: 'PENDULUM_SWEEP', x, y });
        }
      }
    }
  }

  // --- Step 5: room roles ---------------------------------------------------------------------
  const roles = assignRoles(rng, tiles, rooms, roomOf);
  if (!roles) return null;
  const dist = roles.dist;
  const startRoom = rooms[roles.start];

  // --- WLD-15 (DIF-12): every way into the cache room becomes a Wound Lock ---------------------
  // WLD-11 states the rule at step 4, but the cache role is only known after step 5, so it is
  // applied here — before the features, the hazards and the items, none of which may land on a
  // boundary tile anyway (D-111).
  lockCacheRoom(tiles, roomOf, rooms[roles.cache]);

  // --- Step 6: features -----------------------------------------------------------------------
  const start = { x: startRoom.cx, y: startRoom.cy };
  if (!featureTileAllowed(hasBand, start.x)) return null;

  const features = { start, stairs: null, station: null, journal: null, cache: [] };
  const featureAt = new Uint8Array(W * H);
  const markFeature = (p) => {
    featureAt[p.y * W + p.x] = 1;
  };
  markFeature(start);

  const items = [];
  const itemAt = new Uint8Array(W * H);

  // Stairs: a random interior tile of the stairs room.
  const stairsCands = interiorTiles(rooms[roles.stairs], hasBand, tiles, featureAt);
  if (stairsCands.length === 0) return null;
  features.stairs = pickFrom(rng, stairsCands);
  tiles[features.stairs.y * W + features.stairs.x] = TILE.STAIRS_UP;
  markFeature(features.stairs);

  // Station: a random interior tile of the station room orthogonally adjacent to a wall.
  // On floor 1 the station is the start tile itself, already spent (WLD-07, CHR-01, ACC-81).
  let stationSpent = false;
  if (n === 1) {
    tiles[start.y * W + start.x] = TILE.STATION;
    features.station = { x: start.x, y: start.y };
    stationSpent = true;
  } else {
    const stationCands = interiorTiles(rooms[roles.station], hasBand, tiles, featureAt).filter((p) =>
      orthogonallyTouchesWall(tiles, p.x, p.y),
    );
    if (stationCands.length === 0) return null;
    features.station = pickFrom(rng, stationCands);
    tiles[features.station.y * W + features.station.x] = TILE.STATION;
    markFeature(features.station);
  }

  // Journal page: a random interior tile of the journal room (WLD-07); it is an item on the map.
  const journalCands = interiorTiles(rooms[roles.journal], hasBand, tiles, featureAt);
  if (journalCands.length === 0) return null;
  const journalTile = pickFrom(rng, journalCands);
  features.journal = { x: journalTile.x, y: journalTile.y, page: def.journalPage };
  markFeature(journalTile);
  addItem(items, itemAt, `Journal page ${def.journalPage}`, journalTile, 'journal');

  // Cache: 2-3 distinct interior tiles of the cache room, rolled from the cache table (ITM-10).
  const generatedEquipment = new Set();
  const cacheCount = int(rng, def.cacheCount[0], def.cacheCount[1]);
  let cacheCands = interiorTiles(rooms[roles.cache], hasBand, tiles, featureAt);
  for (let k = 0; k < cacheCount; k++) {
    if (cacheCands.length === 0) break;
    const table = k === 0 && def.cacheFirstRollTable ? def.cacheFirstRollTable : def.cacheTable;
    const name = rollItem(rng, scaledTable(table, tuning), generatedEquipment, uniques);
    const tile = pickFrom(rng, cacheCands);
    cacheCands = cacheCands.filter((p) => p.x !== tile.x || p.y !== tile.y);
    features.cache.push({ x: tile.x, y: tile.y });
    markFeature(tile);
    addItem(items, itemAt, name, tile, 'cache');
  }
  // FLR-07: floor 6's cache also holds the Understudy Blueprint, on an additional tile.
  for (const extra of def.cacheExtra || []) {
    if (cacheCands.length === 0) break;
    const tile = pickFrom(rng, cacheCands);
    cacheCands = cacheCands.filter((p) => p.x !== tile.x || p.y !== tile.y);
    features.cache.push({ x: tile.x, y: tile.y });
    markFeature(tile);
    addItem(items, itemAt, extra, tile, 'cache');
  }

  // --- Step 7: hazards ------------------------------------------------------------------------
  placeHazards(def, rng, tiles, roomOf, rooms, roles, featureAt, hazards);

  // --- Step 8: floor items --------------------------------------------------------------------
  const spawnRooms = rooms.filter((r) => r.id !== roles.start);
  const floorTable = scaledTable(def.floorTable, tuning);
  for (let k = 0; k < def.itemCount; k++) {
    const name = rollItem(rng, floorTable, generatedEquipment, uniques);
    let placed = null;
    for (let t = 0; t < PLACE_RETRIES && !placed; t++) {
      const room = spawnRooms[int(rng, 0, spawnRooms.length - 1)];
      const p = pickInterior(rng, room);
      const i = p.y * W + p.x;
      if (tiles[i] === TILE.FLOOR && !featureAt[i] && !itemAt[i]) placed = p;
    }
    if (placed) addItem(items, itemAt, name, placed, 'floor');
  }

  // --- Step 9: enemies ------------------------------------------------------------------------
  const spawns = [];
  const occupied = new Uint8Array(W * H);
  const freeForActor = (i) => tiles[i] === TILE.FLOOR && !featureAt[i] && !occupied[i];

  for (const entry of def.spawns) {
    if (entry.pack) {
      const type = ENEMIES_BY_NAME[entry.pack];
      if (!type) throw new RangeError(`gen: floor ${n} spawns unknown enemy '${entry.pack}'`);
      const range = entry.size || type.packSize || [1, 1];
      const size = int(rng, range[0], range[1]);
      const first = placeEnemy(rng, spawnRooms, dist, freeForActor);
      if (!first) continue;
      occupied[first.p.y * W + first.p.x] = 1;
      spawns.push(spawnRecord(entry.pack, first.p, first.room.id, { pack: true }));
      for (let m = 1; m < size; m++) {
        const near = interiorTilesOf(first.room).filter(
          (p) => freeForActor(p.y * W + p.x) && chebyshev(first.p.x, first.p.y, p.x, p.y) <= 2,
        );
        const pool = near.length > 0 ? near : interiorTilesOf(first.room).filter((p) => freeForActor(p.y * W + p.x));
        if (pool.length === 0) break;
        const p = pickFrom(rng, pool);
        occupied[p.y * W + p.x] = 1;
        spawns.push(spawnRecord(entry.pack, p, first.room.id, { pack: true }));
      }
    } else {
      if (!ENEMIES_BY_NAME[entry.type]) throw new RangeError(`gen: floor ${n} spawns unknown enemy '${entry.type}'`);
      for (let c = 0; c < entry.count; c++) {
        const spot = placeEnemy(rng, spawnRooms, dist, freeForActor);
        if (!spot) continue;
        occupied[spot.p.y * W + spot.p.x] = 1;
        // ENM-12 (DIF-08): every regular, non-pack instance rolls for Overwound on the floor RNG,
        // so the elites of a seed are as reproducible as its map (ACC-157).
        const elite = canBeElite({ type: entry.type }) && chance(rng, tuning.eliteChance);
        spawns.push(spawnRecord(entry.type, spot.p, spot.room.id, { elite }));
      }
    }
  }

  // The cache guard, then the boss (WLD-11 step 9, FLR-01).
  if (def.guard) {
    const room = rooms[roles.cache];
    const p = placeInRoom(rng, room, freeForActor);
    if (p) {
      occupied[p.y * W + p.x] = 1;
      spawns.push(spawnRecord(def.guard, p, room.id, { isGuard: true }));
    }
  }
  if (def.boss && def.boss.room === 'stairs') {
    const room = rooms[roles.stairs];
    const p = placeInRoom(rng, room, freeForActor);
    if (p) {
      occupied[p.y * W + p.x] = 1;
      spawns.push(spawnRecord(def.boss.type, p, room.id, { isBoss: true }));
    }
  }

  // WLD-12: nothing an arriving Tick can already see.
  hideVisibleSpawns(rng, tiles, rooms, roles, spawns, occupied, freeForActor, start, spawnRooms);

  // --- Step 10: validate ----------------------------------------------------------------------
  if (!validate(def, rooms, features, hazards, hasBand)) return null;
  // WLD-15 (DIF-12): a Wound Lock is a wall to anyone who will not pay, and a corridor that runs
  // along the cache room's edge can be locked with it. The floor is only valid if the stairs, the
  // station and the journal page are all still reachable *without* opening one — the cache is the
  // only thing a lock is allowed to shut away (D-111).
  if (!reachableWithoutLocks(tiles, start, [features.stairs, features.station, features.journal])) {
    return null;
  }

  return {
    number: n,
    name: def.name,
    shortName: def.shortName,
    tiles: toRows(tiles),
    rooms: rooms.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy })),
    roles: { start: roles.start, stairs: roles.stairs, station: roles.station, cache: roles.cache, journal: roles.journal },
    features,
    stationSpent,
    items,
    spawns,
    hazards,
    start: { x: start.x, y: start.y },
    journalPage: def.journalPage,
    retries: 0,
    seed: 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Step 2 - rooms
// ---------------------------------------------------------------------------------------------

function carveRooms(def, rng, tiles, roomOf) {
  const rooms = [];
  for (let a = 0; a < ROOM_ATTEMPTS && rooms.length < def.roomTarget; a++) {
    const w = int(rng, 4, 10);
    const h = int(rng, 3, 7);
    const x = int(rng, 1, 58 - w);
    const y = int(rng, 1, 22 - h);
    if (!fits(roomOf, x, y, w, h)) continue;
    const id = rooms.length;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const i = yy * W + xx;
        tiles[i] = TILE.FLOOR;
        roomOf[i] = id;
      }
    }
    rooms.push({
      id,
      x,
      y,
      w,
      h,
      cx: Math.floor((x + x + w - 1) / 2),
      cy: Math.floor((y + y + h - 1) / 2),
    });
  }
  return rooms;
}

/** The rectangle expanded by 2 in each direction must contain no existing room interior tile. */
function fits(roomOf, x, y, w, h) {
  for (let yy = y - 2; yy <= y + h + 1; yy++) {
    if (yy < 0 || yy >= H) continue;
    for (let xx = x - 2; xx <= x + w + 1; xx++) {
      if (xx < 0 || xx >= W) continue;
      if (roomOf[yy * W + xx] !== -1) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Steps 3 and 4 - corridors and doors
// ---------------------------------------------------------------------------------------------

function carveCorridors(def, rng, tiles, roomOf, rooms) {
  const order = rooms.slice().sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  for (let k = 0; k + 1 < order.length; k++) {
    connect(def, rng, tiles, roomOf, order[k], order[k + 1]);
  }
  for (let e = 0; e < def.extraCorridors; e++) {
    if (rooms.length < 2) break;
    const a = rooms[int(rng, 0, rooms.length - 1)];
    const others = rooms.filter((r) => r.id !== a.id); // "two distinct random rooms" (D-031)
    const b = others[int(rng, 0, others.length - 1)];
    connect(def, rng, tiles, roomOf, a, b);
  }
}

function connect(def, rng, tiles, roomOf, roomA, roomB) {
  const a = pickInterior(rng, roomA);
  const b = pickInterior(rng, roomB);
  const horizontalFirst = chance(rng, 50);
  const path = horizontalFirst
    ? legX(a.x, b.x, a.y).concat(legY(a.y, b.y, b.x))
    : legY(a.y, b.y, a.x).concat(legX(a.x, b.x, b.y));
  for (const p of path) carveTile(def, rng, tiles, roomOf, p.x, p.y);
}

function legX(x0, x1, y) {
  const out = [];
  const step = x1 >= x0 ? 1 : -1;
  for (let x = x0; x !== x1 + step; x += step) out.push({ x, y });
  return out;
}

function legY(y0, y1, x) {
  const out = [];
  const step = y1 >= y0 ? 1 : -1;
  for (let y = y0; y !== y1 + step; y += step) out.push({ x, y });
  return out;
}

/**
 * WLD-11's corridor carving: a Wall tile becomes Floor, unless it is a room's boundary wall
 * (orthogonally adjacent to that room's interior and to no other room's), where it becomes a
 * Closed door with probability `doorChance`. Anything already carved is left alone.
 */
function carveTile(def, rng, tiles, roomOf, x, y) {
  if (!inBounds(x, y)) return;
  const i = y * W + x;
  if (tiles[i] !== TILE.WALL) return;
  if (boundaryRoom(roomOf, x, y) >= 0) {
    tiles[i] = chance(rng, def.doorChance) ? TILE.DOOR_CLOSED : TILE.FLOOR;
  } else {
    tiles[i] = TILE.FLOOR;
  }
}

/** The single room this wall tile borders orthogonally, or -1 for none / -2 for two or more. */
function boundaryRoom(roomOf, x, y) {
  let found = -1;
  if (x > 0) found = mergeRoom(found, roomOf[y * W + x - 1]);
  if (x < W - 1) found = mergeRoom(found, roomOf[y * W + x + 1]);
  if (y > 0) found = mergeRoom(found, roomOf[(y - 1) * W + x]);
  if (y < H - 1) found = mergeRoom(found, roomOf[(y + 1) * W + x]);
  return found;
}

function mergeRoom(found, r) {
  if (found === -2 || r === -1) return found;
  if (found === -1) return r;
  return found === r ? found : -2;
}

/** WLD-06: no two door tiles in one 8-neighbourhood; the second one becomes Floor. */
function applyDoorAdjacencyRule(tiles) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (tiles[i] !== TILE.DOOR_CLOSED) continue;
      let clash = false;
      for (let dy = -1; dy <= 1 && !clash; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          const j = ny * W + nx;
          if (j >= i) continue; // only tiles already kept can be "the first"
          if (tiles[j] === TILE.DOOR_CLOSED) {
            clash = true;
            break;
          }
        }
      }
      if (clash) tiles[i] = TILE.FLOOR;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Step 5 - room roles
// ---------------------------------------------------------------------------------------------

/** Walkable-or-door: what WLD-11 step 5's BFS crosses. */
function passableForGen(t) {
  return walkable(t) || t === TILE.DOOR_CLOSED;
}

function assignRoles(rng, tiles, rooms, roomOf) {
  const start = rooms.reduce((best, r) => (r.cx < best.cx || (r.cx === best.cx && r.cy < best.cy) ? r : best), rooms[0]);
  const dist = bfs((_from, to) => passableForGen(tiles[to.y * W + to.x]), { x: start.cx, y: start.cy });

  const d = new Map();
  for (const r of rooms) {
    const dr = dist[r.cy * W + r.cx];
    if (dr < 0) return null; // unreachable room -> fail validation (WLD-11 step 5)
    d.set(r.id, dr);
  }

  const stairs = best(rooms.filter((r) => r.id !== start.id), (r) => -d.get(r.id));
  const stairsDistance = d.get(stairs.id);
  const half = stairsDistance / 2;
  const stationPool = rooms.filter((r) => r.id !== start.id && r.id !== stairs.id);
  if (stationPool.length === 0) return null;
  const station = best(stationPool, (r) => Math.abs(d.get(r.id) - half));

  const cachePool = stationPool.filter((r) => r.id !== station.id);
  if (cachePool.length === 0) return null;
  const deadEnds = cachePool.filter((r) => boundaryOpenings(tiles, r) === 1);
  const cachePref = deadEnds.length > 0 ? deadEnds : cachePool;
  // WLD-15 (DIF-12): the cache room's every entrance becomes a Wound Lock, so the room has to be
  // one that can be shut without shutting anything else off — a corridor that merely runs along
  // its wall would otherwise be locked in half. Farthest first, as WLD-11 step 5 asks, and the
  // first one that can actually be sealed wins (D-111).
  const start0 = { x: start.cx, y: start.cy };
  const byDistance = (list) => list.slice().sort((a, b) => d.get(b.id) - d.get(a.id) || a.id - b.id);
  const lockable = (room) => cacheLockable(tiles, roomOf, rooms, start0, room);
  const cache =
    byDistance(cachePref).find(lockable) || byDistance(cachePool).find(lockable) || null;
  if (!cache) return null;

  const journalPool = cachePool.filter((r) => r.id !== cache.id);
  if (journalPool.length === 0) return null;
  const journal = pickFrom(rng, journalPool);

  return {
    start: start.id,
    stairs: stairs.id,
    station: station.id,
    cache: cache.id,
    journal: journal.id,
    dist,
    distances: d,
    stairsDistance,
  };
}

/**
 * WLD-15 (DIF-12) — "if the cache room's boundary has a corridor opening with no door, a door is
 * forced there; then all its doors become locks". Both halves are one pass: every passable
 * boundary tile of the cache room — an open corridor mouth, an open door or a closed one —
 * becomes a Wound Lock, so a cache is never enterable without paying for it.
 *
 * @returns {{x: number, y: number}[]} the tiles locked
 */
export function lockCacheRoom(tiles, roomOf, room) {
  const locked = [];
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      if (!inBounds(x, y)) continue;
      const inside = x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
      if (inside) continue;
      const i = y * W + x;
      const t = tiles[i];
      if (t !== TILE.FLOOR && t !== TILE.DOOR_CLOSED && t !== TILE.DOOR_OPEN) continue;
      // Only a tile you could step through into the room itself: the diagonal corners of the ring
      // are not entrances (ENM-08 refuses a diagonal step through a door either way).
      if (!orthogonallyInRoom(roomOf, x, y, room.id)) continue;
      tiles[i] = TILE.WOUND_LOCK;
      locked.push({ x, y });
    }
  }
  return locked;
}

/** Is one of the four orthogonal neighbours of (x, y) an interior tile of room `id`? */
function orthogonallyInRoom(roomOf, x, y, id) {
  if (x > 0 && roomOf[y * W + x - 1] === id) return true;
  if (x < W - 1 && roomOf[y * W + x + 1] === id) return true;
  if (y > 0 && roomOf[(y - 1) * W + x] === id) return true;
  if (y < H - 1 && roomOf[(y + 1) * W + x] === id) return true;
  return false;
}

/**
 * WLD-15 (DIF-12): would locking every entrance of `room` leave the rest of the floor reachable
 * from the start tile? The cache itself is meant to be shut away; nothing else is.
 */
function cacheLockable(tiles, roomOf, rooms, start, room) {
  // FLR-08: the Pendulum band's tiles are a hazard, not a door, so a cache room the band runs past
  // cannot be shut at all — that room is not a cache (D-111).
  if (!cacheSealable(tiles, room)) return false;
  const copy = Uint8Array.from(tiles);
  lockCacheRoom(copy, roomOf, room);
  const open = (i) => passableForGen(copy[i]) && copy[i] !== TILE.WOUND_LOCK;
  const dist = bfs((_from, to) => open(to.y * W + to.x), start);
  for (const other of rooms) {
    if (other.id === room.id) continue;
    if (dist[other.cy * W + other.cx] < 0) return false;
  }
  return true;
}

/**
 * WLD-15: is every way into `room` a tile a Wound Lock can replace — a corridor mouth or a door?
 * A hazard tile in the boundary is a way in that no lock can close.
 */
function cacheSealable(tiles, room) {
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      if (!inBounds(x, y)) continue;
      const inside = x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
      if (inside) continue;
      const t = tiles[y * W + x];
      if (t === TILE.WALL || t === TILE.FLOOR || t === TILE.DOOR_CLOSED || t === TILE.DOOR_OPEN) continue;
      if (orthogonallyTouchesRoom(room, x, y)) return false;
    }
  }
  return true;
}

/** Is one of the four orthogonal neighbours of (x, y) inside `room`'s rectangle? */
function orthogonallyTouchesRoom(room, x, y) {
  const inside = (nx, ny) => nx >= room.x && nx < room.x + room.w && ny >= room.y && ny < room.y + room.h;
  return inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1);
}

/** Minimum by `key`, ties broken by lowest room id (WLD-11 step 5). */
function best(list, key) {
  let bestRoom = list[0];
  let bestKey = key(list[0]);
  for (let i = 1; i < list.length; i++) {
    const k = key(list[i]);
    if (k < bestKey || (k === bestKey && list[i].id < bestRoom.id)) {
      bestRoom = list[i];
      bestKey = k;
    }
  }
  return bestRoom;
}

/** How many tiles of a room's boundary ring are passable — 1 means a dead end (WLD-11 step 5). */
function boundaryOpenings(tiles, room) {
  let count = 0;
  for (let y = room.y - 1; y <= room.y + room.h; y++) {
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      if (!inBounds(x, y)) continue;
      const inside = x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
      if (inside) continue;
      if (passableForGen(tiles[y * W + x])) count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------------------------
// Step 6 helpers
// ---------------------------------------------------------------------------------------------

/**
 * FLR-08: features are never placed inside the Pendulum band, and step 10 rejects any feature
 * within Chebyshev 1 of it — so the two columns beside the band are excluded up front (D-032).
 */
function featureTileAllowed(hasBand, x) {
  return !hasBand || x < BAND_X0 - 1 || x > BAND_X1 + 1;
}

function interiorTilesOf(room) {
  const out = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) out.push({ x, y });
  }
  return out;
}

/** Interior tiles of `room` that may still take a feature: plain Floor, unclaimed, outside a band. */
function interiorTiles(room, hasBand, tiles, featureAt) {
  const out = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (!featureTileAllowed(hasBand, x)) continue;
      const i = y * W + x;
      if (tiles[i] !== TILE.FLOOR || featureAt[i]) continue;
      out.push({ x, y });
    }
  }
  return out;
}

function orthogonallyTouchesWall(tiles, x, y) {
  return (
    (x > 0 && tiles[y * W + x - 1] === TILE.WALL) ||
    (x < W - 1 && tiles[y * W + x + 1] === TILE.WALL) ||
    (y > 0 && tiles[(y - 1) * W + x] === TILE.WALL) ||
    (y < H - 1 && tiles[(y + 1) * W + x] === TILE.WALL)
  );
}

/** One draw: a uniformly random element of `list`. */
function pickFrom(rng, list) {
  return list[int(rng, 0, list.length - 1)];
}

/** Two draws, x then y: a uniformly random interior tile, used where WLD-11 says "retry". */
function pickInterior(rng, room) {
  return { x: int(rng, room.x, room.x + room.w - 1), y: int(rng, room.y, room.y + room.h - 1) };
}

function addItem(items, itemAt, name, p, source) {
  items.push({ name, count: 1, x: p.x, y: p.y, source });
  itemAt[p.y * W + p.x] = 1;
}

/** ITM-10: one roll, one equipment re-roll on a duplicate, and uniques re-rolled until fresh. */
function rollItem(rng, table, generatedEquipment, uniques) {
  let name = weighted(rng, table);
  if (isEquipment(name) && generatedEquipment.has(name)) name = weighted(rng, table);
  for (let guard = 0; guard < 100 && isUnique(name) && uniques.has(name); guard++) {
    name = weighted(rng, table);
  }
  if (isEquipment(name)) generatedEquipment.add(name);
  if (isUnique(name)) uniques.add(name);
  return name;
}

function isEquipment(name) {
  const item = ITEMS_BY_NAME[name];
  return !!item && EQUIPMENT_CATEGORIES.has(item.category);
}

function isUnique(name) {
  const item = ITEMS_BY_NAME[name];
  return !!item && item.unique === true;
}

// ---------------------------------------------------------------------------------------------
// Step 7 - hazards
// ---------------------------------------------------------------------------------------------

function placeHazards(def, rng, tiles, roomOf, rooms, roles, featureAt, hazards) {
  for (const cfg of def.hazards) {
    if (cfg.kind === 'PENDULUM_BAND') continue; // already placed, right after step 4 (FLR-08)
    const kind = cfg.kind;
    const tile = HAZARD_TILE_OF[kind];
    const pool = hazardPool(kind, tiles, roomOf, rooms, roles);
    if (pool.length === 0) continue;
    const perRoom = new Map();
    for (let placed = 0; placed < cfg.count; placed++) {
      let done = false;
      for (let t = 0; t < HAZARD_DRAWS && !done; t++) {
        const p = pool[int(rng, 0, pool.length - 1)];
        const i = p.y * W + p.x;
        if (tiles[i] !== TILE.FLOOR || featureAt[i]) continue;
        if (nearFeature(featureAt, p.x, p.y)) continue;
        if (adjacentToHazard(tiles, p.x, p.y)) continue;
        const room = roomOf[i];
        if (kind === 'STEAM_VENT' && (perRoom.get(room) || 0) >= 4) continue;
        tiles[i] = tile;
        perRoom.set(room, (perRoom.get(room) || 0) + 1);
        hazards.push({ kind, x: p.x, y: p.y });
        done = true;
      }
      if (!done) break; // WLD-11 step 7: place fewer
    }
  }
}

/**
 * Where a hazard kind may go (WLD-11 step 7, FLR-05, FLR-08):
 * Grinding Gears on corridor Floor tiles outside any band; Steam Vents on the interior tiles of
 * rooms with no role (FLR-05).
 */
function hazardPool(kind, tiles, roomOf, rooms, roles) {
  const out = [];
  if (kind === 'STEAM_VENT') {
    const roleIds = new Set([roles.start, roles.stairs, roles.station, roles.cache, roles.journal]);
    for (const room of rooms) {
      if (roleIds.has(room.id)) continue;
      for (const p of interiorTilesOf(room)) if (tiles[p.y * W + p.x] === TILE.FLOOR) out.push(p);
    }
    return out;
  }
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (tiles[i] !== TILE.FLOOR || roomOf[i] !== -1) continue;
      out.push({ x, y });
    }
  }
  return out;
}

/** WLD-11 step 7 / step 10: a hazard is never within Chebyshev 1 of a feature tile. */
function nearFeature(featureAt, x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (featureAt[ny * W + nx]) return true;
    }
  }
  return false;
}

function adjacentToHazard(tiles, x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (isHazardTile(tiles[ny * W + nx])) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Step 9 - enemy placement
// ---------------------------------------------------------------------------------------------

function spawnRecord(type, p, homeRoom, opts) {
  return {
    type,
    x: p.x,
    y: p.y,
    homeRoom,
    isGuard: opts.isGuard === true,
    isBoss: opts.isBoss === true,
    pack: opts.pack === true,
    // ENM-12 (DIF-08): guards, bosses and pack members never carry it (`canBeElite`).
    elite: opts.elite === true,
  };
}

/**
 * WLD-11 step 9: 50 rejection samples for a free interior tile at BFS distance >= 8 from the
 * player start; then the first valid tile at distance >= 3 in reading order, then any valid tile.
 */
function placeEnemy(rng, spawnRooms, dist, freeForActor) {
  if (spawnRooms.length === 0) return null;
  for (let t = 0; t < PLACE_RETRIES; t++) {
    const room = spawnRooms[int(rng, 0, spawnRooms.length - 1)];
    const p = pickInterior(rng, room);
    const i = p.y * W + p.x;
    if (freeForActor(i) && dist[i] >= 8) return { room, p };
  }
  let fallback = null;
  for (const room of spawnRooms) {
    for (const p of interiorTilesOf(room)) {
      const i = p.y * W + p.x;
      if (!freeForActor(i)) continue;
      if (dist[i] >= 3) return { room, p };
      if (!fallback) fallback = { room, p };
    }
  }
  return fallback;
}

/** FLR-01's boss and guard placement: 50 rejection samples, then any free interior tile. */
function placeInRoom(rng, room, freeForActor) {
  for (let t = 0; t < PLACE_RETRIES; t++) {
    const p = pickInterior(rng, room);
    if (freeForActor(p.y * W + p.x)) return p;
  }
  for (const p of interiorTilesOf(room)) if (freeForActor(p.y * W + p.x)) return p;
  return null;
}

/**
 * WLD-12: no enemy is visible from the player start on arrival. Each visible enemy gets 20 fresh
 * random tiles (in its own room for the guard and the boss, anywhere outside the start room
 * otherwise); if all 20 are still visible, the first invisible valid tile in reading order is used
 * so that ACC-72 holds, and only a floor with no such tile keeps a visible enemy (D-034).
 */
function hideVisibleSpawns(rng, tiles, rooms, roles, spawns, occupied, freeForActor, start, spawnRooms) {
  const visible = computeFov((x, y) => blocksSight(tiles[y * W + x]), start.x, start.y, FOV_RADIUS);
  for (const s of spawns) {
    if (!visible.has(s.y * W + s.x)) continue;
    const pool = s.isGuard ? [rooms[roles.cache]] : s.isBoss ? [rooms[roles.stairs]] : spawnRooms;
    if (pool.length === 0) continue;
    occupied[s.y * W + s.x] = 0;
    let moved = null;
    for (let t = 0; t < VISIBILITY_RETRIES && !moved; t++) {
      const room = pool[int(rng, 0, pool.length - 1)];
      const p = pickInterior(rng, room);
      const i = p.y * W + p.x;
      if (freeForActor(i) && !visible.has(i)) moved = { room, p };
    }
    if (!moved) {
      for (const room of pool) {
        for (const p of interiorTilesOf(room)) {
          const i = p.y * W + p.x;
          if (freeForActor(i) && !visible.has(i)) {
            moved = { room, p };
            break;
          }
        }
        if (moved) break;
      }
    }
    if (moved) {
      s.x = moved.p.x;
      s.y = moved.p.y;
      s.homeRoom = moved.room.id;
    }
    occupied[s.y * W + s.x] = 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Step 10 - validation
// ---------------------------------------------------------------------------------------------

function validate(def, rooms, features, hazards, hasBand) {
  if (rooms.length < 5) return false;
  if (!features.stairs) return false;
  if (!features.station) return false;
  if (!features.journal) return false;
  const cacheItems = features.cache.length - (def.cacheExtra ? def.cacheExtra.length : 0);
  if (cacheItems < 2) return false;

  const featureTiles = [features.start, features.stairs, features.station, features.journal, ...features.cache];
  for (const f of featureTiles) {
    for (const h of hazards) {
      if (chebyshev(f.x, f.y, h.x, h.y) <= 1) return false;
    }
    if (hasBand && f.x >= BAND_X0 - 1 && f.x <= BAND_X1 + 1) return false;
  }
  return true;
}

/** WLD-15: can Tick reach all of these tiles from the start with every lock treated as a wall? */
function reachableWithoutLocks(tiles, start, targets) {
  const dist = bfs(
    (_from, to) => passableForGen(tiles[to.y * W + to.x]) && tiles[to.y * W + to.x] !== TILE.WOUND_LOCK,
    start,
  );
  for (const t of targets) {
    if (!t) continue;
    if (dist[t.y * W + t.x] < 0) return false;
  }
  return true;
}

function toRows(tiles) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = new Array(W);
    for (let x = 0; x < W; x++) row[x] = tiles[y * W + x];
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Floor 8 (WLD-13)
// ---------------------------------------------------------------------------------------------

const LEGEND_TILE = {
  '#': TILE.WALL,
  '.': TILE.FLOOR,
  '+': TILE.DOOR_CLOSED,
  '@': TILE.FLOOR,
  U: TILE.FLOOR,
  C: TILE.CHAIR,
  E: TILE.ESCAPEMENT,
  '~': TILE.PENDULUM_SWEEP,
};

/**
 * Load the handcrafted floor (WLD-13, FLR-09). Nothing is rolled: the map, Tick's start, the
 * Understudy and the two Unfinished all come from `data/floors.js` verbatim (ACC-77).
 */
export function loadFixedFloor(n) {
  const def = FLOORS[n];
  if (!def || !def.fixedMap) throw new RangeError(`loadFixedFloor: floor ${n} has no fixedMap (WLD-13)`);
  const map = def.fixedMap;
  if (map.length !== H) throw new Error(`loadFixedFloor: floor ${n} map has ${map.length} rows, expected ${H}`);

  const tiles = new Uint8Array(W * H);
  const features = { start: null, stairs: null, station: null, journal: null, cache: [], chair: null, understudy: null };
  const markers = [];

  for (let y = 0; y < H; y++) {
    const row = map[y];
    if (row.length !== W) throw new Error(`loadFixedFloor: row ${y} has ${row.length} columns, expected ${W}`);
    for (let x = 0; x < W; x++) {
      const ch = row[x];
      if (ch >= '1' && ch <= '9') {
        tiles[y * W + x] = TILE.FLOOR;
        markers.push({ n: Number(ch), x, y });
        continue;
      }
      const t = LEGEND_TILE[ch];
      if (t === undefined) throw new Error(`loadFixedFloor: unknown legend character '${ch}' at (${x}, ${y})`);
      tiles[y * W + x] = t;
      if (ch === '@') features.start = { x, y };
      if (ch === 'U') features.understudy = { x, y };
      if (ch === 'C') features.chair = { x, y };
    }
  }
  if (!features.start) throw new Error('loadFixedFloor: the map has no @ (player start)');
  if (!features.understudy) throw new Error('loadFixedFloor: the map has no U (the Understudy)');

  markers.sort((a, b) => a.n - b.n);
  const spawns = [];
  let m = 0;
  for (const entry of def.spawns) {
    const count = entry.pack ? 1 : entry.count;
    const type = entry.pack || entry.type;
    for (let c = 0; c < count && m < markers.length; c++, m++) {
      spawns.push(spawnRecord(type, markers[m], -1, {}));
    }
  }
  if (def.boss) spawns.push(spawnRecord(def.boss.type, features.understudy, -1, { isBoss: true }));

  const hazards = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (tiles[y * W + x] === TILE.PENDULUM_SWEEP) hazards.push({ kind: 'PENDULUM_SWEEP', x, y });
    }
  }

  return {
    number: n,
    name: def.name,
    shortName: def.shortName,
    tiles: toRows(tiles),
    rooms: [],
    roles: {},
    features,
    stationSpent: false,
    items: [],
    spawns,
    hazards,
    start: { x: features.start.x, y: features.start.y },
    journalPage: def.journalPage,
    retries: 0,
    seed: 0,
    markers,
  };
}

// ---------------------------------------------------------------------------------------------
// The Floor object (consumed by engine.js in M04)
// ---------------------------------------------------------------------------------------------
//
//   number, name, shortName   from data/floors.js
//   tiles[24][60]             TILE numbers, row-major (TEC-05)
//   rooms[]                   { id, x, y, w, h, cx, cy } — interior top-left, size, centre
//   roles{}                   role name -> room id: start, stairs, station, cache, journal
//   features{}                start, stairs, station, journal {x,y,page}, cache[{x,y}]
//                             (floor 8: start, chair, understudy)
//   stationSpent              true on floor 1, where the start tile IS the station (WLD-07)
//   items[]                   { name, count, x, y, source: 'floor'|'cache'|'journal' }
//   spawns[]                  { type, x, y, homeRoom, isGuard, isBoss, pack } — records, not actors
//   hazards[]                 { kind, x, y } with kind in HAZARDS
//   start{x,y}                where Tick arrives
//   journalPage               the page this floor's journal room holds
//   retries                   WLD-10 regenerations this floor took (0 on the first try) — M11 S1
//   seed                      the floorSeed that produced it (floorSeed(seed, n) + retries)
