# 31 — Balance

**Status:** Wave 4 — model, recomputed for **M13** (`50-difficulty-plan.md`). The numbers here are
*derived* from waves 2–3 and from `data/tuning.js`; if a later change to those breaks a check below,
the check wins and the numbers must be re-tuned per the DIF-15 ladder.
**Purpose:** Show, with arithmetic a builder can repeat, that the content in `20`–`24` hits the pacing
and difficulty targets in `OVR-04`/`OVR-05`; and give the builder the sanity checks and tuning knobs
to use after playtesting.

Every number M13 moved lives in one place, `data/tuning.js` (`DIF-02`), and the values this document
models are that file's — not the opening numbers of `50-difficulty-plan.md`, which the DIF-15 ladder
turned. `specs/BALANCE-CHANGELOG.md` rows B-005 … B-014 are the moves, each measured.

---

## BAL-01 Tension budget (the clock)

Assumptions: a **full-explore** run uses the target turns from `OVR-04`; the Winding Station is
reached at 50% of a floor's turns and rewinds to `stationRestore` (85); skills and ranged shots cost
the amounts shown; every floor 1–7 pays `cacheLockCost` (10) for its cache (`WLD-15`) and starts
≈ 1 Solder repair at `solderTension` (5) (`CAT-06`); the floor's tables yield ≈ 0.7 Spring-Keys
(`springKeyAmount` 30, so **+21**). Decay is 1 per `decayPeriod` (5) turns (`CHR-04`).

| Floor | Turns | Arrive | Decay to station | At station | Rewind | Decay to stairs | Skill/shot | Lock | Solder | Keys | Leave |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 100 | — (station spent) | — | — | −36 | −4 | −10 | −5 | +21 | **66** |
| 2 | 220 | 66 | −22 | 44 | 85 | −22 | −15 | −10 | −5 | +21 | **54** |
| 3 | 240 | 54 | −24 | 30 | 85 | −24 | −20 (boss) | −10 | −5 | +21 | **47** |
| 4 | 240 | 47 | −24 | 23 | 85 | −24 | −20 | −10 | −5 | +21 | **47** |
| 5 | 240 | 47 | −24 | 23 | 85 | −24 | −20 | −10 | −5 | +21 | **47** |
| 6 | 260 | 47 | −26 | 21 | 85 | −26 | −25 (boss) | −10 | −5 | +21 | **40** |
| 7 | 260 | 40 | −26 | 14 | 85 | −26 | −25 | −10 | −5 | +21 | **40** |
| 8 | 120 | 40 | — | — | — | −24 | −20 (boss) | — | −5 | +21 | **12** |

Findings:
- A full-explore run finishes **only because it spends what it finds**. Take the Spring-Keys out of
  the column and the same line reads 45 · 33 · 26 · 26 · 26 · 19 · 19 · **−30**: the spring runs out
  under Tick on floor 7 or 8. That is `ACC-131`'s second half, and it is the M13 change that
  `DIF-00` asked for — before it, a full explore arrived on floor 8 with 47 Tension unspent.
- The pre-station low points are now **14–44**, and 14 on floor 7 is the run's low point. Every one
  of them is below `CHR-03`'s first warning, which is the moment the game asks "station first, or
  loot first?" — and since `DIF-05` the answer costs something either way, because winding is loud.
- A **rushing** player at 60% of `OVR-04`'s turns never drops below 36 before a station and leaves
  floor 8 with **33**. The rush line is the one with room in it now.
- The **Governor** (decay 1/6) is worth ≈ +9 Tension per floor from floor 7 on.

Check **BAL-C1** (restated by `DIF-14`): the **60%-turns** line's "Leave" column never goes ≤ 0. The
full-explore line may — and without Spring-Keys it does.

## BAL-02 Integrity budget (the fights)

Model per enemy: Tick's expected damage per attack `E_T = hit% × E[max(0, dice + Force − enemyPlating)]`;
turns to kill `k = ceil(Int / E_T)`; the enemy makes `k − 1` attacks (NORMAL), `2(k − 1)` (FAST),
`(k − 1)/2` (SLOW); each deals `E_E = hit% × E[max(0, dice − TickPlating)]` (ignoring-Plating attacks use
the raw expectation). A "typical" progression is assumed:

| Floor | Tick weapon (avg) | Force | Acc | Plating | Evasion | Integrity max |
|---|---|---|---|---|---|---|
| 1 | Wrench 3.5 | 0 | 80 | 0 → 1 (Tin, mid-floor) | 10 | 40 |
| 2 | Mallet 4.5 / Cog Saw 3.5 | 0 | 80 | 2 (Brass) | 8 | 43 |
| 3 | 4.5 | 0 | 80 | 2 | 8 | 46 |
| 4 | Escapement Blade 5 | 2 | 85 | 3 (Iron) | 6 | 49 |
| 5 | 5 | 2 | 85 | 3 | 6 | 52 |
| 6 | 5 | 2 | 85 | 4 (Steel) | 4 | 55 |
| 7 | Piston Hammer 7.5 | 2 | 80 | 4 | 4 | 58 |
| 8 | 7.5 | 2 | 80 | 4 | 4 | 61 |

`CHR-07` gives `levelUpIntegrity` (3) per level since `DIF-09`, which is where the smaller maxima
come from. Two M13 rules raise the expected loss on every floor by ≈ **25%**, and the table below
carries that:

- **`WLD-14` wanderers** (`DIF-06`): up to `wanderCap` (4) extra enemies per floor, Active from the
  moment they arrive, on a `wanderInterval` (50; floors 1–3 slower) clock.
- **`ENM-12` Overwound** (`DIF-08`): `eliteChance` (8%) of regular spawns carry +50% Integrity,
  +10 accuracy and **+2 flat damage** — the bonus is applied *before* Plating, which is what stops
  Plating from zeroing the small enemies outright.

Expected Integrity lost per floor (all enemies fought, boss included, hazards avoided):

| Floor | Main contributors | Expected loss | Integrity available (max + ≈ 1 Solder × 50) | Ratio |
|---|---|---|---|---|
| 1 | Sweepers ×4 ≈ 9; Rust-moths ≈ 6–13; one wanderer | **≈ 23** | 40 + 50 | 26% |
| 2 | Tin Soldiers ×2 ≈ 12; hound ≈ 1; Overwound anything ≈ 3 | **≈ 16** | 43 + 50 | 17% |
| 3 | Guard soldier 6; Dancer 2.5; Cuckoo 2; **Conductor ≈ 15** + summoned Dancers ≈ 5–10 | **≈ 41** | 46 + 50 | 43% |
| 4 | Stokers ×2 ≈ 12 (Burning is most of it); Gear-Golem 0–6; Rust-moth pack (plating wear, `CMB-14`) | **≈ 31** | 49 + 50 | 31% |
| 5 | Cuckoos ×3 ≈ 11 (shriek ignores Plating); Finch packs ≈ 10; **Magpie** (a theft, not damage) | **≈ 28** | 52 + 50 | 27% |
| 6 | Archivists ≈ 5; Unfinished ≈ 2; Knight guard ≈ 6; **Regulator ≈ 12–25** | **≈ 46** | 55 + 50 | 44% |
| 7 | Knights ×2 ≈ 10; Stoker ≈ 5; Cuckoo ≈ 4; Finches ≈ 4; Magpie; hazards ≈ 6 | **≈ 40** | 58 + 50 | 37% |
| 8 | Unfinished ×2–4 ≈ 6; **Understudy ≈ 30** (hammer) / ≈ 45 (blade) | **≈ 64** | 61 + 50 | 58% |

Findings:
- The Solder is the whole margin now, and it is **one item, once a floor, three turns long, and any
  hit ends it** (`ITM-09`, `DIF-03`). Its 50 is not generosity: it is what one uninterrupted repair
  has to be worth when a run finds seven of them rather than twenty.
- Floors 1–2 teach; floors 3 and 6 spike (bosses); floor 8 is the hardest but < 65% of available
  Integrity for the typical build with one Solder in hand. Stepping away from telegraphed hits
  (Golem, Regulator, Understudy Overwind/Pulse) removes 5–15 per boss — the intended skill
  expression, and since `DIF-03` **breaking contact to repair is a second one**.
- Plating 2 by floor 2 makes `1d3` enemies harmless; Plating 3–4 makes `1d4` enemies harmless — but
  only until a Rust-moth pits it (`CMB-14`) or an Overwound one adds its +2. That is the answer to
  `DIF-00`'s "more Plating → half the bestiary deals 0".

Check **BAL-C2:** no floor's expected loss exceeds 65% of (Integrity max + one Solder). (Passes; the
worst is floor 8 at 58%.)

## BAL-03 XP and levels

Nominal XP per floor (`FLR-10`): 15.5 · 27 · 33 (+16 summons) · 49 · 50 · 59 · 64.5 · 36 = **334–350**;
`CHR-06` requires ≥ 300. The M13 additions are floor 4's Rust-moth pack (`DIF-07`) and the Magpie on
floors 5 and 7 (`DIF-11`); `WLD-14`'s wanderers are *not* counted, for the same reason the
Conductor's dancers are not — they are a live stream, not a fixed roster, and they are worth
≈ +12 XP a floor to a player who fights them. `ENM-12` elites are worth `eliteXpMult` (×2), which
adds ≈ +8% on top.

Cumulative XP at 75% kills: 11.6 · 31.9 · 56.6 · 93.4 · 130.9 · 175.1 · 223.5 · 250.5 → levels
**2, 3, 4, 5, 6, 8, 9, 9** at the end of floors 1–8 — `OVR-04`'s curve as far as floor 5 and a level
ahead of it from floor 6, which is the direction `CHR-06` allows (level `n+1` is a floor, not a
ceiling). At 100% kills the player reaches the level-9 cap during floor 6; at 50% kills they arrive
on floor 8 at level 8.

Check **BAL-C3:** 75%-kill cumulative XP crosses the level-`n+1` threshold during or at the end of
floor `n` for every `n` in 1–8, and a floor-8 arrival is level **7–9** (`DIF-01`). (Passes.)

## BAL-04 Single-hit cap

`OVR-05` forbids any single hit > 40% of Tick's expected max Integrity on that floor. Since `DIF-08`
every regular, non-pack enemy may be **Overwound**, which adds `eliteDamageBonus` (+2) to every one
of its attacks; the column below is the worst case with that bonus applied, against the smaller
`CHR-07` maxima of `DIF-09`.

| Floor | Largest possible single hit | Expected max Integrity | Ratio |
|---|---|---|---|
| 1 | Overwound Sweeper 5 | 40 | 13% |
| 2 | Overwound Tin Soldier 7 | 43 | 16% |
| 3 | Overwound Dancer 6; Conductor 5 | 46 | 13% |
| 4 | Overwound Gear-Golem heavy 14 | 49 | 29% |
| 5 | Overwound Cuckoo 6 (unreducible) | 52 | 12% |
| 6 | Regulator heavy 15; Overwound Golem 14 | 55 | 27% |
| 7 | Overwound Knight 10; Pendulum Sweep 6 | 58 | 17% |
| 8 | Understudy Overwind 16; Pulse 7 | 61 | 26% |

Check **BAL-C4:** all ratios ≤ 40%. (Passes; the worst is 29%.)

## BAL-05 Time

Full-explore turns 1,760 (`OVR-04`). At 1.2 s per turn (experienced) = 35 min; text boxes and journal
reading ≈ 4 min; screens ≈ 2 min → **≈ 41 min**. A rushing expert at 60% of turns and 0.8 s per turn
≈ 14 min + reading. A first-time player at 2.5 s per turn who dies on floor 3 has played ≈ 28 min.

Check **BAL-C5:** experienced full-explore win within 30–45 min. (Passes.)

## BAL-06 Build viability

Each build is checked against the questions the game asks: the Gear-Golem (Plating 3, heavy hit), the
Cuckoo (ranged, wakes the floor — and since `ENM-13` takes the guards off their doors with it), the
Regulator (Plating 4, vents), the Understudy, the **Magpie** (`DIF-11`, takes a consumable and runs)
and the **wanderers** (`WLD-14`, arrive Active behind you for as long as you stay).

| Build (8 points) | Golem | Cuckoo | Regulator | Understudy | Magpie | Wanderers |
|---|---|---|---|---|---|---|
| **Frame** — Armature 4 + Tinkering 4 | Force +2 and Piston Drive: hits of 6+ Stun it (cap 1) between its wind-ups; Flywheel Guard eats the heavy. | Close with Braced Frame; its 1d4 is small; use doors. | Decoy soaks the vent phase; Field Repair once. | Overwind Strike bursts; Decoy buys 2 turns per 15 Tension; Salvage keeps the throwables coming. | Piston Drive's knockback catches it on the way in; Overwind Strike one-shots 9 Integrity. | Braced Frame's +6 and Field Repair carry the extra fight; Flywheel Guard for the pile-up. |
| **Bell** — Resonance 4 + Armature 1–4 | Discord (Exposed 2) turns Plating 3 into 0; Pulse pushes it out of reach. | Tuning + Harmonic Rifle out-ranges it (7 vs 6); Ring exposes. | Discord caps at 2 but re-castable; Pulse pushes Tick out of vent range indirectly by pushing *it*. | Sympathetic Break chains its two summoned Unfinished into 8 free damage; Rifle at range in Phase 3 (it is SLOW). | Resonant Pulse hits it before it closes and pushes it away from the pack. | Sympathetic Break turns a crowd into a chain; Pulse resets the ring when they arrive together. |
| **Apprentice** — Tinkering 4 + Resonance 4 | Decoy + Discord; Efficient Springs funds the Tension cost. | Clatter Can + Decoy redirect it. | Decoy + Field Repair + Flux. | Longest fight; relies on the Solder repair and the Decoy; its own spring (−2/action) ends it around action 36–50 if the fight drags. | The Decoy is what it steals *near*, not from; Discord's Slowed 4 keeps it in reach. | The Decoy is the answer: 6 turns of somebody else to walk at, and Efficient Springs pays for it. |

Check **BAL-C6:** each build has a non-empty answer in every cell. (Passes.)

## BAL-07 Simulation sanity checks (for the builder, using `TEC-13` hooks)

Run each of these for 200 seeds and compare to the target. The bands are `DIF-01`'s.

| Check | Bot | Target |
|---|---|---|
| **S1 Generation** | none | 100% of floors 1–7 validate within 50 retries; mean retries < 0.2. |
| **S2 Clock only** | Bot that walks the BFS-shortest path to the stairs each floor, never fights (enemies removed, and re-removed — `WLD-14` keeps sending more) | Arrives at floor 8 with 40–70 Tension. |
| **S3 Pure melee** | Bot that attacks the nearest enemy until dead, then travels to the stairs; uses Solder at < 60%; never uses skills, stations or locks | Dies on floor 2–4 in ≥ 80% of runs. |
| **S4 Greedy explorer** | Bot that visits every room, fights everything, winds at ≤ 45 Tension, takes Armature then Tinkering, breaks contact to solder, throws what Salvage leaves, steps away from telegraphs | Wins 30–60% of runs; median death floor of losses 5–7; wind-downs are 20–40% of deaths; no single enemy type over 40% of them. |
| **S5 Level curve** | Bot S4 | Median level at floor 8 arrival is 7–9. |
| **S6 Loot** | none, 1,000 floors | Every floor's item multiset is non-empty; a plating item appears in ≥ 99% of floor-1 caches; uniques ≤ 1 per run. |

Measured on the shipped `data/tuning.js` over the full **200 seeds** (M13): S1 pass (0.06 mean
retries) · S2 **64** Tension · S3 **98%** · S4 **38.5% wins**, wind-downs **25.2%** of deaths, worst
single cause **25.2%** · S5 median level **9** · S6 pass. The one target not reached is S4's median
death floor of losses, which is **3** rather than 5–7: see `BALANCE-CHANGELOG.md` B-014, and
`tools/sim.js` prints it as a `GAP` line beside the check rather than hiding it.

## BAL-08 Tuning knobs (in order of preference)

Superseded for M13 by the **DIF-15 ladder** (`50-difficulty-plan.md`), which names the knobs, their
order, their step size and the rule for keeping a change. Everything it turns lives in
`data/tuning.js`, and `node tools/sim.js --all --tuning '<json>'` measures a candidate without
touching a line of code. The three rules that outlast any ladder:

1. **One knob per iteration, measured before and after**, and a `B-nnn` row in
   `specs/BALANCE-CHANGELOG.md` for every one that is kept.
2. **Time decay period** (`decayPeriod`, 5 turns) is the last knob to touch — it is the game's
   identity.
3. Never change: Integrity/Tension display rules, hit clamp `[15, 95]`, the ≥ 6 Piston Drive
   threshold, the once-per-floor Field Repair. These are what the player has learned.
