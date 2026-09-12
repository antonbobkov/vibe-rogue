// The Message History screen (UI-16): "full-screen scrollable list of the last 500 log lines this
// run (`TEC-05`), newest at the bottom; wheel/arrows/PageUp/PageDown scroll; `Esc` closes."
//
// The lines are the same rendered lines the log rows show — merged lines carry their `(×n)`
// suffix (UI-04) and wrap at 80 with continuation lines indented two spaces.

import { COLS, ROWS, BG, write, writeMarkup, fillRect, center } from '../render.js';
import { scrollIntent } from '../input.js';
import * as log from '../log.js';
import { wrapLogLine } from './run.js';

export const FIRST_ROW = 1;
export const FOOTER_ROW = ROWS - 1;
export const VISIBLE_ROWS = FOOTER_ROW - FIRST_ROW;

/** Every log line of the run, wrapped, oldest first — the order UI-16 shows them in. */
export function historyRows(lines) {
  const out = [];
  for (const line of lines) {
    for (const part of wrapLogLine(log.renderLine(line))) out.push({ text: part, color: line.color });
  }
  return out;
}

export function createHistoryScreen(app) {
  const rows = historyRows(app.game.state.log);
  const maxScroll = Math.max(0, rows.length - VISIBLE_ROWS);
  // UI-16: "newest at the bottom" — the screen opens at the end of the list.
  let scroll = maxScroll;

  function close() {
    app.pop();
    return true;
  }

  const screen = {
    id: 'history',
    opaque: true,
    free: true,

    draw(buf) {
      write(buf, 1, 0, 'MESSAGES', 'brass', BG, 20);
      write(buf, COLS - 21, 0, '(m / Esc to close)', 'midGrey', BG, 20);
      // `writeMarkup` stops at the visible width and never draws the markers themselves, so a
       // scripted line's `*emphasis*` renders as emphasis here too (UI-04).
      fillRect(buf, 0, FIRST_ROW, COLS, VISIBLE_ROWS, ' ', 'lightGrey', BG);
      for (let i = 0; i < VISIBLE_ROWS; i++) {
        const row = rows[scroll + i];
        if (!row) break;
        writeMarkup(buf, 0, FIRST_ROW + i, row.text, row.color, BG, COLS);
      }
      if (scroll > 0) write(buf, 0, FOOTER_ROW, center('— more above —', COLS), 'midGrey', BG, COLS);
    },

    onKey(ev) {
      if (ev.key === 'Escape' || ev.key === 'm') return close();
      const intent = scrollIntent(ev);
      if (!intent) return true;
      if (intent.to === 'start') scroll = 0;
      else if (intent.to === 'end') scroll = maxScroll;
      else scroll += intent.page ? intent.page * VISIBLE_ROWS : intent.delta;
      scroll = Math.max(0, Math.min(maxScroll, scroll));
      app.markDirty();
      return true;
    },

    onMouse() {
      return close();
    },

    onWheel(ev) {
      scroll = Math.max(0, Math.min(maxScroll, scroll + ev.delta));
      app.markDirty();
    },

    /** For the tests: how many rendered lines the history holds (UI-16, ACC-113). */
    get rowCount() {
      return rows.length;
    },
  };

  return screen;
}
