# 13 — World and Generation

**Status:** Wave 2 — core rules. Per-floor parameters are in `23-floors.md`.
**Purpose:** Define tiles, features, hazards, the level generator step by step, field of view, and the
format of the handcrafted floor 8. A builder must be able to produce identical maps from identical
seeds by following this document and `TEC-07`.

---

## WLD-01 Coordinates and size

- Every floor is a grid of `60 × 24` tiles, `x ∈ [0, 59]` left→right, `y ∈ [0, 23]` top→bottom.
- The outer ring (`x = 0`, `x = 59`, `y = 0`, `y = 23`) is always wall.
- The map is drawn 1:1 in the 60×24 viewport (`UI-02`); there is no camera.

## WLD-02 Tile types

| Tile | Glyph | Walkable | Blocks sight | Notes |
|---|---|---|---|---|
| **Wall** | `#` | No | Yes | |
| **Floor** | `.` | Yes | No | |
| **Closed door** | `+` | No (bump opens) | Yes | Opened by Tick or by an enemy allowed to (`ENM-09`). |
| **Open door** | `'` | Yes | No | Can be closed by Tick if empty (`CMB-05`). |
| **Up-stairs** | `<` | Yes | No | Exactly one per floor 1–7. Interact/Ascend. |
| **Winding Station** | `&` | Yes | No | One per floor 1–7. Bright when unspent, dim when spent. |
| **Grinding Gear** (hazard) | `^` | Yes | No | Constant hazard (WLD-08). |
| **Steam Vent** (hazard) | `^` | Yes | No | Cyclic hazard (WLD-08). Distinct color. |
| **Pendulum Sweep** (hazard) | `~` | Yes | No | Cyclic hazard (WLD-08). Floor 7 only. |
| **Escapement** | `@`-adjacent set piece | No | No | Floor 8 only; see `23-floors.md` legend. |

**Scrap** (`WLD-04`) is not a tile: it is a decoration flag on a floor tile.

## WLD-03 Rooms

A **room** is a rectangle of floor tiles (its *interior*) with wall on all four sides. Interior width
`w ∈ [4, 10]`, height `h ∈ [3, 7]`. Rooms are the only places items, features, and (initially) enemies
are placed, except as noted for corridor hazards. Every room has an integer `id` in creation order.

## WLD-04 Scrap

When an enemy breaks, its tile gets the `scrap` flag: drawn as `%` in the enemy's color at 45%
brightness (`UI-09`), under any item. Purely cosmetic; walkable; never removed.

## WLD-05 Field of view

- Algorithm: **symmetric shadowcasting** (the "Albert Ford" formulation: recursive per-octant scan with
  slope intervals, symmetric variant). `TEC-11` names the exact reference implementation to match.
- Radius: a tile is visible only if `max(|dx|, |dy|) ≤ 8` (Chebyshev) *and* the shadowcast reaches it.
- Walls and closed doors block sight but are themselves visible when reached (the wall you can see is
  drawn).
- The player's own tile is always visible.
- **Memory:** every tile ever visible is remembered with its terrain and the item that was on it when
  last seen. Remembered tiles are drawn dim (`UI-09`). Enemies are never drawn on remembered-only tiles.
  Scrap is remembered.
- Enemies use the same algorithm from their own tile with their own perception radius (`ENM-05`).
  Because the algorithm is symmetric, "Tick sees the enemy" ⇔ "the enemy's shadowcast reaches Tick"
  whenever both radii cover the distance.

## WLD-06 Doors

- Doors are placed only where a corridor meets a room wall (WLD-11 step 4).
- A door tile is never adjacent (8-neighborhood) to another door tile; if generation would create one,
  the second becomes floor instead.
- Opening a door emits noise 3 (`CMB-11`). Closing is silent.

## WLD-07 Features

| Feature | Placement (WLD-11) | Rule |
|---|---|---|
| **Player start** | Center tile of the start room (integer-floor of the center). Floors 2–8: this is where Tick appears on arrival. | Never adjacent to a hazard. |
| **Up-stairs** `<` | Random interior tile of the stairs room. | Never adjacent to a hazard. |
| **Winding Station** `&` | Random interior tile of the station room that is orthogonally adjacent to a wall. On floor 1 it is the player start tile itself and is spent. | Never adjacent to a hazard; never on the same tile as an item. |
| **Journal page** `?` | Random interior tile of the journal room. | Room ≠ start room, ≠ cache room. |
| **Cache items** | 2–3 distinct interior tiles of the cache room. | Cache room also receives one **guard** enemy (`23`). |
| **Escapement / chair** | Floor 8 only, fixed. | See WLD-13. |

## WLD-08 Hazards

Two mechanisms; three configurations. Hazards are visible from the start (no hidden traps).

| Name | Mechanism | Trigger | Effect | Floors |
|---|---|---|---|---|
| **Grinding Gear** | Constant | **Enter** (moving onto it; not knockback) | 3 damage, ignores Plating; noise 6. | 2, 7 |
| **Steam Vent** | Cyclic, period 6, active on turns where `turn mod 6 ∈ {0, 1}` | **Standing** at step 4/7 while active, or **Enter** while active | 4 damage, ignores Plating; **Burning** 2. | 4 |
| **Pendulum Sweep** | Cyclic, period 8, active on `turn mod 8 == 0` | **Standing** at step 4/7 while active, or **Enter** while active | 6 damage, ignores Plating; **Stunned** 1. | 7 |

- "Active" uses the global `turn` counter after step 2 of `CMB-02`, so the panel can show "vents in
  *n*" (`UI-06`). Cyclic hazards are drawn bright while active and dim otherwise, and additionally
  drawn in a warning color on the turn *before* they become active.
- Enemies path around hazards that are active or would be active on their arrival turn (`ENM-08`);
  they treat Grinding Gears as impassable unless no other path exists.
- Hazards affect enemies exactly as they affect Tick (immunities per `22`).

## WLD-09 Room roles

Each floor 1–7 assigns these roles to distinct rooms (WLD-11 step 5): **start**, **stairs**,
**station**, **cache**, **journal**. A floor therefore needs ≥ 5 rooms.

## WLD-10 Floor lifecycle

Floors are generated on arrival (Ascend) from `floorSeed = hash(runSeed, floorNumber)` (`TEC-07`),
never before. A floor that fails validation (WLD-11 step 10) is regenerated with `floorSeed + 1`, up
to 50 times; after that the builder must throw — this must never happen with the parameters in `23`
and `ACC` tests it. Only the current floor exists; leaving a floor discards it entirely.

## WLD-11 Generation algorithm (floors 1–7)

All random choices use the floor's PRNG in the order written. Per-floor parameters
(`roomTarget`, `extraCorridors`, `doorChance`, hazard counts, item counts, enemy tables) come from
`23-floors.md`.

1. **Fill** the grid with Wall.
2. **Rooms.** Repeat up to 300 attempts, stopping early when `rooms.length == roomTarget`:
   draw `w ∈ [4,10]`, `h ∈ [3,7]`, `x ∈ [1, 58 − w]`, `y ∈ [1, 22 − h]` (interior top-left). Accept if
   the rectangle *expanded by 2 in each direction* contains no existing room interior tile (this keeps a
   ≥ 2-tile wall gap between rooms so doors are never adjacent). Carve the interior as Floor.
   If fewer than 5 rooms result, fail validation.
3. **Spanning corridors.** Sort rooms by interior center `x` (ties by `y`). For each consecutive pair
   `(A, B)`: pick a random interior tile `a` of A and `b` of B; with 50% chance carve horizontal-then-
   vertical, else vertical-then-horizontal, using **corridor carving** below.
4. **Extra corridors.** `extraCorridors` times: pick two distinct random rooms and carve as in step 3.
   **Corridor carving:** walk tile by tile; each tile that is Wall becomes Floor, *except* when the
   tile is on a room's boundary wall (orthogonally adjacent to that room's interior and not to any
   other room's interior): then with probability `doorChance` it becomes a Closed door, else Floor.
   Corridors passing through an existing room interior leave it unchanged. Apply WLD-06's adjacency
   rule after all carving.
5. **Room roles.**
   - `start` = the room with the smallest center `x` (ties: smallest `y`).
   - Compute BFS distance over walkable-or-door tiles from the start room's center to every room's
     center. Rooms unreachable → fail validation.
   - `stairs` = the room with the greatest BFS distance (ties: lowest `id`).
   - `station` = among rooms other than start/stairs, the one whose distance is closest to
     `stairsDistance / 2` (ties: lowest `id`).
   - `cache` = among remaining rooms, prefer those with exactly one door-or-corridor opening in their
     boundary (dead ends); among candidates, the one farthest from start (ties: lowest `id`). If no
     dead end, the remaining room farthest from start.
   - `journal` = among remaining rooms, a uniformly random one.
   With exactly 5 rooms all roles are still assignable; with fewer, validation already failed.
6. **Features** per WLD-07, in the order: player start, stairs, station, journal page, cache items
   (rolled from the cache table, `ITM-10`), cache guard.
7. **Hazards.** For each hazard configuration on this floor, place `count` hazard tiles:
   Grinding Gears go on **corridor** Floor tiles (tiles not inside any room interior, not doors);
   Steam Vents and Pendulum Sweeps go where `23` says (room interiors, or a fixed band for the
   Pendulum). Never on a feature, door, or item tile; never adjacent to the start tile, stairs, or
   station; never two Grinding Gears adjacent. If a valid tile cannot be found after 100 draws, place
   fewer.
8. **Floor items.** `itemCount` times: roll the floor table, place on a random interior tile of a
   random room other than start, with no item already there (retry up to 50 times, then skip).
9. **Enemies.** For each entry produced by the floor's spawn table (`23`): choose a random room other
   than start; choose a random interior tile with no actor, no feature, no hazard; require BFS
   distance from player start ≥ 8 (retry 50 times, else any valid tile ≥ 3). Pack types place their
   whole pack on distinct tiles within Chebyshev distance 2 of the first, falling back to any free
   interior tile of the same room. All enemies begin **Dormant**.
10. **Validate:** ≥ 5 rooms; every room reachable from start; stairs, station, journal page all placed;
    cache has ≥ 2 items. Otherwise regenerate (WLD-10).

## WLD-12 Item and enemy placement invariants

- Items only on room interior Floor tiles (never corridor, door, feature, hazard).
- No two items on one tile.
- No enemy in the start room; no enemy visible from the player start on arrival (the builder checks
  FOV from the start tile and moves any visible enemy to another valid tile; retry 20 times, then
  accept).

## WLD-13 Floor 8 format

Floor 8 is not generated. `23-floors.md` provides a 60×24 character map using this legend; the builder
loads it verbatim.

| Char | Meaning |
|---|---|
| `#` | Wall |
| `.` | Floor |
| `+` | Closed door |
| `@` | Player start (Floor beneath) |
| `U` | The Understudy's start tile (Floor beneath) |
| `C` | Aurelie's chair — a non-walkable, non-sight-blocking set piece; the journal page 8 is placed here after the boss dies (`STY-04`). |
| `E` | Escapement wheel — non-walkable, non-sight-blocking. |
| `1`–`9` | Enemy spawn markers referenced by the floor 8 encounter script in `23` |
| `~` | Pendulum Sweep hazard (only if `23` uses it) |

Floor 8 has no stairs, station, cache, or floor items. Winning is by defeating the Understudy.
