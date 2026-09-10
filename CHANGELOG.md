# Changelog

All notable changes to Clockwork Hollow. This project is versioned by release, not by milestone; the
milestones below are the `40-implementation-plan.md` build order, kept because every one of them is a
reviewable commit with its own green Definition of Done.

## [1.0.0] — 2026-09-10

The complete game: eight floors, two endings, permadeath, playable in a browser with no build step
and no runtime dependencies.

### The game

- **Tick, wound down.** A turn-based roguelike over eight floors of a clockmaker's tower. Every turn
  spends Tension (`CHR-03`, `CHR-04`); Integrity never regenerates on its own; the Winding Station on
  each floor is the only free wind. Death is permanent.
- **Two endings.** The Understudy falls, the Master Key is on the table, and the choice is `A) Wind
  the tower` or `B) Wind yourself` — *The Keeper* or *The Walker* (`SCR-07`, `STY-07`).
- **A run** takes 30–45 minutes and is fully determined by its seed string (`TEC-07`).

### Systems

- **Turn loop and combat** (`10-turns-and-combat.md`): the ten-step turn, the three energy tiers,
  accuracy and evasion, Plating, Force, Precision, knockback, noise, six statuses, three hazards, and
  the Tension warnings.
- **Character and progression** (`11-character-and-skills.md`): Integrity 40 + 4 per level, nine
  levels, eight skill points, and all twelve skills across three disciplines — Armature, Tinkering,
  Resonance — including Clockwork Decoy, Field Repair and the recursive Sympathetic Break.
- **Items** (`12`, `21`): 35 items — 7 melee and 2 ranged weapons, 5 platings, 5 attachments,
  7 consumables and the 9 journal records — with five-deep stacks, weighted loot tables, unique
  tracking, the five weapon specials and the three attachment specials.
- **World generation** (`13`, `23`): rooms, corridors, doors, roles and features per `WLD-11`, with
  validation retries; the floor-1 spent station, the floor-4 vents, the floor-6 Blueprint, the
  floor-7 Pendulum band, and floor 8 loaded verbatim from the fixed map.
- **Enemies and AI** (`14`, `22`): fifteen enemies, six archetypes (Chaser, Skirmisher, Bruiser,
  Erratic, Swarmer, Guard), symmetric shadowcast perception, noise waking, nine-turn tracking, A*
  pathing with a fixed tie-break, and door behaviour per enemy.
- **Bosses**: The Conductor, The Regulator and The Understudy, each with its phases, its summon caps
  and its scripted lines.
- **Story** (`01`, `24`): the intro, the three scripted moments, the Understudy's four lines, the
  eight journal pages, the seven descent lines, and both ending texts — every string from the script.
- **Save and load** (`TEC-09`): one autosave in `localStorage`, written after every turn-costing
  action; restoring replays bit-for-bit, because the play RNG state is part of the save. Death,
  victory and abandoning a run delete it.

### Interface

- One 80 × 30 character grid on one canvas, scaled to the window with an integer cell and a 0.6 cell
  aspect (`UI-01`, `TEC-10`).
- Keyboard and mouse are each sufficient on their own: a run can be played from the title screen to
  either ending with the keyboard alone, or with the mouse alone (travel, click-to-attack, the
  inspect popup, and the panel tokens).
- Thirteen screens: title, run, inventory, skills, journal, help, message history, text box, ending
  choice, summary, pause, inspect and targeting.
- The inspect popup explains every number it shows, so no rule is hidden behind the UI.

### Engineering

- **No runtime dependencies, no build step.** `index.html` loads `src/main.js` as an ES module.
  `@playwright/test` is the only devDependency.
- **Headless core.** Everything under `src/` except `render.js`, `main.js`, `screens/*` and the
  storage adapter in `save.js` touches no DOM API, which is what lets the engine run under
  `node --test` and inside the balance simulation. A meta test enforces it.
- **Determinism.** `mulberry32` + FNV-1a, one stream per floor and one for play, with the draw order
  fixed by the spec. The same seed and the same actions give the same run.
- **Tests.** 261 Node tests (unit, integration, meta) and 37 Playwright specs. Every test title names
  the acceptance ID it verifies or is marked `@unit`, and carries exactly one milestone tag. No
  snapshots, no retries, no randomness, and no wall-clock time outside the four performance budgets.
- **Every acceptance ID in `32-acceptance-tests.md` is covered by a test.** The coverage allowlist is
  empty.
- **`TEC-14` performance budgets are tests** (`test/integration/perf.test.js`,
  `test/e2e/perf.spec.js`): a turn with 30 enemies, floor generation, a full redraw, and the idle
  check that no timer runs when nothing is animating.
- **CI**: two jobs on Node 20 — the test job (Node tiers plus Playwright) and the sim job (the full
  200-seed `BAL-07` sweep).

### Balance

- `BAL-C1`–`BAL-C6` and `ACC-131` pass as written; `ACC-130` passes for the S1, S2, S3, S5 and S6
  bots.
- **One accepted, documented miss.** The S4 explorer bot wins 88% of 200 seeds where `BAL-07` asks
  for 30–60%, with a median death floor of 4 where it asks for 6–8. All four `BAL-08` knobs were
  turned at their smallest named step and measured; none moved the number, and two broke a
  currently-green check. Per the balance protocol the single S4 assertion is skipped with a message
  naming the log entry, and no target band was widened. See `B-001`–`B-004` in
  `specs/BALANCE-CHANGELOG.md`.

### Decisions

108 ambiguities in the specifications were resolved while building and logged with their reasoning in
`specs/DECISIONS.md` (`D-001`–`D-108`). No gameplay number was changed outside the balance protocol,
and no specification ID was renumbered.

### Build milestones

| M | Delivered |
|---|---|
| 00 | Scaffold, tooling, the four meta tests, CI |
| 01 | `rng.js`, `grid.js`, `fov.js` |
| 02 | Every content table transcribed into `data/` |
| 03 | The floor generator |
| 04 | Engine core: turn loop, combat, statuses, hazards, events |
| 05 | Items, inventory, consumables, loot |
| 06 | Enemy AI: perception, waking, tracking, archetypes, doors |
| 07 | Skills, XP and progression |
| 08 | Bosses, scripted moments, endings, journal |
| 09 | Save and load |
| 10 | Rendering, input and screens — the game becomes playable |
| 11 | Bots and the balance simulation |
| 12 | Performance budgets as tests, empty allowlist, this changelog, release |
