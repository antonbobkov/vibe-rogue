// The inspect line (UI-05) and the inspect popup (UI-11).
//
// Both describe "the top-most thing on that cell" — actor, then item, then hazard, then terrain —
// and the popup adds every field of ENM-11 / ITM-05 plus the hazard's numbers. The two live in one
// module so a fact is worded once.
//
// One of the DOM-allowed modules (PLN-02 R2), though nothing here touches the DOM: it is text.

import { idx, chebyshev } from '../grid.js';
import { TILE, TILE_NAME, HAZARDS, hazardActive, hazardWarning, turnsUntilActive } from '../tiles.js';
import { itemDef, consumableAmount as amountOf, entryName, entryWear, platingOf, displayName } from '../items.js';
import { enemyType, enemyName, statsOf, speedOf, derive, isTick, START_INTEGRITY } from '../actors.js';
import * as combat from '../combat.js';

import { isWindingUp, box, write, wrap, COLS, ROWS, MAP_W, MAP_H, BG_PANEL } from '../render.js';
import { TUNING } from '../../data/tuning.js';

/** UI-05 writes a range with an en dash and a negative with a true minus sign. */
const EN_DASH = '–';
const MINUS = '−';

/** UI-11: "a popup box (max 40 x 12 cells)". */
export const POPUP_W = 40;
export const POPUP_H = 12;

function signed(n) {
  if (n < 0) return `${MINUS}${Math.abs(n)}`;
  return `+${n}`;
}

/** UI-03 row 15's abbreviation, reused by the inspect line: `Bur(2)`. */
export function statusText(statuses) {
  const parts = [];
  for (const name of Object.keys(statuses || {})) {
    const n = statuses[name];
    if (n > 0) parts.push(`${name.slice(0, 3)}(${n})`);
  }
  return parts;
}

/** ENM-06 BRUISER: its `attack` is `0 (flat)` and the inspect line shows its `heavyAttack`. */
function attackDiceOf(type) {
  if (type.heavyAttack && /^0(\s|\()/.test(String(type.attack))) return type.heavyAttack;
  return type.attack;
}

/** Parse `NdS+M` (or a flat value) into its min and max. */
function diceRange(spec) {
  const m = /^\s*(\d+)d(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(String(spec));
  if (!m) {
    const flat = /^\s*([+-]?\d+)/.exec(String(spec));
    const v = flat ? Number(flat[1]) : 0;
    return { min: v, max: v };
  }
  const n = Number(m[1]);
  const sides = Number(m[2]);
  const mod = m[3] ? Number(m[3].replace(/\s+/g, '')) : 0;
  return { min: n * 1 + mod, max: n * sides + mod };
}

/** ENM-11: "damage range vs. Tick after Plating". */
export function damageRangeVsTick(game, enemy) {
  const type = enemyType(enemy);
  const plating = derive(game.state.tick, game.state.tuning).plating;
  const dice = diceRange(attackDiceOf(type));
  const ignores = type.ranged && type.ranged.ignoresPlating;
  const reduce = ignores ? 0 : plating;
  return {
    min: Math.max(0, dice.min - reduce),
    max: Math.max(0, dice.max - reduce),
  };
}

/** ENM-11: "accuracy vs. Tick as a %". */
export function hitChanceVsTick(game, enemy) {
  return combat.hitChance(game.ctx, enemy, game.state.tick);
}

/** UI-05 / UI-20: dormant, active, returning, or `winding up` while telegraphing. */
export function enemyStateText(enemy) {
  if (isWindingUp(enemy)) return 'winding up';
  return String(enemy.state || 'dormant').toLowerCase();
}

/** UI-05's one-line enemy form. */
export function enemyLine(game, enemy) {
  if (enemy.isDecoy) return `decoy  ${enemy.integrity}/${enemy.integrityMax}  · no threat`;
  const type = enemyType(enemy);
  const dmg = damageRangeVsTick(game, enemy);
  const parts = [
    // ENM-12 (DIF-08): an Overwound enemy says so before it says anything else.
    `${enemyName(enemy)}  ${enemy.integrity}/${enemy.integrityMax}`,
    `hits you ${hitChanceVsTick(game, enemy)}% for ${dmg.min}${EN_DASH}${dmg.max}`,
    `· plating ${type.plating}`,
    `· ${speedOf(game.state, enemy).toLowerCase()}`,
    `· ${enemyStateText(enemy)}`,
  ];
  const statuses = statusText(enemy.statuses);
  if (statuses.length > 0) parts.push(`· ${statuses.join(', ')}`);
  return parts.join('  ');
}

/**
 * ITM-05: an item's fields as numbers, in one line. `entry` is the record or equipment entry the
 * fields belong to, so a pitted plate shows what it is worth now (CMB-14, DIF-07).
 */
export function itemFields(def, tick, entry) {
  switch (def.category) {
    case 'melee': {
      const bits = [def.dice];
      if (def.accuracyMod) bits.push(`accuracy ${signed(def.accuracyMod)}`);
      if (def.special) bits.push(def.special.toLowerCase());
      return bits.join('  ');
    }
    case 'ranged': {
      const bits = [def.dice, `range ${def.range}`, `spring ${def.tensionCost}`];
      if (def.accuracyMod) bits.push(`accuracy ${signed(def.accuracyMod)}`);
      if (def.special) bits.push(def.special.toLowerCase());
      return bits.join('  ');
    }
    case 'plating': {
      const wear = entryWear(entry);
      const plating = wear > 0
        ? `plating ${def.plating} ${MINUS} ${wear} wear = ${platingOf(entry)}`
        : `plating ${def.plating}`;
      return `${plating}  evasion ${signed(-def.evasionPenalty)}`;
    }
    case 'attachment': {
      const bits = [];
      if (def.forceMod) bits.push(`force ${signed(def.forceMod)}`);
      if (def.precisionMod) bits.push(`precision ${signed(def.precisionMod)}`);
      if (def.platingMod) bits.push(`plating ${signed(def.platingMod)}`);
      if (def.evasionMod) bits.push(`evasion ${signed(def.evasionMod)}`);
      if (def.special) bits.push(def.special.toLowerCase());
      return bits.join('  ');
    }
    case 'instant':
      return consumableFields(def, tick);
    case 'throwable':
      return `range ${def.range}  radius ${def.radius === undefined ? 0 : def.radius}  ${consumableFields(def, tick)}`;
    case 'record':
      return def.blueprint ? 'Blueprint' : `journal page ${def.journalIndex}`;
    default:
      return '';
  }
}

/** CAT-06's amounts, with SKL-03 **Efficient Springs** applied when Tick has it. */
function consumableAmount(effect, tick) {
  return amountOf(effect, tick, TUNING);
}

function consumableFields(def, tick) {
  switch (def.effect) {
    case 'SOLDER':
      // DIF-03: the Solder is a repair, so the line names both halves of the bargain.
      return `+${consumableAmount('SOLDER', tick)} Integrity over ${TUNING.solderTurns}, ${TUNING.solderTension} Tension`;
    case 'SPRING_KEY':
      return `+${consumableAmount('SPRING_KEY', tick)} Tension`;
    case 'FLUX':
      return `+${consumableAmount('FLUX', tick)} Integrity, clears statuses`;
    case 'OIL_FLASK':
      return 'Burning 3';
    case 'GRIT_BOMB':
      return '1 damage, Blinded 4';
    case 'TUNING_FORK':
      return 'Stunned 2';
    case 'CLATTER_CAN':
      return 'noise 10';
    default:
      return '';
  }
}

/** UI-05's one-line item form: `Brass Plating  [ plating 2  evasion −2`. */
export function itemLine(record, tick) {
  const def = itemDef(entryName(record));
  const count = record.count === undefined || record.count <= 1 ? '' : ` ×${record.count}`;
  const name = displayName(record);
  return `${name}${count}  ${def.category === 'record' ? '?' : def.glyph} ${itemFields(def, tick, record)}`;
}

/** UI-05's feature forms. */
export function featureLine(game, tile) {
  if (tile === TILE.STATION) {
    // CHR-05 (DIF-05): the station says what winding costs as well as what it gives.
    return game.state.floor.stationSpent
      ? 'Winding Station (spent) — this station has run down'
      : 'Winding Station (unspent) — press e. Loud: wakes the floor.';
  }
  if (tile === TILE.STAIRS_UP) return 'Up-stairs — press <';
  // WLD-15 (DIF-12): the lock says its price before you walk into it (OVR-02 pillar 3).
  if (tile === TILE.WOUND_LOCK) {
    const tuning = game.state.tuning || TUNING;
    return `Wound Lock — ${tuning.cacheLockCost} Tension to open.`;
  }
  return TILE_NAME[tile] || '';
}

/** UI-05's hazard form: `Steam Vent — active in 2 turns: 4 damage, Burning 2`. */
export function hazardLine(game, kind) {
  const cfg = HAZARDS[kind];
  const turn = game.state.turn;
  const effect = [`${cfg.damage} damage`];
  if (cfg.status) effect.push(`${cfg.status.name} ${cfg.status.duration}`);
  if (cfg.mechanism === 'CONSTANT') return `${cfg.name} — always active: ${effect.join(', ')}`;
  if (hazardActive(cfg.kind, turn)) return `${cfg.name} — ACTIVE: ${effect.join(', ')}`;
  const n = turnsUntilActive(cfg.kind, turn);
  return `${cfg.name} — active in ${n} turn${n === 1 ? '' : 's'}: ${effect.join(', ')}`;
}

/**
 * UI-05: one line about whatever is on the cell, or `''` for an unseen tile.
 *
 * @param {object} game
 * @param {number} x
 * @param {number} y
 */
export function inspectLine(game, x, y) {
  const state = game.state;
  const floor = state.floor;
  if (!floor || x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return '';
  const visible = game.view().visible.has(idx(x, y));
  const remembered = floor.memory[y][x] !== -1;
  if (!visible && !remembered) return '';

  if (visible) {
    if (state.tick.x === x && state.tick.y === y) return tickLine(game);
    const actor = combat.actorAt(state, x, y);
    if (actor) return enemyLine(game, actor);
    const item = topOf(floor.items, x, y);
    if (item) return itemLine(item, state.tick);
  } else {
    const item = topOf(floor.memoryItems, x, y);
    if (item) return itemLine(item, state.tick);
  }

  const tile = visible ? floor.tiles[y][x] : floor.memory[y][x];
  const hazard = HAZARD_KIND_OF[tile];
  if (hazard) return hazardLine(game, hazard);
  if (tile === TILE.STATION || tile === TILE.STAIRS_UP || tile === TILE.WOUND_LOCK) {
    return featureLine(game, tile);
  }
  return TILE_NAME[tile] || '';
}

const HAZARD_KIND_OF = Object.freeze({
  [TILE.GRINDING_GEAR]: 'GRINDING_GEAR',
  [TILE.STEAM_VENT]: 'STEAM_VENT',
  [TILE.PENDULUM_SWEEP]: 'PENDULUM_SWEEP',
});

/** Tick's own tile: the panel already carries the numbers, so this names what is underfoot. */
export function tickLine(game) {
  const state = game.state;
  const d = derive(state.tick, state.tuning);
  const bits = [
    `Tick  ${state.tick.integrity}/${state.tick.integrityMax}`,
    `tension ${state.tick.tension}/100`,
    `· plating ${d.plating}`,
    `· evasion ${d.evasion}`,
  ];
  const statuses = statusText(state.tick.statuses);
  if (state.tick.guardTimer > 0) statuses.push(`Gua(${state.tick.guardTimer})`);
  if (statuses.length > 0) bits.push(`· ${statuses.join(', ')}`);
  return bits.join('  ');
}

function topOf(list, x, y) {
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].x === x && list[i].y === y) return list[i];
  return null;
}

// ---------------------------------------------------------------------------------------------
// UI-11 — the popup
// ---------------------------------------------------------------------------------------------

/**
 * The popup's content for a map cell: the full information for the top-most thing there
 * (ENM-11 / ITM-05 / hazard fields).
 *
 * @returns {{title: string, lines: string[]}}
 */
export function popupFor(game, x, y) {
  const state = game.state;
  const floor = state.floor;
  const visible = game.view().visible.has(idx(x, y));
  const remembered = floor.memory[y][x] !== -1;
  if (!visible && !remembered) return { title: 'Unseen', lines: ['Nothing is known about this tile.'] };

  if (visible) {
    if (state.tick.x === x && state.tick.y === y) return tickPopup(game);
    const actor = combat.actorAt(state, x, y);
    if (actor) return enemyPopup(game, actor);
    const item = topOf(floor.items, x, y);
    if (item) return itemPopup(item, state.tick);
  } else {
    const item = topOf(floor.memoryItems, x, y);
    if (item) return itemPopup(item, state.tick);
  }
  const tile = visible ? floor.tiles[y][x] : floor.memory[y][x];
  const hazard = HAZARD_KIND_OF[tile];
  if (hazard) return hazardPopup(game, hazard);
  return { title: TILE_NAME[tile] || 'Tile', lines: [featureLine(game, tile)] };
}

/** ENM-11's list, in its order. */
export function enemyPopup(game, enemy) {
  if (enemy.isDecoy) {
    return {
      title: 'Decoy',
      lines: [`Integrity ${enemy.integrity}/${enemy.integrityMax}`, 'A rattling stand-in. It draws attention.'],
    };
  }
  const type = enemyType(enemy);
  const dmg = damageRangeVsTick(game, enemy);
  const statuses = statusText(enemy.statuses);
  const tuning = game.state.tuning || TUNING;
  const lines = [
    `Integrity ${enemy.integrity}/${enemy.integrityMax}`,
    `Hits you ${hitChanceVsTick(game, enemy)}%`,
    `Damage ${dmg.min}${EN_DASH}${dmg.max} after your plating`,
    `Plating ${type.plating}`,
    `Speed ${speedOf(game.state, enemy).toLowerCase()}`,
    `State ${enemyStateText(enemy)}`,
    `Statuses ${statuses.length > 0 ? statuses.join(', ') : '—'}`,
  ];
  // ENM-12 (DIF-08): the popup spells out exactly what Overwound costs the player.
  if (enemy.elite === true) {
    const percent = Math.round((tuning.eliteIntegrityMult - 1) * 100);
    lines.push(
      `overwound: +${percent}% Integrity, +${tuning.eliteAccuracyBonus} accuracy, +${tuning.eliteDamageBonus} damage`,
    );
  }
  lines.push('', type.description);
  return { title: enemyName(enemy), lines };
}

/** ITM-05: "every field in ITM-01 as numbers, its description". */
export function itemPopup(record, tick) {
  const def = itemDef(entryName(record));
  const lines = [`Kind ${def.category}`, itemFields(def, tick, record)];
  if (record.count > 1) lines.unshift(`Count ${record.count}`);
  lines.push('', def.description);
  return { title: def.name, lines };
}

export function hazardPopup(game, kind) {
  const cfg = HAZARDS[kind];
  const turn = game.state.turn;
  const lines = [
    `Damage ${cfg.damage} (ignores plating)`,
    `Status ${cfg.status ? `${cfg.status.name} ${cfg.status.duration}` : '—'}`,
    `Noise ${cfg.noise}`,
  ];
  if (cfg.mechanism === 'CONSTANT') lines.push('Always active.');
  else if (hazardActive(kind, turn)) lines.push('ACTIVE this turn.');
  else if (hazardWarning(kind, turn)) lines.push('Active next turn.');
  else lines.push(`Active in ${turnsUntilActive(kind, turn)} turns.`);
  return { title: cfg.name, lines };
}

export function tickPopup(game) {
  const state = game.state;
  const d = derive(state.tick, state.tuning);
  return {
    title: 'Tick',
    lines: [
      `Integrity ${state.tick.integrity}/${state.tick.integrityMax}`,
      `Tension ${state.tick.tension}/100`,
      `Force ${d.force}  Precision ${d.precision}  Plating ${d.plating}`,
      `Accuracy ${d.accuracy}%  Evasion ${d.evasion}`,
      `Level ${state.tick.level}  XP ${state.tick.xp}`,
    ],
  };
}

/**
 * UI-11: "Hovering a side-panel stat shows its breakdown (`CHR-08`, `CHR-11`) in the same popup
 * style."
 */
export function statPopup(game, stat) {
  const state = game.state;
  const tick = state.tick;
  const d = derive(tick, state.tuning);
  switch (stat) {
    case 'integrity':
      return {
        title: 'Integrity',
        lines: [
          `${tick.integrity} of ${tick.integrityMax}`,
          `Base ${START_INTEGRITY} + ${TUNING.levelUpIntegrity} per level above 1 (level ${tick.level})`,
          'It never heals on its own (CHR-02).',
        ],
      };
    case 'tension':
      return {
        title: 'Tension',
        lines: [
          `${tick.tension} of 100`,
          `Drops 1 every ${d.decayPeriod} turns`,
          `About ${tick.tension * d.decayPeriod} turns of spring left`,
        ],
      };
    case 'decay':
      return {
        title: 'Tension decay',
        lines: [
          `Next drop in ${Math.max(0, d.decayPeriod - tick.decayCounter)} turns`,
          `Period ${d.decayPeriod} turns`,
        ],
      };
    case 'attributes':
      return {
        title: 'Attributes',
        lines: [
          `Force ${d.force} — added to melee damage`,
          `Precision ${d.precision} — +5 accuracy each`,
          `Plating ${d.plating} — flat damage reduction`,
        ],
      };
    case 'accuracy':
      return {
        title: 'Accuracy and evasion',
        lines: [
          `Melee ${d.accuracy}%  Ranged ${d.rangedAccuracy}%`,
          `80 + 5 × Precision (${d.precision}) + weapon`,
          `Evasion ${d.evasion}`,
        ],
      };
    default:
      return { title: 'Panel', lines: [''] };
  }
}

// ---------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------

/**
 * UI-11's popup screen. It draws over whatever is beneath it and closes on `Esc`, a right-click,
 * or any move key. Free: no turn is spent and no randomness is drawn (TEC-07).
 *
 * @param {object} app the `main.js` application
 * @param {{x?: number, y?: number, stat?: string, avoid?: {x: number, y: number}}} props
 */
export function createInspectScreen(app, props) {
  const content = props.stat ? statPopup(app.game, props.stat) : popupFor(app.game, props.x, props.y);
  const avoid = props.avoid || (props.stat ? null : { x: props.x, y: props.y });

  return {
    id: 'inspect',
    opaque: false,
    free: true,
    draw(buf) {
      const width = POPUP_W;
      const lines = [];
      for (const raw of content.lines) {
        for (const line of wrap(raw, width - 4)) lines.push(line);
      }
      const height = Math.min(POPUP_H, lines.length + 2);
      const at = placePopup(avoid, width, height);
      const inner = box(buf, at.x, at.y, width, height, 'iron', BG_PANEL, content.title);
      for (let i = 0; i < lines.length && i < inner.h; i++) {
        write(buf, inner.x + 1, inner.y + i, lines[i], 'lightGrey', BG_PANEL, inner.w - 1);
      }
    },
    onKey(ev) {
      // UI-11: "Esc, right-click again, or any move key closes it."
      app.pop();
      return true;
    },
    onMouse() {
      app.pop();
      return true;
    },
  };
}

/**
 * UI-11: "positioned to not cover the cell, preferring the side away from it". The box goes to the
 * side of the cell with more room, and is clamped into the grid.
 */
export function placePopup(avoid, width, height) {
  if (!avoid) {
    return { x: Math.floor((COLS - width) / 2), y: Math.floor((ROWS - height) / 2) };
  }
  const rightRoom = MAP_W - avoid.x - 1;
  const x = rightRoom >= width ? Math.min(avoid.x + 1, COLS - width) : Math.max(0, avoid.x - width);
  const downRoom = MAP_H - avoid.y - 1;
  const y = downRoom >= height ? Math.min(avoid.y, MAP_H - height) : Math.max(0, avoid.y - height + 1);
  return { x: Math.max(0, Math.min(x, COLS - width)), y: Math.max(0, Math.min(y, ROWS - height)) };
}

export { chebyshev, isTick, statsOf };
