# 22 — Bestiary

**Status:** Wave 3 — content. Rules are in `14-enemies-and-ai.md` and `10-turns-and-combat.md`.
**Purpose:** Every enemy and boss with every number, string, and behavior script.

---

## BST-01 Additional palette entries

No additions: every color name used below (`iron`, `lime`, `gold`, …) is defined in `UI-08`.

## BST-02 Regular enemies

Fields per `ENM-01`. `Acc` = accuracy, `Eva` = evasion, `Plt` = plating, `Per` = perception.
`Doors`: Y/N/B. Drop table entries are `(item, weight)`.

| Name | Glyph | Color | Int | Acc | Eva | Plt | Attack | Speed | Archetype | Per | Doors | XP | Drop % | Drop table | Immune | Floors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Rust-moth** | `m` | rust | 2 | 60 | 25 | 0 | `1` (flat) | FAST | SWARMER (pack 3–5; floor 1 overrides to 3–4, `FLR-02`) | 7 | N | 1 | 5 | Grit Bomb 1 | — | 1, 2, 3, 4, 5, 6, 7 |
| **Sweeper** | `s` | steel | 7 | 65 | 5 | 0 | `1d3` | NORMAL | CHASER | 7 | Y | 3 | 15 | Grit Bomb 1 | — | 1, 2, 3, 4 |
| **Spring-Hound** | `h` | copper | 8 | 75 | 15 | 0 | `1d3` | FAST | CHASER | 9 | N | 5 | 15 | Grit Bomb 1 | — | 2, 3, 4, 5 |
| **Tin Soldier** | `t` | silver | 16 | 75 | 5 | 1 | `1d4+1` | NORMAL | GUARD | 7 | Y | 6 | 25 | Tin Plating 1 | — | 2, 3, 4, 5, 6 |
| **Music-box Dancer** | `d` | pink | 12 | 75 | 30 | 0 | `1d4` | NORMAL | CHASER | 7 | Y | 4 | 15 | Tuning Fork 1 | — | 3, 7 |
| **Cuckoo** | `c` | gold | 8 | 80 | 15 | 0 | melee `1d2`; ranged `1d4` (ignores Plating), range 6, windUp YES | NORMAL | SKIRMISHER | 8 | N | 6 | 20 | Grit Bomb 1 | — | 3, 5, 7 |
| **Stoker** | `k` | orange | 18 | 75 | 5 | 1 | `1d6` + on hit **Burning** 2 | NORMAL | CHASER | 7 | Y | 8 | 25 | Oil Flask 1 | Burning | 4, 7 |
| **Gear-Golem** | `g` | iron | 30 | 70 | 0 | 3 | `0 (flat)` plain (never used, `ENM-06`); heavy `3d4` | SLOW | BRUISER | 6 | B | 12 | 40 | Counterweight 1 | — | 4, 6, 7 |
| **Brass Finch** | `f` | lime | 5 | 75 | 30 | 0 | `1d4+1` | FAST | SWARMER (pack 2–3) | 8 | N | 3 | 10 | Grit Bomb 1 | — | 5, 7 |
| **Archivist** | `a` | blue | 14 | 80 | 15 | 1 | melee `1d3`; ranged `1d4` + on hit **Exposed** 2, range 5, windUp YES | NORMAL | SKIRMISHER | 7 | Y | 8 | 25 | Flux 1, Clatter Can 1 | — | 6, 7 |
| **The Unfinished** | `u` | violet | 20 | 65 | 10 | 2 | `2d4` | NORMAL | ERRATIC | 6 | Y | 9 | 20 | Flux 1 | Blinded | 6, 7, 8 |
| **Pendulum Knight** | `p` | white | 26 | 80 | 10 | 2 | `2d4` | NORMAL | GUARD | 7 | Y | 12 | 40 | Flux 1, Steel Plating 1 | — | 6, 7 |
| **Magpie** | `b` | silver | 9 | 85 | 30 | 0 | `1d2`, or a **theft** (`ENM-06` THIEF) | FAST | THIEF | 9 | N | 6 | 100 | the stolen item, else Spring-Key 1 | — | 5, 7 |

No regular enemy drops a **Solder** or a **Spring-Key** any more: those two are scarce by design
(`DIF-04`), and what an enemy leaves is a tactic rather than a resource. The Magpie is the one
exception, and only because what it drops is what it took from Tick.

Special-case rules:
- **Rust-moth** takes 4 per turn from Burning instead of 2 (`CMB-10`), and its hit **corrodes**
  Tick's plating on a `d100 ≤ corrosionChance` (`CMB-14`). It is the only type that does.
- **Magpie**: the only **THIEF** (`ENM-06`). Its hit takes one unit of a random consumable stack
  instead of doing damage, after which it only runs, and gives what it took back when it breaks.
- Any regular, non-pack spawn may be **Overwound** (`ENM-12`): the same enemy with +50% Integrity,
  +`eliteAccuracyBonus` accuracy, +`eliteDamageBonus` damage and double XP, named and drawn as one.
  Cache guards, bosses and the two pack types are never Overwound.
- **Cuckoo** ranged attack: the shriek. When fired (after its wind-up turn), noise **12** at the Cuckoo's
  tile regardless of hit or miss. Its telegraph log line: "The Cuckoo draws breath."
- **Stoker** on-hit Burning applies only on a hit that deals ≥ 1 damage after Plating.
- **Gear-Golem** telegraph log line: "The Gear-Golem raises its arm." Heavy attack log: "The Gear-Golem
  brings its arm down."
- **Archivist** telegraph log line: "The Archivist lifts a pin." Ranged attack noise 2; log "The Archivist
  flicks a drafting pin." Its Exposed applies on any hit, including one that deals 0 damage after Plating.
- **The Unfinished** never returns to Dormant (`ENM-06`).
- A **cache guard** (`23`) of any type is spawned with archetype **GUARD** and `homeRoom` = the cache
  room, regardless of the table above.

Descriptions (≤ 25 words, in the inspect popup):
- Rust-moth: *Not hers. They got in through the roof and eat the oil. They come in numbers and they cannot work a door.*
- Sweeper: *Broom for an arm, hopper for a chest. Clears the floor of anything that is on it, including you.*
- Spring-Hound: *Built to fetch. Fast, hears well, does not understand doors. Bites.*
- Tin Soldier: *Holds a door. Will not leave it. If you are not in its room it will not come to you.*
- Music-box Dancer: *Turns to the beat and goes where it says. Hard to hit; it is never where it was.*
- Magpie: *An aviary bird that likes bright things. Takes one, and does not come back for another.*
- Cuckoo: *Announces the hour at anything that moves. The shriek carries, and the whole floor hears it.*
- Stoker: *Feeds the boilers. Its hands are hot. Burns you on a hit; cannot itself burn.*
- Gear-Golem: *Maintenance engine. Slow. Raises its arm one turn, brings it down the next. Do not be there.*
- Brass Finch: *An aviary bird that says the time. Quick, fragile, and never alone.*
- Archivist: *Files things. Flicks pins that loosen your plating. Keeps its distance.*
- The Unfinished: *Never given an order. Moves on raw spring, wherever. Does not blind; it never saw properly.*
- Pendulum Knight: *Guards the stair. Steel pattern, two-handed blade. Stays at its post unless you enter it.*

## BST-03 Boss rules

- Bosses are never Dormant after their **entry trigger**.
- **Status caps:** Stunned max 1, Slowed max 2, Exposed max 2, Blinded max 2 (durations above the cap
  are reduced to it). Burning is uncapped.
- Bosses drop with `dropChance 100`; their drops are unique.
- Each boss has an **action counter** `n` starting at 0 and incremented every time the boss takes an
  action (including telegraph actions). Phase scripts refer to it.
- Phase transitions happen at the moment Integrity crosses the threshold, and any log line for the
  transition is printed then; the new phase's script applies from the boss's next action.
- Bosses use `ENM-08` pathing and `CMB-06` melee like any enemy.

## BST-04 The Conductor (floor 3)

| Glyph | Color | Int | Acc | Eva | Plt | Attack | Speed | Per | Doors | XP | Drop | Immune |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `C` | pink | 32 | 80 | 15 | 1 | `1d5` | NORMAL (P1), FAST (P2) | 8 | Y | 10 | **Conductor's Baton** | — |

- **Placement:** floor 3's stairs room (`FLR-04`), on a random interior tile. Active from the start of
  the floor (entry trigger = floor start), but it does not leave its room until Tick has been seen:
  before first sight it Waits; after first sight it runs its script anywhere. Its action counter `n`
  starts at 0 on first sight; Waits before first sight do not increment it.
- **Phase 1 (Integrity > 16):**
  1. If `windingUp` → **Downbeat**: summon **Music-box Dancer**s on the two free tiles adjacent to the
     Conductor that are first in reading order (fewer if fewer are free), each Active with
     `lastKnown = Tick's tile`. Summoned dancers count toward a cap of **4 alive summoned dancers**; if
     the cap is reached, Downbeat summons nothing. Noise 8. Log: "The Conductor brings the baton down."
     Clear `windingUp`.
  2. Else if `n mod 3 == 2` and Tick is seen → `windingUp = true` (telegraph). Log: "The Conductor raises
     the baton."
  3. Else → CHASER lines 1–3.
- **Phase 2 (Integrity ≤ 16):** on transition, log "The Conductor's tempo doubles." Speed becomes FAST.
  Script: CHASER only. No more summons.
- Description: *Keeps fourteen brass players to a bar that never ends. Calls the dancers in on the beat.*

## BST-05 The Regulator (floor 6)

| Glyph | Color | Int | Acc | Eva | Plt | Heavy | Speed | Per | Doors | XP | Drop | Immune |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `R` | red | 48 | 75 | 0 | 4 | `3d5` | SLOW (P1), NORMAL (P2) | 7 | B | 12 | **Governor** | Slowed, Burning |

- **Placement:** floor 6's stairs room, random interior tile. Entry trigger = the first time any tile of
  the stairs room is in Tick's FOV. Before that it is Dormant (it can also be woken by noise like any
  enemy, which counts as the trigger).
- **Phase 1 (Integrity > 24):** BRUISER script (`ENM-06`) with `heavyAttack 3d5`. Telegraph log: "The
  Regulator's arm ratchets back." Heavy log: "The Regulator's arm drops."
- **Phase 2 (Integrity ≤ 24):** on transition, log "The Regulator's governor spins free." Speed becomes
  NORMAL. Script:
  1. If `ventingUp` → **Vent**: every actor within Chebyshev 2 of the Regulator takes 4 damage ignoring
     Plating and gets **Burning** 2. Noise 6. Log: "Steam bursts from the Regulator." Clear `ventingUp`.
  2. Else if `n mod 4 == 3` → `ventingUp = true` and `windingUp = false` (telegraph color; a pending heavy
     hit is dropped). Log: "The Regulator's seams glow."
  3. Else → BRUISER script.
- Description: *The tower's governor. Built to run without her and never did. Slow until it is not.*

## BST-06 The Understudy (floor 8)

| Glyph | Color | Int | Acc | Eva | Plt | Attack | Speed | Per | Doors | XP | Drop | Immune |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `U` | white | 72 | 85 | 15 | 2 | `2d4` | NORMAL (P1, P2), SLOW (P3) | 10 | Y | 0 | none (`dropChance 0`, `dropTable []`; the Master Key is narrative) | Slowed |

- **Placement:** the `U` tile of the floor 8 map (`FLR-09`). Entry trigger = Tick opens the door at the
  antechamber (the `+` on the map). At that moment: text box with line 1 (`SCR-06`), then the
  Understudy is Active with `lastKnown = Tick's tile`.
- **Its own spring:** the Understudy has `tension = 100`, shown in its inspect popup as `Spring n/100`.
  Every action it takes costs 2. If it reaches 0, the Understudy is **defeated** exactly as if broken
  (`STY-02`: it is winding down as you fight it).
- **Phase 1 (Integrity > 48):**
  1. If `windingUp` and Tick adjacent → **Overwind**: melee attack rolling `2d4` twice (sum), accuracy +15.
     Log: "The Understudy's arm unwinds all at once." Clear `windingUp`. If Tick not adjacent, clear and
     Wait.
  2. Else if adjacent to Tick and `n mod 4 == 3` → `windingUp = true`. Log: "The Understudy tightens."
  3. Else → CHASER.
- **Phase 2 (Integrity 25–48):** on transition: log line 2 (`SCR-06`), then summon two **The Unfinished**
  on marker tiles `1` and `2` (or the nearest free tiles by Chebyshev, reading order), Active, and
  `n` continues. Script:
  1. If `pulsingUp` → **Pulse**: every actor within Chebyshev 2 takes `1d6+1` ignoring Plating and is
     knocked back 1 away from the Understudy. Noise 8. Log: "The Understudy rings like a bell." Clear.
  2. Else if `n mod 4 == 3` and Tick within 2 → `pulsingUp = true`. Log: "The Understudy hums."
  3. Else → Phase 1 lines 1–3. Because adjacency implies "within 2", line 2 above always fires first on
     `n mod 4 == 3`: in Phase 2 the Understudy Overwinds only to complete a wind-up carried over from
     Phase 1.
- **Phase 3 (Integrity ≤ 24):** on transition: log line 3 (`SCR-06`); speed becomes SLOW permanently;
  all `windingUp`/`pulsingUp` cleared. Script: CHASER only. No specials.
- **On defeat** (Integrity ≤ 0 or spring 0): no scrap, no XP. Text box with the defeat description and
  line 4, then thought 3, then the ending choice (`UI-19`). Journal page 8 is shown within the ending
  sequence (`SCR-07`) and marked found.
- Description: *Her last work. Silver, finished, waiting to be told. It has the Key and cannot use it.*

## BST-07 XP inventory (for `31-balance.md`)

Regular enemy XP: Rust-moth 1 · Sweeper 3 · Spring-Hound 5 · Tin Soldier 6 · Music-box Dancer 4 ·
Cuckoo 6 · Stoker 8 · Gear-Golem 12 · Brass Finch 3 · Archivist 8 · The Unfinished 9 · Pendulum Knight
12 · Magpie 6. Bosses: Conductor 10 · Regulator 12 · Understudy 0. An **Overwound** instance is worth
`eliteXpMult` times its row (`ENM-12`).
