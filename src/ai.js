// Enemy decisions — the M04 stub (PLN-06 M04 task 2, M06).
//
// **This module is a contract.** M06 replaces it *in place* with the archetypes of ENM-06 and the
// boss scripts of BST-04..06. `turn.js` calls `decide` once for every enemy action of the enemy
// phase (CMB-03) and executes whatever it returns, so M06 needs no engine edit.
//
// M04 ships a stub that always **Waits**: enemies exist, block movement, wake, burn, fall in
// hazards and can be attacked, but they never act. Tests that need an enemy to act supply their own
// decision function through the fixture's `ai` override (`test/fixtures/maps.js`), which `turn.js`
// prefers over this module — that keeps the M04 tests exact once M06 lands.
//
// ## The enemy action schema (executed by `turn.js#performEnemyAction`)
//
//   { type: 'wait' }                           do nothing
//   { type: 'move', x, y }                     step to an adjacent tile (hazard ENTER applies)
//   { type: 'melee', x, y }                    CMB-06 against the actor on that tile
//   { type: 'heavy', x, y }                    BRUISER heavy attack: `heavyAttack` dice, accuracy +10
//   { type: 'ranged', x, y }                   CMB-08 with the type's `ranged` block
//   { type: 'openDoor', x, y }                 ENM-09 YES — the door opens, noise 3, no move
//   { type: 'breakDoor', x, y }                ENM-09 BREAKS — the door becomes Floor, noise 6
//   { type: 'telegraph', flag, message? }      set `windingUp`/`ventingUp`/`pulsingUp` (+ log line)
//   { type: 'special', id, ... }               boss specials (M08), dispatched to `ctx.bossSpecial`
//
// An enemy's own bookkeeping — ENM-05 tracking (`lastKnown`, `lastKnownAge`), ENM-03 state changes
// to RETURNING/DORMANT, and clearing a wind-up flag — is the AI's business: `decide` receives the
// live instance and may mutate those fields before returning its action. Everything with a rule in
// `10-turns-and-combat.md` (damage, noise, statuses, death) belongs to `combat.js` instead.

/** The action every actor may always take. */
export const WAIT = Object.freeze({ type: 'wait' });

/**
 * Choose one enemy action (ENM-06).
 *
 * @param {object} enemy the live enemy instance (`actors.createEnemy`)
 * @param {object} state the TEC-05 state
 * @param {{rng: {next: () => number}, lines: object[], emit: Function,
 *          noises: {x: number, y: number, r: number}[]}} [ctx]
 *        the engine turn context: the play RNG (ERRATIC's `d10`, ENM-06), the log line array, the
 *        event sink, and every noise emitted so far this turn (ENM-05's `perception + 3` refresh).
 * @returns {{type: string}} one action from the schema above
 */
export function decide(enemy, state, ctx) {
  return WAIT;
}
