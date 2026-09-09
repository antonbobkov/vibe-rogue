# 31 — Balance

**Status:** Wave 4 — model. The numbers here are *derived* from waves 2–3; if a later change to those
docs breaks a check below, the check wins and the numbers must be re-tuned per BAL-08.
**Purpose:** Show, with arithmetic a builder can repeat, that the content in `20`–`24` hits the pacing
and difficulty targets in `OVR-04`/`OVR-05`; and give the builder the sanity checks and tuning knobs
to use after playtesting.

---

## BAL-01 Tension budget (the clock)

Assumptions: a **full-explore** run uses the target turns from `OVR-04`; the Winding Station is
reached at 50% of a floor's turns; skills and ranged shots cost the amounts shown; no Spring-Keys used
(they are the margin). Decay is 1 per 5 turns (`CHR-04`).

| Floor | Turns | Arrive | Decay to station | At station | Rewind | Decay to stairs | Skill/shot use | Leave |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 100 | — (station spent) | — | — | −36 | −4 | **60** |
| 2 | 220 | 60 | −22 | 38 | 100 | −22 | −15 | **63** |
| 3 | 240 | 63 | −24 | 39 | 100 | −24 | −20 (boss) | **56** |
| 4 | 240 | 56 | −24 | 32 | 100 | −24 | −20 | **56** |
| 5 | 240 | 56 | −24 | 32 | 100 | −24 | −20 | **56** |
| 6 | 260 | 56 | −26 | 30 | 100 | −26 | −25 (boss) | **49** |
| 7 | 260 | 49 | −26 | 23 | 100 | −26 | −25 | **49** |
| 8 | 120 | 49 | — | — | — | −24 | −20 (boss) | **5** |

Findings:
- A full-explore, skill-heavy run **just** completes on time decay alone (5 Tension to spare on the
  final turn). This is the intended feeling: the clock is real but not a wall.
- The pre-station low points (30–39 on floors 2–6, **23 on floor 7**) cross the yellow/red warnings
  (`CHR-03`), which is the moment the game asks "station first, or loot first?".
- **Margin:** each floor's tables place ≈ 1 Spring-Key on the floor (weight ≈ 25% of ~4 items) plus
  cache and drop chances; expected ≈ 1.3 per floor ≈ +40 Tension per floor. A player who picks up what
  they find has roughly a full extra floor of slack across the run.
- A **rushing** player using 60% of the turns has ≈ +18 Tension per floor over the table and arrives on
  floor 8 with ≈ 85 before Spring-Keys.
- The **Governor** (decay 1/6) is worth ≈ +9 Tension per floor from floor 7 on.

Check **BAL-C1:** the "Leave" column must never go ≤ 0 with these assumptions. (Passes: minimum 5.)

## BAL-02 Integrity budget (the fights)

Model per enemy: Tick's expected damage per attack `E_T = hit% × E[max(0, dice + Force − enemyPlating)]`;
turns to kill `k = ceil(Int / E_T)`; the enemy makes `k − 1` attacks (NORMAL), `2(k − 1)` (FAST),
`(k − 1)/2` (SLOW); each deals `E_E = hit% × E[max(0, dice − TickPlating)]` (ignoring-Plating attacks use
the raw expectation). A "typical" progression is assumed:

| Floor | Tick weapon (avg) | Force | Acc | Plating | Evasion | Integrity max |
|---|---|---|---|---|---|---|
| 1 | Wrench 3.5 | 0 | 80 | 0 → 1 (Tin, mid-floor) | 10 | 40 |
| 2 | Mallet 4.5 / Cog Saw 3.5 | 0 | 80 | 2 (Brass) | 8 | 44 |
| 3 | 4.5 | 0 | 80 | 2 | 8 | 48 |
| 4 | Escapement Blade 5 | 2 | 85 | 3 (Iron) | 6 | 52 |
| 5 | 5 | 2 | 85 | 3 | 6 | 56 |
| 6 | 5 | 2 | 85 | 4 (Steel) | 4 | 60 |
| 7 | Piston Hammer 7.5 | 2 | 80 | 4 | 4 | 64 |
| 8 | 7.5 | 2 | 80 | 4 | 4 | 68 |

Expected Integrity lost per floor (all enemies fought, boss included, hazards avoided):

| Floor | Main contributors | Expected loss | Integrity available (max + Solder found ≈ 1/floor × 15) | Ratio |
|---|---|---|---|---|
| 1 | Sweepers ×4 ≈ 9; Rust-moths ≈ 6–13 (corridor vs open) | **≈ 18** | 40 + 15 | 33% |
| 2 | Tin Soldiers ×2 ≈ 12; hound ≈ 1; sweepers/moths ≈ 0 with Plating 2 | **≈ 13** | 44 + 15 | 22% |
| 3 | Guard soldier 6; Dancer 2.5; Cuckoo 2; **Conductor ≈ 15** + summoned Dancers ≈ 5–10 | **≈ 33** | 48 + 15 | 52% |
| 4 | Stokers ×2 ≈ 12 (Burning is most of it); Gear-Golem 0–6; guard 1 | **≈ 17** (+4–8 vents) | 52 + 15 | 25–37% |
| 5 | Cuckoos ×3 ≈ 11 (shriek ignores Plating); Finch packs ≈ 10; guard 1 | **≈ 22** | 56 + 15 | 31% |
| 6 | Archivists (Exposed) ≈ 8; Unfinished ≈ 2; Knight guard ≈ 6; **Regulator ≈ 12–25** | **≈ 30–40** | 60 + 15 | 40–53% |
| 7 | Knights ×2 ≈ 10; Stoker ≈ 5; Cuckoo ≈ 4; Finches ≈ 4; others ≈ 3; hazards ≈ 6 | **≈ 32** | 64 + 15 | 41% |
| 8 | Unfinished ×2–4 ≈ 6; **Understudy ≈ 30** (hammer) / ≈ 45 (blade) | **≈ 36–51** | 68 + 15 | 43–61% |

Findings:
- Floors 1–2 teach; floors 3 and 6 spike (bosses); floor 8 is the hardest but < 65% of available
  Integrity for the typical build with one Solder in hand. Stepping away from telegraphed hits (Golem,
  Regulator, Understudy Overwind/Pulse) removes 5–15 per boss from these figures — the intended skill
  expression.
- Plating 2 by floor 2 makes `1d3` enemies harmless; Plating 3–4 makes `1d4` enemies harmless. That is
  why Cuckoos ignore Plating, Finches hit `1d4+1`, Archivists apply Exposed, and Stokers Burn: the
  mid-game threats are designed *around* plating rather than through it.

Check **BAL-C2:** no floor's expected loss exceeds 65% of (Integrity max + 15). (Passes.)

## BAL-03 XP and levels

Nominal XP per floor (`FLR-10`): 15.5 · 27 · 33 (+16 summons) · 45 · 44 · 59 · 58.5 · 36 = **318–334**;
`CHR-06` requires ≥ 300. Cumulative XP at 75% kills: 11.6 · 31.9 · 56.6 · 90.4 · 123.4 · 167.7 · 211.6 ·
238.6 → levels **2, 3, 4, 5, 6, 7, 8, 9** at the end of floors 1–8, matching `OVR-04` exactly.
At 100% kills the player is one level ahead from floor 3 on (level 9 during floor 7). At 50% kills the
player is one level behind from floor 3 on (level 8 at the end, 7 skills).

Check **BAL-C3:** 75%-kill cumulative XP crosses the level-`n+1` threshold during or at the end of
floor `n` for every `n` in 1–8. (Passes.)

## BAL-04 Single-hit cap

`OVR-05` forbids any single hit > 40% of Tick's expected max Integrity on that floor.

| Floor | Largest possible single hit | Expected max Integrity | Ratio |
|---|---|---|---|
| 1 | Sweeper 3 | 40 | 8% |
| 2 | Tin Soldier 5 | 44 | 11% |
| 3 | Conductor 5; Dancer 4 | 48 | 10% |
| 4 | Gear-Golem heavy 12; Steam Vent 4 + Burning | 52 | 23% |
| 5 | Cuckoo 4 (unreducible) | 56 | 7% |
| 6 | Regulator heavy 15; Vent 4 | 60 | 25% |
| 7 | Knight 8; Pendulum Sweep 6 | 64 | 13% |
| 8 | Understudy Overwind 16; Pulse 7 | 68 | 24% |

Check **BAL-C4:** all ratios ≤ 40%. (Passes; the worst is 25%.)

## BAL-05 Time

Full-explore turns 1,760 (`OVR-04`). At 1.2 s per turn (experienced) = 35 min; text boxes and journal
reading ≈ 4 min; screens ≈ 2 min → **≈ 41 min**. A rushing expert at 60% of turns and 0.8 s per turn
≈ 14 min + reading. A first-time player at 2.5 s per turn who dies on floor 4 has played ≈ 37 min.

Check **BAL-C5:** experienced full-explore win within 30–45 min. (Passes.)

## BAL-06 Build viability

Each build is checked against the four "questions" the game asks: the Gear-Golem (Plating 3, heavy
hit), the Cuckoo (ranged, wakes the floor), the Regulator (Plating 4, vents), the Understudy.

| Build (8 points) | Golem | Cuckoo | Regulator | Understudy |
|---|---|---|---|---|
| **Frame** — Armature 4 + Tinkering 4 | Force +2 and Piston Drive: hits of 6+ Stun it (cap 1) between its wind-ups; Flywheel Guard eats the heavy. | Close with Braced Frame; its 1d4 is small; use doors. | Decoy soaks the vent phase; Field Repair once. | Overwind Strike bursts; Decoy buys 2 turns per 15 Tension; Salvage keeps Solder flowing. |
| **Bell** — Resonance 4 + Armature 1–4 | Discord (Exposed 2) turns Plating 3 into 0; Pulse pushes it out of reach. | Tuning + Harmonic Rifle out-ranges it (7 vs 6); Ring exposes. | Discord caps at 2 but re-castable; Pulse pushes Tick out of vent range indirectly by pushing *it*. | Sympathetic Break chains its two summoned Unfinished into 8 free damage; Rifle at range in Phase 3 (it is SLOW). |
| **Apprentice** — Tinkering 4 + Resonance 4 | Decoy + Discord; Efficient Springs funds the Tension cost. | Clatter Can + Decoy redirect it. | Decoy + Field Repair + Flux. | Longest fight; relies on Solder ×2 and the Decoy; its own spring (−2/action) ends it around action 36–50 if the fight drags — the "outlast" strategy is real for this build. |

Check **BAL-C6:** each build has a non-empty answer in every cell. (Passes.)

## BAL-07 Simulation sanity checks (for the builder, using `TEC-13` hooks)

Run each of these for 200 seeds and compare to the target:

| Check | Bot | Target |
|---|---|---|
| **S1 Generation** | none | 100% of floors 1–7 validate within 50 retries; mean retries < 0.2. |
| **S2 Clock only** | Bot that walks the BFS-shortest path to the stairs each floor, never fights (enemies removed) | Arrives at floor 8 with 60–80 Tension. |
| **S3 Pure melee** | Bot that attacks the nearest enemy until dead, then travels to the stairs; uses Solder at < 50%; never uses skills or stations | Dies on floor 3–5 in ≥ 80% of runs (the boss or floor 4 should stop a skill-less bruteforce). |
| **S4 Greedy explorer** | Bot that visits every room, fights everything, uses the station on sight, takes Armature then Tinkering, uses Solder < 50% and Spring-Key < 30, steps away from telegraphs | Wins 30–60% of runs; median death floor of losses is 6–8. |
| **S5 Level curve** | Bot S4 | Median level at floor 8 arrival is 8 or 9. |
| **S6 Loot** | none, 1,000 floors | Every floor's item multiset is non-empty; a plating item appears in ≥ 99% of floor-1 caches; uniques ≤ 1 per run. |

## BAL-08 Tuning knobs (in order of preference)

If playtesting deviates from the targets, change these first — they are the levers with the fewest
side effects:

1. **Solder amount** (15) and **Spring-Key amount** (30): ±5 shifts all floors' margins uniformly.
2. **Boss Integrity** (Conductor 32, Regulator 48, Understudy 72): ±8 changes a boss fight by ≈ 2 turns.
3. **Time decay period** (5 turns): changing to 6 is worth ≈ +8 Tension per floor; to 4, ≈ −10. Touch
   this last — it is the game's identity.
4. **Rust-moth pack size** and **Cuckoo count on floor 5**: the two swingiest early/mid encounters.
5. Never change: Integrity/Tension display rules, hit clamp `[15, 95]`, the ≥ 6 Piston Drive threshold,
   the once-per-floor Field Repair. These are what the player has learned.
