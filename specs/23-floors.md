# 23 — Floors

**Status:** Wave 3 — content. Generation rules are in `13-world-and-generation.md`.
**Purpose:** Every per-floor parameter: theme, generator inputs, hazards, item counts, loot tables,
spawn lists, guards, bosses, and the handcrafted floor 8.

---

## FLR-01 Spawn list format

Each floor's **spawn list** is a fixed list of entries; the generator places every entry (`WLD-11`
step 9). An entry `Type × n` places `n` individuals; `Type pack` places one pack of that SWARMER type
(pack size rolled from the bestiary); `Type pack (a–b)` overrides the pack-size range for that entry. Order of placement is the order listed. The **cache guard** is
placed last, in the cache room, with archetype GUARD (`BST-02`).

Loot tables (`ITM-10`) are written `Item w` with weight `w`. **Cache count** is rolled uniformly from
the given range.

## FLR-02 Floor 1 — The Workshop

- **Theme:** benches, vices, part racks, a cold forge. Tick's home. Tutorial floor; no hazards.
- **Generator:** `roomTarget 7`, `extraCorridors 1`, `doorChance 60`.
- **Hazards:** none.
- **Station:** spent at start (`CHR-01`); the start tile is the station tile.
- **Floor items:** 3. Floor table: `Solder 6, Spring-Key 4, Tin Plating 3, Mallet 3, Grit Bomb 2,
  Balance Wheel 1`.
- **Cache:** count 2–3. **Guarantee:** the first cache roll uses the table `Tin Plating 1, Brass Plating 1`
  (`ITM-12`); remaining rolls use `Mallet 3, Balance Wheel 2, Solder 3, Spring-Key 3, Grit Bomb 1`.
- **Spawn list:** `Rust-moth pack (3–4)`, `Sweeper × 3`. Cache guard: **Sweeper**.
- **Journal:** page 1.
- Nominal XP: 3.5 + 9 + 3 = **15.5**. Enemies 7–8.

## FLR-03 Floor 2 — The Gear Gallery

- **Theme:** the transmission — floor-to-ceiling gears, catwalks. Grinding Gears in the corridors.
- **Generator:** `roomTarget 8`, `extraCorridors 2`, `doorChance 60`.
- **Hazards:** **Grinding Gear × 6** on corridor tiles.
- **Floor items:** 4. Floor table: `Solder 6, Spring-Key 5, Cog Saw 2, Spring-Bolt Launcher 2,
  Brass Plating 2, Counterweight 1, Oil Flask 2, Clatter Can 2`.
- **Cache:** 2–3 from `Cog Saw 3, Spring-Bolt Launcher 3, Brass Plating 3, Counterweight 2,
  Balance Wheel 2, Spring-Key 2`.
- **Spawn list:** `Sweeper × 2`, `Spring-Hound × 1`, `Tin Soldier × 1`, `Rust-moth pack`.
  Cache guard: **Tin Soldier**.
- **Journal:** page 2.
- Nominal XP: 6 + 5 + 6 + 4 + 6 = **27**. Enemies 8–10.

## FLR-04 Floor 3 — The Music Room

- **Theme:** an automaton orchestra on a stage, music boxes, a dance floor.
- **Generator:** `roomTarget 8`, `extraCorridors 2`, `doorChance 70`.
- **Hazards:** none.
- **Floor items:** 4. Floor table: `Solder 5, Spring-Key 5, Tuning Fork 2, Iron Plating 2, Oil Flask 2,
  Grit Bomb 2, Cog Saw 1, Oil Reservoir 1`.
- **Cache:** 2–3 from `Iron Plating 3, Oil Reservoir 2, Spring-Bolt Launcher 2, Tuning Fork 2,
  Solder 2, Spring-Key 2, Balance Wheel 1`.
- **Spawn list:** `Music-box Dancer × 1`, `Cuckoo × 1`, `Sweeper × 1`, `Rust-moth pack`.
  Cache guard: **Tin Soldier**.
- **Boss:** **The Conductor** in the **stairs room** (`BST-04`). The stairs room is the "stage".
  **Scripted moment 1** (`SCR-05`) fires the first time any interior tile of the stairs room enters
  Tick's FOV; at that moment the Conductor counts Tick as seen.
- **Journal:** page 3.
- Nominal XP: 4 + 6 + 3 + 4 + 6 + 10 + up to 4 summoned dancers (16) = **33 + up to 16**. Enemies 8–10 + summons.

## FLR-05 Floor 4 — The Furnace Deck

- **Theme:** boilers, coal bunkers, steam. Hot.
- **Generator:** `roomTarget 8`, `extraCorridors 2`, `doorChance 50`.
- **Hazards:** **Steam Vent × 10**, placed on interior tiles of rooms with no role (`WLD-09`), at most
  4 per room, never adjacent to each other.
- **Floor items:** 4. Floor table: `Solder 5, Spring-Key 5, Flux 2, Escapement Blade 2, Iron Plating 2,
  Oil Reservoir 1, Grit Bomb 1, Clatter Can 1`.
- **Cache:** 2–3 from `Escapement Blade 3, Iron Plating 2, Oil Reservoir 2, Counterweight 1, Flux 2,
  Spring-Key 2, Solder 2`.
- **Spawn list:** `Stoker × 2`, `Gear-Golem × 1`, `Spring-Hound × 1`, `Sweeper × 2`.
  Cache guard: **Tin Soldier**.
- **Journal:** page 4.
- Nominal XP: 16 + 12 + 5 + 6 + 6 = **45**. Enemies 7.

## FLR-06 Floor 5 — The Aviary

- **Theme:** open galleries, perches, cages, a shattered skylight. Long sightlines.
- **Generator:** `roomTarget 9`, `extraCorridors 3`, `doorChance 40`.
- **Hazards:** none.
- **Floor items:** 4. Floor table: `Solder 5, Spring-Key 5, Harmonic Rifle 2, Pendulum Flail 1,
  Steel Plating 1, Lacquered Plating 2, Sounding Plate 1, Tuning Fork 2, Grit Bomb 2`.
- **Cache:** 2–3 from `Harmonic Rifle 3, Steel Plating 2, Lacquered Plating 2, Sounding Plate 2,
  Pendulum Flail 2, Spring-Key 2, Solder 2`.
- **Spawn list:** `Cuckoo × 3`, `Brass Finch pack`, `Brass Finch pack`, `Spring-Hound × 1`.
  Cache guard: **Tin Soldier**.
- **Journal:** page 5.
- Nominal XP: 18 + 7.5 + 7.5 + 5 + 6 = **44**. Enemies 9–11.

## FLR-07 Floor 6 — The Archive

- **Theme:** blueprint cabinets, drafting tables, shelves of parts for things never finished.
- **Generator:** `roomTarget 9`, `extraCorridors 1`, `doorChance 80`.
- **Hazards:** none.
- **Floor items:** 4. Floor table: `Solder 5, Spring-Key 5, Flux 2, Piston Hammer 1, Escapement Blade 2,
  Steel Plating 2, Oil Flask 2, Clatter Can 2, Sounding Plate 1`.
- **Cache:** 2–3 from `Piston Hammer 3, Steel Plating 2, Lacquered Plating 2, Harmonic Rifle 2, Flux 2,
  Solder 2, Spring-Key 2`, **plus** the **Understudy Blueprint** on an additional tile (`CAT-07`).
- **Spawn list:** `The Unfinished × 1`, `Archivist × 2`, `Tin Soldier × 1`, `Rust-moth pack`.
  Cache guard: **Pendulum Knight**.
- **Boss:** **The Regulator** in the **stairs room** (`BST-05`).
- **Journal:** page 6. **Scripted moment 2** (`SCR-05`) fires on picking up the Blueprint.
- Nominal XP: 9 + 16 + 6 + 4 + 12 + 12 = **59**. Enemies 9–11.

## FLR-08 Floor 7 — The Pendulum Stair

- **Theme:** a spiral stair around the shaft; the Great Pendulum sweeps through the middle of the map.
- **Generator:** `roomTarget 8`, `extraCorridors 3`, `doorChance 50`.
- **Hazards:** after step 4 of `WLD-11`, every Floor or door tile with `x ∈ [28, 31]` becomes a
  **Pendulum Sweep** tile (doors first become Floor). Then **Grinding Gear × 4** on corridor tiles
  outside the band. Features (`WLD-07`) are never placed in the band (their rooms' interior tiles in the
  band are excluded from feature placement; if a role room has no tile outside the band, regenerate).
  If after feature placement any feature tile is within Chebyshev 1 of the band, regenerate
  (`WLD-11` step 10).
- **Floor items:** 5. Floor table: `Solder 6, Spring-Key 6, Flux 2, Piston Hammer 1, Pendulum Flail 1,
  Steel Plating 1, Lacquered Plating 1, Oil Flask 2, Grit Bomb 2, Tuning Fork 2`.
- **Cache:** 2–3 from `Piston Hammer 2, Pendulum Flail 2, Steel Plating 2, Harmonic Rifle 1, Flux 2,
  Spring-Key 3, Solder 3`.
- **Spawn list:** `Pendulum Knight × 1`, `Stoker × 1`, `Cuckoo × 1`, `Music-box Dancer × 1`,
  `The Unfinished × 1`, `Brass Finch pack`. Cache guard: **Pendulum Knight**.
- **Journal:** page 7.
- Nominal XP: 12 + 8 + 6 + 4 + 9 + 7.5 + 12 = **58.5**. Enemies 8–10.

## FLR-09 Floor 8 — The Escapement (handcrafted)

- **Theme:** one circular chamber around the escapement wheel; Aurelie's chair; the Understudy beside it.
- **Map** (`WLD-13` legend; 60 columns × 24 rows, verbatim):

```
############################################################
#..........#################################################
#..........###########................................######
#..........##########..................................#####
#....@.....+........................................C...####
#..........########................................U.....###
#..........#######........................................##
##################.........#..................#...........##
##################........................................##
##################........................................##
##################..................EEEE..................##
##################..................EEEE..................##
##################..................EEEE..................##
##################........................................##
##################........................................##
##################.........#..................#...........##
##################........................................##
##################........................................##
###################.....1.........................2......###
####################....................................####
#####################..................................#####
######################................................######
############################################################
############################################################
```

- **Enemies at start:** **The Unfinished** at markers `1` and `2` (Dormant). **The Understudy** at `U`.
- **Entry trigger:** opening the door `+` at (11, 4) (`BST-06`).
- **No** stairs, station, cache, floor items, or journal room. Journal page 8 is delivered by the ending
  sequence (`SCR-07`).
- The two pillars (`#` at (27,7), (46,7), (27,15), (46,15)) and the `EEEE` block are the only sight
  blockers inside the chamber.
- Nominal XP: 18 + 18 (Phase 2 summons) = **36**.

## FLR-10 Totals (for `31-balance.md`)

Nominal XP by floor: 15.5 · 27 · 33 (+16 summons) · 45 · 44 · 59 · 58.5 · 36 → **318** without
Conductor summons, **334** with. Cumulative at 75% kills: 11.6 · 31.9 · 56.6 · 90.4 · 123.4 · 167.7 ·
211.6 · 238.6 — reaching level 2, 3, 4, 5, 6, 7, 8, 9 at the end of floors 1–8 respectively
(`CHR-06` thresholds), matching `OVR-04`.
