// The Skills screen (UI-15).
//
// "three columns, one per discipline, headers in the discipline color (Armature `copper`,
// Tinkering `green`, Resonance `violet`). Each rank line: `n. Name` with state: taken (bright),
// available (white, marked `▸`), locked (`midGrey`). The header line shows `Skill points: n`.
// Select with arrows/click; `Enter` or click takes an available skill (confirmation prompt:
// "Take *Name*? y/n"). The selected skill's full text (`20`) shows in a box below the columns.
// `Esc`/`s` closes."
//
// The screen is full width and the detail box wraps, because three of the twelve summaries are
// longer than SKL-01's stated 60 characters — 62, 77 and 79 (D-025) — and they are shown in full
// (D-093).

import { COLS, BG, BG_PANEL, box, write, fit, wrapMarkup, writeMarkup } from '../render.js';
import { listIntent, yesNo } from '../input.js';
import * as skills from '../skills.js';
import { DISCIPLINES } from '../../data/skills.js';

/** UI-15's discipline colors. */
export const DISCIPLINE_COLORS = Object.freeze({
  Armature: 'copper',
  Tinkering: 'green',
  Resonance: 'violet',
});

export const HEADER_ROW = 0;
export const COLUMN_ROW = 2;
export const FIRST_RANK_ROW = 3;
export const RANKS = 4;
export const DETAIL_ROW = 8;
export const DETAIL_H = 12;

/** The three columns, 26 cells apart. */
export const COLUMN_W = 26;
export function columnX(i) {
  return 1 + i * COLUMN_W;
}

/** UI-15's marker for an available skill. */
export const AVAILABLE_MARK = '▸';

/** UI-15's three states, as the color and marker a rank line is drawn with. */
export function stateOf(tick, name) {
  if (skills.has(tick, name)) return { state: 'taken', color: 'brass', mark: ' ' };
  if (skills.locked(tick, name)) return { state: 'locked', color: 'midGrey', mark: ' ' };
  return { state: 'available', color: 'white', mark: AVAILABLE_MARK };
}

export function createSkillsScreen(app, props = {}) {
  let column = 0;
  let rank = 0;
  /** The `y/n` confirmation of UI-15, or null. */
  let confirming = null;

  const tick = () => app.game.state.tick;

  function lines() {
    return DISCIPLINES.map((d) => skills.lineOf(d));
  }

  function selectedDef() {
    const line = lines()[column];
    return line ? line[rank] : null;
  }

  function close() {
    app.pop();
    return true;
  }

  /** UI-15: "`Enter` or click takes an available skill (confirmation prompt ...)". */
  function offer() {
    const def = selectedDef();
    if (!def) return true;
    // "Select locked skill, Enter | Nothing" (ACC-110); an already-taken skill likewise.
    if (!skills.available(tick(), def.name)) return true;
    confirming = def.name;
    app.markDirty();
    return true;
  }

  const screen = {
    id: 'skills',
    opaque: true,
    free: true,

    draw(buf) {
      const t = tick();
      write(buf, 1, HEADER_ROW, 'SKILLS', 'brass', BG, 12);
      write(buf, 16, HEADER_ROW, `Skill points: ${t.skillPoints}`,
        t.skillPoints > 0 ? 'yellow' : 'midGrey', BG, 22);
      write(buf, COLS - 21, HEADER_ROW, '(s / Esc to close)', 'midGrey', BG, 20);

      lines().forEach((line, ci) => {
        const discipline = DISCIPLINES[ci];
        write(buf, columnX(ci), COLUMN_ROW, fit(discipline, COLUMN_W - 1),
          DISCIPLINE_COLORS[discipline], BG);
        line.forEach((def, ri) => {
          const style = stateOf(t, def.name);
          const text = `${style.mark}${def.rank}. ${def.name}`;
          const chosen = ci === column && ri === rank;
          write(buf, columnX(ci), FIRST_RANK_ROW + ri, fit(text, COLUMN_W - 1),
            chosen ? 'brass' : style.color, chosen ? BG_PANEL : BG, COLUMN_W - 1);
        });
      });

      const def = selectedDef();
      if (def) {
        const inner = box(buf, 0, DETAIL_ROW, COLS, DETAIL_H, 'iron', BG_PANEL);
        const style = stateOf(t, def.name);
        write(buf, inner.x, inner.y, fit(`${def.name}  —  ${def.discipline} ${def.rank}`, inner.w),
          DISCIPLINE_COLORS[def.discipline], BG_PANEL, inner.w);
        const kind = def.type === 'A' ? `Active, ${def.cost} Tension` : 'Passive';
        const oncePerFloor = def.oncePerFloor ? ', once per floor' : '';
        write(buf, inner.x, inner.y + 1, fit(`${kind}${oncePerFloor}  ·  ${style.state}`, inner.w),
          'midGrey', BG_PANEL, inner.w);
        let y = inner.y + 3;
        // SKL-01's summary, wrapped rather than truncated (D-025, D-093).
        for (const row of wrapMarkup(def.summary, inner.w)) {
          if (y >= inner.y + inner.h) break;
          writeMarkup(buf, inner.x, y, row, 'lightGrey', BG_PANEL, inner.w);
          y += 1;
        }
        y += 1;
        for (const row of wrapMarkup(def.description, inner.w)) {
          if (y >= inner.y + inner.h) break;
          writeMarkup(buf, inner.x, y, row, 'silver', BG_PANEL, inner.w);
          y += 1;
        }
        if (skills.locked(t, def.name)) {
          const need = skills.prerequisiteOf(def.name);
          write(buf, inner.x, inner.y + inner.h - 1, fit(`Needs ${need}.`, inner.w), 'midGrey', BG_PANEL, inner.w);
        }
      }

      if (confirming) {
        const prompt = `Take *${confirming}*? y/n`;
        const w = prompt.length + 2;
        const inner = box(buf, Math.floor((COLS - w) / 2), DETAIL_ROW - 3, w, 3, 'yellow', BG_PANEL);
        writeMarkup(buf, inner.x, inner.y, prompt, 'yellow', BG_PANEL, inner.w);
      }
    },

    onKey(ev) {
      if (confirming) {
        const answer = yesNo(ev);
        if (answer === null) return true;
        const name = confirming;
        confirming = null;
        if (answer) app.act({ type: 'takeSkill', name });
        app.markDirty();
        return true;
      }

      if (ev.key === 's') return close();
      const intent = listIntent(ev);
      if (!intent) return true;
      const all = lines();
      switch (intent.type) {
        case 'cancel':
          return close();
        case 'moveSelection':
          if (intent.axis === 'x') column = (column + intent.delta + all.length) % all.length;
          else rank = (rank + intent.delta + RANKS) % RANKS;
          app.markDirty();
          return true;
        case 'confirm':
          return offer();
        default:
          return true;
      }
    },

    onMouse(ev) {
      if (confirming) return true;
      if (!ev.cell) return true;
      const ri = ev.cell.y - FIRST_RANK_ROW;
      if (ri < 0 || ri >= RANKS) return true;
      const ci = Math.floor((ev.cell.x - 1) / COLUMN_W);
      if (ci < 0 || ci >= DISCIPLINES.length) return true;
      if (ci === column && ri === rank) return offer();
      column = ci;
      rank = ri;
      app.markDirty();
      return true;
    },

    get confirming() {
      return confirming;
    },
  };

  if (props.select) {
    const at = lines().findIndex((line) => line.some((d) => d.name === props.select));
    if (at >= 0) {
      column = at;
      rank = lines()[at].findIndex((d) => d.name === props.select);
    }
  }

  return screen;
}
