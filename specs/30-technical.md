# 30 — Technical

**Status:** Wave 4 — constraints. Everything here is normative for the builder; nothing here changes
gameplay rules from waves 2–3.
**Purpose:** Fix the stack, file layout, data shapes, randomness, save format, rendering, input, and the
exact algorithms where "any correct implementation" would not reproduce the same run from the same seed.

---

## TEC-01 Stack

- Plain HTML + CSS + JavaScript (ES2020), ES modules. **No build step, no bundler, no transpiler,
  no runtime dependencies, no network requests, no fonts loaded from the network.**
- Runs in the current release of Chrome, Firefox, Edge, and Safari. Must work when served by any static
  file server (e.g. `python -m http.server`). `file://` is not required (module loading is blocked there
  in some browsers).
- One page: `index.html`. One canvas element. One hidden `<input>` for seed copy (`UI-17`). No other DOM
  UI.
- The whole game is client-side; there is no server component.

## TEC-02 File layout

```
index.html                 canvas + <script type="module" src="src/main.js">
src/main.js                boot, screen stack, input dispatch, frame loop
src/rng.js                 PRNG, string hashing, dice
src/grid.js                tile helpers, Chebyshev, Bresenham, BFS, A*
src/fov.js                 symmetric shadowcasting
src/gen.js                 floor generator (WLD-11), floor 8 loader (WLD-13)
src/actors.js              Tick and enemy instances, derived-stat recomputation (CHR-08, CMB-01)
src/turn.js                turn loop (CMB-02), energy (CMB-03), statuses, hazards, death
src/ai.js                  archetypes (ENM-06), boss scripts (BST-04..06)
src/combat.js              hit/damage (CMB-06/07), ranged & throw (CMB-08), knockback, noise
src/items.js               inventory, equipment, loot tables, drops (12, 21)
src/skills.js              the 12 skills (20)
src/render.js              canvas grid renderer (UI-01, UI-07..09)
src/screens/               one module per screen: title, run, inventory, skills, journal, help,
                           history, textbox, endingChoice, summary
src/save.js                autosave / restore (TEC-09)
data/palette.js            UI-08 (+ BST-01)
data/items.js              21
data/enemies.js            22
data/skills.js             20
data/floors.js             23 (including the floor 8 map as an array of 24 strings)
data/script.js             24
```

Data modules export plain frozen objects/arrays; they contain no logic. Every name used as a key in
data must match the **bold** names in the specs exactly (`OVR-07` rule 5).

## TEC-03 Data shapes

Written as TypeScript-style shapes for precision; the implementation is plain JS.

```ts
type Dice = { n: number; sides: number; mod: number };      // "2d4+1" → {2,4,1}; flat "1" → {0,1,1}
type Color = string;                                         // "#RRGGBB" or a palette name

type Item = {
  name: string; category: 'melee'|'ranged'|'plating'|'attachment'|'instant'|'throwable'|'record';
  glyph: string; color: Color; description: string; floors: number[]; unique?: true;
  dice?: Dice; accuracyMod?: number; special?: string;       // weapons
  range?: number; tensionCost?: number;                      // ranged
  plating?: number; evasionPenalty?: number;                 // plating
  forceMod?: number; precisionMod?: number; platingMod?: number; evasionMod?: number; // attachment
  effect?: string; radius?: number;                          // consumables: effect id (TEC-04)
  journalIndex?: number; blueprint?: true;                   // records
};

type EnemyType = {
  name: string; glyph: string; color: Color; description: string; floors: number[];
  integrity: number; accuracy: number; evasion: number; plating: number;
  attack: Dice; speed: 'SLOW'|'NORMAL'|'FAST';
  archetype: 'CHASER'|'GUARD'|'SKIRMISHER'|'SWARMER'|'BRUISER'|'ERRATIC'|'BOSS';
  perception: number; packSize?: [number, number]; opensDoors: 'YES'|'NO'|'BREAKS';
  ranged?: { dice: Dice; range: number; windUp: boolean; ignoresPlating?: true; onHit?: string; noise: number };
  heavyAttack?: Dice; onHit?: string; immunities: string[];
  xp: number; dropChance: number; dropTable: [string, number][];
  boss?: string;                                             // key into ai.js boss scripts
};

type Skill = { name: string; discipline: 'Armature'|'Tinkering'|'Resonance'; rank: 1|2|3|4;
  type: 'P'|'A'; cost?: number; target?: 'self'|'direction'|'tile'|'adjacent-free';
  summary: string; description: string; oncePerFloor?: true };

type FloorDef = { number: number; name: string; roomTarget: number; extraCorridors: number;
  doorChance: number; hazards: { kind: 'GRINDING_GEAR'|'STEAM_VENT'|'PENDULUM_BAND'; count?: number }[];
  itemCount: number; floorTable: [string, number][]; cacheCount: [number, number];
  cacheTable: [string, number][]; cacheFirstRollTable?: [string, number][]; cacheExtra?: string[];
  spawns: ({ type: string; count: number } | { pack: string })[]; guard: string;
  boss?: { type: string; room: 'stairs' }; journalPage: number; fixedMap?: string[] };
```

## TEC-04 Effect and special identifiers

Consumable `effect`, weapon `special`, attachment `special`, and enemy `onHit` are string ids resolved
by a switch in `items.js` / `combat.js`. The closed sets are exactly: consumables `SOLDER`, `SPRING_KEY`,
`FLUX`, `OIL_FLASK`, `GRIT_BOMB`, `TUNING_FORK`, `CLATTER_CAN`; weapon specials `REND`, `SWEEP`, `KNOCK`,
`TEMPO`, `RING`; attachment specials `COOLING`, `QUIET`, `REGULATED`; enemy on-hit `BURN_2`, `EXPOSE_2`.
Adding an id requires adding a spec entry.

## TEC-05 Game state

One plain object `state`, serializable to JSON (TEC-09), containing:

```
version, seedString, playRngState, turn, floorNumber,
tick: { integrity, integrityMax, tension, xp, level, skillPoints, skills[], activeSlots[],
        equipment{weapon,plating,attachment}, inventory[{name,count}], statuses{}, guardTimer,
        fieldRepairUsed, salvageCounter, salvageNext, x, y },
floor: { tiles[24][60], memory[24][60], items[{name,count,x,y}], scrap[], hazards[], features{},
         rooms[], roles{}, enemies[EnemyInstance], decoy?, nextEnemyId, bossFlags{} },
journal: { pages: boolean[8], blueprint: boolean }, uniquesGenerated: string[],
log: string[] (cap 500 with color tags), stats: { enemiesBroken, turns, ... },
flags: { tension30Warned, scripted1, scripted2, ... }
```

Derived values (accuracy, evasion, Plating attribute, FOV) are recomputed, never stored.

## TEC-06 Screen stack

`main.js` keeps a stack of screens; the top screen receives input and is drawn last. The Run screen is
the base during a run. Overlays (Inventory, Skills, Journal, Help, History, Text box, Inspect popup,
Pause, Ending choice) push/pop. Title, Death, Victory, Intro replace the stack. Transitions per `UI-19`.

## TEC-07 Randomness and seeds

- **PRNG:** `mulberry32` (32-bit state; the well-known public-domain implementation:
  `a += 0x6D2B79F5; t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296`). State is the single 32-bit integer `a`.
- **Hash:** FNV-1a 32-bit over the UTF-8 bytes of a string.
- **Seed string:** what the player typed (trimmed, max 16 chars) or, for a random run, 8 characters
  from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` drawn with `Math.random()`. Shown on the summary screen.
- **Streams:**
  - `floorRng(n) = mulberry32(fnv1a(seedString + ':floor:' + n))` — used only inside generation of
    floor `n`, in the order `WLD-11` writes. Discarded afterwards.
  - `playRng = mulberry32(fnv1a(seedString + ':play'))` — every in-play random draw (dice, hit rolls,
    drops, ERRATIC decisions, loot placement at enemy death). Its state is saved.
- **Draw helpers:** `int(lo, hi)` inclusive uniform via `lo + floor(next() × (hi − lo + 1))`;
  `roll(dice)` = sum of `n` calls to `int(1, sides)` + `mod` (flat: `n = 0`); `chance(p)` = `int(1,100) ≤ p`;
  weighted table per `ITM-10`.
- **Call order** must match the spec's stated order (e.g. `CMB-06`: hit roll, then damage roll). Where
  the spec resolves "in id order" or "reading order", that order also fixes the draw order.
- Determinism guarantee: the same seed string + the same sequence of player actions produces the same
  run. Mouse hover, inspect, and screens never consume randomness.

## TEC-08 Deterministic algorithms

- **Bresenham** (`CMB-08`): standard integer error-accumulation line from `(x0,y0)` to `(x1,y1)`; when
  `|dx| ≥ |dy|` step along x, else along y; error initialized to `dx/2`-style halves as in the classic
  form; on exact ties in the diagonal case prefer stepping in x then y. The start tile is excluded from
  the projectile path.
- **FOV:** port the reference implementation of Albert Ford's *Symmetric Shadowcasting* (2020) exactly,
  including its `is_symmetric` check, then filter to Chebyshev radius ≤ 8 (or the enemy's perception).
- **BFS** over 8-connected passable tiles for room distances (`WLD-11` step 5).
- **A\*** per `ENM-08` with a binary heap keyed by `(f, h, y × 60 + x)`.
- **Reading order** = ascending `y`, then ascending `x`.

## TEC-09 Autosave

- Key: `localStorage['clockworkHollow.save.v1']`. Value: `JSON.stringify(state)`.
- Written at `CMB-02` step 9 (after every turn) and on Ascend, on skill selection, on any inventory
  action that costs a turn, and when leaving to the title via Pause. Not written on free actions.
- Deleted on death, on victory (after the Victory screen is shown), and on `Abandon`.
- On load: if the key is missing, or `JSON.parse` fails, or `version !== 1`, treat as no save (and
  delete it). Never attempt migration.
- `Continue` restores `state` verbatim, recomputes derived values and FOV, and shows the Run screen with
  the log line "Tick resumes." Reloading the page mid-run then pressing Continue must reproduce the
  exact pre-reload state, including `playRngState` (this is how save-scumming is made pointless: the
  next rolls are the same rolls).

## TEC-10 Rendering

- Canvas 2D, one `<canvas>` sized to the window (`devicePixelRatio`-aware). Cell size: the largest
  integer `s` such that `80 × 0.6 s ≤ width` and `30 × s ≤ height` (cell width = `0.6 × s`, height `s`);
  if `s < 10`, use non-integer scaling to fit. The grid is centered; the rest is `bg`.
- Font: `${0.9 × s}px "DejaVu Sans Mono", "Consolas", "Menlo", "Liberation Mono", monospace`, glyphs
  drawn with `textAlign = 'center'`, `textBaseline = 'middle'`.
- Redraw only when a `dirty` flag is set (state change, hover change, screen change, flash timer,
  window resize). Full redraw each time; 2,400 cells is cheap.
- Flashes (`UI-09` rule 6) via a timestamp; a `requestAnimationFrame` loop runs only while a flash or
  the Walker descent (`SCR-07`) is pending.
- Text boxes word-wrap at the box's inner width; a word longer than the width is broken.
- Colors: palette names resolved through `data/palette.js`; dimming per `UI-09` rule 2 computed once
  per color and cached.

## TEC-11 Input

- `keydown` on `window`; use `event.code` to distinguish `Numpad1..9` from `Digit1..4`, `event.key`
  for letters and punctuation (`?`, `<`, `,`, `.`). `preventDefault()` for handled keys so the page does
  not scroll.
- Shift-run (`UI-10`) repeats the move on a 40 ms timer while the key is held and the stop conditions
  are not met; releasing the key stops.
- Mouse: `mousemove` → cell under cursor (or none) → hover state; `click` → `UI-13`; `contextmenu` →
  prevented, treated as right-click; `wheel` → history scrolling only.
- Travel (`UI-13`) executes one step per 60 ms via a timer, checking stop conditions before each step.
- The tab/focus state never matters: there is no real-time element.

## TEC-12 Seed display and copy

The Victory/Death screens draw the seed in the grid and also set the hidden `<input>`'s value to it and
select it, so `Ctrl+C` copies. The input is positioned off-screen and is the only focusable DOM element
besides the canvas.

## TEC-13 Debug and test hooks

`window.CH` exposes `{ state, game, playRng, floorRng, act(action), newRun(seed), loadFloor(n),
grid(), events(), queueRng(values) }` so that `32-acceptance-tests.md` can be automated with any
browser test runner. `CH.act` performs one engine action (`PLN-03` schema) and runs the turn loop,
returning `{ok, reason, log, events}`. `CH.grid()` returns the last rendered 80×30 cell buffer as
rows of `{glyph, fg, bg}` so tests assert what is drawn without reading pixels. `CH.events()` returns
and clears the UI's pending engine events. `CH.queueRng(values)` replaces the play RNG with a scripted
sequence (tests only; throws when exhausted). These hooks have no UI and do not affect gameplay.
The headless engine facade, action schema, and event vocabulary they rely on are fixed in
`40-implementation-plan.md` § PLN-03.

## TEC-14 Performance targets

- A turn (`CMB-02` including AI for ≤ 30 enemies) completes in < 5 ms on a 2018 laptop.
- Floor generation (including validation retries) completes in < 50 ms.
- A full redraw completes in < 8 ms.
- Idle CPU is zero: no timers run when nothing is animating or repeating.

## TEC-15 Invariants the code asserts (throw in development, log in production)

Every `ACC` generation invariant (`32-acceptance-tests.md` § ACC-2x); Tension and Integrity within
their clamps after every mutation; at most one actor per tile; at most one item per tile; enemy
`energy ≤ 200`; unique items generated at most once; the floor 8 map is 24 rows × 60 columns.
