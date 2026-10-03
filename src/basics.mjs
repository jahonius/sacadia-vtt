/**
 * Basic actions and reactions every creature can take (book pp.237–240), hand-transcribed as
 * `ability` Items so they roll like any other ability instead of only logging AP. Built into the
 * `basic-actions` compendium and auto-granted to every character (see reconcileBasicGrants).
 *
 * Mechanics carried as data:
 *  - `activities` — the roll (Kick's Power check, Rend Armor's attack, the Opportunity Attacks).
 *  - `flags.opportunity` — one of the book's "four Opportunity Attacks" (Don't Leave, Reaction Attack,
 *    Ticket to Enter, Base Clobber). Emits `self:attack:opportunity` so opportunity-attack passives
 *    (Hidebite, Shove and Twist, Lightning Shove, Porcupine …) gate on it; `flags.steadiedCrit` — used
 *    while Steadied, the attack is treated as a critical hit (book p.240).
 *  - `flags.postRoll` — a defender-side post-roll reaction (Block/Dodge) resolved GM-side against an
 *    incoming hit (see module/helpers/post-roll.mjs); the item itself is the reference + reaction spend.
 *  - `baseDamageOnly` (activity) — roll only the bound weapon's base dice, no trait/bonuses (Base Clobber).
 *
 * Movement-only basics (Move, 5-Foot Adjust, Climb, Drop, Hurdle, Disengage, Sidestep) are not items —
 * displacement on the canvas is the GM's (forced-movement / movement policy); their AP/limb cost stays
 * on the economy tracker's basic-action buttons.
 */

const noAtk = { category: '', trait: '', defense: '' };
const noSave = { trait: '', dc: null };

export const BASICS = [
  {
    id: 'basic_kick', name: 'Kick', tag: 'action', ap: 1, limbs: ['leg'],
    description: 'Choose a single target within 5ft of you. They attempt a Power Check against your Check DC or are moved 5ft away from you into a free square, if there is a free square they can enter, or is knocked prone if there is not a free square behind them.',
    // The Power check is rolled; the 5ft displacement (or Prone when blocked) is the GM's call on the
    // canvas, per the forced-movement policy.
    activities: [{ type: 'save', label: '', attack: noAtk, save: { trait: 'power', dc: null }, damage: [], inflict: [] }],
  },
  {
    id: 'basic_rend_armor', name: 'Rend Armor', tag: 'action', ap: 1, limbs: ['oneArm'],
    description: 'You make a melee attack against worn armor by making an attack against enemy armor. If successful, instead of dealing damage rend 1 armor (PD, MD, or TD - your choice).',
    activities: [{ type: 'attack', label: '', attack: { category: 'melee', trait: '', defense: 'pd' }, save: noSave,
      damage: [], noDamage: true, inflict: [{ condition: 'rended', amount: '1' }] }],
  },
  {
    id: 'basic_help', name: 'Help', tag: 'action', ap: 1, limbs: [],
    description: 'Choose one targeted ally within 5ft of you and declare a specific action you wish to help them undertake. When your ally rolls to take that action, they roll with 1X advantage.',
    // A one-shot grant on the targeted ally: +1 advantage on their next d20 roll (attack or Trait
    // Check), consumed by whichever comes first.
    grant: { scope: 'ally', label: 'Help', duration: { type: 'consumed', on: 'roll' },
      changes: [{ key: 'system.advantage.toHit', mode: 2, value: '1' }, { key: 'system.advantage.trait', mode: 2, value: '1' }] },
  },
  {
    id: 'basic_block', name: 'Block', tag: 'reaction', ap: 0, limbs: [],
    description: 'You may use a reaction when you have Steadied to reduce a melee physical attack made against you by 1D4. Increase the die roll made this way to 1D6 at Level 5, and 1D8 at Level 11.',
    flags: { postRoll: 'block' },
  },
  {
    id: 'basic_dodge', name: 'Dodge', tag: 'reaction', ap: 0, limbs: [],
    description: '(Prerequisite: Medium Armor). You may use a reaction when you have Steadied to reduce a ranged physical attack made against you by 1D4. Increase the die roll made this way to 1D6 at Level 5, and 1D8 at Level 11.',
    flags: { postRoll: 'dodge' },
  },
  {
    id: 'basic_grab', name: 'Grab', tag: 'reaction', ap: 0, limbs: [],
    description: '(Prerequisite: Heavy Armor). You may use a reaction when you have Steadied to grab an enemy who tries to move from 5ft away to further. They make a Finesse Check against your Check DC or their Move ends.',
    activities: [{ type: 'save', label: '', attack: noAtk, save: { trait: 'finesse', dc: null }, damage: [], inflict: [] }],
  },
  {
    id: 'basic_dont_leave', name: "Don't Leave", tag: 'reaction', ap: 0, limbs: [],
    description: 'Short weapons (daggers, fists, hand axes). If you are wielding a short weapon and an enemy attempts to move within that range or uses a ranged attack when inside your melee range, you may attempt to make a melee attack against them. If you Steady and then use this reaction while Steadied, treat this attack as a critical hit.',
    activities: [{ type: 'attack', label: '', attack: { category: 'melee', trait: '', defense: '' }, save: noSave, damage: [], inflict: [] }],
    flags: { opportunity: true, steadiedCrit: true },
  },
  {
    id: 'basic_reaction_attack', name: 'Reaction Attack', tag: 'reaction', ap: 0, limbs: [],
    description: 'Medium weapons. Make a single melee attack against a target seeking to move out of your melee weapon reach. If you are Steadied and then use this reaction while Steadied, treat this attack as a critical hit. Reaction attacks cannot be used against an enemy making a ranged attack within 5ft of you - only Don\'t Leave can be used on a target who makes such an attack within range.',
    activities: [{ type: 'attack', label: '', attack: { category: 'melee', trait: '', defense: '' }, save: noSave, damage: [], inflict: [] }],
    flags: { opportunity: true, steadiedCrit: true },
  },
  {
    id: 'basic_ticket_to_enter', name: 'Ticket to Enter', tag: 'reaction', ap: 0, limbs: [],
    description: 'Long weapons (10ft range). When an enemy moves from 15ft away from you to 10ft away from you and you are wielding a 10ft range weapon, you may use a reaction to attempt to make a melee attack against them with that weapon. If you are Steadied and then use this reaction while Steadied, treat this attack as a critical hit.',
    activities: [{ type: 'attack', label: '', attack: { category: 'melee', trait: '', defense: '' }, save: noSave, damage: [], inflict: [] }],
    flags: { opportunity: true, steadiedCrit: true },
  },
  {
    id: 'basic_base_clobber', name: 'Base Clobber', tag: 'reaction', ap: 0, limbs: [],
    description: 'Ranged weapons (bow, crossbow, sling). When an enemy moves from 10ft away to 5ft away, you may use a reaction to deal your base weapon damage to them. Do not add any modifiers to this damage. If you are Steadied and then use this reaction while Steadied, treat this attack as a critical hit.',
    // Damage-only: the bound weapon's base dice, nothing added. "Treat as a critical hit" on a damage
    // roll = the crit baseline (Maximize) — applied in #useAbility when Steadied.
    activities: [{ type: 'damage', label: '', attack: noAtk, save: noSave, damage: [], inflict: [], baseDamageOnly: true }],
    flags: { opportunity: true, steadiedCrit: true },
  },
];
