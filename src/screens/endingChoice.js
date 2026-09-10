// The Ending-choice screen (UI-17, SCR-07).
//
// "a text box with the setup text and two options `A) Wind the tower` / `B) Wind yourself`,
// selected by `a`/`b`, arrows + Enter, or click. No cancel."
//
// One screen, not a text box followed by a choice: the engine emits a single `choice` event that
// carries both the setup text and the option labels (D-071).

import { MAP_W, MAP_H, BG_PANEL, box, write, writeMarkup, wrapMarkup, fit } from '../render.js';
import { listIntent } from '../input.js';

export const BOX_W = 56;
export const BOX_H = 20;

/** PLN-03 `choose`: the option letters, in the order SCR-07 writes them. */
export const OPTIONS = Object.freeze(['A', 'B']);

export function createEndingChoiceScreen(app, props = {}) {
  const labels = props.options && props.options.length === 2 ? props.options : ['A)', 'B)'];
  const lines = wrapMarkup(props.text || '', BOX_W - 4);
  let selected = 0;

  const origin = {
    x: Math.max(0, Math.floor((MAP_W - BOX_W) / 2)),
    y: Math.max(0, Math.floor((MAP_H - BOX_H) / 2)),
  };

  function choose(index) {
    app.pop();
    app.act({ type: 'choose', option: OPTIONS[index] });
    return true;
  }

  const screen = {
    id: 'endingChoice',
    opaque: false,
    blocking: true,
    free: true,

    draw(buf) {
      const inner = box(buf, origin.x, origin.y, BOX_W, BOX_H, 'iron', BG_PANEL);
      const optionRow = origin.y + BOX_H - 4;
      const textRows = optionRow - inner.y - 1;
      for (let i = 0; i < textRows; i++) {
        const line = lines[i];
        if (line === undefined) break;
        writeMarkup(buf, inner.x + 1, inner.y + i, line, 'lightGrey', BG_PANEL, inner.w - 1);
      }
      labels.forEach((label, i) => {
        const chosen = i === selected;
        write(buf, inner.x + 1, optionRow + i, fit(`${chosen ? '▸ ' : '  '}${label}`, inner.w - 1),
          chosen ? 'brass' : 'lightGrey', BG_PANEL, inner.w - 1);
      });
    },

    onKey(ev) {
      if (ev.key === 'a' || ev.key === 'A') return choose(0);
      if (ev.key === 'b' || ev.key === 'B') return choose(1);
      const intent = listIntent(ev);
      // UI-17: "No cancel."
      if (!intent || intent.type === 'cancel') return true;
      if (intent.type === 'moveSelection' && intent.axis !== 'x') {
        selected = (selected + intent.delta + labels.length) % labels.length;
        app.markDirty();
        return true;
      }
      if (intent.type === 'confirm') return choose(selected);
      return true;
    },

    onMouse(ev) {
      if (!ev.cell) return true;
      const optionRow = origin.y + BOX_H - 4;
      const row = ev.cell.y - optionRow;
      if (row < 0 || row >= labels.length) return true;
      return choose(row);
    },

    get selected() {
      return selected;
    },
  };

  return screen;
}
