// Every string the player reads that is not an item, enemy or skill text (24-script.md).
//
// Transcription notes (logged in specs/DECISIONS.md):
//  - 24 marks emphasis with `*asterisks*` and says italics render in `violet`. The markers are kept
//    in the strings so the text-box renderer can find them (D-023); no other markup exists.
//  - Paragraphs inside one text box are separated by a blank line (`\n\n`), exactly as 24 lays them
//    out. Word wrapping is the renderer's job (TEC-10).
//  - SCR-06's four Understudy lines are stored without the quotation marks the table wraps them in
//    (D-024), so `understudy[4]` is exactly `Turn it, then. Someone has to.`
//  - `log` is SCR-10 verbatim, plus SCR-04's two pickup lines and TEC-09's restore line, with the
//    `{A} {D} {n} {X}` placeholders (and SCR-10's `{status}` / `{floor name}`) left in place.

// ---- SCR-01 Title screen ----------------------------------------------------------------

export const title = 'CLOCKWORK HOLLOW';

export const tagline = Object.freeze([
  'Eight floors. One key.',
  'Every turn costs spring.',
  'Nothing winds you but you.',
  'Climb.',
]);

export const menu = Object.freeze(['New run', 'Continue', 'Enter seed', 'Help']);
export const continueSubtitle = 'Floor {N}, turn {T}';
export const seedPrompt = 'Seed:';
export const abandonPrompt = 'Abandon the saved run? (y/n)';

// ---- SCR-02 Intro -----------------------------------------------------------------------

export const intro = [
  'The Hollow is a clock tower above the harbor town of Lowmere. For fifty years the clockmaker Aurelie Vance lived inside it, building things that moved, and each morning she walked eight floors with a ring of keys and wound them all.',
  'Eleven days ago she stopped.',
  'You are Tick. You are the first thing she finished. Your chest plate says so: *TICK — first attempt — she works. A.V.*',
  'You woke this morning on the workshop floor with your spring wound tight, because you were standing on the one station she left running on a timer. It will not run again. Nothing in this tower will be wound again, unless someone climbs to the top and finds the key that turns from the inside.',
  'The others are still running their last orders. They will not stop for you.',
  'Climb.',
].join('\n\n');

// ---- SCR-03 Journal pages ---------------------------------------------------------------

/** The header each page is shown under; `{n}` is the page, `{floor name}` the floor's name. */
export const pageHeader = 'Page {n} — {floor name}';

/** Pages 1–8, keyed by page number. Pages 1–7 are signed; page 8 ends mid-sentence (SCR-03). */
export const pages = Object.freeze({
  1: [
    'Wound the first frame at six this morning. Brass, single spring, the lantern-eye from the old harbor lamp because the council will not pay for glass. I expected it to fall over. It walked to the bench, picked up my second-best screwdriver, and offered it to me. I had not built that. I have gone over the escapement four times and I cannot find where the offering comes from.',
    'Scratched a name on the chest plate so I stop calling it "the first attempt" in my notes. Tick. It is what it sounds like.',
    'It follows me about the workshop. When I stop, it stops. When I wind it, it holds still and looks at the ceiling. I have told the council the tower clock will be late.',
    '— A.V.',
  ].join('\n\n'),
  2: [
    'Sixty-one keys on the ring now. The Gallery takes twenty minutes on its own — the transmission gears want winding at both ends and the catwalk is not built for someone my age. I have started leaving the sweepers for last so they can clear up whatever I drop.',
    'Council letter today. They wish to know why a clock tower requires a second floor of gears. I wrote back that the clock requires it. This is true. The clock requires all of it, because I built the clock to require all of it, because otherwise they would have told me to stop.',
    'Tick carries the key ring now. It cannot turn a key — no wrist for it — but it holds the ring out at each station and waits. Twenty minutes is nineteen with help.',
    '— A.V.',
  ].join('\n\n'),
  3: [
    'Orchestra finished. Fourteen pieces, one conductor, a set of dancers for the floor. I built them for the midsummer festival; the council cancelled midsummer in March to save on lamp oil. I have not told the orchestra.',
    'They play at seven each evening whether or not anyone is here. The conductor keeps them to time by hitting the boards with its baton. It is a little hard on the dancers, who go where the beat says regardless of what is in the way.',
    'Tick sits on the stage stairs during the performance. I do not know what it hears. I have checked and there is nothing in its head that would hear anything. It sits there anyway, so I sit with it, and that is the festival.',
    '— A.V.',
  ].join('\n\n'),
  4: [
    'The boilers want feeding at four and at ten. The stokers do it, mostly, but the coal bunkers were built for a taller person than the stokers and I end up on the ladder more than I should. Eight floors is too many for one pair of legs. I have measured the stairs: four hundred and twelve steps, station to station. I knew this when I built them.',
    'Coughing again. The furnace deck is bad for it and I stay too long, because the golems are down here, and they take the longest to wind, and they hold still for it, which the others do not.',
    'Tick waited at the top of the ladder with the ring. It does not come down. I never told it not to.',
    '— A.V.',
  ].join('\n\n'),
  5: [
    'A worry, written down so I can stop carrying it.',
    'When I stop, they will not. Each of them has one order and will keep it until the spring runs out. The sweepers will sweep. The soldiers will hold their doors. The cuckoos will call the hour over an empty tower until there is no hour left to call. I have given them such small orders. I did not think about what a small order looks like from the inside, held for days with nobody to end it.',
    'The birds are the worst for it. They were only ever meant to say the time. They will say it at anything that moves.',
    'I should give them a larger order. I do not know what it would be.',
    '— A.V.',
  ].join('\n\n'),
  6: [
    'The answer is a key that turns from the inside.',
    'Every spring in this tower needs a hand on a key. Take the hand away and the tower is a very elaborate way of stopping. So: a mainspring with its own key, mounted on its own back, geared to wind itself from the running of the tower. It cannot be fitted to the old frames. It needs a frame built around it, from the first bolt. A heart, if I am being ridiculous, and I am.',
    'Drawings finished today. Silver, because brass will not take the tolerances. Taller than me. I have been calling it the understudy, which is unfair to it and to me.',
    'Three years, I think. I have three years.',
    '— A.V.',
  ].join('\n\n'),
  7: [
    'The understudy is finished. It is the best thing I have made and I do not trust it.',
    'It does what it is told, perfectly, and it waits to be told. When the key goes in it will wind itself and then the others, and keep the tower, and it will keep it exactly as I built it, forever, because that is what I will have told it to do. I have been trying for a week to write an order that means "and then decide for yourself," and I cannot. It is not that kind of thing.',
    'Tick, on the other hand, would have no idea what to do with a heart. That is rather the point. It has never once done what it was told. It does what I am doing.',
    'I will decide tomorrow. My chest is bad tonight.',
    '— A.V.',
  ].join('\n\n'),
  8: [
    'Fourth attempt at this entry. The council has sent a doctor up, unasked, and he says the harbor air would help and I have said the tower cannot be left, and we have both been very polite.',
    "The key is done. It is in the understudy's hand. I have not turned it. I told it to keep it safe until I decide, which was a small order, and I know what I said about small orders.",
    'Here is what I have decided. The key goes to whichever of them comes up the stairs to ask for it. The understudy will not come; it was not told to. Tick was never told anything and it will come anyway, if it thinks to, and if it thinks to, then it is the one who',
  ].join('\n\n'),
});

// ---- SCR-05 Scripted moments ------------------------------------------------------------

export const moments = Object.freeze({
  1: [
    'The stage. Fourteen brass players, bowed over their instruments, playing the same bar of a march — four beats, a rest, four beats — over and over. At the front a tall figure raps a baton on the boards to keep them to it. The dancers on the floor turn to the sound, and then to you.',
    '*She said they were for the festival. There was no festival.*',
  ].join('\n\n'),
  2: [
    'A drawing on heavy paper, folded twice. A tall frame, silver, jointed like a person, every tolerance written in her small hand. In its back, drawn in red, a keyhole, and beside it a note: *turns itself — see p.6.* At the bottom, crossed out and rewritten: *UNDERSTUDY.*',
    '*It has a place for the Key. I do not.*',
  ].join('\n\n'),
  '3a': [
    'The Understudy kneels. It is very slow now. It opens its hand, and the Master Key is on its palm — a short brass key with a worn bow. She wrote that it fits any mainspring. That was the whole trouble of it.',
    '"Turn it, then. Someone has to."',
  ].join('\n\n'),
  '3b': '*It is still waiting for her. So was I.*',
});

// ---- SCR-06 The Understudy's lines ------------------------------------------------------

/**
 * 1 — entry, text box. 2 — Integrity ≤ 48, log in violet. 3 — Integrity ≤ 24, log in violet.
 * 4 — defeat, inside moment 3 (SCR-05).
 */
export const understudy = Object.freeze({
  1: 'Tick. She wrote about you. *The first attempt — she works.* She meant the Key for something finished. Go back down. There is oil in the workshop, and nothing you need to do.',
  2: 'You fight the way she taught the soldiers to. She was not a soldier.',
  3: 'I am running down. So are you. Tell me what you would do with a heart, first attempt.',
  4: 'Turn it, then. Someone has to.',
});

// ---- SCR-07 The ending choice and the two endings ---------------------------------------

export const endingChoice = [
  'The Master Key fits any mainspring. A heart that could go anywhere, she wrote; that was the whole trouble of it.',
  'It could go into the Great Escapement, behind her chair, and run the tower and everything in it.',
  'It could go into you.',
].join('\n\n');

export const endingOptions = Object.freeze(['A) Wind the tower', 'B) Wind yourself']);

export const endingA = [
  'You set the Key into the Escapement and turn it. It turns easily; it was made to.',
  'The tower takes a breath. Below you, floor by floor, the sound of springs tightening — the gallery gears groaning up to speed, the boilers catching, the orchestra finding, at last, the bar after the fourth beat. The sweepers stop where they stand and then start again, slower, sweeping. The soldiers step back from their doors. Every small order she gave is ended, and replaced with the one she never managed to write.',
  'You sit down in her chair, because the Key must be held, and it is a chair for holding things.',
  'Down in Lowmere, in the square, the clock struck the hour for the first time in eleven days, and went on striking it.',
].join('\n\n');

/** Ending B's descent: seven lines, one at a time, each held 1.5 seconds (SCR-07). */
export const descent = Object.freeze([
  '7. The pendulum swings once more, and hangs.',
  '6. In the Archive, the drawings settle.',
  '5. The birds call no hour.',
  '4. The furnace goes dark.',
  '3. The orchestra stops on the fourth beat.',
  '2. The gears in the gallery grind, and lock.',
  '1. The workshop. Your bench. The screwdriver, second-best.',
]);

export const endingB = [
  'You set the Key into your own spring and turn it. It turns easily; it was made to.',
  'Something in your chest catches and holds. The pull of the clock, the one you have felt every fifth step since the workshop, is gone. You stand on the top floor of the Hollow and are not running down.',
  'The tower is. You walk the eight floors back to the workshop past everything she made, and one by one they finish their last order and are still.',
  'The door is where she left it. The harbor air is cold and smells of salt, which the doctor said would help.',
  'In the square in Lowmere the clock says twenty past four, and will go on saying it. You walk past it.',
].join('\n\n');

// ---- SCR-08 Death and victory screens ---------------------------------------------------

export const screens = Object.freeze({
  broken: Object.freeze({
    header: 'TICK WAS BROKEN',
    flavor: 'Something she made has stopped something she made. The tower does not notice.',
  }),
  woundDown: Object.freeze({
    header: 'TICK WOUND DOWN',
    flavor: 'The spring goes slack. Whatever Tick was thinking of, it will be thinking of it for a long time.',
  }),
  keeper: Object.freeze({
    header: 'THE KEEPER',
    flavor: 'The other choice is still up there.',
  }),
  walker: Object.freeze({
    header: 'THE WALKER',
    flavor: 'The other choice is still up there.',
  }),
});

export const summaryLabels = Object.freeze([
  'Floor reached',
  'Turns',
  'Enemies broken',
  'Level',
  'Skills',
  'Weapon',
  'Plating',
  'Attachment',
  'Journal pages {n}/8',
  'Seed {seed}',
]);

export const summaryFooter = '— any key to return to the title —';

// ---- SCR-09 Help screen -----------------------------------------------------------------

export const help = Object.freeze([
  'Tension is your spring and your clock. It drops 1 every 5 turns, always.',
  'It never comes back on its own. Winding Stations (&) restore it once; Spring-Keys give 30.',
  'Integrity is your body. It never heals on its own either. Solder gives 15.',
  'Enemies start still. Sight and noise wake them. Anything with a raised arm is about to hit.',
  'Hover anything for its numbers. Right-click for everything.',
  'When you die, the run is over. The seed on the last screen replays the same tower.',
]);

// ---- SCR-10 Log message templates -------------------------------------------------------

export const log = Object.freeze({
  hit: '{A} hits {D} for {n}.',
  glance: "{A}'s blow glances off {D}.",
  miss: '{A} misses {D}.',
  enemyBroken: 'The {D} breaks.',
  rangedHit: '{A} shoots {D} for {n}.',
  rangedMiss: "{A}'s shot misses {D}.",
  throw: 'Tick throws the {X}.',
  statusApplied: '{D} is {status}.',
  statusExpired: 'Tick is no longer {status}.',
  burningTick: '{D} burns for {n}.',
  hazard: '{D} is caught in the {X} for {n}.',
  knockback: '{D} is knocked back.',
  tensionLoosening: 'The spring is loosening.',
  tensionNearlySlack: "Tick's spring is nearly slack.",
  station: 'Tick winds the spring. Tension 100.',
  stationSpent: 'This station has run down.',
  springKey: 'Tick fits the Spring-Key. Tension {n}.',
  solder: 'Tick solders the plate. Integrity {n}.',
  flux: 'Tick cleans the joints. Integrity {n}.',
  nothingToMend: 'Nothing needed mending.',
  alreadyTight: 'The spring is already tight.',
  pickup: 'Tick picks up the {X}.',
  pickupStack: 'Tick picks up {n} {X} (now {n}).',
  itemHere: 'There is a {X} here.',
  inventoryFull: "No room. Tick's frame carries ten things.",
  equipWeapon: 'Tick wields the {X}.',
  equipPlating: 'Tick bolts on the {X}.',
  equipAttachment: 'Tick fits the {X}.',
  drop: 'Tick sets down the {X}.',
  doorOpen: 'Tick opens the door.',
  doorClose: 'Tick closes the door.',
  doorBroken: 'The {A} breaks the door down.',
  wall: 'The wall is solid.',
  stairs: 'Tick climbs. Floor {n}: {floor name}.',
  levelUp: 'Tick feels a new gear catch. Level {n}.',
  skillUsed: '{X}.',
  skillUnaffordable: 'Not enough spring for {X}.',
  oncePerFloorSpent: '{X} is spent until the next floor.',
  decoyPlaced: 'The decoy rattles.',
  decoyExpires: 'The decoy runs down.',
  decoyBroken: 'The decoy is broken.',
  salvage: 'Something worth keeping: {X}.',
  sympatheticBreak: 'The break carries.',
  indirectDamage: '{D} takes {n} from the {X}.',
  fieldRepair: 'Tick mends the frame. Integrity {n}.',
  flywheelStart: 'The flywheel spins up.',
  flywheelEnd: 'The flywheel runs down.',
  nothingToShoot: 'Nothing to shoot.',
  nothingHereToUse: 'Nothing here to use.',
  archivistTelegraph: 'The Archivist lifts a pin.',
  archivistShot: 'The Archivist flicks a drafting pin.',
  cuckooTelegraph: 'The Cuckoo draws breath.',
  cuckooShriek: 'The Cuckoo shrieks.',
  // BST-02 writes the Gear-Golem's two lines in its own special-case list rather than in SCR-10's
  // table; they are transcribed verbatim here so `ai.js` never invents a string (D-057).
  golemTelegraph: 'The Gear-Golem raises its arm.',
  golemHeavy: 'The Gear-Golem brings its arm down.',
  // BST-04, BST-05 and BST-06 write the three boss scripts' log lines in their own phase lists
  // rather than in SCR-10's table; they are transcribed verbatim here so `bosses.js` never invents
  // a string (D-057's precedent, extended by D-072).
  conductorTelegraph: 'The Conductor raises the baton.',
  conductorDownbeat: 'The Conductor brings the baton down.',
  conductorPhase2: "The Conductor's tempo doubles.",
  regulatorTelegraph: "The Regulator's arm ratchets back.",
  regulatorHeavy: "The Regulator's arm drops.",
  regulatorPhase2: "The Regulator's governor spins free.",
  regulatorVentTelegraph: "The Regulator's seams glow.",
  regulatorVent: 'Steam bursts from the Regulator.',
  understudyTelegraph: 'The Understudy tightens.',
  understudyOverwind: "The Understudy's arm unwinds all at once.",
  understudyPulseTelegraph: 'The Understudy hums.',
  understudyPulse: 'The Understudy rings like a bell.',
  travelInterrupted: 'Tick stops.',
  deathByEnemy: 'Tick was broken by {A} on floor {n}.',
  deathByTension: 'Tick wound down on floor {n}.',
  deathByHazard: 'Tick was broken by the {X} on floor {n}.',
  deathByBurning: 'Tick was broken by Burning on floor {n}.',
  // SCR-04 — journal pickups.
  journalPage: 'Tick finds a page in her hand. (Journal, page {n})',
  blueprint: 'Tick unfolds a drawing. (Journal, Blueprint)',
  // TEC-09 — the line Continue prints on restore.
  resume: 'Tick resumes.',
});

/** Everything above, under the one name the rest of the game imports. */
export const SCRIPT = Object.freeze({
  title,
  tagline,
  menu,
  continueSubtitle,
  seedPrompt,
  abandonPrompt,
  intro,
  pageHeader,
  pages,
  moments,
  understudy,
  endingChoice,
  endingOptions,
  endingA,
  descent,
  endingB,
  screens,
  summaryLabels,
  summaryFooter,
  help,
  log,
});
