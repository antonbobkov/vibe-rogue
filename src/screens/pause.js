// The Pause menu (UI-18): "a small box with `Resume`, `Help`, `Quit to title` (the autosave
// remains; Continue resumes it). No 'save and quit' — saving is automatic."
//
// `Quit to title` is TEC-09's one autosave trigger that is not an engine action; `main.js`'s
// `toTitle()` calls `game.autosave()` on the way out.

import { COLS, MAP_H, BG_PANEL, box, write, center } from '../render.js';
import { listIntent } from '../input.js';

/** UI-18's three entries, in order. */
export const ENTRIES = Object.freeze(['Resume', 'Help', 'Quit to title']);

export const BOX_W = 22;
export const BOX_H = ENTRIES.length + 2;

export function createPauseScreen(app) {
  let selected = 0;

  const origin = {
    x: Math.floor((COLS - BOX_W) / 2) - 10,
    y: Math.floor((MAP_H - BOX_H) / 2),
  };

  function choose(index) {
    switch (index) {
      case 0:
        app.pop();
        return true;
      case 1:
        app.push(app.screens.help());
        return true;
      case 2:
        app.toTitle();
        return true;
      default:
        return true;
    }
  }

  const screen = {
    id: 'pause',
    opaque: false,
    free: true,

    draw(buf) {
      const inner = box(buf, origin.x, origin.y, BOX_W, BOX_H, 'iron', BG_PANEL, 'PAUSED');
      ENTRIES.forEach((label, i) => {
        const chosen = i === selected;
        write(buf, inner.x, inner.y + i, center(chosen ? `▸ ${label}` : `  ${label}`, inner.w),
          chosen ? 'brass' : 'lightGrey', BG_PANEL, inner.w);
      });
    },

    onKey(ev) {
      const intent = listIntent(ev);
      if (!intent) return false;
      switch (intent.type) {
        case 'cancel':
          app.pop();
          return true;
        case 'moveSelection':
          if (intent.axis === 'x') return true;
          selected = (selected + intent.delta + ENTRIES.length) % ENTRIES.length;
          app.markDirty();
          return true;
        case 'confirm':
          return choose(selected);
        default:
          return true;
      }
    },

    onMouse(ev) {
      if (!ev.cell) return true;
      const row = ev.cell.y - origin.y - 1;
      const inside = ev.cell.x > origin.x && ev.cell.x < origin.x + BOX_W - 1;
      if (!inside || row < 0 || row >= ENTRIES.length) return true;
      selected = row;
      return choose(row);
    },

    get selected() {
      return selected;
    },
  };

  return screen;
}
