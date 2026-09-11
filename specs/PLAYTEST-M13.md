# PLAYTEST-M13 — three runs through "The Tower Notices"

**Status:** `DIF-16`'s record. Not a gate: it produces a document, not a pass/fail. Anything that
felt unfair is a `D-entry` below, and a rule gap would have been fixed inside M13.

**How these were played.** Three seeded runs, driven through the engine's own action schema
(`PLN-03`) rather than through the browser, with `CH.newRun`'s policy played by hand as `DIF-16`
asks: explore each floor, fight what comes, wind at `CHR-03`'s warning, repair out of contact. The
instrumentation is the engine's, floor by floor — arrival turn, Tension and Integrity, the low point
of each, Solder found and used, Spring-Keys used, wanderers arrived, thefts and locks opened. The
browser is incidental to every one of those numbers; what is lost by not using it is the *feel* of
the panel, and the two notes at the bottom say where that mattered.

The three seeds are `TEST1234` (the seed `ACC-131` uses) and two fresh ones.

---

## Run 1 — `TEST1234`: **won** in 1,975 turns, 80 broken

| Floor | Arrive (turn / Tension / Integrity / level) | Low Tension | Low Integrity | Solder +/− | Keys | Wanderers | Thefts | Locks |
|---|---|---|---|---|---|---|---|---|
| 1 | t0 · 100 · 40/40 · 1 | 35 | 31 | +3 / −0 | 0 | 2 | 0 | 2 |
| 2 | t225 · 35 · 39/49 · 2 | 24 | 23 | +2 / −2 | 2 | 3 | 0 | 0 |
| 3 | t461 · 38 · 50/55 · 4 | 29 | 30 | +1 / −1 | 2 | 3 | 0 | 0 |
| 4 | t694 · 31 · 49/58 · 5 | 24 | 24 | +2 / −1 | 0 | 3 | 0 | 0 |
| 5 | t893 · 31 · 50/64 · 7 | 29 | 38 | +3 / −2 | 2 | 4 | 2 | 0 |
| 6 | t1171 · 35 · 66/67 · 8 | 29 | 21 | +0 / −4 | 3 | 4 | 0 | 0 |
| 7 | t1486 · 52 · 67/70 · 9 | 29 | 36 | +4 / −1 | 3 | 4 | 2 | 0 |
| 8 | t1916 · 67 · 70/70 · 9 | 42 | 55 | +0 / −0 | 0 | 0 | 0 | 0 |

The Understudy went down to a knockback-and-Stun loop after a Pulse took 7. **15 Solder found, 11
used across the run**, and 12 Spring-Keys: the spring is spent almost as fast as it is found, which
is the shape `BAL-01` now models.

## Run 2 — `PLAYTEST-A`: **won** in 2,257 turns, 93 broken

| Floor | Arrive | Low Tension | Low Integrity | Solder +/− | Keys | Wanderers | Thefts |
|---|---|---|---|---|---|---|---|
| 1 | t0 · 100 · 40/40 · 1 | 55 | **15** | +1 / −1 | 0 | 2 | 0 |
| 2 | t201 · 55 · 31/49 · 2 | 29 | 28 | +2 / −2 | 1 | 3 | 0 |
| 3 | t465 · 51 · 46/52 · 3 | 29 | 40 | +2 / −0 | 3 | 4 | 0 |
| 4 | t970 · 31 · 41/64 · 7 | 27 | 36 | +1 / −1 | 3 | 4 | 0 |
| 5 | t1284 · 67 · 44/70 · 9 | **20** | 22 | +0 / −3 | 0 | 4 | 1 |
| 6 | t1534 · 67 · 39/70 · 9 | **18** | 24 | +2 / −2 | 2 | 4 | 0 |
| 7 | t1928 · 44 · 35/70 · 9 | 21 | 32 | +1 / −1 | 2 | 4 | 0 |
| 8 | t2201 · 54 · 37/70 · 9 | 36 | 37 | +0 / −0 | 0 | 0 | 0 |

Three floors ended under 22 Tension. Floor 1 was the closest call of the three runs — 15 Integrity
of 40 — a Rust-moth pack in an open room with no plating yet.

## Run 3 — `PLAYTEST-B`: **won** in 2,211 turns, 79 broken

| Floor | Arrive | Low Tension | Low Integrity | Solder +/− | Keys | Wanderers | Thefts | Locks |
|---|---|---|---|---|---|---|---|---|
| 1 | t0 · 100 · 40/40 · 1 | 29 | 18 | +3 / −1 | 1 | 3 | 0 | 2 |
| 2 | t330 · 39 · 50/52 · 3 | **19** | 30 | +2 / −2 | 2 | 4 | 0 | 2 |
| 3 | t727 · 48 · 48/55 · 4 | 29 | **17** | +2 / −2 | 2 | 3 | 0 | 0 |
| 4 | t961 · 43 · 42/61 · 6 | 29 | 37 | +2 / −1 | 1 | 4 | 0 | 0 |
| 5 | t1162 · 38 · 50/64 · 7 | 29 | 40 | +1 / −1 | 3 | 4 | 2 | 0 |
| 6 | t1526 · 52 · 70/70 · 9 | 26 | 21 | +2 / −5 | 2 | 4 | 0 | 0 |
| 7 | t1858 · 29 · 57/70 · 9 | 24 | 41 | +1 / −1 | 1 | 4 | 1 | 0 |
| 8 | t2150 · 51 · 52/70 · 9 | 33 | 37 | +0 / −0 | 0 | 0 | 0 | 0 |

Floor 6 used five Solder — the Regulator is still the run's Integrity sink — and arrived on floor 7
with 29 Tension, the lowest arrival of any floor in the three runs.

---

## What the three runs say

**The clock is binding, and it is the thing you manage.** Every run spent at least one floor under
25 Tension, and two of the three crossed `CHR-03`'s second warning (15) on at least one floor. Before
M13 the same policy arrived on floor 8 with 47 Tension unspent (`B-004`'s note). Now it arrives with
51–67 and it got there by spending 12 Spring-Keys.

**The Solder repair changed what a fight is.** 11–13 Solder found per run, 8–11 used, and every one
of them cost three turns out of contact plus 5 Tension. The turn cost is the real price: backing out
of a room, mending, and coming back is what those turns buy, and on floors 5–7 the wanderers make
that window expensive.

**Wanderers are the pace-setter.** 24–25 arrived per run, 2–4 a floor, and they are why a cleared
floor no longer feels cleared. In all three runs the floor-1 and floor-2 wanderer clocks (slower, per
`WLD-14`) left room to learn the rule before it mattered.

**The Magpie lands.** Two to four thefts a run, always on floors 5 and 7, and in every case it took
something the run wanted back. Killing it returns the item, so it reads as a tax on attention rather
than a loss.

**Locks are a floor-1 and floor-2 decision.** Two runs paid for the cache on floors 1–2, when 10
Tension is a tenth of everything Tick has; by floor 5 the same 10 is noise. That is the right way
round — the decision is sharpest when the resource is scarcest.

## Anything unfair? (`OVR-02` pillar 3 — a death traceable to a decision)

Nothing in these three runs produced a death, so the strict test — *was there a death I could not
trace to a decision?* — has no instances to report. The three moments that came closest:

1. **Floor 1 at 15 Integrity** (run 2). A Rust-moth pack in an open room, before any plating. It is
   legible (the moths are visible, the room is open, and backing into a corridor is the answer), and
   it is the floor with the slowest wanderer clock, so there was time. Not unfair — but it is the
   single most likely first-run death, which matches `B-014`'s finding that M13's pressure lands
   hardest at level 1–5.
2. **A wanderer arriving behind Tick during a fight.** It is announced ("Somewhere on this floor,
   something winds itself up."), the panel counts down to it, and it never appears in sight — but the
   *direction* it comes from is not knowable. This is deliberate (`WLD-14` places it out of sight),
   and the countdown is what makes it a decision rather than a surprise. Left alone.
3. **A repair cracked by a 1-damage hit.** Losing 30+ Integrity of repair to a single point of damage
   reads as harsh the first time. It is stated in the item's own inspect line and in the log, and it
   is the rule that makes disengaging matter. Left alone.

No `D-entry` and no rule gap came out of these runs.

## The one thing the browser would have caught that this did not

Panel row 16 now carries two different readouts — the cyclic-hazard countdown and `next: n` for the
wanderer clock — and only one of them is ever shown on a given floor. These runs confirm the values
are right (`ACC-150` asserts them) but not that a player reads the switch without confusion. That is
a note for a human pass, not a rule change.
