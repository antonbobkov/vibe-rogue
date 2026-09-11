# 50 — Difficulty Plan: "The Tower Notices"

**Status:** Approved for implementation. Addressed to the agents that will carry it out.
**Purpose:** The released game is beaten on a first try. This document diagnoses why with the sim's
own numbers, specifies ten changes that make the game hard *in the way the pillars allow*, adds the
tuning knobs the balance protocol lacked, and defines the measurement loop that decides when it is
done. It is a milestone in the sense of `40-implementation-plan.md`: **M13**, tag `@m13`, DoD
`npm run dod -- 13`.

---

## DIF-00 Diagnosis

Measured on the current `main` (`node tools/sim.js --all --seeds 100`):

| Fact | Number | Meaning |
|---|---|---|
| S4 (explore all, fight all, dodge telegraphs) win rate | **88%** (target 30–60%) | A methodical player wins by default |
| S4 mean enemies broken | 64 of ~65 | It clears every floor |
| S5 level at floor 8 | min = max = **9** | Every run maxes out |
| S2 (walk to stairs, never fight) Tension at floor 8 | mean **79** | The clock is not binding |
| S4 losses that are wind-downs | 5 of 12 | Tension almost never kills |
| BALANCE-CHANGELOG B-001…B-004 | all four BAL-08 knobs reverted | Margin knobs cannot fix it |

The arithmetic behind it, from the current tables: floor items + cache + drops yield ≈ 2 Solder and
≈ 2 Spring-Keys per floor, and **Salvage** adds ≈ 16 more consumables per run (64 breaks ÷ 4). That is
≈ 20 Solder ≈ 300 Integrity (≈ 500 with Efficient Springs) against a modelled total loss of ≈ 200 for
the *whole run*, and ≈ 20 Spring-Keys ≈ 900 Tension ≈ 4,500 turns of clock in a 1,800-turn game.
Healing is 2–3× damage; the spring is 2.5× the game. Two positive feedback loops sit on top:
more kills → more XP and more Salvage; more Plating → half the bestiary deals 0.

The classics are hard through **scarcity under a clock** (Rogue: food, slow healing, wandering
monsters, rust, theft), **threats that scale with the player** (NetHack), and **fights that are pure
cost** (Brogue). This plan adds the first two and edges toward the third, without touching pillar 3
(legibility): nothing here is hidden, random-in-the-dark, or a one-shot.

## DIF-01 Targets

| Check | Current | Target after M13 |
|---|---|---|
| S4 wins, 200 seeds | 88% | **30–60%** |
| S4 median death floor of losses | 4 | **5–7** |
| S4 wind-down share of deaths | ~40% | **20–40%** (the clock must be a real killer, not the only one) |
| S4 deaths caused by any single enemy type | — | **≤ 40%** of deaths (no one-enemy game) |
| S3 (no skills, no stations) | dies floor 3–5, 91% | dies floor **2–4**, ≥ 80% |
| S2 (clock only) Tension at floor 8 | 79 | **40–70** |
| S5 median level at floor 8 | 9 | **7–9** |
| ACC-131 (full explore, no Spring-Keys) | arrives with 47 | arrives with **15–45**, never wound down |
| BAL-C1…C6 | pass | pass with the recomputed model (DIF-14) |
| Human sanity (DIF-16) | first try wins | first run loses; a fifth run is ~50/50 |

`OVR-05`'s stated bands (first run ~10%, fifth run ~50%, expert ~80%) are unchanged; S4 is the proxy
for the fifth-run player, as the B-004 note argues.

## DIF-02 Tunability first: `data/tuning.js`

Every number this plan introduces or moves lives in **one frozen object**, `TUNING`, in
`data/tuning.js` (R3-compliant: data only), with a comment naming the rule it feeds. Engine modules
read it through `ctx.tuning`; `createGame({ tuning })` accepts a partial override that is merged over
the defaults, and `tools/sim.js` gains `--tuning '<json>'` and `--tuning-file <path>` that pass it
through. This is what makes the balancing ladder (DIF-15) a data loop rather than a code loop.

```js
export const TUNING = Object.freeze({
  // DIF-03 healing
  solderAmount: 15,          // CAT-06 Solder total (was instant 15)
  solderTurns: 3,            // CAT-06 turns the repair takes
  solderTension: 5,          // CAT-06 Tension paid to start a repair
  springKeyAmount: 30,       // CAT-06
  fluxAmount: 5,             // CAT-06
  efficientSolderBonus: 5,   // SKL-03 Efficient Springs (was +10)
  efficientKeyBonus: 10,     // SKL-03 (was +15)
  stackMax: 3,               // ITM-03 (was 5)
  // DIF-05 station
  stationNoise: 20,          // CHR-05
  stationRestore: 100,       // CHR-05
  // DIF-06 wanderers
  wanderInterval: 50,        // WLD-14 turns between wanderer spawns (floor 1 overrides to 90)
  wanderCap: 6,              // WLD-14 per floor
  // DIF-07 rust
  corrosionChance: 25,       // BST-02 Rust-moth
  // DIF-08 elites
  eliteChance: 20,           // ENM-12 percent of regular spawns
  eliteIntegrityMult: 1.5,
  eliteAccuracyBonus: 10,
  eliteDamageBonus: 2,
  eliteXpMult: 2,
  // DIF-09 progression
  levelUpIntegrity: 2,       // CHR-07 (was 4)
  // DIF-10 pursuit
  memoryTurns: 25,           // ENM-05 (was 8)
  rallyTurns: 20,            // ENM-13 Cuckoo shriek makes Guards chase
  // DIF-12 cache
  cacheLockCost: 15,         // WLD-15
  // existing, surfaced here so the ladder can reach them
  decayPeriod: 5,            // CHR-04
});
```

Rule for agents: **no difficulty number may be a literal in `src/`**; the meta test
`test/meta/tuning.test.js` asserts every key above is read somewhere in `src/` and that no `src/`
file contains the old literals (`15`, `30`, `5` are too common to grep — the test instead checks the
*symbol* usage: each `TUNING.<key>` appears at least once).

## DIF-03 Change: Solder repairs over time and costs spring

*Rogue's slow healing. Turns "chug a potion mid-fight" into "get out and repair".*

- **Rule (`CAT-06`, `ITM-09`):** Using **Solder** starts a **repair**: pay `solderTension` (refused
  without a turn if Tick cannot; log `Not enough spring to heat the solder.`), then for
  `solderTurns` consecutive turns (this one and the next two) Tick regains `solderAmount / solderTurns`
  Integrity (5) at `CMB-02` step 3, *before* status ticks. Tick may act normally while repairing.
  **Any damage to Tick ends the repair** at once (remaining healing lost; log `The solder cracks.`).
  Using Solder while a repair is running is refused without a turn (`Tick is already soldering.`).
  Ascending ends a repair. **Efficient Springs** adds `efficientSolderBonus` to the total (spread
  evenly, remainder on the last turn) and `efficientKeyBonus` to Spring-Keys, replacing the old
  +10/+15.
- **State (`TEC-05`):** `tick.repair = { turnsLeft, perTurn } | null`. Panel row 15 shows `Solder(n)`
  like a status (it is not one of the five and cannot be removed by Flux).
- **Engine:** `items.js` `SOLDER` effect starts the repair; `turn.js` step 3 applies a tick;
  `combat.damage` clears `tick.repair` when the target is Tick and `dealt > 0` (a 0-damage glance
  does not interrupt). `Field Repair` is unchanged (instant; it is the skill's point).
- **Log strings (`SCR-10`, added verbatim to `data/script.js`):** `Tick begins soldering.` /
  `The solder cracks.` / `Tick is already soldering.` / `Not enough spring to heat the solder.` /
  `Tick solders the plate. Integrity {n}.` (per tick, merged by UI-04).
- **Tests:** ACC-140 (three ticks of 5, Tension −5 on start), ACC-141 (damage on turn 2 stops it;
  glance does not), ACC-142 (refusals spend no turn), ACC-143 (Efficient Springs totals), ACC-144
  (panel shows `Solder(n)`; Flux does not clear it).
- **Bots:** `consumablePolicy` uses Solder only when **no enemy is visible**, Integrity < 60% of max,
  Tension ≥ `solderTension + 10`, and no repair is running; while `tick.repair` is set the bot prefers
  `wait` unless an enemy is visible.

## DIF-04 Change: consumable scarcity

*Rogue's scarcity. Healing and spring become decisions because there are few of them.*

- **Tables (`23-floors.md`, `data/floors.js`):** halve every `Solder` and `Spring-Key` weight in every
  floor table and cache table (round down, minimum 1). Floors 1–2 keep their current Solder weight
  (the tutorial floors must still teach it). Remove `Solder` and `Spring-Key` from **every regular
  enemy drop table** (`22`, `data/enemies.js`); replace with the type's other entries re-weighted, or
  `Grit Bomb 1` where a table would become empty. Bosses unchanged.
- **Stacks (`ITM-03`):** `stackMax` 5 → 3. Inventory stays 10 slots.
- **Salvage (`SKL-03`):** every 4th break drops a **throwable**, cycling `Grit Bomb → Oil Flask →
  Tuning Fork → Clatter Can`. Text: summary `Every 4th enemy broken drops a throwable.`; description
  unchanged. Never Solder or Spring-Key.
- **Efficient Springs (`SKL-03`):** numbers per DIF-03; summary `Spring-Key +10, Solder +5, Flux +5.`
- **Tests:** ACC-145 (weights and drop tables match the spec after the edit — a data test),
  ACC-146 (stack of 3 refuses a 4th), ACC-147 (Salvage cycle over 16 breaks).
- **Bots:** `dropScore` treats throwables as keepable (score 6 → 12) since they are now the Salvage
  output; nothing else.

## DIF-05 Change: winding is loud

*The station decision becomes a decision.*

- **Rule (`CHR-05`, `CMB-11`):** Interacting with a Winding Station restores Tension to
  `stationRestore` **and emits noise `stationNoise` (20)** at the station tile: every Dormant enemy
  within Chebyshev 20 wakes with `lastKnown` = the station; every Active enemy re-targets it
  (`ENM-05`). Floor 1's station is spent and emits nothing. Log: `The winding rings through the
  tower.` after the existing station line.
- **Inspect line (`UI-05`):** `Winding Station (unspent) — press e. Loud: wakes the floor.`
- **Tests:** ACC-148 (Dormant at 19 wakes, 21 does not; Active re-targets; floor 1 emits nothing).
- **Bots:** S4/S2 wind at Tension ≤ 30 (D-098/D-106 already) — unchanged; the S4 bot then fights
  what comes (its existing priority 4).

## DIF-06 Change: wandering pressure

*Rogue's wandering monsters, keyed to the clock. This is the change aimed squarely at
"explore everything".*

- **Rule (new `WLD-14`):** each floor 1–7 keeps `floor.turnsHere` (turns since arrival). Every
  `wanderInterval` turns (`turnsHere mod interval == 0`, `turnsHere > 0`), if fewer than `wanderCap`
  wanderers have spawned on this floor, spawn **one** enemy drawn (`ITM-10` weighted roll, play RNG)
  from the floor's **wander table** (`FLR-*`, new per-floor list, DIF-06 table below). Placement: a
  random interior tile of a room **not visible to Tick**, at BFS distance ≥ 10 from Tick, no actor,
  no feature/hazard/item; retry 50 times, then the farthest valid room tile; if none, skip this
  spawn (it does not count). The enemy is **Active** with `lastKnown` = Tick's tile, `opensDoors` as
  its type, and is flagged `wanderer` (no XP change; ordinary drops). Floor 1 uses
  `wanderInterval: 90`; floor 8 has no wanderers. Elite roll (DIF-08) applies.
- **Wander tables:**

| Floor | Table |
|---|---|
| 1 | Sweeper 3, Rust-moth 1 (single moth, not a pack) |
| 2 | Sweeper 2, Spring-Hound 3, Tin Soldier 1 |
| 3 | Music-box Dancer 3, Spring-Hound 2, Sweeper 1 |
| 4 | Stoker 3, Spring-Hound 2, Sweeper 1 |
| 5 | Cuckoo 2, Brass Finch 2 (single), Spring-Hound 2, Magpie 2 |
| 6 | Archivist 3, The Unfinished 2, Tin Soldier 1 |
| 7 | The Unfinished 3, Stoker 2, Cuckoo 1, Magpie 1 |

- **Log:** `Somewhere on this floor, something winds itself up.` (violet). The panel's row 16 (when no
  cyclic hazard) shows `next: n` — turns until the next wanderer — so the pressure is legible
  (`UI-06`).
- **Tests:** ACC-149 (spawn on turn 50 and 100 on floor 2, none on floor 8, cap at 6, never visible
  on spawn, never within 10), ACC-150 (panel countdown), ACC-151 (floor 1 interval 90).
- **Bots:** none required; S4's "fights everything" absorbs it. Add the wanderer count to the run
  record (`wanderersSpawned`) for DIF-15's death-cause table.

## DIF-07 Change: rust

*Rogue's rust monster. Plating stops being a solved problem.*

- **Rule (`BST-02` Rust-moth, new `CMB-14`):** when a Rust-moth's melee **hits** Tick (hit roll
  succeeds, regardless of damage after Plating) and Tick has plating equipped, roll `d100`; if
  `≤ corrosionChance`, the equipped plating item gains 1 **wear**: its effective `plating` is
  `max(0, base − wear)`. Wear is permanent and per item instance. Log: `The Rust-moth pits the
  {plating name}.` Elite Rust-moths (DIF-08) corrode on 50%.
- **Items (`ITM-01/02/03`, `TEC-05`):** equipment entries become `{ name, wear }` in
  `tick.equipment.*` and in inventory slots (`{ name, count: 1, wear }`); consumables keep
  `{ name, count }`. Display: `Iron Plating (−2)` in the panel, inventory and inspect; the inspect
  popup shows `plating 3 − 2 wear = 1`. **Save version 1 → 2** (`TEC-09`: version mismatch is
  treated as no save; no migration).
- **Floors:** Rust-moths are added to the floor-4 spawn list (`Rust-moth pack`) and to the floor-7
  wander table above, so plating is threatened all game.
- **Tests:** ACC-152 (forced `d100` 25 corrodes, 26 does not; only on a hit; only with plating),
  ACC-153 (wear persists through unequip/re-equip and save/load; swapping to a fresh item resets
  nothing on the old one), ACC-154 (display strings).
- **Bots:** `equipmentScore` for plating uses `plating − wear`.

## DIF-08 Change: elites ("Overwound")

*Rogue's out-of-depth monster, legibly.*

- **Rule (new `ENM-12`):** at generation and at wanderer spawn, each **regular, non-pack** enemy
  instance rolls `d100` (floor RNG at generation, play RNG for wanderers); `≤ eliteChance` makes it
  **Overwound**: name prefixed `Overwound `, `integrityMax` ×`eliteIntegrityMult` (round up),
  accuracy +`eliteAccuracyBonus`, every attack (melee, heavy, ranged) +`eliteDamageBonus` flat,
  XP ×`eliteXpMult`, drop chance ×2 (cap 100). Speed, archetype, evasion, plating, immunities
  unchanged. Cache guards and bosses are never elite. Packs (Rust-moth, Brass Finch) are never elite.
- **Display (`UI-07/09`):** same glyph and color, drawn on background `#3a3210` (dark gold); the
  inspect line prefixes `Overwound` and the popup adds `overwound: +50% Integrity, +10 accuracy, +2
  damage`.
- **Balance guard:** `BAL-04`'s single-hit cap must still hold with `+2` (DIF-14 recomputes it).
- **Tests:** ACC-155 (forced roll creates an elite with exact numbers; guards/bosses/packs never),
  ACC-156 (display), ACC-157 (elites in the spawn record are reproducible from the seed).
- **Bots:** none.

## DIF-09 Change: level-ups give less Integrity

- **Rule (`CHR-07`):** `integrityMax += levelUpIntegrity` (2, was 4); current Integrity +2. Max at
  level 9 is 56 (62 with Braced Frame). XP thresholds unchanged.
- **Tests:** ACC-158.
- **Bots:** none.

## DIF-10 Change: persistent pursuit

- **Rules (`ENM-05`, new `ENM-13`):**
  - `memoryTurns` 8 → 25: an Active enemy returns to Dormant only after 25 turns without sight or
    noise. (The existing `MEMORY_TURNS` constant in `src/ai.js` becomes `ctx.tuning.memoryTurns`.)
  - **Spring-Hounds** never go Dormant once woken, and their `lastKnown` is refreshed to Tick's tile
    every turn Tick is within Chebyshev 12, walls notwithstanding ("hunt by sound", `STY-03`).
  - **Rally (`ENM-13`):** a Cuckoo shriek (noise 12) makes every **GUARD** within its radius behave as
    **CHASER** for `rallyTurns` (20) turns, then RETURNING. Log on the shriek: `The guards leave
    their doors.` (only if at least one Guard rallied).
- **Tests:** ACC-159 (Dormant at 26 turns, not 25), ACC-160 (hound tracks through walls at 12; not at
  13), ACC-161 (rallied Guard leaves its room; returns after 20).
- **Bots:** D-102's 12-turn chase abandonment remains; the bot will now be *followed*, which is the
  point.

## DIF-11 Change: the Magpie (theft)

*NetHack's nymph, in the aviary.*

- **Enemy (`BST-02`, `data/enemies.js`):**

| Name | Glyph | Color | Int | Acc | Eva | Plt | Attack | Speed | Archetype | Per | Doors | XP | Drop | Floors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Magpie** | `b` | silver | 9 | 85 | 30 | 0 | `1d2` | FAST | THIEF | 9 | N | 6 | 100%: the stolen item, else Spring-Key 1 | 5, 7 |

- **Archetype THIEF (`ENM-06`):** as CHASER until adjacent; on a **hit** against Tick (hit roll
  succeeds), instead of damage it **steals**: one unit from a random consumable stack in Tick's
  inventory (play RNG, uniform over stacks; if Tick carries no consumables, the hit deals `1d2` as
  normal). Then it enters **FLEEING**: every action is the SKIRMISHER retreat step from Tick; it
  never attacks again; it goes Dormant after `memoryTurns` like anyone, still holding the item.
  When broken it drops the stolen item (`ITM-11` placement, unlimited search — never lost). Immune
  to nothing. Log: `The Magpie snatches the {X}!` / `The Magpie drops the {X}.`
- **Description:** *An aviary bird that likes bright things. Takes one, and does not come back for
  another.*
- **Floors:** floor 5 spawn list gains `Magpie × 1`; floor 7 `Magpie × 1`; both wander tables per
  DIF-06.
- **Tests:** ACC-162 (steal takes exactly one unit, chosen by the forced roll; empty inventory →
  damage instead), ACC-163 (flees, never attacks again, drop returns the item), ACC-164 (wanderer
  Magpie behaves identically).
- **Bots:** `visibleEnemies` orders a **fleeing Magpie holding an item** first when adjacent;
  otherwise the chase-abandon rule applies. Add `itemsStolen` to the run record.

## DIF-12 Change: cache locks

- **Rule (new `WLD-15`, `WLD-02` new tile):** every door of the **cache room** is a **Wound Lock**
  (`=`, color `brass`): blocks movement and sight like a closed door; Tick's bump attempts to open
  it: if `tension > cacheLockCost`, pay `cacheLockCost` and it becomes an open door (log `Tick winds
  the lock. Tension {n}.`), else refuse without a turn (`Not enough spring for the lock.`).
  Enemies with `opensDoors: YES` treat it as a wall; `BREAKS` breaks it (noise 6) — a Gear-Golem can
  open a cache for you. The cache guard is generated inside. Generation (`WLD-11` step 4): if the
  cache room's boundary has a corridor opening with no door, a door is forced there; then all its
  doors become locks. Floor 6's cache (with the Blueprint) is locked like any other.
- **Inspect (`UI-05`):** `Wound Lock — 15 Tension to open.`
- **Tests:** ACC-165 (cost, refusal, open door afterwards), ACC-166 (generation: every cache
  entrance is a lock over 1,000 seeds; the guard is inside), ACC-167 (Golem breaks it).
- **Bots:** S4 opens a lock only if Tension ≥ 45 (else marks the cache room abandoned for the floor).
  S3 never opens locks.

## DIF-13 Spec, data and code touch list

| Doc | Edits |
|---|---|
| `00-overview.md` | OVR-03: stacks to 3; add Magpie to enemy count (13 regular); OVR-06 headline table: Solder "15 over 3 turns, costs 5 Tension", stacks 3, level-up +2; OVR-08 index rows for `50` |
| `10-turns-and-combat.md` | CMB-02 step 3: repair tick; CMB-11 noise table: station 20; new CMB-14 corrosion |
| `11-character-and-skills.md` | CHR-04/05: station noise, Solder Tension cost; CHR-07 +2 |
| `12-items-and-inventory.md` | ITM-01/02/03: `wear`, stack 3; ITM-09 repair rule |
| `13-world-and-generation.md` | WLD-02 Wound Lock tile; WLD-11 step 4 lock rule; new WLD-14 wanderers; new WLD-15 locks |
| `14-enemies-and-ai.md` | ENM-05 memoryTurns; ENM-06 THIEF; new ENM-12 elites; new ENM-13 rally; hound rule |
| `15-ui-and-controls.md` | UI-03 row 15 `Solder(n)`, row 16 `next: n`; UI-05 strings; UI-07 `=`; UI-09 elite background |
| `20-skills.md` | Salvage, Efficient Springs |
| `21-items-catalog.md` | CAT-06 Solder/Spring-Key/Flux rows |
| `22-bestiary.md` | Rust-moth corrosion; Magpie row + description; BST-02 note on elites |
| `23-floors.md` | table weights; wander tables; Magpie/moth spawns; cache lock note |
| `24-script.md` | SCR-10 additions (all strings quoted in this doc) |
| `30-technical.md` | TEC-03 `wear`, `tuning`; TEC-05 fields; TEC-09 version 2; TEC-13 `--tuning` |
| `31-balance.md` | DIF-14 recomputation; BAL-07 targets per DIF-01; BAL-08 replaced by DIF-15 ladder |
| `32-acceptance-tests.md` | new section ACC-14x–16x as listed here |
| `40-implementation-plan.md` | M13 row in PLN-05; this doc as its detail |

| Code | Edits |
|---|---|
| `data/tuning.js` (new), `data/items.js`, `data/enemies.js`, `data/floors.js`, `data/skills.js`, `data/script.js` | per cards |
| `src/engine.js` | `tuning` option/merge; `turnsHere`; station noise; lock bump; wanderer spawn call at step 2 |
| `src/turn.js` | repair tick; wanderer scheduler (`wander.js` new, called from step 2 after decay) |
| `src/combat.js` | repair interruption; corrosion hook; steal hook |
| `src/items.js` | `wear`, stack cap, Solder start, Salvage cycle, display names |
| `src/ai.js` | memoryTurns from tuning; THIEF; hound rule; rally; elite stat application in `actors.createEnemy` |
| `src/gen.js` | lock doors; elite roll at spawn; `wanderTable` passthrough |
| `src/tiles.js` | `WOUND_LOCK` |
| `src/render.js`, `src/screens/inspect.js`, `run.js` | panel rows, elite background, lock glyph, strings |
| `src/save.js` | version 2 |
| `tools/sim.js`, `tools/bots/*` | `--tuning`; policies per cards; run record fields `wanderersSpawned`, `itemsStolen`, `deathCause` (enemy type / hazard / wound-down) |
| `test/**` | ACC-140–167; `test/meta/tuning.test.js`; un-skip S4 in `sim.test.js`; remove `BALANCE_SKIPS.S4` |

Order of work inside M13 (each step green before the next): **tuning module → DIF-03/04 (economy) →
DIF-05 → DIF-06 → DIF-09 → DIF-10 → DIF-07 → DIF-08 → DIF-11 → DIF-12 → bots → DIF-14 → DIF-15.**
Economy first because it is the largest lever and every later measurement should be taken with it in.

## DIF-14 Recomputed balance model (`31-balance.md`)

Rewrite BAL-01 and BAL-02 with the new inputs; the tests in `balance.test.js` recompute from data
and must be updated to the new formulas:

- **BAL-01 Tension:** add per floor `−cacheLockCost` (if the cache is taken) and the Solder Tension
  cost (≈ 2 per floor); Spring-Keys expected ≈ 0.7 per floor (+21). Modelled full-explore leave
  values will go negative on floors 7–8 — **that is the intended result**: full-explore is no
  longer free; the model should now show the *rush* line (60% of turns) as the one that finishes.
  BAL-C1 is restated: "the 60%-turns line never goes ≤ 0" (the full-explore line may).
- **BAL-02 Integrity:** healing available per floor becomes `Integrity max + ≈ 1 Solder × 15`,
  with the Solder only usable out of combat; add wanderer and elite expected damage (≈ +25% per
  floor). BAL-C2 threshold stays 65% but is now checked against the smaller pool.
- **BAL-03 XP:** unchanged thresholds; elites add ≈ +10% XP; BAL-C3 target becomes "level 7–9 at
  floor 8 at 75% kills".
- **BAL-04 single hit:** recompute with `+2` elite bonus and `integrityMax = 40 + 2·(level−1)`.
  Expected worst: Understudy Overwind 16 / 54 = 30%; elite Pendulum Knight 10 / 52 = 19%. Passes.
- **BAL-06 builds:** add a row per build for "the Magpie" and "wanderers".

## DIF-15 Balancing ladder (replaces `BAL-08` for M13)

Run after every step: `node tools/sim.js --all --seeds 100` while iterating, `--seeds 200` to
confirm. Log every knob change as `B-nnn` in `BALANCE-CHANGELOG.md` with measured before/after.

**Step 0 — implement all ten changes at the DIF-02 defaults and measure.** Record the full table of
DIF-01 metrics plus the death-cause breakdown (`deathCause` histogram) and mean Solder/Spring-Keys
found and used per run.

**Step 1 — S4 win rate.** While outside 30–60%, turn **one** knob per iteration, in this order,
by the step shown, re-measure on 100 seeds, keep it if the number moved toward the band, else
revert and go to the next knob. Confirm the final state on 200 seeds.

| # | If too easy (> 60%) | If too hard (< 30%) |
|---|---|---|
| 1 | Solder/Spring-Key floor+cache weights −25% (min 1) | +25% |
| 2 | `wanderInterval` 50 → 40 | 50 → 65 |
| 3 | `eliteChance` 20 → 30 | 20 → 10 |
| 4 | `levelUpIntegrity` 2 → 0 | 2 → 3 |
| 5 | `stackMax` 3 → 2 | 3 → 4 |
| 6 | `corrosionChance` 25 → 40 | 25 → 15 |
| 7 | `cacheLockCost` 15 → 25 | 15 → 10 |
| 8 | `decayPeriod` 5 → 4 (last resort, as BAL-08 said) | 5 → 6 |

Maximum 10 iterations. If the band is still not reached, stop, keep the best state, and record the
gap in the changelog — but the S4 test is **not** skipped again; it asserts the new measured band
±5 points and the changelog row explains why.

**Step 2 — shape checks (in this order, one knob each, at most 2 iterations per row):**

| Symptom | Knob |
|---|---|
| Wind-down share of deaths < 20% | `wanderInterval` −10, or `stationNoise` −5 if wanderers already ≤ 40 |
| Wind-down share > 40% | `springKeyAmount` +5 |
| One enemy type > 40% of deaths | that type: −1 flat damage or −5 accuracy (spec edit, logged) |
| Median death floor of losses < 5 | floor-1/2 Solder weights back to original; `wanderInterval` floor-2 override 70 |
| S3 dies on floor 1 > 20% | Rust-moth pack floor 1 → 3–3 |
| S2 arrival Tension outside 40–70 | `stationRestore` ±10 |
| ACC-131 wound down | `cacheLockCost` −5 (the full-explore run is meant to be *barely* survivable) |

**Step 3 — regression:** every other ACC stays green; `perf.test.js` budgets hold with wanderers
(turn < 5 ms with 30 enemies still applies); `npm run dod -- 13` green; allowlist empty.

## DIF-16 Human sanity check (recorded, not gated)

After the ladder, one agent plays three seeded runs by hand through the browser (`CH.newRun`)
following the S4 policy loosely and writes `specs/PLAYTEST-M13.md`: floor of death, cause, Tension
low points, how many Solder were found and used, whether any moment felt unfair (a death not
traceable to a decision — pillar 3). Any "unfair" entry becomes a D-entry and, if it is a rule
gap, a fix inside M13. This is the only non-mechanical gate; it produces a document, not a
pass/fail.

## DIF-17 Definition of Done

- [ ] `data/tuning.js` exists; `test/meta/tuning.test.js` green; `createGame({tuning})` and
      `tools/sim.js --tuning` work.
- [ ] All ten changes implemented; ACC-140–167 written, named, green; allowlist empty.
- [ ] Specs in DIF-13 edited (numbers, rules, strings); every new string in `data/script.js`.
- [ ] Save version 2; old saves ignored (ACC-05 updated to inject version 1).
- [ ] `BALANCE_SKIPS` is empty; the S4 test asserts the DIF-01 band; `npm run sim` reports every
      DIF-01 target met or a logged, explained gap.
- [ ] `BALANCE-CHANGELOG.md` rows B-005+ for every knob turned; `DECISIONS.md` for every ambiguity.
- [ ] `31-balance.md` rewritten per DIF-14; `32-acceptance-tests.md` extended; `40` has the M13 row.
- [ ] `specs/PLAYTEST-M13.md` exists with three runs.
- [ ] `npm run dod -- 13` green in CI; tag `v1.1.0`.
