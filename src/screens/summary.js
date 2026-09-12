// The Death and Victory screens (UI-17, SCR-08, STY-08) and TEC-12's seed copy.
//
// "full-screen summary per `STY-08`: header line (`TICK WAS BROKEN` / `TICK WOUND DOWN` /
// `THE KEEPER` / `THE WALKER`), the flavor line, then a two-column table of run statistics, the
// skill list in order, final equipment, `Journal pages: n/8`, `Seed: xxxx`, and the footer. The
// seed is selectable text (rendered also as a hidden DOM input for copy, `TEC-12`)."
//
// UI-17 used to dismiss this on *any* key, which meant the keystroke that killed you — the last of
// a held direction, or anything already in the buffer — threw the screen away before it could be
// read. It now takes `Esc` or `Enter` only, and ignores everything for `GRACE_MS` after it opens so
// a buffered press cannot dismiss it either. A click still works, because UI-13 promises the mouse
// alone is enough to play, but it waits out the same grace period.
//
// The labels are SCR-08's, verbatim, from `data/script.js` (D-089).

import { COLS, BG, write, center, fit } from '../render.js';
import { SCRIPT } from '../../data/script.js';

/**
 * How long the screen ignores input after it opens (UI-17). Long enough that a keystroke already in
 * flight when the run ended cannot dismiss the summary, short enough not to feel stuck.
 */
export const GRACE_MS = 500;

/** UI-17: the two keys that leave the Death / Victory screen. */
export const LEAVE_KEYS = Object.freeze(['Escape', 'Enter']);

export const HEADER_ROW = 3;
export const FLAVOR_ROW = 5;
export const TABLE_ROW = 8;
export const FOOTER_ROW = 28;

/** Where the two columns of SCR-08's table sit. */
export const LABEL_X = 22;
export const VALUE_X = 42;

const DASH = '—';

/**
 * SCR-08's rows for one summary, in the order its label list writes them. The last two labels are
 * templates that carry their own value (`Journal pages {n}/8`, `Seed {seed}`).
 *
 * @param {object} summary the `death`/`victory` event's `summary` (STY-08 fields)
 * @returns {{label: string, value: string}[]}
 */
export function summaryRows(summary) {
  const s = summary || {};
  const labels = SCRIPT.summaryLabels;
  const skills = Array.isArray(s.skills) ? s.skills : [];
  return [
    { label: labels[0], value: String(s.floor === undefined ? DASH : s.floor) },
    { label: labels[1], value: String(s.turns === undefined ? DASH : s.turns) },
    { label: labels[2], value: String(s.enemiesBroken === undefined ? DASH : s.enemiesBroken) },
    { label: labels[3], value: String(s.level === undefined ? DASH : s.level) },
    { label: labels[4], value: skills.length > 0 ? skills[0] : DASH },
    // STY-08's "skill list in order" continues under the Skills label, one per row.
    ...skills.slice(1).map((name) => ({ label: '', value: name })),
    { label: labels[5], value: s.weapon || DASH },
    { label: labels[6], value: s.plating || DASH },
    { label: labels[7], value: s.attachment || DASH },
    { label: labels[8].replace('{n}', String(s.pages === undefined ? 0 : s.pages)), value: '' },
    { label: labels[9].replace('{seed}', String(s.seed === undefined ? '' : s.seed)), value: '' },
  ];
}

/**
 * The Death / Victory screen.
 *
 * @param {object} app
 * @param {{kind: 'death'|'victory', event: object}} props
 */
export function createSummaryScreen(app, props) {
  const event = props.event || {};
  const rows = summaryRows(event.summary);

  // TEC-12: the seed also goes into the hidden input, selected, so Ctrl+C copies it.
  app.offerSeedForCopy(event.summary ? event.summary.seed : '');

  // The grace period is one timer that flips a flag, so `CH.timers()` still reports an idle game
  // once it has fired (TEC-14) and `leave` cancels it if the player is quicker than it is.
  let armed = false;
  let graceTimer = app.later('summaryGrace', GRACE_MS, () => {
    graceTimer = null;
    armed = true;
  });

  function leave() {
    if (!armed) return true; // swallowed: the run only just ended
    if (graceTimer) {
      app.clearTimer(graceTimer);
      graceTimer = null;
    }
    app.hideSeedInput();
    app.toTitle();
    return true;
  }

  return {
    id: 'summary',
    kind: props.kind,
    opaque: true,
    free: true,

    draw(buf) {
      const headerColor = props.kind === 'victory' ? 'brass' : 'red';
      write(buf, 0, HEADER_ROW, center(event.header || '', COLS), headerColor, BG, COLS);
      write(buf, 0, FLAVOR_ROW, center(event.flavor || '', COLS), 'violet', BG, COLS);
      rows.forEach((row, i) => {
        const y = TABLE_ROW + i;
        if (y >= FOOTER_ROW) return;
        if (row.label) write(buf, LABEL_X, y, fit(row.label, VALUE_X - LABEL_X - 1), 'midGrey', BG);
        if (row.value) write(buf, VALUE_X, y, fit(row.value, COLS - VALUE_X), 'lightGrey', BG);
      });
      write(buf, 0, FOOTER_ROW, center(SCRIPT.summaryFooter, COLS), 'midGrey', BG, COLS);
    },

    /** UI-17: `Esc` or `Enter` only — never "any key". */
    onKey(ev) {
      if (!LEAVE_KEYS.includes(ev.key)) return true;
      return leave();
    },

    onMouse() {
      return leave();
    },

    /** For the tests: has the grace period elapsed? */
    get armed() {
      return armed;
    },
  };
}
