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

/**
 * Defense labels keyed by defense id — for pickers (e.g. an attack activity's target defense).
 * @type {Record<string, string>}
 */
SACADIA.defenseLabels = {
  ad: 'SACADIA.Defense.AD',
  pd: 'SACADIA.Defense.PD',
  td: 'SACADIA.Defense.TD',
  md: 'SACADIA.Defense.MD',
};

/**
 * Signature class point-pools (Arrangement, Glory, …) — key → i18n label. Their `value`/`max` live
 * on the character; abilities that "expend N <Pool> point(s)" auto-deduct from them.
 * @type {Record<string, string>}
 */
SACADIA.pools = {
  arrangement: 'SACADIA.Pool.Arrangement',
  glory: 'SACADIA.Pool.Glory',
  prescient: 'SACADIA.Pool.Prescient',
  trickshot: 'SACADIA.Pool.Trickshot',
  savage: 'SACADIA.Pool.Savage',
  herd: 'SACADIA.Pool.Herd',
  call: 'SACADIA.Pool.Call',
  trick: 'SACADIA.Pool.Trick',
};

/** Which pool(s) each profession uses — surfaced on the sheet when that profession is set. */
SACADIA.professionPools = {
  bladedancer: ['arrangement'],
  fatebound: ['glory'],
  oracle: ['prescient'],
  sentinel: ['trickshot'],
  hulinari_warrior: ['savage', 'herd'],
  soldier: ['call'],
  thug: ['trick'],
};

/**
 * How each pool's max is granted (book, transcribed from the PDF). Owning the `grant` ability sets the
 * pool max to your Proficiency; owning the level-6 `scale` passive doubles it (2× Proficiency per rest).
 * catalogId of the granting ability → the pool it feeds. Uniform across every profession.
 */
/**
 * Creature types (book — Sentinel's Favored Enemy). A target's type is set on the NPC sheet; a Sentinel
 * picks favored types from these (Humanoid isn't a favored option but is a valid target type, used by
 * Most Dangerous Game). Drives `target:type:<t>` / `target:favored` roll options.
 */
SACADIA.creatureTypes = {
  beast: 'SACADIA.Creature.Beast',
  greatBeast: 'SACADIA.Creature.GreatBeast',
  awokenFlora: 'SACADIA.Creature.AwokenFlora',
  folkFae: 'SACADIA.Creature.FolkFae',
  wildFae: 'SACADIA.Creature.WildFae',
  fontmade: 'SACADIA.Creature.Fontmade',
  undead: 'SACADIA.Creature.Undead',
  demon: 'SACADIA.Creature.Demon',
  humanoid: 'SACADIA.Creature.Humanoid',
};

SACADIA.poolGrants = {
  arrangement: { grant: 'bd_arrangement', scale: 'bd_planned_footwork' },
  glory: { grant: 'tighten_focus', scale: 'font_of_glory' },
  prescient: { grant: 'future_visions', scale: 'divine_messages' },
  trickshot: { grant: 'trickshot', scale: 'striking_savant' },
  savage: { grant: 'steeltip', scale: 'unrestrained_savagery' },
  herd: { grant: 'get_down', scale: 'herd_management' },
  call: { grant: 'call_to_action', scale: 'voice_of_the_leader' },
  trick: { grant: 'thug_wrestling_trick', scale: 'thug_wrestling_expert' },
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

/** Max effective level of a leveled condition (book p.259: effects cap at 6). */
SACADIA.conditionMax = 6;

/** Display groups for the leveled conditions (book pp.259–262). */
SACADIA.conditionGroups = {
  lesserPhysical: 'SACADIA.ConditionGroup.LesserPhysical',
  greaterPhysical: 'SACADIA.ConditionGroup.GreaterPhysical',
  lesserMental: 'SACADIA.ConditionGroup.LesserMental',
  greaterMental: 'SACADIA.ConditionGroup.GreaterMental',
  special: 'SACADIA.ConditionGroup.Special',
};

/**
 * The leveled conditions (0–6). All adversarial conditions and the special leveled ones
 * (Fumbled/Rended/Madness) live here as an actor-intrinsic schema record. `effects` drives
 * automation, scaled by level; effect types:
 *   - `bonus`      → `system.bonuses.<target>` += perLevel × level
 *   - `disadvantage` → `system.disadvantage.<toHit|trait>` += perLevel × level (extra kept-lowest d20s)
 *   - `resource`   → reduces a derived resource (currently `ap.max`) by perLevel × level
 *   - `turnDamage` → `perLevelDice` per level, rolled at the creature's turn start (combat hook)
 *   - `damageTaken`→ +perLevel × level to incoming damage (surfaced; auto-applied with Phase 10)
 * Conditions with no `effects` are **display-only** (positional / limb / conditional / chained
 * mechanics that resist clean automation) — their rules text is shown and play is adjudicated.
 * @type {Record<string, {label:string, img:string, group:string, rules:string, effects:object[]}>}
 */
SACADIA.conditions = {
  // ---- Lesser Physical ----
  nausea: { label: 'SACADIA.Condition.Nausea', img: 'icons/svg/acid.svg', group: 'lesserPhysical',
    rules: 'SACADIA.ConditionRule.Nausea', effects: [{ type: 'bonus', target: 'toHit.all', perLevel: -1 }] },
  pinned: { label: 'SACADIA.Condition.Pinned', img: 'icons/svg/net.svg', group: 'lesserPhysical',
    rules: 'SACADIA.ConditionRule.Pinned', effects: [] },
  paralysis: { label: 'SACADIA.Condition.Paralysis', img: 'icons/svg/paralysis.svg', group: 'lesserPhysical',
    rules: 'SACADIA.ConditionRule.Paralysis', effects: [] },
  // ---- Greater Physical ----
  corroded: { label: 'SACADIA.Condition.Corroded', img: 'icons/svg/acid.svg', group: 'greaterPhysical',
    rules: 'SACADIA.ConditionRule.Corroded', effects: [] },
  debilitated: { label: 'SACADIA.Condition.Debilitated', img: 'icons/svg/downgrade.svg', group: 'greaterPhysical',
    rules: 'SACADIA.ConditionRule.Debilitated', effects: [{ type: 'disadvantage', target: 'toHit', perLevel: 1 }] },
  pulled: { label: 'SACADIA.Condition.Pulled', img: 'icons/svg/net.svg', group: 'greaterPhysical',
    rules: 'SACADIA.ConditionRule.Pulled', effects: [] },
  hemorrhage: { label: 'SACADIA.Condition.Hemorrhage', img: 'icons/svg/blood.svg', group: 'greaterPhysical',
    rules: 'SACADIA.ConditionRule.Hemorrhage', effects: [{ type: 'turnDamage', perLevelDice: '1d10' }] },
  // ---- Lesser Mental ----
  delirium: { label: 'SACADIA.Condition.Delirium', img: 'icons/svg/daze.svg', group: 'lesserMental',
    rules: 'SACADIA.ConditionRule.Delirium', effects: [
      { type: 'bonus', target: 'defense.ad', perLevel: -1 }, { type: 'bonus', target: 'defense.pd', perLevel: -1 },
      { type: 'bonus', target: 'defense.td', perLevel: -1 }, { type: 'bonus', target: 'defense.md', perLevel: -1 }] },
  jinxed: { label: 'SACADIA.Condition.Jinxed', img: 'icons/svg/hazard.svg', group: 'lesserMental',
    rules: 'SACADIA.ConditionRule.Jinxed', effects: [] },
  slowed: { label: 'SACADIA.Condition.Slowed', img: 'icons/svg/downgrade.svg', group: 'lesserMental',
    rules: 'SACADIA.ConditionRule.Slowed', effects: [] },
  // Silenced: cannot speak or cast spells; cleared by a Make-Trait-Check action (so enduring — it does
  // not auto-reduce each turn). No numeric modifier — a rules-text restriction the GM enforces.
  silenced: { label: 'SACADIA.Condition.Silenced', img: 'icons/svg/silenced.svg', group: 'lesserMental',
    rules: 'SACADIA.ConditionRule.Silenced', effects: [] },
  sting: { label: 'SACADIA.Condition.Sting', img: 'icons/svg/blood.svg', group: 'lesserMental',
    rules: 'SACADIA.ConditionRule.Sting', effects: [{ type: 'damageTaken', perLevel: 1 }] },
  // ---- Greater Mental ----
  fatigue: { label: 'SACADIA.Condition.Fatigue', img: 'icons/svg/degen.svg', group: 'greaterMental',
    rules: 'SACADIA.ConditionRule.Fatigue', effects: [{ type: 'resource', target: 'ap.max', perLevel: -1 }] },
  frenzy: { label: 'SACADIA.Condition.Frenzy', img: 'icons/svg/terror.svg', group: 'greaterMental',
    rules: 'SACADIA.ConditionRule.Frenzy', effects: [{ type: 'disadvantage', target: 'trait', perLevel: 1 }] },
  panic: { label: 'SACADIA.Condition.Panic', img: 'icons/svg/terror.svg', group: 'greaterMental',
    rules: 'SACADIA.ConditionRule.Panic', effects: [] },
  taunt: { label: 'SACADIA.Condition.Taunt', img: 'icons/svg/terror.svg', group: 'greaterMental',
    rules: 'SACADIA.ConditionRule.Taunt', effects: [] },
  // ---- Special / Oracle ----
  fumbled: { label: 'SACADIA.Condition.Fumbled', img: 'icons/svg/trap.svg', group: 'special',
    rules: 'SACADIA.ConditionRule.Fumbled', effects: [] },
  rended: { label: 'SACADIA.Condition.Rended', img: 'icons/svg/downgrade.svg', group: 'special',
    rules: 'SACADIA.ConditionRule.Rended', effects: [] },
  madness: { label: 'SACADIA.Condition.Madness', img: 'icons/svg/daze.svg', group: 'special',
    rules: 'SACADIA.ConditionRule.Madness', effects: [] },
};

/** Conditions that do NOT auto-reduce by 1 at end of turn (book: "unless Enduring"). */
SACADIA.enduringConditions = ['silenced'];

/**
 * Suggested weapon/item traits for the gear editor's datalist (see docs/conditional-modifiers.md).
 * The book's weapon taxonomy is open — players tag their own types — so this only seeds a picker;
 * any freeform trait works. Each becomes a `self:wielding:<trait>` roll option while equipped.
 * @type {string[]}
 */
/**
 * Range classifications for abilities. `value` (feet) accompanies `ranged`/`area`; the others are
 * self-descriptive. Used for the card's Range readout and the out-of-range check.
 * @type {Record<string, string>}
 */
SACADIA.rangeTypes = {
  self: 'SACADIA.Range.Self',
  touch: 'SACADIA.Range.Touch',
  melee: 'SACADIA.Range.Melee',
  ranged: 'SACADIA.Range.Ranged',
  area: 'SACADIA.Range.Area',
};

SACADIA.weaponTraits = [
  'heavy', 'light', 'one-handed', 'two-handed', 'melee', 'ranged', 'thrown', 'finesse',
  'sword', 'axe', 'bow', 'crossbow', 'dagger', 'spear', 'mace', 'hammer', 'staff', 'whip',
  'flail', 'polearm', 'shield', 'divine',
];

/**
 * Simple (binary) conditions (book p.257–258): on/off, no levels. Registered as token status
 * effects; some feed the disadvantage sink via AE changes (`mode: 2` = ADD).
 * @type {Record<string, {label:string, img:string, changes:object[]}>}
 */
SACADIA.simpleConditions = {
  prone: { label: 'SACADIA.Simple.Prone', img: 'icons/svg/falling.svg',
    changes: [{ key: 'system.disadvantage.toHit', mode: 2, value: '1' }] },
  blinded: { label: 'SACADIA.Simple.Blinded', img: 'icons/svg/blind.svg',
    changes: [{ key: 'system.disadvantage.toHit', mode: 2, value: '1' }] },
  dragged: { label: 'SACADIA.Simple.Dragged', img: 'icons/svg/net.svg', changes: [] },
  surprised: { label: 'SACADIA.Simple.Surprised', img: 'icons/svg/daze.svg', changes: [] },
  unconscious: { label: 'SACADIA.Simple.Unconscious', img: 'icons/svg/unconscious.svg', changes: [] },
  // Insanity (Oracle) — a state you're in or not, GM-tracked on the token; distinct from the leveled
  // Madness tracker. Predicates read it as `self:insane` (see docs/conditional-modifiers.md).
  insane: { label: 'SACADIA.Simple.Insane', img: 'icons/svg/terror.svg', changes: [] },
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
 * Basic actions everyone can take (book p.237), as presets for the action-economy tracker: an AP
 * cost plus the limbs they occupy. Pushed to the turn log via the "log basic action" buttons so
 * implicit actions (moving, steadying) count against AP alongside abilities.
 * @type {Record<string, {label: string, ap: number, limbs: string[]}>}
 */
SACADIA.basicActions = {
  move: { label: 'SACADIA.BasicAction.Move', ap: 1, limbs: ['leg'] },
  attack: { label: 'SACADIA.BasicAction.Attack', ap: 1, limbs: ['oneArm'] },
  steady: { label: 'SACADIA.BasicAction.Steady', ap: 1, limbs: [] },
  other: { label: 'SACADIA.BasicAction.Other', ap: 1, limbs: [] },
};

/**
 * Canonical weapon types. Freeform gear `traits` stay open (the book lets you name the school you
 * trained in), but a weapon's *type* is a validated select so ability gating (`self:wielding:<type>`)
 * and ability choice-lists — Bigger Stones' bow/crossbow/sling, etc. — resolve reliably. The ranged
 * aspect only cares about bow/crossbow/sling/thrown; the melee spread is convenience.
 * @type {Record<string, string>}
 */
SACADIA.weaponTypes = {
  unarmed: 'SACADIA.Weapon.Unarmed',
  dagger: 'SACADIA.Weapon.Dagger',
  sword: 'SACADIA.Weapon.Sword',
  axe: 'SACADIA.Weapon.Axe',
  spear: 'SACADIA.Weapon.Spear',
  bludgeon: 'SACADIA.Weapon.Bludgeon',
  sling: 'SACADIA.Weapon.Sling',
  bow: 'SACADIA.Weapon.Bow',
  crossbow: 'SACADIA.Weapon.Crossbow',
  shield: 'SACADIA.Weapon.Shield',
  other: 'SACADIA.Weapon.Other',
};

/**
 * Armor categories (book pp.192–194). Each equipped armor advertises `self:armor:<category>`, and a
 * derived `self:armor:only-light` fires when every worn armor is light — the gate for Light Wear /
 * Slightly Darker Wear.
 * @type {Record<string, string>}
 */
SACADIA.armorCategories = {
  light: 'SACADIA.Armor.Light',
  medium: 'SACADIA.Armor.Medium',
  heavy: 'SACADIA.Armor.Heavy',
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
 * Activity types an ability can perform when used. An ability holds zero or more activities.
 * @type {Record<string, string>}
 */
SACADIA.activityTypes = {
  attack: 'SACADIA.Activity.Attack',
  save: 'SACADIA.Activity.Save',
  damage: 'SACADIA.Activity.Damage',
  utility: 'SACADIA.Activity.Utility',
};

/**
 * Standard die denominations for structured damage parts (keys are the die sizes).
 * @type {Record<string, string>}
 */
SACADIA.dieDenominations = { 2: 'd2', 4: 'd4', 6: 'd6', 8: 'd8', 10: 'd10' };

/**
 * The book's dice-type ladder (p.218): 1D2 → … → 1D10 → 2D6 → … → 20D10. Dice count doubles
 * past 1D10 rather than continuing to bigger single dice; no D12s. Used as an authoring
 * convenience for damage parts and as the step sequence for die-step buffs (Phase 5).
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
