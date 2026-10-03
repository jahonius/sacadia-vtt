/**
 * The keys the two free-form option bags understand, each with what it does — `boost.special` (a Boost's richer
 * behaviors, read by the sheet's #useAbility) and `save.ext` (a save's extension effects, read by #saveExt and
 * onSaveRoll / applySaveExtensions). Both are ObjectFields that only the build writes, so nothing else stops a typo or
 * a key nobody reads; test/option-keys.test.mjs checks every key the packs use is listed here and every key listed is
 * read by the code.
 *
 * Adding a key? First check whether an existing mechanism already says it (docs/conditional-modifiers.md, "Choosing a
 * mechanism"): a modifier, a grant, an activity's inflict, an on-use effect. A new key is for behavior none of them can
 * express — and it needs an entry here.
 */

/** `boost.special` keys. */
export const BOOST_SPECIAL_KEYS = {
  free: 'Rides outside the one-Boost-per-action limit (Rousing Success, Lore Boosts).',
  requires: 'Predicate atoms the action must meet, or the Boost stays armed (Biting Pankration, Unpredictability).',
  onConsume: 'Side effects when consumed, before the rolls: turn flags, exposure, a Madness change, self-damage, Lore cost (Mad Smear, Reckless Physical Attack — #boostOnConsume).',
  prompt: 'A free amount chosen at use, read as `@spent` (Boosted Fury).',
  forceCrit: 'The action it rides is a critical hit (Rousing Success).',
  targetAs: 'Treat the target as having a condition for this action (Barreling Stature: Prone).',
  extraAttacks: 'Extra attacks added to the action, a formula (Freefire, Long Arc, Rebound, Divine Volley).',
  extraAttackAdvantage: 'Advantage on those extra attacks (Rebound: −1).',
  baseOnly: 'The extra attacks use the base weapon dice only (Long Arc).',
  singleAttack: 'Collapse a multi-attack into one attack against one target (Razorbite).',
  unlimitedBoosts: 'Any number of other unique Boosts may ride the same attack (Glore).',
  graze: 'On a near miss within `margin`, deal the weapon\'s damage stepped by `steps` (Boostbane).',
  pierce: 'One roll through two creatures in a line: full damage to the first, half to the second (Piercing Pin).',
  stripTempHp: 'The target\'s temp HP is stripped before the hit lands (Spirit Sap).',
  onKill: 'On a kill: adjacent enemies Surprised, and Panic on one with `panicWith` owned (Tear Apart).',
  saveTrait: 'The save it rides uses this trait instead (Bleeding Barbs: Wiles).',
  inflictBonus: 'Extra levels of a condition the save gives, capped at Proficiency (Starter, No Bars Hold).',
  perLevelDamage: 'Damage per level the save gives, a die stepped by `perLevelScale` levels and `perLevelStepWith` (Biting Pankration).',
  perLevelScale: 'Character levels at which perLevelDamage steps up a die type.',
  perLevelStepWith: 'An owned ability that steps perLevelDamage up one more die type.',
  pendingPerFail: 'A next-attack bonus per failed check (Sapped Fates: +1 to-hit per enemy Fumbled).',
  marginStep: 'Step the save\'s damage up when it fails by `margin` or more (Backpress).',
  storeMomentum: 'Store the saver\'s d20 for Stored Momentum.',
  saveDamage: 'Damage the forced check deals on a failure, by level tier (Horn Butting, Ribcrack, Damaging Whispers).',
  saveExt: 'Extra `save.ext` keys merged into the save it rides (Luckless Hold, Silvery Barbs).',
  extraSave: 'A save of its own the Boost forces on the target (Unpredictability, Divine Sling).',
  targetDelta: 'Condition changes on the targets, GM-routed (Tangled Harm: −1 Pin).',
  targetGrant: 'A grant placed on the targets, e.g. on their next attack (Blood Doping).',
  grantExtra: 'Extra changes on the action\'s own grant, resolved with the Boost\'s numbers (Dancer\'s Gale, Call of Effort).',
  zoneTiles: 'Extra tiles for the Swarm cloud the action places (Cloudsurge).',
  zoneTilesMult: 'Multiply the Swarm cloud\'s tile count (Coordinated Flock: 2).',
  zoneFollowTarget: 'The cloud starts on and follows the target (Rolling Fog).',
  madnessRoll: 'The action\'s Madness-gain roll is maximized or minimized (Cracked Laughter, Quiet Smirk).',
  madnessExtra: 'One more Madness on a raising action, then self-damage equal to Madness (Blood for Blood).',
  madnessBeforeSpend: 'Self-damage equal to Madness before a Madness reduction (Blood for God).',
  madnessAfterSpend: 'A Madness gain after the reduction (Blood for God).',
  madnessSpendInstead: 'While Insane, pay Proficiency HP instead of the Madness reduction (Bleeding Eyes).',
  useCracked: 'A saved Slightly Cracked d3 stands in for a 1D3−1 Madness roll.',
};

/** `save.ext` keys (authored on a save activity, or merged in by a Boost's `saveExt`). */
export const SAVE_EXT_KEYS = {
  checks: 'How many checks the save rolls, a formula (one per level by default — Olive Branch, Sealslam).',
  capAt: 'The most levels the save can give, a formula (Witch\'s Finger).',
  mode: '"reduce": checks against a condition the saver already has, removing levels on success (Give of Thyself).',
  casterGain: 'Per failed check, the caster gains AP / a pool point / a condition level (Siphon Soul, Bloodsight).',
  perFail: 'Per failed check, condition changes on the saver (`self`) or another creature (Clumsy Touch, Transmute Trauma).',
  perFailDie: 'Per failed check, damage of this die (Olive Branch, Sealslam).',
  perFailDieWith: 'An owned ability that steps perFailDie up a die type.',
  perFailCount: 'Which count perFailDie multiplies (failed checks by default).',
  onFail: 'On a failure: AP debt, lost reactions, the saver\'s Focus ending, a status (Confusion, Mimicked Caw, Pinetar).',
  grantOnFail: 'The action\'s Focus grant lands only on those who fail (Bane, Crown of Insanity, Enemies Abound).',
  resaveOnRenew: 'The target checks again each time the Focus is renewed, and a success ends it (Enemies Abound, Foe Transference).',
  marginDice: 'Extra damage dice by how far the save fails (Runic Scars).',
  healTo: 'Heal a creature by the damage dealt, up to a cap (Olive Branch).',
  drainCeil: 'Round the drained amount up (Ennervation).',
  ignoreFumble: 'The saver\'s Fumble doesn\'t reduce these checks (Clumsy Touch).',
  enduring: 'The condition the save gives is Enduring (Luckless Hold).',
  allyToHit: 'On a failure, an ally gets a to-hit bonus against the saver (Silvery Barbs).',
  grant: 'Set at use (#saveExt): the grant a failed save places on the saver.',
  onSuccess: 'Set at use (#saveExt): what a success ends (`endGrant` — Enemies Abound\'s renewal check).',
};
