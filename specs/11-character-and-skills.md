# 11 — Character and Skills Framework

**Status:** Wave 2 — core rules. The 12 skills themselves are specified in `20-skills.md`.
**Purpose:** Define Tick's resources, attributes, growth, and the framework the skill system runs on.

---

## CHR-01 Tick's starting state

| Field | Value |
|---|---|
| Integrity / max | 40 / 40 |
| Tension / max | 100 / 100 |
| Force | 0 |
| Precision | 0 |
| Plating | 0 |
| Evasion (derived, `CMB-01`) | 10 |
| Accuracy (derived) | 80 |
| Character level | 1 |
| XP | 0 |
| Skill points | 0 |
| Equipment | Weapon: **Wrench**. Plating: none. Attachment: none. |
| Inventory | 1 × **Solder**, 1 × **Spring-Key** |
| Position | Floor 1 start tile, standing on the floor's Winding Station, which is already **spent** (`STY-01`: it ran on a timer this morning). |

## CHR-02 Integrity

- Tick's hit points. `integrityMax` starts at 40 and rises only through level-ups (CHR-07) and skills.
- Integrity is restored only by: **Solder** (+15, `ITM-09`), **Flux** (+5, `CAT-06`), the **Field Repair**
  skill, **Braced Frame** (+6 when taken), and level-ups.
  There is no regeneration of any kind, on any floor, ever.
- Integrity is clamped to `[0, integrityMax]`.

## CHR-03 Tension

- Tick's mainspring. `tensionMax = 100`, fixed for the whole game; no item, skill, or level changes it.
- Clamped to `[0, 100]`. Restoring above 100 is wasted (the log says "The spring is already tight.").
- Reaching 0 is death (`CMB-12`).
- The side panel shows Tension as a bar and a number; it turns yellow at ≤ 30 and red at ≤ 15
  (`UI-08`). At ≤ 15, every 5th turn the log also prints "Tick's spring is nearly slack."

## CHR-04 Tension loss

| Cause | Amount |
|---|---|
| Time | 1 per `decayPeriod` turns, counted by `decayCounter` (`CMB-02` step 2). `decayPeriod` is 5; the **Governor** attachment (`CAT-05`) is the only thing that changes it (to 6). Nothing pauses or skips it. |
| Active skills | Per skill, 5–20 (`20-skills.md`). Paid when the skill is used, before its effect. |
| Ranged weapons | Per shot, 2–5 (`21-items-catalog.md`). |
| Solder | `solderTension` to start a repair (`ITM-09`). Refused, without a turn, if Tick cannot afford it — mending costs spring, which is the trade M13 added. |
| Wound Lock | `cacheLockCost` to wind one open (`WLD-15`). Refused the same way. |
| Nothing else | No enemy, hazard, or status drains Tension. *Rationale:* the player must always be able to compute how long they have. |

## CHR-05 Tension restoration

| Source | Amount | Rule |
|---|---|---|
| **Winding Station** | To `stationRestore` | One per floor 1–7 (floor 1's is spent at start). Interact while standing on it. Becomes **spent** (dim glyph) permanently. Takes a turn. Logs "Tick winds the spring. Tension {n}." and then "The winding rings through the tower." — winding is **loud**: it emits noise `stationNoise` at the station tile (`CMB-11`), so every Dormant enemy within that radius wakes with the station as its `lastKnown`, and every Active enemy inside it re-targets the station (`ENM-05`). A spent station makes no sound. |
| **Spring-Key** | +30 | Consumable. Modified by the **Efficient Springs** skill. |
| Skills | — | No skill restores Tension. |
| The Master Key | ∞ | Ending B only (`STY-07`). |

## CHR-06 Experience

- Every enemy has an `xp` value (`22-bestiary.md`). Tick gains it when the enemy breaks, regardless of
  the damage source (Burning, hazard, a boss's area attack, or Tick's attack all count).
- Level thresholds are cumulative XP:

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| XP needed | 0 | 10 | 25 | 45 | 70 | 100 | 135 | 175 | 220 |

- Level 9 is the cap. XP past 220 is still displayed but does nothing.
- Wave 3 must place at least **300 XP** of enemies across a full run (`BAL-03` verifies) so that a
  player who breaks ~75% of enemies reaches level 9 on floor 8, matching `OVR-04`.

## CHR-07 Level-up

On reaching each new level (checked in `CMB-02` step 8, one level per check; multiple levels from one
kill resolve in consecutive checks — i.e. the next turn):

1. `integrityMax += levelUpIntegrity`; `integrity += levelUpIntegrity` (clamped). The level-9 cap is
   therefore `40 + 8 × levelUpIntegrity`.
2. `skillPoints += 1`.
3. The log prints "Tick feels a new gear catch. Level *N*." and the **Skills** screen opens
   automatically. The player may close it without spending; unspent points persist and the panel
   shows "SP: n" in bright color until spent.

Nothing else changes on level-up. Attributes come only from skills and equipment.

## CHR-08 Attributes

| Attribute | Effect | Sources |
|---|---|---|
| **Force** | Added to melee damage (`CMB-06` step 4). | Skills, attachments. |
| **Precision** | `+5` accuracy per point, melee and ranged. | Skills, attachments. |
| **Plating** | Flat damage reduction from any source that does not ignore Plating. | Plating item, attachments, skills. |

Attributes are integers ≥ 0 and are recomputed from their sources whenever equipment or skills change.
The side panel always shows the current totals; hovering one shows the breakdown (`UI-11`).

## CHR-09 Disciplines and skill lines

- Three disciplines: **Armature**, **Tinkering**, **Resonance**. Each is an ordered list of exactly
  four skills, ranks 1–4.
- **Prerequisite rule:** rank *n* of a discipline can be taken only if rank *n−1* of the same
  discipline is already taken. Rank 1 has no prerequisite. Disciplines are independent of each other.
- Taking a skill costs exactly 1 skill point and is permanent.
- With 8 points over a run, a player can complete one discipline and reach rank 4 of a second, or
  spread across all three. All twelve skills are specified in `20-skills.md`, which must obey the
  shape below.

### Discipline shape (binding on `20-skills.md`)

| Discipline | Fantasy | Rank 1 | Rank 2 | Rank 3 | Rank 4 |
|---|---|---|---|---|---|
| **Armature** | Tick as a heavy frame: hit hard, take hits. | Passive: durability | Active: big melee hit | Active: temporary defense | Passive: Force + knockback/stun on heavy hits |
| **Tinkering** | Tick as Aurelie's apprentice: more out of every item. | Passive: deterministic consumable drops | Passive: better consumables | Active: repair Integrity, once per floor | Active: decoy gadget |
| **Resonance** | Tick as a tuning fork: ranged harmonics and control. | Passive: ranged bonuses | Active: area pulse + push | Active: single-target Expose + Slow | Passive: chain damage on kills |

Each discipline must contain exactly two active and two passive skills. Actives cost Tension and a turn;
passives are always on.

## CHR-10 Active skill slots

Active skills are bound to hotkeys `1`–`4` **in the order they were acquired** (first active skill taken
is `1`, etc.). Since no combination of 8 points yields more than 4 actives (each discipline has 2),
four slots always suffice. The side panel lists them with their Tension cost and, for once-per-floor
skills, whether they are available (`UI-06`).

## CHR-11 Displayed derived values

The following are always visible or one hover away, so the player never has to compute them
(`OVR-02` pillar 3): Accuracy vs. the hovered enemy (as a %), damage range vs. the hovered enemy
(`min–max` after Plating), turns until the next Tension decay, and turns of Tension remaining at the
current decay rate (`Tension × decayPeriod`, ignoring skill use).
