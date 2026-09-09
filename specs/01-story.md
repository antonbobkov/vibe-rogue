# 01 — Story: The Hollow and the Key

**Status:** Wave 1 — approved. Wave 3 (`24-script.md`) writes every line of text verbatim; this document
fixes what those lines must say and the names they must use.
**Purpose:** Give the game a world, a reason, and an ending, so that enemies, floors, items, and skills
in later docs are consistent with one story rather than decorated at random.

---

## STY-01 Premise

Fifty years ago the clockmaker **Aurelie Vance** was commissioned by the harbor town of **Lowmere** to
build a clock tower. She built the tower, and the clock, and then she kept building. The tower became
her workshop, then her home, then a household: she filled it with automata — sweepers, soldiers, singers,
birds — each running on a mainspring she wound by hand every morning, walking all eight floors with her
ring of keys. The townsfolk, who never saw inside, called it **the Hollow**, because from the harbor
it looks like an empty shell around a single swinging pendulum.

Aurelie is dead. She died in her chair on the top floor, at the **Great Escapement**, eleven days ago.
No one has wound anything since. The automata are running out. Some have stopped already. The rest are
running down their last orders — sweeping, guarding, singing, hunting — with nobody to tell them to stop.

You are **Tick**: the first automaton she ever finished, the oldest and the simplest. A brass frame, a
single mainspring, a lantern-eye, and a tin plate on your chest where she scratched your name. You woke
this morning on the workshop floor with your spring at full tension for the last time, because you
happened to be next to the one Winding Station she left running on a timer. You have no orders left.
You have one idea, from a thing she said once while she was building someone else: *"When the Key is
done, none of you will need me."*

The **Master Key** is on the top floor, at the Escapement, in the hands of the one she was building
it for.

## STY-02 The three characters

### Tick (the player)

- Brass body, about the height of a child. One lantern-eye that also serves as the field-of-view
  metaphor: what Tick's lantern lights is what the player sees.
- Cannot speak. Tick's inner voice appears only in the intro, in the ending, and in exactly three
  one-line "thoughts" triggered by scripted moments (STY-05). Tick's thoughts are terse and literal —
  Tick describes, never emotes. The emotion is the player's.
- Tick's chest plate reads `TICK — first attempt — she works. A.V.` This is read aloud in the intro.
- Tick is loyal to nothing but the idea of continuing. That is what makes the ending a real choice.

### Aurelie Vance (dead; voice of the journal)

- Present only through her **journal pages**, one hidden per floor, and through the physical evidence of
  the tower. Never seen, never a ghost, never a recording.
- Writes like an engineer who is fond of her work and embarrassed to say so. Short declarative
  sentences. Notes measurements. Complains about the town council. Names every automaton and pretends
  she doesn't care about them. Never once uses the word "love." The reader is meant to notice.
- Her arc across the eight pages: pride (1) → habit (2) → affection she won't name (3) → fatigue (4) →
  fear of what happens when she's gone (5) → the plan for the Key (6) → doubt about who deserves it (7)
  → the last entry, unfinished mid-sentence (8).
- Rule for wave 3: each page is 110–170 words. Each page introduces the floor it is found on (why it
  exists, what lives there) *and* advances her arc. Page 8 must end mid-sentence.

### The Understudy (final boss)

- Aurelie's last and finest work, built on the top floor over the final three years. Tall, silver,
  articulated like a person. It was made to receive the Master Key — to be the first automaton that
  winds itself and then, in time, winds the others: Aurelie's replacement as keeper of the Hollow.
- She died before turning the Key in its back. It has had the Key in its hand for eleven days and cannot
  use it: the Key must be turned by someone else. It has been waiting for her to wake up.
- It is not evil. It is running the last instruction it has — *keep the Key safe until she comes* — with
  a spring that is also running down. It sees Tick as an obsolete part come to steal what was promised.
  It speaks (STY-06). It is the only enemy that does.
- Mechanically it must feel like a mirror of the player: it uses versions of skills from all three
  disciplines and it also loses Tension over the fight. Wave 3 (`22-bestiary.md`) specifies phases; the
  narrative requirement is that its final phase is *slow* — it is winding down as you fight it, and the
  player should feel that.

## STY-03 Why the enemies are enemies

Every automaton in the Hollow is running its **residual instruction** — the last order it was given,
looping with no one to end it. This is the single explanation for all hostile behavior and the builder
should make the bestiary consistent with it:

| Kind of thing | Residual instruction | Resulting AI feel |
|---|---|---|
| Sweepers, Stokers, maintenance engines | *Clear the floor / tend the furnace* | Chase and strike anything in their area; ignore you outside it |
| Tin Soldiers, Knights | *Guard this room* | Hold position, engage on entry, do not pursue far |
| Spring-Hounds | *Fetch* | Fast pursuers; hunt by sound |
| Cuckoos, Aviary birds | *Announce the hour* | Ranged "shriek" that wakes others; kite away from melee |
| Music-box Dancers, the Conductor | *Perform* | Move on beats; buffs and patterns rather than raw damage |
| Gear-Golems, the Regulator | *Regulate the mechanism* | Slow, heavy, punishing to stand next to |
| The Unfinished | none — never given an instruction | Erratic; the only "random" behavior in the game |
| Rust-moths | not automata — vermin that eat oil | Swarm, weak, attracted to you (you are oily) |

There are no humans in the tower and no living creatures other than rust-moths. Enemies do not bleed;
they shed gears, leak oil, and go still. On death an enemy's glyph becomes `%` in a dim color ("scrap")
and is walkable.

## STY-04 Floor-by-floor narrative beats

Ascending. Each floor's *theme* is defined here; its generation parameters, spawn tables, and hazards
are defined in `13-world-and-generation.md` and `23-floors.md` and must fit the description.

| Floor | Name | What it is | Story beat | Journal page theme |
|---|---|---|---|---|
| 1 | **The Workshop** | Benches, vices, racks of parts, a cold forge. Tick's home. | Intro. Tick wakes at the timer-run Winding Station. Learns to move, fight rust-moths, pick things up. | *Page 1:* "First attempt." Building Tick. Tick works. She is surprised. |
| 2 | **The Gear Gallery** | The tower's transmission: floor-to-ceiling gears, catwalks between them. Grinding gear hazards. | First real fights. First Cache. First plating. | *Page 2:* The daily winding walk. Sixty-one keys. Her knees. |
| 3 | **The Music Room** | An automaton orchestra on a stage, music boxes, a dance floor. | **Mini-boss: The Conductor.** Scripted moment: entering the stage room, the orchestra is still playing one bar, over and over. Tick's thought #1. | *Page 3:* The orchestra. She built them for the town's midsummer festival; the council cancelled it. She kept them playing anyway. |
| 4 | **The Furnace Deck** | Boilers, coal bunkers, steam vent hazards. Hot. | The tower's heart; heavy enemies (Gear-Golems, Stokers). Player should be choosing fights now. | *Page 4:* Fatigue. Coughing. "Eight floors is too many for one pair of legs." |
| 5 | **The Aviary** | Open galleries, perches, cages, a shattered skylight. Long sightlines. | Ranged threat floor (Cuckoos). Teaches cover and doors. | *Page 5:* Fear. What happens to them when she stops? "They will run down their last order until they stop. I have given them such small orders." |
| 6 | **The Archive** | Blueprint cabinets, drafting tables, the shelves of parts for things she never finished. | **Mini-boss: The Regulator** — the tower's governor, the one thing she built to run *without* her, and which never worked right. Scripted moment: Tick finds the Understudy's blueprint. Thought #2. | *Page 6:* The plan. A key that turns from the inside. "A heart, if I am being ridiculous, and I am." |
| 7 | **The Pendulum Stair** | A spiral stair around the shaft; the Great Pendulum swings through the map. Narrow. Mixed elite enemies. | The gauntlet. No new mechanics; everything at once. | *Page 7:* Doubt. Who gets the Key? The Understudy is finished, perfect, and she doesn't trust it. "Tick would have no idea what to do with it. That is rather the point." |
| 8 | **The Escapement** | A single handcrafted circular chamber around the escapement wheel. Aurelie's chair. | **Final boss: The Understudy.** Scripted entry: the Understudy is standing beside the chair, holding the Key. Aurelie's body is *not* depicted — the chair is empty; the doctor's visit in page 8 implies she was taken down to Lowmere. Boss dialogue. On victory, the **ending choice**. Thought #3. | *Page 8:* Found on the chair *after* the boss, delivered by the ending sequence (`SCR-07`). Unfinished mid-sentence. She was deciding. |

## STY-05 Scripted moments and Tick's three thoughts

Scripted moments are single-turn interruptions: the game shows a text box, the player dismisses it,
play resumes. They never take a turn. Exact text in wave 3.

| # | Trigger | What happens | Tick's thought (one line, ≤ 12 words) |
|---|---|---|---|
| 1 | Player first sees the orchestra stage room on floor 3 | Text describes the orchestra playing the same bar. The Conductor wakes. | *She said they were for the festival. There was no festival.* |
| 2 | Player picks up the Understudy blueprint (a guaranteed item on floor 6, in the Cache) | Text describes the drawing; the Key is drawn into its back, with a note in her hand. | *It has a place for the Key. I do not.* |
| 3 | The Understudy is defeated | The Understudy kneels and holds out the Key. The ending choice screen opens. | *It is still waiting for her. So was I.* |

## STY-06 The Understudy's lines

The Understudy speaks exactly four times. It never raises its voice. Each line appears in the message log
in a distinct color (defined in `15-ui-and-controls.md`) and in the boss text box where noted.

1. **On entry to floor 8** (text box): It names Tick, notes Tick is "a first attempt," says she meant the
   Key for something finished.
2. **At 66% Integrity** (log line): It observes that Tick fights "like she taught the soldiers to,"
   i.e. badly.
3. **At 33% Integrity, entering its slow phase** (log line): It admits it is running down. It asks Tick
   what Tick will do with a heart.
4. **On defeat** (text box, before thought #3): "Turn it, then. Someone has to." — the only line fixed
   verbatim in wave 1; wave 3 must use exactly this.

## STY-07 The ending choice

After the Understudy's fourth line the game presents a two-option screen. There is no third option and
no way to defer. Both are victories; the victory screen names which ending was reached.

| Option | Name | What Tick does | Consequence shown | Emotional shape |
|---|---|---|---|---|
| A | **The Keeper** | Turns the Master Key in the Great Escapement — the tower's own spring. | The tower thunders back to life. Every automaton in the Hollow restarts with its instruction cleared; the orchestra plays the whole piece. Tick sits down in Aurelie's chair to keep the Key turning. Final image: Tick in the chair, the pendulum swinging, "and the clock in Lowmere struck the hour for the first time in eleven days." | Bittersweet: everyone saved, Tick bound. |
| B | **The Walker** | Turns the Master Key in its own back. | The tower slows and stops. Tick walks down eight floors past the still automata — the game shows a brief, non-interactive descent (one line per floor, in reverse order) — and out the door into Lowmere at dawn. Final image: the town clock stopped at the hour she died; Tick walks past it. | Bittersweet: Tick free, everyone else gone. |

After either ending, the victory screen shows the run summary (STY-08) and the words *"The other
choice is still up there."*

## STY-08 Death and the run summary

- On death the message log shows the cause, then the Death screen. Cause is one of:
  *"Tick was broken by [enemy name] on floor N."* (Integrity reached 0) or
  *"Tick wound down on floor N."* (Tension reached 0).
- The Death and Victory screens both show: floors reached, turns taken, enemies broken, character level,
  skills taken (in order), final equipment, journal pages found (N/8), the run seed.
- There is no morgue file; the summary is on-screen only and can be dismissed to the title screen.
- Death text is dry, never mocking. One short flavor line per cause, written in wave 3. No randomized
  death quips.

## STY-09 Tone guide (binding on all text in wave 3)

- **Voice:** plain, precise, a little dry. Short sentences. Concrete nouns (brass, oil, keys, coal)
  over abstract ones. Warmth is shown through attention to detail, never stated.
- **Never:** gore, cruelty, swearing, jokes at the player's expense, fourth-wall breaks, "epic" language,
  exclamation marks in Aurelie's voice.
- **Aurelie** is the only character with a personality on the page. She measures things. She names
  things. She complains about the council. She ends entries abruptly.
- **Tick** describes. Tick's three thoughts are the only interior lines; they must be observations, not
  feelings.
- **The Understudy** is formal and quiet, never menacing in word choice. Its menace is that it is
  correct about everything except the conclusion.
- **UI and system text** (item descriptions, enemy descriptions, help) is written in the same plain
  voice, as if Aurelie labeled everything in the tower — because she did. Item descriptions may be her
  workshop labels.
- **Length discipline:** intro ≤ 180 words; each journal page 110–170 words; each scripted moment
  ≤ 80 words; each ending ≤ 200 words; item/enemy descriptions ≤ 25 words. Total in-game prose
  ≈ 2,000 words.

## STY-10 Glossary (canonical names — match exactly everywhere)

| Term | Meaning |
|---|---|
| **Tick** | The player character. Never "the player" in in-game text. |
| **Aurelie Vance** | The clockmaker. Signs journal pages "A.V." |
| **Lowmere** | The harbor town below the tower. |
| **the Hollow** | The tower. Lowercase "the", capital "Hollow". |
| **the Great Escapement** | Floor 8 and the mechanism at its center. |
| **the Master Key** | The winding key that turns a mainspring from the inside. Capitalized. |
| **the Understudy** | The final boss. Capitalized "Understudy". |
| **the Conductor** | Floor 3 mini-boss. |
| **the Regulator** | Floor 6 mini-boss. |
| **Winding Station** | The wall-mounted rewinding fixture; one per floor 1–7. Restores Tension to 100. |
| **Cache** | The one dead-end treasure room per floor 1–7, holding 2–3 items and one guard (`WLD-07`, `FLR-01`). |
| **Integrity** | Tick's hit points. |
| **Tension** | Tick's mainspring; both fuel and clock. |
| **Force / Precision / Plating** | Tick's three attributes. |
| **plating** (lowercase) | The armor item slot and the item category. |
| **Spring-Key** | Consumable that restores 30 Tension. |
| **Solder** | Consumable that restores 15 Integrity. |
| **Armature / Tinkering / Resonance** | The three skill disciplines. |
| **residual instruction** | The lore reason enemies act as they do. |
| **the Unfinished** | The enemy type that never received an instruction. |
| **scrap** | A dead enemy's remains (`%` glyph). |
| **journal page** | One of Aurelie's eight entries. |
| **The Keeper / The Walker** | The two endings. |
| **wound down** | The death-by-Tension state. Also the Understudy's final phase. |
