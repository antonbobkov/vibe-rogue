# 00 — Overview: Clockwork Hollow

**Status:** Wave 5 — complete. All sixteen documents are final; later docs refine, never contradict, what is written here.
**Purpose:** Fix the identity, scope, pacing, and conventions of the game so that every later document is
filling in detail rather than making decisions. If a later doc conflicts with this one, this one wins
unless the conflict is explicitly noted and resolved in the wave 5 consistency pass.

---

## OVR-01 One-paragraph pitch

*Clockwork Hollow* is a short, single-character, turn-based roguelike played in the browser with colored
ASCII graphics. You are **Tick**, a wind-up automaton — the first and simplest thing the clockmaker
**Aurelie Vance** ever built. She is dead. The tower she built, **the Hollow**, is winding down, and so
are you. Climb its eight floors to the **Great Escapement**, take the **Master Key** — the one tool that
can wind a mainspring from the inside — and decide what to do with it. Every turn costs you spring
tension; every fight, every detour, every skill used is paid for with time. Death is permanent. A
winning run takes 30–45 minutes.

## OVR-02 Design pillars

Every design question in later docs is settled by asking which option better serves these, in order.

1. **The clock is always running.** Tension (the mainspring) is both fuel and hourglass. It replaces
   hunger, ammunition, and mana. The core decision of the game is *how much of this floor do I explore?*
2. **Every fight is a decision, not a tax.** There is no natural regeneration of Integrity or Tension.
   Enemies never exist just to be ground through; each type asks a different question (fight, avoid,
   disable, outpace).
3. **Everything is legible.** No unidentified items, no hidden stats, no secret formulas. Every number
   in the game can be read by hovering or inspecting. Enemies telegraph. Death is always traceable to
   choices, never to a surprise the player could not have seen.
4. **Short and complete.** A run is an evening's story with a beginning, a middle, and one of two ends.
   No meta-progression, no unlocks. The game is the same on run 1 and run 50; only the player changes.
5. **Fewer things, done fully.** Twelve skills, about twenty-five items, fifteen enemies, eight floors.
   Each one has a distinct job. If a later wave proposes adding something, it must remove something.

## OVR-03 Feature scope

### In scope (the complete feature list — nothing else will be added)

| Area | Included |
|---|---|
| Structure | 8 floors, ascend only, no backtracking. Floors 1–7 procedurally generated; floor 8 handcrafted. |
| Character | One fixed character (Tick). Two resources: **Integrity** (HP) and **Tension** (mainspring). Three attributes: **Force**, **Precision**, **Plating**. |
| Progression | XP from kills. Character levels 1→9 (8 level-ups). One skill point per level-up. |
| Skills | 3 disciplines (**Armature**, **Tinkering**, **Resonance**), each a strictly linear line of 4 skills. 12 skills total. A run affords 8 of the 12. |
| Items | 3 equipment slots (**weapon**, **plating**, **attachment**) + 10-slot inventory. ~8 weapons, ~5 platings, ~5 attachments, ~7 consumables. Stackable consumables. |
| Ranged | Ranged weapons and throwables exist. Ranged weapons cost Tension per shot; there is no ammunition. |
| Enemies | ~12 regular enemy types + 2 mini-bosses (floors 3 and 6) + 1 final boss (floor 8). Five AI archetypes. Enemies start dormant and wake on sight or noise. |
| Map | Fixed 60×24 tile map per floor, no scrolling. Rooms and corridors. Doors (open by walking in; block sight when closed). Three hazard tiles built on two mechanisms (constant, cyclic). One **Winding Station** and one **Cache** room per floor 1–7. |
| Vision | Symmetric shadowcasting field of view, radius 8. Remembered tiles drawn dim. |
| Movement | 8-directional for everyone. Energy-based speed with exactly three tiers (slow / normal / fast). |
| Story | Intro text, one journal page per floor (8 total), scripted moments on floors 3, 6, 8, boss dialogue, ending choice with two endings, death and victory summaries. |
| UI | 80×30 character grid. Title, Run, Inventory, Skills, Journal, Help, Ending-choice, Death, Victory screens. Message log. Hover/inspect for every tile, item, enemy, and stat. |
| Input | Keyboard (arrows, numpad, vi-keys, single-letter commands) and mouse (click-to-move with pathing, click-to-attack, click targeting for ranged/throwables, hover to inspect, clickable panel buttons). |
| Persistence | Single autosave slot in `localStorage`, written after every player action, deleted on death or victory. Seeded runs: the seed is shown on the summary screen and can be entered on the title screen. |
| Audio | None required. The spec is complete without sound. |

### Out of scope (explicitly rejected — do not add)

Item identification · shops or currency · crafting · hunger (Tension covers it) · ammunition · multiple
classes or races · character creation · persistent meta-progression or unlocks · backtracking to earlier
floors · scrolling maps · pets or allies · stealth meter · lighting levels · multiple save slots ·
animations beyond single-frame flashes · procedural story · difficulty settings · daily runs · online
features.

## OVR-04 Run shape and pacing targets

These are targets that wave 3 content and wave 4 balance must hit. "Turns" are player turns.

| Floor | Name | Target turns (full explore) | Regular enemies | Boss | Expected char. level on exit |
|---|---|---|---|---|---|
| 1 | The Workshop | 180 | 7–8 | — | 2 |
| 2 | The Gear Gallery | 220 | 8–10 | — | 3 |
| 3 | The Music Room | 240 | 8–10 (+ summons) | Mini-boss: **The Conductor** | 4 |
| 4 | The Furnace Deck | 240 | 7 | — | 5 |
| 5 | The Aviary | 240 | 9–11 | — | 6 |
| 6 | The Archive | 260 | 9–11 | Mini-boss: **The Regulator** | 7 |
| 7 | The Pendulum Stair | 260 | 8–10 | — | 8 |
| 8 | The Escapement | 120 | 2 (+ summons) | Final boss: **The Understudy** | 9 |
| | **Total** | **~1,760** | **~65** | | |

- A full-explore run is ~1,760 turns. A confident player taking ~1.2 s per turn finishes in ~35 minutes
  plus reading. A cautious first-time player reaches ~60 minutes before dying or winning.
- **Tension pacing rule:** fully exploring a floor costs roughly **half** of maximum Tension in time
  decay alone, before any skill use. The floor's Winding Station restores Tension to full. The
  central rhythm of a floor is therefore: *explore to the station → rewind → decide whether the rest
  of the floor is worth the spring.*
- Every floor 1–7 guarantees: exactly one up-stair, one Winding Station, one Cache room (2–3 items),
  one journal page. Nothing else is guaranteed.
- Character level 9 (all 8 skill points) is reached during floor 8 by a player who fought most of what
  they met. A player who avoided fights arrives at floor 8 around level 7 with more Tension and items.
  Both should be able to win.

## OVR-05 Difficulty philosophy

- **Target win rates:** first run ~10%; a player on their fifth or later run who has read the Help
  screen ~50%; an expert ~80%. The game is meant to be beaten, then replayed a few times for the other
  ending and other builds, then finished with.
- **Low variance.** Damage rolls use narrow dice (e.g. `2d3`, never `1d12`). No enemy can deal more than
  40% of Tick's *expected* Integrity at that floor in a single hit. No instant kills. No one-shot traps.
- **Telegraphed threats.** Every enemy attack that is not a plain melee hit has a visible wind-up turn
  or a visible state (e.g. the Cuckoo is drawn in a different color the turn before it shrieks).
- **Deterministic information.** Hovering an enemy shows its exact Integrity, attack, plating, speed and
  what it will do next turn if that is decidable. Hovering a stat shows its formula.
- **Death is a decision made earlier.** The most common death should be "explored too far with too
  little Tension" or "fought a Gear-Golem in the open", not "got unlucky".
- **The game is not long enough to be grindy.** There are no respawns and no way to farm XP.

## OVR-06 Headline numbers (fixed here; detailed in waves 2–4)

| Quantity | Value |
|---|---|
| Starting Integrity | 40 |
| Maximum Tension | 100 (never increases; never decreases) |
| Starting Tension | 100 |
| Tension time decay | 1 point every 5 player turns, unconditionally |
| Winding Station | Restores Tension to 100; single use; one per floor 1–7 |
| Spring-Key (consumable) | Restores 30 Tension |
| Solder (consumable) | Restores 15 Integrity |
| FOV radius | 8 |
| Map size | 60 × 24 tiles, fixed |
| Inventory | 10 slots; consumables stack to 5 per slot |
| Equipment slots | Weapon, Plating, Attachment |
| Character levels | 1 → 9; 8 skill points total |
| Skills | 12 (3 lines × 4) |
| Speed tiers | Slow (acts every 2nd turn), Normal (1 per turn), Fast (2 per turn) |

## OVR-07 Documentation conventions

These apply to every file in `specs/`.

1. **Rule IDs.** Every normative statement has an ID `PREFIX-NN`. Prefixes: `OVR` overview, `STY` story,
   `CMB` combat, `CHR` character, `ITM` items, `WLD` world, `ENM` enemies, `UI` interface, `SKL` skills
   catalog, `CAT` items catalog, `BST` bestiary, `FLR` floors, `SCR` script, `TEC` technical, `BAL`
   balance, `ACC` acceptance. Cross-reference by ID, never by page or section number.
2. **Tables beat prose.** If a table and a sentence disagree, the table is authoritative.
3. **Numbers are numbers.** Never "a few", "some", "roughly" in a normative statement. Ranges are
   inclusive and written `3–5`. Dice are written `NdS+M`, rolled as the sum of N dice with S sides
   plus M; `d` rolls are uniform. A flat value is written `1 (flat)` and means `0d1+1`. Percentages are integers.
4. **Rounding.** Unless a rule says otherwise, fractional results round **down** to an integer, and
   any clamping (e.g. minimum 1 damage) happens **after** rounding.
5. **Names.** A game entity is written in **bold** where it is defined and matched exactly
   (case-sensitive) everywhere else. Renaming requires updating every occurrence.
6. **Colors** are given as hex `#RRGGBB`. **Glyphs** are single printable ASCII characters (0x21–0x7E)
   or the space character, given in backticks.
7. **Time.** "Turn" means one player action at Normal speed. "Tick" (lowercase) is never used for time
   — Tick is the protagonist. Use "turn" and "energy".
8. **Tie-breaks.** Whenever simultaneous or ambiguous ordering is possible (two enemies act, two effects
   expire), the rule that resolves it is stated where the mechanic is defined.
9. **"Builder"** means the person or system implementing the game from these specs. Text addressed to
   the builder is normative unless marked *Rationale:*, which is explanatory only.
10. **Placeholders.** No "to be decided" markers of any kind remain in the final specs; every value is
    fixed. If a builder finds an undefined case, that is a spec bug to be fixed here, not a choice.

## OVR-08 Document index

| File | Wave | Contents | Status |
|---|---|---|---|
| `00-overview.md` | 1 | This document | Done |
| `01-story.md` | 1 | World, characters, floor-by-floor beats, endings, tone, glossary | Done |
| `10-turns-and-combat.md` | 2 | Energy system, actions, to-hit/damage formulas, status effects, death | Done |
| `11-character-and-skills.md` | 2 | Integrity, Tension, attributes, XP curve, discipline framework | Done |
| `12-items-and-inventory.md` | 2 | Slots, inventory rules, item categories, loot-table mechanism | Done |
| `13-world-and-generation.md` | 2 | Tiles, generation algorithm, FOV, floor 8 layout format | Done |
| `14-enemies-and-ai.md` | 2 | Perception, AI archetypes, wake rules, boss framework | Done |
| `15-ui-and-controls.md` | 2 | Screen layout, every key and mouse action, all screens, colors | Done |
| `20-skills.md` | 3 | All 12 skills, fully specified | Done |
| `21-items-catalog.md` | 3 | Every item with stats, glyph, color, text, floor availability | Done |
| `22-bestiary.md` | 3 | Every enemy and boss with stats, AI, drops, text, boss phases | Done |
| `23-floors.md` | 3 | Per-floor themes, generation parameters, spawn and loot tables | Done |
| `24-script.md` | 3 | All in-game text, verbatim | Done |
| `30-technical.md` | 4 | Stack, module layout, data schemas, PRNG, save format, rendering | Done |
| `31-balance.md` | 4 | Expected-run model and sanity checks against wave 3 tables | Done |
| `32-acceptance-tests.md` | 4 | Observable behaviors and edge cases the finished game must satisfy | Done |

## OVR-09 Reading order for a builder

`00` → `01` → `15` (to see what the player sees) → `10` → `11` → `12` → `13` → `14` → `30` → then the
content docs `20`–`24` as data, then `31` and `32` to verify.
