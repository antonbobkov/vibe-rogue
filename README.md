# Clockwork Hollow

A short browser roguelike in colored ASCII. No runtime dependencies, no build step, one HTML file
and a canvas.

You are Tick, a wind-up automaton — the first thing the clockmaker Aurelie Vance ever finished. She
is dead, the tower is winding down, and so are you. Climb eight floors to the Great Escapement, take
the Master Key, and decide what to do with it. Every turn costs spring. Death is permanent. A winning
run takes 30–45 minutes.

The game is built entirely from the specifications in [`specs/`](specs/), which are written so that a
builder makes no creative decision. Version **1.0.0** — see [`CHANGELOG.md`](CHANGELOG.md).

---

## Requirements

- **Node.js 20 or newer** (only to serve the files and to run the tests).
- A current Chromium, Firefox or Safari. The page loads `src/main.js` as an ES module.
- No runtime dependencies and no build step (`PLN-02` R4). `@playwright/test` is the single
  devDependency, and it is needed only for the browser test tier.

```sh
npm install        # devDependencies only; skip it if you just want to play
```

## Run it

```sh
npm start          # static server on http://localhost:8080
```

Then open <http://localhost:8080/index.html>. `npm start` is `node tools/serve.js`: a dependency-free
static server over the repository root, so `test/fixtures/` stays importable from the browser tests.

The game runs from the file tree as it is — there is nothing to compile, bundle or minify.

## Controls

The complete key and mouse tables are on the in-game **Help screen**: press `?` on the title screen
or during a run (`Esc` opens the Pause menu, which also has Help). Help is the authoritative list;
this is the short version.

| Key(s) | Action |
|---|---|
| Arrows · numpad `1 2 3 4 6 7 8 9` · `h j k l y u b n` | Move (bump to attack, bump a closed door to open it) |
| `.` · numpad `5` · `z` | Wait one turn |
| `Shift` + direction | Run in that direction until something interesting happens |
| `g` · `,` | Pick up |
| `e` | Interact — wind at a station, use the stairs |
| `<` | Ascend (standing on the stairs) |
| `c` then a direction | Close a door (free) |
| `f` / `t` | Fire the ranged weapon / throw an item, then target |
| `1` `2` `3` `4` | Use the active skill in that slot |
| `i` `s` `r` `m` | Inventory · Skills · Journal · Message history |
| `x` then `Enter` | Look mode, and inspect what the cursor is on |
| `?` | Help |
| `Esc` | Cancel a prompt, or open the Pause menu |

Mouse alone is enough to play: hover to inspect, left-click a tile to travel to it, left-click an
adjacent enemy to attack, right-click any cell for the inspect popup, and click the panel tokens to
open the screens. A run can be played from the title screen to either ending with the keyboard alone
or with the mouse alone.

The run autosaves after every turn to `localStorage`; **Continue** on the title screen resumes it.
Death, victory and abandoning a run delete the save — permadeath is the point.

## Seeds

Every run is fully determined by its **seed string**: the same seed plus the same sequence of actions
produces the same run, down to each die roll (`TEC-07`).

- **Choose a seed:** on the title screen pick `Enter seed`, type up to 16 printable characters, and
  confirm. The run starts on that seed.
- **Random seed:** `New run` draws 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- **Find out which seed you played:** the Death and Victory summary screens print `Seed <seed>`, and
  it is also written into a hidden input on the page so it can be copied.
- Floor layouts come from `mulberry32(fnv1a(seed + ':floor:' + n))` and play rolls from
  `mulberry32(fnv1a(seed + ':play'))`, so two players on one seed see the same eight floors.
- `TEST1234` is the seed the test suite uses; it is an ordinary seed and plays like any other.

Hover, look mode, the inspect popup and every screen consume no randomness, so studying a situation
never changes its outcome.

## Test it

| Command | What it runs |
|---|---|
| `npm test` | Every Node test: unit, integration and the meta tier (repo rules) |
| `npm run e2e` | The Playwright browser tier against `tools/serve.js` (Chromium only) |
| `npm run dod -- NN` | The Definition of Done for milestone `NN` (`00`–`12`): the Node tests filtered to tags `@m00`…`@mNN`, then the meta tier unfiltered, then the matching browser specs. The exit code *is* the DoD. |
| `npm run sim` | The full `BAL-07` balance simulation: six bots over 200 seeds each (`node tools/sim.js --all --seeds 200`) |

```sh
npm test                  # 261 node tests, 1 documented skip (see below)
npm run e2e               # 37 browser specs, Chromium
npm run dod -- 12         # the release gate: everything, in order
npm run sim               # the long one; the sim CI job allows 45 minutes
node tools/sim.js S4 --seeds 50 --json      # one balance check, machine-readable
```

Test conventions (`PLN-02` R5, R6): every test title names the acceptance ID it verifies — or `@unit`
for a module-level test — plus exactly one milestone tag `@m00`…`@m12`. No test uses `Math.random` or
wall-clock time, except the four `TEC-14` performance budgets, where the measurement is the test
(`test/integration/perf.test.js` and `test/e2e/perf.spec.js`). There are no snapshots and no retries:
every expected value is written into the test from the spec.

One test is deliberately skipped: the `S4` win-rate check, an accepted and documented balance miss
recorded as `B-004` in [`specs/BALANCE-CHANGELOG.md`](specs/BALANCE-CHANGELOG.md). `npm run sim`
reports it as `SKIP` and exits 0; `node tools/sim.js --all --strict` makes it fail instead, which is
how the miss gets re-measured on purpose.

## Layout

```
index.html          the page: one canvas, one hidden input for the seed
src/                the game — engine, generator, AI, items, skills, renderer, screens
src/main.js         the only module that owns the browser (canvas, listeners, timers, window.CH)
data/               every table from the content specs, as frozen plain objects
tools/serve.js      the static server behind `npm start`
tools/dod.js        the Definition-of-Done runner behind `npm run dod`
tools/sim.js        the BAL-07 balance simulation and its bots
test/unit/          one module at a time
test/integration/   the engine, headless, on ASCII fixture maps
test/meta/          the repository's own rules (no DOM in the core, data is data, test titles)
test/e2e/           Playwright, asserting the rendered 80x30 cell buffer through window.CH
specs/              the specifications the whole thing is built from
```

Everything under `src/` except `render.js`, `main.js`, `screens/*` and the storage adapter in
`save.js` is headless: no `window`, no `document`, no timers. That is what lets the engine run inside
`node --test` and inside the balance simulation, and it is enforced by a meta test rather than by
convention.

## Specifications

| Wave | Files | What |
|---|---|---|
| 1 — Vision | [`00`](specs/00-overview.md) overview · [`01`](specs/01-story.md) story | Pitch, pillars, scope, pacing, conventions; world, characters, endings, tone |
| 2 — Systems | [`10`](specs/10-turns-and-combat.md) turns & combat · [`11`](specs/11-character-and-skills.md) character · [`12`](specs/12-items-and-inventory.md) items · [`13`](specs/13-world-and-generation.md) world & generation · [`14`](specs/14-enemies-and-ai.md) enemies & AI · [`15`](specs/15-ui-and-controls.md) UI & controls | Every rule and formula |
| 3 — Content | [`20`](specs/20-skills.md) skills · [`21`](specs/21-items-catalog.md) items · [`22`](specs/22-bestiary.md) bestiary · [`23`](specs/23-floors.md) floors · [`24`](specs/24-script.md) script | Every number and every string |
| 4 — Technical | [`30`](specs/30-technical.md) technical · [`31`](specs/31-balance.md) balance · [`32`](specs/32-acceptance-tests.md) acceptance tests | Stack, determinism, save format; the run model; the checklist |
| Build | [`40`](specs/40-implementation-plan.md) implementation plan | Thirteen milestones, each with a machine-checkable Definition of Done |
| Logs | [`DECISIONS.md`](specs/DECISIONS.md) · [`BALANCE-CHANGELOG.md`](specs/BALANCE-CHANGELOG.md) | Every ambiguity resolved while building, and every balance knob turned |

Rules carry IDs like `CMB-06`; tables are authoritative over prose; every entity name is matched
exactly. See `00-overview.md` § OVR-07. Spec IDs are never renumbered.

## License

`UNLICENSED` — see `package.json`. The specifications and the code in this repository are not
published under an open-source license.
