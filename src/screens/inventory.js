// The Inventory screen (UI-14).
//
// "Overlays the map area (cols 0-59) with a box; the panel and log stay visible." The Run screen
// underneath therefore still draws the panel and the log; this screen redraws the inspect line,
// because UI-14 gives it to the selected or hovered item.
//
// Actions are ITM-07's: `e` equip / unequip, `u` use, `t` throw, `d` drop. "Actions that don't
// apply to the selected item are drawn in `midGrey` and do nothing." `u` and `t` close the screen
// (the item leaves the list); `e` and `d` leave it open (D-092).

import {
  MAP_W, MAP_H, BG_PANEL, box, write, fit, twoColumn, invertRow,
} from '../render.js';
import { listIntent } from '../input.js';
import {
  itemDef, slotLetter, slotOfLetter, entryName, displayName, INVENTORY_SLOTS, EQUIP_SLOTS,
} from '../items.js';
import { itemFields, itemLine } from './inspect.js';
import { drawInspect } from './run.js';

/** The three equipped rows of UI-14, by the letter that selects them. */
export const EQUIP_LETTERS = Object.freeze({ W: 'weapon', P: 'plating', A: 'attachment' });

/** UI-14's box fills the map area. */
export const BOX_W = MAP_W;
export const BOX_H = MAP_H;

/** Interior rows, relative to the box interior. */
export const ROW_HEADER = 0;
export const ROW_FIRST_ITEM = 1;
export const ROW_EQUIPPED = ROW_FIRST_ITEM + INVENTORY_SLOTS + 1;
export const ROW_FIRST_EQUIP = ROW_EQUIPPED + 1;
export const ROW_BUTTONS = ROW_FIRST_EQUIP + EQUIP_SLOTS.length + 1;

/** Where an item's fields start, so the two columns of UI-14's mock-up line up. */
export const FIELDS_X = 24;

const DASH = '—';

/** UI-14's four action buttons and the columns they occupy. */
export const BUTTONS = Object.freeze([
  Object.freeze({ action: 'equip', text: '[e]quip/unequip', offset: 0 }),
  Object.freeze({ action: 'use', text: '[u]se', offset: 17 }),
  Object.freeze({ action: 'throw', text: '[t]hrow', offset: 24 }),
  Object.freeze({ action: 'drop', text: '[d]rop', offset: 33 }),
]);

/** ITM-07: which of the four actions apply to the selected entry. */
export function applicable(entry) {
  const out = { equip: false, use: false, throw: false, drop: false };
  if (!entry) return out;
  if (entry.kind === 'equipped') {
    out.equip = Boolean(entry.name);
    return out;
  }
  const def = itemDef(entryName(entry.name));
  out.drop = true;
  out.equip = ['melee', 'ranged', 'plating', 'attachment'].includes(def.category);
  out.use = def.category === 'instant';
  out.throw = def.category === 'throwable';
  return out;
}

export function createInventoryScreen(app) {
  let selected = 0;

  const tick = () => app.game.state.tick;

  /** Every selectable entry, in UI-14's order: the filled inventory slots, then W / P / A. */
  function entries() {
    const out = [];
    tick().inventory.forEach((slot, i) => {
      if (!slot) return;
      // DIF-07: `wear` travels with a carried plate, so the entry carries it too.
      out.push({ kind: 'item', slot: i, letter: slotLetter(i), name: slot.name, count: slot.count, wear: slot.wear });
    });
    for (const [letter, which] of Object.entries(EQUIP_LETTERS)) {
      out.push({ kind: 'equipped', which, letter, name: tick().equipment[which] || null });
    }
    return out;
  }

  function clamp(list) {
    if (selected >= list.length) selected = list.length - 1;
    if (selected < 0) selected = 0;
  }

  function close() {
    app.pop();
    return true;
  }

  /** The interior row an entry is drawn on. */
  function rowOf(entry) {
    if (entry.kind === 'item') return ROW_FIRST_ITEM + entry.slot;
    return ROW_FIRST_EQUIP + EQUIP_SLOTS.indexOf(entry.which);
  }

  function perform(action) {
    const list = entries();
    clamp(list);
    const entry = list[selected];
    const can = applicable(entry);
    if (!entry || !can[action]) return true;
    switch (action) {
      case 'equip':
        if (entry.kind === 'equipped') app.act({ type: 'unequip', which: entry.which });
        else app.act({ type: 'equip', slot: entry.slot });
        app.markDirty();
        return true;
      case 'use':
        // ACC-109: "Used, screen closes, turn passes."
        close();
        app.act({ type: 'use', slot: entry.slot });
        return true;
      case 'drop':
        app.act({ type: 'drop', slot: entry.slot });
        app.markDirty();
        return true;
      case 'throw': {
        const def = itemDef(entryName(entry.name));
        close();
        app.push(app.screens.targeting({
          mode: 'target',
          range: def.range,
          openKey: 't',
          confirm: (x, y) => app.act({ type: 'throw', slot: entry.slot, x, y }),
        }));
        return true;
      }
      default:
        return true;
    }
  }

  const screen = {
    id: 'inventory',
    opaque: false,
    free: true,

    draw(buf) {
      const list = entries();
      clamp(list);
      const inner = box(buf, 0, 0, BOX_W, BOX_H, 'iron', BG_PANEL);
      write(buf, inner.x, inner.y + ROW_HEADER, twoColumn('INVENTORY', '(i / Esc to close)', inner.w),
        'brass', BG_PANEL, inner.w);

      // The ten inventory slots, in slot order, so the letters never move (ITM-03).
      tick().inventory.forEach((slot, i) => {
        const y = inner.y + ROW_FIRST_ITEM + i;
        if (!slot) {
          write(buf, inner.x, y, `${slotLetter(i)})`, 'midGrey', BG_PANEL, inner.w);
          return;
        }
        const def = itemDef(entryName(slot));
        const count = slot.count > 1 ? ` ×${slot.count}` : '';
        write(buf, inner.x, y, fit(`${slotLetter(i)}) ${displayName(slot)}${count}`, FIELDS_X - 1), 'lightGrey', BG_PANEL);
        const glyph = def.category === 'record' ? '?' : def.glyph;
        write(buf, inner.x + FIELDS_X, y, fit(`${glyph} ${itemFields(def, tick(), slot)}`, inner.w - FIELDS_X),
          'lightGrey', BG_PANEL);
      });

      write(buf, inner.x, inner.y + ROW_EQUIPPED, 'EQUIPPED', 'brass', BG_PANEL, inner.w);
      EQUIP_SLOTS.forEach((which, i) => {
        const letter = Object.keys(EQUIP_LETTERS).find((k) => EQUIP_LETTERS[k] === which);
        const worn = tick().equipment[which];
        const y = inner.y + ROW_FIRST_EQUIP + i;
        write(buf, inner.x, y, fit(`${letter}) ${displayName(worn) || DASH}`, FIELDS_X - 1), 'lightGrey', BG_PANEL);
        if (worn) {
          const def = itemDef(entryName(worn));
          write(buf, inner.x + FIELDS_X, y, fit(`${def.glyph} ${itemFields(def, tick(), worn)}`, inner.w - FIELDS_X),
            'lightGrey', BG_PANEL);
        }
      });

      // The four buttons, greyed where they do not apply (UI-14).
      const entry = list[selected];
      const can = applicable(entry);
      const buttonRow = inner.y + ROW_BUTTONS;
      for (const b of BUTTONS) {
        write(buf, inner.x + b.offset, buttonRow, b.text, can[b.action] ? 'steel' : 'midGrey', BG_PANEL);
      }
      write(buf, inner.x + inner.w - 19, buttonRow, '↑↓ / letter selects', 'midGrey', BG_PANEL, 19);

      // "Selected line is inverted."
      if (entry) invertRow(buf, inner.x, inner.y + rowOf(entry), inner.w);

      // UI-14: the inspect line carries the selected item's full information.
      drawInspect(buf, screen.inspectText());
    },

    inspectText() {
      const list = entries();
      clamp(list);
      const entry = list[selected];
      if (!entry) return '';
      if (!entry.name) return `${entry.which} — empty`;
      // DIF-07: `entry.name` is an EquipEntry for an equipped slot and for carried equipment, so
      // the wear travels into the line `inspect.js` writes.
      if (entry.kind === 'equipped') return itemLine(entry.name, tick());
      return itemLine({ name: entryName(entry.name), count: entry.count, wear: entry.wear }, tick());
    },

    onKey(ev) {
      if (ev.key === 'i') return close();
      const list = entries();
      clamp(list);

      switch (ev.key) {
        case 'e':
          return perform('equip');
        case 'u':
          return perform('use');
        case 't':
          return perform('throw');
        case 'd':
          return perform('drop');
        default:
          break;
      }

      const intent = listIntent(ev);
      if (!intent) return true;
      switch (intent.type) {
        case 'cancel':
          return close();
        case 'moveSelection':
          if (intent.axis === 'x') return true;
          selected = (selected + intent.delta + list.length) % list.length;
          app.markDirty();
          return true;
        case 'confirm':
          return true;
        case 'letter': {
          if (EQUIP_LETTERS[ev.key]) {
            const at = list.findIndex((e) => e.kind === 'equipped' && e.letter === ev.key);
            if (at >= 0) {
              selected = at;
              app.markDirty();
            }
            return true;
          }
          const slot = slotOfLetter(ev.key);
          if (slot !== null) {
            const at = list.findIndex((e) => e.kind === 'item' && e.slot === slot);
            if (at >= 0) {
              selected = at;
              app.markDirty();
            }
          }
          return true;
        }
        default:
          return true;
      }
    },

    onMouse(ev) {
      if (!ev.cell) return true;
      const list = entries();
      clamp(list);
      const y = ev.cell.y - 1;

      if (y === ROW_BUTTONS) {
        const x = ev.cell.x - 1;
        for (const b of BUTTONS) {
          if (x >= b.offset && x < b.offset + b.text.length) return perform(b.action);
        }
        return true;
      }
      const at = list.findIndex((entry) => rowOf(entry) === y);
      if (at >= 0) {
        selected = at;
        app.markDirty();
      }
      return true;
    },

    get selectedEntry() {
      const list = entries();
      clamp(list);
      return list[selected] || null;
    },
  };

  return screen;
}
