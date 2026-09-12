# 32 — Acceptance Tests

**Status:** Wave 4. Every test is observable from the running game (via the UI or `TEC-13` hooks) and
cites the rule it verifies.
**Purpose:** Give the builder a checklist that, when green, means the game matches the specs. Tests are
grouped by source document. "Given / When / Then" is implied by the three columns.

---

## ACC-0x Determinism and persistence (`TEC-07`, `TEC-09`)

| ID | Setup | Action | Expected |
|---|---|---|---|
| ACC-01 | New run with seed `TEST1234` | Perform 50 scripted actions | Log, map, and state are byte-identical across two browsers/sessions. |
| ACC-02 | Mid-run on floor 3 | Reload the page, press Continue | State, turn counter, FOV, log tail, and the *next* hit roll are identical to not reloading. |
| ACC-03 | Mid-run | Die | `localStorage` key is absent on the Death screen; Title shows no Continue. |
| ACC-04 | Autosave exists | New run → answer `n` to Abandon | Save unchanged; still on Title. Answer `y` | Save deleted; intro shown. |
| ACC-05 | Save with `version: 1` injected (the pre-M13 format) | Load page | Treated as no save; key removed (`TEC-09`; M13 raised the version to 2). |
| ACC-06 | Any run | Hover, inspect, open screens 100 times | `playRngState` unchanged (`TEC-07` last bullet). |

## ACC-1x Turn loop and combat (`10`)

| ID | Setup | Action | Expected |
|---|---|---|---|
| ACC-10 | Tension 100, turn 0 | Take 5 turns of Wait | Tension 99 exactly after the 5th (`CMB-02` step 2). |
| ACC-11 | Tension 1, turn 4 | Wait | Death "Tick wound down on floor 1." before any enemy acts (`CMB-02` order). |
| ACC-12 | SLOW enemy Active, adjacent | Wait ×4 | It acts on turns 2 and 4 only (`CMB-03`). |
| ACC-13 | Two FAST enemies (ids 1,2) Active, adjacent | Wait | Order of actions: 1, 2, 1, 2 (passes interleave). |
| ACC-14 | Dormant NORMAL enemy 3 tiles away in FOV | Wait | It wakes this turn and does **not** act until the next turn (`ENM-03`). |
| ACC-15 | Tick acc 80, enemy eva 5, forced roll 75 / 76 | Attack | Hit / miss respectively (`CMB-06`, chance 75). |
| ACC-16 | Tick acc 80, enemy eva 80 | Attack 100× with all rolls | Hit chance clamps to 15 (`CMB-06`). |
| ACC-17 | Wrench (1d4+1), Force 0, target Plating 3, roll 1 | Hit | Damage 0; log "…glances off…". |
| ACC-18 | Target Exposed, Plating 3, same as above | Hit | Damage 2 (Plating treated as 0). |
| ACC-19 | Enemy Burning 3 | 3 turns | Takes 2 each turn; Rust-moth takes 4; status removed after the 3rd tick. |
| ACC-20 | Enemy Stunned 2, then Stunned 1 applied | — | Duration stays 2 (max, not additive). |
| ACC-21 | Tick Slowed | Wait | Enemy phase runs twice (a NORMAL enemy acts twice). |
| ACC-22 | Ranged weapon, enemy behind another enemy | Fire at the far one | The near one is hit; projectile stops at the first actor (`CMB-08`). |
| ACC-23 | Tension 2, Spring-Bolt Launcher (cost 3) | Fire | Refused, no turn spent, log "Not enough spring…". |
| ACC-24 | Throw Oil Flask at a wall-adjacent tile beyond a wall | Throw | Lands on the last passable tile before the wall. |
| ACC-25 | Enemy against a wall | Knockback | No movement, no error, no bonus (`CMB-09`). |
| ACC-26 | Closed door, Tick adjacent | Move into it | Door opens, Tick does not move, one turn spent, noise 3 wakes a Dormant enemy 3 tiles away through walls. |
| ACC-27 | Diagonal step where source or destination is a door tile | Move | Refused for Tick and never chosen by enemies (`ENM-08`). |

## ACC-3x Character and skills (`11`, `20`)

| ID | Setup | Action | Expected |
|---|---|---|---|
| ACC-30 | XP 9 | Break a 1-XP enemy | Level 2: maxIntegrity +4, Integrity +4, Skills screen opens, panel shows `SP:1`. |
| ACC-31 | XP 220 + more | — | Level stays 9; XP displayed. |
| ACC-32 | No Armature skills | Try to take Overwind Strike | Not available (locked); Braced Frame is. |
| ACC-33 | Take Braced Frame | — | Plating +1, maxIntegrity +6 and Integrity +6 immediately. |
| ACC-34 | Overwind Strike with Wrench, forced dice 4,4 | Use toward enemy, Plating 0 | Damage 9 (4+4+1), noise 6, Tension −8. |
| ACC-35 | Flywheel Guard active, Pendulum Sweep active turn | Stand in band | 6 damage, no Stun. |
| ACC-36 | Piston Drive, hit dealing exactly 6 after Plating | — | Knockback and Stun 1; boss gets Stun 1 (cap). |
| ACC-37 | Salvage taken | Break 4 enemies | Solder appears at the 4th; 4 more → Spring-Key. Counter shows `n/4`. |
| ACC-38 | Efficient Springs | Use Spring-Key at 50 | Tension 95. Use Solder | +25. |
| ACC-39 | Field Repair used | Use again same floor | Refused with "spent until the next floor"; after Ascend, available. |
| ACC-40 | Decoy placed, 3 enemies within 8 Active | 6 turns | They path to/attack the Decoy; it vanishes after 6 turns or at 0 Integrity; no XP, no scrap. Placing a second removes the first. |
| ACC-41 | Tuning + Spring-Bolt Launcher | Fire | Cost 2, accuracy 80+5+5 = 90 base. |
| ACC-42 | Resonant Pulse with enemies at distance 1, 2, 3 | Use | First two take 1d4+2 ignoring Plating and are pushed; the third is untouched. |
| ACC-43 | Discord on a boss | — | Exposed 2, Slowed 2 (caps). |
| ACC-44 | Sympathetic Break, three enemies in a line at distance 1 each, first at 1 Integrity, others at 4 | Break the first | Chain: all three break in one action; XP for all; Salvage counts 3. |
| ACC-45 | Four active skills acquired in order T3, A2, R2, A3 | — | Hotkeys 1–4 map in that acquisition order (`CHR-10`). |

## ACC-5x Items (`12`, `21`)

| ID | Setup | Action | Expected |
|---|---|---|---|
| ACC-50 | Inventory 10 slots full | Pick up | Refused, no turn, log "No room…". |
| ACC-51 | 5 Solder in one stack, another on floor | Pick up | New slot if free; else refused. |
| ACC-52 | Wrench equipped, Mallet in slot c | Equip Mallet | Mallet equipped; Wrench in slot c; one turn. |
| ACC-53 | Equip Brass Plating | — | Panel: `PLT 2`, `EVA 8`. |
| ACC-54 | Drop onto a tile with an item | Drop | Refused, no turn. |
| ACC-55 | Enemy dies on an item tile | — | Drop appears on the nearest free tile in reading order; none within 2 → not created. |
| ACC-56 | Floor table roll produces a duplicate weapon | — | Re-rolled once (`ITM-10`); consumables never re-rolled. |
| ACC-57 | Governor generated | Continue rolling | Never generated again this run. |
| ACC-58 | Cog Saw hit | — | Target Exposed 2; Tick's next attack (the following turn) ignores Plating; the attack after that does not, unless it hit again. |
| ACC-59 | Pendulum Flail hit with 2 other adjacent enemies | — | Each takes 2 minus its Plating. |
| ACC-60 | Oil Reservoir equipped, Stoker hits | — | No Burning. Steam Vent | No Burning, still 4 damage. |
| ACC-61 | Sounding Plate | Melee attack; open door | Noise 2; silent. |
| ACC-62 | Governor equipped | 30 turns | Tension −5, not −6. |
| ACC-63 | Clatter Can thrown | — | Active enemies within 10 head to the landing tile; Dormant within 10 wake (noise 10). |
| ACC-64 | Flux at full Integrity while Burning | Use | Burning removed; item consumed; "Nothing needed mending." not printed (status was removed). |
| ACC-65 | Journal page on floor | Pick up | Not in inventory; Journal shows the page; log line per `SCR-04`. |

## ACC-7x World and generation (`13`, `23`)

| ID | Setup | Action | Expected |
|---|---|---|---|
| ACC-70 | 1,000 seeds × floors 1–7 | Generate | Every floor validates; ≥ 5 rooms; all rooms reachable; exactly one `<`, one `&`, one journal page `?` (floor 6: plus the Blueprint `?`); cache has 2–3 items. |
| ACC-71 | Same | — | No two door tiles adjacent; doors only on room boundary walls, and **every door a threshold** per `WLD-06` (two opposite passable orthogonal neighbours, walls on the other two); no room boundary left carrying a multi-tile opening except where narrowing it would disconnect the floor; no item on a corridor/door/feature/hazard tile; ≤ 1 item per tile. |
| ACC-72 | Same | — | No enemy in the start room; no enemy visible from the start tile; no hazard adjacent to start, stairs, or station. |
| ACC-73 | Same | — | Station room's BFS distance is the closest to half the stairs distance among eligible rooms. |
| ACC-74 | Floor 2 | — | Exactly 6 Grinding Gears (or fewer only if placement failed 100 times), all on corridor tiles, none adjacent to each other. |
| ACC-75 | Floor 4, turn 6k and 6k+1 | Stand on a vent | 4 damage ignoring Plating + Burning 2; on 6k+2..6k+5 nothing; the panel shows `vents in n` / `ACTIVE`; the warning color appears on 6k−1. |
| ACC-76 | Floor 7 | — | Every Floor/door tile with x ∈ [28,31] is Pendulum Sweep; no feature in the band; active on turns 8k. |
| ACC-77 | Floor 8 | Load | Map is 24 × 60 matching `FLR-09`; Tick at (5,4); Understudy at (51,5); Unfinished at (24,18), (50,18) Dormant; no stairs/station. |
| ACC-78 | FOV | Stand in a room corner | Visible set equals the reference symmetric-shadowcast output filtered to Chebyshev 8; walls at the edge are visible; symmetric with an enemy's view. |
| ACC-79 | Memory | Leave a room with an item, item is then picked up by nobody | Remembered tile still shows the item dim; enemies never drawn on remembered tiles. |
| ACC-80 | Ascend | On `<` press `<` | Next floor generated from `fnv1a(seed:floor:n)`; statuses cleared; old floor discarded; log "Tick climbs. Floor n: name." |
| ACC-81 | Floor 1 start | — | Tick stands on a spent station; Interact says "This station has run down." |

## ACC-8x Enemies and AI (`14`, `22`)

| ID | Setup | Action | Expected |
|---|---|---|---|
| ACC-82 | Dormant enemy, noise 5 at distance 5 through a wall | — | Wakes; `lastKnown` = noise tile. At distance 6 | Stays Dormant. |
| ACC-83 | Active CHASER loses sight | 9 turns | Returns to Dormant after `lastKnownAge > 8`; GUARD returns home first. |
| ACC-84 | GUARD woken with Tick outside its room bounds | — | Goes RETURNING → DORMANT without approaching. |
| ACC-85 | Cuckoo sees Tick at range 6 | — | Turn 1: telegraph color + "The Cuckoo draws breath."; turn 2: shriek, noise 12, `1d4` ignoring Plating. Tick steps out of line of fire between | Shriek cancelled. |
| ACC-86 | SKIRMISHER with Tick adjacent and a free farther tile | — | It retreats; with no farther tile | It melees with `1d2`. |
| ACC-87 | Gear-Golem reaches adjacency | — | Wind-up (telegraph) on its action; heavy `3d4` on its next action two turns later; stepping away between → nothing. |
| ACC-88 | Gear-Golem vs closed door | — | Door becomes Floor, noise 6, Golem does not move that action. Spring-Hound vs closed door | Treats it as wall. |
| ACC-89 | The Unfinished, 1,000 actions with a forced d10 sequence | — | 50% chase, 30% random step, 20% wait; never returns to Dormant; cannot be Blinded. |
| ACC-90 | Swarmers, blocked corridor | — | They plan through each other but Wait when the next tile is occupied. |
| ACC-91 | A* determinism | Same map, same positions | Same path every time; ties per `ENM-08`. |
| ACC-92 | Cache guard of type Sweeper | Tick outside the cache room | It behaves as GUARD (stays). |
| ACC-93 | Conductor | Enter FOV of the stage room | Moment 1 text box; the Conductor is Active. Every 3rd action while seeing Tick: telegraph then 2 Dancers adjacent (cap 4 alive). At Integrity ≤ 16 | FAST, no more summons; log "…tempo doubles." |
| ACC-94 | Regulator | Sight/noise | Wakes; BRUISER; at ≤ 24: NORMAL; every 4th action telegraph "seams glow" then Vent: radius 2, 4 damage ignoring Plating + Burning 2. Immune Slowed/Burning; Stun cap 1. |
| ACC-95 | Understudy | Open the antechamber door | Text box line 1; Active. Overwind every 4th action when adjacent (telegraph "tightens"). At ≤ 48: line 2 as a text box **and** a log line, 2 Unfinished appear at markers; Pulse every 4th action when Tick within 2 (telegraph "hums"), `1d6+1` ignoring Plating + push. At ≤ 24 **or spring ≤ 80, whichever is first and said only once**: line 3 as a text box and a log line; ≤ 24 also means SLOW, no specials. All four `SCR-06` lines reach both a box and the log, and the log renders their `*emphasis*` rather than printing asterisks. **Inspect popup shows `Spring n/250`**, −2 per action; at 0 | defeat sequence. The spring must outlast the damage clock — 125 actions against a 12–35 turn kill. |
| ACC-96 | Understudy defeated | — | Text box (moment 3 + line 4) → text box (thought 3) → Ending choice; no scrap; no XP. |
| ACC-97 | Bosses | Apply Stun 3 / Exposed 4 | Durations become 1 / 2. |

## ACC-10x UI and controls (`15`, `24`)

| ID | Setup | Action | Expected |
|---|---|---|---|
| ACC-100 | Any | Resize window | 80×30 grid always fully visible, letterboxed, cell aspect 0.6. |
| ACC-101 | Run | Press each key in `UI-10` | Each maps to its action; `Numpad1` moves, `Digit1` uses skill 1; `?` opens Help; `<` only works on stairs. |
| ACC-102 | Run | Hover enemy / item / hazard / station / remembered tile / unseen | Inspect line formats per `UI-05`; unseen → blank. |
| ACC-103 | Run | Right-click enemy | Popup shows name, `cur/max`, hit % vs Tick, damage range after Plating, Plating, speed, state, statuses, description; closes on Esc/right-click/move key. |
| ACC-104 | Run | Click far walkable tile | Travel one step per 60 ms; stops on new enemy sighting, damage, Tension crossing 30/15, item/feature underfoot, failed step, or any input; log "Tick stops." when interrupted. |
| ACC-105 | Run | Click adjacent enemy | Melee attack. Click distant enemy | Travel to an adjacent tile, then stop (no auto-attack). |
| ACC-106 | Run | Click own tile with item / with unspent station / with nothing | Pick up / Interact / Wait. |
| ACC-107 | Panel | Tension 31 → 30 → 15 | Bar green → yellow → red; "The spring is loosening." once per floor at ≤ 30; "…nearly slack." every 5th turn at ≤ 15. |
| ACC-108 | Panel | Level-up with unspent point | Row 0 shows `SP:1` in yellow until spent. |
| ACC-109 | Inventory | Select a consumable, press `e` | Nothing (action greyed). Press `u` | Used, screen closes, turn passes. |
| ACC-110 | Skills screen | Select locked skill, Enter | Nothing. Select available, Enter, `y` | Taken; SP −1. |
| ACC-111 | Journal | Open with 3 pages found | Pages 1–3 bright, others "— not found —"; Enter shows the exact `SCR-03` text; page 8 renders with no signature. |
| ACC-112 | Targeting | Press `f` with two visible enemies | Cursor on the nearest; Tab cycles; line of fire inverted, red when blocked; Esc spends no turn; click confirms. |
| ACC-113 | Log | 7 messages in one turn | Last 5 shown; History has all 7; identical consecutive lines merged with `(×n)`. |
| ACC-114 | Text box | Any scripted moment | Game does not advance until dismissed; dismiss with any key or click; exact `SCR-05` text. |
| ACC-115 | Ending A | Choose A | Page 8 journal view → Ending A text → Victory `THE KEEPER`, flavor line, stats, seed selectable; any key → Title; save deleted (`UI-19`, `SCR-07`). |
| ACC-116 | Ending B | Choose B | Page 8 journal view → seven descent lines 1.5 s each (skippable) → Ending B text → Victory `THE WALKER`. |
| ACC-117 | Death | Integrity 0 by a Stoker on floor 4 | Log "Tick was broken by the Stoker on floor 4."; Death screen header `TICK WAS BROKEN`, flavor line per `SCR-08`. |
| ACC-118 | Title | Enter seed `abc`, Enter | New run; summary later shows `Seed abc`. |
| ACC-119 | Pause | Esc → Quit to title → Continue | Resumes exactly. |
| ACC-120 | Help | `?` | Every key from `UI-10`/`UI-12`/`UI-14` listed; the six rule lines of `SCR-09` verbatim. |
| ACC-121 | Flash | Tick takes damage | Map background `#3a1010` for one frame only; no other animation exists. |
| ACC-122 | Telegraph | Enemy winding up | Drawn with telegraph colors; inspect line contains `winding up`. |

## ACC-13x Balance smoke (`31`)

| ID | Setup | Action | Expected |
|---|---|---|---|
| ACC-130 | `BAL-07` S1–S6 bots, 200 seeds each | Run | Each target met. |
| ACC-131 | Full-explore scripted run on seed `TEST1234` | Run it twice: spending the Spring-Keys it finds, and spending none | Spending: reaches floor 8, never wound down, Tension at entry within 15–80. Hoarding: winds down before floor 8 — a full explore is no longer free (`DIF-14`). |
| ACC-132 | All content tables | Static check | Every item name in `23` exists in `21`; every enemy name in `23` exists in `22`; every skill name in `11`/`20` matches; every color name resolves in the palette (`UI-08` + `BST-01`). |
| ACC-133 | All docs | Search for placeholder markers (to-be-decided notes, question-mark runs) | None; every value in the specs is fixed (`OVR-07` rule 10). |

## ACC-14x–16x M13 "The Tower Notices" (`50-difficulty-plan.md`)

Every expectation below is stated against `data/tuning.js` rather than against a number, because the
DIF-15 ladder moves the numbers and the rules are what these tests are for (`DIF-02`).

| ID | Setup | Action | Expected |
|---|---|---|---|
| ACC-140 | Tension 60, Integrity 1 | Use a Solder | `solderTension` paid once; `solderAmount` restored over `solderTurns` turns — the even share each turn and the remainder on the last — the first tick on the turn it was used (`CMB-02` step 3). |
| ACC-141 | A repair running, an enemy adjacent | Let it hit, then let it glance | A hit that deals ≥ 1 logs "The solder cracks." and ends the repair, losing the rest; a 0-damage glance does not. |
| ACC-142 | Tension ≤ `solderTension`; then a repair already running | Use a Solder | Refused with "Not enough spring to heat the solder." / "Tick is already soldering."; no turn, no item (`CMB-05`). |
| ACC-143 | Efficient Springs taken | Use a Solder | The repair's total is `solderAmount + efficientSolderBonus`, spread the same way (`SKL-03`). |
| ACC-144 | A repair running | Read the panel; use a Flux | Row 15 shows `Solder(n)`; Flux clears the five statuses and leaves the repair alone (`UI-03`, `CMB-10`). |
| ACC-145 | All enemy and floor tables | Static check | No regular enemy's drop table holds Solder or a Spring-Key; no table is empty unless its `dropChance` is 0; every floor 1–7 still places both on the floor or in its cache (`DIF-04`). |
| ACC-146 | A stack at `stackMax` | Pick up one more | It takes a new slot; with every slot full the pickup is refused (`ITM-03`). |
| ACC-147 | Salvage taken, 16 breaks | Break them | One throwable every 4th break, cycling Grit Bomb → Oil Flask → Tuning Fork → Clatter Can; never Solder or a Spring-Key (`SKL-03`). |
| ACC-148 | A Dormant enemy inside `stationNoise` and one outside it | Wind the station | Tension to `stationRestore`; "The winding rings through the tower."; the one inside wakes with `lastKnown` on the station, the one outside does not; floor 1's spent station rings nothing (`CHR-05`, `CMB-11`). |
| ACC-149 | Floor 2, generated | Advance `turnsHere` past the interval repeatedly | One enemy from the floor's wander table each time, Active, flagged `wanderer`, never visible on arrival, never on a feature tile, at most `wanderCap`; floor 8 spawns none (`WLD-14`). |
| ACC-150 | A floor with no cyclic hazard | Read the panel | Row 16 counts down to the next wanderer, and goes blank once the cap is spent (`UI-06`). |
| ACC-151 | Floors 1 and 4 | Read the interval | Floor 1 runs the slower per-floor override; floor 4 runs `wanderInterval` (`WLD-14`). |
| ACC-152 | A Rust-moth adjacent, plating equipped | Let it hit | On a `d100` ≤ `corrosionChance` the plate gains 1 wear and logs "The Rust-moth pits the {X}."; one over does not; a miss never corrodes; with no plating no roll is drawn (`CMB-14`). |
| ACC-153 | A pitted plate and a fresh one of the same kind | Unequip, re-equip, save and load | Wear is per item instance, travels with it, and round-trips (`ITM-01`, `TEC-09`). |
| ACC-154 | A plate with 2 wear | Read the panel, inventory and inspect line | `Iron Plating (−2)`, and the fields read `plating 3 − 2 wear = 1` (`UI-03`, `ITM-05`). |
| ACC-155 | A forced Overwound roll | Create, hit and break it | Name prefixed `Overwound `; Integrity ×`eliteIntegrityMult` (rounded up); accuracy +`eliteAccuracyBonus`; every attack +`eliteDamageBonus` before Plating; XP ×`eliteXpMult`; guards, bosses and pack types never roll it (`ENM-12`). |
| ACC-156 | An Overwound enemy | Look at it | Same glyph and colour on the dark gold ground; the inspect line and popup name it and spell the bonus out (`UI-09`, `UI-11`). |
| ACC-157 | Any seed | Generate a floor twice | The same spawns are Overwound both times, and the rate over many floors is `eliteChance` (`TEC-07`). |
| ACC-158 | XP one short of level 2 | Break an enemy | Max Integrity and Integrity both +`levelUpIntegrity` (`CHR-07`). |
| ACC-159 | An Active chaser with no sight and no noise | Wait | Still Active at exactly `memoryTurns` quiet actions; Dormant on the next (`ENM-05`). |
| ACC-160 | A woken Spring-Hound behind a wall | Track it | Its `lastKnown` is refreshed to the target's tile within `houndRange`, walls notwithstanding; one tile further it ages; it never goes Dormant again (`ENM-13`). |
| ACC-161 | A Cuckoo and a Tin Soldier in its shriek | Shriek | Every Guard inside the radius is woken and runs the CHASER list for `rallyTurns`, logging "The guards leave their doors."; then RETURNING (`ENM-13`). |
| ACC-162 | A Magpie adjacent, two consumable stacks | Let it hit | One unit of one stack (uniform over stacks) is taken instead of damage, logging "The Magpie snatches the {X}!"; with nothing to take it deals `1d2` as normal (`ENM-06`). |
| ACC-163 | A Magpie that has stolen | Act, then break it | It only retreats and never attacks again; breaking it returns the item with `ITM-11`'s unlimited search. |
| ACC-164 | A Magpie spawned as a wanderer | Let it steal | Identical behaviour to a placed one (`WLD-14`, `DIF-11`). |
| ACC-165 | A Wound Lock ahead, Tension ≤ `cacheLockCost`, then above it | Bump it | Refused with "Not enough spring for the lock." and no turn; then it costs `cacheLockCost` and a turn, becomes an open door, and stays open (`WLD-15`). |
| ACC-166 | 1,000 generated floors | Static check | Every passable tile that opens onto the cache room is a Wound Lock; the cache guard and every cache item are inside it (`WLD-15`, `WLD-11` step 9). |
| ACC-167 | A Gear-Golem and a Sweeper against a lock | Let each path through it | `BREAKS` breaks it (noise 6); `YES` treats it as a wall (`ENM-09`, `WLD-15`). |
