# 12 — Items and Inventory

**Status:** Wave 2 — core rules. Every actual item is in `21-items-catalog.md`.
**Purpose:** Define item categories, their shared fields, inventory and equipment rules, and how items
enter the world.

---

## ITM-01 Categories

| Category | Glyph | Slot | Stacks? | Defined fields |
|---|---|---|---|---|
| **Melee weapon** | `)` | Weapon | No | `dice`, `accuracyMod`, `special` (0 or 1 named on-hit rule) |
| **Ranged weapon** | `}` | Weapon | No | `dice`, `accuracyMod`, `range`, `tensionCost`, `special` |
| **Plating** | `[` | Plating | No | `plating` (≥ 1), `evasionPenalty` (≥ 0) |
| **Attachment** | `*` | Attachment | No | `forceMod`, `precisionMod`, `platingMod`, `evasionMod` (each may be 0), `special` |
| **Consumable (instant)** | `!` | — | Yes, to 5 | `effect` |
| **Consumable (throwable)** | `{` | — | Yes, to 5 | `range`, `radius`, `effect` |
| **Record** | `?` | — (goes to Journal) | — | `journalIndex` or `blueprint` |

Every item also has `name`, `color`, `description` (≤ 25 words, `STY-09`), and `floors` (the set of
floors whose floor and cache tables may contain it; enemy drop tables are exempt — a Tin Soldier may
drop Tin Plating on floor 6). Item glyphs are drawn in the item's own color on the
map; the category glyph is fixed so the player can read the map at a glance.

## ITM-02 Equipment slots

Exactly three: **Weapon**, **Plating**, **Attachment**. Each holds 0 or 1 item. Equipping an item of a
category into its slot when the slot is occupied swaps: the old item goes into the inventory slot the
new item came from. Unequipping requires a free inventory slot.

## ITM-03 Inventory

- 10 slots, lettered `a`–`j` in display order. Items occupy slots in the order acquired; removing an
  item compacts the list (later items shift up one letter).
- Consumables of the same name stack up to 5 per slot. Picking up a consumable adds to an existing
  non-full stack of the same name first; otherwise it takes a new slot. If no slot is free and no stack
  has room, pickup is refused.
- Equipped items do not occupy inventory slots.
- Records never enter the inventory: picking one up moves it to the Journal screen (`UI-15`) and takes
  a turn like any pickup.

## ITM-04 Items in the world

- A tile holds at most **one** item (a stack of consumables counts as one item).
- Items are drawn on the tile in place of the floor glyph; an actor standing on an item hides it
  (the inspect line still reports it).
- Items are never destroyed by hazards or damage. They do not fall, roll, or burn.
- Items placed by generation are always on floor tiles inside rooms (`WLD-12`), never in corridors,
  never on doors, features, or hazards.

## ITM-05 Item information

Hovering or inspecting an item — on the map or in the inventory — shows every field in ITM-01 as
numbers, its description, and for weapons the damage range against the currently hovered enemy if any
(`CHR-11`). There are no hidden properties.

## ITM-06 Pick up

Action **Pick up** (`CMB-05`): takes the item on Tick's tile. Log: "Tick picks up the *[name]*." or
"Tick picks up 2 Solder (now 3)." Auto-pickup does not exist; stepping onto an item prints "There is
a *[name]* here." to the log.

## ITM-07 Inventory screen actions

From the Inventory screen (`UI-14`), with an item selected:

| Action | Turn? | Rule |
|---|---|---|
| **Equip** | Yes | Weapon/Plating/Attachment only. Performs the swap in ITM-02. Log: "Tick wields the *X*." / "Tick bolts on the *X*." / "Tick fits the *X*." |
| **Unequip** (on an equipped item) | Yes | Needs a free inventory slot; otherwise refused without a turn. |
| **Use** | Yes | Instant consumables only. Applies `effect`, removes one from the stack. |
| **Throw** | Yes | Throwables only. Enters targeting (`UI-12`); cancelling spends no turn. |
| **Drop** | Yes | Places the whole stack on Tick's tile if that tile has no item and is not a feature tile; otherwise refused without a turn. Equipped items must be unequipped first. |

Closing the screen is free. Every turn-costing action closes the screen and runs the turn loop.

## ITM-08 Weapons

- Tick attacks with the equipped weapon's `dice`; unarmed is `1d2` with `accuracyMod 0`.
- Melee weapons' damage adds `Force` (`CMB-06`). Ranged weapons' damage does not, and each shot costs
  `tensionCost` Tension (`CMB-08`).
- `special` is one of a small closed set of named on-hit rules, listed and defined in
  `21-items-catalog.md`. A weapon has at most one. Specials never stack with skill effects of the same
  name; they are distinct rules with distinct names.
- There is no durability, no weapon skill, no dual wielding.

## ITM-09 Consumables

Instant consumables apply on **Use**; the two guaranteed types are:

| Name | Effect |
|---|---|
| **Solder** | Integrity +15 (or +25 with **Efficient Springs**), clamped. |
| **Spring-Key** | Tension +30 (or +45 with **Efficient Springs**), clamped. |

Other consumables (throwables and further instants) are defined in `21-items-catalog.md`. Throwables
follow `CMB-08`. Using a consumable that would have no effect (e.g. Solder at full Integrity) is still
allowed and still consumes it; the log says "Nothing needed mending." — *Rationale:* legibility over
protection; the panel already shows the numbers.

## ITM-10 Loot tables

- A **loot table** is a list of `(itemName, weight)` pairs with positive integer weights.
- To roll: `total = Σ weights`; draw `r` uniformly from `[1, total]` with the run PRNG; walk the list
  subtracting weights until `r ≤ 0`; the current entry is the result.
- Three kinds of tables exist, all per floor and all in `23-floors.md`:
  - **Floor table** — used for the floor's free-standing items (`WLD-12`).
  - **Cache table** — used for the 2–3 items in the floor's Cache room.
  - **Drop tables** — one per enemy type in `22-bestiary.md`, with a `dropChance` (%) rolled first.
- **No-duplicate rule for equipment:** when a floor or cache table roll produces a weapon, plating, or
  attachment that has already been generated on this floor, re-roll once; if the re-roll also
  duplicates, keep it. Consumables are never re-rolled.
- Items marked `unique` in the catalog are generated at most once per run (tracked in the run state);
  a roll that would produce an already-generated unique item re-rolls until it does not (uniques are
  always in tables that contain at least one non-unique entry).

## ITM-11 Enemy drops

When an enemy breaks: roll `d100`; if `≤ dropChance`, roll its drop table and place the item on the
enemy's tile. If that tile already holds an item or is a feature tile (stairs, station), place it on the nearest
free walkable non-feature tile by Chebyshev distance (ties: the first in reading order — top-left to
bottom-right); if none within distance 2, the item is not created. Bosses always drop (dropChance 100),
their drops are unique, and for them the search has no distance limit (a unique item is never lost).

## ITM-12 Starting kit and the floor 1 guarantee

Tick starts with the items in `CHR-01`. Floor 1's generation guarantees (`23-floors.md`) that its Cache
contains at least one plating item, so that every run can have armor by floor 2.
