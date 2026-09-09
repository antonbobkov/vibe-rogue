# 10 — Turns and Combat

**Status:** Wave 2 — core rules. Wave 3 supplies the numbers that plug into these formulas.
**Purpose:** Define exactly what happens when the player presses a key: the order of resolution, the
energy system, every action, every formula, every status effect, and death. Nothing in this document
depends on specific items, skills, or enemies except as examples.

---

## CMB-01 Actors and their stats

Every actor (Tick and every enemy) has these fields. Wave 3 fills in the values.

| Field | Meaning | Tick's source | Enemy's source |
|---|---|---|---|
| `integrity`, `integrityMax` | Hit points | `11-character-and-skills.md` | `22-bestiary.md` |
| `accuracy` | Base % chance to hit before the target's evasion | `80 + 5 × Precision + weapon accuracy modifier` | fixed per type |
| `evasion` | Subtracted from the attacker's accuracy | `10 + attachment/skill modifiers − plating item's evasion penalty` | fixed per type |
| `plating` | Flat damage reduction | plating item + attachment + skill bonuses (this is the **Plating** attribute) | fixed per type |
| `attack` | Damage dice for a melee attack | equipped weapon's dice (unarmed: `1d2`) | fixed per type |
| `force` | Flat bonus to melee damage | the **Force** attribute | always 0 (enemy dice already include it) |
| `speed` | Speed tier: `SLOW`, `NORMAL`, `FAST` | always `NORMAL` (see CMB-04 for Slowed) | fixed per type |
| `energy` | Accumulator for the energy system | not used for Tick | starts at 0 |
| `statuses` | Map of status → remaining turns | | |
| `position` | Tile coordinates | | |

Enemies additionally have `archetype` and AI fields defined in `14-enemies-and-ai.md`.

## CMB-02 The turn loop

A **turn** is one player action that costs time. The loop below is executed exactly once per such
action. Free actions (CMB-05) do not run this loop.

1. **Resolve the player's action** (movement, attack, item use, skill…). Any damage, noise, status
   application, or death check that the action itself specifies happens here.
2. **Advance the clock.** `turn += 1`; `decayCounter += 1`. If `decayCounter ≥ decayPeriod` (5; 6 with
   the **Governor** attachment, `CAT-05`), Tick loses 1 Tension and `decayCounter = 0` (`CHR-04`).
3. **Player status tick** (CMB-10): apply per-turn effects (e.g. Burning damage), then decrement
   durations, then remove expired statuses.
4. **Hazard tick for Tick** (`WLD-08`): if Tick is standing on a hazard tile that is active this turn,
   apply its standing effect.
5. **Death check** for Tick (CMB-12). If dead, stop and go to the Death screen.
6. **Enemy phase** (CMB-03).
7. **Enemy status and hazard tick**: for each living enemy, in id order: status tick, then hazard
   standing effect, then death check.
8. **Level-up check** (`CHR-07`): if Tick has enough XP, open the Skills screen (this is a free
   interruption; the loop is already complete).
9. **Autosave** (`TEC-09`).
10. **Recompute FOV, render.**

*Rationale:* Putting decay in step 2 before status ticks means a player at 1 Tension who takes a
5th-turn action dies from the clock before, not after, enemies act. This is intended: the clock is
the first killer.

## CMB-03 Energy system and the enemy phase

- Speed tiers grant energy per player turn: `SLOW = 50`, `NORMAL = 100`, `FAST = 200`.
- An enemy may act when `energy ≥ 100`; acting costs exactly 100.
- **Enemy phase**, executed in step 6:
  1. Every living, non-**Dormant** (`ENM-03`) enemy gains energy equal to its current speed tier's value.
     Dormant enemies gain no energy and keep `energy = 0`.
  2. Repeat **passes** until a pass performs no actions: in a pass, iterate enemies in ascending `id`
     (spawn order); each enemy with `energy ≥ 100` performs one AI action (`14-enemies-and-ai.md`)
     and spends 100. An enemy that dies mid-pass is skipped thereafter.
  3. Energy is capped at 200 after gaining (so a stunned Fast enemy cannot bank actions).
- Consequences: a `SLOW` enemy acts on every second player turn (the first time on the second turn
  after waking). A `FAST` enemy acts twice per player turn, and its two actions are separated by every
  other enemy's first action (passes interleave). This is the only source of "double moves".
- **Stunned** enemies (CMB-10) have their energy set to 0 in step 1 of the enemy phase instead of gaining.

## CMB-04 Tick's speed

Tick has no energy counter; the loop *is* Tick's action. When Tick is **Slowed** (CMB-10), step 6 runs
the enemy phase **twice** in a row (energy grant + passes, then again) for each player action. When
Tick is Stunned, the player's only permitted action is **Wait**, and the loop runs normally.

## CMB-05 Actions

Every player input maps to exactly one of these. Keys and mouse mappings are in `15-ui-and-controls.md`;
this table defines the effect.

| Action | Costs a turn? | Effect |
|---|---|---|
| **Move** (8 directions) | Yes | If the target tile holds a living enemy → **Melee Attack** it instead. If the target tile is a closed door → open it (door becomes open; Tick does not move). If the target tile is walkable and unoccupied → move there. Otherwise (a wall, or a tile occupied by a non-enemy actor such as the Decoy) → no turn is spent and the log says why ("The wall is solid."). Diagonal moves are always allowed, including between two walls (no corner cutting rule). |
| **Wait** | Yes | Nothing. The only action allowed while Stunned. |
| **Pick up** | Yes | Take the item on Tick's tile into inventory (`ITM-06`). If no item, no turn is spent. If the inventory is full, no turn is spent and the log says so. |
| **Interact** | Yes | Use the feature on Tick's tile: an unspent Winding Station (`CHR-05`) or the up-stairs (equivalent to **Ascend**). If nothing to interact with, no turn is spent. |
| **Ascend** | Yes (ends the floor) | Only on the `<` tile. Immediately generates the next floor (`WLD-10`) and places Tick on its start tile. All statuses on Tick are cleared. Enemies on the old floor are discarded. |
| **Close door** | Yes | Choose a direction; if the adjacent tile is an open door with no actor or item on it, it becomes closed. Otherwise no turn is spent. |
| **Use consumable** | Yes | Apply an instant consumable's effect (`ITM-09`). |
| **Throw** | Yes | Choose a throwable consumable and a target tile within range and in FOV (`CMB-08`). |
| **Fire** | Yes | Attack with the equipped ranged weapon at a target (`CMB-08`). Requires a ranged weapon; otherwise no turn is spent. |
| **Use skill** | Yes | Activate an active skill (`20-skills.md`). Costs its Tension; if Tick's Tension is less than the cost, no turn is spent and the log says so. |
| **Equip / Unequip / Drop** | Yes | From the inventory screen (`ITM-07`). Dropping onto a tile that already holds an item is refused without spending a turn. |
| **Free actions** | No | Open/close any screen, inspect, look mode, cycle targets, cancel, scroll the log, quit to title. |

A **Move** into a tile containing a dormant enemy is still an attack. Enemies are never displaced by
Tick.

## CMB-06 Melee attack resolution

Attacker `A` attacks defender `D` on an adjacent tile (8-neighborhood).

1. **Noise:** emit noise of radius 5 at the attacker's tile (`ENM-04`).
2. **Wake:** if `D` is Dormant it becomes Active immediately (before the hit roll).
3. **Hit roll:** `chance = clamp(A.accuracy − D.evasion, 15, 95)`. Roll `d100`; it is a hit if
   `roll ≤ chance`. On a miss: log "A misses D." and stop.
4. **Damage:** `raw = roll(A.attack) + A.force + situational modifiers`
   (from skills and statuses; each such modifier says whether it applies here).
   `dealt = max(0, raw − D.plating)`. If `D` is **Exposed**, `D.plating` is treated as 0.
5. **Apply:** `D.integrity −= dealt`. Log with numbers: "Tick hits the Sweeper for 4." or
   "The blow glances off the Gear-Golem." when `dealt = 0`.
6. **On-hit effects** from the weapon or skill (each defines its own trigger: on hit, or on damage ≥ N).
7. **Death check** for `D` (CMB-12).

Every enemy's `attack` is its own dice; enemies never wield items.

## CMB-07 Damage that is not an attack

Hazards, Burning, thrown consumables, and some skills deal damage directly. Each such source states
whether it **ignores Plating**. Sources that ignore Plating skip the subtraction entirely. There is no
hit roll for these. All damage is integer.

## CMB-08 Ranged attacks and throwing

- **Line of fire:** from the attacker's tile to the target tile along a Bresenham line
  (`TEC-11` specifies the exact variant). The projectile travels tile by tile; it stops at the first
  tile that is not walkable (wall, closed door, chair, Escapement wheel) or contains an actor. If it stops before the target tile, the
  actor or obstacle there is the actual target (for a ranged weapon) or the actual landing tile (for a
  throwable, which lands on the last passable tile before the obstacle).
- **Range:** Chebyshev distance `max(|dx|,|dy|)` from attacker to target must be ≤ the weapon's or
  throwable's range. The target tile must be in Tick's FOV.
- **Ranged weapon attack** by Tick: pay the weapon's Tension cost (if Tick cannot, refuse without
  spending a turn), emit noise radius 4, then resolve exactly as CMB-06 steps 2–7 against the actual
  target, using the ranged weapon's dice and accuracy modifier and **not** adding `force`.
  Tick's ranged accuracy uses the same `80 + 5 × Precision + weapon modifier` base.
- **Enemy ranged attack:** same as above without a Tension cost; enemy-specific noise per bestiary.
- **Throwable:** the item leaves the inventory (one from the stack), emits noise radius 3 at the landing
  tile, and applies its effect to the landing tile and, if it has one, its radius (Chebyshev) — every
  actor in the area, including Tick, is affected. No hit roll.
- Firing or throwing at an adjacent enemy is allowed.

## CMB-09 Knockback

Some effects push an actor 1 tile directly away from the source (the direction is the sign of
`(target − source)` per axis). If the destination tile is not walkable or is occupied, the push does
nothing (no damage, no bonus). Pushed actors do not trigger hazard **enter** effects; they do trigger
**standing** effects at the next tick as normal.

## CMB-10 Status effects

Exactly five statuses exist. Each has an integer duration in turns.

| Status | Effect while active | Per-turn effect (step 3 / 7) | Notes |
|---|---|---|---|
| **Stunned** | Actor cannot act (enemies: energy set to 0 each phase; Tick: only Wait). | — | Applying Stun to an already Stunned actor: duration = `max(remaining, new)`. Bosses have Stun caps in `22`. |
| **Slowed** | Speed tier lowered by one (`FAST→NORMAL`, `NORMAL→SLOW`, `SLOW` unchanged). Tick: enemy phase runs twice (CMB-04). | — | |
| **Burning** | Drawn with an orange glyph background. | Takes 2 damage, ignores Plating. | Automata burn (oil). Rust-moths take 4 instead. |
| **Blinded** | `accuracy − 30` (applied after everything else, before the clamp). Enemies also treat the target as unseen unless adjacent (`ENM-02`). | — | |
| **Exposed** | Plating treated as 0 against all damage. | — | |

- **Reapplication** always uses `duration = max(remaining, new)` — never additive.
- **Counting.** A status applied to an enemy during step 1 (by Tick) has its first decrement at that
  turn's step 7; a status applied to Tick during step 6 (by an enemy) has its first decrement at the next
  turn's step 3. A 1-turn status Tick applies therefore never affects Tick's next attack; a 2-turn one
  affects exactly one. Stunned N on an enemy costs it exactly N enemy phases.
- **Order within a status tick:** per-turn effects first (Burning damage), then all durations −1, then
  removal of any status at 0. A death from Burning is checked in step 5 / step 7.
- Statuses on Tick are cleared on Ascend. Statuses on enemies persist until expiry or death.
- Immunities are listed per enemy in `22-bestiary.md`; an immune actor simply never receives the status.

## CMB-11 Noise

An event that makes noise emits a value `r`. Every Dormant enemy whose Chebyshev distance from the
source is `≤ r` becomes Active (`ENM-03`), walls notwithstanding. Noise has no effect on Active
enemies except as stated in `ENM-06` (it updates their `lastKnown` target position). The standard
noise values:

| Event | Radius |
|---|---|
| Melee attack (any attacker) | 5 |
| Ranged weapon shot (Tick) | 4 |
| Throwable landing | 3 |
| Opening a door | 3 |
| Breaking an enemy (it dies) | 6 |
| Stepping onto a Grinding Gear | 6 |
| Enemy-specific (Cuckoo shriek etc.) | per `22` |
| Skill-specific | per `20` |

Moving, waiting, picking up, and using instant consumables are silent.

## CMB-12 Death

- An actor whose `integrity ≤ 0` is **broken**. An enemy is removed, leaves **scrap** (`WLD-04`) on its
  tile, awards XP (`CHR-06`), rolls its drop (`ITM-11`), and emits noise 6. Tick's death message is
  "Tick was broken by *[source]* on floor *N*." where source is the enemy name, hazard name, or
  status name (e.g. "Burning").
- Tick whose `Tension ≤ 0` is **wound down**: "Tick wound down on floor *N*." Checked whenever Tension
  changes.
- Death checks happen at the points listed in CMB-02 and CMB-06. Overkill is not tracked.
- Death is final: the autosave is deleted (`TEC-09`) before the Death screen is shown.

## CMB-13 Randomness

All dice, hit rolls, and percentages use the run's seeded PRNG (`TEC-07`) in a fixed call order so that
a seed reproduces a run given identical inputs. `dN` yields an integer in `[1, N]`; `d100` for hit
rolls; `NdS+M` per `OVR-07`.
