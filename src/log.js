// The message log: SCR-10's templates, UI-04's colors, merging and the 500-line cap.
//
// A log line is a plain object `{ text, color, count }` (TEC-05: "log: string[] (cap 500 with color
// tags)" — the color tag is the `color` field, a UI-08 palette name, and `count` is UI-04's merge
// counter). Lines are appended to `state.log`; nothing here touches the DOM (PLN-02 R2) and nothing
// here draws: `render.js` (M10) turns a line into cells with `renderLine`.
//
// SCR-10's article rule ("where {A} or {D} is an enemy, its name is preceded by 'the', capitalised
// at the start of a sentence, unless the name itself begins with 'The'") is implemented in
// `format` by looking at what the template already supplies (D-041).

import { log as TEMPLATES } from '../data/script.js';

/** UI-04: the full history is capped at 500 lines. */
export const LOG_CAP = 500;

/**
 * The six message colors of UI-04, as palette names (`data/palette.js`).
 *
 *   default   everything not called out below
 *   tickHurt  damage to Tick (and Tick's death lines)
 *   tickHits  damage dealt by Tick, and damage to enemies generally
 *   tension   the two Tension warnings of CHR-03
 *   gain      level-up and item pickup
 *   scripted  scripted and boss lines
 */
export const LOG_COLORS = Object.freeze({
  default: 'lightGrey',
  tickHurt: 'red',
  tickHits: 'silver',
  tension: 'yellow',
  gain: 'green',
  scripted: 'violet',
});

/** Template key -> the UI-04 color it always uses. Anything else is `default`. */
const KEY_COLOR = Object.freeze({
  tensionLoosening: LOG_COLORS.tension,
  tensionNearlySlack: LOG_COLORS.tension,
  levelUp: LOG_COLORS.gain,
  pickup: LOG_COLORS.gain,
  pickupStack: LOG_COLORS.gain,
  journalPage: LOG_COLORS.gain,
  blueprint: LOG_COLORS.gain,
  salvage: LOG_COLORS.gain,
  deathByEnemy: LOG_COLORS.tickHurt,
  deathByTension: LOG_COLORS.tickHurt,
  deathByHazard: LOG_COLORS.tickHurt,
  deathByBurning: LOG_COLORS.tickHurt,
});

/** The color UI-04 gives a template, unless the caller overrides it. */
export function colorFor(key) {
  return KEY_COLOR[key] || LOG_COLORS.default;
}

/** The raw SCR-10 template behind a key, or a throw if the key is a typo. */
export function template(key) {
  const t = TEMPLATES[key];
  if (typeof t !== 'string') throw new RangeError(`log: no SCR-10 template named '${key}'`);
  return t;
}

/**
 * An actor's name as SCR-10 spells it in a template.
 *
 * @param {string} name the actor's own name
 * @param {boolean} article whether the name takes "the" (enemies do; Tick and the Decoy do not)
 */
export function label(name, article) {
  return { name, article: article !== false };
}

const ARTICLE_BEFORE = /(?:^|\s)[Tt]he $/;
const SENTENCE_START = /(?:^|[.!?]\s+|^\s*)$/;

/** Substitute one `{A}`-style placeholder, applying SCR-10's article rule to actor labels. */
function substitute(text, key, value) {
  const token = `{${key}}`;
  for (;;) {
    const at = text.indexOf(token);
    if (at < 0) return text;
    const before = text.slice(0, at);
    let out;
    if (value && typeof value === 'object' && 'name' in value) {
      const name = String(value.name);
      const startsWithThe = /^The\s/.test(name);
      if (!value.article) {
        out = name;
      } else if (ARTICLE_BEFORE.test(before)) {
        // The template already wrote "The " / "the " — hand it the bare name.
        out = startsWithThe ? name.slice(4) : name;
      } else if (startsWithThe) {
        out = name;
      } else {
        out = (SENTENCE_START.test(before) ? 'The ' : 'the ') + name;
      }
    } else {
      out = String(value);
    }
    text = before + out + text.slice(at + token.length);
  }
}

/**
 * Fill an SCR-10 template. Values may be plain (numbers, strings) or actor labels from `label()`.
 *
 * @param {string} key an SCR-10 template key in `data/script.js`
 * @param {Record<string, unknown>} [params]
 */
export function format(key, params = {}) {
  let text = template(key);
  for (const name of Object.keys(params)) text = substitute(text, name, params[name]);
  return text;
}

/**
 * Append a line to `lines`, merging it into the previous line when the text is identical (UI-04)
 * and trimming the history to `LOG_CAP`.
 *
 * @returns {{text: string, color: string, count: number}} the line that now carries the message —
 *          the merged previous line when a merge happened, so callers can report what changed.
 */
export function push(lines, text, color = LOG_COLORS.default) {
  const last = lines.length > 0 ? lines[lines.length - 1] : null;
  if (last && last.text === text && last.color === color) {
    last.count += 1;
    return last;
  }
  const line = { text, color, count: 1 };
  lines.push(line);
  while (lines.length > LOG_CAP) lines.shift();
  return line;
}

/** Format an SCR-10 template and push it in one step. */
export function say(lines, key, params = {}, color) {
  return push(lines, format(key, params), color === undefined ? colorFor(key) : color);
}

/** The text UI-04 draws for a line: merged lines carry their `(×n)` suffix. */
export function renderLine(line) {
  return line.count > 1 ? `${line.text} (×${line.count})` : line.text;
}
