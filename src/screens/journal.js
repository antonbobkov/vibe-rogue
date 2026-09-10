// The Journal screen (UI-15): "list `Page 1 … Page 8` with found ones bright and unfound as
// `— not found —`, plus `Blueprint` if found. `Enter`/click opens the page text (`24`) in a
// scrollable box; `Esc` back. Reading is free."
//
// The same module serves the `journal` event of the ending sequence (PLN-03): with `{page: 8,
// blocking: true}` it opens straight on that page and calls `onDone` when it is dismissed.

import { COLS, ROWS, BG, BG_PANEL, box, write, fit, center, wrapMarkup, writeMarkup } from '../render.js';
import { listIntent, scrollIntent } from '../input.js';
import { SCRIPT } from '../../data/script.js';
import { FLOORS } from '../../data/floors.js';

export const PAGES = 8;
export const FIRST_ROW = 3;
export const LIST_X = 4;

/** UI-15's placeholder for a page Tick has not found. */
export const NOT_FOUND = '— not found —';

/** SCR-03's header: `Page {n} — {floor name}`. */
export function pageHeader(n) {
  const floor = FLOORS.slice(1).find((f) => f && f.journalPage === n);
  return SCRIPT.pageHeader.replace('{n}', String(n)).replace('{floor name}', floor ? floor.name : '');
}

/**
 * The Journal screen.
 *
 * @param {object} app
 * @param {{page?: number, blocking?: boolean, onDone?: Function}} [props]
 */
export function createJournalScreen(app, props = {}) {
  const blocking = props.blocking === true;
  let mode = props.page ? 'page' : 'list';
  let page = props.page || 1;
  let selected = props.page ? props.page - 1 : 0;
  let scroll = 0;
  let done = false;

  const journal = () => app.game.state.journal;

  /** The list rows: the eight pages, then the Blueprint when it has been found (UI-15). */
  function rows() {
    const out = [];
    for (let n = 1; n <= PAGES; n++) {
      out.push({ kind: 'page', n, found: journal().pages[n - 1] === true, label: `Page ${n}` });
    }
    if (journal().blueprint) out.push({ kind: 'blueprint', label: 'Blueprint', found: true });
    return out;
  }

  function pageLines() {
    const text = SCRIPT.pages[page] || '';
    return wrapMarkup(text, COLS - 8);
  }

  function finish() {
    if (done) return true;
    done = true;
    app.pop();
    if (props.onDone) props.onDone();
    return true;
  }

  function back() {
    if (blocking) return finish();
    if (mode === 'page' && !props.page) {
      mode = 'list';
      scroll = 0;
      app.markDirty();
      return true;
    }
    app.pop();
    return true;
  }

  const screen = {
    id: 'journal',
    opaque: true,
    free: true,
    get blocking() {
      return blocking;
    },

    draw(buf) {
      if (mode === 'page') {
        write(buf, 1, 0, 'JOURNAL', 'brass', BG, 20);
        write(buf, COLS - 21, 0, blocking ? '(any key)' : '(Esc back)', 'midGrey', BG, 20);
        write(buf, 2, 2, fit(pageHeader(page), COLS - 4), 'brass', BG);
        const lines = pageLines();
        const visible = ROWS - 6;
        for (let i = 0; i < visible; i++) {
          const line = lines[scroll + i];
          if (line === undefined) break;
          writeMarkup(buf, 4, 4 + i, line, 'lightGrey', BG, COLS - 8);
        }
        if (scroll + visible < lines.length) {
          write(buf, 0, ROWS - 1, center('— more —', COLS), 'midGrey', BG, COLS);
        }
        return;
      }

      write(buf, 1, 0, 'JOURNAL', 'brass', BG, 20);
      write(buf, COLS - 21, 0, '(r / Esc to close)', 'midGrey', BG, 20);
      const list = rows();
      list.forEach((row, i) => {
        const y = FIRST_ROW + i;
        const text = row.found ? row.label : `${row.label}  ${NOT_FOUND}`;
        const color = row.found ? 'white' : 'midGrey';
        const marker = i === selected ? '▸ ' : '  ';
        write(buf, LIST_X, y, fit(marker + text, COLS - LIST_X - 1), color, BG);
      });
      const chosen = list[selected];
      if (chosen && chosen.found && chosen.kind === 'page') {
        const inner = box(buf, 2, FIRST_ROW + list.length + 1, COLS - 4, 4, 'iron', BG_PANEL);
        write(buf, inner.x, inner.y, fit(pageHeader(chosen.n), inner.w), 'brass', BG_PANEL, inner.w);
        write(buf, inner.x, inner.y + 1, fit('Enter to read.', inner.w), 'midGrey', BG_PANEL, inner.w);
      }
    },

    onKey(ev) {
      if (mode === 'page') {
        const intent = scrollIntent(ev);
        if (intent) {
          const visible = ROWS - 6;
          const max = Math.max(0, pageLines().length - visible);
          if (intent.to === 'start') scroll = 0;
          else if (intent.to === 'end') scroll = max;
          else scroll += intent.page ? intent.page * visible : intent.delta;
          scroll = Math.max(0, Math.min(max, scroll));
          app.markDirty();
          return true;
        }
        // A blocking page view (the ending's page 8) is dismissed by any key (UI-16).
        if (blocking) return finish();
        return back();
      }

      const intent = listIntent(ev);
      if (!intent) return true;
      const list = rows();
      switch (intent.type) {
        case 'cancel':
          return back();
        case 'moveSelection':
          if (intent.axis === 'x') return true;
          selected = (selected + intent.delta + list.length) % list.length;
          app.markDirty();
          return true;
        case 'confirm': {
          const chosen = list[selected];
          if (chosen && chosen.found && chosen.kind === 'page') {
            page = chosen.n;
            mode = 'page';
            scroll = 0;
            app.markDirty();
          }
          return true;
        }
        case 'letter':
          if (ev.key === 'r') return back();
          return true;
        default:
          return true;
      }
    },

    onMouse(ev) {
      if (mode === 'page') {
        if (blocking) return finish();
        return back();
      }
      if (!ev.cell) return true;
      const list = rows();
      const row = ev.cell.y - FIRST_ROW;
      if (row < 0 || row >= list.length) return true;
      selected = row;
      const chosen = list[row];
      if (chosen.found && chosen.kind === 'page') {
        page = chosen.n;
        mode = 'page';
        scroll = 0;
      }
      app.markDirty();
      return true;
    },

    onWheel(ev) {
      if (mode !== 'page') return;
      const visible = ROWS - 6;
      const max = Math.max(0, pageLines().length - visible);
      scroll = Math.max(0, Math.min(max, scroll + ev.delta));
      app.markDirty();
    },

    get mode() {
      return mode;
    },
  };

  return screen;
}
