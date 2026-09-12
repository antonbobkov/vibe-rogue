// The Title screen (UI-17, SCR-01): the title, the tagline, the menu, the seed input
// and the Abandon prompt.
//
// It replaces the stack (TEC-06) and is the only screen that exists before a run does, so every
// read of the game state here goes through the save store rather than through `app.game`.

import { COLS, BG, BG_PANEL, box, center, write } from '../render.js';
import { listIntent, seedChar, yesNo } from '../input.js';
import { SCRIPT } from '../../data/script.js';

/** Where UI-17's three blocks sit in the 80 x 30 grid. */
export const TITLE_ROW = 6;
export const TAGLINE_ROW = 9;
export const MENU_ROW = 15;

/** TEC-07 / UI-17: "a one-line text input (up to 16 characters, any printable)". */
export const SEED_MAX = 16;

/** The menu entries of SCR-01, by the action they take. */
export const ENTRY_IDS = Object.freeze(['newRun', 'continue', 'seed', 'help']);

/** SCR-01's `Floor {N}, turn {T}` subtitle, filled from the save. */
export function continueSubtitle(saved) {
  if (!saved) return '';
  return SCRIPT.continueSubtitle
    .replace('{N}', String(saved.floorNumber))
    .replace('{T}', String(saved.turn));
}

/**
 * The Title screen.
 *
 * @param {object} app the `main.js` application
 */
export function createTitleScreen(app) {
  /** `menu` | `seed` | `abandon` (UI-17's two prompts). */
  let mode = 'menu';
  let selected = 0;
  let seedText = '';
  /** What the Abandon prompt is guarding: a plain New run, or a run with a typed seed. */
  let pendingSeed = null;

  app.hideSeedInput();

  function saved() {
    return app.store.has() ? app.store.load() : null;
  }

  /** The entries actually offered: Continue only when an autosave exists (UI-17). */
  function entries() {
    const has = app.store.has();
    const out = [];
    ENTRY_IDS.forEach((id, i) => {
      if (id === 'continue' && !has) return;
      out.push({ id, label: SCRIPT.menu[i] });
    });
    return out;
  }

  function clampSelection() {
    const n = entries().length;
    if (selected >= n) selected = n - 1;
    if (selected < 0) selected = 0;
  }

  /** UI-17: "Starting a new run while an autosave exists asks 'Abandon the saved run? y/n'". */
  function start(seed) {
    if (app.store.has()) {
      pendingSeed = seed;
      mode = 'abandon';
      app.markDirty();
      return true;
    }
    app.newRun(seed);
    return true;
  }

  function choose(id) {
    switch (id) {
      case 'newRun':
        return start(null);
      case 'continue':
        app.continueRun();
        return true;
      case 'seed':
        mode = 'seed';
        seedText = '';
        app.markDirty();
        return true;
      case 'help':
        app.push(app.screens.help());
        return true;
      default:
        return false;
    }
  }

  const screen = {
    id: 'title',
    opaque: true,
    free: true,

    draw(buf) {
      clampSelection();
      write(buf, 0, TITLE_ROW, center(SCRIPT.title, COLS), 'brass', BG, COLS);
      SCRIPT.tagline.forEach((line, i) => {
        write(buf, 0, TAGLINE_ROW + i, center(line, COLS), 'lightGrey', BG, COLS);
      });

      const list = entries();
      const subtitle = continueSubtitle(saved());
      list.forEach((entry, i) => {
        const label = entry.id === 'continue' && subtitle ? `${entry.label}  (${subtitle})` : entry.label;
        const chosen = mode === 'menu' && i === selected;
        const text = chosen ? `▸ ${label}` : `  ${label}`;
        write(buf, 0, MENU_ROW + i, center(text, COLS), chosen ? 'brass' : 'lightGrey', BG, COLS);
      });

      if (mode === 'seed') {
        const prompt = `${SCRIPT.seedPrompt} ${seedText}_`;
        write(buf, 0, MENU_ROW + list.length + 2, center(prompt, COLS), 'white', BG, COLS);
      }
      if (mode === 'abandon') {
        const w = SCRIPT.abandonPrompt.length + 6;
        const inner = box(buf, Math.floor((COLS - w) / 2), MENU_ROW + list.length + 1, w, 3, 'yellow', BG_PANEL);
        write(buf, inner.x, inner.y, center(SCRIPT.abandonPrompt, inner.w), 'yellow', BG_PANEL, inner.w);
      }
    },

    onKey(ev) {
      if (mode === 'abandon') {
        const answer = yesNo(ev);
        if (answer === null) return true;
        if (answer) {
          // UI-17 / TEC-09: "a new run deletes it".
          app.store.clear();
          app.newRun(pendingSeed);
          return true;
        }
        // ACC-04: answering `n` leaves the save alone and stays on the Title.
        mode = 'menu';
        pendingSeed = null;
        app.markDirty();
        return true;
      }

      if (mode === 'seed') {
        if (ev.key === 'Escape') {
          mode = 'menu';
          app.markDirty();
          return true;
        }
        if (ev.key === 'Enter') {
          mode = 'menu';
          return start(seedText);
        }
        if (ev.key === 'Backspace') {
          seedText = seedText.slice(0, -1);
          app.markDirty();
          return true;
        }
        const ch = seedChar(ev);
        if (ch !== null && seedText.length < SEED_MAX) {
          seedText += ch;
          app.markDirty();
        }
        return true;
      }

      const intent = listIntent(ev);
      if (!intent) return false;
      const list = entries();
      switch (intent.type) {
        case 'moveSelection':
          if (intent.axis === 'x') return true;
          selected = (selected + intent.delta + list.length) % list.length;
          app.markDirty();
          return true;
        case 'confirm':
          return choose(list[selected].id);
        case 'letter':
          // `?` opens Help from the Title too, which is where UI-17 puts it in the menu.
          if (ev.key === '?') return choose('help');
          return true;
        default:
          return true;
      }
    },

    onMouse(ev) {
      if (!ev.cell) return false;
      if (mode !== 'menu') return true;
      const list = entries();
      const row = ev.cell.y - MENU_ROW;
      if (row < 0 || row >= list.length) return true;
      selected = row;
      return choose(list[row].id);
    },

    /** For the tests: which prompt is open (UI-17). */
    get mode() {
      return mode;
    },
  };

  return screen;
}

