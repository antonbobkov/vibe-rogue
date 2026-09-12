// M03 — the floor generator (WLD-11), the floor 8 loader (WLD-13), and the tile/hazard tables.
//
// The four generation ACCs (ACC-70..73) are properties of every floor, so they are checked by one
// survey over 1,000 seeds x floors 1-7 (7,000 floors) that records every violation it finds; each
// test then asserts its own violation list is empty. The survey runs once and is memoised, so the
// 7,000 generations happen a single time no matter how many tests read it.
//
// Expected values are written from the spec, never read back out of the generator.

import test from 'node:test';
import assert from 'node:assert/strict';

import { W, H, bfs, chebyshev } from '../../src/grid.js';
import { computeFov } from '../../src/fov.js';
import { fnv1a, mulberry32 } from '../../src/rng.js';
import { TILE, walkable, blocksSight, isHazardTile, HAZARDS, hazardActive, hazardWarning } from '../../src/tiles.js';
import { generateFloor, loadFixedFloor, floorSeed, BAND_X0, BAND_X1 } from '../../src/gen.js';
import { FLOORS } from '../../data/floors.js';
import { ITEMS_BY_NAME } from '../../data/items.js';

const SEED_COUNT = 1000;
const FLOOR_NUMBERS = [1, 2, 3, 4, 5, 6, 7];
const seedOf = (i) => `SURVEY-${i}`;

// ---------------------------------------------------------------------------------------------
// Helpers, all written from the spec
// ---------------------------------------------------------------------------------------------

const tileAt = (floor, x, y) => floor.tiles[y][x];

/** room id per tile interior, -1 elsewhere (WLD-03). */
function roomMap(floor) {
  const map = new Int16Array(W * H).fill(-1);
  for (const r of floor.rooms) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map[y * W + x] = r.id;
  }
  return map;
}

/**
 * WLD-11 step 5's connectivity: walkable tiles plus closed doors — and, since M13, the Wound Locks
 * of WLD-15, which Tick opens by bumping them like any other door (DIF-12). Step 5's own BFS runs
 * before the locks exist, so this is the same graph it walked.
 */
const passableForGen = (t) => walkable(t) || t === TILE.DOOR_CLOSED || t === TILE.WOUND_LOCK;

function distancesFrom(floor, from) {
  return bfs((_a, b) => passableForGen(tileAt(floor, b.x, b.y)), from);
}

function countTiles(floor, tile) {
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (floor.tiles[y][x] === tile) n++;
  return n;
}

function samePoint(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

function inRoom(room, x, y) {
  return x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
}

// ---------------------------------------------------------------------------------------------
// The survey: 1,000 seeds x floors 1-7, every invariant of ACC-70..73 in one pass
// ---------------------------------------------------------------------------------------------

let SURVEY = null;

function survey() {
  if (SURVEY) return SURVEY;
  const out = { acc70: [], acc71: [], acc72: [], acc73: [], floors: 0, maxRetries: 0 };
  const note = (list, seed, n, why) => {
    if (list.length < 5) list.push(`${seed} floor ${n}: ${why}`);
  };

  for (let s = 0; s < SEED_COUNT; s++) {
    const seed = seedOf(s);
    for (const n of FLOOR_NUMBERS) {
      const def = FLOORS[n];
      let floor;
      try {
        floor = generateFloor(seed, n);
      } catch (err) {
        note(out.acc70, seed, n, `threw: ${err.message}`);
        continue;
      }
      out.floors++;
      out.maxRetries = Math.max(out.maxRetries, floor.retries);
      const rooms = roomMap(floor);
      const dist = distancesFrom(floor, floor.start);

      // ---- ACC-70: validation, rooms, reachability, the three singular features, the cache ----
      if (floor.rooms.length < 5) note(out.acc70, seed, n, `${floor.rooms.length} rooms`);
      for (const r of floor.rooms) {
        if (dist[r.cy * W + r.cx] < 0) note(out.acc70, seed, n, `room ${r.id} unreachable from start`);
      }
      const stairsTiles = countTiles(floor, TILE.STAIRS_UP);
      if (stairsTiles !== 1) note(out.acc70, seed, n, `${stairsTiles} up-stairs tiles`);
      const stationTiles = countTiles(floor, TILE.STATION);
      if (stationTiles !== 1) note(out.acc70, seed, n, `${stationTiles} station tiles`);
      const pages = floor.items.filter((it) => it.name === `Journal page ${def.journalPage}`);
      if (pages.length !== 1) note(out.acc70, seed, n, `${pages.length} journal pages`);
      const blueprints = floor.items.filter((it) => it.name === 'Understudy Blueprint');
      if (blueprints.length !== (n === 6 ? 1 : 0)) note(out.acc70, seed, n, `${blueprints.length} blueprints`);
      const cacheRolled = floor.items.filter((it) => it.source === 'cache' && it.name !== 'Understudy Blueprint');
      if (cacheRolled.length < 2 || cacheRolled.length > 3) {
        note(out.acc70, seed, n, `cache holds ${cacheRolled.length} rolled items`);
      }

      // ---- ACC-71: doors and items ------------------------------------------------------------
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (floor.tiles[y][x] !== TILE.DOOR_CLOSED) continue;
          if (rooms[y * W + x] !== -1) note(out.acc71, seed, n, `door inside a room at ${x},${y}`);
          let borders = 0;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const r = rooms[(y + dy) * W + (x + dx)];
            if (r !== -1) borders++;
          }
          if (borders === 0) note(out.acc71, seed, n, `door not on a room boundary at ${x},${y}`);
          // WLD-06: a door is a *threshold* — a one-tile gap in a wall, with two opposite passable
          // orthogonal neighbours and walls on the other two sides. Being on a room boundary is not
          // enough on its own, and for a long time it was all that was checked: 31% of generated
          // doors stood in T-junctions, crossroads and corridor bends, where a player walks around
          // them. If this fires, the openings were not narrowed or a door was rolled on a gap.
          const open = (dx, dy) => floor.tiles[y + dy][x + dx] !== TILE.WALL;
          const vertical = open(0, -1) && open(0, 1) && !open(1, 0) && !open(-1, 0);
          const horizontal = open(1, 0) && open(-1, 0) && !open(0, -1) && !open(0, 1);
          if (!vertical && !horizontal) {
            const sides = [open(0, -1), open(0, 1), open(1, 0), open(-1, 0)].filter(Boolean).length;
            note(out.acc71, seed, n, `door at ${x},${y} is not a threshold (${sides} open sides)`);
          }
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              if (floor.tiles[ny][nx] === TILE.DOOR_CLOSED) note(out.acc71, seed, n, `adjacent doors at ${x},${y}`);
            }
          }
        }
      }
      // WLD-11 step 4's narrowing pass: every way into a room is one tile wide. A corridor dug
      // along a boundary wall used to dissolve a whole stretch of it, which is what stranded the
      // doors above. `narrowRoomOpenings` reverts a fill that would cut a room off, so a run may
      // legitimately survive when walling it would disconnect the floor — hence the small budget
      // rather than zero.
      let wideOpenings = 0;
      for (const room of floor.rooms) {
        const edges = [
          { from: { x: room.x, y: room.y - 1 }, step: { x: 1, y: 0 }, len: room.w },
          { from: { x: room.x, y: room.y + room.h }, step: { x: 1, y: 0 }, len: room.w },
          { from: { x: room.x - 1, y: room.y }, step: { x: 0, y: 1 }, len: room.h },
          { from: { x: room.x + room.w, y: room.y }, step: { x: 0, y: 1 }, len: room.h },
        ];
        for (const edge of edges) {
          let run = 0;
          for (let i = 0; i < edge.len; i++) {
            const px = edge.from.x + edge.step.x * i;
            const py = edge.from.y + edge.step.y * i;
            const passable = px >= 0 && py >= 0 && px < W && py < H && floor.tiles[py][px] !== TILE.WALL;
            run = passable ? run + 1 : 0;
            if (run > 1) wideOpenings++;
          }
        }
      }
      if (wideOpenings > 2) {
        note(out.acc71, seed, n, `${wideOpenings} multi-tile room openings left unnarrowed`);
      }

      const seenItemTiles = new Set();
      for (const it of floor.items) {
        const t = tileAt(floor, it.x, it.y);
        if (t !== TILE.FLOOR) note(out.acc71, seed, n, `item '${it.name}' on tile type ${t}`);
        if (rooms[it.y * W + it.x] === -1) note(out.acc71, seed, n, `item '${it.name}' on a corridor tile`);
        if (isHazardTile(t)) note(out.acc71, seed, n, `item '${it.name}' on a hazard`);
        if (samePoint(it, floor.start)) note(out.acc71, seed, n, `item '${it.name}' on the start tile`);
        const key = it.y * W + it.x;
        if (seenItemTiles.has(key)) note(out.acc71, seed, n, `two items on ${it.x},${it.y}`);
        seenItemTiles.add(key);
      }

      // ---- ACC-72: enemies and hazards --------------------------------------------------------
      const startRoom = floor.rooms[floor.roles.start];
      const visible = computeFov((x, y) => blocksSight(floor.tiles[y][x]), floor.start.x, floor.start.y, 8);
      for (const sp of floor.spawns) {
        if (inRoom(startRoom, sp.x, sp.y)) note(out.acc72, seed, n, `${sp.type} in the start room`);
        if (visible.has(sp.y * W + sp.x)) note(out.acc72, seed, n, `${sp.type} visible from the start tile`);
      }
      for (const hz of floor.hazards) {
        for (const f of [floor.features.start, floor.features.stairs, floor.features.station]) {
          if (f && chebyshev(f.x, f.y, hz.x, hz.y) <= 1) {
            note(out.acc72, seed, n, `${hz.kind} at ${hz.x},${hz.y} beside a feature`);
          }
        }
      }

      // ---- ACC-73: the station room sits closest to half the stairs distance ------------------
      const roomDist = new Map(floor.rooms.map((r) => [r.id, dist[r.cy * W + r.cx]]));
      const half = roomDist.get(floor.roles.stairs) / 2;
      const eligible = floor.rooms.filter((r) => r.id !== floor.roles.start && r.id !== floor.roles.stairs);
      let bestDelta = Infinity;
      let bestId = -1;
      for (const r of eligible) {
        const delta = Math.abs(roomDist.get(r.id) - half);
        if (delta < bestDelta || (delta === bestDelta && r.id < bestId)) {
          bestDelta = delta;
          bestId = r.id;
        }
      }
      if (floor.roles.station !== bestId) {
        note(out.acc73, seed, n, `station room ${floor.roles.station}, expected ${bestId}`);
      }
    }
  }
  SURVEY = out;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tile and hazard tables (WLD-02, WLD-08)
// ---------------------------------------------------------------------------------------------

test('@m03 @unit tiles: WLD-02 walkability and sight blocking', () => {
  for (const t of [TILE.FLOOR, TILE.DOOR_OPEN, TILE.STAIRS_UP, TILE.STATION, TILE.GRINDING_GEAR, TILE.STEAM_VENT, TILE.PENDULUM_SWEEP]) {
    assert.equal(walkable(t), true);
  }
  for (const t of [TILE.WALL, TILE.DOOR_CLOSED, TILE.CHAIR, TILE.ESCAPEMENT]) assert.equal(walkable(t), false);
  for (const t of [TILE.WALL, TILE.DOOR_CLOSED, TILE.ESCAPEMENT]) assert.equal(blocksSight(t), true);
  for (const t of [TILE.FLOOR, TILE.DOOR_OPEN, TILE.STAIRS_UP, TILE.STATION, TILE.CHAIR, TILE.GRINDING_GEAR, TILE.STEAM_VENT, TILE.PENDULUM_SWEEP]) {
    assert.equal(blocksSight(t), false);
  }
});

test('@m03 @unit tiles: WLD-08 hazard configurations and cycles', () => {
  assert.deepEqual(Object.keys(HAZARDS).sort(), ['GRINDING_GEAR', 'PENDULUM_SWEEP', 'STEAM_VENT']);

  const gear = HAZARDS.GRINDING_GEAR;
  assert.equal(gear.damage, 3);
  assert.equal(gear.ignoresPlating, true);
  assert.equal(gear.noise, 6);
  assert.equal(gear.status, null);
  assert.deepEqual([...gear.triggers], ['ENTER']);
  assert.deepEqual([...gear.floors], [2, 7]);

  const vent = HAZARDS.STEAM_VENT;
  assert.equal(vent.period, 6);
  assert.deepEqual([...vent.activePhases], [0, 1]);
  assert.equal(vent.damage, 4);
  assert.deepEqual({ ...vent.status }, { name: 'Burning', duration: 2 });

  const sweep = HAZARDS.PENDULUM_SWEEP;
  assert.equal(sweep.period, 8);
  assert.deepEqual([...sweep.activePhases], [0]);
  assert.equal(sweep.damage, 6);
  assert.deepEqual({ ...sweep.status }, { name: 'Stunned', duration: 1 });

  for (let turn = 0; turn < 24; turn++) {
    assert.equal(hazardActive('GRINDING_GEAR', turn), true);
    assert.equal(hazardActive('STEAM_VENT', turn), turn % 6 === 0 || turn % 6 === 1);
    assert.equal(hazardActive('PENDULUM_SWEEP', turn), turn % 8 === 0);
    assert.equal(hazardWarning('STEAM_VENT', turn), turn % 6 === 5);
    assert.equal(hazardWarning('PENDULUM_SWEEP', turn), turn % 8 === 7);
    assert.equal(hazardWarning('GRINDING_GEAR', turn), false);
  }
});

// ---------------------------------------------------------------------------------------------
// Determinism (TEC-07)
// ---------------------------------------------------------------------------------------------

test('@m03 @unit gen: the same (seed, floor) is deep-equal and different seeds differ', () => {
  for (let n = 1; n <= 8; n++) {
    const a = generateFloor('TEST1234', n);
    const b = generateFloor('TEST1234', n);
    assert.deepStrictEqual(a, b, `floor ${n} is not reproducible`);
  }
  let differences = 0;
  for (let n = 1; n <= 7; n++) {
    const a = generateFloor('SEED-A', n);
    const b = generateFloor('SEED-B', n);
    if (JSON.stringify(a.tiles) !== JSON.stringify(b.tiles)) differences++;
  }
  assert.equal(differences, 7, 'two different seeds produced an identical map on some floor');
});

test('@m03 ACC-80 gen: a floor is seeded by fnv1a(seed + ":floor:" + n)', () => {
  for (const seedString of ['TEST1234', 'ANOTHER', '']) {
    for (let n = 1; n <= 8; n++) {
      assert.equal(floorSeed(seedString, n), fnv1a(`${seedString}:floor:${n}`));
    }
  }
  // The generator uses exactly that stream: re-running mulberry32 from the recomputed seed
  // reproduces the floor's own first draws, and the floor reports the seed it used.
  const n = 3;
  const floor = generateFloor('TEST1234', n);
  assert.equal(floor.retries, 0);
  assert.equal(floor.seed, fnv1a(`TEST1234:floor:${n}`));
  const rng = mulberry32(fnv1a(`TEST1234:floor:${n}`));
  const first = floor.rooms[0];
  // WLD-11 step 2's first accepted room comes from the first four draws w, h, x, y.
  const w = 4 + Math.floor(rng.next() * 7);
  const h = 3 + Math.floor(rng.next() * 5);
  const x = 1 + Math.floor(rng.next() * (58 - w));
  const y = 1 + Math.floor(rng.next() * (22 - h));
  assert.deepEqual({ x: first.x, y: first.y, w: first.w, h: first.h }, { x, y, w, h });
});

// ---------------------------------------------------------------------------------------------
// ACC-70..73 over 1,000 seeds x floors 1-7
// ---------------------------------------------------------------------------------------------

test('@m03 ACC-70 gen: 7,000 floors validate, have >= 5 reachable rooms, one <, one &, one page, a 2-3 item cache', () => {
  const s = survey();
  assert.equal(s.floors, SEED_COUNT * FLOOR_NUMBERS.length);
  assert.deepEqual(s.acc70, []);
});

test('@m03 ACC-71 gen: no adjacent doors, doors only on room boundaries, items never on corridor/door/feature/hazard tiles', () => {
  assert.deepEqual(survey().acc71, []);
});

test('@m03 ACC-72 gen: no enemy in or visible from the start, no hazard beside start/stairs/station', () => {
  assert.deepEqual(survey().acc72, []);
});

test('@m03 ACC-73 gen: the station room is the eligible room closest to half the stairs distance', () => {
  assert.deepEqual(survey().acc73, []);
});

// ---------------------------------------------------------------------------------------------
// Per-floor rules
// ---------------------------------------------------------------------------------------------

test('@m03 ACC-74 gen: floor 2 has 6 Grinding Gears, all on corridor tiles, none adjacent', () => {
  let shortfalls = 0;
  for (let s = 0; s < 200; s++) {
    const floor = generateFloor(seedOf(s), 2);
    const rooms = roomMap(floor);
    const gears = floor.hazards.filter((h) => h.kind === 'GRINDING_GEAR');
    assert.ok(gears.length <= 6, `${gears.length} gears`);
    if (gears.length < 6) shortfalls++;
    for (const g of gears) {
      assert.equal(tileAt(floor, g.x, g.y), TILE.GRINDING_GEAR);
      assert.equal(rooms[g.y * W + g.x], -1, `gear at ${g.x},${g.y} is inside a room`);
      for (const other of gears) {
        if (other === g) continue;
        assert.ok(chebyshev(g.x, g.y, other.x, other.y) > 1, `gears adjacent at ${g.x},${g.y}`);
      }
    }
    assert.equal(countTiles(floor, TILE.GRINDING_GEAR), gears.length);
  }
  assert.equal(shortfalls, 0, 'placement never needed to fall short over these seeds');
});

test('@m03 @unit gen: floor 4 places 10 Steam Vents, at most 4 per room, never adjacent (FLR-05)', () => {
  // FLR-05 asks for ten, and WLD-11 step 7 allows "place fewer" when the rejection sampler cannot
  // fit them: at most 4 to a roleless room and none adjacent leaves a handful of tight floors where
  // the tenth has nowhere legal to go. Measured over 3,000 seeds that is ~0.3% of floors, never
  // below 8 — so the assertion is "ten unless the floor cannot take ten", with a floor on how often
  // that may happen, rather than a flat ten that depends on this sample missing the tight seeds.
  let full = 0;
  const SEEDS = 200;
  for (let s = 0; s < SEEDS; s++) {
    const floor = generateFloor(seedOf(s), 4);
    const rooms = roomMap(floor);
    const vents = floor.hazards.filter((h) => h.kind === 'STEAM_VENT');
    assert.ok(vents.length <= 10, `seed ${seedOf(s)} placed ${vents.length} vents`);
    assert.ok(vents.length >= 8, `seed ${seedOf(s)} placed only ${vents.length} vents`);
    if (vents.length === 10) full += 1;
    const perRoom = new Map();
    const roleRooms = new Set(Object.values(floor.roles));
    for (const v of vents) {
      assert.equal(tileAt(floor, v.x, v.y), TILE.STEAM_VENT);
      const room = rooms[v.y * W + v.x];
      assert.notEqual(room, -1, 'vents go on room interiors (FLR-05)');
      assert.equal(roleRooms.has(room), false, 'vents go in rooms with no role (FLR-05)');
      perRoom.set(room, (perRoom.get(room) || 0) + 1);
      for (const other of vents) {
        if (other === v) continue;
        assert.ok(chebyshev(v.x, v.y, other.x, other.y) > 1, `vents adjacent at ${v.x},${v.y}`);
      }
    }
    for (const [room, count] of perRoom) assert.ok(count <= 4, `room ${room} has ${count} vents`);
  }
  assert.ok(full >= SEEDS - 5, `only ${full} of ${SEEDS} floor-4 seeds fitted all ten vents`);
});

test('@m03 ACC-76 gen: floor 7 turns every Floor/door tile in columns 28-31 into a Pendulum Sweep, with no feature in the band', () => {
  for (let s = 0; s < 200; s++) {
    const floor = generateFloor(seedOf(s), 7);
    const band = new Set();
    for (let y = 0; y < H; y++) {
      for (let x = BAND_X0; x <= BAND_X1; x++) {
        const t = floor.tiles[y][x];
        assert.notEqual(t, TILE.FLOOR, `plain floor left in the band at ${x},${y}`);
        assert.notEqual(t, TILE.DOOR_CLOSED, `door left in the band at ${x},${y}`);
        assert.notEqual(t, TILE.DOOR_OPEN, `door left in the band at ${x},${y}`);
        if (t === TILE.PENDULUM_SWEEP) band.add(`${x},${y}`);
      }
    }
    assert.ok(band.size > 0, 'the band is empty');
    const sweeps = floor.hazards.filter((h) => h.kind === 'PENDULUM_SWEEP');
    assert.equal(sweeps.length, band.size);
    for (const sw of sweeps) assert.ok(sw.x >= BAND_X0 && sw.x <= BAND_X1);

    const features = [floor.features.start, floor.features.stairs, floor.features.station, floor.features.journal, ...floor.features.cache];
    for (const f of features) {
      assert.ok(f.x < BAND_X0 || f.x > BAND_X1, `feature inside the band at ${f.x},${f.y}`);
      for (const key of band) {
        const [bx, by] = key.split(',').map(Number);
        assert.ok(chebyshev(f.x, f.y, bx, by) > 1, `feature at ${f.x},${f.y} beside the band`);
      }
    }
    assert.equal(floor.hazards.filter((h) => h.kind === 'GRINDING_GEAR').length, 4);
  }
});

test('@m03 ACC-81 gen: floor 1 starts on a spent Winding Station', () => {
  for (let s = 0; s < 50; s++) {
    const floor = generateFloor(seedOf(s), 1);
    assert.equal(tileAt(floor, floor.start.x, floor.start.y), TILE.STATION);
    assert.deepEqual(floor.features.station, { x: floor.start.x, y: floor.start.y });
    assert.equal(floor.stationSpent, true);
    assert.equal(countTiles(floor, TILE.STATION), 1);
  }
  const later = generateFloor(seedOf(0), 2);
  assert.equal(later.stationSpent, false);
  assert.notDeepEqual(later.features.station, later.start);
});

test('@m03 @unit gen: floor 1 guarantees a plating in the cache, floor 6 adds the Understudy Blueprint (ITM-12, FLR-07)', () => {
  for (let s = 0; s < 200; s++) {
    const first = generateFloor(seedOf(s), 1).items.filter((it) => it.source === 'cache')[0];
    assert.ok(first, 'floor 1 cache is empty');
    assert.ok(['Tin Plating', 'Brass Plating'].includes(first.name), `first cache item was ${first.name}`);
    assert.equal(ITEMS_BY_NAME[first.name].category, 'plating');

    const cache = generateFloor(seedOf(s), 6).items.filter((it) => it.source === 'cache');
    const blueprint = cache.filter((it) => it.name === 'Understudy Blueprint');
    assert.equal(blueprint.length, 1);
    const rolled = cache.filter((it) => it.name !== 'Understudy Blueprint');
    assert.ok(rolled.length >= 2 && rolled.length <= 3, `${rolled.length} rolled cache items`);
    const tiles = new Set(cache.map((it) => `${it.x},${it.y}`));
    assert.equal(tiles.size, cache.length, 'cache items share a tile');
  }
});

test('@m03 @unit gen: every floor records the WLD-10 retry count and the spawn records M04 consumes', () => {
  for (let n = 1; n <= 7; n++) {
    const floor = generateFloor('TEST1234', n);
    assert.equal(typeof floor.retries, 'number');
    assert.ok(floor.retries >= 0 && floor.retries <= 50);
    const def = FLOORS[n];
    const expected = def.spawns.reduce((sum, e) => sum + (e.pack ? 0 : e.count), 0);
    const singles = floor.spawns.filter((sp) => !sp.pack && !sp.isGuard && !sp.isBoss);
    assert.equal(singles.length, expected);
    assert.equal(floor.spawns.filter((sp) => sp.isGuard).length, def.guard ? 1 : 0);
    assert.equal(floor.spawns.filter((sp) => sp.isBoss).length, def.boss ? 1 : 0);
    for (const sp of floor.spawns) {
      assert.equal(typeof sp.type, 'string');
      assert.ok(sp.homeRoom >= 0 && sp.homeRoom < floor.rooms.length);
      assert.equal(typeof sp.isGuard, 'boolean');
    }
    const guard = floor.spawns.find((sp) => sp.isGuard);
    if (guard) {
      assert.equal(guard.type, def.guard);
      assert.equal(guard.homeRoom, floor.roles.cache);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Floor 8 (WLD-13)
// ---------------------------------------------------------------------------------------------

test('@m03 ACC-77 gen: floor 8 loads verbatim with Tick at (5,4), the Understudy at (51,5) and the Unfinished at (24,18) and (50,18)', () => {
  const floor = loadFixedFloor(8);
  assert.equal(floor.tiles.length, 24);
  for (const row of floor.tiles) assert.equal(row.length, 60);

  const map = FLOORS[8].fixedMap;
  const expectedTile = { '#': TILE.WALL, '.': TILE.FLOOR, '+': TILE.DOOR_CLOSED, '@': TILE.FLOOR, U: TILE.FLOOR, C: TILE.CHAIR, E: TILE.ESCAPEMENT, 1: TILE.FLOOR, 2: TILE.FLOOR };
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 60; x++) {
      assert.equal(floor.tiles[y][x], expectedTile[map[y][x]], `tile ${x},${y} ('${map[y][x]}')`);
    }
  }

  assert.deepEqual(floor.start, { x: 5, y: 4 });
  assert.deepEqual(floor.features.start, { x: 5, y: 4 });
  assert.equal(tileAt(floor, 11, 4), TILE.DOOR_CLOSED); // the entry-trigger door of BST-06
  assert.deepEqual(floor.features.chair, { x: 52, y: 4 });

  const understudy = floor.spawns.filter((sp) => sp.type === 'The Understudy');
  assert.equal(understudy.length, 1);
  assert.deepEqual({ x: understudy[0].x, y: understudy[0].y }, { x: 51, y: 5 });
  assert.equal(understudy[0].isBoss, true);

  const unfinished = floor.spawns.filter((sp) => sp.type === 'The Unfinished').map((sp) => ({ x: sp.x, y: sp.y }));
  assert.deepEqual(unfinished, [{ x: 24, y: 18 }, { x: 50, y: 18 }]);

  assert.equal(countTiles(floor, TILE.STAIRS_UP), 0);
  assert.equal(countTiles(floor, TILE.STATION), 0);
  assert.deepEqual(floor.items, []);
  assert.deepEqual(floor.rooms, []);
  assert.equal(floor.hazards.length, 0);
  assert.deepStrictEqual(generateFloor('ANY-SEED', 8), floor, 'floor 8 never depends on the seed');
});

// ---------------------------------------------------------------------------------------------
// TEC-14 performance
// ---------------------------------------------------------------------------------------------

test('@m03 @unit gen: mean generation time over 200 floors is under 50 ms (TEC-14)', () => {
  const jobs = [];
  for (let s = 0; s < 200; s++) jobs.push([`PERF-${s}`, 1 + (s % 7)]);
  generateFloor('PERF-warmup', 1); // let the JIT see the code once before it is timed
  const t0 = process.hrtime.bigint();
  for (const [seed, n] of jobs) generateFloor(seed, n);
  const meanMs = Number(process.hrtime.bigint() - t0) / 1e6 / jobs.length;
  assert.ok(meanMs < 50, `mean generation took ${meanMs.toFixed(2)} ms`);
});
