// Autosave and restore (TEC-09).
//
//   serialize(state)      -> the JSON text TEC-09 stores ("Value: JSON.stringify(state)")
//   deserialize(json)     -> the TEC-05 state, or null when the save must be treated as absent
//   createStore(adapter)  -> { key, has, read, save, load, clear } over an injected adapter
//
// ## Why the storage adapter is injected
//
// PLN-02 R2 exempts only "the storage adapter in `save.js`" from the headless rule, and TEC-02 calls
// it "its only DOM code". There is no DOM code here at all: `createStore` takes the store it should
// write through, so the Node tests hand it a `Map` and M10 hands it `localStorage` (both shapes are
// accepted — see `channel`). That keeps every rule of TEC-09 testable headlessly and leaves R2 with
// nothing to forgive (D-079).
//
// ## What "the whole state" means here
//
// TEC-05 promises one plain object "serializable to JSON", and TEC-09 stores it with a plain
// `JSON.stringify`. `serialize` therefore refuses to write anything JSON cannot carry back
// unchanged — a function, a `Set`, a `Map`, a typed array, a `Date`, `NaN`, `undefined` — instead of
// letting it vanish silently. A milestone that adds such a field to the state fails loudly on its
// first autosave rather than losing the field on the player's next reload (D-080). The one
// documented exception is an enemy's `ai`, the test-only per-enemy decision function of
// `test/fixtures/maps.js`, which is dropped.
//
// Nothing here touches the DOM (PLN-02 R2), and nothing here is a game rule: `engine.js` decides
// *when* to write and delete (TEC-09's trigger list), this module decides *what* a save is.

/** TEC-09: the one save slot. */
export const SAVE_KEY = 'clockworkHollow.save.v1';

/** TEC-09: "if ... `version !== 1`, treat as no save". There is no migration, ever. */
export const SAVE_VERSION = 1;

/**
 * The one key `serialize` is allowed to drop: `test/fixtures/maps.js`'s per-enemy `ai` override,
 * which is a function and exists only in the Node fixtures (D-040, D-080).
 */
const DROPPED_KEYS = new Set(['ai']);

// ---------------------------------------------------------------------------------------------
// serialize
// ---------------------------------------------------------------------------------------------

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'Array';
  const ctor = Object.getPrototypeOf(value) === null ? null : value.constructor;
  return ctor && ctor.name ? ctor.name : typeof value;
}

/**
 * Walk `value` and throw on anything `JSON.parse(JSON.stringify(...))` would not return unchanged.
 *
 * Accepts exactly: `null`, booleans, finite numbers, strings, plain arrays, and plain objects
 * (prototype `Object.prototype` or `null`). Rejects everything else, and rejects a second visit to
 * the same object, which is either a cycle (`JSON.stringify` throws) or aliasing (the round trip
 * silently splits it into two objects).
 *
 * @param {unknown} value
 * @param {string} path a dotted path, for the error message
 * @param {Set<object>} seen
 */
function assertJsonSafe(value, path, seen) {
  if (value === null) return;
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`save: ${path} is ${value}, which JSON cannot carry`);
    return;
  }
  if (t !== 'object') {
    throw new TypeError(`save: ${path} is a ${t}, which JSON cannot carry`);
  }
  if (seen.has(value)) {
    throw new TypeError(`save: ${path} is a cycle or a shared reference, which a round trip would not preserve`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertJsonSafe(value[i], `${path}[${i}]`, seen);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`save: ${path} is a ${typeName(value)}, which JSON cannot carry`);
  }
  for (const key of Object.keys(value)) {
    if (DROPPED_KEYS.has(key) && typeof value[key] === 'function') continue;
    if (value[key] === undefined) {
      throw new TypeError(`save: ${path}.${key} is undefined, which a round trip would drop`);
    }
    assertJsonSafe(value[key], `${path}.${key}`, seen);
  }
}

/**
 * The JSON text of a save (TEC-09).
 *
 * @param {object} state the TEC-05 state
 * @returns {string}
 * @throws {TypeError} if the state holds anything JSON cannot round-trip (see the header)
 */
export function serialize(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('serialize: the state must be an object');
  }
  assertJsonSafe(state, 'state', new Set());
  return JSON.stringify(state, (key, value) => {
    if (DROPPED_KEYS.has(key) && typeof value === 'function') return undefined;
    return value;
  });
}

// ---------------------------------------------------------------------------------------------
// deserialize
// ---------------------------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);

/** TEC-05's grid is 24 rows of 60 numbers (TEC-15 asserts the same about the floor 8 map). */
function isGrid(v) {
  if (!Array.isArray(v) || v.length !== 24) return false;
  for (const row of v) {
    if (!Array.isArray(row) || row.length !== 60) return false;
  }
  return true;
}

function isTickShape(v) {
  if (!isObject(v)) return false;
  for (const k of ['integrity', 'integrityMax', 'tension', 'xp', 'level', 'skillPoints', 'x', 'y']) {
    if (!isInt(v[k])) return false;
  }
  if (!Array.isArray(v.skills) || !Array.isArray(v.activeSlots) || !Array.isArray(v.inventory)) return false;
  return isObject(v.equipment) && isObject(v.statuses);
}

function isFloorShape(v) {
  if (!isObject(v)) return false;
  if (!isInt(v.number) || !isGrid(v.tiles) || !isGrid(v.memory)) return false;
  for (const k of ['items', 'scrap', 'hazards', 'rooms', 'enemies']) if (!Array.isArray(v[k])) return false;
  return isObject(v.features) && isObject(v.roles) && isObject(v.bossFlags) && isInt(v.nextEnemyId);
}

function isJournalShape(v) {
  return isObject(v) && Array.isArray(v.pages) && v.pages.length === 8;
}

/**
 * The TEC-05 fields a save must carry, with the check each one has to pass. `deserialize` reports
 * the first field that fails, so an injected or hand-edited save says what is wrong with it.
 */
const SHAPE = Object.freeze([
  ['version', (v) => v === SAVE_VERSION],
  ['seedString', (v) => typeof v === 'string'],
  ['playRngState', (v) => isInt(v) && v >= 0 && v <= 0xffffffff],
  ['turn', isInt],
  ['floorNumber', isInt],
  ['tick', isTickShape],
  ['floor', isFloorShape],
  ['journal', isJournalShape],
  ['uniquesGenerated', Array.isArray],
  ['log', Array.isArray],
  ['stats', isObject],
  ['flags', isObject],
]);

/**
 * Why this parsed value is not a save, or `null` if it is one.
 *
 * @param {unknown} state
 * @returns {string|null}
 */
export function validate(state) {
  if (!isObject(state)) return 'not an object';
  for (const [key, ok] of SHAPE) {
    if (!ok(state[key])) return `bad or missing '${key}'`;
  }
  return null;
}

/**
 * Read a save (TEC-09): "if the key is missing, or `JSON.parse` fails, or `version !== 1`, treat as
 * no save (and delete it). Never attempt migration." The shape check joins the same branch — a
 * truncated or hand-edited save is no more resumable than a version 0 one.
 *
 * @param {string|null|undefined} json
 * @returns {object|null} the TEC-05 state, restored verbatim, or `null`
 */
export function deserialize(json) {
  if (typeof json !== 'string' || json.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (validate(parsed) !== null) return null;
  // TEC-05: "Derived values (accuracy, evasion, Plating attribute, FOV) are recomputed, never
  // stored", and M04-M08 store no `Set` either (the M09 round-trip test proves it), so there is
  // nothing to rebuild here: `engine.js`'s restore path recomputes `derive()` and the FOV (D-081).
  return parsed;
}

// ---------------------------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------------------------

/**
 * Normalize an injected adapter to one get/set/remove channel.
 *
 * Two shapes are accepted, so no wrapper object is needed at either call site:
 *   * `localStorage`-like — `getItem` / `setItem` / `removeItem` (M10's browser adapter)
 *   * `Map`-like — `get` / `set` / `delete` (the Node tests, PLN-06 M09)
 *
 * A missing key always reads back as `null`, whichever shape the adapter has.
 */
function channel(adapter) {
  if (!adapter) throw new TypeError('createStore: an adapter is required');
  if (typeof adapter.getItem === 'function') {
    return {
      get: (k) => {
        const v = adapter.getItem(k);
        return v === undefined ? null : v;
      },
      set: (k, v) => adapter.setItem(k, v),
      remove: (k) => adapter.removeItem(k),
    };
  }
  if (typeof adapter.get === 'function') {
    return {
      get: (k) => {
        const v = adapter.get(k);
        return v === undefined ? null : v;
      },
      set: (k, v) => adapter.set(k, v),
      remove: (k) => adapter.delete(k),
    };
  }
  throw new TypeError('createStore: the adapter needs getItem/setItem/removeItem or get/set/delete');
}

/**
 * The single-slot save store of TEC-09, over an injected adapter.
 *
 * `engine.js` calls `save` from the CMB-02 step 9 hook and `clear` on death and victory; the UI
 * (M10) calls `load` for Continue, `save` when leaving to the title via Pause (UI-18), and `clear`
 * for Abandon (UI-17).
 *
 * @param {{getItem?: Function, setItem?: Function, removeItem?: Function,
 *          get?: Function, set?: Function, delete?: Function}} adapter
 * @param {string} [key] the storage key; TEC-09 fixes the default
 */
export function createStore(adapter, key = SAVE_KEY) {
  const io = channel(adapter);
  return {
    key,

    /** Is there something under the key? (UI-17: Continue is offered only then.) */
    has() {
      return io.get(key) !== null;
    },

    /** The raw stored text, or null — for the tests that assert a save was not touched. */
    read() {
      return io.get(key);
    },

    /** Write the state (TEC-09's trigger list is `engine.js`'s business, not this module's). */
    save(state) {
      io.set(key, serialize(state));
      return true;
    },

    /**
     * The saved state, or `null`. An unreadable, wrong-version or malformed save is deleted on the
     * way out, exactly as TEC-09 requires ("treat as no save (and delete it)").
     */
    load() {
      const raw = io.get(key);
      if (raw === null) return null;
      const state = deserialize(raw);
      if (state === null) {
        io.remove(key);
        return null;
      }
      return state;
    },

    /** Delete the save: death, victory, Abandon (TEC-09). */
    clear() {
      io.remove(key);
      return true;
    },
  };
}
