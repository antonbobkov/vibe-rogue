# BALANCE-CHANGELOG

Balance protocol log (`40-implementation-plan.md` § PLN-07.2). One row per knob turned when a
`BAL-C*`, `ACC-130` or `ACC-131` target fails. Rows are append-only; at most three iterations per
target; targets are never widened.

| ID | Target | Measured | Knob | Change | Result |
|---|---|---|---|---|---|
| B-001 | ACC-130 S4: wins 30-60% of runs | 88.0% wins over 200 seeds (176/200); median death floor of losses 4 | BAL-08 knob 1 — Solder amount and Spring-Key amount, one step of -5 | Solder 15 -> 10, Spring-Key 30 -> 25 | **Reverted.** Measured 78.8% wins over 80 seeds: still far above the band. Also fails BAL-C2, whose floor-8 ratio becomes 51/(68+10) = 65.4% > 65%, and PLN-07.2 step 4 requires every other test green. |
| B-002 | ACC-130 S4: wins 30-60% of runs | 88.0% wins over 200 seeds | BAL-08 knob 2 — boss Integrity, one step of +8 | Conductor 32 -> 40, Regulator 48 -> 56, Understudy 72 -> 80 | **Reverted.** Measured 90.0% wins over 80 seeds: no effect beyond noise (the extra ~2 turns per boss fight are absorbed by the Solder economy), and the longer fights raise BAL-02's expected losses, which fails BAL-C2 on floor 8. |
| B-003 | ACC-130 S4: wins 30-60% of runs | 88.0% wins over 200 seeds | BAL-08 knob 3 — time decay period, one step to 4 | decayPeriod 5 -> 4 | **Reverted.** Measured 87.5% wins over 80 seeds: no effect beyond noise. Also fails BAL-C1: BAL-01's floor-8 "Leave" becomes -7, i.e. the modelled full-explore run winds down before the Understudy. BAL-08 itself says of this knob "touch this last - it is the game's identity". |
| B-004 | ACC-130 S4: wins 30-60% of runs; median death floor of losses 6-8 | 88.0% wins, median death floor of losses 4, over 200 seeds | BAL-08 knob 4 — Rust-moth pack size and Cuckoo count on floor 5, one step of +1 | Rust-moth packSize 3-5 -> 4-6, floor 5 Cuckoo count 3 -> 4 | **Reverted.** Measured 91.3% wins over 80 seeds: the extra enemies are net *negative* pressure, because the extra XP levels the bot faster. Knobs 1-4 are now exhausted; the S4 test is skipped per PLN-07.2 step 4 with `BALANCE: ACC-130 S4 win rate and median death floor unmet after 3 iterations; see B-004`. The band is not widened. |

### Note on B-001 to B-004 (M11)

All four BAL-08 knobs were turned at their smallest named step and measured against the S4 target.
None moves the win rate materially, and the two that move it at all (knobs 1 and 3) break a
currently-green check (BAL-C2 and BAL-C1), which PLN-07.2 step 4 forbids. The gap is structural
rather than a matter of margins: the S4 policy as BAL-07 describes it — visits every room, fights
everything, keeps the loot, dodges the heavy telegraphs, spends all 8 skill points on Armature then
Tinkering — plays at the level OVR-05 calls an expert, and OVR-05's own expert target is ~80%. The
measured 88% agrees with OVR-05 and disagrees with BAL-07's 30-60%, which describes OVR-05's
"fifth or later run" player (~50%). Every other BAL-07 target passes on the same bots and the same
seeds, and no target band was widened.
