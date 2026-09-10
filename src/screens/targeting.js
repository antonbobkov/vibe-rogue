// Look mode and targeting mode (UI-12), and the cursor that UI-07 draws by inverting the cell.
//
// Look mode (`x`): "a cursor starts on Tick; direction keys move it 1 cell (Shift + direction: 5
// cells); the inspect line follows the cursor; `Enter` opens the popup; `Esc` exits. Mouse hover
// also moves the cursor. Free."
//
// Targeting mode: "the cursor starts on the nearest visible enemy (Chebyshev; ties: reading order)
// or on Tick if none; `Tab` / `Shift+Tab` cycle through visible enemies by distance; the line of
// fire (`CMB-08`) is drawn by inverting the cells along it, in red if the shot would stop early;
// `Enter` or the same key that opened targeting confirms; `Esc` cancels with no turn spent.
// Left-click on a cell confirms that cell; right-click cancels. Confirming an out-of-range or
// out-of-FOV cell does nothing (the inspect line says why)."

import { MAP_W, MAP_H, invert, setBg } from '../render.js';
import { idx, chebyshev, readingOrder, bresenham } from '../grid.js';
import { cursorIntent, REGION } from '../input.js';
import * as combat from '../combat.js';
import { inspectLine } from './inspect.js';
import { drawInspect } from './run.js';

/** UI-12's two reasons a confirm does nothing. */
export const OUT_OF_RANGE = 'Out of range.';
export const OUT_OF_SIGHT = 'Not in sight.';

/** UI-12: the nearest visible enemies, by Chebyshev distance, ties in reading order. */
export function visibleEnemies(game) {
  const state = game.state;
  const visible = game.view().visible;
  const tick = state.tick;
  const out = state.floor.enemies.filter((e) => visible.has(idx(e.x, e.y)));
  out.sort((a, b) => {
    const da = chebyshev(tick.x, tick.y, a.x, a.y);
    const db = chebyshev(tick.x, tick.y, b.x, b.y);
    if (da !== db) return da - db;
    return readingOrder(a, b);
  });
  return out;
}

/**
 * Look mode / targeting mode.
 *
 * @param {object} app
 * @param {{mode: 'look'|'target', range?: number, openKey?: string, adjacentOnly?: boolean,
 *          confirm?: (x: number, y: number) => void}} props
 */
export function createTargetingScreen(app, props) {
  const targeting = props.mode === 'target';
  const game = app.game;
  const tick = game.state.tick;
  const range = props.range === undefined ? null : props.range;

  let cursor = { x: tick.x, y: tick.y };
  let cycle = -1;
  let message = '';

  if (targeting) {
    const enemies = visibleEnemies(game);
    if (enemies.length > 0) {
      cursor = { x: enemies[0].x, y: enemies[0].y };
      cycle = 0;
    }
  }

  function inRange(x, y) {
    if (range === null) return true;
    return chebyshev(tick.x, tick.y, x, y) <= range;
  }

  function inSight(x, y) {
    return app.game.view().visible.has(idx(x, y));
  }

  function close() {
    app.pop();
    return true;
  }

  /** The cells the shot would travel through, and whether it stops before the cursor (CMB-08). */
  function lineOfFire() {
    if (!targeting) return null;
    const path = bresenham(tick.x, tick.y, cursor.x, cursor.y);
    const shot = combat.projectile(app.game.state, tick.x, tick.y, cursor.x, cursor.y);
    const stopsEarly = shot.tile.x !== cursor.x || shot.tile.y !== cursor.y;
    return { path, stopsEarly };
  }

  function confirm() {
    if (!targeting) return true;
    if (!inSight(cursor.x, cursor.y)) {
      message = OUT_OF_SIGHT;
      app.markDirty();
      return true;
    }
    if (!inRange(cursor.x, cursor.y)) {
      message = OUT_OF_RANGE;
      app.markDirty();
      return true;
    }
    if (props.adjacentOnly && chebyshev(tick.x, tick.y, cursor.x, cursor.y) !== 1) {
      message = OUT_OF_RANGE;
      app.markDirty();
      return true;
    }
    close();
    if (props.confirm) props.confirm(cursor.x, cursor.y);
    return true;
  }

  function move(dx, dy, step) {
    cursor = {
      x: Math.max(0, Math.min(MAP_W - 1, cursor.x + dx * step)),
      y: Math.max(0, Math.min(MAP_H - 1, cursor.y + dy * step)),
    };
    cycle = -1;
    message = '';
    app.markDirty();
  }

  const screen = {
    id: targeting ? 'targeting' : 'look',
    opaque: false,
    free: true,

    draw(buf) {
      const line = lineOfFire();
      // The cursor is the last tile of the line of fire (TEC-08 includes the end tile), so the
      // cells are collected first and inverted once each — inverting twice would undo it.
      const cells = new Map();
      if (line) {
        for (const p of line.path) cells.set(p.y * MAP_W + p.x, { x: p.x, y: p.y, red: line.stopsEarly });
      }
      cells.set(cursor.y * MAP_W + cursor.x, {
        x: cursor.x,
        y: cursor.y,
        red: line ? line.stopsEarly : false,
      });
      for (const cell of cells.values()) {
        if (cell.x < 0 || cell.y < 0 || cell.x >= MAP_W || cell.y >= MAP_H) continue;
        // UI-07: "Look/target cursor — inverts the cell (swap fg/bg)"; UI-12 says the same of the
        // line of fire, "in red if the shot would stop early".
        invert(buf, cell.x, cell.y);
        if (cell.red) setBg(buf, cell.x, cell.y, 'red');
      }
      drawInspect(buf, screen.inspectText());
    },

    inspectText() {
      if (message) return message;
      return inspectLine(app.game, cursor.x, cursor.y);
    },

    onKey(ev) {
      const intent = cursorIntent(ev, { mode: props.mode, openKey: props.openKey });
      if (!intent) return true;
      switch (intent.type) {
        case 'cancel':
          // UI-12: Esc cancels targeting "with no turn spent".
          return close();
        case 'cursor':
          move(intent.dx, intent.dy, intent.step);
          return true;
        case 'cycle': {
          const enemies = visibleEnemies(app.game);
          if (enemies.length === 0) return true;
          cycle = (cycle + intent.dir + enemies.length) % enemies.length;
          cursor = { x: enemies[cycle].x, y: enemies[cycle].y };
          message = '';
          app.markDirty();
          return true;
        }
        case 'popup':
          app.push(app.screens.inspect({ x: cursor.x, y: cursor.y }));
          return true;
        case 'confirm':
          return confirm();
        default:
          return true;
      }
    },

    /** UI-12: "Mouse hover also moves the cursor." */
    onHover(hover) {
      if (!hover || hover.region !== REGION.MAP) return;
      cursor = { x: hover.x, y: hover.y };
      cycle = -1;
      message = '';
      app.markDirty();
    },

    onMouse(ev) {
      if (!ev.cell) return true;
      if (ev.button === 2) return close();
      if (ev.cell.x >= MAP_W || ev.cell.y >= MAP_H) return true;
      cursor = { x: ev.cell.x, y: ev.cell.y };
      if (!targeting) {
        app.push(app.screens.inspect({ x: cursor.x, y: cursor.y }));
        return true;
      }
      return confirm();
    },

    get cursor() {
      return { x: cursor.x, y: cursor.y };
    },
  };

  return screen;
}
