# 20 — Skills Catalog

**Status:** Wave 3 — content. Framework rules are in `11-character-and-skills.md` (`CHR-09`, `CHR-10`).
**Purpose:** Specify all twelve skills completely: cost, effect, numbers, targeting, and display text.

---

## SKL-01 Conventions

- **Type:** `P` passive (always on from the moment it is taken) or `A` active (costs a turn and Tension).
- **Cost:** Tension paid before the effect (`CHR-04`). If unaffordable, the action is refused and no turn
  is spent (`CMB-05`).
- **Target:** `self`, `direction` (choose one of 8 adjacent tiles; only valid if an enemy is there),
  `tile` (targeting mode `UI-12`), `adjacent-free` (choose an adjacent walkable, unoccupied tile).
- **Text** is shown on the Skills screen exactly as written: a one-line summary (≤ 60 chars) and a
  description (≤ 40 words).
- Passive attribute bonuses are recomputed per `CHR-08`.

## SKL-02 Armature

| Rank | Name | Type | Cost | Target |
|---|---|---|---|---|
| 1 | **Braced Frame** | P | — | — |
| 2 | **Overwind Strike** | A | 8 | direction |
| 3 | **Flywheel Guard** | A | 10 | self |
| 4 | **Piston Drive** | P | — | — |

### Braced Frame
- Effect: Plating +1. `integrityMax` +6 and `integrity` +6 immediately when taken.
- Summary: `+1 Plating, +6 max Integrity.`
- Description: *Cross-bracing in the frame. Aurelie's note on the drawing: "should have done this first."*

### Overwind Strike
- Effect: a melee attack (`CMB-06`) against the enemy in the chosen direction, with the equipped weapon,
  rolling the weapon's `dice` **twice** and summing (Force added once), and accuracy +25. The weapon's
  `special` applies normally. Noise 6 instead of 5.
- Summary: `Melee hit: double weapon dice, +25 accuracy. 8 Tension.`
- Description: *Let the spring out all at once into the arm. Loud, and the spring feels it.*

### Flywheel Guard
- Effect: for 4 turns (a status-like timer shown in the panel's status row as `Guard(n)`, but not one
  of the five statuses and not removable): Plating +3; Tick cannot be Stunned or knocked back.
  Reusing while active resets the timer to 4.
- Summary: `4 turns: +3 Plating, immune to Stun and knockback. 10 Tension.`
- Description: *Spin the flywheel up and let it hold you steady. Four turns, then it runs down.*

### Piston Drive
- Effect: Force +2. Whenever a melee hit by Tick deals **≥ 6** damage after Plating, the target is
  knocked back 1 tile (`CMB-09`) and Stunned 1. The Stun applies even if the knockback fails.
  Boss Stun caps apply (`BST-03`).
- Summary: `+2 Force. Melee hits of 6+ knock back and Stun 1.`
- Description: *A piston where the elbow was. Things you hit go somewhere else and think about it.*

## SKL-03 Tinkering

| Rank | Name | Type | Cost | Target |
|---|---|---|---|---|
| 1 | **Salvage** | P | — | — |
| 2 | **Efficient Springs** | P | — | — |
| 3 | **Field Repair** | A | 12 | self |
| 4 | **Clockwork Decoy** | A | 15 | adjacent-free |

### Salvage
- Effect: keeps a counter `salvage` (shown on the Skills screen as `Salvage: n/4`) that increments each
  time any enemy breaks (any cause) after the skill is taken. When it reaches 4 it resets to 0 and a
  consumable is placed on that enemy's tile per `ITM-11` placement: alternately **Solder** then
  **Spring-Key**, starting with Solder. This is in addition to the enemy's own drop. Counter persists
  across floors. Summoned enemies count; the Decoy does not.
- Summary: `Every 4th enemy broken drops Solder, then Spring-Key.`
- Description: *Everything in this tower is made of parts. Every fourth one leaves something worth keeping.*

### Efficient Springs
- Effect: **Spring-Key** restores 45 instead of 30; **Solder** restores 25 instead of 15; **Flux**
  restores 10 Integrity instead of 5.
- Summary: `Spring-Key +45, Solder +25, Flux +10.`
- Description: *Her second-best screwdriver, and the knack of using it. Nothing is wasted.*

### Field Repair
- Effect: Integrity +12 (clamped). Usable once per floor; resets on Ascend. Shown `(used)` in the panel.
- Summary: `+12 Integrity. Once per floor. 12 Tension.`
- Description: *Stop, open the chest plate, and mend what can be mended without a bench. Once a floor.*

### Clockwork Decoy
- Effect: places a **Decoy** on the chosen adjacent tile. The Decoy is an actor with `integrity 12`,
  `evasion 0`, `plating 0`, no speed (it never acts), glyph `0` in `teal`, immune to all statuses.
  On placement and at the start of each enemy phase for 6 turns, every Active enemy within Chebyshev
  8 of the Decoy has `lastKnown` set to the Decoy's tile and treats the Decoy as its target
  (attacks it if adjacent; paths to it) instead of Tick. Enemies that *see* Tick adjacent to
  themselves still attack Tick. After 6 turns, or when its Integrity reaches 0, the Decoy is removed
  (no scrap, no XP, no noise). Only one Decoy exists at a time; placing a new one removes the old.
- Summary: `Place a 12-Integrity decoy; enemies within 8 target it for 6 turns. 15 Tension.`
- Description: *A tin frame, a lamp, and a spring that does nothing but rattle. It works on the sweepers. It worked on her.*

## SKL-04 Resonance

| Rank | Name | Type | Cost | Target |
|---|---|---|---|---|
| 1 | **Tuning** | P | — | — |
| 2 | **Resonant Pulse** | A | 8 | self |
| 3 | **Discord** | A | 10 | tile (visible enemy within 6) |
| 4 | **Sympathetic Break** | P | — | — |

### Tuning
- Effect: Precision +1. Ranged weapon shots cost 1 less Tension (minimum 1). Ranged attacks get a
  further +5 accuracy.
- Summary: `+1 Precision. Ranged shots −1 Tension, +5 accuracy.`
- Description: *Tap the frame, listen, adjust. Everything in the tower rings at a pitch, including you.*

### Resonant Pulse
- Effect: every enemy within Chebyshev 2 of Tick takes `1d4+2` damage ignoring Plating, then is
  knocked back 1 tile away from Tick (`CMB-09`), resolved in enemy `id` order. Noise 8.
- Summary: `All enemies within 2: 1d4+2 damage (ignores Plating), pushed back. 8 Tension.`
- Description: *Strike your own frame like a bell. Anything close enough to hear it is not close any more.*

### Discord
- Effect: the target enemy becomes **Exposed** 4 and **Slowed** 4. No line of fire is needed — only
  that the target is visible and within 6. Bosses: cap 2 each (`BST-03`). Noise 0.
- Summary: `Target within 6: Exposed 4 and Slowed 4. 10 Tension.`
- Description: *Find the pitch that a thing is built to, and sing slightly off it.*

### Sympathetic Break
- Effect: whenever any enemy breaks (any cause), every other enemy within Chebyshev 3 of its tile takes
  4 damage ignoring Plating. Enemies broken by this trigger it again (resolve recursively in `id`
  order). The Decoy is not an enemy. Bosses take this damage normally.
- Summary: `When an enemy breaks, enemies within 3 take 4 damage.`
- Description: *A note held until something snaps. Then the next thing.*

## SKL-05 Interaction notes (binding)

- **Overwind Strike + Piston Drive:** the doubled roll counts toward the ≥ 6 threshold.
- **Overwind Strike + weapon specials:** `Sweep`, `Rend`, `Knock`, `Tempo` trigger as on any hit.
- **Flywheel Guard + Stun sources:** hazards (Pendulum Sweep) also cannot Stun Tick while it is active.
- **Discord on the Understudy** in its wound-down phase: it is already `SLOW`; Slowed has no further
  effect; Exposed applies.
- **Sympathetic Break + Salvage:** both trigger on the same break; Salvage counts chained breaks.
- **Field Repair** cannot be used at full Integrity? It can; it still costs and is spent
  (`ITM-09` rationale).
