// The Death and Victory screens (UI-17, SCR-08, STY-08) and TEC-12's seed copy.
//
// "full-screen summary per `STY-08`: header line (`TICK WAS BROKEN` / `TICK WOUND DOWN` /
// `THE KEEPER` / `THE WALKER`), the flavor line, then a two-column table of run statistics, the
// skill list in order, final equipment, `Journal pages: n/8`, `Seed: xxxx`, and
// `— any key to return to the title —`. The seed is selectable text (rendered also as a hidden DOM
// input for copy, `TEC-12`)."
//
// The labels are SCR-08's, verbatim, from `data/script.js` (D-089).

import { COLS, BG, write, center, fit } from '../render.js';
import { SCRIPT } from '../../data/script.js';

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

  function leave() {
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

    onKey() {
      return leave();
    },

    onMouse() {
      return leave();
    },
  };
}
