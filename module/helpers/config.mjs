export const SACADIA = {};

/* -------------------------------------------- */
/*  Core stats                                  */
/* -------------------------------------------- */

/**
 * The five core stats (book p.226). Ordered as they appear on the sheet.
 * @type {Record<string, string>} stat key -> i18n label path
 */
SACADIA.stats = {
  power: 'SACADIA.Stat.Power.long',
  finesse: 'SACADIA.Stat.Finesse.long',
  wiles: 'SACADIA.Stat.Wiles.long',
  courage: 'SACADIA.Stat.Courage.long',
  fate: 'SACADIA.Stat.Fate.long',
};

SACADIA.statAbbreviations = {
  power: 'SACADIA.Stat.Power.abbr',
  finesse: 'SACADIA.Stat.Finesse.abbr',
  wiles: 'SACADIA.Stat.Wiles.abbr',
  courage: 'SACADIA.Stat.Courage.abbr',
  fate: 'SACADIA.Stat.Fate.abbr',
};

/* -------------------------------------------- */
/*  Defenses                                    */
/* -------------------------------------------- */

/**
 * Governing stat for each of the four defenses (book pp.190/222). Each defense is
 * `11 + governing stat + armor + effects`, computed independently; AD is a floor that
 * supersedes the others in play but never overwrites their true value.
 * @type {Record<string, string>} defense key -> governing stat key
 */
SACADIA.defenseStat = {
  ad: 'fate', // All Defense
  pd: 'power', // Physical Defense
  td: 'finesse', // Toughness Defense
  md: 'wiles', // Mental Defense
};

/* -------------------------------------------- */
/*  Professions                                 */
/* -------------------------------------------- */

/**
 * The seven professions.
 * @type {Record<string, string>} profession key -> i18n label path
 */
SACADIA.professions = {
  bladedancer: 'SACADIA.Profession.Bladedancer',
  fatebound: 'SACADIA.Profession.Fatebound',
  hulinari_warrior: 'SACADIA.Profession.HulinariWarrior',
  oracle: 'SACADIA.Profession.Oracle',
  sentinel: 'SACADIA.Profession.Sentinel',
  soldier: 'SACADIA.Profession.Soldier',
  thug: 'SACADIA.Profession.Thug',
};

/**
 * Stat that feeds each profession's Check DC (`9 + stat + proficiency + floor(courage/3)`).
 * @type {Record<string, string>} profession key -> stat key
 */
SACADIA.professionCheckDcStat = {
  bladedancer: 'finesse',
  fatebound: 'fate',
  hulinari_warrior: 'courage',
  oracle: 'wiles',
  sentinel: 'finesse',
  soldier: 'courage',
  thug: 'power',
};

/**
 * Trait Expertise reroll traits per profession (auto-labeled from the *primary* profession
 * only). Hulinari Warrior lists a single trait in the book; the rest list two.
 * @type {Record<string, string[]>} profession key -> stat keys
 */
SACADIA.professionTraitExpertise = {
  bladedancer: ['finesse', 'courage'],
  fatebound: ['power', 'fate'],
  hulinari_warrior: ['courage'],
  oracle: ['wiles', 'fate'],
  sentinel: ['finesse', 'wiles'],
  soldier: ['courage', 'power'],
  thug: ['power', 'finesse'],
};

/**
 * Average HP gained per level per profession (drives the suggested-Max-Health hint; the
 * real Max Health stays player-editable because the book allows rolling instead).
 * @type {Record<string, number>}
 */
SACADIA.professionHpPerLevel = {
  bladedancer: 9,
  fatebound: 9,
  hulinari_warrior: 9,
  oracle: 7,
  sentinel: 7,
  soldier: 11,
  thug: 11,
};

/* -------------------------------------------- */
/*  Talents                                     */
/* -------------------------------------------- */

/**
 * Display categories for the 29 talents (order as on the sheet's Stats tab).
 * @type {Record<string, string>}
 */
SACADIA.talentCategories = {
  crafting: 'SACADIA.TalentCategory.Crafting',
  knowledge: 'SACADIA.TalentCategory.Knowledge',
  action: 'SACADIA.TalentCategory.Action',
  general: 'SACADIA.TalentCategory.General',
};

/**
 * The 29 talents. `stat` is the governing stat for the talent's roll; `category` groups it
 * on the sheet. Governing stats verified directly against the book's per-talent stat blocks
 * (History/Tools have no book-defined stat — sheet defaults kept: History→wiles, Tools→
 * finesse). "other" is the sheet's freeform catch-all talent (defaults to finesse).
 * @type {Record<string, {stat: string, category: string, label: string}>}
 */
SACADIA.talents = {
  // ---- Crafting ----
  alchemy: { stat: 'wiles', category: 'crafting', label: 'SACADIA.Talent.Alchemy' },
  art: { stat: 'courage', category: 'crafting', label: 'SACADIA.Talent.Art' },
  construction: { stat: 'power', category: 'crafting', label: 'SACADIA.Talent.Construction' },
  cooking: { stat: 'courage', category: 'crafting', label: 'SACADIA.Talent.Cooking' },
  herbalism: { stat: 'finesse', category: 'crafting', label: 'SACADIA.Talent.Herbalism' },
  ritual: { stat: 'wiles', category: 'crafting', label: 'SACADIA.Talent.Ritual' },
  smithing: { stat: 'power', category: 'crafting', label: 'SACADIA.Talent.Smithing' },
  tailor: { stat: 'finesse', category: 'crafting', label: 'SACADIA.Talent.Tailor' },
  // ---- Knowledge ----
  literary: { stat: 'wiles', category: 'knowledge', label: 'SACADIA.Talent.Literary' },
  fables: { stat: 'wiles', category: 'knowledge', label: 'SACADIA.Talent.Fables' },
  society: { stat: 'finesse', category: 'knowledge', label: 'SACADIA.Talent.Society' },
  history: { stat: 'wiles', category: 'knowledge', label: 'SACADIA.Talent.History' },
  magic: { stat: 'wiles', category: 'knowledge', label: 'SACADIA.Talent.Magic' },
  religion: { stat: 'wiles', category: 'knowledge', label: 'SACADIA.Talent.Religion' },
  wilderness: { stat: 'wiles', category: 'knowledge', label: 'SACADIA.Talent.Wilderness' },
  other: { stat: 'finesse', category: 'knowledge', label: 'SACADIA.Talent.Other' },
  // ---- Action ----
  acrobatics: { stat: 'finesse', category: 'action', label: 'SACADIA.Talent.Acrobatics' },
  athletics: { stat: 'power', category: 'action', label: 'SACADIA.Talent.Athletics' },
  nimblehands: { stat: 'finesse', category: 'action', label: 'SACADIA.Talent.NimbleHands' },
  performance: { stat: 'courage', category: 'action', label: 'SACADIA.Talent.Performance' },
  stealth: { stat: 'finesse', category: 'action', label: 'SACADIA.Talent.Stealth' },
  survival: { stat: 'power', category: 'action', label: 'SACADIA.Talent.Survival' },
  // ---- General ----
  economy: { stat: 'finesse', category: 'general', label: 'SACADIA.Talent.Economy' },
  medicine: { stat: 'courage', category: 'general', label: 'SACADIA.Talent.Medicine' },
  perception: { stat: 'courage', category: 'general', label: 'SACADIA.Talent.Perception' },
  socialgraces: { stat: 'finesse', category: 'general', label: 'SACADIA.Talent.SocialGraces' },
  strategy: { stat: 'courage', category: 'general', label: 'SACADIA.Talent.Strategy' },
  tools: { stat: 'finesse', category: 'general', label: 'SACADIA.Talent.Tools' },
  transport: { stat: 'finesse', category: 'general', label: 'SACADIA.Talent.Transport' },
};

/* -------------------------------------------- */
/*  Conditions                                  */
/* -------------------------------------------- */

/**
 * The 12 dice-severity conditions (0–6 track). Actor-intrinsic — modeled as a schema record,
 * not Active Effects. `madness` is Oracle-only (harmless for non-Oracle characters).
 * @type {Record<string, string>} condition key -> i18n label path
 */
SACADIA.conditions = {
  fumbled: 'SACADIA.Condition.Fumbled',
  rended: 'SACADIA.Condition.Rended',
  madness: 'SACADIA.Condition.Madness',
  fatigue: 'SACADIA.Condition.Fatigue',
  frenzy: 'SACADIA.Condition.Frenzy',
  delirium: 'SACADIA.Condition.Delirium',
  panic: 'SACADIA.Condition.Panic',
  taunt: 'SACADIA.Condition.Taunt',
  nausea: 'SACADIA.Condition.Nausea',
  hemorrhage: 'SACADIA.Condition.Hemorrhage',
  pinned: 'SACADIA.Condition.Pinned',
  dying: 'SACADIA.Condition.Dying',
};

/** Min/max of the dice-severity condition track. */
SACADIA.conditionMax = 6;

/**
 * The named adversarial conditions (book pp.259–262). Modeled as status effects / Active
 * Effects (Phase 5), not the intrinsic dice track above.
 * @type {Record<string, string>}
 */
SACADIA.adversarialConditions = {
  corroded: 'SACADIA.Adversarial.Corroded',
  debilitated: 'SACADIA.Adversarial.Debilitated',
  pulled: 'SACADIA.Adversarial.Pulled',
  paralysis: 'SACADIA.Adversarial.Paralysis',
  jinxed: 'SACADIA.Adversarial.Jinxed',
  slowed: 'SACADIA.Adversarial.Slowed',
  sting: 'SACADIA.Adversarial.Sting',
};

/* -------------------------------------------- */
/*  Abilities & combat                          */
/* -------------------------------------------- */

/**
 * Ability tags. Only Action/Focus/Ceremony cost AP and get limb/attack fields; the rest
 * route to their own lists. (Ceremony/Lore have no catalog content yet but are valid tags.)
 * @type {Record<string, string>}
 */
SACADIA.abilityTags = {
  action: 'SACADIA.AbilityTag.Action',
  focus: 'SACADIA.AbilityTag.Focus',
  ceremony: 'SACADIA.AbilityTag.Ceremony',
  passive: 'SACADIA.AbilityTag.Passive',
  boost: 'SACADIA.AbilityTag.Boost',
  reaction: 'SACADIA.AbilityTag.Reaction',
  lore: 'SACADIA.AbilityTag.Lore',
};

/**
 * Limb-cost types (the icons in the book's ability entries).
 * @type {Record<string, string>}
 */
SACADIA.limbs = {
  oneArm: 'SACADIA.Limb.OneArm',
  twoArm: 'SACADIA.Limb.TwoArm',
  body: 'SACADIA.Limb.Body',
  mind: 'SACADIA.Limb.Mind',
  focus: 'SACADIA.Limb.Focus',
  leg: 'SACADIA.Limb.Leg',
};

/**
 * Slots on the limb-exhaustion tracker (Abilities tab).
 * @type {Record<string, string>}
 */
SACADIA.exhaustionSlots = {
  leftArm: 'SACADIA.Exhaustion.LeftArm',
  rightArm: 'SACADIA.Exhaustion.RightArm',
  body: 'SACADIA.Exhaustion.Body',
  mind: 'SACADIA.Exhaustion.Mind',
  focus: 'SACADIA.Exhaustion.Focus',
  legs: 'SACADIA.Exhaustion.Legs',
  reaction: 'SACADIA.Exhaustion.Reaction',
};

/**
 * Attack categories and the trait each contributes to the to-hit / damage roll (book p.218):
 * Power for melee, Finesse for physical ranged, Wiles for magical.
 * @type {Record<string, {trait: string, label: string}>}
 */
SACADIA.attackCategories = {
  melee: { trait: 'power', label: 'SACADIA.AttackCategory.Melee' },
  ranged: { trait: 'finesse', label: 'SACADIA.AttackCategory.Ranged' },
  magic: { trait: 'wiles', label: 'SACADIA.AttackCategory.Magic' },
};

/**
 * The book's dice-type ladder (p.218): 1D2 → … → 1D10 → 2D6 → … → 20D10. Dice count doubles
 * past 1D10 rather than continuing to bigger single dice; no D12s. `ladderIndex` on an ability
 * indexes into this array.
 * @type {Array<{count: number, die: number}>}
 */
SACADIA.diceLadder = [
  { count: 1, die: 2 }, { count: 1, die: 4 }, { count: 1, die: 6 }, { count: 1, die: 8 }, { count: 1, die: 10 },
  { count: 2, die: 6 }, { count: 2, die: 8 }, { count: 2, die: 10 },
  { count: 3, die: 8 }, { count: 3, die: 10 },
  { count: 4, die: 8 }, { count: 4, die: 10 },
  { count: 5, die: 10 }, { count: 6, die: 10 }, { count: 7, die: 10 }, { count: 8, die: 10 },
  { count: 9, die: 10 }, { count: 10, die: 10 }, { count: 11, die: 10 }, { count: 12, die: 10 },
  { count: 13, die: 10 }, { count: 14, die: 10 }, { count: 15, die: 10 }, { count: 16, die: 10 },
  { count: 17, die: 10 }, { count: 18, die: 10 }, { count: 19, die: 10 }, { count: 20, die: 10 },
];
