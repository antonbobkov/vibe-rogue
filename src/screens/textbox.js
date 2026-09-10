// The scripted text box (UI-16) and Ending B's descent (SCR-07).
//
// "a centered box over the map, max 56 x 20 cells, with the text and `— any key —`. Text longer
// than the box scrolls with arrows/wheel and shows `— more —` on the last line until the end is
// reached. Dismissed by any key or click. The game does not advance while it is open."
//
// The descent is the same box driven by a 1.5 s timer that `main.js` owns (TEC-11): seven lines,
// one at a time, and any key skips the rest (D-088).

import {
  MAP_W, MAP_H, BG_PANEL, box, write, writeMarkup, wrapMarkup, center,
} from '../render.js';
import { scrollIntent } from '../input.js';

/** UI-16: "max 56 x 20 cells". */
export const BOX_W = 56;
export const BOX_H = 20;

/** UI-16's two footers. */
export const ANY_KEY = '— any key —';
export const MORE = '— more —';

/** The box's top-left corner, centered over the map region (UI-02 cols 0-59, rows 0-23). */
export function boxOrigin(width = BOX_W, height = BOX_H) {
  return {
    x: Math.max(0, Math.floor((MAP_W - width) / 2)),
    y: Math.max(0, Math.floor((MAP_H - height) / 2)),
  };
}

/**
 * A text box.
 *
 * @param {object} app the `main.js` application
 * @param {{id?: string, text?: string, lines?: string[], descent?: boolean,
 *          onDone?: Function}} props
 */
export function createTextboxScreen(app, props = {}) {
  const descent = props.descent === true;
  const source = descent ? (props.lines || []) : wrapMarkup(props.text || '', BOX_W - 4);
  // The last interior row carries the footer, so the text gets one row fewer.
  const textRows = BOX_H - 3;
  let scroll = 0;
  let step = 0;
  let timer = null;
  let done = false;

  const maxScroll = Math.max(0, source.length - textRows);

  function finish() {
    if (done) return true;
    done = true;
    if (timer) {
      app.clearTimer(timer);
      timer = null;
    }
    app.pop();
    if (props.onDone) props.onDone();
    return true;
  }

  /** SCR-07: each descent line is held 1.5 seconds, then the next one replaces it. */
  function scheduleDescent() {
    timer = app.later('descent', app.descentMs, () => {
      timer = null;
      step += 1;
      if (step >= source.length) {
        finish();
        return;
      }
      app.markDirty();
      scheduleDescent();
    });
  }

  if (descent && source.length > 0) scheduleDescent();

  const screen = {
    id: descent ? 'descent' : 'textbox',
    boxId: props.id || null,
    opaque: false,
    blocking: true,
    free: true,

    draw(buf) {
      const at = boxOrigin();
      const inner = box(buf, at.x, at.y, BOX_W, BOX_H, 'iron', BG_PANEL);
      if (descent) {
        // One line at a time, centered in the box.
        const line = source[Math.min(step, source.length - 1)] || '';
        write(buf, inner.x, inner.y + Math.floor((inner.h - 1) / 2), center(line, inner.w), 'lightGrey', BG_PANEL, inner.w);
        write(buf, inner.x, at.y + BOX_H - 2, center(ANY_KEY, inner.w), 'midGrey', BG_PANEL, inner.w);
        return;
      }
      for (let i = 0; i < textRows; i++) {
        const line = source[scroll + i];
        if (line === undefined) break;
        writeMarkup(buf, inner.x + 1, inner.y + i, line, 'lightGrey', BG_PANEL, inner.w - 1);
      }
      const footer = scroll < maxScroll ? MORE : ANY_KEY;
      write(buf, inner.x, at.y + BOX_H - 2, center(footer, inner.w), 'midGrey', BG_PANEL, inner.w);
    },

    /** UI-16: the scroll keys scroll; any other key dismisses (D-087). */
    onKey(ev) {
      if (descent) return finish();
      const intent = scrollIntent(ev);
      if (intent) {
        screen.scrollBy(intent.page ? intent.page * textRows : intent.delta || 0);
        if (intent.to === 'start') scroll = 0;
        if (intent.to === 'end') scroll = maxScroll;
        app.markDirty();
        return true;
      }
      return finish();
    },

    onMouse() {
      return finish();
    },

    onWheel(ev) {
      if (descent) return;
      screen.scrollBy(ev.delta);
      app.markDirty();
    },

    scrollBy(delta) {
      scroll = Math.max(0, Math.min(maxScroll, scroll + delta));
    },

    /** For the tests: how much text is left below the box (UI-16's `— more —`). */
    get scroll() {
      return scroll;
    },
    get maxScroll() {
      return maxScroll;
    },
  };

  return screen;
}
