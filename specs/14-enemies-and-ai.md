# 14 — Enemies and AI

**Status:** Wave 2 — core rules. Every actual enemy is in `22-bestiary.md`.
**Purpose:** Define how enemies perceive, wake, remember, move, and attack, as a small set of archetypes
that the bestiary combines with numbers. The lore constraint is `STY-03`: every enemy is running one
residual instruction, and its archetype should read as that instruction.

---

## ENM-01 Enemy definition fields

In addition to `CMB-01`, each enemy **type** defines:

| Field | Meaning |
|---|---|
| `archetype` | One of `CHASER`, `GUARD`, `SKIRMISHER`, `SWARMER`, `BRUISER`, `ERRATIC`, `BOSS` |
| `perception` | Sight radius for waking and tracking (Chebyshev, through the enemy's own shadowcast) |
| `packSize` | For `SWARMER`: `min–max` spawned together; else 1 |
| `range`, `rangedAttack`, `windUp` | For `SKIRMISHER` (and bosses): ranged dice, range, and whether the shot needs a telegraph turn |
| `heavyAttack` | For `BRUISER`: dice of the telegraphed heavy hit |
| `opensDoors` | `YES`, `NO`, or `BREAKS` (`ENM-09`) |
| `immunities` | Subset of the five statuses |
| `xp`, `dropChance`, `dropTable` | `CHR-06`, `ITM-11` |
| `noise` | Radius of this enemy's special action, if any |
| `description` | ≤ 25 words |

Each enemy **instance** also tracks: `state` (ENM-03), `lastKnown` (a tile or none), `lastKnownAge`
(turns since set), `homeTile` and `homeRoom` (for `GUARD`), `windingUp` (boolean), `energy`, `statuses`.

## ENM-02 What enemies know

- An enemy **sees** Tick if Tick's tile is within its `perception` radius by the same FOV rule as
  `WLD-05` computed from the enemy's tile. **Blinded** enemies see only adjacent tiles.
- Enemies do not see or react to each other, items, or hazards except as pathing obstacles.
- Enemies have perfect knowledge of the map layout for pathfinding (they live here).

## ENM-03 States

```
DORMANT ──(sees Tick | noise in range | takes damage)──▶ ACTIVE
ACTIVE  ──(lastKnownAge > 8 and does not see Tick)──▶ DORMANT   (GUARD: RETURNING first)
RETURNING (GUARD only) ──(reaches homeTile)──▶ DORMANT
```

- **DORMANT:** gains no energy, does nothing, is drawn normally (no visual difference — *Rationale:*
  the player must inspect to learn whether an enemy is awake; the inspect line reports "dormant" or
  "active", see `UI-11`). Dormant enemies still block movement and can be attacked.
- **ACTIVE:** runs its archetype every action.
- Bosses are never Dormant after their entry trigger (`22`).
- On entering ACTIVE, `energy` is set to 0, and an enemy that became Active during the current turn
  (by any cause, at any point in the loop) **gains no energy in that turn's enemy phase**. A newly
  woken enemy therefore never acts on the turn it wakes, whatever its speed: the player always gets
  one turn of warning.

## ENM-04 Waking

An enemy becomes ACTIVE when any of these occur; the check happens at the moment of the event:

1. It sees Tick (checked at the start of each enemy phase for every Dormant enemy).
2. A noise (`CMB-11`) with radius `r` occurs within Chebyshev distance `≤ r` of it. Walls do not
   block noise.
3. It takes any damage.
4. A boss-specific trigger (`22`).

On waking by sight, `lastKnown = Tick's tile`. On waking by noise, `lastKnown = the noise source
tile`. On waking by damage, `lastKnown = Tick's tile` if Tick is within 10 tiles, else the damage
source tile. `lastKnownAge = 0`.

## ENM-05 Tracking

At the start of each of its actions an Active enemy updates:

- If it sees Tick: `lastKnown = Tick's tile`, `lastKnownAge = 0`.
- Else: `lastKnownAge += 1`. Any noise event during the previous player turn within its
  `perception + 3` sets `lastKnown` to the noise tile and `lastKnownAge = 0`.
- If `lastKnownAge > 8`: `GUARD` → RETURNING; others → DORMANT (and `energy = 0`).

## ENM-06 Archetypes

Each archetype is a decision list evaluated top to bottom on each action; the first applicable line is
performed. "Adjacent" means the 8-neighborhood. "Step toward X" means take the first step of the path
in ENM-08; if there is no path or the first step is blocked, **Wait**.

### CHASER — *residual instruction: clear this floor*

1. If adjacent to Tick → **Melee Attack** (`CMB-06`).
2. If `lastKnown` is set → step toward `lastKnown`. If already on it and Tick not seen → Wait.
3. Else → Wait.

### GUARD — *guard this room*

Has `homeRoom` (the room it spawned in) and `homeTile` (its spawn tile). "In bounds" = Tick's tile is
inside `homeRoom`'s interior or within Chebyshev distance 2 of that interior.

1. If RETURNING: if on `homeTile` → become DORMANT; else step toward `homeTile`.
2. If adjacent to Tick → Melee Attack.
3. If Tick is in bounds and `lastKnown` set → step toward `lastKnown`.
4. If Tick is not in bounds → become RETURNING (this action is a step toward `homeTile`).
5. Else → Wait.

Guards wake by sight or noise like anyone, but a Guard that wakes with Tick out of bounds goes straight
to RETURNING → DORMANT. *Rationale:* rooms with guards can be skipped by not entering them.

### SKIRMISHER — *announce the hour*

Has `range`, `rangedAttack`, `windUp`.

1. If `windingUp` → **Fire** at Tick if Tick is seen and in range with a clear line (`CMB-08`);
   otherwise cancel (`windingUp = false`) and Wait. Either way, clear `windingUp`.
2. If Tick is adjacent → **Retreat**: move to the neighboring tile that maximizes Chebyshev distance
   to Tick (ties: the one that is not adjacent to any other enemy; then lowest reading order). If no
   neighboring tile increases distance → Melee Attack (Skirmishers' melee is weak per `22`).
3. If Tick is seen, in range, with a clear line → if `windUp` is `YES` set `windingUp = true` and Wait
   (the enemy is drawn in its **telegraph color**, `UI-09`); else Fire.
4. If `lastKnown` set → step toward `lastKnown`.
5. Else → Wait.

### SWARMER — *eat the oil*

Same decision list as CHASER. Differences are in the data: `FAST`, low Integrity, `packSize > 1`,
`opensDoors: NO`, and swarmers ignore the "other enemies block paths" rule in ENM-08 for the purpose
of *choosing* a path (they will still Wait if the actual next tile is occupied).

### BRUISER — *regulate the mechanism*

Has `heavyAttack`.

1. If `windingUp`: if Tick is adjacent → **Heavy Attack**: as `CMB-06` but with `heavyAttack` dice and
   accuracy +10; else nothing. Then `windingUp = false`.
2. If adjacent to Tick → `windingUp = true` (drawn in telegraph color). This action does nothing else.
3. If `lastKnown` set → step toward `lastKnown`.
4. Else → Wait.

Bruisers are `SLOW`, so the sequence *wind up → hit* spans two player turns after they arrive: the
player always has a turn to step away. Bruisers `BREAKS` doors. A Bruiser never makes a plain melee
attack; its `attack` field is `0 (flat)` and the inspect line and popup (`UI-05`, `ENM-11`) show its
`heavyAttack` dice as its damage.

### ERRATIC — *no instruction*

The only archetype that uses randomness in decisions. Roll `d10` each action:

- `1–5`: behave as CHASER line 1–2 (attack if adjacent, else step toward `lastKnown`).
- `6–8`: move to a uniformly random walkable, unoccupied neighboring tile (if none, Wait).
- `9–10`: Wait.

Erratics never go Dormant once woken.

### BOSS

Bosses run a **phase script** defined per boss in `22-bestiary.md`: a list of phases keyed by Integrity
thresholds, each phase naming an archetype-like decision list plus special actions (with their noise,
telegraphs, and Tension-like decay where the story requires it, `STY-02`). The framework guarantees:
every special action is telegraphed one turn ahead by the telegraph color and a log line; bosses are
immune to nothing unless `22` says so, but have a per-status **cap** (a maximum duration, e.g. Stun 1).

## ENM-07 Enemy melee and ranged attacks

Use `CMB-06` / `CMB-08` with the enemy's own `accuracy`, `attack` (or `rangedAttack`), and Tick's
`evasion` and `plating`. Enemy attacks never add a force bonus. Enemy ranged attacks emit the noise
listed for that enemy.

## ENM-08 Pathfinding

- **Algorithm:** A* on the 8-connected grid, cost 1 per step (diagonals also 1), heuristic Chebyshev
  distance. Ties broken by lowest `f` then lowest `h` then reading order of the tile. Deterministic.
- **Passable for pathing:** Floor, open doors, features, spent or unspent stations, stairs, scrap
  tiles; closed doors only if `opensDoors ≠ NO`; hazard tiles per `WLD-08` (Grinding Gears
  impassable unless no path exists at all — in that case the enemy re-plans with them passable;
  cyclic hazards impassable if they would be active on the enemy's arrival turn, i.e. next turn).
- **Occupied tiles** (any actor) are impassable, except the destination tile when it holds Tick.
  `SWARMER` plans as if other enemies were not there.
- If the first step is blocked at execution time, the enemy **Waits** (no swapping, no shoving).
- Path length is capped at 60; if the destination is farther, treat as no path.
- Enemies never move diagonally *through* a door tile's diagonal (a door is entered and left
  orthogonally): a step is illegal if either the source or the destination is a door tile and the
  step is diagonal. The same rule applies to Tick.

## ENM-09 Doors and enemies

| `opensDoors` | Behavior |
|---|---|
| `YES` | Stepping into a closed door opens it (that is the action; the enemy does not move this action). Noise 3. |
| `NO` | Closed doors are walls to this enemy. |
| `BREAKS` | Stepping into a closed door turns it into Floor permanently. Noise 6. The enemy does not move this action. |

Enemies never close doors.

## ENM-10 Spawning during play

There are no random spawns after floor generation. The only enemies added during a floor are those a
boss script summons (`22`), and they appear on the marked tiles (`WLD-13`) or, for floors 3 and 6,
on the boss's room tiles chosen by `23`.

## ENM-11 Legibility requirements (binding on `22`)

- Every enemy type has one job that the player can learn in one encounter; its description states it
  in plain words.
- Every attack other than a plain melee hit is telegraphed one turn ahead.
- The inspect popup for an enemy shows: name, Integrity `cur/max`, accuracy vs. Tick as a %, damage
  range vs. Tick after Plating, Plating, speed, state (dormant/active/winding up), statuses with
  durations, and its description (`UI-11`).
