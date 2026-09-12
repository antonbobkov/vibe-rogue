# 15 — UI and Controls

**Status:** Wave 2 — core rules. All user-visible strings not fixed here are in `24-script.md`.
**Purpose:** Define exactly what is on screen, where, in what color, and what every key and mouse
action does on every screen.

---

## UI-01 The grid

- The whole game renders into a fixed **80 × 30** character grid on an HTML canvas (`TEC-10`), using a
  monospace font. Each cell has a glyph, a foreground color, and a background color.
- The canvas scales to fit the browser window while keeping the cell aspect ratio; letterboxing is
  black. Mouse coordinates are mapped back to cells.
- Cell background defaults to `#0c0c10`. Only a few states use other backgrounds (UI-09).

## UI-02 Run screen layout

```
col: 0                                                        59 60                 79
row 0 ┌──────────────────────────────────────────────────────────┐┌──────────────────┐
      │                       MAP 60 × 24                        ││   SIDE PANEL     │
      │                                                          ││     20 × 24      │
row 23└──────────────────────────────────────────────────────────┘└──────────────────┘
row 24  INSPECT LINE (80 wide, hover / look text)
row 25  message log line 1 (oldest of the five)
row 26  message log line 2
row 27  message log line 3
row 28  message log line 4
row 29  message log line 5 (newest)
```

- Map: rows 0–23, cols 0–59. No borders are drawn — the map's outer wall ring *is* the border.
- Side panel: rows 0–23, cols 60–79. Column 60 is a vertical separator `│` in `#3a3a44` on every
  row; content uses cols 61–79 (19 characters).
- Inspect line: row 24, cols 0–79, background `#14141a`.
- Log: rows 25–29, cols 0–79.

## UI-03 Side panel contents (rows 0–23, cols 61–79)

| Row | Content (19 chars max; `…` = padded) | Example |
|---|---|---|
| 0 | `TICK` + spaces + `Lv N` right-aligned; `SP:n` in bright yellow replaces `Lv N` when points are unspent | `TICK           Lv 3` |
| 1 | `INTEGRITY  cur/max` | `INTEGRITY    28/44` |
| 2 | Integrity bar, 19 cells: `[` + 17 fill cells + `]` | `[############     ]` |
| 3 | `TENSION    cur/100` | `TENSION      61/100` |
| 4 | Tension bar, same format; fill color per UI-08 | |
| 5 | `Floor N` + the floor's `shortName` (`FLR-01`, ≤ 11 chars) right-aligned | `Floor 3  Music Room` |
| 6 | `Turn NNNN   decay:n` — turns until next Tension decay, `decayPeriod − decayCounter` (`CHR-11`) | `Turn 412    decay:3` |
| 7 | blank |
| 8 | `FRC n  PRC n  PLT n` — attributes | `FRC 2  PRC 0  PLT 3` |
| 9 | `ACC nn%  EVA nn` — accuracy base and evasion | `ACC 80%  EVA 8` |
| 10 | blank |
| 11 | `W ` + weapon name (truncate with `…` at 17) | `W Escapement Blade` |
| 12 | `P ` + plating name or `—` | `P Brass Plating` |
| 13 | `A ` + attachment name or `—` | `A —` |
| 14 | blank |
| 15 | Status effects, comma-separated as the first three letters + `(n)` (`Stu Slo Bur Bli Exp`, plus `Gua` for Flywheel Guard and `Solder(n)` for a running repair, `ITM-09`); `—` if none; truncated with `…` at 19 | `Bur(2), Solder(2)` |
| 16 | Hazard timer if the floor has cyclic hazards: `vents in n` / `pendulum in n` / `ACTIVE`; otherwise the turns until the floor's next wanderer, `next: n` (`WLD-14`); blank when neither applies | `vents in 2` · `next: 34` |
| 17 | blank |
| 18 | `1 ` + active skill 1 name + cost right-aligned; `(used)` replaces cost for a once-per-floor skill already used; the name is truncated with `…` so the row is ≤ 19 chars; blank row if no skill | `1 Overwind Strike 8` |
| 19 | active skill 2 | |
| 20 | active skill 3 | |
| 21 | active skill 4 | |
| 22 | Buttons: `[i]nv  [s]kills` — each bracketed token is clickable (UI-13) | |
| 23 | Buttons: `[r]ead  [m]sg  [?]` | |

Bars: fill cells `#` in the bar color, empty cells ` `; fill count = `round(17 × cur / max)`.

## UI-04 Message log

- Five lines, newest at the bottom (row 29). Messages longer than 80 chars wrap onto additional lines,
  consuming log rows; wrapped continuation lines are indented 2 spaces.
- Messages generated during one turn loop are appended in order. If more than 5 lines are produced in
  one turn, the last 5 are shown; the full history is on the Message History screen (UI-16).
- Message colors (UI-08): default `#c8c8c8`; damage to Tick `#ff6060`; damage by Tick `#d0d0d0` (silver);
  Tension warnings `#ffd75f`; level-up and item pickup `#80ff80`; scripted/boss lines `#c0a0ff`.
- Identical consecutive messages are merged as "*message* (×n)".

## UI-05 Inspect line (row 24)

Shows one line about whatever the mouse is over (or the look cursor is on, UI-12):

- Enemy: `Sweeper  7/7  hits you 55% for 1–3  · plating 0 · normal · dormant`
- Item: `Brass Plating  [ plating 2  evasion −2`  /  `Solder ×3  ! +50 Integrity over 3, 5 Tension`
- Worn plating (`CMB-14`): `Iron Plating (−2)  [ plating 3 − 2 wear = 1  evasion −3`
- Overwound enemy (`ENM-12`): `Overwound Sweeper  11/11  hits you 65% for 3–5 · plating 0 · normal · active`
- Feature: `Winding Station (unspent) — press e. Loud: wakes the floor.` / `Up-stairs — press <`
- Wound Lock (`WLD-15`): `Wound Lock — 10 Tension to open.`
- Hazard: `Steam Vent — active in 2 turns: 4 damage, Burning 2`
- Floor / wall / door / remembered tile: its name; unseen tile: blank.
- With nothing hovered: the most recent log line is *not* repeated; the line is blank.

## UI-06 Panel details

- **Tension bar color:** `> 30` green `#60e060`; `16–30` yellow `#ffd75f`; `≤ 15` red `#ff6060`.
- **Integrity bar color:** `> 50%` `#60c0ff`; `26–50%` `#ffd75f`; `≤ 25%` `#ff6060`.
- Row 16 shows the countdown to the next active turn of the floor's cyclic hazard
  (`WLD-08`), or `ACTIVE` in the hazard's bright color while active. On a floor with no cyclic
  hazard it shows `next: n`, the turns until the next wanderer (`WLD-14`), and goes blank once that
  floor's `wanderCap` is spent.
- Skill rows: once-per-floor skills show `(used)` in `#707070` after use until Ascend.

## UI-07 Glyphs

| Thing | Glyph | Color |
|---|---|---|
| Tick | `@` | `#ffd75f` |
| Decoy (`SKL-03`) | `0` | `#5ad0ff` |
| Wall | `#` | `#6e6a5e` |
| Floor | `.` | `#3a3a44` |
| Closed door | `+` | `#b08a4a` |
| Open door | `'` | `#b08a4a` |
| Wound Lock (`WLD-15`) | `=` | `#ffd75f` (brass) |
| Up-stairs | `<` | `#f0e68c` |
| Winding Station unspent | `&` | `#5ad0ff` |
| Winding Station spent | `&` | `#2a4a58` |
| Grinding Gear | `^` | `#b0b0b0` |
| Steam Vent inactive / warning / active | `^` | `#704020` / `#ff9040` / `#ffe0a0` on background `#5a2a10` |
| Pendulum Sweep inactive / warning / active | `~` | `#404050` / `#a0a0ff` / `#ffffff` on background `#404070` |
| Scrap | `%` | the enemy's color at 45% |
| Melee weapon / ranged weapon | `)` / `}` | item's color |
| Plating / attachment | `[` / `*` | item's color |
| Instant / throwable consumable | `!` / `{` | item's color |
| Record (journal page, blueprint) | `?` | `#ffffff` |
| Enemies | letters per `22` | per `22` |
| Aurelie's chair / Escapement wheel | `h` / `O` | `#a08060` / `#c0c0c0` |
| Look/target cursor | inverts the cell (swap fg/bg) | |

Every enemy in `22` uses a distinct letter; bosses use uppercase.

## UI-08 Palette

The fixed palette. Later docs choose colors from this list by name.

| Name | Hex | Name | Hex |
|---|---|---|---|
| bg | `#0c0c10` | brass | `#ffd75f` |
| bgPanel | `#14141a` | copper | `#c87850` |
| dimGrey | `#3a3a44` | silver | `#d0d0d0` |
| midGrey | `#707070` | steel | `#8fb0c0` |
| lightGrey | `#c8c8c8` | rust | `#a0522d` |
| white | `#ffffff` | oil | `#5050a0` |
| red | `#ff6060` | green | `#60e060` |
| orange | `#ff9040` | blue | `#60c0ff` |
| yellow | `#ffd75f` | violet | `#c0a0ff` |
| teal | `#5ad0ff` | pink | `#ff80c0` |
| iron | `#9a9aa0` | lime | `#a0e060` |
| telegraph | `#ffffff` on background `#602020` | gold | `#e0b040` |

## UI-09 Drawing rules

1. Visible tiles: terrain glyph and color; then item (if any); then scrap is drawn under items;
   then actor (Tick or enemy) on top.
2. Remembered (not visible) tiles: terrain and last-seen item at **45% brightness** (each RGB channel
   × 0.45, rounded). Enemies are not drawn.
3. Unseen tiles: blank (`bg`).
4. **Telegraph:** an enemy that is winding up (`ENM-06`) is drawn with the `telegraph` colors instead
   of its own.
5. **Burning** actors: background `#5a2a10`. **Stunned**: glyph drawn in `midGrey`. Other statuses have
   no map indication (the inspect line has them).
5b. **Overwound** enemies (`ENM-12`) keep their own glyph and colour and are drawn on background
   `#3a3210` (dark gold). A Burning or telegraphing Overwound enemy shows that instead: the states
   that change what it is about to do win over the one that says what it is.
6. **Flash:** when Tick takes damage, the whole map's background becomes `#3a1010` for one frame
   (≈ 80 ms), then restores. When an enemy is hit, its cell background flashes `#404040` for one
   frame. These are the only animations.
7. When the mouse hovers a visible enemy, Tick's path to it (from click-to-move, UI-13) is not drawn;
   nothing is drawn on the map for hover except the inspect line.

## UI-10 Keyboard — Run screen

| Key(s) | Action (`CMB-05`) |
|---|---|
| Arrow keys; numpad `1 2 3 4 6 7 8 9`; `h j k l y u b n` | Move in the 8 directions (`y` ↖ `k` ↑ `u` ↗ `h` ← `l` → `b` ↙ `j` ↓ `n` ↘) |
| `.`, numpad `5`, `z` | Wait |
| `g`, `,` | Pick up |
| `e` | Interact (station / stairs) |
| `<` | Ascend (only on stairs) |
| `c` then a direction key | Close door (Esc cancels; free) |
| `f` | Fire ranged weapon → targeting (UI-12) |
| `t` | Throw → choose a throwable from a letter list, then targeting |
| `1` `2` `3` `4` | Use active skill in that slot (targeted skills enter targeting) |
| `i` | Inventory screen |
| `s` | Skills screen |
| `r` | Journal (read) screen |
| `x` | Look mode (UI-12) |
| `m` | Message history screen |
| `?` | Help screen |
| `Esc` | Cancel any mode/prompt; on the plain Run screen opens the Pause menu (UI-18) |
| `Shift` + direction | Repeat Move in that direction until something interesting happens (auto-run: stops when an enemy is visible, Tick is damaged, an item or feature is on the tile, or the move fails) — each step is a turn |

All keys are case-sensitive letters as shown; `?` and `<` are typed as on a US keyboard. Number keys
`1–4` for skills conflict with numpad movement only when NumLock is off; the builder distinguishes
`Numpad1` from `Digit1` by key code.

## UI-11 Inspect popup

Right-click on a map cell, or `Enter` in look mode, opens a popup box (40 cells wide, as tall as its
content needs up to the height of the map region, positioned to not cover the cell, preferring the
side away from it) with the full information for the top-most thing on that cell, per `ENM-11` /
`ITM-05` / hazard fields. The box must never be shorter than its content: an enemy popup is eleven
rows for most of the bestiary and thirteen for an Overwound one. `Esc`, right-click again, or any move
key closes it. Free action. Hovering a side-panel stat shows its breakdown (`CHR-08`, `CHR-11`) in the
same popup style.

## UI-12 Look mode and targeting mode

- **Look mode** (`x`): a cursor starts on Tick; direction keys move it 1 cell (Shift + direction: 5
  cells); the inspect line follows the cursor; `Enter` opens the popup; `Esc` exits. Mouse hover also
  moves the cursor. Free.
- **Targeting mode** (from Fire, Throw, or a targeted skill): like look mode but the cursor starts on
  the nearest visible enemy (Chebyshev; ties: reading order) or on Tick if none; `Tab` / `Shift+Tab`
  cycle through visible enemies by distance; the line of fire (`CMB-08`) is drawn by inverting the
  cells along it, in red if the shot would stop early; `Enter` or the same key that opened targeting
  confirms; `Esc` cancels with no turn spent. Left-click on a cell confirms that cell; right-click
  cancels. Confirming an out-of-range or out-of-FOV cell does nothing (the inspect line says why).

## UI-13 Mouse — Run screen

| Input | Where | Effect |
|---|---|---|
| Hover | Map / panel | Updates the inspect line (UI-05) |
| Left-click | Visible enemy, adjacent | Melee Attack |
| Left-click | Visible enemy, not adjacent | **Travel** toward it (see below) |
| Left-click | Walkable visible or remembered tile | **Travel** to it |
| Left-click | Tick's own tile | Pick up if an item is here; else Interact if a feature is here; else Wait |
| Left-click | Stairs tile while standing on it | Ascend |
| Left-click | Closed door adjacent | Open it (a Move into it) |
| Right-click | Any map cell | Inspect popup |
| Left-click | Panel row 18–21 | Use that skill |
| Left-click | Panel rows 22–23 tokens | Open Inventory / Skills / Journal / History / Help |
| Left-click | Log rows | Open Message History |
| Wheel | Anywhere | In Message History: scroll; elsewhere nothing |

**Travel:** compute the path from Tick to the target using `ENM-08`'s A* with Tick's passability
(closed doors passable — they are opened on bump; hazards avoided unless no other path; enemies
impassable). Take one step per turn, running the full turn loop each step, and **stop** when: the
destination is reached; a step fails; an enemy becomes visible that was not visible when the travel
started; Tick takes damage; Tension crosses 30 or 15; an item or feature is on the current tile; or the
player presses any key or clicks. A step that opens a closed door is a successful step (Tick stays put
and continues with the next step). Clicking an enemy travels to the nearest tile adjacent to it and then
stops (it does not attack automatically).

## UI-14 Inventory screen

Overlays the map area (cols 0–59) with a box; the panel and log stay visible.

```
 INVENTORY                                     (i / Esc to close)
 a) Solder ×2            ! +15 Integrity
 b) Brass Plating        [ plating 2  evasion −2
 ...
 EQUIPPED
 W) Wrench               ) 1d4+1
 P) —
 A) —

 [e]quip/unequip  [u]se  [t]hrow  [d]rop      ↑↓ or letter to select
```

- Select with letters `a–j` (inventory) or `W`/`P`/`A` (equipped), or arrow keys, or click.
- Actions (`ITM-07`): `e` equip (or unequip when an equipped item is selected), `u` use, `t` throw,
  `d` drop. Actions that don't apply to the selected item are drawn in `midGrey` and do nothing.
- Selected line is inverted. Hovering or selecting shows the full item info in the inspect line.
- Buttons at the bottom are clickable.

## UI-15 Skills screen and Journal screen

**Skills** (`s`): three columns, one per discipline, headers in the discipline color (Armature `copper`,
Tinkering `green`, Resonance `violet`). Each rank line: `n. Name` with state: taken (bright),
available (white, marked `▸`), locked (`midGrey`). The header line shows `Skill points: n`. Select with
arrows/click; `Enter` or click takes an available skill (confirmation prompt: "Take *Name*? y/n").
The selected skill's full text (`20`) shows in a box below the columns. `Esc`/`s` closes.

**Journal** (`r`): list `Page 1 … Page 8` with found ones bright and unfound as `— not found —`, plus
`Blueprint` if found. `Enter`/click opens the page text (`24`) in a scrollable box; `Esc` back. Reading
is free.

The list cursor belongs to the run, not to the screen: reopening the Journal comes back to the page
last selected rather than to `Page 1`, and **finding a page moves the cursor to it** (`ITM-03`), so
the Journal opens on the page just picked up. When the cursor would point past the end of a shorter
list — the `Blueprint` row is only there once it is found — it is clamped to the last row. The
ending sequence's page-8 view (`SCR-07`) is not the list and does not move the cursor.

## UI-16 Message History, Help, and text boxes

- **Message History** (`m` / click log): full-screen scrollable list of the last 500 log lines this run (`TEC-05`),
  newest at the bottom; wheel/arrows/PageUp/PageDown scroll; `Esc` closes.
- **Help** (`?`): full-screen static list of every key in UI-10, UI-12, UI-14, and a 6-line summary of
  the core rules (Tension decay, no regen, stations, permadeath). Text in `24`.
- **Text box** (scripted moments, boss lines marked "text box" in `STY-06`): a centered box over the
  map, max 56 × 20 cells, with the text and `— any key —`. Text longer than the box scrolls with
  arrows/wheel and shows `— more —` on the last line until the end is reached. Dismissed by any
  key or click. The game does
  not advance while it is open.

## UI-17 Title, Death, Victory, Ending-choice screens

- **Title:** the title `CLOCKWORK HOLLOW` in brass, the tagline (`24`), and a vertical menu:
  `New run`, `Continue` (only if an autosave exists; shows "Floor N, turn T"), `Enter seed`, `Help`.
  Arrows/Enter or click. `Enter seed` shows a one-line text input (up to 16 characters, any
  printable); confirming starts a new run with that seed (`TEC-07`). Starting a new run while an
  autosave exists asks "Abandon the saved run? y/n" — a new run deletes it.
- **Intro:** a text box with the intro text (`24`) shown once at the start of a new run, before floor 1
  is displayed.
- **Ending choice:** a text box with the setup text and two options `A) Wind the tower` /
  `B) Wind yourself`, selected by `a`/`b`, arrows + Enter, or click. No cancel. Then the ending text
  box(es) (`24`), then the Victory screen.
- **Death / Victory:** full-screen summary per `STY-08`: header line (`TICK WAS BROKEN` /
  `TICK WOUND DOWN` / `THE KEEPER` / `THE WALKER`), the flavor line, then a two-column table of run
  statistics, the skill list in order, final equipment, `Journal pages: n/8`, `Seed: xxxx`, and
  `— Esc or Enter to return to the title —`. **Only `Esc` and `Enter` dismiss it**, and input is
  ignored for the first 500 ms so the keystroke that ended the run cannot throw the summary away
  before it is read; a click also dismisses it, after the same 500 ms, because `UI-13` promises the
  mouse alone is enough to play. The seed is selectable text (rendered also as a hidden DOM input
  for copy, `TEC-12`).

## UI-18 Pause menu

`Esc` on the Run screen: a small box with `Resume`, `Help`, `Quit to title` (the autosave remains;
Continue resumes it). No "save and quit" — saving is automatic.

## UI-19 Screen transition table

| From | Input | To |
|---|---|---|
| Title | New run / seed confirmed | Intro text box → Run (floor 1) |
| Title | Continue | Run (restored) |
| Run | `i` `s` `r` `m` `?` `x` `Esc` | Inventory / Skills / Journal / History / Help / Look / Pause |
| Any overlay | `Esc` (or its own key) | Run |
| Run | Level-up (`CHR-07`) | Skills (auto) |
| Run | Scripted trigger (`STY-05`) | Text box → Run |
| Run | Understudy defeated | Text box (line 4) → Text box (thought 3) → Ending choice → Journal page 8 → (B only: descent lines) → Ending text → Victory |
| Run | Tick dies | Death |
| Death / Victory | `Esc` or `Enter` (or a click), after the 500 ms grace of `UI-17` | Title |
| Pause | Quit to title | Title |

## UI-20 Accessibility and sizing

- Minimum supported window: 800 × 450 CSS pixels; the grid scales down to fit and up to fill,
  integer-scaled when possible.
- All information conveyed by color is also conveyed by text (inspect line, panel numbers, log). The
  telegraph state additionally appears in the inspect line as `winding up`.
- No input relies on holding keys except Shift-run, which has a keyboard-only alternative (repeating
  the move key).
