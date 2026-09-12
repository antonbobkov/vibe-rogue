// The Run screen: the map, the side panel, the inspect line and the log (UI-02..UI-06), plus the
// Run screen's own keyboard and mouse tables (UI-10, UI-13).
//
// This is the base of the screen stack during a run (TEC-06). One of the DOM-allowed modules
// (PLN-02 R2); it draws into the cell buffer and never touches the canvas itself.

import {
  COLS, ROWS, MAP_W, MAP_H, PANEL_X, PANEL_TEXT_X, PANEL_W, INSPECT_ROW, LOG_ROW, LOG_ROWS,
  BG, BG_PANEL, drawMap, drawSeparator, put, write, writeMarkup, balanceMarkup, fillRect, twoColumn, fit, pad, box,
} from '../render.js';
import { idx, chebyshev } from '../grid.js';
import { TILE } from '../tiles.js';
import { HAZARDS } from '../tiles.js';
import { derive, TENSION_MAX } from '../actors.js';
import { itemDef, itemAt, slotLetter, displayName, entryName, entryWear, platingOf } from '../items.js';
import { activeSlotRows } from '../skills.js';
import * as log from '../log.js';
import * as combat from '../combat.js';
import { runIntent, clickTarget, regionOf, REGION } from '../input.js';
import { inspectLine } from './inspect.js';
import { turnsUntilWanderer } from '../wander.js';

/** UI-03: the integrity and tension bars are 19 cells — `[` + 17 fill cells + `]`. */
export const BAR_CELLS = 17;

/** UI-06's bar colors. */
export function tensionColor(tension) {
  if (tension > 30) return 'green';
  if (tension > 15) return 'yellow';
  return 'red';
}

export function integrityColor(cur, max) {
  const pct = max > 0 ? (100 * cur) / max : 0;
  if (pct > 50) return 'blue';
  if (pct > 25) return 'yellow';
  return 'red';
}

/** UI-03: "fill count = `round(17 × cur / max)`". */
export function barText(cur, max) {
  const fill = max > 0 ? Math.round((BAR_CELLS * Math.max(0, cur)) / max) : 0;
  const n = Math.max(0, Math.min(BAR_CELLS, fill));
  return { fill: n, text: `[${'#'.repeat(n)}${' '.repeat(BAR_CELLS - n)}]` };
}

/**
 * UI-03 row 15: the status abbreviations, plus `Gua` for the Flywheel Guard and `Solder` for a
 * running DIF-03 repair. Neither of those two is one of CMB-10's five, and neither is removable.
 */
export function panelStatuses(tick) {
  const parts = [];
  for (const name of Object.keys(tick.statuses || {})) {
    const n = tick.statuses[name];
    if (n > 0) parts.push(`${name.slice(0, 3)}(${n})`);
  }
  if (tick.guardTimer > 0) parts.push(`Gua(${tick.guardTimer})`);
  if (tick.repair && tick.repair.turnsLeft > 0) parts.push(`Solder(${tick.repair.turnsLeft})`);
  return parts.length === 0 ? '—' : parts.join(', ');
}

/**
 * UI-03 row 16 / UI-06: the countdown to the floor's cyclic hazard; with no cyclic hazard, WLD-14's
 * countdown to the next wanderer (DIF-06), so the pressure is legible rather than a surprise.
 */
export function hazardRow(floor, state) {
  const cycle = floor.hazardCycle;
  if (!cycle) {
    const next = state ? turnsUntilWanderer(state) : null;
    if (next === null) return { text: '', color: 'lightGrey' };
    return { text: `next: ${next}`, color: 'lightGrey' };
  }
  if (cycle.active) {
    const bright = cycle.kind === 'STEAM_VENT' ? '#ffe0a0' : '#ffffff';
    return { text: 'ACTIVE', color: bright };
  }
  const noun = cycle.kind === 'STEAM_VENT' ? 'vents' : 'pendulum';
  return { text: `${noun} in ${cycle.turnsUntilActive}`, color: 'lightGrey' };
}

/**
 * UI-04's log rows: the newest five *rendered* lines, wrapped at 80 with continuation lines
 * indented two spaces, newest at the bottom.
 *
 * @param {object[]} lines `state.log`
 * @returns {{text: string, color: string}[]} at most five rows, oldest first
 */
export function logRows(lines) {
  const rows = [];
  for (const line of lines.slice(-LOG_ROWS * 3)) {
    const text = log.renderLine(line);
    const wrapped = wrapLogLine(text);
    for (const part of wrapped) rows.push({ text: part, color: line.color });
  }
  return rows.slice(-LOG_ROWS);
}

/**
 * Greedy wrap at 80 columns; continuation lines are indented two spaces (UI-04).
 *
 * Widths are *visible* widths: an `*emphasis*` marker is drawn by `writeMarkup` as a colour change
 * rather than as a character, so it must not consume a column here either. Markers stay attached to
 * the word they wrap, which is all the re-insertion this needs — unlike `wrapMarkup`, which strips
 * them and puts them back, and could not account for this wrap's two-space continuation indent.
 */
export function wrapLogLine(text) {
  const vis = (s) => s.split('*').join('').length;
  if (vis(text) <= COLS) return [text];
  const out = [];
  const words = text.split(' ');
  let line = '';
  let indent = '';
  for (const word of words) {
    const width = COLS - indent.length;
    if (vis(line) === 0) {
      line = vis(word) > width ? word.slice(0, width) : word;
      if (vis(word) > width) {
        out.push(indent + line);
        line = '';
        indent = '  ';
        // Push the remainder as its own words on the next pass.
        let rest = word.slice(width);
        while (rest.length > COLS - 2) {
          out.push(`  ${rest.slice(0, COLS - 2)}`);
          rest = rest.slice(COLS - 2);
        }
        line = rest;
      }
      continue;
    }
    if (vis(line) + 1 + vis(word) <= width) {
      line += ` ${word}`;
      continue;
    }
    out.push(indent + line);
    indent = '  ';
    line = word;
  }
  if (vis(line) > 0) out.push(indent + line);
  // A span that survives the wrap has to be closed and reopened, or `writeMarkup` — which is called
  // once per line and keeps no state — renders the continuation inverted.
  return balanceMarkup(out);
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

/** UI-03: the 24 side-panel rows, cols 61-79. */
export function drawPanel(buf, game) {
  const state = game.state;
  const tick = state.tick;
  const floor = state.floor;
  const d = derive(tick, state.tuning);
  const X = PANEL_TEXT_X;
  const w = PANEL_W;

  fillRect(buf, PANEL_X, 0, COLS - PANEL_X, MAP_H, ' ', 'lightGrey', BG);
  drawSeparator(buf);

  // Row 0 — TICK and either the level or the unspent skill points.
  const badge = tick.skillPoints > 0 ? `SP:${tick.skillPoints}` : `Lv ${tick.level}`;
  write(buf, X, 0, pad('TICK', w), 'lightGrey', BG, w);
  write(buf, X + w - badge.length, 0, badge, tick.skillPoints > 0 ? 'yellow' : 'lightGrey', BG, badge.length);

  // Rows 1-2 — Integrity and its bar.
  write(buf, X, 1, twoColumn('INTEGRITY', `${tick.integrity}/${tick.integrityMax}`, w), 'lightGrey', BG, w);
  drawBar(buf, X, 2, tick.integrity, tick.integrityMax, integrityColor(tick.integrity, tick.integrityMax));

  // Rows 3-4 — Tension and its bar.
  write(buf, X, 3, twoColumn('TENSION', `${tick.tension}/${TENSION_MAX}`, w), 'lightGrey', BG, w);
  drawBar(buf, X, 4, tick.tension, TENSION_MAX, tensionColor(tick.tension));

  // Row 5 — the floor number and the floor's short name (FLR-01).
  write(buf, X, 5, twoColumn(`Floor ${state.floorNumber}`, floor.shortName || '', w), 'lightGrey', BG, w);

  // Row 6 — the turn and the turns until the next Tension decay (CHR-11).
  const decay = Math.max(0, d.decayPeriod - tick.decayCounter);
  write(buf, X, 6, twoColumn(`Turn ${state.turn}`, `decay:${decay}`, w), 'lightGrey', BG, w);

  // Row 8 — the three attributes (CHR-08).
  write(buf, X, 8, pad(`FRC ${d.force}  PRC ${d.precision}  PLT ${d.plating}`, w), 'lightGrey', BG, w);
  // Row 9 — accuracy base and evasion.
  write(buf, X, 9, pad(`ACC ${d.accuracy}%  EVA ${d.evasion}`, w), 'lightGrey', BG, w);

  // Rows 11-13 — equipment.
  write(buf, X, 11, `W ${fit(displayName(tick.equipment.weapon) || '—', w - 2)}`, 'lightGrey', BG, w);
  write(buf, X, 12, `P ${fit(displayName(tick.equipment.plating) || '—', w - 2)}`, 'lightGrey', BG, w);
  write(buf, X, 13, `A ${fit(displayName(tick.equipment.attachment) || '—', w - 2)}`, 'lightGrey', BG, w);

  // Row 15 — statuses.
  write(buf, X, 15, fit(panelStatuses(tick), w), 'lightGrey', BG, w);

  // Row 16 — the cyclic hazard countdown, or WLD-14's wanderer countdown.
  const haz = hazardRow(floor, state);
  write(buf, X, 16, fit(haz.text, w), haz.color, BG, w);

  // Rows 18-21 — the four active-skill hotkeys.
  const rows = activeSlotRows(tick);
  for (let i = 0; i < 4; i++) {
    const row = rows[i];
    if (!row) continue;
    const right = row.used ? '(used)' : String(row.cost);
    const text = twoColumn(`${row.slot} ${row.name}`, right, w);
    write(buf, X, 18 + i, text, row.used ? 'midGrey' : 'lightGrey', BG, w);
  }

  // Rows 22-23 — the clickable buttons (UI-13).
  write(buf, X, 22, '[i]nv  [s]kills', 'steel', BG, w);
  write(buf, X, 23, '[r]ead  [m]sg  [?]', 'steel', BG, w);
}

function drawBar(buf, x, y, cur, max, color) {
  const bar = barText(cur, max);
  put(buf, x, y, '[', 'dimGrey', BG);
  for (let i = 0; i < BAR_CELLS; i++) {
    put(buf, x + 1 + i, y, i < bar.fill ? '#' : ' ', color, BG);
  }
  put(buf, x + 1 + BAR_CELLS, y, ']', 'dimGrey', BG);
}

/** UI-05: row 24, the whole width, on `#14141a`. */
export function drawInspect(buf, text) {
  fillRect(buf, 0, INSPECT_ROW, COLS, 1, ' ', 'lightGrey', BG_PANEL);
  write(buf, 0, INSPECT_ROW, fit(text || '', COLS), 'lightGrey', BG_PANEL, COLS);
}

/**
 * UI-04: rows 25-29, newest at the bottom.
 *
 * Drawn with `writeMarkup`, so a scripted line carrying `*emphasis*` reads as emphasis rather than
 * as literal asterisks — `SCR-06`'s Understudy lines are the ones that do. `fillRect` has already
 * cleared the rows, so no padding width is needed.
 */
export function drawLog(buf, state) {
  fillRect(buf, 0, LOG_ROW, COLS, LOG_ROWS, ' ', 'lightGrey', BG);
  const rows = logRows(state.log);
  const first = LOG_ROW + (LOG_ROWS - rows.length);
  for (let i = 0; i < rows.length; i++) {
    writeMarkup(buf, 0, first + i, rows[i].text, rows[i].color, BG, COLS);
  }
}

// ---------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------

/**
 * The prompts and refusals the `c`, `t` and `f` keys show. SCR-10 has no template for any of them,
 * so they are inspect-line text rather than log lines (D-090).
 */
export const CLOSE_DOOR_PROMPT = 'Close which door? (direction, Esc cancels)';
export const THROW_PROMPT = 'Throw which? (letter, Esc cancels)';
export const NOTHING_TO_THROW = 'Nothing to throw.';
export const NOTHING_TO_FIRE = 'No ranged weapon equipped.';

/**
 * The Run screen.
 *
 * @param {object} app the `main.js` application: `game`, `hover`, `push`, `pop`, `flash`, timers
 */
export function createRunScreen(app) {
  /** UI-10's `c` prompt and `t` list are the screen's only modes; both are free actions. */
  let mode = null; // null | 'closeDoor' | 'throw'
  /** A one-line refusal on the inspect line, cleared by the next input (D-090). */
  let notice = null;

  function throwables() {
    const tick = app.game.state.tick;
    const out = [];
    tick.inventory.forEach((entry, slot) => {
      if (!entry) return;
      if (itemDef(entry.name).category === 'throwable') out.push({ slot, ...entry });
    });
    return out;
  }

  const screen = {
    id: 'run',
    opaque: true,

    draw(buf) {
      const game = app.game;
      drawMap(buf, game, { flashTick: app.flash.tick, flashCells: app.flash.cells });
      drawPanel(buf, game);
      drawInspect(buf, screen.inspectText());
      drawLog(buf, game.state);
      if (mode === 'throw') drawThrowList(buf, throwables());
    },

    /** UI-05: the hovered cell, the active prompt, or blank. */
    inspectText() {
      if (mode === 'closeDoor') return CLOSE_DOOR_PROMPT;
      if (mode === 'throw') return THROW_PROMPT;
      if (notice) return notice;
      const hover = app.hover;
      if (!hover) return '';
      if (hover.region === REGION.MAP) return inspectLine(app.game, hover.x, hover.y);
      if (hover.region === REGION.PANEL) return panelHoverText(app.game, hover.y);
      return '';
    },

    onKey(ev) {
      if (mode === 'closeDoor') return handleCloseDoor(ev);
      if (mode === 'throw') return handleThrowPick(ev);
      notice = null;
      const intent = runIntent(ev);
      if (!intent) return false;
      return handleIntent(intent);
    },

    onMouse(ev) {
      notice = null;
      if (mode !== null) {
        mode = null;
        app.markDirty();
        return true;
      }
      const target = clickTarget(ev.cell, ev);
      switch (target.kind) {
        case 'inspect':
          app.push(app.screens.inspect({ x: target.x, y: target.y }));
          return true;
        case 'panelStat':
          app.push(app.screens.inspect({ stat: target.stat }));
          return true;
        case 'screen':
          app.openScreen(target.id);
          return true;
        case 'skill':
          return useSkill(target.slot);
        case 'map':
          return clickMap(target.x, target.y);
        default:
          return false;
      }
    },
  };

  function handleIntent(intent) {
    const game = app.game;
    switch (intent.type) {
      case 'move':
        app.act({ type: 'move', dx: intent.dx, dy: intent.dy });
        return true;
      case 'run':
        app.startRun(intent.dx, intent.dy);
        return true;
      case 'wait':
        app.act({ type: 'wait' });
        return true;
      case 'pickup':
        app.act({ type: 'pickup' });
        return true;
      case 'interact':
        app.act({ type: 'interact' });
        return true;
      case 'ascend':
        app.act({ type: 'ascend' });
        return true;
      case 'closeDoor':
        mode = 'closeDoor';
        app.markDirty();
        return true;
      case 'fire':
        return startFire();
      case 'throw':
        return startThrow();
      case 'skill':
        return useSkill(intent.slot);
      case 'screen':
        app.openScreen(intent.id);
        return true;
      case 'look':
        app.push(app.screens.targeting({ mode: 'look' }));
        return true;
      case 'cancel':
        // UI-10: "on the plain Run screen opens the Pause menu".
        app.push(app.screens.pause());
        return true;
      default:
        return false;
    }
  }

  function handleCloseDoor(ev) {
    if (ev.key === 'Escape') {
      mode = null;
      app.markDirty();
      return true;
    }
    const intent = runIntent(ev);
    if (intent && (intent.type === 'move' || intent.type === 'run')) {
      mode = null;
      app.act({ type: 'closeDoor', dx: intent.dx, dy: intent.dy });
      return true;
    }
    return true;
  }

  function handleThrowPick(ev) {
    if (ev.key === 'Escape') {
      mode = null;
      app.markDirty();
      return true;
    }
    const list = throwables();
    const hit = list.find((entry) => slotLetter(entry.slot) === ev.key);
    if (hit) {
      mode = null;
      const def = itemDef(hit.name);
      app.push(app.screens.targeting({
        mode: 'target',
        range: def.range,
        openKey: 't',
        confirm: (x, y) => app.act({ type: 'throw', slot: hit.slot, x, y }),
      }));
      return true;
    }
    return true;
  }

  function startFire() {
    const d = derive(app.game.state.tick);
    if (!d.ranged) {
      // SCR-10 has no template for this refusal, so it stays out of the log (D-052, D-090).
      notice = NOTHING_TO_FIRE;
      app.markDirty();
      return true;
    }
    app.push(app.screens.targeting({
      mode: 'target',
      range: d.ranged.range,
      openKey: 'f',
      confirm: (x, y) => app.act({ type: 'fire', x, y }),
    }));
    return true;
  }

  function startThrow() {
    if (throwables().length === 0) {
      notice = NOTHING_TO_THROW;
      app.markDirty();
      return true;
    }
    mode = 'throw';
    app.markDirty();
    return true;
  }

  /** UI-10 / SKL-01: a targeted skill enters targeting mode first. */
  function useSkill(slot) {
    const tick = app.game.state.tick;
    const name = tick.activeSlots[slot - 1];
    if (!name) return true;
    const def = SKILL_TARGETS[name];
    if (def === 'tile' || def === 'adjacent-free') {
      app.push(app.screens.targeting({
        mode: 'target',
        range: SKILL_RANGE[name] || 6,
        openKey: String(slot),
        adjacentOnly: def === 'adjacent-free',
        confirm: (x, y) => app.act({ type: 'skill', slot, x, y }),
      }));
      return true;
    }
    if (def === 'direction') {
      app.push(app.screens.targeting({
        mode: 'target',
        range: 1,
        adjacentOnly: true,
        openKey: String(slot),
        confirm: (x, y) => app.act({ type: 'skill', slot, dx: x - tick.x, dy: y - tick.y }),
      }));
      return true;
    }
    app.act({ type: 'skill', slot });
    return true;
  }

  /** UI-13's map click table. */
  function clickMap(x, y) {
    const game = app.game;
    const state = game.state;
    const tick = state.tick;
    const visible = game.view().visible.has(idx(x, y));
    const remembered = state.floor.memory[y][x] !== -1;

    if (x === tick.x && y === tick.y) {
      const tile = state.floor.tiles[y][x];
      if (itemAt(state.floor, x, y)) app.act({ type: 'pickup' });
      else if (tile === TILE.STAIRS_UP) app.act({ type: 'ascend' });
      else if (tile === TILE.STATION) app.act({ type: 'interact' });
      else app.act({ type: 'wait' });
      return true;
    }

    const actor = visible ? combat.actorAt(state, x, y) : null;
    if (actor && actor !== tick) {
      if (chebyshev(tick.x, tick.y, x, y) === 1) {
        app.act({ type: 'move', dx: x - tick.x, dy: y - tick.y });
        return true;
      }
      app.startApproach(x, y);
      return true;
    }

    if (!visible && !remembered) return true;
    const tile = visible ? state.floor.tiles[y][x] : state.floor.memory[y][x];
    if (tile === TILE.DOOR_CLOSED && chebyshev(tick.x, tick.y, x, y) === 1) {
      app.act({ type: 'move', dx: x - tick.x, dy: y - tick.y });
      return true;
    }
    app.startTravel(x, y);
    return true;
  }

  return screen;
}

/** SKL-01's `target` field per skill, for UI-10's "targeted skills enter targeting". */
const SKILL_TARGETS = Object.freeze({
  'Overwind Strike': 'direction',
  'Clockwork Decoy': 'adjacent-free',
  Discord: 'tile',
});

const SKILL_RANGE = Object.freeze({ Discord: 6 });

export { SKILL_TARGETS, SKILL_RANGE };

/** UI-11 / CHR-11: what a hovered panel row explains, as one inspect line. */
export function panelHoverText(game, row) {
  const state = game.state;
  const tick = state.tick;
  const d = derive(tick, state.tuning);
  switch (row) {
    case 0:
      return tick.skillPoints > 0
        ? `${tick.skillPoints} unspent skill point${tick.skillPoints === 1 ? '' : 's'} — press s`
        : `Level ${tick.level}  XP ${tick.xp}`;
    case 1:
    case 2:
      return `Integrity ${tick.integrity}/${tick.integrityMax} — it never heals on its own`;
    case 3:
    case 4:
      return `Tension ${tick.tension}/100 — about ${tick.tension * d.decayPeriod} turns of spring left`;
    case 5:
      return `Floor ${state.floorNumber}: ${state.floor.name}`;
    case 6:
      return `Turn ${state.turn} — next decay in ${Math.max(0, d.decayPeriod - tick.decayCounter)} turns`;
    case 8:
      return `Force ${d.force}  Precision ${d.precision}  Plating ${d.plating}`;
    case 9:
      return `Accuracy ${d.accuracy}% melee, ${d.rangedAccuracy}% ranged  Evasion ${d.evasion}`;
    case 11:
      return equipmentText(tick.equipment.weapon, tick);
    case 12:
      return equipmentText(tick.equipment.plating, tick);
    case 13:
      return equipmentText(tick.equipment.attachment, tick);
    case 16: {
      const cycle = state.floor.hazardCycle;
      if (!cycle) {
        const next = turnsUntilWanderer(state);
        return next === null ? '' : `Something arrives on this floor in ${next} turns`;
      }
      const cfg = HAZARDS[cycle.kind];
      return cycle.active
        ? `${cfg.name} — ACTIVE: ${cfg.damage} damage`
        : `${cfg.name} — active in ${cycle.turnsUntilActive} turns: ${cfg.damage} damage`;
    }
    default: {
      if (row >= 18 && row <= 21) {
        const rows = activeSlotRows(tick);
        const entry = rows[row - 18];
        if (!entry) return '';
        return entry.used ? `${entry.name} — spent until the next floor` : `${entry.name} — ${entry.cost} spring`;
      }
      return '';
    }
  }
}

function equipmentText(entry, tick) {
  const name = entryName(entry);
  if (!name) return '—';
  const def = itemDef(name);
  const wear = entryWear(entry);
  // CMB-14: a pitted plate says what it is actually worth now (UI-05, DIF-07).
  const worn = wear > 0 ? `  plating ${def.plating} − ${wear} wear = ${platingOf(entry)}` : '';
  return `${def.name}  ${def.glyph} ${def.description}${worn}`;
}

/** The `t` key's letter list (UI-10: "choose a throwable from a letter list"). */
function drawThrowList(buf, list) {
  const height = Math.min(MAP_H - 2, list.length + 2);
  const width = 34;
  const inner = box(buf, 2, 2, width, height, 'iron', BG_PANEL, 'THROW');
  for (let i = 0; i < list.length && i < inner.h; i++) {
    const entry = list[i];
    const count = entry.count > 1 ? ` ×${entry.count}` : '';
    write(buf, inner.x + 1, inner.y + i, `${slotLetter(entry.slot)}) ${entry.name}${count}`, 'lightGrey', BG_PANEL, inner.w - 1);
  }
}
