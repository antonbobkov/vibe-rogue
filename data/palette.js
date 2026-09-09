// The fixed palette (UI-08), plus the additions BST-01 asks for.
//
// BST-01 says in full: "No additions: every color name used below (`iron`, `lime`, `gold`, …) is
// defined in `UI-08`." So this table is exactly UI-08 and nothing else.
//
// PLN-02 R3: this module is data only. The `resolve(colorOrName)` helper that TEC-10 and the
// renderer need lives in `src/palette.js`, which imports this table (D-012).

/**
 * UI-08. Keys are the names the rest of the specs use; values are `#rrggbb` strings.
 * `telegraph` is a foreground/background pair in UI-08; its foreground is here and its background
 * is in `PALETTE_BG` (D-013).
 */
export const PALETTE = Object.freeze({
  bg: '#0c0c10',
  bgPanel: '#14141a',
  dimGrey: '#3a3a44',
  midGrey: '#707070',
  lightGrey: '#c8c8c8',
  white: '#ffffff',
  red: '#ff6060',
  orange: '#ff9040',
  yellow: '#ffd75f',
  teal: '#5ad0ff',
  iron: '#9a9aa0',
  telegraph: '#ffffff',
  brass: '#ffd75f',
  copper: '#c87850',
  silver: '#d0d0d0',
  steel: '#8fb0c0',
  rust: '#a0522d',
  oil: '#5050a0',
  green: '#60e060',
  blue: '#60c0ff',
  violet: '#c0a0ff',
  pink: '#ff80c0',
  lime: '#a0e060',
  gold: '#e0b040',
});

/** The background half of the one UI-08 entry that names a pair (D-013). */
export const PALETTE_BG = Object.freeze({
  telegraph: '#602020',
});
