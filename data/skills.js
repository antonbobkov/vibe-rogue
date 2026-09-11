// The twelve skills (20-skills.md), shaped per TEC-03 `Skill` and CHR-09.
//
// Three disciplines — Armature, Tinkering, Resonance — each an ordered list of exactly four skills,
// ranks 1–4, of which exactly two are active (`A`, cost Tension and a turn) and two passive (`P`).
// Summaries and descriptions are shown on the Skills screen exactly as written (SKL-01).

/** @type {readonly object[]} all twelve skills, discipline by discipline, rank 1 → 4. */
export const SKILLS = Object.freeze([
  // ---- SKL-02 Armature ------------------------------------------------------------------
  Object.freeze({
    name: 'Braced Frame',
    discipline: 'Armature',
    rank: 1,
    type: 'P',
    summary: '+1 Plating, +6 max Integrity.',
    description: "Cross-bracing in the frame. Aurelie's note on the drawing: \"should have done this first.\"",
  }),
  Object.freeze({
    name: 'Overwind Strike',
    discipline: 'Armature',
    rank: 2,
    type: 'A',
    cost: 8,
    target: 'direction',
    summary: 'Melee hit: double weapon dice, +25 accuracy. 8 Tension.',
    description: 'Let the spring out all at once into the arm. Loud, and the spring feels it.',
  }),
  Object.freeze({
    name: 'Flywheel Guard',
    discipline: 'Armature',
    rank: 3,
    type: 'A',
    cost: 10,
    target: 'self',
    summary: '4 turns: +3 Plating, immune to Stun and knockback. 10 Tension.',
    description: 'Spin the flywheel up and let it hold you steady. Four turns, then it runs down.',
  }),
  Object.freeze({
    name: 'Piston Drive',
    discipline: 'Armature',
    rank: 4,
    type: 'P',
    summary: '+2 Force. Melee hits of 6+ knock back and Stun 1.',
    description: 'A piston where the elbow was. Things you hit go somewhere else and think about it.',
  }),

  // ---- SKL-03 Tinkering -----------------------------------------------------------------
  Object.freeze({
    name: 'Salvage',
    discipline: 'Tinkering',
    rank: 1,
    type: 'P',
    summary: 'Every 4th enemy broken drops a throwable.',
    description: 'Everything in this tower is made of parts. Every fourth one leaves something worth keeping.',
  }),
  Object.freeze({
    name: 'Efficient Springs',
    discipline: 'Tinkering',
    rank: 2,
    type: 'P',
    summary: 'Spring-Key +10, Solder +15, Flux +5.',
    description: 'Her second-best screwdriver, and the knack of using it. Nothing is wasted.',
  }),
  Object.freeze({
    name: 'Field Repair',
    discipline: 'Tinkering',
    rank: 3,
    type: 'A',
    cost: 12,
    target: 'self',
    summary: '+12 Integrity. Once per floor. 12 Tension.',
    description: 'Stop, open the chest plate, and mend what can be mended without a bench. Once a floor.',
    oncePerFloor: true,
  }),
  Object.freeze({
    name: 'Clockwork Decoy',
    discipline: 'Tinkering',
    rank: 4,
    type: 'A',
    cost: 15,
    target: 'adjacent-free',
    summary: 'Place a 12-Integrity decoy; enemies within 8 target it for 6 turns. 15 Tension.',
    description: 'A tin frame, a lamp, and a spring that does nothing but rattle. It works on the sweepers. It worked on her.',
  }),

  // ---- SKL-04 Resonance -----------------------------------------------------------------
  Object.freeze({
    name: 'Tuning',
    discipline: 'Resonance',
    rank: 1,
    type: 'P',
    summary: '+1 Precision. Ranged shots −1 Tension, +5 accuracy.',
    description: 'Tap the frame, listen, adjust. Everything in the tower rings at a pitch, including you.',
  }),
  Object.freeze({
    name: 'Resonant Pulse',
    discipline: 'Resonance',
    rank: 2,
    type: 'A',
    cost: 8,
    target: 'self',
    summary: 'All enemies within 2: 1d4+2 damage (ignores Plating), pushed back. 8 Tension.',
    description: 'Strike your own frame like a bell. Anything close enough to hear it is not close any more.',
  }),
  Object.freeze({
    name: 'Discord',
    discipline: 'Resonance',
    rank: 3,
    type: 'A',
    cost: 10,
    target: 'tile',
    summary: 'Target within 6: Exposed 4 and Slowed 4. 10 Tension.',
    description: 'Find the pitch that a thing is built to, and sing slightly off it.',
  }),
  Object.freeze({
    name: 'Sympathetic Break',
    discipline: 'Resonance',
    rank: 4,
    type: 'P',
    summary: 'When an enemy breaks, enemies within 3 take 4 damage.',
    description: 'A note held until something snaps. Then the next thing.',
  }),
]);

/** Name → skill, for `takeSkill` and the active-slot list (CHR-09, CHR-10). */
export const SKILLS_BY_NAME = Object.freeze({
  'Braced Frame': SKILLS[0],
  'Overwind Strike': SKILLS[1],
  'Flywheel Guard': SKILLS[2],
  'Piston Drive': SKILLS[3],
  'Salvage': SKILLS[4],
  'Efficient Springs': SKILLS[5],
  'Field Repair': SKILLS[6],
  'Clockwork Decoy': SKILLS[7],
  'Tuning': SKILLS[8],
  'Resonant Pulse': SKILLS[9],
  'Discord': SKILLS[10],
  'Sympathetic Break': SKILLS[11],
});

/** CHR-09's three disciplines, in the order the Skills screen lists them. */
export const DISCIPLINES = Object.freeze(['Armature', 'Tinkering', 'Resonance']);

/** SKL-01 targeting kinds. */
export const SKILL_TARGETS = Object.freeze(['self', 'direction', 'tile', 'adjacent-free']);

/** CHR-06 cumulative XP thresholds, level 1 → 9. Level 9 is the cap. */
export const XP_THRESHOLDS = Object.freeze([0, 10, 25, 45, 70, 100, 135, 175, 220]);
