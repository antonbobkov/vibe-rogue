# 21 — Items Catalog

**Status:** Wave 3 — content. Rules are in `12-items-and-inventory.md`.
**Purpose:** Every item in the game with every number and every string. Descriptions are Aurelie's
workshop labels (`STY-09`).

---

## CAT-01 Weapon specials (closed set)

| Special | Trigger | Effect |
|---|---|---|
| **Rend** | On hit | Target becomes **Exposed** 1 (so the *next* hit within a turn ignores its Plating). |
| **Sweep** | On hit | Every other enemy adjacent to Tick takes 2 damage (Plating applies). |
| **Knock** | On damage ≥ 6 | Target knocked back 1 (`CMB-09`). No Stun. |
| **Tempo** | On hit | Target becomes **Slowed** 1. |
| **Ring** | On hit (ranged) | Target becomes **Exposed** 2. |

## CAT-02 Melee weapons

| Name | Dice | Acc. mod | Special | Color | Floors | Unique |
|---|---|---|---|---|---|---|
| **Wrench** | `1d4+1` | 0 | — | steel | start only | — |
| **Mallet** | `1d6+1` | −5 | — | copper | 1–3 | — |
| **Cog Saw** | `1d4+1` | +5 | Rend | silver | 2–4 | — |
| **Escapement Blade** | `2d4` | +5 | — | white | 4–7 | — |
| **Pendulum Flail** | `2d4+2` | −10 | Sweep | copper | 5–7 | — |
| **Piston Hammer** | `3d4` | −5 | Knock | iron | 6–7 | — |
| **Conductor's Baton** | `1d6+2` | +15 | Tempo | pink | drop: the Conductor | Yes |

Descriptions:
- Wrench: *Adjustable. Hers, then Tick's. Fits every bolt in the tower because she made every bolt in the tower.*
- Mallet: *Rawhide face, lignum vitae head. For persuading gears. Swings slow.*
- Cog Saw: *Fine teeth for cutting brass plate. Leaves a seam you can get a second blow into.*
- Escapement Blade: *A pallet fork ground to an edge. Balanced for a wrist she never gave you. Use it anyway.*
- Pendulum Flail: *A bob on a chain. Hard to aim, hard to be near.*
- Piston Hammer: *Steam-driven head. Whatever you hit does not stay hit where it was.*
- Conductor's Baton: *Ebony, weighted. Keeps things to time. Things do not enjoy it.*

## CAT-03 Ranged weapons

| Name | Dice | Acc. mod | Range | Tension/shot | Special | Color | Floors |
|---|---|---|---|---|---|---|---|
| **Spring-Bolt Launcher** | `1d6` | 0 | 6 | 3 | — | steel | 2–5 |
| **Harmonic Rifle** | `2d4` | +5 | 7 | 4 | Ring | violet | 5–7 |

Descriptions:
- Spring-Bolt Launcher: *Winds off your own spring. Every shot is a little of your time.*
- Harmonic Rifle: *Fires a tuned note. Plating hums and comes loose.*

## CAT-04 Plating

| Name | Plating | Evasion penalty | Color | Floors |
|---|---|---|---|---|
| **Tin Plating** | 1 | 0 | silver | 1–2 |
| **Brass Plating** | 2 | 2 | brass | 1–4 |
| **Iron Plating** | 3 | 4 | iron | 3–6 |
| **Steel Plating** | 4 | 6 | steel | 5–7 |
| **Lacquered Plating** | 2 | 0 | pink | 5–7 |

Descriptions:
- Tin: *Cut from the roof. Better than nothing, which is what you had.*
- Brass: *Workshop stock. Heavy enough to notice.*
- Iron: *Boilerplate, riveted. You will not dodge in it. You will not need to, mostly.*
- Steel: *From the knights' pattern. She said it was too much. It is too much.*
- Lacquered: *Thin steel, twelve coats. Light as brass and twice the trouble to make.*

## CAT-05 Attachments

| Name | Force | Precision | Plating | Evasion | Special | Color | Floors | Unique |
|---|---|---|---|---|---|---|---|---|
| **Balance Wheel** | 0 | +1 | 0 | +5 | — | silver | 1–4 | — |
| **Counterweight** | +2 | 0 | 0 | −5 | — | iron | 2–5 | — |
| **Oil Reservoir** | 0 | 0 | +1 | 0 | **Cooling**: Tick cannot receive Burning. | oil | 3–6 | — |
| **Sounding Plate** | 0 | +1 | 0 | +5 | **Quiet**: Tick's melee noise is 2 instead of 5; opening a door is silent. | violet | 5–7 | — |
| **Governor** | 0 | +1 | +1 | 0 | **Regulated**: time decay is 1 Tension per 6 turns instead of 5 (`CHR-04`). | brass | drop: the Regulator | Yes |

Descriptions:
- Balance Wheel: *Hairspring and wheel from a pocket watch. Steadies the hand.*
- Counterweight: *Lead in the back plate. Hits land harder. Everything else lands on you.*
- Oil Reservoir: *Keeps the joints cool. Stokers hate it.*
- Sounding Plate: *A plate that swallows the ring of brass on brass. The birds will not hear you coming.*
- Governor: *The tower's own regulator, taken from the thing that guarded it. Time passes slower with it on.*

## CAT-06 Consumables

| Name | Kind | Range | Radius | Effect | Color | Floors |
|---|---|---|---|---|---|---|
| **Solder** | instant | — | — | Integrity +15 (Efficient Springs: +25). | green | 1–7 |
| **Spring-Key** | instant | — | — | Tension +30 (Efficient Springs: +45). | teal | 1–7 |
| **Flux** | instant | — | — | Remove all five statuses from Tick; Integrity +5 (Efficient Springs: +10). | white | 4–7 |
| **Oil Flask** | throwable | 5 | 1 | Every actor in the 3×3 area gets **Burning** 3. | orange | 2–7 |
| **Grit Bomb** | throwable | 5 | 1 | Every actor in the 3×3 area takes 1 damage (ignores Plating) and gets **Blinded** 4. | midGrey | 1–7 |
| **Tuning Fork** | throwable | 6 | 0 | The actor on the landing tile (if any) gets **Stunned** 2. | violet | 3–7 |
| **Clatter Can** | throwable | 6 | 0 | Noise 10 at the landing tile. Every **Active** enemy within 10 sets `lastKnown` to the landing tile. | copper | 2–7 |

Descriptions:
- Solder: *Tin and flux in a paper twist. Mends plate. Does not mend much else.*
- Spring-Key: *A spare key, pre-wound. Thirty turns of the spring. Do not lose it.*
- Flux: *Cleans a joint of anything that got into it. Stings, she said, if you could sting.*
- Oil Flask: *Lamp oil. Everything in here runs on it and everything in here burns on it.*
- Grit Bomb: *Emery dust in a glass bulb. Gets in the eyes, for those that have eyes, and the lenses, for the rest.*
- Tuning Fork: *Struck and thrown, it rings on a pitch that stops a mechanism dead for a moment.*
- Clatter Can: *A tin of loose screws. Thrown, it says: over here.*

## CAT-07 Records

| Name | Glyph | Where | Effect |
|---|---|---|---|
| **Journal page 1–8** | `?` | One per floor in the journal room (`WLD-07`); page 8 on the chair after the Understudy breaks | Added to the Journal screen. Text in `24-script.md`. |
| **Understudy Blueprint** | `?` | Floor 6 cache, guaranteed, in addition to the 2–3 rolled items | Added to the Journal screen; triggers scripted moment 2 (`STY-05`). |
| **Master Key** | — | Never on the map; given by the Understudy | Triggers the ending choice. Not an inventory item. |

## CAT-08 Summary counts

7 melee + 2 ranged weapons, 5 platings, 5 attachments, 7 consumables, 10 records. Two unique items
(Conductor's Baton, Governor).
