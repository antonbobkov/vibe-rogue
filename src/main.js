// Boot, screen stack, input dispatch, timers, frame loop (TEC-02, TEC-06, TEC-10..TEC-13).
//
// This is the only module that owns the browser: the canvas, the `window` listeners, the timers
// that drive `travel.js` (TEC-11), the `localStorage` adapter the save store writes through
// (TEC-09), and `window.CH` (TEC-13). Everything it draws it draws through `render.js` into one
// 80 x 30 cell buffer, which is also what `CH.grid()` hands the browser tests (PLN-03).
//
// One of the DOM-allowed modules (PLN-02 R2). `input.js` and `travel.js` stay pure: they receive
// plain event data and are driven by the timers here.

import {
  COLS, ROWS, BG, FLASH_MS,
  createBuffer, clearBuffer, createCanvasRenderer,
} from './render.js';
import { regionOf } from './input.js';
import { createGame } from './engine.js';
import { createStore } from './save.js';
import { mulberry32, fnv1a, queueRng } from './rng.js';
import * as travel from './travel.js';

import { createRunScreen } from './screens/run.js';
import { createInspectScreen } from './screens/inspect.js';
import { createTitleScreen } from './screens/title.js';
import { createInventoryScreen } from './screens/inventory.js';
import { createSkillsScreen } from './screens/skills.js';
import { createJournalScreen } from './screens/journal.js';
import { createHelpScreen } from './screens/help.js';
import { createHistoryScreen } from './screens/history.js';
import { createTextboxScreen } from './screens/textbox.js';
import { createEndingChoiceScreen } from './screens/endingChoice.js';
import { createSummaryScreen } from './screens/summary.js';
import { createPauseScreen } from './screens/pause.js';
import { createTargetingScreen } from './screens/targeting.js';

/** TEC-07: a random run's seed is 8 characters of this alphabet. */
const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SEED_LENGTH = 8;

/** SCR-07: Ending B's descent holds each line 1.5 seconds. */
export const DESCENT_MS = 1500;

const canvas = document.getElementById('game');
const seedInput = document.getElementById('seed');
const renderer = createCanvasRenderer(canvas);

// ---------------------------------------------------------------------------------------------
// Timers (TEC-11, TEC-14: idle CPU is zero — nothing runs when nothing is animating)
// ---------------------------------------------------------------------------------------------

/** Every live timer, so `CH.timers()` can report the TEC-14 idle check. */
const liveTimers = new Set();

function addTimer(kind, cancel) {
  const handle = { kind, cancel };
  liveTimers.add(handle);
  return handle;
}

function clearTimer(handle) {
  if (!handle || !liveTimers.has(handle)) return;
  liveTimers.delete(handle);
  handle.cancel();
}

function later(kind, ms, fn) {
  let handle = null;
  const id = window.setTimeout(() => {
    liveTimers.delete(handle);
    fn();
  }, ms);
  handle = addTimer(kind, () => window.clearTimeout(id));
  return handle;
}

// ---------------------------------------------------------------------------------------------
// The application
// ---------------------------------------------------------------------------------------------

/** TEC-09: the one piece of DOM the save layer touches (D-079 keeps `save.js` itself clean). */
const store = createStore(window.localStorage);

let game = null;
let buffer = createBuffer();
let dirty = true;
let stack = [];
let hover = null;

/** UI-09 rule 6: the two one-frame flashes and when they expire. */
const flash = { tick: false, cells: [], until: 0 };
let flashTimer = null;

/** The engine events the UI has not turned into overlays yet, and the log `CH.events()` drains. */
let eventQueue = [];
let seenEvents = [];

/** The repeating stepper of UI-13 Travel / UI-10 Shift-run, and its timer. */
let stepper = null;
let stepTimer = null;
let runKey = null;

/**
 * The `event.code` of the key being dispatched right now, so a Shift-run started by a screen knows
 * which key release ends it (TEC-11: "releasing the key stops"). `input.js` stays pure, so the
 * code travels this way rather than inside the intent.
 */
let currentKeyCode = null;

function markDirty() {
  dirty = true;
}

/** TEC-10: redraw only when something changed. */
function drawFrame() {
  clearBuffer(buffer, BG);
  // TEC-06: the top screen is drawn last; everything from the topmost opaque screen up is drawn.
  let base = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].opaque) {
      base = i;
      break;
    }
  }
  for (let i = base; i < stack.length; i++) stack[i].draw(buffer);
  renderer.paint(buffer);
  dirty = false;
}

function paintIfDirty() {
  if (dirty) drawFrame();
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.resize(width, height, window.devicePixelRatio || 1);
  markDirty();
  paintIfDirty();
}

// ---------------------------------------------------------------------------------------------
// TEC-06 — the screen stack
// ---------------------------------------------------------------------------------------------

function top() {
  return stack.length === 0 ? null : stack[stack.length - 1];
}

function push(screen) {
  stack.push(screen);
  markDirty();
  paintIfDirty();
  return screen;
}

function pop() {
  const gone = stack.pop();
  markDirty();
  paintIfDirty();
  return gone;
}

/** Title, Death, Victory and the Run screen replace the stack (TEC-06). */
function reset(screen) {
  stack = [screen];
  markDirty();
  paintIfDirty();
  return screen;
}

/** Is a screen with this id already open? */
function isOpen(id) {
  return stack.some((s) => s.id === id);
}

function popTo(id) {
  while (stack.length > 1 && top().id !== id) stack.pop();
  markDirty();
}

// ---------------------------------------------------------------------------------------------
// PLN-03 — consuming engine events
// ---------------------------------------------------------------------------------------------

function enqueue(events) {
  for (const event of events) {
    eventQueue.push(event);
    seenEvents.push(event);
  }
}

/** Is the top of the stack an overlay that must be answered before the queue moves on? */
function blocked() {
  const screen = top();
  return Boolean(screen && screen.blocking);
}

/**
 * Walk the queued events in order, pushing the overlay each one asks for (PLN-03, UI-19).
 *
 * The UI owns this walk rather than reading `phase` per box: the ending sequence hands over
 * `journal`, `descent`, `textbox` and `victory` together, with `phase` already `ended` (M08), so
 * there is no `awaitDismiss` to step through (D-096). Where the engine *is* waiting, dismissing the
 * overlay also acts `dismiss`, which is what lets the turn loop continue (UI-16).
 */
function pump() {
  while (eventQueue.length > 0 && !blocked()) {
    const event = eventQueue.shift();
    switch (event.type) {
      case 'textbox':
        push(screens.textbox({ id: event.id, text: event.text, onDone: advance }));
        break;
      case 'journal':
        push(screens.journal({ page: event.page, blocking: true, onDone: advance }));
        break;
      case 'descent':
        push(screens.descent({ lines: event.lines, onDone: advance }));
        break;
      case 'choice':
        push(screens.endingChoice({ id: event.id, text: event.text, options: event.options }));
        break;
      case 'levelUp':
        // CHR-07 / UI-19: a level-up opens the Skills screen. Non-blocking (PLN-03).
        if (!isOpen('skills')) push(screens.skills());
        break;
      case 'flash':
        startFlash(event);
        break;
      case 'floor':
        markDirty();
        break;
      case 'death':
        reset(screens.summary({ kind: 'death', event }));
        break;
      case 'victory':
        reset(screens.summary({ kind: 'victory', event }));
        break;
      default:
        break;
    }
  }
  markDirty();
}

/** A blocking overlay was answered: tell the engine, then take the next event. */
function advance() {
  if (game && game.phase === 'awaitDismiss') {
    game.act({ type: 'dismiss' });
    enqueue(game.drainEvents());
  }
  pump();
  paintIfDirty();
}

// ---------------------------------------------------------------------------------------------
// UI-09 rule 6 — the flashes
// ---------------------------------------------------------------------------------------------

function startFlash(event) {
  if (event.kind === 'tick') flash.tick = true;
  else flash.cells.push({ x: event.x, y: event.y });
  flash.until = Date.now() + FLASH_MS;
  markDirty();
  if (flashTimer) return;
  // TEC-10: "a requestAnimationFrame loop runs only while a flash ... is pending."
  const tick = () => {
    if (Date.now() >= flash.until) {
      liveTimers.delete(flashTimer);
      flashTimer = null;
      flash.tick = false;
      flash.cells = [];
      markDirty();
      paintIfDirty();
      return;
    }
    paintIfDirty();
    const id = window.requestAnimationFrame(tick);
    flashTimer.cancel = () => window.cancelAnimationFrame(id);
  };
  const id = window.requestAnimationFrame(tick);
  flashTimer = addTimer('flash', () => window.cancelAnimationFrame(id));
}

function clearFlash() {
  if (flashTimer) {
    clearTimer(flashTimer);
    flashTimer = null;
  }
  flash.tick = false;
  flash.cells = [];
}

// ---------------------------------------------------------------------------------------------
// UI-13 / UI-10 — Travel and Shift-run, on the timers TEC-11 fixes
// ---------------------------------------------------------------------------------------------

function stopStepper() {
  if (stepTimer) {
    clearTimer(stepTimer);
    stepTimer = null;
  }
  stepper = null;
  runKey = null;
}

/** UI-13: "stop when ... the player presses any key or clicks". */
function interruptStepper() {
  if (!stepper) return false;
  stepper.interrupt();
  stopStepper();
  enqueue(game.drainEvents());
  pump();
  markDirty();
  return true;
}

function scheduleStep(ms) {
  stepTimer = later('step', ms, () => {
    stepTimer = null;
    if (!stepper) return;
    const result = stepper.step();
    enqueue(game.drainEvents());
    pump();
    markDirty();
    if (result.done || !stepper) {
      stopStepper();
      paintIfDirty();
      return;
    }
    scheduleStep(stepper.stepMs);
    paintIfDirty();
  });
}

function startStepper(next) {
  stopStepper();
  stepper = next;
  // The first step is taken at once, so one keypress or click always does something.
  const result = stepper.step();
  enqueue(game.drainEvents());
  pump();
  markDirty();
  if (result.done) {
    stopStepper();
    paintIfDirty();
    return;
  }
  scheduleStep(stepper.stepMs);
  paintIfDirty();
}

function startTravel(x, y) {
  if (!game || game.phase !== 'run') return;
  const path = travel.travelPathTo(game.state, x, y);
  if (!path || path.length === 0) return;
  startStepper(travel.createTravel(game, path));
}

function startApproach(x, y) {
  if (!game || game.phase !== 'run') return;
  const path = travel.approachPathTo(game.state, x, y);
  if (!path || path.length === 0) return;
  startStepper(travel.createTravel(game, path));
}

function startRun(dx, dy, code) {
  if (!game || game.phase !== 'run') return;
  const held = code === undefined ? currentKeyCode : code;
  startStepper(travel.createRun(game, dx, dy));
  // `startStepper` clears the previous run's key, so the new one is recorded after it.
  if (stepper) runKey = held || null;
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

/** One engine action, with its events turned into overlays (PLN-03 data flow). */
function act(action) {
  if (!game) return { ok: false, reason: 'noGame', log: [], events: [] };
  const result = game.act(action);
  enqueue(game.drainEvents());
  pump();
  markDirty();
  paintIfDirty();
  return result;
}

const SCREEN_FACTORIES = {
  inventory: () => screens.inventory(),
  skills: () => screens.skills(),
  journal: () => screens.journal({}),
  history: () => screens.history(),
  help: () => screens.help(),
};

/** UI-10 / UI-13: open one of the five overlay screens, or close it if it is already the top. */
function openScreen(id) {
  const factory = SCREEN_FACTORIES[id];
  if (!factory) return false;
  if (top() && top().id === id) {
    pop();
    return true;
  }
  push(factory());
  return true;
}

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

function randomSeed() {
  let out = '';
  for (let i = 0; i < SEED_LENGTH; i++) {
    out += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
  }
  return out;
}

/** TEC-07: the seed string is what the player typed, trimmed to 16 characters. */
export function normalizeSeed(text) {
  const trimmed = String(text === undefined || text === null ? '' : text).trim().slice(0, 16);
  return trimmed.length > 0 ? trimmed : randomSeed();
}

function beginRun(newGame) {
  game = newGame;
  eventQueue = [];
  clearFlash();
  stopStepper();
  hover = null;
  reset(screens.run());
  enqueue(game.drainEvents());
  pump();
  paintIfDirty();
  return game;
}

/** UI-17 / UI-19: New run (or a confirmed seed) — the intro text box, then floor 1. */
function newRun(seedString) {
  return beginRun(createGame({ seedString: normalizeSeed(seedString), store }));
}

/** UI-17 / TEC-09: Continue — the saved state, restored verbatim, straight onto the Run screen. */
function continueRun() {
  const saved = store.load();
  if (!saved) return null;
  return beginRun(createGame({ state: saved, store }));
}

/** UI-18: Quit to title. The autosave remains — this is TEC-09's one non-action trigger. */
function toTitle() {
  if (game && game.phase === 'run') game.autosave();
  stopStepper();
  clearFlash();
  eventQueue = [];
  hover = null;
  reset(screens.title());
  paintIfDirty();
}

// ---------------------------------------------------------------------------------------------
// TEC-12 — the hidden input the seed is copied from
// ---------------------------------------------------------------------------------------------

function offerSeedForCopy(text) {
  if (!seedInput) return;
  seedInput.hidden = false;
  seedInput.value = String(text === undefined || text === null ? '' : text);
  try {
    seedInput.focus({ preventScroll: true });
    seedInput.select();
  } catch {
    // A browser that refuses focus still shows the seed in the grid (UI-17).
  }
}

function hideSeedInput() {
  if (!seedInput) return;
  seedInput.hidden = true;
  seedInput.value = '';
}

// ---------------------------------------------------------------------------------------------
// The app object the screens are built against
// ---------------------------------------------------------------------------------------------

const app = {
  get game() {
    return game;
  },
  get hover() {
    return hover;
  },
  get flash() {
    return flash;
  },
  get stack() {
    return stack;
  },
  get store() {
    return store;
  },
  screens: null,
  markDirty,
  push,
  pop,
  reset,
  popTo,
  isOpen,
  act,
  openScreen,
  startTravel,
  startApproach,
  startRun,
  stopStepper,
  newRun,
  continueRun,
  toTitle,
  offerSeedForCopy,
  hideSeedInput,
  later,
  clearTimer,
  descentMs: DESCENT_MS,
};

const screens = {
  run: () => createRunScreen(app),
  inspect: (props) => createInspectScreen(app, props || {}),
  title: () => createTitleScreen(app),
  inventory: () => createInventoryScreen(app),
  skills: (props) => createSkillsScreen(app, props || {}),
  journal: (props) => createJournalScreen(app, props || {}),
  help: () => createHelpScreen(app),
  history: () => createHistoryScreen(app),
  textbox: (props) => createTextboxScreen(app, props),
  descent: (props) => createTextboxScreen(app, { ...props, descent: true }),
  endingChoice: (props) => createEndingChoiceScreen(app, props),
  summary: (props) => createSummaryScreen(app, props),
  pause: () => createPauseScreen(app),
  targeting: (props) => createTargetingScreen(app, props),
};

app.screens = screens;

// ---------------------------------------------------------------------------------------------
// TEC-11 — the listeners
// ---------------------------------------------------------------------------------------------

/** The keys the page must not scroll on (TEC-11: `preventDefault()` for handled keys). */
const NEVER_SCROLL = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End',
  'Space', 'Tab', 'Enter',
]);

function keyData(ev) {
  return { code: ev.code, key: ev.key, shiftKey: ev.shiftKey };
}

function onKeyDown(ev) {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (stepper) {
    // The held keys of a Shift-run repeat while it runs; they must not interrupt it (TEC-11).
    if (runKey !== null && (ev.code === runKey || ev.key === 'Shift')) {
      if (NEVER_SCROLL.has(ev.code)) ev.preventDefault();
      return;
    }
    // UI-13: any other key stops a Travel or a run, and is consumed by the stop.
    interruptStepper();
    if (NEVER_SCROLL.has(ev.code)) ev.preventDefault();
    paintIfDirty();
    return;
  }
  const screen = top();
  if (!screen) return;
  currentKeyCode = ev.code;
  let handled = false;
  try {
    handled = screen.onKey ? screen.onKey(keyData(ev)) : false;
  } finally {
    currentKeyCode = null;
  }
  if (handled || NEVER_SCROLL.has(ev.code)) ev.preventDefault();
  paintIfDirty();
}

function onKeyUp(ev) {
  // TEC-11: "releasing the key stops" a Shift-run.
  if (!stepper || runKey === null) return;
  if (ev.code === runKey || ev.key === 'Shift') {
    stopStepper();
    markDirty();
    paintIfDirty();
  }
}

function cellOf(ev) {
  const rect = canvas.getBoundingClientRect();
  return renderer.cellAt(ev.clientX - rect.left, ev.clientY - rect.top);
}

function onMouseMove(ev) {
  const cell = cellOf(ev);
  const next = cell ? regionOf(cell) : null;
  const same = (!next && !hover)
    || (next && hover && next.region === hover.region && next.x === hover.x && next.y === hover.y);
  if (same) return;
  hover = next;
  const screen = top();
  if (screen && screen.onHover) screen.onHover(hover);
  markDirty();
  paintIfDirty();
}

function onMouseDown(ev) {
  if (interruptStepper()) {
    paintIfDirty();
    return;
  }
  const cell = cellOf(ev);
  const screen = top();
  if (!screen) return;
  if (screen.onMouse) screen.onMouse({ cell, button: ev.button, region: cell ? regionOf(cell) : null });
  paintIfDirty();
}

function onContextMenu(ev) {
  // TEC-11: `contextmenu` is prevented and treated as a right-click.
  ev.preventDefault();
}

function onWheel(ev) {
  const screen = top();
  if (screen && screen.onWheel) {
    screen.onWheel({ delta: ev.deltaY > 0 ? 1 : -1 });
    ev.preventDefault();
    paintIfDirty();
  }
}

window.addEventListener('resize', resize);
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('contextmenu', onContextMenu);
canvas.addEventListener('wheel', onWheel, { passive: false });

// ---------------------------------------------------------------------------------------------
// TEC-13 — the debug and test hooks
// ---------------------------------------------------------------------------------------------

/**
 * TEC-13's `window.CH`. Read-only except `act`, `newRun`, `loadFloor`, `loadFixture` and
 * `queueRng` (PLN-07.3). `metrics()` is the one hook added for M10: TEC-10's canvas sizing is the
 * only UI rule that leaves no trace in the cell buffer (D-091).
 */
const CH = {
  get state() {
    return game ? game.state : null;
  },
  get game() {
    return game;
  },
  get playRng() {
    return game ? game.ctx.rng : null;
  },
  /** TEC-07's per-floor stream, for the tests that recompute a floor's seed. */
  floorRng(n) {
    const seed = game ? game.state.seedString : '';
    return mulberry32(fnv1a(`${seed}:floor:${n}`));
  },
  act(action) {
    return act(action);
  },
  newRun(seed) {
    newRun(seed);
    return game.state;
  },
  loadFloor(n) {
    if (!game) return null;
    const floor = game.loadFloor(n);
    enqueue(game.drainEvents());
    pump();
    markDirty();
    paintIfDirty();
    return floor;
  },
  /**
   * TEC-13: replace the current floor with a `test/fixtures/maps.js` ASCII map, keeping Tick's
   * stats. The fixture loader lives under `test/`, so it is imported on demand — nothing under
   * `src/` depends on it, so this hook returns a promise (PLN-04, D-095).
   */
  async loadFixture(rows, opts) {
    if (!game) return null;
    let data = rows;
    if (Array.isArray(rows)) {
      const mod = await import('../test/fixtures/maps.js');
      data = mod.floorFromAscii(rows, opts || {});
    }
    const floor = game.loadFixture(data);
    enqueue(game.drainEvents());
    pump();
    markDirty();
    paintIfDirty();
    return { number: floor.number, name: floor.name };
  },
  /** The last rendered 80 x 30 buffer as rows of `{glyph, fg, bg}` (TEC-13). */
  grid() {
    paintIfDirty();
    return buffer.map((row) => row.map((c) => ({ glyph: c.glyph, fg: c.fg, bg: c.bg })));
  },
  /** The UI's pending engine events, returned and cleared (TEC-13). */
  events() {
    const out = seenEvents;
    seenEvents = [];
    return out;
  },
  /** Replace the play RNG with a scripted sequence; it throws when exhausted (PLN-03). */
  queueRng(values) {
    if (!game) return null;
    game.ctx.rng = queueRng(values);
    return game.ctx.rng;
  },
  /** A forced full redraw, and how long it took in ms (TEC-13, TEC-14). */
  render() {
    const started = performance.now();
    drawFrame();
    return performance.now() - started;
  },
  /** How many timers are live — TEC-14's idle check. */
  timers() {
    return liveTimers.size;
  },
  /** TEC-10's canvas metrics, which the cell buffer cannot show (D-091). */
  metrics() {
    const m = renderer.metrics;
    return {
      cell: m.cell,
      cellW: m.cellW,
      cellH: m.cellH,
      gridW: m.gridW,
      gridH: m.gridH,
      originX: m.originX,
      originY: m.originY,
      width: m.width,
      height: m.height,
      cols: m.cols,
      rows: m.rows,
      aspect: m.aspect,
      integer: m.integer,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
  },
};

window.CH = CH;

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------

// TEC-09: a missing, corrupt or version-≠-1 save is removed here, so the Title screen's Continue
// entry is offered only for a save that can actually be resumed (ACC-05).
if (store.has() && store.load() === null) store.clear();

resize();
reset(screens.title());
paintIfDirty();

export { app, CH };
