// Palette lookup (UI-08, TEC-10).
//
// `data/palette.js` holds the table; PLN-02 R3 forbids functions there, so the one helper the
// renderer and the tests need lives here instead (D-012). Nothing in this module touches the DOM
// (PLN-02 R2): it is string arithmetic only.

import { PALETTE, PALETTE_BG } from '../data/palette.js';

const HEX = /^#[0-9a-f]{6}$/;

/**
 * Resolve a palette name or a literal color to a lowercase `#rrggbb` string.
 *
 * Data files name colors (`'steel'`, `'gold'`); UI-07 and UI-09 sometimes give literal hex. Both
 * are accepted; anything else throws, so a mistranscribed color name in `data/` fails loudly
 * rather than drawing in black (ACC-132 color clause).
 *
 * @param {string} colorOrName a UI-08 palette name or a `#rrggbb` literal (case-insensitive)
 * @returns {string} `#rrggbb`, lowercase
 */
export function resolve(colorOrName) {
  if (typeof colorOrName !== 'string') {
    throw new TypeError(`palette: expected a color name or #rrggbb, got ${typeof colorOrName}`);
  }
  const value = colorOrName.trim();
  if (Object.prototype.hasOwnProperty.call(PALETTE, value)) return PALETTE[value];
  const lower = value.toLowerCase();
  if (HEX.test(lower)) return lower;
  throw new RangeError(`palette: unknown color '${colorOrName}'`);
}

/**
 * True when `colorOrName` is something `resolve` will accept. Tests use it to check every color in
 * `data/` without catching.
 *
 * @param {unknown} colorOrName
 * @returns {boolean}
 */
export function resolves(colorOrName) {
  if (typeof colorOrName !== 'string') return false;
  const value = colorOrName.trim();
  return Object.prototype.hasOwnProperty.call(PALETTE, value) || HEX.test(value.toLowerCase());
}

/**
 * The background half of a palette entry that names a foreground/background pair (UI-08
 * `telegraph`), or `null` when the entry has no background of its own.
 *
 * @param {string} name a UI-08 palette name
 * @returns {string|null}
 */
export function background(name) {
  return Object.prototype.hasOwnProperty.call(PALETTE_BG, name) ? PALETTE_BG[name] : null;
}

/**
 * UI-09 rule 2: remembered tiles and scrap are drawn at 45% brightness — each RGB channel × 0.45,
 * rounded. Kept here so `render.js` can cache the result per color (TEC-10).
 *
 * @param {string} colorOrName
 * @param {number} factor brightness multiplier (0.45 for remembered tiles and scrap)
 * @returns {string} `#rrggbb`
 */
export function dim(colorOrName, factor) {
  const hex = resolve(colorOrName);
  let out = '#';
  for (let i = 1; i < 7; i += 2) {
    const channel = Math.round(parseInt(hex.slice(i, i + 2), 16) * factor);
    out += Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0');
  }
  return out;
}
