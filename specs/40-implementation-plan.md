# 40 — Implementation Plan

**Status:** Final. This document is addressed to the agents that will build the game.
**Purpose:** Turn `00`–`32` into a working game through thirteen milestones, each with a
machine-checkable Definition of Done, so that the build can run end-to-end with no human decisions.

---

## PLN-01 How to use this plan

1. Read `00-overview.md`, `01-story.md`, `30-technical.md`, `32-acceptance-tests.md` in full before
   starting any milestone. Then read the docs each milestone cites.
2. Work milestones in order (PLN-05 lists the two places parallelism is allowed). Do not start a
   milestone until the previous one's DoD command is green in CI.
3. Every milestone ends with the DoD command green, the ACC allowlist (PLN-04) reduced as stated, and
   a merged branch. Nothing else counts as done.
4. When the spec is silent, ambiguous, or self-contradictory, follow PLN-07. Never stop to ask.

## PLN-02 Rules of engagement (binding)

| # | Rule |
|---|---|
| R1 | **The spec is law.** Code implements `10`–`24` and `30` as written. Gameplay numbers change only through the balance protocol (PLN-07.2). |
| R2 | **Headless core.** Every module under `src/` except `render.js`, `main.js`, `screens/*`, and the storage adapter in `save.js` must not reference `window`, `document`, `localStorage`, `requestAnimationFrame`, `performance`, or any DOM API. Enforced by `test/meta/dom-free.test.js`. |
| R3 | **Data is data.** Modules under `data/` export frozen plain objects and contain no functions. Enforced by `test/meta/data-pure.test.js`. |
| R4 | **No runtime dependencies. No build step.** `@playwright/test` is the only devDependency. ESM everywhere. `index.html` loads `src/main.js` directly. |
| R5 | **Tests name their spec.** Every test title contains the ACC ID(s) it verifies (e.g. `ACC-15`), or `@unit` for module-level tests, and exactly one milestone tag `@m00`…`@m12`. |
| R6 | **Determinism.** No test uses `Math.random` or wall-clock time. Every test that needs randomness uses a fixed seed or `queueRng`. No test retries. |
| R7 | **One milestone per branch** named `mNN-<slug>`; commits `mNN: <summary>`; merge only on green CI. If PRs are unavailable, commit to `main` only after `npm run dod -- NN` passes locally. |
| R8 | **Decisions are logged**, never hidden: `specs/DECISIONS.md` (PLN-07.1) and `specs/BALANCE-CHANGELOG.md` (PLN-07.2). |
| R9 | **Performance budgets (TEC-14) are tests**, written in M12 and required green. |
| R10 | **Spec IDs are never renumbered.** Typos in spec prose may be fixed in the same PR that finds them; rules, numbers, and IDs may not. |

## PLN-03 Architecture

The layout is `TEC-02`. Two things are added on top of it so the game can be tested without a browser.

### The engine facade (`src/engine.js`)

```js
createGame({ seedString, rng })  // rng optional: an object {next()} to inject (tests only)
game.act(action) → { ok: boolean, reason?: string, log: LogLine[], events: Event[] }
game.state                       // the TEC-05 state object (read-only by convention)
game.phase                       // 'run' | 'awaitDismiss' | 'awaitChoice' | 'ended'
game.view()                      // { visible: Set<idx>, remembered: Set<idx> } after last act
```

**Action schema** (fixed in M4, extended in M7/M8; `CMB-05` is the semantics):

```
{type:'move', dx, dy}            {type:'wait'}             {type:'pickup'}
{type:'interact'}                {type:'ascend'}           {type:'closeDoor', dx, dy}
{type:'use', slot}               {type:'throw', slot, x, y}
{type:'fire', x, y}              {type:'equip', slot}      {type:'unequip', which}   // 'weapon'|'plating'|'attachment'
{type:'drop', slot}              {type:'skill', slot, x?, y?, dx?, dy?}              // M7
{type:'takeSkill', name}         {type:'dismiss'}          {type:'choose', option}   // 'A'|'B' — M8
```

`ok:false` with a `reason` string means "no turn was spent" (`CMB-05`). Free actions (screens,
inspect) are not engine actions at all; the UI reads `game.state` directly.

**Event vocabulary** (the engine never draws; it emits events the UI consumes in order):

```
{type:'textbox', id, text}       ids: intro, moment1, moment2, moment3a, moment3b, understudy1, endingChoice, endingA, endingB
{type:'journal', page}           show page n as a Journal view, then continue
{type:'descent', lines}          Ending B's seven lines (SCR-07)
{type:'levelUp', level}          UI opens the Skills screen (CHR-07); non-blocking
{type:'floor', number, name}     new floor entered
{type:'flash', kind, x, y}       kind 'tick' | 'enemy' (UI-09 rule 6)
{type:'choice'}                  ending choice; engine phase becomes 'awaitChoice'
{type:'death', cause, header, flavor, summary}
{type:'victory', ending, header, flavor, summary}
```

While `phase` is `awaitDismiss`, only `dismiss` is accepted; while `awaitChoice`, only `choose`;
while `ended`, nothing. Text boxes therefore never race the turn loop (`UI-16`).

### Injectable randomness (`src/rng.js`)

`mulberry32(seed)`, `fnv1a(str)`, `queueRng(values)` (returns `values` in order as the results of
`next()`, then throws — a test that under-supplies values fails loudly), and the draw helpers of
`TEC-07`. `createGame` uses `mulberry32` unless `rng` is injected; the generator always uses its own
`floorRng` (never injected) so maps stay reproducible in tests that inject play randomness.

### Debug hooks (`TEC-13`)

`window.CH = { state, game, act, newRun, loadFloor, grid(), events(), queueRng }`. `grid()` returns
the last rendered 80×30 buffer as `[{glyph, fg, bg}]` rows so browser tests assert what is on screen
without pixel reading. `events()` returns and clears the UI's pending event list.

### Data flow

keyboard/mouse → `main.js` maps to an action (`UI-10`, `UI-13`) → `engine.act` → `{log, events}` →
screens push overlays for events → `render.js` draws `state` + overlays into the cell buffer → canvas.
Travel and Shift-run are `main.js` timers that call `act` repeatedly (`UI-13`, `TEC-11`).

## PLN-04 Test strategy

| Tier | Runner | Location | Runs against |
|---|---|---|---|
| Unit | `node --test` (Node ≥ 20, built-in) | `test/unit/*.test.js` | a single module |
| Integration | `node --test` | `test/integration/*.test.js` | the engine, headless, usually on a fixture map |
| Meta | `node --test` | `test/meta/*.test.js` | the repo itself (rules R2, R3, R5, ACC coverage) |
| Browser | `@playwright/test`, Chromium only | `test/e2e/*.spec.js` | `tools/serve.js` on port 8080 |

- **Fixture maps:** `test/fixtures/maps.js` exports `floorFromAscii(rows, {enemies, items})` using
  the `WLD-13` legend plus `T` for Tick, letters for enemy types by glyph, and `!` `)` etc. for items
  named in an options table. Combat, AI, item, and skill tests use fixtures, not the generator, so
  they are exact.
- **Scripted RNG:** integration tests pass `rng: queueRng([...])` and state every draw they expect,
  in the order `TEC-07` fixes (hit roll before damage roll, id order, reading order).
- **ACC coverage meta-test** (`test/meta/acc-coverage.test.js`): parses every `ACC-nnn` ID from
  `specs/32-acceptance-tests.md`, collects every test title from `test/**`, and asserts each ID is
  either present in a title or listed in `test/meta/acc-allowlist.json`. It also fails if the
  allowlist contains an ID that *is* covered (stale entries). M0 creates the allowlist with all IDs;
  each milestone removes the IDs it covers; M12 requires it empty.
- **DoD runner** (`tools/dod.js`): `npm run dod -- NN` runs `node --test` with
  `--test-name-pattern` matching tags `@m00`…`@mNN`, then the meta tests, then (for NN ≥ 10)
  `playwright test --grep "@m(0\d|1[0-NN])"`. Exit code is the DoD.
- **CI** (`.github/workflows/ci.yml`): on push and PR; Node 20; `npm ci`;
  `npx playwright install --with-deps chromium`; `npm test`; `npm run e2e`. One job, no matrix, no
  retries, 15-minute timeout.
- **Snapshots:** none. Expected values are written in the test from the spec.

## PLN-05 Milestone overview

| M | Name | Produces | Covers | Size |
|---|---|---|---|---|
| 00 | Scaffold & CI | tooling, meta tests, empty page | — | S |
| 01 | Foundations | `rng.js`, `grid.js`, `fov.js` | ACC-78, 91 | M |
| 02 | Data | `data/*.js` | ACC-132; static half of ACC-77 | M |
| 03 | Generator | `gen.js` | ACC-70–74, 76 (static), 77, 80 (generation), 81 | L |
| 04 | Engine core | `actors.js`, `turn.js`, `combat.js`, `engine.js`, fixtures | ACC-10–13, 15–27, 75, 76 (dynamic), 79, 80, 117 (headless) | XL |
| 05 | Items | `items.js` | ACC-50–59, 61, 63, 65 | M |
| 06 | AI | `ai.js` (archetypes) | ACC-14, 82–92 | L |
| 07 | Skills & progression | `skills.js` | ACC-30–45, 60, 62, 64 | L |
| 08 | Bosses, script, endings | boss scripts, triggers, ending machine, journal | ACC-93–97; headless 96, 114, 115, 116 | L |
| 09 | Save/load | `save.js` | ACC-01–06 (headless) | M |
| 10 | Rendering, input, screens | `render.js`, `main.js`, `screens/*` | ACC-100–122; browser ACC-01–06 | XL |
| 11 | Bots & balance sim | `tools/sim.js` | ACC-130, 131 | L |
| 12 | Release | perf tests, empty allowlist, README, tag | ACC-133; TEC-14 | S |

**Order:** strictly sequential, with two exceptions: M02 may run in parallel with M01 (no shared
files); M05 and M06 may run in parallel after M04 (they touch different files; M07 integrates both).

## PLN-06 Milestones in detail

Each milestone lists: **Goal · Inputs · Files · Tasks · Tests · DoD**. "Remove from allowlist" means
edit `test/meta/acc-allowlist.json`.

---

### M00 — Scaffold & CI

**Goal.** A repository where `npm test` and `npm run e2e` run and pass, with the rules of PLN-02
enforced mechanically from the first commit.

**Inputs.** `30-technical.md` (TEC-01, 02, 13), this document.

**Files.**
```
package.json            "private": true, "type": "module", devDependencies: @playwright/test (pinned)
                        scripts: test, e2e, start, dod
index.html              <canvas id="game">, hidden <input id="seed">, <script type="module" src="src/main.js">
src/main.js             stub: draws "CLOCKWORK HOLLOW" text on the canvas; installs window.CH = {}
tools/serve.js          static server on 8080 using node:http; MIME for .html/.js/.json; no deps
tools/dod.js            PLN-04 DoD runner
playwright.config.js    webServer: node tools/serve.js; baseURL http://localhost:8080; chromium; retries 0
.github/workflows/ci.yml
test/meta/dom-free.test.js     R2: scan src/** minus the allowed files for forbidden identifiers
test/meta/data-pure.test.js    R3: scan data/** for `function`, `=>`, `class`
test/meta/titles.test.js       R5: every test title has an @mNN tag and (ACC-\d+|@unit)
test/meta/acc-coverage.test.js PLN-04
test/meta/acc-allowlist.json   all ACC IDs from specs/32
test/e2e/smoke.spec.js         page loads, no console errors, window.CH exists           (@m00 @unit)
.gitignore              node_modules, playwright-report, test-results
```

**Tasks.**
1. Write `package.json` with exactly the scripts above; `start` = `node tools/serve.js`.
2. Write `tools/serve.js` (≤ 40 lines), `tools/dod.js` (PLN-04 semantics; tags are two-digit).
3. Write the four meta tests. `acc-coverage` must parse IDs with `/\bACC-\d{2,3}\b/g` from the spec
   file and titles by scanning `test/**/*.{test,spec}.js` for `test(`/`it(` first string arguments.
4. Write the CI workflow (PLN-04).
5. Generate `acc-allowlist.json` from the spec (all IDs).

**Tests.** The meta tests themselves; the smoke e2e test.

**DoD.** `npm run dod -- 00` green in CI. `npm start` serves `index.html`.

---

### M01 — Foundations

**Goal.** Deterministic randomness, grid math, and field of view, each proven by property tests.

**Inputs.** `TEC-07`, `TEC-08`, `WLD-05`, `ENM-08`, `CMB-08`.

**Files.** `src/rng.js`, `src/grid.js`, `src/fov.js`; tests `test/unit/rng.test.js`,
`grid.test.js`, `fov.test.js`.

**Tasks.**
1. `rng.js`: `mulberry32(seed)` exactly as `TEC-07` (state = one uint32; expose `getState/setState`),
   `fnv1a(str)` over UTF-8 bytes, `queueRng(values)`, `int(rng, lo, hi)`, `chance(rng, p)`,
   `parseDice('2d4+1' | '1 (flat)' | '1')`, `roll(rng, dice)`, `weighted(rng, table)` per `ITM-10`.
2. `grid.js`: constants `W=60, H=24`; `idx(x,y)`, `chebyshev`, `readingOrder` comparator, `neighbors8`,
   `bresenham(x0,y0,x1,y1)` per `TEC-08` (start excluded), `bfs(passableFn, starts)` returning a
   distance map, `astar(passableFn, from, to, {maxLen: 60})` per `ENM-08` with the exact tie-break
   and the door-diagonal rule taken as a passability callback `(from, to) → boolean`.
3. `fov.js`: `computeFov(blocksSightFn, ox, oy, radius) → Set<idx>` — a faithful port of Albert Ford's
   symmetric shadowcasting (row/column scan with `Fraction`-free rational slopes as two integers),
   then Chebyshev-radius filter; origin always included.

**Tests.**
- `@m01 @unit rng`: same seed → same 1,000 values; `getState/setState` round-trip; `int` bounds over
  10,000 draws for several ranges; `chance(100)` always true, `chance(0)` always false; `parseDice`
  table of 8 cases incl. flat; `roll` with `queueRng` gives the sum; `weighted` walks in table order
  (queueRng `[total]` → last entry, `[1]` → first); `queueRng` throws when exhausted; distribution
  sanity: 100,000 `int(1,6)` draws each face within 15–18.5%.
- `@m01 @unit grid`: `bresenham` on 12 hand-computed lines including the diagonal tie case and both
  octant families, start excluded, end included; `bfs` distances on a small ASCII map; `astar` finds
  the unique shortest path on 5 maps, returns `null` beyond `maxLen`, and **ACC-91**: two calls with
  identical inputs return identical arrays, and the documented tie-break picks the lower reading-order
  tile on a symmetric fork.
- `@m01 @unit fov` **ACC-78**: on 200 random maps (seeded), for all pairs within radius, `A sees B ⇔
  B sees A` (symmetry); nothing beyond Chebyshev 8; origin visible; a sealed 5×5 room sees exactly
  its interior plus its wall ring; a wall adjacent to the origin is visible; a tile behind a wall on
  a straight line is not.

**DoD.** `npm run dod -- 01`.

---

### M02 — Data

**Goal.** Every table in `20`–`24` transcribed into `data/`, validated against `TEC-03` and against
the totals the specs claim.

**Inputs.** `TEC-03`, `TEC-04`, `20-skills.md`, `21-items-catalog.md`, `22-bestiary.md`,
`23-floors.md`, `24-script.md`, `UI-07`, `UI-08`, `BST-01`.

**Files.** `data/palette.js`, `data/items.js`, `data/enemies.js`, `data/skills.js`,
`data/floors.js`, `data/script.js`; `test/unit/data.test.js`.

**Tasks.**
1. Transcribe verbatim. Names, glyphs, colors, dice strings, descriptions, floors, tables.
   Effect/special ids per `TEC-04`. Dice stay as strings in data (`parseDice` at load in M04).
2. `data/floors.js`: `FLOORS[1..8]` per `TEC-03 FloorDef`; floor 8 gets `fixedMap` as 24 strings copied
   from `FLR-09`.
3. `data/script.js`: every string in `24` under stable keys: `title`, `tagline[]`, `intro`,
   `pages[1..8]`, `moments{1,2,'3a','3b'}`, `understudy[1..4]`, `endingChoice`, `endingA`,
   `endingB`, `descent[]`, `screens{broken,woundDown,keeper,walker}`, `help[]`, `log{...}` with the
   `SCR-10` templates using `{A} {D} {n} {X}` placeholders.
4. `data/palette.js`: `UI-08` plus `BST-01`; `resolve(colorOrName)`.

**Tests** (`@m02`, all `@unit` unless an ACC is named):
- Every item has the fields its category requires and no unknown fields; every enemy has all
  `ENM-01` fields; every skill matches `CHR-09`'s shape (2 actives + 2 passives per discipline,
  ranks 1–4 unique); every floor has the `FloorDef` fields.
- Names unique across items; unique across enemies; enemy glyphs unique; bosses uppercase, others
  lowercase; every color resolves in the palette (**ACC-132** color clause).
- **ACC-132**: every item name in every floor table / cache table / drop table / `cacheExtra` exists
  in `data/items.js`; every enemy in every spawn list and `guard` exists in `data/enemies.js`; every
  skill name in `11` (hard-coded list in the test) exists in `data/skills.js`.
- Counts equal `CAT-08` (7+2 weapons, 5, 5, 7, 9 records). XP by floor equals `FLR-10` nominal
  values (compute pack means as `(min+max)/2`). Understudy `xp` is 0.
- Floor 8 `fixedMap` is 24 rows × 60 cols; only legend characters; exactly one `@`, one `U`, one
  `C`; markers `1` and `2` present once; outer ring all `#` (**ACC-77** static clause).
- Script: `descent` has 7 lines; page 8 has no `— A.V.`; every other page ends with `— A.V.`; each
  page word count 110–170; intro ≤ 180 words; `understudy[4] === 'Turn it, then. Someone has to.'`.

**DoD.** `npm run dod -- 02`.

---

### M03 — Generator

**Goal.** `WLD-11` implemented exactly, validated over a thousand seeds, and floor 8 loaded from data.

**Inputs.** `13-world-and-generation.md`, `23-floors.md`, `TEC-07`, `TEC-08`.

**Files.** `src/gen.js`, `src/tiles.js` (tile enum, passability/sight predicates, hazard configs
from `WLD-08`); `test/unit/gen.test.js`.

**Tasks.**
1. `tiles.js`: `TILE` enum for `WLD-02`; `walkable(t)`, `blocksSight(t)`; `HAZARDS` config table.
2. `gen.js`: `generateFloor(seedString, n) → Floor` following `WLD-11` step by step with a
   `floorRng` from `TEC-07`; regenerate on validation failure with `floorSeed + 1` up to 50
   (`WLD-10`); `loadFixedFloor(n)` for floor 8 (`WLD-13`); the floor-7 band and floor-4 vent rules
   from `FLR-05`, `FLR-08`; the floor-1 station override (`WLD-07`); the floor-6 Blueprint
   (`FLR-07`). Output includes `rooms`, `roles`, `features`, `items[]` (names + positions), `spawns[]`
   (type, position, `homeRoom`, `isGuard`), `hazards[]`, `start`.
   Enemy *instances* are created in M04; M03 emits spawn records only.
3. Record a `retries` counter on the floor for the S1 sim.

**Tests** (`@m03`):
- Determinism: same `(seed, n)` → deep-equal floors; different seeds differ.
- **ACC-70, 71, 72, 73** over 1,000 seeds × floors 1–7 (all invariants listed there; the FOV check
  for ACC-72 uses `fov.js`). **ACC-74** (floor 2 gears), **ACC-76** static clauses (band tiles, no
  feature in band), **ACC-77** (floor 8 loads with the named positions), **ACC-81** (floor 1 start
  is a spent station tile), **ACC-80** generation clause (`fnv1a(seed:floor:n)` is what seeds it —
  assert by recomputing).
- Floor 4: exactly 10 vents or fewer only when placement fails; ≤ 4 per room; none adjacent.
- Floor 6 cache contains the Blueprint plus 2–3 rolled items; floor 1 first cache item is a plating.
- Performance: mean generation time over 200 floors < 50 ms (`TEC-14`), asserted with
  `process.hrtime` (allowed here: `tools/` and tests may use timers; `src/` may not).

**DoD.** `npm run dod -- 03`; remove ACC-70–74, 76, 77, 80, 81 from the allowlist.

---

### M04 — Engine core

**Goal.** A playable-in-principle game with movement, melee, ranged, throwing, statuses, hazards,
Tension, death, and floor transitions — headless, event-driven, exact.

**Inputs.** `10-turns-and-combat.md`, `11-character-and-skills.md` (CHR-01–05, 11), `13` (WLD-05–08),
`CMB-*`, `TEC-05`, `TEC-07`, `UI-04` (log colors), `SCR-10`.

**Files.** `src/engine.js`, `src/actors.js`, `src/turn.js`, `src/combat.js`, `src/log.js`,
`test/fixtures/maps.js`, `test/integration/turnloop.test.js`, `combat.test.js`, `hazards.test.js`,
`engine.test.js`.

**Tasks.**
1. `actors.js`: `createTick()` per `CHR-01`; `createEnemy(type, x, y, id, opts)` from `data/enemies`
   with instance fields of `ENM-01`; `derive(tick)` computing accuracy/evasion/Plating/Force/
   Precision from equipment + skills (`CMB-01`, `CHR-08`) — equipment and skills hooks exist now,
   return zeros until M05/M07.
2. `turn.js`: `runTurn(state, action)` implementing `CMB-02` steps 1–10 literally, with step 6 the
   enemy phase of `CMB-03` (AI action is a pluggable function; M04 ships a stub that **Waits** so
   enemies exist and block but do nothing until M06). Statuses `CMB-10`; hazards `WLD-08`
   (enter/standing, cycles, warning turn); Tension decay; death checks; level-up check calls a hook
   (M07). Slowed-Tick double phase (`CMB-04`). Wake-energy rule (`ENM-03`) lives here as
   `wokeThisTurn` handling.
3. `combat.js`: `meleeAttack`, `rangedAttack`, `throwAt`, `knockback`, `noise`, `damage(target, n,
   {ignoresPlating})` per `CMB-06–09, 11`. On-hit hooks for enemy `onHit` ids `BURN_2`, `EXPOSE_2`.
   Weapon specials are M05.
4. `engine.js`: the facade of PLN-03; the action schema (except `skill`, `takeSkill`, `choose`);
   `phase` handling; event queue; FOV + memory update; `floor` transition (`ascend` → `gen.js`,
   statuses cleared, `floor` event, `SCR-10` stairs line); intro textbox event on new game; the
   noise → wake plumbing (`ENM-04` for Dormant enemies — wake rules are simple enough to live in
   `turn.js` now; tracking/archetypes come in M06).
5. `log.js`: templates from `data/script.log`, colors per `UI-04`, merge of identical consecutive
   lines, history cap 500.
6. `test/fixtures/maps.js` (PLN-04).

**Tests** (`@m04`, integration on fixtures with `queueRng`):
- **ACC-10, 11** (decay and clock-death ordering), **ACC-12, 13** (energy tiers; use enemies with
  the M04 stub replaced by a test AI that always attacks — the fixture accepts an `ai` override),
  **ACC-15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27**, **ACC-75, 76** dynamic clauses (vent
  cycle, band cycle, warning turn flag exposed in state), **ACC-79** (memory keeps terrain and
  last-seen item; `view().remembered` never includes enemies), **ACC-80** (ascend clears statuses, log line),
  **ACC-117** headless (death event `cause`, `header`, `flavor` per `SCR-08`).
- `@unit` for `log.js` merging and cap; for `derive` with no equipment (`CHR-01` numbers).
- Engine phase gating: a `move` while `awaitDismiss` returns `ok:false, reason:'awaitDismiss'`.

**DoD.** `npm run dod -- 04`; remove the listed ACC IDs.

---

### M05 — Items and inventory

**Goal.** Every item behaves per `12` and `21`; loot tables and drops work; specials fire.

**Inputs.** `12-items-and-inventory.md`, `21-items-catalog.md`, `TEC-04`.

**Files.** `src/items.js`; `test/integration/items.test.js`.

**Tasks.**
1. Inventory model (`ITM-03`): slots, stacking to 5, compaction, letters. Pickup/drop rules
   (`ITM-04, 06, 07`), equip/unequip swap (`ITM-02`), records to journal (`ITM-03`, `CAT-07`;
   journal-page pickup triggers the `SCR-04` line and marks `journal.pages[n]`).
2. Consumable effects (`CAT-06`, `TEC-04`), including throwables through `combat.throwAt`.
3. Weapon specials `REND, SWEEP, KNOCK, TEMPO, RING`; attachment specials `COOLING, QUIET,
   REGULATED` (the decay period becomes a derived value `tick.decayPeriod`).
4. Loot: `rollTable`, the equipment re-roll rule and `unique` tracking (`ITM-10`), enemy drops with
   nearest-free-tile placement (`ITM-11`). Wire `gen.js` spawn/loot records into instances at floor
   creation (engine).
5. `derive()` now includes equipment.

**Tests** (`@m05`): **ACC-50–59, 61, 63, 65** on fixtures; `@unit` for stack compaction, letters,
`weighted` re-roll semantics (uses `queueRng`), unique tracking across two floors, drop placement in
reading order and the "none within 2" case.

**DoD.** `npm run dod -- 05`.

---

### M06 — AI

**Goal.** Enemies perceive, wake, track, path, and act per their archetypes; doors behave.

**Inputs.** `14-enemies-and-ai.md`, `22-bestiary.md` (BST-02 special-case rules), `CMB-03`.

**Files.** `src/ai.js`; `test/integration/ai.test.js`.

**Tasks.**
1. Perception via `fov.js` from the enemy tile with its `perception` (`ENM-02`); Blinded rule.
2. States and transitions (`ENM-03`), waking (`ENM-04`), tracking (`ENM-05`) including the
   `perception + 3` noise refresh and the "woke this turn gains no energy" rule.
3. Archetype decision lists (`ENM-06`) as pure functions `(enemy, state) → action`; Skirmisher
   retreat tie-breaks; Bruiser wind-up; Erratic `d10` via play RNG; Swarmer pathing exception;
   Guard bounds and RETURNING.
4. Enemy melee/ranged through `combat.js` (`ENM-07`); Cuckoo shriek noise 12 and ignores-Plating flag;
   door handling `ENM-09` (`YES/NO/BREAKS`).
5. Replace the M04 stub; the engine's enemy phase now calls `ai.decide`.

**Tests** (`@m06`): **ACC-14, 82–92** on fixtures; plus `@unit`: each archetype's decision list on a
table of situations (adjacent / seen at range / lost / blocked / windingUp) yields the expected
action; `lastKnownAge` expiry at 9; Guard with Tick out of bounds; retreat picks the documented tile.

**DoD.** `npm run dod -- 06`.

---

### M07 — Skills and progression

**Goal.** XP, level-ups, all twelve skills, active slots.

**Inputs.** `11` (CHR-06–10), `20-skills.md`, `SKL-05`.

**Files.** `src/skills.js`; engine actions `skill`, `takeSkill`; `test/integration/skills.test.js`.

**Tasks.**
1. XP award on break (`CHR-06`), thresholds, level-up (`CHR-07`: +4/+4, skill point, log line,
   `levelUp` event), cap at 9.
2. `takeSkill(name)` with the prerequisite rule (`CHR-09`); `activeSlots` in acquisition order
   (`CHR-10`); `derive()` includes skill passives.
3. Each skill per `20-skills.md`: Braced Frame, Overwind Strike (direction), Flywheel Guard (timer
   `guardTimer`, Stun/knockback immunity), Piston Drive (threshold hook in `combat.meleeAttack`),
   Salvage (counter + alternating drop), Efficient Springs (consumable amounts), Field Repair
   (once per floor; reset on ascend), Clockwork Decoy (the Decoy actor and retargeting rule),
   Tuning, Resonant Pulse, Discord, Sympathetic Break (recursive, id order). Interaction notes
   `SKL-05`.
4. Once-per-floor `(used)` flag exposed in state for the panel.

**Tests** (`@m07`): **ACC-30–45**; remaining item ACCs **ACC-60, ACC-62, ACC-64**; `@unit` for threshold table
(XP → level for 12 values), prerequisite enforcement, slot ordering with 4 actives, Salvage counter
across an ascend, Decoy replacement, Sympathetic Break chain of 3 with correct XP and Salvage count
(ACC-44).

**DoD.** `npm run dod -- 07`.

---

### M08 — Bosses, scripted moments, endings, journal

**Goal.** The three boss scripts, the three scripted moments, the Understudy's lines, the ending
state machine, and the journal — all as engine events with exact text.

**Inputs.** `BST-03–06`, `FLR-04, 07, 09`, `STY-05–08`, `SCR-05–08`, `UI-19`.

**Files.** boss scripts in `src/ai.js` (or `src/bosses.js`), `src/story.js` (triggers, ending
machine), engine action `choose`; `test/integration/bosses.test.js`, `story.test.js`.

**Tasks.**
1. Boss framework (`BST-03`): action counter, status caps, phase transitions at thresholds with
   transition log lines, always-Active after entry trigger.
2. The Conductor (`BST-04`): stage-room placement, first-sight rule, Downbeat summons with cap 4,
   Phase 2 FAST. The Regulator (`BST-05`): entry by sight/noise, heavy 3d5, Vent phase, immunities.
   The Understudy (`BST-06`): door trigger + line 1 textbox, spring 100 −2/action, Overwind,
   Phase 2 summons + line 2 + Pulse, Phase 3 SLOW + line 3, defeat by Integrity or spring.
3. Scripted moments (`STY-05`, `SCR-05`): moment 1 on stairs-room FOV entry on floor 3 (once);
   moment 2 on Blueprint pickup; moment 3a/3b on Understudy defeat.
4. Ending machine (`SCR-07`, `UI-19`): after 3b → `choice` event, phase `awaitChoice`; `choose A/B`
   → `journal` page 8 event (mark found) → (B: `descent` event) → `textbox endingA/B` → `victory`
   event with summary (`STY-08` fields) → phase `ended`.
5. Death summary (`STY-08`) fields completed: floors, turns, enemies broken, level, skills in order,
   equipment, pages found, seed.

**Tests** (`@m08`): **ACC-93, 94, 95, 96, 97** on fixture arenas (floor 8 via `loadFixedFloor`);
headless **ACC-114** (textbox events block other actions until `dismiss`; text equals
`data/script`), **ACC-115**, **ACC-116** (event sequences exactly as `UI-19` row, `descent.lines`
has 7 lines, summaries populated); `@unit` for phase thresholds at 16/24/48/24, caps, the
Understudy spring reaching 0 ⇒ defeat.

**DoD.** `npm run dod -- 08`.

---

### M09 — Save and load

**Goal.** `TEC-09` exactly, with replay equivalence proven headlessly.

**Inputs.** `TEC-05`, `TEC-09`.

**Files.** `src/save.js` (`serialize(state)`, `deserialize(json)`, `createStore(adapter)`),
`test/integration/save.test.js` with an in-memory adapter.

**Tasks.**
1. `serialize` produces the `TEC-05` shape with `version: 1` and `playRngState`; `deserialize`
   validates version and shape, rebuilding `Set`s and derived values.
2. Engine hooks: save after each turn-costing action, ascend, `takeSkill`; delete on death,
   victory, abandon (`TEC-09`). Adapter injected so Node tests use a Map.
3. "Tick resumes." log line on restore.

**Tests** (`@m09`): **ACC-01** (two engines, same seed, same 50 actions → identical serialized
state and log), **ACC-02** (serialize at action 100 of 200, restore into a fresh engine, continue;
final state equals the uninterrupted run — this is the key replay test), **ACC-03, 04, 05, 06**
headless equivalents (adapter contents after death; abandon flow; version 0 ignored and removed;
100 `view()`/inspect calls do not change `playRngState`).

**DoD.** `npm run dod -- 09`.

---

### M10 — Rendering, input, screens

**Goal.** The game is playable in a browser exactly per `15-ui-and-controls.md`, and every UI ACC is
asserted through `CH.grid()`.

**Inputs.** `15-ui-and-controls.md`, `TEC-10–13`, `UI-*`, `SCR-01, 08, 09`.

**Files.** `src/render.js`, `src/main.js`, `src/screens/{title,run,inventory,skills,journal,help,
history,textbox,endingChoice,summary,pause,inspect,targeting}.js`, `src/input.js` (key/mouse maps),
`src/travel.js` (Travel + Shift-run timers); `test/e2e/*.spec.js`.

**Tasks.**
1. `render.js`: cell buffer 80×30; `UI-02` regions; `UI-03` panel rows verbatim; `UI-04` log;
   `UI-05` inspect line; `UI-07/08/09` glyphs, palette, dimming, telegraph, flashes; canvas sizing
   `TEC-10`; `CH.grid()`.
2. `input.js`: `UI-10` key table using `event.code` for numpad; `UI-13` mouse table; `UI-12` look and
   targeting modes; `UI-11` popup.
3. Screens per `UI-14–18`; screen stack `TEC-06`; transitions `UI-19`; title menu incl. seed entry
   and abandon prompt; summary screen with hidden input selection `TEC-12`.
4. `travel.js`: `UI-13` stop conditions, 60 ms steps; Shift-run 40 ms (`TEC-11`).
5. Event consumption: map engine events to overlays; `descent` timing 1.5 s skippable.
6. Wire `save.js` with the localStorage adapter (the only DOM-touching part of save).
7. `window.CH` complete per `TEC-13` (+ `grid`, `events`, `queueRng`).

**Tests** (`@m10`, Playwright; each test starts a run with a fixed seed via `CH.newRun('TEST1234')`
or loads a fixture through `CH.loadFloor`; assertions read `CH.grid()` cells and `CH.state`):
**ACC-100–122**, and the browser forms of **ACC-01–06** (reload + Continue; localStorage key
presence). Text-box scrolling (`UI-16`) with the intro. Keyboard: dispatch `Numpad1` vs `Digit1`.
Mouse: click coordinates computed from the canvas rect and cell size.

**DoD.** `npm run dod -- 10` (unit + meta + e2e).

---

### M11 — Bots and balance simulation

**Goal.** `BAL-07` bots exist, run headlessly, and the game meets `BAL-C1–C6` and `ACC-130/131`
targets — or the balance protocol has been applied and logged.

**Inputs.** `31-balance.md`, `BAL-07`, `BAL-08`, `TEC-13`.

**Files.** `tools/sim.js` (CLI: `node tools/sim.js S4 --seeds 200 --json`), `tools/bots/*.js`,
`test/integration/balance.test.js`, `test/integration/sim.test.js`.

**Tasks.**
1. Bots S2–S5 as pure policies over `game.state` returning actions; S1 and S6 as generation-only
   loops. Bots use `astar`/`bfs` from `grid.js` and the FOV from `game.view()`.
2. `balance.test.js` recomputes **BAL-C1** (Tension table from `OVR-04` turns and `CHR-04`),
   **BAL-C3** (XP cumulative from `data/floors` + `data/enemies`), **BAL-C4** (max single hit per
   floor from data vs. expected Integrity), **BAL-C6** (each build's skills exist and are takeable
   with 8 points under `CHR-09`). C2 and C5 are documented arithmetic; the test asserts the inputs
   they depend on (Solder 15, decay 5, Integrity 40+4/level).
3. `sim.test.js`: **ACC-130** (S1–S6 targets over 200 seeds each; S3/S4 tolerance bands as written
   in `BAL-07`), **ACC-131** (full-explore scripted S4-style run on `TEST1234` with Spring-Key use
   disabled: never wound down; Tension at floor 8 entry within 35–65).
4. Apply the balance protocol (PLN-07.2) if any target fails.

**Tests.** As above; sims run in < 3 minutes total on CI (reduce to 100 seeds if not, and say so in
the test title).

**DoD.** `npm run dod -- 11`.

---

### M12 — Release

**Goal.** Everything green, nothing allowlisted, documented, tagged.

**Files.** `test/integration/perf.test.js`, README update, `CHANGELOG.md`.

**Tasks.**
1. Perf tests (`TEC-14`): turn < 5 ms mean with 30 enemies on a fixture; generation < 50 ms; full
   redraw < 8 ms (Playwright, `performance.now()` around `CH.render()` — add the hook and note it in
   DECISIONS.md); idle CPU: no timers registered after 1 s idle (`CH.timers()` count is 0 — same).
2. Empty `acc-allowlist.json`; **ACC-133** as a meta test scanning `specs/` for placeholder markers.
3. README: how to run (`npm start`), how to test, controls summary pointer to Help, seed usage.
4. Tag `v1.0.0`.

**DoD.** `npm run dod -- 12` green; allowlist `[]`; `git tag v1.0.0`.

## PLN-07 Handling the unknowns

### 7.1 Ambiguity protocol (`specs/DECISIONS.md`)

When a rule is missing, ambiguous, or two rules conflict:
1. Prefer the reading under which the cited ACC test passes; if none is cited, prefer the reading
   that is simplest to explain in the inspect popup (`OVR-02` pillar 3).
2. Implement it, and append to `specs/DECISIONS.md`:
   `| D-nnn | <spec IDs> | <the question> | <what was chosen> | <why> | <milestone> |`.
3. If the choice contradicts spec prose (not numbers), fix the prose in the same PR and cite the
   D-number in the commit. Numbers and IDs are never changed this way (R10).

### 7.2 Balance protocol (`specs/BALANCE-CHANGELOG.md`)

When a `BAL-C*` or `ACC-130/131` target fails:
1. Take the first applicable knob from `BAL-08` in its listed order. Change it by the smallest step
   the spec names. One knob per iteration.
2. Update the number everywhere it appears in `specs/` and `data/`; re-run `npm run dod -- 11`.
3. Append `| B-nnn | <target> | <measured> | <knob> | <old → new> | <result> |`.
4. Maximum three iterations. If still failing, mark that single sim test `skip` with the message
   `BALANCE: <target> unmet after 3 iterations; see B-nnn`, keep every other test green, and
   continue. Never widen a target band.

### 7.3 Unobservable UI behavior

If a `UI-*` rule cannot be asserted through `CH.grid()`/`CH.state`, add the narrowest read-only
hook to `window.CH`, document it in `TEC-13` in the same PR, and log a D-entry. Hooks never mutate
state except `act`, `newRun`, `loadFloor`, `queueRng`.

### 7.4 Tooling failures

If Playwright cannot install in CI, pin the previous minor version and log a D-entry. Never replace
the test tiers or introduce a build step.

## PLN-08 Completion criteria

The game is done when all of the following hold on `main`:

- [ ] `npm run dod -- 12` is green in CI.
- [ ] `test/meta/acc-allowlist.json` is `[]` and `acc-coverage` passes.
- [ ] Every test title carries an ACC ID or `@unit`, and a milestone tag (meta test).
- [ ] `specs/DECISIONS.md` exists (possibly with zero rows) and every D-entry cites a milestone.
- [ ] `BAL-C1–C6`, `ACC-130`, `ACC-131` pass, or each failure is a logged B-entry with a skipped test.
- [ ] `npm start` serves a game that can be played from title to either ending with keyboard alone
      and with mouse alone (covered by the M10 tests, but stated as the human-facing outcome).
- [ ] `README.md` documents run, test, and seed usage; `v1.0.0` is tagged.
