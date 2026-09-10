// The story layer: the three scripted moments of STY-05 / SCR-05, the boss entry triggers of
// BST-04–06, and the ending state machine of STY-07 / SCR-07 / UI-19.
//
// **This module is a contract**, like `items.js`, `skills.js` and `bosses.js`. What the engine
// calls, and from where:
//
//   * `onFloorEntered(ctx)`        — `engine.js#enterFloor` (BST-04's entry trigger).
//   * `afterView(ctx, visible)`    — `engine.js#updateView`, CMB-02 step 10: moment 1 (FLR-04) and
//                                    the Regulator's sight trigger (BST-05).
//   * `onRecordTaken(ctx, def)`    — `items.js#takeRecord` through `ctx.hooks.onRecordTaken`:
//                                    moment 2 fires on the Understudy Blueprint (FLR-07).
//   * `onDoorOpened(ctx, x, y)`    — `engine.js#doMove`: the antechamber door of FLR-09 (BST-06).
//   * `onEnemyBroken(ctx, enemy)`  — `combat.breakActor` through `ctx.hooks.onEnemyBroken`: the
//                                    Understudy's defeat sequence (BST-06, ACC-96).
//   * `choose(ctx, option)`        — `engine.js`'s `choose` action (SCR-07, UI-19).
//
// Every string comes from `data/script.js` (R1); nothing here touches the DOM (R2).
//
// ## The event sequence a full ending emits (UI-19, PLN-03)
//
// The Understudy's defeat, inside the turn that broke it:
//   textbox moment3a → textbox moment3b → choice          (phase awaitDismiss, then awaitChoice)
// `choose('A')`:
//   journal 8 → textbox endingA → victory                 (phase ended)
// `choose('B')`:
//   journal 8 → descent (7 lines) → textbox endingB → victory

import { idx } from './grid.js';
import * as bosses from './bosses.js';
import { SCRIPT } from '../data/script.js';

/** The two endings of STY-07, as the `victory` event names them. */
export const ENDINGS = Object.freeze(['A', 'B']);

/** SCR-07: page 8 is delivered by the ending sequence, not by a journal room (FLR-09). */
export const FINAL_PAGE = 8;

/** The floors the scripted moments live on (FLR-04, FLR-07, FLR-09). */
export const MOMENT_1_FLOOR = 3;
export const MOMENT_2_FLOOR = 6;
export const UNDERSTUDY_FLOOR = 8;

// ---------------------------------------------------------------------------------------------
// STY-05 — the once-per-run moment flags
// ---------------------------------------------------------------------------------------------

/** Has this scripted moment already fired this run? (`state.flags.momentsSeen`, TEC-05.) */
export function seen(state, id) {
  const list = state.flags.momentsSeen;
  return Array.isArray(list) && list.includes(id);
}

function mark(state, id) {
  if (!Array.isArray(state.flags.momentsSeen)) state.flags.momentsSeen = [];
  if (!state.flags.momentsSeen.includes(id)) state.flags.momentsSeen.push(id);
}

/**
 * STY-05: "Scripted moments are single-turn interruptions: the game shows a text box, the player
 * dismisses it, play resumes. They never take a turn." The text box is a blocking event, so
 * `engine.phase` is `awaitDismiss` until the UI sends `dismiss` (UI-16, ACC-114).
 */
function moment(ctx, id, text) {
  mark(ctx.state, id);
  ctx.emit({ type: 'textbox', id, text });
}

// ---------------------------------------------------------------------------------------------
// Floor entry and field of view
// ---------------------------------------------------------------------------------------------

/** Called on every floor entry, before the `floor` event (BST-04's entry trigger = floor start). */
export function onFloorEntered(ctx) {
  bosses.onFloorEntered(ctx);
}

/**
 * CMB-02 step 10 — what Tick can now see.
 *
 * FLR-04: moment 1 "fires the first time any interior tile of the stairs room enters Tick's FOV;
 * at that moment the Conductor counts Tick as seen." BST-05: the Regulator's entry trigger is
 * "the first time any tile of the stairs room is in Tick's FOV".
 */
export function afterView(ctx, visible) {
  const state = ctx.state;
  if (!state.floor || state.dead || state.victory) return;

  if (state.floorNumber === MOMENT_1_FLOOR && !seen(state, 'moment1') && stairsRoomVisible(state, visible)) {
    bosses.conductorSeesTick(ctx);
    moment(ctx, 'moment1', SCRIPT.moments[1]);
  }

  if (state.floorNumber === MOMENT_2_FLOOR && stairsRoomVisible(state, visible)) {
    bosses.triggerEntry(ctx, 'REGULATOR');
  }
}

/** The stairs room's interior rectangle, as `gen.js` writes `rooms` and `roles` (WLD-11 step 5). */
export function stairsRoom(state) {
  const floor = state.floor;
  if (!floor || !floor.roles || floor.roles.stairs === undefined) return null;
  const rooms = floor.rooms || [];
  for (const r of rooms) if (r.id === floor.roles.stairs) return r;
  return rooms[floor.roles.stairs] || null;
}

/** Is any tile of the stairs room in `visible`? */
function stairsRoomVisible(state, visible) {
  const room = stairsRoom(state);
  if (!room || !visible) return false;
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) if (visible.has(idx(x, y))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Moment 2 and the Understudy's entry
// ---------------------------------------------------------------------------------------------

/** FLR-07 / STY-05: moment 2 fires on picking up the Understudy Blueprint (`items.js`'s hook). */
export function onRecordTaken(ctx, def) {
  if (!def || def.blueprint !== true) return;
  if (seen(ctx.state, 'moment2')) return;
  moment(ctx, 'moment2', SCRIPT.moments[2]);
}

/**
 * BST-06's entry trigger: "Tick opens the door at the antechamber (the `+` on the map). At that
 * moment: text box with line 1 (SCR-06), then the Understudy is Active with `lastKnown` = Tick's
 * tile." FLR-09's chamber holds exactly one door, so any door Tick opens on floor 8 is that one.
 */
export function onDoorOpened(ctx, x, y) {
  const state = ctx.state;
  if (state.floorNumber !== UNDERSTUDY_FLOOR) return;
  const boss = bosses.triggerEntry(ctx, 'UNDERSTUDY');
  if (!boss) return;
  ctx.emit({ type: 'textbox', id: 'understudy1', text: SCRIPT.understudy[1] });
}

// ---------------------------------------------------------------------------------------------
// BST-06 — the defeat sequence
// ---------------------------------------------------------------------------------------------

/**
 * `ctx.hooks.onEnemyBroken`, after `skills.js`'s own hook (SKL-05, D-069).
 *
 * BST-06: "On defeat (Integrity ≤ 0 or spring 0): no scrap, no XP. Text box with the defeat
 * description and line 4, then thought 3, then the ending choice (UI-19)." The XP is 0 in
 * `data/enemies.js`; the scrap `combat.breakActor` left behind is taken back here, and the break
 * still counts for Salvage, Sympathetic Break and the ITM-11 drop roll (D-077).
 */
export function onEnemyBroken(ctx, enemy) {
  if (bosses.bossScriptOf(enemy) !== 'UNDERSTUDY') return;
  const state = ctx.state;

  const scrap = state.floor.scrap;
  for (let i = scrap.length - 1; i >= 0; i--) {
    if (scrap[i].x === enemy.x && scrap[i].y === enemy.y) {
      scrap.splice(i, 1);
      break;
    }
  }
  if (seen(state, 'moment3')) return;
  mark(state, 'moment3');

  // SCR-05 moment 3: the first box carries the defeat description and line 4, the second thought 3.
  ctx.emit({ type: 'textbox', id: 'moment3a', text: SCRIPT.moments['3a'] });
  ctx.emit({ type: 'textbox', id: 'moment3b', text: SCRIPT.moments['3b'] });
  // UI-17: the Ending choice is one screen — the setup text and the two options (D-071).
  ctx.emit({
    type: 'choice',
    id: 'endingChoice',
    text: SCRIPT.endingChoice,
    options: SCRIPT.endingOptions.slice(),
  });
}

// ---------------------------------------------------------------------------------------------
// STY-07 / SCR-07 — the ending machine
// ---------------------------------------------------------------------------------------------

/**
 * The `choose` action (PLN-03). SCR-07: "After the choice, before either ending: Tick takes page 8
 * from the chair. It is shown as a Journal page view … and marked found." Then Ending B's descent,
 * then the ending text, then the Victory screen (UI-19).
 *
 * All of it is emitted by this one action and `state.victory` is set, so `engine.phase` becomes
 * `ended`: the UI walks the queued events in order (PLN-06 M08 task 4).
 */
export function choose(ctx, option) {
  const state = ctx.state;
  const ending = typeof option === 'string' ? option.toUpperCase() : '';
  if (!ENDINGS.includes(ending)) return { ok: false, reason: 'badOption' };

  state.journal.pages[FINAL_PAGE - 1] = true;
  ctx.emit({ type: 'journal', page: FINAL_PAGE });

  if (ending === 'B') ctx.emit({ type: 'descent', lines: SCRIPT.descent.slice() });

  ctx.emit({
    type: 'textbox',
    id: ending === 'A' ? 'endingA' : 'endingB',
    text: ending === 'A' ? SCRIPT.endingA : SCRIPT.endingB,
  });

  const screen = ending === 'A' ? SCRIPT.screens.keeper : SCRIPT.screens.walker;
  state.victory = { ending, floor: state.floorNumber, turn: state.turn };
  ctx.emit({
    type: 'victory',
    ending,
    header: screen.header,
    flavor: screen.flavor,
    summary: ctx.summary(),
  });
  return { ok: true };
}
